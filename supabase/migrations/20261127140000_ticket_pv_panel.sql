-- ===================== PANEL DEL PUNTO DE VENTA (enlace sin cuenta) =====================
-- Va después de 20261127130000_ticket_puntos_venta.sql.
-- Principio: nada de lo que haga (o no haga) el punto de venta impide entrar a quien compró. El QR vale siempre;
-- antes del evento se anulan las que el punto devuelve.
-- · Cada punto tiene un enlace secreto (/pv/<token>), sin cuenta, que el organizador puede renovar.
-- · Registrar una venta (escaneando el QR o con «+1») es SOLO informativo: queda en ticket_web_entradas.pv_vendida_en
--   y en ticket_pv_lotes.registradas_extra. No es un acceso: la puerta sigue con ticket_canjes, aparte.
-- · Devolver escaneando: la entrada queda anulada al momento (si ya entró al evento, no se puede).
-- · Fecha límite de devolución por entrega (aviso al organizador).
-- · Venta directa al móvil (si el organizador la activa en ese punto): el punto cobra en efectivo y el comprador recibe
--   la entrada en su correo. Cuenta como venta del punto (con su comisión), no como venta online.
-- Solo añade columnas, una tabla y funciones (y una condición en web_sync_ingreso).

alter table public.ticket_pv add column if not exists token uuid not null default gen_random_uuid();
create unique index if not exists ticket_pv_token on public.ticket_pv (token);
alter table public.ticket_pv add column if not exists venta_directa boolean not null default false;
alter table public.ticket_pv_lotes add column if not exists devolver_hasta timestamptz;
alter table public.ticket_pv_lotes add column if not exists registradas_extra int not null default 0 check (registradas_extra >= 0);
alter table public.ticket_web_entradas add column if not exists pv_vendida_en timestamptz;

-- Lo cobrado por ventas directas de cada punto en cada evento
create table if not exists public.ticket_pv_eventos (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  pv_id uuid not null references public.ticket_pv(id) on delete cascade,
  evento_id uuid not null references public.ticket_eventos(id) on delete cascade,
  pagado_directas numeric(10,2) not null default 0 check (pagado_directas >= 0),
  actualizado_en timestamptz not null default now(),
  primary key (pv_id, evento_id)
);
alter table public.ticket_pv_eventos enable row level security;
drop policy if exists pv_eventos_propios on public.ticket_pv_eventos;
create policy pv_eventos_propios on public.ticket_pv_eventos for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
grant select, insert, update, delete on public.ticket_pv_eventos to authenticated;

-- Las ventas directas de un punto no son venta online de TIXFAST (van por su propio apunte en el CRM)
do $$
declare d text;
begin
  select pg_get_functiondef('public.web_sync_ingreso(uuid,uuid)'::regprocedure) into d;
  if position('pv_directa' in d) > 0 then return; end if;
  d := replace(d, 'and not coalesce(p.rrpp_efectivo, false)', $b$and not coalesce(p.rrpp_efectivo, false) and not (coalesce(p.datos, '{}'::jsonb) ? 'pv_directa')$b$);
  if position('pv_directa' in d) = 0 then raise exception 'web_sync_ingreso: no se ha encontrado dónde excluir las ventas directas'; end if;
  execute d;
end $$;

-- ---------- Ayudas ----------
create or replace function public.pv_de_token(p_token uuid)
returns public.ticket_pv language sql stable security definer set search_path = '' as $$
  select * from public.ticket_pv where token = p_token and activo
$$;
revoke all on function public.pv_de_token(uuid) from public, anon, authenticated;

-- Entrada (de un talonario con QR de este punto) a partir del contenido del QR
create or replace function public.pv_entrada_qr(p_pv uuid, p_hex text)
returns table (entrada_id uuid, numero int, estado text, vendida timestamptz, lote_id uuid, evento_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare v_hex text := lower(regexp_replace(coalesce(p_hex, ''), '[^0-9a-fA-F]', '', 'g')); v_id uuid;
begin
  if length(v_hex) <> 66 then return; end if;
  begin v_id := (substring(v_hex from 3 for 8) || '-' || substring(v_hex from 11 for 4) || '-' || substring(v_hex from 15 for 4) || '-' || substring(v_hex from 19 for 4) || '-' || substring(v_hex from 23 for 12))::uuid;
  exception when others then return; end;
  return query select x.id, x.numero, x.estado, x.pv_vendida_en, l.id, l.evento_id
    from public.ticket_web_entradas x join public.ticket_pv_lotes l on l.pedido_id = x.pedido_id and l.modo = 'qr'
   where x.id = v_id and x.qr_hex = v_hex and l.pv_id = p_pv;
end $$;
revoke all on function public.pv_entrada_qr(uuid, text) from public, anon, authenticated;

-- Registradas por el punto en una entrega (escaneadas + «+1»)
create or replace function public.pv_registradas(l public.ticket_pv_lotes)
returns int language sql stable security definer set search_path = '' as $$
  select least(l.hasta - l.desde + 1, coalesce(l.registradas_extra, 0) +
    coalesce((select count(*) from public.ticket_web_entradas x where l.modo = 'qr' and x.pedido_id = l.pedido_id and x.pv_vendida_en is not null and x.estado = 'valida'), 0))::int
$$;
revoke all on function public.pv_registradas(public.ticket_pv_lotes) from public, anon;
grant execute on function public.pv_registradas(public.ticket_pv_lotes) to authenticated;

-- ---------- CRM de las ventas directas de un punto en un evento ----------
create or replace function public.pv_sync_directas(p_pv uuid, p_evento uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_pv record; n int; v_total numeric; v_com numeric; v_pag numeric; v_ref text := 'pvd:' || p_pv::text;
begin
  select * into v_pv from public.ticket_pv where id = p_pv;
  select count(*), coalesce(sum(x.precio), 0),
         coalesce(sum(case when p.datos ->> 'comision_tipo' = 'pct' then round(x.precio * (p.datos ->> 'comision_valor')::numeric / 100, 2)
                           else coalesce((p.datos ->> 'comision_valor')::numeric, 0) end), 0)
    into n, v_total, v_com
    from public.ticket_web_entradas x join public.ticket_web_pedidos p on p.id = x.pedido_id
   where p.evento_id = p_evento and p.datos ->> 'pv_directa' = p_pv::text and x.estado = 'valida' and not x.prueba;
  delete from public.ticket_crm_gastos where evento_id = p_evento and nota = v_ref;
  if n = 0 or v_pv.id is null then delete from public.ticket_crm_ingresos where evento_id = p_evento and ref_externa = v_ref; return; end if;
  select coalesce(pagado_directas, 0) into v_pag from public.ticket_pv_eventos where pv_id = p_pv and evento_id = p_evento;
  insert into public.ticket_crm_ingresos (owner_id, evento_id, categoria, concepto, importe, fecha, metodo, estado, origen, ref_externa, unidades, canal, nota, actualizado_en)
  values (v_pv.owner_id, p_evento, 'Otras ticketeras', left(format('Punto de venta · %s · venta directa', v_pv.nombre), 160), v_total, current_date, 'efectivo',
          case when coalesce(v_pag, 0) >= v_total - v_com then 'cobrado' else 'pendiente' end, 'pv', v_ref, n, left(v_pv.nombre, 60),
          left(format('Venta directa al móvil · comisión %s €', v_com), 500), now())
  on conflict (evento_id, ref_externa) do update set importe = excluded.importe, estado = excluded.estado, unidades = excluded.unidades, canal = excluded.canal, nota = excluded.nota, actualizado_en = now();
  if v_com > 0 then
    insert into public.ticket_crm_gastos (owner_id, evento_id, tipo, categoria, concepto, proveedor, previsto, real, estado, fecha, nota)
    values (v_pv.owner_id, p_evento, 'normal', 'Ticketing y pagos', left(format('Comisión punto de venta · %s (venta directa)', v_pv.nombre), 160), left(v_pv.nombre, 120), v_com, v_com, 'pagado', current_date, v_ref);
  end if;
end $$;
revoke all on function public.pv_sync_directas(uuid, uuid) from public, anon, authenticated;
create or replace function public.pv_eventos_despues() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform public.pv_sync_directas(new.pv_id, new.evento_id); return new; end $$;
revoke all on function public.pv_eventos_despues() from public, anon, authenticated;
drop trigger if exists pv_eventos_despues on public.ticket_pv_eventos;
create trigger pv_eventos_despues after insert or update on public.ticket_pv_eventos for each row execute function public.pv_eventos_despues();

-- ---------- Panel del punto (público, con su enlace) ----------
create or replace function public.pv_panel(p_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pv public.ticket_pv;
begin
  if not public.web_intento('pv_panel', 120, 10) then return jsonb_build_object('ok', false, 'motivo', 'demasiados_intentos'); end if;
  v_pv := public.pv_de_token(p_token);
  if v_pv.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  return jsonb_build_object('ok', true, 'punto', jsonb_build_object('nombre', v_pv.nombre, 'venta_directa', v_pv.venta_directa),
    'eventos', coalesce((select jsonb_agg(ev order by ev ->> 'fecha') from (
      select jsonb_build_object('id', e.id, 'nombre', e.nombre, 'fecha', e.fecha, 'inicio', e.inicio, 'recinto', e.recinto,
        'lotes', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'nombre', l.nombre, 'precio', l.precio, 'desde', l.desde, 'hasta', l.hasta, 'modo', l.modo,
                    'devolver_hasta', l.devolver_hasta, 'entregadas', l.hasta - l.desde + 1, 'registradas', public.pv_registradas(l),
                    'devueltas', public.pv_rangos_contar(l.devueltas), 'liquidado', l.vendidas_modo is not null) order by l.desde)
                  from public.ticket_pv_lotes l where l.evento_id = e.id and l.pv_id = v_pv.id), '[]'::jsonb),
        'tramos', case when v_pv.venta_directa then coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'nombre', t.nombre, 'precio', t.precio,
                    'disponibles', case when t.cantidad is null then null else greatest(t.cantidad - t.vendidas, 0) end) order by t.orden)
                  from public.ticket_web_tramos t where t.evento_id = e.id and coalesce(t.visible, true)), '[]'::jsonb) else '[]'::jsonb end,
        'directas', (select jsonb_build_object('entradas', count(*), 'total', coalesce(sum(x.precio), 0))
                       from public.ticket_web_entradas x join public.ticket_web_pedidos p on p.id = x.pedido_id
                      where p.evento_id = e.id and p.datos ->> 'pv_directa' = v_pv.id::text and x.estado = 'valida')) ev
        from public.ticket_eventos e
       where e.owner_id = v_pv.owner_id and e.borrado_en is null and coalesce(e.fecha, current_date) >= current_date - 1
         and (exists (select 1 from public.ticket_pv_lotes l where l.evento_id = e.id and l.pv_id = v_pv.id)
              or (v_pv.venta_directa and exists (select 1 from public.ticket_web_eventos f where f.evento_id = e.id and f.estado <> 'borrador')))) z), '[]'::jsonb));
end $$;
revoke all on function public.pv_panel(uuid) from public;
grant execute on function public.pv_panel(uuid) to anon, authenticated;

-- Escanear una entrada del talonario: «vender» (registra la venta), «deshacer» o «devolver» (la anula)
create or replace function public.pv_escanear(p_token uuid, p_hex text, p_accion text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pv public.ticket_pv; x record; l public.ticket_pv_lotes; e record; v_ini timestamptz;
begin
  if not public.web_intento('pv_escanear', 300, 10) then return jsonb_build_object('ok', false, 'motivo', 'demasiados_intentos'); end if;
  v_pv := public.pv_de_token(p_token);
  if v_pv.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  select * into x from public.pv_entrada_qr(v_pv.id, p_hex);
  if x.entrada_id is null then return jsonb_build_object('ok', false, 'motivo', 'no_es_tuya'); end if;
  if p_accion = 'vender' then
    if x.estado <> 'valida' then return jsonb_build_object('ok', false, 'motivo', 'devuelta', 'numero', x.numero); end if;
    if x.vendida is not null then return jsonb_build_object('ok', true, 'ya', true, 'numero', x.numero); end if;
    update public.ticket_web_entradas set pv_vendida_en = now() where id = x.entrada_id;
    return jsonb_build_object('ok', true, 'numero', x.numero);
  elsif p_accion = 'deshacer' then
    update public.ticket_web_entradas set pv_vendida_en = null where id = x.entrada_id;
    return jsonb_build_object('ok', true, 'numero', x.numero);
  elsif p_accion = 'devolver' then
    if x.estado <> 'valida' then return jsonb_build_object('ok', true, 'ya', true, 'numero', x.numero); end if;
    if x.vendida is not null then return jsonb_build_object('ok', false, 'motivo', 'registrada', 'numero', x.numero); end if;
    select * into e from public.ticket_eventos where id = x.evento_id;
    begin v_ini := coalesce(nullif(e.inicio, '')::timestamp, (e.fecha::text || ' 23:59')::timestamp) at time zone 'Europe/Madrid';
    exception when others then v_ini := null; end;
    if v_ini is not null and now() >= v_ini then return jsonb_build_object('ok', false, 'motivo', 'empezado'); end if;
    select * into l from public.ticket_pv_lotes where id = x.lote_id for update;
    begin
      update public.ticket_pv_lotes set devueltas = devueltas || jsonb_build_array(jsonb_build_array(x.numero, x.numero)) where id = l.id;
    exception when others then return jsonb_build_object('ok', false, 'motivo', 'no_se_puede', 'numero', x.numero); end;
    return jsonb_build_object('ok', true, 'numero', x.numero, 'devuelta', true);
  end if;
  return jsonb_build_object('ok', false, 'motivo', 'accion');
end $$;
revoke all on function public.pv_escanear(uuid, text, text) from public;
grant execute on function public.pv_escanear(uuid, text, text) to anon, authenticated;

-- «+1 vendida» / «−1» sin escanear (cuando no hay tiempo)
create or replace function public.pv_sumar(p_token uuid, p_lote uuid, p_delta int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pv public.ticket_pv; l public.ticket_pv_lotes;
begin
  if not public.web_intento('pv_sumar', 300, 10) then return jsonb_build_object('ok', false, 'motivo', 'demasiados_intentos'); end if;
  v_pv := public.pv_de_token(p_token);
  if v_pv.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  select * into l from public.ticket_pv_lotes where id = p_lote and pv_id = v_pv.id for update;
  if l.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if p_delta not in (-1, 1) then return jsonb_build_object('ok', false, 'motivo', 'accion'); end if;
  if p_delta > 0 and public.pv_registradas(l) >= l.hasta - l.desde + 1 then return jsonb_build_object('ok', false, 'motivo', 'todas'); end if;
  update public.ticket_pv_lotes set registradas_extra = greatest(registradas_extra + p_delta, 0) where id = l.id returning * into l;
  return jsonb_build_object('ok', true, 'registradas', public.pv_registradas(l));
end $$;
revoke all on function public.pv_sumar(uuid, uuid, int) from public;
grant execute on function public.pv_sumar(uuid, uuid, int) to anon, authenticated;

-- Venta directa al móvil: el punto cobra en efectivo y el comprador recibe la entrada en su correo
create or replace function public.pv_venta_directa(p_token uuid, p_tramo uuid, p_cantidad int, p_comprador jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pv public.ticket_pv; t record; e record; f record; v_nom text := btrim(coalesce(p_comprador ->> 'nombre', '')); v_email text := lower(btrim(coalesce(p_comprador ->> 'email', '')));
        v_ini timestamptz; v_num int; v_ped uuid; v_acc uuid; v_ent uuid; v_msg bytea; v_mac bytea; v_ver int; i int; v_prueba boolean;
begin
  if not public.web_intento('pv_vender', 60, 10) then return jsonb_build_object('ok', false, 'motivo', 'demasiados_intentos'); end if;
  v_pv := public.pv_de_token(p_token);
  if v_pv.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if not v_pv.venta_directa then return jsonb_build_object('ok', false, 'motivo', 'no_permitido'); end if;
  if coalesce(p_cantidad, 0) < 1 or p_cantidad > 10 then return jsonb_build_object('ok', false, 'motivo', 'cantidad'); end if;
  if length(v_nom) < 3 or length(v_nom) > 120 then return jsonb_build_object('ok', false, 'motivo', 'nombre'); end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 160 then return jsonb_build_object('ok', false, 'motivo', 'email'); end if;
  select * into t from public.ticket_web_tramos where id = p_tramo for update;
  if t.id is null then return jsonb_build_object('ok', false, 'motivo', 'tramo'); end if;
  select * into e from public.ticket_eventos where id = t.evento_id and owner_id = v_pv.owner_id;
  if e.id is null then return jsonb_build_object('ok', false, 'motivo', 'tramo'); end if;
  select * into f from public.ticket_web_eventos where evento_id = e.id for update;
  if f.evento_id is null or f.estado = 'borrador' then return jsonb_build_object('ok', false, 'motivo', 'sin_web'); end if;
  begin v_ini := coalesce(nullif(e.inicio, '')::timestamp, (e.fecha::text || ' 23:59')::timestamp) at time zone 'Europe/Madrid';
  exception when others then v_ini := null; end;
  if v_ini is not null and now() >= v_ini + interval '6 hours' then return jsonb_build_object('ok', false, 'motivo', 'pasado'); end if;
  if t.cantidad is not null and t.vendidas + p_cantidad > t.cantidad then return jsonb_build_object('ok', false, 'motivo', 'agotado', 'quedan', greatest(t.cantidad - t.vendidas, 0)); end if;
  if coalesce(e.qr_clave, '') = '' then update public.ticket_eventos set qr_clave = encode(extensions.gen_random_bytes(32), 'hex') where id = e.id returning * into e; end if;
  v_prueba := coalesce(f.modo, 'pruebas') = 'pruebas'; v_ver := case when v_prueba then 4 else 3 end;
  v_num := greatest(coalesce(f.contador, 0), coalesce((select max(hasta) from public.ticket_pv_lotes where evento_id = e.id), 0),
                    coalesce((select max(numero) from public.ticket_web_entradas where evento_id = e.id), 0));
  insert into public.ticket_web_pedidos (owner_id, evento_id, codigo, email, nombre, datos, total, estado, prueba)
  values (e.owner_id, e.id, upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8)), v_email, left(v_nom, 120),
          jsonb_build_object('pv_directa', v_pv.id, 'comision_tipo', v_pv.comision_tipo, 'comision_valor', v_pv.comision_valor), round(t.precio * p_cantidad, 2),
          case when v_prueba then 'prueba' else 'pagado' end, v_prueba)
  returning id, acceso into v_ped, v_acc;
  for i in 1 .. p_cantidad loop
    v_ent := gen_random_uuid();
    v_msg := set_byte('\x00'::bytea, 0, v_ver) || decode(replace(v_ent::text, '-', ''), 'hex') || '\x00'::bytea || '\x01'::bytea || decode(left(replace(t.id::text, '-', ''), 12), 'hex');
    v_mac := substring(extensions.hmac(v_msg, decode(e.qr_clave, 'hex'), 'sha256') from 1 for 8);
    insert into public.ticket_web_entradas (id, owner_id, evento_id, pedido_id, tramo_id, tramo_nombre, numero, asistente, precio, prueba, qr_hex)
    values (v_ent, e.owner_id, e.id, v_ped, t.id, t.nombre, v_num + i, left(v_nom, 120), t.precio, v_prueba, encode(v_msg || v_mac, 'hex'));
  end loop;
  update public.ticket_web_tramos set vendidas = vendidas + p_cantidad where id = t.id;
  update public.ticket_web_eventos set contador = v_num + p_cantidad where evento_id = e.id;
  insert into public.ticket_pv_eventos (owner_id, pv_id, evento_id) values (e.owner_id, v_pv.id, e.id) on conflict (pv_id, evento_id) do nothing;
  perform public.pv_sync_directas(v_pv.id, e.id);
  return jsonb_build_object('ok', true, 'acceso', v_acc, 'total', round(t.precio * p_cantidad, 2), 'prueba', v_prueba, 'desde', v_num + 1, 'hasta', v_num + p_cantidad);
end $$;
revoke all on function public.pv_venta_directa(uuid, uuid, int, jsonb) from public;
grant execute on function public.pv_venta_directa(uuid, uuid, int, jsonb) to anon, authenticated;

-- ---------- Organizador ----------
-- Estado en tiempo real de un evento: registradas por entrega y ventas directas por punto
create or replace function public.pv_estado_evento(p_evento uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'registradas', coalesce((select jsonb_object_agg(l.id, public.pv_registradas(l)) from public.ticket_pv_lotes l where l.evento_id = p_evento and l.owner_id = (select auth.uid())), '{}'::jsonb),
    'directas', coalesce((select jsonb_agg(jsonb_build_object('pv_id', z.pv, 'entradas', z.n, 'total', z.total, 'comision', z.com, 'pagado', coalesce(pe.pagado_directas, 0))) from (
        select (p.datos ->> 'pv_directa')::uuid pv, count(*) n, coalesce(sum(x.precio), 0) total,
               coalesce(sum(case when p.datos ->> 'comision_tipo' = 'pct' then round(x.precio * (p.datos ->> 'comision_valor')::numeric / 100, 2) else coalesce((p.datos ->> 'comision_valor')::numeric, 0) end), 0) com
          from public.ticket_web_entradas x join public.ticket_web_pedidos p on p.id = x.pedido_id
         where p.evento_id = p_evento and p.owner_id = (select auth.uid()) and p.datos ? 'pv_directa' and x.estado = 'valida'
         group by 1) z left join public.ticket_pv_eventos pe on pe.pv_id = z.pv and pe.evento_id = p_evento), '[]'::jsonb))
$$;
revoke all on function public.pv_estado_evento(uuid) from public, anon;
grant execute on function public.pv_estado_evento(uuid) to authenticated;

-- «Anular las no registradas» de un talonario con QR (solo a sabiendas): las que el punto no registró ni entraron se dan por devueltas
create or replace function public.pv_anular_no_registradas(p_lote uuid, p_forzar boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.ticket_pv_lotes; v_rangos jsonb;
begin
  select * into l from public.ticket_pv_lotes where id = p_lote and owner_id = (select auth.uid()) for update;
  if l.id is null or l.modo <> 'qr' then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  -- Las sumadas con «+1» no tienen número: anularlas a ciegas podría dejar fuera a alguien que pagó
  if coalesce(l.registradas_extra, 0) > 0 and not p_forzar then return jsonb_build_object('ok', false, 'motivo', 'sin_numero', 'sin_numero', l.registradas_extra); end if;
  with libres as (
    select x.numero from public.ticket_web_entradas x
     where x.pedido_id = l.pedido_id and x.pv_vendida_en is null
       and not exists (select 1 from public.ticket_canjes c where c.venta_uuid = x.id)),
  grupos as (select numero, numero - row_number() over (order by numero) g from libres)
  select coalesce(jsonb_agg(jsonb_build_array(a, b) order by a), '[]'::jsonb) into v_rangos
    from (select min(numero) a, max(numero) b from grupos group by g) r;
  update public.ticket_pv_lotes set devueltas = v_rangos, vendidas_modo = 'devueltas' where id = l.id;
  return jsonb_build_object('ok', true, 'devueltas', public.pv_rangos_contar(v_rangos));
end $$;
revoke all on function public.pv_anular_no_registradas(uuid, boolean) from public, anon;
grant execute on function public.pv_anular_no_registradas(uuid, boolean) to authenticated;

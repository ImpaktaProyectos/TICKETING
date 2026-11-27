-- ===================== PUNTOS DE VENTA FÍSICOS (tiendas, bares… a los que se dejan entradas) =====================
-- Va después de 20261127120000_ticket_recuperacion_entradas.sql.
-- · ticket_pv: los puntos de venta del organizador (sirven para todos sus eventos), con su comisión por defecto.
-- · ticket_pv_lotes: cada entrega de entradas a un punto en un evento: de la nº «desde» a la nº «hasta», precio y comisión
--   (en € por entrada o en %, editable siempre). Liquidación: vendidas (cantidad) o devueltas (rangos de números).
--   Modo «manual»: talonario propio del organizador (solo se apuntan los números).
--   Modo «qr»: talonario generado por TIXFAST. Cada entrada es una entrada real con QR (se valida en la puerta con el
--   escáner de siempre). Sus números salen del contador del evento (nunca chocan con la venta online). Las devueltas
--   se anulan al momento; una entrada ya usada en la puerta no se puede devolver.
-- · Cada entrega pasa sola al CRM del evento: venta completa como ingreso y comisión del punto como gasto.
-- Solo añade tablas, columnas y funciones.

-- Pedidos y CRM aceptan el nuevo origen
alter table public.ticket_web_pedidos drop constraint if exists ticket_web_pedidos_estado_check;
alter table public.ticket_web_pedidos add constraint ticket_web_pedidos_estado_check
  check (estado in ('prueba', 'gratis', 'pendiente', 'pagado', 'anulado', 'invitacion', 'punto_venta'));
alter table public.ticket_crm_ingresos drop constraint if exists ticket_crm_ingresos_origen_check;
alter table public.ticket_crm_ingresos add constraint ticket_crm_ingresos_origen_check check (origen in ('manual', 'csv', 'api', 'tixfast', 'pv'));

-- ---------- Puntos de venta ----------
create table if not exists public.ticket_pv (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre text not null check (length(btrim(nombre)) between 1 and 120),
  contacto text check (length(contacto) <= 120), telefono text check (length(telefono) <= 40), email text check (length(email) <= 160),
  direccion text check (length(direccion) <= 200), notas text check (length(notas) <= 1000),
  comision_tipo text not null default 'fija' check (comision_tipo in ('fija', 'pct')),
  comision_valor numeric(8,2) not null default 0 check (comision_valor >= 0 and comision_valor <= 10000),
  activo boolean not null default true,
  creado_en timestamptz not null default now(), actualizado_en timestamptz not null default now()
);
create index if not exists ticket_pv_owner on public.ticket_pv (owner_id, nombre);
alter table public.ticket_pv enable row level security;
drop policy if exists pv_propios on public.ticket_pv;
create policy pv_propios on public.ticket_pv for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
grant select, insert, update, delete on public.ticket_pv to authenticated;

-- ---------- Entregas (lotes) ----------
create table if not exists public.ticket_pv_lotes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  evento_id uuid not null references public.ticket_eventos(id) on delete cascade,
  pv_id uuid not null references public.ticket_pv(id) on delete restrict,
  nombre text not null default 'Entrada' check (length(btrim(nombre)) between 1 and 80),   -- tipo de entrada
  precio numeric(8,2) not null check (precio >= 0 and precio <= 100000),
  comision_tipo text not null default 'fija' check (comision_tipo in ('fija', 'pct')),
  comision_valor numeric(8,2) not null default 0 check (comision_valor >= 0 and comision_valor <= 10000),
  modo text not null default 'manual' check (modo in ('manual', 'qr')),
  desde int not null check (desde >= 0), hasta int not null,
  entregado_en date not null default current_date,
  vendidas_modo text check (vendidas_modo in ('cantidad', 'devueltas')),   -- vacío = aún sin liquidar
  vendidas int check (vendidas >= 0),
  devueltas jsonb not null default '[]'::jsonb check (jsonb_typeof(devueltas) = 'array'),
  pagado numeric(10,2) not null default 0 check (pagado >= 0),
  notas text check (length(notas) <= 1000),
  pedido_id uuid references public.ticket_web_pedidos(id) on delete set null,   -- solo en modo «qr»
  creado_en timestamptz not null default now(), actualizado_en timestamptz not null default now(),
  check (hasta >= desde and hasta - desde < 5000)
);
create index if not exists ticket_pv_lotes_evento on public.ticket_pv_lotes (evento_id, desde);
create index if not exists ticket_pv_lotes_pv on public.ticket_pv_lotes (pv_id);
alter table public.ticket_pv_lotes enable row level security;
drop policy if exists pv_lotes_propios on public.ticket_pv_lotes;
create policy pv_lotes_propios on public.ticket_pv_lotes for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
grant select, insert, update, delete on public.ticket_pv_lotes to authenticated;

-- ---------- Cálculo (mismas reglas que crm/pvCalc.js) ----------
create or replace function public.pv_rangos_contar(p jsonb)
returns int language sql immutable set search_path = '' as $$
  select coalesce(sum(greatest((r ->> 1)::int - (r ->> 0)::int + 1, 0)), 0)::int from jsonb_array_elements(coalesce(p, '[]'::jsonb)) r
$$;
create or replace function public.pv_resumen(l public.ticket_pv_lotes)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_ent int := l.hasta - l.desde + 1; v_vend int; v_total numeric; v_com numeric;
begin
  v_vend := case when l.vendidas_modo = 'devueltas' then v_ent - public.pv_rangos_contar(l.devueltas)
                 when l.vendidas_modo = 'cantidad' then least(v_ent, greatest(coalesce(l.vendidas, 0), 0)) else 0 end;
  v_vend := greatest(v_vend, 0);
  v_total := round(v_vend * l.precio, 2);
  v_com := case when l.comision_tipo = 'pct' then round(v_total * l.comision_valor / 100, 2) else round(v_vend * l.comision_valor, 2) end;
  return jsonb_build_object('entregadas', v_ent, 'vendidas', v_vend, 'total', v_total, 'comision', v_com, 'a_entregar', v_total - v_com,
                            'pendiente', greatest(v_total - v_com - l.pagado, 0), 'liquidado', l.vendidas_modo is not null);
end $$;

-- ---------- Reglas al guardar una entrega ----------
create or replace function public.pv_lote_antes() returns trigger language plpgsql security definer set search_path = '' as $$
declare r jsonb; x record; v_pv record;
begin
  if tg_op = 'DELETE' then
    if old.modo = 'qr' and old.pedido_id is not null then
      if exists (select 1 from public.ticket_canjes c join public.ticket_web_entradas e on e.id = c.venta_uuid where e.pedido_id = old.pedido_id) then
        raise exception 'Este talonario tiene entradas ya usadas en la puerta: no se puede borrar' using errcode = 'P0001';
      end if;
      update public.ticket_web_entradas set estado = 'anulada' where pedido_id = old.pedido_id and estado = 'valida';
      update public.ticket_web_pedidos set estado = 'anulado' where id = old.pedido_id;
    end if;
    return old;
  end if;
  select * into v_pv from public.ticket_pv where id = new.pv_id;
  if v_pv.id is null or v_pv.owner_id <> new.owner_id then raise exception 'Punto de venta no válido' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.ticket_eventos e where e.id = new.evento_id and e.owner_id = new.owner_id) then raise exception 'Evento no válido' using errcode = 'P0001'; end if;
  if tg_op = 'INSERT' and new.modo = 'qr' and coalesce(current_setting('tixfast.pv_talonario', true), '') <> 'si' then
    raise exception 'Los talonarios con QR se crean con «Generar talonario»' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and old.modo = 'qr' and (new.modo <> 'qr' or new.desde <> old.desde or new.hasta <> old.hasta or new.pedido_id is distinct from old.pedido_id or new.evento_id <> old.evento_id) then
    raise exception 'En un talonario con QR no se pueden cambiar los números' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and old.modo = 'manual' and new.modo = 'qr' then raise exception 'No se puede convertir en talonario con QR' using errcode = 'P0001'; end if;
  -- Numeración sin solapes dentro del evento
  if exists (select 1 from public.ticket_pv_lotes o where o.evento_id = new.evento_id and o.id <> new.id and o.desde <= new.hasta and new.desde <= o.hasta) then
    raise exception 'Esa numeración (% - %) ya está entregada a otro punto en este evento', new.desde, new.hasta using errcode = 'P0001';
  end if;
  -- Devueltas: ordenadas y dentro de la entrega
  for r in select * from jsonb_array_elements(new.devueltas) loop
    if jsonb_typeof(r) <> 'array' or (r ->> 0)::int > (r ->> 1)::int or (r ->> 0)::int < new.desde or (r ->> 1)::int > new.hasta then
      raise exception 'Hay números devueltos fuera de la entrega (% - %)', new.desde, new.hasta using errcode = 'P0001';
    end if;
  end loop;
  if new.modo = 'qr' and new.vendidas_modo = 'cantidad' then
    raise exception 'En un talonario con QR se liquida indicando los números devueltos (así se anulan)' using errcode = 'P0001';
  end if;
  -- Talonario con QR: las devueltas se anulan y las demás vuelven a valer (si se corrige un rango)
  if new.modo = 'qr' and new.pedido_id is not null and (tg_op = 'INSERT' or new.devueltas is distinct from old.devueltas) then
    for x in select e.numero from public.ticket_web_entradas e join public.ticket_canjes c on c.venta_uuid = e.id
              where e.pedido_id = new.pedido_id
                and exists (select 1 from jsonb_array_elements(new.devueltas) d where e.numero between (d ->> 0)::int and (d ->> 1)::int) loop
      raise exception 'La entrada nº % ya se usó en la puerta: no se puede marcar como devuelta', x.numero using errcode = 'P0001';
    end loop;
    update public.ticket_web_entradas e set estado = case when exists (select 1 from jsonb_array_elements(new.devueltas) d where e.numero between (d ->> 0)::int and (d ->> 1)::int) then 'anulada' else 'valida' end
     where e.pedido_id = new.pedido_id;
  end if;
  new.actualizado_en := now();
  return new;
end $$;
revoke all on function public.pv_lote_antes() from public, anon, authenticated;
drop trigger if exists pv_lote_antes on public.ticket_pv_lotes;
create trigger pv_lote_antes before insert or update or delete on public.ticket_pv_lotes for each row execute function public.pv_lote_antes();

-- ---------- Paso al CRM del evento ----------
create or replace function public.pv_sync_crm(p_lote uuid, p_evento uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare l public.ticket_pv_lotes; v jsonb; v_pv record; v_ref text := 'pv:' || p_lote::text;
begin
  select * into l from public.ticket_pv_lotes where id = p_lote;
  delete from public.ticket_crm_gastos where evento_id = p_evento and nota = v_ref;
  if l.id is null then
    delete from public.ticket_crm_ingresos where evento_id = p_evento and ref_externa = v_ref;
    return;
  end if;
  v := public.pv_resumen(l);
  select * into v_pv from public.ticket_pv where id = l.pv_id;
  if (v ->> 'vendidas')::int <= 0 then
    delete from public.ticket_crm_ingresos where evento_id = l.evento_id and ref_externa = v_ref;
    return;
  end if;
  insert into public.ticket_crm_ingresos (owner_id, evento_id, categoria, concepto, importe, fecha, metodo, estado, origen, ref_externa, unidades, canal, nota, actualizado_en)
  values (l.owner_id, l.evento_id, 'Otras ticketeras', left(format('Punto de venta · %s · %s', v_pv.nombre, l.nombre), 160), (v ->> 'total')::numeric, l.entregado_en,
          'efectivo', case when (v ->> 'pendiente')::numeric <= 0 then 'cobrado' else 'pendiente' end, 'pv', v_ref, (v ->> 'vendidas')::int,
          left(v_pv.nombre, 60), left(format('Nº %s-%s · comisión %s €', l.desde, l.hasta, v ->> 'comision'), 500), now())
  on conflict (evento_id, ref_externa) do update set concepto = excluded.concepto, importe = excluded.importe, estado = excluded.estado, unidades = excluded.unidades,
    canal = excluded.canal, nota = excluded.nota, fecha = excluded.fecha, actualizado_en = now();
  if (v ->> 'comision')::numeric > 0 then
    insert into public.ticket_crm_gastos (owner_id, evento_id, tipo, categoria, concepto, proveedor, previsto, real, estado, fecha, nota)
    values (l.owner_id, l.evento_id, 'normal', 'Ticketing y pagos', left(format('Comisión punto de venta · %s', v_pv.nombre), 160), left(v_pv.nombre, 120),
            (v ->> 'comision')::numeric, (v ->> 'comision')::numeric, 'pagado', l.entregado_en, v_ref);
  end if;
end $$;
revoke all on function public.pv_sync_crm(uuid, uuid) from public, anon, authenticated;
create or replace function public.pv_lote_despues() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then perform public.pv_sync_crm(old.id, old.evento_id); return old; end if;
  perform public.pv_sync_crm(new.id, new.evento_id);
  return new;
end $$;
revoke all on function public.pv_lote_despues() from public, anon, authenticated;
drop trigger if exists pv_lote_despues on public.ticket_pv_lotes;
create trigger pv_lote_despues after insert or update or delete on public.ticket_pv_lotes for each row execute function public.pv_lote_despues();
-- Si cambia el nombre del punto, se actualiza en el CRM
create or replace function public.pv_despues() returns trigger language plpgsql security definer set search_path = '' as $$
declare l record;
begin
  if new.nombre is distinct from old.nombre then
    for l in select id, evento_id from public.ticket_pv_lotes where pv_id = new.id loop perform public.pv_sync_crm(l.id, l.evento_id); end loop;
  end if;
  return new;
end $$;
revoke all on function public.pv_despues() from public, anon, authenticated;
drop trigger if exists pv_despues on public.ticket_pv;
create trigger pv_despues after update on public.ticket_pv for each row execute function public.pv_despues();

-- ---------- Talonario con QR (lo genera TIXFAST) ----------
create or replace function public.pv_crear_talonario(p_evento uuid, p_pv uuid, p_nombre text, p_precio numeric, p_cantidad int,
                                                    p_comision_tipo text, p_comision_valor numeric, p_notas text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); e record; f record; v_pv record; v_ini int; v_ver int; v_ped uuid; v_ent uuid; v_msg bytea; v_mac bytea; i int; v_lote uuid; v_prueba boolean;
begin
  if uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if coalesce(p_cantidad, 0) < 1 or p_cantidad > 2000 then return jsonb_build_object('ok', false, 'motivo', 'cantidad'); end if;
  if coalesce(p_precio, -1) < 0 then return jsonb_build_object('ok', false, 'motivo', 'precio'); end if;
  select * into e from public.ticket_eventos where id = p_evento and owner_id = uid;
  if e.id is null then return jsonb_build_object('ok', false, 'motivo', 'evento'); end if;
  select * into v_pv from public.ticket_pv where id = p_pv and owner_id = uid;
  if v_pv.id is null then return jsonb_build_object('ok', false, 'motivo', 'punto'); end if;
  select * into f from public.ticket_web_eventos where evento_id = p_evento for update;
  if f.evento_id is null then return jsonb_build_object('ok', false, 'motivo', 'sin_web'); end if;
  if coalesce(e.qr_clave, '') = '' then
    update public.ticket_eventos set qr_clave = encode(extensions.gen_random_bytes(32), 'hex') where id = e.id returning * into e;
  end if;
  v_prueba := coalesce(f.modo, 'pruebas') = 'pruebas';
  v_ver := case when v_prueba then 4 else 3 end;
  -- Números libres: después de la venta online y de cualquier otra entrega del evento
  v_ini := greatest(coalesce(f.contador, 0), coalesce((select max(hasta) from public.ticket_pv_lotes where evento_id = p_evento), 0),
                    coalesce((select max(numero) from public.ticket_web_entradas where evento_id = p_evento), 0));
  insert into public.ticket_web_pedidos (owner_id, evento_id, codigo, email, nombre, datos, total, estado, prueba)
  values (uid, p_evento, upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8)), 'punto-de-venta@tixfast.invalid', left(v_pv.nombre, 120),
          jsonb_build_object('punto_venta', v_pv.id), 0, 'punto_venta', v_prueba)
  returning id into v_ped;
  for i in 1 .. p_cantidad loop
    v_ent := gen_random_uuid();
    v_msg := set_byte('\x00'::bytea, 0, v_ver) || decode(replace(v_ent::text, '-', ''), 'hex') || '\x00'::bytea || '\x01'::bytea || decode('000000000000', 'hex');
    v_mac := substring(extensions.hmac(v_msg, decode(e.qr_clave, 'hex'), 'sha256') from 1 for 8);
    insert into public.ticket_web_entradas (id, owner_id, evento_id, pedido_id, tramo_id, tramo_nombre, numero, asistente, precio, prueba, qr_hex)
    values (v_ent, uid, p_evento, v_ped, null, left(coalesce(nullif(btrim(p_nombre), ''), 'Entrada'), 80), v_ini + i, left('Punto de venta · ' || v_pv.nombre, 120),
            round(p_precio, 2), v_prueba, encode(v_msg || v_mac, 'hex'));
  end loop;
  update public.ticket_web_eventos set contador = v_ini + p_cantidad where evento_id = p_evento;
  perform set_config('tixfast.pv_talonario', 'si', true);
  insert into public.ticket_pv_lotes (owner_id, evento_id, pv_id, nombre, precio, comision_tipo, comision_valor, modo, desde, hasta, notas, pedido_id)
  values (uid, p_evento, p_pv, left(coalesce(nullif(btrim(p_nombre), ''), 'Entrada'), 80), round(p_precio, 2),
          case when p_comision_tipo = 'pct' then 'pct' else 'fija' end, greatest(coalesce(p_comision_valor, 0), 0), 'qr', v_ini + 1, v_ini + p_cantidad,
          nullif(left(btrim(coalesce(p_notas, '')), 1000), ''), v_ped)
  returning id into v_lote;
  perform set_config('tixfast.pv_talonario', '', true);
  return jsonb_build_object('ok', true, 'lote', v_lote, 'desde', v_ini + 1, 'hasta', v_ini + p_cantidad, 'prueba', v_prueba);
end $$;
revoke all on function public.pv_crear_talonario(uuid, uuid, text, numeric, int, text, numeric, text) from public, anon;
grant execute on function public.pv_crear_talonario(uuid, uuid, text, numeric, int, text, numeric, text) to authenticated;

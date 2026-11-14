-- ===================== RRPP · fase 1 (sin pasarela) =====================
-- Relaciones públicas con su enlace de venta, ventas en efectivo, comisión configurable por evento
-- y liquidación marcada a mano. Solo añade: tablas nuevas, columnas nuevas y dos parches mínimos.

-- ---------- Tablas ----------
create table if not exists public.ticket_rrpp (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  nombre text not null check (char_length(btrim(nombre)) between 1 and 60),
  telefono text check (telefono is null or char_length(telefono) <= 30),
  email text check (email is null or char_length(email) <= 160),
  codigo text not null check (codigo ~ '^[A-Z0-9]{3,16}$'),
  acceso uuid not null default gen_random_uuid() unique,       -- su enlace personal al panel (/rp/<acceso>)
  todos_eventos boolean not null default true,                 -- vende en todos los eventos salvo los que se le quiten
  activo boolean not null default true,
  nota text check (nota is null or char_length(nota) <= 500),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (owner_id, codigo)
);
create index if not exists ticket_rrpp_owner_idx on public.ticket_rrpp (owner_id);

-- Comisión del evento (la misma para todos los RRPP salvo que se cambie para uno)
create table if not exists public.ticket_rrpp_config (
  evento_id uuid primary key references public.ticket_eventos(id) on delete cascade,
  owner_id uuid not null default auth.uid(),
  tipo text not null default 'fija' check (tipo in ('fija', 'porcentaje', 'tramos')),
  valor numeric not null default 0 check (valor >= 0 and valor <= 100000),
  tramos jsonb not null default '{}'::jsonb check (jsonb_typeof(tramos) = 'object' and pg_column_size(tramos) < 8000),
  efectivo boolean not null default true,                      -- los RRPP pueden vender en efectivo
  actualizado_en timestamptz not null default now()
);
create index if not exists ticket_rrpp_config_owner_idx on public.ticket_rrpp_config (owner_id);

-- RRPP en un evento: si vende y, si se quiere, su propia comisión
create table if not exists public.ticket_rrpp_eventos (
  evento_id uuid not null references public.ticket_eventos(id) on delete cascade,
  rrpp_id uuid not null references public.ticket_rrpp(id) on delete cascade,
  owner_id uuid not null default auth.uid(),
  activo boolean not null default true,
  tipo text check (tipo is null or tipo in ('fija', 'porcentaje', 'tramos')),   -- null = la del evento
  valor numeric check (valor is null or (valor >= 0 and valor <= 100000)),
  tramos jsonb check (tramos is null or (jsonb_typeof(tramos) = 'object' and pg_column_size(tramos) < 8000)),
  actualizado_en timestamptz not null default now(),
  primary key (evento_id, rrpp_id)
);
create index if not exists ticket_rrpp_eventos_owner_idx on public.ticket_rrpp_eventos (owner_id);
create index if not exists ticket_rrpp_eventos_rrpp_idx on public.ticket_rrpp_eventos (rrpp_id);

-- Liquidación de un RRPP en un evento (fase 1: pagada o cobrada fuera de la app)
create table if not exists public.ticket_rrpp_liquidaciones (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  evento_id uuid not null references public.ticket_eventos(id) on delete cascade,
  rrpp_id uuid not null references public.ticket_rrpp(id) on delete cascade,
  entradas int not null default 0,
  comision numeric not null default 0,
  efectivo numeric not null default 0,                         -- lo que cobró él en efectivo (se le descuenta)
  resultado numeric not null default 0,                        -- > 0 se le paga · < 0 lo debe él
  metodo text check (metodo is null or metodo in ('bizum', 'transferencia', 'efectivo', 'otro')),
  nota text check (nota is null or char_length(nota) <= 500),
  gasto_id uuid references public.ticket_crm_gastos(id) on delete set null,
  cerrada_en timestamptz not null default now(),
  unique (evento_id, rrpp_id)
);
create index if not exists ticket_rrpp_liq_owner_idx on public.ticket_rrpp_liquidaciones (owner_id);
create index if not exists ticket_rrpp_liq_rrpp_idx on public.ticket_rrpp_liquidaciones (rrpp_id);
create index if not exists ticket_rrpp_liq_gasto_idx on public.ticket_rrpp_liquidaciones (gasto_id);

-- Ventas atribuidas
alter table public.ticket_web_pedidos add column if not exists rrpp_id uuid references public.ticket_rrpp(id) on delete set null;
alter table public.ticket_web_pedidos add column if not exists rrpp_efectivo boolean not null default false;
alter table public.ticket_web_entradas add column if not exists rrpp_id uuid references public.ticket_rrpp(id) on delete set null;
create index if not exists ticket_web_pedidos_rrpp_idx on public.ticket_web_pedidos (rrpp_id, creado_en desc) where rrpp_id is not null;
create index if not exists ticket_web_entradas_rrpp_idx on public.ticket_web_entradas (evento_id, rrpp_id) where rrpp_id is not null;
create index if not exists ticket_web_entradas_rrpp_fk_idx on public.ticket_web_entradas (rrpp_id) where rrpp_id is not null;

-- ---------- Seguridad: cada organizador solo ve lo suyo ----------
alter table public.ticket_rrpp enable row level security;
alter table public.ticket_rrpp_config enable row level security;
alter table public.ticket_rrpp_eventos enable row level security;
alter table public.ticket_rrpp_liquidaciones enable row level security;
do $$ declare t text; begin
  foreach t in array array['ticket_rrpp', 'ticket_rrpp_config', 'ticket_rrpp_eventos', 'ticket_rrpp_liquidaciones'] loop
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format('create policy owner_all on public.%I for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------- Comisión de una entrada ----------
create or replace function public.rrpp_comision(p_evento uuid, p_rrpp uuid, p_tramo uuid, p_precio numeric)
returns numeric language sql stable set search_path = '' as $$
  with o as (select tipo, valor, tramos from public.ticket_rrpp_eventos where evento_id = p_evento and rrpp_id = p_rrpp and tipo is not null),
       c as (select tipo, valor, tramos from public.ticket_rrpp_config where evento_id = p_evento),
       r as (select * from o union all select * from c where not exists (select 1 from o) limit 1)
  select coalesce((select case r.tipo
      when 'fija' then r.valor
      when 'porcentaje' then round(coalesce(p_precio, 0) * r.valor / 100, 2)
      else coalesce(nullif(r.tramos ->> p_tramo::text, '')::numeric, 0) end from r), 0)
$$;

-- ¿El RRPP vende en este evento?
create or replace function public.rrpp_en_evento(p_rrpp uuid, p_evento uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.ticket_rrpp r where r.id = p_rrpp and r.activo
    and coalesce((select e.activo from public.ticket_rrpp_eventos e where e.evento_id = p_evento and e.rrpp_id = r.id), r.todos_eventos))
$$;

-- ---------- Atribuir un pedido a un RRPP (lo llama web_comprar) ----------
create or replace function public.rrpp_atribuir(p_pedido uuid, p_evento uuid, p_owner uuid, p_codigo text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_rrpp uuid; v_efectivo boolean := false; v_venta text := coalesce(current_setting('tixfast.rrpp_venta', true), ''); t uuid;
begin
  if v_venta <> '' then
    v_rrpp := v_venta::uuid; v_efectivo := true;
  elsif coalesce(btrim(p_codigo), '') <> '' then
    select id into v_rrpp from public.ticket_rrpp where owner_id = p_owner and codigo = upper(btrim(p_codigo));
  end if;
  if v_rrpp is null or not public.rrpp_en_evento(v_rrpp, p_evento) then return; end if;
  update public.ticket_web_pedidos set rrpp_id = v_rrpp, rrpp_efectivo = v_efectivo,
         estado = case when v_efectivo and estado = 'gratis' and total > 0 then 'pagado' else estado end
   where id = p_pedido and owner_id = p_owner;
  update public.ticket_web_entradas set rrpp_id = v_rrpp where pedido_id = p_pedido and owner_id = p_owner;
  if v_efectivo then
    for t in select distinct tramo_id from public.ticket_web_entradas where pedido_id = p_pedido loop
      perform public.web_sync_ingreso(p_evento, t);
    end loop;
  end if;
end $$;
revoke all on function public.rrpp_atribuir(uuid, uuid, uuid, text) from public, anon, authenticated;

-- ---------- Parches mínimos en web_comprar ----------
-- 1) Tras emitir las entradas, se atribuyen al RRPP (código en p_comprador.rrpp).
-- 2) Solo dentro de una venta en efectivo de un RRPP (marca interna, imposible de poner desde la web):
--    se permite emitir tramos de pago (el RRPP ya cobró) y no se aplica el límite por IP.
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.web_comprar(text, jsonb, jsonb, jsonb)'::regprocedure);
  if position('rrpp_atribuir' in d) > 0 then return; end if;
  n := replace(d, '  update public.ticket_web_tramos x set vendidas',
    '  perform public.rrpp_atribuir(v_pedido, f.evento_id, f.owner_id, p_comprador ->> ''rrpp'');' || chr(10) || '  update public.ticket_web_tramos x set vendidas');
  n := replace(n, 'if t.precio > 0 and not v_prueba then',
    'if t.precio > 0 and not v_prueba and coalesce(current_setting(''tixfast.rrpp_venta'', true), '''') = '''' then');
  n := replace(n, '  if v_ip <> '''' then',
    '  if v_ip <> '''' and coalesce(current_setting(''tixfast.rrpp_venta'', true), '''') = '''' then');
  if n = d or position('rrpp_atribuir' in n) = 0 or position('tixfast.rrpp_venta'', true), '''') = '''' then' in n) = 0 then
    raise exception 'No se ha podido parchear web_comprar';
  end if;
  execute n;
end $$;

-- ---------- Ingresos del CRM: las entradas vendidas en efectivo por RRPP van aparte, como efectivo ----------
create or replace function public.web_sync_ingreso(p_evento uuid, p_tramo uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_n int; v_imp numeric; v_nom text; v_fecha date; v_owner uuid; v_ref text := 'tx:' || p_tramo::text; v_ref_e text := 'txe:' || p_tramo::text;
begin
  if p_tramo is null then return; end if;
  select coalesce(t.nombre, (select max(tramo_nombre) from public.ticket_web_entradas where evento_id = p_evento and tramo_id = p_tramo)) into v_nom
    from (select 1) z left join public.ticket_web_tramos t on t.id = p_tramo;
  -- Venta online (como hasta ahora, sin las ventas en efectivo de RRPP)
  select count(*), coalesce(sum(x.precio), 0), max(x.creado_en)::date, max(x.owner_id::text)::uuid into v_n, v_imp, v_fecha, v_owner
    from public.ticket_web_entradas x left join public.ticket_web_pedidos p on p.id = x.pedido_id
   where x.evento_id = p_evento and x.tramo_id = p_tramo and x.estado = 'valida' and not x.prueba and not coalesce(p.rrpp_efectivo, false);
  if v_n = 0 then
    delete from public.ticket_crm_ingresos where evento_id = p_evento and ref_externa = v_ref and origen = 'tixfast';
  else
    insert into public.ticket_crm_ingresos (owner_id, evento_id, categoria, concepto, importe, fecha, metodo, estado, origen, ref_externa, unidades, actualizado_en)
    values (v_owner, p_evento, 'Ticketera online', left('TIXFAST · ' || v_nom, 160), v_imp, coalesce(v_fecha, current_date), 'tarjeta', 'cobrado', 'tixfast', v_ref, v_n, now())
    on conflict (evento_id, ref_externa) do update set importe = excluded.importe, unidades = excluded.unidades, concepto = excluded.concepto, fecha = excluded.fecha, actualizado_en = now();
  end if;
  -- Venta en efectivo de RRPP
  select count(*), coalesce(sum(x.precio), 0), max(x.creado_en)::date, max(x.owner_id::text)::uuid into v_n, v_imp, v_fecha, v_owner
    from public.ticket_web_entradas x join public.ticket_web_pedidos p on p.id = x.pedido_id
   where x.evento_id = p_evento and x.tramo_id = p_tramo and x.estado = 'valida' and not x.prueba and p.rrpp_efectivo;
  if v_n = 0 then
    delete from public.ticket_crm_ingresos where evento_id = p_evento and ref_externa = v_ref_e and origen = 'tixfast';
  else
    insert into public.ticket_crm_ingresos (owner_id, evento_id, categoria, concepto, importe, fecha, metodo, estado, origen, ref_externa, unidades, actualizado_en)
    values (v_owner, p_evento, 'Ticketera online', left('TIXFAST · ' || v_nom || ' · efectivo RRPP', 160), v_imp, coalesce(v_fecha, current_date), 'efectivo', 'cobrado', 'tixfast', v_ref_e, v_n, now())
    on conflict (evento_id, ref_externa) do update set importe = excluded.importe, unidades = excluded.unidades, concepto = excluded.concepto, fecha = excluded.fecha, actualizado_en = now();
  end if;
end $$;

-- ---------- Panel del RRPP (enlace personal, sin cuenta) ----------
create or replace function public.rrpp_panel(p_acceso uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r record; v_org text; v_eventos jsonb; v_ventas jsonb;
begin
  select * into r from public.ticket_rrpp where acceso = p_acceso and activo;
  if r.id is null then return null; end if;
  select coalesce((select o.nombre from public.ticket_web_organizaciones o where o.owner_id = r.owner_id order by o.creado_en limit 1),
                  (select l.razon_social from public.ticket_web_legal l where l.owner_id = r.owner_id), 'Organizador') into v_org;

  select coalesce(jsonb_agg(x order by x ->> 'fecha'), '[]'::jsonb) into v_eventos from (
    select jsonb_build_object(
      'id', e.id, 'nombre', e.nombre, 'fecha', e.fecha, 'inicio', e.inicio, 'recinto', e.recinto,
      'slug', w.slug, 'estado', w.estado, 'modo', w.modo, 'edad_minima', w.edad_minima,
      'formulario', coalesce(w.formulario, '{}'::jsonb),
      'efectivo', coalesce(c.efectivo, true),
      'comision', jsonb_build_object('tipo', coalesce(o.tipo, c.tipo, 'fija'), 'valor', coalesce(case when o.tipo is not null then o.valor end, c.valor, 0),
                                     'tramos', coalesce(case when o.tipo is not null then o.tramos end, c.tramos, '{}'::jsonb)),
      'tramos', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'nombre', t.nombre, 'precio', t.precio, 'estado', s.estado,
                   'quedan', case when t.cantidad is null then null else greatest(t.cantidad - t.vendidas, 0) end, 'max', t.max_por_compra) order by t.orden, t.precio), '[]'::jsonb)
                 from public.ticket_web_tramos t join public.web_tramos_estado(e.id) s on s.id = t.id where t.evento_id = e.id and t.visible),
      'online', (select count(*) from public.ticket_web_entradas x join public.ticket_web_pedidos p on p.id = x.pedido_id
                  where x.evento_id = e.id and x.rrpp_id = r.id and x.estado = 'valida' and not x.prueba and not p.rrpp_efectivo),
      'efectivo_n', (select count(*) from public.ticket_web_entradas x join public.ticket_web_pedidos p on p.id = x.pedido_id
                  where x.evento_id = e.id and x.rrpp_id = r.id and x.estado = 'valida' and not x.prueba and p.rrpp_efectivo),
      'efectivo_importe', (select coalesce(sum(x.precio), 0) from public.ticket_web_entradas x join public.ticket_web_pedidos p on p.id = x.pedido_id
                  where x.evento_id = e.id and x.rrpp_id = r.id and x.estado = 'valida' and not x.prueba and p.rrpp_efectivo),
      'pruebas', (select count(*) from public.ticket_web_entradas x where x.evento_id = e.id and x.rrpp_id = r.id and x.estado = 'valida' and x.prueba),
      'comision_total', (select coalesce(sum(public.rrpp_comision(e.id, r.id, x.tramo_id, x.precio)), 0) from public.ticket_web_entradas x
                  where x.evento_id = e.id and x.rrpp_id = r.id and x.estado = 'valida' and not x.prueba),
      'liquidacion', (select jsonb_build_object('entradas', l.entradas, 'comision', l.comision, 'efectivo', l.efectivo, 'resultado', l.resultado, 'metodo', l.metodo, 'cerrada_en', l.cerrada_en)
                  from public.ticket_rrpp_liquidaciones l where l.evento_id = e.id and l.rrpp_id = r.id)
    ) x
    from public.ticket_web_eventos w join public.ticket_eventos e on e.id = w.evento_id
    left join public.ticket_rrpp_config c on c.evento_id = e.id
    left join public.ticket_rrpp_eventos o on o.evento_id = e.id and o.rrpp_id = r.id
    where w.owner_id = r.owner_id and w.estado <> 'borrador' and public.rrpp_en_evento(r.id, e.id)
      and (e.fecha is null or e.fecha >= current_date - 45
           or exists (select 1 from public.ticket_web_entradas x where x.evento_id = e.id and x.rrpp_id = r.id))
  ) q;

  select coalesce(jsonb_agg(v order by v ->> 'creado_en' desc), '[]'::jsonb) into v_ventas from (
    select jsonb_build_object('creado_en', p.creado_en, 'evento', e.nombre, 'evento_id', p.evento_id,
           'comprador', split_part(btrim(p.nombre), ' ', 1) || coalesce(' ' || left(nullif(split_part(btrim(p.nombre), ' ', 2), ''), 1) || '.', ''),
           'entradas', (select count(*) from public.ticket_web_entradas x where x.pedido_id = p.id and x.estado = 'valida'),
           'efectivo', p.rrpp_efectivo, 'prueba', p.prueba, 'anulado', not exists (select 1 from public.ticket_web_entradas x where x.pedido_id = p.id and x.estado = 'valida'),
           'total', case when p.rrpp_efectivo then (select coalesce(sum(x.precio), 0) from public.ticket_web_entradas x where x.pedido_id = p.id and x.estado = 'valida') end,
           'acceso', case when p.rrpp_efectivo then p.acceso end,
           'anulable', p.rrpp_efectivo and p.creado_en > now() - interval '15 minutes') v
    from public.ticket_web_pedidos p join public.ticket_eventos e on e.id = p.evento_id
    where p.rrpp_id = r.id order by p.creado_en desc limit 60
  ) q;

  return jsonb_build_object('rrpp', jsonb_build_object('nombre', r.nombre, 'codigo', r.codigo), 'organizador', v_org,
                            'eventos', v_eventos, 'ventas', v_ventas, 'ahora', now());
end $$;
revoke all on function public.rrpp_panel(uuid) from public;
grant execute on function public.rrpp_panel(uuid) to anon, authenticated;

-- ---------- Venta en efectivo desde el panel del RRPP ----------
create or replace function public.rrpp_vender(p_acceso uuid, p_slug text, p_items jsonb, p_comprador jsonb, p_asistentes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; f record; v_cfg record; v_rec int; v_email text; v_real boolean; res jsonb;
begin
  select * into r from public.ticket_rrpp where acceso = p_acceso and activo;
  if r.id is null then return jsonb_build_object('ok', false, 'motivo', 'rrpp'); end if;
  select * into f from public.ticket_web_eventos where slug = lower(p_slug);
  if f.evento_id is null or f.owner_id <> r.owner_id then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if not public.rrpp_en_evento(r.id, f.evento_id) then return jsonb_build_object('ok', false, 'motivo', 'rrpp_evento'); end if;
  select * into v_cfg from public.ticket_rrpp_config where evento_id = f.evento_id;
  if v_cfg.evento_id is not null and not v_cfg.efectivo then return jsonb_build_object('ok', false, 'motivo', 'efectivo_no'); end if;
  select count(*) into v_rec from public.ticket_web_pedidos where rrpp_id = r.id and creado_en > now() - interval '10 minutes';
  if v_rec >= 60 then return jsonb_build_object('ok', false, 'motivo', 'demasiados_intentos'); end if;

  v_email := lower(btrim(coalesce(p_comprador ->> 'email', '')));
  v_real := v_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
  if not v_real then v_email := 'rrpp-' || encode(extensions.gen_random_bytes(5), 'hex') || '@sin-correo.invalid'; end if;

  perform set_config('tixfast.rrpp_venta', r.id::text, true);
  res := public.web_comprar(p_slug, p_items,
           (coalesce(p_comprador, '{}'::jsonb) - 'rrpp' - 'marketing') || jsonb_build_object('email', v_email, 'rrpp', r.codigo, 'marketing', false), p_asistentes);
  perform set_config('tixfast.rrpp_venta', '', true);
  return res || jsonb_build_object('correo', v_real);
end $$;
revoke all on function public.rrpp_vender(uuid, text, jsonb, jsonb, jsonb) from public;
grant execute on function public.rrpp_vender(uuid, text, jsonb, jsonb, jsonb) to anon, authenticated;

-- El RRPP puede anular una venta suya en efectivo en los 15 minutos siguientes (por si se equivoca)
create or replace function public.rrpp_anular_venta(p_acceso uuid, p_pedido uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; p record; x record;
begin
  select * into r from public.ticket_rrpp where acceso = p_acceso and activo;
  if r.id is null then return jsonb_build_object('ok', false, 'motivo', 'rrpp'); end if;
  select * into p from public.ticket_web_pedidos where acceso = p_pedido and rrpp_id = r.id and rrpp_efectivo for update;
  if p.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if p.creado_en < now() - interval '15 minutes' then return jsonb_build_object('ok', false, 'motivo', 'tarde'); end if;
  for x in select * from public.ticket_web_entradas where pedido_id = p.id and estado = 'valida' for update loop
    if x.tramo_id is not null then update public.ticket_web_tramos set vendidas = greatest(vendidas - 1, 0) where id = x.tramo_id; end if;
    update public.ticket_web_entradas set estado = 'anulada' where id = x.id;
  end loop;
  update public.ticket_web_pedidos set estado = 'anulado' where id = p.id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.rrpp_anular_venta(uuid, uuid) from public;
grant execute on function public.rrpp_anular_venta(uuid, uuid) to anon, authenticated;

-- ---------- Organizador: resumen por RRPP de un evento ----------
create or replace function public.rrpp_resumen(p_evento uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'rrpp_id', r.id, 'nombre', r.nombre, 'codigo', r.codigo, 'telefono', r.telefono, 'activo', r.activo,
    'en_evento', public.rrpp_en_evento(r.id, p_evento),
    'propia', o.tipo is not null, 'tipo', o.tipo, 'valor', o.valor, 'tramos', o.tramos,
    'online', (select count(*) from public.ticket_web_entradas x join public.ticket_web_pedidos p on p.id = x.pedido_id
                where x.evento_id = p_evento and x.rrpp_id = r.id and x.estado = 'valida' and not x.prueba and not p.rrpp_efectivo),
    'efectivo_n', (select count(*) from public.ticket_web_entradas x join public.ticket_web_pedidos p on p.id = x.pedido_id
                where x.evento_id = p_evento and x.rrpp_id = r.id and x.estado = 'valida' and not x.prueba and p.rrpp_efectivo),
    'efectivo_importe', (select coalesce(sum(x.precio), 0) from public.ticket_web_entradas x join public.ticket_web_pedidos p on p.id = x.pedido_id
                where x.evento_id = p_evento and x.rrpp_id = r.id and x.estado = 'valida' and not x.prueba and p.rrpp_efectivo),
    'pruebas', (select count(*) from public.ticket_web_entradas x where x.evento_id = p_evento and x.rrpp_id = r.id and x.estado = 'valida' and x.prueba),
    'comision', (select coalesce(sum(public.rrpp_comision(p_evento, r.id, x.tramo_id, x.precio)), 0) from public.ticket_web_entradas x
                where x.evento_id = p_evento and x.rrpp_id = r.id and x.estado = 'valida' and not x.prueba),
    'liquidacion', (select to_jsonb(l) from public.ticket_rrpp_liquidaciones l where l.evento_id = p_evento and l.rrpp_id = r.id)
  ) order by r.activo desc, r.nombre), '[]'::jsonb)
  from public.ticket_rrpp r
  left join public.ticket_rrpp_eventos o on o.evento_id = p_evento and o.rrpp_id = r.id
  where r.owner_id = (select auth.uid())
$$;
revoke all on function public.rrpp_resumen(uuid) from public, anon;
grant execute on function public.rrpp_resumen(uuid) to authenticated;

-- ---------- Organizador: liquidar (fase 1: pagado o cobrado fuera de la app) ----------
create or replace function public.rrpp_liquidar(p_evento uuid, p_rrpp uuid, p_metodo text, p_nota text)
returns jsonb language plpgsql set search_path = '' as $$
declare r record; v_n int; v_com numeric; v_ef numeric; v_gasto uuid; l record;
begin
  select * into r from public.ticket_rrpp where id = p_rrpp and owner_id = (select auth.uid());
  if r.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if exists (select 1 from public.ticket_rrpp_liquidaciones where evento_id = p_evento and rrpp_id = p_rrpp) then
    return jsonb_build_object('ok', false, 'motivo', 'ya_liquidado');
  end if;
  select count(*), coalesce(sum(public.rrpp_comision(p_evento, r.id, x.tramo_id, x.precio)), 0),
         coalesce(sum(case when p.rrpp_efectivo then x.precio else 0 end), 0)
    into v_n, v_com, v_ef
    from public.ticket_web_entradas x join public.ticket_web_pedidos p on p.id = x.pedido_id
   where x.evento_id = p_evento and x.rrpp_id = r.id and x.estado = 'valida' and not x.prueba;
  if v_com > 0 then
    insert into public.ticket_crm_gastos (owner_id, evento_id, tipo, categoria, concepto, previsto, real, estado, fecha, iva, factura, nota)
    values (r.owner_id, p_evento, 'normal', 'Personal', left('Comisión RRPP · ' || r.nombre, 160), v_com, v_com, 'pagado', current_date, 0, false,
            left(v_n || ' entradas · liquidado desde RRPP', 500))
    returning id into v_gasto;
  end if;
  insert into public.ticket_rrpp_liquidaciones (owner_id, evento_id, rrpp_id, entradas, comision, efectivo, resultado, metodo, nota, gasto_id)
  values (r.owner_id, p_evento, r.id, v_n, v_com, v_ef, v_com - v_ef,
          case when p_metodo in ('bizum', 'transferencia', 'efectivo', 'otro') then p_metodo end, nullif(left(btrim(coalesce(p_nota, '')), 500), ''), v_gasto)
  returning * into l;
  return jsonb_build_object('ok', true, 'liquidacion', to_jsonb(l));
end $$;
revoke all on function public.rrpp_liquidar(uuid, uuid, text, text) from public, anon;
grant execute on function public.rrpp_liquidar(uuid, uuid, text, text) to authenticated;

create or replace function public.rrpp_deshacer_liquidacion(p_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare l record;
begin
  delete from public.ticket_rrpp_liquidaciones where id = p_id and owner_id = (select auth.uid()) returning * into l;
  if l.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if l.gasto_id is not null then delete from public.ticket_crm_gastos where id = l.gasto_id and owner_id = (select auth.uid()); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.rrpp_deshacer_liquidacion(uuid) from public, anon;
grant execute on function public.rrpp_deshacer_liquidacion(uuid) to authenticated;

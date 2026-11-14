-- ===================== PAGOS · monederos con Stripe Connect (modo pruebas) =====================
-- · El comprador paga en Stripe (tarjeta, Apple/Google Pay, Bizum si está activo). TIXFAST no guarda dinero:
--   todo queda en Stripe hasta repartirlo.
-- · Cada organizador y cada RRPP tiene su monedero: una cuenta conectada de Stripe (ticket_pago_cuentas).
-- · Al acabar el evento se reparte solo: a cada RRPP su comisión menos el efectivo que cobró él,
--   y el resto de las entradas al organizador. Los gastos de gestión se quedan en TIXFAST (cubren Stripe + margen).
-- · El RRPP o el organizador pasa su saldo a su banco cuando quiere (ticket_retiradas).
-- Por ahora SOLO en eventos en modo «pruebas» con «pago_pruebas» activado: se paga con tarjetas de prueba
-- de Stripe y las entradas salen marcadas como PRUEBA. Los eventos reales siguen sin cobro online hasta tener NIF.
-- Solo añade tablas, columnas y funciones.

alter table public.ticket_web_eventos add column if not exists pago_pruebas boolean not null default false;

-- Monederos (cuentas conectadas de Stripe). Nunca se guarda DNI ni IBAN: solo el id de Stripe y el estado.
create table if not exists public.ticket_pago_cuentas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('organizador', 'rrpp')),
  modo text not null check (modo in ('pruebas', 'real')),
  stripe_id text not null unique,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'activa', 'revision')),
  recibe boolean not null default false,          -- puede recibir transferencias
  retira boolean not null default false,          -- puede pasar dinero a su banco
  banco text,                                     -- solo para mostrar: «ES·· 1332»
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (user_id, tipo, modo)
);
alter table public.ticket_pago_cuentas enable row level security;
drop policy if exists cuenta_propia on public.ticket_pago_cuentas;
create policy cuenta_propia on public.ticket_pago_cuentas for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.ticket_pago_cuentas from anon, authenticated;
grant select on public.ticket_pago_cuentas to authenticated;

-- Un pago por pedido. Guarda la reserva (asistentes) hasta que Stripe confirma.
create table if not exists public.ticket_pagos (
  pedido_id uuid primary key references public.ticket_web_pedidos(id) on delete restrict,
  owner_id uuid not null,
  evento_id uuid not null references public.ticket_eventos(id) on delete restrict,
  modo text not null check (modo in ('pruebas', 'real')),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'pagado', 'caducado', 'devuelto')),
  entradas numeric(10,2) not null check (entradas >= 0),     -- precio de las entradas (para el organizador y los RRPP)
  gastos numeric(10,2) not null default 0 check (gastos >= 0),  -- gastos de gestión (TIXFAST)
  importe numeric(10,2) not null check (importe >= 0),       -- lo que paga el comprador
  asistentes jsonb not null,
  rrpp text,
  sesion_id text unique,
  payment_intent text,
  cargo_id text,
  caduca_en timestamptz not null,
  pagado_en timestamptz,
  creado_en timestamptz not null default now()
);
create index if not exists ticket_pagos_evento on public.ticket_pagos (evento_id, estado);
create index if not exists ticket_pagos_pend on public.ticket_pagos (caduca_en) where estado = 'pendiente';
alter table public.ticket_pagos enable row level security;
drop policy if exists pagos_owner on public.ticket_pagos;
create policy pagos_owner on public.ticket_pagos for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.ticket_pagos from anon, authenticated;
grant select on public.ticket_pagos to authenticated;

-- Reparto al acabar el evento: una fila por beneficiario y evento (clave única: nunca se paga dos veces).
create table if not exists public.ticket_repartos (
  id uuid primary key default gen_random_uuid(),
  clave text not null unique,
  evento_id uuid not null references public.ticket_eventos(id) on delete restrict,
  owner_id uuid not null,
  modo text not null check (modo in ('pruebas', 'real')),
  beneficiario text not null check (beneficiario in ('organizador', 'rrpp')),
  rrpp_id uuid references public.ticket_rrpp(id) on delete set null,
  user_id uuid,                                    -- quién lo recibe (para que lo vea en su panel)
  cuenta_id uuid references public.ticket_pago_cuentas(id),
  importe numeric(10,2) not null,
  detalle jsonb not null default '{}'::jsonb,      -- entradas, comisión, efectivo…
  estado text not null default 'preparado' check (estado in ('preparado', 'enviado', 'sin_monedero', 'nada', 'error')),
  transferencias jsonb not null default '[]'::jsonb,
  error text,
  creado_en timestamptz not null default now(),
  enviado_en timestamptz
);
create index if not exists ticket_repartos_evento on public.ticket_repartos (evento_id);
create index if not exists ticket_repartos_user on public.ticket_repartos (user_id);
alter table public.ticket_repartos enable row level security;
drop policy if exists repartos_ver on public.ticket_repartos;
create policy repartos_ver on public.ticket_repartos for select to authenticated
  using (owner_id = (select auth.uid()) or user_id = (select auth.uid()));
revoke all on public.ticket_repartos from anon, authenticated;
grant select on public.ticket_repartos to authenticated;

-- Retiradas del monedero al banco
create table if not exists public.ticket_retiradas (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references public.ticket_pago_cuentas(id),
  user_id uuid not null,
  importe numeric(10,2) not null check (importe > 0),
  stripe_id text unique,
  estado text not null default 'en_camino' check (estado in ('en_camino', 'pagada', 'fallida', 'cancelada')),
  llega_en date,
  creado_en timestamptz not null default now()
);
alter table public.ticket_retiradas enable row level security;
drop policy if exists retiradas_propias on public.ticket_retiradas;
create policy retiradas_propias on public.ticket_retiradas for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.ticket_retiradas from anon, authenticated;
grant select on public.ticket_retiradas to authenticated;

-- Ajustes internos (secretos de los avisos de Stripe). Nadie fuera del servidor la ve.
create table if not exists public.ticket_pago_config (clave text primary key, valor text not null, actualizado_en timestamptz not null default now());
alter table public.ticket_pago_config enable row level security;
revoke all on public.ticket_pago_config from anon, authenticated;

-- Gastos de gestión de un pedido: cubren Stripe (1,5 % + 0,25 €), el reparto (0,25 %) y un 3 % para TIXFAST,
-- con IVA incluido. Nunca más del 10 % del precio de las entradas.
create or replace function public.pago_gastos(p_entradas numeric)
returns numeric language sql immutable set search_path = '' as $$
  select case when coalesce(p_entradas, 0) <= 0 then 0
    else least(ceil((0.25 + 0.0475 * p_entradas) / (1 / 1.21 - 0.015) * 100) / 100, floor(p_entradas * 10) / 100) end
$$;
grant execute on function public.pago_gastos(numeric) to anon, authenticated;

-- ---------- Compra con pago: web_comprar reserva y devuelve «pago»; las entradas salen al confirmar ----------
do $$
declare v text;
begin
  select pg_get_functiondef('public.web_comprar(text,jsonb,jsonb,jsonb)'::regprocedure) into v;
  if position('v_pago boolean' in v) = 0 then
    v := replace(v, 'campo text; nivel text;', 'campo text; nivel text; v_pago boolean := false; v_gastos numeric := 0;');
    v := replace(v,
'  if coalesce(e.qr_clave, '''') = '''' then',
'  v_pago := v_prueba and coalesce(f.pago_pruebas, false) and v_total > 0 and coalesce(current_setting(''tixfast.rrpp_venta'', true), '''') = '''';
  if v_pago then
    v_gastos := public.pago_gastos(v_total);
    for a in select * from jsonb_array_elements(p_asistentes) loop
      if not (pedidos ? coalesce(a ->> ''tramo'', '''')) then return jsonb_build_object(''ok'', false, ''motivo'', ''asistentes''); end if;
      if length(btrim(coalesce(a ->> ''nombre'', ''''))) < 3 then return jsonb_build_object(''ok'', false, ''motivo'', ''nombre_asistente''); end if;
    end loop;
  end if;

  if coalesce(e.qr_clave, '''') = '''' then');
    v := replace(v,
'case when v_prueba then 0 else v_total end,
          case when v_prueba then ''prueba'' else ''gratis'' end,',
'case when v_pago then v_total when v_prueba then 0 else v_total end,
          case when v_pago then ''pendiente'' when v_prueba then ''prueba'' else ''gratis'' end,');
    v := replace(v,
'  returning id, acceso into v_pedido, v_acceso;
',
'  returning id, acceso into v_pedido, v_acceso;

  if v_pago then
    update public.ticket_web_pedidos set gastos = v_gastos where id = v_pedido;
    insert into public.ticket_pagos (pedido_id, owner_id, evento_id, modo, entradas, gastos, importe, asistentes, rrpp, caduca_en)
    values (v_pedido, f.owner_id, f.evento_id, ''pruebas'', v_total, v_gastos, v_total + v_gastos, p_asistentes,
            nullif(left(btrim(coalesce(p_comprador ->> ''rrpp'', '''')), 16), ''''), now() + interval ''40 minutes'');
    update public.ticket_web_tramos x set vendidas = x.vendidas + (pedidos ->> x.id::text)::int where x.evento_id = f.evento_id and pedidos ? x.id::text;
    return jsonb_build_object(''ok'', true, ''pago'', true, ''codigo'', v_codigo, ''acceso'', v_acceso, ''prueba'', v_prueba,
                              ''entradas'', v_total, ''gastos'', v_gastos, ''importe'', v_total + v_gastos);
  end if;
');
    if position('v_pago := v_prueba' in v) = 0 or position('if v_pago then
    update public.ticket_web_pedidos' in v) = 0 or position('when v_pago then ''pendiente''' in v) = 0 then
      raise exception 'web_comprar: no se ha podido parchear';
    end if;
    execute v;
  end if;
end $$;

-- Lo que ve la página del evento: si se paga con tarjeta (de prueba) y la fórmula de gastos
do $$
declare v text;
begin
  select pg_get_functiondef('public.web_evento_publico(text)'::regprocedure) into v;
  if position('pago_pruebas' in v) = 0 then
    v := regexp_replace(v, '''modo'', f\.modo,', '''modo'', f.modo, ''pago_pruebas'', coalesce(f.pago_pruebas, false),');
    if position('pago_pruebas' in v) = 0 then raise exception 'web_evento_publico: no se ha podido parchear'; end if;
    execute v;
  end if;
end $$;

-- Mis entradas: el pedido dice si está esperando el pago y cuánto se pagó de gastos
do $$
declare v text;
begin
  select pg_get_functiondef('public.web_pedido(uuid)'::regprocedure) into v;
  if position('''gastos''' in v) = 0 then
    v := replace(v, '''total'', p.total, ''estado'', p.estado,', '''total'', p.total, ''gastos'', p.gastos, ''estado'', p.estado,');
    if position('''gastos''' in v) = 0 then raise exception 'web_pedido: no se ha podido parchear'; end if;
    execute v;
  end if;
end $$;

-- ---------- Confirmar un pago: emite las entradas (una sola vez) ----------
create or replace function public.pago_emitir(p_pedido uuid, p_sesion text, p_pi text, p_cargo text, p_importe numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g record; p record; f record; e record; t record; a jsonb; v_num int; v_ent uuid; v_msg bytea; v_mac bytea; v_ver int; v_n jsonb := '{}'::jsonb;
begin
  select * into g from public.ticket_pagos where pedido_id = p_pedido for update;
  if g.pedido_id is null then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if g.estado = 'pagado' then return jsonb_build_object('ok', true, 'ya', true); end if;
  if p_importe is not null and round(p_importe, 2) <> g.importe then
    return jsonb_build_object('ok', false, 'motivo', 'importe', 'esperado', g.importe, 'pagado', p_importe);
  end if;
  select * into p from public.ticket_web_pedidos where id = p_pedido;
  select * into f from public.ticket_web_eventos where evento_id = g.evento_id for update;
  select * into e from public.ticket_eventos where id = g.evento_id;
  if g.estado = 'caducado' then   -- llegó el pago después de soltar la reserva: se vuelven a apartar las plazas
    for a in select * from jsonb_array_elements(g.asistentes) loop v_n := v_n || jsonb_build_object(a ->> 'tramo', coalesce((v_n ->> (a ->> 'tramo'))::int, 0) + 1); end loop;
    update public.ticket_web_tramos x set vendidas = x.vendidas + (v_n ->> x.id::text)::int where x.evento_id = g.evento_id and v_n ? x.id::text;
  end if;
  if coalesce(e.qr_clave, '') = '' then
    update public.ticket_eventos set qr_clave = encode(extensions.gen_random_bytes(32), 'hex') where id = e.id returning * into e;
  end if;
  v_num := f.contador;
  v_ver := case when p.prueba then 4 else 3 end;
  for a in select * from jsonb_array_elements(g.asistentes) loop
    select * into t from public.ticket_web_tramos where id = (a ->> 'tramo')::uuid and evento_id = g.evento_id;
    v_num := v_num + 1; v_ent := gen_random_uuid();
    v_msg := set_byte('\x00'::bytea, 0, v_ver) || decode(replace(v_ent::text, '-', ''), 'hex') || '\x00'::bytea || '\x01'::bytea
             || decode(left(replace(t.id::text, '-', ''), 12), 'hex');
    v_mac := substring(extensions.hmac(v_msg, decode(e.qr_clave, 'hex'), 'sha256') from 1 for 8);
    insert into public.ticket_web_entradas (id, owner_id, evento_id, pedido_id, tramo_id, tramo_nombre, numero, asistente, dni, precio, prueba, qr_hex)
    values (v_ent, g.owner_id, g.evento_id, p_pedido, t.id, t.nombre, v_num, left(btrim(a ->> 'nombre'), 120),
            nullif(left(btrim(coalesce(a ->> 'dni', '')), 30), ''), t.precio, p.prueba, encode(v_msg || v_mac, 'hex'));
  end loop;
  update public.ticket_web_eventos set contador = v_num where evento_id = g.evento_id;
  update public.ticket_web_pedidos set estado = 'pagado' where id = p_pedido;
  update public.ticket_pagos set estado = 'pagado', pagado_en = now(), sesion_id = coalesce(p_sesion, sesion_id),
         payment_intent = coalesce(p_pi, payment_intent), cargo_id = coalesce(p_cargo, cargo_id) where pedido_id = p_pedido;
  perform public.rrpp_atribuir(p_pedido, g.evento_id, g.owner_id, g.rrpp);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.pago_emitir(uuid, text, text, text, numeric) from public, anon, authenticated;

-- Soltar una reserva que no se pagó
create or replace function public.pago_caducar(p_pedido uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g record; a jsonb; v_n jsonb := '{}'::jsonb;
begin
  select * into g from public.ticket_pagos where pedido_id = p_pedido for update;
  if g.pedido_id is null or g.estado <> 'pendiente' then return jsonb_build_object('ok', false, 'motivo', coalesce(g.estado, 'no_existe')); end if;
  for a in select * from jsonb_array_elements(g.asistentes) loop v_n := v_n || jsonb_build_object(a ->> 'tramo', coalesce((v_n ->> (a ->> 'tramo'))::int, 0) + 1); end loop;
  update public.ticket_web_tramos x set vendidas = greatest(x.vendidas - (v_n ->> x.id::text)::int, 0) where x.evento_id = g.evento_id and v_n ? x.id::text;
  update public.ticket_pagos set estado = 'caducado' where pedido_id = p_pedido;
  update public.ticket_web_pedidos set estado = 'anulado' where id = p_pedido;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.pago_caducar(uuid) from public, anon, authenticated;

-- ---------- Cálculo del reparto de un evento ----------
-- Por RRPP: comisión de sus entradas (pagadas por Stripe + en efectivo) menos el efectivo que tiene él.
-- Organizador: todo lo cobrado por entradas menos lo que se manda a los RRPP.
create or replace function public.pago_reparto_calculo(p_evento uuid, p_modo text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with ent as (
    select x.rrpp_id, x.tramo_id, x.precio, p.rrpp_efectivo, g.pedido_id is not null as online
      from public.ticket_web_entradas x join public.ticket_web_pedidos p on p.id = x.pedido_id
      left join public.ticket_pagos g on g.pedido_id = p.id and g.estado = 'pagado' and g.modo = p_modo
     where x.evento_id = p_evento and x.estado = 'valida' and x.prueba = (p_modo = 'pruebas')
       and (g.pedido_id is not null or p.rrpp_efectivo)
  ),
  r as (
    select e.rrpp_id, count(*) n, count(*) filter (where e.online) n_online, count(*) filter (where e.rrpp_efectivo) n_efectivo,
           coalesce(sum(public.rrpp_comision(p_evento, e.rrpp_id, e.tramo_id, e.precio)), 0) comision,
           coalesce(sum(e.precio) filter (where e.rrpp_efectivo), 0) efectivo
      from ent e where e.rrpp_id is not null group by e.rrpp_id
  )
  select jsonb_build_object(
    'evento', p_evento,
    'owner_id', (select owner_id from public.ticket_web_eventos where evento_id = p_evento),
    'cobrado', (select coalesce(sum(entradas), 0) from public.ticket_pagos where evento_id = p_evento and estado = 'pagado' and modo = p_modo),
    'pendientes', (select count(*) from public.ticket_pagos where evento_id = p_evento and estado = 'pendiente' and modo = p_modo),
    'cargos', (select coalesce(jsonb_agg(jsonb_build_object('cargo', cargo_id, 'entradas', entradas) order by pagado_en), '[]'::jsonb)
                 from public.ticket_pagos where evento_id = p_evento and estado = 'pagado' and modo = p_modo and cargo_id is not null),
    'rrpp', (select coalesce(jsonb_agg(jsonb_build_object('rrpp_id', r.rrpp_id, 'nombre', k.nombre, 'user_id', k.user_id,
               'entradas', r.n, 'online', r.n_online, 'en_efectivo', r.n_efectivo, 'comision', r.comision, 'efectivo', r.efectivo,
               'neto', greatest(r.comision - r.efectivo, 0), 'debe', greatest(r.efectivo - r.comision, 0))), '[]'::jsonb)
               from r join public.ticket_rrpp k on k.id = r.rrpp_id)
  )
$$;
revoke all on function public.pago_reparto_calculo(uuid, text) from public, anon, authenticated;

-- Eventos que ya han acabado y tienen algo por repartir
create or replace function public.pago_eventos_por_repartir(p_modo text)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct g.evento_id from public.ticket_pagos g join public.ticket_eventos e on e.id = g.evento_id
   where g.modo = p_modo and g.estado = 'pagado'
     and coalesce(e.fin, (nullif(e.inicio::text, '')::timestamp + interval '12 hours') at time zone 'Europe/Madrid',
                  (nullif(e.fecha::text, '')::date + interval '32 hours') at time zone 'Europe/Madrid') < now()
     and not exists (select 1 from public.ticket_repartos r where r.evento_id = g.evento_id and r.modo = p_modo and r.beneficiario = 'organizador' and r.estado in ('enviado', 'nada'))
$$;
revoke all on function public.pago_eventos_por_repartir(text) from public, anon, authenticated;

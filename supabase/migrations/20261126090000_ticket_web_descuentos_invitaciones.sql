-- TIXFAST · Venta online: códigos descuento e invitaciones
--
-- 1) Códigos descuento (ticket_web_descuentos): porcentaje o euros menos por entrada, para un evento o para todos,
--    con usos totales, usos por persona (correo), fecha de inicio y de fin, mínimo de entradas y tipos de entrada.
--    Se aplican en web_comprar (el servidor calcula el precio; el navegador nunca decide cuánto se paga).
-- 2) Invitaciones: pedido con estado «invitacion», entradas a 0 € con su QR de un solo uso.
--    No cuentan como ingresos ni en «vendidas en las últimas 24 h», pero sí ocupan aforo si se elige.

-- ---------- Códigos descuento ----------
create table if not exists public.ticket_web_descuentos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  evento_id uuid references public.ticket_eventos(id) on delete cascade,      -- null = todos mis eventos
  codigo text not null check (codigo ~ '^[A-Z0-9_-]{3,30}$'),
  nombre text check (length(nombre) <= 80),                                  -- nota interna («RRPP Laura», «Early fans»…)
  tipo text not null default 'porcentaje' check (tipo in ('porcentaje', 'euros')),
  valor numeric(10,2) not null check (valor > 0),
  tramos uuid[],                                                              -- null = todos los tipos de entrada
  usos_max int check (usos_max is null or usos_max > 0),                       -- compras en total
  usos_por_email int check (usos_por_email is null or usos_por_email > 0),     -- compras por persona
  minimo_entradas int not null default 1 check (minimo_entradas between 1 and 20),
  inicio timestamptz,
  fin timestamptz,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  check (tipo <> 'porcentaje' or valor <= 100),
  check (fin is null or inicio is null or fin > inicio)
);
create unique index if not exists ticket_web_descuentos_codigo on public.ticket_web_descuentos (owner_id, upper(codigo));
create index if not exists ticket_web_descuentos_evento on public.ticket_web_descuentos (evento_id);
alter table public.ticket_web_descuentos enable row level security;
drop policy if exists owner_all on public.ticket_web_descuentos;
create policy owner_all on public.ticket_web_descuentos for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
grant select, insert, update, delete on public.ticket_web_descuentos to authenticated;

alter table public.ticket_web_pedidos add column if not exists descuento_id uuid references public.ticket_web_descuentos(id) on delete set null;
alter table public.ticket_web_pedidos add column if not exists descuento_codigo text;
alter table public.ticket_web_pedidos add column if not exists descuento_importe numeric(10,2) not null default 0;
create index if not exists ticket_web_pedidos_descuento on public.ticket_web_pedidos (descuento_id) where descuento_id is not null;

alter table public.ticket_web_pedidos drop constraint if exists ticket_web_pedidos_estado_check;
alter table public.ticket_web_pedidos add constraint ticket_web_pedidos_estado_check
  check (estado = any (array['prueba', 'gratis', 'pendiente', 'pagado', 'anulado', 'invitacion']));

-- Usos de un código (compras que no se han anulado)
create or replace function public.web_descuento_usos(p_descuento uuid, p_email text default null)
returns int language sql stable security definer set search_path to '' as $$
  select count(*)::int from public.ticket_web_pedidos p
   where p.descuento_id = p_descuento and p.estado <> 'anulado' and not p.prueba
     and (p_email is null or lower(p.email) = lower(p_email));
$$;
revoke all on function public.web_descuento_usos(uuid, text) from public, anon;
grant execute on function public.web_descuento_usos(uuid, text) to authenticated, service_role;

-- Validar un código (lo usa web_comprar y la página pública para enseñar el descuento antes de comprar).
-- Devuelve el motivo en claro para que la página pueda decirlo; nunca devuelve otros códigos.
create or replace function public.web_descuento_valido(p_owner uuid, p_evento uuid, p_codigo text, p_email text, p_bloquear boolean default false)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare d record; v_cod text := upper(btrim(coalesce(p_codigo, '')));
begin
  if v_cod = '' then return jsonb_build_object('ok', false, 'motivo', 'descuento_vacio'); end if;
  if p_bloquear then
    select * into d from public.ticket_web_descuentos x where x.owner_id = p_owner and upper(x.codigo) = v_cod and (x.evento_id is null or x.evento_id = p_evento) for update;
  else
    select * into d from public.ticket_web_descuentos x where x.owner_id = p_owner and upper(x.codigo) = v_cod and (x.evento_id is null or x.evento_id = p_evento);
  end if;
  if d.id is null or not d.activo then return jsonb_build_object('ok', false, 'motivo', 'descuento_no_valido'); end if;
  if d.inicio is not null and now() < d.inicio then return jsonb_build_object('ok', false, 'motivo', 'descuento_no_empezado', 'inicio', d.inicio); end if;
  if d.fin is not null and now() >= d.fin then return jsonb_build_object('ok', false, 'motivo', 'descuento_caducado'); end if;
  if d.usos_max is not null and public.web_descuento_usos(d.id) >= d.usos_max then return jsonb_build_object('ok', false, 'motivo', 'descuento_agotado'); end if;
  if d.usos_por_email is not null and coalesce(p_email, '') <> '' and public.web_descuento_usos(d.id, p_email) >= d.usos_por_email then
    return jsonb_build_object('ok', false, 'motivo', 'descuento_ya_usado');
  end if;
  return jsonb_build_object('ok', true, 'id', d.id, 'codigo', d.codigo, 'tipo', d.tipo, 'valor', d.valor, 'tramos', to_jsonb(d.tramos), 'minimo', d.minimo_entradas);
end $$;
revoke all on function public.web_descuento_valido(uuid, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.web_descuento_valido(uuid, uuid, text, text, boolean) to service_role;

-- Para la página pública: ¿vale este código en este evento?
create or replace function public.web_descuento_comprobar(p_slug text, p_codigo text, p_email text default null)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare f record; r jsonb;
begin
  select * into f from public.ticket_web_eventos where slug = lower(p_slug);
  if f.evento_id is null then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if length(btrim(coalesce(p_codigo, ''))) > 30 then return jsonb_build_object('ok', false, 'motivo', 'descuento_no_valido'); end if;
  r := public.web_descuento_valido(f.owner_id, f.evento_id, p_codigo, nullif(lower(btrim(coalesce(p_email, ''))), ''), false);
  return r - 'id';
end $$;
revoke all on function public.web_descuento_comprobar(text, text, text) from public;
grant execute on function public.web_descuento_comprobar(text, text, text) to anon, authenticated, service_role;

-- Precio de una entrada con el descuento aplicado (nunca por debajo de 0)
create or replace function public.web_precio_con_descuento(p_precio numeric, p_tramo uuid, p_desc jsonb)
returns numeric language sql immutable set search_path to '' as $$
  select case
    when p_desc is null or not coalesce((p_desc ->> 'ok')::boolean, false) or p_precio <= 0 then p_precio
    when jsonb_typeof(p_desc -> 'tramos') = 'array' and not (p_desc -> 'tramos') ? p_tramo::text then p_precio
    when p_desc ->> 'tipo' = 'porcentaje' then greatest(0, round(p_precio * (1 - (p_desc ->> 'valor')::numeric / 100), 2))
    else greatest(0, round(p_precio - (p_desc ->> 'valor')::numeric, 2)) end;
$$;

-- ---------- Compra con código descuento ----------
-- Parte de la versión rápida de 20261120100000_ticket_compras_rendimiento (comprueba los datos antes de bloquear
-- el evento e IP de Cloudflare) y añade p_comprador.descuento. Si el código no vale, la compra no se hace y se
-- dice por qué (salvo en el carrito de varios eventos, donde se aplica solo en los eventos en los que vale).
create or replace function public.web_comprar(p_slug text, p_items jsonb, p_comprador jsonb, p_asistentes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f record; e record; t record; it jsonb; a jsonb; es_dueno boolean; v_prueba boolean;
  v_email text; v_nombre text; v_total numeric := 0; v_n int := 0; v_ya int; v_ip text; v_rec int;
  v_pedido uuid; v_codigo text; v_acceso uuid; v_ent uuid; v_msg bytea; v_mac bytea; v_ver int; v_num int;
  campo text; nivel text; v_pago boolean := false; v_gastos numeric := 0; v_mkt boolean; v_nac date; v_datos jsonb := '{}'::jsonb; pedidos jsonb := '{}'::jsonb; v_cnt int;
  v_desc jsonb; v_cod text; v_suave boolean; v_pu numeric; v_ahorro numeric := 0; precios jsonb := '{}'::jsonb;
begin
  -- Primero se comprueba todo lo que no necesita bloquear el evento (datos, cantidades, límite por IP).
  -- Así una avalancha de compras falsas o mal rellenadas no hace cola delante de las de verdad.
  select * into f from public.ticket_web_eventos where slug = lower(p_slug);
  if f.evento_id is null then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  es_dueno := f.owner_id = (select auth.uid());
  if f.estado = 'cerrado' or (f.estado = 'borrador' and not es_dueno) then return jsonb_build_object('ok', false, 'motivo', 'cerrado'); end if;
  select * into e from public.ticket_eventos where id = f.evento_id;
  v_prueba := f.modo = 'pruebas' or f.estado = 'borrador';

  -- IP del comprador: la que pone Cloudflare (cf-connecting-ip, el navegador no puede inventarla);
  -- si no viene, la primera de x-forwarded-for como hasta ahora
  v_ip := btrim(coalesce(nullif(current_setting('request.headers', true)::jsonb ->> 'cf-connecting-ip', ''),
                         split_part(coalesce(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', ''), ',', 1)));
  if v_ip <> '' and coalesce(current_setting('tixfast.rrpp_venta', true), '') = '' then
    select count(*) into v_rec from public.ticket_web_pedidos where ip = v_ip and creado_en > now() - interval '10 minutes';
    if v_rec >= 15 then return jsonb_build_object('ok', false, 'motivo', 'demasiados_intentos'); end if;
  end if;

  v_email := lower(btrim(coalesce(p_comprador ->> 'email', '')));
  v_nombre := btrim(coalesce(p_comprador ->> 'nombre', ''));
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 160 then return jsonb_build_object('ok', false, 'motivo', 'email'); end if;
  if length(v_nombre) < 3 or length(v_nombre) > 120 then return jsonb_build_object('ok', false, 'motivo', 'nombre'); end if;
  for campo in select unnest(array['telefono','dni','nacimiento','cp','direccion','ciudad','genero']) loop
    nivel := coalesce(f.formulario ->> campo, 'no');
    if nivel = 'obligatorio' and btrim(coalesce(p_comprador ->> campo, '')) = '' then return jsonb_build_object('ok', false, 'motivo', 'falta_' || campo); end if;
    if nivel <> 'no' and btrim(coalesce(p_comprador ->> campo, '')) <> '' then v_datos := v_datos || jsonb_build_object(campo, left(btrim(p_comprador ->> campo), 200)); end if;
  end loop;
  v_mkt := coalesce((p_comprador ->> 'marketing')::boolean, false);
  begin v_nac := nullif(v_datos ->> 'nacimiento', '')::date; exception when others then v_nac := null; end;
  if v_nac is not null and v_nac > current_date - interval '14 years' then v_mkt := false; end if;
  if coalesce((p_comprador ->> 'acepta')::boolean, false) is not true then return jsonb_build_object('ok', false, 'motivo', 'condiciones'); end if;
  if coalesce(f.edad_minima, 0) > 0 and coalesce((p_comprador ->> 'acepta_edad')::boolean, false) is not true then return jsonb_build_object('ok', false, 'motivo', 'edad'); end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then return jsonb_build_object('ok', false, 'motivo', 'vacio'); end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_cnt := coalesce((it ->> 'cantidad')::int, 0);
    if v_cnt < 0 or v_cnt > 50 then return jsonb_build_object('ok', false, 'motivo', 'cantidad'); end if;
    if v_cnt > 0 then pedidos := pedidos || jsonb_build_object(it ->> 'tramo', coalesce((pedidos ->> (it ->> 'tramo'))::int, 0) + v_cnt); v_n := v_n + v_cnt; end if;
  end loop;
  if v_n = 0 then return jsonb_build_object('ok', false, 'motivo', 'vacio'); end if;
  if v_n > 20 then return jsonb_build_object('ok', false, 'motivo', 'cantidad'); end if;
  if jsonb_typeof(p_asistentes) <> 'array' or jsonb_array_length(p_asistentes) <> v_n then return jsonb_build_object('ok', false, 'motivo', 'asistentes'); end if;
  for a in select * from jsonb_array_elements(p_asistentes) loop
    if not (pedidos ? coalesce(a ->> 'tramo', '')) then return jsonb_build_object('ok', false, 'motivo', 'asistentes'); end if;
    if length(btrim(coalesce(a ->> 'nombre', ''))) < 3 then return jsonb_build_object('ok', false, 'motivo', 'nombre_asistente'); end if;
  end loop;

  -- Ahora sí: se bloquea el evento (numeración de entradas y plazas) y se relee por si ha cambiado
  select * into f from public.ticket_web_eventos where evento_id = f.evento_id for update;
  if f.evento_id is null then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if f.estado = 'cerrado' or (f.estado = 'borrador' and not es_dueno) then return jsonb_build_object('ok', false, 'motivo', 'cerrado'); end if;
  v_prueba := f.modo = 'pruebas' or f.estado = 'borrador';
  select * into e from public.ticket_eventos where id = f.evento_id;

  select count(*) into v_ya from public.ticket_web_entradas x join public.ticket_web_pedidos p on p.id = x.pedido_id
   where x.evento_id = f.evento_id and lower(p.email) = v_email and x.estado = 'valida' and x.prueba = v_prueba and p.estado <> 'invitacion';
  if v_ya + v_n > f.max_por_email then return jsonb_build_object('ok', false, 'motivo', 'limite_email', 'max', f.max_por_email, 'ya', v_ya); end if;

  -- Código descuento (se bloquea la fila: dos compras a la vez no pasan del límite de usos)
  v_cod := upper(btrim(coalesce(p_comprador ->> 'descuento', '')));
  v_suave := coalesce(current_setting('tixfast.descuento_suave', true), '') = '1';
  if v_cod <> '' then
    v_desc := public.web_descuento_valido(f.owner_id, f.evento_id, v_cod, v_email, true);
    if not coalesce((v_desc ->> 'ok')::boolean, false) then
      if v_suave then v_desc := null; else return v_desc; end if;
    elsif v_n < coalesce((v_desc ->> 'minimo')::int, 1) then
      if v_suave then v_desc := null; else return jsonb_build_object('ok', false, 'motivo', 'descuento_minimo', 'minimo', (v_desc ->> 'minimo')::int); end if;
    end if;
  end if;

  for t in select x.*, s.estado as est from public.ticket_web_tramos x join public.web_tramos_estado(f.evento_id) s on s.id = x.id
           where x.evento_id = f.evento_id and pedidos ? x.id::text for update of x loop
    v_cnt := (pedidos ->> t.id::text)::int;
    if t.est <> 'venta' then return jsonb_build_object('ok', false, 'motivo', 'tramo_' || t.est, 'tramo', t.nombre); end if;
    if v_cnt > t.max_por_compra then return jsonb_build_object('ok', false, 'motivo', 'max_compra', 'tramo', t.nombre, 'max', t.max_por_compra); end if;
    if t.cantidad is not null and t.vendidas + v_cnt > t.cantidad then return jsonb_build_object('ok', false, 'motivo', 'sin_sitio', 'tramo', t.nombre, 'quedan', greatest(t.cantidad - t.vendidas, 0)); end if;
    v_pu := public.web_precio_con_descuento(t.precio, t.id, v_desc);
    if v_pu > 0 and not v_prueba and coalesce(current_setting('tixfast.rrpp_venta', true), '') = '' then return jsonb_build_object('ok', false, 'motivo', 'pago_no_disponible', 'tramo', t.nombre); end if;
    precios := precios || jsonb_build_object(t.id::text, v_pu);
    v_total := v_total + v_pu * v_cnt;
    v_ahorro := v_ahorro + (t.precio - v_pu) * v_cnt;
  end loop;
  if (select count(*) from jsonb_object_keys(pedidos)) <> (select count(*) from public.ticket_web_tramos x where x.evento_id = f.evento_id and pedidos ? x.id::text) then
    return jsonb_build_object('ok', false, 'motivo', 'tramo_no_existe');
  end if;
  if v_desc is not null and v_ahorro <= 0 then
    if v_suave then v_desc := null; else return jsonb_build_object('ok', false, 'motivo', 'descuento_no_aplica'); end if;
  end if;

  v_pago := v_prueba and coalesce(f.pago_pruebas, false) and v_total > 0 and coalesce(current_setting('tixfast.rrpp_venta', true), '') = '';
  if v_pago then
    v_gastos := public.pago_gastos(v_total);
    for a in select * from jsonb_array_elements(p_asistentes) loop
      if not (pedidos ? coalesce(a ->> 'tramo', '')) then return jsonb_build_object('ok', false, 'motivo', 'asistentes'); end if;
      if length(btrim(coalesce(a ->> 'nombre', ''))) < 3 then return jsonb_build_object('ok', false, 'motivo', 'nombre_asistente'); end if;
    end loop;
  end if;

  if coalesce(e.qr_clave, '') = '' then
    update public.ticket_eventos set qr_clave = encode(extensions.gen_random_bytes(32), 'hex') where id = e.id returning * into e;
  end if;

  v_codigo := upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
  insert into public.ticket_web_pedidos (owner_id, evento_id, codigo, email, nombre, datos, total, estado, prueba, ip, agente, marketing, privacidad_version,
                                         descuento_id, descuento_codigo, descuento_importe)
  values (f.owner_id, f.evento_id, v_codigo, v_email, v_nombre, v_datos, case when v_pago then v_total when v_prueba then 0 else v_total end,
          case when v_pago then 'pendiente' when v_prueba then 'prueba' else 'gratis' end, v_prueba, nullif(v_ip, ''),
          left(coalesce(current_setting('request.headers', true)::jsonb ->> 'user-agent', ''), 200), v_mkt, left(nullif(p_comprador ->> 'privacidad', ''), 40),
          (v_desc ->> 'id')::uuid, v_desc ->> 'codigo', case when v_desc is null then 0 else v_ahorro end)
  returning id, acceso into v_pedido, v_acceso;

  if v_pago then
    update public.ticket_web_pedidos set gastos = v_gastos where id = v_pedido;
    insert into public.ticket_pagos (pedido_id, owner_id, evento_id, modo, entradas, gastos, importe, asistentes, rrpp, caduca_en)
    values (v_pedido, f.owner_id, f.evento_id, 'pruebas', v_total, v_gastos, v_total + v_gastos, p_asistentes,
            nullif(left(btrim(coalesce(p_comprador ->> 'rrpp', '')), 16), ''), now() + interval '40 minutes');
    update public.ticket_web_tramos x set vendidas = x.vendidas + (pedidos ->> x.id::text)::int where x.evento_id = f.evento_id and pedidos ? x.id::text;
    return jsonb_build_object('ok', true, 'pago', true, 'codigo', v_codigo, 'acceso', v_acceso, 'prueba', v_prueba,
                              'entradas', v_total, 'gastos', v_gastos, 'importe', v_total + v_gastos, 'descuento', case when v_desc is null then 0 else v_ahorro end);
  end if;

  v_num := f.contador;
  v_ver := case when v_prueba then 4 else 3 end;
  for a in select * from jsonb_array_elements(p_asistentes) loop
    select * into t from public.ticket_web_tramos where id = (a ->> 'tramo')::uuid and evento_id = f.evento_id;
    if t.id is null or not (pedidos ? t.id::text) then raise exception using message = 'asistentes'; end if;
    if length(btrim(coalesce(a ->> 'nombre', ''))) < 3 then raise exception using message = 'nombre_asistente'; end if;
    v_num := v_num + 1; v_ent := gen_random_uuid();
    v_msg := set_byte('\x00'::bytea, 0, v_ver) || decode(replace(v_ent::text, '-', ''), 'hex') || '\x00'::bytea || '\x01'::bytea
             || decode(left(replace(t.id::text, '-', ''), 12), 'hex');
    v_mac := substring(extensions.hmac(v_msg, decode(e.qr_clave, 'hex'), 'sha256') from 1 for 8);
    insert into public.ticket_web_entradas (id, owner_id, evento_id, pedido_id, tramo_id, tramo_nombre, numero, asistente, dni, precio, prueba, qr_hex)
    values (v_ent, f.owner_id, f.evento_id, v_pedido, t.id, t.nombre, v_num, left(btrim(a ->> 'nombre'), 120),
            nullif(left(btrim(coalesce(a ->> 'dni', '')), 30), ''), case when v_prueba then 0 else (precios ->> t.id::text)::numeric end, v_prueba, encode(v_msg || v_mac, 'hex'));
  end loop;
  perform public.rrpp_atribuir(v_pedido, f.evento_id, f.owner_id, p_comprador ->> 'rrpp');
  update public.ticket_web_tramos x set vendidas = x.vendidas + (pedidos ->> x.id::text)::int where x.evento_id = f.evento_id and pedidos ? x.id::text;
  update public.ticket_web_eventos set contador = v_num where evento_id = f.evento_id;

  return jsonb_build_object('ok', true, 'codigo', v_codigo, 'acceso', v_acceso, 'prueba', v_prueba, 'descuento', case when v_desc is null then 0 else v_ahorro end);
exception when others then
  if sqlerrm in ('nombre_asistente', 'asistentes') then return jsonb_build_object('ok', false, 'motivo', sqlerrm); end if;
  raise;
end $function$;

-- En el carrito de varios eventos el código se aplica en los eventos donde vale (sin tumbar la compra)
do $$
declare d text;
begin
  select pg_get_functiondef('public.web_comprar_varios(text,jsonb,jsonb,jsonb,uuid)'::regprocedure) into d;
  if position('tixfast.descuento_suave' in d) = 0 then
    d := replace(d, '  begin' || chr(10) || '    -- un pedido por evento',
                    '  perform set_config(''tixfast.descuento_suave'', ''1'', true);' || chr(10) || '  begin' || chr(10) || '    -- un pedido por evento');
    if position('tixfast.descuento_suave' in d) = 0 then raise exception 'web_comprar_varios: no se ha encontrado dónde activar el descuento'; end if;
    execute d;
  end if;
end $$;

-- ---------- Invitaciones ----------
-- Solo el organizador. Crea un pedido «invitacion» con N entradas a 0 € para la persona invitada.
-- p_aforo: si cuenta para el aforo del tipo de entrada (por defecto sí).
create or replace function public.web_invitar(p_evento uuid, p_tramo uuid, p_nombre text, p_email text, p_cantidad int default 1, p_aforo boolean default true, p_nota text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare f record; e record; t record; v_email text := lower(btrim(coalesce(p_email, ''))); v_nombre text := btrim(coalesce(p_nombre, ''));
  v_pedido uuid; v_acceso uuid; v_codigo text; v_num int; v_ent uuid; v_msg bytea; v_mac bytea; i int;
begin
  select * into f from public.ticket_web_eventos where evento_id = p_evento for update;
  if f.evento_id is null then return jsonb_build_object('ok', false, 'motivo', 'sin_venta_online'); end if;
  if f.owner_id is distinct from (select auth.uid()) then return jsonb_build_object('ok', false, 'motivo', 'no_autorizado'); end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 160 then return jsonb_build_object('ok', false, 'motivo', 'email'); end if;
  if length(v_nombre) < 3 or length(v_nombre) > 120 then return jsonb_build_object('ok', false, 'motivo', 'nombre'); end if;
  if coalesce(p_cantidad, 0) < 1 or p_cantidad > 20 then return jsonb_build_object('ok', false, 'motivo', 'cantidad'); end if;
  select * into t from public.ticket_web_tramos where id = p_tramo and evento_id = p_evento for update;
  if t.id is null then return jsonb_build_object('ok', false, 'motivo', 'tramo_no_existe'); end if;
  if p_aforo and t.cantidad is not null and t.vendidas + p_cantidad > t.cantidad then
    return jsonb_build_object('ok', false, 'motivo', 'sin_sitio', 'quedan', greatest(t.cantidad - t.vendidas, 0));
  end if;
  select * into e from public.ticket_eventos where id = p_evento;
  if coalesce(e.qr_clave, '') = '' then
    update public.ticket_eventos set qr_clave = encode(extensions.gen_random_bytes(32), 'hex') where id = e.id returning * into e;
  end if;

  v_codigo := upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
  insert into public.ticket_web_pedidos (owner_id, evento_id, codigo, email, nombre, datos, total, estado, prueba)
  values (f.owner_id, f.evento_id, v_codigo, v_email, v_nombre,
          jsonb_strip_nulls(jsonb_build_object('invitacion', true, 'nota', nullif(left(btrim(coalesce(p_nota, '')), 200), ''), 'aforo', p_aforo)),
          0, 'invitacion', false)
  returning id, acceso into v_pedido, v_acceso;

  v_num := f.contador;
  for i in 1..p_cantidad loop
    v_num := v_num + 1; v_ent := gen_random_uuid();
    v_msg := set_byte('\x00'::bytea, 0, 3) || decode(replace(v_ent::text, '-', ''), 'hex') || '\x00'::bytea || '\x01'::bytea
             || decode(left(replace(t.id::text, '-', ''), 12), 'hex');
    v_mac := substring(extensions.hmac(v_msg, decode(e.qr_clave, 'hex'), 'sha256') from 1 for 8);
    insert into public.ticket_web_entradas (id, owner_id, evento_id, pedido_id, tramo_id, tramo_nombre, numero, asistente, precio, prueba, qr_hex)
    values (v_ent, f.owner_id, f.evento_id, v_pedido, t.id, t.nombre, v_num,
            case when p_cantidad = 1 then left(v_nombre, 120) else left(v_nombre || ' (' || i || '/' || p_cantidad || ')', 120) end,
            0, false, encode(v_msg || v_mac, 'hex'));
  end loop;
  if p_aforo then update public.ticket_web_tramos set vendidas = vendidas + p_cantidad where id = t.id; end if;
  update public.ticket_web_eventos set contador = v_num where evento_id = f.evento_id;
  return jsonb_build_object('ok', true, 'codigo', v_codigo, 'acceso', v_acceso);
end $$;
revoke all on function public.web_invitar(uuid, uuid, text, text, int, boolean, text) from public, anon;
grant execute on function public.web_invitar(uuid, uuid, text, text, int, boolean, text) to authenticated;

-- Anular una invitación entera (sus entradas dejan de valer y, si ocupaba aforo, lo devuelve)
create or replace function public.web_anular_invitacion(p_pedido uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare p record; v_n int;
begin
  select * into p from public.ticket_web_pedidos where id = p_pedido for update;
  if p.id is null or p.estado <> 'invitacion' then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if p.owner_id is distinct from (select auth.uid()) then return jsonb_build_object('ok', false, 'motivo', 'no_autorizado'); end if;
  if coalesce((p.datos ->> 'aforo')::boolean, true) then
    update public.ticket_web_tramos t set vendidas = greatest(0, t.vendidas - x.n)
      from (select tramo_id, count(*)::int n from public.ticket_web_entradas where pedido_id = p.id and estado = 'valida' group by tramo_id) x
     where t.id = x.tramo_id;
  end if;
  update public.ticket_web_entradas set estado = 'anulada' where pedido_id = p.id and estado = 'valida';
  get diagnostics v_n = row_count;
  update public.ticket_web_pedidos set estado = 'anulado' where id = p.id;
  return jsonb_build_object('ok', true, 'anuladas', v_n);
end $$;
revoke all on function public.web_anular_invitacion(uuid) from public, anon;
grant execute on function public.web_anular_invitacion(uuid) to authenticated;

-- ---------- Las invitaciones no son ventas ----------
-- Ingresos del CRM: no suman (precio 0) ni cuentan como unidades vendidas
do $$
declare d text;
begin
  select pg_get_functiondef('public.web_sync_ingreso(uuid,uuid)'::regprocedure) into d;
  if position('invitacion' in d) = 0 then
    d := replace(d, 'and not x.prueba and not coalesce(p.rrpp_efectivo, false);',
                    'and not x.prueba and not coalesce(p.rrpp_efectivo, false) and coalesce(p.estado, '''') <> ''invitacion'';');
    if position('invitacion' in d) = 0 then raise exception 'web_sync_ingreso: no se ha encontrado la consulta'; end if;
    execute d;
  end if;
end $$;

-- Página pública: «vendidas en 24 h», «ya van N» y avisos de compras recientes solo con compras de verdad
do $$
declare d text;
begin
  select pg_get_functiondef('public.web_evento_publico(text)'::regprocedure) into d;
  if position('invitacion' in d) = 0 then
    d := replace(d, 'where x.evento_id = f.evento_id and x.estado = ''valida'' and x.prueba = v_prueba)',
                    'where x.evento_id = f.evento_id and x.estado = ''valida'' and x.prueba = v_prueba and not exists (select 1 from public.ticket_web_pedidos pi where pi.id = x.pedido_id and pi.estado = ''invitacion''))');
    d := replace(d, 'where x.evento_id = f.evento_id and x.estado = ''valida'' and x.prueba = v_prueba and x.creado_en > now() - interval ''24 hours'')',
                    'where x.evento_id = f.evento_id and x.estado = ''valida'' and x.prueba = v_prueba and x.creado_en > now() - interval ''24 hours'' and not exists (select 1 from public.ticket_web_pedidos pi where pi.id = x.pedido_id and pi.estado = ''invitacion''))');
    d := replace(d, 'and p.estado not in (''anulado'', ''cancelado'', ''reembolsado'', ''pendiente'')',
                    'and p.estado not in (''anulado'', ''cancelado'', ''reembolsado'', ''pendiente'', ''invitacion'')');
    if (length(d) - length(replace(d, 'invitacion', ''))) / 10 < 3 then raise exception 'web_evento_publico: no se han encontrado todas las consultas'; end if;
    execute d;
  end if;
end $$;

-- ===================== CAMBIO DE NOMBRE DE UNA ENTRADA (con precio del organizador) =====================
-- Va después de 20261127100000_ticket_pagos_transparentes.sql.
-- Las entradas no se devuelven; sí se pueden pasar a otra persona:
--  1) En /cambio se sube la entrada (foto o PDF) o se escanea: el QR dice de qué entrada y evento se trata.
--  2) Se ponen los datos de la persona nueva y se paga el precio que fija el organizador (0 = gratis).
--  3) La entrada pasa a un pedido nuevo de la persona nueva, con su propio enlace y un QR nuevo.
--     El QR anterior deja de valer al momento (cambia el nº de emisión de la firma).
-- El dinero del cambio va al organizador en el reparto, con la comisión de TIXFAST como cualquier venta.
-- Solo añade columnas, una tabla y funciones (y unas líneas al principio de tres funciones existentes).

-- ---------- Ajustes del evento ----------
alter table public.ticket_web_eventos add column if not exists cambio_nombre boolean not null default true;
alter table public.ticket_web_eventos add column if not exists cambio_precio numeric(6,2) not null default 0 check (cambio_precio between 0 and 500);
alter table public.ticket_web_eventos add column if not exists cambio_hasta_horas int not null default 0 check (cambio_hasta_horas between 0 and 168);

-- Pedido que nace de un cambio de nombre: de qué pedido viene la entrada (para el reparto y los RRPP)
alter table public.ticket_web_pedidos add column if not exists origen_pedido_id uuid references public.ticket_web_pedidos(id) on delete set null;
-- Tipo de pago: venta de entradas o cambio de nombre
alter table public.ticket_pagos add column if not exists tipo text not null default 'entradas' check (tipo in ('entradas', 'cambio'));
grant select (tipo) on public.ticket_pagos to authenticated;

-- ---------- Registro de cambios ----------
create table if not exists public.ticket_web_cambios (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  evento_id uuid not null references public.ticket_eventos(id) on delete restrict,
  entrada_id uuid not null references public.ticket_web_entradas(id) on delete restrict,
  pedido_origen uuid references public.ticket_web_pedidos(id) on delete set null,
  pedido_nuevo uuid references public.ticket_web_pedidos(id) on delete set null,
  qr_anterior text not null,                       -- el QR que se presentó (si cambia antes de pagar, no se aplica)
  anterior jsonb not null default '{}'::jsonb,     -- titular anterior: nombre (para el historial del organizador)
  nuevo jsonb not null default '{}'::jsonb,        -- nombre, dni, email de la persona nueva
  precio numeric(6,2) not null default 0,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'hecho', 'caducado', 'fallido')),
  motivo text,
  creado_en timestamptz not null default now(),
  hecho_en timestamptz
);
create index if not exists ticket_web_cambios_entrada on public.ticket_web_cambios (entrada_id, estado);
create index if not exists ticket_web_cambios_pedido on public.ticket_web_cambios (pedido_nuevo);
create index if not exists ticket_web_cambios_evento on public.ticket_web_cambios (evento_id, creado_en desc);
alter table public.ticket_web_cambios enable row level security;
drop policy if exists cambios_ver on public.ticket_web_cambios;
create policy cambios_ver on public.ticket_web_cambios for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.ticket_web_cambios from anon, authenticated;
grant select on public.ticket_web_cambios to authenticated;

-- ---------- Comprobaciones comunes ----------
-- Busca la entrada por el contenido del QR (hex de 66 caracteres) y dice si se puede cambiar.
create or replace function public.web_cambio_revisar(p_hex text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hex text := lower(regexp_replace(coalesce(p_hex, ''), '[^0-9a-fA-F]', '', 'g')); v_id uuid; x record; e record; f record; v_ini timestamptz; v_motivo text;
begin
  if length(v_hex) <> 66 then return jsonb_build_object('ok', false, 'motivo', 'qr'); end if;
  begin v_id := (substring(v_hex from 3 for 8) || '-' || substring(v_hex from 11 for 4) || '-' || substring(v_hex from 15 for 4) || '-' || substring(v_hex from 19 for 4) || '-' || substring(v_hex from 23 for 12))::uuid;
  exception when others then return jsonb_build_object('ok', false, 'motivo', 'qr'); end;
  select * into x from public.ticket_web_entradas where id = v_id;
  if x.id is null then return jsonb_build_object('ok', false, 'motivo', 'qr'); end if;
  if x.qr_hex is distinct from v_hex then return jsonb_build_object('ok', false, 'motivo', 'qr_antiguo'); end if;
  select * into e from public.ticket_eventos where id = x.evento_id;
  select * into f from public.ticket_web_eventos where evento_id = x.evento_id;
  begin v_ini := coalesce(nullif(e.inicio::text, '')::timestamp at time zone 'Europe/Madrid', (e.fecha::text || ' 23:59')::timestamp at time zone 'Europe/Madrid');
  exception when others then v_ini := null; end;
  v_motivo := case
    when x.estado <> 'valida' then 'anulada'
    when exists (select 1 from public.ticket_canjes c where c.venta_uuid = x.id) then 'usada'
    when not coalesce(f.cambio_nombre, true) then 'no_permitido'
    when v_ini is not null and now() >= v_ini - make_interval(hours => coalesce(f.cambio_hasta_horas, 0)) then 'plazo'
    when x.emision >= 8 then 'limite'
    when coalesce(f.cambio_precio, 0) > 0 and not x.prueba and not public.pago_real_activo(x.owner_id) then 'sin_cobro'
    when coalesce(f.cambio_precio, 0) > 0 and x.prueba and not (coalesce(f.pago_pruebas, false)) then 'sin_cobro'
    else null end;
  return jsonb_build_object('ok', true, 'puede', v_motivo is null, 'motivo', v_motivo, 'entrada_id', x.id, 'hex', v_hex,
    'precio', case when x.prueba and not coalesce(f.pago_pruebas, false) then 0 else coalesce(f.cambio_precio, 0) end,
    'prueba', x.prueba, 'plazo', case when v_ini is null then null else v_ini - make_interval(hours => coalesce(f.cambio_hasta_horas, 0)) end,
    'evento', jsonb_build_object('nombre', e.nombre, 'fecha', e.fecha, 'inicio', e.inicio, 'recinto', e.recinto, 'flyer', f.flyer_url, 'slug', f.slug),
    'entrada', jsonb_build_object('numero', x.numero, 'tramo', x.tramo_nombre,
      -- Solo el nombre y la inicial del apellido: quien tiene el QR ya lo sabe, pero no se enseña entero
      'titular', btrim(split_part(btrim(x.asistente), ' ', 1) || ' ' || coalesce(left(nullif(split_part(btrim(x.asistente), ' ', 2), ''), 1) || '.', ''))));
end $$;
revoke all on function public.web_cambio_revisar(text) from public, anon, authenticated;

-- Pública: ¿se puede cambiar esta entrada? (con límite de intentos)
create or replace function public.web_cambio_consultar(p_hex text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  if not public.web_intento('cambio', 40, 10) then return jsonb_build_object('ok', false, 'motivo', 'demasiados_intentos'); end if;
  r := public.web_cambio_revisar(p_hex);
  return r - 'entrada_id' - 'hex';
end $$;
revoke all on function public.web_cambio_consultar(text) from public;
grant execute on function public.web_cambio_consultar(text) to anon, authenticated;

-- ---------- Aplicar un cambio (interno) ----------
create or replace function public.web_cambio_ejecutar(p_cambio uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c record; x record; e record; po record; v_msg bytea; v_mac bytea;
begin
  select * into c from public.ticket_web_cambios where id = p_cambio for update;
  if c.id is null or c.estado <> 'pendiente' then return jsonb_build_object('ok', false, 'motivo', coalesce(c.estado, 'no_existe')); end if;
  select * into x from public.ticket_web_entradas where id = c.entrada_id for update;
  -- La entrada tiene que seguir igual que cuando se pidió el cambio (sin usar, sin otro cambio por medio)
  if x.estado <> 'valida' or x.qr_hex is distinct from c.qr_anterior or exists (select 1 from public.ticket_canjes k where k.venta_uuid = x.id) then
    update public.ticket_web_cambios set estado = 'fallido', motivo = 'la entrada cambió o se usó antes de completar el cambio' where id = c.id;
    return jsonb_build_object('ok', false, 'motivo', 'entrada_cambiada');
  end if;
  select * into e from public.ticket_eventos where id = x.evento_id;
  select * into po from public.ticket_web_pedidos where id = x.pedido_id;
  -- QR nuevo: la misma firma con el nº de emisión siguiente (el anterior deja de valer)
  v_msg := substring(decode(x.qr_hex, 'hex') from 1 for 25);
  v_msg := set_byte(v_msg, 17, x.emision);
  v_mac := substring(extensions.hmac(v_msg, decode(e.qr_clave, 'hex'), 'sha256') from 1 for 8);
  update public.ticket_web_entradas set pedido_id = c.pedido_nuevo, emision = x.emision + 1,
         asistente = left(btrim(c.nuevo ->> 'nombre'), 120), dni = nullif(left(btrim(coalesce(c.nuevo ->> 'dni', '')), 30), ''),
         qr_hex = encode(v_msg || v_mac, 'hex') where id = x.id;
  update public.ticket_web_pedidos set estado = case when c.precio > 0 then 'pagado' when po.estado in ('pendiente', 'anulado') then 'pagado' else po.estado end
   where id = c.pedido_nuevo;
  update public.ticket_web_cambios set estado = 'hecho', hecho_en = now() where id = c.id;
  return jsonb_build_object('ok', true, 'acceso', (select acceso from public.ticket_web_pedidos where id = c.pedido_nuevo));
end $$;
revoke all on function public.web_cambio_ejecutar(uuid) from public, anon, authenticated;

-- ---------- Pública: pedir el cambio ----------
-- p_nuevo: { nombre, dni, email }. Gratis → se hace al momento. De pago → devuelve el acceso para pagar.
create or replace function public.web_cambio_solicitar(p_hex text, p_nuevo jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb; x record; po record; v_nom text := btrim(coalesce(p_nuevo ->> 'nombre', '')); v_email text := lower(btrim(coalesce(p_nuevo ->> 'email', '')));
        v_dni text := upper(btrim(coalesce(p_nuevo ->> 'dni', ''))); v_ped uuid; v_cambio uuid; v_precio numeric; v_codigo text; v_ex record;
begin
  if not public.web_intento('cambio_pedir', 10, 10) then return jsonb_build_object('ok', false, 'motivo', 'demasiados_intentos'); end if;
  r := public.web_cambio_revisar(p_hex);
  if not coalesce((r ->> 'ok')::boolean, false) then return r - 'entrada_id' - 'hex'; end if;
  if not coalesce((r ->> 'puede')::boolean, false) then return jsonb_build_object('ok', false, 'motivo', r ->> 'motivo'); end if;
  if length(v_nom) < 5 or length(v_nom) > 120 or position(' ' in v_nom) = 0 then return jsonb_build_object('ok', false, 'motivo', 'nombre'); end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 160 then return jsonb_build_object('ok', false, 'motivo', 'email'); end if;
  if length(v_dni) > 30 then return jsonb_build_object('ok', false, 'motivo', 'dni'); end if;
  select * into x from public.ticket_web_entradas where id = (r ->> 'entrada_id')::uuid for update;
  select * into po from public.ticket_web_pedidos where id = x.pedido_id;
  v_precio := round((r ->> 'precio')::numeric, 2);

  -- Si había otro cambio a medio pagar de esta entrada, se cancela (solo vale el último)
  for v_ex in select * from public.ticket_web_cambios where entrada_id = x.id and estado = 'pendiente' loop
    update public.ticket_web_cambios set estado = 'caducado', motivo = 'sustituido por otro cambio' where id = v_ex.id;
    update public.ticket_pagos set estado = 'caducado' where pedido_id = v_ex.pedido_nuevo and estado = 'pendiente';
    update public.ticket_web_pedidos set estado = 'anulado' where id = v_ex.pedido_nuevo and estado = 'pendiente';
  end loop;

  v_codigo := upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
  insert into public.ticket_web_pedidos (owner_id, evento_id, codigo, email, nombre, datos, total, estado, prueba, rrpp_id, rrpp_efectivo, origen_pedido_id,
                                         ip, agente)
  values (x.owner_id, x.evento_id, v_codigo, v_email, left(v_nom, 120),
          jsonb_build_object('cambio_nombre', true, 'numero', x.numero, 'dni', nullif(v_dni, '')), v_precio,
          case when v_precio > 0 then 'pendiente' else 'pagado' end, x.prueba, po.rrpp_id, po.rrpp_efectivo, coalesce(po.origen_pedido_id, po.id),
          nullif(btrim(coalesce(current_setting('request.headers', true)::jsonb ->> 'cf-connecting-ip', '')), ''),
          left(coalesce(current_setting('request.headers', true)::jsonb ->> 'user-agent', ''), 200))
  returning id into v_ped;
  insert into public.ticket_web_cambios (owner_id, evento_id, entrada_id, pedido_origen, pedido_nuevo, qr_anterior, anterior, nuevo, precio)
  values (x.owner_id, x.evento_id, x.id, x.pedido_id, v_ped, x.qr_hex, jsonb_build_object('nombre', x.asistente),
          jsonb_build_object('nombre', left(v_nom, 120), 'dni', nullif(v_dni, ''), 'email', v_email), v_precio)
  returning id into v_cambio;

  if v_precio <= 0 then
    return public.web_cambio_ejecutar(v_cambio) || jsonb_build_object('hecho', true);
  end if;
  insert into public.ticket_pagos (pedido_id, owner_id, evento_id, modo, entradas, gastos, importe, asistentes, caduca_en, tipo)
  values (v_ped, x.owner_id, x.evento_id, case when x.prueba then 'pruebas' else 'real' end, v_precio, 0, v_precio,
          jsonb_build_array(jsonb_build_object('nombre', left(v_nom, 120), 'precio', v_precio)), now() + interval '30 minutes', 'cambio');
  return jsonb_build_object('ok', true, 'pago', true, 'acceso', (select acceso from public.ticket_web_pedidos where id = v_ped), 'precio', v_precio);
end $$;
revoke all on function public.web_cambio_solicitar(text, jsonb) from public;
grant execute on function public.web_cambio_solicitar(text, jsonb) to anon, authenticated;

-- Pública: cómo va un cambio (la página de vuelta del pago)
create or replace function public.web_cambio_estado(p_acceso uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('ok', true, 'estado', c.estado, 'precio', c.precio, 'nombre', c.nuevo ->> 'nombre',
                     'evento', e.nombre, 'pago', (select g.estado from public.ticket_pagos g where g.pedido_id = p.id))
            from public.ticket_web_pedidos p join public.ticket_web_cambios c on c.pedido_nuevo = p.id join public.ticket_eventos e on e.id = p.evento_id
           where p.acceso = p_acceso order by c.creado_en desc limit 1), jsonb_build_object('ok', false, 'motivo', 'no_existe'))
$$;
revoke all on function public.web_cambio_estado(uuid) from public;
grant execute on function public.web_cambio_estado(uuid) to anon, authenticated;

-- ---------- Pago del cambio: lo confirma Stripe ----------
create or replace function public.web_cambio_pagado(p_pedido uuid, p_sesion text, p_pi text, p_cargo text, p_importe numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g record; c record; r jsonb;
begin
  select * into g from public.ticket_pagos where pedido_id = p_pedido for update;
  if g.pedido_id is null then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if g.estado = 'pagado' then return jsonb_build_object('ok', true, 'ya', true); end if;
  if p_importe is not null and round(p_importe, 2) <> g.importe then return jsonb_build_object('ok', false, 'motivo', 'importe', 'esperado', g.importe, 'pagado', p_importe); end if;
  update public.ticket_pagos set estado = 'pagado', pagado_en = now(), sesion_id = coalesce(p_sesion, sesion_id),
         payment_intent = coalesce(p_pi, payment_intent), cargo_id = coalesce(p_cargo, cargo_id) where pedido_id = p_pedido;
  select * into c from public.ticket_web_cambios where pedido_nuevo = p_pedido order by creado_en desc limit 1;
  if c.id is null then return jsonb_build_object('ok', false, 'motivo', 'sin_cambio'); end if;
  if c.estado = 'caducado' then update public.ticket_web_cambios set estado = 'pendiente' where id = c.id; end if;   -- pagó justo al caducar
  r := public.web_cambio_ejecutar(c.id);
  -- Si la entrada cambió entre medias, el pedido queda pagado sin entrada: lo resuelve el organizador (aparece como «fallido»)
  if not coalesce((r ->> 'ok')::boolean, false) then update public.ticket_web_pedidos set estado = 'pagado' where id = p_pedido; end if;
  return r || jsonb_build_object('ok', true);
end $$;
revoke all on function public.web_cambio_pagado(uuid, text, text, text, numeric) from public, anon, authenticated;

-- pago_emitir y pago_caducar sirven también para los cambios (así el aviso de Stripe y la vuelta del pago no cambian).
-- Cada parche se aplica por separado (si uno ya estaba, los demás se aplican igual).
do $$
declare d text;
begin
  select pg_get_functiondef('public.pago_emitir(uuid,text,text,text,numeric)'::regprocedure) into d;
  if position('web_cambio_pagado' in d) = 0 then
    d := replace(d, $a$if g.estado = 'pagado' then return jsonb_build_object('ok', true, 'ya', true); end if;$a$,
                    $b$if g.estado = 'pagado' then return jsonb_build_object('ok', true, 'ya', true); end if;
  if g.tipo = 'cambio' then return public.web_cambio_pagado(p_pedido, p_sesion, p_pi, p_cargo, p_importe); end if;$b$);
    if position('web_cambio_pagado' in d) = 0 then raise exception 'pago_emitir: no se ha encontrado dónde desviar los cambios'; end if;
    execute d;
  end if;

  select pg_get_functiondef('public.pago_caducar(uuid)'::regprocedure) into d;
  if position('ticket_web_cambios' in d) = 0 then
    d := replace(d, $a$if g.pedido_id is null or g.estado <> 'pendiente' then return jsonb_build_object('ok', false, 'motivo', coalesce(g.estado, 'no_existe')); end if;$a$,
                    $b$if g.pedido_id is null or g.estado <> 'pendiente' then return jsonb_build_object('ok', false, 'motivo', coalesce(g.estado, 'no_existe')); end if;
  if g.tipo = 'cambio' then   -- un cambio sin pagar: no había plazas apartadas
    update public.ticket_pagos set estado = 'caducado' where pedido_id = p_pedido;
    update public.ticket_web_pedidos set estado = 'anulado' where id = p_pedido;
    update public.ticket_web_cambios set estado = 'caducado', motivo = 'no se pagó a tiempo' where pedido_nuevo = p_pedido and estado = 'pendiente';
    return jsonb_build_object('ok', true);
  end if;$b$);
    if position('ticket_web_cambios' in d) = 0 then raise exception 'pago_caducar: no se ha encontrado dónde desviar los cambios'; end if;
    execute d;
  end if;

  -- El cambio gratuito de «Mis entradas» respeta lo que decida el organizador
  select pg_get_functiondef('public.web_cambiar_titular(uuid,int,text,text)'::regprocedure) into d;
  if position('cambio_precio' in d) = 0 then
    d := replace(d, $a$  select * into e from public.ticket_eventos where id = x.evento_id;$a$,
                    $b$  select * into e from public.ticket_eventos where id = x.evento_id;
  if exists (select 1 from public.ticket_web_eventos w where w.evento_id = x.evento_id and not w.cambio_nombre) then return jsonb_build_object('ok', false, 'motivo', 'no_permitido'); end if;
  if exists (select 1 from public.ticket_web_eventos w where w.evento_id = x.evento_id and w.cambio_precio > 0) and not x.prueba then return jsonb_build_object('ok', false, 'motivo', 'de_pago'); end if;$b$);
    if position('cambio_precio' in d) = 0 then raise exception 'web_cambiar_titular: no se ha encontrado dónde añadir el precio'; end if;
    execute d;
  end if;
end $$;

-- ---------- Reparto: la entrada cambiada sigue contando para el RRPP que la vendió ----------
create or replace function public.pago_reparto_calculo(p_evento uuid, p_modo text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with ent as (
    select x.rrpp_id, x.tramo_id, x.precio, p.rrpp_efectivo, g.pedido_id is not null as online
      from public.ticket_web_entradas x join public.ticket_web_pedidos p on p.id = x.pedido_id
      left join public.ticket_pagos g on g.pedido_id = coalesce(p.origen_pedido_id, p.id) and g.estado = 'pagado' and g.modo = p_modo and g.tipo = 'entradas'
     where x.evento_id = p_evento and x.estado = 'valida' and x.prueba = (p_modo = 'pruebas')
       and (g.pedido_id is not null or p.rrpp_efectivo)
  ),
  r as (
    select e.rrpp_id, count(*) n, count(*) filter (where e.online) n_online, count(*) filter (where e.rrpp_efectivo) n_efectivo,
           coalesce(sum(public.rrpp_comision(p_evento, e.rrpp_id, e.tramo_id, e.precio)), 0) comision,
           coalesce(sum(e.precio) filter (where e.rrpp_efectivo), 0) efectivo
      from ent e where e.rrpp_id is not null group by e.rrpp_id
  ),
  pg as (select * from public.ticket_pagos where evento_id = p_evento and estado in ('pagado', 'devuelto') and modo = p_modo),
  ef as (select * from public.pago_comision_efectivo(p_evento, p_modo)),
  t as (select coalesce(sum(entradas), 0) cobrado, coalesce(sum(gastos), 0) gastos, coalesce(sum(comision), 0) comision,
               coalesce(sum(devuelto), 0) devuelto, coalesce(sum(entradas) filter (where tipo = 'cambio'), 0) cambios from pg)
  select jsonb_build_object(
    'evento', p_evento,
    'owner_id', (select owner_id from public.ticket_web_eventos where evento_id = p_evento),
    'cobrado', t.cobrado, 'gastos', t.gastos, 'comision', t.comision, 'devuelto', t.devuelto, 'cambios', t.cambios,
    'efectivo_entradas', ef.entradas, 'efectivo_ventas', ef.ventas, 'comision_efectivo', ef.comision,
    'disponible', t.cobrado + t.gastos - t.comision - t.devuelto - ef.comision,
    'pendientes', (select count(*) from public.ticket_pagos where evento_id = p_evento and estado = 'pendiente' and modo = p_modo),
    'cargos', (select coalesce(jsonb_agg(jsonb_build_object('cargo', cargo_id, 'entradas', greatest(entradas + gastos - comision - devuelto, 0)) order by pagado_en), '[]'::jsonb)
                 from pg where cargo_id is not null),
    'rrpp', (select coalesce(jsonb_agg(jsonb_build_object('rrpp_id', r.rrpp_id, 'nombre', k.nombre, 'user_id', k.user_id,
               'entradas', r.n, 'online', r.n_online, 'en_efectivo', r.n_efectivo, 'comision', r.comision, 'efectivo', r.efectivo,
               'neto', greatest(r.comision - r.efectivo, 0), 'debe', greatest(r.efectivo - r.comision, 0))), '[]'::jsonb)
               from r join public.ticket_rrpp k on k.id = r.rrpp_id)
  ) from t, ef
$$;
revoke all on function public.pago_reparto_calculo(uuid, text) from public, anon, authenticated;

-- ---------- CRM: el dinero de los cambios de nombre entra como ingreso del evento ----------
create or replace function public.pago_sync_crm(p_evento uuid, p_modo text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_gastos numeric; v_com numeric; v_cambios numeric; v_ncambios int; v_marca text := 'tixfast:comision';
begin
  if p_modo <> 'real' then return; end if;   -- los pagos de prueba no entran en las cuentas
  select owner_id into v_owner from public.ticket_web_eventos where evento_id = p_evento;
  if v_owner is null then return; end if;
  select coalesce(sum(gastos) filter (where estado = 'pagado'), 0), coalesce(sum(comision), 0),
         coalesce(sum(entradas) filter (where estado = 'pagado' and tipo = 'cambio'), 0), count(*) filter (where estado = 'pagado' and tipo = 'cambio')
    into v_gastos, v_com, v_cambios, v_ncambios
    from public.ticket_pagos where evento_id = p_evento and modo = 'real' and estado in ('pagado', 'devuelto');
  v_com := v_com + coalesce((select comision from public.pago_comision_efectivo(p_evento, 'real')), 0);
  if v_gastos <= 0 then
    delete from public.ticket_crm_ingresos where evento_id = p_evento and ref_externa = 'txgastos' and origen = 'tixfast';
  else
    insert into public.ticket_crm_ingresos (owner_id, evento_id, categoria, concepto, importe, fecha, metodo, estado, origen, ref_externa, unidades, actualizado_en)
    values (v_owner, p_evento, 'Ticketera online', 'TIXFAST · Gastos de gestión cobrados', round(v_gastos, 2), current_date, 'tarjeta', 'cobrado', 'tixfast', 'txgastos', 0, now())
    on conflict (evento_id, ref_externa) do update set importe = excluded.importe, actualizado_en = now();
  end if;
  if v_cambios <= 0 then
    delete from public.ticket_crm_ingresos where evento_id = p_evento and ref_externa = 'txcambios' and origen = 'tixfast';
  else
    insert into public.ticket_crm_ingresos (owner_id, evento_id, categoria, concepto, importe, fecha, metodo, estado, origen, ref_externa, unidades, actualizado_en)
    values (v_owner, p_evento, 'Ticketera online', 'TIXFAST · Cambios de nombre', round(v_cambios, 2), current_date, 'tarjeta', 'cobrado', 'tixfast', 'txcambios', 0, now())
    on conflict (evento_id, ref_externa) do update set importe = excluded.importe, actualizado_en = now();
  end if;
  delete from public.ticket_crm_gastos where evento_id = p_evento and nota = v_marca;
  if v_com > 0 then
    insert into public.ticket_crm_gastos (owner_id, evento_id, tipo, categoria, concepto, proveedor, previsto, real, estado, fecha, nota, iva, factura)
    values (v_owner, p_evento, 'normal', 'Ticketing y pagos', 'Comisión TIXFAST (venta de entradas)', 'TIXFAST', round(v_com, 2), round(v_com, 2), 'pagado', current_date,
            v_marca, (select iva from public.ticket_plataforma_ajustes where id), true);
  end if;
end $$;
revoke all on function public.pago_sync_crm(uuid, text) from public, anon, authenticated;

-- ---------- Factura: los cambios se cuentan aparte de las entradas en el concepto ----------
do $$
declare d text;
begin
  select pg_get_functiondef('public.plataforma_facturar_evento(uuid,text)'::regprocedure) into d;
  if position('cambios de nombre' in d) > 0 then return; end if;
  d := replace(d, $a$coalesce(sum(jsonb_array_length(asistentes)) filter (where comision > 0), 0) n, sum(coste_stripe) stripe$a$,
                  $b$coalesce(sum(jsonb_array_length(asistentes)) filter (where comision > 0 and tipo = 'entradas'), 0) n,
         count(*) filter (where comision > 0 and tipo = 'cambio') nc, sum(coste_stripe) stripe$b$);
  d := replace(d, $a$|| case when ef.comision > 0 then format(' (%s en efectivo vía RRPP)', ef.entradas) else '' end;$a$,
                  $b$|| case when ef.comision > 0 then format(' (%s en efectivo vía RRPP)', ef.entradas) else '' end
           || case when x.nc > 0 then format(' y %s %s', x.nc, case when x.nc = 1 then 'cambio de nombre' else 'cambios de nombre' end) else '' end;$b$);
  if position('cambios de nombre' in d) = 0 or position('nc, sum(coste_stripe)' in d) = 0 then raise exception 'plataforma_facturar_evento: no se ha podido añadir los cambios'; end if;
  execute d;
end $$;

-- Historial del organizador: cambios de nombre de un evento
create or replace function public.web_cambios_evento(p_evento uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'estado', c.estado, 'precio', c.precio, 'anterior', c.anterior ->> 'nombre',
           'nuevo', c.nuevo ->> 'nombre', 'email', c.nuevo ->> 'email', 'numero', x.numero, 'tramo', x.tramo_nombre, 'creado_en', c.creado_en, 'hecho_en', c.hecho_en, 'motivo', c.motivo)
           order by c.creado_en desc), '[]'::jsonb)
    from public.ticket_web_cambios c join public.ticket_web_entradas x on x.id = c.entrada_id
   where c.evento_id = p_evento and c.owner_id = (select auth.uid()) and c.estado in ('hecho', 'fallido')
$$;
revoke all on function public.web_cambios_evento(uuid) from public, anon;
grant execute on function public.web_cambios_evento(uuid) to authenticated;

-- La página del evento enseña si se permite cambiar el nombre y cuánto cuesta (aviso de «no se devuelven»)
do $$
declare d text;
begin
  select pg_get_functiondef('public.web_evento_publico(text)'::regprocedure) into d;
  if position('cambio_precio' in d) > 0 then return; end if;
  d := replace(d, $a$'pago_pruebas', coalesce(f.pago_pruebas, false),$a$,
                  $b$'pago_pruebas', coalesce(f.pago_pruebas, false), 'cambio_nombre', f.cambio_nombre, 'cambio_precio', f.cambio_precio,$b$);
  if position('cambio_precio' in d) = 0 then raise exception 'web_evento_publico: no se ha encontrado dónde añadir el cambio de nombre'; end if;
  execute d;
end $$;

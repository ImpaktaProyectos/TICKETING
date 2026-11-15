-- =====================================================================
-- TIXFAST · RESERVA ONLINE DE RESERVADOS VIP
-- ---------------------------------------------------------------------
-- · ticket_reservas_web: el enlace público de cada evento (token imposible de adivinar),
--   el % de adelanto, las condiciones y las bebidas/mezclas que se ofrecen.
-- · ticket_reserva_pedidos: cada reserva hecha por la web (cliente, pack, botellas, importes,
--   pago en Stripe). El cliente ve la suya con su «acceso» secreto; el organizador, las suyas.
-- · Al empezar a pagar, la mesa queda «pendiente» (bloqueada para todos) unos 35 minutos.
--   Si se paga → pasa a «reservado» con todos los datos; si no → vuelve a «libre» sola.
-- · El precio SIEMPRE lo calcula el servidor con la configuración del evento (nunca el navegador).
-- · La página pública solo ve qué mesas están libres: nunca nombres ni teléfonos de otros clientes.
-- =====================================================================

-- Nuevo estado «pendiente» (alguien está pagando la reserva por la web) y enlace al pedido web
alter table public.ticket_reservados drop constraint if exists ticket_reservados_estado_check;
alter table public.ticket_reservados add constraint ticket_reservados_estado_check
  check (estado = any (array['libre', 'pendiente', 'reservado', 'llegado', 'novino']));
alter table public.ticket_reservados add column if not exists web_pedido_id uuid;

create table if not exists public.ticket_reservas_web (
  evento_id uuid primary key references public.ticket_eventos(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  activo boolean not null default false,
  adelanto_pct int not null default 50 check (adelanto_pct between 0 and 100),
  condiciones text check (condiciones is null or length(condiciones) <= 2000),
  bebidas jsonb not null default '[]'::jsonb check (jsonb_typeof(bebidas) = 'array' and jsonb_array_length(bebidas) <= 80),
  mezclas jsonb not null default '[]'::jsonb check (jsonb_typeof(mezclas) = 'array' and jsonb_array_length(mezclas) <= 40),
  max_extra int not null default 4 check (max_extra between 0 and 20),
  actualizado_en timestamptz not null default now()
);
alter table public.ticket_reservas_web enable row level security;
drop policy if exists owner_all on public.ticket_reservas_web;
create policy owner_all on public.ticket_reservas_web for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()) and public.ticket_owns_evento(evento_id));
revoke all on public.ticket_reservas_web from anon;
grant select, insert, update, delete on public.ticket_reservas_web to authenticated;

create table if not exists public.ticket_reserva_pedidos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  evento_id uuid not null references public.ticket_eventos(id) on delete cascade,
  reservado_id uuid references public.ticket_reservados(id) on delete set null,
  mesa text not null,
  acceso uuid not null unique default gen_random_uuid(),
  codigo text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'pagado', 'caducado', 'cancelado', 'conflicto')),
  nombre text not null check (length(nombre) between 2 and 120),
  telefono text not null check (length(telefono) between 6 and 40),
  email text check (email is null or length(email) <= 160),
  personas int check (personas is null or personas between 1 and 500),
  tarifa_id text not null,
  tarifa_nombre text not null,
  botellas jsonb not null default '[]'::jsonb,
  total numeric(10,2) not null check (total >= 0),
  adelanto numeric(10,2) not null check (adelanto >= 0),
  gastos numeric(10,2) not null default 0 check (gastos >= 0),
  modo text check (modo in ('real', 'pruebas')),
  sesion_id text,
  pago_id text,
  creado_en timestamptz not null default now(),
  caduca_en timestamptz not null,
  pagado_en timestamptz
);
create index if not exists ticket_reserva_pedidos_evento on public.ticket_reserva_pedidos (evento_id, creado_en desc);
create index if not exists ticket_reserva_pedidos_pendientes on public.ticket_reserva_pedidos (caduca_en) where estado = 'pendiente';
alter table public.ticket_reserva_pedidos enable row level security;
drop policy if exists owner_select on public.ticket_reserva_pedidos;
create policy owner_select on public.ticket_reserva_pedidos for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.ticket_reserva_pedidos from anon, authenticated;
grant select on public.ticket_reserva_pedidos to authenticated;

-- El equipo no puede pisar por error una mesa que un cliente está pagando por la web
create or replace function public.ticket_reservados_guarda_web()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Solo cambios hechos desde la app (rol authenticated); las funciones del servidor (pago, caducidad) sí pueden
  if current_user = 'authenticated' and old.estado = 'pendiente' and new.estado not in ('pendiente', 'libre') then
    raise exception using errcode = 'P0001', message = 'TIXFAST: un cliente está pagando esta mesa por la web. Espera unos minutos o libérala primero.';
  end if;
  if current_user = 'authenticated' then new.web_pedido_id := case when new.estado = 'libre' then null else old.web_pedido_id end; end if;
  return new;
end $$;
drop trigger if exists ticket_reservados_guarda_web on public.ticket_reservados;
create trigger ticket_reservados_guarda_web before update on public.ticket_reservados for each row execute function public.ticket_reservados_guarda_web();

-- ---------- Precio de una reserva (mismas reglas que el TPV: pack + botellas extra) ----------
create or replace function public.reservas_precio_extra(p_cfg jsonb)
returns numeric language sql immutable set search_path = '' as $$
  select round((x ->> 'precio')::numeric / greatest(1, coalesce(nullif(x ->> 'botellas', '')::int, 1)), 2)
  from jsonb_array_elements(coalesce(p_cfg -> 'extras', '[]')) x
  where coalesce(nullif(x ->> 'botellas', '')::int, 0) > 0 and nullif(x ->> 'precio', '') is not null
  order by (coalesce(nullif(x ->> 'botellas', '')::int, 0) = 1) desc limit 1;
$$;

-- ---------- Página pública: lo que cualquiera con el enlace puede ver ----------
create or replace function public.reservas_publico(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare w record; e record; cfg jsonb; acc record; plano jsonb;
begin
  select * into w from public.ticket_reservas_web where token = p_token;
  if not found or not w.activo then return null; end if;
  select * into e from public.ticket_eventos where id = w.evento_id;
  if not found or coalesce(e.cerrada, false) then return null; end if;
  -- La reserva online va con la suscripción (como los reservados)
  select * into acc from public.ticket_acceso_de(w.owner_id);
  if found and coalesce(acc.limites -> 'bloquea' ? 'reservados', false)
     and not (acc.fin_acceso is not null and e.creado_en <= acc.fin_acceso and coalesce(e.fecha, current_date) >= current_date - 1) then
    return null;
  end if;
  cfg := coalesce(e.ticket_style -> 'reservados', '{}'::jsonb);
  -- Del plano solo se publica la forma (nunca notas internas)
  plano := case when jsonb_typeof(cfg -> 'plano') = 'object' then jsonb_build_object(
      'ancho', cfg -> 'plano' -> 'ancho', 'largo', cfg -> 'plano' -> 'largo',
      'elementos', coalesce((select jsonb_agg(jsonb_build_object('id', x -> 'id', 'tipo', x -> 'tipo', 'x', x -> 'x', 'y', x -> 'y', 'w', x -> 'w', 'h', x -> 'h',
          'rot', x -> 'rot', 'texto', x -> 'texto', 'forma', x -> 'forma', 'reservadoId', x -> 'reservadoId'))
        from jsonb_array_elements(coalesce(cfg -> 'plano' -> 'elementos', '[]')) x), '[]'::jsonb)) end;
  return jsonb_build_object(
    'ahora', now(),
    'evento', jsonb_build_object('nombre', e.nombre, 'fecha', e.fecha, 'inicio', e.inicio, 'recinto', e.recinto,
      'flyer', (select flyer_url from public.ticket_web_eventos where evento_id = e.id), 'logo', nullif(e.logo_url, '')),
    'online', jsonb_build_object('adelanto_pct', w.adelanto_pct, 'condiciones', w.condiciones, 'bebidas', w.bebidas, 'mezclas', w.mezclas, 'max_extra', w.max_extra,
      'pago', exists (select 1 from public.ticket_pago_cuentas c where c.user_id = w.owner_id and c.tipo = 'organizador' and c.estado = 'activa' and c.recibe) or w.adelanto_pct = 0),
    'plano', plano,
    'legal', public.web_legal_de(w.owner_id),
    'precio_extra', public.reservas_precio_extra(cfg),
    'tarifas', coalesce((select jsonb_agg(jsonb_build_object('id', t ->> 'id', 'nombre', t ->> 'nombre', 'precio', (t ->> 'precio')::numeric,
        'botellas', coalesce(nullif(t ->> 'botellas', '')::int, 0), 'incluye', t ->> 'incluye', 'emoji', t ->> 'emoji', 'tamano', coalesce(t ->> 'tamano', '')))
      from jsonb_array_elements(coalesce(cfg -> 'tarifas', '[]')) t
      where coalesce((t ->> 'online')::boolean, true) and nullif(t ->> 'precio', '') is not null), '[]'::jsonb),
    'mesas', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'nombre', r.nombre, 'tamano', r.tamano, 'personas', r.personas,
        'libre', r.estado = 'libre') order by r.orden, r.nombre)
      from public.ticket_reservados r where r.evento_id = e.id), '[]'::jsonb)
  );
end $$;
revoke all on function public.reservas_publico(uuid) from public;
grant execute on function public.reservas_publico(uuid) to anon, authenticated;

-- La reserva de un cliente (con su acceso secreto): para la página de confirmación
create or replace function public.reservas_pedido(p_acceso uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('codigo', p.codigo, 'estado', p.estado, 'mesa', p.mesa, 'nombre', p.nombre, 'personas', p.personas,
    'tarifa', p.tarifa_nombre, 'botellas', p.botellas, 'total', p.total, 'adelanto', p.adelanto, 'gastos', p.gastos,
    'resto', greatest(p.total - p.adelanto, 0), 'caduca_en', p.caduca_en, 'pagado_en', p.pagado_en,
    'evento', jsonb_build_object('nombre', e.nombre, 'fecha', e.fecha, 'inicio', e.inicio, 'recinto', e.recinto))
  from public.ticket_reserva_pedidos p join public.ticket_eventos e on e.id = p.evento_id where p.acceso = p_acceso;
$$;
revoke all on function public.reservas_pedido(uuid) from public;
grant execute on function public.reservas_pedido(uuid) to anon, authenticated;

-- ---------- Solo el servidor (función reservas-web) ----------
-- Bloquea la mesa y apunta el pedido con el precio calculado aquí
create or replace function public.reservas_crear(p_token uuid, p_reservado uuid, p_tarifa text, p_botellas jsonb, p_cliente jsonb, p_personas int, p_modo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare w record; e record; r record; cfg jsonb; t jsonb; incl int; nbot int; extra numeric; total numeric; adelanto numeric; gastos numeric; p record; bots jsonb;
begin
  select * into w from public.ticket_reservas_web where token = p_token and activo;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'cerrada'); end if;
  if public.reservas_publico(p_token) is null then return jsonb_build_object('ok', false, 'motivo', 'cerrada'); end if;
  select * into e from public.ticket_eventos where id = w.evento_id;
  cfg := coalesce(e.ticket_style -> 'reservados', '{}'::jsonb);
  select x into t from jsonb_array_elements(coalesce(cfg -> 'tarifas', '[]')) x where x ->> 'id' = p_tarifa and coalesce((x ->> 'online')::boolean, true) limit 1;
  if t is null or nullif(t ->> 'precio', '') is null then return jsonb_build_object('ok', false, 'motivo', 'pack'); end if;
  -- Datos del cliente
  if length(btrim(coalesce(p_cliente ->> 'nombre', ''))) < 2 or length(regexp_replace(coalesce(p_cliente ->> 'telefono', ''), '\D', '', 'g')) < 9 then
    return jsonb_build_object('ok', false, 'motivo', 'datos');
  end if;
  -- Botellas: las del pack + extras (hasta el máximo); cada una con bebida y mezcla de las ofrecidas
  incl := greatest(0, coalesce(nullif(t ->> 'botellas', '')::int, 0));
  select coalesce(jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'bebida', left(btrim(coalesce(b ->> 'bebida', '')), 60), 'mezcla', left(btrim(coalesce(b ->> 'mezcla', '')), 60))), '[]'::jsonb)
    into bots from jsonb_array_elements(case when jsonb_typeof(p_botellas) = 'array' then p_botellas else '[]'::jsonb end) b;
  nbot := jsonb_array_length(bots);
  if nbot > incl + w.max_extra then return jsonb_build_object('ok', false, 'motivo', 'botellas'); end if;
  extra := public.reservas_precio_extra(cfg);
  if nbot > incl and extra is null then return jsonb_build_object('ok', false, 'motivo', 'botellas'); end if;
  total := round((t ->> 'precio')::numeric + greatest(nbot - incl, 0) * coalesce(extra, 0), 2);
  adelanto := round(total * w.adelanto_pct / 100.0, 2);
  gastos := public.pago_gastos(adelanto);
  -- La mesa: libre y de este evento (se bloquea la fila para que nadie la coja a la vez)
  select * into r from public.ticket_reservados where id = p_reservado and evento_id = e.id for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'mesa'); end if;
  if r.estado <> 'libre' then return jsonb_build_object('ok', false, 'motivo', 'ocupada'); end if;
  if coalesce(nullif(t ->> 'tamano', ''), r.tamano) <> r.tamano then return jsonb_build_object('ok', false, 'motivo', 'pack'); end if;
  if p_personas is not null and r.personas is not null and p_personas > r.personas then return jsonb_build_object('ok', false, 'motivo', 'personas'); end if;
  insert into public.ticket_reserva_pedidos (owner_id, evento_id, reservado_id, mesa, codigo, nombre, telefono, email, personas, tarifa_id, tarifa_nombre, botellas, total, adelanto, gastos, modo, caduca_en)
  values (w.owner_id, e.id, r.id, r.nombre, 'R-' || upper(substr(md5(gen_random_uuid()::text), 1, 6)),
    left(btrim(p_cliente ->> 'nombre'), 120), left(btrim(p_cliente ->> 'telefono'), 40), nullif(left(lower(btrim(coalesce(p_cliente ->> 'email', ''))), 160), ''),
    case when p_personas between 1 and 500 then p_personas end, t ->> 'id', left(coalesce(t ->> 'nombre', 'Reserva'), 80), bots, total, adelanto, gastos,
    case when p_modo in ('real', 'pruebas') then p_modo end, now() + interval '35 minutes')
  returning * into p;
  update public.ticket_reservados set estado = 'pendiente', web_pedido_id = p.id, actualizado_en = now() where id = r.id;
  return jsonb_build_object('ok', true, 'id', p.id, 'acceso', p.acceso, 'codigo', p.codigo, 'mesa', p.mesa, 'evento', e.nombre, 'owner', w.owner_id,
    'total', total, 'adelanto', adelanto, 'gastos', gastos, 'caduca_en', p.caduca_en, 'email', p.email, 'token', w.token);
end $$;
revoke all on function public.reservas_crear(uuid, uuid, text, jsonb, jsonb, int, text) from public, anon, authenticated;
grant execute on function public.reservas_crear(uuid, uuid, text, jsonb, jsonb, int, text) to service_role;

-- Pago hecho: la mesa pasa a reservada con todos los datos del cliente (idempotente)
create or replace function public.reservas_confirmar(p_pedido uuid, p_sesion text, p_pago text, p_importe numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p record; r record;
begin
  select * into p from public.ticket_reserva_pedidos where id = p_pedido for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if p.estado = 'pagado' then return jsonb_build_object('ok', true, 'ya', true); end if;
  select * into r from public.ticket_reservados where id = p.reservado_id for update;
  -- Si la mesa ya no es suya (caducó y la cogió otro), se marca para devolver el dinero a mano
  if not found or not ((coalesce(r.web_pedido_id = p.id, false) and r.estado = 'pendiente') or r.estado = 'libre') then
    update public.ticket_reserva_pedidos set estado = 'conflicto', sesion_id = coalesce(p_sesion, sesion_id), pago_id = coalesce(p_pago, pago_id), pagado_en = now() where id = p.id;
    return jsonb_build_object('ok', false, 'motivo', 'conflicto');
  end if;
  update public.ticket_reserva_pedidos set estado = 'pagado', sesion_id = coalesce(p_sesion, sesion_id), pago_id = coalesce(p_pago, pago_id), pagado_en = now() where id = p.id;
  update public.ticket_reservados set
    estado = 'reservado', web_pedido_id = p.id, cliente = p.nombre, telefono = p.telefono, tarifa_id = p.tarifa_id,
    senal = p.adelanto, senal_metodo = case when p.adelanto > 0 then 'tarjeta' end, senal_socio = null,
    nota = left(concat_ws(' · ', '🌐 Reserva web ' || p.codigo, case when p.adelanto > 0 then 'adelanto pagado con tarjeta' end, p.email), 500),
    pedido = jsonb_build_object('personas', p.personas, 'botellas', p.botellas, 'precioModo', 'auto'),
    actualizado_en = now()
  where id = r.id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.reservas_confirmar(uuid, text, text, numeric) from public, anon, authenticated;
grant execute on function public.reservas_confirmar(uuid, text, text, numeric) to service_role;

-- No se pagó (caducó o el cliente volvió atrás): la mesa vuelve a estar libre
create or replace function public.reservas_liberar(p_pedido uuid, p_estado text default 'caducado')
returns void language plpgsql security definer set search_path = '' as $$
declare p record;
begin
  select * into p from public.ticket_reserva_pedidos where id = p_pedido for update;
  if not found or p.estado <> 'pendiente' then return; end if;
  update public.ticket_reserva_pedidos set estado = case when p_estado = 'cancelado' then 'cancelado' else 'caducado' end where id = p.id;
  update public.ticket_reservados set estado = 'libre', web_pedido_id = null, actualizado_en = now()
    where id = p.reservado_id and web_pedido_id = p.id and estado = 'pendiente';
end $$;
revoke all on function public.reservas_liberar(uuid, text) from public, anon, authenticated;
grant execute on function public.reservas_liberar(uuid, text) to service_role;

-- Cada 5 minutos: se confirman los pagos hechos y se liberan las mesas no pagadas
do $c$
begin
  if exists (select 1 from cron.job where jobname = 'tixfast-reservas-web') then perform cron.unschedule('tixfast-reservas-web'); end if;
  perform cron.schedule('tixfast-reservas-web', '*/5 * * * *', $job$
    select net.http_post(
      url := 'https://xnhcquehlyalwgqmdiov.supabase.co/functions/v1/reservas-web',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('accion', 'mantenimiento', 'clave', (select valor from public.ticket_pago_config where clave = 'cron_clave'))
    );
  $job$);
end $c$;

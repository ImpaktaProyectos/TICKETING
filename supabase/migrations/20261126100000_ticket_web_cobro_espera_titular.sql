-- TIXFAST · Venta online: cobro real con tarjeta, límite de intentos de códigos, lista de espera y cambio de titular
-- (va después de 20261126090000_ticket_web_descuentos_invitaciones.sql)

-- ---------- 1) Cobro real con tarjeta ----------
-- Se cobra con tarjeta en un evento real cuando el organizador tiene su monedero de cobros (Stripe Connect)
-- dado de alta en modo real y activo. Esa cuenta solo se puede crear con la clave real de Stripe puesta.
create or replace function public.pago_real_activo(p_owner uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.ticket_pago_cuentas c
                  where c.user_id = p_owner and c.tipo = 'organizador' and c.modo = 'real' and c.estado = 'activa' and c.recibe);
$$;
revoke all on function public.pago_real_activo(uuid) from public, anon;
grant execute on function public.pago_real_activo(uuid) to authenticated, service_role;

-- web_comprar: en real, si el organizador puede cobrar, se reserva el pedido y se paga con Stripe (como ya pasaba en pruebas).
-- Cada asistente lleva su precio (con el descuento aplicado) para que el pago y las entradas cuadren.
-- En el carrito de varios eventos no se cobra en real (cada evento se paga en su página).
do $$
declare d text; n int := 0;
begin
  select pg_get_functiondef('public.web_comprar(text,jsonb,jsonb,jsonb)'::regprocedure) into d;
  if position('pago_real_activo' in d) > 0 then return; end if;
  d := replace(d, $a$if v_pu > 0 and not v_prueba and coalesce(current_setting('tixfast.rrpp_venta', true), '') = '' then return$a$,
                  $b$if v_pu > 0 and not v_prueba and coalesce(current_setting('tixfast.rrpp_venta', true), '') = '' and (v_suave or not public.pago_real_activo(f.owner_id)) then return$b$);
  d := replace(d, $a$v_pago := v_prueba and coalesce(f.pago_pruebas, false) and v_total > 0 and coalesce(current_setting('tixfast.rrpp_venta', true), '') = '';$a$,
                  $b$v_pago := v_total > 0 and coalesce(current_setting('tixfast.rrpp_venta', true), '') = ''
             and ((v_prueba and coalesce(f.pago_pruebas, false)) or (not v_prueba and not v_suave and public.pago_real_activo(f.owner_id)));$b$);
  d := replace(d, $a$values (v_pedido, f.owner_id, f.evento_id, 'pruebas', v_total, v_gastos, v_total + v_gastos, p_asistentes,$a$,
                  $b$values (v_pedido, f.owner_id, f.evento_id, case when v_prueba then 'pruebas' else 'real' end, v_total, v_gastos, v_total + v_gastos,
            (select jsonb_agg(x || jsonb_build_object('precio', (precios ->> (x ->> 'tramo'))::numeric)) from jsonb_array_elements(p_asistentes) x),$b$);
  n := (length(d) - length(replace(d, 'pago_real_activo', ''))) / length('pago_real_activo');
  if n < 2 or position($c$case when v_prueba then 'pruebas' else 'real' end$c$ in d) = 0 then raise exception 'web_comprar: no se han encontrado los puntos a cambiar'; end if;
  execute d;
end $$;

-- pago_emitir: cada entrada pagada guarda el precio que se cobró (con descuento), no el de lista
do $$
declare d text;
begin
  select pg_get_functiondef('public.pago_emitir(uuid,text,text,text,numeric)'::regprocedure) into d;
  if position($a$(a ->> 'precio')$a$ in d) > 0 then return; end if;
  d := replace(d, $a$nullif(left(btrim(coalesce(a ->> 'dni', '')), 30), ''), t.precio, p.prueba,$a$,
                  $b$nullif(left(btrim(coalesce(a ->> 'dni', '')), 30), ''), coalesce((a ->> 'precio')::numeric, t.precio), p.prueba,$b$);
  if position($a$(a ->> 'precio')$a$ in d) = 0 then raise exception 'pago_emitir: no se ha encontrado el precio'; end if;
  execute d;
end $$;

-- La página pública necesita saber si el evento cobra con tarjeta (para enseñar los gastos y el botón «Pagar»)
do $$
declare d text;
begin
  select pg_get_functiondef('public.web_evento_publico(text)'::regprocedure) into d;
  if position('cobro_real' in d) > 0 then return; end if;
  d := replace(d, $a$'pago_pruebas', coalesce(f.pago_pruebas, false),$a$,
                  $b$'pago_pruebas', coalesce(f.pago_pruebas, false), 'cobro_real', f.modo <> 'pruebas' and f.estado <> 'borrador' and public.pago_real_activo(f.owner_id),$b$);
  if position('cobro_real' in d) = 0 then raise exception 'web_evento_publico: no se ha encontrado dónde añadir cobro_real'; end if;
  execute d;
end $$;

-- ---------- 2) Comprobar códigos: como mucho 20 intentos cada 10 minutos por conexión ----------
create table if not exists public.ticket_web_intentos (
  id bigint generated always as identity primary key,
  ip text not null,
  tipo text not null,
  creado_en timestamptz not null default now()
);
create index if not exists ticket_web_intentos_ip on public.ticket_web_intentos (ip, tipo, creado_en);
alter table public.ticket_web_intentos enable row level security;   -- sin políticas: solo las funciones del servidor

create or replace function public.web_intento(p_tipo text, p_max int, p_minutos int)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_ip text := split_part(coalesce(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', ''), ',', 1); v_n int;
begin
  if v_ip = '' then return true; end if;
  delete from public.ticket_web_intentos where creado_en < now() - interval '1 day';
  select count(*) into v_n from public.ticket_web_intentos where ip = v_ip and tipo = p_tipo and creado_en > now() - make_interval(mins => p_minutos);
  if v_n >= p_max then return false; end if;
  insert into public.ticket_web_intentos (ip, tipo) values (v_ip, p_tipo);
  return true;
end $$;
revoke all on function public.web_intento(text, int, int) from public, anon, authenticated;

create or replace function public.web_descuento_comprobar(p_slug text, p_codigo text, p_email text default null)
returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare f record; r jsonb;
begin
  if not public.web_intento('descuento', 20, 10) then return jsonb_build_object('ok', false, 'motivo', 'demasiados_intentos'); end if;
  select * into f from public.ticket_web_eventos where slug = lower(p_slug);
  if f.evento_id is null then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if length(btrim(coalesce(p_codigo, ''))) > 30 then return jsonb_build_object('ok', false, 'motivo', 'descuento_no_valido'); end if;
  r := public.web_descuento_valido(f.owner_id, f.evento_id, p_codigo, nullif(lower(btrim(coalesce(p_email, ''))), ''), false);
  return r - 'id';
end $$;
revoke all on function public.web_descuento_comprobar(text, text, text) from public;
grant execute on function public.web_descuento_comprobar(text, text, text) to anon, authenticated, service_role;

-- ---------- 3) Lista de espera ----------
-- Cuando todo está agotado, la página deja apuntarse. El organizador ve la lista y puede invitar o avisar.
create table if not exists public.ticket_web_espera (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  evento_id uuid not null references public.ticket_eventos(id) on delete cascade,
  nombre text not null check (length(nombre) between 3 and 120),
  email text not null check (length(email) <= 160),
  cantidad int not null default 1 check (cantidad between 1 and 10),
  marketing boolean not null default false,
  avisado_en timestamptz,
  creado_en timestamptz not null default now()
);
create unique index if not exists ticket_web_espera_unica on public.ticket_web_espera (evento_id, lower(email));
alter table public.ticket_web_espera enable row level security;
drop policy if exists owner_all on public.ticket_web_espera;
create policy owner_all on public.ticket_web_espera for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
grant select, update, delete on public.ticket_web_espera to authenticated;

create or replace function public.web_espera_apuntar(p_slug text, p_nombre text, p_email text, p_cantidad int default 1, p_marketing boolean default false)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare f record; v_email text := lower(btrim(coalesce(p_email, ''))); v_nombre text := btrim(coalesce(p_nombre, ''));
begin
  if not public.web_intento('espera', 10, 10) then return jsonb_build_object('ok', false, 'motivo', 'demasiados_intentos'); end if;
  select * into f from public.ticket_web_eventos where slug = lower(p_slug);
  if f.evento_id is null or f.estado = 'borrador' then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 160 then return jsonb_build_object('ok', false, 'motivo', 'email'); end if;
  if length(v_nombre) < 3 or length(v_nombre) > 120 then return jsonb_build_object('ok', false, 'motivo', 'nombre'); end if;
  insert into public.ticket_web_espera (owner_id, evento_id, nombre, email, cantidad, marketing)
  values (f.owner_id, f.evento_id, v_nombre, v_email, greatest(1, least(10, coalesce(p_cantidad, 1))), coalesce(p_marketing, false))
  on conflict (evento_id, lower(email)) do update set nombre = excluded.nombre, cantidad = excluded.cantidad, marketing = excluded.marketing or public.ticket_web_espera.marketing;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.web_espera_apuntar(text, text, text, int, boolean) from public;
grant execute on function public.web_espera_apuntar(text, text, text, int, boolean) to anon, authenticated;

-- ---------- 4) El comprador cambia el titular de una entrada ----------
-- Desde «Mis entradas» (el acceso del pedido es el secreto). Genera un QR nuevo y el anterior deja de valer.
-- Solo antes de que empiece el evento, si la entrada no se ha usado, y como mucho 3 cambios por entrada (emision empieza en 1).
create or replace function public.web_cambiar_titular(p_acceso uuid, p_numero int, p_nombre text, p_dni text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare p record; x record; e record; v_msg bytea; v_mac bytea; v_nom text := btrim(coalesce(p_nombre, '')); v_ini timestamptz;
begin
  if not public.web_intento('titular', 20, 10) then return jsonb_build_object('ok', false, 'motivo', 'demasiados_intentos'); end if;
  select * into p from public.ticket_web_pedidos where acceso = p_acceso;
  if p.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  select * into x from public.ticket_web_entradas where pedido_id = p.id and numero = p_numero for update;
  if x.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if x.estado <> 'valida' then return jsonb_build_object('ok', false, 'motivo', 'anulada'); end if;
  if length(v_nom) < 3 or length(v_nom) > 120 then return jsonb_build_object('ok', false, 'motivo', 'nombre'); end if;
  if x.emision >= 4 then return jsonb_build_object('ok', false, 'motivo', 'limite'); end if;
  if exists (select 1 from public.ticket_canjes c where c.venta_uuid = x.id) then return jsonb_build_object('ok', false, 'motivo', 'usada'); end if;
  select * into e from public.ticket_eventos where id = x.evento_id;
  begin v_ini := coalesce(nullif(e.inicio::text, '')::timestamp at time zone 'Europe/Madrid', (e.fecha::text || ' 23:59')::timestamp at time zone 'Europe/Madrid');
  exception when others then v_ini := null; end;
  if v_ini is not null and now() >= v_ini then return jsonb_build_object('ok', false, 'motivo', 'empezado'); end if;
  v_msg := substring(decode(x.qr_hex, 'hex') from 1 for 25);
  v_msg := set_byte(v_msg, 17, x.emision);
  v_mac := substring(extensions.hmac(v_msg, decode(e.qr_clave, 'hex'), 'sha256') from 1 for 8);
  update public.ticket_web_entradas set emision = x.emision + 1, asistente = left(v_nom, 120),
         dni = nullif(left(btrim(coalesce(p_dni, '')), 30), ''),   -- el DNI anterior era del titular anterior
         qr_hex = encode(v_msg || v_mac, 'hex') where id = x.id;
  return jsonb_build_object('ok', true, 'cambios_restantes', 3 - x.emision);
end $$;
revoke all on function public.web_cambiar_titular(uuid, int, text, text) from public;
grant execute on function public.web_cambiar_titular(uuid, int, text, text) to anon, authenticated;

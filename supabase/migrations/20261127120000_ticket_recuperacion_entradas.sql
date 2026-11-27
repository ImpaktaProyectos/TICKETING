-- ===================== RECUPERACIÓN DE ENTRADAS PERDIDAS (servicio de TIXFAST, 1 €) =====================
-- Va después de 20261127110000_ticket_cambio_nombre.sql.
-- Quien ha perdido su entrada pone el correo de la compra y su nombre o su teléfono, paga 1 € (para TIXFAST, se cobra
-- siempre) y, si hay entradas que coinciden, se le REENVÍAN AL CORREO DE LA COMPRA. Medidas de seguridad:
--  · La entrada nunca se enseña en pantalla ni se manda a otro correo: si alguien pone datos ajenos, solo consigue que
--    el dueño real reciba su entrada otra vez. Robarla por aquí es imposible.
--  · La respuesta es siempre la misma (haya o no entradas) y la búsqueda se hace después de pagar: la página no sirve
--    para averiguar si una persona tiene entradas ni para qué evento.
--  · Tienen que coincidir dos datos: el correo y además el nombre o el teléfono de la compra.
--  · Límites: por conexión (IP) y por correo al día; los reenvíos de cada pedido siguen con su propio tope.
--  · Cada solicitud queda registrada (IP y navegador) por si hay reclamaciones; los datos personales se borran a los 90 días.
-- Solo el servidor ve la tabla (sin permisos para la web).

alter table public.ticket_plataforma_ajustes add column if not exists recuperacion_precio numeric(6,2) not null default 1.00
  check (recuperacion_precio between 0.5 and 20);

create table if not exists public.ticket_web_recuperaciones (
  id uuid primary key default gen_random_uuid(),
  acceso uuid not null unique default gen_random_uuid(),          -- secreto para la página de vuelta del pago
  email text, nombre text, telefono text,                         -- se borran a los 90 días
  email_huella text not null,                                     -- para el límite por correo (se queda tras el borrado)
  estado text not null default 'pendiente' check (estado in ('pendiente', 'pagado', 'enviado', 'caducado')),
  modo text not null default 'pruebas' check (modo in ('pruebas', 'real')),
  importe numeric(6,2) not null,
  coincidencias int,                                              -- solo interno (nunca se dice a quien lo pide)
  enviados int, fallidos int,
  ip text, agente text,
  sesion_id text unique, payment_intent text, cargo_id text,
  creado_en timestamptz not null default now(), pagado_en timestamptz, enviado_en timestamptz, anonimizado_en timestamptz
);
create index if not exists ticket_web_recuperaciones_ip on public.ticket_web_recuperaciones (ip, creado_en);
create index if not exists ticket_web_recuperaciones_huella on public.ticket_web_recuperaciones (email_huella, creado_en);
create index if not exists ticket_web_recuperaciones_pend on public.ticket_web_recuperaciones (creado_en) where estado = 'pendiente';
alter table public.ticket_web_recuperaciones enable row level security;
revoke all on public.ticket_web_recuperaciones from anon, authenticated;

-- Texto sin tildes ni mayúsculas, para comparar nombres
create or replace function public.texto_plano(p text)
returns text language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(translate(lower(coalesce(p, '')), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc'), '[^a-z0-9 ]', ' ', 'g'))
$$;

-- ---------- Pública: pedir la recuperación (antes de pagar) ----------
create or replace function public.web_recuperar_pedir(p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(btrim(coalesce(p_datos ->> 'email', ''))); v_nom text := btrim(coalesce(p_datos ->> 'nombre', ''));
        v_tel text := regexp_replace(coalesce(p_datos ->> 'telefono', ''), '[^0-9]', '', 'g'); v_huella text; v_ip text; v_acc uuid; v_precio numeric;
begin
  -- Casilla trampa: la rellenan los programas automáticos, nunca una persona (no se le dice nada distinto)
  if coalesce(p_datos ->> 'web', '') <> '' then return jsonb_build_object('ok', false, 'motivo', 'demasiados_intentos'); end if;
  if not public.web_intento('recuperar', 6, 60) then return jsonb_build_object('ok', false, 'motivo', 'demasiados_intentos'); end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 160 then return jsonb_build_object('ok', false, 'motivo', 'email'); end if;
  if length(public.texto_plano(v_nom)) < 2 and length(v_tel) < 9 then return jsonb_build_object('ok', false, 'motivo', 'segundo_dato'); end if;
  if length(v_nom) > 120 or length(v_tel) > 20 then return jsonb_build_object('ok', false, 'motivo', 'datos'); end if;
  v_huella := encode(extensions.digest(v_email, 'sha256'), 'hex');
  -- Como mucho 3 solicitudes pagadas o en marcha por correo cada 24 h
  if (select count(*) from public.ticket_web_recuperaciones where email_huella = v_huella and creado_en > now() - interval '24 hours' and estado <> 'caducado') >= 3 then
    return jsonb_build_object('ok', false, 'motivo', 'limite_correo');
  end if;
  v_ip := btrim(coalesce(nullif(current_setting('request.headers', true)::jsonb ->> 'cf-connecting-ip', ''),
                         split_part(coalesce(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', ''), ',', 1)));
  select recuperacion_precio into v_precio from public.ticket_plataforma_ajustes where id;
  insert into public.ticket_web_recuperaciones (email, nombre, telefono, email_huella, importe, ip, agente, modo)
  values (v_email, nullif(left(v_nom, 120), ''), nullif(v_tel, ''), v_huella, coalesce(v_precio, 1), nullif(v_ip, ''),
          left(coalesce(current_setting('request.headers', true)::jsonb ->> 'user-agent', ''), 200), 'pruebas')   -- el modo lo fija el servidor de pagos al cobrar
  returning acceso into v_acc;
  return jsonb_build_object('ok', true, 'acceso', v_acc, 'precio', coalesce(v_precio, 1));
end $$;
revoke all on function public.web_recuperar_pedir(jsonb) from public;
grant execute on function public.web_recuperar_pedir(jsonb) to anon, authenticated;

-- Pública: estado de una solicitud (solo «pendiente / hecho / caducado»; nunca si había entradas)
create or replace function public.web_recuperar_estado(p_acceso uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('ok', true, 'estado', case when estado in ('pagado', 'enviado') then 'hecho' else estado end, 'importe', importe)
                     from public.ticket_web_recuperaciones where acceso = p_acceso), jsonb_build_object('ok', false))
$$;
revoke all on function public.web_recuperar_estado(uuid) from public;
grant execute on function public.web_recuperar_estado(uuid) to anon, authenticated;

-- ---------- Servidor: la búsqueda (solo tras pagar) ----------
-- Pedidos del correo con entradas válidas de eventos que no han pasado, donde además coincide el nombre
-- (el de la compra o el de alguna entrada: todas las palabras escritas aparecen) o el teléfono (últimas 9 cifras).
create or replace function public.web_recuperar_buscar(p_id uuid)
returns table (pedido_id uuid, acceso uuid) language sql stable security definer set search_path = '' as $$
  with r as (select * from public.ticket_web_recuperaciones where id = p_id),
  pal as (select array_remove(string_to_array(public.texto_plano(r.nombre), ' '), '') p from r)
  select p.id, p.acceso
    from public.ticket_web_pedidos p join public.ticket_eventos e on e.id = p.evento_id, r, pal
   where lower(btrim(p.email)) = r.email
     and p.estado in ('pagado', 'gratis', 'invitacion', 'prueba')
     and (r.modo = 'pruebas' or not p.prueba)
     and coalesce(e.fecha, current_date) >= current_date - 1
     and exists (select 1 from public.ticket_web_entradas x where x.pedido_id = p.id and x.estado = 'valida')
     and (
       (cardinality(pal.p) > 0 and (
          (select bool_and(position(w in public.texto_plano(p.nombre)) > 0) from unnest(pal.p) w)
          or exists (select 1 from public.ticket_web_entradas x where x.pedido_id = p.id and x.estado = 'valida'
                      and (select bool_and(position(w in public.texto_plano(x.asistente)) > 0) from unnest(pal.p) w))))
       or (length(coalesce(r.telefono, '')) >= 9 and right(regexp_replace(coalesce(p.datos ->> 'telefono', ''), '[^0-9]', '', 'g'), 9) = right(r.telefono, 9))
     )
   order by p.creado_en desc
   limit 20
$$;
revoke all on function public.web_recuperar_buscar(uuid) from public, anon, authenticated;

-- Pago confirmado: marca la solicitud y devuelve (una sola vez) los pedidos a los que reenviar las entradas
create or replace function public.web_recuperar_pagado(p_acceso uuid, p_sesion text, p_pi text, p_cargo text, p_importe numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; v_lista jsonb;
begin
  select * into r from public.ticket_web_recuperaciones where acceso = p_acceso for update;
  if r.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if r.estado in ('pagado', 'enviado') then return jsonb_build_object('ok', true, 'ya', true); end if;
  if p_importe is not null and round(p_importe, 2) <> r.importe then return jsonb_build_object('ok', false, 'motivo', 'importe'); end if;
  select coalesce(jsonb_agg(b.acceso), '[]'::jsonb) into v_lista from public.web_recuperar_buscar(r.id) b;
  update public.ticket_web_recuperaciones set estado = 'pagado', pagado_en = now(), sesion_id = coalesce(p_sesion, sesion_id),
         payment_intent = coalesce(p_pi, payment_intent), cargo_id = coalesce(p_cargo, cargo_id), coincidencias = jsonb_array_length(v_lista)
   where id = r.id;
  return jsonb_build_object('ok', true, 'id', r.id, 'accesos', v_lista);
end $$;
revoke all on function public.web_recuperar_pagado(uuid, text, text, text, numeric) from public, anon, authenticated;

create or replace function public.web_recuperar_enviado(p_id uuid, p_enviados int, p_fallidos int)
returns void language sql security definer set search_path = '' as $$
  update public.ticket_web_recuperaciones set estado = 'enviado', enviado_en = now(), enviados = p_enviados, fallidos = p_fallidos where id = p_id and estado = 'pagado'
$$;
revoke all on function public.web_recuperar_enviado(uuid, int, int) from public, anon, authenticated;

-- Limpieza (la llama el reparto automático): solicitudes sin pagar caducan a las 2 h y los datos personales se borran a los 90 días
create or replace function public.web_recuperar_limpiar()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.ticket_web_recuperaciones set estado = 'caducado' where estado = 'pendiente' and creado_en < now() - interval '2 hours';
  update public.ticket_web_recuperaciones set email = null, nombre = null, telefono = null, ip = null, agente = null, anonimizado_en = now()
   where anonimizado_en is null and creado_en < now() - interval '90 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.web_recuperar_limpiar() from public, anon, authenticated;

-- Panel TIXFAST: resumen del servicio (sin datos personales)
create or replace function public.plataforma_recuperaciones(p_desde date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('pagadas', count(*) filter (where estado in ('pagado', 'enviado')),
    'cobrado', coalesce(sum(importe) filter (where estado in ('pagado', 'enviado')), 0),
    'con_entradas', count(*) filter (where coalesce(coincidencias, 0) > 0),
    'sin_entradas', count(*) filter (where estado in ('pagado', 'enviado') and coalesce(coincidencias, 0) = 0),
    'fallos_envio', coalesce(sum(fallidos), 0), 'modo_pruebas', count(*) filter (where modo = 'pruebas' and estado in ('pagado', 'enviado')))
    from public.ticket_web_recuperaciones where creado_en >= p_desde
$$;
revoke all on function public.plataforma_recuperaciones(date) from public, anon, authenticated;

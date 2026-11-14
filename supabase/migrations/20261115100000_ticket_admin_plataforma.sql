-- =====================================================================
-- TIXFAST · PANEL DE ADMINISTRACIÓN DE LA PLATAFORMA
-- ---------------------------------------------------------------------
-- · ticket_superadmins: quién administra TIXFAST. Se da de alta a mano (SQL), nunca desde la app.
-- · ticket_errores: errores que la app envía (solo puede AÑADIR los suyos; nadie los lee salvo admin).
-- · ticket_admin_registro: todo lo que hace un administrador queda apuntado (quién, qué, cuándo).
-- · Funciones admin_*: solo funcionan para un superadmin. Dan datos de gestión (correo, alta,
--   suscripción, número de eventos y ventas), nunca el detalle del negocio de cada cuenta.
-- =====================================================================

create table if not exists public.ticket_superadmins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  creado_en timestamptz not null default now()
);
alter table public.ticket_superadmins enable row level security;
revoke all on public.ticket_superadmins from anon, authenticated;

create table if not exists public.ticket_errores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid default auth.uid() references auth.users(id) on delete set null,
  creado_en timestamptz not null default now(),
  origen text not null check (length(origen) <= 40),
  mensaje text not null check (length(mensaje) <= 500),
  detalle text check (detalle is null or length(detalle) <= 2000),
  version text check (version is null or length(version) <= 20),
  ruta text check (ruta is null or length(ruta) <= 200),
  agente text check (agente is null or length(agente) <= 200)
);
create index if not exists ticket_errores_fecha on public.ticket_errores (creado_en desc);
create index if not exists ticket_errores_owner on public.ticket_errores (owner_id, creado_en desc);
alter table public.ticket_errores enable row level security;
drop policy if exists errores_propios on public.ticket_errores;
create policy errores_propios on public.ticket_errores for insert to authenticated with check (owner_id = (select auth.uid()));
revoke all on public.ticket_errores from anon, authenticated;
grant insert on public.ticket_errores to authenticated;

create table if not exists public.ticket_admin_registro (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references auth.users(id) on delete set null,
  cuenta_id uuid references auth.users(id) on delete set null,
  accion text not null,
  detalle jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now()
);
create index if not exists ticket_admin_registro_fecha on public.ticket_admin_registro (creado_en desc);
alter table public.ticket_admin_registro enable row level security;
revoke all on public.ticket_admin_registro from anon, authenticated;

-- ¿Quien está dentro es administrador de TIXFAST?
create or replace function public.ticket_soy_superadmin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ticket_superadmins where user_id = (select auth.uid()));
$$;
revoke all on function public.ticket_soy_superadmin() from public, anon;
grant execute on function public.ticket_soy_superadmin() to authenticated;

create or replace function public.ticket_exigir_superadmin()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.ticket_soy_superadmin() then
    raise exception using errcode = '42501', message = 'Solo para administradores de TIXFAST';
  end if;
end $$;
revoke all on function public.ticket_exigir_superadmin() from public, anon, authenticated;

-- Resumen general
create or replace function public.admin_resumen()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform public.ticket_exigir_superadmin();
  select jsonb_build_object(
    'registrados', (select count(*) from auth.users),
    'altas_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'altas_30d', (select count(*) from auth.users where created_at > now() - interval '30 days'),
    'activos_7d', (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
    'por_estado', coalesce((select jsonb_object_agg(k, n) from (
        select case when plan_id = 'fundador' then 'fundador' else estado end k, count(*) n from public.ticket_cuentas group by 1) x), '{}'::jsonb),
    'pagando', (select count(*) from public.ticket_cuentas where estado = 'activa' and plan_id <> 'fundador' and suscripcion_pago_id is not null),
    'cancelan_al_final', (select count(*) from public.ticket_cuentas where cancela_al_final and estado in ('activa', 'prueba')),
    'precio', (select precio_mes from public.ticket_planes where id = 'pro'),
    'errores_24h', (select count(*) from public.ticket_errores where creado_en > now() - interval '24 hours'),
    'errores_7d', (select count(*) from public.ticket_errores where creado_en > now() - interval '7 days'),
    'eventos', (select count(*) from public.ticket_eventos),
    'ventas_30d', (select count(*) from public.ticket_ventas where creado_en > now() - interval '30 days')
  ) into r;
  r := r || jsonb_build_object('ingreso_mensual', coalesce((r ->> 'pagando')::numeric * (r ->> 'precio')::numeric, 0));
  return r;
end $$;
revoke all on function public.admin_resumen() from public, anon;
grant execute on function public.admin_resumen() to authenticated;

-- Lista de cuentas (todas las que se han registrado alguna vez)
create or replace function public.admin_cuentas(p_buscar text default null, p_filtro text default 'todas', p_limite int default 50, p_desde int default 0)
returns table (owner_id uuid, email text, alta timestamptz, ultimo_acceso timestamptz, confirmado boolean, bloqueado_hasta timestamptz,
  plan_id text, estado text, prueba_hasta timestamptz, periodo_fin timestamptz, cancela_al_final boolean,
  cliente_pago_id text, suscripcion_pago_id text, eventos bigint, ultimo_evento date, errores_7d bigint, total bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.ticket_exigir_superadmin();
  return query
  with base as (
    select u.id, u.email::text em, u.created_at, u.last_sign_in_at, u.email_confirmed_at is not null conf, u.banned_until,
      c.plan_id pl, c.estado es, c.prueba_hasta ph, c.periodo_fin pf, coalesce(c.cancela_al_final, false) caf, c.cliente_pago_id cp, c.suscripcion_pago_id sp
    from auth.users u left join public.ticket_cuentas c on c.owner_id = u.id
    where (p_buscar is null or p_buscar = '' or u.email ilike '%' || p_buscar || '%' or u.id::text = p_buscar)
      and case coalesce(p_filtro, 'todas')
        when 'todas' then true
        when 'fundador' then c.plan_id = 'fundador'
        when 'bloqueadas' then u.banned_until > now()
        when 'sin_suscripcion' then coalesce(c.estado, 'pendiente') in ('pendiente', 'cancelada', 'suspendida') and coalesce(c.plan_id, '') <> 'fundador'
        else c.estado = p_filtro and c.plan_id <> 'fundador' end
  )
  select b.id, b.em, b.created_at, b.last_sign_in_at, b.conf, b.banned_until, b.pl, b.es, b.ph, b.pf, b.caf, b.cp, b.sp,
    (select count(*) from public.ticket_eventos e where e.owner_id = b.id),
    (select max(e.fecha) from public.ticket_eventos e where e.owner_id = b.id),
    (select count(*) from public.ticket_errores x where x.owner_id = b.id and x.creado_en > now() - interval '7 days'),
    count(*) over ()
  from base b order by b.created_at desc
  limit least(greatest(coalesce(p_limite, 50), 1), 200) offset greatest(coalesce(p_desde, 0), 0);
end $$;
revoke all on function public.admin_cuentas(text, text, int, int) from public, anon;
grant execute on function public.admin_cuentas(text, text, int, int) to authenticated;

-- Ficha de una cuenta: actividad (solo números) y su historial de administración
create or replace function public.admin_cuenta_detalle(p_owner uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.ticket_exigir_superadmin();
  return jsonb_build_object(
    'eventos', coalesce((select jsonb_agg(jsonb_build_object('nombre', e.nombre, 'fecha', e.fecha,
        'barras', (select count(*) from public.ticket_puntos p where p.evento_id = e.id),
        'tickets', (select count(*) from public.ticket_ventas v where v.evento_id = e.id and not coalesce(v.anulada, false)),
        'venta_online', exists (select 1 from public.ticket_web_eventos w where w.evento_id = e.id)) order by e.fecha desc)
      from (select * from public.ticket_eventos where owner_id = p_owner order by fecha desc limit 30) e), '[]'::jsonb),
    'errores', coalesce((select jsonb_agg(jsonb_build_object('fecha', x.creado_en, 'origen', x.origen, 'mensaje', x.mensaje, 'version', x.version) order by x.creado_en desc)
      from (select * from public.ticket_errores where owner_id = p_owner order by creado_en desc limit 20) x), '[]'::jsonb),
    'registro', coalesce((select jsonb_agg(jsonb_build_object('fecha', r.creado_en, 'accion', r.accion, 'detalle', r.detalle,
        'admin', (select u.email from auth.users u where u.id = r.admin_id)) order by r.creado_en desc)
      from (select * from public.ticket_admin_registro where cuenta_id = p_owner order by creado_en desc limit 30) r), '[]'::jsonb)
  );
end $$;
revoke all on function public.admin_cuenta_detalle(uuid) from public, anon;
grant execute on function public.admin_cuenta_detalle(uuid) to authenticated;

-- Cambiar la suscripción a mano: regalar (cortesía), hacer Fundador o quitar el acceso
create or replace function public.admin_cuenta_cambiar(p_owner uuid, p_accion text, p_hasta timestamptz default null, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare antes jsonb;
begin
  perform public.ticket_exigir_superadmin();
  if p_accion not in ('cortesia', 'fundador', 'quitar') then raise exception 'Acción no válida'; end if;
  insert into public.ticket_cuentas (owner_id) values (p_owner) on conflict (owner_id) do nothing;
  select to_jsonb(c) - 'cliente_pago_id' - 'suscripcion_pago_id' into antes from public.ticket_cuentas c where c.owner_id = p_owner;
  if p_accion = 'cortesia' then
    update public.ticket_cuentas set plan_id = 'pro', estado = 'cortesia', periodo_fin = p_hasta, cancela_al_final = false, actualizada_en = now() where owner_id = p_owner;
  elsif p_accion = 'fundador' then
    update public.ticket_cuentas set plan_id = 'fundador', estado = 'activa', periodo_fin = null, cancela_al_final = false, actualizada_en = now() where owner_id = p_owner;
  else
    update public.ticket_cuentas set plan_id = 'pro', estado = 'cancelada', periodo_fin = now(), cancela_al_final = false, actualizada_en = now() where owner_id = p_owner;
  end if;
  insert into public.ticket_admin_registro (admin_id, cuenta_id, accion, detalle)
    values ((select auth.uid()), p_owner, p_accion, jsonb_build_object('hasta', p_hasta, 'nota', left(p_nota, 300), 'antes', antes));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_cuenta_cambiar(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.admin_cuenta_cambiar(uuid, text, timestamptz, text) to authenticated;

-- Precio de la suscripción (para altas nuevas; las suscripciones en marcha mantienen su precio)
create or replace function public.admin_precio(p_importe numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare antes numeric;
begin
  perform public.ticket_exigir_superadmin();
  if p_importe is null or p_importe <= 0 or p_importe > 10000 then raise exception 'Importe no válido'; end if;
  select precio_mes into antes from public.ticket_planes where id = 'pro';
  update public.ticket_planes set precio_mes = round(p_importe, 2) where id = 'pro';
  insert into public.ticket_admin_registro (admin_id, accion, detalle) values ((select auth.uid()), 'precio', jsonb_build_object('antes', antes, 'ahora', round(p_importe, 2)));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_precio(numeric) from public, anon;
grant execute on function public.admin_precio(numeric) to authenticated;

-- Errores recientes de toda la plataforma
create or replace function public.admin_errores(p_limite int default 100, p_origen text default null)
returns table (id uuid, fecha timestamptz, email text, origen text, mensaje text, detalle text, version text, ruta text, agente text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.ticket_exigir_superadmin();
  return query select x.id, x.creado_en, u.email::text, x.origen, x.mensaje, x.detalle, x.version, x.ruta, x.agente
    from public.ticket_errores x left join auth.users u on u.id = x.owner_id
    where p_origen is null or x.origen = p_origen
    order by x.creado_en desc limit least(greatest(coalesce(p_limite, 100), 1), 500);
end $$;
revoke all on function public.admin_errores(int, text) from public, anon;
grant execute on function public.admin_errores(int, text) to authenticated;

-- Registro de acciones de administración
create or replace function public.admin_registro(p_limite int default 100)
returns table (fecha timestamptz, admin text, cuenta text, accion text, detalle jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.ticket_exigir_superadmin();
  return query select r.creado_en, a.email::text, c.email::text, r.accion, r.detalle
    from public.ticket_admin_registro r left join auth.users a on a.id = r.admin_id left join auth.users c on c.id = r.cuenta_id
    order by r.creado_en desc limit least(greatest(coalesce(p_limite, 100), 1), 500);
end $$;
revoke all on function public.admin_registro(int) from public, anon;
grant execute on function public.admin_registro(int) to authenticated;

-- Limpieza: los errores de más de 90 días se pueden borrar sin perder nada importante
create or replace function public.admin_limpiar_errores()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform public.ticket_exigir_superadmin();
  delete from public.ticket_errores where creado_en < now() - interval '90 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.admin_limpiar_errores() from public, anon;
grant execute on function public.admin_limpiar_errores() to authenticated;

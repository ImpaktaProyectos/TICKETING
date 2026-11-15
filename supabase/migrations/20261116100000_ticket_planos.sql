-- =====================================================================
-- TIXFAST · BIBLIOTECA DE PLANOS (en la cuenta) Y NIVELES DE SUSCRIPCIÓN
-- ---------------------------------------------------------------------
-- · ticket_planos: planos de sala guardados por nombre en la cuenta (para quien hace fiestas
--   en varios clubs). En cada evento se carga uno o se dibuja uno nuevo.
-- · Límite de planos guardados por plan (limites.planos): TIXFAST = 2; Premium y Empresa sin
--   límite; Fundador sin límite; sin suscripción = 0. Lo comprueba la base de datos.
-- · Se preparan dos niveles más de pago (Premium y Empresa), ocultos hasta que tengan precio.
-- =====================================================================

create table if not exists public.ticket_planos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre text not null check (length(btrim(nombre)) between 1 and 60),
  plano jsonb not null check (jsonb_typeof(plano) = 'object' and pg_column_size(plano) <= 200000),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create unique index if not exists ticket_planos_nombre on public.ticket_planos (owner_id, lower(btrim(nombre)));
alter table public.ticket_planos enable row level security;
drop policy if exists owner_all on public.ticket_planos;
create policy owner_all on public.ticket_planos for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
revoke all on public.ticket_planos from anon;
grant select, insert, update, delete on public.ticket_planos to authenticated;

-- Niveles de suscripción: el normal guarda 2 planos; Premium y Empresa, sin límite (precio por fijar)
update public.ticket_planes set limites = limites || '{"planos": 2}'::jsonb where id = 'pro';
update public.ticket_planes set limites = limites || '{"planos": 0}'::jsonb where id = 'sin_suscripcion';
insert into public.ticket_planes (id, nombre, precio_mes, limites, publico, orden) values
  ('premium', 'TIXFAST Premium', null, '{}'::jsonb, false, 3),
  ('empresa', 'TIXFAST Empresa', null, '{}'::jsonb, false, 4)
on conflict (id) do nothing;

-- Límite de planos guardados (solo al crear uno nuevo; renombrar o actualizar uno existente siempre se puede)
create or replace function public.ticket_planos_limite()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a record; lim int; n int;
begin
  select * into a from public.ticket_acceso_de(new.owner_id);
  if not found then return new; end if;
  lim := nullif(a.limites ->> 'planos', '')::int;
  if lim is null then return new; end if;
  select count(*) into n from public.ticket_planos where owner_id = new.owner_id;
  if n >= lim then
    raise exception using errcode = 'P0001', message = case when lim = 0
      then 'TIXFAST: guardar planos va con la suscripción.'
      else format('TIXFAST: tu plan permite guardar %s planos. Pasa a TIXFAST Premium para guardar más, o sustituye uno que ya tengas.', lim) end;
  end if;
  return new;
end $$;
revoke all on function public.ticket_planos_limite() from public, anon, authenticated;
drop trigger if exists ticket_planos_limite on public.ticket_planos;
create trigger ticket_planos_limite before insert on public.ticket_planos for each row execute function public.ticket_planos_limite();

-- Planes que se pueden contratar (para enseñarlos en la app): con precio y públicos
create or replace function public.ticket_planes_disponibles()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'precio_mes', precio_mes, 'limites', limites) order by orden), '[]'::jsonb)
  from public.ticket_planes where publico and precio_mes is not null and precio_mes > 0;
$$;
revoke all on function public.ticket_planes_disponibles() from public, anon;
grant execute on function public.ticket_planes_disponibles() to authenticated;

-- Panel de administración: precio y visibilidad de cada nivel (las suscripciones en marcha mantienen su precio)
create or replace function public.admin_plan(p_plan text, p_precio numeric, p_publico boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare antes jsonb;
begin
  perform public.ticket_exigir_superadmin();
  if p_plan not in ('pro', 'premium', 'empresa') then raise exception 'Plan no válido'; end if;
  if p_precio is not null and (p_precio <= 0 or p_precio > 10000) then raise exception 'Importe no válido'; end if;
  if p_precio is null and (p_plan = 'pro' or coalesce(p_publico, false)) then raise exception 'Hace falta un precio para poder contratarlo'; end if;
  select jsonb_build_object('precio', precio_mes, 'publico', publico) into antes from public.ticket_planes where id = p_plan;
  update public.ticket_planes set precio_mes = round(p_precio, 2), publico = coalesce(p_publico, publico) where id = p_plan;
  insert into public.ticket_admin_registro (admin_id, accion, detalle)
    values ((select auth.uid()), 'precio', jsonb_build_object('plan', p_plan, 'antes', antes -> 'precio', 'ahora', round(p_precio, 2), 'publico', p_publico));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_plan(text, numeric, boolean) from public, anon;
grant execute on function public.admin_plan(text, numeric, boolean) to authenticated;

-- Panel de administración: los niveles con sus cuentas, y el ingreso al mes sumando el nivel de cada una
create or replace function public.admin_planes()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.ticket_exigir_superadmin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre, 'precio_mes', p.precio_mes, 'publico', p.publico, 'limites', p.limites,
      'cuentas', (select count(*) from public.ticket_cuentas c where c.plan_id = p.id and c.estado in ('activa', 'prueba', 'impagada', 'cortesia')))
    order by p.orden) from public.ticket_planes p where p.id in ('pro', 'premium', 'empresa')), '[]'::jsonb);
end $$;
revoke all on function public.admin_planes() from public, anon;
grant execute on function public.admin_planes() to authenticated;

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
    'ingreso_mensual', coalesce((select sum(p.precio_mes) from public.ticket_cuentas c join public.ticket_planes p on p.id = c.plan_id
        where c.estado = 'activa' and c.plan_id <> 'fundador' and c.suscripcion_pago_id is not null), 0),
    'cancelan_al_final', (select count(*) from public.ticket_cuentas where cancela_al_final and estado in ('activa', 'prueba')),
    'precio', (select precio_mes from public.ticket_planes where id = 'pro'),
    'errores_24h', (select count(*) from public.ticket_errores where creado_en > now() - interval '24 hours'),
    'errores_7d', (select count(*) from public.ticket_errores where creado_en > now() - interval '7 days'),
    'eventos', (select count(*) from public.ticket_eventos),
    'ventas_30d', (select count(*) from public.ticket_ventas where creado_en > now() - interval '30 days')
  ) into r;
  return r;
end $$;
revoke all on function public.admin_resumen() from public, anon;
grant execute on function public.admin_resumen() to authenticated;

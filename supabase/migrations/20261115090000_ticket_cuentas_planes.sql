-- =====================================================================
-- TIXFAST · CUENTAS Y PLANES (preparado para suscripciones)
-- ---------------------------------------------------------------------
-- · ticket_planes: catálogo de planes y sus límites (sin límite = el límite no aparece).
-- · ticket_cuentas: una ficha por usuario registrado (plan, estado, datos del cobro).
--   El usuario solo puede LEER su propia ficha. Nadie puede cambiar su plan ni su estado
--   desde la app: solo el servidor (pasarela de pago / administración con la clave de servicio).
-- · Al registrarse alguien, su ficha se crea sola. Las cuentas que ya existían pasan al plan
--   «Fundador» (sin límites).
-- · Límites: se comprueban al CREAR eventos y barras. Nunca se bloquean ventas, cierres
--   ni nada de un evento en marcha: una noche no se corta por un cobro.
-- Hoy ningún plan tiene límites, así que nada cambia para nadie hasta que se decidan precios.
-- =====================================================================

create table if not exists public.ticket_planes (
  id text primary key check (id ~ '^[a-z0-9_]{2,30}$'),
  nombre text not null,
  precio_mes numeric(10,2) check (precio_mes is null or precio_mes >= 0),   -- null = sin precio fijado
  limites jsonb not null default '{}'::jsonb,   -- p. ej. {"eventos": 3, "barras_por_evento": 2}
  publico boolean not null default true,        -- false = no se ofrece a cuentas nuevas
  orden int not null default 0,
  creado_en timestamptz not null default now()
);
alter table public.ticket_planes enable row level security;
drop policy if exists planes_ver on public.ticket_planes;
create policy planes_ver on public.ticket_planes for select to authenticated using (true);
revoke all on public.ticket_planes from anon, authenticated;
grant select on public.ticket_planes to authenticated;

insert into public.ticket_planes (id, nombre, precio_mes, limites, publico, orden) values
  ('fundador', 'Fundador', null, '{}'::jsonb, false, 0),
  ('inicial',  'Inicial',  null, '{}'::jsonb, true,  1)
on conflict (id) do nothing;

create table if not exists public.ticket_cuentas (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  nombre text check (nombre is null or length(nombre) <= 120),
  plan_id text not null default 'inicial' references public.ticket_planes(id),
  estado text not null default 'activa' check (estado in ('prueba', 'activa', 'impagada', 'suspendida', 'cancelada')),
  prueba_hasta timestamptz,
  periodo_fin timestamptz,
  proveedor_pago text check (proveedor_pago is null or proveedor_pago in ('stripe')),
  cliente_pago_id text unique,
  suscripcion_pago_id text unique,
  creada_en timestamptz not null default now(),
  actualizada_en timestamptz not null default now()
);
alter table public.ticket_cuentas enable row level security;
drop policy if exists cuenta_propia on public.ticket_cuentas;
create policy cuenta_propia on public.ticket_cuentas for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.ticket_cuentas from anon, authenticated;
grant select on public.ticket_cuentas to authenticated;

-- Ficha automática al registrarse
create or replace function public.ticket_cuenta_nueva()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ticket_cuentas (owner_id) values (new.id) on conflict (owner_id) do nothing;
  return new;
end $$;
revoke all on function public.ticket_cuenta_nueva() from public, anon, authenticated;
drop trigger if exists ticket_cuenta_nueva on auth.users;
create trigger ticket_cuenta_nueva after insert on auth.users for each row execute function public.ticket_cuenta_nueva();

-- Las cuentas que ya existían: plan Fundador, sin límites
insert into public.ticket_cuentas (owner_id, plan_id)
select id, 'fundador' from auth.users on conflict (owner_id) do nothing;

-- Límites del plan (se leen con permisos del servidor; solo devuelve datos del propio usuario)
create or replace function public.ticket_limite(p_owner uuid, p_clave text)
returns table (estado text, limite int) language sql stable security definer set search_path = '' as $$
  select c.estado, nullif(p.limites ->> p_clave, '')::int
  from public.ticket_cuentas c join public.ticket_planes p on p.id = c.plan_id
  where c.owner_id = p_owner and p_owner = (select auth.uid());
$$;
revoke all on function public.ticket_limite(uuid, text) from public, anon, authenticated;

create or replace function public.ticket_eventos_limite()
returns trigger language plpgsql security definer set search_path = '' as $$
declare l record; n int;
begin
  select * into l from public.ticket_limite(new.owner_id, 'eventos');
  if not found then return new; end if;   -- sin ficha (servidor, migraciones): no se bloquea
  if l.estado in ('suspendida', 'cancelada') then
    raise exception using errcode = 'P0001', message = 'TIXFAST: tu cuenta está pausada. Revisa tu suscripción para crear eventos nuevos.';
  end if;
  if l.limite is not null then
    select count(*) into n from public.ticket_eventos where owner_id = new.owner_id and not cerrada;
    if n >= l.limite then
      raise exception using errcode = 'P0001', message = format('TIXFAST: tu plan permite %s eventos abiertos. Cierra uno o mejora el plan.', l.limite);
    end if;
  end if;
  return new;
end $$;
revoke all on function public.ticket_eventos_limite() from public, anon, authenticated;
drop trigger if exists ticket_eventos_limite on public.ticket_eventos;
create trigger ticket_eventos_limite before insert on public.ticket_eventos for each row execute function public.ticket_eventos_limite();

create or replace function public.ticket_puntos_limite()
returns trigger language plpgsql security definer set search_path = '' as $$
declare l record; n int;
begin
  select * into l from public.ticket_limite(new.owner_id, 'barras_por_evento');
  if not found or l.limite is null then return new; end if;
  select count(*) into n from public.ticket_puntos where evento_id = new.evento_id and not archivado;
  if n >= l.limite then
    raise exception using errcode = 'P0001', message = format('TIXFAST: tu plan permite %s barras por evento.', l.limite);
  end if;
  return new;
end $$;
revoke all on function public.ticket_puntos_limite() from public, anon, authenticated;
drop trigger if exists ticket_puntos_limite on public.ticket_puntos;
create trigger ticket_puntos_limite before insert on public.ticket_puntos for each row execute function public.ticket_puntos_limite();

-- Logos de tickets: cada cuenta solo puede subir dentro de su propia carpeta
drop policy if exists "ticketera logos subida" on storage.objects;
create policy "ticketera logos subida" on storage.objects for insert to authenticated
  with check (bucket_id = 'ticketera-logos' and (storage.foldername(name))[1] = (select auth.uid())::text);

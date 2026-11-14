-- =====================================================================
-- TIXFAST · CUENTAS, PLANES, PRUEBA GRATUITA Y BLOQUEOS
-- ---------------------------------------------------------------------
-- · ticket_planes: catálogo de planes, límites y funciones bloqueadas.
-- · ticket_cuentas: una ficha por usuario (plan, estado, fin de la prueba, datos del cobro).
--   El usuario solo puede LEER su ficha. Plan y estado solo los cambia el servidor
--   (pasarela de pago o administración con la clave de servicio), nunca la app.
-- · Cuenta nueva  → 30 días de prueba con TODO (plan Pro).
--   Cuentas que ya existían → plan Fundador, sin límites ni bloqueos.
-- · Sin suscripción (prueba acabada, impago de más de 7 días, cancelada) → plan Gratis:
--   TPV completo, Panel, Ingresos, Gastos, Liquidación y Socios; 1 evento a la vez y 2 barras.
--   Se bloquean las funciones de pago (facturación, stock, previsión, entradas online,
--   reservados VIP, RRPP y conexión con ticketeras).
-- · Los bloqueos solo impiden CREAR cosas nuevas. Nunca se bloquea vender, cerrar cajas,
--   ver ni exportar datos. Y un evento creado antes de acabar el acceso conserva todo
--   hasta el día siguiente a su fecha: una noche nunca se corta por la suscripción.
-- =====================================================================

create table if not exists public.ticket_planes (
  id text primary key check (id ~ '^[a-z0-9_]{2,30}$'),
  nombre text not null,
  precio_mes numeric(10,2) check (precio_mes is null or precio_mes >= 0),   -- null = precio aún sin fijar
  limites jsonb not null default '{}'::jsonb,   -- {"eventos": 1, "barras_por_evento": 2, "bloquea": ["stock", …]}
  publico boolean not null default true,
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
  ('gratis',   'Gratis',   0,    '{"eventos": 1, "barras_por_evento": 2, "bloquea": ["facturacion", "stock", "prevision", "entradas_online", "reservados", "rrpp", "conexiones"]}'::jsonb, true, 1),
  ('pro',      'Pro',      null, '{}'::jsonb, true, 2)
on conflict (id) do nothing;

create table if not exists public.ticket_cuentas (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  nombre text check (nombre is null or length(nombre) <= 120),
  plan_id text not null default 'pro' references public.ticket_planes(id),
  estado text not null default 'prueba' check (estado in ('prueba', 'activa', 'impagada', 'suspendida', 'cancelada')),
  prueba_hasta timestamptz default (now() + interval '30 days'),
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

-- Ficha automática al registrarse (30 días de prueba)
create or replace function public.ticket_cuenta_nueva()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ticket_cuentas (owner_id) values (new.id) on conflict (owner_id) do nothing;
  return new;
end $$;
revoke all on function public.ticket_cuenta_nueva() from public, anon, authenticated;
drop trigger if exists ticket_cuenta_nueva on auth.users;
create trigger ticket_cuenta_nueva after insert on auth.users for each row execute function public.ticket_cuenta_nueva();

-- Las cuentas que ya existían: Fundador, sin límites
insert into public.ticket_cuentas (owner_id, plan_id, estado, prueba_hasta)
select id, 'fundador', 'activa', null from auth.users on conflict (owner_id) do nothing;

-- Acceso REAL de una cuenta ahora mismo (plan efectivo). Sin ficha = sin restricciones.
create or replace function public.ticket_acceso_de(p_owner uuid)
returns table (plan_id text, plan_nombre text, estado text, limites jsonb, en_prueba boolean, fin_acceso timestamptz)
language sql stable security definer set search_path = '' as $$
  with c as (
    select c.*,
      case
        when c.estado = 'activa' then true
        when c.estado = 'prueba' then coalesce(c.prueba_hasta > now(), false)
        when c.estado = 'impagada' then coalesce(c.periodo_fin, c.actualizada_en) + interval '7 days' > now()
        else false
      end as con_acceso,
      case
        when c.estado = 'prueba' then c.prueba_hasta
        when c.estado = 'impagada' then coalesce(c.periodo_fin, c.actualizada_en) + interval '7 days'
        when c.estado in ('suspendida', 'cancelada') then coalesce(c.periodo_fin, c.actualizada_en)
      end as fin
    from public.ticket_cuentas c where c.owner_id = p_owner
  )
  select p.id, p.nombre, c.estado, p.limites, (c.estado = 'prueba' and c.con_acceso), c.fin
  from c join public.ticket_planes p on p.id = case when c.con_acceso then c.plan_id else 'gratis' end;
$$;
revoke all on function public.ticket_acceso_de(uuid) from public, anon, authenticated;

-- Para la app: el acceso de quien está dentro (solo el suyo)
create or replace function public.ticket_mi_acceso()
returns table (plan_id text, plan_nombre text, estado text, limites jsonb, en_prueba boolean, fin_acceso timestamptz)
language sql stable security definer set search_path = '' as $$
  select * from public.ticket_acceso_de((select auth.uid())) where (select auth.uid()) is not null;
$$;
revoke all on function public.ticket_mi_acceso() from public, anon;
grant execute on function public.ticket_mi_acceso() to authenticated;

-- Límite de eventos a la vez (los pasados y los cerrados no cuentan)
create or replace function public.ticket_eventos_limite()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a record; lim int; n int;
begin
  if (select auth.uid()) is null or new.owner_id is distinct from (select auth.uid()) then return new; end if;
  select * into a from public.ticket_acceso_de(new.owner_id);
  if not found then return new; end if;
  lim := nullif(a.limites ->> 'eventos', '')::int;
  if lim is not null then
    select count(*) into n from public.ticket_eventos
      where owner_id = new.owner_id and not coalesce(cerrada, false) and coalesce(fecha, current_date) >= current_date - 1;
    if n >= lim then
      raise exception using errcode = 'P0001', message = format('TIXFAST: con el plan %s puedes tener %s %s a la vez. Suscríbete para crear más.', a.plan_nombre, lim, case when lim = 1 then 'evento' else 'eventos' end);
    end if;
  end if;
  return new;
end $$;
revoke all on function public.ticket_eventos_limite() from public, anon, authenticated;
drop trigger if exists ticket_eventos_limite on public.ticket_eventos;
create trigger ticket_eventos_limite before insert on public.ticket_eventos for each row execute function public.ticket_eventos_limite();

-- Límite de barras por evento (no se aplica a eventos creados con acceso completo hasta que pasan)
create or replace function public.ticket_puntos_limite()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a record; lim int; n int; ev record;
begin
  if (select auth.uid()) is null or new.owner_id is distinct from (select auth.uid()) then return new; end if;
  select * into a from public.ticket_acceso_de(new.owner_id);
  if not found then return new; end if;
  lim := nullif(a.limites ->> 'barras_por_evento', '')::int;
  if lim is null then return new; end if;
  select creado_en, fecha into ev from public.ticket_eventos where id = new.evento_id;
  if found and a.fin_acceso is not null and ev.creado_en <= a.fin_acceso and coalesce(ev.fecha, current_date) >= current_date - 1 then return new; end if;
  select count(*) into n from public.ticket_puntos where evento_id = new.evento_id and not coalesce(archivado, false);
  if n >= lim then
    raise exception using errcode = 'P0001', message = format('TIXFAST: con el plan %s puedes tener %s barras por evento. Suscríbete para añadir más.', a.plan_nombre, lim);
  end if;
  return new;
end $$;
revoke all on function public.ticket_puntos_limite() from public, anon, authenticated;
drop trigger if exists ticket_puntos_limite on public.ticket_puntos;
create trigger ticket_puntos_limite before insert on public.ticket_puntos for each row execute function public.ticket_puntos_limite();

-- Funciones de pago: impide CREAR registros nuevos si el plan las bloquea
create or replace function public.ticket_funcion_permitida()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a record; f text := tg_argv[0]; ev_id uuid; ev record;
  nombres jsonb := '{"facturacion":"La facturación","stock":"El control de stock","prevision":"La previsión","entradas_online":"La venta de entradas online","reservados":"Los reservados VIP","rrpp":"La gestión de RRPP","conexiones":"La conexión con ticketeras"}';
begin
  if (select auth.uid()) is null or new.owner_id is distinct from (select auth.uid()) then return new; end if;
  select * into a from public.ticket_acceso_de(new.owner_id);
  if not found or not coalesce(a.limites -> 'bloquea' ? f, false) then return new; end if;
  -- Un evento creado con acceso completo conserva sus funciones hasta el día siguiente a su fecha
  ev_id := nullif(to_jsonb(new) ->> 'evento_id', '')::uuid;
  if ev_id is not null and a.fin_acceso is not null then
    select creado_en, fecha into ev from public.ticket_eventos where id = ev_id;
    if found and ev.creado_en <= a.fin_acceso and coalesce(ev.fecha, current_date) >= current_date - 1 then return new; end if;
  end if;
  raise exception using errcode = 'P0001', message = format('TIXFAST: %s está incluida en la suscripción. Con el plan %s no puedes crear nada nuevo aquí.', coalesce(nombres ->> f, 'Esta función'), a.plan_nombre);
end $$;
revoke all on function public.ticket_funcion_permitida() from public, anon, authenticated;

drop trigger if exists ticket_funcion_facturacion on public.ticket_fac_facturas;
create trigger ticket_funcion_facturacion before insert on public.ticket_fac_facturas for each row execute function public.ticket_funcion_permitida('facturacion');
drop trigger if exists ticket_funcion_stock on public.ticket_crm_stock_articulos;
create trigger ticket_funcion_stock before insert on public.ticket_crm_stock_articulos for each row execute function public.ticket_funcion_permitida('stock');
drop trigger if exists ticket_funcion_prevision on public.ticket_crm_previsiones;
create trigger ticket_funcion_prevision before insert on public.ticket_crm_previsiones for each row execute function public.ticket_funcion_permitida('prevision');
drop trigger if exists ticket_funcion_web_eventos on public.ticket_web_eventos;
create trigger ticket_funcion_web_eventos before insert on public.ticket_web_eventos for each row execute function public.ticket_funcion_permitida('entradas_online');
drop trigger if exists ticket_funcion_web_orgs on public.ticket_web_organizaciones;
create trigger ticket_funcion_web_orgs before insert on public.ticket_web_organizaciones for each row execute function public.ticket_funcion_permitida('entradas_online');
drop trigger if exists ticket_funcion_reservados on public.ticket_reservados;
create trigger ticket_funcion_reservados before insert on public.ticket_reservados for each row execute function public.ticket_funcion_permitida('reservados');
drop trigger if exists ticket_funcion_rrpp on public.ticket_rrpp;
create trigger ticket_funcion_rrpp before insert on public.ticket_rrpp for each row execute function public.ticket_funcion_permitida('rrpp');
drop trigger if exists ticket_funcion_conexiones on public.ticket_crm_conexiones;
create trigger ticket_funcion_conexiones before insert on public.ticket_crm_conexiones for each row execute function public.ticket_funcion_permitida('conexiones');

-- Logos de tickets: cada cuenta solo puede subir dentro de su propia carpeta
drop policy if exists "ticketera logos subida" on storage.objects;
create policy "ticketera logos subida" on storage.objects for insert to authenticated
  with check (bucket_id = 'ticketera-logos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- =====================================================================
-- TIXFAST · CUENTAS, SUSCRIPCIÓN Y BLOQUEOS
-- ---------------------------------------------------------------------
-- · ticket_planes: catálogo de planes, precio y funciones bloqueadas.
-- · ticket_cuentas: una ficha por usuario (plan, estado de la suscripción, datos de Stripe).
--   El usuario solo puede LEER su ficha. Plan y estado solo los cambia el servidor
--   (avisos de Stripe o administración con la clave de servicio), nunca la app.
-- · La TICKETERA (venta de entradas online, organizaciones, RRPP y validación de entradas)
--   es SIEMPRE gratuita: de ahí se cobran comisiones.
-- · Todo lo demás (TPV, CRM, facturación, stock, previsión, reservados, conexiones)
--   necesita suscripción. Para empezar hay que darse de alta en la suscripción con
--   renovación automática; los 7 primeros días son de prueba gratuita (una sola vez).
-- · Cuentas que ya existían → plan Fundador, sin bloqueos.
-- · Los bloqueos solo impiden CREAR registros nuevos. Ver y exportar nunca se bloquea.
--   Un evento creado con acceso conserva todo hasta el día siguiente a su fecha:
--   una noche nunca se corta porque acabe la prueba o falle un cobro.
-- =====================================================================

create table if not exists public.ticket_planes (
  id text primary key check (id ~ '^[a-z0-9_]{2,30}$'),
  nombre text not null,
  precio_mes numeric(10,2) check (precio_mes is null or precio_mes >= 0),   -- null = precio aún sin fijar
  limites jsonb not null default '{}'::jsonb,   -- {"bloquea": ["tpv", "crm", …]} (funciones que este plan no incluye)
  publico boolean not null default true,
  orden int not null default 0,
  stripe_price_id text,             -- precio mensual en Stripe (lo crea el servidor al primer alta)
  stripe_price_importe numeric(10,2),
  creado_en timestamptz not null default now()
);
alter table public.ticket_planes enable row level security;
drop policy if exists planes_ver on public.ticket_planes;
create policy planes_ver on public.ticket_planes for select to authenticated using (true);
revoke all on public.ticket_planes from anon, authenticated;
grant select on public.ticket_planes to authenticated;

insert into public.ticket_planes (id, nombre, precio_mes, limites, publico, orden) values
  ('fundador', 'Fundador', null, '{}'::jsonb, false, 0),
  ('sin_suscripcion', 'Sin suscripción', 0, '{"bloquea": ["tpv", "crm", "facturacion", "stock", "prevision", "reservados", "conexiones"]}'::jsonb, false, 1),
  ('pro',      'TIXFAST',  29.90, '{}'::jsonb, true, 2)
on conflict (id) do nothing;

create table if not exists public.ticket_cuentas (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  nombre text check (nombre is null or length(nombre) <= 120),
  plan_id text not null default 'pro' references public.ticket_planes(id),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'prueba', 'activa', 'impagada', 'suspendida', 'cancelada', 'cortesia')),   -- cortesia = regalada por TIXFAST (hasta periodo_fin o sin fin)
  prueba_hasta timestamptz,
  prueba_usada boolean not null default false,     -- la prueba gratuita solo se da una vez
  periodo_fin timestamptz,
  cancela_al_final boolean not null default false, -- ha pedido cancelar: sigue hasta periodo_fin
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

-- Ficha automática al registrarse (sin suscripción hasta que se dé de alta)
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
        when c.estado = 'cortesia' then c.periodo_fin is null or c.periodo_fin > now()
        when c.estado = 'prueba' then coalesce(c.prueba_hasta + interval '1 day' > now(), false)   -- 1 día de margen por si el aviso de Stripe tarda
        when c.estado = 'impagada' then coalesce(c.periodo_fin, c.actualizada_en) + interval '7 days' > now()
        else false
      end as con_acceso,
      case
        when c.estado = 'prueba' then c.prueba_hasta
        when c.estado = 'cortesia' then c.periodo_fin
        when c.estado = 'impagada' then coalesce(c.periodo_fin, c.actualizada_en) + interval '7 days'
        when c.estado in ('suspendida', 'cancelada') then coalesce(c.periodo_fin, c.actualizada_en)
      end as fin
    from public.ticket_cuentas c where c.owner_id = p_owner
  )
  select p.id, p.nombre, c.estado, p.limites, (c.estado = 'prueba' and c.con_acceso), c.fin
  from c join public.ticket_planes p on p.id = case when c.con_acceso then c.plan_id else 'sin_suscripcion' end;
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

-- Quitar límites de versiones anteriores de este archivo (si existieran)
drop trigger if exists ticket_eventos_limite on public.ticket_eventos;
drop trigger if exists ticket_puntos_limite on public.ticket_puntos;
drop function if exists public.ticket_eventos_limite();
drop function if exists public.ticket_puntos_limite();

-- Funciones de pago: impide CREAR registros nuevos si el plan las bloquea
create or replace function public.ticket_funcion_permitida()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a record; f text := tg_argv[0]; ev_id uuid; ev record;
  nombres jsonb := '{"tpv":"El TPV","crm":"El CRM","facturacion":"La facturación","stock":"El control de stock","prevision":"La previsión","reservados":"Los reservados VIP","conexiones":"La conexión con ticketeras"}';
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
  raise exception using errcode = 'P0001', message = format('TIXFAST: %s va con la suscripción. Actívala en Ajustes › Tu cuenta (7 días de prueba gratis).', coalesce(nombres ->> f, 'Esta función'));
end $$;
revoke all on function public.ticket_funcion_permitida() from public, anon, authenticated;

-- Quitar disparadores de la ticketera de versiones anteriores (la ticketera es gratuita)
drop trigger if exists ticket_funcion_web_eventos on public.ticket_web_eventos;
drop trigger if exists ticket_funcion_web_orgs on public.ticket_web_organizaciones;
drop trigger if exists ticket_funcion_rrpp on public.ticket_rrpp;

do $t$
declare r record;
begin
  for r in select * from (values
    ('ticket_ventas', 'tpv'), ('ticket_gastos', 'tpv'),
    ('ticket_crm_ingresos', 'crm'), ('ticket_crm_gastos', 'crm'), ('ticket_crm_socios', 'crm'), ('ticket_crm_liquidaciones', 'crm'),
    ('ticket_fac_facturas', 'facturacion'), ('ticket_crm_stock_articulos', 'stock'), ('ticket_crm_previsiones', 'prevision'),
    ('ticket_reservados', 'reservados'), ('ticket_crm_conexiones', 'conexiones')) as x(tabla, funcion)
  loop
    execute format('drop trigger if exists ticket_funcion_%s on public.%I', r.funcion, r.tabla);
    execute format('drop trigger if exists %I on public.%I', 'ticket_plan_' || r.tabla, r.tabla);
    execute format('create trigger %I before insert on public.%I for each row execute function public.ticket_funcion_permitida(%L)', 'ticket_plan_' || r.tabla, r.tabla, r.funcion);
  end loop;
end $t$;

-- Logos de tickets: cada cuenta solo puede subir dentro de su propia carpeta
drop policy if exists "ticketera logos subida" on storage.objects;
create policy "ticketera logos subida" on storage.objects for insert to authenticated
  with check (bucket_id = 'ticketera-logos' and (storage.foldername(name))[1] = (select auth.uid())::text);

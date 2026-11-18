-- Réplica local (subconjunto) del esquema de producción de TIXFAST para pruebas de carga.
-- Definiciones copiadas de producción (pg_get_functiondef / catálogo) el 18/11/2026.
create extension if not exists pgcrypto;
create schema if not exists extensions;
create or replace function extensions.hmac(bytea, bytea, text) returns bytea language sql immutable as $$ select public.hmac($1,$2,$3) $$;
create or replace function extensions.digest(text, text) returns bytea language sql immutable as $$ select public.digest($1,$2) $$;
create or replace function extensions.gen_random_bytes(int) returns bytea language sql volatile as $$ select public.gen_random_bytes($1) $$;

create schema if not exists auth;
create table auth.users (id uuid primary key);
-- Igual que en Supabase: el usuario sale del JWT (aquí, de un ajuste de la sesión)
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin create role authenticated nologin; exception when others then null; end $$;
do $$ begin create role anon nologin; exception when others then null; end $$;
grant usage on schema public, auth, extensions to authenticated, anon;

create table public.ticket_planes (id text not null, nombre text not null, precio_mes numeric(10,2), limites jsonb not null default '{}'::jsonb, publico boolean not null default true, orden integer not null default 0, stripe_price_id text, stripe_price_importe numeric(10,2), creado_en timestamp with time zone not null default now(), descripcion text, destacado boolean not null default false, dias_prueba integer not null default 7, sistema boolean not null default false, archivado boolean not null default false, stripe_product_id text, stripe_sincronizado_en timestamp with time zone, actualizado_en timestamp with time zone not null default now(), primary key (id));
create table public.ticket_cuentas (owner_id uuid not null primary key references auth.users(id) on delete cascade, nombre text, plan_id text not null default 'pro'::text references ticket_planes(id), estado text not null default 'pendiente'::text, prueba_hasta timestamp with time zone, prueba_usada boolean not null default false, periodo_fin timestamp with time zone, cancela_al_final boolean not null default false, proveedor_pago text, cliente_pago_id text, suscripcion_pago_id text, creada_en timestamp with time zone not null default now(), actualizada_en timestamp with time zone not null default now(), estado_desde timestamp with time zone not null default now());
create table public.ticket_eventos (id uuid not null default gen_random_uuid() primary key, owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade, nombre text not null, fecha date, recinto text default ''::text, plantilla text not null default 'festival'::text, papel integer not null default 80, pie text default ''::text, logo_url text default ''::text, logo_texto text default ''::text, mostrar_evento boolean default true, mostrar_fecha boolean default true, mostrar_hora boolean default true, mostrar_precio boolean default true, pin_admin text default '1234'::text, pin_supervisor text default '0000'::text, creado_en timestamp with time zone default now(), anular_pin boolean default false, ticket_style jsonb default '{}'::jsonb, cerrada boolean default false, inicio text, venta_avanzada boolean default false, ayuda_cambio boolean default true, pedir_fondo boolean not null default true, qr_activo boolean not null default false, qr_clave text not null default encode(gen_random_bytes(32), 'hex'::text), fin timestamp with time zone, pin_admin_huella text, pin_supervisor_huella text, borrado_en timestamp with time zone, borrado_previo jsonb);
create table public.ticket_puntos (id uuid not null default gen_random_uuid() primary key, owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade, evento_id uuid not null references ticket_eventos(id) on delete cascade, nombre text not null, orden integer default 0, creado_en timestamp with time zone default now(), archivado boolean default false, combos jsonb default '[]'::jsonb, fondo numeric(10,2), fondo_en timestamp with time zone, fondo_por text, orden_modo text not null default 'manual'::text, fondo_previsto numeric(10,2), estado text not null default 'prueba'::text, abierta_en timestamp with time zone, abierta_por text, cerrada_en timestamp with time zone, cerrada_por text);
create table public.ticket_productos (id uuid not null default gen_random_uuid() primary key, owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade, punto_id uuid not null references ticket_puntos(id) on delete cascade, nombre text not null, precio numeric(10,2) not null default 0, color text default '#3b82f6'::text, emoji text default '🎫'::text, agotado boolean default false, orden integer default 0, creado_en timestamp with time zone default now(), subtitulo text not null default ''::text, imprimir boolean not null default true, qr boolean not null default true);
create table public.ticket_cierres (id uuid not null default gen_random_uuid() primary key, owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade, evento_id uuid not null references ticket_eventos(id) on delete cascade, punto_id uuid not null references ticket_puntos(id) on delete cascade, tickets integer not null, facturacion numeric(12,2) not null, anulaciones integer not null default 0, detalle jsonb, cerrado_por text, creado_en timestamp with time zone default now(), efectivo numeric(10,2) default 0, tarjeta numeric(10,2) default 0, fondo numeric(10,2) default 0, contado numeric(10,2), gastos numeric not null default 0, entradas numeric not null default 0, esperado numeric, revertido_en timestamp with time zone, revertido_por text);
create table public.ticket_ventas (id uuid not null default gen_random_uuid() primary key, owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade, evento_id uuid not null references ticket_eventos(id) on delete cascade, punto_id uuid not null references ticket_puntos(id) on delete restrict, producto_id uuid references ticket_productos(id) on delete set null, nombre text not null, precio numeric(10,2) not null, numero integer not null, codigo text, operario text, anulada boolean default false, anulada_en timestamp with time zone, anulada_por text, client_uuid uuid unique, creado_en timestamp with time zone default now(), closure_id uuid, metodo_pago text, entregado numeric(10,2), cambio numeric(10,2));
create table public.ticket_gastos (id uuid not null default gen_random_uuid() primary key, owner_id uuid not null default auth.uid(), evento_id uuid not null references ticket_eventos(id) on delete cascade, punto_id uuid not null references ticket_puntos(id) on delete cascade, importe numeric(10,2) not null check (importe > 0 and importe < 1000000), concepto text not null default ''::text, registrado_por text, creado_en timestamp with time zone not null default now(), anulado boolean not null default false, closure_id uuid references ticket_cierres(id) on delete set null, tipo text not null default 'gasto'::text, categoria text, crm_gasto_id uuid);
create table public.ticket_puestos (id uuid not null default gen_random_uuid() primary key, owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade, evento_id uuid not null references ticket_eventos(id) on delete cascade, nombre text not null, color text not null default '#ff5a3c'::text, contacto text, activo boolean not null default true, comision_tipo text not null default 'pct'::text, comision_valor numeric(10,2) not null default 0, pin_huella text, pin_creado_en timestamp with time zone, intentos integer not null default 0, bloqueado_hasta timestamp with time zone, activar_huella text unique, activar_caduca timestamp with time zone, orden integer not null default 0, creado_en timestamp with time zone not null default now(), actualizado_en timestamp with time zone not null default now());
create table public.ticket_puesto_productos (puesto_id uuid not null references ticket_puestos(id) on delete cascade, owner_id uuid not null, consumicion text not null, comision_tipo text, comision_valor numeric(10,2), primary key (puesto_id, consumicion));
create table public.ticket_puesto_sesiones (id uuid not null default gen_random_uuid() primary key, puesto_id uuid not null references ticket_puestos(id) on delete cascade, huella text not null unique, dispositivo text, creada_en timestamp with time zone not null default now(), caduca_en timestamp with time zone not null, desbloqueado_hasta timestamp with time zone not null, ultimo_uso timestamp with time zone not null default now(), revocada boolean not null default false);
create table public.ticket_canjes (id uuid not null default gen_random_uuid() primary key, owner_id uuid not null default auth.uid(), evento_id uuid not null references ticket_eventos(id) on delete cascade, venta_uuid uuid not null, idx smallint not null default 0, unidades smallint not null default 1, producto_id uuid, nombre text, punto_venta_id uuid references ticket_puntos(id) on delete set null, punto_id uuid references ticket_puntos(id) on delete set null, dispositivo text, origen text not null default 'qr'::text, sin_conexion boolean not null default false, venta_pendiente boolean not null default false, canjeado_en timestamp with time zone not null default now(), recibido_en timestamp with time zone not null default now(), puesto_id uuid references ticket_puestos(id), valor numeric(10,2), constraint ticket_canjes_unico unique (evento_id, venta_uuid, idx));
create table public.ticket_canje_rechazos (id uuid not null default gen_random_uuid() primary key, owner_id uuid not null default auth.uid(), evento_id uuid not null references ticket_eventos(id) on delete cascade, venta_uuid uuid, idx smallint, motivo text not null, detalle jsonb, punto_id uuid references ticket_puntos(id) on delete set null, dispositivo text, sin_conexion boolean not null default false, creado_en timestamp with time zone not null default now(), puesto_id uuid references ticket_puestos(id) on delete cascade);
create table public.ticket_web_eventos (evento_id uuid not null primary key references ticket_eventos(id) on delete cascade, owner_id uuid not null default auth.uid(), slug text not null unique, estado text not null default 'borrador'::text, modo text not null default 'pruebas'::text, venta_inicio timestamptz, qr_horas_antes integer not null default 24, contador integer not null default 0);
create table public.ticket_web_pedidos (id uuid not null default gen_random_uuid() primary key, owner_id uuid not null, evento_id uuid not null references ticket_eventos(id) on delete cascade, codigo text not null unique, acceso uuid not null default gen_random_uuid() unique, email text not null, nombre text not null, datos jsonb not null default '{}'::jsonb, total numeric(10,2) not null default 0, estado text not null, prueba boolean not null default false, ip text, creado_en timestamp with time zone not null default now());
create table public.ticket_web_entradas (id uuid not null default gen_random_uuid() primary key, owner_id uuid not null, evento_id uuid not null references ticket_eventos(id) on delete cascade, pedido_id uuid not null references ticket_web_pedidos(id) on delete cascade, tramo_id uuid, tramo_nombre text not null, numero integer not null, asistente text not null, dni text, precio numeric(10,2) not null default 0, estado text not null default 'valida'::text, prueba boolean not null default false, qr_hex text not null, emision integer not null default 1, creado_en timestamp with time zone not null default now(), unique (evento_id, numero));

-- Índices de producción
CREATE INDEX ix_ticket_cierres_evento ON public.ticket_cierres USING btree (evento_id);
CREATE INDEX ix_ticket_cierres_punto ON public.ticket_cierres USING btree (punto_id);
CREATE INDEX ix_ticket_eventos_owner ON public.ticket_eventos USING btree (owner_id);
CREATE INDEX ix_ticket_productos_owner ON public.ticket_productos USING btree (owner_id);
CREATE INDEX ix_ticket_productos_punto ON public.ticket_productos USING btree (punto_id);
CREATE INDEX ix_ticket_puntos_evento ON public.ticket_puntos USING btree (evento_id);
CREATE INDEX ix_ticket_puntos_owner ON public.ticket_puntos USING btree (owner_id);
CREATE INDEX ix_ticket_ventas_creado ON public.ticket_ventas USING btree (creado_en);
CREATE INDEX ix_ticket_ventas_ev_creado ON public.ticket_ventas USING btree (evento_id, creado_en, id);
CREATE INDEX ix_ticket_ventas_evento ON public.ticket_ventas USING btree (evento_id);
CREATE INDEX ix_ticket_ventas_evento_anu ON public.ticket_ventas USING btree (evento_id, anulada);
CREATE INDEX ix_ticket_ventas_owner ON public.ticket_ventas USING btree (owner_id);
CREATE INDEX ix_ticket_ventas_producto ON public.ticket_ventas USING btree (producto_id);
CREATE INDEX ix_ticket_ventas_punto ON public.ticket_ventas USING btree (punto_id);
CREATE INDEX ticket_ventas_evento_client_idx ON public.ticket_ventas USING btree (evento_id, client_uuid);
CREATE INDEX ticket_ventas_metodo_idx ON public.ticket_ventas USING btree (evento_id, punto_id, metodo_pago);
CREATE INDEX ticket_canje_rechazos_evento_idx ON public.ticket_canje_rechazos USING btree (evento_id);
CREATE INDEX ticket_canje_rechazos_puesto ON public.ticket_canje_rechazos USING btree (puesto_id, creado_en DESC) WHERE (puesto_id IS NOT NULL);
CREATE INDEX ticket_canjes_owner_idx ON public.ticket_canjes USING btree (owner_id);
CREATE INDEX ticket_canjes_puesto ON public.ticket_canjes USING btree (puesto_id, canjeado_en DESC) WHERE (puesto_id IS NOT NULL);
CREATE INDEX ticket_gastos_evento_idx ON public.ticket_gastos USING btree (evento_id);
CREATE INDEX ticket_gastos_punto_idx ON public.ticket_gastos USING btree (punto_id) WHERE (closure_id IS NULL);
CREATE INDEX ticket_puesto_sesiones_puesto ON public.ticket_puesto_sesiones USING btree (puesto_id) WHERE (NOT revocada);
CREATE INDEX ticket_puestos_evento ON public.ticket_puestos USING btree (evento_id, orden);
CREATE INDEX ticket_web_entradas_pedido_id_idx ON public.ticket_web_entradas USING btree (pedido_id);
CREATE INDEX ticket_web_entradas_evento_creado_idx ON public.ticket_web_entradas USING btree (evento_id, creado_en DESC) WHERE (estado = 'valida'::text);
CREATE INDEX ticket_web_pedidos_evento_id_creado_en_idx ON public.ticket_web_pedidos USING btree (evento_id, creado_en DESC);

-- Funciones de producción
CREATE OR REPLACE FUNCTION public.ticket_owns_evento(e uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path TO ''
AS $function$ select e is null or exists (select 1 from public.ticket_eventos x where x.id = e and x.owner_id = (select auth.uid())) $function$;
CREATE OR REPLACE FUNCTION public.ticket_owns_producto(p uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path TO ''
AS $function$ select p is null or exists (select 1 from public.ticket_productos x where x.id = p and x.owner_id = (select auth.uid())) $function$;
CREATE OR REPLACE FUNCTION public.ticket_owns_punto(p uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path TO ''
AS $function$ select p is null or exists (select 1 from public.ticket_puntos x where x.id = p and x.owner_id = (select auth.uid())) $function$;

CREATE OR REPLACE FUNCTION public.ticket_acceso_de(p_owner uuid)
 RETURNS TABLE(plan_id text, plan_nombre text, estado text, limites jsonb, en_prueba boolean, fin_acceso timestamp with time zone)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  with c as (
    select c.*,
      case
        when c.estado = 'activa' then true
        when c.estado = 'cortesia' then c.periodo_fin is null or c.periodo_fin > now()
        when c.estado = 'prueba' then coalesce(c.prueba_hasta + interval '1 day' > now(), false)
        when c.estado = 'impagada' then c.estado_desde + interval '7 days' > now()
        else false
      end as con_acceso,
      case
        when c.estado = 'prueba' then c.prueba_hasta
        when c.estado = 'cortesia' then c.periodo_fin
        when c.estado = 'impagada' then c.estado_desde + interval '7 days'
        when c.estado in ('suspendida', 'cancelada') then c.estado_desde
      end as fin
    from public.ticket_cuentas c where c.owner_id = p_owner
  )
  select p.id, p.nombre, c.estado, p.limites, (c.estado = 'prueba' and c.con_acceso), c.fin
  from c join public.ticket_planes p on p.id = case when c.con_acceso then c.plan_id else 'sin_suscripcion' end;
$function$;
CREATE OR REPLACE FUNCTION public.ticket_evento_protegido(p_evento uuid, p_fin timestamp with time zone)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  select p_evento is not null and p_fin is not null and exists (
    select 1 from public.ticket_eventos e where e.id = p_evento and e.creado_en <= p_fin and coalesce(e.fecha, current_date) >= current_date - 1);
$function$;
CREATE OR REPLACE FUNCTION public.ticket_funcion_permitida()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare a record; f text := tg_argv[0]; ev_id uuid;
begin
  if (select auth.uid()) is null or new.owner_id is distinct from (select auth.uid()) then return new; end if;
  select * into a from public.ticket_acceso_de(new.owner_id);
  if not found or not coalesce(a.limites -> 'bloquea' ? f, false) then return new; end if;
  ev_id := nullif(to_jsonb(new) ->> 'evento_id', '')::uuid;
  if a.plan_id = 'sin_suscripcion' and public.ticket_evento_protegido(ev_id, a.fin_acceso) then return new; end if;
  raise exception using errcode = 'P0001', message = format('TIXFAST: %s no va incluido en tu plan', f);
end $function$;
CREATE TRIGGER ticket_plan_ticket_ventas BEFORE INSERT ON public.ticket_ventas FOR EACH ROW EXECUTE FUNCTION ticket_funcion_permitida('tpv');
CREATE TRIGGER ticket_plan_ticket_gastos BEFORE INSERT ON public.ticket_gastos FOR EACH ROW EXECUTE FUNCTION ticket_funcion_permitida('tpv');

CREATE OR REPLACE FUNCTION public.ticket_vender(p_evento uuid, p_punto uuid, p_producto uuid, p_nombre text, p_precio numeric, p_qty integer DEFAULT 1, p_codigos text[] DEFAULT NULL::text[], p_operario text DEFAULT NULL::text, p_client_uuids uuid[] DEFAULT NULL::uuid[], p_metodo text DEFAULT NULL::text, p_entregado numeric DEFAULT NULL::numeric, p_cambio numeric DEFAULT NULL::numeric)
 RETURNS SETOF ticket_ventas LANGUAGE plpgsql SET search_path TO ''
AS $function$
declare v_base int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_evento::text, 0));
  select coalesce(max(numero), 0) into v_base from public.ticket_ventas where evento_id = p_evento;
  return query
  insert into public.ticket_ventas
    (evento_id, punto_id, producto_id, nombre, precio, numero, codigo, operario, client_uuid,
     metodo_pago, entregado, cambio)
  select p_evento, p_punto, p_producto, p_nombre, p_precio, v_base + g,
         coalesce(p_codigos[g], null), p_operario,
         coalesce(p_client_uuids[g], gen_random_uuid()),
         p_metodo,
         case when g = 1 then p_entregado else null end,
         case when g = 1 then p_cambio else null end
  from generate_series(1, greatest(p_qty, 1)) as g
  returning *;
end $function$;

CREATE OR REPLACE FUNCTION public.ticket_anular_ultima(p_evento uuid, p_punto uuid, p_por text DEFAULT NULL::text)
 RETURNS ticket_ventas LANGUAGE plpgsql SET search_path TO ''
AS $function$
declare v_row public.ticket_ventas;
begin
  update public.ticket_ventas set anulada = true, anulada_en = now(), anulada_por = p_por
  where id = (select id from public.ticket_ventas where evento_id = p_evento and punto_id = p_punto and not anulada order by creado_en desc, numero desc limit 1)
  returning * into v_row;
  return v_row;
end $function$;

-- RLS como en producción
alter table public.ticket_eventos enable row level security;
alter table public.ticket_puntos enable row level security;
alter table public.ticket_productos enable row level security;
alter table public.ticket_ventas enable row level security;
alter table public.ticket_cierres enable row level security;
alter table public.ticket_gastos enable row level security;
alter table public.ticket_canjes enable row level security;
create policy owner_all on public.ticket_eventos for all to public using ((owner_id = (select auth.uid()))) with check ((owner_id = (select auth.uid())));
create policy owner_all on public.ticket_puntos for all to public using ((owner_id = (select auth.uid()))) with check (((owner_id = (select auth.uid())) and ticket_owns_evento(evento_id)));
create policy owner_all on public.ticket_productos for all to public using ((owner_id = (select auth.uid()))) with check (((owner_id = (select auth.uid())) and ticket_owns_punto(punto_id)));
create policy owner_all on public.ticket_ventas for all to public using ((owner_id = (select auth.uid()))) with check (((owner_id = (select auth.uid())) and ticket_owns_evento(evento_id) and ticket_owns_punto(punto_id) and ticket_owns_producto(producto_id)));
create policy owner_all on public.ticket_cierres for all to public using ((owner_id = (select auth.uid()))) with check (((owner_id = (select auth.uid())) and ticket_owns_evento(evento_id) and ticket_owns_punto(punto_id)));
create policy owner_all on public.ticket_gastos for all to authenticated using ((owner_id = (select auth.uid()))) with check (((owner_id = (select auth.uid())) and ticket_owns_evento(evento_id) and ticket_owns_punto(punto_id)));
create policy owner_select on public.ticket_canjes for select to authenticated using ((owner_id = (select auth.uid())));
grant select, insert, update, delete on all tables in schema public to authenticated;

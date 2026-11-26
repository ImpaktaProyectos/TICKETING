-- Tablas web completas (DDL de producción) para probar la compra de entradas
drop table if exists ticket_web_entradas, ticket_web_pedidos, ticket_web_eventos cascade;
create table public.ticket_web_eventos (evento_id uuid not null primary key references ticket_eventos(id) on delete cascade, owner_id uuid not null default auth.uid(), slug text not null unique, estado text not null default 'borrador'::text, modo text not null default 'pruebas'::text, descripcion text, direccion text, maps_url text, edad_minima integer, autorizacion_url text, autorizacion_edad integer not null default 16, vestimenta text, flyer_url text, logo_url text, diseno jsonb not null default '{}'::jsonb, formulario jsonb not null default '{}'::jsonb, avisos jsonb not null default '{}'::jsonb, venta_inicio timestamp with time zone, secuencial boolean not null default true, qr_horas_antes integer not null default 24, max_por_email integer not null default 10, contador integer not null default 0, actualizado_en timestamp with time zone not null default now(), organizacion_id uuid, pago_pruebas boolean not null default false);
create table public.ticket_web_tramos (id uuid not null default gen_random_uuid() primary key, owner_id uuid not null default auth.uid(), evento_id uuid not null references ticket_eventos(id) on delete cascade, nombre text not null, descripcion text, precio numeric(10,2) not null default 0, cantidad integer, vendidas integer not null default 0, orden integer not null default 0, venta_inicio timestamp with time zone, venta_fin timestamp with time zone, max_por_compra integer not null default 10, visible boolean not null default true, copas integer not null default 0, creado_en timestamp with time zone not null default now());
create table public.ticket_web_pedidos (id uuid not null default gen_random_uuid() primary key, owner_id uuid not null, evento_id uuid not null references ticket_eventos(id) on delete cascade, codigo text not null unique, acceso uuid not null default gen_random_uuid() unique, email text not null, nombre text not null, datos jsonb not null default '{}'::jsonb, total numeric(10,2) not null default 0, estado text not null, prueba boolean not null default false, ip text, agente text, creado_en timestamp with time zone not null default now(), email_envios integer not null default 0, email_ultimo timestamp with time zone, email_error text, compra_id uuid, gastos numeric(10,2) not null default 0, marketing boolean not null default false, privacidad_version text, rrpp_id uuid, rrpp_efectivo boolean not null default false);
create table public.ticket_web_entradas (id uuid not null default gen_random_uuid() primary key, owner_id uuid not null, evento_id uuid not null references ticket_eventos(id) on delete cascade, pedido_id uuid not null references ticket_web_pedidos(id) on delete cascade, tramo_id uuid references ticket_web_tramos(id) on delete set null, tramo_nombre text not null, numero integer not null, asistente text not null, dni text, precio numeric(10,2) not null default 0, estado text not null default 'valida'::text, prueba boolean not null default false, qr_hex text not null, emision integer not null default 1, creado_en timestamp with time zone not null default now(), rrpp_id uuid, unique (evento_id, numero));
CREATE INDEX ticket_web_entradas_pedido_id_idx ON public.ticket_web_entradas USING btree (pedido_id);
CREATE INDEX ticket_web_entradas_tramo_idx ON public.ticket_web_entradas USING btree (tramo_id);
CREATE INDEX ticket_web_entradas_evento_creado_idx ON public.ticket_web_entradas USING btree (evento_id, creado_en DESC) WHERE (estado = 'valida'::text);
CREATE INDEX ticket_web_pedidos_evento_id_creado_en_idx ON public.ticket_web_pedidos USING btree (evento_id, creado_en DESC);
CREATE INDEX ticket_web_pedidos_evento_id_lower_idx ON public.ticket_web_pedidos USING btree (evento_id, lower(email));
CREATE INDEX ticket_web_pedidos_ip_idx ON public.ticket_web_pedidos USING btree (ip, creado_en DESC) WHERE (ip IS NOT NULL);
CREATE INDEX ticket_web_tramos_evento_id_orden_idx ON public.ticket_web_tramos USING btree (evento_id, orden);
create table if not exists public.ticket_web_legal (owner_id uuid primary key, razon_social text, nif text, direccion text, email text, conservar_meses integer not null default 24);
create table if not exists public.ticket_pagos (pedido_id uuid primary key, owner_id uuid, evento_id uuid, modo text, estado text default 'pendiente', entradas numeric, gastos numeric, importe numeric, asistentes jsonb, rrpp text, caduca_en timestamptz);
CREATE OR REPLACE FUNCTION public.web_legal_de(p_owner uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  select jsonb_build_object('razon_social', l.razon_social, 'nif', l.nif, 'direccion', l.direccion, 'email', l.email, 'conservar_meses', l.conservar_meses) from public.ticket_web_legal l where l.owner_id = p_owner $function$;
CREATE OR REPLACE FUNCTION public.web_tramos_estado(p_evento uuid) RETURNS TABLE(id uuid, estado text, quedan integer) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
declare f record; e record; t record; ahora timestamptz := now(); previo_abierto boolean := false; est text;
begin
  select * into f from public.ticket_web_eventos where evento_id = p_evento;
  select fin into e from public.ticket_eventos where ticket_eventos.id = p_evento;
  for t in select * from public.ticket_web_tramos x where x.evento_id = p_evento and x.visible order by x.orden, x.creado_en loop
    if e.fin is not null and ahora > e.fin then est := 'finalizado';
    elsif t.venta_fin is not null and ahora > t.venta_fin then est := 'finalizado';
    elsif t.cantidad is not null and t.vendidas >= t.cantidad then est := 'agotado';
    elsif f.venta_inicio is not null and ahora < f.venta_inicio then est := 'proximo';
    elsif t.venta_inicio is not null and ahora < t.venta_inicio then est := 'proximo';
    elsif f.secuencial and previo_abierto then est := 'proximo';
    else est := 'venta'; end if;
    if est in ('venta','proximo') then previo_abierto := true; end if;
    id := t.id; estado := est; quedan := case when t.cantidad is null then null else greatest(t.cantidad - t.vendidas, 0) end;
    return next;
  end loop;
end $function$;
-- Sin RRPP ni pagos en la prueba: mismas firmas, sin efecto
create or replace function public.rrpp_atribuir(p_pedido uuid, p_evento uuid, p_owner uuid, p_codigo text) returns void language sql as $$ select $$;
create or replace function public.pago_gastos(numeric) returns numeric language sql as $$ select 0::numeric $$;
-- Lanzamiento gratuito (sin pasarela) con 20.000 entradas y 8.000 ya vendidas
insert into ticket_web_eventos (evento_id, owner_id, slug, estado, modo, max_por_email, secuencial) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'festival', 'publicado', 'real', 10, false);
insert into ticket_web_tramos (id, owner_id, evento_id, nombre, precio, cantidad, vendidas, max_por_compra) values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'General', 0, 1000000, 8000, 10);
insert into ticket_web_pedidos (id, owner_id, evento_id, codigo, email, nombre, estado, total, ip)
select ('20000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'P' || g, 'c' || g || '@x.es', 'Cliente ' || g, 'gratis', 0, '10.0.' || (g % 250) || '.' || (g % 7)
from generate_series(1, 4000) g;
insert into ticket_web_entradas (owner_id, evento_id, pedido_id, tramo_id, tramo_nombre, numero, asistente, qr_hex)
select '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', ('20000000-0000-0000-0000-' || lpad(((g + 1) / 2)::text, 12, '0'))::uuid, '30000000-0000-0000-0000-000000000001', 'General', g, 'Asistente ' || g, 'x'
from generate_series(1, 8000) g;
update ticket_web_eventos set contador = 8000;
grant execute on all functions in schema public to anon, authenticated;
analyze;

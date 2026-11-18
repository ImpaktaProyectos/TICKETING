-- =====================================================================
-- TIXFAST · RENDIMIENTO CON MUCHA GENTE A LA VEZ
-- ---------------------------------------------------------------------
-- Prueba de carga del 18/11/2026 (300 fiestas a la vez, ~800 dispositivos, un festival con
-- 30.000 ventas): la base de datos no llegaba. Tres causas en la base de datos:
--
-- 1) Cada venta buscaba el número de ticket más alto recorriendo TODAS las ventas de la cuenta
--    (con la seguridad por filas, Postgres usaba el índice por dueño), y lo hacía con el evento
--    bloqueado: las barras de un evento grande venden de una en una y cada venta tardaba más
--    cuantas más ventas tenía la cuenta.
--    → índice (owner_id, evento_id, numero): encaja con la seguridad por filas, así que sirve para
--    sacar el último número al momento y para descargar las ventas de un evento por orden y por
--    tramos (antes cada página de 1.000 ordenaba todas las ventas de la cuenta).
--    El índice antiguo solo por evento_id lo cubren los demás (se borra: no suma trabajo a cada venta).
--
-- 2) Cada vez que una barra vendía, TODOS los equipos del evento volvían a descargar TODAS las
--    ventas (30 páginas de 1.000 en un festival, cada 2,5 s y en cada equipo).
--    → columna actualizado_en (se pone sola al crear o cambiar una venta) + índice: la app ya solo
--    pide lo que ha cambiado desde la última vez. Las ventas antiguas quedan con actualizado_en vacío:
--    la app las tiene de la carga completa y solo pide las nuevas o cambiadas.
--
-- 3) Cada escáner descargaba cada 15 s todos los canjes del evento.
--    → índice (evento_id, recibido_en): solo pide los canjes nuevos.
-- Sin cambios de comportamiento: solo índices, una columna con valor automático y su disparador.
-- =====================================================================

-- 1) Número de ticket sin recorrer el evento
create index if not exists ticket_ventas_owner_evento_numero on public.ticket_ventas (owner_id, evento_id, numero);
drop index if exists public.ix_ticket_ventas_evento;

-- El último número se pide aquí (comprobando antes que el evento es de quien vende), con la
-- consulta exacta que encaja con el índice de arriba.
create or replace function public.ticket_ultimo_numero(p_evento uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select case when exists (select 1 from public.ticket_eventos e where e.id = p_evento and e.owner_id = (select auth.uid()))
    then coalesce((select v.numero from public.ticket_ventas v where v.owner_id = (select auth.uid()) and v.evento_id = p_evento order by v.numero desc limit 1), 0)
    else 0 end;
$$;
revoke all on function public.ticket_ultimo_numero(uuid) from public, anon;
grant execute on function public.ticket_ultimo_numero(uuid) to authenticated;

-- Misma venta de siempre (misma firma, mismo bloqueo por evento, misma numeración); solo cambia
-- cómo se obtiene el último número. El insert sigue pasando por la seguridad por filas.
create or replace function public.ticket_vender(p_evento uuid, p_punto uuid, p_producto uuid, p_nombre text, p_precio numeric,
  p_qty integer default 1, p_codigos text[] default null::text[], p_operario text default null::text, p_client_uuids uuid[] default null::uuid[],
  p_metodo text default null::text, p_entregado numeric default null::numeric, p_cambio numeric default null::numeric)
returns setof public.ticket_ventas language plpgsql set search_path = '' as $$
declare v_base int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_evento::text, 0));
  v_base := public.ticket_ultimo_numero(p_evento);
  return query
  insert into public.ticket_ventas
    (evento_id, punto_id, producto_id, nombre, precio, numero, codigo, operario, client_uuid,
     metodo_pago, entregado, cambio)
  select p_evento, p_punto, p_producto, p_nombre, p_precio, v_base + g,
         coalesce(p_codigos[g], null), p_operario,
         coalesce(p_client_uuids[g], gen_random_uuid()),
         p_metodo,
         case when g = 1 then p_entregado else null end,  -- solo en la 1ª línea del cobro
         case when g = 1 then p_cambio else null end
  from generate_series(1, greatest(p_qty, 1)) as g
  returning *;
end $$;

-- 2) Cambios de ventas desde un momento
alter table public.ticket_ventas add column if not exists actualizado_en timestamptz;
alter table public.ticket_ventas alter column actualizado_en set default now();

create or replace function public.ticket_ventas_actualizado()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.actualizado_en := now();
  return new;
end $$;
revoke all on function public.ticket_ventas_actualizado() from public, anon, authenticated;

drop trigger if exists ticket_ventas_actualizado on public.ticket_ventas;
create trigger ticket_ventas_actualizado before update on public.ticket_ventas
  for each row execute function public.ticket_ventas_actualizado();

create index if not exists ticket_ventas_evento_actualizado on public.ticket_ventas (evento_id, actualizado_en);

-- 3) Canjes nuevos desde un momento (escáneres)
create index if not exists ticket_canjes_evento_recibido on public.ticket_canjes (evento_id, recibido_en);

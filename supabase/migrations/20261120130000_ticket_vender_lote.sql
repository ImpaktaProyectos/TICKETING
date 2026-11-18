-- =====================================================================
-- TIXFAST · SUBIR LAS VENTAS PENDIENTES EN LOTES (al volver internet)
-- ---------------------------------------------------------------------
-- Sin conexión, el TPV guarda cada venta en el equipo y la sube al volver la red. Hasta ahora subía
-- una petición por venta, una detrás de otra: tras un corte de wifi en plena fiesta, 2.000 ventas
-- eran 2.000 peticiones seguidas (minutos de subida, y una avalancha si se reconectan todos los
-- equipos a la vez).
--
-- ticket_vender_lote sube hasta 100 ventas en una sola petición, EN EL MISMO ORDEN, llamando a
-- ticket_vender para cada una (misma numeración, mismas comprobaciones y misma seguridad por filas:
-- la función se ejecuta con los permisos de quien vende, no con permisos especiales).
-- · Las ventas que ya estaban subidas (mismo identificador del equipo) se saltan, igual que antes.
-- · Si cualquier venta del lote falla, no se guarda ninguna del lote y la app vuelve a subirlas
--   de una en una como hasta ahora (así un error no bloquea las demás).
-- =====================================================================

create or replace function public.ticket_vender_lote(p_ventas jsonb)
returns integer language plpgsql set search_path = '' as $$
declare v jsonb; n int := 0;
begin
  if jsonb_typeof(p_ventas) <> 'array' or jsonb_array_length(p_ventas) > 100 then
    raise exception using errcode = '22023', message = 'TIXFAST: lote no válido';
  end if;
  for v in select * from jsonb_array_elements(p_ventas) loop
    -- Ya subida (p. ej. se cortó la red justo después de guardarla): se salta
    if exists (select 1 from public.ticket_ventas x
                where x.client_uuid = any (select jsonb_array_elements_text(coalesce(v -> 'p_client_uuids', '[]'::jsonb))::uuid)) then
      continue;
    end if;
    perform public.ticket_vender(
      (v ->> 'p_evento')::uuid, (v ->> 'p_punto')::uuid, nullif(v ->> 'p_producto', '')::uuid,
      v ->> 'p_nombre', (v ->> 'p_precio')::numeric, coalesce((v ->> 'p_qty')::int, 1),
      case when jsonb_typeof(v -> 'p_codigos') = 'array' then array(select jsonb_array_elements_text(v -> 'p_codigos')) end,
      v ->> 'p_operario',
      case when jsonb_typeof(v -> 'p_client_uuids') = 'array' then array(select jsonb_array_elements_text(v -> 'p_client_uuids')::uuid) end,
      v ->> 'p_metodo', (v ->> 'p_entregado')::numeric, (v ->> 'p_cambio')::numeric);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.ticket_vender_lote(jsonb) from public, anon;
grant execute on function public.ticket_vender_lote(jsonb) to authenticated;

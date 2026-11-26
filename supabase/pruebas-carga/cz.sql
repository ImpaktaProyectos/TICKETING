CREATE OR REPLACE FUNCTION public.ticket_cerrar_z(p_evento uuid, p_punto uuid, p_por text DEFAULT NULL::text, p_contado numeric DEFAULT NULL::numeric)
 RETURNS ticket_cierres LANGUAGE plpgsql SET search_path TO ''
AS $function$
declare v_row public.ticket_cierres; v_detalle jsonb; v_tickets int; v_fact numeric; v_anul int;
        v_efe numeric; v_tar numeric; v_fondo numeric; v_gastos numeric; v_entradas numeric; v_adv boolean; v_esperado numeric;
begin
  select coalesce(fondo, 0) into v_fondo from public.ticket_puntos where id = p_punto;
  select coalesce(venta_avanzada, false) into v_adv from public.ticket_eventos where id = p_evento;
  select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'qty', qty, 'total', total) order by total desc), '[]'::jsonb)
  into v_detalle from (select nombre, count(*) as qty, sum(precio) as total from public.ticket_ventas
    where evento_id = p_evento and punto_id = p_punto and not anulada and closure_id is null group by nombre) t;
  select count(*), coalesce(sum(precio), 0) into v_tickets, v_fact from public.ticket_ventas where evento_id = p_evento and punto_id = p_punto and not anulada and closure_id is null;
  select coalesce(sum(precio) filter (where metodo_pago = 'efectivo'), 0), coalesce(sum(precio) filter (where metodo_pago = 'tarjeta'), 0) into v_efe, v_tar
    from public.ticket_ventas where evento_id = p_evento and punto_id = p_punto and not anulada and closure_id is null;
  select count(*) into v_anul from public.ticket_ventas where evento_id = p_evento and punto_id = p_punto and anulada and closure_id is null;
  select coalesce(sum(importe) filter (where tipo = 'gasto'), 0), coalesce(sum(importe) filter (where tipo = 'entrada'), 0) into v_gastos, v_entradas
    from public.ticket_gastos where evento_id = p_evento and punto_id = p_punto and not anulado and closure_id is null;
  v_esperado := v_fondo + (case when v_adv then v_efe else v_fact end) + v_entradas - v_gastos;
  insert into public.ticket_cierres (evento_id, punto_id, tickets, facturacion, anulaciones, detalle, cerrado_por, efectivo, tarjeta, fondo, contado, gastos, entradas, esperado)
  values (p_evento, p_punto, v_tickets, v_fact, v_anul, v_detalle, p_por, v_efe, v_tar, v_fondo, p_contado, v_gastos, v_entradas, v_esperado) returning * into v_row;
  update public.ticket_ventas set closure_id = v_row.id where evento_id = p_evento and punto_id = p_punto and closure_id is null;
  update public.ticket_gastos set closure_id = v_row.id where evento_id = p_evento and punto_id = p_punto and closure_id is null;
  update public.ticket_puntos set fondo = null, fondo_en = null, fondo_por = null, estado = 'cerrada', cerrada_en = now(), cerrada_por = p_por where id = p_punto;
  return v_row;
end $function$;

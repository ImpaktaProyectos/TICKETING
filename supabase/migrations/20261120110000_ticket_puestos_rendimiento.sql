-- =====================================================================
-- TIXFAST · PANEL DEL PUESTO Y LIQUIDACIÓN MÁS RÁPIDOS (Multipuesto)
-- ---------------------------------------------------------------------
-- Prueba de carga del 18/11/2026: el panel de cada puesto (cada 20 s y tras canjear) y la liquidación
-- del organizador (cada 20 s) pasaban CADA canje por la regla de nombres (ticket_consumicion, una
-- expresión regular) y calculaban la comisión canje a canje: 30 ms con 2.000 canjes por puesto,
-- y creciendo con cada canje.
-- Ahora se agrupa primero por producto y precio (son pocas combinaciones) y la regla y la comisión
-- se aplican a cada grupo: 3 ms, y apenas crece. El resultado es exactamente el mismo (comprobado
-- con los mismos datos en supabase/pruebas-carga): la comisión de un grupo con el mismo precio es
-- la de una unidad por el número de unidades, igual que sumarla canje a canje.
-- Misma firma, mismos permisos, mismo formato de respuesta.
-- =====================================================================

create or replace function public.puesto_panel(p_sesion text, p_limite int default 300)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_p uuid; pu record; e record;
begin
  -- (stable: no apunta el último uso; lo hace puesto_canjear)
  declare m public.ticket_puesto_sesiones; begin
    m := public.ticket_puesto_movil(p_sesion);
    if m.id is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
    if m.desbloqueado_hasta <= now() then return jsonb_build_object('ok', false, 'motivo', 'bloqueada'); end if;
    v_p := m.puesto_id;
  end;
  select * into pu from public.ticket_puestos where id = v_p;
  select nombre, fecha, fin into e from public.ticket_eventos where id = pu.evento_id;
  return jsonb_build_object('ok', true, 'ahora', now(),
    'puesto', jsonb_build_object('nombre', pu.nombre, 'color', pu.color),
    'evento', jsonb_build_object('nombre', e.nombre, 'fecha', e.fecha, 'fin', e.fin),
    'acepta', coalesce((select jsonb_agg(pp.consumicion order by pp.consumicion) from public.ticket_puesto_productos pp where pp.puesto_id = v_p), '[]'::jsonb),
    'resumen', coalesce((select jsonb_agg(jsonb_build_object('nombre', x.nombre, 'unidades', x.unidades, 'valor', x.valor, 'neto', x.valor - x.comision) order by x.unidades desc)
      from (select btrim(min(g.nombre)) nombre, sum(g.u)::int unidades, coalesce(sum(g.valor * g.u), 0) valor,
              coalesce(sum(public.ticket_comision(g.valor, coalesce(pp.comision_tipo, pu.comision_tipo), coalesce(pp.comision_valor, pu.comision_valor)) * g.u), 0) comision
            from (select c.nombre, c.valor, sum(c.unidades) u from public.ticket_canjes c where c.puesto_id = v_p group by c.nombre, c.valor) g
            left join public.ticket_puesto_productos pp on pp.puesto_id = v_p and pp.consumicion = public.ticket_consumicion(g.nombre)
            group by public.ticket_consumicion(g.nombre)) x), '[]'::jsonb),
    'historial', coalesce((
      with c as (select * from public.ticket_canjes where puesto_id = v_p order by canjeado_en desc limit least(greatest(coalesce(p_limite, 300), 1), 2000)),
           m as (select n.nombre, pp.comision_tipo, pp.comision_valor from (select distinct nombre from c) n
                 left join public.ticket_puesto_productos pp on pp.puesto_id = v_p and pp.consumicion = public.ticket_consumicion(n.nombre))
      select jsonb_agg(jsonb_build_object('t', c.canjeado_en, 'nombre', btrim(c.nombre), 'unidades', c.unidades,
        'neto', (c.valor - public.ticket_comision(c.valor, coalesce(m.comision_tipo, pu.comision_tipo), coalesce(m.comision_valor, pu.comision_valor))) * c.unidades) order by c.canjeado_en desc)
      from c left join m on m.nombre is not distinct from c.nombre), '[]'::jsonb),
    'rechazos', (select count(*) from public.ticket_canje_rechazos r where r.puesto_id = v_p));
end $$;
revoke all on function public.puesto_panel(text, int) from public;
grant execute on function public.puesto_panel(text, int) to anon, authenticated;

create or replace function public.puestos_liquidacion(p_evento uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.ticket_dueno_evento(p_evento);
  return jsonb_build_object(
    'filas', coalesce((select jsonb_agg(jsonb_build_object('puesto_id', x.puesto_id, 'consumicion', x.consumicion, 'nombre', x.nombre,
        'unidades', x.unidades, 'valor', x.valor, 'comision', x.comision, 'neto', x.valor - x.comision, 'primero', x.primero, 'ultimo', x.ultimo))
      from (
        select g.puesto_id, public.ticket_consumicion(g.nombre) consumicion, btrim(min(g.nombre)) nombre, sum(g.u)::int unidades,
          coalesce(sum(g.valor * g.u), 0) valor,
          coalesce(sum(public.ticket_comision(g.valor, coalesce(pp.comision_tipo, p.comision_tipo), coalesce(pp.comision_valor, p.comision_valor)) * g.u), 0) comision,
          min(g.primero) primero, max(g.ultimo) ultimo
        from (select c.puesto_id, c.nombre, c.valor, sum(c.unidades) u, min(c.canjeado_en) primero, max(c.canjeado_en) ultimo
              from public.ticket_canjes c where c.evento_id = p_evento and c.puesto_id is not null
              group by c.puesto_id, c.nombre, c.valor) g
        join public.ticket_puestos p on p.id = g.puesto_id
        left join public.ticket_puesto_productos pp on pp.puesto_id = g.puesto_id and pp.consumicion = public.ticket_consumicion(g.nombre)
        group by g.puesto_id, public.ticket_consumicion(g.nombre)
      ) x), '[]'::jsonb),
    'canjeadas', coalesce((select jsonb_object_agg(y.consumicion, y.unidades) from (
        select public.ticket_consumicion(g.nombre) consumicion, sum(g.u)::int unidades
        from (select c.nombre, sum(c.unidades) u from public.ticket_canjes c where c.evento_id = p_evento and c.origen <> 'web' group by c.nombre) g
        group by 1) y), '{}'::jsonb),
    'ahora', now());
end $$;
revoke all on function public.puestos_liquidacion(uuid) from public, anon;
grant execute on function public.puestos_liquidacion(uuid) to authenticated;

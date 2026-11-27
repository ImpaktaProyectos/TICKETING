-- ===================== PAGOS: REPARTO SIN BLOQUEOS, EFECTIVO, DEVOLUCIONES Y CRM =====================
-- Va después de 20261127090500_ticket_comision_plataforma.sql.
-- · El organizador cobra al acabar el evento sin esperar a los RRPP. La parte de cada RRPP se queda guardada en
--   TIXFAST y se le manda sola en cuanto tenga monedero. Si a los 60 días sigue sin monedero, se le pasa al
--   organizador (estado «liberado»: se la paga él) y este puede marcarla como pagada.
-- · Ventas en efectivo de RRPP: también llevan la comisión de TIXFAST (se puede desactivar en el panel). Se
--   descuenta de lo cobrado online; si no llega, queda como deuda del organizador y su factura sale «pendiente».
-- · Devoluciones (desde Stripe): se anulan las entradas y se liberan las plazas. La comisión de TIXFAST no se
--   devuelve (así la factura siempre cuadra): lo devuelto se descuenta al organizador. Si ya se había repartido,
--   se recupera de su transferencia; lo que no se pueda recuperar queda apuntado como deuda.
-- · CRM del evento: los gastos de gestión cobrados entran como ingreso y la comisión de TIXFAST como gasto.

alter table public.ticket_plataforma_ajustes add column if not exists comision_efectivo boolean not null default true;

alter table public.ticket_pagos add column if not exists devuelto numeric(10,2) not null default 0 check (devuelto >= 0);
alter table public.ticket_pagos add column if not exists devuelto_en timestamptz;
grant select (devuelto, devuelto_en) on public.ticket_pagos to authenticated;

alter table public.ticket_repartos drop constraint if exists ticket_repartos_estado_check;
alter table public.ticket_repartos add constraint ticket_repartos_estado_check
  check (estado in ('preparado', 'enviado', 'sin_monedero', 'nada', 'error', 'liberado', 'pagado_mano'));

-- ---------- Comisión de las ventas en efectivo de RRPP ----------
create or replace function public.pago_comision_efectivo(p_evento uuid, p_modo text)
returns table (entradas int, ventas numeric, comision numeric) language sql stable security definer set search_path = '' as $$
  select coalesce(sum(y.n), 0)::int, coalesce(sum(y.precio), 0), coalesce(sum(y.c), 0)
    from (select count(*)::int n, sum(x.precio) precio, public.plataforma_comision(p.owner_id, sum(x.precio), count(*)::int) c
            from public.ticket_web_entradas x join public.ticket_web_pedidos p on p.id = x.pedido_id
           where x.evento_id = p_evento and x.estado = 'valida' and p.rrpp_efectivo and x.prueba = (p_modo = 'pruebas')
             and (select comision_efectivo from public.ticket_plataforma_ajustes where id)
           group by p.id, p.owner_id) y
$$;
revoke all on function public.pago_comision_efectivo(uuid, text) from public, anon, authenticated;

-- ---------- Cálculo del reparto ----------
-- Pagos que cuentan: los pagados y los devueltos (la comisión se cobra igual; lo devuelto se descuenta).
-- «disponible» = lo que le toca al organizador y a los RRPP juntos (puede ser negativo: deuda con TIXFAST).
create or replace function public.pago_reparto_calculo(p_evento uuid, p_modo text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with ent as (
    select x.rrpp_id, x.tramo_id, x.precio, p.rrpp_efectivo, g.pedido_id is not null as online
      from public.ticket_web_entradas x join public.ticket_web_pedidos p on p.id = x.pedido_id
      left join public.ticket_pagos g on g.pedido_id = p.id and g.estado = 'pagado' and g.modo = p_modo
     where x.evento_id = p_evento and x.estado = 'valida' and x.prueba = (p_modo = 'pruebas')
       and (g.pedido_id is not null or p.rrpp_efectivo)
  ),
  r as (
    select e.rrpp_id, count(*) n, count(*) filter (where e.online) n_online, count(*) filter (where e.rrpp_efectivo) n_efectivo,
           coalesce(sum(public.rrpp_comision(p_evento, e.rrpp_id, e.tramo_id, e.precio)), 0) comision,
           coalesce(sum(e.precio) filter (where e.rrpp_efectivo), 0) efectivo
      from ent e where e.rrpp_id is not null group by e.rrpp_id
  ),
  pg as (select * from public.ticket_pagos where evento_id = p_evento and estado in ('pagado', 'devuelto') and modo = p_modo),
  ef as (select * from public.pago_comision_efectivo(p_evento, p_modo)),
  t as (select coalesce(sum(entradas), 0) cobrado, coalesce(sum(gastos), 0) gastos, coalesce(sum(comision), 0) comision,
               coalesce(sum(devuelto), 0) devuelto from pg)
  select jsonb_build_object(
    'evento', p_evento,
    'owner_id', (select owner_id from public.ticket_web_eventos where evento_id = p_evento),
    'cobrado', t.cobrado, 'gastos', t.gastos, 'comision', t.comision, 'devuelto', t.devuelto,
    'efectivo_entradas', ef.entradas, 'efectivo_ventas', ef.ventas, 'comision_efectivo', ef.comision,
    'disponible', t.cobrado + t.gastos - t.comision - t.devuelto - ef.comision,
    'pendientes', (select count(*) from public.ticket_pagos where evento_id = p_evento and estado = 'pendiente' and modo = p_modo),
    'cargos', (select coalesce(jsonb_agg(jsonb_build_object('cargo', cargo_id, 'entradas', greatest(entradas + gastos - comision - devuelto, 0)) order by pagado_en), '[]'::jsonb)
                 from pg where cargo_id is not null),
    'rrpp', (select coalesce(jsonb_agg(jsonb_build_object('rrpp_id', r.rrpp_id, 'nombre', k.nombre, 'user_id', k.user_id,
               'entradas', r.n, 'online', r.n_online, 'en_efectivo', r.n_efectivo, 'comision', r.comision, 'efectivo', r.efectivo,
               'neto', greatest(r.comision - r.efectivo, 0), 'debe', greatest(r.efectivo - r.comision, 0))), '[]'::jsonb)
               from r join public.ticket_rrpp k on k.id = r.rrpp_id)
  ) from t, ef
$$;
revoke all on function public.pago_reparto_calculo(uuid, text) from public, anon, authenticated;

-- Eventos con algo por repartir: acabados y sin reparto al organizador, o con algún pago aún pendiente
-- (RRPP esperando monedero, errores que reintentar, organizador sin monedero).
create or replace function public.pago_eventos_por_repartir(p_modo text)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct g.evento_id from public.ticket_pagos g join public.ticket_eventos e on e.id = g.evento_id
   where g.modo = p_modo and g.estado in ('pagado', 'devuelto')
     and coalesce(e.fin, (nullif(e.inicio::text, '')::timestamp + interval '12 hours') at time zone 'Europe/Madrid',
                  (nullif(e.fecha::text, '')::date + interval '32 hours') at time zone 'Europe/Madrid') < now()
     and not exists (select 1 from public.ticket_repartos r where r.evento_id = g.evento_id and r.modo = p_modo and r.beneficiario = 'organizador' and r.estado in ('enviado', 'nada'))
  union
  select distinct r.evento_id from public.ticket_repartos r
   where r.modo = p_modo and r.estado in ('sin_monedero', 'error', 'preparado')
$$;
revoke all on function public.pago_eventos_por_repartir(text) from public, anon, authenticated;

-- El organizador marca como pagada a mano la parte de un RRPP que se le pasó a él
create or replace function public.reparto_marcar_pagado(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select * into r from public.ticket_repartos where id = p_id for update;
  if r.id is null or r.owner_id is distinct from (select auth.uid()) then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if r.beneficiario <> 'rrpp' or r.estado <> 'liberado' then return jsonb_build_object('ok', false, 'motivo', 'estado'); end if;
  update public.ticket_repartos set estado = 'pagado_mano', enviado_en = now() where id = r.id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.reparto_marcar_pagado(uuid) from public, anon;
grant execute on function public.reparto_marcar_pagado(uuid) to authenticated;

-- ---------- Devoluciones (las llama el aviso de Stripe «charge.refunded») ----------
-- p_reembolsado = total devuelto de ese cobro según Stripe (acumulado). Idempotente.
create or replace function public.pago_devolucion(p_cargo text, p_reembolsado numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g record; v_nuevo numeric; v_delta numeric; v_n int := 0; t uuid; v_total boolean;
begin
  select * into g from public.ticket_pagos where cargo_id = p_cargo for update;
  if g.pedido_id is null then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  v_nuevo := least(round(coalesce(p_reembolsado, 0), 2), g.importe);
  v_delta := v_nuevo - g.devuelto;
  if v_delta <= 0 then return jsonb_build_object('ok', true, 'ya', true, 'evento', g.evento_id); end if;
  v_total := v_nuevo >= g.importe;
  update public.ticket_pagos set devuelto = v_nuevo, devuelto_en = now(), estado = case when v_total then 'devuelto' else estado end
   where pedido_id = g.pedido_id;
  if v_total then
    -- Devolución completa: las entradas dejan de valer y las plazas vuelven a estar a la venta
    update public.ticket_web_tramos t set vendidas = greatest(0, t.vendidas - x.n)
      from (select tramo_id, count(*)::int n from public.ticket_web_entradas where pedido_id = g.pedido_id and estado = 'valida' group by tramo_id) x
     where t.id = x.tramo_id;
    update public.ticket_web_entradas set estado = 'anulada' where pedido_id = g.pedido_id and estado = 'valida';
    get diagnostics v_n = row_count;
    update public.ticket_web_pedidos set estado = 'anulado' where id = g.pedido_id;
    for t in select distinct tramo_id from public.ticket_web_entradas where pedido_id = g.pedido_id loop
      perform public.web_sync_ingreso(g.evento_id, t);
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'evento', g.evento_id, 'pedido', g.pedido_id, 'delta', v_delta, 'total', v_total, 'anuladas', v_n);
end $$;
revoke all on function public.pago_devolucion(text, numeric) from public, anon, authenticated;

-- ---------- CRM del evento: gastos de gestión cobrados (ingreso) y comisión de TIXFAST (gasto) ----------
create or replace function public.pago_sync_crm(p_evento uuid, p_modo text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_gastos numeric; v_com numeric; v_ref_g text := 'txgastos'; v_marca text := 'tixfast:comision';
begin
  if p_modo <> 'real' then return; end if;   -- los pagos de prueba no entran en las cuentas
  select owner_id into v_owner from public.ticket_web_eventos where evento_id = p_evento;
  if v_owner is null then return; end if;
  -- Gastos: solo de los pedidos que siguen pagados (las entradas devueltas ya salen solas de los ingresos)
  select coalesce(sum(gastos) filter (where estado = 'pagado'), 0), coalesce(sum(comision), 0)
    into v_gastos, v_com from public.ticket_pagos where evento_id = p_evento and modo = 'real' and estado in ('pagado', 'devuelto');
  v_com := v_com + coalesce((select comision from public.pago_comision_efectivo(p_evento, 'real')), 0);
  if v_gastos <= 0 then
    delete from public.ticket_crm_ingresos where evento_id = p_evento and ref_externa = v_ref_g and origen = 'tixfast';
  else
    insert into public.ticket_crm_ingresos (owner_id, evento_id, categoria, concepto, importe, fecha, metodo, estado, origen, ref_externa, unidades, actualizado_en)
    values (v_owner, p_evento, 'Ticketera online', 'TIXFAST · Gastos de gestión cobrados', round(v_gastos, 2), current_date, 'tarjeta', 'cobrado', 'tixfast', v_ref_g, 0, now())
    on conflict (evento_id, ref_externa) do update set importe = excluded.importe, actualizado_en = now();
  end if;
  delete from public.ticket_crm_gastos where evento_id = p_evento and nota = v_marca;
  if v_com > 0 then
    insert into public.ticket_crm_gastos (owner_id, evento_id, tipo, categoria, concepto, proveedor, previsto, real, estado, fecha, nota, iva, factura)
    values (v_owner, p_evento, 'normal', 'Ticketing y pagos', 'Comisión TIXFAST (venta de entradas)', 'TIXFAST', round(v_com, 2), round(v_com, 2), 'pagado', current_date,
            v_marca, (select iva from public.ticket_plataforma_ajustes where id), true);
  end if;
end $$;
revoke all on function public.pago_sync_crm(uuid, text) from public, anon, authenticated;

create or replace function public.pago_sync_crm_trg() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.modo = 'real' and new.estado in ('pagado', 'devuelto') then perform public.pago_sync_crm(new.evento_id, new.modo); end if;
  return new;
end $$;
revoke all on function public.pago_sync_crm_trg() from public, anon, authenticated;
drop trigger if exists pago_sync_crm on public.ticket_pagos;
create trigger pago_sync_crm after update of estado, devuelto on public.ticket_pagos for each row execute function public.pago_sync_crm_trg();

-- ---------- Factura de la comisión: incluye efectivo y devoluciones; «pendiente» si no se pudo descontar ----------
create or replace function public.plataforma_facturar_evento(p_evento uuid, p_modo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; em record; ev record; x record; ef record; f record; v_tot numeric; v_base numeric; v_iva numeric; v_n int; v_anio int;
        v_codigo text; v_prev text; v_cadena text; v_huella text; v_ahora text; v_emisor jsonb; v_receptor jsonb; v_lineas jsonb; v_fac uuid;
        v_deuda numeric; v_ent int; v_txt text;
begin
  select * into ev from public.ticket_eventos where id = p_evento;
  if ev.id is null then return jsonb_build_object('ok', false, 'motivo', 'evento'); end if;
  select * into f from public.ticket_plataforma_facturas where evento_id = p_evento and modo = p_modo for update;
  if f.estado = 'emitida' then return jsonb_build_object('ok', true, 'estado', 'emitida', 'codigo', f.codigo); end if;

  select coalesce(sum(comision), 0) com, coalesce(sum(entradas), 0) ven, coalesce(sum(gastos), 0) gas,
         coalesce(sum(jsonb_array_length(asistentes)) filter (where comision > 0), 0) n, sum(coste_stripe) stripe
    into x from public.ticket_pagos where evento_id = p_evento and modo = p_modo and estado in ('pagado', 'devuelto');
  select * into ef from public.pago_comision_efectivo(p_evento, p_modo);
  v_tot := round(x.com + ef.comision, 2);
  if v_tot <= 0 then return jsonb_build_object('ok', true, 'estado', 'nada'); end if;
  v_ent := x.n + case when ef.comision > 0 then ef.entradas else 0 end;

  select * into a from public.ticket_plataforma_ajustes where id;
  v_iva := a.iva;
  v_base := round(v_tot / (1 + v_iva / 100), 2);
  v_txt := format('Comisión por venta de %s %s · %s', v_ent, case when v_ent = 1 then 'entrada' else 'entradas' end, coalesce(ev.nombre, 'evento'))
           || case when ef.comision > 0 then format(' (%s en efectivo vía RRPP)', ef.entradas) else '' end;
  v_lineas := jsonb_build_array(jsonb_build_object('id', 'c1', 'concepto', left(v_txt, 200), 'cantidad', 1, 'precio', v_base, 'descuento', '', 'iva', v_iva));

  insert into public.ticket_plataforma_facturas as t (evento_id, owner_id, modo, entradas, ventas, gastos_comprador, total, base, cuota_iva, iva, coste_stripe, lineas)
  values (p_evento, ev.owner_id, p_modo, v_ent, x.ven + ef.ventas, x.gas, v_tot, v_base, v_tot - v_base, v_iva, x.stripe, v_lineas)
  on conflict (evento_id, modo) do update set entradas = excluded.entradas, ventas = excluded.ventas, gastos_comprador = excluded.gastos_comprador,
    total = excluded.total, base = excluded.base, cuota_iva = excluded.cuota_iva, iva = excluded.iva, coste_stripe = excluded.coste_stripe, lineas = excluded.lineas
  returning * into f;

  if coalesce(a.razon_social, '') = '' or coalesce(a.nif, '') = '' then
    update public.ticket_plataforma_facturas set estado = 'falta_emisor' where id = f.id;
    return jsonb_build_object('ok', true, 'estado', 'falta_emisor');
  end if;
  select * into em from public.ticket_fac_emisor where owner_id = ev.owner_id;
  if em.owner_id is null then
    update public.ticket_plataforma_facturas set estado = 'falta_receptor' where id = f.id;
    return jsonb_build_object('ok', true, 'estado', 'falta_receptor');
  end if;

  v_emisor := jsonb_build_object('nombre', a.razon_social, 'nif', a.nif, 'direccion', coalesce(a.direccion, ''), 'cp', coalesce(a.cp, ''),
    'ciudad', coalesce(a.ciudad, ''), 'provincia', coalesce(a.provincia, ''), 'pais', 'España', 'email', coalesce(a.email, ''));
  v_receptor := jsonb_build_object('nombre', em.razon_social, 'nif', em.nif, 'direccion', coalesce(em.direccion, ''), 'cp', coalesce(em.cp, ''),
    'ciudad', coalesce(em.ciudad, ''), 'provincia', coalesce(em.provincia, ''), 'pais', coalesce(em.pais, 'España'), 'email', coalesce(em.email, ''));

  if p_modo = 'pruebas' then
    update public.ticket_plataforma_facturas set estado = 'emitida', codigo = 'PRUEBA-' || left(f.id::text, 8), fecha = current_date,
      emisor = v_emisor, receptor = v_receptor, emitida_en = now() where id = f.id;
    return jsonb_build_object('ok', true, 'estado', 'emitida', 'prueba', true);
  end if;

  -- ¿Se pudo descontar toda la comisión al repartir? Si no, la factura queda pendiente de pago.
  select coalesce(sum((detalle ->> 'deuda')::numeric), 0) into v_deuda from public.ticket_repartos
   where evento_id = p_evento and modo = p_modo and beneficiario = 'organizador';

  v_anio := extract(year from (now() at time zone 'Europe/Madrid'))::int;
  insert into public.ticket_plataforma_contadores as c (serie, anio, ultimo) values (a.serie, v_anio, 1)
    on conflict (serie, anio) do update set ultimo = c.ultimo + 1 returning ultimo into v_n;
  v_codigo := a.serie || v_anio::text || '-' || lpad(v_n::text, 5, '0');
  select huella into v_prev from public.ticket_plataforma_facturas where modo = 'real' and estado = 'emitida' and huella is not null order by emitida_en desc, numero desc limit 1;
  v_ahora := to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM-DD"T"HH24:MI:SS');
  v_cadena := 'IDEmisorFactura=' || a.nif || '&NumSerieFactura=' || v_codigo || '&FechaExpedicionFactura=' || to_char(current_date, 'DD-MM-YYYY') ||
              '&TipoFactura=F1&CuotaTotal=' || to_char(v_tot - v_base, 'FM999999990.00') || '&ImporteTotal=' || to_char(v_tot, 'FM999999990.00') ||
              '&Huella=' || coalesce(v_prev, '') || '&FechaHoraHusoGenRegistro=' || v_ahora;
  v_huella := upper(encode(extensions.digest(v_cadena, 'sha256'), 'hex'));

  insert into public.ticket_fac_facturas (owner_id, tipo, estado, fecha, contacto, lineas, base, cuota_iva, irpf_pct, cuota_irpf, total, desglose,
                                          num_proveedor, categoria, forma_pago, notas, pagada_en)
  values (ev.owner_id, 'recibida', case when v_deuda > 0 then 'pendiente' else 'pagada' end, current_date,
          v_emisor || jsonb_build_object('nombre', 'TIXFAST · ' || a.razon_social),
          v_lineas, v_base, v_tot - v_base, 0, 0, v_tot,
          jsonb_build_array(jsonb_build_object('tipo', v_iva, 'base', v_base, 'cuota', v_tot - v_base)),
          v_codigo, 'Bancos y comisiones', case when v_deuda > 0 then 'Transferencia' else 'Descontado del reparto' end,
          left(case when v_deuda > 0
            then format('Comisión TIXFAST del evento «%s». Se descontó del reparto salvo %s €, que quedan pendientes de pago.', coalesce(ev.nombre, ''), to_char(v_deuda, 'FM999999990.00'))
            else format('Comisión TIXFAST del evento «%s». Se descontó al repartir el dinero de las entradas.', coalesce(ev.nombre, '')) end, 2000),
          case when v_deuda > 0 then null else current_date end)
  returning id into v_fac;

  update public.ticket_plataforma_facturas set estado = 'emitida', serie = a.serie, numero = v_n, codigo = v_codigo, fecha = current_date,
    emisor = v_emisor, receptor = v_receptor, huella = v_huella, huella_anterior = v_prev, cadena = v_cadena,
    factura_organizador_id = v_fac, emitida_en = now() where id = f.id;
  perform public.pago_sync_crm(p_evento, p_modo);
  return jsonb_build_object('ok', true, 'estado', 'emitida', 'codigo', v_codigo, 'pendiente', v_deuda);
end $$;
revoke all on function public.plataforma_facturar_evento(uuid, text) from public, anon, authenticated;

-- Informe del panel: incluye devoluciones y comisión del efectivo
create or replace function public.plataforma_informe_comisiones(p_modo text, p_desde date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('evento_id', x.evento_id, 'evento', e.nombre, 'fecha', e.fecha, 'pagos', x.pagos, 'entradas', x.n,
    'ventas', x.ven, 'gastos', x.gas, 'cobrado', x.cob, 'devuelto', x.dev, 'comision', x.com + ef.comision, 'comision_efectivo', ef.comision,
    'stripe', x.stripe, 'stripe_sin_dato', x.sin_dato,
    'factura', (select jsonb_build_object('estado', pf.estado, 'codigo', pf.codigo) from public.ticket_plataforma_facturas pf where pf.evento_id = x.evento_id and pf.modo = p_modo))
    order by e.fecha desc nulls last), '[]'::jsonb)
  from (select evento_id, count(*) pagos, sum(jsonb_array_length(asistentes)) n, sum(entradas) ven, sum(gastos) gas, sum(importe) cob, sum(devuelto) dev,
               sum(comision) com, sum(coste_stripe) stripe, count(*) filter (where coste_stripe is null) sin_dato
          from public.ticket_pagos where modo = p_modo and estado in ('pagado', 'devuelto') and coalesce(pagado_en, creado_en) >= p_desde group by evento_id) x
  join public.ticket_eventos e on e.id = x.evento_id
  cross join lateral public.pago_comision_efectivo(x.evento_id, p_modo) ef
$$;
revoke all on function public.plataforma_informe_comisiones(text, date) from public, anon, authenticated;

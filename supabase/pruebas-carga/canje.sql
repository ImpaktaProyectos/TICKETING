-- ---------- Utilidades ----------
-- Clave de una consumición: el nombre del producto sin mayúsculas ni espacios de más
-- (igual que claveConsumicion() en ticketera-app/src/multipuesto/modelo.js)
create or replace function public.ticket_consumicion(p_nombre text)
returns text language sql immutable set search_path = '' as $$
  select left(lower(regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g')), 80);
$$;

-- Comisión del organizador por una unidad: % del valor, o € fijos (nunca más que el valor)
create or replace function public.ticket_comision(p_valor numeric, p_tipo text, p_cant numeric)
returns numeric language sql immutable set search_path = '' as $$
  select case when p_valor is null then 0
    when p_tipo = 'fijo' then least(coalesce(p_cant, 0), p_valor)
    else round(p_valor * coalesce(p_cant, 0) / 100, 2) end;
$$;

create or replace function public.ticket_es_multipuesto(p_evento uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select ticket_style ->> 'modalidad' = 'multipuesto' from public.ticket_eventos where id = p_evento), false);
$$;
revoke all on function public.ticket_es_multipuesto(uuid) from public, anon, authenticated;

-- ---------- Núcleo del canje (lo usan el TPV y los puestos) ----------
-- Con p_puesto = null hace exactamente lo de siempre (validador del TPV).
-- Con p_puesto: solo tickets del TPV, solo consumiciones permitidas a ese puesto, sin fechas del móvil.
create or replace function public.ticket_canje_nucleo(p_owner uuid, p_evento uuid, p_datos text, p_punto uuid, p_puesto uuid,
  p_dispositivo text, p_canje_id uuid, p_sin_conexion boolean, p_canjeado_en timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ev record; v_b bytea; v_msg bytea; v_mac bytea; v_ver int;
  v_venta uuid; v_idx int; v_qty int; v_prod text;
  v_motivo text; v_det jsonb := '{}'::jsonb;
  v_sale record; v_prod_id uuid; v_nombre text; v_precio numeric; v_valor numeric; v_otro text;
  v_row public.ticket_canjes; v_prev record; v_cid uuid := coalesce(p_canje_id, gen_random_uuid());
  v_cuando timestamptz := greatest(least(coalesce(p_canjeado_en, now()), now()), now() - interval '2 days');
  v_web record; v_desde timestamptz; v_horas int;
begin
  select e.id, e.nombre, e.owner_id, e.qr_clave, e.fin, e.inicio into v_ev from public.ticket_eventos e where e.id = p_evento;
  if v_ev.id is null or v_ev.owner_id is distinct from p_owner then raise exception 'no autorizado' using errcode = '42501'; end if;
  if p_punto is not null and not exists (select 1 from public.ticket_puntos where id = p_punto and evento_id = p_evento) then
    raise exception 'barra no valida' using errcode = '22023';
  end if;
  if p_puesto is not null and not exists (select 1 from public.ticket_puestos where id = p_puesto and evento_id = p_evento and activo) then
    raise exception 'puesto no valido' using errcode = '42501';
  end if;

  <<chk>> begin
    begin v_b := decode(p_datos, 'hex'); exception when others then v_b := null; end;
    if v_b is null or length(v_b) <> 33 then v_motivo := 'ilegible'; exit chk; end if;
    v_msg := substring(v_b from 1 for 25);
    v_mac := substring(v_b from 26 for 8);
    v_ver := get_byte(v_b, 0);
    v_venta := encode(substring(v_b from 2 for 16), 'hex')::uuid;
    v_idx := get_byte(v_b, 17);
    v_qty := greatest(get_byte(v_b, 18), 1);
    v_prod := encode(substring(v_b from 20 for 6), 'hex');

    if coalesce(v_ev.qr_clave, '') = '' or substring(extensions.hmac(v_msg, decode(v_ev.qr_clave, 'hex'), 'sha256') from 1 for 8) <> v_mac then
      if p_puesto is null then   -- a un puesto no se le dice de qué otro evento es
        select e.nombre into v_otro from public.ticket_eventos e
         where e.owner_id = p_owner and e.id <> p_evento and coalesce(e.qr_clave, '') <> ''
           and substring(extensions.hmac(v_msg, decode(e.qr_clave, 'hex'), 'sha256') from 1 for 8) = v_mac
         limit 1;
      end if;
      if v_otro is not null then v_motivo := 'otro_evento'; v_det := jsonb_build_object('evento', v_otro);
      else v_motivo := 'falso'; end if;
      exit chk;
    end if;
    if v_ver = 2 then v_motivo := 'prueba'; exit chk; end if;

    -- ===== Entrada online (nominativa): solo en los accesos del TPV, nunca en un puesto =====
    if v_ver in (3, 4) then
      if p_puesto is not null then v_motivo := 'no_aqui'; v_det := jsonb_build_object('nombre', 'Entrada al evento'); exit chk; end if;
      select x.*, f.qr_horas_antes into v_web from public.ticket_web_entradas x left join public.ticket_web_eventos f on f.evento_id = x.evento_id
       where x.id = v_venta and x.evento_id = p_evento;
      if v_web.id is null then v_motivo := 'no_encontrado'; exit chk; end if;
      v_nombre := v_web.tramo_nombre;
      v_det := jsonb_build_object('nombre', v_nombre, 'asistente', v_web.asistente, 'numero', v_web.numero, 'prueba', v_web.prueba, 'web', true);
      if v_web.estado = 'anulada' then v_motivo := 'anulado'; exit chk; end if;
      if v_idx <> v_web.emision - 1 then v_motivo := 'reemitida'; exit chk; end if;
      v_horas := coalesce(v_web.qr_horas_antes, 24);
      begin v_desde := (nullif(v_ev.inicio, '')::timestamp at time zone 'Europe/Madrid') - make_interval(hours => v_horas); exception when others then v_desde := null; end;
      if v_desde is not null and v_cuando < v_desde then v_motivo := 'temprano'; v_det := v_det || jsonb_build_object('desde', v_desde); exit chk; end if;
      if v_ev.fin is not null and v_cuando > v_ev.fin then v_motivo := 'caducado'; v_det := v_det || jsonb_build_object('fin', v_ev.fin); exit chk; end if;

      insert into public.ticket_canjes (id, owner_id, evento_id, venta_uuid, idx, unidades, producto_id, nombre, punto_venta_id, punto_id, dispositivo, origen, sin_conexion, venta_pendiente, canjeado_en)
      values (v_cid, p_owner, p_evento, v_venta, v_idx, 1, null, left(v_web.tramo_nombre || ' · ' || v_web.asistente, 160), null, p_punto, left(p_dispositivo, 60), 'web', coalesce(p_sin_conexion, false), false, v_cuando)
      on conflict (evento_id, venta_uuid, idx) do nothing
      returning * into v_row;
      if v_row.id is null then
        select c.id, c.canjeado_en, c.dispositivo, pt.nombre as barra into v_prev
          from public.ticket_canjes c left join public.ticket_puntos pt on pt.id = c.punto_id
         where c.evento_id = p_evento and c.venta_uuid = v_venta and c.idx = v_idx;
        if v_prev.id = v_cid then
          return jsonb_build_object('ok', true, 'repetido', true, 'nombre', v_nombre, 'unidades', 1, 'canjeado_en', v_prev.canjeado_en) || v_det;
        end if;
        v_motivo := 'ya_canjeado';
        v_det := v_det || jsonb_build_object('canjeado_en', v_prev.canjeado_en, 'barra', v_prev.barra, 'dispositivo', v_prev.dispositivo);
        exit chk;
      end if;
      return jsonb_build_object('ok', true, 'id', v_row.id, 'unidades', 1, 'canjeado_en', v_row.canjeado_en) || v_det;
    end if;

    if v_ver <> 1 then v_motivo := 'ilegible'; exit chk; end if;

    -- ===== Ticket del TPV =====
    select p.id, p.nombre, p.precio into v_prod_id, v_nombre, v_precio
      from public.ticket_productos p join public.ticket_puntos pt on pt.id = p.punto_id
     where pt.evento_id = p_evento and left(replace(p.id::text, '-', ''), 12) = v_prod limit 1;

    select v.id, v.punto_id, v.nombre, v.anulada, v.precio into v_sale
      from public.ticket_ventas v where v.evento_id = p_evento and v.client_uuid = v_venta limit 1;
    if v_sale.id is not null and v_nombre is null then v_nombre := v_sale.nombre; end if;
    if v_sale.anulada then v_motivo := 'anulado'; v_det := jsonb_build_object('nombre', v_nombre); exit chk; end if;
    if v_ev.fin is not null and v_cuando > v_ev.fin then
      v_motivo := 'caducado'; v_det := jsonb_build_object('nombre', v_nombre, 'fin', v_ev.fin); exit chk;
    end if;
    -- Valor de la consumición: lo cobrado en la venta (ticket suelto) o el precio del producto (vale de un bono)
    v_valor := case when v_idx = 0 and v_sale.id is not null then v_sale.precio else v_precio end;

    if p_puesto is not null then
      -- Si ya se canjeó, se dice (es una copia), esté donde esté
      select c.id, c.canjeado_en, coalesce(pu.nombre, pt.nombre) as barra into v_prev
        from public.ticket_canjes c left join public.ticket_puestos pu on pu.id = c.puesto_id left join public.ticket_puntos pt on pt.id = c.punto_id
       where c.evento_id = p_evento and c.venta_uuid = v_venta and c.idx = v_idx;
      if v_prev.id is not null and v_prev.id <> v_cid then
        v_motivo := 'ya_canjeado'; v_det := jsonb_build_object('nombre', v_nombre, 'canjeado_en', v_prev.canjeado_en, 'barra', v_prev.barra); exit chk;
      end if;
      -- Solo lo que tiene permitido este puesto. El ticket NO se gasta: sigue valiendo en su sitio
      if not exists (select 1 from public.ticket_puesto_productos pp where pp.puesto_id = p_puesto and pp.consumicion = public.ticket_consumicion(v_nombre)) then
        v_motivo := 'no_aqui';
        v_det := jsonb_build_object('nombre', v_nombre, 'aceptan', coalesce((select jsonb_agg(pu.nombre order by pu.orden, pu.nombre)
          from public.ticket_puestos pu join public.ticket_puesto_productos pp on pp.puesto_id = pu.id
          where pu.evento_id = p_evento and pu.activo and pp.consumicion = public.ticket_consumicion(v_nombre)), '[]'::jsonb));
        exit chk;
      end if;
    end if;

    insert into public.ticket_canjes (id, owner_id, evento_id, venta_uuid, idx, unidades, producto_id, nombre,
                                      punto_venta_id, punto_id, dispositivo, origen, sin_conexion, venta_pendiente, canjeado_en, puesto_id, valor)
    values (v_cid, p_owner, p_evento, v_venta, v_idx, v_qty, v_prod_id, v_nombre,
            v_sale.punto_id, p_punto, left(p_dispositivo, 60), case when p_puesto is null then 'qr' else 'puesto' end,
            coalesce(p_sin_conexion, false), v_sale.id is null, v_cuando, p_puesto, v_valor)
    on conflict (evento_id, venta_uuid, idx) do nothing
    returning * into v_row;

    if v_row.id is null then
      select c.id, c.canjeado_en, c.dispositivo, c.sin_conexion, coalesce(pu.nombre, pt.nombre) as barra into v_prev
        from public.ticket_canjes c left join public.ticket_puntos pt on pt.id = c.punto_id left join public.ticket_puestos pu on pu.id = c.puesto_id
       where c.evento_id = p_evento and c.venta_uuid = v_venta and c.idx = v_idx;
      if v_prev.id = v_cid then
        return jsonb_build_object('ok', true, 'repetido', true, 'nombre', v_nombre, 'unidades', v_qty, 'canjeado_en', v_prev.canjeado_en);
      end if;
      v_motivo := 'ya_canjeado';
      v_det := jsonb_build_object('nombre', v_nombre, 'canjeado_en', v_prev.canjeado_en, 'barra', v_prev.barra,
        'dispositivo', case when p_puesto is null then v_prev.dispositivo end);
      exit chk;
    end if;

    return jsonb_build_object('ok', true, 'id', v_row.id, 'nombre', v_nombre, 'unidades', v_qty,
      'venta_pendiente', v_row.venta_pendiente, 'canjeado_en', v_row.canjeado_en)
      || case when p_puesto is null then jsonb_build_object('barra_venta', (select nombre from public.ticket_puntos where id = v_sale.punto_id)) else '{}'::jsonb end;
  end chk;

  if v_motivo <> 'prueba' then
    insert into public.ticket_canje_rechazos (owner_id, evento_id, venta_uuid, idx, motivo, detalle, punto_id, dispositivo, sin_conexion, creado_en, puesto_id)
    values (p_owner, p_evento, v_venta, v_idx, v_motivo, v_det, p_punto, left(p_dispositivo, 60), coalesce(p_sin_conexion, false), v_cuando, p_puesto);
  end if;
  return jsonb_build_object('ok', false, 'motivo', v_motivo) || v_det;
end $$;
revoke all on function public.ticket_canje_nucleo(uuid, uuid, text, uuid, uuid, text, uuid, boolean, timestamptz) from public, anon, authenticated;

-- El canje del TPV: misma firma y mismo comportamiento de siempre
create or replace function public.ticket_canjear(p_evento uuid, p_datos text, p_punto uuid default null, p_dispositivo text default null,
  p_canje_id uuid default null, p_sin_conexion boolean default false, p_canjeado_en timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'no autorizado' using errcode = '42501'; end if;
  if not exists (select 1 from public.ticket_eventos where id = p_evento and owner_id = v_uid) then raise exception 'no autorizado' using errcode = '42501'; end if;
  return public.ticket_canje_nucleo(v_uid, p_evento, p_datos, p_punto, null, p_dispositivo, p_canje_id, p_sin_conexion, p_canjeado_en);
end $$;

create or replace function public.ticket_puesto_movil(p_sesion text)
returns public.ticket_puesto_sesiones language sql stable security definer set search_path = '' as $$
  select x.* from public.ticket_puesto_sesiones x join public.ticket_puestos p on p.id = x.puesto_id join public.ticket_eventos e on e.id = p.evento_id
  where length(coalesce(p_sesion, '')) between 30 and 64 and x.huella = encode(extensions.digest(p_sesion, 'sha256'), 'hex')
    and not x.revocada and x.caduca_en > now() and p.activo and e.ticket_style ->> 'modalidad' = 'multipuesto';
$$;
revoke all on function public.ticket_puesto_movil(text) from public, anon, authenticated;

-- Estado del móvil: a qué puesto pertenece, si está desbloqueado y si el puesto aún no tiene PIN
-- Móvil vinculado y DESBLOQUEADO → el puesto (o nada). Apunta el último uso como mucho una vez por minuto.
create or replace function public.ticket_puesto_de_sesion(p_sesion text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare m public.ticket_puesto_sesiones;
begin
  m := public.ticket_puesto_movil(p_sesion);
  if m.id is null or m.desbloqueado_hasta <= now() then return null; end if;
  if m.ultimo_uso < now() - interval '1 minute' then update public.ticket_puesto_sesiones set ultimo_uso = now() where id = m.id; end if;
  return m.puesto_id;
end $$;
revoke all on function public.ticket_puesto_de_sesion(text) from public, anon, authenticated;

create or replace function public.puesto_canjear(p_sesion text, p_datos text, p_canje_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_p uuid; pu record; s record;
begin
  v_p := public.ticket_puesto_de_sesion(p_sesion);
  if v_p is null then
    return jsonb_build_object('ok', false, 'motivo', case when (public.ticket_puesto_movil(p_sesion)).id is null then 'sesion' else 'bloqueada' end);
  end if;
  if length(coalesce(p_datos, '')) > 200 then return jsonb_build_object('ok', false, 'motivo', 'ilegible'); end if;
  select p.id, p.owner_id, p.evento_id into pu from public.ticket_puestos p where p.id = v_p;
  select dispositivo into s from public.ticket_puesto_sesiones where huella = encode(extensions.digest(p_sesion, 'sha256'), 'hex');
  return public.ticket_canje_nucleo(pu.owner_id, pu.evento_id, p_datos, null, pu.id, coalesce(s.dispositivo, 'puesto'), p_canje_id, false, null);
end $$;
revoke all on function public.puesto_canjear(text, text, uuid) from public;
grant execute on function public.puesto_canjear(text, text, uuid) to anon, authenticated;

-- Panel del puesto: lo suyo y nada más (unidades, facturación con la comisión ya quitada, historial)
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
      from (select btrim(min(c.nombre)) nombre, sum(c.unidades)::int unidades, coalesce(sum(c.valor * c.unidades), 0) valor,
              coalesce(sum(public.ticket_comision(c.valor, coalesce(pp.comision_tipo, pu.comision_tipo), coalesce(pp.comision_valor, pu.comision_valor)) * c.unidades), 0) comision
            from public.ticket_canjes c left join public.ticket_puesto_productos pp on pp.puesto_id = v_p and pp.consumicion = public.ticket_consumicion(c.nombre)
            where c.puesto_id = v_p group by public.ticket_consumicion(c.nombre)) x), '[]'::jsonb),
    'historial', coalesce((select jsonb_agg(jsonb_build_object('t', c.canjeado_en, 'nombre', btrim(c.nombre), 'unidades', c.unidades,
        'neto', (c.valor - public.ticket_comision(c.valor, coalesce(pp.comision_tipo, pu.comision_tipo), coalesce(pp.comision_valor, pu.comision_valor))) * c.unidades) order by c.canjeado_en desc)
      from (select * from public.ticket_canjes where puesto_id = v_p order by canjeado_en desc limit least(greatest(coalesce(p_limite, 300), 1), 2000)) c
      left join public.ticket_puesto_productos pp on pp.puesto_id = v_p and pp.consumicion = public.ticket_consumicion(c.nombre)), '[]'::jsonb),
    'rechazos', (select count(*) from public.ticket_canje_rechazos r where r.puesto_id = v_p));
end $$;
revoke all on function public.puesto_panel(text, int) from public;
grant execute on function public.puesto_panel(text, int) to anon, authenticated;


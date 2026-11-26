-- web_comprar tal y como está en producción (18/11/2026)
CREATE OR REPLACE FUNCTION public.web_comprar(p_slug text, p_items jsonb, p_comprador jsonb, p_asistentes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f record; e record; t record; it jsonb; a jsonb; es_dueno boolean; v_prueba boolean;
  v_email text; v_nombre text; v_total numeric := 0; v_n int := 0; v_ya int; v_ip text; v_rec int;
  v_pedido uuid; v_codigo text; v_acceso uuid; v_ent uuid; v_msg bytea; v_mac bytea; v_ver int; v_num int;
  campo text; nivel text; v_pago boolean := false; v_gastos numeric := 0; v_mkt boolean; v_nac date; v_datos jsonb := '{}'::jsonb; pedidos jsonb := '{}'::jsonb; v_cnt int;
begin
  select * into f from public.ticket_web_eventos where slug = lower(p_slug) for update;
  if f.evento_id is null then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  es_dueno := f.owner_id = (select auth.uid());
  if f.estado = 'cerrado' or (f.estado = 'borrador' and not es_dueno) then return jsonb_build_object('ok', false, 'motivo', 'cerrado'); end if;
  select * into e from public.ticket_eventos where id = f.evento_id;
  v_prueba := f.modo = 'pruebas' or f.estado = 'borrador';

  v_ip := split_part(coalesce(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', ''), ',', 1);
  if v_ip <> '' and coalesce(current_setting('tixfast.rrpp_venta', true), '') = '' then
    select count(*) into v_rec from public.ticket_web_pedidos where ip = v_ip and creado_en > now() - interval '10 minutes';
    if v_rec >= 15 then return jsonb_build_object('ok', false, 'motivo', 'demasiados_intentos'); end if;
  end if;

  v_email := lower(btrim(coalesce(p_comprador ->> 'email', '')));
  v_nombre := btrim(coalesce(p_comprador ->> 'nombre', ''));
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 160 then return jsonb_build_object('ok', false, 'motivo', 'email'); end if;
  if length(v_nombre) < 3 or length(v_nombre) > 120 then return jsonb_build_object('ok', false, 'motivo', 'nombre'); end if;
  for campo in select unnest(array['telefono','dni','nacimiento','cp','direccion','ciudad','genero']) loop
    nivel := coalesce(f.formulario ->> campo, 'no');
    if nivel = 'obligatorio' and btrim(coalesce(p_comprador ->> campo, '')) = '' then return jsonb_build_object('ok', false, 'motivo', 'falta_' || campo); end if;
    if nivel <> 'no' and btrim(coalesce(p_comprador ->> campo, '')) <> '' then v_datos := v_datos || jsonb_build_object(campo, left(btrim(p_comprador ->> campo), 200)); end if;
  end loop;
  v_mkt := coalesce((p_comprador ->> 'marketing')::boolean, false);
  begin v_nac := nullif(v_datos ->> 'nacimiento', '')::date; exception when others then v_nac := null; end;
  if v_nac is not null and v_nac > current_date - interval '14 years' then v_mkt := false; end if;
  if coalesce((p_comprador ->> 'acepta')::boolean, false) is not true then return jsonb_build_object('ok', false, 'motivo', 'condiciones'); end if;
  if coalesce(f.edad_minima, 0) > 0 and coalesce((p_comprador ->> 'acepta_edad')::boolean, false) is not true then return jsonb_build_object('ok', false, 'motivo', 'edad'); end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then return jsonb_build_object('ok', false, 'motivo', 'vacio'); end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_cnt := coalesce((it ->> 'cantidad')::int, 0);
    if v_cnt < 0 or v_cnt > 50 then return jsonb_build_object('ok', false, 'motivo', 'cantidad'); end if;
    if v_cnt > 0 then pedidos := pedidos || jsonb_build_object(it ->> 'tramo', coalesce((pedidos ->> (it ->> 'tramo'))::int, 0) + v_cnt); v_n := v_n + v_cnt; end if;
  end loop;
  if v_n = 0 then return jsonb_build_object('ok', false, 'motivo', 'vacio'); end if;
  if v_n > 20 then return jsonb_build_object('ok', false, 'motivo', 'cantidad'); end if;
  if jsonb_typeof(p_asistentes) <> 'array' or jsonb_array_length(p_asistentes) <> v_n then return jsonb_build_object('ok', false, 'motivo', 'asistentes'); end if;

  select count(*) into v_ya from public.ticket_web_entradas x join public.ticket_web_pedidos p on p.id = x.pedido_id
   where x.evento_id = f.evento_id and lower(p.email) = v_email and x.estado = 'valida' and x.prueba = v_prueba;
  if v_ya + v_n > f.max_por_email then return jsonb_build_object('ok', false, 'motivo', 'limite_email', 'max', f.max_por_email, 'ya', v_ya); end if;

  for t in select x.*, s.estado as est from public.ticket_web_tramos x join public.web_tramos_estado(f.evento_id) s on s.id = x.id
           where x.evento_id = f.evento_id and pedidos ? x.id::text for update of x loop
    v_cnt := (pedidos ->> t.id::text)::int;
    if t.est <> 'venta' then return jsonb_build_object('ok', false, 'motivo', 'tramo_' || t.est, 'tramo', t.nombre); end if;
    if v_cnt > t.max_por_compra then return jsonb_build_object('ok', false, 'motivo', 'max_compra', 'tramo', t.nombre, 'max', t.max_por_compra); end if;
    if t.cantidad is not null and t.vendidas + v_cnt > t.cantidad then return jsonb_build_object('ok', false, 'motivo', 'sin_sitio', 'tramo', t.nombre, 'quedan', greatest(t.cantidad - t.vendidas, 0)); end if;
    if t.precio > 0 and not v_prueba and coalesce(current_setting('tixfast.rrpp_venta', true), '') = '' then return jsonb_build_object('ok', false, 'motivo', 'pago_no_disponible', 'tramo', t.nombre); end if;
    v_total := v_total + t.precio * v_cnt;
  end loop;
  if (select count(*) from jsonb_object_keys(pedidos)) <> (select count(*) from public.ticket_web_tramos x where x.evento_id = f.evento_id and pedidos ? x.id::text) then
    return jsonb_build_object('ok', false, 'motivo', 'tramo_no_existe');
  end if;

  v_pago := v_prueba and coalesce(f.pago_pruebas, false) and v_total > 0 and coalesce(current_setting('tixfast.rrpp_venta', true), '') = '';
  if v_pago then
    v_gastos := public.pago_gastos(v_total);
    for a in select * from jsonb_array_elements(p_asistentes) loop
      if not (pedidos ? coalesce(a ->> 'tramo', '')) then return jsonb_build_object('ok', false, 'motivo', 'asistentes'); end if;
      if length(btrim(coalesce(a ->> 'nombre', ''))) < 3 then return jsonb_build_object('ok', false, 'motivo', 'nombre_asistente'); end if;
    end loop;
  end if;

  if coalesce(e.qr_clave, '') = '' then
    update public.ticket_eventos set qr_clave = encode(extensions.gen_random_bytes(32), 'hex') where id = e.id returning * into e;
  end if;

  v_codigo := upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
  insert into public.ticket_web_pedidos (owner_id, evento_id, codigo, email, nombre, datos, total, estado, prueba, ip, agente, marketing, privacidad_version)
  values (f.owner_id, f.evento_id, v_codigo, v_email, v_nombre, v_datos, case when v_pago then v_total when v_prueba then 0 else v_total end,
          case when v_pago then 'pendiente' when v_prueba then 'prueba' else 'gratis' end, v_prueba, nullif(v_ip, ''),
          left(coalesce(current_setting('request.headers', true)::jsonb ->> 'user-agent', ''), 200), v_mkt, left(nullif(p_comprador ->> 'privacidad', ''), 40))
  returning id, acceso into v_pedido, v_acceso;

  if v_pago then
    update public.ticket_web_pedidos set gastos = v_gastos where id = v_pedido;
    insert into public.ticket_pagos (pedido_id, owner_id, evento_id, modo, entradas, gastos, importe, asistentes, rrpp, caduca_en)
    values (v_pedido, f.owner_id, f.evento_id, 'pruebas', v_total, v_gastos, v_total + v_gastos, p_asistentes,
            nullif(left(btrim(coalesce(p_comprador ->> 'rrpp', '')), 16), ''), now() + interval '40 minutes');
    update public.ticket_web_tramos x set vendidas = x.vendidas + (pedidos ->> x.id::text)::int where x.evento_id = f.evento_id and pedidos ? x.id::text;
    return jsonb_build_object('ok', true, 'pago', true, 'codigo', v_codigo, 'acceso', v_acceso, 'prueba', v_prueba,
                              'entradas', v_total, 'gastos', v_gastos, 'importe', v_total + v_gastos);
  end if;

  v_num := f.contador;
  v_ver := case when v_prueba then 4 else 3 end;
  for a in select * from jsonb_array_elements(p_asistentes) loop
    select * into t from public.ticket_web_tramos where id = (a ->> 'tramo')::uuid and evento_id = f.evento_id;
    if t.id is null or not (pedidos ? t.id::text) then raise exception using message = 'asistentes'; end if;
    if length(btrim(coalesce(a ->> 'nombre', ''))) < 3 then raise exception using message = 'nombre_asistente'; end if;
    v_num := v_num + 1; v_ent := gen_random_uuid();
    v_msg := set_byte('\x00'::bytea, 0, v_ver) || decode(replace(v_ent::text, '-', ''), 'hex') || '\x00'::bytea || '\x01'::bytea
             || decode(left(replace(t.id::text, '-', ''), 12), 'hex');
    v_mac := substring(extensions.hmac(v_msg, decode(e.qr_clave, 'hex'), 'sha256') from 1 for 8);
    insert into public.ticket_web_entradas (id, owner_id, evento_id, pedido_id, tramo_id, tramo_nombre, numero, asistente, dni, precio, prueba, qr_hex)
    values (v_ent, f.owner_id, f.evento_id, v_pedido, t.id, t.nombre, v_num, left(btrim(a ->> 'nombre'), 120),
            nullif(left(btrim(coalesce(a ->> 'dni', '')), 30), ''), case when v_prueba then 0 else t.precio end, v_prueba, encode(v_msg || v_mac, 'hex'));
  end loop;
  perform public.rrpp_atribuir(v_pedido, f.evento_id, f.owner_id, p_comprador ->> 'rrpp');
  update public.ticket_web_tramos x set vendidas = x.vendidas + (pedidos ->> x.id::text)::int where x.evento_id = f.evento_id and pedidos ? x.id::text;
  update public.ticket_web_eventos set contador = v_num where evento_id = f.evento_id;

  return jsonb_build_object('ok', true, 'codigo', v_codigo, 'acceso', v_acceso, 'prueba', v_prueba);
exception when others then
  if sqlerrm in ('nombre_asistente', 'asistentes') then return jsonb_build_object('ok', false, 'motivo', sqlerrm); end if;
  raise;
end $function$;
grant execute on function public.web_comprar(text, jsonb, jsonb, jsonb) to anon, authenticated;

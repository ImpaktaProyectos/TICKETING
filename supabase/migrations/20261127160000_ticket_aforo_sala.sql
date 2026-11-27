-- ===================== AFORO DE LA SALA (todos los canales) =====================
-- Va después de 20261127150000_ticket_pv_impresion.sql.
-- El organizador pone el aforo real de la sala (Entradas › Gestionar evento › paso 3). Ocupan sitio, sin contar nada dos veces:
--  · lo vendido o reservado online por tramos (incluye compras en pago, invitaciones que cuentan y ventas al móvil de los puntos),
--  · lo entregado a puntos de venta (talonario propio o con QR) menos lo devuelto; si está liquidado por cantidad, lo vendido,
--  · las ventas que se añaden a mano o llegan de otras ticketeras (ingresos del CRM con canal y unidades).
-- Cuando no queda sitio, la web marca los tramos como agotados y no se puede vender, invitar, vender al móvil ni crear talonarios.
-- Sin aforo puesto, todo funciona como antes (solo cuentan los tramos).

alter table public.ticket_web_eventos add column if not exists aforo int check (aforo is null or aforo between 1 and 1000000);

create or replace function public.web_aforo_detalle(p_evento uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'online', coalesce((select sum(t.vendidas) from public.ticket_web_tramos t where t.evento_id = p_evento), 0),
    'puntos', coalesce((select sum(case when l.vendidas_modo = 'cantidad' then coalesce(l.vendidas, 0)
                                        else (l.hasta - l.desde + 1) - public.pv_rangos_contar(l.devueltas) end)
                        from public.ticket_pv_lotes l where l.evento_id = p_evento), 0),
    'otras', coalesce((select sum(i.unidades) from public.ticket_crm_ingresos i
                       where i.evento_id = p_evento and i.canal is not null and i.unidades is not null and coalesce(i.origen, 'manual') not in ('web', 'pv')), 0))
$$;
revoke all on function public.web_aforo_detalle(uuid) from public, anon, authenticated;

create or replace function public.web_aforo_ocupado(p_evento uuid)
returns int language sql stable security definer set search_path = '' as $$
  select ((d ->> 'online')::int + (d ->> 'puntos')::int + (d ->> 'otras')::int) from (select public.web_aforo_detalle(p_evento) d) z
$$;
revoke all on function public.web_aforo_ocupado(uuid) from public, anon, authenticated;

-- Para el CRM (solo el dueño del evento)
create or replace function public.web_aforo_estado(p_evento uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare f record; d jsonb;
begin
  select * into f from public.ticket_web_eventos where evento_id = p_evento and owner_id = (select auth.uid());
  if f.evento_id is null then return null; end if;
  d := public.web_aforo_detalle(p_evento);
  return d || jsonb_build_object('aforo', f.aforo, 'ocupado', (d ->> 'online')::int + (d ->> 'puntos')::int + (d ->> 'otras')::int);
end $$;
revoke all on function public.web_aforo_estado(uuid) from public, anon;
grant execute on function public.web_aforo_estado(uuid) to authenticated;

do $$
declare d text; n int;
begin
  -- 1) Estado de los tramos (web pública y compra): sin sitio en la sala = agotado; «quedan» no pasa del aforo libre
  select pg_get_functiondef('public.web_tramos_estado(uuid)'::regprocedure) into d;
  if position('v_libre' in d) = 0 then
    d := replace(d, 'est text;
begin', 'est text; v_libre int;
begin');
    d := replace(d, '  select fin into e from public.ticket_eventos where ticket_eventos.id = p_evento;
', '  select fin into e from public.ticket_eventos where ticket_eventos.id = p_evento;
  if f.aforo is not null then v_libre := greatest(f.aforo - public.web_aforo_ocupado(p_evento), 0); end if;
');
    d := replace(d, $a$    elsif t.cantidad is not null and t.vendidas >= t.cantidad then est := 'agotado';
$a$, $b$    elsif t.cantidad is not null and t.vendidas >= t.cantidad then est := 'agotado';
    elsif v_libre is not null and v_libre <= 0 then est := 'agotado';
$b$);
    d := replace(d, 'quedan := case when t.cantidad is null then null else greatest(t.cantidad - t.vendidas, 0) end;',
                    'quedan := case when t.cantidad is null then v_libre when v_libre is null then greatest(t.cantidad - t.vendidas, 0) else least(greatest(t.cantidad - t.vendidas, 0), v_libre) end;');
    select count(*) into n from regexp_matches(d, 'v_libre', 'g');
    if n < 6 then raise exception 'web_tramos_estado: no se ha podido añadir el aforo (%)', n; end if;
    execute d;
  end if;

  -- 2) Compra online: con el evento bloqueado (for update), no se pasa del aforo
  select pg_get_functiondef('public.web_comprar'::regproc) into d;
  if position('web_aforo_ocupado' in d) = 0 then
    d := replace(d, '  insert into public.ticket_web_pedidos (owner_id, evento_id, codigo, email, nombre, datos, total, estado, prueba, ip, agente, marketing, privacidad_version,',
      $b$  if f.aforo is not null and public.web_aforo_ocupado(f.evento_id) + v_n > f.aforo then
    return jsonb_build_object('ok', false, 'motivo', 'aforo', 'quedan', greatest(f.aforo - public.web_aforo_ocupado(f.evento_id), 0));
  end if;
  insert into public.ticket_web_pedidos (owner_id, evento_id, codigo, email, nombre, datos, total, estado, prueba, ip, agente, marketing, privacidad_version,$b$);
    if position('web_aforo_ocupado' in d) = 0 then raise exception 'web_comprar: no se ha podido añadir el aforo'; end if;
    execute d;
  end if;

  -- 3) Invitaciones que cuentan para el aforo
  select pg_get_functiondef('public.web_invitar'::regproc) into d;
  if position('web_aforo_ocupado' in d) = 0 then
    d := replace(d, '  if p_aforo and t.cantidad is not null and t.vendidas + p_cantidad > t.cantidad then',
      $b$  if p_aforo and f.aforo is not null and public.web_aforo_ocupado(p_evento) + p_cantidad > f.aforo then
    return jsonb_build_object('ok', false, 'motivo', 'sin_sitio', 'quedan', greatest(f.aforo - public.web_aforo_ocupado(p_evento), 0));
  end if;
  if p_aforo and t.cantidad is not null and t.vendidas + p_cantidad > t.cantidad then$b$);
    if position('web_aforo_ocupado' in d) = 0 then raise exception 'web_invitar: no se ha podido añadir el aforo'; end if;
    execute d;
  end if;

  -- 4) Venta al móvil desde el panel del punto de venta
  select pg_get_functiondef('public.pv_venta_directa(uuid,uuid,int,jsonb)'::regprocedure) into d;
  if position('web_aforo_ocupado' in d) = 0 then
    d := replace(d, $a$  if coalesce(e.qr_clave, '') = '' then$a$,
      $b$  if f.aforo is not null and public.web_aforo_ocupado(e.id) + p_cantidad > f.aforo then return jsonb_build_object('ok', false, 'motivo', 'agotado', 'quedan', greatest(f.aforo - public.web_aforo_ocupado(e.id), 0)); end if;
  if coalesce(e.qr_clave, '') = '' then$b$);
    if position('web_aforo_ocupado' in d) = 0 then raise exception 'pv_venta_directa: no se ha podido añadir el aforo'; end if;
    execute d;
  end if;

  -- 5) Talonarios con QR (y tandas): no se generan más entradas de las que caben
  select pg_get_functiondef('public.pv_crear_talonario(uuid,uuid,text,numeric,int,text,numeric,text)'::regprocedure) into d;
  if position('web_aforo_ocupado' in d) = 0 then
    d := replace(d, $a$  if f.evento_id is null then return jsonb_build_object('ok', false, 'motivo', 'sin_web'); end if;
$a$, $b$  if f.evento_id is null then return jsonb_build_object('ok', false, 'motivo', 'sin_web'); end if;
  if f.aforo is not null and public.web_aforo_ocupado(p_evento) + p_cantidad > f.aforo then
    return jsonb_build_object('ok', false, 'motivo', 'aforo', 'quedan', greatest(f.aforo - public.web_aforo_ocupado(p_evento), 0));
  end if;
$b$);
    if position('web_aforo_ocupado' in d) = 0 then raise exception 'pv_crear_talonario: no se ha podido añadir el aforo'; end if;
    execute d;
  end if;
end $$;

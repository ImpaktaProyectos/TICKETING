-- ===================== COLA VIRTUAL: AJUSTES TRAS LA PRUEBA CON 20.000 PERSONAS =====================
-- Va después de 20261127180000_ticket_cola_virtual.sql.
-- · Consultar el puesto contaba una a una a todas las personas de delante (3,3 ms con 20.000 en cola).
--   Ahora se calcula al momento con los turnos (índice) y solo se cuenta exacto cuando quedan menos de 2.000 delante.
-- · El tiempo estimado no baja nunca del ritmo real esperado (cada persona tarda unos 2-3 minutos en comprar).
-- · Límite por defecto: 1.000 personas comprando a la vez (la base de datos aguanta mucho más; lo que se reparte es la
--   avalancha). TIXFAST lo sube al pasar a un plan mayor de Supabase.

update public.ticket_pago_config set valor = '1000' where clave = 'cola_capacidad' and valor = '300';

create or replace function public.cola_situacion(c public.ticket_web_cola)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_delante int; v_ritmo numeric; v_min_sorteo bigint; v_max_sorteo bigint; v_min_tarde bigint;
begin
  if c.admitido_en is not null then
    if c.admitido_en > now() - interval '10 minutes' then
      return jsonb_build_object('ok', true, 'estado', 'dentro', 'pase', c.token, 'hasta', c.admitido_en + interval '10 minutes');
    end if;
    return jsonb_build_object('ok', true, 'estado', 'caducado');
  end if;
  if c.turno is null then return jsonb_build_object('ok', true, 'estado', 'apertura', 'token', c.token); end if;
  -- Estimación al momento con los turnos que aún esperan (los del sorteo van del 1 al N; los que llegan después, a partir de 1.000.000.000)
  select min(turno) into v_min_sorteo from public.ticket_web_cola where evento_id = c.evento_id and admitido_en is null and turno < 1000000000;
  select max(turno) into v_max_sorteo from public.ticket_web_cola where evento_id = c.evento_id and admitido_en is null and turno < 1000000000;
  select min(turno) into v_min_tarde from public.ticket_web_cola where evento_id = c.evento_id and admitido_en is null and turno >= 1000000000;
  if c.turno < 1000000000 then v_delante := greatest(0, c.turno - coalesce(v_min_sorteo, c.turno));
  else v_delante := coalesce(v_max_sorteo - v_min_sorteo + 1, 0) + greatest(0, c.turno - coalesce(v_min_tarde, c.turno)); end if;
  -- Con pocos delante, la cuenta exacta (sin contar a quien se ha ido de la página)
  if v_delante < 2000 then
    select count(*) into v_delante from (select 1 from public.ticket_web_cola
       where evento_id = c.evento_id and admitido_en is null and turno is not null and turno < c.turno and visto_en > now() - interval '90 seconds' limit 2000) z;
  end if;
  select greatest(count(*) / 5.0, public.cola_capacidad() / 3.0) into v_ritmo
    from public.ticket_web_cola where evento_id = c.evento_id and admitido_en > now() - interval '5 minutes';
  return jsonb_build_object('ok', true, 'estado', 'cola', 'token', c.token, 'delante', v_delante,
    'minutos', greatest(1, ceil(v_delante / v_ritmo)));
end $$;
revoke all on function public.cola_situacion(public.ticket_web_cola) from public, anon, authenticated;

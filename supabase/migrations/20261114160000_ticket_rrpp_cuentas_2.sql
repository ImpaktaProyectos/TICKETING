-- ===================== RRPP · cuentas (2) =====================
-- 1) Un RRPP sigue viendo los eventos donde ya vendió aunque el organizador le pause o le quite del evento:
--    su dinero pendiente no desaparece del monedero. Cada evento dice si puede seguir vendiendo («vende»).
-- 2) La cuenta de un RRPP (user_id) solo la enlazan las funciones del servidor (solicitud del propio RRPP),
--    nunca el organizador a mano.
-- Solo reemplaza funciones y añade un disparador.

create or replace function public.rrpp_eventos_json(p_rrpp uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x ->> 'fecha'), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', e.id, 'rrpp', r.id, 'nombre', e.nombre, 'fecha', e.fecha, 'inicio', e.inicio, 'recinto', e.recinto,
      'slug', w.slug, 'estado', w.estado, 'modo', w.modo, 'edad_minima', w.edad_minima,
      'formulario', coalesce(w.formulario, '{}'::jsonb),
      'vende', public.rrpp_en_evento(r.id, e.id),
      'efectivo', coalesce(c.efectivo, true),
      'comision', jsonb_build_object('tipo', coalesce(o.tipo, c.tipo, 'fija'), 'valor', coalesce(case when o.tipo is not null then o.valor end, c.valor, 0),
                                     'tramos', coalesce(case when o.tipo is not null then o.tramos end, c.tramos, '{}'::jsonb)),
      'tramos', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'nombre', t.nombre, 'precio', t.precio, 'estado', s.estado,
                   'quedan', case when t.cantidad is null then null else greatest(t.cantidad - t.vendidas, 0) end, 'max', t.max_por_compra) order by t.orden, t.precio), '[]'::jsonb)
                 from public.ticket_web_tramos t join public.web_tramos_estado(e.id) s on s.id = t.id where t.evento_id = e.id and t.visible),
      'online', (select count(*) from public.ticket_web_entradas x join public.ticket_web_pedidos p on p.id = x.pedido_id
                  where x.evento_id = e.id and x.rrpp_id = r.id and x.estado = 'valida' and not x.prueba and not p.rrpp_efectivo),
      'efectivo_n', (select count(*) from public.ticket_web_entradas x join public.ticket_web_pedidos p on p.id = x.pedido_id
                  where x.evento_id = e.id and x.rrpp_id = r.id and x.estado = 'valida' and not x.prueba and p.rrpp_efectivo),
      'efectivo_importe', (select coalesce(sum(x.precio), 0) from public.ticket_web_entradas x join public.ticket_web_pedidos p on p.id = x.pedido_id
                  where x.evento_id = e.id and x.rrpp_id = r.id and x.estado = 'valida' and not x.prueba and p.rrpp_efectivo),
      'pruebas', (select count(*) from public.ticket_web_entradas x where x.evento_id = e.id and x.rrpp_id = r.id and x.estado = 'valida' and x.prueba),
      'comision_total', (select coalesce(sum(public.rrpp_comision(e.id, r.id, x.tramo_id, x.precio)), 0) from public.ticket_web_entradas x
                  where x.evento_id = e.id and x.rrpp_id = r.id and x.estado = 'valida' and not x.prueba),
      'liquidacion', (select jsonb_build_object('entradas', l.entradas, 'comision', l.comision, 'efectivo', l.efectivo, 'resultado', l.resultado, 'metodo', l.metodo, 'cerrada_en', l.cerrada_en)
                  from public.ticket_rrpp_liquidaciones l where l.evento_id = e.id and l.rrpp_id = r.id)
    ) x
    from public.ticket_rrpp r
    join public.ticket_web_eventos w on w.owner_id = r.owner_id
    join public.ticket_eventos e on e.id = w.evento_id
    left join public.ticket_rrpp_config c on c.evento_id = e.id
    left join public.ticket_rrpp_eventos o on o.evento_id = e.id and o.rrpp_id = r.id
    where r.id = p_rrpp and w.estado <> 'borrador'
      and ((public.rrpp_en_evento(r.id, e.id) and (e.fecha is null or e.fecha >= current_date - 45))
           or exists (select 1 from public.ticket_web_entradas x where x.evento_id = e.id and x.rrpp_id = r.id))
  ) q
$$;
revoke all on function public.rrpp_eventos_json(uuid) from public, anon, authenticated;

create or replace function public.rrpp_mi_panel()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); pf record; v_orgs jsonb; v_ventas jsonb; v_cobros jsonb;
begin
  if v_uid is null then return null; end if;
  select * into pf from public.ticket_rrpp_perfiles where user_id = v_uid;
  if pf.user_id is null then return jsonb_build_object('perfil', null); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'rrpp', r.id, 'estado', case when r.estado = 'activa' and not r.activo then 'pausada' else r.estado end, 'solicitado_en', r.solicitado_en,
      'organizador', coalesce((select o.nombre from public.ticket_web_organizaciones o where o.owner_id = r.owner_id order by o.creado_en limit 1),
                              (select l.razon_social from public.ticket_web_legal l where l.owner_id = r.owner_id), 'Organizador'),
      'logo', (select o.logo_url from public.ticket_web_organizaciones o where o.owner_id = r.owner_id order by o.creado_en limit 1),
      'eventos', public.rrpp_eventos_json(r.id)
    ) order by r.estado = 'activa' desc, r.creado_en), '[]'::jsonb)
    into v_orgs from public.ticket_rrpp r where r.user_id = v_uid and r.estado <> 'rechazada';

  select coalesce(jsonb_agg(v order by v ->> 'creado_en' desc), '[]'::jsonb) into v_ventas from (
    select jsonb_build_object('creado_en', p.creado_en, 'evento', e.nombre, 'evento_id', p.evento_id, 'rrpp', p.rrpp_id,
           'comprador', split_part(btrim(p.nombre), ' ', 1) || coalesce(' ' || left(nullif(split_part(btrim(p.nombre), ' ', 2), ''), 1) || '.', ''),
           'entradas', (select count(*) from public.ticket_web_entradas x where x.pedido_id = p.id and x.estado = 'valida'),
           'efectivo', p.rrpp_efectivo, 'prueba', p.prueba, 'anulado', not exists (select 1 from public.ticket_web_entradas x where x.pedido_id = p.id and x.estado = 'valida'),
           'total', case when p.rrpp_efectivo then (select coalesce(sum(x.precio), 0) from public.ticket_web_entradas x where x.pedido_id = p.id and x.estado = 'valida') end,
           'acceso', case when p.rrpp_efectivo then p.acceso end,
           'anulable', p.rrpp_efectivo and p.creado_en > now() - interval '15 minutes') v
    from public.ticket_web_pedidos p join public.ticket_eventos e on e.id = p.evento_id
    where p.rrpp_id in (select id from public.ticket_rrpp where user_id = v_uid) order by p.creado_en desc limit 80
  ) q;

  select coalesce(jsonb_agg(jsonb_build_object('evento', e.nombre, 'entradas', l.entradas, 'comision', l.comision, 'efectivo', l.efectivo,
           'resultado', l.resultado, 'metodo', l.metodo, 'cerrada_en', l.cerrada_en) order by l.cerrada_en desc), '[]'::jsonb)
    into v_cobros from public.ticket_rrpp_liquidaciones l join public.ticket_eventos e on e.id = l.evento_id
   where l.rrpp_id in (select id from public.ticket_rrpp where user_id = v_uid);

  return jsonb_build_object('perfil', to_jsonb(pf), 'organizadores', v_orgs, 'ventas', v_ventas, 'cobros', v_cobros, 'ahora', now());
end $$;
revoke all on function public.rrpp_mi_panel() from public, anon;
grant execute on function public.rrpp_mi_panel() to authenticated;

-- La cuenta enlazada a un RRPP no la toca nadie desde fuera del servidor
create or replace function public.rrpp_proteger_cuenta()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' and new.user_id is not null then raise exception 'rrpp_cuenta'; end if;
    if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then raise exception 'rrpp_cuenta'; end if;
  end if;
  return new;
end $$;
revoke all on function public.rrpp_proteger_cuenta() from public, anon, authenticated;
drop trigger if exists rrpp_proteger_cuenta on public.ticket_rrpp;
create trigger rrpp_proteger_cuenta before insert or update on public.ticket_rrpp
  for each row execute function public.rrpp_proteger_cuenta();

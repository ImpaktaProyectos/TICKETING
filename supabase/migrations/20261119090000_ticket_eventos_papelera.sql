-- ===================== PAPELERA DE EVENTOS =====================
-- Borrar un evento ya no lo elimina al momento: va a la papelera durante 30 días y se puede rescatar.
-- · ticket_eventos.borrado_en: cuándo se borró (null = evento normal).
-- · ticket_eventos.borrado_previo: cómo estaba lo público (web, reservas online, puestos) para dejarlo igual al rescatarlo.
-- · Al borrar se apaga todo lo público: la web pasa a borrador, la reserva online se desactiva y los puestos también.
-- · No se puede borrar un evento con entradas vendidas por internet o cobros online: hay dinero de clientes.
-- · Pasados 30 días, una tarea diaria lo elimina para siempre (con todas sus ventas, cierres, gastos…).

alter table public.ticket_eventos add column if not exists borrado_en timestamptz;
alter table public.ticket_eventos add column if not exists borrado_previo jsonb;
create index if not exists ticket_eventos_borrados_idx on public.ticket_eventos (borrado_en) where borrado_en is not null;

-- Borrar (a la papelera)
create or replace function public.ticket_evento_borrar(p_evento uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); e record; v_previo jsonb;
begin
  select * into e from public.ticket_eventos where id = p_evento and owner_id = v_uid for update;
  if not found then raise exception 'no autorizado' using errcode = '42501'; end if;
  if e.borrado_en is not null then return jsonb_build_object('ok', true, 'borrado_en', e.borrado_en); end if;
  if exists (select 1 from public.ticket_web_entradas x where x.evento_id = p_evento and not x.prueba and x.estado = 'valida')
     or exists (select 1 from public.ticket_pagos g where g.evento_id = p_evento) then
    raise exception using errcode = 'P0001', message = 'TIXFAST: este evento tiene entradas vendidas o cobros por internet y no se puede borrar. Puedes cerrar su caja.';
  end if;
  v_previo := jsonb_build_object(
    'web_estado', (select w.estado from public.ticket_web_eventos w where w.evento_id = p_evento),
    'reservas_activo', (select r.activo from public.ticket_reservas_web r where r.evento_id = p_evento),
    'puestos_activos', coalesce((select jsonb_agg(p.id) from public.ticket_puestos p where p.evento_id = p_evento and p.activo), '[]'::jsonb));
  update public.ticket_web_eventos set estado = 'borrador' where evento_id = p_evento;
  update public.ticket_reservas_web set activo = false where evento_id = p_evento;
  update public.ticket_puestos set activo = false where evento_id = p_evento;
  update public.ticket_eventos set borrado_en = now(), borrado_previo = v_previo where id = p_evento;
  return jsonb_build_object('ok', true, 'borrado_en', now());
end $$;

-- Rescatar de la papelera (respeta el límite de eventos del plan, como al crear uno)
create or replace function public.ticket_evento_restaurar(p_evento uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); e record; a record; lim int; n int; mejor text; pv jsonb;
begin
  select * into e from public.ticket_eventos where id = p_evento and owner_id = v_uid for update;
  if not found then raise exception 'no autorizado' using errcode = '42501'; end if;
  if e.borrado_en is null then return jsonb_build_object('ok', true); end if;
  if not coalesce(e.cerrada, false) and coalesce(e.fecha, current_date) >= current_date - 1 then
    select * into a from public.ticket_acceso_de(v_uid);
    if found then
      lim := nullif(a.limites ->> 'eventos', '')::int;
      if lim is not null then
        select count(*) into n from public.ticket_eventos x where x.owner_id = v_uid and x.borrado_en is null
          and not coalesce(x.cerrada, false) and coalesce(x.fecha, current_date) >= current_date - 1;
        if n >= lim then
          mejor := public.ticket_plan_mejora(a.plan_id, null, 'eventos', lim);
          raise exception using errcode = 'P0001', message = format('TIXFAST: tu plan %s permite %s %s. Borra o cierra otro evento para rescatar este.%s', a.plan_nombre, lim,
            coalesce(public.ticket_catalogo() -> 'limites' ->> 'eventos', 'eventos'),
            case when mejor is not null then format(' Con %s tienes más.', mejor) else '' end);
        end if;
      end if;
    end if;
  end if;
  pv := coalesce(e.borrado_previo, '{}'::jsonb);
  if pv ->> 'web_estado' is not null then update public.ticket_web_eventos set estado = pv ->> 'web_estado' where evento_id = p_evento; end if;
  if pv ->> 'reservas_activo' is not null then update public.ticket_reservas_web set activo = (pv ->> 'reservas_activo')::boolean where evento_id = p_evento; end if;
  update public.ticket_puestos set activo = true
   where evento_id = p_evento and id in (select (j #>> '{}')::uuid from jsonb_array_elements(coalesce(pv -> 'puestos_activos', '[]'::jsonb)) j);
  update public.ticket_eventos set borrado_en = null, borrado_previo = null where id = p_evento;
  return jsonb_build_object('ok', true);
end $$;

-- Borrar definitivamente desde la papelera (antes de los 30 días)
create or replace function public.ticket_evento_eliminar(p_evento uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if not exists (select 1 from public.ticket_eventos where id = p_evento and owner_id = v_uid and borrado_en is not null) then
    raise exception 'no autorizado' using errcode = '42501';
  end if;
  delete from public.ticket_eventos where id = p_evento;
  return jsonb_build_object('ok', true);
end $$;

-- Limpieza: lo que lleva más de 30 días en la papelera desaparece (los que tienen cobros nunca llegan aquí)
create or replace function public.ticket_eventos_purgar()
returns integer language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.ticket_eventos e where e.borrado_en < now() - interval '30 days'
    and not exists (select 1 from public.ticket_pagos g where g.evento_id = e.id);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.ticket_evento_borrar(uuid) from public, anon;
revoke all on function public.ticket_evento_restaurar(uuid) from public, anon;
revoke all on function public.ticket_evento_eliminar(uuid) from public, anon;
revoke all on function public.ticket_eventos_purgar() from public, anon, authenticated;
grant execute on function public.ticket_evento_borrar(uuid) to authenticated;
grant execute on function public.ticket_evento_restaurar(uuid) to authenticated;
grant execute on function public.ticket_evento_eliminar(uuid) to authenticated;

-- El límite de eventos del plan no cuenta los que están en la papelera
create or replace function public.ticket_limite_plan()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a record; k text := tg_argv[0]; lim int; n int; mejor text; ev_id uuid;
begin
  if (select auth.uid()) is null or new.owner_id is distinct from (select auth.uid()) then return new; end if;
  select * into a from public.ticket_acceso_de(new.owner_id);
  if not found then return new; end if;
  lim := nullif(a.limites ->> k, '')::int;
  if lim is null then return new; end if;
  if k = 'barras_por_evento' then
    if coalesce((to_jsonb(new) ->> 'archivado')::boolean, false) then return new; end if;
    ev_id := nullif(to_jsonb(new) ->> 'evento_id', '')::uuid;
    if a.plan_id = 'sin_suscripcion' and public.ticket_evento_protegido(ev_id, a.fin_acceso) then return new; end if;
    select count(*) into n from public.ticket_puntos p where p.evento_id = ev_id and not coalesce(p.archivado, false);
  elsif k = 'eventos' then
    select count(*) into n from public.ticket_eventos e where e.owner_id = new.owner_id and e.borrado_en is null and not coalesce(e.cerrada, false) and coalesce(e.fecha, current_date) >= current_date - 1;
  elsif k = 'puestos_por_evento' then
    ev_id := nullif(to_jsonb(new) ->> 'evento_id', '')::uuid;
    select count(*) into n from public.ticket_puestos p where p.evento_id = ev_id;
  elsif k = 'socios' then
    select count(*) into n from public.ticket_crm_socios s where s.owner_id = new.owner_id and coalesce(s.activo, true);
  elsif k = 'facturas_mes' then
    if to_jsonb(new) ->> 'tipo' is distinct from 'emitida' then return new; end if;
    select count(*) into n from public.ticket_fac_facturas f where f.owner_id = new.owner_id and f.tipo = 'emitida' and f.creado_en >= date_trunc('month', now());
  else
    return new;
  end if;
  if n < lim then return new; end if;
  mejor := public.ticket_plan_mejora(a.plan_id, null, k, lim);
  raise exception using errcode = 'P0001', message = format('TIXFAST: tu plan %s permite %s %s.%s', a.plan_nombre, lim,
    coalesce(public.ticket_catalogo() -> 'limites' ->> k, k),
    case when mejor is not null then format(' Con %s tienes más: cámbialo en Ajustes › Tu cuenta.', mejor) else '' end);
end $$;

-- Tarea diaria de limpieza (4:23 de la mañana, hora del servidor)
do $$ begin
  if exists (select 1 from cron.job where jobname = 'tixfast-papelera-eventos') then perform cron.unschedule('tixfast-papelera-eventos'); end if;
  perform cron.schedule('tixfast-papelera-eventos', '23 4 * * *', 'select public.ticket_eventos_purgar()');
end $$;

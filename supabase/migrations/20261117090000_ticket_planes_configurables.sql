-- =====================================================================
-- TIXFAST · PLANES DE SUSCRIPCIÓN CONFIGURABLES DESDE EL PANEL
-- ---------------------------------------------------------------------
-- · Los planes ya no están fijados en el código: desde el Panel TIXFAST se crean, se editan,
--   se ordenan, se ocultan y se archivan (nombre, descripción, precio, días de prueba y permisos).
-- · Cada plan dice QUÉ incluye (funciones) y CUÁNTO (límites). Se guarda en limites:
--     {"bloquea": ["facturacion", …], "barras_por_evento": 3, "planos": 2, …}
--   (mismo formato de siempre: lo que no está en «bloquea» va incluido; límite ausente = sin límite).
-- · Catálogo (debe coincidir con CATALOGO de ticketera-app/src/planes.js):
--     funciones: tpv, reservados, reserva_online, crm, facturacion, stock, prevision, conexiones
--     límites:   eventos (a la vez), barras_por_evento, planos (guardados), socios, facturas_mes
-- · La TICKETERA (entradas online, organizaciones, RRPP, validación) sigue siendo siempre gratuita.
-- · Planes del sistema (no se borran): «fundador» (todo, sin cuota) y «sin_suscripcion»
--   (lo que tiene quien no paga; sus permisos también se pueden ajustar desde el panel).
-- · Cambiar los permisos de un plan afecta al momento a todas sus cuentas. Cambiar el precio
--   solo afecta a las altas nuevas (Stripe mantiene el precio de las suscripciones en marcha).
-- · Todos los límites los comprueba la base de datos (la app solo avisa antes).
-- =====================================================================

alter table public.ticket_planes add column if not exists descripcion text check (descripcion is null or length(descripcion) <= 300);
alter table public.ticket_planes add column if not exists destacado boolean not null default false;
alter table public.ticket_planes add column if not exists dias_prueba int not null default 7 check (dias_prueba between 0 and 60);
alter table public.ticket_planes add column if not exists sistema boolean not null default false;
alter table public.ticket_planes add column if not exists archivado boolean not null default false;
alter table public.ticket_planes add column if not exists stripe_product_id text;
alter table public.ticket_planes add column if not exists stripe_sincronizado_en timestamptz;
alter table public.ticket_planes add column if not exists actualizado_en timestamptz not null default now();

update public.ticket_planes set sistema = true, publico = false where id in ('fundador', 'sin_suscripcion');
update public.ticket_planes set destacado = true where id = 'pro' and not exists (select 1 from public.ticket_planes where destacado);
update public.ticket_planes set descripcion = coalesce(descripcion, case id
    when 'pro' then 'Todo lo necesario para tus noches: TPV, reservados y CRM.'
    when 'premium' then 'Para quien hace muchos eventos: todo incluido y sin límites.'
    when 'empresa' then 'Para grupos y salas con varios equipos.' end)
  where id in ('pro', 'premium', 'empresa');
-- El producto de Stripe que ya existiera (guardado en la configuración) pasa a su plan
update public.ticket_planes p set stripe_product_id = c.valor
  from public.ticket_pago_config c
  where p.stripe_product_id is null and c.clave = case when p.id = 'pro' then 'producto_suscripcion' else 'producto_suscripcion_' || p.id end;
-- «sin_suscripcion» bloquea también la reserva online (antes iba dentro de «reservados»)
update public.ticket_planes set limites = jsonb_set(limites, '{bloquea}', (limites -> 'bloquea') || '["reserva_online"]'::jsonb)
  where id = 'sin_suscripcion' and not coalesce(limites -> 'bloquea' ? 'reserva_online', false);

-- ---------- Catálogo y validación ----------
create or replace function public.ticket_catalogo()
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'funciones', jsonb_build_object(
      'tpv', 'El TPV', 'reservados', 'Los reservados VIP', 'reserva_online', 'La reserva online de mesas',
      'crm', 'El CRM', 'facturacion', 'La facturación', 'stock', 'El control de stock',
      'prevision', 'La previsión', 'conexiones', 'La conexión con ticketeras'),
    'limites', jsonb_build_object(
      'eventos', 'eventos a la vez', 'barras_por_evento', 'puntos de venta por evento', 'planos', 'planos guardados',
      'socios', 'socios', 'facturas_mes', 'facturas emitidas al mes'));
$$;
revoke all on function public.ticket_catalogo() from public, anon;
grant execute on function public.ticket_catalogo() to authenticated;

-- Plan contratable más barato que mejora lo que se pide (para los avisos): incluye la función
-- o tiene más límite que p_n. Null si no hay ninguno.
create or replace function public.ticket_plan_mejora(p_actual text, p_funcion text, p_limite text, p_n int)
returns text language sql stable security definer set search_path = '' as $$
  select p.nombre from public.ticket_planes p
  where p.publico and not p.archivado and not p.sistema and coalesce(p.precio_mes, 0) > 0 and p.id is distinct from p_actual
    and (p_funcion is null or not coalesce(p.limites -> 'bloquea' ? p_funcion, false))
    and (p_limite is null or nullif(p.limites ->> p_limite, '') is null or (p.limites ->> p_limite)::int > p_n)
  order by p.precio_mes, p.orden limit 1;
$$;
revoke all on function public.ticket_plan_mejora(text, text, text, int) from public, anon, authenticated;

-- Plan por defecto para altas sin plan elegido: el destacado, si no el más barato que se pueda contratar
create or replace function public.ticket_plan_por_defecto()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select id from public.ticket_planes where publico and not archivado and not sistema and coalesce(precio_mes, 0) > 0
    order by destacado desc, precio_mes, orden limit 1), 'pro');
$$;
revoke all on function public.ticket_plan_por_defecto() from public, anon, authenticated;

-- ¿El evento conserva todo? (creado con acceso completo, hasta el día siguiente a su fecha).
-- Solo vale para quien ha perdido la suscripción: con un plan activo mandan los permisos de su plan.
create or replace function public.ticket_evento_protegido(p_evento uuid, p_fin timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_evento is not null and p_fin is not null and exists (
    select 1 from public.ticket_eventos e where e.id = p_evento and e.creado_en <= p_fin and coalesce(e.fecha, current_date) >= current_date - 1);
$$;
revoke all on function public.ticket_evento_protegido(uuid, timestamptz) from public, anon, authenticated;

-- ---------- Funciones de pago: aviso según tenga o no suscripción ----------
create or replace function public.ticket_funcion_permitida()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a record; f text := tg_argv[0]; ev_id uuid; nombre text; mejor text; plan_txt text;
begin
  if (select auth.uid()) is null or new.owner_id is distinct from (select auth.uid()) then return new; end if;
  select * into a from public.ticket_acceso_de(new.owner_id);
  if not found or not coalesce(a.limites -> 'bloquea' ? f, false) then return new; end if;
  -- Un evento creado con acceso completo conserva sus funciones hasta el día siguiente a su fecha
  ev_id := nullif(to_jsonb(new) ->> 'evento_id', '')::uuid;
  if a.plan_id = 'sin_suscripcion' and public.ticket_evento_protegido(ev_id, a.fin_acceso) then return new; end if;
  nombre := coalesce(public.ticket_catalogo() -> 'funciones' ->> f, 'Esta función');
  if a.plan_id = 'sin_suscripcion' then
    raise exception using errcode = 'P0001', message = format('TIXFAST: %s va con la suscripción. Actívala en Ajustes › Tu cuenta.', nombre);
  end if;
  mejor := public.ticket_plan_mejora(a.plan_id, f, null, null);
  plan_txt := case when mejor is not null then format(' Pásate a %s en Ajustes › Tu cuenta.', mejor) else '' end;
  raise exception using errcode = 'P0001', message = format('TIXFAST: %s no va incluido en tu plan %s.%s', nombre, a.plan_nombre, plan_txt);
end $$;
revoke all on function public.ticket_funcion_permitida() from public, anon, authenticated;

-- Activar la reserva online de un evento necesita esa función en el plan
drop trigger if exists ticket_plan_ticket_reservas_web on public.ticket_reservas_web;
create trigger ticket_plan_ticket_reservas_web before insert on public.ticket_reservas_web
  for each row execute function public.ticket_funcion_permitida('reserva_online');

-- ---------- Límites (cuántos) ----------
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
    select count(*) into n from public.ticket_eventos e where e.owner_id = new.owner_id and not coalesce(e.cerrada, false) and coalesce(e.fecha, current_date) >= current_date - 1;
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
revoke all on function public.ticket_limite_plan() from public, anon, authenticated;

drop trigger if exists ticket_limite_puntos on public.ticket_puntos;
create trigger ticket_limite_puntos before insert on public.ticket_puntos for each row execute function public.ticket_limite_plan('barras_por_evento');
drop trigger if exists ticket_limite_eventos on public.ticket_eventos;
create trigger ticket_limite_eventos before insert on public.ticket_eventos for each row execute function public.ticket_limite_plan('eventos');
drop trigger if exists ticket_limite_socios on public.ticket_crm_socios;
create trigger ticket_limite_socios before insert on public.ticket_crm_socios for each row execute function public.ticket_limite_plan('socios');
drop trigger if exists ticket_limite_facturas on public.ticket_fac_facturas;
create trigger ticket_limite_facturas before insert on public.ticket_fac_facturas for each row execute function public.ticket_limite_plan('facturas_mes');

-- Planos guardados: mismo aviso que el resto (sin nombres de plan fijos)
create or replace function public.ticket_planos_limite()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a record; lim int; n int; mejor text;
begin
  select * into a from public.ticket_acceso_de(new.owner_id);
  if not found then return new; end if;
  lim := nullif(a.limites ->> 'planos', '')::int;
  if lim is null then return new; end if;
  select count(*) into n from public.ticket_planos where owner_id = new.owner_id;
  if n >= lim then
    mejor := public.ticket_plan_mejora(a.plan_id, null, 'planos', lim);
    raise exception using errcode = 'P0001', message = case when lim = 0 and a.plan_id = 'sin_suscripcion'
      then 'TIXFAST: guardar planos va con la suscripción.'
      else format('TIXFAST: tu plan %s permite guardar %s planos.%s Sustituye uno que ya tengas.', a.plan_nombre, lim,
        case when mejor is not null then format(' Pásate a %s para guardar más.', mejor) else '' end) end;
  end if;
  return new;
end $$;
revoke all on function public.ticket_planos_limite() from public, anon, authenticated;

-- ---------- Reserva online pública: necesita reservados y reserva online en el plan ----------
create or replace function public.reservas_publico(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare w record; e record; cfg jsonb; acc record; plano jsonb;
begin
  select * into w from public.ticket_reservas_web where token = p_token;
  if not found or not w.activo then return null; end if;
  select * into e from public.ticket_eventos where id = w.evento_id;
  if not found or coalesce(e.cerrada, false) then return null; end if;
  select * into acc from public.ticket_acceso_de(w.owner_id);
  if found and coalesce((acc.limites -> 'bloquea') ?| array['reservados', 'reserva_online'], false)
     and not (acc.plan_id = 'sin_suscripcion' and acc.fin_acceso is not null and e.creado_en <= acc.fin_acceso and coalesce(e.fecha, current_date) >= current_date - 1) then
    return null;
  end if;
  cfg := coalesce(e.ticket_style -> 'reservados', '{}'::jsonb);
  plano := case when jsonb_typeof(cfg -> 'plano') = 'object' then jsonb_build_object(
      'ancho', cfg -> 'plano' -> 'ancho', 'largo', cfg -> 'plano' -> 'largo',
      'elementos', coalesce((select jsonb_agg(jsonb_build_object('id', x -> 'id', 'tipo', x -> 'tipo', 'x', x -> 'x', 'y', x -> 'y', 'w', x -> 'w', 'h', x -> 'h',
          'rot', x -> 'rot', 'texto', x -> 'texto', 'forma', x -> 'forma', 'reservadoId', x -> 'reservadoId'))
        from jsonb_array_elements(coalesce(cfg -> 'plano' -> 'elementos', '[]')) x), '[]'::jsonb)) end;
  return jsonb_build_object(
    'ahora', now(),
    'evento', jsonb_build_object('nombre', e.nombre, 'fecha', e.fecha, 'inicio', e.inicio, 'recinto', e.recinto,
      'flyer', (select flyer_url from public.ticket_web_eventos where evento_id = e.id), 'logo', nullif(e.logo_url, '')),
    'online', jsonb_build_object('adelanto_pct', w.adelanto_pct, 'condiciones', w.condiciones, 'bebidas', w.bebidas, 'mezclas', w.mezclas, 'max_extra', w.max_extra,
      'pago', exists (select 1 from public.ticket_pago_cuentas c where c.user_id = w.owner_id and c.tipo = 'organizador' and c.estado = 'activa' and c.recibe) or w.adelanto_pct = 0),
    'plano', plano,
    'legal', public.web_legal_de(w.owner_id),
    'precio_extra', public.reservas_precio_extra(cfg),
    'tarifas', coalesce((select jsonb_agg(jsonb_build_object('id', t ->> 'id', 'nombre', t ->> 'nombre', 'precio', (t ->> 'precio')::numeric,
        'botellas', coalesce(nullif(t ->> 'botellas', '')::int, 0), 'incluye', t ->> 'incluye', 'emoji', t ->> 'emoji', 'tamano', coalesce(t ->> 'tamano', '')))
      from jsonb_array_elements(coalesce(cfg -> 'tarifas', '[]')) t
      where coalesce((t ->> 'online')::boolean, true) and nullif(t ->> 'precio', '') is not null), '[]'::jsonb),
    'mesas', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'nombre', r.nombre, 'tamano', r.tamano, 'personas', r.personas,
        'libre', r.estado = 'libre') order by r.orden, r.nombre)
      from public.ticket_reservados r where r.evento_id = e.id), '[]'::jsonb)
  );
end $$;

-- ---------- Planes que se pueden contratar (para la app) ----------
create or replace function public.ticket_planes_disponibles()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'descripcion', descripcion, 'precio_mes', precio_mes,
      'dias_prueba', dias_prueba, 'destacado', destacado, 'limites', limites) order by orden, precio_mes), '[]'::jsonb)
  from public.ticket_planes where publico and not archivado and not sistema and precio_mes is not null and precio_mes > 0;
$$;
revoke all on function public.ticket_planes_disponibles() from public, anon;
grant execute on function public.ticket_planes_disponibles() to authenticated;

-- ---------- Panel de administración ----------
drop function if exists public.admin_planes();
create function public.admin_planes()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.ticket_exigir_superadmin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre, 'descripcion', p.descripcion, 'precio_mes', p.precio_mes,
      'dias_prueba', p.dias_prueba, 'publico', p.publico, 'destacado', p.destacado, 'sistema', p.sistema, 'archivado', p.archivado, 'orden', p.orden,
      'limites', p.limites, 'stripe_product_id', p.stripe_product_id, 'stripe_price_id', p.stripe_price_id, 'stripe_price_importe', p.stripe_price_importe,
      'stripe_sincronizado_en', p.stripe_sincronizado_en,
      'cuentas', (select count(*) from public.ticket_cuentas c where c.plan_id = p.id and (p.id = 'fundador' or c.estado in ('activa', 'prueba', 'impagada', 'cortesia'))),
      'pagando', (select count(*) from public.ticket_cuentas c where c.plan_id = p.id and c.estado = 'activa' and c.suscripcion_pago_id is not null),
      'referencias', (select count(*) from public.ticket_cuentas c where c.plan_id = p.id))
    order by p.sistema desc, p.archivado, p.orden, p.precio_mes) from public.ticket_planes p), '[]'::jsonb);
end $$;
revoke all on function public.admin_planes() from public, anon;
grant execute on function public.admin_planes() to authenticated;

-- Crear o editar un plan. p = { id?, nombre, descripcion, precio_mes, dias_prueba, publico, destacado, orden,
--   incluye: ["tpv", …], limites: { "barras_por_evento": 3, "planos": null, … } }
create or replace function public.admin_plan_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cat jsonb := public.ticket_catalogo();
  v_id text := nullif(btrim(coalesce(p ->> 'id', '')), '');
  v_nombre text := btrim(coalesce(p ->> 'nombre', ''));
  v_desc text := nullif(btrim(coalesce(p ->> 'descripcion', '')), '');
  v_precio numeric := round(nullif(p ->> 'precio_mes', '')::numeric, 2);
  v_dias int := coalesce(nullif(p ->> 'dias_prueba', '')::int, 7);
  v_publico boolean := coalesce((p ->> 'publico')::boolean, false);
  v_destacado boolean := coalesce((p ->> 'destacado')::boolean, false);
  v_orden int := nullif(p ->> 'orden', '')::int;
  v_lim jsonb := '{}'::jsonb; v_bloquea jsonb; k text; n int; antes jsonb; base text; i int := 1; nuevo boolean;
  minimos jsonb := '{"eventos": 1, "barras_por_evento": 1, "planos": 0, "socios": 0, "facturas_mes": 0}';
begin
  perform public.ticket_exigir_superadmin();
  if length(v_nombre) < 2 or length(v_nombre) > 40 then raise exception using errcode = 'P0001', message = 'TIXFAST: el nombre debe tener entre 2 y 40 letras.'; end if;
  if v_precio is not null and (v_precio <= 0 or v_precio > 10000) then raise exception using errcode = 'P0001', message = 'TIXFAST: precio no válido.'; end if;
  if v_dias < 0 or v_dias > 60 then raise exception using errcode = 'P0001', message = 'TIXFAST: los días de prueba van de 0 a 60.'; end if;
  -- Permisos: funciones incluidas → lista «bloquea» con las que no; límites del catálogo, enteros o sin límite
  if jsonb_typeof(coalesce(p -> 'incluye', '[]')) <> 'array' then raise exception 'incluye no válido'; end if;
  if exists (select 1 from jsonb_array_elements_text(coalesce(p -> 'incluye', '[]')) x where not (cat -> 'funciones' ? x)) then
    raise exception using errcode = 'P0001', message = 'TIXFAST: hay una función que no existe.'; end if;
  select coalesce(jsonb_agg(f order by f), '[]'::jsonb) into v_bloquea from jsonb_object_keys(cat -> 'funciones') f
    where not coalesce(p -> 'incluye', '[]') ? f;
  for k in select jsonb_object_keys(coalesce(p -> 'limites', '{}')) loop
    if not (cat -> 'limites' ? k) then raise exception using errcode = 'P0001', message = format('TIXFAST: el límite «%s» no existe.', k); end if;
    if jsonb_typeof(p -> 'limites' -> k) = 'null' or (p -> 'limites' ->> k) = '' then continue; end if;
    n := (p -> 'limites' ->> k)::int;
    if n < (minimos ->> k)::int or n > 10000 then raise exception using errcode = 'P0001', message = format('TIXFAST: el límite de %s debe ser como mínimo %s.', cat -> 'limites' ->> k, minimos ->> k); end if;
    v_lim := v_lim || jsonb_build_object(k, n);
  end loop;
  v_lim := v_lim || jsonb_build_object('bloquea', v_bloquea);

  nuevo := v_id is null;
  if nuevo then
    -- Identificador a partir del nombre (no cambia nunca: Stripe y las cuentas lo usan)
    base := left(trim(both '_' from regexp_replace(lower(translate(v_nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '[^a-z0-9]+', '_', 'g')), 24);
    if length(base) < 2 then base := 'plan'; end if;
    v_id := base;
    while exists (select 1 from public.ticket_planes where id = v_id) loop i := i + 1; v_id := base || '_' || i; end loop;
  else
    select to_jsonb(x) - 'creado_en' into antes from public.ticket_planes x where id = v_id;
    if antes is null then raise exception using errcode = 'P0001', message = 'TIXFAST: ese plan no existe.'; end if;
    if v_id = 'fundador' then raise exception using errcode = 'P0001', message = 'TIXFAST: el plan Fundador no se cambia: siempre lo incluye todo y sin cuota.'; end if;
  end if;
  if v_id = 'sin_suscripcion' then v_precio := 0; v_publico := false; v_destacado := false; v_dias := 0; end if;
  if v_publico and v_precio is null then raise exception using errcode = 'P0001', message = 'TIXFAST: ponle precio antes de dejar que se pueda contratar.'; end if;
  if v_publico and not exists (select 1 from jsonb_array_elements_text(coalesce(p -> 'incluye', '[]'))) then
    raise exception using errcode = 'P0001', message = 'TIXFAST: un plan de pago tiene que incluir al menos una función.'; end if;
  if v_destacado then update public.ticket_planes set destacado = false where id <> v_id and destacado; end if;

  if nuevo then
    insert into public.ticket_planes (id, nombre, descripcion, precio_mes, dias_prueba, publico, destacado, orden, limites)
    values (v_id, v_nombre, v_desc, v_precio, v_dias, v_publico, v_destacado,
      coalesce(v_orden, (select coalesce(max(orden), 0) + 1 from public.ticket_planes)), v_lim);
  else
    update public.ticket_planes set nombre = v_nombre, descripcion = v_desc, precio_mes = v_precio, dias_prueba = v_dias,
      publico = v_publico and not archivado, destacado = v_destacado, orden = coalesce(v_orden, orden), limites = v_lim, actualizado_en = now()
    where id = v_id;
  end if;
  insert into public.ticket_admin_registro (admin_id, accion, detalle)
    values ((select auth.uid()), case when nuevo then 'plan_nuevo' else 'plan_editar' end,
      jsonb_build_object('plan', v_id, 'nombre', v_nombre, 'antes', antes - 'stripe_price_id' - 'stripe_product_id',
        'ahora', jsonb_build_object('precio_mes', v_precio, 'publico', v_publico, 'dias_prueba', v_dias, 'limites', v_lim)));
  return jsonb_build_object('ok', true, 'id', v_id,
    'stripe', v_precio is not null and v_id <> 'sin_suscripcion');   -- hay que crear/actualizar el precio en Stripe
end $$;
revoke all on function public.admin_plan_guardar(jsonb) from public, anon;
grant execute on function public.admin_plan_guardar(jsonb) to authenticated;

-- Borrar un plan: si alguna cuenta lo tiene (o lo tuvo), se archiva (nadie nuevo puede contratarlo;
-- quien lo tiene lo conserva). Archivado se puede recuperar.
create or replace function public.admin_plan_archivar(p_plan text, p_archivar boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pl record; refs int;
begin
  perform public.ticket_exigir_superadmin();
  select * into pl from public.ticket_planes where id = p_plan;
  if not found then raise exception using errcode = 'P0001', message = 'TIXFAST: ese plan no existe.'; end if;
  if pl.sistema then raise exception using errcode = 'P0001', message = 'TIXFAST: los planes del sistema no se pueden borrar.'; end if;
  if not p_archivar then
    update public.ticket_planes set archivado = false, actualizado_en = now() where id = p_plan;
    insert into public.ticket_admin_registro (admin_id, accion, detalle) values ((select auth.uid()), 'plan_recuperar', jsonb_build_object('plan', p_plan, 'nombre', pl.nombre));
    return jsonb_build_object('ok', true, 'resultado', 'recuperado');
  end if;
  select count(*) into refs from public.ticket_cuentas where plan_id = p_plan;
  if refs = 0 and pl.stripe_price_id is null then
    delete from public.ticket_planes where id = p_plan;
    insert into public.ticket_admin_registro (admin_id, accion, detalle) values ((select auth.uid()), 'plan_borrar', jsonb_build_object('plan', p_plan, 'nombre', pl.nombre));
    return jsonb_build_object('ok', true, 'resultado', 'borrado');
  end if;
  update public.ticket_planes set archivado = true, publico = false, destacado = false, actualizado_en = now() where id = p_plan;
  insert into public.ticket_admin_registro (admin_id, accion, detalle) values ((select auth.uid()), 'plan_archivar', jsonb_build_object('plan', p_plan, 'nombre', pl.nombre, 'cuentas', refs));
  return jsonb_build_object('ok', true, 'resultado', 'archivado', 'cuentas', refs);
end $$;
revoke all on function public.admin_plan_archivar(text, boolean) from public, anon;
grant execute on function public.admin_plan_archivar(text, boolean) to authenticated;

-- Versión anterior (precio y visibilidad): sigue funcionando con cualquier plan que no sea del sistema
create or replace function public.admin_plan(p_plan text, p_precio numeric, p_publico boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare antes jsonb;
begin
  perform public.ticket_exigir_superadmin();
  if not exists (select 1 from public.ticket_planes where id = p_plan and not sistema) then raise exception 'Plan no válido'; end if;
  if p_precio is not null and (p_precio <= 0 or p_precio > 10000) then raise exception 'Importe no válido'; end if;
  if p_precio is null and coalesce(p_publico, false) then raise exception 'Hace falta un precio para poder contratarlo'; end if;
  select jsonb_build_object('precio', precio_mes, 'publico', publico) into antes from public.ticket_planes where id = p_plan;
  update public.ticket_planes set precio_mes = round(p_precio, 2), publico = coalesce(p_publico, publico) and not archivado, actualizado_en = now() where id = p_plan;
  insert into public.ticket_admin_registro (admin_id, accion, detalle)
    values ((select auth.uid()), 'precio', jsonb_build_object('plan', p_plan, 'antes', antes -> 'precio', 'ahora', round(p_precio, 2), 'publico', p_publico));
  return jsonb_build_object('ok', true);
end $$;

-- Cambiar la suscripción a mano, ahora eligiendo el plan (regalar un plan concreto)
drop function if exists public.admin_cuenta_cambiar(uuid, text, timestamptz, text);
create or replace function public.admin_cuenta_cambiar(p_owner uuid, p_accion text, p_hasta timestamptz default null, p_nota text default null, p_plan text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare antes jsonb; v_plan text; actual text;
begin
  perform public.ticket_exigir_superadmin();
  if p_accion not in ('cortesia', 'fundador', 'quitar') then raise exception 'Acción no válida'; end if;
  insert into public.ticket_cuentas (owner_id) values (p_owner) on conflict (owner_id) do nothing;
  select to_jsonb(c) - 'cliente_pago_id' - 'suscripcion_pago_id', c.plan_id into antes, actual from public.ticket_cuentas c where c.owner_id = p_owner;
  if p_plan is not null and not exists (select 1 from public.ticket_planes where id = p_plan and not sistema) then
    raise exception using errcode = 'P0001', message = 'TIXFAST: ese plan no se puede asignar.'; end if;
  v_plan := coalesce(p_plan, case when actual in ('fundador', 'sin_suscripcion') then public.ticket_plan_por_defecto() else actual end);
  if p_accion = 'cortesia' then
    update public.ticket_cuentas set plan_id = v_plan, estado = 'cortesia', periodo_fin = p_hasta, cancela_al_final = false, actualizada_en = now() where owner_id = p_owner;
  elsif p_accion = 'fundador' then
    update public.ticket_cuentas set plan_id = 'fundador', estado = 'activa', periodo_fin = null, cancela_al_final = false, actualizada_en = now() where owner_id = p_owner;
  else
    update public.ticket_cuentas set plan_id = v_plan, estado = 'cancelada', periodo_fin = now(), cancela_al_final = false, actualizada_en = now() where owner_id = p_owner;
  end if;
  insert into public.ticket_admin_registro (admin_id, cuenta_id, accion, detalle)
    values ((select auth.uid()), p_owner, p_accion, jsonb_build_object('hasta', p_hasta, 'nota', left(p_nota, 300), 'plan', case when p_accion = 'cortesia' then v_plan end, 'antes', antes));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_cuenta_cambiar(uuid, text, timestamptz, text, text) from public, anon;
grant execute on function public.admin_cuenta_cambiar(uuid, text, timestamptz, text, text) to authenticated;

-- Resumen: «precio» pasa a ser el precio desde (el plan contratable más barato)
create or replace function public.admin_resumen()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform public.ticket_exigir_superadmin();
  select jsonb_build_object(
    'registrados', (select count(*) from auth.users),
    'altas_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'altas_30d', (select count(*) from auth.users where created_at > now() - interval '30 days'),
    'activos_7d', (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
    'por_estado', coalesce((select jsonb_object_agg(k, n) from (
        select case when plan_id = 'fundador' then 'fundador' else estado end k, count(*) n from public.ticket_cuentas group by 1) x), '{}'::jsonb),
    'pagando', (select count(*) from public.ticket_cuentas where estado = 'activa' and plan_id <> 'fundador' and suscripcion_pago_id is not null),
    'ingreso_mensual', coalesce((select sum(p.precio_mes) from public.ticket_cuentas c join public.ticket_planes p on p.id = c.plan_id
        where c.estado = 'activa' and c.plan_id <> 'fundador' and c.suscripcion_pago_id is not null), 0),
    'por_plan', coalesce((select jsonb_object_agg(p.nombre, x.n) from (select plan_id, count(*) n from public.ticket_cuentas
        where estado in ('activa', 'prueba', 'impagada', 'cortesia') and plan_id <> 'fundador' group by 1) x join public.ticket_planes p on p.id = x.plan_id), '{}'::jsonb),
    'cancelan_al_final', (select count(*) from public.ticket_cuentas where cancela_al_final and estado in ('activa', 'prueba')),
    'precio', (select min(precio_mes) from public.ticket_planes where publico and not archivado and not sistema and precio_mes > 0),
    'errores_24h', (select count(*) from public.ticket_errores where creado_en > now() - interval '24 hours'),
    'errores_7d', (select count(*) from public.ticket_errores where creado_en > now() - interval '7 days'),
    'eventos', (select count(*) from public.ticket_eventos),
    'ventas_30d', (select count(*) from public.ticket_ventas where creado_en > now() - interval '30 days')
  ) into r;
  return r;
end $$;
revoke all on function public.admin_resumen() from public, anon;
grant execute on function public.admin_resumen() to authenticated;

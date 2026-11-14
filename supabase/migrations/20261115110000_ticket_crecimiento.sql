-- =====================================================================
-- TIXFAST · CRECIMIENTO Y RETENCIÓN AUTOMÁTICOS
-- ---------------------------------------------------------------------
-- · Correos automáticos según el momento de cada cuenta (bienvenida, prueba, impago,
--   cancelación, recuperación, inactividad). Cada correo se envía UNA sola vez (ticket_correos).
-- · Los correos comerciales respetan la baja (correos_promo); los de servicio (prueba que acaba,
--   impago) se envían siempre, como exige cualquier cobro recurrente.
-- · Motivos de baja y ofertas (descuento, pausa) quedan registrados en ticket_bajas.
-- · Todo se configura desde el panel de administración (ticket_crecimiento_config).
-- =====================================================================

alter table public.ticket_cuentas add column if not exists estado_desde timestamptz not null default now();
alter table public.ticket_cuentas add column if not exists correos_promo boolean not null default true;
alter table public.ticket_cuentas add column if not exists baja_token uuid not null default gen_random_uuid();
alter table public.ticket_cuentas add column if not exists oferta_retencion_usada boolean not null default false;
alter table public.ticket_cuentas add column if not exists oferta_recuperar_usada boolean not null default false;
create unique index if not exists ticket_cuentas_baja_token on public.ticket_cuentas (baja_token);

-- Cuándo cambió de estado (para saber cuántos días lleva en impago, cancelada…)
create or replace function public.ticket_cuentas_estado_desde()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.estado is distinct from old.estado then new.estado_desde := now(); end if;
  return new;
end $$;
drop trigger if exists ticket_cuentas_estado_desde on public.ticket_cuentas;
create trigger ticket_cuentas_estado_desde before update on public.ticket_cuentas for each row execute function public.ticket_cuentas_estado_desde();

-- Fin real del acceso contado desde que cambió el estado (sirve para la regla «una noche nunca se corta»):
-- impago → 7 días desde el primer fallo; pausada o cancelada → el día en que pasó.
create or replace function public.ticket_acceso_de(p_owner uuid)
returns table (plan_id text, plan_nombre text, estado text, limites jsonb, en_prueba boolean, fin_acceso timestamptz)
language sql stable security definer set search_path = '' as $$
  with c as (
    select c.*,
      case
        when c.estado = 'activa' then true
        when c.estado = 'cortesia' then c.periodo_fin is null or c.periodo_fin > now()
        when c.estado = 'prueba' then coalesce(c.prueba_hasta + interval '1 day' > now(), false)
        when c.estado = 'impagada' then c.estado_desde + interval '7 days' > now()
        else false
      end as con_acceso,
      case
        when c.estado = 'prueba' then c.prueba_hasta
        when c.estado = 'cortesia' then c.periodo_fin
        when c.estado = 'impagada' then c.estado_desde + interval '7 days'
        when c.estado in ('suspendida', 'cancelada') then c.estado_desde
      end as fin
    from public.ticket_cuentas c where c.owner_id = p_owner
  )
  select p.id, p.nombre, c.estado, p.limites, (c.estado = 'prueba' and c.con_acceso), c.fin
  from c join public.ticket_planes p on p.id = case when c.con_acceso then c.plan_id else 'sin_suscripcion' end;
$$;
revoke all on function public.ticket_acceso_de(uuid) from public, anon, authenticated;

create table if not exists public.ticket_crecimiento_config (
  id smallint primary key default 1 check (id = 1),
  ajustes jsonb not null,
  actualizado_en timestamptz not null default now()
);
alter table public.ticket_crecimiento_config enable row level security;
revoke all on public.ticket_crecimiento_config from anon, authenticated;
insert into public.ticket_crecimiento_config (id, ajustes) values (1, '{
  "secuencias": {
    "bienvenida":      {"activo": true},
    "sin_prueba":      {"activo": true, "dias": [2, 6]},
    "prueba_consejos": {"activo": true},
    "prueba_acaba":    {"activo": true, "dias_antes": 2},
    "impago":          {"activo": true, "dias": [0, 3, 6]},
    "cancela":         {"activo": true},
    "recuperar":       {"activo": true, "dias": [7, 30]},
    "inactivo":        {"activo": true, "dias": 14}
  },
  "oferta_retencion": {"descuento": 50, "meses": 3},
  "oferta_recuperar": {"descuento": 30, "meses": 2},
  "pausa_max_meses": 3
}'::jsonb) on conflict (id) do nothing;

create table if not exists public.ticket_correos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  email text,
  tipo text not null,
  clave text not null,
  asunto text,
  estado text not null default 'enviando' check (estado in ('enviando', 'enviado', 'error')),
  error text,
  creado_en timestamptz not null default now()
);
create unique index if not exists ticket_correos_unico on public.ticket_correos (owner_id, tipo, clave);
create index if not exists ticket_correos_fecha on public.ticket_correos (creado_en desc);
alter table public.ticket_correos enable row level security;
revoke all on public.ticket_correos from anon, authenticated;

create table if not exists public.ticket_bajas (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  motivo text not null check (motivo in ('caro', 'temporada', 'falta', 'no_uso', 'otro')),
  comentario text check (comentario is null or length(comentario) <= 500),
  resultado text not null check (resultado in ('descuento', 'pausa', 'cancela')),
  creado_en timestamptz not null default now()
);
create index if not exists ticket_bajas_fecha on public.ticket_bajas (creado_en desc);
alter table public.ticket_bajas enable row level security;
revoke all on public.ticket_bajas from anon, authenticated;

-- ---------- Quién debe recibir qué correo ahora (solo el servidor) ----------
create or replace function public.crecimiento_candidatos()
returns table (owner_id uuid, email text, tipo text, clave text, datos jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := (select ajustes -> 'secuencias' from public.ticket_crecimiento_config where id = 1);
begin
  -- Base: cuentas de pago (no Fundador), con correo confirmado y sin bloquear
  return query
  with b as (
    select c.*, u.email::text em, u.created_at alta, u.last_sign_in_at ult
    from public.ticket_cuentas c join auth.users u on u.id = c.owner_id
    where c.plan_id <> 'fundador' and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until < now())
  )
  -- Bienvenida: recién registrada, sin suscripción
  select b.owner_id, b.em, 'bienvenida', 'unica', '{}'::jsonb from b
    where coalesce((s -> 'bienvenida' ->> 'activo')::boolean, false) and b.estado = 'pendiente' and b.correos_promo and b.alta > now() - interval '2 days'
  union all
  -- Aún no ha empezado la prueba
  select b.owner_id, b.em, 'sin_prueba', 'd' || dd, jsonb_build_object('dia', dd) from b,
    lateral (select jsonb_array_elements_text(coalesce(s -> 'sin_prueba' -> 'dias', '[]'))::int dd) x
    where coalesce((s -> 'sin_prueba' ->> 'activo')::boolean, false) and b.estado = 'pendiente' and not b.prueba_usada and b.correos_promo
      and b.alta between now() - make_interval(days => dd + 1) and now() - make_interval(days => dd)
  union all
  -- Primer día de prueba: consejos para sacarle partido
  select b.owner_id, b.em, 'prueba_consejos', b.estado_desde::date::text, '{}'::jsonb from b
    where coalesce((s -> 'prueba_consejos' ->> 'activo')::boolean, false) and b.estado = 'prueba' and b.estado_desde between now() - interval '2 days' and now() - interval '1 day'
  union all
  -- La prueba acaba pronto (aviso de servicio: se va a cobrar)
  select b.owner_id, b.em, 'prueba_acaba', b.prueba_hasta::date::text, jsonb_build_object('prueba_hasta', b.prueba_hasta) from b
    where coalesce((s -> 'prueba_acaba' ->> 'activo')::boolean, false) and b.estado = 'prueba' and not b.cancela_al_final
      and b.prueba_hasta between now() + make_interval(days => greatest(coalesce((s -> 'prueba_acaba' ->> 'dias_antes')::int, 2) - 1, 0)) and now() + make_interval(days => coalesce((s -> 'prueba_acaba' ->> 'dias_antes')::int, 2))
  union all
  -- Impago (aviso de servicio)
  select b.owner_id, b.em, 'impago', b.estado_desde::date::text || '-d' || dd, jsonb_build_object('dia', dd, 'ultimo', dd = (select max(v::int) from jsonb_array_elements_text(coalesce(s -> 'impago' -> 'dias', '[]')) v)) from b,
    lateral (select jsonb_array_elements_text(coalesce(s -> 'impago' -> 'dias', '[]'))::int dd) x
    where coalesce((s -> 'impago' ->> 'activo')::boolean, false) and b.estado = 'impagada'
      and b.estado_desde between now() - make_interval(days => dd + 1) and now() - make_interval(days => dd)
  union all
  -- Ha pedido cancelar: oferta para quedarse (una vez)
  select b.owner_id, b.em, 'cancela', coalesce(b.periodo_fin, b.prueba_hasta)::date::text, jsonb_build_object('fin', coalesce(b.periodo_fin, b.prueba_hasta)) from b
    where coalesce((s -> 'cancela' ->> 'activo')::boolean, false) and b.cancela_al_final and b.estado in ('activa', 'prueba') and b.correos_promo and not b.oferta_retencion_usada
  union all
  -- Se fue: oferta para volver
  select b.owner_id, b.em, 'recuperar', b.estado_desde::date::text || '-d' || dd, jsonb_build_object('dia', dd) from b,
    lateral (select jsonb_array_elements_text(coalesce(s -> 'recuperar' -> 'dias', '[]'))::int dd) x
    where coalesce((s -> 'recuperar' ->> 'activo')::boolean, false) and b.estado = 'cancelada' and b.prueba_usada and b.correos_promo and not b.oferta_recuperar_usada
      and b.estado_desde between now() - make_interval(days => dd + 1) and now() - make_interval(days => dd)
  union all
  -- Paga pero no entra: ayuda (como mucho una vez al mes)
  select b.owner_id, b.em, 'inactivo', to_char(now(), 'YYYY-MM'), jsonb_build_object('dias', coalesce((s -> 'inactivo' ->> 'dias')::int, 14)) from b
    where coalesce((s -> 'inactivo' ->> 'activo')::boolean, false) and b.estado in ('activa', 'prueba', 'cortesia') and b.correos_promo
      and coalesce(b.ult, b.alta) < now() - make_interval(days => coalesce((s -> 'inactivo' ->> 'dias')::int, 14));
end $$;
revoke all on function public.crecimiento_candidatos() from public, anon, authenticated;
grant execute on function public.crecimiento_candidatos() to service_role;

-- Destinatarios de una campaña manual (respeta la baja de correos comerciales)
create or replace function public.crecimiento_segmento(p_segmento text)
returns table (owner_id uuid, email text, baja_token uuid)
language sql stable security definer set search_path = '' as $$
  select c.owner_id, u.email::text, c.baja_token
  from public.ticket_cuentas c join auth.users u on u.id = c.owner_id
  where c.correos_promo and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until < now())
    and case p_segmento
      when 'todas' then true
      when 'sin_suscripcion' then c.plan_id <> 'fundador' and c.estado in ('pendiente', 'cancelada', 'suspendida')
      when 'nunca_probaron' then c.plan_id <> 'fundador' and c.estado = 'pendiente' and not c.prueba_usada
      when 'clientes' then c.plan_id = 'fundador' or c.estado in ('activa', 'prueba', 'cortesia')
      when 'canceladas' then c.estado = 'cancelada'
      else false end;
$$;
revoke all on function public.crecimiento_segmento(text) from public, anon, authenticated;
grant execute on function public.crecimiento_segmento(text) to service_role;

-- Ofertas visibles para quien está dentro (descuentos y pausa), sin exponer el resto de ajustes
create or replace function public.ticket_ofertas()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'retencion', case when c.oferta_retencion_usada then null else a.ajustes -> 'oferta_retencion' end,
    'recuperar', case when c.oferta_recuperar_usada then null else a.ajustes -> 'oferta_recuperar' end,
    'pausa_max_meses', a.ajustes -> 'pausa_max_meses')
  from public.ticket_crecimiento_config a, public.ticket_cuentas c where a.id = 1 and c.owner_id = (select auth.uid());
$$;
revoke all on function public.ticket_ofertas() from public, anon;
grant execute on function public.ticket_ofertas() to authenticated;

-- ---------- Panel: crecimiento ----------
create or replace function public.admin_crecimiento()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare precio numeric := (select precio_mes from public.ticket_planes where id = 'pro');
begin
  perform public.ticket_exigir_superadmin();
  return jsonb_build_object(
    'config', (select ajustes from public.ticket_crecimiento_config where id = 1),
    'kpi', jsonb_build_object(
      'precio', precio,
      'pagando', (select count(*) from public.ticket_cuentas where estado = 'activa' and plan_id <> 'fundador' and suscripcion_pago_id is not null),
      'pruebas_30d', (select count(*) from public.ticket_cuentas where prueba_usada and creada_en > now() - interval '30 days'),
      'convertidas_30d', (select count(*) from public.ticket_cuentas where prueba_usada and estado = 'activa' and creada_en > now() - interval '30 days'),
      'registros_30d', (select count(*) from auth.users where created_at > now() - interval '30 days'),
      'cancelaciones_30d', (select count(*) from public.ticket_cuentas where estado = 'cancelada' and estado_desde > now() - interval '30 days'),
      'rescatadas_30d', (select count(*) from public.ticket_bajas where resultado in ('descuento', 'pausa') and creado_en > now() - interval '30 days'),
      'impago_importe', (select count(*) * coalesce(precio, 0) from public.ticket_cuentas where estado = 'impagada'),
      'correos_30d', (select count(*) from public.ticket_correos where estado = 'enviado' and creado_en > now() - interval '30 days'),
      'sin_correos_promo', (select count(*) from public.ticket_cuentas where not correos_promo)),
    'riesgo', coalesce((select jsonb_agg(r order by r.prioridad, r.fecha) from (
        select c.owner_id, u.email, case
            when c.estado = 'impagada' then 'impago'
            when c.cancela_al_final and c.estado in ('activa', 'prueba') then 'cancela'
            when c.estado = 'prueba' and c.prueba_hasta < now() + interval '2 days' then 'prueba_acaba'
            else 'inactivo' end motivo,
          case when c.estado = 'impagada' then 1 when c.cancela_al_final then 2 when c.estado = 'prueba' then 3 else 4 end prioridad,
          c.estado, c.estado_desde fecha, c.prueba_hasta, c.periodo_fin, u.last_sign_in_at ultimo_acceso, c.suscripcion_pago_id is not null con_stripe, c.oferta_retencion_usada
        from public.ticket_cuentas c join auth.users u on u.id = c.owner_id
        where c.plan_id <> 'fundador' and (c.estado = 'impagada'
          or (c.cancela_al_final and c.estado in ('activa', 'prueba'))
          or (c.estado = 'prueba' and c.prueba_hasta < now() + interval '2 days')
          or (c.estado in ('activa', 'prueba', 'cortesia') and coalesce(u.last_sign_in_at, u.created_at) < now() - interval '14 days'))
        limit 200) r), '[]'::jsonb),
    'motivos', coalesce((select jsonb_object_agg(motivo, n) from (select motivo, count(*) n from public.ticket_bajas where creado_en > now() - interval '90 days' group by 1) m), '{}'::jsonb),
    'resultados', coalesce((select jsonb_object_agg(resultado, n) from (select resultado, count(*) n from public.ticket_bajas where creado_en > now() - interval '90 days' group by 1) m), '{}'::jsonb),
    'comentarios', coalesce((select jsonb_agg(jsonb_build_object('fecha', b.creado_en, 'motivo', b.motivo, 'comentario', b.comentario, 'resultado', b.resultado, 'email', u.email) order by b.creado_en desc)
      from (select * from public.ticket_bajas where comentario is not null and comentario <> '' order by creado_en desc limit 30) b left join auth.users u on u.id = b.owner_id), '[]'::jsonb),
    'correos', coalesce((select jsonb_agg(jsonb_build_object('fecha', x.creado_en, 'tipo', x.tipo, 'email', x.email, 'asunto', x.asunto, 'estado', x.estado, 'error', x.error) order by x.creado_en desc)
      from (select * from public.ticket_correos order by creado_en desc limit 100) x), '[]'::jsonb)
  );
end $$;
revoke all on function public.admin_crecimiento() from public, anon;
grant execute on function public.admin_crecimiento() to authenticated;

create or replace function public.admin_crecimiento_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  perform public.ticket_exigir_superadmin();
  if jsonb_typeof(p) <> 'object' or jsonb_typeof(p -> 'secuencias') <> 'object' then raise exception 'Ajustes no válidos'; end if;
  for k in select jsonb_object_keys(p -> 'secuencias') loop
    if k not in ('bienvenida', 'sin_prueba', 'prueba_consejos', 'prueba_acaba', 'impago', 'cancela', 'recuperar', 'inactivo') then raise exception 'Secuencia desconocida: %', k; end if;
  end loop;
  if coalesce((p -> 'oferta_retencion' ->> 'descuento')::int, 0) not between 0 and 100 or coalesce((p -> 'oferta_recuperar' ->> 'descuento')::int, 0) not between 0 and 100 then raise exception 'Descuento no válido'; end if;
  if coalesce((p -> 'oferta_retencion' ->> 'meses')::int, 1) not between 1 and 12 or coalesce((p -> 'oferta_recuperar' ->> 'meses')::int, 1) not between 1 and 12 then raise exception 'Meses no válidos'; end if;
  if coalesce((p ->> 'pausa_max_meses')::int, 3) not between 1 and 6 then raise exception 'Pausa no válida'; end if;
  update public.ticket_crecimiento_config set ajustes = p, actualizado_en = now() where id = 1;
  insert into public.ticket_admin_registro (admin_id, accion, detalle) values ((select auth.uid()), 'crecimiento_ajustes', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_crecimiento_guardar(jsonb) from public, anon;
grant execute on function public.admin_crecimiento_guardar(jsonb) to authenticated;

-- ---------- Tarea programada: cada hora se revisan los correos pendientes ----------
-- Usa la misma clave de tareas programadas que los repartos de la ticketera (ticket_pago_config.cron_clave).
do $c$
begin
  if exists (select 1 from cron.job where jobname = 'tixfast-crecimiento') then perform cron.unschedule('tixfast-crecimiento'); end if;
  perform cron.schedule('tixfast-crecimiento', '17 * * * *', $job$
    select net.http_post(
      url := 'https://xnhcquehlyalwgqmdiov.supabase.co/functions/v1/crecimiento',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('accion', 'ejecutar', 'clave', (select valor from public.ticket_pago_config where clave = 'cron_clave'))
    );
  $job$);
end $c$;

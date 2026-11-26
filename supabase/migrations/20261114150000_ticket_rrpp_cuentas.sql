-- ===================== RRPP · cuentas propias (una cuenta, muchos organizadores) =====================
-- El RRPP se registra, rellena su perfil (con dónde cobra) y pide colaborar con un organizador
-- desde el enlace de captación de ese organizador. El organizador acepta o rechaza.
-- Con una sola cuenta ve todos los eventos con los que colabora, cada uno con su enlace, y un único monedero.
-- Solo añade: tablas y columnas nuevas; funciones nuevas o ampliadas.

-- ---------- Perfil del RRPP (uno por usuario) ----------
create table if not exists public.ticket_rrpp_perfiles (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  nombre text not null check (char_length(btrim(nombre)) between 2 and 40),              -- como le conocen («Nico»)
  nombre_completo text not null check (char_length(btrim(nombre_completo)) between 3 and 120),
  telefono text not null check (char_length(telefono) between 6 and 30),
  email text check (email is null or char_length(email) <= 160),
  ciudad text check (ciudad is null or char_length(ciudad) <= 80),
  instagram text check (instagram is null or char_length(instagram) <= 60),
  nif text check (nif is null or nif ~ '^[A-Z0-9]{8,12}$'),
  fiscal text not null default 'particular' check (fiscal in ('particular', 'autonomo', 'empresa')),
  cobro text not null default 'bizum' check (cobro in ('bizum', 'transferencia')),
  cobro_bizum text check (cobro_bizum is null or char_length(cobro_bizum) <= 30),
  cobro_iban text check (cobro_iban is null or cobro_iban ~ '^[A-Z]{2}[0-9A-Z]{13,32}$'),
  cobro_titular text check (cobro_titular is null or char_length(cobro_titular) <= 120),
  codigo text not null unique check (codigo ~ '^[A-Z0-9]{3,16}$'),                      -- su código de venta, el mismo con todos
  acepta_condiciones boolean not null default false,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- ---------- Colaboración RRPP ↔ organizador (la tabla ticket_rrpp de la fase 1) ----------
alter table public.ticket_rrpp add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.ticket_rrpp add column if not exists estado text not null default 'activa';
alter table public.ticket_rrpp add column if not exists mensaje text;
alter table public.ticket_rrpp add column if not exists solicitado_en timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ticket_rrpp_estado_check') then
    alter table public.ticket_rrpp add constraint ticket_rrpp_estado_check check (estado in ('solicitada', 'activa', 'rechazada', 'pausada'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ticket_rrpp_mensaje_check') then
    alter table public.ticket_rrpp add constraint ticket_rrpp_mensaje_check check (mensaje is null or char_length(mensaje) <= 300);
  end if;
end $$;
create unique index if not exists ticket_rrpp_owner_user_uq on public.ticket_rrpp (owner_id, user_id) where user_id is not null;
create index if not exists ticket_rrpp_user_idx on public.ticket_rrpp (user_id) where user_id is not null;

-- ---------- Enlace de captación del organizador ----------
create table if not exists public.ticket_rrpp_captacion (
  owner_id uuid primary key default auth.uid(),
  token uuid not null default gen_random_uuid() unique,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

-- ---------- Seguridad ----------
alter table public.ticket_rrpp_perfiles enable row level security;
alter table public.ticket_rrpp_captacion enable row level security;
drop policy if exists perfil_propio on public.ticket_rrpp_perfiles;
create policy perfil_propio on public.ticket_rrpp_perfiles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- El organizador ve el perfil (y dónde cobra) de quien le ha pedido colaborar o ya colabora con él
drop policy if exists perfil_organizador on public.ticket_rrpp_perfiles;
create policy perfil_organizador on public.ticket_rrpp_perfiles for select to authenticated
  using (exists (select 1 from public.ticket_rrpp r where r.user_id = ticket_rrpp_perfiles.user_id and r.owner_id = (select auth.uid()) and r.estado in ('solicitada', 'activa', 'pausada')));
drop policy if exists owner_all on public.ticket_rrpp_captacion;
create policy owner_all on public.ticket_rrpp_captacion for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
revoke all on public.ticket_rrpp_perfiles, public.ticket_rrpp_captacion from anon;
grant select, insert, update, delete on public.ticket_rrpp_perfiles, public.ticket_rrpp_captacion to authenticated;

-- Solo vende quien está aceptado
create or replace function public.rrpp_en_evento(p_rrpp uuid, p_evento uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.ticket_rrpp r where r.id = p_rrpp and r.activo and r.estado = 'activa'
    and coalesce((select e.activo from public.ticket_rrpp_eventos e where e.evento_id = p_evento and e.rrpp_id = r.id), r.todos_eventos))
$$;

-- ---------- Perfil: guardar (crea el código de venta la primera vez) ----------
create or replace function public.rrpp_guardar_perfil(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_cod text; v_base text; i int := 0; v_nif text; v_iban text; res record;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if btrim(coalesce(p ->> 'nombre', '')) = '' or char_length(btrim(p ->> 'nombre')) < 2 then return jsonb_build_object('ok', false, 'motivo', 'nombre'); end if;
  if char_length(btrim(coalesce(p ->> 'nombre_completo', ''))) < 3 then return jsonb_build_object('ok', false, 'motivo', 'nombre_completo'); end if;
  if char_length(regexp_replace(coalesce(p ->> 'telefono', ''), '\D', '', 'g')) < 9 then return jsonb_build_object('ok', false, 'motivo', 'telefono'); end if;
  v_nif := nullif(upper(regexp_replace(coalesce(p ->> 'nif', ''), '[^A-Za-z0-9]', '', 'g')), '');
  v_iban := nullif(upper(regexp_replace(coalesce(p ->> 'cobro_iban', ''), '[^A-Za-z0-9]', '', 'g')), '');
  if v_nif is not null and v_nif !~ '^[A-Z0-9]{8,12}$' then return jsonb_build_object('ok', false, 'motivo', 'nif'); end if;
  if v_iban is not null and v_iban !~ '^[A-Z]{2}[0-9A-Z]{13,32}$' then return jsonb_build_object('ok', false, 'motivo', 'iban'); end if;
  if coalesce(p ->> 'cobro', 'bizum') = 'transferencia' and v_iban is null then return jsonb_build_object('ok', false, 'motivo', 'iban'); end if;
  if coalesce((p ->> 'acepta_condiciones')::boolean, false) is not true then return jsonb_build_object('ok', false, 'motivo', 'condiciones'); end if;

  select codigo into v_cod from public.ticket_rrpp_perfiles where user_id = v_uid;
  if v_cod is null then
    v_base := left(upper(regexp_replace(translate(btrim(p ->> 'nombre'), 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^A-Za-z0-9]', '', 'g')), 8);
    if char_length(v_base) < 3 then v_base := rpad(v_base, 3, 'X'); end if;
    loop
      i := i + 1;
      v_cod := v_base || lpad((floor(random() * 90) + 10)::int::text, 2, '0');
      exit when not exists (select 1 from public.ticket_rrpp_perfiles where codigo = v_cod) and not exists (select 1 from public.ticket_rrpp where codigo = v_cod);
      if i > 30 then v_cod := v_base || upper(substr(encode(extensions.gen_random_bytes(3), 'hex'), 1, 4)); exit; end if;
    end loop;
  end if;

  insert into public.ticket_rrpp_perfiles as t (user_id, nombre, nombre_completo, telefono, email, ciudad, instagram, nif, fiscal, cobro, cobro_bizum, cobro_iban, cobro_titular, codigo, acepta_condiciones, actualizado_en)
  values (v_uid, left(btrim(p ->> 'nombre'), 40), left(btrim(p ->> 'nombre_completo'), 120), left(btrim(p ->> 'telefono'), 30),
          (select email from auth.users where id = v_uid), nullif(left(btrim(coalesce(p ->> 'ciudad', '')), 80), ''), nullif(left(btrim(coalesce(p ->> 'instagram', '')), 60), ''),
          v_nif, case when p ->> 'fiscal' in ('particular', 'autonomo', 'empresa') then p ->> 'fiscal' else 'particular' end,
          case when p ->> 'cobro' = 'transferencia' then 'transferencia' else 'bizum' end,
          nullif(left(btrim(coalesce(p ->> 'cobro_bizum', '')), 30), ''), v_iban, nullif(left(btrim(coalesce(p ->> 'cobro_titular', '')), 120), ''), v_cod, true, now())
  on conflict (user_id) do update set nombre = excluded.nombre, nombre_completo = excluded.nombre_completo, telefono = excluded.telefono, email = excluded.email,
     ciudad = excluded.ciudad, instagram = excluded.instagram, nif = excluded.nif, fiscal = excluded.fiscal, cobro = excluded.cobro, cobro_bizum = excluded.cobro_bizum,
     cobro_iban = excluded.cobro_iban, cobro_titular = excluded.cobro_titular, acepta_condiciones = true, actualizado_en = now()
  returning * into res;
  -- Su nombre y teléfono se copian a sus colaboraciones (el organizador los ve al día)
  update public.ticket_rrpp set nombre = res.nombre, telefono = res.telefono, actualizado_en = now() where user_id = v_uid;
  return jsonb_build_object('ok', true, 'perfil', to_jsonb(res));
end $$;
revoke all on function public.rrpp_guardar_perfil(jsonb) from public, anon;
grant execute on function public.rrpp_guardar_perfil(jsonb) to authenticated;

-- ---------- Enlace de captación: qué organizador es (público) ----------
create or replace function public.rrpp_captacion_info(p_token uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('organizador', coalesce((select o.nombre from public.ticket_web_organizaciones o where o.owner_id = c.owner_id order by o.creado_en limit 1),
                                                    (select l.razon_social from public.ticket_web_legal l where l.owner_id = c.owner_id), 'Organizador'),
         'logo', (select o.logo_url from public.ticket_web_organizaciones o where o.owner_id = c.owner_id order by o.creado_en limit 1),
         'eventos', (select count(*) from public.ticket_web_eventos w join public.ticket_eventos e on e.id = w.evento_id
                     where w.owner_id = c.owner_id and w.estado <> 'borrador' and (e.fecha is null or e.fecha >= current_date)))
  from public.ticket_rrpp_captacion c where c.token = p_token and c.activo
$$;
revoke all on function public.rrpp_captacion_info(uuid) from public;
grant execute on function public.rrpp_captacion_info(uuid) to anon, authenticated;

-- ---------- El RRPP pide colaborar ----------
create or replace function public.rrpp_solicitar(p_token uuid, p_mensaje text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); c record; pf record; r record;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  select * into c from public.ticket_rrpp_captacion where token = p_token and activo;
  if c.owner_id is null then return jsonb_build_object('ok', false, 'motivo', 'enlace'); end if;
  select * into pf from public.ticket_rrpp_perfiles where user_id = v_uid;
  if pf.user_id is null then return jsonb_build_object('ok', false, 'motivo', 'perfil'); end if;
  if c.owner_id = v_uid then return jsonb_build_object('ok', false, 'motivo', 'propio'); end if;
  select * into r from public.ticket_rrpp where owner_id = c.owner_id and user_id = v_uid;
  if r.id is not null and r.estado in ('activa', 'pausada') then return jsonb_build_object('ok', true, 'estado', r.estado); end if;
  if r.id is not null and r.estado = 'solicitada' then return jsonb_build_object('ok', true, 'estado', 'solicitada'); end if;
  if exists (select 1 from public.ticket_rrpp where owner_id = c.owner_id and codigo = pf.codigo and (user_id is distinct from v_uid)) then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_ocupado');
  end if;
  if r.id is not null then   -- rechazada antes: vuelve a pedirlo
    update public.ticket_rrpp set estado = 'solicitada', solicitado_en = now(), mensaje = nullif(left(btrim(coalesce(p_mensaje, '')), 300), ''),
           nombre = pf.nombre, telefono = pf.telefono, codigo = pf.codigo, actualizado_en = now() where id = r.id;
  else
    insert into public.ticket_rrpp (owner_id, user_id, nombre, telefono, codigo, estado, solicitado_en, mensaje)
    values (c.owner_id, v_uid, pf.nombre, pf.telefono, pf.codigo, 'solicitada', now(), nullif(left(btrim(coalesce(p_mensaje, '')), 300), ''));
  end if;
  return jsonb_build_object('ok', true, 'estado', 'solicitada');
end $$;
revoke all on function public.rrpp_solicitar(uuid, text) from public, anon;
grant execute on function public.rrpp_solicitar(uuid, text) to authenticated;

-- ---------- Eventos de una colaboración (lo usan los dos paneles) ----------
create or replace function public.rrpp_eventos_json(p_rrpp uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x ->> 'fecha'), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', e.id, 'rrpp', r.id, 'nombre', e.nombre, 'fecha', e.fecha, 'inicio', e.inicio, 'recinto', e.recinto,
      'slug', w.slug, 'estado', w.estado, 'modo', w.modo, 'edad_minima', w.edad_minima,
      'formulario', coalesce(w.formulario, '{}'::jsonb),
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
    where r.id = p_rrpp and w.estado <> 'borrador' and public.rrpp_en_evento(r.id, e.id)
      and (e.fecha is null or e.fecha >= current_date - 45
           or exists (select 1 from public.ticket_web_entradas x where x.evento_id = e.id and x.rrpp_id = r.id))
  ) q
$$;
revoke all on function public.rrpp_eventos_json(uuid) from public, anon, authenticated;

-- ---------- Panel del RRPP con cuenta: todos sus organizadores, eventos y un único monedero ----------
create or replace function public.rrpp_mi_panel()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); pf record; v_orgs jsonb; v_ventas jsonb; v_cobros jsonb;
begin
  if v_uid is null then return null; end if;
  select * into pf from public.ticket_rrpp_perfiles where user_id = v_uid;
  if pf.user_id is null then return jsonb_build_object('perfil', null); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'rrpp', r.id, 'estado', r.estado, 'solicitado_en', r.solicitado_en,
      'organizador', coalesce((select o.nombre from public.ticket_web_organizaciones o where o.owner_id = r.owner_id order by o.creado_en limit 1),
                              (select l.razon_social from public.ticket_web_legal l where l.owner_id = r.owner_id), 'Organizador'),
      'logo', (select o.logo_url from public.ticket_web_organizaciones o where o.owner_id = r.owner_id order by o.creado_en limit 1),
      'eventos', case when r.estado = 'activa' and r.activo then public.rrpp_eventos_json(r.id) else '[]'::jsonb end
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

-- El panel por enlace personal (RRPP sin cuenta) usa el mismo listado de eventos
create or replace function public.rrpp_panel(p_acceso uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r record; v_org text; v_ventas jsonb;
begin
  select * into r from public.ticket_rrpp where acceso = p_acceso and activo and estado = 'activa';
  if r.id is null then return null; end if;
  select coalesce((select o.nombre from public.ticket_web_organizaciones o where o.owner_id = r.owner_id order by o.creado_en limit 1),
                  (select l.razon_social from public.ticket_web_legal l where l.owner_id = r.owner_id), 'Organizador') into v_org;
  select coalesce(jsonb_agg(v order by v ->> 'creado_en' desc), '[]'::jsonb) into v_ventas from (
    select jsonb_build_object('creado_en', p.creado_en, 'evento', e.nombre, 'evento_id', p.evento_id,
           'comprador', split_part(btrim(p.nombre), ' ', 1) || coalesce(' ' || left(nullif(split_part(btrim(p.nombre), ' ', 2), ''), 1) || '.', ''),
           'entradas', (select count(*) from public.ticket_web_entradas x where x.pedido_id = p.id and x.estado = 'valida'),
           'efectivo', p.rrpp_efectivo, 'prueba', p.prueba, 'anulado', not exists (select 1 from public.ticket_web_entradas x where x.pedido_id = p.id and x.estado = 'valida'),
           'total', case when p.rrpp_efectivo then (select coalesce(sum(x.precio), 0) from public.ticket_web_entradas x where x.pedido_id = p.id and x.estado = 'valida') end,
           'acceso', case when p.rrpp_efectivo then p.acceso end,
           'anulable', p.rrpp_efectivo and p.creado_en > now() - interval '15 minutes') v
    from public.ticket_web_pedidos p join public.ticket_eventos e on e.id = p.evento_id
    where p.rrpp_id = r.id order by p.creado_en desc limit 60
  ) q;
  return jsonb_build_object('rrpp', jsonb_build_object('nombre', r.nombre, 'codigo', r.codigo), 'organizador', v_org,
                            'eventos', public.rrpp_eventos_json(r.id), 'ventas', v_ventas, 'ahora', now());
end $$;

-- ---------- Vender en efectivo y anular: comunes a los dos accesos ----------
create or replace function public.rrpp_vender_interno(p_rrpp uuid, p_slug text, p_items jsonb, p_comprador jsonb, p_asistentes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; f record; v_cfg record; v_rec int; v_email text; v_real boolean; res jsonb;
begin
  select * into r from public.ticket_rrpp where id = p_rrpp and activo and estado = 'activa';
  if r.id is null then return jsonb_build_object('ok', false, 'motivo', 'rrpp'); end if;
  select * into f from public.ticket_web_eventos where slug = lower(p_slug);
  if f.evento_id is null or f.owner_id <> r.owner_id then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if not public.rrpp_en_evento(r.id, f.evento_id) then return jsonb_build_object('ok', false, 'motivo', 'rrpp_evento'); end if;
  select * into v_cfg from public.ticket_rrpp_config where evento_id = f.evento_id;
  if v_cfg.evento_id is not null and not v_cfg.efectivo then return jsonb_build_object('ok', false, 'motivo', 'efectivo_no'); end if;
  select count(*) into v_rec from public.ticket_web_pedidos where rrpp_id = r.id and creado_en > now() - interval '10 minutes';
  if v_rec >= 60 then return jsonb_build_object('ok', false, 'motivo', 'demasiados_intentos'); end if;
  v_email := lower(btrim(coalesce(p_comprador ->> 'email', '')));
  v_real := v_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
  if not v_real then v_email := 'rrpp-' || encode(extensions.gen_random_bytes(5), 'hex') || '@sin-correo.invalid'; end if;
  perform set_config('tixfast.rrpp_venta', r.id::text, true);
  res := public.web_comprar(p_slug, p_items,
           (coalesce(p_comprador, '{}'::jsonb) - 'rrpp' - 'marketing') || jsonb_build_object('email', v_email, 'rrpp', r.codigo, 'marketing', false), p_asistentes);
  perform set_config('tixfast.rrpp_venta', '', true);
  return res || jsonb_build_object('correo', v_real);
end $$;
revoke all on function public.rrpp_vender_interno(uuid, text, jsonb, jsonb, jsonb) from public, anon, authenticated;

create or replace function public.rrpp_anular_interno(p_rrpp uuid, p_pedido uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p record; x record;
begin
  select * into p from public.ticket_web_pedidos where acceso = p_pedido and rrpp_id = p_rrpp and rrpp_efectivo for update;
  if p.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if p.creado_en < now() - interval '15 minutes' then return jsonb_build_object('ok', false, 'motivo', 'tarde'); end if;
  for x in select * from public.ticket_web_entradas where pedido_id = p.id and estado = 'valida' for update loop
    if x.tramo_id is not null then update public.ticket_web_tramos set vendidas = greatest(vendidas - 1, 0) where id = x.tramo_id; end if;
    update public.ticket_web_entradas set estado = 'anulada' where id = x.id;
  end loop;
  update public.ticket_web_pedidos set estado = 'anulado' where id = p.id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.rrpp_anular_interno(uuid, uuid) from public, anon, authenticated;

-- Acceso por enlace personal (sin cuenta)
create or replace function public.rrpp_vender(p_acceso uuid, p_slug text, p_items jsonb, p_comprador jsonb, p_asistentes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.ticket_rrpp where acceso = p_acceso and activo and estado = 'activa';
  if v_id is null then return jsonb_build_object('ok', false, 'motivo', 'rrpp'); end if;
  return public.rrpp_vender_interno(v_id, p_slug, p_items, p_comprador, p_asistentes);
end $$;
create or replace function public.rrpp_anular_venta(p_acceso uuid, p_pedido uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.ticket_rrpp where acceso = p_acceso and activo and estado = 'activa';
  if v_id is null then return jsonb_build_object('ok', false, 'motivo', 'rrpp'); end if;
  return public.rrpp_anular_interno(v_id, p_pedido);
end $$;

-- Acceso con cuenta
create or replace function public.rrpp_vender_cuenta(p_rrpp uuid, p_slug text, p_items jsonb, p_comprador jsonb, p_asistentes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.ticket_rrpp where id = p_rrpp and user_id = (select auth.uid())) then return jsonb_build_object('ok', false, 'motivo', 'rrpp'); end if;
  return public.rrpp_vender_interno(p_rrpp, p_slug, p_items, p_comprador, p_asistentes);
end $$;
revoke all on function public.rrpp_vender_cuenta(uuid, text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.rrpp_vender_cuenta(uuid, text, jsonb, jsonb, jsonb) to authenticated;
create or replace function public.rrpp_anular_cuenta(p_pedido uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_rrpp uuid;
begin
  select p.rrpp_id into v_rrpp from public.ticket_web_pedidos p join public.ticket_rrpp r on r.id = p.rrpp_id
   where p.acceso = p_pedido and r.user_id = (select auth.uid());
  if v_rrpp is null then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  return public.rrpp_anular_interno(v_rrpp, p_pedido);
end $$;
revoke all on function public.rrpp_anular_cuenta(uuid) from public, anon;
grant execute on function public.rrpp_anular_cuenta(uuid) to authenticated;

-- ---------- Organizador: resumen con estado, cuenta y dónde cobra ----------
create or replace function public.rrpp_resumen(p_evento uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'rrpp_id', r.id, 'nombre', r.nombre, 'codigo', r.codigo, 'telefono', r.telefono, 'activo', r.activo,
    'estado', r.estado, 'cuenta', r.user_id is not null, 'mensaje', r.mensaje, 'solicitado_en', r.solicitado_en,
    'perfil', case when pf.user_id is not null then jsonb_build_object('nombre_completo', pf.nombre_completo, 'telefono', pf.telefono, 'email', pf.email,
               'ciudad', pf.ciudad, 'instagram', pf.instagram, 'nif', pf.nif, 'fiscal', pf.fiscal, 'cobro', pf.cobro, 'cobro_bizum', pf.cobro_bizum,
               'cobro_iban', pf.cobro_iban, 'cobro_titular', pf.cobro_titular) end,
    'en_evento', public.rrpp_en_evento(r.id, p_evento),
    'propia', o.tipo is not null, 'tipo', o.tipo, 'valor', o.valor, 'tramos', o.tramos,
    'online', (select count(*) from public.ticket_web_entradas x join public.ticket_web_pedidos p on p.id = x.pedido_id
                where x.evento_id = p_evento and x.rrpp_id = r.id and x.estado = 'valida' and not x.prueba and not p.rrpp_efectivo),
    'efectivo_n', (select count(*) from public.ticket_web_entradas x join public.ticket_web_pedidos p on p.id = x.pedido_id
                where x.evento_id = p_evento and x.rrpp_id = r.id and x.estado = 'valida' and not x.prueba and p.rrpp_efectivo),
    'efectivo_importe', (select coalesce(sum(x.precio), 0) from public.ticket_web_entradas x join public.ticket_web_pedidos p on p.id = x.pedido_id
                where x.evento_id = p_evento and x.rrpp_id = r.id and x.estado = 'valida' and not x.prueba and p.rrpp_efectivo),
    'pruebas', (select count(*) from public.ticket_web_entradas x where x.evento_id = p_evento and x.rrpp_id = r.id and x.estado = 'valida' and x.prueba),
    'comision', (select coalesce(sum(public.rrpp_comision(p_evento, r.id, x.tramo_id, x.precio)), 0) from public.ticket_web_entradas x
                where x.evento_id = p_evento and x.rrpp_id = r.id and x.estado = 'valida' and not x.prueba),
    'liquidacion', (select to_jsonb(l) from public.ticket_rrpp_liquidaciones l where l.evento_id = p_evento and l.rrpp_id = r.id)
  ) order by r.estado = 'solicitada' desc, r.activo desc, r.nombre), '[]'::jsonb)
  from public.ticket_rrpp r
  left join public.ticket_rrpp_eventos o on o.evento_id = p_evento and o.rrpp_id = r.id
  left join public.ticket_rrpp_perfiles pf on pf.user_id = r.user_id
  where r.owner_id = (select auth.uid()) and r.estado <> 'rechazada'
$$;

-- El organizador solo puede cambiar el estado de una solicitud (aceptar, pausar, rechazar)
create or replace function public.rrpp_responder(p_rrpp uuid, p_estado text)
returns jsonb language plpgsql set search_path = '' as $$
begin
  if p_estado not in ('activa', 'rechazada', 'pausada') then return jsonb_build_object('ok', false, 'motivo', 'estado'); end if;
  update public.ticket_rrpp set estado = p_estado, activo = true, actualizado_en = now() where id = p_rrpp and owner_id = (select auth.uid());
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.rrpp_responder(uuid, text) from public, anon;
grant execute on function public.rrpp_responder(uuid, text) to authenticated;

-- ---------- Registro de RRPP (lo usa la función del servidor rrpp-registro) ----------
create table if not exists public.ticket_rrpp_registros (
  id bigint generated always as identity primary key,
  ip text, email text, creado_en timestamptz not null default now()
);
create index if not exists ticket_rrpp_registros_ip_idx on public.ticket_rrpp_registros (ip, creado_en desc);
alter table public.ticket_rrpp_registros enable row level security;
revoke all on public.ticket_rrpp_registros from anon, authenticated;

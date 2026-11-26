-- TIXFAST · Seguridad del dinero y registro de auditoría (auditoría de seguridad, fases 1-3)
--
-- Qué hace (compatible con la versión de la app ya publicada: no cambia nada de cómo se vende):
--   1. ticket_audit_log: registro de todo lo delicado (anulaciones, precios corregidos, cierres Z, revertir Z,
--      cambios de precio y de PIN, borrados, PIN fallidos, inicios de sesión). Nadie lo puede editar ni borrar.
--   2. ticket_precios_historial: los precios que ha tenido cada producto y bono. Sirve para aceptar ventas hechas
--      SIN INTERNET antes de un cambio de precio (nunca se pierde una venta legítima).
--   3. Ventas: el servidor comprueba el precio (0 € y negativos son válidos si el producto o bono los tiene). Si llega un precio que el producto nunca ha tenido, se guarda el
--      precio real del producto y queda una alerta. Una venta ya no se puede modificar (solo anular, y una
--      anulación no se puede deshacer). El cierre de una venta solo lo cambia el cierre Z.
--   4. Cierres Z: solo los crea el cierre Z y solo cambian al revertirlos.
--   5. Gastos de caja: solo se pueden anular o vincular al CRM.
--   6. Todo lo que se borre de ventas, cierres o gastos desde la app queda archivado (ticket_registros_borrados).
--   7. PIN: nunca se guardan en claro. Un PIN nuevo se convierte en huella (PBKDF2-SHA256, 210.000 vueltas,
--      el mismo formato que usa la app sin conexión) y el PIN de fábrica no se guarda.
--
-- Las reglas solo se aplican a peticiones de usuarios (roles authenticated/anon). Las funciones del sistema
-- (papelera, purga, Stripe, tareas programadas) siguen funcionando igual.

-- ============================================================ esquema interno (no visible por la API)
create schema if not exists ticket_interno;
revoke all on schema ticket_interno from public, anon;
grant usage on schema ticket_interno to authenticated;

-- ============================================================ 1. registro de auditoría
create table if not exists public.ticket_audit_log (
  id bigint generated always as identity primary key,
  owner_id uuid references auth.users(id) on delete cascade,
  actor_id uuid,
  actor_rol text,
  accion text not null check (char_length(accion) between 1 and 60),
  tabla text check (tabla is null or char_length(tabla) <= 60),
  registro_id text check (registro_id is null or char_length(registro_id) <= 100),
  detalle jsonb not null default '{}'::jsonb check (pg_column_size(detalle) < 8000),
  gravedad text not null default 'info' check (gravedad in ('info', 'aviso', 'alerta')),
  creado_en timestamptz not null default now()
);
create index if not exists ticket_audit_log_owner_idx on public.ticket_audit_log (owner_id, creado_en desc);
create index if not exists ticket_audit_log_alertas_idx on public.ticket_audit_log (owner_id, creado_en desc) where gravedad <> 'info';
alter table public.ticket_audit_log enable row level security;
drop policy if exists audit_ver_propio on public.ticket_audit_log;
create policy audit_ver_propio on public.ticket_audit_log for select to authenticated using (owner_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.ticket_audit_log from anon, authenticated;
comment on table public.ticket_audit_log is 'TIXFAST · registro de auditoría. Solo se escribe desde el servidor; no se puede editar ni borrar.';

-- Nadie (ni el dueño) puede editar el registro; borrar solo el sistema (retención) o en cascada al borrar la cuenta
create or replace function ticket_interno.audit_inmutable() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then raise exception using errcode = '42501', message = 'TIXFAST: el registro de auditoría no se puede modificar'; end if;
  if current_user in ('authenticated', 'anon') then raise exception using errcode = '42501', message = 'TIXFAST: el registro de auditoría no se puede borrar'; end if;
  return old;
end $$;
drop trigger if exists ticket_audit_log_inmutable on public.ticket_audit_log;
create trigger ticket_audit_log_inmutable before update or delete on public.ticket_audit_log
  for each row execute function ticket_interno.audit_inmutable();

-- Escribe en el registro (lo usan los disparadores; no se puede llamar desde la API)
create or replace function ticket_interno.auditar(p_owner uuid, p_accion text, p_tabla text, p_registro text, p_detalle jsonb, p_gravedad text default 'info')
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ticket_audit_log (owner_id, actor_id, actor_rol, accion, tabla, registro_id, detalle, gravedad)
  values (p_owner, (select auth.uid()), coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (select auth.role()), current_user),
          left(p_accion, 60), left(p_tabla, 60), left(p_registro, 100), coalesce(p_detalle, '{}'::jsonb),
          case when p_gravedad in ('info', 'aviso', 'alerta') then p_gravedad else 'info' end);
exception when others then
  null;   -- el registro nunca debe impedir una venta ni un cierre
end $$;
revoke all on function ticket_interno.auditar(uuid, text, text, text, jsonb, text) from public, anon;
grant execute on function ticket_interno.auditar(uuid, text, text, text, jsonb, text) to authenticated;

-- Lo que la app puede anotar por su cuenta (con límite para que nadie llene el registro)
create or replace function public.ticket_auditar(p_accion text, p_detalle jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_grav text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  v_grav := case p_accion
    when 'inicio_sesion' then 'info' when 'cierre_sesion' then 'info' when 'exportacion' then 'info'
    when 'pin_fallido' then 'aviso' when 'pin_bloqueado' then 'alerta' else null end;
  if v_grav is null then return jsonb_build_object('ok', false, 'motivo', 'accion'); end if;
  if (select count(*) from public.ticket_audit_log where owner_id = v_uid and actor_id = v_uid
        and creado_en > now() - interval '1 hour' and accion = p_accion) >= 300 then
    return jsonb_build_object('ok', false, 'motivo', 'limite');
  end if;
  if p_detalle is null or jsonb_typeof(p_detalle) <> 'object' or pg_column_size(p_detalle) > 2000 then p_detalle := '{}'::jsonb; end if;
  perform ticket_interno.auditar(v_uid, p_accion, null, null, p_detalle, v_grav);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.ticket_auditar(text, jsonb) from public, anon;
grant execute on function public.ticket_auditar(text, jsonb) to authenticated;

-- ============================================================ 2. archivo de lo borrado
create table if not exists public.ticket_registros_borrados (
  id bigint generated always as identity primary key,
  owner_id uuid references auth.users(id) on delete cascade,
  tabla text not null,
  registro jsonb not null,
  borrado_por uuid,
  borrado_en timestamptz not null default now()
);
create index if not exists ticket_registros_borrados_owner_idx on public.ticket_registros_borrados (owner_id, borrado_en desc);
alter table public.ticket_registros_borrados enable row level security;
drop policy if exists borrados_ver_propio on public.ticket_registros_borrados;
create policy borrados_ver_propio on public.ticket_registros_borrados for select to authenticated using (owner_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.ticket_registros_borrados from anon, authenticated;
comment on table public.ticket_registros_borrados is 'TIXFAST · copia de ventas, cierres y gastos borrados desde la app (nada se pierde).';

create or replace function ticket_interno.archivar(p_tabla text, p_filas jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ticket_registros_borrados (owner_id, tabla, registro, borrado_por)
  select nullif(f ->> 'owner_id', '')::uuid, p_tabla, f, (select auth.uid()) from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) f;
end $$;
revoke all on function ticket_interno.archivar(text, jsonb) from public, anon;
grant execute on function ticket_interno.archivar(text, jsonb) to authenticated;

-- ============================================================ 3. historial de precios
create table if not exists public.ticket_precios_historial (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  punto_id uuid not null references public.ticket_puntos(id) on delete cascade,
  producto_id uuid,                 -- producto (sin FK: el historial sobrevive al borrado del producto)
  combo text,                       -- o nombre del bono
  precio numeric not null,
  desde timestamptz not null default now(),
  check ((producto_id is null) <> (combo is null))
);
create unique index if not exists ticket_precios_historial_uq
  on public.ticket_precios_historial (punto_id, coalesce(producto_id::text, 'bono:' || combo), precio);
create index if not exists ticket_precios_historial_prod_idx on public.ticket_precios_historial (producto_id, precio) where producto_id is not null;
create index if not exists ticket_precios_historial_owner_idx on public.ticket_precios_historial (owner_id);
alter table public.ticket_precios_historial enable row level security;
drop policy if exists precios_ver_propio on public.ticket_precios_historial;
create policy precios_ver_propio on public.ticket_precios_historial for select to authenticated using (owner_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.ticket_precios_historial from anon, authenticated;

-- Apunta los precios actuales de los productos y bonos de una barra (si son nuevos)
create or replace function ticket_interno.registrar_precios(p_punto uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare pt record; c jsonb; v_precio numeric;
begin
  select id, owner_id, combos into pt from public.ticket_puntos where id = p_punto;
  if pt.id is null then return; end if;
  insert into public.ticket_precios_historial (owner_id, punto_id, producto_id, precio)
  select p.owner_id, p.punto_id, p.id, p.precio from public.ticket_productos p where p.punto_id = p_punto
  on conflict do nothing;
  for c in select * from jsonb_array_elements(case when jsonb_typeof(pt.combos) = 'array' then pt.combos else '[]'::jsonb end) loop
    continue when coalesce(c ->> 'name', '') = '';
    if coalesce(c ->> 'price', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then
      v_precio := round((c ->> 'price')::numeric, 2);
    else
      select round(coalesce(sum(p.precio * greatest(coalesce(nullif(i ->> 'qty', '')::numeric, 1), 1)), 0), 2) into v_precio
        from jsonb_array_elements(case when jsonb_typeof(c -> 'items') = 'array' then c -> 'items' else '[]'::jsonb end) i
        join public.ticket_productos p on p.id::text = i ->> 'productId';
    end if;
    insert into public.ticket_precios_historial (owner_id, punto_id, combo, precio)
    values (pt.owner_id, pt.id, left(c ->> 'name', 120), coalesce(v_precio, 0))
    on conflict do nothing;
  end loop;
exception when others then
  null;   -- nunca debe impedir guardar un producto
end $$;
revoke all on function ticket_interno.registrar_precios(uuid) from public, anon;
grant execute on function ticket_interno.registrar_precios(uuid) to authenticated;

-- Precios de hoy y los que ya aparecen en ventas registradas (ventas hechas sin conexión antes de un cambio)
do $$ declare r record; begin
  for r in select id from public.ticket_puntos loop perform ticket_interno.registrar_precios(r.id); end loop;
end $$;
insert into public.ticket_precios_historial (owner_id, punto_id, producto_id, precio, desde)
select v.owner_id, v.punto_id, v.producto_id, v.precio, min(v.creado_en)
  from public.ticket_ventas v
 where v.producto_id is not null and coalesce(v.metodo_pago, '') not like 'invitacion%'
 group by 1, 2, 3, 4
on conflict do nothing;

-- ============================================================ 4. restricciones de importes
-- Los precios 0 € y NEGATIVOS son válidos (p. ej. copas que se entregan con la entrada de taquilla y que
-- descuentan de la facturación de la noche). Solo se cortan valores absurdos (error o manipulación).
alter table public.ticket_ventas drop constraint if exists ticket_ventas_precio_check;
alter table public.ticket_ventas add constraint ticket_ventas_precio_check check (precio > -100000 and precio < 100000);
alter table public.ticket_ventas drop constraint if exists ticket_ventas_pago_check;
alter table public.ticket_ventas add constraint ticket_ventas_pago_check
  check ((entregado is null or abs(entregado) < 1000000) and (cambio is null or abs(cambio) < 1000000));
alter table public.ticket_productos drop constraint if exists ticket_productos_precio_check;
alter table public.ticket_productos add constraint ticket_productos_precio_check check (precio > -100000 and precio < 100000);

-- ============================================================ 5. ventas
-- Al registrar: el precio lo decide el servidor
create or replace function ticket_interno.ventas_antes_insertar() returns trigger language plpgsql set search_path = '' as $$
declare v_inv boolean; v_actual numeric; v_hay boolean;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  new.closure_id := null; new.anulada := false; new.anulada_en := null; new.anulada_por := null;
  begin
    v_inv := coalesce(new.metodo_pago, '') like 'invitacion%';
    if new.producto_id is not null then
      select precio into v_actual from public.ticket_productos where id = new.producto_id;
      if found then
        if v_inv then
          if new.precio <> 0 then new.precio := 0; end if;          -- invitación: siempre 0 € en caja
        elsif new.precio <> v_actual and not exists (
            select 1 from public.ticket_precios_historial h where h.producto_id = new.producto_id and h.precio = new.precio) then
          perform ticket_interno.auditar(new.owner_id, 'precio_corregido', 'ticket_ventas', new.client_uuid::text,
            jsonb_build_object('producto', new.nombre, 'precio_enviado', new.precio, 'precio_guardado', v_actual,
                               'punto_id', new.punto_id, 'evento_id', new.evento_id, 'operario', new.operario), 'alerta');
          new.precio := v_actual;
        end if;
      end if;
    elsif not v_inv then
      -- Bonos: si el precio no coincide con ninguno que haya tenido el bono, queda una alerta
      select true into v_hay from public.ticket_precios_historial h where h.punto_id = new.punto_id and h.combo = new.nombre limit 1;
      if coalesce(v_hay, false) and not exists (
          select 1 from public.ticket_precios_historial h where h.punto_id = new.punto_id and h.combo = new.nombre and h.precio = new.precio) then
        perform ticket_interno.auditar(new.owner_id, 'precio_bono_distinto', 'ticket_ventas', new.client_uuid::text,
          jsonb_build_object('bono', new.nombre, 'precio', new.precio, 'punto_id', new.punto_id, 'evento_id', new.evento_id, 'operario', new.operario), 'alerta');
      end if;
    end if;
  exception when others then
    null;   -- si la comprobación falla por cualquier motivo, la venta NUNCA se pierde
  end;
  return new;
end $$;

-- Al modificar: solo anular (sin vuelta atrás) y el cierre Z
create or replace function ticket_interno.ventas_antes_modificar() returns trigger language plpgsql set search_path = '' as $$
declare libres text[] := array['anulada', 'anulada_en', 'anulada_por', 'closure_id', 'producto_id', 'actualizado_en'];   -- actualizado_en: lo pone solo la base de datos (20261120090000_ticket_rendimiento)
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if (to_jsonb(new) - libres) is distinct from (to_jsonb(old) - libres)
     or (new.producto_id is distinct from old.producto_id and new.producto_id is not null) then
    raise exception using errcode = '42501', message = 'TIXFAST: una venta no se puede modificar. Si hay un error, anúlala.';
  end if;
  if old.anulada and not coalesce(new.anulada, false) then
    raise exception using errcode = '42501', message = 'TIXFAST: una venta anulada no se puede recuperar';
  end if;
  if old.anulada then new.anulada_en := old.anulada_en; new.anulada_por := old.anulada_por; end if;
  if new.anulada and not old.anulada then new.anulada_en := coalesce(new.anulada_en, now()); end if;
  if new.closure_id is distinct from old.closure_id
     and coalesce(current_setting('tixfast.cierre', true), '') <> 'on'
     and not (new.closure_id is null and not exists (select 1 from public.ticket_cierres c where c.id = old.closure_id)) then
    raise exception using errcode = '42501', message = 'TIXFAST: el turno de una venta solo lo cambia el cierre Z';
  end if;
  return new;
end $$;

create or replace function ticket_interno.ventas_tras_modificar() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.anulada and not old.anulada then
    perform ticket_interno.auditar(new.owner_id, 'venta_anulada', 'ticket_ventas', new.client_uuid::text,
      jsonb_build_object('producto', new.nombre, 'precio', new.precio, 'numero', new.numero, 'folio', new.codigo,
                         'anulada_por', new.anulada_por, 'punto_id', new.punto_id, 'evento_id', new.evento_id,
                         'con_cierre', new.closure_id is not null), case when new.closure_id is not null then 'alerta' else 'aviso' end);
  end if;
  return null;
end $$;

drop trigger if exists ticket_ventas_seguridad_insert on public.ticket_ventas;
create trigger ticket_ventas_seguridad_insert before insert on public.ticket_ventas
  for each row execute function ticket_interno.ventas_antes_insertar();
drop trigger if exists ticket_ventas_seguridad_update on public.ticket_ventas;
create trigger ticket_ventas_seguridad_update before update on public.ticket_ventas
  for each row execute function ticket_interno.ventas_antes_modificar();
drop trigger if exists ticket_ventas_auditoria_update on public.ticket_ventas;
create trigger ticket_ventas_auditoria_update after update of anulada on public.ticket_ventas
  for each row execute function ticket_interno.ventas_tras_modificar();

-- ============================================================ 6. cierres Z
create or replace function ticket_interno.cierres_antes() returns trigger language plpgsql set search_path = '' as $$
declare libres text[] := array['revertido_en', 'revertido_por'];
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if coalesce(current_setting('tixfast.cierre', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    raise exception using errcode = '42501', message = 'TIXFAST: los cierres Z solo se crean desde «Cerrar caja (Z)»';
  end if;
  raise exception using errcode = '42501', message = 'TIXFAST: un cierre Z no se puede modificar (solo revertir la última Z)';
end $$;

create or replace function ticket_interno.cierres_tras() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform ticket_interno.auditar(new.owner_id, 'cierre_z', 'ticket_cierres', new.id::text,
      jsonb_build_object('punto_id', new.punto_id, 'evento_id', new.evento_id, 'tickets', new.tickets, 'facturacion', new.facturacion,
                         'anulaciones', new.anulaciones, 'esperado', new.esperado, 'contado', new.contado,
                         'descuadre', case when new.contado is not null and new.esperado is not null then new.contado - new.esperado end,
                         'cerrado_por', new.cerrado_por),
      case when new.contado is not null and new.esperado is not null and abs(new.contado - new.esperado) >= 20 then 'aviso' else 'info' end);
  elsif new.revertido_en is not null and old.revertido_en is null then
    perform ticket_interno.auditar(new.owner_id, 'cierre_z_revertido', 'ticket_cierres', new.id::text,
      jsonb_build_object('punto_id', new.punto_id, 'evento_id', new.evento_id, 'facturacion', new.facturacion, 'revertido_por', new.revertido_por), 'alerta');
  end if;
  return null;
end $$;

drop trigger if exists ticket_cierres_seguridad on public.ticket_cierres;
create trigger ticket_cierres_seguridad before insert or update on public.ticket_cierres
  for each row execute function ticket_interno.cierres_antes();
drop trigger if exists ticket_cierres_auditoria on public.ticket_cierres;
create trigger ticket_cierres_auditoria after insert or update on public.ticket_cierres
  for each row execute function ticket_interno.cierres_tras();

-- ============================================================ 7. gastos y entradas de caja
create or replace function ticket_interno.gastos_antes() returns trigger language plpgsql set search_path = '' as $$
declare libres text[] := array['anulado', 'closure_id', 'crm_gasto_id'];
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    new.closure_id := null; new.anulado := false;
    return new;
  end if;
  if (to_jsonb(new) - libres) is distinct from (to_jsonb(old) - libres) then
    raise exception using errcode = '42501', message = 'TIXFAST: un movimiento de caja no se puede modificar. Si hay un error, anúlalo.';
  end if;
  if old.anulado and not new.anulado then
    raise exception using errcode = '42501', message = 'TIXFAST: un movimiento anulado no se puede recuperar';
  end if;
  if new.closure_id is distinct from old.closure_id
     and coalesce(current_setting('tixfast.cierre', true), '') <> 'on'
     and not (new.closure_id is null and not exists (select 1 from public.ticket_cierres c where c.id = old.closure_id)) then
    raise exception using errcode = '42501', message = 'TIXFAST: el turno de un movimiento solo lo cambia el cierre Z';
  end if;
  return new;
end $$;

create or replace function ticket_interno.gastos_tras() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.anulado and not old.anulado then
    perform ticket_interno.auditar(new.owner_id, 'gasto_anulado', 'ticket_gastos', new.id::text,
      jsonb_build_object('tipo', new.tipo, 'importe', new.importe, 'concepto', new.concepto, 'punto_id', new.punto_id, 'evento_id', new.evento_id), 'aviso');
  end if;
  return null;
end $$;

drop trigger if exists ticket_gastos_seguridad on public.ticket_gastos;
create trigger ticket_gastos_seguridad before insert or update on public.ticket_gastos
  for each row execute function ticket_interno.gastos_antes();
drop trigger if exists ticket_gastos_auditoria on public.ticket_gastos;
create trigger ticket_gastos_auditoria after update of anulado on public.ticket_gastos
  for each row execute function ticket_interno.gastos_tras();

-- ============================================================ 8. borrados: se archivan y se apuntan
create or replace function ticket_interno.archivar_borrado() returns trigger language plpgsql set search_path = '' as $$
declare v_filas jsonb; v_n int; v_owner uuid; v_total numeric;
begin
  if current_user not in ('authenticated', 'anon') then return null; end if;   -- papelera, purga, baja de cuenta
  select coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb), count(*) into v_filas, v_n from borrados o;
  if v_n = 0 then return null; end if;
  perform ticket_interno.archivar(tg_table_name, v_filas);
  select nullif(v_filas -> 0 ->> 'owner_id', '')::uuid into v_owner;
  select sum(coalesce(nullif(f ->> 'precio', ''), nullif(f ->> 'importe', ''), nullif(f ->> 'facturacion', ''))::numeric) into v_total
    from jsonb_array_elements(v_filas) f;
  perform ticket_interno.auditar(v_owner, 'borrado_' || tg_table_name, tg_table_name, null,
    jsonb_build_object('filas', v_n, 'importe', v_total, 'evento_id', v_filas -> 0 ->> 'evento_id'), 'alerta');
  return null;
end $$;

drop trigger if exists ticket_ventas_archivo on public.ticket_ventas;
create trigger ticket_ventas_archivo after delete on public.ticket_ventas
  referencing old table as borrados for each statement execute function ticket_interno.archivar_borrado();
drop trigger if exists ticket_cierres_archivo on public.ticket_cierres;
create trigger ticket_cierres_archivo after delete on public.ticket_cierres
  referencing old table as borrados for each statement execute function ticket_interno.archivar_borrado();
drop trigger if exists ticket_gastos_archivo on public.ticket_gastos;
create trigger ticket_gastos_archivo after delete on public.ticket_gastos
  referencing old table as borrados for each statement execute function ticket_interno.archivar_borrado();

-- ============================================================ 9. cierre Z y revertir Z marcan que son ellos
create or replace function public.ticket_cerrar_z(p_evento uuid, p_punto uuid, p_por text default null::text, p_contado numeric default null::numeric)
 returns ticket_cierres
 language plpgsql
 set search_path to ''
as $function$
declare v_row public.ticket_cierres; v_detalle jsonb; v_tickets int; v_fact numeric; v_anul int;
        v_efe numeric; v_tar numeric; v_fondo numeric; v_gastos numeric; v_entradas numeric; v_adv boolean; v_esperado numeric;
begin
  perform set_config('tixfast.cierre', 'on', true);
  select coalesce(fondo, 0) into v_fondo from public.ticket_puntos where id = p_punto;
  select coalesce(venta_avanzada, false) into v_adv from public.ticket_eventos where id = p_evento;

  select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'qty', qty, 'total', total) order by total desc), '[]'::jsonb)
  into v_detalle from (
    select nombre, count(*) as qty, sum(precio) as total
    from public.ticket_ventas
    where evento_id = p_evento and punto_id = p_punto and not anulada and closure_id is null
    group by nombre) t;

  select count(*), coalesce(sum(precio), 0) into v_tickets, v_fact
    from public.ticket_ventas where evento_id = p_evento and punto_id = p_punto and not anulada and closure_id is null;

  select coalesce(sum(precio) filter (where metodo_pago = 'efectivo'), 0),
         coalesce(sum(precio) filter (where metodo_pago = 'tarjeta'), 0)
    into v_efe, v_tar
    from public.ticket_ventas where evento_id = p_evento and punto_id = p_punto and not anulada and closure_id is null;

  select count(*) into v_anul
    from public.ticket_ventas where evento_id = p_evento and punto_id = p_punto and anulada and closure_id is null;

  select coalesce(sum(importe) filter (where tipo = 'gasto'), 0), coalesce(sum(importe) filter (where tipo = 'entrada'), 0)
    into v_gastos, v_entradas
    from public.ticket_gastos where evento_id = p_evento and punto_id = p_punto and not anulado and closure_id is null;

  v_esperado := v_fondo + (case when v_adv then v_efe else v_fact end) + v_entradas - v_gastos;

  insert into public.ticket_cierres (evento_id, punto_id, tickets, facturacion, anulaciones, detalle, cerrado_por, efectivo, tarjeta, fondo, contado, gastos, entradas, esperado)
  values (p_evento, p_punto, v_tickets, v_fact, v_anul, v_detalle, p_por, v_efe, v_tar, v_fondo, p_contado, v_gastos, v_entradas, v_esperado)
  returning * into v_row;

  update public.ticket_ventas set closure_id = v_row.id
  where evento_id = p_evento and punto_id = p_punto and closure_id is null;

  update public.ticket_gastos set closure_id = v_row.id
  where evento_id = p_evento and punto_id = p_punto and closure_id is null;

  -- Venta cerrada: la barra queda CERRADA (solo un admin puede reabrirla, y volverá a pedir fondo)
  update public.ticket_puntos set fondo = null, fondo_en = null, fondo_por = null,
         estado = 'cerrada', cerrada_en = now(), cerrada_por = p_por
  where id = p_punto;

  perform set_config('tixfast.cierre', '', true);
  return v_row;
end $function$;

create or replace function public.ticket_revertir_z(p_cierre uuid, p_por text default null::text)
 returns ticket_cierres
 language plpgsql
 set search_path to ''
as $function$
declare c public.ticket_cierres; pt public.ticket_puntos; ultimo uuid;
begin
  if auth.uid() is null then raise exception 'Sin sesión' using errcode = '42501'; end if;
  perform set_config('tixfast.cierre', 'on', true);
  select * into c from public.ticket_cierres where id = p_cierre for update;
  if c.id is null then raise exception 'No se encuentra ese cierre Z' using errcode = 'P0002'; end if;
  if c.revertido_en is not null then raise exception 'Este cierre Z ya está revertido' using errcode = 'P0001'; end if;
  select id into ultimo from public.ticket_cierres
   where punto_id = c.punto_id and revertido_en is null order by creado_en desc, id desc limit 1;
  if ultimo is distinct from c.id then
    raise exception 'Solo se puede revertir la última Z de la barra' using errcode = 'P0001';
  end if;
  select * into pt from public.ticket_puntos where id = c.punto_id for update;
  if pt.estado = 'abierta' then
    raise exception 'La barra está abierta con otro turno: saca su Z o pásala a modo prueba antes de revertir' using errcode = 'P0001';
  end if;

  update public.ticket_ventas set closure_id = null where closure_id = c.id;
  update public.ticket_gastos set closure_id = null where closure_id = c.id;
  update public.ticket_cierres set revertido_en = now(), revertido_por = left(coalesce(p_por, 'Admin'), 60) where id = c.id returning * into c;
  update public.ticket_puntos set estado = 'abierta', fondo = c.fondo, fondo_en = now(), fondo_por = left(coalesce(p_por, 'Admin'), 60),
         cerrada_en = null, cerrada_por = null
   where id = c.punto_id;
  perform set_config('tixfast.cierre', '', true);
  return c;
end $function$;

-- Restablecer las estadísticas de un evento (lo usa la app nueva; todo queda archivado)
create or replace function public.ticket_resetear_estadisticas(p_evento uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); nv int; nc int; ng int;
begin
  if v_uid is null or not exists (select 1 from public.ticket_eventos where id = p_evento and owner_id = v_uid) then
    raise exception using errcode = '42501', message = 'no autorizado';
  end if;
  perform set_config('tixfast.borrado', 'on', true);
  delete from public.ticket_ventas where evento_id = p_evento; get diagnostics nv = row_count;
  delete from public.ticket_gastos where evento_id = p_evento; get diagnostics ng = row_count;
  delete from public.ticket_cierres where evento_id = p_evento; get diagnostics nc = row_count;
  delete from public.ticket_backups where evento_id = p_evento;
  delete from public.ticket_reservado_ventas where evento_id = p_evento;
  perform ticket_interno.auditar(v_uid, 'estadisticas_reseteadas', 'ticket_eventos', p_evento::text,
    jsonb_build_object('ventas', nv, 'gastos', ng, 'cierres', nc), 'alerta');
  perform set_config('tixfast.borrado', '', true);
  return jsonb_build_object('ok', true, 'ventas', nv, 'gastos', ng, 'cierres', nc);
end $$;
revoke all on function public.ticket_resetear_estadisticas(uuid) from public, anon;
grant execute on function public.ticket_resetear_estadisticas(uuid) to authenticated;

-- ============================================================ 10. productos, barras y eventos (auditoría)
create or replace function ticket_interno.productos_tras() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform ticket_interno.auditar(old.owner_id, 'producto_borrado', 'ticket_productos', old.id::text,
      jsonb_build_object('producto', old.nombre, 'precio', old.precio, 'punto_id', old.punto_id), 'info');
    return null;
  end if;
  perform ticket_interno.registrar_precios(new.punto_id);
  if tg_op = 'UPDATE' and new.precio is distinct from old.precio then
    perform ticket_interno.auditar(new.owner_id, 'precio_cambiado', 'ticket_productos', new.id::text,
      jsonb_build_object('producto', new.nombre, 'antes', old.precio, 'ahora', new.precio, 'punto_id', new.punto_id), 'aviso');
  end if;
  return null;
end $$;
drop trigger if exists ticket_productos_auditoria on public.ticket_productos;
create trigger ticket_productos_auditoria after insert or update of precio, punto_id or delete on public.ticket_productos
  for each row execute function ticket_interno.productos_tras();

create or replace function ticket_interno.puntos_tras() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.combos is distinct from old.combos then
    perform ticket_interno.registrar_precios(new.id);
  end if;
  if tg_op = 'UPDATE' and new.combos is distinct from old.combos then
    perform ticket_interno.auditar(new.owner_id, 'bonos_cambiados', 'ticket_puntos', new.id::text,
      jsonb_build_object('barra', new.nombre, 'bonos', jsonb_array_length(case when jsonb_typeof(new.combos) = 'array' then new.combos else '[]'::jsonb end)), 'info');
  end if;
  if tg_op = 'UPDATE' and old.estado = 'cerrada' and new.estado is distinct from 'cerrada' then
    perform ticket_interno.auditar(new.owner_id, 'barra_reabierta', 'ticket_puntos', new.id::text,
      jsonb_build_object('barra', new.nombre, 'estado', new.estado, 'evento_id', new.evento_id), 'aviso');
  end if;
  return null;
end $$;
drop trigger if exists ticket_puntos_auditoria on public.ticket_puntos;
create trigger ticket_puntos_auditoria after insert or update of combos, estado on public.ticket_puntos
  for each row execute function ticket_interno.puntos_tras();

create or replace function ticket_interno.eventos_tras() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform ticket_interno.auditar(old.owner_id, 'evento_eliminado', 'ticket_eventos', old.id::text, jsonb_build_object('evento', old.nombre), 'alerta');
    return null;
  end if;
  if new.pin_admin_huella is distinct from old.pin_admin_huella then
    perform ticket_interno.auditar(new.owner_id, 'pin_cambiado', 'ticket_eventos', new.id::text, jsonb_build_object('evento', new.nombre, 'rol', 'admin'), 'aviso');
  end if;
  if new.pin_supervisor_huella is distinct from old.pin_supervisor_huella then
    perform ticket_interno.auditar(new.owner_id, 'pin_cambiado', 'ticket_eventos', new.id::text, jsonb_build_object('evento', new.nombre, 'rol', 'supervisor'), 'aviso');
  end if;
  if new.anular_pin is distinct from old.anular_pin then
    perform ticket_interno.auditar(new.owner_id, 'permiso_cambiado', 'ticket_eventos', new.id::text,
      jsonb_build_object('evento', new.nombre, 'anular_con_pin', new.anular_pin), 'aviso');
  end if;
  if new.borrado_en is distinct from old.borrado_en then
    perform ticket_interno.auditar(new.owner_id, case when new.borrado_en is null then 'evento_restaurado' else 'evento_a_papelera' end,
      'ticket_eventos', new.id::text, jsonb_build_object('evento', new.nombre), 'aviso');
  end if;
  return null;
end $$;
drop trigger if exists ticket_eventos_auditoria on public.ticket_eventos;
create trigger ticket_eventos_auditoria after update or delete on public.ticket_eventos
  for each row execute function ticket_interno.eventos_tras();

-- ============================================================ 11. PIN: nunca en claro
create or replace function ticket_interno.pbkdf2_sha256(p_secreto text, p_sal bytea, p_vueltas int)
returns bytea language plpgsql immutable set search_path = '' as $$
declare u bytea; acc bit(256); i int; k bytea := convert_to(normalize(p_secreto, NFC), 'UTF8'); h text := '';
begin
  u := extensions.hmac(p_sal || '\x00000001'::bytea, k, 'sha256');
  acc := ('x' || encode(u, 'hex'))::bit(256);
  for i in 2..p_vueltas loop
    u := extensions.hmac(u, k, 'sha256');
    acc := acc # ('x' || encode(u, 'hex'))::bit(256);
  end loop;
  for i in 0..7 loop h := h || lpad(to_hex(substring(acc from i * 32 + 1 for 32)::bigint), 8, '0'); end loop;
  return decode(h, 'hex');
end $$;

-- Mismo formato que src/pin.js: v1$vueltas$tipo$largo$sal$huella (base64)
create or replace function ticket_interno.huella_pin(p_secreto text)
returns text language plpgsql volatile set search_path = '' as $$
declare v_sal bytea := extensions.gen_random_bytes(16); v_tipo text := case when p_secreto ~ '^\d+$' then 'pin' else 'clave' end;
begin
  return concat_ws('$', 'v1', '210000', v_tipo, case when v_tipo = 'pin' then char_length(p_secreto) else 0 end,
                   encode(v_sal, 'base64'), encode(ticket_interno.pbkdf2_sha256(p_secreto, v_sal, 210000), 'base64'));
end $$;
revoke all on function ticket_interno.pbkdf2_sha256(text, bytea, int) from public, anon;
revoke all on function ticket_interno.huella_pin(text) from public, anon;
grant execute on function ticket_interno.pbkdf2_sha256(text, bytea, int) to authenticated;
grant execute on function ticket_interno.huella_pin(text) to authenticated;

-- Sustituye la transición antigua: un PIN que llega en claro se guarda como huella; el de fábrica no se guarda
create or replace function public.ticket_eventos_pin_transicion()
returns trigger language plpgsql set search_path to '' as $function$
begin
  if tg_op = 'INSERT' or new.pin_admin is distinct from old.pin_admin then
    if new.pin_admin is null or new.pin_admin = '' or new.pin_admin = '1234' then
      new.pin_admin := null;
    else
      new.pin_admin_huella := ticket_interno.huella_pin(new.pin_admin);
      new.pin_admin := null;
    end if;
  end if;
  if tg_op = 'INSERT' or new.pin_supervisor is distinct from old.pin_supervisor then
    if new.pin_supervisor is null or new.pin_supervisor = '' or new.pin_supervisor = '0000' then
      new.pin_supervisor := null;
    else
      new.pin_supervisor_huella := ticket_interno.huella_pin(new.pin_supervisor);
      new.pin_supervisor := null;
    end if;
  end if;
  return new;
end $function$;
drop trigger if exists ticket_eventos_pin_transicion on public.ticket_eventos;
create trigger ticket_eventos_pin_transicion before insert or update of pin_admin, pin_supervisor on public.ticket_eventos
  for each row execute function public.ticket_eventos_pin_transicion();
alter table public.ticket_eventos alter column pin_admin drop default, alter column pin_supervisor drop default;

-- Las funciones internas de disparadores no deben poder llamarse desde fuera
revoke all on all functions in schema ticket_interno from public, anon;
grant execute on all functions in schema ticket_interno to authenticated;

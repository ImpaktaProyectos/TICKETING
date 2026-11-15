-- =====================================================================
-- TIXFAST · MODALIDAD MULTIPUESTO (food trucks, puestos y proveedores que canjean tickets)
-- ---------------------------------------------------------------------
-- La organización vende en sus cajas (el TPV de siempre) tickets con QR de un solo uso.
-- Cada PUESTO (food truck, caseta, operador…) canjea con su propio móvil los tickets de los
-- productos que tiene permitidos. La venta sigue siendo de la organización; el canje guarda
-- qué puesto entregó la consumición, a qué hora exacta y por cuánto valor.
--
-- · Modalidad del evento: ticket_eventos.ticket_style ->> 'modalidad' = 'multipuesto'
--   (sin columna nueva: los eventos estándar no cambian en nada).
-- · ticket_puestos: cada puesto, su comisión general (% o € por unidad) y su acceso.
-- · ticket_puesto_productos: qué consumiciones acepta cada puesto (por nombre de producto,
--   así «Hamburguesa» de la Caja 1 y de la Caja 2 es la misma) y su comisión si es distinta.
-- · Acceso del puesto (un móvil = un «dispositivo» del puesto):
--   1) El organizador lo ACTIVA con un código de un solo uso: QR que se escanea allí mismo (15 min)
--      o enlace que se envía (24 h). Solo se guarda su huella (sha-256).
--   2) La primera vez, el food truck CREA SU PROPIO PIN de 6 cifras (bcrypt; el organizador no lo ve).
--   3) El móvil queda desbloqueado 12 horas; después pide el PIN del puesto para otras 12 h.
--      5 PIN fallidos → 15 minutos bloqueado. El móvil queda vinculado hasta el final del evento
--      (12 h después del fin; sin fin, 3 días) y el organizador puede desconectarlo cuando quiera.
--   4) El PIN también sirve para salir del «modo mostrador» (lector de cara al público, sin datos).
-- · El canje de un puesto SIEMPRE lo decide el servidor (sin internet no se da nada por bueno).
--   Un ticket de un producto que el puesto no acepta → «no válido aquí» y el ticket NO se gasta.
-- · El canje del TPV (ticket_canjear) sigue igual: ahora llama al mismo núcleo con puesto = null.
-- · Cada puesto solo ve lo suyo (funciones puesto_*). El organizador lo ve todo (funciones puestos_*).
-- =====================================================================

-- ---------- Tablas ----------
create table if not exists public.ticket_puestos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  evento_id uuid not null references public.ticket_eventos(id) on delete cascade,
  nombre text not null check (length(btrim(nombre)) between 1 and 60),
  color text not null default '#ff5a3c' check (color ~ '^#[0-9a-fA-F]{6}$'),
  contacto text check (contacto is null or length(contacto) <= 120),
  activo boolean not null default true,
  comision_tipo text not null default 'pct' check (comision_tipo in ('pct', 'fijo')),
  comision_valor numeric(10,2) not null default 0 check (comision_valor >= 0 and comision_valor <= 10000),
  pin_huella text,                           -- bcrypt del PIN que crea el propio puesto
  pin_creado_en timestamptz,
  intentos int not null default 0,
  bloqueado_hasta timestamptz,
  activar_huella text unique,                -- sha-256 del código de activación (un solo uso)
  activar_caduca timestamptz,
  orden int not null default 0,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint ticket_puestos_pct check (comision_tipo <> 'pct' or comision_valor <= 100)
);
create unique index if not exists ticket_puestos_nombre on public.ticket_puestos (evento_id, lower(btrim(nombre)));
create index if not exists ticket_puestos_evento on public.ticket_puestos (evento_id, orden);
alter table public.ticket_puestos enable row level security;
revoke all on public.ticket_puestos from anon, authenticated;   -- solo por funciones (las huellas nunca salen)

create table if not exists public.ticket_puesto_productos (
  puesto_id uuid not null references public.ticket_puestos(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  consumicion text not null check (length(consumicion) between 1 and 80),   -- nombre del producto normalizado
  comision_tipo text check (comision_tipo is null or comision_tipo in ('pct', 'fijo')),
  comision_valor numeric(10,2) check (comision_valor is null or (comision_valor >= 0 and comision_valor <= 10000)),
  primary key (puesto_id, consumicion),
  constraint ticket_puesto_productos_par check ((comision_tipo is null) = (comision_valor is null)),
  constraint ticket_puesto_productos_pct check (comision_tipo is distinct from 'pct' or comision_valor <= 100)
);
alter table public.ticket_puesto_productos enable row level security;
revoke all on public.ticket_puesto_productos from anon, authenticated;

create table if not exists public.ticket_puesto_sesiones (
  id uuid primary key default gen_random_uuid(),
  puesto_id uuid not null references public.ticket_puestos(id) on delete cascade,
  huella text not null unique,               -- sha-256 (hex) del secreto del móvil
  dispositivo text check (dispositivo is null or length(dispositivo) <= 80),
  creada_en timestamptz not null default now(),
  caduca_en timestamptz not null,           -- hasta cuándo queda vinculado este móvil
  desbloqueado_hasta timestamptz not null,   -- hasta cuándo puede escanear sin volver a poner el PIN (12 h)
  ultimo_uso timestamptz not null default now(),
  revocada boolean not null default false
);
create index if not exists ticket_puesto_sesiones_puesto on public.ticket_puesto_sesiones (puesto_id) where not revocada;
alter table public.ticket_puesto_sesiones enable row level security;
revoke all on public.ticket_puesto_sesiones from anon, authenticated;

-- Los canjes y rechazos guardan el puesto y el valor de la consumición (PVP)
alter table public.ticket_canjes add column if not exists puesto_id uuid references public.ticket_puestos(id);   -- un puesto con canjes no se borra (se desactiva)
alter table public.ticket_canjes add column if not exists valor numeric(10,2);
alter table public.ticket_canjes drop constraint if exists ticket_canjes_origen_check;
alter table public.ticket_canjes add constraint ticket_canjes_origen_check check (origen = any (array['qr', 'folio', 'web', 'puesto']));
alter table public.ticket_canje_rechazos add column if not exists puesto_id uuid references public.ticket_puestos(id) on delete cascade;
create index if not exists ticket_canjes_puesto on public.ticket_canjes (puesto_id, canjeado_en desc) where puesto_id is not null;
create index if not exists ticket_canje_rechazos_puesto on public.ticket_canje_rechazos (puesto_id, creado_en desc) where puesto_id is not null;

-- Plan: crear puestos necesita «multipuesto» y respeta «puestos_por_evento»
drop trigger if exists ticket_plan_ticket_puestos on public.ticket_puestos;
create trigger ticket_plan_ticket_puestos before insert on public.ticket_puestos for each row execute function public.ticket_funcion_permitida('multipuesto');
drop trigger if exists ticket_limite_puestos on public.ticket_puestos;
create trigger ticket_limite_puestos before insert on public.ticket_puestos for each row execute function public.ticket_limite_plan('puestos_por_evento');

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

-- ---------- Organizador: gestión de puestos ----------
create or replace function public.ticket_dueno_evento(p_evento uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not exists (select 1 from public.ticket_eventos where id = p_evento and owner_id = (select auth.uid())) then
    raise exception using errcode = '42501', message = 'TIXFAST: ese evento no es tuyo.';
  end if;
end $$;
revoke all on function public.ticket_dueno_evento(uuid) from public, anon, authenticated;

-- Crear o editar un puesto. p = { id?, evento_id, nombre, color, contacto, activo, comision_tipo, comision_valor,
--   productos: [{ consumicion, comision_tipo?, comision_valor? }] }
create or replace function public.puesto_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_ev uuid := nullif(p ->> 'evento_id', '')::uuid; v_uid uuid := (select auth.uid());
  v_tipo text := coalesce(nullif(p ->> 'comision_tipo', ''), 'pct'); v_val numeric := round(coalesce(nullif(p ->> 'comision_valor', '')::numeric, 0), 2);
  x jsonb; n int := 0;
begin
  if v_id is not null then select evento_id into v_ev from public.ticket_puestos where id = v_id and owner_id = v_uid; end if;
  if length(btrim(coalesce(p ->> 'nombre', ''))) not between 1 and 60 then raise exception using errcode = 'P0001', message = 'TIXFAST: ponle un nombre al puesto (máximo 60 letras).'; end if;
  perform public.ticket_dueno_evento(v_ev);
  if not public.ticket_es_multipuesto(v_ev) then raise exception using errcode = 'P0001', message = 'TIXFAST: el evento no es Multipuesto.'; end if;
  if v_tipo not in ('pct', 'fijo') or v_val < 0 or (v_tipo = 'pct' and v_val > 100) or v_val > 10000 then
    raise exception using errcode = 'P0001', message = 'TIXFAST: la comisión no es válida.'; end if;
  if jsonb_typeof(coalesce(p -> 'productos', '[]')) <> 'array' or jsonb_array_length(coalesce(p -> 'productos', '[]')) > 200 then
    raise exception using errcode = 'P0001', message = 'TIXFAST: lista de productos no válida.'; end if;
  if v_id is null then
    insert into public.ticket_puestos (owner_id, evento_id, nombre, color, contacto, activo, comision_tipo, comision_valor, orden)
    values (v_uid, v_ev, btrim(p ->> 'nombre'), coalesce(nullif(p ->> 'color', ''), '#ff5a3c'), nullif(btrim(coalesce(p ->> 'contacto', '')), ''),
      coalesce((p ->> 'activo')::boolean, true), v_tipo, v_val, (select coalesce(max(orden), 0) + 1 from public.ticket_puestos where evento_id = v_ev))
    returning id into v_id;
  else
    update public.ticket_puestos set nombre = btrim(p ->> 'nombre'), color = coalesce(nullif(p ->> 'color', ''), color),
      contacto = nullif(btrim(coalesce(p ->> 'contacto', '')), ''), activo = coalesce((p ->> 'activo')::boolean, activo),
      comision_tipo = v_tipo, comision_valor = v_val, actualizado_en = now()
    where id = v_id;
    -- Desactivar el puesto cierra sus sesiones al momento
    if not coalesce((p ->> 'activo')::boolean, true) then
      update public.ticket_puesto_sesiones set revocada = true where puesto_id = v_id and not revocada;
      update public.ticket_puestos set activar_huella = null, activar_caduca = null where id = v_id;
    end if;
  end if;
  delete from public.ticket_puesto_productos where puesto_id = v_id;
  for x in select * from jsonb_array_elements(coalesce(p -> 'productos', '[]')) loop
    if public.ticket_consumicion(x ->> 'consumicion') = '' then continue; end if;
    insert into public.ticket_puesto_productos (puesto_id, owner_id, consumicion, comision_tipo, comision_valor)
    values (v_id, v_uid, public.ticket_consumicion(x ->> 'consumicion'), nullif(x ->> 'comision_tipo', ''), round(nullif(x ->> 'comision_valor', '')::numeric, 2))
    on conflict (puesto_id, consumicion) do nothing;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'id', v_id, 'productos', n);
exception when unique_violation then
  raise exception using errcode = 'P0001', message = 'TIXFAST: ya hay un puesto con ese nombre en este evento.';
end $$;
revoke all on function public.puesto_guardar(jsonb) from public, anon;
grant execute on function public.puesto_guardar(jsonb) to authenticated;

-- Olvidó el PIN: se borra y, al activar de nuevo un móvil con el QR, el puesto crea otro
create or replace function public.puesto_borrar_pin(p_puesto uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ev uuid;
begin
  select evento_id into v_ev from public.ticket_puestos where id = p_puesto and owner_id = (select auth.uid());
  perform public.ticket_dueno_evento(v_ev);
  update public.ticket_puestos set pin_huella = null, pin_creado_en = null, intentos = 0, bloqueado_hasta = null, actualizado_en = now() where id = p_puesto;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.puesto_borrar_pin(uuid) from public, anon;
grant execute on function public.puesto_borrar_pin(uuid) to authenticated;

-- Cerrar todas las sesiones abiertas de un puesto (p. ej. si pierde el móvil)
create or replace function public.puesto_cerrar_sesiones(p_puesto uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ev uuid; n int;
begin
  select evento_id into v_ev from public.ticket_puestos where id = p_puesto and owner_id = (select auth.uid());
  perform public.ticket_dueno_evento(v_ev);
  update public.ticket_puesto_sesiones set revocada = true where puesto_id = p_puesto and not revocada;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'cerradas', n);
end $$;
revoke all on function public.puesto_cerrar_sesiones(uuid) from public, anon;
grant execute on function public.puesto_cerrar_sesiones(uuid) to authenticated;

-- Borrar un puesto: solo si no ha canjeado nada (si ya tiene canjes, se desactiva y su registro se conserva)
create or replace function public.puesto_borrar(p_puesto uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ev uuid;
begin
  select evento_id into v_ev from public.ticket_puestos where id = p_puesto and owner_id = (select auth.uid());
  perform public.ticket_dueno_evento(v_ev);
  if exists (select 1 from public.ticket_canjes where puesto_id = p_puesto) then
    update public.ticket_puestos set activo = false, actualizado_en = now() where id = p_puesto;
    update public.ticket_puesto_sesiones set revocada = true where puesto_id = p_puesto and not revocada;
    return jsonb_build_object('ok', true, 'resultado', 'desactivado');
  end if;
  delete from public.ticket_puestos where id = p_puesto;
  return jsonb_build_object('ok', true, 'resultado', 'borrado');
end $$;
revoke all on function public.puesto_borrar(uuid) from public, anon;
grant execute on function public.puesto_borrar(uuid) to authenticated;

-- Puestos del evento con lo que aceptan, su acceso (sin secretos) y sus totales
create or replace function public.puestos_evento(p_evento uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.ticket_dueno_evento(p_evento);
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre, 'color', p.color, 'contacto', p.contacto, 'activo', p.activo,
      'comision_tipo', p.comision_tipo, 'comision_valor', p.comision_valor,
      'tiene_pin', p.pin_huella is not null, 'pin_creado_en', p.pin_creado_en,
      'bloqueado', coalesce(p.bloqueado_hasta > now(), false), 'intentos', p.intentos,
      'sesiones', (select count(*) from public.ticket_puesto_sesiones s where s.puesto_id = p.id and not s.revocada and s.caduca_en > now()),
      'ultimo_uso', (select max(s.ultimo_uso) from public.ticket_puesto_sesiones s where s.puesto_id = p.id and not s.revocada),
      'productos', coalesce((select jsonb_agg(jsonb_build_object('consumicion', pp.consumicion, 'comision_tipo', pp.comision_tipo, 'comision_valor', pp.comision_valor) order by pp.consumicion)
          from public.ticket_puesto_productos pp where pp.puesto_id = p.id), '[]'::jsonb),
      'canjes', (select count(*) from public.ticket_canjes c where c.puesto_id = p.id))
    order by p.orden, p.creado_en) from public.ticket_puestos p where p.evento_id = p_evento), '[]'::jsonb);
end $$;
revoke all on function public.puestos_evento(uuid) from public, anon;
grant execute on function public.puestos_evento(uuid) to authenticated;

-- Liquidación: por puesto y consumición → unidades, valor (PVP), comisión del organizador y a pagar al puesto.
-- La comisión se calcula con la configuración actual (si se corrige, la liquidación se corrige).
-- «canjeadas»: todo lo canjeado del evento por consumición (puestos y barras propias), para saber lo pendiente.
create or replace function public.puestos_liquidacion(p_evento uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.ticket_dueno_evento(p_evento);
  return jsonb_build_object(
    'filas', coalesce((select jsonb_agg(jsonb_build_object('puesto_id', x.puesto_id, 'consumicion', x.consumicion, 'nombre', x.nombre,
        'unidades', x.unidades, 'valor', x.valor, 'comision', x.comision, 'neto', x.valor - x.comision, 'primero', x.primero, 'ultimo', x.ultimo))
      from (
        select c.puesto_id, public.ticket_consumicion(c.nombre) consumicion, btrim(min(c.nombre)) nombre, sum(c.unidades)::int unidades,
          coalesce(sum(c.valor * c.unidades), 0) valor,
          coalesce(sum(public.ticket_comision(c.valor, coalesce(pp.comision_tipo, p.comision_tipo), coalesce(pp.comision_valor, p.comision_valor)) * c.unidades), 0) comision,
          min(c.canjeado_en) primero, max(c.canjeado_en) ultimo
        from public.ticket_canjes c join public.ticket_puestos p on p.id = c.puesto_id
        left join public.ticket_puesto_productos pp on pp.puesto_id = c.puesto_id and pp.consumicion = public.ticket_consumicion(c.nombre)
        where c.evento_id = p_evento and c.puesto_id is not null
        group by c.puesto_id, public.ticket_consumicion(c.nombre)
      ) x), '[]'::jsonb),
    'canjeadas', coalesce((select jsonb_object_agg(y.consumicion, y.unidades) from (
        select public.ticket_consumicion(c.nombre) consumicion, sum(c.unidades)::int unidades
        from public.ticket_canjes c where c.evento_id = p_evento and c.origen <> 'web' group by 1) y), '{}'::jsonb),
    'ahora', now());
end $$;
revoke all on function public.puestos_liquidacion(uuid) from public, anon;
grant execute on function public.puestos_liquidacion(uuid) to authenticated;

-- Registro de un puesto: cada canje y cada rechazo con su hora exacta
create or replace function public.puestos_registro(p_puesto uuid, p_limite int default 2000)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare pu record;
begin
  select * into pu from public.ticket_puestos where id = p_puesto and owner_id = (select auth.uid());
  perform public.ticket_dueno_evento(pu.evento_id);
  return jsonb_build_object(
    'canjes', coalesce((select jsonb_agg(jsonb_build_object('t', c.canjeado_en, 'nombre', c.nombre, 'unidades', c.unidades, 'valor', c.valor,
        'comision', public.ticket_comision(c.valor, coalesce(pp.comision_tipo, pu.comision_tipo), coalesce(pp.comision_valor, pu.comision_valor)) * c.unidades,
        'dispositivo', c.dispositivo, 'caja', pt.nombre) order by c.canjeado_en desc)
      from (select * from public.ticket_canjes where puesto_id = p_puesto order by canjeado_en desc limit least(greatest(coalesce(p_limite, 2000), 1), 20000)) c
      left join public.ticket_puesto_productos pp on pp.puesto_id = p_puesto and pp.consumicion = public.ticket_consumicion(c.nombre)
      left join public.ticket_puntos pt on pt.id = c.punto_venta_id), '[]'::jsonb),
    'rechazos', coalesce((select jsonb_agg(jsonb_build_object('t', r.creado_en, 'motivo', r.motivo, 'nombre', r.detalle ->> 'nombre', 'dispositivo', r.dispositivo) order by r.creado_en desc)
      from (select * from public.ticket_canje_rechazos where puesto_id = p_puesto order by creado_en desc limit 1000) r), '[]'::jsonb));
end $$;
revoke all on function public.puestos_registro(uuid, int) from public, anon;
grant execute on function public.puestos_registro(uuid, int) to authenticated;

-- ---------- Puesto (food truck): activado por el organizador, con su propio PIN, y solo ve lo suyo ----------
-- Vincula un móvil al puesto (tras activarlo con el código del organizador): desbloqueado 12 h
create or replace function public.ticket_puesto_sesion_nueva(p_puesto uuid, p_dispositivo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_sec text; v_cad timestamptz; pu record;
begin
  select p.nombre, p.color, p.pin_huella is null as sin_pin, e.nombre as evento, e.fin into pu
    from public.ticket_puestos p join public.ticket_eventos e on e.id = p.evento_id where p.id = p_puesto;
  v_sec := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  v_cad := least(case when pu.fin is null then now() + interval '3 days' else greatest(pu.fin, now()) + interval '12 hours' end, now() + interval '7 days');
  insert into public.ticket_puesto_sesiones (puesto_id, huella, dispositivo, caduca_en, desbloqueado_hasta)
  values (p_puesto, encode(extensions.digest(v_sec, 'sha256'), 'hex'), left(nullif(btrim(coalesce(p_dispositivo, '')), ''), 80), v_cad, least(now() + interval '12 hours', v_cad));
  return jsonb_build_object('ok', true, 'sesion', v_sec, 'caduca_en', v_cad, 'desbloqueado_hasta', least(now() + interval '12 hours', v_cad),
    'necesita_pin', pu.sin_pin, 'puesto', pu.nombre, 'color', pu.color, 'evento', pu.evento);
end $$;
revoke all on function public.ticket_puesto_sesion_nueva(uuid, text) from public, anon, authenticated;

-- Código de activación (organizador): un solo uso. 15 min para escanearlo allí; hasta 24 h para enviarlo.
create or replace function public.puesto_codigo_activar(p_puesto uuid, p_minutos int default 15)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ev uuid; v_cod text; v_cad timestamptz := now() + make_interval(mins => least(greatest(coalesce(p_minutos, 15), 5), 1440));
begin
  select evento_id into v_ev from public.ticket_puestos where id = p_puesto and owner_id = (select auth.uid()) and activo;
  if v_ev is null then raise exception using errcode = 'P0001', message = 'TIXFAST: el puesto no existe o está desactivado.'; end if;
  perform public.ticket_dueno_evento(v_ev);
  v_cod := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  update public.ticket_puestos set activar_huella = encode(extensions.digest(v_cod, 'sha256'), 'hex'), activar_caduca = v_cad where id = p_puesto;
  return jsonb_build_object('ok', true, 'codigo', v_cod, 'caduca_en', v_cad);
end $$;
revoke all on function public.puesto_codigo_activar(uuid, int) from public, anon;
grant execute on function public.puesto_codigo_activar(uuid, int) to authenticated;

-- El móvil del puesto usa el código: queda vinculado y desbloqueado 12 h; el código deja de valer
create or replace function public.puesto_activar(p_codigo text, p_dispositivo text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p record;
begin
  if length(coalesce(p_codigo, '')) not between 24 and 64 then return jsonb_build_object('ok', false, 'motivo', 'codigo'); end if;
  select x.* into p from public.ticket_puestos x join public.ticket_eventos e on e.id = x.evento_id
   where x.activar_huella = encode(extensions.digest(p_codigo, 'sha256'), 'hex') and x.activar_caduca > now()
     and x.activo and e.ticket_style ->> 'modalidad' = 'multipuesto'
   for update of x;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'codigo'); end if;
  update public.ticket_puestos set activar_huella = null, activar_caduca = null where id = p.id;
  return public.ticket_puesto_sesion_nueva(p.id, p_dispositivo);
end $$;
revoke all on function public.puesto_activar(text, text) from public;
grant execute on function public.puesto_activar(text, text) to anon, authenticated;

-- El móvil vinculado (aunque esté bloqueado): su sesión o nada
create or replace function public.ticket_puesto_movil(p_sesion text)
returns public.ticket_puesto_sesiones language sql stable security definer set search_path = '' as $$
  select x.* from public.ticket_puesto_sesiones x join public.ticket_puestos p on p.id = x.puesto_id join public.ticket_eventos e on e.id = p.evento_id
  where length(coalesce(p_sesion, '')) between 30 and 64 and x.huella = encode(extensions.digest(p_sesion, 'sha256'), 'hex')
    and not x.revocada and x.caduca_en > now() and p.activo and e.ticket_style ->> 'modalidad' = 'multipuesto';
$$;
revoke all on function public.ticket_puesto_movil(text) from public, anon, authenticated;

-- Estado del móvil: a qué puesto pertenece, si está desbloqueado y si el puesto aún no tiene PIN
create or replace function public.puesto_estado(p_sesion text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare m public.ticket_puesto_sesiones; pu record;
begin
  m := public.ticket_puesto_movil(p_sesion);
  if m.id is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  select p.nombre, p.color, p.pin_huella is null as sin_pin, coalesce(p.bloqueado_hasta > now(), false) as bloqueado, p.bloqueado_hasta, e.nombre as evento
    into pu from public.ticket_puestos p join public.ticket_eventos e on e.id = p.evento_id where p.id = m.puesto_id;
  return jsonb_build_object('ok', true, 'puesto', pu.nombre, 'color', pu.color, 'evento', pu.evento, 'necesita_pin', pu.sin_pin,
    'desbloqueado', m.desbloqueado_hasta > now(), 'desbloqueado_hasta', m.desbloqueado_hasta, 'bloqueado_pin', pu.bloqueado, 'bloqueado_hasta', pu.bloqueado_hasta);
end $$;
revoke all on function public.puesto_estado(text) from public;
grant execute on function public.puesto_estado(text) to anon, authenticated;

-- El puesto crea su propio PIN (solo si aún no tiene y desde un móvil recién activado y desbloqueado)
create or replace function public.puesto_crear_pin(p_sesion text, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.ticket_puesto_sesiones; n int;
begin
  m := public.ticket_puesto_movil(p_sesion);
  if m.id is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if m.desbloqueado_hasta <= now() then return jsonb_build_object('ok', false, 'motivo', 'bloqueada'); end if;
  if coalesce(p_pin, '') !~ '^\d{6}$' or p_pin ~ '^(\d)\1{5}$' or p_pin in ('123456', '654321', '012345') then
    return jsonb_build_object('ok', false, 'motivo', 'pin_debil'); end if;
  update public.ticket_puestos set pin_huella = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), pin_creado_en = now(), intentos = 0, bloqueado_hasta = null, actualizado_en = now()
   where id = m.puesto_id and pin_huella is null;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'motivo', 'ya_tiene'); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.puesto_crear_pin(text, text) from public;
grant execute on function public.puesto_crear_pin(text, text) to anon, authenticated;

-- PIN del puesto: desbloquea este móvil otras 12 h (también para salir del modo mostrador)
create or replace function public.puesto_desbloquear(p_sesion text, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.ticket_puesto_sesiones; p record; v_hasta timestamptz;
begin
  m := public.ticket_puesto_movil(p_sesion);
  if m.id is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  select * into p from public.ticket_puestos where id = m.puesto_id for update;
  if p.pin_huella is null then return jsonb_build_object('ok', false, 'motivo', 'sin_pin'); end if;
  if p.bloqueado_hasta > now() then return jsonb_build_object('ok', false, 'motivo', 'bloqueado', 'hasta', p.bloqueado_hasta); end if;
  if coalesce(p_pin, '') !~ '^\d{6}$' or extensions.crypt(p_pin, p.pin_huella) <> p.pin_huella then
    -- PIN incorrecto: al quinto fallo seguido, 15 minutos bloqueado (en todos los móviles del puesto)
    update public.ticket_puestos set intentos = case when intentos + 1 >= 5 then 0 else intentos + 1 end,
      bloqueado_hasta = case when intentos + 1 >= 5 then now() + interval '15 minutes' else bloqueado_hasta end where id = p.id;
    return jsonb_build_object('ok', false, 'motivo', case when p.intentos + 1 >= 5 then 'bloqueado' else 'pin' end, 'quedan', greatest(0, 4 - p.intentos));
  end if;
  update public.ticket_puestos set intentos = 0, bloqueado_hasta = null where id = p.id;
  v_hasta := least(now() + interval '12 hours', m.caduca_en);
  update public.ticket_puesto_sesiones set desbloqueado_hasta = v_hasta, ultimo_uso = now() where id = m.id;
  return jsonb_build_object('ok', true, 'desbloqueado_hasta', v_hasta);
end $$;
revoke all on function public.puesto_desbloquear(text, text) from public;
grant execute on function public.puesto_desbloquear(text, text) to anon, authenticated;

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

create or replace function public.puesto_salir(p_sesion text)
returns jsonb language sql security definer set search_path = '' as $$
  update public.ticket_puesto_sesiones set revocada = true where huella = encode(extensions.digest(coalesce(p_sesion, ''), 'sha256'), 'hex')
  returning jsonb_build_object('ok', true);
$$;
revoke all on function public.puesto_salir(text) from public;
grant execute on function public.puesto_salir(text) to anon, authenticated;

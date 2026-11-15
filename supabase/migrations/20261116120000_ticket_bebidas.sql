-- =====================================================================
-- TIXFAST · FICHA DE BEBIDAS DEL CLIENTE (enlace propio por reservado)
-- ---------------------------------------------------------------------
-- Para que antes del evento TODAS las reservas tengan las botellas apuntadas, aunque la
-- reserva entrara por teléfono: desde la ficha del reservado se genera un enlace secreto
-- (/b/<token>) que se manda al cliente. El cliente SOLO ve su mesa, el evento y las listas
-- de bebidas: elige bebida y mezcla de cada botella (y extras, con su precio si lo hay) y
-- sus botellas se vuelcan solas en el pedido del reservado. Puede cambiarlas por el mismo
-- enlace hasta el día siguiente al evento. Nada más es visible ni modificable desde fuera.
-- =====================================================================

create table if not exists public.ticket_bebidas_fichas (
  id uuid primary key default gen_random_uuid(),          -- el propio enlace secreto
  owner_id uuid not null references auth.users(id) on delete cascade,
  evento_id uuid not null references public.ticket_eventos(id) on delete cascade,
  reservado_id uuid not null unique references public.ticket_reservados(id) on delete cascade,
  datos jsonb not null check (jsonb_typeof(datos) = 'object' and pg_column_size(datos) <= 20000),
  fecha date,                                             -- día del evento: el enlace vale hasta el día siguiente
  activo boolean not null default true,
  respuestas int not null default 0,
  respondido_en timestamptz,
  creado_en timestamptz not null default now()
);
alter table public.ticket_bebidas_fichas enable row level security;
drop policy if exists owner_ver on public.ticket_bebidas_fichas;
create policy owner_ver on public.ticket_bebidas_fichas for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists owner_borrar on public.ticket_bebidas_fichas;
create policy owner_borrar on public.ticket_bebidas_fichas for delete to authenticated using (owner_id = (select auth.uid()));
revoke all on public.ticket_bebidas_fichas from anon;
grant select, delete on public.ticket_bebidas_fichas to authenticated;

-- ---------- El organizador pide las bebidas: crea (o renueva) la ficha y devuelve el enlace ----------
create or replace function public.bebidas_solicitar(p_reservado uuid, p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; d jsonb; f date; tk uuid;
begin
  select * into r from public.ticket_reservados where id = p_reservado and owner_id = (select auth.uid());
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if jsonb_typeof(p_datos) <> 'object' or pg_column_size(p_datos) > 20000 then return jsonb_build_object('ok', false, 'motivo', 'datos'); end if;
  -- Solo los campos esperados, recortados (el cliente no debe ver nada más)
  d := jsonb_build_object(
    'evento', left(btrim(coalesce(p_datos ->> 'evento', '')), 80),
    'mesa', left(btrim(coalesce(p_datos ->> 'mesa', '')), 40),
    'cliente', left(btrim(split_part(coalesce(p_datos ->> 'cliente', ''), ' ', 1)), 30),
    'incluidas', least(greatest(coalesce(nullif(p_datos ->> 'incluidas', '')::int, 0), 0), 12),
    'max_extra', least(greatest(coalesce(nullif(p_datos ->> 'max_extra', '')::int, 0), 0), 12),
    'precio_extra', case when (p_datos ->> 'precio_extra') ~ '^\d+(\.\d+)?$' then round((p_datos ->> 'precio_extra')::numeric, 2) end,
    'bebidas', coalesce((select jsonb_agg(v) from (select left(btrim(x), 60) v from jsonb_array_elements_text(
        case when jsonb_typeof(p_datos -> 'bebidas') = 'array' then p_datos -> 'bebidas' else '[]'::jsonb end) x
        where btrim(x) <> '' limit 80) s), '[]'::jsonb),
    'mezclas', coalesce((select jsonb_agg(v) from (select left(btrim(x), 60) v from jsonb_array_elements_text(
        case when jsonb_typeof(p_datos -> 'mezclas') = 'array' then p_datos -> 'mezclas' else '[]'::jsonb end) x
        where btrim(x) <> '' limit 40) s), '[]'::jsonb));
  if jsonb_array_length(d -> 'bebidas') = 0 or jsonb_array_length(d -> 'mezclas') = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'datos');
  end if;
  f := case when (p_datos ->> 'fecha') ~ '^\d{4}-\d{2}-\d{2}' then left(p_datos ->> 'fecha', 10)::date end;
  insert into public.ticket_bebidas_fichas (owner_id, evento_id, reservado_id, datos, fecha)
    values (r.owner_id, r.evento_id, r.id, d, f)
  on conflict (reservado_id) do update set datos = excluded.datos, fecha = excluded.fecha, activo = true
  returning id into tk;
  return jsonb_build_object('ok', true, 'token', tk);
end $$;
revoke all on function public.bebidas_solicitar(uuid, jsonb) from public, anon;
grant execute on function public.bebidas_solicitar(uuid, jsonb) to authenticated;

-- ---------- El cliente abre su ficha (solo su mesa y las listas; nada más) ----------
create or replace function public.bebidas_ficha(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare x record; bots jsonb;
begin
  select * into x from public.ticket_bebidas_fichas where id = p_token and activo;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if x.fecha is not null and current_date > x.fecha + 1 then return jsonb_build_object('ok', false, 'motivo', 'pasado'); end if;
  select coalesce((select jsonb_agg(jsonb_build_object('bebida', b ->> 'bebida', 'mezcla', b ->> 'mezcla'))
      from jsonb_array_elements(case when jsonb_typeof(r.pedido -> 'botellas') = 'array' then r.pedido -> 'botellas' else '[]'::jsonb end) b), '[]'::jsonb)
    into bots from public.ticket_reservados r where r.id = x.reservado_id;
  return x.datos || jsonb_build_object('ok', true, 'fecha', x.fecha, 'botellas', coalesce(bots, '[]'::jsonb),
    'respondido', x.respondido_en is not null);
end $$;
revoke all on function public.bebidas_ficha(uuid) from public;
grant execute on function public.bebidas_ficha(uuid) to anon, authenticated;

-- ---------- El cliente guarda sus botellas: se vuelcan en el pedido del reservado ----------
create or replace function public.bebidas_guardar(p_token uuid, p_botellas jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare x record; incl int; maxx int; bots jsonb; n int;
begin
  select * into x from public.ticket_bebidas_fichas where id = p_token and activo for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if x.fecha is not null and current_date > x.fecha + 1 then return jsonb_build_object('ok', false, 'motivo', 'pasado'); end if;
  if x.respuestas >= 30 then return jsonb_build_object('ok', false, 'motivo', 'limite'); end if;
  incl := coalesce((x.datos ->> 'incluidas')::int, 0);
  maxx := coalesce((x.datos ->> 'max_extra')::int, 0);
  select coalesce(jsonb_agg(jsonb_build_object('id', 'b_' || substr(md5(gen_random_uuid()::text), 1, 8),
      'bebida', left(btrim(coalesce(b ->> 'bebida', '')), 60), 'mezcla', left(btrim(coalesce(b ->> 'mezcla', '')), 60))), '[]'::jsonb)
    into bots from jsonb_array_elements(case when jsonb_typeof(p_botellas) = 'array' then p_botellas else '[]'::jsonb end) b;
  n := jsonb_array_length(bots);
  -- Imprescindible: todas las del pack elegidas (al menos una), sin pasarse del máximo,
  -- y cada una con bebida y mezcla de las listas ofrecidas
  if n < greatest(incl, 1) or n > incl + maxx then return jsonb_build_object('ok', false, 'motivo', 'botellas'); end if;
  if exists (select 1 from jsonb_array_elements(bots) b
             where not (x.datos -> 'bebidas' ? (b ->> 'bebida')) or not (x.datos -> 'mezclas' ? (b ->> 'mezcla'))) then
    return jsonb_build_object('ok', false, 'motivo', 'botellas');
  end if;
  update public.ticket_reservados
    set pedido = coalesce(case when jsonb_typeof(pedido) = 'object' then pedido end, '{}'::jsonb) || jsonb_build_object('botellas', bots)
    where id = x.reservado_id;
  update public.ticket_bebidas_fichas set respuestas = respuestas + 1, respondido_en = now() where id = x.id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.bebidas_guardar(uuid, jsonb) from public;
grant execute on function public.bebidas_guardar(uuid, jsonb) to anon, authenticated;

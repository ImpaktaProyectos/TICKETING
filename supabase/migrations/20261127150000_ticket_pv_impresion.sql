-- ===================== PUNTOS DE VENTA: IMPRESIÓN DE TALONARIOS CON QR =====================
-- Va después de 20261127141000_ticket_pv_panel_liquidadas.sql.
-- · Diseños de entrada por evento (15 × 10 cm): el del diseñador (PDF o imagen, encima solo se pone el QR) o el automático
--   que monta la plataforma a partir del flyer (con nombre, fecha, lugar, tipo de entrada y lo que incluye).
-- · Cada entrega recuerda su diseño y lo que incluye (p. ej. «1 copa»): una reimpresión sale idéntica.
-- · Tandas: varias entregas con QR de una vez (p. ej. 15 puntos × 100). O se crean todas o ninguna.
-- Solo añade una tabla, dos columnas y una función.

create table if not exists public.ticket_pv_disenos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  evento_id uuid not null references public.ticket_eventos(id) on delete cascade,
  nombre text not null default 'Diseño' check (length(nombre) between 1 and 80),
  modo text not null check (modo in ('propio', 'auto')),
  archivo_url text check (archivo_url is null or length(archivo_url) <= 600),
  archivo_tipo text check (archivo_tipo is null or archivo_tipo in ('pdf', 'imagen')),
  ajustes jsonb not null default '{}'::jsonb check (pg_column_size(ajustes) < 8000),
  numero boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  check (modo = 'auto' or archivo_url is not null)
);
create index if not exists ticket_pv_disenos_evento on public.ticket_pv_disenos (evento_id);
alter table public.ticket_pv_disenos enable row level security;
drop policy if exists pv_disenos_propios on public.ticket_pv_disenos;
create policy pv_disenos_propios on public.ticket_pv_disenos for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and exists (select 1 from public.ticket_eventos e where e.id = evento_id and e.owner_id = (select auth.uid())));
grant select, insert, update, delete on public.ticket_pv_disenos to authenticated;

alter table public.ticket_pv_lotes add column if not exists diseno_id uuid references public.ticket_pv_disenos(id) on delete set null;
alter table public.ticket_pv_lotes add column if not exists incluye text check (incluye is null or length(incluye) <= 80);
create index if not exists ticket_pv_lotes_diseno on public.ticket_pv_lotes (diseno_id);

-- Tandas: p_tandas = [{ pv, cantidad, nombre, precio, comision_tipo, comision_valor, incluye }]
create or replace function public.pv_crear_tandas(p_evento uuid, p_tandas jsonb, p_diseno uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); t jsonb; r jsonb; v_lotes jsonb := '[]'::jsonb; v_total int := 0; i int := 0;
begin
  if uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if jsonb_typeof(p_tandas) <> 'array' or jsonb_array_length(p_tandas) = 0 then return jsonb_build_object('ok', false, 'motivo', 'vacio'); end if;
  if jsonb_array_length(p_tandas) > 100 then return jsonb_build_object('ok', false, 'motivo', 'demasiadas'); end if;
  select coalesce(sum(greatest(coalesce((x ->> 'cantidad')::int, 0), 0)), 0) into v_total from jsonb_array_elements(p_tandas) x;
  if v_total > 10000 then return jsonb_build_object('ok', false, 'motivo', 'total'); end if;
  if p_diseno is not null and not exists (select 1 from public.ticket_pv_disenos d where d.id = p_diseno and d.evento_id = p_evento and d.owner_id = uid) then
    return jsonb_build_object('ok', false, 'motivo', 'diseno');
  end if;
  for t in select x from jsonb_array_elements(p_tandas) x loop
    i := i + 1;
    r := public.pv_crear_talonario(p_evento, (t ->> 'pv')::uuid, t ->> 'nombre', (t ->> 'precio')::numeric, (t ->> 'cantidad')::int,
                                   t ->> 'comision_tipo', (t ->> 'comision_valor')::numeric, null);
    if not coalesce((r ->> 'ok')::boolean, false) then
      -- Una sola que falle deshace todas: nunca quedan tandas a medias
      raise exception 'TANDA:%:%', i, coalesce(r ->> 'motivo', 'error');
    end if;
    update public.ticket_pv_lotes set diseno_id = p_diseno, incluye = nullif(left(btrim(coalesce(t ->> 'incluye', '')), 80), '')
     where id = (r ->> 'lote')::uuid;
    v_lotes := v_lotes || jsonb_build_array(r || jsonb_build_object('pv', t ->> 'pv'));
  end loop;
  return jsonb_build_object('ok', true, 'lotes', v_lotes, 'total', v_total);
end $$;
revoke all on function public.pv_crear_tandas(uuid, jsonb, uuid) from public, anon;
grant execute on function public.pv_crear_tandas(uuid, jsonb, uuid) to authenticated;

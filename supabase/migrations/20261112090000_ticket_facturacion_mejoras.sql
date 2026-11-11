-- ============ FACTURACIÓN · mejoras ============
-- 1) Numeración y registro solo desde fac_emitir (nadie puede tocar el contador ni inventarse registros).
-- 2) QR tributario desactivado por defecto mientras las facturas no se envíen a la AEAT.
-- 3) Recordatorios de cobro: fecha del último aviso (se puede anotar también en facturas emitidas).
-- 4) Facturas que se repiten: plantillas que preparan borradores solas (nunca se emiten sin que tú lo confirmes).

-- ---------- 1) Contador y registro, solo por fac_emitir ----------
drop policy if exists fac_contadores_alta on public.ticket_fac_contadores;
drop policy if exists fac_contadores_sube on public.ticket_fac_contadores;
drop policy if exists fac_registro_alta on public.ticket_fac_registro;
revoke insert, update, delete on public.ticket_fac_contadores from authenticated;
revoke insert, update, delete on public.ticket_fac_registro from authenticated;
-- fac_emitir ya filtra todo por auth.uid(); con security definer puede escribir contador y registro.
alter function public.fac_emitir(uuid) security definer;

-- ---------- 2) QR ----------
alter table public.ticket_fac_emisor alter column qr set default false;

-- ---------- 3) Recordatorios ----------
alter table public.ticket_fac_facturas add column if not exists recordada_en timestamptz;

create or replace function public.fac_inmutable() returns trigger language plpgsql set search_path to '' as $$
begin
  if tg_op = 'DELETE' then
    if old.tipo = 'emitida' and old.estado <> 'borrador' then
      raise exception 'Una factura emitida no se puede borrar: haz una rectificativa' using errcode = 'P0001';
    end if;
    return old;
  end if;
  new.actualizado_en := now();
  if old.tipo = 'emitida' and old.estado = 'borrador' and new.estado <> 'borrador'
     and coalesce(current_setting('tixfast.fac_emitiendo', true), '') <> 'si' then
    raise exception 'Las facturas se emiten con «Emitir» (numeración y registro)' using errcode = 'P0001';
  end if;
  if old.tipo = 'emitida' and old.estado <> 'borrador' then
    if new.estado not in ('emitida','pagada')
       or (to_jsonb(new) - array['estado','pagada_en','archivo_path','recordada_en','actualizado_en'])
          is distinct from (to_jsonb(old) - array['estado','pagada_en','archivo_path','recordada_en','actualizado_en']) then
      raise exception 'Una factura emitida no se puede modificar: haz una rectificativa' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.fac_inmutable() from public, anon, authenticated;

-- ---------- 4) Facturas que se repiten ----------
create table if not exists public.ticket_fac_recurrentes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre text not null check (length(btrim(nombre)) between 1 and 120),
  activa boolean not null default true,
  cada_meses int not null default 1 check (cada_meses in (1, 2, 3, 6, 12)),
  inicio date not null,                 -- primer periodo; los siguientes son inicio + n × cada_meses
  generadas int not null default 0 check (generadas >= 0),
  contacto_id uuid references public.ticket_fac_contactos(id) on delete set null,
  contacto jsonb not null default '{}'::jsonb,
  lineas jsonb not null default '[]'::jsonb check (jsonb_typeof(lineas) = 'array' and jsonb_array_length(lineas) between 1 and 200),
  irpf_pct numeric(5,2) not null default 0,
  forma_pago text check (length(forma_pago) <= 60),
  notas text check (length(notas) <= 2000),
  plantilla text check (plantilla in ('clasica','moderna','minimal')),
  ultima_factura_id uuid references public.ticket_fac_facturas(id) on delete set null,
  creado_en timestamptz not null default now(), actualizado_en timestamptz not null default now()
);
create index if not exists ticket_fac_recurrentes_owner_idx on public.ticket_fac_recurrentes (owner_id, activa);
create index if not exists ticket_fac_recurrentes_contacto_idx on public.ticket_fac_recurrentes (contacto_id);
create index if not exists ticket_fac_recurrentes_ultima_idx on public.ticket_fac_recurrentes (ultima_factura_id);
alter table public.ticket_fac_recurrentes enable row level security;
create policy fac_recurrentes_own on public.ticket_fac_recurrentes for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
revoke all on public.ticket_fac_recurrentes from anon;
grant select, insert, update, delete on public.ticket_fac_recurrentes to authenticated;

-- Prepara los borradores pendientes (uno por periodo vencido, como mucho 12 por plantilla y llamada).
-- En los conceptos y notas, {mes} y {año} se cambian por los del periodo.
create or replace function public.fac_generar_recurrentes() returns int
language plpgsql security invoker set search_path to '' as $$
declare r public.ticket_fac_recurrentes; uid uuid := auth.uid(); hoy date := (now() at time zone 'Europe/Madrid')::date;
  periodo date; n int := 0; k int; v_mes text; v_anio text; v_lineas jsonb; v_id uuid; v_venc int;
  meses text[] := array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
begin
  if uid is null then raise exception 'Sin sesión' using errcode = '42501'; end if;
  select vencimiento_dias into v_venc from public.ticket_fac_emisor where owner_id = uid;
  for r in select * from public.ticket_fac_recurrentes where owner_id = uid and activa for update skip locked loop
    k := 0;
    loop
      periodo := (r.inicio + make_interval(months => r.generadas * r.cada_meses))::date;
      exit when periodo > hoy or k >= 12;
      v_mes := meses[extract(month from periodo)::int]; v_anio := extract(year from periodo)::text;
      select coalesce(jsonb_agg(case when x ? 'concepto'
               then jsonb_set(x, '{concepto}', to_jsonb(replace(replace(x ->> 'concepto', '{mes}', v_mes), '{año}', v_anio)))
               else x end), '[]'::jsonb)
        into v_lineas from jsonb_array_elements(r.lineas) x;
      insert into public.ticket_fac_facturas (owner_id, tipo, estado, fecha, vencimiento, contacto_id, contacto, lineas, irpf_pct, forma_pago, notas, plantilla)
      values (uid, 'emitida', 'borrador', hoy, hoy + coalesce(v_venc, 30), r.contacto_id, r.contacto, v_lineas, r.irpf_pct, r.forma_pago,
              nullif(replace(replace(coalesce(r.notas, ''), '{mes}', v_mes), '{año}', v_anio), ''), r.plantilla)
      returning id into v_id;
      r.generadas := r.generadas + 1; k := k + 1; n := n + 1;
      update public.ticket_fac_recurrentes set generadas = r.generadas, ultima_factura_id = v_id, actualizado_en = now() where id = r.id;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.fac_generar_recurrentes() from public, anon;
grant execute on function public.fac_generar_recurrentes() to authenticated;

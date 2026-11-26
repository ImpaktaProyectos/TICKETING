-- =====================================================================
-- TIXFAST · UN SOLO AVISO EN DIRECTO POR OPERACIÓN (no uno por venta)
-- ---------------------------------------------------------------------
-- Hasta ahora los equipos escuchaban la tabla de ventas: cada fila creada o cambiada mandaba un aviso
-- a cada equipo del evento. Una Z de una barra con 2.300 ventas mandaba 2.300 avisos a cada equipo
-- (con 20 equipos, 46.000 mensajes en un segundo), cada uno con la venta entera. En el plan gratuito
-- el límite es de 100 mensajes por segundo y en Pro se pagan por millones.
--
-- Ahora cada operación sobre las ventas (una venta, un ×5, una anulación, una Z, revertir una Z,
-- borrar las ventas de prueba) toca UNA vez la fila de su evento en ticket_evento_cambios, y los
-- equipos escuchan esa fila: un aviso pequeño por operación. La app pide entonces los cambios
-- (refresco incremental), como ya hacía.
--
-- · Solo el disparador escribe en la tabla (los usuarios no pueden insertar ni cambiar nada).
-- · Cada cuenta solo ve las filas de sus eventos (seguridad por filas).
-- · borradas_en cambia cuando se borran ventas: la app lo nota y recarga todo.
-- · ticket_ventas sigue en el directo para las versiones de la app que aún no se hayan actualizado.
--   Cuando todos los equipos tengan la versión nueva, se puede quitar (ver PENDIENTE.md).
-- =====================================================================

create table if not exists public.ticket_evento_cambios (
  evento_id uuid primary key references public.ticket_eventos(id) on delete cascade,
  owner_id uuid not null,
  ventas_en timestamptz not null default now(),
  borradas_en timestamptz
);
alter table public.ticket_evento_cambios enable row level security;
drop policy if exists dueno_ver on public.ticket_evento_cambios;
create policy dueno_ver on public.ticket_evento_cambios for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.ticket_evento_cambios from anon, authenticated;
grant select on public.ticket_evento_cambios to authenticated;

create or replace function public.ticket_ventas_avisar()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    insert into public.ticket_evento_cambios as c (evento_id, owner_id, ventas_en, borradas_en)
    select distinct on (o.evento_id) o.evento_id, o.owner_id, now(), now() from old_rows o
    on conflict (evento_id) do update set ventas_en = excluded.ventas_en, borradas_en = excluded.borradas_en;
  else
    insert into public.ticket_evento_cambios as c (evento_id, owner_id, ventas_en)
    select distinct on (n.evento_id) n.evento_id, n.owner_id, now() from new_rows n
    on conflict (evento_id) do update set ventas_en = excluded.ventas_en;
  end if;
  return null;
end $$;
revoke all on function public.ticket_ventas_avisar() from public, anon, authenticated;

drop trigger if exists ticket_ventas_avisar_ins on public.ticket_ventas;
drop trigger if exists ticket_ventas_avisar_upd on public.ticket_ventas;
drop trigger if exists ticket_ventas_avisar_del on public.ticket_ventas;
create trigger ticket_ventas_avisar_ins after insert on public.ticket_ventas
  referencing new table as new_rows for each statement execute function public.ticket_ventas_avisar();
create trigger ticket_ventas_avisar_upd after update on public.ticket_ventas
  referencing new table as new_rows for each statement execute function public.ticket_ventas_avisar();
create trigger ticket_ventas_avisar_del after delete on public.ticket_ventas
  referencing old table as old_rows for each statement execute function public.ticket_ventas_avisar();

-- Al directo (si la publicación de Supabase existe y la tabla aún no está)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ticket_evento_cambios') then
    execute 'alter publication supabase_realtime add table public.ticket_evento_cambios';
  end if;
end $$;

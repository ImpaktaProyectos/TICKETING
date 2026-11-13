-- ============ REVERTIR UN CIERRE Z ============
-- Deshace la última Z de una barra: sus ventas y gastos vuelven al turno abierto, la barra vuelve a «abierta»
-- con el fondo que tenía y se puede seguir trabajando (añadir gastos…) y sacar otra Z.
-- El cierre NO se borra: queda marcado como revertido (quién y cuándo) para que conste.

alter table public.ticket_cierres add column if not exists revertido_en timestamptz;
alter table public.ticket_cierres add column if not exists revertido_por text check (revertido_por is null or length(revertido_por) <= 60);

create or replace function public.ticket_revertir_z(p_cierre uuid, p_por text default null)
returns public.ticket_cierres
language plpgsql security invoker set search_path to '' as $$
declare c public.ticket_cierres; pt public.ticket_puntos; ultimo uuid;
begin
  if auth.uid() is null then raise exception 'Sin sesión' using errcode = '42501'; end if;
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
  return c;
end $$;
revoke all on function public.ticket_revertir_z(uuid, text) from public, anon;
grant execute on function public.ticket_revertir_z(uuid, text) to authenticated;

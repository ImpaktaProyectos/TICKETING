-- ============ LIQUIDAR DESDE LA CAJA DEL TPV LOS GASTOS PREVISTOS EN EL CRM ============
-- Un gasto de caja (ticket_gastos) puede saldar un gasto del CRM (ticket_crm_gastos): «Javi, camarero, 60 €».
-- Al pagarlo, el gasto del CRM pasa a «pagado» con el importe REAL pagado (p. ej. 80 €) y deja de contarse
-- aparte en «Caja de las barras» (lo hace la app), así nunca se cuenta dos veces.
-- Si el pago de caja se anula, el gasto del CRM vuelve a como estaba antes.

alter table public.ticket_gastos add column if not exists crm_gasto_id uuid
  references public.ticket_crm_gastos(id) on delete set null;
create index if not exists ticket_gastos_crm_gasto_idx on public.ticket_gastos (crm_gasto_id) where crm_gasto_id is not null;

alter table public.ticket_crm_gastos add column if not exists caja_previo jsonb;      -- cómo estaba antes del primer pago desde caja
alter table public.ticket_crm_gastos add column if not exists caja_pagado numeric(12,2); -- lo pagado desde las cajas del TPV

-- Antes de guardar: si el gasto del CRM no es del mismo evento y la misma cuenta, se guarda como gasto de caja normal
-- (nunca se rechaza: el TPV puede subirlo horas después desde la cola sin conexión y no debe perderse).
create or replace function public.ticket_gastos_crm_valida() returns trigger
language plpgsql security invoker set search_path to '' as $$
begin
  if new.crm_gasto_id is not null and (new.tipo <> 'gasto' or not exists (
      select 1 from public.ticket_crm_gastos c where c.id = new.crm_gasto_id and c.evento_id = new.evento_id and c.owner_id = new.owner_id)) then
    new.crm_gasto_id := null;
  end if;
  return new;
end $$;
drop trigger if exists ticket_gastos_crm_valida on public.ticket_gastos;
create trigger ticket_gastos_crm_valida before insert or update of crm_gasto_id, tipo on public.ticket_gastos
  for each row execute function public.ticket_gastos_crm_valida();

-- Recalcula un gasto del CRM a partir de sus pagos de caja vigentes
create or replace function public.ticket_crm_gasto_recalcular(p_id uuid) returns void
language plpgsql security invoker set search_path to '' as $$
declare s numeric;
begin
  if p_id is null then return; end if;
  select coalesce(sum(importe), 0) into s from public.ticket_gastos
   where crm_gasto_id = p_id and tipo = 'gasto' and not coalesce(anulado, false);
  if s > 0 then
    update public.ticket_crm_gastos set
      caja_previo = coalesce(caja_previo, jsonb_build_object('estado', estado, 'real', real, 'pagado_por', pagado_por)),
      real = s, caja_pagado = s, estado = 'pagado', pagado_por = null, actualizado_en = now()
    where id = p_id;
  else
    update public.ticket_crm_gastos set
      estado = coalesce(caja_previo ->> 'estado', 'confirmado'),
      real = (caja_previo ->> 'real')::numeric,
      pagado_por = (caja_previo ->> 'pagado_por')::uuid,
      caja_previo = null, caja_pagado = null, actualizado_en = now()
    where id = p_id and caja_previo is not null;
  end if;
end $$;
-- La llaman los disparadores con los permisos de quien guarda el gasto (RLS: solo toca lo de su cuenta)
revoke all on function public.ticket_crm_gasto_recalcular(uuid) from public, anon;
grant execute on function public.ticket_crm_gasto_recalcular(uuid) to authenticated;

create or replace function public.ticket_gastos_crm_sync() returns trigger
language plpgsql security invoker set search_path to '' as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then perform public.ticket_crm_gasto_recalcular(new.crm_gasto_id); end if;
  if tg_op in ('UPDATE', 'DELETE') and old.crm_gasto_id is distinct from (case when tg_op = 'UPDATE' then new.crm_gasto_id end) then
    perform public.ticket_crm_gasto_recalcular(old.crm_gasto_id);
  end if;
  return null;
end $$;
drop trigger if exists ticket_gastos_crm_sync on public.ticket_gastos;
create trigger ticket_gastos_crm_sync after insert or update or delete on public.ticket_gastos
  for each row execute function public.ticket_gastos_crm_sync();
revoke all on function public.ticket_gastos_crm_sync() from public, anon, authenticated;
revoke all on function public.ticket_gastos_crm_valida() from public, anon, authenticated;

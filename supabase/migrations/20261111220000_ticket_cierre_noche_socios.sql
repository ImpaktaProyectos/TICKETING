-- ============ CIERRE DE LA NOCHE Y DINERO DE LOS SOCIOS ============
-- 1) Gastos de caja con categoría (para el informe de la noche bien clasificado).
-- 2) Señales de reservados: qué socio tiene el dinero.
-- 3) Devoluciones: cuando el socio repone el dinero, se confirma y su deuda desaparece.
-- 4) Vista con todo lo que tienen los socios (señales + ventas sin ticket en efectivo), para el TPV y el CRM.

alter table public.ticket_gastos add column if not exists categoria text
  check (categoria is null or length(categoria) <= 40);
alter table public.ticket_reservados add column if not exists senal_socio text
  check (senal_socio is null or length(senal_socio) <= 60);

create table if not exists public.ticket_socio_devoluciones (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  evento_id uuid not null references public.ticket_eventos(id) on delete cascade,
  socio text not null check (length(btrim(socio)) between 1 and 60),
  clave text not null check (clave ~ '^(senal|venta):[0-9a-f-]{36}$'),   -- qué deuda salda: senal:<reservado> o venta:<venta>
  concepto text check (length(concepto) <= 200),
  importe numeric(10,2) not null check (importe > 0 and importe < 1000000),
  devuelto_en timestamptz not null default now(),
  devuelto_por text check (length(devuelto_por) <= 60),
  unique (owner_id, evento_id, clave)
);
create index if not exists ticket_socio_devoluciones_evento_idx on public.ticket_socio_devoluciones (evento_id);
alter table public.ticket_socio_devoluciones enable row level security;
create policy owner_all on public.ticket_socio_devoluciones for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and public.ticket_owns_evento(evento_id));
revoke all on public.ticket_socio_devoluciones from anon;
grant select, insert, update, delete on public.ticket_socio_devoluciones to authenticated;

-- Todo el dinero que tiene cada socio, con lo ya devuelto. security_invoker: cada cuenta ve solo lo suyo (RLS).
create or replace view public.ticket_socio_deudas with (security_invoker = true) as
with deudas as (
  select r.owner_id, r.evento_id, 'senal:' || r.id::text as clave, 'senal'::text as origen, btrim(r.senal_socio) as socio,
         'Señal del reservado ' || r.nombre || coalesce(' · ' || nullif(btrim(r.cliente), ''), '') as concepto,
         r.senal::numeric(10,2) as importe, coalesce(r.actualizado_en, r.creado_en) as fecha
  from public.ticket_reservados r
  where r.senal > 0 and r.estado <> 'libre' and coalesce(btrim(r.senal_socio), '') <> ''
  union all
  select v.owner_id, v.evento_id, 'venta:' || coalesce(v.client_uuid, v.id)::text, 'venta', btrim(substr(v.operario, 7)),
         'Venta sin ticket en efectivo · ' || v.nombre, v.precio::numeric(10,2), v.creado_en
  from public.ticket_ventas v
  where v.operario like 'SOCIO:%' and v.metodo_pago = 'efectivo' and not coalesce(v.anulada, false) and v.precio > 0
)
select d.owner_id, d.evento_id, e.nombre as evento, e.fecha as evento_fecha, d.clave, d.origen, d.socio, d.concepto, d.importe, d.fecha,
       coalesce(x.importe, 0)::numeric(10,2) as devuelto, x.devuelto_en, x.devuelto_por,
       greatest(d.importe - coalesce(x.importe, 0), 0)::numeric(10,2) as pendiente
from deudas d
join public.ticket_eventos e on e.id = d.evento_id
left join public.ticket_socio_devoluciones x on x.owner_id = d.owner_id and x.evento_id = d.evento_id and x.clave = d.clave;
revoke all on public.ticket_socio_deudas from anon;
grant select on public.ticket_socio_deudas to authenticated;

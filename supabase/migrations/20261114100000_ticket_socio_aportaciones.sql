-- ============ CAMBIO QUE PONEN LOS SOCIOS (hay que devolvérselo) ============
-- Dinero que un socio adelanta (p. ej. 500 € de cambio para las barras). NO es ingreso ni gasto del evento:
-- es una cuenta pendiente con el socio hasta que se le devuelve (desde la caja o fuera de ella).
-- Si se mete en una barra, el TPV además registra la «entrada de cambio» (cuenta en el cierre Z como siempre);
-- si se le devuelve desde la caja, el TPV registra una «retirada de efectivo» (no es gasto).

create table if not exists public.ticket_socio_aportaciones (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  evento_id uuid not null references public.ticket_eventos(id) on delete cascade,
  socio text not null check (length(btrim(socio)) between 1 and 60),
  importe numeric(10,2) not null check (importe > 0 and importe < 1000000),
  concepto text check (concepto is null or length(concepto) <= 200),
  punto_id uuid references public.ticket_puntos(id) on delete set null,   -- barra donde se metió (si se metió en una)
  gasto_entrada_id uuid,                                                  -- movimiento «meter cambio» del TPV
  creado_en timestamptz not null default now(),
  creado_por text check (creado_por is null or length(creado_por) <= 60),
  devuelto_en timestamptz,
  devuelto_por text check (devuelto_por is null or length(devuelto_por) <= 60),
  devuelto_desde text check (devuelto_desde is null or devuelto_desde in ('caja', 'fuera')),
  gasto_devolucion_id uuid                                                -- retirada de la caja con la que se devolvió
);
create index if not exists ticket_socio_aportaciones_evento_idx on public.ticket_socio_aportaciones (evento_id);
create index if not exists ticket_socio_aportaciones_owner_idx on public.ticket_socio_aportaciones (owner_id, devuelto_en);
create index if not exists ticket_socio_aportaciones_punto_idx on public.ticket_socio_aportaciones (punto_id);
alter table public.ticket_socio_aportaciones enable row level security;
create policy owner_all on public.ticket_socio_aportaciones for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and public.ticket_owns_evento(evento_id) and (punto_id is null or public.ticket_owns_punto(punto_id)));
revoke all on public.ticket_socio_aportaciones from anon;
grant select, insert, update, delete on public.ticket_socio_aportaciones to authenticated;

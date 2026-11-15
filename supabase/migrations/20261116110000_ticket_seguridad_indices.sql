-- =====================================================================
-- TIXFAST · REFUERZOS DE LA AUDITORÍA (almacén de logos e índices)
-- ---------------------------------------------------------------------
-- · El bucket público de logos aceptaba cualquier archivo de cualquier tamaño:
--   ahora solo imágenes (jpeg, png, webp) de hasta 2 MB. Los logos ya subidos no cambian.
-- · Índices que faltaban en claves foráneas (los señaló el asesor de rendimiento).
-- · Se quitan dos índices duplicados (ocupaban sitio y frenaban las escrituras).
-- =====================================================================

update storage.buckets
  set file_size_limit = 2097152,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
  where id = 'ticketera-logos';

-- Claves foráneas sin índice
create index if not exists ticket_admin_registro_admin_idx on public.ticket_admin_registro (admin_id);
create index if not exists ticket_admin_registro_cuenta_idx on public.ticket_admin_registro (cuenta_id);
create index if not exists ticket_bajas_owner_idx on public.ticket_bajas (owner_id);
create index if not exists ticket_cuentas_plan_idx on public.ticket_cuentas (plan_id);
create index if not exists ticket_repartos_cuenta_idx on public.ticket_repartos (cuenta_id);
create index if not exists ticket_repartos_rrpp_fk_idx on public.ticket_repartos (rrpp_id);
create index if not exists ticket_retiradas_cuenta_idx on public.ticket_retiradas (cuenta_id);

-- Índices duplicados (queda uno de cada pareja)
drop index if exists public.ticket_web_entradas_pedido_idx;      -- queda ticket_web_entradas_pedido_id_idx
drop index if exists public.ticket_web_pedidos_evento_creado_idx; -- queda ticket_web_pedidos_evento_id_creado_en_idx

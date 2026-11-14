-- ============ FOTO DE LA FACTURA O DEL TICKET EN LOS GASTOS DEL CRM ============
-- Se guarda en el almacenamiento privado «facturas» (ya existente, cada cuenta solo ve su carpeta):
--   <cuenta>/gastos/<evento>/<gasto>-<marca de tiempo>.<extensión>
alter table public.ticket_crm_gastos add column if not exists archivo_path text
  check (archivo_path is null or length(archivo_path) <= 300);

-- Copia de la migración ya aplicada en Supabase (versión 20261111172517).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('facturas', 'facturas', false, 15728640, array['application/pdf','image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;
create policy fac_archivos_ver on storage.objects for select to authenticated using (bucket_id = 'facturas' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy fac_archivos_subir on storage.objects for insert to authenticated with check (bucket_id = 'facturas' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy fac_archivos_cambiar on storage.objects for update to authenticated using (bucket_id = 'facturas' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy fac_archivos_borrar on storage.objects for delete to authenticated using (bucket_id = 'facturas' and (storage.foldername(name))[1] = (select auth.uid())::text);

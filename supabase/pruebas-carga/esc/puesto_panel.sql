\set s random(1, 10)
BEGIN;
SET LOCAL ROLE anon;
SELECT length(public.puesto_panel('sesion-de-prueba-del-puesto-numero-' || lpad(:s::text, 4, '0'), 500)::text);
COMMIT;

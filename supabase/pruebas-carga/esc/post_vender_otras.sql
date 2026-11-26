\set n random(301, 13755)
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', (SELECT owner::text FROM carga_prod WHERE n = :n), true);
SELECT count(*) FROM carga_prod c, LATERAL public.ticket_vender(c.evento, c.punto, c.prod, c.nombre, c.precio, 1, null, 'op', array[gen_random_uuid()], 'efectivo') v WHERE c.n = :n;
COMMIT;

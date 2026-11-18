\set n random(1, 300)
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
SELECT count(*) FROM carga_prod c, LATERAL public.ticket_vender(c.evento, c.punto, c.prod, c.nombre, c.precio, 1, null, 'op', array[gen_random_uuid()], 'efectivo') v WHERE c.n = :n;
COMMIT;

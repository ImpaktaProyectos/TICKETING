\set q random(1, 10000)
\set s random(1, 10)
BEGIN;
SET LOCAL ROLE anon;
SELECT public.puesto_canjear('sesion-de-prueba-del-puesto-numero-' || lpad(:s::text, 4, '0'), (SELECT hex FROM carga_qr WHERE n = :q), gen_random_uuid());
COMMIT;

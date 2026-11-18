\set n random(301, 13755)
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', (SELECT owner::text FROM carga_prod WHERE n = :n), true);
SELECT count(*), sum(length(t::text)) FROM (SELECT * FROM public.ticket_ventas WHERE evento_id = (SELECT evento FROM carga_prod WHERE n = :n) AND actualizado_en > now() - interval '30 seconds' ORDER BY actualizado_en, id LIMIT 1000) t;
COMMIT;

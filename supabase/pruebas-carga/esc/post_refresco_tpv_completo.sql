BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
SELECT count(*), sum(length(t::text)) FROM (SELECT * FROM public.ticket_ventas WHERE evento_id = '10000000-0000-0000-0000-000000000001' AND actualizado_en > now() - interval '30 seconds' ORDER BY actualizado_en, id LIMIT 1000) t;
COMMIT;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
SELECT count(*) FROM (SELECT venta_uuid, idx, canjeado_en, punto_id, dispositivo, recibido_en FROM public.ticket_canjes WHERE evento_id = '10000000-0000-0000-0000-000000000001' AND recibido_en > now() - interval '30 seconds' ORDER BY recibido_en LIMIT 1000) t;
COMMIT;

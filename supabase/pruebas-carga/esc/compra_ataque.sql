\set u random(1, 100000000)
BEGIN;
SET LOCAL ROLE anon;
SELECT set_config('request.headers', '{"x-forwarded-for":"' || :u || '.1.1.1"}', true);
SELECT public.web_comprar('festival', '[{"tramo":"30000000-0000-0000-0000-000000000001","cantidad":20}]', '{"email":"basura","nombre":"x"}', '[]')->>'motivo';
COMMIT;

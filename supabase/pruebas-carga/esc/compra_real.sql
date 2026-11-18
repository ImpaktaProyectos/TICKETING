\set u random(1, 100000000)
BEGIN;
SET LOCAL ROLE anon;
SELECT set_config('request.headers', '{"x-forwarded-for":"81.' || (:u % 250) || '.' || (:u % 199) || '.' || (:u % 97) || '","user-agent":"movil"}', true);
SELECT public.web_comprar('festival', '[{"tramo":"30000000-0000-0000-0000-000000000001","cantidad":2}]',
  ('{"email":"comprador' || :u || '@correo.es","nombre":"Comprador ' || :u || '","acepta":true}')::jsonb,
  '[{"tramo":"30000000-0000-0000-0000-000000000001","nombre":"Persona Uno"},{"tramo":"30000000-0000-0000-0000-000000000001","nombre":"Persona Dos"}]')->>'ok';
COMMIT;

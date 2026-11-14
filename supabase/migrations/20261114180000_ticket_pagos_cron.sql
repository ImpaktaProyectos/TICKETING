-- ===================== PAGOS · tarea automática =====================
-- Cada 10 minutos: suelta las reservas sin pagar y reparte los eventos que ya han acabado.
-- Llama a la función «pagos» con una clave interna que solo conocen la base de datos y la función.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

insert into public.ticket_pago_config (clave, valor)
values ('cron_clave', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (clave) do nothing;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'tixfast-pagos';
  perform cron.schedule('tixfast-pagos', '*/10 * * * *', $c$
    select net.http_post(
      url := 'https://xnhcquehlyalwgqmdiov.supabase.co/functions/v1/pagos',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('accion', 'repartir', 'clave', (select valor from public.ticket_pago_config where clave = 'cron_clave')),
      timeout_milliseconds := 55000
    );
  $c$);
end $$;

-- ===================== LANZAMIENTO CON CUENTA ATRÁS (festivales) =====================
-- Va después de 20261127160000_ticket_aforo_sala.sql.
-- · La configuración va en ticket_web_eventos.diseno -> 'lanzamiento' ({ activo, estilo, fotos, texto }); la hora exacta de
--   apertura es la de siempre (ticket_web_eventos.venta_inicio), que el servidor ya hace cumplir al comprar.
-- · Antes de abrir, con el lanzamiento activo, la página pública no recibe los tramos (ni precios): no se ven ni mirando el código.
-- · «Avísame cuando abra»: el público deja su correo; al abrir, una tarea programada (cada minuto) les envía el aviso una sola vez.

create table if not exists public.ticket_web_avisos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  evento_id uuid not null references public.ticket_eventos(id) on delete cascade,
  email text not null check (length(email) <= 160),
  marketing boolean not null default false,
  creado_en timestamptz not null default now(),
  enviado_en timestamptz,
  error text check (error is null or length(error) <= 300)
);
create unique index if not exists ticket_web_avisos_unico on public.ticket_web_avisos (evento_id, lower(email));
create index if not exists ticket_web_avisos_pendientes on public.ticket_web_avisos (evento_id) where enviado_en is null;
alter table public.ticket_web_avisos enable row level security;
drop policy if exists avisos_propios on public.ticket_web_avisos;
create policy avisos_propios on public.ticket_web_avisos for select to authenticated using (owner_id = (select auth.uid()));
grant select on public.ticket_web_avisos to authenticated;

-- El público se apunta (solo mientras la venta aún no ha abierto)
create or replace function public.web_avisame(p_slug text, p_email text, p_marketing boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f record; v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if not public.web_intento('avisame', 10, 10) then return jsonb_build_object('ok', false, 'motivo', 'demasiados_intentos'); end if;
  select * into f from public.ticket_web_eventos where slug = lower(p_slug);
  if f.evento_id is null or f.estado = 'borrador' then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if f.venta_inicio is null or f.venta_inicio <= now() then return jsonb_build_object('ok', false, 'motivo', 'ya_abierta'); end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 160 then return jsonb_build_object('ok', false, 'motivo', 'email'); end if;
  insert into public.ticket_web_avisos (owner_id, evento_id, email, marketing) values (f.owner_id, f.evento_id, v_email, coalesce(p_marketing, false))
  on conflict (evento_id, lower(email)) do update set marketing = excluded.marketing or public.ticket_web_avisos.marketing;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.web_avisame(text, text, boolean) from public;
grant execute on function public.web_avisame(text, text, boolean) to anon, authenticated;

-- La tarea programada reclama un lote de avisos de eventos ya abiertos (cada aviso, una sola vez aunque se solapen ejecuciones)
create or replace function public.lanzamiento_reclamar(p_limite int default 500)
returns table (aviso_id uuid, email text, evento text, slug text, flyer_url text, color text, organizador text)
language sql security definer set search_path = '' as $$
  with lote as (
    select a.id from public.ticket_web_avisos a join public.ticket_web_eventos f on f.evento_id = a.evento_id
     where a.enviado_en is null and f.venta_inicio <= now() and f.venta_inicio > now() - interval '3 days' and f.estado = 'publicado'
     order by a.creado_en limit greatest(1, least(p_limite, 1000)) for update of a skip locked),
  marcados as (update public.ticket_web_avisos a set enviado_en = now() from lote where a.id = lote.id returning a.id, a.email, a.evento_id)
  select m.id, m.email, e.nombre, f.slug, f.flyer_url, coalesce(f.diseno ->> 'color', '#ff5a3c'), coalesce(f.diseno -> 'legal' ->> 'razon_social', '')
    from marcados m join public.ticket_web_eventos f on f.evento_id = m.evento_id join public.ticket_eventos e on e.id = m.evento_id
$$;
revoke all on function public.lanzamiento_reclamar(int) from public, anon, authenticated;
grant execute on function public.lanzamiento_reclamar(int) to service_role;

-- Antes de abrir, con lanzamiento activo, la página pública no recibe tramos ni precios
do $$
declare d text;
begin
  select pg_get_functiondef('public.web_evento_publico'::regproc) into d;
  if position('lanzamiento' in d) = 0 then
    d := replace(d, $a$'tramos', coalesce((select jsonb_agg($a$,
      $b$'tramos', case when coalesce((f.diseno -> 'lanzamiento' ->> 'activo')::boolean, false) and f.venta_inicio is not null and f.venta_inicio > now() then '[]'::jsonb else coalesce((select jsonb_agg($b$);
    d := replace(d, $a$on s.id = t.id), '[]'::jsonb),$a$, $b$on s.id = t.id), '[]'::jsonb) end,$b$);
    if position('lanzamiento' in d) = 0 or position($x$'[]'::jsonb) end,$x$ in d) = 0 then raise exception 'web_evento_publico: no se ha podido ocultar los tramos antes del lanzamiento'; end if;
    execute d;
  end if;
end $$;

-- Tarea programada: cada minuto, solo llama a la función si hay avisos pendientes de un evento ya abierto
do $c$
begin
  if exists (select 1 from cron.job where jobname = 'tixfast-lanzamiento') then perform cron.unschedule('tixfast-lanzamiento'); end if;
  perform cron.schedule('tixfast-lanzamiento', '* * * * *', $job$
    select net.http_post(
      url := 'https://xnhcquehlyalwgqmdiov.supabase.co/functions/v1/lanzamiento-avisos',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('accion', 'ejecutar', 'clave', (select valor from public.ticket_pago_config where clave = 'cron_clave'))
    )
    where exists (select 1 from public.ticket_web_avisos a join public.ticket_web_eventos f on f.evento_id = a.evento_id
                   where a.enviado_en is null and f.venta_inicio <= now() and f.venta_inicio > now() - interval '3 days' and f.estado = 'publicado');
  $job$);
end $c$;

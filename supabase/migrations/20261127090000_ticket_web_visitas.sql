-- =====================================================================
-- TIXFAST · VISITAS DE LA PÁGINA DE VENTA (en directo, en el Panel del CRM)
-- ---------------------------------------------------------------------
-- Cada vez que alguien abre la página de un evento (/e/slug) se apunta UNA visita.
-- · El navegador manda un identificador al azar (no es un dato personal) para no contar
--   dos veces a la misma persona: si ya visitó en los últimos 30 minutos, no se apunta.
-- · Si entra por el enlace de un RRPP (?rp=CODIGO) se guarda el código, para ver qué RRPP atrae visitas.
-- · Solo se apunta si la web está publicada. Nadie puede leer la tabla directamente:
--   el organizador ve el resumen de SUS eventos con web_visitas_resumen.
-- =====================================================================

create table if not exists public.ticket_web_visitas (
  id bigint generated always as identity primary key,
  evento_id uuid not null references public.ticket_eventos(id) on delete cascade,
  owner_id uuid not null,
  visitante text not null,
  rrpp_codigo text,
  creado_en timestamptz not null default now()
);
create index if not exists ticket_web_visitas_evento_idx on public.ticket_web_visitas (evento_id, creado_en desc);
create index if not exists ticket_web_visitas_visitante_idx on public.ticket_web_visitas (evento_id, visitante, creado_en desc);
alter table public.ticket_web_visitas enable row level security;
revoke all on public.ticket_web_visitas from anon, authenticated;

-- Apuntar una visita (la llama la página pública, sin sesión)
create or replace function public.web_registrar_visita(p_slug text, p_visitante text, p_rp text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare w record; v text; rp text;
begin
  v := left(regexp_replace(coalesce(p_visitante, ''), '[^A-Za-z0-9-]', '', 'g'), 40);
  if length(v) < 8 then return; end if;
  rp := nullif(left(upper(regexp_replace(coalesce(p_rp, ''), '[^A-Za-z0-9]', '', 'g')), 16), '');
  select evento_id, owner_id into w from public.ticket_web_eventos where slug = p_slug and estado = 'publicado';
  if not found then return; end if;
  if exists (select 1 from public.ticket_web_visitas where evento_id = w.evento_id and visitante = v and creado_en > now() - interval '30 minutes') then return; end if;
  insert into public.ticket_web_visitas (evento_id, owner_id, visitante, rrpp_codigo) values (w.evento_id, w.owner_id, v, rp);
end $$;
revoke all on function public.web_registrar_visita(text, text, text) from public;
grant execute on function public.web_registrar_visita(text, text, text) to anon, authenticated;

-- Resumen para el organizador (solo sus eventos)
create or replace function public.web_visitas_resumen(p_evento uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'total', count(*),
    'personas', count(distinct visitante),
    'hoy', count(*) filter (where creado_en >= date_trunc('day', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid'),
    'ultimos15', count(*) filter (where creado_en > now() - interval '15 minutes'),
    'por_rrpp', coalesce((select jsonb_object_agg(c, n) from (
        select rrpp_codigo c, count(*) n from public.ticket_web_visitas
        where evento_id = p_evento and owner_id = (select auth.uid()) and rrpp_codigo is not null group by rrpp_codigo) x), '{}'::jsonb)
  )
  from public.ticket_web_visitas
  where evento_id = p_evento and owner_id = (select auth.uid())
$$;
revoke all on function public.web_visitas_resumen(uuid) from public, anon;
grant execute on function public.web_visitas_resumen(uuid) to authenticated;

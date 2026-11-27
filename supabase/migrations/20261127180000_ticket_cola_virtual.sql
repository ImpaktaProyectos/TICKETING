-- ===================== COLA VIRTUAL AUTOMÁTICA (solo eventos con lanzamiento) =====================
-- Va después de 20261127170000_ticket_lanzamiento.sql.
-- Nadie la configura: está siempre preparada en los eventos con lanzamiento y solo «se nota» cuando entra más gente
-- de la que la plataforma puede atender a la vez.
-- · Límite de la plataforma: personas comprando a la vez (ticket_pago_config 'cola_capacidad', por defecto 300).
--   Lo ajusta TIXFAST según el plan de Supabase; ni el organizador ni el comprador eligen nada.
-- · Quien llega con hueco entra directo (recibe al momento un pase de 10 minutos). Si no hay hueco, espera su turno.
-- · Quien ya esperaba antes de la apertura recibe un puesto AL AZAR al abrir (no gana el que recarga más rápido ni los bots).
--   Quien llega después, al final y por orden.
-- · La cola avanza sola cada vez que alguien consulta su puesto (sin tareas programadas).
-- · El servidor no deja comprar sin pase mientras haya cola. Salvaguarda: si no hay nadie esperando y hay hueco, se puede
--   comprar sin pase; la cola nunca puede dejar la venta bloqueada.

insert into public.ticket_pago_config (clave, valor) values ('cola_capacidad', '300') on conflict (clave) do nothing;

create table if not exists public.ticket_web_cola (
  id bigserial primary key,
  evento_id uuid not null references public.ticket_eventos(id) on delete cascade,
  token uuid not null default gen_random_uuid() unique,
  turno bigint,                      -- null: esperando el sorteo de la apertura
  creado_en timestamptz not null default now(),
  admitido_en timestamptz,           -- desde aquí tiene 10 minutos para comprar
  usado_en timestamptz,              -- ya ha comprado (libera su hueco)
  visto_en timestamptz not null default now()   -- última señal de su móvil: solo pasa quien sigue en la página
);
create index if not exists ticket_web_cola_espera on public.ticket_web_cola (evento_id, turno) where admitido_en is null;
create index if not exists ticket_web_cola_dentro on public.ticket_web_cola (evento_id, admitido_en) where admitido_en is not null;
alter table public.ticket_web_cola enable row level security;   -- solo se toca desde las funciones

create table if not exists public.ticket_web_cola_evento (
  evento_id uuid primary key references public.ticket_eventos(id) on delete cascade,
  sorteado boolean not null default false
);
alter table public.ticket_web_cola_evento enable row level security;

create or replace function public.cola_capacidad()
returns int language sql stable security definer set search_path = '' as $$
  select greatest(10, coalesce((select nullif(valor, '')::int from public.ticket_pago_config where clave = 'cola_capacidad'), 300))
$$;
revoke all on function public.cola_capacidad() from public, anon, authenticated;

create or replace function public.cola_activa(f public.ticket_web_eventos)
returns boolean language sql stable set search_path = '' as $$
  select coalesce((f.diseno -> 'lanzamiento' ->> 'activo')::boolean, false) and f.venta_inicio is not null
$$;

-- Hace avanzar la cola de un evento (solo una consulta a la vez la mueve; las demás no esperan)
create or replace function public.cola_avanzar(p_evento uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.ticket_web_eventos; v_dentro int; v_hueco int;
begin
  if not pg_try_advisory_xact_lock(hashtext('tixfast_cola:' || p_evento::text)) then return; end if;
  select * into f from public.ticket_web_eventos where evento_id = p_evento;
  if f.evento_id is null or f.venta_inicio > now() then return; end if;
  -- Sorteo de la apertura: los que esperaban antes reciben un puesto al azar (1, 2, 3…)
  insert into public.ticket_web_cola_evento (evento_id) values (p_evento) on conflict do nothing;
  if not (select sorteado from public.ticket_web_cola_evento where evento_id = p_evento) then
    update public.ticket_web_cola c set turno = z.n from (
      select id, row_number() over (order by random()) n from public.ticket_web_cola where evento_id = p_evento and turno is null) z
     where c.id = z.id;
    update public.ticket_web_cola_evento set sorteado = true where evento_id = p_evento;
  end if;
  select count(*) into v_dentro from public.ticket_web_cola
   where evento_id = p_evento and admitido_en > now() - interval '10 minutes' and usado_en is null;
  v_hueco := public.cola_capacidad() - v_dentro;
  if v_hueco > 0 then
    update public.ticket_web_cola set admitido_en = now()
     where id in (select id from public.ticket_web_cola where evento_id = p_evento and admitido_en is null and turno is not null
                    and visto_en > now() - interval '90 seconds' order by turno limit v_hueco);
  end if;
end $$;
revoke all on function public.cola_avanzar(uuid) from public, anon, authenticated;

-- Lo que ve cada persona de su puesto
create or replace function public.cola_situacion(c public.ticket_web_cola)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_delante int; v_ritmo numeric;
begin
  if c.admitido_en is not null then
    if c.admitido_en > now() - interval '10 minutes' then
      return jsonb_build_object('ok', true, 'estado', 'dentro', 'pase', c.token, 'hasta', c.admitido_en + interval '10 minutes');
    end if;
    return jsonb_build_object('ok', true, 'estado', 'caducado');
  end if;
  if c.turno is null then return jsonb_build_object('ok', true, 'estado', 'apertura', 'token', c.token); end if;
  select count(*) into v_delante from (select 1 from public.ticket_web_cola
     where evento_id = c.evento_id and admitido_en is null and turno is not null and turno < c.turno and visto_en > now() - interval '90 seconds' limit 20000) z;
  select count(*) / 5.0 into v_ritmo from public.ticket_web_cola where evento_id = c.evento_id and admitido_en > now() - interval '5 minutes';
  return jsonb_build_object('ok', true, 'estado', 'cola', 'token', c.token, 'delante', v_delante,
    'minutos', case when v_ritmo > 0 then ceil(v_delante / v_ritmo) else null end);
end $$;
revoke all on function public.cola_situacion(public.ticket_web_cola) from public, anon, authenticated;

-- Entrar (o volver) a la cola de un evento
create or replace function public.web_cola_entrar(p_slug text, p_token uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f public.ticket_web_eventos; c public.ticket_web_cola;
begin
  select * into f from public.ticket_web_eventos where slug = lower(p_slug);
  if f.evento_id is null then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if not public.cola_activa(f) then return jsonb_build_object('ok', true, 'estado', 'libre'); end if;
  if p_token is not null then
    select * into c from public.ticket_web_cola where token = p_token and evento_id = f.evento_id;
    if c.id is not null and not (c.admitido_en is not null and c.admitido_en <= now() - interval '10 minutes') then
      if c.visto_en < now() - interval '15 seconds' then update public.ticket_web_cola set visto_en = now() where id = c.id; end if;
      perform public.cola_avanzar(f.evento_id);
      select * into c from public.ticket_web_cola where id = c.id;
      return public.cola_situacion(c);
    end if;
  end if;
  if not public.web_intento('cola', 60, 10) then return jsonb_build_object('ok', false, 'motivo', 'demasiados_intentos'); end if;
  -- Antes de abrir: sin puesto hasta el sorteo. Después: al final (los puestos del sorteo son siempre menores)
  insert into public.ticket_web_cola (evento_id) values (f.evento_id) returning * into c;
  if f.venta_inicio <= now() then update public.ticket_web_cola set turno = 1000000000 + c.id where id = c.id returning * into c; end if;
  perform public.cola_avanzar(f.evento_id);
  select * into c from public.ticket_web_cola where id = c.id;
  return public.cola_situacion(c);
end $$;
revoke all on function public.web_cola_entrar(text, uuid) from public;
grant execute on function public.web_cola_entrar(text, uuid) to anon, authenticated;

create or replace function public.web_cola_estado(p_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.ticket_web_cola;
begin
  select * into c from public.ticket_web_cola where token = p_token;
  if c.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if c.visto_en < now() - interval '15 seconds' then update public.ticket_web_cola set visto_en = now() where id = c.id; end if;
  perform public.cola_avanzar(c.evento_id);
  select * into c from public.ticket_web_cola where id = c.id;
  return public.cola_situacion(c);
end $$;
revoke all on function public.web_cola_estado(uuid) from public;
grant execute on function public.web_cola_estado(uuid) to anon, authenticated;

-- ¿Puede comprar? Con pase válido sí; sin pase, solo si no hay nadie esperando y hay hueco (salvaguarda)
create or replace function public.cola_puede_comprar(p_evento uuid, p_pase text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare f public.ticket_web_eventos; v_pase uuid;
begin
  select * into f from public.ticket_web_eventos where evento_id = p_evento;
  if f.evento_id is null or not public.cola_activa(f) or f.venta_inicio > now() then return true; end if;
  begin v_pase := nullif(p_pase, '')::uuid; exception when others then v_pase := null; end;
  if v_pase is not null and exists (select 1 from public.ticket_web_cola where token = v_pase and evento_id = p_evento
       and admitido_en > now() - interval '10 minutes') then return true; end if;
  return not exists (select 1 from public.ticket_web_cola where evento_id = p_evento and admitido_en is null and visto_en > now() - interval '90 seconds')
     and (select count(*) from public.ticket_web_cola where evento_id = p_evento and admitido_en > now() - interval '10 minutes' and usado_en is null) < public.cola_capacidad();
end $$;
revoke all on function public.cola_puede_comprar(uuid, text) from public, anon, authenticated;

-- La compra exige el pase mientras haya cola (el dueño y las ventas de RRPP no pasan por la cola)
do $$
declare d text;
begin
  select pg_get_functiondef('public.web_comprar'::regproc) into d;
  if position('cola_puede_comprar' in d) = 0 then
    d := regexp_replace(d, $a$(  v_prueba := f\.modo = 'pruebas' or f\.estado = 'borrador';\n)$a$,
      $b$\1  if not coalesce(es_dueno, false) and coalesce(current_setting('tixfast.rrpp_venta', true), '') = ''
     and not public.cola_puede_comprar(f.evento_id, coalesce(p_comprador ->> 'pase', p_comprador -> 'pases' ->> f.slug)) then
    return jsonb_build_object('ok', false, 'motivo', 'cola');
  end if;
$b$);
    d := replace(d, '  insert into public.ticket_web_pedidos (owner_id, evento_id, codigo, email, nombre, datos, total, estado, prueba, ip, agente, marketing, privacidad_version,',
      $b$  update public.ticket_web_cola set usado_en = now()
   where evento_id = f.evento_id and usado_en is null
     and token::text = coalesce(p_comprador ->> 'pase', p_comprador -> 'pases' ->> f.slug, '');
  insert into public.ticket_web_pedidos (owner_id, evento_id, codigo, email, nombre, datos, total, estado, prueba, ip, agente, marketing, privacidad_version,$b$);
    if position('cola_puede_comprar' in d) = 0 or position('usado_en = now()' in d) = 0 then raise exception 'web_comprar: no se ha podido añadir la cola'; end if;
    execute d;
  end if;
end $$;

-- Limpieza diaria de colas de eventos pasados
do $c$
begin
  if exists (select 1 from cron.job where jobname = 'tixfast-cola-limpieza') then perform cron.unschedule('tixfast-cola-limpieza'); end if;
  perform cron.schedule('tixfast-cola-limpieza', '41 5 * * *', $job$
    delete from public.ticket_web_cola c using public.ticket_web_eventos f
     where f.evento_id = c.evento_id and f.venta_inicio < now() - interval '7 days';
  $job$);
end $c$;

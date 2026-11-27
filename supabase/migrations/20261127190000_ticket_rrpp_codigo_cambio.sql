-- ===================== RRPP: CAMBIAR SU CÓDIGO (NICK) · PRECIO DEL CAMBIO DE NOMBRE EN «MIS ENTRADAS» =====================
-- Va después de 20261127181000_ticket_cola_ajustes.sql.
-- · El RRPP puede cambiar su código de venta (el de sus enlaces ?rp=CODIGO), como mucho una vez cada 7 días.
--   Sus códigos anteriores siguen valiendo: los enlaces que ya compartió le siguen contando las ventas, y nadie más puede
--   quedarse con ellos.
-- · «Mis entradas» recibe si el evento permite el cambio de nombre y su precio (lo pone el organizador).

alter table public.ticket_rrpp_perfiles add column if not exists codigo_cambiado_en timestamptz;

create table if not exists public.ticket_rrpp_codigos_antiguos (
  codigo text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  cambiado_en timestamptz not null default now()
);
alter table public.ticket_rrpp_codigos_antiguos enable row level security;   -- solo desde las funciones

create or replace function public.rrpp_cambiar_codigo(p_codigo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); pf record; v_cod text := upper(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  select * into pf from public.ticket_rrpp_perfiles where user_id = v_uid for update;
  if pf.user_id is null then return jsonb_build_object('ok', false, 'motivo', 'sin_perfil'); end if;
  if v_cod !~ '^[A-Z0-9]{3,16}$' then return jsonb_build_object('ok', false, 'motivo', 'formato'); end if;
  if v_cod = pf.codigo then return jsonb_build_object('ok', true, 'codigo', v_cod); end if;
  if pf.codigo_cambiado_en is not null and pf.codigo_cambiado_en > now() - interval '7 days' then
    return jsonb_build_object('ok', false, 'motivo', 'reciente', 'desde', pf.codigo_cambiado_en + interval '7 days');
  end if;
  if exists (select 1 from public.ticket_rrpp_perfiles where codigo = v_cod and user_id <> v_uid)
     or exists (select 1 from public.ticket_rrpp where codigo = v_cod and user_id is distinct from v_uid)
     or exists (select 1 from public.ticket_rrpp_codigos_antiguos where codigo = v_cod and user_id <> v_uid) then
    return jsonb_build_object('ok', false, 'motivo', 'ocupado');
  end if;
  -- El código anterior queda reservado para él (sus enlaces siguen contando)
  insert into public.ticket_rrpp_codigos_antiguos (codigo, user_id) values (pf.codigo, v_uid)
  on conflict (codigo) do update set cambiado_en = now() where public.ticket_rrpp_codigos_antiguos.user_id = v_uid;
  delete from public.ticket_rrpp_codigos_antiguos where codigo = v_cod and user_id = v_uid;   -- vuelve a uno suyo de antes
  update public.ticket_rrpp_perfiles set codigo = v_cod, codigo_cambiado_en = now(), actualizado_en = now() where user_id = v_uid;
  update public.ticket_rrpp set codigo = v_cod where user_id = v_uid;
  return jsonb_build_object('ok', true, 'codigo', v_cod);
end $$;
revoke all on function public.rrpp_cambiar_codigo(text) from public, anon;
grant execute on function public.rrpp_cambiar_codigo(text) to authenticated;

-- Atribuir la venta también con un código antiguo del RRPP
do $$
declare d text;
begin
  select pg_get_functiondef('public.rrpp_atribuir'::regproc) into d;
  if position('ticket_rrpp_codigos_antiguos' in d) = 0 then
    d := replace(d, $a$    select id into v_rrpp from public.ticket_rrpp where owner_id = p_owner and codigo = upper(btrim(p_codigo));
$a$, $b$    select id into v_rrpp from public.ticket_rrpp where owner_id = p_owner and codigo = upper(btrim(p_codigo));
    if v_rrpp is null then
      select r.id into v_rrpp from public.ticket_rrpp_codigos_antiguos a join public.ticket_rrpp r on r.user_id = a.user_id and r.owner_id = p_owner
       where a.codigo = upper(btrim(p_codigo)) limit 1;
    end if;
$b$);
    if position('ticket_rrpp_codigos_antiguos' in d) = 0 then raise exception 'rrpp_atribuir: no se ha podido añadir los códigos antiguos'; end if;
    execute d;
  end if;

  -- «Mis entradas»: si se permite el cambio de nombre y cuánto cuesta
  select pg_get_functiondef('public.web_pedido'::regproc) into d;
  if position('cambio_precio' in d) = 0 then
    d := replace(d, $a$'qr_horas_antes', f.qr_horas_antes, 'slug', f.slug)$a$,
      $b$'qr_horas_antes', f.qr_horas_antes, 'slug', f.slug, 'cambio_nombre', coalesce(f.cambio_nombre, true), 'cambio_precio', coalesce(f.cambio_precio, 0))$b$);
    if position('cambio_precio' in d) = 0 then raise exception 'web_pedido: no se ha podido añadir el precio del cambio'; end if;
    execute d;
  end if;
end $$;

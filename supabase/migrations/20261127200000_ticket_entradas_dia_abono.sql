-- ===================== TIPOS DE ACCESO: ABONO O ENTRADA DE DÍA =====================
-- Va después de 20261127190000_ticket_rrpp_codigo_cambio.sql.
-- Cada tipo de entrada (tramo) es:
--  · «abono» (lo de siempre): vale para cualquier día del evento, pero UNA sola vez (al entrar se pone la pulsera).
--  · «dia»: solo vale el día elegido (desde las 06:00 de ese día hasta las 08:00 del siguiente, hora de España),
--    y también una sola vez.
-- La puerta lo comprueba (motivo «otro_dia»). Todas las entradas que ya existen siguen siendo abonos: nada cambia.

alter table public.ticket_web_tramos add column if not exists acceso text not null default 'abono';
alter table public.ticket_web_tramos add column if not exists dia date;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ticket_web_tramos_acceso_chk') then
    alter table public.ticket_web_tramos add constraint ticket_web_tramos_acceso_chk check (acceso in ('abono', 'dia') and (acceso = 'abono' or dia is not null));
  end if;
end $$;

-- Ventana de un día de festival (de 06:00 a 08:00 del día siguiente, hora de España)
create or replace function public.web_dia_desde(p_dia date) returns timestamptz language sql immutable set search_path = '' as $$
  select (p_dia + time '06:00') at time zone 'Europe/Madrid' $$;
create or replace function public.web_dia_hasta(p_dia date) returns timestamptz language sql immutable set search_path = '' as $$
  select ((p_dia + 1) + time '08:00') at time zone 'Europe/Madrid' $$;

do $$
declare d text;
begin
  -- 1) Puerta: una entrada de día solo entra su día
  select pg_get_functiondef('public.ticket_canje_nucleo'::regproc) into d;
  if position('otro_dia' in d) = 0 then
    d := replace(d, $a$      if v_ev.fin is not null and v_cuando > v_ev.fin then v_motivo := 'caducado'; v_det := v_det || jsonb_build_object('fin', v_ev.fin); exit chk; end if;
$a$, $b$      if v_ev.fin is not null and v_cuando > v_ev.fin then v_motivo := 'caducado'; v_det := v_det || jsonb_build_object('fin', v_ev.fin); exit chk; end if;
      if exists (select 1 from public.ticket_web_tramos t where t.id = v_web.tramo_id and t.acceso = 'dia'
                   and (v_cuando < public.web_dia_desde(t.dia) or v_cuando > public.web_dia_hasta(t.dia))) then
        v_motivo := 'otro_dia'; v_det := v_det || jsonb_build_object('dia', (select t.dia from public.ticket_web_tramos t where t.id = v_web.tramo_id)); exit chk;
      end if;
$b$);
    if position('otro_dia' in d) = 0 then raise exception 'ticket_canje_nucleo: no se ha podido añadir la entrada de día'; end if;
    execute d;
  end if;

  -- 2) Web pública: cada tramo dice si es abono o de qué día
  select pg_get_functiondef('public.web_evento_publico'::regproc) into d;
  if position($x$'acceso', t.acceso$x$ in d) = 0 then
    d := replace(d, $a$'max_por_compra', t.max_por_compra, 'copas', t.copas,$a$, $b$'max_por_compra', t.max_por_compra, 'copas', t.copas, 'acceso', t.acceso, 'dia', t.dia,$b$);
    if position($x$'acceso', t.acceso$x$ in d) = 0 then raise exception 'web_evento_publico: no se ha podido añadir el tipo de acceso'; end if;
    execute d;
  end if;

  -- 3) «Mis entradas»: cada entrada dice si es abono o de qué día
  select pg_get_functiondef('public.web_pedido'::regproc) into d;
  if position($x$'acceso'$x$ in d) = 0 then
    d := replace(d, $a$jsonb_build_object('numero', x.numero, 'asistente', x.asistente, 'tramo', x.tramo_nombre, 'precio', x.precio,$a$,
      $b$jsonb_build_object('numero', x.numero, 'asistente', x.asistente, 'tramo', x.tramo_nombre, 'precio', x.precio,
        'acceso', coalesce((select t.acceso from public.ticket_web_tramos t where t.id = x.tramo_id), 'abono'), 'dia', (select t.dia from public.ticket_web_tramos t where t.id = x.tramo_id),$b$);
    if position($x$'acceso'$x$ in d) = 0 then raise exception 'web_pedido: no se ha podido añadir el tipo de acceso'; end if;
    execute d;
  end if;
end $$;

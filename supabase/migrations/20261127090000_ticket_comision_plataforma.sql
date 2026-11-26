-- ===================== COMISIÓN DE TIXFAST Y FACTURA AL ORGANIZADOR =====================
-- · TIXFAST se queda un % pactado del precio de las entradas (por defecto 8 %, IVA incluido), con un mínimo por
--   entrada para no perder dinero con las entradas baratas. De ahí paga Stripe (la plataforma paga sus costes).
-- · Cada organizador elige los gastos de gestión que paga el comprador en cada evento:
--     recomendado → lo justo para cubrir la comisión (el organizador cobra el 100 % de la entrada)
--     por_entrada → un importe fijo por entrada (si es menos, asume la diferencia; si es más, se la queda)
--     ninguno     → el comprador no paga gastos (el organizador asume toda la comisión)
-- · Al repartir, el organizador recibe: entradas + gastos del comprador − comisión − lo de los RRPP.
-- · Por cada evento TIXFAST emite una factura de la comisión al organizador y se le copia sola en
--   Facturación › Gastos (factura recibida, ya pagada), para que la meta como gasto.
-- · Se guarda lo que cobra Stripe en cada pago (coste_stripe) para saber cuánto margen queda.
-- Solo añade tablas, columnas y funciones (y cambia una línea de web_comprar). Sin pagos reales todavía.

-- ---------- Ajustes de la plataforma (una sola fila; solo el servidor) ----------
create table if not exists public.ticket_plataforma_ajustes (
  id boolean primary key default true check (id),
  comision_pct numeric(5,2) not null default 8 check (comision_pct between 0 and 50),
  comision_min numeric(6,2) not null default 0.50 check (comision_min between 0 and 50),   -- por entrada, IVA incluido
  iva numeric(5,2) not null default 21 check (iva between 0 and 30),
  stripe_pct numeric(5,2) not null default 1.5 check (stripe_pct between 0 and 10),        -- solo para la calculadora
  stripe_fijo numeric(6,2) not null default 0.25 check (stripe_fijo between 0 and 5),
  razon_social text check (length(razon_social) <= 160), nif text check (nif is null or nif ~ '^[A-Z0-9]{8,12}$'),
  direccion text check (length(direccion) <= 200), cp text check (length(cp) <= 10), ciudad text check (length(ciudad) <= 80),
  provincia text check (length(provincia) <= 80), email text check (length(email) <= 160),
  serie text not null default 'TX' check (serie ~ '^[A-Z]{1,4}$'),
  actualizado_en timestamptz not null default now()
);
insert into public.ticket_plataforma_ajustes (id) values (true) on conflict do nothing;
alter table public.ticket_plataforma_ajustes enable row level security;
revoke all on public.ticket_plataforma_ajustes from anon, authenticated;

-- Pacto distinto con un organizador (vacío = el general)
alter table public.ticket_cuentas add column if not exists comision_pct numeric(5,2) check (comision_pct is null or comision_pct between 0 and 50);
alter table public.ticket_cuentas add column if not exists comision_min numeric(6,2) check (comision_min is null or comision_min between 0 and 50);

-- Gastos de gestión del comprador, por evento
alter table public.ticket_web_eventos add column if not exists gastos_modo text not null default 'recomendado'
  check (gastos_modo in ('recomendado', 'por_entrada', 'ninguno'));
alter table public.ticket_web_eventos add column if not exists gastos_entrada numeric(6,2) check (gastos_entrada is null or gastos_entrada between 0 and 100);

-- En cada pago: la comisión de TIXFAST (IVA incluido) y lo que cobró Stripe
alter table public.ticket_pagos add column if not exists comision numeric(10,2) not null default 0 check (comision >= 0);
alter table public.ticket_pagos add column if not exists coste_stripe numeric(10,2) check (coste_stripe is null or coste_stripe >= 0);
-- El organizador ve sus pagos y la comisión, pero no lo que cobra Stripe a TIXFAST (dato interno)
revoke select on public.ticket_pagos from authenticated;
grant select (pedido_id, owner_id, evento_id, modo, estado, entradas, gastos, importe, asistentes, rrpp, sesion_id, payment_intent, cargo_id,
              caduca_en, pagado_en, creado_en, comision) on public.ticket_pagos to authenticated;

-- ---------- Cálculos ----------
-- Tarifa de un organizador
create or replace function public.plataforma_tarifa(p_owner uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('pct', coalesce(c.comision_pct, a.comision_pct), 'min', coalesce(c.comision_min, a.comision_min), 'iva', a.iva)
    from public.ticket_plataforma_ajustes a left join public.ticket_cuentas c on c.owner_id = p_owner
   where a.id
$$;
revoke all on function public.plataforma_tarifa(uuid) from public, anon, authenticated;

-- Comisión de un pedido (IVA incluido): el % del precio de las entradas, con el mínimo por entrada.
-- Nunca más que lo que valen las entradas.
create or replace function public.plataforma_comision(p_owner uuid, p_entradas numeric, p_n int)
returns numeric language sql stable security definer set search_path = '' as $$
  select case when coalesce(p_entradas, 0) <= 0 then 0::numeric
    else least(round(p_entradas, 2), greatest(round(p_entradas * coalesce((t ->> 'pct')::numeric, 0) / 100, 2),
                                              round(coalesce((t ->> 'min')::numeric, 0) * greatest(coalesce(p_n, 1), 1), 2))) end
    from (select public.plataforma_tarifa(p_owner) t) x
$$;
revoke all on function public.plataforma_comision(uuid, numeric, int) from public, anon, authenticated;

-- Gastos de gestión que paga el comprador en un evento
create or replace function public.pago_gastos_evento(p_evento uuid, p_entradas numeric, p_n int)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select case
      when coalesce(p_entradas, 0) <= 0 or f.gastos_modo = 'ninguno' then 0::numeric
      when f.gastos_modo = 'por_entrada' then round(coalesce(f.gastos_entrada, 0) * greatest(coalesce(p_n, 1), 1), 2)
      else public.plataforma_comision(f.owner_id, p_entradas, p_n) end
    from public.ticket_web_eventos f where f.evento_id = p_evento), 0)
$$;
revoke all on function public.pago_gastos_evento(uuid, numeric, int) from public, anon, authenticated;

-- La compra usa los gastos del evento (antes: una fórmula igual para todos)
do $$
declare d text;
begin
  select pg_get_functiondef('public.web_comprar(text,jsonb,jsonb,jsonb)'::regprocedure) into d;
  if position('pago_gastos_evento' in d) > 0 then return; end if;
  d := replace(d, 'v_gastos := public.pago_gastos(v_total);', 'v_gastos := public.pago_gastos_evento(f.evento_id, v_total, jsonb_array_length(p_asistentes));');
  if position('pago_gastos_evento' in d) = 0 then raise exception 'web_comprar: no se ha encontrado el cálculo de los gastos'; end if;
  execute d;
end $$;

-- La comisión se fija al crear el pago (si luego cambia el pacto, lo ya vendido no cambia)
create or replace function public.pago_poner_comision() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.comision := public.plataforma_comision(new.owner_id, new.entradas, jsonb_array_length(coalesce(new.asistentes, '[]'::jsonb)));
  return new;
end $$;
revoke all on function public.pago_poner_comision() from public, anon, authenticated;
drop trigger if exists pago_poner_comision on public.ticket_pagos;
create trigger pago_poner_comision before insert on public.ticket_pagos for each row execute function public.pago_poner_comision();

-- La página pública necesita la configuración de gastos para enseñar el total antes de pagar
do $$
declare d text;
begin
  select pg_get_functiondef('public.web_evento_publico(text)'::regprocedure) into d;
  if position('gastos_cfg' in d) > 0 then return; end if;
  d := replace(d, $a$'pago_pruebas', coalesce(f.pago_pruebas, false),$a$,
                  $b$'pago_pruebas', coalesce(f.pago_pruebas, false), 'gastos_cfg', jsonb_build_object('modo', f.gastos_modo, 'por_entrada', f.gastos_entrada) || coalesce(public.plataforma_tarifa(f.owner_id), '{}'::jsonb),$b$);
  if position('gastos_cfg' in d) = 0 then raise exception 'web_evento_publico: no se ha encontrado dónde añadir gastos_cfg'; end if;
  execute d;
end $$;

-- El organizador ve su tarifa (para la calculadora del evento)
create or replace function public.mi_tarifa_plataforma()
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.plataforma_tarifa((select auth.uid()))
$$;
revoke all on function public.mi_tarifa_plataforma() from public, anon;
grant execute on function public.mi_tarifa_plataforma() to authenticated;

-- ---------- Reparto: el organizador recibe entradas + gastos − comisión ----------
create or replace function public.pago_reparto_calculo(p_evento uuid, p_modo text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with ent as (
    select x.rrpp_id, x.tramo_id, x.precio, p.rrpp_efectivo, g.pedido_id is not null as online
      from public.ticket_web_entradas x join public.ticket_web_pedidos p on p.id = x.pedido_id
      left join public.ticket_pagos g on g.pedido_id = p.id and g.estado = 'pagado' and g.modo = p_modo
     where x.evento_id = p_evento and x.estado = 'valida' and x.prueba = (p_modo = 'pruebas')
       and (g.pedido_id is not null or p.rrpp_efectivo)
  ),
  r as (
    select e.rrpp_id, count(*) n, count(*) filter (where e.online) n_online, count(*) filter (where e.rrpp_efectivo) n_efectivo,
           coalesce(sum(public.rrpp_comision(p_evento, e.rrpp_id, e.tramo_id, e.precio)), 0) comision,
           coalesce(sum(e.precio) filter (where e.rrpp_efectivo), 0) efectivo
      from ent e where e.rrpp_id is not null group by e.rrpp_id
  ),
  pg as (select * from public.ticket_pagos where evento_id = p_evento and estado = 'pagado' and modo = p_modo)
  select jsonb_build_object(
    'evento', p_evento,
    'owner_id', (select owner_id from public.ticket_web_eventos where evento_id = p_evento),
    'cobrado', (select coalesce(sum(entradas), 0) from pg),
    'gastos', (select coalesce(sum(gastos), 0) from pg),
    'comision', (select coalesce(sum(comision), 0) from pg),
    'pendientes', (select count(*) from public.ticket_pagos where evento_id = p_evento and estado = 'pendiente' and modo = p_modo),
    -- «entradas» de cada cargo = lo que se puede repartir de ese pago (lo que no es de TIXFAST)
    'cargos', (select coalesce(jsonb_agg(jsonb_build_object('cargo', cargo_id, 'entradas', entradas + gastos - comision) order by pagado_en), '[]'::jsonb)
                 from pg where cargo_id is not null),
    'rrpp', (select coalesce(jsonb_agg(jsonb_build_object('rrpp_id', r.rrpp_id, 'nombre', k.nombre, 'user_id', k.user_id,
               'entradas', r.n, 'online', r.n_online, 'en_efectivo', r.n_efectivo, 'comision', r.comision, 'efectivo', r.efectivo,
               'neto', greatest(r.comision - r.efectivo, 0), 'debe', greatest(r.efectivo - r.comision, 0))), '[]'::jsonb)
               from r join public.ticket_rrpp k on k.id = r.rrpp_id)
  )
$$;
revoke all on function public.pago_reparto_calculo(uuid, text) from public, anon, authenticated;

-- ---------- Facturas de TIXFAST a los organizadores ----------
create table if not exists public.ticket_plataforma_contadores (
  serie text not null, anio int not null, ultimo int not null default 0, primary key (serie, anio)
);
alter table public.ticket_plataforma_contadores enable row level security;
revoke all on public.ticket_plataforma_contadores from anon, authenticated;

create table if not exists public.ticket_plataforma_facturas (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.ticket_eventos(id) on delete restrict,
  owner_id uuid not null,
  modo text not null check (modo in ('pruebas', 'real')),
  -- falta_emisor: faltan los datos fiscales de TIXFAST · falta_receptor: faltan los del organizador
  estado text not null default 'falta_emisor' check (estado in ('falta_emisor', 'falta_receptor', 'emitida')),
  entradas int not null default 0,                 -- nº de entradas con comisión
  ventas numeric(12,2) not null default 0,         -- precio de las entradas
  gastos_comprador numeric(12,2) not null default 0,
  total numeric(12,2) not null,                    -- comisión con IVA
  base numeric(12,2) not null, cuota_iva numeric(12,2) not null, iva numeric(5,2) not null,
  coste_stripe numeric(12,2),                      -- interno: lo que cobró Stripe en el evento
  serie text, numero int, codigo text unique, fecha date,
  emisor jsonb, receptor jsonb, lineas jsonb,
  huella text, huella_anterior text, cadena text,
  factura_organizador_id uuid references public.ticket_fac_facturas(id) on delete set null,
  creado_en timestamptz not null default now(), emitida_en timestamptz,
  unique (evento_id, modo)
);
create index if not exists ticket_plataforma_facturas_owner on public.ticket_plataforma_facturas (owner_id, creado_en desc);
create index if not exists ticket_plataforma_facturas_pend on public.ticket_plataforma_facturas (estado) where estado <> 'emitida';
alter table public.ticket_plataforma_facturas enable row level security;
drop policy if exists plataforma_facturas_ver on public.ticket_plataforma_facturas;
create policy plataforma_facturas_ver on public.ticket_plataforma_facturas for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.ticket_plataforma_facturas from anon, authenticated;
grant select (id, evento_id, owner_id, modo, estado, entradas, ventas, gastos_comprador, total, base, cuota_iva, iva, serie, numero, codigo, fecha,
              emisor, receptor, lineas, huella, factura_organizador_id, creado_en, emitida_en) on public.ticket_plataforma_facturas to authenticated;

-- Prepara (y emite si ya están los datos) la factura de la comisión de un evento. Nunca cambia una emitida.
create or replace function public.plataforma_facturar_evento(p_evento uuid, p_modo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; em record; ev record; x record; f record; v_tot numeric; v_base numeric; v_iva numeric; v_n int; v_anio int;
        v_codigo text; v_prev text; v_cadena text; v_huella text; v_ahora text; v_emisor jsonb; v_receptor jsonb; v_lineas jsonb; v_fac uuid;
begin
  select * into ev from public.ticket_eventos where id = p_evento;
  if ev.id is null then return jsonb_build_object('ok', false, 'motivo', 'evento'); end if;
  select * into f from public.ticket_plataforma_facturas where evento_id = p_evento and modo = p_modo for update;
  if f.estado = 'emitida' then return jsonb_build_object('ok', true, 'estado', 'emitida', 'codigo', f.codigo); end if;

  select count(*) filter (where comision > 0) n_pagos, coalesce(sum(comision), 0) com, coalesce(sum(entradas), 0) ven, coalesce(sum(gastos), 0) gas,
         coalesce(sum(jsonb_array_length(asistentes)) filter (where comision > 0), 0) n, sum(coste_stripe) stripe
    into x from public.ticket_pagos where evento_id = p_evento and modo = p_modo and estado = 'pagado';
  if x.com <= 0 then return jsonb_build_object('ok', true, 'estado', 'nada'); end if;

  select * into a from public.ticket_plataforma_ajustes where id;
  v_tot := round(x.com, 2); v_iva := a.iva;
  v_base := round(v_tot / (1 + v_iva / 100), 2);
  v_lineas := jsonb_build_array(jsonb_build_object('id', 'c1', 'concepto',
    left(format('Comisión por venta de %s %s · %s', x.n, case when x.n = 1 then 'entrada' else 'entradas' end, coalesce(ev.nombre, 'evento')), 200),
    'cantidad', 1, 'precio', v_base, 'descuento', '', 'iva', v_iva));

  insert into public.ticket_plataforma_facturas as t (evento_id, owner_id, modo, entradas, ventas, gastos_comprador, total, base, cuota_iva, iva, coste_stripe, lineas)
  values (p_evento, ev.owner_id, p_modo, x.n, x.ven, x.gas, v_tot, v_base, v_tot - v_base, v_iva, x.stripe, v_lineas)
  on conflict (evento_id, modo) do update set entradas = excluded.entradas, ventas = excluded.ventas, gastos_comprador = excluded.gastos_comprador,
    total = excluded.total, base = excluded.base, cuota_iva = excluded.cuota_iva, iva = excluded.iva, coste_stripe = excluded.coste_stripe, lineas = excluded.lineas
  returning * into f;

  -- ¿Están los datos de los dos?
  if coalesce(a.razon_social, '') = '' or coalesce(a.nif, '') = '' then
    update public.ticket_plataforma_facturas set estado = 'falta_emisor' where id = f.id;
    return jsonb_build_object('ok', true, 'estado', 'falta_emisor');
  end if;
  select * into em from public.ticket_fac_emisor where owner_id = ev.owner_id;
  if em.owner_id is null then
    update public.ticket_plataforma_facturas set estado = 'falta_receptor' where id = f.id;
    return jsonb_build_object('ok', true, 'estado', 'falta_receptor');
  end if;

  v_emisor := jsonb_build_object('nombre', a.razon_social, 'nif', a.nif, 'direccion', coalesce(a.direccion, ''), 'cp', coalesce(a.cp, ''),
    'ciudad', coalesce(a.ciudad, ''), 'provincia', coalesce(a.provincia, ''), 'pais', 'España', 'email', coalesce(a.email, ''));
  v_receptor := jsonb_build_object('nombre', em.razon_social, 'nif', em.nif, 'direccion', coalesce(em.direccion, ''), 'cp', coalesce(em.cp, ''),
    'ciudad', coalesce(em.ciudad, ''), 'provincia', coalesce(em.provincia, ''), 'pais', coalesce(em.pais, 'España'), 'email', coalesce(em.email, ''));

  if p_modo = 'pruebas' then
    -- Pago de prueba: se ve en el panel, pero no se numera ni entra en la contabilidad de nadie
    update public.ticket_plataforma_facturas set estado = 'emitida', codigo = 'PRUEBA-' || left(f.id::text, 8), fecha = current_date,
      emisor = v_emisor, receptor = v_receptor, emitida_en = now() where id = f.id;
    return jsonb_build_object('ok', true, 'estado', 'emitida', 'prueba', true);
  end if;

  v_anio := extract(year from (now() at time zone 'Europe/Madrid'))::int;
  insert into public.ticket_plataforma_contadores as c (serie, anio, ultimo) values (a.serie, v_anio, 1)
    on conflict (serie, anio) do update set ultimo = c.ultimo + 1 returning ultimo into v_n;
  v_codigo := a.serie || v_anio::text || '-' || lpad(v_n::text, 5, '0');
  -- Registro encadenado (misma idea que la facturación de la app): cada factura guarda la huella de la anterior
  select huella into v_prev from public.ticket_plataforma_facturas where modo = 'real' and estado = 'emitida' and huella is not null order by emitida_en desc, numero desc limit 1;
  v_ahora := to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM-DD"T"HH24:MI:SS');
  v_cadena := 'IDEmisorFactura=' || a.nif || '&NumSerieFactura=' || v_codigo || '&FechaExpedicionFactura=' || to_char(current_date, 'DD-MM-YYYY') ||
              '&TipoFactura=F1&CuotaTotal=' || to_char(v_tot - v_base, 'FM999999990.00') || '&ImporteTotal=' || to_char(v_tot, 'FM999999990.00') ||
              '&Huella=' || coalesce(v_prev, '') || '&FechaHoraHusoGenRegistro=' || v_ahora;
  v_huella := upper(encode(extensions.digest(v_cadena, 'sha256'), 'hex'));

  -- Copia en la Facturación del organizador: factura recibida, ya pagada (se descontó en el reparto)
  insert into public.ticket_fac_facturas (owner_id, tipo, estado, fecha, contacto, lineas, base, cuota_iva, irpf_pct, cuota_irpf, total, desglose,
                                          num_proveedor, categoria, forma_pago, notas, pagada_en)
  values (ev.owner_id, 'recibida', 'pagada', current_date, v_emisor || jsonb_build_object('nombre', 'TIXFAST · ' || a.razon_social),
          v_lineas, v_base, v_tot - v_base, 0, 0, v_tot,
          jsonb_build_array(jsonb_build_object('tipo', v_iva, 'base', v_base, 'cuota', v_tot - v_base)),
          v_codigo, 'Bancos y comisiones', 'Descontado del reparto',
          left(format('Comisión TIXFAST del evento «%s». Se descontó al repartir el dinero de las entradas.', coalesce(ev.nombre, '')), 2000), current_date)
  returning id into v_fac;

  update public.ticket_plataforma_facturas set estado = 'emitida', serie = a.serie, numero = v_n, codigo = v_codigo, fecha = current_date,
    emisor = v_emisor, receptor = v_receptor, huella = v_huella, huella_anterior = v_prev, cadena = v_cadena,
    factura_organizador_id = v_fac, emitida_en = now() where id = f.id;
  return jsonb_build_object('ok', true, 'estado', 'emitida', 'codigo', v_codigo);
end $$;
revoke all on function public.plataforma_facturar_evento(uuid, text) from public, anon, authenticated;

-- Reintenta las que esperaban datos (se llama en cada reparto automático)
create or replace function public.plataforma_facturas_reintentar()
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0; v jsonb;
begin
  for r in select evento_id, modo from public.ticket_plataforma_facturas where estado <> 'emitida' order by creado_en limit 200 loop
    v := public.plataforma_facturar_evento(r.evento_id, r.modo);
    if v ->> 'estado' = 'emitida' then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function public.plataforma_facturas_reintentar() from public, anon, authenticated;

-- Informe para el panel de TIXFAST: lo cobrado de comisión frente a lo que se lleva Stripe
create or replace function public.plataforma_informe_comisiones(p_modo text, p_desde date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('evento_id', x.evento_id, 'evento', e.nombre, 'fecha', e.fecha, 'pagos', x.pagos, 'entradas', x.n,
    'ventas', x.ven, 'gastos', x.gas, 'cobrado', x.cob, 'comision', x.com, 'stripe', x.stripe, 'stripe_sin_dato', x.sin_dato,
    'factura', (select jsonb_build_object('estado', pf.estado, 'codigo', pf.codigo) from public.ticket_plataforma_facturas pf where pf.evento_id = x.evento_id and pf.modo = p_modo))
    order by e.fecha desc nulls last), '[]'::jsonb)
  from (select evento_id, count(*) pagos, sum(jsonb_array_length(asistentes)) n, sum(entradas) ven, sum(gastos) gas, sum(importe) cob,
               sum(comision) com, sum(coste_stripe) stripe, count(*) filter (where coste_stripe is null) sin_dato
          from public.ticket_pagos where modo = p_modo and estado = 'pagado' and coalesce(pagado_en, creado_en) >= p_desde group by evento_id) x
  join public.ticket_eventos e on e.id = x.evento_id
$$;
revoke all on function public.plataforma_informe_comisiones(text, date) from public, anon, authenticated;

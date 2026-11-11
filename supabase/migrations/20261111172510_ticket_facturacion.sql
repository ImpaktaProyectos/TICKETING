-- Copia de la migración ya aplicada en Supabase (versión 20261111172510).
-- ============ FACTURACIÓN PROPIA (independiente de los números de los eventos) ============
create table if not exists public.ticket_fac_emisor (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  tipo text not null default 'sociedad' check (tipo in ('sociedad','autonomo')),
  razon_social text not null check (length(btrim(razon_social)) between 2 and 160),
  nombre_comercial text check (length(nombre_comercial) <= 120),
  nif text not null check (nif ~ '^[A-Z0-9]{8,12}$'),
  direccion text check (length(direccion) <= 200), cp text check (length(cp) <= 10), ciudad text check (length(ciudad) <= 80),
  provincia text check (length(provincia) <= 80), pais text not null default 'España' check (length(pais) <= 60),
  email text check (length(email) <= 160), telefono text check (length(telefono) <= 40), web text check (length(web) <= 160),
  iban text check (length(iban) <= 40), logo_url text check (length(logo_url) <= 500),
  color text not null default '#ff5a3c' check (color ~ '^#[0-9a-fA-F]{6}$'),
  plantilla text not null default 'clasica' check (plantilla in ('clasica','moderna','minimal')),
  serie text not null default 'F' check (serie ~ '^[A-Z]{1,4}$'),
  iva_def numeric(5,2) not null default 21, irpf_def numeric(5,2) not null default 0,
  vencimiento_dias int not null default 30 check (vencimiento_dias between 0 and 365),
  pie text check (length(pie) <= 600), qr boolean not null default true,
  actualizado_en timestamptz not null default now()
);

create table if not exists public.ticket_fac_contactos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tipo text not null default 'cliente' check (tipo in ('cliente','proveedor','ambos')),
  nombre text not null check (length(btrim(nombre)) between 1 and 160),
  nif text check (length(nif) <= 20), email text check (length(email) <= 160), telefono text check (length(telefono) <= 40),
  direccion text check (length(direccion) <= 200), cp text check (length(cp) <= 10), ciudad text check (length(ciudad) <= 80),
  provincia text check (length(provincia) <= 80), pais text default 'España' check (length(pais) <= 60),
  notas text check (length(notas) <= 1000),
  creado_en timestamptz not null default now(), actualizado_en timestamptz not null default now()
);
create index if not exists ticket_fac_contactos_owner_idx on public.ticket_fac_contactos (owner_id, nombre);

create table if not exists public.ticket_fac_contadores (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  serie text not null, anio int not null, ultimo int not null default 0,
  primary key (owner_id, serie, anio)
);

create table if not exists public.ticket_fac_facturas (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('emitida','recibida')),
  estado text not null default 'borrador' check (estado in ('borrador','emitida','pagada','pendiente')),
  serie text check (serie ~ '^[A-Z]{1,4}$'), numero int, codigo text check (length(codigo) <= 40),
  rectificativa boolean not null default false, rectifica_id uuid references public.ticket_fac_facturas(id) on delete restrict,
  motivo text check (length(motivo) <= 500),
  fecha date not null default current_date, fecha_operacion date, vencimiento date,
  contacto_id uuid references public.ticket_fac_contactos(id) on delete set null,
  contacto jsonb not null default '{}'::jsonb, emisor jsonb,
  lineas jsonb not null default '[]'::jsonb check (jsonb_typeof(lineas) = 'array' and jsonb_array_length(lineas) <= 200),
  base numeric(12,2) not null default 0, cuota_iva numeric(12,2) not null default 0,
  irpf_pct numeric(5,2) not null default 0, cuota_irpf numeric(12,2) not null default 0, total numeric(12,2) not null default 0,
  desglose jsonb not null default '[]'::jsonb,
  num_proveedor text check (length(num_proveedor) <= 60), categoria text check (length(categoria) <= 60),
  forma_pago text check (length(forma_pago) <= 60), notas text check (length(notas) <= 2000),
  plantilla text check (plantilla in ('clasica','moderna','minimal')),
  archivo_path text check (length(archivo_path) <= 300), pagada_en date,
  huella text, huella_anterior text, registro jsonb, registrada_en timestamptz,
  creado_en timestamptz not null default now(), actualizado_en timestamptz not null default now(),
  constraint ticket_fac_codigo_emitida check (tipo <> 'emitida' or estado = 'borrador' or (codigo is not null and huella is not null)),
  constraint ticket_fac_estado_tipo check ((tipo = 'emitida' and estado in ('borrador','emitida','pagada')) or (tipo = 'recibida' and estado in ('pendiente','pagada')))
);
create unique index if not exists ticket_fac_codigo_uq on public.ticket_fac_facturas (owner_id, codigo) where tipo = 'emitida' and codigo is not null;
create index if not exists ticket_fac_facturas_owner_fecha_idx on public.ticket_fac_facturas (owner_id, tipo, fecha desc);
create index if not exists ticket_fac_facturas_contacto_idx on public.ticket_fac_facturas (contacto_id);
create index if not exists ticket_fac_facturas_rectifica_idx on public.ticket_fac_facturas (rectifica_id);

create table if not exists public.ticket_fac_registro (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  factura_id uuid not null references public.ticket_fac_facturas(id) on delete restrict,
  evento text not null check (evento in ('alta','pagada','pendiente')),
  codigo text, huella text, huella_anterior text, cadena text,
  creado_en timestamptz not null default now()
);
create index if not exists ticket_fac_registro_owner_idx on public.ticket_fac_registro (owner_id, id desc);
create index if not exists ticket_fac_registro_factura_idx on public.ticket_fac_registro (factura_id);

alter table public.ticket_fac_emisor enable row level security;
alter table public.ticket_fac_contactos enable row level security;
alter table public.ticket_fac_contadores enable row level security;
alter table public.ticket_fac_facturas enable row level security;
alter table public.ticket_fac_registro enable row level security;

create policy fac_emisor_own on public.ticket_fac_emisor for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy fac_contactos_own on public.ticket_fac_contactos for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy fac_contadores_ver on public.ticket_fac_contadores for select to authenticated using (owner_id = (select auth.uid()));
create policy fac_contadores_alta on public.ticket_fac_contadores for insert to authenticated with check (owner_id = (select auth.uid()));
create policy fac_contadores_sube on public.ticket_fac_contadores for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy fac_facturas_own on public.ticket_fac_facturas for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy fac_registro_ver on public.ticket_fac_registro for select to authenticated using (owner_id = (select auth.uid()));
create policy fac_registro_alta on public.ticket_fac_registro for insert to authenticated with check (owner_id = (select auth.uid()));

revoke all on public.ticket_fac_emisor, public.ticket_fac_contactos, public.ticket_fac_contadores, public.ticket_fac_facturas, public.ticket_fac_registro from anon;
grant select, insert, update, delete on public.ticket_fac_emisor, public.ticket_fac_contactos, public.ticket_fac_facturas to authenticated;
grant select, insert, update on public.ticket_fac_contadores to authenticated;
grant select, insert on public.ticket_fac_registro to authenticated;

create or replace function public.fac_inmutable() returns trigger language plpgsql set search_path to '' as $$
begin
  if tg_op = 'DELETE' then
    if old.tipo = 'emitida' and old.estado <> 'borrador' then
      raise exception 'Una factura emitida no se puede borrar: haz una rectificativa' using errcode = 'P0001';
    end if;
    return old;
  end if;
  new.actualizado_en := now();
  if old.tipo = 'emitida' and old.estado = 'borrador' and new.estado <> 'borrador'
     and coalesce(current_setting('tixfast.fac_emitiendo', true), '') <> 'si' then
    raise exception 'Las facturas se emiten con «Emitir» (numeración y registro)' using errcode = 'P0001';
  end if;
  if old.tipo = 'emitida' and old.estado <> 'borrador' then
    if new.estado not in ('emitida','pagada')
       or (to_jsonb(new) - array['estado','pagada_en','archivo_path','actualizado_en'])
          is distinct from (to_jsonb(old) - array['estado','pagada_en','archivo_path','actualizado_en']) then
      raise exception 'Una factura emitida no se puede modificar: haz una rectificativa' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists fac_inmutable on public.ticket_fac_facturas;
create trigger fac_inmutable before update or delete on public.ticket_fac_facturas for each row execute function public.fac_inmutable();

create or replace function public.fac_emitir(p_id uuid) returns public.ticket_fac_facturas
language plpgsql security invoker set search_path to '' as $$
declare f public.ticket_fac_facturas; em public.ticket_fac_emisor; uid uuid := auth.uid();
  v_serie text; v_anio int; v_n int; v_codigo text; v_ult date; v_prev text; v_cadena text; v_huella text; v_ahora text; v_off interval;
  v_base numeric := 0; v_iva numeric := 0; v_irpf numeric; v_total numeric; v_desg jsonb;
begin
  if uid is null then raise exception 'Sin sesión' using errcode = '42501'; end if;
  select * into f from public.ticket_fac_facturas where id = p_id and owner_id = uid for update;
  if f.id is null then raise exception 'Factura no encontrada' using errcode = 'P0002'; end if;
  if f.tipo <> 'emitida' or f.estado <> 'borrador' then raise exception 'Esta factura ya está emitida' using errcode = 'P0001'; end if;
  select * into em from public.ticket_fac_emisor where owner_id = uid;
  if em.owner_id is null then raise exception 'Faltan tus datos fiscales' using errcode = 'P0001'; end if;
  if coalesce(btrim(f.contacto ->> 'nombre'), '') = '' then raise exception 'Falta el nombre del cliente' using errcode = 'P0001'; end if;
  if coalesce(btrim(f.contacto ->> 'nif'), '') = '' then raise exception 'Falta el NIF del cliente' using errcode = 'P0001'; end if;
  if jsonb_array_length(f.lineas) = 0 then raise exception 'La factura no tiene líneas' using errcode = 'P0001'; end if;
  if f.fecha > (now() at time zone 'Europe/Madrid')::date then raise exception 'La fecha de la factura no puede ser futura' using errcode = 'P0001'; end if;
  if f.rectificativa and f.rectifica_id is null then raise exception 'Una rectificativa debe indicar qué factura corrige' using errcode = 'P0001'; end if;

  with li as (
    select round(coalesce((x ->> 'cantidad')::numeric, 0) * coalesce((x ->> 'precio')::numeric, 0) * (1 - least(greatest(coalesce((x ->> 'descuento')::numeric, 0), 0), 100) / 100), 2) as base,
           coalesce((x ->> 'iva')::numeric, 0) as tipo
    from jsonb_array_elements(f.lineas) x),
  g as (select tipo, sum(base) as base, round(sum(base) * tipo / 100, 2) as cuota from li group by tipo)
  select coalesce(sum(base), 0), coalesce(sum(cuota), 0), coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'base', base, 'cuota', cuota) order by tipo desc), '[]'::jsonb)
    into v_base, v_iva, v_desg from g;
  v_irpf := round(v_base * coalesce(f.irpf_pct, 0) / 100, 2);
  v_total := v_base + v_iva - v_irpf;

  v_serie := case when f.rectificativa then 'R' else coalesce(nullif(f.serie, ''), em.serie, 'F') end;
  v_anio := extract(year from f.fecha)::int;
  select max(fecha) into v_ult from public.ticket_fac_facturas
   where owner_id = uid and tipo = 'emitida' and estado <> 'borrador' and serie = v_serie and extract(year from fecha) = v_anio;
  if v_ult is not null and f.fecha < v_ult then
    raise exception 'La fecha no puede ser anterior a la última factura de la serie (%)', to_char(v_ult, 'DD/MM/YYYY') using errcode = 'P0001';
  end if;
  insert into public.ticket_fac_contadores as c (owner_id, serie, anio, ultimo) values (uid, v_serie, v_anio, 1)
    on conflict (owner_id, serie, anio) do update set ultimo = c.ultimo + 1 returning ultimo into v_n;
  v_codigo := v_serie || v_anio::text || '-' || lpad(v_n::text, 4, '0');

  select r.huella into v_prev from public.ticket_fac_registro r where r.owner_id = uid and r.evento = 'alta' order by r.id desc limit 1;
  v_off := (now() at time zone 'Europe/Madrid') - (now() at time zone 'UTC');
  v_ahora := to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM-DD"T"HH24:MI:SS') || case when v_off >= interval '0' then '+' else '-' end || to_char(abs(extract(epoch from v_off))::int / 3600, 'FM00') || ':' || to_char((abs(extract(epoch from v_off))::int % 3600) / 60, 'FM00');
  v_cadena := 'IDEmisorFactura=' || em.nif || '&NumSerieFactura=' || v_codigo || '&FechaExpedicionFactura=' || to_char(f.fecha, 'DD-MM-YYYY') ||
              '&TipoFactura=' || case when f.rectificativa then 'R1' else 'F1' end || '&CuotaTotal=' || to_char(v_iva, 'FM999999990.00') ||
              '&ImporteTotal=' || to_char(v_total, 'FM999999990.00') || '&Huella=' || coalesce(v_prev, '') || '&FechaHoraHusoGenRegistro=' || v_ahora;
  v_huella := upper(encode(extensions.digest(v_cadena, 'sha256'), 'hex'));

  perform set_config('tixfast.fac_emitiendo', 'si', true);
  update public.ticket_fac_facturas set
    estado = 'emitida', serie = v_serie, numero = v_n, codigo = v_codigo,
    base = v_base, cuota_iva = v_iva, cuota_irpf = v_irpf, total = v_total, desglose = v_desg,
    emisor = to_jsonb(em) - array['owner_id','actualizado_en','color','plantilla','serie','iva_def','irpf_def','vencimiento_dias','qr'],
    plantilla = coalesce(f.plantilla, em.plantilla),
    huella = v_huella, huella_anterior = v_prev, registrada_en = now(),
    registro = jsonb_build_object('cadena', v_cadena, 'fecha_hora', v_ahora, 'tipo', case when f.rectificativa then 'R1' else 'F1' end)
  where id = f.id returning * into f;
  perform set_config('tixfast.fac_emitiendo', '', true);
  insert into public.ticket_fac_registro (owner_id, factura_id, evento, codigo, huella, huella_anterior, cadena)
    values (uid, f.id, 'alta', v_codigo, v_huella, v_prev, v_cadena);
  return f;
end $$;
revoke all on function public.fac_emitir(uuid) from public, anon;
grant execute on function public.fac_emitir(uuid) to authenticated;
revoke all on function public.fac_inmutable() from public, anon, authenticated;

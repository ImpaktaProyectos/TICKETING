-- ===================== PANEL DEL PUNTO DE VENTA: entregas ya liquidadas =====================
-- Va después de 20261127140000_ticket_pv_panel.sql.
-- Una vez el organizador cierra la liquidación de una entrega, el punto ya no puede devolver ni sumar ventas
-- desde su panel (cambiaría las cuentas ya cerradas). Registrar ventas escaneando sigue permitido (es solo informativo).
do $$
declare d text;
begin
  select pg_get_functiondef('public.pv_escanear(uuid,text,text)'::regprocedure) into d;
  if position('liquidada' in d) = 0 then
    d := replace(d, $a$    select * into l from public.ticket_pv_lotes where id = x.lote_id for update;
$a$, $b$    select * into l from public.ticket_pv_lotes where id = x.lote_id for update;
    if l.vendidas_modo is not null then return jsonb_build_object('ok', false, 'motivo', 'liquidada', 'numero', x.numero); end if;
$b$);
    if position('liquidada' in d) = 0 then raise exception 'pv_escanear: no se ha encontrado dónde comprobar la liquidación'; end if;
    execute d;
  end if;
  select pg_get_functiondef('public.pv_sumar(uuid,uuid,int)'::regprocedure) into d;
  if position('liquidada' in d) = 0 then
    d := replace(d, $a$  if p_delta not in (-1, 1) then$a$, $b$  if l.vendidas_modo is not null then return jsonb_build_object('ok', false, 'motivo', 'liquidada'); end if;
  if p_delta not in (-1, 1) then$b$);
    if position('liquidada' in d) = 0 then raise exception 'pv_sumar: no se ha encontrado dónde comprobar la liquidación'; end if;
    execute d;
  end if;
end $$;

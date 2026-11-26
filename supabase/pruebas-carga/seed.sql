-- Datos de una noche grande: 1 festival (cuenta A) + 299 cuentas con su fiesta a la vez.
insert into ticket_planes (id, nombre, limites) values ('pro', 'Pro', '{}'), ('sin_suscripcion', 'Sin suscripción', '{"bloquea":["tpv","crm"]}');
-- Cuentas: la 1 es el festival grande
insert into auth.users select ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 300) g;
insert into ticket_cuentas (owner_id, plan_id, estado) select id, 'pro', 'activa' from auth.users;
-- Eventos (uno por cuenta, todos hoy, multipuesto)
insert into ticket_eventos (id, owner_id, nombre, fecha, ticket_style, qr_activo)
select ('10000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
       'Fiesta ' || g, current_date, '{"modalidad":"multipuesto"}', true from generate_series(1, 300) g;
-- Barras: 20 en el festival, 3 en el resto
insert into ticket_puntos (id, owner_id, evento_id, nombre, estado)
select gen_random_uuid(), e.owner_id, e.id, 'Barra ' || b, 'abierta'
from ticket_eventos e cross join lateral generate_series(1, case when e.nombre = 'Fiesta 1' then 20 else 3 end) b;
-- 15 productos por barra
insert into ticket_productos (owner_id, punto_id, nombre, precio)
select p.owner_id, p.id, (array['Cerveza','Copa','Refresco','Agua','Chupito','Vino','Hamburguesa','Pizza','Bocadillo','Patatas','Café','Combinado','Tinto','Sidra','Red Bull'])[k], 3 + k
from ticket_puntos p cross join generate_series(1, 15) k;
-- Ventas ya hechas esta noche: 30.000 en el festival, 500 en cada fiesta
insert into ticket_ventas (owner_id, evento_id, punto_id, producto_id, nombre, precio, numero, codigo, client_uuid, metodo_pago, creado_en)
select e.owner_id, e.id, pr.punto_id, pr.id, pr.nombre, pr.precio,
       row_number() over (partition by e.id order by g), 'X-' || g, gen_random_uuid(),
       case when g % 3 = 0 then 'tarjeta' else 'efectivo' end, now() - interval '5 hours' + (g * interval '400 ms')
from ticket_eventos e
cross join lateral generate_series(1, case when e.nombre = 'Fiesta 1' then 30000 else 500 end) g
cross join lateral (select p.id, p.punto_id, p.nombre, p.precio from ticket_productos p join ticket_puntos pt on pt.id = p.punto_id
                    where pt.evento_id = e.id order by md5(p.id::text || g) limit 1) pr;
-- Canjes: 2/3 de las ventas del festival ya canjeadas por puestos / barras
insert into ticket_puestos (owner_id, evento_id, nombre, comision_valor)
select e.owner_id, e.id, 'Puesto ' || k, 20 from ticket_eventos e cross join generate_series(1, 10) k where e.nombre = 'Fiesta 1';
insert into ticket_puesto_productos (puesto_id, owner_id, consumicion)
select pu.id, pu.owner_id, lower(x) from ticket_puestos pu cross join unnest(array['Cerveza','Copa','Refresco','Agua','Chupito','Vino','Hamburguesa','Pizza','Bocadillo','Patatas','Café','Combinado','Tinto','Sidra','Red Bull']) x;
insert into ticket_puesto_sesiones (puesto_id, huella, dispositivo, caduca_en, desbloqueado_hasta)
select pu.id, encode(digest('sesion-de-prueba-del-puesto-numero-' || lpad(row_number() over ()::text, 4, '0'), 'sha256'), 'hex'), 'movil', now() + interval '1 day', now() + interval '12 hours'
from ticket_puestos pu;
insert into ticket_canjes (owner_id, evento_id, venta_uuid, idx, producto_id, nombre, punto_venta_id, puesto_id, origen, valor, canjeado_en, recibido_en)
select v.owner_id, v.evento_id, v.client_uuid, 0, v.producto_id, v.nombre, v.punto_id,
       (select id from ticket_puestos pu where pu.evento_id = v.evento_id order by md5(pu.id::text || v.id) limit 1), 'puesto', v.precio, v.creado_en + interval '3 min', v.creado_en + interval '3 min'
from ticket_ventas v where v.evento_id = '10000000-0000-0000-0000-000000000001' and v.numero % 3 <> 0;
-- Entradas online del festival: 8.000
insert into ticket_web_eventos (evento_id, owner_id, slug, estado, modo) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'festival', 'publicado', 'real');
insert into ticket_web_pedidos (id, owner_id, evento_id, codigo, email, nombre, estado, total)
select ('20000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'P' || g, 'c' || g || '@x.es', 'Cliente ' || g, 'pagado', 20
from generate_series(1, 4000) g;
insert into ticket_web_entradas (owner_id, evento_id, pedido_id, tramo_nombre, numero, asistente, qr_hex)
select '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', ('20000000-0000-0000-0000-' || lpad(((g + 1) / 2)::text, 12, '0'))::uuid, 'General', g, 'Asistente ' || g, 'x'
from generate_series(1, 8000) g;
analyze;

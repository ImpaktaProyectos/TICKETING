drop table if exists carga_prod, carga_qr;
create table carga_prod as
select row_number() over (order by (e.nombre <> 'Fiesta 1'), p.id) n, e.id evento, p.punto_id punto, p.id prod, p.nombre, p.precio, e.owner_id owner
from ticket_productos p join ticket_puntos pt on pt.id = p.punto_id join ticket_eventos e on e.id = pt.evento_id;
create unique index on carga_prod(n);
create table carga_qr as
select row_number() over () n, encode(m || substring(hmac(m, decode(e.qr_clave, 'hex'), 'sha256') from 1 for 8), 'hex') hex
from ticket_ventas v join ticket_eventos e on e.id = v.evento_id,
lateral (select set_byte('\x00'::bytea, 0, 1) || decode(replace(v.client_uuid::text, '-', ''), 'hex') || '\x00'::bytea || '\x01'::bytea || decode(left(replace(v.producto_id::text, '-', ''), 12), 'hex') m) x
where v.evento_id = '10000000-0000-0000-0000-000000000001' and v.numero % 3 = 0;
create unique index on carga_qr(n);
grant select on carga_prod, carga_qr to authenticated, anon;
analyze carga_prod; analyze carga_qr;
select (select count(*) from carga_prod where evento = '10000000-0000-0000-0000-000000000001') festival_prods, (select count(*) from carga_qr) qrs;

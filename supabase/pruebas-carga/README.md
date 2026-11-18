# Prueba de carga de TIXFAST

Copia local (sin tocar producción) de las tablas y funciones que más se usan en una noche de fiesta,
con datos de una noche grande: 300 fiestas a la vez (~800 dispositivos) y un festival con 30.000 ventas,
20.000 canjes y 8.000 entradas online.

## Cómo se lanza (Postgres 16 local)
```
createdb tix
psql -d tix -f base.sql -f canje.sql -f cz.sql -f seed.sql -f helpers.sql
./mezcla.sh                                  # cómo está HOY la app
psql -d tix -f ../migrations/20261120090000_ticket_rendimiento.sql
PRE=post_ ./mezcla.sh                        # con la migración y la app nueva (refresco incremental)
# Compra de entradas en un lanzamiento (con y sin ataque de compras falsas)
psql -d tix -f web.sql -f web_comprar_prod.sql      # versión de producción
pgbench -n -c 50 -T 15 -f esc/compra_real.sql tix   # compradores reales
pgbench -n -c 20 -T 15 -R 300 -f esc/compra_ataque.sql tix   # a la vez: 300 compras falsas/s
psql -d tix -f web_reset.sql                        # vuelve a los mismos datos entre pruebas
psql -d tix -f ../migrations/20261120100000_ticket_compras_rendimiento.sql   # versión nueva
R=1500 C=150 PRE=post_ ./mezcla.sh           # para buscar el punto de rotura
```
`mezcla.sh` reparte las peticiones por segundo de una noche real (ventas, refrescos de los TPV,
escáneres, canjes de puestos y su panel). `canje.sql` sale de la migración de multipuesto.

## Resultados (18/11/2026, 4 núcleos)
| | Antes | Después |
|---|---|---|
| Peticiones atendidas (objetivo 442/s) | 268/s | 442/s |
| Tiempo medio de respuesta | 10,4 s | 2 ms |
| Venta en el festival (una caja) | 9,8 ms | 1,4 ms |
| Refresco de un TPV del festival | 443 ms | 0,8 ms |
| Ciclo de un escáner | 120 ms | 0,8 ms |
| Punto de rotura | < 442/s | ~2.500/s (cómodo hasta 1.500/s) |
| Ventas por segundo en un mismo evento | ~100 (y bajando) | 414 |
| Descarga completa de las ventas de un festival | 696 ms | 30 ms |
| Compras reales con 300 compras falsas/s | 188/s | 232/s (igual que sin ataque) |
| Panel de un puesto (2.000 canjes) | 35 ms | 8 ms |
| Liquidación de puestos (20.000 canjes) | 305 ms | 18 ms |

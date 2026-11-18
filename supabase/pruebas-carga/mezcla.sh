#!/bin/bash
# Noche con ~800 dispositivos: rate total y reparto por tipo de petición (peticiones/segundo reales)
# vender_festival 5 · vender_otras 56 · refresco festival 10 · refresco otras 360 · validador 2 · canje puesto 4 · panel 5
R=${R:-442}; T=${T:-60}; C=${C:-60}; PRE=${PRE:-}
pgbench -h /tmp -p 55432 -U postgres -n -M simple -c $C -j 4 -T $T -R $R -P 10 --log --log-prefix=/tmp/${PRE}mix \
  -f esc/${PRE}vender_festival.sql@5 -f esc/${PRE}vender_otras.sql@56 -f esc/${PRE}refresco_tpv_completo.sql@10 -f esc/${PRE}refresco_otras.sql@360 \
  -f esc/${PRE}ciclo_validador.sql@2 -f esc/puesto_canjear.sql@4 -f esc/puesto_panel.sql@5 tix

# TIXFAST · Planes de suscripción configurables

Actualizado: 17/11/2026. Rama `claude/loving-johnson-dvw2ud`.

## 1. Qué tiene la plataforma (revisión)

| Bloque | Qué incluye | ¿Se cobra? |
|---|---|---|
| **TPV** | Venta en barra, cobro rápido o avanzado (efectivo/tarjeta y cambio), fondo de caja, gastos y entradas de caja, invitaciones, combos, plantilla del ticket, tickets con QR antifraude, PIN de admin/supervisor, cierres Z (y revertir), cierre de la noche en PDF, funciona sin internet | Plan |
| **Reservados VIP** | Mesas, tarifas, extras y botellas, promotores, socios, plano de sala 2D/3D, «Mis planos», ficha de bebidas del cliente, cobro en taquilla | Plan |
| **Reserva online de mesas** | El cliente elige mesa en el plano y paga el adelanto desde el móvil | Plan (nuevo permiso aparte) |
| **CRM** | Panel, ingresos, gastos con foto, liquidación, socios (aportaciones y deudas) | Plan |
| **Previsión** | Previsión de ingresos y gastos antes del evento | Plan |
| **Stock** | Almacén, recetas, albaranes y recuentos | Plan |
| **Facturación** | Facturas emitidas y recibidas, facturas que se repiten | Plan |
| **Conexión con ticketeras** | Trae solas las ventas de Fourvenues | Plan |
| **Ticketera** | Venta de entradas online, tramos, webs de organización, RRPP, validación de entradas | **Siempre gratis** (de ahí salen las comisiones) |

## 2. Lo que encontré en el panel de administración y he arreglado

1. **Los planes estaban fijados en el código** (`pro`, `premium`, `empresa`) en la app, en el cobro de Stripe y en el aviso de Stripe. Un cuarto plan era imposible sin programar. → Ahora se crean desde el panel, sin límite de planes.
2. **Solo se podía cambiar precio y visibilidad.** No había forma de decidir qué incluye cada plan ni sus límites. → Editor completo.
3. **Los límites de eventos y de barras solo los comprobaba la app** (se podían saltar). → Ahora los comprueba la base de datos, como el resto.
4. **Fallo**: una cuenta en prueba de un plan con menos funciones podía usarlas igualmente en los eventos creados durante la prueba (la regla «una noche nunca se corta» se aplicaba a todos). → Ahora solo protege a quien ha perdido la suscripción.
5. **Regalar suscripción siempre regalaba el plan TIXFAST.** → Ahora eliges qué plan regalas.
6. Los avisos decían «Pasa a TIXFAST Premium» (nombre fijo) y los correos usaban el precio de un plan fijo. → Ahora proponen el plan más barato que lo incluye.
7. Quien ya pagaba un plan sin cierta función veía «Suscríbete». → Ahora ve «No incluido en tu plan» y puede pasar al plan que la incluye en un toque (Stripe cobra solo la diferencia del mes).

## 3. Cómo funciona ahora

**Panel TIXFAST › Planes**
- **Nuevo plan**: nombre, descripción, precio al mes, días de prueba gratis (0–60), «Se puede contratar», «Recomendado».
- **Qué incluye** (interruptores): TPV, Reservados VIP, Reserva online de mesas, CRM, Facturación, Stock, Previsión, Conexión con ticketeras.
- **Límites** (número o «Sin límite»): eventos a la vez, **puntos de venta por evento**, **planos guardados** (mapas de reservados), socios, facturas emitidas al mes.
- **Así lo ve el cliente**: vista previa mientras editas.
- **Comparar planes**: tabla con todo de un vistazo.
- Ordenar (↑ ↓), duplicar, archivar (si alguien lo tiene) o borrar (si nadie lo ha usado), recuperar.
- **Stripe**: al guardar se crea o actualiza solo el producto y el precio en Stripe. Si cambias el precio se crea uno nuevo y se desactiva el anterior; **las suscripciones en marcha siguen con su precio** (el panel te avisa de cuántas son).
- Los **permisos** cambian al momento para todas las cuentas del plan (también te avisa antes).
- Planes del sistema: **Fundador** (todo, sin cuota) y **Sin suscripción** (qué ve gratis quien no paga; también se puede ajustar).
- Todo queda en **Registro**.

**El cliente**: elige plan en la pantalla de suscripción, cambia de plan en Ajustes › Tu cuenta, y cuando toca algo que su plan no incluye le sale a qué plan pasarse.

**Para añadir en el futuro una función o un límite nuevo**: añadirlo en `CATALOGO`/`LIMITES` de `ticketera-app/src/planes.js` y en `ticket_catalogo()` (hay una prueba que avisa si no coinciden), y su comprobación en la base de datos.

## 4. Estrategia recomendada: dos planes

La idea: **separar por tipo de cliente, no trocear el CRM**. Quitar «gastos» pero dejar «ingresos» rompe la liquidación y confunde; las piezas que dependen unas de otras van juntas.

| | **TIXFAST** (≈ 29,90 €) | **TIXFAST Pro** (≈ 59,90 €) |
|---|---|---|
| Para quién | Organizador que hace sus noches | Salas, grupos y promotoras con varios eventos al mes |
| TPV, Reservados VIP, CRM, Previsión | ✓ | ✓ |
| Reserva online de mesas | — | ✓ (genera dinero: justifica el salto) |
| Facturación, Stock, Conexión con ticketeras | — | ✓ (lo necesita una empresa) |
| Eventos a la vez | 3 | Sin límite |
| Puntos de venta por evento | 4 | Sin límite |
| Planos guardados | 2 | Sin límite |
| Prueba gratis | 7 días | 14 días |

- **Ticketera gratis** como puerta de entrada; **Sin suscripción** en vista previa (lo ve todo, no puede usarlo).
- Los motivos para subir aparecen solos al crecer (más barras, más salas, reserva online, facturas), y en ese momento la app ofrece el cambio.
- **Recomendado**: TIXFAST (el que más se vende); Pro como ancla de precio.
- Un tercer plan (p. ej. «Empresa» con varios equipos) se crea en el panel cuando haga falta, sin tocar código.

> No lo he aplicado: hoy el plan TIXFAST incluye todo salvo un límite de 2 planos. Configurarlo así son dos minutos en el panel; si quieres lo dejo yo.

## 5. Pendiente

- [x] **Publicado** (15/11/2026): migración `20261117090000_ticket_planes_configurables.sql` (probada antes en una transacción que se deshace) y funciones `suscripcion`, `suscripcion-stripe`, `admin-plataforma` y `crecimiento`.
- [ ] Probar con la tarjeta 4242 4242 4242 4242: alta en cada plan, cambio de plan y aviso de Stripe.
- [ ] Facturación **anual** (precio al año con descuento): no está; se puede añadir encima de esto.
- [ ] Pasar las suscripciones en marcha a un precio nuevo: no se hace solo a propósito (hay que avisar al cliente antes).
- [ ] Límite de **mesas por evento**: no lo he puesto porque las mesas se guardan también sin internet y un rechazo dejaría la cola atascada; se puede hacer con un aviso previo en la app.

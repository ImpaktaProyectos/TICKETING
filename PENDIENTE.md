# TIXFAST · Lo que falta (para hacerlo todo de una)

Actualizado: 27/11/2026. Ya está hecho y en producción: base de datos (reserva online, Mis planos,
refuerzos de la auditoría, ficha de bebidas, reservados en el portal) y las funciones `suscripcion`,
`suscripcion-stripe`, `pagos` y `reservas-web`. La app está en `main`.

## 1. Lo haces tú en Supabase (Project Settings › Edge Functions › Secrets)
- [ ] `STRIPE_SECRET_KEY` — empieza por `sk_test_` para probar; `sk_live_` para cobrar de verdad.
      Sin ella no se cobra nada online (adelanto de mesas, entradas ni suscripciones).
- [ ] `SITE_URL` = `https://somostixfast.vercel.app` (o tu dominio final). Lo necesitan los correos automáticos.
- [ ] `CORREO_REMITENTE` — el correo verificado en Brevo desde el que salen los correos.
- [ ] Authentication › Settings: activar **Leaked password protection**.
- [ ] Authentication › URL Configuration: revisar la URL del sitio y las de redirección.

## 2. Después, me dices «lanza lo pendiente» y lo hago yo
- [ ] Publicar `web-enviar-entradas` (ya sin tu correo personal en el código). **Espera a `CORREO_REMITENTE`**: publicarla
      antes dejaría de enviar las entradas por correo.
- [x] `pagos-stripe` publicada desde el repo (27/11). `rrpp-registro` ya era igual que la del repo.
- [ ] Registrar los avisos de Stripe (acción «preparar» de `pagos`) — necesita `STRIPE_SECRET_KEY`.
- [ ] Prueba completa con la tarjeta 4242 4242 4242 4242: alta de suscripción (7 días), compra de
      entradas, reserva de mesa con adelanto desde el portal del evento, y cambio de nivel.
- [ ] Alta de RRPP con confirmación por correo (en vez de confirmada al momento).

## 2b. Planes configurables (ver PLANES_Y_PERMISOS.md)
- [x] Probar la migración `20261117090000_ticket_planes_configurables.sql` en una transacción que se deshace y aplicarla (publicada el 15/11/2026).
- [x] Publicar `suscripcion`, `suscripcion-stripe`, `admin-plataforma` y `crecimiento` (15/11/2026).
- [ ] Configurar los planes en Panel TIXFAST › Planes (estrategia recomendada en PLANES_Y_PERMISOS.md).

## 2c. Multipuesto (ver MULTIPUESTO.md)
- [x] Aplicar `20261118090000_ticket_multipuesto.sql` (después de la de planes) y publicar la app (ruta `/p/`) (15/11/2026).
- [ ] Prueba real: evento Multipuesto, 2 puestos, venta en caja y canje desde dos móviles.

## 2c-bis. Pagos, comisión de TIXFAST y cambio de nombre (27/11/2026) — HECHO salvo lo que necesita la clave de Stripe
- [x] Migraciones aplicadas en Supabase (probadas antes en una transacción que se deshace):
      `20261127090500_ticket_comision_plataforma`, `20261127100000_ticket_pagos_transparentes`, `20261127110000_ticket_cambio_nombre`.
- [x] Funciones publicadas: `pagos` (v4), `pagos-stripe` (v2), `admin-plataforma` (v3).
- [ ] **Publicar la app**: llevar la rama `claude/sweet-franklin-r3fay1` a `main` (sin conflictos: main no tiene nada distinto).
      Hasta entonces, `/cambio`, los gastos por evento y el panel de comisiones no se ven en la web.
- [ ] **Tú:** poner `STRIPE_SECRET_KEY` (`sk_test_…` para probar). Hasta entonces la tarea de `pagos` responde «sin_pasarela».
- [ ] **Después (me lo pides):** lanzar `pagos › preparar` (avisos de Stripe, incluidas devoluciones) y la prueba completa con
      la tarjeta 4242: compra con los tres tipos de gastos, RRPP con y sin monedero, venta en efectivo de RRPP, cambio de nombre
      de pago, reparto con `ahora`, factura en el panel y retirada al banco.
- [ ] **Tú:** Panel TIXFAST › Comisiones: revisar % y mínimo con la calculadora y rellenar los **datos fiscales de TIXFAST**.
- [ ] Más adelante: enviar también la factura de la comisión en PDF por correo (ahora aparece sola en Facturación › Gastos).
- Política: **las entradas no se devuelven** (aviso en la compra); sí se pueden pasar a otra persona en `/cambio` con el precio
  que ponga el organizador. Si aun así hay una devolución desde Stripe (p. ej. un evento cancelado, que la ley obliga a devolver),
  se anulan las entradas y se descuenta al organizador; la comisión de TIXFAST no se devuelve. Revisarlo con la gestoría.

## 2c-ter. Recuperación de entradas perdidas (27/11/2026) — HECHO, falta la clave de Stripe para cobrar
- [x] Migración `20261127120000_ticket_recuperacion_entradas` aplicada (probada antes); `pagos` v5, `pagos-stripe` v3, `admin-plataforma` v4.
- Seguridad: las entradas SOLO se reenvían al correo de la compra (nunca en pantalla ni a otro correo); respuesta siempre igual;
  búsqueda tras pagar; correo + nombre o teléfono; casilla trampa; 6 intentos por IP y hora; 3 solicitudes por correo al día;
  reenvíos por pedido limitados; registro con IP y navegador; datos personales borrados a los 90 días.
- [ ] Probar con la tarjeta 4242 cuando esté `STRIPE_SECRET_KEY` (el reenvío usa `web-enviar-entradas`, como «Enviar a mi correo»).
- [ ] **Gestoría:** el euro es un servicio de TIXFAST a un consumidor: hay que emitirle factura simplificada (ticket). Ahora mismo
      solo queda el recibo de Stripe; decidir si se activa el recibo de Stripe o se añade una factura simplificada automática.
- [ ] Recomendado: que el validador de la puerta pueda buscar una entrada por nombre o DNI (para quien ya no tiene el correo).

## 2d. Rendimiento con mucha gente a la vez (prueba de carga del 18/11/2026, ver supabase/pruebas-carga/)
- [x] **Aplicadas** (comprobado el 27/11/2026: todas sus funciones existen en Supabase):
      1. `20261120090000_ticket_rendimiento.sql` (número de ticket, refresco incremental, tope de 500 unidades)
      2. `20261120100000_ticket_compras_rendimiento.sql` (compra de entradas, IP de Cloudflare)
      3. `20261120110000_ticket_puestos_rendimiento.sql` (panel y liquidación de puestos)
      4. `20261120120000_ticket_avisos_evento.sql` (un aviso en directo por operación)
      5. `20261120130000_ticket_vender_lote.sql` (subida en lotes, tope de tamaño de las copias)
      6. `20261120140000_ticket_escaneo_rendimiento.sql` (escaneo sin recorrer productos)
      Sin las migraciones, la app nueva funciona igual que antes (detecta lo que falta y usa lo de siempre).
- [ ] **Plan de Supabase**: el proyecto está en el plan gratuito. Con ~800 dispositivos no llega:
      máximo 200 conexiones en directo (Realtime), 100 mensajes en directo por segundo, 5 GB de tráfico al mes
      y la máquina más pequeña. Para una noche así: plan Pro y, como mínimo, máquina Small (o Medium para festivales).
- [ ] **Quitar `ticket_ventas` del directo** (`alter publication supabase_realtime drop table public.ticket_ventas`)
      cuando todos los equipos tengan la versión nueva (que escucha ticket_evento_cambios). Hasta entonces se deja
      para las versiones antiguas. Ahorra procesar en el servidor de avisos cada venta de la plataforma.
- [ ] **Datos secretos en el directo**: ticket_eventos se publica con todas sus columnas (clave de los QR y PIN).
      Solo llegan a los equipos del dueño, pero sobran: publicar solo (id, owner_id) con una lista de columnas.
      Probarlo antes en un proyecto de Supabase de pruebas (hay que confirmar que el directo lo admite).
- [ ] **Cola sin conexión en IndexedDB**: el almacenamiento del navegador ronda 5 MB para todo. Ya se libera sitio
      y se avisa si se llena, pero con IndexedDB cabrían cientos de miles de ventas pendientes.
- [ ] **Límite por IP de las compras**: ya usa `cf-connecting-ip` (la de Cloudflare) si llega. Comprobar en una compra
      real (tabla ticket_web_pedidos, columna ip) que se guarda la IP del móvil y no siempre la misma.
- [ ] **Carga al abrir la app**: se siguen descargando las ventas de TODOS los eventos de la cuenta (ya mucho más rápido:
      por tramos y 4 eventos a la vez). Con años de historial, que el CRM y los informes de eventos pasados pidan
      los totales ya calculados al servidor y solo se descarguen las ventas de los eventos activos.
- [ ] **Web pública del evento** (`web_evento_publico`, cada 20 s por visitante): ya cuenta por índice sin leer las
      entradas. Para lanzamientos con decenas de miles de personas mirando, servirla desde una caché de 10-20 s.
- [ ] **Canje por folio** (cuando el QR no se lee): recorre las ventas del evento comparando el texto. Es poco frecuente;
      si se usa mucho, guardar el folio ya normalizado en una columna con índice.
- [ ] **Leaked password protection** en Supabase › Authentication (aviso de seguridad pendiente).
- [ ] **Código**: App.jsx tiene más de 4.000 líneas. Ir separando TPV, informes y cierres en archivos propios
      (sin prisa, cada vez que se toque una parte) para que los cambios sean más seguros.
- [ ] **Protección ante abusos**: las funciones públicas (canje de puestos, compras, reservas) no tienen límite de
      peticiones por segundo. Supabase no lo trae en el plan gratuito; valorar Cloudflare delante o límites por IP.

## 3. Decisiones tuyas
- [ ] ¿Obligamos a cambiar los PIN de fábrica (1234 / 0000) en el primer uso?
- [ ] Planes, precios y permisos (Panel TIXFAST › Planes).
- [ ] Cambiar los emojis por iconos propios en el resto de la app interna (TPV, CRM, panel). Ya está hecho
      en las páginas públicas, la reserva online, la ficha de bebidas, el plano y Reservados.

## 4. Con calma (no urgente)
- [ ] Subir versiones de `jspdf` (arrastra una librería con avisos de seguridad) y probar todos los PDF.
- [ ] Textos legales para el lanzamiento público (privacidad, condiciones de la suscripción).

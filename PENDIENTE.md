# TIXFAST · Lo que falta (para hacerlo todo de una)

Actualizado: 18/11/2026. Ya está hecho y en producción: base de datos (reserva online, Mis planos,
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
- [ ] Publicar `web-enviar-entradas` (ya sin tu correo personal en el código; necesita `CORREO_REMITENTE`).
- [ ] Publicar `rrpp-registro` y `pagos-stripe` desde el repo (mismas versiones que en producción).
- [ ] Registrar los avisos de Stripe (acción «preparar» de `pagos`).
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

## 2c-bis. Comisión de TIXFAST y facturas a los organizadores (27/11/2026)
- [ ] Aplicar `20261127090000_ticket_comision_plataforma.sql` (probada en una transacción que se deshace: comisión 8 % con
      mínimo 0,50 €, gastos por evento, reparto entradas + gastos − comisión, factura TX y copia en Facturación › Gastos).
- [ ] Publicar las funciones `pagos`, `pagos-stripe` y `admin-plataforma`, y después la app.
- [ ] Panel TIXFAST › Comisiones: revisar el % y el mínimo con la calculadora y rellenar los **datos fiscales de TIXFAST**
      (sin ellos las facturas quedan preparadas y salen solas al guardarlos).
- [ ] Prueba con la tarjeta 4242: compra con gastos «recomendado», «elegir importe» y «sin gastos»; reparto con `ahora`;
      comprobar el importe del monedero, la factura en el panel y que el coste real de Stripe aparece en el informe.
- [ ] Que el organizador tenga sus datos fiscales (Facturación › Datos fiscales); si no, su factura espera.
- [ ] Más adelante: enviar también la factura en PDF por correo (ahora le aparece sola en Facturación › Gastos).

## 2c-ter. Pagos transparentes: RRPP, efectivo y devoluciones (27/11/2026)
Estado a 27/11: los monederos **nunca se han usado** (0 RRPP, 0 monederos) y Stripe no está conectado (la tarea de
`pagos` responde «sin_pasarela» cada 10 min). Orden para dejarlo funcionando:
- [ ] Poner `STRIPE_SECRET_KEY` (`sk_test_…`) en Supabase › Edge Functions › Secrets.
- [ ] Aplicar `20261127090000_ticket_comision_plataforma.sql` y después `20261127100000_ticket_pagos_transparentes.sql`
      (probadas juntas en una transacción que se deshace: efectivo, devolución parcial y total, factura y CRM).
- [ ] Publicar `pagos`, `pagos-stripe` y `admin-plataforma`; después la app.
- [ ] Lanzar `pagos › preparar` (da de alta los avisos de Stripe, ahora también las devoluciones `charge.refunded`).
- [ ] Prueba completa con la tarjeta 4242: RRPP con monedero, RRPP sin monedero (se le guarda y le llega al abrirlo),
      venta en efectivo de RRPP, devolución desde el panel de Stripe antes y después del reparto, retirada al banco.
- [ ] Decidir con la gestoría la política de devoluciones: ahora la comisión de TIXFAST no se devuelve y lo devuelto
      se descuenta al organizador. Si se devuelve después de emitir la factura, la factura no cambia (no hay rectificativa automática).

## 2d. Rendimiento con mucha gente a la vez (prueba de carga del 18/11/2026, ver supabase/pruebas-carga/)
- [ ] **Aplicar, por este orden** (probarlas antes en una transacción que se deshace) y después publicar la app:
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

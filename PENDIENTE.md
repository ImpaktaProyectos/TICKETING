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

## 2d. Rendimiento con mucha gente a la vez (prueba de carga del 18/11/2026, ver supabase/pruebas-carga/)
- [ ] **Aplicar, por este orden, `20261120090000_ticket_rendimiento.sql`, `20261120100000_ticket_compras_rendimiento.sql`
      y `20261120110000_ticket_puestos_rendimiento.sql`** (probarlas antes en una transacción que se deshace) y publicar la app.
      Sin las migraciones, la app nueva funciona igual que antes (si falta la columna, vuelve a cargarlo todo).
- [ ] **Plan de Supabase**: el proyecto está en el plan gratuito. Con ~800 dispositivos no llega:
      máximo 200 conexiones en directo (Realtime), 100 mensajes en directo por segundo, 5 GB de tráfico al mes
      y la máquina más pequeña. Para una noche así: plan Pro y, como mínimo, máquina Small (o Medium para festivales).
- [ ] **Avisos en directo de las ventas** (Realtime): cada venta genera un aviso a cada equipo del evento, y una Z
      de una barra con 3.000 ventas genera 3.000 avisos de golpe (uno por venta cerrada). Pasar a «Broadcast» desde
      la base de datos con un disparador por sentencia (un solo aviso por venta o por Z), con canal privado.
      Hay que probarlo en un proyecto de Supabase de pruebas (Realtime no se puede simular en local).
      Mientras tanto, la app ya se pone al día sola cada 20-30 s aunque no le lleguen los avisos.
- [ ] **Límite por IP de las compras**: ya usa `cf-connecting-ip` (la de Cloudflare) si llega. Comprobar en una compra
      real (tabla ticket_web_pedidos, columna ip) que se guarda la IP del móvil y no siempre la misma.
- [ ] **Carga al abrir la app**: se siguen descargando las ventas de TODOS los eventos de la cuenta (ya mucho más rápido:
      por tramos y 4 eventos a la vez). Con años de historial, que el CRM y los informes de eventos pasados pidan
      los totales ya calculados al servidor y solo se descarguen las ventas de los eventos activos.
- [ ] **Web pública del evento** (`web_evento_publico`, cada 20 s por visitante): ya cuenta por índice sin leer las
      entradas. Para lanzamientos con decenas de miles de personas mirando, servirla desde una caché de 10-20 s.
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

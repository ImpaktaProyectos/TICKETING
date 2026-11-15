# TIXFAST · Lo que falta (para hacerlo todo de una)

Actualizado: 15/11/2026. Ya está hecho y en producción: base de datos (reserva online, Mis planos,
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
- [ ] Probar la migración `20261117090000_ticket_planes_configurables.sql` en una transacción que se deshace y aplicarla.
- [ ] Publicar `suscripcion`, `suscripcion-stripe`, `admin-plataforma` y `crecimiento`.
- [ ] Configurar los planes en Panel TIXFAST › Planes (estrategia recomendada en PLANES_Y_PERMISOS.md).

## 3. Decisiones tuyas
- [ ] ¿Obligamos a cambiar los PIN de fábrica (1234 / 0000) en el primer uso?
- [ ] Planes, precios y permisos (Panel TIXFAST › Planes).
- [ ] Cambiar los emojis por iconos propios en el resto de la app interna (TPV, CRM, panel). Ya está hecho
      en las páginas públicas, la reserva online, la ficha de bebidas, el plano y Reservados.

## 4. Con calma (no urgente)
- [ ] Subir versiones de `jspdf` (arrastra una librería con avisos de seguridad) y probar todos los PDF.
- [ ] Textos legales para el lanzamiento público (privacidad, condiciones de la suscripción).

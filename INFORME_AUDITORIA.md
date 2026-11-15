# TIXFAST · Informe de la auditoría (15/11/2026)

## Resumen en 10 líneas
La aplicación está en muy buen estado para convertirse en un SaaS. El aislamiento entre cuentas es sólido: lo atacamos con dos cuentas y con visitantes anónimos contra todas las tablas y funciones, y nadie pudo leer, tocar ni borrar nada ajeno, ni regalarse un plan. Lo más grave encontrado fue de orden: tres funciones de pago existían solo en producción (sin copia en el repositorio), tu correo personal estaba escrito en el código publicado del envío de entradas, y las vueltas de Stripe aceptaban dominios de cualquiera. Todo eso ya está arreglado en la rama. En el móvil, 19 pantallas probadas en 5 tamaños: ni un desborde ni un error; se subieron todos los botones a 44 px. La imagen es profesional; queda tu visto bueno para cambiar los ~500 emojis por los iconos nuevos (piloto hecho en Reservados). Para lanzar faltan tus 4 pasos en Supabase y publicar lo pendiente.

## Hallazgos y su estado

### ALTO (los tres, arreglados en la rama)
| # | Qué pasaba | Riesgo | Estado |
|---|---|---|---|
| 1 | `pagos`, `pagos-stripe` y `rrpp-registro` solo existían en producción, sin copia en el repositorio | Publicar desde el repo las borraría; sin control de cambios del dinero | ✅ Recuperadas y guardadas en el repo |
| 2 | Tu correo personal escrito en el código publicado de `web-enviar-entradas` (remitente si falta `CORREO_REMITENTE`) | Dato personal expuesto en cada correo a clientes | ✅ Quitado en el repo · ⏳ falta publicar la función |
| 3 | Stripe podía volver a cualquier web `*.vercel.app` o que contuviera «tixfast» (en `pagos`, `suscripcion`, `reservas-web` y los enlaces del correo de entradas) | Un estafador podría llevar al cliente a su propia web tras un pago real | ✅ Solo dominios propios (somostixfast.vercel.app, tixfast.app y `SITE_URL`) · ⏳ falta publicar |

### MEDIO
| # | Qué pasaba | Estado |
|---|---|---|
| 4 | El alta de RRPP confirma el correo sin verificarlo: cualquiera puede registrarse con el correo de otra persona | ⏳ Decisión: cuando `CORREO_REMITENTE` esté confirmado, pasamos a verificación por correo |
| 5 | El bucket público de logos aceptaba cualquier archivo de cualquier tamaño | ✅ Migración lista: solo imágenes hasta 2 MB (pendiente de aplicar) |
| 6 | `pagos` devolvía el mensaje de error interno de Stripe al navegador | ✅ Ahora queda en `ticket_errores`; al navegador solo va el motivo |
| 7 | Dependencias: `jspdf` arrastra una librería con fallos de seguridad; `pdfjs-dist` otra (solo al compilar, no llega al navegador); `vite` una menor (solo en desarrollo) | ⏳ Planificar subida de versiones con calma: `jspdf` 2→4 cambia cosas y hay que reprobar todos los PDF |
| 8 | Contraseñas filtradas sin comprobar en el login | 🔴 Lo activas tú en Supabase (1 minuto) |

### BAJO (arreglado o anotado)
- ✅ 7 claves foráneas sin índice y 2 índices duplicados → en la migración nueva.
- ✅ Botones por debajo de 44 px en 9 pantallas → todos subidos; mesas del plano con zona táctil invisible ampliada (y zoom).
- ⏳ Los PIN de fábrica (1234/0000) no obligan a cambiarse → decisión tuya.
- ⏳ Política doble en perfiles RRPP (solo rendimiento) → se tocará con calma, no es urgente.
- ℹ️ 9 errores del robot de correos esta semana: le falta `SITE_URL`.

### Lo que salió BIEN (comprobado, no supuesto)
- RLS activo en **todas** las tablas; los visitantes anónimos no leen ni escriben **nada**.
- Ataque real con 2 cuentas: cero lecturas cruzadas, cero escrituras, suplantación de dueño bloqueada, nadie se cambia el plan ni alarga su prueba, funciones de admin denegadas a todos.
- Todas las funciones del servidor con `search_path` protegido; webhooks de Stripe con firma verificada en tiempo constante; precios calculados siempre en el servidor; PIN guardados con huella (PBKDF2, 210.000 vueltas), nunca en claro; cierre de sesión limpia la copia local.
- Cabeceras de seguridad en Vercel (CSP estricta, sin marcos, HSTS). Sin `innerHTML` peligroso en el código.
- Storage: facturas privadas por carpeta del dueño; subidas solo a tu propia carpeta.

## Pruebas en el móvil (Fase 6)
19 pantallas × 5 tamaños (iPhone SE 375, iPhone 390, Pro Max 430, iPad 820, PC 1440) = **95 combinaciones**:
- Desbordes horizontales: **0** · Errores de consola: **0** · Pantallas que no cargan: **0**.
- Botones < 44 px: había en 9 pantallas → **todos corregidos** y vuelto a pasar el barrido.
- Interacciones comprobadas tras los cambios: tocar mesa del plano, arrastrar en el editor, deshacer, guardar.

## Revisión visual (Fase 5)
- La app es coherente: mismos colores de marca, tarjetas y jerarquía en TPV, CRM, admin y suscripción.
- **Iconos**: el TPV y el CRM ya tenían iconos SVG propios (39 + 31). Se ha creado un módulo único `src/iconos.jsx` y un **piloto en Reservados VIP** (capturas enviadas). Los emojis de contenido se quedan: el de cada tarifa/producto (lo elige el organizador) y los mensajes de WhatsApp al cliente.
- **Pendiente de tu visto bueno**: extender los iconos al resto de la app (unas 450 sustituciones, por fases, pantalla a pantalla con capturas) y añadir al test de estilo la prohibición de emojis nuevos en la interfaz.

## Lo que tienes que hacer tú (en orden)
1. **Supabase › Authentication › Settings**: activar «Leaked password protection». *(1 min)*
2. **Supabase › Edge Functions › Secrets**: crear `STRIPE_SECRET_KEY` (empieza por `sk_test_` para probar), `SITE_URL` (`https://somostixfast.vercel.app`) y confirmar `CORREO_REMITENTE`. *(5 min)*
3. Decirme **«lanza»**: aplico las 3 migraciones pendientes (reserva online, Mis planos, refuerzos) y publico las 6 funciones con los arreglos.
4. Después yo registro los avisos de Stripe y hacemos **una compra y un alta de prueba** con la tarjeta 4242 4242 4242 4242.
5. Dos decisiones: ¿obligamos a cambiar los PIN 1234/0000 en el primer uso? ¿Doy el visto bueno a los iconos en toda la app?

## Pendiente de auditar cuando haya claves
- El ciclo completo de pagos con dinero de prueba (alta, impago, pausa, cambio de nivel, reserva con adelanto, reparto a monederos): está revisado **en código**, no ejecutado de verdad.
- Textos legales (RGPD, condiciones de la suscripción): recomendado encargarlos antes del lanzamiento público; la app ya tiene base (aviso de privacidad en la reserva web, bajas de correos con token, borrado de clientes).

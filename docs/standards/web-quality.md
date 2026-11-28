# TIXFAST · Estándares de calidad web (permanentes)

Se aplican a **toda página, componente, formulario, integración o función nueva**. Antes de terminar, repasa qué apartados le afectan.
Tipo de proyecto: **SaaS transaccional (ticketera + TPV + CRM) multi-organizador**. El organizador es responsable de sus datos; TIXFAST es encargado.

## 1. Legal y privacidad (RGPD, LOPDGDD, LSSI-CE)
- Textos legales de la plataforma en `public/legal.html` (aviso legal, privacidad, cookies, uso, compra, devoluciones). Enlazados desde el pie de las webs públicas y desde «Más información» de privacidad en cada formulario de compra.
- En cada formulario que recoja datos: primera capa informativa (`InfoPrivacidad`), casilla de marketing **opcional y desmarcada**, versión del texto (`PRIVACIDAD_VERSION`) guardada con el consentimiento. Si cambia el texto, subir la versión.
- **Cookies**: hoy solo hay almacenamiento técnico (sesión, carrito, contador de visitas anónimo) → no hace falta banner. **Si se añade analítica, píxel o publicidad**: banner con Aceptar / Rechazar / Configurar al mismo nivel, nada se carga antes de aceptar, opción de retirar el consentimiento y registro de la elección. Actualizar la tabla de cookies.
- Cada proveedor nuevo que trate datos personales se añade a la tabla de proveedores de `legal.html`.
- Nunca inventar datos fiscales, societarios ni condiciones: dejarlos marcados como pendientes.

## 2. Seguridad
- RLS en **todas** las tablas; nada legible por anónimos salvo funciones `security definer` con `search_path` fijo. Probar con dos cuentas que no se cruzan datos.
- Precios, descuentos y comisiones se calculan **solo en el servidor**. Webhooks de Stripe con firma verificada e idempotentes (no duplicar compras).
- Cabeceras en `ticketera-app/vercel.json` (CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy). Un dominio externo nuevo → añadirlo a la CSP, nunca `unsafe-eval` ni `*`.
- Funciones públicas (formularios, códigos, recuperación de entradas): límite de intentos en el servidor.
- Sin claves secretas en el cliente (solo la publicable de Supabase). Errores internos a `ticket_errores`, al usuario solo un mensaje claro.
- Sin `dangerouslySetInnerHTML` con datos de usuario. Redirecciones de pago solo a dominios propios.

## 3. SEO (solo páginas públicas)
- Indexables: `/e/<evento>`, `/o/<organizador>`, `/legal.html` y la portada. **Nunca**: compras, entradas, RRPP, puntos de venta, cambio de nombre, TPV/CRM (`robots.txt` + `X-Robots-Tag` + meta `noindex` en `Publico.jsx`). Una ruta privada nueva → añadirla a los tres.
- Cada página pública: `document.title` y descripción propios, un solo `h1`, imágenes con `alt`.
- Pendiente: generar `sitemap.xml` dinámico con los eventos publicados, Open Graph por evento (cartel) y JSON-LD `Event` / `Organization` servidos en el HTML (los robots de WhatsApp no ejecutan JavaScript).

## 4. Rendimiento (objetivo móvil: LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1)
- La web pública (`publico.html`) no importa nada del TPV ni del CRM. Pantallas pesadas con `React.lazy`.
- Imágenes con `width`/`height` (sin saltos), `loading="lazy"` salvo la principal, y comprimidas al subirlas (`imagenes.js`).
- Vigilar el tamaño de los paquetes en `vite build`; no añadir dependencias si se puede hacer con lo que hay.

## 5. Accesibilidad (WCAG 2.2 AA) y móvil
- Botones ≥ 44 px, foco visible, contraste AA, `aria-label` en botones solo con icono, etiquetas en campos, errores en texto (no solo color).
- Ventanas dentro de `<Capa>` con `role="dialog"`, se cierran con Escape y con botón visible.
- Respetar `prefers-reduced-motion`. Probar a 375 px con viewport: sin scroll horizontal, botón principal visible, áreas seguras (`env(safe-area-inset-*)`).

## 6. UX y conversión
- Una acción principal por pantalla. Precio final desglosado antes de pagar. Estados de carga, éxito y error siempre visibles.
- Sin urgencia falsa: contadores y «quedan X» solo con datos reales. Textos en español de España, sin jerga.
- WhatsApp solo donde el organizador lo configure; que no tape el botón de compra.

## 7. Analítica
- Hoy: contador propio de visitas (`ticket_web_visitas`), sin datos personales. Cualquier herramienta externa (GA4, Meta Pixel) requiere banner de cookies previo, identificadores reales del organizador y **nunca** enviar correo, nombre o datos de pago.

## 8. Errores y navegación
- Rutas inexistentes → `public/404.html` (código 404) o mensaje «Página no encontrada» con salida al inicio. Nada de pantallas en blanco: `ErrorBoundary` en cada entrada.

## 9. Código
- Cambios pequeños y reversibles; sin refactorizaciones masivas sin motivo. Lógica de cálculo en módulos puros con su `*.test.mjs` añadido a `npm test`.
- Migraciones nuevas, nunca destructivas, probadas en una transacción que se deshace.

## Checklist antes de publicar en producción
- [ ] `npm test` y `npx vite build` sin errores (también lo comprueba `.github/workflows/calidad.yml`).
- [ ] `APP_VERSION` subida.
- [ ] Probado a 375 px y 1440 px: sin desbordes, sin errores de consola.
- [ ] Rutas nuevas: ¿privadas? → `noindex` en los tres sitios. ¿Públicas? → título, descripción, `h1`.
- [ ] Datos personales nuevos → texto de privacidad, versión y tabla de proveedores al día.
- [ ] Dominio externo nuevo → CSP actualizada.
- [ ] Funciones/tablas nuevas → RLS y prueba con dos cuentas.
- [ ] Pagos → idempotencia y precio calculado en servidor.

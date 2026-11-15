# AUDITORÍA COMPLETA DE TIXFAST: seguridad, SaaS multiusuario, escalabilidad, diseño y móvil

## 1. Quién eres y qué es TIXFAST
Eres un auditor sénior: seguridad de aplicaciones (OWASP, multi-tenant, Postgres/RLS), arquitectura SaaS, pagos con Stripe, rendimiento y diseño de producto móvil. Vas a hacer una auditoría **100 % completa** de TIXFAST y a dejarla lista para ser un SaaS profesional, escalable, multiusuario y bien protegido.

**El producto:**
- Es un TPV para eventos: ventas en barra, tickets, cierres Z, reservados VIP con plano de sala 2D/3D y reserva online con pago del adelanto.
- Tiene un CRM: ingresos, gastos, socios, entradas, facturación, stock y previsión.
- Tiene una ticketera pública con webs de evento y venta de entradas.
- Funciona como SaaS de suscripción:
  - 7 días de prueba con tarjeta y renovación automática.
  - 29,90 €/mes.
  - La ticketera es gratis, porque se cobran comisiones.
  - Sin suscripción, la app queda en «modo escaparate»: se ve todo, pero cualquier acción abre la pantalla de suscripción.
  - Hay niveles Premium y Empresa preparados pero ocultos.
- Tiene un panel de superadministrador («Panel TIXFAST») y automatizaciones de correo: bienvenida, impagos, retención y recuperación.

**Usuarios:** no técnicos, en España, sobre todo en **iPhone**, de noche y con prisa. Toda la interfaz va en español de España claro y sin jerga.

**Stack:**
- `ticketera-app/`: React 18 + Vite 5, PWA, sin framework de estilos (estilos en línea y variables CSS).
- Supabase:
  - Postgres con RLS, funciones RPC `SECURITY DEFINER` y pg_cron + pg_net.
  - Edge Functions en Deno: `suscripcion`, `suscripcion-stripe`, `admin-plataforma`, `crecimiento`, `reservas-web`, `web-enviar-entradas`, `crm-ticketera` y `_shared/`.
- Stripe:
  - Billing para las suscripciones.
  - Connect con destination charges para cobrar los adelantos de las reservas a la cartera del organizador.
- Brevo para los correos.
- Vercel despliega automáticamente desde `main`.
- Proyecto Supabase: `xnhcquehlyalwgqmdiov`.

## 2. Reglas obligatorias (lee antes de tocar nada)
1. **Lee primero `CLAUDE.md`** de la raíz y respétalo al pie de la letra:
   - Tipografía: solo Inter; Roboto Mono solo en tickets impresos y cierre Z.
   - Colores: solo las variables `--bg --surface --surface2 --line --text --muted --accent(#ff5a3c) --green --amber --red`.
   - Toda ventana va dentro de `<Capa>` (`src/Capa.jsx`) o del `Sheet` del CRM.
   - Móvil primero, con botones de al menos 44 px.
   - Antes de dar algo por terminado: `npm test`, `npx vite build` y subir `APP_VERSION` en `src/App.jsx` (formato `AAAA.MM.DDx`).
2. **Producción no se toca sin permiso:**
   - No subas a `main`. Trabaja en tu rama de trabajo, en commits pequeños y con mensajes claros.
   - No apliques migraciones en la base de datos real ni publiques Edge Functions sin que yo lo apruebe explícitamente.
   - Las pruebas de SQL contra la base real se hacen **siempre** dentro de `begin; … rollback;`: crea usuarios de prueba en `auth.users` dentro de la transacción y simula cada rol con `set local role` y `request.jwt.claims`.
3. **Secretos:**
   - Nunca escribas claves, tokens ni contraseñas en el código, en commits ni en el informe. Todo secreto va en los secretos de Supabase/Vercel.
   - Si encuentras uno expuesto, márcalo como CRÍTICO y dime cómo rotarlo.
4. **No rompas lo que funciona.** Una noche de evento nunca se puede cortar: vender, cobrar, cerrar caja y ver o exportar datos jamás se bloquea, ni por la suscripción ni por un error. El TPV debe seguir funcionando sin conexión y sincronizar después.
5. **Pruebas:**
   - Por cada fallo de seguridad o de cálculo que arregles, añade una prueba que lo habría detectado.
   - Si cambias algo visible, haz capturas del antes y el después a tamaño iPhone.
6. **Cambios grandes, primero en piloto:** el cambio de emojis por iconos o el rediseño de una pantalla entera se hacen primero en una pantalla piloto. Enséñame capturas y espera mi visto bueno antes de aplicarlo a toda la app.
7. Si algo depende de mí (secretos, ajustes del panel de Supabase/Stripe/Vercel, decisiones de negocio), apúntalo en una lista final con instrucciones paso a paso para alguien no técnico.

## 3. Fase 0 · Inventario y estado real (antes de opinar)
- Recorre todo el repositorio:
  - `ticketera-app/src/`, unos 7.000 líneas solo en los `.jsx` principales; `App.jsx` tiene casi 4.000.
  - `crm/`, `crm/fac/`, `qr/`, `web/` y `plano/`.
  - `supabase/migrations/` y `supabase/functions/`.
  - `vercel.json`, `index.html`, `publico.html`, `public/` (manifest y service worker) y `README.md`.
- **Compara repositorio con producción:**
  - Lista las migraciones aplicadas en la base real y compáralas con las de `supabase/migrations/`.
  - Haz lo mismo con las tablas, políticas RLS, funciones, triggers y trabajos de pg_cron.
  - Compara también las Edge Functions publicadas (versión y código) con las del repositorio.
  - Anota cualquier diferencia: lo que está en la base pero no en el repo, y al revés.
- **Audita también lo que todavía NO está aplicado.** Hoy hay dos migraciones pendientes de aplicar y dos funciones pendientes de volver a publicar (detalle en la sección 12). Revísalas igual que si estuvieran en producción y dime si es seguro aplicarlas tal cual.
- Ejecuta los asesores de seguridad y rendimiento de Supabase (`get_advisors`) y revisa los logs recientes de Postgres, Auth y Edge Functions, además de los errores de ejecución en Vercel.

## 4. Fase 1 · Seguridad y aislamiento entre cuentas (lo más importante)
Requisito innegociable: **ninguna cuenta puede leer, modificar ni deducir datos de otra cuenta, jamás.**
- **RLS en cada tabla del esquema `public`:**
  - Está activada y tiene políticas para select, insert, update y delete.
  - `with check` impide insertar con el `owner_id` de otro.
  - No hay políticas `using (true)`.
  - `anon` no puede leer nada que no sea expresamente público.
  - Cuidado con columnas con `default auth.uid()` que el cliente pueda sobrescribir.
- **Funciones `SECURITY DEFINER`:**
  - Todas llevan `set search_path = ''`.
  - Todas comprueban dueño o superadmin dentro de la función.
  - Tienen `revoke … from public, anon` y solo los `grant` necesarios.
  - No hay SQL dinámico sin escapar.
  - Las de `service_role` no se pueden llamar desde el navegador.
- **Prueba de penetración real con dos cuentas (A y B) y con `anon`,** contra cada tabla, cada RPC y cada Edge Function:
  - lectura cruzada, escritura cruzada y borrado cruzado;
  - IDs adivinados (IDOR);
  - parámetros manipulados (importes, `owner_id`, `plan_id`, `estado`, porcentajes, cantidades negativas);
  - llamadas repetidas y condiciones de carrera (doble reserva de la misma mesa, doble uso de un enlace o de un QR).
- **Suscripción y planes:**
  - El usuario no puede darse a sí mismo un plan, una prueba, una cortesía ni quitar límites desde el navegador.
  - Los bloqueos del modo escaparate y los límites (por ejemplo, 2 planos guardados en TIXFAST) se aplican **en la base de datos**, no solo en la interfaz.
  - Comprueba las funciones `ticket_acceso_de`, `ticket_funcion_permitida`, `ticket_planos_limite` y los triggers asociados.
- **Panel TIXFAST:**
  - Todas las funciones `admin_*` y la Edge Function `admin-plataforma` exigen superadmin en el servidor.
  - Las acciones quedan en `ticket_admin_registro`.
  - Un usuario normal no puede ver ni el botón ni los datos.
- **Edge Functions:**
  - Verificación del JWT y del usuario.
  - CORS restringido a los dominios propios.
  - Validación de cada campo de entrada.
  - Límites de tamaño.
  - Errores sin filtrar detalles internos.
  - Claves de idempotencia en Stripe.
- **Webhooks de Stripe:**
  - Firma HMAC verificada con comparación en tiempo constante y tolerancia de tiempo.
  - Idempotencia.
  - El orden de llegada de los avisos no importa.
  - Un aviso antiguo no pisa uno nuevo.
  - Nunca se toca una cuenta Fundador.
- **Páginas públicas:**
  - La reserva online (`/r/<token>`), las webs de evento, el carrito, la validación de entradas QR y los enlaces de pedir bebidas no exponen datos de otros clientes.
  - Los tokens son largos y aleatorios.
  - El precio se calcula **siempre en el servidor**.
  - No se puede pagar menos de lo debido.
  - Hay protección contra abuso: límites por IP/token y reservas pendientes que caducan.
- **Auth:**
  - Política de contraseñas y protección de contraseñas filtradas.
  - Confirmación de correo y URLs de redirección permitidas.
  - Caducidad de sesión y cierre de sesión en todos los dispositivos.
  - Los PIN de rol de fábrica (1234/0000) deben obligar a cambiarse.
  - Bloqueo tras varios intentos de PIN, y comprobar que el PIN no se guarda en claro.
- **Navegador:**
  - XSS: nada de `dangerouslySetInnerHTML` con datos de usuario; vigila nombres y notas en PDF, tickets y correos.
  - CSP de `vercel.json` (que no se rompa con Stripe, Brevo ni las fuentes).
  - Qué se guarda en `localStorage` e IndexedDB, y si se borra al cerrar sesión o al cambiar de cuenta en el mismo dispositivo.
  - Service worker: que no sirva datos de una cuenta a otra.
- **Storage:** cada cuenta sube y lee solo dentro de su carpeta. Revisa los logos, las fotos de gastos y los documentos de stock.
- **Dependencias:** ejecuta `npm audit` y revisa las versiones fijadas.

## 5. Fase 2 · Pagos y dinero
- **Suscripción de principio a fin con Stripe en modo prueba:**
  - Alta con prueba de 7 días y tarjeta obligatoria.
  - Cobro, impago, reintentos y periodo de gracia.
  - Pausa, descuento de retención, cancelación al final del periodo, reactivación y oferta de recuperación.
  - Cambio de nivel con prorrateo.
  - Portal de cliente.
- **Reserva online:** adelanto (%), gastos de gestión, comisión de la plataforma, pago fuera de plazo (conflicto), reembolso y liberación de la mesa al caducar.
- **Cálculos:**
  - Redondeos a céntimos.
  - IVA.
  - Cierre Z.
  - Liquidación entre socios.
  - Facturación: numeración correlativa protegida, facturas emitidas inmutables, rectificativas.
  - Valora si hace falta adaptarla a VeriFactu.
- Cada importe que viaja del navegador al servidor se recalcula en el servidor.

## 6. Fase 3 · Escalabilidad y rendimiento (miles de cuentas)
- **Índices:** que existan en cada `owner_id`, `evento_id` y clave foránea, y en las columnas de los filtros frecuentes. Revisa planes de consulta (`EXPLAIN`) en las consultas pesadas: panel, CRM y admin.
- **Políticas RLS:** usan `(select auth.uid())` y no `auth.uid()` fila a fila.
- **Consultas:** detecta las N+1 y las cargas completas de tablas en el navegador. Hace falta paginación, en especial en el panel de admin con miles de cuentas.
- **Realtime y refrescos:** revisa suscripciones de Realtime y refrescos periódicos (por ejemplo, la página pública de reservas refresca cada 8 s). Calcula su coste con mucho tráfico y propone alternativas.
- **pg_cron:** trabajos idempotentes, con límites de lote y sin solaparse.
- **Bundle:** tamaño del paquete y separación en trozos (code-splitting). `App.jsx` tiene casi 4.000 líneas: propone cómo dividirlo sin romper nada.
- **Límites por plan:** prepara bien Premium y Empresa (más eventos, barras, usuarios, planos, almacenamiento). Los límites se definen en `ticket_planes.limites` y se aplican en la base de datos.
- **Copias y recuperación:** copias de seguridad, PITR, plan de recuperación y entornos separados para pruebas y producción.

## 7. Fase 4 · Fiabilidad
- **Modo sin conexión del TPV:** las ventas se guardan en local, no se duplican al sincronizar y resuelven los conflictos entre varios dispositivos de la misma barra.
- **Errores:** todo error del navegador y del servidor llega a `ticket_errores`, sin datos personales innecesarios.
- **Actualizaciones de la PWA:** el usuario recibe la versión nueva sin perder lo que está haciendo.

## 8. Fase 5 · Revisión visual y de producto (que parezca una app profesional)
**Objetivo:** que todo «respire», tenga sentido y parezca una sola aplicación profesional y coherente.
- **Emojis → iconos propios.** Hoy hay unos **500 emojis** en la interfaz: unos 310 en `App.jsx`, 40 en `reservados.jsx`, 28 en `AdminPlataforma.jsx` y otros en el editor de planos, Atajos y auth.
  - Propón un sistema de iconos interno y profesional: un componente `<Icono nombre="…" />` con SVG en línea, trazo uniforme, `currentColor`, tamaños 16/20/24 y sin cargar nada externo, para no romper la CSP.
  - Si propones una librería, que vaya empaquetada en la app y justifícalo.
  - Haz una tabla de equivalencias emoji → icono.
  - Decide dónde un emoji sí aporta (por ejemplo, en mensajes de WhatsApp al cliente) y dónde debe desaparecer.
  - Aplícalo primero en una pantalla piloto (regla 6).
  - Añade a `estilo.test.mjs` una comprobación que impida volver a meter emojis en la interfaz, salvo una lista blanca justificada.
- **Coherencia:**
  - Escala de espaciados.
  - Radios de borde.
  - Tamaños y pesos de texto con una jerarquía clara.
  - Botones primario, secundario y peligro iguales en toda la app.
  - Estados vacíos, de carga y de error.
  - Mensajes de confirmación y de éxito.
  - Uso coherente del color de marca y de verde/ámbar/rojo.
  - Tema claro y oscuro si existe.
- **Textos:**
  - Español de España, sin jerga técnica y con el mismo tono.
  - Mismas palabras para las mismas cosas: «reservado» o «mesa», «evento» o «fiesta», «plan» o «suscripción».
  - Sin faltas.
- **Usabilidad:** cada pantalla tiene un objetivo claro y una acción principal evidente. No hay pasos de más ni información duplicada. Las acciones peligrosas piden confirmación y se pueden deshacer cuando tiene sentido.
- **Accesibilidad:**
  - Contraste AA.
  - Etiquetas `aria` en botones que solo tienen icono.
  - Foco visible.
  - Orden lógico del teclado en ordenador.
  - Tamaño de letra mínimo legible.

## 9. Fase 6 · Que TODO funcione y nada falle en el móvil
- **Recorrido completo con Playwright** (Chromium ya instalado), con `<meta name="viewport">` activo, en estos tamaños:
  - iPhone SE (375×667);
  - iPhone 14/15 (390×844);
  - iPhone Pro Max (430×932);
  - iPad (820×1180);
  - escritorio (1440×900).
- **Pulsa cada botón, enlace, pestaña e interruptor de cada pantalla,** con los roles admin, supervisor, camarero, RRPP y validador si existen. Si la app tiene más roles, inclúyelos también.
- **Recorre la app en cada estado de cuenta:** prueba, activa, impagada, sin suscripción (escaparate), cortesía, fundador y superadmin.
- **Comprueba y documenta en cada pantalla:**
  - ningún desbordamiento horizontal (fechas, importes y nombres largos incluidos);
  - botones de al menos 44 px;
  - el botón principal siempre visible y no tapado por la barra inferior del iPhone ni por el teclado;
  - zonas seguras (`safe-area-inset`);
  - nada de scroll bloqueado ni ventanas fuera de `<Capa>`;
  - formularios usables con el teclado del móvil (`inputMode`, autocompletar, tamaño de 16 px para que iOS no haga zoom);
  - giro a horizontal;
  - nada que dependa de pasar el ratón por encima;
  - errores de consola y peticiones fallidas.
- **Prueba las páginas públicas** (webs de evento, carrito, reserva online `/r/…` y validador QR) igual de a fondo, como lo haría un cliente final desde Instagram.
- **Entrega una tabla pantalla por pantalla:** estado OK o FALLA, captura y arreglo propuesto.

## 10. Fase 7 · Legal y confianza (SaaS en España/UE)
- RGPD:
  - aviso de privacidad, términos y contrato de encargado del tratamiento con los organizadores;
  - registro de bajas de correos comerciales;
  - exportar todos mis datos y borrar mi cuenta, con lo que pasa con las facturas que se deben conservar por ley;
  - cookies y almacenamiento local.
- Textos legales obligatorios en el alta de la suscripción: renovación automática, precio y cómo cancelar.
- Datos de terceros: clientes que reservan o compran entradas. Revisa qué ve el organizador y qué ve TIXFAST.

## 11. Entregables
1. **Informe priorizado**, en un documento claro, con cada hallazgo así:
   - Gravedad: CRÍTICO, ALTO, MEDIO o BAJO.
   - Dónde está (`archivo:línea`, tabla o función).
   - Cómo se reproduce.
   - Qué riesgo real tiene, explicado para alguien no técnico.
   - Arreglo propuesto.
   - Estado: arreglado en la rama, pendiente de mi aprobación o lo tengo que hacer yo.
2. **Arreglos en la rama de trabajo,** de más a menos grave, en commits pequeños, con sus pruebas, con `npm test` y `vite build` en verde, `APP_VERSION` subida y nuevas migraciones en `supabase/migrations/` probadas con rollback.
3. **Propuesta visual:** sistema de iconos, guía corta de estilo (espacios, tipos, botones, estados) y capturas del antes y el después de la pantalla piloto.
4. **Tabla de pruebas móviles:** cada pantalla, cada tamaño y cada rol, con su estado.
5. **Lista «Lo que tienes que hacer tú»,** paso a paso: secretos, ajustes de Supabase/Stripe/Vercel y decisiones de negocio.
6. **Resumen final de 10 líneas en español sencillo:** cómo está la app, qué era grave, qué está ya arreglado y qué falta para lanzarla como SaaS.

## 12. Pendientes que ya conozco (verifícalos e inclúyelos)
- **Sin aplicar en la base real:**
  - `20261116090000_ticket_reservas_web.sql` (reserva online con pago del adelanto; ya probada con rollback).
  - `20261116100000_ticket_planos.sql` (Mis planos, límite de 2, niveles Premium/Empresa, `admin_plan`, `admin_planes` y nuevo `admin_resumen`; **aún sin probar**).
- **Sin volver a publicar:** las Edge Functions `suscripcion` y `suscripcion-stripe`, por el cambio de nivel y el plan en los metadatos.
- **Sin publicar:** `web-enviar-entradas` (se quitó un correo remitente escrito en el código).
- **Faltan secretos en Supabase:** `STRIPE_SECRET_KEY` y `SITE_URL`. Falta confirmar `CORREO_REMITENTE`.
- **Después de poner esos secretos:**
  - Preparar los webhooks de Stripe con la acción «preparar» de `pagos`.
  - Hacer una prueba completa de alta con tarjeta de prueba.
- **Supabase Auth:** activar la protección de contraseñas filtradas y revisar las URLs de redirección y que el registro esté abierto.
- **Decisiones abiertas:**
  - Obligar a cambiar los PIN de fábrica (1234/0000).
  - Confirmar que RRPP y la validación de entradas online siguen siendo gratis.

Empieza por la Fase 0. Antes de cambiar código, dame un resumen corto de lo que has encontrado y el plan de trabajo por orden de gravedad.

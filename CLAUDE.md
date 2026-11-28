# TIXFAST · reglas del proyecto

App de TPV para eventos (ventas, tickets, cierres Z, reservados VIP) con CRM (ingresos, gastos, socios, entradas, facturación).
Código en `ticketera-app/` (React + Vite, sin framework de estilos: estilos en línea y bloques CSS). Base de datos: Supabase (`supabase/migrations/`).
Todo en español de España, para usuarios no técnicos: textos claros, sin jerga.

## Diseño: que siempre parezca la misma aplicación
- **Tipografía**: solo **Inter** en toda la interfaz. **Roboto Mono** solo en tickets impresos y en el cierre Z. Nunca otra.
  Las webs públicas de cada evento (`src/web/`) tienen su propio diseño elegido por el organizador.
- **Colores**: los de la app, por variables: `--bg`, `--surface`, `--surface2`, `--line`, `--text`, `--muted`, `--accent` (naranja de marca #ff5a3c),
  `--green`, `--amber`, `--red`. No inventar tonos nuevos; si hace falta otro, reutilizar uno que ya use el TPV o el CRM.
- **Ventanas** (hojas, avisos, confirmaciones, vistas previas, pantallas sobre la app): SIEMPRE dentro de `<Capa>` (`src/Capa.jsx`)
  o del `Sheet` del CRM (que ya la usa). La capa les da la tipografía y los colores de la app y evita que en el iPhone las tape
  la barra de abajo o se quede enganchado el scroll. Nunca un `position: fixed` suelto dentro de una zona con scroll.
- **Móvil primero**: la mayoría se usa en iPhone. Botones de al menos 44 px, nada que se salga del ancho (fechas incluidas),
  el botón principal siempre visible, y probar a tamaño de iPhone **con** `<meta name="viewport">` antes de dar algo por terminado.

## Antes de dar un cambio por terminado
- `npm test` (dentro de `ticketera-app/`): incluye `src/estilo.test.mjs`, que falla si aparece otra tipografía o una ventana fuera de `<Capa>`.
- `npx vite build` sin errores.
- Subir `APP_VERSION` en `src/App.jsx` (formato `AAAA.MM.DDx`).
- Cambios de base de datos: migración nueva en `supabase/migrations/` y probarla con una transacción que se deshace antes de publicar.
- No subir a `main` sin que el usuario lo pida.

## Estándares de calidad (legal, seguridad, SEO, rendimiento, accesibilidad)
- Están en `docs/standards/web-quality.md`, con la **checklist antes de publicar**. Repasar qué apartados afectan a cada página, formulario, ruta o integración nueva.
- Rutas privadas (compras, entradas, paneles): siempre `noindex`. Proveedor o dato personal nuevo: actualizar `public/legal.html`.
- Analítica o píxeles de terceros: solo tras banner de consentimiento (hoy no hay ninguno, por eso no hay banner).
- CI: `.github/workflows/calidad.yml` pasa pruebas y compilación en cada subida.

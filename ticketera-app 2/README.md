# 🎟️ TICKETERA

POS táctil para vender entradas y productos en festivales. Multi-barra, en tiempo real, offline-first, con impresión térmica. React + Vite + Supabase.

---

## 1. Qué es y cómo funciona la seguridad

Hay **dos capas**:

1. **Sesión (login de Supabase)** = la seguridad de verdad. El dispositivo inicia sesión con la cuenta del operador. Sin sesión no se ve ni se escribe nada (lo protege la base de datos por usuario).
2. **Rol (admin / supervisor / cajero)** con PIN = control operativo del día a día sobre una tablet ya logueada. El PIN solo evita que un cajero abra la configuración; no es la seguridad real.

---

## 2. Subirlo a internet (igual que hiciste con DUALITY)

1. **Sube esta carpeta a un repositorio nuevo de GitHub.** (No subas `node_modules` ni `.env`; ya están en `.gitignore`.)
2. **En Vercel → New Project → importa el repo.** Framework: *Vite* (lo detecta solo).
3. En **Settings → Environment Variables**, añade estas dos (ya van rellenas en `.env.example`):
   - `VITE_SUPABASE_URL` = `https://xnhcquehlyalwgqmdiov.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = `sb_publishable__yt00om5AQfG8fvVCSM_IA_G75zTGSS`
4. **Deploy.** En 1–2 minutos tienes la URL.

---

## 3. Primer arranque

1. Abre la URL → verás la pantalla de **login**.
2. Pulsa **"Crear una cuenta nueva"**, pon tu email y una contraseña → crea la cuenta del operador.
   - El login por email viene **activado por defecto** en Supabase.
   - *(Opcional, recomendado para kiosko):* en Supabase → **Authentication → Providers → Email**, desactiva *"Confirm email"* para entrar sin tener que confirmar el correo.
3. Entra. La primera vez se crea solo un evento **"MI EVENTO"** con una barra **"Taquilla"**. Entra como **admin** (PIN inicial `1234`) y configura tu evento, barras y productos.

> Usa la **misma cuenta** (mismo email) en todas las tablets del evento: así todas ven los mismos datos en tiempo real.

---

## 4. La impresora (Unykach POS5 UK56009)

La app imprime con el **navegador** hacia la impresora que tenga el equipo como **predeterminada**. El driver de la Unykach hace el **corte automático**. Papel **80 mm**.

**Montaje recomendado (silencioso, sin diálogo):**

1. **Instala la impresora** en el equipo (Windows recomendado para barra fija):
   - **Por USB:** conéctala y deja que Windows instale el driver.
   - **Por red (LAN):** Panel de control → Dispositivos → Agregar impresora → *"Agregar mediante dirección TCP/IP"* → pon la IP de la impresora → puerto **9100** (RAW). Es la opción más a prueba de fallos para barra fija.
2. **Ponla como impresora predeterminada** del equipo.
3. **Arranca el navegador en modo kiosko-impresión** (así imprime sin que salga el diálogo cada vez). En Windows, crea un acceso directo a Chrome con:
   ```
   chrome.exe --kiosk --kiosk-printing --app=https://TU-URL-DE-VERCEL
   ```
4. En la app, el indicador **"Impresora OK"** debe estar en verde (si pone "Simulación", púlsalo para activar la impresión real).

> En tablets Android la impresión web muestra diálogo (no es silenciosa). Para barra, usa un **equipo Windows táctil** con la Unykach por USB o LAN.

---

## 5. El folio del ticket (por qué funciona sin internet)

Cada ticket imprime un **folio local inmediato con prefijo de barra** (ej. `TAQ-0042`), tenga o no conexión. Ese folio se guarda en la base de datos y es lo que ve el cliente. Además, el servidor asigna un **número global** del evento para los informes y el cuadre. Así nunca esperas a la red para cobrar, y el papel siempre cuadra con la caja.

- Si una barra usa **varias tablets a la vez**, ponles una letra distinta de dispositivo para que los folios no coincidan (se configura en el código, `setDeviceTag("A")`, `"B"`…). Lo normal es **una tablet por barra**.

---

## 6. Cosas que conviene saber

- **Sin conexión:** las ventas se imprimen al momento y se **encolan**; cuando vuelve internet se **sincronizan solas** (indicador de conexión). Cada unidad lleva un identificador único, así nunca se duplica.
- **Cierre Z:** cierra el turno de una barra. El siguiente Z solo cuenta lo nuevo. El total del evento sigue sumando todo.
- **Borrar barras:** una barra **con ventas no se puede borrar** (protege la caja); se **archiva** (se oculta del TPV pero conserva su caja en informes).
- **PIN para anular:** opcional, se activa por evento en *Configuración*.
- **PINs:** admin `1234` y supervisor `0000` por defecto. **Cámbialos** en *Configuración*.

---

## 7. Para desarrolladores (opcional)

```bash
npm install
npm run dev      # desarrollo local
npm run build    # build de producción (Vercel lo hace solo)
```

Estructura: `src/App.jsx` (UI), `src/db.js` (acceso a datos + mapeo BD↔UI), `src/folio.js` (folio local), `src/auth.jsx` (login), `src/supabase.js` (cliente). El esquema SQL completo está en `supabase_ticketera.sql` (en la entrega anterior). El módulo ESC/POS directo (`printer-escpos.js`) queda disponible como vía avanzada futura (impresión por socket LAN/USB nativo); la app web usa impresión por navegador.

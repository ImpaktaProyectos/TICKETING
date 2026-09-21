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

## 4. La impresora (Unykach POS5 UK56009) — IMPORTANTE

El ticket se imprime con el **navegador** hacia la impresora **predeterminada** del equipo. Para que salga **corto, nítido y sin diálogo**, hay que configurar 3 cosas (una sola vez). Papel **80 mm**.

### 4.1 Instalar la impresora
- **Por USB:** conéctala y deja que Windows instale el driver Unykach/POS-80.
- **Por red (LAN):** Panel de control → Dispositivos e impresoras → *Agregar impresora* → *La impresora no está en la lista* → *Agregar mediante dirección TCP/IP* → IP de la impresora → puerto **9100** (RAW). Es lo más fiable para barra fija.
- Déjala como **impresora predeterminada** del equipo.

### 4.2 Ajustar el papel del driver (esto evita el papel larguísimo)
Botón derecho sobre la impresora → *Preferencias de impresión* → *Diseño/Avanzado*:
- **Tamaño de papel:** elige el de rollo de **80mm** (suele aparecer como `80mm x 297mm`, `80 x 3276` o `Roll 80mm`). **No** dejes A4.
- **Corte de papel / Paper cut:** *Después de cada documento* (o *Per page*). Así corta justo al final de cada ticket.
- **Márgenes:** 0 si te deja.

### 4.3 Que imprima SIN diálogo (modo kiosko) — el paso clave

**Lo más fácil:** en la carpeta del proyecto hay un archivo **`abrir-ticketera.bat`**. Ábrelo con el Bloc de notas, cambia la línea `set URL=` por tu dirección de Vercel, guárdalo, y haz **doble clic**. Abre la app ya en modo impresión directa. (Puedes crear un acceso directo de ese .bat en el escritorio.)

Si prefieres hacerlo a mano:
Los navegadores, por seguridad, **siempre** muestran el diálogo de impresión… salvo en **modo kiosko de impresión**. Se activa creando un acceso directo a Chrome con un parámetro:

1. Clic derecho en el escritorio → **Nuevo → Acceso directo**.
2. En la ubicación, pega esto (cambia la URL por la tuya de Vercel):
   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --kiosk --app=https://TU-URL.vercel.app
   ```
   - `--kiosk-printing` = imprime directo a la predeterminada, **sin diálogo**.
   - `--kiosk` y `--app=` = abren la web a pantalla completa, como si fuera una app.
3. Llama al acceso directo "Ticketera" y úsalo para abrir la caja.

Con esto: tocas un producto → imprime solo, cortito y nítido. **No vuelve a salir el cuadro de ajustes.**

> En **Edge** es igual: usa `msedge.exe` con `--kiosk-printing`.
> En **Android/iPad** el navegador NO permite impresión silenciosa. Para barra usa un **equipo Windows** (o un mini-PC) con la Unykach. Por eso esta impresora es ideal (USB/LAN + Windows).

### 4.4 Comprobar
Abre con el acceso directo, entra como cajero y vende un producto de prueba. Debe salir un ticket **corto, en negro nítido y cortado**. Si sale largo → revisa 4.2 (papel del driver en rollo). Si te pide confirmar → revisa que abriste con el acceso directo de 4.3.

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

---

## 8. Bonos / Ofertas especiales (BONOCOPAS, BONOCERVEZA…)

En *Configuración → Bonos / Ofertas especiales* (dentro de cada barra) puedes crear bonos:
- Pones un **nombre** (ej. `BONOCOPAS`), un **precio** del bono (o lo dejas vacío y cobra la suma), y eliges **qué tickets imprime** (ej. 4× COPA, o 2× CERVEZA + 1× AGUA).
- En el TPV aparece como un **botón dorado**. Al tocarlo: **se cobra el bono al precio que pusiste** y **se imprimen de golpe todos los tickets** configurados, cada uno cortado por separado.
- En caja, el bono se registra como **una venta** con su nombre y su precio.

Para vender varias unidades sueltas de un producto (ej. 4 copas en un ticket-multiplicado) usa el selector **×1 ×2 ×4…** del TPV: un toque imprime esas unidades de una.

---

## 9. Instalar como app (PWA) — funciona sin wifi

La app ahora es una **PWA instalable**: se guarda en el dispositivo y **abre sin conexión** tras instalarla una vez.

**Instalar en Android (Chrome):** abre tu URL → menú ⋮ → *Instalar aplicación* / *Añadir a pantalla de inicio*. Aparece el icono de Ticketera como una app.

**Instalar en Windows (Chrome/Edge):** abre tu URL → icono de instalar en la barra de direcciones (o menú → *Instalar Ticketera*).

**iPhone/iPad (Safari):** Compartir → *Añadir a pantalla de inicio*. (Recuerda: la impresora Unykach no es compatible con iPad.)

### Qué funciona sin wifi y qué no
- **SIN wifi (una vez abierta/instalada):** vender, **imprimir tickets**, bonos, cantidades. Las ventas se **guardan en cola** y se sincronizan solas al volver la conexión.
- **NECESITA conexión (un momento):** la **primera** carga en cada dispositivo (descargar la app y hacer login), ver datos **entre barras en tiempo real**, y **consolidar la caja** de todas las barras.

### Recomendación para un evento
1. **Antes del evento, con wifi:** abre e **instala la app en cada tablet** y haz login. Así queda guardada y arranca aunque se caiga la red.
2. Lleva un **4G/router de respaldo** para que las ventas suban y la caja cuadre en tiempo real (no es obligatorio para vender/imprimir, sí para sincronizar).
3. La **impresión no depende del wifi**: la Unykach va por USB o cable de red directo al equipo.

> Si actualizas la app (subes cambios a GitHub), al abrirla con conexión se actualiza sola.

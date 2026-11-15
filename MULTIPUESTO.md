# TIXFAST · Modalidad Multipuesto

Actualizado: 18/11/2026. Rama `claude/loving-johnson-dvw2ud`.

## Qué es
Un evento en el que la organización vende en sus **cajas** (el TPV de siempre) tickets con QR, y varios
**puestos** (food trucks, casetas, proveedores) los canjean con su propio móvil. La venta es de la
organización; el canje dice **qué puesto entregó, a qué hora exacta y por cuánto**. Todo vive en la
capa del TPV: el CRM no cambia.

## Cómo se usa
1. **Crear el evento** → Modalidad **Multipuesto** (también se puede cambiar en Ajustes del evento
   mientras no haya ventas). Todos los productos salen con QR.
2. **Ajustes del evento › Puestos** → añadir cada puesto: nombre, color, contacto,
   **tu comisión general** (% o € por unidad) y **qué productos puede canjear**, con comisión propia
   por producto si hace falta.
3. **Crear enlace y PIN** → se enseñan **una sola vez** (QR del enlace, copiar y WhatsApp). Mándalos
   por separado. Si se pierden, se crean otros y los anteriores dejan de valer al momento.
4. El puesto abre el enlace, pone el PIN y escanea:
   - Verde **ENTREGA**.
   - Rojo **YA CANJEADO** (dice dónde y a qué hora).
   - Rojo **TICKET NO VÁLIDO AQUÍ**: el ticket sigue valiendo y la pantalla dice qué puesto lo acepta.
   - Azul **SIN CONEXIÓN · NO ENTREGUES TODAVÍA**: se comprueba solo al volver la red.
   - Abajo ve **lo que ha entregado y su facturación ya con la comisión quitada**, en tiempo real, con
     el historial a la hora exacta.
5. **Informes › Puestos · liquidación**:
   - Vendidas, canjeadas y pendientes por producto.
   - Tu comisión y lo que hay que pagar a cada puesto.
   - Registro de cada puesto (canjes y rechazos con la hora exacta).
   - Descarga en Excel (CSV).

## Rápido en la cola
- **El PIN no se pide en cada ticket:** una vez por móvil, y el móvil queda dentro todo el evento
  (hasta 12 h después del fin; si el evento no tiene hora de fin, 3 días).
- **Sin PIN:** «📲 Activar un móvil con QR». El organizador lo enseña en su móvil y el food truck lo
  escanea con la cámara. Vale una vez y 15 minutos. Ideal para montar los puestos al empezar.
- **Pantalla siempre encendida**, y la cámara se reabre sola al volver a la app o desbloquear el móvil.
- **Pedido agrupado:** si el cliente da varios tickets, se escanean seguidos y arriba sale
  «3 × Hamburguesa · 1 × Bebida» hasta pulsar «Listo» (o 20 s sin escanear). El verde dura menos de
  1 segundo para seguir con el siguiente.
- **Pistola lectora USB o Bluetooth** (modo teclado, 30–40 €): se escanea sin tocar el móvil.
- **Modo mostrador:** botón 🔄 para usar la cámara delantera, con el móvil en un soporte mirando a la cola.
- **Icono en la pantalla de inicio:** tras entrar, la dirección es `/p/sesion`. Añadida a la pantalla
  de inicio, abre directamente el escáner.

## Seguridad
- **Acceso:** enlace secreto (144 bits) + PIN de 6 cifras. En la base de datos solo se guarda su huella
  (SHA-256 y bcrypt). 5 PIN fallidos → 15 minutos bloqueado.
- **Sesión:** cada móvil tiene la suya, que caduca 12 h después del fin del evento. El organizador
  puede cerrarla, y desactivar el puesto la cierra al momento.
- **Quién decide:** el canje lo decide siempre el servidor, con la misma garantía de un solo uso que
  el validador de siempre. Sin internet no se da nada por bueno.
- **Qué ve cada puesto:** solo lo suyo. No ve ventas, caja ni otros puestos. Las tablas nuevas no se
  pueden leer directamente: todo pasa por funciones que comprueban el acceso.
- **Qué puede canjear:** solo los productos que tiene permitidos. Tampoco puede canjear entradas al
  evento.

## Técnica
- **Migración:** `supabase/migrations/20261118090000_ticket_multipuesto.sql`.
  - Tablas `ticket_puestos`, `ticket_puesto_productos` y `ticket_puesto_sesiones`.
  - Columnas `puesto_id` y `valor` en los canjes.
  - El núcleo del canje (`ticket_canje_nucleo`) es compartido. `ticket_canjear` (el validador de las
    barras) mantiene su firma y su comportamiento.
- **Modalidad:** `ticket_style.modalidad`, sin columna nueva; los eventos estándar no cambian.
- **App:**
  - `src/multipuesto/` (reglas con pruebas, Puestos, InformePuestos).
  - `src/web/Puesto.jsx`, en la ruta pública `/p/<enlace>`.
  - `src/qr/lector.js`: cámara y sonidos, compartidos con el validador.
- **Plan:** función «Multipuesto» y límite «puestos por evento», configurables en Panel TIXFAST › Planes.
- **Prueba en producción:** hecha dentro de una transacción que se deshace. Resultados:
  - El evento estándar canjea y avisa de copia igual que antes.
  - 30 % de comisión sobre 10 € → el puesto factura 7 €.
  - Una pizza en un puesto de hamburguesas → «no válido aquí», y luego la canjea la pizzería.
  - Una sesión falsa no entra, y el PIN se bloquea al quinto fallo.
  - Otra cuenta no ve nada.

## Valor de cada consumición
Un ticket suelto vale lo cobrado en la caja. Un vale de un bono o combo vale el precio del producto.
La comisión se calcula con la configuración actual: si se corrige, la liquidación se corrige.

## Pendiente
- [ ] Publicar: migraciones `20261117090000` y `20261118090000`, funciones del servidor y la app.
- [ ] Ideas siguientes: «canjéalo en…» impreso en el ticket, que un puesto marque un producto como
      agotado y lo vean las cajas, y venta anticipada de vales en la ticketera online.

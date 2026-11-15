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
3. **Activar el móvil del puesto** (un solo uso):
   - **📲 QR**: el puesto lo escanea allí mismo. Caduca a los 15 minutos.
   - **✉️ Enlace**: se envía por WhatsApp. Caduca a las 24 horas.

   La primera vez, **el puesto crea su propio PIN** de 6 cifras; la organización no lo ve. El móvil
   queda desbloqueado **12 horas** y después pide ese PIN para otras 12. Si se olvida, en Puestos se
   pulsa «Borrar PIN» y se crea otro al activar de nuevo un móvil.
4. El puesto escanea:
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
- **Acceso:** sin PIN en cada ticket. Una activación por móvil y el PIN propio cada 12 horas.
- **Pantalla:** siempre encendida, y la cámara se reabre sola al volver a la app o desbloquear el móvil.
- **Pedido agrupado:** varios tickets seguidos suman «3 × Hamburguesa · 1 × Bebida» hasta pulsar «Listo».
- **Pistola lectora USB o Bluetooth** (modo teclado): se escanea sin tocar el móvil.
- **Icono en la pantalla de inicio:** `/p/sesion` abre directamente el escáner.

## Modo mostrador (de cara al público)
- El botón «Mostrador» pone la cámara delantera, para usar el móvil en un soporte mirando a la cola.
- **Solo sale «✓ CORRECTO» + el producto, o «NO VÁLIDO»** (o «NO VÁLIDO AQUÍ: es para…»).
- Ni facturación, ni historial, ni pedidos, ni datos internos.
- Para salir hace falta el **PIN del puesto**.

## Seguridad
- **Acceso:** el móvil solo entra con un código de activación de un solo uso de la organización
  (24 bytes aleatorios; solo se guarda su huella). El PIN lo crea el puesto, se guarda cifrado (bcrypt)
  y no se aceptan PIN fáciles. Tras 5 fallos seguidos, el puesto queda 15 minutos bloqueado.
- **Vínculo del móvil:** dura hasta 12 h después del fin del evento (3 días si no tiene fin). Cada
  12 horas pide el PIN. El organizador puede desvincular los móviles o desactivar el puesto, y deja de
  funcionar al momento.
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
- [x] Publicar: migraciones `20261117090000` y `20261118090000`, funciones del servidor y la app (15/11/2026).
- [ ] Ideas siguientes: «canjéalo en…» impreso en el ticket, que un puesto marque un producto como
      agotado y lo vean las cajas, y venta anticipada de vales en la ticketera online.

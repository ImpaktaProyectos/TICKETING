// Técnicas de venta de la página de entradas. TODAS usan datos reales del servidor:
// nunca se inventan cifras, compras ni prisas. Cada una se enciende o apaga en CRM › Entradas › Opciones.
export const AVISOS_DEF = {
  activo: true, umbralPct: 15, umbralN: "",         // «¡Quedan pocas!» / «¡Últimas X!»
  mostrarVendido: true,                              // barra de % vendido
  siguientePrecio: true,                             // «Después sube a 22 €»
  modoQuedan: "pocas",                               // pocas | exacto («Quedan 487 de 500») | porcentaje
  cuentaTramo: true,                                 // reloj hasta que acaba el precio del tramo (fin de venta real)
  masVendido: true,                                  // «El más elegido» en el tramo con más ventas
  notificaciones: true, notifCiudad: false,          // «Alguien ha comprado 2 entradas · hace 3 min»
  vendidas24: true,                                  // «34 entradas vendidas en las últimas 24 h»
  totalVendidas: false, minTotal: 50,                // «Ya van 350 personas con entrada»
  cuentaEvento: true,                                // «Faltan 3 días»
  confianza: true,                                   // sellos: nominativa, QR de un solo uso, al momento en el móvil
};
export const avisosDe = (a) => ({ ...AVISOS_DEF, ...(a && typeof a === "object" ? a : {}) });

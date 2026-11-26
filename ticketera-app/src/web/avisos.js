// Técnicas de venta de la página de entradas. TODAS usan datos reales del servidor:
// nunca se inventan cifras, compras ni prisas. Cada una se enciende o apaga en CRM › Entradas › Opciones.
export const AVISOS_DEF = {
  activo: true, umbralPct: 15, umbralN: "",         // «¡Quedan pocas!» / «¡Últimas X!»
  mostrarVendido: true,                              // barra de % vendido
  siguientePrecio: true,                             // «Después sube a 22 €»
  modoQuedan: "pocas",                               // pocas | exacto («Quedan 48 a este precio») | porcentaje
  umbralExacto: "",                                  // en «exacto», enseñar la cifra solo cuando queden N o menos (vacío = siempre)
  textoQuedan: "",                                   // texto propio con {n}: «Solo quedan {n} a este precio»
  cuentaTramo: true,                                 // reloj hasta que acaba el precio del tramo (fin de venta real)
  masVendido: true,                                  // «El más elegido» en el tramo con más ventas
  notificaciones: true, notifCiudad: false,          // «Alguien ha comprado 2 entradas · hace 3 min»
  vendidas24: true, minH24: 5, textoH24: "",         // «34 entradas vendidas en las últimas 24 h» (a partir de N; texto propio con {n})
  totalVendidas: false, minTotal: 50, textoTotal: "",// «Ya van 350 personas con entrada» (a partir de N; texto propio con {n})
  cuentaEvento: true,                                // «Faltan 3 días»
  confianza: true,                                   // sellos: nominativa, QR de un solo uso, al momento en el móvil
};
export const avisosDe = (a) => ({ ...AVISOS_DEF, ...(a && typeof a === "object" ? a : {}) });
// Texto propio del organizador con {n} = la cifra real. Sin {n}, la cifra va delante.
export const textoCon = (plantilla, n, porDefecto) => {
  const t = String(plantilla || "").trim().slice(0, 90);
  if (!t) return porDefecto;
  return t.includes("{n}") ? t.split("{n}").flatMap((x, i, a) => i < a.length - 1 ? [x, { n }] : [x]) : [{ n }, " " + t];
};

// ===================== RESERVADOS · mensaje de WhatsApp para pedir las bebidas =====================
// Un clic en la ficha del reservado abre WhatsApp con un mensaje cordial ya escrito para el cliente:
// cuántas botellas, de qué y qué refrescos quieren. Sin servidor: es un enlace wa.me.

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// Teléfono para wa.me: solo dígitos y, si es un móvil español sin prefijo, con 34 delante
export function waNumero(tel) {
  let d = String(tel || "").trim();
  const mas = d.startsWith("+") || d.startsWith("00");
  d = d.replace(/\D/g, "").replace(/^00/, "");
  if (!mas && /^[67]\d{8}$/.test(d)) d = "34" + d;
  return d.length >= 8 ? d : "";
}
// «jueves 12 de noviembre»
export function fechaLarga(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  return `${DIAS[d.getUTCDay()]} ${+m[3]} de ${MESES[+m[2] - 1]}`;
}
// Nombre para el saludo: el primero, con mayúscula («ana lópez» → «Ana»)
export function nombreSaludo(cliente) {
  const p = String(cliente || "").trim().replace(/^reserva\s+(de\s+)?/i, "").split(/\s+/)[0] || "";
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "";
}

// r: reservado · ev: evento ({ name, date }) · C: calcPedido(r, cfg) (opcional, para mencionar la tarifa)
export function mensajePedirBebidas(r, ev, C) {
  const nombre = nombreSaludo(r.cliente);
  const fecha = fechaLarga(ev?.date);
  const incl = C?.tarifa ? `Tu reserva (${C.tarifa.nombre})${C.incl ? ` incluye ${C.incl} ${C.incl === 1 ? "botella" : "botellas"}` : ""}.` : "";
  const ya = (C?.botellas || []).filter(b => b.bebida).map(b => [b.bebida, b.mezcla].filter(Boolean).join(" con ")).join(", ");
  return [
    `¡Hola${nombre ? `, ${nombre}` : ""}! 👋`,
    "",
    `Te escribimos de *${String(ev?.name || "la fiesta").trim()}*. Tienes reservado *${r.nombre}*${fecha ? ` para el *${fecha}*` : ""}. ¡Qué ganas de veros! 🎉`,
    "",
    "Para tenerlo todo preparado cuando lleguéis, ¿nos cuentas qué vais a tomar?",
    "",
    "🍾 *¿Cuántas botellas?*",
    "🥃 *¿De qué?* (marca o tipo: ginebra, ron, vodka, whisky…)",
    "🥤 *¿Con qué refrescos?* (Coca-Cola, tónica, limón, Red Bull…)",
    ...(incl || ya ? [""] : []),
    ...(incl ? [incl] : []),
    ...(ya ? [`Ahora mismo tenemos apuntado: ${ya}. Si queréis cambiar algo, dínoslo.`] : []),
    "",
    "Contéstanos por aquí cuando lo tengáis. ¡Muchas gracias y nos vemos en la fiesta! 🙌",
  ].join("\n");
}
export const enlacePedirBebidas = (r, ev, C) => { const n = waNumero(r.telefono); return n ? `https://wa.me/${n}?text=${encodeURIComponent(mensajePedirBebidas(r, ev, C))}` : ""; };

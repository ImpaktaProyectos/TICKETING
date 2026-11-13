// ===================== DINERO QUE TIENEN LOS SOCIOS (cálculo, sin base de datos) =====================
// Un socio tiene dinero de la empresa cuando:
//   · cobra la señal de un reservado (ticket_reservados.senal_socio), o
//   · vende sin ticket en efectivo desde su móvil (ventas con operario «SOCIO:Nombre»).
// Cuando lo repone, se confirma (ticket_socio_devoluciones) y la deuda desaparece.
// Las MISMAS reglas están en la vista ticket_socio_deudas (la que lee el CRM).
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
export const norm = (s) => String(s || "").trim();
export const claveSenal = (reservadoId) => `senal:${reservadoId}`;
export const claveVenta = (s) => `venta:${s.clientUuid || s.id}`;

// Deudas de un evento a partir de lo que ya tiene el TPV en memoria (funciona en vivo)
export function deudasEvento({ reservados = [], sales = [], devoluciones = [] }) {
  const dev = new Map(devoluciones.map(d => [d.clave, d]));
  const items = [];
  reservados.forEach(r => {
    const socio = norm(r.senalSocio);
    if (!socio || r.estado === "libre" || !(Number(r.senal) > 0)) return;
    items.push({ clave: claveSenal(r.id), origen: "senal", socio, concepto: `Señal del reservado ${r.nombre}${norm(r.cliente) ? ` · ${norm(r.cliente)}` : ""}`, importe: r2(r.senal), metodo: r.senalMetodo || "" });
  });
  sales.forEach(s => {
    if (s.voided || s.pago !== "efectivo" || !/^SOCIO:/.test(s.operario || "") || !(s.price > 0)) return;
    items.push({ clave: claveVenta(s), origen: "venta", socio: norm(String(s.operario).slice(6)) || "Socio", concepto: `Venta sin ticket en efectivo · ${s.name}`, importe: r2(s.price), ts: s.ts });
  });
  return items.map(it => { const d = dev.get(it.clave); const devuelto = d ? r2(d.importe) : 0; return { ...it, devuelto, devueltoEn: d?.devueltoEn || null, devueltoPor: d?.devueltoPor || "", pendiente: r2(Math.max(0, it.importe - devuelto)) }; });
}

// Agrupa por socio: { socio, total, pendiente, devuelto, items }
export function porSocio(items) {
  const m = new Map();
  items.forEach(it => {
    const k = it.socio.toLowerCase();
    const g = m.get(k) || { socio: it.socio, total: 0, pendiente: 0, devuelto: 0, items: [] };
    g.total = r2(g.total + it.importe); g.pendiente = r2(g.pendiente + it.pendiente); g.devuelto = r2(g.devuelto + Math.min(it.devuelto, it.importe));
    g.items.push(it); m.set(k, g);
  });
  return [...m.values()].sort((a, b) => b.pendiente - a.pendiente || a.socio.localeCompare(b.socio, "es"));
}


// ---------- Cambio que ponen los socios (la empresa se lo debe a ellos) ----------
// Agrupa por socio: { socio, total, pendiente, devuelto, items } (pendiente = lo que aún hay que devolverle)
export function aportacionesPorSocio(aportaciones = []) {
  const m = new Map();
  aportaciones.forEach(a => {
    const nombre = norm(a.socio) || "Socio", k = nombre.toLowerCase();
    const g = m.get(k) || { socio: nombre, total: 0, pendiente: 0, devuelto: 0, items: [] };
    g.total = r2(g.total + a.importe);
    if (a.devueltoEn) g.devuelto = r2(g.devuelto + a.importe); else g.pendiente = r2(g.pendiente + a.importe);
    g.items.push(a); m.set(k, g);
  });
  return [...m.values()].sort((a, b) => b.pendiente - a.pendiente || a.socio.localeCompare(b.socio, "es"));
}

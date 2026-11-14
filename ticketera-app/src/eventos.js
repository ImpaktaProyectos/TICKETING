// ===================== EVENTOS: cuál se abre por defecto, en qué momento está y copia para uno nuevo =====================
// Sin base de datos (se puede probar): lo usan la pantalla de inicio, el TPV y el CRM.

const DIA = 86400000;
// Cuándo empieza y cuándo termina un evento. Si no tiene hora de fin, se da por terminado a las 8:00 del día siguiente.
export function rangoEvento(ev) {
  const ini = ev?.startsAt ? new Date(ev.startsAt) : ev?.date ? new Date(ev.date + "T00:00") : null;
  const fin = ev?.endsAt ? new Date(ev.endsAt) : ev?.date ? new Date(new Date(ev.date + "T08:00").getTime() + DIA) : null;
  return { ini: ini && !isNaN(ini) ? ini : null, fin: fin && !isNaN(fin) ? fin : null };
}

// El evento que se abre al entrar: el que está en curso o el próximo por fecha; si no hay ninguno, el último que pasó
export function eventoPorDefecto(events = [], ahora = new Date()) {
  const t = +ahora;
  const conFecha = events.map(e => ({ e, ...rangoEvento(e) })).filter(x => x.ini);
  const vigentes = conFecha.filter(x => x.fin && +x.fin >= t).sort((a, b) => a.ini - b.ini);
  if (vigentes.length) return vigentes[0].e;
  const pasados = conFecha.sort((a, b) => b.ini - a.ini);
  return pasados[0]?.e || events[0] || null;
}

// Etiqueta para saber de un vistazo en qué evento estás
export function estadoFecha(ev, ahora = new Date()) {
  const { ini, fin } = rangoEvento(ev);
  if (!ini) return { k: "sin", t: "SIN FECHA", c: "var(--muted)" };
  const t = +ahora;
  if (t >= +ini && fin && t <= +fin) return { k: "curso", t: "EN CURSO", c: "var(--green)" };
  const hoy = new Date(ahora); hoy.setHours(0, 0, 0, 0);
  const diaEv = new Date(ini); diaEv.setHours(0, 0, 0, 0);
  const dias = Math.round((diaEv - hoy) / DIA);
  if (fin && t > +fin) return { k: "pasado", t: dias === -1 ? "AYER" : "PASADO", c: "var(--red)", dias };
  if (dias <= 0) return { k: "hoy", t: "HOY", c: "var(--green)", dias: 0 };
  if (dias === 1) return { k: "proximo", t: "MAÑANA", c: "var(--accent)", dias };
  return { k: "proximo", t: `EN ${dias} DÍAS`, c: "var(--accent)", dias };
}

// Orden para elegir evento: primero los próximos (el más cercano arriba) y luego los pasados (el más reciente arriba)
export function ordenarEventos(events = [], ahora = new Date()) {
  const t = +ahora;
  const info = events.map(e => ({ e, ...rangoEvento(e) }));
  const vig = info.filter(x => !x.fin || +x.fin >= t).sort((a, b) => (a.ini || 0) - (b.ini || 0));
  const pas = info.filter(x => x.fin && +x.fin < t).sort((a, b) => (b.ini || 0) - (a.ini || 0));
  return [...vig, ...pas].map(x => x.e);
}

// Evento nuevo a partir de otro. Se copian barras, productos (orden, colores, emojis…), bonos/combos, comisiones de
// proveedores, plantilla del ticket y ajustes; con «reservados», sus tarifas, extras, promotores y socios.
// NUNCA ventas, cierres, ingresos ni gastos. uid: generador de ids.
export function copiaDeEvento(src, datos, uid, { barras = true, reservados = true } = {}) {
  const pmap = {};
  const puntosSrc = barras ? src.puntos.filter(p => !p.archivado) : [];
  const puntos = puntosSrc.map(p => {
    const products = (p.products || []).map((x, i) => { const id = uid(); pmap[x.id] = id; return { ...x, id, soldOut: false, orden: x.orden ?? i }; });
    return { id: uid(), name: p.name, archivado: false, fondo: null, fondoPrevisto: p.fondoPrevisto ?? null, sortMode: p.sortMode || "manual", estado: "prueba", products, combos: (p.combos || []).map(c => ({ ...c })) };
  });
  puntos.forEach(p => { p.combos = p.combos.map(c => ({ ...c, id: uid(), items: (c.items || []).map(it => ({ ...it, productId: pmap[it.productId] || it.productId })) })); });
  if (!puntos.length) puntos.push({ id: uid(), name: "Barra", archivado: false, fondo: null, fondoPrevisto: null, sortMode: "manual", estado: "prueba", products: [], combos: [] });
  const st = { ...(src.style || {}) };
  if (st.comisiones) { const nc = {}; Object.entries(st.comisiones).forEach(([pid, l]) => { const last = l && l[l.length - 1]; if (pmap[pid] && last && last.proveedor) nc[pmap[pid]] = [{ ...last, desde: 0 }]; }); st.comisiones = nc; }
  if (st.reservados) {
    if (!reservados) delete st.reservados;
    else { const pm = {}; puntosSrc.forEach(p => { const n = puntos.find(x => x.name === p.name); if (n) pm[p.id] = n.id; }); st.reservados = { ...st.reservados, puntos: (st.reservados.puntos || []).map(id => pm[id]).filter(Boolean) }; }
  }
  return { ...src, id: uid(), name: datos.name, date: datos.date, venue: datos.venue ?? src.venue ?? "", closed: false, startsAt: datos.startsAt || "", endsAt: datos.endsAt || "", style: st, puntos, qrClave: "" };
}

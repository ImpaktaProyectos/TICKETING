// ===================== PLANES: reglas puras (sin red), probadas en planes.test.mjs =====================
// Regla de oro: si no se sabe el acceso (acc = null), no se bloquea nada.
export const ESTADO_CUENTA = {
  prueba: { t: "Prueba gratuita", c: "var(--amber)" },
  activa: { t: "Activa", c: "var(--green)" },
  impagada: { t: "Pago pendiente", c: "var(--amber)" },
  suspendida: { t: "Pausada", c: "var(--red)" },
  cancelada: { t: "Cancelada", c: "var(--red)" },
};
export const LIMITES_TXT = { eventos: ["evento a la vez", "eventos a la vez"], barras_por_evento: ["barra por evento", "barras por evento"] };
export const FUNCIONES = {
  facturacion: "Facturación",
  stock: "Control de stock",
  prevision: "Previsión",
  entradas_online: "Venta de entradas online",
  reservados: "Reservados VIP",
  rrpp: "RRPP",
  conexiones: "Conexión con ticketeras",
};

export const hoyLocal = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
// Mensajes para quien intenta pasar un límite (null = se puede)
export function avisoNuevoEvento(acc, events, hoyIso = hoyLocal()) {
  const lim = limiteDe(acc, "eventos");
  if (lim == null || eventosQueCuentan(events, hoyIso) < lim) return null;
  return `Con el plan ${acc.plan_nombre || "Gratis"} puedes tener ${lim} ${lim === 1 ? "evento" : "eventos"} a la vez. Cierra el actual o suscríbete para crear más.`;
}
export function avisoNuevaBarra(acc, ev, hoyIso = hoyLocal()) {
  const lim = limiteDe(acc, "barras_por_evento");
  if (lim == null || eventoProtegido(acc, ev, hoyIso)) return null;
  if ((ev?.puntos || []).filter(p => !p.archivado).length < lim) return null;
  return `Con el plan ${acc.plan_nombre || "Gratis"} puedes tener ${lim} barras por evento. Suscríbete para añadir más.`;
}

/* ---------- Funciones puras (probadas en cuenta.test.mjs) ---------- */
export const bloqueada = (acc, f) => !!(acc && Array.isArray(acc.limites?.bloquea) && acc.limites.bloquea.includes(f));
export const limiteDe = (acc, k) => { const v = acc?.limites?.[k]; return Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null; };
export const diasRestantes = (acc, ahora = Date.now()) => acc?.fin_acceso ? Math.max(0, Math.ceil((new Date(acc.fin_acceso) - ahora) / 86400000)) : null;
// Eventos que cuentan para el límite: ni cerrados ni ya pasados (desde ayer en adelante)
export function eventosQueCuentan(events, hoyIso) {
  const ayer = new Date(new Date(hoyIso + "T12:00").getTime() - 86400000).toISOString().slice(0, 10);
  return (events || []).filter(e => !e.closed && (e.date || hoyIso) >= ayer).length;
}
// Un evento creado con acceso completo conserva todo hasta el día siguiente a su fecha
export function eventoProtegido(acc, ev, hoyIso) {
  if (!acc?.fin_acceso || !ev) return false;
  const ayer = new Date(new Date(hoyIso + "T12:00").getTime() - 86400000).toISOString().slice(0, 10);
  const creado = ev.creadoEn ? new Date(ev.creadoEn) : null;
  return !!creado && creado <= new Date(acc.fin_acceso) && (ev.date || hoyIso) >= ayer;
}
export const puede = (acc, f, ev, hoyIso) => !bloqueada(acc, f) || eventoProtegido(acc, ev, hoyIso);


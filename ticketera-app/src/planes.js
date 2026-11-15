// ===================== PLANES: reglas puras (sin red), probadas en planes.test.mjs =====================
// Regla de oro: si no se sabe el acceso (acc = null), no se bloquea nada.
export const ESTADO_CUENTA = {
  pendiente: { t: "Sin suscripción", c: "var(--muted)" },
  prueba: { t: "Prueba gratuita", c: "var(--amber)" },
  activa: { t: "Activa", c: "var(--green)" },
  impagada: { t: "Pago pendiente", c: "var(--amber)" },
  suspendida: { t: "Pausada", c: "var(--red)" },
  cancelada: { t: "Cancelada", c: "var(--red)" },
};
// ===================== CATÁLOGO: lo que se puede dar o limitar en cada plan =====================
// Debe coincidir con public.ticket_catalogo() (migración 20261117090000). Para añadir algo nuevo:
// 1) añadirlo aquí y en ticket_catalogo(); 2) comprobarlo en la base de datos (disparador);
// 3) avisar en la app con puede() / avisoLimite().
// La ticketera (entradas online, organizaciones, RRPP y validación de entradas) es siempre gratuita:
// de ahí se cobran comisiones, por eso no está en el catálogo.
export const GRUPOS = [
  ["noche", "En el evento"],
  ["crm", "CRM y gestión"],
];
export const CATALOGO = {
  tpv: { t: "El TPV", corto: "TPV", grupo: "noche", d: "Venta en barra, tickets, caja, cierres Z y cierre de la noche" },
  reservados: { t: "Los reservados VIP", corto: "Reservados VIP", grupo: "noche", d: "Mesas, tarifas, botellas, plano de la sala y cobro en taquilla" },
  reserva_online: { t: "La reserva online de mesas", corto: "Reserva online de mesas", grupo: "noche", d: "El cliente elige mesa en el plano y paga el adelanto desde el móvil" },
  crm: { t: "El CRM", corto: "CRM", grupo: "crm", d: "Panel, ingresos, gastos, socios y liquidación de cada evento" },
  facturacion: { t: "La facturación", corto: "Facturación", grupo: "crm", d: "Facturas, gastos con foto y facturas que se repiten" },
  stock: { t: "El control de stock", corto: "Stock", grupo: "crm", d: "Almacén, recetas, albaranes y recuentos" },
  prevision: { t: "La previsión", corto: "Previsión", grupo: "crm", d: "Previsión de ingresos y gastos antes del evento" },
  conexiones: { t: "La conexión con ticketeras", corto: "Conexión con ticketeras", grupo: "crm", d: "Trae solas las ventas de Fourvenues al CRM" },
};
export const FUNCIONES = Object.fromEntries(Object.entries(CATALOGO).map(([k, v]) => [k, v.t]));
// Límites: null o ausente = sin límite. min = lo mínimo que se puede poner (para no dejar la app inservible)
export const LIMITES = {
  eventos: { t: "Eventos a la vez", uno: "evento a la vez", varios: "eventos a la vez", min: 1, d: "Eventos abiertos (ni cerrados ni ya pasados)" },
  barras_por_evento: { t: "Puntos de venta por evento", uno: "punto de venta por evento", varios: "puntos de venta por evento", min: 1, d: "Barras y taquillas de cada evento" },
  planos: { t: "Planos guardados", uno: "plano guardado", varios: "planos guardados", min: 0, d: "Planos de sala en «Mis planos» para usar en otros eventos" },
  socios: { t: "Socios", uno: "socio", varios: "socios", min: 0, d: "Socios activos del CRM" },
  facturas_mes: { t: "Facturas al mes", uno: "factura emitida al mes", varios: "facturas emitidas al mes", min: 0, d: "Facturas emitidas cada mes (las recibidas no cuentan)" },
};
export const LIMITES_TXT = Object.fromEntries(Object.entries(LIMITES).map(([k, v]) => [k, [v.uno, v.varios]]));
export const limiteTxt = (k, n) => n == null ? `${LIMITES[k]?.varios || k} sin límite` : `${n} ${n === 1 ? LIMITES[k]?.uno : LIMITES[k]?.varios}`;

// ---------- Planes: de la base de datos al formulario y vuelta ----------
// En la base de datos: limites = { bloquea: [...], barras_por_evento: 3, ... }
export const incluye = (plan, f) => !(Array.isArray(plan?.limites?.bloquea) && plan.limites.bloquea.includes(f));
export const limitePlan = (plan, k) => { const v = plan?.limites?.[k]; return v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v); };
export function planAFormulario(plan) {
  return {
    id: plan?.id || null, nombre: plan?.nombre || "", descripcion: plan?.descripcion || "",
    precio: plan?.precio_mes != null ? String(plan.precio_mes).replace(".", ",") : "",
    dias_prueba: String(plan?.dias_prueba ?? 7), publico: !!plan?.publico, destacado: !!plan?.destacado,
    incluye: Object.keys(CATALOGO).filter(f => plan ? incluye(plan, f) : true),
    limites: Object.fromEntries(Object.keys(LIMITES).map(k => [k, plan ? limitePlan(plan, k) : null])),
  };
}
// Lo que se manda a admin_plan_guardar (o la lista de errores para enseñar)
export function formularioAPlan(f, { sistema = false } = {}) {
  const errores = [];
  const nombre = String(f.nombre || "").trim();
  if (nombre.length < 2 || nombre.length > 40) errores.push("El nombre debe tener entre 2 y 40 letras.");
  const pTxt = String(f.precio || "").trim().replace(/\./g, "").replace(",", ".");
  const precio = pTxt === "" ? null : Number(pTxt);
  if (!sistema && precio != null && !(precio > 0 && precio <= 10000)) errores.push("Escribe un precio válido (por ejemplo 29,90).");
  const dias = String(f.dias_prueba ?? "").trim() === "" ? 0 : Number(f.dias_prueba);
  if (!Number.isInteger(dias) || dias < 0 || dias > 60) errores.push("Los días de prueba van de 0 a 60.");
  if (!sistema && f.publico && precio == null) errores.push("Ponle precio antes de dejar que se pueda contratar.");
  if (!sistema && f.publico && !(f.incluye || []).length) errores.push("Un plan de pago tiene que incluir al menos una función.");
  const limites = {};
  for (const [k, def] of Object.entries(LIMITES)) {
    const v = f.limites?.[k];
    if (v === null || v === undefined || v === "") { limites[k] = null; continue; }
    const n = Number(v);
    if (!Number.isInteger(n) || n < def.min || n > 10000) { errores.push(`${def.t}: pon un número desde ${def.min}, o «sin límite».`); continue; }
    limites[k] = n;
  }
  return { errores, datos: { id: f.id || null, nombre, descripcion: String(f.descripcion || "").trim().slice(0, 300), precio_mes: precio == null ? null : Math.round(precio * 100) / 100,
    dias_prueba: dias, publico: !!f.publico, destacado: !!f.destacado, incluye: (f.incluye || []).filter(x => x in CATALOGO), limites } };
}
// Lo que incluye un plan, en frases cortas (para la pantalla de suscripción y el panel)
export function resumenPlan(plan) {
  const si = Object.keys(CATALOGO).filter(f => incluye(plan, f)).map(f => CATALOGO[f].corto);
  const lim = Object.keys(LIMITES).filter(k => limitePlan(plan, k) != null).map(k => limiteTxt(k, limitePlan(plan, k)));
  return { incluye: si, limites: lim, noIncluye: Object.keys(CATALOGO).filter(f => !incluye(plan, f)).map(f => CATALOGO[f].corto) };
}
// Plan contratable más barato que mejora lo que falta: { funcion } o { limite, n }
export function planMejor(planes, actualId, { funcion = null, limite = null, n = 0 } = {}) {
  return (planes || []).filter(p => p.id !== actualId && Number(p.precio_mes) > 0)
    .filter(p => !funcion || incluye(p, funcion))
    .filter(p => !limite || limitePlan(p, limite) == null || limitePlan(p, limite) > n)
    .sort((a, b) => Number(a.precio_mes) - Number(b.precio_mes))[0] || null;
}
export const DIAS_PRUEBA = 7;
// Sin suscripción (el TPV está bloqueado): solo queda la ticketera
export const sinSuscripcion = (acc) => bloqueada(acc, "tpv");

export const hoyLocal = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
// Mensajes para quien intenta pasar un límite (null = se puede)
export function avisoNuevoEvento(acc, events, hoyIso = hoyLocal()) {
  const lim = limiteDe(acc, "eventos");
  if (lim == null || eventosQueCuentan(events, hoyIso) < lim) return null;
  return `Tu plan ${acc.plan_nombre || ""} permite ${limiteTxt("eventos", lim)}. Cierra uno o cambia de plan en Ajustes › Tu cuenta.`;
}
export function avisoNuevaBarra(acc, ev, hoyIso = hoyLocal()) {
  const lim = limiteDe(acc, "barras_por_evento");
  if (lim == null || eventoProtegido(acc, ev, hoyIso)) return null;
  if ((ev?.puntos || []).filter(p => !p.archivado).length < lim) return null;
  return `Tu plan ${acc.plan_nombre || ""} permite ${limiteTxt("barras_por_evento", lim)}. Archiva uno o cambia de plan en Ajustes › Tu cuenta.`;
}

/* ---------- Funciones puras ---------- */
export const bloqueada = (acc, f) => !!(acc && Array.isArray(acc.limites?.bloquea) && acc.limites.bloquea.includes(f));
export const limiteDe = (acc, k) => { const v = acc?.limites?.[k]; return Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null; };
export const diasRestantes = (acc, ahora = Date.now()) => acc?.fin_acceso ? Math.max(0, Math.ceil((new Date(acc.fin_acceso) - ahora) / 86400000)) : null;
// Eventos que cuentan para el límite: ni cerrados ni ya pasados (desde ayer en adelante)
export function eventosQueCuentan(events, hoyIso) {
  const ayer = new Date(new Date(hoyIso + "T12:00").getTime() - 86400000).toISOString().slice(0, 10);
  return (events || []).filter(e => !e.closed && (e.date || hoyIso) >= ayer).length;
}
// Un evento creado con acceso completo conserva todo hasta el día siguiente a su fecha.
// Solo para quien ha perdido la suscripción: con un plan activo mandan los permisos de su plan.
export function eventoProtegido(acc, ev, hoyIso) {
  if (!acc?.fin_acceso || !ev || acc.plan_id !== "sin_suscripcion") return false;
  const ayer = new Date(new Date(hoyIso + "T12:00").getTime() - 86400000).toISOString().slice(0, 10);
  const creado = ev.creadoEn ? new Date(ev.creadoEn) : null;
  return !!creado && creado <= new Date(acc.fin_acceso) && (ev.date || hoyIso) >= ayer;
}
export const puede = (acc, f, ev, hoyIso) => !bloqueada(acc, f) || eventoProtegido(acc, ev, hoyIso);


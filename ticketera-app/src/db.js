import { supabase, uid } from "./supabase";

/* ===================== MAPEADORES BD <-> UI ===================== */
const prodFromDb = (p) => ({ id: p.id, name: p.nombre, price: Number(p.precio), color: p.color, emoji: p.emoji, soldOut: p.agotado, orden: p.orden ?? 0, subtitle: p.subtitulo || "", print: p.imprimir !== false, qr: p.qr !== false });
const byOrden = (a, b) => (a.orden - b.orden) || String(a.creado_en || "").localeCompare(String(b.creado_en || "")) || String(a.id).localeCompare(String(b.id));
const puntoFromDb = (p) => ({ id: p.id, name: p.nombre, archivado: p.archivado, combos: p.combos || [], fondo: p.fondo != null ? Number(p.fondo) : null, fondoEn: p.fondo_en, fondoPor: p.fondo_por, fondoPrevisto: p.fondo_previsto != null ? Number(p.fondo_previsto) : null, estado: ["abierta", "cerrada"].includes(p.estado) ? p.estado : "prueba", abiertaEn: p.abierta_en, abiertaPor: p.abierta_por, cerradaEn: p.cerrada_en, cerradaPor: p.cerrada_por, sortMode: p.orden_modo === "ventas" ? "ventas" : "manual", products: (p.ticket_productos || []).slice().sort(byOrden).map(prodFromDb) });
const evFromDb = (e) => ({
  id: e.id, name: e.nombre, date: e.fecha, venue: e.recinto || "", template: e.plantilla, paper: e.papel,
  footer: e.pie || "", logo: e.logo_url || "", showEventName: e.mostrar_evento, showDate: e.mostrar_fecha,
  showTime: e.mostrar_hora, showPrice: e.mostrar_precio, anularPin: e.anular_pin,
  closed: !!e.cerrada, pedirFondo: e.pedir_fondo !== false, startsAt: e.inicio || "", endsAt: e.fin || "", advanced: !!e.venta_avanzada, changeHelp: e.ayuda_cambio !== false,
  style: e.ticket_style || {},
  qrActivo: !!e.qr_activo, qrClave: e.qr_clave || "",
  pin_admin: e.pin_admin, pin_supervisor: e.pin_supervisor, pin_admin_huella: e.pin_admin_huella || null, pin_supervisor_huella: e.pin_supervisor_huella || null,
  puntos: (e.ticket_puntos || []).map(puntoFromDb),
});
const saleFromDb = (s) => ({ id: s.id, clientUuid: s.client_uuid, code: s.codigo, num: s.numero, eventId: s.evento_id, puntoId: s.punto_id, productId: s.producto_id, name: s.nombre, price: Number(s.precio), ts: new Date(s.creado_en).getTime(), voided: s.anulada, closureId: s.closure_id, operario: s.operario, pago: s.metodo_pago, invite: /^invitacion/.test(s.metodo_pago || ""), inviteValue: /^invitacion/.test(s.metodo_pago || "") ? (Number(String(s.metodo_pago).split(":")[1]) || 0) : 0, entregado: s.entregado != null ? Number(s.entregado) : null, cambio: s.cambio != null ? Number(s.cambio) : null, synced: true });
const gastoFromDb = (g) => ({ tipo: g.tipo === "entrada" ? "entrada" : "gasto", id: g.id, eventId: g.evento_id, puntoId: g.punto_id, importe: Number(g.importe), concepto: g.concepto || "", categoria: g.categoria || "", crmGastoId: g.crm_gasto_id || null, por: g.registrado_por || "", ts: new Date(g.creado_en).getTime(), voided: !!g.anulado, closureId: g.closure_id, synced: true });
const closureFromDb = (c) => ({ id: c.id, eventId: c.evento_id, puntoId: c.punto_id, count: c.tickets, revenue: Number(c.facturacion), voids: c.anulaciones, lines: c.detalle || [], efectivo: Number(c.efectivo || 0), tarjeta: Number(c.tarjeta || 0), fondo: Number(c.fondo || 0), contado: c.contado != null ? Number(c.contado) : null, gastos: Number(c.gastos || 0), entradas: Number(c.entradas || 0), esperado: c.esperado != null ? Number(c.esperado) : null, ts: new Date(c.creado_en).getTime(), por: c.cerrado_por || "", revertidoEn: c.revertido_en || null, revertidoPor: c.revertido_por || "" });

const evToDb = (e) => ({ id: e.id, nombre: e.name, fecha: e.date, recinto: e.venue, plantilla: e.template, papel: e.paper, pie: e.footer, logo_url: e.logo, mostrar_evento: e.showEventName, mostrar_fecha: e.showDate, mostrar_hora: e.showTime, mostrar_precio: e.showPrice, anular_pin: e.anularPin, cerrada: !!e.closed, inicio: e.startsAt || null, fin: e.endsAt || null, venta_avanzada: !!e.advanced, ayuda_cambio: e.changeHelp !== false, pedir_fondo: e.pedirFondo !== false, ticket_style: e.style || {}, qr_activo: !!e.qrActivo, pin_admin: e.pin_admin, pin_supervisor: e.pin_supervisor, pin_admin_huella: e.pin_admin_huella || null, pin_supervisor_huella: e.pin_supervisor_huella || null });
const evPatchToDb = (patch) => {
  const m = { name: "nombre", date: "fecha", venue: "recinto", template: "plantilla", paper: "papel", footer: "pie", logo: "logo_url", showEventName: "mostrar_evento", showDate: "mostrar_fecha", showTime: "mostrar_hora", showPrice: "mostrar_precio", anularPin: "anular_pin", closed: "cerrada", startsAt: "inicio", endsAt: "fin", advanced: "venta_avanzada", changeHelp: "ayuda_cambio", pedirFondo: "pedir_fondo", style: "ticket_style", qrActivo: "qr_activo", pin_admin: "pin_admin", pin_supervisor: "pin_supervisor", pin_admin_huella: "pin_admin_huella", pin_supervisor_huella: "pin_supervisor_huella" };
  const out = {}; for (const k in patch) if (m[k]) out[m[k]] = patch[k]; return out;
};
const prodToDb = (puntoId, p) => ({ id: p.id, punto_id: puntoId, nombre: p.name, precio: p.price, color: p.color, emoji: p.emoji, agotado: p.soldOut, orden: p.orden ?? 0, subtitulo: (p.subtitle || "").trim(), imprimir: p.print !== false, qr: p.qr !== false });
const prodPatchToDb = (patch) => { const m = { name: "nombre", price: "precio", color: "color", emoji: "emoji", soldOut: "agotado", orden: "orden", subtitle: "subtitulo", print: "imprimir", qr: "qr" }; const o = {}; for (const k in patch) if (m[k]) o[m[k]] = patch[k]; return o; };

/* ===================== CARGA INICIAL ===================== */
// Supabase devuelve máx. 1000 filas por consulta: cargamos por páginas para no perder ventas
async function fetchAll(buildQuery, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

export async function loadAll() {
  const { data: eventos, error } = await supabase
    .from("ticket_eventos")
    .select("*, ticket_puntos(*, ticket_productos(*))")
    .order("fecha", { ascending: true });
  if (error) throw error;
  const eventIds = (eventos || []).map(e => e.id);
  let sales = [], closures = [], gastos = [];
  if (eventIds.length) {
    const [v, c, g] = await Promise.all([
      fetchAll(() => supabase.from("ticket_ventas").select("*").in("evento_id", eventIds).order("creado_en", { ascending: true }).order("id", { ascending: true })),
      fetchAll(() => supabase.from("ticket_cierres").select("*").in("evento_id", eventIds).order("creado_en", { ascending: true }).order("id", { ascending: true })),
      fetchAll(() => supabase.from("ticket_gastos").select("*").in("evento_id", eventIds).order("creado_en", { ascending: true }).order("id", { ascending: true })).catch(() => []),
    ]);
    sales = v.map(saleFromDb);
    closures = c.map(closureFromDb);
    gastos = g.map(gastoFromDb);
  }
  const events = (eventos || []).map(evFromDb);
  return { events, sales, closures, gastos };
}
export async function loadGastos(eventId) {
  const rows = await fetchAll(() => supabase.from("ticket_gastos").select("*").eq("evento_id", eventId).order("creado_en", { ascending: true }).order("id", { ascending: true }));
  return rows.map(gastoFromDb);
}
export async function loadClosures(eventId) {
  const rows = await fetchAll(() => supabase.from("ticket_cierres").select("*").eq("evento_id", eventId).order("creado_en", { ascending: true }).order("id", { ascending: true }));
  return rows.map(closureFromDb);
}
export async function loadSales(eventId) {
  const rows = await fetchAll(() => supabase.from("ticket_ventas").select("*").eq("evento_id", eventId).order("creado_en", { ascending: true }).order("id", { ascending: true }));
  return rows.map(saleFromDb);
}

// Si la cuenta no tiene eventos aún, crea uno por defecto para arrancar.
export async function ensureDefaultEvent() {
  const evId = uid(), ptId = uid();
  await supabase.from("ticket_eventos").insert(evToDb({
    id: evId, name: "MI EVENTO", date: new Date().toISOString().slice(0, 10), venue: "", template: "festival",
    paper: 80, footer: "", logo: "", showEventName: true, showDate: true, showTime: true, showPrice: true,
    anularPin: false, pin_admin: "1234", pin_supervisor: "0000",
  }));
  await supabase.from("ticket_puntos").insert({ id: ptId, evento_id: evId, nombre: "Taquilla", archivado: false });
}

/* ===================== ESCRITURAS (admin/config) ===================== */
export async function persistAction(action, ctx = {}) {
  try {
    switch (action.type) {
      case "ADD_EVENT": {
        const r1 = await supabase.from("ticket_eventos").insert(evToDb(action.event)); if (r1.error) throw r1.error;
        if (action.event.puntos?.length) {
          const r2 = await supabase.from("ticket_puntos").insert(action.event.puntos.map(p => ({ id: p.id, evento_id: action.event.id, nombre: p.name, archivado: !!p.archivado, combos: p.combos || [], orden_modo: p.sortMode === "ventas" ? "ventas" : "manual", fondo_previsto: p.fondoPrevisto ?? null }))); if (r2.error) throw r2.error;
          // Evento duplicado: también sus productos (con orden, colores, emojis, subtítulos…)
          const prods = action.event.puntos.flatMap(p => (p.products || []).map((x, i) => prodToDb(p.id, { ...x, orden: x.orden ?? i })));
          if (prods.length) { const r3 = await supabase.from("ticket_productos").insert(prods); if (r3.error) throw r3.error; }
        }
        break;
      }
      case "UPDATE_EVENT": await supabase.from("ticket_eventos").update(evPatchToDb(action.patch)).eq("id", action.id); break;
      case "ADD_PUNTO": await supabase.from("ticket_puntos").insert({ id: action.punto.id, evento_id: action.eventId, nombre: action.punto.name, archivado: false }); break;
      case "ARCHIVE_PUNTO": await supabase.from("ticket_puntos").update({ archivado: action.value }).eq("id", action.puntoId); break;
      case "UPDATE_PUNTO": { const m = { name: "nombre", archivado: "archivado", combos: "combos", sortMode: "orden_modo", fondoPrevisto: "fondo_previsto" }; const o = {}; for (const k in action.patch) if (m[k]) o[m[k]] = action.patch[k]; await supabase.from("ticket_puntos").update(o).eq("id", action.puntoId); break; }
      case "DELETE_PUNTO": await supabase.from("ticket_puntos").delete().eq("id", action.puntoId); break;
      case "ADD_PRODUCT": await supabase.from("ticket_productos").insert(prodToDb(action.puntoId, action.product)); break;
      case "UPDATE_PRODUCT": await supabase.from("ticket_productos").update(prodPatchToDb(action.patch)).eq("id", action.productId); break;
      case "DELETE_PRODUCT": await supabase.from("ticket_productos").delete().eq("id", action.productId); break;
      case "REORDER_PRODUCTS": {
        // Solo se tocan los productos cuyo puesto ha cambiado
        const prev = action.prevIds || [];
        await Promise.all(action.ids.map((id, i) => prev[i] === id ? null : supabase.from("ticket_productos").update({ orden: i }).eq("id", id)).filter(Boolean));
        break;
      }
      case "SET_ADMIN_PIN": if (ctx.eventId) await supabase.from("ticket_eventos").update({ pin_admin: action.pin }).eq("id", ctx.eventId); break;
      case "SET_SUPERVISOR_PIN": if (ctx.eventId) await supabase.from("ticket_eventos").update({ pin_supervisor: action.pin }).eq("id", ctx.eventId); break;
      default: break;
    }
  } catch (e) { console.error("persist", action.type, e); }
}

/* ===================== COLA OFFLINE (ventas, anulaciones, cierres, fondo) =====================
   Reglas de robustez:
   - Cada item lleva un id propio (qid) -> se borra SOLO lo que se ha subido de verdad.
   - Orden estricto: si un item falla, se para ahí (no se sube nada desordenado).
   - Un único proceso de sincronización a la vez (candado) -> nada se ejecuta dos veces.
   - Si hay cola pendiente, lo nuevo también va a la cola (respeta el orden venta -> anulación).
   - Venta ya existente en el servidor (duplicado) = ya estaba subida -> se da por buena.
============================================================================================ */
/* Datos locales SEPARADOS POR CUENTA: si en un mismo equipo entra otra cuenta,
   no ve ni sube nada de la anterior. */
let SCOPE = "";
export const scopedKey = (base) => (SCOPE ? base + "__" + SCOPE : base);
export function setUserScope(uid) {
  if (!uid || SCOPE === uid) return;
  SCOPE = uid;
  // Datos antiguos sin cuenta asignada (versiones previas): pasan a la primera cuenta que entra
  try {
    if (!localStorage.getItem("ticketera_legacy_owner")) {
      localStorage.setItem("ticketera_legacy_owner", uid);
      ["ticketera_pending", "ticketera_failed", "ticketera_last_backup", "ticketera_snapshot"].forEach(b => {
        const v = localStorage.getItem(b);
        if (v != null && localStorage.getItem(scopedKey(b)) == null) localStorage.setItem(scopedKey(b), v);
        localStorage.removeItem(b);
      });
    }
  } catch {}
}
const QKEY = "ticketera_pending";
const loadQ = () => { try { const q = JSON.parse(localStorage.getItem(scopedKey(QKEY)) || "[]"); return Array.isArray(q) ? q : []; } catch { return []; } };
const saveQ = (q) => { try { localStorage.setItem(scopedKey(QKEY), JSON.stringify(q)); } catch (e) { console.error("No se pudo guardar la cola", e); } };
const newQid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random());
const enqueue = (item) => { const q = loadQ(); q.push({ ...item, qid: item.qid || newQid() }); saveQ(q); };
const removeQids = (ids) => { if (!ids.length) return; const set = new Set(ids); saveQ(loadQ().filter(it => !set.has(it.qid))); };
export const pendingCount = () => loadQ().length;

// Identificadores de ventas y anulaciones aún sin subir (para no "perderlas" de la pantalla)
export function pendingSaleUuids() { const s = new Set(); loadQ().forEach(it => { if (it.op === "vender") (it.args?.p_client_uuids || []).forEach(u => s.add(u)); }); return s; }
// Gastos de caja aún sin subir (registrados en este equipo) y anulaciones de gasto pendientes
export function pendingGastos() { return loadQ().filter(it => it.op === "gasto").map(it => ({ tipo: it.tipo === "entrada" ? "entrada" : "gasto", id: it.id, eventId: it.evento, puntoId: it.punto, importe: Number(it.importe), concepto: it.concepto || "", categoria: it.categoria || "", crmGastoId: it.crmGastoId || null, por: it.por || "", ts: new Date(it.fecha).getTime(), voided: false, closureId: null, synced: false })); }
export function pendingGastoVoids() { const s = new Set(); loadQ().forEach(it => { if (it.op === "anularGasto") s.add(it.id); }); return s; }
// Ventas aún sin subir reconstruidas desde la cola (si se recarga la página sin internet, siguen contando en pantalla)
export function pendingSales() {
  const out = [];
  loadQ().forEach(it => {
    if (it.op !== "vender" || !it.args) return;
    const a = it.args, uu = a.p_client_uuids || [], cc = a.p_codigos || [];
    const pago = a.p_metodo || null, inv = /^invitacion/.test(pago || "");
    const ts = it.fecha ? new Date(it.fecha).getTime() : Date.now();
    uu.forEach((u, i) => out.push({ id: u, clientUuid: u, code: cc[i] || null, num: null, eventId: a.p_evento, puntoId: a.p_punto, productId: a.p_producto, name: a.p_nombre, price: Number(a.p_precio) || 0, ts: ts + i, voided: false, closureId: null, operario: a.p_operario, pago, invite: inv, inviteValue: inv ? (Number(String(pago).split(":")[1]) || 0) : 0, entregado: i === 0 ? a.p_entregado ?? null : null, cambio: i === 0 ? a.p_cambio ?? null : null, synced: false }));
  });
  return out;
}
export function pendingVoidUuids() { const s = new Set(); loadQ().forEach(it => { if (it.op === "anularVenta") s.add(it.clientUuid); }); return s; }

const isDuplicate = (err) => err && (err.code === "23505" || /duplicate key/i.test(err.message || ""));

async function runItem(it) {
  if (it.op === "vender") {
    const { error } = await supabase.rpc("ticket_vender", it.args);
    if (error && !isDuplicate(error)) throw error;          // duplicado = ya estaba subida
  }
  else if (it.op === "anularUltima") { const { error } = await supabase.rpc("ticket_anular_ultima", { p_evento: it.evento, p_punto: it.punto, p_por: it.por }); if (error) throw error; }
  else if (it.op === "anularVenta") { const { error } = await supabase.from("ticket_ventas").update({ anulada: true, anulada_en: new Date().toISOString(), anulada_por: it.por }).eq("client_uuid", it.clientUuid); if (error) throw error; }
  else if (it.op === "cerrarZ") { const { error } = await supabase.rpc("ticket_cerrar_z", { p_evento: it.evento, p_punto: it.punto, p_por: it.por, p_contado: it.contado ?? null }); if (error) throw error; }
  else if (it.op === "backup") {
    const { error } = await supabase.from("ticket_backups").insert({ id: it.id, evento_id: it.evento, dispositivo: it.dispositivo, tomado_en: it.tomado_en, datos: it.datos });
    if (error && !isDuplicate(error)) throw error;          // ya subida = correcta
    try { localStorage.setItem(scopedKey("ticketera_last_backup"), it.tomado_en); } catch {}
  }
  else if (it.op === "gasto") {
    let { error } = await supabase.from("ticket_gastos").insert({ id: it.id, tipo: it.tipo === "entrada" ? "entrada" : "gasto", evento_id: it.evento, punto_id: it.punto, importe: it.importe, concepto: it.concepto || "", ...(it.categoria ? { categoria: String(it.categoria).slice(0, 40) } : {}), ...(it.crmGastoId ? { crm_gasto_id: it.crmGastoId } : {}), registrado_por: it.por || null, creado_en: it.fecha });
    // Si la base de datos aún no conoce el enlace con el CRM, el gasto se guarda igual (nunca se pierde dinero del cierre)
    if (error && it.crmGastoId && /crm_gasto_id/i.test(error.message || "")) ({ error } = await supabase.from("ticket_gastos").insert({ id: it.id, tipo: "gasto", evento_id: it.evento, punto_id: it.punto, importe: it.importe, concepto: it.concepto || "", ...(it.categoria ? { categoria: String(it.categoria).slice(0, 40) } : {}), registrado_por: it.por || null, creado_en: it.fecha }));
    if (error && !isDuplicate(error)) throw error;          // ya subido = correcto
  }
  else if (it.op === "anularGasto") {
    const { error } = await supabase.from("ticket_gastos").update({ anulado: true }).eq("id", it.id);
    if (error) throw error;
  }
  else if (it.op === "abrirBarra") {
    const { error } = await supabase.from("ticket_puntos").update({ estado: "abierta", abierta_en: it.fecha, abierta_por: it.por || null, fondo: it.fondo, fondo_en: it.fondo != null ? it.fecha : null, fondo_por: it.fondo != null ? (it.por || null) : null }).eq("id", it.punto);
    if (error) throw error;
  }
  else if (it.op === "pasarPrueba") {
    const { error } = await supabase.from("ticket_puntos").update({ estado: "prueba", fondo: null, fondo_en: null, fondo_por: null }).eq("id", it.punto);
    if (error) throw error;
  }
  else if (it.op === "resGuardar") {
    const { error } = await supabase.from("ticket_reservados").upsert(it.row, { onConflict: "id" });
    if (error) throw error;
  }
  else if (it.op === "resBorrar") {
    const { error } = await supabase.from("ticket_reservados").delete().eq("id", it.id);
    if (error) throw error;
  }
  else if (it.op === "resVenta") {
    const { error } = await supabase.from("ticket_reservado_ventas").insert(it.row);
    if (error && !isDuplicate(error)) throw error;          // ya subida = correcta
  }
  else if (it.op === "setFondo") {
    const { error } = await supabase.from("ticket_puntos").update({ fondo: it.fondo, fondo_en: it.fecha, fondo_por: it.por }).eq("id", it.punto);
    if (error) throw error;
  }
}

// Error del servidor (dato rechazado) vs error de red (sin conexión): solo los primeros cuentan intentos
const isServerError = (err) => !!(err && err.code && err.code !== "PGRST301" && !/fetch|network|timeout/i.test(err.message || ""));
const FKEY = "ticketera_failed";
export const failedCount = () => { try { return (JSON.parse(localStorage.getItem(scopedKey(FKEY)) || "[]") || []).length; } catch { return 0; } };
const addFailed = (it, err) => { try { const f = JSON.parse(localStorage.getItem(scopedKey(FKEY)) || "[]"); f.push({ ...it, error: String(err?.message || err), failedAt: new Date().toISOString() }); localStorage.setItem(scopedKey(FKEY), JSON.stringify(f.slice(-500))); } catch {} };

// Candado: una sola sincronización a la vez
let syncing = null;
export function syncPending() {
  if (syncing) return syncing;
  syncing = (async () => {
    const q = loadQ(); const done = [];
    try {
      for (const it of q) {
        if (!it.qid) it.qid = newQid();
        try { await runItem(it); done.push(it.qid); }
        catch (err) {
          if (isServerError(err)) {
            const tries = (it.tries || 0) + 1;
            if (tries >= 5) { addFailed(it, err); done.push(it.qid); continue; }   // no bloquea la cola
            const cur = loadQ(); const i = cur.findIndex(x => x.qid === it.qid); if (i > -1) { cur[i].tries = tries; saveQ(cur); }
          }
          break;                                            // orden estricto: paramos aquí
        }
      }
    } finally {
      removeQids(done);
    }
    return { synced: done.length, remaining: loadQ().length };
  })();
  return syncing.finally(() => { syncing = null; });
}

// Si hay un fondo de este punto aún sin subir, intenta subir la cola ya (antes del Z)
async function flushFondoDePunto(puntoId) {
  if (!loadQ().some(it => it.op === "setFondo" && it.punto === puntoId)) return;
  await syncPending();
}

async function doOrQueue(item) {
  // PRIMERO se guarda en el equipo y DESPUÉS se sube: si se corta el wifi, se apaga
  // el ordenador o el wifi está "conectado pero sin internet", la venta nunca se pierde.
  const it = { ...item, qid: item.qid || newQid() };
  enqueue(it);
  if (!navigator.onLine) return { offline: true };
  const inQ = () => loadQ().some(x => x.qid === it.qid);
  const until = Date.now() + 6000;
  // Si ya había una subida en marcha (varias ventas seguidas), repetimos hasta que entre la nuestra
  while (inQ() && navigator.onLine && Date.now() < until) {
    const r = await Promise.race([syncPending().catch(() => null), new Promise(res => setTimeout(() => res(null), until - Date.now()))]);
    if (!r || !r.synced) break;                            // sin internet de verdad: se queda guardada
  }
  return { offline: inQ() };
}

// folios y clientUuids los genera la App (para que el ticket optimista y la BD coincidan)
export function vender({ eventoId, puntoId, producto, qty, operario, folios, clientUuids, pago = null, entregado = null, cambio = null }) {
  return doOrQueue({ op: "vender", fecha: new Date().toISOString(), args: { p_evento: eventoId, p_punto: puntoId, p_producto: producto.id, p_nombre: producto.name, p_precio: producto.price, p_qty: qty, p_codigos: folios, p_operario: operario, p_client_uuids: clientUuids, p_metodo: pago, p_entregado: entregado, p_cambio: cambio } });
}
export function anularUltima(eventoId, puntoId, por) { return doOrQueue({ op: "anularUltima", evento: eventoId, punto: puntoId, por }); }
export function anularVenta(clientUuid, por) { return doOrQueue({ op: "anularVenta", clientUuid, por }); }

// Gasto / retirada de caja: dinero que SALE del cajón. No cambia la facturación; se descuenta en el arqueo.
// Offline-safe: se guarda primero en el equipo y sube solo (el id lo pone la app: nunca se duplica).
export function registrarGasto({ id, tipo = "gasto", eventoId, puntoId, importe, concepto, categoria, crmGastoId, por }) {
  return doOrQueue({ op: "gasto", id, tipo: tipo === "entrada" ? "entrada" : "gasto", evento: eventoId, punto: puntoId, importe, concepto, categoria: categoria || "", ...(crmGastoId && tipo !== "entrada" ? { crmGastoId } : {}), por, fecha: new Date().toISOString() });
}
// Pagos previstos en el CRM para este evento (para liquidarlos desde la caja). Se guardan en el equipo para verlos sin conexión.
export async function loadPrevistosCRM(eventoId) {
  const key = scopedKey("tixfast_previstos_" + eventoId);
  try {
    // Sin la migración que enlaza caja y CRM, la lista no se muestra (así nunca se paga dos veces lo mismo)
    const probe = await supabase.from("ticket_gastos").select("crm_gasto_id").limit(1);
    if (probe.error) { if (/crm_gasto_id/i.test(probe.error.message || "")) { try { localStorage.removeItem(key); } catch {} return []; } throw probe.error; }
    const { data, error } = await supabase.from("ticket_crm_gastos").select("id, padre_id, tipo, categoria, concepto, proveedor, previsto, real, estado, personas, horas, precio_hora").eq("evento_id", eventoId).order("creado_en", { ascending: true });
    if (error) throw error;
    const filas = (data || []).map(g => ({ id: g.id, padreId: g.padre_id || null, tipo: g.tipo, categoria: g.categoria || "", concepto: g.concepto || "", proveedor: g.proveedor || "", previsto: g.previsto != null ? Number(g.previsto) : null, real: g.real != null ? Number(g.real) : null, estado: g.estado || "previsto" }));
    try { localStorage.setItem(key, JSON.stringify(filas)); } catch {}
    return filas;
  } catch { try { return JSON.parse(localStorage.getItem(key) || "[]") || []; } catch { return []; } }
}
export function anularGasto(id, eventoId, por) { return doOrQueue({ op: "anularGasto", id, evento: eventoId, por }); }

// Revertir la última Z de una barra (solo con conexión y con todo subido): sus ventas y gastos vuelven al turno abierto
export async function revertirZ(cierreId, por) {
  if (!navigator.onLine) throw Object.assign(new Error("Sin conexión: para revertir una Z hace falta internet"), { mostrar: true });
  if (pendingCount() > 0) { await syncPending().catch(() => {}); if (pendingCount() > 0) throw Object.assign(new Error("Hay operaciones de este equipo sin subir: espera a que se suban y vuelve a intentarlo"), { mostrar: true }); }
  const { data, error } = await supabase.rpc("ticket_revertir_z", { p_cierre: cierreId, p_por: por || "Admin" });
  if (error) throw Object.assign(new Error(/function|schema cache/i.test(error.message || "") ? "Falta activar «revertir Z» en la base de datos" : (error.message || "No se ha podido revertir").replace(/^.*?ERROR:\s*/, "")), { mostrar: true });
  return data;
}
export async function cerrarZ(eventoId, puntoId, por, contado = null) {
  if (navigator.onLine) {
    try { await flushFondoDePunto(puntoId); }
    catch { /* si no sube el fondo, seguimos: el cierre se encolará igualmente si algo falla */ }
  }
  return doOrQueue({ op: "cerrarZ", evento: eventoId, punto: puntoId, por, contado });
}


/* ===================== ESTADO DE LA BARRA: prueba -> venta abierta -> cerrada (Z) ===================== */
// Iniciar la venta: la barra deja el modo prueba y (si se pide) declara el fondo del cajón. Offline-safe.
export function abrirBarra(puntoId, eventoId, fondo, por) {
  return doOrQueue({ op: "abrirBarra", punto: puntoId, evento: eventoId, fondo: fondo ?? null, por, fecha: new Date().toISOString() });
}
// Volver a modo prueba (solo admin): reabre una barra cerrada o deshace un inicio por error.
export function pasarPrueba(puntoId, eventoId, por) { return doOrQueue({ op: "pasarPrueba", punto: puntoId, evento: eventoId, por }); }
// Estado pendiente de subir de una barra (para que la pantalla no "vuelva atrás" antes de sincronizar)
export function pendingPunto(puntoId) {
  let patch = null;
  loadQ().forEach(it => {
    if (it.op === "abrirBarra" && it.punto === puntoId) patch = { estado: "abierta", fondo: it.fondo ?? null, abiertaEn: it.fecha, abiertaPor: it.por };
    else if (it.op === "pasarPrueba" && it.punto === puntoId) patch = { estado: "prueba", fondo: null };
    else if (it.op === "cerrarZ" && it.punto === puntoId) patch = { estado: "cerrada", fondo: null };
    else if (it.op === "setFondo" && it.punto === puntoId) patch = { ...(patch || {}), fondo: it.fondo };
  });
  return patch;
}

/* ===================== FONDO DE CAJA ===================== */
// Declara el fondo inicial del cajón de una barra (obligatorio para abrir).
// Offline-safe: si no hay red, se encola como todo lo demás y se sincroniza solo.
// Solo puede haber UN fondo pendiente por punto: si se declara dos veces sin red, se sustituye.
export function setFondo(puntoId, fondo, por) {
  const q = loadQ().filter(it => !(it.op === "setFondo" && it.punto === puntoId));
  saveQ(q);
  return doOrQueue({ op: "setFondo", punto: puntoId, fondo, por, fecha: new Date().toISOString() });
}
// El fondo pendiente de subir para este punto, si lo hay (para no perderlo de vista en pantalla)
export function pendingFondo(puntoId) {
  const it = loadQ().find(x => x.op === "setFondo" && x.punto === puntoId);
  return it ? it.fondo : null;
}

// Borra de la cola lo pendiente de un evento (para que un reset no "resucite" ventas de prueba)
export function dropPendingForEvent(eventId, puntoIds = []) {
  const pts = new Set(puntoIds);
  saveQ(loadQ().filter(it => !((it.args && it.args.p_evento === eventId) || it.evento === eventId || (it.punto && pts.has(it.punto)) || (it.op === "resVenta" && it.row?.evento_id === eventId))));
}

/* ===================== COPIAS DE SEGURIDAD ===================== */
// Identificador estable de este equipo (para saber de qué ordenador vino cada copia)
export function deviceName() {
  let id = null;
  try { id = localStorage.getItem("ticketera_device_id"); if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())).slice(0, 4).toUpperCase(); localStorage.setItem("ticketera_device_id", id); } } catch { id = "????"; }
  return "Equipo " + id;
}
export const lastBackupAt = () => { try { return localStorage.getItem(scopedKey("ticketera_last_backup")); } catch { return null; } };

// Foto del estado con su hora. Con red sube al momento; sin red se guarda y sube al volver.
export function backupSnapshot(eventId, datos) {
  const tomado_en = new Date().toISOString();
  const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
  return doOrQueue({ op: "backup", id, evento: eventId, dispositivo: deviceName(), tomado_en, datos });
}

export async function loadBackups(eventId, limit = 48) {
  const { data, error } = await supabase.from("ticket_backups").select("*").eq("evento_id", eventId).order("tomado_en", { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

// Copia de emergencia en archivo (para pasar lo pendiente a otro ordenador sin internet)
export function exportPending() {
  return JSON.stringify({ app: "ticketera", version: 1, dispositivo: deviceName(), exportado: new Date().toISOString(), cola: loadQ() }, null, 1);
}
const OPS_OK = new Set(["vender", "anularUltima", "anularVenta", "cerrarZ", "backup", "setFondo", "gasto", "anularGasto", "abrirBarra", "pasarPrueba", "resGuardar", "resBorrar", "resVenta"]);
export function importPending(text) {
  if (typeof text !== "string" || text.length > 5 * 1024 * 1024) throw new Error("Archivo demasiado grande");
  const obj = JSON.parse(text);
  if (!obj || obj.app !== "ticketera" || !Array.isArray(obj.cola)) throw new Error("Archivo no válido");
  const q = loadQ(); const have = new Set(q.map(it => it.qid));
  let added = 0;
  for (const it of obj.cola) {
    if (!it || typeof it !== "object" || !OPS_OK.has(it.op)) continue;   // solo operaciones conocidas
    const item = { ...it, qid: it.qid || newQid() };
    if (have.has(item.qid)) continue;                     // ya estaba: no se duplica
    q.push(item); have.add(item.qid); added++;
  }
  saveQ(q);
  return added;   // las ventas llevan su identificador único: el servidor nunca las duplica
}

/* ===================== RESET ESTADÍSTICAS ===================== */
// Borra TODAS las ventas y cierres de un evento (irreversible). Solo admin.
export async function resetStats(eventId) {
  const a = await supabase.from("ticket_ventas").delete().eq("evento_id", eventId);
  if (a.error) throw a.error;
  await supabase.from("ticket_gastos").delete().eq("evento_id", eventId);
  const b = await supabase.from("ticket_cierres").delete().eq("evento_id", eventId);
  if (b.error) throw b.error;
  await supabase.from("ticket_backups").delete().eq("evento_id", eventId);
  await supabase.rpc("ticket_canjes_reset", { p_evento: eventId });   // canjes de QR de prueba
  // Reservados: se borra lo vendido de prueba; las reservas apuntadas se conservan (los que «llegaron» vuelven a reservado o libre)
  await supabase.from("ticket_reservado_ventas").delete().eq("evento_id", eventId);
  await supabase.from("ticket_reservados").update({ estado: "reservado", llegada_en: null }).eq("evento_id", eventId).eq("estado", "llegado").not("cliente", "is", null);
  await supabase.from("ticket_reservados").update({ estado: "libre", llegada_en: null }).eq("evento_id", eventId).eq("estado", "llegado");
  // Las barras vuelven a modo prueba, sin fondo (listas para el evento real)
  await supabase.from("ticket_puntos").update({ estado: "prueba", fondo: null, fondo_en: null, fondo_por: null, abierta_en: null, abierta_por: null, cerrada_en: null, cerrada_por: null }).eq("evento_id", eventId);
  return true;
}

/* ===================== REALTIME ===================== */
// Cambios de configuración hechos desde OTRO equipo de la misma cuenta (RLS: solo llegan los de esta cuenta)
export function subscribeConfig(onChange) {
  const ch = supabase.channel("cfg-" + Math.random().toString(36).slice(2))
    .on("postgres_changes", { event: "*", schema: "public", table: "ticket_eventos" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "ticket_puntos" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "ticket_productos" }, onChange)
    .subscribe();
  return () => supabase.removeChannel(ch);
}
export function subscribeEvento(eventoId, onChange) {
  const ch = supabase.channel("ev-" + eventoId)
    .on("postgres_changes", { event: "*", schema: "public", table: "ticket_ventas", filter: `evento_id=eq.${eventoId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "ticket_cierres", filter: `evento_id=eq.${eventoId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "ticket_gastos", filter: `evento_id=eq.${eventoId}` }, onChange)
    .subscribe();
  return () => supabase.removeChannel(ch);
}

/* ===================== RESERVADOS VIP =====================
   Cada reservado (estado, cliente, señal…) y el enlace venta → reservado.
   Todo pasa por la misma cola que las ventas: sin internet se guarda en el equipo y sube solo. */
const resFromDb = (r) => ({ id: r.id, eventId: r.evento_id, nombre: r.nombre, tamano: r.tamano, personas: r.personas, orden: r.orden ?? 0, estado: r.estado, cliente: r.cliente || "", telefono: r.telefono || "", nota: r.nota || "", tarifaId: r.tarifa_id || "", senal: Number(r.senal || 0), senalMetodo: r.senal_metodo || "", promotorId: r.promotor_id || "", senalSocio: r.senal_socio || "", llegadaEn: r.llegada_en, actualizadoEn: r.actualizado_en, pedido: r.pedido && typeof r.pedido === "object" ? r.pedido : null });
// Detalle de la reserva, limpio y acotado (lo que cabe en la columna «pedido»)
const pedidoToDb = (p) => {
  if (!p || typeof p !== "object") return null;
  const n2 = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.round(Number(v) * 100) / 100));
  const botellas = (Array.isArray(p.botellas) ? p.botellas : []).slice(0, 30).map(b => ({ id: String(b.id || "").slice(0, 40), bebida: String(b.bebida || "").trim().slice(0, 60), mezcla: String(b.mezcla || "").trim().slice(0, 60), precio: n2(b.precio) }));
  const personas = p.personas === "" || p.personas == null ? null : Math.max(0, Math.min(500, parseInt(p.personas, 10) || 0));
  const precioModo = ["auto", "botella", "total"].includes(p.precioModo) ? p.precioModo : "auto";
  if (!botellas.length && personas == null && precioModo === "auto") return null;
  return { personas, botellas, precioModo, total: n2(p.total) };
};
const resToDb = (r) => ({ pedido: pedidoToDb(r.pedido), id: r.id, evento_id: r.eventId, nombre: String(r.nombre || "").trim().slice(0, 40) || "R", tamano: r.tamano === "grande" ? "grande" : "pequeno", personas: r.personas === "" || r.personas == null ? null : Math.max(0, Math.min(500, parseInt(r.personas, 10) || 0)), orden: r.orden ?? 0, estado: ["libre", "reservado", "llegado", "novino"].includes(r.estado) ? r.estado : "libre", cliente: String(r.cliente || "").trim().slice(0, 120) || null, telefono: String(r.telefono || "").trim().slice(0, 40) || null, nota: String(r.nota || "").trim().slice(0, 500) || null, tarifa_id: r.tarifaId || null, senal: Math.max(0, Math.round((Number(r.senal) || 0) * 100) / 100), senal_metodo: ["efectivo", "bizum", "transferencia", "tarjeta"].includes(r.senalMetodo) ? r.senalMetodo : null, promotor_id: r.promotorId || null, senal_socio: String(r.senalSocio || "").trim().slice(0, 60) || null, llegada_en: r.llegadaEn || null, actualizado_en: new Date().toISOString() });
const resVentaFromDb = (v) => ({ clientUuid: v.client_uuid, eventId: v.evento_id, reservadoId: v.reservado_id, tipo: v.tipo, itemId: v.item_id || "", nombre: v.nombre || "", botellas: v.botellas || 0, total: Number(v.total || 0), senal: Number(v.senal || 0), ts: new Date(v.creado_en).getTime() });

export async function loadReservados(eventoId) {
  const [a, b] = await Promise.all([
    supabase.from("ticket_reservados").select("*").eq("evento_id", eventoId).order("orden").order("creado_en"),
    fetchAll(() => supabase.from("ticket_reservado_ventas").select("*").eq("evento_id", eventoId).order("creado_en").order("client_uuid")),
  ]);
  if (a.error) throw a.error;
  return { reservados: (a.data || []).map(resFromDb), ventas: b.map(resVentaFromDb) };
}
export function guardarReservado(r) { return doOrQueue({ op: "resGuardar", evento: r.eventId, row: resToDb(r) }); }
export function borrarReservado(r) { return doOrQueue({ op: "resBorrar", evento: r.eventId, id: r.id }); }
export function enlazarVentaReservado(v) {
  return doOrQueue({ op: "resVenta", row: { client_uuid: v.clientUuid, evento_id: v.eventId, reservado_id: v.reservadoId, tipo: v.tipo === "tarifa" ? "tarifa" : "extra", item_id: v.itemId || null, nombre: String(v.nombre || "").slice(0, 120), botellas: Math.max(0, Math.min(100, v.botellas | 0)), total: Math.max(0, Number(v.total) || 0), senal: Math.max(0, Number(v.senal) || 0), creado_en: new Date(v.ts || Date.now()).toISOString() } });
}
// Lo aún sin subir de este equipo (para que la pantalla no «vuelva atrás» antes de sincronizar)
export function pendingReservados(eventoId) {
  const guardar = new Map(), borrar = new Set(), ventas = [];
  loadQ().forEach(it => {
    if (it.op === "resGuardar" && it.row?.evento_id === eventoId) { guardar.set(it.row.id, resFromDb(it.row)); borrar.delete(it.row.id); }
    else if (it.op === "resBorrar" && it.evento === eventoId) { borrar.add(it.id); guardar.delete(it.id); }
    else if (it.op === "resVenta" && it.row?.evento_id === eventoId) ventas.push(resVentaFromDb(it.row));
  });
  return { guardar, borrar, ventas };
}
export function subscribeReservados(eventoId, onChange) {
  const ch = supabase.channel("res-" + eventoId + "-" + Math.random().toString(36).slice(2))   // nombre único: el TPV y el CRM pueden escuchar a la vez
    .on("postgres_changes", { event: "*", schema: "public", table: "ticket_reservados", filter: `evento_id=eq.${eventoId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "ticket_reservado_ventas", filter: `evento_id=eq.${eventoId}` }, onChange)
    .subscribe();
  return () => supabase.removeChannel(ch);
}

/* ===================== PIN / CONTRASEÑA DE ACCESO ===================== */
// Guarda la huella del rol y borra el PIN visible. Necesita internet (si no, no se cambia nada).
export async function guardarAcceso(eventId, rol, huella) {
  if (!["admin", "supervisor"].includes(rol)) throw new Error("rol");
  const { error } = await supabase.from("ticket_eventos").update({ [`pin_${rol}_huella`]: huella, [`pin_${rol}`]: null }).eq("id", eventId);
  if (error) throw error;
  // La copia local (para vender sin internet) también deja de llevar el PIN visible
  try {
    const k = scopedKey("ticketera_snapshot"); const snap = JSON.parse(localStorage.getItem(k) || "null");
    if (snap?.events) { snap.events = snap.events.map(e => e.id === eventId ? { ...e, [`pin_${rol}_huella`]: huella, [`pin_${rol}`]: null } : e); localStorage.setItem(k, JSON.stringify(snap)); }
  } catch {}
}

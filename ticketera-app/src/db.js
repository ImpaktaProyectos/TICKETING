import { supabase, uid } from "./supabase";

/* ===================== MAPEADORES BD <-> UI ===================== */
const prodFromDb = (p) => ({ id: p.id, name: p.nombre, price: Number(p.precio), color: p.color, emoji: p.emoji, soldOut: p.agotado, orden: p.orden ?? 0 });
const byOrden = (a, b) => (a.orden - b.orden) || String(a.creado_en || "").localeCompare(String(b.creado_en || "")) || String(a.id).localeCompare(String(b.id));
const puntoFromDb = (p) => ({ id: p.id, name: p.nombre, archivado: p.archivado, combos: p.combos || [], fondo: p.fondo != null ? Number(p.fondo) : null, fondoEn: p.fondo_en, fondoPor: p.fondo_por, sortMode: p.orden_modo === "ventas" ? "ventas" : "manual", products: (p.ticket_productos || []).slice().sort(byOrden).map(prodFromDb) });
const evFromDb = (e) => ({
  id: e.id, name: e.nombre, date: e.fecha, venue: e.recinto || "", template: e.plantilla, paper: e.papel,
  footer: e.pie || "", logo: e.logo_url || "", showEventName: e.mostrar_evento, showDate: e.mostrar_fecha,
  showTime: e.mostrar_hora, showPrice: e.mostrar_precio, anularPin: e.anular_pin,
  closed: !!e.cerrada, startsAt: e.inicio || "", advanced: !!e.venta_avanzada, changeHelp: e.ayuda_cambio !== false,
  style: e.ticket_style || {},
  pin_admin: e.pin_admin, pin_supervisor: e.pin_supervisor,
  puntos: (e.ticket_puntos || []).map(puntoFromDb),
});
const saleFromDb = (s) => ({ id: s.id, clientUuid: s.client_uuid, code: s.codigo, num: s.numero, eventId: s.evento_id, puntoId: s.punto_id, productId: s.producto_id, name: s.nombre, price: Number(s.precio), ts: new Date(s.creado_en).getTime(), voided: s.anulada, closureId: s.closure_id, operario: s.operario, pago: s.metodo_pago, entregado: s.entregado != null ? Number(s.entregado) : null, cambio: s.cambio != null ? Number(s.cambio) : null, synced: true });
const closureFromDb = (c) => ({ id: c.id, eventId: c.evento_id, puntoId: c.punto_id, count: c.tickets, revenue: Number(c.facturacion), voids: c.anulaciones, lines: c.detalle || [], efectivo: Number(c.efectivo || 0), tarjeta: Number(c.tarjeta || 0), fondo: Number(c.fondo || 0), contado: c.contado != null ? Number(c.contado) : null, ts: new Date(c.creado_en).getTime() });

const evToDb = (e) => ({ id: e.id, nombre: e.name, fecha: e.date, recinto: e.venue, plantilla: e.template, papel: e.paper, pie: e.footer, logo_url: e.logo, mostrar_evento: e.showEventName, mostrar_fecha: e.showDate, mostrar_hora: e.showTime, mostrar_precio: e.showPrice, anular_pin: e.anularPin, cerrada: !!e.closed, inicio: e.startsAt || null, venta_avanzada: !!e.advanced, ayuda_cambio: e.changeHelp !== false, ticket_style: e.style || {}, pin_admin: e.pin_admin, pin_supervisor: e.pin_supervisor });
const evPatchToDb = (patch) => {
  const m = { name: "nombre", date: "fecha", venue: "recinto", template: "plantilla", paper: "papel", footer: "pie", logo: "logo_url", showEventName: "mostrar_evento", showDate: "mostrar_fecha", showTime: "mostrar_hora", showPrice: "mostrar_precio", anularPin: "anular_pin", closed: "cerrada", startsAt: "inicio", advanced: "venta_avanzada", changeHelp: "ayuda_cambio", style: "ticket_style", pin_admin: "pin_admin", pin_supervisor: "pin_supervisor" };
  const out = {}; for (const k in patch) if (m[k]) out[m[k]] = patch[k]; return out;
};
const prodToDb = (puntoId, p) => ({ id: p.id, punto_id: puntoId, nombre: p.name, precio: p.price, color: p.color, emoji: p.emoji, agotado: p.soldOut, orden: p.orden ?? 0 });
const prodPatchToDb = (patch) => { const m = { name: "nombre", price: "precio", color: "color", emoji: "emoji", soldOut: "agotado", orden: "orden" }; const o = {}; for (const k in patch) if (m[k]) o[m[k]] = patch[k]; return o; };

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
  let sales = [], closures = [];
  if (eventIds.length) {
    const [v, c] = await Promise.all([
      fetchAll(() => supabase.from("ticket_ventas").select("*").in("evento_id", eventIds).order("creado_en", { ascending: true }).order("id", { ascending: true })),
      fetchAll(() => supabase.from("ticket_cierres").select("*").in("evento_id", eventIds).order("creado_en", { ascending: true }).order("id", { ascending: true })),
    ]);
    sales = v.map(saleFromDb);
    closures = c.map(closureFromDb);
  }
  const events = (eventos || []).map(evFromDb);
  return { events, sales, closures };
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
        await supabase.from("ticket_eventos").insert(evToDb(action.event));
        if (action.event.puntos?.length) await supabase.from("ticket_puntos").insert(action.event.puntos.map(p => ({ id: p.id, evento_id: action.event.id, nombre: p.name, archivado: !!p.archivado })));
        break;
      }
      case "UPDATE_EVENT": await supabase.from("ticket_eventos").update(evPatchToDb(action.patch)).eq("id", action.id); break;
      case "ADD_PUNTO": await supabase.from("ticket_puntos").insert({ id: action.punto.id, evento_id: action.eventId, nombre: action.punto.name, archivado: false }); break;
      case "ARCHIVE_PUNTO": await supabase.from("ticket_puntos").update({ archivado: action.value }).eq("id", action.puntoId); break;
      case "UPDATE_PUNTO": { const m = { name: "nombre", archivado: "archivado", combos: "combos", sortMode: "orden_modo" }; const o = {}; for (const k in action.patch) if (m[k]) o[m[k]] = action.patch[k]; await supabase.from("ticket_puntos").update(o).eq("id", action.puntoId); break; }
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
  // Sin red, o con cosas pendientes delante: a la cola (respeta el orden)
  if (!navigator.onLine || loadQ().length > 0) {
    enqueue(item);
    if (navigator.onLine) syncPending();                   // intenta vaciarla ya
    return { offline: true };
  }
  try { await runItem(item); return { offline: false }; }
  catch { enqueue(item); return { offline: true }; }
}

// folios y clientUuids los genera la App (para que el ticket optimista y la BD coincidan)
export function vender({ eventoId, puntoId, producto, qty, operario, folios, clientUuids, pago = null, entregado = null, cambio = null }) {
  return doOrQueue({ op: "vender", args: { p_evento: eventoId, p_punto: puntoId, p_producto: producto.id, p_nombre: producto.name, p_precio: producto.price, p_qty: qty, p_codigos: folios, p_operario: operario, p_client_uuids: clientUuids, p_metodo: pago, p_entregado: entregado, p_cambio: cambio } });
}
export function anularUltima(eventoId, puntoId, por) { return doOrQueue({ op: "anularUltima", evento: eventoId, punto: puntoId, por }); }
export function anularVenta(clientUuid, por) { return doOrQueue({ op: "anularVenta", clientUuid, por }); }

export async function cerrarZ(eventoId, puntoId, por, contado = null) {
  if (navigator.onLine) {
    try { await flushFondoDePunto(puntoId); }
    catch { /* si no sube el fondo, seguimos: el cierre se encolará igualmente si algo falla */ }
  }
  return doOrQueue({ op: "cerrarZ", evento: eventoId, punto: puntoId, por, contado });
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
  saveQ(loadQ().filter(it => !((it.args && it.args.p_evento === eventId) || it.evento === eventId || (it.op === "setFondo" && pts.has(it.punto)))));
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
export function importPending(text) {
  const obj = JSON.parse(text);
  if (!obj || obj.app !== "ticketera" || !Array.isArray(obj.cola)) throw new Error("Archivo no válido");
  const q = loadQ(); const have = new Set(q.map(it => it.qid));
  let added = 0;
  for (const it of obj.cola) {
    if (!it || !it.op) continue;
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
  const b = await supabase.from("ticket_cierres").delete().eq("evento_id", eventId);
  if (b.error) throw b.error;
  await supabase.from("ticket_backups").delete().eq("evento_id", eventId);
  return true;
}

/* ===================== REALTIME ===================== */
export function subscribeEvento(eventoId, onChange) {
  const ch = supabase.channel("ev-" + eventoId)
    .on("postgres_changes", { event: "*", schema: "public", table: "ticket_ventas", filter: `evento_id=eq.${eventoId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "ticket_cierres", filter: `evento_id=eq.${eventoId}` }, onChange)
    .subscribe();
  return () => supabase.removeChannel(ch);
}

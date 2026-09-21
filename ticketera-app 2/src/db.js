import { supabase, uid } from "./supabase";

/* ===================== MAPEADORES BD <-> UI ===================== */
const prodFromDb = (p) => ({ id: p.id, name: p.nombre, price: Number(p.precio), color: p.color, emoji: p.emoji, soldOut: p.agotado });
const puntoFromDb = (p) => ({ id: p.id, name: p.nombre, archivado: p.archivado, combos: p.combos || [], products: (p.ticket_productos || []).sort((a, b) => a.orden - b.orden).map(prodFromDb) });
const evFromDb = (e) => ({
  id: e.id, name: e.nombre, date: e.fecha, venue: e.recinto || "", template: e.plantilla, paper: e.papel,
  footer: e.pie || "", logo: e.logo_url || "", showEventName: e.mostrar_evento, showDate: e.mostrar_fecha,
  showTime: e.mostrar_hora, showPrice: e.mostrar_precio, anularPin: e.anular_pin,
  style: e.ticket_style || {},
  pin_admin: e.pin_admin, pin_supervisor: e.pin_supervisor,
  puntos: (e.ticket_puntos || []).map(puntoFromDb),
});
const saleFromDb = (s) => ({ id: s.id, clientUuid: s.client_uuid, code: s.codigo, num: s.numero, eventId: s.evento_id, puntoId: s.punto_id, productId: s.producto_id, name: s.nombre, price: Number(s.precio), ts: new Date(s.creado_en).getTime(), voided: s.anulada, closureId: s.closure_id, operario: s.operario, synced: true });
const closureFromDb = (c) => ({ id: c.id, eventId: c.evento_id, puntoId: c.punto_id, count: c.tickets, revenue: Number(c.facturacion), voids: c.anulaciones, lines: c.detalle || [], ts: new Date(c.creado_en).getTime() });

const evToDb = (e) => ({ id: e.id, nombre: e.name, fecha: e.date, recinto: e.venue, plantilla: e.template, papel: e.paper, pie: e.footer, logo_url: e.logo, mostrar_evento: e.showEventName, mostrar_fecha: e.showDate, mostrar_hora: e.showTime, mostrar_precio: e.showPrice, anular_pin: e.anularPin, ticket_style: e.style || {}, pin_admin: e.pin_admin, pin_supervisor: e.pin_supervisor });
const evPatchToDb = (patch) => {
  const m = { name: "nombre", date: "fecha", venue: "recinto", template: "plantilla", paper: "papel", footer: "pie", logo: "logo_url", showEventName: "mostrar_evento", showDate: "mostrar_fecha", showTime: "mostrar_hora", showPrice: "mostrar_precio", anularPin: "anular_pin", style: "ticket_style", pin_admin: "pin_admin", pin_supervisor: "pin_supervisor" };
  const out = {}; for (const k in patch) if (m[k]) out[m[k]] = patch[k]; return out;
};
const prodToDb = (puntoId, p) => ({ id: p.id, punto_id: puntoId, nombre: p.name, precio: p.price, color: p.color, emoji: p.emoji, agotado: p.soldOut });
const prodPatchToDb = (patch) => { const m = { name: "nombre", price: "precio", color: "color", emoji: "emoji", soldOut: "agotado" }; const o = {}; for (const k in patch) if (m[k]) o[m[k]] = patch[k]; return o; };

/* ===================== CARGA INICIAL ===================== */
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
      supabase.from("ticket_ventas").select("*").in("evento_id", eventIds),
      supabase.from("ticket_cierres").select("*").in("evento_id", eventIds),
    ]);
    sales = (v.data || []).map(saleFromDb);
    closures = (c.data || []).map(closureFromDb);
  }
  const events = (eventos || []).map(evFromDb);
  return { events, sales, closures };
}

export async function loadSales(eventId) {
  const { data } = await supabase.from("ticket_ventas").select("*").eq("evento_id", eventId);
  return (data || []).map(saleFromDb);
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
      case "UPDATE_PUNTO": { const m = { name: "nombre", archivado: "archivado", combos: "combos" }; const o = {}; for (const k in action.patch) if (m[k]) o[m[k]] = action.patch[k]; await supabase.from("ticket_puntos").update(o).eq("id", action.puntoId); break; }
      case "DELETE_PUNTO": await supabase.from("ticket_puntos").delete().eq("id", action.puntoId); break;
      case "ADD_PRODUCT": await supabase.from("ticket_productos").insert(prodToDb(action.puntoId, action.product)); break;
      case "UPDATE_PRODUCT": await supabase.from("ticket_productos").update(prodPatchToDb(action.patch)).eq("id", action.productId); break;
      case "DELETE_PRODUCT": await supabase.from("ticket_productos").delete().eq("id", action.productId); break;
      case "SET_ADMIN_PIN": if (ctx.eventId) await supabase.from("ticket_eventos").update({ pin_admin: action.pin }).eq("id", ctx.eventId); break;
      case "SET_SUPERVISOR_PIN": if (ctx.eventId) await supabase.from("ticket_eventos").update({ pin_supervisor: action.pin }).eq("id", ctx.eventId); break;
      default: break;
    }
  } catch (e) { console.error("persist", action.type, e); }
}

/* ===================== COLA OFFLINE (ventas, anulaciones y cierres) ===================== */
const QKEY = "ticketera_pending";
const loadQ = () => { try { return JSON.parse(localStorage.getItem(QKEY) || "[]"); } catch { return []; } };
const saveQ = (q) => localStorage.setItem(QKEY, JSON.stringify(q));
const enqueue = (item) => { const q = loadQ(); q.push(item); saveQ(q); };
export const pendingCount = () => loadQ().length;

async function runItem(it) {
  if (it.op === "vender") { const { error } = await supabase.rpc("ticket_vender", it.args); if (error) throw error; }
  else if (it.op === "anularUltima") { const { error } = await supabase.rpc("ticket_anular_ultima", { p_evento: it.evento, p_punto: it.punto, p_por: it.por }); if (error) throw error; }
  else if (it.op === "anularVenta") { const { error } = await supabase.from("ticket_ventas").update({ anulada: true, anulada_en: new Date().toISOString(), anulada_por: it.por }).eq("client_uuid", it.clientUuid); if (error) throw error; }
  else if (it.op === "cerrarZ") { const { error } = await supabase.rpc("ticket_cerrar_z", { p_evento: it.evento, p_punto: it.punto, p_por: it.por }); if (error) throw error; }
}

async function doOrQueue(item) {
  if (!navigator.onLine) { enqueue(item); return { offline: true }; }
  try { await runItem(item); return { offline: false }; }
  catch { enqueue(item); return { offline: true }; }
}

// folios y clientUuids los genera la App (para que el ticket optimista y la BD coincidan)
export function vender({ eventoId, puntoId, producto, qty, operario, folios, clientUuids }) {
  return doOrQueue({ op: "vender", args: { p_evento: eventoId, p_punto: puntoId, p_producto: producto.id, p_nombre: producto.name, p_precio: producto.price, p_qty: qty, p_codigos: folios, p_operario: operario, p_client_uuids: clientUuids } });
}
export function anularUltima(eventoId, puntoId, por) { return doOrQueue({ op: "anularUltima", evento: eventoId, punto: puntoId, por }); }
export function anularVenta(clientUuid, por) { return doOrQueue({ op: "anularVenta", clientUuid, por }); }
export function cerrarZ(eventoId, puntoId, por) { return doOrQueue({ op: "cerrarZ", evento: eventoId, punto: puntoId, por }); }

export async function syncPending() {
  const q = loadQ(); const rest = [];
  for (const it of q) { try { await runItem(it); } catch { rest.push(it); } }
  saveQ(rest); return { synced: q.length - rest.length, remaining: rest.length };
}

/* ===================== REALTIME ===================== */
export function subscribeEvento(eventoId, onChange) {
  const ch = supabase.channel("ev-" + eventoId)
    .on("postgres_changes", { event: "*", schema: "public", table: "ticket_ventas", filter: `evento_id=eq.${eventoId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "ticket_cierres", filter: `evento_id=eq.${eventoId}` }, onChange)
    .subscribe();
  return () => supabase.removeChannel(ch);
}

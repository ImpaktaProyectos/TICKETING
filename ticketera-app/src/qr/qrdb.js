// ===================== CANJES DE TICKETS CON QR · servidor + modo sin internet =====================
import { supabase } from "../supabase";
import { scopedKey, deviceName } from "../db";

const nuevoId = () => (crypto.randomUUID ? crypto.randomUUID() : null);
const conTiempo = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
// Error de red (sin internet / wifi colgado) frente a respuesta del servidor
export const esErrorDeRed = (e) => !e || !e.code || /fetch|network|timeout|Failed/i.test(e.message || "");

/* ---------- Canje en el servidor (comprueba firma + marca en una sola operación) ---------- */
export async function canjearQR({ eventoId, puntoId, hex, canjeId = nuevoId(), sinConexion = false, cuando = null, ms = 5000 }) {
  const { data, error } = await conTiempo(supabase.rpc("ticket_canjear", {
    p_evento: eventoId, p_datos: hex, p_punto: puntoId || null, p_dispositivo: deviceName(),
    p_canje_id: canjeId, p_sin_conexion: !!sinConexion, p_canjeado_en: cuando,
  }), ms);
  if (error) throw error;
  return data;
}
export async function canjearFolio({ eventoId, puntoId, folio, ms = 6000 }) {
  const { data, error } = await conTiempo(supabase.rpc("ticket_canjear_folio", {
    p_evento: eventoId, p_folio: folio, p_punto: puntoId || null, p_dispositivo: deviceName(), p_canje_id: nuevoId(),
  }), ms);
  if (error) throw error;
  return data;
}

/* ---------- Lo ya canjeado del evento (para avisar de copias también SIN internet) ----------
   Se descarga cada poco mientras hay conexión y se guarda en el móvil. */
const kUsados = (ev) => scopedKey("tixfast_qr_usados_" + ev);
const kCola = (ev) => scopedKey("tixfast_qr_cola_" + ev);
const kDup = (ev) => scopedKey("tixfast_qr_dup_" + ev);
const leer = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v ?? def; } catch { return def; } };
const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export const usadosLocales = (ev) => leer(kUsados(ev), {});          // { "uuid:idx": { t, barra, disp } }
export function marcarUsado(ev, clave, info) { const u = usadosLocales(ev); u[clave] = { t: Date.now(), ...info }; guardar(kUsados(ev), u); }

// Solo se piden los canjes NUEVOS desde la última vez (recibido_en): con 30 escáneres y 20.000 canjes,
// descargarlo todo cada 15 s en cada móvil era el segundo mayor gasto de la base de datos.
// La primera vez (o tras borrar los datos del móvil) se descarga todo.
const kCurCanjes = (ev) => scopedKey("tixfast_qr_cursor_" + ev);
export async function descargarCanjes(eventoId, puntos = []) {
  const nombre = (id) => puntos.find(p => p.id === id)?.name || "";
  const cur = leer(kCurCanjes(eventoId), null);
  const desde = cur && Number.isFinite(Date.parse(cur)) ? new Date(Date.parse(cur) - 60000).toISOString() : null;   // 1 min de margen
  const out = []; const page = 1000;
  for (let from = 0; ; from += page) {
    let q = supabase.from("ticket_canjes").select("venta_uuid, idx, canjeado_en, punto_id, dispositivo, recibido_en").eq("evento_id", eventoId);
    if (desde) q = q.gt("recibido_en", desde);
    const { data, error } = await q.order("recibido_en").order("id").range(from, from + page - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < page) break;
  }
  const u = usadosLocales(eventoId);
  out.forEach(c => { const k = `${c.venta_uuid}:${c.idx}`; if (!u[k] || u[k].local) u[k] = { t: new Date(c.canjeado_en).getTime(), barra: nombre(c.punto_id), disp: c.dispositivo || "" }; });
  guardar(kUsados(eventoId), u);
  const ultimo = out.reduce((m, c) => (c.recibido_en && (!m || c.recibido_en > m) ? c.recibido_en : m), cur);
  if (ultimo) guardar(kCurCanjes(eventoId), ultimo);
  return out.length;
}

/* ---------- Cola de canjes hechos sin internet ---------- */
export const colaCanjes = (ev) => leer(kCola(ev), []);
export function encolarCanje(ev, item) { const q = colaCanjes(ev); q.push(item); guardar(kCola(ev), q); }
export const duplicadosSinConexion = (ev) => leer(kDup(ev), []);

let subiendo = null;
// Sube los canjes pendientes. Los que el servidor rechaza (p. ej. otro móvil ya lo canjeó sin conexión)
// quedan apuntados como "duplicados sin conexión" para el informe.
export function subirCola(eventoId, puntoId) {
  if (subiendo) return subiendo;
  subiendo = (async () => {
    let ok = 0, dup = 0;
    for (const it of colaCanjes(eventoId)) {
      let r;
      try { r = await canjearQR({ eventoId, puntoId: it.punto || puntoId, hex: it.hex, canjeId: it.id, sinConexion: true, cuando: new Date(it.t).toISOString(), ms: 8000 }); }
      catch (e) { if (esErrorDeRed(e)) break; r = { ok: false, motivo: "error" }; }
      if (!r?.ok) { dup++; const d = duplicadosSinConexion(eventoId); d.unshift({ ...it, motivo: r?.motivo, detalle: r, subido: Date.now() }); guardar(kDup(eventoId), d.slice(0, 200)); }
      else ok++;
      guardar(kCola(eventoId), colaCanjes(eventoId).filter(x => x.id !== it.id));
    }
    return { ok, dup, quedan: colaCanjes(eventoId).length };
  })();
  return subiendo.finally(() => { subiendo = null; });
}

/* ---------- Informe ---------- */
// El servidor devuelve como mucho 1.000 filas por consulta: se piden por páginas (antes, con más de
// 1.000 canjes el informe se quedaba corto y daba menos canjeados de los reales).
export async function cargarInformeQR(eventoId) {
  const canjes = [], page = 1000, MAX = 50000;
  const r = supabase.from("ticket_canje_rechazos").select("motivo, detalle, punto_id, dispositivo, sin_conexion, creado_en").eq("evento_id", eventoId).order("creado_en", { ascending: false }).limit(1000);
  for (let from = 0; from < MAX; from += page) {
    const { data, error } = await supabase.from("ticket_canjes").select("venta_uuid, idx, unidades, nombre, punto_venta_id, punto_id, dispositivo, origen, sin_conexion, venta_pendiente, canjeado_en").eq("evento_id", eventoId).order("canjeado_en", { ascending: false }).order("id").range(from, from + page - 1);
    if (error) throw error;
    canjes.push(...(data || []));
    if (!data || data.length < page) break;
  }
  const rr = await r;
  if (rr.error) throw rr.error;
  return { canjes, rechazos: rr.data || [] };
}

/* ---------- Entradas online del evento (para validar también SIN internet) ----------
   Se descarga la lista (anuladas, reemitidas, titular) y desde cuándo vale el QR. */
const kWeb = (ev) => scopedKey("tixfast_qr_web_" + ev);
export const webLocal = (ev) => leer(kWeb(ev), { horas: 24, entradas: {} });
// Entradas online del evento (para validar sin internet). Cambian poco: se descargan como mucho cada
// 5 minutos (antes, cada 15 s en cada escáner). Por páginas de 1.000, porque el servidor no devuelve
// más de 1.000 filas por consulta: con más entradas, las de más allá se quedaban fuera.
const CADA_WEB_MS = 5 * 60000;
export async function descargarWeb(eventoId, { forzar = false } = {}) {
  const previo = leer(kWeb(eventoId), null);
  if (!forzar && previo?.t && Date.now() - previo.t < CADA_WEB_MS) return Object.keys(previo.entradas || {}).length;
  const f = await supabase.from("ticket_web_eventos").select("qr_horas_antes").eq("evento_id", eventoId).maybeSingle();
  if (f.error) throw f.error;
  // Entradas de día: el día de cada tipo de entrada
  const tr = await supabase.from("ticket_web_tramos").select("id, acceso, dia").eq("evento_id", eventoId);
  const diaDe = Object.fromEntries((tr.data || []).filter(t => t.acceso === "dia" && t.dia).map(t => [t.id, t.dia]));
  const entradas = {}; const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase.from("ticket_web_entradas").select("id, emision, estado, asistente, tramo_nombre, numero, prueba, tramo_id").eq("evento_id", eventoId).order("numero").range(from, from + page - 1);
    if (error) throw error;
    (data || []).forEach(e => { entradas[e.id] = { e: e.emision, a: e.estado === "anulada" ? 1 : 0, n: e.asistente, t: e.tramo_nombre, num: e.numero, p: e.prueba ? 1 : 0, ...(diaDe[e.tramo_id] ? { d: diaDe[e.tramo_id] } : {}) }; });
    if (!data || data.length < page) break;
  }
  guardar(kWeb(eventoId), { horas: f.data?.qr_horas_antes ?? 24, entradas, t: Date.now() });
  return Object.keys(entradas).length;
}

// ¿Vale ahora una entrada de día? Igual que el servidor: de las 06:00 de ese día a las 08:00 del siguiente (hora de España)
export function diaVale(dia, ahora = new Date()) {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(ahora);
  const v = Object.fromEntries(partes.map(p => [p.type, p.value]));
  const hoy = `${v.year}-${v.month}-${v.day}`, h = Number(v.hour) % 24;
  const x = new Date(dia + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + 1); const siguiente = x.toISOString().slice(0, 10);
  return (hoy === dia && h >= 6) || (hoy === siguiente && h < 8);
}

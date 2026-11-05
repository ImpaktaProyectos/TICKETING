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

export async function descargarCanjes(eventoId, puntos = []) {
  const nombre = (id) => puntos.find(p => p.id === id)?.name || "";
  const out = []; const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase.from("ticket_canjes").select("venta_uuid, idx, canjeado_en, punto_id, dispositivo").eq("evento_id", eventoId).order("canjeado_en").range(from, from + page - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < page) break;
  }
  const u = usadosLocales(eventoId);
  out.forEach(c => { const k = `${c.venta_uuid}:${c.idx}`; if (!u[k] || u[k].local) u[k] = { t: new Date(c.canjeado_en).getTime(), barra: nombre(c.punto_id), disp: c.dispositivo || "" }; });
  guardar(kUsados(eventoId), u);
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
export async function cargarInformeQR(eventoId) {
  const [c, r] = await Promise.all([
    supabase.from("ticket_canjes").select("venta_uuid, idx, unidades, nombre, punto_venta_id, punto_id, dispositivo, origen, sin_conexion, venta_pendiente, canjeado_en").eq("evento_id", eventoId).order("canjeado_en", { ascending: false }).limit(5000),
    supabase.from("ticket_canje_rechazos").select("motivo, detalle, punto_id, dispositivo, sin_conexion, creado_en").eq("evento_id", eventoId).order("creado_en", { ascending: false }).limit(1000),
  ]);
  if (c.error) throw c.error;
  if (r.error) throw r.error;
  return { canjes: c.data || [], rechazos: r.data || [] };
}

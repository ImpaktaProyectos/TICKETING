// ===================== DINERO QUE TIENEN LOS SOCIOS =====================
// Un socio tiene dinero de la empresa cuando:
//   · cobra la señal de un reservado (ticket_reservados.senal_socio), o
//   · vende sin ticket en efectivo desde su móvil (ventas con operario «SOCIO:Nombre»).
// Cuando lo repone, se confirma y se guarda en ticket_socio_devoluciones: la deuda desaparece.
// Las MISMAS reglas están en la vista ticket_socio_deudas (la que lee el CRM).
import { supabase } from "./supabase.js";
export * from "./dineroSocios.js";

// ---------- Base de datos ----------
const devFrom = (d) => ({ id: d.id, eventId: d.evento_id, socio: d.socio, clave: d.clave, concepto: d.concepto || "", importe: Number(d.importe), devueltoEn: d.devuelto_en, devueltoPor: d.devuelto_por || "" });
export async function loadDevoluciones(eventoId) {
  const { data, error } = await supabase.from("ticket_socio_devoluciones").select("*").eq("evento_id", eventoId);
  if (error) throw error;
  return (data || []).map(devFrom);
}
// Confirma que el socio ha devuelto lo de estas deudas (una o varias). Se guarda el importe de cada una.
export async function confirmarDevolucion(eventoId, items, por) {
  const filas = items.filter(it => it.pendiente > 0).map(it => ({ evento_id: eventoId, socio: it.socio.slice(0, 60), clave: it.clave, concepto: String(it.concepto || "").slice(0, 200), importe: it.importe, devuelto_por: por ? String(por).slice(0, 60) : null, devuelto_en: new Date().toISOString() }));
  if (!filas.length) return;
  const { error } = await supabase.from("ticket_socio_devoluciones").upsert(filas, { onConflict: "owner_id,evento_id,clave" });
  if (error) throw error;
}
export async function deshacerDevolucion(eventoId, clave) {
  const { error } = await supabase.from("ticket_socio_devoluciones").delete().eq("evento_id", eventoId).eq("clave", clave);
  if (error) throw error;
}
// Para el CRM: todo lo que tienen los socios en todos los eventos (vista del servidor)
export async function loadDeudasTodas() {
  const { data, error } = await supabase.from("ticket_socio_deudas").select("*").order("fecha", { ascending: false }).range(0, 4999);
  if (error) throw error;
  return (data || []).map(d => ({ eventId: d.evento_id, evento: d.evento, eventoFecha: d.evento_fecha, clave: d.clave, origen: d.origen, socio: d.socio, concepto: d.concepto, importe: Number(d.importe), devuelto: Number(d.devuelto || 0), devueltoEn: d.devuelto_en, devueltoPor: d.devuelto_por || "", pendiente: Number(d.pendiente || 0), fecha: d.fecha }));
}

// ---------- Cambio que ponen los socios (ticket_socio_aportaciones) ----------
const aportFrom = (a) => ({ id: a.id, eventId: a.evento_id, socio: a.socio, importe: Number(a.importe), concepto: a.concepto || "", puntoId: a.punto_id || null,
  gastoEntradaId: a.gasto_entrada_id || null, creadoEn: a.creado_en, creadoPor: a.creado_por || "", devueltoEn: a.devuelto_en || null, devueltoPor: a.devuelto_por || "",
  devueltoDesde: a.devuelto_desde || "", gastoDevolucionId: a.gasto_devolucion_id || null, evento: a.ticket_eventos?.nombre || "", eventoFecha: a.ticket_eventos?.fecha || null });
const errAport = (e) => Object.assign(new Error(/ticket_socio_aportaciones/.test(e?.message || "") && /does not exist|schema cache/i.test(e?.message || "") ? "Falta activar «cambio de los socios» en la base de datos" : !navigator.onLine ? "Sin conexión: para apuntar el cambio de un socio hace falta internet" : "No se ha podido guardar"), { mostrar: true, sinTabla: /does not exist|schema cache/i.test(e?.message || "") });
// null si la tabla aún no existe (la app oculta la sección)
export async function loadAportaciones(eventoId) {
  let q = supabase.from("ticket_socio_aportaciones").select("*, ticket_eventos(nombre, fecha)").order("creado_en", { ascending: false }).range(0, 4999);
  if (eventoId) q = q.eq("evento_id", eventoId);
  const { data, error } = await q;
  if (error) { if (/does not exist|schema cache/i.test(error.message || "")) return null; throw error; }
  return (data || []).map(aportFrom);
}
export async function crearAportacion({ eventoId, socio, importe, concepto, puntoId, gastoEntradaId, por }) {
  const { data, error } = await supabase.from("ticket_socio_aportaciones").insert({ evento_id: eventoId, socio: String(socio).trim().slice(0, 60), importe: Math.round(Number(importe) * 100) / 100,
    concepto: concepto ? String(concepto).slice(0, 200) : null, punto_id: puntoId || null, gasto_entrada_id: gastoEntradaId || null, creado_por: por ? String(por).slice(0, 60) : null }).select("*").single();
  if (error) throw errAport(error);
  return aportFrom(data);
}
export async function editarAportacion(id, { socio, importe, concepto }) {
  const { error } = await supabase.from("ticket_socio_aportaciones").update({ socio: String(socio).trim().slice(0, 60), importe: Math.round(Number(importe) * 100) / 100, concepto: concepto ? String(concepto).slice(0, 200) : null }).eq("id", id);
  if (error) throw errAport(error);
}
export async function devolverAportacion(id, { desde = "fuera", gastoDevolucionId = null, por } = {}) {
  const { error } = await supabase.from("ticket_socio_aportaciones").update({ devuelto_en: new Date().toISOString(), devuelto_por: por ? String(por).slice(0, 60) : null, devuelto_desde: desde, gasto_devolucion_id: gastoDevolucionId }).eq("id", id).is("devuelto_en", null);
  if (error) throw errAport(error);
}
export async function deshacerDevolucionAportacion(id) {
  const { error } = await supabase.from("ticket_socio_aportaciones").update({ devuelto_en: null, devuelto_por: null, devuelto_desde: null, gasto_devolucion_id: null }).eq("id", id);
  if (error) throw errAport(error);
}
export async function borrarAportacion(id) {
  const { error } = await supabase.from("ticket_socio_aportaciones").delete().eq("id", id);
  if (error) throw errAport(error);
}

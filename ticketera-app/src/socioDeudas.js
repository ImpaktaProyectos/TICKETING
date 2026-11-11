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

// ===================== CRM · acceso a datos =====================
// Solo tablas ticket_crm_* (nuevas). El CRM NUNCA escribe en las tablas del TPV:
// las ventas de las barras se leen del estado que ya carga la app.
import { supabase } from "../supabase";

const n = (v) => (v == null ? 0 : Number(v));
const ok = (r) => { if (r.error) throw r.error; return r.data; };

const socioFrom = (s) => ({ id: s.id, nombre: s.nombre, telefono: s.telefono || "", color: s.color || "", activo: s.activo !== false });
const partFrom = (p) => ({ id: p.id, eventoId: p.evento_id, socioId: p.socio_id, porcentaje: n(p.porcentaje) });
const ingresoFrom = (i) => ({
  id: i.id, eventoId: i.evento_id, categoria: i.categoria, concepto: i.concepto || "", importe: n(i.importe),
  fecha: i.fecha, metodo: i.metodo, estado: i.estado, cobradoPor: i.cobrado_por || null, entregado: !!i.entregado,
  origen: i.origen, nota: i.nota || "", creadoEn: i.creado_en,
});

export async function loadCRM(eventoId) {
  const [s, es, ing, fp] = await Promise.all([
    supabase.from("ticket_crm_socios").select("*").order("creado_en", { ascending: true }),
    supabase.from("ticket_crm_evento_socios").select("*").eq("evento_id", eventoId),
    supabase.from("ticket_crm_ingresos").select("*").eq("evento_id", eventoId).order("fecha", { ascending: false }).order("creado_en", { ascending: false }),
    supabase.from("ticket_crm_fuentes_punto").select("*"),
  ]);
  return {
    socios: ok(s).map(socioFrom),
    participacion: ok(es).map(partFrom),
    ingresos: ok(ing).map(ingresoFrom),
    fuentes: Object.fromEntries(ok(fp).map(x => [x.punto_id, x.fuente])),
  };
}

/* ---------- Socios ---------- */
export async function saveSocio({ id, nombre, telefono, color }) {
  const row = { nombre: String(nombre || "").trim().slice(0, 80), telefono: String(telefono || "").trim().slice(0, 30) || null, color: color || null };
  if (!row.nombre) throw new Error("Falta el nombre");
  if (id) return socioFrom(ok(await supabase.from("ticket_crm_socios").update(row).eq("id", id).select().single()));
  return socioFrom(ok(await supabase.from("ticket_crm_socios").insert(row).select().single()));
}
export async function setSocioActivo(id, activo) {
  ok(await supabase.from("ticket_crm_socios").update({ activo: !!activo }).eq("id", id));
}

// Reparto del evento: guarda exactamente la lista dada (quita a los que ya no participan)
export async function saveParticipacion(eventoId, lista) {
  const cur = ok(await supabase.from("ticket_crm_evento_socios").select("id, socio_id").eq("evento_id", eventoId));
  const keep = new Set(lista.map(x => x.socioId));
  const quitar = cur.filter(r => !keep.has(r.socio_id)).map(r => r.id);
  if (quitar.length) ok(await supabase.from("ticket_crm_evento_socios").delete().in("id", quitar));
  if (lista.length) ok(await supabase.from("ticket_crm_evento_socios").upsert(
    lista.map(x => ({ evento_id: eventoId, socio_id: x.socioId, porcentaje: Math.round(n(x.porcentaje) * 1000) / 1000 })),
    { onConflict: "evento_id,socio_id" }));
}

/* ---------- Ingresos ---------- */
const ingresoTo = (x) => ({
  evento_id: x.eventoId,
  categoria: String(x.categoria || "Otros").trim().slice(0, 60) || "Otros",
  concepto: String(x.concepto || "").trim().slice(0, 160),
  importe: Math.round(n(x.importe) * 100) / 100,
  fecha: x.fecha || new Date().toISOString().slice(0, 10),
  metodo: ["efectivo", "transferencia", "bizum", "tarjeta", "otro"].includes(x.metodo) ? x.metodo : "efectivo",
  estado: x.estado === "pendiente" ? "pendiente" : "cobrado",
  cobrado_por: x.cobradoPor || null,
  entregado: x.cobradoPor ? !!x.entregado : false,
  nota: String(x.nota || "").trim().slice(0, 500) || null,
  actualizado_en: new Date().toISOString(),
});
export async function saveIngreso(x) {
  if (!(n(x.importe) > 0)) throw new Error("Importe no válido");
  if (x.id) return ingresoFrom(ok(await supabase.from("ticket_crm_ingresos").update(ingresoTo(x)).eq("id", x.id).select().single()));
  return ingresoFrom(ok(await supabase.from("ticket_crm_ingresos").insert(ingresoTo(x)).select().single()));
}
export async function deleteIngreso(id) { ok(await supabase.from("ticket_crm_ingresos").delete().eq("id", id)); }
export async function setEntregado(ids, entregado) {
  if (!ids.length) return;
  ok(await supabase.from("ticket_crm_ingresos").update({ entregado: !!entregado, actualizado_en: new Date().toISOString() }).in("id", ids));
}

/* ---------- Tipo de ingreso de cada barra del TPV ---------- */
export async function setFuentePunto(puntoId, fuente) {
  ok(await supabase.from("ticket_crm_fuentes_punto").upsert({ punto_id: puntoId, fuente }, { onConflict: "punto_id" }));
}

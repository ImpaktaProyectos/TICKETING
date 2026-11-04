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

const gastoFrom = (g) => ({
  id: g.id, eventoId: g.evento_id, tipo: g.tipo || "normal", padreId: g.padre_id || null, categoria: g.categoria, concepto: g.concepto || "",
  proveedor: g.proveedor || "", previsto: g.previsto != null ? n(g.previsto) : null, real: g.real != null ? n(g.real) : null,
  personas: g.personas != null ? Number(g.personas) : null, precioHora: g.precio_hora != null ? n(g.precio_hora) : null, horas: g.horas != null ? n(g.horas) : null,
  estado: g.estado || "previsto", pagadoPor: g.pagado_por || null, fecha: g.fecha || null, nota: g.nota || "", creadoEn: g.creado_en,
});

export async function loadCRM(eventoId) {
  const [s, es, ing, fp, gs, lq] = await Promise.all([
    supabase.from("ticket_crm_socios").select("*").order("creado_en", { ascending: true }),
    supabase.from("ticket_crm_evento_socios").select("*").eq("evento_id", eventoId),
    supabase.from("ticket_crm_ingresos").select("*").eq("evento_id", eventoId).order("fecha", { ascending: false }).order("creado_en", { ascending: false }),
    supabase.from("ticket_crm_fuentes_punto").select("*"),
    supabase.from("ticket_crm_gastos").select("*").eq("evento_id", eventoId).order("creado_en", { ascending: true }),
    supabase.from("ticket_crm_liquidaciones").select("*").eq("evento_id", eventoId).maybeSingle(),
  ]);
  const liq = ok(lq);
  return {
    socios: ok(s).map(socioFrom),
    participacion: ok(es).map(partFrom),
    ingresos: ok(ing).map(ingresoFrom),
    fuentes: Object.fromEntries(ok(fp).map(x => [x.punto_id, x.fuente])),
    gastos: ok(gs).map(gastoFrom),
    liquidacion: liq ? { id: liq.id, datos: liq.datos || {}, cerradaEn: liq.cerrada_en } : null,
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

/* ---------- Gastos ---------- */
const optNum = (v, dec = 2) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10 ** dec) / 10 ** dec);
const gastoTo = (x) => ({
  evento_id: x.eventoId,
  tipo: ["normal", "personal", "artista"].includes(x.tipo) ? x.tipo : "normal",
  padre_id: x.padreId || null,
  categoria: String(x.categoria || "Otros").trim().slice(0, 60) || "Otros",
  concepto: String(x.concepto || "").trim().slice(0, 160),
  proveedor: String(x.proveedor || "").trim().slice(0, 120) || null,
  previsto: optNum(x.previsto), real: optNum(x.real),
  personas: x.personas === "" || x.personas == null ? null : Math.max(0, Math.round(Number(x.personas)) || 0),
  precio_hora: optNum(x.precioHora), horas: optNum(x.horas),
  estado: ["previsto", "confirmado", "pagado"].includes(x.estado) ? x.estado : "previsto",
  pagado_por: x.pagadoPor || null,
  fecha: x.fecha || null,
  nota: String(x.nota || "").trim().slice(0, 500) || null,
  actualizado_en: new Date().toISOString(),
});
export async function saveGasto(x) {
  if (x.id) return gastoFrom(ok(await supabase.from("ticket_crm_gastos").update(gastoTo(x)).eq("id", x.id).select().single()));
  return gastoFrom(ok(await supabase.from("ticket_crm_gastos").insert(gastoTo(x)).select().single()));
}
export async function deleteGasto(id) { ok(await supabase.from("ticket_crm_gastos").delete().eq("id", id)); }

// Copia el presupuesto de otro evento: solo lo previsto (sin importes reales, pagos ni fechas)
export async function copiarPresupuesto(desdeEventoId, haciaEventoId) {
  const src = ok(await supabase.from("ticket_crm_gastos").select("*").eq("evento_id", desdeEventoId).order("creado_en", { ascending: true }));
  if (!src.length) return 0;
  const base = (g) => ({ evento_id: haciaEventoId, tipo: g.tipo, categoria: g.categoria, concepto: g.concepto, proveedor: g.proveedor,
    previsto: g.previsto != null ? g.previsto : g.real, personas: g.personas, precio_hora: g.precio_hora, horas: g.horas, estado: "previsto", nota: g.nota });
  const padres = src.filter(g => !g.padre_id);
  const nuevos = ok(await supabase.from("ticket_crm_gastos").insert(padres.map(base)).select("id"));
  const mapa = Object.fromEntries(padres.map((g, i) => [g.id, nuevos[i]?.id]));
  const hijos = src.filter(g => g.padre_id && mapa[g.padre_id]);
  if (hijos.length) ok(await supabase.from("ticket_crm_gastos").insert(hijos.map(g => ({ ...base(g), padre_id: mapa[g.padre_id] }))));
  return src.length;
}

/* ---------- Liquidación (cifras congeladas al cerrar) ---------- */
export async function cerrarLiquidacion(eventoId, datos) {
  ok(await supabase.from("ticket_crm_liquidaciones").upsert({ evento_id: eventoId, datos, cerrada_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }, { onConflict: "evento_id" }));
}
export async function actualizarLiquidacion(eventoId, datos) {
  ok(await supabase.from("ticket_crm_liquidaciones").update({ datos, actualizado_en: new Date().toISOString() }).eq("evento_id", eventoId));
}
export async function reabrirLiquidacion(eventoId) {
  ok(await supabase.from("ticket_crm_liquidaciones").delete().eq("evento_id", eventoId));
}

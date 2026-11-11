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
  origen: i.origen, refExterna: i.ref_externa || null, unidades: i.unidades != null ? Number(i.unidades) : null, canal: i.canal || null, nota: i.nota || "", creadoEn: i.creado_en,
});

const gastoFrom = (g) => ({
  id: g.id, eventoId: g.evento_id, tipo: g.tipo || "normal", padreId: g.padre_id || null, categoria: g.categoria, concepto: g.concepto || "",
  proveedor: g.proveedor || "", previsto: g.previsto != null ? n(g.previsto) : null, real: g.real != null ? n(g.real) : null,
  personas: g.personas != null ? Number(g.personas) : null, precioHora: g.precio_hora != null ? n(g.precio_hora) : null, horas: g.horas != null ? n(g.horas) : null,
  estado: g.estado || "previsto", pagadoPor: g.pagado_por || null, fecha: g.fecha || null, nota: g.nota || "", creadoEn: g.creado_en,
  iva: g.iva != null ? Number(g.iva) : null, factura: g.factura == null ? null : !!g.factura,
});
const CONEX_COLS = "id, proveedor, entorno, clave_fin, estado, ultimo_error, ultima_sync, actualizado_en";
const conexFrom = (c) => c ? { id: c.id, proveedor: c.proveedor, entorno: c.entorno, claveFin: c.clave_fin || "", estado: c.estado, error: c.ultimo_error || "", ultimaSync: c.ultima_sync } : null;
const vincFrom = (v) => ({ id: v.id, eventoId: v.evento_id, proveedor: v.proveedor, extId: v.ext_id, extNombre: v.ext_nombre || "", ultimaSync: v.ultima_sync, error: v.ultimo_error || "" });

export async function loadCRM(eventoId) {
  const [s, es, ing, fp, gs, lq, aj, cx, vs] = await Promise.all([
    supabase.from("ticket_crm_socios").select("*").order("creado_en", { ascending: true }),
    supabase.from("ticket_crm_evento_socios").select("*").eq("evento_id", eventoId),
    supabase.from("ticket_crm_ingresos").select("*").eq("evento_id", eventoId).order("fecha", { ascending: false }).order("creado_en", { ascending: false }),
    supabase.from("ticket_crm_fuentes_punto").select("*"),
    supabase.from("ticket_crm_gastos").select("*").eq("evento_id", eventoId).order("creado_en", { ascending: true }),
    supabase.from("ticket_crm_liquidaciones").select("*").eq("evento_id", eventoId).maybeSingle(),
    supabase.from("ticket_crm_ajustes").select("datos").maybeSingle(),
    supabase.from("ticket_crm_conexiones").select(CONEX_COLS).eq("proveedor", "fourvenues").maybeSingle(),
    supabase.from("ticket_crm_vinculos").select("*"),
  ]);
  const liq = ok(lq);
  return {
    socios: ok(s).map(socioFrom),
    participacion: ok(es).map(partFrom),
    ingresos: ok(ing).map(ingresoFrom),
    fuentes: Object.fromEntries(ok(fp).map(x => [x.punto_id, x.fuente])),
    gastos: ok(gs).map(gastoFrom),
    liquidacion: liq ? { id: liq.id, datos: liq.datos || {}, cerradaEn: liq.cerrada_en } : null,
    ajustes: ok(aj)?.datos || {},
    conexion: conexFrom(ok(cx)),
    vinculos: (ok(vs) || []).map(vincFrom),
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
  // ventas de entradas por otro canal: cuántas y por dónde
  ...("unidades" in x ? { unidades: x.unidades != null && x.unidades !== "" && Number(x.unidades) >= 0 ? Math.min(10000000, Math.round(Number(x.unidades))) : null } : {}),
  ...("canal" in x ? { canal: String(x.canal || "").trim().slice(0, 60) || null } : {}),
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
  iva: x.iva == null || x.iva === "" ? null : Math.min(30, Math.max(0, Number(x.iva) || 0)),
  factura: x.factura == null ? null : !!x.factura,
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
    previsto: g.previsto != null ? g.previsto : g.real, personas: g.personas, precio_hora: g.precio_hora, horas: g.horas, estado: "previsto", nota: g.nota, iva: g.iva, factura: g.factura });
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

/* ---------- Dashboard: datos de TODOS los eventos de la cuenta ---------- */
async function todas(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = ok(await build().range(from, from + 999));
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
export async function loadCuenta() {
  const [ing, gs, fp, sn] = await Promise.all([
    todas(() => supabase.from("ticket_crm_ingresos").select("*").order("id", { ascending: true })),
    todas(() => supabase.from("ticket_crm_gastos").select("*").order("id", { ascending: true })),
    supabase.from("ticket_crm_fuentes_punto").select("*"),
    // Las señales son un extra: si tardan o fallan, el panel carga igual (sin ellas) en vez de quedarse esperando
    Promise.race([todas(() => supabase.from("ticket_reservados").select("id, evento_id, senal").gt("senal", 0).neq("estado", "libre").order("id", { ascending: true })).catch(() => []), new Promise(r => setTimeout(() => r([]), 6000))]),
  ]);
  // Señales de reservados por evento (misma regla que Ingresos: reservado no libre con señal)
  const senales = {}; (sn || []).forEach(r => { senales[r.evento_id] = Math.round(((senales[r.evento_id] || 0) + Number(r.senal || 0)) * 100) / 100; });
  return { ingresos: ing.map(ingresoFrom), gastos: gs.map(gastoFrom), fuentes: Object.fromEntries(ok(fp).map(x => [x.punto_id, x.fuente])), senales };
}

/* ---------- Ajustes de la cuenta (categorías, comisiones, IVA) ---------- */
export async function saveAjustes(datos) {
  ok(await supabase.from("ticket_crm_ajustes").upsert({ datos, actualizado_en: new Date().toISOString() }, { onConflict: "owner_id" }));
}
export async function renombrarCategoria(ambito, viejo, nuevo) {
  return ok(await supabase.rpc("ticket_crm_renombrar_categoria", { p_ambito: ambito, p_viejo: viejo, p_nuevo: nuevo }));
}

/* ---------- Conexión con la ticketera ----------
   La clave se envía UNA vez a la base de datos (se guarda cifrada) y nunca vuelve al navegador.
   Las consultas a Fourvenues las hace el servidor (función crm-ticketera). */
export async function guardarConexion(entorno, clave) {
  ok(await supabase.rpc("ticket_crm_guardar_conexion", { p_proveedor: "fourvenues", p_entorno: entorno, p_clave: clave || null }));
}
export async function borrarConexion() { ok(await supabase.from("ticket_crm_conexiones").delete().eq("proveedor", "fourvenues")); }
export async function ticketera(accion, extra = {}) {
  const { data, error } = await supabase.functions.invoke("crm-ticketera", { body: { accion, ...extra } });
  if (error) throw new Error(navigator.onLine ? "No se ha podido conectar con el servidor." : "Sin conexión a internet.");
  if (!data?.ok) throw new Error(data?.error || "No se ha podido completar.");
  return data;
}
export async function vincular(eventoId, extId, extNombre) {
  ok(await supabase.from("ticket_crm_vinculos").upsert({ evento_id: eventoId, proveedor: "fourvenues", ext_id: String(extId).trim().slice(0, 100), ext_nombre: extNombre ? String(extNombre).slice(0, 200) : null }, { onConflict: "evento_id,proveedor" }));
}
export async function desvincular(eventoId) { ok(await supabase.from("ticket_crm_vinculos").delete().eq("evento_id", eventoId).eq("proveedor", "fourvenues")); }

/* ---------- Importar ventas desde un CSV (una fila por tipo de entrada) ----------
   Reimportar el mismo fichero sustituye los totales anteriores de esa ticketera (no duplica). */
const slug = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "general";
export async function importarCSV(eventoId, ticketera, categoria, grupos) {
  const pref = `csv:${eventoId}:${slug(ticketera)}:`;
  const ahora = new Date().toISOString();
  const filas = grupos.map(g => ({
    evento_id: eventoId, categoria: String(categoria || "Ticketera online").slice(0, 60), concepto: `${ticketera} · ${g.nombre}`.slice(0, 160),
    importe: Math.round(n(g.importe) * 100) / 100, unidades: Math.max(0, Math.round(n(g.unidades))), fecha: g.fecha || ahora.slice(0, 10),
    metodo: "tarjeta", estado: "cobrado", origen: "csv", ref_externa: (pref + slug(g.nombre)).slice(0, 200), actualizado_en: ahora,
  }));
  const prev = ok(await supabase.from("ticket_crm_ingresos").select("id, ref_externa").eq("evento_id", eventoId).eq("origen", "csv").like("ref_externa", pref + "%"));
  if (filas.length) ok(await supabase.from("ticket_crm_ingresos").upsert(filas, { onConflict: "evento_id,ref_externa" }));
  const vivos = new Set(filas.map(f => f.ref_externa));
  const sobran = prev.filter(p => !vivos.has(p.ref_externa)).map(p => p.id);
  if (sobran.length) ok(await supabase.from("ticket_crm_ingresos").delete().in("id", sobran));
  return filas.length;
}

/* =====================================================================
   STOCK (fase 1): catálogo, libro de movimientos (solo se añade), recetas y recuento final
   ===================================================================== */
const artFrom = (a) => ({ id: a.id, nombre: a.nombre, familia: a.familia, unidad: a.unidad, ml: a.ml, porCaja: a.por_caja || 1, retornable: !!a.retornable,
  coste: a.coste != null ? n(a.coste) : null, proveedor: a.proveedor || "", codigo: a.codigo || "", envaseCodigo: a.envase_codigo || "", confirmar: !!a.confirmar, activo: a.activo !== false, orden: a.orden || 0 });
const artTo = (x) => ({
  nombre: String(x.nombre || "").trim().slice(0, 80), familia: x.familia, unidad: x.unidad || "botella",
  ml: x.ml ? Math.max(1, Math.min(100000, Math.round(n(x.ml)))) : null, por_caja: Math.max(1, Math.min(1000, Math.round(n(x.porCaja) || 1))),
  retornable: !!x.retornable, coste: x.coste === "" || x.coste == null ? null : Math.round(n(x.coste) * 10000) / 10000,
  proveedor: String(x.proveedor || "").trim().slice(0, 80) || null, codigo: String(x.codigo || "").trim().slice(0, 40) || null,
  envase_codigo: String(x.envaseCodigo || "").trim().slice(0, 40) || null, confirmar: !!x.confirmar, activo: x.activo !== false,
  orden: Math.round(n(x.orden)), actualizado_en: new Date().toISOString(),
});
const movFrom = (m) => ({ id: m.id, eventoId: m.evento_id, articuloId: m.articulo_id, tipo: m.tipo, cantidad: m.cantidad != null ? n(m.cantidad) : 0, cajas: m.cajas != null ? n(m.cajas) : null,
  sueltas: m.sueltas != null ? n(m.sueltas) : null, costeUnidad: m.coste_unidad != null ? n(m.coste_unidad) : null, documento: m.documento || "", nota: m.nota || "", anulaId: m.anula_id || null, creadoPor: m.creado_por || "", creadoEn: m.creado_en,
  documentoId: m.documento_id || null, trasRecuento: !!m.tras_recuento });
const docFrom = (x) => ({ id: x.id, eventoId: x.evento_id, proveedor: x.proveedor, numero: x.numero || "", fecha: x.fecha, tipo: x.tipo, estado: x.estado,
  base: x.base != null ? n(x.base) : null, total: x.total != null ? n(x.total) : null, ivas: x.ivas || [], lineas: x.lineas || [], huella: x.huella || null,
  gastos: x.gastos || [], vinculoId: x.vinculo_id || null, nota: x.nota || "", creadoEn: x.creado_en, actualizadoEn: x.actualizado_en });
const lineaFrom = (l) => ({ id: l.id, articuloId: l.articulo_id, cajas: n(l.cajas), sueltas: n(l.sueltas), abierta: n(l.abierta), total: n(l.total), contadoPor: l.contado_por || "", actualizadoEn: l.actualizado_en });
const claveNueva = () => (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export async function loadStock(eventoId) {
  const [as, ms, rs, cs, ds] = await Promise.all([
    supabase.from("ticket_crm_stock_articulos").select("*").order("orden", { ascending: true }).order("nombre", { ascending: true }),
    supabase.from("ticket_crm_stock_movimientos").select("*").eq("evento_id", eventoId).order("creado_en", { ascending: false }),
    supabase.from("ticket_crm_stock_recetas").select("*"),
    supabase.from("ticket_crm_stock_conteos").select("*").eq("evento_id", eventoId).maybeSingle(),
    supabase.from("ticket_crm_stock_documentos").select("*").eq("evento_id", eventoId),
  ]);
  const conteo = ok(cs);
  const lineas = conteo ? ok(await supabase.from("ticket_crm_stock_conteo_lineas").select("*").eq("conteo_id", conteo.id)).map(lineaFrom) : [];
  return {
    articulos: ok(as).map(artFrom), movimientos: ok(ms).map(movFrom).sort((x, y) => String(y.creadoEn).localeCompare(String(x.creadoEn))),
    recetas: ok(rs).map(r => ({ id: r.id, producto: r.producto, items: Array.isArray(r.items) ? r.items : [] })),
    conteo: conteo ? { id: conteo.id, estado: conteo.estado, empezadoEn: conteo.empezado_en, selladoEn: conteo.sellado_en, selladoPor: conteo.sellado_por || "" } : null,
    lineas,
    documentos: ok(ds).map(docFrom).sort((x, y) => String(y.creadoEn).localeCompare(String(x.creadoEn))),
  };
}
export async function saveArticulo(x) {
  const row = artTo(x);
  if (!row.nombre) throw new Error("Falta el nombre");
  if (x.id) return artFrom(ok(await supabase.from("ticket_crm_stock_articulos").update(row).eq("id", x.id).select().single()));
  return artFrom(ok(await supabase.from("ticket_crm_stock_articulos").insert(row).select().single()));
}
export async function sembrarCatalogo(lista) {
  if (!lista.length) return 0;
  ok(await supabase.from("ticket_crm_stock_articulos").insert(lista.map(artTo)));
  return lista.length;
}
// Movimiento nuevo (entrada, devolución, merma, consumo interno). La clave evita duplicados si se pulsa dos veces o se reintenta.
export async function addMovimiento(x) {
  const row = {
    evento_id: x.eventoId, articulo_id: x.articuloId, tipo: x.tipo, cantidad: Math.round(n(x.cantidad) * 1000) / 1000,
    cajas: x.cajas != null ? Math.round(n(x.cajas) * 1000) / 1000 : null, sueltas: x.sueltas != null ? Math.round(n(x.sueltas) * 1000) / 1000 : null,
    coste_unidad: x.costeUnidad === "" || x.costeUnidad == null ? null : Math.round(n(x.costeUnidad) * 10000) / 10000,
    documento: String(x.documento || "").trim().slice(0, 60) || null, nota: String(x.nota || "").trim().slice(0, 300) || null,
    creado_por: String(x.creadoPor || "").slice(0, 40) || null, clave: x.clave || claveNueva(),
  };
  if (!(row.cantidad > 0)) throw new Error("Cantidad no válida");
  const r = await supabase.from("ticket_crm_stock_movimientos").insert(row);
  if (r.error && r.error.code === "23505") return; // ya estaba guardado (reintento)
  ok(r);
}
export async function anularMovimiento(m, creadoPor) {
  const r = await supabase.from("ticket_crm_stock_movimientos").insert({ evento_id: m.eventoId, articulo_id: m.articuloId, tipo: "anulacion", anula_id: m.id, creado_por: creadoPor || null, clave: `anula-${m.id}` });
  if (r.error && r.error.code === "23505") return;
  ok(r);
}
export async function saveReceta(producto, items) {
  const limpio = (items || []).slice(0, 10).map(it => ({ familia: it.familia, cantidad: Math.round(n(it.cantidad) * 1000) / 1000, ...(it.articuloId ? { articuloId: it.articuloId } : {}) })).filter(it => it.familia && it.cantidad > 0);
  ok(await supabase.from("ticket_crm_stock_recetas").upsert({ producto: String(producto).trim().toUpperCase().slice(0, 80), items: limpio, actualizado_en: new Date().toISOString() }, { onConflict: "owner_id,producto" }));
}
export async function saveRecetas(lista) {
  if (!lista.length) return;
  ok(await supabase.from("ticket_crm_stock_recetas").upsert(lista.map(r => ({ producto: String(r.producto).trim().toUpperCase().slice(0, 80), items: r.items, actualizado_en: new Date().toISOString() })), { onConflict: "owner_id,producto" }));
}
export async function borrarReceta(producto) { ok(await supabase.from("ticket_crm_stock_recetas").delete().eq("producto", producto)); }
export async function empezarConteo(eventoId) {
  const r = await supabase.from("ticket_crm_stock_conteos").insert({ evento_id: eventoId });
  if (r.error && r.error.code === "23505") return;
  ok(r);
}
export async function saveLinea(conteoId, articuloId, { cajas, sueltas, abierta, total }, contadoPor) {
  ok(await supabase.from("ticket_crm_stock_conteo_lineas").upsert({ conteo_id: conteoId, articulo_id: articuloId, cajas: n(cajas), sueltas: n(sueltas), abierta: n(abierta), total: Math.round(n(total) * 1000) / 1000, contado_por: contadoPor || null, actualizado_en: new Date().toISOString() }, { onConflict: "conteo_id,articulo_id" }));
}
export async function borrarLinea(conteoId, articuloId) { ok(await supabase.from("ticket_crm_stock_conteo_lineas").delete().eq("conteo_id", conteoId).eq("articulo_id", articuloId)); }
export async function sellarConteo(conteoId, por) { ok(await supabase.from("ticket_crm_stock_conteos").update({ estado: "sellado", sellado_en: new Date().toISOString(), sellado_por: por || null }).eq("id", conteoId)); }
export async function reabrirConteo(conteoId) { ok(await supabase.from("ticket_crm_stock_conteos").update({ estado: "abierto", sellado_en: null, sellado_por: null }).eq("id", conteoId)); }

/* ---------- STOCK fase 2: facturas, abonos y devoluciones ---------- */
const movTo = (x) => ({
  evento_id: x.eventoId, articulo_id: x.articuloId, tipo: x.tipo, cantidad: Math.round(n(x.cantidad) * 1000) / 1000,
  cajas: x.cajas != null ? Math.abs(Math.round(n(x.cajas) * 1000) / 1000) : null, sueltas: x.sueltas != null ? Math.abs(Math.round(n(x.sueltas) * 1000) / 1000) : null,
  coste_unidad: x.costeUnidad == null ? null : Math.round(n(x.costeUnidad) * 10000) / 10000,
  documento: String(x.documento || "").trim().slice(0, 60) || null, nota: String(x.nota || "").trim().slice(0, 300) || null,
  creado_por: String(x.creadoPor || "").slice(0, 40) || null, clave: x.clave, documento_id: x.documentoId || null, tras_recuento: !!x.trasRecuento,
});
// Varios movimientos de una vez; si alguno ya existía (misma clave), no se duplica
export async function addMovimientos(lista) {
  if (!lista.length) return;
  const filas = lista.map(movTo);
  const r = await supabase.from("ticket_crm_stock_movimientos").insert(filas);
  if (!r.error) return;
  if (r.error.code !== "23505") throw r.error;
  // Reintento: alguno ya estaba guardado → uno a uno, saltando los repetidos
  for (const f of filas) { const x = await supabase.from("ticket_crm_stock_movimientos").insert(f); if (x.error && x.error.code !== "23505") throw x.error; }
}
// ¿Ya está este fichero o esta factura en la cuenta? (en cualquier evento)
export async function buscarDocumento({ huella, proveedor, numero }) {
  if (huella) { const r = ok(await supabase.from("ticket_crm_stock_documentos").select("id, evento_id, numero, estado").eq("huella", huella).limit(1)); if (r.length) return r[0]; }
  if (numero) { const r = ok(await supabase.from("ticket_crm_stock_documentos").select("id, evento_id, numero, estado").eq("proveedor", proveedor).eq("numero", numero).neq("estado", "anulado").neq("tipo", "devolucion").limit(1)); if (r.length) return r[0]; }
  return null;
}
export async function crearDocumento(x) {
  return docFrom(ok(await supabase.from("ticket_crm_stock_documentos").insert({
    evento_id: x.eventoId, proveedor: String(x.proveedor).slice(0, 80), numero: x.numero ? String(x.numero).slice(0, 40) : null, fecha: x.fecha || null,
    tipo: x.tipo, estado: x.estado, base: x.base ?? null, total: x.total ?? null, ivas: x.ivas || [], lineas: x.lineas || [], huella: x.huella || null,
    gastos: x.gastos || [], vinculo_id: x.vinculoId || null, nota: x.nota ? String(x.nota).slice(0, 300) : null,
  }).select().single()));
}
export async function actualizarDocumento(id, patch) {
  const row = { actualizado_en: new Date().toISOString() };
  if (patch.estado) row.estado = patch.estado;
  if (patch.gastos) row.gastos = patch.gastos;
  if ("vinculoId" in patch) row.vinculo_id = patch.vinculoId;
  if ("huella" in patch) row.huella = patch.huella;
  if (patch.lineas) row.lineas = patch.lineas;
  ok(await supabase.from("ticket_crm_stock_documentos").update(row).eq("id", id));
}

/* ---------- STOCK fase 3: almacén general ---------- */
// Saldo del almacén = lo que se guardó desde los eventos − lo que se sacó hacia eventos + ajustes del almacén
export async function loadAlmacen() {
  const [ms, an, aj] = await Promise.all([
    todas(() => supabase.from("ticket_crm_stock_movimientos").select("id, evento_id, articulo_id, tipo, cantidad, coste_unidad, creado_en").in("tipo", ["traspaso_salida", "traspaso_entrada"]).order("id", { ascending: true })),
    todas(() => supabase.from("ticket_crm_stock_movimientos").select("anula_id").eq("tipo", "anulacion").order("id", { ascending: true })),
    todas(() => supabase.from("ticket_crm_stock_almacen_ajustes").select("*").order("id", { ascending: true })),
  ]);
  const anulados = new Set(an.map(x => x.anula_id));
  const saldo = {}, coste = {}, ultimo = {};
  ms.filter(m => !anulados.has(m.id)).forEach(m => {
    const q = n(m.cantidad), s = m.tipo === "traspaso_salida" ? 1 : -1;
    saldo[m.articulo_id] = (saldo[m.articulo_id] || 0) + s * q;
    if (s > 0 && m.coste_unidad != null) { const c = coste[m.articulo_id] || { q: 0, v: 0 }; c.q += q; c.v += q * n(m.coste_unidad); coste[m.articulo_id] = c; }
    if (!ultimo[m.articulo_id] || m.creado_en > ultimo[m.articulo_id]) ultimo[m.articulo_id] = m.creado_en;
  });
  aj.forEach(a => { saldo[a.articulo_id] = (saldo[a.articulo_id] || 0) + n(a.cantidad); if (!ultimo[a.articulo_id] || a.creado_en > ultimo[a.articulo_id]) ultimo[a.articulo_id] = a.creado_en; });
  Object.keys(saldo).forEach(k => { saldo[k] = Math.round(saldo[k] * 1000) / 1000; });
  return { saldo, costeMedio: Object.fromEntries(Object.entries(coste).map(([k, c]) => [k, c.q ? c.v / c.q : null])), ultimo, nMovs: ms.length + aj.length };
}
export async function ajustarAlmacen(articuloId, diferencia, nota, creadoPor) {
  const cant = Math.round(n(diferencia) * 1000) / 1000;
  if (!cant) return;
  ok(await supabase.from("ticket_crm_stock_almacen_ajustes").insert({ articulo_id: articuloId, cantidad: cant, nota: nota ? String(nota).slice(0, 300) : null, creado_por: creadoPor || null, clave: claveNueva() }));
}

/* ---------- Previsión (una por evento: tramos, gastos simulados, escenarios y configuración) ---------- */
export async function loadPrevision(eventoId) {
  const r = ok(await supabase.from("ticket_crm_previsiones").select("datos, actualizado_en").eq("evento_id", eventoId).maybeSingle());
  return r ? { datos: r.datos || {}, actualizadoEn: r.actualizado_en } : null;
}
export async function savePrevision(eventoId, datos) {
  ok(await supabase.from("ticket_crm_previsiones").upsert({ evento_id: eventoId, datos, actualizado_en: new Date().toISOString() }, { onConflict: "evento_id" }));
}

/* ===================== TICKETERA ONLINE (gestor «Entradas») ===================== */
// Todo lo de la venta online cuelga del mismo evento del TPV. Las compras las hace el servidor (web_comprar).
const sinAcentos = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
export const slugDe = (t) => sinAcentos(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "evento";
export const FORM_DEF = { telefono: "no", dni: "no", nacimiento: "no", cp: "no", direccion: "no", ciudad: "no", genero: "no", dni_asistente: "no" };
export const AVISOS_DEF = { activo: true, umbralPct: 15, umbralN: "", mostrarVendido: true, siguientePrecio: true };
export const DISENO_DEF = { color: "#ff5a3c", fondo: "oscuro", fondoFlyer: true, letra: "inter" };

export async function webListar() {
  const [f, t] = await Promise.all([
    supabase.from("ticket_web_eventos").select("evento_id, slug, estado, modo, flyer_url, venta_inicio"),
    supabase.from("ticket_web_tramos").select("evento_id, cantidad, vendidas"),
  ]);
  const fichas = ok(f), tramos = ok(t);
  return Object.fromEntries(fichas.map(x => {
    const ts = tramos.filter(y => y.evento_id === x.evento_id);
    return [x.evento_id, { ...x, vendidas: ts.reduce((s, y) => s + y.vendidas, 0), aforo: ts.every(y => y.cantidad != null) ? ts.reduce((s, y) => s + y.cantidad, 0) : null }];
  }));
}
export async function webCargar(eventoId) {
  const [f, t] = await Promise.all([
    supabase.from("ticket_web_eventos").select("*").eq("evento_id", eventoId).maybeSingle(),
    supabase.from("ticket_web_tramos").select("*").eq("evento_id", eventoId).order("orden").order("creado_en"),
  ]);
  return { ficha: ok(f), tramos: ok(t) || [] };
}
// Activa la venta online de un evento (con un enlace libre a partir del nombre)
export async function webActivar(evento) {
  const base = slugDe(evento.name);
  for (let i = 0; i < 30; i++) {
    const slug = i ? `${base}-${i + 1}` : base;
    const r = await supabase.from("ticket_web_eventos").insert({ evento_id: evento.id, slug, formulario: FORM_DEF, avisos: AVISOS_DEF, diseno: DISENO_DEF }).select("*").single();
    if (!r.error) return r.data;
    if (r.error.code !== "23505" || !/slug/.test(r.error.message || "")) throw r.error;
  }
  throw new Error("No hay un enlace libre para este nombre");
}
export async function webGuardarFicha(eventoId, patch) {
  ok(await supabase.from("ticket_web_eventos").update({ ...patch, actualizado_en: new Date().toISOString() }).eq("evento_id", eventoId));
}
export async function webCambiarSlug(eventoId, slug) {
  const r = await supabase.from("ticket_web_eventos").update({ slug }).eq("evento_id", eventoId);
  if (r.error) { const e = new Error(r.error.code === "23505" ? "Ese enlace ya lo usa otro evento" : "Enlace no válido: solo letras, números y guiones"); e.mostrar = true; throw e; }
}
// Datos que comparte con el TPV (nombre, fechas, recinto)
export async function webGuardarEvento(eventoId, patch) { ok(await supabase.from("ticket_eventos").update(patch).eq("id", eventoId)); }
export async function webGuardarTramo(t) {
  const fila = { evento_id: t.evento_id, nombre: t.nombre, descripcion: t.descripcion || null, precio: t.precio, cantidad: t.cantidad, orden: t.orden,
    venta_inicio: t.venta_inicio || null, venta_fin: t.venta_fin || null, max_por_compra: t.max_por_compra, visible: t.visible, copas: t.copas };
  if (t.id) { ok(await supabase.from("ticket_web_tramos").update(fila).eq("id", t.id)); return t.id; }
  return ok(await supabase.from("ticket_web_tramos").insert(fila).select("id").single()).id;
}
export async function webBorrarTramo(id) { ok(await supabase.from("ticket_web_tramos").delete().eq("id", id).eq("vendidas", 0)); }
// Archivos públicos del evento (flyer, logo, autorización): carpeta del usuario/evento
export async function webSubir(eventoId, tipo, file) {
  const { data: u } = await supabase.auth.getUser();
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
  const path = `${u.user.id}/${eventoId}/${tipo}-${Date.now()}.${ext}`;
  ok(await supabase.storage.from("web-eventos").upload(path, file, { cacheControl: "31536000", upsert: false, contentType: file.type }));
  return supabase.storage.from("web-eventos").getPublicUrl(path).data.publicUrl;
}
// Nuevo evento desde el CRM (con una barra por defecto para que el TPV lo pueda abrir)
export async function webNuevoEvento(nombre, inicio) {
  const id = crypto.randomUUID(), fecha = (inicio || new Date().toISOString()).slice(0, 10);
  ok(await supabase.from("ticket_eventos").insert({ id, nombre: nombre.toUpperCase(), fecha, inicio: inicio || null, recinto: "", plantilla: "festival", papel: 80, pie: "", mostrar_evento: true, mostrar_fecha: true, mostrar_hora: true, mostrar_precio: true, anular_pin: false, pin_admin: "1234", pin_supervisor: "0000" }));
  ok(await supabase.from("ticket_puntos").insert({ id: crypto.randomUUID(), evento_id: id, nombre: "Barra", archivado: false }));
  return id;
}
// Duplicar: evento nuevo + ficha + tramos (sin ventas)
export async function webDuplicar(evento, ficha, tramos, nombre) {
  const id = await webNuevoEvento(nombre, null);
  await webGuardarEvento(id, { recinto: evento.venue || "" });
  const nueva = await webActivar({ id, name: nombre });
  const { evento_id, owner_id, slug, contador, actualizado_en, estado, ...resto } = ficha || {};
  if (ficha) await webGuardarFicha(id, { ...resto, estado: "borrador", venta_inicio: null });
  for (const t of tramos || []) await webGuardarTramo({ ...t, id: null, evento_id: id, venta_inicio: null, venta_fin: null });
  return { id, slug: nueva.slug };
}
export async function webVentas(eventoId) {
  const [p, e] = await Promise.all([
    supabase.from("ticket_web_pedidos").select("id, codigo, email, nombre, datos, total, estado, prueba, creado_en").eq("evento_id", eventoId).order("creado_en", { ascending: false }).limit(5000),
    supabase.from("ticket_web_entradas").select("id, pedido_id, numero, asistente, dni, tramo_nombre, precio, estado, prueba, creado_en").eq("evento_id", eventoId).order("numero").limit(20000),
  ]);
  const [c, r] = await Promise.all([
    supabase.from("ticket_canjes").select("venta_uuid, idx, canjeado_en, dispositivo, sin_conexion, punto_id").eq("evento_id", eventoId).eq("origen", "web").limit(20000),
    supabase.from("ticket_canje_rechazos").select("venta_uuid, motivo, detalle, dispositivo, creado_en").eq("evento_id", eventoId).order("creado_en", { ascending: false }).limit(500),
  ]);
  return { pedidos: ok(p), entradas: ok(e), canjes: c.error ? [] : c.data || [], rechazos: r.error ? [] : (r.data || []).filter(x => x.detalle?.web || ["falso", "otro_evento", "ilegible"].includes(x.motivo)) };
}
export async function webReemitir(id, asistente) {
  const r = ok(await supabase.rpc("web_reemitir_entrada", { p_id: id, p_asistente: asistente || null }));
  if (!r?.ok) { const e = new Error(r?.motivo === "nombre" ? "Escribe el nombre completo" : "No se ha podido reemitir"); e.mostrar = true; throw e; }
}
export async function webAnularEntrada(id, anular = true) {
  const r = ok(await supabase.rpc("web_anular_entrada", { p_id: id, p_anular: anular }));
  if (!r?.ok) { const e = new Error(r?.motivo === "sin_sitio" ? "Ese tramo ya está lleno: no se puede recuperar" : "No se ha podido cambiar"); e.mostrar = true; throw e; }
}

/* ===================== Organizaciones (microsite de la marca) ===================== */
export async function orgListar() {
  const { data, error } = await supabase.from("ticket_web_organizaciones").select("*").order("creado_en");
  if (error) throw error;
  return data || [];
}
export async function orgCrear(nombre) {
  const base = slugDe(nombre).slice(0, 50) || "mi-organizacion";
  for (let i = 0; i < 6; i++) {
    const slug = i ? `${base}-${Math.random().toString(36).slice(2, 5)}` : base;
    const r = await supabase.from("ticket_web_organizaciones").insert({ nombre: nombre.trim().slice(0, 80), slug: slug.length < 3 ? slug + "-org" : slug, diseno: {} }).select("*").single();
    if (!r.error) return r.data;
    if (r.error.code !== "23505") throw r.error;
  }
  throw new Error("No se ha podido crear el enlace");
}
export async function orgGuardar(id, patch) {
  ok(await supabase.from("ticket_web_organizaciones").update({ ...patch, actualizado_en: new Date().toISOString() }).eq("id", id));
}
export async function orgCambiarSlug(id, slug) {
  const s = slugDe(slug).slice(0, 60);
  if (s.length < 3) throw new Error("El enlace necesita al menos 3 letras");
  const r = await supabase.from("ticket_web_organizaciones").update({ slug: s }).eq("id", id);
  if (r.error) throw new Error(r.error.code === "23505" ? "Ese enlace ya lo usa otra organización" : "No se ha podido cambiar el enlace");
  return s;
}
export async function orgBorrar(id) { ok(await supabase.from("ticket_web_organizaciones").delete().eq("id", id)); }
export async function orgSubir(orgId, tipo, file) {
  const { data: u } = await supabase.auth.getUser();
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
  const path = `${u.user.id}/org-${orgId}/${tipo}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
  ok(await supabase.storage.from("web-eventos").upload(path, file, { cacheControl: "31536000", upsert: false, contentType: file.type }));
  return supabase.storage.from("web-eventos").getPublicUrl(path).data.publicUrl;
}
// Eventos con venta online de la cuenta (para asignarlos a una organización)
export async function orgEventos() {
  const { data, error } = await supabase.from("ticket_web_eventos").select("evento_id, slug, estado, modo, flyer_url, organizacion_id, ticket_eventos(nombre, fecha, inicio, fin)");
  if (error) throw error;
  return (data || []).map(x => ({ ...x, nombre: x.ticket_eventos?.nombre, fecha: x.ticket_eventos?.fecha, inicio: x.ticket_eventos?.inicio, fin: x.ticket_eventos?.fin }))
    .sort((a, b) => String(b.inicio || b.fecha || "").localeCompare(String(a.inicio || a.fecha || "")));
}
export async function orgAsignarEvento(eventoId, orgId) { ok(await supabase.from("ticket_web_eventos").update({ organizacion_id: orgId }).eq("evento_id", eventoId)); }
export async function orgPublica(slug) {
  const { data, error } = await supabase.rpc("web_organizacion_publica", { p_slug: slug });
  if (error) throw error;
  return data;
}

/* ===================== CLIENTES (compradores de entradas) ===================== */
// Todo pasa por RLS: cada organizador solo ve a sus compradores.
export async function clientesCargar(eventoId = null, pruebas = false) {
  const { data, error } = await supabase.rpc("crm_clientes", { p_evento: eventoId, p_pruebas: pruebas });
  if (error) throw error;
  return data;
}
// Derecho de acceso / portabilidad: todo lo que hay de una persona, en un archivo
export async function clienteExportar(email) {
  const em = String(email || "").toLowerCase();
  const { data: ps, error } = await supabase.from("ticket_web_pedidos").select("id, evento_id, codigo, email, nombre, datos, total, estado, prueba, marketing, privacidad_version, creado_en").eq("email", em);
  if (error) throw error;
  const ids = (ps || []).map(p => p.id);
  const { data: es } = ids.length ? await supabase.from("ticket_web_entradas").select("pedido_id, numero, asistente, dni, tramo_nombre, precio, estado, creado_en").in("pedido_id", ids) : { data: [] };
  const { data: baja } = await supabase.from("ticket_web_bajas").select("origen, creado_en").eq("email", em).maybeSingle();
  const evIds = [...new Set((ps || []).map(p => p.evento_id))];
  const { data: evs } = evIds.length ? await supabase.from("ticket_eventos").select("id, nombre, fecha").in("id", evIds) : { data: [] };
  const evDe = Object.fromEntries((evs || []).map(e => [e.id, e]));
  return { exportado_en: new Date().toISOString(), email: em, baja_comunicaciones: baja || null,
    pedidos: (ps || []).map(p => ({ ...p, evento: evDe[p.evento_id]?.nombre, fecha_evento: evDe[p.evento_id]?.fecha, entradas: (es || []).filter(x => x.pedido_id === p.id).map(({ pedido_id, ...x }) => x) })) };
}
// Derecho de oposición: no volver a enviarle comunicaciones (o deshacerlo si fue un error)
export async function clienteBaja(email, baja = true) {
  const em = String(email || "").toLowerCase();
  if (baja) ok(await supabase.from("ticket_web_bajas").upsert({ email: em, origen: "crm", creado_en: new Date().toISOString() }, { onConflict: "owner_id,email" }));
  else ok(await supabase.from("ticket_web_bajas").delete().eq("email", em));
}
// Derecho de supresión
export async function clienteBorrar(email) {
  const { data, error } = await supabase.rpc("crm_cliente_borrar", { p_email: email });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.motivo === "entradas_futuras" ? "Tiene entradas para un evento que aún no ha pasado: anúlalas antes de borrar sus datos." : "No se ha podido borrar");
  return data;
}
// Datos del responsable del tratamiento (salen en la información de privacidad de la web)
export async function legalLeer() {
  const { data, error } = await supabase.from("ticket_web_legal").select("*").maybeSingle();
  if (error) throw error;
  return data || { razon_social: "", nif: "", direccion: "", email: "", conservar_meses: 24 };
}
export async function legalGuardar(d) {
  const limpio = (v, n) => String(v || "").trim().slice(0, n) || null;
  ok(await supabase.from("ticket_web_legal").upsert({ razon_social: limpio(d.razon_social, 160), nif: limpio(d.nif, 20)?.toUpperCase() || null, direccion: limpio(d.direccion, 240), email: limpio(d.email, 160)?.toLowerCase() || null, conservar_meses: Math.min(120, Math.max(6, Number(d.conservar_meses) || 24)), actualizado_en: new Date().toISOString() }, { onConflict: "owner_id" }));
}

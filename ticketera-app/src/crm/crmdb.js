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
  origen: i.origen, refExterna: i.ref_externa || null, unidades: i.unidades != null ? Number(i.unidades) : null, nota: i.nota || "", creadoEn: i.creado_en,
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
  const [ing, gs, fp] = await Promise.all([
    todas(() => supabase.from("ticket_crm_ingresos").select("*").order("id", { ascending: true })),
    todas(() => supabase.from("ticket_crm_gastos").select("*").order("id", { ascending: true })),
    supabase.from("ticket_crm_fuentes_punto").select("*"),
  ]);
  return { ingresos: ing.map(ingresoFrom), gastos: gs.map(gastoFrom), fuentes: Object.fromEntries(ok(fp).map(x => [x.punto_id, x.fuente])) };
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

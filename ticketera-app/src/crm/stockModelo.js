// ===================== CRM · STOCK · modelo y cálculos =====================
// Consumo real       = entradas − devoluciones − recuento final
// Consumo justificado = ventas TPV × receta + invitaciones × receta + mermas + consumo interno
// Diferencia          = real − justificado   (se muestra a coste; nunca se llama "robo")
import { r2, isInvite } from "./ui";

export const FAMILIAS = [
  { k: "destilado", t: "Destilados y licores", corto: "Destilados", i: "bottle", c: "#a855f7", medida: "ml" },
  { k: "refresco", t: "Refrescos", corto: "Refrescos", i: "soda", c: "#ff5a3c", medida: "ml" },
  { k: "cerveza", t: "Cerveza", corto: "Cerveza", i: "beer", c: "#eab308", medida: "ud" },
  { k: "agua", t: "Agua", corto: "Agua", i: "drop", c: "#0ea5e9", medida: "ud" },
  { k: "energetica", t: "Energéticas", corto: "Energéticas", i: "bolt", c: "#22d3a6", medida: "ud" },
  { k: "vaso", t: "Vasos", corto: "Vasos", i: "cup", c: "#94a3b8", medida: "ud" },
  { k: "envase", t: "Envases retornables", corto: "Envases", i: "crate", c: "#64748b", medida: "ud", noAudita: true },
  { k: "otros", t: "Otros", corto: "Otros", i: "dots", c: "#838aa0", medida: "ud" },
];
export const famInfo = (k) => FAMILIAS.find(f => f.k === k) || FAMILIAS[FAMILIAS.length - 1];
export const UNIDADES = [{ k: "botella", t: "Botella", pl: "botellas" }, { k: "lata", t: "Lata", pl: "latas" }, { k: "unidad", t: "Unidad", pl: "unidades" }, { k: "caja", t: "Caja", pl: "cajas" }, { k: "brik", t: "Brik", pl: "briks" }, { k: "barril", t: "Barril", pl: "barriles" }];
export const uniTxt = (k, n) => { const u = UNIDADES.find(x => x.k === k) || UNIDADES[2]; return Math.abs(n) === 1 ? u.t.toLowerCase() : u.pl; };
export const TIPOS_MOV = [
  { k: "entrada", t: "Entrada", largo: "Entrada de mercancía", i: "plus", c: "var(--green)", ink: "#04241b" },
  { k: "devolucion", t: "Devolución", largo: "Devolución al proveedor", i: "truck", c: "#3b82f6", ink: "#fff" },
  { k: "merma", t: "Merma", largo: "Merma o rotura", i: "alert", c: "var(--amber)", ink: "#1a1205" },
  { k: "interno", t: "Consumo interno", largo: "Consumo interno (personal, artistas)", i: "users", c: "#a855f7", ink: "#fff" },
];
const TIPOS_EXTRA = [
  { k: "traspaso_entrada", t: "Del almacén", largo: "Traído del almacén", i: "box", c: "#14b8a6", ink: "#fff" },
  { k: "traspaso_salida", t: "Al almacén", largo: "Guardado en el almacén", i: "box", c: "#64748b", ink: "#fff" },
];
export const tipoInfo = (k) => TIPOS_MOV.find(t => t.k === k) || TIPOS_EXTRA.find(t => t.k === k) || TIPOS_MOV[0];
export const STOCK_DEF = { copaMl: 50, chupitoMl: 30, refrescoMl: 200, botellaMl: 700 };
export const stockCfg = (ajustes) => ({ ...STOCK_DEF, ...((ajustes || {}).stock || {}) });

// Formato legible de un número (coma decimal, sin ceros sobrantes)
export const num = (v, d = 2) => { const x = r2(Number(v) || 0); return x.toLocaleString("es-ES", { maximumFractionDigits: d, useGrouping: "always" }); };
// Cantidad de una familia en su medida (ml → litros)
export const medidaTxt = (fam, v) => (famInfo(fam).medida === "ml" ? `${num(v / 1000, 1)} L` : `${num(v, 1)} ud`);
// Cantidad de un artículo en cajas + sueltas: "30 cajas = 720 botellas"
export function cantTxt(a, unidades) {
  const u = Number(unidades) || 0;
  if (!a || a.porCaja <= 1) return `${num(u, 2)} ${uniTxt(a?.unidad, u)}`;
  const cajas = Math.floor(u / a.porCaja + 1e-9), sueltas = r2(u - cajas * a.porCaja);
  const partes = [cajas ? `${num(cajas, 0)} ${cajas === 1 ? "caja" : "cajas"}` : null, sueltas ? `${num(sueltas, 2)} sueltas` : null].filter(Boolean).join(" + ");
  return `${partes || "0"} = ${num(u, 2)} ${uniTxt(a.unidad, u)}`;
}
// Medida de un artículo en su familia: ml por unidad (familias en ml) o 1
export const factor = (a) => (famInfo(a.familia).medida === "ml" ? (Number(a.ml) || 0) : 1);
export const formato = (a) => [a.ml ? (a.ml >= 1000 ? `${num(a.ml / 1000, 2)} L` : `${a.ml} ml`) : null, a.porCaja > 1 ? `caja de ${a.porCaja}` : null, a.retornable ? "retornable" : null].filter(Boolean).join(" · ");

// ---- Recetas: sugerencia por el nombre del producto del TPV ----
export function sugerirReceta(nombre, cfg = STOCK_DEF) {
  const n = String(nombre || "").toLowerCase();
  if (/entrada|ticket|taquilla|guardarropa|pulsera|reserva|acceso|parking|consumici[oó]n|bono/.test(n)) return [];
  if (/chupit|shot|chupi/.test(n)) return [{ familia: "destilado", cantidad: cfg.chupitoMl }];
  if (/copa|cubata|combinad|gin|\bron\b|whisk|vodka|tequila|premium|c[oó]ctel|cocktail|mojito/.test(n)) return [{ familia: "destilado", cantidad: cfg.copaMl }, { familia: "refresco", cantidad: cfg.refrescoMl }];
  if (/cerve|ca[ñn]a|tercio|botell[ií]n|estrella|mahou|heineken|alhambra|amstel|cruzcampo|lata/.test(n)) return [{ familia: "cerveza", cantidad: 1 }];
  if (/agua/.test(n)) return [{ familia: "agua", cantidad: 1 }];
  if (/red ?bull|energ|monster|contact|burn/.test(n)) return [{ familia: "energetica", cantidad: 1 }];
  if (/refresc|coca|fanta|sprite|t[oó]nica|schweppes|nestea|aquarius|zumo/.test(n)) return [{ familia: "refresco", cantidad: cfg.refrescoMl }];
  return null; // no sabemos: hay que decirlo
}
export const recetaTxt = (items, articulos = []) => !items ? "Sin receta" : items.length === 0 ? "No gasta stock" : items.map(it => {
  const f = famInfo(it.familia), a = it.articuloId ? articulos.find(x => x.id === it.articuloId) : null;
  const qty = f.medida === "ml" ? `${num(it.cantidad, 0)} ml` : `${num(it.cantidad, 2)}`;
  return `${qty} ${a ? a.nombre : f.corto.toLowerCase()}`;
}).join(" + ");

// ---- Reservados VIP: cada tarifa o extra sabe cuántas botellas lleva (configuración del evento) ----
export function botellasReservados(ev) {
  const c = ev?.style?.reservados || {};
  const out = {};
  [...(Array.isArray(c.tarifas) ? c.tarifas : []), ...(Array.isArray(c.extras) ? c.extras : [])].forEach(it => {
    const k = String(it?.nombre || "").trim().toUpperCase(); if (k) out[k] = Math.max(0, Number(it.botellas) || 0);
  });
  return out;
}
const recetaReservado = (botellas, cfg) => botellas > 0 ? [{ familia: "destilado", cantidad: botellas * (Number(cfg.botellaMl) || STOCK_DEF.botellaMl) }] : [];

// ---- Productos del TPV del evento con lo vendido (los bonos se descomponen en sus productos) ----
export function productosEvento(ev, sales) {
  const out = {};
  const add = (name, campo, q) => { const k = String(name || "").trim().toUpperCase(); if (!k) return; const x = out[k] = out[k] || { nombre: k, vendidas: 0, invitaciones: 0, color: null }; x[campo] += q; };
  ev.puntos.forEach(p => (p.products || []).forEach(pr => { add(pr.name, "vendidas", 0); const k = String(pr.name || "").trim().toUpperCase(); if (out[k] && !out[k].color) out[k].color = pr.color || null; }));
  (sales || []).filter(s => s.eventId === ev.id && !s.voided).forEach(s => {
    const campo = isInvite(s) ? "invitaciones" : "vendidas";
    if (s.productId) { add(s.name, campo, 1); return; }
    const punto = ev.puntos.find(p => p.id === s.puntoId);
    const combo = (punto?.combos || []).find(c => c.name === s.name);
    if (combo) (combo.items || []).forEach(it => { const pr = punto.products.find(x => x.id === it.productId); if (pr) add(pr.name, campo, it.qty || 1); });
    else add(s.name, campo, 1);
  });
  return Object.values(out).sort((a, b) => (b.vendidas + b.invitaciones) - (a.vendidas + a.invitaciones) || a.nombre.localeCompare(b.nombre));
}

// ---- Cálculo completo del stock de un evento ----
export function calcularStock({ ev, sales, articulos, movimientos, recetas, conteo, lineas, cfg }) {
  const artById = Object.fromEntries(articulos.map(a => [a.id, a]));
  const anulados = new Set(movimientos.filter(m => m.tipo === "anulacion").map(m => m.anulaId));
  const validos = movimientos.filter(m => m.tipo !== "anulacion" && !anulados.has(m.id));
  const porArt = {};
  const art = (id) => porArt[id] = porArt[id] || { entrada: 0, devolucion: 0, devolTras: 0, merma: 0, interno: 0, costeEntrada: 0 };
  validos.forEach(m => {
    const x = art(m.articuloId);
    // Traspasos con el almacén: entrar desde el almacén = entrada; guardar en el almacén = salida como una devolución
    const tipo = m.tipo === "traspaso_entrada" ? "entrada" : m.tipo === "traspaso_salida" ? "devolucion" : m.tipo;
    if (tipo === "devolucion" && m.trasRecuento) { x.devolTras = r2(x.devolTras + m.cantidad); return; } // sale de lo ya contado: no cambia el consumo
    x[tipo] = r2(x[tipo] + m.cantidad);
    if (tipo === "entrada") { const a = artById[m.articuloId]; x.costeEntrada += m.cantidad * (m.costeUnidad ?? a?.coste ?? 0); }
  });
  const contadoArt = Object.fromEntries((lineas || []).map(l => [l.articuloId, l]));
  const recetaMap = Object.fromEntries((recetas || []).map(r => [r.producto, r.items]));
  const resBot = botellasReservados(ev);

  // Productos vendidos → consumo por familia (y por artículo cuando la receta lo nombra)
  const productos = productosEvento(ev, sales).map(p => {
    const guardada = recetaMap[p.nombre];
    // Reservados: la sugerencia sale de sus botellas (un reservado con 2 botellas gasta 2 botellas de destilado)
    const items = guardada !== undefined ? guardada : resBot[p.nombre] !== undefined ? recetaReservado(resBot[p.nombre], cfg) : sugerirReceta(p.nombre, cfg);
    return { ...p, items, estado: guardada !== undefined ? (guardada.length ? "confirmada" : "nogasta") : items === null ? "sinreceta" : items.length ? "sugerida" : "nogasta-sugerida" };
  });
  const tpvFam = {}, tpvArt = {};
  productos.forEach(p => (p.items || []).forEach(it => {
    const q = (p.vendidas + p.invitaciones) * (Number(it.cantidad) || 0);
    tpvFam[it.familia] = (tpvFam[it.familia] || 0) + q;
    if (it.articuloId && artById[it.articuloId]) { const f = factor(artById[it.articuloId]) || 1; tpvArt[it.articuloId] = (tpvArt[it.articuloId] || 0) + q / f; }
  }));
  const famUsadas = new Set(productos.flatMap(p => (p.items || []).map(it => it.familia)));

  // Por artículo
  const filas = articulos.map(a => {
    const x = porArt[a.id] || { entrada: 0, devolucion: 0, devolTras: 0, merma: 0, interno: 0, costeEntrada: 0 };
    const l = contadoArt[a.id];
    const tiene = x.entrada > 0 || x.devolucion > 0 || x.devolTras > 0 || x.merma > 0 || x.interno > 0;
    const final = l ? Number(l.total) : null;
    const real = final == null ? null : r2(x.entrada - x.devolucion - final);
    const deberia = r2(x.entrada - x.devolucion - x.merma - x.interno - (tpvArt[a.id] || 0));
    const costeU = x.entrada > 0 ? x.costeEntrada / x.entrada : (a.coste ?? 0);
    return { a, ...x, tiene, final, real, deberia, costeU };
  });
  const enJuego = filas.filter(f => f.tiene || f.final != null);

  // Por familia
  const familias = FAMILIAS.map(F => {
    const fs = enJuego.filter(f => f.a.familia === F.k);
    if (!fs.length && !tpvFam[F.k]) return null;
    const m = (f) => factor(f.a) || (F.medida === "ml" ? 0 : 1);
    const entra = r2(fs.reduce((t, f) => t + f.entrada * m(f), 0));
    const devuelto = r2(fs.reduce((t, f) => t + (f.devolucion + (F.noAudita ? f.devolTras : 0)) * m(f), 0));
    const devueltoTras = r2(fs.reduce((t, f) => t + f.devolTras * m(f), 0));
    const merma = r2(fs.reduce((t, f) => t + (f.merma + f.interno) * m(f), 0));
    const sinContar = fs.filter(f => f.final == null && (f.entrada - f.devolucion) > 0);
    const contados = fs.filter(f => f.final != null);
    const final = r2(contados.reduce((t, f) => t + f.final * m(f), 0));
    const tpv = r2(tpvFam[F.k] || 0);
    const justificado = r2(tpv + merma);
    const hayRecuento = contados.length > 0;
    const real = hayRecuento ? r2(entra - devuelto - final) : null;
    const dif = hayRecuento ? r2(real - justificado) : null;
    const unidadesEntra = fs.reduce((t, f) => t + f.entrada, 0);
    const medidaMedia = unidadesEntra > 0 ? entra / unidadesEntra : (F.medida === "ml" ? 700 : 1);
    const costeMedida = entra > 0 ? fs.reduce((t, f) => t + f.costeEntrada, 0) / entra : 0;
    const tolerancia = Math.max(Math.abs(real || 0) * 0.05, 2 * medidaMedia);
    const usada = famUsadas.has(F.k);
    let estado = "pendiente";
    if (F.noAudita) estado = "info";
    else if (conteo && sinContar.length) estado = "incompleto"; // con artículos sin contar no se puede saber si cuadra
    else if (!hayRecuento) estado = "pendiente";
    else if (!usada) estado = "sinreceta";
    else if (Math.abs(dif) <= tolerancia) estado = "cuadra";
    else estado = dif > 0 ? "falta" : "sobra";
    return {
      ...F, entra, devuelto, devueltoTras, merma, tpv, justificado, final, real, dif, tolerancia, costeMedida, usada, estado, sinContar, medidaMedia,
      deberia: r2(entra - devuelto - justificado), difCoste: dif != null ? r2(dif * costeMedida) : null,
      consumidoCoste: real != null ? r2(real * costeMedida) : null, valorEntrada: r2(fs.reduce((t, f) => t + f.costeEntrada, 0)),
    };
  }).filter(Boolean);

  // Fiabilidad del dato
  const conEntrada = enJuego.filter(f => (f.entrada - f.devolucion) > 0 && famInfo(f.a.familia).noAudita !== true);
  const contadosPct = conEntrada.length ? Math.round(conEntrada.filter(f => f.final != null).length / conEntrada.length * 100) : 0;
  const ventas = productos.reduce((t, p) => t + p.vendidas + p.invitaciones, 0);
  const conRecetaOk = productos.filter(p => p.estado === "confirmada" || p.estado === "nogasta").reduce((t, p) => t + p.vendidas + p.invitaciones, 0);
  const sinReceta = productos.filter(p => p.estado === "sinreceta" && (p.vendidas + p.invitaciones) > 0);
  const recetaPct = ventas ? Math.round(conRecetaOk / ventas * 100) : 100;
  const sellado = conteo?.estado === "sellado";
  const nivel = sellado && contadosPct === 100 && recetaPct >= 90 ? "alta" : contadosPct >= 80 && recetaPct >= 60 ? "media" : "baja";

  const auditables = familias.filter(f => !f.noAudita);
  const faltaCoste = r2(auditables.filter(f => f.estado === "falta").reduce((t, f) => t + f.difCoste, 0));
  const sobraCoste = r2(auditables.filter(f => f.estado === "sobra").reduce((t, f) => t + f.difCoste, 0));
  const valorEntrada = r2(familias.reduce((t, f) => t + f.valorEntrada, 0));
  const consumidoCoste = r2(auditables.filter(f => f.estado !== "incompleto").reduce((t, f) => t + (f.consumidoCoste || 0), 0));
  const incompletas = auditables.filter(f => f.estado === "incompleto");
  return { filas, enJuego, familias, productos, fiabilidad: { contadosPct, recetaPct, sellado, nivel, sinReceta, conEntrada: conEntrada.length }, faltaCoste, sobraCoste, valorEntrada, consumidoCoste, incompletas, nMovs: validos.length };
}

// ---- Catálogo de partida: Distribuciones Monteagudo (códigos y costes por unidad sacados de sus facturas, sin IVA) ----
export const CATALOGO_MONTEAGUDO = [
  ["3675", "Ginebra Larios Rosé 70 cl", "destilado", "botella", 700, 1, 12.014],
  ["1013", "Ginebra Larios 1 L", "destilado", "botella", 1000, 1, 10.3572],
  ["1660", "Ron Barceló Añejo 70 cl", "destilado", "botella", 700, 1, 12.365],
  ["1686", "Ron Negrita 70 cl", "destilado", "botella", 700, 1, 7.9],
  ["2015", "Vodka Absolut 70 cl", "destilado", "botella", 700, 1, 11.4558],
  ["2028", "Vodka Smirnoff 70 cl", "destilado", "botella", 700, 1, 9.5567],
  ["2054", "Whisky J&B 70 cl", "destilado", "botella", 700, 1, 10.573],
  ["2032", "Whisky Ballantine's 70 cl", "destilado", "botella", 700, 1, 11.3493],
  ["2038", "Whisky Cutty Sark 70 cl", "destilado", "botella", 700, 1, 10.4359],
  ["1822", "Tequila José Cuervo Reposado 70 cl", "destilado", "botella", 700, 1, 13.14],
  ["4577", "Tequila Maxica Fresa 70 cl", "destilado", "botella", 700, 1, 7.1933],
  ["97", "Jägermeister 70 cl", "destilado", "botella", 700, 1, 11.5733],
  ["3246", "Coca-Cola 237 ml retornable", "refresco", "botella", 237, 24, 0.8544, true, "784"],
  ["4346", "Fanta Limón 237 ml retornable", "refresco", "botella", 237, 24, 0.7471, true, "784"],
  ["4345", "Fanta Naranja 237 ml retornable", "refresco", "botella", 237, 24, 0.7471, true, "784"],
  ["1787", "Sprite 200 ml retornable", "refresco", "botella", 200, 24, 0.6232, true, "784"],
  ["2169", "Schweppes Tónica 200 ml", "refresco", "botella", 200, 24, 0.6875],
  ["2143", "Schweppes Tónica 1 L PET", "refresco", "botella", 1000, 12, 1.5042],
  ["707994", "Schweppes Limón 1,5 L PET", "refresco", "botella", 1500, 6, 2.2507],
  ["640", "Coca-Cola 2 L PET", "refresco", "botella", 2000, 6, 1.7229],
  ["924", "Fanta Naranja 2 L PET", "refresco", "botella", 2000, 6, 1.4633],
  ["916", "Fanta Limón 2 L PET", "refresco", "botella", 2000, 6, 1.4633],
  ["1785", "Sprite 2 L PET", "refresco", "botella", 2000, 6, 1.3375],
  ["0210", "Estrella Galicia 1/3 retornable", "cerveza", "botella", 330, 24, 0.8734, true, "707662"],
  ["700198", "Estrella Galicia lata 33 cl", "cerveza", "lata", 330, 24, 0.6354],
  ["701732", "Agua Fontarel 33 cl", "agua", "botella", 330, 12, 0.1879],
  ["708057", "Contact energética 25 cl", "energetica", "lata", 250, 1, 0.37],
  ["1898", "Vaso chupito (paquete)", "vaso", "unidad", null, 1, 0.89, false, null, true],
  ["1911", "Vaso tubo irrompible (paquete)", "vaso", "unidad", null, 1, 0.79, false, null, true],
  ["6523", "Vaso cristal tubo 31 cl", "vaso", "unidad", null, 1, 0.5849, false, null, true],
  ["784", "Envase Coca-Cola / Fanta / Sprite", "envase", "caja", null, 1, 4.8049, true],
  ["707662", "Envase Estrella Galicia 1/3", "envase", "caja", null, 1, 2.57, true],
].map(([codigo, nombre, familia, unidad, ml, porCaja, coste, retornable = false, envaseCodigo = null, confirmar = false], i) =>
  ({ codigo, nombre, familia, unidad, ml, porCaja, coste, retornable, envaseCodigo, confirmar, proveedor: "Monteagudo", orden: i }));

// ---- Artículo sugerido a partir de la descripción de una línea de factura ----
export function articuloDesdeLinea(desc, codigo, proveedor) {
  const d = String(desc || "").toUpperCase();
  const familia = /ENVASE|CASCO|FIANZA/.test(d) ? "envase" : /VASO|COPA PL|CHUPITO TRANSP/.test(d) ? "vaso"
    : /GINEBRA|\bGIN\b|\bRON\b|WHISK|VODKA|TEQUILA|LICOR|JAGER|BRANDY|CO[ÑN]AC|ANIS|PACHAR|BAILEYS|MARTINI|VERMUT/.test(d) ? "destilado"
    : /CERVEZA|ESTRELLA|MAHOU|HEINEKEN|ALHAMBRA|AMSTEL|CRUZCAMPO|DAMM|1\/3/.test(d) ? "cerveza"
    : /AGUA/.test(d) ? "agua" : /ENERG|RED ?BULL|MONSTER|CONTACT|BURN/.test(d) ? "energetica"
    : /COCA|FANTA|SPRITE|SCHWEPPES|T[OÓ]NICA|NESTEA|AQUARIUS|REFRESCO|LIM[OÓ]N|NARANJA|7UP|PEPSI/.test(d) ? "refresco" : "otros";
  const pack = d.match(/\*\s*(\d{1,3})\b/) || d.match(/\bX\s*(\d{1,3})\b/);
  let ml = null;
  const mL = d.match(/(\d+(?:[.,]\d+)?)\s*(?:L\b|LITROS?)/), mCl = d.match(/(\d+(?:[.,]\d+)?)\s*CL/), mMl = d.match(/(\d{3})\s*ML/), m13 = /1\/3/.test(d), m07 = d.match(/\b0[.,]70\b/);
  if (mMl) ml = Number(mMl[1]); else if (mCl) ml = Math.round(parseFloat(mCl[1].replace(",", ".")) * 10); else if (mL) ml = Math.round(parseFloat(mL[1].replace(",", ".")) * 1000); else if (m13) ml = 330; else if (m07) ml = 700;
  if (familia === "envase" || familia === "vaso") ml = null;
  const unidad = familia === "envase" ? "caja" : /LATA/.test(d) || familia === "energetica" ? "lata" : familia === "vaso" || familia === "otros" ? "unidad" : "botella";
  const porCaja = familia === "destilado" || familia === "envase" || familia === "vaso" ? 1 : pack ? Math.max(1, Number(pack[1])) : 1;
  const nombre = d.replace(/\s+/g, " ").replace(/[."]+$/g, "").trim().toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()).slice(0, 80);
  return { nombre, familia, unidad, ml, porCaja, codigo: String(codigo || ""), proveedor: proveedor || "", retornable: /RETORN/.test(d) && !/NO RETORN/.test(d), confirmar: familia === "vaso", activo: true };
}

// ---- Propuesta de devolución del sobrante (lo que queda CERRADO en el recuento, menos lo ya devuelto) ----
export function propuestaDevolucion({ articulos, lineas, movimientos }) {
  const anulados = new Set(movimientos.filter(m => m.tipo === "anulacion").map(m => m.anulaId));
  const yaDevuelto = {};
  movimientos.filter(m => (m.tipo === "devolucion" || m.tipo === "traspaso_salida") && m.trasRecuento && !anulados.has(m.id)).forEach(m => { yaDevuelto[m.articuloId] = (yaDevuelto[m.articuloId] || 0) + m.cantidad; });
  return (lineas || []).map(l => {
    const a = articulos.find(x => x.id === l.articuloId);
    if (!a || famInfo(a.familia).noAudita) return null;
    const cerradas = r2(l.cajas * (a.porCaja || 1) + l.sueltas);
    const pendiente = r2(Math.max(0, cerradas - (yaDevuelto[a.id] || 0)));
    return { a, cerradas, yaDevuelto: yaDevuelto[a.id] || 0, pendiente };
  }).filter(x => x && (x.cerradas > 0));
}

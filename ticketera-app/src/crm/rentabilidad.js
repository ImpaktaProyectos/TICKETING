// ===================== CRM · RENTABILIDAD: cuánto deja cada producto de la barra =====================
// Sin base de datos ni interfaz (se puede probar con node). Todo sin IVA, que es lo que de verdad te quedas.
//   Precio sin IVA      = lo cobrado ÷ (1 + IVA de barra)
//   Coste por unidad    = coste a mano  ·  o la receta de Stock × coste del catálogo  ·  o la receta sugerida (estimado)
//   Beneficio por unidad = precio sin IVA − datáfono − coste
//   Beneficio total     = beneficio por unidad × vendidas − coste de las invitaciones
// Es el beneficio de BARRA: no incluye personal, alquiler ni artistas (eso está en Gastos y en el Panel).

const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const r4 = (v) => Math.round((Number(v) + Number.EPSILON) * 10000) / 10000;
const esInv = (s) => !!(s && (s.invite || /^invitacion/.test(s.pago || "")));
const clave = (n) => String(n || "").trim().toUpperCase();
// Familias que se miden en ml (el resto, por unidades). Igual que en Stock.
const FAM_ML = new Set(["destilado", "refresco"]);

export const RENT_DEF = { ivaBarra: 10, tarjetaPct: 0, extraCopa: 0, objetivo: 75, datafono: true, costes: {} };
// Ajustes de la sección (guardados en los ajustes del CRM, bloque «rentabilidad») + IVA y datáfono de Comisiones e IVA
export function rentCfg(ajustes = {}) {
  const r = ajustes.rentabilidad || {};
  const iva = Number(ajustes.iva?.ventas?.barra);
  const tar = Number(ajustes.comisiones?.tarjeta);
  return {
    ivaBarra: Number.isFinite(iva) && iva >= 0 ? iva : RENT_DEF.ivaBarra,
    tarjetaPct: Number.isFinite(tar) && tar > 0 ? tar : 0,
    extraCopa: Math.max(0, Number(r.extraCopa) || 0),
    objetivo: Math.min(95, Math.max(0, Number(r.objetivo ?? RENT_DEF.objetivo) || 0)),
    datafono: r.datafono !== false,
    costes: r.costes && typeof r.costes === "object" ? r.costes : {},
  };
}

// Comisión de proveedor vigente cuando se vendió (style.comisiones[productId] = [{ desde, proveedor, pct }], igual que en Liquidación)
export function comisionEnFecha(ev, productId, ts) {
  const l = (ev?.style?.comisiones || {})[productId]; if (!l || !l.length) return null;
  let e = null; for (const x of l) { if ((x.desde || 0) <= (ts || 0)) e = x; else break; }
  return e && e.proveedor && e.pct != null ? e : null;
}

// ---- Ventas por producto (los bonos se reparten entre sus productos según su precio de carta) ----
// incluirPunto: qué barras cuentan (por defecto todas; el CRM deja fuera la taquilla de entradas).
// Productos de proveedor: de cada venta solo es tuyo su %; el resto («paraProveedor») es para el proveedor.
export function ventasPorProducto(events, sales, { eventIds = null, puntoId = null, incluirPunto = null } = {}) {
  const out = {};
  const evs = events.filter(e => !eventIds || eventIds.has(e.id));
  const evById = Object.fromEntries(evs.map(e => [e.id, e]));
  const vale = (p) => p && (!puntoId || p.id === puntoId) && (!incluirPunto || incluirPunto(p));
  const fila = (nombre, pr) => {
    const k = clave(nombre); if (!k) return null;
    const x = out[k] = out[k] || { nombre: k, uds: 0, inv: 0, ingresos: 0, tarjeta: 0, provUds: 0, paraProveedor: 0, proveedor: null, color: null, precioCarta: null };
    if (pr) { if (!x.color) x.color = pr.color || null; if (x.precioCarta == null && Number(pr.price) > 0) x.precioCarta = Number(pr.price); }
    return x;
  };
  // Los productos que están en la carta aparecen aunque no se hayan vendido
  evs.forEach(e => e.puntos.forEach(p => { if (!vale(p)) return; (p.products || []).forEach(pr => fila(pr.name, pr)); }));
  sales.forEach(s => {
    const e = evById[s.eventId]; if (!e || s.voided) return;
    const punto = e.puntos.find(p => p.id === s.puntoId);
    if (!vale(punto)) return;
    const inv = esInv(s), precio = Number(s.price) || 0, tar = s.pago === "tarjeta";
    const sumar = (pr, nombre, q, importe) => {
      const x = fila(nombre, pr); if (!x) return;
      if (inv) { x.inv += q; return; }
      x.uds += q; x.ingresos += importe; if (tar) x.tarjeta += importe;
      const com = pr && comisionEnFecha(e, pr.id, s.ts);
      if (com) { x.provUds += q; x.paraProveedor += importe * (1 - Math.min(100, Math.max(0, Number(com.pct))) / 100); x.proveedor = com.proveedor; }
    };
    const combo = !s.productId && (punto?.combos || []).find(c => c.name === s.name);
    if (combo) {
      const items = (combo.items || []).map(it => ({ pr: punto.products.find(x => x.id === it.productId), q: it.qty || 1 })).filter(it => it.pr);
      const base = items.reduce((t, it) => t + (Number(it.pr.price) || 0) * it.q, 0);
      items.forEach(it => sumar(it.pr, it.pr.name, it.q, base > 0 ? precio * (Number(it.pr.price) || 0) * it.q / base : precio / items.length));
      return;
    }
    const pr = punto?.products.find(x => x.id === s.productId) || punto?.products.find(x => clave(x.name) === clave(s.name));
    sumar(pr, s.name, 1, precio);
  });
  return Object.values(out);
}

// Coste de 1 ml de destilado con la mezcla de la copa (igual que costeMlMezcla de Stock)
function costeMlMezclaR(pct, articulos) {
  let t = 0, w = 0;
  articulos.forEach(a => { const p = Number(pct?.[a.id]) || 0; if (!p || a.coste == null || !(Number(a.ml) > 0)) return; t += p * Number(a.coste) / Number(a.ml); w += p; });
  return w ? t / w : null;
}

// ---- Coste de una unidad de producto ----
// Coste medio por ml (o por unidad) de cada familia, con los artículos del catálogo que tienen coste
export function costeFamilias(articulos = []) {
  const acc = {};
  articulos.filter(a => a.activo !== false && a.coste != null && Number(a.coste) > 0).forEach(a => {
    const f = FAM_ML.has(a.familia) ? Number(a.ml) || 0 : 1; if (!f) return;
    const x = acc[a.familia] = acc[a.familia] || { t: 0, n: 0 }; x.t += Number(a.coste) / f; x.n++;
  });
  return Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, v.t / v.n]));
}
export function costeItem(it, artById, famCoste) {
  const a = it.articuloId ? artById[it.articuloId] : null;
  const q = Number(it.cantidad) || 0;
  if (a && a.coste != null && Number(a.coste) > 0) {
    const f = FAM_ML.has(a.familia) ? Number(a.ml) || 0 : 1;
    if (f) return { nombre: a.nombre, familia: a.familia, cantidad: q, coste: r4(Number(a.coste) / f * q), origen: "articulo" };
  }
  const m = famCoste[it.familia];
  const mz = it.familia === "destilado" && famCoste.__mezcla != null;
  return { nombre: a?.nombre || null, familia: it.familia, cantidad: q, coste: m != null ? r4(m * q) : null, origen: m == null ? "sin" : mz ? "mezcla" : "media" };
}
// Devuelve { coste, origen: manual|receta|estimado|nogasta|sin, lineas, familia }
export function costeProducto(nombre, { recetaMap = {}, artById = {}, famCoste = {}, cfg = RENT_DEF, sugerir = null }) {
  const k = clave(nombre);
  const manual = cfg.costes?.[k];
  const guardada = recetaMap[k];
  const items = guardada !== undefined ? guardada : sugerir ? sugerir(k) : null;
  const familia = !items || !items.length ? "otros" : (items.find(i => i.familia === "destilado") || items[0]).familia;
  if (manual != null && manual !== "" && Number.isFinite(Number(manual))) return { coste: r4(Number(manual)), origen: "manual", lineas: [], familia };
  if (items == null) return { coste: null, origen: "sin", lineas: [], familia };
  if (!items.length) return { coste: 0, origen: guardada !== undefined ? "nogasta" : "estimado", lineas: [], familia, items };
  const lineas = items.map(it => costeItem(it, artById, famCoste));
  if (cfg.extraCopa > 0 && items.some(i => i.familia === "destilado")) lineas.push({ nombre: "Vaso, hielo y otros", familia: "extra", cantidad: 1, coste: r4(cfg.extraCopa), origen: "extra" });
  if (lineas.some(l => l.coste == null)) return { coste: null, origen: "sin", lineas, familia, items, faltaPrecio: true };
  return { coste: r4(lineas.reduce((t, l) => t + l.coste, 0)), origen: guardada !== undefined ? "receta" : "estimado", lineas, familia, items };
}

// ---- Tipo de producto (ingeniería de menú: Kasavana y Smith) ----
// Se compara con el resto: se vende mucho si supera el 70 % de su parte justa; deja mucho si supera la media ponderada.
export const TIPOS = {
  estrella: { t: "Estrella", c: "var(--green)", consejo: "Se vende mucho y deja mucho. No lo toques: que esté arriba en el TPV y nunca se agote." },
  caballo: { t: "Se vende, deja poco", c: "#3b82f6", consejo: "La gente lo pide pero deja poco. Prueba a subirlo un poco o a abaratar lo que lleva." },
  enigma: { t: "Rentable, se vende poco", c: "var(--amber)", consejo: "Deja mucho pero se pide poco. Dale visibilidad: mejor sitio en el TPV, una promoción o que el camarero lo ofrezca." },
  perro: { t: "Revisar", c: "var(--red)", consejo: "Ni se vende mucho ni deja mucho. Piensa en quitarlo de la carta o meterlo en un bono." },
};
export function clasificar(filas) {
  // Solo productos con coste real (el guardarropa o un servicio sin coste no se comparan con las bebidas)
  const c = filas.filter(f => f.coste != null && f.coste > 0 && f.uds > 0 && f.benUd != null);
  if (c.length < 3) return filas;
  const uds = c.reduce((t, f) => t + f.uds, 0);
  const corteUds = 0.7 * uds / c.length;
  const corteBen = c.reduce((t, f) => t + f.benUd * f.uds, 0) / uds;
  const set = new Set(c);
  return filas.map(f => !set.has(f) ? f : { ...f, tipo: f.uds >= corteUds ? (f.benUd >= corteBen ? "estrella" : "caballo") : (f.benUd >= corteBen ? "enigma" : "perro") });
}

// ---- Cálculo completo ----
// mezcla: reparto de la copa entre destilados ({ artId: % }). Si está, una «copa» genérica cuesta según ese reparto.
export function calcularRentabilidad({ events, sales, eventIds = null, puntoId = null, incluirPunto = null, articulos = [], recetas = [], ajustes = {}, sugerir = null, mezcla = null }) {
  const cfg = rentCfg(ajustes);
  const recetaMap = Object.fromEntries(recetas.map(r => [clave(r.producto), r.items || []]));
  const artById = Object.fromEntries(articulos.map(a => [a.id, a]));
  const famCoste = costeFamilias(articulos);
  const cMz = mezcla ? costeMlMezclaR(mezcla, articulos) : null;
  if (cMz != null) { famCoste.destilado = cMz; famCoste.__mezcla = cMz; }
  const div = 1 + cfg.ivaBarra / 100;
  const filas = ventasPorProducto(events, sales, { eventIds, puntoId, incluirPunto }).map(v => {
    const c0 = costeProducto(v.nombre, { recetaMap, artById, famCoste, cfg, sugerir });
    const propias = v.uds - v.provUds;                   // unidades que pones tú (las del proveedor las pone él)
    // Si todo lo vendido es del proveedor y no hay invitaciones, no hace falta saber su coste
    const c = c0.coste == null && propias <= 0 && v.inv <= 0 && v.uds > 0 ? { ...c0, coste: 0, origen: "proveedor" } : c0;
    const sinIva = v.ingresos / div;
    const provSinIva = v.paraProveedor / div;
    const datafono = cfg.datafono ? v.tarjeta * cfg.tarjetaPct / 100 : 0;
    const precioMedio = v.uds ? v.ingresos / v.uds : v.precioCarta;
    const precioSinIva = precioMedio != null ? precioMedio / div : null;
    const costeVendido = c.coste != null ? c.coste * propias + provSinIva : null;
    const benUd = c.coste == null ? null : v.uds ? (sinIva - datafono - costeVendido) / v.uds : precioSinIva != null ? precioSinIva - c.coste : null;
    const costeInv = c.coste != null ? c.coste * v.inv : null;
    return {
      ...v, ...c, ingresos: r2(v.ingresos), sinIva: r2(sinIva), datafono: r2(datafono), paraProveedor: r2(provSinIva),
      precioMedio: precioMedio != null ? r2(precioMedio) : null, precioSinIva: precioSinIva != null ? r2(precioSinIva) : null,
      costeVendido: costeVendido != null ? r2(costeVendido) : null, costeInv: costeInv != null ? r2(costeInv) : null,
      benUd: benUd != null ? r2(benUd) : null,
      margen: benUd != null && precioSinIva ? Math.round(benUd / precioSinIva * 100) : null,
      pctCoste: c.coste != null && precioSinIva ? Math.round(c.coste / precioSinIva * 100) : null,   // % de coste de la receta (el del sector)
      beneficio: costeVendido != null ? r2(sinIva - datafono - costeVendido - (costeInv || 0)) : null,
      bajoObjetivo: false, tipo: null,
    };
  }).map(f => ({ ...f, bajoObjetivo: f.margen != null && f.uds > 0 && f.coste > 0 && f.margen < cfg.objetivo }));
  const conDatos = clasificar(filas);
  const activas = conDatos.filter(f => f.uds > 0 || f.inv > 0);
  const conCoste = activas.filter(f => f.coste != null);
  const sum = (xs, k) => r2(xs.reduce((t, f) => t + (f[k] || 0), 0));
  const T = {
    uds: activas.reduce((t, f) => t + f.uds, 0), inv: activas.reduce((t, f) => t + f.inv, 0),
    ingresos: sum(activas, "ingresos"), sinIva: sum(activas, "sinIva"),
    costeVendido: sum(conCoste, "costeVendido"), costeInv: sum(conCoste, "costeInv"), datafono: sum(conCoste, "datafono"),
    beneficio: sum(conCoste, "beneficio"), sinIvaConCoste: sum(conCoste, "sinIva"), paraProveedor: sum(conCoste, "paraProveedor"),
    bajoObjetivo: activas.filter(f => f.bajoObjetivo),
    sinCoste: activas.filter(f => f.coste == null), estimados: activas.filter(f => f.origen === "estimado" && f.coste != null),
  };
  T.ventasSinCoste = sum(T.sinCoste, "sinIva");
  // Para «Completar costes»: lo vendido primero y después lo que está en la carta pero aún no se ha vendido
  T.pendientes = conDatos.filter(f => f.coste == null || (f.origen === "estimado" && f.coste != null))
    .sort((a, b) => (b.sinIva - a.sinIva) || a.nombre.localeCompare(b.nombre));
  T.margen = T.sinIvaConCoste > 0 ? Math.round(T.beneficio / T.sinIvaConCoste * 100) : null;
  T.pctCoste = T.sinIvaConCoste > 0 ? Math.round(T.costeVendido / T.sinIvaConCoste * 100) : null;
  return { cfg, filas: conDatos, activas, T };
}

// Simulador y precio mínimo: con el coste por unidad, a qué precio (IVA incluido) se llega al margen objetivo
export function simular({ precio, coste, ivaBarra = 10, tarjetaPct = 0, parteTarjeta = 0 }) {
  const sin = precio / (1 + ivaBarra / 100);
  const ben = sin - precio * (tarjetaPct / 100) * parteTarjeta - coste;
  return { sinIva: r2(sin), benUd: r2(ben), margen: sin > 0 ? Math.round(ben / sin * 100) : null };
}
export function precioMinimo({ coste, objetivo, ivaBarra = 10 }) {
  if (coste == null || objetivo >= 100) return null;
  return Math.ceil(coste / (1 - objetivo / 100) * (1 + ivaBarra / 100) * 10) / 10;   // redondeado hacia arriba a 10 céntimos
}

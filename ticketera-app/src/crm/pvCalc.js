// ===================== PUNTOS DE VENTA · CÁLCULOS =====================
// Mismas reglas que la base de datos (pv_resumen). Una «entrega» (lote) es un bloque de entradas numeradas
// que se deja a un punto de venta (de la nº «desde» a la nº «hasta»).
//  · Vendidas: o las que diga el punto (modo «cantidad»), o todas menos las que devuelve (modo «devueltas»).
//  · Total = vendidas × precio · Comisión = vendidas × € fijos, o un % del total · Te debe dar = total − comisión.
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

// "181-200, 230, 240-245" → [[181,200],[230,230],[240,245]] (ordenados, unidos y dentro de [desde, hasta])
export function leerRangos(texto, desde = -Infinity, hasta = Infinity) {
  const out = [];
  for (const trozo of String(texto || "").split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(trozo);
    if (!m) return { error: `No entiendo «${trozo}». Escribe números o rangos como 181-200.` };
    let a = Number(m[1]), b = Number(m[2] ?? m[1]);
    if (b < a) [a, b] = [b, a];
    if (a < desde || b > hasta) return { error: `${trozo} está fuera de la entrega (${desde}-${hasta}).` };
    out.push([a, b]);
  }
  out.sort((x, y) => x[0] - y[0]);
  const unidos = [];
  for (const r of out) { const u = unidos[unidos.length - 1]; if (u && r[0] <= u[1] + 1) u[1] = Math.max(u[1], r[1]); else unidos.push([...r]); }
  return { rangos: unidos };
}
export const textoRangos = (rangos) => (rangos || []).map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(", ");
export const contarRangos = (rangos) => (rangos || []).reduce((t, [a, b]) => t + (b - a + 1), 0);

export function resumenLote(l) {
  const entregadas = l.desde != null && l.hasta != null ? Math.max(0, Number(l.hasta) - Number(l.desde) + 1) : Number(l.cantidad) || 0;
  const devueltas = l.vendidas_modo === "devueltas" ? contarRangos(l.devueltas) : null;
  let vendidas = l.vendidas_modo === "devueltas" ? entregadas - devueltas : Math.min(entregadas, Math.max(0, Number(l.vendidas) || 0));
  vendidas = Math.max(0, vendidas);
  const total = r2(vendidas * (Number(l.precio) || 0));
  const comision = l.comision_tipo === "pct" ? r2(total * (Number(l.comision_valor) || 0) / 100) : r2(vendidas * (Number(l.comision_valor) || 0));
  const aEntregar = r2(total - comision);
  const pagado = r2(Number(l.pagado) || 0);
  return { entregadas, vendidas, devueltas: devueltas ?? (entregadas - vendidas), sinLiquidar: l.vendidas_modo ? 0 : entregadas,
    total, comision, aEntregar, pagado, pendiente: r2(Math.max(0, aEntregar - pagado)) };
}

// ¿Se pisan dos entregas del mismo evento?
export const solapan = (a, b) => a.desde != null && b.desde != null && Number(a.desde) <= Number(b.hasta) && Number(b.desde) <= Number(a.hasta);

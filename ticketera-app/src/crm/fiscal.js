// ===================== CRM · COMISIONES E IVA =====================
// Todo se calcula a partir de Ajustes. Con los valores por defecto (comisiones a 0 e IVA desactivado)
// las cifras son exactamente las de antes.
//
// Cómo afecta al beneficio (se añaden como gastos automáticos, pagados por la empresa):
//  · Comisiones: lo que se quedan el datáfono, Bizum, el banco o la ticketera.
//  · IVA a Hacienda (si se activa): IVA de las ventas − IVA de los gastos CON factura.
//    Así el beneficio queda sin IVA: ingresos sin IVA − gastos sin IVA (los gastos sin factura cuentan enteros).
import { r2, isInvite } from "./ui";
import { GRUPOS, catInfo, gcatInfo, fuenteAuto, COMIS_CAT, IVA_CAT, TICKETERA_CAT } from "./categorias";

export const AJUSTES_DEF = {
  comisiones: { tarjeta: 0, bizum: 0, transferencia: 0, ticketeraPct: 0, ticketeraFijo: 0 },
  iva: { activo: false, ventas: { barra: 10, entradas: 21, merch: 21, patrocinio: 21, otros: 21 } },
};
export const TIPOS_IVA = [0, 4, 10, 21];
const n = (v) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : 0; };
export function ajustesCon(a) {
  const d = a || {};
  return {
    ...d,
    comisiones: { ...AJUSTES_DEF.comisiones, ...(d.comisiones || {}) },
    iva: { ...AJUSTES_DEF.iva, ...(d.iva || {}), ventas: { ...AJUSTES_DEF.iva.ventas, ...((d.iva || {}).ventas || {}) } },
  };
}

// Importe que cuenta de un gasto: el real; si aún no hay, el previsto
export const importe = (g) => (g.real != null ? g.real : g.previsto != null ? g.previsto : 0);
// IVA contenido en un importe que ya lo incluye
export const ivaDe = (total, pct) => (pct > 0 ? r2(total - total / (1 + pct / 100)) : 0);
// IVA y factura de un gasto (si no se ha indicado, lo habitual de su categoría)
export function ivaGasto(g) {
  const cat = gcatInfo(g.categoria);
  const pct = g.iva != null ? Number(g.iva) : (g.tipo === "personal" ? 0 : (cat.iva ?? 21));
  const factura = g.factura != null ? !!g.factura : (g.tipo === "personal" ? false : cat.factura !== false);
  return { pct, factura, iva: ivaDe(importe(g), pct), deducible: factura && pct > 0 };
}
export const esTicketera = (i) => i.origen === "api" || i.origen === "csv" || i.categoria === TICKETERA_CAT;

// Cálculo del evento. Solo cuenta lo cobrado (igual que la liquidación).
export function fiscalEvento({ ev, sales, ingresos, gastos, fuentes, ajustes, senales = 0 }) {
  const A = ajustesCon(ajustes);
  const K = A.comisiones;
  const ss = (sales || []).filter(s => s.eventId === ev.id && !s.voided && !isInvite(s));
  const cob = (ingresos || []).filter(i => i.estado === "cobrado");

  // ---- Comisiones ----
  const sum = (arr, f) => r2(arr.reduce((t, x) => t + f(x), 0));
  const tarjetaTpv = sum(ss.filter(s => s.pago === "tarjeta"), s => s.price);
  const manual = cob.filter(i => !esTicketera(i));
  const tarjetaMan = sum(manual.filter(i => i.metodo === "tarjeta"), i => i.importe);
  const bizum = sum(manual.filter(i => i.metodo === "bizum"), i => i.importe);
  const transf = sum(manual.filter(i => i.metodo === "transferencia"), i => i.importe);
  const tick = cob.filter(i => esTicketera(i) && i.origen !== "tixfast");   // la venta online propia no paga la comisión de una ticketera externa
  const tickImp = sum(tick, i => i.importe);
  const tickUds = tick.reduce((t, i) => t + (Number(i.unidades) || 0), 0);
  const lineas = [
    { k: "tarjeta", t: "Tarjeta / datáfono", base: r2(tarjetaTpv + tarjetaMan), pct: n(K.tarjeta) },
    { k: "bizum", t: "Bizum", base: bizum, pct: n(K.bizum) },
    { k: "transferencia", t: "Transferencias", base: transf, pct: n(K.transferencia) },
    { k: "ticketera", t: "Ticketera online", base: tickImp, pct: n(K.ticketeraPct), fijo: n(K.ticketeraFijo), unidades: tickUds },
  ].map(l => ({ ...l, importe: r2(l.base * l.pct / 100 + (l.fijo || 0) * (l.unidades || 0)) })).filter(l => l.importe > 0);
  const comisionTotal = r2(lineas.reduce((t, l) => t + l.importe, 0));

  // ---- IVA ----
  const porGrupo = Object.fromEntries(GRUPOS.map(g => [g.k, 0]));
  ev.puntos.forEach(p => {
    const t = ss.filter(s => s.puntoId === p.id).reduce((a, s) => a + s.price, 0);
    const f = (fuentes || {})[p.id] || fuenteAuto(p);
    porGrupo[f] = (porGrupo[f] || 0) + t;
  });
  // Señales de reservados: llevan el IVA del punto donde se cobran los reservados
  if (Number(senales) > 0) { const pr = ev.puntos.find(p => (ev.style?.reservados?.puntos || []).includes(p.id)); const f = pr ? ((fuentes || {})[pr.id] || fuenteAuto(pr)) : "otros"; porGrupo[f] = (porGrupo[f] || 0) + Number(senales); }
  cob.forEach(i => { const g = catInfo(i.categoria).g; porGrupo[g] = (porGrupo[g] || 0) + i.importe; });
  const ventas = GRUPOS.map(g => { const total = r2(porGrupo[g.k] || 0), pct = n(A.iva.ventas[g.k]); return { ...g, total, pct, iva: ivaDe(total, pct) }; }).filter(v => v.total > 0);
  const repercutido = r2(ventas.reduce((t, v) => t + v.iva, 0));
  const gs = (gastos || []).map(g => ({ g, x: ivaGasto(g) }));
  const soportado = r2(gs.filter(({ x }) => x.deducible).reduce((t, { x }) => t + x.iva, 0));
  const conFactura = r2(gs.filter(({ x }) => x.factura).reduce((t, { g }) => t + importe(g), 0));
  const sinFactura = r2(gs.filter(({ x }) => !x.factura).reduce((t, { g }) => t + importe(g), 0));
  const neto = r2(repercutido - soportado);
  const iva = { activo: !!A.iva.activo, ventas, repercutido, soportado, neto, conFactura, sinFactura, nConFactura: gs.filter(({ x }) => x.factura).length, nSinFactura: gs.filter(({ x }) => !x.factura).length };

  const auto = [
    ...lineas.map(l => ({ categoria: COMIS_CAT, concepto: l.t, importe: l.importe, detalle: l })),
    ...(iva.activo && Math.abs(neto) >= 0.01 ? [{ categoria: IVA_CAT, concepto: neto >= 0 ? "IVA a pagar (estimado)" : "IVA a devolver (estimado)", importe: neto, detalle: iva }] : []),
  ];
  return { A, comisiones: lineas, comisionTotal, iva, auto };
}

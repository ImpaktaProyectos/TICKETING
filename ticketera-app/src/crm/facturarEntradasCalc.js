// ===================== CRM · FACTURAR LAS ENTRADAS =====================
// Pasa el dinero de entradas (por canal) a líneas de factura y a un resumen para el gestor.
// Los importes de venta ya llevan el IVA incluido (igual que en fiscal.js): base = importe / (1 + IVA).
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
export const baseDe = (importe, pct) => (pct > 0 ? r2(importe / (1 + pct / 100)) : r2(importe));

// Solo lo cobrado: lo pendiente aún no se puede facturar como cobro.
export const cobradoDe = (c) => r2((c.importe || 0) - (c.pendiente || 0));

// canales: lista de canalesEntradas().lista. Devuelve una línea de factura por canal con importe cobrado.
export function lineasDeCanales(canales, pct, evNombre, nuevoId = () => Math.random().toString(36).slice(2)) {
  return canales.filter(c => cobradoDe(c) > 0).map(c => {
    const uds = c.udsSabidas && c.uds > 0 ? `${c.uds} ${c.uds === 1 ? "entrada" : "entradas"} · ` : "";
    return { id: nuevoId(), concepto: `${c.t} · ${uds}${evNombre || "evento"}`.slice(0, 200), cantidad: 1, precio: baseDe(cobradoDe(c), pct), descuento: "", iva: pct };
  });
}

// Resumen por canal para el gestor (Excel en español: separador «;» y coma decimal).
export function resumenCsv(canales, pct, evNombre) {
  const n = (v) => String(r2(v).toFixed(2)).replace(".", ",");
  const q = (t) => `"${String(t ?? "").replace(/"/g, '""')}"`;
  const filas = [["Evento", "Canal", "Entradas", "Cobrado (IVA incluido)", "Pendiente de cobrar", "Base imponible", "IVA %", "Cuota IVA"]];
  let tot = { cob: 0, pen: 0, base: 0 };
  canales.forEach(c => {
    const cob = cobradoDe(c), base = baseDe(cob, pct);
    tot = { cob: r2(tot.cob + cob), pen: r2(tot.pen + (c.pendiente || 0)), base: r2(tot.base + base) };
    filas.push([q(evNombre), q(c.t), c.udsSabidas ? c.uds : "", n(cob), n(c.pendiente || 0), n(base), pct, n(cob - base)]);
  });
  filas.push([q(evNombre), q("TOTAL"), "", n(tot.cob), n(tot.pen), n(tot.base), pct, n(tot.cob - tot.base)]);
  return "﻿" + filas.map(f => f.join(";")).join("\r\n");
}

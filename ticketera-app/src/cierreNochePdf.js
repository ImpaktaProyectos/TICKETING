// ===================== PDF DEL CIERRE DE LA NOCHE =====================
// Ingresos del TPV (por forma de pago, barra y producto), gastos de caja por categoría con su detalle,
// cambio añadido, señales de reservados y dinero que tienen los socios. A4 vertical, varias páginas si hace falta.
import { jsPDF } from "jspdf";

const limpia = (s) => String(s ?? "").replace(/−/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x00-\xff€–—…]/gu, "").trim();
const eur = (v) => (Number(v) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR", useGrouping: "always" });
const hex = (h) => { const n = parseInt(String(h || "#64748b").slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const hora = (ts) => ts ? new Date(ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "";
const fechaHora = (v) => v ? new Date(v).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

// R: resultado de resumenNoche · ev: { name, date } · op: { color }
export function pdfCierreNoche(R, ev, op = {}) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, H = 297, M = 14, AN = W - M * 2;
  const acento = hex(op.color || "#ff5a3c"), negro = [21, 23, 28], gris = [100, 106, 118], linea = [226, 229, 234], fondo = [246, 247, 249];
  const verde = [14, 159, 117], ambar = [196, 120, 0], rojo = [210, 38, 38];
  let y = M;
  const txt = (s, x, yy, o = {}) => { doc.setFont("helvetica", o.b ? "bold" : "normal"); doc.setFontSize(o.s || 9); doc.setTextColor(...(o.c || negro)); doc.text(limpia(s), x, yy, { align: o.a || "left", maxWidth: o.w }); };
  const salto = (alto) => { if (y + alto > H - 16) { doc.addPage(); y = M; return true; } return false; };
  const seccion = (t, sub) => {
    salto(18); y += 4;
    doc.setFillColor(...acento); doc.rect(M, y - 3.6, 1.6, 5, "F");
    txt(t, M + 4, y, { b: true, s: 12.5 }); if (sub) txt(sub, W - M, y, { s: 8.5, c: gris, a: "right" });
    y += 5;
  };
  // Tabla con cabecera que se repite al cambiar de página. cols: [{ t, w, a }]
  const tabla = (cols, filas, o = {}) => {
    const alto = 6.2;
    const cab = () => { doc.setFillColor(...fondo); doc.rect(M, y - 4.2, AN, alto, "F"); let x = M + 2; cols.forEach(c => { txt(c.t, c.a === "right" ? x + c.w - 4 : x, y, { b: true, s: 8, c: gris, a: c.a }); x += c.w; }); y += alto; };
    cab();
    filas.forEach((f, i) => {
      if (salto(alto + 2)) cab();
      if (f.total) { doc.setDrawColor(...negro); doc.setLineWidth(.3); doc.line(M, y - 4.3, M + AN, y - 4.3); }
      let x = M + 2;
      cols.forEach((c, j) => { txt(f.celdas[j], c.a === "right" ? x + c.w - 4 : x, y, { s: 8.6, b: f.total || (o.negrita || []).includes(j), c: f.color && j === cols.length - 1 ? f.color : negro, a: c.a, w: c.w - 3 }); x += c.w; });
      if (!f.total && i < filas.length - 1) { doc.setDrawColor(...linea); doc.setLineWidth(.15); doc.line(M, y + 1.8, M + AN, y + 1.8); }
      y += alto;
    });
    y += 2;
  };

  // ---------- Cabecera ----------
  doc.setFillColor(...acento); doc.rect(0, 0, W, 30, "F");
  txt("CIERRE DE LA NOCHE", M, 12, { b: true, s: 17, c: [255, 255, 255] });
  txt(ev?.name || "Evento", M, 19.5, { s: 11, c: [255, 255, 255] });
  const fEv = ev?.date ? new Date(ev.date + "T12:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "";
  txt(fEv, M, 25.5, { s: 9, c: [255, 255, 255] });
  txt(`Generado el ${fechaHora(Date.now())}`, W - M, 25.5, { s: 8, c: [255, 255, 255], a: "right" });
  y = 40;

  // ---------- Cifras clave ----------
  const kpis = [
    ["Ingresos TPV", eur(R.ingresos.total), `${R.ingresos.tickets} tickets`, verde],
    ["Gastos de caja", eur(R.gastos.total), `${R.gastos.n} gastos`, ambar],
    ["Resultado", eur(R.resultado), "ingresos - gastos", R.resultado >= 0 ? verde : rojo],
    ["Deben los socios", eur(R.sociosPendiente), R.sociosPendiente > 0 ? "pendiente de reponer" : "nada pendiente", R.sociosPendiente > 0 ? ambar : verde],
  ];
  const kw = (AN - 9) / 4;
  kpis.forEach(([l, v, sub, c], i) => {
    const x = M + i * (kw + 3);
    doc.setFillColor(...fondo); doc.roundedRect(x, y, kw, 22, 2.5, 2.5, "F");
    doc.setFillColor(...c); doc.rect(x, y + 3, 1.2, 16, "F");
    txt(l, x + 4, y + 6.5, { s: 8, c: gris, b: true }); txt(v, x + 4, y + 14, { s: 13, b: true, c }); txt(sub, x + 4, y + 19, { s: 7.5, c: gris });
  });
  y += 30;

  // ---------- Ingresos ----------
  seccion("Ingresos del TPV", `${R.ingresos.tickets} tickets · ${eur(R.ingresos.total)}`);
  const metodos = [["Efectivo", R.ingresos.efectivo], ["Tarjeta", R.ingresos.tarjeta], ["Sin forma de pago (venta sin desglose)", R.ingresos.sinMetodo]].filter(([, v]) => v);
  tabla([{ t: "Forma de pago", w: AN - 70 }, { t: "%", w: 30, a: "right" }, { t: "Importe", w: 40, a: "right" }],
    [...metodos.map(([t, v]) => ({ celdas: [t, R.ingresos.total ? `${Math.round(v / R.ingresos.total * 100)} %` : "", eur(v)] })), { total: true, celdas: ["Total ingresos", "", eur(R.ingresos.total)] }]);
  if (R.ingresos.porBarra.length) tabla([{ t: "Barra", w: AN - 130 }, { t: "Tickets", w: 25, a: "right" }, { t: "Efectivo", w: 35, a: "right" }, { t: "Tarjeta", w: 35, a: "right" }, { t: "Total", w: 35, a: "right" }],
    R.ingresos.porBarra.map(b => ({ celdas: [b.nombre, String(b.tickets), eur(b.efectivo), eur(b.tarjeta), eur(b.total)] })), { negrita: [4] });
  if (R.ingresos.porProducto.length) tabla([{ t: "Producto", w: AN - 70 }, { t: "Unidades", w: 30, a: "right" }, { t: "Total", w: 40, a: "right" }],
    R.ingresos.porProducto.map(p => ({ celdas: [p.nombre, String(p.uds), eur(p.total)] })));
  const notas = [R.ingresos.invitaciones.n && `Invitaciones: ${R.ingresos.invitaciones.n} (valor ${eur(R.ingresos.invitaciones.valor)}), no suman a los ingresos.`,
    R.ingresos.anuladas.n && `Anuladas: ${R.ingresos.anuladas.n} tickets (${eur(R.ingresos.anuladas.valor)}), no suman.`,
    R.ingresos.sociosEfectivo && `Incluye ${eur(R.ingresos.sociosEfectivo)} vendidos sin ticket en efectivo por socios (ver «Dinero de los socios»).`].filter(Boolean);
  notas.forEach(t => { salto(6); txt(t, M, y, { s: 8, c: gris, w: AN }); y += 4.5; });

  // ---------- Gastos ----------
  seccion("Gastos de caja por categoría", R.gastos.n ? `${R.gastos.n} gastos · ${eur(R.gastos.total)}` : "sin gastos");
  if (!R.gastos.porCategoria.length) { txt("No se ha registrado ningún gasto esta noche.", M, y, { c: gris }); y += 7; }
  // Resumen con barras de proporción
  const maxCat = Math.max(1, ...R.gastos.porCategoria.map(c => c.total));
  R.gastos.porCategoria.forEach(c => {
    salto(8);
    doc.setFillColor(...hex(c.c)); doc.circle(M + 1.6, y - 1.2, 1.4, "F");
    txt(`${c.t}${c.noGasto ? " (no es gasto)" : ""}`, M + 5, y, { b: true, s: 9.2 });
    txt(`${c.n} · ${eur(c.total)}${!c.noGasto && R.gastos.total ? `  (${Math.round(c.total / R.gastos.total * 100)} %)` : ""}`, W - M, y, { a: "right", s: 9, b: true });
    doc.setFillColor(...linea); doc.roundedRect(M + 62, y - 2.6, AN - 62 - 48, 2.6, 1.3, 1.3, "F");
    doc.setFillColor(...hex(c.c)); doc.roundedRect(M + 62, y - 2.6, Math.max(2, (AN - 62 - 48) * c.total / maxCat), 2.6, 1.3, 1.3, "F");
    y += 6;
  });
  y += 2;
  R.gastos.porCategoria.forEach(c => {
    salto(16);
    txt(`${c.t} · ${eur(c.total)}`, M, y, { b: true, s: 9.5, c: hex(c.c) }); y += 4.5;
    tabla([{ t: "Hora", w: 18 }, { t: "Barra", w: 34 }, { t: "Concepto", w: AN - 18 - 34 - 34 - 30 }, { t: "Registrado por", w: 34 }, { t: "Importe", w: 30, a: "right" }],
      c.items.map(g => ({ celdas: [hora(g.ts), g.barra, g.concepto || c.t, g.por || "", eur(g.importe)] })));
  });
  if (R.gastos.cambioLista.length) {
    salto(16); txt(`Cambio añadido a las cajas · ${eur(R.gastos.cambio)}`, M, y, { b: true, s: 9.5, c: verde }); y += 4.5;
    tabla([{ t: "Hora", w: 18 }, { t: "Barra", w: 40 }, { t: "Concepto", w: AN - 18 - 40 - 30 }, { t: "Importe", w: 30, a: "right" }],
      R.gastos.cambioLista.map(g => ({ celdas: [hora(g.ts), g.barra, g.concepto || "Cambio", eur(g.importe)] })));
  }

  // ---------- Resultado ----------
  seccion("Resultado de la noche");
  tabla([{ t: "Concepto", w: AN - 40 }, { t: "Importe", w: 40, a: "right" }], [
    { celdas: ["Ingresos del TPV", eur(R.ingresos.total)] },
    { celdas: ["- Gastos de caja", "-" + eur(R.gastos.total)] },
    { total: true, celdas: ["= Resultado (sin fondo de caja ni señales)", eur(R.resultado)], color: R.resultado >= 0 ? verde : rojo },
  ]);
  if (R.ingresos.efectivo || R.gastos.total) {
    tabla([{ t: "Efectivo", w: AN - 40 }, { t: "Importe", w: 40, a: "right" }], [
      { celdas: ["Ventas en efectivo", eur(R.ingresos.efectivo)] },
      ...(R.ingresos.sociosEfectivo ? [{ celdas: ["- Lo tienen los socios (ventas sin ticket)", "-" + eur(R.ingresos.sociosEfectivo)] }] : []),
      { celdas: ["- Gastos pagados de la caja", "-" + eur(R.gastos.total)] },
      ...(R.gastos.retiradas ? [{ celdas: ["- Retiradas de efectivo", "-" + eur(R.gastos.retiradas)] }] : []),
      ...(R.gastos.cambio ? [{ celdas: ["+ Cambio añadido", eur(R.gastos.cambio)] }] : []),
      { total: true, celdas: ["= Efectivo en los cajones (más el fondo inicial)", eur(R.efectivoNeto)] },
    ]);
  }

  // ---------- Señales y socios ----------
  seccion("Señales de reservados y dinero de los socios", R.senales.n ? `${R.senales.n} señales · ${eur(R.senales.total)}` : "");
  if (R.senales.n) { txt(`Señales cobradas antes de la noche: ${eur(R.senales.total)}${R.senales.deSocios ? `, de las que ${eur(R.senales.deSocios)} las tienen socios` : ""}. No entran en las cajas de las barras.`, M, y, { s: 8.5, c: gris, w: AN }); y += 7; }
  if (!R.socios.length) { txt("Ningún socio tiene dinero de esta noche.", M, y, { c: gris }); y += 7; }
  R.socios.forEach(s => {
    salto(18);
    txt(s.socio, M, y, { b: true, s: 10.5 });
    txt(s.pendiente > 0 ? `Debe ${eur(s.pendiente)}` : "Todo devuelto", W - M, y, { b: true, s: 10, a: "right", c: s.pendiente > 0 ? ambar : verde }); y += 4.5;
    tabla([{ t: "Concepto", w: AN - 30 - 50 }, { t: "Estado", w: 50 }, { t: "Importe", w: 30, a: "right" }],
      s.items.map(it => ({ celdas: [it.concepto, it.pendiente > 0 ? (it.devuelto ? `Devuelto ${eur(it.devuelto)} · falta ${eur(it.pendiente)}` : "Pendiente de reponer") : `Devuelto ${fechaHora(it.devueltoEn)}`, eur(it.importe)], color: it.pendiente > 0 ? ambar : verde })));
  });

  // ---------- Cambio que han puesto los socios ----------
  if ((R.cambioSocios || []).length) {
    seccion("Cambio que han puesto los socios", R.cambioPendiente > 0 ? `hay que devolver ${eur(R.cambioPendiente)}` : "todo devuelto");
    txt("No cuenta como ingreso ni como gasto del evento: es dinero de los socios que hay que devolverles.", M, y, { s: 8.5, c: gris, w: AN }); y += 6;
    tabla([{ t: "Socio", w: 40 }, { t: "Concepto", w: AN - 40 - 55 - 30 }, { t: "Estado", w: 55 }, { t: "Importe", w: 30, a: "right" }],
      R.cambioSocios.flatMap(s => s.items.map(a => ({ celdas: [s.socio, a.concepto || "Cambio", a.devueltoEn ? `Devuelto ${fechaHora(a.devueltoEn)}${a.devueltoDesde === "caja" ? " (caja)" : ""}` : "Pendiente de devolver", eur(a.importe)], color: a.devueltoEn ? verde : [37, 99, 235] }))));
  }

  // ---------- Pie con páginas ----------
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); txt(`${ev?.name || ""} · Cierre de la noche`, M, H - 8, { s: 7.5, c: gris }); txt(`Página ${i} de ${n}`, W - M, H - 8, { s: 7.5, c: gris, a: "right" }); }
  return doc;
}

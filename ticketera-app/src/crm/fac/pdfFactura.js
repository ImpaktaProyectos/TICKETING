// ===================== PDF DE UNA FACTURA (3 plantillas) =====================
// Contenido según el Reglamento de facturación (RD 1619/2012, art. 6): número y serie, fechas,
// datos y NIF de emisor y destinatario, detalle de operaciones, base, tipo y cuota de IVA por tipo,
// retención de IRPF y, en rectificativas, la factura que corrige y el motivo. QR tributario opcional.
import { jsPDF } from "jspdf";
import qrcode from "qrcode-generator";
import { calcular, baseLinea, eur, fechaES, num, urlQR } from "./calculo";

// Las fuentes estándar del PDF no tienen todos los símbolos: se cambian los que no existen (emojis incluidos)
const limpiaPDF = (s) => Array.isArray(s) ? s.map(limpiaPDF) : String(s ?? "").replace(/\u2212/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[^\x00-\xff\u20ac\u2013\u2014\u2026]/gu, "");
const rgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); const n = m ? parseInt(m[1], 16) : 0xff5a3c; return [n >> 16, (n >> 8) & 255, n & 255]; };
const claro = ([r, g, b], k) => [r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k].map(Math.round);

async function imagen(url) {
  if (!url) return null;
  try {
    const blob = await (await fetch(url, { mode: "cors" })).blob();
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, 600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return { data: c.toDataURL("image/png"), w: c.width, h: c.height };
  } catch { return null; }
}
function dibujarQR(doc, texto, x, y, lado) {
  const q = qrcode(0, "M"); q.addData(texto, "Byte"); q.make();
  const n = q.getModuleCount(), m = lado / (n + 4);
  doc.setFillColor(255, 255, 255); doc.rect(x, y, lado, lado, "F"); doc.setFillColor(0, 0, 0);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) doc.rect(x + (c + 2) * m, y + (r + 2) * m, m + 0.02, m + 0.02, "F");
}

// f: factura (emitida o borrador) · emisor: datos fiscales actuales (para borradores) · opciones { color, logo, plantilla, qr }
export async function pdfFactura(f, emisorActual, op = {}) {
  const E = f.emisor || emisorActual || {};
  const C = f.contacto || {};
  const borrador = f.estado === "borrador" || !f.codigo;
  const t = borrador ? calcular(f.lineas, f.irpf_pct) : { base: +f.base, cuota_iva: +f.cuota_iva, cuota_irpf: +f.cuota_irpf, total: +f.total, desglose: f.desglose || [] };
  const plantilla = op.plantilla || f.plantilla || emisorActual?.plantilla || "clasica";
  const col = rgb(op.color || emisorActual?.color);
  const logo = await imagen(op.logo || E.logo_url || emisorActual?.logo_url);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, M = 16, AN = W - M * 2;
  const negro = [21, 23, 28], gris = [95, 102, 114], linea = [225, 228, 233];
  const txt = (s, x, y, o = {}) => { doc.setFont("helvetica", o.b ? "bold" : "normal"); doc.setFontSize(o.s || 9.5); doc.setTextColor(...(o.c || negro)); doc.text(limpiaPDF(s), x, y, { align: o.a || "left", maxWidth: o.w }); };
  const titulo = f.rectificativa ? "FACTURA RECTIFICATIVA" : "FACTURA";
  let y = M;

  // ---------- Cabecera ----------
  if (plantilla === "moderna") {
    doc.setFillColor(...col); doc.rect(0, 0, W, 44, "F");
    if (logo) { const h = 16, w = Math.min(50, h * logo.w / logo.h); doc.setFillColor(255, 255, 255); doc.roundedRect(M - 2, 12, w + 4, h + 4, 2, 2, "F"); doc.addImage(logo.data, "PNG", M, 14, w, h); }
    else txt(E.nombre_comercial || E.razon_social, M, 26, { s: 16, b: true, c: [255, 255, 255] });
    txt(titulo, W - M, 20, { s: f.rectificativa ? 15 : 22, b: true, c: [255, 255, 255], a: "right" });
    txt(borrador ? "BORRADOR" : f.codigo, W - M, 29, { s: 12, b: true, c: [255, 255, 255], a: "right" });
    txt(`Fecha: ${fechaES(f.fecha)}`, W - M, 36, { s: 9.5, c: [255, 255, 255], a: "right" });
    y = 54;
  } else {
    if (logo) { const h = 18, w = Math.min(60, h * logo.w / logo.h); doc.addImage(logo.data, "PNG", M, y, w, h); }
    else txt(E.nombre_comercial || E.razon_social, M, y + 10, { s: 16, b: true, c: plantilla === "minimal" ? negro : col });
    txt(titulo, W - M, y + 8, { s: f.rectificativa ? 14 : 20, b: true, c: plantilla === "minimal" ? negro : col, a: "right" });
    txt(borrador ? "BORRADOR" : f.codigo, W - M, y + 16, { s: 11, b: true, a: "right" });
    txt(`Fecha: ${fechaES(f.fecha)}`, W - M, y + 22, { s: 9.5, c: gris, a: "right" });
    y += 30;
    doc.setDrawColor(...(plantilla === "minimal" ? negro : col)); doc.setLineWidth(plantilla === "minimal" ? 0.3 : 0.8); doc.line(M, y, W - M, y); y += 8;
  }

  // ---------- Emisor y cliente ----------
  const bloque = (x, et, d) => {
    txt(et, x, y, { s: 8, b: true, c: plantilla === "minimal" ? gris : col });
    let yy = y + 5.5;
    [[d.razon_social || d.nombre, true], [d.nif ? `NIF: ${d.nif}` : ""], [d.direccion], [[d.cp, d.ciudad].filter(Boolean).join(" ") + (d.provincia ? ` (${d.provincia})` : "")], [d.pais && d.pais !== "España" ? d.pais : ""], [d.email], [d.telefono]]
      .filter(([v]) => v && String(v).trim()).forEach(([v, b]) => { txt(v, x, yy, { s: b ? 10.5 : 9.2, b, w: AN / 2 - 6 }); yy += b ? 5.4 : 4.6; });
    return yy;
  };
  const y1 = bloque(M, "EMISOR", E), y2 = bloque(M + AN / 2 + 4, "CLIENTE", C);
  y = Math.max(y1, y2) + 4;

  // Datos de la factura (fechas, vencimiento, rectificación)
  const meta = [];
  if (f.fecha_operacion && f.fecha_operacion !== f.fecha) meta.push(["Fecha de la operación", fechaES(f.fecha_operacion)]);
  if (f.vencimiento) meta.push(["Vencimiento", fechaES(f.vencimiento)]);
  if (f.forma_pago) meta.push(["Forma de pago", f.forma_pago]);
  if (f.rectificativa) meta.push(["Rectifica a", op.rectificaCodigo || f.rectifica_codigo || "—"]);
  if (meta.length) {
    doc.setFillColor(...(plantilla === "moderna" ? claro(col, .9) : [246, 247, 249])); doc.roundedRect(M, y, AN, 7 + Math.ceil(meta.length / 3) * 9, 2, 2, "F");
    meta.forEach(([k, v], i) => { const cx = M + 5 + (i % 3) * (AN / 3), cy = y + 6 + Math.floor(i / 3) * 9; txt(k.toUpperCase(), cx, cy, { s: 7, b: true, c: gris }); txt(v, cx, cy + 4.3, { s: 9.5, b: true }); });
    y += 10 + Math.ceil(meta.length / 3) * 9;
  }
  if (f.rectificativa && f.motivo) { txt(`Motivo de la rectificación: ${f.motivo}`, M, y + 2, { s: 9, c: gris, w: AN }); y += 8; }

  // ---------- Líneas ----------
  const cols = [{ t: "Concepto", x: M + 2, w: 82 }, { t: "Cant.", x: M + 96, a: "right" }, { t: "Precio", x: M + 118, a: "right" }, { t: "Dto.", x: M + 132, a: "right" }, { t: "IVA", x: M + 146, a: "right" }, { t: "Importe", x: W - M - 2, a: "right" }];
  const cabTabla = () => {
    if (plantilla === "minimal") { doc.setDrawColor(...negro); doc.setLineWidth(0.3); doc.line(M, y + 6, W - M, y + 6); }
    else { doc.setFillColor(...(plantilla === "moderna" ? col : claro(col, .88))); doc.rect(M, y, AN, 8, "F"); }
    cols.forEach(c => txt(c.t, c.x, y + 5.3, { s: 8.5, b: true, a: c.a, c: plantilla === "moderna" ? [255, 255, 255] : negro }));
    y += 11;
  };
  cabTabla();
  (f.lineas || []).forEach(l => {
    const conc = doc.setFont("helvetica", "normal").setFontSize(9.5).splitTextToSize(String(l.concepto || "—"), 82);
    const alto = Math.max(1, conc.length) * 4.4 + 2.6;
    if (y + alto > 262) { doc.addPage(); y = M; cabTabla(); }
    txt(conc, M + 2, y, { s: 9.5 });
    txt(String(num(l.cantidad)).replace(".", ","), M + 96, y, { a: "right" });
    txt(eur(num(l.precio)), M + 118, y, { a: "right" });
    txt(num(l.descuento) ? `${String(num(l.descuento)).replace(".", ",")} %` : "", M + 132, y, { a: "right" });
    txt(`${num(l.iva)} %`, M + 146, y, { a: "right" });
    txt(eur(baseLinea(l)), W - M - 2, y, { a: "right", b: true });
    y += alto; doc.setDrawColor(...linea); doc.setLineWidth(0.2); doc.line(M, y - 2.6, W - M, y - 2.6);
  });

  // ---------- Totales ----------
  if (y > 220) { doc.addPage(); y = M; }
  y += 4;
  const xT = W - M - 78, filas = [["Base imponible", eur(t.base)]];
  t.desglose.forEach(d => filas.push([`IVA ${d.tipo} % sobre ${eur(d.base)}`, eur(d.cuota)]));
  if (num(f.irpf_pct)) filas.push([`Retención IRPF ${num(f.irpf_pct)} %`, `- ${eur(t.cuota_irpf)}`]);
  filas.forEach(([k, v]) => { txt(k, xT, y, { s: 9, c: gris }); txt(v, W - M - 2, y, { s: 9.5, a: "right" }); y += 5.4; });
  y += 1;
  doc.setFillColor(...(plantilla === "minimal" ? [21, 23, 28] : col)); doc.roundedRect(xT - 3, y - 4.5, 81, 11, 2, 2, "F");
  txt("TOTAL", xT, y + 2.6, { s: 10, b: true, c: [255, 255, 255] }); txt(eur(t.total), W - M - 2, y + 2.6, { s: 13, b: true, c: [255, 255, 255], a: "right" });
  const yTot = y; y += 14;

  // QR tributario (a la izquierda de los totales)
  if (!borrador && (op.qr ?? emisorActual?.qr ?? true)) {
    const lado = 28, yq = yTot - 30;
    dibujarQR(doc, urlQR(f), M, yq, lado);
    txt("QR tributario", M + lado + 3, yq + 5, { s: 8, b: true, c: gris });
    txt("Consulta en la Agencia Tributaria", M + lado + 3, yq + 9.5, { s: 7.5, c: gris, w: 50 });
  }

  // Notas, pago y pie legal
  const notas = [];
  if (f.notas) notas.push(f.notas);
  if ((f.lineas || []).some(l => num(l.iva) === 0) && !/exent|no sujet|inversi/i.test(f.notas || "")) notas.push("Operación con IVA al 0 %: indicar la causa de exención o no sujeción.");
  if (E.iban) notas.push(`Pago por transferencia a ${E.iban}`);
  if (notas.length) { notas.forEach(n => { const ls = doc.setFontSize(9).splitTextToSize(n, AN); if (y + ls.length * 4.4 > 280) { doc.addPage(); y = M; } txt(ls, M, y, { s: 9, c: gris }); y += ls.length * 4.4 + 2; }); }
  const pie = emisorActual?.pie || E.pie;
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    if (borrador) { doc.saveGraphicsState?.(); try { doc.setGState(new doc.GState({ opacity: 0.12 })); } catch {} doc.setTextColor(120, 124, 132); doc.setFont("helvetica", "bold"); doc.setFontSize(80); doc.text("BORRADOR", W / 2, 170, { align: "center", angle: 30 }); doc.restoreGraphicsState?.(); }
    doc.setDrawColor(...linea); doc.line(M, 284, W - M, 284);
    txt([E.razon_social, E.nif && `NIF ${E.nif}`, pie].filter(Boolean).join(" · "), M, 288.5, { s: 7.5, c: gris, w: AN - 20 });
    txt(`${i} / ${n}`, W - M, 288.5, { s: 7.5, c: gris, a: "right" });
  }
  return doc;
}

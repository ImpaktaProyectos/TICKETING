// ===================== PUNTOS DE VENTA · PDFs =====================
// Albarán de entrega (lo firma el punto al recoger las entradas), liquidación (al cerrar cuentas) y talonario con QR
// (las entradas físicas que genera TIXFAST: se imprimen, se cortan y en la puerta se escanean como cualquier entrada).
// Se crean en el navegador; no se sube nada.
import { resumenLote, textoRangos } from "./pvCalc.js";

const eur = (v) => `${(Number(v) || 0).toFixed(2).replace(".", ",")} €`;
const fechaTxt = (v) => { if (!v) return ""; const d = new Date(String(v).length <= 10 ? v + "T12:00" : v); return isNaN(d) ? "" : d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); };
const comisionTxt = (l) => (l.comision_tipo === "pct" ? `${String(l.comision_valor).replace(".", ",")} % del total` : `${eur(l.comision_valor)} por entrada vendida`);

async function nuevoDoc() { const { jsPDF } = await import("jspdf"); return new jsPDF({ unit: "mm", format: "a4" }); }
function cabecera(doc, titulo, ev) {
  doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.setTextColor(20); doc.text(titulo, 18, 22);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(90);
  doc.text(`${ev.name || ""}${ev.venue ? " · " + ev.venue : ""}`, 18, 29);
  doc.text(fechaTxt(ev.startsAt || ev.date), 18, 34);
  return 44;
}
function filas(doc, y, pares) {
  doc.setFontSize(11);
  for (const [k, v, fuerte] of pares) {
    doc.setFont("helvetica", fuerte ? "bold" : "normal"); doc.setTextColor(fuerte ? 20 : 70);
    doc.text(String(k), 18, y); doc.text(String(v), 192, y, { align: "right" });
    doc.setDrawColor(230); doc.line(18, y + 2.5, 192, y + 2.5); y += 9;
  }
  return y;
}
function firmas(doc, y, a, b) {
  y = Math.max(y + 20, 230); doc.setDrawColor(120); doc.setTextColor(70); doc.setFontSize(10);
  doc.line(18, y, 90, y); doc.line(120, y, 192, y); doc.text(a, 18, y + 6); doc.text(b, 120, y + 6);
}

export async function pdfAlbaran({ ev, punto, lote }) {
  const doc = await nuevoDoc();
  let y = cabecera(doc, "Albarán de entrega de entradas", ev);
  const n = lote.hasta - lote.desde + 1;
  y = filas(doc, y, [
    ["Punto de venta", punto.nombre, true], ["Contacto", [punto.contacto, punto.telefono].filter(Boolean).join(" · ") || "—"],
    ["Tipo de entrada", lote.nombre], ["Numeración entregada", `de la nº ${lote.desde} a la nº ${lote.hasta}`, true],
    ["Nº de entradas", n, true], ["Precio de venta", eur(lote.precio)], ["Comisión del punto", comisionTxt(lote)],
    ["Importe si se venden todas", eur(n * lote.precio)], ["Fecha de entrega", fechaTxt(lote.entregado_en)],
  ]);
  doc.setFontSize(9.5); doc.setTextColor(90);
  doc.text(doc.splitTextToSize("El punto de venta recibe estas entradas para venderlas al precio indicado. Al liquidar, entregará el importe de las vendidas menos su comisión y devolverá las no vendidas. Las entradas que no se devuelvan se consideran vendidas.", 174), 18, y + 6);
  firmas(doc, y + 20, "Entrega (organizador)", `Recibe (${punto.nombre})`);
  doc.save(`albaran_${(punto.nombre || "punto").replace(/[^\w]+/g, "_")}_${lote.desde}-${lote.hasta}.pdf`);
}

export async function pdfLiquidacion({ ev, punto, lote }) {
  const doc = await nuevoDoc();
  const r = resumenLote(lote);
  let y = cabecera(doc, "Liquidación de punto de venta", ev);
  y = filas(doc, y, [
    ["Punto de venta", punto.nombre, true], ["Tipo de entrada", lote.nombre], ["Numeración entregada", `${lote.desde} - ${lote.hasta} (${r.entregadas})`],
    ["Devueltas", lote.vendidas_modo === "devueltas" ? `${r.devueltas}${lote.devueltas?.length ? " · nº " + textoRangos(lote.devueltas) : ""}` : r.devueltas],
    ["Vendidas", r.vendidas, true], ["Precio", eur(lote.precio)], ["Total vendido", eur(r.total), true],
    ["Comisión del punto (" + comisionTxt(lote) + ")", "- " + eur(r.comision)], ["A entregar al organizador", eur(r.aEntregar), true],
    ["Ya pagado", eur(r.pagado)], ["Pendiente", eur(r.pendiente), true],
  ]);
  firmas(doc, y, "Organizador", punto.nombre);
  doc.save(`liquidacion_${(punto.nombre || "punto").replace(/[^\w]+/g, "_")}_${lote.desde}-${lote.hasta}.pdf`);
}

// Talonario: 10 entradas por hoja (2 × 5), con líneas de corte. El QR es el mismo que el de una entrada online.
export async function pdfTalonario({ ev, punto, lote, entradas, color = "#ff5a3c" }) {
  const [{ textoQR }, qrMod] = await Promise.all([import("../web/comun.jsx"), import("qrcode-generator")]);
  const qrcode = qrMod.default || qrMod;
  const doc = await nuevoDoc();
  const W = 105, H = 59.4;   // A4 en 2 × 5
  const lista = [...entradas].sort((a, b) => a.numero - b.numero);
  const hex = /^#?([0-9a-f]{6})$/i.exec(color || "")?.[1] || "ff5a3c";
  const rgb = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  lista.forEach((x, i) => {
    if (i > 0 && i % 10 === 0) doc.addPage();
    const k = i % 10, cx = (k % 2) * W, cy = Math.floor(k / 2) * H;
    doc.setDrawColor(180); doc.setLineDashPattern([1.5, 1.5], 0); doc.rect(cx, cy, W, H); doc.setLineDashPattern([], 0);
    doc.setFillColor(...rgb); doc.rect(cx, cy, 4, H, "F");
    doc.setTextColor(20); doc.setFont("helvetica", "bold"); doc.setFontSize(12.5);
    doc.text(doc.splitTextToSize(ev.name || "Evento", 52), cx + 9, cy + 10);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(80);
    doc.text(doc.splitTextToSize(fechaTxt(ev.startsAt || ev.date), 52), cx + 9, cy + 22);
    if (ev.venue) doc.text(doc.splitTextToSize(ev.venue, 52), cx + 9, cy + 30);
    doc.setTextColor(20); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    doc.text(lote.nombre || "Entrada", cx + 9, cy + 40);
    doc.setFontSize(14); doc.text(eur(lote.precio), cx + 9, cy + 48);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(110);
    doc.text(`Nº ${x.numero} · ${punto.nombre}`.slice(0, 48), cx + 9, cy + 55);
    // QR
    const q = qrcode(0, "M"); q.addData(textoQR(x.qr_hex), "Alphanumeric"); q.make();
    const nMod = q.getModuleCount(), lado = 38, m = lado / nMod, qx = cx + W - lado - 6, qy = cy + (H - lado) / 2 - 2;
    doc.setFillColor(255, 255, 255); doc.rect(qx - 1.5, qy - 1.5, lado + 3, lado + 3, "F");
    doc.setFillColor(0, 0, 0);
    for (let r = 0; r < nMod; r++) for (let c = 0; c < nMod; c++) if (q.isDark(r, c)) doc.rect(qx + c * m, qy + r * m, m + 0.02, m + 0.02, "F");
    if (x.prueba) { doc.setTextColor(200, 120, 0); doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.text("PRUEBA · NO VÁLIDA", qx, qy + lado + 4.5); }
    else { doc.setTextColor(110); doc.setFontSize(7); doc.text("Válida una sola vez", qx, qy + lado + 4.5); }
  });
  doc.save(`talonario_${(punto.nombre || "punto").replace(/[^\w]+/g, "_")}_${lote.desde}-${lote.hasta}.pdf`);
}

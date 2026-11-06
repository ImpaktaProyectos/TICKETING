// ===================== PDF DE LAS ENTRADAS =====================
// Una página por entrada: flyer, evento, asistente, QR de un solo uso y avisos.
// Se crea en el navegador del comprador (no sube nada a ningún sitio).
import { jsPDF } from "jspdf";
import qrcode from "qrcode-generator";
import { textoQR } from "./Publico.jsx";

const hexRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); const n = m ? parseInt(m[1], 16) : 0xff5a3c; return [n >> 16, (n >> 8) & 255, n & 255]; };
const fechaTxt = (v, conHora = true) => { if (!v) return ""; const d = new Date(String(v).length <= 10 ? v + "T12:00" : v); if (isNaN(d)) return ""; return d.toLocaleString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric", ...(conHora && String(v).length > 10 ? { hour: "2-digit", minute: "2-digit" } : {}) }); };
const horaTxt = (v) => { const d = new Date(v); return isNaN(d) ? "" : d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }); };

// Imagen (cualquier formato) → JPEG en base64 con su tamaño, para meterla en el PDF
async function imagen(url) {
  if (!url) return null;
  try {
    const blob = await (await fetch(url, { mode: "cors" })).blob();
    const bmp = await createImageBitmap(blob);
    const max = 1400, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    return { data: c.toDataURL("image/jpeg", 0.88), w: c.width, h: c.height };
  } catch { return null; }
}

function dibujarQR(doc, texto, x, y, lado) {
  const q = qrcode(0, "M"); q.addData(texto, /^[0-9A-Z $%*+\-./:]+$/.test(texto) ? "Alphanumeric" : "Byte"); q.make();
  const n = q.getModuleCount(), margen = 2, m = lado / (n + margen * 2);
  doc.setFillColor(255, 255, 255); doc.rect(x, y, lado, lado, "F");
  doc.setFillColor(0, 0, 0);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) doc.rect(x + (c + margen) * m, y + (r + margen) * m, m + 0.02, m + 0.02, "F");
}

export async function pdfEntradas(d) {
  const ev = d.evento, p = d.pedido;
  const color = hexRgb(ev.diseno?.color);
  const [flyer, logo] = await Promise.all([imagen(ev.flyer_url), imagen(ev.logo_url)]);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, M = 14;
  const desde = ev.inicio ? new Date(new Date(ev.inicio).getTime() - (ev.qr_horas_antes ?? 24) * 3600000) : null;
  const validas = d.entradas.filter(x => x.estado === "valida" && x.qr_hex);
  if (!validas.length) throw new Error("sin entradas");

  validas.forEach((x, i) => {
    if (i) doc.addPage();
    // Marca de agua de prueba, debajo de todo (el QR va encima, sobre blanco, y se lee igual)
    if (x.prueba) {
      try { doc.saveGraphicsState(); doc.setGState(new doc.GState({ opacity: 0.16 })); } catch {}
      doc.setTextColor(255, 140, 0); doc.setFont("helvetica", "bold"); doc.setFontSize(80);
      doc.text("PRUEBA", 60, 250, { angle: 30 });
      try { doc.restoreGraphicsState(); } catch {}
    }
    // ---- Cabecera con el flyer ----
    const altoFlyer = 96;
    doc.setFillColor(11, 12, 16); doc.rect(0, 0, W, altoFlyer, "F");
    if (flyer) {
      const k = Math.min((W - 2 * M) / flyer.w, (altoFlyer - 12) / flyer.h);
      const w = flyer.w * k, h = flyer.h * k;
      doc.addImage(flyer.data, "JPEG", (W - w) / 2, (altoFlyer - h) / 2, w, h);
    }
    if (logo) { const k = Math.min(36 / logo.w, 14 / logo.h); doc.addImage(logo.data, "JPEG", M, 6, logo.w * k, logo.h * k); }
    // franja de color con tramo y número
    doc.setFillColor(...color); doc.rect(0, altoFlyer, W, 12, "F");
    const tinta = (color[0] * .299 + color[1] * .587 + color[2] * .114) > 160 ? [17, 17, 17] : [255, 255, 255];
    doc.setTextColor(...tinta); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text(`${x.tramo.toUpperCase()}`, M, altoFlyer + 8);
    doc.text(`Nº ${String(x.numero).padStart(4, "0")}`, W - M, altoFlyer + 8, { align: "right" });

    // ---- Evento ----
    let y = altoFlyer + 24;
    doc.setTextColor(17, 17, 17); doc.setFontSize(24);
    const titulo = doc.splitTextToSize(ev.nombre || "", W - 2 * M);
    doc.text(titulo.slice(0, 2), M, y); y += titulo.slice(0, 2).length * 9 + 1;
    doc.setFont("helvetica", "normal"); doc.setFontSize(12); doc.setTextColor(70, 74, 82);
    const cuando = fechaTxt(ev.inicio || ev.fecha) + (ev.fin ? ` · hasta las ${horaTxt(ev.fin)}` : "");
    doc.text(cuando.charAt(0).toUpperCase() + cuando.slice(1), M, y); y += 6;
    const donde = [ev.recinto, ev.direccion].filter(Boolean).join(" · ");
    if (donde) { const l = doc.splitTextToSize(donde, W - 2 * M); doc.text(l.slice(0, 2), M, y); y += l.slice(0, 2).length * 5.5; }

    // ---- Asistente + QR ----
    y += 6;
    const lado = 74, xQR = W - M - lado;
    doc.setDrawColor(225, 227, 232); doc.setLineWidth(0.4); doc.roundedRect(M, y, W - 2 * M, lado + 8, 4, 4, "S");
    dibujarQR(doc, textoQR(x.qr_hex), xQR - 4, y + 4, lado);
    let yy = y + 12;
    const col = xQR - M - 12;
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(120, 124, 132); doc.text("ASISTENTE", M + 6, yy); yy += 7;
    doc.setFontSize(20); doc.setTextColor(17, 17, 17);
    const nom = doc.splitTextToSize(x.asistente, col); doc.text(nom.slice(0, 2), M + 6, yy); yy += nom.slice(0, 2).length * 8 + 4;
    const dato = (l, v) => { doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(120, 124, 132); doc.text(l, M + 6, yy); doc.setFont("helvetica", "normal"); doc.setFontSize(11.5); doc.setTextColor(17, 17, 17); doc.text(doc.splitTextToSize(v, col).slice(0, 2), M + 6, yy + 5); yy += 12; };
    dato("ENTRADA", `${x.tramo} · ${Number(x.precio) ? `${Number(x.precio).toFixed(2).replace(".", ",")} €` : "Gratis"}`);
    dato("PEDIDO", `${p.codigo} · ${p.nombre}`);
    if (desde) dato("VÁLIDA", `Desde ${fechaTxt(desde.toISOString())}${ev.fin ? ` hasta las ${horaTxt(ev.fin)}` : ""}`);
    y += lado + 16;

    // ---- Avisos ----
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(70, 74, 82);
    const avisos = [
      "Entrada nominativa y de un solo uso: el código QR solo vale una vez y solo en las fechas del evento.",
      "Puede pedirse identificación en la puerta. Prohibida la reventa: las copias se detectan y no dan acceso.",
      ev.edad_minima ? `Edad mínima: ${ev.edad_minima} años.${ev.autorizacion_url ? ` Menores de ${ev.autorizacion_edad || 16}: traer la autorización firmada.` : ""}` : null,
      ev.vestimenta ? `Vestimenta: ${ev.vestimenta}.` : null,
    ].filter(Boolean);
    avisos.forEach(a => { const l = doc.splitTextToSize("•  " + a, W - 2 * M); doc.text(l, M, y); y += l.length * 5 + 1.5; });

    // ---- Pie ----
    doc.setDrawColor(230, 231, 235); doc.line(M, 282, W - M, 282);
    doc.setFontSize(9); doc.setTextColor(140, 144, 152);
    doc.text("Entradas con TIXFAST", M, 288);
    doc.text(`${i + 1} / ${validas.length}`, W - M, 288, { align: "right" });

    if (x.prueba) { doc.setFontSize(11); doc.setTextColor(200, 110, 0); doc.text("ENTRADA DE PRUEBA · NO VÁLIDA PARA ENTRAR", W / 2, 277, { align: "center" }); }
  });
  const nombre = `entradas-${(ev.nombre || "evento").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${p.codigo}.pdf`;
  doc.save(nombre);
}

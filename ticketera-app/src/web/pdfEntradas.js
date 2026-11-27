// ===================== PDF DE LAS ENTRADAS =====================
// Una página por entrada, con la imagen del evento: flyer a sangre arriba, la entrada como una tarjeta con
// troquel, el color del evento y un QR grande enmarcado (los tres marcadores van en el color del evento si
// se lee bien sobre blanco; si no, en negro). Se crea en el navegador del comprador (no sube nada).
import { jsPDF } from "jspdf";
import qrcode from "qrcode-generator";
import { textoQR } from "./Publico.jsx";

const hexRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); const n = m ? parseInt(m[1], 16) : 0xff5a3c; return [n >> 16, (n >> 8) & 255, n & 255]; };
const luz = ([r, g, b]) => (r * .299 + g * .587 + b * .114) / 255;
const fechaTxt = (v, conHora = true) => { if (!v) return ""; const d = new Date(String(v).length <= 10 ? v + "T12:00" : v); if (isNaN(d)) return ""; return d.toLocaleString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric", ...(conHora && String(v).length > 10 ? { hour: "2-digit", minute: "2-digit" } : {}) }); };
const horaTxt = (v) => { const d = new Date(v); return isNaN(d) ? "" : d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }); };
const cap = (x) => x ? x.charAt(0).toUpperCase() + x.slice(1) : x;
const eur = (v) => Number(v) ? `${Number(v).toFixed(2).replace(".", ",")} €` : "Invitación";

// Imagen → JPEG recortada para llenar un hueco de proporción «aspecto» (como object-fit: cover)
async function imagen(url, aspecto) {
  if (!url) return null;
  try {
    const blob = await (await fetch(url, { mode: "cors" })).blob();
    const bmp = await createImageBitmap(blob);
    let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
    if (aspecto) { if (sw / sh > aspecto) { sw = sh * aspecto; sx = (bmp.width - sw) / 2; } else { sh = sw / aspecto; sy = (bmp.height - sh) * 0.3; } }
    const max = 1600, k = Math.min(1, max / Math.max(sw, sh));
    const c = document.createElement("canvas"); c.width = Math.round(sw * k); c.height = Math.round(sh * k);
    const g = c.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return { data: c.toDataURL("image/jpeg", 0.9), w: c.width, h: c.height };
  } catch { return null; }
}

// QR con módulos de esquinas suaves y los tres marcadores dibujados aparte (se leen igual que uno normal)
function dibujarQR(doc, texto, x, y, lado, color) {
  const q = qrcode(0, "M"); q.addData(texto, /^[0-9A-Z $%*+\-./:]+$/.test(texto) ? "Alphanumeric" : "Byte"); q.make();
  const n = q.getModuleCount(), margen = 1.5, m = lado / (n + margen * 2);
  const ox = x + margen * m, oy = y + margen * m;
  const enMarcador = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  doc.setFillColor(255, 255, 255); doc.rect(x, y, lado, lado, "F");
  doc.setFillColor(17, 17, 20);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (enMarcador(r, c) || !q.isDark(r, c)) continue;
    doc.roundedRect(ox + c * m + m * 0.06, oy + r * m + m * 0.06, m * 0.88, m * 0.88, m * 0.16, m * 0.16, "F");
  }
  const ojo = color && luz(color) < 0.62 ? color : [17, 17, 20];
  [[0, 0], [0, n - 7], [n - 7, 0]].forEach(([r, c]) => {
    const px = ox + c * m, py = oy + r * m;
    doc.setFillColor(...ojo); doc.roundedRect(px, py, 7 * m, 7 * m, m * 1.6, m * 1.6, "F");
    doc.setFillColor(255, 255, 255); doc.roundedRect(px + m, py + m, 5 * m, 5 * m, m * 1.1, m * 1.1, "F");
    doc.setFillColor(...ojo); doc.roundedRect(px + 2 * m, py + 2 * m, 3 * m, 3 * m, m * 0.8, m * 0.8, "F");
  });
}

export async function pdfEntradas(d) {
  const ev = d.evento, p = d.pedido;
  const color = hexRgb(ev.diseno?.color);
  const tinta = luz(color) > 0.63 ? [17, 17, 20] : [255, 255, 255];
  const W = 210, H = 297, M = 12, ALTO_FLYER = 118;
  const [flyer, logo] = await Promise.all([imagen(ev.flyer_url, W / ALTO_FLYER), imagen(ev.logo_url)]);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const desde = ev.inicio ? new Date(new Date(ev.inicio).getTime() - (ev.qr_horas_antes ?? 24) * 3600000) : null;
  const validas = d.entradas.filter(x => x.estado === "valida" && x.qr_hex);
  if (!validas.length) throw new Error("sin entradas");

  validas.forEach((x, i) => {
    if (i) doc.addPage();
    // ---- Fondo y flyer a sangre ----
    doc.setFillColor(11, 12, 16); doc.rect(0, 0, W, H, "F");
    if (flyer) doc.addImage(flyer.data, "JPEG", 0, 0, W, ALTO_FLYER);
    else { doc.setFillColor(...color); doc.rect(0, 0, W, ALTO_FLYER, "F"); }
    if (logo) {
      const k = Math.min(34 / logo.w, 13 / logo.h), lw = logo.w * k, lh = logo.h * k;
      doc.setFillColor(255, 255, 255); doc.roundedRect(M, M, lw + 8, lh + 6, 3, 3, "F");
      doc.addImage(logo.data, "JPEG", M + 4, M + 3, lw, lh);
    }

    // ---- La entrada (tarjeta blanca que monta sobre el flyer) ----
    const cx = M, cy = ALTO_FLYER - 22, cw = W - 2 * M, ch = H - cy - 16;
    doc.setFillColor(255, 255, 255); doc.roundedRect(cx, cy, cw, ch, 6, 6, "F");
    // franja de color con el tipo de entrada y el número
    doc.setFillColor(...color); doc.roundedRect(cx, cy, cw, 16, 6, 6, "F"); doc.rect(cx, cy + 8, cw, 8, "F");
    doc.setTextColor(...tinta); doc.setFont("helvetica", "bold"); doc.setFontSize(12.5);
    doc.text(doc.splitTextToSize(String(x.tramo || "").toUpperCase(), cw - 60)[0] || "", cx + 8, cy + 10.4);
    doc.text(`Nº ${String(x.numero).padStart(4, "0")}`, cx + cw - 8, cy + 10.4, { align: "right" });

    // evento
    let y = cy + 30;
    doc.setTextColor(17, 17, 20); doc.setFontSize(25);
    const titulo = doc.splitTextToSize(ev.nombre || "", cw - 16).slice(0, 2);
    doc.text(titulo, cx + 8, y); y += titulo.length * 9.6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(12); doc.setTextColor(70, 74, 82);
    const cuando = cap(fechaTxt(ev.inicio || ev.fecha)) + (ev.fin ? ` · hasta las ${horaTxt(ev.fin)}` : "");
    doc.text(doc.splitTextToSize(cuando, cw - 16)[0] || "", cx + 8, y); y += 6;
    const donde = [ev.recinto, ev.direccion].filter(Boolean).join(" · ");
    if (donde) { const l = doc.splitTextToSize(donde, cw - 16).slice(0, 2); doc.text(l, cx + 8, y); y += l.length * 5.4; }

    // asistente
    y += 5;
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(130, 134, 142); doc.text("ASISTENTE", cx + 8, y);
    doc.text("PRECIO", cx + cw - 8, y, { align: "right" }); y += 7.5;
    doc.setFontSize(18); doc.setTextColor(17, 17, 20);
    doc.text(doc.splitTextToSize(x.asistente || "", cw - 60)[0] || "", cx + 8, y);
    doc.setTextColor(...(luz(color) < 0.62 ? color : [17, 17, 20])); doc.text(eur(x.precio), cx + cw - 8, y, { align: "right" });

    // troquel: línea de puntos con dos muescas
    const yT = Math.max(y + 8, cy + 76);
    doc.setFillColor(11, 12, 16); doc.circle(cx, yT, 4.2, "F"); doc.circle(cx + cw, yT, 4.2, "F");
    doc.setDrawColor(205, 208, 214); doc.setLineWidth(0.5); doc.setLineDashPattern([1.6, 1.6], 0); doc.line(cx + 7, yT, cx + cw - 7, yT); doc.setLineDashPattern([], 0);

    // QR grande, enmarcado en el color del evento
    const lado = 70, marco = 5;
    const qx = W / 2 - lado / 2, qy = yT + 9;
    doc.setFillColor(...color); doc.roundedRect(qx - marco, qy - marco, lado + 2 * marco, lado + 2 * marco, 6, 6, "F");
    doc.setFillColor(255, 255, 255); doc.roundedRect(qx - 1.5, qy - 1.5, lado + 3, lado + 3, 3.5, 3.5, "F");
    dibujarQR(doc, textoQR(x.qr_hex), qx, qy, lado, color);
    let yq = qy + lado + marco + 7;
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(17, 17, 20);
    doc.text("Enséñalo en la puerta · vale para una sola entrada", W / 2, yq, { align: "center" }); yq += 5.5;
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(110, 114, 122);
    const linea2 = [`Pedido ${p.codigo}`, x.acceso === "dia" && x.dia ? `Solo el ${fechaTxt(x.dia)}` : (ev.fin && ev.inicio && String(ev.fin).slice(0, 10) > String(ev.inicio).slice(0, 10)) ? "Abono: cualquier día, un solo uso" : desde ? `Válida desde ${fechaTxt(desde.toISOString())}` : null].filter(Boolean).join(" · ");
    doc.text(doc.splitTextToSize(linea2, cw - 16)[0] || "", W / 2, yq, { align: "center" }); yq += 6;

    // condiciones, en pequeño al pie de la tarjeta
    const avisos = [
      "Entrada nominativa y de un solo uso. Puede pedirse identificación. Prohibida la reventa: las copias no dan acceso.",
      ev.edad_minima ? `Edad mínima: ${ev.edad_minima} años.${ev.autorizacion_url ? ` Menores de ${ev.autorizacion_edad || 16}: traer la autorización firmada.` : ""}` : null,
      ev.vestimenta ? `Vestimenta: ${ev.vestimenta}.` : null,
    ].filter(Boolean).join(" ");
    doc.setFontSize(8.5); doc.setTextColor(130, 134, 142);
    const lav = doc.splitTextToSize(avisos, cw - 20).slice(0, 2);
    doc.text(lav, W / 2, yq, { align: "center" });

    // ---- Pie (sobre el fondo oscuro) ----
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(200, 203, 210);
    doc.text("TIXFAST", M, H - 6.5);
    doc.setFont("helvetica", "normal"); doc.setTextColor(140, 144, 152);
    doc.text(`Entrada ${i + 1} de ${validas.length}`, W - M, H - 6.5, { align: "right" });

    // Prueba: marca de agua y aviso (el QR queda encima, sobre blanco, y se lee igual)
    if (x.prueba) {
      try { doc.saveGraphicsState(); doc.setGState(new doc.GState({ opacity: 0.18 })); } catch {}
      doc.setTextColor(255, 140, 0); doc.setFont("helvetica", "bold"); doc.setFontSize(86);
      doc.text("PRUEBA", 38, 120, { angle: 28 });
      try { doc.restoreGraphicsState(); } catch {}
      doc.setFillColor(255, 180, 0); doc.roundedRect(W / 2 - 52, cy - 12, 104, 8, 2, 2, "F");
      doc.setFontSize(9.5); doc.setTextColor(26, 18, 5); doc.text("ENTRADA DE PRUEBA · NO VÁLIDA PARA ENTRAR", W / 2, cy - 6.6, { align: "center" });
    }
  });
  const nombre = `entradas-${(ev.nombre || "evento").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${p.codigo}.pdf`;
  doc.save(nombre);
}

// ===================== IMPRENTA · TALONARIOS CON QR (15 × 10 cm) =====================
// Genera los PDF que se mandan a la imprenta. Se crean en el navegador; no se sube nada.
//  · Cada entrada: 150 × 100 mm + 3 mm de sangrado y marcas de corte (una entrada por página; la imprenta la coloca en sus pliegos).
//  · Matriz a la izquierda (38 mm, con línea de perforado) y QR arriba a la derecha, siempre en el mismo sitio.
//  · Diseño propio (PDF o imagen del diseñador): encima solo se pone el QR (y el número si se quiere).
//  · Diseño automático: la plataforma monta el flyer con nombre, fecha, lugar, tipo de entrada y lo que incluye.
//  · Cada PDF empieza con una hoja separadora del punto de venta; la hoja de control resume todos los archivos.
// Las cuentas de posición están aquí, en milímetros, para que plantilla, vista previa y PDF coincidan siempre.
import { PDFDocument, rgb, degrees, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import qrcode from "qrcode-generator";
import { zlibSync } from "fflate";
import { base32, hexToBytes, QR_PREFIJO } from "../qr/token.js";

export const MEDIDA = {
  ancho: 150, alto: 100,      // tamaño final de la entrada
  sangrado: 3,                // fondo que se corta
  margen: 10,                 // zona exterior para las marcas de corte
  seguridad: 5,               // nada importante a menos de 5 mm del corte
  matriz: 38,                 // la matriz ocupa los primeros 38 mm por la izquierda
  qr: { x: 115, y: 5, lado: 30, codigo: 25, numero: 6 },   // recuadro blanco del QR (arriba a la derecha) y franja del número
  numMatriz: { x: 4, y: 4, ancho: 26, alto: 8 },           // número en la matriz (diseño propio)
};
export const PAGINA = { ancho: MEDIDA.ancho + 2 * MEDIDA.margen, alto: MEDIDA.alto + 2 * MEDIDA.margen };
const K = 72 / 25.4;   // mm → puntos
const pt = (mm) => mm * K;

const NEGRO = rgb(0, 0, 0), BLANCO = rgb(1, 1, 1);
const hexRgb = (hex, def = "#ff5a3c") => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || "") || /^#?([0-9a-f]{6})$/i.exec(def); const n = parseInt(m[1], 16); return rgb((n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
const claro = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return false; const n = parseInt(m[1], 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 150; };

export const textoQR = (hex) => QR_PREFIJO + base32(hexToBytes(hex));
export const numeroTxt = (n, hasta) => String(n).padStart(Math.max(3, String(hasta || n).length), "0");
export const limpio = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "punto";
export const nombreArchivo = (orden, punto, lote) => `${String(orden).padStart(2, "0")}_${limpio(punto?.nombre)}_${limpio(lote?.nombre)}_${lote.desde}-${lote.hasta}.pdf`;

// ---------- Comprobaciones (antes de dar un PDF por bueno) ----------
// Que estén todas las del rango, sin repetidos, con su QR, y que lo devuelto/anulado no se imprima.
export function comprobarEntradas(lote, entradas, { soloValidas = true } = {}) {
  const errores = [];
  const vistos = new Set();
  for (const x of entradas) {
    if (vistos.has(x.numero)) errores.push(`El nº ${x.numero} está repetido`);
    vistos.add(x.numero);
    if (x.numero < lote.desde || x.numero > lote.hasta) errores.push(`El nº ${x.numero} no es de esta entrega (${lote.desde}–${lote.hasta})`);
    if (!/^[0-9a-f]{66}$/i.test(x.qr_hex || "")) errores.push(`El nº ${x.numero} no tiene un QR correcto`);
    if (soloValidas && x.estado && x.estado !== "valida") errores.push(`El nº ${x.numero} está anulada y no se debe imprimir`);
  }
  return errores;
}

// ---------- Revisión del diseño subido ----------
// medidas en mm (PDF) o en píxeles (imagen). Devuelve { ok, error, avisos, sangrado, dpi }.
export function revisarDiseno({ tipo, anchoMm, altoMm, anchoPx, altoPx }) {
  const avisos = [];
  const conS = { a: MEDIDA.ancho + 2 * MEDIDA.sangrado, h: MEDIDA.alto + 2 * MEDIDA.sangrado };
  if (tipo === "pdf") {
    if (!(anchoMm > 0 && altoMm > 0)) return { ok: false, error: "No se ha podido leer el tamaño del PDF." };
    if (altoMm > anchoMm) return { ok: false, error: "El diseño está en vertical. La entrada es horizontal: 15 cm de ancho × 10 cm de alto." };
    const cerca = (a, b) => Math.abs(a - b) <= 1.5;
    if (cerca(anchoMm, conS.a) && cerca(altoMm, conS.h)) return { ok: true, avisos, sangrado: true };
    if (cerca(anchoMm, MEDIDA.ancho) && cerca(altoMm, MEDIDA.alto)) { avisos.push("El diseño no tiene sangrado (mide justo 15 × 10 cm). Puede quedar un filo blanco al cortar: lo ideal es 15,6 × 10,6 cm."); return { ok: true, avisos, sangrado: false }; }
    const r = anchoMm / altoMm;
    if (Math.abs(r - conS.a / conS.h) < 0.03) { avisos.push(`El diseño mide ${anchoMm.toFixed(0)} × ${altoMm.toFixed(0)} mm: se ajustará a 15,6 × 10,6 cm (misma proporción).`); return { ok: true, avisos, sangrado: true }; }
    if (Math.abs(r - 1.5) < 0.03) { avisos.push(`El diseño mide ${anchoMm.toFixed(0)} × ${altoMm.toFixed(0)} mm y no tiene sangrado: se ajustará a 15 × 10 cm.`); return { ok: true, avisos, sangrado: false }; }
    return { ok: false, error: `El diseño mide ${anchoMm.toFixed(0)} × ${altoMm.toFixed(0)} mm. Tiene que ser de 15,6 × 10,6 cm (con sangrado) o 15 × 10 cm. Usa la plantilla.` };
  }
  if (!(anchoPx > 0 && altoPx > 0)) return { ok: false, error: "No se ha podido leer la imagen." };
  if (altoPx > anchoPx) return { ok: false, error: "La imagen está en vertical. La entrada es horizontal: 15 cm de ancho × 10 cm de alto." };
  const r = anchoPx / altoPx;
  let sangrado;
  if (Math.abs(r - conS.a / conS.h) < 0.03) sangrado = true;
  else if (Math.abs(r - 1.5) < 0.03) { sangrado = false; avisos.push("La imagen no tiene sangrado (proporción justa de 15 × 10). Puede quedar un filo blanco al cortar."); }
  else return { ok: false, error: `La imagen no tiene la proporción de la entrada (15,6 × 10,6 cm con sangrado). Usa la plantilla.` };
  const dpi = Math.round(anchoPx / ((sangrado ? conS.a : MEDIDA.ancho) / 25.4));
  if (dpi < 150) return { ok: false, error: `La imagen tiene muy poca resolución (${dpi} ppp). Para imprenta hace falta 300 ppp: ${Math.round(conS.a / 25.4 * 300)} × ${Math.round(conS.h / 25.4 * 300)} píxeles.` };
  if (dpi < 280) avisos.push(`La imagen tiene ${dpi} ppp; para imprenta lo ideal son 300 ppp (${Math.round(conS.a / 25.4 * 300)} × ${Math.round(conS.h / 25.4 * 300)} píxeles). Se puede ver algo borrosa.`);
  return { ok: true, avisos, sangrado, dpi };
}

// ---------- Fuentes (Inter para los textos y Roboto Mono para los números, como en los tickets) ----------
export async function cargarFuentesNavegador() {
  const urls = await Promise.all([
    import("@fontsource/inter/files/inter-latin-400-normal.woff?url"),
    import("@fontsource/inter/files/inter-latin-800-normal.woff?url"),
    import("@fontsource/roboto-mono/files/roboto-mono-latin-700-normal.woff?url"),
  ]);
  const [normal, negrita, mono] = await Promise.all(urls.map(async (m) => new Uint8Array(await (await fetch(m.default)).arrayBuffer())));
  return { normal, negrita, mono };
}

// PNG de 1 × 256 px de un color que va de transparente (arriba) a casi opaco (abajo)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function pngDegradado(hex, max = 0.92) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "") || ["", "0b0c10"]; const n = parseInt(m[1], 16);
  const alto = 256, filas = new Uint8Array(alto * 5);
  for (let y = 0; y < alto; y++) { const t = y / (alto - 1), a = Math.round(255 * max * (t * t * (3 - 2 * t))); filas.set([0, n >> 16, (n >> 8) & 255, n & 255, a], y * 5); }
  const trozo = (tipo, datos) => { const out = new Uint8Array(12 + datos.length), dv = new DataView(out.buffer); dv.setUint32(0, datos.length); out.set([...tipo].map((ch) => ch.charCodeAt(0)), 4); out.set(datos, 8); dv.setUint32(8 + datos.length, crc32(out.subarray(4, 8 + datos.length))); return out; };
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer); dv.setUint32(0, 1); dv.setUint32(4, alto); ihdr.set([8, 6, 0, 0, 0], 8);
  const partes = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), trozo("IHDR", ihdr), trozo("IDAT", zlibSync(filas)), trozo("IEND", new Uint8Array(0))];
  const total = new Uint8Array(partes.reduce((s, x) => s + x.length, 0)); let o = 0; for (const x of partes) { total.set(x, o); o += x.length; }
  return total;
}

// ---------- Motor ----------
async function nuevoDoc(fuentes, titulo) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(titulo || "Entradas"); doc.setCreator("TIXFAST"); doc.setProducer("TIXFAST");
  const f = {
    normal: await doc.embedFont(fuentes.normal, { subset: true }),
    negrita: await doc.embedFont(fuentes.negrita, { subset: true }),
    mono: await doc.embedFont(fuentes.mono, { subset: true }),
  };
  return { doc, f };
}

// Página con la entrada en el centro: (x, y) en mm desde la esquina superior izquierda del CORTE
function lienzo(page) {
  const H = PAGINA.alto, M = MEDIDA.margen;
  const X = (x) => pt(M + x), Y = (y) => pt(H - M - y);
  return {
    X, Y,
    rect: (x, y, w, h, o) => page.drawRectangle({ x: X(x), y: Y(y + h), width: pt(w), height: pt(h), ...o }),
    linea: (x1, y1, x2, y2, o) => page.drawLine({ start: { x: X(x1), y: Y(y1) }, end: { x: X(x2), y: Y(y2) }, thickness: 0.3, color: NEGRO, ...o }),
    texto: (t, x, yBase, o) => page.drawText(String(t), { x: X(x), y: Y(yBase), ...o }),
    // Recorta lo que se dibuje dentro de fn al rectángulo dado
    recorte: (x, y, w, h, fn) => { page.pushOperators(pushGraphicsState(), rectangle(X(x), Y(y + h), pt(w), pt(h)), clip(), endPath()); fn(); page.pushOperators(popGraphicsState()); },
  };
}

// Corta un texto en líneas que quepan en «ancho» mm (como mucho «max» líneas, la última con «…»)
export function partir(texto, font, size, anchoMm, max = 2) {
  const palabras = String(texto || "").split(/\s+/).filter(Boolean);
  const lineas = []; let actual = "";
  const cabe = (s) => font.widthOfTextAtSize(s, size) <= pt(anchoMm);
  for (const p of palabras) {
    const prueba = actual ? actual + " " + p : p;
    if (cabe(prueba)) actual = prueba;
    else { if (actual) lineas.push(actual); actual = p; while (!cabe(actual) && actual.length > 1) actual = actual.slice(0, -1); }
  }
  if (actual) lineas.push(actual);
  if (lineas.length > max) { const l = lineas.slice(0, max); let u = l[max - 1] + "…"; while (!cabe(u) && u.length > 2) u = u.slice(0, -2) + "…"; l[max - 1] = u; return l; }
  return lineas;
}

function marcasCorte(c) {
  const { ancho: A, alto: H, sangrado: S, matriz: MZ } = MEDIDA;
  const d1 = S + 1, d2 = MEDIDA.margen - 0.5;   // las marcas empiezan fuera del sangrado
  for (const x of [0, A]) for (const y of [0, H]) {
    const sx = x === 0 ? -1 : 1, sy = y === 0 ? -1 : 1;
    c.linea(x + sx * d1, y, x + sx * d2, y);
    c.linea(x, y + sy * d1, x, y + sy * d2);
  }
  // Perforado de la matriz: marca discontinua arriba y abajo
  c.linea(MZ, -d1, MZ, -d2, { dashArray: [2, 1.5] });
  c.linea(MZ, H + d1, MZ, H + d2, { dashArray: [2, 1.5] });
}

function dibujarQR(c, hex) {
  const q = qrcode(0, "M"); q.addData(textoQR(hex), "Alphanumeric"); q.make();
  const n = q.getModuleCount(), lado = MEDIDA.qr.codigo, m = lado / n;
  const x0 = MEDIDA.qr.x + (MEDIDA.qr.lado - lado) / 2, y0 = MEDIDA.qr.y + (MEDIDA.qr.lado - lado) / 2;
  for (let r = 0; r < n; r++) {
    let c0 = -1;
    for (let col = 0; col <= n; col++) {
      const osc = col < n && q.isDark(r, col);
      if (osc && c0 < 0) c0 = col;
      if (!osc && c0 >= 0) { c.rect(x0 + c0 * m, y0 + r * m, (col - c0) * m + 0.01, m + 0.01, { color: NEGRO }); c0 = -1; }   // tramos seguidos: menos peso
    }
  }
  return n;
}

function bloqueQR(c, f, x, { numero, hasta, prueba, verNumero }) {
  const { x: qx, y: qy, lado, numero: hn } = MEDIDA.qr;
  c.rect(qx, qy, lado, lado + (verNumero || prueba ? hn : 0), { color: BLANCO });
  dibujarQR(c, x.qr_hex);
  if (prueba) {
    const t = "PRUEBA · NO VÁLIDA", s = 6.5, w = f.negrita.widthOfTextAtSize(t, s) / K;
    c.texto(t, qx + (lado - w) / 2, qy + lado + 4.3, { size: s, font: f.negrita, color: rgb(0.85, 0.45, 0) });
  } else if (verNumero) {
    const t = `Nº ${numeroTxt(numero, hasta)}`, s = 8.5, w = f.mono.widthOfTextAtSize(t, s) / K;
    c.texto(t, qx + (lado - w) / 2, qy + lado + 4.3, { size: s, font: f.mono, color: NEGRO });
  }
}

const fechaCorta = (ev) => {
  const v = ev.startsAt || ev.inicio || ev.date || ev.fecha; if (!v) return "";
  const d = new Date(String(v).length <= 10 ? v + "T12:00" : v); if (isNaN(d)) return "";
  const dia = d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const hora = String(v).length > 10 ? " · " + d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "";
  return dia.charAt(0).toUpperCase() + dia.slice(1) + hora;
};

// Fondo automático: flyer a la derecha de la matriz, degradado para que se lean los textos, datos del evento y de la entrada
function fondoAuto(c, f, { ev, lote, flyer, ajustes = {} }) {
  const { ancho: A, alto: H, sangrado: S, matriz: MZ } = MEDIDA;
  const fondo = ajustes.fondo || "#0b0c10", acento = ajustes.color || "#ff5a3c";
  c.rect(-S, -S, A + 2 * S, H + 2 * S, { color: hexRgb(fondo, "#0b0c10") });
  // Flyer «a sangre» en la parte principal, encuadrado sin deformar
  if (flyer) {
    const zx = MZ, zy = -S, zw = A + S - MZ, zh = H + 2 * S;
    const r = flyer.width / flyer.height, rz = zw / zh;
    let w, h; if (r > rz) { h = zh; w = zh * r; } else { w = zw; h = zw / r; }
    const enc = ajustes.encuadre === "arriba" ? 0 : ajustes.encuadre === "abajo" ? 1 : 0.5;
    const x = zx + (zw - w) / 2, y = zy + (zh - h) * enc;
    c.recorte(zx, zy, zw, zh, () => c.page.drawImage(flyer, { x: c.X(x), y: c.Y(y + h), width: pt(w), height: pt(h) }));
    // Degradado hacia abajo (para el texto) y a la izquierda (une con la matriz)
    // Degradado continuo hacia abajo para que se lean los textos (una imagen de 1 × 256 px estirada: sin costuras)
    const desde = 34;
    c.page.drawImage(c.degradado, { x: c.X(MZ), y: c.Y(H + S), width: pt(A + S - MZ), height: pt(H + S - desde) });
  }
  // Matriz
  c.rect(-S, -S, MZ + S, H + 2 * S, { color: hexRgb(fondo, "#0b0c10") });
  c.rect(MZ - 1.2, -S, 1.2, H + 2 * S, { color: hexRgb(acento) });
  c.linea(MZ, -S, MZ, H + S, { color: rgb(0.75, 0.75, 0.75), thickness: 0.6, dashArray: [3, 2] });   // perforado (se ve en la entrada)
  // Textos de la parte principal, de abajo arriba
  const tx = MZ + 5, tw = A - MZ - 10, blanco = BLANCO, gris = rgb(0.82, 0.83, 0.86);
  let y = H - MEDIDA.seguridad - 1;
  const linea = (t, font, size, color, gap = 1.3) => { c.texto(t, tx, y, { size, font, color }); y -= size / K * gap; };
  if (lote.incluye) linea(`Incluye: ${lote.incluye}`, f.negrita, 9, hexRgb(acento), 1.5);
  if (ev.venue || ev.recinto) partir(ev.venue || ev.recinto, f.normal, 9, tw, 1).reverse().forEach((l) => linea(l, f.normal, 9, gris));
  const fc = fechaCorta(ev); if (fc) linea(fc, f.normal, 9, gris, 1.6);
  partir(ev.name || ev.nombre || "Evento", f.negrita, 16, tw, 2).reverse().forEach((l) => linea(l, f.negrita, 16, blanco, 1.15));
  y -= 1.5;
  // Tipo de entrada en una etiqueta del color de la marca
  const tipo = String(lote.nombre || "Entrada").toUpperCase(), ts = 9, tW = Math.min(f.negrita.widthOfTextAtSize(tipo, ts) / K + 6, tw);
  c.rect(tx, y - 5.2, tW, 7.2, { color: hexRgb(acento) });
  c.texto(partir(tipo, f.negrita, ts, tw - 6, 1)[0], tx + 3, y, { size: ts, font: f.negrita, color: claro(acento) ? NEGRO : BLANCO });
}

// Matriz (la parte que se queda el punto de venta): número grande y datos para controlar las ventas
function matrizAuto(c, f, { ev, lote, punto, numero, hasta, ajustes = {} }) {
  const x = 4, w = MEDIDA.matriz - 8, gris = rgb(0.72, 0.74, 0.78);
  let y = 9;
  c.texto("MATRIZ", x, y, { size: 6.5, font: f.negrita, color: gris }); y += 7.5;
  c.texto(`Nº ${numeroTxt(numero, hasta)}`, x, y, { size: 13, font: f.mono, color: BLANCO }); y += 7;
  partir(String(lote.nombre || "Entrada").toUpperCase(), f.negrita, 8, w, 2).forEach((l) => { c.texto(l, x, y, { size: 8, font: f.negrita, color: hexRgb(ajustes.color || "#ff5a3c") }); y += 3.8; });
  y += 2;
  partir(ev.name || ev.nombre || "", f.normal, 7, w, 3).forEach((l) => { c.texto(l, x, y, { size: 7, font: f.normal, color: BLANCO }); y += 3.2; });
  const fc = fechaCorta(ev); if (fc) { y += 1; partir(fc, f.normal, 6.5, w, 3).forEach((l) => { c.texto(l, x, y, { size: 6.5, font: f.normal, color: gris }); y += 3; }); }
  let yb = MEDIDA.alto - MEDIDA.seguridad;
  c.texto("No vale para entrar", x, yb, { size: 6, font: f.normal, color: gris }); yb -= 3.2;
  if (punto?.nombre) partir(punto.nombre, f.negrita, 6.5, w, 2).reverse().forEach((l) => { c.texto(l, x, yb, { size: 6.5, font: f.negrita, color: BLANCO }); yb -= 3.2; });
}

function numeroMatrizPropio(c, f, numero, hasta) {
  const { x, y, ancho, alto } = MEDIDA.numMatriz;
  c.rect(x, y, ancho, alto, { color: BLANCO });
  const t = `Nº ${numeroTxt(numero, hasta)}`, s = 9, w = f.mono.widthOfTextAtSize(t, s) / K;
  c.texto(t, x + (ancho - w) / 2, y + alto - 2.6, { size: s, font: f.mono, color: NEGRO });
}

function cajas(page) {
  const M = MEDIDA.margen, S = MEDIDA.sangrado;
  page.setMediaBox(0, 0, pt(PAGINA.ancho), pt(PAGINA.alto));
  page.setBleedBox(pt(M - S), pt(M - S), pt(MEDIDA.ancho + 2 * S), pt(MEDIDA.alto + 2 * S));
  page.setTrimBox(pt(M), pt(M), pt(MEDIDA.ancho), pt(MEDIDA.alto));
}

// Prepara el fondo una sola vez por PDF (el diseño va una vez dentro del archivo aunque haya 500 entradas)
async function prepararFondo(doc, diseno) {
  if (!diseno || diseno.modo === "auto") {
    const fl = diseno?.flyer;
    if (!fl) return { modo: "auto", flyer: null };
    const img = fl.tipo === "png" ? await doc.embedPng(fl.bytes) : await doc.embedJpg(fl.bytes);
    const degradado = await doc.embedPng(pngDegradado(diseno?.ajustes?.fondo || "#0b0c10"));
    return { modo: "auto", flyer: img, degradado };
  }
  if (diseno.archivo_tipo === "pdf") {
    const [pag] = await doc.embedPdf(diseno.bytes, [0]);
    return { modo: "propio", pag, sangrado: diseno.sangrado !== false };
  }
  const img = diseno.mime === "image/png" ? await doc.embedPng(diseno.bytes) : await doc.embedJpg(diseno.bytes);
  return { modo: "propio", img, sangrado: diseno.sangrado !== false };
}

function dibujarEntrada(doc, f, fondo, datos) {
  const { ev, lote, punto, x, diseno } = datos;
  const page = doc.addPage([pt(PAGINA.ancho), pt(PAGINA.alto)]);
  cajas(page);
  const c = lienzo(page); c.page = page; c.degradado = fondo.degradado;
  const S = MEDIDA.sangrado, ajustes = diseno?.ajustes || {};
  const verNumero = diseno?.numero !== false;
  if (fondo.modo === "auto") {
    fondoAuto(c, f, { ev, lote, flyer: fondo.flyer, ajustes });
    matrizAuto(c, f, { ev, lote, punto, numero: x.numero, hasta: lote.relleno || lote.hasta, ajustes });
  } else {
    const [bx, by, bw, bh] = fondo.sangrado ? [-S, -S, MEDIDA.ancho + 2 * S, MEDIDA.alto + 2 * S] : [0, 0, MEDIDA.ancho, MEDIDA.alto];
    const o = { x: c.X(bx), y: c.Y(by + bh), width: pt(bw), height: pt(bh) };
    if (fondo.pag) page.drawPage(fondo.pag, o); else page.drawImage(fondo.img, o);
    if (verNumero) numeroMatrizPropio(c, f, x.numero, lote.relleno || lote.hasta);
  }
  bloqueQR(c, f, x, { numero: x.numero, hasta: lote.relleno || lote.hasta, prueba: !!x.prueba, verNumero: fondo.modo === "auto" || verNumero });
  marcasCorte(c);
  // Pie fuera del corte (lo ve la imprenta, no sale en la entrada)
  page.drawText(`${punto?.nombre || ""} · ${lote.nombre || ""} · nº ${x.numero}`.slice(0, 90), { x: pt(MEDIDA.margen + 12), y: pt(2.2), size: 5.5, font: f.normal, color: rgb(0.4, 0.4, 0.4) });
}

function separador(doc, f, { ev, punto, lote, n }) {
  const page = doc.addPage([pt(PAGINA.ancho), pt(PAGINA.alto)]);
  const c = lienzo(page);
  c.rect(-MEDIDA.margen, -MEDIDA.margen, PAGINA.ancho, PAGINA.alto, { color: BLANCO });
  c.rect(0, 0, MEDIDA.ancho, 3, { color: hexRgb("#ff5a3c") });
  let y = 16;
  c.texto("HOJA SEPARADORA · PUNTO DE VENTA", 6, y, { size: 8, font: f.negrita, color: rgb(0.45, 0.45, 0.45) }); y += 12;
  partir(punto?.nombre || "Punto de venta", f.negrita, 22, MEDIDA.ancho - 12, 2).forEach((l) => { c.texto(l, 6, y, { size: 22, font: f.negrita, color: NEGRO }); y += 9; });
  y += 2;
  c.texto(`${lote.nombre || "Entrada"}${lote.incluye ? " · incluye " + lote.incluye : ""}`, 6, y, { size: 12, font: f.negrita, color: NEGRO }); y += 9;
  c.texto(`Nº ${numeroTxt(lote.desde, lote.relleno || lote.hasta)} a ${numeroTxt(lote.hasta, lote.relleno || lote.hasta)}`, 6, y, { size: 16, font: f.mono, color: NEGRO }); y += 8;
  c.texto(`${n} entradas`, 6, y, { size: 12, font: f.normal, color: NEGRO }); y += 10;
  partir(`${ev.name || ev.nombre || ""} · ${fechaCorta(ev)}`, f.normal, 9, MEDIDA.ancho - 12, 2).forEach((l) => { c.texto(l, 6, y, { size: 9, font: f.normal, color: rgb(0.35, 0.35, 0.35) }); y += 4.5; });
  c.texto("Empaquetar estas entradas juntas, con esta hoja encima. No mezclar con otros puntos de venta.", 6, MEDIDA.alto - 6, { size: 7.5, font: f.normal, color: rgb(0.35, 0.35, 0.35) });
}

// PDF de una entrega (lo que se imprime para un punto de venta)
export async function pdfLoteImprenta({ ev, punto, lote, entradas, diseno, fuentes, conSeparador = true, onProgreso }) {
  const lista = [...entradas].sort((a, b) => a.numero - b.numero);
  const errores = comprobarEntradas(lote, lista);
  if (errores.length) throw new Error(errores.slice(0, 3).join(". "));
  if (!lista.length) throw new Error("No hay entradas para imprimir en esta entrega");
  const { doc, f } = await nuevoDoc(fuentes, `${punto?.nombre || "Punto de venta"} · ${lote.nombre} · ${lote.desde}-${lote.hasta}`);
  const fondo = await prepararFondo(doc, diseno);
  if (conSeparador) separador(doc, f, { ev, punto, lote, n: lista.length });
  for (let i = 0; i < lista.length; i++) {
    dibujarEntrada(doc, f, fondo, { ev, lote, punto, x: lista[i], diseno });
    if (onProgreso && i % 25 === 24) { onProgreso(i + 1, lista.length); await new Promise((r) => setTimeout(r, 0)); }
  }
  const bytes = await doc.save({ useObjectStreams: true });
  // Comprobación final: una página por entrada (+ la separadora)
  const paginas = doc.getPageCount(), esperadas = lista.length + (conSeparador ? 1 : 0);
  if (paginas !== esperadas) throw new Error(`El PDF tiene ${paginas} páginas y debería tener ${esperadas}`);
  return { bytes, paginas, entradas: lista.length };
}

// Hoja de control para la imprenta (A4): qué archivo es de qué punto y cuántas entradas lleva
export async function pdfControl({ ev, filas, fuentes, diseno }) {
  const { doc, f } = await nuevoDoc(fuentes, `Control de impresión · ${ev.name || ""}`);
  const A4 = [595.28, 841.89];
  let page = doc.addPage(A4), y = 800;
  const t = (s, x, o) => page.drawText(String(s), { x, y, size: 9.5, font: f.normal, color: NEGRO, ...o });
  t("Control de impresión de entradas", 40, { size: 18, font: f.negrita }); y -= 22;
  t(`${ev.name || ""} · ${fechaCorta(ev)}`, 40, { size: 10.5 }); y -= 26;
  const ins = [
    "Tamaño final de cada entrada: 150 × 100 mm (horizontal). Los PDF incluyen 3 mm de sangrado y marcas de corte.",
    `Matriz a la izquierda: perforado a ${MEDIDA.matriz} mm del borde izquierdo (marcas discontinuas arriba y abajo).`,
    "Una entrada por página: cada página es una entrada distinta (número y QR únicos). No duplicar páginas.",
    "Cada archivo empieza con una hoja separadora del punto de venta: empaquetar cada archivo por separado con su hoja encima.",
    `Diseño: ${diseno?.modo === "propio" ? "del diseñador, con el QR añadido" : "automático de la plataforma"}. El QR debe quedar nítido: no reducir ni reencuadrar.`,
  ];
  for (const l of ins) { for (const s of partir(l, f.normal, 9.5, 180, 3)) { t("· " + s, 40); y -= 13; } }
  y -= 10;
  const col = [40, 64, 220, 330, 400, 450, 500];
  const cab = ["#", "Punto de venta", "Tipo", "Desde", "Hasta", "Cant.", ""];
  cab.forEach((h, i) => t(h, col[i], { font: f.negrita }));
  y -= 6; page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.5, color: NEGRO }); y -= 13;
  let total = 0;
  filas.forEach((r, i) => {
    if (y < 60) { page = doc.addPage(A4); y = 800; }
    t(i + 1, col[0]); t(partir(r.punto, f.normal, 9.5, 52, 1)[0], col[1]); t(partir(r.tipo, f.normal, 9.5, 37, 1)[0], col[2]);
    t(r.desde, col[3], { font: f.mono }); t(r.hasta, col[4], { font: f.mono }); t(r.cantidad, col[5], { font: f.negrita });
    y -= 11; t(r.archivo, col[1], { size: 7.5, color: rgb(0.4, 0.4, 0.4) }); y -= 13;
    total += r.cantidad;
  });
  y -= 4; page.drawLine({ start: { x: 40, y: y + 10 }, end: { x: 555, y: y + 10 }, thickness: 0.5, color: NEGRO });
  t(`Total: ${total} entradas en ${filas.length} archivo${filas.length === 1 ? "" : "s"}`, 40, { font: f.negrita, size: 11 });
  return await doc.save();
}

// Plantilla para el diseñador: 156 × 106 mm (con sangrado), con el corte, el margen de seguridad, la matriz y el hueco del QR
export async function pdfPlantilla({ fuentes }) {
  const { doc, f } = await nuevoDoc(fuentes, "Plantilla de entrada TIXFAST 15 × 10 cm");
  const S = MEDIDA.sangrado, W = MEDIDA.ancho + 2 * S, H = MEDIDA.alto + 2 * S;
  const page = doc.addPage([pt(W), pt(H)]);
  const X = (x) => pt(S + x), Y = (y) => pt(H - S - y);
  const r = (x, y, w, h, o) => page.drawRectangle({ x: X(x), y: Y(y + h), width: pt(w), height: pt(h), ...o });
  const tx = (s, x, y, o) => page.drawText(s, { x: X(x), y: Y(y), size: 6, font: f.normal, ...o });
  const ROJO = rgb(0.9, 0.2, 0.2), CIAN = rgb(0, 0.6, 0.85), VERDE = rgb(0.1, 0.65, 0.35), MAG = rgb(0.8, 0.1, 0.6);
  page.drawRectangle({ x: 0, y: 0, width: pt(W), height: pt(H), color: rgb(0.96, 0.96, 0.97) });
  r(-S, -S, W, H, { borderColor: ROJO, borderWidth: 0.6 });
  tx("SANGRADO (3 mm): el fondo debe llegar hasta aquí", -S + 1, -S + 2.2, { color: ROJO, size: 5 });
  r(0, 0, MEDIDA.ancho, MEDIDA.alto, { borderColor: CIAN, borderWidth: 0.8, borderDashArray: [3, 2] });
  tx("CORTE 150 × 100 mm", 40, 3.2, { color: CIAN });
  const s = MEDIDA.seguridad;
  r(s, s, MEDIDA.ancho - 2 * s, MEDIDA.alto - 2 * s, { borderColor: VERDE, borderWidth: 0.5, borderDashArray: [1.5, 1.5] });
  tx("MARGEN DE SEGURIDAD: textos importantes dentro", 40, MEDIDA.alto - s - 1.5, { color: VERDE });
  page.drawLine({ start: { x: X(MEDIDA.matriz), y: Y(-S) }, end: { x: X(MEDIDA.matriz), y: Y(MEDIDA.alto + S) }, thickness: 0.8, color: MAG, dashArray: [3, 2] });
  tx("MATRIZ", 8, 50, { color: MAG, size: 9, font: f.negrita }); tx("(se queda el punto de venta)", 4.5, 54, { color: MAG, size: 5 });
  tx(`PERFORADO a ${MEDIDA.matriz} mm`, MEDIDA.matriz + 1.5, MEDIDA.alto - 10, { color: MAG, size: 5 });
  const q = MEDIDA.qr;
  r(q.x, q.y, q.lado, q.lado + q.numero, { color: BLANCO, borderColor: ROJO, borderWidth: 0.8 });
  tx("QR", q.x + 11, q.y + 15, { color: ROJO, size: 11, font: f.negrita }); tx("lo pone TIXFAST", q.x + 6.5, q.y + 20, { color: ROJO, size: 5.5 });
  tx("Nº de entrada", q.x + 7.5, q.y + q.lado + 4, { color: ROJO, size: 5.5 });
  tx("no diseñar debajo", q.x + 5.5, q.y + q.lado + q.numero + 3.5, { color: ROJO, size: 5 });
  const nm = MEDIDA.numMatriz;
  r(nm.x, nm.y, nm.ancho, nm.alto, { color: BLANCO, borderColor: ROJO, borderWidth: 0.6 });
  tx("Nº (lo pone TIXFAST)", nm.x + 1.5, nm.y + 5.2, { color: ROJO, size: 5 });
  // Segunda página: instrucciones
  const p2 = doc.addPage([pt(W), pt(H)]);
  let y = pt(H) - 30;
  const l = (s, o) => { for (const t of partir(s, f.normal, 8, W - 20, 4)) { p2.drawText(t, { x: 28, y, size: 8, font: f.normal, color: NEGRO, ...o }); y -= 11; } };
  l("Plantilla de entrada · cómo entregar el diseño", { font: f.negrita, size: 11 }); y -= 6;
  ["Tamaño del archivo: 156 × 106 mm (150 × 100 de entrada + 3 mm de sangrado por cada lado), en horizontal.",
   "Formato: PDF (mejor, los textos salen nítidos) o JPG/PNG a 300 ppp: 1843 × 1252 píxeles. Máximo 10 MB.",
   "Deja libres los recuadros rojos: ahí TIXFAST pone el QR y el número de cada entrada (todas distintas).",
   "La matriz (izquierda, 38 mm) se separa por el perforado: diseña la entrada a la derecha de la línea.",
   "Antes de subir el diseño, borra o oculta las guías de esta plantilla (no deben salir en la entrada).",
  ].forEach((s) => l("· " + s));
  return await doc.save();
}

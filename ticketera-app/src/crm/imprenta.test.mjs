// Pruebas del motor de imprenta (talonarios con QR de 15 × 10 cm)
import assert from "node:assert/strict";
import fs from "node:fs";
import { PDFDocument, rgb } from "pdf-lib";
import { comprobarEntradas, revisarDiseno, nombreArchivo, numeroTxt, pdfLoteImprenta, pdfControl, pdfPlantilla, pngDegradado, MEDIDA, PAGINA } from "./imprenta.js";

let n = 0; const ok = (t) => { n++; console.log("✓ " + t); };
const fuente = (f) => new Uint8Array(fs.readFileSync(new URL("../../node_modules/" + f, import.meta.url)));
const fuentes = { normal: fuente("@fontsource/inter/files/inter-latin-400-normal.woff"), negrita: fuente("@fontsource/inter/files/inter-latin-800-normal.woff"), mono: fuente("@fontsource/roboto-mono/files/roboto-mono-latin-700-normal.woff") };
const hex = (i) => "03" + i.toString(16).padStart(64, "0");
const lote = { nombre: "VIP", incluye: "1 copa", desde: 101, hasta: 150 };
const entradas = Array.from({ length: 50 }, (_, i) => ({ numero: 101 + i, qr_hex: hex(i + 1), estado: "valida" }));
const ev = { name: "Fiesta", startsAt: "2026-12-31T23:00", venue: "Sala" };

// Medidas: el QR cabe dentro del margen de seguridad y fuera de la matriz
assert.ok(MEDIDA.qr.x >= MEDIDA.matriz && MEDIDA.qr.x + MEDIDA.qr.lado <= MEDIDA.ancho - MEDIDA.seguridad && MEDIDA.qr.y >= MEDIDA.seguridad);
assert.ok(MEDIDA.qr.codigo >= 22, "el QR debe medir al menos 22 mm para leerse bien con el móvil");
assert.equal(PAGINA.ancho, 170); ok("medidas: QR arriba a la derecha, dentro del margen y con tamaño de sobra");

// Comprobaciones de las entradas
assert.deepEqual(comprobarEntradas(lote, entradas), []);
assert.match(comprobarEntradas(lote, [...entradas, entradas[0]]).join(), /repetido/);
assert.match(comprobarEntradas(lote, [{ numero: 99, qr_hex: hex(1) }]).join(), /no es de esta entrega/);
assert.match(comprobarEntradas(lote, [{ numero: 101, qr_hex: "abc" }]).join(), /QR correcto/);
assert.match(comprobarEntradas(lote, [{ numero: 101, qr_hex: hex(1), estado: "anulada" }]).join(), /anulada/);
ok("comprobaciones: repetidos, fuera de rango, QR roto y anuladas");

// Revisión de diseños subidos
assert.equal(revisarDiseno({ tipo: "pdf", anchoMm: 156, altoMm: 106 }).sangrado, true);
const sinS = revisarDiseno({ tipo: "pdf", anchoMm: 150, altoMm: 100 }); assert.equal(sinS.ok, true); assert.equal(sinS.sangrado, false); assert.equal(sinS.avisos.length, 1);
assert.equal(revisarDiseno({ tipo: "pdf", anchoMm: 100, altoMm: 150 }).ok, false);
assert.equal(revisarDiseno({ tipo: "pdf", anchoMm: 210, altoMm: 297 }).ok, false);
assert.equal(revisarDiseno({ tipo: "imagen", anchoPx: 1843, altoPx: 1252 }).ok, true);
assert.equal(revisarDiseno({ tipo: "imagen", anchoPx: 1843, altoPx: 1252 }).avisos.length, 0);
assert.equal(revisarDiseno({ tipo: "imagen", anchoPx: 1200, altoPx: 815 }).avisos.length, 1);   // baja resolución: aviso
assert.equal(revisarDiseno({ tipo: "imagen", anchoPx: 600, altoPx: 408 }).ok, false);           // demasiado baja
assert.equal(revisarDiseno({ tipo: "imagen", anchoPx: 1080, altoPx: 1350 }).ok, false);         // vertical
ok("diseños: con y sin sangrado, vertical, tamaño equivocado y resolución");

assert.equal(numeroTxt(7, 150), "007"); assert.equal(numeroTxt(1234, 1500), "1234");
assert.equal(nombreArchivo(3, { nombre: "Bar Ñandú & Cía" }, lote), "03_Bar_Nandu_Cia_VIP_101-150.pdf");
ok("nombres de archivo seguros para la imprenta");

// PDF real: diseño propio (PDF del diseñador) → separadora + 1 página por entrada, con cajas de corte y sangrado
const k = 72 / 25.4, d = await PDFDocument.create(); d.addPage([156 * k, 106 * k]).drawRectangle({ x: 0, y: 0, width: 156 * k, height: 106 * k, color: rgb(0.2, 0.3, 0.6) });
const r = await pdfLoteImprenta({ ev, punto: { nombre: "Bar" }, lote, entradas, fuentes, diseno: { modo: "propio", archivo_tipo: "pdf", bytes: await d.save(), numero: true } });
assert.equal(r.paginas, 51);
const leido = await PDFDocument.load(r.bytes);
const p2 = leido.getPage(1), tb = p2.getTrimBox(), bb = p2.getBleedBox();
assert.ok(Math.abs(tb.width / k - 150) < 0.01 && Math.abs(tb.height / k - 100) < 0.01);
assert.ok(Math.abs(bb.width / k - 156) < 0.01);
assert.ok(r.bytes.length < 600 * 1024, "el diseño va una sola vez dentro del PDF");
ok(`PDF de imprenta: 51 páginas, corte 150 × 100 y sangrado 3 mm (${Math.round(r.bytes.length / 1024)} KB)`);

// Diseño automático sin flyer y con flyer (PNG)
const png = pngDegradado("#ff5a3c"); assert.equal(png[1], 80);   // «PNG»
const ra = await pdfLoteImprenta({ ev, punto: { nombre: "Bar" }, lote, entradas: entradas.slice(0, 3), fuentes, diseno: { modo: "auto", ajustes: {}, flyer: { tipo: "png", bytes: png } } });
assert.equal(ra.paginas, 4);
await assert.rejects(() => pdfLoteImprenta({ ev, punto: {}, lote, entradas: [entradas[0], entradas[0]], fuentes, diseno: { modo: "auto" } }), /repetido/);
ok("diseño automático y rechazo de entradas repetidas");

const ctl = await pdfControl({ ev, filas: [{ punto: "Bar", tipo: "VIP", desde: 101, hasta: 150, cantidad: 50, archivo: "01_Bar_VIP_101-150.pdf" }], fuentes });
const pl = await pdfPlantilla({ fuentes });
assert.equal((await PDFDocument.load(pl)).getPage(0).getWidth().toFixed(1), (156 * k).toFixed(1));
assert.ok(ctl.length > 1000);
ok("hoja de control y plantilla de 156 × 106 mm");
console.log(`\n${n} pruebas de imprenta correctas`);

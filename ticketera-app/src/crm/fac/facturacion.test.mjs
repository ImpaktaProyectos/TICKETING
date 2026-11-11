import assert from "node:assert/strict";
import { calcular, baseLinea, num, trimestre, diasVencida, textoRecordatorio, urlQR } from "./calculo.js";
import { interpretarGasto, textoDePaginas, nifs } from "./leerGasto.js";
let n = 0; const ok = (name, f) => { f(); n++; console.log("✓", name); };

// ---------- Números ----------
ok("num entiende coma decimal y vacíos", () => {
  assert.equal(num("12,5"), 12.5); assert.equal(num(" 1 000,25 "), 1000.25); assert.equal(num(""), 0); assert.equal(num("abc"), 0); assert.equal(num(null), 0);
});
ok("base de línea con descuento, redondeada a céntimos", () => {
  assert.equal(baseLinea({ cantidad: 3, precio: 9.99, descuento: 10 }), 26.97);
  assert.equal(baseLinea({ cantidad: 1, precio: 100, descuento: 150 }), 0);   // el descuento no pasa del 100 %
  assert.equal(baseLinea({ cantidad: 1, precio: 100, descuento: -5 }), 100);  // ni baja de 0
});

// ---------- IVA e IRPF ----------
ok("una línea al 21 %", () => {
  const t = calcular([{ cantidad: 1, precio: 100, iva: 21 }]);
  assert.deepEqual([t.base, t.cuota_iva, t.cuota_irpf, t.total], [100, 21, 0, 121]);
});
ok("IVA por tipo sobre la suma de bases (no línea a línea), igual que fac_emitir", () => {
  // 2 líneas de 0,07 €: 0,14 € × 21 % = 0,0294 → 0,03 € (línea a línea saldría 0,01 + 0,01 = 0,02 €)
  const t = calcular([{ cantidad: 1, precio: 0.07, iva: 21 }, { cantidad: 1, precio: 0.07, iva: 21 }]);
  assert.equal(t.cuota_iva, 0.03);
});
ok("varios tipos de IVA: desglose ordenado de mayor a menor", () => {
  const t = calcular([{ cantidad: 2, precio: 50, iva: 10 }, { cantidad: 1, precio: 200, iva: 21 }, { cantidad: 1, precio: 10, iva: 0 }]);
  assert.deepEqual(t.desglose, [{ tipo: 21, base: 200, cuota: 42 }, { tipo: 10, base: 100, cuota: 10 }, { tipo: 0, base: 10, cuota: 0 }]);
  assert.equal(t.base, 310); assert.equal(t.total, 362);
});
ok("retención de IRPF del 15 % se resta del total", () => {
  const t = calcular([{ cantidad: 1, precio: 1000, iva: 21 }], 15);
  assert.deepEqual([t.base, t.cuota_iva, t.cuota_irpf, t.total], [1000, 210, 150, 1060]);
});
ok("rectificativa con cantidades negativas", () => {
  const t = calcular([{ cantidad: -2, precio: 49.5, iva: 21 }], 7);
  assert.deepEqual([t.base, t.cuota_iva, t.cuota_irpf, t.total], [-99, -20.79, -6.93, -112.86]);
});
ok("textos con coma en la línea (como se escriben en el formulario)", () => {
  const t = calcular([{ cantidad: "1,5", precio: "20,40", descuento: "", iva: 21 }]);
  assert.equal(t.base, 30.6); assert.equal(t.total, 37.03);
});
ok("sin líneas, todo a cero", () => { const t = calcular([]); assert.equal(t.total, 0); assert.deepEqual(t.desglose, []); });
ok("trimestre de cada fecha", () => {
  assert.equal(trimestre("2026-01-01"), 1); assert.equal(trimestre("2026-03-31"), 1); assert.equal(trimestre("2026-04-01"), 2); assert.equal(trimestre("2026-12-31"), 4);
});

// ---------- Vencidas y recordatorios ----------
ok("días vencida", () => {
  assert.equal(diasVencida({ vencimiento: "2026-11-01" }, "2026-11-11"), 10);
  assert.equal(diasVencida({ vencimiento: "2026-11-11" }, "2026-11-11"), 0);
  assert.equal(diasVencida({}, "2026-11-11"), 0);
  assert.equal(diasVencida({ vencimiento: "2026-03-20" }, "2026-03-31"), 11);   // cruza el cambio de hora
});
ok("texto del recordatorio con IBAN", () => {
  const r = textoRecordatorio({ codigo: "F2026-0007", fecha: "2026-10-01", vencimiento: "2026-10-31", total: 121, contacto: { nombre: "Bar Luna" } }, { razon_social: "Impakta S.L.", iban: "ES12 3456" }, "2026-11-11");
  assert.equal(r.asunto, "Recordatorio: factura F2026-0007 pendiente de pago");
  assert.match(r.cuerpo, /Hola, Bar Luna:/); assert.match(r.cuerpo, /hace 11 días/); assert.match(r.cuerpo, /ES12 3456/); assert.match(r.cuerpo, /Impakta S\.L\.$/);
});
ok("URL del QR con fecha DD-MM-AAAA e importe con punto", () => {
  const u = urlQR({ emisor: { nif: "B12345678" }, codigo: "F2026-0001", fecha: "2026-11-05", total: 1060 });
  assert.match(u, /nif=B12345678&numserie=F2026-0001&fecha=05-11-2026&importe=1060\.00$/);
});

// ---------- Leer gastos en PDF ----------
const pdf = (lineas) => textoDePaginas([{ items: lineas.flatMap((l, y) => l.split("|").map((s, x) => ({ s: s.trim(), x: x * 100, y: 800 - y * 12 }))) }]);
ok("agrupa el texto del PDF en líneas", () => {
  assert.equal(pdf(["Factura nº:|A-154", "Total:|121,00 €"]), "Factura nº: A-154\nTotal: 121,00 €");
});
ok("reconoce NIF con guiones y descarta el tuyo", () => {
  assert.deepEqual(nifs("CIF: B-12345678 · NIF 12345678-Z"), ["B12345678", "12345678Z"]);
  assert.equal(interpretarGasto("Proveedor B-12345678\nCliente B87654321", "B87654321").nif, "B12345678");
  assert.equal(interpretarGasto("Cliente B87654321\nProveedor B-12345678", "B87654321").nif, "B12345678");
});
ok("factura típica: número, fecha, base, IVA y total", () => {
  const r = interpretarGasto(pdf([
    "SONIDOS DEL SUR S.L.|CIF B12345678",
    "Factura nº:|2026/0154", "Fecha:|05/11/2026",
    "Alquiler equipo|1|500,00",
    "Base imponible|1.250,00 €", "IVA 21 %|262,50 €", "Total factura|1.512,50 €",
  ]), "B87654321");
  assert.deepEqual(r, { nif: "B12345678", numero: "2026/0154", fecha: "2026-11-05", base: 1250, iva: 21, total: 1512.5 });
});
ok("solo con el total: saca la base con el IVA que pone", () => {
  const r = interpretarGasto("Ticket 88\nFecha 3-2-26\nIVA 10% incluido\nTOTAL 55,00");
  assert.equal(r.fecha, "2026-02-03"); assert.equal(r.iva, 10); assert.equal(r.base, 50); assert.equal(r.total, 55);
});
ok("deduce el tipo de IVA de base y total", () => {
  const r = interpretarGasto("Base imponible 200,00\nTotal 242,00");
  assert.equal(r.iva, 21);
});
ok("lo que no encuentra lo deja vacío", () => {
  assert.deepEqual(interpretarGasto("hola"), { nif: null, numero: null, fecha: null, base: null, iva: null, total: null });
});

console.log(`\n${n} pruebas de facturación correctas`);

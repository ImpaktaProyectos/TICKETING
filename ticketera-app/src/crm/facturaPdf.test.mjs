import assert from "node:assert/strict";
import { interpretarGenerico, interpretarMonteagudo, numES, unidadesLinea } from "./facturaPdf.js";
let n = 0; const ok = (name, f) => { f(); n++; console.log("✓", name); };

// Página simulada: cada fila de la tabla en su altura (y baja hacia abajo, como en un PDF)
const X = { codigo: 40, descripcion: 110, cantidad: 330, precio: 390, dto: 440, iva: 480, importe: 540 };
const it = (s, x, y) => ({ s: String(s), x, y, w: String(s).length * 5 });
function pagina({ cab = ["Código", "Descripción", "Cantidad", "Precio", "% Dto", "% IVA", "Importe"], filas, arriba = [], pie = [] }) {
  const items = [...arriba];
  const ks = Object.keys(X);
  cab.forEach((t, i) => t && items.push(it(t, X[ks[i]], 700)));
  filas.forEach((f, r) => f.forEach((v, i) => v !== null && v !== "" && items.push(it(v, X[ks[i]], 680 - r * 14))));
  return [{ items: [...items, ...pie] }];
}
const arriba = [it("BEBIDAS DEL SUR S.L.", 40, 800), it("FACTURA", 400, 800), it("Nº Factura: F-2026/0815", 400, 785), it("Fecha 14/11/2026", 400, 770), it("Forma de pago: abono en cuenta", 40, 760)];

ok("números en formato español", () => { assert.equal(numES("-3.492,85"), -3492.85); assert.equal(numES("0,583"), 0.583); assert.equal(numES("21%".replace("%", "")), 21); assert.equal(numES("abc"), null); });
ok("factura de otro proveedor: líneas, proveedor, número, fecha e IVA", () => {
  const r = interpretarGenerico(pagina({ arriba, filas: [
    ["101", "RON BARCELO 70CL", "6", "12,50", "", "21", "75,00"],
    ["205", "COCA-COLA 24X33CL LATA", "2", "14,40", "10", "10", "25,92"],
  ], pie: [it("Total factura", 400, 400), it("119,26", 540, 400)] }));
  assert.equal(r.proveedor, "BEBIDAS DEL SUR S.L."); assert.equal(r.numero, "F-2026/0815"); assert.equal(r.fecha, "2026-11-14");
  assert.equal(r.tipo, "factura", "«abono en cuenta» no lo convierte en abono");
  assert.equal(r.lineas.length, 2); assert.deepEqual([r.lineas[1].codigo, r.lineas[1].cantidad, r.lineas[1].dto, r.lineas[1].importe], ["205", 2, 10, 25.92]);
  assert.deepEqual(r.pie.ivas, [{ pct: 21, base: 75, cuota: 15.75 }, { pct: 10, base: 25.92, cuota: 2.59 }]);
  assert.equal(r.checks.cuadraTotal, true);
});
ok("descripción partida en dos renglones se une a su línea", () => {
  const r = interpretarGenerico(pagina({ arriba, filas: [["101", "GINEBRA LARIOS", "6", "10,00", "", "21", "60,00"], ["", "1 LITRO", "", "", "", "", ""]] }));
  assert.equal(r.lineas.length, 1); assert.equal(r.lineas[0].descripcion, "GINEBRA LARIOS 1 LITRO");
});
ok("sin columna de importe: se calcula con precio, cantidad y descuento", () => {
  const r = interpretarGenerico(pagina({ cab: ["Ref.", "Concepto", "Uds", "PVP", "Dto", "IVA", ""], arriba, filas: [["9", "AGUA 50CL PET PACK 24", "3", "6,00", "50", "10", ""]] }));
  assert.equal(r.lineas[0].importe, 9);
});
ok("albarán sin precios: se lee la cantidad y avisa", () => {
  const r = interpretarGenerico(pagina({ cab: ["Código", "Descripción", "Cantidad", "Precio", "", "", ""], arriba: [it("DISTRIBUCIONES NORTE S.A.", 40, 800), it("ALBARÁN Nº A-77", 400, 800)],
    filas: [["1", "ESTRELLA 1/3 RET C/24", "10", "", "", "", ""]] }));
  assert.ok(r.albaran); assert.equal(r.lineas[0].cantidad, 10); assert.equal(r.lineas[0].importe, null);
  assert.ok(r.avisos.some(a => /sin precios/.test(a)));
});
ok("factura de abono (rótulo): cantidades e importes en negativo", () => {
  const r = interpretarGenerico(pagina({ arriba: [it("BEBIDAS DEL SUR S.L.", 40, 800), it("FACTURA DE ABONO", 400, 800)], filas: [["101", "RON BARCELO 70CL", "2", "12,50", "", "21", "25,00"]] }));
  assert.equal(r.tipo, "abono"); assert.equal(r.lineas[0].cantidad, -2); assert.equal(r.lineas[0].importe, -25);
});
ok("lo que va tras «Base imponible» no son líneas", () => {
  const r = interpretarGenerico(pagina({ arriba, filas: [["101", "RON 70CL", "1", "10,00", "", "21", "10,00"], ["", "Base imponible", "", "", "", "", "10,00"], ["7", "NO ES LINEA", "5", "", "", "", "50,00"]] }));
  assert.equal(r.lineas.length, 1);
});
ok("PDF sin tabla reconocible (o foto escaneada sin texto) → no se inventa nada", () => {
  assert.equal(interpretarGenerico([{ items: [it("Hola", 10, 10)] }]), null);
  assert.equal(interpretarGenerico([{ items: [] }]), null);
  assert.equal(interpretarMonteagudo([{ items: [it("BEBIDAS DEL SUR", 10, 10)] }]), null, "el de Monteagudo solo lee lo suyo");
});
ok("cajas a unidades: 10,583 cajas de 12 = 127 botellas; 1,5 cajas de 24 = 36", () => {
  assert.equal(unidadesLinea(10.583, { porCaja: 12 }).unidades, 127); assert.equal(unidadesLinea(1.5, { porCaja: 24 }).unidades, 36);
  assert.equal(unidadesLinea(-2, { porCaja: 1 }).unidades, -2);
});
console.log(`\n${n} pruebas del lector de facturas correctas`);

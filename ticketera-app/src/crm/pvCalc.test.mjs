import assert from "node:assert/strict";
import { leerRangos, textoRangos, resumenLote, solapan } from "./pvCalc.js";
let n = 0; const ok = (name, f) => { f(); n++; console.log("✓", name); };
const base = { desde: 101, hasta: 200, precio: 15, comision_tipo: "fija", comision_valor: 1.5 };
ok("rangos: lee, ordena y une", () => assert.deepEqual(leerRangos("190-200, 181-189 230", 101, 300).rangos, [[181, 200], [230, 230]]));
ok("rangos: fuera de la entrega avisa", () => assert.ok(leerRangos("90-95", 101, 200).error));
ok("rangos: texto raro avisa", () => assert.ok(leerRangos("abc", 1, 9).error));
ok("texto de rangos", () => assert.equal(textoRangos([[181, 200], [230, 230]]), "181-200, 230"));
ok("sin liquidar: todo entregado, nada vendido", () => { const r = resumenLote(base); assert.equal(r.entregadas, 100); assert.equal(r.vendidas, 0); });
ok("por cantidad: 80 vendidas × 15 € con 1,50 € de comisión", () => {
  const r = resumenLote({ ...base, vendidas_modo: "cantidad", vendidas: 80 });
  assert.equal(r.total, 1200); assert.equal(r.comision, 120); assert.equal(r.aEntregar, 1080); assert.equal(r.devueltas, 20);
});
ok("por devueltas: devuelve 181-200 → 80 vendidas", () => assert.equal(resumenLote({ ...base, vendidas_modo: "devueltas", devueltas: [[181, 200]] }).vendidas, 80));
ok("comisión en %: 10 % de 1.200 €", () => assert.equal(resumenLote({ ...base, comision_tipo: "pct", comision_valor: 10, vendidas_modo: "cantidad", vendidas: 80 }).comision, 120));
ok("no puede vender más de las entregadas", () => assert.equal(resumenLote({ ...base, vendidas_modo: "cantidad", vendidas: 500 }).vendidas, 100));
ok("pendiente tras un pago parcial", () => assert.equal(resumenLote({ ...base, vendidas_modo: "cantidad", vendidas: 80, pagado: 1000 }).pendiente, 80));
ok("solapes", () => { assert.ok(solapan({ desde: 1, hasta: 100 }, { desde: 100, hasta: 150 })); assert.ok(!solapan({ desde: 1, hasta: 100 }, { desde: 101, hasta: 150 })); });
console.log(`\n${n} pruebas OK`);

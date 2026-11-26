import assert from "node:assert/strict";
import { baseDe, cobradoDe, lineasDeCanales, resumenCsv } from "./facturarEntradasCalc.js";
let n = 0; const ok = (name, f) => { f(); n++; console.log("✓", name); };
const canales = [
  { t: "TIXFAST online", importe: 1210, pendiente: 0, uds: 100, udsSabidas: true },
  { t: "Otra ticketera", importe: 500, pendiente: 100, uds: 40, udsSabidas: true },
  { t: "Venta en mano", importe: 80, pendiente: 80, uds: 4, udsSabidas: true },
];
ok("base con IVA incluido: 1.210 € al 21 % = 1.000 €", () => assert.equal(baseDe(1210, 21), 1000));
ok("sin IVA la base es el importe", () => assert.equal(baseDe(50, 0), 50));
ok("solo cuenta lo cobrado", () => assert.equal(cobradoDe(canales[1]), 400));
ok("un canal todo pendiente no genera línea", () => assert.equal(lineasDeCanales(canales, 21, "Fiesta").length, 2));
ok("la línea lleva base, IVA y texto con unidades", () => {
  const l = lineasDeCanales(canales, 21, "Fiesta", () => "x")[0];
  assert.equal(l.precio, 1000); assert.equal(l.iva, 21); assert.equal(l.cantidad, 1);
  assert.match(l.concepto, /100 entradas/);
});
ok("CSV con separador ; coma decimal y total", () => {
  const c = resumenCsv(canales, 21, "Fiesta");
  assert.ok(c.includes("1210,00")); assert.ok(c.includes('"TOTAL"')); assert.ok(c.startsWith("﻿"));
});
console.log(`\n${n} pruebas OK`);

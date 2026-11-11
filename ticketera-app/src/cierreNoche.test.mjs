import assert from "node:assert/strict";
import { resumenNoche, categoriaDe, CATS_GASTO } from "./cierreNocheCalc.js";
import { deudasEvento, porSocio, claveSenal } from "./dineroSocios.js";
let n = 0; const ok = (name, f) => { f(); n++; console.log("✓", name); };

const ev = { puntos: [{ id: "b1", name: "Barra 1" }, { id: "b2", name: "Barra 2" }] };
const V = (id, puntoId, name, price, pago, extra = {}) => ({ id, clientUuid: "c-" + id, puntoId, name, price, pago, ts: 1, voided: false, ...extra });
const sales = [
  V("1", "b1", "Copa", 10, "efectivo"), V("2", "b1", "Copa", 10, "tarjeta"), V("3", "b2", "Chupito", 3, "efectivo"),
  V("4", "b2", "Copa", 10, "efectivo", { voided: true }),
  V("5", "b1", "Copa", 0, "invitacion:10", { invite: true, inviteValue: 10 }),
  V("6", "b2", "Botella", 150, "efectivo", { operario: "SOCIO:Pepe" }),
  V("7", "b2", "Botella", 150, "tarjeta", { operario: "SOCIO:Pepe" }),
];
const gastos = [
  { id: "g1", tipo: "gasto", puntoId: "b1", importe: 40, concepto: "Hielo", ts: 2 },
  { id: "g2", tipo: "gasto", puntoId: "b1", importe: 100, categoria: "artistas", concepto: "DJ resident", ts: 3 },
  { id: "g3", tipo: "gasto", puntoId: "b2", importe: 200, concepto: "Retirada de efectivo", ts: 4 },
  { id: "g4", tipo: "gasto", puntoId: "b2", importe: 15, concepto: "algo raro", ts: 5 },
  { id: "g5", tipo: "gasto", puntoId: "b2", importe: 999, concepto: "Proveedor", ts: 6, voided: true },
  { id: "g6", tipo: "entrada", puntoId: "b1", importe: 50, concepto: "Monedas", ts: 7 },
];
const reservados = [
  { id: "11111111-1111-1111-1111-111111111111", nombre: "R1", cliente: "Ana", estado: "reservado", senal: 50, senalSocio: "Pepe" },
  { id: "22222222-2222-2222-2222-222222222222", nombre: "R2", estado: "llegado", senal: 30, senalSocio: "" },
  { id: "33333333-3333-3333-3333-333333333333", nombre: "R3", estado: "libre", senal: 80, senalSocio: "Luis" },   // libre: no cuenta
  { id: "44444444-4444-4444-4444-444444444444", nombre: "R4", estado: "llegado", senal: 20, senalSocio: "Luis" },
];

ok("categoría elegida o deducida del concepto", () => {
  assert.equal(categoriaDe({ categoria: "hielo" }).t, "Hielo");
  assert.equal(categoriaDe({ concepto: "Pago al DJ" }).k, "artistas");
  assert.equal(categoriaDe({ concepto: "Compra en el súper" }).k, "compras");
  assert.equal(categoriaDe({ concepto: "" }).k, "otros");
  assert.equal(categoriaDe({ categoria: "inventada", concepto: "hielo" }).k, "hielo");
  assert.ok(CATS_GASTO.find(c => c.k === "retirada").noGasto);
});

const R = resumenNoche({ ev, sales, gastos, reservados });
ok("ingresos: sin anuladas ni invitaciones, por método y por barra", () => {
  assert.equal(R.ingresos.total, 323); assert.equal(R.ingresos.tickets, 5);
  assert.equal(R.ingresos.efectivo, 163); assert.equal(R.ingresos.tarjeta, 160); assert.equal(R.ingresos.sinMetodo, 0);
  assert.deepEqual(R.ingresos.porBarra.map(b => [b.nombre, b.total]), [["Barra 2", 303], ["Barra 1", 20]]);
  assert.deepEqual(R.ingresos.porProducto[0], { nombre: "Botella", uds: 2, total: 300 });
  assert.deepEqual(R.ingresos.invitaciones, { n: 1, valor: 10 });
  assert.deepEqual(R.ingresos.anuladas, { n: 1, valor: 10 });
});
ok("gastos clasificados; la retirada no cuenta como gasto; anulados fuera", () => {
  assert.equal(R.gastos.total, 155); assert.equal(R.gastos.n, 3); assert.equal(R.gastos.retiradas, 200);
  assert.deepEqual(R.gastos.porCategoria.map(c => [c.k, c.total]), [["artistas", 100], ["hielo", 40], ["otros", 15], ["retirada", 200]]);
  assert.equal(R.gastos.cambio, 50);
});
ok("resultado y efectivo en cajones", () => {
  assert.equal(R.resultado, 168);                 // 323 − 155
  assert.equal(R.efectivoNeto, -292);             // 163 − 150 (socio) − 155 − 200 + 50
});
ok("señales: solo reservados no libres", () => { assert.deepEqual(R.senales, { total: 100, n: 3, deSocios: 70 }); });
ok("socios: señal + venta en efectivo sin ticket (la de tarjeta no)", () => {
  assert.deepEqual(R.socios.map(s => [s.socio, s.total, s.pendiente]), [["Pepe", 200, 200], ["Luis", 20, 20]]);
  assert.equal(R.sociosPendiente, 220);
});
ok("devolución confirmada: la deuda desaparece (y parcial si cambió el importe)", () => {
  const d1 = deudasEvento({ reservados, sales, devoluciones: [{ clave: claveSenal(reservados[0].id), importe: 50, devueltoEn: "x" }] });
  const pepe = porSocio(d1).find(s => s.socio === "Pepe");
  assert.equal(pepe.pendiente, 150); assert.equal(pepe.devuelto, 50);
  const d2 = deudasEvento({ reservados: [{ ...reservados[0], senal: 80 }], sales: [], devoluciones: [{ clave: claveSenal(reservados[0].id), importe: 50 }] });
  assert.equal(d2[0].pendiente, 30);
});
ok("socio con mayúsculas distintas cuenta como el mismo", () => {
  const g = porSocio(deudasEvento({ reservados: [{ ...reservados[0] }, { ...reservados[3], senalSocio: "pepe " }], sales: [] }));
  assert.equal(g.length, 1); assert.equal(g[0].total, 70);
});
ok("sin datos no falla", () => { const z = resumenNoche({ ev: {}, sales: [], gastos: [] }); assert.equal(z.resultado, 0); assert.deepEqual(z.socios, []); });
console.log(`\n${n} pruebas del cierre de la noche correctas`);

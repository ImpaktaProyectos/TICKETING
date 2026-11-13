import assert from "node:assert/strict";
import { aplicarCaja, previstosParaCaja, pagosDeCaja, categoriaTPV } from "./gastosPrevistos.js";
let n = 0; const ok = (name, f) => { f(); n++; console.log("✓", name); };
const E = "ev1";
const crm = [
  { id: "javi", tipo: "normal", categoria: "Personal", concepto: "Camarero", proveedor: "Javi", previsto: 60, real: null, estado: "confirmado", pagadoPor: "socio1" },
  { id: "foto", tipo: "normal", categoria: "Marketing", concepto: "Fotógrafo", proveedor: "", previsto: 200, real: null, estado: "previsto" },
  { id: "dj", tipo: "artista", categoria: "Artistas", concepto: "DJ Kabasaki", previsto: 500, estado: "pagado", real: 500 },
  { id: "dj-tr", padreId: "dj", tipo: "normal", categoria: "Artistas", concepto: "Transporte", previsto: 40, estado: "previsto" },
  { id: "art", tipo: "artista", categoria: "Artistas", concepto: "Grupo", previsto: null, real: null, estado: "previsto" },
  { id: "art-h", padreId: "art", tipo: "normal", categoria: "Artistas", concepto: "Alojamiento", previsto: 90, estado: "previsto" },
];
const caja = [
  { id: "c1", eventId: E, tipo: "gasto", importe: 80, crmGastoId: "javi", ts: 1 },
  { id: "c2", eventId: E, tipo: "gasto", importe: 50, ts: 2 },                                  // gasto suelto
  { id: "c3", eventId: E, tipo: "gasto", importe: 999, crmGastoId: "foto", ts: 3, voided: true },  // anulado: no cuenta
  { id: "c4", eventId: "otro", tipo: "gasto", importe: 10, crmGastoId: "foto", ts: 4 },          // de otro evento: no cuenta
];
ok("pagos de caja por gasto del CRM (sin anulados ni de otros eventos)", () => {
  const m = pagosDeCaja(caja, E); assert.equal(m.size, 1); assert.equal(m.get("javi").total, 80);
});
ok("Javi: previsto 60, pagado 80 desde caja → pagado, real 80, sin socio", () => {
  const g = aplicarCaja(crm, caja, E).find(x => x.id === "javi");
  assert.equal(g.real, 80); assert.equal(g.estado, "pagado"); assert.equal(g.pagadoPor, null); assert.equal(g.cajaPagado, 80); assert.equal(g.previsto, 60);
});
ok("si se anula el pago, el gasto del CRM queda como estaba", () => {
  const g = aplicarCaja(crm, caja.map(x => x.id === "c1" ? { ...x, voided: true } : x), E).find(x => x.id === "javi");
  assert.equal(g.real, null); assert.equal(g.estado, "confirmado"); assert.equal(g.pagadoPor, "socio1");
});
ok("dos pagos al mismo gasto se suman", () => {
  const g = aplicarCaja(crm, [...caja, { id: "c5", eventId: E, tipo: "gasto", importe: 20, crmGastoId: "javi", ts: 5 }], E).find(x => x.id === "javi");
  assert.equal(g.real, 100);
});
ok("lista de la caja: pendientes primero, tachados los pagados, la cabecera vacía de un artista no sale", () => {
  const L = previstosParaCaja(crm, caja, E);
  assert.deepEqual(L.map(x => [x.id, x.estado]), [["dj-tr", "pendiente"], ["foto", "pendiente"], ["art-h", "pendiente"], ["dj", "pagado_crm"], ["javi", "pagado_caja"]]);
  const javi = L.find(x => x.id === "javi"); assert.equal(javi.pagado, 80); assert.equal(javi.diferencia, 20); assert.equal(javi.nombre, "Javi");
  assert.equal(L.find(x => x.id === "foto").nombre, "Fotógrafo");
  assert.equal(L.find(x => x.id === "art-h").nombre, "Grupo · Alojamiento");
});
ok("categoría para el cierre de la noche", () => {
  assert.equal(categoriaTPV(crm[0]), "personal"); assert.equal(categoriaTPV(crm[2]), "artistas");
  assert.equal(categoriaTPV({ categoria: "Servicios", concepto: "Porteros" }), "seguridad");
  assert.equal(categoriaTPV({ categoria: "Barra y producto", concepto: "Hielo" }), "hielo");
  assert.equal(categoriaTPV({ categoria: "Marketing", concepto: "Fotógrafo" }), "otros");
});
console.log(`\n${n} pruebas de gastos previstos correctas`);

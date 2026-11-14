import assert from "node:assert/strict";
import { eventoPorDefecto, estadoFecha, ordenarEventos, copiaDeEvento } from "./eventos.js";
let n = 0; const ok = (name, f) => { f(); n++; console.log("✓", name); };
const E = (id, date, extra = {}) => ({ id, name: id, date, puntos: [], ...extra });
const hall = E("halloween", "2026-10-31"), aula = E("aula69", "2026-11-12", { startsAt: "2026-11-12T23:00", endsAt: "2026-11-13T06:00:00" }), nav = E("navidad", "2026-12-20"), dic = E("caserio", "2026-12-12");
const todos = [hall, aula, dic, nav];
ok("por defecto, el próximo por fecha (no el primero de la lista)", () => {
  assert.equal(eventoPorDefecto(todos, new Date("2026-11-14T12:00")).id, "caserio");
});
ok("de madrugada sigue en el evento en curso", () => {
  assert.equal(eventoPorDefecto(todos, new Date("2026-11-13T03:30")).id, "aula69");
  assert.equal(eventoPorDefecto(todos, new Date("2026-11-12T20:00")).id, "aula69");
});
ok("sin fecha de fin, se da por terminado a las 8:00 del día siguiente", () => {
  assert.equal(eventoPorDefecto([hall, nav], new Date("2026-11-01T07:00")).id, "halloween");
  assert.equal(eventoPorDefecto([hall, nav], new Date("2026-11-01T09:00")).id, "navidad");
});
ok("si todos pasaron, el más reciente", () => { assert.equal(eventoPorDefecto([hall, aula], new Date("2027-01-10")).id, "aula69"); });
ok("etiquetas: hoy, en curso, mañana, en N días, ayer, pasado", () => {
  assert.equal(estadoFecha(aula, new Date("2026-11-12T10:00")).t, "HOY");
  assert.equal(estadoFecha(aula, new Date("2026-11-13T02:00")).t, "EN CURSO");
  assert.equal(estadoFecha(dic, new Date("2026-12-11T12:00")).t, "MAÑANA");
  assert.equal(estadoFecha(nav, new Date("2026-12-14T12:00")).t, "EN 6 DÍAS");
  assert.equal(estadoFecha(aula, new Date("2026-11-13T12:00")).t, "AYER");
  assert.equal(estadoFecha(hall, new Date("2026-11-14T12:00")).t, "PASADO");
});
ok("orden: próximos primero (el más cercano arriba) y luego pasados (el más reciente arriba)", () => {
  assert.deepEqual(ordenarEventos(todos, new Date("2026-11-14T12:00")).map(e => e.id), ["caserio", "navidad", "aula69", "halloween"]);
});
ok("copia: barras, productos, combos con ids nuevos; reservados sin perder tarifas; nada de ventas", () => {
  let i = 0; const uid = () => "n" + (++i);
  const src = { id: "src", name: "AULA 69", date: "2026-11-12", closed: true, qrClave: "abc", style: { comisiones: { p1: [{ proveedor: "Bodega", pct: 10, desde: 5 }] }, reservados: { puntos: ["b1"], tarifas: [{ id: "t", nombre: "Pack" }], socios: [{ nombre: "ROBBY" }] } },
    puntos: [{ id: "b1", name: "TICKETS", fondo: 280, fondoPrevisto: 300, products: [{ id: "p1", name: "COPA", price: 7, soldOut: true }, { id: "p2", name: "CHUPITO", price: 2 }], combos: [{ id: "c", name: "BONO", items: [{ productId: "p1", qty: 4 }], price: 24 }] },
      { id: "b2", name: "VIEJA", archivado: true, products: [{ id: "p3", name: "X", price: 1 }] }] };
  const c = copiaDeEvento(src, { name: "NAVIDAD", date: "2026-12-20", startsAt: "2026-12-20T23:00" }, uid);
  assert.equal(c.name, "NAVIDAD"); assert.equal(c.closed, false); assert.equal(c.qrClave, ""); assert.notEqual(c.id, "src");
  assert.equal(c.puntos.length, 1); assert.equal(c.puntos[0].fondo, null); assert.equal(c.puntos[0].fondoPrevisto, 300); assert.equal(c.puntos[0].estado, "prueba");
  const [copa] = c.puntos[0].products; assert.notEqual(copa.id, "p1"); assert.equal(copa.price, 7); assert.equal(copa.soldOut, false);
  assert.equal(c.puntos[0].combos[0].items[0].productId, copa.id);
  assert.deepEqual(Object.keys(c.style.comisiones), [copa.id]); assert.equal(c.style.comisiones[copa.id][0].desde, 0);
  assert.deepEqual(c.style.reservados.puntos, [c.puntos[0].id]); assert.equal(c.style.reservados.tarifas[0].nombre, "Pack");
  assert.equal(src.puntos[0].products[0].id, "p1");   // el original no se toca
  const sinRes = copiaDeEvento(src, { name: "X", date: "2026-12-20" }, uid, { barras: false, reservados: false });
  assert.equal(sinRes.puntos.length, 1); assert.equal(sinRes.puntos[0].name, "Barra"); assert.equal(sinRes.style.reservados, undefined);
});
console.log(`\n${n} pruebas de eventos correctas`);

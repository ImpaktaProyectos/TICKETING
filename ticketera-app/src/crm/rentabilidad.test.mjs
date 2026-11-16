import assert from "node:assert/strict";
import * as R from "./rentabilidad.js";
let n = 0; const ok = (name, f) => { f(); n++; console.log("✓", name); };

const ron = { id: "ron", nombre: "Ron", familia: "destilado", ml: 700, coste: 12 };
const cola = { id: "cola", nombre: "Cola", familia: "refresco", ml: 2000, coste: 1.5 };
const cerv = { id: "cer", nombre: "Cerveza", familia: "cerveza", coste: 0.62 };
const articulos = [ron, cola, cerv];
const recetas = [
  { producto: "COPA RON", items: [{ familia: "destilado", cantidad: 50, articuloId: "ron" }, { familia: "refresco", cantidad: 200, articuloId: "cola" }] },
  { producto: "CERVEZA", items: [{ familia: "cerveza", cantidad: 1, articuloId: "cer" }] },
  { producto: "GUARDARROPA", items: [] },
];
const P = (id, name, price, color = "#a855f7") => ({ id, name, price, color });
const ev = { id: "e1", puntos: [{ id: "b1", products: [P("p1", "Copa ron", 9), P("p2", "Cerveza", 4), P("p3", "Agua", 2.5), P("p4", "Chupito", 3)],
  combos: [{ name: "BONO 2 COPAS", items: [{ productId: "p1", qty: 2 }] }] }] };
const ev2 = { id: "e2", puntos: [{ id: "b9", products: [P("q1", "Copa ron", 10)], combos: [] }] };
const V = (eventId, puntoId, productId, name, price, extra = {}) => ({ eventId, puntoId, productId, name, price, voided: false, ...extra });
const sales = [
  V("e1", "b1", "p1", "COPA RON", 9), V("e1", "b1", "p1", "COPA RON", 9, { pago: "tarjeta" }),
  V("e1", "b1", "p1", "COPA RON", 0, { invite: true }), V("e1", "b1", "p1", "COPA RON", 9, { voided: true }),
  V("e1", "b1", "p2", "CERVEZA", 4), V("e1", "b1", null, "BONO 2 COPAS", 16),
  V("e2", "b9", "q1", "COPA RON", 10),
];

ok("ventas: anuladas fuera, invitaciones aparte, bono repartido en sus productos", () => {
  const v = R.ventasPorProducto([ev], sales);
  const c = v.find(x => x.nombre === "COPA RON");
  assert.equal(c.uds, 4); assert.equal(c.inv, 1); assert.equal(c.ingresos, 34); assert.equal(c.tarjeta, 9);
  assert.ok(v.find(x => x.nombre === "AGUA"), "los productos de la carta salen aunque no se vendan");
});

ok("varios eventos suman por nombre de producto; filtro de barra", () => {
  const v = R.ventasPorProducto([ev, ev2], sales);
  assert.equal(v.find(x => x.nombre === "COPA RON").uds, 5);
  assert.equal(R.ventasPorProducto([ev, ev2], sales, { puntoId: "b9" }).find(x => x.nombre === "COPA RON").uds, 1);
  assert.equal(R.ventasPorProducto([ev, ev2], sales, { eventIds: new Set(["e2"]) }).length, 1);
});

ok("coste de la copa de ron: 50 ml de 12 €/700 ml + 200 ml de 1,50 €/2 L = 1,0071 €", () => {
  const r = R.calcularRentabilidad({ events: [ev], sales, articulos, recetas, ajustes: {} });
  const c = r.filas.find(f => f.nombre === "COPA RON");
  assert.equal(c.origen, "receta"); assert.equal(c.coste, 1.0071);
});

ok("vaso + hielo solo en productos con destilado", () => {
  const r = R.calcularRentabilidad({ events: [ev], sales, articulos, recetas, ajustes: { rentabilidad: { extraCopa: 0.12 } } });
  assert.equal(r.filas.find(f => f.nombre === "COPA RON").coste, 1.1271);
  assert.equal(r.filas.find(f => f.nombre === "CERVEZA").coste, 0.62);
});

ok("beneficio: sin IVA, menos datáfono, menos coste de vendidas e invitaciones", () => {
  const r = R.calcularRentabilidad({ events: [ev], sales, articulos, recetas, ajustes: { iva: { ventas: { barra: 10 } }, comisiones: { tarjeta: 1 } } });
  const c = r.filas.find(f => f.nombre === "COPA RON");
  // 34 / 1,1 = 30,909 ; datáfono 9 × 1 % = 0,09 ; coste 1,0071 × 4 = 4,0284 ; invitación 1,0071
  assert.equal(c.sinIva, 30.91); assert.equal(c.datafono, 0.09); assert.equal(c.beneficio, 25.78);
  assert.equal(c.benUd, 6.7);    // (30,909 − 0,09) / 4 − 1,0071 = 6,6977
});

ok("coste a mano manda sobre la receta", () => {
  const r = R.calcularRentabilidad({ events: [ev], sales, articulos, recetas, ajustes: { rentabilidad: { costes: { "COPA RON": 2 } } } });
  const c = r.filas.find(f => f.nombre === "COPA RON");
  assert.equal(c.origen, "manual"); assert.equal(c.coste, 2);
});

ok("sin receta ni coste: sale como «sin coste» y no suma al beneficio", () => {
  const ev3 = { id: "e3", puntos: [{ id: "b", products: [P("x", "Merch", 20)], combos: [] }] };
  const r = R.calcularRentabilidad({ events: [ev3], sales: [V("e3", "b", "x", "MERCH", 20)], articulos, recetas, ajustes: {} });
  assert.equal(r.T.sinCoste.length, 1); assert.equal(r.T.beneficio, 0); assert.equal(r.T.ventasSinCoste, 18.18);
});

ok("receta sugerida: cuenta como estimado con el coste medio de la familia", () => {
  const ev3 = { id: "e3", puntos: [{ id: "b", products: [P("x", "Chupito", 3)], combos: [] }] };
  const sugerir = (k) => /CHUPITO/.test(k) ? [{ familia: "destilado", cantidad: 30 }] : null;
  const r = R.calcularRentabilidad({ events: [ev3], sales: [V("e3", "b", "x", "CHUPITO", 3)], articulos, recetas: [], ajustes: {}, sugerir });
  const c = r.filas[0];
  assert.equal(c.origen, "estimado"); assert.equal(c.coste, 0.5143); assert.equal(r.T.estimados.length, 1);
});

ok("artículo sin precio en el catálogo → falta coste", () => {
  const r = R.calcularRentabilidad({ events: [ev], sales, articulos: [{ ...ron, coste: null }], recetas, ajustes: {} });
  assert.equal(r.filas.find(f => f.nombre === "COPA RON").coste, null);
});

ok("clasificación: estrella, se vende pero deja poco, rentable pero poco, revisar", () => {
  const f = (nombre, uds, benUd) => ({ nombre, uds, benUd, coste: 1 });
  const c = R.clasificar([f("A", 100, 8), f("B", 100, 2), f("C", 5, 9), f("D", 5, 1)]);
  assert.deepEqual(c.map(x => x.tipo), ["estrella", "caballo", "enigma", "perro"]);
  assert.equal(R.clasificar([f("A", 1, 1), f("B", 1, 1)])[0].tipo, undefined, "con menos de 3 productos no se clasifica");
});

ok("simulador y precio mínimo para el margen objetivo", () => {
  assert.deepEqual(R.simular({ precio: 9, coste: 1.13, ivaBarra: 10 }), { sinIva: 8.18, benUd: 7.05, margen: 86 });
  assert.equal(R.precioMinimo({ coste: 1.13, objetivo: 80, ivaBarra: 10 }), 6.3);
});

ok("producto de proveedor: solo es tuyo su %, el resto se descuenta y no pones el coste", () => {
  const evP = { id: "ep", style: { comisiones: { m1: [{ desde: 0, proveedor: "FOODTRUCK", pct: 20 }] } },
    puntos: [{ id: "b", products: [P("m1", "Hamburguesa", 11)], combos: [] }] };
  const r = R.calcularRentabilidad({ events: [evP], sales: [V("ep", "b", "m1", "HAMBURGUESA", 11, { ts: 5 }), V("ep", "b", "m1", "HAMBURGUESA", 11, { ts: 6 })], articulos, recetas: [], ajustes: {} });
  const f = r.filas[0];
  // 22 € / 1,1 = 20 € sin IVA; 80 % para el proveedor = 16 €; sin coste propio → 4 € tuyos
  assert.equal(f.origen, "proveedor"); assert.equal(f.paraProveedor, 16); assert.equal(f.beneficio, 4); assert.equal(f.margen, 20);
  assert.equal(r.T.sinCoste.length, 0);
});

ok("la comisión de proveedor se aplica según la fecha de cada venta", () => {
  const evP = { id: "ep", style: { comisiones: { p1: [{ desde: 0, proveedor: "X", pct: 50 }, { desde: 100, proveedor: "", pct: null }] } },
    puntos: [{ id: "b", products: [P("p1", "Copa ron", 11)], combos: [] }] };
  const v = R.ventasPorProducto([evP], [V("ep", "b", "p1", "COPA RON", 11, { ts: 10 }), V("ep", "b", "p1", "COPA RON", 11, { ts: 200 })]);
  assert.equal(v[0].provUds, 1); assert.equal(v[0].paraProveedor, 5.5);
});

ok("se puede dejar fuera una barra (la taquilla de entradas)", () => {
  const evT = { id: "et", puntos: [{ id: "bar", name: "Barra", products: [P("c", "Cerveza", 4)], combos: [] }, { id: "taq", name: "Taquilla", products: [P("t", "Entrada", 15)], combos: [] }] };
  const ss = [V("et", "bar", "c", "CERVEZA", 4), V("et", "taq", "t", "ENTRADA", 15)];
  const v = R.ventasPorProducto([evT], ss, { incluirPunto: (p) => p.name !== "Taquilla" });
  assert.deepEqual(v.map(x => x.nombre), ["CERVEZA"]);
});

ok("los productos sin coste (guardarropa) no entran en la clasificación", () => {
  const f = (nombre, uds, benUd, coste = 1) => ({ nombre, uds, benUd, coste });
  const c = R.clasificar([f("A", 100, 8), f("B", 100, 2), f("C", 5, 9), f("G", 120, 2.7, 0)]);
  assert.equal(c.find(x => x.nombre === "G").tipo, undefined);
  assert.equal(c.find(x => x.nombre === "A").tipo, "estrella");
});

ok("margen por debajo del objetivo y productos pendientes (también los aún no vendidos)", () => {
  const r = R.calcularRentabilidad({ events: [ev], sales, articulos, recetas, ajustes: { rentabilidad: { objetivo: 85 } } });
  assert.ok(r.T.bajoObjetivo.some(f => f.nombre === "CERVEZA"));        // 3,01 € de 3,64 € → 83 %
  assert.ok(!r.T.bajoObjetivo.some(f => f.nombre === "COPA RON"));
  assert.ok(r.T.pendientes.some(f => f.nombre === "AGUA" && f.uds === 0), "agua está en la carta sin vender y sin coste");
});

ok("copa genérica con la mezcla: 75 % ron + 25 % gin", () => {
  const gin = { id: "gin", nombre: "Gin", familia: "destilado", ml: 700, coste: 19 };
  const ev3 = { id: "e3", puntos: [{ id: "b", products: [P("x", "Copa", 9)], combos: [] }] };
  const rec = [{ producto: "COPA", items: [{ familia: "destilado", cantidad: 50 }] }];
  const sin = R.calcularRentabilidad({ events: [ev3], sales: [V("e3", "b", "x", "COPA", 9)], articulos: [ron, gin], recetas: rec, ajustes: {} }).filas[0];
  const con = R.calcularRentabilidad({ events: [ev3], sales: [V("e3", "b", "x", "COPA", 9)], articulos: [ron, gin], recetas: rec, ajustes: {}, mezcla: { ron: 75, gin: 25 } }).filas[0];
  assert.equal(sin.coste, 1.1071);   // media simple (12 y 19 €)
  assert.equal(con.coste, 0.9821);   // 50 ml × (0,75 × 12/700 + 0,25 × 19/700)
  assert.equal(con.lineas[0].origen, "mezcla");
});

console.log(`\n${n} pruebas de rentabilidad correctas`);

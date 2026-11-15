// Pruebas de las reglas de Multipuesto: node src/multipuesto/multipuesto.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { esMultipuesto, claveConsumicion, comision, comisionDe, consumicionesDelEvento, vendidasPorConsumicion, validarPuesto, liquidacionPorPuesto, csv, textoComision } from "./modelo.js";

let n = 0; const t = (nombre, f) => { f(); n++; console.log("✓ " + nombre); };
const EV = { style: { modalidad: "multipuesto" }, puntos: [
  { id: "c1", name: "Caja 1", products: [{ id: "h1", name: "Hamburguesa", price: 10 }, { id: "p1", name: "Pizza", price: 8 }], combos: [{ name: "Menú", items: [{ productId: "h1", qty: 1 }, { productId: "b1", qty: 2 }] }] },
  { id: "c2", name: "Caja 2", products: [{ id: "h2", name: " hamburguesa ", price: 11 }, { id: "b1", name: "Bebida", price: 3 }] },
  { id: "c3", name: "Vieja", archivado: true, products: [{ id: "x", name: "Perrito", price: 5 }] },
] };

t("modalidad: solo Multipuesto si lo dice el evento", () => {
  assert.equal(esMultipuesto(EV), true);
  assert.equal(esMultipuesto({ style: {} }), false);
  assert.equal(esMultipuesto(null), false);
});
t("la misma consumición aunque cambien mayúsculas y espacios", () => {
  assert.equal(claveConsumicion("  Hamburguesa   Doble "), "hamburguesa doble");
  assert.equal(claveConsumicion("CAÑA"), "caña");
});
t("comisión en % y en euros fijos (nunca más que el valor)", () => {
  assert.equal(comision(10, "pct", 30), 3);
  assert.equal(comision(8.5, "pct", 15), 1.28);    // redondeo a céntimos
  assert.equal(comision(10, "fijo", 3), 3);
  assert.equal(comision(2, "fijo", 3), 2);
  assert.equal(comision(null, "pct", 30), 0);
});
t("comisión propia del producto o la general del puesto", () => {
  const p = { comision_tipo: "pct", comision_valor: 20, productos: [{ consumicion: "pizza", comision_tipo: "fijo", comision_valor: 3 }, { consumicion: "hamburguesa" }] };
  assert.deepEqual(comisionDe(p, "pizza"), { tipo: "fijo", valor: 3 });
  assert.deepEqual(comisionDe(p, "hamburguesa"), { tipo: "pct", valor: 20 });
  assert.equal(textoComision({ tipo: "pct", valor: 20 }), "20 %");
});
t("consumiciones del evento: agrupadas por nombre y sin cajas archivadas", () => {
  const c = consumicionesDelEvento(EV);
  assert.deepEqual(c.map(x => x.clave), ["bebida", "hamburguesa", "pizza"]);
  const h = c.find(x => x.clave === "hamburguesa");
  assert.deepEqual(h.cajas, ["Caja 1", "Caja 2"]);
  assert.equal(h.precio, 10); assert.equal(h.precioMax, 11);
});
t("vendidas por consumición: tickets sueltos y vales de bonos, sin anuladas", () => {
  const v = vendidasPorConsumicion(EV, [
    { productId: "h1", puntoId: "c1" }, { productId: "h2", puntoId: "c2" }, { productId: "p1", puntoId: "c1", voided: true },
    { productId: null, name: "Menú", puntoId: "c1" },
  ]);
  assert.deepEqual(v, { hamburguesa: 3, bebida: 2 });
});
t("ficha del puesto: valida y deja lista para guardar", () => {
  const ok = validarPuesto({ nombre: " Burger House ", comision_tipo: "pct", comision_valor: "20,5", productos: [{ consumicion: "Hamburguesa" }, { consumicion: "Pizza", comision_tipo: "fijo", comision_valor: "3" }] });
  assert.deepEqual(ok.errores, []);
  assert.equal(ok.datos.nombre, "Burger House");
  assert.equal(ok.datos.comision_valor, 20.5);
  assert.deepEqual(ok.datos.productos, [{ consumicion: "hamburguesa" }, { consumicion: "pizza", comision_tipo: "fijo", comision_valor: 3 }]);
  assert.ok(validarPuesto({ nombre: "", comision_valor: 0, productos: [{ consumicion: "x" }] }).errores.length);
  assert.ok(validarPuesto({ nombre: "A", comision_tipo: "pct", comision_valor: 120, productos: [{ consumicion: "x" }] }).errores.length);
  assert.ok(validarPuesto({ nombre: "A", comision_valor: 10, productos: [] }).errores.some(e => /al menos un producto/.test(e)));
});
t("liquidación por puesto: suma unidades, valor, comisión y lo que se le paga", () => {
  const l = liquidacionPorPuesto([
    { puesto_id: "a", consumicion: "hamburguesa", unidades: 180, valor: 1800, comision: 540, neto: 1260 },
    { puesto_id: "a", consumicion: "bebida", unidades: 10, valor: 30, comision: 9, neto: 21 },
    { puesto_id: "b", consumicion: "hamburguesa", unidades: 120, valor: 1200, comision: 360, neto: 840 },
  ], [{ id: "a", nombre: "Burger House" }, { id: "b", nombre: "Smash" }, { id: "c", nombre: "Sin vender" }]);
  assert.deepEqual(l.map(x => [x.puesto.nombre, x.unidades, x.neto]), [["Burger House", 190, 1281], ["Smash", 120, 840], ["Sin vender", 0, 0]]);
});
t("CSV para Excel: «;», coma decimal y sin fórmulas", () => {
  const c = csv([["Puesto", "Total"], ["=HACK()", 12.5]]);
  assert.equal(c, "\ufeffPuesto;Total\r\n'=HACK();12,5");
});
t("la app y la base de datos normalizan y calculan igual", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20261118090000_ticket_multipuesto.sql", import.meta.url), "utf8");
  assert.match(sql, /lower\(regexp_replace\(btrim\(coalesce\(p_nombre, ''\)\), '\\s\+', ' ', 'g'\)\), 80\)/);
  assert.match(sql, /when p_tipo = 'fijo' then least\(coalesce\(p_cant, 0\), p_valor\)/);
  assert.match(sql, /round\(p_valor \* coalesce\(p_cant, 0\) \/ 100, 2\)/);
});
console.log(`\n${n} pruebas de Multipuesto correctas`);

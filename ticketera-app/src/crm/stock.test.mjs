import assert from "node:assert/strict";
import * as S from "./stockModelo.js";
let n = 0; const ok = (name, f) => { f(); n++; console.log("✓", name); };

// ---------- Formatos sacados de la descripción de la factura ----------
const A = (d) => S.articuloDesdeLinea(d, "1", "PROV");
ok("pack: 24X33CL es caja de 24 (no de 33)", () => { const a = A("COCA-COLA 24X33CL LATA"); assert.equal(a.porCaja, 24); assert.equal(a.ml, 330); assert.equal(a.unidad, "lata"); });
ok("pack: *24, C/24, CJ 24, PACK 24, X24", () => {
  assert.equal(A("SCHWEPPES TONICA 20CL *24").porCaja, 24); assert.equal(A("ESTRELLA 1/5 VR C/24").porCaja, 24);
  assert.equal(A("MAHOU 1/3 RET. CJ 24").porCaja, 24); assert.equal(A("AGUA 50CL PET PACK 24").porCaja, 24); assert.equal(A("RED BULL 25CL X24").porCaja, 24);
});
ok("medidas: 70 cl, 1 L, 1,5 L, 37,5 cl, 237 ml, tercio, quinto, 1/4, 1/2", () => {
  assert.equal(A("RON BARCELO 70CL").ml, 700); assert.equal(A("GINEBRA LARIOS 1L").ml, 1000); assert.equal(A("AQUARIUS 1,5L").ml, 1500);
  assert.equal(A("WHISKY 37,5CL").ml, 375); assert.equal(A("COCA COLA 237ML").ml, 237); assert.equal(A("ESTRELLA GALICIA 1/3").ml, 330);
  assert.equal(A("CERVEZA QUINTO").ml, 200); assert.equal(A("CERVEZA 1/5").ml, 200); assert.equal(A("CERVEZA 1/4").ml, 250); assert.equal(A("CERVEZA 1/2").ml, 500);
});
ok("destilados por botella salvo «6X70CL»", () => { assert.equal(A("RON NEGRITA 70CL").porCaja, 1); assert.equal(A("GINEBRA LARIOS 6X70CL").porCaja, 6); });
ok("retornable: RETORNABLE, RET., VR; nunca lata, PET ni «NO RETORNABLE»", () => {
  assert.ok(A("COCA COLA 237ML RETORNABLE").retornable); assert.ok(A("MAHOU 1/3 RET. CJ 24").retornable); assert.ok(A("ESTRELLA 1/5 VR C/24").retornable);
  assert.ok(!A("FANTA 2L PET RET").retornable); assert.ok(!A("AQUARIUS 1,5L NO RETORNABLE").retornable); assert.ok(!A("COCA COLA LATA 33CL").retornable);
});
ok("envase: cristal retornable, cristal, PET, lata, brik, barril", () => {
  assert.equal(S.materialDe(A("COCA COLA 237ML RETORNABLE")), "cristal retornable"); assert.equal(S.materialDe(A("RON BARCELO 70CL")), "cristal");
  assert.equal(S.materialDe(A("FANTA NARANJA 2L PET *6")), "plástico (PET)"); assert.equal(S.materialDe(A("COCA-COLA 24X33CL LATA")), "lata");
  assert.equal(S.materialDe(A("ZUMO PIÑA BRIK 1L")), "brik"); assert.equal(S.materialDe(A("CERVEZA BARRIL 30L")), "barril");
});
ok("familias por la descripción", () => {
  assert.equal(A("ENVASE COCA COLA").familia, "envase"); assert.equal(A("VASO TUBO").familia, "vaso"); assert.equal(A("JAGERMEISTER 70CL").familia, "destilado");
  assert.equal(A("AGUA FONTAREL 33CL").familia, "agua"); assert.equal(A("MONSTER 50CL").familia, "energetica"); assert.equal(A("HIELO 2KG").familia, "otros");
});

// ---------- Cuentas del pedido ----------
const ron = { id: "ron", nombre: "Ron", familia: "destilado", ml: 700, coste: 10, porCaja: 1 };
const gin = { id: "gin", nombre: "Gin", familia: "destilado", ml: 700, coste: 14, porCaja: 1 };
const cola = { id: "cola", nombre: "Cola 20cl ret", familia: "refresco", ml: 200, coste: 0.5, porCaja: 24, retornable: true };
const caja = { id: "env", nombre: "Envase cola", familia: "envase", coste: 4, porCaja: 1 };
const art = [ron, gin, cola, caja];
const M = (id, tipo, articuloId, cantidad, extra = {}) => ({ id, tipo, articuloId, cantidad, ...extra });

ok("cuentas: comprado − devuelto − almacén = coste del evento; la fianza de envases aparte", () => {
  const movs = [M("1", "entrada", "ron", 20, { costeUnidad: 10 }), M("2", "entrada", "cola", 240), M("3", "entrada", "env", 10)];
  const c = S.cuentasPedido({ articulos: art, movimientos: movs, plan: [{ articuloId: "ron", destino: "devolver", unidades: 5 }, { articuloId: "cola", destino: "almacen", unidades: 48 }], vacios: { env: 8 } });
  assert.equal(c.entro, 360);            // 200 + 120 + 40
  assert.equal(c.devolverAhora, 50); assert.equal(c.envasesAhora, 32); assert.equal(c.vuelve, 82);
  assert.equal(c.almacen, 24); assert.equal(c.coste, 254);
  assert.equal(c.fianzaPendiente, 8);   // 2 cajas sin devolver
  assert.equal(c.consumido, 246);
});
ok("cuentas: lo anulado no cuenta y lo ya devuelto suma al abono", () => {
  const movs = [M("1", "entrada", "ron", 10, { costeUnidad: 10 }), M("2", "entrada", "ron", 99), M("x", "anulacion", "ron", 0, { anulaId: "2" }), M("3", "devolucion", "ron", 2, { trasRecuento: true })];
  const c = S.cuentasPedido({ articulos: art, movimientos: movs });
  assert.equal(c.entro, 100); assert.equal(c.vuelve, 20); assert.equal(c.coste, 80);
});

// ---------- Mezcla de la copa ----------
const hist = [
  { eventoId: "a", recinto: "Sala Norte", sellado: true, movimientos: [M("1", "entrada", "ron", 10), M("2", "entrada", "gin", 10)], lineas: [{ articuloId: "ron", total: 2 }, { articuloId: "gin", total: 8 }] },
  { eventoId: "b", recinto: "Playa", sellado: true, movimientos: [M("3", "entrada", "gin", 10), M("4", "entrada", "ron", 10)], lineas: [{ articuloId: "gin", total: 0 }, { articuloId: "ron", total: 10 }] },
  { eventoId: "c", recinto: "Sala Norte", sellado: false, movimientos: [M("5", "entrada", "gin", 30)], lineas: [] },
];
ok("recomendación por consumo real del mismo recinto", () => {
  const r = S.recomendarMezcla({ historico: hist, articulos: art, recinto: "sala norte" });
  assert.equal(r.fuente, "recuentos"); assert.ok(r.delRecinto); assert.deepEqual(r.pct, { ron: 80, gin: 20 });
});
ok("sin recuentos del recinto, usa todos; sin recuentos, lo comprado", () => {
  assert.deepEqual(S.recomendarMezcla({ historico: hist, articulos: art, recinto: "Otro" }).pct, { ron: 40, gin: 60 });
  const r = S.recomendarMezcla({ historico: [hist[2]], articulos: art });
  assert.equal(r.fuente, "compras"); assert.deepEqual(r.pct, { gin: 100 });
});
ok("mezcla del evento manda sobre la general; se normaliza a 100 %", () => {
  const aj = { mezclas: { general: { ron: 1, gin: 1 }, eventos: { e1: { ron: 3, gin: 1 } } } };
  assert.deepEqual(S.mezclaDe(aj, "e1"), { pct: { ron: 75, gin: 25 }, de: "evento" });
  assert.deepEqual(S.mezclaDe(aj, "e2"), { pct: { ron: 50, gin: 50 }, de: "general" });
  assert.deepEqual(S.mezclaDe({}, "e1"), { pct: {}, de: null });
});
ok("coste por ml y botellas con la mezcla", () => {
  // 75 % ron (10 €/700 ml) + 25 % gin (14 €/700 ml) = 0,01571 €/ml → copa de 50 ml = 0,79 €
  assert.equal(Math.round(S.costeMlMezcla({ ron: 75, gin: 25 }, art) * 50 * 100) / 100, 0.79);
  const b = S.botellasPorMezcla(400 * 50, { ron: 75, gin: 25 }, art);   // 400 copas × 50 ml
  assert.deepEqual(b.map(x => [x.a.id, x.botellas]), [["ron", 21.4], ["gin", 7.1]]);
});

// ---------- ¿Cuadra? (cálculo del stock de un evento) ----------
ok("cuadra: entra 10 botellas, vende 100 copas de 50 ml, quedan 2,9 → falta ≈ 0,1 botella (dentro de lo normal)", () => {
  const ev = { id: "e", puntos: [{ id: "b", products: [{ id: "p", name: "COPA" }], combos: [] }] };
  const sales = Array.from({ length: 100 }, (_, i) => ({ eventId: "e", puntoId: "b", productId: "p", name: "COPA", price: 9, voided: false }));
  const R = S.calcularStock({ ev, sales, articulos: [ron], movimientos: [M("1", "entrada", "ron", 10)], recetas: [{ producto: "COPA", items: [{ familia: "destilado", cantidad: 50 }] }],
    conteo: { estado: "sellado" }, lineas: [{ articuloId: "ron", total: 2.9 }], cfg: S.STOCK_DEF });
  const f = R.familias.find(x => x.k === "destilado");
  assert.equal(f.tpv, 5000); assert.equal(f.real, 4970); assert.equal(f.estado, "cuadra");
});
ok("falta: quedan 1 botella → faltan 1,9 botellas sin justificar, valoradas a coste", () => {
  const ev = { id: "e", puntos: [{ id: "b", products: [{ id: "p", name: "COPA" }], combos: [] }] };
  const sales = Array.from({ length: 100 }, () => ({ eventId: "e", puntoId: "b", productId: "p", name: "COPA", price: 9, voided: false }));
  const R = S.calcularStock({ ev, sales, articulos: [ron], movimientos: [M("1", "entrada", "ron", 10, { costeUnidad: 10 })], recetas: [{ producto: "COPA", items: [{ familia: "destilado", cantidad: 50 }] }],
    conteo: { estado: "sellado" }, lineas: [{ articuloId: "ron", total: 1 }], cfg: S.STOCK_DEF });
  const f = R.familias.find(x => x.k === "destilado");
  assert.equal(f.estado, "falta"); assert.equal(f.dif, 1300); assert.equal(f.difCoste, 18.57);
});

console.log(`\n${n} pruebas de stock correctas`);

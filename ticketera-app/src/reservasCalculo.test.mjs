// Pruebas de la reserva online y del plano: node src/reservasCalculo.test.mjs
import assert from "node:assert/strict";
import { totalReserva, gastosGestion, importes, packsDeMesa, telefonoValido, emailValido } from "./reservasCalculo.js";
import { normalizar, crear, mover, redimensionar, girar, sinColocar, colocarReservados, plantilla, enlazar, ajustar, TIPOS } from "./plano/modelo.js";

let n = 0; const t = (nombre, f) => { f(); n++; console.log("✓ " + nombre); };
const PACK = { id: "t1", nombre: "Pack Cabina", precio: 250, botellas: 2, tamano: "grande" };

t("precio: pack + botellas extra (si hay precio de extra)", () => {
  assert.equal(totalReserva(PACK, 2, 90), 250);
  assert.equal(totalReserva(PACK, 4, 90), 430);
  assert.equal(totalReserva(PACK, 3, null), null);          // sin precio de extra no se puede
  assert.equal(totalReserva(null, 1, 90), null);
});
t("gastos de gestión: misma fórmula que las entradas", () => {
  // Valores reales de pago_gastos() en la base de datos: 125 → 7,63 · 65 → 4,12 · 1 → 0,10
  assert.equal(gastosGestion(125), 7.63);
  assert.equal(gastosGestion(65), 4.12);
  assert.equal(gastosGestion(1), 0.1);
  assert.equal(gastosGestion(0), 0);
  assert.ok(gastosGestion(1) <= 0.1);                       // nunca más del 10 %
});
t("adelanto, lo que se paga hoy y el resto", () => {
  const i = importes(PACK, 2, 90, 50);
  assert.deepEqual(i, { total: 250, adelanto: 125, gastos: 7.63, hoy: 132.63, resto: 125 });
  assert.equal(importes(PACK, 2, 90, 0).hoy, 0);
});
t("packs por tamaño de mesa", () => {
  const tarifas = [PACK, { id: "t2", precio: 130, botellas: 1, tamano: "pequeno" }, { id: "t3", precio: 90, botellas: 1, tamano: "" }];
  assert.deepEqual(packsDeMesa(tarifas, { tamano: "grande" }).map(x => x.id), ["t1", "t3"]);
  assert.deepEqual(packsDeMesa(tarifas, { tamano: "pequeno" }).map(x => x.id), ["t2", "t3"]);
});
t("datos del cliente", () => {
  assert.ok(telefonoValido("612 34 56 78")); assert.ok(!telefonoValido("6123"));
  assert.ok(emailValido("")); assert.ok(emailValido("ana@ejemplo.es")); assert.ok(!emailValido("ana@"));
});
t("plano: datos rotos se corrigen y nada se sale de la sala", () => {
  const p = normalizar({ ancho: 2, largo: "x", elementos: [{ tipo: "nave_espacial" }, { tipo: "mesa", x: 999, y: -50, w: 0, forma: "rara" }] });
  assert.equal(p.ancho, 4); assert.equal(p.largo, 14);
  assert.equal(p.elementos.length, 1);
  const m = p.elementos[0];
  assert.equal(m.forma, "redonda"); assert.ok(m.w >= 0.2); assert.ok(m.x <= p.ancho); assert.ok(m.y + m.h > 0);
});
t("plano: mover, ajustar a la cuadrícula, girar y cambiar tamaño", () => {
  const sala = { ancho: 20, largo: 14 };
  const e = crear("barra", 10, 7);
  assert.equal(e.w, TIPOS.barra.w);
  const m = mover(e, 3.13, 4.88, sala); assert.equal(m.x, 3.25); assert.equal(m.y, 5);
  assert.equal(ajustar(1.12), 1); assert.equal(girar({ rot: 350 }, 15).rot, 5);
  const r = redimensionar(e, 0.01, 2.6); assert.equal(r.w, 0.25); assert.equal(r.h, 2.5);
  assert.ok(mover(e, 500, 500, sala).x < sala.ancho);
});
t("plano: coloca solos los reservados que faltan, sin pisarse", () => {
  const res = [{ id: "a", nombre: "R1", tamano: "pequeno" }, { id: "b", nombre: "R2", tamano: "grande" }, { id: "c", nombre: "R3" }];
  const p = colocarReservados({ ancho: 20, largo: 14, elementos: [] }, res);
  assert.equal(p.elementos.length, 3);
  assert.equal(sinColocar(p, res).length, 0);
  const [a, b] = p.elementos; assert.ok(a.x + a.w <= b.x);   // en fila, sin solaparse
  assert.equal(p.elementos[1].forma, "sofa");                 // los grandes, como sofá
});
t("plano: plantillas válidas (sala, pueblo, festival)", () => {
  for (const k of ["sala", "pueblo", "festival"]) { const p = plantilla(k); assert.ok(p.elementos.length > 5, k); assert.deepEqual(normalizar(p), p); }
});
t("plano: al copiar un evento, las mesas se vuelven a enlazar por nombre", () => {
  const viejo = { ancho: 20, largo: 14, elementos: [{ id: "x", tipo: "mesa", x: 1, y: 1, w: 2, h: 2, reservadoId: "viejo1", ref: "R1" }, { id: "y", tipo: "mesa", x: 5, y: 1, w: 2, h: 2, reservadoId: "nada" }] };
  const p = enlazar(viejo, [{ id: "nuevo1", nombre: "R1" }]);
  assert.equal(p.elementos[0].reservadoId, "nuevo1");
  assert.equal(p.elementos[1].reservadoId, undefined);
});
console.log(`\n${n} pruebas de reservas online y plano correctas`);

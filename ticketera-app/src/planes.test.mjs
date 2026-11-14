// Pruebas de las reglas de planes: node src/planes.test.mjs
import assert from "node:assert/strict";
import { bloqueada, limiteDe, diasRestantes, eventosQueCuentan, eventoProtegido, puede, avisoNuevoEvento, avisoNuevaBarra } from "./planes.js";

const GRATIS = { plan_id: "gratis", plan_nombre: "Gratis", estado: "prueba", en_prueba: false, fin_acceso: "2026-11-10T10:00:00Z",
  limites: { eventos: 1, barras_por_evento: 2, bloquea: ["facturacion", "stock", "reservados", "entradas_online"] } };
const PRUEBA = { plan_id: "pro", plan_nombre: "Pro", estado: "prueba", en_prueba: true, fin_acceso: "2026-12-01T10:00:00Z", limites: {} };
const HOY = "2026-11-15";
let n = 0; const t = (nombre, f) => { f(); n++; console.log("✓ " + nombre); };

t("sin información de acceso no se bloquea nada", () => {
  assert.equal(bloqueada(null, "stock"), false);
  assert.equal(avisoNuevoEvento(null, [{ date: HOY }], HOY), null);
  assert.equal(avisoNuevaBarra(null, { puntos: [{}, {}, {}] }, HOY), null);
});
t("en prueba se puede todo", () => {
  assert.equal(puede(PRUEBA, "facturacion", null, HOY), true);
  assert.equal(diasRestantes(PRUEBA, Date.parse("2026-11-15T10:00:00Z")), 16);
});
t("plan gratis bloquea las funciones de pago y deja el resto", () => {
  assert.equal(bloqueada(GRATIS, "stock"), true);
  assert.equal(bloqueada(GRATIS, "ingresos"), false);
  assert.equal(limiteDe(GRATIS, "eventos"), 1);
  assert.equal(limiteDe(PRUEBA, "eventos"), null);
});
t("los eventos pasados y cerrados no cuentan para el límite", () => {
  const evs = [{ date: "2026-10-01" }, { date: "2026-11-20", closed: true }, { date: "2026-11-14" }];
  assert.equal(eventosQueCuentan(evs, HOY), 1);
  assert.match(avisoNuevoEvento(GRATIS, evs, HOY), /1 evento a la vez/);
  assert.equal(avisoNuevoEvento(GRATIS, [{ date: "2026-10-01" }], HOY), null);
});
t("un evento creado con acceso completo conserva todo hasta el día siguiente a su fecha", () => {
  const ev = { creadoEn: "2026-11-05T10:00:00Z", date: "2026-11-14", puntos: [{}, {}, {}] };
  assert.equal(eventoProtegido(GRATIS, ev, HOY), true);
  assert.equal(puede(GRATIS, "reservados", ev, HOY), true);
  assert.equal(avisoNuevaBarra(GRATIS, ev, HOY), null);
  assert.equal(eventoProtegido(GRATIS, ev, "2026-11-16"), false);                       // ya pasó
  assert.equal(eventoProtegido(GRATIS, { ...ev, creadoEn: "2026-11-12T10:00:00Z" }, HOY), false); // creado sin acceso
});
t("límite de barras en eventos nuevos del plan gratis", () => {
  const ev = { creadoEn: "2026-11-14T10:00:00Z", date: "2026-11-20", puntos: [{}, { archivado: true }] };
  assert.equal(avisoNuevaBarra(GRATIS, ev, HOY), null);
  assert.match(avisoNuevaBarra(GRATIS, { ...ev, puntos: [{}, {}] }, HOY), /2 barras/);
});
console.log(`\n${n} pruebas de planes correctas`);

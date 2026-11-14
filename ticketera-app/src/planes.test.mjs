// Pruebas de las reglas de la suscripción: node src/planes.test.mjs
import assert from "node:assert/strict";
import { bloqueada, diasRestantes, eventoProtegido, puede, sinSuscripcion, avisoNuevoEvento, avisoNuevaBarra, FUNCIONES } from "./planes.js";

const SIN = { plan_id: "sin_suscripcion", plan_nombre: "Sin suscripción", estado: "cancelada", en_prueba: false, fin_acceso: "2026-11-10T10:00:00Z",
  limites: { bloquea: ["tpv", "crm", "facturacion", "stock", "prevision", "reservados", "conexiones"] } };
const NUEVA = { ...SIN, estado: "pendiente", fin_acceso: null };
const PRUEBA = { plan_id: "pro", plan_nombre: "TIXFAST", estado: "prueba", en_prueba: true, fin_acceso: "2026-11-22T10:00:00Z", limites: {} };
const HOY = "2026-11-15";
let n = 0; const t = (nombre, f) => { f(); n++; console.log("✓ " + nombre); };

t("sin información de acceso no se bloquea nada", () => {
  assert.equal(bloqueada(null, "tpv"), false);
  assert.equal(sinSuscripcion(null), false);
});
t("en prueba (7 días) se puede todo", () => {
  assert.equal(puede(PRUEBA, "tpv", null, HOY), true);
  assert.equal(sinSuscripcion(PRUEBA), false);
  assert.equal(diasRestantes(PRUEBA, Date.parse("2026-11-15T10:00:00Z")), 7);
});
t("sin suscripción se bloquea todo menos la ticketera", () => {
  for (const f of ["tpv", "crm", "facturacion", "stock", "prevision", "reservados", "conexiones"]) assert.equal(bloqueada(SIN, f), true, f);
  assert.equal(bloqueada(SIN, "entradas_online"), false);
  assert.equal(bloqueada(SIN, "rrpp"), false);
  assert.equal(sinSuscripcion(NUEVA), true);
  assert.equal("entradas_online" in FUNCIONES, false);
});
t("no hay límites de eventos ni de barras", () => {
  assert.equal(avisoNuevoEvento(SIN, [{ date: HOY }, { date: HOY }], HOY), null);
  assert.equal(avisoNuevaBarra(SIN, { puntos: [{}, {}, {}, {}] }, HOY), null);
});
t("una noche nunca se corta: el evento creado con acceso sigue hasta el día siguiente a su fecha", () => {
  const ev = { creadoEn: "2026-11-05T10:00:00Z", date: "2026-11-14" };
  assert.equal(eventoProtegido(SIN, ev, HOY), true);
  assert.equal(puede(SIN, "tpv", ev, HOY), true);
  assert.equal(puede(SIN, "tpv", ev, "2026-11-16"), false);
  assert.equal(puede(SIN, "tpv", { ...ev, creadoEn: "2026-11-12T10:00:00Z" }, HOY), false);
  assert.equal(puede(NUEVA, "tpv", ev, HOY), false);   // nunca tuvo suscripción
});
console.log(`\n${n} pruebas de la suscripción correctas`);

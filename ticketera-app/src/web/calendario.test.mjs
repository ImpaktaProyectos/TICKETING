// Pruebas de «Añadir al calendario»
import assert from "node:assert/strict";
import { madridAUtc, citasPedido, enlaceGoogle, archivoIcs } from "./calendario.js";

let n = 0; const ok = (t) => { n++; console.log("✓ " + t); };

// Hora de España → hora universal (invierno +1, verano +2, y el día del cambio de hora)
assert.equal(madridAUtc("2026-12-12T23:30").toISOString(), "2026-12-12T22:30:00.000Z");
assert.equal(madridAUtc("2027-07-10T18:00").toISOString(), "2027-07-10T16:00:00.000Z");
assert.equal(madridAUtc("2027-03-28T12:00").toISOString(), "2027-03-28T10:00:00.000Z");
assert.equal(madridAUtc("nada"), null);
ok("hora de España a hora universal (invierno, verano y cambio de hora)");

const ev = { nombre: "SOUNDWAVE", inicio: "2027-07-09T18:00", fin: "2027-07-12T04:00:00Z", recinto: "Recinto Ferial", direccion: "Av. Feria 1" };
const abono = citasPedido(ev, [{ acceso: "abono", estado: "valida" }], "https://x/mis-entradas/1");
assert.equal(abono.length, 1);
assert.equal(abono[0].inicio.toISOString(), "2027-07-09T16:00:00.000Z");
assert.equal(abono[0].fin.toISOString(), "2027-07-12T04:00:00.000Z");
assert.equal(abono[0].lugar, "Recinto Ferial, Av. Feria 1");
ok("abono: una cita para todo el evento");

const dias = citasPedido(ev, [{ acceso: "dia", dia: "2027-07-10", estado: "valida" }, { acceso: "dia", dia: "2027-07-10", estado: "valida" }, { acceso: "dia", dia: "2027-07-11", estado: "valida" }, { acceso: "dia", dia: "2027-07-09", estado: "anulada" }]);
assert.equal(dias.length, 2);
assert.equal(dias[0].inicio.toISOString(), "2027-07-10T16:00:00.000Z");
assert.match(dias[0].titulo, /sábado/);
assert.ok(dias[0].fin - dias[0].inicio <= 12 * 3600000);
ok("entradas de día: una cita por día distinto, sin las anuladas");

const sinFin = citasPedido({ nombre: "Fiesta", inicio: "2026-12-12T23:30" });
assert.equal(sinFin[0].fin - sinFin[0].inicio, 6 * 3600000);
ok("sin hora de fin: dura 6 horas");

const g = enlaceGoogle(abono[0]);
assert.match(g, /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
assert.match(g, /dates=20270709T160000Z%2F20270712T040000Z/);
ok("enlace de Google Calendar");

const ics = archivoIcs([...abono, ...dias], "pedido1");
assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 3);
assert.match(ics, /DTSTART:20270709T160000Z/);
assert.match(ics, /TRIGGER:-P1D/);
assert.ok(ics.split("\r\n").every((l) => l.length <= 75), "líneas plegadas a 75 caracteres");
assert.match(ics, /LOCATION:Recinto Ferial\\, Av. Feria 1/);
ok("archivo .ics con avisos y líneas plegadas");

console.log(`\n${n} pruebas de calendario correctas`);

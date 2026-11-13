import assert from "node:assert/strict";
import { waNumero, fechaLarga, nombreSaludo, mensajePedirBebidas, enlacePedirBebidas } from "./mensajesReservados.js";
let n = 0; const ok = (name, f) => { f(); n++; console.log("✓", name); };
ok("teléfono para WhatsApp", () => {
  assert.equal(waNumero("612 345 678"), "34612345678"); assert.equal(waNumero("+34 612-345-678"), "34612345678");
  assert.equal(waNumero("0044 7700 900123"), "447700900123"); assert.equal(waNumero("926 12 34 56"), "926123456"); assert.equal(waNumero("12"), ""); assert.equal(waNumero(""), "");
});
ok("fecha larga", () => { assert.equal(fechaLarga("2026-11-12"), "jueves 12 de noviembre"); assert.equal(fechaLarga(""), ""); });
ok("nombre del saludo", () => { assert.equal(nombreSaludo("ana LÓPEZ"), "Ana"); assert.equal(nombreSaludo("Reserva de Pablo"), "Pablo"); assert.equal(nombreSaludo(""), ""); });
const ev = { name: "AULA 69 - CIUDAD REAL", date: "2026-11-12" };
ok("mensaje con nombre, fiesta, reservado y fecha; pide botellas, tipo y refrescos", () => {
  const m = mensajePedirBebidas({ nombre: "CABINA IZQ", cliente: "ana lópez" }, ev, null);
  assert.match(m, /^¡Hola, Ana! 👋/); assert.match(m, /\*AULA 69 - CIUDAD REAL\*/); assert.match(m, /\*CABINA IZQ\* para el \*jueves 12 de noviembre\*/);
  assert.match(m, /¿Cuántas botellas\?/); assert.match(m, /¿De qué\?/); assert.match(m, /refrescos/);
  assert.doesNotMatch(m, /apuntado/);
});
ok("menciona la tarifa y lo ya apuntado", () => {
  const C = { tarifa: { nombre: "Pack Cabina" }, incl: 2, botellas: [{ bebida: "Beefeater", mezcla: "Tónica" }, { bebida: "", mezcla: "" }] };
  const m = mensajePedirBebidas({ nombre: "R1", cliente: "Pablo" }, ev, C);
  assert.match(m, /Tu reserva \(Pack Cabina\) incluye 2 botellas\./); assert.match(m, /Ahora mismo tenemos apuntado: Beefeater con Tónica\./);
});
ok("enlace wa.me solo si hay teléfono válido", () => {
  assert.equal(enlacePedirBebidas({ nombre: "R1", cliente: "Pablo", telefono: "" }, ev), "");
  const u = enlacePedirBebidas({ nombre: "R1", cliente: "Pablo", telefono: "612345678" }, ev);
  assert.ok(u.startsWith("https://wa.me/34612345678?text=")); assert.match(decodeURIComponent(u.split("text=")[1]), /Hola, Pablo/);
});
console.log(`\n${n} pruebas de mensajes de reservados correctas`);

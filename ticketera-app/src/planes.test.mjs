// Pruebas de las reglas de la suscripción: node src/planes.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bloqueada, diasRestantes, eventoProtegido, puede, sinSuscripcion, avisoNuevoEvento, avisoNuevaBarra, FUNCIONES, CATALOGO, LIMITES, planAFormulario, formularioAPlan, resumenPlan, planMejor, incluye, limitePlan, limiteTxt } from "./planes.js";

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
t("con un plan activo, la protección de la noche no salta los permisos del plan", () => {
  const basico = { plan_id: "basico", plan_nombre: "Básico", estado: "prueba", fin_acceso: "2026-11-22T10:00:00Z", limites: { bloquea: ["facturacion"], barras_por_evento: 2 } };
  const ev = { creadoEn: "2026-11-05T10:00:00Z", date: HOY, puntos: [{}, {}] };
  assert.equal(eventoProtegido(basico, ev, HOY), false);
  assert.equal(puede(basico, "facturacion", ev, HOY), false);
  assert.equal(puede(basico, "tpv", ev, HOY), true);
  assert.match(avisoNuevaBarra(basico, ev, HOY), /Básico permite 2 puntos de venta por evento/);
  assert.equal(avisoNuevaBarra(basico, { ...ev, puntos: [{}, { archivado: true }] }, HOY), null);
});
t("límite de eventos a la vez", () => {
  const acc = { plan_id: "basico", plan_nombre: "Básico", limites: { eventos: 1 } };
  assert.match(avisoNuevoEvento(acc, [{ date: HOY }], HOY), /1 evento a la vez/);
  assert.equal(avisoNuevoEvento(acc, [{ date: HOY, closed: true }], HOY), null);
  assert.equal(avisoNuevoEvento(acc, [{ date: "2026-10-01" }], HOY), null);   // ya pasado: no cuenta
});
t("el catálogo de la app coincide con el de la base de datos", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20261117090000_ticket_planes_configurables.sql", import.meta.url), "utf8");
  const bloque = sql.slice(sql.indexOf("function public.ticket_catalogo()"), sql.indexOf("$$;", sql.indexOf("function public.ticket_catalogo()")));
  const claves = [...bloque.matchAll(/'([a-z_]+)', '/g)].map(m => m[1]).filter(k => k !== "funciones" && k !== "limites");
  assert.deepEqual(claves.sort(), [...Object.keys(CATALOGO), ...Object.keys(LIMITES)].sort());
});
t("formulario de plan: ida y vuelta sin perder nada", () => {
  const plan = { id: "basico", nombre: "Básico", precio_mes: 19.9, dias_prueba: 7, publico: true, limites: { bloquea: ["stock", "facturacion"], barras_por_evento: 3 } };
  const f = planAFormulario(plan);
  assert.equal(f.precio, "19,9");
  assert.deepEqual(f.incluye.includes("stock"), false);
  assert.equal(f.limites.barras_por_evento, 3);
  assert.equal(f.limites.planos, null);
  const { errores, datos } = formularioAPlan(f);
  assert.deepEqual(errores, []);
  assert.equal(datos.precio_mes, 19.9);
  assert.deepEqual(datos.limites, { eventos: null, barras_por_evento: 3, puestos_por_evento: null, planos: null, socios: null, facturas_mes: null });
  assert.equal(datos.incluye.length, Object.keys(CATALOGO).length - 2);
  assert.equal(formularioAPlan({ ...f, precio: "1.234,50" }).datos.precio_mes, 1234.5);
});
t("formulario de plan: avisa de lo que no vale", () => {
  const base = planAFormulario(null);
  assert.equal(base.incluye.length, Object.keys(CATALOGO).length);   // un plan nuevo empieza con todo
  assert.ok(formularioAPlan({ ...base, nombre: "X" }).errores.length);
  assert.ok(formularioAPlan({ ...base, nombre: "Pro", publico: true, precio: "" }).errores.some(e => /precio/.test(e)));
  assert.ok(formularioAPlan({ ...base, nombre: "Pro", limites: { barras_por_evento: 0 } }).errores.some(e => /Puntos de venta/.test(e)));
  assert.ok(formularioAPlan({ ...base, nombre: "Pro", publico: true, precio: "10", incluye: [] }).errores.some(e => /al menos una/.test(e)));
  assert.equal(formularioAPlan({ ...base, nombre: "Gratis", precio: "", publico: false }, { sistema: true }).errores.length, 0);
});
t("resumen y plan que mejora", () => {
  const planes = [
    { id: "basico", nombre: "Básico", precio_mes: 19.9, limites: { bloquea: ["stock"], planos: 2 } },
    { id: "pro", nombre: "Pro", precio_mes: 49.9, limites: {} },
    { id: "medio", nombre: "Medio", precio_mes: 29.9, limites: { bloquea: ["stock"], planos: 10 } },
  ];
  const r = resumenPlan(planes[0]);
  assert.ok(r.incluye.includes("TPV") && r.noIncluye.includes("Stock"));
  assert.deepEqual(r.limites, ["2 planos guardados"]);
  assert.equal(planMejor(planes, "basico", { funcion: "stock" }).id, "pro");
  assert.equal(planMejor(planes, "basico", { limite: "planos", n: 2 }).id, "medio");
  assert.equal(planMejor(planes, "pro", { limite: "planos", n: 50 }), null);
  assert.equal(incluye(planes[1], "stock"), true);
  assert.equal(limitePlan(planes[1], "planos"), null);
  assert.equal(limiteTxt("eventos", 1), "1 evento a la vez");
});
console.log(`\n${n} pruebas de la suscripción correctas`);

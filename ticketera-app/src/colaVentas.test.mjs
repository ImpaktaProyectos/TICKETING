// Pruebas de la cola de ventas sin conexión (db.js · syncPending):
// al volver internet, las ventas se suben en lotes y NUNCA se pierde, se duplica ni se desordena nada.
// Se ejecuta con node (sin navegador): se simulan el servidor, el almacenamiento del equipo y la red.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const aqui = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "tixfast-cola-"));

// ---- Entorno simulado ----
const almacen = new Map();
globalThis.localStorage = {
  getItem: (k) => (almacen.has(k) ? almacen.get(k) : null), setItem: (k, v) => almacen.set(k, String(v)),
  removeItem: (k) => almacen.delete(k), key: (i) => [...almacen.keys()][i] ?? null, get length() { return almacen.size; },
};
const red = { online: true };
Object.defineProperty(globalThis, "navigator", { value: { get onLine() { return red.online; } }, configurable: true });

// Servidor simulado: guarda lo subido en orden
const srv = { modo: "ok", subidas: [], llamadas: [], malo: null };
const errRed = { message: "TypeError: Failed to fetch" };   // sin código = error de red
globalThis.__srv = {
  rpc: async (fn, args) => {
    srv.llamadas.push(fn);
    if (srv.modo === "sin_red") return { error: errRed };
    if (fn === "ticket_vender_lote") {
      if (srv.modo === "sin_lote") return { error: { code: "PGRST202", message: "Could not find the function public.ticket_vender_lote(p_ventas) in the schema cache" } };
      if (args.p_ventas.some(a => a.p_client_uuids[0] === srv.malo)) return { error: { code: "23514", message: "violates check constraint" } };   // todo o nada
      args.p_ventas.forEach(a => { if (!srv.subidas.includes(a.p_client_uuids[0])) srv.subidas.push(a.p_client_uuids[0]); });
      return { data: args.p_ventas.length, error: null };
    }
    if (fn === "ticket_vender") {
      if (args.p_client_uuids[0] === srv.malo) return { error: { code: "23514", message: "violates check constraint" } };
      if (srv.subidas.includes(args.p_client_uuids[0])) return { error: { code: "23505", message: "duplicate key" } };
      srv.subidas.push(args.p_client_uuids[0]);
      return { data: [], error: null };
    }
    return { error: null };
  },
  from: () => { const q = { update: () => q, eq: async (_c, v) => { if (srv.modo === "sin_red") return { error: errRed }; srv.subidas.push("anula:" + v); return { error: null }; }, insert: async () => ({ error: null }) }; return q; },
};
writeFileSync(join(dir, "supabase.js"), "export const supabase = globalThis.__srv; export const uid = () => crypto.randomUUID();\n");
writeFileSync(join(dir, "errores.js"), "export function registrarError() {}\n");
const fuente = readFileSync(join(aqui, "db.js"), "utf8").replace('from "./errores"', 'from "./errores.js"').replace('from "./supabase"', 'from "./supabase.js"');
writeFileSync(join(dir, "db.mjs"), fuente);
const db = await import(pathToFileURL(join(dir, "db.mjs")).href);

// ---- Utilidades ----
const venta = () => { const u = crypto.randomUUID(); return { u, args: { p_evento: "e", p_punto: "p", p_producto: "x", p_nombre: "Cerveza", p_precio: 4, p_qty: 1, p_codigos: ["A-1"], p_operario: "B", p_client_uuids: [u], p_metodo: "efectivo", p_entregado: null, p_cambio: null } }; };
const preparar = (items) => { almacen.clear(); db.setUserScope("cuenta-prueba"); localStorage.setItem(db.scopedKey("ticketera_pending"), JSON.stringify(items.map(x => x.cola))); };
const enCola = (v) => ({ ...v, cola: { op: "vender", fecha: new Date().toISOString(), args: v.args, qid: crypto.randomUUID() } });
const anul = (u) => ({ u: "anula:" + u, cola: { op: "anularVenta", clientUuid: u, por: "Admin", qid: crypto.randomUUID() } });
const reset = (modo = "ok") => { srv.modo = modo; srv.subidas = []; srv.llamadas = []; srv.malo = null; };
let ok = 0; const prueba = async (nombre, fn) => { await fn(); ok++; console.log("✓ " + nombre); };

await prueba("250 ventas y una anulación en medio: lotes, en orden y sin perder nada", async () => {
  reset();
  const a = Array.from({ length: 120 }, () => enCola(venta()));
  const b = anul(a[5].u);
  const c = Array.from({ length: 130 }, () => enCola(venta()));
  const todo = [...a, b, ...c]; preparar(todo);
  const r = await db.syncPending();
  assert.equal(r.remaining, 0); assert.equal(r.synced, todo.length);
  assert.deepEqual(srv.subidas, todo.map(x => x.u));                       // mismo orden exacto
  assert.equal(srv.llamadas.filter(f => f === "ticket_vender_lote").length, 4);   // 100+20, anulación, 100+30
  assert.ok(srv.llamadas.length <= 6);
});

await prueba("Sin la función de lotes en el servidor: se sube de una en una como antes", async () => {
  reset("sin_lote");
  const v = Array.from({ length: 30 }, () => enCola(venta())); preparar(v);
  const r = await db.syncPending();
  assert.equal(r.remaining, 0); assert.deepEqual(srv.subidas, v.map(x => x.u));
  srv.modo = "ok"; srv.llamadas = [];
  const w = Array.from({ length: 5 }, () => enCola(venta())); preparar(w);
  await db.syncPending();
  assert.ok(!srv.llamadas.includes("ticket_vender_lote"), "no vuelve a intentar el lote en esta sesión");
});

await prueba("Una venta rechazada por el servidor: las anteriores suben, ella y las siguientes esperan en orden", async () => {
  reset();
  const v = Array.from({ length: 10 }, () => enCola(venta())); preparar(v); srv.malo = v[6].u;
  const r = await db.syncPending();
  assert.deepEqual(srv.subidas, v.slice(0, 6).map(x => x.u));
  assert.equal(r.remaining, 4);
  const cola = JSON.parse(localStorage.getItem(db.scopedKey("ticketera_pending")));
  assert.deepEqual(cola.map(x => x.args.p_client_uuids[0]), v.slice(6).map(x => x.u));
  assert.equal(cola[0].tries, 1);
});

await prueba("Sin red a mitad: no se borra nada de la cola", async () => {
  reset("sin_red");
  const v = Array.from({ length: 40 }, () => enCola(venta())); preparar(v);
  const r = await db.syncPending();
  assert.equal(r.remaining, 40); assert.equal(srv.subidas.length, 0);
});

await prueba("Venta ya subida (se cortó justo después): no se duplica", async () => {
  reset();
  const v = Array.from({ length: 3 }, () => enCola(venta())); srv.subidas.push(v[1].u); preparar(v);
  const r = await db.syncPending();
  assert.equal(r.remaining, 0);
  assert.equal(srv.subidas.filter(u => u === v[1].u).length, 1);
});

console.log(`\n${ok} pruebas de la cola de ventas correctas`);

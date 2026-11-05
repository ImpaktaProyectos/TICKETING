import assert from "node:assert/strict";
import * as P from "./prevision.js";
let n = 0; const ok = (name, f) => { f(); n++; console.log("✓", name); };

const cfg = P.cfgCon({ gastoBarra: 8, margenBarra: 50, costeCopa: 3 });
const fis0 = P.fiscalDe({}, cfg);   // sin comisión ni IVA

ok("barra: 8 € × 50 % = 4 €", () => assert.equal(P.barraPorPersona(cfg, fis0), 4));
ok("entrada 20 € con 1 copa deja 20 − 3 + 4 = 21", () => assert.equal(P.desglose(20, 1, cfg, fis0).deja, 21));

ok("equilibrio simple: gastos 2.100 € / 21 € = 100 entradas", () => {
  const T = P.prepararTramos([{ precio: 20, copas: 1, cupo: "" }], cfg, fis0);
  const F = P.fijo({ cfg, fis: fis0, gastos: 2100 });
  assert.equal(P.equilibrio(T, cfg, F).faltan, 100);
  assert.equal(P.resultado(T, cfg, F, 100).total, 0);
  assert.equal(P.resultado(T, cfg, F, 99).total, -21);
});

ok("por tramos en orden: 50 a 10 € (deja 14) y luego a 20 € (deja 24)", () => {
  const c = P.cfgCon({ gastoBarra: 8, margenBarra: 50, costeCopa: 3 });
  const T = P.prepararTramos([{ precio: 10, cupo: 50 }, { precio: 20, cupo: "" }], c, fis0);
  const F = P.fijo({ cfg: c, fis: fis0, gastos: 1000 });   // 50×14 = 700, faltan 300 / 24 = 12,5 → 13
  assert.equal(P.equilibrio(T, c, F).faltan, 63);
  assert.deepEqual(P.repartir(T, c, 63), [50, 13]);
});

ok("aforo insuficiente → imposible", () => {
  const c = P.cfgCon({ ...cfg, aforo: 50 });
  const T = P.prepararTramos([{ precio: 20, copas: 1, cupo: "" }], c, fis0);
  const e = P.equilibrio(T, c, P.fijo({ cfg: c, fis: fis0, gastos: 5000 }));
  assert.equal(e.faltan, null); assert.ok(e.imposible);
  assert.deepEqual(P.repartir(T, c, 999), [50]);
});

ok("comisión 5 % + 0,50 € e IVA 21 %", () => {
  const aj = { comisiones: { ticketeraPct: 5, ticketeraFijo: 0.5 }, iva: { activo: true, ventas: { entradas: 21, barra: 10 } } };
  const f = P.fiscalDe(aj, cfg);
  const d = P.desglose(24.2, 0, cfg, f);   // sin IVA 20; comisión 1,21+0,5 = 1,71; barra 8/1,1×0,5 = 3,64
  assert.equal(d.comision, 1.71); assert.equal(d.barra, 3.64); assert.equal(d.deja, 21.93);
});

ok("real: tu ejemplo (5.000 € vendidos, 7.000 € de gastos)", () => {
  const c = P.cfgCon({ gastoBarra: 0, margenBarra: 0, costeCopa: 0 });
  const T = P.prepararTramos([{ precio: 20, cupo: 250, vendidas: 250 }, { precio: 25, cupo: "" , vendidas: 0 }], c, fis0, { conBase: true });
  const F = P.fijo({ cfg: c, fis: fis0, gastos: 7000 });
  const e = P.equilibrio(T, c, F);
  assert.equal(e.faltan, 80); assert.equal(e.tramo, "Tramo 2");   // 2.000 € / 25 € = 80
});

ok("real con importe cobrado de la ticketera", () => {
  const c = P.cfgCon({ gastoBarra: 0, margenBarra: 0, costeCopa: 0 });
  const T = P.prepararTramos([{ precio: 20, vendidas: 100, importeReal: 1850 }], c, fis0, { conBase: true });
  assert.equal(T[0].valorBase, 1850);
});

ok("ya cubierto → faltan 0", () => {
  const T = P.prepararTramos([{ precio: 20, vendidas: 100 }], cfg, fis0, { conBase: true });
  assert.equal(P.equilibrio(T, cfg, P.fijo({ cfg, fis: fis0, gastos: 100 })).faltan, 0);
});

ok("invitaciones: gastan en barra y consumen copa", () => {
  const c = P.cfgCon({ ...cfg, invitaciones: 10, copasInvitacion: 1 });   // 10 × (4 − 3) = 10
  assert.equal(P.fijo({ cfg: c, fis: fis0, gastos: 0 }).total, 10);
});

ok("escenarios por % del aforo y por número", () => {
  const c = P.cfgCon({ ...cfg, aforo: 400 });
  const T = P.prepararTramos([{ precio: 20 }], c, fis0);
  assert.equal(P.entradasEscenario({ modo: "pct", valor: 75 }, T, c), 300);
  assert.equal(P.entradasEscenario({ modo: "num", valor: 220 }, T, c), 220);
  assert.equal(P.entradasEscenario({ modo: "pct", valor: 75 }, T, cfg), null);   // sin aforo no hay %
});

ok("datos vacíos o raros no rompen", () => {
  const T = P.prepararTramos([{ precio: "abc", cupo: "-3", copas: null }], cfg, fis0);
  assert.equal(T[0].d.deja, 4); assert.equal(T[0].cupo, null);
  assert.equal(P.equilibrio([], cfg, P.fijo({ cfg, fis: fis0, gastos: 10 })).faltan, null);
});
console.log(`\n${n} pruebas correctas`);

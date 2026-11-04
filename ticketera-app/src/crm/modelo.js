// Modelo compartido del CRM: grupos y categorías de ingreso, y resumen económico de un evento
import { r2, isInvite } from "./ui";
import { totalesGastos } from "./Gastos";

export const GRUPOS = [
  { k: "barra", t: "Barras", i: "glass", c: "#ff5a3c" },
  { k: "entradas", t: "Entradas", i: "ticket", c: "#a855f7" },
  { k: "merch", t: "Merchandising", i: "shirt", c: "#3b82f6" },
  { k: "patrocinio", t: "Patrocinios", i: "award", c: "#22d3a6" },
  { k: "otros", t: "Otros", i: "sparkle", c: "#ffb400" },
];
export const grupoInfo = (k) => GRUPOS.find(g => g.k === k) || GRUPOS[4];
export const CATS = [
  { k: "Entradas anticipadas", g: "entradas", i: "ticket" },
  { k: "Ticketera online", g: "entradas", i: "globe" },
  { k: "Merchandising", g: "merch", i: "shirt" },
  { k: "Patrocinio", g: "patrocinio", i: "award" },
  { k: "Subvención", g: "otros", i: "building" },
  { k: "Guardarropa", g: "otros", i: "hanger" },
  { k: "Otros", g: "otros", i: "sparkle" },
].map(c => ({ ...c, c: GRUPOS.find(g => g.k === c.g).c }));
export const catInfo = (k) => CATS.find(c => c.k === k) || { k, g: "otros", i: "sparkle", c: "#ffb400" };
export const fuenteAuto = (p) => /taquill|entrada|ticket/i.test(p.name) ? "entradas" : /merch|camiset/i.test(p.name) ? "merch" : "barra";

// Resumen de un evento con los datos de la cuenta (ventas del TPV + ingresos y gastos del CRM)
export function resumenEvento(ev, sales, gastosCaja, ingresosEv, gastosEv, fuentes) {
  const ss = sales.filter(s => s.eventId === ev.id && !s.voided && !isInvite(s));
  const porGrupo = Object.fromEntries(GRUPOS.map(g => [g.k, 0]));
  ev.puntos.forEach(p => {
    const t = ss.filter(s => s.puntoId === p.id).reduce((a, s) => a + s.price, 0);
    const f = (fuentes || {})[p.id] || fuenteAuto(p);
    porGrupo[f] = (porGrupo[f] || 0) + t;
  });
  const tpv = r2(ss.reduce((a, s) => a + s.price, 0));
  ingresosEv.forEach(i => { const g = catInfo(i.categoria).g; porGrupo[g] = (porGrupo[g] || 0) + i.importe; });
  Object.keys(porGrupo).forEach(k => { porGrupo[k] = r2(porGrupo[k]); });
  const manual = r2(ingresosEv.reduce((a, i) => a + i.importe, 0));
  const ingresos = r2(tpv + manual);
  const G = totalesGastos(ev, gastosEv, gastosCaja);
  const beneficio = r2(ingresos - G.total);
  const horas = {};
  ss.forEach(s => { const h = new Date(s.ts).getHours(); horas[h] = (horas[h] || 0) + 1; });
  return { ev, tpv, manual, ingresos, porGrupo, G, gastos: G.total, beneficio, margen: ingresos > 0 ? Math.round(beneficio / ingresos * 100) : null, horas, tickets: ss.length };
}

// Modelo compartido del CRM: grupos y categorías de ingreso, y resumen económico de un evento
import { r2, isInvite } from "./ui";
import { totalesGastos } from "./Gastos";
import { GRUPOS, catInfo, fuenteAuto } from "./categorias";
import { fiscalEvento } from "./fiscal";
export { GRUPOS, grupoInfo, CATS_ING as CATS, catInfo, catsIngreso, fuenteAuto } from "./categorias";

// Resumen de un evento con los datos de la cuenta (ventas del TPV + ingresos y gastos del CRM + comisiones e IVA)
export function resumenEvento(ev, sales, gastosCaja, ingresosEv, gastosEv, fuentes, ajustes) {
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
  const F = fiscalEvento({ ev, sales, ingresos: ingresosEv, gastos: gastosEv, fuentes, ajustes });
  const G = totalesGastos(ev, gastosEv, gastosCaja, F.auto);
  const beneficio = r2(ingresos - G.total);
  const horas = {};
  ss.forEach(s => { const h = new Date(s.ts).getHours(); horas[h] = (horas[h] || 0) + 1; });
  return { ev, tpv, manual, ingresos, porGrupo, G, F, gastos: G.total, beneficio, margen: ingresos > 0 ? Math.round(beneficio / ingresos * 100) : null, horas, tickets: ss.length };
}

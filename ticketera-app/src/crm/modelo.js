// Modelo compartido del CRM: grupos y categorías de ingreso, y resumen económico de un evento
import { r2, isInvite } from "./ui";
import { totalesGastos } from "./Gastos";
import { GRUPOS_VISTA, grupoVista, catInfo } from "./categorias";
import { fiscalEvento } from "./fiscal";
export { GRUPOS, GRUPOS_VISTA, grupoInfo, CATS_ING as CATS, catInfo, catsIngreso, fuenteAuto } from "./categorias";

// Resumen de un evento con los datos de la cuenta (ventas del TPV + ingresos y gastos del CRM + comisiones e IVA)
export function resumenEvento(ev, sales, gastosCaja, ingresosEv, gastosEv, fuentes, ajustes, senales = 0) {
  const ss = sales.filter(s => s.eventId === ev.id && !s.voided && !isInvite(s));
  const porGrupo = Object.fromEntries(GRUPOS_VISTA.map(g => [g.k, 0]));
  // TPV = ventas de todos los puntos + señales de reservados cobradas antes (igual que Ingresos)
  const ventasTpv = r2(ss.reduce((a, s) => a + s.price, 0));
  const tpv = r2(ventasTpv + (Number(senales) || 0));
  porGrupo.tpv = tpv;
  ingresosEv.forEach(i => { const g = grupoVista(catInfo(i.categoria).g); porGrupo[g] += i.importe; });
  Object.keys(porGrupo).forEach(k => { porGrupo[k] = r2(porGrupo[k]); });
  const manual = r2(ingresosEv.reduce((a, i) => a + i.importe, 0));
  const ingresos = r2(tpv + manual);
  const F = fiscalEvento({ ev, sales, ingresos: ingresosEv, gastos: gastosEv, fuentes, ajustes, senales });
  const G = totalesGastos(ev, gastosEv, gastosCaja, F.auto);
  const beneficio = r2(ingresos - G.total);
  const horas = {};
  ss.forEach(s => { const h = new Date(s.ts).getHours(); horas[h] = (horas[h] || 0) + 1; });
  return { ev, tpv, ventasTpv, manual, ingresos, porGrupo, G, F, gastos: G.total, beneficio, margen: ingresos > 0 ? Math.round(beneficio / ingresos * 100) : null, horas, tickets: ss.length };
}

// ===================== GASTOS PREVISTOS (CRM) PAGADOS DESDE LA CAJA (TPV) =====================
// Antes de la fiesta se apuntan en el CRM los pagos previstos (Javi, camarero, 60 €).
// En la noche, desde 💰 Caja del TPV se elige ese gasto y se paga lo que sea de verdad (80 €):
// el gasto de caja queda enlazado (crmGastoId) y el del CRM pasa a «pagado» con el importe real.
// Para no contar nada dos veces: un pago de caja enlazado NO suma en «Caja de las barras»; cuenta en su gasto del CRM.
// La base de datos hace lo mismo con un disparador (ticket_gastos_crm_sync); aquí se calcula también en vivo
// para que se vea al momento, aunque el pago aún no haya subido.
import { categoriaDe } from "./cierreNocheCalc.js";

const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const activo = (g) => g && !g.voided && g.tipo !== "entrada";

// Pagos de caja vigentes por gasto del CRM: Map id → { total, n, items }
export function pagosDeCaja(gastosCaja = [], eventoId) {
  const m = new Map();
  gastosCaja.forEach(g => {
    if (!activo(g) || !g.crmGastoId || (eventoId && g.eventId !== eventoId)) return;
    const x = m.get(g.crmGastoId) || { total: 0, n: 0, items: [] };
    x.total = r2(x.total + Number(g.importe || 0)); x.n++; x.items.push(g); m.set(g.crmGastoId, x);
  });
  return m;
}

// Gastos del CRM con lo pagado desde la caja ya aplicado (importe real, estado «pagado», sin socio que adelante)
export function aplicarCaja(gastos = [], gastosCaja = [], eventoId) {
  const m = pagosDeCaja(gastosCaja, eventoId);
  if (!m.size) return gastos;
  return gastos.map(g => { const p = m.get(g.id); return p ? { ...g, real: p.total, estado: "pagado", pagadoPor: null, cajaPagado: p.total, cajaPagos: p.items } : g; });
}

// ¿Este pago de caja ya cuenta dentro de un gasto del CRM? (entonces no se suma aparte)
export const enlazadoA = (g, idsCRM) => !!(g.crmGastoId && idsCRM.has(g.crmGastoId));

// Categoría del cierre de la noche para un gasto del CRM
const POR_CAT_CRM = { "Artistas": "artistas", "Personal": "personal", "Técnicos": "personal", "Servicios": "seguridad", "Barra y producto": "compras", "Logística": "transporte" };
export function categoriaTPV(g) {
  if (g.tipo === "artista" || g.categoria === "Artistas") return "artistas";
  if (g.tipo === "personal") return "personal";
  const porTexto = categoriaDe({ concepto: `${g.concepto || ""} ${g.proveedor || ""}` }).k;
  return porTexto !== "otros" ? porTexto : POR_CAT_CRM[g.categoria] || "otros";
}

// Lista para la caja del TPV: cada pago previsto con su estado
//   pendiente · pagado_caja (ya pagado desde alguna caja) · pagado_crm (marcado como pagado en el CRM)
export function previstosParaCaja(previstos = [], gastosCaja = [], eventoId) {
  const m = pagosDeCaja(gastosCaja, eventoId);
  const conHijos = new Set(previstos.filter(g => g.padreId).map(g => g.padreId));
  return previstos
    .filter(g => !(conHijos.has(g.id) && !(Number(g.previsto) > 0) && g.real == null))   // la cabecera vacía de un artista no se paga
    .map(g => {
      const p = m.get(g.id);
      const previsto = g.previsto != null ? r2(g.previsto) : null;
      const estado = p ? "pagado_caja" : g.estado === "pagado" ? "pagado_crm" : "pendiente";
      const padre = g.padreId ? previstos.find(x => x.id === g.padreId) : null;   // gasto de un artista: «DJ · Transporte»
      const nombre = ((padre ? `${padre.proveedor || padre.concepto || "Artista"} · ` : "") + (g.proveedor || g.concepto || g.categoria || "Gasto")).trim();
      const detalle = [g.proveedor && g.concepto ? g.concepto : "", g.categoria].filter(Boolean).join(" · ");
      return { id: g.id, nombre, detalle, previsto, estado, pagado: p ? p.total : g.estado === "pagado" ? (g.real ?? previsto) : 0, diferencia: p && previsto != null ? r2(p.total - previsto) : null, cat: categoriaTPV(g) };
    })
    .sort((a, b) => (a.estado === "pendiente" ? 0 : 1) - (b.estado === "pendiente" ? 0 : 1) || a.nombre.localeCompare(b.nombre, "es"));
}

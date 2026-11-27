import { gastosComprador } from "../comision.js";
// Llamadas a la función «pagos» del servidor (Stripe). El navegador nunca mueve dinero:
// solo pide abrir un pago, consultar un monedero o pasar su saldo al banco.
export async function pagos(cliente, accion, extra = {}) {
  const { data, error } = await cliente.functions.invoke("pagos", { body: { accion, origen: window.location.origin, ...extra } });
  if (error) {
    try { const j = await error.context?.json?.(); if (j) return j; } catch { /* sin cuerpo */ }
    throw error;
  }
  return data;
}

// Gastos de gestión de un pedido (las mismas reglas que el servidor, solo para enseñarlo antes de pagar).
// Con la configuración del evento (gastos_cfg) se usan los gastos que eligió el organizador;
// sin ella (servidor aún sin actualizar), la fórmula antigua.
export const gastosDe = (entradas, n = 1, cfg = null) => {
  const p = Number(entradas) || 0;
  if (p <= 0) return 0;
  if (cfg) return gastosComprador(p, n, cfg);
  return Math.min(Math.ceil(((0.25 + 0.0475 * p) / (1 / 1.21 - 0.015)) * 100 - 1e-9) / 100, Math.floor(p * 10 + 1e-9) / 100);
};

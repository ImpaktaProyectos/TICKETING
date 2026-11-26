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

// Gastos de gestión de un pedido (la misma fórmula que el servidor, solo para enseñarlo antes de pagar):
// Stripe (1,5 % + 0,25 €) + reparto (0,25 %) + 3 % TIXFAST, IVA incluido, nunca más del 10 % de las entradas.
export const gastosDe = (entradas) => {
  const p = Number(entradas) || 0;
  if (p <= 0) return 0;
  return Math.min(Math.ceil(((0.25 + 0.0475 * p) / (1 / 1.21 - 0.015)) * 100 - 1e-9) / 100, Math.floor(p * 10 + 1e-9) / 100);
};

// ===================== COMISIÓN DE TIXFAST Y GASTOS DE GESTIÓN =====================
// Mismas reglas que el servidor (plataforma_comision y pago_gastos_evento en la base de datos):
//  · Comisión de TIXFAST (IVA incluido) = % pactado del precio de las entradas, con un mínimo por entrada,
//    y nunca más de lo que valen las entradas.
//  · Gastos que paga el comprador, según elija el organizador en el evento:
//      recomendado → igual que la comisión (el organizador cobra el 100 % de la entrada)
//      por_entrada → un importe fijo por entrada
//      ninguno     → 0
//  · El organizador recibe: entradas + gastos − comisión.
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

export const TARIFA_DEF = { pct: 8, min: 0.5, iva: 21 };

export function comisionDe(entradas, n, tarifa = TARIFA_DEF) {
  const p = Number(entradas) || 0;
  if (p <= 0) return 0;
  const pct = Number(tarifa?.pct ?? TARIFA_DEF.pct), min = Number(tarifa?.min ?? TARIFA_DEF.min);
  return Math.min(r2(p), Math.max(r2(p * pct / 100), r2(min * Math.max(Number(n) || 1, 1))));
}

// cfg: { modo, por_entrada, pct, min } (lo que manda la web pública en gastos_cfg)
export function gastosComprador(entradas, n, cfg) {
  const p = Number(entradas) || 0;
  if (p <= 0 || !cfg) return 0;
  if (cfg.modo === "ninguno") return 0;
  if (cfg.modo === "por_entrada") return r2((Number(cfg.por_entrada) || 0) * Math.max(Number(n) || 1, 1));
  return comisionDe(p, n, cfg);
}

// Resumen de una venta: lo que paga el comprador, lo que recibe el organizador y lo que se queda TIXFAST
export function reparto(entradas, n, cfg, tarifa) {
  const gastos = gastosComprador(entradas, n, cfg), comision = comisionDe(entradas, n, tarifa || cfg);
  const iva = Number((tarifa || cfg)?.iva ?? TARIFA_DEF.iva);
  const base = r2(comision / (1 + iva / 100));
  return { comprador: r2(Number(entradas) + gastos), gastos, organizador: r2(Number(entradas) + gastos - comision), comision, comisionBase: base, comisionIva: r2(comision - base) };
}

// Calculadora de Stripe (tarifa orientativa: lo real se guarda en cada pago)
export const costeStripe = (cobrado, pct = 1.5, fijo = 0.25) => (Number(cobrado) > 0 ? r2(Number(cobrado) * pct / 100 + Number(fijo)) : 0);

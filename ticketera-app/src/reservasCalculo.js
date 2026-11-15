// ===================== RESERVA ONLINE · cálculo del precio (sin red, probado en reservasCalculo.test.mjs) =====================
// Mismas reglas que la base de datos (reservas_crear) para enseñar el precio antes de pagar.
// El precio que se cobra lo calcula SIEMPRE el servidor; esto solo lo anticipa en pantalla.
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

// Pack + botellas extra
export function totalReserva(tarifa, nBotellas, precioExtra) {
  if (!tarifa) return null;
  const incl = Math.max(0, parseInt(tarifa.botellas, 10) || 0);
  const extra = Math.max(0, (nBotellas || 0) - incl);
  if (extra > 0 && precioExtra == null) return null;
  return r2(Number(tarifa.precio) + extra * (Number(precioExtra) || 0));
}
// Gastos de gestión: misma fórmula que las entradas (pago_gastos en la base de datos)
export function gastosGestion(importe) {
  const p = Number(importe) || 0;
  if (p <= 0) return 0;
  return Math.min(Math.ceil(((0.25 + 0.0475 * p) / (1 / 1.21 - 0.015)) * 100 - 1e-9) / 100, Math.floor(p * 10) / 100);
}
export function importes(tarifa, nBotellas, precioExtra, pct) {
  const total = totalReserva(tarifa, nBotellas, precioExtra);
  if (total == null) return null;
  const adelanto = r2((total * Math.max(0, Math.min(100, Number(pct) || 0))) / 100);
  const gastos = gastosGestion(adelanto);
  return { total, adelanto, gastos, hoy: r2(adelanto + gastos), resto: r2(Math.max(0, total - adelanto)) };
}
// Packs que valen para una mesa (si el pack dice «grande», solo en mesas grandes)
export const packsDeMesa = (tarifas, mesa) => (tarifas || []).filter(t => !t.tamano || !mesa || t.tamano === mesa.tamano);
export const telefonoValido = (t) => String(t || "").replace(/\D/g, "").length >= 9;
export const emailValido = (e) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e).trim());

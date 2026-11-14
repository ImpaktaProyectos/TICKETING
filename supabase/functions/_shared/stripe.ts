// TIXFAST · llamadas a Stripe compartidas por las funciones (sin SDK, API REST)
const SK = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
export const hayStripe = () => !!SK;

function formulario(obj: Record<string, unknown>, prefijo = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const clave = prefijo ? `${prefijo}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (x && typeof x === "object") ? formulario(x as Record<string, unknown>, `${clave}[${i}]`, out) : out.append(`${clave}[${i}]`, String(x)));
    else if (typeof v === "object") formulario(v as Record<string, unknown>, clave, out);
    else out.append(clave, String(v));
  }
  return out;
}
export async function stripe(metodo: "GET" | "POST" | "DELETE", ruta: string, params: Record<string, unknown> = {}, clave?: string) {
  const cuerpo = formulario(params).toString();
  const headers: Record<string, string> = { Authorization: `Bearer ${SK}`, "Content-Type": "application/x-www-form-urlencoded" };
  if (clave) headers["Idempotency-Key"] = clave;
  const r = await fetch(`https://api.stripe.com/v1/${ruta}${metodo === "GET" && cuerpo ? `?${cuerpo}` : ""}`, { method: metodo, headers, body: metodo === "GET" ? undefined : cuerpo });
  const d = await r.json();
  if (!r.ok) { const e = new Error(d?.error?.message || `Stripe ${r.status}`); (e as any).status = r.status; throw e; }
  return d;
}

// Cupón de descuento X % durante N meses (se crea la primera vez que hace falta)
export async function cupon(pct: number, meses: number) {
  pct = Math.max(1, Math.min(100, Math.round(pct))); meses = Math.max(1, Math.min(12, Math.round(meses)));
  const id = `tixfast-${pct}-${meses}m`;
  try { return (await stripe("GET", `coupons/${id}`)).id as string; }
  catch (e) { if ((e as any).status !== 404) throw e; }
  const c = await stripe("POST", "coupons", { id, percent_off: pct, duration: "repeating", duration_in_months: meses, name: `${pct} % durante ${meses} ${meses === 1 ? "mes" : "meses"}` }, `tixfast-cupon-${id}`);
  return c.id as string;
}
// Aplica un descuento a una suscripción y anula la cancelación si la había pedido
export async function aplicarDescuento(sub: string, pct: number, meses: number) {
  const id = await cupon(pct, meses);
  return await stripe("POST", `subscriptions/${sub}`, { discounts: [{ coupon: id }], cancel_at_period_end: "false" });
}
// Pausa el cobro N meses (sin acceso mientras dure); se reanuda sola
export async function pausar(sub: string, meses: number) {
  const vuelve = Math.floor(Date.now() / 1000) + Math.round(meses * 30.44 * 86400);
  return await stripe("POST", `subscriptions/${sub}`, { pause_collection: { behavior: "void", resumes_at: vuelve }, cancel_at_period_end: "false" });
}

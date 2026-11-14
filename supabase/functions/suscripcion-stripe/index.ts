// TIXFAST · avisos de Stripe de las SUSCRIPCIONES (webhook)
// Comprueba la firma con el secreto guardado al prepararlo (webhook_suscripcion) y pasa a la ficha
// de la cuenta el estado real de su suscripción. Idempotente: si Stripe repite un aviso, no pasa nada.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SK = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const ok = (b: unknown = { recibido: true }, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
function igual(a: string, b: string) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
async function firmaValida(cuerpo: string, cabecera: string, secreto: string) {
  const partes: Record<string, string[]> = {};
  for (const p of cabecera.split(",")) { const [k, v] = p.split("="); (partes[k] ||= []).push(v); }
  const t = partes.t?.[0]; if (!t || Math.abs(Date.now() / 1000 - Number(t)) > 600) return false;
  const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const esperada = hex(await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(`${t}.${cuerpo}`)));
  return (partes.v1 || []).some((v) => igual(v, esperada));
}
async function stripeGet(ruta: string) {
  const r = await fetch(`https://api.stripe.com/v1/${ruta}`, { headers: { Authorization: `Bearer ${SK}` } });
  const d = await r.json(); if (!r.ok) throw new Error(d?.error?.message || "Stripe"); return d;
}
const fecha = (s?: number | null) => (s ? new Date(s * 1000).toISOString() : null);
const ESTADO: Record<string, string> = {
  trialing: "prueba", active: "activa", past_due: "impagada", unpaid: "suspendida", paused: "suspendida",
  canceled: "cancelada", incomplete: "pendiente", incomplete_expired: "pendiente",
};

async function aplicar(sub: any) {
  const cuenta = sub?.metadata?.tixfast_cuenta;
  const cus = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  const finPeriodo = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
  const cambios: Record<string, unknown> = {
    estado: ESTADO[sub.status] || "pendiente", plan_id: "pro", proveedor_pago: "stripe",
    suscripcion_pago_id: sub.id, cliente_pago_id: cus,
    prueba_hasta: fecha(sub.trial_end), periodo_fin: fecha(finPeriodo),
    cancela_al_final: !!sub.cancel_at_period_end || !!sub.cancel_at,
    actualizada_en: new Date().toISOString(),
  };
  if (sub.trial_end) cambios.prueba_usada = true;
  // Un aviso de una suscripción antigua (cancelada) no pisa la suscripción nueva de la cuenta
  const { data: actual } = await (cuenta ? admin.from("ticket_cuentas").select("suscripcion_pago_id").eq("owner_id", cuenta) : admin.from("ticket_cuentas").select("suscripcion_pago_id").eq("cliente_pago_id", cus)).maybeSingle();
  if (actual?.suscripcion_pago_id && actual.suscripcion_pago_id !== sub.id && ["cancelada", "pendiente"].includes(String(cambios.estado))) return;
  // Nunca se toca una cuenta Fundador
  let q = admin.from("ticket_cuentas").update(cambios).neq("plan_id", "fundador");
  q = cuenta ? q.eq("owner_id", cuenta) : q.eq("cliente_pago_id", cus);
  const { error } = await q;
  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return ok({ motivo: "metodo" }, 405);
  const cuerpo = await req.text();
  const { data: s } = await admin.from("ticket_pago_config").select("valor").eq("clave", "webhook_suscripcion").maybeSingle();
  if (!s?.valor || !(await firmaValida(cuerpo, req.headers.get("stripe-signature") || "", s.valor))) return ok({ motivo: "firma" }, 400);
  const ev = JSON.parse(cuerpo);
  const o = ev?.data?.object || {};
  try {
    if (ev.type === "checkout.session.completed") {
      if (o.mode === "subscription" && o.subscription) await aplicar(await stripeGet(`subscriptions/${typeof o.subscription === "string" ? o.subscription : o.subscription.id}`));
    } else if (String(ev.type).startsWith("customer.subscription.")) {
      // Se lee la suscripción de nuevo: así el orden de llegada de los avisos no importa
      await aplicar(await stripeGet(`subscriptions/${o.id}`));
    }
    return ok();
  } catch (e) {
    console.error(ev.type, (e as Error).message);
    return ok({ motivo: "error" }, 500);   // Stripe lo reintentará
  }
});

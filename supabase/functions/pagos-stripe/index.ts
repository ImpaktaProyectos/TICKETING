// TIXFAST · avisos de Stripe (webhooks)
// Comprueba la firma de cada aviso con los secretos guardados por «pagos › preparar» y:
//   · pago completado → emite las entradas (una sola vez) y guarda lo que cobró Stripe
//   · pago caducado o fallido → suelta la reserva
//   · cambio en un monedero (alta) → actualiza su estado
//   · retirada al banco pagada / fallida → actualiza la retirada
// Todo es idempotente: si Stripe repite un aviso, no pasa nada.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SK = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const ok = (b: unknown = { recibido: true }, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
function igual(a: string, b: string) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
async function firmaValida(cuerpo: string, cabecera: string, secreto: string) {
  const partes = Object.fromEntries([]) as Record<string, string[]>;
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

Deno.serve(async (req) => {
  if (req.method !== "POST") return ok({ motivo: "metodo" }, 405);
  const cuerpo = await req.text();
  const firma = req.headers.get("stripe-signature") || "";
  const { data: secretos } = await admin.from("ticket_pago_config").select("valor").in("clave", ["webhook_plataforma", "webhook_connect"]);
  let valida = false;
  for (const s of secretos || []) if (await firmaValida(cuerpo, firma, s.valor)) { valida = true; break; }
  if (!valida) return ok({ motivo: "firma" }, 400);
  const ev = JSON.parse(cuerpo);
  const o = ev?.data?.object || {};
  try {
    switch (ev.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const pedido = o?.metadata?.pedido;
        if (!pedido || o.payment_status !== "paid") break;
        const pi = typeof o.payment_intent === "string" ? o.payment_intent : o.payment_intent?.id;
        const piObj = pi ? await stripeGet(`payment_intents/${pi}`) : null;
        const cargo = typeof piObj?.latest_charge === "string" ? piObj.latest_charge : piObj?.latest_charge?.id ?? null;
        const { error } = await admin.rpc("pago_emitir", { p_pedido: pedido, p_sesion: o.id, p_pi: pi, p_cargo: cargo, p_importe: Math.round(o.amount_total) / 100 });
        if (error) throw error;
        // Lo que cobra Stripe (para saber el margen de TIXFAST). Si aún no está, se completa al repartir.
        if (cargo) { try { const ch = await stripeGet(`charges/${cargo}?expand[]=balance_transaction`); const fee = ch?.balance_transaction?.fee;
          if (typeof fee === "number") await admin.from("ticket_pagos").update({ coste_stripe: Math.round(fee) / 100 }).eq("pedido_id", pedido); } catch { /* nada */ } }
        break;
      }
      case "checkout.session.expired":
      case "checkout.session.async_payment_failed": {
        const pedido = o?.metadata?.pedido;
        if (pedido) await admin.rpc("pago_caducar", { p_pedido: pedido });
        break;
      }
      case "account.updated": {
        const recibe = o?.capabilities?.transfers === "active", retira = !!o?.payouts_enabled;
        const ext = o?.external_accounts?.data?.[0];
        await admin.from("ticket_pago_cuentas").update({
          estado: recibe && retira ? "activa" : o?.details_submitted ? "revision" : "pendiente", recibe, retira,
          ...(ext?.last4 ? { banco: `${ext.country || ""}·· ${ext.last4}` } : {}), actualizado_en: new Date().toISOString(),
        }).eq("stripe_id", o.id);
        break;
      }
      case "payout.paid": case "payout.failed": case "payout.canceled": {
        const estado = ev.type === "payout.paid" ? "pagada" : ev.type === "payout.failed" ? "fallida" : "cancelada";
        await admin.from("ticket_retiradas").update({ estado }).eq("stripe_id", o.id);
        break;
      }
    }
    try { await admin.from("ticket_web_pagos_avisos").insert({ id: ev.id, proveedor: "stripe", tipo: ev.type, datos: { objeto: o.id, cuenta: ev.account || null } }); } catch { /* solo registro */ }
    return ok();
  } catch (e) {
    console.error(ev.type, (e as Error).message);
    return ok({ motivo: "error" }, 500);   // Stripe lo reintentará
  }
});

// TIXFAST · acciones del panel de administración que necesitan el servidor
//   baja_stripe { cuenta, cuando: "final" | "ya" } → cancela la suscripción en Stripe
//   bloquear    { cuenta, bloquear: true | false } → impide (o vuelve a permitir) entrar en la cuenta
// Solo para administradores de TIXFAST (tabla ticket_superadmins). Todo queda en ticket_admin_registro.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SK = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function stripe(metodo: "POST" | "DELETE", ruta: string, params: Record<string, string> = {}) {
  const r = await fetch(`https://api.stripe.com/v1/${ruta}`, { method: metodo, headers: { Authorization: `Bearer ${SK}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() });
  const d = await r.json(); if (!r.ok) throw new Error(d?.error?.message || `Stripe ${r.status}`); return d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, motivo: "metodo" }, 405);
  let b: any = {};
  try { b = await req.json(); } catch { /* vacío */ }
  try {
    const t = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = t && !t.startsWith("sb_") ? await admin.auth.getUser(t) : { data: null };
    if (!u?.user) return json({ ok: false, motivo: "sesion" }, 401);
    const { data: sa } = await admin.from("ticket_superadmins").select("user_id").eq("user_id", u.user.id).maybeSingle();
    if (!sa) return json({ ok: false, motivo: "permiso" }, 403);
    const cuenta = String(b.cuenta || "");
    if (!UUID.test(cuenta)) return json({ ok: false, motivo: "cuenta" }, 400);
    const registrar = (accion: string, detalle: Record<string, unknown>) => admin.from("ticket_admin_registro").insert({ admin_id: u.user.id, cuenta_id: cuenta, accion, detalle });

    if (b.accion === "baja_stripe") {
      if (!SK) return json({ ok: false, motivo: "sin_pasarela" });
      const { data: c } = await admin.from("ticket_cuentas").select("suscripcion_pago_id").eq("owner_id", cuenta).maybeSingle();
      if (!c?.suscripcion_pago_id) return json({ ok: false, motivo: "sin_suscripcion" });
      const ya = b.cuando === "ya";
      if (ya) await stripe("DELETE", `subscriptions/${c.suscripcion_pago_id}`);
      else await stripe("POST", `subscriptions/${c.suscripcion_pago_id}`, { cancel_at_period_end: "true" });
      await registrar(ya ? "baja_stripe_inmediata" : "baja_stripe_fin_periodo", {});
      return json({ ok: true });   // el aviso de Stripe actualiza la ficha
    }
    if (b.accion === "bloquear") {
      if (cuenta === u.user.id) return json({ ok: false, motivo: "propia" });
      const bloquear = !!b.bloquear;
      const { error } = await admin.auth.admin.updateUserById(cuenta, { ban_duration: bloquear ? "876000h" : "none" });
      if (error) throw error;
      await registrar(bloquear ? "bloquear_acceso" : "desbloquear_acceso", {});
      return json({ ok: true });
    }
    return json({ ok: false, motivo: "accion" }, 400);
  } catch (e) {
    console.error(b?.accion, (e as Error).message);
    try { await admin.from("ticket_errores").insert({ owner_id: null, origen: "admin-plataforma", mensaje: String((e as Error).message).slice(0, 500) }); } catch { /* nada */ }
    return json({ ok: false, motivo: "error" }, 500);
  }
});

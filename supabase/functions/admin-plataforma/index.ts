// TIXFAST · acciones del panel de administración que necesitan el servidor
//   baja_stripe { cuenta, cuando: "final" | "ya" } → cancela la suscripción en Stripe
//   bloquear    { cuenta, bloquear: true | false } → impide (o vuelve a permitir) entrar en la cuenta
//   enviar_correo  { cuenta, tipo }               → envía ahora uno de los correos automáticos
//   descuento      { cuenta, pct, meses }         → aplica un descuento a su suscripción de Stripe
//   ampliar_prueba { cuenta, dias }               → alarga su prueba gratuita en Stripe
//   campana        { segmento, asunto, texto, boton, prueba } → correo a un grupo (o solo a ti, de prueba)
//   plan_stripe    { plan }                       → crea o actualiza en Stripe el producto y el precio del plan
//   estado_stripe                                 → ¿hay Stripe conectado? ¿en pruebas o real?
// Solo para administradores de TIXFAST (tabla ticket_superadmins). Todo queda en ticket_admin_registro.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { plantilla, enviar, sitio, bajaUrl } from "../_shared/correos.ts";
import { aplicarDescuento, stripe as stripeApi, sincronizarPlan } from "../_shared/stripe.ts";

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
    // Planes: conexión con Stripe
    if (b.accion === "estado_stripe") return json({ ok: true, conectado: !!SK, modo: SK.startsWith("sk_live_") || SK.startsWith("rk_live_") ? "real" : SK ? "pruebas" : null });
    if (b.accion === "plan_stripe") {
      if (!SK) return json({ ok: false, motivo: "sin_pasarela" });
      const plan = String(b.plan || "");
      if (!/^[a-z0-9_]{2,30}$/.test(plan)) return json({ ok: false, motivo: "plan" }, 400);
      const r = await sincronizarPlan(admin, plan);
      await admin.from("ticket_admin_registro").insert({ admin_id: u.user.id, accion: "plan_stripe", detalle: { plan, ...r } });
      return json({ ok: true, ...r });
    }
    // Campaña: no va a una cuenta concreta
    if (b.accion === "campana") {
      const asunto = String(b.asunto || "").trim().slice(0, 120), texto = String(b.texto || "").trim().slice(0, 4000);
      if (asunto.length < 3 || texto.length < 10) return json({ ok: false, motivo: "contenido" });
      const t = { comercial: true, asunto, titulo: asunto, texto: texto.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean),
        ...(b.boton ? { boton: { texto: String(b.boton).slice(0, 40), url: `${sitio()}/` } } : {}) };
      if (b.prueba) { await enviar(u.user.email!, t); return json({ ok: true, enviados: 1 }); }
      const { data: lista, error } = await admin.rpc("crecimiento_segmento", { p_segmento: String(b.segmento || "") });
      if (error) throw error;
      const clave = `campana-${String(b.id_campana || "").replace(/[^a-z0-9-]/gi, "").slice(0, 40) || Date.now()}`;
      let enviados = 0, fallos = 0;
      for (const d of (lista || []).slice(0, 300)) {   // tope por envío: si hay más, se vuelve a lanzar y sigue con los que faltan
        const { data: fila } = await admin.from("ticket_correos").insert({ owner_id: d.owner_id, email: d.email, tipo: "campana", clave, asunto }).select("id").maybeSingle();
        if (!fila) continue;
        try { await enviar(d.email, t, bajaUrl(d.baja_token)); await admin.from("ticket_correos").update({ estado: "enviado" }).eq("id", fila.id); enviados++; }
        catch (e) { await admin.from("ticket_correos").update({ estado: "error", error: String((e as Error).message).slice(0, 300) }).eq("id", fila.id); fallos++; }
      }
      await admin.from("ticket_admin_registro").insert({ admin_id: u.user.id, accion: "campana", detalle: { segmento: b.segmento, asunto, enviados, fallos } });
      return json({ ok: true, enviados, fallos, quedan: Math.max(0, (lista || []).length - 300) });
    }
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
    if (b.accion === "enviar_correo") {
      const [{ data: c }, { data: us }, { data: cfg }, { data: plan }] = await Promise.all([
        admin.from("ticket_cuentas").select("*").eq("owner_id", cuenta).single(), admin.auth.admin.getUserById(cuenta),
        admin.from("ticket_crecimiento_config").select("ajustes").eq("id", 1).single(), admin.from("ticket_planes").select("precio_mes").eq("publico", true).eq("archivado", false).eq("sistema", false).gt("precio_mes", 0).order("destacado", { ascending: false }).order("precio_mes").limit(1).maybeSingle()]);
      const email = us?.user?.email; if (!email) return json({ ok: false, motivo: "cuenta" });
      const tipo = String(b.tipo || "");
      const t = plantilla(tipo, { precio: plan?.precio_mes != null ? Number(plan.precio_mes) : null, config: cfg?.ajustes || {}, sitio: sitio(),
        datos: { prueba_hasta: c.prueba_hasta, dia: 0, ultimo: false, fin: c.periodo_fin } });
      if (!t) return json({ ok: false, motivo: "tipo" });
      if (t.comercial && !c.correos_promo) return json({ ok: false, motivo: "sin_promo" });
      const { data: fila } = await admin.from("ticket_correos").insert({ owner_id: cuenta, email, tipo, clave: `manual-${Date.now()}`, asunto: t.asunto }).select("id").single();
      try { await enviar(email, t, t.comercial ? bajaUrl(c.baja_token) : undefined); await admin.from("ticket_correos").update({ estado: "enviado" }).eq("id", fila.id); }
      catch (e) { await admin.from("ticket_correos").update({ estado: "error", error: String((e as Error).message).slice(0, 300) }).eq("id", fila.id); throw e; }
      await registrar("enviar_correo", { tipo });
      return json({ ok: true });
    }
    if (b.accion === "descuento" || b.accion === "ampliar_prueba") {
      if (!SK) return json({ ok: false, motivo: "sin_pasarela" });
      const { data: c } = await admin.from("ticket_cuentas").select("suscripcion_pago_id, estado, prueba_hasta").eq("owner_id", cuenta).maybeSingle();
      if (!c?.suscripcion_pago_id) return json({ ok: false, motivo: "sin_suscripcion" });
      if (b.accion === "descuento") {
        const pct = Math.round(Number(b.pct)), meses = Math.round(Number(b.meses));
        if (!(pct >= 1 && pct <= 100 && meses >= 1 && meses <= 12)) return json({ ok: false, motivo: "valores" });
        await aplicarDescuento(c.suscripcion_pago_id, pct, meses);
        await registrar("descuento", { pct, meses });
        return json({ ok: true });
      }
      const dias = Math.round(Number(b.dias));
      if (c.estado !== "prueba" || !c.prueba_hasta) return json({ ok: false, motivo: "no_prueba" });
      if (!(dias >= 1 && dias <= 60)) return json({ ok: false, motivo: "valores" });
      const fin = Math.floor(new Date(c.prueba_hasta).getTime() / 1000) + dias * 86400;
      await stripeApi("POST", `subscriptions/${c.suscripcion_pago_id}`, { trial_end: fin, proration_behavior: "none" });
      await registrar("ampliar_prueba", { dias });
      return json({ ok: true });
    }
    return json({ ok: false, motivo: "accion" }, 400);
  } catch (e) {
    console.error(b?.accion, (e as Error).message);
    try { await admin.from("ticket_errores").insert({ owner_id: null, origen: "admin-plataforma", mensaje: String((e as Error).message).slice(0, 500) }); } catch { /* nada */ }
    return json({ ok: false, motivo: "error" }, 500);
  }
});

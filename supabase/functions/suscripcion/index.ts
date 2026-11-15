// TIXFAST · suscripción de la plataforma (Stripe Billing)
// Acciones (cuerpo JSON { accion, origen }), todas con la sesión del usuario:
//   alta    → crea el pago de alta de la suscripción mensual con renovación automática
//             (7 días de prueba gratis la primera vez; la tarjeta se pide siempre) y devuelve la URL
//   portal  → abre el portal de Stripe para cambiar la tarjeta o ver facturas
//   cambiar_plan { plan } → sube (o baja) a cualquier plan contratable del panel (Stripe prorratea la diferencia)
//   retener → antes de irse: { opcion: "descuento" | "pausa" | "cancelar", motivo, comentario, meses }
//             la cancelación pasa siempre por aquí (con su motivo y una oferta), no por el portal
// La primera vez se preparan solos en Stripe el producto, el precio, el portal y el aviso (webhook);
// sus identificadores se guardan en la base de datos, nunca en el código.
// La clave secreta de Stripe solo vive aquí (secreto STRIPE_SECRET_KEY).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { aplicarDescuento, pausar, cupon, sincronizarPlan } from "../_shared/stripe.ts";

const SK = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const URL_SB = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const cents = (n: number) => Math.round(Number(n) * 100);

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
async function stripe(metodo: "GET" | "POST", ruta: string, params: Record<string, unknown> = {}, clave?: string) {
  const cuerpo = formulario(params).toString();
  const headers: Record<string, string> = { Authorization: `Bearer ${SK}`, "Content-Type": "application/x-www-form-urlencoded" };
  if (clave) headers["Idempotency-Key"] = clave;
  const r = await fetch(`https://api.stripe.com/v1/${ruta}${metodo === "GET" && cuerpo ? `?${cuerpo}` : ""}`, { method: metodo, headers, body: metodo === "POST" ? cuerpo : undefined });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || `Stripe ${r.status}`);
  return d;
}
// Solo se vuelve a páginas de TIXFAST: dominios propios, nunca uno que mande quien llama
const DOMINIOS = ["somostixfast.vercel.app", "tixfast.app"];
function origenValido(o: unknown) {
  try {
    const u = new URL(String(o));
    if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return u.origin;
    if (u.protocol !== "https:") return null;
    const extra = (Deno.env.get("SITE_URL") || "").trim();
    if (extra) { try { if (new URL(extra).hostname === u.hostname) return u.origin; } catch { /* nada */ } }
    if (DOMINIOS.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`))) return u.origin;
  } catch { /* nada */ }
  return null;
}
async function usuario(req: Request) {
  const t = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!t || t.startsWith("sb_")) return null;
  const { data } = await admin.auth.getUser(t);
  return data?.user ?? null;
}
const leer = async (clave: string) => (await admin.from("ticket_pago_config").select("valor").eq("clave", clave).maybeSingle()).data?.valor as string | undefined;
const guardar = (clave: string, valor: string) => admin.from("ticket_pago_config").upsert({ clave, valor, actualizado_en: new Date().toISOString() });

// ---------- Preparación (una sola vez, automática) ----------
async function prepararAviso() {
  if (await leer("webhook_suscripcion")) return;
  const w = await stripe("POST", "webhook_endpoints", {
    url: `${URL_SB}/functions/v1/suscripcion-stripe`, description: "TIXFAST · suscripciones",
    enabled_events: ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "customer.subscription.paused", "customer.subscription.resumed"],
  }, "tixfast-webhook-suscripcion-v1");
  if (w.secret) await guardar("webhook_suscripcion", w.secret);
}
// Precio mensual del plan en Stripe (se crea o se actualiza solo si el importe ha cambiado)
async function precioDe(plan: any) {
  if (plan.stripe_price_id && Number(plan.stripe_price_importe) === Number(plan.precio_mes)) return plan.stripe_price_id as string;
  return (await sincronizarPlan(admin, plan.id)).precio as string;
}
async function portalConfig() {
  const ya = await leer("portal_suscripcion_v2"); if (ya) return ya;
  const c = await stripe("POST", "billing_portal/configurations", {
    business_profile: { headline: "Gestiona tu suscripción a TIXFAST" },
    features: {
      invoice_history: { enabled: true }, payment_method_update: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ["email", "address", "tax_id"] },
      subscription_cancel: { enabled: false },   // se cancela desde la app, con motivo y oferta
    },
  }, "tixfast-portal-suscripcion-v2");
  await guardar("portal_suscripcion_v2", c.id); return c.id as string;
}
async function cliente(u: any, cuenta: any) {
  if (cuenta.cliente_pago_id) return cuenta.cliente_pago_id as string;
  const c = await stripe("POST", "customers", { email: u.email, metadata: { tixfast_cuenta: u.id } }, `tixfast-cliente-${u.id}`);
  await admin.from("ticket_cuentas").update({ cliente_pago_id: c.id, proveedor_pago: "stripe", actualizada_en: new Date().toISOString() }).eq("owner_id", u.id);
  return c.id as string;
}

// ---------- Acciones ----------
// Cualquier plan creado en el panel que se pueda contratar: público, con precio, ni del sistema ni archivado.
// Sin plan elegido: el destacado (o el más barato).
async function planContratable(id: unknown) {
  let pid = typeof id === "string" && /^[a-z0-9_]{2,30}$/.test(id) ? id : null;
  if (!pid) pid = (await admin.rpc("ticket_plan_por_defecto")).data as string || "pro";
  const { data: plan } = await admin.from("ticket_planes").select("*").eq("id", pid).maybeSingle();
  if (!plan || plan.sistema || plan.archivado || !plan.publico || plan.precio_mes == null || Number(plan.precio_mes) <= 0) return null;
  return plan;
}
async function alta(u: any, origen: string, oferta?: string, planId?: string) {
  const { data: cuenta } = await admin.from("ticket_cuentas").select("*").eq("owner_id", u.id).maybeSingle();
  if (!cuenta) return json({ ok: false, motivo: "sin_ficha" });
  if (cuenta.plan_id === "fundador") return json({ ok: false, motivo: "fundador" });
  if (["prueba", "activa", "impagada"].includes(cuenta.estado) && cuenta.suscripcion_pago_id) return json({ ok: false, motivo: "ya_suscrito" });
  const plan = await planContratable(planId);
  if (!plan) return json({ ok: false, motivo: "sin_precio" });
  await prepararAviso();
  const precio = await precioDe(plan);
  const cus = await cliente(u, cuenta);
  const diasPrueba = Math.max(0, Math.min(60, Number(plan.dias_prueba ?? 7)));
  const conPrueba = !cuenta.prueba_usada && diasPrueba > 0;
  // Oferta para volver (correo «recuperar»): solo a quien ya se fue y una sola vez
  let descuento: string | null = null;
  if (oferta === "recuperar" && !conPrueba && ["cancelada", "suspendida", "pendiente"].includes(cuenta.estado) && !cuenta.oferta_recuperar_usada) {
    const { data: cfg } = await admin.from("ticket_crecimiento_config").select("ajustes").eq("id", 1).maybeSingle();
    const o = cfg?.ajustes?.oferta_recuperar; if (o?.descuento > 0) descuento = await cupon(Number(o.descuento), Number(o.meses) || 1);
  }
  const s = await stripe("POST", "checkout/sessions", {
    mode: "subscription", locale: "es", customer: cus, client_reference_id: u.id,
    line_items: [{ price: precio, quantity: 1 }],
    payment_method_collection: "always",            // la tarjeta se pide siempre, también con prueba
    ...(descuento ? { discounts: [{ coupon: descuento }] } : { allow_promotion_codes: "true" }),
    subscription_data: {
      ...(conPrueba ? { trial_period_days: diasPrueba, trial_settings: { end_behavior: { missing_payment_method: "cancel" } } } : {}),
      metadata: { tixfast_cuenta: u.id, tixfast_plan: plan.id },
      description: `Suscripción mensual a ${plan.nombre} con renovación automática`,
    },
    custom_text: { submit: { message: conPrueba
      ? `Hoy no se cobra nada. Tras ${diasPrueba} días de prueba se cobrarán ${Number(plan.precio_mes).toFixed(2).replace(".", ",")} € cada mes, con renovación automática, hasta que canceles.`
      : `Se cobrarán ${Number(plan.precio_mes).toFixed(2).replace(".", ",")} € cada mes, con renovación automática, hasta que canceles.` } },
    metadata: { tixfast_cuenta: u.id, tixfast: "suscripcion" },
    success_url: `${origen}/?suscripcion=ok`,
    cancel_url: `${origen}/?suscripcion=cancelada`,
  }, `tixfast-alta-${u.id}-${descuento || "sin"}-${Math.floor(Date.now() / 600000)}`);
  if (descuento) await admin.from("ticket_cuentas").update({ oferta_recuperar_usada: true }).eq("owner_id", u.id);
  return json({ ok: true, url: s.url });
}
async function portal(u: any, origen: string) {
  const { data: cuenta } = await admin.from("ticket_cuentas").select("cliente_pago_id").eq("owner_id", u.id).maybeSingle();
  if (!cuenta?.cliente_pago_id) return json({ ok: false, motivo: "sin_cliente" });
  const s = await stripe("POST", "billing_portal/sessions", { customer: cuenta.cliente_pago_id, configuration: await portalConfig(), return_url: `${origen}/?suscripcion=portal`, locale: "es" });
  return json({ ok: true, url: s.url });
}

// Subir o bajar de nivel con la suscripción en marcha (Stripe cobra o abona la diferencia del mes)
async function cambiarPlan(u: any, b: any) {
  const { data: cuenta } = await admin.from("ticket_cuentas").select("*").eq("owner_id", u.id).maybeSingle();
  if (!cuenta?.suscripcion_pago_id || !["activa", "prueba"].includes(cuenta.estado)) return json({ ok: false, motivo: "sin_suscripcion" });
  const plan = await planContratable(b.plan);
  if (!plan || plan.id === cuenta.plan_id) return json({ ok: false, motivo: "sin_precio" });
  const precio = await precioDe(plan);
  const sub = await stripe("GET", `subscriptions/${cuenta.suscripcion_pago_id}`);
  const item = sub?.items?.data?.[0]?.id;
  if (!item) return json({ ok: false, motivo: "sin_suscripcion" });
  await stripe("POST", `subscriptions/${cuenta.suscripcion_pago_id}`, { items: [{ id: item, price: precio }], proration_behavior: "create_prorations",
    metadata: { tixfast_cuenta: u.id, tixfast_plan: plan.id } }, `tixfast-cambio-${u.id}-${plan.id}-${Math.floor(Date.now() / 600000)}`);
  await admin.from("ticket_cuentas").update({ plan_id: plan.id, actualizada_en: new Date().toISOString() }).eq("owner_id", u.id);
  return json({ ok: true, plan: plan.id });
}

const MOTIVOS_BAJA = ["caro", "temporada", "falta", "no_uso", "otro"];
async function retener(u: any, b: any) {
  const { data: cuenta } = await admin.from("ticket_cuentas").select("*").eq("owner_id", u.id).maybeSingle();
  if (!cuenta?.suscripcion_pago_id || !["activa", "prueba", "impagada"].includes(cuenta.estado)) return json({ ok: false, motivo: "sin_suscripcion" });
  const { data: cfg } = await admin.from("ticket_crecimiento_config").select("ajustes").eq("id", 1).maybeSingle();
  const aj = cfg?.ajustes || {};
  const motivo = MOTIVOS_BAJA.includes(b.motivo) ? b.motivo : "otro";
  const comentario = b.comentario ? String(b.comentario).slice(0, 500) : null;
  const apuntar = (resultado: string) => admin.from("ticket_bajas").insert({ owner_id: u.id, motivo, comentario, resultado });
  if (b.opcion === "descuento") {
    if (cuenta.oferta_retencion_usada) return json({ ok: false, motivo: "oferta_usada" });
    const o = aj.oferta_retencion || {}; if (!(o.descuento > 0)) return json({ ok: false, motivo: "sin_oferta" });
    await aplicarDescuento(cuenta.suscripcion_pago_id, Number(o.descuento), Number(o.meses) || 1);
    await admin.from("ticket_cuentas").update({ oferta_retencion_usada: true, cancela_al_final: false }).eq("owner_id", u.id);
    await apuntar("descuento");
    return json({ ok: true, descuento: o.descuento, meses: o.meses });
  }
  if (b.opcion === "pausa") {
    const max = Number(aj.pausa_max_meses) || 3; const meses = Math.max(1, Math.min(max, Math.round(Number(b.meses) || 1)));
    await pausar(cuenta.suscripcion_pago_id, meses);
    await apuntar("pausa");
    return json({ ok: true, meses });
  }
  if (b.opcion === "cancelar") {
    await stripe("POST", `subscriptions/${cuenta.suscripcion_pago_id}`, { cancel_at_period_end: "true" });
    await admin.from("ticket_cuentas").update({ cancela_al_final: true }).eq("owner_id", u.id);
    await apuntar("cancela");
    return json({ ok: true });
  }
  if (b.opcion === "reanudar") {   // se arrepiente: quita la cancelación o la pausa
    await stripe("POST", `subscriptions/${cuenta.suscripcion_pago_id}`, { cancel_at_period_end: "false", pause_collection: "" });
    await admin.from("ticket_cuentas").update({ cancela_al_final: false }).eq("owner_id", u.id);
    return json({ ok: true });
  }
  return json({ ok: false, motivo: "opcion" }, 400);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, motivo: "metodo" }, 405);
  let b: any = {};
  try { b = await req.json(); } catch { /* vacío */ }
  try {
    if (!SK) return json({ ok: false, motivo: "sin_pasarela" });
    const u = await usuario(req); if (!u) return json({ ok: false, motivo: "sesion" }, 401);
    const origen = origenValido(b.origen); if (!origen) return json({ ok: false, motivo: "origen" });
    if (b.accion === "alta") return await alta(u, origen, b.oferta, b.plan);
    if (b.accion === "cambiar_plan") return await cambiarPlan(u, b);
    if (b.accion === "retener") return await retener(u, b);
    if (b.accion === "portal") return await portal(u, origen);
    return json({ ok: false, motivo: "accion" }, 400);
  } catch (e) {
    console.error(b?.accion, (e as Error).message);
    try { await admin.from("ticket_errores").insert({ owner_id: null, origen: "suscripcion", mensaje: `${b?.accion}: ${(e as Error).message}`.slice(0, 500) }); } catch { /* nada */ }
    return json({ ok: false, motivo: "error" }, 500);
  }
});

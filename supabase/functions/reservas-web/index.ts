// TIXFAST · reserva online de reservados VIP (página pública /r/<token>)
//   reservar      { token, mesa, tarifa, botellas, cliente, personas, origen } → bloquea la mesa y devuelve el pago
//   confirmar     { acceso }        → al volver de Stripe: comprueba el pago y confirma la mesa
//   cancelar      { acceso }        → el cliente vuelve atrás sin pagar: la mesa se libera al momento
//   mantenimiento { clave }         → cada 5 minutos: confirma pagos hechos y libera mesas no pagadas
// El precio lo calcula la base de datos. El adelanto va directo al monedero del organizador
// (cuenta conectada de Stripe) y TIXFAST se queda los gastos de gestión.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { stripe } from "../_shared/stripe.ts";

const SK = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const MODO = SK.startsWith("sk_live") ? "real" : "pruebas";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cents = (n: number) => Math.round(Number(n) * 100);

function origenValido(o: unknown) {
  try {
    const u = new URL(String(o));
    if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return u.origin;
    if (u.protocol !== "https:") return null;
    const extra = (Deno.env.get("SITE_URL") || "").trim();
    if (extra) { try { if (new URL(extra).hostname === u.hostname) return u.origin; } catch { /* nada */ } }
    if (["somostixfast.vercel.app", "tixfast.app"].some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`))) return u.origin;
  } catch { /* nada */ }
  return null;
}
const pedidoPorAcceso = async (acceso: string) => UUID.test(acceso) ? (await admin.from("ticket_reserva_pedidos").select("*").eq("acceso", acceso).maybeSingle()).data : null;

// Mira en Stripe si el pago se hizo; si sí, confirma la mesa
async function revisar(p: any) {
  if (p.estado !== "pendiente") return p.estado;
  if (p.sesion_id && SK) {
    try {
      const s = await stripe("GET", `checkout/sessions/${p.sesion_id}`);
      if (s.payment_status === "paid") {
        const pi = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id ?? null;
        const { data } = await admin.rpc("reservas_confirmar", { p_pedido: p.id, p_sesion: s.id, p_pago: pi, p_importe: s.amount_total / 100 });
        return data?.ok ? "pagado" : (data?.motivo || "error");
      }
      if (new Date(p.caduca_en).getTime() < Date.now()) {
        if (s.status === "open") { try { await stripe("POST", `checkout/sessions/${p.sesion_id}/expire`); } catch { /* ya caducada */ } }
        await admin.rpc("reservas_liberar", { p_pedido: p.id, p_estado: "caducado" });
        return "caducado";
      }
      return "pendiente";
    } catch (e) { console.error("revisar", (e as Error).message); return "pendiente"; }
  }
  if (new Date(p.caduca_en).getTime() < Date.now()) { await admin.rpc("reservas_liberar", { p_pedido: p.id, p_estado: "caducado" }); return "caducado"; }
  return "pendiente";
}

async function reservar(b: any) {
  const origen = origenValido(b.origen); if (!origen) return json({ ok: false, motivo: "origen" });
  const token = String(b.token || ""), mesa = String(b.mesa || "");
  // Reserva hecha desde el portal de entradas del evento: al pagar o cancelar se vuelve allí
  const slug = /^[a-z0-9][a-z0-9-]{0,79}$/.test(String(b.slug || "")) ? String(b.slug) : "";
  if (!UUID.test(token) || !UUID.test(mesa)) return json({ ok: false, motivo: "datos" }, 400);
  const cliente = { nombre: String(b.cliente?.nombre || "").slice(0, 120), telefono: String(b.cliente?.telefono || "").slice(0, 40), email: String(b.cliente?.email || "").slice(0, 160) };
  const botellas = Array.isArray(b.botellas) ? b.botellas.slice(0, 40).map((x: any) => ({ bebida: String(x?.bebida || "").slice(0, 60), mezcla: String(x?.mezcla || "").slice(0, 60) })) : [];
  // ¿Hay forma de cobrar? (monedero del organizador activo en Stripe)
  const { data: w } = await admin.from("ticket_reservas_web").select("owner_id, adelanto_pct").eq("token", token).maybeSingle();
  if (!w) return json({ ok: false, motivo: "cerrada" });
  let destino: string | null = null;
  if (w.adelanto_pct > 0) {
    if (!SK) return json({ ok: false, motivo: "sin_pago" });
    const { data: c } = await admin.from("ticket_pago_cuentas").select("stripe_id").eq("user_id", w.owner_id).eq("tipo", "organizador").eq("modo", MODO).eq("estado", "activa").eq("recibe", true).maybeSingle();
    if (!c?.stripe_id) return json({ ok: false, motivo: "sin_pago" });
    destino = c.stripe_id;
  }
  const { data: r, error } = await admin.rpc("reservas_crear", { p_token: token, p_reservado: mesa, p_tarifa: String(b.tarifa || ""), p_botellas: botellas,
    p_cliente: cliente, p_personas: Number.isFinite(Number(b.personas)) ? Math.round(Number(b.personas)) : null, p_modo: MODO });
  if (error) throw error;
  if (!r?.ok) return json(r);
  const cobrar = cents(r.adelanto) + cents(r.gastos);
  if (cobrar <= 0) {   // sin adelanto: reserva confirmada al momento
    await admin.rpc("reservas_confirmar", { p_pedido: r.id, p_sesion: null, p_pago: null, p_importe: 0 });
    return json({ ok: true, acceso: r.acceso, pagado: true });
  }
  try {
    const caduca = Math.floor(new Date(r.caduca_en).getTime() / 1000) - 120;
    const s = await stripe("POST", "checkout/sessions", {
      mode: "payment", locale: "es", ...(r.email ? { customer_email: r.email } : {}), client_reference_id: r.id,
      line_items: [
        { quantity: 1, price_data: { currency: "eur", unit_amount: cents(r.adelanto), product_data: { name: `Adelanto reserva ${r.mesa} · ${r.evento}`.slice(0, 120) } } },
        ...(cents(r.gastos) > 0 ? [{ quantity: 1, price_data: { currency: "eur", unit_amount: cents(r.gastos), product_data: { name: "Gastos de gestión" } } }] : []),
      ],
      expires_at: Math.max(caduca, Math.floor(Date.now() / 1000) + 30 * 60 + 30),
      payment_intent_data: { application_fee_amount: cents(r.gastos), transfer_data: { destination: destino }, description: `Reserva ${r.codigo} · ${r.mesa} · ${r.evento}`.slice(0, 200),
        metadata: { tixfast: "reserva", pedido: r.id, codigo: r.codigo } },
      metadata: { tixfast: "reserva", reserva: r.id },
      success_url: `${origen}/r/${token}?reserva=${r.acceso}${slug ? `&e=${slug}` : ""}`,
      cancel_url: slug ? `${origen}/e/${slug}?reserva_cancelada=${r.acceso}#reservados` : `${origen}/r/${token}?cancelada=${r.acceso}`,
    }, `reserva-${r.id}`);
    await admin.from("ticket_reserva_pedidos").update({ sesion_id: s.id }).eq("id", r.id);
    return json({ ok: true, url: s.url, acceso: r.acceso });
  } catch (e) {
    await admin.rpc("reservas_liberar", { p_pedido: r.id, p_estado: "cancelado" });   // si Stripe falla, la mesa no se queda bloqueada
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, motivo: "metodo" }, 405);
  let b: any = {};
  try { b = await req.json(); } catch { /* vacío */ }
  try {
    switch (b.accion) {
      case "reservar": return await reservar(b);
      case "confirmar": {
        const p = await pedidoPorAcceso(String(b.acceso || "")); if (!p) return json({ ok: false, motivo: "no_existe" });
        return json({ ok: true, estado: await revisar(p) });
      }
      case "cancelar": {
        const p = await pedidoPorAcceso(String(b.acceso || "")); if (!p) return json({ ok: false, motivo: "no_existe" });
        const estado = await revisar(p);   // por si sí llegó a pagar
        if (estado === "pendiente") {
          if (p.sesion_id && SK) { try { await stripe("POST", `checkout/sessions/${p.sesion_id}/expire`); } catch { /* nada */ } }
          const fresco = await pedidoPorAcceso(p.acceso);
          if (fresco?.estado === "pendiente") await admin.rpc("reservas_liberar", { p_pedido: p.id, p_estado: "cancelado" });
          return json({ ok: true, estado: "cancelado" });
        }
        return json({ ok: true, estado });
      }
      case "mantenimiento": {
        const { data: k } = await admin.from("ticket_pago_config").select("valor").eq("clave", "cron_clave").maybeSingle();
        if (!k?.valor || b.clave !== k.valor) return json({ ok: false, motivo: "clave" }, 403);
        const { data: ps } = await admin.from("ticket_reserva_pedidos").select("*").eq("estado", "pendiente").order("creado_en").limit(100);
        const res: Record<string, number> = {};
        for (const p of ps || []) { const e = await revisar(p); res[e] = (res[e] || 0) + 1; }
        return json({ ok: true, ...res });
      }
      default: return json({ ok: false, motivo: "accion" }, 400);
    }
  } catch (e) {
    console.error(b?.accion, (e as Error).message);
    try { await admin.from("ticket_errores").insert({ owner_id: null, origen: "reservas-web", mensaje: `${b?.accion}: ${(e as Error).message}`.slice(0, 500) }); } catch { /* nada */ }
    return json({ ok: false, motivo: "error" }, 500);
  }
});

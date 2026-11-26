// TIXFAST · pagos con Stripe Connect
// Un solo punto con varias acciones (cuerpo JSON { accion, ... }):
//   checkout   (público)      → crea el pago en Stripe de un pedido reservado y devuelve la URL de pago
//   confirmar  (público)      → al volver de Stripe, comprueba el pago y emite las entradas (si el aviso aún no llegó)
//   alta       (con sesión)   → crea el monedero (cuenta conectada) del RRPP u organizador y devuelve el enlace de alta de Stripe
//   monedero   (con sesión)   → estado del monedero, saldo real en Stripe, repartos y retiradas
//   retirar    (con sesión)   → pasa el saldo disponible del monedero a su banco
//   repartir   (tarea programada, con clave) → suelta reservas caducadas, reparte los eventos acabados (el organizador
//                                               sin esperar; los RRPP en cuanto tengan monedero) y emite la factura de la comisión
//   preparar   (con clave)    → da de alta en Stripe los avisos (webhooks) y guarda sus secretos
// La clave secreta de Stripe solo vive aquí (STRIPE_SECRET_KEY). Cada orden de dinero lleva clave única.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SK = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const MODO = SK.startsWith("sk_live") ? "real" : "pruebas";
const URL_SB = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const cents = (n: number) => Math.round(Number(n) * 100);
const eur = (c: number) => Math.round(c) / 100;

// ---------- Stripe (API REST, sin SDK) ----------
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
async function stripe(metodo: "GET" | "POST", ruta: string, params: Record<string, unknown> = {}, op: { cuenta?: string; clave?: string } = {}) {
  const cuerpo = formulario(params).toString();
  const url = `https://api.stripe.com/v1/${ruta}${metodo === "GET" && cuerpo ? `?${cuerpo}` : ""}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${SK}`, "Content-Type": "application/x-www-form-urlencoded" };
  if (op.cuenta) headers["Stripe-Account"] = op.cuenta;
  if (op.clave) headers["Idempotency-Key"] = op.clave;
  const r = await fetch(url, { method: metodo, headers, body: metodo === "POST" ? cuerpo : undefined });
  const d = await r.json();
  if (!r.ok) { const e = new Error(d?.error?.message || `Stripe ${r.status}`); (e as any).codigo = d?.error?.code; throw e; }
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
async function config(clave: string) {
  const { data } = await admin.from("ticket_pago_config").select("valor").eq("clave", clave).maybeSingle();
  return data?.valor as string | undefined;
}

// ---------- Pago de un pedido ----------
async function pagoPorAcceso(acceso: string) {
  if (!/^[0-9a-f-]{36}$/i.test(acceso)) return null;
  const { data: p } = await admin.from("ticket_web_pedidos").select("id, acceso, email, evento_id, estado").eq("acceso", acceso).maybeSingle();
  if (!p) return null;
  const { data: g } = await admin.from("ticket_pagos").select("*").eq("pedido_id", p.id).maybeSingle();
  return g ? { p, g } : null;
}
// Lo que cobra Stripe en un cargo (comisión de la pasarela). Solo para el informe de márgenes: si falla, no pasa nada.
async function guardarCosteStripe(pedido: string, cargo: string | null) {
  if (!cargo) return;
  try {
    const ch = await stripe("GET", `charges/${cargo}`, { expand: ["balance_transaction"] });
    const fee = ch?.balance_transaction?.fee;
    if (typeof fee === "number") await admin.from("ticket_pagos").update({ coste_stripe: eur(fee) }).eq("pedido_id", pedido);
  } catch { /* se reintenta al repartir */ }
}

async function emitirDesdeSesion(pedido: string, s: any) {
  if (s?.payment_status !== "paid") return { ok: false, motivo: "sin_pagar" };
  let cargo: string | null = null; let pi: string | null = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id ?? null;
  const piObj = typeof s.payment_intent === "object" && s.payment_intent ? s.payment_intent : pi ? await stripe("GET", `payment_intents/${pi}`) : null;
  cargo = typeof piObj?.latest_charge === "string" ? piObj.latest_charge : piObj?.latest_charge?.id ?? null;
  const { data, error } = await admin.rpc("pago_emitir", { p_pedido: pedido, p_sesion: s.id, p_pi: pi, p_cargo: cargo, p_importe: eur(s.amount_total) });
  if (error) throw error;
  await guardarCosteStripe(pedido, cargo);
  return data;
}

async function checkout(b: any) {
  const origen = origenValido(b.origen);
  if (!origen) return json({ ok: false, motivo: "origen" });
  const x = await pagoPorAcceso(String(b.acceso || ""));
  if (!x) return json({ ok: false, motivo: "no_existe" });
  const { p, g } = x;
  if (g.estado === "pagado") return json({ ok: true, pagado: true });
  if (g.estado !== "pendiente" || new Date(g.caduca_en).getTime() < Date.now() + 60e3) return json({ ok: false, motivo: "caducado" });
  if (g.modo !== MODO) return json({ ok: false, motivo: "modo" });
  // Si ya hay un pago abierto, se reutiliza
  if (g.sesion_id) {
    try { const s = await stripe("GET", `checkout/sessions/${g.sesion_id}`); if (s.status === "open" && s.url) return json({ ok: true, url: s.url }); if (s.payment_status === "paid") { await emitirDesdeSesion(g.pedido_id, s); return json({ ok: true, pagado: true }); } } catch { /* nueva sesión */ }
  }
  const { data: ev } = await admin.from("ticket_eventos").select("nombre").eq("id", g.evento_id).maybeSingle();
  const { data: web } = await admin.from("ticket_web_eventos").select("slug").eq("evento_id", g.evento_id).maybeSingle();
  const ids = [...new Set((g.asistentes as any[]).map((a) => a.tramo))];
  const { data: tramos } = await admin.from("ticket_web_tramos").select("id, nombre, precio").in("id", ids);
  const lineas: Record<string, unknown>[] = [];
  let suma = 0;
  for (const t of tramos || []) {
    const n = (g.asistentes as any[]).filter((a) => a.tramo === t.id).length;
    if (!n) continue;
    // Precio guardado al reservar (con el código descuento aplicado, si lo hay); si no, el de lista
    const guardado = (g.asistentes as any[]).find((a) => a.tramo === t.id && a.precio != null)?.precio;
    const unidad = cents(guardado != null ? Number(guardado) : t.precio);
    if (unidad <= 0) continue;
    suma += unidad * n;
    lineas.push({ quantity: n, price_data: { currency: "eur", unit_amount: unidad, product_data: { name: `${ev?.nombre || "Entrada"} · ${t.nombre}${guardado != null && cents(guardado) < cents(t.precio) ? " (con descuento)" : ""}` } } });
  }
  if (suma !== cents(g.entradas)) return json({ ok: false, motivo: "precio_cambiado" });
  if (cents(g.gastos) > 0) lineas.push({ quantity: 1, price_data: { currency: "eur", unit_amount: cents(g.gastos), product_data: { name: "Gastos de gestión" } } });
  const caduca = Math.min(Math.floor(new Date(g.caduca_en).getTime() / 1000) - 120, Math.floor(Date.now() / 1000) + 24 * 3600);
  const s = await stripe("POST", "checkout/sessions", {
    mode: "payment", locale: "es", line_items: lineas, customer_email: p.email, client_reference_id: g.pedido_id,
    expires_at: Math.max(caduca, Math.floor(Date.now() / 1000) + 30 * 60 + 30),
    metadata: { pedido: g.pedido_id, evento: g.evento_id, tixfast: "entradas" },
    payment_intent_data: { transfer_group: `ev_${g.evento_id}`, description: `Entradas ${ev?.nombre || ""}`.trim(), metadata: { pedido: g.pedido_id, evento: g.evento_id } },
    success_url: `${origen}/mis-entradas/${p.acceso}?nueva=1&pago={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origen}/e/${web?.slug || ""}?pago=cancelado`,
  }, { clave: `checkout-${g.pedido_id}-${Math.floor(Date.now() / 600000)}` });
  await admin.from("ticket_pagos").update({ sesion_id: s.id }).eq("pedido_id", g.pedido_id);
  return json({ ok: true, url: s.url });
}

async function confirmar(b: any) {
  const x = await pagoPorAcceso(String(b.acceso || ""));
  if (!x) return json({ ok: false, motivo: "no_existe" });
  const { g } = x;
  if (g.estado === "pagado") return json({ ok: true, estado: "pagado" });
  if (!g.sesion_id) return json({ ok: true, estado: g.estado });
  const s = await stripe("GET", `checkout/sessions/${g.sesion_id}`, { expand: ["payment_intent"] });
  if (s.payment_status === "paid") { const r = await emitirDesdeSesion(g.pedido_id, s); return json({ ok: !!r?.ok, estado: r?.ok ? "pagado" : "error", motivo: r?.motivo }); }
  return json({ ok: true, estado: s.status === "expired" ? "caducado" : "pendiente" });
}

// ---------- Monederos ----------
async function cuentaDe(uid: string, tipo: string) {
  const { data } = await admin.from("ticket_pago_cuentas").select("*").eq("user_id", uid).eq("tipo", tipo).eq("modo", MODO).maybeSingle();
  return data;
}
async function refrescar(c: any) {
  const a = await stripe("GET", `accounts/${c.stripe_id}`);
  const recibe = a?.capabilities?.transfers === "active";
  const retira = !!a?.payouts_enabled;
  const ext = a?.external_accounts?.data?.[0];
  const estado = recibe && retira ? "activa" : a?.details_submitted ? "revision" : "pendiente";
  const banco = ext?.last4 ? `${ext.country || ""}·· ${ext.last4}` : null;
  const { data } = await admin.from("ticket_pago_cuentas").update({ estado, recibe, retira, banco, actualizado_en: new Date().toISOString() }).eq("id", c.id).select("*").single();
  return { ...data, pendiente_alta: a?.requirements?.currently_due?.length || 0 };
}

async function alta(req: Request, b: any) {
  const u = await usuario(req); if (!u) return json({ ok: false, motivo: "sesion" }, 401);
  const tipo = b.tipo === "organizador" ? "organizador" : "rrpp";
  const origen = origenValido(b.origen); if (!origen) return json({ ok: false, motivo: "origen" });
  if (tipo === "rrpp") {
    const { data: pf } = await admin.from("ticket_rrpp_perfiles").select("user_id").eq("user_id", u.id).maybeSingle();
    if (!pf) return json({ ok: false, motivo: "perfil" });
  }
  let c = await cuentaDe(u.id, tipo);
  if (!c) {
    const a = await stripe("POST", "accounts", {
      country: "ES", email: u.email, ...(tipo === "rrpp" ? { business_type: "individual" } : {}),
      controller: { fees: { payer: "application" }, losses: { payments: "application" }, stripe_dashboard: { type: "express" }, requirement_collection: "stripe" },
      capabilities: { transfers: { requested: true } },
      tos_acceptance: { service_agreement: "recipient" },
      settings: { payouts: { schedule: { interval: "manual" } } },
      metadata: { tixfast_user: u.id, tixfast_tipo: tipo },
    }, { clave: `alta-${u.id}-${tipo}-${MODO}` });
    const { data, error } = await admin.from("ticket_pago_cuentas").insert({ user_id: u.id, tipo, modo: MODO, stripe_id: a.id }).select("*").single();
    if (error) { c = await cuentaDe(u.id, tipo); if (!c) throw error; } else c = data;
  }
  const ruta = tipo === "rrpp" ? "/rp" : "/";
  const enlace = await stripe("POST", "account_links", {
    account: c.stripe_id, type: "account_onboarding", collection_options: { fields: "currently_due" },
    refresh_url: `${origen}${ruta}?monedero=reintentar`, return_url: `${origen}${ruta}?monedero=vuelta`,
  });
  return json({ ok: true, url: enlace.url });
}

async function monedero(req: Request, b: any) {
  const u = await usuario(req); if (!u) return json({ ok: false, motivo: "sesion" }, 401);
  const tipo = b.tipo === "organizador" ? "organizador" : "rrpp";
  const repartosQ = admin.from("ticket_repartos").select("id, evento_id, importe, estado, detalle, beneficiario, creado_en, enviado_en, error").eq("modo", MODO).order("creado_en", { ascending: false }).limit(40);
  const { data: repartos } = tipo === "rrpp" ? await repartosQ.eq("user_id", u.id).eq("beneficiario", "rrpp") : await repartosQ.eq("owner_id", u.id);
  const evIds = [...new Set((repartos || []).map((r) => r.evento_id))];
  const { data: evs } = evIds.length ? await admin.from("ticket_eventos").select("id, nombre").in("id", evIds) : { data: [] };
  const nombre = Object.fromEntries((evs || []).map((e) => [e.id, e.nombre]));
  const lista = (repartos || []).map((r) => ({ ...r, evento: nombre[r.evento_id] || "Evento" }));
  let c = await cuentaDe(u.id, tipo);
  if (!c) return json({ ok: true, modo: MODO, cuenta: null, repartos: lista, retiradas: [] });
  try { c = await refrescar(c); } catch { /* se muestra lo guardado */ }
  let disponible = 0, pendiente = 0;
  try {
    const bal = await stripe("GET", "balance", {}, { cuenta: c.stripe_id });
    disponible = (bal.available || []).filter((x: any) => x.currency === "eur").reduce((s: number, x: any) => s + x.amount, 0);
    pendiente = (bal.pending || []).filter((x: any) => x.currency === "eur").reduce((s: number, x: any) => s + x.amount, 0);
  } catch { /* sin saldo aún */ }
  const { data: retiradas } = await admin.from("ticket_retiradas").select("id, importe, estado, llega_en, creado_en").eq("cuenta_id", c.id).order("creado_en", { ascending: false }).limit(20);
  return json({ ok: true, modo: MODO, cuenta: { estado: c.estado, recibe: c.recibe, retira: c.retira, banco: c.banco, pendiente_alta: c.pendiente_alta || 0 },
    saldo: { disponible: eur(disponible), en_camino: eur(pendiente) }, repartos: lista, retiradas: retiradas || [] });
}

async function retirar(req: Request, b: any) {
  const u = await usuario(req); if (!u) return json({ ok: false, motivo: "sesion" }, 401);
  const tipo = b.tipo === "organizador" ? "organizador" : "rrpp";
  const c = await cuentaDe(u.id, tipo);
  if (!c) return json({ ok: false, motivo: "sin_monedero" });
  const fresca = await refrescar(c);
  if (!fresca.retira) return json({ ok: false, motivo: "alta_incompleta" });
  const bal = await stripe("GET", "balance", {}, { cuenta: c.stripe_id });
  const disp = (bal.available || []).filter((x: any) => x.currency === "eur").reduce((s: number, x: any) => s + x.amount, 0);
  const pide = b.importe ? cents(b.importe) : disp;
  if (pide <= 0 || disp <= 0) return json({ ok: false, motivo: "sin_saldo" });
  if (pide > disp) return json({ ok: false, motivo: "supera", disponible: eur(disp) });
  const po = await stripe("POST", "payouts", { amount: pide, currency: "eur", description: "TIXFAST", metadata: { tixfast_user: u.id } },
    { cuenta: c.stripe_id, clave: `retirada-${c.id}-${pide}-${Math.floor(Date.now() / 60000)}` });
  const llega = po.arrival_date ? new Date(po.arrival_date * 1000).toISOString().slice(0, 10) : null;
  await admin.from("ticket_retiradas").upsert({ cuenta_id: c.id, user_id: u.id, importe: eur(pide), stripe_id: po.id, estado: "en_camino", llega_en: llega }, { onConflict: "stripe_id" });
  return json({ ok: true, importe: eur(pide), llega_en: llega });
}

// ---------- Reparto al acabar el evento ----------
async function transferir(reparto: any, destino: string, importe: number, capacidad: Map<string, number>, evento: string) {
  let falta = cents(importe); const hechas: any[] = [];
  for (const [cargo, libre] of capacidad) {
    if (falta <= 0) break;
    if (libre <= 0) continue;
    const n = Math.min(libre, falta);
    const tr = await stripe("POST", "transfers", {
      amount: n, currency: "eur", destination: destino, source_transaction: cargo, transfer_group: `ev_${evento}`,
      description: reparto.beneficiario === "rrpp" ? "Comisión RRPP · TIXFAST" : "Entradas · TIXFAST", metadata: { reparto: reparto.id, evento },
    }, { clave: `reparto-${reparto.id}-${cargo}` });
    hechas.push({ cargo, importe: eur(n), id: tr.id });
    capacidad.set(cargo, libre - n); falta -= n;
  }
  if (falta > 0) throw new Error(`Faltan ${eur(falta)} € por cubrir con los pagos del evento`);
  return hechas;
}
async function fila(clave: string, base: Record<string, unknown>) {
  const { data: ex } = await admin.from("ticket_repartos").select("*").eq("clave", clave).maybeSingle();
  if (ex && ["enviado", "nada", "liberado", "pagado_mano"].includes(ex.estado)) return { fila: ex, cerrada: true };
  if (ex && ex.estado === "preparado" && Date.now() - new Date(ex.creado_en).getTime() < 5 * 60e3) return { fila: ex, cerrada: true };
  if (ex) { const { data } = await admin.from("ticket_repartos").update({ ...base, error: null }).eq("id", ex.id).select("*").single(); return { fila: data, cerrada: false }; }
  const { data, error } = await admin.from("ticket_repartos").insert({ clave, ...base }).select("*").single();
  if (error) throw error;
  return { fila: data, cerrada: false };
}
// Días que se guarda la parte de un RRPP sin monedero antes de pasársela al organizador (que se la paga él)
const DIAS_RETENCION = 60;
const cuentaActiva = async (uid: string | null, tipo: string) => uid
  ? (await admin.from("ticket_pago_cuentas").select("*").eq("user_id", uid).eq("tipo", tipo).eq("modo", MODO).eq("estado", "activa").eq("recibe", true).maybeSingle()).data
  : null;

// Un pago al organizador (el principal del evento o el de una parte de RRPP que se le pasa)
async function pagarOrganizador(clave: string, evento: string, owner: string, importe: number, detalle: Record<string, unknown>, capacidad: Map<string, number>) {
  const cuentaOrg = await cuentaActiva(owner, "organizador");
  const estado = importe <= 0 ? "nada" : cuentaOrg ? "preparado" : "sin_monedero";
  const { fila: f, cerrada } = await fila(clave, { evento_id: evento, owner_id: owner, modo: MODO, beneficiario: "organizador", user_id: owner, cuenta_id: cuentaOrg?.id ?? null, importe, detalle, estado });
  if (cerrada || estado !== "preparado") return { estado: f.estado, importe: f.importe };
  try {
    const tr = await transferir(f, cuentaOrg.stripe_id, importe, capacidad, evento);
    await admin.from("ticket_repartos").update({ estado: "enviado", transferencias: tr, enviado_en: new Date().toISOString() }).eq("id", f.id);
    return { estado: "enviado", importe };
  } catch (e) {
    await admin.from("ticket_repartos").update({ estado: "error", error: String((e as Error).message).slice(0, 300) }).eq("id", f.id);
    return { estado: "error", error: (e as Error).message };
  }
}

// Reparto de un evento. El organizador cobra sin esperar a nadie: la parte de cada RRPP se queda guardada
// y se le manda en cuanto tenga monedero; si a los 60 días sigue sin él, se le pasa al organizador.
async function repartirEvento(evento: string, forzar = false) {
  const { data: calc, error } = await admin.rpc("pago_reparto_calculo", { p_evento: evento, p_modo: MODO });
  if (error) throw error;
  if (calc.pendientes > 0 && !forzar) return { evento, espera: "pagos_pendientes" };
  const { data: hechos } = await admin.from("ticket_repartos").select("transferencias").eq("evento_id", evento).eq("modo", MODO);
  const capacidad = new Map<string, number>((calc.cargos || []).map((c: any) => [c.cargo, cents(c.entradas)]));
  for (const h of hechos || []) for (const t of (h.transferencias || [])) if (capacidad.has(t.cargo)) capacidad.set(t.cargo, capacidad.get(t.cargo)! - cents(t.importe) + cents(t.revertido || 0));

  // 1) Organizador: lo disponible (entradas + gastos − comisión − devoluciones − comisión del efectivo) menos la parte de los RRPP
  const paraRRPP = (calc.rrpp || []).reduce((s: number, r: any) => s + cents(r.neto), 0);
  const resto = cents(calc.disponible) - paraRRPP;
  const org = await pagarOrganizador(`${MODO}:${evento}:organizador`, evento, calc.owner_id, eur(Math.max(resto, 0)), {
    cobrado: calc.cobrado, gastos: calc.gastos || 0, comision: calc.comision || 0, devuelto: calc.devuelto || 0,
    comision_efectivo: calc.comision_efectivo || 0, efectivo_entradas: calc.efectivo_entradas || 0, a_rrpp: eur(paraRRPP),
    deuda: eur(Math.max(-resto, 0)),   // si la comisión del efectivo o las devoluciones no caben en lo cobrado online
  }, capacidad);

  // 2) RRPP: cada uno lo suyo, en cuanto tenga monedero
  const res: any[] = [];
  for (const r of calc.rrpp || []) {
    const clave = `${MODO}:${evento}:rrpp:${r.rrpp_id}`;
    const detalle = { entradas: r.entradas, online: r.online, en_efectivo: r.en_efectivo, comision: r.comision, efectivo: r.efectivo, debe: r.debe, nombre: r.nombre };
    const cuenta = await cuentaActiva(r.user_id, "rrpp");
    const { data: previa } = await admin.from("ticket_repartos").select("id, estado, creado_en").eq("clave", clave).maybeSingle();
    // Lleva demasiado esperando (sin monedero o con errores): se le pasa al organizador, que se lo paga él
    const vieja = previa && ["sin_monedero", "error"].includes(previa.estado) && Date.now() - new Date(previa.creado_en).getTime() > DIAS_RETENCION * 864e5;
    if (r.neto > 0 && vieja && (!cuenta || previa.estado === "error")) {
      await admin.from("ticket_repartos").update({ estado: "liberado", detalle, error: null, enviado_en: new Date().toISOString() }).eq("id", previa.id);
      const lib = await pagarOrganizador(`${MODO}:${evento}:liberado:${r.rrpp_id}`, evento, calc.owner_id, r.neto, { motivo: "rrpp_sin_monedero", rrpp: r.nombre, rrpp_id: r.rrpp_id }, capacidad);
      res.push({ rrpp: r.nombre, estado: "liberado", al_organizador: lib.estado });
      continue;
    }
    const estado = r.neto <= 0 ? "nada" : cuenta ? "preparado" : "sin_monedero";
    const { fila: f, cerrada } = await fila(clave, { evento_id: evento, owner_id: calc.owner_id, modo: MODO, beneficiario: "rrpp", rrpp_id: r.rrpp_id, user_id: r.user_id, cuenta_id: cuenta?.id ?? null, importe: r.neto, detalle, estado });
    if (cerrada || estado !== "preparado") { res.push({ rrpp: r.nombre, estado: f.estado, importe: f.importe }); continue; }
    try {
      const tr = await transferir(f, cuenta.stripe_id, r.neto, capacidad, evento);
      await admin.from("ticket_repartos").update({ estado: "enviado", transferencias: tr, enviado_en: new Date().toISOString() }).eq("id", f.id);
      res.push({ rrpp: r.nombre, estado: "enviado", importe: r.neto });
    } catch (e) {
      await admin.from("ticket_repartos").update({ estado: "error", error: String((e as Error).message).slice(0, 300) }).eq("id", f.id);
      res.push({ rrpp: r.nombre, estado: "error", error: (e as Error).message });
    }
  }

  // 3) Liberaciones anteriores que aún no se pudieron mandar (el organizador no tenía monedero, errores…)
  const { data: libs } = await admin.from("ticket_repartos").select("clave, importe, detalle").eq("evento_id", evento).eq("modo", MODO).eq("beneficiario", "organizador").like("clave", `${MODO}:${evento}:liberado:%`).in("estado", ["sin_monedero", "error"]);
  for (const l of libs || []) await pagarOrganizador(l.clave, evento, calc.owner_id, Number(l.importe), l.detalle || {}, capacidad);

  // 4) Factura de la comisión (una vez por evento; espera si faltan datos fiscales)
  return { evento, organizador: org, rrpp: res, factura: await facturar(evento) };
}

// Factura de la comisión de TIXFAST al organizador (se le copia en Facturación › Gastos).
// Antes se completa lo que cobró Stripe en cada pago del evento, para el informe de márgenes.
async function facturar(evento: string) {
  try {
    const { data: sinCoste } = await admin.from("ticket_pagos").select("pedido_id, cargo_id").eq("evento_id", evento).eq("modo", MODO).eq("estado", "pagado").is("coste_stripe", null).limit(100);
    for (const g of sinCoste || []) await guardarCosteStripe(g.pedido_id, g.cargo_id);
    const { data, error } = await admin.rpc("plataforma_facturar_evento", { p_evento: evento, p_modo: MODO });
    if (error) throw error;
    return data;
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

async function repartir(b: any) {
  const salida: any = { modo: MODO, caducados: 0, emitidos: 0, eventos: [] };
  // 1) Reservas sin pagar: se comprueba en Stripe antes de soltarlas
  const { data: pend } = await admin.from("ticket_pagos").select("pedido_id, sesion_id").eq("estado", "pendiente").eq("modo", MODO).lt("caduca_en", new Date().toISOString()).limit(50);
  for (const g of pend || []) {
    try {
      if (g.sesion_id) {
        const s = await stripe("GET", `checkout/sessions/${g.sesion_id}`, { expand: ["payment_intent"] });
        if (s.payment_status === "paid") { await emitirDesdeSesion(g.pedido_id, s); salida.emitidos++; continue; }
        if (s.status === "open") { try { await stripe("POST", `checkout/sessions/${g.sesion_id}/expire`); } catch { /* ya caducada */ } }
      }
      await admin.rpc("pago_caducar", { p_pedido: g.pedido_id }); salida.caducados++;
    } catch (e) { salida.error_caducar = (e as Error).message; }
  }
  // 2) Eventos acabados (o uno concreto, para pruebas)
  let eventos: string[] = [];
  if (b.evento && b.ahora) eventos = [String(b.evento)];
  else { const { data } = await admin.rpc("pago_eventos_por_repartir", { p_modo: MODO }); eventos = (data || []).map((x: any) => typeof x === "string" ? x : Object.values(x)[0]); }
  for (const ev of eventos.slice(0, 20)) {
    try { salida.eventos.push(await repartirEvento(ev, !!b.ahora)); } catch (e) { salida.eventos.push({ evento: ev, error: (e as Error).message }); }
  }
  // 3) Facturas que esperaban datos fiscales (de TIXFAST o del organizador)
  try { const { data } = await admin.rpc("plataforma_facturas_reintentar"); salida.facturas_emitidas = data || 0; } catch { /* sin migración aún */ }
  return json({ ok: true, ...salida });
}

async function preparar(b: any) {
  const destino = `${URL_SB}/functions/v1/pagos-stripe`;
  const hecho: Record<string, string> = {};
  for (const [nombre, conectadas, eventos] of [
    ["webhook_plataforma", false, ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired", "charge.refunded"]],
    ["webhook_connect", true, ["account.updated", "payout.paid", "payout.failed", "payout.canceled"]],
  ] as [string, boolean, string[]][]) {
    const ya = await config(nombre);
    if (ya && !b.forzar) {
      // Ya existe: se asegura de que escucha todos los avisos (p. ej. las devoluciones, añadidas después)
      try {
        const lista = await stripe("GET", "webhook_endpoints", { limit: 100 });
        const w = (lista.data || []).find((x: any) => x.url === destino && (x.description || "").includes(nombre));
        if (w && eventos.some((e) => !(w.enabled_events || []).includes(e))) { await stripe("POST", `webhook_endpoints/${w.id}`, { enabled_events: eventos }); hecho[nombre] = "actualizado"; continue; }
      } catch { /* se deja como estaba */ }
      hecho[nombre] = "ya estaba"; continue;
    }
    const w = await stripe("POST", "webhook_endpoints", { url: destino, enabled_events: eventos, connect: conectadas ? "true" : undefined, description: `TIXFAST · ${nombre}` });
    await admin.from("ticket_pago_config").upsert({ clave: nombre, valor: w.secret, actualizado_en: new Date().toISOString() });
    hecho[nombre] = w.id;
  }
  return json({ ok: true, modo: MODO, hecho });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, motivo: "metodo" }, 405);
  let b: any = {};
  try { b = await req.json(); } catch { /* vacío */ }
  try {
    if (!SK) return json({ ok: false, motivo: "sin_pasarela" });
    switch (b.accion) {
      case "checkout": return await checkout(b);
      case "confirmar": return await confirmar(b);
      case "alta": return await alta(req, b);
      case "monedero": return await monedero(req, b);
      case "retirar": return await retirar(req, b);
      case "repartir": case "preparar": {
        const clave = await config("cron_clave");
        if (!clave || b.clave !== clave) return json({ ok: false, motivo: "clave" }, 403);
        return b.accion === "repartir" ? await repartir(b) : await preparar(b);
      }
      default: return json({ ok: false, motivo: "accion" }, 400);
    }
  } catch (e) {
    // El detalle se queda en el registro de errores: al navegador solo va el motivo
    console.error(b?.accion, (e as Error).message);
    try { await admin.from("ticket_errores").insert({ owner_id: null, origen: "pagos", mensaje: `${b?.accion || "?"}: ${(e as Error).message}`.slice(0, 500) }); } catch { /* nada */ }
    return json({ ok: false, motivo: "error" }, 500);
  }
});

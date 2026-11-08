// TIXFAST · envío por correo de las entradas compradas online
// Lo llama la página pública justo después de comprar (y el botón «Enviar a mi correo»).
// No necesita sesión: el «acceso» del pedido es el secreto. Límite: 3 envíos por pedido, 1 cada 2 minutos.
// Proveedor: Brevo. La clave vive como secreto de la función (BREVO_API_KEY); si no está, no se envía nada.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Solo se enlaza a dominios de la app (nunca a uno que mande quien llama)
const ORIGEN_OK = /^https:\/\/([a-z0-9-]+\.)*(vercel\.app|tixfast\.app)$/i;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
// «inicio» se guarda como hora local sin zona (2026-12-12T23:30): se muestra tal cual (UTC = sin desplazar)
const fecha = (v: string | null) => { if (!v) return ""; const local = v.length <= 16; const d = new Date(local ? v + (v.length <= 10 ? "T12:00" : "") + "Z" : v); if (isNaN(+d)) return ""; return d.toLocaleString("es-ES", { weekday: "long", day: "numeric", month: "long", hour: v.length > 10 ? "2-digit" : undefined, minute: v.length > 10 ? "2-digit" : undefined, timeZone: local ? "UTC" : "Europe/Madrid" }); };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, motivo: "metodo" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const compra = String(body?.compra || "");
    const acceso = String(body?.acceso || "");
    if (compra ? !UUID.test(compra) : !UUID.test(acceso)) return json({ ok: false, motivo: "acceso" }, 400);
    const clave = Deno.env.get("BREVO_API_KEY");
    if (!clave) return json({ ok: false, motivo: "sin_correo" });   // aún sin configurar: la compra sigue bien

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    if (compra) return await enviarCompra(admin, compra, body, clave);
    const { data: p } = await admin.from("ticket_web_pedidos").select("id, evento_id, codigo, nombre, email, prueba, email_envios, email_ultimo").eq("acceso", acceso).maybeSingle();
    if (!p) return json({ ok: false, motivo: "no_existe" }, 404);
    if (p.email_envios >= 3) return json({ ok: false, motivo: "limite" });
    if (p.email_ultimo && Date.now() - new Date(p.email_ultimo).getTime() < 120000) return json({ ok: false, motivo: "espera" });
    // se apunta ANTES de enviar: dos llamadas a la vez no mandan dos correos
    const { data: marcado } = await admin.from("ticket_web_pedidos").update({ email_envios: p.email_envios + 1, email_ultimo: new Date().toISOString() })
      .eq("id", p.id).eq("email_envios", p.email_envios).select("id").maybeSingle();
    if (!marcado) return json({ ok: false, motivo: "espera" });

    const [{ data: e }, { data: f }, { data: xs }] = await Promise.all([
      admin.from("ticket_eventos").select("nombre, inicio, fecha, recinto").eq("id", p.evento_id).single(),
      admin.from("ticket_web_eventos").select("direccion, flyer_url, diseno, slug").eq("evento_id", p.evento_id).single(),
      admin.from("ticket_web_entradas").select("numero, asistente, tramo_nombre, estado").eq("pedido_id", p.id).order("numero"),
    ]);
    const origen = ORIGEN_OK.test(String(body?.origen || "")) ? String(body.origen) : (Deno.env.get("SITE_URL") || "https://www.tixfast.app");
    const enlace = `${origen}/mis-entradas/${acceso}`;
    const color = /^#[0-9a-f]{6}$/i.test(f?.diseno?.color || "") ? f.diseno.color : "#ff5a3c";
    const validas = (xs || []).filter((x: any) => x.estado === "valida");
    const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#15171a">
<div style="max-width:560px;margin:0 auto;padding:24px 14px">
  <div style="background:#fff;border-radius:18px;overflow:hidden;border:1px solid #e6e8eb">
    ${f?.flyer_url ? `<img src="${esc(f.flyer_url)}" alt="" style="display:block;width:100%;max-height:340px;object-fit:cover;background:#0b0c10">` : ""}
    <div style="padding:22px">
      ${p.prueba ? `<div style="background:#ffb400;color:#1a1205;border-radius:10px;padding:8px 12px;font-weight:800;margin-bottom:14px">Entradas de PRUEBA: no son válidas para entrar.</div>` : ""}
      <div style="font-size:14px;color:#6f747d;font-weight:700">¡Hola, ${esc(p.nombre.split(" ")[0])}! Ya tienes tus entradas para</div>
      <div style="font-size:28px;font-weight:900;line-height:1.1;margin:6px 0 8px">${esc(e?.nombre)}</div>
      <div style="font-size:15px;color:#3b4048">${esc(fecha(e?.inicio || e?.fecha))}${e?.recinto ? ` · ${esc(e.recinto)}` : ""}${f?.direccion ? `<br>${esc(f.direccion)}` : ""}</div>
      <div style="margin:18px 0;border-top:1px solid #e6e8eb"></div>
      ${validas.map((x: any) => `<div style="padding:6px 0;font-size:15px"><b>${esc(x.asistente)}</b> · ${esc(x.tramo_nombre)} · nº ${String(x.numero).padStart(4, "0")}</div>`).join("")}
      <a href="${esc(enlace)}" style="display:block;text-align:center;background:${color};color:#fff;text-decoration:none;font-weight:900;font-size:17px;padding:16px;border-radius:14px;margin-top:18px">Ver mis entradas y el QR</a>
      <div style="font-size:13px;color:#6f747d;margin-top:14px;line-height:1.5">Desde ese enlace puedes descargar el PDF. Las entradas son nominativas y de un solo uso: no compartas el QR. Pedido <b>${esc(p.codigo)}</b>.</div>
    </div>
  </div>
  <div style="text-align:center;font-size:12px;color:#8c929b;margin-top:14px">Entradas con TIXFAST</div>
</div></body></html>`;

    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": clave, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        sender: { email: Deno.env.get("CORREO_REMITENTE") || "impaktadigital.info@gmail.com", name: String(e?.nombre || "TIXFAST").slice(0, 60) },
        to: [{ email: p.email, name: p.nombre }],
        subject: `${p.prueba ? "[PRUEBA] " : ""}Tus entradas · ${e?.nombre || "evento"}`,
        htmlContent: html,
        textContent: `Ya tienes tus entradas para ${e?.nombre}. Míralas y descarga el PDF aquí: ${enlace}`,
      }),
    });
    if (!res.ok) {
      const t = (await res.text().catch(() => "")).slice(0, 200);
      await admin.from("ticket_web_pedidos").update({ email_error: `Brevo ${res.status}: ${t}` }).eq("id", p.id);
      return json({ ok: false, motivo: "proveedor" });
    }
    await admin.from("ticket_web_pedidos").update({ email_error: null }).eq("id", p.id);
    return json({ ok: true });
  } catch (_e) {
    return json({ ok: false, motivo: "error" }, 500);
  }
});

// Compra de varios eventos: un solo correo con todas las entradas y un enlace a «Mis entradas» de la compra
async function enviarCompra(admin: any, acceso: string, body: any, clave: string) {
  const { data: c } = await admin.from("ticket_web_compras").select("id, codigo, nombre, email, prueba, email_envios, email_ultimo, organizacion_id").eq("acceso", acceso).maybeSingle();
  if (!c) return json({ ok: false, motivo: "no_existe" }, 404);
  if (c.email_envios >= 3) return json({ ok: false, motivo: "limite" });
  if (c.email_ultimo && Date.now() - new Date(c.email_ultimo).getTime() < 120000) return json({ ok: false, motivo: "espera" });
  const { data: marcado } = await admin.from("ticket_web_compras").update({ email_envios: c.email_envios + 1, email_ultimo: new Date().toISOString() })
    .eq("id", c.id).eq("email_envios", c.email_envios).select("id").maybeSingle();
  if (!marcado) return json({ ok: false, motivo: "espera" });

  const [{ data: o }, { data: ps }] = await Promise.all([
    c.organizacion_id ? admin.from("ticket_web_organizaciones").select("nombre, logo_url, diseno").eq("id", c.organizacion_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("ticket_web_pedidos").select("id, evento_id").eq("compra_id", c.id),
  ]);
  const bloques: string[] = [];
  for (const p of (ps || [])) {
    const [{ data: e }, { data: f }, { data: xs }] = await Promise.all([
      admin.from("ticket_eventos").select("nombre, inicio, fecha, recinto").eq("id", p.evento_id).single(),
      admin.from("ticket_web_eventos").select("direccion, flyer_url").eq("evento_id", p.evento_id).single(),
      admin.from("ticket_web_entradas").select("numero, asistente, tramo_nombre, estado").eq("pedido_id", p.id).order("numero"),
    ]);
    const validas = (xs || []).filter((x: any) => x.estado === "valida");
    bloques.push(`<div style="padding:16px 0;border-top:1px solid #e6e8eb;display:flex;gap:14px">
      ${f?.flyer_url ? `<img src="${esc(f.flyer_url)}" alt="" width="72" height="72" style="width:72px;height:72px;object-fit:cover;border-radius:12px">` : ""}
      <div><div style="font-size:19px;font-weight:900;line-height:1.2">${esc(e?.nombre)}</div>
      <div style="font-size:14px;color:#3b4048;margin:2px 0 6px">${esc(fecha(e?.inicio || e?.fecha))}${e?.recinto ? ` · ${esc(e.recinto)}` : ""}</div>
      ${validas.map((x: any) => `<div style="font-size:14px;padding:2px 0"><b>${esc(x.asistente)}</b> · ${esc(x.tramo_nombre)} · nº ${String(x.numero).padStart(4, "0")}</div>`).join("")}</div></div>`);
  }
  const origen = ORIGEN_OK.test(String(body?.origen || "")) ? String(body.origen) : (Deno.env.get("SITE_URL") || "https://www.tixfast.app");
  const enlace = `${origen}/compra/${acceso}`;
  const color = /^#[0-9a-f]{6}$/i.test(o?.diseno?.color || "") ? o.diseno.color : "#ff5a3c";
  const remitente = String(o?.nombre || "TIXFAST").slice(0, 60);
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#15171a">
<div style="max-width:560px;margin:0 auto;padding:24px 14px"><div style="background:#fff;border-radius:18px;overflow:hidden;border:1px solid #e6e8eb"><div style="padding:22px">
  ${o?.logo_url ? `<img src="${esc(o.logo_url)}" alt="${esc(o.nombre)}" style="max-height:44px;max-width:180px;margin-bottom:14px">` : ""}
  ${c.prueba ? `<div style="background:#ffb400;color:#1a1205;border-radius:10px;padding:8px 12px;font-weight:800;margin-bottom:14px">Entradas de PRUEBA: no son válidas para entrar.</div>` : ""}
  <div style="font-size:24px;font-weight:900;line-height:1.15">¡Hola, ${esc(String(c.nombre).split(" ")[0])}! Ya tienes tus entradas</div>
  <div style="font-size:14px;color:#6f747d;margin-top:6px">${(ps || []).length > 1 ? `${(ps || []).length} eventos en una sola compra.` : ""} Compra <b>${esc(c.codigo)}</b>.</div>
  <div style="margin-top:12px">${bloques.join("")}</div>
  <a href="${esc(enlace)}" style="display:block;text-align:center;background:${color};color:#fff;text-decoration:none;font-weight:900;font-size:17px;padding:16px;border-radius:14px;margin-top:10px">Ver mis entradas y los QR</a>
  <div style="font-size:13px;color:#6f747d;margin-top:14px;line-height:1.5">Desde ese enlace puedes descargar el PDF de cada evento. Las entradas son nominativas y de un solo uso: no compartas los QR.</div>
</div></div><div style="text-align:center;font-size:12px;color:#8c929b;margin-top:14px">Entradas con TIXFAST</div></div></body></html>`;
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST", headers: { "api-key": clave, "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ sender: { email: Deno.env.get("CORREO_REMITENTE") || "impaktadigital.info@gmail.com", name: remitente }, to: [{ email: c.email, name: c.nombre }],
      subject: `${c.prueba ? "[PRUEBA] " : ""}Tus entradas · ${remitente}`, htmlContent: html, textContent: `Ya tienes tus entradas. Míralas aquí: ${enlace}` }),
  });
  if (!res.ok) {
    const t = (await res.text().catch(() => "")).slice(0, 200);
    await admin.from("ticket_web_compras").update({ email_error: `Brevo ${res.status}: ${t}` }).eq("id", c.id);
    return json({ ok: false, motivo: "proveedor" });
  }
  await admin.from("ticket_web_compras").update({ email_error: null }).eq("id", c.id);
  return json({ ok: true });
}

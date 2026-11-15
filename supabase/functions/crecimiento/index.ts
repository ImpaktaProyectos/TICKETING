// TIXFAST · crecimiento y retención automáticos
//   POST { accion: "ejecutar", clave }  (tarea programada cada hora) → envía los correos que tocan
//   GET  ?baja=<token>                  (enlace del correo)          → deja de enviar correos comerciales
// Cada correo se apunta ANTES de enviarlo (ticket_correos, único por cuenta+tipo+clave):
// aunque la tarea se ejecute dos veces a la vez, nadie recibe un correo repetido.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { plantilla, enviar, sitio, bajaUrl } from "../_shared/correos.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const pagina = (titulo: string, texto: string) => new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>TIXFAST</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0c10;color:#eceef5;font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;box-sizing:border-box">
<div style="max-width:420px;text-align:center"><div style="font-weight:900;color:#ff5a3c;letter-spacing:1px">TIXFAST</div><h1 style="font-size:24px">${titulo}</h1><p style="color:#838aa0;line-height:1.5">${texto}</p></div></body></html>`,
  { headers: { "Content-Type": "text/html; charset=utf-8" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ejecutar() {
  if (!sitio()) throw new Error("Falta SITE_URL");
  const [{ data: cand, error }, { data: cfg }, { data: plan }] = await Promise.all([
    admin.rpc("crecimiento_candidatos"),
    admin.from("ticket_crecimiento_config").select("ajustes").eq("id", 1).single(),
    admin.from("ticket_planes").select("precio_mes").eq("id", "pro").single(),
  ]);
  if (error) throw error;
  const config = cfg?.ajustes || {};
  const res = { enviados: 0, saltados: 0, errores: 0 };
  for (const c of (cand || []).slice(0, 150)) {
    const t = plantilla(c.tipo, { precio: plan?.precio_mes != null ? Number(plan.precio_mes) : null, datos: c.datos || {}, config, sitio: sitio() });
    if (!t) continue;
    const asunto = config?.secuencias?.[c.tipo]?.asunto || t.asunto;
    // Se apunta primero: si ya estaba, no se repite
    const { data: fila, error: e1 } = await admin.from("ticket_correos").insert({ owner_id: c.owner_id, email: c.email, tipo: c.tipo, clave: c.clave, asunto }).select("id").maybeSingle();
    if (e1 || !fila) { res.saltados++; continue; }
    try {
      let baja: string | undefined;
      if (t.comercial) { const { data: k } = await admin.from("ticket_cuentas").select("baja_token").eq("owner_id", c.owner_id).single(); baja = bajaUrl(k.baja_token); }
      await enviar(c.email, { ...t, asunto }, baja);
      await admin.from("ticket_correos").update({ estado: "enviado" }).eq("id", fila.id);
      res.enviados++;
    } catch (e) {
      await admin.from("ticket_correos").update({ estado: "error", error: String((e as Error).message).slice(0, 300) }).eq("id", fila.id);
      res.errores++;
    }
  }
  return res;
}

Deno.serve(async (req) => {
  try {
    if (req.method === "GET") {
      const token = new URL(req.url).searchParams.get("baja") || "";
      if (!UUID.test(token)) return pagina("Enlace no válido", "Este enlace no es correcto o ha caducado.");
      await admin.from("ticket_cuentas").update({ correos_promo: false }).eq("baja_token", token);
      return pagina("Listo, ya no te escribiremos", "No recibirás más correos comerciales de TIXFAST. Los avisos importantes de tu suscripción (por ejemplo, si falla un cobro) te seguirán llegando.");
    }
    if (req.method !== "POST") return json({ ok: false }, 405);
    const b = await req.json().catch(() => ({}));
    if (b.accion !== "ejecutar") return json({ ok: false, motivo: "accion" }, 400);
    const { data: k } = await admin.from("ticket_pago_config").select("valor").eq("clave", "cron_clave").maybeSingle();
    if (!k?.valor || b.clave !== k.valor) return json({ ok: false, motivo: "clave" }, 403);
    return json({ ok: true, ...(await ejecutar()) });
  } catch (e) {
    console.error((e as Error).message);
    try { await admin.from("ticket_errores").insert({ owner_id: null, origen: "crecimiento", mensaje: String((e as Error).message).slice(0, 500) }); } catch { /* nada */ }
    return json({ ok: false, motivo: "error" }, 500);
  }
});

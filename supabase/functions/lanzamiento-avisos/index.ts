// TIXFAST · «Avísame cuando abra» (lanzamientos con cuenta atrás)
//   POST { accion: "ejecutar", clave }  (tarea programada cada minuto, solo si hay avisos de un evento ya abierto)
// Cada aviso se marca como enviado ANTES de mandarlo (lanzamiento_reclamar): aunque la tarea se solape, nadie lo recibe dos veces.
// Se envía por lotes (un correo por persona, en una sola llamada a Brevo por lote).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { html, sitio } from "../_shared/correos.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
type Fila = { aviso_id: string; email: string; evento: string; slug: string; flyer_url: string | null; color: string; organizador: string };

async function enviarLote(filas: Fila[]) {
  const clave = Deno.env.get("BREVO_API_KEY")!, remitente = Deno.env.get("CORREO_REMITENTE")!;
  const f = filas[0], url = `${sitio()}/e/${f.slug}`;
  const t = { asunto: `¡Ya a la venta! Entradas de ${f.evento}`.slice(0, 150), titulo: `Las entradas de ${f.evento} ya están a la venta`,
    texto: ["Nos pediste que te avisáramos y ya ha llegado el momento: la venta acaba de abrir.", "Entra cuanto antes: las primeras entradas suelen volar."],
    boton: { texto: "Comprar entradas", url }, nota: "Recibes este correo porque pediste que te avisáramos cuando abriera la venta. Solo te lo enviamos una vez.", comercial: false };
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST", headers: { "api-key": clave, "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({
      sender: { email: remitente, name: (f.organizador || f.evento || "TIXFAST").slice(0, 60) },
      subject: t.asunto, htmlContent: html(t), textContent: `${t.titulo}\n\n${t.texto.join("\n\n")}\n\n${t.boton.texto}: ${url}`,
      messageVersions: filas.map((x) => ({ to: [{ email: x.email }] })),
    }),
  });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
}

async function ejecutar() {
  // Sin correo configurado no se reclama nada: los avisos esperan hasta que lo esté
  if (!Deno.env.get("BREVO_API_KEY") || !Deno.env.get("CORREO_REMITENTE") || !sitio()) return { enviados: 0, motivo: "sin_correo" };
  const res = { enviados: 0, errores: 0 };
  for (let vuelta = 0; vuelta < 10; vuelta++) {             // hasta 10 lotes de 500 por minuto
    const { data, error } = await admin.rpc("lanzamiento_reclamar", { p_limite: 500 });
    if (error) throw error;
    const filas = (data || []) as Fila[];
    if (!filas.length) break;
    const porEvento = new Map<string, Fila[]>();
    for (const x of filas) porEvento.set(x.slug, [...(porEvento.get(x.slug) || []), x]);
    for (const grupo of porEvento.values()) {
      try { await enviarLote(grupo); res.enviados += grupo.length; }
      catch (e) {
        res.errores += grupo.length;
        await admin.from("ticket_web_avisos").update({ error: String((e as Error).message).slice(0, 300) }).in("id", grupo.map((x) => x.aviso_id));
      }
    }
  }
  return res;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ ok: false }, 405);
    const b = await req.json().catch(() => ({}));
    if (b.accion !== "ejecutar") return json({ ok: false, motivo: "accion" }, 400);
    const { data: k } = await admin.from("ticket_pago_config").select("valor").eq("clave", "cron_clave").maybeSingle();
    if (!k?.valor || b.clave !== k.valor) return json({ ok: false, motivo: "clave" }, 403);
    return json({ ok: true, ...(await ejecutar()) });
  } catch (e) {
    console.error((e as Error).message);
    try { await admin.from("ticket_errores").insert({ owner_id: null, origen: "lanzamiento-avisos", mensaje: String((e as Error).message).slice(0, 500) }); } catch { /* nada */ }
    return json({ ok: false, motivo: "error" }, 500);
  }
});

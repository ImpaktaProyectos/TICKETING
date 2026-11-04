// TIXFAST CRM · conexión con ticketeras (Fourvenues)
// La clave de la ticketera vive cifrada en Vault y solo se lee aquí, en el servidor.
// Todas las escrituras de datos se hacen con la sesión del usuario (respetan RLS).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const BASE: Record<string, string> = {
  prueba: "https://api-alpha.fourvenues.com/integrations",
  real: "https://api.fourvenues.com/integrations",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const lista = (r: any): any[] => Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : Array.isArray(r?.data?.items) ? r.data.items : Array.isArray(r?.items) ? r.items : [];

class Fallo extends Error {}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);
  try {
    const auth = req.headers.get("Authorization") || "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: u, error: ue } = await user.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
    if (ue || !u?.user) return json({ ok: false, error: "No autorizado" }, 401);
    const uid = u.user.id;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    const body = await req.json().catch(() => ({}));
    const accion = String(body?.accion || "");
    if (!["probar", "eventos", "sincronizar"].includes(accion)) return json({ ok: false, error: "Acción no válida" }, 400);

    const { data: k } = await admin.rpc("ticket_crm_leer_clave", { p_owner: uid, p_proveedor: "fourvenues" });
    const fila = Array.isArray(k) ? k[0] : k;
    if (!fila?.clave) return json({ ok: false, error: "Primero guarda la clave de Fourvenues en Ajustes." });
    const base = BASE[fila.entorno] || BASE.prueba;

    const marcar = (estado: string, err: string | null, sync = false) =>
      admin.from("ticket_crm_conexiones").update({ estado, ultimo_error: err ? err.slice(0, 300) : null, actualizado_en: new Date().toISOString(), ...(sync ? { ultima_sync: new Date().toISOString() } : {}) })
        .eq("owner_id", uid).eq("proveedor", "fourvenues");

    const fv = async (path: string, params: Record<string, string | number> = {}) => {
      const q = new URLSearchParams(Object.entries(params).map(([a, b]) => [a, String(b)]));
      for (let intento = 0; intento < 3; intento++) {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
        let res: Response;
        try { res = await fetch(`${base}${path}${q.toString() ? "?" + q : ""}`, { headers: { "x-api-key": fila.clave, "Accept": "application/json" }, signal: ctl.signal }); }
        catch { throw new Fallo("Fourvenues no responde. Inténtalo en unos minutos."); }
        finally { clearTimeout(t); }
        if (res.status === 429) { await sleep(1500 * (intento + 1)); continue; }
        if (res.status === 401 || res.status === 403) throw new Fallo("Fourvenues rechaza la clave (no válida, caducada o sin permiso para estos datos).");
        if (!res.ok) throw new Fallo(`Fourvenues ha respondido con un error (${res.status}).`);
        return await res.json().catch(() => { throw new Fallo("Respuesta de Fourvenues no válida."); });
      }
      throw new Fallo("Fourvenues está limitando las peticiones. Inténtalo en un minuto.");
    };

    try {
      if (accion === "probar") {
        await fv("/channels/");
        await marcar("ok", null);
        return json({ ok: true });
      }

      if (accion === "eventos") {
        const r = await fv("/events/", { limit: 100 });
        const eventos = lista(r).map((e: any) => ({
          id: String(e?._id ?? e?.id ?? ""),
          nombre: String(e?.name ?? e?.title ?? e?.slug ?? "Evento").slice(0, 200),
          fecha: String(e?.start_date ?? e?.date ?? e?.starts_at ?? e?.start ?? "").slice(0, 10) || null,
        })).filter((e: any) => e.id).slice(0, 300);
        await marcar("ok", null);
        return json({ ok: true, eventos });
      }

      // ---- sincronizar las ventas de un evento ----
      const eventoId = String(body?.evento_id || "");
      if (!UUID.test(eventoId)) return json({ ok: false, error: "Evento no válido" }, 400);
      const categoria = String(body?.categoria || "Ticketera online").trim().slice(0, 60) || "Ticketera online";
      const { data: v, error: ve } = await user.from("ticket_crm_vinculos").select("ext_id").eq("evento_id", eventoId).eq("proveedor", "fourvenues").maybeSingle();
      if (ve) throw ve;
      if (!v?.ext_id) return json({ ok: false, error: "Este evento no está vinculado con ningún evento de Fourvenues." });

      const tickets: any[] = [];
      for (let off = 0; off < 200000; off += 500) {
        const d = lista(await fv("/tickets/", { event_id: v.ext_id, limit: 500, offset: off }));
        tickets.push(...d);
        if (d.length < 500) break;
        await sleep(200);
      }
      const grupos: Record<string, { nombre: string; importe: number; unidades: number; fecha: string | null }> = {};
      let anuladas = 0, invitaciones = 0;
      for (const t of tickets) {
        const st = ([] as string[]).concat(t?.status ?? []).map(String);
        if (st.includes("cancelled")) { anuladas++; continue; }
        if (t?.sale_type === "invitation") { invitaciones++; continue; }
        const key = String(t?.rate_id || t?.rate_name || "general").slice(0, 80);
        const g = grupos[key] ||= { nombre: String(t?.rate_name || "Entradas"), importe: 0, unidades: 0, fecha: null };
        g.importe += Math.max(0, num(t?.total_paid) - num(t?.total_fees) - num(t?.refunded));
        g.unidades += Math.max(1, Math.round(num(t?.for)) || 1);
        const f = String(t?.created_at || "").slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(f) && (!g.fecha || f > g.fecha)) g.fecha = f;
      }
      const ahora = new Date().toISOString();
      const filas = Object.entries(grupos).map(([key, g]) => ({
        evento_id: eventoId, categoria, concepto: `Fourvenues · ${g.nombre}`.slice(0, 160), importe: Math.min(99999999, r2(g.importe)),
        unidades: g.unidades, fecha: g.fecha || ahora.slice(0, 10), metodo: "tarjeta", estado: "cobrado", origen: "api",
        ref_externa: `fv:${eventoId}:${key}`.slice(0, 200), actualizado_en: ahora,
      }));
      if (filas.length) { const { error } = await user.from("ticket_crm_ingresos").upsert(filas, { onConflict: "evento_id,ref_externa" }); if (error) throw error; }
      const { data: prev, error: pe } = await user.from("ticket_crm_ingresos").select("id, ref_externa").eq("evento_id", eventoId).eq("origen", "api").like("ref_externa", `fv:${eventoId}:%`);
      if (pe) throw pe;
      const vivos = new Set(filas.map((f) => f.ref_externa));
      const sobran = (prev || []).filter((p: any) => !vivos.has(p.ref_externa)).map((p: any) => p.id);
      if (sobran.length) { const { error } = await user.from("ticket_crm_ingresos").delete().in("id", sobran); if (error) throw error; }
      await user.from("ticket_crm_vinculos").update({ ultima_sync: ahora, ultimo_error: null }).eq("evento_id", eventoId).eq("proveedor", "fourvenues");
      await marcar("ok", null, true);
      const total = r2(filas.reduce((a, f) => a + f.importe, 0));
      return json({ ok: true, entradas: filas.reduce((a, f) => a + f.unidades, 0), total, tarifas: filas.length, anuladas, invitaciones });
    } catch (e) {
      const msg = e instanceof Fallo ? e.message : "No se ha podido completar la sincronización.";
      await marcar("error", msg);
      if (accion === "sincronizar" && UUID.test(String(body?.evento_id || ""))) await user.from("ticket_crm_vinculos").update({ ultimo_error: msg }).eq("evento_id", String(body.evento_id)).eq("proveedor", "fourvenues");
      return json({ ok: false, error: msg });
    }
  } catch (_e) {
    return json({ ok: false, error: "Error interno" }, 500);
  }
});

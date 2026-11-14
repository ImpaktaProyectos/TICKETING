// TIXFAST · alta de cuentas de RRPP
// El RRPP crea su cuenta con correo y contraseña desde /rp. La cuenta queda confirmada al momento
// (aún no hay correo propio para mandar la confirmación). Después entra con su contraseña desde la página.
// Límite: 5 altas por conexión cada hora y 200 en total cada hora. La clave de servicio nunca sale de aquí.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}\.[a-z]{2,24}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, motivo: "metodo" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "");
    if (!EMAIL.test(email) || email.length > 200) return json({ ok: false, motivo: "email" });
    if (password.length < 8 || password.length > 72) return json({ ok: false, motivo: "password" });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim().slice(0, 64) || "?";
    const hace1h = new Date(Date.now() - 3600e3).toISOString();
    const [{ count: deIp }, { count: total }] = await Promise.all([
      admin.from("ticket_rrpp_registros").select("id", { count: "exact", head: true }).eq("ip", ip).gte("creado_en", hace1h),
      admin.from("ticket_rrpp_registros").select("id", { count: "exact", head: true }).gte("creado_en", hace1h),
    ]);
    if ((deIp ?? 0) >= 5 || (total ?? 0) >= 200) return json({ ok: false, motivo: "limite" });
    await admin.from("ticket_rrpp_registros").insert({ ip, email });

    const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { origen: "rrpp" } });
    if (error) {
      const m = String(error.message || "").toLowerCase();
      if (m.includes("already") || m.includes("registered") || m.includes("exists")) return json({ ok: false, motivo: "existe" });
      if (m.includes("password")) return json({ ok: false, motivo: "password" });
      return json({ ok: false, motivo: "error" });
    }
    return json({ ok: true });
  } catch {
    return json({ ok: false, motivo: "error" }, 500);
  }
});

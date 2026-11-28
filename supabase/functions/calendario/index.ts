// TIXFAST · «Añadir al calendario del móvil»: devuelve el archivo .ics de un pedido
//   GET ?a=<acceso del pedido>  → el iPhone abre «Añadir al calendario»; en Android y Outlook se abre con su calendario.
// No necesita sesión: el acceso del pedido es el secreto (igual que «Mis entradas»). Solo lee.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { citasPedido, archivoIcs } from "../_shared/calendario.js";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const texto = (t: string, status = 200) => new Response(t, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

Deno.serve(async (req) => {
  if (req.method !== "GET") return texto("Método no permitido", 405);
  const acceso = new URL(req.url).searchParams.get("a") || "";
  if (!UUID.test(acceso)) return texto("Enlace no válido", 400);
  try {
    const { data, error } = await admin.rpc("web_pedido", { p_acceso: acceso });
    if (error || !data?.evento) return texto("No encontramos estas entradas", 404);
    const sitio = (Deno.env.get("SITE_URL") || "https://somostixfast.vercel.app").replace(/\/$/, "");
    const citas = citasPedido(data.evento, data.entradas || [], `${sitio}/mis-entradas/${acceso}`);
    if (!citas.length) return texto("Este evento aún no tiene fecha", 404);
    const nombre = String(data.evento.nombre || "evento").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w-]+/g, "_").slice(0, 40) || "evento";
    return new Response(archivoIcs(citas, acceso), { headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombre}.ics"`,
      "Cache-Control": "no-store",
    } });
  } catch (e) {
    console.error((e as Error).message);
    return texto("No se ha podido preparar el calendario", 500);
  }
});

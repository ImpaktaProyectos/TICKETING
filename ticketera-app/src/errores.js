// ===================== REGISTRO DE ERRORES =====================
// Los fallos de la app se envían al panel de administración de TIXFAST para poder arreglarlos.
// Solo se envía el mensaje del error y dónde ocurrió: nunca datos de ventas, clientes ni importes.
// Máximo 15 por sesión y sin repetir el mismo; sin conexión o sin sesión no se envía nada.
import { supabase } from "./supabase";

let enviados = 0;
const vistos = new Set();
export function registrarError(origen, err, detalle) {
  try {
    const mensaje = String(err?.message || err || "").slice(0, 500);
    if (!mensaje) return;
    const k = origen + "|" + mensaje;
    if (vistos.has(k) || enviados >= 15 || !navigator.onLine) return;
    vistos.add(k); enviados++;
    supabase.auth.getSession().then(({ data }) => {
      const uid = data?.session?.user?.id;
      if (!uid) return;
      supabase.from("ticket_errores").insert({
        owner_id: uid, origen: String(origen).slice(0, 40), mensaje,
        detalle: detalle != null ? String(detalle).slice(0, 2000) : err?.stack ? String(err.stack).slice(0, 2000) : null,
        version: String(globalThis.TIXFAST_VERSION || "").slice(0, 20),
        ruta: window.location.pathname.slice(0, 200), agente: navigator.userAgent.slice(0, 200),
      }).then(() => {}, () => {});
    }, () => {});
  } catch { /* el registro nunca debe romper la app */ }
}

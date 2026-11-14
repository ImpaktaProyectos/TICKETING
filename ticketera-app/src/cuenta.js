// ===================== CUENTA, PLAN Y ACCESO =====================
// Cada usuario tiene su ficha (plan y estado). Solo puede leer la suya; el plan y el estado los
// cambia el servidor (pasarela de pago o administración), nunca la app.
// La base de datos es quien bloquea de verdad; aquí solo se avisa antes y se ocultan botones.
// Regla de oro: si no se sabe el acceso (sin internet, base de datos sin actualizar), NO se bloquea nada.
import { useSyncExternalStore } from "react";
import { supabase } from "./supabase";
import { scopedKey } from "./db";

export * from "./planes";
import { sinSuscripcion } from "./planes";

/* ---------- Estado compartido (se carga una vez y se refresca cada 10 min) ---------- */
let ACC = null, cargando = null, ultima = 0, accKey = null;
const subs = new Set();
const avisar = () => subs.forEach(f => f());
const K = () => scopedKey("tixfast_acceso");
// Cada cuenta tiene su acceso: al cambiar de cuenta se olvida el de la anterior
function asegurar() {
  if (accKey === K()) return;
  accKey = K(); ultima = 0; cargando = null;
  try { ACC = JSON.parse(localStorage.getItem(accKey) || "null"); } catch { ACC = null; }
}

export async function refrescarAcceso(forzar = false) {
  asegurar();
  if (cargando) return cargando;
  if (!forzar && Date.now() - ultima < 600000) return ACC;
  cargando = (async () => {
    try {
      const { data, error } = await supabase.rpc("ticket_mi_acceso");
      if (!error) {
        const fila = Array.isArray(data) ? data[0] : data;
        if (accKey !== K()) { cargando = null; return ACC; }   // cambió la cuenta mientras tanto
        ACC = fila || null;
        ultima = Date.now();
        try { localStorage.setItem(K(), JSON.stringify(ACC)); } catch {}
        avisar();
      }
    } catch {}
    cargando = null;
    return ACC;
  })();
  return cargando;
}

export function useAcceso() {
  return useSyncExternalStore((f) => { subs.add(f); refrescarAcceso(); return () => subs.delete(f); }, () => { asegurar(); return ACC; });
}

export async function cargarCuenta() {
  const { data: u } = await supabase.auth.getUser();
  const email = u?.user?.email || "";
  const acc = await refrescarAcceso(true);
  const { data: ficha } = await supabase.from("ticket_cuentas").select("plan_id, estado, prueba_hasta, prueba_usada, periodo_fin, cancela_al_final, cliente_pago_id").maybeSingle();
  const { data: pro } = await supabase.from("ticket_planes").select("nombre, precio_mes").eq("id", "pro").maybeSingle();
  if (!acc) return { email, acc: { plan_id: "fundador", plan_nombre: "Fundador", estado: "activa", limites: {} }, ficha: null, precio: null };
  return { email, acc, ficha: ficha || null, precio: pro?.precio_mes != null ? Number(pro.precio_mes) : null };
}

// Ir a Stripe: «alta» (suscribirse, con prueba de 7 días la primera vez) o «portal» (tarjeta, facturas, cancelar)
const MOTIVOS = {
  sin_precio: "Las suscripciones abren muy pronto: aún no está fijado el precio.",
  ya_suscrito: "Tu cuenta ya tiene la suscripción activa.",
  fundador: "Tu cuenta es Fundador: no necesita suscripción.",
  sin_cliente: "Aún no tienes ninguna suscripción que gestionar.",
  sin_pasarela: "El cobro con tarjeta aún no está disponible.",
  sesion: "Vuelve a entrar en tu cuenta e inténtalo de nuevo.",
};
export async function irAStripe(accion) {
  if (!navigator.onLine) throw Object.assign(new Error("Sin conexión: para suscribirte hace falta internet."), { mostrar: true });
  const { data, error } = await supabase.functions.invoke("suscripcion", { body: { accion, origen: window.location.origin } });
  if (error || !data?.ok || !data.url) throw Object.assign(new Error(MOTIVOS[data?.motivo] || "No se ha podido abrir el pago. Inténtalo de nuevo en un momento."), { mostrar: true });
  window.location.assign(data.url);
}

// Al volver de Stripe (?suscripcion=ok): el aviso de Stripe puede tardar unos segundos
export async function esperarAltaTrasPago() {
  const q = new URLSearchParams(window.location.search);
  const v = q.get("suscripcion");
  if (!v) return null;
  q.delete("suscripcion");
  try { window.history.replaceState(null, "", window.location.pathname + (q.toString() ? `?${q}` : "") + window.location.hash); } catch {}
  if (v !== "ok" && v !== "portal") return v;
  for (let i = 0; i < 12; i++) {
    const a = await refrescarAcceso(true);
    if (v === "portal" || (a && !sinSuscripcion(a))) break;
    await new Promise(r => setTimeout(r, 2500));
  }
  return v;
}

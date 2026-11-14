// ===================== CUENTA, PLAN Y ACCESO =====================
// Cada usuario tiene su ficha (plan y estado). Solo puede leer la suya; el plan y el estado los
// cambia el servidor (pasarela de pago o administración), nunca la app.
// La base de datos es quien bloquea de verdad; aquí solo se avisa antes y se ocultan botones.
// Regla de oro: si no se sabe el acceso (sin internet, base de datos sin actualizar), NO se bloquea nada.
import { useSyncExternalStore } from "react";
import { supabase } from "./supabase";
import { scopedKey } from "./db";

export * from "./planes";

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
  const { data } = await supabase.from("ticket_cuentas").select("plan_id, estado, prueba_hasta, periodo_fin").maybeSingle();
  if (!acc) return { email, acc: { plan_id: "fundador", plan_nombre: "Fundador", estado: "activa", limites: {} }, ficha: null };
  return { email, acc, ficha: data || null };
}

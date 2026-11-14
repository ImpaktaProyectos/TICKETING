// ===================== CUENTA Y PLAN =====================
// Cada usuario registrado tiene su ficha (plan y estado). Solo puede leer la suya;
// el plan y el estado los cambia el servidor (pasarela de pago o administración), nunca la app.
import { supabase } from "./supabase";

export const ESTADO_CUENTA = {
  prueba: { t: "En prueba", c: "var(--amber)" },
  activa: { t: "Activa", c: "var(--green)" },
  impagada: { t: "Pago pendiente", c: "var(--amber)" },
  suspendida: { t: "Pausada", c: "var(--red)" },
  cancelada: { t: "Cancelada", c: "var(--red)" },
};
export const LIMITES_TXT = { eventos: "eventos abiertos", barras_por_evento: "barras por evento" };

export async function cargarCuenta() {
  const { data: u } = await supabase.auth.getUser();
  const email = u?.user?.email || "";
  const { data, error } = await supabase.from("ticket_cuentas").select("plan_id, estado, prueba_hasta, periodo_fin, plan:ticket_planes(nombre, precio_mes, limites)").maybeSingle();
  // Si la base de datos aún no tiene las cuentas, se muestra como cuenta activa sin límites
  if (error || !data) return { email, plan_id: "fundador", estado: "activa", plan: { nombre: "Fundador", precio_mes: null, limites: {} } };
  return { email, ...data };
}

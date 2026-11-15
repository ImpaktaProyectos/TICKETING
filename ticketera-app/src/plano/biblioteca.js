// ===================== MIS PLANOS (biblioteca de la cuenta) =====================
// Planos guardados por nombre para reutilizarlos en otros eventos (mismo club, otra fecha).
// Se guardan SIN los enlaces a los reservados de un evento concreto: cada mesa lleva su nombre
// y, al cargarlo en otro evento, se enlaza por nombre (y se crean las mesas que falten).
import { supabase } from "../supabase";
import { normalizar, paraGuardar } from "./modelo";
export { paraGuardar, mesasQueFaltan } from "./modelo";

const aviso = (m) => Object.assign(new Error(m), { mostrar: true });
const textoError = (error, porDefecto) => {
  const m = String(error?.message || "");
  if (m.startsWith("TIXFAST: ")) return m.slice(9);
  if (error?.code === "23505") return "Ya tienes un plano con ese nombre.";
  return porDefecto;
};

export async function listarPlanos() {
  const { data, error } = await supabase.from("ticket_planos").select("id, nombre, plano, actualizado_en").order("actualizado_en", { ascending: false });
  if (error) throw aviso("No se han podido cargar tus planos.");
  return (data || []).map(x => ({ ...x, plano: normalizar(x.plano) }));
}
export async function guardarPlano(nombre, plano, reservados, id = null) {
  if (!navigator.onLine) throw aviso("Para guardar en «Mis planos» hace falta internet.");
  const fila = { nombre: String(nombre).trim().slice(0, 60), plano: paraGuardar(plano, reservados), actualizado_en: new Date().toISOString() };
  const q = id ? supabase.from("ticket_planos").update(fila).eq("id", id) : supabase.from("ticket_planos").insert(fila);
  const { error } = await q;
  if (error) throw aviso(textoError(error, "No se ha podido guardar el plano."));
}
export async function renombrarPlano(id, nombre) {
  const { error } = await supabase.from("ticket_planos").update({ nombre: String(nombre).trim().slice(0, 60), actualizado_en: new Date().toISOString() }).eq("id", id);
  if (error) throw aviso(textoError(error, "No se ha podido renombrar."));
}
export async function borrarPlano(id) {
  const { error } = await supabase.from("ticket_planos").delete().eq("id", id);
  if (error) throw aviso("No se ha podido borrar.");
}

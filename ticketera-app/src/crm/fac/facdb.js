// ===================== FACTURACIÓN · acceso a datos =====================
// Tablas propias (ticket_fac_*): NO se mezclan con los ingresos y gastos de los eventos.
import { supabase } from "../../supabase";
import { calcular, trimestre, MESES } from "./calculo";

const ok = ({ data, error }) => { if (error) throw new Error(traducir(error.message)); return data; };
const traducir = (m = "") => {
  if (/row-level security|permission denied/i.test(m)) return "No tienes permiso para esto";
  if (/ticket_fac_emisor_nif_check/.test(m)) return "El NIF no es válido: solo letras y números, sin guiones";
  if (/ticket_fac_codigo_uq/.test(m)) return "Ya existe una factura con ese número";
  if (/violates check constraint/.test(m)) return "Hay algún dato no válido o demasiado largo";
  return m.replace(/^.*?ERROR:\s*/, "");
};
async function uid() { const { data } = await supabase.auth.getUser(); return data.user.id; }

export async function cargar() {
  const [em, cs, fs] = await Promise.all([
    supabase.from("ticket_fac_emisor").select("*").maybeSingle(),
    supabase.from("ticket_fac_contactos").select("*").order("nombre").range(0, 4999),
    supabase.from("ticket_fac_facturas").select("*").order("fecha", { ascending: false }).order("numero", { ascending: false, nullsFirst: true }).range(0, 9999),
  ]);
  return { emisor: ok(em), contactos: ok(cs) || [], facturas: ok(fs) || [] };
}

const limpiaNif = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export async function guardarEmisor(e) {
  const fila = { ...e, nif: limpiaNif(e.nif), actualizado_en: new Date().toISOString() };
  delete fila.owner_id;
  return ok(await supabase.from("ticket_fac_emisor").upsert({ ...fila, owner_id: await uid() }).select("*").single());
}
export async function guardarContacto(c) {
  const fila = { tipo: c.tipo || "cliente", nombre: (c.nombre || "").trim(), nif: limpiaNif(c.nif) || null, email: c.email || null, telefono: c.telefono || null,
    direccion: c.direccion || null, cp: c.cp || null, ciudad: c.ciudad || null, provincia: c.provincia || null, pais: c.pais || "España", notas: c.notas || null, actualizado_en: new Date().toISOString() };
  if (c.id) return ok(await supabase.from("ticket_fac_contactos").update(fila).eq("id", c.id).select("*").single());
  return ok(await supabase.from("ticket_fac_contactos").insert(fila).select("*").single());
}
export async function borrarContacto(id) { ok(await supabase.from("ticket_fac_contactos").delete().eq("id", id)); }

// Instantánea del contacto que va dentro de la factura (si luego cambias el contacto, la factura no cambia)
export const fotoContacto = (c) => c ? { nombre: c.nombre, nif: c.nif || "", direccion: c.direccion || "", cp: c.cp || "", ciudad: c.ciudad || "", provincia: c.provincia || "", pais: c.pais || "España", email: c.email || "" } : {};

const CAMPOS = ["tipo", "estado", "serie", "rectificativa", "rectifica_id", "motivo", "fecha", "fecha_operacion", "vencimiento", "contacto_id", "contacto", "lineas", "irpf_pct", "num_proveedor", "categoria", "forma_pago", "notas", "plantilla", "archivo_path", "pagada_en"];
export async function guardarFactura(f) {
  const t = calcular(f.lineas || [], f.irpf_pct);
  const fila = Object.fromEntries(CAMPOS.filter(k => f[k] !== undefined).map(k => [k, f[k] === "" ? null : f[k]]));
  Object.assign(fila, { base: t.base, cuota_iva: t.cuota_iva, cuota_irpf: t.cuota_irpf, total: t.total, desglose: t.desglose });
  if (!fila.estado) fila.estado = f.tipo === "recibida" ? "pendiente" : "borrador";
  if (f.id) return ok(await supabase.from("ticket_fac_facturas").update(fila).eq("id", f.id).select("*").single());
  return ok(await supabase.from("ticket_fac_facturas").insert(fila).select("*").single());
}
export async function emitir(id) { return ok(await supabase.rpc("fac_emitir", { p_id: id })); }
export async function marcarPagada(f, pagada) {
  const estado = pagada ? "pagada" : f.tipo === "recibida" ? "pendiente" : "emitida";
  return ok(await supabase.from("ticket_fac_facturas").update({ estado, pagada_en: pagada ? new Date().toISOString().slice(0, 10) : null }).eq("id", f.id).select("*").single());
}
export async function ponerArchivo(id, path) { ok(await supabase.from("ticket_fac_facturas").update({ archivo_path: path }).eq("id", id)); }
export async function borrarFactura(f) {
  if (f.archivo_path) await supabase.storage.from("facturas").remove([f.archivo_path]).catch(() => {});
  ok(await supabase.from("ticket_fac_facturas").delete().eq("id", f.id));
}
export async function registro() { return ok(await supabase.from("ticket_fac_registro").select("*").order("id", { ascending: false }).range(0, 199)) || []; }

// ---------- Archivos: año / trimestre / mes / ingresos|gastos ----------
const seguro = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").slice(0, 70);
export const carpeta = (f) => { const [a, m] = (f.fecha || "").split("-"); const mi = parseInt(m, 10) - 1; return `${a}/T${trimestre(f.fecha)}/${m}-${MESES[mi] || ""}/${f.tipo === "recibida" ? "gastos" : "ingresos"}`; };
export const nombreArchivo = (f, ext = "pdf") => f.tipo === "recibida" ? `${f.fecha}_${seguro(f.contacto?.nombre)}_${seguro(f.num_proveedor || "sin-numero")}.${ext}` : `${seguro(f.codigo || "borrador")}_${seguro(f.contacto?.nombre)}.${ext}`;
export async function subirArchivo(f, blob, ext = "pdf") {
  const path = `${await uid()}/${carpeta(f)}/${nombreArchivo(f, ext)}`;
  ok(await supabase.storage.from("facturas").upload(path, blob, { upsert: true, contentType: blob.type || (ext === "pdf" ? "application/pdf" : "image/jpeg") }));
  return path;
}
export async function bajarArchivo(path) { const { data, error } = await supabase.storage.from("facturas").download(path); if (error) throw new Error("No se ha podido descargar el archivo"); return data; }
export async function urlArchivo(path) { return ok(await supabase.storage.from("facturas").createSignedUrl(path, 600)).signedUrl; }

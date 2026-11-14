// ===================== FOTO DE LA FACTURA / TICKET DE UN GASTO =====================
// Se guarda en el almacenamiento privado «facturas» (cada cuenta solo ve su carpeta).
// Las fotos se reducen en el propio móvil (máx. 1600 px, JPEG) para que suban rápido aunque haya poca cobertura.
import { supabase } from "./supabase";

const TIPOS = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];
export const MAX_MB = 15;

async function reducir(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;            // PDF y HEIC tal cual
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 900 * 1024) return file;
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.82));
    return blob && blob.size < file.size ? new File([blob], "ticket.jpg", { type: "image/jpeg" }) : file;
  } catch { return file; }
}

// Sube la foto de un gasto y devuelve su ruta (para guardarla en el gasto)
export async function subirFotoGasto(eventoId, gastoId, original) {
  if (!navigator.onLine) throw Object.assign(new Error("Sin conexión: la foto se puede añadir luego desde el gasto"), { mostrar: true });
  if (!TIPOS.includes(original.type) && !/\.(heic|pdf|jpe?g|png|webp)$/i.test(original.name || "")) throw Object.assign(new Error("Solo fotos o PDF"), { mostrar: true });
  if (original.size > MAX_MB * 1024 * 1024) throw Object.assign(new Error(`El archivo pasa de ${MAX_MB} MB`), { mostrar: true });
  const file = await reducir(original);
  const { data: u } = await supabase.auth.getUser();
  const ext = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : file.type === "image/heic" || /\.heic$/i.test(original.name || "") ? "heic" : "jpg";
  const path = `${u.user.id}/gastos/${eventoId}/${gastoId}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("facturas").upload(path, file, { upsert: true, contentType: file.type || "image/jpeg" });
  if (error) throw Object.assign(new Error("No se ha podido subir la foto"), { mostrar: true });
  return path;
}
export async function verFotoGasto(path) {
  const { data, error } = await supabase.storage.from("facturas").createSignedUrl(path, 600);
  if (error) throw Object.assign(new Error("No se ha podido abrir la foto"), { mostrar: true });
  return data.signedUrl;
}
export async function borrarFotoGasto(path) { if (path) await supabase.storage.from("facturas").remove([path]).catch(() => {}); }

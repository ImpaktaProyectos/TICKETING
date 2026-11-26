// Fotos más ligeras antes de subirlas (las páginas públicas se abren con datos móviles).
// · max: lado mayor en píxeles.
// · tipo: "image/webp" (fotos que solo se ven en la web: pesan ~30 % menos que en JPEG),
//   "image/jpeg" (flyer: también sale en los correos, y Outlook no muestra WebP) o "image/png" (logos).
// Si el navegador no sabe generar WebP, se guarda en JPEG. Si no se gana nada, se sube el original.
const EXT = { "image/webp": ".webp", "image/jpeg": ".jpg", "image/png": ".png" };
const aBlob = (cv, tipo, calidad) => new Promise(r => cv.toBlob(r, tipo, calidad));
export async function reducirImagen(file, max, tipo) {
  try {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    // Pequeña y sin redimensionar: se sube tal cual (salvo para pasarla a WebP, que conserva la transparencia)
    if (k === 1 && file.size < 700 * 1024 && (tipo !== "image/webp" || file.type === tipo)) return file;
    const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    let blob = await aBlob(cv, tipo, tipo === "image/webp" ? 0.82 : 0.86);
    if (tipo === "image/webp" && blob && blob.type !== "image/webp") { tipo = "image/jpeg"; blob = await aBlob(cv, tipo, 0.86); }
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + (EXT[tipo] || ".jpg"), { type: tipo });
  } catch { return file; }
}

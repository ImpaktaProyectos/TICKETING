// ===================== Enlace de RRPP =====================
// La venta es del RRPP SOLO si se compra en la página de su enlace (https://…/e/evento?rp=CODIGO).
// No se guarda nada: si alguien entra por un enlace de RRPP y compra más tarde por otro sitio,
// la venta es de donde se compra al final. El servidor decide si el código vale (RRPP activo en ese evento).
const VIEJO = "tixfast_rp";   // versión anterior: guardaba el código 30 días. Se borra.

export function guardarCodigoRP() {
  try { localStorage.removeItem(VIEJO); } catch {}
}

export function codigoRP() {
  try {
    const c = new URLSearchParams(window.location.search).get("rp");
    const codigo = String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
    return codigo.length >= 3 ? codigo : undefined;
  } catch { return undefined; }
}

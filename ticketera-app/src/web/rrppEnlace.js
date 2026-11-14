// ===================== Enlace de RRPP =====================
// Quien entra por https://…/e/evento?rp=CODIGO deja el código guardado 30 días en este móvil.
// Al comprar, el código viaja con el pedido y el servidor decide si vale (RRPP activo en ese evento).
// Si entra por el enlace de otro RRPP, cuenta el último.
const K = "tixfast_rp";
const DIAS = 30;

export function guardarCodigoRP() {
  try {
    const c = new URLSearchParams(window.location.search).get("rp");
    const codigo = String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
    if (codigo.length >= 3) localStorage.setItem(K, JSON.stringify({ c: codigo, t: Date.now() }));
  } catch {}
}

export function codigoRP() {
  try {
    const x = JSON.parse(localStorage.getItem(K) || "null");
    if (!x?.c || Date.now() - Number(x.t || 0) > DIAS * 864e5) return undefined;
    return x.c;
  } catch { return undefined; }
}

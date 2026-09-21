// Folio LOCAL del ticket (correlativo offline-safe). Ver explicación en el README.
const KEY = (ev, pt) => `ticketera_folio_${ev}_${pt}`;

export function prefijoDePunto(punto) {
  if (punto?.prefijo) return punto.prefijo.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  return (punto?.name || "TKT").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) || "TKT";
}
export function getDeviceTag() { return localStorage.getItem("ticketera_device_tag") || ""; }
export function setDeviceTag(t) { localStorage.setItem("ticketera_device_tag", t || ""); }

export function nextFolio(eventoId, puntoId, prefijo) {
  const k = KEY(eventoId, puntoId);
  const n = (parseInt(localStorage.getItem(k) || "0", 10) || 0) + 1;
  localStorage.setItem(k, String(n));
  return `${prefijo}${getDeviceTag()}-${String(n).padStart(4, "0")}`;
}
export function nextFolios(eventoId, puntoId, prefijo, qty) {
  const out = []; for (let i = 0; i < qty; i++) out.push(nextFolio(eventoId, puntoId, prefijo)); return out;
}
// Lee el contador actual SIN incrementarlo (para mostrar el próximo folio)
export function peekFolio(eventoId, puntoId) {
  return parseInt(localStorage.getItem(KEY(eventoId, puntoId)) || "0", 10) || 0;
}
// Reinicia los contadores de folio de este dispositivo para un evento (al resetear)
export function resetFolios(eventoId, puntoIds = []) {
  puntoIds.forEach(pid => localStorage.removeItem(KEY(eventoId, pid)));
}

// TIXFAST · PIN y contraseñas de acceso (administrador / supervisor)
// Nunca se guarda el PIN: se guarda una HUELLA (PBKDF2-SHA256, 210.000 vueltas, sal aleatoria).
// Con la huella se puede comprobar un intento, pero no se puede leer el PIN.
// La comprobación es local: funciona sin internet, igual que el TPV.

const ITER = 210000;
const enc = new TextEncoder();
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const FABRICA = { admin: "1234", supervisor: "0000" };
export const disponible = () => !!(globalThis.crypto && crypto.subtle);

async function derivar(secreto, salt, iter) {
  const k = await crypto.subtle.importKey("raw", enc.encode(String(secreto).normalize("NFC")), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, k, 256));
}

// Lee el formato v1$iter$tipo$largo$sal$huella
export function leerHuella(h) {
  const p = String(h || "").split("$");
  if (p.length !== 6 || p[0] !== "v1") return null;
  const iter = +p[1], largo = +p[3];
  if (!(iter >= 10000) || !["pin", "clave"].includes(p[2])) return null;
  return { iter, tipo: p[2], largo, sal: p[4], huella: p[5] };
}

export async function crearHuella(secreto, tipo) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const h = await derivar(secreto, salt, ITER);
  return ["v1", ITER, tipo, tipo === "pin" ? String(secreto).length : 0, b64(salt), b64(h)].join("$");
}

// Lo que hace falta para comprobar el acceso de un rol en un evento
// - huella: la versión protegida (la buena)
// - plano: PIN antiguo visible (solo mientras se pasa a huella); si no hay nada, el de fábrica
export function secretoDe(ev, rol) {
  const huella = ev?.[`pin_${rol}_huella`] || null;
  const plano = huella ? null : (ev?.[`pin_${rol}`] != null && ev[`pin_${rol}`] !== "" ? String(ev[`pin_${rol}`]) : FABRICA[rol]);
  const info = leerHuella(huella);
  return { huella: info ? huella : null, plano: info ? null : plano, tipo: info ? info.tipo : "pin", largo: info ? info.largo : (plano || "").length };
}

// Estado para avisos en Ajustes
export function estadoDe(ev, rol) {
  const s = secretoDe(ev, rol);
  if (s.huella) return { protegido: true, tipo: s.tipo, largo: s.largo, fabrica: false, visible: false };
  return { protegido: false, tipo: "pin", largo: s.largo, fabrica: s.plano === FABRICA[rol], visible: ev?.[`pin_${rol}`] != null };
}

const iguales = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };

export async function comprobar(intento, s) {
  intento = String(intento ?? "");
  if (!intento || !s) return false;
  if (s.huella) {
    const info = leerHuella(s.huella);
    if (!info || !disponible()) return false;
    const h = await derivar(intento, unb64(info.sal), info.iter);
    return iguales(h, unb64(info.huella));
  }
  return s.plano != null && intento === s.plano;
}

// Reglas para elegir un PIN o contraseña nuevos. Devuelve el texto del problema o "" si vale.
const SECUENCIAS = "0123456789012345678909876543210987654321";
export function problema(secreto, tipo) {
  const v = String(secreto || "");
  if (tipo === "pin") {
    if (!/^\d+$/.test(v)) return "El PIN solo puede llevar números";
    if (v.length < 4) return "El PIN necesita al menos 4 números";
    if (v.length > 12) return "Máximo 12 números";
    if (/^(\d)\1+$/.test(v)) return "No vale repetir el mismo número";
    if (SECUENCIAS.includes(v)) return "No vale una serie seguida (1234, 9876…)";
    if (Object.values(FABRICA).includes(v)) return "Ese es un PIN de fábrica";
    return "";
  }
  if (v.length < 8) return "La contraseña necesita al menos 8 caracteres";
  if (v.length > 64) return "Máximo 64 caracteres";
  if (!/[a-zA-ZñÑ]/.test(v) || !/\d/.test(v)) return "Mezcla letras y números";
  if (/^(.)\1+$/.test(v) || /^(1234|qwer|asdf|pass|contra)/i.test(v)) return "Demasiado fácil de adivinar";
  return "";
}

// Fuerza orientativa para el indicador
export function fuerza(secreto, tipo) {
  const v = String(secreto || "");
  if (!v || problema(v, tipo)) return 0;
  if (tipo === "pin") return v.length >= 8 ? 3 : v.length >= 6 ? 2 : 1;
  const clases = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter(r => r.test(v)).length;
  return v.length >= 12 && clases >= 3 ? 3 : v.length >= 10 || clases >= 3 ? 2 : 1;
}

// Bloqueo por intentos fallidos en este equipo (compartido por todas las pantallas que piden PIN)
const BLOQ = "tixfast_pin_lock";
export const leerBloqueo = () => { try { return JSON.parse(localStorage.getItem(BLOQ)) || { fails: 0, until: 0 }; } catch { return { fails: 0, until: 0 }; } };
export const acierto = () => { try { localStorage.setItem(BLOQ, JSON.stringify({ fails: 0, until: 0 })); } catch {} };
export function fallo() {
  const fails = leerBloqueo().fails + 1;
  const next = { fails, until: fails >= 5 ? Date.now() + Math.min(15 * 60, 30 * 2 ** (fails - 5)) * 1000 : 0 };
  try { localStorage.setItem(BLOQ, JSON.stringify(next)); } catch {}
  return next;
}

// ===================== TICKETS CON QR DE UN SOLO USO · FIRMA =====================
// Cada ticket lleva un código firmado con la clave secreta del evento (HMAC-SHA256).
// Se firma en el propio TPV, SIN internet, en el momento de imprimir.
//
// Contenido (33 bytes):
//   [0]      versión: 1 = ticket real · 2 = ticket de PRUEBA (nunca se canjea)
//   [1..16]  identificador único de la venta (client_uuid)
//   [17]     nº de vale dentro de un bono (0 = ticket normal)
//   [18]     unidades (siempre 1: un ticket = un producto)
//   [19..24] primeros 6 bytes del id del producto (para mostrarlo aunque la venta aún no haya subido)
//   [25..32] firma (8 primeros bytes del HMAC-SHA256 de los bytes 0..24)
// Texto del QR: "TX" + base32 (A-Z 2-7) → cabe en un QR pequeño en modo alfanumérico.

export const QR_PREFIJO = "TX";
export const VER_REAL = 1, VER_PRUEBA = 2;

/* ---------- SHA-256 / HMAC síncronos (la venta no espera a nada) ---------- */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
export function sha256(bytes) {
  const l = bytes.length, nb = ((l + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(nb); m.set(bytes); m[l] = 0x80;
  const bits = l * 8; const dv = new DataView(m.buffer);
  dv.setUint32(nb - 4, bits >>> 0); dv.setUint32(nb - 8, Math.floor(bits / 0x100000000));
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < nb; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32); const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]);
  return out;
}
export function hmacSha256(key, msg) {
  let k = key.length > 64 ? sha256(key) : key;
  const kp = new Uint8Array(64); kp.set(k);
  const ip = new Uint8Array(64 + msg.length), op = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) { ip[i] = kp[i] ^ 0x36; op[i] = kp[i] ^ 0x5c; }
  ip.set(msg, 64);
  op.set(sha256(ip), 64);
  return sha256(op);
}

/* ---------- utilidades ---------- */
export const hexToBytes = (hex) => { const h = String(hex || "").replace(/[^0-9a-f]/gi, ""); const o = new Uint8Array(h.length >> 1); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; };
export const bytesToHex = (b) => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
const uuidHex = (u) => String(u || "").replace(/-/g, "").toLowerCase();
const hexToUuid = (h) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
const igual = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(bytes) {
  let out = "", bits = 0, val = 0;
  for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } val &= 0xff; }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
export function unbase32(txt) {
  const out = []; let bits = 0, val = 0;
  for (const ch of txt) { const v = B32.indexOf(ch); if (v < 0) return null; val = ((val << 5) | v) & 0xffff; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; } }
  return new Uint8Array(out);
}
export const prodCorto = (productoId) => uuidHex(productoId).slice(0, 12).padEnd(12, "0");

/* ---------- crear y leer el código ---------- */
// clave: hex de 64 caracteres (la del evento). Devuelve el texto que va dentro del QR.
export function crearToken({ clave, ventaUuid, idx = 0, productoId, prueba = false }) {
  const key = hexToBytes(clave);
  if (key.length < 16) return null;
  const b = new Uint8Array(33);
  b[0] = prueba ? VER_PRUEBA : VER_REAL;
  b.set(hexToBytes(uuidHex(ventaUuid)).subarray(0, 16), 1);
  b[17] = Math.max(0, Math.min(255, idx | 0));
  b[18] = 1;
  b.set(hexToBytes(prodCorto(productoId)), 19);
  b.set(hmacSha256(key, b.subarray(0, 25)).subarray(0, 8), 25);
  return QR_PREFIJO + base32(b);
}

// Lee el texto escaneado. No comprueba la firma (eso lo hace verificarToken o el servidor).
export function leerToken(texto) {
  const t = String(texto || "").trim().toUpperCase();
  if (!t.startsWith(QR_PREFIJO)) return null;
  const b = unbase32(t.slice(QR_PREFIJO.length));
  if (!b || b.length !== 33) return null;
  const h = bytesToHex(b);
  return {
    texto: t, bytes: b, hex: h,
    ver: b[0], prueba: b[0] === VER_PRUEBA,
    ventaUuid: hexToUuid(h.slice(2, 34)), idx: b[17], unidades: b[18] || 1, prod: h.slice(38, 50),
    clave: `${hexToUuid(h.slice(2, 34))}:${b[17]}`,   // identifica el ticket (lo que solo se canjea una vez)
  };
}
// ¿Está firmado con esta clave? (sin internet, en el validador)
export function verificarToken(tk, clave) {
  if (!tk || !clave) return false;
  const key = hexToBytes(clave); if (key.length < 16) return false;
  return igual(hmacSha256(key, tk.bytes.subarray(0, 25)).subarray(0, 8), tk.bytes.subarray(25, 33));
}

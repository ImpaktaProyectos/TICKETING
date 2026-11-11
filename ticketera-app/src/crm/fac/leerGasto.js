// ===================== FACTURACIÓN · leer una factura de gasto en PDF =====================
// Saca del texto del PDF (en el propio navegador, sin subirlo a ningún sitio) los datos que suelen venir
// en cualquier factura española: NIF del proveedor, número, fecha, base, tipo de IVA y total.
// Es orientativo: lo que no se reconoce se deja vacío y la persona lo revisa antes de guardar.
import { numES } from "../facturaPdf.js";
import { IVAS } from "./calculo.js";

const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

// Agrupa los trozos de texto de cada página en líneas (por su altura en la página)
export function textoDePaginas(paginas) {
  return paginas.map(pg => {
    const filas = [];
    [...pg.items].sort((a, b) => b.y - a.y || a.x - b.x).forEach(i => {
      const f = filas.find(r => Math.abs(r.y - i.y) <= 2.5);
      if (f) f.items.push(i); else filas.push({ y: i.y, items: [i] });
    });
    return filas.map(f => f.items.sort((a, b) => a.x - b.x).map(i => i.s).join(" ")).join("\n");
  }).join("\n");
}

// NIF / CIF / NIE españoles (con o sin guiones, espacios o puntos)
const RE_NIF = /\b(?:ES[\s-]?)?([A-HJNPQRSUVW][\s.-]?\d{7}[\s.-]?[0-9A-J]|\d{8}[\s.-]?[A-Z]|[XYZ][\s.-]?\d{7}[\s.-]?[A-Z])\b/g;
const limpiaNif = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
export function nifs(texto) { return [...new Set([...String(texto).matchAll(RE_NIF)].map(m => limpiaNif(m[1])))]; }

const IMPORTE = String.raw`(-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+,\d{2}|-?\d{1,3}(?:,\d{3})*\.\d{2}|-?\d+\.\d{2})`;
const aNum = (s) => { if (!s) return null; const v = numES(s); if (v != null) return v; const w = parseFloat(String(s).replace(/,/g, "")); return Number.isFinite(w) ? w : null; };
const ultimo = (re, t) => { let m, r = null; const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"); while ((m = g.exec(t))) r = m; return r; };

function fecha(texto) {
  const cerca = texto.match(/fecha[^\n\d]{0,25}(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/i) || texto.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4}|\d{2})\b/);
  if (!cerca) return null;
  let [, d, m, a] = cerca; d = +d; m = +m; a = +a; if (a < 100) a += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || a < 2000 || a > 2100) return null;
  return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function numero(texto) {
  const m = texto.match(/(?:n[ºo°.]?\s*(?:de\s*)?factura|factura\s*(?:n[ºo°.]?|n[uú]m(?:ero)?\.?)|invoice\s*(?:no\.?|number|#))\s*[:#]?\s*([A-Z0-9][A-Z0-9\/\-.]{0,29})/i)
    || texto.match(/\bfactura\s*[:#]\s*([A-Z0-9][A-Z0-9\/\-.]{1,29})/i);
  const v = m?.[1]?.replace(/[.\-/]+$/, "");
  return v && /\d/.test(v) ? v : null;
}

// texto: todo el texto del PDF · propioNif: tu NIF (para no confundirlo con el del proveedor)
export function interpretarGasto(texto, propioNif = "") {
  const t = String(texto || "");
  const mio = limpiaNif(propioNif || "");
  const nif = nifs(t).find(n => n !== mio) || null;
  const total = aNum(ultimo(new RegExp(String.raw`total\s*(?:factura|a\s*pagar|importe|eur)?\s*[:€]?\s*(?:€\s*)?` + IMPORTE, "i"), t)?.[1]);
  const base = aNum(t.match(new RegExp(String.raw`base\s*(?:imponible)?\s*[:€]?\s*(?:€\s*)?` + IMPORTE, "i"))?.[1]);
  const ivaTxt = t.match(/(?:i\.?v\.?a\.?|tipo)\s*[:(]?\s*(21|10|4|0)(?:[.,]0+)?\s*%/i) || t.match(/\b(21|10|4)(?:[.,]0+)?\s*%\s*(?:de\s*)?i\.?v\.?a/i);
  let iva = ivaTxt ? +ivaTxt[1] : null;
  if (iva == null && base && total && base > 0) {
    const calc = (total / base - 1) * 100;
    const cerca = IVAS.reduce((a, b) => Math.abs(b - calc) < Math.abs(a - calc) ? b : a, 21);
    if (Math.abs(cerca - calc) < 0.6) iva = cerca;
  }
  let baseFinal = base;
  if (baseFinal == null && total != null) baseFinal = r2(total / (1 + (iva ?? 21) / 100));
  return { nif, numero: numero(t), fecha: fecha(t), base: baseFinal, iva, total };
}

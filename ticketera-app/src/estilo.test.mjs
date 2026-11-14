// Comprobación de estilo: que toda la app parezca la misma aplicación.
//  1) Solo dos tipografías: Inter (la app) y Roboto Mono (tickets impresos y el cierre Z).
//  2) Toda ventana flotante («position: fixed» a pantalla completa) se abre dentro de <Capa>,
//     que le da la tipografía y los colores de la app y evita que la tape la barra de abajo en el móvil.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
let n = 0; const ok = (name, f) => { f(); n++; console.log("✓", name); };
const raiz = new URL(".", import.meta.url).pathname;
const archivos = (d) => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? archivos(p) : /\.(jsx|js)$/.test(f) && !/\.test\./.test(f) ? [p] : []; });
const fuentes = archivos(raiz).map(p => ({ p: p.replace(raiz, ""), s: readFileSync(p, "utf8") }));

ok("solo se usan las tipografías de la app (Inter y Roboto Mono)", () => {
  const malas = [];
  fuentes.forEach(({ p, s }) => {
    if (p.startsWith("web/")) return;   // las webs públicas de cada evento tienen su propio diseño (letra elegida por el organizador)
    for (const m of s.matchAll(/font-?[Ff]amily\s*:\s*([^,;}\n]+)/g)) {
      const v = m[1].replace(/["'`]/g, "").trim();
      if (/^(inherit|var\(|FUENTE_APP|\$\{)/.test(v)) continue;
      if (!/^(Inter|Roboto Mono|ui-monospace|monospace)\b/.test(v)) malas.push(`${p}: ${v.slice(0, 50)}`);
    }
  });
  assert.deepEqual(malas, [], "Tipografías fuera de la marca:\n" + malas.join("\n"));
});

ok("la capa de ventanas lleva la tipografía y el color de la app", () => {
  const c = fuentes.find(f => f.p === "Capa.jsx").s;
  assert.match(c, /FUENTE_APP = "Inter/); assert.match(c, /color: "var\(--text\)"/); assert.match(c, /createPortal/);
});

ok("toda ventana a pantalla completa se abre dentro de <Capa>", () => {
  // Excepciones: la pantalla principal del TPV y del inicio (no son ventanas) y la zona de impresión
  // (el validador QR es una pantalla completa propia; las webs públicas de cada evento tienen su propio diseño)
  const permitidos = new Set(["App.jsx", "main.jsx", "Capa.jsx", "publico.jsx", "qr/Validador.jsx"]);
  const sin = [];
  fuentes.forEach(({ p, s }) => {
    if (permitidos.has(p) || p.startsWith("web/")) return;
    const fijas = [...s.matchAll(/position:\s*"fixed",\s*inset:\s*0/g)].length;
    if (fijas && !/<Capa>/.test(s) && !/\.\.\.(C|R)\.modalWrap|style=\{(C|R|K)\.wrap\}/.test(s)) sin.push(p);
  });
  assert.deepEqual(sin, [], "Ventanas fuera de <Capa>:\n" + sin.join("\n"));
});
console.log(`\n${n} comprobaciones de estilo correctas`);

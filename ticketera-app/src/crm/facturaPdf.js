// ===================== CRM · LECTOR DE FACTURAS EN PDF =====================
// Se lee en el propio navegador (el PDF no se sube a ningún sitio).
// Formato reconocido: Distribuciones Monteagudo (columnas Código · Descripción · Cantidad · Precio · %Dto · Imp.Dto · % IVA · Importe).
// Reglas: se guardan TODAS las líneas tal cual (también las repetidas), los códigos como texto (0210),
// y manda el importe impreso de cada línea, no cantidad × precio.

// Número español → número: "-3.492,85" → -3492.85 ; "0,583" → 0.583 ; "63,5" → 63.5
export function numES(t) {
  const s = String(t ?? "").replace(/\s|€/g, "");
  if (!/^-?[\d.]*\d(,\d+)?$/.test(s)) return null;
  const v = parseFloat(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(v) ? v : null;
}
const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

// Texto del PDF con posiciones → [{ items: [{ s, x, y, w }] }] por página
export async function leerPdf(arrayBuffer, pdfjs) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer), isEvalSupported: false, disableFontFace: true }).promise;
  const paginas = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    paginas.push({ items: tc.items.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5], w: i.width })) });
  }
  return paginas;
}

const COLS = ["codigo", "descripcion", "cantidad", "precio", "dto", "impDto", "iva", "importe"];
const CABECERAS = { codigo: /^c[oó]digo$/i, descripcion: /^descripci[oó]n$/i, cantidad: /^cantidad$/i, precio: /^precio$/i, dto: /^%\s*dto$/i, impDto: /^imp\.?\s*dto$/i, iva: /^%\s*iva$/i, importe: /^importe$/i };
const fila = (items, y, tol = 2.5) => items.filter(i => Math.abs(i.y - y) <= tol).sort((a, b) => a.x - b.x);

// Interpreta una factura de Monteagudo. Devuelve null si el formato no es este.
export function interpretarMonteagudo(paginas) {
  const todo = paginas.flatMap(p => p.items).map(i => i.s).join(" ");
  if (!/monteagudo/i.test(todo)) return null;
  const lineas = [];
  let numero = null, fecha = null, sumaSigue = null, pie = null;
  const avisos = [];

  paginas.forEach((pg, ip) => {
    const items = pg.items;
    // Cabecera de la tabla en esta página
    const cab = {};
    items.forEach(i => { for (const k of COLS) if (CABECERAS[k].test(i.s) && !cab[k]) cab[k] = i; });
    if (!cab.codigo || !cab.importe || !cab.cantidad) return;
    const yCab = cab.codigo.y;
    // Nº de factura y fecha (debajo de sus etiquetas)
    if (!numero) {
      const etN = items.find(i => /^n[ºo°]\s*factura$/i.test(i.s)), etF = items.find(i => /^fecha$/i.test(i.s));
      if (etN) { const v = items.filter(i => i.y < etN.y && etN.y - i.y < 25 && Math.abs(i.x - etN.x) < 30).sort((a, b) => b.y - a.y)[0]; numero = v?.s || null; }
      if (etF) { const v = items.filter(i => i.y < etF.y && etF.y - i.y < 25 && Math.abs(i.x - etF.x) < 40 && /\d{2}\/\d{2}\/\d{4}/.test(i.s)).sort((a, b) => b.y - a.y)[0]; if (v) { const m = v.s.match(/(\d{2})\/(\d{2})\/(\d{4})/); fecha = `${m[3]}-${m[2]}-${m[1]}`; } }
    }
    // Límites de columna: los números van alineados a la derecha
    const der = (k) => cab[k] ? cab[k].x + cab[k].w : null;
    const columna = (it) => {
      const r = it.x + it.w;
      if (it.x < cab.descripcion.x - 2) return "codigo";
      const num = numES(it.s) != null;
      if (!num) return it.x < cab.cantidad.x - 4 ? "descripcion" : "otro";
      let mejor = null, dist = 1e9;
      for (const k of ["cantidad", "precio", "dto", "impDto", "iva", "importe"]) { if (!cab[k]) continue; const d = Math.abs(r - der(k)); if (d < dist) { dist = d; mejor = k; } }
      return dist <= 14 ? mejor : (it.x < cab.cantidad.x - 4 ? "descripcion" : "otro");
    };
    // Fin de la tabla: "Suma y sigue" o el pie de totales
    const finY = Math.max(...items.filter(i => /^suma y sigue/i.test(i.s) || /^total bruto$/i.test(i.s) || /^descuento$/i.test(i.s)).map(i => i.y), -1);
    // "Sumas anteriores": su etiqueta y su importe se quitan (repiten la "Suma y sigue" de la página anterior)
    const quitar = new Set();
    const sa = items.find(i => /^sumas anteriores/i.test(i.s));
    if (sa) {
      quitar.add(sa);
      const cand = fila(items, sa.y).filter(i => i.x > sa.x && numES(i.s) != null);
      const igual = cand.find(i => sumaSigue != null && Math.abs(numES(i.s) - sumaSigue) < 0.005) || cand.find(i => /\d\.\d{3},/.test(i.s));
      if (igual) quitar.add(igual);
    }
    const ss = items.find(i => /^suma y sigue/i.test(i.s));
    if (ss) { const v = fila(items, ss.y).find(i => i.x > ss.x && numES(i.s) != null); sumaSigue = v ? numES(v.s) : sumaSigue; }

    // Filas de producto: empiezan por un código numérico en la columna Código
    const codigos = items.filter(i => i.y < yCab - 3 && i.y > finY + 3 && i.x < cab.descripcion.x - 2 && /^\d{1,8}$/.test(i.s));
    codigos.sort((a, b) => b.y - a.y).forEach(c => {
      const enFila = fila(items, c.y).filter(i => !quitar.has(i));
      const l = { pagina: ip + 1, codigo: c.s, descripcion: "", cantidad: null, precio: null, dto: null, impDto: null, iva: null, importe: null };
      const desc = [];
      enFila.forEach(it => {
        if (it === c) return;
        const k = columna(it);
        if (k === "descripcion") desc.push(it.s);
        else if (k && k !== "otro" && k !== "codigo") { if (l[k] == null) l[k] = numES(it.s); else avisos.push(`Página ${ip + 1}, código ${c.s}: dos valores en la columna ${k}`); }
      });
      l.descripcion = desc.join(" ").replace(/\s+/g, " ").trim();
      lineas.push(l);
    });

    // Pie de totales (última página que lo tenga)
    const etBase = items.find(i => /^base imponible$/i.test(i.s));
    const etTotal = items.find(i => /^total factura$/i.test(i.s));
    if (etBase && etTotal) {
      const debajo = items.filter(i => i.y < etBase.y - 8 && i.y > etBase.y - 60);
      const filasIva = debajo.filter(i => /^\d{1,2}(,\d+)?\s*%$/.test(i.s));
      const ivas = filasIva.map(t => {
        const f = fila(items, t.y, 2.5);
        const pct = numES(t.s.replace("%", ""));
        const base = f.filter(i => i.x < t.x - 4 && i.x > etBase.x - 40 && numES(i.s) != null).sort((a, b) => b.x - a.x)[0];
        const cuota = f.filter(i => i.x > t.x + t.w && numES(i.s) != null).sort((a, b) => a.x - b.x)[0];
        return { pct, base: base ? numES(base.s) : null, cuota: cuota ? numES(cuota.s) : null };
      });
      const bruto = debajo.filter(i => i.x < etBase.x - 40 && numES(i.s) != null).sort((a, b) => b.y - a.y)[0];
      const total = items.filter(i => i.y < etTotal.y && etTotal.y - i.y < 40 && i.x > etTotal.x - 30 && numES(i.s) != null).sort((a, b) => b.y - a.y)[0];
      pie = { bruto: bruto ? numES(bruto.s) : null, ivas, total: total ? numES(total.s) : null };
    }
  });

  if (!lineas.length) return null;
  // Comprobaciones al céntimo
  const sumaLineas = r2(lineas.reduce((t, l) => t + (l.importe || 0), 0));
  const sinImporte = lineas.filter(l => l.importe == null);
  sinImporte.forEach(l => avisos.push(`Código ${l.codigo} (página ${l.pagina}): no se ha leído su importe`));
  const baseTotal = pie ? r2(pie.ivas.reduce((t, v) => t + (v.base || 0), 0)) : null;
  const porIva = {};
  lineas.forEach(l => { const k = l.iva ?? 0; porIva[k] = r2((porIva[k] || 0) + (l.importe || 0)); });
  const cuadraBase = baseTotal != null && Math.abs(baseTotal - sumaLineas) < 0.015;
  const cuadraIva = pie ? pie.ivas.every(v => Math.abs((porIva[v.pct] || 0) - v.base) < 0.015 && Math.abs(r2(v.base * v.pct / 100) - v.cuota) < 0.015) : false;
  const cuadraTotal = pie ? Math.abs(r2((baseTotal || 0) + pie.ivas.reduce((t, v) => t + (v.cuota || 0), 0)) - pie.total) < 0.015 : false;
  // Líneas repetidas (mismo código y misma cantidad): se mantienen, solo se avisa
  const vistos = {};
  lineas.forEach((l, i) => { const k = `${l.codigo}|${l.cantidad}|${l.importe}`; (vistos[k] = vistos[k] || []).push(i); });
  Object.values(vistos).filter(v => v.length > 1).forEach(v => v.forEach(i => { lineas[i].repetida = true; }));
  const positivas = lineas.filter(l => (l.cantidad || 0) > 0).length, negativas = lineas.filter(l => (l.cantidad || 0) < 0).length;
  const tipo = /^R/i.test(numero || "") || (pie && pie.total < 0 && !positivas) ? "abono" : negativas && positivas ? "mixta" : "factura";
  return {
    proveedor: "Monteagudo", numero, fecha, tipo, lineas, pie, avisos,
    checks: { sumaLineas, baseTotal, cuadraBase, cuadraIva, cuadraTotal, codigos: new Set(lineas.map(l => l.codigo)).size },
  };
}

// Unidades físicas de una línea según el artículo: cajas × unidades por caja (fracciones de caja → botellas sueltas)
export function unidadesLinea(cantidad, articulo) {
  const q = Number(cantidad) || 0;
  const pc = articulo?.porCaja || 1;
  const exacto = q * pc;
  const redondo = Math.round(exacto);
  const limpio = Math.abs(exacto - redondo) <= 0.06 ? redondo : Math.round(exacto * 1000) / 1000;
  return { unidades: limpio, cajas: pc > 1 ? Math.trunc(q) : null, sueltas: pc > 1 ? Math.round((limpio - Math.trunc(q) * pc) * 1000) / 1000 : null, dudosa: Math.abs(exacto - redondo) > 0.06 };
}

/* ===================== LECTOR GENERAL (otros proveedores) =====================
   Para facturas y albaranes en PDF con texto (no fotos escaneadas) que tengan una tabla con cabecera.
   Busca la fila de cabecera por sus palabras habituales y reparte cada número en su columna por posición.
   Es menos exacto que el de Monteagudo: por eso todo se revisa línea a línea antes de aplicar. */
const SIN = {
  codigo: /^(c[oó]d(igo)?\.?|ref(erencia)?\.?|art(\.|[ií]culo)?\s*n?[ºo°]?|c[oó]d\.?\s*art\.?)$/i,
  descripcion: /^(descripci[oó]n|concepto|denominaci[oó]n|producto|art[ií]culos?|detalle)$/i,
  cantidad: /^(cantidad|cant\.?|uds\.?|unidades|unid\.?|u\.?|cajas|bultos|n[ºo°]\s*uds?\.?)$/i,
  precio: /^(precio(\s*(ud|unit(ario)?|u\.?))?|p\.?\s*unit(ario)?\.?|pvp|p\/u|precio\/ud|tarifa)$/i,
  dto: /^(%?\s*dto\.?|%?\s*desc(uento)?\.?|%\s*d)$/i,
  iva: /^(%?\s*i\.?v\.?a\.?|tipo\s*iva)$/i,
  importe: /^(importe|total|subtotal|neto|importe\s*neto|total\s*l[ií]nea|base)$/i,
};
const PIE = /^(base\s*imponible|total\s*(factura|albar[aá]n|a\s*pagar|bruto)|suma\s*y\s*sigue|subtotal\s*general|observaciones|forma\s*de\s*pago|vencimientos?)/i;

function filasPorY(items, tol = 2.5) {
  const fs = [];
  [...items].sort((a, b) => b.y - a.y).forEach(i => { const f = fs.find(x => Math.abs(x.y - i.y) <= tol); if (f) f.items.push(i); else fs.push({ y: i.y, items: [i] }); });
  fs.forEach(f => f.items.sort((a, b) => a.x - b.x));
  return fs;
}
function cabeceraDe(items) {
  for (const f of filasPorY(items, 3)) {
    const cab = {};
    f.items.forEach(i => { for (const k of Object.keys(SIN)) if (!cab[k] && SIN[k].test(i.s.trim())) { cab[k] = i; break; } });
    if (cab.descripcion && cab.cantidad && (cab.importe || cab.precio)) return { y: f.y, cab };
  }
  return null;
}
const proveedorDe = (items) => {
  const txt = items.filter(i => /[A-Za-zÁÉÍÓÚÑ]{3}/.test(i.s));
  const sociedad = txt.find(i => /\b(S\.?\s?L\.?U?|S\.?\s?A\.?|S\.?\s?COOP\.?|SOCIEDAD|DISTRIBUCIONES|BEBIDAS|COMERCIAL)\b/i.test(i.s) && !/factura|cliente/i.test(i.s));
  const arriba = [...txt].sort((a, b) => b.y - a.y).find(i => !/^(factura|albar[aá]n|abono|p[aá]gina|fecha|n[ºo°])/i.test(i.s) && i.s.length >= 4);
  return (sociedad || arriba)?.s.replace(/\s+/g, " ").trim().slice(0, 80) || "";
};

export function interpretarGenerico(paginas) {
  const todos = paginas.flatMap(p => p.items);
  const texto = todos.map(i => i.s).join(" ");
  const esAlbaran = /albar[aá]n/i.test(texto) && !/\bfactura\b/i.test(texto.slice(0, 400));
  // Abono solo si un rótulo lo dice («FACTURA DE ABONO», «FACTURA RECTIFICATIVA», «ABONO»), no por «abono en cuenta»
  const esAbono = todos.some(i => /^(factura\s*)?(de\s*)?(abono|rectificativa)(\s*n[ºo°]?.*)?$/i.test(i.s.trim()));
  const lineas = [], avisos = [];
  let cabeceras = 0;
  paginas.forEach((pg, ip) => {
    const h = cabeceraDe(pg.items); if (!h) return;
    cabeceras++;
    // Columnas: intervalos entre los centros de las cabeceras
    const cols = Object.entries(h.cab).map(([k, i]) => ({ k, c: i.x + (i.w || 0) / 2 })).sort((a, b) => a.c - b.c);
    const colDe = (it) => { const c = it.x + (it.w || 0) / 2; let mejor = cols[0]; cols.forEach(x => { if (Math.abs(x.c - c) < Math.abs(mejor.c - c)) mejor = x; }); return mejor.k; };
    const finY = Math.max(-1, ...pg.items.filter(i => PIE.test(i.s.trim()) && i.y < h.y).map(i => i.y));
    let previa = null;
    filasPorY(pg.items.filter(i => i.y < h.y - 3 && i.y > finY + 3)).forEach(f => {
      const l = { pagina: ip + 1, codigo: "", descripcion: "", cantidad: null, precio: null, dto: null, iva: null, importe: null };
      const desc = [];
      f.items.forEach(it => {
        const k = colDe(it), v = numES(it.s.replace("%", ""));
        if (k === "descripcion" || (v == null && k !== "codigo")) { desc.push(it.s); return; }
        if (k === "codigo") { l.codigo = l.codigo ? `${l.codigo} ${it.s}` : it.s; return; }
        if (l[k] == null) l[k] = v; else avisos.push(`Página ${ip + 1}: dos valores en la columna ${k}`);
      });
      l.descripcion = desc.join(" ").replace(/\s+/g, " ").trim();
      if (l.cantidad == null && l.importe == null && previa && l.descripcion && !l.codigo) { previa.descripcion = `${previa.descripcion} ${l.descripcion}`.trim(); return; } // descripción en dos renglones
      if (l.cantidad == null || !l.descripcion) return;                  // no es una línea de producto
      if (l.importe == null && l.precio != null) l.importe = r2(l.cantidad * l.precio * (1 - (l.dto || 0) / 100));
      l.codigo = l.codigo.slice(0, 40);
      lineas.push(l); previa = l;
    });
  });
  if (!cabeceras || !lineas.length) return null;

  // Número y fecha
  const mN = texto.match(/(?:n[ºo°]\.?\s*(?:de\s*)?(?:factura|albar[aá]n|documento)|(?:factura|albar[aá]n)\s*(?:n[ºo°]\.?|n[uú]mero)?)\s*[:#]?\s*([A-Z]{0,4}[-\/ ]?\d[\w\-\/]{1,24})/i);
  const mF = texto.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  const fecha = mF ? `${mF[3].length === 2 ? "20" + mF[3] : mF[3]}-${mF[2].padStart(2, "0")}-${mF[1].padStart(2, "0")}` : null;
  // IVA: de las líneas; si no, del pie («IVA 21 %»)
  const sumaLineas = r2(lineas.reduce((t, l) => t + (l.importe || 0), 0));
  const porIva = {};
  lineas.forEach(l => { if (l.iva != null) porIva[l.iva] = r2((porIva[l.iva] || 0) + (l.importe || 0)); });
  let ivas = Object.entries(porIva).map(([pct, base]) => ({ pct: Number(pct), base, cuota: r2(base * Number(pct) / 100) })).sort((a, b) => b.pct - a.pct);
  if (!ivas.length) { const mI = texto.match(/I\.?V\.?A\.?\s*(\d{1,2})(?:[.,]\d+)?\s*%/i); if (mI) ivas = [{ pct: Number(mI[1]), base: sumaLineas, cuota: r2(sumaLineas * Number(mI[1]) / 100) }]; }
  // Total impreso: el número más grande junto a «Total factura / Total a pagar / Total»
  let total = null;
  const etT = todos.filter(i => /^total(\s*(factura|a\s*pagar|albar[aá]n|€))?:?$/i.test(i.s.trim())).sort((a, b) => a.y - b.y)[0];
  if (etT) { const cand = todos.filter(i => Math.abs(i.y - etT.y) < 14 && i.x > etT.x && numES(i.s) != null).map(i => numES(i.s)); if (cand.length) total = cand.reduce((m, v) => Math.abs(v) > Math.abs(m) ? v : m, cand[0]); }
  const baseTotal = ivas.length ? r2(ivas.reduce((t, v) => t + v.base, 0)) : null;
  const calcTotal = ivas.length ? r2(baseTotal + ivas.reduce((t, v) => t + v.cuota, 0)) : null;
  const cuadraTotal = total != null && calcTotal != null && Math.abs(total - calcTotal) < 0.05;
  const sinImporte = lineas.filter(l => l.importe == null).length;
  if (sinImporte) avisos.push(esAlbaran ? "Albarán sin precios: se usará el coste del catálogo" : `${sinImporte} líneas sin importe leído`);
  if (!ivas.length) avisos.push("No he leído el IVA: el gasto habrá que crearlo a mano");
  const positivas = lineas.filter(l => l.cantidad > 0).length, negativas = lineas.filter(l => l.cantidad < 0).length;
  if (esAbono && !negativas) lineas.forEach(l => { l.cantidad = -Math.abs(l.cantidad); if (l.importe != null) l.importe = -Math.abs(l.importe); });
  const tipo = esAbono ? "abono" : negativas && positivas ? "mixta" : "factura";
  return {
    proveedor: proveedorDe(paginas[0]?.items || []) || "Proveedor", numero: mN ? mN[1].trim().slice(0, 34) : null, fecha, tipo, lineas, avisos,
    pie: { bruto: null, ivas, total: total ?? calcTotal }, generico: true, albaran: esAlbaran,
    checks: { sumaLineas, baseTotal, cuadraBase: ivas.length > 0, cuadraIva: ivas.length > 0, cuadraTotal, comprobado: total != null && calcTotal != null, codigos: new Set(lineas.map(l => l.codigo || l.descripcion)).size },
  };
}

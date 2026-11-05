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

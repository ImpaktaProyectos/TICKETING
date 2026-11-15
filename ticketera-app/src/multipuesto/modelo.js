// ===================== MULTIPUESTO · reglas puras (sin red), probadas en multipuesto.test.mjs =====================
// Evento Multipuesto: la organización vende en sus cajas (TPV de siempre) tickets con QR; cada PUESTO
// (food truck, caseta, proveedor) los canjea con su propio móvil y se queda con lo vendido menos la
// comisión del organizador. La venta es de la organización; el canje dice quién entregó.
// Las mismas cuentas las hace la base de datos (ticket_consumicion y ticket_comision): deben coincidir.

export const esMultipuesto = (ev) => ev?.style?.modalidad === "multipuesto";
export const MODALIDADES = {
  estandar: { t: "Evento estándar", d: "Tus barras venden y sirven. Como siempre." },
  multipuesto: { t: "Evento Multipuesto", d: "Tus cajas venden tickets y varios puestos (food trucks, casetas…) los canjean con su móvil. Cada puesto factura lo suyo menos tu comisión." },
};

// «Hamburguesa» de la Caja 1 y « hamburguesa » de la Caja 2 son la misma consumición
export const claveConsumicion = (nombre) => String(nombre || "").trim().replace(/\s+/g, " ").toLowerCase().slice(0, 80);

// Comisión del organizador por una unidad: % del valor, o € fijos (nunca más que el valor)
export function comision(valor, tipo, cantidad) {
  if (valor == null || !Number.isFinite(Number(valor))) return 0;
  const v = Number(valor), c = Number(cantidad) || 0;
  return tipo === "fijo" ? Math.min(c, v) : Math.round(v * c) / 100;
}
// La comisión que se aplica a una consumición en un puesto: la propia del producto o la general del puesto
export function comisionDe(puesto, clave) {
  const p = (puesto?.productos || []).find(x => x.consumicion === clave);
  return p && p.comision_tipo ? { tipo: p.comision_tipo, valor: Number(p.comision_valor) } : { tipo: puesto?.comision_tipo || "pct", valor: Number(puesto?.comision_valor) || 0 };
}
export const textoComision = ({ tipo, valor }) => tipo === "fijo"
  ? `${Number(valor).toLocaleString("es-ES", { style: "currency", currency: "EUR" })} por unidad`
  : `${Number(valor).toLocaleString("es-ES", { maximumFractionDigits: 2 })} %`;

// Consumiciones que se venden en el evento (productos de todas las cajas, agrupados por nombre)
export function consumicionesDelEvento(ev) {
  const m = new Map();
  (ev?.puntos || []).filter(p => !p.archivado).forEach(p => (p.products || []).forEach(x => {
    const k = claveConsumicion(x.name); if (!k) return;
    const c = m.get(k) || { clave: k, nombre: String(x.name).trim(), precios: [], cajas: [] };
    if (Number.isFinite(Number(x.price))) c.precios.push(Number(x.price));
    if (!c.cajas.includes(p.name)) c.cajas.push(p.name);
    m.set(k, c);
  }));
  return [...m.values()].map(c => ({ ...c, precio: c.precios.length ? Math.min(...c.precios) : null, precioMax: c.precios.length ? Math.max(...c.precios) : null }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

// Unidades vendidas por consumición (tickets sueltos y cada vale de los bonos), sin anuladas
export function vendidasPorConsumicion(ev, sales) {
  const prods = new Map(); (ev?.puntos || []).forEach(p => (p.products || []).forEach(x => prods.set(x.id, x)));
  const out = {};
  const sumar = (nombre, n) => { const k = claveConsumicion(nombre); if (k) out[k] = (out[k] || 0) + n; };
  (sales || []).forEach(s => {
    if (s.voided) return;
    if (s.productId) { sumar(prods.get(s.productId)?.name || s.name, 1); return; }
    const pt = (ev?.puntos || []).find(p => p.id === s.puntoId);
    const combo = (pt?.combos || []).find(c => c.name === s.name);
    (combo?.items || []).forEach(it => sumar(prods.get(it.productId)?.name, it.qty || 1));
  });
  return out;
}

// Ficha del puesto → lo que se guarda (o los errores para enseñar)
export function validarPuesto(f) {
  const errores = [];
  const nombre = String(f?.nombre || "").trim();
  if (nombre.length < 1 || nombre.length > 60) errores.push("Ponle un nombre al puesto (máximo 60 letras).");
  const tipo = f?.comision_tipo === "fijo" ? "fijo" : "pct";
  const valor = Number(String(f?.comision_valor ?? "").replace(",", "."));
  if (!Number.isFinite(valor) || valor < 0 || (tipo === "pct" && valor > 100) || valor > 10000) errores.push(tipo === "pct" ? "La comisión va de 0 a 100 %." : "Escribe una comisión válida en euros.");
  const productos = [];
  for (const p of f?.productos || []) {
    const k = claveConsumicion(p.consumicion); if (!k) continue;
    if (p.comision_tipo) {
      const v = Number(String(p.comision_valor ?? "").replace(",", "."));
      if (!Number.isFinite(v) || v < 0 || (p.comision_tipo === "pct" && v > 100) || v > 10000) { errores.push(`Comisión de «${p.nombre || k}» no válida.`); continue; }
      productos.push({ consumicion: k, comision_tipo: p.comision_tipo, comision_valor: Math.round(v * 100) / 100 });
    } else productos.push({ consumicion: k });
  }
  if (!productos.length) errores.push("Elige al menos un producto que pueda canjear este puesto.");
  return { errores, datos: { id: f?.id || null, nombre, color: /^#[0-9a-f]{6}$/i.test(f?.color || "") ? f.color : "#ff5a3c", contacto: String(f?.contacto || "").trim().slice(0, 120),
    activo: f?.activo !== false, comision_tipo: tipo, comision_valor: Math.round((Number.isFinite(valor) ? valor : 0) * 100) / 100, productos } };
}

// Liquidación agrupada por puesto (a partir de las filas puesto × consumición del servidor)
export function liquidacionPorPuesto(filas, puestos = []) {
  const m = new Map(puestos.map(p => [p.id, { puesto: p, unidades: 0, valor: 0, comision: 0, neto: 0, lineas: [] }]));
  (filas || []).forEach(f => {
    const g = m.get(f.puesto_id) || { puesto: { id: f.puesto_id, nombre: "Puesto borrado" }, unidades: 0, valor: 0, comision: 0, neto: 0, lineas: [] };
    g.unidades += Number(f.unidades) || 0; g.valor += Number(f.valor) || 0; g.comision += Number(f.comision) || 0; g.neto += Number(f.neto) || 0;
    g.lineas.push(f); m.set(f.puesto_id, g);
  });
  const r = (n) => Math.round(n * 100) / 100;
  return [...m.values()].map(g => ({ ...g, valor: r(g.valor), comision: r(g.comision), neto: r(g.neto), lineas: g.lineas.sort((a, b) => b.unidades - a.unidades) }))
    .sort((a, b) => b.unidades - a.unidades);
}

// CSV (Excel en español: separador «;» y coma decimal). Evita fórmulas inyectadas.
export function csv(filas) {
  const celda = (x) => {
    if (x == null) return "";
    if (typeof x === "number") return String(x).replace(".", ",");
    let v = String(x).replace(/[;\r\n]+/g, " ");
    if (/^[=+\-@\t]/.test(v)) v = "'" + v;
    return v;
  };
  return "﻿" + filas.map(f => f.map(celda).join(";")).join("\r\n");
}

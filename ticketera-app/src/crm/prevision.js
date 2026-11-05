// ===================== PREVISIÓN · cálculos (sin pantalla, se pueden probar solos) =====================
// Cuántas entradas hacen falta para no perder (punto de equilibrio) y cuánto se gana vendiendo X.
//
// Lo que deja cada entrada de un tramo:
//   precio sin IVA − comisión de la ticketera − copas incluidas × coste de copa + lo que se gana en barra por persona
// Lo que se gana en barra por persona = gasto medio por cliente (sin IVA) × margen de la bebida.
// Las invitaciones no pagan entrada, pero gastan en barra y pueden llevar copa.
// Las entradas se venden por tramos en orden (anticipada → 1ª → 2ª → taquilla) hasta su cupo y el aforo.

const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const num = (v, d = 0) => { const x = typeof v === "string" ? parseFloat(v.replace(",", ".")) : Number(v); return Number.isFinite(x) ? x : d; };
const ent = (v) => { const x = Math.floor(num(v, NaN)); return Number.isFinite(x) && x >= 0 ? x : null; };   // entero ≥ 0 o null (sin límite)

export const CFG_DEF = {
  gastoBarra: 8,        // € que se deja de media cada cliente en barra (con IVA)
  margenBarra: 55,      // % de eso que es beneficio (lo demás es lo que cuesta la bebida)
  costeCopa: 3,         // € que nos cuesta cada copa incluida en una entrada
  aforo: "",            // personas que caben (vacío = sin límite)
  invitaciones: 0,      // invitaciones previstas
  copasInvitacion: 0,   // copas que lleva cada invitación
  comision: true,       // descontar la comisión de la ticketera (de Ajustes)
  iva: true,            // descontar el IVA si está activado en Ajustes
};
export const ESC_DEF = [
  { k: "pesimista", t: "Pesimista", modo: "pct", valor: 50 },
  { k: "normal", t: "Normal", modo: "pct", valor: 75 },
  { k: "optimista", t: "Optimista", modo: "pct", valor: 100 },
];
export const TRAMOS_PLANTILLA = [
  { nombre: "Anticipada", precio: 15, cupo: 100, copas: 0 },
  { nombre: "1ª tanda", precio: 18, cupo: 200, copas: 0 },
  { nombre: "2ª tanda", precio: 22, cupo: 200, copas: 0 },
  { nombre: "Taquilla", precio: 25, cupo: "", copas: 0 },
];
export const cfgCon = (c) => ({ ...CFG_DEF, ...(c || {}) });

// Parámetros fiscales que vienen de Ajustes (comisión de la ticketera e IVA)
export function fiscalDe(ajustes, cfg) {
  const a = ajustes || {}, k = a.comisiones || {}, iv = a.iva || {};
  const ivaOn = !!iv.activo && cfg.iva !== false;
  return {
    comPct: cfg.comision !== false ? num(k.ticketeraPct) : 0,
    comFijo: cfg.comision !== false ? num(k.ticketeraFijo) : 0,
    ivaEntradas: ivaOn ? num(iv.ventas?.entradas, 21) : 0,
    ivaBarra: ivaOn ? num(iv.ventas?.barra, 10) : 0,
  };
}

// Beneficio de barra por persona
export function barraPorPersona(cfg, fis) {
  const gasto = num(cfg.gastoBarra) / (1 + (fis?.ivaBarra || 0) / 100);
  return r2(gasto * Math.min(100, Math.max(0, num(cfg.margenBarra))) / 100);
}

// Desglose de lo que deja una entrada vendida a `precio` (con IVA) y con `copas` incluidas
export function desglose(precio, copas, cfg, fis) {
  const p = Math.max(0, num(precio));
  const sinIva = p / (1 + (fis.ivaEntradas || 0) / 100);
  const iva = p - sinIva;
  const comision = p > 0 ? p * fis.comPct / 100 + fis.comFijo : 0;
  const copa = Math.max(0, num(copas)) * Math.max(0, num(cfg.costeCopa));
  const barra = barraPorPersona(cfg, fis);
  return { precio: r2(p), iva: r2(iva), comision: r2(comision), copa: r2(copa), barra, deja: r2(sinIva - comision - copa + barra) };
}

// Prepara los tramos para calcular. `base` = entradas ya vendidas (modo real); en ficticio, 0.
// Para lo ya vendido puede venir el importe real cobrado (ticketera): se usa ese en vez de precio × unidades.
export function prepararTramos(tramos, cfg, fis, { conBase = false } = {}) {
  return (tramos || []).map((t, i) => {
    const d = desglose(t.precio, t.copas, cfg, fis);
    const base = conBase ? Math.max(0, Math.floor(num(t.vendidas))) : 0;
    let valorBase = r2(base * d.deja);
    if (conBase && t.importeReal != null && base > 0) {
      // Lo cobrado de verdad (ya sin gastos de gestión): sin IVA, menos comisión por unidad, copas y + barra
      const imp = num(t.importeReal);
      const sinIva = imp / (1 + fis.ivaEntradas / 100);
      const com = imp * fis.comPct / 100 + fis.comFijo * base;
      valorBase = r2(sinIva - com - base * d.copa + base * d.barra);
    }
    return { i, id: t.id || String(i), nombre: t.nombre || `Tramo ${i + 1}`, cupo: ent(t.cupo), base, valorBase, d };
  });
}

const capacidad = (T, cfg) => {
  const af = ent(cfg.aforo);
  const sumCupos = T.every(t => t.cupo != null) ? T.reduce((s, t) => s + t.cupo, 0) : Infinity;
  return Math.min(af == null ? Infinity : af, sumCupos);
};

// Reparte `extra` entradas nuevas por los tramos en orden, respetando cupos y aforo
export function repartir(T, cfg, extra) {
  const cap = capacidad(T, cfg);
  let quedan = Math.max(0, Math.floor(extra));
  let total = T.reduce((s, t) => s + t.base, 0);
  return T.map(t => {
    const hueco = Math.max(0, Math.min(t.cupo == null ? Infinity : t.cupo - t.base, cap - total));
    const n = Math.min(quedan, hueco);
    quedan -= n; total += n;
    return n;
  });
}

// Fijo del evento (no depende de las entradas): invitaciones − gastos + otros ingresos
export function fijo({ cfg, fis, gastos = 0, otros = 0 }) {
  const inv = Math.max(0, Math.floor(num(cfg.invitaciones)));
  const porInv = barraPorPersona(cfg, fis) - Math.max(0, num(cfg.copasInvitacion)) * Math.max(0, num(cfg.costeCopa));
  return { invitaciones: r2(inv * porInv), gastos: r2(num(gastos)), otros: r2(num(otros)), total: r2(inv * porInv - num(gastos) + num(otros)) };
}

// Resultado si se venden `extra` entradas más (además de las ya vendidas)
export function resultado(T, cfg, F, extra) {
  const rep = repartir(T, cfg, extra);
  const vendido = T.reduce((s, t) => s + t.valorBase, 0);
  const nuevo = T.reduce((s, t, k) => s + rep[k] * t.d.deja, 0);
  const n = rep.reduce((s, x) => s + x, 0);
  return { reparto: rep, nuevas: n, total: r2(vendido + nuevo + F.total), ingresoEntradas: r2(T.reduce((s, t, k) => s + rep[k] * t.d.precio, 0)) };
}

// Punto de equilibrio: cuántas entradas MÁS hacen falta para no perder (null = no se llega ni llenando)
export function equilibrio(T, cfg, F) {
  const cap = capacidad(T, cfg);
  let acc = r2(T.reduce((s, t) => s + t.valorBase, 0) + F.total);
  if (acc >= 0) return { faltan: 0, yaCubierto: true };
  let total = T.reduce((s, t) => s + t.base, 0), faltan = 0;
  for (const t of T) {
    const hueco = Math.max(0, Math.min(t.cupo == null ? Infinity : t.cupo - t.base, cap - total));
    if (hueco === 0) continue;
    if (t.d.deja > 0) {
      const k = Math.ceil(-acc / t.d.deja - 1e-9);
      if (k <= hueco) return { faltan: faltan + k, tramo: t.nombre, deja: t.d.deja, yaCubierto: false };
    }
    if (hueco === Infinity) return { faltan: null, imposible: true };   // tramo sin límite que no deja dinero
    acc = r2(acc + hueco * t.d.deja); faltan += hueco; total += hueco;
  }
  return { faltan: null, imposible: true, conTodo: acc };
}

// Entradas totales de un escenario (por % del aforo o por número)
export function entradasEscenario(e, T, cfg) {
  const cap = capacidad(T, cfg);
  if (e.modo === "pct") return cap === Infinity ? null : Math.round(cap * Math.max(0, num(e.valor)) / 100);
  return Math.max(0, Math.floor(num(e.valor)));
}

// Máximo para el deslizador y el gráfico
export function maxEntradas(T, cfg, eq) {
  const cap = capacidad(T, cfg);
  if (cap !== Infinity) return cap;
  const base = T.reduce((s, t) => s + t.base, 0);
  return Math.max(200, Math.ceil(((eq?.faltan || 0) + base) * 1.6 / 50) * 50, base + 100);
}

export { capacidad };

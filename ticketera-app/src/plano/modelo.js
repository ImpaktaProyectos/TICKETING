// ===================== PLANO DE LA SALA · modelo (sin React, probado en plano.test.mjs) =====================
// Todo se mide en METROS. El plano vive en el evento: ticket_style.reservados.plano
//   { ancho, largo, elementos: [{ id, tipo, x, y, w, h, rot, texto?, forma?, reservadoId? }] }
// x, y = esquina superior izquierda (sin girar); rot = grados; el giro es sobre el centro.

export const CUADRICULA = 0.25;   // ajuste al mover/redimensionar (25 cm)
export const MIN_SALA = 4, MAX_SALA = 300;

// Catálogo: lo que se puede encontrar en una sala, una fiesta de pueblo o un festival
export const TIPOS = {
  mesa:      { t: "Mesa VIP",          g: "Reservados", w: 1.8, h: 1.8, icono: "🛋️", reservable: true, formas: ["redonda", "cuadrada", "sofa", "palco"] },
  escenario: { t: "Escenario",         g: "Música",     w: 8,   h: 4,   icono: "🎤", color: "#a855f7", alto: 1 },
  cabina:    { t: "Cabina DJ",         g: "Música",     w: 3,   h: 1.6, icono: "🎧", color: "#ff5a3c", alto: 1.1 },
  pista:     { t: "Pista de baile",    g: "Música",     w: 10,  h: 8,   icono: "🪩", color: "#3b82f6", alto: 0 },
  altavoz:   { t: "Altavoz",           g: "Música",     w: 0.8, h: 0.8, icono: "🔊", color: "#838aa0", alto: 1.6 },
  pantalla:  { t: "Pantalla",          g: "Música",     w: 4,   h: 0.3, icono: "📺", color: "#14b8a6", alto: 2 },
  barra:     { t: "Barra",             g: "Servicio",   w: 6,   h: 1.2, icono: "🍸", color: "#ffb400", alto: 1.1 },
  taquilla:  { t: "Taquilla",          g: "Servicio",   w: 2.5, h: 1.2, icono: "🎟️", color: "#ec4899", alto: 1.1 },
  guardarropa: { t: "Guardarropa",     g: "Servicio",   w: 3,   h: 1.5, icono: "🧥", color: "#838aa0", alto: 1 },
  aseos:     { t: "Aseos",             g: "Servicio",   w: 4,   h: 3,   icono: "🚻", color: "#838aa0", alto: 2.4 },
  entrada:   { t: "Entrada",           g: "Paso",       w: 2.5, h: 0.5, icono: "🚪", color: "#22d3a6", alto: 0 },
  salida:    { t: "Salida emergencia", g: "Paso",       w: 2,   h: 0.5, icono: "🟩", color: "#22d3a6", alto: 0 },
  escalera:  { t: "Escalera",          g: "Paso",       w: 2,   h: 3.5, icono: "🪜", color: "#838aa0", alto: 0.5 },
  pared:     { t: "Pared",             g: "Estructura", w: 4,   h: 0.25, icono: "▬", color: "#5b6274", alto: 2.6 },
  columna:   { t: "Columna",           g: "Estructura", w: 0.6, h: 0.6, icono: "◼", color: "#5b6274", alto: 2.6 },
  carpa:     { t: "Carpa",             g: "Estructura", w: 14,  h: 10,  icono: "⛺", color: "#ffb400", alto: 0 },
  zona:      { t: "Zona",              g: "Estructura", w: 6,   h: 4,   icono: "⬚", color: "#a855f7", alto: 0 },
  arbol:     { t: "Árbol",             g: "Exterior",   w: 1.4, h: 1.4, icono: "🌳", color: "#22d3a6", alto: 2 },
  foodtruck: { t: "Food truck",        g: "Exterior",   w: 5,   h: 2.2, icono: "🚚", color: "#ff5a3c", alto: 2 },
  texto:     { t: "Texto",             g: "Estructura", w: 3,   h: 0.8, icono: "🔤", color: "#eceef5", alto: 0 },
};
export const GRUPOS_TIPOS = ["Reservados", "Música", "Servicio", "Paso", "Estructura", "Exterior"];
// Los que van debajo de todo (suelos y zonas), para que no tapen las mesas
const CAPA = { carpa: 0, zona: 1, pista: 2 };
export const capa = (tipo) => CAPA[tipo] ?? 5;

export const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
export const ajustar = (v, paso = CUADRICULA) => r2(Math.round(Number(v) / paso) * paso);
const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);
let n = 0;
export const nuevoId = () => `el_${Date.now().toString(36)}_${(n++).toString(36)}`;

// Deja cualquier plano (aunque venga roto o de una versión antigua) en un estado válido
export function normalizar(p) {
  const ancho = Math.min(MAX_SALA, Math.max(MIN_SALA, num(p?.ancho, 20)));
  const largo = Math.min(MAX_SALA, Math.max(MIN_SALA, num(p?.largo, 14)));
  const elementos = (Array.isArray(p?.elementos) ? p.elementos : [])
    .filter(e => e && TIPOS[e.tipo])
    .slice(0, 400)
    .map(e => {
      const T = TIPOS[e.tipo];
      const w = Math.min(MAX_SALA, Math.max(0.2, num(e.w, T.w))), h = Math.min(MAX_SALA, Math.max(0.2, num(e.h, T.h)));
      return {
        id: String(e.id || nuevoId()), tipo: e.tipo, w, h,
        x: Math.min(ancho - 0.2, Math.max(-w + 0.2, num(e.x, 0))), y: Math.min(largo - 0.2, Math.max(-h + 0.2, num(e.y, 0))),
        rot: ((num(e.rot, 0) % 360) + 360) % 360,
        ...(e.texto != null && String(e.texto).trim() ? { texto: String(e.texto).slice(0, 40) } : {}),
        ...(T.formas ? { forma: T.formas.includes(e.forma) ? e.forma : T.formas[0] } : {}),
        ...(T.reservable && e.reservadoId ? { reservadoId: String(e.reservadoId) } : {}),
        ...(T.reservable && e.ref ? { ref: String(e.ref).slice(0, 40) } : {}),
      };
    });
  return { ancho, largo, elementos };
}

export function crear(tipo, x, y, extra = {}) {
  const T = TIPOS[tipo];
  return { id: nuevoId(), tipo, w: T.w, h: T.h, x: ajustar(x - T.w / 2), y: ajustar(y - T.h / 2), rot: 0, ...(T.formas ? { forma: T.formas[0] } : {}), ...extra };
}

// Mover dentro de la sala (puede asomar un poco por los bordes, nunca perderse fuera)
export function mover(e, x, y, sala) {
  return { ...e, x: Math.min(sala.ancho - 0.2, Math.max(-e.w + 0.2, ajustar(x))), y: Math.min(sala.largo - 0.2, Math.max(-e.h + 0.2, ajustar(y))) };
}
export function redimensionar(e, w, h) {
  return { ...e, w: Math.max(0.25, ajustar(w)), h: Math.max(0.25, ajustar(h)) };
}
export const girar = (e, grados) => ({ ...e, rot: (((e.rot || 0) + grados) % 360 + 360) % 360 });
export const duplicar = (e) => ({ ...e, id: nuevoId(), x: ajustar(e.x + 0.5), y: ajustar(e.y + 0.5), reservadoId: undefined });

// Enlaza cada mesa con su reservado: por id y, si el id ya no existe (evento copiado), por su nombre.
// También apunta el nombre (ref) para poder volver a enlazarla en el futuro.
export function enlazar(plano, reservados) {
  const p = normalizar(plano);
  const porId = new Map((reservados || []).map(r => [r.id, r]));
  const porNombre = new Map((reservados || []).map(r => [String(r.nombre).toUpperCase(), r]));
  const usados = new Set(p.elementos.filter(e => e.reservadoId && porId.has(e.reservadoId)).map(e => e.reservadoId));
  return { ...p, elementos: p.elementos.map(e => {
    if (e.tipo !== "mesa") return e;
    let r = e.reservadoId ? porId.get(e.reservadoId) : null;
    if (!r && e.ref) { const c = porNombre.get(String(e.ref).toUpperCase()); if (c && !usados.has(c.id)) { r = c; usados.add(c.id); } }
    if (!r) { const { reservadoId, ...resto } = e; return resto; }
    return { ...e, reservadoId: r.id, ref: r.nombre };
  }) };
}

// Reservados que aún no están en el plano
export function sinColocar(plano, reservados) {
  const puestos = new Set((plano?.elementos || []).filter(e => e.reservadoId).map(e => e.reservadoId));
  return (reservados || []).filter(r => !puestos.has(r.id));
}

// Coloca en fila los reservados que falten (de izquierda a derecha, de arriba abajo, sin pisar nada)
export function colocarReservados(plano, reservados) {
  const p = normalizar(plano);
  const faltan = sinColocar(p, reservados);
  const sep = 0.6;
  let x = 1, y = 1;
  const out = [...p.elementos];
  const choca = (a) => out.some(b => b.tipo !== "carpa" && b.tipo !== "zona" && b.tipo !== "pista" && a.x < b.x + b.w + 0.1 && a.x + a.w + 0.1 > b.x && a.y < b.y + b.h + 0.1 && a.y + a.h + 0.1 > b.y);
  for (const r of faltan) {
    const grande = r.tamano === "grande";
    const w = grande ? 2.6 : 1.8, h = grande ? 2 : 1.8;
    let el, intentos = 0;
    do {
      if (x + w > p.ancho - 0.5) { x = 1; y = r2(y + 2.6); }
      if (y + h > p.largo - 0.5) { y = 1; x = 1; break; }
      el = { id: nuevoId(), tipo: "mesa", w, h, x: ajustar(x), y: ajustar(y), rot: 0, forma: grande ? "sofa" : "redonda", reservadoId: r.id };
      x = r2(x + w + sep);
    } while (choca(el) && ++intentos < 200);
    out.push(el);
  }
  return { ...p, elementos: out };
}

// Plantillas de arranque (se pueden mover y cambiar todo después)
export function plantilla(clave) {
  const E = (tipo, x, y, extra) => ({ ...crear(tipo, 0, 0, extra), x, y });
  if (clave === "pueblo") return normalizar({ ancho: 40, largo: 28, elementos: [
    E("carpa", 4, 3, { w: 32, h: 20, texto: "Carpa" }), E("escenario", 14, 4, { w: 12, h: 5 }), E("pista", 10, 10, { w: 20, h: 9 }),
    E("barra", 5, 21, { w: 10 }), E("barra", 25, 21, { w: 10 }), E("zona", 31, 4, { w: 5, h: 15, texto: "Zona VIP" }),
    E("entrada", 18, 27.3, { w: 4 }), E("aseos", 1, 1), E("arbol", 1, 24), E("arbol", 37, 24), E("foodtruck", 34, 24.5),
  ] });
  if (clave === "festival") return normalizar({ ancho: 80, largo: 50, elementos: [
    E("escenario", 30, 2, { w: 20, h: 7 }), E("pantalla", 24, 4, { w: 4, h: 0.4 }), E("pantalla", 52, 4, { w: 4, h: 0.4 }), E("pista", 22, 11, { w: 36, h: 20, texto: "Front stage" }),
    E("zona", 60, 10, { w: 16, h: 18, texto: "Zona VIP" }), E("barra", 4, 14, { w: 12 }), E("barra", 4, 30, { w: 12 }), E("barra", 62, 32, { w: 12 }),
    E("cabina", 37, 34, { w: 6, h: 3, texto: "Control FOH" }), E("entrada", 36, 49.3, { w: 8 }), E("salida", 0.2, 40, { w: 0.5, h: 4 }), E("salida", 79.3, 40, { w: 0.5, h: 4 }),
    E("aseos", 2, 42, { w: 8, h: 5 }), E("foodtruck", 14, 43), E("foodtruck", 21, 43), E("foodtruck", 50, 43), E("taquilla", 46, 46),
  ] });
  // Sala / discoteca
  return normalizar({ ancho: 22, largo: 16, elementos: [
    E("cabina", 9.5, 0.6), E("pista", 6, 3, { w: 10, h: 7 }), E("barra", 0.4, 4, { w: 1.2, h: 7, rot: 0 }), E("zona", 17, 1, { w: 4.6, h: 10, texto: "Zona VIP" }),
    E("escalera", 17.5, 12), E("aseos", 0.4, 12.4, { w: 4, h: 3.2 }), E("entrada", 9.5, 15.5, { w: 3 }), E("salida", 21.5, 13, { w: 0.5, h: 2 }),
    E("columna", 6, 11), E("columna", 15.4, 11), E("guardarropa", 5, 13.8, { w: 3, h: 1.6 }),
  ] });
}

// Colores de cada estado de un reservado (mismos que la vista de tarjetas)
export const COLOR_ESTADO = { libre: "#838aa0", pendiente: "#c084fc", reservado: "#ffb400", llegado: "#22d3a6", novino: "#ff4d4d" };

// ===================== CRM · CATEGORÍAS =====================
// Valores por defecto + lo que el usuario ha cambiado en Ajustes (nombre, icono, color, oculta, IVA habitual).
// Las pantallas leen siempre de aquí, así un cambio en Ajustes se ve en todo el CRM.

export const GRUPOS = [
  { k: "barra", t: "Barras", i: "glass", c: "#ff5a3c" },
  { k: "entradas", t: "Entradas", i: "ticket", c: "#a855f7" },
  { k: "merch", t: "Merchandising", i: "shirt", c: "#3b82f6" },
  { k: "patrocinio", t: "Patrocinios", i: "award", c: "#22d3a6" },
  { k: "otros", t: "Otros", i: "sparkle", c: "#ffb400" },
];
export const grupoInfo = (k) => GRUPOS.find(g => g.k === k) || GRUPOS[4];
// Cómo se ENSEÑAN los ingresos: todo lo del TPV junto (barras, taquilla, reservados y sus señales) y aparte
// lo apuntado o sincronizado (entradas de ticketeras, merch, patrocinios, otros). El tipo de cada punto del TPV
// («barra», «entradas»…) solo decide el IVA, no dónde se enseña.
export const GRUPOS_VISTA = [{ k: "tpv", t: "TPV", i: "pos", c: "#ff5a3c" }, ...GRUPOS.filter(g => g.k !== "barra")];
export const grupoVista = (g) => (g === "barra" || !GRUPOS_VISTA.some(x => x.k === g) ? "otros" : g);   // para lo apuntado a mano

export const TICKETERA_CAT = "Ticketera online";
export const OTRAS_CAT = "Otras ticketeras";   // ventas de entradas apuntadas a mano (con nº de entradas y canal)
export const CATS_ING = [
  { k: "Entradas anticipadas", g: "entradas", i: "ticket" },
  { k: TICKETERA_CAT, g: "entradas", i: "globe" },
  { k: "Otras ticketeras", g: "entradas", i: "ticket" },
  { k: "Merchandising", g: "merch", i: "shirt" },
  { k: "Patrocinio", g: "patrocinio", i: "award" },
  { k: "Subvención", g: "otros", i: "building" },
  { k: "Guardarropa", g: "otros", i: "hanger" },
  { k: "Otros", g: "otros", i: "sparkle" },
];

// iva = % habitual; factura = si normalmente viene con factura (se puede cambiar en cada gasto)
export const GCATS = [
  { k: "Espacio y permisos", i: "home", c: "#f97316", iva: 21, factura: true },
  { k: "Artistas", i: "mic", c: "#a855f7", iva: 21, factura: true },
  { k: "Producción técnica", i: "speaker", c: "#3b82f6", iva: 21, factura: true },
  { k: "Técnicos", i: "wrench", c: "#0ea5e9", iva: 21, factura: true },
  { k: "Personal", i: "users", c: "#22d3a6", iva: 0, factura: false },
  { k: "Barra y producto", i: "bottle", c: "#ff5a3c", iva: 10, factura: true },
  { k: "Marketing", i: "megaphone", c: "#ec4899", iva: 21, factura: true },
  { k: "Servicios", i: "shield", c: "#14b8a6", iva: 21, factura: true },
  { k: "Decoración y efectos", i: "sparkle", c: "#eab308", iva: 21, factura: true },
  { k: "Logística", i: "truck", c: "#8b5cf6", iva: 21, factura: true },
  { k: "Ticketing y pagos", i: "card", c: "#6366f1", iva: 21, factura: true },
  { k: "Administración", i: "file", c: "#94a3b8", iva: 21, factura: true },
  { k: "Imprevistos", i: "alert", c: "#ef4444", iva: 0, factura: false },
  { k: "Otros", i: "dots", c: "#838aa0", iva: 21, factura: true },
];
// Categorías automáticas (no se editan: salen del TPV o de Ajustes)
export const CAJA_CAT = "Caja de las barras";
export const COMIS_CAT = "Comisiones";
export const IVA_CAT = "IVA a Hacienda";
const AUTO = {
  [CAJA_CAT]: { k: CAJA_CAT, i: "cash", c: "#ffb400", iva: 0, factura: false, auto: true },
  [COMIS_CAT]: { k: COMIS_CAT, i: "percent", c: "#f43f5e", iva: 0, factura: false, auto: true },
  [IVA_CAT]: { k: IVA_CAT, i: "bank", c: "#64748b", iva: 0, factura: false, auto: true },
};
export const esAuto = (k) => !!AUTO[k];

export const ICONOS_CAT = ["ticket", "globe", "glass", "bottle", "shirt", "award", "building", "hanger", "sparkle", "home", "mic", "speaker", "wrench", "users", "megaphone", "shield", "truck", "card", "file", "alert", "cash", "bank", "store", "calendar", "phone", "hand", "dots"];
export const COLORES_CAT = ["#ff5a3c", "#f97316", "#eab308", "#22d3a6", "#14b8a6", "#0ea5e9", "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#ec4899", "#ef4444", "#94a3b8", "#838aa0"];

// ---- Registro con los cambios del usuario ----
let CFG = { ingreso: null, gasto: null };
export function setCategorias(cfg) { CFG = { ingreso: cfg?.ingreso?.length ? cfg.ingreso : null, gasto: cfg?.gasto?.length ? cfg.gasto : null }; }
const conColor = (c) => ({ ...c, c: c.c || grupoInfo(c.g).c });
export const catsIngreso = (soloVisibles) => { const l = (CFG.ingreso || CATS_ING).map(conColor); return soloVisibles ? l.filter(c => !c.oculta) : l; };
export const catsGasto = (soloVisibles) => { const l = CFG.gasto || GCATS; return soloVisibles ? l.filter(c => !c.oculta) : l; };
export const catInfo = (k) => catsIngreso().find(c => c.k === k) || (CATS_ING.find(c => c.k === k) && conColor(CATS_ING.find(c => c.k === k))) || { k, g: "otros", i: "sparkle", c: "#ffb400" };
export const gcatInfo = (k) => AUTO[k] || catsGasto().find(c => c.k === k) || GCATS.find(c => c.k === k) || { k, i: "dots", c: "#838aa0", iva: 21, factura: true };

export const fuenteAuto = (p) => /taquill|entrada|ticket/i.test(p.name) ? "entradas" : /merch|camiset/i.test(p.name) ? "merch" : "barra";

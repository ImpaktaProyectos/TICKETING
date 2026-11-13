// ===================== CIERRE DE LA NOCHE · cálculo =====================
// Todo lo que ha entrado (ventas del TPV) y salido (gastos de caja) en un evento, clasificado.
// Solo lee: no cambia ventas, gastos ni cierres. Lo usan la pantalla de Informes y el PDF.
import { deudasEvento, porSocio, aportacionesPorSocio } from "./dineroSocios.js";

const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const sin = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Categorías de los gastos de caja. «Retirada de efectivo» no es un gasto: es dinero que se saca del cajón (a la caja fuerte…).
export const CATS_GASTO = [
  { k: "proveedores", t: "Proveedores", c: "#3b82f6", alias: ["proveedor"] },
  { k: "hielo", t: "Hielo", c: "#22d3ee", alias: ["hielo"] },
  { k: "compras", t: "Compras", c: "#a855f7", alias: ["compra", "super", "mercadona"] },
  { k: "personal", t: "Personal", c: "#f97316", alias: ["personal", "camarer", "sueldo", "nomina", "extra"] },
  { k: "artistas", t: "Artistas y DJ", c: "#ec4899", alias: ["dj", "artista", "cache", "grupo"] },
  { k: "seguridad", t: "Seguridad", c: "#14b8a6", alias: ["seguridad", "portero", "vigilan"] },
  { k: "limpieza", t: "Limpieza", c: "#84cc16", alias: ["limpieza"] },
  { k: "transporte", t: "Transporte", c: "#eab308", alias: ["taxi", "transporte", "gasolina", "uber", "parking"] },
  { k: "retirada", t: "Retirada de efectivo", c: "#94a3b8", alias: ["retirada"], noGasto: true },
  { k: "otros", t: "Otros", c: "#64748b", alias: [] },
];
const POR_K = Object.fromEntries(CATS_GASTO.map(c => [c.k, c]));
// Categoría de un gasto: la elegida al registrarlo; en los antiguos (sin categoría) se deduce del concepto
export function categoriaDe(g) {
  if (g.categoria && POR_K[g.categoria]) return POR_K[g.categoria];
  const t = sin(g.concepto);
  return CATS_GASTO.find(c => c.alias.some(a => t.includes(a))) || POR_K.otros;
}

const esInvitacion = (s) => !!s.invite || /^invitacion/.test(s.pago || "");
const esEntrada = (g) => g.tipo === "entrada";

// ev: { puntos: [{ id, name }] } · sales y gastos del evento · reservados y devoluciones (opcionales)
export function resumenNoche({ ev, sales = [], gastos = [], reservados = [], devoluciones = [], aportaciones = [] }) {
  const nombreBarra = (id) => ev?.puntos?.find(p => p.id === id)?.name || "Sin barra";
  const vivas = sales.filter(s => !s.voided);
  const ventas = vivas.filter(s => !esInvitacion(s));
  const sum = (xs, f = (x) => x.price) => r2(xs.reduce((t, x) => t + (Number(f(x)) || 0), 0));

  // ---------- Ingresos ----------
  const barras = new Map();
  ventas.forEach(s => {
    const b = barras.get(s.puntoId) || { id: s.puntoId, nombre: nombreBarra(s.puntoId), total: 0, efectivo: 0, tarjeta: 0, tickets: 0 };
    b.total = r2(b.total + s.price); b.tickets++;
    if (s.pago === "efectivo") b.efectivo = r2(b.efectivo + s.price); else if (s.pago === "tarjeta") b.tarjeta = r2(b.tarjeta + s.price);
    barras.set(s.puntoId, b);
  });
  const productos = new Map();
  ventas.forEach(s => { const k = s.name || "—"; const p = productos.get(k) || { nombre: k, uds: 0, total: 0 }; p.uds++; p.total = r2(p.total + s.price); productos.set(k, p); });
  const inv = vivas.filter(esInvitacion);
  const anuladas = sales.filter(s => s.voided);
  const efectivo = sum(ventas.filter(s => s.pago === "efectivo")), tarjeta = sum(ventas.filter(s => s.pago === "tarjeta"));
  const total = sum(ventas);
  const ingresos = {
    total, tickets: ventas.length, efectivo, tarjeta, sinMetodo: r2(total - efectivo - tarjeta),
    porBarra: [...barras.values()].sort((a, b) => b.total - a.total),
    porProducto: [...productos.values()].sort((a, b) => b.total - a.total || b.uds - a.uds),
    invitaciones: { n: inv.length, valor: sum(inv, s => s.inviteValue || s.price || 0) },
    anuladas: { n: anuladas.length, valor: sum(anuladas) },
    sociosEfectivo: sum(ventas.filter(s => s.pago === "efectivo" && /^SOCIO:/.test(s.operario || ""))),
  };

  // ---------- Gastos y movimientos de caja ----------
  const movs = gastos.filter(g => !g.voided);
  const salidas = movs.filter(g => !esEntrada(g)).map(g => ({ ...g, cat: categoriaDe(g), barra: nombreBarra(g.puntoId) }));
  const cats = new Map();
  salidas.forEach(g => { const c = cats.get(g.cat.k) || { ...g.cat, total: 0, n: 0, items: [] }; c.total = r2(c.total + g.importe); c.n++; c.items.push(g); cats.set(g.cat.k, c); });
  const porCategoria = [...cats.values()].map(c => ({ ...c, items: c.items.sort((a, b) => a.ts - b.ts) })).sort((a, b) => (a.noGasto ? 1 : 0) - (b.noGasto ? 1 : 0) || b.total - a.total);
  const gastosReales = porCategoria.filter(c => !c.noGasto);
  const g = {
    total: r2(gastosReales.reduce((t, c) => t + c.total, 0)),
    n: gastosReales.reduce((t, c) => t + c.n, 0),
    retiradas: r2(porCategoria.filter(c => c.noGasto).reduce((t, c) => t + c.total, 0)),
    porCategoria,
    cambio: sum(movs.filter(esEntrada), x => x.importe),
    cambioLista: movs.filter(esEntrada).map(x => ({ ...x, barra: nombreBarra(x.puntoId) })).sort((a, b) => a.ts - b.ts),
  };

  // ---------- Reservados y socios ----------
  const conSenal = reservados.filter(r => r.estado !== "libre" && Number(r.senal) > 0);
  const senales = {
    total: sum(conSenal, r => r.senal), n: conSenal.length,
    deSocios: sum(conSenal.filter(r => String(r.senalSocio || "").trim()), r => r.senal),
  };
  const deudas = deudasEvento({ reservados, sales, devoluciones });
  const socios = porSocio(deudas);
  // Cambio que han puesto los socios: no es ingreso ni gasto, es lo que hay que devolverles
  const cambioSocios = aportacionesPorSocio(aportaciones || []);

  return {
    ingresos, gastos: g, senales, socios,
    sociosPendiente: r2(socios.reduce((t, s) => t + s.pendiente, 0)),
    cambioSocios, cambioPendiente: r2(cambioSocios.reduce((t, s) => t + s.pendiente, 0)),
    resultado: r2(total - g.total),                                  // lo que deja la noche en el TPV (sin fondo ni señales)
    // Efectivo que debería quedar en los cajones (sin el fondo): el de las ventas sin ticket de los socios no está en el cajón
    efectivoNeto: r2(efectivo - ingresos.sociosEfectivo - g.total - g.retiradas + g.cambio),
  };
}

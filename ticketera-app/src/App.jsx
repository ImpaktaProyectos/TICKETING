import React, { useReducer, useState, useMemo, useEffect, useRef } from "react";
import { uid } from "./supabase";
import { logout } from "./auth";
import * as db from "./db";
import { nextFolios, prefijoDePunto, peekFolio, getDeviceTag, resetFolios, seedFolio } from "./folio";

/* ============================================================================
   TIXFAST — TPV de tickets para eventos
   Mejoras implementadas, por orden de prioridad:
   1. Offline-first + sincronización (simulada; en prod = cola local + Supabase)
   2. Multi-dispositivo en vivo (panel consolidado de todos los puntos)
   3. Control de anulaciones (registro, motivo, no se borra; cuenta en informes)
   4. Cierre Z por punto de venta (snapshot + ticket de cierre)
   5. Reimpresión del último ticket (sin generar venta)
   6. Multiplicador de cantidad (x1/x2/x3/x5/x10)
   7. Marcar producto agotado
   8. Numeración correlativa de tickets (Nº por evento)
   9. Logo en el ticket: imagen subida por el usuario
   11. Curva de ventas por hora + ranking de productos
   12. Rol intermedio Supervisor (ve TPV+informes, anula y cierra; no toca config)
   ========================================================================== */

const PALETTE = ["#ff5a5f", "#ffb400", "#22d3a6", "#3b82f6", "#a855f7", "#ec4899", "#f97316", "#14b8a6", "#eab308", "#6366f1"];
const money = (n) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n || 0);
const timeNow = () => new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dateFmt = (iso) => { try { return new Date(iso + "T00:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" }); } catch { return iso; } };
const shortCode = (id) => String(id).slice(0, 6).toUpperCase();
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const APP_VERSION = "2026.10.29c";   // súbela al publicar cambios para verificar la actualización

// Detecta pantalla pequeña (móvil) para adaptar el layout
function useIsMobile(bp = 720) {
  const [m, setM] = useState(typeof window !== "undefined" ? window.innerWidth <= bp : false);
  useEffect(() => { const f = () => setM(window.innerWidth <= bp); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, [bp]);
  return m;
}

/* ---------------------- Estado inicial (se hidrata desde Supabase) ---------------------- */
const emptyState = () => ({ events: [], currentEventId: null, currentPuntoId: null, sales: [], closures: [], adminPin: "1234", supervisorPin: "0000", online: typeof navigator !== "undefined" ? navigator.onLine : true });
const EMPTY_EV = { id: null, name: "", date: "", venue: "", template: "festival", paper: 80, footer: "", logo: "", showEventName: true, showDate: true, showTime: true, showPrice: true, anularPin: false, closed: false, startsAt: "", advanced: false, changeHelp: true, style: {}, pin_admin: "1234", pin_supervisor: "0000", puntos: [{ id: null, name: "", archivado: false, products: [] }] };

/* ---------------------- Reducer ---------------------- */
function reducer(state, a) {
  const mapEv = (fn) => state.events.map(e => e.id === a.eventId ? fn(e) : e);
  const mapPunto = (e, fn) => ({ ...e, puntos: e.puntos.map(p => p.id === a.puntoId ? fn(p) : p) });
  switch (a.type) {
    case "ADD_EVENT": return { ...state, events: [...state.events, a.event], currentEventId: a.event.id, currentPuntoId: a.event.puntos[0]?.id };
    case "SELECT_EVENT": { const e = state.events.find(x => x.id === a.id); return { ...state, currentEventId: a.id, currentPuntoId: e?.puntos[0]?.id }; }
    case "UPDATE_EVENT": return { ...state, events: state.events.map(e => e.id === a.id ? { ...e, ...a.patch } : e) };
    case "ADD_PUNTO": return { ...state, events: mapEv(e => ({ ...e, puntos: [...e.puntos, a.punto] })), currentPuntoId: a.punto.id };
    case "ARCHIVE_PUNTO": {
      const events = mapEv(e => mapPunto(e, p => ({ ...p, archivado: a.value })));
      let np = state.currentPuntoId;
      if (a.value && state.currentPuntoId === a.puntoId) {
        const e0 = events.find(e => e.id === a.eventId);
        np = (e0.puntos.find(p => !p.archivado) || e0.puntos[0]).id;
      }
      return { ...state, events, currentPuntoId: np };
    }
    case "DELETE_PUNTO": {
      const e0 = state.events.find(e => e.id === a.eventId);
      if (e0.puntos.length <= 1) return state;                       // siempre debe quedar uno
      if (state.sales.some(s => s.puntoId === a.puntoId)) return state; // con ventas no se borra (se archiva)
      const events = mapEv(e => ({ ...e, puntos: e.puntos.filter(p => p.id !== a.puntoId) }));
      const np = state.currentPuntoId === a.puntoId ? (events.find(e => e.id === a.eventId).puntos.find(p => !p.archivado) || events.find(e => e.id === a.eventId).puntos[0]).id : state.currentPuntoId;
      return { ...state, events, currentPuntoId: np };
    }
    case "UPDATE_PUNTO": return { ...state, events: mapEv(e => mapPunto(e, p => ({ ...p, ...a.patch }))) };
    case "CLOSE_PUNTO_SALES": return { ...state, sales: state.sales.map(s => (s.eventId === a.eventId && s.puntoId === a.puntoId && !s.closureId) ? { ...s, closureId: a.closureId } : s) };
    case "SET_PUNTO": return { ...state, currentPuntoId: a.id };
    case "ADD_PRODUCT": return { ...state, events: mapEv(e => mapPunto(e, p => ({ ...p, products: [...p.products, a.product] }))) };
    case "REORDER_PRODUCTS": return { ...state, events: mapEv(e => mapPunto(e, p => { const byId = new Map(p.products.map(x => [x.id, x])); const next = a.ids.map((id, i) => byId.has(id) ? { ...byId.get(id), orden: i } : null).filter(Boolean); p.products.forEach(x => { if (!a.ids.includes(x.id)) next.push(x); }); return { ...p, products: next }; })) };
    case "UPDATE_PRODUCT": return { ...state, events: mapEv(e => mapPunto(e, p => ({ ...p, products: p.products.map(x => x.id === a.productId ? { ...x, ...a.patch } : x) }))) };
    case "DELETE_PRODUCT": return { ...state, events: mapEv(e => mapPunto(e, p => ({ ...p, products: p.products.filter(x => x.id !== a.productId) }))) };
    case "SELL": return { ...state, sales: [...state.sales, ...a.rows] };
    case "VOID_LAST": {
      for (let i = state.sales.length - 1; i >= 0; i--) {
        const s = state.sales[i];
        if (s.eventId === a.eventId && s.puntoId === a.puntoId && !s.voided) {
          const copy = [...state.sales]; copy[i] = { ...s, voided: true, voidTs: Date.now(), voidBy: a.by }; return { ...state, sales: copy };
        }
      } return state;
    }
    case "VOID_ONE": return { ...state, sales: state.sales.map(s => s.id === a.saleId ? { ...s, voided: true, voidTs: Date.now(), voidBy: a.by } : s) };
    case "SET_ONLINE": return { ...state, online: a.online };
    case "SYNC_ALL": return { ...state, sales: state.sales.map(s => s.synced ? s : { ...s, synced: true }) };
    case "ADD_CLOSURE": return { ...state, closures: [...state.closures, a.closure] };
    case "SET_ADMIN_PIN": return { ...state, adminPin: a.pin };
    case "SET_SUPERVISOR_PIN": return { ...state, supervisorPin: a.pin };
    case "HYDRATE": return { ...state, ...a.payload };
    case "HYDRATE_SALES": return { ...state, sales: a.sales };
    default: return state;
  }
}

/* ============================================================
   THERMAL TICKET
   ============================================================ */
function ThermalTicket({ ev, product, time, num, qty = 1, code, folio }) {
  const mm = ev.paper === 58 ? 48 : 72;          // ancho imprimible real del rollo
  const st = ev.style || {};
  const nd = st.nameSize === "xl" ? 18 : st.nameSize === "lg" ? 8 : 0;  // tamaño del nombre
  const big = (ev.paper === 58 ? 28 : 40) + nd;                          // el NOMBRE manda
  const priceSize = Math.max(16, big - 14);                             // precio, secundario
  const logoMax = st.logoSize === "sm" ? 30 : st.logoSize === "lg" ? 62 : 42;
  const logoTxt = st.logoSize === "sm" ? 18 : st.logoSize === "lg" ? 32 : 24;
  const showFolio = st.showFolio !== false;
  const ref = showFolio ? (folio ? "Folio " + folio : (num != null ? "Nº " + String(num).padStart(4, "0") : "")) : "";
  const base = { fontFamily: "'Roboto Mono', ui-monospace, monospace", color: "#000", background: "#fff", width: mm + "mm", padding: "1.5mm 2mm 2.5mm", boxSizing: "border-box", lineHeight: 1.25, fontWeight: 700 };
  const dashed = <div style={{ borderTop: "2px dashed #000", margin: "2mm 0" }} />;
  const Name = ({ size, align = "center" }) => <div style={{ fontWeight: 900, fontSize: size, letterSpacing: -0.3, textAlign: align, lineHeight: 1.04, color: "#000", wordBreak: "break-word" }}>{product?.name || "NOMBRE TICKET"}</div>;
  const Logo = () => {
    if (!ev.logo || st.showLogo === false) return null;
    const isImg = typeof ev.logo === "string" && /^(data:|https?:)/.test(ev.logo);
    return isImg
      ? <div style={{ textAlign: "center", marginBottom: "1mm" }}><img src={ev.logo} alt="" style={{ maxHeight: logoMax, maxWidth: "70%", filter: "grayscale(1) contrast(3) brightness(.9)" }} /></div>
      : <div style={{ textAlign: "center", fontWeight: 900, fontSize: logoTxt, letterSpacing: 1, marginBottom: "1mm", color: "#000" }}>{ev.logo}</div>;
  };
  const Sub = () => st.subtitle ? <div style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "#000" }}>{st.subtitle}</div> : null;
  const priceLine = ev.showPrice && !(qty > 1) && <div style={{ textAlign: "center", fontWeight: 800, fontSize: priceSize, marginTop: "1.5mm", color: "#000" }}>{money(product?.price)}</div>;
  const qtyLine = qty > 1 && <div style={{ textAlign: "center", fontWeight: 900, fontSize: 16, marginTop: "1.5mm", color: "#000" }}>{qty} × {money(product?.price)} = {money(product?.price * qty)}</div>;
  const metaStyle = { fontSize: 12, color: "#000", fontWeight: 700 };

  let inner;
  if (ev.template === "festival") {
    inner = (<>
      <Logo />
      {ev.showEventName && <div style={{ textAlign: "center", fontWeight: 800, fontSize: 13, textTransform: "uppercase", color: "#000" }}>{ev.name}</div>}
      <Sub />
      {ev.venue && <div style={{ textAlign: "center", fontSize: 11, color: "#000", fontWeight: 600 }}>{ev.venue}</div>}
      {dashed}
      <div style={{ border: "3px solid #000", textAlign: "center", padding: "3mm 2mm", borderRadius: 2 }}><Name size={big} />{priceLine}{qtyLine}</div>
      {dashed}
      <div style={{ display: "flex", justifyContent: "space-between", ...metaStyle }}>{ev.showDate && <span>{dateFmt(ev.date).split(" de ")[0]}/{ev.date.slice(5, 7)}</span>}{ev.showTime && <span>{time}</span>}</div>
      {ref && <div style={{ ...metaStyle, marginTop: "1mm" }}>{ref}</div>}
      {ev.footer && <div style={{ textAlign: "center", fontSize: 11, color: "#000", marginTop: "1.5mm", fontWeight: 600 }}>{ev.footer}</div>}
    </>);
  } else if (ev.template === "bold") {
    inner = (<>
      <Logo />
      <div style={{ textAlign: "center", border: "3px solid #000", padding: "3mm 2mm", borderRadius: 4 }}>
        <Name size={big + 2} />{priceLine}{qtyLine}
      </div>
      {ev.showEventName && <div style={{ textAlign: "center", fontWeight: 800, fontSize: 13, marginTop: "2mm", color: "#000" }}>{ev.name}</div>}
      <Sub />
      <div style={{ textAlign: "center", ...metaStyle, marginTop: "1mm" }}>{ev.showDate && dateFmt(ev.date)}{ev.showTime && ` · ${time}`}</div>
      {ref && <div style={{ textAlign: "center", ...metaStyle }}>{ref}</div>}
      {ev.footer && <div style={{ textAlign: "center", fontSize: 11, color: "#000", marginTop: "2mm", borderTop: "2px solid #000", paddingTop: "1.5mm", fontWeight: 600 }}>{ev.footer}</div>}
    </>);
  } else if (ev.template === "minimal") {
    inner = (<>
      <Logo />
      {ev.showEventName && <div style={{ fontSize: 12, color: "#000", letterSpacing: 1, textTransform: "uppercase", fontWeight: 700 }}>{ev.name}</div>}
      {st.subtitle && <div style={{ fontSize: 11, fontWeight: 700 }}>{st.subtitle}</div>}
      <div style={{ height: "2mm" }} />
      <Name size={big - 2} align="left" />
      {ev.showPrice && !(qty > 1) && <div style={{ fontWeight: 800, fontSize: priceSize, marginTop: "1.5mm" }}>{money(product?.price)}</div>}
      {qtyLine}
      <div style={{ ...metaStyle, marginTop: "2mm" }}>{ev.showDate && dateFmt(ev.date)}{ev.showTime && ` — ${time}`}{ref && ` · ${ref}`}</div>
      {ev.footer && <div style={{ fontSize: 11, color: "#000", marginTop: "2mm", fontWeight: 600 }}>{ev.footer}</div>}
    </>);
  } else if (ev.template === "clasico") {
    inner = (<>
      <Logo />
      {ev.showEventName && <div style={{ textAlign: "center", fontWeight: 900, fontSize: 14, textTransform: "uppercase", letterSpacing: 1, color: "#000" }}>★ {ev.name} ★</div>}
      <Sub />
      {dashed}
      <Name size={big} />
      {priceLine}{qtyLine}
      {dashed}
      <div style={{ display: "flex", justifyContent: "space-between", ...metaStyle }}>{ev.showDate && <span>{dateFmt(ev.date)}</span>}{ev.showTime && <span>{time}</span>}</div>
      {ev.venue && <div style={{ textAlign: "center", fontSize: 11, fontWeight: 600, marginTop: "1mm" }}>{ev.venue}</div>}
      {ref && <div style={{ textAlign: "center", ...metaStyle, marginTop: "1mm" }}>{ref}</div>}
      {ev.footer && <div style={{ textAlign: "center", fontSize: 11, color: "#000", marginTop: "1.5mm", fontWeight: 600 }}>{ev.footer}</div>}
    </>);
  } else if (ev.template === "vale") {
    inner = (<>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 900, fontSize: 12, border: "2px solid #000", borderRadius: 3, padding: "0.5mm 2mm" }}>VALE</div>
        {ev.showEventName && <div style={{ fontSize: 11, fontWeight: 700, textAlign: "right", flex: 1, marginLeft: "2mm" }}>{ev.name}</div>}
      </div>
      <div style={{ height: "2mm" }} />
      <Name size={big + 4} align="left" />
      {ev.showPrice && !(qty > 1) && <div style={{ fontWeight: 800, fontSize: priceSize, marginTop: "1.5mm" }}>{money(product?.price)}</div>}
      {qtyLine}
      <Sub />
      <div style={{ borderTop: "2px dashed #000", margin: "2mm 0" }} />
      <div style={{ ...metaStyle }}>{ev.showDate && dateFmt(ev.date)}{ev.showTime && ` · ${time}`}{ref && ` · ${ref}`}</div>
      {ev.footer && <div style={{ fontSize: 11, color: "#000", marginTop: "1mm", fontWeight: 600 }}>{ev.footer}</div>}
    </>);
  } else { // sello (con código)
    inner = (<>
      <Logo />
      {ev.showEventName && <div style={{ textAlign: "center", fontWeight: 800, fontSize: 13, color: "#000" }}>{ev.name}</div>}
      <Sub />
      {dashed}
      <Name size={big - 2} />
      {priceLine}{qtyLine}
      <div style={{ border: "2px solid #000", borderRadius: 3, textAlign: "center", fontSize: 16, letterSpacing: 2, fontWeight: 900, marginTop: "2mm", padding: "1.5mm 0" }}>{folio || shortCode(code || product?.id)}</div>
      <div style={{ textAlign: "center", ...metaStyle, marginTop: "1.5mm" }}>{ev.showDate && dateFmt(ev.date)} {ev.showTime && time}</div>
      {ev.footer && <div style={{ textAlign: "center", fontSize: 11, color: "#000", marginTop: "1.5mm", fontWeight: 600 }}>{ev.footer}</div>}
    </>);
  }
  return (
    <div style={{ ...base, ...(st.border ? { border: "2px solid #000", borderRadius: 4 } : {}) }}>
      {inner}
      {st.message && <div style={{ marginTop: "2mm", textAlign: "center", fontWeight: 900, fontSize: 13, border: "2px solid #000", borderRadius: 3, padding: "1.5mm 2mm", textTransform: "uppercase" }}>{st.message}</div>}
    </div>
  );
}

/* ---------------------- Ticket de cierre Z ---------------------- */
function ZTicket({ ev, z }) {
  const mm = ev.paper === 58 ? 48 : 72;
  const row = { display: "flex", justifyContent: "space-between", fontSize: 12, color: "#000", fontWeight: 700 };
  return (
    <div style={{ fontFamily: "'Roboto Mono', monospace", color: "#000", background: "#fff", width: mm + "mm", padding: "1.5mm 2mm 2.5mm", boxSizing: "border-box", lineHeight: 1.3, fontWeight: 700 }}>
      <div style={{ textAlign: "center", fontWeight: 900, fontSize: 20, color: "#000" }}>CIERRE Z</div>
      <div style={{ textAlign: "center", fontSize: 12, color: "#000" }}>{ev.name}</div>
      <div style={{ textAlign: "center", fontSize: 13, fontWeight: 900, marginTop: "1mm", color: "#000" }}>{z.puntoName}</div>
      <div style={{ borderTop: "2px dashed #000", margin: "2mm 0" }} />
      {z.lines.map((l, i) => <div key={i} style={row}><span>{l.name} ×{l.qty}</span><span>{money(l.total)}</span></div>)}
      <div style={{ borderTop: "2px dashed #000", margin: "2mm 0" }} />
      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900, fontSize: 16, color: "#000" }}><span>TOTAL</span><span>{money(z.revenue)}</span></div>
      {z.advanced && (<>
        <div style={{ borderTop: "2px dashed #000", margin: "2mm 0" }} />
        <div style={{ textAlign: "center", fontWeight: 900, fontSize: 13 }}>ARQUEO DE CAJA</div>
        <div style={{ ...row, marginTop: "1mm" }}><span>Fondo inicial</span><span>{money(z.fondo || 0)}</span></div>
        <div style={row}><span>+ Ventas efectivo</span><span>{money(z.efectivo || 0)}</span></div>
        <div style={{ ...row, fontSize: 14, borderTop: "2px solid #000", marginTop: "1mm", paddingTop: "1mm" }}><span>= DEBE HABER</span><span>{money(z.esperado != null ? z.esperado : (z.fondo || 0) + (z.efectivo || 0))}</span></div>
        {z.contado != null && (<>
          <div style={{ ...row, marginTop: "1mm" }}><span>Contado</span><span>{money(z.contado)}</span></div>
          <div style={{ ...row, fontSize: 15, fontWeight: 900 }}><span>{z.descuadre === 0 ? "CUADRA ✓" : z.descuadre > 0 ? "SOBRA" : "FALTA"}</span><span>{z.descuadre === 0 ? money(0) : money(Math.abs(z.descuadre))}</span></div>
        </>)}
        <div style={{ ...row, marginTop: "1.5mm" }}><span>Tarjeta (no en cajón)</span><span>{money(z.tarjeta || 0)}</span></div>
      </>)}
      <div style={{ ...row, marginTop: "1mm" }}><span>Tickets</span><span>{z.count}</span></div>
      <div style={row}><span>Anulaciones</span><span>{z.voids}</span></div>
      <div style={{ textAlign: "center", fontSize: 11, color: "#000", marginTop: "2mm", fontWeight: 600 }}>{new Date(z.ts).toLocaleString("es-ES")}</div>
    </div>
  );
}

/* ============================================================
   APP
   ============================================================ */
export default function App() {
  const [state, baseDispatch] = useReducer(reducer, undefined, emptyState);
  const stateRef = useRef(state); stateRef.current = state;
  const dispatch = (action) => { baseDispatch(action); db.persistAction(action, { eventId: stateRef.current.currentEventId }); };

  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState(null);
  const [view, setView] = useState("pos");
  const [toast, setToast] = useState(null);
  const [printJob, setPrintJob] = useState(null);
  const [showRevenue, setShowRevenue] = useState(false);
  const [askRevenue, setAskRevenue] = useState(false);
  const [askVoidPin, setAskVoidPin] = useState(false);
  const [printer, setPrinter] = useState("live");
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [pending, setPending] = useState(db.pendingCount());
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [showCheck, setShowCheck] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [payFlow, setPayFlow] = useState(null);   // cobro avanzado en curso

  const ev = state.events.find(e => e.id === state.currentEventId) || state.events[0] || EMPTY_EV;
  const activePuntos = ev.puntos.filter(p => !p.archivado);
  const punto = ev.puntos.find(p => p.id === state.currentPuntoId && !p.archivado) || activePuntos[0] || ev.puntos[0];
  const evSales = useMemo(() => state.sales.filter(s => s.eventId === ev.id), [state.sales, ev.id]);
  const livePuntoSales = useMemo(() => evSales.filter(s => s.puntoId === punto.id && !s.voided && !s.closureId), [evSales, punto.id]);
  const totals = useMemo(() => {
    const perProduct = {}; let revenue = 0;
    livePuntoSales.forEach(s => { perProduct[s.productId] = (perProduct[s.productId] || 0) + 1; revenue += s.price; });
    return { perProduct, revenue: round2(revenue), count: livePuntoSales.length };
  }, [livePuntoSales]);
  const rankCounts = useMemo(() => { const c = {}; evSales.forEach(s => { if (s.puntoId === punto.id && !s.voided) c[s.productId] = (c[s.productId] || 0) + 1; }); return c; }, [evSales, punto.id]);
  const eventRevenue = useMemo(() => round2(evSales.filter(s => !s.voided).reduce((t, s) => t + s.price, 0)), [evSales]);

  const flash = (msg, kind = "ok") => { setToast({ msg, kind }); setTimeout(() => setToast(null), 1700); };

  // Fusiona lo que viene del servidor con lo que aún está pendiente de subir en ESTE dispositivo
  const mergePending = (events, serverSales) => {
    const pend = db.pendingSaleUuids(), voids = db.pendingVoidUuids();
    const serverIds = new Set(serverSales.map(s => s.clientUuid).filter(Boolean));
    const local = stateRef.current.sales.filter(s => s.clientUuid && pend.has(s.clientUuid) && !serverIds.has(s.clientUuid));
    const sales = serverSales.concat(local).map(s => (s.clientUuid && voids.has(s.clientUuid)) ? { ...s, voided: true } : s);
    const evs = events.map(e => ({ ...e, puntos: e.puntos.map(p => { const f = db.pendingFondo(p.id); return f != null ? { ...p, fondo: f } : p; }) }));
    return { events: evs, sales };
  };

  const SNAP = db.scopedKey("ticketera_snapshot");
  const hydrate = async () => {
    let data;
    try {
      data = await db.loadAll();
      if (!data.events.length) { await db.ensureDefaultEvent(); data = await db.loadAll(); }
      try { localStorage.setItem(SNAP, JSON.stringify({ events: data.events, closures: data.closures, sales: data.sales.slice(-4000) })); } catch {}
    } catch (e) {
      // Sin conexión al arrancar: usamos la última copia guardada para poder vender igual
      const snap = (() => { try { return JSON.parse(localStorage.getItem(SNAP) || "null"); } catch { return null; } })();
      if (!snap || !snap.events?.length) throw e;
      data = snap;
      flash("Sin conexión · usando datos guardados", "warn");
    }
    const merged = mergePending(data.events, data.sales || []);
    // Continuidad: si cambias de ordenador, la numeración sigue donde iba (no vuelve a 0001)
    try {
      const tag = getDeviceTag();
      merged.events.forEach(e => e.puntos.forEach(p => {
        const pre = prefijoDePunto(p) + tag + "-";
        let max = 0;
        merged.sales.forEach(x => { if (x.puntoId === p.id && typeof x.code === "string" && x.code.startsWith(pre)) { const m = x.code.match(/-(\d+)/); if (m) max = Math.max(max, parseInt(m[1], 10)); } });
        if (max) seedFolio(e.id, p.id, max);
      }));
    } catch {}
    const first = merged.events.find(e => e.id === stateRef.current.currentEventId) || merged.events[0];
    baseDispatch({ type: "HYDRATE", payload: {
      events: merged.events, sales: merged.sales, closures: data.closures || [],
      currentEventId: stateRef.current.currentEventId || first.id,
      currentPuntoId: stateRef.current.currentPuntoId || (first.puntos.find(p => !p.archivado) || first.puntos[0])?.id,
    } });
  };
  useEffect(() => { (async () => {
    try { if (navigator.onLine) { await db.syncPending(); setPending(db.pendingCount()); } } catch {}
    try { await hydrate(); } catch (e) { console.error(e); flash("Error cargando datos", "warn"); }
    setLoading(false);
  })(); }, []);

  // Realtime: refresca las ventas del evento cuando cualquier barra vende o cierra
  useEffect(() => {
    if (!ev.id) return;
    let timer = null, busy = false;
    const refresh = async () => {
      if (busy) { timer = setTimeout(refresh, 2500); return; }
      busy = true;
      try {
        const server = await db.loadSales(ev.id);
        const { sales } = mergePending([], server);
        baseDispatch({ type: "HYDRATE_SALES", sales: stateRef.current.sales.filter(s => s.eventId !== ev.id).concat(sales) });
      } catch {} finally { busy = false; }
    };
    // Agrupa avisos: como mucho una recarga cada 2,5 s aunque vendan varias barras a la vez
    const unsub = db.subscribeEvento(ev.id, () => { if (!timer) timer = setTimeout(() => { timer = null; refresh(); }, 2500); });
    return () => { clearTimeout(timer); unsub(); };
  }, [ev.id]);

  // Conexión + cola offline (automático) + reintento periódico
  useEffect(() => {
    const trySync = async () => {
      if (!navigator.onLine || db.pendingCount() === 0) { setPending(db.pendingCount()); return; }
      const r = await db.syncPending(); setPending(db.pendingCount());
      if (r.synced) { flash(`✅ ${r.synced} operaciones sincronizadas`); if (r.remaining === 0) await hydrate().catch(() => {}); }
    };
    const on = async () => { setOnline(true); await trySync(); if (db.pendingCount() === 0) await hydrate().catch(() => {}); };
    const off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    const t = setInterval(trySync, 30000);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); clearInterval(t); };
  }, []);

  // ===== Copias de seguridad automáticas (foto con hora de cada barra) =====
  const [lastBackup, setLastBackup] = useState(db.lastBackupAt());
  const backupSig = useRef("");
  const makeBackup = async (manual = false) => {
    const st = stateRef.current;
    const e = st.events.find(x => x.id === st.currentEventId) || st.events[0];
    if (!e || !e.id) return;
    const es = st.sales.filter(x => x.eventId === e.id);
    const sum = (arr) => round2(arr.reduce((t, x) => t + x.price, 0));
    const ok = es.filter(x => !x.voided);
    const puntos = e.puntos.map(p => {
      const v = ok.filter(x => x.puntoId === p.id), turno = v.filter(x => !x.closureId);
      return { id: p.id, nombre: p.name, tickets: v.length, facturacion: sum(v), efectivo: sum(v.filter(x => x.pago === "efectivo")), tarjeta: sum(v.filter(x => x.pago === "tarjeta")), anulaciones: es.filter(x => x.puntoId === p.id && x.voided).length, fondo: p.fondo ?? null, turno: { tickets: turno.length, facturacion: sum(turno) } };
    });
    const datos = { app: APP_VERSION, evento: e.name, total: { tickets: ok.length, facturacion: sum(ok), efectivo: sum(ok.filter(x => x.pago === "efectivo")), tarjeta: sum(ok.filter(x => x.pago === "tarjeta")) }, puntos, pendientes_en_equipo: db.pendingCount() };
    const sig = JSON.stringify([e.id, datos.total, puntos.map(p => [p.tickets, p.facturacion, p.fondo, p.anulaciones])]);
    if (!manual && sig === backupSig.current) return;   // nada nuevo desde la última copia
    backupSig.current = sig;
    const r = await db.backupSnapshot(e.id, datos);
    setPending(db.pendingCount());
    if (!r.offline) setLastBackup(db.lastBackupAt());
    if (manual) flash(r.offline ? "💾 Copia guardada en el equipo · subirá al volver internet" : "☁️ Copia de seguridad subida", r.offline ? "warn" : "ok");
  };
  useEffect(() => {
    const first = setTimeout(() => makeBackup(false), 60000);          // primera copia al minuto de abrir
    const t = setInterval(() => makeBackup(false), 30 * 60000);       // y después cada 30 minutos
    const tick = setInterval(() => setLastBackup(db.lastBackupAt()), 60000);
    return () => { clearTimeout(first); clearInterval(t); clearInterval(tick); };
  }, []);

  // Venta = optimista (folio inmediato) + impresión + persistencia
  const sell = (product, qty = 1) => {
    if (!ev.id || !punto?.id) { flash("Sin datos del evento · conéctate a internet", "warn"); return; }
    if (product.soldOut) { flash("Producto agotado", "warn"); return; }
    if (ev.closed) { flash("Caja cerrada · no se puede vender", "warn"); return; }
    const time = timeNow();
    if (testMode) { setPrintJob({ kind: "ticket", product, time, num: null, folio: "PRUEBA", qty, n: Date.now() }); flash("🧪 Prueba (no cuenta)"); return; }
    // Venta avanzada: primero se cobra (efectivo/tarjeta + cambio), luego se imprime
    if (ev.advanced) { setPayFlow({ kind: "single", product, qty, total: round2(product.price * qty) }); return; }
    doSell(product, qty);
  };

  // Registra e imprime la venta (con datos de pago si vienen del cobro avanzado)
  const doSell = (product, qty = 1, pay = null) => {
    const time = timeNow();
    const folios = nextFolios(ev.id, punto.id, prefijoDePunto(punto), qty);
    const clientUuids = folios.map(() => uid());
    const baseNum = evSales.length;
    const rows = folios.map((f, i) => ({ id: clientUuids[i], clientUuid: clientUuids[i], code: f, num: baseNum + i + 1, eventId: ev.id, puntoId: punto.id, productId: product.id, name: product.name, price: product.price, ts: Date.now() + i, synced: online, voided: false, closureId: null, pago: pay?.pago || null, entregado: i === 0 ? (pay?.entregado ?? null) : null, cambio: i === 0 ? (pay?.cambio ?? null) : null }));
    baseDispatch({ type: "SELL", rows });
    setPrintJob({ kind: "ticket", product, time, num: rows[0].num, folio: rows[0].code, qty, n: Date.now() });
    if (navigator.vibrate) navigator.vibrate(25);
    flash(`🖨️ ${qty > 1 ? qty + "× " : ""}${product.name}`);
    db.vender({ eventoId: ev.id, puntoId: punto.id, producto: product, qty, operario: punto.name, folios, clientUuids, pago: pay?.pago || null, entregado: pay?.entregado ?? null, cambio: pay?.cambio ?? null }).then(r => { if (r.offline) setPending(db.pendingCount()); });
  };

  const reprint = () => { if (!printJob) { flash("Nada que reimprimir", "warn"); return; } setPrintJob({ ...printJob, n: Date.now() }); flash("🖨️ Reimprimiendo último ticket"); };

  const sellMany = (items) => {
    if (!ev.id || !punto?.id) { flash("Sin datos del evento · conéctate a internet", "warn"); return; }
    if (ev.closed) { flash("Caja cerrada · no se puede vender", "warn"); return; }
    const time = timeNow();
    if (testMode) {
      const tks = [];
      items.forEach(({ product, qty }) => { for (let i = 0; i < qty; i++) tks.push({ product, folio: "PRUEBA" }); });
      if (tks.length) { setPrintJob({ kind: "multi", tickets: tks, time, n: Date.now() }); flash("🧪 Prueba (no cuenta)"); }
      return;
    }
    const total = round2(items.reduce((t, it) => t + it.product.price * it.qty, 0));
    if (ev.advanced) { setPayFlow({ kind: "many", items, total }); return; }
    doSellMany(items);
  };

  const doSellMany = (items, pay = null) => {
    const time = timeNow();
    let n = evSales.length;
    const rows = []; const tickets = [];
    let first = true;
    items.forEach(({ product, qty }) => {
      const folios = nextFolios(ev.id, punto.id, prefijoDePunto(punto), qty);
      const clientUuids = folios.map(() => uid());
      folios.forEach((f, i) => { n++; rows.push({ id: clientUuids[i], clientUuid: clientUuids[i], code: f, num: n, eventId: ev.id, puntoId: punto.id, productId: product.id, name: product.name, price: product.price, ts: Date.now() + rows.length, synced: online, voided: false, closureId: null, pago: pay?.pago || null, entregado: (first && i === 0) ? (pay?.entregado ?? null) : null, cambio: (first && i === 0) ? (pay?.cambio ?? null) : null }); tickets.push({ product, num: n, folio: f }); });
      db.vender({ eventoId: ev.id, puntoId: punto.id, producto: product, qty, operario: punto.name, folios, clientUuids, pago: pay?.pago || null, entregado: first ? (pay?.entregado ?? null) : null, cambio: first ? (pay?.cambio ?? null) : null }).then(r => { if (r.offline) setPending(db.pendingCount()); });
      first = false;
    });
    if (!rows.length) return;
    baseDispatch({ type: "SELL", rows });
    setPrintJob({ kind: "multi", tickets, time, n: Date.now() });
    if (navigator.vibrate) navigator.vibrate(40);
    flash(`🖨️ ${tickets.length} tickets · ${money(rows.reduce((t, r) => t + r.price, 0))}`);
  };

  const voidLast = async (by) => {
    const last = evSales.filter(s => s.puntoId === punto.id && !s.voided && !s.closureId).sort((a, b) => b.ts - a.ts)[0];
    if (!last) { flash("No hay tickets que anular en este turno", "warn"); return; }
    baseDispatch({ type: "VOID_ONE", saleId: last.id, by });
    flash(`Anulado: ${last.name}`, "warn");
    const r = await db.anularVenta(last.clientUuid || last.id, by);
    if (r.offline) setPending(db.pendingCount());
  };
  const requestVoidCajero = () => { if (ev.anularPin) setAskVoidPin(true); else voidLast(punto.name); };

  // Venta avanzada desde el propio TPV (cobro con cálculo de cambio)
  const toggleAdvanced = () => {
    const on = !ev.advanced;
    dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: on ? { advanced: true, changeHelp: true } : { advanced: false } });
    flash(on ? "💶 Venta avanzada activada" : "Venta avanzada desactivada", on ? "ok" : "warn");
  };

  // Bono / oferta: registra UNA venta al precio del bono e imprime todos los vales de un clic
  const sellCombo = (combo) => {
    if (!ev.id || !punto?.id) { flash("Sin datos del evento · conéctate a internet", "warn"); return; }
    if (ev.closed) { flash("Caja cerrada · no se puede vender", "warn"); return; }
    const vouchers = [];
    (combo.items || []).forEach(it => { const p = punto.products.find(x => x.id === it.productId); if (p) for (let k = 0; k < (it.qty || 1); k++) vouchers.push(p); });
    if (!vouchers.length) { flash("Bono sin productos válidos", "warn"); return; }
    if (testMode) { setPrintJob({ kind: "multi", tickets: vouchers.map((p) => ({ product: p, folio: "PRUEBA" })), time: timeNow(), n: Date.now() }); flash("🧪 Prueba (no cuenta)"); return; }
    const price = round2((combo.price === "" || combo.price == null) ? vouchers.reduce((t, p) => t + p.price, 0) : Number(combo.price));
    if (ev.advanced) { setPayFlow({ kind: "combo", combo, vouchers, total: price }); return; }
    doSellCombo(combo, vouchers, price);
  };

  const doSellCombo = (combo, vouchers, price, pay = null) => {
    const folio = nextFolios(ev.id, punto.id, prefijoDePunto(punto), 1)[0];
    const cu = uid();
    const saleRow = { id: cu, clientUuid: cu, code: folio, num: evSales.length + 1, eventId: ev.id, puntoId: punto.id, productId: null, name: combo.name, price, ts: Date.now(), synced: online, voided: false, closureId: null, pago: pay?.pago || null, entregado: pay?.entregado ?? null, cambio: pay?.cambio ?? null };
    baseDispatch({ type: "SELL", rows: [saleRow] });
    const tickets = vouchers.map((p, i) => ({ product: p, folio: `${folio}·${i + 1}` }));
    setPrintJob({ kind: "multi", tickets, time: timeNow(), n: Date.now() });
    if (navigator.vibrate) navigator.vibrate(45);
    flash(`🎟️ ${combo.name} · ${vouchers.length} tickets`);
    db.vender({ eventoId: ev.id, puntoId: punto.id, producto: { id: null, name: combo.name, price }, qty: 1, operario: punto.name, folios: [folio], clientUuids: [cu], pago: pay?.pago || null, entregado: pay?.entregado ?? null, cambio: pay?.cambio ?? null }).then(r => { if (r.offline) setPending(db.pendingCount()); });
  };
  const voidOne = async (sale, by) => { baseDispatch({ type: "VOID_ONE", saleId: sale.id, by }); const r = await db.anularVenta(sale.clientUuid || sale.id, by); if (r.offline) setPending(db.pendingCount()); };

  const cierreZ = async (puntoObj, contado = null) => {
    const sales = evSales.filter(s => s.puntoId === puntoObj.id && !s.voided && !s.closureId);
    const voids = evSales.filter(s => s.puntoId === puntoObj.id && s.voided && !s.closureId).length;
    if (sales.length === 0 && voids === 0) { flash("Sin ventas en el turno actual", "warn"); return; }
    const map = {};
    sales.forEach(s => { map[s.productId] = map[s.productId] || { name: s.name, qty: 0, total: 0 }; map[s.productId].qty++; map[s.productId].total += s.price; });
    const revenue = round2(sales.reduce((t, s) => t + s.price, 0));
    const efectivo = round2(sales.filter(s => s.pago === "efectivo").reduce((t, s) => t + s.price, 0));
    const tarjeta = round2(sales.filter(s => s.pago === "tarjeta").reduce((t, s) => t + s.price, 0));
    const fondo = round2(puntoObj.fondo || 0);
    const esperado = round2(fondo + efectivo);                       // lo que debe haber en el cajón
    const descuadre = contado == null ? null : round2(contado - esperado);
    const z = { puntoName: puntoObj.name, lines: Object.values(map).map(l => ({ ...l, total: round2(l.total) })), revenue, efectivo, tarjeta, fondo, esperado, contado, descuadre, advanced: !!ev.advanced, count: sales.length, voids, ts: Date.now() };
    const closureId = uid();
    // Cierra el turno EN LOCAL (funciona sin wifi) y encola el cierre para el servidor
    baseDispatch({ type: "ADD_CLOSURE", closure: { id: closureId, eventId: ev.id, puntoId: puntoObj.id, ...z } });
    baseDispatch({ type: "CLOSE_PUNTO_SALES", eventId: ev.id, puntoId: puntoObj.id, closureId });
    baseDispatch({ type: "UPDATE_PUNTO", eventId: ev.id, puntoId: puntoObj.id, patch: { fondo: null } }); // vuelve a pedir fondo
    setPrintJob({ kind: "z", z, n: Date.now() });
    flash(`Cierre Z de ${puntoObj.name} · turno cerrado`);
    const r = await db.cerrarZ(ev.id, puntoObj.id, puntoObj.name, contado);
    if (r.offline) setPending(db.pendingCount());
    else await hydrate().catch(() => {});
  };

  useEffect(() => {
    if (!printJob || printer !== "live") return;
    // Define la PÁGINA al ancho real del rollo y alto automático (ticket corto, sin A4)
    const mm = ev.paper === 58 ? 48 : 72;
    let st = document.getElementById("ticketera-page");
    if (!st) { st = document.createElement("style"); st.id = "ticketera-page"; document.head.appendChild(st); }
    st.textContent = `@page{size:${mm}mm auto;margin:0;}`;
    const t = setTimeout(() => { try { window.print(); } catch (e) {} }, 60);
    return () => clearTimeout(t);
  }, [printJob, printer, ev.paper]);

  // Mantener la pantalla encendida mientras la caja está abierta
  useEffect(() => {
    let lock = null;
    const acquire = async () => { try { if ("wakeLock" in navigator) lock = await navigator.wakeLock.request("screen"); } catch {} };
    acquire();
    const onVis = () => { if (document.visibilityState === "visible") acquire(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); try { lock && lock.release(); } catch {} };
  }, []);

  // Ticket de prueba para calibrar la impresora sin hacer una venta
  const testPrint = () => {
    const demo = punto.products[0] || { id: "demo", name: "TICKET DE PRUEBA", price: 0, emoji: "🎟️", color: "#ff5a3c" };
    setPrintJob({ kind: "ticket", product: demo, time: timeNow(), num: null, folio: "PRUEBA", qty: 1, n: Date.now() });
    flash("🖨️ Ticket de prueba enviado");
  };

  // Resetear estadísticas del evento (borra ventas y cierres). Solo admin, doble confirmación.
  const resetStats = async () => {
    try {
      await db.resetStats(ev.id);
      db.dropPendingForEvent(ev.id, ev.puntos.map(p => p.id));
      setPending(db.pendingCount());
      baseDispatch({ type: "HYDRATE_SALES", sales: stateRef.current.sales.filter(s => s.eventId !== ev.id) });
      resetFolios(ev.id, ev.puntos.map(p => p.id));
      await hydrate();
      flash("Estadísticas reseteadas");
    } catch (e) { flash("Error al resetear", "warn"); }
  };

  // Fondo de caja: obligatorio antes de vender cuando la venta avanzada está activa
  const needsFondo = !!ev.advanced && !ev.closed && role && punto && punto.fondo == null;
  const saveFondo = async (amount) => {
    // Optimista: se guarda en local YA (deja vender al momento), y sube sola si no hay red
    baseDispatch({ type: "UPDATE_PUNTO", eventId: ev.id, puntoId: punto.id, patch: { fondo: amount, fondoPor: role } });
    const r = await db.setFondo(punto.id, amount, role);
    if (r.offline) { setPending(db.pendingCount()); flash(`Fondo declarado: ${money(amount)} · se subirá al recuperar conexión`, "warn"); }
    else flash(`Fondo declarado: ${money(amount)}`);
  };

  const exitToLogin = () => { setRole(null); setView("pos"); };
  const isPriv = role === "admin" || role === "supervisor";
  const allNav = [
    { id: "pos", label: "TPV", icon: "pos", roles: ["admin", "supervisor"] },
    { id: "template", label: "Plantilla", icon: "template", roles: ["admin"] },
    { id: "config", label: "Evento", icon: "config", roles: ["admin"] },
    { id: "reports", label: "Informes", icon: "reports", roles: ["admin", "supervisor"] },
  ];
  const navItems = allNav.filter(n => n.roles.includes(role));
  const safeView = navItems.find(n => n.id === view) ? view : "pos";

  const syncNow = async () => { const r = await db.syncPending(); setPending(db.pendingCount()); if (r.synced) { flash(`✅ ${r.synced} ventas sincronizadas`); await hydrate().catch(() => {}); } else flash(pending ? "Aún sin conexión" : "Todo sincronizado"); };
  const OnlinePill = ({ small }) => (
    <button onClick={syncNow} style={{ ...S.printerStatusSm, borderColor: !online ? "rgba(255,77,77,.5)" : pending ? "rgba(255,180,0,.5)" : "var(--line)", color: !online ? "var(--red)" : pending ? "var(--amber)" : "var(--text)", fontWeight: pending ? 800 : 700 }} title="Conexión (offline-first) · toca para sincronizar">
      <span style={{ ...S.stDot, background: online ? (pending ? "var(--amber)" : "var(--green)") : "var(--red)", boxShadow: `0 0 0 3px ${online ? (pending ? "rgba(255,180,0,.18)" : "rgba(34,211,166,.18)") : "rgba(255,77,77,.18)"}` }} />
      {online ? (pending ? `⏳ ${pending} sin subir` : "En línea") : `Sin conexión · ${pending}`}
    </button>
  );
  const PrinterPill = () => (
    <button onClick={() => setPrinter(printer === "live" ? "sim" : "live")} style={S.printerStatusSm} title="Estado impresora">
      <span style={{ ...S.stDot, background: printer === "live" ? "var(--green)" : "var(--muted)", boxShadow: printer === "live" ? "0 0 0 3px rgba(34,211,166,.18)" : "none" }} />
      {printer === "live" ? "Impresora OK" : "Simulación"}
    </button>
  );

  if (loading) return (
    <div style={{ height: "100vh", display: "grid", placeItems: "center", background: "#0b0c10", color: "#838aa0", fontFamily: "Inter,-apple-system,sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <img src="/brand/tixfast_logo_horizontal_oscuro.svg" alt="TIXFAST" style={{ height: 34, width: "auto", display: "block", margin: "0 auto 14px" }} />
        Cargando…
      </div>
    </div>
  );

  return (
    <div style={{ position: "relative", height: "100dvh", maxWidth: "100vw", overflow: "hidden", boxSizing: "border-box", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)", background: "var(--bg)", color: "var(--text)", fontFamily: "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", fontSize: 15 }}>
      <style>{CSS}</style>

      {/* ===== LOGIN ===== */}
      {role === null && (
        <RoleGate ev={ev} events={state.events} adminPin={ev.pin_admin} supervisorPin={ev.pin_supervisor}
          onSelectEvent={id => dispatch({ type: "SELECT_EVENT", id })}
          onRole={(r, puntoId) => { if (puntoId) dispatch({ type: "SET_PUNTO", id: puntoId }); setRole(r); setView("pos"); setShowCheck(true); }} />
      )}

      {/* ===== CAJERO ===== */}
      {role === "cajero" && (isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <header style={S.mTop}>
            <img src="/brand/tixfast_isotipo_app.svg" alt="TIXFAST" width="32" height="32" style={{ flexShrink: 0, display: "block" }} />
            <div style={S.mTitle}>
              <div style={S.mEvent}>{ev.name}</div>
              <div style={S.mSub}><Ic n="store" s={12} w={2.2} />{punto.name}</div>
            </div>
            <span title={online ? "En línea" : "Sin conexión"} style={{ ...S.stDot, background: online ? (pending ? "var(--amber)" : "var(--green)") : "var(--red)", boxShadow: `0 0 0 4px ${online ? (pending ? "rgba(255,180,0,.16)" : "rgba(34,211,166,.16)") : "rgba(255,77,77,.16)"}` }} />
            <button onClick={() => setMenuOpen(true)} style={S.iconBtn} aria-label="Menú"><Ic n="menu" /></button>
          </header>
          <div style={{ padding: 12, flex: 1, overflow: "auto", WebkitOverflowScrolling: "touch" }}>
            <POS punto={punto} totals={totals} rankCounts={rankCounts} onSell={sell} onSellMany={sellMany} onVoid={() => requestVoidCajero()} onReprint={reprint} canReprint={!!printJob} onCombo={sellCombo} testMode={testMode} closed={ev.closed} advanced={!!ev.advanced} onToggleAdvanced={toggleAdvanced} />
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <header style={S.cashierTop}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
              <img src="/brand/tixfast_isotipo_app.svg" alt="TIXFAST" width="38" height="38" style={{ flexShrink: 0, display: "block" }} />
              <div style={{ minWidth: 0 }}><div style={S.topTitle}>{ev.name}</div><div style={S.topSub}><span style={S.barTag}><Ic n="store" s={12} w={2.2} />{punto.name}</span>{dateFmt(ev.date)}</div></div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><OnlinePill /><PrinterPill /><button onClick={exitToLogin} style={S.topBtn}><Ic n="lock" s={16} />Salir</button></div>
          </header>
          <div style={{ padding: 22, flex: 1, overflow: "auto" }}>
            <POS punto={punto} totals={totals} rankCounts={rankCounts} onSell={sell} onSellMany={sellMany} onVoid={() => requestVoidCajero()} onReprint={reprint} canReprint={!!printJob} onCombo={sellCombo} testMode={testMode} closed={ev.closed} advanced={!!ev.advanced} onToggleAdvanced={toggleAdvanced} />
          </div>
        </div>
      ))}

      {/* ===== ADMIN / SUPERVISOR ===== */}
      {isPriv && (isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <header style={S.mTop}>
            <img src="/brand/tixfast_isotipo_app.svg" alt="TIXFAST" width="32" height="32" style={{ flexShrink: 0, display: "block" }} />
            <select value={ev.id} onChange={e => dispatch({ type: "SELECT_EVENT", id: e.target.value })} style={{ ...S.select, ...S.mSelect, flex: 1, minWidth: 0 }}>{state.events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
            <button onClick={() => setMenuOpen(true)} style={S.iconBtn} aria-label="Menú"><Ic n="menu" /></button>
          </header>
          <div style={{ padding: 12, flex: 1, overflow: "auto", WebkitOverflowScrolling: "touch" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: "10px 12px 10px 14px" }}>
              <div style={{ minWidth: 0 }}><div style={S.miniLabel}>Barra activa</div><div style={{ fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: 6 }}><span style={{ color: "var(--accent)" }}><Ic n="store" s={14} w={2.2} /></span>{punto.name}</div></div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                <div style={{ textAlign: "right" }}><div style={S.miniLabel}>Tickets</div><div style={{ fontWeight: 800, fontSize: 18, lineHeight: 1.1 }}>{totals.count}</div></div>
                <button onClick={() => setAskRevenue(true)} style={{ ...S.iconBtn, color: "var(--accent)" }} aria-label="Consultar facturación"><Ic n="euro" /></button>
              </div>
            </div>
            {safeView === "pos" && <POS punto={punto} totals={totals} rankCounts={rankCounts} onOrder={role === "admin" ? () => setOrderOpen(true) : null} onSell={sell} onSellMany={sellMany} onVoid={() => voidLast(role)} onReprint={reprint} canReprint={!!printJob} onCombo={sellCombo} testMode={testMode} closed={ev.closed} advanced={!!ev.advanced} onToggleAdvanced={toggleAdvanced} />}
            {safeView === "template" && <TemplateDesigner ev={ev} dispatch={dispatch} flash={flash} />}
            {safeView === "config" && <EventConfig state={state} ev={ev} punto={punto} evSales={evSales} role={role} onReset={resetStats} dispatch={dispatch} flash={flash} />}
            {safeView === "reports" && <Reports ev={ev} evSales={evSales} role={role} onVoid={(sale) => voidOne(sale, role)} onCierreZ={cierreZ} flash={flash} onBackup={() => makeBackup(true)} lastBackup={lastBackup} onImported={async () => { setPending(db.pendingCount()); if (navigator.onLine) { await db.syncPending(); setPending(db.pendingCount()); await hydrate().catch(() => {}); } }} />}
          </div>
          <nav style={S.bottomNav}>
            {navItems.map(n => <button key={n.id} onClick={() => setView(n.id)} style={{ ...S.bTab, ...(safeView === n.id ? S.bTabActive : {}) }}>
              <span style={{ ...S.bTabIco, ...(safeView === n.id ? S.bTabIcoActive : {}) }}><Ic n={n.icon} s={21} w={safeView === n.id ? 2.2 : 1.9} /></span>{n.label}
            </button>)}
          </nav>
        </div>
      ) : (
        <div style={{ display: "flex", height: "100%" }}>
          <aside style={S.side}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 18 }}>
              <img src="/brand/tixfast_logo_horizontal_oscuro.svg" alt="TIXFAST" style={S.logoImg} />
              <span style={{ ...S.roleBadge, color: role === "admin" ? "var(--accent)" : "#60a5fa", background: role === "admin" ? "rgba(255,90,60,.12)" : "rgba(96,165,250,.12)" }}>{role === "admin" ? "Admin" : "Supervisor"}</span>
            </div>
            <div style={S.sideLabel}>Evento</div>
            <select value={ev.id} onChange={e => dispatch({ type: "SELECT_EVENT", id: e.target.value })} style={S.select}>{state.events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
            <div style={{ ...S.sideLabel, marginTop: 20 }}>Menú</div>
            <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {navItems.map(n => <button key={n.id} onClick={() => setView(n.id)} className="nav-btn" style={{ ...S.navBtn, ...(safeView === n.id ? S.navActive : {}) }}><span style={{ color: safeView === n.id ? "var(--accent)" : "var(--muted)", display: "flex" }}><Ic n={n.icon} /></span>{n.label}</button>)}
            </nav>
            <div style={{ marginTop: "auto", paddingTop: 16 }}>
              <div style={S.sideLabel}>Punto de venta activo</div>
              <select value={punto.id} onChange={e => dispatch({ type: "SET_PUNTO", id: e.target.value })} style={{ ...S.select, fontSize: 13 }}>{activePuntos.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <div style={{ display: "flex", gap: 6, margin: "10px 0 12px" }}><OnlinePill /><PrinterPill /></div>
              <div style={S.sideDivider} />
              <MenuRow icon="printer" label="Ticket de prueba" onClick={testPrint} />
              <MenuRow icon="flask" label="Modo prueba" onClick={() => setTestMode(m => !m)} tone={testMode ? "warn" : undefined} right={<span style={{ ...S.onOff, ...(testMode ? S.onOffOn : {}) }}>{testMode ? "ON" : "OFF"}</span>} />
              <MenuRow icon="swap" label="Cambiar de rol" onClick={exitToLogin} />
              <MenuRow icon="logout" label="Cerrar sesión" onClick={() => logout()} tone="danger" />
            </div>
          </aside>
          <main style={S.main}>
            <header style={S.top}>
              <div style={{ minWidth: 0 }}><div style={S.topTitle}>{ev.name}</div><div style={S.topSub}><span style={S.barTag}><Ic n="store" s={12} w={2.2} />{punto.name}</span>{dateFmt(ev.date)}{ev.venue ? ` · ${ev.venue}` : ""}</div></div>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <Stat label={`Tickets · ${punto.name}`} value={totals.count} accent="var(--accent)" />
                <button onClick={() => setAskRevenue(true)} style={S.topBtn}><span style={{ color: "var(--accent)", display: "flex" }}><Ic n="euro" s={17} /></span>Consultar facturación</button>
              </div>
            </header>
            <div style={{ padding: 22, flex: 1, overflow: "auto" }}>
              {safeView === "pos" && <POS punto={punto} totals={totals} rankCounts={rankCounts} onOrder={role === "admin" ? () => setOrderOpen(true) : null} onSell={sell} onSellMany={sellMany} onVoid={() => voidLast(role)} onReprint={reprint} canReprint={!!printJob} onCombo={sellCombo} testMode={testMode} closed={ev.closed} advanced={!!ev.advanced} onToggleAdvanced={toggleAdvanced} />}
              {safeView === "template" && <TemplateDesigner ev={ev} dispatch={dispatch} flash={flash} />}
              {safeView === "config" && <EventConfig state={state} ev={ev} punto={punto} evSales={evSales} role={role} onReset={resetStats} dispatch={dispatch} flash={flash} />}
              {safeView === "reports" && <Reports ev={ev} evSales={evSales} role={role} onVoid={(sale) => voidOne(sale, role)} onCierreZ={cierreZ} flash={flash} onBackup={() => makeBackup(true)} lastBackup={lastBackup} onImported={async () => { setPending(db.pendingCount()); if (navigator.onLine) { await db.syncPending(); setPending(db.pendingCount()); await hydrate().catch(() => {}); } }} />}
            </div>
          </main>
        </div>
      ))}

      {/* ===== Menú móvil (hoja inferior) ===== */}
      {isMobile && menuOpen && (
        <div style={S.sheetWrap} onClick={() => setMenuOpen(false)}>
          <div className="sheet-anim" style={S.sheet} onClick={e => e.stopPropagation()}>
            <div style={S.grab} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <img src="/brand/tixfast_isotipo_app.svg" alt="" width="40" height="40" style={{ flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ ...S.display, fontSize: 19 }}>Menú</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{role === "admin" ? "Administrador" : role === "supervisor" ? "Supervisor" : "Cajero"} · {ev.name}</div>
                </div>
              </div>
              <button onClick={() => setMenuOpen(false)} style={S.iconBtn} aria-label="Cerrar"><Ic n="close" /></button>
            </div>
            {isPriv && (
              <div style={{ marginBottom: 12 }}>
                <div style={S.sideLabel}>Punto de venta activo</div>
                <select value={punto.id} onChange={e => dispatch({ type: "SET_PUNTO", id: e.target.value })} style={S.select}>{activePuntos.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}><OnlinePill /><PrinterPill /></div>
            <div className="menu-group" style={S.menuGroup}>
              <MenuRow big icon="check" label="Comprobación previa" onClick={() => { setMenuOpen(false); setShowCheck(true); }} right={<span style={{ color: "var(--muted)" }}><Ic n="chev" s={16} /></span>} />
              <MenuRow big icon="printer" label="Ticket de prueba" onClick={() => { setMenuOpen(false); testPrint(); }} right={<span style={{ color: "var(--muted)" }}><Ic n="chev" s={16} /></span>} />
              <MenuRow big icon="flask" label="Modo prueba" onClick={() => setTestMode(m => !m)} tone={testMode ? "warn" : undefined} right={<span style={{ ...S.onOff, ...(testMode ? S.onOffOn : {}) }}>{testMode ? "ACTIVADO" : "APAGADO"}</span>} />
              <MenuRow big icon="refresh" label="Buscar actualización" onClick={async () => { try { const rs = await navigator.serviceWorker?.getRegistrations?.() || []; for (const r of rs) await r.unregister(); const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); } catch {} window.location.reload(true); }} right={<span style={{ color: "var(--muted)" }}><Ic n="chev" s={16} /></span>} />
            </div>
            <div className="menu-group" style={{ ...S.menuGroup, marginTop: 10 }}>
              <MenuRow big icon="swap" label="Cambiar de rol" onClick={() => { setMenuOpen(false); exitToLogin(); }} right={<span style={{ color: "var(--muted)" }}><Ic n="chev" s={16} /></span>} />
              <MenuRow big icon="logout" label="Cerrar sesión" onClick={() => { setMenuOpen(false); logout(); }} tone="danger" />
            </div>
            <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted)", marginTop: 14 }}>TIXFAST · versión {APP_VERSION}</div>
          </div>
        </div>
      )}

      {/* ===== Ordenar productos (desde el TPV, solo admin) ===== */}
      {orderOpen && role === "admin" && <OrderSheet ev={ev} punto={punto} evSales={evSales} dispatch={dispatch} flash={flash} onClose={() => setOrderOpen(false)} />}

      {/* ===== Fondo de caja (bloquea la venta hasta declararlo) ===== */}
      {needsFondo && !showCheck && (
        <FondoGate puntoName={punto.name} onSave={saveFondo} onBack={exitToLogin} pending={!online} />
      )}

      {/* ===== Cobro avanzado ===== */}
      {payFlow && (
        <PayFlow
          total={payFlow.total}
          lines={payFlow.kind === "single" ? [{ qty: payFlow.qty, name: payFlow.product.name, total: round2(payFlow.product.price * payFlow.qty) }]
            : payFlow.kind === "many" ? payFlow.items.map(it => ({ qty: it.qty, name: it.product.name, total: round2(it.product.price * it.qty) }))
            : [{ qty: 1, name: payFlow.combo.name, total: payFlow.total }]}
          changeHelp={ev.changeHelp !== false}
          onCancel={() => setPayFlow(null)}
          onDisableHelp={(on = false) => { dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: { changeHelp: !!on } }); flash(on ? "Ayuda con el cambio activada" : "Ayuda con el cambio desactivada"); }}
          onDone={(pay) => {
            const f = payFlow; setPayFlow(null);
            if (f.kind === "single") doSell(f.product, f.qty, pay);
            else if (f.kind === "many") doSellMany(f.items, pay);
            else if (f.kind === "combo") doSellCombo(f.combo, f.vouchers, f.total, pay);
          }}
        />
      )}

      {/* ===== Comprobación previa (antes de vender) ===== */}
      {showCheck && role && (
        <div style={{ position: "fixed", inset: 0, zIndex: 70, background: "var(--bg)", overflow: "auto", padding: "calc(16px + env(safe-area-inset-top)) 16px calc(20px + env(safe-area-inset-bottom))" }}>
          <div style={{ maxWidth: 520, margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}><img src="/brand/tixfast_isotipo_app.svg" alt="" width="36" height="36" /><div style={S.display}>Comprobación previa</div></div>
            <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 18 }}>Revisa esto antes de abrir la barra.</div>

            <CheckCard state={online ? "ok" : "warn"} title="Conexión" value={online ? (pending ? `En línea · ${pending} por subir` : "En línea") : `Sin conexión · ${pending} en cola`} note={online ? "Las ventas se guardan y suben en tiempo real." : "Puedes vender e imprimir igual; subirá solo cuando vuelva el wifi."} />

            <CheckCard state="ok" title="Evento y barra" value={`${ev.name} · ${punto.name}`} note="¿No es la barra correcta? Pulsa abajo “Cambiar de barra”." />

            <CheckCard state={printer === "live" ? "ok" : "warn"} title="Impresora" value={`Papel ${ev.paper} mm · ${printer === "live" ? "Impresión real" : "SIMULACIÓN (no imprime)"}`} note={printer === "live" ? "Haz una prueba para confirmar tamaño y corte." : "Estás en simulación: activa la impresión real con el botón 🖨️ de arriba."}>
              <button onClick={testPrint} style={{ ...S.btnPrimary, marginTop: 12, width: "100%" }}>🖨️ Imprimir ticket de prueba</button>
            </CheckCard>

            <CheckCard state="ok" title="Numeración de tickets" value={`Próximo folio: ${prefijoDePunto(punto)}${getDeviceTag()}-${String(peekFolio(ev.id, punto.id) + 1).padStart(4, "0")}`} note={`Cada barra numera por separado en este dispositivo.${getDeviceTag() ? "" : " Si otra tablet usa ESTA misma barra, ponles una letra distinta para no repetir folios."}`} />

            <button onClick={() => setShowCheck(false)} style={{ ...S.btnPrimary, width: "100%", padding: "16px", fontSize: 17, marginTop: 6 }}>✅ Todo listo · Empezar a vender</button>
            <button onClick={() => { setShowCheck(false); exitToLogin(); }} style={{ ...S.btnGhost, width: "100%", marginTop: 10, padding: "13px" }}>Cambiar de barra / rol</button>
            <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted)", marginTop: 14 }}>TIXFAST · versión {APP_VERSION}</div>
          </div>
        </div>
      )}

      {/* ===== Zona de impresión oculta (fuera de pantalla; en impresión se coloca en 0,0) ===== */}
      <div id="thermal-print-area" aria-hidden style={{ position: "absolute", left: -9999, top: 0 }}>
        {printJob?.kind === "ticket" && <div className="ticket-page"><ThermalTicket ev={ev} product={printJob.product} time={printJob.time} num={printJob.num} qty={printJob.qty} folio={printJob.folio} /></div>}
        {printJob?.kind === "z" && <div className="ticket-page"><ZTicket ev={ev} z={printJob.z} /></div>}
        {printJob?.kind === "multi" && printJob.tickets.map((t, i) => (
          <div key={i} className="ticket-page">
            <ThermalTicket ev={ev} product={t.product} time={printJob.time} num={t.num} folio={t.folio} />
          </div>
        ))}
      </div>

      {/* ===== Facturación (PIN -> total) ===== */}
      {askRevenue && <PinModal correct={ev.pin_admin} onClose={() => setAskRevenue(false)} onOk={() => { setAskRevenue(false); setShowRevenue(true); }} />}
      {askVoidPin && <PinModal correct={ev.pin_supervisor} onClose={() => setAskVoidPin(false)} onOk={() => { setAskVoidPin(false); voidLast(punto.name); }} label="PIN de supervisor para anular" />}
      {showRevenue && (
        <div style={isMobile ? S.sheetWrap : S.overlay} onClick={() => setShowRevenue(false)}>
          <div className={isMobile ? "sheet-anim" : ""} style={isMobile ? S.sheet : { ...S.pinCard, textAlign: "center", width: 330 }} onClick={e => e.stopPropagation()}>
            {isMobile && <div style={S.grab} />}
            <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>Facturación total · {ev.name}</div>
            <div style={{ fontSize: 44, fontWeight: 800, color: "var(--green)", margin: "12px 0" }}>{money(eventRevenue)}</div>
            <div style={{ textAlign: "left", borderTop: "1px solid var(--line)", paddingTop: 12, marginBottom: 14 }}>
              {ev.puntos.map(p => { const r = evSales.filter(s => s.puntoId === p.id && !s.voided).reduce((t, s) => t + s.price, 0); return <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}><span style={{ color: "var(--muted)" }}>{p.name}</span><b>{money(r)}</b></div>; })}
            </div>
            <button style={S.btnGhost} onClick={() => setShowRevenue(false)}>Cerrar</button>
          </div>
        </div>
      )}

      {toast && <div role="status" style={{ ...S.toast, background: toast.kind === "warn" ? "var(--amber)" : "var(--green)", ...(isMobile && isPriv ? { bottom: "calc(84px + env(safe-area-inset-bottom))" } : {}) }}>{toast.msg}</div>}
    </div>
  );
}

/* ---------------------- Orden de productos (lógica compartida) ---------------------- */
function useProductOrder(ev, punto, evSales, dispatch, flash) {
  const sortMode = punto.sortMode === "ventas" ? "ventas" : "manual";
  const sold = useMemo(() => { const c = {}; evSales.forEach(s => { if (s.puntoId === punto.id && !s.voided) c[s.productId] = (c[s.productId] || 0) + 1; }); return c; }, [evSales, punto.id]);
  const salesRank = useMemo(() => punto.products.map((p, i) => [p.id, sold[p.id] || 0, i]).sort((x, y) => (y[1] - x[1]) || (x[2] - y[2])).map(x => x[0]), [punto.products, sold]);
  const reorder = (ids) => dispatch({ type: "REORDER_PRODUCTS", eventId: ev.id, puntoId: punto.id, ids, prevIds: punto.products.map(p => p.id) });
  const moveProd = (id, d) => { const ids = punto.products.map(p => p.id); const i = ids.indexOf(id), j = i + d; if (i < 0 || j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; reorder(ids); };
  const setSortMode = (m) => { if (m === sortMode) return; dispatch({ type: "UPDATE_PUNTO", eventId: ev.id, puntoId: punto.id, patch: { sortMode: m } }); flash(m === "ventas" ? "TPV: más vendidos primero" : "TPV: orden manual"); };
  const applySalesOrder = () => { if (!Object.keys(sold).length) { flash("Aún no hay ventas en esta barra", "warn"); return; } reorder(salesRank); flash("Colocados por ventas · ahora puedes moverlos"); };
  return { sortMode, sold, salesRank, reorder, moveProd, setSortMode, applySalesOrder };
}

/* Panel "Ordenar productos" que se abre desde el propio TPV (solo administrador) */
function OrderSheet({ ev, punto, evSales, dispatch, flash, onClose }) {
  const isMobile = useIsMobile();
  const { sortMode, sold, salesRank, reorder, moveProd, setSortMode, applySalesOrder } = useProductOrder(ev, punto, evSales, dispatch, flash);
  const n = punto.products.length;
  return (
    <div style={isMobile ? S.sheetWrap : S.overlay} onClick={onClose}>
      <div className={isMobile ? "sheet-anim" : ""} style={isMobile ? S.sheet : { ...S.pinCard, width: 520, maxWidth: "94vw", maxHeight: "88dvh", overflow: "auto", textAlign: "left" }} onClick={e => e.stopPropagation()}>
        {isMobile && <div style={S.grab} />}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...S.display, fontSize: 20 }}>Ordenar productos</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{punto.name} · {n} productos</div>
          </div>
          <button onClick={onClose} style={S.iconBtn} aria-label="Cerrar"><Ic n="close" /></button>
        </div>
        <div style={S.segWrap}>
          <button onClick={() => setSortMode("manual")} style={{ ...S.seg, ...(sortMode === "manual" ? S.segOn : {}) }}><Ic n="grip" s={15} w={2.2} />Manual</button>
          <button onClick={() => setSortMode("ventas")} style={{ ...S.seg, ...(sortMode === "ventas" ? S.segOn : {}) }}><Ic n="reports" s={15} w={2.2} />Más vendidos</button>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", margin: "10px 2px 12px", lineHeight: 1.45 }}>
          {sortMode === "ventas" ? "En el TPV sale primero lo que más se vende en esta barra. Con empate o sin ventas, manda el orden de abajo." : (isMobile ? "Mantén pulsada el asa ⠿ y arrastra cada producto a su sitio." : "Arrastra desde el asa ⠿ o usa las flechas.")}
        </div>
        {sortMode === "manual" && Object.keys(sold).length > 0 && <button onClick={applySalesOrder} style={{ ...S.smallBtn, marginBottom: 12, display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px" }}><Ic n="reports" s={13} w={2.2} />Colocar una vez por ventas</button>}
        <SortableList items={punto.products} onReorder={reorder} renderRow={(p, i, handle, dragging) => (
          <div style={{ ...S.prodRow, gap: 10, padding: "8px 10px 8px 6px", opacity: p.soldOut ? .55 : 1, ...(dragging ? S.prodRowDrag : {}) }}>
            {handle}
            <span style={{ width: 22, textAlign: "center", fontSize: 12, fontWeight: 800, color: "var(--muted)", flexShrink: 0 }}>{i + 1}</span>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: p.color, display: "grid", placeItems: "center", fontSize: 19, flexShrink: 0 }}>{p.emoji}</div>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div><div style={{ fontSize: 12, color: "var(--muted)" }}>{sortMode === "ventas" ? <><b style={{ color: "var(--accent)" }}>#{salesRank.indexOf(p.id) + 1} en ventas</b> · </> : null}{sold[p.id] || 0} vendidos</div></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <button onClick={() => moveProd(p.id, -1)} disabled={i === 0} style={{ ...S.arrowBtn, opacity: i === 0 ? .3 : 1 }} aria-label="Subir"><Ic n="up" s={13} w={2.4} /></button>
              <button onClick={() => moveProd(p.id, 1)} disabled={i === n - 1} style={{ ...S.arrowBtn, opacity: i === n - 1 ? .3 : 1 }} aria-label="Bajar"><Ic n="down" s={13} w={2.4} /></button>
            </div>
          </div>
        )} />
        <button onClick={onClose} style={{ ...S.btnPrimary, marginTop: 14 }}>Listo</button>
      </div>
    </div>
  );
}

/* ---------------------- Lista ordenable (arrastrar con ratón o con el dedo) ---------------------- */
function SortableList({ items, onReorder, renderRow }) {
  const [drag, setDrag] = useState(null); // { id, startY, rects, order }
  const rowRefs = useRef({});
  const order = drag ? drag.order : items.map(i => i.id);
  const byId = new Map(items.map(i => [i.id, i]));
  const onDown = (e, id) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    const rects = items.map(i => { const r = rowRefs.current[i.id]?.getBoundingClientRect(); return { id: i.id, mid: r ? r.top + r.height / 2 : 0 }; });
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    setDrag({ id, startY: e.clientY, rects, order: items.map(i => i.id) });
  };
  const onMove = (e) => {
    if (!drag) return;
    const me = drag.rects.find(r => r.id === drag.id);
    const y = me.mid + (e.clientY - drag.startY);
    const others = drag.rects.filter(r => r.id !== drag.id);
    const idx = others.filter(r => r.mid < y).length;
    const next = others.map(r => r.id); next.splice(idx, 0, drag.id);
    if (next.join() !== drag.order.join()) { setDrag({ ...drag, order: next }); try { navigator.vibrate?.(8); } catch {} }
  };
  const onUp = () => {
    if (!drag) return;
    const ids = drag.order; setDrag(null);
    if (ids.join() !== items.map(i => i.id).join()) onReorder(ids);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {order.map((id, i) => {
        const it = byId.get(id); if (!it) return null;
        const handle = (
          <span onPointerDown={e => onDown(e, id)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            style={{ ...S.grip, cursor: drag?.id === id ? "grabbing" : "grab", color: drag?.id === id ? "var(--accent)" : "var(--muted)" }} title="Arrastra para mover" aria-label="Arrastrar para ordenar">
            <Ic n="grip" s={18} w={2.4} />
          </span>
        );
        return <div key={id} ref={el => { rowRefs.current[id] = el; }}>{renderRow(it, i, handle, drag?.id === id)}</div>;
      })}
    </div>
  );
}

/* ---------------------- Iconos de interfaz (línea, estilo TIXFAST) ---------------------- */
const IC = {
  pos: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  template: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3",
  config: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4a2 2 0 1 0 0 4a2 2 0 1 0 0-4M9 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4M17 16a2 2 0 1 0 0 4a2 2 0 1 0 0-4",
  reports: "M3 20h18M6 16v-5M11 16V6M16 16v-8",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6L6 18",
  check: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M8.5 12.2l2.4 2.3 4.6-4.8",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  printer: "M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z",
  flask: "M9 3h6M10 3v6l-5.5 9.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3M7 15h10",
  swap: "M4 8h15l-3.5-3.5M20 16H5l3.5 3.5",
  logout: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16.5L5.5 12 10 7.5M5.5 12H16",
  lock: "M5 11h14v10H5zM8 11V8a4 4 0 0 1 8 0v3",
  euro: "M17.5 6.5a6.5 6.5 0 1 0 0 11M4 10h9M4 14h9",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
  chev: "M9 6l6 6-6 6",
  store: "M4 9l1.5-5h13L20 9M4 9h16M4 9v11h16V9M9 20v-6h6v6",
  grip: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  up: "M6 15l6-6 6 6",
  down: "M6 9l6 6 6-6",
};
function Ic({ n, s = 20, w = 1.9, style }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, display: "block", ...style }}>
      <path d={IC[n]} />
    </svg>
  );
}
/* Fila de menú (barra lateral y menú móvil) */
function MenuRow({ icon, label, onClick, tone, right, big }) {
  const c = tone === "danger" ? "var(--red)" : tone === "warn" ? "var(--amber)" : "var(--text)";
  return (
    <button onClick={onClick} className="menu-row" style={{ ...S.menuRow, ...(big ? S.menuRowBig : {}), color: c }}>
      <span style={{ ...S.menuIco, ...(big ? { width: 36, height: 36 } : {}), color: tone ? c : "var(--muted)", background: tone === "danger" ? "rgba(255,77,77,.1)" : tone === "warn" ? "rgba(255,180,0,.12)" : "var(--surface2)" }}><Ic n={icon} s={big ? 19 : 17} /></span>
      <span style={{ flex: 1, textAlign: "left" }}>{label}</span>
      {right}
    </button>
  );
}

/* ---------------------- Login ---------------------- */
function RoleGate({ ev, events, adminPin, supervisorPin, onSelectEvent, onRole }) {
  const [mode, setMode] = useState(null); // null | cajero | admin | supervisor
  const puntos = ev.puntos.filter(p => !p.archivado);
  const [op, setOp] = useState(puntos[0]?.id);
  useEffect(() => { setOp(ev.puntos.filter(p => !p.archivado)[0]?.id); }, [ev.id]);
  const roles = [
    { k: "cajero", icon: "receipt", t: "Cajero", d: "Solo TPV e impresión" },
    { k: "supervisor", icon: "eye", t: "Supervisor", d: "TPV + informes + cierres" },
    { k: "admin", icon: "shield", t: "Administrador", d: "Configura todo" },
  ];
  return (
    <div style={S.gateWrap}>
      <div style={S.gateCard}>
        <img src="/brand/tixfast_logo_horizontal_oscuro.svg" alt="TIXFAST" style={{ height: 32, width: "auto", display: "block", margin: "0 auto" }} />
        <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, margin: "8px 0 22px" }}>Elige evento y entra con tu rol</div>
        <div style={S.sideLabel}>Evento</div>
        <select value={ev.id} onChange={e => onSelectEvent(e.target.value)} style={{ ...S.select, marginBottom: 18 }}>{events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select>

        {mode === null && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {roles.map(r => <button key={r.k} className="gate-role" onClick={() => r.k === "cajero" ? setMode("cajero") : setMode(r.k)} style={S.gateRole}><span style={{ ...S.gateIco, ...(r.k === "cajero" ? S.gateIcoMain : {}) }}><Ic n={r.icon} s={24} /></span><span style={{ fontWeight: 800, fontSize: 16, marginTop: 4 }}>{r.t}</span><span style={{ fontSize: 11, color: "var(--muted)" }}>{r.d}</span></button>)}
          </div>
        )}

        {mode === "cajero" && (
          <div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>¿En qué punto de venta trabajas?</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>{puntos.map(p => <button key={p.id} onClick={() => setOp(p.id)} style={{ ...S.chip, textAlign: "center", ...(op === p.id ? S.chipActive : {}) }}>{p.name}</button>)}</div>
            <button onClick={() => onRole("cajero", op)} style={S.btnPrimary}>Entrar al TPV →</button>
            <button onClick={() => setMode(null)} style={{ ...S.btnGhost, marginTop: 8, width: "100%" }}>Volver</button>
          </div>
        )}
        {mode === "supervisor" && <PinModal correct={supervisorPin} onOk={() => onRole("supervisor")} onClose={() => setMode(null)} label="PIN de supervisor (demo 0000)" />}
        {mode === "admin" && <PinModal correct={adminPin} onOk={() => onRole("admin")} onClose={() => setMode(null)} label="PIN de administrador (demo 1234)" />}
      </div>
    </div>
  );
}

/* ---------------------- Selector de iconos (emojis por categorías) ---------------------- */
const EMOJI_CATS = [
  { k: "comida", l: "🍔 Comida", items: [
    ["🍔","hamburguesa burger"],["🌭","perrito caliente hot dog salchicha salchipapa"],["🍟","patatas fritas papas salchipapa"],["🍕","pizza porcion"],["🌮","taco mexicano"],["🌯","burrito wrap kebab"],["🥙","kebab durum pita"],["🥪","bocadillo sandwich montado"],["🥖","pan baguette barra bocata"],["🧆","falafel croqueta"],["🍗","pollo muslo alitas"],["🍖","carne costillas churrasco"],["🥩","filete carne chuleton"],["🥓","bacon panceta"],["🍳","huevo frito"],["🥚","huevo"],["🧀","queso"],["🥗","ensalada"],["🍝","pasta espagueti"],["🍜","sopa ramen fideos"],["🍲","guiso olla caldo"],["🥘","paella cazuela migas"],["🍛","curry arroz"],["🍚","arroz"],["🍱","bento menu"],["🍣","sushi"],["🍤","gamba frita tempura"],["🦐","gamba marisco"],["🦑","calamares bravas"],["🐙","pulpo"],["🥟","empanadilla gyoza"],["🫓","pan pita tortita"],["🥞","tortitas crepes"],["🧇","gofre waffle"],["🥨","pretzel"],["🥐","croissant cruasan"],["🍞","pan tostada"],["🌽","maiz mazorca"],["🥔","patata"],["🫒","aceitunas olivas"],["🥜","cacahuetes frutos secos"],["🍿","palomitas"],["🧂","sal snack"],["🥫","lata conserva"],["🍢","brocheta pincho"],["🍡","pincho dulce"],["🫕","fondue"],["🥣","cuenco bol"]]},
  { k: "dulce", l: "🍩 Dulces", items: [
    ["🍩","donut rosquilla"],["🍪","galleta cookie"],["🎂","tarta cumpleaños"],["🍰","pastel tarta porcion"],["🧁","cupcake magdalena"],["🥧","tarta pie"],["🍫","chocolate"],["🍬","caramelo chuche"],["🍭","piruleta chuches"],["🍮","flan"],["🍦","helado cucurucho"],["🍨","helado copa"],["🍧","granizado hielo"],["🍯","miel"],["🍓","fresa"],["🍉","sandia"],["🍌","platano"],["🍎","manzana"],["🍊","naranja"],["🍋","limon"],["🍍","piña"],["🥥","coco"],["🍇","uvas"],["🍒","cerezas"]]},
  { k: "bebida", l: "🥤 Bebidas", items: [
    ["🥤","refresco cola vaso"],["💧","agua"],["🧃","zumo brick"],["🧋","batido bubble tea"],["🥛","leche batido"],["☕","cafe cortado"],["🍵","te infusion"],["🧉","mate"],["🧊","hielo cubitos"],["🫗","rellenar chupito servir"],["🍶","sake botella"],["🥥","coco"],["⚡","energetica red bull"]]},
  { k: "alcohol", l: "🍺 Copas", items: [
    ["🍺","cerveza caña"],["🍻","cervezas jarra doble"],["🍷","vino tinto"],["🥂","cava champan brindis"],["🍾","botella champan reservado"],["🍸","coctel martini copa"],["🍹","coctel tropical mojito"],["🥃","whisky chupito copa"],["🍶","licor"],["🧉","combinado"],["🍋","limon gin tonic"],["🫒","vermut"]]},
  { k: "entrada", l: "🎟️ Entradas", items: [
    ["🎟️","entrada ticket"],["🎫","ticket billete pase"],["⭐","vip estrella"],["🌟","premium"],["👑","vip corona reservado"],["💎","vip diamante"],["🎉","fiesta"],["🎊","celebracion"],["🎶","musica concierto"],["🎵","musica"],["🎤","karaoke microfono"],["🎧","dj"],["🪩","discoteca bola"],["🔥","hot fuego"],["💃","baile"],["🕺","baile"],["🎭","teatro"],["🎪","circo feria"],["🎡","noria feria atraccion"],["🎠","tiovivo atraccion"],["🎢","montaña rusa atraccion"],["🎯","dardos tiro"],["🎳","bolos"],["🎱","billar"],["🏆","premio torneo"],["🥇","oro primero"],["🍀","sorteo suerte"],["🎰","sorteo rifa"],["🅿️","parking aparcamiento"],["🚌","bus autobus lanzadera"],["🔞","mayores 18"],["🧒","niños infantil"],["🎃","halloween"],["🎄","navidad"],["❤️","amor"],["☀️","dia"],["🌙","noche"]]},
  { k: "merch", l: "👕 Merch", items: [
    ["👕","camiseta"],["🧥","sudadera chaqueta guardarropa ropero"],["🧢","gorra"],["👜","bolso"],["🎒","mochila"],["👓","gafas"],["🕶️","gafas sol"],["🧣","bufanda"],["🧦","calcetines"],["🪭","abanico"],["🌂","paraguas chubasquero"],["🔑","taquilla llave"],["🔦","linterna"],["🔋","bateria carga movil"],["📱","movil carga"],["💡","pulsera luz"],["🏷️","pulsera etiqueta"],["🎁","regalo"],["🧸","peluche"],["🎈","globo"],["🪪","acreditacion"],["🧴","crema"],["🚬","tabaco"],["🧻","papel"],["🚻","baños"]]},
  { k: "otros", l: "✨ Otros", items: [
    ["🪙","ficha moneda token"],["💶","euro dinero"],["💳","tarjeta"],["🧾","ticket recibo"],["✅","ok"],["➕","extra suplemento"],["🆓","gratis"],["🆕","nuevo"],["🔴","rojo"],["🟠","naranja"],["🟡","amarillo"],["🟢","verde"],["🔵","azul"],["🟣","morado"],["⚫","negro"],["⚪","blanco"],["1️⃣","uno 1"],["2️⃣","dos 2"],["3️⃣","tres 3"],["🅰️","a"],["🅱️","b"]]},
];
const EMOJI_ALL = EMOJI_CATS.flatMap(c => c.items);
const normTxt = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const RECENT_KEY = "ticketera_recent_emojis";
const getRecent = () => { try { const r = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); return Array.isArray(r) ? r : []; } catch { return []; } };
const pushRecent = (e) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...getRecent().filter(x => x !== e)].slice(0, 16))); } catch {} };

function EmojiPicker({ value, onChange, size = 52 }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState(null);
  const [q, setQ] = useState("");
  const [custom, setCustom] = useState("");
  const recent = getRecent();
  const pick = (e) => { const v = String(e).trim(); if (!v) return; pushRecent(v); onChange(v); setOpen(false); setQ(""); setCustom(""); };
  const nq = normTxt(q.trim());
  const list = nq ? EMOJI_ALL.filter(([, kw]) => normTxt(kw).includes(nq))
    : cat ? (EMOJI_CATS.find(c => c.k === cat)?.items || []) : null;
  const cell = { fontSize: 30, height: 54, borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)", cursor: "pointer", display: "grid", placeItems: "center", padding: 0 };
  const Grid = ({ items }) => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(54px, 1fr))", gap: 8 }}>
      {items.map(([e, kw], i) => <button key={e + i} title={kw} onClick={() => pick(e)} style={{ ...cell, ...(e === value ? { borderColor: "var(--accent)", boxShadow: "0 0 0 2px var(--accent)" } : {}) }}>{e}</button>)}
    </div>
  );
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Elegir icono" style={{ width: size, height: size, flexShrink: 0, borderRadius: 12, border: "2px dashed var(--line)", background: "var(--surface2)", cursor: "pointer", fontSize: size * 0.5, display: "grid", placeItems: "center", padding: 0, lineHeight: 1 }}>{value || "➕"}</button>
      {open && (
        <div style={{ ...(isMobile ? S.sheetWrap : S.overlay), zIndex: 95 }} onClick={() => setOpen(false)}>
          <div className={isMobile ? "sheet-anim" : ""} style={isMobile ? S.sheet : { ...S.pinCard, width: 560, maxWidth: "94vw", maxHeight: "86dvh", overflow: "auto", textAlign: "left" }} onClick={e => e.stopPropagation()}>
            {isMobile && <div style={S.grab} />}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 17 }}>Elige un icono</div>
              <button onClick={() => setOpen(false)} style={S.iconBtn}>✕</button>
            </div>
            <input autoFocus={!isMobile} value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar: hamburguesa, perrito, cerveza, vip…" style={{ ...S.input, marginBottom: 10 }} />
            {!nq && (
              <div className="scroll-x" style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                <button onClick={() => setCat(null)} style={{ ...S.chip, flexShrink: 0, ...(cat === null ? S.chipActive : {}) }}>⏱️ Recientes</button>
                {EMOJI_CATS.map(c => <button key={c.k} onClick={() => setCat(c.k)} style={{ ...S.chip, flexShrink: 0, ...(cat === c.k ? S.chipActive : {}) }}>{c.l}</button>)}
              </div>
            )}
            {list ? (list.length ? <Grid items={list} /> : <div style={{ color: "var(--muted)", fontSize: 13, padding: "10px 0" }}>Sin resultados. Pega el emoji abajo.</div>)
              : (recent.length ? <Grid items={recent.map(e => [e, "reciente"])} /> : <div style={{ color: "var(--muted)", fontSize: 13, padding: "6px 0 2px" }}>Aún no hay recientes. Elige una categoría o busca arriba.</div>)}
            <div style={{ borderTop: "1px solid var(--line)", marginTop: 14, paddingTop: 12 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>¿No está? Escribe o pega cualquier emoji (puedes combinar dos, ej. 🌭🍟 para salchipapas)</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={custom} onChange={e => setCustom(Array.from(e.target.value).slice(0, 4).join(""))} placeholder="🌭🍟" style={{ ...S.input, fontSize: 22, textAlign: "center" }} />
                <button onClick={() => pick(custom)} disabled={!custom.trim()} style={{ ...S.btnPrimary, width: "auto", padding: "0 18px", opacity: custom.trim() ? 1 : .4 }}>Usar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------------------- Fondo de caja (obligatorio para abrir) ---------------------- */
function FondoGate({ puntoName, onSave, onBack, pending }) {
  const [v, setV] = useState("");
  const amount = parseFloat(v || "0") || 0;
  const press = (d) => setV(x => (d === "." && x.includes(".") ? x : (x + d).slice(0, 7)));
  const quick = [0, 50, 100, 150, 200, 300];
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 85, background: "var(--bg)", overflow: "auto", padding: "calc(18px + env(safe-area-inset-top)) 16px calc(20px + env(safe-area-inset-bottom))" }}>
      <div style={{ maxWidth: 460, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 44 }}>💰</div>
          <div style={{ ...S.display, marginTop: 4 }}>Fondo de caja</div>
          <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>¿Cuánto dinero hay en el cajón de <b style={{ color: "var(--accent)" }}>{puntoName}</b> antes de empezar?</div>
        </div>

        <div style={{ background: "var(--surface)", border: "2px solid var(--line)", borderRadius: 16, padding: 16, textAlign: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 2, fontWeight: 800 }}>Fondo inicial</div>
          <div style={{ fontSize: 46, fontWeight: 900, lineHeight: 1.05, color: "var(--green)" }}>{money(amount)}</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(82px,1fr))", gap: 8, marginBottom: 12 }}>
          {quick.map(n => <button key={n} onClick={() => setV(String(n))} style={{ ...S.noteBtn, ...(amount === n && v !== "" ? { borderColor: "var(--green)", color: "var(--green)" } : {}) }}>{n === 0 ? "SIN FONDO" : money(n)}</button>)}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "←"].map(k => (
            <button key={k} onClick={() => k === "←" ? setV(x => x.slice(0, -1)) : press(k)} style={S.padBtn}>{k}</button>
          ))}
        </div>

        <button disabled={v === ""} onClick={() => onSave(round2(amount))} style={{ ...S.btnPrimary, width: "100%", marginTop: 14, padding: "18px", fontSize: 17, opacity: v === "" ? .4 : 1 }}>
          ✅ Confirmar fondo y abrir la caja
        </button>
        <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", marginTop: 10 }}>Cuenta el dinero del cajón. Al cerrar el turno se usará para cuadrar.</div>
        {pending && <div style={{ fontSize: 12, color: "var(--amber)", textAlign: "center", marginTop: 6 }}>⏳ Se guardará en este dispositivo y subirá solo cuando haya conexión.</div>}
        <button onClick={onBack} style={{ ...S.btnGhost, width: "100%", marginTop: 10, padding: "13px" }}>Cambiar de barra / rol</button>
      </div>
    </div>
  );
}

/* ---------------------- Cobro avanzado (efectivo / tarjeta + cambio) ---------------------- */
function PayFlow({ total, lines = [], changeHelp = true, onDone, onCancel, onDisableHelp }) {
  const isMobile = useIsMobile();
  const [mode, setMode] = useState(null);        // null | efectivo
  const [given, setGiven] = useState("");
  const g = parseFloat(given || "0") || 0;
  const change = round2(g - total);
  const enough = g >= total;
  // Billetes/monedas sugeridos: el importe justo + los billetes por encima
  const notes = [5, 10, 20, 50, 100].filter(n => n >= total).slice(0, 4);
  const quick = [round2(total), ...notes.filter(n => n !== total)];
  const press = (d) => setGiven(v => (d === "." && v.includes(".") ? v : (v + d).slice(0, 7)));
  // Sin ayuda con el cambio: efectivo cobra directo, sin pedir billetes
  const payCashDirect = () => onDone({ pago: "efectivo", entregado: null, cambio: null });

  return (
    <div style={S.payWrap}>
      <div className={isMobile ? "sheet-anim" : ""} style={{ ...S.payCard, ...(isMobile ? { borderRadius: "22px 22px 0 0", maxHeight: "94dvh" } : {}) }}>
        {/* Total a cobrar, enorme */}
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          {lines.length > 0 && (
            <div style={{ background: "var(--surface2)", borderRadius: 12, padding: "8px 12px", marginBottom: 12, textAlign: "left" }}>
              {lines.map((l, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 15, fontWeight: 700, padding: "3px 0" }}>
                  <span style={{ minWidth: 0 }}><b style={{ color: "var(--accent)" }}>{l.qty} ×</b> {l.name}</span>
                  <span style={{ flexShrink: 0 }}>{money(l.total)}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 2, fontWeight: 800 }}>Total a cobrar</div>
          <div style={{ fontSize: 52, fontWeight: 900, lineHeight: 1.05, color: "var(--accent)" }}>{money(total)}</div>
        </div>

        {!mode && (<>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <button onClick={() => changeHelp ? setMode("efectivo") : payCashDirect()} style={{ ...S.payBtn, background: "linear-gradient(160deg,#22d3a6,#12a37c)", color: "#04231a" }}>
              <span style={{ fontSize: 46 }}>💶</span><span style={{ fontSize: 20, fontWeight: 900 }}>EFECTIVO</span>
            </button>
            <button onClick={() => onDone({ pago: "tarjeta", entregado: null, cambio: null })} style={{ ...S.payBtn, background: "linear-gradient(160deg,#4d8dff,#2b62d9)", color: "#04122e" }}>
              <span style={{ fontSize: 46 }}>💳</span><span style={{ fontSize: 20, fontWeight: 900 }}>TARJETA</span>
            </button>
          </div>
          <button onClick={onCancel} style={{ ...S.btnGhost, width: "100%", marginTop: 14, padding: "14px" }}>Cancelar</button>
          {!changeHelp && (
            <div style={{ border: "1px dashed var(--line)", borderRadius: 12, padding: 10, marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 150, fontSize: 12, color: "var(--muted)" }}>Ayuda con el cambio <b style={{ color: "var(--text)" }}>desactivada</b>.</div>
              <button onClick={() => { onDisableHelp && onDisableHelp(true); setMode("efectivo"); }} style={{ ...S.smallBtn, padding: "9px 12px", fontWeight: 800 }}>Activar</button>
            </div>
          )}
        </>)}

        {mode === "efectivo" && (<>
          {/* Cambio, muy visible */}
          <div style={{ background: enough ? "rgba(34,211,166,.12)" : "var(--surface2)", border: `2px solid ${enough ? "var(--green)" : "var(--line)"}`, borderRadius: 16, padding: 14, textAlign: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 2, fontWeight: 800 }}>Cambio a devolver</div>
            <div style={{ fontSize: 46, fontWeight: 900, lineHeight: 1.05, color: enough ? "var(--green)" : "var(--muted)" }}>{enough ? money(change) : "—"}</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>Entregado: <b style={{ color: "var(--text)" }}>{given ? money(g) : "—"}</b>{!enough && given ? " · falta dinero" : ""}</div>
          </div>

          {/* Billetes rápidos */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(82px,1fr))", gap: 8, marginBottom: 12 }}>
            {quick.map((n, i) => (
              <button key={n + "-" + i} onClick={() => { setGiven(String(n)); }} style={{ ...S.noteBtn, ...(i === 0 ? { borderColor: "var(--green)", color: "var(--green)" } : {}) }}>
                {i === 0 ? "JUSTO" : money(n)}
                {i === 0 && <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>{money(n)}</span>}
              </button>
            ))}
          </div>

          {/* Teclado numérico */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "←"].map(k => (
              <button key={k} onClick={() => k === "←" ? setGiven(v => v.slice(0, -1)) : press(k)} style={S.padBtn}>{k}</button>
            ))}
          </div>

          <button disabled={!enough} onClick={() => onDone({ pago: "efectivo", entregado: g, cambio: change })} style={{ ...S.btnPrimary, width: "100%", marginTop: 14, padding: "18px", fontSize: 18, opacity: enough ? 1 : .4 }}>
            ✅ Cobrado · Imprimir
          </button>

          {/* Recuadro: quitar este paso para las próximas ventas */}
          <div style={{ border: "1px dashed var(--line)", borderRadius: 12, padding: 12, marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontWeight: 800, fontSize: 13 }}>¿No necesitas ayuda con el cambio?</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>Se quita este paso. Seguirás eligiendo efectivo o tarjeta.</div>
            </div>
            <button onClick={() => { onDisableHelp && onDisableHelp(); payCashDirect(); }} style={{ ...S.smallBtn, padding: "10px 12px", fontWeight: 800 }}>Desactivar ayuda</button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={() => { setMode(null); setGiven(""); }} style={{ ...S.btnGhost, flex: 1, padding: "13px" }}>← Atrás</button>
            <button onClick={onCancel} style={{ ...S.btnGhost, flex: 1, padding: "13px" }}>Cancelar</button>
          </div>
        </>)}
      </div>
    </div>
  );
}

/* ---------------------- Stat ---------------------- */
function Stat({ label, value, accent }) {
  return <div style={S.statBox}><div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div><div style={{ fontSize: 24, fontWeight: 800, color: accent }}>{value}</div></div>;
}

/* ---------------------- Tarjeta de comprobación previa ---------------------- */
function CheckCard({ state, title, value, note, children }) {
  const c = state === "ok" ? "var(--green)" : state === "warn" ? "var(--amber)" : "var(--muted)";
  const icon = state === "ok" ? "✓" : state === "warn" ? "!" : "•";
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 26, height: 26, borderRadius: "50%", background: c, color: "#0b0c10", display: "grid", placeItems: "center", fontWeight: 900, flexShrink: 0 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>{title}</div>
          <div style={{ fontWeight: 800, fontSize: 16, wordBreak: "break-word" }}>{value}</div>
        </div>
      </div>
      {note && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>{note}</div>}
      {children}
    </div>
  );
}

/* ============================================================
   POS
   ============================================================ */
function POS({ punto, totals, rankCounts, onOrder, onSell, onSellMany, onVoid, onReprint, canReprint, onCombo, testMode, closed, advanced, onToggleAdvanced }) {
  const isMobile = useIsMobile();
  const combos = punto.combos || [];
  const [qty, setQty] = useState(1);
  const [grouping, setGrouping] = useState(false);
  const [cart, setCart] = useState([]); // [{product, qty}]
  const [charging, setCharging] = useState(null);

  // Orden de los productos: manual, o "más vendidos primero".
  // En modo ventas el orden se CONGELA mientras vendes (no salta bajo el dedo);
  // se recalcula al entrar al TPV, al cambiar de barra o al pulsar "Actualizar orden".
  const sortMode = punto.sortMode === "ventas" ? "ventas" : "manual";
  const countsRef = useRef(rankCounts); countsRef.current = rankCounts;
  const [rankKey, setRankKey] = useState(0);
  const prodSig = punto.products.map(p => p.id).join(",");
  const rankOrder = useMemo(() => {
    if (sortMode !== "ventas") return null;
    const c = countsRef.current || {};
    return punto.products.map((p, i) => [p.id, c[p.id] || 0, i]).sort((x, y) => (y[1] - x[1]) || (x[2] - y[2])).map(x => x[0]);
  }, [punto.id, sortMode, rankKey, prodSig]);
  const shownProducts = rankOrder ? rankOrder.map(id => punto.products.find(p => p.id === id)).filter(Boolean) : punto.products;
  const rankStale = !!rankOrder && rankOrder.join(",") !== punto.products.map((p, i) => [p.id, (rankCounts || {})[p.id] || 0, i]).sort((x, y) => (y[1] - x[1]) || (x[2] - y[2])).map(x => x[0]).join(",");

  const cartQty = (id) => cart.find(c => c.product.id === id)?.qty || 0;
  const cartCount = cart.reduce((t, c) => t + c.qty, 0);
  const cartTotal = cart.reduce((t, c) => t + c.product.price * c.qty, 0);

  const tap = (p) => {
    if (p.soldOut) return;
    if (grouping) {
      setCart(prev => { const i = prev.findIndex(c => c.product.id === p.id); if (i >= 0) { const cp = [...prev]; cp[i] = { ...cp[i], qty: cp[i].qty + 1 }; return cp; } return [...prev, { product: p, qty: 1 }]; });
    } else { onSell(p, qty); setQty(1); }
  };
  const changeQty = (id, d) => setCart(prev => prev.flatMap(c => c.product.id === id ? (c.qty + d <= 0 ? [] : [{ ...c, qty: c.qty + d }]) : [c]));
  const startGroup = () => { setGrouping(true); setCart([]); };
  const cancelGroup = () => { setGrouping(false); setCart([]); setCharging(null); };
  const confirmCharge = () => { onSellMany(cart.map(c => ({ product: c.product, qty: c.qty }))); cancelGroup(); };

  return (
    <div>
      {closed && <div style={{ background: "var(--red)", color: "#fff", fontWeight: 800, textAlign: "center", padding: "12px", borderRadius: 12, marginBottom: 14 }}>🔒 CAJA CERRADA · no se puede vender en este evento</div>}
      {testMode && !closed && <div style={{ background: "var(--amber)", color: "#1a1205", fontWeight: 800, textAlign: "center", padding: "12px", borderRadius: 12, marginBottom: 14 }}>🧪 MODO PRUEBA · imprime pero NO cuenta en la caja</div>}
      <button onClick={onToggleAdvanced} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", marginBottom: 14, borderRadius: 14, cursor: "pointer", textAlign: "left", background: advanced ? "rgba(34,211,166,.12)" : "var(--surface)", border: `2px solid ${advanced ? "var(--green)" : "var(--line)"}`, color: "var(--text)" }}>
        <span style={{ fontSize: 26, flexShrink: 0 }}>💶</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontWeight: 900, fontSize: 15 }}>Venta avanzada {advanced ? "ACTIVADA" : "desactivada"}</span>
          <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>{advanced ? "Al vender: total, lo que entrega el cliente y el cambio a devolver" : "Toca para cobrar con cálculo del cambio"}</span>
        </span>
        <span style={{ ...S.switch, display: "inline-block", flexShrink: 0, background: advanced ? "var(--green)" : "var(--line)" }}><span style={{ ...S.knob, left: 0, transform: advanced ? "translateX(20px)" : "translateX(2px)" }} /></span>
      </button>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        {!grouping ? (
          <>
            <div className="scroll-x" style={{ display: "flex", alignItems: "center", gap: 8, width: isMobile ? "100%" : "auto", paddingBottom: isMobile ? 2 : 0 }}>
              <span style={{ color: "var(--muted)", fontSize: 13, marginRight: 4, flexShrink: 0 }}>Cant.:</span>
              {[1, 2, 3, 4, 5, 7, 10].map(q => <button key={q} onClick={() => setQty(q)} style={{ ...S.qtyChip, flexShrink: 0, ...(qty === q ? S.qtyActive : {}) }}>×{q}</button>)}
            </div>
            <div style={{ display: "flex", gap: 8, width: isMobile ? "100%" : "auto" }}>
              <button onClick={startGroup} style={{ ...S.groupBtn, flex: isMobile ? 1 : "none" }}>🧾 Unir</button>
              <button onClick={onReprint} disabled={!canReprint} style={{ ...S.btnGhost, flex: isMobile ? 1 : "none", opacity: canReprint ? 1 : .4 }}>🖨️ {isMobile ? "Reimp." : "Reimprimir"}</button>
              <button onClick={onVoid} style={{ ...S.voidBtn, flex: isMobile ? 1 : "none" }}>↩︎ Anular</button>
            </div>
          </>
        ) : (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", gap: 8 }}>
            <div style={{ fontWeight: 800, fontSize: isMobile ? 14 : 16, color: "var(--accent)", minWidth: 0 }}>🧾 {isMobile ? "Comanda · ve sumando" : "Modo comanda · toca para ir sumando"}</div>
            <button onClick={cancelGroup} style={{ ...S.voidBtn, flexShrink: 0 }}>✕ {isMobile ? "" : "Cancelar comanda"}</button>
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 18, alignItems: "flex-start" }}>
        {/* productos */}
        <div style={{ flex: 1, width: "100%" }}>
          {punto.products.length > 1 && (sortMode === "ventas" || onOrder) && !grouping && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10, fontSize: 12, color: "var(--muted)", minHeight: 30 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Ic n={sortMode === "ventas" ? "reports" : "grip"} s={14} w={2.2} />{sortMode === "ventas" ? "Ordenados por más vendidos" : "Orden manual"}</span>
              <span style={{ display: "flex", gap: 6 }}>
                {rankStale && <button onClick={() => setRankKey(k => k + 1)} style={{ ...S.smallBtn, display: "inline-flex", alignItems: "center", gap: 6 }}><Ic n="refresh" s={13} w={2.2} />Actualizar orden</button>}
                {onOrder && <button onClick={onOrder} style={{ ...S.smallBtn, display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", fontSize: 12.5, color: "var(--accent)", background: "rgba(255,90,60,.1)", borderColor: "rgba(255,90,60,.4)" }}><Ic n="grip" s={14} w={2.4} />Ordenar productos</button>}
              </span>
            </div>
          )}
          {punto.products.length === 0 ? <Empty msg={`“${punto.name}” aún no tiene productos.`} /> : (
            <div style={{ ...S.grid, gridTemplateColumns: isMobile ? "repeat(auto-fill, minmax(130px,1fr))" : "repeat(auto-fill, minmax(170px,1fr))" }}>
              {shownProducts.map(p => {
                const badge = grouping ? cartQty(p.id) : totals.perProduct[p.id];
                return (
                  <button key={p.id} onClick={() => tap(p)} disabled={p.soldOut} className="tile" style={{ ...S.tile, background: p.soldOut ? "var(--surface2)" : `linear-gradient(160deg, ${p.color}, ${shade(p.color, -25)})`, color: p.soldOut ? "var(--muted)" : "#fff", cursor: p.soldOut ? "not-allowed" : "pointer", outline: grouping && cartQty(p.id) ? "3px solid #fff" : "none" }}>
                    {badge ? <span style={{ ...S.tileBadge, background: grouping ? "var(--accent)" : "rgba(0,0,0,.45)" }}>{badge}</span> : null}
                    {p.soldOut && <span style={S.soldOut}>AGOTADO</span>}
                    <span style={{ fontSize: 44 }}>{p.emoji}</span>
                    <span style={{ fontSize: 19, fontWeight: 800, lineHeight: 1.1, textShadow: p.soldOut ? "none" : "0 1px 3px rgba(0,0,0,.3)" }}>{p.name}</span>
                    <span style={{ fontSize: 22, fontWeight: 800 }}>{money(p.price)}</span>
                  </button>
                );
              })}
            </div>
          )}
          {!grouping && qty > 1 && <div style={{ marginTop: 14, textAlign: "center", color: "var(--amber)", fontWeight: 700 }}>Modo cantidad ×{qty}: el siguiente toque vende {qty} unidades en un ticket.</div>}

          {!grouping && combos.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, fontWeight: 800, marginBottom: 10 }}>🎟️ Bonos / Ofertas</div>
              <div style={{ ...S.grid, gridTemplateColumns: isMobile ? "repeat(auto-fill, minmax(150px,1fr))" : "repeat(auto-fill, minmax(180px,1fr))" }}>
                {combos.map(c => {
                  const units = (c.items || []).reduce((t, it) => t + (it.qty || 1), 0);
                  const price = (c.price === "" || c.price == null) ? (c.items || []).reduce((t, it) => { const p = punto.products.find(x => x.id === it.productId); return t + (p ? p.price * (it.qty || 1) : 0); }, 0) : Number(c.price);
                  return (
                    <button key={c.id} onClick={() => onCombo(c)} className="tile" style={{ ...S.tile, minHeight: 130, background: "linear-gradient(160deg, #ffb400, #d98e00)", color: "#1a1205", border: "2px solid #ffd479" }}>
                      <span style={{ position: "absolute", top: 10, left: 10, background: "rgba(0,0,0,.18)", borderRadius: 8, padding: "2px 8px", fontWeight: 900, fontSize: 12 }}>{units} tickets</span>
                      <span style={{ fontSize: 34 }}>🎟️</span>
                      <span style={{ fontSize: 18, fontWeight: 900, lineHeight: 1.1, textAlign: "center" }}>{c.name}</span>
                      <span style={{ fontSize: 20, fontWeight: 900 }}>{money(price)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* panel comanda */}
        {grouping && (
          <div style={{ ...S.cart, ...(isMobile ? { width: "100%", maxHeight: "none", position: "static" } : {}) }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 12 }}>🧾 Comanda <span style={{ color: "var(--muted)", fontWeight: 600, fontSize: 13 }}>· {cartCount} art.</span></div>
            <div style={{ flex: 1, overflow: "auto", marginBottom: 12 }}>
              {cart.length === 0 ? <div style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", padding: "30px 0" }}>Toca productos para añadirlos</div> : cart.map(c => (
                <div key={c.product.id} style={S.cartRow}>
                  <span style={{ fontSize: 20 }}>{c.product.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.product.name}</div><div style={{ fontSize: 11, color: "var(--muted)" }}>{money(c.product.price)} · {money(c.product.price * c.qty)}</div></div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <button onClick={() => changeQty(c.product.id, -1)} style={S.stepBtn}>−</button>
                    <span style={{ width: 22, textAlign: "center", fontWeight: 800 }}>{c.qty}</span>
                    <button onClick={() => changeQty(c.product.id, 1)} style={S.stepBtn}>+</button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}><span style={{ color: "var(--muted)", fontSize: 13 }}>TOTAL A COBRAR</span><span style={{ fontSize: 30, fontWeight: 800, color: "var(--green)" }}>{money(cartTotal)}</span></div>
              <button onClick={() => cart.length && setCharging(true)} disabled={!cart.length} style={{ ...S.btnPrimary, padding: "16px", fontSize: 17, opacity: cart.length ? 1 : .4 }}>Cobrar e imprimir →</button>
            </div>
          </div>
        )}
      </div>

      {/* overlay de cobro: muestra el total antes de imprimir */}
      {charging && (
        <div style={isMobile ? S.sheetWrap : S.overlay} onClick={() => setCharging(null)}>
          <div className={isMobile ? "sheet-anim" : ""} style={isMobile ? S.sheet : { ...S.pinCard, width: 360 }} onClick={e => e.stopPropagation()}>
            {isMobile && <div style={S.grab} />}
            <div style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>Cobra al cliente</div>
            <div style={{ textAlign: "center", fontSize: 52, fontWeight: 800, color: "var(--green)", margin: "8px 0 14px" }}>{money(cartTotal)}</div>
            <div style={{ maxHeight: 200, overflow: "auto", marginBottom: 14 }}>
              {cart.map(c => <div key={c.product.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--line)" }}><span>{c.qty}× {c.product.name}</span><span>{money(c.product.price * c.qty)}</span></div>)}
            </div>
            <button onClick={confirmCharge} style={{ ...S.btnPrimary, padding: 16, fontSize: 16 }}>🖨️ Imprimir {cartCount} tickets</button>
            <button onClick={() => setCharging(null)} style={{ ...S.btnGhost, marginTop: 8, width: "100%" }}>Volver a la comanda</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   TEMPLATE DESIGNER
   ============================================================ */
function TemplateDesigner({ ev, dispatch, flash }) {
  const isMobile = useIsMobile();
  const set = (patch) => dispatch({ type: "UPDATE_EVENT", id: ev.id, patch });
  const st = ev.style || {};
  const setStyle = (k, v) => set({ style: { ...st, [k]: v } });
  const templates = [
    { k: "festival", l: "Festival", d: "Banner con marco" },
    { k: "bold", l: "Bold", d: "Recuadro grande" },
    { k: "minimal", l: "Minimal", d: "Limpio, a la izquierda" },
    { k: "clasico", l: "Clásico", d: "Centrado con estrellas" },
    { k: "vale", l: "Vale", d: "Estilo resguardo" },
    { k: "sello", l: "Sello", d: "Con código grande" },
  ];
  const demo = ev.puntos.flatMap(p => p.products)[0] || { name: "NOMBRE TICKET", price: 10, id: "abc123" };
  const Toggle = ({ k, label }) => (
    <label style={S.toggleRow}><span>{label}</span><button onClick={() => set({ [k]: !ev[k] })} style={{ ...S.switch, background: ev[k] ? "var(--accent)" : "var(--line)" }}><span style={{ ...S.knob, transform: ev[k] ? "translateX(20px)" : "translateX(2px)" }} /></button></label>
  );
  const StyleToggle = ({ k, label, def = true }) => { const on = st[k] !== false && (st[k] !== undefined ? st[k] : def); return (
    <label style={S.toggleRow}><span>{label}</span><button onClick={() => setStyle(k, !on)} style={{ ...S.switch, background: on ? "var(--accent)" : "var(--line)" }}><span style={{ ...S.knob, transform: on ? "translateX(20px)" : "translateX(2px)" }} /></button></label>
  ); };
  const Seg = ({ k, label, opts }) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{opts.map(o => <button key={o.v} onClick={() => setStyle(k, o.v)} style={{ ...S.chip, ...((st[k] || opts[0].v) === o.v ? S.chipActive : {}) }}>{o.l}</button>)}</div>
    </div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 330px", gap: 24, alignItems: "start" }}>
      <div>
        <h3 style={S.h3}>Plantilla de impresión</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 22 }}>{templates.map(t => <button key={t.k} onClick={() => set({ template: t.k })} style={{ ...S.tplCard, ...(ev.template === t.k ? S.tplActive : {}) }}><div style={{ fontWeight: 800 }}>{t.l}</div><div style={{ fontSize: 12, color: "var(--muted)" }}>{t.d}</div></button>)}</div>
        <h3 style={S.h3}>Ancho de papel</h3>
        <div style={{ display: "flex", gap: 10, marginBottom: 22 }}>{[58, 80].map(w => <button key={w} onClick={() => set({ paper: w })} style={{ ...S.chip, ...(ev.paper === w ? S.chipActive : {}) }}>{w} mm</button>)}</div>
        <h3 style={S.h3}>Logo del ticket</h3>
        <div style={S.panel}>
          {ev.logo && typeof ev.logo === "string" && ev.logo.startsWith("data:") ? (
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ background: "#fff", borderRadius: 8, padding: 8 }}><img src={ev.logo} alt="logo" style={{ maxHeight: 50, maxWidth: 120, display: "block" }} /></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, marginBottom: 8 }}>Logo cargado ✓</div>
                <button onClick={() => set({ logo: "" })} style={S.smallBtn}>Quitar logo</button>
              </div>
            </div>
          ) : (
            <>
              <label style={{ ...S.btnGhost, display: "inline-block", textAlign: "center", cursor: "pointer", width: "100%" }}>
                📷 Subir imagen de logo
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => {
                  const f = e.target.files?.[0]; if (!f) return;
                  if (f.size > 1500000) { flash("Imagen muy grande (máx 1,5 MB)", "warn"); return; }
                  const reader = new FileReader();
                  reader.onload = () => { set({ logo: reader.result }); flash("Logo cargado"); };
                  reader.readAsDataURL(f);
                }} />
              </label>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>PNG o JPG. Se imprime en blanco y negro; un logo de alto contraste sale mejor en térmica.</div>
              {ev.logo && <div style={{ fontSize: 12, marginTop: 8 }}>Texto actual: <b>{ev.logo}</b> · <button onClick={() => set({ logo: "" })} style={{ ...S.smallBtn, marginLeft: 4 }}>Quitar</button></div>}
            </>
          )}
        </div>
        <h3 style={{ ...S.h3, marginTop: 22 }}>Qué se imprime</h3>
        <div style={S.panel}><Toggle k="showEventName" label="Nombre del evento" /><Toggle k="showDate" label="Fecha del evento" /><Toggle k="showTime" label="Hora de impresión" /><Toggle k="showPrice" label="Precio" /></div>

        <h3 style={{ ...S.h3, marginTop: 22 }}>Personalización</h3>
        <div style={S.panel}>
          <Seg k="nameSize" label="Tamaño del nombre del producto" opts={[{ v: "md", l: "Normal" }, { v: "lg", l: "Grande" }, { v: "xl", l: "Enorme" }]} />
          <Seg k="logoSize" label="Tamaño del logo" opts={[{ v: "md", l: "Normal" }, { v: "sm", l: "Pequeño" }, { v: "lg", l: "Grande" }]} />
          <StyleToggle k="showLogo" label="Mostrar logo" />
          <StyleToggle k="showFolio" label="Mostrar folio (nº de ticket)" />
          <StyleToggle k="border" label="Marco alrededor del ticket" def={false} />
        </div>

        <h3 style={{ ...S.h3, marginTop: 22 }}>Textos extra</h3>
        <div style={S.panel}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Subtítulo (bajo el nombre del evento)</div>
          <input value={st.subtitle || ""} onChange={e => setStyle("subtitle", e.target.value)} style={S.input} placeholder="Ej. 3ª edición" maxLength={40} />
          <div style={{ fontSize: 12, color: "var(--muted)", margin: "12px 0 6px" }}>Mensaje destacado (recuadro al final)</div>
          <input value={st.message || ""} onChange={e => setStyle("message", e.target.value)} style={S.input} placeholder="Ej. VÁLIDO SOLO HOY" maxLength={40} />
        </div>
        <h3 style={S.h3}>Pie de ticket</h3>
        <input value={ev.footer} onChange={e => set({ footer: e.target.value })} style={S.input} placeholder="Texto de pie" />
        <button onClick={() => flash("Plantilla guardada")} style={{ ...S.btnPrimary, marginTop: 16, width: "auto", padding: "12px 26px" }}>Guardar plantilla</button>
      </div>
      <div style={{ position: "sticky", top: 0 }}>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Vista previa en vivo</div>
        <div style={S.paperWrap}><ThermalTicket ev={ev} product={demo} time={timeNow()} num={42} /></div>
      </div>
    </div>
  );
}

/* ============================================================
   EVENT CONFIG
   ============================================================ */
function EventConfig({ state, ev, punto, evSales, role, onReset, dispatch, flash }) {
  const isMobile = useIsMobile();
  const isAdmin = role === "admin";
  const [confirmReset, setConfirmReset] = useState(0); // 0 no, 1 primer aviso, 2 aviso final
  const [draft, setDraft] = useState({ name: "", price: "", emoji: "🎟️", color: PALETTE[0] });
  const [newEvent, setNewEvent] = useState(null);
  const [newPunto, setNewPunto] = useState("");
  const [confirmDel, setConfirmDel] = useState(null);
  const [editProd, setEditProd] = useState(null);   // producto en edición
  const [renamePunto, setRenamePunto] = useState(null); // {id, value}
  const [editCombo, setEditCombo] = useState(null); // bono en edición
  const combos = punto.combos || [];
  const saveCombos = (next) => dispatch({ type: "UPDATE_PUNTO", eventId: ev.id, puntoId: punto.id, patch: { combos: next } });
  const newCombo = () => { if (!punto.products.length) { flash("Crea productos antes de un bono", "warn"); return; } setEditCombo({ id: uid(), name: "", price: "", items: [{ productId: punto.products[0].id, qty: 1 }] }); };
  const saveCombo = () => {
    if (!editCombo.name.trim()) { flash("Pon nombre al bono", "warn"); return; }
    const items = (editCombo.items || []).filter(it => it.productId && it.qty > 0);
    if (!items.length) { flash("Añade al menos un producto", "warn"); return; }
    const clean = { ...editCombo, name: editCombo.name.toUpperCase(), price: editCombo.price === "" ? "" : Number(editCombo.price), items };
    const exists = combos.some(c => c.id === editCombo.id);
    saveCombos(exists ? combos.map(c => c.id === editCombo.id ? clean : c) : [...combos, clean]);
    setEditCombo(null); flash("Bono guardado");
  };
  const delCombo = (id) => { saveCombos(combos.filter(c => c.id !== id)); flash("Bono borrado"); };
  const puntoTieneVentas = (id) => evSales.some(s => s.puntoId === id);
  // ---- Orden de productos ----
  const { sortMode, sold, salesRank, reorder, moveProd, setSortMode, applySalesOrder } = useProductOrder(ev, punto, evSales, dispatch, flash);

  const saveRename = () => {
    if (!renamePunto?.value.trim()) { flash("El nombre no puede estar vacío", "warn"); return; }
    dispatch({ type: "UPDATE_PUNTO", eventId: ev.id, puntoId: renamePunto.id, patch: { name: renamePunto.value.trim() } });
    setRenamePunto(null); flash("Punto renombrado");
  };
  const saveProduct = () => {
    if (!editProd.name.trim() || editProd.price === "" || isNaN(parseFloat(editProd.price))) { flash("Pon nombre y precio válidos", "warn"); return; }
    dispatch({ type: "UPDATE_PRODUCT", eventId: ev.id, puntoId: punto.id, productId: editProd.id, patch: { name: editProd.name.toUpperCase(), price: parseFloat(editProd.price), emoji: editProd.emoji, color: editProd.color, soldOut: editProd.soldOut } });
    setEditProd(null); flash("Producto actualizado");
  };

  const addProduct = () => {
    if (!draft.name.trim() || !draft.price) { flash("Pon nombre y precio", "warn"); return; }
    const nextOrden = punto.products.reduce((m, x) => Math.max(m, (x.orden ?? 0) + 1), punto.products.length);
    dispatch({ type: "ADD_PRODUCT", eventId: ev.id, puntoId: punto.id, product: { id: uid(), name: draft.name.toUpperCase(), price: parseFloat(draft.price), emoji: draft.emoji, color: draft.color, soldOut: false, orden: nextOrden } });
    setDraft({ name: "", price: "", emoji: "🎟️", color: PALETTE[Math.floor(Math.random() * PALETTE.length)] });
    flash("Producto añadido a " + punto.name);
  };
  const addPunto = () => { if (!newPunto.trim()) { flash("Pon nombre al punto", "warn"); return; } dispatch({ type: "ADD_PUNTO", eventId: ev.id, punto: { id: uid(), name: newPunto.trim(), archivado: false, products: [] } }); setNewPunto(""); flash("Punto de venta creado"); };
  const createEvent = () => { if (!newEvent.name.trim()) { flash("Falta el nombre", "warn"); return; } dispatch({ type: "ADD_EVENT", event: { id: uid(), name: newEvent.name.toUpperCase(), date: newEvent.date || "2026-01-01", venue: newEvent.venue, template: "festival", paper: 80, footer: "", logo: "", showEventName: true, showDate: true, showTime: true, showPrice: true, anularPin: false, puntos: [{ id: uid(), name: "Taquilla", archivado: false, products: [] }] } }); setNewEvent(null); flash("Evento creado"); };

  return (
    <>
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0,1fr)" : "minmax(0,1fr) minmax(0,1fr)", gap: 24, alignItems: "start" }}>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><h3 style={S.h3}>Datos del evento</h3><button onClick={() => setNewEvent({ name: "", date: "", venue: "" })} style={S.btnGhost}>+ Nuevo evento</button></div>
        <div style={S.panel}>
          <Field label="Nombre"><input style={S.input} value={ev.name} onChange={e => dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: { name: e.target.value } })} /></Field>
          <Field label="Fecha"><input type="date" style={S.input} value={ev.date} onChange={e => dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: { date: e.target.value } })} /></Field>
          <Field label="Inicio del evento (cuándo abre)"><input type="datetime-local" style={S.input} value={ev.startsAt || ""} onChange={e => dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: { startsAt: e.target.value } })} /></Field>
          <Field label="Recinto"><input style={S.input} value={ev.venue} onChange={e => dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: { venue: e.target.value } })} /></Field>
          <div style={{ display: "flex", gap: 10 }}>
            <Field label="PIN admin"><input style={S.input} value={ev.pin_admin || ""} maxLength={6} onChange={e => dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: { pin_admin: e.target.value } })} /></Field>
            <Field label="PIN supervisor"><input style={S.input} value={ev.pin_supervisor || ""} maxLength={6} onChange={e => dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: { pin_supervisor: e.target.value } })} /></Field>
          </div>
          <label style={S.toggleRow}><span>Anular ticket en caja exige PIN de supervisor</span><button onClick={() => dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: { anularPin: !ev.anularPin } })} style={{ ...S.switch, background: ev.anularPin ? "var(--accent)" : "var(--line)" }}><span style={{ ...S.knob, transform: ev.anularPin ? "translateX(20px)" : "translateX(2px)" }} /></button></label>
          <label style={S.toggleRow}><span><b>Venta avanzada</b> · pedir efectivo/tarjeta y calcular el cambio</span><button onClick={() => dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: { advanced: !ev.advanced } })} style={{ ...S.switch, background: ev.advanced ? "var(--green)" : "var(--line)" }}><span style={{ ...S.knob, transform: ev.advanced ? "translateX(20px)" : "translateX(2px)" }} /></button></label>
          {ev.advanced && <label style={S.toggleRow}><span>Ayuda con el cambio · billetes y cálculo de devolución</span><button onClick={() => dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: { changeHelp: !(ev.changeHelp !== false) } })} style={{ ...S.switch, background: ev.changeHelp !== false ? "var(--green)" : "var(--line)" }}><span style={{ ...S.knob, transform: ev.changeHelp !== false ? "translateX(20px)" : "translateX(2px)" }} /></button></label>}
          {ev.advanced && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Al vender, el camarero elegirá <b>Efectivo</b> o <b>Tarjeta</b>. {ev.changeHelp !== false ? "Con efectivo verá los billetes y el cambio a devolver." : "Con efectivo cobrará directo, sin pedir billetes."} El cierre Z mostrará el arqueo separado.</div>}
        </div>

        {isAdmin && (
          <div style={{ ...S.panel, marginTop: 16 }}>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>Estado de la caja</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 13, color: ev.closed ? "var(--red)" : "var(--green)", fontWeight: 800 }}>{ev.closed ? "● CAJA CERRADA — no se vende" : "● Caja abierta"}</div>
              <button onClick={() => dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: { closed: !ev.closed } })} style={{ ...S.btnPrimary, width: "auto", padding: "0 18px", background: ev.closed ? "var(--green)" : "var(--red)" }}>{ev.closed ? "Reabrir caja" : "Cerrar caja"}</button>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Al cerrar, ninguna barra podrá vender más en este evento. Solo un admin puede reabrirla.</div>
          </div>
        )}

        {isAdmin && (
          <div style={{ ...S.panel, marginTop: 16, border: "1px solid var(--red)" }}>
            <div style={{ fontWeight: 800, marginBottom: 6, color: "var(--red)" }}>⚠️ Zona peligrosa</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>Resetear borra TODAS las ventas y cierres de “{ev.name}”. Ideal para limpiar las pruebas antes del evento. No se puede deshacer.</div>
            <button onClick={() => setConfirmReset(1)} style={{ ...S.btnGhost, width: "100%", color: "var(--red)", borderColor: "var(--red)" }}>Resetear estadísticas</button>
          </div>
        )}
        {newEvent && (
          <div style={{ ...S.panel, marginTop: 16, border: "1px solid var(--accent)" }}>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>Crear evento nuevo</div>
            <input style={S.input} placeholder="Nombre del evento" value={newEvent.name} onChange={e => setNewEvent({ ...newEvent, name: e.target.value })} /><div style={{ height: 8 }} />
            <input type="date" style={S.input} value={newEvent.date} onChange={e => setNewEvent({ ...newEvent, date: e.target.value })} /><div style={{ height: 8 }} />
            <input style={S.input} placeholder="Recinto" value={newEvent.venue} onChange={e => setNewEvent({ ...newEvent, venue: e.target.value })} />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}><button style={S.btnPrimary} onClick={createEvent}>Crear</button><button style={S.btnGhost} onClick={() => setNewEvent(null)}>Cancelar</button></div>
          </div>
        )}
        <h3 style={{ ...S.h3, marginTop: 22 }}>Puntos de venta ({ev.puntos.filter(p => !p.archivado).length} activos)</h3>
        <div style={S.panel}>
          <div style={{ display: "flex", gap: 8 }}><input style={S.input} placeholder="Nuevo punto (ej. Barra VIP)" value={newPunto} onChange={e => setNewPunto(e.target.value)} onKeyDown={e => e.key === "Enter" && addPunto()} /><button onClick={addPunto} style={{ ...S.btnPrimary, width: "auto", padding: "0 18px" }}>+</button></div>
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {ev.puntos.map(p => {
              const active = p.id === punto.id;
              const conVentas = puntoTieneVentas(p.id);
              return (
                <div key={p.id} style={{ ...S.prodRow, borderColor: active ? "var(--accent)" : "var(--line)", opacity: p.archivado ? 0.55 : 1 }}>
                  {renamePunto?.id === p.id ? (
                    <>
                      <input autoFocus style={{ ...S.input, flex: 1 }} value={renamePunto.value} onChange={e => setRenamePunto({ id: p.id, value: e.target.value })} onKeyDown={e => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") setRenamePunto(null); }} />
                      <button onClick={saveRename} style={{ ...S.smallBtn, color: "var(--green)", borderColor: "var(--green)" }}>Guardar</button>
                      <button onClick={() => setRenamePunto(null)} style={S.smallBtn}>✗</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => !p.archivado && dispatch({ type: "SET_PUNTO", id: p.id })} disabled={p.archivado} style={{ flex: 1, textAlign: "left", background: "transparent", border: "none", color: "var(--text)", cursor: p.archivado ? "default" : "pointer" }}>
                        <div style={{ fontWeight: 700 }}>{active ? "▶ " : ""}{p.name} {p.archivado && <span style={{ fontSize: 10, color: "var(--muted)", border: "1px solid var(--line)", borderRadius: 6, padding: "1px 6px", marginLeft: 4 }}>ARCHIVADO</span>}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>{p.products.length} productos{conVentas ? " · con ventas" : ""}</div>
                      </button>
                      <button onClick={() => setRenamePunto({ id: p.id, value: p.name })} style={S.smallBtn} title="Renombrar">✏️</button>
                      {conVentas ? (
                        <button onClick={() => dispatch({ type: "ARCHIVE_PUNTO", eventId: ev.id, puntoId: p.id, value: !p.archivado })} style={{ ...S.smallBtn, color: p.archivado ? "var(--green)" : "var(--amber)", borderColor: p.archivado ? "var(--green)" : "var(--amber)" }}>{p.archivado ? "Activar" : "Archivar"}</button>
                      ) : ev.puntos.length > 1 ? (
                        confirmDel === p.id ? (
                          <span style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => { dispatch({ type: "DELETE_PUNTO", eventId: ev.id, puntoId: p.id }); setConfirmDel(null); flash("Punto borrado"); }} style={{ ...S.smallBtn, color: "var(--red)", borderColor: "var(--red)" }}>✓ Borrar</button>
                            <button onClick={() => setConfirmDel(null)} style={S.smallBtn}>✗</button>
                          </span>
                        ) : <button onClick={() => setConfirmDel(p.id)} style={S.del}>✕</button>
                      ) : null}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div>
        <h3 style={S.h3}>Productos de “{punto.name}” ({punto.products.length})</h3>
        <div style={S.panel}>
          <input style={S.input} placeholder="Nombre (ej. ENTRADA GENERAL)" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}><input style={{ ...S.input, width: 110 }} type="number" placeholder="Precio €" value={draft.price} onChange={e => setDraft({ ...draft, price: e.target.value })} /><EmojiPicker value={draft.emoji} onChange={v => setDraft({ ...draft, emoji: v })} size={46} /></div>
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>{PALETTE.map(c => <button key={c} onClick={() => setDraft({ ...draft, color: c })} style={{ width: 26, height: 26, borderRadius: 7, background: c, border: draft.color === c ? "3px solid #fff" : "3px solid transparent", cursor: "pointer" }} />)}</div>
          <button onClick={addProduct} style={{ ...S.btnPrimary, marginTop: 12 }}>+ Añadir a {punto.name}</button>
        </div>
        {punto.products.length > 1 && (
          <div style={{ ...S.panel, marginTop: 14, padding: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4 }}>Orden en el TPV</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>{sortMode === "ventas" ? "Lo que más se vende sale primero. Con empate o sin ventas, se usa tu orden manual. El orden no salta mientras vendes: se actualiza al entrar al TPV." : (isMobile ? "Mantén pulsada el asa ⠿ de cada producto y arrástrala para colocarlo donde quieras." : "Arrastra cada producto desde el asa ⠿ (o usa las flechas) para colocarlo donde quieras.")}</div>
            <div style={S.segWrap}>
              <button onClick={() => setSortMode("manual")} style={{ ...S.seg, ...(sortMode === "manual" ? S.segOn : {}) }}><Ic n="grip" s={15} w={2.2} />Manual</button>
              <button onClick={() => setSortMode("ventas")} style={{ ...S.seg, ...(sortMode === "ventas" ? S.segOn : {}) }}><Ic n="reports" s={15} w={2.2} />{isMobile ? "Más vendidos" : "Más vendidos primero"}</button>
            </div>
            {sortMode === "manual" && <button onClick={applySalesOrder} style={{ ...S.smallBtn, marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px" }}><Ic n="reports" s={13} w={2.2} />Colocar una vez por ventas</button>}
          </div>
        )}
        <div style={{ marginTop: 14 }}>
          {punto.products.length === 0 && <Empty msg="Sin productos en este punto." />}
          <SortableList items={punto.products} onReorder={reorder} renderRow={(p, i, handle, dragging) => (
            <div style={{ ...S.prodRow, gap: isMobile ? 8 : 12, padding: isMobile ? "8px 8px 8px 6px" : 10, opacity: p.soldOut ? .55 : 1, ...(dragging ? S.prodRowDrag : {}) }}>
              {handle}
              <div style={{ width: 36, height: 36, borderRadius: 9, background: p.color, display: "grid", placeItems: "center", fontSize: 20, flexShrink: 0 }}>{p.emoji}</div>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div><div style={{ fontSize: 12, color: "var(--muted)" }}>{money(p.price)}{sortMode === "ventas" ? <> · <b style={{ color: "var(--accent)" }}>#{salesRank.indexOf(p.id) + 1}</b> · {sold[p.id] || 0} vendidos</> : (sold[p.id] ? ` · ${sold[p.id]} vendidos` : "")}</div></div>
              {!isMobile && <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <button onClick={() => moveProd(p.id, -1)} disabled={i === 0} style={{ ...S.arrowBtn, opacity: i === 0 ? .3 : 1 }} title="Subir" aria-label="Subir"><Ic n="up" s={13} w={2.4} /></button>
                <button onClick={() => moveProd(p.id, 1)} disabled={i === punto.products.length - 1} style={{ ...S.arrowBtn, opacity: i === punto.products.length - 1 ? .3 : 1 }} title="Bajar" aria-label="Bajar"><Ic n="down" s={13} w={2.4} /></button>
              </div>}
              <button onClick={() => setEditProd({ id: p.id, name: p.name, price: String(p.price), emoji: p.emoji, color: p.color, soldOut: p.soldOut })} style={S.smallBtn} title="Editar producto">✏️</button>
              <button onClick={() => dispatch({ type: "UPDATE_PRODUCT", eventId: ev.id, puntoId: punto.id, productId: p.id, patch: { soldOut: !p.soldOut } })} style={{ ...S.smallBtn, color: p.soldOut ? "var(--amber)" : "var(--muted)", borderColor: p.soldOut ? "var(--amber)" : "var(--line)" }}>{p.soldOut ? "Agotado" : "Disponible"}</button>
              <button onClick={() => dispatch({ type: "DELETE_PRODUCT", eventId: ev.id, puntoId: punto.id, productId: p.id })} style={S.del}>✕</button>
            </div>
          )} />
        </div>

        <h3 style={{ ...S.h3, marginTop: 22 }}>🎟️ Bonos / Ofertas especiales</h3>
        <div style={S.panel}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>Un bono imprime varios tickets de un clic (ej. BONOCOPAS = 4 copas). Se cobra al precio que pongas (o la suma si lo dejas vacío).</div>
          {combos.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 10 }}>Sin bonos en “{punto.name}”.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {combos.map(c => {
              const units = (c.items || []).reduce((t, it) => t + (it.qty || 1), 0);
              return (
                <div key={c.id} style={S.prodRow}>
                  <div style={{ width: 36, height: 36, borderRadius: 9, background: "linear-gradient(160deg,#ffb400,#d98e00)", display: "grid", placeItems: "center", fontSize: 18 }}>🎟️</div>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div><div style={{ fontSize: 12, color: "var(--muted)" }}>{units} tickets{(c.price !== "" && c.price != null) ? ` · ${money(Number(c.price))}` : ""}</div></div>
                  <button onClick={() => setEditCombo({ ...c, price: c.price ?? "", items: (c.items || []).map(i => ({ ...i })) })} style={S.smallBtn} title="Editar bono">✏️</button>
                  <button onClick={() => delCombo(c.id)} style={S.del}>✕</button>
                </div>
              );
            })}
          </div>
          <button onClick={newCombo} style={{ ...S.btnPrimary, marginTop: 12 }}>+ Nuevo bono</button>
        </div>
      </div>
    </div>

    {editProd && (
      <div style={isMobile ? S.sheetWrap : S.overlay} onClick={() => setEditProd(null)}>
        <div className={isMobile ? "sheet-anim" : ""} style={isMobile ? S.sheet : { ...S.pinCard, width: 360, maxWidth: "92vw", textAlign: "left" }} onClick={e => e.stopPropagation()}>
          {isMobile && <div style={S.grab} />}
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 14 }}>Editar producto</div>
          <Field label="Nombre"><input style={S.input} value={editProd.name} onChange={e => setEditProd({ ...editProd, name: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 8 }}>
            <Field label="Precio €"><input type="number" style={S.input} value={editProd.price} onChange={e => setEditProd({ ...editProd, price: e.target.value })} /></Field>
            <Field label="Icono"><EmojiPicker value={editProd.emoji} onChange={v => setEditProd({ ...editProd, emoji: v })} size={46} /></Field>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 6px" }}>Color</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{PALETTE.map(c => <button key={c} onClick={() => setEditProd({ ...editProd, color: c })} style={{ width: 28, height: 28, borderRadius: 7, background: c, border: editProd.color === c ? "3px solid #fff" : "3px solid transparent", cursor: "pointer" }} />)}</div>
          <label style={{ ...S.toggleRow, marginTop: 14 }}><span>Marcar como agotado</span><button onClick={() => setEditProd({ ...editProd, soldOut: !editProd.soldOut })} style={{ ...S.switch, background: editProd.soldOut ? "var(--amber)" : "var(--line)" }}><span style={{ ...S.knob, transform: editProd.soldOut ? "translateX(20px)" : "translateX(2px)" }} /></button></label>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}><button style={S.btnPrimary} onClick={saveProduct}>Guardar cambios</button><button style={S.btnGhost} onClick={() => setEditProd(null)}>Cancelar</button></div>
        </div>
      </div>
    )}

    {editCombo && (
      <div style={isMobile ? S.sheetWrap : S.overlay} onClick={() => setEditCombo(null)}>
        <div className={isMobile ? "sheet-anim" : ""} style={isMobile ? S.sheet : { ...S.pinCard, width: 380, maxWidth: "92vw", textAlign: "left" }} onClick={e => e.stopPropagation()}>
          {isMobile && <div style={S.grab} />}
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 14 }}>🎟️ Bono / Oferta</div>
          <Field label="Nombre del bono (ej. BONOCOPAS)"><input style={S.input} value={editCombo.name} onChange={e => setEditCombo({ ...editCombo, name: e.target.value })} /></Field>
          <Field label="Precio del bono € (vacío = suma de los productos)"><input type="number" style={S.input} placeholder="Suma automática" value={editCombo.price} onChange={e => setEditCombo({ ...editCombo, price: e.target.value })} /></Field>
          <div style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 8px" }}>Tickets que imprime este bono</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(editCombo.items || []).map((it, idx) => (
              <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select style={{ ...S.input, flex: 1 }} value={it.productId} onChange={e => { const items = editCombo.items.slice(); items[idx] = { ...it, productId: e.target.value }; setEditCombo({ ...editCombo, items }); }}>
                  {punto.products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <button onClick={() => { const items = editCombo.items.slice(); items[idx] = { ...it, qty: Math.max(1, (it.qty || 1) - 1) }; setEditCombo({ ...editCombo, items }); }} style={S.stepBtn}>−</button>
                  <span style={{ width: 24, textAlign: "center", fontWeight: 800 }}>{it.qty || 1}</span>
                  <button onClick={() => { const items = editCombo.items.slice(); items[idx] = { ...it, qty: (it.qty || 1) + 1 }; setEditCombo({ ...editCombo, items }); }} style={S.stepBtn}>+</button>
                </div>
                <button onClick={() => setEditCombo({ ...editCombo, items: editCombo.items.filter((_, i) => i !== idx) })} style={S.del}>✕</button>
              </div>
            ))}
          </div>
          <button onClick={() => setEditCombo({ ...editCombo, items: [...(editCombo.items || []), { productId: punto.products[0]?.id, qty: 1 }] })} style={{ ...S.btnGhost, marginTop: 10, width: "100%" }}>+ Añadir producto al bono</button>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}><button style={S.btnPrimary} onClick={saveCombo}>Guardar bono</button><button style={S.btnGhost} onClick={() => setEditCombo(null)}>Cancelar</button></div>
        </div>
      </div>
    )}
    {confirmReset > 0 && (
      <div style={S.overlay} onClick={() => setConfirmReset(0)}>
        <div style={{ ...S.pinCard, width: 360, maxWidth: "92vw", textAlign: "center", border: "2px solid var(--red)" }} onClick={e => e.stopPropagation()}>
          {confirmReset === 1 ? (<>
            <div style={{ fontSize: 40 }}>⚠️</div>
            <div style={{ fontWeight: 900, fontSize: 18, margin: "8px 0" }}>¿Resetear estadísticas?</div>
            <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 18 }}>Se borrarán TODAS las ventas y cierres de “{ev.name}”. Esto no se puede deshacer.</div>
            <button onClick={() => setConfirmReset(2)} style={{ ...S.btnPrimary, width: "100%", background: "var(--red)" }}>Continuar</button>
            <button onClick={() => setConfirmReset(0)} style={{ ...S.btnGhost, width: "100%", marginTop: 8 }}>Cancelar</button>
          </>) : (<>
            <div style={{ fontSize: 40 }}>🛑</div>
            <div style={{ fontWeight: 900, fontSize: 18, margin: "8px 0" }}>Última confirmación</div>
            <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 18 }}>¿Seguro del todo? Vas a borrar la caja de este evento para siempre.</div>
            <button onClick={() => { setConfirmReset(0); onReset && onReset(); }} style={{ ...S.btnPrimary, width: "100%", background: "var(--red)" }}>SÍ, BORRAR TODO</button>
            <button onClick={() => setConfirmReset(0)} style={{ ...S.btnGhost, width: "100%", marginTop: 8 }}>Cancelar</button>
          </>)}
        </div>
      </div>
    )}
    </>
  );
}

/* ============================================================
   REPORTS
   ============================================================ */
function Reports({ ev, evSales, role, onVoid, onCierreZ, flash, onBackup, lastBackup, onImported }) {
  const [backups, setBackups] = useState(null);
  const [showBackups, setShowBackups] = useState(false);
  const fileRef = useRef(null);
  const loadBk = async () => { try { setBackups(await db.loadBackups(ev.id)); } catch { setBackups([]); flash("Sin conexión: no se pueden ver las copias de la nube", "warn"); } };
  const downloadEmergency = () => {
    const blob = new Blob([db.exportPending()], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    const d = new Date(); a.download = `ticketera-emergencia-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}-${String(d.getHours()).padStart(2,"0")}${String(d.getMinutes()).padStart(2,"0")}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    flash(`💾 Copia de emergencia descargada (${db.pendingCount()} pendientes)`);
  };
  const importEmergency = async (file) => {
    try { const n = db.importPending(await file.text()); flash(n ? `✅ ${n} operaciones importadas` : "Nada nuevo que importar"); onImported && onImported(); }
    catch { flash("Archivo no válido", "warn"); }
  };
  const [confirmVoid, setConfirmVoid] = useState(null);
  const [countZ, setCountZ] = useState(null);   // {punto, esperado, fondo, efectivo, valor}
  const byPunto = ev.puntos.map(p => {
    const live = evSales.filter(s => s.puntoId === p.id && !s.voided);
    const perProduct = {}; let revenue = 0;
    live.forEach(s => { perProduct[s.productId] = (perProduct[s.productId] || 0) + 1; revenue += s.price; });
    return { punto: p, perProduct, revenue: round2(revenue), count: live.length, voids: evSales.filter(s => s.puntoId === p.id && s.voided).length };
  });
  const grandCount = byPunto.reduce((t, b) => t + b.count, 0);
  const grandRevenue = round2(byPunto.reduce((t, b) => t + b.revenue, 0));
  const totalVoids = byPunto.reduce((t, b) => t + b.voids, 0);

  // curva por hora
  const hours = {};
  evSales.filter(s => !s.voided).forEach(s => { const h = new Date(s.ts).getHours(); hours[h] = (hours[h] || 0) + 1; });
  const hourKeys = Object.keys(hours).map(Number).sort((a, b) => a - b);
  const maxHour = Math.max(1, ...Object.values(hours));
  // ranking
  const rank = {};
  evSales.filter(s => !s.voided).forEach(s => { rank[s.name] = rank[s.name] || { name: s.name, qty: 0, total: 0 }; rank[s.name].qty++; rank[s.name].total += s.price; });
  const ranking = Object.values(rank).sort((a, b) => b.qty - a.qty).slice(0, 6);
  const maxRank = Math.max(1, ...ranking.map(r => r.qty));
  const voided = evSales.filter(s => s.voided).slice(-15).reverse();

  const exportCSV = () => {
    const rows = [["Punto de venta", "Producto", "Precio", "Unidades", "Total"]];
    byPunto.forEach(b => { b.punto.products.forEach(p => { const q = b.perProduct[p.id] || 0; rows.push([b.punto.name, p.name, p.price.toFixed(2), q, (q * p.price).toFixed(2)]); }); rows.push([b.punto.name, "— SUBTOTAL —", "", b.count, b.revenue.toFixed(2)]); rows.push([b.punto.name, "Anulaciones", "", b.voids, ""]); rows.push([]); });
    rows.push(["TOTAL EVENTO", "", "", grandCount, grandRevenue.toFixed(2)]);
    if (ev.advanced) {
      const efe = round2(evSales.filter(s => !s.voided && s.pago === "efectivo").reduce((t, s) => t + s.price, 0));
      const tar = round2(evSales.filter(s => !s.voided && s.pago === "tarjeta").reduce((t, s) => t + s.price, 0));
      rows.push([]); rows.push(["ARQUEO", "Efectivo (en caja)", "", "", efe.toFixed(2)]); rows.push(["ARQUEO", "Tarjeta", "", "", tar.toFixed(2)]);
    }
    const csv = rows.map(r => r.join(";")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${ev.name.replace(/\s+/g, "_")}_cierre.csv`; a.click(); flash("CSV exportado");
  };

  return (
    <>
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
        <h3 style={{ ...S.h3, margin: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>🔒 Informe de cierre — {ev.name} <span className="livedot" style={S.liveDot} /> <span style={{ fontSize: 11, color: "var(--green)" }}>EN VIVO</span></h3>
        <button onClick={exportCSV} style={S.btnPrimary}>⬇︎ Exportar CSV</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: 14, marginBottom: 24 }}>
        <BigStat label="Tickets · evento" value={grandCount} c="var(--accent)" />
        <BigStat label="Facturación total" value={money(grandRevenue)} c="var(--green)" />
        <BigStat label="Anulaciones" value={totalVoids} c="var(--amber)" />
        <BigStat label="Puntos de venta" value={ev.puntos.length} c="#3b82f6" />
        {ev.advanced && <BigStat label="💶 Efectivo (en caja)" value={money(round2(evSales.filter(s => !s.voided && s.pago === "efectivo").reduce((t, s) => t + s.price, 0)))} c="var(--green)" />}
        {ev.advanced && <BigStat label="💳 Tarjeta" value={money(round2(evSales.filter(s => !s.voided && s.pago === "tarjeta").reduce((t, s) => t + s.price, 0)))} c="#4d8dff" />}
      </div>

      {/* ===== Copias de seguridad ===== */}
      {(() => {
        const mins = lastBackup ? Math.round((Date.now() - new Date(lastBackup).getTime()) / 60000) : null;
        const fresh = mins != null && mins <= 35;
        const pend = db.pendingCount();
        return (
          <div style={{ ...S.panel, marginBottom: 20, border: `1px solid ${fresh ? "var(--line)" : "var(--amber)"}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800 }}>☁️ Copias de seguridad</div>
                <div style={{ fontSize: 13, color: fresh ? "var(--green)" : "var(--amber)", fontWeight: 700, marginTop: 2 }}>
                  {lastBackup ? `Última copia en la nube: ${new Date(lastBackup).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} (hace ${mins} min)` : "Aún no hay copia en la nube desde este equipo"}
                </div>
                <div style={{ fontSize: 12, color: pend ? "var(--amber)" : "var(--muted)", marginTop: 2 }}>{pend ? `⚠️ ${pend} operaciones solo en este equipo (sin subir)` : "Todo lo de este equipo está en la nube"} · automáticas cada 30 min</div>
              </div>
              <button onClick={onBackup} style={{ ...S.btnPrimary, width: "auto", padding: "0 16px", minHeight: 42 }}>Hacer copia ahora</button>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <button onClick={() => { const v = !showBackups; setShowBackups(v); if (v) loadBk(); }} style={{ ...S.btnGhost, flex: "1 1 160px" }}>{showBackups ? "Ocultar historial" : "🕒 Ver historial de copias"}</button>
              <button onClick={downloadEmergency} style={{ ...S.btnGhost, flex: "1 1 160px" }}>💾 Descargar copia de emergencia</button>
              <button onClick={() => fileRef.current && fileRef.current.click()} style={{ ...S.btnGhost, flex: "1 1 160px" }}>📂 Importar copia</button>
              <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={e => { const f = e.target.files && e.target.files[0]; if (f) importEmergency(f); e.target.value = ""; }} />
            </div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>¿El equipo va a apagarse sin internet? Descarga la copia de emergencia a un USB e impórtala en el otro ordenador. Nunca se duplica ninguna venta.</div>

            {showBackups && (
              <div style={{ marginTop: 12, maxHeight: 320, overflow: "auto" }}>
                {backups === null ? <div style={{ color: "var(--muted)", fontSize: 13 }}>Cargando…</div>
                  : backups.length === 0 ? <div style={{ color: "var(--muted)", fontSize: 13 }}>Sin copias todavía.</div>
                  : backups.map(b => (
                    <div key={b.id} style={{ padding: "9px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                        <b>{new Date(b.tomado_en).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</b>
                        <span style={{ color: "var(--muted)" }}>{b.dispositivo}</span>
                      </div>
                      <div style={{ color: "var(--muted)", marginTop: 2 }}>
                        {b.datos?.total ? `${b.datos.total.tickets} tickets · ${money(b.datos.total.facturacion)}` : ""}
                        {b.datos?.total && (b.datos.total.efectivo || b.datos.total.tarjeta) ? ` · 💶 ${money(b.datos.total.efectivo)} · 💳 ${money(b.datos.total.tarjeta)}` : ""}
                      </div>
                      {Array.isArray(b.datos?.puntos) && <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>{b.datos.puntos.map(p => `${p.nombre}: ${money(p.facturacion)}`).join(" · ")}</div>}
                    </div>
                  ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Multi-dispositivo: consolidado en vivo */}
      <div style={{ ...S.panel, marginBottom: 16 }}>
        <div style={{ fontWeight: 800, marginBottom: 12 }}>Consolidado en vivo (todos los puntos)</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 10 }}>
          {byPunto.map(b => (
            <div key={b.punto.id} style={{ background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 12, padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>📍 {b.punto.name}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "var(--green)", marginTop: 4 }}>{money(b.revenue)}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{b.count} tickets · {b.voids} anul.</div>
              {ev.advanced && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>💰 Fondo: <b style={{ color: b.punto.fondo != null ? "var(--green)" : "var(--amber)" }}>{b.punto.fondo != null ? money(b.punto.fondo) : "sin declarar"}</b>{b.punto.fondo != null && db.pendingFondo(b.punto.id) != null && <span style={{ color: "var(--amber)" }}> · ⏳ subiendo…</span>}</div>}
              {(role === "admin" || role === "supervisor") && <button onClick={() => {
                if (!ev.advanced) { onCierreZ(b.punto); return; }
                const abiertas = evSales.filter(s => s.puntoId === b.punto.id && !s.voided && !s.closureId);
                const efe = round2(abiertas.filter(s => s.pago === "efectivo").reduce((t, s) => t + s.price, 0));
                const fondo = round2(b.punto.fondo || 0);
                setCountZ({ punto: b.punto, fondo, efectivo: efe, esperado: round2(fondo + efe), valor: "" });
              }} style={{ ...S.smallBtn, marginTop: 8, width: "100%", color: "var(--accent)", borderColor: "var(--accent)" }}>Cierre Z 🧾</button>}
            </div>
          ))}
        </div>
      </div>

      {/* curva por hora + ranking */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px,1fr))", gap: 16, marginBottom: 16 }}>
        <div style={S.panel}>
          <div style={{ fontWeight: 800, marginBottom: 12 }}>Actividad por hora</div>
          {hourKeys.length === 0 ? <div style={{ color: "var(--muted)", fontSize: 13 }}>Sin datos.</div> : (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 130 }}>
              {hourKeys.map(h => <div key={h} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}><div style={{ width: "100%", height: `${(hours[h] / maxHour) * 100}%`, background: "var(--accent)", borderRadius: "4px 4px 0 0", minHeight: 3 }} /><span style={{ fontSize: 10, color: "var(--muted)" }}>{h}h</span></div>)}
            </div>
          )}
        </div>
        <div style={S.panel}>
          <div style={{ fontWeight: 800, marginBottom: 12 }}>Productos más vendidos</div>
          {ranking.map((r, i) => (
            <div key={r.name} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}><span>{i + 1}. {r.name}</span><span style={{ color: "var(--muted)" }}>{r.qty} · {money(r.total)}</span></div>
              <div style={{ height: 8, background: "var(--line)", borderRadius: 6, overflow: "hidden" }}><div style={{ height: "100%", width: `${(r.qty / maxRank) * 100}%`, background: "var(--green)", borderRadius: 6 }} /></div>
            </div>
          ))}
        </div>
      </div>

      {/* desglose por punto */}
      {byPunto.map(b => {
        const max = Math.max(1, ...b.punto.products.map(p => b.perProduct[p.id] || 0));
        return (
          <div key={b.punto.id} style={{ ...S.panel, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14, borderBottom: "1px solid var(--line)", paddingBottom: 10 }}><div style={{ fontWeight: 800, fontSize: 16 }}>📍 {b.punto.name}</div><div style={{ fontSize: 13, color: "var(--muted)" }}><b style={{ color: "var(--text)" }}>{b.count}</b> tickets · <b style={{ color: "var(--green)" }}>{money(b.revenue)}</b></div></div>
            {b.punto.products.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>Sin productos.</div>}
            {b.punto.products.map(p => { const q = b.perProduct[p.id] || 0; return (
              <div key={p.id} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 5 }}><span>{p.emoji} {p.name}</span><span style={{ color: "var(--muted)" }}><b style={{ color: "var(--text)" }}>{q}</b> uds · {money(q * p.price)}</span></div>
                <div style={{ height: 9, background: "var(--line)", borderRadius: 6, overflow: "hidden" }}><div style={{ height: "100%", width: `${(q / max) * 100}%`, background: p.color, borderRadius: 6, transition: "width .5s" }} /></div>
              </div>); })}
          </div>
        );
      })}

      {/* registro de anulaciones */}
      <div style={S.panel}>
        <div style={{ fontWeight: 800, marginBottom: 12 }}>Registro de anulaciones ({totalVoids})</div>
        {voided.length === 0 ? <div style={{ color: "var(--muted)", fontSize: 13 }}>Sin anulaciones.</div> : voided.map(s => (
          <div key={s.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "7px 0", borderBottom: "1px solid var(--line)" }}>
            <span>Nº {String(s.num).padStart(4, "0")} · {s.name}</span>
            <span style={{ color: "var(--muted)" }}>{s.voidBy || "—"} · {s.voidTs ? new Date(s.voidTs).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : ""} · {money(s.price)}</span>
          </div>
        ))}
      </div>

      {/* anular un ticket concreto */}
      <div style={{ ...S.panel, marginTop: 16 }}>
        <div style={{ fontWeight: 800, marginBottom: 12 }}>Anular un ticket concreto</div>
        <div style={{ maxHeight: 240, overflow: "auto" }}>
          {evSales.filter(s => !s.voided).slice(-25).reverse().map(s => (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, padding: "7px 0", borderBottom: "1px solid var(--line)" }}>
              <span>Nº {String(s.num).padStart(4, "0")} · {s.name} · {money(s.price)}</span>
              {confirmVoid === s.id ? (
                <span style={{ display: "flex", gap: 6 }}><button onClick={() => { onVoid(s); setConfirmVoid(null); flash("Ticket anulado", "warn"); }} style={{ ...S.smallBtn, color: "var(--red)", borderColor: "var(--red)" }}>✓ Sí</button><button onClick={() => setConfirmVoid(null)} style={S.smallBtn}>✗</button></span>
              ) : <button onClick={() => setConfirmVoid(s.id)} style={S.smallBtn}>Anular</button>}
            </div>
          ))}
        </div>
      </div>
    </div>

    {countZ && (() => {
      const contado = parseFloat(countZ.valor || "0") || 0;
      const dif = round2(contado - countZ.esperado);
      const has = countZ.valor !== "";
      return (
        <div style={S.overlay} onClick={() => setCountZ(null)}>
          <div style={{ ...S.payCard, maxWidth: 420, alignSelf: "center" }} onClick={e => e.stopPropagation()}>
            <div style={{ textAlign: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 34 }}>🧾</div>
              <div style={{ fontWeight: 900, fontSize: 19 }}>Cierre Z · {countZ.punto.name}</div>
              <div style={{ color: "var(--muted)", fontSize: 13 }}>Cuenta el dinero del cajón</div>
            </div>
            <div style={{ background: "var(--surface2)", borderRadius: 14, padding: 14, marginBottom: 12, fontSize: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--muted)" }}>Fondo inicial</span><b>{money(countZ.fondo)}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}><span style={{ color: "var(--muted)" }}>+ Ventas en efectivo</span><b>{money(countZ.efectivo)}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line)", fontSize: 16 }}><span>Debe haber</span><b style={{ color: "var(--green)" }}>{money(countZ.esperado)}</b></div>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>¿Cuánto has contado? (puedes dejarlo vacío)</div>
            <input autoFocus type="number" inputMode="decimal" value={countZ.valor} onChange={e => setCountZ({ ...countZ, valor: e.target.value })} style={{ ...S.input, fontSize: 24, fontWeight: 900, textAlign: "center", padding: "14px" }} placeholder="0.00" />
            {has && (
              <div style={{ textAlign: "center", marginTop: 12, padding: 12, borderRadius: 12, background: dif === 0 ? "rgba(34,211,166,.12)" : "rgba(255,180,0,.12)", border: `2px solid ${dif === 0 ? "var(--green)" : dif > 0 ? "var(--amber)" : "var(--red)"}` }}>
                <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: 1 }}>{dif === 0 ? "Cuadra" : dif > 0 ? "Sobra" : "Falta"}</div>
                <div style={{ fontSize: 30, fontWeight: 900, color: dif === 0 ? "var(--green)" : dif > 0 ? "var(--amber)" : "var(--red)" }}>{dif === 0 ? "✓ " + money(0) : money(Math.abs(dif))}</div>
              </div>
            )}
            <button onClick={() => { onCierreZ(countZ.punto, has ? round2(contado) : null); setCountZ(null); }} style={{ ...S.btnPrimary, width: "100%", marginTop: 14, padding: "16px", fontSize: 16 }}>Cerrar turno e imprimir Z</button>
            <button onClick={() => setCountZ(null)} style={{ ...S.btnGhost, width: "100%", marginTop: 8, padding: "13px" }}>Cancelar</button>
          </div>
        </div>
      );
    })()}
    </>
  );
}

function BigStat({ label, value, c }) {
  return <div style={{ ...S.panel, padding: 18 }}><div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div><div style={{ fontSize: 26, fontWeight: 800, color: c, marginTop: 4 }}>{value}</div></div>;
}


/* ---------------------- PIN modal ---------------------- */
function PinModal({ correct, onOk, onClose, label }) {
  const isMobile = useIsMobile();
  const [pin, setPin] = useState(""); const [err, setErr] = useState(false);
  const press = (d) => { const np = (pin + d).slice(0, 6); setPin(np); setErr(false); if (np === correct) setTimeout(onOk, 150); };
  useEffect(() => { if (pin.length === correct.length && pin !== correct) { setErr(true); setTimeout(() => setPin(""), 400); } }, [pin, correct]);
  return (
    <div style={isMobile ? S.sheetWrap : S.overlay} onClick={onClose}>
      <div className={isMobile ? "sheet-anim" : ""} style={isMobile ? { ...S.sheet, animation: err ? "shake .3s" : undefined } : { ...S.pinCard, animation: err ? "shake .3s" : "none" }} onClick={e => e.stopPropagation()}>
        {isMobile && <div style={S.grab} />}
        <div style={{ textAlign: "center", fontWeight: 800, fontSize: 18, marginBottom: 4 }}>🔒 Acceso restringido</div>
        <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>{label || "Introduce el PIN"}</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 18 }}>{Array.from({ length: Math.max(4, pin.length) }).map((_, i) => <div key={i} style={{ width: 14, height: 14, borderRadius: "50%", background: i < pin.length ? (err ? "var(--red)" : "var(--accent)") : "var(--line)" }} />)}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => <button key={n} onClick={() => press(n)} style={S.pinBtn}>{n}</button>)}
          <button onClick={() => setPin("")} style={{ ...S.pinBtn, fontSize: 14 }}>C</button>
          <button onClick={() => press(0)} style={S.pinBtn}>0</button>
          <button onClick={() => setPin(pin.slice(0, -1))} style={{ ...S.pinBtn, fontSize: 18 }}>⌫</button>
        </div>
      </div>
    </div>
  );
}

const Field = ({ label, children }) => <div style={{ marginBottom: 12, flex: 1 }}><div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 5 }}>{label}</div>{children}</div>;
const Empty = ({ msg }) => <div style={{ textAlign: "center", padding: 50, color: "var(--muted)", border: "2px dashed var(--line)", borderRadius: 16 }}>{msg}</div>;

function shade(hex, p) { const n = parseInt(hex.slice(1), 16); let r = (n >> 16) + p * 2.55, g = ((n >> 8) & 255) + p * 2.55, b = (n & 255) + p * 2.55; r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b)); return `rgb(${r | 0},${g | 0},${b | 0})`; }

/* ---------------------- styles ---------------------- */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..800&family=Roboto+Mono:wght@400;700&display=swap');
:root{--bg:#0b0c10;--surface:#14161d;--surface2:#1c1f29;--line:#2a2e3a;--text:#eceef5;--muted:#838aa0;--accent:#ff5a3c;--green:#22d3a6;--amber:#ffb400;--red:#ff4d4d;}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
html,body,#root{height:100%;margin:0;padding:0;}
body{overflow-x:hidden;overscroll-behavior-y:none;}
img,svg{max-width:100%;}
input,select,textarea{max-width:100%;}
.tile{transition:transform .08s ease, box-shadow .2s;}
.tile:not(:disabled):active{transform:scale(.95);}
.tile:not(:disabled):hover{box-shadow:0 12px 34px rgba(0,0,0,.45);}
.nav-btn:hover{background:var(--surface2);}
.menu-row:hover{background:var(--surface2);}
.menu-row:active{opacity:.75;}
.menu-group>.menu-row:last-child{border-bottom:0 !important;}
.gate-role:hover{border-color:#3a3f4d !important;}
.gate-role:active{transform:scale(.98);}
body{font-optical-sizing:auto;-webkit-font-smoothing:antialiased;}
button{font-family:Inter,-apple-system,sans-serif;cursor:pointer;}
input,select{font-family:Inter,-apple-system,sans-serif;font-size:16px;}
.scroll-x{overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;}
.scroll-x::-webkit-scrollbar{display:none;}
::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-thumb{background:var(--line);border-radius:8px}
@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes sheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
.livedot{animation:pulse 1.4s infinite}
.sheet-anim{animation:sheetUp .22s ease}
@media print{
 html,body{margin:0 !important;padding:0 !important;background:#fff !important;}
 body *{visibility:hidden !important;}
 #thermal-print-area,#thermal-print-area *{visibility:visible !important;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;color-adjust:exact !important;}
 #thermal-print-area{position:absolute !important;left:0 !important;top:0 !important;width:auto !important;margin:0 !important;}
 .ticket-page{page-break-after:always;break-after:page;}
 .ticket-page:last-child{page-break-after:auto;break-after:auto;}
}
`;
const S = {
  payWrap: { position: "fixed", inset: 0, zIndex: 80, background: "rgba(0,0,0,.72)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-end", justifyContent: "center" },
  payCard: { width: "100%", maxWidth: 460, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 22, padding: 20, paddingBottom: "calc(20px + env(safe-area-inset-bottom))", maxHeight: "92dvh", overflow: "auto", margin: "0 auto", alignSelf: "center" },
  payBtn: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, border: "none", borderRadius: 18, padding: "26px 10px", cursor: "pointer" },
  noteBtn: { background: "var(--surface2)", color: "var(--text)", border: "2px solid var(--line)", borderRadius: 12, padding: "12px 6px", fontWeight: 900, fontSize: 15 },
  padBtn: { background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 12, padding: "16px 0", fontSize: 22, fontWeight: 800 },
  side: { width: 248, flexShrink: 0, background: "var(--surface)", borderRight: "1px solid var(--line)", padding: "calc(22px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", overflowY: "auto" },
  sideLabel: { fontSize: 10.5, fontWeight: 700, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--muted)", margin: "0 0 8px 2px" },
  sideDivider: { height: 1, background: "var(--line)", margin: "4px 0 6px" },
  menuRow: { display: "flex", alignItems: "center", gap: 11, width: "100%", background: "transparent", border: "none", borderRadius: 10, padding: "8px 8px", fontWeight: 650, fontSize: 13.5 },
  menuRowBig: { padding: "11px 12px", fontSize: 15, borderRadius: 0, borderBottom: "1px solid var(--line)" },
  menuIco: { width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", flexShrink: 0 },
  menuGroup: { background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 16, overflow: "hidden" },
  onOff: { fontSize: 10, fontWeight: 800, letterSpacing: .8, color: "var(--muted)", background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 20, padding: "3px 8px" },
  onOffOn: { color: "#1a1200", background: "var(--amber)", borderColor: "var(--amber)" },
  stDot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0, display: "inline-block" },
  mEvent: { fontSize: 15.5, fontWeight: 800, letterSpacing: "-.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.2 },
  mSub: { display: "flex", alignItems: "center", gap: 5, color: "var(--accent)", fontSize: 12, fontWeight: 700, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden" },
  mSelect: { background: "var(--surface2)", fontWeight: 800, padding: "9px 12px" },
  miniLabel: { fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1.2, fontWeight: 700, marginBottom: 2 },
  topTitle: { fontFamily: "Inter,sans-serif", fontVariationSettings: "'opsz' 32", fontWeight: 800, fontSize: 21, letterSpacing: "-.03em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  topSub: { display: "flex", alignItems: "center", gap: 10, color: "var(--muted)", fontSize: 12.5, marginTop: 4, flexWrap: "wrap" },
  barTag: { display: "inline-flex", alignItems: "center", gap: 5, color: "var(--accent)", background: "rgba(255,90,60,.1)", borderRadius: 20, padding: "3px 9px 3px 7px", fontWeight: 700, fontSize: 12 },
  topBtn: { display: "inline-flex", alignItems: "center", gap: 8, background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 11, padding: "10px 16px", fontWeight: 700, fontSize: 14 },
  bTabIco: { display: "grid", placeItems: "center", width: 46, height: 28, borderRadius: 14, transition: "background .15s" },
  bTabIcoActive: { background: "rgba(255,90,60,.14)" },
  gateIco: { width: 52, height: 52, borderRadius: 16, display: "grid", placeItems: "center", background: "var(--bg)", border: "1px solid var(--line)", color: "var(--text)" },
  gateIcoMain: { background: "rgba(255,90,60,.12)", borderColor: "rgba(255,90,60,.35)", color: "var(--accent)" },
  sideMobile: { width: "100%", boxSizing: "border-box", background: "var(--surface)", borderBottom: "1px solid var(--line)", padding: 12, display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  mTop: { display: "flex", alignItems: "center", gap: 11, padding: "calc(10px + env(safe-area-inset-top)) 12px 10px 14px", borderBottom: "1px solid var(--line)", background: "rgba(20,22,29,.92)", backdropFilter: "saturate(1.4) blur(12px)", WebkitBackdropFilter: "saturate(1.4) blur(12px)", position: "sticky", top: 0, zIndex: 20 },
  mTitle: { flex: 1, minWidth: 0 },
  iconBtn: { width: 42, height: 42, flexShrink: 0, borderRadius: 12, background: "var(--surface2)", border: "1px solid var(--line)", color: "var(--text)", fontSize: 18, display: "grid", placeItems: "center", padding: 0 },
  bottomNav: { display: "flex", borderTop: "1px solid var(--line)", background: "var(--surface)", paddingBottom: "env(safe-area-inset-bottom)", flexShrink: 0 },
  bTab: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "8px 4px 8px", background: "transparent", border: "none", color: "var(--muted)", fontSize: 11, fontWeight: 700 },
  bTabActive: { color: "var(--text)" },
  sheetWrap: { position: "fixed", inset: 0, background: "rgba(0,0,0,.62)", zIndex: 60, display: "flex", alignItems: "flex-end", backdropFilter: "blur(3px)" },
  sheet: { width: "100%", background: "var(--surface)", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, paddingBottom: "calc(20px + env(safe-area-inset-bottom))", maxHeight: "86dvh", overflow: "auto", borderTop: "1px solid var(--line)" },
  grab: { width: 40, height: 4, borderRadius: 4, background: "var(--line)", margin: "0 auto 14px" },
  logo: { fontFamily: "Inter,sans-serif", fontVariationSettings: "'opsz' 32", fontWeight: 700, fontSize: 20, letterSpacing: "-.02em" },
  logoImg: { height: 26, width: "auto", display: "block" },
  display: { fontFamily: "Inter,sans-serif", fontVariationSettings: "'opsz' 32", fontWeight: 700, fontSize: 22, letterSpacing: "-.03em" },
  select: { width: "100%", background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", fontWeight: 600, outline: "none" },
  navBtn: { display: "flex", alignItems: "center", gap: 12, background: "transparent", color: "#c9cdd8", border: "none", padding: "11px 12px", borderRadius: 11, fontWeight: 650, fontSize: 14.5, textAlign: "left", width: "100%" },
  navActive: { background: "rgba(255,90,60,.1)", color: "#fff", boxShadow: "inset 3px 0 0 var(--accent)", fontWeight: 750 },
  main: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
  top: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "calc(16px + env(safe-area-inset-top)) 24px 16px", borderBottom: "1px solid var(--line)", background: "var(--surface)" },
  statBox: { background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 18px", minWidth: 130 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px,1fr))", gap: 14 },
  tile: { position: "relative", border: "none", borderRadius: 18, padding: "20px 14px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, minHeight: 148, justifyContent: "center" },
  tileBadge: { position: "absolute", top: 10, right: 10, background: "rgba(0,0,0,.45)", borderRadius: 20, padding: "3px 11px", fontWeight: 800, fontSize: 14 },
  tileQR: { position: "absolute", top: 10, left: 10, background: "rgba(0,0,0,.4)", borderRadius: 7, padding: "2px 7px", fontWeight: 800, fontSize: 11 },
  soldOut: { position: "absolute", top: "50%", left: 0, right: 0, transform: "translateY(-50%) rotate(-8deg)", textAlign: "center", fontWeight: 800, fontSize: 20, color: "var(--red)", background: "rgba(0,0,0,.35)", padding: "4px 0", letterSpacing: 2 },
  qtyChip: { background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 14px", fontWeight: 800 },
  qtyActive: { background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" },
  voidBtn: { background: "transparent", color: "var(--amber)", border: "1px solid var(--amber)", borderRadius: 12, padding: "10px 16px", fontWeight: 700 },
  groupBtn: { background: "var(--accent)", color: "#fff", border: "none", borderRadius: 12, padding: "10px 18px", fontWeight: 800 },
  cart: { width: 320, flexShrink: 0, background: "var(--surface)", border: "1px solid var(--accent)", borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 220px)", position: "sticky", top: 0 },
  cartRow: { display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line)" },
  stepBtn: { width: 30, height: 30, borderRadius: 8, background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", fontSize: 18, fontWeight: 800, lineHeight: 1 },
  consultBtn: { background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 12, padding: "12px 18px", fontWeight: 700 },
  printerStatusSm: { display: "flex", alignItems: "center", gap: 7, background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 20, padding: "8px 12px", color: "var(--text)", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" },
  roleBadge: { fontSize: 10.5, fontWeight: 800, letterSpacing: .6, textTransform: "uppercase", borderRadius: 20, padding: "4px 9px" },
  cashierTop: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "calc(14px + env(safe-area-inset-top)) 24px 14px", borderBottom: "1px solid var(--line)", background: "var(--surface)", flexWrap: "wrap", gap: 12 },
  gateWrap: { minHeight: "100%", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", padding: "calc(18px + env(safe-area-inset-top)) 18px calc(18px + env(safe-area-inset-bottom))", overflow: "auto", background: "radial-gradient(900px 480px at 50% -12%, rgba(255,90,60,.10), transparent 70%), var(--bg)" },
  gateCard: { width: 440, maxWidth: "100%", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 22, padding: 28, boxShadow: "0 30px 80px rgba(0,0,0,.55)" },
  gateRole: { display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "20px 8px 18px", background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 16, color: "var(--text)", transition: "border-color .15s, transform .08s" },
  liveDot: { width: 8, height: 8, borderRadius: "50%", background: "var(--green)", display: "inline-block" },
  h3: { fontSize: 14, textTransform: "uppercase", letterSpacing: 1, color: "var(--muted)", marginBottom: 12, fontWeight: 800 },
  panel: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 18 },
  tplCard: { textAlign: "left", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: 14, color: "var(--text)" },
  tplActive: { borderColor: "var(--accent)", boxShadow: "0 0 0 2px var(--accent) inset" },
  chip: { background: "var(--surface)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 30, padding: "10px 22px", fontWeight: 700 },
  chipActive: { background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" },
  toggleRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--line)" },
  switch: { width: 44, height: 26, borderRadius: 20, border: "none", position: "relative", padding: 0 },
  knob: { position: "absolute", top: 2, width: 22, height: 22, borderRadius: "50%", background: "#fff", transition: "transform .2s", boxShadow: "0 1px 3px rgba(0,0,0,.4)" },
  input: { width: "100%", background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "11px 13px", fontSize: 15, outline: "none" },
  btnPrimary: { background: "var(--accent)", color: "#fff", border: "none", borderRadius: 12, padding: "12px 20px", fontWeight: 800, fontSize: 15, width: "100%" },
  btnGhost: { background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 12, padding: "12px 20px", fontWeight: 700 },
  smallBtn: { background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 700 },
  paperWrap: { background: "#e9e9e9", padding: 20, borderRadius: 14, display: "flex", justifyContent: "center", boxShadow: "inset 0 0 30px rgba(0,0,0,.2)" },
  prodRow: { display: "flex", alignItems: "center", gap: 12, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 10, transition: "box-shadow .15s, border-color .15s" },
  prodRowDrag: { borderColor: "var(--accent)", boxShadow: "0 12px 30px rgba(0,0,0,.45), 0 0 0 1px var(--accent)", background: "var(--surface2)" },
  grip: { display: "grid", placeItems: "center", width: 30, height: 40, margin: "-4px -4px -4px -2px", borderRadius: 8, touchAction: "none", userSelect: "none", WebkitUserSelect: "none", flexShrink: 0 },
  arrowBtn: { width: 28, height: 20, borderRadius: 6, background: "var(--surface2)", border: "1px solid var(--line)", color: "var(--text)", display: "grid", placeItems: "center", padding: 0 },
  segWrap: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 12, padding: 4 },
  seg: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, background: "transparent", color: "var(--muted)", border: "none", borderRadius: 9, padding: "10px 8px", fontWeight: 700, fontSize: 13 },
  segOn: { background: "var(--surface2)", color: "var(--text)", boxShadow: "inset 0 0 0 1px var(--line), 0 0 0 0 transparent", },
  del: { background: "transparent", color: "var(--red)", border: "1px solid var(--line)", borderRadius: 8, width: 32, height: 32, fontWeight: 800 },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "grid", placeItems: "center", zIndex: 50, backdropFilter: "blur(4px)" },
  pinCard: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 20, padding: 26, width: 300 },
  pinBtn: { background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 14, padding: "18px 0", fontSize: 22, fontWeight: 700 },
  toast: { position: "fixed", bottom: "calc(24px + env(safe-area-inset-bottom))", left: "50%", transform: "translateX(-50%)", color: "#0b0c10", padding: "11px 20px", borderRadius: 14, fontWeight: 800, fontSize: 14, zIndex: 60, boxShadow: "0 14px 34px rgba(0,0,0,.45)", width: "max-content", maxWidth: "calc(100vw - 32px)", textAlign: "center", lineHeight: 1.35 },
};

import React, { useReducer, useState, useMemo, useEffect, useRef } from "react";
import { uid } from "./supabase";
import { logout } from "./auth";
import * as db from "./db";
import { nextFolios, prefijoDePunto } from "./folio";

/* ============================================================================
   TICKETERA — TPV de tickets para eventos (prototipo funcional)
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

// Detecta pantalla pequeña (móvil) para adaptar el layout
function useIsMobile(bp = 720) {
  const [m, setM] = useState(typeof window !== "undefined" ? window.innerWidth <= bp : false);
  useEffect(() => { const f = () => setM(window.innerWidth <= bp); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, [bp]);
  return m;
}

/* ---------------------- Estado inicial (se hidrata desde Supabase) ---------------------- */
const emptyState = () => ({ events: [], currentEventId: null, currentPuntoId: null, sales: [], closures: [], adminPin: "1234", supervisorPin: "0000", online: typeof navigator !== "undefined" ? navigator.onLine : true });
const EMPTY_EV = { id: null, name: "", date: "", venue: "", template: "festival", paper: 80, footer: "", logo: "", showEventName: true, showDate: true, showTime: true, showPrice: true, anularPin: false, pin_admin: "1234", pin_supervisor: "0000", puntos: [{ id: null, name: "", archivado: false, products: [] }] };

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
  const big = ev.paper === 58 ? 22 : 30;         // tamaño del nombre del producto
  const ref = folio ? "Folio " + folio : (num != null ? "Nº " + String(num).padStart(4, "0") : "");
  const base = { fontFamily: "'Roboto Mono', ui-monospace, monospace", color: "#000", background: "#fff", width: mm + "mm", padding: "1.5mm 2mm 2.5mm", boxSizing: "border-box", lineHeight: 1.25, fontWeight: 700 };
  const dashed = <div style={{ borderTop: "2px dashed #000", margin: "2mm 0" }} />;
  const Name = ({ size }) => <div style={{ fontWeight: 900, fontSize: size, letterSpacing: -0.3, textAlign: "center", lineHeight: 1.04, color: "#000", wordBreak: "break-word" }}>{product?.name || "NOMBRE TICKET"}</div>;
  const Logo = () => {
    if (!ev.logo) return null;
    const isImg = typeof ev.logo === "string" && /^(data:|https?:)/.test(ev.logo);
    return isImg
      ? <div style={{ textAlign: "center", marginBottom: "1mm" }}><img src={ev.logo} alt="" style={{ maxHeight: 42, maxWidth: "65%", filter: "grayscale(1) contrast(3) brightness(.9)" }} /></div>
      : <div style={{ textAlign: "center", fontWeight: 900, fontSize: 24, letterSpacing: 1, marginBottom: "1mm", color: "#000" }}>{ev.logo}</div>;
  };
  const priceLine = ev.showPrice && !(qty > 1) && <div style={{ textAlign: "center", fontWeight: 900, fontSize: big - 4, marginTop: "1.5mm", color: "#000" }}>{money(product?.price)}</div>;
  const qtyLine = qty > 1 && <div style={{ textAlign: "center", fontWeight: 900, fontSize: 16, marginTop: "1.5mm", color: "#000" }}>{qty} × {money(product?.price)} = {money(product?.price * qty)}</div>;
  const metaStyle = { fontSize: 12, color: "#000", fontWeight: 700 };

  let inner;
  if (ev.template === "festival") {
    inner = (<>
      <Logo />
      {ev.showEventName && <div style={{ textAlign: "center", fontWeight: 800, fontSize: 13, textTransform: "uppercase", color: "#000" }}>{ev.name}</div>}
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
      <div style={{ textAlign: "center", ...metaStyle, marginTop: "1mm" }}>{ev.showDate && dateFmt(ev.date)}{ev.showTime && ` · ${time}`}</div>
      {ref && <div style={{ textAlign: "center", ...metaStyle }}>{ref}</div>}
      {ev.footer && <div style={{ textAlign: "center", fontSize: 11, color: "#000", marginTop: "2mm", borderTop: "2px solid #000", paddingTop: "1.5mm", fontWeight: 600 }}>{ev.footer}</div>}
    </>);
  } else if (ev.template === "minimal") {
    inner = (<>
      <Logo />
      {ev.showEventName && <div style={{ fontSize: 12, color: "#000", letterSpacing: 1, textTransform: "uppercase", fontWeight: 700 }}>{ev.name}</div>}
      <div style={{ height: "2mm" }} />
      <Name size={big - 2} />
      {priceLine}{qtyLine}
      <div style={{ ...metaStyle, marginTop: "2mm" }}>{ev.showDate && dateFmt(ev.date)}{ev.showTime && ` — ${time}`}{ref && ` · ${ref}`}</div>
      {ev.footer && <div style={{ fontSize: 11, color: "#000", marginTop: "2mm", fontWeight: 600 }}>{ev.footer}</div>}
    </>);
  } else {
    inner = (<>
      <Logo />
      {ev.showEventName && <div style={{ textAlign: "center", fontWeight: 800, fontSize: 13, color: "#000" }}>{ev.name}</div>}
      {dashed}
      <Name size={big - 2} />
      {priceLine}{qtyLine}
      <div style={{ border: "2px solid #000", borderRadius: 3, textAlign: "center", fontSize: 16, letterSpacing: 2, fontWeight: 900, marginTop: "2mm", padding: "1.5mm 0" }}>{folio || shortCode(code || product?.id)}</div>
      <div style={{ textAlign: "center", ...metaStyle, marginTop: "1.5mm" }}>{ev.showDate && dateFmt(ev.date)} {ev.showTime && time}</div>
    </>);
  }
  return <div style={base}>{inner}</div>;
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

  const ev = state.events.find(e => e.id === state.currentEventId) || state.events[0] || EMPTY_EV;
  const activePuntos = ev.puntos.filter(p => !p.archivado);
  const punto = ev.puntos.find(p => p.id === state.currentPuntoId && !p.archivado) || activePuntos[0] || ev.puntos[0];
  const evSales = useMemo(() => state.sales.filter(s => s.eventId === ev.id), [state.sales, ev.id]);
  const livePuntoSales = useMemo(() => evSales.filter(s => s.puntoId === punto.id && !s.voided && !s.closureId), [evSales, punto.id]);
  const totals = useMemo(() => {
    const perProduct = {}; let revenue = 0;
    livePuntoSales.forEach(s => { perProduct[s.productId] = (perProduct[s.productId] || 0) + 1; revenue += s.price; });
    return { perProduct, revenue, count: livePuntoSales.length };
  }, [livePuntoSales]);
  const eventRevenue = useMemo(() => evSales.filter(s => !s.voided).reduce((t, s) => t + s.price, 0), [evSales]);

  const flash = (msg, kind = "ok") => { setToast({ msg, kind }); setTimeout(() => setToast(null), 1700); };

  const hydrate = async () => {
    let data = await db.loadAll();
    if (!data.events.length) { await db.ensureDefaultEvent(); data = await db.loadAll(); }
    const first = data.events.find(e => e.id === stateRef.current.currentEventId) || data.events[0];
    baseDispatch({ type: "HYDRATE", payload: {
      events: data.events, sales: data.sales, closures: data.closures,
      currentEventId: stateRef.current.currentEventId || first.id,
      currentPuntoId: stateRef.current.currentPuntoId || (first.puntos.find(p => !p.archivado) || first.puntos[0])?.id,
    } });
  };
  useEffect(() => { (async () => { try { await hydrate(); } catch (e) { console.error(e); flash("Error cargando datos", "warn"); } setLoading(false); })(); }, []);

  // Realtime: refresca las ventas del evento cuando cualquier barra vende o cierra
  useEffect(() => {
    if (!ev.id) return;
    const unsub = db.subscribeEvento(ev.id, async () => {
      try { const sales = await db.loadSales(ev.id); baseDispatch({ type: "HYDRATE_SALES", sales: stateRef.current.sales.filter(s => s.eventId !== ev.id).concat(sales) }); } catch {}
    });
    return unsub;
  }, [ev.id]);

  // Conexión + cola offline (automático)
  useEffect(() => {
    const on = async () => { setOnline(true); const r = await db.syncPending(); setPending(db.pendingCount()); if (r.synced) { flash(`✅ ${r.synced} ventas sincronizadas`); await hydrate().catch(() => {}); } };
    const off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // Venta = optimista (folio inmediato) + impresión + persistencia
  const sell = (product, qty = 1) => {
    if (product.soldOut) { flash("Producto agotado", "warn"); return; }
    const time = timeNow();
    const folios = nextFolios(ev.id, punto.id, prefijoDePunto(punto), qty);
    const clientUuids = folios.map(() => uid());
    const baseNum = evSales.length;
    const rows = folios.map((f, i) => ({ id: clientUuids[i], code: f, num: baseNum + i + 1, eventId: ev.id, puntoId: punto.id, productId: product.id, name: product.name, price: product.price, ts: Date.now() + i, synced: online, voided: false, closureId: null }));
    baseDispatch({ type: "SELL", rows });
    setPrintJob({ kind: "ticket", product, time, num: rows[0].num, folio: rows[0].code, qty, n: Date.now() });
    if (navigator.vibrate) navigator.vibrate(25);
    flash(`🖨️ ${qty > 1 ? qty + "× " : ""}${product.name}`);
    db.vender({ eventoId: ev.id, puntoId: punto.id, producto: product, qty, operario: punto.name, folios, clientUuids }).then(r => { if (r.offline) setPending(db.pendingCount()); });
  };

  const reprint = () => { if (!printJob) { flash("Nada que reimprimir", "warn"); return; } setPrintJob({ ...printJob, n: Date.now() }); flash("🖨️ Reimprimiendo último ticket"); };

  const sellMany = (items) => {
    const time = timeNow();
    let n = evSales.length;
    const rows = []; const tickets = [];
    items.forEach(({ product, qty }) => {
      const folios = nextFolios(ev.id, punto.id, prefijoDePunto(punto), qty);
      const clientUuids = folios.map(() => uid());
      folios.forEach((f, i) => { n++; rows.push({ id: clientUuids[i], code: f, num: n, eventId: ev.id, puntoId: punto.id, productId: product.id, name: product.name, price: product.price, ts: Date.now() + rows.length, synced: online, voided: false, closureId: null }); tickets.push({ product, num: n, folio: f }); });
      db.vender({ eventoId: ev.id, puntoId: punto.id, producto: product, qty, operario: punto.name, folios, clientUuids }).then(r => { if (r.offline) setPending(db.pendingCount()); });
    });
    if (!rows.length) return;
    baseDispatch({ type: "SELL", rows });
    setPrintJob({ kind: "multi", tickets, time, n: Date.now() });
    if (navigator.vibrate) navigator.vibrate(40);
    flash(`🖨️ ${tickets.length} tickets · Cobra ${money(rows.reduce((t, r) => t + r.price, 0))}`);
  };

  const voidLast = async (by) => { baseDispatch({ type: "VOID_LAST", eventId: ev.id, puntoId: punto.id, by }); flash("Último ticket anulado", "warn"); try { await db.anularUltima(ev.id, punto.id, by); } catch {} };
  const requestVoidCajero = () => { if (ev.anularPin) setAskVoidPin(true); else voidLast(punto.name); };
  const voidOne = async (saleId, by) => { baseDispatch({ type: "VOID_ONE", saleId, by }); try { await db.anularVenta(saleId, by); } catch {} };

  const cierreZ = async (puntoObj) => {
    const sales = evSales.filter(s => s.puntoId === puntoObj.id && !s.voided && !s.closureId);
    const voids = evSales.filter(s => s.puntoId === puntoObj.id && s.voided && !s.closureId).length;
    if (sales.length === 0 && voids === 0) { flash("Sin ventas en el turno actual", "warn"); return; }
    const map = {};
    sales.forEach(s => { map[s.productId] = map[s.productId] || { name: s.name, qty: 0, total: 0 }; map[s.productId].qty++; map[s.productId].total += s.price; });
    const z = { puntoName: puntoObj.name, lines: Object.values(map), revenue: sales.reduce((t, s) => t + s.price, 0), count: sales.length, voids, ts: Date.now() };
    setPrintJob({ kind: "z", z, n: Date.now() });
    flash(`Cierre Z de ${puntoObj.name} · turno cerrado`);
    try { await db.cerrarZ(ev.id, puntoObj.id, puntoObj.name); await hydrate(); } catch (e) { flash("Error en el cierre", "warn"); }
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

  const exitToLogin = () => { setRole(null); setView("pos"); };
  const isPriv = role === "admin" || role === "supervisor";
  const allNav = [
    { id: "pos", label: "TPV", icon: "🟢", roles: ["admin", "supervisor"] },
    { id: "template", label: "Plantilla", icon: "🎨", roles: ["admin"] },
    { id: "config", label: "Evento", icon: "⚙️", roles: ["admin"] },
    { id: "reports", label: "Informes", icon: "🔒", roles: ["admin", "supervisor"] },
  ];
  const navItems = allNav.filter(n => n.roles.includes(role));
  const safeView = navItems.find(n => n.id === view) ? view : "pos";

  const syncNow = async () => { const r = await db.syncPending(); setPending(db.pendingCount()); if (r.synced) { flash(`✅ ${r.synced} ventas sincronizadas`); await hydrate().catch(() => {}); } else flash(pending ? "Aún sin conexión" : "Todo sincronizado"); };
  const OnlinePill = ({ small }) => (
    <button onClick={syncNow} style={{ ...S.printerStatusSm, borderColor: online ? "var(--line)" : "var(--red)" }} title="Conexión (offline-first) · toca para sincronizar">
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: online ? "var(--green)" : "var(--red)" }} />
      {online ? (pending ? `En línea · ${pending} pend.` : "En línea") : `Sin conexión · ${pending}`}
    </button>
  );
  const PrinterPill = () => (
    <button onClick={() => setPrinter(printer === "live" ? "sim" : "live")} style={S.printerStatusSm} title="Estado impresora">
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: printer === "live" ? "var(--green)" : "var(--muted)" }} />
      {printer === "live" ? "Impresora OK" : "Simulación"}
    </button>
  );

  if (loading) return (
    <div style={{ height: "100vh", display: "grid", placeItems: "center", background: "#0b0c10", color: "#838aa0", fontFamily: "'Manrope',sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 22, color: "#eceef5", marginBottom: 8 }}><span style={{ color: "#ff5a3c" }}>●</span> TICKETERA</div>
        Cargando…
      </div>
    </div>
  );

  return (
    <div style={{ position: "relative", height: "100dvh", maxWidth: "100vw", overflow: "hidden", background: "var(--bg)", color: "var(--text)", fontFamily: "'Manrope',sans-serif", fontSize: 15 }}>
      <style>{CSS}</style>

      {/* ===== LOGIN ===== */}
      {role === null && (
        <RoleGate ev={ev} events={state.events} adminPin={ev.pin_admin} supervisorPin={ev.pin_supervisor}
          onSelectEvent={id => dispatch({ type: "SELECT_EVENT", id })}
          onRole={(r, puntoId) => { if (puntoId) dispatch({ type: "SET_PUNTO", id: puntoId }); setRole(r); setView("pos"); }} />
      )}

      {/* ===== CAJERO ===== */}
      {role === "cajero" && (isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <header style={S.mTop}>
            <div style={S.mTitle}>
              <div style={{ fontSize: 16, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ev.name}</div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>Barra: <b style={{ color: "var(--accent)" }}>{punto.name}</b></div>
            </div>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: online ? "var(--green)" : "var(--red)", flexShrink: 0 }} />
            <button onClick={() => setMenuOpen(true)} style={S.iconBtn}>☰</button>
          </header>
          <div style={{ padding: 12, flex: 1, overflow: "auto", WebkitOverflowScrolling: "touch" }}>
            <POS punto={punto} totals={totals} onSell={sell} onSellMany={sellMany} onVoid={() => requestVoidCajero()} onReprint={reprint} canReprint={!!printJob} />
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <header style={S.cashierTop}>
            <div><div style={{ fontSize: 20, fontWeight: 800 }}>{ev.name}</div><div style={{ color: "var(--muted)", fontSize: 12 }}><b style={{ color: "var(--text)" }}>{punto.name}</b> · {dateFmt(ev.date)}</div></div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}><OnlinePill /><PrinterPill /><button onClick={exitToLogin} style={S.btnGhost}>🔒 Salir</button></div>
          </header>
          <div style={{ padding: 22, flex: 1, overflow: "auto" }}>
            <POS punto={punto} totals={totals} onSell={sell} onSellMany={sellMany} onVoid={() => requestVoidCajero()} onReprint={reprint} canReprint={!!printJob} />
          </div>
        </div>
      ))}

      {/* ===== ADMIN / SUPERVISOR ===== */}
      {isPriv && (isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <header style={S.mTop}>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 16, flexShrink: 0 }}><span style={{ color: "var(--accent)" }}>●</span></div>
            <select value={ev.id} onChange={e => dispatch({ type: "SELECT_EVENT", id: e.target.value })} style={{ ...S.select, flex: 1, minWidth: 0 }}>{state.events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
            <button onClick={() => setMenuOpen(true)} style={S.iconBtn}>☰</button>
          </header>
          <div style={{ padding: 12, flex: 1, overflow: "auto", WebkitOverflowScrolling: "touch" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: "10px 14px" }}>
              <div style={{ minWidth: 0 }}><div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>Barra activa</div><div style={{ fontWeight: 800, color: "var(--accent)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{punto.name}</div></div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                <div style={{ textAlign: "right" }}><div style={{ fontSize: 11, color: "var(--muted)" }}>Tickets</div><div style={{ fontWeight: 800, fontSize: 18 }}>{totals.count}</div></div>
                <button onClick={() => setAskRevenue(true)} style={{ ...S.consultBtn, padding: "10px 12px" }}>💶</button>
              </div>
            </div>
            {safeView === "pos" && <POS punto={punto} totals={totals} onSell={sell} onSellMany={sellMany} onVoid={() => voidLast(role)} onReprint={reprint} canReprint={!!printJob} />}
            {safeView === "template" && <TemplateDesigner ev={ev} dispatch={dispatch} flash={flash} />}
            {safeView === "config" && <EventConfig state={state} ev={ev} punto={punto} evSales={evSales} dispatch={dispatch} flash={flash} />}
            {safeView === "reports" && <Reports ev={ev} evSales={evSales} role={role} onVoid={(id) => voidOne(id, role)} onCierreZ={cierreZ} flash={flash} />}
          </div>
          <nav style={S.bottomNav}>
            {navItems.map(n => <button key={n.id} onClick={() => setView(n.id)} style={{ ...S.bTab, ...(safeView === n.id ? S.bTabActive : {}) }}><span style={{ fontSize: 21 }}>{n.icon}</span>{n.label}</button>)}
          </nav>
        </div>
      ) : (
        <div style={{ display: "flex", height: "100%" }}>
          <aside style={S.side}>
            <div style={S.logo}><span style={{ color: "var(--accent)" }}>●</span> TICKETERA</div>
            <div style={{ ...S.roleBadge, color: role === "admin" ? "var(--accent)" : "#3b82f6", borderColor: role === "admin" ? "var(--accent)" : "#3b82f6" }}>{role === "admin" ? "ADMIN" : "SUPERVISOR"}</div>
            <div style={{ marginTop: 12 }}>
              <select value={ev.id} onChange={e => dispatch({ type: "SELECT_EVENT", id: e.target.value })} style={S.select}>{state.events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
            </div>
            <nav style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 14 }}>
              {navItems.map(n => <button key={n.id} onClick={() => setView(n.id)} className="nav-btn" style={{ ...S.navBtn, ...(safeView === n.id ? S.navActive : {}) }}><span style={{ fontSize: 18 }}>{n.icon}</span>{n.label}</button>)}
            </nav>
            <div style={{ marginTop: "auto", fontSize: 11, color: "var(--muted)" }}>
              <div style={{ marginBottom: 8 }}>Punto de venta activo</div>
              <select value={punto.id} onChange={e => dispatch({ type: "SET_PUNTO", id: e.target.value })} style={{ ...S.select, fontSize: 13 }}>{activePuntos.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}><OnlinePill /><PrinterPill /></div>
            <button onClick={exitToLogin} style={{ ...S.btnGhost, marginTop: 8, width: "100%" }}>Cambiar de rol</button>
            <button onClick={() => logout()} style={{ ...S.btnGhost, marginTop: 6, width: "100%", color: "var(--red)", borderColor: "var(--red)" }}>Cerrar sesión</button>
          </aside>
          <main style={S.main}>
            <header style={S.top}>
              <div><div style={{ fontSize: 22, fontWeight: 800 }}>{ev.name}</div><div style={{ color: "var(--muted)", fontSize: 13 }}>{dateFmt(ev.date)} · {ev.venue} · <b style={{ color: "var(--accent)" }}>{punto.name}</b></div></div>
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <Stat label={`Tickets · ${punto.name}`} value={totals.count} accent="var(--accent)" />
                <button onClick={() => setAskRevenue(true)} style={S.consultBtn}>💶 Consultar facturación</button>
              </div>
            </header>
            <div style={{ padding: 22, flex: 1, overflow: "auto" }}>
              {safeView === "pos" && <POS punto={punto} totals={totals} onSell={sell} onSellMany={sellMany} onVoid={() => voidLast(role)} onReprint={reprint} canReprint={!!printJob} />}
              {safeView === "template" && <TemplateDesigner ev={ev} dispatch={dispatch} flash={flash} />}
              {safeView === "config" && <EventConfig state={state} ev={ev} punto={punto} evSales={evSales} dispatch={dispatch} flash={flash} />}
              {safeView === "reports" && <Reports ev={ev} evSales={evSales} role={role} onVoid={(id) => voidOne(id, role)} onCierreZ={cierreZ} flash={flash} />}
            </div>
          </main>
        </div>
      ))}

      {/* ===== Menú móvil (hoja inferior) ===== */}
      {isMobile && menuOpen && (
        <div style={S.sheetWrap} onClick={() => setMenuOpen(false)}>
          <div className="sheet-anim" style={S.sheet} onClick={e => e.stopPropagation()}>
            <div style={S.grab} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{role === "admin" ? "Admin" : role === "supervisor" ? "Supervisor" : "Cajero"}</div>
              <button onClick={() => setMenuOpen(false)} style={S.iconBtn}>✕</button>
            </div>
            {isPriv && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Punto de venta activo</div>
                <select value={punto.id} onChange={e => dispatch({ type: "SET_PUNTO", id: e.target.value })} style={S.select}>{activePuntos.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}><OnlinePill /><PrinterPill /></div>
            <button onClick={() => { setMenuOpen(false); exitToLogin(); }} style={{ ...S.btnGhost, width: "100%", padding: "13px" }}>🔁 Cambiar de rol</button>
            <button onClick={() => { setMenuOpen(false); logout(); }} style={{ ...S.btnGhost, width: "100%", marginTop: 8, padding: "13px", color: "var(--red)", borderColor: "var(--red)" }}>🔒 Cerrar sesión</button>
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

      {toast && <div style={{ ...S.toast, background: toast.kind === "warn" ? "var(--amber)" : "var(--green)" }}>{toast.msg}</div>}
    </div>
  );
}

/* ---------------------- Login ---------------------- */
function RoleGate({ ev, events, adminPin, supervisorPin, onSelectEvent, onRole }) {
  const [mode, setMode] = useState(null); // null | cajero | admin | supervisor
  const puntos = ev.puntos.filter(p => !p.archivado);
  const [op, setOp] = useState(puntos[0]?.id);
  useEffect(() => { setOp(ev.puntos.filter(p => !p.archivado)[0]?.id); }, [ev.id]);
  const roles = [
    { k: "cajero", icon: "🧾", t: "Cajero", d: "Solo TPV e impresión" },
    { k: "supervisor", icon: "🧭", t: "Supervisor", d: "TPV + informes + cierres" },
    { k: "admin", icon: "🛠️", t: "Administrador", d: "Configura todo" },
  ];
  return (
    <div style={S.gateWrap}>
      <div style={S.gateCard}>
        <div style={{ textAlign: "center" }}><div style={S.logo}><span style={{ color: "var(--accent)" }}>●</span> TICKETERA</div></div>
        <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, margin: "6px 0 18px" }}>Elige evento y entra con tu rol</div>
        <select value={ev.id} onChange={e => onSelectEvent(e.target.value)} style={{ ...S.select, marginBottom: 18 }}>{events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select>

        {mode === null && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {roles.map(r => <button key={r.k} onClick={() => r.k === "cajero" ? setMode("cajero") : setMode(r.k)} style={S.gateRole}><span style={{ fontSize: 30 }}>{r.icon}</span><span style={{ fontWeight: 800, fontSize: 16 }}>{r.t}</span><span style={{ fontSize: 11, color: "var(--muted)" }}>{r.d}</span></button>)}
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

/* ---------------------- Stat ---------------------- */
function Stat({ label, value, accent }) {
  return <div style={S.statBox}><div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div><div style={{ fontSize: 24, fontWeight: 800, color: accent }}>{value}</div></div>;
}

/* ============================================================
   POS
   ============================================================ */
function POS({ punto, totals, onSell, onSellMany, onVoid, onReprint, canReprint }) {
  const isMobile = useIsMobile();
  const [qty, setQty] = useState(1);
  const [grouping, setGrouping] = useState(false);
  const [cart, setCart] = useState([]); // [{product, qty}]
  const [charging, setCharging] = useState(null);

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
          {punto.products.length === 0 ? <Empty msg={`“${punto.name}” aún no tiene productos.`} /> : (
            <div style={{ ...S.grid, gridTemplateColumns: isMobile ? "repeat(auto-fill, minmax(130px,1fr))" : "repeat(auto-fill, minmax(170px,1fr))" }}>
              {punto.products.map(p => {
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
  const templates = [{ k: "festival", l: "Festival", d: "Banner invertido" }, { k: "bold", l: "Bold", d: "Recuadro marcado" }, { k: "minimal", l: "Minimal", d: "Limpio" }, { k: "sello", l: "Sello/QR", d: "Con código" }];
  const demo = ev.puntos.flatMap(p => p.products)[0] || { name: "NOMBRE TICKET", price: 10, id: "abc123" };
  const Toggle = ({ k, label }) => (
    <label style={S.toggleRow}><span>{label}</span><button onClick={() => set({ [k]: !ev[k] })} style={{ ...S.switch, background: ev[k] ? "var(--accent)" : "var(--line)" }}><span style={{ ...S.knob, transform: ev[k] ? "translateX(20px)" : "translateX(2px)" }} /></button></label>
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
function EventConfig({ state, ev, punto, evSales, dispatch, flash }) {
  const isMobile = useIsMobile();
  const [draft, setDraft] = useState({ name: "", price: "", emoji: "🎟️", color: PALETTE[0] });
  const [newEvent, setNewEvent] = useState(null);
  const [newPunto, setNewPunto] = useState("");
  const [confirmDel, setConfirmDel] = useState(null);
  const [editProd, setEditProd] = useState(null);   // producto en edición
  const [renamePunto, setRenamePunto] = useState(null); // {id, value}
  const emojis = ["🎟️", "⭐", "🍺", "🍹", "🥤", "💧", "🥪", "🧥", "🥂", "🥃", "🌭", "🍕", "🎫", "🪙"];
  const puntoTieneVentas = (id) => evSales.some(s => s.puntoId === id);

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
    dispatch({ type: "ADD_PRODUCT", eventId: ev.id, puntoId: punto.id, product: { id: uid(), name: draft.name.toUpperCase(), price: parseFloat(draft.price), emoji: draft.emoji, color: draft.color, soldOut: false } });
    setDraft({ name: "", price: "", emoji: "🎟️", color: PALETTE[Math.floor(Math.random() * PALETTE.length)] });
    flash("Producto añadido a " + punto.name);
  };
  const addPunto = () => { if (!newPunto.trim()) { flash("Pon nombre al punto", "warn"); return; } dispatch({ type: "ADD_PUNTO", eventId: ev.id, punto: { id: uid(), name: newPunto.trim(), archivado: false, products: [] } }); setNewPunto(""); flash("Punto de venta creado"); };
  const createEvent = () => { if (!newEvent.name.trim()) { flash("Falta el nombre", "warn"); return; } dispatch({ type: "ADD_EVENT", event: { id: uid(), name: newEvent.name.toUpperCase(), date: newEvent.date || "2026-01-01", venue: newEvent.venue, template: "festival", paper: 80, footer: "", logo: "", showEventName: true, showDate: true, showTime: true, showPrice: true, anularPin: false, puntos: [{ id: uid(), name: "Taquilla", archivado: false, products: [] }] } }); setNewEvent(null); flash("Evento creado"); };

  return (
    <>
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 24, alignItems: "start" }}>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><h3 style={S.h3}>Datos del evento</h3><button onClick={() => setNewEvent({ name: "", date: "", venue: "" })} style={S.btnGhost}>+ Nuevo evento</button></div>
        <div style={S.panel}>
          <Field label="Nombre"><input style={S.input} value={ev.name} onChange={e => dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: { name: e.target.value } })} /></Field>
          <Field label="Fecha"><input type="date" style={S.input} value={ev.date} onChange={e => dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: { date: e.target.value } })} /></Field>
          <Field label="Recinto"><input style={S.input} value={ev.venue} onChange={e => dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: { venue: e.target.value } })} /></Field>
          <div style={{ display: "flex", gap: 10 }}>
            <Field label="PIN admin"><input style={S.input} value={ev.pin_admin || ""} maxLength={6} onChange={e => dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: { pin_admin: e.target.value } })} /></Field>
            <Field label="PIN supervisor"><input style={S.input} value={ev.pin_supervisor || ""} maxLength={6} onChange={e => dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: { pin_supervisor: e.target.value } })} /></Field>
          </div>
          <label style={S.toggleRow}><span>Anular ticket en caja exige PIN de supervisor</span><button onClick={() => dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: { anularPin: !ev.anularPin } })} style={{ ...S.switch, background: ev.anularPin ? "var(--accent)" : "var(--line)" }}><span style={{ ...S.knob, transform: ev.anularPin ? "translateX(20px)" : "translateX(2px)" }} /></button></label>
        </div>
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
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}><input style={{ ...S.input, width: 110 }} type="number" placeholder="Precio €" value={draft.price} onChange={e => setDraft({ ...draft, price: e.target.value })} /><select style={{ ...S.input, width: 80 }} value={draft.emoji} onChange={e => setDraft({ ...draft, emoji: e.target.value })}>{emojis.map(x => <option key={x}>{x}</option>)}</select></div>
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>{PALETTE.map(c => <button key={c} onClick={() => setDraft({ ...draft, color: c })} style={{ width: 26, height: 26, borderRadius: 7, background: c, border: draft.color === c ? "3px solid #fff" : "3px solid transparent", cursor: "pointer" }} />)}</div>
          <button onClick={addProduct} style={{ ...S.btnPrimary, marginTop: 12 }}>+ Añadir a {punto.name}</button>
        </div>
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          {punto.products.length === 0 && <Empty msg="Sin productos en este punto." />}
          {punto.products.map(p => (
            <div key={p.id} style={{ ...S.prodRow, opacity: p.soldOut ? .55 : 1 }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: p.color, display: "grid", placeItems: "center", fontSize: 20 }}>{p.emoji}</div>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div><div style={{ fontSize: 12, color: "var(--muted)" }}>{money(p.price)}</div></div>
              <button onClick={() => setEditProd({ id: p.id, name: p.name, price: String(p.price), emoji: p.emoji, color: p.color, soldOut: p.soldOut })} style={S.smallBtn} title="Editar producto">✏️</button>
              <button onClick={() => dispatch({ type: "UPDATE_PRODUCT", eventId: ev.id, puntoId: punto.id, productId: p.id, patch: { soldOut: !p.soldOut } })} style={{ ...S.smallBtn, color: p.soldOut ? "var(--amber)" : "var(--muted)", borderColor: p.soldOut ? "var(--amber)" : "var(--line)" }}>{p.soldOut ? "Agotado" : "Disponible"}</button>
              <button onClick={() => dispatch({ type: "DELETE_PRODUCT", eventId: ev.id, puntoId: punto.id, productId: p.id })} style={S.del}>✕</button>
            </div>
          ))}
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
            <Field label="Icono"><select style={S.input} value={editProd.emoji} onChange={e => setEditProd({ ...editProd, emoji: e.target.value })}>{emojis.map(x => <option key={x}>{x}</option>)}</select></Field>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 6px" }}>Color</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{PALETTE.map(c => <button key={c} onClick={() => setEditProd({ ...editProd, color: c })} style={{ width: 28, height: 28, borderRadius: 7, background: c, border: editProd.color === c ? "3px solid #fff" : "3px solid transparent", cursor: "pointer" }} />)}</div>
          <label style={{ ...S.toggleRow, marginTop: 14 }}><span>Marcar como agotado</span><button onClick={() => setEditProd({ ...editProd, soldOut: !editProd.soldOut })} style={{ ...S.switch, background: editProd.soldOut ? "var(--amber)" : "var(--line)" }}><span style={{ ...S.knob, transform: editProd.soldOut ? "translateX(20px)" : "translateX(2px)" }} /></button></label>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}><button style={S.btnPrimary} onClick={saveProduct}>Guardar cambios</button><button style={S.btnGhost} onClick={() => setEditProd(null)}>Cancelar</button></div>
        </div>
      </div>
    )}
    </>
  );
}

/* ============================================================
   REPORTS
   ============================================================ */
function Reports({ ev, evSales, role, onVoid, onCierreZ, flash }) {
  const [confirmVoid, setConfirmVoid] = useState(null);
  const byPunto = ev.puntos.map(p => {
    const live = evSales.filter(s => s.puntoId === p.id && !s.voided);
    const perProduct = {}; let revenue = 0;
    live.forEach(s => { perProduct[s.productId] = (perProduct[s.productId] || 0) + 1; revenue += s.price; });
    return { punto: p, perProduct, revenue, count: live.length, voids: evSales.filter(s => s.puntoId === p.id && s.voided).length };
  });
  const grandCount = byPunto.reduce((t, b) => t + b.count, 0);
  const grandRevenue = byPunto.reduce((t, b) => t + b.revenue, 0);
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
    const csv = rows.map(r => r.join(";")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${ev.name.replace(/\s+/g, "_")}_cierre.csv`; a.click(); flash("CSV exportado");
  };

  return (
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
      </div>

      {/* Multi-dispositivo: consolidado en vivo */}
      <div style={{ ...S.panel, marginBottom: 16 }}>
        <div style={{ fontWeight: 800, marginBottom: 12 }}>Consolidado en vivo (todos los puntos)</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 10 }}>
          {byPunto.map(b => (
            <div key={b.punto.id} style={{ background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 12, padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>📍 {b.punto.name}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "var(--green)", marginTop: 4 }}>{money(b.revenue)}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{b.count} tickets · {b.voids} anul.</div>
              {(role === "admin" || role === "supervisor") && <button onClick={() => onCierreZ(b.punto)} style={{ ...S.smallBtn, marginTop: 8, width: "100%", color: "var(--accent)", borderColor: "var(--accent)" }}>Cierre Z 🧾</button>}
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
                <span style={{ display: "flex", gap: 6 }}><button onClick={() => { onVoid(s.id); setConfirmVoid(null); flash("Ticket anulado", "warn"); }} style={{ ...S.smallBtn, color: "var(--red)", borderColor: "var(--red)" }}>✓ Sí</button><button onClick={() => setConfirmVoid(null)} style={S.smallBtn}>✗</button></span>
              ) : <button onClick={() => setConfirmVoid(s.id)} style={S.smallBtn}>Anular</button>}
            </div>
          ))}
        </div>
      </div>
    </div>
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
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Manrope:wght@400;600;700;800&family=Roboto+Mono:wght@400;700&display=swap');
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
button{font-family:'Manrope',sans-serif;cursor:pointer;}
input,select{font-family:'Manrope',sans-serif;font-size:16px;}
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
  side: { width: 230, background: "var(--surface)", borderRight: "1px solid var(--line)", padding: 18, display: "flex", flexDirection: "column", gap: 4 },
  sideMobile: { width: "100%", boxSizing: "border-box", background: "var(--surface)", borderBottom: "1px solid var(--line)", padding: 12, display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  mTop: { display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderBottom: "1px solid var(--line)", background: "var(--surface)", position: "sticky", top: 0, zIndex: 20 },
  mTitle: { flex: 1, minWidth: 0 },
  iconBtn: { width: 42, height: 42, flexShrink: 0, borderRadius: 12, background: "var(--surface2)", border: "1px solid var(--line)", color: "var(--text)", fontSize: 18, display: "grid", placeItems: "center" },
  bottomNav: { display: "flex", borderTop: "1px solid var(--line)", background: "var(--surface)", paddingBottom: "env(safe-area-inset-bottom)", flexShrink: 0 },
  bTab: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "9px 4px 8px", background: "transparent", border: "none", color: "var(--muted)", fontSize: 10.5, fontWeight: 700 },
  bTabActive: { color: "var(--accent)" },
  sheetWrap: { position: "fixed", inset: 0, background: "rgba(0,0,0,.62)", zIndex: 60, display: "flex", alignItems: "flex-end", backdropFilter: "blur(3px)" },
  sheet: { width: "100%", background: "var(--surface)", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, paddingBottom: "calc(20px + env(safe-area-inset-bottom))", maxHeight: "86dvh", overflow: "auto", borderTop: "1px solid var(--line)" },
  grab: { width: 40, height: 4, borderRadius: 4, background: "var(--line)", margin: "0 auto 14px" },
  logo: { fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: 1 },
  select: { width: "100%", background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", fontWeight: 600, outline: "none" },
  navBtn: { display: "flex", alignItems: "center", gap: 10, background: "transparent", color: "var(--text)", border: "none", padding: "12px 14px", borderRadius: 10, fontWeight: 700, fontSize: 15, textAlign: "left" },
  navActive: { background: "var(--surface2)", color: "#fff", boxShadow: "inset 3px 0 0 var(--accent)" },
  main: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
  top: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 22px", borderBottom: "1px solid var(--line)", background: "var(--surface)" },
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
  printerStatusSm: { display: "flex", alignItems: "center", gap: 7, background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", color: "var(--text)", fontSize: 12, fontWeight: 700 },
  roleBadge: { marginTop: 8, fontSize: 11, fontWeight: 800, letterSpacing: 1, border: "1px solid", borderRadius: 20, padding: "3px 10px", alignSelf: "flex-start" },
  cashierTop: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 22px", borderBottom: "1px solid var(--line)", background: "var(--surface)", flexWrap: "wrap", gap: 10 },
  gateWrap: { minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 18, overflow: "auto", background: "radial-gradient(1100px 560px at 50% -10%, #211a30, var(--bg))" },
  gateCard: { width: 440, maxWidth: "100%", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 22, padding: 28, boxShadow: "0 30px 80px rgba(0,0,0,.55)" },
  gateRole: { display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "20px 8px", background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 16, color: "var(--text)" },
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
  prodRow: { display: "flex", alignItems: "center", gap: 12, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 10 },
  del: { background: "transparent", color: "var(--red)", border: "1px solid var(--line)", borderRadius: 8, width: 32, height: 32, fontWeight: 800 },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "grid", placeItems: "center", zIndex: 50, backdropFilter: "blur(4px)" },
  pinCard: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 20, padding: 26, width: 300 },
  pinBtn: { background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 14, padding: "18px 0", fontSize: 22, fontWeight: 700 },
  toast: { position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)", color: "#06281f", padding: "12px 26px", borderRadius: 30, fontWeight: 800, zIndex: 60, boxShadow: "0 10px 30px rgba(0,0,0,.4)" },
};

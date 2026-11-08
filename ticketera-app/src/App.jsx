import React, { useReducer, useState, useMemo, useEffect, useRef, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { uid } from "./supabase";
import { logout } from "./auth";
import * as db from "./db";
import { secretoDe, estadoDe, comprobar as comprobarPin, crearHuella, problema as problemaPin, fuerza as fuerzaPin, disponible as cifradoDisponible } from "./pin";
import { useReservados, LineaReservados, CobrarReservado, ReservadosVista, InformeReservados, copiarReservados, resCfg, VentaSocio, efectivoSocios } from "./reservados";
import { nextFolios, prefijoDePunto, peekFolio, getDeviceTag, resetFolios, seedFolio } from "./folio";
import QrCodigo from "./qr/QrCodigo";
import { crearToken } from "./qr/token";
import InformeQR from "./qr/InformeQR";
// Modo CRM: código aparte que solo se descarga al abrirlo (el TPV no pesa más ni arranca más lento)
const CRM = lazy(() => import("./crm/CRM.jsx"));
// Validador de tickets con QR (cámara): solo se descarga en el móvil que valida
const Validador = lazy(() => import("./qr/Validador.jsx"));

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
// Fecha y hora de fin del evento: se guarda con zona horaria; el campo de la pantalla usa la hora local
const isoALocal = (iso) => { if (!iso) return ""; const d = new Date(iso); if (isNaN(d)) return ""; const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const localAIso = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d.toISOString(); };
const fechaHora = (v) => { if (!v) return ""; const d = new Date(v); if (isNaN(d)) return ""; return d.toLocaleString("es-ES", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };
// Movimientos de caja: "gasto" = dinero que sale del cajón · "entrada" = cambio que se añade
const isEntrada = (g) => g && g.tipo === "entrada";
const sumMov = (arr, tipo) => round2((arr || []).filter(g => !g.voided && (tipo === "entrada" ? isEntrada(g) : !isEntrada(g))).reduce((t, g) => t + g.importe, 0));
const APP_VERSION = "2026.11.08g";   // súbela al publicar cambios para verificar la actualización

// Detecta pantalla pequeña (móvil) para adaptar el layout
function useIsMobile(bp = 720) {
  const [m, setM] = useState(typeof window !== "undefined" ? window.innerWidth <= bp : false);
  useEffect(() => { const f = () => setM(window.innerWidth <= bp); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, [bp]);
  return m;
}

/* ---------------------- Estado inicial (se hidrata desde Supabase) ---------------------- */
const emptyState = () => ({ events: [], currentEventId: null, currentPuntoId: null, sales: [], closures: [], gastos: [], adminPin: "1234", supervisorPin: "0000", online: typeof navigator !== "undefined" ? navigator.onLine : true });
const EMPTY_EV = { id: null, name: "", date: "", venue: "", template: "festival", paper: 80, footer: "", logo: "", showEventName: true, showDate: true, showTime: true, showPrice: true, anularPin: false, closed: false, startsAt: "", advanced: false, changeHelp: true, style: {}, pin_admin: "1234", pin_supervisor: "0000", puntos: [{ id: null, name: "", archivado: false, products: [] }] };

/* ---------------------- Reducer ---------------------- */
function reducer(state, a) {
  const mapEv = (fn) => state.events.map(e => e.id === a.eventId ? fn(e) : e);
  const mapPunto = (e, fn) => ({ ...e, puntos: e.puntos.map(p => p.id === a.puntoId ? fn(p) : p) });
  switch (a.type) {
    case "ADD_EVENT": return { ...state, events: [...state.events, { ...a.event, qrClave: "" }], currentEventId: a.event.id, currentPuntoId: a.event.puntos[0]?.id };   // la clave QR nueva la crea el servidor
    case "SELECT_EVENT": { const e = state.events.find(x => x.id === a.id); return { ...state, currentEventId: a.id, currentPuntoId: e?.puntos[0]?.id }; }
    case "UPDATE_EVENT": return { ...state, events: state.events.map(e => e.id === a.id ? { ...e, ...a.patch } : e) };
    case "LOCAL_EVENT_PATCH": return { ...state, events: state.events.map(e => e.id === a.id ? { ...e, ...a.patch } : e) };   // ya guardado en la nube
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
    case "CLOSE_PUNTO_SALES": return { ...state, sales: state.sales.map(s => (s.eventId === a.eventId && s.puntoId === a.puntoId && !s.closureId) ? { ...s, closureId: a.closureId } : s), gastos: (state.gastos || []).map(g => (g.eventId === a.eventId && g.puntoId === a.puntoId && !g.closureId) ? { ...g, closureId: a.closureId } : g) };
    case "ADD_GASTO": return { ...state, gastos: [...(state.gastos || []), a.gasto] };
    case "VOID_GASTO": return { ...state, gastos: (state.gastos || []).map(g => g.id === a.id ? { ...g, voided: true } : g) };
    case "HYDRATE_GASTOS": return { ...state, gastos: a.gastos };
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
// Ticket de prueba: bandas negras "PRUEBA · NO VÁLIDO" arriba y abajo para que nadie lo canjee
function ThermalTicket(props) {
  if (props.folio !== "PRUEBA") return <ThermalTicketBody {...props} />;
  const mm = props.ev.paper === 58 ? 46 : 68;
  const band = <div style={{ background: "#000", color: "#fff", textAlign: "center", fontFamily: "'Roboto Mono', monospace", fontWeight: 900, fontSize: 13, letterSpacing: 1, padding: "1mm 0", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}>✕ PRUEBA · NO VÁLIDO ✕</div>;
  return <div style={{ width: mm + "mm", background: "#fff" }}>{band}<ThermalTicketBody {...props} />{band}</div>;
}
function ThermalTicketBody({ ev, product, time, num, qty = 1, code, folio, qr, notas }) {
  const mm = ev.paper === 58 ? 46 : 68;          // ancho del ticket con margen de seguridad (la impresora pierde ~3 mm a la derecha)
  const st = ev.style || {};
  const nd = st.nameSize === "xl" ? 18 : st.nameSize === "lg" ? 8 : 0;  // tamaño del nombre
  const big = (ev.paper === 58 ? 28 : 40) + nd;                          // el NOMBRE manda
  const priceSize = Math.max(16, big - 14);                             // precio, secundario
  const logoMax = st.logoSize === "sm" ? 30 : st.logoSize === "lg" ? 62 : 42;
  const logoTxt = st.logoSize === "sm" ? 18 : st.logoSize === "lg" ? 32 : 24;
  const showFolio = st.showFolio !== false;
  const ref = showFolio ? (folio ? "Folio " + folio : (num != null ? "Nº " + String(num).padStart(4, "0") : "")) : "";
  const base = { fontFamily: "'Roboto Mono', ui-monospace, monospace", color: "#000", background: "#fff", width: mm + "mm", padding: "0.5mm 1.5mm 1mm", boxSizing: "border-box", lineHeight: 1.15, fontWeight: 700 };
  const dashed = <div style={{ borderTop: "2px dashed #000", margin: "1.2mm 0" }} />;
  // Ajuste automático: la palabra más larga SIEMPRE cabe entera (nunca "REFRES-CO"); las cortas siguen grandes
  const innerPx = (mm - 10) * 96 / 25.4;                                   // ancho útil dentro del recuadro
  const fitSize = (text, size, weight) => {
    const words = String(text || "").split(/\s+/).filter(Boolean); if (!words.length) return size;
    let w = 0;
    try {
      const ctx = (fitSize.c || (fitSize.c = document.createElement("canvas"))).getContext("2d");
      ctx.font = `${weight} 100px 'Roboto Mono', ui-monospace, monospace`;
      w = Math.max(...words.map(x => ctx.measureText(x).width)) / 100;    // ancho por px de fuente
    } catch { w = 0; }
    if (!w) w = Math.max(...words.map(x => x.length)) * 0.62;             // respaldo: letra monoespaciada
    return Math.max(12, Math.min(size, Math.floor(innerPx / (w * 1.04))));
  };
  const Name = ({ size, align = "center" }) => { const nm = product?.name || "NOMBRE TICKET"; const sz = fitSize(nm, size, 900); return (<>
    <div style={{ fontWeight: 900, fontSize: sz, letterSpacing: -0.3, textAlign: align, lineHeight: 1.04, color: "#000", wordBreak: "normal", overflowWrap: "anywhere" }}>{nm}</div>
    {product?.subtitle ? <div style={{ fontWeight: 800, fontSize: fitSize(product.subtitle, Math.max(13, Math.round(size * 0.4)), 800), textAlign: align, lineHeight: 1.15, color: "#000", marginTop: "0.6mm", wordBreak: "normal", overflowWrap: "anywhere" }}>{product.subtitle}</div> : null}
  </>); };
  const Logo = () => {
    if (!ev.logo || st.showLogo === false) return null;
    const isImg = typeof ev.logo === "string" && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(ev.logo);
    return isImg
      ? <div style={{ textAlign: "center", marginBottom: "1mm" }}><img src={ev.logo} alt="" style={{ maxHeight: logoMax, maxWidth: "70%", filter: "grayscale(1) contrast(3) brightness(.9)" }} /></div>
      : <div style={{ textAlign: "center", fontWeight: 900, fontSize: logoTxt, letterSpacing: 1, marginBottom: "1mm", color: "#000" }}>{ev.logo}</div>;
  };
  const Sub = () => st.subtitle ? <div style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "#000" }}>{st.subtitle}</div> : null;
  const priceLine = ev.showPrice && !(qty > 1) && <div style={{ textAlign: "center", fontWeight: 800, fontSize: priceSize, marginTop: "0.8mm", color: "#000" }}>{money(product?.price)}</div>;
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
      <div style={{ border: "3px solid #000", textAlign: "center", padding: "1.8mm 1.5mm", borderRadius: 2 }}><Name size={big} />{priceLine}{qtyLine}</div>
      {dashed}
      {!qr && <div style={{ display: "flex", justifyContent: "space-between", ...metaStyle }}>{ev.showDate && <span>{dateFmt(ev.date).split(" de ")[0]}/{ev.date.slice(5, 7)}</span>}{ev.showTime && <span>{time}</span>}</div>}
      {ref && !qr && <div style={{ ...metaStyle, marginTop: "1mm" }}>{ref}</div>}
      {ev.footer && !qr && <div style={{ textAlign: "center", fontSize: 11, color: "#000", marginTop: qr ? 0 : "1.5mm", fontWeight: 600 }}>{ev.footer}</div>}
    </>);
  } else if (ev.template === "bold") {
    inner = (<>
      <Logo />
      <div style={{ textAlign: "center", border: "3px solid #000", padding: "3mm 2mm", borderRadius: 4 }}>
        <Name size={big + 2} />{priceLine}{qtyLine}
      </div>
      {ev.showEventName && <div style={{ textAlign: "center", fontWeight: 800, fontSize: 13, marginTop: "2mm", color: "#000" }}>{ev.name}</div>}
      <Sub />
      {!qr && <div style={{ textAlign: "center", ...metaStyle, marginTop: "1mm" }}>{ev.showDate && dateFmt(ev.date)}{ev.showTime && ` · ${time}`}</div>}
      {ref && !qr && <div style={{ textAlign: "center", ...metaStyle }}>{ref}</div>}
      {ev.footer && !qr && <div style={{ textAlign: "center", fontSize: 11, color: "#000", marginTop: "2mm", borderTop: "2px solid #000", paddingTop: "1.5mm", fontWeight: 600 }}>{ev.footer}</div>}
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
      {!qr && <div style={{ ...metaStyle, marginTop: "2mm" }}>{ev.showDate && dateFmt(ev.date)}{ev.showTime && ` — ${time}`}{ref && ` · ${ref}`}</div>}
      {ev.footer && !qr && <div style={{ fontSize: 11, color: "#000", marginTop: "2mm", fontWeight: 600 }}>{ev.footer}</div>}
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
      {!qr && <div style={{ display: "flex", justifyContent: "space-between", ...metaStyle }}>{ev.showDate && <span>{dateFmt(ev.date)}</span>}{ev.showTime && <span>{time}</span>}</div>}
      {ev.venue && <div style={{ textAlign: "center", fontSize: 11, fontWeight: 600, marginTop: "1mm" }}>{ev.venue}</div>}
      {ref && !qr && <div style={{ textAlign: "center", ...metaStyle, marginTop: "1mm" }}>{ref}</div>}
      {ev.footer && !qr && <div style={{ textAlign: "center", fontSize: 11, color: "#000", marginTop: "1.5mm", fontWeight: 600 }}>{ev.footer}</div>}
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
      {!qr && <div style={{ ...metaStyle }}>{ev.showDate && dateFmt(ev.date)}{ev.showTime && ` · ${time}`}{ref && ` · ${ref}`}</div>}
      {ev.footer && !qr && <div style={{ fontSize: 11, color: "#000", marginTop: "1mm", fontWeight: 600 }}>{ev.footer}</div>}
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
      {!qr && <div style={{ textAlign: "center", ...metaStyle, marginTop: "1.5mm" }}>{ev.showDate && dateFmt(ev.date)} {ev.showTime && time}</div>}
      {ev.footer && !qr && <div style={{ textAlign: "center", fontSize: 11, color: "#000", marginTop: "1.5mm", fontWeight: 600 }}>{ev.footer}</div>}
    </>);
  }
  return (
    <div style={{ ...base, ...(st.border ? { border: "2px solid #000", borderRadius: 4 } : {}) }}>
      {inner}
      {qr && (
        // Ticket validable: QR de un solo uso (se firma aquí mismo, sin internet) + folio para teclearlo si no se lee
        <div className="qr-row" style={{ display: "flex", alignItems: "center", gap: "2mm", marginTop: "1.5mm", paddingTop: "1.5mm", borderTop: "2px dashed #000" }}>
          <QrCodigo texto={qr} modulo={0.5} style={{ zoom: 1 }} />
          <div style={{ flex: 1, minWidth: 0, color: "#000", lineHeight: 1.2 }}>
            <div style={{ fontWeight: 900, fontSize: ev.paper === 58 ? 12 : 14, lineHeight: 1.1 }}>UN SOLO USO</div>
            <div style={{ fontWeight: 700, fontSize: 10.5, marginTop: "0.5mm" }}>Las copias no valen</div>
            {(ev.showDate || ev.showTime) && <div style={{ ...metaStyle, fontSize: 11, marginTop: "0.8mm" }}>{ev.showDate && `${dateFmt(ev.date).split(" de ")[0]}/${ev.date.slice(5, 7)}`}{ev.showDate && ev.showTime ? " · " : ""}{ev.showTime && time}</div>}
            {folio && (ev.template !== "sello" || folio === "PRUEBA") && <div style={{ fontWeight: 900, fontSize: 12, marginTop: "0.5mm", overflowWrap: "anywhere" }}>{folio}</div>}
            {ev.footer && <div style={{ fontSize: 10.5, fontWeight: 600, marginTop: "0.8mm", overflowWrap: "anywhere" }}>{ev.footer}</div>}
          </div>
        </div>
      )}
      {notas?.length ? <div style={{ marginTop: "1.5mm", borderTop: "2px dashed #000", paddingTop: "1mm", textAlign: "center", color: "#000" }}>{notas.map((n, i) => <div key={i} style={{ fontSize: n.b ? 14 : 11.5, fontWeight: n.b ? 900 : 700, lineHeight: 1.25 }}>{n.t}</div>)}</div> : null}
      {st.message && <div style={{ marginTop: "2mm", textAlign: "center", fontWeight: 900, fontSize: 13, border: "2px solid #000", borderRadius: 3, padding: "1.5mm 2mm", textTransform: "uppercase" }}>{st.message}</div>}
    </div>
  );
}

/* ---------------------- Ticket de cierre Z ---------------------- */
function ZTicket({ ev, z }) {
  const mm = ev.paper === 58 ? 46 : 68;
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
      {(z.gastosList || []).length > 0 && (<>
        <div style={{ borderTop: "2px dashed #000", margin: "2mm 0" }} />
        <div style={{ textAlign: "center", fontWeight: 900, fontSize: 13 }}>GASTOS DE CAJA</div>
        {z.gastosList.map((g, i) => <div key={i} style={{ ...row, fontSize: 11 }}><span style={{ minWidth: 0, overflowWrap: "anywhere", paddingRight: "2mm" }}>{g.concepto || "Gasto"}</span><span>-{money(g.importe)}</span></div>)}
        <div style={{ ...row, marginTop: "1mm" }}><span>Total gastos</span><span>-{money(z.gastos)}</span></div>
      </>)}
      {(z.entradasList || []).length > 0 && (<>
        <div style={{ borderTop: "2px dashed #000", margin: "2mm 0" }} />
        <div style={{ textAlign: "center", fontWeight: 900, fontSize: 13 }}>CAMBIO AÑADIDO</div>
        {z.entradasList.map((g, i) => <div key={i} style={{ ...row, fontSize: 11 }}><span style={{ minWidth: 0, overflowWrap: "anywhere", paddingRight: "2mm" }}>{g.concepto || "Cambio"}</span><span>+{money(g.importe)}</span></div>)}
        <div style={{ ...row, marginTop: "1mm" }}><span>Total añadido</span><span>+{money(z.entradas)}</span></div>
      </>)}
      {(z.showArqueo || z.advanced) && (<>
        <div style={{ borderTop: "2px dashed #000", margin: "2mm 0" }} />
        <div style={{ textAlign: "center", fontWeight: 900, fontSize: 13 }}>ARQUEO DE CAJA</div>
        <div style={{ ...row, marginTop: "1mm" }}><span>Fondo inicial</span><span>{money(z.fondo || 0)}</span></div>
        <div style={row}><span>{z.advanced ? "+ Ventas efectivo" : "+ Facturado"}</span><span>{money(z.advanced ? (z.efectivo || 0) : (z.revenue || 0))}</span></div>
        {z.entradas > 0 && <div style={row}><span>+ Cambio añadido</span><span>{money(z.entradas)}</span></div>}
        {z.gastos > 0 && <div style={row}><span>- Gastos de caja</span><span>{money(z.gastos)}</span></div>}
        <div style={{ ...row, fontSize: 14, borderTop: "2px solid #000", marginTop: "1mm", paddingTop: "1mm" }}><span>= DEBE HABER</span><span>{money(z.esperado != null ? z.esperado : (z.fondo || 0) + (z.efectivo || 0) - (z.gastos || 0))}</span></div>
        <div style={{ textAlign: "center", fontSize: 10.5, fontWeight: 700 }}>{z.advanced ? "(en el cajón)" : "(cajón + datáfono)"}</div>
        {z.contado != null && (<>
          <div style={{ ...row, marginTop: "1mm" }}><span>Contado</span><span>{money(z.contado)}</span></div>
          <div style={{ ...row, fontSize: 15, fontWeight: 900 }}><span>{z.descuadre === 0 ? "CUADRA ✓" : z.descuadre > 0 ? "SOBRA" : "FALTA"}</span><span>{z.descuadre === 0 ? money(0) : money(Math.abs(z.descuadre))}</span></div>
        </>)}
        {z.advanced && <div style={{ ...row, marginTop: "1.5mm" }}><span>Tarjeta (no en cajón)</span><span>{money(z.tarjeta || 0)}</span></div>}
      </>)}
      {(z.socios || []).length > 0 && (<>
        <div style={{ borderTop: "2px dashed #000", margin: "2mm 0" }} />
        <div style={{ textAlign: "center", fontWeight: 900, fontSize: 13 }}>EFECTIVO EN MANOS DE SOCIOS</div>
        {z.socios.map((x, i) => <div key={i} style={row}><span style={{ minWidth: 0, overflowWrap: "anywhere", paddingRight: "2mm" }}>{x.nombre}</span><span>{money(x.importe)}</span></div>)}
        <div style={{ textAlign: "center", fontSize: 10.5, fontWeight: 700 }}>(ya sumado arriba: deben entregarlo en esta caja)</div>
      </>)}
      <div style={{ ...row, marginTop: "1mm" }}><span>Tickets</span><span>{z.count}</span></div>
      <div style={row}><span>Anulaciones</span><span>{z.voids}</span></div>
      {z.invites ? <div style={row}><span>Invitaciones ({z.invites})</span><span>{money(z.invitesValue || 0)}</span></div> : null}
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
  const [appMode, setAppMode] = useState("tpv");   // "tpv" | "crm" (el CRM solo para admin)
  const [toast, setToast] = useState(null);
  const [printJob, setPrintJob] = useState(null);
  const [showRevenue, setShowRevenue] = useState(false);
  const [askRevenue, setAskRevenue] = useState(false);
  const [askVoidPin, setAskVoidPin] = useState(false);
  const [printer, setPrinter] = useState("live");
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [pending, setPending] = useState(db.pendingCount());
  const [fromCache, setFromCache] = useState(false);   // arrancó sin servidor: usando la copia guardada
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => { const h = () => setUpdateReady(true); window.addEventListener("tixfast-update", h); if (window.__tixfastUpdate) setUpdateReady(true); return () => window.removeEventListener("tixfast-update", h); }, []);
  // Modo prueba POR BARRA: toda barra empieza en prueba (imprime "NO VÁLIDO" y no cuenta)
  // hasta que se pulsa "Iniciar venta". Tras el cierre Z vuelve a quedar sin vender.
  const [payFlow, setPayFlow] = useState(null);   // cobro avanzado en curso

  const ev = state.events.find(e => e.id === state.currentEventId) || state.events[0] || EMPTY_EV;
  const activePuntos = ev.puntos.filter(p => !p.archivado);
  const punto = ev.puntos.find(p => p.id === state.currentPuntoId && !p.archivado) || activePuntos[0] || ev.puntos[0];
  const evSales = useMemo(() => state.sales.filter(s => s.eventId === ev.id), [state.sales, ev.id]);
  const evGastos = useMemo(() => (state.gastos || []).filter(g => g.eventId === ev.id), [state.gastos, ev.id]);
  const turnoMovs = useMemo(() => evGastos.filter(g => g.puntoId === punto.id && !g.voided && !g.closureId), [evGastos, punto.id]);
  const testMode = !ev.id || !punto?.id || (punto.estado || "prueba") !== "abierta";
  // Reservados VIP: mapa compartido por todas las barras; se cobran solo en los puntos elegidos
  const res = useReservados(ev.id);
  const [resCobro, setResCobro] = useState(null);   // { item, fijo }
  const [resMapa, setResMapa] = useState(false);     // mapa a pantalla completa (cajero)
  const [resSocio, setResSocio] = useState(null);    // venta sin ticket de un socio: { fijo }
  const livePuntoSales = useMemo(() => evSales.filter(s => s.puntoId === punto.id && !s.voided && !s.closureId), [evSales, punto.id]);
  const totals = useMemo(() => {
    const perProduct = {}; let revenue = 0;
    livePuntoSales.forEach(s => { perProduct[s.productId] = (perProduct[s.productId] || 0) + 1; revenue += s.price; });
    return { perProduct, revenue: round2(revenue), count: livePuntoSales.length };
  }, [livePuntoSales]);
  const rankCounts = useMemo(() => { const c = {}; evSales.forEach(s => { if (s.puntoId === punto.id && !s.voided) c[s.productId] = (c[s.productId] || 0) + 1; }); return c; }, [evSales, punto.id]);
  const reorderProducts = (ids) => dispatch({ type: "REORDER_PRODUCTS", eventId: ev.id, puntoId: punto.id, ids, prevIds: punto.products.map(p => p.id) });
  const setPuntoSortMode = (m) => { dispatch({ type: "UPDATE_PUNTO", eventId: ev.id, puntoId: punto.id, patch: { sortMode: m } }); if (m === "ventas") flash("Más vendidos primero"); };
  const eventRevenue = useMemo(() => round2(evSales.filter(s => !s.voided).reduce((t, s) => t + s.price, 0)), [evSales]);

  // Avisos: los normales se van solos; los de aviso/error se quedan hasta que se tocan (o llega otro)
  const toastTimer = useRef(null);
  const flash = (msg, kind = "ok") => {
    clearTimeout(toastTimer.current);
    setToast({ msg, kind, id: Date.now() });
    if (kind !== "warn") toastTimer.current = setTimeout(() => setToast(null), 1700);
  };

  // ===== Tickets con QR de un solo uso =====
  // Si el evento lo tiene activado, cada ticket impreso lleva su QR firmado (se firma aquí, sin internet).
  // Con QR, "un ticket = un producto": la venta ×3 imprime 3 tickets, cada uno con su código.
  const qrDe = (product) => !!(ev.qrActivo && ev.qrClave && product && product.qr !== false);
  const firmar = (ventaUuid, product, idx = 0, prueba = false) => { try { return crearToken({ clave: ev.qrClave, ventaUuid, idx, productoId: product?.id, prueba }); } catch { return null; } };
  const qrPrueba = (product, idx = 0) => qrDe(product) ? firmar(uid(), product, idx, true) : null;
  const imprimirPrueba = (product, qty = 1) => {
    if (qrDe(product) && qty > 1) setPrintJob({ kind: "multi", tickets: Array.from({ length: qty }, () => ({ product, folio: "PRUEBA", qr: qrPrueba(product) })), time: timeNow(), n: Date.now() });
    else setPrintJob({ kind: "ticket", product, time: timeNow(), num: null, folio: "PRUEBA", qty, qr: qrPrueba(product), n: Date.now() });
  };

  // Fusiona lo que viene del servidor con lo que aún está pendiente de subir en ESTE dispositivo
  const mergePending = (events, serverSales) => {
    const pend = db.pendingSaleUuids(), voids = db.pendingVoidUuids();
    const serverIds = new Set(serverSales.map(s => s.clientUuid).filter(Boolean));
    const local = stateRef.current.sales.filter(s => s.clientUuid && pend.has(s.clientUuid) && !serverIds.has(s.clientUuid));
    // Tras recargar sin internet, las ventas pendientes se recuperan de la cola guardada en el equipo
    const localIds = new Set(local.map(s => s.clientUuid));
    db.pendingSales().forEach(s => { if (!serverIds.has(s.clientUuid) && !localIds.has(s.clientUuid)) { local.push(s); localIds.add(s.clientUuid); } });
    const sales = serverSales.concat(local).map(s => (s.clientUuid && voids.has(s.clientUuid)) ? { ...s, voided: true } : s);
    const evs = events.map(e => ({ ...e, puntos: e.puntos.map(p => { const pp = db.pendingPunto(p.id); return pp ? { ...p, ...pp } : p; }) }));
    return { events: evs, sales };
  };

  // Gastos: los del servidor + los registrados aquí que aún no han subido (y anulaciones pendientes)
  const mergeGastos = (serverGastos) => {
    const ids = new Set(serverGastos.map(g => g.id));
    const voids = db.pendingGastoVoids();
    return serverGastos.concat(db.pendingGastos().filter(g => !ids.has(g.id))).map(g => voids.has(g.id) ? { ...g, voided: true } : g);
  };

  const SNAP = db.scopedKey("ticketera_snapshot");
  const hydrate = async () => {
    let data;
    try {
      // Wifi sin internet: no nos quedamos colgados, a los 8 s usamos la copia guardada
      if (!navigator.onLine) throw new Error("offline");
      data = await Promise.race([db.loadAll(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000))]);
      if (!data.events.length) { await db.ensureDefaultEvent(); data = await db.loadAll(); }
      setFromCache(false);
      try { localStorage.setItem(SNAP, JSON.stringify({ events: data.events, closures: data.closures, gastos: data.gastos || [], sales: data.sales.slice(-4000) })); } catch {}
    } catch (e) {
      // Sin conexión al arrancar: usamos la última copia guardada para poder vender igual
      const snap = (() => { try { return JSON.parse(localStorage.getItem(SNAP) || "null"); } catch { return null; } })();
      if (!snap || !snap.events?.length) throw e;
      data = snap;
      setFromCache(true);   // se ve en la cabecera (punto de conexión), sin aviso flotante
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
      events: merged.events, sales: merged.sales, closures: data.closures || [], gastos: mergeGastos(data.gastos || []),
      currentEventId: stateRef.current.currentEventId || first.id,
      currentPuntoId: stateRef.current.currentPuntoId || (first.puntos.find(p => !p.archivado) || first.puntos[0])?.id,
    } });
  };
  useEffect(() => { (async () => {
    if (navigator.onLine) db.syncPending().then(() => setPending(db.pendingCount())).catch(() => {});   // en segundo plano: no frena el arranque
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
        const [server, gs] = await Promise.all([db.loadSales(ev.id), db.loadGastos(ev.id).catch(() => null)]);
        const { sales } = mergePending([], server);
        baseDispatch({ type: "HYDRATE_SALES", sales: stateRef.current.sales.filter(s => s.eventId !== ev.id).concat(sales) });
        if (gs) baseDispatch({ type: "HYDRATE_GASTOS", gastos: (stateRef.current.gastos || []).filter(g => g.eventId !== ev.id).concat(mergeGastos(gs)) });
      } catch {} finally { busy = false; }
    };
    // Agrupa avisos: como mucho una recarga cada 2,5 s aunque vendan varias barras a la vez
    const unsub = db.subscribeEvento(ev.id, () => { if (!timer) timer = setTimeout(() => { timer = null; refresh(); }, 2500); });
    return () => { clearTimeout(timer); unsub(); };
  }, [ev.id]);

  // Multi-dispositivo: si otro equipo cambia productos, precios, barras o ajustes, este se actualiza solo
  useEffect(() => {
    let t = null;
    const unsub = db.subscribeConfig(() => { clearTimeout(t); t = setTimeout(() => { if (navigator.onLine) hydrate().catch(() => {}); }, 2500); });
    return () => { clearTimeout(t); unsub(); };
  }, []);

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
    const gs = (st.gastos || []).filter(g => g.eventId === e.id && !g.voided);
    const gsG = gs.filter(g => !isEntrada(g));
    const datos = { app: APP_VERSION, evento: e.name, total: { tickets: ok.length, facturacion: sum(ok), efectivo: sum(ok.filter(x => x.pago === "efectivo")), tarjeta: sum(ok.filter(x => x.pago === "tarjeta")), gastos: sumMov(gs, "gasto"), cambio_anadido: sumMov(gs, "entrada") }, gastos: gs.map(g => ({ tipo: isEntrada(g) ? "entrada" : "gasto", barra: e.puntos.find(p => p.id === g.puntoId)?.name || "", concepto: g.concepto, importe: g.importe, hora: new Date(g.ts).toISOString() })), puntos, pendientes_en_equipo: db.pendingCount() };
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
    if (testMode) { imprimirPrueba(product, qty); flash("🧪 Prueba (no cuenta)"); return; }
    // Venta avanzada: primero se cobra (efectivo/tarjeta + cambio), luego se imprime
    if (ev.advanced) { setPayFlow({ kind: "single", product, qty, total: round2(product.price * qty) }); return; }
    doSell(product, qty);
  };

  // Registra e imprime la venta (con datos de pago si vienen del cobro avanzado)
  const doSell = (product, qty = 1, pay = null, invite = false) => {
    const time = timeNow();
    const salePrice = invite ? 0 : product.price;                 // invitación: 0 € (no cuenta en caja)
    if (invite) pay = { pago: invPago(product.price) };
    const folios = nextFolios(ev.id, punto.id, prefijoDePunto(punto), qty);
    const clientUuids = folios.map(() => uid());
    const baseNum = evSales.length;
    const rows = folios.map((f, i) => ({ id: clientUuids[i], clientUuid: clientUuids[i], code: f, num: baseNum + i + 1, eventId: ev.id, puntoId: punto.id, productId: product.id, name: product.name, price: salePrice, ts: Date.now() + i, synced: online, voided: false, closureId: null, pago: pay?.pago || null, invite, inviteValue: invite ? product.price : 0, entregado: i === 0 ? (pay?.entregado ?? null) : null, cambio: i === 0 ? (pay?.cambio ?? null) : null }));
    baseDispatch({ type: "SELL", rows });
    if (product.print !== false) {
      if (qrDe(product) && qty > 1) setPrintJob({ kind: "multi", tickets: rows.map(r => ({ product, num: r.num, folio: r.code, qr: firmar(r.clientUuid, product) })), time, n: Date.now() });
      else setPrintJob({ kind: "ticket", product, time, num: rows[0].num, folio: rows[0].code, qty, qr: qrDe(product) ? firmar(rows[0].clientUuid, product) : null, n: Date.now() });
      flash(invite ? `🎁 Invitación · ${qty > 1 ? qty + "× " : ""}${product.name}` : `🖨️ ${qty > 1 ? qty + "× " : ""}${product.name}`);
    } else flash(invite ? `🎁 Invitación guardada · ${product.name} (sin ticket)` : `✅ Venta guardada · ${qty > 1 ? qty + "× " : ""}${product.name} (sin ticket)`);
    if (navigator.vibrate) navigator.vibrate(invite ? [20, 40, 20] : 25);
    db.vender({ eventoId: ev.id, puntoId: punto.id, producto: invite ? { ...product, price: 0 } : product, qty, operario: punto.name, folios, clientUuids, pago: pay?.pago || null, entregado: pay?.entregado ?? null, cambio: pay?.cambio ?? null }).then(r => { if (r.offline) setPending(db.pendingCount()); });
  };

  // Invitación: el ticket sale normal, la venta cuenta a 0 € y queda marcada como invitación
  const sellInvite = (product, qty = 1) => {
    if (!ev.id || !punto?.id) { flash("Sin datos del evento · conéctate a internet", "warn"); return; }
    if (product.soldOut) { flash("Producto agotado", "warn"); return; }
    if (ev.closed) { flash("Caja cerrada · no se puede vender", "warn"); return; }
    if (testMode) { imprimirPrueba(product, qty); flash("🧪 Prueba (no cuenta)"); return; }
    doSell(product, qty, null, true);
  };
  const sellComboInvite = (combo) => {
    if (!ev.id || !punto?.id) { flash("Sin datos del evento · conéctate a internet", "warn"); return; }
    if (ev.closed) { flash("Caja cerrada · no se puede vender", "warn"); return; }
    const vouchers = [];
    (combo.items || []).forEach(it => { const p = punto.products.find(x => x.id === it.productId); if (p) for (let k = 0; k < (it.qty || 1); k++) vouchers.push(p); });
    if (!vouchers.length) { flash("Bono sin productos válidos", "warn"); return; }
    if (testMode) { setPrintJob({ kind: "multi", tickets: vouchers.map((p, i) => ({ product: p, folio: "PRUEBA", qr: qrPrueba(p, i + 1) })), time: timeNow(), n: Date.now() }); flash("🧪 Prueba (no cuenta)"); return; }
    const value = round2((combo.price === "" || combo.price == null) ? vouchers.reduce((t, p) => t + p.price, 0) : Number(combo.price));
    doSellCombo(combo, vouchers, 0, { pago: invPago(value) }, value);
  };

  const reprint = () => { if (!printJob) { flash("Nada que reimprimir", "warn"); return; } setPrintJob({ ...printJob, n: Date.now() }); flash("🖨️ Reimprimiendo último ticket"); };

  const sellMany = (items) => {
    if (!ev.id || !punto?.id) { flash("Sin datos del evento · conéctate a internet", "warn"); return; }
    if (ev.closed) { flash("Caja cerrada · no se puede vender", "warn"); return; }
    const time = timeNow();
    if (testMode) {
      const tks = [];
      items.forEach(({ product, qty }) => { for (let i = 0; i < qty; i++) tks.push({ product, folio: "PRUEBA", qr: qrPrueba(product) }); });
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
      folios.forEach((f, i) => { n++; rows.push({ id: clientUuids[i], clientUuid: clientUuids[i], code: f, num: n, eventId: ev.id, puntoId: punto.id, productId: product.id, name: product.name, price: product.price, ts: Date.now() + rows.length, synced: online, voided: false, closureId: null, pago: pay?.pago || null, entregado: (first && i === 0) ? (pay?.entregado ?? null) : null, cambio: (first && i === 0) ? (pay?.cambio ?? null) : null }); tickets.push({ product, num: n, folio: f, qr: qrDe(product) ? firmar(clientUuids[i], product) : null }); });
      db.vender({ eventoId: ev.id, puntoId: punto.id, producto: product, qty, operario: punto.name, folios, clientUuids, pago: pay?.pago || null, entregado: first ? (pay?.entregado ?? null) : null, cambio: first ? (pay?.cambio ?? null) : null }).then(r => { if (r.offline) setPending(db.pendingCount()); });
      first = false;
    });
    if (!rows.length) return;
    baseDispatch({ type: "SELL", rows });
    const toPrint = tickets.filter(t => t.product.print !== false);
    if (toPrint.length) setPrintJob({ kind: "multi", tickets: toPrint, time, n: Date.now() });
    if (navigator.vibrate) navigator.vibrate(40);
    flash(toPrint.length ? `🖨️ ${toPrint.length} tickets · ${money(rows.reduce((t, r) => t + r.price, 0))}` : `✅ Venta guardada · ${money(rows.reduce((t, r) => t + r.price, 0))} (sin ticket)`);
  };

  const voidLast = async (by) => {
    if (testMode) { flash("🧪 Modo prueba: no hay ventas que anular", "warn"); return; }
    const last = evSales.filter(s => s.puntoId === punto.id && !s.voided && !s.closureId).sort((a, b) => b.ts - a.ts)[0];
    if (!last) { flash("No hay tickets que anular en este turno", "warn"); return; }
    baseDispatch({ type: "VOID_ONE", saleId: last.id, by });
    flash(`Anulado: ${last.name}`, "warn");
    const r = await db.anularVenta(last.clientUuid || last.id, by);
    if (r.offline) setPending(db.pendingCount());
  };
  const requestVoidCajero = () => { if (testMode) { flash("🧪 Modo prueba: no hay ventas que anular", "warn"); return; } if (ev.anularPin) setAskVoidPin(true); else voidLast(punto.name); };

  // Venta avanzada (cobro con efectivo/tarjeta y cambio). La elige cualquiera ANTES de vender;
  // en cuanto una barra inicia la venta (o hay ventas reales) queda fija para todo el evento,
  // porque cambiarla a mitad de noche descuadra el arqueo del cierre Z.
  const modoBloqueado = modoCobroBloqueado(ev, evSales);
  const setAdvanced = (on) => {
    if (modoBloqueado) { flash("La venta ya ha empezado: el modo de cobro no se puede cambiar", "warn"); return; }
    if (!!ev.advanced === !!on) return;
    dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: on ? { advanced: true, changeHelp: true } : { advanced: false } });
  };
  const [chooseMode, setChooseMode] = useState(false);
  const pedirIniciar = () => { if (!modoBloqueado) setChooseMode(true); else if (ev.pedirFondo !== false) setOpening(true); else iniciarVenta(null); };

  // Bono / oferta: registra UNA venta al precio del bono e imprime todos los vales de un clic
  const sellCombo = (combo) => {
    if (!ev.id || !punto?.id) { flash("Sin datos del evento · conéctate a internet", "warn"); return; }
    if (ev.closed) { flash("Caja cerrada · no se puede vender", "warn"); return; }
    const vouchers = [];
    (combo.items || []).forEach(it => { const p = punto.products.find(x => x.id === it.productId); if (p) for (let k = 0; k < (it.qty || 1); k++) vouchers.push(p); });
    if (!vouchers.length) { flash("Bono sin productos válidos", "warn"); return; }
    if (testMode) { setPrintJob({ kind: "multi", tickets: vouchers.map((p, i) => ({ product: p, folio: "PRUEBA", qr: qrPrueba(p, i + 1) })), time: timeNow(), n: Date.now() }); flash("🧪 Prueba (no cuenta)"); return; }
    const price = round2((combo.price === "" || combo.price == null) ? vouchers.reduce((t, p) => t + p.price, 0) : Number(combo.price));
    if (ev.advanced) { setPayFlow({ kind: "combo", combo, vouchers, total: price }); return; }
    doSellCombo(combo, vouchers, price);
  };

  const doSellCombo = (combo, vouchers, price, pay = null, inviteVal = null) => {
    const folio = nextFolios(ev.id, punto.id, prefijoDePunto(punto), 1)[0];
    const cu = uid();
    const saleRow = { id: cu, clientUuid: cu, code: folio, num: evSales.length + 1, eventId: ev.id, puntoId: punto.id, productId: null, name: combo.name, price, ts: Date.now(), synced: online, voided: false, closureId: null, pago: pay?.pago || null, invite: inviteVal != null, inviteValue: inviteVal || 0, entregado: pay?.entregado ?? null, cambio: pay?.cambio ?? null };
    baseDispatch({ type: "SELL", rows: [saleRow] });
    const tickets = vouchers.map((p, i) => ({ product: p, folio: `${folio}·${i + 1}`, qr: qrDe(p) ? firmar(cu, p, i + 1) : null })).filter(t => t.product.print !== false);
    if (tickets.length) setPrintJob({ kind: "multi", tickets, time: timeNow(), n: Date.now() });
    if (navigator.vibrate) navigator.vibrate(45);
    flash((inviteVal != null ? "🎁 Invitación · " : "") + (tickets.length ? `🎟️ ${combo.name} · ${tickets.length} tickets` : `✅ Venta guardada · ${combo.name} (sin ticket)`));
    db.vender({ eventoId: ev.id, puntoId: punto.id, producto: { id: null, name: combo.name, price }, qty: 1, operario: punto.name, folios: [folio], clientUuids: [cu], pago: pay?.pago || null, entregado: pay?.entregado ?? null, cambio: pay?.cambio ?? null }).then(r => { if (r.offline) setPending(db.pendingCount()); });
  };
  // ===== Reservados VIP =====
  const abrirCobroRes = (item, fijo = null) => {
    if (!ev.id || !punto?.id) { flash("Sin datos del evento · conéctate a internet", "warn"); return; }
    if (ev.closed) { flash("Caja cerrada · no se puede vender", "warn"); return; }
    if (!resCfg(ev).puntos.includes(punto.id)) { flash(`Los reservados no se cobran en ${punto.name}`, "warn"); return; }
    setResCobro({ item, fijo });
  };
  const notasRes = ({ item, reservado, precio, cobro }) => {
    const n = [];
    if (resCfg(ev).lineaTicket) n.push({ t: `RESERVADO ${reservado.nombre}`.toUpperCase(), b: true });
    if (cobro && cobro.senal > 0) { n.push({ t: `Total ${money(cobro.total)}` }); n.push({ t: `Señal pagada -${money(cobro.senal)}` }); n.push({ t: `Pagado ahora ${money(precio)}` }); }
    return n;
  };
  const cobrarRes = (d) => {
    setResCobro(null);
    const product = { id: d.item.id, name: d.item.nombre, price: d.precio };
    if (testMode) { setPrintJob({ kind: "ticket", product, time: timeNow(), num: null, folio: "PRUEBA", qty: 1, notas: notasRes(d), n: Date.now() }); flash("🧪 Prueba (no cuenta)"); return; }
    if (ev.advanced) { setPayFlow({ kind: "reservado", res: d, total: d.precio }); return; }
    doSellRes(d);
  };
  const doSellRes = (d, pay = null) => {
    const { item, reservado, precio, cobro } = d;
    const folio = nextFolios(ev.id, punto.id, prefijoDePunto(punto), 1)[0];
    const cu = uid();
    const saleRow = { id: cu, clientUuid: cu, code: folio, num: evSales.length + 1, eventId: ev.id, puntoId: punto.id, productId: null, name: item.nombre, price: precio, ts: Date.now(), synced: online, voided: false, closureId: null, pago: pay?.pago || null, invite: false, inviteValue: 0, entregado: pay?.entregado ?? null, cambio: pay?.cambio ?? null };
    baseDispatch({ type: "SELL", rows: [saleRow] });
    setPrintJob({ kind: "ticket", product: { id: item.id, name: item.nombre, price: precio }, time: timeNow(), num: saleRow.num, folio, qty: 1, notas: notasRes(d), n: Date.now() });
    if (navigator.vibrate) navigator.vibrate(45);
    flash(`⭐ ${item.nombre} · ${reservado.nombre}`);
    db.vender({ eventoId: ev.id, puntoId: punto.id, producto: { id: null, name: item.nombre, price: precio }, qty: 1, operario: punto.name, folios: [folio], clientUuids: [cu], pago: pay?.pago || null, entregado: pay?.entregado ?? null, cambio: pay?.cambio ?? null }).then(r => { if (r.offline) setPending(db.pendingCount()); });
    enlazarRes(d, cu);
  };
  // Quien compra está dentro: el reservado pasa a «Ha llegado» (con la tarifa queda apuntada) y la venta se suma a su cuenta
  const enlazarRes = ({ item, reservado, precio, cobro }, cu) => {
    const actual = res.reservados.find(x => x.id === reservado.id) || reservado;
    const tarifa = item.tipo === "tarifa";
    if (actual.estado !== "llegado" || (tarifa && actual.tarifaId !== item.id)) res.guardar({ ...actual, estado: "llegado", tarifaId: tarifa ? item.id : actual.tarifaId, llegadaEn: actual.llegadaEn || new Date().toISOString() });
    res.enlazar({ clientUuid: cu, reservadoId: reservado.id, tipo: tarifa ? "tarifa" : "extra", itemId: item.id, nombre: item.nombre, botellas: Number(item.botellas) || 0, total: tarifa ? cobro.total : precio, senal: tarifa ? cobro.senal : 0 }).then(r => { if (r?.offline) setPending(db.pendingCount()); });
  };
  // Venta de un socio desde el móvil: sin ticket, a la caja que elija, con efectivo/tarjeta y PIN de admin
  const venderSocio = (d) => {
    if (!ev.id) { flash("Sin datos del evento · conéctate a internet", "warn"); return; }
    if (ev.closed) { flash("Caja cerrada · no se puede vender", "warn"); return; }
    setResSocio(null);
    const { item, reservado, precio, metodo, caja, socio } = d;
    const folio = nextFolios(ev.id, caja.id, prefijoDePunto(caja), 1)[0];
    const cu = uid();
    const operario = "SOCIO:" + socio;
    const saleRow = { id: cu, clientUuid: cu, code: folio, num: evSales.length + 1, eventId: ev.id, puntoId: caja.id, productId: null, name: item.nombre, price: precio, ts: Date.now(), synced: online, voided: false, closureId: null, operario, pago: metodo, invite: false, inviteValue: 0, entregado: null, cambio: null };
    baseDispatch({ type: "SELL", rows: [saleRow] });
    if (navigator.vibrate) navigator.vibrate(45);
    flash(`💶 ${item.nombre} · ${reservado.nombre} · ${money(precio)} ${metodo} → ${caja.name}`);
    db.vender({ eventoId: ev.id, puntoId: caja.id, producto: { id: null, name: item.nombre, price: precio }, qty: 1, operario, folios: [folio], clientUuids: [cu], pago: metodo, entregado: null, cambio: null }).then(r => { if (r.offline) setPending(db.pendingCount()); });
    enlazarRes(d, cu);
  };
  const guardarCfgRes = (cfg) => dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: { style: { ...(ev.style || {}), reservados: cfg } } });
  const lineaRes = <LineaReservados ev={ev} punto={punto} res={res} testMode={testMode} isMobile={isMobile} onElegir={(it) => abrirCobroRes(it)} onVerMapa={() => { if (role === "cajero") setResMapa(true); else setView("reservados"); }} />;
  const vistaRes = (extra = {}) => <ReservadosVista ev={ev} punto={punto} role={role} res={res} sales={evSales} isMobile={isMobile} flash={flash} onGuardarCfg={guardarCfgRes} onCobrarTarifa={(t, r) => abrirCobroRes({ ...t, tipo: "tarifa" }, r.id)} onVentaSocio={(role === "admin" || role === "supervisor") ? (fijo) => setResSocio({ fijo }) : null} {...extra} />;

  const voidOne = async (sale, by) => { baseDispatch({ type: "VOID_ONE", saleId: sale.id, by }); const r = await db.anularVenta(sale.clientUuid || sale.id, by); if (r.offline) setPending(db.pendingCount()); };

  // ===== Gastos / retiradas de caja =====
  // Dinero que sale del cajón durante la noche. La facturación NO cambia; el cierre lo descuenta
  // de lo que debe haber (efectivo + datáfono) para que las cuentas cuadren.
  const [showGasto, setShowGasto] = useState(false);
  const [askGastoVoid, setAskGastoVoid] = useState(null);
  const registrarGasto = async (importe, concepto, tipo = "gasto") => {
    if (!ev.id || !punto?.id) { flash("Sin datos del evento · conéctate a internet", "warn"); return false; }
    const imp = round2(Number(importe) || 0);
    if (!(imp > 0) || imp >= 1000000) { flash("Escribe el importe del gasto", "warn"); return false; }
    const id = uid();
    const por = role === "cajero" ? punto.name : role === "admin" ? "Admin" : "Supervisor";
    const g = { id, tipo: tipo === "entrada" ? "entrada" : "gasto", eventId: ev.id, puntoId: punto.id, importe: imp, concepto: String(concepto || "").trim().slice(0, 120), por, ts: Date.now(), voided: false, closureId: null, synced: false };
    baseDispatch({ type: "ADD_GASTO", gasto: g });
    flash(`${g.tipo === "entrada" ? "➕ Cambio añadido" : "💸 Gasto registrado"} · ${money(imp)}${g.concepto ? " · " + g.concepto : ""}`);
    if (navigator.vibrate) navigator.vibrate(30);
    const r = await db.registrarGasto({ id, tipo: g.tipo, eventoId: ev.id, puntoId: punto.id, importe: imp, concepto: g.concepto, por });
    if (r.offline) setPending(db.pendingCount());
    return true;
  };
  const anularGasto = async (g) => {
    baseDispatch({ type: "VOID_GASTO", id: g.id });
    flash(`${isEntrada(g) ? "Entrada de cambio" : "Gasto"} anulado · ${money(g.importe)}`, "warn");
    const por = role === "cajero" ? punto.name : role === "admin" ? "Admin" : "Supervisor";
    const r = await db.anularGasto(g.id, ev.id, por);
    if (r.offline) setPending(db.pendingCount());
  };

  const cierreZ = async (puntoObj, contado = null) => {
    const allOpen = evSales.filter(s => s.puntoId === puntoObj.id && !s.voided && !s.closureId);
    const sales = allOpen.filter(s => !isInvite(s));
    const invs = invitaciones(allOpen);
    const voids = evSales.filter(s => s.puntoId === puntoObj.id && s.voided && !s.closureId).length;
    const gTurno = (stateRef.current.gastos || []).filter(g => g.eventId === ev.id && g.puntoId === puntoObj.id && !g.voided && !g.closureId);
    const gastos = sumMov(gTurno, "gasto"), entradas = sumMov(gTurno, "entrada");
    if (allOpen.length === 0 && voids === 0 && gTurno.length === 0 && puntoObj.estado !== "abierta") { flash("Sin ventas en el turno actual", "warn"); return; }
    const map = {};
    sales.forEach(s => { const k = s.productId || "n:" + s.name; map[k] = map[k] || { name: s.name, qty: 0, total: 0 }; map[k].qty++; map[k].total += s.price; });
    const revenue = round2(sales.reduce((t, s) => t + s.price, 0));
    const efectivo = round2(sales.filter(s => s.pago === "efectivo").reduce((t, s) => t + s.price, 0));
    const tarjeta = round2(sales.filter(s => s.pago === "tarjeta").reduce((t, s) => t + s.price, 0));
    const fondo = round2(puntoObj.fondo || 0);
    // Lo que debe haber: con venta avanzada, en el cajón; sin ella, cajón + datáfono
    const esperado = round2(fondo + (ev.advanced ? efectivo : revenue) + entradas - gastos);
    const descuadre = contado == null ? null : round2(contado - esperado);
    const socios = efectivoSocios(sales);
    const z = { socios, puntoName: puntoObj.name, lines: Object.values(map).map(l => ({ ...l, total: round2(l.total) })), revenue, efectivo, tarjeta, fondo, esperado, contado, descuadre, gastos, entradas, gastosList: gTurno.filter(g => !isEntrada(g)).map(g => ({ concepto: g.concepto, importe: g.importe })), entradasList: gTurno.filter(isEntrada).map(g => ({ concepto: g.concepto, importe: g.importe })), showArqueo: !!ev.advanced || ev.pedirFondo !== false || gastos > 0 || entradas > 0, advanced: !!ev.advanced, count: sales.length, voids, invites: invs.n, invitesValue: invs.valor, ts: Date.now() };
    const closureId = uid();
    // Cierra el turno EN LOCAL (funciona sin wifi) y encola el cierre para el servidor
    baseDispatch({ type: "ADD_CLOSURE", closure: { id: closureId, eventId: ev.id, puntoId: puntoObj.id, ...z } });
    baseDispatch({ type: "CLOSE_PUNTO_SALES", eventId: ev.id, puntoId: puntoObj.id, closureId });
    baseDispatch({ type: "UPDATE_PUNTO", eventId: ev.id, puntoId: puntoObj.id, patch: { fondo: null, estado: "cerrada", cerradaEn: new Date().toISOString(), cerradaPor: puntoObj.name } }); // venta cerrada
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
    const t = setTimeout(() => {
      // Seguridad: ningún ticket pasa de 68 mm de alto (cabe en el papel "TICKET" de 70 mm).
      // Si un nombre muy largo lo haría más alto, se reduce un poco para que no se parta en dos.
      try {
        const LIMIT = 68 * 96 / 25.4;
        document.querySelectorAll("#thermal-print-area .ticket-page:not(.z-page)").forEach(pg => {
          const inner = pg.firstElementChild; if (!inner) return;
          const qrSvg = inner.querySelector(".qr-row svg");
          inner.style.zoom = ""; if (qrSvg) qrSvg.style.zoom = "1";
          const h = inner.getBoundingClientRect().height;
          if (h <= LIMIT) return;
          if (!qrSvg) { inner.style.zoom = String(Math.max(0.6, LIMIT / h)); return; }
          // Con QR: se encoge el resto del ticket, NUNCA el QR (cada cuadradito cae en puntos exactos → se lee siempre)
          const qh = qrSvg.getBoundingClientRect().height;
          let z = Math.max(0.6, (LIMIT - qh) / Math.max(1, h - qh));
          for (let k = 0; k < 4; k++) {
            inner.style.zoom = String(z); qrSvg.style.zoom = String(1 / z);
            const hh = inner.getBoundingClientRect().height;
            if (hh <= LIMIT || z <= 0.6) break;
            z = Math.max(0.6, z * LIMIT / hh);
          }
        });
      } catch (e) {}
      try { window.print(); } catch (e) {}
    }, 60);
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
    setPrintJob({ kind: "ticket", product: demo, time: timeNow(), num: null, folio: "PRUEBA", qty: 1, qr: qrPrueba(demo), n: Date.now() });
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
  // Fondo de caja: se confirma al abrir cada barra (y tras cada cierre Z). Se puede desactivar en el evento.
  const [opening, setOpening] = useState(false);          // pantalla "Iniciar venta" (fondo del cajón)
  useEffect(() => { setOpening(false); }, [punto?.id]);
  const ultimoFondo = useMemo(() => { const c = state.closures.filter(x => x.puntoId === punto?.id && x.fondo != null).sort((a, b) => (a.ts || 0) - (b.ts || 0)); return c.length ? Number(c[c.length - 1].fondo) : null; }, [state.closures, punto?.id]);
  const quien = () => role === "cajero" ? punto.name : role === "admin" ? "Admin" : "Supervisor";
  // Iniciar la venta (una vez por barra): deja el modo prueba y guarda el fondo. Optimista y sin conexión.
  const iniciarVenta = async (amount = null) => {
    if (!ev.id || !punto?.id) return;
    if (ev.closed) { flash("Caja del evento cerrada", "warn"); return; }
    const fondo = amount == null ? null : round2(amount);
    const now = new Date().toISOString();
    baseDispatch({ type: "UPDATE_PUNTO", eventId: ev.id, puntoId: punto.id, patch: { estado: "abierta", fondo, fondoPor: quien(), abiertaEn: now, abiertaPor: quien() } });
    setOpening(false);
    if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
    const r = await db.abrirBarra(punto.id, ev.id, fondo, quien());
    if (r.offline) setPending(db.pendingCount());
    flash(`🟢 Venta iniciada en ${punto.name}${fondo != null ? ` · fondo ${money(fondo)}` : ""}`);
  };
  // Volver a modo prueba (solo admin): reabrir tras un Z o deshacer un inicio por error
  const pasarPrueba = async (puntoObj) => {
    baseDispatch({ type: "UPDATE_PUNTO", eventId: ev.id, puntoId: puntoObj.id, patch: { estado: "prueba", fondo: null } });
    const r = await db.pasarPrueba(puntoObj.id, ev.id, quien());
    if (r.offline) setPending(db.pendingCount());
    flash(`🧪 ${puntoObj.name} en modo prueba`, "warn");
  };

  // Quien ya entró como administrador ve la facturación sin volver a poner el PIN
  const verFacturacion = () => { if (role === "admin") setShowRevenue(true); else setAskRevenue(true); };
  const avisoPin = role === "admin" && pinsDeFabrica(ev) ? (
    <div role="alert" style={S.pinAviso}>
      <span style={{ flex: 1, minWidth: 0 }}><b>PIN de fábrica.</b> Este evento aún usa {estadoDe(ev, "admin").fabrica ? "1234 (admin)" : ""}{estadoDe(ev, "admin").fabrica && estadoDe(ev, "supervisor").fabrica ? " y " : ""}{estadoDe(ev, "supervisor").fabrica ? "0000 (supervisor)" : ""}. Cualquiera puede adivinarlo.</span>
      {view !== "config" && <button onClick={() => setView("config")} style={{ ...S.smallBtn, flexShrink: 0, background: "rgba(0,0,0,.2)", color: "inherit", borderColor: "rgba(0,0,0,.25)" }}>Cambiar ahora</button>}
    </div>
  ) : null;
  const exitToLogin = () => { setRole(null); setView("pos"); setAppMode("tpv"); };
  const inCRM = role === "admin" && appMode === "crm";
  const isPriv = role === "admin" || role === "supervisor";
  const allNav = [
    { id: "pos", label: "TPV", icon: "pos", roles: ["admin", "supervisor"] },
    { id: "template", label: "Plantilla", icon: "template", roles: ["admin"] },
    { id: "config", label: "Evento", icon: "config", roles: ["admin"] },
    { id: "reservados", label: "Reservados", icon: "vip", roles: ["admin", "supervisor"] },
    { id: "reports", label: "Informes", icon: "reports", roles: ["admin", "supervisor"] },
    { id: "history", label: "Histórico", icon: "history", roles: ["admin"] },
    { id: "crm", label: "CRM", icon: "crm", roles: ["admin"] },
  ];
  const navItems = allNav.filter(n => n.roles.includes(role));
  const safeView = navItems.find(n => n.id === view && n.id !== "crm") ? view : "pos";
  const goNav = (id) => { if (id === "crm") { setMenuOpen(false); setAppMode("crm"); } else setView(id); };

  const syncNow = async () => { const r = await db.syncPending(); setPending(db.pendingCount()); if (r.synced) { flash(`✅ ${r.synced} ventas sincronizadas`); await hydrate().catch(() => {}); } else flash(pending ? "Aún sin conexión" : "Todo sincronizado"); };
  const OnlinePill = ({ small }) => (
    <button onClick={syncNow} style={{ ...S.printerStatusSm, borderColor: !online ? "rgba(255,77,77,.5)" : pending || fromCache ? "rgba(255,180,0,.5)" : "var(--line)", color: !online ? "var(--red)" : pending || fromCache ? "var(--amber)" : "var(--text)", fontWeight: pending ? 800 : 700 }} title="Conexión (offline-first) · toca para sincronizar">
      <span style={{ ...S.stDot, background: online ? (pending || fromCache ? "var(--amber)" : "var(--green)") : "var(--red)", boxShadow: `0 0 0 3px ${online ? (pending || fromCache ? "rgba(255,180,0,.18)" : "rgba(34,211,166,.18)") : "rgba(255,77,77,.18)"}` }} />
      {online ? (pending ? `⏳ ${pending} sin subir` : fromCache ? "Datos guardados" : "En línea") : `Sin conexión · ${pending}`}
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
        <RoleGate ev={ev} events={state.events} online={online} pending={pending}
          onSelectEvent={id => dispatch({ type: "SELECT_EVENT", id })}
          onRole={(r, puntoId, modo) => { if (puntoId) dispatch({ type: "SET_PUNTO", id: puntoId }); setRole(r); setView("pos"); const crmMode = modo === "crm" && r === "admin"; setAppMode(crmMode ? "crm" : "tpv");  }} />
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
            <button onClick={syncNow} aria-label={online ? (pending ? `${pending} operaciones sin subir` : "En línea") : "Sin conexión"} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "none", padding: "6px 2px", color: !online ? "var(--red)" : pending || fromCache ? "var(--amber)" : "var(--muted)", fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
              <span style={{ ...S.stDot, background: online ? (pending || fromCache ? "var(--amber)" : "var(--green)") : "var(--red)", boxShadow: `0 0 0 4px ${online ? (pending || fromCache ? "rgba(255,180,0,.16)" : "rgba(34,211,166,.16)") : "rgba(255,77,77,.16)"}` }} />
              {!online ? "Sin conexión" : pending ? `${pending} sin subir` : fromCache ? "Datos guardados" : null}
            </button>
            <button onClick={() => setMenuOpen(true)} style={S.iconBtn} aria-label="Menú"><Ic n="menu" /></button>
          </header>
          <div style={{ padding: 12, flex: 1, overflow: "auto", WebkitOverflowScrolling: "touch" }}>
            <POS punto={punto} totals={totals} rankCounts={rankCounts} onReorder={reorderProducts} onSetSortMode={setPuntoSortMode} onSell={sell} onInvite={sellInvite} onComboInvite={sellComboInvite} onSellMany={sellMany} onVoid={() => requestVoidCajero()} onReprint={reprint} canReprint={!!printJob} onCombo={sellCombo} extra={lineaRes} testMode={testMode} closed={ev.closed} advanced={!!ev.advanced} canArrange={isPriv} onGasto={() => { if (testMode) { flash("🧪 Inicia la venta para usar la caja", "warn"); return; } setShowGasto(true); }} onIniciar={pedirIniciar} gastoTotal={sumMov(turnoMovs, "gasto")} entradaTotal={sumMov(turnoMovs, "entrada")} fondo={punto.fondo} />
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
            <POS punto={punto} totals={totals} rankCounts={rankCounts} onReorder={reorderProducts} onSetSortMode={setPuntoSortMode} onSell={sell} onInvite={sellInvite} onComboInvite={sellComboInvite} onSellMany={sellMany} onVoid={() => requestVoidCajero()} onReprint={reprint} canReprint={!!printJob} onCombo={sellCombo} extra={lineaRes} testMode={testMode} closed={ev.closed} advanced={!!ev.advanced} canArrange={isPriv} onGasto={() => { if (testMode) { flash("🧪 Inicia la venta para usar la caja", "warn"); return; } setShowGasto(true); }} onIniciar={pedirIniciar} gastoTotal={sumMov(turnoMovs, "gasto")} entradaTotal={sumMov(turnoMovs, "entrada")} fondo={punto.fondo} />
          </div>
        </div>
      ))}

      {/* ===== VALIDADOR DE TICKETS CON QR (un móvil por barra) ===== */}
      {role === "validador" && (
        <Suspense fallback={<div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--muted)" }}>Abriendo el validador…</div>}>
          <Validador ev={ev} punto={punto} events={state.events} sales={evSales} onExit={exitToLogin} />
        </Suspense>
      )}

      {/* ===== CRM (solo admin) ===== */}
      {inCRM && (
        <Suspense fallback={<div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--muted)" }}>Abriendo el CRM…</div>}>
          <CRM events={state.events} sales={state.sales} gastosCaja={state.gastos || []} ev={ev} onSelectEvent={(id) => dispatch({ type: "SELECT_EVENT", id })} onExit={() => setAppMode("tpv")} flash={flash} />
        </Suspense>
      )}

      {/* ===== ADMIN / SUPERVISOR ===== */}
      {isPriv && !inCRM && (isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <header style={S.mTop}>
            <img src="/brand/tixfast_isotipo_app.svg" alt="TIXFAST" width="32" height="32" style={{ flexShrink: 0, display: "block" }} />
            <select value={ev.id} onChange={e => dispatch({ type: "SELECT_EVENT", id: e.target.value })} style={{ ...S.select, ...S.mSelect, flex: 1, minWidth: 0 }}>{state.events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
            <button onClick={() => setMenuOpen(true)} style={S.iconBtn} aria-label="Menú"><Ic n="menu" /></button>
          </header>
          <div style={{ padding: 12, flex: 1, overflow: "auto", WebkitOverflowScrolling: "touch" }}>
            {avisoPin}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: "10px 12px 10px 14px" }}>
              <div style={{ minWidth: 0 }}><div style={S.miniLabel}>Barra activa</div><div style={{ fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: 6 }}><span style={{ color: "var(--accent)" }}><Ic n="store" s={14} w={2.2} /></span>{punto.name}</div></div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                <div style={{ textAlign: "right" }}><div style={S.miniLabel}>Tickets</div><div style={{ fontWeight: 800, fontSize: 18, lineHeight: 1.1 }}>{totals.count}</div></div>
                <button onClick={verFacturacion} style={{ ...S.iconBtn, color: "var(--accent)" }} aria-label="Consultar facturación"><Ic n="euro" /></button>
              </div>
            </div>
            {safeView === "pos" && <POS punto={punto} totals={totals} rankCounts={rankCounts} onReorder={reorderProducts} onSetSortMode={setPuntoSortMode} onSell={sell} onInvite={sellInvite} onComboInvite={sellComboInvite} onSellMany={sellMany} onVoid={() => voidLast(role)} onReprint={reprint} canReprint={!!printJob} onCombo={sellCombo} extra={lineaRes} testMode={testMode} closed={ev.closed} advanced={!!ev.advanced} canArrange={isPriv} onGasto={() => { if (testMode) { flash("🧪 Inicia la venta para usar la caja", "warn"); return; } setShowGasto(true); }} onIniciar={pedirIniciar} gastoTotal={sumMov(turnoMovs, "gasto")} entradaTotal={sumMov(turnoMovs, "entrada")} fondo={punto.fondo} />}
            {safeView === "reservados" && vistaRes()}
            {safeView === "template" && <TemplateDesigner ev={ev} dispatch={dispatch} flash={flash} />}
            {safeView === "config" && <EventConfig state={state} ev={ev} punto={punto} evSales={evSales} role={role} onReset={resetStats} dispatch={dispatch} flash={flash} />}
            {safeView === "history" && <Historico state={state} flash={flash} onOpenEvent={(id) => { dispatch({ type: "SELECT_EVENT", id }); setView("pos"); }} />}
            {safeView === "reports" && <InformeReservados ev={ev} res={res} sales={evSales} isMobile={isMobile} />}
            {safeView === "reports" && <Reports ev={ev} evSales={evSales} evGastos={evGastos} onVoidGasto={anularGasto} onPasarPrueba={pasarPrueba} role={role} onVoid={(sale) => voidOne(sale, role)} onCierreZ={cierreZ} flash={flash} onBackup={() => makeBackup(true)} lastBackup={lastBackup} onImported={async () => { setPending(db.pendingCount()); if (navigator.onLine) { await db.syncPending(); setPending(db.pendingCount()); await hydrate().catch(() => {}); } }} />}
          </div>
          <nav style={S.bottomNav}>
            {navItems.map(n => <button key={n.id} aria-current={safeView === n.id ? "page" : undefined} onClick={() => goNav(n.id)} style={{ ...S.bTab, ...(safeView === n.id ? S.bTabActive : {}) }}>
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
              {navItems.map(n => <button key={n.id} onClick={() => goNav(n.id)} className="nav-btn" style={{ ...S.navBtn, ...(safeView === n.id ? S.navActive : {}) }}><span style={{ color: safeView === n.id ? "var(--accent)" : "var(--muted)", display: "flex" }}><Ic n={n.icon} /></span>{n.label}</button>)}
            </nav>
            <div style={{ marginTop: "auto", paddingTop: 16 }}>
              <div style={S.sideLabel}>Punto de venta activo</div>
              <select value={punto.id} onChange={e => dispatch({ type: "SET_PUNTO", id: e.target.value })} style={{ ...S.select, fontSize: 13 }}>{activePuntos.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <div style={{ display: "flex", gap: 6, margin: "10px 0 12px" }}><OnlinePill /><PrinterPill /></div>
              <div style={S.sideDivider} />
              <MenuRow icon="printer" label="Ticket de prueba" onClick={testPrint} />
              <MenuRow icon="swap" label="Cambiar de rol" onClick={exitToLogin} />
              <MenuRow icon="logout" label="Cerrar sesión" onClick={() => logout()} tone="danger" />
            </div>
          </aside>
          <main style={S.main}>
            <header style={S.top}>
              <div style={{ minWidth: 0 }}><div style={S.topTitle}>{ev.name}</div><div style={S.topSub}><span style={S.barTag}><Ic n="store" s={12} w={2.2} />{punto.name}</span>{dateFmt(ev.date)}{ev.venue ? ` · ${ev.venue}` : ""}</div></div>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <Stat label={`Tickets · ${punto.name}`} value={totals.count} accent="var(--text)" />
                <button onClick={verFacturacion} style={S.topBtn}><span style={{ color: "var(--accent)", display: "flex" }}><Ic n="euro" s={17} /></span>Consultar facturación</button>
              </div>
            </header>
            <div style={{ padding: 22, flex: 1, overflow: "auto" }}>
              {avisoPin}
              {safeView === "pos" && <POS punto={punto} totals={totals} rankCounts={rankCounts} onReorder={reorderProducts} onSetSortMode={setPuntoSortMode} onSell={sell} onInvite={sellInvite} onComboInvite={sellComboInvite} onSellMany={sellMany} onVoid={() => voidLast(role)} onReprint={reprint} canReprint={!!printJob} onCombo={sellCombo} extra={lineaRes} testMode={testMode} closed={ev.closed} advanced={!!ev.advanced} canArrange={isPriv} onGasto={() => { if (testMode) { flash("🧪 Inicia la venta para usar la caja", "warn"); return; } setShowGasto(true); }} onIniciar={pedirIniciar} gastoTotal={sumMov(turnoMovs, "gasto")} entradaTotal={sumMov(turnoMovs, "entrada")} fondo={punto.fondo} />}
              {safeView === "reservados" && vistaRes()}
            {safeView === "template" && <TemplateDesigner ev={ev} dispatch={dispatch} flash={flash} />}
              {safeView === "config" && <EventConfig state={state} ev={ev} punto={punto} evSales={evSales} role={role} onReset={resetStats} dispatch={dispatch} flash={flash} />}
              {safeView === "history" && <Historico state={state} flash={flash} onOpenEvent={(id) => { dispatch({ type: "SELECT_EVENT", id }); setView("pos"); }} />}
            {safeView === "reports" && <InformeReservados ev={ev} res={res} sales={evSales} isMobile={isMobile} />}
            {safeView === "reports" && <Reports ev={ev} evSales={evSales} evGastos={evGastos} onVoidGasto={anularGasto} onPasarPrueba={pasarPrueba} role={role} onVoid={(sale) => voidOne(sale, role)} onCierreZ={cierreZ} flash={flash} onBackup={() => makeBackup(true)} lastBackup={lastBackup} onImported={async () => { setPending(db.pendingCount()); if (navigator.onLine) { await db.syncPending(); setPending(db.pendingCount()); await hydrate().catch(() => {}); } }} />}
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
              <MenuRow big icon="printer" label="Ticket de prueba" onClick={() => { setMenuOpen(false); testPrint(); }} right={<span style={{ color: "var(--muted)" }}><Ic n="chev" s={16} /></span>} />
              <MenuRow big icon="refresh" label="Buscar actualización" onClick={async () => { if (!navigator.onLine || !(await fetch("/manifest.webmanifest", { cache: "no-store" }).then(r => r.ok).catch(() => false))) { flash("Sin internet: no se puede actualizar ahora (la app sigue funcionando)", "warn"); return; } try { const rs = await navigator.serviceWorker?.getRegistrations?.() || []; for (const r of rs) await r.unregister(); const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); } catch {} window.location.reload(true); }} right={<span style={{ color: "var(--muted)" }}><Ic n="chev" s={16} /></span>} />
            </div>
            <div className="menu-group" style={{ ...S.menuGroup, marginTop: 10 }}>
              <MenuRow big icon="swap" label="Cambiar de rol" onClick={() => { setMenuOpen(false); exitToLogin(); }} right={<span style={{ color: "var(--muted)" }}><Ic n="chev" s={16} /></span>} />
              <MenuRow big icon="logout" label="Cerrar sesión" onClick={() => { setMenuOpen(false); logout(); }} tone="danger" />
            </div>
            <div style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", marginTop: 14 }}>TIXFAST · versión {APP_VERSION}</div>
          </div>
        </div>
      )}

      {/* ===== Modo de cobro (se decide antes de la primera venta) ===== */}
      {chooseMode && (
        <ModoCobroGate advanced={!!ev.advanced} puntoName={punto.name} onBack={() => setChooseMode(false)}
          onChoose={(adv) => { setChooseMode(false); setAdvanced(adv); if (ev.pedirFondo !== false) setOpening(true); else iniciarVenta(null); }} />
      )}

      {/* ===== Fondo de caja (bloquea la venta hasta declararlo) ===== */}
      {opening && (
        <FondoGate key={punto.id} puntoName={punto.name} previsto={punto.fondoPrevisto} ultimo={ultimoFondo} onSave={iniciarVenta} onBack={() => setOpening(false)} pending={!online} />
      )}

      {/* ===== Gasto de caja ===== */}
      {showGasto && <CajaModal puntoName={punto.name} movs={turnoMovs} fondo={punto.fondo} onSave={registrarGasto} onClose={() => setShowGasto(false)}
        onVoid={(g) => { if (role === "cajero") setAskGastoVoid(g); else anularGasto(g); }} />}
      {askGastoVoid && <PinModal secreto={secretoDe(ev, "supervisor")} onClose={() => setAskGastoVoid(null)} onOk={() => { const g = askGastoVoid; setAskGastoVoid(null); anularGasto(g); }} label="PIN de supervisor para anular el movimiento" />}

      {/* ===== Reservados VIP: cobro y mapa ===== */}
      {resCobro && <CobrarReservado ev={ev} item={resCobro.item} res={res} sales={evSales} fijo={resCobro.fijo} onCobrar={cobrarRes} onClose={() => setResCobro(null)} />}
      {resSocio && <VentaSocio ev={ev} res={res} sales={evSales} fijo={resSocio.fijo} defCaja={punto.id} onVender={venderSocio} onClose={() => setResSocio(null)} />}
      {resMapa && role && (
        <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "var(--bg)", overflow: "auto", padding: "calc(14px + env(safe-area-inset-top)) 14px calc(18px + env(safe-area-inset-bottom))" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>{vistaRes({ onCerrar: () => setResMapa(false) })}</div>
        </div>
      )}

      {/* ===== Cobro avanzado ===== */}
      {payFlow && (
        <PayFlow
          total={payFlow.total}
          lines={payFlow.kind === "single" ? [{ qty: payFlow.qty, name: payFlow.product.name, total: round2(payFlow.product.price * payFlow.qty) }]
            : payFlow.kind === "many" ? payFlow.items.map(it => ({ qty: it.qty, name: it.product.name, total: round2(it.product.price * it.qty) }))
            : payFlow.kind === "reservado" ? [{ qty: 1, name: `${payFlow.res.item.nombre} · ${payFlow.res.reservado.nombre}`, total: payFlow.total }]
            : [{ qty: 1, name: payFlow.combo.name, total: payFlow.total }]}
          changeHelp={ev.changeHelp !== false}
          onCancel={() => setPayFlow(null)}
          onDisableHelp={(on = false) => { dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: { changeHelp: !!on } }); flash(on ? "Ayuda con el cambio activada" : "Ayuda con el cambio desactivada"); }}
          onDone={(pay) => {
            const f = payFlow; setPayFlow(null);
            if (f.kind === "single") doSell(f.product, f.qty, pay);
            else if (f.kind === "many") doSellMany(f.items, pay);
            else if (f.kind === "combo") doSellCombo(f.combo, f.vouchers, f.total, pay);
            else if (f.kind === "reservado") doSellRes(f.res, pay);
          }}
        />
      )}

      {/* ===== Zona de impresión oculta (fuera de pantalla; en impresión se coloca en 0,0) ===== */}
      {createPortal(<div id="thermal-print-area" aria-hidden style={{ position: "absolute", left: -9999, top: 0 }}>
        {printJob?.kind === "ticket" && <div className="ticket-page"><ThermalTicket ev={ev} product={printJob.product} time={printJob.time} num={printJob.num} qty={printJob.qty} folio={printJob.folio} qr={printJob.qr} notas={printJob.notas} /></div>}
        {printJob?.kind === "z" && <div className="ticket-page z-page"><ZTicket ev={ev} z={printJob.z} /></div>}
        {printJob?.kind === "multi" && printJob.tickets.map((t, i) => (
          <div key={i} className="ticket-page">
            <ThermalTicket ev={ev} product={t.product} time={printJob.time} num={t.num} folio={t.folio} qr={t.qr} />
          </div>
        ))}
      </div>, document.body)}

      {/* ===== Facturación (PIN -> total) ===== */}
      {askRevenue && <PinModal secreto={secretoDe(ev, "admin")} onClose={() => setAskRevenue(false)} onOk={() => { setAskRevenue(false); setShowRevenue(true); }} />}
      {askVoidPin && <PinModal secreto={secretoDe(ev, "supervisor")} onClose={() => setAskVoidPin(false)} onOk={() => { setAskVoidPin(false); voidLast(punto.name); }} label="PIN de supervisor para anular" />}
      {showRevenue && (
        <div style={isMobile ? S.sheetWrap : S.overlay} onClick={() => setShowRevenue(false)}>
          <div className={isMobile ? "sheet-anim" : ""} style={isMobile ? S.sheet : { ...S.pinCard, textAlign: "center", width: 330 }} onClick={e => e.stopPropagation()}>
            {isMobile && <div style={S.grab} />}
            <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>Facturación total · {ev.name}</div>
            <div style={{ fontSize: 44, fontWeight: 800, color: "var(--green)", margin: "12px 0" }}>{money(eventRevenue)}</div>
            <div style={{ textAlign: "left", borderTop: "1px solid var(--line)", paddingTop: 12, marginBottom: 14 }}>
              {ev.puntos.map(p => { const r = evSales.filter(s => s.puntoId === p.id && !s.voided).reduce((t, s) => t + s.price, 0); return <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}><span style={{ color: "var(--muted)" }}>{p.name}</span><b>{money(r)}</b></div>; })}
              {(() => { const gt = sumMov(evGastos, "gasto"); return gt > 0 ? (<>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "8px 0 4px", marginTop: 6, borderTop: "1px solid var(--line)" }}><span style={{ color: "var(--amber)" }}>💸 Gastos de caja</span><b style={{ color: "var(--amber)" }}>-{money(gt)}</b></div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "4px 0" }}><span>A cuadrar (efectivo + datáfono)</span><b>{money(round2(eventRevenue - gt))}</b></div>
                {ev.advanced && <div style={{ fontSize: 12, color: "var(--muted)" }}>Sin contar el fondo inicial de los cajones.</div>}
              </>) : null; })()}
            </div>
            <button style={S.btnGhost} onClick={() => setShowRevenue(false)}>Cerrar</button>
          </div>
        </div>
      )}

      {updateReady && (
        <div style={S.updateBar} role="status">
          <span style={{ fontSize: 18 }}>✨</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.3 }}><b>Versión nueva lista.</b> Actualiza cuando no haya cola (las ventas no se pierden).</span>
          <button onClick={() => window.location.reload()} style={S.updateBtn}>Actualizar</button>
          <button onClick={() => setUpdateReady(false)} style={S.updateX} aria-label="Más tarde">✕</button>
        </div>
      )}
      {toast && <div role={toast.kind === "warn" ? "alert" : "status"} onClick={() => setToast(null)} style={{ ...S.toast, cursor: toast.kind === "warn" ? "pointer" : "default", background: toast.kind === "warn" ? "var(--amber)" : "var(--green)", ...(isMobile && (isPriv || role === "cajero") ? { bottom: "calc(84px + env(safe-area-inset-bottom))" } : {}) }}>{toast.msg}{toast.kind === "warn" && <span style={{ display: "block", fontSize: 12, fontWeight: 700, opacity: .75, marginTop: 2 }}>Toca para cerrar</span>}</div>}
    </div>
  );
}

/* ---------------------- Invitaciones ----------------------
   Se registran como venta a 0 € (no cambian facturación ni caja) con metodo_pago = "invitacion:<valor>".
   El ticket impreso es el normal del producto; la invitación es solo para vuestro control. */
const isInvite = (s) => !!(s && (s.invite || /^invitacion/.test(s.pago || "")));
const inviteValue = (s) => s.inviteValue != null && s.invite ? s.inviteValue : (Number(String(s.pago || "").split(":")[1]) || 0);
const invPago = (v) => "invitacion:" + round2(v || 0).toFixed(2);
function invitaciones(sales) {
  const by = {}, byP = {}; let n = 0, valor = 0;
  sales.forEach(s => {
    if (s.voided || !isInvite(s)) return;
    const v = inviteValue(s); n++; valor += v;
    const k = s.name; const g = by[k] || (by[k] = { name: k, uds: 0, valor: 0 }); g.uds++; g.valor += v;
    byP[s.puntoId] = byP[s.puntoId] || { uds: 0, valor: 0 }; byP[s.puntoId].uds++; byP[s.puntoId].valor += v;
  });
  return { n, valor: round2(valor), list: Object.values(by).map(g => ({ ...g, valor: round2(g.valor) })).sort((a, b) => b.uds - a.uds), byPunto: byP };
}

/* ---------------------- Comisiones de proveedores (solo liquidaciones) ----------------------
   Se guardan en el ajuste del evento: style.comisiones[productId] = [{ desde, proveedor, pct }]
   Cada cambio añade una entrada con su fecha, así cada venta usa el % que había cuando se vendió.
   NO cambia precios, tickets, facturación ni cierres. */
function comisionActual(ev, productId) {
  const l = (ev.style?.comisiones || {})[productId]; return l && l.length ? l[l.length - 1] : null;
}
function comisionEnFecha(ev, productId, ts) {
  const l = (ev.style?.comisiones || {})[productId]; if (!l || !l.length) return null;
  let e = null; for (const x of l) { if ((x.desde || 0) <= ts) e = x; else break; }
  return e && e.proveedor && e.pct != null ? e : null;
}
function liquidacion(ev, sales) {
  const prov = {};
  sales.forEach(s => {
    if (s.voided || !s.productId || isInvite(s)) return;
    const e = comisionEnFecha(ev, s.productId, s.ts || 0); if (!e) return;
    const k = e.proveedor;
    const g = prov[k] || (prov[k] = { proveedor: k, vendido: 0, comision: 0, uds: 0, lineas: {} });
    const c = s.price * e.pct / 100;
    g.vendido += s.price; g.comision += c; g.uds++;
    const lk = s.name + "|" + e.pct;
    const L = g.lineas[lk] || (g.lineas[lk] = { name: s.name, pct: e.pct, uds: 0, vendido: 0, comision: 0 });
    L.uds++; L.vendido += s.price; L.comision += c;
  });
  const list = Object.values(prov).map(g => ({ ...g, vendido: round2(g.vendido), comision: round2(g.comision), pagar: round2(g.vendido - g.comision), lineas: Object.values(g.lineas).map(l => ({ ...l, vendido: round2(l.vendido), comision: round2(l.comision), pagar: round2(l.vendido - l.comision) })) })).sort((a, b) => b.vendido - a.vendido);
  const tot = list.reduce((t, g) => ({ vendido: t.vendido + g.vendido, comision: t.comision + g.comision, pagar: t.pagar + g.pagar }), { vendido: 0, comision: 0, pagar: 0 });
  return { list, vendido: round2(tot.vendido), comision: round2(tot.comision), pagar: round2(tot.pagar) };
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
  vip: "M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z",
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
  history: "M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2",
  crm: "M4 8h16v11H4zM9 8V5h6v3M4 13h16M11 12v2h2v-2",
  grip: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  up: "M6 15l6-6 6 6",
  down: "M6 9l6 6 6-6",
  scan: "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 8h3v3H8zM13 13h3v3h-3zM13 8h3M8 13v3",
  gift: "M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-1.5-3.5-5.5-3.5-5.5-1S12 7 12 7zm0 0c1.5-3.5 5.5-3.5 5.5-1S12 7 12 7z",
  list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  cash: "M3 7h18v10H3zM12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4M6.5 12h.01M17.5 12h.01",
  undo: "M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  alert: "M12 4l9 16H3zM12 10v4M12 17h.01",
  download: "M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  image: "M4 5h16v14H4zM8.5 10a1.5 1.5 0 1 0 0-3a1.5 1.5 0 1 0 0 3M20 15l-5-5-9 9",
  plus: "M12 5v14M5 12h14",
  users: "M9 11a3.5 3.5 0 1 0 0-7a3.5 3.5 0 1 0 0 7M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 13.5a6.5 6.5 0 0 1 3.5 6.5",
  edit: "M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4",
  qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18h2v2M18 18h2v2h-2",
};
const II = { display: "inline-block", verticalAlign: "-3px", marginRight: 6 };   // icono en línea con texto
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
function RoleGate({ ev, events, onSelectEvent, onRole, online = true, pending = 0 }) {
  const isMobile = useIsMobile();
  const [mode, setMode] = useState(null);            // null | cajero | validador | admin | supervisor | crm
  const [verEventos, setVerEventos] = useState(false);
  const puntos = ev.puntos.filter(p => !p.archivado);
  const claveUltima = "tixfast_ultima_barra_" + ev.id;
  const ultima = (() => { try { return localStorage.getItem(claveUltima); } catch { return null; } })();
  const entrarBarra = (m, id) => { try { localStorage.setItem(claveUltima, id); } catch {} onRole(m, id); };
  useEffect(() => { setMode(null); }, [ev.id]);
  const abiertas = puntos.filter(p => p.estado === "abierta").length;
  const fechaEv = (() => { try { return new Date((ev.startsAt || ev.date + "T12:00")).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }); } catch { return ev.date; } })();
  const horaEv = ev.startsAt && ev.startsAt.length > 10 ? ev.startsAt.slice(11, 16) : "";
  const roles = [
    { k: "supervisor", icon: "eye", t: "Supervisor", d: "Informes, cierres y anulaciones", pin: true },
    { k: "admin", icon: "shield", t: "Administrador", d: "Configura el evento", pin: true },
    { k: "crm", icon: "crm", t: "CRM", d: "Entradas, cuentas y socios", pin: true },
    ...(ev.qrActivo || ev.qrClave ? [{ k: "validador", icon: "scan", t: "Validar QR", d: "Escanea al servir" }] : []),
  ];
  const estadoBarra = (p) => p.estado === "abierta" ? ["Abierta", "var(--green)"] : p.estado === "cerrada" ? ["Cerrada (Z hecho)", "var(--red)"] : ["En pruebas", "var(--amber)"];
  const hoy = new Date().toISOString().slice(0, 10);
  const evOrden = [...events].sort((a, b) => { const fa = a.date < hoy, fb = b.date < hoy; if (fa !== fb) return fa ? 1 : -1; return fa ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date); });
  const proximo = evOrden.find(e => e.date >= hoy)?.id;

  return (
    <div className="tg" role="main">
      <style>{TG_CSS}</style>
      <div className="tg-luz" aria-hidden="true"><span /><span /></div>
      <header className="tg-top">
        <img src="/brand/tixfast_logo_horizontal_oscuro.svg" alt="TIXFAST" style={{ height: isMobile ? 26 : 30, width: "auto", display: "block" }} />
        <span className="tg-pill" style={{ color: online ? "var(--green)" : "var(--amber)" }} aria-live="polite">
          <span className="tg-dot" style={{ background: online ? "var(--green)" : "var(--amber)" }} />{online ? (pending ? `En línea · ${pending} por subir` : "En línea") : `Sin conexión${pending ? ` · ${pending} en cola` : ""}`}
        </span>
      </header>

      <div className="tg-main">
        <section className="tg-izq">
          <div className="tg-eyebrow">{mode === "cajero" || mode === "validador" ? "Paso 2 de 2" : "Bienvenido"}</div>
          <h1 className="tg-h1">{mode === "cajero" ? "¿En qué barra trabajas?" : mode === "validador" ? "¿En qué barra validas?" : "¿Quién entra hoy?"}</h1>
          <button type="button" className="tg-evento" onClick={() => setVerEventos(true)} aria-label={`Evento: ${ev.name}. Cambiar de evento`}>
            <span className="tg-ev-ico" aria-hidden="true">{ev.logo ? <img src={ev.logo} alt="" /> : <Ic n="store" s={22} />}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="tg-ev-label">Evento</span>
              <span className="tg-ev-nombre">{ev.name}</span>
              <span className="tg-ev-meta">{cap1(fechaEv)}{horaEv ? ` · ${horaEv}` : ""}{ev.venue ? ` · ${ev.venue}` : ""}</span>
            </span>
            {events.length > 1 && <span className="tg-cambiar">Cambiar<Ic n="chev" s={14} /></span>}
          </button>
          <div className="tg-datos">
            <span><b>{puntos.length}</b> {puntos.length === 1 ? "barra" : "barras"}</span>
            <span><b style={{ color: abiertas ? "var(--green)" : "var(--muted)" }}>{abiertas}</b> abiertas</span>
            {ev.qrActivo && <span><Ic n="qr" s={14} /> QR activo</span>}
          </div>
        </section>

        <section className="tg-der" aria-label="Elige cómo entrar">
          {(mode === null || mode === "admin" || mode === "supervisor" || mode === "crm") && (<>
            <button type="button" className="tg-cajero" onClick={() => puntos.length === 1 ? entrarBarra("cajero", puntos[0].id) : setMode("cajero")}>
              <span className="tg-cajero-ico" aria-hidden="true"><Ic n="receipt" s={28} w={2.1} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="tg-cajero-t">Vender</span>
                <span className="tg-cajero-d">Cajero · TPV e impresión de tickets</span>
              </span>
              <span className="tg-flecha" aria-hidden="true"><Ic n="chev" s={20} w={2.4} /></span>
            </button>
            <div className="tg-roles">
              {roles.map(r => (
                <button type="button" key={r.k} className="tg-rol" onClick={() => setMode(r.k)}>
                  <span className="tg-rol-ico" aria-hidden="true"><Ic n={r.icon} s={22} /></span>
                  <span className="tg-rol-t">{r.t}</span>
                  <span className="tg-rol-d">{r.d}</span>
                  {r.pin && <span className="tg-pin" title="Pide PIN o contraseña"><Ic n="lock" s={12} w={2.2} />PIN</span>}
                </button>))}
            </div>
          </>)}

          {(mode === "cajero" || mode === "validador") && (
            <div>
              <button type="button" className="tg-volver" onClick={() => setMode(null)}><Ic n="chev" s={14} style={{ transform: "rotate(180deg)" }} />Volver</button>
              <div className="tg-barras">
                {puntos.map(p => { const [txt, col] = estadoBarra(p); const ult = p.id === ultima; return (
                  <button type="button" key={p.id} className={"tg-barra" + (ult ? " tg-barra-ult" : "")} onClick={() => entrarBarra(mode, p.id)}>
                    <span className="tg-barra-ico" aria-hidden="true"><Ic n={mode === "validador" ? "scan" : "store"} s={22} /></span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="tg-barra-n">{p.name}</span>
                      <span className="tg-barra-e"><span className="tg-dot" style={{ background: col }} />{txt}{ult ? " · la última vez" : ""}</span>
                    </span>
                    <span className="tg-flecha tg-flecha-s" aria-hidden="true"><Ic n="chev" s={18} w={2.4} /></span>
                  </button>); })}
                {!puntos.length && <div className="tg-vacio">Este evento aún no tiene barras. Entra como administrador para crearlas.</div>}
              </div>
            </div>
          )}
        </section>
      </div>

      <footer className="tg-pie">TIXFAST · versión {APP_VERSION}</footer>

      {verEventos && (
        <div style={isMobile ? S.sheetWrap : S.overlay} onClick={() => setVerEventos(false)}>
          <div role="dialog" aria-label="Elegir evento" className={isMobile ? "sheet-anim" : ""} style={isMobile ? S.sheet : { ...S.pinCard, width: 480, maxWidth: "94vw", maxHeight: "80dvh", overflow: "auto", textAlign: "left" }} onClick={e => e.stopPropagation()}>
            {isMobile && <div style={S.grab} />}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 900, fontSize: 18 }}>Elige el evento</div>
              <button onClick={() => setVerEventos(false)} style={S.iconBtn} aria-label="Cerrar"><Ic n="close" /></button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {evOrden.map(e => { const pasado = e.date < hoy; const sel = e.id === ev.id; return (
                <button key={e.id} onClick={() => { onSelectEvent(e.id); setVerEventos(false); }} className="tg-evrow"
                  style={{ borderColor: sel ? "var(--accent)" : "var(--line)", background: sel ? "rgba(255,90,60,.08)" : "var(--surface2)", opacity: pasado && !sel ? .7 : 1 }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 900, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</span>
                    <span style={{ display: "block", fontSize: 13, color: "var(--muted)", marginTop: 2 }}>{dateFmt(e.date)}{e.venue ? ` · ${e.venue}` : ""}</span>
                  </span>
                  {e.id === proximo && !sel && <span style={{ fontSize: 11, fontWeight: 900, color: "var(--accent)", border: "1px solid var(--accent)", borderRadius: 999, padding: "2px 8px" }}>PRÓXIMO</span>}
                  {pasado && <span style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)" }}>Pasado</span>}
                  {sel && <Ic n="check" s={20} w={2.6} style={{ color: "var(--accent)" }} />}
                </button>); })}
            </div>
          </div>
        </div>
      )}

      {mode === "supervisor" && <PinModal secreto={secretoDe(ev, "supervisor")} onOk={() => onRole("supervisor")} onClose={() => setMode(null)} label="PIN de supervisor" />}
      {mode === "admin" && <PinModal secreto={secretoDe(ev, "admin")} onOk={() => onRole("admin")} onClose={() => setMode(null)} label="PIN de administrador" />}
      {mode === "crm" && <PinModal secreto={secretoDe(ev, "admin")} onOk={() => onRole("admin", null, "crm")} onClose={() => setMode(null)} label="PIN de administrador para el CRM" />}
    </div>
  );
}
const cap1 = (t) => t ? t.charAt(0).toUpperCase() + t.slice(1) : t;

// Pantalla de entrada: marca TIXFAST, luz suave en movimiento, tarjetas grandes para el dedo
const TG_CSS = `
.tg{position:relative;min-height:100%;box-sizing:border-box;overflow:auto;display:flex;flex-direction:column;background:#08090d;color:var(--text);
  padding:calc(14px + env(safe-area-inset-top)) 16px calc(14px + env(safe-area-inset-bottom));isolation:isolate}
.tg *{box-sizing:border-box}
.tg button{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
.tg button:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.tg-luz{position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none}
.tg-luz span{position:absolute;border-radius:50%;filter:blur(70px);opacity:.55}
.tg-luz span:nth-child(1){width:62vmax;height:62vmax;left:-18vmax;top:-30vmax;background:radial-gradient(circle,rgba(255,90,60,.55),transparent 62%);animation:tgA 18s ease-in-out infinite alternate}
.tg-luz span:nth-child(2){width:52vmax;height:52vmax;right:-20vmax;bottom:-26vmax;background:radial-gradient(circle,rgba(124,77,255,.35),transparent 62%);animation:tgB 22s ease-in-out infinite alternate}
@keyframes tgA{to{transform:translate(8vmax,6vmax) scale(1.08)}}
@keyframes tgB{to{transform:translate(-7vmax,-5vmax) scale(1.1)}}
@media (prefers-reduced-motion:reduce){.tg-luz span{animation:none}}
.tg-top{display:flex;align-items:center;justify-content:space-between;gap:12px;max-width:1120px;width:100%;margin:0 auto}
.tg-pill{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:800;padding:6px 11px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);backdrop-filter:blur(8px);white-space:nowrap}
.tg-dot{width:8px;height:8px;border-radius:8px;display:inline-block;flex-shrink:0}
.tg-main{flex:1;display:grid;grid-template-columns:minmax(0,1fr);gap:22px;max-width:1120px;width:100%;margin:0 auto;padding:28px 0 18px;align-content:center}
@media (min-width:900px){.tg-main{grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:56px;align-items:center}}
.tg-eyebrow{font-size:12px;font-weight:900;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
.tg-h1{margin:6px 0 18px;font-size:clamp(30px,6.4vw,52px);line-height:1.02;font-weight:900;letter-spacing:-.035em}
.tg-evento{display:flex;align-items:center;gap:14px;width:100%;text-align:left;padding:16px;border-radius:20px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);backdrop-filter:blur(10px);transition:border-color .15s,background .15s}
.tg-evento:hover{border-color:rgba(255,90,60,.5);background:rgba(255,255,255,.06)}
.tg-ev-ico{width:52px;height:52px;border-radius:14px;display:grid;place-items:center;flex-shrink:0;background:rgba(255,90,60,.14);color:var(--accent);overflow:hidden}
.tg-ev-ico img{width:100%;height:100%;object-fit:cover}
.tg-ev-label{display:block;font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.tg-ev-nombre{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:clamp(18px,3.4vw,24px);font-weight:900;letter-spacing:-.02em;line-height:1.15;margin-top:2px;overflow:hidden;overflow-wrap:anywhere}
.tg-ev-meta{display:block;font-size:13.5px;color:var(--muted);margin-top:3px;line-height:1.35}
.tg-cambiar{display:inline-flex;align-items:center;gap:4px;font-size:13px;font-weight:800;color:var(--text);padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.07);flex-shrink:0}
.tg-cambiar svg{transform:rotate(0)}
.tg-datos{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:14px;font-size:13px;color:var(--muted)}
.tg-datos span{display:inline-flex;align-items:center;gap:5px}
.tg-datos b{color:var(--text);font-weight:900}
.tg-cajero{position:relative;display:flex;align-items:center;gap:16px;width:100%;text-align:left;padding:22px 20px;border:none;border-radius:22px;color:#fff !important;
  background:linear-gradient(135deg,#ff6a45 0%,#ff4d2e 55%,#e8372a 100%);box-shadow:0 18px 44px rgba(255,77,46,.35),inset 0 1px 0 rgba(255,255,255,.25);transition:transform .1s,box-shadow .15s;overflow:hidden}
.tg-cajero::after{content:"";position:absolute;inset:0;background:linear-gradient(115deg,transparent 30%,rgba(255,255,255,.18) 50%,transparent 70%);transform:translateX(-100%);animation:tgBrillo 5s ease-in-out infinite}
@keyframes tgBrillo{0%,70%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
@media (prefers-reduced-motion:reduce){.tg-cajero::after{animation:none}}
.tg-cajero:hover{box-shadow:0 22px 54px rgba(255,77,46,.45),inset 0 1px 0 rgba(255,255,255,.25)}
.tg-cajero:active,.tg-rol:active,.tg-barra:active,.tg-evento:active{transform:scale(.985)}
.tg-cajero-ico{width:58px;height:58px;border-radius:16px;display:grid;place-items:center;background:rgba(255,255,255,.18);flex-shrink:0}
.tg-cajero-t{display:block;font-size:28px;font-weight:900;letter-spacing:-.03em;line-height:1}
.tg-cajero-d{display:block;font-size:14px;font-weight:700;opacity:.88;margin-top:5px}
.tg-flecha{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:rgba(255,255,255,.18);flex-shrink:0}
.tg-flecha-s{width:34px;height:34px;background:rgba(255,255,255,.06);color:var(--muted)}
.tg-roles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px}
.tg-rol{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:3px;text-align:left;padding:16px 14px 15px;border-radius:18px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);backdrop-filter:blur(10px);transition:border-color .15s,background .15s,transform .1s;min-height:118px}
.tg-rol:hover{border-color:rgba(255,255,255,.22);background:rgba(255,255,255,.065)}
.tg-rol-ico{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:rgba(255,255,255,.07);margin-bottom:8px}
.tg-rol-t{font-size:16px;font-weight:900;letter-spacing:-.01em}
.tg-rol-d{font-size:12.5px;color:var(--muted);line-height:1.35}
.tg-pin{position:absolute;top:12px;right:12px;display:inline-flex;align-items:center;gap:3px;font-size:10.5px;font-weight:900;letter-spacing:.06em;color:var(--muted);padding:3px 7px;border-radius:999px;border:1px solid rgba(255,255,255,.12)}
.tg-volver{display:inline-flex;align-items:center;gap:6px;background:none;border:none;padding:6px 2px;margin-bottom:10px;font-size:14px;font-weight:800;color:var(--muted)}
.tg-barras{display:flex;flex-direction:column;gap:10px}
.tg-barra{display:flex;align-items:center;gap:14px;width:100%;text-align:left;padding:16px;border-radius:18px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);backdrop-filter:blur(10px);transition:border-color .15s,transform .1s;min-height:76px}
.tg-barra:hover{border-color:rgba(255,90,60,.5)}
.tg-barra-ult{border-color:rgba(255,90,60,.55);background:rgba(255,90,60,.08)}
.tg-barra-ico{width:46px;height:46px;border-radius:13px;display:grid;place-items:center;background:rgba(255,90,60,.14);color:var(--accent);flex-shrink:0}
.tg-barra-n{display:block;font-size:18px;font-weight:900;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tg-barra-e{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted);margin-top:3px}
.tg-vacio{padding:18px;border-radius:16px;border:1px dashed rgba(255,255,255,.15);color:var(--muted);font-size:14px;text-align:center}
.tg-pie{text-align:center;font-size:12px;color:var(--muted);opacity:.8;max-width:1120px;width:100%;margin:0 auto}
.tg-evrow{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:14px;border-radius:14px;border:1px solid var(--line);color:var(--text);font:inherit;cursor:pointer}
@media (max-width:520px){.tg-evento{align-items:flex-start;padding:14px}.tg-ev-ico{width:44px;height:44px}.tg-cambiar{padding:7px 8px;font-size:12.5px}}
@media (max-width:360px){.tg-cambiar{font-size:0;gap:0;padding:8px}.tg-cambiar svg{width:16px;height:16px}.tg-cajero{padding:18px 14px;gap:12px}.tg-cajero-t{font-size:24px}.tg-cajero-ico{width:48px;height:48px}.tg-rol{min-height:108px;padding:14px 12px}.tg-roles{gap:10px}}
`;

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
              <button onClick={() => setOpen(false)} style={S.iconBtn} aria-label="Cerrar"><Ic n="close" /></button>
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

/* ---------------------- Modo de cobro ----------------------
   Queda fijo en cuanto cualquier barra del evento inicia la venta o hay ventas reales. */
function modoCobroBloqueado(ev, evSales) {
  return (evSales || []).length > 0 || (ev.puntos || []).some(p => !p.archivado && (p.estado || "prueba") !== "prueba");
}
function ModoCobroGate({ advanced, puntoName, onChoose, onBack }) {
  const opt = (adv, ico, title, desc) => (
    <button onClick={() => onChoose(adv)} style={{ display: "flex", alignItems: "center", gap: 14, width: "100%", textAlign: "left", padding: "18px 16px", marginBottom: 12, borderRadius: 16, cursor: "pointer", color: "var(--text)", background: advanced === adv ? "rgba(34,211,166,.10)" : "var(--surface)", border: `2px solid ${advanced === adv ? "var(--green)" : "var(--line)"}` }}>
      <span style={{ fontSize: 34, flexShrink: 0 }} aria-hidden="true">{ico}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontWeight: 900, fontSize: 17 }}>{title}</span>
        <span style={{ display: "block", fontSize: 13.5, color: "var(--muted)", marginTop: 2 }}>{desc}</span>
      </span>
      {advanced === adv && <span style={{ fontSize: 12, fontWeight: 800, color: "var(--green)", flexShrink: 0 }}>ACTUAL</span>}
    </button>
  );
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 85, background: "var(--bg)", overflow: "auto", padding: "calc(18px + env(safe-area-inset-top)) 16px calc(20px + env(safe-area-inset-bottom))" }}>
      <div style={{ maxWidth: 460, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ ...S.display, marginTop: 4 }}>¿Cómo vais a cobrar?</div>
          <div style={{ color: "var(--muted)", fontSize: 14, marginTop: 6 }}>Vale para todas las barras del evento. <b style={{ color: "var(--text)" }}>Cuando empiece la venta ya no se podrá cambiar.</b></div>
        </div>
        {opt(false, "🎟️", "Venta rápida", "Tocas el producto y sale el ticket. Efectivo y datáfono se cuadran juntos al cerrar.")}
        {opt(true, "💶", "Venta avanzada", "En cada venta eliges efectivo o tarjeta y te calcula el cambio. El cierre separa el cajón del datáfono.")}
        <button onClick={onBack} style={{ ...S.btnGhost, width: "100%", marginTop: 4, padding: "13px" }}>Cancelar · seguir en modo prueba</button>
        <div style={{ fontSize: 12.5, color: "var(--muted)", textAlign: "center", marginTop: 10 }}>Barra: {puntoName}</div>
      </div>
    </div>
  );
}

/* ---------------------- Fondo de caja (obligatorio para abrir) ---------------------- */
function FondoGate({ puntoName, previsto = null, ultimo = null, onSave, onBack, pending }) {
  const sugerido = previsto != null ? previsto : ultimo;
  const [edit, setEdit] = useState(sugerido == null);
  const [v, setV] = useState("");
  const amount = parseFloat(v || "0") || 0;
  const press = (d) => setV(x => (d === "." && x.includes(".") ? x : (x + d).slice(0, 7)));
  const quick = [0, 50, 100, 150, 200, 300];
  const wrap = { position: "fixed", inset: 0, zIndex: 85, background: "var(--bg)", overflow: "auto", padding: "calc(18px + env(safe-area-inset-top)) 16px calc(20px + env(safe-area-inset-bottom))" };
  const head = (
    <div style={{ textAlign: "center", marginBottom: 18 }}>
      <div style={{ fontSize: 44 }}>💰</div>
      <div style={{ ...S.display, marginTop: 4 }}>Iniciar venta</div>
      <div style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 4 }}>Cuenta el cambio del cajón de <b style={{ color: "var(--accent)" }}>{puntoName}</b>. Desde ahora todo lo que se venda <b style={{ color: "var(--text)" }}>cuenta en la caja</b>.</div>
    </div>
  );
  const foot = (<>
    {pending && <div style={{ fontSize: 12, color: "var(--amber)", textAlign: "center", marginTop: 10 }}>⏳ Se guardará en este equipo y subirá solo cuando haya conexión.</div>}
    <button onClick={onBack} style={{ ...S.btnGhost, width: "100%", marginTop: 12, padding: "13px" }}>Cancelar · seguir en modo prueba</button>
  </>);

  if (!edit) return (
    <div style={wrap}>
      <div style={{ maxWidth: 460, margin: "0 auto" }}>
        {head}
        <div style={{ background: "rgba(34,211,166,.08)", border: "2px solid var(--green)", borderRadius: 20, padding: "18px 16px", textAlign: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 2, fontWeight: 800 }}>{previsto != null ? "Fondo previsto" : "Fondo del turno anterior"}</div>
          <div style={{ fontSize: 58, fontWeight: 900, lineHeight: 1.05, color: "var(--green)", margin: "4px 0" }}>{money(sugerido)}</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>¿Es lo que hay en el cajón?</div>
        </div>
        <button onClick={() => onSave(round2(sugerido))} style={{ ...S.btnPrimary, width: "100%", padding: "20px", fontSize: 18, background: "var(--green)", color: "#04241b" }}>✅ Sí, hay {money(sugerido)} · Iniciar venta</button>
        <button onClick={() => { setV(""); setEdit(true); }} style={{ ...S.btnGhost, width: "100%", marginTop: 10, padding: "15px", fontSize: 15, fontWeight: 800 }}>✏️ Hay otra cantidad</button>
        {previsto != null && ultimo != null && ultimo !== previsto && <button onClick={() => onSave(round2(ultimo))} style={{ ...S.btnGhost, width: "100%", marginTop: 8, padding: "13px" }}>↺ Lo mismo que el turno anterior ({money(ultimo)})</button>}
        {sugerido !== 0 && <button onClick={() => onSave(0)} style={{ ...S.btnGhost, width: "100%", marginTop: 8, padding: "13px", color: "var(--muted)" }}>Sin cambio (0 €)</button>}
        {foot}
      </div>
    </div>
  );

  return (
    <div style={wrap}>
      <div style={{ maxWidth: 460, margin: "0 auto" }}>
        {head}
        <div style={{ background: "var(--surface)", border: "2px solid " + (v !== "" ? "var(--green)" : "var(--line)"), borderRadius: 16, padding: 16, textAlign: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 2, fontWeight: 800 }}>¿Cuánto hay en el cajón?</div>
          <div style={{ fontSize: 46, fontWeight: 900, lineHeight: 1.05, color: v !== "" ? "var(--green)" : "var(--muted)" }}>{money(amount)}</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(82px,1fr))", gap: 8, marginBottom: 12 }}>
          {quick.map(n => <button key={n} onClick={() => setV(String(n))} style={{ ...S.noteBtn, ...(amount === n && v !== "" ? { borderColor: "var(--green)", color: "var(--green)" } : {}) }}>{n === 0 ? "SIN CAMBIO" : money(n)}</button>)}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "←"].map(k => (
            <button key={k} onClick={() => k === "←" ? setV(x => x.slice(0, -1)) : press(k)} style={S.padBtn}>{k === "." ? "," : k}</button>
          ))}
        </div>

        <button disabled={v === ""} onClick={() => onSave(round2(amount))} style={{ ...S.btnPrimary, width: "100%", marginTop: 14, padding: "18px", fontSize: 17, opacity: v === "" ? .4 : 1, background: "var(--green)", color: "#04241b" }}>
          ✅ {v === "" ? "Escribe el fondo" : `Iniciar venta con ${money(amount)}`}
        </button>
        {sugerido != null && <button onClick={() => setEdit(false)} style={{ ...S.btnGhost, width: "100%", marginTop: 10, padding: "13px" }}>← Volver ({money(sugerido)})</button>}
        <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", marginTop: 10 }}>Al cerrar el turno se usa para cuadrar la caja.</div>
        {foot}
      </div>
    </div>
  );
}

/* ---------------------- Cobro avanzado (efectivo / tarjeta + cambio) ---------------------- */
/* ---------------------- Caja: sacar dinero (gasto) / meter cambio ----------------------
   Movimientos de dinero del cajón durante la noche. NO cambian la facturación:
   el cierre Z los usa para saber cuánto debe haber. */
const MOV_CONCEPTOS = {
  gasto: ["Proveedor", "Hielo", "Compras", "Personal", "Retirada de efectivo"],
  entrada: ["Más cambio", "Monedas", "Billetes pequeños"],
};
function CajaModal({ puntoName, movs, fondo, onSave, onVoid, onClose }) {
  const isMobile = useIsMobile();
  const [tipo, setTipo] = useState("gasto");
  const [val, setVal] = useState("");
  const [concepto, setConcepto] = useState("");
  const [confirmId, setConfirmId] = useState(null);
  const imp = parseFloat((val || "0").replace(",", ".")) || 0;
  const tG = sumMov(movs, "gasto"), tE = sumMov(movs, "entrada");
  const isG = tipo === "gasto";
  const col = isG ? "var(--amber)" : "var(--green)";
  const press = (d) => setVal(v => {
    if (d === "." && (v.includes(".") || !v)) return v || "0.";
    const nv = (v + d);
    if (/\.\d{3}$/.test(nv) || nv.replace(".", "").length > 7) return v;
    return nv;
  });
  const switchTipo = (t) => { setTipo(t); setConcepto(""); };
  const save = async () => { if (!(imp > 0)) return; const ok = await onSave(imp, concepto, tipo); if (ok) { setVal(""); setConcepto(""); } };
  const hora = (ts) => new Date(ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const seg = (t, ico, label, c) => (
    <button onClick={() => switchTipo(t)} style={{ flex: 1, padding: "12px 6px", borderRadius: 12, fontWeight: 900, fontSize: 15, cursor: "pointer", border: `2px solid ${tipo === t ? c : "var(--line)"}`, background: tipo === t ? c : "var(--surface2)", color: tipo === t ? "#1a1205" : "var(--text)" }}>{ico} {label}</button>
  );
  return (
    <div style={S.payWrap} onClick={onClose}>
      <div className={isMobile ? "sheet-anim" : ""} style={{ ...S.payCard, maxWidth: 480, ...(isMobile ? { borderRadius: "22px 22px 0 0", maxHeight: "94dvh" } : {}) }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 19 }}>💰 Caja</div>
            <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{puntoName} · no cambia lo facturado</div>
          </div>
          <button onClick={onClose} style={{ ...S.smallBtn, flexShrink: 0 }} aria-label="Cerrar"><Ic n="close" s={16} /></button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 6, marginBottom: 14 }}>
          <div style={S.cajaTile}><div style={S.miniLabel}>Fondo</div><b style={{ fontSize: 16 }}>{fondo != null ? money(fondo) : "—"}</b></div>
          <div style={S.cajaTile}><div style={S.miniLabel}>Añadido</div><b style={{ fontSize: 16, color: tE ? "var(--green)" : "var(--muted)" }}>{tE ? "+" + money(tE) : money(0)}</b></div>
          <div style={S.cajaTile}><div style={S.miniLabel}>Gastos</div><b style={{ fontSize: 16, color: tG ? "var(--amber)" : "var(--muted)" }}>{tG ? "-" + money(tG) : money(0)}</b></div>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {seg("gasto", "💸", "Sacar dinero", "var(--amber)")}
          {seg("entrada", "➕", "Meter cambio", "var(--green)")}
        </div>

        <div style={{ background: "var(--surface2)", border: "2px solid " + (imp > 0 ? col : "var(--line)"), borderRadius: 16, padding: "10px 14px", textAlign: "center", marginBottom: 10 }}>
          <div style={S.miniLabel}>{isG ? "¿Cuánto sale del cajón?" : "¿Cuánto cambio metes?"}</div>
          <div style={{ fontSize: 38, fontWeight: 900, color: imp > 0 ? col : "var(--muted)", lineHeight: 1.15 }}>{imp > 0 ? (isG ? "-" : "+") + money(imp) : money(0)}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 10 }}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0"].map(d => <button key={d} onClick={() => press(d)} style={{ ...S.pinBtn, padding: "12px 0" }}>{d === "." ? "," : d}</button>)}
          <button onClick={() => setVal(v => v.slice(0, -1))} style={{ ...S.pinBtn, padding: "12px 0", fontSize: 18 }} aria-label="Borrar">⌫</button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {MOV_CONCEPTOS[tipo].map(c => <button key={c} onClick={() => setConcepto(concepto === c ? "" : c)} style={{ ...S.qtyChip, padding: "8px 12px", fontSize: 13, ...(concepto === c ? { background: col, color: "#1a1205", borderColor: col } : {}) }}>{c}</button>)}
        </div>
        <input value={concepto} maxLength={120} onChange={e => setConcepto(e.target.value)} placeholder="Concepto (opcional)" style={{ ...S.input, marginBottom: 12 }} />
        <button onClick={save} disabled={!(imp > 0)} style={{ ...S.btnPrimary, width: "100%", padding: "16px", fontSize: 16, background: imp > 0 ? col : "var(--line)", color: imp > 0 ? "#1a1205" : "var(--muted)" }}>{imp > 0 ? (isG ? `💸 Sacar ${money(imp)} de la caja` : `➕ Meter ${money(imp)} de cambio`) : "Escribe el importe"}</button>

        {movs.length > 0 && <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <b style={{ fontSize: 14 }}>Movimientos de este turno</b>
          {movs.slice().reverse().map(g => (
            <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid var(--line)", fontSize: 13.5 }}>
              <span style={{ color: "var(--muted)", flexShrink: 0 }}>{hora(g.ts)}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{isEntrada(g) ? "➕" : "💸"} {g.concepto || (isEntrada(g) ? "Cambio" : "Gasto")}{!g.synced && <span style={{ color: "var(--amber)" }}> · ⏳</span>}</span>
              <b style={{ flexShrink: 0, color: isEntrada(g) ? "var(--green)" : "var(--amber)" }}>{isEntrada(g) ? "+" : "-"}{money(g.importe)}</b>
              {confirmId === g.id
                ? <span style={{ display: "flex", gap: 4, flexShrink: 0 }}><button onClick={() => { setConfirmId(null); onVoid(g); }} style={{ ...S.smallBtn, color: "var(--red)", borderColor: "var(--red)" }}>✓ Anular</button><button onClick={() => setConfirmId(null)} style={S.smallBtn}>✗</button></span>
                : <button onClick={() => setConfirmId(g.id)} style={{ ...S.smallBtn, flexShrink: 0 }}>Anular</button>}
            </div>
          ))}
        </div>}
      </div>
    </div>
  );
}

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
                {i === 0 && <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>{money(n)}</span>}
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
  return <div style={S.statBox}><div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div><div style={{ fontSize: 24, fontWeight: 800, color: accent }}>{value}</div></div>;
}

/* ---------------------- Tarjeta de comprobación previa ---------------------- */

/* ============================================================
   POS
   ============================================================ */
function POS({ punto, totals, rankCounts, onReorder, onSetSortMode, onSell, onInvite, onComboInvite, onSellMany, onVoid, onReprint, canReprint, onCombo, extra = null, testMode, closed, advanced, canArrange = false, onGasto, gastoTotal = 0, entradaTotal = 0, fondo = null, onIniciar }) {
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

  // ---- Modo invitación: el SIGUIENTE producto que se toque es invitación; luego se apaga solo ----
  const [inviting, setInviting] = useState(false);
  useEffect(() => { setInviting(false); }, [punto.id]);

  // ---- Mover productos directamente en la pantalla (orden manual) ----
  const [arranging, setArranging] = useState(false);
  const [dragT, setDragT] = useState(null);
  const dragRef = useRef(null);
  const autoRef = useRef(null);
  const gridRef = useRef(null);
  const tileRefs = useRef({});
  useEffect(() => { setArranging(false); }, [punto.id]);
  useEffect(() => () => clearInterval(autoRef.current), []);
  const scrollParent = (el) => { let q = el?.parentElement; while (q) { const o = getComputedStyle(q).overflowY; if ((o === "auto" || o === "scroll") && q.scrollHeight > q.clientHeight) return q; q = q.parentElement; } return document.scrollingElement; };
  const recompute = (st) => {
    const ds = (st.sc ? st.sc.scrollTop : 0) - st.sTop;
    const s0 = st.slots[st.startIdx];
    const cx = s0.l + s0.w / 2 + (st.x - st.sx), cy = s0.t + s0.h / 2 + (st.y - st.sy) + ds;
    let best = 0, bd = Infinity;
    st.slots.forEach((r, i) => { const d = (r.l + r.w / 2 - cx) ** 2 + (r.t + r.h / 2 - cy) ** 2; if (d < bd) { bd = d; best = i; } });
    const order = st.base.filter(x => x !== st.id); order.splice(best, 0, st.id);
    const tx = (s0.l + st.x - st.sx) - st.slots[best].l, ty = (s0.t + st.y - st.sy) - st.slots[best].t + ds;
    if (best !== st.idx) { try { navigator.vibrate?.(8); } catch {} }
    return { ...st, order, idx: best, tx, ty };
  };
  const dStart = (e, id) => {
    if (!arranging || (e.button != null && e.button !== 0)) return;
    e.preventDefault();
    const base = shownProducts.map(p => p.id);
    const slots = base.map(pid => { const r = tileRefs.current[pid]?.getBoundingClientRect() || { left: 0, top: 0, width: 0, height: 0 }; return { l: r.left, t: r.top, w: r.width, h: r.height }; });
    const sc = scrollParent(gridRef.current);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    const st = { id, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, base, slots, startIdx: base.indexOf(id), idx: base.indexOf(id), order: base, tx: 0, ty: 0, sc, sTop: sc ? sc.scrollTop : 0 };
    dragRef.current = st; setDragT(st);
    clearInterval(autoRef.current);
    autoRef.current = setInterval(() => {   // auto-desplazamiento al acercarse al borde
      const c = dragRef.current; if (!c || !c.sc) return;
      const box = c.sc === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : c.sc.getBoundingClientRect();
      const step = c.y < box.top + 80 ? -12 : c.y > box.bottom - 80 ? 12 : 0;
      if (!step) return;
      const before = c.sc.scrollTop; c.sc.scrollTop += step;
      if (c.sc.scrollTop !== before) { const n = recompute(c); dragRef.current = n; setDragT(n); }
    }, 16);
  };
  const dMove = (e) => { const c = dragRef.current; if (!c) return; const n = recompute({ ...c, x: e.clientX, y: e.clientY }); dragRef.current = n; setDragT(n); };
  const dEnd = () => {
    const c = dragRef.current; clearInterval(autoRef.current);
    dragRef.current = null; setDragT(null);
    if (c && c.order.join() !== c.base.join()) onReorder && onReorder(c.order);
  };
  const startArrange = () => { if (sortMode !== "manual") onSetSortMode && onSetSortMode("manual"); setInviting(false); setGrouping(false); setCart([]); setArranging(true); };
  const viewProducts = dragT ? dragT.order.map(id => punto.products.find(p => p.id === id)).filter(Boolean) : shownProducts;

  const cartQty = (id) => cart.find(c => c.product.id === id)?.qty || 0;
  const cartCount = cart.reduce((t, c) => t + c.qty, 0);
  const cartTotal = cart.reduce((t, c) => t + c.product.price * c.qty, 0);

  const tap = (p) => {
    if (arranging || p.soldOut) return;
    if (inviting && !grouping) { onInvite && onInvite(p, qty); setQty(1); setInviting(false); return; }
    if (grouping) {
      setCart(prev => { const i = prev.findIndex(c => c.product.id === p.id); if (i >= 0) { const cp = [...prev]; cp[i] = { ...cp[i], qty: cp[i].qty + 1 }; return cp; } return [...prev, { product: p, qty: 1 }]; });
    } else { onSell(p, qty); setQty(1); }
  };
  const changeQty = (id, d) => setCart(prev => prev.flatMap(c => c.product.id === id ? (c.qty + d <= 0 ? [] : [{ ...c, qty: c.qty + d }]) : [c]));
  const startGroup = () => { setArranging(false); setInviting(false); setGrouping(true); setCart([]); };
  const cancelGroup = () => { setGrouping(false); setCart([]); setCharging(null); };
  const confirmCharge = () => { onSellMany(cart.map(c => ({ product: c.product, qty: c.qty }))); cancelGroup(); };
  const [moreOpen, setMoreOpen] = useState(false);
  const toggleInvite = () => { setArranging(false); setInviting(v => !v); setMoreOpen(false); };
  const openCaja = () => { setArranging(false); setInviting(false); onGasto && onGasto(); };

  // Acciones: mismo estilo neutro para todas; color solo para «Anular» (rojo)
  const actionBtns = (<>
    <button onClick={toggleInvite} aria-pressed={inviting} style={{ ...S.actBtn, ...(inviting ? S.actOn : {}) }}><Ic n="gift" s={17} />{inviting ? "Cancelar invitación" : "Invitación"}</button>
    <button onClick={startGroup} style={S.actBtn}><Ic n="list" s={17} />Varios productos</button>
    {onGasto && <button onClick={openCaja} style={S.actBtn} title="Sacar dinero (gastos) o meter cambio en la caja"><Ic n="cash" s={17} />Caja{entradaTotal > 0 ? <span style={S.actBadge}>+{money(entradaTotal)}</span> : null}{gastoTotal > 0 ? <span style={S.actBadge}>-{money(gastoTotal)}</span> : null}</button>}
    <button onClick={onReprint} disabled={!canReprint} style={{ ...S.actBtn, opacity: canReprint ? 1 : .45 }}><Ic n="printer" s={17} />Reimprimir</button>
    <button onClick={onVoid} style={{ ...S.actBtn, color: "var(--red)", borderColor: "rgba(255,77,77,.45)" }}><Ic n="undo" s={17} />Anular</button>
  </>);

  return (
    <div>
      {closed && <div style={{ background: "var(--red)", color: "#fff", fontWeight: 800, textAlign: "center", padding: "12px", borderRadius: 12, marginBottom: 14 }}>🔒 CAJA CERRADA · no se puede vender en este evento</div>}
      {testMode && !closed && <div className="prueba-frame" aria-hidden="true" />}
      {testMode && !closed && punto.estado !== "cerrada" && (
        isMobile ? (
          <div className="prueba-banner" style={{ ...S.pruebaBanner, flexWrap: "nowrap", gap: 10, padding: "8px 8px 8px 12px", marginBottom: 10 }}>
            <span style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
              <span style={{ display: "block", fontWeight: 900, fontSize: 15 }}>MODO PRUEBA</span>
              <span style={{ display: "block", fontSize: 12, fontWeight: 700 }}>No cuenta · tickets «NO VÁLIDO»</span>
            </span>
            {onIniciar && <button onClick={onIniciar} style={{ ...S.iniciarBtn, padding: "11px 14px", fontSize: 15, flexShrink: 0 }}>▶ Iniciar venta</button>}
          </div>
        ) : (
        <div className="prueba-banner" style={S.pruebaBanner}>
          <span style={{ fontSize: 38, flexShrink: 0 }} aria-hidden="true">🧪</span>
          <span style={{ flex: "1 1 220px", minWidth: 0 }}>
            <span style={{ display: "block", fontWeight: 900, fontSize: 21, letterSpacing: .5 }}>MODO PRUEBA · NO CUENTA</span>
            <span style={{ display: "block", fontSize: 13.5, fontWeight: 700 }}>Toca e imprime lo que quieras: los tickets salen marcados «NO VÁLIDO». Cuando abráis, inicia la venta.</span>
          </span>
          {onIniciar && <button onClick={onIniciar} style={S.iniciarBtn}>▶ Iniciar venta</button>}
        </div>
        )
      )}
      {testMode && !closed && punto.estado === "cerrada" && (
        <div className="prueba-banner" style={{ ...S.pruebaBanner, background: "repeating-linear-gradient(135deg,#3a0d0d 0 18px,#2a0a0a 18px 36px)", borderColor: "var(--red)", color: "#fff" }}>
          <span style={{ fontSize: isMobile ? 30 : 38, flexShrink: 0 }}>🔒</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontWeight: 900, fontSize: isMobile ? 17 : 21 }}>VENTA CERRADA{punto.cerradaEn ? ` · Z a las ${new Date(punto.cerradaEn).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
            <span style={{ display: "block", fontSize: isMobile ? 12 : 13.5, fontWeight: 700, opacity: .9 }}>Ya no cuenta nada (los tickets salen «NO VÁLIDO»). Para volver a vender, un administrador puede reabrir la barra en Informes.</span>
          </span>
        </div>
      )}
      {!testMode && !closed && (
        <div style={{ ...S.abiertaPill, ...(isMobile ? { display: "flex", flexWrap: "nowrap", whiteSpace: "nowrap", overflow: "hidden", marginBottom: 10, padding: "7px 12px", fontSize: 13 } : {}) }}>
          <span className="livedot" style={{ ...S.liveDot, background: "var(--green)" }} />
          <b>ABIERTA</b>{punto.abiertaEn ? <span style={{ color: "var(--muted)", fontWeight: 600 }}>· {new Date(punto.abiertaEn).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</span> : null}
          {fondo != null && <span style={{ color: "var(--muted)", fontWeight: 600 }}>· fondo {money(fondo)}</span>}
          <span style={{ color: "var(--muted)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>· {advanced ? "efectivo/tarjeta" : "venta rápida"}</span>
        </div>
      )}
      {/* Cantidad: fila compacta que cabe entera (×1 ×2 ×3 ×5 ×10) */}
      {!grouping && !arranging && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: isMobile ? 10 : 14, flexWrap: "wrap" }}>
          <div role="radiogroup" aria-label="Cantidad" style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 6, width: isMobile ? "100%" : 330 }}>
            {[1, 2, 3, 5, 10].map(q => <button key={q} role="radio" aria-checked={qty === q} onClick={() => setQty(q)} style={{ ...S.qtyChip, padding: isMobile ? "9px 0" : "9px 0", ...(qty === q ? S.qtyActive : {}) }}>×{q}</button>)}
          </div>
          {!isMobile && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actionBtns}</div>}
        </div>
      )}
      {grouping && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", gap: 8, marginBottom: 12 }}>
          <div style={{ fontWeight: 800, fontSize: isMobile ? 14 : 16, color: "var(--accent)", minWidth: 0 }}>{isMobile ? "Varios productos · ve sumando" : "Varios productos · toca para ir sumando"}</div>
          <button onClick={cancelGroup} style={{ ...S.actBtn, color: "var(--red)", flexShrink: 0 }}><Ic n="close" s={16} />Cancelar</button>
        </div>
      )}

      {inviting && !grouping && (
        <div className="invite-banner" style={S.inviteBanner}>
          <span style={{ fontSize: isMobile ? 28 : 34, flexShrink: 0 }}>🎁</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontWeight: 900, fontSize: isMobile ? 16 : 19, letterSpacing: .3 }}>MODO INVITACIÓN ACTIVO</span>
            <span style={{ display: "block", fontSize: isMobile ? 12 : 13.5, fontWeight: 700, opacity: .9 }}>Toca el producto a invitar{qty > 1 ? ` (×${qty})` : ""} · cuenta como invitación, no se cobra · luego se apaga solo</span>
          </span>
          <button onClick={() => setInviting(false)} style={S.inviteCancel}>✕ Cancelar</button>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 18, alignItems: "flex-start" }}>
        {/* productos */}
        <div style={{ flex: 1, width: "100%" }}>
          {canArrange && punto.products.length > 1 && !grouping && (arranging ? (
            <div style={S.arrangeBar}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}><Ic n="grip" s={16} w={2.4} /><span><b>Moviendo productos</b><span style={{ display: "block", fontSize: 12, opacity: .85, fontWeight: 600 }}>Arrastra cada caja a su sitio. Ahora no se vende.</span></span></span>
              <button onClick={() => setArranging(false)} style={S.doneBtn}>✓ Hecho</button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <div style={S.miniSeg}>
                <button onClick={startArrange} style={{ ...S.miniSegBtn, ...(sortMode === "manual" ? S.miniSegOn : {}) }}><Ic n="grip" s={14} w={2.4} />Orden manual</button>
                <button onClick={() => { if (sortMode !== "ventas") { onSetSortMode && onSetSortMode("ventas"); setRankKey(k => k + 1); } }} style={{ ...S.miniSegBtn, ...(sortMode === "ventas" ? S.miniSegOn : {}) }}><Ic n="reports" s={14} w={2.2} />Más vendidos</button>
              </div>
              {sortMode === "manual"
                ? <button onClick={startArrange} style={{ ...S.smallBtn, display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", color: "var(--accent)", background: "rgba(255,90,60,.1)", borderColor: "rgba(255,90,60,.4)" }}><Ic n="grip" s={14} w={2.4} />Mover productos</button>
                : rankStale && <button onClick={() => setRankKey(k => k + 1)} style={{ ...S.smallBtn, display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px" }}><Ic n="refresh" s={13} w={2.2} />Actualizar orden</button>}
            </div>
          ))}
          {punto.products.length === 0 ? <Empty msg={`“${punto.name}” aún no tiene productos.`} /> : (
            <div ref={gridRef} style={{ ...S.grid, gridTemplateColumns: isMobile ? "repeat(auto-fill, minmax(130px,1fr))" : "repeat(auto-fill, minmax(170px,1fr))" }}>
              {viewProducts.map((p, i) => {
                const badge = grouping ? cartQty(p.id) : totals.perProduct[p.id];
                const isDrag = dragT && dragT.id === p.id;
                const arr = arranging ? {
                  touchAction: "none", userSelect: "none", WebkitUserSelect: "none", cursor: isDrag ? "grabbing" : "grab",
                  outline: "2px dashed rgba(255,255,255,.6)", outlineOffset: -6,
                  ...(isDrag ? { transform: `translate(${dragT.tx}px, ${dragT.ty}px) scale(1.06)`, zIndex: 10, boxShadow: "0 24px 50px rgba(0,0,0,.6)", transition: "none" } : { animation: `jiggle .35s ease-in-out ${(i % 3) * .07}s infinite alternate` }),
                } : {};
                return (
                  <button key={p.id} ref={el => { tileRefs.current[p.id] = el; }} onClick={() => tap(p)} disabled={!arranging && p.soldOut}
                    onPointerDown={arranging ? (e => dStart(e, p.id)) : undefined} onPointerMove={arranging ? dMove : undefined} onPointerUp={arranging ? dEnd : undefined} onPointerCancel={arranging ? dEnd : undefined}
                    className={arranging ? "tile arranging" : inviting ? "tile inviting" : "tile"} style={{ ...S.tile, background: p.soldOut ? "var(--surface2)" : `linear-gradient(160deg, ${p.color}, ${shade(p.color, -25)})`, color: p.soldOut ? "var(--muted)" : inkOn(p.color), cursor: p.soldOut ? "not-allowed" : "pointer", outline: grouping && cartQty(p.id) ? "3px solid #fff" : "none", ...(testMode ? { paddingBottom: 30 } : {}), ...arr }}>
                    {arranging && <span style={S.tileGrip}><Ic n="grip" s={16} w={2.6} /></span>}
                    {testMode && !arranging && <span style={S.tilePrueba}><span style={S.tilePruebaTxt}>PRUEBA</span></span>}
                    {inviting && !arranging && !p.soldOut && <span style={S.tileInvite}>🎁 INVITAR</span>}
                    {!arranging && p.print === false && <span style={{ position: "absolute", top: 10, left: 10, background: "rgba(0,0,0,.45)", borderRadius: 7, padding: "2px 7px", fontWeight: 800, fontSize: 12 }}>SIN TICKET</span>}
                    {badge && !arranging && !inviting ? <span style={{ ...S.tileBadge, background: grouping ? "var(--accent)" : "rgba(0,0,0,.45)" }}>{badge}</span> : null}
                    {p.soldOut && <span style={S.soldOut}>AGOTADO</span>}
                    <span style={{ fontSize: 44 }}>{p.emoji}</span>
                    <span style={{ fontSize: 19, fontWeight: 800, lineHeight: 1.1, textShadow: p.soldOut || inkOn(p.color) !== "#fff" ? "none" : "0 1px 3px rgba(0,0,0,.3)" }}>{p.name}</span>
                    {p.subtitle ? <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.15, opacity: .9, marginTop: -4 }}>{p.subtitle}</span> : null}
                    <span style={{ fontSize: 22, fontWeight: 800 }}>{money(p.price)}</span>
                  </button>
                );
              })}
            </div>
          )}
          {!grouping && !arranging && qty > 1 && <div style={{ marginTop: 14, textAlign: "center", color: "var(--amber)", fontWeight: 700 }}>Modo cantidad ×{qty}: el siguiente toque vende {qty} unidades en un ticket.</div>}

          {!grouping && combos.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, fontWeight: 800, marginBottom: 10 }}>🎟️ Bonos / Ofertas</div>
              <div style={{ ...S.grid, gridTemplateColumns: isMobile ? "repeat(auto-fill, minmax(150px,1fr))" : "repeat(auto-fill, minmax(180px,1fr))" }}>
                {combos.map(c => {
                  const units = (c.items || []).reduce((t, it) => t + (it.qty || 1), 0);
                  const price = (c.price === "" || c.price == null) ? (c.items || []).reduce((t, it) => { const p = punto.products.find(x => x.id === it.productId); return t + (p ? p.price * (it.qty || 1) : 0); }, 0) : Number(c.price);
                  return (
                    <button key={c.id} onClick={() => { if (inviting) { onComboInvite && onComboInvite(c); setInviting(false); } else onCombo(c); }} className={inviting ? "tile inviting" : "tile"} style={{ ...S.tile, minHeight: 130, background: "linear-gradient(160deg, #ffb400, #d98e00)", color: "#1a1205", border: "2px solid #ffd479", ...(testMode ? { paddingBottom: 30 } : {}) }}>
                      <span style={{ position: "absolute", top: 10, left: 10, background: "rgba(0,0,0,.18)", borderRadius: 8, padding: "2px 8px", fontWeight: 900, fontSize: 12 }}>{units} tickets</span>
                      {testMode && <span style={S.tilePrueba}><span style={S.tilePruebaTxt}>PRUEBA</span></span>}
                      <span style={{ fontSize: 34 }}>🎟️</span>
                      <span style={{ fontSize: 18, fontWeight: 900, lineHeight: 1.1, textAlign: "center" }}>{c.name}</span>
                      <span style={{ fontSize: 20, fontWeight: 900 }}>{money(price)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {!grouping && !arranging && extra}
        </div>

        {/* panel comanda */}
        {grouping && (
          <div style={{ ...S.cart, ...(isMobile ? { width: "100%", maxHeight: "none", position: "static" } : {}) }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 12 }}>🧾 Comanda <span style={{ color: "var(--muted)", fontWeight: 600, fontSize: 13 }}>· {cartCount} art.</span></div>
            <div style={{ flex: 1, overflow: "auto", marginBottom: 12 }}>
              {cart.length === 0 ? <div style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", padding: "30px 0" }}>Toca productos para añadirlos</div> : cart.map(c => (
                <div key={c.product.id} style={S.cartRow}>
                  <span style={{ fontSize: 20 }}>{c.product.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.product.name}</div><div style={{ fontSize: 12, color: "var(--muted)" }}>{money(c.product.price)} · {money(c.product.price * c.qty)}</div></div>
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

      {/* Móvil: barra de acciones fija abajo (Caja, Anular, Reimprimir y «Más») */}
      {isMobile && !grouping && !arranging && (
        <div style={S.actBar}>
          {onGasto && <button onClick={openCaja} style={S.actBarBtn}><Ic n="cash" s={21} />Caja{(gastoTotal > 0 || entradaTotal > 0) && <span style={S.actBarDot} aria-label="Hay movimientos de caja" />}</button>}
          <button onClick={onVoid} style={{ ...S.actBarBtn, color: "var(--red)" }}><Ic n="undo" s={21} />Anular</button>
          <button onClick={onReprint} disabled={!canReprint} style={{ ...S.actBarBtn, opacity: canReprint ? 1 : .4 }}><Ic n="printer" s={21} />Reimprimir</button>
          <button onClick={() => setMoreOpen(true)} aria-haspopup="dialog" style={{ ...S.actBarBtn, ...(inviting ? { color: "#d8b4fe" } : {}) }}><Ic n="more" s={21} />Más</button>
        </div>
      )}
      {moreOpen && (
        <div style={S.sheetWrap} onClick={() => setMoreOpen(false)}>
          <div className="sheet-anim" role="dialog" aria-label="Más acciones" style={S.sheet} onClick={e => e.stopPropagation()}>
            <div style={S.grab} />
            <div className="menu-group" style={S.menuGroup}>
              <MenuRow big icon="gift" label={inviting ? "Cancelar invitación" : "Invitación"} onClick={toggleInvite} />
              <MenuRow big icon="list" label="Varios productos" onClick={() => { setMoreOpen(false); startGroup(); }} />
              {canArrange && punto.products.length > 1 && <MenuRow big icon="grip" label="Mover productos" onClick={() => { setMoreOpen(false); startArrange(); }} />}
            </div>
            <button onClick={() => setMoreOpen(false)} style={{ ...S.btnGhost, width: "100%", marginTop: 12 }}>Cerrar</button>
          </div>
        </div>
      )}

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
  const [previewPrueba, setPreviewPrueba] = useState(false);
  // Con QR activado, la vista previa lleva un QR real de muestra (marcado como prueba: nunca se canjea)
  const previewQr = useMemo(() => {
    if (!ev.qrActivo || !ev.qrClave || demo.qr === false) return null;
    try { return crearToken({ clave: ev.qrClave, ventaUuid: "00000000-0000-4000-8000-000000000000", idx: 0, productoId: demo.id, prueba: true }); } catch { return null; }
  }, [ev.qrActivo, ev.qrClave, demo.id, demo.qr]);
  const Toggle = ({ k, label }) => (
    <label style={S.toggleRow}><span>{label}</span><button onClick={() => set({ [k]: !ev[k] })} style={{ ...S.switch, background: ev[k] ? "var(--green)" : "var(--line)" }}><span style={{ ...S.knob, transform: ev[k] ? "translateX(20px)" : "translateX(2px)" }} /></button></label>
  );
  const StyleToggle = ({ k, label, def = true }) => { const on = st[k] !== false && (st[k] !== undefined ? st[k] : def); return (
    <label style={S.toggleRow}><span>{label}</span><button onClick={() => setStyle(k, !on)} style={{ ...S.switch, background: on ? "var(--green)" : "var(--line)" }}><span style={{ ...S.knob, transform: on ? "translateX(20px)" : "translateX(2px)" }} /></button></label>
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
          {ev.logo && typeof ev.logo === "string" && /^data:image\//i.test(ev.logo) ? (
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
                  if (!/^image\/(png|jpe?g|gif|webp)$/i.test(f.type)) { flash("Formato no válido: usa PNG o JPG", "warn"); return; }
                  const reader = new FileReader();
                  reader.onload = () => { set({ logo: reader.result }); flash("Logo cargado"); };
                  reader.readAsDataURL(f);
                }} />
              </label>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>PNG o JPG. Se imprime en blanco y negro; un logo de alto contraste sale mejor en térmica.</div>
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>Vista previa · igual que se imprime</div>
          <div style={S.miniSeg} role="radiogroup" aria-label="Tipo de ticket en la vista previa">
            <button role="radio" aria-checked={!previewPrueba} onClick={() => setPreviewPrueba(false)} style={{ ...S.miniSegBtn, ...(!previewPrueba ? S.miniSegOn : {}) }}>Venta</button>
            <button role="radio" aria-checked={previewPrueba} onClick={() => setPreviewPrueba(true)} style={{ ...S.miniSegBtn, ...(previewPrueba ? S.miniSegOn : {}) }}>Prueba</button>
          </div>
        </div>
        <div style={S.paperWrap}><ThermalTicket ev={ev} product={demo} time={timeNow()} num={42} folio={previewPrueba ? "PRUEBA" : `${prefijoDePunto(ev.puntos[0] || {})}-0042`} qr={previewQr} /></div>
        {ev.qrActivo && !previewQr && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>El QR aparecerá cuando el evento tenga su clave (necesita internet una vez).</div>}
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
  const [draft, setDraft] = useState({ name: "", subtitle: "", price: "", emoji: "🎟️", color: PALETTE[0] });
  const [newEvent, setNewEvent] = useState(null);
  const neOpen = !!newEvent;
  useEffect(() => { if (neOpen) setTimeout(() => document.getElementById("nuevo-evento")?.scrollIntoView({ behavior: "smooth", block: "center" }), 60); }, [neOpen]);
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
    if (editProd.isProv && !(editProd.prov || "").trim()) { flash("Pon el nombre del proveedor", "warn"); return; }
    if (!editProd.name.trim() || editProd.price === "" || isNaN(parseFloat(editProd.price))) { flash("Pon nombre y precio válidos", "warn"); return; }
    dispatch({ type: "UPDATE_PRODUCT", eventId: ev.id, puntoId: punto.id, productId: editProd.id, patch: { name: editProd.name.toUpperCase(), subtitle: (editProd.subtitle || "").trim().toUpperCase(), price: parseFloat(editProd.price), emoji: editProd.emoji, color: editProd.color, soldOut: editProd.soldOut, print: editProd.print !== false } });
    // Comisión de proveedor (solo liquidaciones)
    const cur = comisionActual(ev, editProd.id);
    const want = editProd.isProv ? { proveedor: (editProd.prov || "").trim().toUpperCase(), pct: Math.min(100, Math.max(0, parseFloat(String(editProd.pct).replace(",", ".")) || 0)) } : { proveedor: "", pct: null };
    const changed = cur ? (cur.proveedor !== want.proveedor || cur.pct !== want.pct) : !!want.proveedor;
    if (changed) {
      const all = { ...(ev.style?.comisiones || {}) };
      const list = all[editProd.id] ? [...all[editProd.id]] : [];
      list.push({ desde: list.length ? Date.now() : 0, ...want });      // la 1ª vez cuenta también lo ya vendido
      all[editProd.id] = list;
      dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: { style: { ...(ev.style || {}), comisiones: all } } });
    }
    setEditProd(null); flash("Producto actualizado");
  };

  const addProduct = () => {
    if (!draft.name.trim() || !draft.price) { flash("Pon nombre y precio", "warn"); return; }
    const nextOrden = punto.products.reduce((m, x) => Math.max(m, (x.orden ?? 0) + 1), punto.products.length);
    dispatch({ type: "ADD_PRODUCT", eventId: ev.id, puntoId: punto.id, product: { id: uid(), name: draft.name.toUpperCase(), subtitle: (draft.subtitle || "").trim().toUpperCase(), price: parseFloat(draft.price), emoji: draft.emoji, color: draft.color, soldOut: false, orden: nextOrden } });
    setDraft({ name: "", subtitle: "", price: "", emoji: "🎟️", color: PALETTE[Math.floor(Math.random() * PALETTE.length)] });
    flash("Producto añadido a " + punto.name);
  };
  const addPunto = () => { if (!newPunto.trim()) { flash("Pon nombre al punto", "warn"); return; } dispatch({ type: "ADD_PUNTO", eventId: ev.id, punto: { id: uid(), name: newPunto.trim(), archivado: false, products: [] } }); setNewPunto(""); flash("Punto de venta creado"); };
  const duplicarEvento = (src, name, date, venue) => {
    const pmap = {};
    const puntos = src.puntos.filter(p => !p.archivado).map(p => {
      const products = p.products.map((x, i) => { const id = uid(); pmap[x.id] = id; return { ...x, id, orden: x.orden ?? i }; });
      return { id: uid(), name: p.name, archivado: false, fondo: null, fondoPrevisto: p.fondoPrevisto ?? null, sortMode: p.sortMode || "manual", products, combos: [] , _src: p };
    });
    puntos.forEach(p => { p.combos = (p._src.combos || []).map(c => ({ ...c, id: uid(), items: (c.items || []).map(it => ({ ...it, productId: pmap[it.productId] || it.productId })) })); delete p._src; });
    const st = { ...(src.style || {}) };
    if (st.comisiones) { const nc = {}; Object.entries(st.comisiones).forEach(([pid, l]) => { const last = l && l[l.length - 1]; if (pmap[pid] && last && last.proveedor) nc[pmap[pid]] = [{ ...last, desde: 0 }]; }); st.comisiones = nc; }
    if (st.reservados) { const pm = {}; src.puntos.forEach(p => { const n = puntos.find(x => x.name === p.name); if (n) pm[p.id] = n.id; }); st.reservados = { ...st.reservados, puntos: (st.reservados.puntos || []).map(id => pm[id]).filter(Boolean) }; }
    const event = { ...src, id: uid(), name, date, venue, closed: false, startsAt: newEvent?.startsAt || "", endsAt: localAIso(newEvent?.endsAt) || "", style: st, puntos };
    dispatch({ type: "ADD_EVENT", event });
    // Los reservados (mesas) se copian libres, sin clientes ni señales, cuando el evento ya está guardado
    setTimeout(() => { copiarReservados(src.id, event.id); }, 2500);
    flash(`Evento duplicado: ${puntos.length} barras y ${puntos.reduce((t, p) => t + p.products.length, 0)} productos copiados`);
  };
  const createEvent = () => {
    if (!newEvent.name.trim()) { flash("Falta el nombre", "warn"); return; }
    if (newEvent.copyFrom) {
      const src = state.events.find(e => e.id === newEvent.copyFrom);
      if (src) { duplicarEvento(src, newEvent.name.trim().toUpperCase(), newEvent.date || new Date().toISOString().slice(0, 10), newEvent.venue); setNewEvent(null); return; }
    }
    dispatch({ type: "ADD_EVENT", event: { id: uid(), name: newEvent.name.toUpperCase(), date: newEvent.date || new Date().toISOString().slice(0, 10), venue: newEvent.venue, startsAt: newEvent.startsAt || "", endsAt: localAIso(newEvent.endsAt) || "", template: "festival", paper: 80, footer: "", logo: "", showEventName: true, showDate: true, showTime: true, showPrice: true, anularPin: false, puntos: [{ id: uid(), name: "Taquilla", archivado: false, products: [] }] } }); setNewEvent(null); flash("Evento creado"); };

  return (
    <>
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0,1fr)" : "minmax(0,1fr) minmax(0,1fr)", gap: 24, alignItems: "start" }}>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}><h3 style={{ ...S.h3, margin: 0 }}>Datos del evento</h3><div style={{ display: "flex", gap: 8 }}><button onClick={() => setNewEvent({ name: `${ev.name} (COPIA)`, date: "", venue: ev.venue || "", copyFrom: ev.id })} style={{ ...S.btnGhost, padding: "10px 14px" }} title="Copia barras, productos, bonos, plantilla y ajustes, sin ventas">Duplicar</button><button onClick={() => setNewEvent({ name: "", date: "", venue: "", copyFrom: "" })} style={{ ...S.btnGhost, padding: "10px 14px" }}>+ Nuevo evento</button></div></div>
        <div style={S.panel}>
          <Field label="Nombre"><input style={S.input} value={ev.name} onChange={e => dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: { name: e.target.value } })} /></Field>
          <div style={{ display: "flex", gap: 10, flexWrap: isMobile ? "wrap" : "nowrap" }}>
            <div style={{ flex: isMobile ? "1 1 100%" : 1, minWidth: 0 }}><Field label="Empieza (fecha y hora)"><input type="datetime-local" style={S.input} value={ev.startsAt || ""} onChange={e => dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: e.target.value ? { startsAt: e.target.value, date: e.target.value.slice(0, 10) } : { startsAt: "" } })} /></Field></div>
            <div style={{ flex: isMobile ? "1 1 100%" : 1, minWidth: 0 }}><Field label="Termina (fecha y hora)"><input type="datetime-local" style={{ ...S.input, ...(ev.qrActivo && !ev.endsAt ? { borderColor: "var(--amber)" } : {}) }} value={isoALocal(ev.endsAt)} onChange={e => dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: { endsAt: localAIso(e.target.value) || "" } })} /></Field></div>
          </div>
          {ev.startsAt && ev.endsAt && new Date(ev.endsAt) <= new Date(ev.startsAt) && <div style={{ fontSize: 12.5, color: "var(--red)", margin: "-4px 0 10px" }}><Ic n="alert" s={15} style={II} />La hora de fin es anterior al inicio. Revisa el día (si acaba de madrugada, es el día siguiente).</div>}
          <Field label="Recinto"><input style={S.input} value={ev.venue} onChange={e => dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: { venue: e.target.value } })} /></Field>
          <AccesoSeguro ev={ev} dispatch={dispatch} flash={flash} />
          <label style={S.toggleRow}><span>Anular ticket en caja exige PIN de supervisor</span><button onClick={() => dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: { anularPin: !ev.anularPin } })} style={{ ...S.switch, background: ev.anularPin ? "var(--green)" : "var(--line)" }}><span style={{ ...S.knob, transform: ev.anularPin ? "translateX(20px)" : "translateX(2px)" }} /></button></label>
          <label style={S.toggleRow}><span><b>Venta avanzada</b> · pedir efectivo/tarjeta y calcular el cambio{modoCobroBloqueado(ev, evSales) && <span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginTop: 2 }}><Ic n="lock" s={15} style={II} />Fijo: la venta ya ha empezado en este evento</span>}</span><button disabled={modoCobroBloqueado(ev, evSales)} aria-label="Venta avanzada" onClick={() => { if (modoCobroBloqueado(ev, evSales)) return; dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: ev.advanced ? { advanced: false } : { advanced: true, changeHelp: true } }); }} style={{ ...S.switch, flexShrink: 0, opacity: modoCobroBloqueado(ev, evSales) ? .45 : 1, cursor: modoCobroBloqueado(ev, evSales) ? "not-allowed" : "pointer", background: ev.advanced ? "var(--green)" : "var(--line)" }}><span style={{ ...S.knob, transform: ev.advanced ? "translateX(20px)" : "translateX(2px)" }} /></button></label>
          {ev.advanced && <label style={S.toggleRow}><span>Ayuda con el cambio · billetes y cálculo de devolución</span><button onClick={() => dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: { changeHelp: !(ev.changeHelp !== false) } })} style={{ ...S.switch, background: ev.changeHelp !== false ? "var(--green)" : "var(--line)" }}><span style={{ ...S.knob, transform: ev.changeHelp !== false ? "translateX(20px)" : "translateX(2px)" }} /></button></label>}
          {ev.advanced && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Al vender, el camarero elegirá <b>Efectivo</b> o <b>Tarjeta</b>. {ev.changeHelp !== false ? "Con efectivo verá los billetes y el cambio a devolver." : "Con efectivo cobrará directo, sin pedir billetes."} El cierre Z mostrará el arqueo separado.</div>}
        </div>

        <div style={{ ...S.panel, marginTop: 16, ...(ev.qrActivo ? { borderColor: "rgba(34,211,166,.45)" } : {}) }}>
          <label style={S.toggleRow}><span><b><Ic n="qr" s={15} style={II} />Tickets con QR de un solo uso</b><span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Cada ticket sale con un QR firmado. En la barra se escanea con el móvil y solo vale una vez: las copias, los anulados y los falsos salen en rojo.</span></span><button onClick={() => { const on = !ev.qrActivo; dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: on ? { qrActivo: true, style: { ...(ev.style || {}), qrDesde: Date.now() } } : { qrActivo: false } }); flash(on ? "🔐 Tickets con QR activados" : "Tickets con QR desactivados", on ? "ok" : "warn"); }} style={{ ...S.switch, background: ev.qrActivo ? "var(--green)" : "var(--line)", flexShrink: 0 }}><span style={{ ...S.knob, transform: ev.qrActivo ? "translateX(20px)" : "translateX(2px)" }} /></button></label>
          {ev.qrActivo && (<>
            {!ev.qrClave && <div style={{ fontSize: 12.5, color: "var(--amber)", marginTop: 8 }}>⏳ Preparando la clave del evento… (necesita internet una vez)</div>}
            <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "10px 0 8px", lineHeight: 1.45 }}>
              <b style={{ color: "var(--text)" }}>Cómo se usa:</b> en el móvil de cada barra, entra con <b>Validar tickets</b> y elige la barra. Verde = sirve · Rojo = no sirvas.
              Con QR, cada unidad sale en su propio ticket (×3 = 3 tickets). Un ticket vale en <b style={{ color: "var(--text)" }}>cualquier barra</b> hasta que termina el evento.
            </div>
            {ev.endsAt
              ? <div style={{ fontSize: 12.5, color: "var(--green)", marginBottom: 8 }}>✅ Los QR valen hasta el <b>{fechaHora(ev.endsAt)}</b>. Después salen en rojo: «Evento terminado».</div>
              : <div style={{ fontSize: 12.5, color: "var(--amber)", marginBottom: 8, fontWeight: 700 }}><Ic n="alert" s={15} style={II} />Pon arriba la fecha y hora en que <b>termina</b> el evento: a partir de esa hora los QR dejan de valer. Sin ella no caducan.</div>}
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Toca un producto para quitarle o ponerle el QR:</div>
            {ev.puntos.filter(p => !p.archivado).map(p => (
              <div key={p.id} style={{ padding: "8px 0", borderTop: "1px solid var(--line)" }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}><Ic n="store" s={15} style={II} />{p.name}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {p.products.length === 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>Sin productos</span>}
                  {p.products.map(x => { const on = x.qr !== false && x.print !== false; return (
                    <button key={x.id} disabled={x.print === false} title={x.print === false ? "Este producto no imprime ticket" : ""} onClick={() => dispatch({ type: "UPDATE_PRODUCT", eventId: ev.id, puntoId: p.id, productId: x.id, patch: { qr: x.qr === false } })}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 11px", borderRadius: 20, fontSize: 12.5, fontWeight: 700, cursor: x.print === false ? "default" : "pointer", border: `1px solid ${on ? "rgba(34,211,166,.55)" : "var(--line)"}`, background: on ? "rgba(34,211,166,.12)" : "transparent", color: on ? "var(--text)" : "var(--muted)", opacity: x.print === false ? .5 : 1 }}>
                      <span>{x.emoji}</span>{x.name}<span style={{ fontSize: 12, color: on ? "var(--green)" : "var(--muted)" }}>{x.print === false ? "sin ticket" : on ? "QR" : "sin QR"}</span>
                    </button>); })}
                </div>
              </div>
            ))}
          </>)}
        </div>

        <div style={{ ...S.panel, marginTop: 16 }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}><Ic n="cash" s={15} style={II} />Fondo de caja (cambio inicial)</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>Las barras están en modo prueba hasta que alguien pulsa «Iniciar venta» en el TPV; entonces se confirma el cambio del cajón con un toque. Pon aquí lo que vas a dejar en cada una.</div>
          <label style={S.toggleRow}><span>Pedir el fondo al iniciar la venta</span><button onClick={() => dispatch({ type: "UPDATE_EVENT", id: ev.id, patch: { pedirFondo: !(ev.pedirFondo !== false) } })} style={{ ...S.switch, background: ev.pedirFondo !== false ? "var(--green)" : "var(--line)" }}><span style={{ ...S.knob, transform: ev.pedirFondo !== false ? "translateX(20px)" : "translateX(2px)" }} /></button></label>
          {ev.pedirFondo !== false && ev.puntos.filter(p => !p.archivado).map(p => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--line)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}><Ic n="store" s={15} style={II} />{p.name}</div>
                <div style={{ fontSize: 12, color: p.estado === "abierta" ? "var(--green)" : p.estado === "cerrada" ? "var(--red)" : "var(--amber)" }}>{p.estado === "abierta" ? `Venta abierta${p.fondo != null ? ` con ${money(p.fondo)}` : ""}` : p.estado === "cerrada" ? "Venta cerrada (Z hecho)" : "En modo prueba"}</div>
              </div>
              <FondoPrevistoInput value={p.fondoPrevisto} onSave={(n) => { dispatch({ type: "UPDATE_PUNTO", eventId: ev.id, puntoId: p.id, patch: { fondoPrevisto: n } }); flash(n == null ? `Sin fondo previsto en ${p.name}` : `Fondo previsto ${p.name}: ${money(n)}`); }} />
            </div>
          ))}
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
            <div style={{ fontWeight: 800, marginBottom: 6, color: "var(--red)" }}><Ic n="alert" s={15} style={II} />Zona peligrosa</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>Resetear borra TODAS las ventas y cierres de “{ev.name}”. Ideal para limpiar las pruebas antes del evento. No se puede deshacer.</div>
            <button onClick={() => setConfirmReset(1)} style={{ ...S.btnGhost, width: "100%", color: "var(--red)", borderColor: "var(--red)" }}>Resetear estadísticas</button>
          </div>
        )}
        {newEvent && (
          <div id="nuevo-evento" style={{ ...S.panel, marginTop: 16, border: "1px solid var(--accent)" }}>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>{newEvent.copyFrom ? "Duplicar evento" : "Crear evento nuevo"}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Copiar barras, productos, bonos, plantilla del ticket y ajustes de:</div>
            <select value={newEvent.copyFrom || ""} onChange={e => setNewEvent({ ...newEvent, copyFrom: e.target.value })} style={{ ...S.select, marginBottom: 10 }}>
              <option value="">— Empezar de cero —</option>
              {state.events.map(e => <option key={e.id} value={e.id}>{e.name}{e.date ? ` · ${e.date}` : ""}</option>)}
            </select>
            {newEvent.copyFrom && <div style={{ fontSize: 12, color: "var(--green)", marginBottom: 10 }}>✓ Se copia todo (también el fondo previsto de cada barra) menos las ventas y los cierres.</div>}
            <input style={S.input} placeholder="Nombre del evento" value={newEvent.name} onChange={e => setNewEvent({ ...newEvent, name: e.target.value })} /><div style={{ height: 8 }} />
            <div style={{ display: "flex", gap: 8, flexWrap: isMobile ? "wrap" : "nowrap" }}>
              <label style={{ flex: isMobile ? "1 1 100%" : 1, minWidth: 0, fontSize: 12, color: "var(--muted)" }}>Empieza<input type="datetime-local" style={{ ...S.input, marginTop: 4 }} value={newEvent.startsAt || ""} onChange={e => setNewEvent({ ...newEvent, startsAt: e.target.value, date: e.target.value ? e.target.value.slice(0, 10) : newEvent.date })} /></label>
              <label style={{ flex: isMobile ? "1 1 100%" : 1, minWidth: 0, fontSize: 12, color: "var(--muted)" }}>Termina<input type="datetime-local" style={{ ...S.input, marginTop: 4 }} value={newEvent.endsAt || ""} onChange={e => setNewEvent({ ...newEvent, endsAt: e.target.value })} /></label>
            </div><div style={{ height: 8 }} />
            <input style={S.input} placeholder="Recinto" value={newEvent.venue} onChange={e => setNewEvent({ ...newEvent, venue: e.target.value })} />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}><button style={S.btnPrimary} onClick={createEvent}>{newEvent.copyFrom ? "Duplicar" : "Crear"}</button><button style={S.btnGhost} onClick={() => setNewEvent(null)}>Cancelar</button></div>
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
                        <div style={{ fontWeight: 700 }}>{active ? "▶ " : ""}{p.name} {p.archivado && <span style={{ fontSize: 12, color: "var(--muted)", border: "1px solid var(--line)", borderRadius: 6, padding: "1px 6px", marginLeft: 4 }}>ARCHIVADO</span>}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>{p.products.length} productos{conVentas ? " · con ventas" : ""}</div>
                      </button>
                      <button onClick={() => setRenamePunto({ id: p.id, value: p.name })} style={{ ...S.smallBtn, padding: "6px 8px" }} title="Renombrar" aria-label={`Renombrar ${p.name}`}><Ic n="edit" s={14} /></button>
                      {conVentas ? (
                        <button onClick={() => dispatch({ type: "ARCHIVE_PUNTO", eventId: ev.id, puntoId: p.id, value: !p.archivado })} style={{ ...S.smallBtn, color: p.archivado ? "var(--green)" : "var(--amber)", borderColor: p.archivado ? "var(--green)" : "var(--amber)" }}>{p.archivado ? "Activar" : "Archivar"}</button>
                      ) : ev.puntos.length > 1 ? (
                        confirmDel === p.id ? (
                          <span style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => { dispatch({ type: "DELETE_PUNTO", eventId: ev.id, puntoId: p.id }); setConfirmDel(null); flash("Punto borrado"); }} style={{ ...S.smallBtn, color: "var(--red)", borderColor: "var(--red)" }}>✓ Borrar</button>
                            <button onClick={() => setConfirmDel(null)} style={S.smallBtn}>✗</button>
                          </span>
                        ) : <button onClick={() => setConfirmDel(p.id)} style={S.del} aria-label={`Archivar ${p.name}`}>✕</button>
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
          <Field label="Título"><input style={S.input} placeholder="Ej. ENTRADA TAQUILLA" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></Field>
          <Field label="Subtítulo (opcional)"><input style={S.input} placeholder="Ej. INCLUYE 1 COPA" maxLength={60} value={draft.subtitle} onChange={e => setDraft({ ...draft, subtitle: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{ width: 130, flexShrink: 0 }}><Field label="Precio (€)"><input style={S.input} type="number" inputMode="decimal" placeholder="0,00" value={draft.price} onChange={e => setDraft({ ...draft, price: e.target.value })} /></Field></div>
            <Field label="Icono"><EmojiPicker value={draft.emoji} onChange={v => setDraft({ ...draft, emoji: v })} size={46} /></Field>
          </div>
          <Field label="Color"><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{PALETTE.map(c => <button key={c} aria-label={`Color ${c}`} aria-pressed={draft.color === c} onClick={() => setDraft({ ...draft, color: c })} style={{ width: 28, height: 28, borderRadius: 8, background: c, border: draft.color === c ? "3px solid #fff" : "3px solid transparent", cursor: "pointer" }} />)}</div></Field>
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
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div><div style={{ fontSize: 12, color: "var(--muted)" }}>{p.print === false ? <b style={{ color: "var(--amber)" }}>Sin ticket · </b> : null}{(() => { const c = comisionActual(ev, p.id); return c && c.proveedor ? <b style={{ color: "#60a5fa" }}>{c.proveedor} {c.pct}% · </b> : null; })()}{p.subtitle ? <span style={{ color: "var(--text)", opacity: .75 }}>{p.subtitle} · </span> : null}{money(p.price)}{sortMode === "ventas" ? <> · <b style={{ color: "var(--accent)" }}>#{salesRank.indexOf(p.id) + 1}</b> · {sold[p.id] || 0} vendidos</> : (sold[p.id] ? ` · ${sold[p.id]} vendidos` : "")}</div></div>
              {!isMobile && <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <button onClick={() => moveProd(p.id, -1)} disabled={i === 0} style={{ ...S.arrowBtn, opacity: i === 0 ? .3 : 1 }} title="Subir" aria-label="Subir"><Ic n="up" s={13} w={2.4} /></button>
                <button onClick={() => moveProd(p.id, 1)} disabled={i === punto.products.length - 1} style={{ ...S.arrowBtn, opacity: i === punto.products.length - 1 ? .3 : 1 }} title="Bajar" aria-label="Bajar"><Ic n="down" s={13} w={2.4} /></button>
              </div>}
              <button onClick={() => setEditProd({ id: p.id, name: p.name, subtitle: p.subtitle || "", price: String(p.price), emoji: p.emoji, color: p.color, soldOut: p.soldOut, print: p.print !== false, ...(() => { const c = comisionActual(ev, p.id); return { isProv: !!(c && c.proveedor), prov: c?.proveedor || "", pct: c?.pct != null ? String(c.pct) : "" }; })() })} style={{ ...S.smallBtn, display: "grid", placeItems: "center", width: 32, height: 32, padding: 0, flexShrink: 0 }} title="Editar producto" aria-label={`Editar ${p.name}`}><Ic n="edit" s={15} /></button>
              <label style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, fontSize: 12, fontWeight: 700, color: p.soldOut ? "var(--amber)" : "var(--muted)", flexShrink: 0 }}>
                <button role="switch" aria-checked={!!p.soldOut} aria-label={`Agotado: ${p.name}`} onClick={() => dispatch({ type: "UPDATE_PRODUCT", eventId: ev.id, puntoId: punto.id, productId: p.id, patch: { soldOut: !p.soldOut } })} style={{ ...S.switch, transform: "scale(.82)", background: p.soldOut ? "var(--green)" : "var(--line)" }}><span style={{ ...S.knob, transform: p.soldOut ? "translateX(20px)" : "translateX(2px)" }} /></button>
                Agotado
              </label>
              <button onClick={() => dispatch({ type: "DELETE_PRODUCT", eventId: ev.id, puntoId: punto.id, productId: p.id })} style={{ ...S.del, flexShrink: 0 }} aria-label={`Borrar ${p.name}`}><Ic n="close" s={15} w={2.2} style={{ margin: "0 auto" }} /></button>
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
                  <button onClick={() => setEditCombo({ ...c, price: c.price ?? "", items: (c.items || []).map(i => ({ ...i })) })} style={{ ...S.smallBtn, padding: "6px 8px" }} title="Editar bono" aria-label={`Editar ${c.name}`}><Ic n="edit" s={14} /></button>
                  <button onClick={() => delCombo(c.id)} style={S.del} aria-label={`Borrar ${c.name}`}>✕</button>
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
          <Field label="Título (grande en el ticket)"><input style={S.input} value={editProd.name} onChange={e => setEditProd({ ...editProd, name: e.target.value })} /></Field>
          <Field label="Subtítulo (opcional, más pequeño) · ej. INCLUYE 1 COPA"><input style={S.input} placeholder="Sin subtítulo" maxLength={60} value={editProd.subtitle || ""} onChange={e => setEditProd({ ...editProd, subtitle: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 8 }}>
            <Field label="Precio €"><input type="number" style={S.input} value={editProd.price} onChange={e => setEditProd({ ...editProd, price: e.target.value })} /></Field>
            <Field label="Icono"><EmojiPicker value={editProd.emoji} onChange={v => setEditProd({ ...editProd, emoji: v })} size={46} /></Field>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 6px" }}>Color</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{PALETTE.map(c => <button key={c} onClick={() => setEditProd({ ...editProd, color: c })} style={{ width: 28, height: 28, borderRadius: 7, background: c, border: editProd.color === c ? "3px solid #fff" : "3px solid transparent", cursor: "pointer" }} />)}</div>
          <label style={{ ...S.toggleRow, marginTop: 14 }}><span>¿Imprimir ticket?<span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>{editProd.print !== false ? "Sí · al venderlo sale su ticket" : "No · solo se guarda la venta, sin imprimir"}</span></span><button onClick={() => setEditProd({ ...editProd, print: editProd.print === false })} style={{ ...S.switch, background: editProd.print !== false ? "var(--green)" : "var(--line)" }}><span style={{ ...S.knob, left: 0, transform: editProd.print !== false ? "translateX(20px)" : "translateX(2px)" }} /></button></label>
          <label style={{ ...S.toggleRow }}><span>Producto de proveedor (comisión)<span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>Solo para liquidaciones · el precio y la facturación no cambian</span></span><button onClick={() => setEditProd({ ...editProd, isProv: !editProd.isProv })} style={{ ...S.switch, background: editProd.isProv ? "var(--green)" : "var(--line)" }}><span style={{ ...S.knob, left: 0, transform: editProd.isProv ? "translateX(20px)" : "translateX(2px)" }} /></button></label>
          {editProd.isProv && (
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <Field label="Proveedor"><input style={S.input} placeholder="Ej. FOOD TRUCK BURGER" value={editProd.prov} onChange={e => setEditProd({ ...editProd, prov: e.target.value })} /></Field>
              <div style={{ width: 110, flexShrink: 0 }}><Field label="Comisión %"><input style={S.input} inputMode="decimal" placeholder="20" value={editProd.pct} onChange={e => setEditProd({ ...editProd, pct: e.target.value })} /></Field></div>
            </div>
          )}
          {editProd.isProv && editProd.pct !== "" && !isNaN(parseFloat(String(editProd.pct).replace(",", "."))) && editProd.price !== "" && (() => { const pr = parseFloat(editProd.price) || 0, pc = parseFloat(String(editProd.pct).replace(",", ".")) || 0; return <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Por cada {money(pr)}: <b style={{ color: "var(--green)" }}>{money(round2(pr * pc / 100))} vuestro</b> · {money(round2(pr - pr * pc / 100))} para el proveedor</div>; })()}
          <label style={{ ...S.toggleRow }}><span>Marcar como agotado</span><button onClick={() => setEditProd({ ...editProd, soldOut: !editProd.soldOut })} style={{ ...S.switch, background: editProd.soldOut ? "var(--green)" : "var(--line)" }}><span style={{ ...S.knob, left: 0, transform: editProd.soldOut ? "translateX(20px)" : "translateX(2px)" }} /></button></label>
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
                <button onClick={() => setEditCombo({ ...editCombo, items: editCombo.items.filter((_, i) => i !== idx) })} style={S.del} aria-label="Quitar producto del bono">✕</button>
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
            <div style={{ display: "flex", justifyContent: "center", color: "var(--amber)" }}><Ic n="alert" s={40} /></div>
            <div style={{ fontWeight: 900, fontSize: 18, margin: "8px 0" }}>¿Resetear estadísticas?</div>
            <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 18 }}>Se borrarán TODAS las ventas y cierres de “{ev.name}”. Esto no se puede deshacer.</div>
            <button onClick={() => setConfirmReset(2)} style={{ ...S.btnPrimary, width: "100%", background: "var(--red)" }}>Continuar</button>
            <button onClick={() => setConfirmReset(0)} style={{ ...S.btnGhost, width: "100%", marginTop: 8 }}>Cancelar</button>
          </>) : (<>
            <div style={{ display: "flex", justifyContent: "center", color: "var(--amber)" }}><Ic n="alert" s={40} /></div>
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
/* ============================================================
   HISTÓRICO — resumen de TODOS los eventos de la cuenta (solo administrador)
   ============================================================ */
function resumenEvento(ev, allSales, closures, allGastos = []) {
  const ss = allSales.filter(s => s.eventId === ev.id);
  const ventas = ss.filter(s => !s.voided && !isInvite(s));
  const anuladas = ss.filter(s => s.voided);
  const revenue = round2(ventas.reduce((t, s) => t + s.price, 0));
  const efectivo = round2(ventas.filter(s => s.pago === "efectivo").reduce((t, s) => t + s.price, 0));
  const tarjeta = round2(ventas.filter(s => s.pago === "tarjeta").reduce((t, s) => t + s.price, 0));
  const inv = invitaciones(ss);
  const liq = liquidacion(ev, ss);
  const prod = {}; ventas.forEach(s => { const k = s.name; prod[k] = prod[k] || { name: k, uds: 0, total: 0 }; prod[k].uds++; prod[k].total += s.price; });
  const top = Object.values(prod).map(p => ({ ...p, total: round2(p.total) })).sort((a, b) => b.uds - a.uds);
  const horas = {}; ventas.forEach(s => { const h = new Date(s.ts).getHours(); horas[h] = (horas[h] || 0) + 1; });
  const hk = Object.keys(horas).map(Number); const pico = hk.length ? hk.reduce((a, b) => horas[b] > horas[a] ? b : a) : null;
  const barras = ev.puntos.map(p => { const v = ventas.filter(s => s.puntoId === p.id); return { id: p.id, name: p.name, tickets: v.length, revenue: round2(v.reduce((t, s) => t + s.price, 0)) }; }).filter(b => b.tickets > 0);
  const cz = (closures || []).filter(c => c.eventId === ev.id);
  const desc = cz.filter(c => c.contado != null).map(c => round2(c.contado - (c.esperado != null ? Number(c.esperado) : (Number(c.fondo || 0) + Number(c.efectivo || 0) - Number(c.gastos || 0)))));
  const gastos = sumMov((allGastos || []).filter(g => g.eventId === ev.id), "gasto");
  return {
    ev, revenue, gastos, neto: round2(revenue - gastos), tickets: ventas.length, medio: ventas.length ? round2(revenue / ventas.length) : 0, efectivo, tarjeta,
    inv, liq, anul: anuladas.length, anulImporte: round2(anuladas.filter(s => !isInvite(s)).reduce((t, s) => t + s.price, 0)),
    top, horas, pico, barras, cierres: cz.length, descuadre: desc.length ? round2(desc.reduce((t, x) => t + x, 0)) : null,
  };
}

function Historico({ state, onOpenEvent, flash }) {
  const isMobile = useIsMobile();
  const [periodo, setPeriodo] = useState("todo");
  const [sel, setSel] = useState(null);
  const now = new Date();
  const dentro = (d) => {
    if (periodo === "todo" || !d) return periodo === "todo";
    const x = new Date(d + "T12:00:00");
    if (periodo === "mes") return x.getFullYear() === now.getFullYear() && x.getMonth() === now.getMonth();
    if (periodo === "anio") return x.getFullYear() === now.getFullYear();
    if (periodo === "90") return (now - x) / 86400000 <= 90 && x <= new Date(now.getTime() + 86400000 * 400);
    return true;
  };
  const todos = state.events.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .map(e => resumenEvento(e, state.sales, state.closures, state.gastos));
  // comparación con el evento anterior (por fecha) de toda la cuenta
  todos.forEach((r, i) => { const prev = todos.slice(i + 1).find(x => x.tickets > 0); r.prev = prev || null; r.delta = prev && prev.revenue > 0 ? Math.round((r.revenue - prev.revenue) / prev.revenue * 100) : null; });
  const lista = todos.filter(r => dentro(r.ev.date));
  const T = lista.reduce((t, r) => ({
    revenue: t.revenue + r.revenue, gastos: t.gastos + r.gastos, tickets: t.tickets + r.tickets, efectivo: t.efectivo + r.efectivo, tarjeta: t.tarjeta + r.tarjeta,
    invN: t.invN + r.inv.n, invV: t.invV + r.inv.valor, pagar: t.pagar + r.liq.pagar, comision: t.comision + r.liq.comision,
    anul: t.anul + r.anul, anulImp: t.anulImp + r.anulImporte, desc: t.desc + (r.descuadre || 0), hayDesc: t.hayDesc || r.descuadre != null,
  }), { revenue: 0, gastos: 0, tickets: 0, efectivo: 0, tarjeta: 0, invN: 0, invV: 0, pagar: 0, comision: 0, anul: 0, anulImp: 0, desc: 0, hayDesc: false });
  const conVentas = lista.filter(r => r.tickets > 0);
  const media = conVentas.length ? round2(T.revenue / conVentas.length) : 0;
  const maxRev = Math.max(1, ...lista.map(r => r.revenue));
  const prodAll = {}; lista.forEach(r => r.top.forEach(p => { prodAll[p.name] = (prodAll[p.name] || 0) + p.uds; }));
  const estrella = Object.entries(prodAll).sort((a, b) => b[1] - a[1])[0];

  const csvPeriodo = () => {
    const rows = [["Evento", "Fecha", "Recinto", "Facturación", "Gastos caja", "A cuadrar", "Tickets", "Ticket medio", "Efectivo", "Tarjeta", "Invitaciones", "Valor invitaciones", "Pagar proveedores", "Comisión", "Anulaciones", "Descuadre caja", "vs anterior %"]];
    lista.forEach(r => rows.push([r.ev.name, r.ev.date, r.ev.venue || "", r.revenue.toFixed(2), r.gastos.toFixed(2), r.neto.toFixed(2), r.tickets, r.medio.toFixed(2), r.efectivo.toFixed(2), r.tarjeta.toFixed(2), r.inv.n, r.inv.valor.toFixed(2), r.liq.pagar.toFixed(2), r.liq.comision.toFixed(2), r.anul, r.descuadre != null ? r.descuadre.toFixed(2) : "", r.delta != null ? r.delta : ""]));
    rows.push(["TOTAL", "", "", round2(T.revenue).toFixed(2), round2(T.gastos).toFixed(2), round2(T.revenue - T.gastos).toFixed(2), T.tickets, "", round2(T.efectivo).toFixed(2), round2(T.tarjeta).toFixed(2), T.invN, round2(T.invV).toFixed(2), round2(T.pagar).toFixed(2), round2(T.comision).toFixed(2), T.anul, T.hayDesc ? round2(T.desc).toFixed(2) : "", ""]);
    const csv = rows.map(r => r.map(csvCell).join(";")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" })); a.download = `TIXFAST_historico_${periodo}.csv`; a.click(); flash("CSV del histórico descargado");
  };
  const csvEvento = (r) => {
    const rows = [["Evento", r.ev.name], ["Fecha", r.ev.date], ["Facturación", r.revenue.toFixed(2)], ["Gastos de caja", r.gastos.toFixed(2)], ["A cuadrar (efectivo + datáfono)", r.neto.toFixed(2)], ["Tickets", r.tickets], ["Ticket medio", r.medio.toFixed(2)], [], ["Barra", "Tickets", "Facturación"]];
    r.barras.forEach(b => rows.push([b.name, b.tickets, b.revenue.toFixed(2)]));
    rows.push([]); rows.push(["Producto", "Unidades", "Total"]); r.top.forEach(p => rows.push([p.name, p.uds, p.total.toFixed(2)]));
    if (r.inv.n) { rows.push([]); rows.push(["Invitaciones", r.inv.n, r.inv.valor.toFixed(2)]); r.inv.list.forEach(g => rows.push(["  " + g.name, g.uds, g.valor.toFixed(2)])); }
    if (r.liq.list.length) { rows.push([]); rows.push(["Proveedor", "Vendido", "Comisión", "A pagar"]); r.liq.list.forEach(g => rows.push([g.proveedor, g.vendido.toFixed(2), g.comision.toFixed(2), g.pagar.toFixed(2)])); }
    const csv = rows.map(r2 => r2.map(csvCell).join(";")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" })); a.download = `${r.ev.name.replace(/\s+/g, "_")}_resumen.csv`; a.click(); flash("CSV del evento descargado");
  };
  const Delta = ({ d }) => d == null ? null : <span style={{ fontSize: 12, fontWeight: 800, color: d >= 0 ? "var(--green)" : "var(--red)", background: d >= 0 ? "rgba(34,211,166,.12)" : "rgba(255,77,77,.12)", borderRadius: 20, padding: "2px 8px" }}>{d >= 0 ? "▲" : "▼"} {Math.abs(d)}% vs anterior</span>;
  const Kpi = ({ l, v, c, sub }) => <div style={S.statBox}><div style={S.miniLabel}>{l}</div><div style={{ fontSize: 22, fontWeight: 800, color: c || "var(--text)" }}>{v}</div>{sub && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}</div>;

  if (sel) {
    const r = todos.find(x => x.ev.id === sel); if (!r) { setSel(null); return null; }
    const hk = Array.from({ length: 24 }, (_, h) => h).filter(h => r.horas[h]); const mh = Math.max(1, ...Object.values(r.horas));
    return (
      <div>
        <button onClick={() => setSel(null)} style={{ ...S.smallBtn, marginBottom: 14 }}>← Volver al histórico</button>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          <div><div style={{ ...S.display, fontSize: 24 }}>{r.ev.name}</div><div style={{ color: "var(--muted)", fontSize: 13 }}>{r.ev.date ? dateFmt(r.ev.date) : "Sin fecha"}{r.ev.venue ? ` · ${r.ev.venue}` : ""} · {r.ev.closed ? "Caja cerrada" : "Abierto"}</div></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button onClick={() => csvEvento(r)} style={S.topBtn}><Ic n="download" s={15} style={II} />CSV del evento</button><button onClick={() => onOpenEvent(r.ev.id)} style={S.topBtn}>Abrir en el TPV →</button></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 14 }}>
          <Kpi l="Facturación" v={money(r.revenue)} c="var(--green)" sub={r.delta != null ? `${r.delta >= 0 ? "+" : ""}${r.delta}% vs ${r.prev.ev.name}` : null} />
          {r.gastos > 0 && <Kpi l="Gastos de caja" v={"-" + money(r.gastos)} c="var(--amber)" sub={`A cuadrar ${money(r.neto)}`} />}
          <Kpi l="Tickets" v={r.tickets} sub={`Ticket medio ${money(r.medio)}`} />
          {(r.efectivo > 0 || r.tarjeta > 0) && <Kpi l="Efectivo / Tarjeta" v={`${money(r.efectivo)}`} sub={`Tarjeta ${money(r.tarjeta)}`} />}
          <Kpi l="Invitaciones" v={r.inv.n} c="#c084fc" sub={money(r.inv.valor)} />
          {r.liq.list.length > 0 && <Kpi l="A pagar proveedores" v={money(r.liq.pagar)} c="var(--amber)" sub={`Comisión vuestra ${money(r.liq.comision)}`} />}
          <Kpi l="Anulaciones" v={r.anul} sub={money(r.anulImporte)} />
          {r.descuadre != null && <Kpi l="Descuadre caja" v={money(r.descuadre)} c={r.descuadre === 0 ? "var(--green)" : "var(--amber)"} sub={`${r.cierres} cierres Z`} />}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0,1fr)" : "minmax(0,1fr) minmax(0,1fr)", gap: 14 }}>
          <div style={S.panel}>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>Barras</div>
            {r.barras.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>Sin ventas.</div>}
            {r.barras.map(b => <div key={b.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 14 }}><span><Ic n="store" s={15} style={II} />{b.name} <span style={{ color: "var(--muted)" }}>· {b.tickets} tickets</span></span><b>{money(b.revenue)}</b></div>)}
            <div style={{ fontWeight: 800, margin: "16px 0 10px" }}>Ventas por hora {r.pico != null && <span style={{ fontWeight: 600, color: "var(--muted)", fontSize: 12 }}>· pico {String(r.pico).padStart(2, "0")}:00</span>}</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 90 }}>
              {hk.map(h => <div key={h} style={{ flex: 1, textAlign: "center" }}><div style={{ height: Math.max(4, r.horas[h] / mh * 70), background: h === r.pico ? "var(--accent)" : "var(--surface2)", borderRadius: 4 }} /><div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>{h}h</div></div>)}
            </div>
          </div>
          <div style={S.panel}>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>Productos</div>
            {r.top.slice(0, 10).map((p, i) => <div key={p.name} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 14 }}><span>{i === 0 ? "🥇 " : i === 1 ? "🥈 " : i === 2 ? "🥉 " : ""}{p.name} <span style={{ color: "var(--muted)" }}>· {p.uds}</span></span><b>{money(p.total)}</b></div>)}
            {r.inv.n > 0 && <><div style={{ fontWeight: 800, margin: "16px 0 8px" }}><Ic n="gift" s={15} style={II} />Invitaciones</div>{r.inv.list.map(g => <div key={g.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}><span>{g.uds} × {g.name}</span><span>{money(g.valor)}</span></div>)}</>}
            {r.liq.list.length > 0 && <><div style={{ fontWeight: 800, margin: "16px 0 8px" }}><Ic n="users" s={15} style={II} />Proveedores</div>{r.liq.list.map(g => <div key={g.proveedor} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}><span>{g.proveedor}</span><span>pagar <b style={{ color: "var(--amber)" }}>{money(g.pagar)}</b></span></div>)}</>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div><div style={{ ...S.display, fontSize: 24 }}>Histórico</div><div style={{ color: "var(--muted)", fontSize: 13 }}>Todos los eventos de esta cuenta</div></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div style={S.miniSeg}>{[["mes", "Este mes"], ["90", "90 días"], ["anio", "Este año"], ["todo", "Todo"]].map(([k, l]) => <button key={k} onClick={() => setPeriodo(k)} style={{ ...S.miniSegBtn, ...(periodo === k ? S.miniSegOn : {}) }}>{l}</button>)}</div>
          <button onClick={csvPeriodo} style={S.smallBtn}><Ic n="download" s={15} style={II} />CSV</button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 16 }}>
        <Kpi l="Facturación total" v={money(round2(T.revenue))} c="var(--green)" sub={`${lista.length} eventos · media ${money(media)}`} />
        {T.gastos > 0 && <Kpi l="Gastos de caja" v={"-" + money(round2(T.gastos))} c="var(--amber)" sub={`A cuadrar ${money(round2(T.revenue - T.gastos))}`} />}
        <Kpi l="Tickets vendidos" v={T.tickets} sub={T.tickets ? `Ticket medio ${money(round2(T.revenue / T.tickets))}` : null} />
        {(T.efectivo > 0 || T.tarjeta > 0) && <Kpi l="Efectivo / Tarjeta" v={money(round2(T.efectivo))} sub={`Tarjeta ${money(round2(T.tarjeta))}`} />}
        <Kpi l="Invitaciones" v={T.invN} c="#c084fc" sub={money(round2(T.invV))} />
        {T.pagar > 0 && <Kpi l="A pagar proveedores" v={money(round2(T.pagar))} c="var(--amber)" sub={`Comisión ${money(round2(T.comision))}`} />}
        <Kpi l="Anulaciones" v={T.anul} sub={money(round2(T.anulImp))} />
        {T.hayDesc && <Kpi l="Descuadres de caja" v={money(round2(T.desc))} c={round2(T.desc) === 0 ? "var(--green)" : "var(--amber)"} />}
        {estrella && <Kpi l="Producto estrella" v={estrella[0]} sub={`${estrella[1]} unidades`} />}
      </div>
      {lista.length > 1 && (
        <div style={{ ...S.panel, marginBottom: 16 }}>
          <div style={{ fontWeight: 800, marginBottom: 12 }}>Facturación por evento</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {lista.slice().reverse().map(r => <div key={r.ev.id} style={{ display: "grid", gridTemplateColumns: isMobile ? "90px 1fr 70px" : "200px 1fr 90px", alignItems: "center", gap: 10, fontSize: 13 }}><span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.ev.name}</span><div style={{ height: 10, borderRadius: 6, background: "var(--surface2)", overflow: "hidden" }}><div style={{ width: (r.revenue / maxRev * 100) + "%", height: "100%", background: "var(--accent)", borderRadius: 6 }} /></div><b style={{ textAlign: "right" }}>{money(r.revenue)}</b></div>)}
          </div>
        </div>
      )}
      {lista.length === 0 && <Empty msg="No hay eventos en este periodo." />}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {lista.map(r => (
          <button key={r.ev.id} onClick={() => setSel(r.ev.id)} style={{ ...S.panel, textAlign: "left", color: "var(--text)", cursor: "pointer", padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}><div style={{ fontWeight: 800, fontSize: 16 }}>{r.ev.name}</div><div style={{ fontSize: 12.5, color: "var(--muted)" }}>{r.ev.date ? dateFmt(r.ev.date) : "Sin fecha"}{r.ev.venue ? ` · ${r.ev.venue}` : ""} · {(() => { const nb = r.barras.length || r.ev.puntos.length; return `${nb} ${nb === 1 ? "barra" : "barras"}`; })()} · {r.ev.closed ? "Cerrado ✅" : "Abierto"}</div></div>
              <div style={{ textAlign: "right" }}><div style={{ fontSize: 22, fontWeight: 800, color: "var(--green)" }}>{money(r.revenue)}</div><Delta d={r.delta} /></div>
            </div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>
              <span><b style={{ color: "var(--text)" }}>{r.tickets}</b> tickets · medio {money(r.medio)}</span>
              {r.top[0] && <span>🥇 {r.top[0].name} ({r.top[0].uds})</span>}
              {r.inv.n > 0 && <span><Ic n="gift" s={15} style={II} />{r.inv.n} invit. ({money(r.inv.valor)})</span>}
              {r.liq.list.length > 0 && <span><Ic n="users" s={15} style={II} />pagar {money(r.liq.pagar)}</span>}
              {r.pico != null && <span>⏰ pico {String(r.pico).padStart(2, "0")}:00</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Reports({ ev, evSales, evGastos = [], onVoidGasto, onPasarPrueba, role, onVoid, onCierreZ, flash, onBackup, lastBackup, onImported }) {
  const [backups, setBackups] = useState(null);
  const [showBackups, setShowBackups] = useState(false);
  const [showBkPanel, setShowBkPanel] = useState(false);
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
    const live = evSales.filter(s => s.puntoId === p.id && !s.voided && !isInvite(s));
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
  evSales.filter(s => !s.voided && !isInvite(s)).forEach(s => { rank[s.name] = rank[s.name] || { name: s.name, qty: 0, total: 0 }; rank[s.name].qty++; rank[s.name].total += s.price; });
  const ranking = Object.values(rank).sort((a, b) => b.qty - a.qty).slice(0, 6);
  const maxRank = Math.max(1, ...ranking.map(r => r.qty));
  const voided = evSales.filter(s => s.voided).slice(-15).reverse();

  const liq = liquidacion(ev, evSales);
  const inv = invitaciones(evSales);
  const gastosOk = evGastos.filter(g => !g.voided && !isEntrada(g));
  const entradasOk = evGastos.filter(g => !g.voided && isEntrada(g));
  const gTotal = sumMov(evGastos, "gasto"), eTotal = sumMov(evGastos, "entrada");
  const gTurnoDe = (pid) => sumMov(evGastos.filter(g => g.puntoId === pid && !g.closureId), "gasto");
  const eTurnoDe = (pid) => sumMov(evGastos.filter(g => g.puntoId === pid && !g.closureId), "entrada");
  const [confirmGasto, setConfirmGasto] = useState(null);
  const [confirmPrueba, setConfirmPrueba] = useState(null);
  const hhmm = (t) => t ? new Date(t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "";
  const EstadoChip = ({ p }) => {
    const e = p.estado || "prueba";
    const c = e === "abierta" ? "var(--green)" : e === "cerrada" ? "var(--red)" : "var(--amber)";
    const t = e === "abierta" ? `Venta abierta${p.abiertaEn ? " · " + hhmm(p.abiertaEn) : ""}` : e === "cerrada" ? `Cerrada${p.cerradaEn ? " · " + hhmm(p.cerradaEn) : ""}` : "Modo prueba";
    return <div style={{ display: "inline-block", fontSize: 12, fontWeight: 800, color: c, border: `1px solid ${c}`, borderRadius: 20, padding: "2px 9px", marginTop: 6 }}>{t}</div>;
  };
  const exportCSV = () => {
    const rows = [["Punto de venta", "Producto", "Precio", "Unidades", "Total"]];
    byPunto.forEach(b => { b.punto.products.forEach(p => { const q = b.perProduct[p.id] || 0; rows.push([b.punto.name, p.name, p.price.toFixed(2), q, (q * p.price).toFixed(2)]); }); rows.push([b.punto.name, "— SUBTOTAL —", "", b.count, b.revenue.toFixed(2)]); rows.push([b.punto.name, "Anulaciones", "", b.voids, ""]); rows.push([]); });
    rows.push(["TOTAL EVENTO", "", "", grandCount, grandRevenue.toFixed(2)]);
    if (ev.advanced) {
      const efe = round2(evSales.filter(s => !s.voided && s.pago === "efectivo").reduce((t, s) => t + s.price, 0));
      const tar = round2(evSales.filter(s => !s.voided && s.pago === "tarjeta").reduce((t, s) => t + s.price, 0));
      rows.push([]); rows.push(["ARQUEO", "Efectivo (en caja)", "", "", efe.toFixed(2)]); rows.push(["ARQUEO", "Tarjeta", "", "", tar.toFixed(2)]);
    }
    if (gastosOk.length) {
      rows.push([]); rows.push(["GASTOS DE CAJA", "Concepto", "Hora", "Barra", "Importe"]);
      gastosOk.forEach(g => rows.push(["GASTOS DE CAJA", g.concepto || "Gasto", new Date(g.ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }), ev.puntos.find(p => p.id === g.puntoId)?.name || "", g.importe.toFixed(2)]));
      rows.push(["TOTAL GASTOS", "", "", "", gTotal.toFixed(2)]);
      rows.push(["A CUADRAR (efectivo + datáfono)", "", "", "", round2(grandRevenue - gTotal).toFixed(2)]);
    }
    if (entradasOk.length) {
      rows.push([]); rows.push(["CAMBIO AÑADIDO", "Concepto", "Hora", "Barra", "Importe"]);
      entradasOk.forEach(g => rows.push(["CAMBIO AÑADIDO", g.concepto || "Cambio", new Date(g.ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }), ev.puntos.find(p => p.id === g.puntoId)?.name || "", g.importe.toFixed(2)]));
      rows.push(["TOTAL CAMBIO AÑADIDO", "", "", "", eTotal.toFixed(2)]);
    }
    if (inv.n) {
      rows.push([]); rows.push(["INVITACIONES", "Producto", "", "Unidades", "Valor"]);
      inv.list.forEach(g => rows.push(["INVITACIONES", g.name, "", g.uds, g.valor.toFixed(2)]));
      rows.push(["TOTAL INVITACIONES", "", "", inv.n, inv.valor.toFixed(2)]);
    }
    if (liq.list.length) {
      rows.push([]); rows.push(["LIQUIDACIÓN PROVEEDORES", "Producto", "Comisión %", "Unidades", "Vendido", "Comisión (nuestro)", "A pagar proveedor"]);
      liq.list.forEach(g => { g.lineas.forEach(l => rows.push([g.proveedor, l.name, String(l.pct).replace(".", ","), l.uds, l.vendido.toFixed(2), l.comision.toFixed(2), l.pagar.toFixed(2)])); rows.push([g.proveedor, "— TOTAL —", "", g.uds, g.vendido.toFixed(2), g.comision.toFixed(2), g.pagar.toFixed(2)]); });
      rows.push(["TOTAL PROVEEDORES", "", "", "", liq.vendido.toFixed(2), liq.comision.toFixed(2), liq.pagar.toFixed(2)]);
    }
    const csv = rows.map(r => r.map(csvCell).join(";")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${ev.name.replace(/\s+/g, "_")}_cierre.csv`; a.click(); flash("CSV exportado");
  };

  return (
    <>
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
        <h3 style={{ ...S.h3, margin: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>Resumen del evento · {ev.name} <span className="livedot" style={S.liveDot} /> <span style={{ fontSize: 12, color: "var(--green)" }}>en vivo</span></h3>
        <button onClick={exportCSV} style={{ ...S.smallBtn, padding: "8px 12px", fontSize: 13 }}>Exportar CSV</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: 14, marginBottom: 24 }}>
        {/* Cifras en blanco; color solo cuando significa algo: verde = dinero cobrado, rojo = problema */}
        <BigStat label="Facturación total" value={money(grandRevenue)} c="var(--green)" />
        <BigStat label="Tickets · evento" value={grandCount} />
        {gTotal > 0 && <BigStat label="Gastos de caja" value={"-" + money(gTotal)} />}
        {gTotal > 0 && <BigStat label="A cuadrar (efect. + datáfono)" value={money(round2(grandRevenue - gTotal))} />}
        <BigStat label="Anulaciones" value={totalVoids} c={totalVoids > 0 ? "var(--red)" : undefined} />
        <BigStat label="Puntos de venta" value={ev.puntos.length} />
        {ev.advanced && <BigStat label="Efectivo (en caja)" value={money(round2(evSales.filter(s => !s.voided && s.pago === "efectivo").reduce((t, s) => t + s.price, 0)))} c="var(--green)" />}
        {ev.advanced && <BigStat label="Tarjeta" value={money(round2(evSales.filter(s => !s.voided && s.pago === "tarjeta").reduce((t, s) => t + s.price, 0)))} />}
      </div>

      {/* ===== Copias de seguridad ===== */}
      {(() => {
        const mins = lastBackup ? Math.round((Date.now() - new Date(lastBackup).getTime()) / 60000) : null;
        const fresh = mins != null && mins <= 35;
        const pend = db.pendingCount();
        const enOrden = fresh && !pend;
        if (enOrden && !showBkPanel) return (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13, color: "var(--muted)", margin: "-8px 0 20px" }}>
            <span style={{ ...S.stDot, background: "var(--green)" }} />
            <span>Copia en la nube: hace {mins} min · todo subido</span>
            <button onClick={() => setShowBkPanel(true)} style={{ ...S.smallBtn, background: "transparent" }}>Opciones de copia</button>
          </div>
        );
        return (
          <div style={{ ...S.panel, marginBottom: 20, border: `1px solid ${fresh ? "var(--line)" : "var(--amber)"}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800 }}>Copias de seguridad</div>
                <div style={{ fontSize: 13, color: fresh ? "var(--green)" : "var(--amber)", fontWeight: 700, marginTop: 2 }}>
                  {lastBackup ? `Última copia en la nube: ${new Date(lastBackup).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} (hace ${mins} min)` : "Aún no hay copia en la nube desde este equipo"}
                </div>
                <div style={{ fontSize: 12, color: pend ? "var(--amber)" : "var(--muted)", marginTop: 2 }}>{pend ? `${pend} operaciones solo en este equipo (sin subir)` : "Todo lo de este equipo está en la nube"} · automáticas cada 30 min</div>
              </div>
              <button onClick={onBackup} style={{ ...S.btnPrimary, width: "auto", padding: "0 16px", minHeight: 42 }}>Hacer copia ahora</button>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <button onClick={() => { const v = !showBackups; setShowBackups(v); if (v) loadBk(); }} style={{ ...S.btnGhost, flex: "1 1 160px" }}>{showBackups ? "Ocultar historial" : "Ver historial de copias"}</button>
              <button onClick={downloadEmergency} style={{ ...S.btnGhost, flex: "1 1 160px" }}><Ic n="download" s={15} style={II} />Descargar copia de emergencia</button>
              <button onClick={() => fileRef.current && fileRef.current.click()} style={{ ...S.btnGhost, flex: "1 1 160px" }}><Ic n="folder" s={15} style={II} />Importar copia</button>
              <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={e => { const f = e.target.files && e.target.files[0]; if (f) importEmergency(f); e.target.value = ""; }} />
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>¿El equipo va a apagarse sin internet? Descarga la copia de emergencia a un USB e impórtala en el otro ordenador. Nunca se duplica ninguna venta.</div>

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
              <div style={{ fontWeight: 700, fontSize: 14 }}><Ic n="store" s={15} style={II} />{b.punto.name}</div>
              <EstadoChip p={b.punto} />
              <div style={{ fontSize: 22, fontWeight: 800, color: "var(--green)", marginTop: 4 }}>{money(b.revenue)}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{b.count} tickets · {b.voids} anul.</div>
              {gTurnoDe(b.punto.id) > 0 && <div style={{ fontSize: 12, color: "var(--amber)", marginTop: 4, fontWeight: 700 }}><Ic n="cash" s={15} style={II} />Gastos del turno: -{money(gTurnoDe(b.punto.id))}</div>}
              {eTurnoDe(b.punto.id) > 0 && <div style={{ fontSize: 12, color: "var(--green)", marginTop: 4, fontWeight: 700 }}><Ic n="plus" s={15} style={II} />Cambio añadido: +{money(eTurnoDe(b.punto.id))}</div>}
              {(ev.advanced || ev.pedirFondo !== false) && b.punto.estado === "abierta" && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}><Ic n="cash" s={15} style={II} />Fondo: <b style={{ color: b.punto.fondo != null ? "var(--green)" : "var(--amber)" }}>{b.punto.fondo != null ? money(b.punto.fondo) : "sin declarar"}</b>{db.pendingPunto(b.punto.id) && <span style={{ color: "var(--amber)" }}> · ⏳ subiendo…</span>}</div>}
              {(role === "admin" || role === "supervisor") && (b.punto.estado === "abierta" || evSales.some(x => x.puntoId === b.punto.id && !x.closureId)) && <button onClick={() => {
                const abiertas = evSales.filter(s => s.puntoId === b.punto.id && !s.voided && !s.closureId && !isInvite(s));
                const efe = round2(abiertas.filter(s => s.pago === "efectivo").reduce((t, s) => t + s.price, 0));
                const fact = round2(abiertas.reduce((t, s) => t + s.price, 0));
                const fondo = round2(b.punto.fondo || 0);
                const gas = gTurnoDe(b.punto.id), ent = eTurnoDe(b.punto.id);
                const base = ev.advanced ? efe : fact;
                setCountZ({ punto: b.punto, advanced: !!ev.advanced, fondo, efectivo: base, gastos: gas, entradas: ent, esperado: round2(fondo + base + ent - gas), socios: efectivoSocios(abiertas), valor: "" });
              }} style={{ ...S.smallBtn, marginTop: 8, width: "100%", color: "var(--accent)", borderColor: "var(--accent)" }}>Cierre Z</button>}
              {role === "admin" && onPasarPrueba && b.punto.estado !== "prueba" && !(b.punto.estado === "abierta" && evSales.some(x => x.puntoId === b.punto.id && !x.closureId && !x.voided)) && (confirmPrueba === b.punto.id
                ? <div style={{ display: "flex", gap: 6, marginTop: 8 }}><button onClick={() => { onPasarPrueba(b.punto); setConfirmPrueba(null); }} style={{ ...S.smallBtn, flex: 1, color: "var(--amber)", borderColor: "var(--amber)" }}>✓ Sí, a prueba</button><button onClick={() => setConfirmPrueba(null)} style={S.smallBtn}>✗</button></div>
                : <button onClick={() => setConfirmPrueba(b.punto.id)} style={{ ...S.smallBtn, marginTop: 8, width: "100%" }}>{b.punto.estado === "cerrada" ? "↺ Reabrir barra (vuelve a prueba)" : "Volver a modo prueba"}</button>)}
            </div>
          ))}
        </div>
      </div>

      {ev.qrActivo && <InformeQR ev={ev} evSales={evSales} />}

      {/* Gastos / retiradas de caja (no cambian la facturación; se restan de lo que debe haber) */}
      {evGastos.length > 0 && (
        <div style={{ ...S.panel, marginBottom: 16 }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}><Ic n="cash" s={15} style={II} />Movimientos de caja</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>Gastos (dinero que sale) y cambio añadido (dinero que entra). La facturación no cambia; el cierre lo tiene en cuenta.</div>
          <div style={{ background: "var(--surface2)", borderRadius: 14, padding: 14, marginBottom: 12, fontSize: 14, maxWidth: 460 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--muted)" }}>Facturado</span><b>{money(grandRevenue)}</b></div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}><span style={{ color: "var(--amber)" }}>− Gastos de caja</span><b style={{ color: "var(--amber)" }}>{money(gTotal)}</b></div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line)", fontSize: 16 }}><span>A cuadrar (efectivo + datáfono)</span><b style={{ color: "var(--green)" }}>{money(round2(grandRevenue - gTotal))}</b></div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Sin contar el fondo inicial{eTotal > 0 ? ` ni el cambio añadido (+${money(eTotal)})` : ""}.</div>
            {ev.advanced && (() => { const efe = round2(evSales.filter(s => !s.voided && s.pago === "efectivo").reduce((t, s) => t + s.price, 0)); const tar = round2(evSales.filter(s => !s.voided && s.pago === "tarjeta").reduce((t, s) => t + s.price, 0)); return (
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>Efectivo {money(efe)} − gastos {money(gTotal)} = <b style={{ color: "var(--text)" }}>{money(round2(efe - gTotal))}</b> en cajones (más el fondo) · Datáfono {money(tar)}</div>
            ); })()}
          </div>
          {evGastos.slice().reverse().map(g => {
            const pn = ev.puntos.find(p => p.id === g.puntoId)?.name || "—";
            return (
              <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line)", fontSize: 13.5, opacity: g.voided ? .45 : 1 }}>
                <span style={{ color: "var(--muted)", flexShrink: 0 }}>{new Date(g.ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</span>
                <span style={{ flex: 1, minWidth: 0 }}><b>{isEntrada(g) ? "" : ""}{g.concepto || (isEntrada(g) ? "Cambio añadido" : "Gasto")}</b> <span style={{ color: "var(--muted)" }}>· 📍 {pn}{g.por && g.por !== pn ? ` · ${g.por}` : ""}{g.closureId ? " · cerrado en Z" : ""}{!g.synced ? " · ⏳" : ""}</span></span>
                <b style={{ flexShrink: 0, textDecoration: g.voided ? "line-through" : "none", color: g.voided ? "var(--muted)" : isEntrada(g) ? "var(--green)" : "var(--amber)" }}>{isEntrada(g) ? "+" : "-"}{money(g.importe)}</b>
                {g.voided ? <span style={{ fontSize: 12, color: "var(--muted)", flexShrink: 0 }}>Anulado</span>
                  : (role === "admin" || role === "supervisor") && !g.closureId && onVoidGasto ? (confirmGasto === g.id
                    ? <span style={{ display: "flex", gap: 6, flexShrink: 0 }}><button onClick={() => { onVoidGasto(g); setConfirmGasto(null); }} style={{ ...S.smallBtn, color: "var(--red)", borderColor: "var(--red)" }}>✓ Sí</button><button onClick={() => setConfirmGasto(null)} style={S.smallBtn}>✗</button></span>
                    : <button onClick={() => setConfirmGasto(g.id)} style={{ ...S.smallBtn, flexShrink: 0 }}>Anular</button>) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Invitaciones (solo control: no suman a la facturación) */}
      {inv.n > 0 && (
        <div style={{ ...S.panel, marginBottom: 16 }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}><Ic n="gift" s={15} style={II} />Invitaciones</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>No suman a la facturación ni a la caja. Valor = precio normal del producto.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 14 }}>
            <div style={S.statBox}><div style={S.miniLabel}>Invitaciones dadas</div><div style={{ fontSize: 22, fontWeight: 800, color: "#c084fc" }}>{inv.n}</div></div>
            <div style={S.statBox}><div style={S.miniLabel}>Valor regalado</div><div style={{ fontSize: 22, fontWeight: 800, color: "#c084fc" }}>{money(inv.valor)}</div></div>
          </div>
          {inv.list.map(g => <div key={g.name} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 14, padding: "6px 0", borderBottom: "1px solid var(--line)" }}><span><b>{g.uds}</b> × {g.name}</span><b>{money(g.valor)}</b></div>)}
          {ev.puntos.filter(p => inv.byPunto[p.id]).length > 1 && <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--muted)" }}>{ev.puntos.filter(p => inv.byPunto[p.id]).map(p => `${p.name}: ${inv.byPunto[p.id].uds} (${money(round2(inv.byPunto[p.id].valor))})`).join(" · ")}</div>}
        </div>
      )}

      {/* Liquidación de proveedores (solo informativo: no cambia la facturación) */}
      {liq.list.length > 0 && (
        <div style={{ ...S.panel, marginBottom: 16 }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}><Ic n="users" s={15} style={II} />Proveedores · Liquidación</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>Ya incluido en la facturación de arriba. Esto solo separa qué es del proveedor y qué os queda.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 14 }}>
            <div style={S.statBox}><div style={S.miniLabel}>Vendido de proveedores</div><div style={{ fontSize: 22, fontWeight: 800 }}>{money(liq.vendido)}</div></div>
            <div style={S.statBox}><div style={S.miniLabel}>Comisión (vuestro)</div><div style={{ fontSize: 22, fontWeight: 800, color: "var(--green)" }}>{money(liq.comision)}</div></div>
            <div style={S.statBox}><div style={S.miniLabel}>A pagar a proveedores</div><div style={{ fontSize: 22, fontWeight: 800, color: "var(--amber)" }}>{money(liq.pagar)}</div></div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {liq.list.map(g => (
              <div key={g.proveedor} style={{ background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 12, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 800 }}>{g.proveedor}</div>
                  <div style={{ fontSize: 13 }}>Vendido <b>{money(g.vendido)}</b> · Vuestro <b style={{ color: "var(--green)" }}>{money(g.comision)}</b> · A pagar <b style={{ color: "var(--amber)", fontSize: 16 }}>{money(g.pagar)}</b></div>
                </div>
                <div style={{ marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 6 }}>
                  {g.lineas.map(l => <div key={l.name + l.pct} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5, color: "var(--muted)", padding: "3px 0" }}><span>{l.uds} × {l.name} <b style={{ color: "var(--text)" }}>({l.pct}%)</b></span><span>{money(l.vendido)} → pagar {money(l.pagar)}</span></div>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* curva por hora + ranking */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px,1fr))", gap: 16, marginBottom: 16 }}>
        <div style={S.panel}>
          <div style={{ fontWeight: 800, marginBottom: 12 }}>Actividad por hora</div>
          {hourKeys.length === 0 ? <div style={{ color: "var(--muted)", fontSize: 13 }}>Sin datos.</div> : (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 130 }}>
              {hourKeys.map(h => <div key={h} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}><div style={{ width: "100%", height: `${(hours[h] / maxHour) * 100}%`, background: "var(--accent)", borderRadius: "4px 4px 0 0", minHeight: 3 }} /><span style={{ fontSize: 12, color: "var(--muted)" }}>{h}h</span></div>)}
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14, borderBottom: "1px solid var(--line)", paddingBottom: 10 }}><div style={{ fontWeight: 800, fontSize: 16 }}><Ic n="store" s={15} style={II} />{b.punto.name}</div><div style={{ fontSize: 13, color: "var(--muted)" }}><b style={{ color: "var(--text)" }}>{b.count}</b> tickets · <b style={{ color: "var(--green)" }}>{money(b.revenue)}</b></div></div>
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
              <div style={{ display: "flex", justifyContent: "center", color: "var(--amber)" }}><Ic n="receipt" s={40} /></div>
              <div style={{ fontWeight: 900, fontSize: 19 }}>Cierre Z · {countZ.punto.name}</div>
              <div style={{ color: "var(--muted)", fontSize: 13 }}>{countZ.advanced ? "Cuenta el dinero del cajón" : "Cuenta el dinero del cajón y súmale el total del datáfono"}</div>
            </div>
            <div style={{ background: "var(--surface2)", borderRadius: 14, padding: 14, marginBottom: 12, fontSize: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--muted)" }}>Fondo inicial</span><b>{money(countZ.fondo)}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}><span style={{ color: "var(--muted)" }}>{countZ.advanced ? "+ Ventas en efectivo" : "+ Facturado del turno"}</span><b>{money(countZ.efectivo)}</b></div>
              {countZ.entradas > 0 && <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}><span style={{ color: "var(--green)" }}>+ Cambio añadido</span><b style={{ color: "var(--green)" }}>{money(countZ.entradas)}</b></div>}
              {countZ.gastos > 0 && <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}><span style={{ color: "var(--amber)" }}>− Gastos de caja</span><b style={{ color: "var(--amber)" }}>{money(countZ.gastos)}</b></div>}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line)", fontSize: 16 }}><span>Debe haber {countZ.advanced ? "en el cajón" : "(cajón + datáfono)"}</span><b style={{ color: "var(--green)" }}>{money(countZ.esperado)}</b></div>
            </div>
            {(countZ.socios || []).length > 0 && (
              <div style={{ background: "rgba(255,180,0,.1)", border: "1px solid rgba(255,180,0,.4)", borderRadius: 12, padding: "10px 12px", marginBottom: 12, fontSize: 13.5 }}>
                <b style={{ color: "var(--amber)" }}>💶 Efectivo que tienen los socios</b>
                {countZ.socios.map(x => <div key={x.nombre} style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}><span>{x.nombre}</span><b>{money(x.importe)}</b></div>)}
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Está incluido en «Debe haber»: pídeselo antes de contar.</div>
              </div>
            )}
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>{countZ.advanced ? "¿Cuánto has contado en el cajón?" : "¿Cuánto suman cajón + datáfono?"} (puedes dejarlo vacío)</div>
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

function BigStat({ label, value, c = "var(--text)" }) {
  return <div style={{ ...S.panel, padding: 18 }}><div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div><div style={{ fontSize: 26, fontWeight: 800, color: c, marginTop: 4 }}>{value}</div></div>;
}


/* ---------------------- PIN modal ---------------------- */
// Bloqueo anti fuerza bruta: tras 5 fallos seguidos, espera creciente (30 s, 60 s, 2 min… máx. 15 min). Se guarda en el equipo.
const PIN_LOCK_KEY = "tixfast_pin_lock";
const pinLockRead = () => { try { return JSON.parse(localStorage.getItem(PIN_LOCK_KEY)) || { fails: 0, until: 0 }; } catch { return { fails: 0, until: 0 }; } };
const pinLockWrite = (v) => { try { localStorage.setItem(PIN_LOCK_KEY, JSON.stringify(v)); } catch {} };
// Celda CSV segura: evita que Excel ejecute fórmulas escritas en nombres (=, +, -, @) y que ";" rompa columnas
function csvCell(x) { if (x == null) return ""; if (typeof x === "number") return String(x); let v = String(x).replace(/[;\r\n]+/g, " "); if (/^[=+\-@\t]/.test(v) && !/^-?\d+([.,]\d+)?$/.test(v)) v = "'" + v; return v; }
/* ---------------------- PIN y contraseñas de acceso (Ajustes) ----------------------
   Se guardan como huella cifrada: no se pueden leer, solo comprobar. Necesita internet para cambiarlos. */
function AccesoSeguro({ ev, dispatch, flash }) {
  const [edit, setEdit] = useState(null);   // "admin" | "supervisor"
  const filas = [["admin", "Administrador", "Configura todo"], ["supervisor", "Supervisor", "Informes, cierres y anulaciones"]];
  return (
    <div style={{ margin: "4px 0 12px" }}>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Acceso de administrador y supervisor</div>
      {filas.map(([rol, t, d]) => {
        const e = estadoDe(ev, rol);
        const desc = e.protegido ? (e.tipo === "clave" ? "Contraseña · protegida" : `PIN de ${e.largo} números · protegido`) : e.fabrica ? "PIN de fábrica" : "PIN sin proteger";
        const malo = !e.protegido;
        return (
          <div key={rol} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: `1px solid ${malo ? "var(--amber)" : "var(--line)"}`, borderRadius: 12, marginBottom: 8 }}>
            <span style={{ fontSize: 20 }} aria-hidden>{malo ? "⚠️" : "🔐"}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b style={{ display: "block" }}>{t}</b>
              <span style={{ fontSize: 12.5, color: malo ? "var(--amber)" : "var(--muted)" }}>{desc}{malo ? (e.fabrica ? " · cámbialo antes del evento" : " · se puede leer: guárdalo de nuevo para protegerlo") : ` · ${d}`}</span>
            </span>
            <button onClick={() => setEdit(rol)} style={{ ...S.smallBtn, flexShrink: 0 }}>{malo ? "Proteger" : "Cambiar"}</button>
          </div>
        );
      })}
      {edit && <EditorAcceso ev={ev} rol={edit} onClose={() => setEdit(null)} onGuardado={(patch) => { dispatch({ type: "LOCAL_EVENT_PATCH", id: ev.id, patch }); setEdit(null); flash(edit === "admin" ? "Acceso de administrador protegido" : "Acceso de supervisor protegido"); }} flash={flash} />}
    </div>
  );
}

function EditorAcceso({ ev, rol, onClose, onGuardado, flash }) {
  const isMobile = useIsMobile();
  const actual = estadoDe(ev, rol);
  const [tipo, setTipo] = useState(actual.tipo === "clave" ? "clave" : "pin");
  const [v1, setV1] = useState(""); const [v2, setV2] = useState(""); const [ver, setVer] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const otro = rol === "admin" ? "supervisor" : "admin";
  const prob = v1 ? problemaPin(v1, tipo) : "";
  const f = fuerzaPin(v1, tipo);
  const limpiar = (x) => tipo === "pin" ? x.replace(/\D/g, "").slice(0, 12) : x.slice(0, 64);
  const guardar = async () => {
    setErr("");
    const p = problemaPin(v1, tipo); if (p) { setErr(p); return; }
    if (v1 !== v2) { setErr(tipo === "pin" ? "Los dos PIN no coinciden" : "Las dos contraseñas no coinciden"); return; }
    if (!cifradoDisponible()) { setErr("Este navegador no permite proteger el PIN. Usa Chrome actualizado."); return; }
    if (!navigator.onLine) { setErr("Sin internet: el cambio tiene que llegar a todos los equipos. Conéctate y vuelve a intentarlo."); return; }
    setBusy(true);
    try {
      if (await comprobarPin(v1, secretoDe(ev, otro))) { setErr(`Tiene que ser distinto al del ${otro === "admin" ? "administrador" : "supervisor"}`); setBusy(false); return; }
      const huella = await crearHuella(v1, tipo);
      await db.guardarAcceso(ev.id, rol, huella);
      onGuardado({ [`pin_${rol}_huella`]: huella, [`pin_${rol}`]: null });
    } catch (e) { console.error(e); setErr("No se ha podido guardar. Revisa la conexión e inténtalo de nuevo."); }
    setBusy(false);
  };
  const campo = (val, set, ph, auto) => (
    <input autoFocus={auto} type={ver ? "text" : "password"} inputMode={tipo === "pin" ? "numeric" : "text"} autoComplete="new-password" autoCapitalize="off" autoCorrect="off" spellCheck={false}
      aria-label={ph} placeholder={ph} value={val} onChange={e => { set(limpiar(e.target.value)); setErr(""); }} onKeyDown={e => { if (e.key === "Enter") guardar(); }}
      style={{ ...S.input, fontSize: 18, fontWeight: 700, letterSpacing: tipo === "pin" && !ver ? 4 : 0, marginBottom: 8 }} />
  );
  const colores = ["var(--line)", "var(--amber)", "var(--green)", "var(--green)"];
  return (
    <div style={isMobile ? S.sheetWrap : S.overlay} onClick={busy ? undefined : onClose}>
      <div role="dialog" aria-label={`Acceso de ${rol}`} className={isMobile ? "sheet-anim" : ""} style={isMobile ? S.sheet : { ...S.pinCard, width: 400, textAlign: "left" }} onClick={e => e.stopPropagation()}>
        {isMobile && <div style={S.grab} />}
        <div style={{ fontWeight: 900, fontSize: 18 }}>🔐 Acceso de {rol === "admin" ? "administrador" : "supervisor"}</div>
        <div style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 14px" }}>Se guarda cifrado: nadie puede leerlo, ni desde la base de datos. Funciona también sin internet.</div>
        <div role="radiogroup" aria-label="Tipo de acceso" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 12 }}>
          {[["pin", "PIN numérico", "Rápido en la barra"], ["clave", "Contraseña", "Letras y números"]].map(([k, t, d]) => (
            <button key={k} role="radio" aria-checked={tipo === k} onClick={() => { setTipo(k); setV1(""); setV2(""); setErr(""); }}
              style={{ ...S.chip, textAlign: "left", padding: "10px 12px", ...(tipo === k ? S.chipActive : {}) }}><b style={{ display: "block" }}>{t}</b><span style={{ fontSize: 12, opacity: .8 }}>{d}</span></button>))}
        </div>
        {campo(v1, setV1, tipo === "pin" ? "Nuevo PIN (de 4 a 12 números)" : "Nueva contraseña (mínimo 8)", true)}
        {campo(v2, setV2, tipo === "pin" ? "Repite el PIN" : "Repite la contraseña", false)}
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "2px 0 10px" }}>
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 4 }}>{[1, 2, 3].map(i => <span key={i} style={{ height: 5, borderRadius: 5, background: f >= i ? colores[f] : "var(--line)" }} />)}</div>
          <span style={{ fontSize: 12, fontWeight: 700, color: prob ? "var(--amber)" : "var(--muted)", minWidth: 80, textAlign: "right" }}>{!v1 ? "" : prob ? "No válido" : ["", "Aceptable", "Bueno", "Muy bueno"][f]}</span>
          <button type="button" onClick={() => setVer(!ver)} style={{ ...S.smallBtn, padding: "4px 10px" }} aria-label={ver ? "Ocultar" : "Mostrar"}>{ver ? "🙈" : "👁"}</button>
        </div>
        <div style={{ fontSize: 12.5, color: err || prob ? "var(--red)" : "var(--muted)", minHeight: 18, fontWeight: err || prob ? 700 : 400 }}>{err || prob || (tipo === "pin" ? "Consejo: 6 números o más. Nada de fechas ni series." : "Consejo: una frase corta con algún número, fácil de recordar.")}</div>
        <div style={{ fontSize: 12, color: "var(--muted)", margin: "10px 0 12px", background: "var(--surface2, rgba(127,127,127,.08))", borderRadius: 10, padding: "8px 10px" }}>Antes de cambiarlo, actualiza la app en todos los equipos del evento (Menú → Buscar actualización). Un equipo con una versión antigua no podrá entrar como {rol === "admin" ? "administrador" : "supervisor"} hasta actualizarse.</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} disabled={busy} style={{ ...S.btnGhost, flex: "0 0 auto" }}>Cancelar</button>
          <button onClick={guardar} disabled={busy || !v1 || !v2} style={{ ...S.btnPrimary, flex: 1, opacity: busy || !v1 || !v2 ? .5 : 1 }}>{busy ? "Protegiendo…" : "Guardar"}</button>
        </div>
      </div>
    </div>
  );
}

function PinModal({ secreto, onOk, onClose, label }) {
  const isMobile = useIsMobile();
  const s = secreto || { plano: null, huella: null, tipo: "pin", largo: 4 };
  const esClave = s.tipo === "clave";
  const [pin, setPin] = useState(""); const [err, setErr] = useState(false); const [ver, setVer] = useState(false);
  const [mirando, setMirando] = useState(false);
  const [lock, setLock] = useState(pinLockRead); const [now, setNow] = useState(Date.now());
  const locked = lock.until > now;
  const hay = !!(s.huella || s.plano);
  const largo = esClave ? 0 : (s.largo || 0);
  useEffect(() => { if (!locked) return; const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, [locked]);
  // Comprueba el intento contra la huella (o el PIN antiguo) y lleva la cuenta de fallos de este equipo
  const probar = async (intento) => {
    if (locked || !hay || mirando || !intento) return;
    setMirando(true);
    const bien = await comprobarPin(intento, s).catch(() => false);
    setMirando(false);
    if (bien) { pinLockWrite({ fails: 0, until: 0 }); setTimeout(onOk, 120); return; }
    setErr(true); setTimeout(() => setPin(""), 400);
    const cur = pinLockRead(); const fails = cur.fails + 1;
    const next = { fails, until: fails >= 5 ? Date.now() + Math.min(15 * 60, 30 * 2 ** (fails - 5)) * 1000 : 0 };
    pinLockWrite(next); setLock(next); setNow(Date.now());
  };
  const press = (d) => {
    if (locked || !hay || mirando) return;
    const np = (pin + d).slice(0, 12); setPin(np); setErr(false);
    if (largo && np.length === largo) probar(np);
  };
  const secs = Math.max(0, Math.ceil((lock.until - now) / 1000));
  const aviso = locked ? `Demasiados intentos. Espera ${secs >= 60 ? Math.floor(secs / 60) + " min " + (secs % 60) + " s" : secs + " s"}` : mirando ? "Comprobando…" : err ? (esClave ? "Contraseña incorrecta" : "PIN incorrecto") : (label || (esClave ? "Introduce la contraseña" : "Introduce el PIN"));
  return (
    <div style={isMobile ? S.sheetWrap : S.overlay} onClick={onClose}>
      <div role="dialog" aria-label={label || "Acceso restringido"} className={isMobile ? "sheet-anim" : ""} style={isMobile ? { ...S.sheet, animation: err ? "shake .3s" : undefined } : { ...S.pinCard, animation: err ? "shake .3s" : "none" }} onClick={e => e.stopPropagation()}>
        {isMobile && <div style={S.grab} />}
        <div style={{ textAlign: "center", fontWeight: 800, fontSize: 18, marginBottom: 4 }}>🔒 Acceso restringido</div>
        <div aria-live="polite" style={{ textAlign: "center", color: locked || err ? "var(--red)" : "var(--muted)", fontSize: 13, marginBottom: 16, fontWeight: locked || err ? 700 : 400 }}>{aviso}</div>
        {esClave ? (
          <form onSubmit={e => { e.preventDefault(); probar(pin); }}>
            <div style={{ position: "relative" }}>
              <input autoFocus type={ver ? "text" : "password"} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} disabled={locked} aria-label="Contraseña"
                value={pin} maxLength={64} onChange={e => { setPin(e.target.value); setErr(false); }} placeholder="Contraseña"
                style={{ ...S.input, fontSize: 18, padding: "14px 52px 14px 14px", textAlign: "center", fontWeight: 700 }} />
              <button type="button" onClick={() => setVer(!ver)} aria-label={ver ? "Ocultar contraseña" : "Ver contraseña"} style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", ...S.smallBtn, padding: "6px 10px" }}>{ver ? "🙈" : "👁"}</button>
            </div>
            <button type="submit" disabled={locked || !pin || mirando} style={{ ...S.btnPrimary, marginTop: 12, opacity: locked || !pin || mirando ? .5 : 1 }}>{mirando ? "Comprobando…" : "Entrar"}</button>
          </form>
        ) : (<>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 18, flexWrap: "wrap" }}>{Array.from({ length: Math.max(largo || 4, pin.length) }).map((_, i) => <div key={i} style={{ width: 14, height: 14, borderRadius: "50%", background: i < pin.length ? (err ? "var(--red)" : "var(--accent)") : "var(--line)" }} />)}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => <button key={n} disabled={locked} onClick={() => press(n)} style={{ ...S.pinBtn, opacity: locked ? .35 : 1 }}>{n}</button>)}
            <button onClick={() => setPin("")} style={{ ...S.pinBtn, fontSize: 14 }}>C</button>
            <button disabled={locked} onClick={() => press(0)} style={{ ...S.pinBtn, opacity: locked ? .35 : 1 }}>0</button>
            <button onClick={() => setPin(pin.slice(0, -1))} style={{ ...S.pinBtn, fontSize: 18 }}>⌫</button>
          </div>
          {!largo && <button onClick={() => probar(pin)} disabled={!pin || locked || mirando} style={{ ...S.btnPrimary, marginTop: 12, opacity: !pin || locked ? .5 : 1 }}>Entrar</button>}
        </>)}
      </div>
    </div>
  );
}

// Importe del fondo previsto de una barra: se guarda al salir del campo o con Enter
function FondoPrevistoInput({ value, onSave }) {
  const [v, setV] = useState(value != null ? String(value).replace(".", ",") : "");
  useEffect(() => { setV(value != null ? String(value).replace(".", ",") : ""); }, [value]);
  const commit = () => {
    const t = v.trim().replace(",", ".");
    const n = t === "" ? null : round2(parseFloat(t));
    if (t !== "" && !(n >= 0 && n < 1000000)) { setV(value != null ? String(value).replace(".", ",") : ""); return; }
    if (n !== (value ?? null)) onSave(n);
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
      <input inputMode="decimal" value={v} placeholder="—" onChange={e => setV(e.target.value.replace(/[^\d.,]/g, "").slice(0, 9))} onBlur={commit} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} style={{ ...S.input, width: 96, textAlign: "right", fontWeight: 800, fontSize: 16 }} aria-label="Fondo previsto en euros" />
      <span style={{ color: "var(--muted)", fontWeight: 700 }}>€</span>
    </div>
  );
}

/* ¿Algún rol sigue con el PIN de fábrica? (con huella nunca lo es) */
const pinsDeFabrica = (ev) => !!ev.id && (estadoDe(ev, "admin").fabrica || estadoDe(ev, "supervisor").fabrica);
const Field = ({ label, children }) => <div style={{ marginBottom: 12, flex: 1 }}><div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 5 }}>{label}</div>{children}</div>;
const Empty = ({ msg }) => <div style={{ textAlign: "center", padding: 50, color: "var(--muted)", border: "2px dashed var(--line)", borderRadius: 16 }}>{msg}</div>;

// Color de texto legible sobre un color de producto: oscuro sobre tonos claros (verde, ámbar, amarillo…)
function lumOf(hex) { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "")); if (!m) return 0.2; const n = parseInt(m[1], 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; }
function inkOn(hex) { const L = lumOf(hex) * .82; /* media del degradado (se oscurece hacia abajo) */ return (1.05 / (L + .05)) >= 3 ? "#fff" : "#14161d"; /* 3:1 = mínimo para texto grande */ }
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
@keyframes invPulse{0%,100%{box-shadow:0 0 0 3px #e9d5ff, 0 0 18px rgba(168,85,247,.55)}50%{box-shadow:0 0 0 5px #c084fc, 0 0 30px rgba(168,85,247,.85)}}
.prueba-frame{position:fixed;inset:0;z-index:60;pointer-events:none;border:7px solid transparent;border-image:repeating-linear-gradient(135deg,#ffb400 0 16px,#1a1205 16px 32px) 7;}
@media print{.prueba-frame{display:none !important;}}
.tile.inviting{animation:invPulse 1.2s ease-in-out infinite;}
.invite-banner{animation:invPulse 1.2s ease-in-out infinite;}
@keyframes jiggle{from{transform:rotate(-.7deg)}to{transform:rotate(.7deg)}}
.tile.arranging:active{transform:none;}
@keyframes sheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
.livedot{animation:pulse 1.4s infinite}
.sheet-anim{animation:sheetUp .22s ease}
@media print{
 html,body{margin:0 !important;padding:0 !important;background:#fff !important;height:auto !important;min-height:0 !important;overflow:visible !important;}
 #thermal-print-area,.ticket-page{height:auto !important;min-height:0 !important;}
 .ticket-page{break-inside:avoid;page-break-inside:avoid;}
 #root{display:none !important;}
 body>*:not(#thermal-print-area){display:none !important;}
 #thermal-print-area,#thermal-print-area *{visibility:visible !important;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;color-adjust:exact !important;}
 #thermal-print-area{position:static !important;left:0 !important;top:0 !important;width:auto !important;margin:0 !important;}
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
  sideLabel: { fontSize: 12, fontWeight: 700, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--muted)", margin: "0 0 8px 2px" },
  sideDivider: { height: 1, background: "var(--line)", margin: "4px 0 6px" },
  menuRow: { display: "flex", alignItems: "center", gap: 11, width: "100%", background: "transparent", border: "none", borderRadius: 10, padding: "8px 8px", fontWeight: 650, fontSize: 13.5 },
  menuRowBig: { padding: "11px 12px", fontSize: 15, borderRadius: 0, borderBottom: "1px solid var(--line)" },
  menuIco: { width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", flexShrink: 0 },
  menuGroup: { background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 16, overflow: "hidden" },
  onOff: { fontSize: 12, fontWeight: 800, letterSpacing: .8, color: "var(--muted)", background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 20, padding: "3px 8px" },
  onOffOn: { color: "#1a1200", background: "var(--amber)", borderColor: "var(--amber)" },
  stDot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0, display: "inline-block" },
  mEvent: { fontSize: 15.5, fontWeight: 800, letterSpacing: "-.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.2 },
  mSub: { display: "flex", alignItems: "center", gap: 5, color: "var(--accent)", fontSize: 12, fontWeight: 700, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden" },
  mSelect: { background: "var(--surface2)", fontWeight: 800, padding: "9px 12px" },
  miniLabel: { fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1.2, fontWeight: 700, marginBottom: 2 },
  topTitle: { fontFamily: "Inter,sans-serif", fontVariationSettings: "'opsz' 32", fontWeight: 800, fontSize: 21, letterSpacing: "-.03em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  topSub: { display: "flex", alignItems: "center", gap: 10, color: "var(--muted)", fontSize: 12.5, marginTop: 4, flexWrap: "wrap" },
  barTag: { display: "inline-flex", alignItems: "center", gap: 5, color: "var(--accent)", background: "rgba(255,90,60,.1)", borderRadius: 20, padding: "3px 9px 3px 7px", fontWeight: 700, fontSize: 12 },
  topBtn: { display: "inline-flex", alignItems: "center", gap: 8, background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 11, padding: "10px 16px", fontWeight: 700, fontSize: 14 },
  bTabIco: { display: "grid", placeItems: "center", width: 46, height: 28, borderRadius: 14, transition: "background .15s" },
  bTabIcoActive: { background: "rgba(255,90,60,.14)", color: "var(--accent)" },
  gateIco: { width: 52, height: 52, borderRadius: 16, display: "grid", placeItems: "center", background: "var(--bg)", border: "1px solid var(--line)", color: "var(--text)" },
  gateIcoMain: { background: "rgba(255,90,60,.12)", borderColor: "rgba(255,90,60,.35)", color: "var(--accent)" },
  sideMobile: { width: "100%", boxSizing: "border-box", background: "var(--surface)", borderBottom: "1px solid var(--line)", padding: 12, display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  mTop: { display: "flex", alignItems: "center", gap: 11, padding: "calc(10px + env(safe-area-inset-top)) 12px 10px 14px", borderBottom: "1px solid var(--line)", background: "rgba(20,22,29,.92)", backdropFilter: "saturate(1.4) blur(12px)", WebkitBackdropFilter: "saturate(1.4) blur(12px)", position: "sticky", top: 0, zIndex: 20 },
  mTitle: { flex: 1, minWidth: 0 },
  iconBtn: { width: 42, height: 42, flexShrink: 0, borderRadius: 12, background: "var(--surface2)", border: "1px solid var(--line)", color: "var(--text)", fontSize: 18, display: "grid", placeItems: "center", padding: 0 },
  bottomNav: { display: "flex", borderTop: "1px solid var(--line)", background: "var(--surface)", paddingBottom: "env(safe-area-inset-bottom)", flexShrink: 0 },
  bTab: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "8px 2px 8px", background: "transparent", border: "none", color: "var(--muted)", fontSize: 12, fontWeight: 700 },
  bTabActive: { color: "var(--accent)", fontWeight: 800 },
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
  tileQR: { position: "absolute", top: 10, left: 10, background: "rgba(0,0,0,.4)", borderRadius: 7, padding: "2px 7px", fontWeight: 800, fontSize: 12 },
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
  roleBadge: { fontSize: 12, fontWeight: 800, letterSpacing: .6, textTransform: "uppercase", borderRadius: 20, padding: "4px 9px" },
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
  knob: { position: "absolute", top: 2, left: 0, width: 22, height: 22, borderRadius: "50%", background: "#fff", transition: "transform .2s", boxShadow: "0 1px 3px rgba(0,0,0,.4)" },
  input: { width: "100%", background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "11px 13px", fontSize: 15, outline: "none" },
  btnPrimary: { background: "var(--accent)", color: "#fff", border: "none", borderRadius: 12, padding: "12px 20px", fontWeight: 800, fontSize: 15, width: "100%" },
  btnGhost: { background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 12, padding: "12px 20px", fontWeight: 700 },
  smallBtn: { background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 700 },
  paperWrap: { background: "#e9e9e9", padding: 20, borderRadius: 14, display: "flex", justifyContent: "center", boxShadow: "inset 0 0 30px rgba(0,0,0,.2)" },
  prodRow: { display: "flex", alignItems: "center", gap: 12, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 10, transition: "box-shadow .15s, border-color .15s" },
  prodRowDrag: { borderColor: "var(--accent)", boxShadow: "0 12px 30px rgba(0,0,0,.45), 0 0 0 1px var(--accent)", background: "var(--surface2)" },
  grip: { display: "grid", placeItems: "center", width: 30, height: 40, margin: "-4px -4px -4px -2px", borderRadius: 8, touchAction: "none", userSelect: "none", WebkitUserSelect: "none", flexShrink: 0 },
  arrowBtn: { width: 28, height: 20, borderRadius: 6, background: "var(--surface2)", border: "1px solid var(--line)", color: "var(--text)", display: "grid", placeItems: "center", padding: 0 },
  cajaTile: { background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 12, padding: "8px 10px", textAlign: "center", minWidth: 0 },
  pruebaBanner: { display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "14px 16px", marginBottom: 14, borderRadius: 16, border: "3px solid #ffb400", color: "#1a1205", background: "repeating-linear-gradient(135deg,#ffb400 0 18px,#ffc93c 18px 36px)", boxShadow: "0 6px 24px rgba(255,180,0,.25)" },
  iniciarBtn: { background: "var(--green)", color: "#04241b", border: "3px solid #0b3b2d", borderRadius: 14, padding: "14px 22px", fontWeight: 900, fontSize: 17, cursor: "pointer", whiteSpace: "nowrap", boxShadow: "0 4px 14px rgba(0,0,0,.25)" },
  abiertaPill: { display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 14px", marginBottom: 14, borderRadius: 30, border: "1px solid rgba(34,211,166,.45)", background: "rgba(34,211,166,.1)", color: "var(--green)", fontSize: 13.5 },
  tilePrueba: { position: "absolute", left: 0, right: 0, bottom: 0, height: 20, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "0 0 18px 18px", background: "repeating-linear-gradient(135deg,#ffb400 0 10px,#1a1205 10px 20px)", pointerEvents: "none" },
  tilePruebaTxt: { background: "#ffb400", color: "#1a1205", fontWeight: 900, fontSize: 12, letterSpacing: 2, padding: "1px 8px", borderRadius: 4 },
  gastoBtn: { background: "rgba(255,180,0,.12)", color: "var(--amber)", border: "2px solid rgba(255,180,0,.55)", borderRadius: 12, padding: "8px 14px", fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, whiteSpace: "nowrap" },
  gastoBadge: { background: "var(--amber)", color: "#1a1205", borderRadius: 20, padding: "1px 8px", fontSize: 12, fontWeight: 900 },
  inviteBtn: { background: "rgba(168,85,247,.14)", color: "#d8b4fe", border: "2px solid rgba(168,85,247,.55)", borderRadius: 12, padding: "8px 16px", fontWeight: 800 },
  inviteBtnOn: { background: "#a855f7", color: "#fff", borderColor: "#e9d5ff", boxShadow: "0 0 0 4px rgba(168,85,247,.35), 0 0 24px rgba(168,85,247,.6)" },
  inviteBanner: { display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", marginBottom: 14, borderRadius: 16, background: "linear-gradient(135deg,#7e22ce,#a855f7)", color: "#fff", border: "2px solid #e9d5ff", boxShadow: "0 10px 30px rgba(168,85,247,.45)" },
  inviteCancel: { background: "rgba(0,0,0,.25)", color: "#fff", border: "1px solid rgba(255,255,255,.5)", borderRadius: 11, padding: "10px 14px", fontWeight: 800, flexShrink: 0 },
  tileInvite: { position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", background: "#a855f7", color: "#fff", borderRadius: 20, padding: "3px 10px", fontWeight: 900, fontSize: 12, whiteSpace: "nowrap", boxShadow: "0 2px 8px rgba(0,0,0,.35)" },
  updateBar: { position: "fixed", zIndex: 65, left: "50%", transform: "translateX(-50%)", bottom: "calc(16px + env(safe-area-inset-bottom))", width: "min(560px, calc(100vw - 24px))", display: "flex", alignItems: "center", gap: 10, background: "#1e2230", border: "1px solid var(--accent)", color: "var(--text)", borderRadius: 14, padding: "10px 10px 10px 14px", boxShadow: "0 16px 40px rgba(0,0,0,.55)" },
  updateBtn: { background: "var(--accent)", color: "#fff", border: "none", borderRadius: 10, padding: "9px 14px", fontWeight: 800, flexShrink: 0 },
  updateX: { background: "transparent", color: "var(--muted)", border: "none", padding: "6px 6px", fontSize: 16, flexShrink: 0 },
  arrangeBar: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12, padding: "10px 10px 10px 14px", borderRadius: 14, background: "rgba(255,90,60,.12)", border: "1px solid rgba(255,90,60,.45)", color: "var(--accent)", fontSize: 13.5 },
  doneBtn: { background: "var(--accent)", color: "#fff", border: "none", borderRadius: 11, padding: "10px 18px", fontWeight: 800, fontSize: 14, flexShrink: 0 },
  pinAviso: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 12px", marginBottom: 14, borderRadius: 12, background: "var(--amber)", color: "#1a1205", fontSize: 13.5 },
  actBtn: { display: "inline-flex", alignItems: "center", gap: 7, background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 14px", fontWeight: 800, fontSize: 14, whiteSpace: "nowrap" },
  actOn: { background: "#a855f7", color: "#fff", borderColor: "#e9d5ff" },
  actBadge: { background: "var(--line)", color: "var(--text)", borderRadius: 20, padding: "1px 8px", fontSize: 12, fontWeight: 900 },
  actBar: { position: "sticky", bottom: -12, zIndex: 15, display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 4, margin: "14px -12px -12px", padding: "6px 8px calc(6px + env(safe-area-inset-bottom))", background: "rgba(20,22,29,.96)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderTop: "1px solid var(--line)" },
  actBarBtn: { position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, background: "transparent", border: "none", color: "var(--text)", padding: "8px 2px", borderRadius: 12, fontSize: 12, fontWeight: 700, minHeight: 56 },
  actBarDot: { position: "absolute", top: 6, right: "calc(50% - 18px)", width: 8, height: 8, borderRadius: "50%", background: "var(--amber)" },
  modoRow: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 12px", marginBottom: 14, borderRadius: 14, background: "var(--surface)", border: "1px solid var(--line)" },
  miniSeg: { display: "inline-flex", gap: 3, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 11, padding: 3 },
  miniSegBtn: { display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "none", color: "var(--muted)", borderRadius: 8, padding: "7px 11px", fontWeight: 700, fontSize: 12.5 },
  miniSegOn: { background: "var(--surface2)", color: "var(--text)", boxShadow: "inset 0 0 0 1px var(--line)" },
  tileGrip: { position: "absolute", top: 8, left: 8, width: 28, height: 28, borderRadius: 8, background: "rgba(0,0,0,.35)", display: "grid", placeItems: "center", color: "#fff" },
  segWrap: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 12, padding: 4 },
  seg: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, background: "transparent", color: "var(--muted)", border: "none", borderRadius: 9, padding: "10px 8px", fontWeight: 700, fontSize: 13 },
  segOn: { background: "var(--surface2)", color: "var(--text)", boxShadow: "inset 0 0 0 1px var(--line), 0 0 0 0 transparent", },
  del: { background: "transparent", color: "var(--red)", border: "1px solid var(--line)", borderRadius: 8, width: 32, height: 32, fontWeight: 800 },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "grid", placeItems: "center", zIndex: 50, backdropFilter: "blur(4px)" },
  pinCard: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 20, padding: 26, width: 300 },
  pinBtn: { background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 14, padding: "18px 0", fontSize: 22, fontWeight: 700 },
  toast: { position: "fixed", bottom: "calc(24px + env(safe-area-inset-bottom))", left: "50%", transform: "translateX(-50%)", color: "#0b0c10", padding: "11px 20px", borderRadius: 14, fontWeight: 800, fontSize: 14, zIndex: 60, boxShadow: "0 14px 34px rgba(0,0,0,.45)", width: "max-content", maxWidth: "calc(100vw - 32px)", textAlign: "center", lineHeight: 1.35 },
};

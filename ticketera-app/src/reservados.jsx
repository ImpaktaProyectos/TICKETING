// ===================== TIXFAST · RESERVADOS VIP =====================
// Mapa de reservados (libre / reservado / ha llegado / no vino), reservas previas con señal,
// configuración (tarifas, extras, promotores, puntos de venta) y la línea «Reservados» del TPV.
// Las ventas son ventas normales del TPV (misma facturación, mismo cierre Z, mismo ticket);
// aquí solo se apunta a qué reservado va cada una.
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as db from "./db";
import { uid } from "./supabase";

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const money = (n) => (Number(n) || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const num = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const hora = (t) => { try { return new Date(t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
const COLORES = ["#a855f7", "#ffb400", "#ff5a3c", "#3b82f6", "#22d3a6", "#ec4899", "#eab308", "#14b8a6"];

export const ESTADOS = {
  libre: { t: "Libre", c: "#838aa0", bg: "rgba(131,138,160,.12)" },
  reservado: { t: "Reservado", c: "#ffb400", bg: "rgba(255,180,0,.14)" },
  llegado: { t: "Ha llegado", c: "#22d3a6", bg: "rgba(34,211,166,.14)" },
  novino: { t: "No vino", c: "#ff4d4d", bg: "rgba(255,77,77,.12)" },
};
const TAMANOS = { pequeno: "Pequeño", grande: "Grande" };
const METODOS = { efectivo: "Efectivo", bizum: "Bizum", transferencia: "Transferencia", tarjeta: "Tarjeta" };

/* ---------- Configuración (vive en el evento: ticket_style.reservados) ---------- */
export function resCfg(ev) {
  const c = ev?.style?.reservados || {};
  return {
    puntos: Array.isArray(c.puntos) ? c.puntos : [],
    lineaTicket: c.lineaTicket !== false,
    tarifas: Array.isArray(c.tarifas) ? c.tarifas : [],
    extras: Array.isArray(c.extras) ? c.extras : [],
    promotores: Array.isArray(c.promotores) ? c.promotores : [],
    socios: Array.isArray(c.socios) ? c.socios : [],
  };
}
export const resActivo = (ev) => { const c = resCfg(ev); return c.tarifas.length + c.extras.length > 0; };
// Ventas hechas por un socio desde su móvil (sin ticket): el operario queda como «SOCIO:Nombre»
export const esSocio = (s) => /^SOCIO:/.test(s?.operario || "");
export const socioDe = (s) => String(s?.operario || "").replace(/^SOCIO:/, "");
export function efectivoSocios(sales) {
  const m = {};
  (sales || []).forEach(s => { if (!s.voided && esSocio(s) && s.pago === "efectivo" && !/^invitacion/.test(s.pago || "")) { const n = socioDe(s) || "Socio"; m[n] = r2((m[n] || 0) + s.price); } });
  return Object.entries(m).map(([nombre, importe]) => ({ nombre, importe }));
}
export const vendeAqui = (ev, puntoId) => resCfg(ev).puntos.includes(puntoId);

/* ---------- Datos de los reservados (con modo sin internet) ---------- */
const ordenar = (rs) => rs.slice().sort((a, b) => (a.orden - b.orden) || String(a.nombre).localeCompare(String(b.nombre), "es", { numeric: true }));
export function useReservados(evId) {
  const key = () => db.scopedKey("tixfast_reservados_" + evId);
  const leerCache = () => { try { return JSON.parse(localStorage.getItem(key()) || "null"); } catch { return null; } };
  const mezclar = (srv) => {
    const p = db.pendingReservados(evId);
    const base = srv || { reservados: [], ventas: [] };
    const rs = base.reservados.filter(r => !p.borrar.has(r.id)).map(r => p.guardar.get(r.id) || r);
    p.guardar.forEach((r, id) => { if (!rs.some(x => x.id === id)) rs.push(r); });
    const ids = new Set(base.ventas.map(v => v.clientUuid));
    return { reservados: ordenar(rs), ventas: base.ventas.concat(p.ventas.filter(v => !ids.has(v.clientUuid))) };
  };
  const [data, setData] = useState(() => (evId ? mezclar(leerCache()) : { reservados: [], ventas: [] }));
  const vivo = useRef(evId);
  const cargar = async () => {
    const id = evId; if (!id) return;
    try {
      if (!navigator.onLine) throw new Error("offline");
      const srv = await db.loadReservados(id);
      try { localStorage.setItem(db.scopedKey("tixfast_reservados_" + id), JSON.stringify(srv)); } catch {}
      if (vivo.current === id) setData(mezclar(srv));
    } catch { if (vivo.current === id) setData(mezclar(leerCache())); }
  };
  useEffect(() => {
    vivo.current = evId;
    if (!evId) { setData({ reservados: [], ventas: [] }); return; }
    setData(mezclar(leerCache()));
    cargar();
    let t = null;
    const unsub = db.subscribeReservados(evId, () => { clearTimeout(t); t = setTimeout(cargar, 1200); });
    const on = () => setTimeout(cargar, 3000);    // al volver internet (después de subir la cola)
    window.addEventListener("online", on);
    return () => { clearTimeout(t); unsub(); window.removeEventListener("online", on); };
  }, [evId]);
  const guardar = (r) => {
    const fila = { ...r, eventId: evId };
    setData(d => ({ ...d, reservados: ordenar(d.reservados.some(x => x.id === fila.id) ? d.reservados.map(x => x.id === fila.id ? fila : x) : [...d.reservados, fila]) }));
    return db.guardarReservado(fila);
  };
  const borrar = (r) => { setData(d => ({ ...d, reservados: d.reservados.filter(x => x.id !== r.id), ventas: d.ventas.filter(v => v.reservadoId !== r.id) })); return db.borrarReservado({ ...r, eventId: evId }); };
  const enlazar = (v) => { const fila = { ...v, eventId: evId, ts: v.ts || Date.now() }; setData(d => ({ ...d, ventas: [...d.ventas, fila] })); return db.enlazarVentaReservado(fila); };
  return { ...data, guardar, borrar, enlazar, recargar: cargar };
}

/* ---------- Cuentas de cada reservado ---------- */
// Una venta anulada en el TPV deja de contar en su reservado
const valida = (v, ventasPorUuid) => { const s = ventasPorUuid.get(v.clientUuid); return !(s && s.voided); };
export function mapaVentas(sales) { const m = new Map(); (sales || []).forEach(s => { if (s.clientUuid) m.set(s.clientUuid, s); }); return m; }
export function statsReservado(r, ventas, porUuid) {
  const ls = ventas.filter(v => v.reservadoId === r.id && valida(v, porUuid));
  const cobrado = r2(ls.reduce((t, v) => t + (porUuid.get(v.clientUuid)?.price ?? v.total - v.senal), 0));
  const senalUsada = ls.some(v => v.tipo === "tarifa");
  return {
    lineas: ls.slice().sort((a, b) => b.ts - a.ts),
    botellas: ls.reduce((t, v) => t + (v.botellas || 0), 0),
    cobrado,                                          // cobrado en el TPV (taquilla)
    senal: r.senal || 0,                              // la tiene el promotor
    total: r2(cobrado + (r.estado !== "libre" ? (r.senal || 0) : 0)),
    tarifaCobrada: senalUsada,
  };
}
// Cobro de una tarifa: se descuenta la señal ya pagada (una sola vez)
export function cobroTarifa(r, tarifa, ventas, porUuid) {
  const ya = ventas.some(v => v.reservadoId === r.id && v.tipo === "tarifa" && valida(v, porUuid));
  const total = r2(num(tarifa.precio));
  const senal = ya ? 0 : Math.min(r2(r.senal || 0), total);
  return { total, senal, aCobrar: r2(total - senal), yaCobrada: ya };
}

/* ============================================================
   ESTILOS (mismos colores y formas que el TPV)
   ============================================================ */
const R = {
  panel: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 16 },
  h3: { fontSize: 15.5, fontWeight: 800, margin: 0 },
  sub: { fontSize: 12.5, color: "var(--muted)", marginTop: 3, lineHeight: 1.45 },
  label: { fontSize: 12, color: "var(--muted)", marginBottom: 5, fontWeight: 600 },
  input: { width: "100%", boxSizing: "border-box", background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "11px 12px", fontSize: 16, outline: "none" },
  primary: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 12, padding: "12px 18px", fontWeight: 800, fontSize: 15, cursor: "pointer" },
  ghost: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 12, padding: "11px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer" },
  small: { display: "inline-flex", alignItems: "center", gap: 6, background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 9, padding: "7px 11px", fontWeight: 700, fontSize: 13, cursor: "pointer" },
  chip: { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 20, border: "1px solid var(--line)", background: "transparent", color: "var(--text)", fontWeight: 700, fontSize: 13.5, cursor: "pointer" },
  wrap: { position: "fixed", inset: 0, zIndex: 85, background: "rgba(0,0,0,.72)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-end", justifyContent: "center" },
  sheet: { width: "100%", maxWidth: 560, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "22px 22px 0 0", padding: 18, paddingBottom: "calc(18px + env(safe-area-inset-bottom))", maxHeight: "92dvh", overflow: "auto", boxSizing: "border-box" },
  grab: { width: 40, height: 5, borderRadius: 5, background: "var(--line)", margin: "-4px auto 14px" },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid var(--line)" },
};
const Field = ({ label, children, style }) => <div style={{ marginBottom: 12, minWidth: 0, ...style }}><div style={R.label}>{label}</div>{children}</div>;
function Hoja({ title, sub, onClose, children, footer, ancho = 560 }) {
  return (
    <div style={R.wrap} onClick={onClose}>
      <div className="sheet-anim" style={{ ...R.sheet, maxWidth: ancho }} onClick={e => e.stopPropagation()} role="dialog" aria-label={title}>
        <div style={R.grab} />
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
          <div style={{ minWidth: 0 }}><div style={{ fontSize: 19, fontWeight: 800 }}>{title}</div>{sub && <div style={R.sub}>{sub}</div>}</div>
          <button onClick={onClose} style={{ ...R.small, padding: "8px 11px" }} aria-label="Cerrar">✕</button>
        </div>
        {children}
        {footer && <div style={{ position: "sticky", bottom: -18, background: "var(--surface)", paddingTop: 12, marginTop: 6 }}>{footer}</div>}
      </div>
    </div>
  );
}
function Estado({ e, big }) { const x = ESTADOS[e] || ESTADOS.libre; return <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: big ? 13 : 11.5, fontWeight: 800, color: x.c, background: x.bg, borderRadius: 20, padding: big ? "5px 11px" : "3px 9px", whiteSpace: "nowrap" }}><span style={{ width: 7, height: 7, borderRadius: 7, background: x.c }} />{x.t}</span>; }

/* ============================================================
   LÍNEA «RESERVADOS» EN EL TPV (solo en los puntos elegidos)
   ============================================================ */
export function LineaReservados({ ev, punto, res, testMode, isMobile, onElegir, onVerMapa }) {
  const cfg = resCfg(ev);
  if (!cfg.puntos.includes(punto.id)) return null;
  const items = [...cfg.tarifas.map(t => ({ ...t, tipo: "tarifa" })), ...cfg.extras.map(x => ({ ...x, tipo: "extra" }))].filter(x => x.mostrar !== false);
  const cuenta = (e) => res.reservados.filter(r => r.estado === e).length;
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, fontWeight: 800 }}>⭐ Reservados VIP</div>
        <button onClick={onVerMapa} style={{ ...R.small, borderColor: "rgba(168,85,247,.5)" }}>🗺️ Mapa · <span style={{ color: ESTADOS.llegado.c }}>{cuenta("llegado")} dentro</span> · <span style={{ color: ESTADOS.reservado.c }}>{cuenta("reservado")} por llegar</span></button>
      </div>
      {items.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: 13, border: "2px dashed var(--line)", borderRadius: 14, padding: 16, textAlign: "center" }}>No hay productos de reservados marcados para el TPV. Se configuran en Reservados › Configuración.</div>
      ) : (
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: isMobile ? "repeat(auto-fill, minmax(150px,1fr))" : "repeat(auto-fill, minmax(180px,1fr))" }}>
          {items.map(it => {
            const c = it.color || (it.tipo === "tarifa" ? "#a855f7" : "#ffb400");
            return (
              <button key={it.id} onClick={() => onElegir(it)} className="tile" style={{ position: "relative", minHeight: 140, border: "none", borderRadius: 18, padding: "32px 10px 14px", color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer", background: `linear-gradient(160deg, ${c}, ${c}cc)`, boxShadow: `0 8px 22px ${c}33` }}>
                <span style={{ position: "absolute", top: 9, left: 9, background: "rgba(0,0,0,.24)", borderRadius: 8, padding: "2px 8px", fontWeight: 900, fontSize: 11.5 }}>{it.tipo === "tarifa" ? "RESERVADO" : `${it.botellas || 0} bot.`}</span>
                {testMode && <span style={{ position: "absolute", top: 9, right: 9, background: "#ffb400", color: "#1a1205", borderRadius: 6, padding: "1px 6px", fontWeight: 900, fontSize: 10.5 }}>PRUEBA</span>}
                <span style={{ fontSize: 30, lineHeight: 1 }}>{it.emoji || (it.tipo === "tarifa" ? "🛋️" : "🍾")}</span>
                <span style={{ fontSize: 16.5, fontWeight: 900, lineHeight: 1.1, textAlign: "center", textShadow: "0 1px 2px rgba(0,0,0,.25)" }}>{it.nombre}</span>
                <span style={{ fontSize: 19, fontWeight: 900, textShadow: "0 1px 2px rgba(0,0,0,.25)" }}>{money(it.precio)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- Elegir reservado y confirmar el cobro ---------- */
export function CobrarReservado({ ev, item, res, sales, fijo, onCobrar, onClose }) {
  const porUuid = useMemo(() => mapaVentas(sales), [sales]);
  const [sel, setSel] = useState(fijo || null);
  const r = sel ? res.reservados.find(x => x.id === sel) : null;
  const tarifa = item.tipo === "tarifa";
  const cobro = r && tarifa ? cobroTarifa(r, item, res.ventas, porUuid) : null;
  const aCobrar = cobro ? cobro.aCobrar : r2(num(item.precio));
  const orden = { llegado: 0, reservado: 1, libre: 2, novino: 3 };
  const lista = res.reservados.slice().sort((a, b) => (orden[a.estado] - orden[b.estado]) || (a.orden - b.orden));
  return (
    <Hoja title={r ? `${item.nombre} · ${r.nombre}` : `${item.nombre} · ¿para qué reservado?`} sub={r ? null : "Toca el reservado. Los que ya han llegado salen primero."} onClose={onClose}
      footer={r && (
        <div style={{ display: "flex", gap: 8 }}>
          {!fijo && <button onClick={() => setSel(null)} style={{ ...R.ghost, flex: 1 }}>Cambiar</button>}
          <button onClick={() => onCobrar({ item, reservado: r, precio: aCobrar, cobro })} style={{ ...R.primary, flex: 2, padding: "15px", fontSize: 17 }}>Cobrar {money(aCobrar)}</button>
        </div>
      )}>
      {!r && (
        res.reservados.length === 0
          ? <div style={{ color: "var(--muted)", textAlign: "center", padding: 24, border: "2px dashed var(--line)", borderRadius: 14 }}>Aún no hay reservados creados en este evento. Se crean en Reservados › Configuración.</div>
          : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(118px,1fr))", gap: 10 }}>
            {lista.map(x => { const e = ESTADOS[x.estado] || ESTADOS.libre; return (
              <button key={x.id} onClick={() => setSel(x.id)} style={{ textAlign: "left", background: e.bg, border: `2px solid ${e.c}`, borderRadius: 14, padding: "12px 12px", color: "var(--text)", cursor: "pointer", minHeight: 84 }}>
                <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1 }}>{x.nombre}</div>
                <div style={{ fontSize: 12, color: e.c, fontWeight: 800, marginTop: 5 }}>{e.t}</div>
                {x.cliente && <div style={{ fontSize: 12.5, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.cliente}</div>}
              </button>); })}
          </div>
      )}
      {r && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}><Estado e={r.estado} big />{r.cliente && <b>{r.cliente}</b>}<span style={{ color: "var(--muted)", fontSize: 13 }}>{TAMANOS[r.tamano]}</span></div>
          {r.estado === "libre" && <div style={{ background: "rgba(255,180,0,.1)", border: "1px solid rgba(255,180,0,.4)", color: "var(--amber)", borderRadius: 12, padding: "10px 12px", fontSize: 13.5, fontWeight: 700, marginBottom: 12 }}>⚠️ {r.nombre} está libre. Puedes cobrar igual{tarifa ? " y pasará a «Ha llegado»" : ""}.</div>}
          {r.estado === "novino" && <div style={{ background: "rgba(255,77,77,.1)", border: "1px solid rgba(255,77,77,.4)", color: "var(--red)", borderRadius: 12, padding: "10px 12px", fontSize: 13.5, fontWeight: 700, marginBottom: 12 }}>⚠️ {r.nombre} está marcado como «No vino».</div>}
          {tarifa && cobro?.yaCobrada && <div style={{ background: "rgba(255,180,0,.1)", border: "1px solid rgba(255,180,0,.4)", color: "var(--amber)", borderRadius: 12, padding: "10px 12px", fontSize: 13.5, fontWeight: 700, marginBottom: 12 }}>⚠️ Este reservado ya tiene una tarifa cobrada esta noche.</div>}
          <div style={{ background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 14, padding: 14 }}>
            {tarifa ? (<>
              <Linea t={item.nombre} v={money(cobro.total)} />
              {item.incluye && <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "-2px 0 6px" }}>Incluye: {item.incluye}</div>}
              {cobro.senal > 0 && <Linea t={`Señal pagada${r.senalMetodo ? " (" + METODOS[r.senalMetodo] + ")" : ""}`} v={"− " + money(cobro.senal)} c="var(--green)" />}
            </>) : <Linea t={`${item.nombre}${item.botellas ? ` · cuenta ${item.botellas} botella${item.botellas > 1 ? "s" : ""}` : ""}`} v={money(item.precio)} />}
            <div style={{ borderTop: "1px solid var(--line)", marginTop: 8, paddingTop: 10, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <b style={{ fontSize: 15 }}>A cobrar ahora</b><b style={{ fontSize: 30, color: "var(--accent)" }}>{money(aCobrar)}</b>
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>Se cobra e imprime como cualquier venta del TPV{tarifa ? `; ${r.nombre} pasa a «Ha llegado»` : ""}.</div>
        </div>
      )}
    </Hoja>
  );
}
const Linea = ({ t, v, c }) => <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 15, padding: "4px 0", color: c || "var(--text)" }}><span>{t}</span><b>{v}</b></div>;

/* ============================================================
   MENÚ «RESERVADOS»: mapa + configuración
   ============================================================ */
export function ReservadosVista({ ev, punto, role, res, sales, isMobile, flash, onGuardarCfg, onCobrarTarifa, onVentaSocio, onCerrar }) {
  const cfg = resCfg(ev);
  const [tab, setTab] = useState("mapa");
  const [ficha, setFicha] = useState(null);
  const porUuid = useMemo(() => mapaVentas(sales), [sales]);
  const stats = useMemo(() => Object.fromEntries(res.reservados.map(r => [r.id, statsReservado(r, res.ventas, porUuid)])), [res.reservados, res.ventas, porUuid]);
  const cuenta = (e) => res.reservados.filter(r => r.estado === e).length;
  const totBot = Object.values(stats).reduce((t, s) => t + s.botellas, 0);
  const totImp = r2(Object.values(stats).reduce((t, s) => t + s.total, 0));
  const tarifaDe = (r) => cfg.tarifas.find(t => t.id === r.tarifaId);
  const sinConfig = cfg.tarifas.length + cfg.extras.length === 0 || res.reservados.length === 0;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>⭐ Reservados VIP</div>
          <div style={R.sub}>{ev.name}{cfg.puntos.length ? ` · se cobran en ${ev.puntos.filter(p => cfg.puntos.includes(p.id)).map(p => p.name).join(", ")}` : " · aún sin punto de venta elegido"}</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {onVentaSocio && (role === "admin" || role === "supervisor") && tab === "mapa" && <button onClick={() => onVentaSocio(null)} style={{ ...R.small, background: "var(--green)", color: "#04231a", border: "none", padding: "9px 13px" }}>💶 Vender sin ticket</button>}
          {role === "admin" && <div style={{ display: "inline-flex", background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 12, padding: 3 }}>
            {[["mapa", "Mapa"], ["config", "Configuración"]].map(([k, t]) => <button key={k} onClick={() => setTab(k)} style={{ border: "none", borderRadius: 9, padding: "8px 14px", fontWeight: 800, fontSize: 13.5, cursor: "pointer", background: tab === k ? "var(--accent)" : "transparent", color: tab === k ? "#fff" : "var(--text)" }}>{t}</button>)}
          </div>}
          {onCerrar && <button onClick={onCerrar} style={R.small}>← Volver al TPV</button>}
        </div>
      </div>

      {tab === "mapa" && (<>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,minmax(0,1fr))" : "repeat(5,minmax(0,1fr))", gap: 10, marginBottom: 14 }}>
          <Kpi l="Han llegado" v={cuenta("llegado")} c={ESTADOS.llegado.c} />
          <Kpi l="Por llegar" v={cuenta("reservado")} c={ESTADOS.reservado.c} />
          <Kpi l="Libres" v={cuenta("libre")} c={ESTADOS.libre.c} />
          <Kpi l="Botellas" v={totBot} />
          <Kpi l="Importe" v={money(totImp)} c="var(--green)" />
        </div>
        {sinConfig && (
          <div style={{ ...R.panel, borderStyle: "dashed", textAlign: "center", color: "var(--muted)", marginBottom: 14 }}>
            {role === "admin"
              ? <>Para empezar: crea los reservados, sus tarifas y elige el punto de venta. <button onClick={() => setTab("config")} style={{ ...R.small, marginLeft: 6, color: "var(--accent)" }}>Ir a Configuración</button></>
              : "El administrador aún no ha configurado los reservados de este evento."}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,minmax(0,1fr))" : "repeat(auto-fill, minmax(190px,1fr))", gap: 12 }}>
          {res.reservados.map(r => { const e = ESTADOS[r.estado] || ESTADOS.libre; const s = stats[r.id]; const t = tarifaDe(r); return (
            <button key={r.id} onClick={() => setFicha(r.id)} style={{ textAlign: "left", background: `linear-gradient(180deg, ${e.bg}, var(--surface))`, border: `2px solid ${e.c}`, borderRadius: 18, padding: 14, color: "var(--text)", cursor: "pointer", minHeight: 150, display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
                <span style={{ fontSize: 28, fontWeight: 900, lineHeight: 1 }}>{r.nombre}</span>
                <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, textAlign: "right" }}>{TAMANOS[r.tamano]}{r.personas ? ` · ${r.personas} pers.` : ""}</span>
              </div>
              <Estado e={r.estado} />
              <div style={{ fontWeight: 800, fontSize: 14.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minHeight: 20 }}>{r.cliente || <span style={{ color: "var(--muted)", fontWeight: 600 }}>Sin cliente</span>}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t ? t.nombre : "Sin tarifa"}{r.senal > 0 ? ` · señal ${money(r.senal)}` : ""}</div>
              <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingTop: 6, borderTop: "1px solid var(--line)" }}>
                <span style={{ fontSize: 13, fontWeight: 800 }}>🍾 {s.botellas}</span>
                <span style={{ fontSize: 15, fontWeight: 900, color: s.total > 0 ? "var(--green)" : "var(--muted)" }}>{money(s.total)}</span>
              </div>
            </button>); })}
        </div>
      </>)}

      {tab === "config" && role === "admin" && <ConfigReservados ev={ev} cfg={cfg} res={res} isMobile={isMobile} flash={flash} onGuardarCfg={onGuardarCfg} />}

      {ficha && (() => { const r = res.reservados.find(x => x.id === ficha); if (!r) return null; return (
        <FichaReservado ev={ev} cfg={cfg} r={r} stats={stats[r.id]} puedeCobrar={cfg.puntos.includes(punto.id)} puntoNombre={punto.name}
          onVentaSocio={onVentaSocio && (role === "admin" || role === "supervisor") ? (x) => { if (JSON.stringify(x) !== JSON.stringify(r)) res.guardar(x); setFicha(null); onVentaSocio(r.id); } : null}
          onClose={() => setFicha(null)}
          onGuardar={(x) => { res.guardar(x); flash(`${x.nombre} guardado`); setFicha(null); }}
          onCobrar={(x, t) => { res.guardar(x); setFicha(null); onCobrarTarifa(t, x); }} />); })()}
    </div>
  );
}
const Kpi = ({ l, v, c }) => <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: "12px 14px", minWidth: 0 }}><div style={{ fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: .6, fontWeight: 700 }}>{l}</div><div style={{ fontSize: 24, fontWeight: 800, color: c || "var(--text)", lineHeight: 1.2 }}>{v}</div></div>;

/* ---------- Ficha de un reservado: reserva previa, señal, llegada y consumos ---------- */
function FichaReservado({ ev, cfg, r, stats, puedeCobrar, puntoNombre, onClose, onGuardar, onCobrar, onVentaSocio }) {
  const [x, setX] = useState({ ...r, senal: r.senal ? String(r.senal).replace(".", ",") : "" });
  const set = (k, v) => setX(o => ({ ...o, [k]: v }));
  const limpio = () => ({ ...x, senal: r2(Math.max(0, num(x.senal))), llegadaEn: x.estado === "llegado" ? (x.llegadaEn || new Date().toISOString()) : x.estado === "libre" ? null : x.llegadaEn });
  const t = cfg.tarifas.find(z => z.id === x.tarifaId);
  const cambiado = JSON.stringify(limpio()) !== JSON.stringify({ ...r, senal: r2(r.senal || 0), llegadaEn: r.llegadaEn });
  const liberar = () => setX(o => ({ ...o, estado: "libre", cliente: "", telefono: "", nota: "", tarifaId: "", senal: "", senalMetodo: "", promotorId: "", llegadaEn: null }));
  const promotor = cfg.promotores.find(p => p.id === x.promotorId);
  return (
    <Hoja title={`Reservado ${r.nombre}`} sub={`${TAMANOS[r.tamano]}${r.personas ? ` · ${r.personas} personas` : ""}`} onClose={onClose}
      footer={<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {puedeCobrar && t && stats && !stats.tarifaCobrada && <button onClick={() => onCobrar(limpio(), t)} style={{ ...R.primary, flex: "2 1 220px", background: "var(--green)", color: "#04231a" }}>💶 Cobrar en taquilla · {money(r2(num(t.precio) - Math.min(num(x.senal), num(t.precio))))}</button>}
        {onVentaSocio && <button onClick={() => onVentaSocio(limpio())} style={{ ...R.ghost, flex: "1 1 140px", borderColor: "var(--green)", color: "var(--green)" }}>💶 Vender sin ticket</button>}
        <button onClick={() => onGuardar(limpio())} disabled={!cambiado} style={{ ...R.primary, flex: "1 1 140px", opacity: cambiado ? 1 : .45 }}>Guardar</button>
      </div>}>
      <Field label="Estado">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Object.entries(ESTADOS).map(([k, e]) => <button key={k} onClick={() => set("estado", k)} style={{ ...R.chip, borderColor: x.estado === k ? e.c : "var(--line)", background: x.estado === k ? e.bg : "transparent", color: x.estado === k ? e.c : "var(--text)" }}>{e.t}</button>)}
        </div>
      </Field>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Field label="Cliente" style={{ flex: "2 1 200px" }}><input value={x.cliente} maxLength={120} onChange={e => set("cliente", e.target.value)} placeholder="Nombre de quien reserva" style={R.input} /></Field>
        <Field label="Teléfono" style={{ flex: "1 1 140px" }}><input value={x.telefono} maxLength={40} inputMode="tel" onChange={e => set("telefono", e.target.value)} style={R.input} /></Field>
      </div>
      <Field label="Tarifa reservada">
        <select value={x.tarifaId || ""} onChange={e => set("tarifaId", e.target.value)} style={R.input}>
          <option value="">Sin tarifa</option>
          {cfg.tarifas.map(z => <option key={z.id} value={z.id}>{z.nombre} · {money(z.precio)}</option>)}
        </select>
        {t?.incluye && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 5 }}>Incluye: {t.incluye}</div>}
      </Field>
      <div style={{ background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 14, padding: "12px 12px 2px", marginBottom: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Señal pagada al promotor</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Field label="Importe (€)" style={{ flex: "1 1 110px" }}><input value={x.senal} inputMode="decimal" onChange={e => set("senal", e.target.value.replace(/[^\d.,]/g, "").slice(0, 8))} placeholder="0,00" style={{ ...R.input, fontWeight: 800 }} /></Field>
          <Field label="Cómo la pagó" style={{ flex: "1 1 130px" }}><select value={x.senalMetodo || ""} onChange={e => set("senalMetodo", e.target.value)} style={R.input}><option value="">—</option>{Object.entries(METODOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Promotor" style={{ flex: "1 1 150px" }}><select value={x.promotorId || ""} onChange={e => set("promotorId", e.target.value)} style={R.input}><option value="">—</option>{cfg.promotores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></Field>
        </div>
        {t && num(x.senal) > 0 && stats?.tarifaCobrada && <div style={{ fontSize: 13, marginBottom: 10, color: "var(--green)", fontWeight: 700 }}>✓ Tarifa cobrada en taquilla con la señal ya descontada.</div>}
        {t && num(x.senal) > 0 && !stats?.tarifaCobrada && <div style={{ fontSize: 13, marginBottom: 10 }}>En taquilla pagará <b style={{ color: "var(--accent)" }}>{money(r2(num(t.precio) - Math.min(num(x.senal), num(t.precio))))}</b> ({money(t.precio)} − {money(num(x.senal))} de señal){promotor?.telefono ? <> · <a href={`tel:${promotor.telefono.replace(/[^\d+]/g, "")}`} style={{ color: "var(--muted)" }}>llamar a {promotor.nombre}</a></> : null}</div>}
      </div>
      <Field label="Nota"><input value={x.nota} maxLength={500} onChange={e => set("nota", e.target.value)} placeholder="Cumpleaños, bengalas a las 2:00…" style={R.input} /></Field>
      {x.telefono && <div style={{ marginBottom: 12 }}><a href={`https://wa.me/${x.telefono.replace(/[^\d]/g, "").replace(/^(?=[67]\d{8}$)/, "34")}?text=${encodeURIComponent(`Hola ${x.cliente || ""}, te escribimos de ${ev.name} sobre tu reservado ${r.nombre}.`)}`} target="_blank" rel="noopener noreferrer" style={{ ...R.small, textDecoration: "none", color: "#22d3a6" }}>💬 WhatsApp a {x.cliente || "el cliente"}</a></div>}

      <div style={{ fontWeight: 800, margin: "6px 0 4px" }}>Esta noche · 🍾 {stats?.botellas || 0} botellas · {money(stats?.total || 0)}</div>
      {stats?.lineas.length ? stats.lineas.map(v => (
        <div key={v.clientUuid} style={{ ...R.row, fontSize: 13.5 }}>
          <span style={{ color: "var(--muted)", width: 44 }}>{hora(v.ts)}</span>
          <span style={{ flex: 1, minWidth: 0 }}>{v.nombre}{v.botellas ? ` · ${v.botellas} bot.` : ""}{v.senal > 0 ? ` · señal −${money(v.senal)}` : ""}</span>
        </div>)) : <div style={{ color: "var(--muted)", fontSize: 13, padding: "6px 0 10px" }}>Aún no ha comprado nada.</div>}
      {r.estado !== "libre" && <button onClick={liberar} style={{ ...R.small, marginTop: 10, color: "var(--muted)" }}>Dejar libre (borra cliente y señal)</button>}
      {!puedeCobrar && t && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>El cobro en taquilla se hace desde los puntos de venta de reservados, no desde {puntoNombre}.</div>}
    </Hoja>
  );
}

/* ---------- Configuración (solo administrador) ---------- */
function ConfigReservados({ ev, cfg, res, isMobile, flash, onGuardarCfg }) {
  const [d, setD] = useState(cfg);
  useEffect(() => { setD(resCfg(ev)); }, [ev.id]);
  const cambiado = JSON.stringify(d) !== JSON.stringify(cfg);
  const set = (k, v) => setD(o => ({ ...o, [k]: v }));
  const upd = (k, id, patch) => set(k, d[k].map(x => x.id === id ? { ...x, ...patch } : x));
  const del = (k, id) => set(k, d[k].filter(x => x.id !== id));
  const guardar = () => {
    const limpio = { ...d,
      tarifas: d.tarifas.map(t => ({ ...t, nombre: String(t.nombre || "").trim().toUpperCase() || "RESERVADO", precio: r2(Math.max(0, num(t.precio))), botellas: Math.max(0, Math.min(50, parseInt(t.botellas, 10) || 0)) })),
      extras: d.extras.map(t => ({ ...t, nombre: String(t.nombre || "").trim().toUpperCase() || "EXTRA", precio: r2(Math.max(0, num(t.precio))), botellas: Math.max(0, Math.min(50, parseInt(t.botellas, 10) || 0)) })),
      promotores: d.promotores.filter(p => String(p.nombre || "").trim()).map(p => ({ ...p, nombre: String(p.nombre).trim().slice(0, 60), telefono: String(p.telefono || "").trim().slice(0, 30) })),
      socios: d.socios.filter(p => String(p.nombre || "").trim()).map(p => ({ ...p, nombre: String(p.nombre).trim().slice(0, 60) })) };
    onGuardarCfg(limpio); setD(limpio); flash("Configuración de reservados guardada");
  };
  // Reservados (mesas): se guardan al momento
  const ventasDe = (id) => res.ventas.some(v => v.reservadoId === id);
  const nuevoRes = () => { const n = res.reservados.length + 1; res.guardar({ id: uid(), nombre: `R${n}`, tamano: "pequeno", personas: null, orden: n, estado: "libre", cliente: "", telefono: "", nota: "", tarifaId: "", senal: 0, senalMetodo: "", promotorId: "", llegadaEn: null }); };
  const quitarUltimo = () => {
    const ult = res.reservados[res.reservados.length - 1]; if (!ult) return;
    if (ult.estado !== "libre" || ventasDe(ult.id)) { flash(`${ult.nombre} tiene cliente o ventas: no se quita`, "warn"); return; }
    res.borrar(ult);
  };
  const filaTarifa = (t, k) => (
    <div key={t.id} style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 12, marginBottom: 10, background: "var(--surface2)" }}>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : (k === "tarifas" ? "2fr 1fr 1fr 1fr" : "2fr 1fr 1fr"), gap: 8 }}>
        <Field label="Nombre" style={{ gridColumn: isMobile ? "1 / -1" : "auto", marginBottom: 6 }}><input value={t.nombre} maxLength={40} onChange={e => upd(k, t.id, { nombre: e.target.value })} placeholder={k === "tarifas" ? "RESERVADO GRANDE 2 BOT." : "BOTELLA EXTRA"} style={R.input} /></Field>
        {k === "tarifas" && <Field label="Tamaño" style={{ marginBottom: 6 }}><select value={t.tamano || "pequeno"} onChange={e => upd(k, t.id, { tamano: e.target.value })} style={R.input}><option value="pequeno">Pequeño</option><option value="grande">Grande</option></select></Field>}
        <Field label={k === "tarifas" ? "Botellas incluidas" : "Cuenta como botellas"} style={{ marginBottom: 6 }}><input value={t.botellas ?? ""} inputMode="numeric" onChange={e => upd(k, t.id, { botellas: e.target.value.replace(/\D/g, "").slice(0, 2) })} style={R.input} /></Field>
        <Field label="Precio (€)" style={{ marginBottom: 6 }}><input value={t.precio ?? ""} inputMode="decimal" onChange={e => upd(k, t.id, { precio: e.target.value.replace(/[^\d.,]/g, "").slice(0, 8) })} style={{ ...R.input, fontWeight: 800 }} /></Field>
      </div>
      {k === "tarifas" && <Field label="Qué incluye" style={{ marginBottom: 6 }}><input value={t.incluye || ""} maxLength={140} onChange={e => upd(k, t.id, { incluye: e.target.value })} placeholder="2 botellas + refrescos + hielo" style={R.input} /></Field>}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
        <input value={t.emoji || ""} maxLength={4} onChange={e => upd(k, t.id, { emoji: e.target.value })} aria-label="Icono" style={{ ...R.input, width: 56, textAlign: "center", fontSize: 20, padding: "6px" }} />
        <div style={{ display: "flex", gap: 4 }}>{COLORES.map(c => <button key={c} onClick={() => upd(k, t.id, { color: c })} aria-label={"Color " + c} style={{ width: 24, height: 24, borderRadius: 24, background: c, border: (t.color || "") === c ? "3px solid #fff" : "2px solid transparent", cursor: "pointer" }} />)}</div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, marginLeft: "auto", fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>
          <input type="checkbox" checked={t.mostrar !== false} onChange={e => upd(k, t.id, { mostrar: e.target.checked })} style={{ width: 18, height: 18 }} />Mostrar en el TPV
        </label>
        <button onClick={() => del(k, t.id)} style={{ ...R.small, color: "var(--red)" }}>Quitar</button>
      </div>
    </div>
  );
  const bloque = (titulo, sub, children) => <div style={{ ...R.panel, marginBottom: 14 }}><div style={R.h3}>{titulo}</div>{sub && <div style={{ ...R.sub, marginBottom: 12 }}>{sub}</div>}{children}</div>;
  return (
    <div>
      {bloque("1 · Dónde se cobran los reservados", "Elige los puntos de venta donde aparece la línea «Reservados» y el cobro en taquilla. El mapa se ve desde cualquier barra.",
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {ev.puntos.filter(p => !p.archivado).map(p => { const on = d.puntos.includes(p.id); return <button key={p.id} onClick={() => set("puntos", on ? d.puntos.filter(x => x !== p.id) : [...d.puntos, p.id])} style={{ ...R.chip, borderColor: on ? "var(--accent)" : "var(--line)", background: on ? "rgba(255,90,60,.12)" : "transparent" }}>{on ? "✓ " : ""}{p.name}</button>; })}
        </div>)}

      {bloque(`2 · Reservados del evento (${res.reservados.length})`, "Se guardan al momento. Toca un reservado en el Mapa para apuntar reservas y señales.",
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <button onClick={quitarUltimo} disabled={!res.reservados.length} style={{ ...R.ghost, width: 48, padding: "10px 0", fontSize: 20 }} aria-label="Quitar el último reservado">−</button>
            <div style={{ fontSize: 30, fontWeight: 900, minWidth: 44, textAlign: "center" }}>{res.reservados.length}</div>
            <button onClick={nuevoRes} style={{ ...R.primary, width: 48, padding: "10px 0", fontSize: 20 }} aria-label="Añadir un reservado">+</button>
            <span style={{ ...R.sub, marginTop: 0 }}>reservados</span>
          </div>
          {res.reservados.map(r => (
            <div key={r.id} style={{ ...R.row, flexWrap: "wrap" }}>
              <input defaultValue={r.nombre} maxLength={40} onBlur={e => { const v = e.target.value.trim(); if (v && v !== r.nombre) res.guardar({ ...r, nombre: v }); }} aria-label="Nombre" style={{ ...R.input, width: 120, fontWeight: 800 }} />
              <select value={r.tamano} onChange={e => res.guardar({ ...r, tamano: e.target.value })} aria-label="Tamaño" style={{ ...R.input, width: 130 }}><option value="pequeno">Pequeño</option><option value="grande">Grande</option></select>
              <input defaultValue={r.personas ?? ""} inputMode="numeric" placeholder="Personas" onBlur={e => { const v = e.target.value.replace(/\D/g, ""); if (String(r.personas ?? "") !== v) res.guardar({ ...r, personas: v === "" ? null : Number(v) }); }} aria-label="Personas" style={{ ...R.input, width: 110 }} />
              <Estado e={r.estado} />
            </div>
          ))}
        </>)}

      {bloque("3 · Tarifas de reservado", "El precio de cada reservado (grande o pequeño, con una o dos botellas…). Al cobrar en taquilla se descuenta la señal.",
        <>
          {d.tarifas.map(t => filaTarifa(t, "tarifas"))}
          <button onClick={() => set("tarifas", [...d.tarifas, { id: uid(), nombre: "", tamano: "grande", botellas: 2, precio: "", incluye: "", mostrar: true, emoji: "🛋️", color: "#a855f7" }])} style={R.ghost}>+ Añadir tarifa</button>
        </>)}

      {bloque("4 · Extras para reservados", "Lo que piden durante la noche: botella extra, botella premium, bengalas… Cada uno cuenta las botellas que digas.",
        <>
          {d.extras.map(t => filaTarifa(t, "extras"))}
          <button onClick={() => set("extras", [...d.extras, { id: uid(), nombre: "", botellas: 1, precio: "", mostrar: true, emoji: "🍾", color: "#ffb400" }])} style={R.ghost}>+ Añadir extra</button>
        </>)}

      {bloque("5 · Promotores", "Quienes cobran las señales antes del evento. Se eligen en la ficha de cada reservado.",
        <>
          {d.promotores.map(p => (
            <div key={p.id} style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <input value={p.nombre} maxLength={60} onChange={e => upd("promotores", p.id, { nombre: e.target.value })} placeholder="Nombre" style={{ ...R.input, flex: "2 1 160px" }} />
              <input value={p.telefono || ""} maxLength={30} inputMode="tel" onChange={e => upd("promotores", p.id, { telefono: e.target.value })} placeholder="Teléfono" style={{ ...R.input, flex: "1 1 130px" }} />
              <button onClick={() => del("promotores", p.id)} style={{ ...R.small, color: "var(--red)" }}>Quitar</button>
            </div>))}
          <button onClick={() => set("promotores", [...d.promotores, { id: uid(), nombre: "", telefono: "" }])} style={R.ghost}>+ Añadir promotor</button>
        </>)}

      {bloque("6 · Socios", "Quienes pueden vender reservados y botellas desde su móvil, en cualquier punto de la sala (sin ticket, con el PIN de administrador). Si cobran en efectivo, el cierre Z de la caja elegida les recuerda que deben entregarlo.",
        <>
          {d.socios.map(p => (
            <div key={p.id} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input value={p.nombre} maxLength={60} onChange={e => upd("socios", p.id, { nombre: e.target.value })} placeholder="Nombre del socio" style={{ ...R.input, flex: 1 }} />
              <button onClick={() => del("socios", p.id)} style={{ ...R.small, color: "var(--red)" }}>Quitar</button>
            </div>))}
          <button onClick={() => set("socios", [...d.socios, { id: uid(), nombre: "" }])} style={R.ghost}>+ Añadir socio</button>
        </>)}

      {bloque("7 · Ticket", null,
        <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontWeight: 700, cursor: "pointer" }}>
          <span>Añadir la línea «RESERVADO R3» al ticket<span style={{ display: "block", ...R.sub }}>El resto del ticket sale igual (misma plantilla y opciones). Si hay señal, se imprime también lo pagado antes y ahora.</span></span>
          <input type="checkbox" checked={d.lineaTicket} onChange={e => set("lineaTicket", e.target.checked)} style={{ width: 22, height: 22, flexShrink: 0 }} />
        </label>)}

      <div style={{ position: "sticky", bottom: 0, background: "var(--bg)", padding: "10px 0", display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
        {cambiado && <span style={{ color: "var(--amber)", fontWeight: 700, fontSize: 13 }}>Cambios sin guardar</span>}
        <button onClick={guardar} disabled={!cambiado} style={{ ...R.primary, opacity: cambiado ? 1 : .45 }}>Guardar configuración</button>
      </div>
    </div>
  );
}

/* ============================================================
   VENTA DE UN SOCIO DESDE EL MÓVIL (sin ticket, con PIN de admin)
   ============================================================ */
export function VentaSocio({ ev, res, sales, fijo, defCaja, onVender, onClose }) {
  const cfg = resCfg(ev);
  const porUuid = useMemo(() => mapaVentas(sales), [sales]);
  const cajas = ev.puntos.filter(p => !p.archivado);
  const items = [...cfg.tarifas.map(t => ({ ...t, tipo: "tarifa" })), ...cfg.extras.map(x => ({ ...x, tipo: "extra" }))];
  const [sel, setSel] = useState(fijo || null);
  const [itemId, setItemId] = useState(null);
  const [metodo, setMetodo] = useState("");
  const [caja, setCaja] = useState(cajas.some(p => p.id === defCaja) ? defCaja : (cfg.puntos.find(id => cajas.some(p => p.id === id)) || cajas[0]?.id || ""));
  const [socio, setSocio] = useState(cfg.socios.length === 1 ? cfg.socios[0].nombre : "");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const r = sel ? res.reservados.find(x => x.id === sel) : null;
  const item = items.find(x => x.id === itemId);
  const cobro = r && item?.tipo === "tarifa" ? cobroTarifa(r, item, res.ventas, porUuid) : null;
  const precio = item ? (cobro ? cobro.aCobrar : r2(num(item.precio))) : 0;
  const cajaObj = cajas.find(p => p.id === caja);
  const listo = r && item && metodo && cajaObj && socio.trim() && pin;
  const vender = () => {
    if (!listo) { setErr("Falta: " + [!r && "reservado", !item && "producto", !metodo && "efectivo o tarjeta", !cajaObj && "caja", !socio.trim() && "socio", !pin && "PIN"].filter(Boolean).join(", ")); return; }
    if (!ev.pin_admin || pin !== String(ev.pin_admin)) { setErr("PIN de administrador incorrecto"); setPin(""); return; }
    onVender({ item, reservado: r, precio, cobro, metodo, caja: cajaObj, socio: socio.trim().slice(0, 60) });
  };
  const paso = (n, t) => <div style={{ fontWeight: 800, fontSize: 14, margin: "14px 0 8px", display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 22, height: 22, borderRadius: 22, background: "var(--accent)", color: "#fff", display: "inline-grid", placeItems: "center", fontSize: 12 }}>{n}</span>{t}</div>;
  const chip = (on) => ({ ...R.chip, borderColor: on ? "var(--accent)" : "var(--line)", background: on ? "rgba(255,90,60,.14)" : "transparent" });
  return (
    <Hoja title="💶 Vender sin ticket" sub="Venta de un socio desde su móvil. No se imprime nada." onClose={onClose}
      footer={<>
        {err && <div style={{ color: "var(--red)", fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>{err}</div>}
        <button onClick={vender} style={{ ...R.primary, width: "100%", padding: 15, fontSize: 17, opacity: listo ? 1 : .55 }}>Vender {item ? money(precio) : ""}{cajaObj ? ` · a ${cajaObj.name}` : ""}</button>
      </>}>
      {paso(1, "Reservado")}
      {res.reservados.length === 0 ? <div style={{ color: "var(--muted)", fontSize: 13 }}>Aún no hay reservados creados.</div> :
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px,1fr))", gap: 8 }}>
          {res.reservados.map(x => { const e = ESTADOS[x.estado] || ESTADOS.libre; const on = sel === x.id; return (
            <button key={x.id} onClick={() => { setSel(x.id); setErr(""); }} style={{ textAlign: "left", background: on ? e.bg : "transparent", border: `2px solid ${on ? e.c : "var(--line)"}`, borderRadius: 12, padding: "8px 10px", color: "var(--text)", cursor: "pointer" }}>
              <div style={{ fontSize: 18, fontWeight: 900 }}>{x.nombre}</div>
              <div style={{ fontSize: 11, color: e.c, fontWeight: 800 }}>{e.t}</div>
              {x.cliente && <div style={{ fontSize: 11.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.cliente}</div>}
            </button>); })}
        </div>}
      {paso(2, "Qué se vende")}
      {items.length === 0 ? <div style={{ color: "var(--muted)", fontSize: 13 }}>No hay tarifas ni extras configurados.</div> :
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {items.map(it => <button key={it.id} onClick={() => { setItemId(it.id); setErr(""); }} style={chip(itemId === it.id)}>{it.emoji || (it.tipo === "tarifa" ? "🛋️" : "🍾")} {it.nombre} · {money(it.precio)}</button>)}
        </div>}
      {cobro && cobro.senal > 0 && <div style={{ fontSize: 13, marginTop: 8, color: "var(--green)", fontWeight: 700 }}>Se descuenta la señal: {money(cobro.total)} − {money(cobro.senal)} = {money(cobro.aCobrar)}</div>}
      {cobro?.yaCobrada && <div style={{ fontSize: 13, marginTop: 8, color: "var(--amber)", fontWeight: 700 }}>⚠️ Este reservado ya tiene una tarifa cobrada.</div>}
      {paso(3, "Cómo ha pagado")}
      <div style={{ display: "flex", gap: 8 }}>
        {[["efectivo", "💶 Efectivo"], ["tarjeta", "💳 Tarjeta"]].map(([k, t]) => <button key={k} onClick={() => { setMetodo(k); setErr(""); }} style={{ ...chip(metodo === k), flex: 1, justifyContent: "center", padding: "12px" }}>{t}</button>)}
      </div>
      {paso(4, "A qué caja va el dinero")}
      <select value={caja} onChange={e => setCaja(e.target.value)} style={R.input}>{cajas.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      {cajaObj && (cajaObj.estado || "prueba") !== "abierta" && <div style={{ fontSize: 12.5, color: "var(--amber)", marginTop: 5 }}>{cajaObj.name} no está vendiendo ahora: la venta contará en su próximo cierre Z.</div>}
      {paso(5, "Socio que vende")}
      {cfg.socios.length ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{cfg.socios.map(x => <button key={x.id} onClick={() => { setSocio(x.nombre); setErr(""); }} style={chip(socio === x.nombre)}>{x.nombre}</button>)}</div>
        : <input value={socio} maxLength={60} onChange={e => setSocio(e.target.value)} placeholder="Nombre del socio (añade la lista en Configuración)" style={R.input} />}
      {metodo === "efectivo" && socio && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>El cierre Z de {cajaObj?.name || "la caja"} indicará que {socio} tiene {item ? money(precio) : "este dinero"} y debe entregarlo.</div>}
      {paso(6, "PIN de administrador")}
      <input value={pin} onChange={e => { setPin(e.target.value.replace(/\D/g, "").slice(0, 8)); setErr(""); }} type="password" inputMode="numeric" autoComplete="off" placeholder="••••" style={{ ...R.input, fontSize: 22, letterSpacing: 6, textAlign: "center", fontWeight: 900 }} />
    </Hoja>
  );
}

/* ============================================================
   INFORME (dentro de Informes)
   ============================================================ */
export function InformeReservados({ ev, res, sales, isMobile }) {
  const cfg = resCfg(ev);
  const porUuid = useMemo(() => mapaVentas(sales), [sales]);
  if (!res.reservados.length) return null;
  const filas = res.reservados.map(r => ({ r, s: statsReservado(r, res.ventas, porUuid), t: cfg.tarifas.find(x => x.id === r.tarifaId), p: cfg.promotores.find(x => x.id === r.promotorId) }));
  const tot = filas.reduce((a, f) => ({ bot: a.bot + f.s.botellas, cob: r2(a.cob + f.s.cobrado), sen: r2(a.sen + (f.r.estado !== "libre" ? f.r.senal || 0 : 0)) }), { bot: 0, cob: 0, sen: 0 });
  const csv = () => {
    const cell = (v) => { let x = String(v ?? "").replace(/[;\r\n]+/g, " "); if (/^[=+\-@\t]/.test(x) && !/^-?\d+([.,]\d+)?$/.test(x)) x = "'" + x; return x; };
    const n2 = (v) => String(r2(v)).replace(".", ",");
    const rows = [["Reservado", "Tamaño", "Estado", "Cliente", "Teléfono", "Tarifa", "Señal", "Pago señal", "Promotor", "Llegada", "Botellas", "Cobrado en TPV", "Total"]]
      .concat(filas.map(f => [f.r.nombre, TAMANOS[f.r.tamano], ESTADOS[f.r.estado]?.t, f.r.cliente, f.r.telefono, f.t?.nombre || "", n2(f.r.senal || 0), METODOS[f.r.senalMetodo] || "", f.p?.nombre || "", f.r.llegadaEn ? hora(f.r.llegadaEn) : "", f.s.botellas, n2(f.s.cobrado), n2(f.s.total)]));
    const blob = new Blob(["﻿" + rows.map(r => r.map(cell).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `reservados_${ev.name.replace(/[^\w-]+/g, "_")}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  return (
    <div style={{ ...R.panel, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <div style={{ fontWeight: 800 }}>⭐ Reservados VIP</div>
        <button onClick={csv} style={R.small}>⬇️ CSV de reservados</button>
      </div>
      <div style={{ ...R.sub, marginBottom: 12 }}>Lo cobrado en el TPV ya está dentro de la facturación. Las señales las tienen los promotores y no entran en las cajas de las barras.</div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,minmax(0,1fr))" : "repeat(4,minmax(0,1fr))", gap: 10, marginBottom: 12 }}>
        <Kpi l="Botellas" v={tot.bot} />
        <Kpi l="Cobrado en TPV" v={money(tot.cob)} c="var(--green)" />
        <Kpi l="Señales (promotores)" v={money(tot.sen)} c="var(--amber)" />
        <Kpi l="Total reservados" v={money(r2(tot.cob + tot.sen))} />
      </div>
      {(() => { const es = efectivoSocios(sales); return es.length ? (
        <div style={{ background: "rgba(255,180,0,.08)", border: "1px solid rgba(255,180,0,.35)", borderRadius: 12, padding: "10px 12px", marginBottom: 12, fontSize: 13.5 }}>
          <b style={{ color: "var(--amber)" }}>💶 Efectivo que tienen los socios</b> <span style={{ color: "var(--muted)" }}>(vendido sin ticket; deben entregarlo en su caja)</span>
          {es.map(x => <div key={x.nombre} style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}><span>{x.nombre}</span><b>{money(x.importe)}</b></div>)}
        </div>) : null; })()}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ color: "var(--muted)", textAlign: "right" }}>
            <th style={{ textAlign: "left", padding: "6px 4px" }}>Reservado</th><th style={{ textAlign: "left", padding: "6px 4px" }}>Cliente</th>
            <th style={{ padding: "6px 4px" }}>Botellas</th><th style={{ padding: "6px 4px" }}>Señal</th><th style={{ padding: "6px 4px" }}>En TPV</th><th style={{ padding: "6px 4px" }}>Total</th>
          </tr></thead>
          <tbody>{filas.map(({ r, s }) => (
            <tr key={r.id} style={{ borderTop: "1px solid var(--line)", textAlign: "right" }}>
              <td style={{ textAlign: "left", padding: "8px 4px", fontWeight: 800, whiteSpace: "nowrap" }}>{r.nombre} <Estado e={r.estado} /></td>
              <td style={{ textAlign: "left", padding: "8px 4px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.cliente || "—"}</td>
              <td style={{ padding: "8px 4px" }}>{s.botellas}</td>
              <td style={{ padding: "8px 4px", color: r.senal > 0 ? "var(--amber)" : "var(--muted)" }}>{money(r.estado !== "libre" ? r.senal : 0)}</td>
              <td style={{ padding: "8px 4px" }}>{money(s.cobrado)}</td>
              <td style={{ padding: "8px 4px", fontWeight: 800 }}>{money(s.total)}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- Duplicar evento: se copian los reservados (sin clientes ni señales) ---------- */
export async function copiarReservados(desdeId, haciaId) {
  try {
    const { reservados } = await db.loadReservados(desdeId);
    for (const r of reservados) await db.guardarReservado({ ...r, id: uid(), eventId: haciaId, estado: "libre", cliente: "", telefono: "", nota: "", tarifaId: "", senal: 0, senalMetodo: "", promotorId: "", llegadaEn: null });
    return reservados.length;
  } catch { return 0; }
}

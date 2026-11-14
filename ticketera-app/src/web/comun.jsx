// ===================== PIEZAS COMUNES DE LAS PÁGINAS PÚBLICAS =====================
// Página del evento, microsite de la organización, carrito y «Mis entradas».
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { base32, hexToBytes, QR_PREFIJO } from "../qr/token";

export const money = (v) => { const n = Number(v) || 0; return n === 0 ? "Gratis" : n.toLocaleString("es-ES", { style: "currency", currency: "EUR" }); };
export const eur = (v) => (Number(v) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
export const fecha = (v, conHora = true) => { if (!v) return ""; const d = new Date(String(v).length <= 10 ? v + "T12:00" : v); if (isNaN(d)) return ""; return d.toLocaleString("es-ES", { weekday: "long", day: "numeric", month: "long", ...(conHora && String(v).length > 10 ? { hour: "2-digit", minute: "2-digit" } : {}) }); };
export const hora = (v) => { if (!v) return ""; const d = new Date(v); return isNaN(d) ? "" : d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }); };
export const textoQR = (hex) => (hex ? QR_PREFIJO + base32(hexToBytes(hex)) : "");
export const tintaSobre = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return "#fff"; const n = parseInt(m[1], 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); const L = .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; return 1.05 / (L + .05) >= 3 ? "#fff" : "#111"; };
export const LETRA = { inter: "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", serif: "Georgia,'Times New Roman',serif", mono: "'Roboto Mono',ui-monospace,monospace" };
export const MIS = "tixfast_mis_pedidos";

export function tema(diseno) {
  const d = { color: "#ff5a3c", fondo: "oscuro", fondoFlyer: true, letra: "inter", ...(diseno || {}) };
  const osc = d.fondo !== "claro";
  return {
    d, osc, letra: LETRA[d.letra] || LETRA.inter, tinta: tintaSobre(d.color),
    vars: osc
      ? { "--bg": "#08090d", "--card": "rgba(22,24,32,.86)", "--card2": "#1d2029", "--text": "#f3f4f8", "--muted": "#a1a7b8", "--line": "rgba(255,255,255,.1)", "--c": d.color }
      : { "--bg": "#f6f6f8", "--card": "rgba(255,255,255,.92)", "--card2": "#f1f2f5", "--text": "#15171a", "--muted": "#666c76", "--line": "#e3e5e9", "--c": d.color },
  };
}


export function Mensaje({ titulo, texto, children }) {
  return (
    <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#08090d", color: "#f3f4f8", fontFamily: LETRA.inter, padding: 24, textAlign: "center" }}>
      <div style={{ maxWidth: 420 }}>
        <img src="/brand/tixfast_isotipo_app.svg" alt="TIXFAST" width="52" height="52" style={{ display: "block", margin: "0 auto 14px" }} />
        <div style={{ fontWeight: 900, fontSize: 22 }}>{titulo}</div>
        {texto && <div style={{ color: "#a1a7b8", marginTop: 8, lineHeight: 1.5 }}>{texto}</div>}
        {children}
      </div>
    </div>
  );
}

export const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
export const reducido = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* ---------- Fondo de fotos a pantalla completa (fundido y zoom lento) ---------- */
export function Diapositivas({ fotos, color }) {
  const [i, setI] = useState(0);
  useEffect(() => { if (fotos.length < 2 || reducido()) return; const t = setInterval(() => setI(x => (x + 1) % fotos.length), 5000); return () => clearInterval(t); }, [fotos.length]);
  if (!fotos.length) return <div style={{ position: "absolute", inset: 0, background: `radial-gradient(120% 90% at 20% 10%, ${color}, #08090d 70%)` }} />;
  return fotos.map((u, k) => (
    <img key={u + k} src={u} alt="" aria-hidden="true" loading={k ? "lazy" : "eager"} className={k === i ? "pub-kb" : ""}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: k === i ? 1 : 0, transition: "opacity 1.2s ease" }} />
  ));
}

/* ---------- Galería que pasa sola (se puede deslizar y ampliar) ---------- */
export function Galeria({ fotos, alto = "clamp(220px, 46cqw, 420px)", grande }) {
  const pista = useRef(null);
  const [i, setI] = useState(0);
  const [pausa, setPausa] = useState(false);
  const [zoom, setZoom] = useState(null);
  const ir = (k) => { const el = pista.current; if (!el) return; const n = (k + fotos.length) % fotos.length; el.scrollTo({ left: n * el.clientWidth, behavior: "smooth" }); };
  useEffect(() => { if (fotos.length < 2 || pausa || reducido() || zoom != null) return; const t = setInterval(() => ir(i + 1), 4200); return () => clearInterval(t); }, [i, pausa, fotos.length, zoom]);
  const alMover = () => { const el = pista.current; if (el) setI(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))); };
  const flecha = { position: "absolute", top: "50%", transform: "translateY(-50%)", width: 44, height: 44, borderRadius: 44, border: "none", background: "rgba(0,0,0,.45)", color: "#fff", fontSize: 22, cursor: "pointer", display: "grid", placeItems: "center", backdropFilter: "blur(6px)" };
  return (
    <section aria-label="Galería de fotos" style={{ position: "relative" }} onMouseEnter={() => setPausa(true)} onMouseLeave={() => setPausa(false)} onTouchStart={() => setPausa(true)}>
      <div ref={pista} onScroll={alMover} className="pub-pista" style={{ height: alto, borderRadius: grande ? 24 : 20 }}>
        {fotos.map((u, k) => (
          <button key={u + k} onClick={() => setZoom(k)} aria-label={`Ampliar foto ${k + 1} de ${fotos.length}`} style={{ flex: "0 0 100%", height: "100%", scrollSnapAlign: "start", border: "none", padding: 0, cursor: "zoom-in", background: "#000" }}>
            <img src={u} alt="" loading={k ? "lazy" : "eager"} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </button>))}
      </div>
      {fotos.length > 1 && <>
        <button onClick={() => ir(i - 1)} aria-label="Foto anterior" className="pub-flecha" style={{ ...flecha, left: 12 }}>‹</button>
        <button onClick={() => ir(i + 1)} aria-label="Foto siguiente" className="pub-flecha" style={{ ...flecha, right: 12 }}>›</button>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 12, display: "flex", justifyContent: "center", gap: 6 }}>
          {fotos.map((_, k) => <button key={k} onClick={() => ir(k)} aria-label={`Ir a la foto ${k + 1}`} style={{ width: k === i ? 22 : 8, height: 8, borderRadius: 8, border: "none", padding: 0, cursor: "pointer", background: k === i ? "#fff" : "rgba(255,255,255,.5)", transition: "width .25s" }} />)}
        </div>
      </>}
      {zoom != null && createPortal(
        <div role="dialog" aria-label="Foto ampliada" onClick={() => setZoom(null)} style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,.92)", display: "grid", placeItems: "center", padding: 16 }}>
          <img src={fotos[zoom]} alt="" style={{ maxWidth: "100%", maxHeight: "86vh", objectFit: "contain", borderRadius: 12 }} />
          <button onClick={(e) => { e.stopPropagation(); setZoom((zoom - 1 + fotos.length) % fotos.length); }} aria-label="Foto anterior" style={{ ...flecha, left: 12 }}>‹</button>
          <button onClick={(e) => { e.stopPropagation(); setZoom((zoom + 1) % fotos.length); }} aria-label="Foto siguiente" style={{ ...flecha, right: 12 }}>›</button>
          <button onClick={() => setZoom(null)} aria-label="Cerrar" style={{ ...flecha, top: 30, right: 14, transform: "none" }}>✕</button>
        </div>, document.body)}
    </section>
  );
}

export const card = { background: "var(--card)", border: "1px solid var(--line)", borderRadius: 18, padding: 16, backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" };
export const btn = (bg, color) => ({ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, background: bg, color, border: "none", borderRadius: 14, padding: "13px 20px", fontWeight: 900, fontSize: 16, cursor: "pointer", fontFamily: "inherit" });
export const Chip = ({ children }) => <span style={{ border: "1px solid var(--line)", background: "var(--card)", borderRadius: 30, padding: "7px 13px", fontSize: 14, fontWeight: 800 }}>{children}</span>;
export const Aviso = ({ c, children }) => <div role="status" style={{ background: c, color: "#1a1205", borderRadius: 12, padding: "10px 14px", fontWeight: 800, fontSize: 14, marginBottom: 14 }}>{children}</div>;
export const ICO = { cal: "M4 6h16v15H4zM4 10h16M8 3v4M16 3v4", pin: "M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" };
export const Linea = ({ ico, children }) => (
  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--c)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true"><path d={ICO[ico]} /></svg>
    <span style={{ fontWeight: 600, lineHeight: 1.4, textTransform: "none" }}>{children}</span>
  </div>
);

/* ---------- Un tramo ---------- */
export function Tramo({ t, sig, avisos, n, T, onN, offset = 0, top = false, onFin }) {
  const venta = t.estado === "venta";
  const modo = avisos.modoQuedan || "pocas";
  const max = Math.max(0, Math.min(t.max_por_compra || 10, t.quedan ?? 99));
  const pctVend = t.cantidad ? Math.round((1 - (t.quedan ?? 0) / t.cantidad) * 100) : null;
  const umbralN = parseInt(avisos.umbralN, 10);
  const pocas = venta && avisos.activo !== false && modo !== "porcentaje" && t.cantidad && t.quedan != null && t.quedan > 0 &&
    ((Number.isFinite(umbralN) && t.quedan <= umbralN) || t.quedan / t.cantidad * 100 <= (avisos.umbralPct ?? 15));
  const etiqueta = t.estado === "agotado" ? "Agotado" : t.estado === "finalizado" ? "Finalizado" : t.estado === "proximo" ? (t.venta_inicio ? `Desde el ${fecha(t.venta_inicio)}` : "Próximamente") : null;
  return (
    <div style={{ ...card, marginBottom: 10, display: "flex", flexDirection: "column", gap: 10, opacity: venta ? 1 : .6, borderColor: n ? "var(--c)" : "var(--line)", boxShadow: n ? "0 0 0 1px var(--c)" : "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {top && venta && <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "color-mix(in srgb, var(--c) 18%, transparent)", color: "var(--c)", borderRadius: 30, padding: "3px 10px", fontWeight: 900, fontSize: 12, marginBottom: 6 }}>★ El más elegido</div>}
          <div style={{ fontWeight: 900, fontSize: 18, textDecoration: t.estado === "agotado" ? "line-through" : "none" }}>{t.nombre}</div>
          {t.descripcion && <div style={{ color: "var(--muted)", fontSize: 14, marginTop: 2 }}>{t.descripcion}</div>}
          {t.copas > 0 && <div style={{ color: "var(--muted)", fontSize: 14, marginTop: 2 }}>Incluye {t.copas} {t.copas === 1 ? "copa" : "copas"}</div>}
        </div>
        <div style={{ fontWeight: 900, fontSize: 22, color: venta ? "var(--c)" : "var(--muted)", flexShrink: 0 }}>{money(t.precio)}</div>
      </div>
      {pocas && <div className="pub-pulso" style={{ alignSelf: "flex-start", background: "var(--c)", color: T.tinta, borderRadius: 30, padding: "5px 12px", fontWeight: 900, fontSize: 13 }}>
        {Number.isFinite(umbralN) && t.quedan <= umbralN ? `¡Últimas ${t.quedan} entradas!` : "¡Quedan pocas!"}</div>}
      {venta && modo === "exacto" && t.cantidad && t.quedan != null && t.quedan > 0 && (
        <div style={{ fontSize: 14, fontWeight: 800 }}>Quedan <Cifra v={t.quedan} c="var(--c)" /> de {t.cantidad} a este precio</div>)}
      {venta && avisos.cuentaTramo !== false && t.venta_fin && <RelojTramo hasta={t.venta_fin} offset={offset} onFin={onFin} />}
      {venta && (avisos.mostrarVendido !== false || modo === "porcentaje") && pctVend != null && pctVend >= (modo === "porcentaje" ? 10 : 30) && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 800, color: "var(--muted)" }}>
          <span style={{ flex: 1, height: 6, borderRadius: 6, background: "var(--card2)", overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${pctVend}%`, background: "var(--c)" }} /></span>{pctVend} % vendido
        </div>)}
      {venta && avisos.siguientePrecio !== false && sig && Number(sig.precio) > Number(t.precio) && <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 700 }}>Después sube a {eur(sig.precio)}</div>}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        {etiqueta ? <span style={{ fontWeight: 900, color: "var(--muted)" }}>{etiqueta}</span> : <span style={{ fontSize: 13, color: "var(--muted)" }}>Máx. {t.max_por_compra} por compra</span>}
        {venta && <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button aria-label={`Quitar una entrada ${t.nombre}`} disabled={n <= 0} onClick={() => onN(Math.max(0, n - 1))} style={{ ...stepBtn, opacity: n <= 0 ? .35 : 1 }}>−</button>
          <span aria-live="polite" style={{ minWidth: 30, textAlign: "center", fontWeight: 900, fontSize: 20 }}>{n}</span>
          <button aria-label={`Añadir una entrada ${t.nombre}`} disabled={n >= max} onClick={() => onN(Math.min(max, n + 1))} style={{ ...stepBtn, background: "var(--c)", color: T.tinta, borderColor: "var(--c)", opacity: n >= max ? .35 : 1 }}>+</button>
        </div>}
      </div>
    </div>
  );
}
export const stepBtn = { width: 44, height: 44, borderRadius: 12, border: "1px solid var(--line)", background: "var(--card2)", color: "var(--text)", fontSize: 24, fontWeight: 800, cursor: "pointer", lineHeight: 1, fontFamily: "inherit" };

/* ---------- Técnicas de venta (siempre con datos reales) ---------- */
// Número que «cae» con una pequeña animación cada vez que cambia (p. ej. al venderse una entrada)
export function Cifra({ v, c }) {
  const [k, setK] = useState(0); const prev = useRef(v);
  useEffect(() => { if (prev.current !== v) { prev.current = v; setK(x => x + 1); } }, [v]);
  return <b key={k} className={k ? "pub-tick" : ""} style={{ color: c, fontVariantNumeric: "tabular-nums" }}>{v}</b>;
}
// Reloj hasta que acaba el precio del tramo (su fin de venta real). Solo los últimos 7 días.
export function RelojTramo({ hasta, offset = 0, onFin }) {
  const [ahora, setAhora] = useState(Date.now() + offset);
  useEffect(() => { const t = setInterval(() => setAhora(Date.now() + offset), 1000); return () => clearInterval(t); }, [offset]);
  const ms = new Date(hasta).getTime() - ahora;
  useEffect(() => { if (ms <= 0 && onFin) { const t = setTimeout(onFin, 1200); return () => clearTimeout(t); } }, [ms <= 0]);
  if (!(ms > 0) || ms > 7 * 864e5) return null;
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), p = (x) => String(x).padStart(2, "0");
  const txt = `${d ? `${d} d ` : ""}${p(Math.floor(s % 86400 / 3600))}:${p(Math.floor(s % 3600 / 60))}:${p(s % 60)}`;
  return <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 800 }}>
    <span aria-hidden="true">⏱</span><span>Este precio acaba en <b style={{ color: "var(--c)", fontVariantNumeric: "tabular-nums" }}>{txt}</b></span>
  </div>;
}
const haceTxt = (s) => (s < 90 ? "ahora mismo" : s < 3600 ? `hace ${Math.round(s / 60)} min` : s < 86400 ? `hace ${Math.round(s / 3600)} h` : "ayer");
// Avisos discretos de compras reales recientes («Alguien ha comprado 2 entradas · hace 3 min»). Sin nombres.
export function AvisosCompra({ social, servidor, offset = 0, T }) {
  const vistos = useRef(new Set()); const n = useRef(0);
  const [actual, setActual] = useState(null);
  const lista = useMemo(() => {
    const base = new Date(servidor || Date.now()).getTime();
    return (social?.recientes || []).filter(r => r && r.n > 0 && r.hace < 72 * 3600).map(r => ({ ...r, en: base - r.hace * 1000, clave: `${Math.round((base - r.hace * 1000) / 1000)}-${r.n}-${r.tramo || ""}` }));
  }, [social, servidor]);
  const listaRef = useRef(lista); listaRef.current = lista;
  useEffect(() => {
    let vivo = true, t1, t2;
    const siguiente = () => {
      if (!vivo || n.current >= 5 || document.visibilityState === "hidden") { t1 = setTimeout(siguiente, 15000); return; }
      const r = listaRef.current.find(x => !vistos.current.has(x.clave));
      if (r) { vistos.current.add(r.clave); n.current++; setActual(r); t2 = setTimeout(() => vivo && setActual(null), 6500); }
      t1 = setTimeout(siguiente, r ? 16000 + Math.random() * 8000 : 12000);
    };
    t1 = setTimeout(siguiente, 7000);
    return () => { vivo = false; clearTimeout(t1); clearTimeout(t2); };
  }, []);
  if (!actual) return null;
  const s = Math.max(0, (Date.now() + offset - actual.en) / 1000);
  return (
    <div role="status" aria-live="polite" className="pub-noti" onClick={() => setActual(null)}
      style={{ position: "fixed", zIndex: 25, left: 12, bottom: "calc(96px + env(safe-area-inset-bottom))", maxWidth: "min(340px, calc(100vw - 24px))", display: "flex", alignItems: "center", gap: 10, background: "var(--card)", border: "1px solid var(--line)", borderRadius: 14, padding: "10px 14px", boxShadow: "0 16px 40px -12px rgba(0,0,0,.5)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", cursor: "pointer", fontSize: 13.5 }}>
      <span aria-hidden="true" style={{ width: 30, height: 30, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--c)", color: T?.tinta || "#fff", fontWeight: 900, flexShrink: 0 }}>✓</span>
      <span style={{ lineHeight: 1.3 }}><b>Alguien{actual.ciudad ? ` de ${actual.ciudad}` : ""}</b> ha comprado {actual.n} {actual.n === 1 ? "entrada" : "entradas"}{actual.tramo ? ` · ${actual.tramo}` : ""}<br /><span style={{ color: "var(--muted)", fontSize: 12.5 }}>{haceTxt(s)}</span></span>
    </div>
  );
}
// Franja de datos reales encima de las entradas: vendidas en 24 h, total y cuenta atrás al evento
export function PruebaSocial({ ev, avisos, offset = 0 }) {
  const so = ev.social || {}; const items = [];
  if (avisos.vendidas24 && so.h24 >= 5) items.push(["🔥", <><b>{so.h24}</b> entradas vendidas en las últimas 24 h</>]);
  const min = parseInt(avisos.minTotal, 10);
  if (avisos.totalVendidas && so.total >= (Number.isFinite(min) ? min : 50)) items.push(["👥", <>Ya van <b>{so.total}</b> personas con entrada</>]);
  const ini = new Date(ev.inicio || (ev.fecha ? ev.fecha + "T22:00" : "")).getTime(), falta = ini - (Date.now() + offset);
  if (avisos.cuentaEvento && falta > 0 && falta < 31 * 864e5) { const d = Math.floor(falta / 864e5), h = Math.floor(falta % 864e5 / 36e5);
    items.push(["⏳", d >= 1 ? <>Faltan <b>{d} {d === 1 ? "día" : "días"}</b>{d < 3 && h ? ` y ${h} h` : ""}</> : <>¡Es <b>hoy</b>! Faltan {h ? `${h} h` : "minutos"}</>]); }
  if (!items.length) return null;
  return <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
    {items.map(([i, t], k) => <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--card2)", border: "1px solid var(--line)", borderRadius: 12, padding: "9px 12px", fontSize: 14 }}><span aria-hidden="true">{i}</span><span>{t}</span></div>)}
  </div>;
}

/* ---------- Cuenta atrás de lanzamiento ---------- */
export function CuentaAtras({ hasta, offset, color, onFin }) {
  const [ahora, setAhora] = useState(Date.now() + offset);
  useEffect(() => { const t = setInterval(() => setAhora(Date.now() + offset), 250); return () => clearInterval(t); }, [offset]);
  const ms = Math.max(0, new Date(hasta).getTime() - ahora);
  useEffect(() => { if (ms === 0) { const t = setTimeout(onFin, 800); return () => clearTimeout(t); } }, [ms === 0]);
  const s = Math.floor(ms / 1000), u = [[Math.floor(s / 86400), "días"], [Math.floor(s % 86400 / 3600), "horas"], [Math.floor(s % 3600 / 60), "min"], [s % 60, "seg"]];
  return (
    <section style={{ ...card, marginTop: 22, textAlign: "center", padding: "22px 14px" }}>
      <div style={{ fontWeight: 900, letterSpacing: 2, textTransform: "uppercase", fontSize: 13, color: "var(--muted)" }}>La venta empieza en</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8, margin: "14px 0 10px" }}>
        {u.map(([v, l]) => <div key={l} style={{ background: "var(--card2)", borderRadius: 14, padding: "12px 4px", border: "1px solid var(--line)" }}>
          <div style={{ fontSize: "clamp(30px, 9cqw, 52px)", fontWeight: 900, color, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{String(v).padStart(2, "0")}</div>
          <div style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)", marginTop: 4 }}>{l}</div>
        </div>)}
      </div>
      <div style={{ fontWeight: 700 }}>{fecha(hasta)}</div>
    </section>
  );
}


/* ---------- Formularios ---------- */
export const CAMPOS = [
  { k: "telefono", t: "Teléfono", type: "tel", ac: "tel" }, { k: "dni", t: "DNI / NIE", ac: "off" }, { k: "nacimiento", t: "Fecha de nacimiento", type: "date", ac: "bday" },
  { k: "cp", t: "Código postal", ac: "postal-code", im: "numeric" }, { k: "direccion", t: "Dirección", ac: "street-address" }, { k: "ciudad", t: "Ciudad", ac: "address-level2" },
  { k: "genero", t: "Género", sel: ["Mujer", "Hombre", "No binario", "Prefiero no decirlo"] },
];
export const ERRORES = {
  email: "Revisa el correo.", nombre: "Escribe tu nombre completo.", condiciones: "Tienes que aceptar las condiciones.", edad: "Confirma la edad mínima.",
  vacio: "Elige al menos una entrada.", cantidad: "Demasiadas entradas en una compra.", asistentes: "Falta el nombre de algún asistente.", nombre_asistente: "Escribe el nombre completo de cada asistente.",
  limite_email: "Has llegado al máximo de entradas por persona para este evento.", tramo_proximo: "Ese tramo aún no está a la venta.", tramo_agotado: "Ese tramo se acaba de agotar.",
  tramo_finalizado: "Ese tramo ya no está a la venta.", max_compra: "Superas el máximo por compra de un tramo.", sin_sitio: "No quedan tantas entradas en ese tramo.",
  pago_no_disponible: "El pago online aún no está disponible para este evento.", demasiados_intentos: "Demasiados intentos seguidos. Espera unos minutos.", cerrado: "La venta está cerrada.", no_existe: "El evento ya no existe.",
};
export const lbl = { display: "flex", flexDirection: "column", gap: 6, marginBottom: 12, fontWeight: 800, fontSize: 14 };
export const inpP = { width: "100%", boxSizing: "border-box", background: "var(--card2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 12, padding: "13px 14px", fontSize: 16, fontFamily: "inherit", outline: "none" };
export const Campo = ({ l, v, on, type = "text", ac, im, sub }) => (
  <label style={lbl}><span>{l}</span><input type={type} value={v} onChange={e => on(e.target.value)} autoComplete={ac} inputMode={im} style={inpP} />{sub && <span style={{ fontWeight: 600, fontSize: 12.5, color: "var(--muted)" }}>{sub}</span>}</label>
);
export const Check = ({ v, on, children }) => (
  <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", lineHeight: 1.4, fontSize: 14.5 }}>
    <input type="checkbox" checked={v} onChange={e => on(e.target.checked)} style={{ width: 22, height: 22, flexShrink: 0, accentColor: "var(--c)", marginTop: 1 }} /><span>{children}</span>
  </label>
);

export const CSS_PUB = `
*{box-sizing:border-box}
body{margin:0}
.pub-cont{container-type:inline-size;container-name:pub}
.pub-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:20px}
.pub-dos{display:grid;grid-template-columns:minmax(0,1fr);gap:20px}
@container pub (min-width:860px){.pub-grid{grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);gap:36px;align-items:start}.pub-flyer{position:sticky;top:20px}.pub-dos{grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr);gap:32px;align-items:start}}
.pub-solo-ancho{display:none}
.pub-flecha{display:none !important}
@container pub (min-width:700px){.pub-solo-ancho{display:block}.pub-flecha{display:grid !important}}
.pub-pista{display:flex;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;scrollbar-width:none;-webkit-overflow-scrolling:touch;background:#000}
.pub-pista::-webkit-scrollbar{display:none}
.pub-barra{position:fixed;left:0;right:0;bottom:0;z-index:20;display:flex;align-items:center;gap:14px;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:var(--card);border-top:1px solid var(--line);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}
@media (min-width:860px){.pub-barra{left:50%;right:auto;bottom:18px;transform:translateX(-50%);width:min(620px,calc(100vw - 32px));border:1px solid var(--line);border-radius:18px;box-shadow:0 20px 50px rgba(0,0,0,.35)}}
@keyframes pubPulso{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
.pub-pulso{animation:pubPulso 1.6s ease-in-out infinite}
@keyframes pubKb{from{transform:scale(1.1)}to{transform:scale(1)}}
.pub-kb{animation:pubKb 9s ease-out both}
@keyframes pubTick{0%{transform:translateY(-35%);opacity:.2}100%{transform:none;opacity:1}}
.pub-tick{display:inline-block;animation:pubTick .45s ease-out}
@keyframes pubNoti{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}
.pub-noti{animation:pubNoti .35s ease-out both}
@media (prefers-reduced-motion:reduce){.pub-pulso,.pub-kb,.pub-tick,.pub-noti{animation:none}}
button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid var(--c);outline-offset:2px}
`;

/* ===================== PRIVACIDAD (RGPD) =====================
   Primera capa junto al formulario + segunda capa completa en una hoja. El responsable es el organizador. */
export const PRIVACIDAD_VERSION = "2026-11-v2";
export function InfoPrivacidad({ legal, organizador, previa }) {
  const [ver, setVer] = useState(false);
  const l = legal || {};
  const quien = l.razon_social || organizador || "el organizador del evento";
  const meses = l.conservar_meses || 24;
  const hoja = ver && (
    <div role="dialog" aria-modal="true" aria-label="Información sobre privacidad" onClick={() => setVer(false)}
      style={{ position: previa ? "absolute" : "fixed", inset: 0, zIndex: 80, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--card, #15161c)", color: "var(--text, #eceef5)", width: "100%", maxWidth: 620, maxHeight: "86%", overflow: "auto", borderRadius: "20px 20px 0 0", padding: "20px 18px 28px", fontSize: 14.5, lineHeight: 1.55, fontFamily: "Inter, -apple-system, Segoe UI, Roboto, sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
          <b style={{ fontSize: 19 }}>Tus datos y tu privacidad</b>
          <button type="button" onClick={() => setVer(false)} aria-label="Cerrar" style={{ background: "transparent", border: "1px solid var(--line, #333)", color: "inherit", borderRadius: 10, padding: "6px 10px", cursor: "pointer", font: "inherit", fontWeight: 800 }}>Cerrar</button>
        </div>
        <p><b>Responsable:</b> {quien}{l.nif ? ` · NIF ${l.nif}` : ""}{l.direccion ? ` · ${l.direccion}` : ""}{l.email ? <> · <a href={`mailto:${l.email}`} style={{ color: "inherit" }}>{l.email}</a></> : ""}.</p>
        <p><b>Para qué usamos tus datos:</b> para emitir y enviarte tus entradas, controlar el acceso al evento (las entradas son nominativas), atender tus consultas y cumplir obligaciones legales. Base legal: la compra que haces (contrato) y la ley.</p>
        <p><b>Novedades y ofertas:</b> solo si marcas la casilla, te enviaremos por correo novedades, preventas y ofertas de nuestros eventos, adaptadas a lo que has comprado. Base legal: tu consentimiento. Puedes retirarlo cuando quieras con el enlace de cada correo o escribiéndonos, sin que afecte a tus entradas.</p>
        <p><b>Qué datos:</b> los que rellenas en el formulario (nombre, correo y los demás que pida este evento), los nombres de los asistentes y datos técnicos de la compra para evitar fraudes.</p>
        <p><b>Cuánto tiempo:</b> los datos de la compra, hasta {meses} meses después del evento (o más si una ley lo exige, por ejemplo para facturación). Los de novedades, hasta que te des de baja.</p>
        <p><b>Relaciones públicas:</b> si compras con el enlace o el código de un relaciones públicas del evento, o le pagas a él en mano, la venta queda a su nombre para calcular su comisión. Solo ve tu nombre y cuántas entradas compraste; nunca tu correo ni tu teléfono.</p>
        <p><b>Quién más los trata:</b> TIXFAST, la plataforma de venta, como encargado del tratamiento, y sus proveedores de alojamiento y envío de correo, con contrato y dentro de la UE o países con protección equivalente. No vendemos tus datos.</p>
        <p><b>Tus derechos:</b> puedes pedir acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a {l.email ? <a href={`mailto:${l.email}`} style={{ color: "inherit" }}>{l.email}</a> : "el organizador"}. Si crees que no se respetan, puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es).</p>
        <p style={{ fontSize: 12.5, opacity: .7 }}>Versión {PRIVACIDAD_VERSION}</p>
      </div>
    </div>
  );
  return (
    <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--muted)" }}>
      <b style={{ color: "var(--text)" }}>Privacidad:</b> {quien} usará tus datos para gestionar tus entradas y, solo si lo marcas, para enviarte novedades. Puedes ejercer tus derechos{l.email ? ` en ${l.email}` : ""}.{" "}
      <button type="button" onClick={() => setVer(true)} style={{ background: "none", border: "none", padding: 0, color: "var(--text)", textDecoration: "underline", cursor: "pointer", font: "inherit", fontWeight: 700 }}>Más información</button>
      {hoja && (previa ? hoja : createPortal(hoja, document.body))}
    </div>
  );
}

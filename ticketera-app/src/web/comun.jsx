// ===================== PIEZAS COMUNES DE LAS PÁGINAS PÚBLICAS =====================
// Página del evento, microsite de la organización, carrito y «Mis entradas».
import React, { useEffect, useRef, useState } from "react";
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
export function Tramo({ t, sig, avisos, n, T, onN }) {
  const venta = t.estado === "venta";
  const max = Math.max(0, Math.min(t.max_por_compra || 10, t.quedan ?? 99));
  const pctVend = t.cantidad ? Math.round((1 - (t.quedan ?? 0) / t.cantidad) * 100) : null;
  const umbralN = parseInt(avisos.umbralN, 10);
  const pocas = venta && avisos.activo !== false && t.cantidad && t.quedan != null && t.quedan > 0 &&
    ((Number.isFinite(umbralN) && t.quedan <= umbralN) || t.quedan / t.cantidad * 100 <= (avisos.umbralPct ?? 15));
  const etiqueta = t.estado === "agotado" ? "Agotado" : t.estado === "finalizado" ? "Finalizado" : t.estado === "proximo" ? (t.venta_inicio ? `Desde el ${fecha(t.venta_inicio)}` : "Próximamente") : null;
  return (
    <div style={{ ...card, marginBottom: 10, display: "flex", flexDirection: "column", gap: 10, opacity: venta ? 1 : .6, borderColor: n ? "var(--c)" : "var(--line)", boxShadow: n ? "0 0 0 1px var(--c)" : "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: 18, textDecoration: t.estado === "agotado" ? "line-through" : "none" }}>{t.nombre}</div>
          {t.descripcion && <div style={{ color: "var(--muted)", fontSize: 14, marginTop: 2 }}>{t.descripcion}</div>}
          {t.copas > 0 && <div style={{ color: "var(--muted)", fontSize: 14, marginTop: 2 }}>Incluye {t.copas} {t.copas === 1 ? "copa" : "copas"}</div>}
        </div>
        <div style={{ fontWeight: 900, fontSize: 22, color: venta ? "var(--c)" : "var(--muted)", flexShrink: 0 }}>{money(t.precio)}</div>
      </div>
      {pocas && <div className="pub-pulso" style={{ alignSelf: "flex-start", background: "var(--c)", color: T.tinta, borderRadius: 30, padding: "5px 12px", fontWeight: 900, fontSize: 13 }}>
        {Number.isFinite(umbralN) && t.quedan <= umbralN ? `¡Últimas ${t.quedan} entradas!` : "¡Quedan pocas!"}</div>}
      {venta && avisos.mostrarVendido !== false && pctVend != null && pctVend >= 30 && (
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
@media (prefers-reduced-motion:reduce){.pub-pulso,.pub-kb{animation:none}}
button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid var(--c);outline-offset:2px}
`;

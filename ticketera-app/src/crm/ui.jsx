// Utilidades y estilos compartidos del CRM
import React, { useEffect, useState } from "react";

// Siempre con separador de miles (1.380,00 €): más fácil de leer de un vistazo
const FMT = (() => { try { return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", useGrouping: "always" }); } catch { return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }); } })();
export const money = (v) => FMT.format(v || 0);
export const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
export const hoy = () => new Date().toISOString().slice(0, 10);
export const fechaCorta = (iso) => { try { return new Date(iso + "T12:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "short" }); } catch { return iso; } };
export const parseImporte = (t) => { const v = parseFloat(String(t || "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(v) ? r2(v) : 0; };
export const isInvite = (s) => !!(s && (s.invite || /^invitacion/.test(s.pago || "")));
export function useIsMobile(bp = 720) {
  const [m, setM] = useState(typeof window !== "undefined" ? window.innerWidth < bp : false);
  useEffect(() => { const h = () => setM(window.innerWidth < bp); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, [bp]);
  return m;
}


export const Dot = ({ c }) => <span style={{ width: 10, height: 10, borderRadius: "50%", background: c || "var(--muted)", display: "inline-block", flexShrink: 0 }} />;

/* ===================== TEMA CLARO / OSCURO =====================
   Cada persona elige cómo trabajar; se recuerda en su dispositivo. El claro sigue el estilo de la landing:
   fondo casi blanco, tarjetas blancas con sombra suave y el coral solo en lo activo. */
export const TEMAS = {
  oscuro: {
    "--bg": "#0b0c10", "--surface": "#14161d", "--surface2": "#1c1f29", "--line": "#2a2e3a", "--text": "#eceef5", "--muted": "#838aa0",
    "--accent": "#ff5a3c", "--green": "#22d3a6", "--amber": "#ffb400", "--red": "#ff4d4d",
    "--blue": "#60a5fa", "--wa": "#4ade80", "--teal": "#2dd4bf", "--rose": "#fb7185",
    "--shadow": "none", "--overlay": "rgba(0,0,0,.72)",
    "--hero": "radial-gradient(120% 140% at 0% 0%, rgba(255,90,60,.22), transparent 60%), #14161d",
    "--head": "#14161d", colorScheme: "dark",
  },
  claro: {
    "--bg": "#fafafb", "--surface": "#ffffff", "--surface2": "#f4f5f7", "--line": "#e6e8eb", "--text": "#15171a", "--muted": "#6f747d",
    "--accent": "#ff5a3c", "--green": "#0e9f75", "--amber": "#a16207", "--red": "#dc2626",
    "--blue": "#2563eb", "--wa": "#15803d", "--teal": "#0f766e", "--rose": "#e11d48",
    "--shadow": "0 1px 2px rgba(15,17,22,.04), 0 10px 28px -16px rgba(15,17,22,.14)", "--overlay": "rgba(21,23,26,.38)",
    "--hero": "radial-gradient(120% 140% at 0% 0%, rgba(255,90,60,.09), transparent 60%), #ffffff",
    "--head": "rgba(250,250,251,.9)", colorScheme: "light",
  },
};
const K_TEMA = "tixfast_crm_tema";
export function useTema() {
  const [tema, setTema] = useState(() => {
    try { const t = localStorage.getItem(K_TEMA); if (t === "claro" || t === "oscuro") return t; } catch {}
    try { return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "claro" : "oscuro"; } catch { return "oscuro"; }
  });
  const cambiar = () => setTema(t => { const n = t === "claro" ? "oscuro" : "claro"; try { localStorage.setItem(K_TEMA, n); } catch {} return n; });
  return [tema, cambiar];
}

/* ===================== ESTILOS DEL CRM ===================== */
export const C = {
  btnPrimary: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 12, padding: "11px 18px", fontWeight: 900, fontSize: 14.5, cursor: "pointer", whiteSpace: "nowrap" },
  btnGhost: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 12, padding: "11px 16px", fontWeight: 800, fontSize: 14, cursor: "pointer", whiteSpace: "nowrap" },
  btnSm: { display: "inline-flex", alignItems: "center", gap: 6, background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "7px 11px", fontWeight: 800, fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap" },
  listBtn: { display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "11px 4px", background: "transparent", border: "none", borderTop: "1px solid var(--line)", color: "var(--text)", cursor: "pointer", textAlign: "left", font: "inherit" },
  miniSelect: { background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "7px 28px 7px 10px", fontWeight: 800, fontSize: 12.5, outline: "none", cursor: "pointer", maxWidth: "100%" },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "var(--head)", backdropFilter: "saturate(1.6) blur(14px)", WebkitBackdropFilter: "saturate(1.6) blur(14px)", borderBottom: "1px solid var(--line)", color: "var(--text)", flexShrink: 0, paddingTop: "max(10px, env(safe-area-inset-top))" },
  crmPill: { background: "rgba(255,90,60,.14)", color: "var(--accent)", fontWeight: 900, letterSpacing: 2, fontSize: 13, borderRadius: 8, padding: "4px 10px" },
  headSelect: { flex: 1, minWidth: 0, background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 10px", fontWeight: 800, outline: "none" },
  backBtn: { flexShrink: 0, background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 14px", fontWeight: 900, fontSize: 14, cursor: "pointer" },
  tabs: { display: "flex", gap: 4, background: "var(--surface)", borderBottom: "1px solid var(--line)", flexShrink: 0, overflowX: "auto" },
  tab: { background: "transparent", border: "none", borderBottomWidth: 3, borderBottomStyle: "solid", borderBottomColor: "transparent", color: "var(--muted)", padding: "13px 14px 11px", fontWeight: 800, fontSize: 15, cursor: "pointer", whiteSpace: "nowrap" },
  tabOn: { color: "var(--text)", borderBottomColor: "var(--accent)" },
  hero: { background: "var(--hero)", border: "1px solid var(--line)", borderRadius: 18, boxShadow: "var(--shadow)" },
  label: { fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1.2, fontWeight: 800, marginBottom: 6 },
  tag: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 700, border: "1px solid var(--line)", borderRadius: 20, padding: "4px 10px", background: "var(--surface2)" },
  card: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: 14, minWidth: 0, boxShadow: "var(--shadow)" },
  panel: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 16, boxShadow: "var(--shadow)" },
  row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 0", borderTop: "1px solid var(--line)" },
  ingRow: { display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "11px 8px", borderTop: "1px solid var(--line)", background: "transparent", border: "none", borderTopStyle: "solid", borderTopWidth: 1, borderTopColor: "var(--line)", color: "var(--text)", cursor: "pointer", borderRadius: 0 },
  live: { fontSize: 12, color: "var(--green)", fontWeight: 800, marginLeft: 6 },
  seg: { display: "inline-flex", alignItems: "center", gap: 6, background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 20, padding: "7px 12px", fontWeight: 700, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" },
  segOn: { background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" },
  primary: { background: "var(--accent)", color: "#fff", border: "none", borderRadius: 12, padding: "12px 18px", fontWeight: 900, fontSize: 15, cursor: "pointer" },
  ghost: { background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 12, padding: "11px 16px", fontWeight: 700, cursor: "pointer" },
  small: { background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px", fontSize: 12.5, fontWeight: 800, cursor: "pointer" },
  input: { width: "100%", boxSizing: "border-box", background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "11px 13px", fontSize: 15, outline: "none" },
  empty: { textAlign: "center", padding: "22px 12px", color: "var(--muted)", border: "2px dashed var(--line)", borderRadius: 14, fontSize: 13.5 },
  modalWrap: { position: "fixed", inset: 0, zIndex: 90, background: "var(--overlay)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" },
  modal: { width: "100%", maxWidth: 520, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 22, padding: 20, paddingBottom: "calc(20px + env(safe-area-inset-bottom))", maxHeight: "92dvh", overflow: "auto", boxSizing: "border-box", alignSelf: "center", margin: "0 auto" },
  toggleRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 14, fontWeight: 700 },
  switch: { width: 44, height: 24, borderRadius: 20, border: "none", position: "relative", cursor: "pointer", flexShrink: 0, padding: 0 },
  knob: { position: "absolute", top: 2, left: 0, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "transform .15s" },
  check: { width: 28, height: 28, borderRadius: 8, border: "2px solid var(--line)", background: "var(--surface2)", color: "#fff", fontWeight: 900, flexShrink: 0, cursor: "pointer", display: "grid", placeItems: "center", padding: 0 },
  checkOn: { background: "var(--accent)", borderColor: "var(--accent)" },
};

/* ===================== ICONOS (mismo trazo que el TPV) ===================== */
export const ICONS = {
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  plus: "M12 5v14M5 12h14", check: "M5 12l4 4 10-10", x: "M6 6l12 12M18 6L6 18", chev: "M6 9l6 6 6-6", right: "M9 6l6 6-6 6",
  edit: "M4 20h4L19 9l-4-4L4 16zM13 7l4 4", trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3", copy: "M8 8h12v12H8zM4 16V4h12",
  lock: "M6 11h12v9H6zM8 11V7a4 4 0 0 1 8 0v4", clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2", user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  wallet: "M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3zM3 7l12-3v3M17 13h.01", receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2", scale: "M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z",
  home: "M3 21h18M5 21V9l7-5 7 5v12M10 21v-6h4v6", building: "M4 21V5l8-2v18M12 21V8l8 3v10M3 21h18M7 9h2M7 13h2M7 17h2M15 13h2M15 17h2",
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3",
  speaker: "M6 3h12v18H6zM12 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 7h.01", wrench: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z",
  glass: "M5 4h14l-6 8v6h3v2H8v-2h3v-6z", bottle: "M10 3h4v4l2 3v11H8V10l2-3zM8 14h8", megaphone: "M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1zM17 8a5 5 0 0 1 0 8",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM12 9v6M9 12h6", sparkle: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z",
  truck: "M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", card: "M3 6h18v12H3zM3 10h18M7 15h3",
  file: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6", alert: "M12 4l9 16H3zM12 10v4M12 17h.01", dots: "M5 12h.01M12 12h.01M19 12h.01",
  cash: "M3 7h18v10H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 10v.01M18 14v.01", bank: "M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18",
  phone: "M8 3h8v18H8zM11 18h2", ticket: "M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4zM14 6v12", shirt: "M8 3l-5 3 2 4 3-1v12h8V9l3 1 2-4-5-3a4 4 0 0 1-8 0z",
  award: "M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8.5 14l-1.5 7 5-3 5 3-1.5-7", globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
  hanger: "M12 7a2 2 0 1 1 2-2M12 7v2L3 16h18l-9-7", store: "M4 10h16l-1-5H5zM5 10v10h14V10M9 20v-5h6v5", pos: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  calendar: "M4 6h16v15H4zM4 10h16M8 3v4M16 3v4", hand: "M6 13V8a2 2 0 0 1 4 0v3M10 11V6a2 2 0 0 1 4 0v5M14 11V7a2 2 0 0 1 4 0v7a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2-3a2 2 0 0 1 3-2l1 1",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", eyeOff: "M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1", refresh: "M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4",
  upload: "M12 16V4M7 9l5-5 5 5M4 16v4h16v-4", key: "M8 15a4 4 0 1 1 3.5-6H21v3h-2v3h-3v-3h-4.5A4 4 0 0 1 8 15z", percent: "M19 5L5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  up: "M6 15l6-6 6 6", mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  soda: "M8 3h8l1 3v14a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V6zM7 6h10M7 17h10", beer: "M6 8h9v12H6zM15 11h2a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2M6 8a3 3 0 0 1 3-4h3a3 3 0 0 1 3 4M9 12v5M12 12v5",
  drop: "M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z", bolt: "M13 3L5 14h6l-1 7 8-11h-6z", cup: "M6 4h12l-1.5 16h-9zM6.5 9h11",
  crate: "M3 8h18v12H3zM3 8l2-4h14l2 4M8 12v4M12 12v4M16 12v4", box: "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10",
  clipboard: "M9 4h6v3H9zM7 5H5v16h14V5h-2M8 13l2.5 2.5L16 10", minus: "M5 12h14", search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5",
  trend: "M3 17l6-6 4 4 8-8M15 7h6v6", filter: "M4 5h16l-6 8v6l-4-2v-4z", whatsapp: "M4 20l1.3-4A8 8 0 1 1 8 18.7zM9 9c0 3 3 6 6 6l1-1.5-2-1-1 .8c-1-.5-1.8-1.3-2.3-2.3l.8-1-1-2z",
};
export const Icon = ({ n, s = 18, w = 1.9, c = "currentColor", style }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, display: style && style.verticalAlign != null ? "inline-block" : "block", ...style }} aria-hidden="true"><path d={ICONS[n] || ICONS.dots} /></svg>
);
// Icono dentro de un cuadrado de color suave (identifica la categoría de un vistazo)
export const Tile = ({ n, c = "var(--accent)", s = 38, i }) => (
  <span style={{ width: s, height: s, borderRadius: Math.round(s * 0.3), background: `color-mix(in srgb, ${c} 16%, transparent)`, color: c, display: "grid", placeItems: "center", flexShrink: 0 }}><Icon n={n} s={i || Math.round(s * 0.5)} /></span>
);
export const Avatar = ({ nombre = "?", c, s = 26 }) => (
  <span style={{ width: s, height: s, borderRadius: "50%", background: c || "var(--muted)", color: "#fff", fontWeight: 900, fontSize: Math.round(s * 0.42), display: "grid", placeItems: "center", flexShrink: 0, lineHeight: 1 }}>{String(nombre).trim().charAt(0).toUpperCase() || "?"}</span>
);
export const Badge = ({ children, c = "var(--muted)", solid }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 800, letterSpacing: .2, borderRadius: 6, padding: "2px 7px", whiteSpace: "nowrap", color: solid ? "#0b0c10" : c, background: solid ? c : `color-mix(in srgb, ${c} 14%, transparent)` }}>{children}</span>
);
// Control segmentado (opciones excluyentes), igual en móvil y ordenador
export function Seg({ opciones, valor, onChange, full, size = "md" }) {
  const pad = size === "sm" ? "7px 10px" : "10px 12px";
  return (
    <div style={{ display: full ? "flex" : "inline-flex", gap: 4, padding: 4, borderRadius: 12, background: "var(--surface2)", border: "1px solid var(--line)", maxWidth: "100%", overflowX: "auto" }}>
      {opciones.map(o => { const on = o.k === valor; return (
        <button key={o.k} type="button" onClick={() => onChange(o.k)} style={{ flex: full ? 1 : "none", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: pad, borderRadius: 9, border: "none", cursor: "pointer", fontWeight: 800, fontSize: size === "sm" ? 12.5 : 13.5, whiteSpace: "nowrap", background: on ? (o.c || "var(--accent)") : "transparent", color: on ? (o.ink || "#fff") : "var(--muted)", transition: "background .12s" }}>
          {o.i && <Icon n={o.i} s={15} />}{o.t}
        </button>); })}
    </div>
  );
}
// Cabecera de bloque: icono + título + (opcional) texto pequeño y acción a la derecha
export const Head = ({ i, t, sub, right, c }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      {i && <Tile n={i} c={c} s={32} />}
      <div style={{ minWidth: 0 }}><div style={{ fontWeight: 900, fontSize: 15.5 }}>{t}</div>{sub && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 1 }}>{sub}</div>}</div>
    </div>
    {right}
  </div>
);
// Hoja/modal con pie fijo (el botón de guardar siempre a mano en el móvil)
export function Sheet({ title, onClose, children, footer }) {
  const isMobile = useIsMobile();
  return (
    <div style={C.modalWrap} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 540, background: "var(--surface)", border: "1px solid var(--line)", display: "flex", flexDirection: "column", boxSizing: "border-box",
        ...(isMobile ? { borderRadius: "22px 22px 0 0", maxHeight: "94dvh", alignSelf: "flex-end" } : { borderRadius: 22, maxHeight: "90dvh", alignSelf: "center" }) }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "16px 18px 12px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ fontWeight: 900, fontSize: 18, minWidth: 0 }}>{title}</div>
          <button onClick={onClose} aria-label="Cerrar" style={{ width: 34, height: 34, borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", display: "grid", placeItems: "center", cursor: "pointer", flexShrink: 0 }}><Icon n="x" s={16} /></button>
        </div>
        <div style={{ overflowY: "auto", padding: "16px 18px", flex: 1, WebkitOverflowScrolling: "touch" }}>{children}</div>
        {footer && <div style={{ padding: "12px 18px", paddingBottom: "calc(12px + env(safe-area-inset-bottom))", borderTop: "1px solid var(--line)", background: "var(--surface)", borderRadius: isMobile ? 0 : "0 0 22px 22px" }}>{footer}</div>}
      </div>
    </div>
  );
}
export const Field = ({ l, children, mb = 16 }) => <div style={{ marginBottom: mb }}><div style={C.label}>{l}</div>{children}</div>;
// Rejilla de opciones con icono (categorías): se toca y se ve claro cuál está elegida
export function IconGrid({ items, valor, onChange, cols }) {
  const isMobile = useIsMobile();
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols || (isMobile ? 3 : 4)}, minmax(0,1fr))`, gap: 8 }}>
      {items.map(it => { const on = it.k === valor; return (
        <button key={it.k} type="button" onClick={() => onChange(it.k)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "10px 6px", borderRadius: 12, cursor: "pointer", minWidth: 0,
          border: `2px solid ${on ? (it.c || "var(--accent)") : "var(--line)"}`, background: on ? `color-mix(in srgb, ${it.c || "var(--accent)"} 12%, var(--surface2))` : "var(--surface2)", color: "var(--text)" }}>
          <Tile n={it.i} c={it.c} s={34} />
          <span style={{ fontSize: 12, fontWeight: 800, lineHeight: 1.15, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", width: "100%" }}>{it.t || it.k}</span>
        </button>); })}
    </div>
  );
}
// Campo de importe grande con "€"
export const MoneyInput = ({ value, onChange, big, autoFocus, color, placeholder = "0,00" }) => (
  <div style={{ position: "relative" }}>
    <input autoFocus={autoFocus} inputMode="decimal" value={value} onChange={e => onChange(e.target.value.replace(/[^\d.,]/g, "").slice(0, 12))} placeholder={placeholder}
      style={{ ...C.input, fontSize: big ? 30 : 18, fontWeight: 900, textAlign: big ? "center" : "right", padding: big ? "12px 44px" : "11px 36px 11px 12px", color: color || "var(--text)" }} />
    <span style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", fontSize: big ? 22 : 16, fontWeight: 900, color: "var(--muted)" }}>€</span>
  </div>
);

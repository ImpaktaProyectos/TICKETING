// Utilidades y estilos compartidos del CRM
import React, { useEffect, useState } from "react";

export const money = (v) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(v || 0);
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

/* ===================== ESTILOS DEL CRM ===================== */
export const C = {
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "linear-gradient(90deg,#ff5a3c,#ff7a3c)", color: "#fff", flexShrink: 0, paddingTop: "max(10px, env(safe-area-inset-top))" },
  crmPill: { background: "#fff", color: "#ff5a3c", fontWeight: 900, letterSpacing: 2, fontSize: 13, borderRadius: 8, padding: "4px 10px" },
  headSelect: { flex: 1, minWidth: 0, background: "rgba(0,0,0,.18)", color: "#fff", border: "1px solid rgba(255,255,255,.35)", borderRadius: 10, padding: "9px 10px", fontWeight: 800, outline: "none" },
  backBtn: { flexShrink: 0, background: "#fff", color: "#1a1205", border: "none", borderRadius: 10, padding: "9px 14px", fontWeight: 900, fontSize: 14, cursor: "pointer" },
  tabs: { display: "flex", gap: 4, background: "var(--surface)", borderBottom: "1px solid var(--line)", flexShrink: 0, overflowX: "auto" },
  tab: { background: "transparent", border: "none", borderBottom: "3px solid transparent", color: "var(--muted)", padding: "13px 14px 11px", fontWeight: 800, fontSize: 15, cursor: "pointer", whiteSpace: "nowrap" },
  tabOn: { color: "var(--text)", borderBottomColor: "var(--accent)" },
  hero: { background: "radial-gradient(120% 140% at 0% 0%, rgba(255,90,60,.22), transparent 60%), var(--surface)", border: "1px solid var(--line)", borderRadius: 18 },
  label: { fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1.2, fontWeight: 800, marginBottom: 6 },
  tag: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 700, border: "1px solid var(--line)", borderRadius: 20, padding: "4px 10px", background: "var(--surface2)" },
  card: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: 14, minWidth: 0 },
  panel: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 16 },
  row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 0", borderTop: "1px solid var(--line)" },
  ingRow: { display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "11px 8px", borderTop: "1px solid var(--line)", background: "transparent", border: "none", borderTopStyle: "solid", borderTopWidth: 1, borderTopColor: "var(--line)", color: "var(--text)", cursor: "pointer", borderRadius: 0 },
  live: { fontSize: 11, color: "var(--green)", fontWeight: 800, marginLeft: 6 },
  seg: { display: "inline-flex", alignItems: "center", gap: 6, background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 20, padding: "7px 12px", fontWeight: 700, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" },
  segOn: { background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" },
  primary: { background: "var(--accent)", color: "#fff", border: "none", borderRadius: 12, padding: "12px 18px", fontWeight: 900, fontSize: 15, cursor: "pointer" },
  ghost: { background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 12, padding: "11px 16px", fontWeight: 700, cursor: "pointer" },
  small: { background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px", fontSize: 12.5, fontWeight: 800, cursor: "pointer" },
  input: { width: "100%", boxSizing: "border-box", background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "11px 13px", fontSize: 15, outline: "none" },
  empty: { textAlign: "center", padding: "22px 12px", color: "var(--muted)", border: "2px dashed var(--line)", borderRadius: 14, fontSize: 13.5 },
  modalWrap: { position: "fixed", inset: 0, zIndex: 90, background: "rgba(0,0,0,.72)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" },
  modal: { width: "100%", maxWidth: 520, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 22, padding: 20, paddingBottom: "calc(20px + env(safe-area-inset-bottom))", maxHeight: "92dvh", overflow: "auto", boxSizing: "border-box", alignSelf: "center", margin: "0 auto" },
  toggleRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 14, fontWeight: 700 },
  switch: { width: 44, height: 24, borderRadius: 20, border: "none", position: "relative", cursor: "pointer", flexShrink: 0, padding: 0 },
  knob: { position: "absolute", top: 2, left: 0, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "transform .15s" },
  check: { width: 28, height: 28, borderRadius: 8, border: "2px solid var(--line)", background: "var(--surface2)", color: "#fff", fontWeight: 900, flexShrink: 0, cursor: "pointer" },
  checkOn: { background: "var(--accent)", borderColor: "var(--accent)" },
};

// ===================== MODO ESCAPARATE (sin suscripción) =====================
// Se ven las pantallas reales y se puede navegar por los menús, pero cualquier acción
// (vender, guardar, crear, escribir…) abre la pantalla de suscripción en lugar de hacerse.
// La base de datos bloquea igualmente: esto es solo para que se vea qué incluye TIXFAST.
// Si la cuenta ya paga un plan que no incluye esta función (prop «funcion»), en lugar de la
// suscripción se ofrecen los planes que sí la incluyen, para cambiar de plan en un toque.
// Zonas libres (se pueden tocar): cabeceras, menús y lo marcado con data-libre.
import React, { useState } from "react";
import { Capa } from "./Capa";
import { Suscripcion } from "./Suscripcion";
import { useAcceso, usePlanes, sinSuscripcion, cambiarPlan, eurosTxt, CATALOGO } from "./cuenta";

function MejorarPlan({ funcion, acc, onHecho }) {
  const planes = usePlanes();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const nombre = CATALOGO[funcion]?.corto || "Esta función";
  const con = (planes || []).filter(p => p.id !== acc?.plan_id && !(p.limites?.bloquea || []).includes(funcion));
  const pasar = async (p) => {
    if (busy || !window.confirm(`¿Pasar a ${p.nombre} por ${eurosTxt(p.precio_mes)} al mes? Este mes solo se cobra la diferencia.`)) return;
    setBusy(true); setMsg(null);
    try { await cambiarPlan(p.id); onHecho(); } catch (e) { setMsg(e?.mostrar ? e.message : "No se ha podido cambiar de plan"); setBusy(false); }
  };
  return (<section style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 20, padding: 16, boxSizing: "border-box" }}>
    <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: "var(--accent)" }}>Tu plan: {acc?.plan_nombre}</div>
    <div style={{ fontWeight: 900, fontSize: 19, marginTop: 4 }}>{nombre} no va incluido en tu plan</div>
    <div style={{ color: "var(--muted)", fontSize: 14, marginTop: 6, lineHeight: 1.45 }}>{con.length ? "Cámbiate a un plan que lo incluya. Este mes solo pagas la diferencia." : "Ahora mismo no hay ningún plan a la venta que lo incluya."}</div>
    <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
      {con.map(p => <button key={p.id} disabled={busy} onClick={() => pasar(p)} style={{ minHeight: 52, padding: "8px 14px", borderRadius: 14, border: `1px solid ${p.destacado ? "var(--accent)" : "var(--line)"}`, background: "var(--surface2)", color: "var(--text)", fontWeight: 900, fontSize: 15, cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", textAlign: "left" }}>
        <span>Pasar a {p.nombre}</span><span style={{ color: "var(--accent)", whiteSpace: "nowrap" }}>{eurosTxt(p.precio_mes)}/mes</span></button>)}
    </div>
    {msg && <div role="status" style={{ color: "var(--amber)", fontSize: 13.5, marginTop: 8 }}>{msg}</div>}
  </section>);
}

const ACCION = "button, a, input, select, textarea, label, summary, [role=button], [role=switch], [role=checkbox], [draggable=true]";
const LIBRE_BASE = "[data-libre], [role=tab], [role=tablist] *";

export function Escaparate({ activo, libre = "", funcion = null, children }) {
  const [ver, setVer] = useState(false);
  const [msg, setMsg] = useState(null);
  const acc = useAcceso();
  const mejorar = !!funcion && !!acc && !sinSuscripcion(acc);   // ya paga, pero su plan no lo incluye
  if (!activo) return children;
  const libreSel = libre ? `${LIBRE_BASE}, ${libre}` : LIBRE_BASE;
  const bloquear = (e) => {
    const t = e.target instanceof Element ? e.target.closest(ACCION) : null;
    if (!t || t.closest(libreSel)) return;
    e.preventDefault(); e.stopPropagation();
    try { document.activeElement?.blur?.(); } catch {}
    setVer(true);
  };
  const alEnfocar = (e) => {
    const t = e.target;
    if (!(t instanceof Element) || !t.matches("input, select, textarea") || t.closest(libreSel)) return;
    t.blur(); setVer(true);
  };
  return (
    <div style={{ display: "contents" }} onClickCapture={bloquear} onFocusCapture={alEnfocar} onKeyDownCapture={(e) => { if (e.key === "Enter") bloquear(e); }} onDragStartCapture={bloquear}>
      {children}
      <Capa>
        <div data-libre role="status" style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: "calc(84px + env(safe-area-inset-bottom))", zIndex: 125, display: "flex", alignItems: "center", gap: 10, maxWidth: "calc(100vw - 24px)", boxSizing: "border-box", padding: "8px 8px 8px 14px", borderRadius: 999, background: "var(--surface)", border: "1px solid var(--accent)", boxShadow: "0 8px 30px rgba(0,0,0,.45)" }}>
          <span style={{ fontSize: 13.5, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{mejorar ? "🔒 No incluido en tu plan" : "👀 Vista previa"}</span>
          <button onClick={() => setVer(true)} style={{ minHeight: 40, padding: "0 14px", borderRadius: 999, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 900, fontSize: 14, cursor: "pointer", whiteSpace: "nowrap" }}>{mejorar ? "Ver planes" : "Suscribirme"}</button>
        </div>
      </Capa>
      {ver && <Capa>
        <div data-libre onClick={() => setVer(false)} style={{ position: "fixed", inset: 0, zIndex: 140, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "end center", overflow: "auto" }}>
          <div role="dialog" aria-modal="true" aria-label="Suscripción" onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 540, maxHeight: "94dvh", overflow: "auto", overscrollBehavior: "contain", padding: "14px 12px calc(14px + env(safe-area-inset-bottom))", boxSizing: "border-box" }}>
            <div style={{ textAlign: "center", color: "#fff", fontWeight: 800, fontSize: 14.5, margin: "0 0 10px" }}>{mejorar ? "Esto es una vista previa." : "Esto es una vista previa. Para usarlo, activa tu suscripción."}</div>
            {mejorar ? <MejorarPlan funcion={funcion} acc={acc} onHecho={() => setVer(false)} /> : <Suscripcion flash={setMsg} compacto />}
            {msg && <div style={{ textAlign: "center", color: "var(--amber)", fontSize: 13.5, marginTop: 8 }}>{msg}</div>}
            <button onClick={() => setVer(false)} style={{ width: "100%", minHeight: 48, marginTop: 10, borderRadius: 14, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontWeight: 800, fontSize: 15, cursor: "pointer" }}>Seguir mirando</button>
          </div>
        </div>
      </Capa>}
    </div>
  );
}

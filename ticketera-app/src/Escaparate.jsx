// ===================== MODO ESCAPARATE (sin suscripción) =====================
// Se ven las pantallas reales y se puede navegar por los menús, pero cualquier acción
// (vender, guardar, crear, escribir…) abre la pantalla de suscripción en lugar de hacerse.
// La base de datos bloquea igualmente: esto es solo para que se vea qué incluye TIXFAST.
// Zonas libres (se pueden tocar): cabeceras, menús y lo marcado con data-libre.
import React, { useState } from "react";
import { Capa } from "./Capa";
import { Suscripcion } from "./Suscripcion";

const ACCION = "button, a, input, select, textarea, label, summary, [role=button], [role=switch], [role=checkbox], [draggable=true]";
const LIBRE_BASE = "[data-libre], [role=tab], [role=tablist] *";

export function Escaparate({ activo, libre = "", children }) {
  const [ver, setVer] = useState(false);
  const [msg, setMsg] = useState(null);
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
          <span style={{ fontSize: 13.5, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>👀 Vista previa</span>
          <button onClick={() => setVer(true)} style={{ minHeight: 40, padding: "0 14px", borderRadius: 999, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 900, fontSize: 14, cursor: "pointer", whiteSpace: "nowrap" }}>Suscribirme</button>
        </div>
      </Capa>
      {ver && <Capa>
        <div data-libre onClick={() => setVer(false)} style={{ position: "fixed", inset: 0, zIndex: 140, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "end center", overflow: "auto" }}>
          <div role="dialog" aria-modal="true" aria-label="Suscripción" onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 540, maxHeight: "94dvh", overflow: "auto", overscrollBehavior: "contain", padding: "14px 12px calc(14px + env(safe-area-inset-bottom))", boxSizing: "border-box" }}>
            <div style={{ textAlign: "center", color: "#fff", fontWeight: 800, fontSize: 14.5, margin: "0 0 10px" }}>Esto es una vista previa. Para usarlo, activa tu suscripción.</div>
            <Suscripcion flash={setMsg} compacto />
            {msg && <div style={{ textAlign: "center", color: "var(--amber)", fontSize: 13.5, marginTop: 8 }}>{msg}</div>}
            <button onClick={() => setVer(false)} style={{ width: "100%", minHeight: 48, marginTop: 10, borderRadius: 14, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontWeight: 800, fontSize: 15, cursor: "pointer" }}>Seguir mirando</button>
          </div>
        </div>
      </Capa>}
    </div>
  );
}

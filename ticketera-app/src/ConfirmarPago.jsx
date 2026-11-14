// ===================== ¿HAS PAGADO ESTE GASTO? =====================
// Al marcar ✓ un gasto se confirma cuánto se ha pagado de verdad: un toque si fue lo previsto,
// o se cambia el importe (p. ej. 220 → 260) y queda guardado como importe real.
// Sirve igual en el CRM (Gastos) y en los atajos rápidos (Pagos del evento).
import React, { useState } from "react";

const money = (v) => (Number(v) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR", useGrouping: "always" });
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const num = (t) => { const v = parseFloat(String(t ?? "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(v) ? r2(v) : NaN; };
export const importeDe = (g) => (g.real != null ? Number(g.real) : g.previsto != null ? Number(g.previsto) : 0);

// g: gasto · nombre: cómo llamarlo («Javi · Camarero») · onConfirmar(importe) · onCerrar
export function ConfirmarPago({ g, nombre, onConfirmar, onCerrar }) {
  const previsto = g.previsto != null ? r2(g.previsto) : null;
  const base = importeDe(g);
  const [txt, setTxt] = useState(base ? String(base).replace(".", ",") : "");
  const [editando, setEditando] = useState(!base);
  const [busy, setBusy] = useState(false);
  const imp = num(txt);
  const valido = Number.isFinite(imp) && imp >= 0 && imp < 100000000;
  const dif = previsto != null && valido ? r2(imp - previsto) : 0;
  const confirmar = async (v) => { if (busy) return; setBusy(true); await onConfirmar(v); setBusy(false); };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 140, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "end center" }} onClick={() => !busy && onCerrar()}>
      <div role="dialog" aria-modal="true" aria-label={`¿Has pagado ${nombre}?`} onClick={e => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 460, background: "var(--surface)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: "22px 22px 0 0", padding: "18px 18px calc(18px + env(safe-area-inset-bottom))", boxSizing: "border-box" }}>
        <div style={{ fontWeight: 900, fontSize: 19 }}>¿Has pagado a {nombre}?</div>
        {previsto != null && <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 4 }}>Previsto: <b style={{ color: "var(--text)" }}>{money(previsto)}</b>{g.real != null && Math.abs(g.real - previsto) >= 0.01 ? <> · real apuntado: <b style={{ color: "var(--text)" }}>{money(g.real)}</b></> : null}</div>}

        {!editando ? (
          <>
            <button onClick={() => confirmar(base)} disabled={busy} style={{ width: "100%", minHeight: 58, marginTop: 16, borderRadius: 16, border: "none", background: "var(--green)", color: "#04231a", fontWeight: 900, fontSize: 18, cursor: "pointer" }}>✓ Sí, {money(base)}</button>
            <button onClick={() => setEditando(true)} disabled={busy} style={{ width: "100%", minHeight: 48, marginTop: 8, borderRadius: 14, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontWeight: 800, fontSize: 15, cursor: "pointer" }}>No, fue otra cantidad</button>
          </>
        ) : (
          <>
            <label style={{ display: "block", fontSize: 12, color: "var(--muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: .8, margin: "16px 0 6px" }} htmlFor="cp-imp">¿Cuánto le has pagado?</label>
            <input id="cp-imp" value={txt} inputMode="decimal" autoFocus onChange={e => setTxt(e.target.value.replace(/[^\d.,]/g, "").slice(0, 10))} onKeyDown={e => e.key === "Enter" && valido && confirmar(imp)}
              style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 14, border: "2px solid var(--green)", background: "var(--surface2)", color: "var(--text)", fontSize: 30, fontWeight: 900, textAlign: "center", font: "inherit" }} />
            {previsto != null && valido && Math.abs(dif) >= 0.01 && <div style={{ fontSize: 13.5, fontWeight: 800, marginTop: 8, color: dif > 0 ? "var(--red)" : "var(--green)", textAlign: "center" }}>{dif > 0 ? `+${money(dif)} más` : `${money(-dif)} menos`} de lo previsto</div>}
            <button onClick={() => confirmar(imp)} disabled={busy || !valido} style={{ width: "100%", minHeight: 58, marginTop: 14, borderRadius: 16, border: "none", background: "var(--green)", color: "#04231a", fontWeight: 900, fontSize: 18, cursor: "pointer", opacity: valido ? 1 : .45 }}>{busy ? "Guardando…" : valido ? `✓ Pagado ${money(imp)}` : "Escribe el importe"}</button>
          </>
        )}
        <button onClick={onCerrar} disabled={busy} style={{ width: "100%", minHeight: 44, marginTop: 8, borderRadius: 14, border: "none", background: "transparent", color: "var(--muted)", fontWeight: 700, fontSize: 14.5, cursor: "pointer" }}>Cancelar</button>
      </div>
    </div>
  );
}

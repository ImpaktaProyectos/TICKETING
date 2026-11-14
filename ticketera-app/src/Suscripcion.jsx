// ===================== ALTA EN LA SUSCRIPCIÓN =====================
// Para usar TPV, CRM y el resto hay que darse de alta en la suscripción mensual con renovación
// automática. La primera vez, los 7 primeros días son gratis (la tarjeta se pide igualmente).
// La ticketera (venta de entradas online) es siempre gratuita.
import React, { useEffect, useState } from "react";
import { cargarCuenta, irAStripe, DIAS_PRUEBA } from "./cuenta";

const euros = (v) => Number(v).toLocaleString("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: Number.isInteger(Number(v)) ? 0 : 2 });
const fechaLarga = (d) => d.toLocaleDateString("es-ES", { day: "numeric", month: "long" });
const INCLUYE = ["TPV con tickets, cierres de caja y cierre de la noche", "CRM: ingresos, gastos, socios y liquidaciones", "Facturación, stock y previsión", "Reservados VIP y conexión con ticketeras"];

export function Suscripcion({ flash, onTicketera, compacto = false }) {
  const [c, setC] = useState(undefined);
  const [acepto, setAcepto] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let vivo = true; cargarCuenta().then(x => vivo && setC(x)).catch(() => vivo && setC(null)); return () => { vivo = false; }; }, []);
  const precio = c?.precio;
  const conPrueba = !c?.ficha?.prueba_usada;
  const finPrueba = new Date(Date.now() + DIAS_PRUEBA * 86400000);
  const ir = async () => {
    if (!acepto || busy) return;
    setBusy(true);
    try { await irAStripe("alta"); } catch (e) { flash?.(e?.mostrar ? e.message : "No se ha podido abrir el pago", "warn"); setBusy(false); }
  };
  return (
    <section style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 20, padding: compacto ? 16 : "22px 18px", boxSizing: "border-box", width: "100%", maxWidth: 520, margin: "0 auto", textAlign: "left" }}>
      <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: "var(--accent)" }}>Suscripción TIXFAST</div>
      <div style={{ fontWeight: 900, fontSize: compacto ? 19 : 22, marginTop: 4, lineHeight: 1.2 }}>{conPrueba ? `Empieza con ${DIAS_PRUEBA} días gratis` : "Reactiva tu suscripción"}</div>
      <div style={{ color: "var(--muted)", fontSize: 14.5, marginTop: 6, lineHeight: 1.45 }}>
        {precio != null ? <>Después, <b style={{ color: "var(--text)" }}>{euros(precio)} al mes</b> con renovación automática. Cancela cuando quieras.</> : c === undefined ? "Cargando…" : "Las suscripciones abren muy pronto."}
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: "14px 0 0", display: "grid", gap: 7, fontSize: 14.5 }}>
        {INCLUYE.map(t => <li key={t} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}><span aria-hidden="true" style={{ color: "var(--green)", fontWeight: 900 }}>✓</span><span>{t}</span></li>)}
      </ul>
      {precio != null && <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 16, padding: "12px", borderRadius: 14, border: `1px solid ${acepto ? "var(--accent)" : "var(--line)"}`, background: "var(--surface2)", cursor: "pointer", fontSize: 13.5, lineHeight: 1.45 }}>
        <input type="checkbox" checked={acepto} onChange={e => setAcepto(e.target.checked)} style={{ width: 22, height: 22, marginTop: 1, flexShrink: 0, accentColor: "var(--accent)" }} />
        <span>{conPrueba
          ? <>Acepto la suscripción mensual con <b>renovación automática</b>. Hoy no se cobra nada; si no cancelo antes del <b>{fechaLarga(finPrueba)}</b>, se cobrarán {euros(precio)} ese día y cada mes hasta que cancele.</>
          : <>Acepto la suscripción mensual con <b>renovación automática</b>: se cobrarán {euros(precio)} hoy y cada mes hasta que cancele.</>}</span>
      </label>}
      <button onClick={ir} disabled={!acepto || busy || precio == null} style={{ width: "100%", minHeight: 54, marginTop: 12, borderRadius: 16, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 900, fontSize: 16.5, cursor: "pointer", opacity: acepto && precio != null && !busy ? 1 : .45 }}>
        {busy ? "Abriendo el pago seguro…" : conPrueba ? `Empezar prueba de ${DIAS_PRUEBA} días` : "Suscribirme"}
      </button>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8, textAlign: "center" }}>Pago seguro con Stripe. Puedes cancelar en cualquier momento desde Ajustes › Tu cuenta.</div>
      {onTicketera && <div style={{ borderTop: "1px solid var(--line)", marginTop: 14, paddingTop: 12 }}>
        <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.45 }}>La <b style={{ color: "var(--text)" }}>venta de entradas online</b> es siempre gratuita, sin suscripción.</div>
        <button onClick={onTicketera} style={{ width: "100%", minHeight: 48, marginTop: 8, borderRadius: 14, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontWeight: 800, fontSize: 15, cursor: "pointer" }}>🎟️ Ir a la ticketera (gratis)</button>
      </div>}
    </section>
  );
}

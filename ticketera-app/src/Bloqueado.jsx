// ===================== FUNCIÓN DE PAGO (aviso en lugar de la pantalla) =====================
// Se enseña cuando el plan no incluye una función. No se pierde nada: los datos siguen ahí
// y vuelven a estar disponibles al suscribirse.
import React from "react";
import { FUNCIONES } from "./cuenta";

const CANDADO = <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>;
export const Candado = ({ s = 13 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-label="De pago" style={{ flexShrink: 0, opacity: .75 }}><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>;

export function Bloqueado({ funcion, plan, onVerPlan }) {
  const nombre = FUNCIONES[funcion] || "Esta función";
  return (
    <section style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 18, padding: "26px 20px", textAlign: "center", maxWidth: 520, margin: "18px auto", boxSizing: "border-box" }}>
      <div style={{ width: 56, height: 56, borderRadius: 16, margin: "0 auto 12px", display: "grid", placeItems: "center", color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 12%, transparent)" }}>{CANDADO}</div>
      <div style={{ fontWeight: 900, fontSize: 19 }}>{nombre} es de la suscripción</div>
      <p style={{ color: "var(--muted)", fontSize: 14.5, lineHeight: 1.5, margin: "8px 0 0" }}>
        Con el plan {plan || "Gratis"} puedes seguir vendiendo en el TPV, cerrar cajas y llevar ingresos, gastos, socios y liquidaciones.
        Lo que ya tenías guardado aquí no se borra: vuelve a estar disponible al suscribirte.
      </p>
      {onVerPlan && <button onClick={onVerPlan} style={{ marginTop: 16, minHeight: 48, padding: "0 22px", borderRadius: 14, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 900, fontSize: 15.5, cursor: "pointer" }}>Ver mi plan</button>}
    </section>
  );
}

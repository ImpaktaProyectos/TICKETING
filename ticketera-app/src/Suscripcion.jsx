// ===================== ALTA EN LA SUSCRIPCIÓN =====================
// Para usar TPV, CRM y el resto hay que darse de alta en un plan con renovación automática.
// Los planes (nombre, precio, prueba gratis y lo que incluyen) se crean en el Panel TIXFAST:
// aquí se enseñan los que se pueden contratar y el cliente elige uno.
// La ticketera (venta de entradas online) es siempre gratuita.
import React, { useEffect, useState } from "react";
import { cargarCuenta, cargarOfertas, irAStripe, resumenPlan } from "./cuenta";

const euros = (v) => Number(v).toLocaleString("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: Number.isInteger(Number(v)) ? 0 : 2 });
const fechaLarga = (d) => d.toLocaleDateString("es-ES", { day: "numeric", month: "long" });

export function TarjetaPlan({ p, elegido, onElegir, conPrueba }) {
  const r = resumenPlan(p);
  const dias = Number(p.dias_prueba) || 0;
  return (
    <label style={{ display: "block", position: "relative", padding: "14px 14px 12px", borderRadius: 16, cursor: "pointer", boxSizing: "border-box",
      border: `2px solid ${elegido ? "var(--accent)" : "var(--line)"}`, background: elegido ? "color-mix(in srgb, var(--accent) 7%, var(--surface2))" : "var(--surface2)" }}>
      <input type="radio" name="plan" checked={elegido} onChange={onElegir} style={{ position: "absolute", opacity: 0, pointerEvents: "none" }} />
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 22, flexShrink: 0, marginTop: 2, boxSizing: "border-box", border: `2px solid ${elegido ? "var(--accent)" : "var(--muted)"}`, display: "grid", placeItems: "center" }}>
          {elegido && <span style={{ width: 10, height: 10, borderRadius: 10, background: "var(--accent)" }} />}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "2px 8px" }}>
            <b style={{ fontSize: 17 }}>{p.nombre}</b>
            {p.destacado && <span style={{ fontSize: 11, fontWeight: 900, color: "var(--accent)", border: "1px solid var(--accent)", borderRadius: 999, padding: "1px 8px" }}>Recomendado</span>}
          </div>
          <div style={{ marginTop: 2 }}><b style={{ fontSize: 20 }}>{euros(p.precio_mes)}</b><span style={{ color: "var(--muted)", fontSize: 13.5 }}> al mes{conPrueba && dias > 0 ? ` · ${dias} días gratis` : ""}</span></div>
          {p.descripcion && <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 4, lineHeight: 1.4 }}>{p.descripcion}</div>}
        </div>
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0 32px", display: "grid", gap: 5, fontSize: 13.5 }}>
        {r.incluye.map(t => <li key={t} style={{ display: "flex", gap: 8 }}><span aria-hidden="true" style={{ color: "var(--green)", fontWeight: 900 }}>✓</span><span>{t}</span></li>)}
        {r.limites.map(t => <li key={t} style={{ display: "flex", gap: 8, color: "var(--muted)" }}><span aria-hidden="true" style={{ fontWeight: 900 }}>·</span><span>Hasta {t}</span></li>)}
        {elegido && r.noIncluye.map(t => <li key={t} style={{ display: "flex", gap: 8, color: "var(--muted)", textDecoration: "line-through", opacity: .7 }}><span aria-hidden="true">✕</span><span>{t}</span></li>)}
      </ul>
    </label>
  );
}

export function Suscripcion({ flash, onTicketera, compacto = false, oferta = null }) {
  const [c, setC] = useState(undefined);
  const [acepto, setAcepto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dto, setDto] = useState(null);   // oferta para volver (si la hay y no se ha usado)
  const [elegido, setElegido] = useState(null);
  useEffect(() => { let vivo = true; cargarCuenta().then(x => { if (!vivo) return; setC(x); const ps = x?.planes || []; setElegido((ps.find(p => p.id === x?.ficha?.plan_id) || ps.find(p => p.destacado) || ps[0])?.id || null); }).catch(() => vivo && setC(null));
    if (oferta === "recuperar") cargarOfertas().then(o => vivo && o?.recuperar?.descuento > 0 && setDto(o.recuperar)).catch(() => {});
    return () => { vivo = false; }; }, []);
  const planes = c?.planes || [];
  const plan = planes.find(p => p.id === elegido) || null;
  const precio = plan?.precio_mes != null ? Number(plan.precio_mes) : null;
  const dias = Number(plan?.dias_prueba) || 0;
  const conPrueba = !c?.ficha?.prueba_usada;
  const pruebaHoy = conPrueba && dias > 0;
  const finPrueba = new Date(Date.now() + dias * 86400000);
  const ir = async () => {
    if (!acepto || busy || !plan) return;
    setBusy(true);
    try { await irAStripe("alta", { plan: plan.id, ...(dto ? { oferta: "recuperar" } : {}) }); } catch (e) { flash?.(e?.mostrar ? e.message : "No se ha podido abrir el pago", "warn"); setBusy(false); }
  };
  return (
    <section style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 20, padding: compacto ? 16 : "22px 18px", boxSizing: "border-box", width: "100%", maxWidth: 560, margin: "0 auto", textAlign: "left" }}>
      <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: "var(--accent)" }}>Suscripción TIXFAST</div>
      <div style={{ fontWeight: 900, fontSize: compacto ? 19 : 22, marginTop: 4, lineHeight: 1.2 }}>{pruebaHoy ? `Empieza con ${dias} días gratis` : dto ? `Vuelve con un ${dto.descuento} % de descuento` : "Elige tu plan"}</div>
      <div style={{ color: "var(--muted)", fontSize: 14.5, marginTop: 6, lineHeight: 1.45 }}>
        {c === undefined ? "Cargando…" : planes.length ? (planes.length > 1 ? "Elige el plan que mejor te encaje. Puedes cambiar de plan cuando quieras." : "Renovación automática cada mes. Cancela cuando quieras.") : "Las suscripciones abren muy pronto."}
      </div>
      {planes.length > 0 && <div role="radiogroup" aria-label="Planes" style={{ display: "grid", gap: 10, marginTop: 14 }}>
        {planes.map(p => <TarjetaPlan key={p.id} p={p} elegido={p.id === elegido} conPrueba={conPrueba} onElegir={() => { setElegido(p.id); setAcepto(false); }} />)}
      </div>}
      {plan && precio != null && <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 16, padding: "12px", borderRadius: 14, border: `1px solid ${acepto ? "var(--accent)" : "var(--line)"}`, background: "var(--surface2)", cursor: "pointer", fontSize: 13.5, lineHeight: 1.45 }}>
        <input type="checkbox" checked={acepto} onChange={e => setAcepto(e.target.checked)} style={{ width: 22, height: 22, marginTop: 1, flexShrink: 0, accentColor: "var(--accent)" }} />
        <span>{pruebaHoy
          ? <>Acepto la suscripción mensual a <b>{plan.nombre}</b> con <b>renovación automática</b>. Hoy no se cobra nada; si no cancelo antes del <b>{fechaLarga(finPrueba)}</b>, se cobrarán {euros(precio)} ese día y cada mes hasta que cancele.</>
          : dto ? <>Acepto la suscripción mensual a <b>{plan.nombre}</b> con <b>renovación automática</b>: {dto.meses} {dto.meses === 1 ? "mes" : "meses"} con un {dto.descuento} % de descuento y después {euros(precio)} cada mes hasta que cancele.</>
          : <>Acepto la suscripción mensual a <b>{plan.nombre}</b> con <b>renovación automática</b>: se cobrarán {euros(precio)} hoy y cada mes hasta que cancele.</>}</span>
      </label>}
      <button onClick={ir} disabled={!acepto || busy || !plan} style={{ width: "100%", minHeight: 54, marginTop: 12, borderRadius: 16, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 900, fontSize: 16.5, cursor: "pointer", opacity: acepto && plan && !busy ? 1 : .45 }}>
        {busy ? "Abriendo el pago seguro…" : pruebaHoy ? `Empezar prueba de ${dias} días` : plan ? `Suscribirme a ${plan.nombre}` : "Suscribirme"}
      </button>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8, textAlign: "center" }}>Pago seguro con Stripe. Puedes cancelar en cualquier momento desde Ajustes › Tu cuenta.</div>
      {onTicketera && <div style={{ borderTop: "1px solid var(--line)", marginTop: 14, paddingTop: 12 }}>
        <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.45 }}>La <b style={{ color: "var(--text)" }}>venta de entradas online</b> es siempre gratuita, sin suscripción.</div>
        <button onClick={onTicketera} style={{ width: "100%", minHeight: 48, marginTop: 8, borderRadius: 14, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontWeight: 800, fontSize: 15, cursor: "pointer" }}>🎟️ Ir a la ticketera (gratis)</button>
      </div>}
    </section>
  );
}

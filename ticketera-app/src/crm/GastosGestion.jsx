// ===================== CRM · GASTOS DE GESTIÓN DEL EVENTO =====================
// El organizador elige cuánto paga el comprador de gastos de gestión. TIXFAST siempre se queda su comisión pactada;
// si los gastos son menores, el organizador asume la diferencia; si son mayores, se la queda.
import React, { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { money, C, Icon, Field } from "./ui";
import { reparto, TARIFA_DEF } from "../comision.js";

const OPCIONES = [
  ["recomendado", "Recomendado", "El comprador paga la comisión: tú cobras el 100 % de cada entrada."],
  ["por_entrada", "Elegir importe", "Pones tú los gastos por entrada. Si es menos, asumes la diferencia; si es más, te la quedas."],
  ["ninguno", "Sin gastos", "El comprador no paga gastos. La comisión se descuenta de lo que cobras."],
];
const limpio = (v) => String(v ?? "").replace(/[^\d,.]/g, "").replace(",", ".");

export function GastosGestion({ f, tramos = [], setFicha, isMobile }) {
  const [tarifa, setTarifa] = useState(null);
  const [importe, setImporte] = useState(f.gastos_entrada != null ? String(f.gastos_entrada).replace(".", ",") : "");
  useEffect(() => { let vivo = true; supabase.rpc("mi_tarifa_plataforma").then(({ data }) => { if (vivo) setTarifa(data || TARIFA_DEF); }, () => vivo && setTarifa(TARIFA_DEF)); return () => { vivo = false; }; }, []);
  const modo = f.gastos_modo || "recomendado";
  const T = tarifa || TARIFA_DEF;
  // Ejemplo con el precio más alto de los tramos de pago (o 20 € si aún no hay)
  const precio = Math.max(0, ...tramos.map(t => Number(t.precio) || 0)) || 20;
  const r = reparto(precio, 1, { modo, por_entrada: Number(limpio(importe)) || 0, ...T }, T);
  const guardarImporte = (v) => { setImporte(v); const n = Number(limpio(v)); if (Number.isFinite(n) && n >= 0 && n <= 100) setFicha({ gastos_entrada: Math.round(n * 100) / 100 }); };

  return (
    <div>
      <div role="radiogroup" aria-label="Gastos de gestión" style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 8 }}>
        {OPCIONES.map(([k, t, s]) => {
          const on = modo === k;
          return (
            <button key={k} role="radio" aria-checked={on} onClick={() => setFicha({ gastos_modo: k, ...(k === "por_entrada" && f.gastos_entrada == null ? { gastos_entrada: r.comision } : {}) })}
              style={{ textAlign: "left", padding: 12, borderRadius: 14, cursor: "pointer", color: "var(--text)", minHeight: 44, background: on ? "rgba(255,90,60,.08)" : "var(--surface2)", border: `2px solid ${on ? "var(--accent)" : "var(--line)"}` }}>
              <span style={{ display: "block", fontWeight: 700, fontSize: 15 }}>{t}</span>
              <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)", marginTop: 4, lineHeight: 1.4 }}>{s}</span>
            </button>);
        })}
      </div>
      {modo === "por_entrada" && <div style={{ marginTop: 12 }}><Field l="Gastos por entrada (IVA incluido)" mb={0}>
        <div style={{ position: "relative", maxWidth: 220 }}>
          <input inputMode="decimal" value={importe} placeholder={String(r.comision).replace(".", ",")} onChange={e => guardarImporte(e.target.value)} style={{ ...C.input, paddingRight: 36 }} />
          <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontWeight: 700 }}>€</span>
        </div>
      </Field></div>}
      <div style={{ marginTop: 14, padding: 12, borderRadius: 12, background: "var(--surface2)", border: "1px solid var(--line)", fontSize: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Con una entrada de {money(precio)}</div>
        {[["El comprador paga", r.comprador], ["Tú recibes", r.organizador], [`Comisión TIXFAST (${String(T.pct).replace(".", ",")} %, mín. ${money(T.min)}, IVA incl.)`, r.comision]].map(([t, v], i) => (
          <div key={t} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "3px 0", color: i === 1 ? "var(--text)" : "var(--muted)", fontWeight: i === 1 ? 800 : 600 }}>
            <span style={{ minWidth: 0 }}>{t}</span><span style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{money(v)}</span>
          </div>))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45 }}>
        <Icon n="file" s={15} c="var(--muted)" />
        <span>Al acabar el evento recibirás la factura de la comisión en <b style={{ color: "var(--text)" }}>Facturación › Gastos</b>, lista para tu contabilidad. Para que te llegue, rellena una vez tus datos fiscales en Facturación › Datos fiscales.</span>
      </div>
    </div>
  );
}

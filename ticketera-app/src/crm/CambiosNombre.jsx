// ===================== CRM · CAMBIOS DE NOMBRE DE LAS ENTRADAS =====================
// Las entradas no se devuelven; el comprador puede pasarlas a otra persona en /cambio pagando lo que pongas aquí.
// La entrada nueva lleva un QR nuevo y la anterior deja de valer. El dinero del cambio te llega en el reparto.
import React, { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { money, C, Field } from "./ui";

const limpio = (v) => String(v ?? "").replace(/[^\d,.]/g, "").replace(",", ".");
const urlCambio = () => `${window.location.origin}/cambio`;

export function CambiosNombre({ ev, f, setFicha, flash, isMobile }) {
  const [precio, setPrecio] = useState(String(f.cambio_precio ?? 0).replace(".", ","));
  const [lista, setLista] = useState(null);
  const permitido = f.cambio_nombre !== false;
  useEffect(() => { let vivo = true; supabase.rpc("web_cambios_evento", { p_evento: ev.id }).then(({ data }) => vivo && setLista(data || []), () => vivo && setLista([])); return () => { vivo = false; }; }, [ev.id]);
  const guardarPrecio = (v) => { setPrecio(v); const n = Number(limpio(v)); if (Number.isFinite(n) && n >= 0 && n <= 500) setFicha({ cambio_precio: Math.round(n * 100) / 100 }); };
  const copiar = async () => { try { await navigator.clipboard.writeText(urlCambio()); flash("Enlace copiado"); } catch { flash(urlCambio()); } };
  const hechos = (lista || []).filter(c => c.estado === "hecho");
  return (
    <div>
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", minHeight: 44, fontSize: 14.5 }}>
        <input type="checkbox" checked={permitido} onChange={e => setFicha({ cambio_nombre: e.target.checked })} style={{ width: 22, height: 22, accentColor: "var(--accent)", flexShrink: 0, marginTop: 1 }} />
        <span><b>Permitir cambios de nombre</b><br /><span style={{ color: "var(--muted)" }}>Las entradas no se devuelven. Con esto, quien no pueda ir se la pasa a otra persona: le llega una entrada nueva y la anterior deja de valer.</span></span>
      </label>
      {permitido && <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginTop: 12 }}>
        <Field l="Precio del cambio (0 = gratis)" mb={0}>
          <div style={{ position: "relative" }}>
            <input inputMode="decimal" value={precio} onChange={e => guardarPrecio(e.target.value)} style={{ ...C.input, paddingRight: 36 }} />
            <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontWeight: 700 }}>€</span>
          </div>
        </Field>
        <Field l="Se puede cambiar hasta" mb={0}>
          <select value={f.cambio_hasta_horas ?? 0} onChange={e => setFicha({ cambio_hasta_horas: Number(e.target.value) })} style={C.input}>
            {[[0, "El inicio del evento"], [2, "2 horas antes"], [6, "6 horas antes"], [12, "12 horas antes"], [24, "1 día antes"], [48, "2 días antes"], [72, "3 días antes"]].map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </Field>
      </div>}
      {permitido && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10, lineHeight: 1.45 }}>
        El cambio se paga con tarjeta: te llega en el reparto con la comisión de TIXFAST, como una venta. Si pones precio, necesitas tener activado el cobro online.
        {" "}Enlace para tus clientes: <button onClick={copiar} style={{ ...C.btnSm, minHeight: 36 }}>Copiar enlace</button>
      </div>}
      {hechos.length > 0 && <div style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Cambios hechos ({hechos.length})</div>
        {hechos.slice(0, 30).map(c => (
          <div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 0", borderTop: "1px solid var(--line)", fontSize: 13.5 }}>
            <span style={{ minWidth: 0 }}>Nº {c.numero}{c.tramo ? ` · ${c.tramo}` : ""} · {c.anterior} → <b>{c.nuevo}</b></span>
            <span style={{ flexShrink: 0, color: "var(--muted)" }}>{Number(c.precio) > 0 ? money(c.precio) : "Gratis"}</span>
          </div>))}
      </div>}
      {(lista || []).some(c => c.estado === "fallido") && <div style={{ marginTop: 10, fontSize: 13, color: "var(--amber)" }}>Hay cambios pagados que no se pudieron completar (la entrada se usó o cambió entre medias). Revísalos con el comprador.</div>}
    </div>
  );
}

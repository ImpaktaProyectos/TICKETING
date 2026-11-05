import React, { useEffect, useMemo, useState } from "react";
import { cargarInformeQR, duplicadosSinConexion } from "./qrdb";

/* ============================================================================
   INFORME DE TICKETS CON QR
   Vendidos con QR · canjeados · sin canjear (por barra) + intentos rechazados (copias, falsos…)
   ========================================================================== */
const MOTIVOS = {
  ya_canjeado: { t: "Copias (ya canjeado)", c: "var(--red)" },
  falso: { t: "Falsos o manipulados", c: "var(--red)" },
  otro_evento: { t: "De otro evento", c: "var(--amber)" },
  anulado: { t: "Tickets anulados", c: "var(--amber)" },
  caducado: { t: "Caducados (barra con Z)", c: "var(--amber)" },
  ilegible: { t: "Códigos ilegibles", c: "var(--muted)" },
};
const hora = (t) => { try { return new Date(t).toLocaleString("es-ES", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }); } catch { return ""; } };

// Unidades con QR vendidas por barra (desde que se activó el QR). Los bonos cuentan cada vale.
export function vendidosConQR(ev, evSales) {
  const prods = new Map(); (ev.puntos || []).forEach(p => (p.products || []).forEach(x => prods.set(x.id, x)));
  const conQR = (id) => { const x = prods.get(id); return !!(x && x.qr !== false && x.print !== false); };
  const desde = Number(ev.style?.qrDesde) || 0;
  const out = {};
  (evSales || []).forEach(s => {
    if (s.voided || s.ts < desde) return;
    if (s.productId) { if (conQR(s.productId)) out[s.puntoId] = (out[s.puntoId] || 0) + 1; return; }
    const pt = (ev.puntos || []).find(p => p.id === s.puntoId);
    const c = (pt?.combos || []).find(c => c.name === s.name);
    (c?.items || []).forEach(it => { if (conQR(it.productId)) out[s.puntoId] = (out[s.puntoId] || 0) + (it.qty || 1); });
  });
  return out;
}

export default function InformeQR({ ev, evSales }) {
  const [datos, setDatos] = useState(null);
  const [err, setErr] = useState(false);
  const [verTodo, setVerTodo] = useState(false);
  const cargar = async () => { try { setDatos(await cargarInformeQR(ev.id)); setErr(false); } catch { setErr(true); } };
  useEffect(() => { setDatos(null); cargar(); const t = setInterval(cargar, 30000); return () => clearInterval(t); }, [ev.id]);

  const vend = useMemo(() => vendidosConQR(ev, evSales), [ev, evSales]);
  const r = useMemo(() => {
    if (!datos) return null;
    const porVenta = {}, porServido = {};
    let canj = 0, pend = 0, sinCon = 0;
    datos.canjes.forEach(c => {
      const u = c.unidades || 1; canj += u;
      if (c.punto_venta_id) porVenta[c.punto_venta_id] = (porVenta[c.punto_venta_id] || 0) + u; else pend += u;
      if (c.punto_id) porServido[c.punto_id] = (porServido[c.punto_id] || 0) + u;
      if (c.sin_conexion) sinCon += u;
    });
    const mot = {}; let dupOff = 0;
    datos.rechazos.forEach(x => { mot[x.motivo] = (mot[x.motivo] || 0) + 1; if (x.sin_conexion && x.motivo === "ya_canjeado") dupOff++; });
    const vendidos = Object.values(vend).reduce((t, n) => t + n, 0);
    return { porVenta, porServido, canj, pend, sinCon, mot, dupOff, vendidos, rech: datos.rechazos.length };
  }, [datos, vend]);
  const dupLocal = duplicadosSinConexion(ev.id).length;
  const nombre = (id) => (ev.puntos.find(p => p.id === id) || {}).name || "—";

  const tile = (label, val, c, sub) => (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 12, padding: "12px 14px", minWidth: 0 }}>
      <div style={{ fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: .6, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: c || "var(--text)", lineHeight: 1.15, marginTop: 2 }}>{val}</div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 18, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <div style={{ fontWeight: 800, flex: 1 }}>🔐 Tickets con QR</div>
        <button onClick={cargar} style={{ background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>↻ Actualizar</button>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>Lo vendido con QR frente a lo que ya se ha servido en barra. Cada ticket solo se canjea una vez.</div>
      {err && !datos && <div style={{ fontSize: 13, color: "var(--amber)" }}>Sin conexión: no se pueden ver los canjes ahora.</div>}
      {!err && !datos && <div style={{ fontSize: 13, color: "var(--muted)" }}>Cargando…</div>}
      {r && (<>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 10, marginBottom: 14 }}>
          {tile("Vendidos con QR", r.vendidos)}
          {tile("Servidos", r.canj, "var(--green)", r.sinCon ? `${r.sinCon} sin conexión` : null)}
          {tile("Sin canjear", Math.max(0, r.vendidos - r.canj), "var(--amber)", "Tickets aún en manos del público")}
          {tile("Rechazados", r.rech, r.rech ? "var(--red)" : "var(--text)", r.mot.ya_canjeado ? `${r.mot.ya_canjeado} copias` : "Ningún intento")}
        </div>

        <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 6 }}>Por barra</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ color: "var(--muted)", textAlign: "right" }}>
              <th style={{ textAlign: "left", padding: "6px 4px", fontWeight: 700 }}>Barra</th>
              <th style={{ padding: "6px 4px", fontWeight: 700 }}>Vendidos</th>
              <th style={{ padding: "6px 4px", fontWeight: 700 }}>Servidos</th>
              <th style={{ padding: "6px 4px", fontWeight: 700 }}>Pendientes</th>
              <th style={{ padding: "6px 4px", fontWeight: 700 }}>Aquí</th>
            </tr></thead>
            <tbody>
              {ev.puntos.filter(p => !p.archivado || vend[p.id] || r.porServido[p.id]).map(p => {
                const v = vend[p.id] || 0, c = r.porVenta[p.id] || 0;
                return (
                  <tr key={p.id} style={{ borderTop: "1px solid var(--line)", textAlign: "right" }}>
                    <td style={{ textAlign: "left", padding: "8px 4px", fontWeight: 700, whiteSpace: "nowrap" }}>📍 {p.name}</td>
                    <td style={{ padding: "8px 4px" }}>{v}</td>
                    <td style={{ padding: "8px 4px", color: "var(--green)", fontWeight: 700 }}>{c}</td>
                    <td style={{ padding: "8px 4px", color: v - c > 0 ? "var(--amber)" : "var(--muted)" }}>{Math.max(0, v - c)}</td>
                    <td style={{ padding: "8px 4px" }}>{r.porServido[p.id] || 0}</td>
                  </tr>
                );
              })}
              {r.pend > 0 && <tr style={{ borderTop: "1px solid var(--line)", textAlign: "right", color: "var(--muted)" }}>
                <td style={{ textAlign: "left", padding: "8px 4px" }}>Venta aún sin subir</td><td /><td style={{ padding: "8px 4px" }}>{r.pend}</td><td /><td />
              </tr>}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>«Servidos» y «Pendientes» son de los tickets vendidos en esa barra (se sirvan donde se sirvan). «Aquí» es lo que validó el móvil de esa barra.</div>

        {r.rech > 0 && (<>
          <div style={{ fontSize: 12.5, fontWeight: 800, margin: "14px 0 6px" }}>Intentos rechazados</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {Object.entries(r.mot).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
              <span key={k} style={{ fontSize: 12.5, fontWeight: 700, padding: "6px 10px", borderRadius: 20, border: "1px solid var(--line)", background: "var(--surface2)" }}>
                <span style={{ color: (MOTIVOS[k] || {}).c || "var(--muted)" }}>●</span> {(MOTIVOS[k] || { t: k }).t}: {n}
              </span>
            ))}
          </div>
          {(r.dupOff > 0 || dupLocal > 0) && <div style={{ fontSize: 12.5, color: "var(--amber)", marginBottom: 8 }}>⚠️ {(() => { const n = Math.max(r.dupOff, dupLocal); return n === 1 ? "1 copia se sirvió" : `${n} copias se sirvieron`; })()} mientras un móvil estaba sin conexión (se detectó al volver la red).</div>}
          {(verTodo ? datos.rechazos : datos.rechazos.slice(0, 8)).map((x, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "7px 0", borderTop: "1px solid var(--line)", fontSize: 12.5 }}>
              <span style={{ color: (MOTIVOS[x.motivo] || {}).c || "var(--muted)", fontWeight: 800, minWidth: 0, flex: 1 }}>{(MOTIVOS[x.motivo] || { t: x.motivo }).t}{x.detalle?.nombre ? ` · ${x.detalle.nombre}` : ""}{x.sin_conexion ? " · sin conexión" : ""}</span>
              <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{nombre(x.punto_id)} · {hora(x.creado_en)}</span>
            </div>
          ))}
          {datos.rechazos.length > 8 && <button onClick={() => setVerTodo(!verTodo)} style={{ background: "none", border: 0, color: "var(--accent)", fontWeight: 700, fontSize: 12.5, padding: "8px 0", cursor: "pointer" }}>{verTodo ? "Ver menos" : `Ver los ${datos.rechazos.length}`}</button>}
        </>)}
      </>)}
    </div>
  );
}

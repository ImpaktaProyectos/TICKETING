// ===================== MULTIPUESTO · INFORME Y LIQUIDACIÓN (organizador) =====================
// Por consumición: vendidas en las cajas, canjeadas y pendientes. Por puesto: unidades entregadas,
// valor (precio de venta), comisión del organizador y lo que hay que pagarle. Registro de cada puesto
// con la hora exacta de cada canje y de cada rechazo. Se actualiza solo cada 20 segundos.
import React, { useEffect, useMemo, useState } from "react";
import { Capa } from "../Capa";
import { supabase } from "../supabase";
import { vendidasPorConsumicion, consumicionesDelEvento, liquidacionPorPuesto, csv } from "./modelo";

const eur = (n) => (Number(n) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
const horaExacta = (iso) => { try { return new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }); } catch { return ""; } };
const MOTIVO = { no_aqui: "No válido aquí", ya_canjeado: "Ya canjeado (copia)", falso: "Falso o de otro evento", anulado: "Anulado en caja", caducado: "Evento terminado", ilegible: "No es un ticket", prueba: "Ticket de prueba" };
const K = {
  panel: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 14, boxSizing: "border-box", minWidth: 0 },
  btn: { minHeight: 44, padding: "0 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontWeight: 800, fontSize: 14, cursor: "pointer" },
  tile: { background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 14, padding: 12, minWidth: 0 },
  th: { textAlign: "right", fontSize: 11.5, color: "var(--muted)", fontWeight: 800, padding: "6px 4px", whiteSpace: "nowrap" },
  td: { textAlign: "right", fontSize: 13.5, padding: "8px 4px", borderTop: "1px solid var(--line)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
};
function descargar(nombre, texto) {
  const url = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const archivo = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40) || "evento";

export default function InformePuestos({ ev, evSales }) {
  const [puestos, setPuestos] = useState(null);
  const [liq, setLiq] = useState(null);
  const [err, setErr] = useState(false);
  const [abierto, setAbierto] = useState(null);
  const [registro, setRegistro] = useState(null);   // puesto
  const cargar = async () => {
    try {
      const [p, l] = await Promise.all([supabase.rpc("puestos_evento", { p_evento: ev.id }), supabase.rpc("puestos_liquidacion", { p_evento: ev.id })]);
      if (p.error || l.error) throw p.error || l.error;
      setPuestos(p.data || []); setLiq(l.data || { filas: [], canjeadas: {} }); setErr(false);
    } catch { setErr(true); }
  };
  useEffect(() => { setPuestos(null); setLiq(null); cargar(); const t = setInterval(() => { if (document.visibilityState === "visible") cargar(); }, 20000); return () => clearInterval(t); }, [ev.id]);

  const consumiciones = useMemo(() => consumicionesDelEvento(ev), [ev]);
  const vendidas = useMemo(() => vendidasPorConsumicion(ev, evSales), [ev, evSales]);
  const porPuesto = useMemo(() => liquidacionPorPuesto(liq?.filas, puestos || []), [liq, puestos]);
  if (err && !liq) return <div style={{ ...K.panel, color: "var(--red)", marginTop: 14 }}>No se ha podido cargar el informe de puestos. Revisa la conexión.</div>;
  if (!liq || !puestos) return <div style={{ ...K.panel, color: "var(--muted)", marginTop: 14 }}>Cargando puestos…</div>;

  const claves = [...new Set([...consumiciones.map(c => c.clave), ...Object.keys(vendidas), ...Object.keys(liq.canjeadas || {})])];
  const nombre = (k) => consumiciones.find(c => c.clave === k)?.nombre || (liq.filas || []).find(f => f.consumicion === k)?.nombre || k;
  const filasProd = claves.map(k => { const v = vendidas[k] || 0, c = liq.canjeadas?.[k] || 0; return { k, nombre: nombre(k), vendidas: v, canjeadas: c, pendientes: Math.max(0, v - c) }; })
    .filter(f => f.vendidas || f.canjeadas).sort((a, b) => b.vendidas - a.vendidas);
  const tot = porPuesto.reduce((a, g) => ({ unidades: a.unidades + g.unidades, valor: a.valor + g.valor, comision: a.comision + g.comision, neto: a.neto + g.neto }), { unidades: 0, valor: 0, comision: 0, neto: 0 });
  const totVend = filasProd.reduce((a, f) => a + f.vendidas, 0), totPend = filasProd.reduce((a, f) => a + f.pendientes, 0);

  const exportar = () => descargar(`liquidacion-puestos-${archivo(ev.name)}.csv`, csv([
    ["Evento", ev.name], [],
    ["Puesto", "Producto", "Unidades", "Valor de venta (€)", "Comisión organizador (€)", "A pagar al puesto (€)", "Primer canje", "Último canje"],
    ...porPuesto.flatMap(g => g.lineas.map(l => [g.puesto.nombre, l.nombre, l.unidades, Number(l.valor), Number(l.comision), Number(l.neto), horaExacta(l.primero), horaExacta(l.ultimo)])),
    [], ["TOTAL", "", tot.unidades, round(tot.valor), round(tot.comision), round(tot.neto)],
  ]));

  return (<div style={{ display: "grid", gap: 12, marginTop: 14 }}>
    <div style={{ ...K.panel, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <b style={{ fontSize: 17, flex: 1 }}>Puestos · liquidación</b>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Se actualiza sola</span>
        <button onClick={exportar} disabled={!porPuesto.some(g => g.unidades)} style={K.btn}>Descargar Excel (CSV)</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
        {[["Vendidas", totVend, "en tus cajas"], ["Entregadas en puestos", tot.unidades, `${totPend} pendientes de canjear`], ["Valor entregado", eur(tot.valor), "a precio de venta"],
          ["Tu comisión", eur(tot.comision), "lo que se queda la organización", "var(--green)"], ["A pagar a puestos", eur(tot.neto), (n => `${n} ${n === 1 ? "puesto" : "puestos"}`)(porPuesto.filter(g => g.unidades).length), "var(--accent)"]].map(([t, v, s, c]) =>
          <div key={t} style={K.tile}><div style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: .5 }}>{t}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: c || "var(--text)", marginTop: 2 }}>{v}</div><div style={{ fontSize: 12, color: "var(--muted)" }}>{s}</div></div>)}
      </div>
    </div>

    <div style={K.panel}>
      <b>Por producto</b>
      <div data-scroll style={{ overflowX: "auto", marginTop: 6 }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr><th style={{ ...K.th, textAlign: "left" }}>Producto</th><th style={K.th}>Vendidas</th><th style={K.th}>Canjeadas</th><th style={K.th}>Faltan</th></tr></thead>
          <tbody>{filasProd.map(f => <tr key={f.k}><td style={{ ...K.td, textAlign: "left", fontWeight: 800, whiteSpace: "normal" }}>{f.nombre}</td><td style={K.td}>{f.vendidas}</td><td style={K.td}>{f.canjeadas}</td><td style={{ ...K.td, color: f.pendientes ? "var(--amber)" : "var(--muted)" }}>{f.pendientes}</td></tr>)}
            {!filasProd.length && <tr><td colSpan={4} style={{ ...K.td, textAlign: "left", color: "var(--muted)" }}>Aún no hay ventas.</td></tr>}</tbody>
        </table>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Canjeadas incluye lo que hayan escaneado tus barras con el validador normal.</div>
    </div>

    {porPuesto.map(g => { const p = g.puesto; const ab = abierto === p.id; return (
      <div key={p.id} style={{ ...K.panel, borderLeft: `5px solid ${p.color || "var(--line)"}` }}>
        <button onClick={() => setAbierto(ab ? null : p.id)} aria-expanded={ab} style={{ display: "flex", width: "100%", gap: 10, alignItems: "center", background: "transparent", border: 0, color: "var(--text)", cursor: "pointer", padding: 0, textAlign: "left", font: "inherit", minHeight: 44 }}>
          <span style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 16 }}>{p.nombre}</b>{p.activo === false && <span style={{ fontSize: 12, color: "var(--muted)" }}> · desactivado</span>}
            <span style={{ display: "block", fontSize: 13, color: "var(--muted)" }}>{g.unidades} entregadas · valor {eur(g.valor)} · tu comisión {eur(g.comision)}</span></span>
          <span style={{ textAlign: "right", flexShrink: 0 }}><span style={{ display: "block", fontSize: 11.5, color: "var(--muted)", fontWeight: 800 }}>A PAGAR</span><b style={{ fontSize: 18, color: "var(--accent)" }}>{eur(g.neto)}</b></span>
        </button>
        {ab && <div style={{ marginTop: 10 }}>
          {g.lineas.map(l => <div key={l.consumicion} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 0", borderTop: "1px solid var(--line)" }}>
            <span style={{ flex: 1, minWidth: 0 }}><b>{l.nombre}</b><span style={{ display: "block", fontSize: 12.5, color: "var(--muted)" }}>{l.unidades} uds. · valor {eur(l.valor)} · comisión {eur(l.comision)}</span></span>
            <b style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{eur(l.neto)}</b></div>)}
          {!g.lineas.length && <div style={{ color: "var(--muted)", fontSize: 14, padding: "8px 0" }}>Aún no ha canjeado nada.</div>}
          <button onClick={() => setRegistro(p)} style={{ ...K.btn, width: "100%", marginTop: 10 }}>Ver registro con la hora de cada canje</button>
        </div>}
      </div>); })}
    {!porPuesto.length && <div style={{ ...K.panel, color: "var(--muted)" }}>Aún no hay puestos. Añádelos en Ajustes del evento › Puestos.</div>}
    {registro && <Registro puesto={registro} ev={ev} onCerrar={() => setRegistro(null)} />}
  </div>);
}
const round = (n) => Math.round(n * 100) / 100;

function Registro({ puesto, ev, onCerrar }) {
  const [d, setD] = useState(null);
  const [ver, setVer] = useState("canjes");
  useEffect(() => { supabase.rpc("puestos_registro", { p_puesto: puesto.id, p_limite: 20000 }).then(({ data, error }) => setD(error ? false : data), () => setD(false)); }, [puesto.id]);
  const exportar = () => descargar(`registro-${archivo(puesto.nombre)}-${archivo(ev.name)}.csv`, csv([
    ["Puesto", puesto.nombre], ["Evento", ev.name], [],
    ["Fecha y hora", "Producto", "Unidades", "Valor (€)", "Comisión (€)", "A pagar (€)", "Caja de venta", "Dispositivo"],
    ...(d?.canjes || []).map(c => [horaExacta(c.t), String(c.nombre || "").trim(), c.unidades, Number(c.valor), Number(c.comision), round(Number(c.valor) * c.unidades - Number(c.comision)), c.caja || "", c.dispositivo || ""]),
    [], ["Rechazos"], ["Fecha y hora", "Motivo", "Producto"],
    ...(d?.rechazos || []).map(r => [horaExacta(r.t), MOTIVO[r.motivo] || r.motivo, r.nombre || ""]),
  ]));
  return (<Capa>
    <div onClick={onCerrar} style={{ position: "fixed", inset: 0, zIndex: 170, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "end center" }}>
      <div role="dialog" aria-modal="true" aria-label={`Registro de ${puesto.nombre}`} onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 620, maxHeight: "94dvh", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "22px 22px 0 0", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px 10px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 900, fontSize: 18 }}>Registro · {puesto.nombre}</div><div style={{ fontSize: 12.5, color: "var(--muted)" }}>Cada canje y cada rechazo, con su hora exacta</div></div>
          <button onClick={onCerrar} style={K.btn} aria-label="Cerrar">✕</button>
        </div>
        <div style={{ display: "flex", gap: 6, padding: "10px 16px 0" }}>
          {[["canjes", `Canjes (${d?.canjes?.length ?? "…"})`], ["rechazos", `Rechazos (${d?.rechazos?.length ?? "…"})`]].map(([k, t]) =>
            <button key={k} onClick={() => setVer(k)} aria-pressed={ver === k} style={{ ...K.btn, flex: 1, borderColor: ver === k ? "var(--accent)" : "var(--line)", color: ver === k ? "var(--accent)" : "var(--text)" }}>{t}</button>)}
        </div>
        <div data-scroll style={{ flex: 1, overflow: "auto", overscrollBehavior: "contain", padding: "8px 16px 12px" }}>
          {d === null && <div style={{ color: "var(--muted)" }}>Cargando…</div>}
          {d === false && <div style={{ color: "var(--red)" }}>No se ha podido cargar el registro.</div>}
          {d && ver === "canjes" && (d.canjes.length ? d.canjes.map((c, i) => <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line)", fontSize: 14 }}>
            <span style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{horaExacta(c.t)}</span>
            <span style={{ flex: 1, minWidth: 0 }}><b>{String(c.nombre || "").trim()}</b>{c.unidades > 1 ? ` ×${c.unidades}` : ""}<span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>{c.caja ? `vendido en ${c.caja}` : ""}{c.dispositivo ? ` · ${c.dispositivo}` : ""}</span></span>
            <span style={{ fontWeight: 800, flexShrink: 0 }}>{eur(Number(c.valor) * c.unidades - Number(c.comision))}</span></div>)
            : <div style={{ color: "var(--muted)" }}>Aún no ha canjeado nada.</div>)}
          {d && ver === "rechazos" && (d.rechazos.length ? d.rechazos.map((r, i) => <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line)", fontSize: 14 }}>
            <span style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{horaExacta(r.t)}</span>
            <span style={{ flex: 1 }}><b style={{ color: "var(--red)" }}>{MOTIVO[r.motivo] || r.motivo}</b>{r.nombre ? ` · ${String(r.nombre).trim()}` : ""}</span></div>)
            : <div style={{ color: "var(--muted)" }}>Ningún rechazo.</div>)}
        </div>
        <div style={{ borderTop: "1px solid var(--line)", padding: "10px 16px calc(12px + env(safe-area-inset-bottom))" }}>
          <button onClick={exportar} disabled={!d} style={{ ...K.btn, width: "100%", minHeight: 50, background: "var(--accent)", border: "none", color: "#fff" }}>Descargar registro (CSV)</button>
        </div>
      </div>
    </div>
  </Capa>);
}

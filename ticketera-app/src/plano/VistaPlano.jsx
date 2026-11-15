// ===================== RESERVADOS · VISTA PLANO =====================
// El plano de la sala con cada mesa coloreada según su estado (libre, pagando online, reservado,
// ha llegado, no vino). Tocar una mesa abre su ficha. El administrador puede editar el plano.
import React, { useMemo, useState } from "react";
import { Plano } from "./Plano";
import { EditorPlano } from "./EditorPlano";
import { enlazar, COLOR_ESTADO, sinColocar } from "./modelo";

const LEYENDA = [["libre", "Libre"], ["pendiente", "Pagando online"], ["reservado", "Reservado"], ["llegado", "Ha llegado"], ["novino", "No vino"]];
const K_VISTA = "tixfast_plano_vista";

export default function VistaPlano({ cfg, res, role, isMobile, nombreEvento, onAbrir, onGuardarPlano, onCrearReservado }) {
  const [vista, setVista] = useState(() => { try { return localStorage.getItem(K_VISTA) || "2d"; } catch { return "2d"; } });
  const [editar, setEditar] = useState(false);
  const plano = useMemo(() => (cfg.plano ? enlazar(cfg.plano, res.reservados) : null), [cfg.plano, res.reservados]);
  const mesas = useMemo(() => Object.fromEntries(res.reservados.map(r => [r.id, { nombre: r.nombre, estado: r.estado, cliente: r.cliente, personas: r.personas }])), [res.reservados]);
  const cuenta = (e) => res.reservados.filter(r => r.estado === e).length;
  const admin = role === "admin";
  const faltan = plano ? sinColocar(plano, res.reservados).length : 0;
  const cambiarVista = (v) => { setVista(v); try { localStorage.setItem(K_VISTA, v); } catch {} };
  const boton = (on) => ({ minHeight: 44, padding: "0 13px", borderRadius: 10, border: "none", fontWeight: 800, fontSize: 13.5, cursor: "pointer", background: on ? "var(--accent)" : "transparent", color: on ? "#fff" : "var(--text)" });

  return (<div>
    {plano ? <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <div role="tablist" aria-label="Vista del plano" style={{ display: "inline-flex", background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 12, padding: 3 }}>
          {[["2d", "Plano"], ["3d", "3D"]].map(([k, t]) => <button key={k} role="tab" aria-selected={vista === k} type="button" onClick={() => cambiarVista(k)} style={boton(vista === k)}>{t}</button>)}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", flex: 1, fontSize: 12.5, fontWeight: 700, color: "var(--muted)" }}>
          {LEYENDA.filter(([k]) => k !== "pendiente" || cuenta(k)).map(([k, t]) => <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
            <span style={{ width: 11, height: 11, borderRadius: 4, background: COLOR_ESTADO[k] }} />{t} <b style={{ color: "var(--text)" }}>{cuenta(k)}</b></span>)}
        </div>
        {admin && <button type="button" onClick={() => setEditar(true)} style={{ minHeight: 40, padding: "0 13px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontWeight: 800, fontSize: 13.5, cursor: "pointer" }}>✏️ Editar plano</button>}
      </div>
      <Plano plano={plano} mesas={mesas} modo="ver" vista={vista} altura={isMobile ? "62dvh" : "70dvh"} alTocar={(e) => e.reservadoId && onAbrir(e.reservadoId)} />
      {admin && faltan > 0 && <div style={{ fontSize: 13, color: "var(--amber)", marginTop: 8 }}>Hay {faltan} {faltan === 1 ? "reservado que no está" : "reservados que no están"} en el plano. Colócalos desde «Editar plano».</div>}
    </> : (
      <div style={{ background: "var(--surface)", border: "1px dashed var(--line)", borderRadius: 16, padding: "26px 18px", textAlign: "center" }}>
        <div style={{ fontSize: 34 }}>🗺️</div>
        <div style={{ fontWeight: 900, fontSize: 18, marginTop: 4 }}>Aún no hay plano de la sala</div>
        <div style={{ color: "var(--muted)", fontSize: 14, marginTop: 4, maxWidth: 440, marginInline: "auto" }}>Dibuja la sala con sus medidas, la cabina, la pista, las barras y tus mesas VIP. Verás de un vistazo qué está reservado y qué está libre.</div>
        {admin ? <button type="button" onClick={() => setEditar(true)} style={{ marginTop: 14, minHeight: 48, padding: "0 20px", borderRadius: 14, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 900, fontSize: 15.5, cursor: "pointer" }}>Diseñar el plano</button>
          : <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 10 }}>Lo puede diseñar el administrador.</div>}
      </div>)}
    {editar && <EditorPlano plano={plano} reservados={res.reservados} isMobile={isMobile} nombreSugerido={nombreEvento} onCrearReservado={onCrearReservado} onGuardar={onGuardarPlano} onCerrar={() => setEditar(false)} />}
  </div>);
}

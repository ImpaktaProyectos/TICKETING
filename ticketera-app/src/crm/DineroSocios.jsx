// ===================== CRM · DINERO QUE TIENEN LOS SOCIOS =====================
// Lo que los socios han cobrado en el TPV (señales de reservados y ventas sin ticket en efectivo)
// y aún no han repuesto en la caja. Mismas reglas que el TPV (vista ticket_socio_deudas).
import React, { useEffect, useMemo, useState } from "react";
import { money, C, Icon, Avatar, Tile, Seg, Sheet } from "./ui";
import * as sd from "../socioDeudas";

const fechaHora = (v) => v ? new Date(v).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
const fechaEv = (d) => d ? new Date(d + "T12:00").toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) : "";

export function DineroSocios({ ev, socios = [], flash, onTotales }) {
  const [deudas, setDeudas] = useState(null);
  const [error, setError] = useState(false);
  const [ambito, setAmbito] = useState("pendiente");   // pendiente · evento · todo
  const [confirmar, setConfirmar] = useState(null);
  const [busy, setBusy] = useState(false);
  const cargar = async () => { try { const d = await sd.loadDeudasTodas(); setDeudas(d); setError(false); onTotales?.(d); } catch { setError(true); } };
  useEffect(() => { cargar(); }, [ev?.id]);

  const colorDe = (n) => socios.find(s => s.nombre.trim().toLowerCase() === n.trim().toLowerCase())?.color;
  const visibles = useMemo(() => (deudas || []).filter(d => ambito === "evento" ? d.eventId === ev?.id : ambito === "pendiente" ? d.pendiente > 0 : true), [deudas, ambito, ev?.id]);
  const grupos = useMemo(() => sd.porSocio(visibles), [visibles]);
  const totalPend = (deudas || []).reduce((t, d) => t + d.pendiente, 0);

  const devolver = async ({ socio, items }) => {
    setBusy(true);
    try {
      const porEvento = new Map(); items.forEach(it => porEvento.set(it.eventId, [...(porEvento.get(it.eventId) || []), it]));
      for (const [eid, its] of porEvento) await sd.confirmarDevolucion(eid, its, "CRM");
      flash(`${socio} ha devuelto ${money(items.reduce((t, x) => t + x.pendiente, 0))}`); setConfirmar(null); await cargar();
    } catch { flash(navigator.onLine ? "No se ha podido guardar la devolución" : "Sin conexión: no se ha guardado", "warn"); }
    finally { setBusy(false); }
  };
  const deshacer = async (it) => {
    setBusy(true);
    try { await sd.deshacerDevolucion(it.eventId, it.clave); flash("Vuelve a estar pendiente", "warn"); await cargar(); }
    catch { flash("No se ha podido deshacer", "warn"); } finally { setBusy(false); }
  };

  return (
    <section style={{ ...C.panel, marginBottom: 14, ...(totalPend > 0 ? { borderColor: "color-mix(in srgb, var(--amber) 45%, var(--line))" } : null) }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Tile n="wallet" s={32} c={totalPend > 0 ? "var(--amber)" : "var(--green)"} /><b style={{ fontSize: 15.5 }}>Dinero que tienen los socios</b></div>
        {deudas && <b style={{ fontSize: 17, color: totalPend > 0 ? "var(--amber)" : "var(--green)" }}>{totalPend > 0 ? `Deben ${money(totalPend)}` : "Nada pendiente"}</b>}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>Señales de reservados que ha cobrado un socio y ventas sin ticket en efectivo, desde el TPV. Cuando lo reponga en la caja, confírmalo: su deuda desaparece aquí y en el TPV.</div>
      <div style={{ overflowX: "auto", maxWidth: "100%", marginBottom: 10 }}><Seg size="sm" valor={ambito} onChange={setAmbito} opciones={[{ k: "pendiente", t: "Pendiente" }, { k: "evento", t: "Este evento" }, { k: "todo", t: "Historial" }]} /></div>
      {error && <div style={{ ...C.empty, color: "var(--amber)" }}>No se ha podido cargar. <button onClick={cargar} style={{ ...C.btnSm, marginLeft: 6 }}>Reintentar</button></div>}
      {!deudas && !error && <div style={{ color: "var(--muted)", fontSize: 13.5, padding: 8 }}>Cargando…</div>}
      {deudas && !grupos.length && <div style={C.empty}>{ambito === "pendiente" ? "Ningún socio debe nada. 👌" : "Sin movimientos de socios."}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 10 }}>
        {grupos.map(g => { const pend = g.items.filter(it => it.pendiente > 0); return (
          <div key={g.socio} style={{ ...C.card, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Avatar nombre={g.socio} c={colorDe(g.socio)} s={32} />
              <b style={{ flex: 1, minWidth: 0, fontSize: 15.5 }}>{g.socio}</b>
              <span style={{ textAlign: "right" }}><b style={{ display: "block", fontSize: 19, color: g.pendiente > 0 ? "var(--amber)" : "var(--green)" }}>{money(g.pendiente)}</b><span style={{ fontSize: 11.5, color: "var(--muted)" }}>{g.pendiente > 0 ? "pendiente" : "todo devuelto"}</span></span>
            </div>
            <div style={{ marginTop: 8 }}>{g.items.map(it => (
              <div key={it.eventId + it.clave} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid var(--line)", fontSize: 13.5 }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block" }}>{it.concepto}</span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>{it.evento}{it.eventoFecha ? ` · ${fechaEv(it.eventoFecha)}` : ""}</span>
                  {it.pendiente <= 0 && <span style={{ display: "block", fontSize: 12, color: "var(--green)", fontWeight: 700 }}>Devuelto {fechaHora(it.devueltoEn)}{it.devueltoPor ? ` · ${it.devueltoPor}` : ""}</span>}
                  {it.pendiente > 0 && it.devuelto > 0 && <span style={{ display: "block", fontSize: 12, color: "var(--amber)" }}>Devolvió {money(it.devuelto)}: falta {money(it.pendiente)}</span>}
                </span>
                <b style={{ flexShrink: 0, textDecoration: it.pendiente > 0 ? "none" : "line-through", color: it.pendiente > 0 ? "var(--text)" : "var(--muted)" }}>{money(it.importe)}</b>
                {it.pendiente > 0
                  ? <button onClick={() => setConfirmar({ socio: g.socio, items: [it] })} disabled={busy} aria-label={`Confirmar que ${g.socio} ha devuelto ${money(it.pendiente)}`} style={{ ...C.btnSm, color: "var(--green)", borderColor: "var(--green)", flexShrink: 0 }}><Icon n="check" s={14} w={2.6} />Devuelto</button>
                  : <button onClick={() => deshacer(it)} disabled={busy} style={{ ...C.btnSm, flexShrink: 0 }}>Deshacer</button>}
              </div>))}</div>
            {pend.length > 1 && <button onClick={() => setConfirmar({ socio: g.socio, items: pend })} disabled={busy} style={{ ...C.btnPrimary, width: "100%", justifyContent: "center", marginTop: 8, background: "var(--green)", color: "#04231a" }}><Icon n="check" s={16} w={2.6} />Ha devuelto todo · {money(g.pendiente)}</button>}
          </div>); })}
      </div>

      {confirmar && <Sheet title={`¿${confirmar.socio} ha devuelto el dinero?`} onClose={() => !busy && setConfirmar(null)} footer={<div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setConfirmar(null)} disabled={busy} style={{ ...C.btnGhost, flex: 1 }}>Cancelar</button>
          <button onClick={() => devolver(confirmar)} disabled={busy} style={{ ...C.btnPrimary, flex: 1.5, justifyContent: "center", background: "var(--green)", color: "#04231a" }}><Icon n="check" s={16} w={2.6} />{busy ? "Guardando…" : "Sí, lo ha devuelto"}</button></div>}>
        <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 10 }}>Confírmalo cuando lo haya repuesto en la caja. Su deuda desaparece aquí y en el TPV.</div>
        {confirmar.items.map(it => <div key={it.eventId + it.clave} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13.5, padding: "6px 0", borderTop: "1px solid var(--line)" }}><span style={{ minWidth: 0 }}>{it.concepto} <span style={{ color: "var(--muted)" }}>· {it.evento}</span></span><b>{money(it.pendiente)}</b></div>)}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 17, fontWeight: 900, paddingTop: 10, borderTop: "2px solid var(--line)" }}><span>Total</span><span style={{ color: "var(--green)" }}>{money(confirmar.items.reduce((t, x) => t + x.pendiente, 0))}</span></div>
      </Sheet>}
    </section>
  );
}

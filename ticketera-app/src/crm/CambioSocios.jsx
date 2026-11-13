// ===================== CRM · CAMBIO QUE PONEN LOS SOCIOS =====================
// Dinero que un socio adelanta (p. ej. 500 € de cambio). No es ingreso ni gasto del evento:
// es lo que la empresa le debe hasta devolvérselo. Se apunta aquí o desde el TPV al meter cambio en una barra.
import React, { useEffect, useMemo, useState } from "react";
import { money, r2, parseImporte, C, Icon, Avatar, Tile, Seg, Sheet, Field } from "./ui";
import * as sd from "../socioDeudas";

const fecha = (v) => v ? new Date(v).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
const fechaEv = (d) => d ? new Date(d + "T12:00").toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) : "";

export function CambioSocios({ ev, socios = [], flash, onTotales }) {
  const [lista, setLista] = useState(undefined);    // undefined cargando · null sin tabla · [] datos
  const [error, setError] = useState(false);
  const [ambito, setAmbito] = useState("pendiente");
  const [form, setForm] = useState(null);           // { id?, socio, importe, concepto }
  const [confirmar, setConfirmar] = useState(null); // { socio, items }
  const [busy, setBusy] = useState(false);
  const cargar = async () => { try { const d = await sd.loadAportaciones(); setLista(d); setError(false); onTotales?.(d || []); } catch { setError(true); } };
  useEffect(() => { cargar(); }, [ev?.id]);
  const run = async (fn, ok) => { setBusy(true); try { await fn(); if (ok) flash(ok); await cargar(); return true; } catch (e) { flash(e?.mostrar ? e.message : "No se ha podido guardar", "warn"); return false; } finally { setBusy(false); } };

  const visibles = useMemo(() => (lista || []).filter(a => ambito === "evento" ? a.eventId === ev?.id : ambito === "pendiente" ? !a.devueltoEn : true), [lista, ambito, ev?.id]);
  const grupos = useMemo(() => sd.aportacionesPorSocio(visibles), [visibles]);
  const totalPend = r2((lista || []).filter(a => !a.devueltoEn).reduce((t, a) => t + a.importe, 0));
  const colorDe = (n) => socios.find(s => s.nombre.trim().toLowerCase() === n.trim().toLowerCase())?.color;
  const nombres = socios.filter(s => s.activo !== false).map(s => s.nombre);

  if (lista === null) return null;   // la base de datos aún no tiene la tabla
  const guardar = () => {
    const importe = parseImporte(form.importe);
    if (!String(form.socio || "").trim() || !(importe > 0)) return;
    run(() => form.id ? sd.editarAportacion(form.id, { socio: form.socio, importe, concepto: form.concepto }) : sd.crearAportacion({ eventoId: ev.id, socio: form.socio, importe, concepto: form.concepto, por: "CRM" }),
      form.id ? "Cambio actualizado" : `Apuntado: hay que devolver ${money(importe)} a ${form.socio}`).then(ok => ok && setForm(null));
  };

  return (
    <section style={{ ...C.panel, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Tile n="cash" s={32} c="#3b82f6" /><b style={{ fontSize: 15.5 }}>Cambio que han puesto los socios</b></div>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {lista && <b style={{ fontSize: 17, color: totalPend > 0 ? "#3b82f6" : "var(--green)" }}>{totalPend > 0 ? `Hay que devolver ${money(totalPend)}` : "Nada pendiente"}</b>}
          <button onClick={() => setForm({ socio: nombres.length === 1 ? nombres[0] : "", importe: "", concepto: "Cambio para las barras" })} style={C.btnSm}><Icon n="plus" s={15} w={2.4} />Apuntar</button>
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>Dinero que adelanta un socio (por ejemplo, el cambio de las cajas). <b>No cuenta como ingreso ni como gasto</b>: es lo que hay que devolverle. También se apunta desde el TPV al meter cambio en una barra.</div>
      <div style={{ overflowX: "auto", maxWidth: "100%", marginBottom: 10 }}><Seg size="sm" valor={ambito} onChange={setAmbito} opciones={[{ k: "pendiente", t: "Pendiente" }, { k: "evento", t: "Este evento" }, { k: "todo", t: "Historial" }]} /></div>
      {error && <div style={{ ...C.empty, color: "var(--amber)" }}>No se ha podido cargar. <button onClick={cargar} style={{ ...C.btnSm, marginLeft: 6 }}>Reintentar</button></div>}
      {lista === undefined && !error && <div style={{ color: "var(--muted)", fontSize: 13.5, padding: 8 }}>Cargando…</div>}
      {lista && !grupos.length && <div style={C.empty}>{ambito === "pendiente" ? "No hay que devolver nada a ningún socio." : "Sin cambio apuntado."}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 10 }}>
        {grupos.map(g => { const pend = g.items.filter(a => !a.devueltoEn); return (
          <div key={g.socio} style={{ ...C.card, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Avatar nombre={g.socio} c={colorDe(g.socio)} s={32} />
              <b style={{ flex: 1, minWidth: 0, fontSize: 15.5 }}>{g.socio}</b>
              <span style={{ textAlign: "right" }}><b style={{ display: "block", fontSize: 19, color: g.pendiente > 0 ? "#3b82f6" : "var(--green)" }}>{money(g.pendiente)}</b><span style={{ fontSize: 11.5, color: "var(--muted)" }}>{g.pendiente > 0 ? "hay que devolverle" : "todo devuelto"}</span></span>
            </div>
            <div style={{ marginTop: 8 }}>{g.items.map(a => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid var(--line)", fontSize: 13.5 }}>
                <button onClick={() => !a.devueltoEn && !a.gastoEntradaId && setForm({ id: a.id, socio: a.socio, importe: String(a.importe).replace(".", ","), concepto: a.concepto })} style={{ flex: 1, minWidth: 0, background: "none", border: "none", padding: 0, color: "inherit", font: "inherit", textAlign: "left", cursor: !a.devueltoEn && !a.gastoEntradaId ? "pointer" : "default" }}>
                  <span style={{ display: "block" }}>{a.concepto || "Cambio"}</span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>{a.evento}{a.eventoFecha ? ` · ${fechaEv(a.eventoFecha)}` : ""}{a.gastoEntradaId ? " · metido en una caja del TPV" : ""}</span>
                  {a.devueltoEn && <span style={{ display: "block", fontSize: 12, color: "var(--green)", fontWeight: 700 }}>Devuelto {fecha(a.devueltoEn)}{a.devueltoDesde === "caja" ? " desde la caja" : ""}{a.devueltoPor ? ` · ${a.devueltoPor}` : ""}</span>}
                </button>
                <b style={{ flexShrink: 0, textDecoration: a.devueltoEn ? "line-through" : "none", color: a.devueltoEn ? "var(--muted)" : "var(--text)" }}>{money(a.importe)}</b>
                {!a.devueltoEn
                  ? <button onClick={() => setConfirmar({ socio: g.socio, items: [a] })} disabled={busy} aria-label={`Marcar como devuelto el cambio de ${g.socio}`} style={{ ...C.btnSm, color: "var(--green)", borderColor: "var(--green)", flexShrink: 0 }}><Icon n="check" s={14} w={2.6} />Devuelto</button>
                  : a.devueltoDesde !== "caja" && <button onClick={() => run(() => sd.deshacerDevolucionAportacion(a.id), "Vuelve a estar pendiente")} disabled={busy} style={{ ...C.btnSm, flexShrink: 0 }}>Deshacer</button>}
              </div>))}</div>
            {pend.length > 1 && <button onClick={() => setConfirmar({ socio: g.socio, items: pend })} disabled={busy} style={{ ...C.btnPrimary, width: "100%", justifyContent: "center", marginTop: 8, background: "var(--green)", color: "#04231a" }}><Icon n="check" s={16} w={2.6} />Devuelto todo · {money(g.pendiente)}</button>}
          </div>); })}
      </div>

      {form && <Sheet title={form.id ? "Editar cambio" : "Apuntar cambio de un socio"} onClose={() => !busy && setForm(null)} footer={<div style={{ display: "flex", gap: 8 }}>
          {form.id && <button onClick={() => run(() => sd.borrarAportacion(form.id), "Borrado").then(ok => ok && setForm(null))} disabled={busy} aria-label="Borrar" style={{ ...C.btnGhost, color: "var(--red)", padding: "0 14px" }}><Icon n="trash" s={17} /></button>}
          <button onClick={guardar} disabled={busy || !String(form.socio || "").trim() || !(parseImporte(form.importe) > 0)} style={{ ...C.btnPrimary, flex: 1, justifyContent: "center", opacity: String(form.socio || "").trim() && parseImporte(form.importe) > 0 ? 1 : .45 }}>{busy ? "Guardando…" : form.id ? "Guardar" : `Apuntar ${parseImporte(form.importe) > 0 ? money(parseImporte(form.importe)) : ""}`}</button></div>}>
        <Field l="Socio">
          {nombres.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>{nombres.map(n => <button key={n} onClick={() => setForm(f => ({ ...f, socio: n }))} aria-pressed={form.socio === n} style={{ ...C.btnSm, ...(form.socio === n ? { background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" } : {}) }}>{n}</button>)}</div>}
          <input value={form.socio} maxLength={60} onChange={e => setForm(f => ({ ...f, socio: e.target.value }))} placeholder="Nombre del socio" style={C.input} />
        </Field>
        <Field l="Importe (€)"><input value={form.importe} inputMode="decimal" autoFocus={!form.id} onChange={e => setForm(f => ({ ...f, importe: e.target.value.replace(/[^\d.,]/g, "").slice(0, 10) }))} placeholder="500" style={{ ...C.input, fontSize: 22, fontWeight: 900 }} /></Field>
        <Field l="Concepto" mb={0}><input value={form.concepto || ""} maxLength={200} onChange={e => setForm(f => ({ ...f, concepto: e.target.value }))} placeholder="Cambio para las barras" style={C.input} /></Field>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>Se apunta en {ev?.name}. No suma como ingreso ni como gasto del evento.</div>
      </Sheet>}

      {confirmar && <Sheet title={`¿Le habéis devuelto el cambio a ${confirmar.socio}?`} onClose={() => !busy && setConfirmar(null)} footer={<div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setConfirmar(null)} disabled={busy} style={{ ...C.btnGhost, flex: 1 }}>Cancelar</button>
          <button onClick={() => run(async () => { for (const a of confirmar.items) await sd.devolverAportacion(a.id, { desde: "fuera", por: "CRM" }); }, `Devuelto a ${confirmar.socio}`).then(ok => ok && setConfirmar(null))} disabled={busy} style={{ ...C.btnPrimary, flex: 1.5, justifyContent: "center", background: "var(--green)", color: "#04231a" }}><Icon n="check" s={16} w={2.6} />{busy ? "Guardando…" : "Sí, devuelto"}</button></div>}>
        <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 10 }}>Márcalo cuando se lo hayáis devuelto fuera de la caja (si se lo devolvéis desde una barra, hacedlo en el TPV: 💰 Caja → Sacar dinero → Devolver cambio a un socio).</div>
        {confirmar.items.map(a => <div key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13.5, padding: "6px 0", borderTop: "1px solid var(--line)" }}><span style={{ minWidth: 0 }}>{a.concepto || "Cambio"} <span style={{ color: "var(--muted)" }}>· {a.evento}</span></span><b>{money(a.importe)}</b></div>)}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 17, fontWeight: 900, paddingTop: 10, borderTop: "2px solid var(--line)" }}><span>Total</span><span style={{ color: "var(--green)" }}>{money(r2(confirmar.items.reduce((t, a) => t + a.importe, 0)))}</span></div>
      </Sheet>}
    </section>
  );
}

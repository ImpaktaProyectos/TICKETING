// ===================== TIXFAST · MODO CRM (fase 1: ingresos y socios) =====================
// Separado del TPV: se carga solo al abrirlo y solo escribe en tablas ticket_crm_*.
// Lo vendido en las barras se LEE de las ventas que ya tiene la app (nunca se copia ni se modifica).
import React, { useEffect, useMemo, useState } from "react";
import * as crm from "./crmdb";
import { money, r2, hoy, fechaCorta, parseImporte, isInvite, useIsMobile, Dot, C, Icon, Avatar, Head, Tile } from "./ui";
import { Gastos, totalesGastos } from "./Gastos";
import { Liquidacion, calcularLiquidacion } from "./Liquidacion";
import { GRUPOS, CATS, catInfo, fuenteAuto } from "./modelo";
import { Dashboard } from "./Dashboard";
import { Ingresos, IngresoForm } from "./Ingresos";

const COLORES = ["#ff5a3c", "#a855f7", "#3b82f6", "#22d3a6", "#ffb400", "#ec4899", "#14b8a6", "#f97316"];

export default function CRM({ events, sales, gastosCaja = [], ev, onSelectEvent, onExit, flash }) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState("dashboard");
  const [data, setData] = useState(null);      // { socios, participacion, ingresos, fuentes }
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editIng, setEditIng] = useState(null); // ingreso en edición (o {} para nuevo)

  const cargar = async () => {
    setError(null);
    try { setData(await crm.loadCRM(ev.id)); }
    catch (e) { setError(navigator.onLine ? "No se han podido cargar los datos del CRM." : "El CRM necesita conexión a internet."); }
  };
  useEffect(() => { setData(null); if (ev?.id) cargar(); }, [ev?.id]);
  const run = async (fn, okMsg) => {
    if (busy) return false;
    setBusy(true);
    try { await fn(); if (okMsg) flash(okMsg); await cargar(); return true; }
    catch (e) { flash(navigator.onLine ? "No se ha podido guardar" : "Sin conexión: no se ha guardado", "warn"); return false; }
    finally { setBusy(false); }
  };

  // ---- Barras del TPV (solo lectura, en directo) ----
  const barras = useMemo(() => {
    const ss = sales.filter(s => s.eventId === ev.id);
    return ev.puntos.map(p => {
      const v = ss.filter(s => s.puntoId === p.id && !s.voided && !isInvite(s));
      const inv = ss.filter(s => s.puntoId === p.id && !s.voided && isInvite(s)).length;
      return { punto: p, fuente: (data?.fuentes || {})[p.id] || fuenteAuto(p), tickets: v.length, total: r2(v.reduce((t, s) => t + s.price, 0)),
        efectivo: r2(v.filter(s => s.pago === "efectivo").reduce((t, s) => t + s.price, 0)), tarjeta: r2(v.filter(s => s.pago === "tarjeta").reduce((t, s) => t + s.price, 0)), invitaciones: inv };
    }).filter(b => !b.punto.archivado || b.tickets > 0);
  }, [sales, ev, data?.fuentes]);

  const socios = data?.socios || [];
  const socioById = (id) => socios.find(s => s.id === id);
  const ingresos = data?.ingresos || [];

  // ---- Totales ----
  const T = useMemo(() => {
    const porGrupo = Object.fromEntries(GRUPOS.map(g => [g.k, 0]));
    barras.forEach(b => { porGrupo[b.fuente === "otros" ? "otros" : b.fuente] += b.total; });
    ingresos.forEach(i => { const g = catInfo(i.categoria).g; porGrupo[g] = (porGrupo[g] || 0) + i.importe; });
    const tpv = r2(barras.reduce((t, b) => t + b.total, 0));
    const manual = r2(ingresos.reduce((t, i) => t + i.importe, 0));
    const pendiente = r2(ingresos.filter(i => i.estado === "pendiente").reduce((t, i) => t + i.importe, 0));
    const enSocios = {};
    ingresos.filter(i => i.cobradoPor && !i.entregado && i.estado === "cobrado").forEach(i => { enSocios[i.cobradoPor] = r2((enSocios[i.cobradoPor] || 0) + i.importe); });
    Object.keys(porGrupo).forEach(k => { porGrupo[k] = r2(porGrupo[k]); });
    return { porGrupo, tpv, manual, pendiente, total: r2(tpv + manual), enSocios };
  }, [barras, ingresos]);
  const G = useMemo(() => totalesGastos(ev, data?.gastos || [], gastosCaja), [ev, data?.gastos, gastosCaja]);
  const L = useMemo(() => calcularLiquidacion({ ev, tpv: T.tpv, ingresos, G, participacion: data?.participacion || [], socios }), [ev, T.tpv, ingresos, G, data?.participacion, socios]);

  const wrap = { position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: "var(--bg)", color: "var(--text)" };
  return (
    <div style={wrap}>
      {/* ===== Cabecera del CRM (distinta del TPV) ===== */}
      <header style={{ ...C.head, padding: isMobile ? "10px 12px" : "12px 22px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <img src="/brand/tixfast_isotipo_app.svg" alt="TIXFAST" width={isMobile ? 30 : 36} height={isMobile ? 30 : 36} style={{ flexShrink: 0 }} />
          <span style={C.crmPill}>CRM</span>
          {!isMobile && <span style={{ color: "rgba(255,255,255,.85)", fontWeight: 700, fontSize: 13 }}>Organización del evento</span>}
        </div>
        <select value={ev.id} onChange={e => onSelectEvent(e.target.value)} style={{ ...C.headSelect, maxWidth: isMobile ? 150 : 280 }} aria-label="Evento">
          {events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <button onClick={onExit} style={C.backBtn}>{isMobile ? "← TPV" : "← Volver al TPV"}</button>
      </header>

      <nav style={{ ...C.tabs, padding: isMobile ? "0 12px" : "0 22px" }}>
        {[["dashboard", "chart", "Dashboard", "Panel"], ["ingresos", "wallet", "Ingresos", "Ingresos"], ["gastos", "receipt", "Gastos", "Gastos"], ["liquidacion", "scale", "Liquidación", "Liquidar"], ["socios", "users", "Socios", "Socios"]].map(([k, ico, l, lm]) =>
          <button key={k} onClick={() => setTab(k)} style={{ ...C.tab, display: "flex", alignItems: "center", gap: 8, ...(isMobile ? { flex: 1, padding: "9px 2px 7px", fontSize: 11.5, flexDirection: "column", gap: 3 } : {}), ...(tab === k ? C.tabOn : {}) }}>
            <Icon n={ico} s={isMobile ? 19 : 17} c={tab === k ? "var(--accent)" : "currentColor"} />{isMobile ? lm : l}</button>)}
      </nav>

      <main style={{ flex: 1, overflow: "auto", padding: isMobile ? 12 : 22, WebkitOverflowScrolling: "touch" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          {error && <div style={{ ...C.panel, borderColor: "var(--amber)", color: "var(--amber)", fontWeight: 700, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}><span style={{ display: "flex", alignItems: "center", gap: 8 }}><Icon n="alert" s={18} />{error}</span><button onClick={cargar} style={C.ghost}>Reintentar</button></div>}
          {!data && !error && <div style={{ color: "var(--muted)", padding: 30, textAlign: "center" }}>Cargando…</div>}
          {data && tab === "dashboard" && (
            <Dashboard ev={ev} events={events} sales={sales} gastosCaja={gastosCaja} onSelectEvent={onSelectEvent} refreshKey={data} />
          )}
          {data && tab === "ingresos" && (
            <Ingresos ev={ev} T={T} barras={barras} ingresos={ingresos} socios={socios} socioById={socioById} isMobile={isMobile}
              onNuevo={() => setEditIng({})} onEditar={(i) => setEditIng(i)}
              onFuente={(pid, f) => run(() => crm.setFuentePunto(pid, f), "Tipo de ingreso actualizado")}
              onEntregar={(socioId) => run(() => crm.setEntregado(ingresos.filter(i => i.cobradoPor === socioId && !i.entregado && i.estado === "cobrado").map(i => i.id), true), "Marcado como entregado")} />
          )}
          {data && tab === "gastos" && (
            <Gastos ev={ev} events={events} gastos={data.gastos} gastosCaja={gastosCaja} socios={socios} socioById={socioById} ingresosTotal={T.total} isMobile={isMobile} busy={busy}
              onSave={(x) => run(() => crm.saveGasto({ ...x, eventoId: ev.id }), x.id ? "Gasto actualizado" : "Gasto añadido")}
              onDelete={(x) => run(() => crm.deleteGasto(x.id), "Gasto borrado")}
              onCopiar={(desde) => run(async () => { const nn = await crm.copiarPresupuesto(desde.id, ev.id); if (!nn) throw new Error("vacío"); }, `Presupuesto de ${desde.name} copiado`)} />
          )}
          {data && tab === "liquidacion" && (
            <Liquidacion L={L} guardada={data.liquidacion} busy={busy}
              onIrSocios={() => setTab("socios")} onIrIngresos={() => setTab("ingresos")}
              onCerrar={(datos) => run(() => crm.cerrarLiquidacion(ev.id, datos), "Liquidación cerrada")}
              onReabrir={() => run(() => crm.reabrirLiquidacion(ev.id), "Liquidación reabierta")}
              onMarcarPagado={(socioId, v) => run(() => crm.actualizarLiquidacion(ev.id, { ...data.liquidacion.datos, filas: data.liquidacion.datos.filas.map(f => f.socioId === socioId ? { ...f, pagado: v } : f) }), v ? "Marcado como hecho" : "Desmarcado")} />
          )}
          {data && tab === "socios" && (
            <Socios ev={ev} data={data} T={T} G={G} isMobile={isMobile} busy={busy}
              onGuardarSocio={(s) => run(() => crm.saveSocio(s), s.id ? "Socio actualizado" : "Socio añadido")}
              onActivo={(s, a) => run(() => crm.setSocioActivo(s.id, a), a ? "Socio reactivado" : "Socio quitado")}
              onReparto={(lista) => run(() => crm.saveParticipacion(ev.id, lista), "Reparto guardado")} />
          )}
        </div>
      </main>

      {editIng && <IngresoForm ev={ev} ingreso={editIng} socios={socios.filter(s => s.activo || s.id === editIng.cobradoPor)} usadas={ingresos.map(i => i.categoria)} busy={busy}
        onClose={() => setEditIng(null)}
        onSave={async (x) => { const ok = await run(() => crm.saveIngreso({ ...x, eventoId: ev.id }), x.id ? "Ingreso actualizado" : "Ingreso añadido"); if (ok) setEditIng(null); }}
        onDelete={async (x) => { const ok = await run(() => crm.deleteIngreso(x.id), "Ingreso borrado"); if (ok) setEditIng(null); }} />}
    </div>
  );
}

/* ===================== SOCIOS ===================== */
function Socios({ ev, data, T, G, isMobile, busy, onGuardarSocio, onActivo, onReparto }) {
  const activos = data.socios.filter(s => s.activo);
  const inactivos = data.socios.filter(s => !s.activo);
  const inicial = () => Object.fromEntries(data.participacion.map(p => [p.socioId, String(p.porcentaje).replace(".", ",")]));
  const [rep, setRep] = useState(inicial);
  useEffect(() => { setRep(inicial()); }, [data.participacion, ev.id]);
  const [nuevo, setNuevo] = useState({ nombre: "", telefono: "" });
  const [edit, setEdit] = useState(null);
  const [verInactivos, setVerInactivos] = useState(false);

  const participan = Object.keys(rep).filter(id => rep[id] != null && data.socios.some(s => s.id === id));
  const suma = r2(participan.reduce((t, id) => t + parseImporte(rep[id]), 0));
  const cambiado = JSON.stringify(Object.entries(rep).sort()) !== JSON.stringify(Object.entries(inicial()).sort());
  const toggle = (id) => setRep(r => { const x = { ...r }; if (x[id] != null) delete x[id]; else x[id] = "0"; return x; });
  const iguales = () => { const ids = participan.length ? participan : activos.map(s => s.id); if (!ids.length) return; const base = Math.floor(10000 / ids.length) / 100; const x = {}; ids.forEach((id, i) => { x[id] = String(i === ids.length - 1 ? r2(100 - base * (ids.length - 1)) : base).replace(".", ","); }); setRep(x); };
  const guardarReparto = () => onReparto(participan.map(id => ({ socioId: id, porcentaje: parseImporte(rep[id]) })));
  const color = () => COLORES[data.socios.length % COLORES.length];

  return (
    <div>
      {/* Reparto del evento */}
      <div style={{ ...C.panel, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Tile n="users" s={32} /><b style={{ fontSize: 15.5 }}>Socios en {ev.name}</b></div>
          <button onClick={iguales} disabled={!activos.length} style={C.btnSm}><Icon n="scale" s={15} />A partes iguales</button>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>Marca quién participa en este evento y con qué porcentaje. Puede cambiar de un evento a otro.</div>
        {activos.length === 0 && <div style={C.empty}>Primero añade los socios aquí abajo.</div>}
        {activos.map(s => { const on = rep[s.id] != null; const tiene = T.enSocios[s.id] || 0; const pago = (G?.pagadoSocio || {})[s.id] || 0; return (
          <div key={s.id} style={{ ...C.row, opacity: on ? 1 : .6 }}>
            <button onClick={() => toggle(s.id)} style={{ ...C.check, ...(on ? C.checkOn : {}) }} aria-label={on ? "Quitar del evento" : "Añadir al evento"}>{on ? <Icon n="check" s={16} w={2.8} c="#fff" style={{ margin: "auto" }} /> : null}</button>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800 }}><Avatar nombre={s.nombre} c={s.color} s={26} />{s.nombre}</span>
              {tiene > 0 && <span style={{ display: "block", fontSize: 12, color: "var(--amber)", fontWeight: 700, marginTop: 2 }}>Tiene {money(tiene)} del evento</span>}
              {pago > 0 && <span style={{ display: "block", fontSize: 12, color: "#60a5fa", fontWeight: 700, marginTop: 2 }}>Ha adelantado {money(pago)} de su bolsillo</span>}
            </span>
            {on && <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <input inputMode="decimal" value={rep[s.id]} onChange={e => setRep(r => ({ ...r, [s.id]: e.target.value.replace(/[^\d.,]/g, "").slice(0, 7) }))} style={{ ...C.input, width: 82, textAlign: "right", fontWeight: 900, fontSize: 16, padding: "8px 10px" }} aria-label={`Porcentaje de ${s.nombre}`} />
              <b style={{ color: "var(--muted)" }}>%</b></span>}
          </div>); })}
        {activos.length > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            <span style={{ fontWeight: 900, color: participan.length === 0 ? "var(--muted)" : Math.abs(suma - 100) < 0.01 ? "var(--green)" : "var(--amber)" }}>
              {participan.length === 0 ? "Nadie marcado" : Math.abs(suma - 100) < 0.01 ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon n="check" s={16} w={2.6} />Suma 100 %</span> : <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon n="alert" s={16} />Suma {String(suma).replace(".", ",")} % (debe ser 100 %)</span>}
            </span>
            <button onClick={guardarReparto} disabled={busy || !cambiado || (participan.length > 0 && Math.abs(suma - 100) >= 0.01)} style={{ ...C.primary, opacity: busy || !cambiado || (participan.length > 0 && Math.abs(suma - 100) >= 0.01) ? .45 : 1 }}>Guardar reparto</button>
          </div>
        )}
      </div>

      {/* Socios de la cuenta */}
      <div style={C.panel}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}><Tile n="user" c="#3b82f6" s={32} /><b style={{ fontSize: 15.5 }}>Socios de la cuenta</b></div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>Se crean una vez y se eligen en cada evento.</div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr auto", gap: 8, marginBottom: 12 }}>
          <input value={nuevo.nombre} maxLength={80} onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })} placeholder="Nombre del socio" style={C.input} onKeyDown={e => { if (e.key === "Enter" && nuevo.nombre.trim()) { onGuardarSocio({ ...nuevo, color: color() }); setNuevo({ nombre: "", telefono: "" }); } }} />
          <input value={nuevo.telefono} maxLength={30} inputMode="tel" onChange={e => setNuevo({ ...nuevo, telefono: e.target.value })} placeholder="Teléfono (opcional)" style={C.input} />
          <button disabled={!nuevo.nombre.trim() || busy} onClick={() => { onGuardarSocio({ ...nuevo, color: color() }); setNuevo({ nombre: "", telefono: "" }); }} style={{ ...C.btnPrimary, opacity: nuevo.nombre.trim() ? 1 : .45 }}><Icon n="plus" s={17} w={2.4} />Añadir</button>
        </div>
        {activos.map(s => (
          <div key={s.id} style={C.row}>
            {edit?.id === s.id ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", width: "100%" }}>
                <input autoFocus value={edit.nombre} maxLength={80} onChange={e => setEdit({ ...edit, nombre: e.target.value })} style={{ ...C.input, flex: "1 1 160px" }} />
                <input value={edit.telefono} maxLength={30} onChange={e => setEdit({ ...edit, telefono: e.target.value })} placeholder="Teléfono" style={{ ...C.input, flex: "1 1 140px" }} />
                <div style={{ display: "flex", gap: 4 }}>{COLORES.map(c => <button key={c} onClick={() => setEdit({ ...edit, color: c })} style={{ width: 26, height: 26, borderRadius: "50%", background: c, border: edit.color === c ? "3px solid #fff" : "2px solid transparent" }} aria-label="Color" />)}</div>
                <button onClick={() => { if (edit.nombre.trim()) { onGuardarSocio(edit); setEdit(null); } }} style={{ ...C.small, color: "var(--green)", borderColor: "var(--green)" }}>Guardar</button>
                <button onClick={() => setEdit(null)} style={C.small} aria-label="Cancelar"><Icon n="x" s={14} /></button>
              </div>
            ) : (<>
              <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}><Avatar nombre={s.nombre} c={s.color} s={30} /><b>{s.nombre}</b>{s.telefono && <a href={`tel:${s.telefono.replace(/[^\d+]/g, "")}`} style={{ color: "var(--muted)", fontSize: 12.5 }}>{s.telefono}</a>}</span>
              <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button onClick={() => setEdit({ ...s })} style={C.btnSm} aria-label="Editar"><Icon n="edit" s={15} /></button>
                <button onClick={() => onActivo(s, false)} style={{ ...C.btnSm, color: "var(--muted)" }}>Quitar</button>
              </span>
            </>)}
          </div>
        ))}
        {inactivos.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <button onClick={() => setVerInactivos(v => !v)} style={{ ...C.small, color: "var(--muted)" }}>{verInactivos ? "Ocultar" : "Ver"} socios quitados ({inactivos.length})</button>
            {verInactivos && inactivos.map(s => <div key={s.id} style={{ ...C.row, opacity: .6 }}><span style={{ display: "flex", alignItems: "center", gap: 8 }}><Avatar nombre={s.nombre} c={s.color} s={24} />{s.nombre}</span><button onClick={() => onActivo(s, true)} style={C.small}>Recuperar</button></div>)}
          </div>
        )}
      </div>
    </div>
  );
}


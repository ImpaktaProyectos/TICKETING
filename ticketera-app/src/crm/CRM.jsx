// ===================== TIXFAST · MODO CRM (fase 1: ingresos y socios) =====================
// Separado del TPV: se carga solo al abrirlo y solo escribe en tablas ticket_crm_*.
// Lo vendido en las barras se LEE de las ventas que ya tiene la app (nunca se copia ni se modifica).
import React, { useEffect, useMemo, useState } from "react";
import * as crm from "./crmdb";
import { money, r2, hoy, fechaCorta, parseImporte, isInvite, useIsMobile, Dot, C } from "./ui";
import { Gastos, totalesGastos } from "./Gastos";
import { Liquidacion, calcularLiquidacion } from "./Liquidacion";
import { GRUPOS, CATS, catInfo, fuenteAuto } from "./modelo";
import { Dashboard } from "./Dashboard";

const METODOS = [["efectivo", "💶 Efectivo"], ["transferencia", "🏦 Transferencia"], ["bizum", "📲 Bizum"], ["tarjeta", "💳 Tarjeta"], ["otro", "Otro"]];
const FUENTES_PUNTO = [["barra", "🍹 Barra"], ["entradas", "🎟️ Entradas"], ["merch", "👕 Merch"], ["otros", "✨ Otros"]];
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
        {[["dashboard", "📊", "Dashboard", "Panel"], ["ingresos", "💶", "Ingresos", "Ingresos"], ["gastos", "🧾", "Gastos", "Gastos"], ["liquidacion", "⚖️", "Liquidación", "Liquidar"], ["socios", "🤝", "Socios", "Socios"]].map(([k, ico, l, lm]) =>
          <button key={k} onClick={() => setTab(k)} style={{ ...C.tab, ...(isMobile ? { flex: 1, padding: "9px 2px 7px", fontSize: 11.5, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 } : {}), ...(tab === k ? C.tabOn : {}) }}>{isMobile ? <><span style={{ fontSize: 17 }}>{ico}</span>{lm}</> : `${ico} ${l}`}</button>)}
      </nav>

      <main style={{ flex: 1, overflow: "auto", padding: isMobile ? 12 : 22, WebkitOverflowScrolling: "touch" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          {error && <div style={{ ...C.panel, borderColor: "var(--amber)", color: "var(--amber)", fontWeight: 700, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}><span>⚠️ {error}</span><button onClick={cargar} style={C.ghost}>Reintentar</button></div>}
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

/* ===================== INGRESOS ===================== */
function Ingresos({ ev, T, barras, ingresos, socios, socioById, isMobile, onNuevo, onEditar, onFuente, onEntregar }) {
  const [filtro, setFiltro] = useState("todos");
  const cats = Array.from(new Set(ingresos.map(i => i.categoria)));
  const lista = ingresos.filter(i => filtro === "todos" ? true : filtro === "socios" ? (i.cobradoPor && !i.entregado) : filtro === "pendientes" ? i.estado === "pendiente" : i.categoria === filtro);
  const max = Math.max(1, ...GRUPOS.map(g => T.porGrupo[g.k] || 0));
  const enSocios = Object.entries(T.enSocios).filter(([, v]) => v > 0);
  return (
    <div>
      {/* Total grande */}
      <div style={{ ...C.hero, padding: isMobile ? 16 : 22 }}>
        <div style={C.label}>Ingresos de {ev.name}</div>
        <div style={{ fontSize: isMobile ? 38 : 48, fontWeight: 900, letterSpacing: "-.02em", lineHeight: 1.05, margin: "4px 0 8px" }}>{money(T.total)}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span style={C.tag}>🖥️ TPV en directo {money(T.tpv)}</span>
          <span style={C.tag}>✍️ Otros ingresos {money(T.manual)}</span>
          {T.pendiente > 0 && <span style={{ ...C.tag, color: "var(--amber)", borderColor: "rgba(255,180,0,.5)" }}>⏳ Pendiente de cobrar {money(T.pendiente)}</span>}
        </div>
      </div>

      {/* Tarjetas por fuente */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,minmax(0,1fr))" : "repeat(5,minmax(0,1fr))", gap: 10, margin: "14px 0" }}>
        {GRUPOS.map(g => (
          <div key={g.k} style={{ ...C.card, borderTop: `3px solid ${g.c}` }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "var(--muted)" }}>{g.ico} {g.t}</div>
            <div style={{ fontSize: 22, fontWeight: 900, marginTop: 4 }}>{money(T.porGrupo[g.k])}</div>
            <div style={{ height: 6, borderRadius: 4, background: "var(--surface2)", marginTop: 8, overflow: "hidden" }}><div style={{ width: `${(T.porGrupo[g.k] || 0) / max * 100}%`, height: "100%", background: g.c, borderRadius: 4 }} /></div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 5 }}>{T.total > 0 ? Math.round((T.porGrupo[g.k] || 0) / T.total * 100) : 0}% del total</div>
          </div>
        ))}
      </div>

      {/* Dinero que tienen los socios */}
      {enSocios.length > 0 && (
        <div style={{ ...C.panel, borderColor: "rgba(255,180,0,.55)", marginBottom: 14 }}>
          <div style={{ fontWeight: 900, marginBottom: 2 }}>💰 Dinero del evento en manos de socios</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>Ya cuenta como ingreso. Márcalo como entregado cuando lo den a la caja; si no, se descontará en su liquidación.</div>
          {enSocios.map(([sid, v]) => { const s = socioById(sid); return (
            <div key={sid} style={C.row}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}><Dot c={s?.color} /><b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s?.nombre || "Socio"}</b> <span style={{ color: "var(--muted)" }}>tiene</span></span>
              <span style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}><b style={{ color: "var(--amber)", fontSize: 17 }}>{money(v)}</b><button onClick={() => onEntregar(sid)} style={C.small}>✓ Entregado</button></span>
            </div>); })}
        </div>
      )}

      {/* Barras del TPV */}
      <div style={{ ...C.panel, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
          <div style={{ fontWeight: 900 }}>🖥️ Ventas del TPV <span style={C.live}>● en directo</span></div>
          <b>{money(T.tpv)}</b>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>Se suman solas con cada venta. Las invitaciones no cuentan. Elige qué es cada punto de venta para clasificarlo bien.</div>
        {barras.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>Este evento no tiene barras.</div>}
        {barras.map(b => (
          <div key={b.punto.id} style={{ ...C.row, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0, flex: "1 1 180px" }}>
              <div style={{ fontWeight: 800 }}>📍 {b.punto.name}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{b.tickets} tickets{b.efectivo || b.tarjeta ? ` · 💶 ${money(b.efectivo)} · 💳 ${money(b.tarjeta)}` : ""}{b.invitaciones ? ` · 🎁 ${b.invitaciones} invitaciones` : ""}</div>
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {FUENTES_PUNTO.map(([k, l]) => <button key={k} onClick={() => b.fuente !== k && onFuente(b.punto.id, k)} style={{ ...C.seg, ...(b.fuente === k ? C.segOn : {}) }}>{l}</button>)}
            </div>
            <b style={{ minWidth: 92, textAlign: "right", fontSize: 16 }}>{money(b.total)}</b>
          </div>
        ))}
      </div>

      {/* Otros ingresos */}
      <div style={C.panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <div><div style={{ fontWeight: 900 }}>✍️ Otros ingresos</div><div style={{ fontSize: 12.5, color: "var(--muted)" }}>Entradas anticipadas, patrocinios, merch, subvenciones…</div></div>
          <button onClick={onNuevo} style={{ ...C.primary, width: isMobile ? "100%" : "auto" }}>＋ Añadir ingreso</button>
        </div>
        {ingresos.length > 0 && (
          <div className="scroll-x" style={{ display: "flex", gap: 6, marginBottom: 10, overflowX: "auto", paddingBottom: 2 }}>
            {[["todos", "Todos"], ...cats.map(c => [c, `${catInfo(c).ico} ${c}`]), ["socios", "💰 Lo tiene un socio"], ["pendientes", "⏳ Pendientes"]].map(([k, l]) =>
              <button key={k} onClick={() => setFiltro(k)} style={{ ...C.seg, flexShrink: 0, ...(filtro === k ? C.segOn : {}) }}>{l}</button>)}
          </div>
        )}
        {ingresos.length === 0 && <div style={C.empty}>Aún no hay otros ingresos. Pulsa <b>＋ Añadir ingreso</b> para apuntar, por ejemplo, las entradas que ha vendido un socio.</div>}
        {lista.map(i => { const s = i.cobradoPor ? socioById(i.cobradoPor) : null; return (
          <button key={i.id} onClick={() => onEditar(i)} style={C.ingRow}>
            <span style={{ fontSize: 22, flexShrink: 0 }}>{catInfo(i.categoria).ico}</span>
            <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
              <span style={{ display: "block", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.concepto || i.categoria}</span>
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
                <span>{fechaCorta(i.fecha)}</span><span>· {i.categoria}</span><span>· {(METODOS.find(m => m[0] === i.metodo) || [, i.metodo])[1]}</span>
                {s ? <span style={{ color: i.entregado ? "var(--green)" : "var(--amber)", fontWeight: 800 }}>· {i.entregado ? `entregado por ${s.nombre}` : `lo tiene ${s.nombre}`}</span> : <span>· 🏢 empresa</span>}
                {i.estado === "pendiente" && <span style={{ color: "var(--amber)", fontWeight: 800 }}>· ⏳ pendiente</span>}
              </span>
            </span>
            <b style={{ fontSize: 16, flexShrink: 0, color: i.estado === "pendiente" ? "var(--amber)" : "var(--text)" }}>{money(i.importe)}</b>
          </button>); })}
        {ingresos.length > 0 && lista.length === 0 && <div style={C.empty}>Nada con este filtro.</div>}
      </div>
    </div>
  );
}

function IngresoForm({ ev, ingreso, socios, usadas, busy, onClose, onSave, onDelete }) {
  const isMobile = useIsMobile();
  const nuevo = !ingreso.id;
  const [f, setF] = useState(() => ({
    id: ingreso.id, importe: ingreso.importe ? String(ingreso.importe).replace(".", ",") : "", categoria: ingreso.categoria || "Entradas anticipadas",
    concepto: ingreso.concepto || "", cobradoPor: ingreso.cobradoPor || null, entregado: !!ingreso.entregado, estado: ingreso.estado || "cobrado",
    metodo: ingreso.metodo || "efectivo", fecha: ingreso.fecha || hoy(), nota: ingreso.nota || "",
  }));
  const [otraCat, setOtraCat] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (p) => setF(x => ({ ...x, ...p }));
  const imp = parseImporte(f.importe);
  const catList = Array.from(new Set([...CATS.map(c => c.k), ...usadas, ...(f.categoria ? [f.categoria] : [])]));
  const guardar = () => { if (!(imp > 0)) return; onSave({ ...f, importe: imp, categoria: (otraCat.trim() || f.categoria) }); };
  return (
    <div style={C.modalWrap} onClick={onClose}>
      <div style={{ ...C.modal, ...(isMobile ? { borderRadius: "22px 22px 0 0", maxHeight: "94dvh", alignSelf: "flex-end" } : {}) }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontWeight: 900, fontSize: 19 }}>{nuevo ? "＋ Nuevo ingreso" : "Editar ingreso"}</div>
          <button onClick={onClose} style={C.small} aria-label="Cerrar">✕</button>
        </div>

        <div style={C.label}>Importe</div>
        <div style={{ position: "relative", marginBottom: 14 }}>
          <input autoFocus={nuevo} inputMode="decimal" value={f.importe} onChange={e => set({ importe: e.target.value.replace(/[^\d.,]/g, "").slice(0, 12) })} placeholder="0,00" style={{ ...C.input, fontSize: 30, fontWeight: 900, textAlign: "center", padding: "12px 40px", color: imp > 0 ? "var(--green)" : "var(--text)" }} />
          <span style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", fontSize: 22, fontWeight: 900, color: "var(--muted)" }}>€</span>
        </div>

        <div style={C.label}>Categoría</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {catList.map(c => <button key={c} onClick={() => { set({ categoria: c }); setOtraCat(""); }} style={{ ...C.seg, ...(f.categoria === c && !otraCat ? C.segOn : {}) }}>{catInfo(c).ico} {c}</button>)}
        </div>
        <input value={otraCat} maxLength={60} onChange={e => setOtraCat(e.target.value)} placeholder="O escribe una categoría nueva" style={{ ...C.input, marginBottom: 14 }} />

        <div style={C.label}>Concepto</div>
        <input value={f.concepto} maxLength={160} onChange={e => set({ concepto: e.target.value })} placeholder="Ej.: 20 entradas anticipadas" style={{ ...C.input, marginBottom: 14 }} />

        <div style={C.label}>¿Quién tiene el dinero?</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          <button onClick={() => set({ cobradoPor: null, entregado: false })} style={{ ...C.seg, ...(!f.cobradoPor ? C.segOn : {}) }}>🏢 Empresa</button>
          {socios.map(s => <button key={s.id} onClick={() => set({ cobradoPor: s.id })} style={{ ...C.seg, ...(f.cobradoPor === s.id ? C.segOn : {}) }}><Dot c={s.color} /> {s.nombre}</button>)}
        </div>
        {socios.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>Añade socios en la pestaña Socios para poder elegirlos aquí.</div>}
        {f.cobradoPor && (
          <label style={{ ...C.toggleRow, marginBottom: 8 }}><span>Ya lo ha entregado a la caja del evento</span>
            <button onClick={() => set({ entregado: !f.entregado })} style={{ ...C.switch, background: f.entregado ? "var(--green)" : "var(--line)" }}><span style={{ ...C.knob, transform: f.entregado ? "translateX(20px)" : "translateX(2px)" }} /></button></label>
        )}
        <div style={{ height: 6 }} />

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <div>
            <div style={C.label}>Estado</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => set({ estado: "cobrado" })} style={{ ...C.seg, flex: 1, ...(f.estado === "cobrado" ? C.segOn : {}) }}>✅ Cobrado</button>
              <button onClick={() => set({ estado: "pendiente" })} style={{ ...C.seg, flex: 1, ...(f.estado === "pendiente" ? { ...C.segOn, background: "var(--amber)", borderColor: "var(--amber)", color: "#1a1205" } : {}) }}>⏳ Pendiente</button>
            </div>
          </div>
          <div>
            <div style={C.label}>Fecha</div>
            <input type="date" value={f.fecha} onChange={e => set({ fecha: e.target.value || hoy() })} style={C.input} />
          </div>
        </div>

        <div style={C.label}>Forma de cobro</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          {METODOS.map(([k, l]) => <button key={k} onClick={() => set({ metodo: k })} style={{ ...C.seg, ...(f.metodo === k ? C.segOn : {}) }}>{l}</button>)}
        </div>

        <div style={C.label}>Nota (opcional)</div>
        <textarea value={f.nota} maxLength={500} onChange={e => set({ nota: e.target.value })} rows={2} style={{ ...C.input, resize: "vertical", marginBottom: 16, fontFamily: "inherit" }} />

        <button disabled={!(imp > 0) || busy} onClick={guardar} style={{ ...C.primary, width: "100%", padding: 16, fontSize: 16, opacity: imp > 0 && !busy ? 1 : .45 }}>{busy ? "Guardando…" : imp > 0 ? `Guardar ${money(imp)}` : "Escribe el importe"}</button>
        {!nuevo && (confirmDel
          ? <div style={{ display: "flex", gap: 8, marginTop: 8 }}><button onClick={() => onDelete(f)} style={{ ...C.ghost, flex: 1, color: "var(--red)", borderColor: "var(--red)" }}>✓ Sí, borrar</button><button onClick={() => setConfirmDel(false)} style={{ ...C.ghost, flex: 1 }}>Cancelar</button></div>
          : <button onClick={() => setConfirmDel(true)} style={{ ...C.ghost, width: "100%", marginTop: 8, color: "var(--red)" }}>Borrar ingreso</button>)}
      </div>
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
          <div style={{ fontWeight: 900 }}>🤝 Socios en {ev.name}</div>
          <button onClick={iguales} disabled={!activos.length} style={C.small}>⚖️ A partes iguales</button>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>Marca quién participa en este evento y con qué porcentaje. Puede cambiar de un evento a otro.</div>
        {activos.length === 0 && <div style={C.empty}>Primero añade los socios aquí abajo.</div>}
        {activos.map(s => { const on = rep[s.id] != null; const tiene = T.enSocios[s.id] || 0; const pago = (G?.pagadoSocio || {})[s.id] || 0; return (
          <div key={s.id} style={{ ...C.row, opacity: on ? 1 : .6 }}>
            <button onClick={() => toggle(s.id)} style={{ ...C.check, ...(on ? C.checkOn : {}) }} aria-label={on ? "Quitar del evento" : "Añadir al evento"}>{on ? "✓" : ""}</button>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800 }}><Dot c={s.color} />{s.nombre}</span>
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
              {participan.length === 0 ? "Nadie marcado" : Math.abs(suma - 100) < 0.01 ? `✓ Suma 100%` : `⚠️ Suma ${String(suma).replace(".", ",")}% (debe ser 100%)`}
            </span>
            <button onClick={guardarReparto} disabled={busy || !cambiado || (participan.length > 0 && Math.abs(suma - 100) >= 0.01)} style={{ ...C.primary, opacity: busy || !cambiado || (participan.length > 0 && Math.abs(suma - 100) >= 0.01) ? .45 : 1 }}>Guardar reparto</button>
          </div>
        )}
      </div>

      {/* Socios de la cuenta */}
      <div style={C.panel}>
        <div style={{ fontWeight: 900, marginBottom: 4 }}>👥 Socios de la cuenta</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>Se crean una vez y se eligen en cada evento.</div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr auto", gap: 8, marginBottom: 12 }}>
          <input value={nuevo.nombre} maxLength={80} onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })} placeholder="Nombre del socio" style={C.input} onKeyDown={e => { if (e.key === "Enter" && nuevo.nombre.trim()) { onGuardarSocio({ ...nuevo, color: color() }); setNuevo({ nombre: "", telefono: "" }); } }} />
          <input value={nuevo.telefono} maxLength={30} inputMode="tel" onChange={e => setNuevo({ ...nuevo, telefono: e.target.value })} placeholder="Teléfono (opcional)" style={C.input} />
          <button disabled={!nuevo.nombre.trim() || busy} onClick={() => { onGuardarSocio({ ...nuevo, color: color() }); setNuevo({ nombre: "", telefono: "" }); }} style={{ ...C.primary, opacity: nuevo.nombre.trim() ? 1 : .45 }}>＋ Añadir</button>
        </div>
        {activos.map(s => (
          <div key={s.id} style={C.row}>
            {edit?.id === s.id ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", width: "100%" }}>
                <input autoFocus value={edit.nombre} maxLength={80} onChange={e => setEdit({ ...edit, nombre: e.target.value })} style={{ ...C.input, flex: "1 1 160px" }} />
                <input value={edit.telefono} maxLength={30} onChange={e => setEdit({ ...edit, telefono: e.target.value })} placeholder="Teléfono" style={{ ...C.input, flex: "1 1 140px" }} />
                <div style={{ display: "flex", gap: 4 }}>{COLORES.map(c => <button key={c} onClick={() => setEdit({ ...edit, color: c })} style={{ width: 26, height: 26, borderRadius: "50%", background: c, border: edit.color === c ? "3px solid #fff" : "2px solid transparent" }} aria-label="Color" />)}</div>
                <button onClick={() => { if (edit.nombre.trim()) { onGuardarSocio(edit); setEdit(null); } }} style={{ ...C.small, color: "var(--green)", borderColor: "var(--green)" }}>Guardar</button>
                <button onClick={() => setEdit(null)} style={C.small}>✗</button>
              </div>
            ) : (<>
              <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}><Dot c={s.color} /><b>{s.nombre}</b>{s.telefono && <a href={`tel:${s.telefono.replace(/[^\d+]/g, "")}`} style={{ color: "var(--muted)", fontSize: 12.5 }}>{s.telefono}</a>}</span>
              <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button onClick={() => setEdit({ ...s })} style={C.small}>✏️</button>
                <button onClick={() => onActivo(s, false)} style={{ ...C.small, color: "var(--muted)" }}>Quitar</button>
              </span>
            </>)}
          </div>
        ))}
        {inactivos.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <button onClick={() => setVerInactivos(v => !v)} style={{ ...C.small, color: "var(--muted)" }}>{verInactivos ? "Ocultar" : "Ver"} socios quitados ({inactivos.length})</button>
            {verInactivos && inactivos.map(s => <div key={s.id} style={{ ...C.row, opacity: .6 }}><span style={{ display: "flex", alignItems: "center", gap: 8 }}><Dot c={s.color} />{s.nombre}</span><button onClick={() => onActivo(s, true)} style={C.small}>Recuperar</button></div>)}
          </div>
        )}
      </div>
    </div>
  );
}


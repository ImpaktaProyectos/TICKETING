// ===================== ⚡ ATAJOS RÁPIDOS (pantalla de inicio, con PIN de administrador) =====================
// Lo que se hace a menudo, sin entrar en el TPV ni en el CRM. Cada atajo guarda las cosas en su sitio:
//   · Gasto del evento → gasto del CRM (y, si se paga de una caja, movimiento de esa caja enlazado)
//   · Dinero de un socio → su cuenta de cambio (y, si entra en una caja, «meter cambio» en esa caja)
//   · Añadir cambio → movimiento de la caja elegida (con el socio que lo pone, si es el caso)
//   · Pagos del evento → lista de gastos del CRM para ir marcando ✓ pagado (igual que en el CRM)
import React, { useEffect, useMemo, useState } from "react";
import * as crm from "./crm/crmdb";
import * as sd from "./socioDeudas";
import { GCATS } from "./crm/categorias";
import { resCfg } from "./reservados";
import { aplicarCaja, categoriaTPV } from "./gastosPrevistos";

const money = (v) => (Number(v) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR", useGrouping: "always" });
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const num = (t) => { const v = parseFloat(String(t || "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(v) ? r2(v) : 0; };
const P = (d, s = 22) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}><path d={d} /></svg>;
const ICO = { gasto: "M4 7h16v12H4zM4 11h16M8 15h3", socio: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0", cambio: "M12 5v14M5 12h14", pagos: "M5 12l4 4 10-10", atras: "M15 6l-6 6 6 6", x: "M6 6l12 12M18 6L6 18", foto: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" };

const K = {
  wrap: { position: "fixed", inset: 0, zIndex: 120, background: "var(--bg)", color: "var(--text)", display: "flex", flexDirection: "column" },
  head: { display: "flex", alignItems: "center", gap: 10, padding: "max(12px, env(safe-area-inset-top)) 16px 12px", borderBottom: "1px solid var(--line)", background: "var(--surface)" },
  body: { flex: 1, overflow: "auto", WebkitOverflowScrolling: "touch", padding: 16 },
  inner: { maxWidth: 620, margin: "0 auto" },
  icoBtn: { width: 44, height: 44, borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", display: "grid", placeItems: "center", cursor: "pointer", flexShrink: 0 },
  tile: { display: "flex", alignItems: "center", gap: 14, width: "100%", textAlign: "left", padding: 16, borderRadius: 16, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--text)", cursor: "pointer", font: "inherit" },
  label: { fontSize: 12, color: "var(--muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: .8, margin: "14px 0 6px" },
  input: { width: "100%", boxSizing: "border-box", padding: "13px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontSize: 16, font: "inherit" },
  chip: (on, c = "var(--accent)") => ({ padding: "10px 13px", borderRadius: 12, border: `1px solid ${on ? c : "var(--line)"}`, background: on ? c : "var(--surface2)", color: on ? "#0b0c10" : "var(--text)", fontWeight: 800, fontSize: 14, cursor: "pointer" }),
  primary: { width: "100%", minHeight: 54, borderRadius: 14, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 900, fontSize: 16.5, cursor: "pointer", marginTop: 18 },
  nota: { fontSize: 13, color: "var(--muted)", lineHeight: 1.45, marginTop: 8 },
};

export function Atajos({ ev, gastosCaja = [], flash, onMovimiento, onCerrar }) {
  const [vista, setVista] = useState(null);   // null · gasto · socio · cambio · pagos
  const titulos = { gasto: "Registrar un gasto", socio: "Dinero que pone un socio", cambio: "Añadir cambio a una caja", pagos: "Pagos del evento" };
  const atajos = [
    ["gasto", ICO.gasto, "Registrar un gasto", "Fotógrafo, camarero, hielo… Se apunta en el CRM; si lo pagas de una caja, también sale de ella", "#f59e0b"],
    ["socio", ICO.socio, "Dinero que pone un socio", "Queda apuntado que hay que devolvérselo. Puede entrar en una caja como cambio", "#3b82f6"],
    ["cambio", ICO.cambio, "Añadir cambio a una caja", "Elige a qué barra va. Cuenta en su cierre Z", "#22d3a6"],
    ["pagos", ICO.pagos, "Pagos del evento", "Ve tachando ✓ lo que ya está pagado (igual que en el CRM)", "#a855f7"],
  ];
  return (
    <div role="dialog" aria-modal="true" aria-label="Atajos rápidos" style={K.wrap}>
      <header style={K.head}>
        <button onClick={() => vista ? setVista(null) : onCerrar()} aria-label={vista ? "Volver a los atajos" : "Cerrar"} style={K.icoBtn}>{P(vista ? ICO.atras : ICO.x, 20)}</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: 18 }}>{vista ? titulos[vista] : "⚡ Atajos rápidos"}</div>
          <div style={{ fontSize: 13, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.name}</div>
        </div>
      </header>
      <div style={K.body}><div style={K.inner}>
        {!vista && <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {atajos.map(([k, ico, t, d, c]) => (
            <button key={k} onClick={() => setVista(k)} style={K.tile}>
              <span style={{ width: 50, height: 50, borderRadius: 14, display: "grid", placeItems: "center", background: `color-mix(in srgb, ${c} 18%, transparent)`, color: c }}>{P(ico, 24)}</span>
              <span style={{ flex: 1, minWidth: 0 }}><b style={{ display: "block", fontSize: 16.5 }}>{t}</b><span style={{ display: "block", fontSize: 13, color: "var(--muted)", marginTop: 2 }}>{d}</span></span>
            </button>))}
          <div style={K.nota}>Todo se guarda en el evento <b style={{ color: "var(--text)" }}>{ev.name}</b>. Para otro evento, cámbialo en la pantalla de inicio.</div>
        </div>}
        {vista === "gasto" && <FormGasto ev={ev} flash={flash} onMovimiento={onMovimiento} onHecho={() => setVista(null)} />}
        {vista === "socio" && <FormSocio ev={ev} flash={flash} onMovimiento={onMovimiento} onHecho={() => setVista(null)} />}
        {vista === "cambio" && <FormCambio ev={ev} flash={flash} onMovimiento={onMovimiento} onHecho={() => setVista(null)} />}
        {vista === "pagos" && <Pagos ev={ev} gastosCaja={gastosCaja} flash={flash} />}
      </div></div>
    </div>
  );
}

const estadoBarra = (p) => p.estado === "abierta" ? ["Abierta", "var(--green)"] : p.estado === "cerrada" ? ["Cerrada", "var(--red)"] : ["Modo prueba", "var(--amber)"];
function ElegirBarra({ ev, valor, onChange, opcional, txtNo = "Ninguna" }) {
  return (
    <div role="radiogroup" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {opcional && <button role="radio" aria-checked={!valor} onClick={() => onChange("")} style={{ ...K.chip(!valor), textAlign: "left" }}>{txtNo}</button>}
      {ev.puntos.map(p => { const [t, c] = estadoBarra(p); const on = valor === p.id; return (
        <button key={p.id} role="radio" aria-checked={on} onClick={() => onChange(p.id)} style={{ ...K.chip(on), display: "flex", alignItems: "center", gap: 10, textAlign: "left" }}>
          <span style={{ flex: 1 }}>{p.name}</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: on ? "#0b0c10" : c }}>● {t}{p.fondo != null && p.estado === "abierta" ? ` · fondo ${money(p.fondo)}` : ""}</span>
        </button>); })}
      {!ev.puntos.length && <div style={K.nota}>Este evento no tiene barras.</div>}
    </div>);
}
const avisoBarra = (ev, id) => { const p = ev.puntos.find(x => x.id === id); return p && p.estado !== "abierta" ? <div style={{ ...K.nota, color: "var(--amber)", fontWeight: 700 }}>{p.name} no está abierta: el movimiento contará en su próximo cierre Z.</div> : null; };
function Importe({ valor, onChange, auto }) {
  return <input value={valor} inputMode="decimal" autoFocus={auto} onChange={e => onChange(e.target.value.replace(/[^\d.,]/g, "").slice(0, 10))} placeholder="0,00 €" aria-label="Importe" style={{ ...K.input, fontSize: 28, fontWeight: 900, textAlign: "center" }} />;
}
function SociosChips({ ev, valor, onChange, conNo }) {
  const nombres = resCfg(ev).socios.map(x => String(x.nombre || "").trim()).filter(Boolean);
  return (<>
    {(nombres.length > 0 || conNo) && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: conNo ? 0 : 8 }}>
      {conNo && <button onClick={() => onChange("")} aria-pressed={!valor} style={K.chip(!valor, "var(--green)")}>No</button>}
      {nombres.map(n => <button key={n} onClick={() => onChange(n)} aria-pressed={valor === n} style={K.chip(valor === n, "var(--green)")}>{n}</button>)}
    </div>}
    {!conNo && <input value={valor} maxLength={60} onChange={e => onChange(e.target.value)} placeholder="Nombre del socio" aria-label="Socio" style={K.input} />}
  </>);
}

/* ---------- Gasto del evento ---------- */
function FormGasto({ ev, flash, onMovimiento, onHecho }) {
  const [x, setX] = useState({ concepto: "", proveedor: "", importe: "", categoria: "Personal", pago: "pendiente", barra: "", foto: null });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setX(o => ({ ...o, [k]: v }));
  const imp = num(x.importe);
  const listo = x.concepto.trim() && imp > 0 && (x.pago !== "caja" || x.barra);
  const guardar = async () => {
    if (!listo || busy) return;
    setBusy(true);
    try {
      const g = await crm.saveGasto({ eventoId: ev.id, tipo: "normal", categoria: x.categoria, concepto: x.concepto.trim(), proveedor: x.proveedor.trim(), previsto: imp, real: x.pago === "pagado" ? imp : null, estado: x.pago === "pagado" ? "pagado" : "previsto" });
      if (x.foto) { try { const { subirFotoGasto } = await import("./fotosGasto"); await crm.setGastoArchivo(g.id, await subirFotoGasto(ev.id, g.id, x.foto)); } catch (e) { flash(e?.mostrar ? `Gasto guardado, pero la foto no: ${e.message}` : "Gasto guardado, pero la foto no se ha subido", "warn"); } }
      if (x.pago === "caja") {
        const ok = await onMovimiento(x.barra, imp, `${x.proveedor.trim() ? x.proveedor.trim() + " · " : ""}${x.concepto.trim()}`.slice(0, 120), "gasto", categoriaTPV(g), g.id, { puntoId: x.barra, por: "Admin" });
        if (!ok) { flash("El gasto está en el CRM, pero no ha salido de la caja: hazlo desde 💰 Caja", "warn"); setBusy(false); return; }
      } else flash(`💸 ${x.concepto.trim()} · ${money(imp)} apuntado en el CRM${x.pago === "pagado" ? " como pagado" : ""}`);
      onHecho();
    } catch (e) { flash(navigator.onLine ? "No se ha podido guardar el gasto" : "Sin conexión: los gastos del CRM necesitan internet", "warn"); }
    setBusy(false);
  };
  return (<>
    <div style={K.label}>¿Qué es?</div>
    <input value={x.concepto} maxLength={160} autoFocus onChange={e => set("concepto", e.target.value)} placeholder="Camarero, fotógrafo, hielo…" style={K.input} />
    <input value={x.proveedor} maxLength={120} onChange={e => set("proveedor", e.target.value)} placeholder="¿A quién? (opcional): Javi, Sonidos del Sur…" style={{ ...K.input, marginTop: 8 }} />
    <div style={K.label}>Importe</div>
    <Importe valor={x.importe} onChange={v => set("importe", v)} />
    <div style={K.label}>Categoría</div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{GCATS.filter(c => c.k !== "Otros").concat(GCATS.filter(c => c.k === "Otros")).map(c => <button key={c.k} onClick={() => set("categoria", c.k)} aria-pressed={x.categoria === c.k} style={{ ...K.chip(x.categoria === c.k, c.c), padding: "8px 11px", fontSize: 13 }}>{c.k}</button>)}</div>
    <div style={K.label}>¿Está pagado?</div>
    <div role="radiogroup" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 6 }}>
      {[["pendiente", "Aún no"], ["pagado", "Sí, pagado"], ["caja", "Lo pago de una caja"]].map(([k, t]) => <button key={k} role="radio" aria-checked={x.pago === k} onClick={() => set("pago", k)} style={{ ...K.chip(x.pago === k, k === "pendiente" ? "var(--muted)" : "var(--green)"), padding: "11px 6px", fontSize: 13.5 }}>{t}</button>)}
    </div>
    {x.pago === "caja" && <>
      <div style={K.label}>¿De qué caja sale?</div>
      <ElegirBarra ev={ev} valor={x.barra} onChange={v => set("barra", v)} />
      {avisoBarra(ev, x.barra)}
      <div style={K.nota}>Sale del cajón de esa barra (cuenta en su cierre Z) y en el CRM queda pagado con este importe.</div>
    </>}
    <div style={K.label}>Foto de la factura o del ticket (opcional)</div>
    <label style={{ ...K.chip(!!x.foto, "var(--green)"), display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>{P(ICO.foto, 20)}<span style={{ flex: 1 }}>{x.foto ? `📷 ${x.foto.name || "Foto"} · cambiar` : "Hacer foto o subir"}</span>
      <input type="file" accept="image/*,application/pdf" capture="environment" style={{ display: "none" }} onChange={e => { set("foto", e.target.files?.[0] || null); e.target.value = ""; }} /></label>
    <button onClick={guardar} disabled={!listo || busy} style={{ ...K.primary, opacity: listo && !busy ? 1 : .45 }}>{busy ? "Guardando…" : listo ? (x.pago === "caja" ? `Pagar ${money(imp)} desde ${ev.puntos.find(p => p.id === x.barra)?.name || "la caja"}` : `Guardar gasto · ${money(imp)}`) : "Escribe qué es y el importe"}</button>
  </>);
}

/* ---------- Dinero que pone un socio ---------- */
function FormSocio({ ev, flash, onMovimiento, onHecho }) {
  const [x, setX] = useState({ socio: "", importe: "", concepto: "", barra: "" });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setX(o => ({ ...o, [k]: v }));
  const imp = num(x.importe), listo = x.socio.trim() && imp > 0;
  const guardar = async () => {
    if (!listo || busy) return; setBusy(true);
    const concepto = x.concepto.trim() || (x.barra ? `Cambio de ${x.socio.trim()}` : "Dinero adelantado");
    if (x.barra) { const ok = await onMovimiento(x.barra, imp, concepto, "entrada", "", null, { puntoId: x.barra, aportSocio: x.socio.trim(), por: "Admin" }); setBusy(false); if (ok) onHecho(); return; }
    try { await sd.crearAportacion({ eventoId: ev.id, socio: x.socio.trim(), importe: imp, concepto, por: "Admin" }); flash(`Apuntado: hay que devolver ${money(imp)} a ${x.socio.trim()}`); onHecho(); }
    catch (e) { flash(e?.mostrar ? e.message : "No se ha podido guardar", "warn"); }
    setBusy(false);
  };
  return (<>
    <div style={K.label}>Socio</div>
    <SociosChips ev={ev} valor={x.socio} onChange={v => set("socio", v)} />
    <div style={K.label}>¿Cuánto pone?</div>
    <Importe valor={x.importe} onChange={v => set("importe", v)} />
    <div style={K.label}>Concepto (opcional)</div>
    <input value={x.concepto} maxLength={200} onChange={e => set("concepto", e.target.value)} placeholder="Cambio para las barras, pago al DJ…" style={K.input} />
    <div style={K.label}>¿Entra en una caja?</div>
    <ElegirBarra ev={ev} valor={x.barra} onChange={v => set("barra", v)} opcional txtNo="No, no entra en ninguna caja" />
    {avisoBarra(ev, x.barra)}
    <div style={K.nota}>No cuenta como ingreso ni como gasto: queda apuntado que hay que devolvérselo (CRM → Socios).{x.barra ? " Además entra en el cajón como cambio." : ""}</div>
    <button onClick={guardar} disabled={!listo || busy} style={{ ...K.primary, opacity: listo && !busy ? 1 : .45 }}>{busy ? "Guardando…" : listo ? `Apuntar ${money(imp)} de ${x.socio.trim()}` : "Elige el socio y el importe"}</button>
  </>);
}

/* ---------- Añadir cambio a una caja ---------- */
function FormCambio({ ev, flash, onMovimiento, onHecho }) {
  const [x, setX] = useState({ barra: ev.puntos.length === 1 ? ev.puntos[0].id : "", importe: "", socio: "", concepto: "" });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setX(o => ({ ...o, [k]: v }));
  const imp = num(x.importe), listo = x.barra && imp > 0;
  const barra = ev.puntos.find(p => p.id === x.barra);
  const guardar = async () => {
    if (!listo || busy) return; setBusy(true);
    const ok = await onMovimiento(x.barra, imp, x.concepto.trim() || (x.socio ? `Cambio de ${x.socio}` : "Más cambio"), "entrada", "", null, { puntoId: x.barra, por: "Admin", ...(x.socio ? { aportSocio: x.socio } : {}) });
    setBusy(false); if (ok) onHecho();
  };
  return (<>
    <div style={K.label}>¿A qué caja va?</div>
    <ElegirBarra ev={ev} valor={x.barra} onChange={v => set("barra", v)} />
    {avisoBarra(ev, x.barra)}
    <div style={K.label}>¿Cuánto cambio metes?</div>
    <Importe valor={x.importe} onChange={v => set("importe", v)} />
    {resCfg(ev).socios.length > 0 && <><div style={K.label}>¿Lo pone un socio? (hay que devolvérselo)</div><SociosChips ev={ev} valor={x.socio} onChange={v => set("socio", v)} conNo /></>}
    <input value={x.concepto} maxLength={120} onChange={e => set("concepto", e.target.value)} placeholder="Concepto (opcional): monedas, billetes pequeños…" style={{ ...K.input, marginTop: 14 }} />
    <button onClick={guardar} disabled={!listo || busy} style={{ ...K.primary, background: "var(--green)", color: "#04231a", opacity: listo && !busy ? 1 : .45 }}>{busy ? "Guardando…" : listo ? `Meter ${money(imp)} en ${barra?.name}` : "Elige la caja y el importe"}</button>
  </>);
}

/* ---------- Pagos del evento: ir marcando ✓ ---------- */
function Pagos({ ev, gastosCaja, flash }) {
  const [lista, setLista] = useState(null);
  const [busy, setBusy] = useState(null);
  const cargar = () => crm.loadGastosEvento(ev.id).then(setLista).catch(() => setLista([]));
  useEffect(() => { cargar(); }, [ev.id]);
  const gastos = useMemo(() => aplicarCaja(lista || [], gastosCaja, ev.id), [lista, gastosCaja, ev.id]);
  const padres = new Set(gastos.filter(g => g.padreId).map(g => g.padreId));
  const filas = gastos.filter(g => !(padres.has(g.id) && !(Number(g.previsto) > 0) && g.real == null));
  const nombre = (g) => { const p = g.padreId ? gastos.find(x => x.id === g.padreId) : null; return `${p ? (p.proveedor || p.concepto) + " · " : ""}${g.proveedor || g.concepto || g.categoria}`; };
  const imp = (g) => g.real != null ? g.real : g.previsto || 0;
  const pagados = filas.filter(g => g.estado === "pagado");
  const pendiente = r2(filas.filter(g => g.estado !== "pagado").reduce((t, g) => t + imp(g), 0));
  const marcar = async (g, v) => { setBusy(g.id); try { await crm.setGastoPagado(g.id, v); await cargar(); } catch { flash("No se ha podido guardar", "warn"); } setBusy(null); };
  if (!lista) return <div style={K.nota}>Cargando…</div>;
  if (!filas.length) return <div style={K.nota}>Este evento no tiene gastos en el CRM. Apúntalos con «Registrar un gasto» o en CRM → Gastos.</div>;
  return (<>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
      <b style={{ fontSize: 15 }}>Pagados {pagados.length} de {filas.length}</b>
      <b style={{ color: pendiente ? "var(--amber)" : "var(--green)" }}>{pendiente ? `Falta pagar ${money(pendiente)}` : "Todo pagado ✓"}</b>
    </div>
    <div style={{ height: 8, borderRadius: 6, background: "var(--line)", overflow: "hidden", marginBottom: 12 }}><div style={{ height: "100%", width: `${pagados.length / filas.length * 100}%`, background: "var(--green)" }} /></div>
    {filas.slice().sort((a, b) => (a.estado === "pagado") - (b.estado === "pagado")).map(g => { const pag = g.estado === "pagado", caja = g.cajaPagado != null; return (
      <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderTop: "1px solid var(--line)" }}>
        <button onClick={() => !caja && marcar(g, !pag)} disabled={busy === g.id || caja} aria-pressed={pag} aria-label={pag ? `Quitar pagado de ${nombre(g)}` : `Marcar como pagado ${nombre(g)}`}
          style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, display: "grid", placeItems: "center", cursor: caja ? "default" : "pointer", border: `2px solid ${pag ? "var(--green)" : "var(--line)"}`, background: pag ? "var(--green)" : "transparent", color: "#04231a", opacity: busy === g.id ? .5 : 1 }}>{pag ? P(ICO.pagos, 20) : null}</button>
        <span style={{ flex: 1, minWidth: 0 }}>
          <b style={{ display: "block", fontSize: 15, textDecoration: pag ? "line-through" : "none", color: pag ? "var(--muted)" : "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nombre(g)}</b>
          <span style={{ display: "block", fontSize: 12.5, color: caja ? "var(--green)" : "var(--muted)" }}>{caja ? "Pagado desde la caja del TPV" : g.categoria}{g.archivoPath ? " · 📷" : ""}</span>
        </span>
        <b style={{ flexShrink: 0, color: pag ? "var(--green)" : "var(--text)" }}>{money(imp(g))}</b>
      </div>); })}
  </>);
}

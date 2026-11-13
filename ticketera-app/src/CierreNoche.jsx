// ===================== TPV · CIERRE DE LA NOCHE =====================
// Vista clara de lo que ha entrado y salido esta noche (con PDF) y del dinero que tienen los socios,
// con el botón para confirmar cuando lo han devuelto.
import React, { useEffect, useMemo, useState } from "react";
import { resumenNoche } from "./cierreNocheCalc";
import * as sd from "./socioDeudas";

const money = (v) => (Number(v) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR", useGrouping: "always" });
const hora = (ts) => ts ? new Date(ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "";
const fechaHora = (v) => v ? new Date(v).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
const P = (d) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}><path d={d} /></svg>;
const ICO = { pdf: "M12 4v12M7 11l5 5 5-5M5 20h14", ok: "M5 12l4 4 10-10", chev: "M6 9l6 6 6-6", user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" };

const K = {
  panel: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 16, marginBottom: 16 },
  tile: { background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 14, padding: "12px 14px", minWidth: 0 },
  label: { fontSize: 12, color: "var(--muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: .8 },
  btn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, minHeight: 44, padding: "0 16px", borderRadius: 12, fontWeight: 800, fontSize: 14, cursor: "pointer", border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)" },
  bar: { height: 10, borderRadius: 6, background: "var(--line)", overflow: "hidden" },
};

export function CierreNoche({ ev, evSales, evGastos, res, role, flash }) {
  const [devs, setDevs] = useState([]);
  const [devError, setDevError] = useState(false);
  const [abierta, setAbierta] = useState(null);      // categoría de gasto desplegada
  const [confirmar, setConfirmar] = useState(null);  // { socio, items, total }
  const [busy, setBusy] = useState(false);
  const [pdf, setPdf] = useState(false);
  const puedeConfirmar = role === "admin" || role === "supervisor";
  const quien = role === "admin" ? "Admin" : role === "supervisor" ? "Supervisor" : "Caja";

  const [aports, setAports] = useState(null);       // cambio que han puesto los socios (null = sin tabla aún)
  const cargarDevs = async () => {
    try { setDevs(await sd.loadDevoluciones(ev.id)); setDevError(false); } catch { setDevError(true); }
    sd.loadAportaciones(ev.id).then(setAports).catch(() => {});
  };
  useEffect(() => { setDevs([]); setAports(null); cargarDevs(); const t = setInterval(cargarDevs, 60000); return () => clearInterval(t); }, [ev.id]);

  const R = useMemo(() => resumenNoche({ ev, sales: evSales, gastos: evGastos, reservados: res?.reservados || [], devoluciones: devs, aportaciones: aports || [] }), [ev, evSales, evGastos, res?.reservados, devs, aports]);
  const I = R.ingresos, G = R.gastos;
  const maxBarra = Math.max(1, ...I.porBarra.map(b => b.total));
  const maxCat = Math.max(1, ...G.porCategoria.map(c => c.total));

  const descargar = async () => {
    setPdf(true);
    try {
      const { pdfCierreNoche } = await import("./cierreNochePdf");
      const doc = pdfCierreNoche(R, ev);
      const nombre = `Cierre_${String(ev.name || "evento").replace(/[^\p{L}\p{N}]+/gu, "_")}_${ev.date || ""}.pdf`.replace(/_+/g, "_");
      const u = URL.createObjectURL(doc.output("blob"));
      const a = document.createElement("a"); a.href = u; a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
      flash("📄 PDF del cierre descargado");
    } catch { flash("No se ha podido crear el PDF", "warn"); } finally { setPdf(false); }
  };
  const devolver = async ({ socio, items }) => {
    setBusy(true);
    try { await sd.confirmarDevolucion(ev.id, items, quien); await cargarDevs(); setConfirmar(null); flash(`✓ ${socio} ha devuelto ${money(items.reduce((t, x) => t + x.pendiente, 0))}`); }
    catch { flash(navigator.onLine ? "No se ha podido guardar la devolución" : "Sin conexión: conéctate para confirmar la devolución", "warn"); }
    finally { setBusy(false); }
  };
  const deshacer = async (it) => {
    setBusy(true);
    try { await sd.deshacerDevolucion(ev.id, it.clave); await cargarDevs(); flash("Devolución deshecha: vuelve a estar pendiente", "warn"); }
    catch { flash("No se ha podido deshacer", "warn"); } finally { setBusy(false); }
  };

  const kpis = [
    ["Ingresos", money(I.total), `${I.tickets} tickets`, "var(--green)"],
    ["Gastos", money(G.total), G.n ? `${G.n} ${G.n === 1 ? "gasto" : "gastos"}` : "ninguno", G.total ? "var(--amber)" : "var(--text)"],
    ["Resultado", money(R.resultado), "ingresos − gastos", R.resultado >= 0 ? "var(--green)" : "var(--red)"],
    ["Deben los socios", money(R.sociosPendiente), R.sociosPendiente > 0 ? "por reponer en caja" : "nada pendiente", R.sociosPendiente > 0 ? "var(--amber)" : "var(--green)"],
  ];
  const pctEf = I.total ? I.efectivo / I.total * 100 : 0, pctTa = I.total ? I.tarjeta / I.total * 100 : 0;

  return (
    <section aria-labelledby="cierre-noche-t" style={{ ...K.panel, borderColor: "color-mix(in srgb, var(--accent) 35%, var(--line))" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          <h3 id="cierre-noche-t" style={{ margin: 0, fontSize: 19, fontWeight: 900 }}>Cierre de la noche</h3>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>Todo lo que ha entrado y salido en el TPV, clasificado</div>
        </div>
        <button onClick={descargar} disabled={pdf} style={{ ...K.btn, background: "var(--accent)", borderColor: "var(--accent)", color: "#fff", opacity: pdf ? .6 : 1 }}>{P(ICO.pdf)}{pdf ? "Preparando…" : "Descargar PDF"}</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 16 }}>
        {kpis.map(([l, v, sub, c]) => <div key={l} style={K.tile}><div style={K.label}>{l}</div><div style={{ fontSize: 23, fontWeight: 900, color: c, marginTop: 4, letterSpacing: -.3 }}>{v}</div><div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{sub}</div></div>)}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 14 }}>
        {/* ---------- Ingresos ---------- */}
        <div style={K.tile}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 10 }}><b style={{ fontSize: 15.5 }}>Ingresos</b><b style={{ color: "var(--green)", fontSize: 16 }}>{money(I.total)}</b></div>
          {(I.efectivo > 0 || I.tarjeta > 0) && <>
            <div role="img" aria-label={`Efectivo ${money(I.efectivo)}, tarjeta ${money(I.tarjeta)}`} style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden", background: "var(--line)" }}>
              <div style={{ width: `${pctEf}%`, background: "var(--green)" }} /><div style={{ width: `${pctTa}%`, background: "#60a5fa" }} />
            </div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, margin: "8px 0 12px" }}>
              <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: "var(--green)", marginRight: 6 }} />Efectivo <b>{money(I.efectivo)}</b></span>
              <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: "#60a5fa", marginRight: 6 }} />Tarjeta <b>{money(I.tarjeta)}</b></span>
              {I.sinMetodo > 0 && <span style={{ color: "var(--muted)" }}>Sin desglose <b>{money(I.sinMetodo)}</b></span>}
            </div>
          </>}
          {I.porBarra.length === 0 ? <div style={{ color: "var(--muted)", fontSize: 13.5, padding: "8px 0" }}>Aún no hay ventas esta noche.</div> : I.porBarra.map(b => (
            <div key={b.id} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13.5, marginBottom: 4 }}><span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.nombre} <span style={{ color: "var(--muted)" }}>· {b.tickets} tickets</span></span><b>{money(b.total)}</b></div>
              <div style={K.bar}><div style={{ height: "100%", width: `${b.total / maxBarra * 100}%`, background: "var(--green)", borderRadius: 6 }} /></div>
            </div>))}
          {(I.invitaciones.n > 0 || I.anuladas.n > 0) && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
            {I.invitaciones.n > 0 && <>Invitaciones: {I.invitaciones.n} ({money(I.invitaciones.valor)}). </>}{I.anuladas.n > 0 && <>Anuladas: {I.anuladas.n} ({money(I.anuladas.valor)}). </>}No suman.</div>}
        </div>

        {/* ---------- Gastos por categoría ---------- */}
        <div style={K.tile}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 10 }}><b style={{ fontSize: 15.5 }}>Gastos por categoría</b><b style={{ color: G.total ? "var(--amber)" : "var(--muted)", fontSize: 16 }}>{money(G.total)}</b></div>
          {G.porCategoria.length === 0 ? <div style={{ color: "var(--muted)", fontSize: 13.5, padding: "8px 0" }}>Sin gastos de caja esta noche. Se apuntan desde el botón 💰 Caja de cada barra.</div> : G.porCategoria.map(c => { const on = abierta === c.k; return (
            <div key={c.k} style={{ borderTop: "1px solid var(--line)" }}>
              <button onClick={() => setAbierta(on ? null : c.k)} aria-expanded={on} style={{ width: "100%", background: "transparent", border: "none", color: "var(--text)", cursor: "pointer", padding: "10px 0", textAlign: "left", font: "inherit" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: c.c, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, fontWeight: 800 }}>{c.t}{c.noGasto && <span style={{ fontWeight: 600, color: "var(--muted)" }}> · no es gasto</span>} <span style={{ fontWeight: 600, color: "var(--muted)" }}>· {c.n}</span></span>
                  <b>{money(c.total)}</b>
                  <span style={{ color: "var(--muted)", transform: on ? "rotate(180deg)" : "none", transition: "transform .15s", display: "flex" }}>{P(ICO.chev)}</span>
                </div>
                <div style={{ ...K.bar, height: 8, marginTop: 6 }}><div style={{ height: "100%", width: `${c.total / maxCat * 100}%`, background: c.c, borderRadius: 6, opacity: c.noGasto ? .5 : 1 }} /></div>
              </button>
              {on && <div style={{ paddingBottom: 8 }}>{c.items.map(g => (
                <div key={g.id} style={{ display: "flex", gap: 8, fontSize: 13, padding: "5px 0 5px 18px" }}>
                  <span style={{ color: "var(--muted)", flexShrink: 0 }}>{hora(g.ts)}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>{g.concepto || c.t} <span style={{ color: "var(--muted)" }}>· {g.barra}{g.por && g.por !== g.barra ? ` · ${g.por}` : ""}</span></span>
                  <b style={{ flexShrink: 0 }}>{money(g.importe)}</b>
                </div>))}</div>}
            </div>); })}
          {G.cambio > 0 && <div style={{ borderTop: "1px solid var(--line)", paddingTop: 8, fontSize: 13, display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--muted)" }}>Cambio añadido a las cajas</span><b style={{ color: "var(--green)" }}>+{money(G.cambio)}</b></div>}
        </div>
      </div>

      {/* ---------- Dinero de los socios ---------- */}
      <div style={{ ...K.tile, marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
          <b style={{ fontSize: 15.5 }}>Dinero que tienen los socios</b>
          <b style={{ color: R.sociosPendiente > 0 ? "var(--amber)" : "var(--green)", fontSize: 16 }}>{R.sociosPendiente > 0 ? `Deben ${money(R.sociosPendiente)}` : "Nada pendiente"}</b>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>Señales de reservados que ha cobrado un socio y ventas sin ticket en efectivo. Cuando lo reponga en la caja, confírmalo y su deuda desaparece (también en el CRM).</div>
        {devError && <div style={{ fontSize: 12.5, color: "var(--amber)", fontWeight: 700, marginBottom: 8 }}>Sin conexión: no se ven las devoluciones ya confirmadas.</div>}
        {R.socios.length === 0 ? <div style={{ color: "var(--muted)", fontSize: 13.5, padding: "6px 0" }}>Ningún socio tiene dinero de esta noche. Para apuntarlo, en la ficha del reservado elige qué socio tiene la señal.</div>
          : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 10 }}>{R.socios.map(s => { const pend = s.items.filter(it => it.pendiente > 0); return (
            <div key={s.socio} style={{ background: "var(--surface)", border: `1px solid ${s.pendiente > 0 ? "color-mix(in srgb, var(--amber) 50%, var(--line))" : "var(--line)"}`, borderRadius: 12, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 32, height: 32, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--surface2)", color: s.pendiente > 0 ? "var(--amber)" : "var(--green)" }}>{P(ICO.user)}</span>
                <b style={{ flex: 1, minWidth: 0, fontSize: 15.5 }}>{s.socio}</b>
                <span style={{ textAlign: "right" }}><b style={{ display: "block", fontSize: 18, color: s.pendiente > 0 ? "var(--amber)" : "var(--green)" }}>{s.pendiente > 0 ? money(s.pendiente) : "✓"}</b><span style={{ fontSize: 11.5, color: "var(--muted)" }}>{s.pendiente > 0 ? "debe" : `devuelto ${money(s.devuelto)}`}</span></span>
              </div>
              <div style={{ marginTop: 8 }}>{s.items.map(it => (
                <div key={it.clave} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "7px 0", borderTop: "1px solid var(--line)" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>{it.concepto}{it.pendiente <= 0 && <span style={{ display: "block", fontSize: 11.5, color: "var(--green)", fontWeight: 700 }}>Devuelto {fechaHora(it.devueltoEn)}{it.devueltoPor ? ` · ${it.devueltoPor}` : ""}</span>}{it.pendiente > 0 && it.devuelto > 0 && <span style={{ display: "block", fontSize: 11.5, color: "var(--amber)" }}>Devolvió {money(it.devuelto)}: falta {money(it.pendiente)}</span>}</span>
                  <b style={{ flexShrink: 0, color: it.pendiente > 0 ? "var(--text)" : "var(--muted)", textDecoration: it.pendiente > 0 ? "none" : "line-through" }}>{money(it.importe)}</b>
                  {puedeConfirmar && (it.pendiente > 0
                    ? <button onClick={() => setConfirmar({ socio: s.socio, items: [it] })} disabled={busy} aria-label={`Confirmar que ${s.socio} ha devuelto ${money(it.pendiente)}`} style={{ ...K.btn, minHeight: 36, padding: "0 10px", fontSize: 12.5, color: "var(--green)", borderColor: "var(--green)" }}>{P(ICO.ok)}Devuelto</button>
                    : role === "admin" && <button onClick={() => deshacer(it)} disabled={busy} style={{ ...K.btn, minHeight: 36, padding: "0 10px", fontSize: 12, color: "var(--muted)" }}>Deshacer</button>)}
                </div>))}</div>
              {puedeConfirmar && pend.length > 1 && <button onClick={() => setConfirmar({ socio: s.socio, items: pend })} disabled={busy} style={{ ...K.btn, width: "100%", marginTop: 8, background: "var(--green)", borderColor: "var(--green)", color: "#04231a" }}>{P(ICO.ok)}Ha devuelto todo · {money(s.pendiente)}</button>}
            </div>); })}</div>}
        {!puedeConfirmar && R.sociosPendiente > 0 && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Las devoluciones las confirma un administrador o supervisor.</div>}
      </div>

      {/* ---------- Cambio que han puesto los socios (hay que devolvérselo) ---------- */}
      {aports && R.cambioSocios.length > 0 && (
        <div style={{ ...K.tile, marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <b style={{ fontSize: 15.5 }}>Cambio que han puesto los socios</b>
            <b style={{ color: R.cambioPendiente > 0 ? "#60a5fa" : "var(--green)", fontSize: 16 }}>{R.cambioPendiente > 0 ? `Hay que devolver ${money(R.cambioPendiente)}` : "Todo devuelto"}</b>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>No cuenta como ingreso ni como gasto. Se devuelve desde 💰 Caja → Sacar dinero → «Devolver cambio a un socio», o se marca en el CRM (Socios).</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 10 }}>
            {R.cambioSocios.map(s => (
              <div key={s.socio} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b>{s.socio}</b><b style={{ color: s.pendiente > 0 ? "#60a5fa" : "var(--green)" }}>{s.pendiente > 0 ? money(s.pendiente) : "✓"}</b></div>
                {s.items.map(a => <div key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, color: a.devueltoEn ? "var(--muted)" : "var(--text)", padding: "4px 0", borderTop: "1px solid var(--line)", marginTop: 4 }}>
                  <span style={{ minWidth: 0 }}>{a.concepto || "Cambio"}{a.devueltoEn ? ` · devuelto${a.devueltoDesde === "caja" ? " desde caja" : ""}` : ""}</span><span style={{ textDecoration: a.devueltoEn ? "line-through" : "none", flexShrink: 0 }}>{money(a.importe)}</span></div>)}
              </div>))}
          </div>
        </div>)}

      {confirmar && (
        <div role="dialog" aria-modal="true" aria-label="Confirmar devolución" onClick={() => !busy && setConfirmar(null)} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 18, padding: 20, width: "100%", maxWidth: 420 }}>
            <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>¿{confirmar.socio} ha devuelto el dinero?</div>
            <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 12 }}>Confírmalo cuando lo haya repuesto en la caja. Su deuda desaparece aquí y en el CRM.</div>
            {confirmar.items.map(it => <div key={it.clave} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13.5, padding: "5px 0", borderTop: "1px solid var(--line)" }}><span style={{ minWidth: 0 }}>{it.concepto}</span><b>{money(it.pendiente)}</b></div>)}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 17, fontWeight: 900, padding: "10px 0 14px", borderTop: "2px solid var(--line)" }}><span>Total</span><span style={{ color: "var(--green)" }}>{money(confirmar.items.reduce((t, x) => t + x.pendiente, 0))}</span></div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setConfirmar(null)} disabled={busy} style={{ ...K.btn, flex: 1 }}>Cancelar</button>
              <button onClick={() => devolver(confirmar)} disabled={busy} style={{ ...K.btn, flex: 1.5, background: "var(--green)", borderColor: "var(--green)", color: "#04231a" }}>{P(ICO.ok)}{busy ? "Guardando…" : "Sí, lo ha devuelto"}</button>
            </div>
          </div>
        </div>)}
    </section>
  );
}

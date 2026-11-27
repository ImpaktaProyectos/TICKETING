// ===================== PANEL TIXFAST · COMISIONES Y FACTURAS A ORGANIZADORES =====================
// · Comisión general (% y mínimo por entrada, IVA incluido) y pactos distintos con algún organizador.
// · Calculadora: cuánto se queda TIXFAST de verdad tras pagar a Stripe, para decidir el % y el mínimo.
// · Informe con lo que ha cobrado Stripe en cada pago (dato real) frente a la comisión.
// · Datos fiscales de TIXFAST: sin ellos las facturas a los organizadores quedan preparadas y salen al guardarlos.
import React, { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { comisionDe, costeStripe } from "./comision.js";

const eur = (v) => (Number(v) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
const num = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const coma = (v) => (v == null ? "" : String(v).replace(".", ","));
const MOTIVOS = { valores: "Algún número no es válido.", nif: "El NIF no es válido: solo letras y números.", serie: "La serie son de 1 a 4 letras.", sin_migracion: "Falta aplicar la migración de comisiones en la base de datos.", permiso: "No tienes permiso." };
const ESTADO_FAC = { emitida: ["Emitida", "var(--green)"], falta_emisor: ["Faltan los datos de TIXFAST", "var(--amber)"], falta_receptor: ["Faltan los datos del organizador", "var(--amber)"] };

const K = {
  card: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 14, boxSizing: "border-box" },
  input: { width: "100%", boxSizing: "border-box", minHeight: 46, padding: "0 12px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontSize: 16, font: "inherit" },
  btn: { minHeight: 44, padding: "0 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontWeight: 800, fontSize: 14, cursor: "pointer" },
  primario: { minHeight: 48, padding: "0 16px", borderRadius: 12, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 900, fontSize: 15, cursor: "pointer" },
  label: { fontSize: 12, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: .5, marginBottom: 4, display: "block" },
  titulo: { fontWeight: 900, fontSize: 16 },
  sub: { fontSize: 13, color: "var(--muted)", margin: "2px 0 12px", lineHeight: 1.45 },
  badge: (c) => ({ display: "inline-block", fontSize: 11.5, fontWeight: 900, color: c, border: `1px solid ${c}`, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }),
};
async function servidor(body) {
  const { data, error } = await supabase.functions.invoke("admin-plataforma", { body });
  if (error && !data) { let j = null; try { j = await error.context?.json?.(); } catch { /* nada */ } if (j && !j.ok) throw new Error(MOTIVOS[j.motivo] || "No se ha podido completar"); }
  if (!data?.ok) throw new Error(MOTIVOS[data?.motivo] || "No se ha podido completar");
  return data;
}
const Campo = ({ l, children }) => <label style={{ display: "block", minWidth: 0 }}><span style={K.label}>{l}</span>{children}</label>;
const Fila = ({ t, v, fuerte, c }) => <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "3px 0", fontWeight: fuerte ? 900 : 600, color: c || (fuerte ? "var(--text)" : "var(--muted)") }}><span style={{ minWidth: 0 }}>{t}</span><span style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{v}</span></div>;

export function Comisiones({ avisar }) {
  const [d, setD] = useState(null);
  const [a, setA] = useState(null);      // ajustes en edición
  const [busy, setBusy] = useState(false);
  const [precio, setPrecio] = useState("20");
  const cargar = () => servidor({ accion: "comisiones" }).then(x => { setD(x); setA(Object.fromEntries(Object.entries(x.ajustes || {}).map(([k, v]) => [k, typeof v === "number" || /^\d+(\.\d+)?$/.test(String(v ?? "")) ? coma(v) : v ?? ""]))); })
    .catch(e => setD({ error: e.message }));
  useEffect(() => { cargar(); }, []);
  if (!d) return <div style={{ color: "var(--muted)" }}>Cargando…</div>;
  if (d.error) return <div style={{ color: "var(--red)" }}>{d.error}</div>;

  const set = (k, v) => setA(x => ({ ...x, [k]: v }));
  const guardar = async () => {
    setBusy(true);
    try { const r = await servidor({ accion: "comisiones_guardar", ajustes: a }); avisar(r.emitidas ? `✓ Guardado · ${r.emitidas} facturas emitidas` : "✓ Guardado"); cargar(); }
    catch (e) { avisar(e.message, true); } finally { setBusy(false); }
  };
  // Calculadora con lo que hay escrito (sin guardar todavía)
  const T = { pct: num(a.comision_pct), min: num(a.comision_min), iva: num(a.iva) };
  const p = Math.max(0, num(precio));
  const com = comisionDe(p, 1, T), base = com / (1 + T.iva / 100);
  const stripe = costeStripe(p + com, num(a.stripe_pct), num(a.stripe_fijo));
  const margen = base - stripe;
  const ejemplos = [5, 10, 15, 20, 30, 50].map(x => { const c = comisionDe(x, 1, T); const m = c / (1 + T.iva / 100) - costeStripe(x + c, num(a.stripe_pct), num(a.stripe_fijo)); return { x, c, m }; });
  // Informe real
  const inf = d.informe || [];
  const tot = inf.reduce((t, e) => ({ n: t.n + (e.entradas || 0), com: t.com + num(e.comision), st: t.st + num(e.stripe), sin: t.sin + (e.stripe_sin_dato || 0) }), { n: 0, com: 0, st: 0, sin: 0 });
  const baseTot = tot.com / (1 + T.iva / 100);
  const pendientes = (d.facturas || []).filter(f => f.estado !== "emitida");

  return (<div style={{ display: "grid", gap: 12 }}>
    <section style={K.card}>
      <div style={K.titulo}>Comisión de TIXFAST</div>
      <div style={K.sub}>Se aplica a cada entrada de pago vendida online. IVA incluido. De aquí se paga Stripe. Los organizadores eligen en cada evento cuánto paga el comprador de gastos de gestión.</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        <Campo l="Comisión (%)"><input inputMode="decimal" value={a.comision_pct} onChange={e => set("comision_pct", e.target.value)} style={K.input} /></Campo>
        <Campo l="Mínimo por entrada (€)"><input inputMode="decimal" value={a.comision_min} onChange={e => set("comision_min", e.target.value)} style={K.input} /></Campo>
        <Campo l="IVA (%)"><input inputMode="decimal" value={a.iva} onChange={e => set("iva", e.target.value)} style={K.input} /></Campo>
        <Campo l="Stripe (%)"><input inputMode="decimal" value={a.stripe_pct} onChange={e => set("stripe_pct", e.target.value)} style={K.input} /></Campo>
        <Campo l="Stripe fijo (€)"><input inputMode="decimal" value={a.stripe_fijo} onChange={e => set("stripe_fijo", e.target.value)} style={K.input} /></Campo>
      </div>
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 12, cursor: "pointer", fontSize: 14, minHeight: 44 }}>
        <input type="checkbox" checked={a.comision_efectivo !== false} onChange={e => set("comision_efectivo", e.target.checked)} style={{ width: 22, height: 22, accentColor: "var(--accent)", flexShrink: 0 }} />
        <span><b>Cobrar también la comisión de las entradas que venden los RRPP en efectivo</b><br /><span style={{ color: "var(--muted)" }}>Se descuenta de lo cobrado online del evento; si no llega, sale en la factura como pendiente de pago.</span></span>
      </label>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>La tarifa de Stripe solo se usa en la calculadora. Lo que cobra de verdad se guarda en cada pago y sale en el informe de abajo.</div>
    </section>

    <section style={K.card}>
      <div style={K.titulo}>Calculadora: ¿cuánto nos queda?</div>
      <div style={K.sub}>Con lo que hay escrito arriba (aún sin guardar). Con los gastos recomendados el comprador paga la comisión.</div>
      <div style={{ maxWidth: 200 }}><Campo l="Precio de la entrada (€)"><input inputMode="decimal" value={precio} onChange={e => setPrecio(e.target.value)} style={K.input} /></Campo></div>
      <div style={{ marginTop: 10, fontSize: 14 }}>
        <Fila t="El comprador paga" v={eur(p + com)} />
        <Fila t="Comisión TIXFAST (IVA incl.)" v={eur(com)} />
        <Fila t="· IVA de la comisión (a Hacienda)" v={"−" + eur(com - base)} />
        <Fila t="· Stripe (estimado)" v={"−" + eur(stripe)} />
        <Fila t="Le queda a TIXFAST" v={eur(margen)} fuerte c={margen < 0 ? "var(--red)" : "var(--green)"} />
      </div>
      <div style={{ overflowX: "auto", marginTop: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, fontVariantNumeric: "tabular-nums" }}>
          <thead><tr style={{ color: "var(--muted)", textAlign: "right" }}><th style={{ textAlign: "left", padding: 4 }}>Entrada</th><th style={{ padding: 4 }}>Comisión</th><th style={{ padding: 4 }}>Nos queda</th></tr></thead>
          <tbody>{ejemplos.map(e => <tr key={e.x} style={{ borderTop: "1px solid var(--line)", textAlign: "right" }}><td style={{ textAlign: "left", padding: 4 }}>{eur(e.x)}</td><td style={{ padding: 4 }}>{eur(e.c)}</td><td style={{ padding: 4, fontWeight: 800, color: e.m < 0 ? "var(--red)" : "var(--text)" }}>{eur(e.m)}</td></tr>)}</tbody>
        </table>
      </div>
    </section>

    <section style={K.card}>
      <div style={K.titulo}>Lo cobrado y lo que se lleva Stripe (90 días · {d.modo === "real" ? "real" : "pruebas"})</div>
      {!inf.length ? <div style={{ ...K.sub, marginBottom: 0 }}>Aún no hay pagos con tarjeta.</div> : (<>
        <div style={{ fontSize: 14, marginTop: 8 }}>
          <Fila t="Entradas" v={tot.n} />
          <Fila t="Comisiones (IVA incl.)" v={eur(tot.com)} />
          <Fila t="Stripe (real)" v={"−" + eur(tot.st)} />
          <Fila t="Nos queda (sin IVA)" v={eur(baseTot - tot.st)} fuerte />
          {tot.sin > 0 && <div style={{ fontSize: 12.5, color: "var(--amber)" }}>{tot.sin} pagos aún sin el dato de Stripe (se completa al repartir).</div>}
        </div>
        <div style={{ display: "grid", gap: 6, marginTop: 10 }}>{inf.map(e => (
          <div key={e.evento_id} style={{ borderTop: "1px solid var(--line)", paddingTop: 8, fontSize: 13.5 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}><b style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.evento}</b>{e.factura && <span style={K.badge((ESTADO_FAC[e.factura.estado] || [])[1] || "var(--muted)")}>{e.factura.codigo || (ESTADO_FAC[e.factura.estado] || [])[0]}</span>}</div>
            <div style={{ color: "var(--muted)" }}>{e.entradas} entradas · comisión {eur(e.comision)}{Number(e.comision_efectivo) > 0 ? ` (${eur(e.comision_efectivo)} del efectivo)` : ""} · Stripe {e.stripe != null ? eur(e.stripe) : "—"}{Number(e.devuelto) > 0 ? ` · devuelto ${eur(e.devuelto)}` : ""}</div>
          </div>))}</div>
      </>)}
    </section>

    <section style={K.card}>
      <div style={K.titulo}>Datos fiscales de TIXFAST</div>
      <div style={K.sub}>Salen como emisor en las facturas de comisión. Mientras falten, las facturas quedan preparadas{pendientes.length ? ` (${pendientes.length} esperando)` : ""} y se emiten al guardar.</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
        <Campo l="Razón social"><input value={a.razon_social || ""} onChange={e => set("razon_social", e.target.value)} style={K.input} /></Campo>
        <Campo l="NIF"><input value={a.nif || ""} onChange={e => set("nif", e.target.value.toUpperCase())} style={K.input} /></Campo>
        <Campo l="Dirección"><input value={a.direccion || ""} onChange={e => set("direccion", e.target.value)} style={K.input} /></Campo>
        <Campo l="Código postal"><input inputMode="numeric" value={a.cp || ""} onChange={e => set("cp", e.target.value)} style={K.input} /></Campo>
        <Campo l="Ciudad"><input value={a.ciudad || ""} onChange={e => set("ciudad", e.target.value)} style={K.input} /></Campo>
        <Campo l="Provincia"><input value={a.provincia || ""} onChange={e => set("provincia", e.target.value)} style={K.input} /></Campo>
        <Campo l="Correo de facturación"><input type="email" value={a.email || ""} onChange={e => set("email", e.target.value)} style={K.input} /></Campo>
        <Campo l="Serie de las facturas"><input value={a.serie || ""} onChange={e => set("serie", e.target.value.toUpperCase())} style={K.input} /></Campo>
      </div>
    </section>

    <button onClick={guardar} disabled={busy} style={{ ...K.primario, opacity: busy ? .6 : 1 }}>{busy ? "Guardando…" : "Guardar comisión y datos"}</button>

    <section style={K.card}>
      <div style={K.titulo}>Recuperación de entradas perdidas (90 días)</div>
      <div style={K.sub}>Servicio de TIXFAST en /cambio: el cliente paga y le reenviamos sus entradas solo al correo de la compra. Se cobra siempre, haya o no entradas.</div>
      <div style={{ maxWidth: 220, marginBottom: 10 }}><Campo l="Precio del servicio (€, IVA incl.)"><input inputMode="decimal" value={a.recuperacion_precio ?? ""} onChange={e => set("recuperacion_precio", e.target.value)} style={K.input} /></Campo></div>
      {d.recuperaciones && <div style={{ fontSize: 14 }}>
        <Fila t="Solicitudes pagadas" v={d.recuperaciones.pagadas} />
        <Fila t="Cobrado" v={eur(d.recuperaciones.cobrado)} fuerte />
        <Fila t="Con entradas encontradas / sin entradas" v={`${d.recuperaciones.con_entradas} / ${d.recuperaciones.sin_entradas}`} />
        {Number(d.recuperaciones.fallos_envio) > 0 && <Fila t="Correos que no se pudieron enviar" v={d.recuperaciones.fallos_envio} c="var(--amber)" />}
      </div>}
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>El precio se guarda con el botón «Guardar comisión y datos».</div>
    </section>

    <Pactos avisar={avisar} pactos={d.pactos || []} general={T} onCambio={cargar} />

    <section style={K.card}>
      <div style={K.titulo}>Facturas a organizadores</div>
      <div style={K.sub}>Una por evento, al repartir el dinero. Al organizador le aparece en Facturación › Gastos como pagada.</div>
      {!(d.facturas || []).length && <div style={{ color: "var(--muted)", fontSize: 14 }}>Aún no hay ninguna.</div>}
      <div style={{ display: "grid", gap: 6 }}>{(d.facturas || []).map(f => { const [t, c] = ESTADO_FAC[f.estado] || [f.estado, "var(--muted)"]; return (
        <div key={f.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 8, fontSize: 13.5, display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.codigo || "Sin número"}{f.receptor?.nombre ? ` · ${f.receptor.nombre}` : ""}</div>
            <div style={{ color: "var(--muted)" }}>{f.entradas} entradas · {eur(f.total)} (base {eur(f.base)} + IVA {eur(f.cuota_iva)}){f.modo === "pruebas" ? " · prueba" : ""}</div>
          </div>
          <span style={K.badge(c)}>{t}</span>
        </div>); })}</div>
    </section>
  </div>);
}

// Pacto distinto con un organizador
function Pactos({ avisar, pactos, general, onCambio }) {
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState([]);
  const [sel, setSel] = useState(null);   // { owner_id, nombre, pct, min }
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (buscar.trim().length < 3) { setLista([]); return; }
    const t = setTimeout(() => supabase.rpc("admin_cuentas", { p_buscar: buscar.trim(), p_filtro: "todas", p_limite: 8, p_desde: 0 }).then(({ data }) => setLista(data || [])), 350);
    return () => clearTimeout(t);
  }, [buscar]);
  const guardar = async (x) => {
    setBusy(true);
    try { await servidor({ accion: "comision_cuenta", cuenta: x.owner_id, pct: x.pct, min: x.min }); avisar("✓ Pacto guardado"); setSel(null); setBuscar(""); onCambio(); }
    catch (e) { avisar(e.message, true); } finally { setBusy(false); }
  };
  return (<section style={K.card}>
    <div style={K.titulo}>Pactos con organizadores</div>
    <div style={K.sub}>Si con alguien tenéis otro %, o otro mínimo, ponlo aquí. Lo vacío usa el general ({coma(general.pct)} %, mín. {eur(general.min)}). Solo cuenta para las ventas a partir de ahora.</div>
    {pactos.map(p => (
      <div key={p.owner_id} style={{ display: "flex", gap: 10, alignItems: "center", borderTop: "1px solid var(--line)", padding: "8px 0", fontSize: 14 }}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><b>{p.nombre || "Organizador"}</b> · {p.comision_pct != null ? `${coma(p.comision_pct)} %` : "% general"} · {p.comision_min != null ? `mín. ${eur(p.comision_min)}` : "mínimo general"}</span>
        <button onClick={() => setSel({ owner_id: p.owner_id, nombre: p.nombre, pct: coma(p.comision_pct), min: coma(p.comision_min) })} style={K.btn}>Cambiar</button>
      </div>))}
    {!sel && <div style={{ marginTop: 8 }}>
      <input type="search" value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar organizador por correo…" style={K.input} aria-label="Buscar organizador" />
      {lista.map(c => <button key={c.owner_id} onClick={() => setSel({ owner_id: c.owner_id, nombre: c.email || c.nombre, pct: "", min: "" })} style={{ ...K.btn, width: "100%", textAlign: "left", marginTop: 6, fontWeight: 700 }}>{c.email || c.nombre}</button>)}
    </div>}
    {sel && <div style={{ marginTop: 10, border: "1px solid var(--line)", borderRadius: 12, padding: 12 }}>
      <div style={{ fontWeight: 800, marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis" }}>{sel.nombre}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Campo l="Comisión (%)"><input inputMode="decimal" value={sel.pct} placeholder={coma(general.pct)} onChange={e => setSel({ ...sel, pct: e.target.value })} style={K.input} /></Campo>
        <Campo l="Mínimo (€)"><input inputMode="decimal" value={sel.min} placeholder={coma(general.min)} onChange={e => setSel({ ...sel, min: e.target.value })} style={K.input} /></Campo>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button disabled={busy} onClick={() => guardar({ ...sel, pct: String(sel.pct).replace(",", "."), min: String(sel.min).replace(",", ".") })} style={K.primario}>Guardar pacto</button>
        <button disabled={busy} onClick={() => guardar({ ...sel, pct: "", min: "" })} style={K.btn}>Usar el general</button>
        <button onClick={() => setSel(null)} style={K.btn}>Cancelar</button>
      </div>
    </div>}
  </section>);
}

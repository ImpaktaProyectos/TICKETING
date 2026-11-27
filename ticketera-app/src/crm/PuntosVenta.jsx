// ===================== CRM · PUNTOS DE VENTA FÍSICOS =====================
// Tiendas, bares… a los que se dejan entradas para que las vendan. Por cada evento:
//  · Entregas: de la nº X a la nº Y, precio y comisión (en € por entrada o en %, editable siempre).
//    Con talonario propio (solo se apuntan los números) o con talonario de TIXFAST con QR (se valida en la puerta).
//  · Liquidación: cuántas ha vendido o qué números devuelve → total, su comisión, lo que te tiene que dar y lo pendiente.
//  · Todo pasa solo al CRM del evento: la venta como ingreso y la comisión como gasto.
//  · Cada punto tiene su enlace (/pv/<enlace>) para registrar ventas, devolver entradas y, si lo activas, vender al móvil.
//    Lo que registra se ve aquí al momento (es informativo: la entrada vale para entrar igual).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabase";
import { money, useIsMobile, C, Icon, Sheet, Field, Seg, Tile, Badge, MoneyInput, parseImporte, hoy } from "./ui";
import { resumenLote, leerRangos, textoRangos, solapan } from "./pvCalc.js";
import { DisenoEntrada, GenerarTandas, DescargarImprenta } from "./Imprenta.jsx";

const num = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const coma = (v) => (v == null ? "" : String(v).replace(".", ","));
const comisionCorta = (t, v) => (t === "pct" ? `${coma(v)} %` : `${money(v)}/entrada`);
const MOTIVO = { aforo: "No caben: con estas entradas se pasaría del aforo de la sala (Gestionar evento › paso 3).", sin_web: "Para generar entradas con QR, activa antes la venta online del evento (en Entradas › Eventos; puede quedarse en borrador).", cantidad: "Entre 1 y 2.000 entradas por talonario.", precio: "Revisa el precio.", evento: "Evento no válido.", punto: "Punto de venta no válido.", sesion: "Vuelve a entrar." };
const aLocal = (v) => { if (!v) return ""; const d = new Date(v); if (isNaN(d)) return ""; const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const errorTxt = (e) => String(e?.message || e || "No se ha podido guardar").replace(/^.*?ERROR:\s*/, "");

export function PuntosVenta({ ev, flash }) {
  const isMobile = useIsMobile();
  const [puntos, setPuntos] = useState(null);
  const [lotes, setLotes] = useState([]);
  const [punto, setPunto] = useState(null);     // ficha en edición
  const [entrega, setEntrega] = useState(null); // nueva entrega
  const [lote, setLote] = useState(null);       // entrega abierta (liquidar)
  const [directa, setDirecta] = useState(null); // ventas al móvil de un punto (cobrar)
  const [vivo, setVivo] = useState({ registradas: {}, directas: [] });   // lo que registran los puntos, al momento
  const [disenos, setDisenos] = useState([]);
  const [hoja, setHoja] = useState(null);       // "diseno" | "tandas" | { imprenta: [ids] }
  const cargar = async () => {
    if (ev?.id) supabase.from("ticket_pv_disenos").select("*").eq("evento_id", ev.id).order("creado_en").then(({ data }) => setDisenos(data || []));
    const [p, l, e] = await Promise.all([
      supabase.from("ticket_pv").select("*").order("nombre"),
      ev?.id ? supabase.from("ticket_pv_lotes").select("*").eq("evento_id", ev.id).order("desde") : Promise.resolve({ data: [] }),
      ev?.id ? supabase.rpc("pv_estado_evento", { p_evento: ev.id }) : Promise.resolve({ data: null }),
    ]);
    if (p.error) { setPuntos(false); return; }
    setPuntos(p.data || []); setLotes(l.data || []);
    if (e.data) setVivo({ registradas: e.data.registradas || {}, directas: e.data.directas || [] });
  };
  useEffect(() => { cargar(); const t = setInterval(() => { if (document.visibilityState === "visible") cargar(); }, 30000); return () => clearInterval(t); }, [ev?.id]);
  const porPunto = useMemo(() => {
    const m = new Map();
    lotes.forEach(l => { const r = resumenLote(l); const a = m.get(l.pv_id) || { lotes: [], entregadas: 0, vendidas: 0, total: 0, comision: 0, pendiente: 0, sinLiquidar: 0 };
      a.lotes.push(l); a.entregadas += r.entregadas; a.vendidas += r.vendidas; a.total += r.total; a.comision += r.comision; a.pendiente += r.pendiente; if (!l.vendidas_modo) a.sinLiquidar++;
      a.registradas = (a.registradas || 0) + (l.vendidas_modo ? 0 : (vivo.registradas[l.id] || 0)); m.set(l.pv_id, a); });
    // Ventas al móvil: cuentan como vendidas del punto (ya cobradas por él en efectivo)
    vivo.directas.forEach(dd => { const a = m.get(dd.pv_id) || { lotes: [], entregadas: 0, vendidas: 0, total: 0, comision: 0, pendiente: 0, sinLiquidar: 0 };
      const debe = Math.max(0, Number(dd.total) - Number(dd.comision) - Number(dd.pagado));
      a.directa = dd; a.vendidas += dd.entradas; a.total += Number(dd.total); a.comision += Number(dd.comision); a.pendiente += debe; m.set(dd.pv_id, a); });
    return m;
  }, [lotes, vivo]);
  const T = [...porPunto.values()].reduce((t, a) => ({ entregadas: t.entregadas + a.entregadas, vendidas: t.vendidas + a.vendidas, total: t.total + a.total, comision: t.comision + a.comision, pendiente: t.pendiente + a.pendiente, registradas: t.registradas + (a.registradas || 0) }), { entregadas: 0, vendidas: 0, total: 0, comision: 0, pendiente: 0, registradas: 0 });

  if (puntos === null) return <div style={{ color: "var(--muted)", padding: 20 }}>Cargando…</div>;
  if (puntos === false) return <div style={C.empty}>No se han podido cargar los puntos de venta.</div>;
  const conLotes = puntos.filter(p => porPunto.has(p.id));
  const dato = (t, v, c) => <div style={{ minWidth: 0 }}><div style={C.label}>{t}</div><div style={{ fontWeight: 800, fontSize: isMobile ? 18 : 22, color: c || "var(--text)", fontVariantNumeric: "tabular-nums" }}>{v}</div></div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <section style={{ ...C.hero, padding: isMobile ? 16 : 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div style={C.label}>Puntos de venta · {ev?.name || "evento"}</div>
            <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 2 }}>Entradas que dejas a tiendas, bares o personas para que las vendan.</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => setPunto({ comision_tipo: "fija", comision_valor: 0, activo: true })} style={C.btnGhost}><Icon n="plus" s={16} />Punto de venta</button>
            <button onClick={() => puntos.length ? setEntrega({}) : flash("Primero crea un punto de venta", "warn")} style={C.btnPrimary}><Icon n="plus" s={16} w={2.4} />Nueva entrega</button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <button onClick={() => setHoja("diseno")} style={{ ...C.btnGhost, minHeight: 44 }}><Icon n="eye" s={16} />Diseño de la entrada{disenos.length ? ` (${disenos.length})` : ""}</button>
          <button onClick={() => puntos.some(p => p.activo) ? setHoja("tandas") : flash("Primero crea un punto de venta", "warn")} style={{ ...C.btnGhost, minHeight: 44 }}><Icon n="plus" s={16} />Generar tandas con QR</button>
          <button onClick={() => setHoja({ imprenta: [] })} style={{ ...C.btnGhost, minHeight: 44 }}><Icon n="download" s={16} />Descargar para imprenta</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(5, 1fr)", gap: 12, marginTop: 14 }}>
          {dato("Entregadas", T.entregadas)}{dato("Vendidas", T.vendidas)}{dato("Total vendido", money(T.total))}{dato("Comisiones", money(T.comision))}{dato("Te deben", money(T.pendiente), T.pendiente > 0 ? "var(--amber)" : "var(--green)")}
        </div>
        {T.registradas > 0 && <div style={{ marginTop: 12, fontSize: 13.5, color: "var(--muted)" }}><b style={{ color: "var(--green)" }}>{T.registradas}</b> vendidas registradas por los puntos en entregas aún sin liquidar (se actualiza solo).</div>}
      </section>

      {conLotes.length === 0 && <div style={C.empty}>Aún no has entregado entradas a ningún punto de venta en este evento.</div>}
      {conLotes.map(p => { const a = porPunto.get(p.id); return (
        <section key={p.id} style={{ ...C.panel, padding: isMobile ? 14 : 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Tile n="building" s={36} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nombre}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{a.entregadas} entregadas · {a.vendidas} vendidas{a.sinLiquidar ? ` · ${a.sinLiquidar} sin liquidar` : ""}{a.registradas ? ` · ${a.registradas} registradas ahora` : ""}</div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={C.label}>Te debe</div>
              <div style={{ fontWeight: 800, color: a.pendiente > 0 ? "var(--amber)" : "var(--green)" }}>{money(a.pendiente)}</div>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            {a.lotes.map(l => { const r = resumenLote(l); return (
              <button key={l.id} onClick={() => setLote(l)} style={{ ...C.listBtn, width: "100%", borderTop: "1px solid var(--line)", borderRadius: 0, padding: "10px 4px", minHeight: 52 }}>
                <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                  <span style={{ display: "block", fontWeight: 700 }}>Nº {l.desde}–{l.hasta} · {l.nombre}{l.modo === "qr" ? " · con QR" : ""}</span>
                  <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)" }}>{money(l.precio)} · comisión {comisionCorta(l.comision_tipo, l.comision_valor)} · {l.vendidas_modo ? `${r.vendidas} vendidas · ${money(r.aEntregar)} a entregar` : `sin liquidar${vivo.registradas[l.id] ? ` · ${vivo.registradas[l.id]} registradas` : ""}${r.devueltas ? ` · ${r.devueltas} devueltas` : ""}`}</span>
                  {!l.vendidas_modo && l.devolver_hasta && new Date(l.devolver_hasta) < new Date() && <span style={{ display: "block", fontSize: 12.5, color: "var(--amber)", fontWeight: 700 }}>Ha pasado el plazo de devolución: liquida esta entrega</span>}
                </span>
                {l.vendidas_modo ? (r.pendiente > 0 ? <Badge c="var(--amber)">Debe {money(r.pendiente)}</Badge> : <Badge c="var(--green)">Pagado</Badge>) : <Badge>Liquidar</Badge>}
              </button>); })}
            {a.directa && (() => { const dd = a.directa; const debe = Math.max(0, Number(dd.total) - Number(dd.comision) - Number(dd.pagado)); return (
              <button onClick={() => setDirecta({ punto: p, dd })} style={{ ...C.listBtn, width: "100%", borderTop: "1px solid var(--line)", borderRadius: 0, padding: "10px 4px", minHeight: 52 }}>
                <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                  <span style={{ display: "block", fontWeight: 700 }}>Venta al móvil · {dd.entradas} entradas</span>
                  <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)" }}>{money(dd.total)} cobrado en efectivo · comisión {money(dd.comision)}</span>
                </span>
                {debe > 0 ? <Badge c="var(--amber)">Debe {money(debe)}</Badge> : <Badge c="var(--green)">Pagado</Badge>}
              </button>); })()}
          </div>
          <EnlacePunto p={p} ev={ev} flash={flash} />
        </section>); })}

      <section style={{ ...C.panel, padding: isMobile ? 14 : 18 }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Todos tus puntos de venta ({puntos.length})</div>
        {puntos.length === 0 && <div style={{ color: "var(--muted)", fontSize: 14 }}>Crea el primero con «Punto de venta». Sirve para todos tus eventos.</div>}
        {puntos.map(p => (
          <button key={p.id} onClick={() => setPunto(p)} style={{ ...C.listBtn, width: "100%", borderTop: "1px solid var(--line)", borderRadius: 0, padding: "10px 4px", minHeight: 48, opacity: p.activo ? 1 : .55 }}>
            <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
              <span style={{ display: "block", fontWeight: 700 }}>{p.nombre}{!p.activo ? " · inactivo" : ""}</span>
              <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)" }}>{[p.contacto, p.telefono].filter(Boolean).join(" · ") || "Sin contacto"} · comisión {comisionCorta(p.comision_tipo, p.comision_valor)}</span>
            </span>
            <Icon n="edit" s={16} c="var(--muted)" />
          </button>))}
      </section>

      {punto && <FichaPunto p={punto} usado={porPunto.has(punto.id)} flash={flash} onClose={() => setPunto(null)} onCambio={() => { setPunto(null); cargar(); }} />}
      {entrega && <NuevaEntrega ev={ev} puntos={puntos.filter(p => p.activo)} lotes={lotes} flash={flash} onClose={() => setEntrega(null)} onCreada={(l) => { setEntrega(null); cargar(); if (l) setLote(l); }} />}
      {lote && <Liquidacion onImprenta={() => { const id = lote.id; setLote(null); setHoja({ imprenta: [id] }); }} ev={ev} lote={lote} registradas={vivo.registradas[lote.id] || 0} punto={puntos.find(p => p.id === lote.pv_id) || {}} lotes={lotes} flash={flash} onClose={() => setLote(null)} onCambio={(sigue) => { cargar(); if (!sigue) setLote(null); }} />}
      {hoja === "diseno" && <DisenoEntrada ev={ev} flash={flash} onClose={() => setHoja(null)} onCambio={cargar} />}
      {hoja === "tandas" && <GenerarTandas ev={ev} puntos={puntos} disenos={disenos} flash={flash} onClose={() => setHoja(null)} onHecho={async (ids) => { await cargar(); setHoja({ imprenta: ids }); }} />}
      {hoja?.imprenta && <DescargarImprenta ev={ev} puntos={puntos} lotes={lotes} disenos={disenos} inicial={hoja.imprenta} flash={flash} onClose={() => setHoja(null)} />}
      {directa && <CobroDirectas ev={ev} punto={directa.punto} dd={directa.dd} flash={flash} onClose={() => setDirecta(null)} onCambio={() => { setDirecta(null); cargar(); }} />}
    </div>
  );
}

/* ---------- Enlace del panel del punto: copiar, WhatsApp ---------- */
const enlacePunto = (p) => `${window.location.origin}/pv/${p.token}`;
const waPunto = (p, ev) => {
  const tel = String(p.telefono || "").replace(/[^\d]/g, "");
  const num = tel.length === 9 ? "34" + tel : tel;
  const txt = `Hola${p.contacto ? " " + p.contacto : ""}, este es tu panel de punto de venta${ev?.name ? " para " + ev.name : ""}: ${enlacePunto(p)}\nÁbrelo en el móvil. Escanea cada entrada al venderla (o pulsa «+1 vendida») y, antes del evento, escanea las que no vendas para devolverlas.`;
  return `https://wa.me/${num}?text=${encodeURIComponent(txt)}`;
};
function EnlacePunto({ p, ev, flash }) {
  if (!p.token) return null;
  const copiar = async () => { try { await navigator.clipboard.writeText(enlacePunto(p)); flash("Enlace copiado"); } catch { flash(enlacePunto(p)); } };
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
      <span style={{ fontSize: 12.5, color: "var(--muted)", flex: "1 1 160px" }}>Su panel para registrar ventas y devolver{p.venta_directa ? " (venta al móvil activada)" : ""}</span>
      <button onClick={copiar} style={{ ...C.btnGhost, minHeight: 44 }}><Icon n="copy" s={16} />Copiar enlace</button>
      <a href={waPunto(p, ev)} target="_blank" rel="noopener noreferrer" style={{ ...C.btnGhost, minHeight: 44, textDecoration: "none" }}>WhatsApp</a>
    </div>
  );
}

/* ---------- Ventas al móvil de un punto: lo que te tiene que dar ---------- */
function CobroDirectas({ ev, punto, dd, flash, onClose, onCambio }) {
  const aDar = Math.max(0, Number(dd.total) - Number(dd.comision));
  const [pagado, setPagado] = useState(coma(dd.pagado || 0));
  const [busy, setBusy] = useState(false);
  const guardar = async () => {
    setBusy(true);
    const { error } = await supabase.from("ticket_pv_eventos").upsert({ pv_id: punto.id, evento_id: ev.id, pagado_directas: parseImporte(pagado), actualizado_en: new Date().toISOString() }, { onConflict: "pv_id,evento_id" });
    setBusy(false);
    if (error) return flash(errorTxt(error), "warn");
    flash("Guardado"); onCambio();
  };
  const fila2 = (t, v, c, fuerte) => <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "4px 0", fontWeight: fuerte ? 800 : 600, color: c || (fuerte ? "var(--text)" : "var(--muted)") }}><span>{t}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{v}</span></div>;
  const pend = Math.max(0, aDar - parseImporte(pagado));
  return (
    <Sheet title={`${punto.nombre} · venta al móvil`} onClose={onClose} footer={<button onClick={guardar} disabled={busy} style={{ ...C.btnPrimary, width: "100%", minHeight: 52 }}>{busy ? "Guardando…" : "Guardar"}</button>}>
      <div style={{ ...C.card, padding: 12, marginBottom: 12, fontSize: 14 }}>
        {fila2("Entradas vendidas al móvil", dd.entradas)}
        {fila2("Cobrado por el punto (efectivo)", money(dd.total))}
        {fila2("Su comisión", "− " + money(dd.comision))}
        {fila2("Te tiene que dar", money(aDar), null, true)}
        {fila2("Pendiente", money(pend), pend > 0 ? "var(--amber)" : "var(--green)", true)}
      </div>
      <Field l="Ya te ha pagado">
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}><MoneyInput value={pagado} onChange={setPagado} /></div>
          <button type="button" onClick={() => setPagado(coma(aDar))} style={{ ...C.btnGhost, minHeight: 44 }}>Todo</button>
        </div>
      </Field>
      <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45 }}>Las compradoras y compradores recibieron su entrada en el correo. La venta y la comisión pasan solas al CRM del evento; al apuntar lo pagado, el ingreso queda como cobrado.</div>
    </Sheet>
  );
}

/* ---------- Comisión: € por entrada o % (se puede cambiar siempre) ---------- */
function Comision({ tipo, valor, onTipo, onValor }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      <Seg full valor={tipo} onChange={onTipo} opciones={[{ k: "fija", t: "€ por entrada" }, { k: "pct", t: "% del total" }]} />
      <div style={{ position: "relative" }}>
        <input inputMode="decimal" value={valor} onChange={e => onValor(e.target.value.replace(/[^\d,.]/g, ""))} style={{ ...C.input, paddingRight: 34 }} />
        <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontWeight: 700 }}>{tipo === "pct" ? "%" : "€"}</span>
      </div>
    </div>
  );
}

/* ---------- Ficha de un punto de venta ---------- */
function FichaPunto({ p, usado, flash, onClose, onCambio }) {
  const [f, setF] = useState({ ...p, comision_valor: coma(p.comision_valor) });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const guardar = async () => {
    if (!String(f.nombre || "").trim()) return flash("Escribe el nombre", "warn");
    setBusy(true);
    const fila = { nombre: f.nombre.trim(), contacto: f.contacto || null, telefono: f.telefono || null, email: f.email || null, direccion: f.direccion || null, notas: f.notas || null,
      comision_tipo: f.comision_tipo, comision_valor: num(f.comision_valor), activo: f.activo !== false, venta_directa: !!f.venta_directa, actualizado_en: new Date().toISOString() };
    const r = p.id ? await supabase.from("ticket_pv").update(fila).eq("id", p.id) : await supabase.from("ticket_pv").insert(fila);
    setBusy(false);
    if (r.error) return flash(errorTxt(r.error), "warn");
    flash(p.id ? "Punto de venta guardado" : "Punto de venta creado"); onCambio();
  };
  const [renovar, setRenovar] = useState(false);
  const nuevoEnlace = async () => {
    setBusy(true); const r = await supabase.from("ticket_pv").update({ token: crypto.randomUUID() }).eq("id", p.id); setBusy(false);
    if (r.error) return flash(errorTxt(r.error), "warn");
    flash("Enlace renovado: el anterior ya no funciona. Envíale el nuevo."); onCambio();
  };
  const borrar = async () => {
    setBusy(true); const r = await supabase.from("ticket_pv").delete().eq("id", p.id); setBusy(false);
    if (r.error) return flash("Tiene entregas: desactívalo en vez de borrarlo", "warn");
    flash("Punto de venta borrado"); onCambio();
  };
  return (
    <Sheet title={p.id ? "Punto de venta" : "Nuevo punto de venta"} onClose={onClose} footer={
      <div style={{ display: "flex", gap: 8 }}>
        {p.id && !usado && <button onClick={borrar} disabled={busy} style={{ ...C.btnGhost, color: "var(--red)" }} aria-label="Borrar"><Icon n="trash" s={18} /></button>}
        <button onClick={guardar} disabled={busy} style={{ ...C.btnPrimary, flex: 1, minHeight: 52 }}>{busy ? "Guardando…" : "Guardar"}</button>
      </div>}>
      <Field l="Nombre (tienda, bar, persona…)"><input value={f.nombre || ""} maxLength={120} onChange={e => set("nombre", e.target.value)} style={C.input} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field l="Persona de contacto"><input value={f.contacto || ""} maxLength={120} onChange={e => set("contacto", e.target.value)} style={C.input} /></Field>
        <Field l="Teléfono"><input type="tel" value={f.telefono || ""} maxLength={40} onChange={e => set("telefono", e.target.value)} style={C.input} /></Field>
      </div>
      <Field l="Correo"><input type="email" value={f.email || ""} maxLength={160} onChange={e => set("email", e.target.value)} style={C.input} /></Field>
      <Field l="Dirección"><input value={f.direccion || ""} maxLength={200} onChange={e => set("direccion", e.target.value)} style={C.input} /></Field>
      <Field l="Comisión por defecto (se puede cambiar en cada entrega)"><Comision tipo={f.comision_tipo} valor={f.comision_valor} onTipo={(v) => set("comision_tipo", v)} onValor={(v) => set("comision_valor", v)} /></Field>
      <Field l="Notas"><input value={f.notas || ""} maxLength={1000} onChange={e => set("notas", e.target.value)} style={C.input} /></Field>
      <label style={C.toggleRow}><span>Venta al móvil<span style={{ display: "block", fontSize: 12.5, color: "var(--muted)", fontWeight: 500 }}>Desde su panel puede vender entradas de la web: cobra en efectivo y la entrada llega al correo del comprador.</span></span><input type="checkbox" checked={!!f.venta_directa} onChange={e => set("venta_directa", e.target.checked)} style={{ width: 22, height: 22, accentColor: "var(--accent)", flexShrink: 0 }} /></label>
      {p.id && p.token && <Field l="Enlace de su panel">
        <div style={{ fontSize: 12.5, color: "var(--muted)", wordBreak: "break-all", marginBottom: 6 }}>{enlacePunto(p)}</div>
        {renovar ? <div style={{ display: "flex", gap: 8 }}><button onClick={nuevoEnlace} disabled={busy} style={{ ...C.btnGhost, color: "var(--red)", borderColor: "var(--red)", minHeight: 44 }}>Sí, crear uno nuevo</button><button onClick={() => setRenovar(false)} style={{ ...C.btnGhost, minHeight: 44 }}>No</button></div>
          : <button onClick={() => setRenovar(true)} style={{ ...C.btnGhost, minHeight: 44 }}>Renovar enlace (si se ha compartido con quien no debía)</button>}
      </Field>}
      {p.id && <label style={C.toggleRow}><span>Activo (aparece al hacer entregas)</span><input type="checkbox" checked={f.activo !== false} onChange={e => set("activo", e.target.checked)} style={{ width: 22, height: 22, accentColor: "var(--accent)" }} /></label>}
    </Sheet>
  );
}

/* ---------- Nueva entrega ---------- */
function NuevaEntrega({ ev, puntos, lotes, flash, onClose, onCreada }) {
  const [pvId, setPvId] = useState(puntos[0]?.id || "");
  const pv = puntos.find(p => p.id === pvId) || {};
  const [modo, setModo] = useState("manual");
  const [nombre, setNombre] = useState("Entrada");
  const [precio, setPrecio] = useState("");
  const [desde, setDesde] = useState(""); const [hasta, setHasta] = useState(""); const [cantidad, setCantidad] = useState("");
  const [ct, setCt] = useState(pv.comision_tipo || "fija"); const [cv, setCv] = useState(coma(pv.comision_valor ?? 0));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setCt(pv.comision_tipo || "fija"); setCv(coma(pv.comision_valor ?? 0)); }, [pvId]);
  const d = parseInt(desde, 10), h = parseInt(hasta, 10), n = modo === "qr" ? parseInt(cantidad, 10) || 0 : (d >= 0 && h >= d ? h - d + 1 : 0);
  const choca = modo === "manual" && n > 0 && lotes.some(l => solapan(l, { desde: d, hasta: h }));
  const ok = pvId && n > 0 && n <= (modo === "qr" ? 2000 : 5000) && parseImporte(precio) >= 0 && precio !== "" && !choca;
  const guardar = async () => {
    if (!ok || busy) return;
    setBusy(true);
    if (modo === "qr") {
      const { data, error } = await supabase.rpc("pv_crear_talonario", { p_evento: ev.id, p_pv: pvId, p_nombre: nombre, p_precio: parseImporte(precio), p_cantidad: n, p_comision_tipo: ct, p_comision_valor: num(cv), p_notas: null });
      setBusy(false);
      if (error || !data?.ok) return flash(MOTIVO[data?.motivo] || errorTxt(error), "warn");
      flash(`Talonario creado: nº ${data.desde} a ${data.hasta}${data.prueba ? " (de PRUEBA: el evento está en pruebas)" : ""}`);
      const { data: l } = await supabase.from("ticket_pv_lotes").select("*").eq("id", data.lote).maybeSingle();
      return onCreada(l);
    }
    const { data, error } = await supabase.from("ticket_pv_lotes").insert({ evento_id: ev.id, pv_id: pvId, nombre: nombre.trim() || "Entrada", precio: parseImporte(precio), comision_tipo: ct, comision_valor: num(cv), modo: "manual", desde: d, hasta: h, entregado_en: hoy() }).select("*").single();
    setBusy(false);
    if (error) return flash(errorTxt(error), "warn");
    flash("Entrega guardada"); onCreada(data);
  };
  return (
    <Sheet title="Nueva entrega de entradas" onClose={onClose} footer={
      <button onClick={guardar} disabled={!ok || busy} style={{ ...C.btnPrimary, width: "100%", minHeight: 52, opacity: ok && !busy ? 1 : .5 }}>
        {busy ? "Guardando…" : !pvId ? "Elige el punto de venta" : n <= 0 ? (modo === "qr" ? "Escribe cuántas entradas" : "Escribe la numeración") : choca ? "Esa numeración ya está entregada" : precio === "" ? "Escribe el precio" : modo === "qr" ? `Generar ${n} entradas con QR` : `Entregar ${n} entradas`}
      </button>}>
      <Field l="Punto de venta">
        <select value={pvId} onChange={e => setPvId(e.target.value)} style={C.input}>{puntos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>
      </Field>
      <Field l="¿Qué entradas le das?">
        <Seg full valor={modo} onChange={setModo} opciones={[{ k: "manual", t: "Mi talonario" }, { k: "qr", t: "Talonario con QR" }]} />
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6, lineHeight: 1.45 }}>{modo === "manual" ? "Entradas que ya tienes impresas: solo apuntas qué números le das." : "TIXFAST genera las entradas numeradas con QR para imprimir. En la puerta se escanean y las que te devuelva se anulan."}</div>
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 10 }}>
        <Field l="Tipo de entrada"><input value={nombre} maxLength={80} onChange={e => setNombre(e.target.value)} style={C.input} /></Field>
        <Field l="Precio de venta"><MoneyInput value={precio} onChange={setPrecio} /></Field>
      </div>
      {modo === "manual" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field l="Desde el nº"><input inputMode="numeric" value={desde} onChange={e => setDesde(e.target.value.replace(/\D/g, "").slice(0, 7))} style={C.input} /></Field>
          <Field l="Hasta el nº"><input inputMode="numeric" value={hasta} onChange={e => setHasta(e.target.value.replace(/\D/g, "").slice(0, 7))} style={C.input} /></Field>
        </div>
      ) : (
        <Field l="Cuántas entradas"><input inputMode="numeric" value={cantidad} onChange={e => setCantidad(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="Ej. 50" style={C.input} /></Field>
      )}
      {n > 0 && <div style={{ fontSize: 13, color: choca ? "var(--red)" : "var(--muted)", margin: "-6px 0 12px" }}>{choca ? "Esa numeración se pisa con otra entrega de este evento." : `${n} entradas · ${money(n * parseImporte(precio))} si las vende todas.`}</div>}
      <Field l="Comisión del punto en esta entrega"><Comision tipo={ct} valor={cv} onTipo={setCt} onValor={setCv} /></Field>
    </Sheet>
  );
}

/* ---------- Liquidación de una entrega ---------- */
function Liquidacion({ onImprenta, ev, lote, registradas = 0, punto, lotes, flash, onClose, onCambio }) {
  const isMobile = useIsMobile();
  const [f, setF] = useState({ ...lote, precio: coma(lote.precio), comision_valor: coma(lote.comision_valor), pagado: coma(lote.pagado), vendidas: lote.vendidas ?? "", devTexto: textoRangos(lote.devueltas), plazo: aLocal(lote.devolver_hasta) });
  const [anular, setAnular] = useState(null);   // null | "preguntar" | { sinNumero }
  const base = useRef(lote.devueltas);   // las devueltas tal como estaban al abrir (para no pisar las del punto)
  const [busy, setBusy] = useState("");
  const [borrar, setBorrar] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const qr = lote.modo === "qr";
  const modoLiq = qr ? (f.vendidas_modo ? "devueltas" : null) : f.vendidas_modo;
  const rangos = leerRangos(f.devTexto, Number(f.desde), Number(f.hasta));
  const desde = parseInt(f.desde, 10), hasta = parseInt(f.hasta, 10);
  const choca = !qr && lotes.some(l => l.id !== lote.id && solapan(l, { desde, hasta }));
  const actual = { ...f, desde, hasta, precio: num(f.precio), comision_valor: num(f.comision_valor), pagado: parseImporte(f.pagado), vendidas: parseInt(f.vendidas, 10) || 0, vendidas_modo: modoLiq, devueltas: rangos.rangos || [] };
  const r = resumenLote(actual);
  // En los talonarios con QR las devueltas se guardan siempre (también las que el punto devuelve escaneando)
  const fila = () => ({ nombre: String(f.nombre || "").trim() || "Entrada", precio: actual.precio, comision_tipo: f.comision_tipo, comision_valor: actual.comision_valor, pagado: actual.pagado,
    vendidas_modo: modoLiq || null, vendidas: modoLiq === "cantidad" ? actual.vendidas : null, devueltas: qr || modoLiq === "devueltas" ? actual.devueltas : [], notas: f.notas || null,
    devolver_hasta: f.plazo ? new Date(f.plazo).toISOString() : null,
    ...(qr ? {} : { desde, hasta }) });
  const guardar = async (cerrar = true) => {
    if (rangos.error) return flash(rangos.error, "warn");
    if (choca) return flash("Esa numeración se pisa con otra entrega", "warn");
    setBusy("guardar");
    if (qr) {
      // Si el punto ha devuelto entradas desde su panel mientras tenías esto abierto, no se pisa lo suyo
      const { data: hoyEs } = await supabase.from("ticket_pv_lotes").select("devueltas").eq("id", lote.id).maybeSingle();
      if (hoyEs && textoRangos(hoyEs.devueltas) !== textoRangos(base.current)) {
        setBusy(""); base.current = hoyEs.devueltas; set("devTexto", textoRangos(hoyEs.devueltas));
        return flash("El punto acaba de devolver entradas desde su panel. Hemos puesto las devueltas al día: revisa y vuelve a guardar.", "warn");
      }
    }
    const { error } = await supabase.from("ticket_pv_lotes").update(fila()).eq("id", lote.id);
    setBusy("");
    if (error) return flash(errorTxt(error), "warn");
    flash("Guardado"); onCambio(!cerrar);
  };
  const anularNoRegistradas = async (forzar) => {
    setBusy("anular");
    const { data, error } = await supabase.rpc("pv_anular_no_registradas", { p_lote: lote.id, p_forzar: !!forzar });
    setBusy("");
    if (error) return flash(errorTxt(error), "warn");
    if (!data?.ok && data?.motivo === "sin_numero") return setAnular({ sinNumero: data.sin_numero });
    if (!data?.ok) return flash("No se ha podido anular", "warn");
    flash(`${data.devueltas} entradas dadas por devueltas y anuladas`); onCambio(false);
  };
  const quitar = async () => { setBusy("borrar"); const { error } = await supabase.from("ticket_pv_lotes").delete().eq("id", lote.id); setBusy(""); if (error) return flash(errorTxt(error), "warn"); flash("Entrega borrada"); onCambio(false); };
  const pdf = async (tipo) => {
    setBusy(tipo);
    try {
      const m = await import("./pvPdf.js");
      const l = { ...lote, ...fila(), desde: qr ? lote.desde : desde, hasta: qr ? lote.hasta : hasta };
      if (tipo === "albaran") await m.pdfAlbaran({ ev, punto, lote: l });
      if (tipo === "liquidacion") await m.pdfLiquidacion({ ev, punto, lote: l });
      if (tipo === "talonario") {
        const { data, error } = await supabase.from("ticket_web_entradas").select("numero, qr_hex, estado, prueba").eq("pedido_id", lote.pedido_id).order("numero").range(0, 1999);
        if (error) throw error;
        const validas = (data || []).filter(x => x.estado === "valida" && x.qr_hex);
        if (!validas.length) throw new Error("No quedan entradas válidas en este talonario");
        await m.pdfTalonario({ ev, punto, lote: l, entradas: validas });
      }
    } catch (e) { flash(e?.message || "No se ha podido crear el PDF", "warn"); }
    setBusy("");
  };
  const fila2 = (t, v, c, fuerte) => <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "4px 0", fontWeight: fuerte ? 800 : 600, color: c || (fuerte ? "var(--text)" : "var(--muted)") }}><span>{t}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{v}</span></div>;
  return (
    <Sheet title={`${punto.nombre || "Punto de venta"} · nº ${lote.desde}–${lote.hasta}`} onClose={onClose} footer={
      <div style={{ display: "flex", gap: 8 }}>
        {borrar ? <><button onClick={quitar} disabled={!!busy} style={{ ...C.btnGhost, color: "var(--red)", borderColor: "var(--red)" }}>Sí, borrar</button><button onClick={() => setBorrar(false)} style={C.btnGhost}>No</button></>
          : <button onClick={() => setBorrar(true)} style={{ ...C.btnGhost, color: "var(--red)", padding: "0 14px" }} aria-label="Borrar entrega"><Icon n="trash" s={18} /></button>}
        <button onClick={() => guardar(true)} disabled={!!busy} style={{ ...C.btnPrimary, flex: 1, minHeight: 52 }}>{busy === "guardar" ? "Guardando…" : "Guardar"}</button>
      </div>}>
      {qr && <div style={{ ...C.card, padding: 12, marginBottom: 12, fontSize: 13.5, lineHeight: 1.45 }}>Talonario con QR de TIXFAST. Imprímelo y entrégalo; las entradas que te devuelva (él mismo desde su panel o tú apuntándolas abajo) quedan <b>anuladas</b> en la puerta.</div>}
      {!lote.vendidas_modo && <div style={{ ...C.card, padding: 12, marginBottom: 12, fontSize: 13.5, display: "flex", justifyContent: "space-between", gap: 10 }}><span>Registradas como vendidas por el punto</span><b style={{ color: "var(--green)" }}>{registradas} de {lote.hasta - lote.desde + 1}</b></div>}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1.3fr 1fr", gap: 10 }}>
        <Field l="Tipo de entrada"><input value={f.nombre} maxLength={80} onChange={e => set("nombre", e.target.value)} style={C.input} /></Field>
        <Field l="Precio de venta"><MoneyInput value={f.precio} onChange={(v) => set("precio", v)} /></Field>
      </div>
      {!qr && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field l="Desde el nº"><input inputMode="numeric" value={f.desde} onChange={e => set("desde", e.target.value.replace(/\D/g, "").slice(0, 7))} style={C.input} /></Field>
        <Field l="Hasta el nº"><input inputMode="numeric" value={f.hasta} onChange={e => set("hasta", e.target.value.replace(/\D/g, "").slice(0, 7))} style={C.input} /></Field>
      </div>}
      <Field l="Comisión del punto"><Comision tipo={f.comision_tipo} valor={f.comision_valor} onTipo={(v) => set("comision_tipo", v)} onValor={(v) => set("comision_valor", v)} /></Field>

      <Field l="Plazo para devolver las no vendidas">
        <input type="datetime-local" value={f.plazo || ""} onChange={e => set("plazo", e.target.value)} style={{ ...C.input, minWidth: 0, maxWidth: "100%", boxSizing: "border-box" }} />
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>Lo ve el punto en su panel. Al pasar, te avisamos aquí para que liquides.</div>
      </Field>
      <Field l="Liquidación">
        {qr ? (
          <label style={{ ...C.toggleRow, marginBottom: 8 }}><span>Liquidación cerrada (las no devueltas cuentan como vendidas)</span><input type="checkbox" checked={!!f.vendidas_modo} onChange={e => set("vendidas_modo", e.target.checked ? "devueltas" : null)} style={{ width: 22, height: 22, accentColor: "var(--accent)", flexShrink: 0 }} /></label>
        ) : (
          <Seg full valor={f.vendidas_modo || "nada"} onChange={(v) => set("vendidas_modo", v === "nada" ? null : v)} opciones={[{ k: "nada", t: "Sin liquidar" }, { k: "cantidad", t: "Ha vendido…" }, { k: "devueltas", t: "Me devuelve…" }]} />
        )}
        {modoLiq === "cantidad" && <input inputMode="numeric" value={f.vendidas} onChange={e => set("vendidas", e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="Nº de entradas vendidas" style={{ ...C.input, marginTop: 8 }} />}
        {(qr || modoLiq === "devueltas") && <>
          <input value={f.devTexto} onChange={e => set("devTexto", e.target.value)} placeholder={`Ej. ${Math.max(lote.desde, lote.hasta - 19)}-${lote.hasta} (vacío si no devuelve ninguna)`} style={{ ...C.input, marginTop: 8 }} />
          <div style={{ fontSize: 12.5, color: rangos.error ? "var(--red)" : "var(--muted)", marginTop: 4 }}>{rangos.error || "Números o rangos separados por comas. Las que no devuelva cuentan como vendidas."}</div>
        </>}
      </Field>

      <div style={{ ...C.card, padding: 12, marginBottom: 12, fontSize: 14 }}>
        {fila2("Entregadas", r.entregadas)}
        {modoLiq && fila2("Devueltas", r.devueltas)}
        {fila2("Vendidas", r.vendidas, null, true)}
        {fila2("Total vendido", money(r.total))}
        {fila2(`Comisión (${comisionCorta(f.comision_tipo, f.comision_valor)})`, "− " + money(r.comision))}
        {fila2("Te tiene que dar", money(r.aEntregar), null, true)}
        {modoLiq && fila2("Pendiente", money(r.pendiente), r.pendiente > 0 ? "var(--amber)" : "var(--green)", true)}
      </div>
      {modoLiq && <Field l="Ya te ha pagado">
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}><MoneyInput value={f.pagado} onChange={(v) => set("pagado", v)} /></div>
          <button type="button" onClick={() => set("pagado", coma(r.aEntregar))} style={{ ...C.btnGhost, minHeight: 44 }}>Todo</button>
        </div>
      </Field>}
      <Field l="Notas"><input value={f.notas || ""} maxLength={1000} onChange={e => set("notas", e.target.value)} style={C.input} /></Field>
      {qr && !lote.vendidas_modo && <div style={{ ...C.card, padding: 12, marginBottom: 12, fontSize: 13.5, lineHeight: 1.45 }}>
        <b>Última protección:</b> anula todas las que el punto no ha registrado como vendidas (y que no han entrado al evento). Úsalo solo si sabes que registró todas sus ventas: si vendió alguna sin registrarla, a esa persona no le valdrá la entrada.
        {anular === null && <button onClick={() => setAnular("preguntar")} disabled={!!busy} style={{ ...C.btnGhost, color: "var(--red)", borderColor: "var(--red)", minHeight: 44, marginTop: 8, display: "flex" }}>Anular las no registradas</button>}
        {anular === "preguntar" && <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}><button onClick={() => anularNoRegistradas(false)} disabled={!!busy} style={{ ...C.btnGhost, color: "var(--red)", borderColor: "var(--red)", minHeight: 44 }}>{busy === "anular" ? "Anulando…" : `Sí, anular ${Math.max(0, lote.hasta - lote.desde + 1 - registradas - r.devueltas)}`}</button><button onClick={() => setAnular(null)} style={{ ...C.btnGhost, minHeight: 44 }}>No</button></div>}
        {anular && anular.sinNumero && <div style={{ marginTop: 8 }}>
          <div style={{ color: "var(--amber)", fontWeight: 700 }}>El punto registró {anular.sinNumero} con «+1» (sin escanear): no sabemos qué números son. Si anulas, alguna de esas personas podría quedarse fuera. Mejor pídele que las escanee.</div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}><button onClick={() => anularNoRegistradas(true)} disabled={!!busy} style={{ ...C.btnGhost, color: "var(--red)", borderColor: "var(--red)", minHeight: 44 }}>Anular igualmente</button><button onClick={() => setAnular(null)} style={{ ...C.btnGhost, minHeight: 44 }}>No</button></div>
        </div>}
      </div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {qr && <button onClick={onImprenta} disabled={!!busy} style={{ ...C.btnPrimary, minHeight: 44 }}><Icon n="download" s={16} />PDF para imprenta</button>}
        {qr && <button onClick={() => pdf("talonario")} disabled={!!busy} style={{ ...C.btnGhost, minHeight: 44 }}><Icon n="download" s={16} />{busy === "talonario" ? "Creando…" : "A4 para imprimir en casa"}</button>}
        <button onClick={() => pdf("albaran")} disabled={!!busy} style={{ ...C.btnGhost, minHeight: 44 }}><Icon n="file" s={16} />{busy === "albaran" ? "Creando…" : "Albarán de entrega"}</button>
        {modoLiq && <button onClick={() => pdf("liquidacion")} disabled={!!busy} style={{ ...C.btnGhost, minHeight: 44 }}><Icon n="file" s={16} />{busy === "liquidacion" ? "Creando…" : "Liquidación"}</button>}
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>Los PDF usan lo que ves en pantalla; guarda para que quede apuntado. Todo pasa solo al CRM del evento.</div>
    </Sheet>
  );
}

// ===================== CRM · PUNTOS DE VENTA FÍSICOS =====================
// Tiendas, bares… a los que se dejan entradas para que las vendan. Por cada evento:
//  · Entregas: de la nº X a la nº Y, precio y comisión (en € por entrada o en %, editable siempre).
//    Con talonario propio (solo se apuntan los números) o con talonario de TIXFAST con QR (se valida en la puerta).
//  · Liquidación: cuántas ha vendido o qué números devuelve → total, su comisión, lo que te tiene que dar y lo pendiente.
//  · Todo pasa solo al CRM del evento: la venta como ingreso y la comisión como gasto.
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { money, useIsMobile, C, Icon, Sheet, Field, Seg, Tile, Badge, MoneyInput, parseImporte, hoy } from "./ui";
import { resumenLote, leerRangos, textoRangos, solapan } from "./pvCalc.js";

const num = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const coma = (v) => (v == null ? "" : String(v).replace(".", ","));
const comisionCorta = (t, v) => (t === "pct" ? `${coma(v)} %` : `${money(v)}/entrada`);
const MOTIVO = { sin_web: "Para generar entradas con QR, activa antes la venta online del evento (en Entradas › Eventos; puede quedarse en borrador).", cantidad: "Entre 1 y 2.000 entradas por talonario.", precio: "Revisa el precio.", evento: "Evento no válido.", punto: "Punto de venta no válido.", sesion: "Vuelve a entrar." };
const errorTxt = (e) => String(e?.message || e || "No se ha podido guardar").replace(/^.*?ERROR:\s*/, "");

export function PuntosVenta({ ev, flash }) {
  const isMobile = useIsMobile();
  const [puntos, setPuntos] = useState(null);
  const [lotes, setLotes] = useState([]);
  const [punto, setPunto] = useState(null);     // ficha en edición
  const [entrega, setEntrega] = useState(null); // nueva entrega
  const [lote, setLote] = useState(null);       // entrega abierta (liquidar)
  const cargar = async () => {
    const [p, l] = await Promise.all([
      supabase.from("ticket_pv").select("*").order("nombre"),
      ev?.id ? supabase.from("ticket_pv_lotes").select("*").eq("evento_id", ev.id).order("desde") : Promise.resolve({ data: [] }),
    ]);
    if (p.error) { setPuntos(false); return; }
    setPuntos(p.data || []); setLotes(l.data || []);
  };
  useEffect(() => { cargar(); }, [ev?.id]);
  const porPunto = useMemo(() => {
    const m = new Map();
    lotes.forEach(l => { const r = resumenLote(l); const a = m.get(l.pv_id) || { lotes: [], entregadas: 0, vendidas: 0, total: 0, comision: 0, pendiente: 0, sinLiquidar: 0 };
      a.lotes.push(l); a.entregadas += r.entregadas; a.vendidas += r.vendidas; a.total += r.total; a.comision += r.comision; a.pendiente += r.pendiente; if (!l.vendidas_modo) a.sinLiquidar++; m.set(l.pv_id, a); });
    return m;
  }, [lotes]);
  const T = [...porPunto.values()].reduce((t, a) => ({ entregadas: t.entregadas + a.entregadas, vendidas: t.vendidas + a.vendidas, total: t.total + a.total, comision: t.comision + a.comision, pendiente: t.pendiente + a.pendiente }), { entregadas: 0, vendidas: 0, total: 0, comision: 0, pendiente: 0 });

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
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(5, 1fr)", gap: 12, marginTop: 14 }}>
          {dato("Entregadas", T.entregadas)}{dato("Vendidas", T.vendidas)}{dato("Total vendido", money(T.total))}{dato("Comisiones", money(T.comision))}{dato("Te deben", money(T.pendiente), T.pendiente > 0 ? "var(--amber)" : "var(--green)")}
        </div>
      </section>

      {conLotes.length === 0 && <div style={C.empty}>Aún no has entregado entradas a ningún punto de venta en este evento.</div>}
      {conLotes.map(p => { const a = porPunto.get(p.id); return (
        <section key={p.id} style={{ ...C.panel, padding: isMobile ? 14 : 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Tile n="building" s={36} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nombre}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{a.entregadas} entregadas · {a.vendidas} vendidas{a.sinLiquidar ? ` · ${a.sinLiquidar} sin liquidar` : ""}</div>
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
                  <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)" }}>{money(l.precio)} · comisión {comisionCorta(l.comision_tipo, l.comision_valor)} · {l.vendidas_modo ? `${r.vendidas} vendidas · ${money(r.aEntregar)} a entregar` : "sin liquidar"}</span>
                </span>
                {l.vendidas_modo ? (r.pendiente > 0 ? <Badge c="var(--amber)">Debe {money(r.pendiente)}</Badge> : <Badge c="var(--green)">Pagado</Badge>) : <Badge>Liquidar</Badge>}
              </button>); })}
          </div>
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
      {lote && <Liquidacion ev={ev} lote={lote} punto={puntos.find(p => p.id === lote.pv_id) || {}} lotes={lotes} flash={flash} onClose={() => setLote(null)} onCambio={(sigue) => { cargar(); if (!sigue) setLote(null); }} />}
    </div>
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
      comision_tipo: f.comision_tipo, comision_valor: num(f.comision_valor), activo: f.activo !== false, actualizado_en: new Date().toISOString() };
    const r = p.id ? await supabase.from("ticket_pv").update(fila).eq("id", p.id) : await supabase.from("ticket_pv").insert(fila);
    setBusy(false);
    if (r.error) return flash(errorTxt(r.error), "warn");
    flash(p.id ? "Punto de venta guardado" : "Punto de venta creado"); onCambio();
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
function Liquidacion({ ev, lote, punto, lotes, flash, onClose, onCambio }) {
  const isMobile = useIsMobile();
  const [f, setF] = useState({ ...lote, precio: coma(lote.precio), comision_valor: coma(lote.comision_valor), pagado: coma(lote.pagado), vendidas: lote.vendidas ?? "", devTexto: textoRangos(lote.devueltas) });
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
  const fila = () => ({ nombre: String(f.nombre || "").trim() || "Entrada", precio: actual.precio, comision_tipo: f.comision_tipo, comision_valor: actual.comision_valor, pagado: actual.pagado,
    vendidas_modo: modoLiq || null, vendidas: modoLiq === "cantidad" ? actual.vendidas : null, devueltas: modoLiq === "devueltas" ? actual.devueltas : [], notas: f.notas || null,
    ...(qr ? {} : { desde, hasta }) });
  const guardar = async (cerrar = true) => {
    if (rangos.error) return flash(rangos.error, "warn");
    if (choca) return flash("Esa numeración se pisa con otra entrega", "warn");
    setBusy("guardar");
    const { error } = await supabase.from("ticket_pv_lotes").update(fila()).eq("id", lote.id);
    setBusy("");
    if (error) return flash(errorTxt(error), "warn");
    flash("Guardado"); onCambio(!cerrar);
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
      {qr && <div style={{ ...C.card, padding: 12, marginBottom: 12, fontSize: 13.5, lineHeight: 1.45 }}>Talonario con QR de TIXFAST. Imprímelo y entrégalo; las entradas que te devuelva, apúntalas abajo y quedarán <b>anuladas</b> en la puerta.</div>}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1.3fr 1fr", gap: 10 }}>
        <Field l="Tipo de entrada"><input value={f.nombre} maxLength={80} onChange={e => set("nombre", e.target.value)} style={C.input} /></Field>
        <Field l="Precio de venta"><MoneyInput value={f.precio} onChange={(v) => set("precio", v)} /></Field>
      </div>
      {!qr && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field l="Desde el nº"><input inputMode="numeric" value={f.desde} onChange={e => set("desde", e.target.value.replace(/\D/g, "").slice(0, 7))} style={C.input} /></Field>
        <Field l="Hasta el nº"><input inputMode="numeric" value={f.hasta} onChange={e => set("hasta", e.target.value.replace(/\D/g, "").slice(0, 7))} style={C.input} /></Field>
      </div>}
      <Field l="Comisión del punto"><Comision tipo={f.comision_tipo} valor={f.comision_valor} onTipo={(v) => set("comision_tipo", v)} onValor={(v) => set("comision_valor", v)} /></Field>

      <Field l="Liquidación">
        {qr ? (
          <label style={{ ...C.toggleRow, marginBottom: 8 }}><span>Ya me ha dicho qué devuelve</span><input type="checkbox" checked={!!f.vendidas_modo} onChange={e => set("vendidas_modo", e.target.checked ? "devueltas" : null)} style={{ width: 22, height: 22, accentColor: "var(--accent)" }} /></label>
        ) : (
          <Seg full valor={f.vendidas_modo || "nada"} onChange={(v) => set("vendidas_modo", v === "nada" ? null : v)} opciones={[{ k: "nada", t: "Sin liquidar" }, { k: "cantidad", t: "Ha vendido…" }, { k: "devueltas", t: "Me devuelve…" }]} />
        )}
        {modoLiq === "cantidad" && <input inputMode="numeric" value={f.vendidas} onChange={e => set("vendidas", e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="Nº de entradas vendidas" style={{ ...C.input, marginTop: 8 }} />}
        {modoLiq === "devueltas" && <>
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
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {qr && <button onClick={() => pdf("talonario")} disabled={!!busy} style={{ ...C.btnGhost, minHeight: 44 }}><Icon n="download" s={16} />{busy === "talonario" ? "Creando…" : "Talonario para imprimir"}</button>}
        <button onClick={() => pdf("albaran")} disabled={!!busy} style={{ ...C.btnGhost, minHeight: 44 }}><Icon n="file" s={16} />{busy === "albaran" ? "Creando…" : "Albarán de entrega"}</button>
        {modoLiq && <button onClick={() => pdf("liquidacion")} disabled={!!busy} style={{ ...C.btnGhost, minHeight: 44 }}><Icon n="file" s={16} />{busy === "liquidacion" ? "Creando…" : "Liquidación"}</button>}
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>Los PDF usan lo que ves en pantalla; guarda para que quede apuntado. Todo pasa solo al CRM del evento.</div>
    </Sheet>
  );
}

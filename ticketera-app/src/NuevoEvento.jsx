// ===================== NUEVO EVENTO (desde la pantalla de inicio o desde el CRM) =====================
// Crea el evento y lo deja elegido para trabajar ya en él (TPV y CRM). Puede copiar de otro evento:
//   · barras, productos, bonos/combos, plantilla del ticket y ajustes del TPV
//   · reservados: mesas (libres), tarifas, extras, promotores y socios
//   · venta de entradas online: ficha y tramos de precio (en borrador)
// Nunca copia ventas, cierres, ingresos ni gastos.
import React, { useMemo, useState } from "react";
import { Capa } from "./Capa";
import { uid } from "./supabase";
import * as db from "./db";
import { copiaDeEvento, ordenarEventos, estadoFecha } from "./eventos";
import { useAcceso, bloqueada, avisoNuevoEvento } from "./cuenta";
import { MODALIDADES, esMultipuesto } from "./multipuesto/modelo";

const aIso = (v) => { if (!v) return ""; const d = new Date(v); return isNaN(d) ? "" : d.toISOString(); };
const fecha = (d) => { try { return new Date(d + "T12:00").toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }); } catch { return d; } };
const K = {
  wrap: { position: "fixed", inset: 0, zIndex: 130, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "center", padding: 12 },
  card: { width: "100%", maxWidth: 520, maxHeight: "94dvh", overflow: "auto", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 20, padding: 18, boxSizing: "border-box" },
  label: { display: "block", fontSize: 12, color: "var(--muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: .8, margin: "14px 0 6px" },
  input: { width: "100%", boxSizing: "border-box", padding: "12px 13px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontSize: 16, font: "inherit" },
  check: (on) => ({ display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 12px", borderRadius: 12, border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`, background: on ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "var(--surface2)", cursor: "pointer", marginBottom: 6 }),
  btn: { minHeight: 52, borderRadius: 14, border: "none", fontWeight: 900, fontSize: 16, cursor: "pointer" },
};

export function NuevoEvento({ events, ev, flash, onCreado, onCerrar }) {
  const ordenados = useMemo(() => ordenarEventos(events), [events]);
  const [x, setX] = useState({ nombre: "", inicio: "", fin: "", recinto: ev?.venue || "", desde: ev?.id || "", barras: true, reservados: true, online: true, modalidad: esMultipuesto(ev) ? "multipuesto" : "estandar" });
  const [busy, setBusy] = useState(false);
  const acc = useAcceso();
  const avisoLimite = avisoNuevoEvento(acc, events);
  const sinRes = bloqueada(acc, "reservados"), sinOnline = bloqueada(acc, "entradas_online"), sinMulti = bloqueada(acc, "multipuesto");
  const set = (k, v) => setX(o => ({ ...o, [k]: v }));
  const src = events.find(e => e.id === x.desde) || null;
  const nProd = src ? src.puntos.filter(p => !p.archivado).reduce((t, p) => t + (p.products || []).length, 0) : 0;
  const nBarras = src ? src.puntos.filter(p => !p.archivado).length : 0;
  const res = src?.style?.reservados || {};
  const listo = x.nombre.trim().length >= 2 && !!x.inicio && (!x.fin || new Date(x.fin) > new Date(x.inicio));

  const crear = async () => {
    if (!listo || busy) return;
    if (avisoLimite) { flash(avisoLimite, "warn"); return; }
    setBusy(true);
    const datos = { name: x.nombre.trim().toUpperCase().slice(0, 80), date: x.inicio.slice(0, 10), startsAt: x.inicio, endsAt: aIso(x.fin), venue: x.recinto.trim() };
    const nuevo = src ? copiaDeEvento(src, datos, uid, { barras: x.barras, reservados: x.reservados })
      : { id: uid(), ...datos, template: "festival", paper: 80, footer: "", logo: "", showEventName: true, showDate: true, showTime: true, showPrice: true, anularPin: false, closed: false, style: {}, qrClave: "", puntos: [{ id: uid(), name: "Barra", archivado: false, fondo: null, fondoPrevisto: null, sortMode: "manual", estado: "prueba", products: [], combos: [] }] };
    // Modalidad: Multipuesto lleva siempre los tickets con QR (es lo que canjean los puestos)
    const mp = x.modalidad === "multipuesto" && !sinMulti;
    nuevo.style = { ...(nuevo.style || {}), modalidad: mp ? "multipuesto" : "estandar", ...(mp ? { qrDesde: Date.now() } : {}) };
    if (mp) nuevo.qrActivo = true;
    try { await db.crearEvento(nuevo); }
    catch (e) { flash(e?.mostrar ? e.message : "No se ha podido crear el evento", "warn"); setBusy(false); return; }
    // Lo demás se copia después (si algo falla, el evento ya existe y se avisa)
    const avisos = [];
    if (src && x.reservados && !sinRes) { try { const { copiarReservados } = await import("./reservados"); await copiarReservados(src.id, nuevo.id); } catch { avisos.push("los reservados"); } }
    let tramos = null;
    if (src && x.online && !sinOnline) { try { const crm = await import("./crm/crmdb"); tramos = await crm.webCopiarDe(src.id, { id: nuevo.id, name: nuevo.name }); } catch { avisos.push("la venta de entradas online"); } }
    const copiado = src ? [x.barras && `${nuevo.puntos.length} ${nuevo.puntos.length === 1 ? "barra" : "barras"} y ${nuevo.puntos.reduce((t, p) => t + p.products.length, 0)} productos`, x.reservados && !sinRes && (res.tarifas || []).length && "reservados", tramos && `${tramos} tramos de entradas`].filter(Boolean).join(", ") : "";
    flash(avisos.length ? `Evento creado, pero no se han podido copiar ${avisos.join(" ni ")}` : `✓ ${nuevo.name} creado${copiado ? ` · copiado: ${copiado}` : ""}`, avisos.length ? "warn" : undefined);
    setBusy(false);
    onCreado(nuevo);
  };

  return (<Capa>
    <div style={K.wrap} onClick={() => !busy && onCerrar()}>
      <div role="dialog" aria-modal="true" aria-label="Nuevo evento" style={K.card} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, fontWeight: 900, fontSize: 20 }}>➕ Nuevo evento</div>
          <button onClick={onCerrar} disabled={busy} aria-label="Cerrar" style={{ width: 42, height: 42, borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        <label style={K.label} htmlFor="ne-nombre">Nombre</label>
        <input id="ne-nombre" value={x.nombre} autoFocus maxLength={80} onChange={e => set("nombre", e.target.value)} placeholder="Ej.: AULA 69 - NAVIDAD" style={{ ...K.input, fontWeight: 800, textTransform: "uppercase" }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8 }}>
          <div><label style={K.label} htmlFor="ne-ini">Empieza</label><input id="ne-ini" type="datetime-local" value={x.inicio} onChange={e => set("inicio", e.target.value)} style={K.input} /></div>
          <div><label style={K.label} htmlFor="ne-fin">Termina (opcional)</label><input id="ne-fin" type="datetime-local" value={x.fin} onChange={e => set("fin", e.target.value)} style={K.input} /></div>
        </div>
        {x.fin && x.inicio && new Date(x.fin) <= new Date(x.inicio) && <div style={{ fontSize: 12.5, color: "var(--red)", marginTop: 6 }}>La hora de fin es anterior al inicio (si acaba de madrugada, es el día siguiente).</div>}
        <label style={K.label} htmlFor="ne-rec">Recinto</label>
        <input id="ne-rec" value={x.recinto} maxLength={120} onChange={e => set("recinto", e.target.value)} placeholder="Sala, ciudad…" style={K.input} />

        <div style={K.label}>Modalidad</div>
        <div role="radiogroup" aria-label="Modalidad del evento" style={{ display: "grid", gap: 6 }}>
          {Object.entries(MODALIDADES).map(([k, m]) => { const bloq = k === "multipuesto" && sinMulti; return (
            <label key={k} style={{ ...K.check(x.modalidad === k), opacity: bloq ? .55 : 1, cursor: bloq ? "not-allowed" : "pointer" }}>
              <input type="radio" name="ne-modalidad" checked={x.modalidad === k} disabled={bloq} onChange={() => set("modalidad", k)} style={{ marginTop: 3 }} />
              <span><b>{m.t}</b>{bloq && <span style={{ fontSize: 12, color: "var(--amber)" }}> · no incluido en tu plan</span>}<span style={{ display: "block", fontSize: 12.5, color: "var(--muted)" }}>{m.d}</span></span></label>); })}
        </div>

        <label style={K.label} htmlFor="ne-desde">Copiar la configuración de</label>
        <select id="ne-desde" value={x.desde} onChange={e => set("desde", e.target.value)} style={K.input}>
          <option value="">— Empezar de cero (una barra vacía) —</option>
          {ordenados.map(e => { const st = estadoFecha(e); return <option key={e.id} value={e.id}>{e.name} · {fecha(e.date)}{st.k === "pasado" ? "" : ` · ${st.t.toLowerCase()}`}</option>; })}
        </select>
        {src && <div style={{ marginTop: 10 }}>
          <label style={K.check(x.barras)}><input type="checkbox" checked={x.barras} onChange={e => set("barras", e.target.checked)} style={{ marginTop: 3 }} /><span><b>Barras, productos y precios del TPV</b><span style={{ display: "block", fontSize: 12.5, color: "var(--muted)" }}>{nBarras} barras · {nProd} productos, con sus bonos, colores, plantilla del ticket y ajustes</span></span></label>
          {!sinRes && <label style={K.check(x.reservados)}><input type="checkbox" checked={x.reservados} onChange={e => set("reservados", e.target.checked)} style={{ marginTop: 3 }} /><span><b>Reservados VIP</b><span style={{ display: "block", fontSize: 12.5, color: "var(--muted)" }}>Mesas (libres), {(res.tarifas || []).length} tarifas, extras, promotores y socios</span></span></label>}
          {!sinOnline && <label style={K.check(x.online)}><input type="checkbox" checked={x.online} onChange={e => set("online", e.target.checked)} style={{ marginTop: 3 }} /><span><b>Tarifas de entradas online</b><span style={{ display: "block", fontSize: 12.5, color: "var(--muted)" }}>Ficha y tramos de precio, en borrador (si el evento tenía venta online)</span></span></label>}
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>No se copian ventas, cierres, ingresos ni gastos: cada fiesta empieza con sus cuentas a cero.</div>
        </div>}
        {avisoLimite && <div style={{ marginTop: 14, padding: "11px 12px", borderRadius: 12, border: "1px solid var(--amber)", color: "var(--amber)", fontSize: 13.5, fontWeight: 700 }}>🔒 {avisoLimite}</div>}
        <button onClick={crear} disabled={!listo || busy || !!avisoLimite} style={{ ...K.btn, width: "100%", marginTop: 16, background: "var(--accent)", color: "#fff", opacity: listo && !busy && !avisoLimite ? 1 : .45 }}>{avisoLimite ? "🔒 Límite del plan alcanzado" : busy ? "Creando…" : listo ? `Crear ${x.nombre.trim().toUpperCase().slice(0, 30)}` : "Pon el nombre y cuándo empieza"}</button>
      </div>
    </div>
  </Capa>);
}

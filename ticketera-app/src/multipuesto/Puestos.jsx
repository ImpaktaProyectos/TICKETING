// ===================== MULTIPUESTO · PUESTOS DEL EVENTO (organizador) =====================
// Alta de cada puesto (food truck, caseta, proveedor), qué productos puede canjear, la comisión del
// organizador (general y, si hace falta, por producto) y la ACTIVACIÓN de sus móviles: QR que se
// escanea allí mismo (15 min) o enlace que se envía (24 h), de un solo uso. La primera vez el puesto
// crea su propio PIN (la organización no lo ve) y cada 12 h se lo pide el móvil. Si lo olvida, se
// borra aquí y lo vuelve a crear al activar otra vez un móvil.
import React, { useEffect, useMemo, useState } from "react";
import { Capa } from "../Capa";
import { supabase } from "../supabase";
import QrCodigo from "../qr/QrCodigo";
import { useAcceso, puede, hoyLocal } from "../cuenta";
import { Escaparate } from "../Escaparate";
import { consumicionesDelEvento, textoComision, validarPuesto } from "./modelo";

const COLORES = ["#ff5a3c", "#a855f7", "#3b82f6", "#22d3a6", "#ffb400", "#ec4899", "#14b8a6", "#f97316"];
const K = {
  panel: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 14, boxSizing: "border-box" },
  btn: { minHeight: 44, padding: "0 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontWeight: 800, fontSize: 14, cursor: "pointer" },
  prim: { minHeight: 50, padding: "0 16px", borderRadius: 14, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 900, fontSize: 15.5, cursor: "pointer" },
  input: { width: "100%", boxSizing: "border-box", minHeight: 46, padding: "0 12px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontSize: 16, font: "inherit" },
  lbl: { display: "block", fontSize: 12, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: .7, margin: "14px 0 6px" },
  badge: (c) => ({ display: "inline-block", fontSize: 11.5, fontWeight: 900, color: c, border: `1px solid ${c}`, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }),
  hojaWrap: { position: "fixed", inset: 0, zIndex: 170, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "end center" },
  hoja: { width: "100%", maxWidth: 620, maxHeight: "94dvh", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "22px 22px 0 0", boxSizing: "border-box" },
};
const fechaHora = (iso) => { try { return new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
async function rpc(nombre, args) {
  const { data, error } = await supabase.rpc(nombre, args);
  if (error) throw Object.assign(new Error(String(error.message || "").startsWith("TIXFAST: ") ? error.message.slice(9) : navigator.onLine ? "No se ha podido completar" : "Sin conexión: hace falta internet"), { mostrar: true });
  return data;
}
export const enlacePuesto = (token) => `${window.location.origin}/p/${token}`;

export function Puestos({ ev, flash }) {
  const acc = useAcceso();
  const [lista, setLista] = useState(null);
  const [editar, setEditar] = useState(null);     // puesto (o {} nuevo)
  const [activar, setActivar] = useState(null);   // { puesto, codigo, caduca_en, minutos }
  const [busy, setBusy] = useState(false);
  const cargar = () => rpc("puestos_evento", { p_evento: ev.id }).then(x => setLista(x || [])).catch(() => setLista(false));
  useEffect(() => { setLista(null); cargar(); }, [ev.id]);
  const consumiciones = useMemo(() => consumicionesDelEvento(ev), [ev]);
  const nombreDe = (clave) => consumiciones.find(c => c.clave === clave)?.nombre || clave;
  const hacer = async (fn, ok) => { if (busy) return; setBusy(true); try { const r = await fn(); if (ok) flash(typeof ok === "function" ? ok(r) : ok); await cargar(); return r; } catch (e) { flash(e?.mostrar ? e.message : "No se ha podido completar", "warn"); } finally { setBusy(false); } };
  const vincular = async (p, minutos = 15) => { const r = await hacer(() => rpc("puesto_codigo_activar", { p_puesto: p.id, p_minutos: minutos })); if (r?.codigo) setActivar({ puesto: p, codigo: r.codigo, caduca_en: r.caduca_en, minutos }); };
  const borrarPin = (p) => window.confirm(`¿Borrar el PIN de ${p.nombre}?\n\nSus móviles siguen vinculados. Cuando actives un móvil con el QR o el enlace, el puesto creará un PIN nuevo.`)
    && hacer(() => rpc("puesto_borrar_pin", { p_puesto: p.id }), "✓ PIN borrado: se creará uno nuevo al activar un móvil");

  return (<Escaparate activo={!puede(acc, "multipuesto", ev, hoyLocal())} funcion="multipuesto">
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.45 }}>
        Activa el móvil de cada puesto con un <b style={{ color: "var(--text)" }}>QR o un enlace de un solo uso</b>. La primera vez el puesto crea <b style={{ color: "var(--text)" }}>su propio PIN</b>, que su móvil le pide cada 12 horas. Solo puede canjear los productos que le marques, cada canje queda con su hora exacta y él solo ve lo suyo.
      </div>
      {!consumiciones.length && <div style={{ ...K.panel, borderColor: "var(--amber)", fontSize: 14 }}>Primero crea en tus cajas los productos que se venden (por ejemplo «Hamburguesa»). Luego podrás elegir qué puesto canjea cada uno.</div>}
      {lista === null && <div style={{ color: "var(--muted)" }}>Cargando puestos…</div>}
      {lista === false && <div style={{ ...K.panel, color: "var(--red)" }}>No se han podido cargar los puestos. Revisa la conexión.</div>}
      {lista && !lista.length && <div style={{ ...K.panel, color: "var(--muted)" }}>Aún no hay puestos. Añade el primero (por ejemplo «Burger House»).</div>}
      {lista && lista.map(p => (
        <div key={p.id} style={{ ...K.panel, borderLeft: `5px solid ${p.color}`, opacity: p.activo ? 1 : .7 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <b style={{ fontSize: 16.5 }}>{p.nombre}</b>
            {!p.activo && <span style={K.badge("var(--muted)")}>Desactivado</span>}
            {p.bloqueado && <span style={K.badge("var(--red)")}>Bloqueado por PIN</span>}
            {p.activo && <span style={K.badge(p.tiene_pin ? "var(--green)" : "var(--muted)")}>{p.tiene_pin ? "PIN creado" : "Sin PIN aún"}</span>}
            <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--muted)" }}>{p.canjes} {p.canjes === 1 ? "canje" : "canjes"}</span>
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>Tu comisión: <b style={{ color: "var(--text)" }}>{textoComision({ tipo: p.comision_tipo, valor: p.comision_valor })}</b>{p.contacto ? ` · ${p.contacto}` : ""}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {p.productos.length ? p.productos.map(x => <span key={x.consumicion} style={{ fontSize: 12.5, padding: "4px 9px", borderRadius: 999, background: "var(--surface2)", border: "1px solid var(--line)" }}>
              {nombreDe(x.consumicion)}{x.comision_tipo ? ` · ${textoComision({ tipo: x.comision_tipo, valor: x.comision_valor })}` : ""}</span>)
              : <span style={{ fontSize: 13, color: "var(--amber)" }}>No puede canjear nada todavía</span>}
          </div>
          <div style={{ fontSize: 12.5, marginTop: 8, color: p.sesiones ? "var(--muted)" : "var(--amber)" }}>
            {p.sesiones ? `${p.sesiones} ${p.sesiones === 1 ? "móvil vinculado" : "móviles vinculados"}${p.ultimo_uso ? ` · último uso ${fechaHora(p.ultimo_uso)}` : ""}` : "Ningún móvil vinculado: actívalo con el QR o envíale el enlace de activación."}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            <button disabled={busy} onClick={() => setEditar(p)} style={{ ...K.btn, flex: "1 1 100px", borderColor: "var(--accent)", color: "var(--accent)" }}>Editar</button>
            {p.activo && <button disabled={busy} onClick={() => vincular(p, 15)} style={{ ...K.btn, flex: "1 1 160px", minHeight: 50, borderColor: "var(--green)", color: "var(--green)" }}>📲 Activar móvil con QR</button>}
            {p.activo && <button disabled={busy} onClick={() => vincular(p, 1440)} style={{ ...K.btn, flex: "1 1 160px", minHeight: 50 }}>✉️ Enviar enlace de activación</button>}
            {p.tiene_pin && <button disabled={busy} onClick={() => borrarPin(p)} style={{ ...K.btn, flex: "1 1 130px" }}>Borrar PIN</button>}
            {p.sesiones > 0 && <button disabled={busy} onClick={() => window.confirm(`¿Desvincular ${p.sesiones === 1 ? "el móvil" : `los ${p.sesiones} móviles`} de ${p.nombre}? Para volver a usarlos hará falta activarlos otra vez.`) && hacer(() => rpc("puesto_cerrar_sesiones", { p_puesto: p.id }), "✓ Móviles desvinculados")} style={{ ...K.btn, flex: "1 1 130px" }}>Desvincular móviles</button>}
          </div>
        </div>))}
      <button disabled={busy || lista === null || lista === false} onClick={() => setEditar({})} style={K.prim}>+ Añadir puesto</button>
    </div>
    {editar && <EditorPuesto ev={ev} puesto={editar} consumiciones={consumiciones} flash={flash} onCerrar={(cambio) => { setEditar(null); if (cambio) cargar(); }} />}
    {activar && <HojaActivar {...activar} ev={ev} onOtro={() => vincular(activar.puesto, activar.minutos)} onCerrar={() => { setActivar(null); cargar(); }} />}
  </Escaparate>);
}

function EditorPuesto({ ev, puesto, consumiciones, flash, onCerrar }) {
  const nuevo = !puesto.id;
  const [f, setF] = useState(() => ({
    id: puesto.id || null, nombre: puesto.nombre || "", color: puesto.color || COLORES[0], contacto: puesto.contacto || "", activo: puesto.activo !== false,
    comision_tipo: puesto.comision_tipo || "pct", comision_valor: puesto.comision_valor != null ? String(puesto.comision_valor).replace(".", ",") : "",
    productos: (puesto.productos || []).map(x => ({ ...x, comision_valor: x.comision_valor != null ? String(x.comision_valor).replace(".", ",") : "" })),
  }));
  const [errores, setErrores] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(o => ({ ...o, [k]: v }));
  const marcado = (clave) => f.productos.find(x => x.consumicion === clave);
  const toggle = (c) => setF(o => ({ ...o, productos: marcado(c.clave) ? o.productos.filter(x => x.consumicion !== c.clave) : [...o.productos, { consumicion: c.clave, nombre: c.nombre }] }));
  const setProd = (clave, patch) => setF(o => ({ ...o, productos: o.productos.map(x => x.consumicion === clave ? { ...x, ...patch } : x) }));
  // Productos que ya aceptaba pero que ahora no se venden en ninguna caja (se conservan)
  const huerfanos = f.productos.filter(x => !consumiciones.some(c => c.clave === x.consumicion));
  const guardar = async () => {
    const { errores: e, datos } = validarPuesto({ ...f, comision_valor: f.comision_valor === "" ? "0" : f.comision_valor });
    if (e.length) { setErrores(e); return; }
    if (!nuevo && puesto.activo && !datos.activo && !window.confirm(`¿Desactivar ${datos.nombre}? Se cierra su sesión al momento y no podrá canjear. Su registro se conserva.`)) return;
    setBusy(true); setErrores([]);
    try { await rpc("puesto_guardar", { p: { ...datos, evento_id: ev.id } }); flash(nuevo ? `✓ ${datos.nombre} añadido. Ahora activa su móvil con el QR o envíale el enlace.` : `✓ ${datos.nombre} guardado`); onCerrar(true); }
    catch (er) { setErrores([er.message]); setBusy(false); }
  };
  const borrar = async () => {
    if (!window.confirm(puesto.canjes ? `${puesto.nombre} ya ha canjeado tickets: se desactivará y su registro se conserva. ¿Seguir?` : `¿Borrar ${puesto.nombre}?`)) return;
    setBusy(true);
    try { const r = await rpc("puesto_borrar", { p_puesto: puesto.id }); flash(r?.resultado === "borrado" ? "✓ Puesto borrado" : "✓ Puesto desactivado"); onCerrar(true); }
    catch (er) { setErrores([er.message]); setBusy(false); }
  };
  const Tipo = ({ valor, onChange }) => <div role="radiogroup" style={{ display: "flex", gap: 4 }}>
    {[["pct", "%"], ["fijo", "€ / unidad"]].map(([k, t]) => <button key={k} type="button" role="radio" aria-checked={valor === k} onClick={() => onChange(k)}
      style={{ ...K.btn, padding: "0 10px", borderColor: valor === k ? "var(--accent)" : "var(--line)", color: valor === k ? "var(--accent)" : "var(--text)" }}>{t}</button>)}</div>;

  return (<Capa>
    <div style={K.hojaWrap} onClick={() => !busy && onCerrar(false)}>
      <div role="dialog" aria-modal="true" aria-label={nuevo ? "Nuevo puesto" : `Editar ${puesto.nombre}`} onClick={e => e.stopPropagation()} style={K.hoja}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px 10px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ flex: 1, fontWeight: 900, fontSize: 18 }}>{nuevo ? "Nuevo puesto" : puesto.nombre}</div>
          <button onClick={() => onCerrar(false)} disabled={busy} style={K.btn} aria-label="Cerrar">✕</button>
        </div>
        <div data-scroll style={{ flex: 1, overflow: "auto", overscrollBehavior: "contain", padding: "4px 16px 16px" }}>
          <label style={K.lbl} htmlFor="pu-nombre">Nombre</label>
          <input id="pu-nombre" value={f.nombre} maxLength={60} onChange={e => set("nombre", e.target.value)} placeholder="Ej.: Burger House" style={K.input} />
          <div style={K.lbl}>Color</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{COLORES.map(c => <button key={c} type="button" onClick={() => set("color", c)} aria-label={`Color ${c}`} aria-pressed={f.color === c}
            style={{ width: 44, height: 44, borderRadius: 12, background: c, border: f.color === c ? "3px solid var(--text)" : "2px solid transparent", cursor: "pointer" }} />)}</div>
          <label style={K.lbl} htmlFor="pu-contacto">Contacto (opcional)</label>
          <input id="pu-contacto" value={f.contacto} maxLength={120} onChange={e => set("contacto", e.target.value)} placeholder="Teléfono o persona responsable" style={K.input} />

          <div style={K.lbl}>Tu comisión general</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Tipo valor={f.comision_tipo} onChange={(v) => set("comision_tipo", v)} />
            <input value={f.comision_valor} inputMode="decimal" placeholder="0" aria-label="Comisión general" onChange={e => set("comision_valor", e.target.value.replace(/[^\d.,]/g, "").slice(0, 8))} style={{ ...K.input, flex: "1 1 110px", width: "auto" }} />
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>{f.comision_tipo === "pct" ? "Porcentaje del precio de venta que se queda la organización." : "Euros que se queda la organización por cada unidad entregada."} El puesto ve lo que factura ya con la comisión quitada.</div>

          <div style={K.lbl}>Qué productos puede canjear</div>
          {!consumiciones.length && <div style={{ fontSize: 13.5, color: "var(--amber)" }}>Aún no hay productos en las cajas de este evento.</div>}
          <div style={{ display: "grid", gap: 6 }}>
            {consumiciones.map(c => { const m = marcado(c.clave); const ef = m?.comision_tipo ? { tipo: m.comision_tipo, valor: m.comision_valor } : { tipo: f.comision_tipo, valor: f.comision_valor || 0 }; return (
              <div key={c.clave} style={{ border: `1px solid ${m ? "var(--accent)" : "var(--line)"}`, borderRadius: 12, background: "var(--surface2)", padding: 10 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", minHeight: 32 }}>
                  <input type="checkbox" checked={!!m} onChange={() => toggle(c)} style={{ width: 22, height: 22, accentColor: "var(--accent)", flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0 }}><b>{c.nombre}</b><span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>{c.precio != null ? (c.precio === c.precioMax ? `${c.precio.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}` : `de ${c.precio} a ${c.precioMax} €`) : ""} · {c.cajas.join(", ")}</span></span>
                </label>
                {m && <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", minHeight: 40 }}>
                    <input type="checkbox" checked={!!m.comision_tipo} onChange={e => setProd(c.clave, e.target.checked ? { comision_tipo: f.comision_tipo, comision_valor: f.comision_valor } : { comision_tipo: null, comision_valor: "" })} style={{ width: 20, height: 20, accentColor: "var(--accent)" }} />
                    Comisión propia</label>
                  {m.comision_tipo ? <>
                    <Tipo valor={m.comision_tipo} onChange={(v) => setProd(c.clave, { comision_tipo: v })} />
                    <input value={m.comision_valor} inputMode="decimal" aria-label={`Comisión de ${c.nombre}`} onChange={e => setProd(c.clave, { comision_valor: e.target.value.replace(/[^\d.,]/g, "").slice(0, 8) })} style={{ ...K.input, minHeight: 44, flex: "1 1 90px", width: "auto" }} />
                  </> : <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Usa la general ({textoComision({ tipo: ef.tipo, valor: Number(String(ef.valor).replace(",", ".")) || 0 })})</span>}
                </div>}
              </div>); })}
            {huerfanos.map(x => <div key={x.consumicion} style={{ fontSize: 13, color: "var(--muted)", border: "1px dashed var(--line)", borderRadius: 12, padding: 10, display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ flex: 1 }}>«{x.consumicion}» (ya no está en ninguna caja)</span>
              <button type="button" onClick={() => setF(o => ({ ...o, productos: o.productos.filter(y => y.consumicion !== x.consumicion) }))} style={{ ...K.btn, minHeight: 40 }}>Quitar</button></div>)}
          </div>

          {!nuevo && <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, cursor: "pointer", minHeight: 44 }}>
            <input type="checkbox" checked={f.activo} onChange={e => set("activo", e.target.checked)} style={{ width: 22, height: 22, accentColor: "var(--accent)" }} />
            <span><b>Activo</b><span style={{ display: "block", fontSize: 12.5, color: "var(--muted)" }}>Desactivado no puede entrar ni canjear (su registro se conserva).</span></span>
          </label>}
          {!nuevo && <button type="button" disabled={busy} onClick={borrar} style={{ ...K.btn, width: "100%", marginTop: 14, color: "var(--red)" }}>{puesto.canjes ? "Desactivar puesto" : "Borrar puesto"}</button>}
        </div>
        <div style={{ borderTop: "1px solid var(--line)", padding: "10px 16px calc(12px + env(safe-area-inset-bottom))" }}>
          {errores.length > 0 && <div role="alert" style={{ color: "var(--red)", fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>{errores.map((x, i) => <div key={i}>{x}</div>)}</div>}
          <button onClick={guardar} disabled={busy} style={{ ...K.prim, width: "100%", opacity: busy ? .5 : 1 }}>{busy ? "Guardando…" : nuevo ? "Añadir puesto" : "Guardar"}</button>
        </div>
      </div>
    </div>
  </Capa>);
}

// Activación de un móvil del puesto: un solo uso. QR para escanearlo allí (15 min) o enlace para enviarlo (24 h)
function HojaActivar({ puesto, codigo, caduca_en, minutos, ev, onOtro, onCerrar }) {
  const url = `${window.location.origin}/p/activar?c=${encodeURIComponent(codigo)}`;
  const enlace = minutos > 15;
  const [queda, setQueda] = useState(() => Math.max(0, new Date(caduca_en) - Date.now()));
  const [copiado, setCopiado] = useState(false);
  useEffect(() => { const t = setInterval(() => setQueda(Math.max(0, new Date(caduca_en) - Date.now())), 1000); return () => clearInterval(t); }, [caduca_en]);
  const h = Math.floor(queda / 3600000), min = Math.floor((queda % 3600000) / 60000), seg = Math.floor((queda % 60000) / 1000);
  const tiempo = h ? `${h} h ${min} min` : `${min}:${String(seg).padStart(2, "0")}`;
  const copiar = async () => { try { await navigator.clipboard.writeText(url); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { window.prompt("Copia el enlace:", url); } };
  const wa = `https://wa.me/?text=${encodeURIComponent(`Activa el móvil de ${puesto.nombre} para canjear los tickets de ${ev?.name || "el evento"} en TIXFAST. Ábrelo en el móvil del puesto (vale una sola vez):\n${url}`)}`;
  return (<Capa>
    <div style={K.hojaWrap} onClick={onCerrar}>
      <div role="dialog" aria-modal="true" aria-label={`Activar un móvil de ${puesto.nombre}`} onClick={e => e.stopPropagation()} style={K.hoja}>
        <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--line)", display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ flex: 1 }}><div style={{ fontWeight: 900, fontSize: 18 }}>{enlace ? "Enlace de activación" : "Activar un móvil"} · {puesto.nombre}</div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>{enlace ? "Envíalo al puesto: lo abre en su móvil y entra." : "Que lo escaneen con la cámara del móvil o tablet del puesto."} {puesto.tiene_pin ? "Entra directo." : "La primera vez creará su PIN."}</div></div>
          <button onClick={onCerrar} style={K.btn} aria-label="Cerrar">✕</button>
        </div>
        <div data-scroll style={{ flex: 1, overflow: "auto", padding: 16, textAlign: "center" }}>
          {queda > 0 ? <>
            {!enlace && <div style={{ display: "inline-block", background: "#fff", padding: 12, borderRadius: 16 }}><QrCodigo texto={url} mm={62} margen={1} /></div>}
            {enlace && <div style={{ display: "grid", gap: 8, textAlign: "left" }}>
              <div style={{ fontSize: 13, color: "var(--muted)", overflowWrap: "anywhere", padding: 12, border: "1px dashed var(--line)", borderRadius: 12 }}>{url}</div>
              <a href={wa} target="_blank" rel="noopener noreferrer" style={{ ...K.prim, display: "grid", placeItems: "center", textDecoration: "none" }}>Enviar por WhatsApp</a>
              <button onClick={copiar} style={K.btn}>{copiado ? "✓ Copiado" : "Copiar enlace"}</button>
            </div>}
            <div style={{ fontSize: 15, fontWeight: 800, marginTop: 12 }}>Vale una sola vez · caduca en {tiempo}</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6, lineHeight: 1.45 }}>El móvil queda vinculado todo el evento y pide el PIN del puesto cada 12 horas. Para otro móvil, genera otro {enlace ? "enlace" : "QR"}.</div>
          </> : <div style={{ fontSize: 15, color: "var(--amber)", fontWeight: 800, padding: "30px 0" }}>Ha caducado. Genera otro.</div>}
        </div>
        <div style={{ borderTop: "1px solid var(--line)", padding: "10px 16px calc(12px + env(safe-area-inset-bottom))", display: "flex", gap: 8 }}>
          <button onClick={onOtro} style={{ ...K.btn, flex: 1 }}>{enlace ? "Otro enlace" : "Otro QR"} (otro móvil)</button>
          <button onClick={onCerrar} style={{ ...K.prim, flex: 1 }}>Hecho</button>
        </div>
      </div>
    </div>
  </Capa>);
}

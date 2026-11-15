// ===================== MULTIPUESTO · PUESTOS DEL EVENTO (organizador) =====================
// Alta de cada puesto (food truck, caseta, proveedor), qué productos puede canjear, la comisión del
// organizador (general y, si hace falta, por producto) y su acceso: enlace + PIN. El enlace y el PIN
// solo se enseñan al crearlos (en la base de datos solo queda su huella); si se pierden, se generan
// otros y los anteriores dejan de valer al momento, igual que las sesiones abiertas.
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
  const [acceso, setAcceso] = useState(null);     // { puesto, token, pin }
  const [busy, setBusy] = useState(false);
  const cargar = () => rpc("puestos_evento", { p_evento: ev.id }).then(x => setLista(x || [])).catch(() => setLista(false));
  useEffect(() => { setLista(null); cargar(); }, [ev.id]);
  const consumiciones = useMemo(() => consumicionesDelEvento(ev), [ev]);
  const nombreDe = (clave) => consumiciones.find(c => c.clave === clave)?.nombre || clave;
  const hacer = async (fn, ok) => { if (busy) return; setBusy(true); try { const r = await fn(); if (ok) flash(typeof ok === "function" ? ok(r) : ok); await cargar(); return r; } catch (e) { flash(e?.mostrar ? e.message : "No se ha podido completar", "warn"); } finally { setBusy(false); } };
  const nuevoAcceso = async (p) => {
    if (p.acceso && !window.confirm(`¿Crear un acceso nuevo para ${p.nombre}?\n\nEl enlace y el PIN anteriores dejan de valer al momento y se cierran sus ${p.sesiones || 0} sesiones abiertas.`)) return;
    const r = await hacer(() => rpc("puesto_acceso_nuevo", { p_puesto: p.id }));
    if (r?.token) setAcceso({ puesto: p, token: r.token, pin: r.pin });
  };

  return (<Escaparate activo={!puede(acc, "multipuesto", ev, hoyLocal())} funcion="multipuesto">
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.45 }}>
        Cada puesto entra con <b style={{ color: "var(--text)" }}>su enlace y su PIN</b> y solo puede canjear los productos que le marques. Lo que canjea se atribuye a ese puesto, con la hora exacta. Él solo ve lo suyo.
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
            <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--muted)" }}>{p.canjes} {p.canjes === 1 ? "canje" : "canjes"}</span>
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>Tu comisión: <b style={{ color: "var(--text)" }}>{textoComision({ tipo: p.comision_tipo, valor: p.comision_valor })}</b>{p.contacto ? ` · ${p.contacto}` : ""}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {p.productos.length ? p.productos.map(x => <span key={x.consumicion} style={{ fontSize: 12.5, padding: "4px 9px", borderRadius: 999, background: "var(--surface2)", border: "1px solid var(--line)" }}>
              {nombreDe(x.consumicion)}{x.comision_tipo ? ` · ${textoComision({ tipo: x.comision_tipo, valor: x.comision_valor })}` : ""}</span>)
              : <span style={{ fontSize: 13, color: "var(--amber)" }}>No puede canjear nada todavía</span>}
          </div>
          <div style={{ fontSize: 12.5, marginTop: 8, color: p.acceso ? "var(--muted)" : "var(--amber)" }}>
            {p.acceso ? `Acceso creado el ${fechaHora(p.acceso_creado_en)} · ${p.sesiones} ${p.sesiones === 1 ? "móvil conectado" : "móviles conectados"}${p.ultimo_uso ? ` · último uso ${fechaHora(p.ultimo_uso)}` : ""}` : "Sin acceso: crea su enlace y su PIN para que pueda escanear."}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            <button disabled={busy} onClick={() => setEditar(p)} style={{ ...K.btn, flex: "1 1 100px", borderColor: "var(--accent)", color: "var(--accent)" }}>Editar</button>
            {p.activo && <button disabled={busy} onClick={() => nuevoAcceso(p)} style={{ ...K.btn, flex: "1 1 150px" }}>{p.acceso ? "Nuevo enlace y PIN" : "Crear enlace y PIN"}</button>}
            {p.sesiones > 0 && <button disabled={busy} onClick={() => window.confirm(`¿Cerrar la sesión de ${p.nombre} en ${p.sesiones === 1 ? "su móvil" : `sus ${p.sesiones} móviles`}? Tendrán que volver a poner el PIN.`) && hacer(() => rpc("puesto_cerrar_sesiones", { p_puesto: p.id }), "✓ Sesiones cerradas")} style={{ ...K.btn, flex: "1 1 130px" }}>Cerrar sesiones</button>}
          </div>
        </div>))}
      <button disabled={busy || lista === null || lista === false} onClick={() => setEditar({})} style={K.prim}>+ Añadir puesto</button>
    </div>
    {editar && <EditorPuesto ev={ev} puesto={editar} consumiciones={consumiciones} flash={flash} onCerrar={(cambio) => { setEditar(null); if (cambio) cargar(); }} />}
    {acceso && <HojaAcceso {...acceso} ev={ev} onCerrar={() => setAcceso(null)} />}
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
    try { await rpc("puesto_guardar", { p: { ...datos, evento_id: ev.id } }); flash(nuevo ? `✓ ${datos.nombre} añadido. Ahora crea su enlace y su PIN.` : `✓ ${datos.nombre} guardado`); onCerrar(true); }
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

// Enlace + PIN recién creados: se enseñan UNA vez
function HojaAcceso({ puesto, token, pin, ev, onCerrar }) {
  const url = enlacePuesto(token);
  const [copiado, setCopiado] = useState(null);
  const copiar = async (txt, que) => { try { await navigator.clipboard.writeText(txt); setCopiado(que); setTimeout(() => setCopiado(null), 2000); } catch { window.prompt("Copia esto:", txt); } };
  const wa = (txt) => `https://wa.me/?text=${encodeURIComponent(txt)}`;
  return (<Capa>
    <div style={K.hojaWrap}>
      <div role="dialog" aria-modal="true" aria-label={`Acceso de ${puesto.nombre}`} style={K.hoja}>
        <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ fontWeight: 900, fontSize: 18 }}>Acceso de {puesto.nombre}</div>
          <div style={{ fontSize: 13, color: "var(--amber)", marginTop: 4, fontWeight: 700 }}>Por seguridad, el enlace y el PIN no se vuelven a mostrar. Si se pierden, crea otros.</div>
        </div>
        <div data-scroll style={{ flex: 1, overflow: "auto", padding: "8px 16px 16px" }}>
          <div style={K.lbl}>1 · Enlace (solo vale para {puesto.nombre})</div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ background: "#fff", padding: 8, borderRadius: 12 }}><QrCodigo texto={url} mm={34} margen={1} /></div>
            <div style={{ flex: "1 1 200px", minWidth: 0, fontSize: 13, overflowWrap: "anywhere", color: "var(--muted)" }}>{url}<div style={{ marginTop: 6 }}>Que lo abran en el móvil o tablet del puesto, o que escaneen este QR.</div></div>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            <button onClick={() => copiar(url, "enlace")} style={{ ...K.btn, flex: "1 1 130px" }}>{copiado === "enlace" ? "✓ Copiado" : "Copiar enlace"}</button>
            <a href={wa(`Acceso de ${puesto.nombre} para canjear los tickets de ${ev.name} en TIXFAST:\n${url}\n\nEl PIN te lo paso aparte.`)} target="_blank" rel="noopener noreferrer" style={{ ...K.btn, flex: "1 1 150px", display: "grid", placeItems: "center", textDecoration: "none" }}>Enviar por WhatsApp</a>
          </div>
          <div style={K.lbl}>2 · PIN (mándalo por separado)</div>
          <div style={{ fontSize: 40, fontWeight: 900, letterSpacing: 8, textAlign: "center", padding: "10px 0", border: "1px dashed var(--line)", borderRadius: 14 }}>{pin}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            <button onClick={() => copiar(pin, "pin")} style={{ ...K.btn, flex: "1 1 130px" }}>{copiado === "pin" ? "✓ Copiado" : "Copiar PIN"}</button>
            <a href={wa(`PIN de ${puesto.nombre} en TIXFAST: ${pin}`)} target="_blank" rel="noopener noreferrer" style={{ ...K.btn, flex: "1 1 150px", display: "grid", placeItems: "center", textDecoration: "none" }}>Enviar PIN por WhatsApp</a>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 12, lineHeight: 1.45 }}>Enlace y PIN juntos dan acceso solo a este puesto: canjear sus productos y ver sus ventas. Tras 5 PIN fallidos se bloquea 15 minutos. Puedes cerrar sus sesiones o cambiarlos cuando quieras.</div>
        </div>
        <div style={{ borderTop: "1px solid var(--line)", padding: "10px 16px calc(12px + env(safe-area-inset-bottom))" }}>
          <button onClick={() => window.confirm("¿Ya has copiado o enviado el enlace y el PIN? No se vuelven a mostrar.") && onCerrar()} style={{ ...K.prim, width: "100%" }}>Hecho</button>
        </div>
      </div>
    </div>
  </Capa>);
}

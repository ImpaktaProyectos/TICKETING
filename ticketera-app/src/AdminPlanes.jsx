// ===================== PANEL TIXFAST · PLANES DE SUSCRIPCIÓN =====================
// Crear, editar, comparar, ordenar, archivar y enviar a Stripe los planes que se venden.
// Cada plan: nombre, descripción, precio al mes, días de prueba, si se puede contratar,
// si es el recomendado, QUÉ incluye (funciones) y CUÁNTO (límites).
// · Los permisos se aplican al momento a todas las cuentas del plan (los comprueba la base de datos).
// · El precio solo afecta a las altas nuevas: Stripe mantiene el suyo a las suscripciones en marcha.
// · Los planes del sistema: «Fundador» (todo, sin cuota) y «Sin suscripción» (lo que tiene quien
//   no paga; se puede ajustar qué ve gratis).
import React, { useEffect, useMemo, useState } from "react";
import { Capa } from "./Capa";
import { supabase } from "./supabase";
import { CATALOGO, GRUPOS, LIMITES, planAFormulario, formularioAPlan, resumenPlan, incluye, limitePlan, eurosTxt } from "./cuenta";
import { TarjetaPlan } from "./Suscripcion";

const K = {
  btn: { minHeight: 44, padding: "0 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontWeight: 800, fontSize: 14, cursor: "pointer" },
  prim: { minHeight: 50, padding: "0 16px", borderRadius: 14, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 900, fontSize: 15.5, cursor: "pointer" },
  card: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 14, boxSizing: "border-box" },
  input: { width: "100%", boxSizing: "border-box", minHeight: 46, padding: "0 12px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontSize: 16, font: "inherit" },
  lbl: { display: "block", fontSize: 12, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: .7, margin: "14px 0 6px" },
  badge: (c) => ({ display: "inline-block", fontSize: 11.5, fontWeight: 900, color: c, border: `1px solid ${c}`, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }),
  seccion: { fontWeight: 900, fontSize: 15.5, margin: "18px 0 4px" },
};
const MOTIVOS = { sin_pasarela: "Stripe no está conectado: falta la clave secreta en Supabase.", permiso: "No tienes permiso.", sesion: "Vuelve a entrar.", plan: "Plan no válido." };
async function rpc(nombre, args) { const { data, error } = await supabase.rpc(nombre, args); if (error) throw new Error(String(error.message || "").replace(/^TIXFAST: /, "") || "No se ha podido completar"); return data; }
async function servidor(body) {
  const { data, error } = await supabase.functions.invoke("admin-plataforma", { body });
  if (error || !data?.ok) throw new Error(MOTIVOS[data?.motivo] || "No se ha podido completar");
  return data;
}
export const enStripe = (p) => !!p.stripe_price_id && Number(p.stripe_price_importe) === Number(p.precio_mes);
const estadoPlan = (p) => p.sistema ? ["Sistema", "var(--muted)"] : p.archivado ? ["Archivado", "var(--muted)"] : p.publico ? ["Se puede contratar", "var(--green)"] : ["Oculto", "var(--amber)"];

export function Planes({ avisar }) {
  const [lista, setLista] = useState(null);
  const [stripe, setStripe] = useState(undefined);   // { conectado, modo }
  const [editando, setEditando] = useState(null);    // plan (o {} para uno nuevo)
  const [verArchivados, setVerArchivados] = useState(false);
  const [busy, setBusy] = useState(null);
  const cargar = () => rpc("admin_planes").then(x => setLista(x || [])).catch(() => setLista(false));
  useEffect(() => { cargar(); servidor({ accion: "estado_stripe" }).then(setStripe).catch(() => setStripe(null)); }, []);
  if (lista === null) return <div style={{ color: "var(--muted)" }}>Cargando…</div>;
  if (lista === false) return <div style={{ ...K.card, color: "var(--red)" }}>No se han podido cargar los planes. ¿Está aplicada la migración de planes configurables?</div>;

  const venta = lista.filter(p => !p.sistema && !p.archivado);
  const sistema = lista.filter(p => p.sistema);
  const archivados = lista.filter(p => p.archivado);
  const hacer = async (id, fn, ok) => { setBusy(id); try { const r = await fn(); if (ok) avisar(typeof ok === "function" ? ok(r) : ok); await cargar(); } catch (e) { avisar(e.message || "No se ha podido completar", true); } setBusy(null); };
  const aStripe = (p) => hacer(p.id + "s", () => servidor({ accion: "plan_stripe", plan: p.id }), `✓ ${p.nombre} actualizado en Stripe`);
  const mover = (p, d) => { const i = venta.findIndex(x => x.id === p.id), j = i + d; if (j < 0 || j >= venta.length) return;
    const otro = venta[j]; hacer(p.id + "o", async () => { await rpc("admin_plan_guardar", { p: { ...formularioAPlan(planAFormulario(p)).datos, orden: otro.orden } }); await rpc("admin_plan_guardar", { p: { ...formularioAPlan(planAFormulario(otro)).datos, orden: p.orden } }); }); };
  const archivar = (p) => {
    const q = p.referencias ? `¿Archivar ${p.nombre}? Nadie nuevo podrá contratarlo. Las ${p.referencias} cuentas que lo tienen lo conservan con sus permisos.` : `¿Borrar ${p.nombre}? Ninguna cuenta lo usa.`;
    if (window.confirm(q)) hacer(p.id + "a", () => rpc("admin_plan_archivar", { p_plan: p.id }), (r) => r?.resultado === "borrado" ? `✓ ${p.nombre} borrado` : `✓ ${p.nombre} archivado`);
  };
  const duplicar = (p) => setEditando({ ...p, id: null, nombre: `${p.nombre} (copia)`.slice(0, 40), publico: false, destacado: false, sistema: false, cuentas: 0, pagando: 0, referencias: 0, stripe_price_id: null });

  return (<div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12 }}>
    <div style={{ ...K.card, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 220px" }}>
        <div style={{ fontWeight: 900, fontSize: 16 }}>Planes de suscripción</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>Lo que incluye cada plan se aplica al momento a sus cuentas. El precio nuevo solo cuenta para las altas nuevas.</div>
      </div>
      <span style={K.badge(stripe?.conectado ? (stripe.modo === "real" ? "var(--green)" : "var(--amber)") : "var(--red)")}>
        {stripe === undefined ? "Stripe…" : stripe?.conectado ? (stripe.modo === "real" ? "Stripe conectado · cobro real" : "Stripe en modo pruebas") : "Stripe sin conectar"}</span>
      <button onClick={() => setEditando({})} style={{ ...K.prim, flex: "1 1 160px" }}>+ Nuevo plan</button>
    </div>

    <Comparativa planes={[...venta, ...sistema.filter(p => p.id === "sin_suscripcion")]} />

    {venta.length === 0 && <div style={{ ...K.card, color: "var(--muted)" }}>Aún no hay planes a la venta. Crea el primero.</div>}
    {venta.map((p, i) => <TarjetaAdmin key={p.id} p={p} stripe={stripe} busy={busy} onEditar={() => setEditando(p)} onDuplicar={() => duplicar(p)} onArchivar={() => archivar(p)} onStripe={() => aStripe(p)}
      onSubir={i > 0 ? () => mover(p, -1) : null} onBajar={i < venta.length - 1 ? () => mover(p, 1) : null} />)}

    <div style={{ fontWeight: 900, fontSize: 14, color: "var(--muted)", marginTop: 6, textTransform: "uppercase", letterSpacing: .7 }}>Planes del sistema</div>
    {sistema.map(p => <TarjetaAdmin key={p.id} p={p} stripe={stripe} busy={busy} onEditar={p.id === "fundador" ? null : () => setEditando(p)} />)}

    {archivados.length > 0 && <button onClick={() => setVerArchivados(!verArchivados)} style={K.btn}>{verArchivados ? "Ocultar" : "Ver"} archivados ({archivados.length})</button>}
    {verArchivados && archivados.map(p => <TarjetaAdmin key={p.id} p={p} stripe={stripe} busy={busy} onEditar={() => setEditando(p)}
      onRecuperar={() => hacer(p.id + "r", () => rpc("admin_plan_archivar", { p_plan: p.id, p_archivar: false }), `✓ ${p.nombre} recuperado (oculto: márcalo «Se puede contratar» para venderlo)`)} />)}

    {editando && <Editor plan={editando} stripe={stripe} avisar={avisar} onCerrar={(cambio) => { setEditando(null); if (cambio) cargar(); }} />}
  </div>);
}

function TarjetaAdmin({ p, stripe, busy, onEditar, onDuplicar, onArchivar, onStripe, onSubir, onBajar, onRecuperar }) {
  const r = resumenPlan(p);
  const [t, c] = estadoPlan(p);
  const ocupado = busy && busy.startsWith(p.id);
  const pendiente = !p.sistema && p.precio_mes != null && !enStripe(p);
  return (<div style={{ ...K.card, borderColor: p.destacado ? "var(--accent)" : "var(--line)", opacity: p.archivado ? .75 : 1 }}>
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <b style={{ fontSize: 17 }}>{p.nombre}</b><span style={K.badge(c)}>{t}</span>{p.destacado && <span style={K.badge("var(--accent)")}>Recomendado</span>}
        </div>
        <div style={{ fontSize: 14, marginTop: 4 }}>
          {p.id === "fundador" ? "Sin cuota · todo incluido" : p.id === "sin_suscripcion" ? "Gratis · lo que ve quien no paga" : p.precio_mes != null ? <><b>{eurosTxt(p.precio_mes)}</b> al mes{p.dias_prueba ? ` · ${p.dias_prueba} días de prueba` : " · sin prueba"}</> : <span style={{ color: "var(--amber)" }}>Sin precio</span>}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{p.cuentas} {p.cuentas === 1 ? "cuenta" : "cuentas"}{p.pagando ? ` · ${p.pagando} pagando · ${eurosTxt(p.pagando * Number(p.precio_mes || 0))} al mes` : ""}</div>
      </div>
      {(onSubir || onBajar) && <div style={{ display: "grid", gap: 4 }}>
        <button disabled={!onSubir || !!busy} onClick={onSubir} aria-label={`Subir ${p.nombre}`} style={{ ...K.btn, width: 44, padding: 0, opacity: onSubir ? 1 : .3 }}>↑</button>
        <button disabled={!onBajar || !!busy} onClick={onBajar} aria-label={`Bajar ${p.nombre}`} style={{ ...K.btn, width: 44, padding: 0, opacity: onBajar ? 1 : .3 }}>↓</button>
      </div>}
    </div>
    {p.id !== "fundador" && <div style={{ fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>
      <span style={{ color: "var(--green)", fontWeight: 800 }}>✓</span> {r.incluye.length ? r.incluye.join(" · ") : "Nada (solo la ticketera)"}
      {r.limites.length > 0 && <div style={{ color: "var(--muted)" }}>Hasta {r.limites.join(" · ")}</div>}
    </div>}
    {!p.sistema && <div style={{ fontSize: 12.5, marginTop: 6, color: pendiente ? "var(--amber)" : "var(--muted)" }}>
      {p.precio_mes == null ? "Stripe: se creará al ponerle precio." : enStripe(p) ? `Stripe: ✓ al día${p.stripe_sincronizado_en ? ` (${new Date(p.stripe_sincronizado_en).toLocaleDateString("es-ES")})` : ""}` : stripe?.conectado ? "Stripe: falta crear el precio nuevo." : "Stripe: pendiente (se creará al conectar Stripe o en la primera alta)."}
    </div>}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
      {onEditar && <button disabled={!!busy} onClick={onEditar} style={{ ...K.btn, flex: "1 1 100px", borderColor: "var(--accent)", color: "var(--accent)" }}>Editar</button>}
      {onDuplicar && <button disabled={!!busy} onClick={onDuplicar} style={{ ...K.btn, flex: "1 1 100px" }}>Duplicar</button>}
      {onStripe && pendiente && stripe?.conectado && <button disabled={!!busy} onClick={onStripe} style={{ ...K.btn, flex: "1 1 140px" }}>{ocupado ? "Enviando…" : "Enviar a Stripe"}</button>}
      {onArchivar && <button disabled={!!busy} onClick={onArchivar} style={{ ...K.btn, flex: "1 1 100px", color: "var(--red)" }}>{p.referencias ? "Archivar" : "Borrar"}</button>}
      {onRecuperar && <button disabled={!!busy} onClick={onRecuperar} style={{ ...K.btn, flex: "1 1 100px" }}>Recuperar</button>}
    </div>
  </div>);
}

/* ---------- Tabla: qué incluye cada plan, de un vistazo ---------- */
function Comparativa({ planes }) {
  const [abierta, setAbierta] = useState(false);
  if (!planes.length) return null;
  const celda = { padding: "8px 10px", borderBottom: "1px solid var(--line)", fontSize: 13, textAlign: "center", whiteSpace: "nowrap" };
  return (<div style={{ ...K.card, minWidth: 0, maxWidth: "100%" }}>
    <button onClick={() => setAbierta(!abierta)} aria-expanded={abierta} style={{ ...K.btn, width: "100%", border: "none", background: "transparent", padding: 0, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span>Comparar planes</span><span aria-hidden="true">{abierta ? "▴" : "▾"}</span></button>
    {abierta && <div data-scroll style={{ overflowX: "auto", marginTop: 8, WebkitOverflowScrolling: "touch" }}>
      <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
        <thead><tr><th style={{ ...celda, textAlign: "left", position: "sticky", left: 0, background: "var(--surface)" }}></th>{planes.map(p => <th key={p.id} style={{ ...celda, fontWeight: 900 }}>{p.nombre}<div style={{ fontWeight: 600, color: "var(--muted)", fontSize: 12 }}>{p.precio_mes > 0 ? eurosTxt(p.precio_mes) : "Gratis"}</div></th>)}</tr></thead>
        <tbody>
          {Object.entries(CATALOGO).map(([f, d]) => <tr key={f}><td style={{ ...celda, textAlign: "left", position: "sticky", left: 0, background: "var(--surface)", fontWeight: 700 }}>{d.corto}</td>
            {planes.map(p => <td key={p.id} style={{ ...celda, color: incluye(p, f) ? "var(--green)" : "var(--muted)", fontWeight: 900 }}>{incluye(p, f) ? "✓" : "—"}</td>)}</tr>)}
          {Object.entries(LIMITES).map(([k, d]) => <tr key={k}><td style={{ ...celda, textAlign: "left", position: "sticky", left: 0, background: "var(--surface)", fontWeight: 700 }}>{d.t}</td>
            {planes.map(p => <td key={p.id} style={celda}>{limitePlan(p, k) ?? "∞"}</td>)}</tr>)}
        </tbody>
      </table>
    </div>}
  </div>);
}

/* ---------- Editor de un plan ---------- */
function Editor({ plan, stripe, avisar, onCerrar }) {
  const nuevo = !plan.id;
  const sistema = !!plan.sistema;
  const [f, setF] = useState(() => planAFormulario(nuevo && !plan.limites ? null : plan));
  const [busy, setBusy] = useState(false);
  const [errores, setErrores] = useState([]);
  const set = (k, v) => setF(o => ({ ...o, [k]: v }));
  const setLim = (k, v) => setF(o => ({ ...o, limites: { ...o.limites, [k]: v } }));
  const toggleF = (k) => setF(o => ({ ...o, incluye: o.incluye.includes(k) ? o.incluye.filter(x => x !== k) : [...o.incluye, k] }));
  const { errores: errVivos, datos } = useMemo(() => formularioAPlan(f, { sistema }), [f, sistema]);
  const previa = { ...plan, nombre: datos.nombre || "Nombre del plan", descripcion: datos.descripcion, precio_mes: datos.precio_mes ?? 0, dias_prueba: datos.dias_prueba, destacado: datos.destacado,
    limites: { bloquea: Object.keys(CATALOGO).filter(k => !datos.incluye.includes(k)), ...Object.fromEntries(Object.entries(datos.limites).filter(([, v]) => v != null)) } };
  const quitadas = !nuevo ? Object.keys(CATALOGO).filter(k => incluye(plan, k) && !datos.incluye.includes(k)) : [];
  const precioCambia = !nuevo && plan.precio_mes != null && datos.precio_mes != null && Number(plan.precio_mes) !== datos.precio_mes;

  const guardar = async () => {
    if (busy) return;
    if (errVivos.length) { setErrores(errVivos); return; }
    const avisos = [];
    if (quitadas.length && plan.cuentas) avisos.push(`${plan.cuentas} ${plan.cuentas === 1 ? "cuenta deja" : "cuentas dejan"} de poder usar ${quitadas.map(k => CATALOGO[k].corto).join(", ")} desde ya (sus datos no se borran).`);
    if (precioCambia && plan.pagando) avisos.push(`Las ${plan.pagando} suscripciones en marcha seguirán pagando ${eurosTxt(plan.precio_mes)}. El nuevo precio es para las altas nuevas.`);
    if (!window.confirm(`¿${nuevo ? "Crear" : "Guardar"} ${datos.nombre}?${avisos.length ? "\n\n" + avisos.join("\n\n") : ""}`)) return;
    setBusy(true); setErrores([]);
    try {
      const r = await rpc("admin_plan_guardar", { p: { ...datos, id: nuevo ? null : plan.id, orden: plan.orden ?? null } });
      let txt = `✓ ${datos.nombre} ${nuevo ? "creado" : "guardado"}`;
      if (r?.stripe && stripe?.conectado) {
        try { await servidor({ accion: "plan_stripe", plan: r.id }); txt += " y actualizado en Stripe"; }
        catch (e) { txt += ". Ojo: no se ha podido actualizar en Stripe (" + e.message + "). Pulsa «Enviar a Stripe»."; }
      }
      avisar(txt); onCerrar(true);
    } catch (e) { setErrores([e.message]); setBusy(false); }
  };

  const titulo = nuevo ? "Nuevo plan" : plan.id === "sin_suscripcion" ? "Sin suscripción (gratis)" : `Editar ${plan.nombre}`;
  return (<Capa>
    <div onClick={() => !busy && onCerrar(false)} style={{ position: "fixed", inset: 0, zIndex: 160, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "end center" }}>
      <div role="dialog" aria-modal="true" aria-label={titulo} onClick={e => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 680, maxHeight: "94dvh", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "22px 22px 0 0", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px 10px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ flex: 1, minWidth: 0, fontWeight: 900, fontSize: 18, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{titulo}</div>
          <button onClick={() => onCerrar(false)} disabled={busy} style={K.btn} aria-label="Cerrar">✕</button>
        </div>
        <div data-scroll style={{ flex: 1, overflow: "auto", overscrollBehavior: "contain", padding: "4px 16px 16px" }}>
          {plan.id === "sin_suscripcion" && <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 10, lineHeight: 1.45 }}>Esto es lo que puede usar quien se registra y no paga (o deja de pagar). La ticketera es siempre gratis. Lo normal es dejarlo todo sin marcar para que vea la app en «vista previa».</div>}
          <label style={K.lbl} htmlFor="pl-nombre">Nombre</label>
          <input id="pl-nombre" value={f.nombre} maxLength={40} onChange={e => set("nombre", e.target.value)} placeholder="Ej.: TIXFAST Pro" style={K.input} />
          {!sistema && <>
            <label style={K.lbl} htmlFor="pl-desc">Descripción corta (la ve el cliente)</label>
            <input id="pl-desc" value={f.descripcion} maxLength={300} onChange={e => set("descripcion", e.target.value)} placeholder="Ej.: Para quien hace varios eventos al mes" style={K.input} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              <div><label style={K.lbl} htmlFor="pl-precio">Precio al mes (IVA incl.)</label>
                <div style={{ position: "relative" }}><input id="pl-precio" value={f.precio} inputMode="decimal" placeholder="Sin precio" onChange={e => set("precio", e.target.value.replace(/[^\d.,]/g, "").slice(0, 9))} style={{ ...K.input, paddingRight: 30 }} />
                  <span aria-hidden="true" style={{ position: "absolute", right: 12, top: 13, color: "var(--muted)", fontWeight: 800 }}>€</span></div></div>
              <div><label style={K.lbl} htmlFor="pl-dias">Días de prueba gratis</label>
                <input id="pl-dias" value={f.dias_prueba} inputMode="numeric" onChange={e => set("dias_prueba", e.target.value.replace(/\D/g, "").slice(0, 2))} style={K.input} /></div>
            </div>
            {precioCambia && <div style={{ fontSize: 12.5, color: "var(--amber)", marginTop: 6 }}>Cambia el precio: las {plan.pagando || 0} suscripciones en marcha mantienen el suyo; el nuevo es para las altas nuevas.</div>}
            <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
              <Interruptor on={f.publico} onClick={() => set("publico", !f.publico)} t="Se puede contratar" d={plan.archivado ? "Recupéralo antes para poder venderlo" : "Sale en la pantalla de suscripción"} disabled={!!plan.archivado} />
              <Interruptor on={f.destacado} onClick={() => set("destacado", !f.destacado)} t="Recomendado" d="Sale marcado y elegido de entrada (solo puede haber uno)" />
            </div>
          </>}

          <div style={K.seccion}>Qué incluye</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>La ticketera (entradas online, RRPP, organizaciones y validación) es siempre gratis y no se cuenta aquí.</div>
          {GRUPOS.map(([g, gt]) => <div key={g}>
            <div style={{ ...K.lbl, marginTop: 12 }}>{gt}</div>
            <div style={{ display: "grid", gap: 6 }}>
              {Object.entries(CATALOGO).filter(([, d]) => d.grupo === g).map(([k, d]) => <Interruptor key={k} on={f.incluye.includes(k)} onClick={() => toggleF(k)} t={d.corto} d={d.d} />)}
            </div>
          </div>)}
          {quitadas.length > 0 && plan.cuentas > 0 && <div style={{ fontSize: 12.5, color: "var(--amber)", marginTop: 8 }}>Quitas {quitadas.map(k => CATALOGO[k].corto).join(", ")} a {plan.cuentas} {plan.cuentas === 1 ? "cuenta" : "cuentas"} al guardar.</div>}

          <div style={K.seccion}>Límites</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Al llegar al límite no se pierde nada: solo no se puede crear uno más.</div>
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {Object.entries(LIMITES).map(([k, d]) => <Limite key={k} d={d} valor={f.limites[k]} onChange={(v) => setLim(k, v)} />)}
          </div>

          {!sistema && <>
            <div style={K.seccion}>Así lo ve el cliente</div>
            <div style={{ marginTop: 8, pointerEvents: "none" }}><TarjetaPlan p={previa} elegido conPrueba onElegir={() => {}} /></div>
          </>}
        </div>
        <div style={{ borderTop: "1px solid var(--line)", padding: "10px 16px calc(12px + env(safe-area-inset-bottom))", background: "var(--surface)" }}>
          {errores.length > 0 && <div role="alert" style={{ color: "var(--red)", fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>{errores.map((x, i) => <div key={i}>{x}</div>)}</div>}
          <button onClick={guardar} disabled={busy} style={{ ...K.prim, width: "100%", opacity: busy ? .5 : 1 }}>{busy ? "Guardando…" : nuevo ? "Crear plan" : "Guardar cambios"}</button>
        </div>
      </div>
    </div>
  </Capa>);
}

function Interruptor({ on, onClick, t, d, disabled }) {
  return (<button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={onClick}
    style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 52, padding: "8px 12px", borderRadius: 12, border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`, background: "var(--surface2)", color: "var(--text)", cursor: disabled ? "not-allowed" : "pointer", textAlign: "left", opacity: disabled ? .5 : 1, font: "inherit" }}>
    <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "block", fontWeight: 800, fontSize: 14.5 }}>{t}</span>{d && <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)" }}>{d}</span>}</span>
    <span aria-hidden="true" style={{ width: 44, height: 26, borderRadius: 26, flexShrink: 0, position: "relative", background: on ? "var(--green)" : "var(--line)", transition: "background .15s" }}>
      <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: 20, background: "#fff", transition: "left .15s" }} /></span>
  </button>);
}

function Limite({ d, valor, onChange }) {
  const sin = valor === null || valor === undefined || valor === "";
  const n = sin ? null : Number(valor);
  const paso = (x) => onChange(Math.max(d.min, (Number.isFinite(n) ? n : d.min) + x));
  return (<div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 10, background: "var(--surface2)" }}>
    <div style={{ fontWeight: 800, fontSize: 14.5 }}>{d.t}</div>
    <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{d.d}</div>
    <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" onClick={() => onChange(sin ? Math.max(d.min, 1) : null)} aria-pressed={sin}
        style={{ ...K.btn, flex: "1 1 120px", borderColor: sin ? "var(--accent)" : "var(--line)", color: sin ? "var(--accent)" : "var(--text)" }}>{sin ? "✓ Sin límite" : "Sin límite"}</button>
      <div style={{ display: "flex", gap: 6, flex: "1 1 170px" }}>
        <button type="button" onClick={() => paso(-1)} aria-label={`Menos ${d.t}`} disabled={sin || n <= d.min} style={{ ...K.btn, width: 44, padding: 0, opacity: sin || n <= d.min ? .4 : 1 }}>−</button>
        <input value={sin ? "" : String(valor)} inputMode="numeric" placeholder="∞" aria-label={d.t} onChange={e => { const v = e.target.value.replace(/\D/g, "").slice(0, 5); onChange(v === "" ? null : Number(v)); }}
          style={{ ...K.input, minHeight: 44, textAlign: "center", flex: 1, minWidth: 0 }} />
        <button type="button" onClick={() => paso(1)} aria-label={`Más ${d.t}`} style={{ ...K.btn, width: 44, padding: 0 }}>+</button>
      </div>
    </div>
  </div>);
}

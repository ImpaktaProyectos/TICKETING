// ===================== TU CUENTA: suscripción, privacidad y cancelación =====================
// La cancelación pasa siempre por aquí: se pregunta el motivo y, según el motivo, se ofrece
// quedarse con descuento o pausar unos meses (temporada baja) antes de cancelar de verdad.
import React, { useEffect, useState } from "react";
import { cargarCuenta, cargarOfertas, irAStripe, retener, cambiarPlan, resumenPlan, sinSuscripcion, diasRestantes, ESTADO_CUENTA, eurosTxt } from "./cuenta";
import { Suscripcion } from "./Suscripcion";

const fechaEs = (iso) => iso ? new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }) : "";
const K = {
  panel: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 18, padding: 16, boxSizing: "border-box" },
  fila: { display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderBottom: "1px solid var(--line)" },
  btn: { width: "100%", minHeight: 48, borderRadius: 14, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontWeight: 800, fontSize: 15, cursor: "pointer", whiteSpace: "normal", textAlign: "center" },
  prim: { width: "100%", minHeight: 52, borderRadius: 14, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 900, fontSize: 16, cursor: "pointer" },
  badge: (c) => ({ fontSize: 12, fontWeight: 900, color: c, border: `1px solid ${c}`, borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }),
};
const MOTIVOS = [["caro", "Es caro para mí"], ["temporada", "No tengo eventos ahora (temporada baja)"], ["falta", "Le falta algo que necesito"], ["no_uso", "No lo uso"], ["otro", "Otro motivo"]];

export function TuCuenta({ inicial = null }) {
  const [c, setC] = useState(undefined);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [paso, setPaso] = useState(inicial);   // null · "motivo" · "oferta"
  const recargar = () => cargarCuenta().then(setC).catch(() => setC(null));
  useEffect(() => { recargar(); }, []);
  const a = c?.acc, f = c?.ficha;
  const sin = a && sinSuscripcion(a);
  const fundador = a?.plan_id === "fundador";
  const pausada = f?.estado === "suspendida" && f?.suscripcion_pago_id;
  const est = a ? (fundador ? { t: "Fundador · sin cuota", c: "var(--green)" } : pausada ? { t: "En pausa", c: "var(--amber)" } : ESTADO_CUENTA[f?.estado || a.estado] || ESTADO_CUENTA.pendiente) : null;
  const dias = a?.en_prueba ? diasRestantes(a) : null;
  const hacer = async (fn, ok) => { setBusy(true); setMsg(null); try { await fn(); if (ok) setMsg({ t: ok }); setPaso(null); await recargar(); } catch (e) { setMsg({ t: e?.mostrar ? e.message : "No se ha podido completar", mal: true }); } setBusy(false); };

  let detalle = null;
  if (f && !fundador) {
    if (pausada) detalle = `En pausa: no se cobra nada. Se reanuda sola el ${fechaEs(f.periodo_fin)}.`;
    else if (f.estado === "prueba") detalle = `Prueba gratuita hasta el ${fechaEs(f.prueba_hasta)}${dias != null ? ` (${dias === 1 ? "queda 1 día" : `quedan ${dias} días`})` : ""}. ${f.cancela_al_final ? "Has cancelado: no se cobrará nada." : `Ese día se cobrará la primera cuota${c.precio != null ? ` de ${eurosTxt(c.precio)}` : ""}.`}`;
    else if (f.estado === "activa") detalle = f.cancela_al_final ? `Cancelada: sigue activa hasta el ${fechaEs(f.periodo_fin)} y no se renovará.` : `Se renueva automáticamente el ${fechaEs(f.periodo_fin)}.`;
    else if (f.estado === "impagada") detalle = "No se ha podido cobrar la última cuota. Actualiza la tarjeta para no perder el acceso.";
    else if (f.estado === "cortesia") detalle = f.periodo_fin ? `Regalada por TIXFAST hasta el ${fechaEs(f.periodo_fin)}.` : "Regalada por TIXFAST.";
    else if (f.estado === "cancelada") detalle = "La suscripción no está activa. La ticketera sigue funcionando gratis.";
  }
  const puedeCancelar = f?.suscripcion_pago_id && ["activa", "prueba", "impagada"].includes(f.estado) && !f.cancela_al_final;

  return (<div style={{ display: "grid", gap: 12 }}>
    <section style={K.panel}>
      <div style={{ fontWeight: 900, fontSize: 18 }}>Tu cuenta</div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>Tu espacio es privado: nadie más puede ver tus eventos, ventas ni cuentas.</div>
      {c === undefined && <div style={{ color: "var(--muted)", fontSize: 14, padding: "10px 0" }}>Cargando…</div>}
      {c === null && <div style={{ color: "var(--muted)", fontSize: 14, padding: "10px 0" }}>No se ha podido cargar. Revisa la conexión.</div>}
      {a && <>
        <div style={K.fila}><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 800 }}>Correo</div><div style={{ fontSize: 13, color: "var(--muted)", overflowWrap: "anywhere" }}>{c.email || "—"}</div></div></div>
        <div style={K.fila}><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 800 }}>Suscripción{c.plan && !fundador && !sin ? ` · ${c.plan.nombre}` : ""}</div>{detalle && <div style={{ fontSize: 13, color: "var(--muted)" }}>{detalle}</div>}</div><span style={K.badge(est.c)}>{est.t}</span></div>
        <div style={{ ...K.fila, borderBottom: "none" }}><div style={{ flex: 1 }}><div style={{ fontWeight: 800 }}>Ticketera</div><div style={{ fontSize: 13, color: "var(--muted)" }}>La venta de entradas online es siempre gratuita.</div></div><span style={K.badge("var(--green)")}>Gratis</span></div>
        <div style={{ display: "grid", gap: 8, marginTop: 6 }}>
          {f?.cliente_pago_id && <button disabled={busy} onClick={() => hacer(() => irAStripe("portal"))} style={K.btn}>{f.estado === "impagada" ? "💳 Actualizar mi tarjeta" : "Tarjeta y facturas"}</button>}
          {(f?.cancela_al_final || pausada) && <button disabled={busy} onClick={() => hacer(() => retener("reanudar"), pausada ? "✓ Suscripción reanudada" : "✓ Seguirás con TIXFAST")} style={K.prim}>{pausada ? "Reanudar ahora" : "Seguir con mi suscripción"}</button>}
          {puedeCancelar && paso === null && <button disabled={busy} onClick={() => setPaso("motivo")} style={{ ...K.btn, background: "transparent", color: "var(--muted)", border: "none", minHeight: 44 }}>Cancelar suscripción</button>}
        </div>
        {msg && <div role="status" style={{ marginTop: 10, fontSize: 14, fontWeight: 700, color: msg.mal ? "var(--red)" : "var(--green)", textAlign: "center" }}>{msg.t}</div>}
      </>}
    </section>
    {f?.suscripcion_pago_id && ["activa", "prueba"].includes(f.estado) && !f.cancela_al_final && !paso && (c.planes || []).some(p => p.id !== f.plan_id) &&
      <CambiarPlan actual={f.plan_id} planes={c.planes} busy={busy} hacer={hacer} />}
    {f?.suscripcion_pago_id && ["activa", "prueba", "impagada"].includes(f.estado) && paso && <Retencion paso={paso} setPaso={setPaso} busy={busy} hacer={hacer} />}
    {sin && !f?.suscripcion_pago_id && <Suscripcion flash={(t) => setMsg({ t, mal: true })} compacto />}
    {sin && f?.estado === "cancelada" && <Suscripcion flash={(t) => setMsg({ t, mal: true })} compacto oferta="recuperar" />}
  </div>);
}

// Cambiar a otro plan con la suscripción en marcha (Stripe cobra o abona la diferencia del mes)
function CambiarPlan({ actual, planes, busy, hacer }) {
  const [abierto, setAbierto] = useState(false);
  const otros = planes.filter(p => p.id !== actual);
  return (<section style={K.panel}>
    <button onClick={() => setAbierto(!abierto)} aria-expanded={abierto} style={{ ...K.btn, border: "none", background: "transparent", minHeight: 44, display: "flex", justifyContent: "space-between", alignItems: "center", padding: 0, textAlign: "left" }}>
      <span><span style={{ display: "block", fontWeight: 900, fontSize: 16 }}>Cambiar de plan</span><span style={{ display: "block", fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>Este mes solo se cobra (o se descuenta) la diferencia.</span></span>
      <span aria-hidden="true" style={{ fontSize: 18 }}>{abierto ? "▴" : "▾"}</span>
    </button>
    {abierto && <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
      {otros.map(p => { const r = resumenPlan(p); return (<div key={p.id} style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}><b style={{ fontSize: 16 }}>{p.nombre}</b><b>{eurosTxt(p.precio_mes)} <span style={{ fontWeight: 600, color: "var(--muted)", fontSize: 13 }}>al mes</span></b></div>
        {p.descripcion && <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 3 }}>{p.descripcion}</div>}
        <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.45 }}>{r.incluye.join(" · ")}{r.limites.length ? <span style={{ color: "var(--muted)" }}> · hasta {r.limites.join(", ")}</span> : null}</div>
        <button disabled={busy} onClick={() => { if (window.confirm(`¿Pasar a ${p.nombre} por ${eurosTxt(p.precio_mes)} al mes? Este mes solo se cobra o se descuenta la diferencia.${r.noIncluye.length ? `\n\nOjo: ${p.nombre} no incluye ${r.noIncluye.join(", ")}. Lo que ya tengas guardado no se borra.` : ""}`)) hacer(() => cambiarPlan(p.id), `✓ Ya tienes ${p.nombre}`); }} style={{ ...K.btn, marginTop: 10 }}>Pasar a {p.nombre}</button>
      </div>); })}
    </div>}
  </section>);
}

function Retencion({ paso, setPaso, busy, hacer }) {
  const [motivo, setMotivo] = useState(null);
  const [comentario, setComentario] = useState("");
  const [ofertas, setOfertas] = useState(undefined);
  const [meses, setMeses] = useState(1);
  useEffect(() => { cargarOfertas().then(o => setOfertas(o || {})).catch(() => setOfertas({})); }, []);
  const datos = { motivo: motivo || "otro", comentario: comentario.trim() || null };
  const ret = ofertas?.retencion, maxPausa = Number(ofertas?.pausa_max_meses) || 3;
  const verDescuento = ret && ret.descuento > 0 && motivo !== "temporada";
  const verPausa = motivo === "temporada" || motivo === "no_uso" || paso === "oferta";
  return (<section style={{ ...K.panel, borderColor: "var(--accent)" }}>
    {paso === "motivo" && <>
      <div style={{ fontWeight: 900, fontSize: 17 }}>¿Por qué quieres cancelar?</div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>Nos ayuda a mejorar TIXFAST.</div>
      <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
        {MOTIVOS.map(([k, t]) => <label key={k} style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 46, padding: "0 12px", borderRadius: 12, border: `1px solid ${motivo === k ? "var(--accent)" : "var(--line)"}`, background: "var(--surface2)", cursor: "pointer", fontSize: 14.5 }}>
          <input type="radio" name="motivo" checked={motivo === k} onChange={() => setMotivo(k)} style={{ width: 20, height: 20, accentColor: "var(--accent)" }} />{t}</label>)}
      </div>
      <textarea value={comentario} onChange={e => setComentario(e.target.value.slice(0, 500))} placeholder="Cuéntanos algo más (opcional)" rows={3}
        style={{ width: "100%", boxSizing: "border-box", marginTop: 10, padding: 12, borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontSize: 16, font: "inherit", resize: "vertical" }} />
      <button disabled={!motivo} onClick={() => setPaso("oferta")} style={{ ...K.prim, marginTop: 10, opacity: motivo ? 1 : .45 }}>Continuar</button>
      <button onClick={() => setPaso(null)} style={{ ...K.btn, marginTop: 8, border: "none", background: "transparent" }}>Volver</button>
    </>}
    {paso === "oferta" && <>
      <div style={{ fontWeight: 900, fontSize: 17 }}>Antes de irte…</div>
      {ofertas === undefined && <div style={{ color: "var(--muted)", fontSize: 14, marginTop: 8 }}>Cargando…</div>}
      {ofertas !== undefined && <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
        {verDescuento && <div style={{ border: "1px solid var(--accent)", borderRadius: 14, padding: 12, background: "rgba(255,90,60,.08)" }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>🎁 {ret.descuento} % de descuento durante {ret.meses} {ret.meses === 1 ? "mes" : "meses"}</div>
          <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 3 }}>Sigues con todo y pagas menos. Se aplica en tus próximas cuotas.</div>
          <button disabled={busy} onClick={() => hacer(() => retener("descuento", datos), `✓ ¡Hecho! Tienes un ${ret.descuento} % de descuento`)} style={{ ...K.prim, marginTop: 10 }}>Quedarme con el descuento</button>
        </div>}
        {verPausa && <div style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 12 }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>⏸️ Pausar sin pagar</div>
          <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 3 }}>Ideal para la temporada baja: no se cobra nada y se reanuda sola. Tus datos se quedan guardados.</div>
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>{Array.from({ length: maxPausa }, (_, i) => i + 1).map(n =>
            <button key={n} onClick={() => setMeses(n)} style={{ minHeight: 42, padding: "0 14px", borderRadius: 12, border: `1px solid ${meses === n ? "var(--accent)" : "var(--line)"}`, background: meses === n ? "rgba(255,90,60,.12)" : "var(--surface2)", color: "var(--text)", fontWeight: 800, cursor: "pointer" }}>{n} {n === 1 ? "mes" : "meses"}</button>)}</div>
          <button disabled={busy} onClick={() => hacer(() => retener("pausa", { ...datos, meses }), `✓ Suscripción en pausa ${meses} ${meses === 1 ? "mes" : "meses"}`)} style={{ ...K.btn, marginTop: 10 }}>Pausar {meses} {meses === 1 ? "mes" : "meses"}</button>
        </div>}
        <button disabled={busy} onClick={() => { if (window.confirm("¿Seguro que quieres cancelar? Seguirás teniendo acceso hasta el final del periodo pagado y no se te volverá a cobrar.")) hacer(() => retener("cancelar", datos), "Suscripción cancelada. Seguirás teniendo acceso hasta el final del periodo."); }}
          style={{ ...K.btn, background: "transparent", color: "var(--muted)" }}>No, cancelar igualmente</button>
      </div>}
    </>}
  </section>);
}

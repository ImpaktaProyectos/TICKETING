// ===================== PANEL DE ADMINISTRACIÓN DE TIXFAST =====================
// Solo lo ven los administradores de la plataforma (tabla ticket_superadmins).
// Resumen · Planes (crear y editar los planes de suscripción) · Cuentas · Crecimiento · Errores · Registro.
// Los datos los dan funciones del servidor que comprueban el permiso: aunque alguien
// abriera esta pantalla sin serlo, no recibiría nada.
import React, { useEffect, useMemo, useState } from "react";
import { Capa } from "./Capa";
import { supabase } from "./supabase";
import { ESTADO_CUENTA, eurosTxt } from "./cuenta";
import { Planes } from "./AdminPlanes";
import { Icono as IcoUI, enTexto as ikUI } from "./iconos";

const fecha = (iso, conHora) => iso ? new Date(iso).toLocaleString("es-ES", conHora ? { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", year: "numeric" }) : "—";
const hace = (iso) => { if (!iso) return "nunca"; const d = Math.floor((Date.now() - new Date(iso)) / 86400000); return d <= 0 ? "hoy" : d === 1 ? "ayer" : `hace ${d} días`; };
const ESTADOS = { ...ESTADO_CUENTA, cortesia: { t: "Regalada", c: "#c084fc" }, fundador: { t: "Fundador", c: "var(--green)" } };
const estadoDe = (c) => c.plan_id === "fundador" ? ESTADOS.fundador : ESTADOS[c.estado || "pendiente"] || ESTADOS.pendiente;
const FILTROS = [["todas", "Todas"], ["prueba", "En prueba"], ["activa", "Pagando"], ["impagada", "Impago"], ["sin_suscripcion", "Sin suscripción"], ["cortesia", "Regaladas"], ["fundador", "Fundador"], ["bloqueadas", "Bloqueadas"]];
const MOTIVOS = { sin_suscripcion: "Esa cuenta no tiene suscripción en Stripe.", sin_pasarela: "Stripe no está configurado.", permiso: "No tienes permiso.", propia: "No puedes bloquear tu propia cuenta.", sesion: "Vuelve a entrar." };

const K = {
  btn: { minHeight: 44, padding: "0 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontWeight: 800, fontSize: 14, cursor: "pointer" },
  card: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 14, boxSizing: "border-box" },
  input: { width: "100%", boxSizing: "border-box", minHeight: 46, padding: "0 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontSize: 16, font: "inherit" },
  chip: (on) => ({ minHeight: 38, padding: "0 12px", borderRadius: 999, border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`, background: on ? "rgba(255,90,60,.12)" : "var(--surface2)", color: on ? "var(--accent)" : "var(--text)", fontWeight: 800, fontSize: 13, cursor: "pointer" }),
  badge: (c) => ({ display: "inline-block", fontSize: 11.5, fontWeight: 900, color: c, border: `1px solid ${c}`, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }),
};
const Badge = ({ e }) => <span style={K.badge(e.c)}>{e.t}</span>;

async function rpc(nombre, args) { const { data, error } = await supabase.rpc(nombre, args); if (error) throw error; return data; }
async function servidor(body) {
  const { data, error } = await supabase.functions.invoke("admin-plataforma", { body });
  if (error || !data?.ok) throw new Error(MOTIVOS[data?.motivo] || "No se ha podido completar");
  return data;
}

export default function AdminPlataforma({ onCerrar }) {
  const [tab, setTab] = useState("resumen");
  const [aviso, setAviso] = useState(null);
  const avisar = (t, mal) => { setAviso({ t, mal }); setTimeout(() => setAviso(null), 3500); };
  return (<Capa>
    <div style={{ position: "fixed", inset: 0, zIndex: 150, background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "calc(10px + env(safe-area-inset-top)) 14px 10px", borderBottom: "1px solid var(--line)", background: "var(--surface)" }}>
        <img src="/brand/tixfast_isotipo_app.svg" alt="" width="30" height="30" />
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 900, fontSize: 17 }}>Panel TIXFAST</div><div style={{ fontSize: 12, color: "var(--muted)" }}>Administración de la plataforma</div></div>
        <button onClick={onCerrar} style={K.btn} aria-label="Cerrar el panel">Cerrar</button>
      </header>
      <nav role="tablist" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(104px, 1fr))", gap: 6, padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
        {[["resumen", "Resumen"], ["planes", "Planes"], ["cuentas", "Cuentas"], ["crecimiento", "Crecimiento"], ["errores", "Errores"], ["registro", "Registro"]].map(([k, t]) =>
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{ ...K.chip(tab === k), borderRadius: 12, minHeight: 42, padding: 0 }}>{t}</button>)}
      </nav>
      <main data-scroll style={{ flex: 1, overflow: "auto", overscrollBehavior: "contain", padding: "14px 12px calc(20px + env(safe-area-inset-bottom))" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          {tab === "resumen" && <Resumen avisar={avisar} irA={setTab} />}
          {tab === "planes" && <Planes avisar={avisar} />}
          {tab === "cuentas" && <Cuentas avisar={avisar} />}
          {tab === "crecimiento" && <Crecimiento avisar={avisar} />}
          {tab === "errores" && <Errores avisar={avisar} />}
          {tab === "registro" && <Registro />}
        </div>
      </main>
      {aviso && <div role="status" style={{ position: "fixed", left: 12, right: 12, bottom: "calc(16px + env(safe-area-inset-bottom))", zIndex: 170, maxWidth: 520, margin: "0 auto", padding: "12px 14px", borderRadius: 14, background: aviso.mal ? "var(--red)" : "var(--green)", color: aviso.mal ? "#fff" : "#04231a", fontWeight: 800, textAlign: "center" }}>{aviso.t}</div>}
    </div>
  </Capa>);
}

/* ---------- Resumen ---------- */
function Resumen({ avisar, irA }) {
  const [r, setR] = useState(null);
  const cargar = () => rpc("admin_resumen").then(setR).catch(() => setR(false));
  useEffect(() => { cargar(); }, []);
  if (r === null) return <div style={{ color: "var(--muted)" }}>Cargando…</div>;
  if (r === false) return <div style={{ color: "var(--red)" }}>No se ha podido cargar. ¿Tienes permiso de administrador?</div>;
  const e = r.por_estado || {};
  const tiles = [
    ["Registrados", r.registrados, `+${r.altas_7d} esta semana · +${r.altas_30d} en 30 días`],
    ["Pagando", r.pagando, `${eurosTxt(r.ingreso_mensual || 0)} al mes`, "var(--green)"],
    ["En prueba", e.prueba || 0, r.cancelan_al_final ? `${r.cancelan_al_final} cancelan al acabar` : "7 días gratis", "var(--amber)"],
    ["Impago", e.impagada || 0, "Pago fallido", e.impagada ? "var(--red)" : null],
    ["Sin suscripción", (e.pendiente || 0) + (e.cancelada || 0) + (e.suspendida || 0), "Solo ticketera"],
    ["Regaladas", e.cortesia || 0, "Cortesía de TIXFAST", "#c084fc"],
    ["Fundador", e.fundador || 0, "Sin cuota"],
    ["Activos 7 días", r.activos_7d, "Han entrado esta semana"],
    ["Eventos", r.eventos, `${r.ventas_30d} tickets en 30 días`],
    ["Errores 24 h", r.errores_24h, `${r.errores_7d} en 7 días`, r.errores_24h ? "var(--red)" : null],
  ];
  return (<div style={{ display: "grid", gap: 12 }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
      {tiles.map(([t, n, sub, c]) => <div key={t} style={K.card}>
        <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: .6 }}>{t}</div>
        <div style={{ fontSize: 28, fontWeight: 900, color: c || "var(--text)", marginTop: 2 }}>{n ?? 0}</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{sub}</div>
      </div>)}
    </div>
    {r.por_plan && Object.keys(r.por_plan).length > 0 && <div style={K.card}>
      <div style={{ fontWeight: 900 }}>Cuentas con acceso por plan</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>{Object.entries(r.por_plan).map(([n, c]) => <span key={n} style={K.badge("var(--text)")}>{n}: {c}</span>)}</div>
    </div>}
    <button onClick={() => irA("planes")} style={{ ...K.btn, minHeight: 50 }}>Planes, precios y permisos →</button>
    <button onClick={() => irA("cuentas")} style={{ ...K.btn, minHeight: 50 }}>Ver todas las cuentas →</button>
  </div>);
}

/* ---------- Cuentas ---------- */
function Cuentas({ avisar }) {
  const [buscar, setBuscar] = useState("");
  const [filtro, setFiltro] = useState("todas");
  const [lista, setLista] = useState(null);
  const [pagina, setPagina] = useState(0);
  const [ficha, setFicha] = useState(null);
  const cargar = (pg = 0) => rpc("admin_cuentas", { p_buscar: buscar.trim() || null, p_filtro: filtro, p_limite: 50, p_desde: pg * 50 })
    .then(x => { setLista(x || []); setPagina(pg); }).catch(() => setLista(false));
  useEffect(() => { const t = setTimeout(() => cargar(0), buscar ? 350 : 0); return () => clearTimeout(t); }, [buscar, filtro]);
  const total = lista?.[0]?.total || 0;
  return (<div style={{ display: "grid", gap: 10 }}>
    <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar por correo…" type="search" style={K.input} aria-label="Buscar cuenta" />
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{FILTROS.map(([k, t]) => <button key={k} onClick={() => setFiltro(k)} style={K.chip(filtro === k)}>{t}</button>)}</div>
    {lista === null && <div style={{ color: "var(--muted)" }}>Cargando…</div>}
    {lista === false && <div style={{ color: "var(--red)" }}>No se ha podido cargar.</div>}
    {lista && <div style={{ fontSize: 13, color: "var(--muted)" }}>{total} {total === 1 ? "cuenta" : "cuentas"}</div>}
    {lista && lista.map(c => (
      <button key={c.owner_id} onClick={() => setFicha(c)} style={{ ...K.card, display: "flex", alignItems: "center", gap: 10, textAlign: "left", cursor: "pointer", color: "var(--text)", width: "100%" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.email}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>Alta {fecha(c.alta)} · entró {hace(c.ultimo_acceso)} · {c.eventos} {c.eventos === 1 ? "evento" : "eventos"}{c.errores_7d ? ` · ${c.errores_7d} errores` : ""}</div>
        </div>
        <div style={{ display: "grid", gap: 4, justifyItems: "end", flexShrink: 0 }}>
          <Badge e={estadoDe(c)} />
          {c.bloqueado_hasta && new Date(c.bloqueado_hasta) > new Date() && <span style={K.badge("var(--red)")}>Bloqueada</span>}
          {!c.confirmado && <span style={{ fontSize: 11, color: "var(--muted)" }}>Sin confirmar</span>}
        </div>
      </button>))}
    {lista && (pagina > 0 || total > (pagina + 1) * 50) && <div style={{ display: "flex", gap: 8 }}>
      <button disabled={pagina === 0} onClick={() => cargar(pagina - 1)} style={{ ...K.btn, flex: 1, opacity: pagina === 0 ? .4 : 1 }}>← Anteriores</button>
      <button disabled={total <= (pagina + 1) * 50} onClick={() => cargar(pagina + 1)} style={{ ...K.btn, flex: 1, opacity: total <= (pagina + 1) * 50 ? .4 : 1 }}>Siguientes →</button>
    </div>}
    {ficha && <Ficha c={ficha} avisar={avisar} onCerrar={(cambio) => { setFicha(null); if (cambio) cargar(pagina); }} />}
  </div>);
}

function Ficha({ c, avisar, onCerrar }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hasta, setHasta] = useState("");
  const [planes, setPlanes] = useState([]);
  const [planRegalo, setPlanRegalo] = useState("");
  useEffect(() => { rpc("admin_cuenta_detalle", { p_owner: c.owner_id }).then(setD).catch(() => setD(false));
    rpc("admin_planes").then(x => { const ps = (x || []).filter(p => !p.sistema && !p.archivado); setPlanes(ps); setPlanRegalo((ps.find(p => p.id === c.plan_id) || ps.find(p => p.destacado) || ps[0])?.id || ""); }).catch(() => {}); }, [c.owner_id]);
  const nombrePlan = (id) => planes.find(p => p.id === id)?.nombre || id;
  const bloqueada = c.bloqueado_hasta && new Date(c.bloqueado_hasta) > new Date();
  const hacer = async (pregunta, fn, ok) => {
    if (busy || !window.confirm(pregunta)) return;
    setBusy(true);
    try { await fn(); avisar(ok); onCerrar(true); } catch (e) { avisar(e?.message || "No se ha podido completar", true); setBusy(false); }
  };
  const est = estadoDe(c);
  const fila = (t, v) => <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--line)", fontSize: 14 }}><span style={{ color: "var(--muted)" }}>{t}</span><span style={{ fontWeight: 700, textAlign: "right", overflowWrap: "anywhere" }}>{v}</span></div>;
  const accion = (t, sub, onClick, color) => <button disabled={busy} onClick={onClick} style={{ ...K.btn, width: "100%", minHeight: 52, textAlign: "left", display: "block", borderColor: color || "var(--line)", opacity: busy ? .5 : 1 }}>
    <span style={{ display: "block", color: color || "var(--text)" }}>{t}</span>{sub && <span style={{ display: "block", fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>{sub}</span>}</button>;
  return (<Capa>
    <div onClick={() => !busy && onCerrar(false)} style={{ position: "fixed", inset: 0, zIndex: 160, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "end center" }}>
      <div role="dialog" aria-modal="true" aria-label={`Cuenta ${c.email}`} onClick={e => e.stopPropagation()} data-scroll
        style={{ width: "100%", maxWidth: 620, maxHeight: "94dvh", overflow: "auto", overscrollBehavior: "contain", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "22px 22px 0 0", padding: "16px 16px calc(18px + env(safe-area-inset-bottom))", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 900, fontSize: 18, overflowWrap: "anywhere" }}>{c.email}</div><div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }}><Badge e={est} />{bloqueada && <span style={K.badge("var(--red)")}>Bloqueada</span>}</div></div>
          <button onClick={() => onCerrar(false)} style={K.btn} aria-label="Cerrar">✕</button>
        </div>
        <div style={{ marginTop: 10 }}>
          {fila("Alta", fecha(c.alta, true))}
          {fila("Último acceso", c.ultimo_acceso ? `${fecha(c.ultimo_acceso, true)} (${hace(c.ultimo_acceso)})` : "nunca")}
          {fila("Correo confirmado", c.confirmado ? "Sí" : "No")}
          {c.plan_id && c.plan_id !== "fundador" && fila("Plan", nombrePlan(c.plan_id))}
          {c.prueba_hasta && fila("Prueba hasta", fecha(c.prueba_hasta, true))}
          {c.periodo_fin && fila(c.estado === "cortesia" ? "Regalada hasta" : "Periodo hasta", fecha(c.periodo_fin, true))}
          {c.estado === "cortesia" && !c.periodo_fin && fila("Regalada hasta", "sin fecha de fin")}
          {c.cancela_al_final && fila("Cancelación", "No se renovará")}
          {fila("Stripe", c.cliente_pago_id ? <a href={`https://dashboard.stripe.com/customers/${c.cliente_pago_id}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>Ver cliente en Stripe ↗</a> : "Sin cliente")}
          {fila("ID de cuenta", <span style={{ fontSize: 12 }}>{c.owner_id}</span>)}
        </div>

        <div style={{ fontWeight: 900, marginTop: 16, marginBottom: 8 }}>Acciones</div>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ ...K.card, padding: 10, display: "grid", gap: 8 }}>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Regalar un plan (sin cobrar). Deja la fecha en blanco para que no caduque.</div>
            {planes.length > 0 && <select value={planRegalo} onChange={e => setPlanRegalo(e.target.value)} style={K.input} aria-label="Plan que se regala">
              {planes.map(p => <option key={p.id} value={p.id}>{p.nombre}{p.precio_mes != null ? ` · ${eurosTxt(p.precio_mes)}/mes` : ""}</option>)}</select>}
            <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} style={K.input} aria-label="Regalada hasta" />
            {accion(`Regalar ${planRegalo ? nombrePlan(planRegalo) : "suscripción"}`, hasta ? `Hasta el ${fecha(hasta + "T23:59")}` : "Sin fecha de fin", () => hacer(`¿Regalar ${planRegalo ? nombrePlan(planRegalo) : "la suscripción"} a ${c.email}${hasta ? ` hasta el ${fecha(hasta + "T23:59")}` : " sin fecha de fin"}?${c.suscripcion_pago_id && ["activa", "prueba", "impagada"].includes(c.estado) ? "\n\nOJO: tiene una suscripción de pago en Stripe. Cancélala también para que no se le cobre." : ""}`,
              () => rpc("admin_cuenta_cambiar", { p_owner: c.owner_id, p_accion: "cortesia", p_hasta: hasta ? new Date(hasta + "T23:59:59").toISOString() : null, p_plan: planRegalo || null }), "✓ Plan regalado"), "#c084fc")}
          </div>
          {accion("Hacer Fundador", "Sin cuota ni bloqueos, para siempre", () => hacer(`¿Hacer Fundador a ${c.email}?`, () => rpc("admin_cuenta_cambiar", { p_owner: c.owner_id, p_accion: "fundador" }), "✓ Ahora es Fundador"))}
          {c.suscripcion_pago_id && ["activa", "prueba", "impagada"].includes(c.estado) && !c.cancela_al_final && accion("Dar de baja al final del periodo", "Stripe deja de cobrar; sigue con acceso hasta el fin del mes pagado", () => hacer(`¿Dar de baja a ${c.email} al final de su periodo?`, () => servidor({ accion: "baja_stripe", cuenta: c.owner_id, cuando: "final" }), "✓ Baja programada en Stripe"), "var(--amber)")}
          {c.suscripcion_pago_id && ["activa", "prueba", "impagada"].includes(c.estado) && accion("Dar de baja ahora", "Se cancela en Stripe y pierde el acceso ya", () => hacer(`¿Dar de baja a ${c.email} AHORA? Pierde el acceso al momento.`, () => servidor({ accion: "baja_stripe", cuenta: c.owner_id, cuando: "ya" }), "✓ Suscripción cancelada"), "var(--red)")}
          {(c.plan_id === "fundador" || ["activa", "cortesia", "prueba"].includes(c.estado)) && !c.suscripcion_pago_id && accion("Quitar el acceso", "Pasa a sin suscripción (solo ticketera)", () => hacer(`¿Quitar el acceso a ${c.email}? Solo podrá usar la ticketera.`, () => rpc("admin_cuenta_cambiar", { p_owner: c.owner_id, p_accion: "quitar" }), "✓ Acceso quitado"), "var(--red)")}
          {accion(bloqueada ? "Desbloquear la cuenta" : "Bloquear la cuenta", bloqueada ? "Podrá volver a entrar" : "No podrá entrar en TIXFAST (sus datos se conservan)", () => hacer(bloqueada ? `¿Desbloquear a ${c.email}?` : `¿Bloquear a ${c.email}? No podrá entrar hasta que la desbloquees.`, () => servidor({ accion: "bloquear", cuenta: c.owner_id, bloquear: !bloqueada }), bloqueada ? "✓ Cuenta desbloqueada" : "✓ Cuenta bloqueada"), bloqueada ? null : "var(--red)")}
        </div>

        <div style={{ fontWeight: 900, marginTop: 16, marginBottom: 6 }}>Eventos</div>
        {d === null && <div style={{ color: "var(--muted)", fontSize: 14 }}>Cargando…</div>}
        {d && !d.eventos.length && <div style={{ color: "var(--muted)", fontSize: 14 }}>Aún no ha creado eventos.</div>}
        {d && d.eventos.map((e, i) => <div key={i} style={{ fontSize: 14, padding: "6px 0", borderBottom: "1px solid var(--line)" }}><b>{e.nombre}</b> <span style={{ color: "var(--muted)" }}>· {e.fecha ? fecha(e.fecha + "T12:00") : "sin fecha"} · {e.barras} barras · {e.tickets} tickets{e.venta_online ? " · venta online" : ""}</span></div>)}
        {d && d.errores.length > 0 && <>
          <div style={{ fontWeight: 900, marginTop: 16, marginBottom: 6 }}>Errores recientes</div>
          {d.errores.map((x, i) => <div key={i} style={{ fontSize: 13, padding: "6px 0", borderBottom: "1px solid var(--line)" }}><span style={{ color: "var(--muted)" }}>{fecha(x.fecha, true)} · {x.origen} · v{x.version}</span><div style={{ overflowWrap: "anywhere" }}>{x.mensaje}</div></div>)}
        </>}
        {d && d.registro.length > 0 && <>
          <div style={{ fontWeight: 900, marginTop: 16, marginBottom: 6 }}>Historial de administración</div>
          {d.registro.map((x, i) => <div key={i} style={{ fontSize: 13, padding: "6px 0", borderBottom: "1px solid var(--line)" }}>{fecha(x.fecha, true)} · <b>{x.accion}</b> <span style={{ color: "var(--muted)" }}>por {x.admin || "—"}</span></div>)}
        </>}
      </div>
    </div>
  </Capa>);
}

/* ---------- Errores ---------- */
function Errores({ avisar }) {
  const [lista, setLista] = useState(null);
  const [abierto, setAbierto] = useState(null);
  const cargar = () => rpc("admin_errores", { p_limite: 200 }).then(x => setLista(x || [])).catch(() => setLista(false));
  useEffect(() => { cargar(); }, []);
  const grupos = useMemo(() => {
    const m = new Map();
    (lista || []).forEach(x => { const k = x.origen + "|" + x.mensaje; const g = m.get(k) || { ...x, n: 0, cuentas: new Set() }; g.n++; if (x.email) g.cuentas.add(x.email); m.set(k, g); });
    return [...m.values()];
  }, [lista]);
  const limpiar = async () => { if (!window.confirm("¿Borrar los errores de hace más de 90 días?")) return; try { const n = await rpc("admin_limpiar_errores"); avisar(`✓ ${n} errores antiguos borrados`); cargar(); } catch { avisar("No se ha podido limpiar", true); } };
  if (lista === null) return <div style={{ color: "var(--muted)" }}>Cargando…</div>;
  if (lista === false) return <div style={{ color: "var(--red)" }}>No se han podido cargar los errores.</div>;
  return (<div style={{ display: "grid", gap: 8 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <div style={{ fontSize: 13, color: "var(--muted)" }}>{lista.length} errores recientes, agrupados ({grupos.length} distintos)</div>
      <button onClick={limpiar} style={K.btn}>Limpiar antiguos</button>
    </div>
    {!grupos.length && <div style={{ ...K.card, color: "var(--muted)" }}>Sin errores. </div>}
    {grupos.map((g, i) => <button key={i} onClick={() => setAbierto(abierto === i ? null : i)} style={{ ...K.card, textAlign: "left", cursor: "pointer", color: "var(--text)", width: "100%" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={K.badge(g.n > 5 ? "var(--red)" : "var(--amber)")}>×{g.n}</span><span style={{ fontSize: 12.5, color: "var(--muted)" }}>{g.origen} · último {fecha(g.fecha, true)} · {g.cuentas.size} {g.cuentas.size === 1 ? "cuenta" : "cuentas"}</span></div>
      <div style={{ marginTop: 6, fontWeight: 700, fontSize: 14, overflowWrap: "anywhere" }}>{g.mensaje}</div>
      {abierto === i && <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--muted)", overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
        {[...g.cuentas].slice(0, 10).join(", ")}{"\n"}Versión {g.version || "?"} · {g.ruta || ""}{"\n"}{g.agente || ""}{g.detalle ? "\n\n" + g.detalle : ""}
      </div>}
    </button>)}
  </div>);
}

/* ---------- Registro de acciones ---------- */
const ACCIONES = { plan_nuevo: "Crear plan", plan_editar: "Editar plan", plan_archivar: "Archivar plan", plan_borrar: "Borrar plan", plan_recuperar: "Recuperar plan", plan_stripe: "Plan enviado a Stripe", campana: "Campaña de correo", enviar_correo: "Correo enviado a mano", descuento: "Descuento aplicado", ampliar_prueba: "Prueba ampliada", crecimiento_ajustes: "Cambiar automatizaciones", cortesia: "Regalar suscripción", fundador: "Hacer Fundador", quitar: "Quitar acceso", precio: "Cambiar precio", baja_stripe_inmediata: "Baja inmediata en Stripe", baja_stripe_fin_periodo: "Baja al final del periodo", bloquear_acceso: "Bloquear cuenta", desbloquear_acceso: "Desbloquear cuenta" };
function Registro() {
  const [lista, setLista] = useState(null);
  useEffect(() => { rpc("admin_registro", { p_limite: 200 }).then(x => setLista(x || [])).catch(() => setLista(false)); }, []);
  if (lista === null) return <div style={{ color: "var(--muted)" }}>Cargando…</div>;
  if (lista === false) return <div style={{ color: "var(--red)" }}>No se ha podido cargar el registro.</div>;
  if (!lista.length) return <div style={{ ...K.card, color: "var(--muted)" }}>Aún no hay acciones de administración.</div>;
  return (<div style={{ display: "grid", gap: 6 }}>{lista.map((x, i) => <div key={i} style={{ ...K.card, padding: 12, fontSize: 14 }}>
    <div style={{ fontWeight: 800 }}>{ACCIONES[x.accion] || x.accion}{x.accion === "precio" && x.detalle ? `: ${x.detalle.antes ?? "—"} → ${x.detalle.ahora} €` : ""}{x.accion?.startsWith("plan_") && x.detalle?.nombre ? `: ${x.detalle.nombre}` : x.accion === "plan_stripe" && x.detalle?.plan ? `: ${x.detalle.plan}` : ""}</div>
    <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2, overflowWrap: "anywhere" }}>{fecha(x.fecha, true)} · {x.cuenta || "plataforma"} · por {x.admin || "—"}</div>
  </div>)}</div>);
}

/* ---------- Crecimiento: retener, recuperar y captar ---------- */
const SECUENCIAS = [
  ["bienvenida", "Bienvenida", "Al registrarse, invita a empezar la prueba", null],
  ["sin_prueba", "No ha empezado la prueba", "Recordatorios los días…", "dias"],
  ["prueba_consejos", "Consejos de la prueba", "El primer día de prueba", null],
  ["impago", "Impago", "Avisos para actualizar la tarjeta los días…", "dias"],
  ["cancela", "Ha cancelado", "Oferta para quedarse (descuento o pausa)", null],
  ["recuperar", "Recuperar", "Oferta para volver los días…", "dias"],
];
const MOTIVO_TXT = { caro: "Es caro", temporada: "Temporada baja", falta: "Le falta algo", no_uso: "No lo usa", otro: "Otro" };
const RIESGO_TXT = { impago: ["Impago", "var(--red)"], cancela: ["Cancela", "var(--amber)"], prueba_acaba: ["Prueba acaba", "var(--amber)"], inactivo: ["Inactivo", "var(--muted)"] };
const SEGMENTOS = [["sin_suscripcion", "Sin suscripción"], ["nunca_probaron", "Nunca probaron"], ["canceladas", "Canceladas"], ["clientes", "Clientes actuales"], ["todas", "Todas"]];

function Crecimiento({ avisar }) {
  const [d, setD] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(null);
  const [camp, setCamp] = useState({ segmento: "sin_suscripcion", asunto: "", texto: "", boton: "Abrir TIXFAST" });
  const cargar = () => rpc("admin_crecimiento").then(x => { setD(x); setCfg(x.config); }).catch(() => setD(false));
  useEffect(() => { cargar(); }, []);
  if (d === null) return <div style={{ color: "var(--muted)" }}>Cargando…</div>;
  if (d === false) return <div style={{ color: "var(--red)" }}>No se ha podido cargar. ¿Está aplicada la migración de crecimiento?</div>;
  const k = d.kpi || {};
  const conv = k.pruebas_30d ? Math.round((k.convertidas_30d / k.pruebas_30d) * 100) : null;
  const accion = async (id, fn, ok) => { setBusy(id); try { await fn(); if (ok) avisar(ok); cargar(); } catch (e) { avisar(e?.message || "No se ha podido", true); } setBusy(null); };
  const ret = cfg?.oferta_retencion || { descuento: 50, meses: 3 };
  const setSec = (sec, campo, v) => setCfg(c => ({ ...c, secuencias: { ...c.secuencias, [sec]: { ...(c.secuencias?.[sec] || {}), [campo]: v } } }));
  const setOf = (o, campo, v) => setCfg(c => ({ ...c, [o]: { ...(c[o] || {}), [campo]: v } }));
  const numeros = (t) => t.split(/[^\d]+/).filter(Boolean).map(Number).filter(n => n >= 0 && n <= 90).slice(0, 5);
  const totMot = Object.values(d.motivos || {}).reduce((a, b) => a + b, 0);
  const tiles = [
    ["Pagando", k.pagando, k.precio != null ? `${eurosTxt((k.pagando || 0) * k.precio)} al mes` : ""],
    ["Conversión prueba → pago", conv != null ? `${conv} %` : "—", `${k.convertidas_30d || 0} de ${k.pruebas_30d || 0} pruebas (30 días)`],
    ["Registros 30 días", k.registros_30d, "Cuentas nuevas"],
    ["Cancelaciones 30 días", k.cancelaciones_30d, `${k.rescatadas_30d || 0} rescatadas con oferta`, k.cancelaciones_30d ? "var(--amber)" : null],
    ["Impagos", eurosTxt(k.impago_importe || 0), "Al mes, por cobrar", k.impago_importe ? "var(--red)" : null],
    ["Correos 30 días", k.correos_30d, `${k.sin_correos_promo || 0} no quieren comerciales`],
  ];
  return (<div style={{ display: "grid", gap: 14 }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
      {tiles.map(([t, n, sub, c]) => <div key={t} style={K.card}><div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: .6 }}>{t}</div><div style={{ fontSize: 26, fontWeight: 900, color: c || "var(--text)", marginTop: 2 }}>{n ?? 0}</div><div style={{ fontSize: 12.5, color: "var(--muted)" }}>{sub}</div></div>)}
    </div>

    <section style={K.card}>
      <div style={{ fontWeight: 900, fontSize: 16 }}><IcoUI n="aviso" s={16} style={ikUI} />En riesgo ({d.riesgo.length})</div>
      <div style={{ fontSize: 13, color: "var(--muted)", margin: "2px 0 10px" }}>Clientes que se pueden perder. A los de impago y cancelación ya les escriben los correos automáticos; aquí puedes actuar a mano.</div>
      {!d.riesgo.length && <div style={{ color: "var(--muted)", fontSize: 14 }}>Nadie en riesgo ahora mismo. </div>}
      <div style={{ display: "grid", gap: 8 }}>
        {d.riesgo.map(r => { const [t, c] = RIESGO_TXT[r.motivo] || ["", "var(--muted)"]; const id = r.owner_id; return (
          <div key={id + r.motivo} style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={K.badge(c)}>{t}</span><span style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{r.email}</span></div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>
              {r.motivo === "impago" && `Sin cobrar desde el ${fecha(r.fecha)}`}{r.motivo === "cancela" && `Se va el ${fecha(r.periodo_fin || r.prueba_hasta)}`}
              {r.motivo === "prueba_acaba" && `La prueba acaba el ${fecha(r.prueba_hasta)}`}{r.motivo === "inactivo" && `Último acceso: ${hace(r.ultimo_acceso)}`}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {["impago", "cancela"].includes(r.motivo) && <button disabled={!!busy} onClick={() => accion(id + "c", () => servidor({ accion: "enviar_correo", cuenta: id, tipo: r.motivo }), "✓ Correo enviado")} style={{ ...K.btn, minHeight: 40 }}><IcoUI n="correo" s={16} style={ikUI} />Enviar correo</button>}
              {r.con_stripe && r.motivo !== "impago" && <button disabled={!!busy} onClick={() => window.confirm(`¿Aplicar ${ret.descuento} % durante ${ret.meses} meses a ${r.email}?`) && accion(id + "d", () => servidor({ accion: "descuento", cuenta: id, pct: ret.descuento, meses: ret.meses }), "✓ Descuento aplicado")} style={{ ...K.btn, minHeight: 40 }}><IcoUI n="regalo" s={16} style={ikUI} />{ret.descuento} % {ret.meses} m</button>}
              {r.estado === "prueba" && r.con_stripe && <button disabled={!!busy} onClick={() => accion(id + "p", () => servidor({ accion: "ampliar_prueba", cuenta: id, dias: 7 }), "✓ Prueba ampliada 7 días")} style={{ ...K.btn, minHeight: 40 }}><IcoUI n="reloj" s={16} style={ikUI} />+7 días de prueba</button>}
            </div>
          </div>); })}
      </div>
    </section>

    <section style={K.card}>
      <div style={{ fontWeight: 900, fontSize: 16 }}>Por qué se van (90 días)</div>
      {!totMot && <div style={{ color: "var(--muted)", fontSize: 14, marginTop: 6 }}>Aún no hay bajas. Cuando alguien cancele, verás aquí el motivo.</div>}
      {totMot > 0 && <div style={{ display: "grid", gap: 6, marginTop: 8 }}>{Object.entries(d.motivos).sort((a, b) => b[1] - a[1]).map(([m, n]) =>
        <div key={m}><div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5 }}><span>{MOTIVO_TXT[m] || m}</span><b>{n}</b></div>
          <div style={{ height: 8, borderRadius: 8, background: "var(--surface2)", overflow: "hidden" }}><div style={{ width: `${(n / totMot) * 100}%`, height: "100%", background: "var(--accent)" }} /></div></div>)}
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>Resultado: {d.resultados?.descuento || 0} se quedaron con descuento · {d.resultados?.pausa || 0} pausaron · {d.resultados?.cancela || 0} cancelaron</div>
      </div>}
      {d.comentarios.length > 0 && <div style={{ marginTop: 10, display: "grid", gap: 6 }}>{d.comentarios.slice(0, 10).map((x, i) => <div key={i} style={{ fontSize: 13.5, borderLeft: "3px solid var(--line)", paddingLeft: 10 }}>«{x.comentario}» <span style={{ color: "var(--muted)" }}>— {MOTIVO_TXT[x.motivo]} · {x.email || ""}</span></div>)}</div>}
    </section>

    {cfg && <section style={K.card}>
      <div style={{ fontWeight: 900, fontSize: 16 }}><IcoUI n="ajustes" s={16} style={ikUI} />Correos automáticos</div>
      <div style={{ fontSize: 13, color: "var(--muted)", margin: "2px 0 10px" }}>Se revisan cada hora. Cada correo se envía una sola vez a cada cuenta. Los comerciales llevan enlace para darse de baja.</div>
      <div style={{ display: "grid", gap: 8 }}>
        {SECUENCIAS.map(([sec, t, sub, tipo]) => { const v = cfg.secuencias?.[sec] || {}; return (
          <div key={sec} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 10, display: "grid", gap: 6 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={!!v.activo} onChange={e => setSec(sec, "activo", e.target.checked)} style={{ width: 22, height: 22, accentColor: "var(--accent)" }} />
              <span style={{ flex: 1 }}><b>{t}</b><span style={{ display: "block", fontSize: 12.5, color: "var(--muted)" }}>{sub}</span></span>
            </label>
            {tipo === "dias" && <input value={(v.dias || []).join(", ")} onChange={e => setSec(sec, "dias", numeros(e.target.value))} style={{ ...K.input, minHeight: 40, fontSize: 16 }} aria-label={`Días de ${t}`} />}
            {tipo === "dias_antes" && <input value={v.dias_antes ?? 2} inputMode="numeric" onChange={e => setSec(sec, "dias_antes", Math.min(6, numeros(e.target.value)[0] ?? 1))} style={{ ...K.input, minHeight: 40, fontSize: 16 }} aria-label="Días antes" />}
            {tipo === "dias_num" && <input value={v.dias ?? 14} inputMode="numeric" onChange={e => setSec(sec, "dias", Math.max(7, numeros(e.target.value)[0] ?? 14))} style={{ ...K.input, minHeight: 40, fontSize: 16 }} aria-label="Días sin entrar" />}
          </div>); })}
      </div>
      <div style={{ fontWeight: 900, marginTop: 14 }}>Ofertas</div>
      {[["oferta_retencion", "Para quedarse (al cancelar)"], ["oferta_recuperar", "Para volver (tras cancelar)"]].map(([o, t]) => <div key={o} style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px", gap: 8, alignItems: "center", marginTop: 8 }}>
        <span style={{ fontSize: 14 }}>{t}</span>
        <input value={cfg[o]?.descuento ?? ""} inputMode="numeric" onChange={e => setOf(o, "descuento", Math.min(100, numeros(e.target.value)[0] ?? 0))} style={{ ...K.input, minHeight: 40 }} aria-label={`${t}: descuento %`} />
        <input value={cfg[o]?.meses ?? ""} inputMode="numeric" onChange={e => setOf(o, "meses", Math.max(1, Math.min(12, numeros(e.target.value)[0] ?? 1)))} style={{ ...K.input, minHeight: 40 }} aria-label={`${t}: meses`} />
      </div>)}
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, textAlign: "right" }}>% de descuento · meses</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: 8, alignItems: "center", marginTop: 8 }}><span style={{ fontSize: 14 }}>Pausa máxima (meses, temporada baja)</span>
        <input value={cfg.pausa_max_meses ?? 3} inputMode="numeric" onChange={e => setCfg(c => ({ ...c, pausa_max_meses: Math.max(1, Math.min(6, numeros(e.target.value)[0] ?? 3)) }))} style={{ ...K.input, minHeight: 40 }} aria-label="Pausa máxima" /></div>
      <button disabled={!!busy} onClick={() => accion("cfg", () => rpc("admin_crecimiento_guardar", { p: cfg }), "✓ Automatizaciones guardadas")} style={{ ...K.btn, width: "100%", marginTop: 12, minHeight: 50, background: "var(--accent)", border: "none", color: "#fff" }}>Guardar</button>
    </section>}

    <section style={K.card}>
      <div style={{ fontWeight: 900, fontSize: 16 }}><IcoUI n="megafono" s={16} style={ikUI} />Campaña de correo</div>
      <div style={{ fontSize: 13, color: "var(--muted)", margin: "2px 0 10px" }}>Para novedades u ofertas puntuales. Solo llega a quien no se ha dado de baja de los correos comerciales.</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{SEGMENTOS.map(([k2, t]) => <button key={k2} onClick={() => setCamp(c => ({ ...c, segmento: k2 }))} style={K.chip(camp.segmento === k2)}>{t}</button>)}</div>
      <input value={camp.asunto} onChange={e => setCamp(c => ({ ...c, asunto: e.target.value.slice(0, 120) }))} placeholder="Asunto" style={{ ...K.input, marginTop: 10 }} aria-label="Asunto" />
      <textarea value={camp.texto} onChange={e => setCamp(c => ({ ...c, texto: e.target.value.slice(0, 4000) }))} placeholder={"Texto del correo.\n\nDeja una línea en blanco entre párrafos."} rows={6} style={{ ...K.input, marginTop: 8, padding: 12, minHeight: 140, resize: "vertical" }} aria-label="Texto" />
      <input value={camp.boton} onChange={e => setCamp(c => ({ ...c, boton: e.target.value.slice(0, 40) }))} placeholder="Texto del botón (opcional)" style={{ ...K.input, marginTop: 8 }} aria-label="Botón" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
        <button disabled={!!busy} onClick={() => accion("cp", () => servidor({ accion: "campana", ...camp, prueba: true }), "✓ Te hemos enviado la prueba")} style={K.btn}>Enviarme una prueba</button>
        <button disabled={!!busy} onClick={() => window.confirm(`¿Enviar «${camp.asunto}» a «${SEGMENTOS.find(x => x[0] === camp.segmento)[1]}»?`) && accion("ce", async () => { const r = await servidor({ accion: "campana", ...camp, id_campana: `${camp.segmento}-${camp.asunto}`.toLowerCase().replace(/[^a-z0-9]+/g, "-") }); avisar(`✓ ${r.enviados} enviados${r.quedan ? ` · quedan ${r.quedan}: vuelve a pulsar` : ""}`); }, null)} style={{ ...K.btn, background: "var(--accent)", border: "none", color: "#fff" }}>Enviar campaña</button>
      </div>
    </section>

    <section style={K.card}>
      <div style={{ fontWeight: 900, fontSize: 16 }}><IcoUI n="correo" s={16} style={ikUI} />Últimos correos</div>
      {!d.correos.length && <div style={{ color: "var(--muted)", fontSize: 14, marginTop: 6 }}>Aún no se ha enviado ninguno.</div>}
      <div style={{ display: "grid", gap: 4, marginTop: 8 }}>{d.correos.slice(0, 40).map((x, i) => <div key={i} style={{ fontSize: 13, padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
        <span style={K.badge(x.estado === "enviado" ? "var(--green)" : x.estado === "error" ? "var(--red)" : "var(--muted)")}>{x.estado}</span> <b>{x.asunto}</b>
        <div style={{ color: "var(--muted)", overflowWrap: "anywhere" }}>{fecha(x.fecha, true)} · {x.email}{x.error ? ` · ${x.error}` : ""}</div></div>)}</div>
    </section>
  </div>);
}

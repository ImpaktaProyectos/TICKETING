// ===================== PANEL DE ADMINISTRACIÓN DE TIXFAST =====================
// Solo lo ven los administradores de la plataforma (tabla ticket_superadmins).
// Resumen · Cuentas (todas las registradas) · Errores · Registro de acciones.
// Los datos los dan funciones del servidor que comprueban el permiso: aunque alguien
// abriera esta pantalla sin serlo, no recibiría nada.
import React, { useEffect, useMemo, useState } from "react";
import { Capa } from "./Capa";
import { supabase } from "./supabase";
import { ESTADO_CUENTA, eurosTxt } from "./cuenta";

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
      <nav role="tablist" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
        {[["resumen", "Resumen"], ["cuentas", "Cuentas"], ["errores", "Errores"], ["registro", "Registro"]].map(([k, t]) =>
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{ ...K.chip(tab === k), borderRadius: 12, minHeight: 42, padding: 0 }}>{t}</button>)}
      </nav>
      <main data-scroll style={{ flex: 1, overflow: "auto", overscrollBehavior: "contain", padding: "14px 12px calc(20px + env(safe-area-inset-bottom))" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          {tab === "resumen" && <Resumen avisar={avisar} irA={setTab} />}
          {tab === "cuentas" && <Cuentas avisar={avisar} />}
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
  const [precio, setPrecio] = useState("");
  const cargar = () => rpc("admin_resumen").then(x => { setR(x); setPrecio(String(x.precio ?? "").replace(".", ",")); }).catch(() => setR(false));
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
  const guardarPrecio = async () => {
    const v = parseFloat(String(precio).replace(",", "."));
    if (!(v > 0)) return avisar("Escribe un precio válido", true);
    if (!window.confirm(`¿Cambiar el precio a ${eurosTxt(v)} al mes? Se aplica a las altas nuevas; las suscripciones en marcha mantienen su precio.`)) return;
    try { await rpc("admin_precio", { p_importe: v }); avisar("✓ Precio actualizado"); cargar(); } catch { avisar("No se ha podido cambiar el precio", true); }
  };
  return (<div style={{ display: "grid", gap: 12 }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
      {tiles.map(([t, n, sub, c]) => <div key={t} style={K.card}>
        <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: .6 }}>{t}</div>
        <div style={{ fontSize: 28, fontWeight: 900, color: c || "var(--text)", marginTop: 2 }}>{n ?? 0}</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{sub}</div>
      </div>)}
    </div>
    <div style={K.card}>
      <div style={{ fontWeight: 900 }}>Precio de la suscripción</div>
      <div style={{ fontSize: 13, color: "var(--muted)", margin: "2px 0 10px" }}>Al mes, IVA incluido. Las suscripciones en marcha mantienen el precio con el que se dieron de alta.</div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={precio} inputMode="decimal" onChange={e => setPrecio(e.target.value.replace(/[^\d.,]/g, "").slice(0, 8))} style={{ ...K.input, flex: 1 }} aria-label="Precio al mes" />
        <button onClick={guardarPrecio} style={{ ...K.btn, background: "var(--accent)", border: "none", color: "#fff" }}>Guardar</button>
      </div>
    </div>
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
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>Alta {fecha(c.alta)} · entró {hace(c.ultimo_acceso)} · {c.eventos} {c.eventos === 1 ? "evento" : "eventos"}{c.errores_7d ? ` · ⚠️ ${c.errores_7d} errores` : ""}</div>
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
  useEffect(() => { rpc("admin_cuenta_detalle", { p_owner: c.owner_id }).then(setD).catch(() => setD(false)); }, [c.owner_id]);
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
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Regalar la suscripción (sin cobrar). Déjalo en blanco para que no caduque.</div>
            <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} style={K.input} aria-label="Regalada hasta" />
            {accion("🎁 Regalar suscripción", hasta ? `Hasta el ${fecha(hasta + "T23:59")}` : "Sin fecha de fin", () => hacer(`¿Regalar la suscripción a ${c.email}${hasta ? ` hasta el ${fecha(hasta + "T23:59")}` : " sin fecha de fin"}?${c.suscripcion_pago_id && ["activa", "prueba", "impagada"].includes(c.estado) ? "\n\nOJO: tiene una suscripción de pago en Stripe. Cancélala también para que no se le cobre." : ""}`,
              () => rpc("admin_cuenta_cambiar", { p_owner: c.owner_id, p_accion: "cortesia", p_hasta: hasta ? new Date(hasta + "T23:59:59").toISOString() : null }), "✓ Suscripción regalada"), "#c084fc")}
          </div>
          {accion("⭐ Hacer Fundador", "Sin cuota ni bloqueos, para siempre", () => hacer(`¿Hacer Fundador a ${c.email}?`, () => rpc("admin_cuenta_cambiar", { p_owner: c.owner_id, p_accion: "fundador" }), "✓ Ahora es Fundador"))}
          {c.suscripcion_pago_id && ["activa", "prueba", "impagada"].includes(c.estado) && !c.cancela_al_final && accion("Dar de baja al final del periodo", "Stripe deja de cobrar; sigue con acceso hasta el fin del mes pagado", () => hacer(`¿Dar de baja a ${c.email} al final de su periodo?`, () => servidor({ accion: "baja_stripe", cuenta: c.owner_id, cuando: "final" }), "✓ Baja programada en Stripe"), "var(--amber)")}
          {c.suscripcion_pago_id && ["activa", "prueba", "impagada"].includes(c.estado) && accion("Dar de baja ahora", "Se cancela en Stripe y pierde el acceso ya", () => hacer(`¿Dar de baja a ${c.email} AHORA? Pierde el acceso al momento.`, () => servidor({ accion: "baja_stripe", cuenta: c.owner_id, cuando: "ya" }), "✓ Suscripción cancelada"), "var(--red)")}
          {(c.plan_id === "fundador" || ["activa", "cortesia", "prueba"].includes(c.estado)) && !c.suscripcion_pago_id && accion("Quitar el acceso", "Pasa a sin suscripción (solo ticketera)", () => hacer(`¿Quitar el acceso a ${c.email}? Solo podrá usar la ticketera.`, () => rpc("admin_cuenta_cambiar", { p_owner: c.owner_id, p_accion: "quitar" }), "✓ Acceso quitado"), "var(--red)")}
          {accion(bloqueada ? "🔓 Desbloquear la cuenta" : "🚫 Bloquear la cuenta", bloqueada ? "Podrá volver a entrar" : "No podrá entrar en TIXFAST (sus datos se conservan)", () => hacer(bloqueada ? `¿Desbloquear a ${c.email}?` : `¿Bloquear a ${c.email}? No podrá entrar hasta que la desbloquees.`, () => servidor({ accion: "bloquear", cuenta: c.owner_id, bloquear: !bloqueada }), bloqueada ? "✓ Cuenta desbloqueada" : "✓ Cuenta bloqueada"), bloqueada ? null : "var(--red)")}
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
    {!grupos.length && <div style={{ ...K.card, color: "var(--muted)" }}>Sin errores. 🎉</div>}
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
const ACCIONES = { cortesia: "Regalar suscripción", fundador: "Hacer Fundador", quitar: "Quitar acceso", precio: "Cambiar precio", baja_stripe_inmediata: "Baja inmediata en Stripe", baja_stripe_fin_periodo: "Baja al final del periodo", bloquear_acceso: "Bloquear cuenta", desbloquear_acceso: "Desbloquear cuenta" };
function Registro() {
  const [lista, setLista] = useState(null);
  useEffect(() => { rpc("admin_registro", { p_limite: 200 }).then(x => setLista(x || [])).catch(() => setLista(false)); }, []);
  if (lista === null) return <div style={{ color: "var(--muted)" }}>Cargando…</div>;
  if (lista === false) return <div style={{ color: "var(--red)" }}>No se ha podido cargar el registro.</div>;
  if (!lista.length) return <div style={{ ...K.card, color: "var(--muted)" }}>Aún no hay acciones de administración.</div>;
  return (<div style={{ display: "grid", gap: 6 }}>{lista.map((x, i) => <div key={i} style={{ ...K.card, padding: 12, fontSize: 14 }}>
    <div style={{ fontWeight: 800 }}>{ACCIONES[x.accion] || x.accion}{x.accion === "precio" && x.detalle ? `: ${x.detalle.antes ?? "—"} → ${x.detalle.ahora} €` : ""}</div>
    <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2, overflowWrap: "anywhere" }}>{fecha(x.fecha, true)} · {x.cuenta || "plataforma"} · por {x.admin || "—"}</div>
  </div>)}</div>);
}

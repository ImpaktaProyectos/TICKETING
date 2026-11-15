// ===================== PÁGINA PÚBLICA · RESERVA TU MESA VIP =====================
// /r/<token>                    → plano en directo, elegir mesa, pack, botellas y mezclas, datos y pago del adelanto
// /r/<token>?reserva=<acceso>   → confirmación (vuelta de Stripe)
// /r/<token>?cancelada=<acceso> → volvió atrás sin pagar: la mesa se libera al momento
// Solo usa funciones públicas: nunca ve datos de otros clientes.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabase";
import { Plano } from "../plano/Plano";
import { enlazar } from "../plano/modelo";
import { importes, packsDeMesa, telefonoValido, emailValido } from "../reservasCalculo";
import { Mensaje, eur, fecha, LETRA } from "./comun";

const C = "#ff5a3c";
const V = { "--bg": "#07080b", "--card": "rgba(22,24,32,.92)", "--card2": "#1b1e27", "--text": "#f3f4f8", "--muted": "#9aa1b4", "--line": "rgba(255,255,255,.1)", "--c": C, "--ok": "#22d3a6" };
const TEMA_PLANO = { fondo: "#0c0e13", suelo: "#12141b", pared: "#3a3f4d", texto: "#f3f4f8", muted: "#7c8396", acento: C, libre: "#22d3a6", ocupada: "#4a4f5c" };
const BEB_DEF = ["Absolut", "Beefeater", "Puerto de Indias", "Barceló", "Brugal", "Ballantine's", "Jack Daniel's", "Jägermeister", "Moët"];
const MEZ_DEF = ["Coca-Cola", "Coca-Cola Zero", "Fanta Naranja", "Fanta Limón", "Sprite", "Tónica", "Red Bull", "Sin mezcla"];
const MOTIVOS = {
  ocupada: "¡Vaya! Alguien acaba de reservar esa mesa. Elige otra.", mesa: "Esa mesa ya no existe. Elige otra.", pack: "Ese pack ya no está disponible para esta mesa.",
  botellas: "Revisa las botellas elegidas.", datos: "Revisa tu nombre y tu teléfono.", personas: "Sois más personas de las que caben en esa mesa.",
  cerrada: "Las reservas online de este evento están cerradas.", sin_pago: "El organizador aún no puede cobrar online. Contacta con él para reservar.",
  origen: "No se ha podido iniciar el pago desde esta página.", error: "No se ha podido completar. Inténtalo de nuevo en un momento.",
};
const CSS = `
*{box-sizing:border-box}body{margin:0;background:#07080b}
.rv{min-height:100dvh;color:var(--text);font-family:${LETRA.inter};background:radial-gradient(1200px 600px at 50% -10%,rgba(255,90,60,.18),transparent 60%),var(--bg)}
.rv-in{max-width:1100px;margin:0 auto;padding:16px 16px calc(120px + env(safe-area-inset-bottom))}
.rv-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:18px}
@media (min-width:900px){.rv-grid{grid-template-columns:minmax(0,1.35fr) minmax(0,.65fr);align-items:start}.rv-lado{position:sticky;top:16px}}
.rv-card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:16px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
.rv-mesas{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:10px}
.rv-mesa{text-align:left;border-radius:16px;padding:12px;border:1.5px solid var(--line);background:var(--card2);color:var(--text);cursor:pointer;min-height:84px;font:inherit}
.rv-mesa[disabled]{opacity:.45;cursor:not-allowed}
.rv-mesa.on{border-color:var(--c);box-shadow:0 0 0 3px rgba(255,90,60,.25)}
.rv-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:54px;border:none;border-radius:16px;background:var(--c);color:#fff;font-weight:900;font-size:17px;cursor:pointer;font-family:inherit}
.rv-btn[disabled]{opacity:.45;cursor:not-allowed}
.rv-sec{display:flex;align-items:center;justify-content:center;width:100%;min-height:48px;border:1px solid var(--line);border-radius:14px;background:transparent;color:var(--text);font-weight:800;font-size:15px;cursor:pointer;font-family:inherit}
.rv-inp{width:100%;min-height:50px;border-radius:13px;border:1px solid var(--line);background:var(--card2);color:var(--text);font-size:16px;padding:0 14px;font-family:inherit;outline:none}
.rv-inp:focus,.rv-sel:focus{border-color:var(--c)}
.rv-sel{width:100%;min-height:48px;border-radius:12px;border:1px solid var(--line);background:var(--card2);color:var(--text);font-size:16px;padding:0 10px;font-family:inherit}
.rv-lbl{display:block;font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin:14px 0 6px}
.rv-pack{display:block;width:100%;text-align:left;border-radius:16px;padding:14px;border:1.5px solid var(--line);background:var(--card2);color:var(--text);cursor:pointer;margin-bottom:10px;font:inherit}
.rv-pack.on{border-color:var(--c);background:rgba(255,90,60,.1)}
.rv-hoja{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.62);display:flex;align-items:flex-end;justify-content:center}
.rv-hoja>div{width:100%;max-width:560px;max-height:94dvh;display:flex;flex-direction:column;background:#11131a;border:1px solid var(--line);border-bottom:none;border-radius:24px 24px 0 0;animation:rvSube .28s cubic-bezier(.2,.8,.2,1)}
@media (min-width:700px){.rv-hoja{align-items:center}.rv-hoja>div{border-radius:24px;border-bottom:1px solid var(--line)}}
@keyframes rvSube{from{transform:translateY(40px);opacity:0}to{transform:none;opacity:1}}
@keyframes rvLat{0%,100%{opacity:1}50%{opacity:.35}}
.rv-vivo{display:inline-block;width:8px;height:8px;border-radius:8px;background:#22d3a6;animation:rvLat 1.6s infinite}
@media (prefers-reduced-motion:reduce){.rv-hoja>div,.rv-vivo{animation:none}}
button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid var(--c);outline-offset:2px}
`;

export default function PaginaReservas({ token }) {
  const q = new URLSearchParams(window.location.search);
  const acceso = q.get("reserva");
  const cancelada = q.get("cancelada");
  if (acceso) return <Pagina><Confirmacion token={token} acceso={acceso} /></Pagina>;
  return <Pagina><Reservar token={token} cancelada={cancelada} /></Pagina>;
}
const Pagina = ({ children }) => <div className="rv" style={V}><style>{CSS}</style>{children}</div>;

/* ===================== Elegir y reservar ===================== */
function Reservar({ token, cancelada }) {
  const [d, setD] = useState(undefined);
  const [error, setError] = useState(false);
  const [sel, setSel] = useState(null);
  const [vista, setVista] = useState("2d");
  const [aviso, setAviso] = useState(null);
  const [abierta, setAbierta] = useState(false);   // hoja de reserva (no se reinicia con la recarga en directo)
  const cargar = async () => {
    try { const { data, error: e } = await supabase.rpc("reservas_publico", { p_token: token }); if (e) throw e; setD(data || null); setError(false); }
    catch { setError(true); }
  };
  // En directo: cada 8 s mientras se ve la página
  useEffect(() => {
    cargar();
    const t = setInterval(() => { if (document.visibilityState !== "hidden") cargar(); }, 8000);
    const vis = () => { if (document.visibilityState === "visible") cargar(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [token]);
  // Volvió de Stripe sin pagar: se libera la mesa al momento
  useEffect(() => {
    if (!cancelada) return;
    supabase.functions.invoke("reservas-web", { body: { accion: "cancelar", acceso: cancelada } }).finally(() => { setAviso("No se ha completado el pago. Tu mesa no está reservada: puedes elegirla de nuevo."); cargar(); });
    try { window.history.replaceState(null, "", window.location.pathname); } catch {}
  }, [cancelada]);
  useEffect(() => { if (d?.evento?.nombre) document.title = `Reserva tu mesa · ${d.evento.nombre}`; }, [d?.evento?.nombre]);
  // Si la mesa elegida deja de estar libre mientras decide
  const mesas = d?.mesas || [];
  const mesaSel = mesas.find(m => m.id === sel) || null;
  useEffect(() => { if (sel && mesaSel && !mesaSel.libre && !abierta) { setSel(null); setAviso(MOTIVOS.ocupada); } }, [mesaSel?.libre]);

  const plano = useMemo(() => (d?.plano?.elementos?.length ? enlazar(d.plano, mesas) : null), [d?.plano, mesas]);
  const infoMesas = useMemo(() => Object.fromEntries(mesas.map(m => [m.id, { nombre: m.nombre, libre: m.libre, personas: m.personas }])), [mesas]);
  const libres = mesas.filter(m => m.libre).length;
  const desde = (m) => { const ps = packsDeMesa(d?.tarifas, m); return ps.length ? Math.min(...ps.map(p => Number(p.precio))) : null; };

  if (d === undefined && !error) return <Mensaje titulo="Cargando…" />;
  if (error && !d) return <Mensaje titulo="No se ha podido cargar" texto="Revisa tu conexión e inténtalo de nuevo."><button onClick={cargar} className="rv-btn" style={{ marginTop: 16 }}>Reintentar</button></Mensaje>;
  if (!d) return <Mensaje titulo="Reservas no disponibles" texto="Las reservas online de este evento están cerradas o el enlace no es correcto." />;
  const ev = d.evento;
  return (
    <div className="rv-in">
      {/* Cabecera */}
      <header style={{ position: "relative", borderRadius: 24, overflow: "hidden", marginBottom: 18, minHeight: 170, display: "flex", alignItems: "flex-end", background: "#11131a", border: "1px solid var(--line)" }}>
        {ev.flyer && <img src={ev.flyer} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: "blur(2px) brightness(.45)", transform: "scale(1.05)" }} />}
        <div style={{ position: "relative", padding: "20px 18px", width: "100%", background: "linear-gradient(180deg, transparent, rgba(7,8,11,.85))" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: C, background: "rgba(255,90,60,.14)", border: "1px solid rgba(255,90,60,.4)", borderRadius: 999, padding: "5px 11px" }}>⭐ Reserva tu mesa VIP</div>
          <h1 style={{ margin: "10px 0 4px", fontSize: "clamp(26px, 6vw, 42px)", fontWeight: 900, lineHeight: 1.05, letterSpacing: -0.5 }}>{ev.nombre}</h1>
          <div style={{ color: "var(--muted)", fontSize: 15, fontWeight: 600 }}>{mayus(fecha(ev.inicio || ev.fecha))}{ev.recinto ? ` · ${ev.recinto}` : ""}</div>
        </div>
      </header>
      {aviso && <div role="status" style={{ background: "rgba(255,180,0,.14)", border: "1px solid rgba(255,180,0,.45)", color: "#ffd479", borderRadius: 14, padding: "12px 14px", fontWeight: 700, marginBottom: 14, display: "flex", gap: 10, alignItems: "center" }}><span style={{ flex: 1 }}>{aviso}</span><button onClick={() => setAviso(null)} aria-label="Cerrar aviso" style={{ background: "none", border: "none", color: "inherit", fontSize: 18, cursor: "pointer", minWidth: 44, minHeight: 44 }}>✕</button></div>}

      <div className="rv-grid">
        <section className="rv-card" aria-label="Plano de la sala">
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <div style={{ flex: 1, minWidth: 160 }}><div style={{ fontWeight: 900, fontSize: 19 }}>Elige tu mesa</div>
              <div style={{ fontSize: 13.5, color: "var(--muted)", display: "flex", alignItems: "center", gap: 7, marginTop: 2 }}><span className="rv-vivo" aria-hidden="true" />En directo · {libres} {libres === 1 ? "mesa disponible" : "mesas disponibles"}</div></div>
            {plano && <div role="tablist" aria-label="Vista" style={{ display: "inline-flex", border: "1px solid var(--line)", borderRadius: 12, padding: 3 }}>
              {[["2d", "Plano"], ["3d", "3D"]].map(([k, t]) => <button key={k} role="tab" aria-selected={vista === k} onClick={() => setVista(k)} style={{ minHeight: 38, padding: "0 13px", borderRadius: 9, border: "none", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", background: vista === k ? C : "transparent", color: vista === k ? "#fff" : "var(--text)" }}>{t}</button>)}
            </div>}
          </div>
          {plano ? <>
            <Plano plano={plano} mesas={infoMesas} modo="publico" vista={vista} tema={TEMA_PLANO} seleccion={plano.elementos.find(e => e.reservadoId === sel)?.id} altura="min(64dvh, 620px)" alTocar={(e) => { const m = mesas.find(x => x.id === e.reservadoId); if (m?.libre) setSel(m.id); }} />
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, color: "var(--muted)", fontWeight: 700, marginTop: 10 }}>
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><i style={{ width: 12, height: 12, borderRadius: 4, background: "rgba(34,211,166,.35)", border: "2px solid #22d3a6" }} />Disponible</span>
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><i style={{ width: 12, height: 12, borderRadius: 4, background: "repeating-linear-gradient(45deg,#4a4f5c 0 3px,transparent 3px 6px)", border: "2px solid #4a4f5c" }} />Reservada</span>
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><i style={{ width: 12, height: 12, borderRadius: 4, border: `2px solid ${C}` }} />Tu elección</span>
            </div>
          </> : null}
          <div className="rv-lbl" style={{ marginTop: plano ? 18 : 0 }}>{plano ? "O elige de la lista" : "Mesas"}</div>
          <div className="rv-mesas">
            {mesas.map(m => { const p = desde(m); return (
              <button key={m.id} className={"rv-mesa" + (sel === m.id ? " on" : "")} disabled={!m.libre} onClick={() => setSel(m.id)} aria-pressed={sel === m.id}>
                <div style={{ fontWeight: 900, fontSize: 18 }}>{m.nombre}</div>
                <div style={{ fontSize: 13, color: m.libre ? "#22d3a6" : "var(--muted)", fontWeight: 800 }}>{m.libre ? "Disponible" : "Reservada"}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{m.personas ? `Hasta ${m.personas} pers.` : m.tamano === "grande" ? "Mesa grande" : "Mesa"}{m.libre && p != null ? ` · desde ${eur(p)}` : ""}</div>
              </button>); })}
          </div>
        </section>
        <aside className="rv-lado">
          <div className="rv-card">
            <div style={{ fontWeight: 900, fontSize: 17 }}>Cómo funciona</div>
            <ol style={{ margin: "10px 0 0", paddingLeft: 20, color: "var(--muted)", lineHeight: 1.7, fontSize: 14.5 }}>
              <li>Elige tu mesa en el plano.</li><li>Elige el pack y vuestras botellas con su mezcla.</li>
              <li>{d.online.adelanto_pct > 0 ? `Paga el ${d.online.adelanto_pct} % ahora para asegurarla.` : "Confirma la reserva."}</li><li>El resto, en el local esa noche.</li>
            </ol>
            {d.online.condiciones && <div style={{ marginTop: 12, fontSize: 13, color: "var(--muted)", whiteSpace: "pre-wrap", borderTop: "1px solid var(--line)", paddingTop: 10 }}>{d.online.condiciones}</div>}
          </div>
        </aside>
      </div>

      {/* Barra fija con la mesa elegida */}
      {mesaSel && <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 30, padding: "12px 16px calc(12px + env(safe-area-inset-bottom))", background: "rgba(17,19,26,.94)", borderTop: "1px solid var(--line)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}>
        <div style={{ maxWidth: 560, margin: "0 auto", display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 900, fontSize: 17 }}>{mesaSel.nombre}</div><div style={{ fontSize: 13, color: "var(--muted)" }}>{desde(mesaSel) != null ? `Desde ${eur(desde(mesaSel))}` : "Elige tu pack"}</div></div>
          <button className="rv-btn" style={{ width: "auto", padding: "0 22px" }} onClick={() => setAbierta(true)}>Reservar →</button>
        </div>
      </div>}
      {abierta && mesaSel && <Hoja key={mesaSel.id} d={d} token={token} mesa={mesaSel} onCerrar={() => setAbierta(false)} onOcupada={(t) => { setAbierta(false); setSel(null); setAviso(t); cargar(); }} />}
    </div>
  );
}

function Hoja({ d, token, mesa, onCerrar, onOcupada }) {
  const packs = packsDeMesa(d.tarifas, mesa);
  const [paso, setPaso] = useState(0);
  const [pack, setPack] = useState(packs.length === 1 ? packs[0].id : null);
  const tarifa = packs.find(p => p.id === pack) || null;
  const incl = tarifa ? Math.max(0, parseInt(tarifa.botellas, 10) || 0) : 0;
  const [botellas, setBotellas] = useState([]);
  useEffect(() => { setBotellas(b => { const n = Math.max(incl, b.length > incl ? b.length : incl); return Array.from({ length: n }, (_, i) => b[i] || { bebida: "", mezcla: "" }); }); }, [incl]);
  const [f, setF] = useState({ nombre: "", telefono: "", email: "", personas: "", acepto: false });
  const [enviando, setEnviando] = useState(false);
  const [err, setErr] = useState(null);
  const cuerpo = useRef(null);
  useEffect(() => { cuerpo.current?.scrollTo?.(0, 0); }, [paso]);
  useEffect(() => { const k = (e) => e.key === "Escape" && !enviando && onCerrar(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [enviando]);
  const bebidas = d.online.bebidas?.length ? d.online.bebidas : BEB_DEF;
  const mezclas = d.online.mezclas?.length ? d.online.mezclas : MEZ_DEF;
  const maxBot = incl + (d.precio_extra != null ? (d.online.max_extra ?? 4) : 0);
  const I = tarifa ? importes(tarifa, botellas.length, d.precio_extra, d.online.adelanto_pct) : null;
  const botOk = botellas.length >= 0 && botellas.every(b => b.bebida && b.mezcla);
  const datosOk = f.nombre.trim().length >= 2 && telefonoValido(f.telefono) && emailValido(f.email) && (!d.online.condiciones || f.acepto) && (!f.personas || !mesa.personas || Number(f.personas) <= mesa.personas);
  const PASOS = ["Pack", incl || maxBot ? "Botellas" : null, "Tus datos", "Pagar"].filter(Boolean);
  const pasoNombre = PASOS[paso];
  const puede = pasoNombre === "Pack" ? !!tarifa : pasoNombre === "Botellas" ? botOk : pasoNombre === "Tus datos" ? datosOk : true;
  const enviar = async () => {
    setEnviando(true); setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("reservas-web", { body: { accion: "reservar", token, mesa: mesa.id, tarifa: tarifa.id, botellas,
        cliente: { nombre: f.nombre.trim(), telefono: f.telefono.trim(), email: f.email.trim() }, personas: f.personas ? Number(f.personas) : null, origen: window.location.origin } });
      if (error || !data?.ok) {
        const m = data?.motivo || "error";
        if (m === "ocupada" || m === "mesa") { onOcupada(MOTIVOS[m]); return; }
        setErr(MOTIVOS[m] || MOTIVOS.error); setEnviando(false); return;
      }
      if (data.url) { window.location.assign(data.url); return; }
      window.location.assign(`${window.location.pathname}?reserva=${data.acceso}`);
    } catch { setErr(MOTIVOS.error); setEnviando(false); }
  };
  return (
    <div className="rv-hoja" onClick={() => !enviando && onCerrar()}>
      <div role="dialog" aria-modal="true" aria-label={`Reservar ${mesa.nombre}`} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "16px 18px 10px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1 }}><div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 800 }}>Reservando</div><div style={{ fontWeight: 900, fontSize: 20 }}>{mesa.nombre}{mesa.personas ? <span style={{ fontSize: 14, color: "var(--muted)", fontWeight: 700 }}> · hasta {mesa.personas} pers.</span> : null}</div></div>
            <button onClick={onCerrar} disabled={enviando} aria-label="Cerrar" style={{ width: 44, height: 44, borderRadius: 12, border: "1px solid var(--line)", background: "transparent", color: "var(--text)", fontSize: 18, cursor: "pointer" }}>✕</button>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 12 }} aria-label={`Paso ${paso + 1} de ${PASOS.length}: ${pasoNombre}`}>
            {PASOS.map((p, i) => <div key={p} style={{ flex: 1 }}><div style={{ height: 4, borderRadius: 4, background: i <= paso ? C : "var(--line)", transition: "background .3s" }} /><div style={{ fontSize: 11, fontWeight: 800, marginTop: 5, color: i === paso ? "var(--text)" : "var(--muted)" }}>{p}</div></div>)}
          </div>
        </div>
        <div ref={cuerpo} style={{ flex: 1, overflow: "auto", overscrollBehavior: "contain", padding: "6px 18px 14px" }}>
          {pasoNombre === "Pack" && <>
            <div className="rv-lbl">Elige tu pack</div>
            {!packs.length && <div style={{ color: "var(--muted)" }}>Esta mesa aún no tiene packs disponibles online.</div>}
            {packs.map(p => <button key={p.id} className={"rv-pack" + (pack === p.id ? " on" : "")} onClick={() => setPack(p.id)} aria-pressed={pack === p.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={{ fontSize: 26 }}>{p.emoji || "🍾"}</span>
                <div style={{ flex: 1 }}><div style={{ fontWeight: 900, fontSize: 16.5 }}>{p.nombre}</div><div style={{ fontSize: 13.5, color: "var(--muted)" }}>{p.incluye || `${p.botellas} ${Number(p.botellas) === 1 ? "botella" : "botellas"} incluidas`}</div></div>
                <div style={{ fontWeight: 900, fontSize: 18 }}>{eur(p.precio)}</div></div>
            </button>)}
          </>}
          {pasoNombre === "Botellas" && <>
            <div className="rv-lbl">Vuestras botellas</div>
            <div style={{ fontSize: 13.5, color: "var(--muted)", marginBottom: 8 }}>{incl ? `Tu pack incluye ${incl} ${incl === 1 ? "botella" : "botellas"}. Elige la bebida y la mezcla de cada una.` : "Elige la bebida y la mezcla."}</div>
            {botellas.map((b, i) => <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <select className="rv-sel" value={b.bebida} aria-label={`Bebida ${i + 1}`} onChange={e => setBotellas(x => x.map((y, j) => j === i ? { ...y, bebida: e.target.value } : y))}><option value="">🍾 Bebida…</option>{bebidas.map(v => <option key={v}>{v}</option>)}</select>
              <select className="rv-sel" value={b.mezcla} aria-label={`Mezcla ${i + 1}`} onChange={e => setBotellas(x => x.map((y, j) => j === i ? { ...y, mezcla: e.target.value } : y))}><option value="">🥤 Mezcla…</option>{mezclas.map(v => <option key={v}>{v}</option>)}</select>
              {i >= incl ? <button onClick={() => setBotellas(x => x.filter((_, j) => j !== i))} aria-label="Quitar botella" style={{ width: 44, height: 44, borderRadius: 12, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" }}>✕</button> : <span style={{ width: 44, textAlign: "center", fontSize: 11, color: "var(--muted)", fontWeight: 800 }}>Incl.</span>}
            </div>)}
            {botellas.length < maxBot && d.precio_extra != null && <button className="rv-sec" onClick={() => setBotellas(x => [...x, { bebida: "", mezcla: "" }])}>+ Añadir botella extra · {eur(d.precio_extra)}</button>}
          </>}
          {pasoNombre === "Tus datos" && <>
            <label className="rv-lbl" htmlFor="rv-nombre">Nombre y apellidos</label><input id="rv-nombre" className="rv-inp" value={f.nombre} autoComplete="name" onChange={e => setF(x => ({ ...x, nombre: e.target.value.slice(0, 120) }))} />
            <label className="rv-lbl" htmlFor="rv-tel">Teléfono</label><input id="rv-tel" className="rv-inp" type="tel" inputMode="tel" autoComplete="tel" value={f.telefono} onChange={e => setF(x => ({ ...x, telefono: e.target.value.slice(0, 30) }))} />
            {f.telefono && !telefonoValido(f.telefono) && <div style={{ color: "#ff8a8a", fontSize: 13, marginTop: 4 }}>Escribe un teléfono válido.</div>}
            <label className="rv-lbl" htmlFor="rv-email">Correo (para el justificante)</label><input id="rv-email" className="rv-inp" type="email" inputMode="email" autoComplete="email" value={f.email} onChange={e => setF(x => ({ ...x, email: e.target.value.slice(0, 160) }))} />
            {!emailValido(f.email) && <div style={{ color: "#ff8a8a", fontSize: 13, marginTop: 4 }}>Revisa el correo.</div>}
            <label className="rv-lbl" htmlFor="rv-pers">¿Cuántos seréis?</label><input id="rv-pers" className="rv-inp" inputMode="numeric" value={f.personas} placeholder={mesa.personas ? `Hasta ${mesa.personas}` : "Personas"} onChange={e => setF(x => ({ ...x, personas: e.target.value.replace(/\D/g, "").slice(0, 3) }))} style={{ maxWidth: 180 }} />
            {f.personas && mesa.personas && Number(f.personas) > mesa.personas && <div style={{ color: "#ff8a8a", fontSize: 13, marginTop: 4 }}>En esta mesa caben hasta {mesa.personas}.</div>}
            {d.online.condiciones && <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 16, fontSize: 14, lineHeight: 1.45, cursor: "pointer" }}>
              <input type="checkbox" checked={f.acepto} onChange={e => setF(x => ({ ...x, acepto: e.target.checked }))} style={{ width: 22, height: 22, flexShrink: 0, accentColor: C, marginTop: 1 }} />
              <span>Acepto las condiciones de la reserva: <span style={{ color: "var(--muted)" }}>{d.online.condiciones}</span></span></label>}
            <Privacidad legal={d.legal} />
          </>}
          {pasoNombre === "Pagar" && I && <>
            <div className="rv-lbl">Resumen</div>
            <Linea t={`${mesa.nombre} · ${tarifa.nombre}`} v={eur(tarifa.precio)} />
            {botellas.length > incl && <Linea t={`${botellas.length - incl} ${botellas.length - incl === 1 ? "botella extra" : "botellas extra"}`} v={eur((botellas.length - incl) * d.precio_extra)} />}
            {botellas.length > 0 && <div style={{ fontSize: 13.5, color: "var(--muted)", margin: "4px 0 10px", lineHeight: 1.5 }}>{botellas.map(b => `${b.bebida} + ${b.mezcla}`).join(" · ")}</div>}
            <Linea t="Total de la reserva" v={eur(I.total)} fuerte />
            <div style={{ marginTop: 12, padding: 14, borderRadius: 16, background: "rgba(255,90,60,.1)", border: "1px solid rgba(255,90,60,.35)" }}>
              {d.online.adelanto_pct > 0 ? <>
                <Linea t={`Adelanto (${d.online.adelanto_pct} %)`} v={eur(I.adelanto)} />
                {I.gastos > 0 && <Linea t="Gastos de gestión" v={eur(I.gastos)} />}
                <Linea t="Pagas ahora" v={eur(I.hoy)} fuerte />
                <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 6 }}>El resto, <b style={{ color: "var(--text)" }}>{eur(I.resto)}</b>, lo pagas en el local esa noche.</div>
              </> : <div style={{ fontSize: 14.5 }}>Hoy no pagas nada: <b>{eur(I.total)}</b> en el local esa noche.</div>}
            </div>
            {err && <div role="alert" style={{ marginTop: 12, color: "#ff8a8a", fontWeight: 700 }}>{err}</div>}
            {d.online.adelanto_pct > 0 && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10, textAlign: "center" }}>🔒 Pago seguro con Stripe. Tu mesa queda bloqueada mientras pagas.</div>}
          </>}
        </div>
        <div style={{ padding: "12px 18px calc(14px + env(safe-area-inset-bottom))", borderTop: "1px solid var(--line)", display: "flex", gap: 10 }}>
          {paso > 0 && <button className="rv-sec" style={{ width: 120 }} onClick={() => setPaso(paso - 1)} disabled={enviando}>← Atrás</button>}
          {pasoNombre !== "Pagar"
            ? <button className="rv-btn" disabled={!puede} onClick={() => setPaso(paso + 1)}>Continuar</button>
            : <button className="rv-btn" disabled={enviando || !I || !d.online.pago} onClick={enviar}>{enviando ? "Un momento…" : !d.online.pago ? "Pago online no disponible" : d.online.adelanto_pct > 0 ? `Pagar ${eur(I.hoy)} y reservar` : "Confirmar reserva"}</button>}
        </div>
      </div>
    </div>
  );
}
const mayus = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const Linea = ({ t, v, fuerte }) => <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 0", fontSize: fuerte ? 17 : 15, fontWeight: fuerte ? 900 : 600 }}><span>{t}</span><span style={{ whiteSpace: "nowrap" }}>{v}</span></div>;

function Privacidad({ legal }) {
  const l = legal || {};
  const quien = l.razon_social || "el organizador del evento";
  return <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--muted)", marginTop: 16 }}>
    <b style={{ color: "var(--text)" }}>Privacidad:</b> {quien}{l.nif ? ` (NIF ${l.nif})` : ""} usará tus datos solo para gestionar tu reserva y contactarte sobre ella. El pago lo procesa Stripe; TIXFAST trata los datos por cuenta del organizador.
    Puedes pedir el acceso, la rectificación o la supresión de tus datos{l.email ? <> escribiendo a <a href={`mailto:${l.email}`} style={{ color: "var(--text)" }}>{l.email}</a></> : " al organizador"}.
  </div>;
}

/* ===================== Confirmación (vuelta de Stripe) ===================== */
function Confirmacion({ token, acceso }) {
  const [p, setP] = useState(undefined);
  const intentos = useRef(0);
  useEffect(() => {
    let vivo = true, t = null;
    const ver = async () => {
      try { await supabase.functions.invoke("reservas-web", { body: { accion: "confirmar", acceso } }); } catch {}
      const { data } = await supabase.rpc("reservas_pedido", { p_acceso: acceso });
      if (!vivo) return;
      setP(data || null);
      if (data?.estado === "pendiente" && intentos.current++ < 12) t = setTimeout(ver, 2500);
    };
    ver();
    return () => { vivo = false; clearTimeout(t); };
  }, [acceso]);
  if (p === undefined) return <Mensaje titulo="Confirmando tu reserva…" texto="Estamos comprobando el pago. No cierres esta página." />;
  if (!p) return <Mensaje titulo="No encontramos esta reserva" texto="Revisa el enlace o contacta con el organizador." />;
  const volver = <a href={`/r/${token}`} className="rv-sec" style={{ marginTop: 14, textDecoration: "none" }}>Volver al plano</a>;
  if (p.estado === "pendiente") return <Mensaje titulo="Confirmando el pago…" texto="Tarda unos segundos. Si ya has pagado, tu mesa queda guardada aunque cierres la página." />;
  if (p.estado === "caducado" || p.estado === "cancelado") return <Mensaje titulo="La reserva no se completó" texto="No se llegó a pagar y la mesa se ha liberado. Puedes intentarlo de nuevo.">{volver}</Mensaje>;
  if (p.estado === "conflicto") return <Mensaje titulo="Hemos recibido tu pago" texto="Pero tu mesa se liberó justo antes y otra persona la reservó. El organizador te contactará para darte otra mesa o devolverte el dinero." />;
  return (
    <div className="rv-in" style={{ maxWidth: 560 }}>
      <div className="rv-card" style={{ textAlign: "center", padding: "26px 20px", marginTop: 20 }}>
        <div style={{ width: 72, height: 72, borderRadius: 72, margin: "0 auto", display: "grid", placeItems: "center", background: "rgba(34,211,166,.15)", border: "2px solid #22d3a6", fontSize: 36 }}>✓</div>
        <h1 style={{ margin: "14px 0 4px", fontSize: 28, fontWeight: 900 }}>¡Mesa reservada!</h1>
        <div style={{ color: "var(--muted)" }}>{p.evento?.nombre} · {fecha(p.evento?.inicio || p.evento?.fecha)}</div>
        <div style={{ margin: "18px auto 0", display: "inline-block", fontFamily: "'Roboto Mono', ui-monospace, monospace", fontWeight: 900, fontSize: 22, letterSpacing: 2, padding: "8px 16px", borderRadius: 12, border: "1px dashed var(--line)" }}>{p.codigo}</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>Enseña este código al llegar. Haz una captura de pantalla.</div>
      </div>
      <div className="rv-card" style={{ marginTop: 14 }}>
        <Linea t="Mesa" v={p.mesa} fuerte /><Linea t="Nombre" v={p.nombre} />{p.personas ? <Linea t="Personas" v={p.personas} /> : null}
        <Linea t="Pack" v={p.tarifa} />
        {(p.botellas || []).length > 0 && <div style={{ fontSize: 14, color: "var(--muted)", padding: "4px 0 8px", lineHeight: 1.5 }}>🍾 {p.botellas.map(b => `${b.bebida} + ${b.mezcla}`).join(" · ")}</div>}
        <div style={{ borderTop: "1px solid var(--line)", marginTop: 6, paddingTop: 6 }}>
          <Linea t="Total de la reserva" v={eur(p.total)} />
          {p.adelanto > 0 && <Linea t="Adelanto pagado" v={eur(p.adelanto)} />}
          <Linea t="A pagar en el local" v={eur(p.resto)} fuerte />
        </div>
      </div>
      {volver}
    </div>
  );
}

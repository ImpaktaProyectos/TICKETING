// ===================== DISEÑADOR DEL PLANO =====================
// Dibuja la sala a escala: medidas, mesas VIP (enlazadas a los reservados), cabina, escenario,
// barras, pista, escaleras, entradas, aseos, carpa, zonas, árboles… Arrastrar para mover,
// tirador redondo para girar, tirador cuadrado para cambiar el tamaño. Deshacer y rehacer.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Capa } from "../Capa";
import { Plano } from "./Plano";
import { TIPOS, GRUPOS_TIPOS, normalizar, crear, mover, redimensionar, girar, duplicar, sinColocar, colocarReservados, plantilla, ajustar, enlazar, MIN_SALA, MAX_SALA } from "./modelo";
import { MisPlanos } from "./MisPlanos";
import { mesasQueFaltan } from "./biblioteca";

const K = {
  btn: { minHeight: 44, padding: "0 13px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontWeight: 800, fontSize: 14, cursor: "pointer", whiteSpace: "nowrap" },
  lbl: { display: "block", fontSize: 11.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: .7, margin: "12px 0 6px" },
  input: { width: "100%", boxSizing: "border-box", minHeight: 44, padding: "0 12px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontSize: 16, font: "inherit" },
  pieza: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, minHeight: 64, borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontWeight: 700, fontSize: 11.5, cursor: "pointer", padding: 4, textAlign: "center", lineHeight: 1.15 },
};
const FORMAS = { redonda: "Redonda", cuadrada: "Cuadrada", sofa: "Sofá", palco: "Palco" };
const numero = (t) => { const v = parseFloat(String(t).replace(",", ".")); return Number.isFinite(v) ? v : null; };

export function EditorPlano({ plano: inicial, reservados, isMobile, nombreSugerido = "", onGuardar, onCrearReservado, onCerrar }) {
  const [p, setP] = useState(() => (inicial ? normalizar(inicial) : null));
  const [hist, setHist] = useState({ atras: [], adelante: [] });
  const [sel, setSel] = useState(null);
  const [panel, setPanel] = useState(inicial ? "anadir" : "sala");
  const [guardando, setGuardando] = useState(false);
  const [verPlanos, setVerPlanos] = useState(false);   // hoja «Mis planos»
  const cambiado = useRef(false);
  const base = useRef(null);   // plano antes de empezar a arrastrar (para deshacer de una vez)

  // El plano actual y su historial viven también en referencias: los cambios se encadenan sin perderse
  const pRef = useRef(p), hRef = useRef(hist);
  const fijarHist = (h) => { hRef.current = h; setHist(h); };
  const aplicar = (nuevo, conHistoria = true) => {
    const prev = pRef.current;
    if (conHistoria && prev) fijarHist({ atras: [...hRef.current.atras.slice(-49), prev], adelante: [] });
    pRef.current = nuevo; setP(nuevo); cambiado.current = true;
  };
  const cambiarEl = (id, f, conHistoria = true) => {
    const prev = pRef.current; if (!prev) return;
    aplicar({ ...prev, elementos: prev.elementos.map(e => (e.id === id ? f(e, prev) : e)) }, conHistoria);
  };
  const deshacer = () => { const h = hRef.current; if (!h.atras.length) return; const ant = h.atras[h.atras.length - 1]; fijarHist({ atras: h.atras.slice(0, -1), adelante: [pRef.current, ...h.adelante] }); pRef.current = ant; setP(ant); cambiado.current = true; };
  const rehacer = () => { const h = hRef.current; if (!h.adelante.length) return; const sig = h.adelante[0]; fijarHist({ atras: [...h.atras, pRef.current], adelante: h.adelante.slice(1) }); pRef.current = sig; setP(sig); cambiado.current = true; };

  // Teclado (ordenador): borrar, deshacer, mover con flechas
  useEffect(() => {
    const k = (ev) => {
      if (/input|textarea|select/i.test(ev.target?.tagName || "")) return;
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") { ev.preventDefault(); ev.shiftKey ? rehacer() : deshacer(); return; }
      if (!sel) return;
      if (ev.key === "Delete" || ev.key === "Backspace") { ev.preventDefault(); borrar(); }
      const d = ev.shiftKey ? 1 : 0.25;
      const m = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[ev.key];
      if (m) { ev.preventDefault(); cambiarEl(sel, (e, pl) => mover(e, e.x + m[0], e.y + m[1], pl)); }
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [sel]);

  const mesas = useMemo(() => Object.fromEntries((reservados || []).map(r => [r.id, { nombre: r.nombre, estado: r.estado, cliente: r.cliente, personas: r.personas }])), [reservados]);
  const faltan = p ? sinColocar(p, reservados) : [];
  const elegido = p?.elementos.find(e => e.id === sel) || null;
  useEffect(() => { if (elegido) setPanel("elemento"); }, [sel]);

  const anadir = (tipo, extra = {}) => {
    const n = p.elementos.length % 6;
    const el = crear(tipo, p.ancho / 2 + n * 0.6 - 1.5, p.largo / 2 + n * 0.6 - 1.5, extra);
    aplicar({ ...p, elementos: [...p.elementos, el] }); setSel(el.id);
  };
  const nuevaMesa = async () => {
    const r = await onCrearReservado?.();
    anadir("mesa", r ? { reservadoId: r.id, ref: r.nombre } : {});
  };
  const borrar = () => { if (!sel) return; const prev = pRef.current; aplicar({ ...prev, elementos: prev.elementos.filter(e => e.id !== sel) }); setSel(null); setPanel("anadir"); };
  const usarPlantilla = (k) => {
    if (p?.elementos.length && !window.confirm("¿Empezar con esta plantilla? Se sustituye lo que hay dibujado (puedes deshacer).")) return;
    const pl = plantilla(k); aplicar(colocarReservados(pl, reservados)); setSel(null); setPanel("anadir");
  };
  // Usar en este evento un plano guardado en la cuenta: las mesas se enlazan por nombre con los
  // reservados del evento y se crean las que falten; los reservados que no estén se colocan aparte
  const cargarGuardado = async (x) => {
    if (pRef.current?.elementos.length && !window.confirm(`¿Usar «${x.nombre}» en este evento? Se sustituye el plano actual (puedes deshacer).`)) return;
    const creados = [];
    if (onCrearReservado) for (const e of mesasQueFaltan(x.plano, reservados)) {
      const r = await onCrearReservado({ nombre: e.ref, tamano: e.forma === "sofa" || e.w * e.h >= 4.5 ? "grande" : "pequeno" });
      if (r) creados.push(r);
    }
    const todos = [...reservados, ...creados];
    aplicar(colocarReservados(enlazar(x.plano, todos), todos));
    setSel(null); setPanel("anadir"); setVerPlanos(false);
  };
  const guardar = async () => { setGuardando(true); try { await onGuardar(normalizar(p)); cambiado.current = false; onCerrar(); } finally { setGuardando(false); } };
  const cerrar = () => { if (cambiado.current && !window.confirm("Tienes cambios sin guardar. ¿Salir igualmente?")) return; onCerrar(); };

  const editor = useMemo(() => ({
    onSeleccionar: (id) => { setSel(id); if (id) base.current = null; },
    onMover: (id, x, y) => { if (!base.current) { base.current = true; cambiarEl(id, (e, pl) => mover(e, x, y, pl)); } else cambiarEl(id, (e, pl) => mover(e, x, y, pl), false); },
    onTam: (id, w, h) => { if (!base.current) { base.current = true; cambiarEl(id, e => redimensionar(e, w, h)); } else cambiarEl(id, e => redimensionar(e, w, h), false); },
    onGiro: (id, g) => { if (!base.current) { base.current = true; cambiarEl(id, e => ({ ...e, rot: ((g % 360) + 360) % 360 })); } else cambiarEl(id, e => ({ ...e, rot: ((g % 360) + 360) % 360 }), false); },
    onFin: () => { base.current = null; },
  }), []);

  // ---------- Paneles ----------
  const PanelSala = () => (
    <div>
      <div style={K.lbl}>Medidas de la sala</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <label style={{ fontSize: 13, color: "var(--muted)" }}>Ancho (m)<MedidaInput valor={p.ancho} min={MIN_SALA} max={MAX_SALA} onCambio={v => aplicar({ ...p, ancho: v })} /></label>
        <label style={{ fontSize: 13, color: "var(--muted)" }}>Largo (m)<MedidaInput valor={p.largo} min={MIN_SALA} max={MAX_SALA} onCambio={v => aplicar({ ...p, largo: v })} /></label>
      </div>
      <div style={K.lbl}>Empezar con una plantilla</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8 }}>
        {[["sala", "🪩", "Sala / disco"], ["pueblo", "⛺", "Fiesta de pueblo"], ["festival", "🎪", "Festival"]].map(([k, i, t]) =>
          <button key={k} type="button" onClick={() => usarPlantilla(k)} style={K.pieza}><span style={{ fontSize: 22 }}>{i}</span>{t}</button>)}
      </div>
      {faltan.length > 0 && <button type="button" onClick={() => aplicar(colocarReservados(p, reservados))} style={{ ...K.btn, width: "100%", marginTop: 12, borderColor: "var(--accent)", color: "var(--accent)" }}>Colocar los {faltan.length} reservados que faltan</button>}
      {p.elementos.length > 0 && <button type="button" onClick={() => { if (window.confirm("¿Vaciar el plano? (puedes deshacer)")) { aplicar({ ...p, elementos: [] }); setSel(null); } }} style={{ ...K.btn, width: "100%", marginTop: 8, color: "var(--muted)" }}>Vaciar el plano</button>}
    </div>
  );
  const PanelAnadir = () => (
    <div>
      <div style={K.lbl}>Mesas VIP</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 8 }}>
        <button type="button" onClick={nuevaMesa} style={{ ...K.pieza, borderColor: "var(--accent)" }}><span style={{ fontSize: 22 }}>➕</span>Nueva mesa</button>
        {faltan.map(r => <button key={r.id} type="button" onClick={() => anadir("mesa", { reservadoId: r.id, ref: r.nombre, ...(r.tamano === "grande" ? { w: 2.6, h: 2, forma: "sofa" } : {}) })} style={K.pieza}><span style={{ fontSize: 20 }}>🛋️</span>Colocar {r.nombre}</button>)}
      </div>
      {GRUPOS_TIPOS.filter(g => g !== "Reservados").map(g => <div key={g}>
        <div style={K.lbl}>{g}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 8 }}>
          {Object.entries(TIPOS).filter(([, T]) => T.g === g).map(([k, T]) => <button key={k} type="button" onClick={() => anadir(k)} style={K.pieza}><span style={{ fontSize: 22 }}>{T.icono}</span>{T.t}</button>)}
        </div>
      </div>)}
    </div>
  );
  const PanelElemento = () => { const e = elegido; if (!e) return <div style={{ color: "var(--muted)", fontSize: 14, padding: "14px 0" }}>Toca algo del plano para cambiarlo.</div>; const T = TIPOS[e.tipo]; const r = (reservados || []).find(x => x.id === e.reservadoId); return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}><span style={{ fontSize: 24 }}>{T.icono}</span><b style={{ fontSize: 16, flex: 1 }}>{e.tipo === "mesa" ? (r ? r.nombre : "Mesa sin vincular") : (e.texto || T.t)}</b></div>
      {e.tipo === "mesa" ? <>
        <div style={K.lbl}>Reservado</div>
        <select value={e.reservadoId || ""} onChange={ev => { const v = ev.target.value; const rr = (reservados || []).find(y => y.id === v); cambiarEl(e.id, x => ({ ...x, reservadoId: v || undefined, ref: rr ? rr.nombre : undefined })); }} style={K.input}>
          <option value="">— Sin vincular —</option>
          {(reservados || []).map(x => <option key={x.id} value={x.id} disabled={x.id !== e.reservadoId && p.elementos.some(y => y.reservadoId === x.id)}>{x.nombre}{x.id !== e.reservadoId && p.elementos.some(y => y.reservadoId === x.id) ? " (ya está en el plano)" : ""}</option>)}
        </select>
        <div style={K.lbl}>Forma</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{Object.entries(FORMAS).map(([k, t]) => <button key={k} type="button" onClick={() => cambiarEl(e.id, x => ({ ...x, forma: k }))} style={{ ...K.btn, minHeight: 40, borderColor: e.forma === k ? "var(--accent)" : "var(--line)", color: e.forma === k ? "var(--accent)" : "var(--text)" }}>{t}</button>)}</div>
      </> : <>
        <div style={K.lbl}>Nombre en el plano</div>
        <input value={e.texto || ""} maxLength={40} placeholder={T.t} onChange={ev => cambiarEl(e.id, x => ({ ...x, texto: ev.target.value }), false)} style={K.input} />
      </>}
      <div style={K.lbl}>Tamaño (metros)</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <MedidaInput valor={e.w} min={0.25} max={MAX_SALA} onCambio={v => cambiarEl(e.id, x => redimensionar(x, v, x.h))} etiqueta="Ancho" />
        <MedidaInput valor={e.h} min={0.25} max={MAX_SALA} onCambio={v => cambiarEl(e.id, x => redimensionar(x, x.w, v))} etiqueta="Fondo" />
      </div>
      <div style={K.lbl}>Girar ({Math.round(e.rot || 0)}°)</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 6 }}>
        <button type="button" onClick={() => cambiarEl(e.id, x => girar(x, -15))} style={K.btn}>↺ 15°</button>
        <button type="button" onClick={() => cambiarEl(e.id, x => girar(x, 15))} style={K.btn}>↻ 15°</button>
        <button type="button" onClick={() => cambiarEl(e.id, x => girar(x, 90))} style={K.btn}>↻ 90°</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 14 }}>
        <button type="button" onClick={() => { const d = duplicar(e); aplicar({ ...p, elementos: [...p.elementos, d] }); setSel(d.id); }} style={K.btn}>⧉ Duplicar</button>
        <button type="button" onClick={borrar} style={{ ...K.btn, color: "var(--red)" }}>🗑 Quitar</button>
      </div>
      {e.tipo === "mesa" && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>Quitar la mesa del plano no borra el reservado ni sus reservas.</div>}
    </div>); };

  // ---------- Sin plano todavía: elegir cómo empezar ----------
  if (!p) return (<Capa><div style={{ position: "fixed", inset: 0, zIndex: 150, background: "rgba(0,0,0,.65)", display: "grid", placeItems: "center", padding: 12 }}>
    <div role="dialog" aria-modal="true" aria-label="Diseñar el plano" style={{ width: "100%", maxWidth: 560, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 20, padding: 18, boxSizing: "border-box" }}>
      <div style={{ fontWeight: 900, fontSize: 20 }}>🗺️ Diseña el plano de tu evento</div>
      <div style={{ color: "var(--muted)", fontSize: 14, marginTop: 4 }}>Elige cómo empezar. Luego podrás mover, girar y cambiar el tamaño de todo.</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 10, marginTop: 14 }}>
        {[["sala", "🪩", "Sala / discoteca", "Cabina, pista, barra y zona VIP"], ["pueblo", "⛺", "Fiesta de pueblo", "Carpa, escenario y barras"], ["festival", "🎪", "Festival", "Escenario, front stage y VIP"], ["vacio", "📐", "En blanco", "Solo las medidas de la sala"]].map(([k, i, t, sub]) =>
          <button key={k} type="button" onClick={() => { const pl = k === "vacio" ? normalizar({ ancho: 20, largo: 14, elementos: [] }) : plantilla(k); const nuevo = colocarReservados(pl, reservados); pRef.current = nuevo; setP(nuevo); cambiado.current = true; setPanel(k === "vacio" ? "sala" : "anadir"); }}
            style={{ ...K.pieza, minHeight: 110, alignItems: "flex-start", textAlign: "left", padding: 12, gap: 4 }}><span style={{ fontSize: 28 }}>{i}</span><b style={{ fontSize: 15 }}>{t}</b><span style={{ color: "var(--muted)", fontWeight: 600 }}>{sub}</span></button>)}
      </div>
      <button type="button" onClick={() => setVerPlanos(true)} style={{ ...K.btn, width: "100%", marginTop: 10, minHeight: 52, display: "flex", alignItems: "center", gap: 10, textAlign: "left" }}>
        <span style={{ fontSize: 24 }}>📚</span><span style={{ flex: 1 }}>Usar uno de Mis planos<br /><span style={{ fontWeight: 600, color: "var(--muted)", fontSize: 12.5 }}>Los que guardaste de otras salas o eventos</span></span><span aria-hidden>›</span></button>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>Tus reservados se colocan solos en el plano; luego los mueves a su sitio.</div>
      <button type="button" onClick={onCerrar} style={{ ...K.btn, width: "100%", marginTop: 12 }}>Cancelar</button>
    </div></div>
    {verPlanos && <MisPlanos planoActual={null} reservados={reservados} onCargar={cargarGuardado} onCerrar={() => setVerPlanos(false)} />}
  </Capa>);

  // Se llaman como funciones (no como componentes) para que los campos no pierdan el foco al escribir
  const panelActual = panel === "sala" ? PanelSala() : panel === "elemento" ? PanelElemento() : PanelAnadir();
  const pestanas = <div role="tablist" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 6 }}>
    {[["anadir", "➕ Añadir"], ["elemento", "✏️ Elemento"], ["sala", "📐 Sala"]].map(([k, t]) => <button key={k} role="tab" aria-selected={panel === k} type="button" onClick={() => setPanel(k)} style={{ ...K.btn, minHeight: 40, padding: 0, borderColor: panel === k ? "var(--accent)" : "var(--line)", color: panel === k ? "var(--accent)" : "var(--text)" }}>{t}</button>)}
  </div>;
  return (<Capa>
    <div style={{ position: "fixed", inset: 0, zIndex: 150, background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "calc(8px + env(safe-area-inset-top)) 12px 8px", borderBottom: "1px solid var(--line)", background: "var(--surface)", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 120 }}><div style={{ fontWeight: 900, fontSize: 16 }}>🗺️ Plano de la sala</div><div style={{ fontSize: 12, color: "var(--muted)" }}>{String(p.ancho).replace(".", ",")} × {String(p.largo).replace(".", ",")} m · {p.elementos.length} elementos</div></div>
        <button type="button" onClick={deshacer} disabled={!hist.atras.length} aria-label="Deshacer" style={{ ...K.btn, width: 44, padding: 0, opacity: hist.atras.length ? 1 : .4 }}>↶</button>
        <button type="button" onClick={rehacer} disabled={!hist.adelante.length} aria-label="Rehacer" style={{ ...K.btn, width: 44, padding: 0, opacity: hist.adelante.length ? 1 : .4 }}>↷</button>
        <button type="button" onClick={() => setVerPlanos(true)} aria-label="Mis planos" title="Guardar o cargar planos de tu cuenta" style={K.btn}>📚{isMobile ? "" : " Mis planos"}</button>
        <button type="button" onClick={cerrar} style={K.btn}>Cerrar</button>
        <button type="button" onClick={guardar} disabled={guardando} style={{ ...K.btn, background: "var(--accent)", border: "none", color: "#fff" }}>{guardando ? "Guardando…" : "Guardar"}</button>
      </header>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: isMobile ? "column" : "row" }}>
        <div style={{ flex: isMobile ? "0 0 52%" : 1, minHeight: 0, minWidth: 0, padding: 10, boxSizing: "border-box", display: "flex" }}>
          <div style={{ flex: 1, minHeight: 0, display: "flex" }}><Plano plano={p} mesas={mesas} modo="editar" seleccion={sel} editor={editor} altura="100%" /></div>
        </div>
        <aside data-scroll style={{ flex: isMobile ? 1 : "0 0 340px", minHeight: 0, overflow: "auto", overscrollBehavior: "contain", borderLeft: isMobile ? "none" : "1px solid var(--line)", borderTop: isMobile ? "1px solid var(--line)" : "none", background: "var(--surface)", padding: "10px 12px calc(16px + env(safe-area-inset-bottom))", boxSizing: "border-box" }}>
          {pestanas}
          {panelActual}
          {!isMobile && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 16, lineHeight: 1.5 }}>Atajos: flechas para mover (con Mayús, de metro en metro) · Supr para quitar · Ctrl+Z deshacer.</div>}
        </aside>
      </div>
    </div>
    {verPlanos && <MisPlanos planoActual={p} reservados={reservados} nombreSugerido={nombreSugerido} onCargar={cargarGuardado} onCerrar={() => setVerPlanos(false)} />}
  </Capa>);
}

// Número en metros que se aplica al salir del campo (no a cada tecla)
function MedidaInput({ valor, min, max, onCambio, etiqueta }) {
  const [t, setT] = useState(String(valor).replace(".", ","));
  useEffect(() => { setT(String(valor).replace(".", ",")); }, [valor]);
  const fijar = () => { const v = numero(t); if (v == null) { setT(String(valor).replace(".", ",")); return; } const x = Math.min(max, Math.max(min, ajustar(v))); if (x !== valor) onCambio(x); setT(String(x).replace(".", ",")); };
  return <input value={t} inputMode="decimal" aria-label={etiqueta} placeholder={etiqueta} onChange={e => setT(e.target.value.replace(/[^\d.,]/g, "").slice(0, 6))} onBlur={fijar} onKeyDown={e => e.key === "Enter" && e.currentTarget.blur()}
    style={{ ...K.input, marginTop: etiqueta ? 0 : 4 }} />;
}

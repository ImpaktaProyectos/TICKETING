// ===================== PLANO DE LA SALA · dibujo (SVG, a escala en metros) =====================
// Un solo componente para tres usos:
//   modo "ver"     → equipo: mesas con su estado y cliente; tocar una mesa abre su ficha
//   modo "editar"  → diseñador: arrastrar, girar y cambiar tamaño (lo controla EditorPlano)
//   modo "publico" → página de reservas: solo «Disponible» / «Reservada», sin datos de nadie
// Vista "2d" (plano) o "3d" (perspectiva con volumen).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { TIPOS, capa, normalizar, COLOR_ESTADO } from "./modelo";
import { RUTAS } from "../iconos";

// Icono propio dentro del plano (en metros): centrado en (x, y) con lado «s»
const IcoPlano = ({ n, x, y, s, color }) => RUTAS[n] ? <svg x={x - s / 2} y={y - s / 2} width={s} height={s} viewBox="0 0 24 24" overflow="visible" pointerEvents="none"><path d={RUTAS[n]} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg> : null;

const MARGEN = 1.4;   // metros alrededor de la sala para las cotas
const TEMA_APP = { suelo: "#14161d", fondo: "#0b0c10", pared: "#5b6274", linea: "rgba(255,255,255,.06)", texto: "#eceef5", muted: "#838aa0", acento: "#ff5a3c", libre: "#22d3a6", ocupada: "#5b6274" };
const ALTO_MESA = 0.75;
const altoDe = (e) => (e.tipo === "mesa" ? ALTO_MESA : TIPOS[e.tipo]?.alto || 0);
const corto = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

export function Plano({ plano: p0, mesas = {}, modo = "ver", vista = "2d", tema: tema0, seleccion = null, alTocar, editor = null, altura = null, zoomInicial = null }) {
  const plano = useMemo(() => normalizar(p0), [p0]);
  const tema = { ...TEMA_APP, ...(tema0 || {}) };
  const caja = useRef(null), svgRef = useRef(null);
  const [anchoCaja, setAnchoCaja] = useState(360);
  const [zoom, setZoom] = useState(zoomInicial || 1);
  useEffect(() => {
    const el = caja.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setAnchoCaja(Math.max(240, e.contentRect.width)));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const W = plano.ancho + MARGEN * 2, H = plano.largo + MARGEN * 2;
  const escala = (anchoCaja / W) * zoom;   // píxeles por metro
  const tresD = vista === "3d";
  const elementos = useMemo(() => [...plano.elementos].sort((a, b) => capa(a.tipo) - capa(b.tipo)), [plano.elementos]);

  // ---------- Editor: arrastrar, girar, cambiar tamaño ----------
  const arrastre = useRef(null);
  const aMetros = (ev) => {
    const svg = svgRef.current; if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const m = svg.getScreenCTM(); if (!m) return { x: 0, y: 0 };
    const q = pt.matrixTransform(m.inverse()); return { x: q.x, y: q.y };
  };
  const empezar = (ev, el, tipo) => {
    if (modo !== "editar" || !editor) return;
    ev.stopPropagation(); ev.preventDefault();
    try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch {}
    const m = aMetros(ev);
    arrastre.current = { tipo, id: el.id, x0: m.x, y0: m.y, el: { ...el }, movido: false };
    editor.onSeleccionar(el.id);
  };
  const mover = (ev) => {
    const a = arrastre.current; if (!a || !editor) return;
    const m = aMetros(ev);
    const dx = m.x - a.x0, dy = m.y - a.y0;
    if (!a.movido && Math.hypot(dx, dy) < 0.08) return;
    a.movido = true;
    if (a.tipo === "mover") editor.onMover(a.id, a.el.x + dx, a.el.y + dy);
    else if (a.tipo === "tam") {
      // Se mide en el sistema del elemento (girado)
      const r = (a.el.rot || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
      editor.onTam(a.id, a.el.w + dx * c + dy * s, a.el.h - dx * s + dy * c);
    } else if (a.tipo === "giro") {
      const cx = a.el.x + a.el.w / 2, cy = a.el.y + a.el.h / 2;
      let g = Math.atan2(m.y - cy, m.x - cx) * 180 / Math.PI + 90;
      g = Math.round(g / 15) * 15;   // de 15 en 15 grados
      editor.onGiro(a.id, g);
    }
  };
  const soltar = () => { if (arrastre.current?.movido) editor?.onFin?.(); arrastre.current = null; };

  const tocarMesa = (e) => { if (modo !== "editar" && alTocar) alTocar(e); };
  const fondoClic = () => { if (modo === "editar") editor?.onSeleccionar(null); };

  return (
    <div style={{ position: "relative", width: "100%", height: modo === "editar" ? altura || "auto" : undefined, borderRadius: 16, background: tema.fondo, overflow: "hidden" }}>
    <div ref={caja} style={{ width: "100%", height: modo === "editar" ? "100%" : undefined, maxHeight: modo === "editar" ? undefined : altura || undefined, overflow: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", touchAction: "pan-x pan-y" }}>
      <div style={{ perspective: tresD ? 1400 : undefined, padding: tresD ? `${Math.round(H * escala * 0.02)}px 0 ${Math.round(H * escala * 0.06) + 44}px` : "0 0 52px" }}>
        <svg ref={svgRef} role="img" aria-label="Plano de la sala" viewBox={`${-MARGEN} ${-MARGEN} ${W} ${H}`} width={W * escala} height={H * escala}
          onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar} onClick={fondoClic}
          style={{ display: "block", margin: "0 auto", userSelect: "none", WebkitUserSelect: "none", transformOrigin: "50% 50%", transition: "transform .5s cubic-bezier(.2,.8,.2,1)",
            transform: tresD ? "rotateX(50deg) rotateZ(-26deg) scale(.88)" : "none", fontFamily: "Inter, -apple-system, sans-serif" }}>
          <defs>
            <pattern id="pl-grid" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke={tema.linea} strokeWidth="0.03" /></pattern>
            <pattern id="pl-rayas" width="0.35" height="0.35" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="0.35" height="0.35" fill={tema.ocupada} opacity=".35" /><line x1="0" y1="0" x2="0" y2="0.35" stroke={tema.ocupada} strokeWidth="0.12" /></pattern>
            <pattern id="pl-pista" width="1" height="1" patternUnits="userSpaceOnUse"><rect width="0.5" height="0.5" fill="#3b82f6" opacity=".22" /><rect x="0.5" y="0.5" width="0.5" height="0.5" fill="#a855f7" opacity=".22" /></pattern>
            <pattern id="pl-escalon" width="0.32" height="0.32" patternUnits="userSpaceOnUse"><line x1="0" y1="0.02" x2="0.32" y2="0.02" stroke="#9aa1b4" strokeWidth="0.05" /></pattern>
            <filter id="pl-brillo" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="0.18" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          {/* Sala */}
          <rect x={0} y={0} width={plano.ancho} height={plano.largo} fill={tema.suelo} />
          <rect x={0} y={0} width={plano.ancho} height={plano.largo} fill="url(#pl-grid)" />
          <rect x={0} y={0} width={plano.ancho} height={plano.largo} fill="none" stroke={tema.pared} strokeWidth={0.18} />
          {/* Cotas */}
          <g fill={tema.muted} stroke={tema.muted} strokeWidth={0.03} fontSize={0.45} fontWeight={700}>
            <line x1={0} y1={-0.6} x2={plano.ancho} y2={-0.6} /><line x1={0} y1={-0.8} x2={0} y2={-0.4} /><line x1={plano.ancho} y1={-0.8} x2={plano.ancho} y2={-0.4} />
            <text x={plano.ancho / 2} y={-0.82} textAnchor="middle" stroke="none">{fmt(plano.ancho)} m</text>
            <line x1={-0.6} y1={0} x2={-0.6} y2={plano.largo} /><line x1={-0.8} y1={0} x2={-0.4} y2={0} /><line x1={-0.8} y1={plano.largo} x2={-0.4} y2={plano.largo} />
            <text x={-0.82} y={plano.largo / 2} textAnchor="middle" stroke="none" transform={`rotate(-90 ${-0.82} ${plano.largo / 2})`}>{fmt(plano.largo)} m</text>
          </g>
          {/* Volumen (3D): sombra extruida debajo de cada elemento con altura */}
          {tresD && elementos.map(e => { const a = altoDe(e); if (!a) return null; return (
            <g key={"s" + e.id} transform={`translate(${a * 0.32} ${a * 0.46}) rotate(${e.rot || 0} ${e.x + e.w / 2} ${e.y + e.h / 2})`} opacity={0.6}>
              <Forma e={e} relleno="#000" borde="none" />
            </g>); })}
          {elementos.map(e => {
            const sel = seleccion === e.id;
            const g = { transform: `rotate(${e.rot || 0} ${e.x + e.w / 2} ${e.y + e.h / 2})` };
            if (e.tipo === "mesa") return <Mesa key={e.id} e={e} g={g} info={mesas[e.reservadoId]} modo={modo} tema={tema} sel={sel} tresD={tresD}
              onPointerDown={(ev) => empezar(ev, e, "mover")} onClick={(ev) => { ev.stopPropagation(); tocarMesa(e); }} />;
            return <Elemento key={e.id} e={e} g={g} tema={tema} sel={sel} editable={modo === "editar"} onPointerDown={(ev) => empezar(ev, e, "mover")} onClick={(ev) => ev.stopPropagation()} />;
          })}
          {/* Tiradores del elemento elegido (editor) */}
          {modo === "editar" && seleccion && (() => { const e = plano.elementos.find(x => x.id === seleccion); if (!e) return null; const r = Math.max(0.28, 0.22 / zoom * 1.4); return (
            <g transform={`rotate(${e.rot || 0} ${e.x + e.w / 2} ${e.y + e.h / 2})`}>
              <rect x={e.x - 0.08} y={e.y - 0.08} width={e.w + 0.16} height={e.h + 0.16} fill="none" stroke={tema.acento} strokeWidth={0.06} strokeDasharray="0.2 0.12" pointerEvents="none" />
              <line x1={e.x + e.w / 2} y1={e.y - 0.08} x2={e.x + e.w / 2} y2={e.y - 0.9} stroke={tema.acento} strokeWidth={0.05} pointerEvents="none" />
              <circle cx={e.x + e.w / 2} cy={e.y - 0.9} r={r} fill={tema.acento} stroke="#fff" strokeWidth={0.05} style={{ cursor: "grab", touchAction: "none" }} onPointerDown={(ev) => empezar(ev, e, "giro")} />
              <rect x={e.x + e.w - r} y={e.y + e.h - r} width={r * 2} height={r * 2} rx={0.08} fill="#fff" stroke={tema.acento} strokeWidth={0.06} style={{ cursor: "nwse-resize", touchAction: "none" }} onPointerDown={(ev) => empezar(ev, e, "tam")} />
            </g>); })()}
        </svg>
      </div>
    </div>
      {zoomInicial !== false && <div style={{ position: "absolute", right: 0, bottom: 0, display: "flex", justifyContent: "flex-end", gap: 6, padding: 8, pointerEvents: "none" }}>
        {[["−", () => setZoom(z => Math.max(0.6, +(z - 0.25).toFixed(2)))], ["+", () => setZoom(z => Math.min(4, +(z + 0.25).toFixed(2)))], ["⤢", () => setZoom(1)]].map(([t, f]) =>
          <button key={t} type="button" onClick={f} aria-label={t === "+" ? "Acercar" : t === "−" ? "Alejar" : "Ver entero"} style={{ pointerEvents: "auto", width: 44, height: 44, borderRadius: 12, border: `1px solid ${tema.pared}`, background: "rgba(20,22,29,.85)", color: tema.texto, fontSize: 18, fontWeight: 800, cursor: "pointer", backdropFilter: "blur(6px)" }}>{t}</button>)}
      </div>}
    </div>
  );
}
const fmt = (v) => String(Math.round(v * 100) / 100).replace(".", ",");

// Silueta de cada elemento (también se usa para la sombra en 3D)
function Forma({ e, relleno, borde, grosor = 0.06, guiones }) {
  const { x, y, w, h } = e;
  if (e.tipo === "mesa" && e.forma === "redonda") return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill={relleno} stroke={borde} strokeWidth={grosor} strokeDasharray={guiones} />;
  if (e.tipo === "columna" || e.tipo === "arbol" || e.tipo === "altavoz") return e.tipo === "columna" ? <rect x={x} y={y} width={w} height={h} fill={relleno} stroke={borde} strokeWidth={grosor} /> : <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill={relleno} stroke={borde} strokeWidth={grosor} />;
  const rx = e.tipo === "mesa" ? (e.forma === "cuadrada" ? 0.25 : 0.4) : e.tipo === "pared" ? 0.04 : 0.22;
  return <rect x={x} y={y} width={w} height={h} rx={Math.min(rx, w / 2, h / 2)} fill={relleno} stroke={borde} strokeWidth={grosor} strokeDasharray={guiones} />;
}

function Mesa({ e, g, info, modo, tema, sel, tresD, onPointerDown, onClick }) {
  const publico = modo === "publico";
  const estado = info?.estado || "libre";
  const libre = publico ? info?.libre !== false : estado === "libre";
  const col = publico ? (libre ? tema.libre : tema.ocupada) : (COLOR_ESTADO[estado] || COLOR_ESTADO.libre);
  const elegida = sel && modo !== "editar";
  const nombre = info?.nombre || e.texto || "Mesa";
  const t = Math.max(0.34, Math.min(0.7, Math.min(e.w, e.h) * 0.36));
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  const sub = publico ? (libre ? (info?.personas ? `${info.personas} pers.` : "Disponible") : "Reservada")
    : modo === "editar" ? (info ? "" : "Sin vincular") : estado === "libre" ? "Libre" : corto(String(info?.cliente || "").split(" ")[0], 10) || (estado === "pendiente" ? "Pagando…" : "");
  const clicable = modo !== "editar" && (!publico || libre);
  return (
    <g {...g} onPointerDown={onPointerDown} onClick={onClick} style={{ cursor: modo === "editar" ? "move" : clicable ? "pointer" : "not-allowed", touchAction: modo === "editar" ? "none" : undefined }} role={clicable ? "button" : undefined} aria-label={`${nombre}: ${publico ? (libre ? "disponible" : "reservada") : estado}`}>
      {/* Zona táctil invisible: en el móvil la mesa se toca bien aunque el dibujo sea pequeño */}
      {modo !== "editar" && <rect x={e.x - 0.35} y={e.y - 0.35} width={e.w + 0.7} height={e.h + 0.7} fill="transparent" pointerEvents={clicable ? "all" : "none"} />}
      {e.forma === "sofa" && <path d={`M${e.x} ${e.y + e.h} V${e.y + 0.18} Q${e.x} ${e.y} ${e.x + 0.18} ${e.y} H${e.x + e.w - 0.18} Q${e.x + e.w} ${e.y} ${e.x + e.w} ${e.y + 0.18} V${e.y + e.h}`}
        fill="none" stroke={col} strokeWidth={0.32} strokeLinecap="round" opacity={0.9} />}
      <Forma e={e} relleno={publico && !libre ? "url(#pl-rayas)" : hexA(col, libre ? 0.16 : 0.38)} borde={elegida ? tema.acento : col} grosor={elegida ? 0.14 : 0.07} guiones={e.forma === "palco" ? "0.22 0.12" : undefined} />
      {elegida && <Forma e={e} relleno="none" borde={tema.acento} grosor={0.05} />}
      {publico && libre && !tresD && <circle cx={e.x + e.w - 0.2} cy={e.y + 0.2} r={0.14} fill={tema.libre} filter="url(#pl-brillo)" />}
      <g transform={`rotate(${-(e.rot || 0)} ${cx} ${cy})`} pointerEvents="none">
        <text x={cx} y={cy + (sub ? -t * 0.15 : t * 0.35)} textAnchor="middle" fontSize={t} fontWeight={900} fill={publico && !libre ? tema.muted : tema.texto}>{corto(nombre, 8)}</text>
        {sub && <text x={cx} y={cy + t * 0.95} textAnchor="middle" fontSize={t * 0.62} fontWeight={700} fill={publico ? (libre ? tema.libre : tema.muted) : col}>{sub}</text>}
      </g>
    </g>
  );
}

function Elemento({ e, g, tema, sel, editable, onPointerDown, onClick }) {
  const T = TIPOS[e.tipo];
  const col = T.color || tema.muted;
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  const etiqueta = e.texto || (e.tipo === "texto" ? "Texto" : T.t);
  const tam = Math.max(0.26, Math.min(0.7, Math.min(e.w, e.h) * 0.28, e.w / Math.max(4, etiqueta.length) * 1.5));
  const props = { onPointerDown, onClick, style: { cursor: editable ? "move" : "default", touchAction: editable ? "none" : undefined } };
  if (e.tipo === "texto") return <g {...g} {...props}><rect x={e.x} y={e.y} width={e.w} height={e.h} fill="transparent" stroke={sel ? tema.acento : "none"} strokeWidth={0.04} /><text x={cx} y={cy + tam * 0.36} textAnchor="middle" fontSize={Math.min(e.h * 0.7, tam * 1.4)} fontWeight={900} fill={tema.texto} pointerEvents="none">{etiqueta}</text></g>;
  const relleno = e.tipo === "pista" ? "url(#pl-pista)" : e.tipo === "escalera" ? "url(#pl-escalon)" : e.tipo === "pared" || e.tipo === "columna" ? col
    : e.tipo === "carpa" || e.tipo === "zona" ? hexA(col, 0.06) : hexA(col, 0.2);
  const guiones = e.tipo === "carpa" ? "0.6 0.3" : e.tipo === "zona" ? "0.3 0.2" : undefined;
  const grande = e.tipo === "carpa" || e.tipo === "zona" || e.tipo === "pista";
  return (
    <g {...g} {...props}>
      <Forma e={e} relleno={relleno} borde={e.tipo === "pared" || e.tipo === "columna" ? "none" : col} grosor={e.tipo === "carpa" ? 0.12 : 0.06} guiones={guiones} />
      {e.tipo === "salida" && <rect x={e.x} y={e.y} width={e.w} height={e.h} fill="#22d3a6" opacity={0.75} />}
      {e.tipo !== "pared" && e.tipo !== "columna" && <g transform={`rotate(${-(e.rot || 0)} ${cx} ${cy})`} pointerEvents="none">
        {grande
          ? (e.tipo === "pista"
            ? <><IcoPlano n={T.icono} x={cx} y={cy - tam * 0.9} s={tam * 1.7} color={col} />
                <text x={cx} y={cy + tam * 1.05} textAnchor="middle" fontSize={tam * 1.25} fontWeight={900} fill={col} opacity={0.95}>{etiqueta}</text></>
            : <><IcoPlano n={T.icono} x={e.x + 0.35 + tam * 0.5} y={e.y + 0.25 + tam * 0.62} s={tam * 1.05} color={col} />
                <text x={e.x + 0.45 + tam * 1.15} y={e.y + tam + 0.25} textAnchor="start" fontSize={tam} fontWeight={900} fill={col} opacity={0.95}>{etiqueta}</text></>)
          : Math.min(e.w, e.h) >= 0.9 || e.w >= 2.2
            ? (e.h >= 1.2
              ? <><IcoPlano n={T.icono} x={cx} y={cy - tam * 0.6} s={tam * 1.25} color={col} />
                  <text x={cx} y={cy + tam * 1.05} textAnchor="middle" fontSize={tam * 0.8} fontWeight={800} fill={tema.texto}>{etiqueta}</text></>
              : <><IcoPlano n={T.icono} x={cx - etiqueta.length * tam * 0.24 - tam * 0.45} y={cy} s={tam * 0.85} color={col} />
                  <text x={cx + tam * 0.3} y={cy + tam * 0.3} textAnchor="middle" fontSize={tam * 0.8} fontWeight={800} fill={tema.texto}>{etiqueta}</text></>)
            : <IcoPlano n={T.icono} x={cx} y={cy} s={tam * 1.1} color={col} />}
      </g>}
      {sel && <Forma e={e} relleno="none" borde={tema.acento} grosor={0.05} />}
    </g>
  );
}

// Color con transparencia (acepta #rgb o #rrggbb)
export function hexA(hex, a) {
  const h = String(hex || "#888").replace("#", "");
  const f = h.length === 3 ? h.split("").map(c => c + c).join("") : h.padEnd(6, "0");
  const n = parseInt(f.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

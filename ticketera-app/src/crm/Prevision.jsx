// ===================== PREVISIÓN =====================
// ¿Cuántas entradas necesito para no perder? ¿Cuánto gano si vendo X?
// Dos entornos por evento: Ficticio (todo simulado) y Real (ventas de la ticketera o apuntadas a mano + gastos reales).
// Todo se guarda solo en la previsión del evento (nunca en Ingresos).
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as crm from "./crmdb";
import { money, r2, useIsMobile, C, Icon, Tile, Badge, Seg, Sheet, Field, Seccion } from "./ui";
import { catInfo } from "./categorias";
import { esTicketera, importe } from "./fiscal";
import * as P from "./prevision";

const uidL = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
const nfmt = (n) => (n == null ? "—" : Number(n).toLocaleString("es-ES"));
const num = (v) => { const x = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(x) ? x : 0; };
const limpioNum = (v, dec = true) => String(v ?? "").replace(dec ? /[^\d.,]/g : /[^\d]/g, "").slice(0, 9);
const ESC_COL = { pesimista: "var(--red)", normal: "var(--blue)", optimista: "var(--green)" };

function nuevaPrevision(ev, ajustes, hayTicketera) {
  const def = ajustes?.prevision || {};
  return {
    modo: hayTicketera ? "real" : "ficticio",
    cfg: P.cfgCon(def.cfg),
    escenarios: (def.escenarios || P.ESC_DEF).map(e => ({ ...e })),
    ficticio: { tramos: P.TRAMOS_PLANTILLA.map(t => ({ ...t, id: uidL(), vendidas: "" })), gastos: [] },
    real: { tramos: [], excluir: null },
  };
}

export function Prevision({ ev, events, ingresos, gastos, G, F, ajustes, vinculo, conexion, sincronizando, onSync, onIrGastos, onGuardarDefecto, flash }) {
  const isMobile = useIsMobile();
  const [d, setD] = useState(null);               // datos de la previsión del evento
  const [estado, setEstado] = useState("");      // "" | guardando | guardado | error
  const [cfgAbierta, setCfgAbierta] = useState(false);
  const [copiar, setCopiar] = useState(false);
  const [simular, setSimular] = useState(null);  // entradas totales del simulador
  const timer = useRef(null);
  const hayTicketera = ingresos.some(i => esTicketera(i) && i.unidades);

  // ---- Cargar (y crear la primera vez) ----
  useEffect(() => {
    let vivo = true; setD(null); setSimular(null);
    crm.loadPrevision(ev.id).then(r => { if (!vivo) return; const x = r?.datos && r.datos.cfg ? r.datos : nuevaPrevision(ev, ajustes, hayTicketera); setD({ ...nuevaPrevision(ev, ajustes, hayTicketera), ...x, cfg: P.cfgCon(x.cfg) }); })
      .catch(() => { if (vivo) { setD(nuevaPrevision(ev, ajustes, hayTicketera)); setEstado("error"); } });
    return () => { vivo = false; clearTimeout(timer.current); };
  }, [ev.id]);

  // ---- Guardado automático (al dejar de escribir) ----
  const cambiar = (fn) => setD(prev => {
    const next = typeof fn === "function" ? fn(prev) : { ...prev, ...fn };
    clearTimeout(timer.current); setEstado("guardando");
    timer.current = setTimeout(() => { crm.savePrevision(ev.id, next).then(() => setEstado("guardado")).catch(() => { setEstado("error"); flash(navigator.onLine ? "No se ha podido guardar la previsión" : "Sin conexión: la previsión no se ha guardado", "warn"); }); }, 700);
    return next;
  });

  // ---- Datos del modo Real ----
  // Ventas de la ticketera (o CSV) agrupadas por tarifa → un tramo cada una
  const tarifas = useMemo(() => {
    const m = {};
    ingresos.filter(i => esTicketera(i) && (i.unidades || i.importe)).forEach(i => {
      const k = i.concepto || i.categoria; const x = m[k] = m[k] || { ref: k, nombre: k.replace(/^(Fourvenues|TIXFAST) · /, ""), unidades: 0, importe: 0 };
      x.unidades += Number(i.unidades) || 0; x.importe = r2(x.importe + i.importe);
    });
    return Object.values(m);
  }, [ingresos]);
  const tramosReal = useMemo(() => {
    if (!d) return [];
    const guard = d.real.tramos || [];
    const deTicketera = tarifas.map(t => {
      const g = guard.find(x => x.ref === t.ref) || {};
      return { id: g.id || "tk:" + t.ref, ref: t.ref, nombre: g.nombre || t.nombre, precio: g.precio ?? (t.unidades ? r2(t.importe / t.unidades) : ""), cupo: g.cupo ?? "", copas: g.copas ?? 0, vendidas: t.unidades, importeReal: t.importe, ticketera: true };
    });
    const manuales = guard.filter(x => !x.ref);
    return [...deTicketera, ...manuales];
  }, [d, tarifas]);

  // Otros ingresos ya apuntados (patrocinios…): por categoría, se pueden quitar. Las de entradas, quitadas de serie.
  const otrosCats = useMemo(() => {
    const m = {};
    ingresos.filter(i => !esTicketera(i)).forEach(i => { m[i.categoria] = r2((m[i.categoria] || 0) + i.importe); });
    return Object.entries(m).map(([k, v]) => ({ k, v, entradas: catInfo(k).g === "entradas" }));
  }, [ingresos]);
  const excluidas = d?.real?.excluir ?? otrosCats.filter(c => c.entradas).map(c => c.k);
  const otrosReal = r2(otrosCats.filter(c => !excluidas.includes(c.k)).reduce((t, c) => t + c.v, 0));
  // Gastos reales: lo apuntado en Gastos + caja + comisiones que no son de la ticketera (esa se calcula aquí por entrada)
  const comOtras = r2((F?.comisiones || []).filter(l => l.k !== "ticketera").reduce((t, l) => t + l.importe, 0));
  const gastosReal = r2((G?.total || 0) - (G?.autoTotal || 0) + comOtras);

  // ---- Cálculo ----
  const real = d?.modo === "real";
  const calc = useMemo(() => {
    if (!d) return null;
    const cfg = P.cfgCon(d.cfg), fis = P.fiscalDe(ajustes, cfg);
    const tramos = real ? tramosReal : d.ficticio.tramos;
    const T = P.prepararTramos(tramos, cfg, fis, { conBase: real });
    const gastosTot = real ? gastosReal : r2((d.ficticio.gastos || []).reduce((t, g) => t + num(g.importe), 0));
    const Fx = P.fijo({ cfg, fis, gastos: gastosTot, otros: real ? otrosReal : 0 });
    const eq = P.equilibrio(T, cfg, Fx);
    const base = T.reduce((s, t) => s + t.base, 0);
    const max = P.maxEntradas(T, cfg, eq);
    const cap = P.capacidad(T, cfg);
    const res = (total) => P.resultado(T, cfg, Fx, Math.max(0, total - base));
    const plan = real ? null : P.resultado(T, cfg, Fx, d.ficticio.tramos.reduce((s, t) => s + Math.floor(num(t.vendidas)), 0));
    const media = T.length ? r2(T.reduce((s, t) => s + t.d.deja, 0) / T.length) : 0;
    return { cfg, fis, T, Fx, eq, base, max, cap, res, plan, media, gastosTot, barra: P.barraPorPersona(cfg, fis) };
  }, [d, real, tramosReal, gastosReal, otrosReal, ajustes]);

  if (!d || !calc) return <div style={{ ...C.panel, color: "var(--muted)", textAlign: "center" }}>Cargando la previsión…</div>;
  const { T, eq, base, max, cap, res, Fx } = calc;
  const totalEq = eq.faltan == null ? null : base + eq.faltan;
  const simN = Math.min(max, Math.max(base, simular ?? (real ? Math.max(base, totalEq || base) : (calc.plan?.nuevas || totalEq || Math.round(max / 2)))));
  const sim = res(simN);

  // ---- Edición de tramos ----
  const setTramo = (id, patch) => cambiar(prev => {
    if (!real) return { ...prev, ficticio: { ...prev.ficticio, tramos: prev.ficticio.tramos.map(t => t.id === id ? { ...t, ...patch } : t) } };
    const lista = [...(prev.real.tramos || [])];
    const tr = tramosReal.find(t => t.id === id);
    const i = lista.findIndex(x => x.id === id || (tr?.ref && x.ref === tr.ref));
    const fila = { ...(i >= 0 ? lista[i] : { id: tr?.ticketera ? uidL() : id, ref: tr?.ref }), ...patch };
    if (i >= 0) lista[i] = fila; else lista.push(fila);
    return { ...prev, real: { ...prev.real, tramos: lista } };
  });
  const addTramo = () => cambiar(prev => real
    ? { ...prev, real: { ...prev.real, tramos: [...(prev.real.tramos || []), { id: uidL(), nombre: `Tramo ${tramosReal.length + 1}`, precio: "", cupo: "", copas: 0, vendidas: "" }] } }
    : { ...prev, ficticio: { ...prev.ficticio, tramos: [...prev.ficticio.tramos, { id: uidL(), nombre: `Tramo ${prev.ficticio.tramos.length + 1}`, precio: "", cupo: "", copas: 0, vendidas: "" }] } });
  const delTramo = (id) => cambiar(prev => real
    ? { ...prev, real: { ...prev.real, tramos: (prev.real.tramos || []).filter(t => t.id !== id) } }
    : { ...prev, ficticio: { ...prev.ficticio, tramos: prev.ficticio.tramos.filter(t => t.id !== id) } });
  const moverTramo = (id, dir) => cambiar(prev => {
    const key = real ? "real" : "ficticio"; const l = [...(prev[key].tramos || [])]; const i = l.findIndex(t => t.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= l.length) return prev; [l[i], l[j]] = [l[j], l[i]]; return { ...prev, [key]: { ...prev[key], tramos: l } };
  });
  const tramosVista = real ? tramosReal : d.ficticio.tramos;

  // ---- Gastos simulados ----
  const setGastos = (fn) => cambiar(prev => ({ ...prev, ficticio: { ...prev.ficticio, gastos: fn(prev.ficticio.gastos || []) } }));
  const traerGastos = () => {
    const lista = gastos.filter(g => !g.padreId || true).map(g => ({ id: uidL(), concepto: g.concepto || g.categoria, importe: String(importe(g)) })).filter(g => num(g.importe) > 0);
    if (!lista.length) { flash("Este evento aún no tiene gastos apuntados", "warn"); return; }
    setGastos(() => lista); flash(`${lista.length} gastos traídos de la pestaña Gastos`);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ===== Entorno + acciones ===== */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ flex: isMobile ? "1 1 100%" : "0 0 auto" }}>
          <Seg full={isMobile} valor={d.modo} onChange={(m) => { cambiar({ modo: m }); setSimular(null); }}
            opciones={[{ k: "ficticio", t: "Ficticio", i: "sparkle" }, { k: "real", t: "Real", i: "check" }]} />
        </div>
        <span style={{ fontSize: 12.5, color: "var(--muted)", flex: 1, minWidth: 160 }}>
          {real ? (hayTicketera ? "Ventas de la ticketera + las que apuntes aquí, y los gastos de la pestaña Gastos." : "Apunta aquí las entradas vendidas. Los gastos son los de la pestaña Gastos.") : "Todo simulado: tramos, ventas y gastos. No toca nada real."}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: estado === "error" ? "var(--red)" : "var(--muted)", display: "inline-flex", alignItems: "center", gap: 4 }}>
          {estado === "guardando" ? "Guardando…" : estado === "guardado" ? <><Icon n="check" s={13} w={2.6} />Guardado</> : estado === "error" ? "Sin guardar" : ""}
        </span>
        <button onClick={() => setCopiar(true)} style={C.btnSm}><Icon n="copy" s={14} />Copiar de otro evento</button>
        <button onClick={() => setCfgAbierta(true)} style={C.btnSm}><Icon n="gear" s={14} />Configuración</button>
      </div>

      {/* ===== Respuesta principal ===== */}
      <section style={{ ...C.hero, padding: isMobile ? 16 : 22 }}>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1.25fr 1fr", gap: isMobile ? 14 : 28, alignItems: "center" }}>
          <div>
            {!real && calc.gastosTot === 0 ? (<>
              <div style={C.label}>Empieza por los gastos</div>
              <div style={{ fontSize: isMobile ? 28 : 36, fontWeight: 900, lineHeight: 1.1, marginTop: 4 }}>¿Cuánto vas a gastar?</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6, marginBottom: 12 }}>Pon los gastos simulados más abajo (o tráelos de la pestaña Gastos) y te digo cuántas entradas necesitas para no perder.</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={traerGastos} style={C.btnPrimary}><Icon n="copy" s={16} />Traer de Gastos</button>
                <button onClick={() => { setGastos(l => [...l, { id: uidL(), concepto: "", importe: "" }]); setTimeout(() => document.querySelector('[aria-label="Concepto del gasto"]')?.focus(), 150); }} style={C.btnGhost}><Icon n="plus" s={16} />Añadir un gasto</button>
              </div>
            </>) : eq.yaCubierto ? (<>
              <div style={C.label}>{real ? "Ya cubres los gastos" : "Sin vender nada"}</div>
              <div style={{ fontSize: isMobile ? 34 : 46, fontWeight: 900, lineHeight: 1.05, color: "var(--green)", marginTop: 4 }}>{real ? `Ganas ${money(res(base).total)}` : "No pierdes dinero"}</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>{real ? `Con las ${nfmt(base)} entradas vendidas. Cada entrada más suma de media ${money(calc.media)}.` : "Los ingresos fijos ya cubren los gastos."}</div>
            </>) : eq.faltan == null ? (<>
              <div style={C.label}>Punto de equilibrio</div>
              <div style={{ fontSize: isMobile ? 30 : 40, fontWeight: 900, lineHeight: 1.1, color: "var(--red)", marginTop: 4 }}>No llegas ni llenando</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>Vendiendo todo ({nfmt(cap === Infinity ? null : cap)} entradas) seguirías perdiendo {money(Math.abs(res(cap === Infinity ? max : cap).total))}. Sube precios, baja gastos o amplía el aforo.</div>
            </>) : (<>
              <div style={C.label}>{real ? "Para no perder te faltan" : "Para no perder necesitas vender"}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
                <span style={{ fontSize: isMobile ? 46 : 62, fontWeight: 900, letterSpacing: "-.03em", lineHeight: 1 }}>{nfmt(real ? eq.faltan : totalEq)}</span>
                <span style={{ fontSize: isMobile ? 18 : 22, fontWeight: 800, color: "var(--muted)" }}>{real ? "entradas más" : "entradas"}</span>
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>
                {real ? <>Llevas {nfmt(base)} vendidas y vas en <b style={{ color: "var(--text)" }}>{money(res(base).total)}</b>. Necesitas llegar a {nfmt(totalEq)} entradas{eq.tramo ? <> (siguiente tramo: <b style={{ color: "var(--text)" }}>{eq.tramo}</b>, deja {money(eq.deja)} cada una)</> : null}.</>
                  : <>Con {money(calc.gastosTot)} de gastos{Fx.invitaciones ? ` y ${money(Fx.invitaciones)} de las invitaciones` : ""}. Cada entrada te deja de media {money(calc.media)}.</>}
              </div>
            </>)}
          </div>
          <div>
            {real && !eq.yaCubierto && totalEq != null && totalEq > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}><span>Vendidas {nfmt(base)}</span><span style={{ color: "var(--muted)" }}>Equilibrio {nfmt(totalEq)}</span></div>
                <div style={{ height: 12, borderRadius: 8, background: "var(--surface2)", overflow: "hidden" }}><div style={{ width: `${Math.min(100, base / totalEq * 100)}%`, height: "100%", borderRadius: 8, background: base >= totalEq ? "var(--green)" : "linear-gradient(90deg,#ff5a3c,#ff8a3c)" }} /></div>
              </div>
            )}
            {!real && calc.plan && calc.plan.nuevas > 0 && (
              <div style={{ ...C.card, boxShadow: "none" }}>
                <div style={C.label}>Con las ventas que has puesto ({nfmt(calc.plan.nuevas)})</div>
                <div style={{ fontSize: 26, fontWeight: 900, color: calc.plan.total >= 0 ? "var(--green)" : "var(--red)" }}>{calc.plan.total >= 0 ? "Ganas " : "Pierdes "}{money(Math.abs(calc.plan.total))}</div>
              </div>
            )}
            <Desglose T={T} calc={calc} />
          </div>
        </div>
      </section>

      {/* ===== ¿Y si vendo…? ===== */}
      <section style={{ ...C.panel, padding: isMobile ? 16 : 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <Tile n="trend" s={34} />
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 900, fontSize: 16.5 }}>¿Y si vendo…?</div><div style={{ fontSize: 12.5, color: "var(--muted)" }}>Mueve la barra o escribe las entradas{real ? " (en total, contando las ya vendidas)" : ""}</div></div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <input type="range" min={real ? base : 0} max={max} step={1} value={simN} onChange={e => setSimular(+e.target.value)} aria-label="Entradas vendidas" style={{ flex: "1 1 220px", accentColor: "#ff5a3c", height: 28 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input inputMode="numeric" value={simN} onChange={e => setSimular(Math.floor(num(limpioNum(e.target.value, false))))} aria-label="Entradas" style={{ ...C.input, width: 100, textAlign: "center", fontSize: 20, fontWeight: 900, padding: "8px" }} />
            <span style={{ fontWeight: 800, color: "var(--muted)" }}>entradas</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
          <span style={{ fontSize: isMobile ? 34 : 42, fontWeight: 900, letterSpacing: "-.02em", color: sim.total >= 0 ? "var(--green)" : "var(--red)" }}>{sim.total >= 0 ? "Ganas " : "Pierdes "}{money(Math.abs(sim.total))}</span>
          {cap !== Infinity && <span style={{ fontSize: 13, color: "var(--muted)" }}>{Math.round(simN / cap * 100)} % del aforo</span>}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {T.map((t, k) => { const n = t.base + sim.reparto[k]; return n > 0 ? <span key={t.id} style={C.tag}>{t.nombre}: <b>{nfmt(n)}</b></span> : null; })}
          {simN >= max && cap !== Infinity && <span style={{ ...C.tag, color: "var(--amber)" }}>Aforo completo</span>}
        </div>
        <Grafico calc={calc} simN={simN} totalEq={totalEq} escenarios={d.escenarios} real={real} isMobile={isMobile} />
      </section>

      {/* ===== Escenarios ===== */}
      <Seccion id="prev-escenarios" i="chart" t="Escenarios" sub="Pesimista, normal y optimista. Ponlos en % del aforo o en número de entradas.">
        {cap === Infinity && d.escenarios.some(e => e.modo === "pct") && <div style={{ fontSize: 12.5, color: "var(--amber)", fontWeight: 700, marginBottom: 10 }}>Para usar % del aforo, pon el aforo en Configuración o un cupo en cada tramo.</div>}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3,minmax(0,1fr))", gap: 10 }}>
          {d.escenarios.map((e, i) => {
            const n = P.entradasEscenario(e, T, calc.cfg); const tot = n == null ? null : Math.min(max, Math.max(base, n)); const r = tot == null ? null : res(tot);
            const set = (patch) => cambiar(prev => ({ ...prev, escenarios: prev.escenarios.map((x, j) => j === i ? { ...x, ...patch } : x) }));
            return (
              <div key={e.k} style={{ ...C.card, borderTop: `3px solid ${ESC_COL[e.k] || "var(--accent)"}`, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <b style={{ fontSize: 16 }}>{e.t}</b>
                  <Seg size="sm" valor={e.modo} onChange={(m) => set({ modo: m, valor: m === "pct" ? (cap === Infinity ? 75 : Math.round((tot || 0) / cap * 100) || 75) : (tot || 0) })} opciones={[{ k: "pct", t: "% aforo" }, { k: "num", t: "Nº" }]} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input inputMode="numeric" value={e.valor} onChange={ev2 => set({ valor: limpioNum(ev2.target.value, false) })} aria-label={`${e.t}: ${e.modo === "pct" ? "porcentaje" : "entradas"}`} style={{ ...C.input, width: 90, textAlign: "center", fontWeight: 900, fontSize: 18, padding: "8px" }} />
                  <span style={{ fontWeight: 800, color: "var(--muted)" }}>{e.modo === "pct" ? "% del aforo" : "entradas"}</span>
                </div>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>{tot == null ? "Sin aforo definido" : e.modo === "pct" ? `${nfmt(tot)} entradas` : cap !== Infinity ? `${Math.round(tot / cap * 100)} % del aforo` : ""}</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: r == null ? "var(--muted)" : r.total >= 0 ? "var(--green)" : "var(--red)" }}>{r == null ? "—" : `${r.total >= 0 ? "+" : "−"}${money(Math.abs(r.total))}`}</div>
                {tot != null && <button onClick={() => setSimular(tot)} style={{ ...C.btnSm, alignSelf: "flex-start" }}><Icon n="trend" s={14} />Ver en el simulador</button>}
              </div>);
          })}
        </div>
      </Seccion>

      {/* ===== Tramos de entradas ===== */}
      <Seccion id="prev-tramos" i="ticket" t="Entradas por tramos" sub={real ? "Las de la ticketera se actualizan solas; las demás, apúntalas aquí y quedan guardadas." : "Se venden en este orden: cuando se acaba el cupo de un tramo, empieza el siguiente."}
        total={`${nfmt(tramosVista.reduce((s, t) => s + Math.floor(num(t.vendidas)), 0))} vendidas`}
        acciones={<button onClick={addTramo} style={C.btnPrimary}><Icon n="plus" s={16} w={2.4} />Añadir tramo</button>}>
        {real && vinculo && conexion && <div style={{ marginBottom: 10 }}><button disabled={sincronizando} onClick={onSync} style={{ ...C.btnSm, opacity: sincronizando ? .6 : 1 }}><Icon n="refresh" s={14} />{sincronizando ? "Actualizando…" : "Actualizar ventas de Fourvenues"}</button></div>}
        {tramosVista.length === 0 && <div style={C.empty}>Aún no hay tramos. {!real && <button onClick={() => cambiar(prev => ({ ...prev, ficticio: { ...prev.ficticio, tramos: P.TRAMOS_PLANTILLA.map(t => ({ ...t, id: uidL(), vendidas: "" })) } }))} style={{ ...C.btnSm, marginLeft: 6 }}>Usar plantilla</button>}</div>}
        {tramosVista.map((t, i) => <TramoFila key={t.id} t={t} i={i} n={tramosVista.length} real={real} prep={T[i]} isMobile={isMobile}
          onChange={(patch) => setTramo(t.id, patch)} onDel={() => delTramo(t.id)} onMove={(dir) => moverTramo(t.id, dir)} />)}
      </Seccion>

      {/* ===== Gastos ===== */}
      {real ? (
        <Seccion id="prev-gastos-real" i="receipt" t="Gastos del evento" sub="Los de la pestaña Gastos (con su importe real o, si no lo tiene, el previsto) y lo sacado de caja." total={money(gastosReal)}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={C.tag}>Apuntados {money(r2((G?.total || 0) - (G?.autoTotal || 0) - (G?.cajaTotal || 0)))}</span>
            {G?.cajaTotal > 0 && <span style={C.tag}>Caja del TPV {money(G.cajaTotal)}</span>}
            {comOtras > 0 && <span style={C.tag}>Comisiones de cobro {money(comOtras)}</span>}
            <button onClick={onIrGastos} style={C.btnSm}><Icon n="right" s={14} />Ir a Gastos</button>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>La comisión de la ticketera y el IVA de las entradas se descuentan aquí, entrada a entrada.</div>
        </Seccion>
      ) : (
        <Seccion id="prev-gastos" i="receipt" t="Gastos simulados" sub="Pon lo que prevés gastar. No se apunta en Gastos." total={money(calc.gastosTot)}
          acciones={<span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><button onClick={traerGastos} style={C.btnSm}><Icon n="copy" s={14} />Traer de Gastos</button><button onClick={() => setGastos(l => [...l, { id: uidL(), concepto: "", importe: "" }])} style={C.btnPrimary}><Icon n="plus" s={16} w={2.4} />Añadir gasto</button></span>}>
          {(d.ficticio.gastos || []).length === 0 && <div style={C.empty}>Añade los gastos que prevés (DJ, sonido, seguridad, local…) o tráelos de la pestaña Gastos.</div>}
          {(d.ficticio.gastos || []).map(g => (
            <div key={g.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderTop: "1px solid var(--line)" }}>
              <input value={g.concepto} placeholder="Concepto (ej. DJ)" aria-label="Concepto del gasto" onChange={e => setGastos(l => l.map(x => x.id === g.id ? { ...x, concepto: e.target.value.slice(0, 80) } : x))} style={{ ...C.input, flex: 1, minWidth: 0 }} />
              <div style={{ position: "relative", width: isMobile ? 120 : 150, flexShrink: 0 }}>
                <input inputMode="decimal" value={g.importe} placeholder="0" aria-label="Importe del gasto" onChange={e => setGastos(l => l.map(x => x.id === g.id ? { ...x, importe: limpioNum(e.target.value) } : x))} style={{ ...C.input, textAlign: "right", paddingRight: 30, fontWeight: 800 }} />
                <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontWeight: 800 }}>€</span>
              </div>
              <button onClick={() => setGastos(l => l.filter(x => x.id !== g.id))} aria-label="Quitar gasto" style={{ ...C.btnSm, padding: 8 }}><Icon n="x" s={15} /></button>
            </div>))}
        </Seccion>
      )}

      {/* ===== Otros ingresos (solo real) ===== */}
      {real && otrosCats.length > 0 && (
        <Seccion id="prev-otros" i="wallet" t="Otros ingresos ya apuntados" sub="De la pestaña Ingresos. Quita lo que no quieras contar (las entradas apuntadas allí vienen quitadas para no contarlas dos veces)." total={money(otrosReal)}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {otrosCats.map(c => { const on = !excluidas.includes(c.k); return (
              <button key={c.k} onClick={() => cambiar(prev => ({ ...prev, real: { ...prev.real, excluir: on ? [...excluidas, c.k] : excluidas.filter(x => x !== c.k) } }))} aria-pressed={on}
                style={{ ...C.btnSm, ...(on ? { background: "color-mix(in srgb, var(--green) 14%, var(--surface2))", borderColor: "var(--green)" } : { opacity: .6, textDecoration: "line-through" }) }}>
                <Icon n={on ? "check" : "x"} s={14} />{c.k} · {money(c.v)}</button>); })}
          </div>
        </Seccion>
      )}

      {cfgAbierta && <Configuracion cfg={d.cfg} fis={calc.fis} ajustes={ajustes} events={events} ev={ev} escenarios={d.escenarios}
        onClose={() => setCfgAbierta(false)}
        onSave={async (cfg, defecto) => { cambiar({ cfg }); setCfgAbierta(false); if (defecto) { try { await onGuardarDefecto({ cfg, escenarios: d.escenarios }); } catch {} } flash("Configuración guardada"); }} />}
      {copiar && <CopiarDe events={events.filter(e => e.id !== ev.id)} onClose={() => setCopiar(false)}
        onCopiar={async (e) => {
          try {
            const r = await crm.loadPrevision(e.id);
            if (!r?.datos?.cfg) { flash(`«${e.name}» aún no tiene previsión`, "warn"); return; }
            const o = r.datos;
            cambiar(prev => ({ ...prev, cfg: P.cfgCon(o.cfg), escenarios: o.escenarios || prev.escenarios,
              ficticio: { tramos: (o.ficticio?.tramos || []).map(t => ({ ...t, id: uidL(), vendidas: "" })), gastos: (o.ficticio?.gastos || []).map(g => ({ ...g, id: uidL() })) },
              real: { ...prev.real, tramos: (o.real?.tramos || []).filter(t => !t.ref).map(t => ({ ...t, id: uidL(), vendidas: "" })) } }));
            setCopiar(false); flash(`Previsión copiada de «${e.name}» (sin ventas)`);
          } catch { flash("No se ha podido copiar", "warn"); }
        }} />}
    </div>
  );
}

/* ---------- Qué deja cada entrada (para que se entienda el cálculo) ---------- */
function Desglose({ T, calc }) {
  const t = T.find(x => x.d.precio > 0) || T[0];
  if (!t) return null;
  const x = t.d, fis = calc.fis;
  const Linea = ({ l, v, c, signo }) => <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, padding: "3px 0" }}><span style={{ color: "var(--muted)" }}>{l}</span><b style={{ color: c || "var(--text)" }}>{signo}{money(v)}</b></div>;
  return (
    <div style={{ ...C.card, boxShadow: "none", marginTop: 10 }}>
      <div style={{ ...C.label, marginBottom: 4 }}>Lo que deja una entrada · {t.nombre}</div>
      <Linea l="Precio" v={x.precio} />
      {x.iva > 0 && <Linea l={`IVA (${fis.ivaEntradas} %)`} v={x.iva} signo="− " c="var(--muted)" />}
      {x.comision > 0 && <Linea l="Comisión ticketera" v={x.comision} signo="− " c="var(--muted)" />}
      {x.copa > 0 && <Linea l="Copas incluidas" v={x.copa} signo="− " c="var(--amber)" />}
      <Linea l={`Barra (${money(calc.cfg.gastoBarra)} × ${calc.cfg.margenBarra} % margen${fis.ivaBarra ? ", sin IVA" : ""})`} v={x.barra} signo="+ " c="var(--green)" />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 15, padding: "6px 0 0", marginTop: 4, borderTop: "1px solid var(--line)" }}><b>Te deja</b><b style={{ color: x.deja >= 0 ? "var(--green)" : "var(--red)" }}>{money(x.deja)}</b></div>
    </div>
  );
}

/* ---------- Fila de un tramo ---------- */
function TramoFila({ t, i, n, real, prep, isMobile, onChange, onDel, onMove }) {
  const deja = prep?.d?.deja ?? 0;
  const campo = (l, k, opts = {}) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: opts.flex || 1 }}>
      <span style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)" }}>{l}</span>
      <div style={{ position: "relative" }}>
        <input inputMode={opts.texto ? "text" : opts.dec ? "decimal" : "numeric"} disabled={opts.disabled} value={t[k] ?? ""} placeholder={opts.ph || ""}
          onChange={e => onChange({ [k]: opts.texto ? e.target.value.slice(0, 40) : limpioNum(e.target.value, !!opts.dec) })}
          style={{ ...C.input, padding: "9px 10px", fontWeight: opts.texto ? 800 : 800, ...(opts.suf ? { paddingRight: 26 } : {}), ...(opts.disabled ? { opacity: .75 } : {}) }} />
        {opts.suf && <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontWeight: 800 }}>{opts.suf}</span>}
      </div>
    </label>
  );
  const vend = Math.floor(num(t.vendidas));
  return (
    <div style={{ padding: "12px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ width: 26, height: 26, borderRadius: 8, display: "grid", placeItems: "center", fontWeight: 900, fontSize: 13, background: "color-mix(in srgb, #ff5a3c 14%, var(--surface2))", color: "var(--accent)", flexShrink: 0 }}>{i + 1}</span>
        {t.ticketera ? <b style={{ flex: 1, minWidth: 0, fontSize: 15.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.nombre}</b>
          : <input value={t.nombre} aria-label="Nombre del tramo" onChange={e => onChange({ nombre: e.target.value.slice(0, 40) })} style={{ ...C.input, flex: 1, minWidth: 0, padding: "8px 10px", fontWeight: 900 }} />}
        {t.ticketera && <Badge c="#a855f7"><Icon n="link" s={11} w={2.2} />Ticketera</Badge>}
        <span style={{ fontSize: 12.5, fontWeight: 800, color: deja >= 0 ? "var(--green)" : "var(--red)", whiteSpace: "nowrap" }}>deja {money(deja)}</span>
        {!t.ticketera && <>
          <button onClick={() => onMove(-1)} disabled={i === 0} aria-label="Subir tramo" style={{ ...C.btnSm, padding: 6, opacity: i === 0 ? .35 : 1 }}><Icon n="up" s={14} /></button>
          <button onClick={() => onMove(1)} disabled={i === n - 1} aria-label="Bajar tramo" style={{ ...C.btnSm, padding: 6, opacity: i === n - 1 ? .35 : 1 }}><Icon n="chev" s={14} /></button>
          <button onClick={onDel} aria-label="Quitar tramo" style={{ ...C.btnSm, padding: 6 }}><Icon n="trash" s={14} /></button>
        </>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1.4fr", gap: 8 }}>
        {campo(t.ticketera ? "Precio medio" : "Precio", "precio", { dec: true, suf: "€", ph: "0" })}
        {campo("Cupo", "cupo", { ph: "sin límite" })}
        {campo("Copas incluidas", "copas", { ph: "0" })}
        <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)" }}>{real ? "Vendidas" : "Vendidas (tu previsión)"}</span>
          {t.ticketera ? <div style={{ ...C.input, padding: "9px 10px", fontWeight: 900, opacity: .85 }}>{nfmt(vend)} <span style={{ fontWeight: 600, color: "var(--muted)", fontSize: 12.5 }}>· {money(t.importeReal)}</span></div> : (
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={() => onChange({ vendidas: String(Math.max(0, vend - 10)) })} aria-label="Restar 10" style={{ ...C.btnSm, padding: "0 8px" }}>−10</button>
              <input inputMode="numeric" value={t.vendidas ?? ""} placeholder="0" aria-label="Entradas vendidas" onChange={e => onChange({ vendidas: limpioNum(e.target.value, false) })} style={{ ...C.input, padding: "9px 6px", textAlign: "center", fontWeight: 900, minWidth: 0 }} />
              <button onClick={() => onChange({ vendidas: String(vend + 10) })} aria-label="Sumar 10" style={{ ...C.btnSm, padding: "0 8px" }}>+10</button>
            </div>)}
        </label>
      </div>
      {prep?.cupo != null && vend > prep.cupo && <div style={{ fontSize: 12, color: "var(--amber)", fontWeight: 700, marginTop: 6 }}>Hay más vendidas que cupo.</div>}
    </div>
  );
}

/* ---------- Gráfico: beneficio según las entradas vendidas ---------- */
function Grafico({ calc, simN, totalEq, escenarios, real, isMobile }) {
  const { res, max, base } = calc;
  const W = isMobile ? 360 : 1000, H = isMobile ? 210 : 240, padL = 8, padR = 8, padT = 14, padB = 22;
  const desde = real ? base : 0;
  const pasos = 60, xs = Array.from({ length: pasos + 1 }, (_, k) => Math.round(desde + (max - desde) * k / pasos));
  const ys = xs.map(n => res(n).total);
  const yMin = Math.min(0, ...ys), yMax = Math.max(0, ...ys), rango = (yMax - yMin) || 1;
  const X = (n) => padL + (max === desde ? 0 : (n - desde) / (max - desde)) * (W - padL - padR);
  const Y = (v) => padT + (yMax - v) / rango * (H - padT - padB);
  const linea = xs.map((n, k) => `${k ? "L" : "M"}${X(n).toFixed(1)} ${Y(ys[k]).toFixed(1)}`).join(" ");
  const cero = Y(0);
  const escs = escenarios.map(e => ({ e, n: P.entradasEscenario(e, calc.T, calc.cfg) })).filter(x => x.n != null && x.n >= desde && x.n <= max);
  return (
    <div style={{ marginTop: 14 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Beneficio según las entradas vendidas">
        <defs>
          <clipPath id="prev-pos"><rect x="0" y="0" width={W} height={cero} /></clipPath>
          <clipPath id="prev-neg"><rect x="0" y={cero} width={W} height={H} /></clipPath>
        </defs>
        <path d={`${linea} L${X(max)} ${cero} L${X(desde)} ${cero} Z`} fill="var(--green)" opacity=".14" clipPath="url(#prev-pos)" />
        <path d={`${linea} L${X(max)} ${cero} L${X(desde)} ${cero} Z`} fill="var(--red)" opacity=".12" clipPath="url(#prev-neg)" />
        <line x1={padL} x2={W - padR} y1={cero} y2={cero} stroke="var(--muted)" strokeWidth="1" strokeDasharray="4 4" />
        <path d={linea} fill="none" stroke="var(--text)" strokeWidth="2.4" strokeLinejoin="round" />
        {totalEq != null && totalEq > desde && totalEq <= max && <g>
          <line x1={X(totalEq)} x2={X(totalEq)} y1={padT} y2={H - padB} stroke="#ff5a3c" strokeWidth="2" />
          <text x={X(totalEq) > W * .7 ? X(totalEq) - 6 : X(totalEq) + 6} textAnchor={X(totalEq) > W * .7 ? "end" : "start"} y={padT + 10} fontSize="12" fontWeight="800" fill="#ff5a3c">Equilibrio {nfmt(totalEq)}</text>
        </g>}
        {escs.map(({ e, n }) => <circle key={e.k} cx={X(n)} cy={Y(res(n).total)} r="6" fill={ESC_COL[e.k]} stroke="var(--surface)" strokeWidth="2"><title>{e.t}: {nfmt(n)} entradas</title></circle>)}
        <circle cx={X(simN)} cy={Y(res(simN).total)} r="7" fill="#ff5a3c" stroke="var(--surface)" strokeWidth="2.5" />
        <text x={padL} y={H - 6} fontSize="12" fill="var(--muted)">{nfmt(desde)}</text>
        <text x={W - padR} y={H - 6} fontSize="12" fill="var(--muted)" textAnchor="end">{nfmt(max)} entradas</text>
      </svg>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 10, background: "#ff5a3c" }} />Tu simulación</span>
        {escs.map(({ e }) => <span key={e.k} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 10, background: ESC_COL[e.k] }} />{e.t}</span>)}
      </div>
    </div>
  );
}

/* ---------- Configuración de la sección ---------- */
function Configuracion({ cfg, fis, ajustes, events, ev, onSave, onClose }) {
  const [c, setC] = useState({ ...cfg });
  const [defecto, setDefecto] = useState(true);
  const set = (k, v) => setC(x => ({ ...x, [k]: v }));
  const fiscal = P.fiscalDe(ajustes, c);
  const barra = P.barraPorPersona(c, fiscal);
  const ivaActivo = !!ajustes?.iva?.activo;
  const k = ajustes?.comisiones || {};
  const Num = ({ l, sub, campo, suf, dec = true }) => (   // se llama como función (no como componente) para no perder el foco
    <Field l={l} mb={14}>
      <div style={{ position: "relative" }}>
        <input inputMode={dec ? "decimal" : "numeric"} value={c[campo] ?? ""} onChange={e => set(campo, limpioNum(e.target.value, dec))} style={{ ...C.input, fontWeight: 900, fontSize: 18, paddingRight: 40 }} aria-label={l} />
        {suf && <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontWeight: 900, color: "var(--muted)" }}>{suf}</span>}
      </div>
      {sub && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{sub}</div>}
    </Field>
  );
  const Sw = ({ on, onClick, l, sub }) => (
    <label style={{ ...C.toggleRow, padding: "10px 0", borderTop: "1px solid var(--line)" }}>
      <span><span style={{ display: "block" }}>{l}</span>{sub && <span style={{ display: "block", fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>{sub}</span>}</span>
      <button type="button" role="switch" aria-checked={on} onClick={onClick} style={{ ...C.switch, background: on ? "var(--green)" : "var(--line)" }}><span style={{ ...C.knob, transform: on ? "translateX(22px)" : "translateX(2px)" }} /></button>
    </label>
  );
  return (
    <Sheet title="Configuración de la previsión" onClose={onClose}
      footer={<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}><input type="checkbox" checked={defecto} onChange={e => setDefecto(e.target.checked)} style={{ width: 18, height: 18, accentColor: "#ff5a3c" }} />Usar también en los próximos eventos</label>
        <button onClick={() => onSave(P.cfgCon(c), defecto)} style={{ ...C.btnPrimary, width: "100%" }}><Icon n="check" s={17} w={2.4} />Guardar</button>
      </div>}>
      <div style={{ ...C.label, marginBottom: 10 }}>Barra</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {Num({ l: "Gasto medio por cliente", campo: "gastoBarra", suf: "€" })}
        {Num({ l: "Margen de la bebida", campo: "margenBarra", suf: "%", dec: false })}
      </div>
      <div style={{ ...C.card, boxShadow: "none", marginBottom: 16, fontSize: 13.5 }}>Cada cliente te deja en barra <b style={{ color: "var(--green)" }}>{money(barra)}</b> de beneficio{fiscal.ivaBarra ? ` (sin el ${fiscal.ivaBarra} % de IVA)` : ""}.</div>

      <div style={{ ...C.label, marginBottom: 10 }}>Copas incluidas en la entrada</div>
      {Num({ l: "Coste de cada copa", campo: "costeCopa", suf: "€", sub: "Lo que te cuesta servir una copa incluida (bebida, hielo, vaso…). En cada tramo pones cuántas lleva." })}

      <div style={{ ...C.label, marginBottom: 10 }}>Evento</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {Num({ l: "Aforo", campo: "aforo", suf: "pers.", dec: false, sub: "Vacío = sin límite" })}
        {Num({ l: "Invitaciones previstas", campo: "invitaciones", dec: false })}
      </div>
      {Num({ l: "Copas por invitación", campo: "copasInvitacion", dec: false, sub: "Las invitaciones no pagan entrada pero gastan en barra." })}

      <div style={{ ...C.label, margin: "6px 0 4px" }}>Lo que se descuenta (de Ajustes)</div>
      <Sw on={c.comision !== false} onClick={() => set("comision", c.comision === false)} l="Comisión de la ticketera" sub={`${Number(k.ticketeraPct) || 0} % + ${money(Number(k.ticketeraFijo) || 0)} por entrada`} />
      <Sw on={c.iva !== false && ivaActivo} onClick={() => ivaActivo && set("iva", c.iva === false)} l="IVA" sub={ivaActivo ? `Entradas ${ajustes.iva.ventas?.entradas ?? 21} % · barra ${ajustes.iva.ventas?.barra ?? 10} %` : "Desactivado en Ajustes"} />
    </Sheet>
  );
}

function CopiarDe({ events, onCopiar, onClose }) {
  return (
    <Sheet title="Copiar la previsión de otro evento" onClose={onClose}>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>Se copian los tramos, los gastos simulados, los escenarios y la configuración. Las ventas no.</div>
      {events.length === 0 && <div style={C.empty}>No hay otros eventos.</div>}
      {events.map(e => <button key={e.id} onClick={() => onCopiar(e)} style={C.listBtn}><Tile n="calendar" s={34} /><span style={{ flex: 1, minWidth: 0 }}><b style={{ display: "block" }}>{e.name}</b><span style={{ fontSize: 12, color: "var(--muted)" }}>{e.date}</span></span><Icon n="right" s={16} /></button>)}
    </Sheet>
  );
}

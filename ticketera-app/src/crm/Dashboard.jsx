// ===================== CRM · DASHBOARD (fase 4) =====================
// Cuánto ha dejado cada evento y la evolución por meses y años, con los datos de toda la cuenta.
import React, { useEffect, useMemo, useState } from "react";
import * as crm from "./crmdb";
import { money, r2, fechaCorta, useIsMobile, C, Icon, Tile } from "./ui";
import { GRUPOS, resumenEvento } from "./modelo";
import { gcatInfo } from "./Gastos";

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const mesDe = (iso) => (iso && /^\d{4}-\d{2}/.test(iso) ? iso.slice(0, 7) : null);
const mesTxt = (k) => `${MESES[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`;
const compact = (v) => { const a = Math.abs(v); return (v < 0 ? "−" : "") + (a >= 1000 ? (Math.round(a / 100) / 10).toString().replace(".", ",") + "k" : Math.round(a).toString()); };
const pct = (a, b) => (b ? Math.round((a - b) / Math.abs(b) * 100) : null);

export function Dashboard({ ev, events, sales, gastosCaja, onSelectEvent, refreshKey }) {
  const isMobile = useIsMobile();
  const [modo, setModo] = useState("evento");       // evento | todos
  const [periodo, setPeriodo] = useState("anio");   // anio | pasado | 12m | todo
  const [cuenta, setCuenta] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => { let vivo = true; setError(false); crm.loadCuenta().then(d => vivo && setCuenta(d)).catch(() => vivo && setError(true)); return () => { vivo = false; }; }, [refreshKey]);

  const resumenes = useMemo(() => {
    if (!cuenta) return [];
    return events.map(e => resumenEvento(e, sales, gastosCaja, cuenta.ingresos.filter(i => i.eventoId === e.id), cuenta.gastos.filter(g => g.eventoId === e.id), cuenta.fuentes))
      .sort((a, b) => String(b.ev.date || "").localeCompare(String(a.ev.date || "")));
  }, [cuenta, events, sales, gastosCaja]);

  if (error) return <div style={{ ...C.panel, color: "var(--amber)", fontWeight: 700 }}><Icon n="alert" s={16} c="currentColor" style={{ verticalAlign: "-3px", marginRight: 6 }} />No se han podido cargar los datos del dashboard. Revisa la conexión.</div>;
  if (!cuenta) return <div style={{ color: "var(--muted)", padding: 30, textAlign: "center" }}>Calculando…</div>;

  const R = resumenes.find(r => r.ev.id === ev.id);
  const conDatos = resumenes.filter(r => r.ingresos > 0 || r.gastos > 0);
  const anterior = R ? conDatos.find(r => r.ev.id !== R.ev.id && String(r.ev.date || "") < String(R.ev.date || "")) : null;

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        <button onClick={() => setModo("evento")} style={{ ...C.seg, padding: "10px 16px", fontSize: 14, ...(modo === "evento" ? C.segOn : {}) }}><Icon n="calendar" s={16} c="currentColor" style={{ verticalAlign: "-3px", marginRight: 6 }} />{ev.name}</button>
        <button onClick={() => setModo("todos")} style={{ ...C.seg, padding: "10px 16px", fontSize: 14, ...(modo === "todos" ? C.segOn : {}) }}><Icon n="chart" s={16} c="currentColor" style={{ verticalAlign: "-3px", marginRight: 6 }} />Todos los eventos</button>
      </div>
      {modo === "evento" && R && <VistaEvento R={R} anterior={anterior} isMobile={isMobile} />}
      {modo === "todos" && <VistaTodos resumenes={resumenes} periodo={periodo} setPeriodo={setPeriodo} isMobile={isMobile} onAbrir={(id) => { onSelectEvent(id); setModo("evento"); }} />}
    </div>
  );
}

/* ---------- Un evento ---------- */
function VistaEvento({ R, anterior, isMobile }) {
  const d = anterior ? pct(R.beneficio, anterior.beneficio) : null;
  const grupos = GRUPOS.map(g => ({ ...g, v: R.porGrupo[g.k] || 0 })).filter(g => g.v > 0);
  const cats = Object.entries(R.G.porCat).sort((a, b) => b[1].total - a[1].total).slice(0, 8);
  const maxCat = Math.max(1, ...cats.map(([, v]) => Math.max(v.total, v.previsto)));
  // La noche va de la tarde a la madrugada: se ordena desde las 12:00 (23h antes que 0h)
  const horas = Array.from({ length: 24 }, (_, i) => (i + 12) % 24).filter(h => R.horas[h]);
  const maxH = Math.max(1, ...Object.values(R.horas));
  const pico = horas.reduce((a, h) => (R.horas[h] > (R.horas[a] || 0) ? h : a), horas[0]);
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,minmax(0,1fr))", gap: 10, marginBottom: 14 }}>
        <Big l="Ingresos" v={money(R.ingresos)} sub={anterior ? vs(R.ingresos, anterior.ingresos, anterior.ev.name) : null} />
        <Big l="Gastos" v={money(R.gastos)} sub={R.G.previsto ? `Previsto ${money(R.G.previsto)}` : null} />
        <Big l="Beneficio" v={money(R.beneficio)} c={R.beneficio >= 0 ? "var(--green)" : "var(--red)"} sub={d != null ? <Delta d={d} txt={`vs ${anterior.ev.name}`} /> : null} />
        <Big l="Margen" v={R.margen != null ? `${R.margen} %` : "—"} c={R.margen != null ? (R.margen >= 0 ? "var(--green)" : "var(--red)") : undefined} sub="del total ingresado" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div style={C.panel}>
          <div style={{ fontWeight: 900, display: "flex", alignItems: "center", marginBottom: 10 }}><Icon n="wallet" s={17} c="var(--accent)" style={{ verticalAlign: "-3px", marginRight: 6 }} />De dónde viene el dinero</div>
          {grupos.length === 0 ? <div style={C.empty}>Sin ingresos todavía.</div> : (<>
            <div style={{ display: "flex", height: 18, borderRadius: 9, overflow: "hidden", marginBottom: 12, background: "var(--surface2)" }}>
              {grupos.map(g => <div key={g.k} title={`${g.t}: ${money(g.v)}`} style={{ width: `${g.v / R.ingresos * 100}%`, background: g.c }} />)}
            </div>
            {grupos.map(g => <div key={g.k} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0", borderTop: "1px solid var(--line)", fontSize: 14 }}><span style={{ display: "flex", alignItems: "center", gap: 8 }}><Tile n={g.i} c={g.c} s={26} />{g.t}</span><span><b>{money(g.v)}</b> <span style={{ color: "var(--muted)", fontSize: 12 }}>{Math.round(g.v / R.ingresos * 100)} %</span></span></div>)}
          </>)}
        </div>
        <div style={C.panel}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
            <div style={{ fontWeight: 900, display: "flex", alignItems: "center", gap: 8 }}><Icon n="receipt" s={17} c="var(--accent)" />En qué se va</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>▏ marca = previsto</div>
          </div>
          {cats.length === 0 ? <div style={C.empty}>Sin gastos todavía.</div> : cats.map(([k, v]) => (
            <div key={k} style={{ padding: "6px 0", borderTop: "1px solid var(--line)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13.5, marginBottom: 4 }}><span style={{ display: "flex", alignItems: "center", gap: 8 }}><Tile n={gcatInfo(k).i} c={gcatInfo(k).c} s={24} />{k}</span><b>{money(v.total)}</b></div>
              <div style={{ position: "relative", height: 8, borderRadius: 4, background: "var(--surface2)" }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${v.total / maxCat * 100}%`, borderRadius: 4, background: v.previsto && v.total > v.previsto + 0.005 ? "var(--red)" : "var(--accent)" }} />
                {v.previsto > 0 && <div style={{ position: "absolute", top: -3, bottom: -3, width: 2, left: `calc(${v.previsto / maxCat * 100}% - 1px)`, background: "#fff", opacity: .85 }} />}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "2fr 1fr", gap: 12 }}>
        <div style={C.panel}>
          <div style={{ fontWeight: 900, marginBottom: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><Icon n="clock" s={17} c="var(--accent)" />Ventas del TPV por hora {pico != null && <span style={{ color: "var(--muted)", fontWeight: 600, fontSize: 12.5 }}>· pico a las {String(pico).padStart(2, "0")}:00</span>}</div>
          {horas.length === 0 ? <div style={C.empty}>Sin ventas en el TPV.</div> : (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120 }}>
              {horas.map(h => <div key={h} style={{ flex: 1, textAlign: "center", minWidth: 0 }} title={`${h}:00 · ${R.horas[h]} tickets`}>
                <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>{R.horas[h]}</div>
                <div style={{ height: Math.max(4, R.horas[h] / maxH * 86), background: h === pico ? "var(--accent)" : "rgba(255,90,60,.35)", borderRadius: 4 }} />
                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 3 }}>{h}h</div>
              </div>)}
            </div>
          )}
        </div>
        <div style={C.panel}>
          <div style={{ fontWeight: 900, display: "flex", alignItems: "center", marginBottom: 10 }}><Icon n="scale" s={17} c="var(--accent)" style={{ verticalAlign: "-3px", marginRight: 6 }} />Presupuesto</div>
          <Fila l="Previsto" v={money(R.G.previsto)} />
          <Fila l="Gastado real" v={money(R.G.real)} />
          <Fila l="Pendiente de pagar" v={money(R.G.pendiente)} c={R.G.pendiente ? "var(--amber)" : undefined} />
          <Fila l="Tickets del TPV" v={R.tickets} />
          {R.tickets > 0 && <Fila l="Ticket medio" v={money(R.tpv / R.tickets)} />}
        </div>
      </div>
    </div>
  );
}

/* ---------- Todos los eventos ---------- */
function VistaTodos({ resumenes, periodo, setPeriodo, isMobile, onAbrir }) {
  const hoy = new Date(); const y = hoy.getFullYear();
  const desde12 = new Date(hoy.getFullYear(), hoy.getMonth() - 11, 1).toISOString().slice(0, 7);
  const dentro = (r) => {
    const m = mesDe(r.ev.date);
    if (periodo === "todo") return true;
    if (!m) return false;
    if (periodo === "anio") return m.startsWith(String(y));
    if (periodo === "pasado") return m.startsWith(String(y - 1));
    return m >= desde12;
  };
  const lista = resumenes.filter(dentro);
  const T = lista.reduce((t, r) => ({ ing: t.ing + r.ingresos, gas: t.gas + r.gastos, ben: t.ben + r.beneficio }), { ing: 0, gas: 0, ben: 0 });
  const conMov = lista.filter(r => r.ingresos > 0 || r.gastos > 0);
  const ranking = [...conMov].sort((a, b) => b.beneficio - a.beneficio);

  // Por mes
  const porMes = {};
  lista.forEach(r => { const m = mesDe(r.ev.date); if (!m) return; porMes[m] = porMes[m] || { ing: 0, gas: 0, ben: 0, n: 0 }; porMes[m].ing += r.ingresos; porMes[m].gas += r.gastos; porMes[m].ben += r.beneficio; porMes[m].n++; });
  let meses = Object.keys(porMes).sort();
  if (meses.length) { const all = []; let [yy, mm] = meses[0].split("-").map(Number); const fin = meses[meses.length - 1]; while (true) { const k = `${yy}-${String(mm).padStart(2, "0")}`; all.push(k); if (k >= fin || all.length > 60) break; mm++; if (mm > 12) { mm = 1; yy++; } } meses = all; }

  const csv = () => {
    const filas = [["Evento", "Fecha", "Ingresos", "Gastos", "Beneficio", "Margen %"], ...ranking.map(r => [r.ev.name, r.ev.date || "", r.ingresos.toFixed(2), r.gastos.toFixed(2), r.beneficio.toFixed(2), r.margen ?? ""])];
    const cell = (x) => { let v = String(x ?? "").replace(/[;\r\n]+/g, " "); if (/^[=+\-@\t]/.test(v) && !/^-?\d+([.,]\d+)?$/.test(v)) v = "'" + v; return v; };
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + filas.map(f => f.map(cell).join(";")).join("\n")], { type: "text/csv;charset=utf-8;" })); a.download = `TIXFAST_resultados_${periodo}.csv`; a.click();
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        {[["anio", `Este año (${y})`], ["pasado", `${y - 1}`], ["12m", "Últimos 12 meses"], ["todo", "Todo"]].map(([k, l]) => <button key={k} onClick={() => setPeriodo(k)} style={{ ...C.seg, ...(periodo === k ? C.segOn : {}) }}>{l}</button>)}
        <span style={{ flex: 1 }} />
        {ranking.length > 0 && <button onClick={csv} style={C.small}>⬇ CSV</button>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,minmax(0,1fr))", gap: 10, marginBottom: 14 }}>
        <Big l="Ingresos" v={money(T.ing)} />
        <Big l="Gastos" v={money(T.gas)} />
        <Big l="Beneficio" v={money(T.ben)} c={T.ben >= 0 ? "var(--green)" : "var(--red)"} sub={T.ing ? `Margen ${Math.round(T.ben / T.ing * 100)} %` : null} />
        <Big l="Eventos" v={conMov.length} sub={conMov.length ? `${money(T.ben / conMov.length)} de media` : null} />
      </div>

      <div style={{ ...C.panel, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
          <div style={{ fontWeight: 900, display: "flex", alignItems: "center" }}><Icon n="trend" s={17} c="var(--accent)" style={{ verticalAlign: "-3px", marginRight: 6 }} />Por mes</div>
          <div style={{ display: "flex", gap: 12, fontSize: 11.5, color: "var(--muted)" }}><Ley c="var(--accent)" t="Ingresos" /><Ley c="#5b6275" t="Gastos" /><Ley c="var(--green)" t="Beneficio" linea /></div>
        </div>
        {meses.length === 0 ? <div style={C.empty}>No hay eventos con fecha en este periodo.</div> : <GraficoMeses meses={meses} porMes={porMes} isMobile={isMobile} />}
      </div>

      <div style={C.panel}>
        <div style={{ fontWeight: 900, marginBottom: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><Icon n="award" s={17} c="var(--accent)" />Ranking de eventos <span style={{ color: "var(--muted)", fontWeight: 600, fontSize: 12.5 }}>· toca uno para verlo</span></div>
        {ranking.length === 0 && <div style={C.empty}>Aún no hay eventos con ingresos o gastos en este periodo.</div>}
        {ranking.map((r, i) => (
          <button key={r.ev.id} onClick={() => onAbrir(r.ev.id)} style={{ ...C.ingRow, flexWrap: isMobile ? "wrap" : "nowrap" }}>
            <span style={{ width: 28, fontWeight: 900, color: "var(--muted)", flexShrink: 0 }}>{i < 3 ? <span style={{ width: 24, height: 24, borderRadius: 8, display: "inline-grid", placeItems: "center", background: ["#ffb400", "#cbd5e1", "#d97706"][i], color: "#1a1206", fontSize: 13 }}>{i + 1}</span> : i + 1}</span>
            <span style={{ flex: 1, minWidth: 140, textAlign: "left" }}><b style={{ display: "block" }}>{r.ev.name}</b><span style={{ fontSize: 12, color: "var(--muted)" }}>{r.ev.date ? fechaCorta(r.ev.date) + " " + r.ev.date.slice(0, 4) : "Sin fecha"}</span></span>
            <span style={{ display: "flex", gap: isMobile ? 10 : 18, fontSize: 13, textAlign: "right", flexShrink: 0 }}>
              <span><span style={{ display: "block", color: "var(--muted)", fontSize: 11 }}>Ingresos</span>{money(r.ingresos)}</span>
              <span><span style={{ display: "block", color: "var(--muted)", fontSize: 11 }}>Gastos</span>{money(r.gastos)}</span>
              <span style={{ minWidth: 96 }}><span style={{ display: "block", color: "var(--muted)", fontSize: 11 }}>Beneficio{r.margen != null ? ` · ${r.margen} %` : ""}</span><b style={{ color: r.beneficio >= 0 ? "var(--green)" : "var(--red)", fontSize: 15 }}>{money(r.beneficio)}</b></span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Barras de ingresos y gastos por mes, con el beneficio como línea
function GraficoMeses({ meses, porMes, isMobile }) {
  const W = isMobile ? 360 : 720, H = isMobile ? 220 : 250, L = isMobile ? 40 : 46, R = 10, T = 14, B = 30;
  const vals = meses.flatMap(m => { const v = porMes[m] || { ing: 0, gas: 0, ben: 0 }; return [v.ing, v.gas, v.ben]; });
  const max = Math.max(1, ...vals), min = Math.min(0, ...vals);
  const y = (v) => T + (max - v) / (max - min) * (H - T - B);
  const step = (W - L - R) / meses.length, bw = Math.min(26, step * 0.32);
  const x = (i) => L + step * i + step / 2;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => min + (max - min) * f);
  const pts = meses.map((m, i) => `${x(i)},${y((porMes[m] || { ben: 0 }).ben)}`).join(" ");
  const cadaN = Math.max(1, Math.ceil(meses.length / (isMobile ? 6 : 12)));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Ingresos, gastos y beneficio por mes">
      {ticks.map((t, i) => <g key={i}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" /><text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="10.5" fill="var(--muted)">{compact(t)}</text></g>)}
      <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="var(--muted)" strokeWidth="1" />
      {meses.map((m, i) => { const v = porMes[m] || { ing: 0, gas: 0 }; return (
        <g key={m}>
          <rect x={x(i) - bw - 1} y={y(Math.max(0, v.ing))} width={bw} height={Math.max(0, y(0) - y(v.ing))} rx="3" fill="var(--accent)"><title>{`${mesTxt(m)} · ingresos ${money(v.ing)}`}</title></rect>
          <rect x={x(i) + 1} y={y(Math.max(0, v.gas))} width={bw} height={Math.max(0, y(0) - y(v.gas))} rx="3" fill="#5b6275"><title>{`${mesTxt(m)} · gastos ${money(v.gas)}`}</title></rect>
          {i % cadaN === 0 && <text x={x(i)} y={H - 12} textAnchor="middle" fontSize="10.5" fill="var(--muted)">{mesTxt(m)}</text>}
        </g>); })}
      {meses.length > 1 && <polyline points={pts} fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinejoin="round" />}
      {meses.map((m, i) => { const b = (porMes[m] || { ben: 0 }).ben; return <circle key={m} cx={x(i)} cy={y(b)} r="4" fill={b >= 0 ? "var(--green)" : "var(--red)"} stroke="var(--surface)" strokeWidth="1.5"><title>{`${mesTxt(m)} · beneficio ${money(b)}`}</title></circle>; })}
    </svg>
  );
}

const Big = ({ l, v, c, sub }) => <div style={C.card}><div style={C.label}>{l}</div><div style={{ fontSize: 24, fontWeight: 900, color: c || "var(--text)", lineHeight: 1.1 }}>{v}</div>{sub && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>{sub}</div>}</div>;
const Fila = ({ l, v, c }) => <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 0", borderTop: "1px solid var(--line)", fontSize: 14 }}><span style={{ color: "var(--muted)" }}>{l}</span><b style={{ color: c || "var(--text)" }}>{v}</b></div>;
const Ley = ({ c, t, linea }) => <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: linea ? 14 : 10, height: linea ? 3 : 10, borderRadius: 2, background: c }} />{t}</span>;
const Delta = ({ d, txt }) => <span style={{ color: d >= 0 ? "var(--green)" : "var(--red)", fontWeight: 800 }}>{d >= 0 ? "▲" : "▼"} {Math.abs(d)} % {txt}</span>;
const vs = (a, b, nombre) => { const d = pct(a, b); return d == null ? null : <Delta d={d} txt={`vs ${nombre}`} />; };

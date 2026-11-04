// ===================== CRM · GASTOS =====================
// Presupuesto vivo: cada gasto tiene importe previsto y real, quién lo pagó y su estado.
// Los gastos de caja del TPV se muestran aquí en solo lectura (se registran en la barra).
import React, { useMemo, useState } from "react";
import { money, r2, fechaCorta, parseImporte, useIsMobile, C, Icon, Tile, Avatar, Badge, Seg, Head, Sheet, Field, IconGrid, MoneyInput } from "./ui";
import { Vacio, Pill } from "./Ingresos";

export const GCATS = [
  { k: "Espacio y permisos", i: "home", c: "#f97316" }, { k: "Artistas", i: "mic", c: "#a855f7" }, { k: "Producción técnica", i: "speaker", c: "#3b82f6" },
  { k: "Técnicos", i: "wrench", c: "#0ea5e9" }, { k: "Personal", i: "users", c: "#22d3a6" }, { k: "Barra y producto", i: "bottle", c: "#ff5a3c" },
  { k: "Marketing", i: "megaphone", c: "#ec4899" }, { k: "Servicios", i: "shield", c: "#14b8a6" }, { k: "Decoración y efectos", i: "sparkle", c: "#eab308" },
  { k: "Logística", i: "truck", c: "#8b5cf6" }, { k: "Ticketing y pagos", i: "card", c: "#6366f1" }, { k: "Administración", i: "file", c: "#94a3b8" },
  { k: "Imprevistos", i: "alert", c: "#ef4444" }, { k: "Otros", i: "dots", c: "#838aa0" },
];
export const CAJA_CAT = "Caja de las barras";
export const gcatInfo = (k) => k === CAJA_CAT ? { k, i: "cash", c: "#ffb400" } : (GCATS.find(c => c.k === k) || { k, i: "dots", c: "#838aa0" });
const ESTADOS = [{ k: "previsto", t: "Previsto", i: "edit", c: "#838aa0", ink: "#fff" }, { k: "confirmado", t: "Confirmado", i: "hand", c: "#3b82f6", ink: "#fff" }, { k: "pagado", t: "Pagado", i: "check", c: "var(--green)", ink: "#04241b" }];
const HIJOS = [{ k: "Transporte", i: "truck", c: "#8b5cf6" }, { k: "Alojamiento", i: "home", c: "#f97316" }, { k: "Dietas", i: "bottle", c: "#ff5a3c" }, { k: "Hospitalidad (rider)", t: "Rider", i: "sparkle", c: "#eab308" }, { k: "Otros", i: "dots", c: "#838aa0" }];
// Importe que cuenta: el real si ya se sabe; si no, el previsto
export const importe = (g) => (g.real != null ? g.real : g.previsto != null ? g.previsto : 0);
const isEntrada = (g) => g && g.tipo === "entrada";
const numTxt = (v) => (v == null ? "" : String(v).replace(".", ","));
const cleanNum = (t, max = 12) => t.replace(/[^\d.,]/g, "").slice(0, max);

// Totales de gastos de un evento (lo usan Gastos y el resumen de socios)
export function totalesGastos(ev, gastos, gastosCaja) {
  const caja = (gastosCaja || []).filter(g => g.eventId === ev.id && !g.voided && !isEntrada(g)).map(g => ({ ...g, categoria: CAJA_CAT }));
  const cajaTotal = r2(caja.reduce((t, g) => t + g.importe, 0));
  const previsto = r2(gastos.reduce((t, g) => t + (g.previsto || 0), 0));
  const real = r2(gastos.reduce((t, g) => t + (g.real || 0), 0) + cajaTotal);
  const total = r2(gastos.reduce((t, g) => t + importe(g), 0) + cajaTotal);
  const pendiente = r2(gastos.filter(g => g.estado !== "pagado").reduce((t, g) => t + importe(g), 0));
  const porCat = {};
  gastos.forEach(g => { const k = g.categoria; porCat[k] = porCat[k] || { previsto: 0, real: 0, total: 0, n: 0 }; porCat[k].previsto += g.previsto || 0; porCat[k].real += g.real || 0; porCat[k].total += importe(g); porCat[k].n++; });
  if (caja.length) porCat[CAJA_CAT] = { previsto: 0, real: cajaTotal, total: cajaTotal, n: caja.length };
  const pagadoSocio = {};
  gastos.filter(g => g.pagadoPor).forEach(g => { pagadoSocio[g.pagadoPor] = r2((pagadoSocio[g.pagadoPor] || 0) + importe(g)); });
  return { caja, cajaTotal, previsto, real, total, pendiente, porCat, pagadoSocio };
}


export function Gastos({ ev, events, gastos, gastosCaja, socios, socioById, ingresosTotal, busy, onSave, onDelete, onCopiar }) {
  const isMobile = useIsMobile();
  const [form, setForm] = useState(null);      // { tipo, gasto, padre }
  const [filtro, setFiltro] = useState(null);  // categoría
  const [copiar, setCopiar] = useState(false);
  const G = useMemo(() => totalesGastos(ev, gastos, gastosCaja), [ev, gastos, gastosCaja]);
  const top = gastos.filter(g => !g.padreId);
  const hijosDe = (id) => gastos.filter(g => g.padreId === id);
  const totalArtista = (a) => r2(importe(a) + hijosDe(a.id).reduce((t, h) => t + importe(h), 0));
  const beneficio = r2(ingresosTotal - G.total);
  const cats = Object.entries(G.porCat).sort((a, b) => b[1].total - a[1].total);
  const maxCat = Math.max(1, ...cats.map(([, v]) => Math.max(v.total, v.previsto)));
  const otrosEventos = events.filter(e => e.id !== ev.id);
  const adelantos = Object.entries(G.pagadoSocio).filter(([, v]) => v > 0);
  const maxRes = Math.max(1, ingresosTotal, G.total);

  // Lista agrupada por categoría (el filtro deja solo una)
  const grupos = cats.filter(([k]) => !filtro || k === filtro).map(([k, v]) => ({ k, v, items: k === CAJA_CAT ? [] : top.filter(g => g.categoria === k) }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ===== Resultado ===== */}
      <section style={{ ...C.hero, padding: isMobile ? 16 : 22 }}>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1.1fr 1fr", gap: isMobile ? 14 : 28, alignItems: "center" }}>
          <div>
            <div style={C.label}>Beneficio estimado · {ev.name}</div>
            <div style={{ fontSize: isMobile ? 38 : 50, fontWeight: 900, letterSpacing: "-.02em", lineHeight: 1.05, marginTop: 4, color: beneficio >= 0 ? "var(--green)" : "var(--red)" }}>{money(beneficio)}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Cada gasto cuenta por su importe real; si aún no lo tiene, por el previsto.</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Barra t="Ingresos" v={ingresosTotal} max={maxRes} c="var(--green)" i="wallet" />
            <Barra t="Gastos" v={G.total} max={maxRes} c="var(--accent)" i="receipt" />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : `repeat(${G.cajaTotal > 0 ? 4 : 3},minmax(0,1fr))`, gap: 8, marginTop: 16 }}>
          <Mini l="Presupuesto previsto" v={money(G.previsto)} />
          <Mini l="Gastado real" v={money(G.real)} sub={G.previsto ? `${Math.round(G.real / G.previsto * 100)} % del previsto` : null} c={G.previsto && G.real > G.previsto ? "var(--red)" : undefined} />
          <Mini l="Pendiente de pagar" v={money(G.pendiente)} c={G.pendiente ? "var(--amber)" : undefined} />
          {G.cajaTotal > 0 && <Mini l="Sacado de caja (TPV)" v={money(G.cajaTotal)} />}
        </div>
      </section>

      {/* ===== Añadir ===== */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
        <AddBtn i="plus" t="Gasto" sub={isMobile ? null : "Alquiler, sonido, publicidad…"} primary onClick={() => setForm({ tipo: "normal", gasto: {} })} />
        <AddBtn i="users" t="Personal" sub={isMobile ? null : "Personas × €/hora × horas"} onClick={() => setForm({ tipo: "personal", gasto: {} })} />
        <AddBtn i="mic" t="Artista" sub={isMobile ? null : "Caché y sus gastos"} onClick={() => setForm({ tipo: "artista", gasto: {} })} />
      </div>

      {/* ===== Por categoría (toca para filtrar) ===== */}
      <section style={C.panel}>
        <Head i="chart" t="En qué se va el dinero" sub="Toca una categoría para ver solo sus gastos"
          right={<span style={{ display: "flex", gap: 12, fontSize: 11.5, color: "var(--muted)" }}><Ley c="var(--accent)" t="Cuenta" /><Ley c="#fff" t="Previsto" marca /></span>} />
        {cats.length === 0 && <Vacio i="receipt" t="Aún no hay gastos." sub={otrosEventos.length ? "Añade el primero o copia el presupuesto de otro evento." : "Añade el primero con los botones de arriba."} />}
        {cats.map(([k, v]) => { const ci = gcatInfo(k), on = filtro === k, pasa = v.previsto && v.total > v.previsto + 0.005; return (
          <button key={k} onClick={() => setFiltro(on ? null : k)} style={{ ...C.listBtn, padding: "10px 8px", borderRadius: on ? 12 : 0, background: on ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "transparent", outline: on ? "2px solid var(--accent)" : "none", outlineOffset: -2 }}>
            <Tile n={ci.i} c={ci.c} s={34} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                <span style={{ fontWeight: 800, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k} <span style={{ color: "var(--muted)", fontWeight: 600, fontSize: 12 }}>· {v.n}</span></span>
                <b style={{ fontSize: 14.5, flexShrink: 0, color: pasa ? "var(--red)" : "var(--text)" }}>{money(v.total)}</b>
              </span>
              <span style={{ display: "block", position: "relative", height: 8, borderRadius: 4, background: "var(--surface2)" }}>
                <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${v.total / maxCat * 100}%`, borderRadius: 4, background: pasa ? "var(--red)" : ci.c }} />
                {v.previsto > 0 && <span style={{ position: "absolute", top: -3, bottom: -3, width: 2, left: `calc(${Math.min(100, v.previsto / maxCat * 100)}% - 1px)`, background: "#fff", borderRadius: 1 }} />}
              </span>
            </span>
          </button>); })}
      </section>

      {/* ===== Lista de gastos agrupada ===== */}
      <section style={C.panel}>
        <Head i="receipt" t={filtro || "Todos los gastos"} sub={filtro ? null : `${gastos.length} gastos${G.caja.length ? ` · ${G.caja.length} de caja` : ""}`}
          right={<span style={{ display: "flex", gap: 6 }}>
            {filtro && <button onClick={() => setFiltro(null)} style={C.btnSm}><Icon n="x" s={14} />Quitar filtro</button>}
            {!filtro && otrosEventos.length > 0 && <button onClick={() => setCopiar(true)} style={C.btnSm}><Icon n="copy" s={14} />Copiar presupuesto</button>}
          </span>} />
        {grupos.length === 0 && <Vacio i="receipt" t="Sin gastos todavía." />}
        {grupos.map(({ k, v, items }) => { const ci = gcatInfo(k); return (
          <div key={k} style={{ marginBottom: 10 }}>
            {!filtro && <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 4px 6px", borderTop: "1px solid var(--line)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: 1, color: ci.c }}><Icon n={ci.i} s={15} />{k}</span>
              <b style={{ fontSize: 13 }}>{money(v.total)}</b>
            </div>}
            {k === CAJA_CAT && G.caja.map(g => (
              <div key={g.id} style={{ ...C.listBtn, cursor: "default" }}>
                <Tile n="cash" c="#ffb400" s={34} />
                <span style={{ flex: 1, minWidth: 0 }}><b style={{ display: "block" }}>{g.concepto || "Gasto de caja"}</b><span style={{ fontSize: 12, color: "var(--muted)" }}>{ev.puntos.find(p => p.id === g.puntoId)?.name || "Barra"} · registrado en el TPV</span></span>
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}><b style={{ fontSize: 15.5 }}>{money(g.importe)}</b><Badge><Icon n="lock" s={11} w={2.2} />Desde el TPV</Badge></span>
              </div>))}
            {items.map(g => g.tipo === "artista"
              ? <Artista key={g.id} a={g} hijos={hijosDe(g.id)} total={totalArtista(g)} socioById={socioById} onEdit={(x, padre) => setForm(padre ? { tipo: "normal", gasto: x, padre } : { tipo: "artista", gasto: x })} onAdd={() => setForm({ tipo: "normal", gasto: { categoria: "Artistas" }, padre: g })} />
              : <Fila key={g.id} g={g} socioById={socioById} onClick={() => setForm({ tipo: g.tipo, gasto: g })} />)}
          </div>); })}
      </section>

      {/* ===== Adelantos de socios ===== */}
      {adelantos.length > 0 && (
        <section style={{ ...C.panel, borderColor: "color-mix(in srgb, #3b82f6 55%, transparent)" }}>
          <Head i="hand" c="#3b82f6" t="Pagado de su bolsillo por socios" sub="Cuenta como gasto y se les devuelve en la liquidación." />
          {adelantos.map(([sid, v]) => { const s = socioById(sid); return (
            <div key={sid} style={C.row}><span style={{ display: "flex", alignItems: "center", gap: 10 }}><Avatar nombre={s?.nombre} c={s?.color} s={30} /><b>{s?.nombre || "Socio"}</b></span><b style={{ color: "#60a5fa", fontSize: 17 }}>{money(v)}</b></div>); })}
        </section>
      )}

      {copiar && (
        <Sheet title="Copiar presupuesto de otro evento" onClose={() => setCopiar(false)}>
          <div style={{ fontSize: 13.5, color: "var(--muted)", marginBottom: 12 }}>Se copian los gastos como previstos, sin importes reales, pagos ni fechas. Lo que ya tengas aquí no se borra.</div>
          {otrosEventos.map(e => <button key={e.id} disabled={busy} onClick={async () => { const ok = await onCopiar(e); if (ok) setCopiar(false); }} style={C.listBtn}><Tile n="calendar" s={34} /><span style={{ flex: 1 }}><b style={{ display: "block" }}>{e.name}</b><span style={{ fontSize: 12, color: "var(--muted)" }}>{e.date ? fechaCorta(e.date) + " " + e.date.slice(0, 4) : "Sin fecha"}</span></span><Icon n="right" s={18} c="var(--muted)" /></button>)}
        </Sheet>
      )}

      {form && <GastoForm {...form} socios={socios.filter(s => s.activo || s.id === form.gasto?.pagadoPor)} usadas={gastos.map(g => g.categoria)} hijos={form.gasto?.id ? hijosDe(form.gasto.id).length : 0} busy={busy}
        onClose={() => setForm(null)}
        onSave={async (x) => { const ok = await onSave(x); if (ok) setForm(null); }}
        onDelete={async (x) => { const ok = await onDelete(x); if (ok) setForm(null); }} />}
    </div>
  );
}

/* ---------- Piezas ---------- */
const Barra = ({ t, v, max, c, i }) => (
  <div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 5 }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--muted)", fontWeight: 700 }}><Icon n={i} s={15} />{t}</span><b>{money(v)}</b></div>
    <div style={{ height: 12, borderRadius: 7, background: "var(--surface2)", overflow: "hidden" }}><div style={{ width: `${Math.max(0, v) / max * 100}%`, height: "100%", background: c, borderRadius: 7 }} /></div>
  </div>
);
const Mini = ({ l, v, c, sub }) => <div style={{ padding: "10px 12px", borderRadius: 12, background: "var(--surface2)", border: "1px solid var(--line)", minWidth: 0 }}><div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: .8 }}>{l}</div><div style={{ fontSize: 17, fontWeight: 900, color: c || "var(--text)", marginTop: 2, whiteSpace: "nowrap" }}>{v}</div>{sub && <div style={{ fontSize: 11, color: "var(--muted)" }}>{sub}</div>}</div>;
const Ley = ({ c, t, marca }) => <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: marca ? 2 : 12, height: marca ? 12 : 6, borderRadius: 2, background: c }} />{t}</span>;
const AddBtn = ({ i, t, sub, primary, onClick }) => (
  <button onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 10, padding: sub ? "12px 14px" : "12px 8px", borderRadius: 14, cursor: "pointer", textAlign: "left", justifyContent: sub ? "flex-start" : "center", minWidth: 0,
    border: primary ? "none" : "1px solid var(--line)", background: primary ? "var(--accent)" : "var(--surface)", color: primary ? "#fff" : "var(--text)" }}>
    <span style={{ width: 32, height: 32, borderRadius: 10, display: "grid", placeItems: "center", flexShrink: 0, background: primary ? "rgba(255,255,255,.2)" : "color-mix(in srgb, var(--accent) 16%, transparent)", color: primary ? "#fff" : "var(--accent)" }}><Icon n={i} s={17} w={2.2} /></span>
    <span style={{ minWidth: 0 }}><span style={{ display: "block", fontWeight: 900, fontSize: 14.5 }}>{t}</span>{sub && <span style={{ display: "block", fontSize: 11.5, opacity: .8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</span>}</span>
  </button>
);
function EstadoBadge({ g }) {
  const e = ESTADOS.find(x => x.k === g.estado) || ESTADOS[0];
  return <Badge c={e.k === "previsto" ? "var(--muted)" : e.c}><Icon n={e.i} s={11} w={2.4} />{e.t}</Badge>;
}
function Importe({ g }) {
  const dif = g.real != null && g.previsto != null ? r2(g.real - g.previsto) : 0;
  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
      <b style={{ fontSize: 15.5 }}>{money(importe(g))}</b>
      {Math.abs(dif) >= 0.01 ? <span style={{ fontSize: 11, fontWeight: 800, color: dif > 0 ? "var(--red)" : "var(--green)" }}>{dif > 0 ? "+" : "−"}{money(Math.abs(dif))} vs previsto</span> : <EstadoBadge g={g} />}
    </span>
  );
}
function Fila({ g, socioById, onClick }) {
  const ci = gcatInfo(g.categoria), s = g.pagadoPor ? socioById(g.pagadoPor) : null;
  const meta = g.tipo === "personal"
    ? `${g.personas ?? 0} × ${money(g.precioHora || 0)}/h × ${String(g.horas ?? 0).replace(".", ",")} h`
    : [g.proveedor, g.fecha ? fechaCorta(g.fecha) : null].filter(Boolean).join(" · ");
  return (
    <button onClick={onClick} style={C.listBtn}>
      <Tile n={g.tipo === "personal" ? "users" : ci.i} c={ci.c} s={34} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.concepto || g.categoria}</b>
        <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
          {meta && <span>{meta}</span>}
          {s && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#60a5fa", fontWeight: 800 }}><Avatar nombre={s.nombre} c={s.color} s={16} />pagó {s.nombre}</span>}
        </span>
      </span>
      <Importe g={g} />
    </button>
  );
}
function Artista({ a, hijos, total, socioById, onEdit, onAdd }) {
  return (
    <div style={{ borderTop: "1px solid var(--line)", padding: "4px 0 8px" }}>
      <Fila g={a} socioById={socioById} onClick={() => onEdit(a)} />
      <div style={{ marginLeft: 46, borderLeft: "2px solid var(--line)", paddingLeft: 10 }}>
        {hijos.map(h => { const hi = HIJOS.find(x => x.k === h.concepto) || HIJOS[4]; return (
          <button key={h.id} onClick={() => onEdit(h, a)} style={{ ...C.listBtn, borderTop: "none", padding: "7px 2px" }}>
            <Tile n={hi.i} c={hi.c} s={28} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700 }}>{h.concepto || "Gasto"}</span>
            <span style={{ fontSize: 14, fontWeight: 800 }}>{money(importe(h))}</span>
          </button>); })}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, paddingTop: 6, flexWrap: "wrap-reverse" }}>
          <button onClick={onAdd} style={C.btnSm}><Icon n="plus" s={14} w={2.4} />Añadir extra</button>
          <span style={{ fontSize: 13, color: "var(--muted)", whiteSpace: "nowrap", marginLeft: "auto" }}>Total artista <b style={{ color: "var(--text)", fontSize: 14.5 }}>{money(total)}</b></span>
        </div>
      </div>
    </div>
  );
}

/* ---------- Formulario de gasto (normal · personal · artista · extra de un artista) ---------- */
function GastoForm({ tipo, gasto, padre, socios, usadas, hijos, busy, onClose, onSave, onDelete }) {
  const isMobile = useIsMobile();
  const nuevo = !gasto.id;
  const esHijo = !!padre;
  const [f, setF] = useState(() => ({
    id: gasto.id, tipo, padreId: padre?.id || null,
    categoria: gasto.categoria || (tipo === "personal" ? "Personal" : tipo === "artista" || esHijo ? "Artistas" : "Producción técnica"),
    concepto: gasto.concepto || (esHijo ? "Transporte" : ""), proveedor: gasto.proveedor || "",
    previsto: numTxt(gasto.previsto), real: numTxt(gasto.real),
    personas: gasto.personas != null ? String(gasto.personas) : "", precioHora: numTxt(gasto.precioHora), horas: numTxt(gasto.horas),
    estado: gasto.estado || "previsto", pagadoPor: gasto.pagadoPor || null, fecha: gasto.fecha || "", nota: gasto.nota || "",
  }));
  const [otra, setOtra] = useState(false);
  const [otraCat, setOtraCat] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (p) => setF(x => ({ ...x, ...p }));
  const calcPersonal = r2((parseInt(f.personas, 10) || 0) * parseImporte(f.precioHora) * parseImporte(f.horas));
  const previstoNum = tipo === "personal" ? calcPersonal : (f.previsto === "" ? null : parseImporte(f.previsto));
  const realNum = f.real === "" ? null : parseImporte(f.real);
  const catFinal = otra ? otraCat.trim() : f.categoria;
  const valido = (tipo === "personal" ? (calcPersonal > 0 || realNum != null) : (previstoNum != null || realNum != null)) && (tipo !== "artista" || f.concepto.trim()) && !!catFinal;
  const extra = Array.from(new Set([...usadas, f.categoria])).filter(c => c && c !== CAJA_CAT && !GCATS.some(x => x.k === c));
  const items = [...GCATS.map(c => ({ k: c.k, i: c.i, c: c.c })), ...extra.map(k => ({ k, i: "dots", c: "#838aa0" })), { k: "__otra", t: "Nueva…", i: "plus", c: "var(--muted)" }];
  const titulo = tipo === "artista" ? (nuevo ? "Nuevo artista" : "Editar artista") : tipo === "personal" ? (nuevo ? "Nuevo puesto de personal" : "Editar personal") : esHijo ? `Gasto de ${padre.concepto || "artista"}` : (nuevo ? "Nuevo gasto" : "Editar gasto");
  const guardar = () => { if (!valido || busy) return; onSave({ ...f, categoria: esHijo || tipo === "artista" ? "Artistas" : catFinal, previsto: previstoNum, real: realNum, personas: tipo === "personal" ? f.personas : null, precioHora: tipo === "personal" ? parseImporte(f.precioHora) : null, horas: tipo === "personal" ? parseImporte(f.horas) : null }); };
  const cuenta = realNum != null ? realNum : previstoNum || 0;
  return (
    <Sheet title={titulo} onClose={onClose}
      footer={<div style={{ display: "flex", gap: 8 }}>
        {!nuevo && (confirmDel
          ? <><button onClick={() => onDelete(f)} style={{ ...C.btnGhost, color: "var(--red)", borderColor: "var(--red)" }}><Icon n="trash" s={16} />{hijos ? `Borrar (y ${hijos} más)` : "Sí, borrar"}</button><button onClick={() => setConfirmDel(false)} style={C.btnGhost}>No</button></>
          : <button onClick={() => setConfirmDel(true)} style={{ ...C.btnGhost, color: "var(--red)", padding: "0 14px" }} aria-label="Borrar"><Icon n="trash" s={18} /></button>)}
        <button disabled={!valido || busy} onClick={guardar} style={{ ...C.btnPrimary, flex: 1, minHeight: 52, fontSize: 16, opacity: valido && !busy ? 1 : .45 }}>{busy ? "Guardando…" : valido ? `Guardar ${money(cuenta)}` : tipo === "artista" && !f.concepto.trim() ? "Escribe el nombre" : "Escribe un importe"}</button>
      </div>}>
      {tipo === "normal" && !esHijo && (
        <Field l="Categoría">
          <IconGrid items={items} valor={otra ? "__otra" : f.categoria} onChange={(k) => { if (k === "__otra") setOtra(true); else { setOtra(false); set({ categoria: k }); } }} />
          {otra && <input autoFocus value={otraCat} maxLength={60} onChange={e => setOtraCat(e.target.value)} placeholder="Nombre de la categoría nueva" style={{ ...C.input, marginTop: 8 }} />}
        </Field>
      )}
      {tipo === "personal" && <Field l="Tipo"><Seg full valor={f.categoria} onChange={(k) => set({ categoria: k })} opciones={[{ k: "Personal", t: "Personal", i: "users" }, { k: "Técnicos", t: "Técnicos", i: "wrench" }]} /></Field>}
      {esHijo && <Field l="¿Qué es?"><IconGrid cols={isMobile ? 3 : 5} items={HIJOS} valor={f.concepto} onChange={(k) => set({ concepto: k })} /></Field>}

      {!esHijo && <Field l={tipo === "artista" ? "Nombre del artista" : tipo === "personal" ? "Puesto" : "Concepto"}>
        <input value={f.concepto} maxLength={160} onChange={e => set({ concepto: e.target.value })} placeholder={tipo === "artista" ? "Ej.: DJ invitado" : tipo === "personal" ? "Ej.: Camareros" : "Ej.: Equipo de sonido"} style={C.input} />
      </Field>}
      {tipo !== "personal" && !esHijo && <Field l={tipo === "artista" ? "Agencia o representante (opcional)" : "Proveedor (opcional)"}><input value={f.proveedor} maxLength={120} onChange={e => set({ proveedor: e.target.value })} style={C.input} /></Field>}

      {tipo === "personal" && (
        <div style={{ background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 14, padding: 12, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto 1fr", gap: 6, alignItems: "end" }}>
            <NumBox l="Personas" v={f.personas} onChange={(v) => set({ personas: v.replace(/\D/g, "").slice(0, 4) })} ph="0" />
            <span style={{ paddingBottom: 12, color: "var(--muted)", fontWeight: 900 }}>×</span>
            <NumBox l="€ / hora" v={f.precioHora} onChange={(v) => set({ precioHora: cleanNum(v, 8) })} ph="0,00" />
            <span style={{ paddingBottom: 12, color: "var(--muted)", fontWeight: 900 }}>×</span>
            <NumBox l="Horas" v={f.horas} onChange={(v) => set({ horas: cleanNum(v, 6) })} ph="0" />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
            <span style={{ color: "var(--muted)", fontWeight: 700 }}>Coste previsto</span>
            <b style={{ fontSize: 26, color: calcPersonal > 0 ? "var(--green)" : "var(--muted)" }}>{money(calcPersonal)}</b>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: tipo === "personal" ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 6 }}>
        {tipo !== "personal" && <Field l={tipo === "artista" ? "Caché previsto" : "Previsto"} mb={0}><MoneyInput value={f.previsto} onChange={(v) => set({ previsto: v })} /></Field>}
        <Field l={tipo === "personal" ? "Coste real (si ya lo sabes)" : "Real"} mb={0}><MoneyInput value={f.real} onChange={(v) => set({ real: v })} /></Field>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 16 }}>Para el beneficio cuenta el real; mientras no lo haya, el previsto.</div>

      <Field l="Estado"><Seg full valor={f.estado} onChange={(k) => set({ estado: k })} opciones={ESTADOS.map(e => ({ k: e.k, t: e.t, i: e.i, c: e.c, ink: e.ink }))} /></Field>
      <Field l="¿Quién lo paga?">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <Pill on={!f.pagadoPor} onClick={() => set({ pagadoPor: null })}><Icon n="building" s={16} />Empresa</Pill>
          {socios.map(s => <Pill key={s.id} on={f.pagadoPor === s.id} c="#3b82f6" onClick={() => set({ pagadoPor: s.id })}><Avatar nombre={s.nombre} c={s.color} s={22} />{s.nombre}</Pill>)}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>{socios.length ? "Si lo paga un socio de su bolsillo, se le devuelve en la liquidación." : "Añade socios en la pestaña Socios para indicar si alguno lo adelanta."}</div>
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1.6fr", gap: 12 }}>
        <Field l="Fecha (opcional)" mb={4}><input type="date" value={f.fecha} onChange={e => set({ fecha: e.target.value })} style={C.input} /></Field>
        <Field l="Nota (opcional)" mb={4}><input value={f.nota} maxLength={500} onChange={e => set({ nota: e.target.value })} style={C.input} /></Field>
      </div>
    </Sheet>
  );
}
const NumBox = ({ l, v, onChange, ph }) => <div><div style={{ ...C.label, textAlign: "center" }}>{l}</div><input inputMode="decimal" value={v} onChange={e => onChange(e.target.value)} placeholder={ph} style={{ ...C.input, textAlign: "center", fontWeight: 900, fontSize: 18, padding: "10px 6px" }} /></div>;

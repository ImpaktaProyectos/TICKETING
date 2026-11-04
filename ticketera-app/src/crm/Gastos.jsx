// ===================== CRM · GASTOS (fase 2) =====================
// Presupuesto vivo: cada gasto tiene importe previsto y real, quién lo pagó y su estado.
// Los gastos de caja del TPV se muestran aquí en solo lectura (se registran en la barra).
import React, { useMemo, useState } from "react";
import { money, r2, hoy, fechaCorta, parseImporte, useIsMobile, Dot, C } from "./ui";

export const GCATS = [
  { k: "Espacio y permisos", ico: "🏟️" }, { k: "Artistas", ico: "🎤" }, { k: "Producción técnica", ico: "🎛️" },
  { k: "Técnicos", ico: "🧑‍🔧" }, { k: "Personal", ico: "👥" }, { k: "Barra y producto", ico: "🍾" },
  { k: "Marketing", ico: "📣" }, { k: "Servicios", ico: "🚻" }, { k: "Decoración y efectos", ico: "🎆" },
  { k: "Logística", ico: "🚚" }, { k: "Ticketing y pagos", ico: "💳" }, { k: "Administración", ico: "📑" },
  { k: "Imprevistos", ico: "⚠️" }, { k: "Otros", ico: "✨" },
];
const CAJA_CAT = "Gastos de caja (barras)";
export const gcatIco = (k) => k === CAJA_CAT ? "💸" : (GCATS.find(c => c.k === k) || { ico: "✨" }).ico;
const ESTADOS = [["previsto", "📝 Previsto"], ["confirmado", "🤝 Confirmado"], ["pagado", "✅ Pagado"]];
const HIJOS_ARTISTA = ["Transporte", "Alojamiento", "Dietas", "Hospitalidad (rider)", "Otros"];
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

export function Gastos({ ev, events, gastos, gastosCaja, socios, socioById, ingresosTotal, isMobile, busy, onSave, onDelete, onCopiar }) {
  const [form, setForm] = useState(null);      // { tipo, gasto, padre }
  const [filtro, setFiltro] = useState(null);  // categoría
  const [copiar, setCopiar] = useState(false);
  const G = useMemo(() => totalesGastos(ev, gastos, gastosCaja), [ev, gastos, gastosCaja]);
  const top = gastos.filter(g => !g.padreId);
  const artistas = top.filter(g => g.tipo === "artista");
  const personal = top.filter(g => g.tipo === "personal");
  const otros = top.filter(g => g.tipo === "normal" && (!filtro || g.categoria === filtro));
  const hijosDe = (id) => gastos.filter(g => g.padreId === id);
  const beneficio = r2(ingresosTotal - G.total);
  const cats = Object.entries(G.porCat).sort((a, b) => b[1].total - a[1].total);
  const maxCat = Math.max(1, ...cats.map(([, v]) => Math.max(v.total, v.previsto)));
  const otrosEventos = events.filter(e => e.id !== ev.id);
  const adelantos = Object.entries(G.pagadoSocio).filter(([, v]) => v > 0);

  return (
    <div>
      {/* Resultado y cifras clave */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1.3fr 1fr", gap: 12, marginBottom: 14 }}>
        <div style={{ ...C.hero, padding: isMobile ? 16 : 22 }}>
          <div style={C.label}>Beneficio estimado de {ev.name}</div>
          <div style={{ fontSize: isMobile ? 38 : 46, fontWeight: 900, letterSpacing: "-.02em", lineHeight: 1.05, margin: "4px 0 8px", color: beneficio >= 0 ? "var(--green)" : "var(--red)" }}>{money(beneficio)}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span style={C.tag}>💶 Ingresos {money(ingresosTotal)}</span>
            <span style={C.tag}>🧾 Gastos {money(G.total)}</span>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>Cada gasto cuenta por su importe real; si aún no lo tiene, por el previsto.</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Kpi l="Presupuesto previsto" v={money(G.previsto)} />
          <Kpi l="Gastado (real)" v={money(G.real)} c={G.previsto && G.real > G.previsto ? "var(--red)" : undefined} sub={G.previsto ? `${Math.round(G.real / G.previsto * 100)}% del previsto` : null} />
          <Kpi l="Pendiente de pagar" v={money(G.pendiente)} c={G.pendiente ? "var(--amber)" : undefined} />
          <Kpi l="Caja de barras" v={money(G.cajaTotal)} sub="sacado con el botón Caja" />
        </div>
      </div>

      {/* Añadir */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, auto) 1fr", gap: 8, marginBottom: 14, alignItems: "center" }}>
        <button onClick={() => setForm({ tipo: "normal", gasto: {} })} style={C.primary}>＋ Gasto</button>
        <button onClick={() => setForm({ tipo: "personal", gasto: {} })} style={C.ghost}>👥 ＋ Personal</button>
        <button onClick={() => setForm({ tipo: "artista", gasto: {} })} style={C.ghost}>🎤 ＋ Artista</button>
        {otrosEventos.length > 0 && <button onClick={() => setCopiar(v => !v)} style={C.ghost}>📋 Copiar presupuesto</button>}
      </div>
      {copiar && (
        <div style={{ ...C.panel, marginBottom: 14 }}>
          <div style={{ fontWeight: 900, marginBottom: 4 }}>📋 Copiar el presupuesto de otro evento</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>Se copian los gastos como previstos (sin importes reales, pagos ni fechas). Lo que ya tengas aquí no se borra.</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {otrosEventos.map(e => <button key={e.id} disabled={busy} onClick={async () => { const ok = await onCopiar(e); if (ok) setCopiar(false); }} style={C.seg}>{e.name}{e.date ? ` · ${fechaCorta(e.date)}` : ""}</button>)}
          </div>
        </div>
      )}

      {/* Por categoría */}
      <div style={{ ...C.panel, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
          <div style={{ fontWeight: 900 }}>📊 En qué se va el dinero</div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", display: "flex", gap: 10 }}><span><Bar c="rgba(255,255,255,.22)" w={14} /> previsto</span><span><Bar c="var(--accent)" w={14} /> cuenta</span></div>
        </div>
        {cats.length === 0 && <div style={C.empty}>Aún no hay gastos. Empieza con <b>＋ Gasto</b>, <b>＋ Personal</b> o <b>＋ Artista</b>{otrosEventos.length ? <>, o copia el presupuesto de otro evento</> : null}.</div>}
        {cats.map(([k, v]) => (
          <button key={k} onClick={() => setFiltro(filtro === k ? null : k)} style={{ ...C.ingRow, flexWrap: "wrap", background: filtro === k ? "rgba(255,90,60,.08)" : "transparent" }}>
            <span style={{ width: isMobile ? "100%" : 220, display: "flex", alignItems: "center", gap: 8, fontWeight: 800, textAlign: "left" }}><span style={{ fontSize: 18 }}>{gcatIco(k)}</span>{k} <span style={{ color: "var(--muted)", fontWeight: 600, fontSize: 12 }}>· {v.n}</span></span>
            <span style={{ flex: 1, minWidth: 120, display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ height: 6, borderRadius: 4, background: "var(--surface2)", overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${v.previsto / maxCat * 100}%`, background: "rgba(255,255,255,.22)" }} /></span>
              <span style={{ height: 8, borderRadius: 4, background: "var(--surface2)", overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${v.total / maxCat * 100}%`, background: v.previsto && v.total > v.previsto + 0.005 ? "var(--red)" : "var(--accent)" }} /></span>
            </span>
            <b style={{ minWidth: 96, textAlign: "right" }}>{money(v.total)}</b>
          </button>
        ))}
        {filtro && <div style={{ marginTop: 8 }}><button onClick={() => setFiltro(null)} style={C.small}>✕ Quitar filtro «{filtro}»</button></div>}
      </div>

      {/* Artistas */}
      {artistas.length > 0 && (!filtro || filtro === "Artistas") && (
        <div style={{ ...C.panel, marginBottom: 14 }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>🎤 Artistas</div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill,minmax(300px,1fr))", gap: 10 }}>
            {artistas.map(a => { const hijos = hijosDe(a.id); const tot = r2(importe(a) + hijos.reduce((t, h) => t + importe(h), 0)); return (
              <div key={a.id} style={{ ...C.card, padding: 0, overflow: "hidden" }}>
                <button onClick={() => setForm({ tipo: "artista", gasto: a })} style={{ ...C.ingRow, borderTop: "none", padding: "12px 14px", background: "rgba(168,85,247,.08)" }}>
                  <span style={{ fontSize: 26 }}>🎤</span>
                  <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                    <span style={{ display: "block", fontWeight: 900, fontSize: 16 }}>{a.concepto || "Artista"}</span>
                    <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)" }}>{a.proveedor ? a.proveedor + " · " : ""}<EstadoTxt g={a} socioById={socioById} /></span>
                  </span>
                  <span style={{ textAlign: "right" }}><span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>Caché</span><b>{money(importe(a))}</b></span>
                </button>
                <div style={{ padding: "0 14px 12px" }}>
                  {hijos.map(h => <button key={h.id} onClick={() => setForm({ tipo: "normal", gasto: h, padre: a })} style={{ ...C.ingRow, padding: "8px 0" }}><span style={{ flex: 1, textAlign: "left", fontSize: 13.5 }}>{h.concepto || "Gasto"} <span style={{ color: "var(--muted)", fontSize: 11.5 }}>· <EstadoTxt g={h} socioById={socioById} /></span></span><b style={{ fontSize: 14 }}>{money(importe(h))}</b></button>)}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
                    <button onClick={() => setForm({ tipo: "normal", gasto: { categoria: "Artistas" }, padre: a })} style={C.small}>＋ Transporte, hotel, dietas…</button>
                    <span style={{ fontWeight: 900 }}>Total {money(tot)}</span>
                  </div>
                </div>
              </div>); })}
          </div>
        </div>
      )}

      {/* Personal */}
      {personal.length > 0 && (!filtro || personal.some(p => p.categoria === filtro)) && (
        <div style={{ ...C.panel, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
            <div style={{ fontWeight: 900 }}>👥 Personal</div>
            <b>{money(r2(personal.filter(p => !filtro || p.categoria === filtro).reduce((t, p) => t + importe(p), 0)))}</b>
          </div>
          {personal.filter(p => !filtro || p.categoria === filtro).map(p => (
            <button key={p.id} onClick={() => setForm({ tipo: "personal", gasto: p })} style={C.ingRow}>
              <span style={{ fontSize: 20 }}>{gcatIco(p.categoria)}</span>
              <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                <span style={{ display: "block", fontWeight: 800 }}>{p.concepto || p.categoria}</span>
                <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>{p.personas ?? 0} × {money(p.precioHora || 0)}/h × {numTxt(p.horas ?? 0)} h · <EstadoTxt g={p} socioById={socioById} /></span>
              </span>
              <Importes g={p} />
            </button>
          ))}
        </div>
      )}

      {/* Resto de gastos */}
      <div style={{ ...C.panel, marginBottom: 14 }}>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>🧾 {filtro ? filtro : "Gastos"}</div>
        {otros.length === 0 && <div style={{ ...C.empty, padding: "14px 12px" }}>{filtro ? "No hay más gastos en esta categoría." : "Sin gastos sueltos todavía."}</div>}
        {otros.map(g => (
          <button key={g.id} onClick={() => setForm({ tipo: "normal", gasto: g })} style={C.ingRow}>
            <span style={{ fontSize: 20 }}>{gcatIco(g.categoria)}</span>
            <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
              <span style={{ display: "block", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.concepto || g.categoria}</span>
              <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)" }}>{g.categoria}{g.proveedor ? ` · ${g.proveedor}` : ""}{g.fecha ? ` · ${fechaCorta(g.fecha)}` : ""} · <EstadoTxt g={g} socioById={socioById} /></span>
            </span>
            <Importes g={g} />
          </button>
        ))}
      </div>

      {/* Caja del TPV (solo lectura) */}
      {G.caja.length > 0 && (!filtro || filtro === CAJA_CAT) && (
        <div style={{ ...C.panel, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 2 }}>
            <div style={{ fontWeight: 900 }}>💸 Sacado de la caja de las barras</div><b>{money(G.cajaTotal)}</b>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>Se registra en el TPV con el botón Caja. Aquí solo se muestra (pagado con la caja del evento).</div>
          {G.caja.map(g => <div key={g.id} style={C.row}><span style={{ minWidth: 0 }}>{g.concepto || "Gasto"} <span style={{ color: "var(--muted)", fontSize: 12 }}>· 📍 {ev.puntos.find(p => p.id === g.puntoId)?.name || "Barra"}</span></span><b>{money(g.importe)}</b></div>)}
        </div>
      )}

      {/* Adelantado por socios */}
      {adelantos.length > 0 && (
        <div style={{ ...C.panel, borderColor: "rgba(59,130,246,.5)" }}>
          <div style={{ fontWeight: 900, marginBottom: 2 }}>🙋 Pagado de su bolsillo por socios</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>Cuenta como gasto del evento y se le devuelve en la liquidación.</div>
          {adelantos.map(([sid, v]) => { const s = socioById(sid); return <div key={sid} style={C.row}><span style={{ display: "flex", alignItems: "center", gap: 8 }}><Dot c={s?.color} /><b>{s?.nombre || "Socio"}</b> <span style={{ color: "var(--muted)" }}>ha adelantado</span></span><b style={{ color: "#60a5fa", fontSize: 16 }}>{money(v)}</b></div>; })}
        </div>
      )}

      {form && <GastoForm {...form} socios={socios.filter(s => s.activo || s.id === form.gasto?.pagadoPor)} usadas={gastos.map(g => g.categoria)} hijos={form.gasto?.id ? hijosDe(form.gasto.id).length : 0} busy={busy}
        onClose={() => setForm(null)}
        onSave={async (x) => { const ok = await onSave(x); if (ok) setForm(null); }}
        onDelete={async (x) => { const ok = await onDelete(x); if (ok) setForm(null); }} />}
    </div>
  );
}

const Kpi = ({ l, v, c, sub }) => <div style={C.card}><div style={C.label}>{l}</div><div style={{ fontSize: 20, fontWeight: 900, color: c || "var(--text)" }}>{v}</div>{sub && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}</div>;
const Bar = ({ c, w }) => <span style={{ display: "inline-block", width: w, height: 6, borderRadius: 3, background: c, verticalAlign: "middle" }} />;
function EstadoTxt({ g, socioById }) {
  const s = g.pagadoPor ? socioById(g.pagadoPor) : null;
  const est = g.estado === "pagado" ? "✅ pagado" : g.estado === "confirmado" ? "🤝 confirmado" : "📝 previsto";
  return <span><span style={{ color: g.estado === "pagado" ? "var(--green)" : g.estado === "confirmado" ? "var(--text)" : "var(--muted)", fontWeight: 700 }}>{est}</span>{s ? <span style={{ color: "#60a5fa", fontWeight: 800 }}> · pagó {s.nombre}</span> : null}</span>;
}
function Importes({ g }) {
  const dif = g.real != null && g.previsto != null ? r2(g.real - g.previsto) : 0;
  return (
    <span style={{ textAlign: "right", flexShrink: 0 }}>
      <b style={{ display: "block", fontSize: 16 }}>{money(importe(g))}</b>
      {g.real != null && g.previsto != null && Math.abs(dif) >= 0.01
        ? <span style={{ fontSize: 11, fontWeight: 800, color: dif > 0 ? "var(--red)" : "var(--green)" }}>{dif > 0 ? "+" : ""}{money(dif)} vs previsto</span>
        : <span style={{ fontSize: 11, color: "var(--muted)" }}>{g.real != null ? "real" : "previsto"}</span>}
    </span>
  );
}

/* ---------- Formulario de gasto (normal · personal · artista · gasto de un artista) ---------- */
function GastoForm({ tipo, gasto, padre, socios, usadas, hijos, busy, onClose, onSave, onDelete }) {
  const isMobile = useIsMobile();
  const nuevo = !gasto.id;
  const esHijo = !!padre;
  const [f, setF] = useState(() => ({
    id: gasto.id, tipo, padreId: padre?.id || null,
    categoria: gasto.categoria || (tipo === "personal" ? "Personal" : tipo === "artista" || esHijo ? "Artistas" : "Producción técnica"),
    concepto: gasto.concepto || "", proveedor: gasto.proveedor || "",
    previsto: numTxt(gasto.previsto), real: numTxt(gasto.real),
    personas: gasto.personas != null ? String(gasto.personas) : "", precioHora: numTxt(gasto.precioHora), horas: numTxt(gasto.horas),
    estado: gasto.estado || "previsto", pagadoPor: gasto.pagadoPor || null, fecha: gasto.fecha || "", nota: gasto.nota || "",
  }));
  const [otraCat, setOtraCat] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (p) => setF(x => ({ ...x, ...p }));
  const calcPersonal = r2((parseInt(f.personas, 10) || 0) * parseImporte(f.precioHora) * parseImporte(f.horas));
  const previstoNum = tipo === "personal" ? calcPersonal : (f.previsto === "" ? null : parseImporte(f.previsto));
  const realNum = f.real === "" ? null : parseImporte(f.real);
  const valido = (tipo === "personal" ? (calcPersonal > 0 || realNum != null) : (previstoNum != null || realNum != null)) && (tipo !== "artista" || f.concepto.trim());
  const catList = Array.from(new Set([...GCATS.map(c => c.k), ...usadas.filter(u => u !== CAJA_CAT), ...(f.categoria ? [f.categoria] : [])]));
  const titulo = tipo === "artista" ? (nuevo ? "🎤 Nuevo artista" : "🎤 Editar artista") : tipo === "personal" ? (nuevo ? "👥 Nuevo puesto de personal" : "👥 Editar personal") : esHijo ? `🎤 Gasto de ${padre.concepto || "artista"}` : (nuevo ? "＋ Nuevo gasto" : "Editar gasto");
  const guardar = () => { if (!valido || busy) return; onSave({ ...f, categoria: esHijo || tipo === "artista" ? "Artistas" : (otraCat.trim() || f.categoria), previsto: previstoNum, real: realNum, personas: tipo === "personal" ? f.personas : null, precioHora: tipo === "personal" ? parseImporte(f.precioHora) : null, horas: tipo === "personal" ? parseImporte(f.horas) : null }); };
  const Num = ({ label, k, ph, big }) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={C.label}>{label}</div>
      <div style={{ position: "relative" }}>
        <input inputMode="decimal" value={f[k]} onChange={e => set({ [k]: cleanNum(e.target.value) })} placeholder={ph || "0,00"} style={{ ...C.input, fontSize: big ? 24 : 17, fontWeight: 900, textAlign: "right", paddingRight: 34 }} />
        <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontWeight: 900, color: "var(--muted)" }}>€</span>
      </div>
    </div>
  );
  return (
    <div style={C.modalWrap} onClick={onClose}>
      <div style={{ ...C.modal, ...(isMobile ? { borderRadius: "22px 22px 0 0", maxHeight: "94dvh", alignSelf: "flex-end" } : {}) }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontWeight: 900, fontSize: 19 }}>{titulo}</div>
          <button onClick={onClose} style={C.small} aria-label="Cerrar">✕</button>
        </div>

        {tipo === "normal" && !esHijo && (<>
          <div style={C.label}>Categoría</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {catList.map(c => <button key={c} onClick={() => { set({ categoria: c }); setOtraCat(""); }} style={{ ...C.seg, ...(f.categoria === c && !otraCat ? C.segOn : {}) }}>{gcatIco(c)} {c}</button>)}
          </div>
          <input value={otraCat} maxLength={60} onChange={e => setOtraCat(e.target.value)} placeholder="O escribe una categoría nueva" style={{ ...C.input, marginBottom: 14 }} />
        </>)}
        {tipo === "personal" && (<>
          <div style={C.label}>Tipo</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {["Personal", "Técnicos"].map(c => <button key={c} onClick={() => set({ categoria: c })} style={{ ...C.seg, ...(f.categoria === c ? C.segOn : {}) }}>{gcatIco(c)} {c}</button>)}
          </div>
        </>)}
        {esHijo && (<>
          <div style={C.label}>¿Qué es?</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
            {HIJOS_ARTISTA.map(c => <button key={c} onClick={() => set({ concepto: c })} style={{ ...C.seg, ...(f.concepto === c ? C.segOn : {}) }}>{c}</button>)}
          </div>
        </>)}

        <div style={C.label}>{tipo === "artista" ? "Nombre del artista" : tipo === "personal" ? "Puesto" : "Concepto"}</div>
        <input value={f.concepto} maxLength={160} onChange={e => set({ concepto: e.target.value })} placeholder={tipo === "artista" ? "Ej.: DJ invitado" : tipo === "personal" ? "Ej.: Camareros" : "Ej.: Equipo de sonido"} style={{ ...C.input, marginBottom: 14 }} />

        {tipo !== "personal" && (<>
          <div style={C.label}>{tipo === "artista" ? "Agencia o representante (opcional)" : "Proveedor (opcional)"}</div>
          <input value={f.proveedor} maxLength={120} onChange={e => set({ proveedor: e.target.value })} style={{ ...C.input, marginBottom: 14 }} />
        </>)}

        {tipo === "personal" && (
          <div style={{ background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 14, padding: 12, marginBottom: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div><div style={C.label}>Personas</div><input inputMode="numeric" value={f.personas} onChange={e => set({ personas: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="0" style={{ ...C.input, textAlign: "center", fontWeight: 900, fontSize: 18 }} /></div>
              <div><div style={C.label}>€ / hora</div><input inputMode="decimal" value={f.precioHora} onChange={e => set({ precioHora: cleanNum(e.target.value, 8) })} placeholder="0,00" style={{ ...C.input, textAlign: "center", fontWeight: 900, fontSize: 18 }} /></div>
              <div><div style={C.label}>Horas</div><input inputMode="decimal" value={f.horas} onChange={e => set({ horas: cleanNum(e.target.value, 6) })} placeholder="0" style={{ ...C.input, textAlign: "center", fontWeight: 900, fontSize: 18 }} /></div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 10 }}>
              <span style={{ color: "var(--muted)", fontWeight: 700 }}>Coste previsto</span>
              <b style={{ fontSize: 24, color: calcPersonal > 0 ? "var(--green)" : "var(--muted)" }}>{money(calcPersonal)}</b>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginBottom: 4, flexWrap: isMobile ? "wrap" : "nowrap" }}>
          {tipo !== "personal" && Num({ label: tipo === "artista" ? "Caché previsto" : "Previsto", k: "previsto", big: true })}
          {Num({ label: tipo === "personal" ? "Coste real (si ya lo sabes)" : "Real (cuando se sepa)", k: "real", big: tipo !== "personal" })}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 14 }}>Para el beneficio cuenta el real; mientras no lo haya, el previsto.</div>

        <div style={C.label}>Estado</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
          {ESTADOS.map(([k, l]) => <button key={k} onClick={() => set({ estado: k })} style={{ ...C.seg, flex: 1, justifyContent: "center", ...(f.estado === k ? C.segOn : {}) }}>{l}</button>)}
        </div>

        <div style={C.label}>¿Quién lo paga?</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: socios.length ? 14 : 6 }}>
          <button onClick={() => set({ pagadoPor: null })} style={{ ...C.seg, ...(!f.pagadoPor ? C.segOn : {}) }}>🏢 Empresa</button>
          {socios.map(s => <button key={s.id} onClick={() => set({ pagadoPor: s.id })} style={{ ...C.seg, ...(f.pagadoPor === s.id ? { ...C.segOn, background: "#3b82f6", borderColor: "#3b82f6" } : {}) }}><Dot c={s.color} /> {s.nombre} (de su bolsillo)</button>)}
        </div>
        {socios.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14 }}>Añade socios en la pestaña Socios para indicar si alguno lo adelanta.</div>}

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 2fr", gap: 10, marginBottom: 16 }}>
          <div><div style={C.label}>Fecha (opcional)</div><input type="date" value={f.fecha} onChange={e => set({ fecha: e.target.value })} style={C.input} /></div>
          <div><div style={C.label}>Nota (opcional)</div><input value={f.nota} maxLength={500} onChange={e => set({ nota: e.target.value })} style={C.input} /></div>
        </div>

        <button disabled={!valido || busy} onClick={guardar} style={{ ...C.primary, width: "100%", padding: 16, fontSize: 16, opacity: valido && !busy ? 1 : .45 }}>{busy ? "Guardando…" : valido ? `Guardar ${money(realNum != null ? realNum : previstoNum || 0)}` : tipo === "artista" && !f.concepto.trim() ? "Escribe el nombre del artista" : "Escribe un importe"}</button>
        {!nuevo && (confirmDel
          ? <div style={{ display: "flex", gap: 8, marginTop: 8 }}><button onClick={() => onDelete(f)} style={{ ...C.ghost, flex: 1, color: "var(--red)", borderColor: "var(--red)" }}>✓ Sí, borrar{hijos ? ` (y sus ${hijos} gastos)` : ""}</button><button onClick={() => setConfirmDel(false)} style={{ ...C.ghost, flex: 1 }}>Cancelar</button></div>
          : <button onClick={() => setConfirmDel(true)} style={{ ...C.ghost, width: "100%", marginTop: 8, color: "var(--red)" }}>Borrar {tipo === "artista" ? "artista" : "gasto"}</button>)}
      </div>
    </div>
  );
}

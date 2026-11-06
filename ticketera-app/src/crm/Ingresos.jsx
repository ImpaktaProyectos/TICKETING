// ===================== CRM · INGRESOS =====================
// De un vistazo: total, de dónde viene, qué tienen los socios, ventas del TPV en directo y lo apuntado a mano.
import React, { useState } from "react";
import { money, r2, hoy, fechaCorta, parseImporte, useIsMobile, C, Icon, Tile, Avatar, Badge, Seg, Head, Sheet, Field, IconGrid, MoneyInput, Seccion, Grupo } from "./ui";
import { GRUPOS, catInfo, grupoInfo, catsIngreso, TICKETERA_CAT } from "./categorias";

const METODOS = [{ k: "efectivo", t: "Efectivo", tm: "Efectivo", i: "cash" }, { k: "transferencia", t: "Transferencia", tm: "Transf.", i: "bank" }, { k: "bizum", t: "Bizum", tm: "Bizum", i: "phone" }, { k: "tarjeta", t: "Tarjeta", tm: "Tarjeta", i: "card" }, { k: "otro", t: "Otro", tm: "Otro", i: "dots" }];
const metodo = (k) => METODOS.find(m => m.k === k) || METODOS[4];
const FUENTES_PUNTO = [["barra", "Barra"], ["entradas", "Entradas"], ["merch", "Merch"], ["otros", "Otros"]];

const haceTxt = (iso) => { if (!iso) return "nunca"; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? "ahora mismo" : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }); };
export const esExterno = (i) => i.origen === "api" || i.origen === "csv" || i.origen === "tixfast";   // tixfast = venta online propia

export function Ingresos({ ev, T, F, barras, ingresos: todos, socios, socioById, conexion, vinculo, sincronizando, onNuevo, onEditar, onFuente, onEntregar, onSync, onImportar, onAjustes }) {
  const isMobile = useIsMobile();
  const [filtro, setFiltro] = useState("todos");
  const [cat, setCat] = useState("");
  const externos = todos.filter(esExterno);
  const ingresos = todos.filter(i => !esExterno(i));
  const totalExt = r2(externos.reduce((t, i) => t + i.importe, 0));
  const udsExt = externos.reduce((t, i) => t + (i.unidades || 0), 0);
  const cats = Array.from(new Set(ingresos.map(i => i.categoria)));
  const lista = ingresos.filter(i => (filtro === "todos" ? true : filtro === "socios" ? (i.cobradoPor && !i.entregado) : i.estado === "pendiente") && (!cat || i.categoria === cat));
  const grupos = GRUPOS.map(g => ({ ...g, v: T.porGrupo[g.k] || 0 }));
  const conValor = grupos.filter(g => g.v > 0);
  const enSocios = Object.entries(T.enSocios).filter(([, v]) => v > 0);
  const nPend = ingresos.filter(i => i.estado === "pendiente").length;
  const nSoc = ingresos.filter(i => i.cobradoPor && !i.entregado).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ===== Resumen ===== */}
      <section style={{ ...C.hero, padding: isMobile ? 16 : 22 }}>
        <div style={C.label}>Ingresos de {ev.name}</div>
        <div style={{ fontSize: isMobile ? 38 : 50, fontWeight: 900, letterSpacing: "-.02em", lineHeight: 1.05, margin: "4px 0 14px" }}>{money(T.total)}</div>
        <div style={{ display: "flex", height: 12, borderRadius: 8, overflow: "hidden", background: "var(--surface2)", marginBottom: 14 }}>
          {conValor.map(g => <div key={g.k} title={`${g.t}: ${money(g.v)}`} style={{ width: `${g.v / Math.max(T.total, 0.01) * 100}%`, background: g.c }} />)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(5,minmax(0,1fr))", gap: 8 }}>
          {grupos.map(g => (
            <div key={g.k} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 12, background: "var(--surface2)", border: "1px solid var(--line)", opacity: g.v > 0 ? 1 : .5, minWidth: 0 }}>
              <Tile n={g.i} c={g.c} s={32} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.t}</div>
                <div style={{ fontWeight: 900, fontSize: 15, whiteSpace: "nowrap" }}>{money(g.v)}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <Stat i="pos" t="TPV en directo" v={money(T.tpv)} />
          {T.ticketera > 0 && <Stat i="globe" t="Ticketera online" v={money(T.ticketera)} />}
          <Stat i="edit" t="Apuntado a mano" v={money(T.manual)} />
          {T.pendiente > 0 && <Stat i="clock" t="Pendiente de cobrar" v={money(T.pendiente)} c="var(--amber)" />}
          {F?.comisionTotal > 0 && <Stat i="percent" t="Comisiones" v={"−" + money(F.comisionTotal)} c="var(--rose)" />}
          {F?.iva?.activo && <Stat i="bank" t="IVA incluido en ventas" v={money(F.iva.repercutido)} />}
        </div>
      </section>

      {/* ===== Dinero en manos de socios ===== */}
      {enSocios.length > 0 && (
        <Seccion id="ing-socios" i="wallet" c="var(--amber)" aviso="var(--amber)" t="En manos de socios" sub="Ya cuenta como ingreso. Márcalo cuando lo entreguen a la caja."
          total={money(enSocios.reduce((t, [, v]) => t + v, 0))} totalColor="var(--amber)">
          {enSocios.map(([sid, v]) => { const s = socioById(sid); return (
            <div key={sid} style={C.row}>
              <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}><Avatar nombre={s?.nombre} c={s?.color} s={30} /><b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s?.nombre || "Socio"}</b></span>
              <span style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                <b style={{ color: "var(--amber)", fontSize: 17 }}>{money(v)}</b>
                <button onClick={() => onEntregar(sid)} style={C.btnSm}><Icon n="check" s={15} />Entregado</button>
              </span>
            </div>); })}
        </Seccion>
      )}

      {/* ===== Ventas del TPV ===== */}
      <Seccion id="ing-tpv" i="pos" t="Ventas del TPV" sub="En directo. Las invitaciones no cuentan." total={money(T.tpv)}>
        {barras.length === 0 && <Vacio i="store" t="Este evento no tiene barras." />}
        {barras.map(b => { const g = grupoInfo(b.fuente); return (
          <div key={b.punto.id} style={{ ...C.row, alignItems: isMobile ? "flex-start" : "center" }}>
            <Tile n={g.i} c={g.c} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.punto.name}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", gap: 10, flexWrap: "wrap", marginTop: 2 }}>
                <span>{b.tickets} tickets</span>
                {(b.efectivo > 0 || b.tarjeta > 0) && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon n="cash" s={13} />{money(b.efectivo)}</span>}
                {(b.efectivo > 0 || b.tarjeta > 0) && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon n="card" s={13} />{money(b.tarjeta)}</span>}
                {b.invitaciones > 0 && <span>{b.invitaciones} invitaciones</span>}
              </div>
              {isMobile && <div style={{ marginTop: 8 }}><TipoSelect value={b.fuente} onChange={(f) => onFuente(b.punto.id, f)} /></div>}
            </div>
            {!isMobile && <TipoSelect value={b.fuente} onChange={(f) => onFuente(b.punto.id, f)} />}
            <b style={{ minWidth: 96, textAlign: "right", fontSize: 16, flexShrink: 0 }}>{money(b.total)}</b>
          </div>); })}
      </Seccion>

      {/* ===== Ticketera online ===== */}
      <Seccion id="ing-online" i="globe" c="#a855f7" t="Ticketera online"
          sub={vinculo ? `Fourvenues · ${vinculo.extNombre || vinculo.extId} · actualizado ${haceTxt(vinculo.ultimaSync)}` : "Las entradas vendidas online entran solas o desde un CSV."}
          total={money(totalExt)}>
        {vinculo?.error && <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--amber)", fontWeight: 700, fontSize: 13, marginBottom: 10 }}><Icon n="alert" s={16} />{vinculo.error}</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: externos.length ? 6 : 0 }}>
          {vinculo && conexion
            ? <button disabled={sincronizando} onClick={onSync} style={{ ...C.btnPrimary, opacity: sincronizando ? .6 : 1 }}><Icon n="refresh" s={16} w={2.2} />{sincronizando ? "Sincronizando…" : "Sincronizar ahora"}</button>
            : <button onClick={onAjustes} style={C.btnPrimary}><Icon n="link" s={16} w={2.2} />Conectar Fourvenues</button>}
          <button onClick={onImportar} style={C.btnGhost}><Icon n="upload" s={16} />Importar CSV</button>
        </div>
        {externos.map(i => (
          <div key={i.id} style={{ ...C.listBtn, cursor: "default" }}>
            <Tile n="ticket" c="#a855f7" />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.concepto}</span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{i.unidades != null ? `${i.unidades} entradas · ` : ""}{i.origen === "tixfast" ? "venta online TIXFAST · al momento" : i.origen === "api" ? "sincronizado" : "importado de CSV"}</span>
            </span>
            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
              <b style={{ fontSize: 16 }}>{money(i.importe)}</b>
              <Badge c="#a855f7"><Icon n="lock" s={11} w={2.2} />{i.origen === "tixfast" ? "TIXFAST" : i.origen === "api" ? "Automático" : "CSV"}</Badge>
            </span>
          </div>))}
        {externos.length > 0 && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>{udsExt} entradas. Importe sin gastos de gestión ni devoluciones.</div>}
      </Seccion>

      {/* ===== Otros ingresos (agrupados por categoría, cada una plegable) ===== */}
      <Seccion id="ing-otros" i="edit" t="Otros ingresos" sub="Entradas anticipadas, patrocinios, merch, subvenciones…"
          total={money(ingresos.reduce((t, i) => t + i.importe, 0))}
          acciones={<button onClick={onNuevo} style={{ ...C.btnPrimary, ...(isMobile ? { width: "100%" } : {}) }}><Icon n="plus" s={17} w={2.4} />Añadir ingreso</button>}>
        {ingresos.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
            <Seg size="sm" valor={filtro} onChange={setFiltro} opciones={[{ k: "todos", t: `Todos · ${ingresos.length}` }, { k: "pendientes", t: `Pendientes · ${nPend}`, c: "var(--amber)", ink: "#1a1205" }, { k: "socios", t: `En socios · ${nSoc}`, c: "var(--amber)", ink: "#1a1205" }]} />
            {cats.length > 1 && <select value={cat} onChange={e => setCat(e.target.value)} style={C.miniSelect} aria-label="Categoría"><option value="">Todas las categorías</option>{cats.map(c => <option key={c} value={c}>{c}</option>)}</select>}
          </div>
        )}
        {ingresos.length === 0 && <Vacio i="wallet" t="Aún no hay ingresos apuntados a mano." sub="Por ejemplo, las entradas que ha vendido un socio o un patrocinio." />}
        {ingresos.length > 0 && lista.length === 0 && <Vacio i="filter" t="Nada con este filtro." />}
        {Array.from(new Set(lista.map(i => i.categoria))).map(k => { const del = lista.filter(i => i.categoria === k), ck = catInfo(k); return (
          <Grupo key={k} id={"ing-cat-" + k} i={ck.i} c={ck.c} t={k} n={del.length} total={money(del.reduce((t, i) => t + i.importe, 0))}>
        {del.map(i => { const ci = catInfo(i.categoria), s = i.cobradoPor ? socioById(i.cobradoPor) : null, m = metodo(i.metodo); return (
          <button key={i.id} onClick={() => onEditar(i)} style={C.listBtn}>
            <Tile n={ci.i} c={ci.c} />
            <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
              <span style={{ display: "block", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.concepto || i.categoria}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted)", marginTop: 2, flexWrap: "wrap" }}>
                <span>{fechaCorta(i.fecha)}</span>{i.concepto && <span>{i.categoria}</span>}<span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Icon n={m.i} s={13} />{m.t}</span>
              </span>
            </span>
            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
              <b style={{ fontSize: 16, color: i.estado === "pendiente" ? "var(--amber)" : "var(--text)" }}>{money(i.importe)}</b>
              {i.estado === "pendiente" ? <Badge c="var(--amber)"><Icon n="clock" s={11} w={2.4} />Pendiente</Badge>
                : s ? (i.entregado ? <Badge c="var(--green)"><Icon n="check" s={11} w={2.6} />Entregado</Badge> : <Badge c="var(--amber)">Lo tiene {s.nombre}</Badge>)
                : <Badge>Empresa</Badge>}
            </span>
          </button>); })}
          </Grupo>); })}
      </Seccion>
    </div>
  );
}

const Stat = ({ i, t, v, c }) => <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: c || "var(--muted)", padding: "5px 10px", borderRadius: 20, border: "1px solid var(--line)", background: "var(--surface2)" }}><Icon n={i} s={14} />{t} <b style={{ color: c || "var(--text)" }}>{v}</b></span>;
const TipoSelect = ({ value, onChange }) => (
  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)", fontWeight: 700, flexShrink: 0 }}>Cuenta como
    <select value={value} onChange={e => onChange(e.target.value)} style={C.miniSelect}>{FUENTES_PUNTO.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
  </label>
);
export const Vacio = ({ i, t, sub }) => (
  <div style={{ textAlign: "center", padding: "22px 12px", color: "var(--muted)", border: "2px dashed var(--line)", borderRadius: 14 }}>
    <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}><Tile n={i} c="var(--muted)" s={40} /></div>
    <div style={{ fontWeight: 800, color: "var(--text)", fontSize: 14 }}>{t}</div>{sub && <div style={{ fontSize: 12.5, marginTop: 3 }}>{sub}</div>}
  </div>
);

/* ---------- Formulario de ingreso ---------- */
export function IngresoForm({ ingreso, socios, usadas, busy, onClose, onSave, onDelete }) {
  const isMobile = useIsMobile();
  const nuevo = !ingreso.id;
  const [f, setF] = useState(() => ({
    id: ingreso.id, importe: ingreso.importe ? String(ingreso.importe).replace(".", ",") : "", categoria: ingreso.categoria || (catsIngreso(true)[0]?.k || "Entradas anticipadas"),
    concepto: ingreso.concepto || "", cobradoPor: ingreso.cobradoPor || null, entregado: !!ingreso.entregado, estado: ingreso.estado || "cobrado",
    metodo: ingreso.metodo || "efectivo", fecha: ingreso.fecha || hoy(), nota: ingreso.nota || "",
  }));
  const [otra, setOtra] = useState(false);
  const [otraCat, setOtraCat] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (p) => setF(x => ({ ...x, ...p }));
  const imp = parseImporte(f.importe);
  const visibles = catsIngreso(true);
  const extra = Array.from(new Set([...usadas, f.categoria])).filter(c => c && !visibles.some(x => x.k === c));
  const items = [...visibles.map(c => ({ k: c.k, i: c.i, c: c.c })), ...extra.map(k => { const c = catInfo(k); return { k, i: c.i, c: c.c }; }), { k: "__otra", t: "Nueva…", i: "plus", c: "var(--muted)" }];
  const catFinal = otra ? otraCat.trim() : f.categoria;
  const ok = imp > 0 && !!catFinal;
  const guardar = () => { if (!ok || busy) return; onSave({ ...f, importe: imp, categoria: catFinal }); };
  return (
    <Sheet title={nuevo ? "Nuevo ingreso" : "Editar ingreso"} onClose={onClose}
      footer={<div style={{ display: "flex", gap: 8 }}>
        {!nuevo && (confirmDel
          ? <><button onClick={() => onDelete(f)} style={{ ...C.btnGhost, color: "var(--red)", borderColor: "var(--red)" }}><Icon n="trash" s={16} />Sí, borrar</button><button onClick={() => setConfirmDel(false)} style={C.btnGhost}>No</button></>
          : <button onClick={() => setConfirmDel(true)} style={{ ...C.btnGhost, color: "var(--red)", padding: "0 14px" }} aria-label="Borrar"><Icon n="trash" s={18} /></button>)}
        <button disabled={!ok || busy} onClick={guardar} style={{ ...C.btnPrimary, flex: 1, minHeight: 52, fontSize: 16, opacity: ok && !busy ? 1 : .45 }}>{busy ? "Guardando…" : imp > 0 ? `Guardar ${money(imp)}` : "Escribe el importe"}</button>
      </div>}>
      <Field l="Importe"><MoneyInput big autoFocus={nuevo} value={f.importe} onChange={(v) => set({ importe: v })} color={imp > 0 ? "var(--green)" : undefined} /></Field>
      <Field l="Categoría">
        <IconGrid items={items} valor={otra ? "__otra" : f.categoria} onChange={(k) => { if (k === "__otra") setOtra(true); else { setOtra(false); set({ categoria: k }); } }} />
        {otra && <input autoFocus value={otraCat} maxLength={60} onChange={e => setOtraCat(e.target.value)} placeholder="Nombre de la categoría nueva" style={{ ...C.input, marginTop: 8 }} />}
      </Field>
      <Field l="Concepto (opcional)"><input value={f.concepto} maxLength={160} onChange={e => set({ concepto: e.target.value })} placeholder="Ej.: 20 entradas anticipadas" style={C.input} /></Field>
      <Field l="¿Quién tiene el dinero?">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <Pill on={!f.cobradoPor} onClick={() => set({ cobradoPor: null, entregado: false })}><Icon n="building" s={16} />Empresa</Pill>
          {socios.map(s => <Pill key={s.id} on={f.cobradoPor === s.id} c="var(--amber)" onClick={() => set({ cobradoPor: s.id })}><Avatar nombre={s.nombre} c={s.color} s={22} />{s.nombre}</Pill>)}
        </div>
        {socios.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Añade socios en la pestaña Socios para poder elegirlos.</div>}
        {f.cobradoPor && <label style={{ ...C.toggleRow, marginTop: 10 }}><span>Ya lo ha entregado a la caja</span><Switch on={f.entregado} onClick={() => set({ entregado: !f.entregado })} /></label>}
      </Field>
      <Field l="Estado"><Seg full valor={f.estado} onChange={(k) => set({ estado: k })} opciones={[{ k: "cobrado", t: "Cobrado", i: "check", c: "var(--green)", ink: "#04241b" }, { k: "pendiente", t: "Pendiente", i: "clock", c: "var(--amber)", ink: "#1a1205" }]} /></Field>
      <Field l="Forma de cobro"><Seg full size="sm" valor={f.metodo} onChange={(k) => set({ metodo: k })} opciones={METODOS.map(m => ({ k: m.k, t: isMobile ? m.tm : m.t, i: m.i }))} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1.6fr", gap: 12 }}>
        <Field l="Fecha" mb={4}><input type="date" value={f.fecha} onChange={e => set({ fecha: e.target.value || hoy() })} style={C.input} /></Field>
        <Field l="Nota (opcional)" mb={4}><input value={f.nota} maxLength={500} onChange={e => set({ nota: e.target.value })} style={C.input} /></Field>
      </div>
    </Sheet>
  );
}
export const Pill = ({ on, onClick, children, c = "var(--accent)" }) => (
  <button type="button" onClick={onClick} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 12px 7px 9px", borderRadius: 22, cursor: "pointer", fontWeight: 800, fontSize: 13.5,
    border: `2px solid ${on ? c : "var(--line)"}`, background: on ? `color-mix(in srgb, ${c} 14%, var(--surface2))` : "var(--surface2)", color: "var(--text)" }}>{children}{on && <Icon n="check" s={14} w={2.6} c={c} />}</button>
);
export const Switch = ({ on, onClick }) => <button type="button" onClick={onClick} style={{ ...C.switch, background: on ? "var(--green)" : "var(--line)" }}><span style={{ ...C.knob, transform: on ? "translateX(22px)" : "translateX(2px)" }} /></button>;

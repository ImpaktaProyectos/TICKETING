// ===================== CRM · DINERO DE ENTRADAS =====================
// Todo lo que se ha ingresado por entradas, venga de donde venga: TIXFAST online, Fourvenues, otras ticketeras
// (CSV o apuntadas a mano con nº de entradas), venta en mano y la taquilla del TPV.
// Cuenta lo mismo que el grupo «Entradas» del resumen de ingresos (misma regla: categoría de grupo entradas + barras de tipo Entradas).
import React, { useState } from "react";
import { money, r2, hoy, parseImporte, useIsMobile, C, Icon, Tile, Badge, Avatar, Sheet, Field, MoneyInput, Seg } from "./ui";
import { catInfo, OTRAS_CAT } from "./categorias";

const n0 = (v) => new Intl.NumberFormat("es-ES").format(Math.round(v || 0));
export const CANALES = ["Entradium", "Eventbrite", "Wegow", "Xceed", "Dice", "Ticketmaster", "Venta en mano", "RRPP", "Taquilla física"];
const COLOR = { tixfast: "#ff5a3c", fourvenues: "#a855f7", tpv: "#ffb400", csv: "#3b82f6", manual: "#22d3a6" };
const PALETA = ["#22d3a6", "#ec4899", "#14b8a6", "#6366f1", "#eab308", "#0ea5e9", "#f97316", "#84cc16"];

// Agrupa todo el dinero de entradas por canal
export function canalesEntradas(ingresos, barras) {
  const m = new Map();
  const add = (k, base, i) => {
    const c = m.get(k) || { k, ...base, uds: 0, importe: 0, pendiente: 0, items: [], udsSabidas: true };
    c.importe = r2(c.importe + (i.importe || 0));
    if (i.estado === "pendiente") c.pendiente = r2(c.pendiente + i.importe);
    if (i.unidades != null) c.uds += i.unidades; else c.udsSabidas = false;
    if (i.id) c.items.push(i);
    m.set(k, c);
  };
  (ingresos || []).filter(i => catInfo(i.categoria).g === "entradas").forEach(i => {
    if (i.origen === "tixfast") add("tixfast", { t: "TIXFAST online", d: "Venta online · al momento", i: "globe", c: COLOR.tixfast, auto: true }, i);
    else if (i.origen === "api") add("fourvenues", { t: "Fourvenues", d: "Sincronizado", i: "link", c: COLOR.fourvenues, auto: true }, i);
    else if (i.origen === "csv") { const t = String(i.concepto || "").split(" · ")[0] || "CSV"; add("csv:" + t.toLowerCase(), { t, d: "Importado de CSV", i: "upload", c: COLOR.csv, auto: true }, i); }
    else add("m:" + i.id, { t: i.canal || i.concepto || i.categoria, d: (i.canal ? "Apuntado a mano" : i.categoria) + (i.fecha ? ` · ${new Date(i.fecha + "T12:00").toLocaleDateString("es-ES", { day: "numeric", month: "short" })}` : "") + (i.cobradoPor && !i.entregado ? " · lo tiene un socio" : ""), i: i.canal ? "ticket" : catInfo(i.categoria).i, c: null, manual: true }, i);
  });
  (barras || []).filter(b => b.fuente === "entradas" && (b.total > 0 || b.tickets > 0)).forEach(b => {
    add("tpv:" + b.punto.id, { t: b.punto.name, d: "Taquilla del TPV · en directo", i: "pos", c: COLOR.tpv, auto: true }, { importe: b.total, unidades: b.tickets });
  });
  let k = 0;
  const lista = [...m.values()].map(c => ({ ...c, c: c.c || PALETA[k++ % PALETA.length] })).sort((a, b) => b.importe - a.importe);
  const total = r2(lista.reduce((t, c) => t + c.importe, 0));
  const uds = lista.reduce((t, c) => t + c.uds, 0);
  return { lista, total, uds, udsCompletas: lista.every(c => c.udsSabidas), pendiente: r2(lista.reduce((t, c) => t + c.pendiente, 0)) };
}

/* ---------- Tarjeta grande: el dinero de entradas siempre a la vista ---------- */
export function DineroEntradas({ ingresos, barras, onAnadir, onEditar, onClientes, acciones, titulo = "Dinero de entradas" }) {
  const isMobile = useIsMobile();
  const D = canalesEntradas(ingresos, barras);
  const conUds = D.lista.filter(c => c.udsSabidas && c.uds > 0);   // la media solo con los canales que dicen cuántas entradas
  const medio = conUds.length ? conUds.reduce((t, c) => t + c.importe, 0) / conUds.reduce((t, c) => t + c.uds, 0) : null;
  return (
    <section style={{ ...C.hero, padding: isMobile ? 16 : 22 }} aria-label={titulo}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <div style={C.label}>{titulo}</div>
          <div style={{ fontSize: isMobile ? 40 : 54, fontWeight: 900, letterSpacing: "-.03em", lineHeight: 1.02, margin: "4px 0 2px", fontVariantNumeric: "tabular-nums" }}>{money(D.total)}</div>
          <div style={{ fontSize: 14, color: "var(--muted)", fontWeight: 700 }}>
            <b style={{ color: "var(--text)" }}>{n0(D.uds)}</b> entradas{!D.udsCompletas ? " + algún apunte sin cantidad" : ""}{medio ? ` · ${money(medio)} por entrada` : ""}
            {D.pendiente > 0 && <span style={{ color: "var(--amber)" }}> · {money(D.pendiente)} pendiente de cobrar</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {acciones}
          {onAnadir && <button onClick={onAnadir} style={{ ...C.btnPrimary, ...(isMobile ? { flex: "1 1 auto" } : {}) }}><Icon n="plus" s={17} w={2.4} />Añadir ventas</button>}
        </div>
      </div>

      {D.lista.length > 0 ? (<>
        <div style={{ display: "flex", height: 12, borderRadius: 8, overflow: "hidden", background: "var(--surface2)", margin: "16px 0 12px", gap: 2 }} aria-hidden="true">
          {D.lista.filter(c => c.importe > 0).map(c => <div key={c.k} title={`${c.t}: ${money(c.importe)}`} style={{ width: `${(c.importe / Math.max(D.total, .01)) * 100}%`, minWidth: 4, background: c.c }} />)}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {D.lista.map(c => {
            const editable = c.manual && onEditar;
            const Fila = editable ? "button" : "div";
            return (
              <Fila key={c.k} {...(editable ? { onClick: () => onEditar(c.items[0]), type: "button" } : {})}
                style={{ ...C.listBtn, cursor: editable ? "pointer" : "default", padding: "10px 4px", borderTop: "1px solid var(--line)", borderRadius: 0 }}>
                <Tile n={c.i} c={c.c} s={34} />
                <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                  <span style={{ display: "block", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.t}</span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>{c.udsSabidas || c.uds ? `${n0(c.uds)} entradas · ` : ""}{c.d}</span>
                </span>
                {c.k === "tixfast" && onClientes && <button type="button" onClick={(e) => { e.stopPropagation(); onClientes(); }} style={{ ...C.btnSm, flexShrink: 0 }}><Icon n="users" s={14} />{isMobile ? "" : "Clientes"}</button>}
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
                  <b style={{ fontSize: 16, fontVariantNumeric: "tabular-nums" }}>{money(c.importe)}</b>
                  {c.pendiente > 0 ? <Badge c="var(--amber)">Pendiente {money(c.pendiente)}</Badge> : <span style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 700 }}>{D.total ? Math.round((c.importe / D.total) * 100) : 0} %</span>}
                </span>
              </Fila>);
          })}
        </div>
      </>) : (
        <div style={{ ...C.empty, marginTop: 14 }}>Aún no hay dinero de entradas en este evento. Llega solo desde TIXFAST, Fourvenues o la taquilla del TPV; las demás ticketeras se añaden con «Añadir ventas».</div>
      )}
    </section>
  );
}

/* ---------- Apuntar ventas de otra ticketera o venta en mano ---------- */
export function VentaEntradasForm({ ingreso, socios, busy, onClose, onSave, onDelete }) {
  const isMobile = useIsMobile();
  const nuevo = !ingreso?.id;
  const deLista = CANALES.includes(ingreso?.canal);
  const [canal, setCanal] = useState(ingreso?.canal ? (deLista ? ingreso.canal : "__otra") : "");
  const [otro, setOtro] = useState(ingreso?.canal && !deLista ? ingreso.canal : "");
  const [uds, setUds] = useState(ingreso?.unidades != null ? String(ingreso.unidades) : "");
  const [importe, setImporte] = useState(ingreso?.importe ? String(ingreso.importe).replace(".", ",") : "");
  const [estado, setEstado] = useState(ingreso?.estado || "cobrado");
  const [cobradoPor, setCobradoPor] = useState(ingreso?.cobradoPor || null);
  const [entregado, setEntregado] = useState(!!ingreso?.entregado);
  const [fecha, setFecha] = useState(ingreso?.fecha || hoy());
  const [nota, setNota] = useState(ingreso?.nota || "");
  const [confirmDel, setConfirmDel] = useState(false);
  const canalFinal = canal === "__otra" ? otro.trim() : canal;
  const imp = parseImporte(importe);
  const u = Math.round(Number(String(uds).replace(/\D/g, "")) || 0);
  const ok = !!canalFinal && imp > 0 && u > 0;
  const metodo = ["Venta en mano", "RRPP", "Taquilla física"].includes(canalFinal) ? "efectivo" : "transferencia";
  const guardar = () => {
    if (!ok || busy) return;
    onSave({ id: ingreso?.id, categoria: ingreso?.categoria && catInfo(ingreso.categoria).g === "entradas" ? ingreso.categoria : OTRAS_CAT, canal: canalFinal, unidades: u, importe: imp,
      concepto: `${canalFinal} · ${u} entradas`, estado, cobradoPor, entregado: cobradoPor ? entregado : false, metodo: ingreso?.metodo || metodo, fecha, nota });
  };
  return (
    <Sheet title={nuevo ? "Añadir ventas de entradas" : "Editar ventas de entradas"} onClose={onClose}
      footer={<div style={{ display: "flex", gap: 8 }}>
        {!nuevo && (confirmDel
          ? <><button onClick={() => onDelete(ingreso)} style={{ ...C.btnGhost, color: "var(--red)", borderColor: "var(--red)" }}><Icon n="trash" s={16} />Sí, borrar</button><button onClick={() => setConfirmDel(false)} style={C.btnGhost}>No</button></>
          : <button onClick={() => setConfirmDel(true)} style={{ ...C.btnGhost, color: "var(--red)", padding: "0 14px" }} aria-label="Borrar"><Icon n="trash" s={18} /></button>)}
        <button disabled={!ok || busy} onClick={guardar} style={{ ...C.btnPrimary, flex: 1, minHeight: 52, fontSize: 16, opacity: ok && !busy ? 1 : .45 }}>
          {busy ? "Guardando…" : !canalFinal ? "Elige el canal" : !(u > 0) ? "Escribe cuántas entradas" : !(imp > 0) ? "Escribe el dinero" : `Guardar ${u} entradas · ${money(imp)}`}
        </button>
      </div>}>
      <Field l="¿Por dónde se vendieron?">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {CANALES.map(k => <button key={k} type="button" onClick={() => setCanal(k)} aria-pressed={canal === k} style={{ ...C.seg, border: `2px solid ${canal === k ? "var(--accent)" : "var(--line)"}`, ...(canal === k ? { background: "color-mix(in srgb, var(--accent) 14%, var(--surface2))", color: "var(--text)" } : {}), minHeight: 40 }}>{k}</button>)}
          <button type="button" onClick={() => setCanal("__otra")} aria-pressed={canal === "__otra"} style={{ ...C.seg, border: `2px solid ${canal === "__otra" ? "var(--accent)" : "var(--line)"}`, minHeight: 40 }}><Icon n="plus" s={14} />Otra</button>
        </div>
        {canal === "__otra" && <input autoFocus value={otro} maxLength={60} onChange={e => setOtro(e.target.value)} placeholder="Nombre de la ticketera o canal" style={{ ...C.input, marginTop: 8 }} />}
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1.4fr", gap: 12 }}>
        <Field l="Nº de entradas"><input inputMode="numeric" value={uds} onChange={e => setUds(e.target.value.replace(/\D/g, "").slice(0, 7))} placeholder="Ej. 120" style={{ ...C.input, fontSize: 22, fontWeight: 900, minHeight: 56 }} /></Field>
        <Field l="Dinero total recaudado"><MoneyInput big value={importe} onChange={setImporte} color={imp > 0 ? "var(--green)" : undefined} /></Field>
      </div>
      {imp > 0 && u > 0 && <div style={{ fontSize: 13, color: "var(--muted)", margin: "-4px 0 12px" }}>Sale a <b style={{ color: "var(--text)" }}>{money(imp / u)}</b> por entrada. Pon el dinero que recibes tú (sin las comisiones de la ticketera, si te las descuenta).</div>}
      <Field l="Estado"><Seg full valor={estado} onChange={setEstado} opciones={[{ k: "cobrado", t: "Cobrado", i: "check", c: "var(--green)", ink: "#04241b" }, { k: "pendiente", t: "Pendiente de liquidar", i: "clock", c: "var(--amber)", ink: "#1a1205" }]} /></Field>
      <Field l="¿Quién tiene el dinero?">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <Chip on={!cobradoPor} onClick={() => { setCobradoPor(null); setEntregado(false); }}><Icon n="building" s={16} />Empresa</Chip>
          {(socios || []).map(s => <Chip key={s.id} on={cobradoPor === s.id} c="var(--amber)" onClick={() => setCobradoPor(s.id)}><Avatar nombre={s.nombre} c={s.color} s={22} />{s.nombre}</Chip>)}
        </div>
        {cobradoPor && <label style={{ ...C.toggleRow, marginTop: 10 }}><span>Ya lo ha entregado a la caja</span><input type="checkbox" checked={entregado} onChange={e => setEntregado(e.target.checked)} style={{ width: 22, height: 22, accentColor: "var(--green)" }} /></label>}
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1.6fr", gap: 12 }}>
        <Field l="Fecha" mb={4}><input type="date" value={fecha} onChange={e => setFecha(e.target.value || hoy())} style={C.input} /></Field>
        <Field l="Nota (opcional)" mb={4}><input value={nota} maxLength={500} onChange={e => setNota(e.target.value)} placeholder="Ej. liquidación del 15/12" style={C.input} /></Field>
      </div>
    </Sheet>
  );
}
const Chip = ({ on, onClick, children, c = "var(--accent)" }) => (
  <button type="button" onClick={onClick} aria-pressed={on} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 12px 7px 9px", borderRadius: 22, cursor: "pointer", fontWeight: 800, fontSize: 13.5,
    border: `2px solid ${on ? c : "var(--line)"}`, background: on ? `color-mix(in srgb, ${c} 14%, var(--surface2))` : "var(--surface2)", color: "var(--text)" }}>{children}{on && <Icon n="check" s={14} w={2.6} c={c} />}</button>
);

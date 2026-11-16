// ===================== CRM · RENTABILIDAD =====================
// Cuánto deja cada producto de la barra. Lo vendido sale del TPV; el coste, de las recetas y el catálogo de Stock
// (o de un coste escrito a mano). El cálculo vive en rentabilidad.js (con pruebas).
import React, { useEffect, useMemo, useState } from "react";
import * as crm from "./crmdb";
import { money, useIsMobile, C, Icon, Tile, Badge, Seg, Sheet, Field, MoneyInput, parseImporte } from "./ui";
import { Switch } from "./Ingresos";
import { famInfo, FAMILIAS, sugerirReceta, stockCfg, num } from "./stockModelo";
import { calcularRentabilidad, TIPOS, simular, precioMinimo } from "./rentabilidad";

const ORIGEN = {
  receta: { t: "Receta", c: "var(--green)" }, manual: { t: "A mano", c: "var(--green)" }, nogasta: { t: "Sin coste", c: "var(--muted)" },
  estimado: { t: "Estimado", c: "var(--amber)" }, sin: { t: "Falta coste", c: "var(--amber)" },
};
const ORDEN = [["beneficio", "Más beneficio"], ["margen", "Más margen"], ["uds", "Más vendidos"], ["margenAsc", "Menos margen"], ["nombre", "Nombre"]];
const pct = (v) => (v == null ? "—" : `${v} %`);
const coma = (v) => (v == null ? "" : String(v).replace(".", ","));

export function Rentabilidad({ ev, events, sales, ajustes, flash, onGuardarAjustes, onIrStock }) {
  const isMobile = useIsMobile();
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [ambito, setAmbito] = useState("evento");
  const [puntoId, setPuntoId] = useState("");
  const [familia, setFamilia] = useState("");
  const [orden, setOrden] = useState("beneficio");
  const [buscar, setBuscar] = useState("");
  const [ficha, setFicha] = useState(null);
  const [completar, setCompletar] = useState(false);
  const [verAjustes, setVerAjustes] = useState(false);
  const [busy, setBusy] = useState(false);

  const cargar = async () => { setError(null); try { setD(await crm.loadCostes()); } catch { setError(navigator.onLine ? "No se han podido cargar los costes." : "Rentabilidad necesita conexión a internet."); } };
  useEffect(() => { cargar(); }, []);
  useEffect(() => { setPuntoId(""); }, [ev.id, ambito]);

  const cfgStock = stockCfg(ajustes);
  const R = useMemo(() => d ? calcularRentabilidad({
    events, sales, eventIds: ambito === "evento" ? new Set([ev.id]) : null, puntoId: puntoId || null,
    articulos: d.articulos, recetas: d.recetas, ajustes, sugerir: (n) => sugerirReceta(n, cfgStock),
  }) : null, [d, events, sales, ev.id, ambito, puntoId, ajustes]);

  const guardar = async (fn, okMsg) => {
    if (busy) return false;
    setBusy(true);
    try { await fn(); if (okMsg) flash(okMsg); await cargar(); return true; }
    catch { flash(navigator.onLine ? "No se ha podido guardar" : "Sin conexión: no se ha guardado", "warn"); return false; }
    finally { setBusy(false); }
  };
  const rent = ajustes.rentabilidad || {};
  const guardarRent = (patch, okMsg) => guardar(() => onGuardarAjustes({ ...ajustes, rentabilidad: { ...rent, ...patch } }), okMsg);
  const costeAMano = (nombre, v) => guardarRent({ costes: (() => { const c = { ...(rent.costes || {}) }; if (v == null) delete c[nombre]; else c[nombre] = v; return c; })() },
    v == null ? `${nombre}: vuelve a usar la receta` : `${nombre}: coste ${money(v)} guardado`);
  const confirmarReceta = (f) => guardar(() => crm.saveReceta(f.nombre, f.items || []), `${f.nombre}: receta confirmada`);

  if (error) return <div style={{ ...C.panel, borderColor: "var(--amber)", color: "var(--amber)", fontWeight: 700, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}><span>{error}</span><button onClick={cargar} style={C.btnGhost}>Reintentar</button></div>;
  if (!R) return <div style={{ color: "var(--muted)", padding: 30, textAlign: "center" }}>Cargando rentabilidad…</div>;

  const { T, cfg } = R;
  const q = buscar.trim().toUpperCase();
  const lista = R.activas
    .filter(f => !familia || f.familia === familia)
    .filter(f => !q || f.nombre.includes(q))
    .sort((a, b) => {
      const nb = (x, k) => (x[k] == null ? -Infinity : x[k]);
      if (orden === "nombre") return a.nombre.localeCompare(b.nombre);
      if (orden === "uds") return b.uds - a.uds;
      if (orden === "margen") return nb(b, "margen") - nb(a, "margen");
      if (orden === "margenAsc") return (a.margen == null ? Infinity : a.margen) - (b.margen == null ? Infinity : b.margen);
      return nb(b, "beneficio") - nb(a, "beneficio") || b.sinIva - a.sinIva;
    });
  const familias = FAMILIAS.filter(F => R.activas.some(f => f.familia === F.k));
  const pendientes = [...T.sinCoste, ...T.estimados];
  const puntos = ambito === "evento" ? ev.puntos.filter(p => !p.archivado || sales.some(s => s.puntoId === p.id)) : [];

  const exportar = () => {
    const filas = [["Producto", "Vendidas", "Invitaciones", "Precio medio", "Coste por unidad", "Origen del coste", "Beneficio por unidad", "Margen %", "Ventas sin IVA", "Beneficio", "Tipo"],
      ...lista.map(f => [f.nombre, f.uds, f.inv, coma(f.precioMedio), coma(f.coste), ORIGEN[f.origen]?.t || "", coma(f.benUd), f.margen ?? "", coma(f.sinIva), coma(f.beneficio), f.tipo ? TIPOS[f.tipo].t : ""])];
    const cell = (x) => { let v = String(x ?? "").replace(/[;\r\n]+/g, " "); if (/^[=+\-@\t]/.test(v) && !/^-?\d+([.,]\d+)?$/.test(v)) v = "'" + v; return v; };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + filas.map(f => f.map(cell).join(";")).join("\n")], { type: "text/csv;charset=utf-8;" }));
    a.download = `TIXFAST_rentabilidad_${ambito === "evento" ? ev.name.replace(/[^\w-]+/g, "_") : "todos"}.csv`; a.click();
  };

  const sel = { ...C.miniSelect, minHeight: 44, fontSize: 14, padding: "0 30px 0 12px" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Filtros */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Seg size="sm" valor={ambito} onChange={setAmbito} opciones={[{ k: "evento", t: "Este evento" }, { k: "todo", t: "Todos los eventos" }]} />
        {puntos.length > 1 && <select aria-label="Barra" value={puntoId} onChange={e => setPuntoId(e.target.value)} style={sel}><option value="">Todas las barras</option>{puntos.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        {familias.length > 1 && <select aria-label="Familia" value={familia} onChange={e => setFamilia(e.target.value)} style={sel}><option value="">Todas las familias</option>{familias.map(F => <option key={F.k} value={F.k}>{F.corto}</option>)}{R.activas.some(f => f.familia === "otros") && !familias.some(F => F.k === "otros") && <option value="otros">Otros</option>}</select>}
        <select aria-label="Ordenar" value={orden} onChange={e => setOrden(e.target.value)} style={sel}>{ORDEN.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
        <span style={{ flex: 1 }} />
        <button onClick={exportar} disabled={!lista.length} style={{ ...C.btnSm, fontSize: 13.5 }}><Icon n="download" s={16} />{isMobile ? "" : "Exportar"}</button>
        <button onClick={() => setVerAjustes(true)} style={{ ...C.btnSm, fontSize: 13.5 }} aria-label="Ajustes de rentabilidad"><Icon n="gear" s={16} />{isMobile ? "" : "Ajustes"}</button>
      </div>

      {/* Resumen */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, minmax(0,1fr))", gap: 10 }}>
        <Cifra l="Ventas sin IVA" v={money(T.sinIva)} sub={`${num(T.uds, 0)} unidades`} />
        <Cifra l="Coste de lo vendido" v={money(T.costeVendido)} sub={T.pctCoste != null ? `${T.pctCoste} % de coste` : "—"} />
        <Cifra l="Beneficio de barra" v={money(T.beneficio)} c={T.beneficio >= 0 ? "var(--green)" : "var(--red)"} sub={T.margen != null ? `${T.margen} % de margen` : "—"} />
        <Cifra l="Invitaciones" v={money(T.costeInv)} c={T.costeInv > 0 ? "var(--amber)" : undefined} sub={`${num(T.inv, 0)} unidades a coste`} />
      </div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: -4 }}>
        Sin IVA ({cfg.ivaBarra} %){cfg.datafono && cfg.tarjetaPct > 0 ? ` y descontado el datáfono (${num(cfg.tarjetaPct)} %)` : ""}. Es el beneficio de la barra: no incluye personal, alquiler ni artistas.
      </div>

      {/* Avisos */}
      {T.sinCoste.length > 0 && (
        <div role="alert" style={{ ...C.panel, borderColor: "var(--amber)", background: "color-mix(in srgb, var(--amber) 9%, var(--surface))", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Tile n="alert" c="var(--amber)" s={36} />
          <div style={{ flex: "1 1 220px", minWidth: 0, fontSize: 14 }}>
            <b>{T.sinCoste.length === 1 ? "1 producto no tiene coste" : `${T.sinCoste.length} productos no tienen coste`}.</b>{" "}
            Suman {money(T.ventasSinCoste)} de ventas y no entran en el beneficio hasta que les pongas coste.
          </div>
          <button onClick={() => setCompletar(true)} style={{ ...C.btnPrimary, minHeight: 44 }}>Completar costes</button>
        </div>
      )}
      {T.sinCoste.length === 0 && T.estimados.length > 0 && (
        <div style={{ ...C.panel, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Tile n="sparkle" c="var(--amber)" s={36} />
          <div style={{ flex: "1 1 220px", minWidth: 0, fontSize: 14 }}><b>{T.estimados.length === 1 ? "1 coste es estimado" : `${T.estimados.length} costes son estimados`}</b> a partir del nombre del producto (por ejemplo, «copa» = 50 ml + refresco). Confírmalos para que sean exactos.</div>
          <button onClick={() => setCompletar(true)} style={{ ...C.btnGhost, minHeight: 44 }}>Revisar</button>
        </div>
      )}
      {d.articulos.length === 0 && (
        <div style={{ ...C.panel, fontSize: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Tile n="box" s={36} />
          <div style={{ flex: "1 1 220px", minWidth: 0 }}><b>Aún no hay precios de compra.</b> Mete tus botellas y latas con su precio en Stock › Catálogo (o sube una factura) y aquí saldrá el coste de cada copa solo. Mientras, puedes escribir el coste a mano en cada producto.</div>
          {onIrStock && <button onClick={onIrStock} style={{ ...C.btnGhost, minHeight: 44 }}>Ir a Stock</button>}
        </div>
      )}

      {/* Productos */}
      <section style={{ ...C.panel, padding: isMobile ? 12 : 16 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <b style={{ fontSize: 16, flex: 1 }}>Productos <span style={{ color: "var(--muted)", fontWeight: 700 }}>({lista.length})</span></b>
          <input aria-label="Buscar producto" value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar…" style={{ ...C.input, width: isMobile ? "100%" : 220, minHeight: 44, fontSize: 16 }} />
        </div>
        {!lista.length && <div style={C.empty}>{R.activas.length ? "Ningún producto coincide con el filtro." : "Aún no hay ventas en el TPV para este evento."}</div>}
        {lista.length > 0 && (isMobile
          ? <div>{lista.map(f => <Tarjeta key={f.nombre} f={f} onClick={() => setFicha(f.nombre)} />)}</div>
          : <Tabla lista={lista} onClick={(f) => setFicha(f.nombre)} />)}
      </section>

      {/* Qué hacer con cada producto */}
      <Matriz filas={R.activas} onClick={(f) => setFicha(f.nombre)} />

      {ficha && (() => { const f = R.filas.find(x => x.nombre === ficha); return f ? <Ficha f={f} cfg={cfg} busy={busy} onClose={() => setFicha(null)} onCoste={costeAMano} onConfirmar={confirmarReceta} onIrStock={onIrStock ? () => { setFicha(null); onIrStock(); } : null} /> : null; })()}
      {completar && <Completar pendientes={pendientes} busy={busy} onClose={() => setCompletar(false)} onCoste={costeAMano} onConfirmar={confirmarReceta} />}
      {verAjustes && <AjustesRent cfg={cfg} rent={rent} busy={busy} onClose={() => setVerAjustes(false)} onGuardar={async (p) => { if (await guardarRent(p, "Ajustes de rentabilidad guardados")) setVerAjustes(false); }} />}
    </div>
  );
}

const Cifra = ({ l, v, sub, c }) => (
  <div style={{ ...C.card, padding: "12px 14px" }}>
    <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 800 }}>{l}</div>
    <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-.02em", color: c || "var(--text)", fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}>{v}</div>
    {sub && <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{sub}</div>}
  </div>
);
const Muestra = ({ c }) => <span style={{ width: 10, height: 10, borderRadius: 3, background: c || "var(--muted)", flexShrink: 0, display: "inline-block" }} />;
const TipoBadge = ({ f }) => f.tipo ? <Badge c={TIPOS[f.tipo].c}>{TIPOS[f.tipo].t}</Badge> : f.coste == null ? <Badge c="var(--amber)">Falta coste</Badge> : null;

function Tabla({ lista, onClick }) {
  const th = { padding: "9px 10px", fontSize: 12, color: "var(--muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: .4, textAlign: "right", whiteSpace: "nowrap", borderBottom: "1px solid var(--line)" };
  const td = { padding: "10px", textAlign: "right", whiteSpace: "nowrap", borderBottom: "1px solid var(--line)", fontVariantNumeric: "tabular-nums" };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead><tr><th style={{ ...th, textAlign: "left" }}>Producto</th><th style={th}>Vendidas</th><th style={th}>Precio</th><th style={th}>Coste/ud</th><th style={th}>Beneficio/ud</th><th style={th}>Margen</th><th style={th}>Beneficio</th><th style={{ ...th, textAlign: "left" }}>Tipo</th></tr></thead>
        <tbody>{lista.map(f => (
          <tr key={f.nombre} onClick={() => onClick(f)} onKeyDown={e => { if (e.key === "Enter") onClick(f); }} tabIndex={0} style={{ cursor: "pointer" }}>
            <td style={{ ...td, textAlign: "left" }}><span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800 }}><Muestra c={f.color} />{f.nombre}</span></td>
            <td style={td}>{num(f.uds, 0)}{f.inv > 0 && <span style={{ color: "var(--muted)", fontSize: 12 }}> +{f.inv} inv.</span>}</td>
            <td style={td}>{f.precioMedio != null ? money(f.precioMedio) : "—"}</td>
            <td style={td}>{f.coste != null ? <>{money(f.coste)}{f.origen === "estimado" && <span title="Estimado" style={{ color: "var(--amber)" }}> ≈</span>}</> : <span style={{ color: "var(--amber)", fontWeight: 800 }}>Sin coste</span>}</td>
            <td style={{ ...td, color: f.benUd != null && f.benUd < 0 ? "var(--red)" : undefined }}>{f.benUd != null ? money(f.benUd) : "—"}</td>
            <td style={td}>{pct(f.margen)}</td>
            <td style={{ ...td, fontWeight: 900, color: f.beneficio != null && f.beneficio < 0 ? "var(--red)" : undefined }}>{f.beneficio != null ? money(f.beneficio) : "—"}</td>
            <td style={{ ...td, textAlign: "left" }}><TipoBadge f={f} /></td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}

function Tarjeta({ f, onClick }) {
  return (
    <button onClick={onClick} style={{ ...C.listBtn, minHeight: 56, alignItems: "flex-start" }}>
      <span style={{ marginTop: 5 }}><Muestra c={f.color} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontWeight: 800, overflowWrap: "anywhere" }}>{f.nombre}</span>
        <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
          {num(f.uds, 0)} vendidas{f.inv > 0 ? ` · ${f.inv} inv.` : ""}{f.benUd != null ? ` · ${money(f.benUd)} por unidad · ${pct(f.margen)}` : ""}
        </span>
        <span style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap" }}><TipoBadge f={f} />{f.origen === "estimado" && <Badge c="var(--amber)">Coste estimado</Badge>}</span>
      </span>
      <b style={{ flexShrink: 0, fontSize: 16, fontVariantNumeric: "tabular-nums", color: f.beneficio == null ? "var(--muted)" : f.beneficio < 0 ? "var(--red)" : "var(--text)" }}>{f.beneficio != null ? money(f.beneficio) : "—"}</b>
      <Icon n="chev" s={18} c="var(--muted)" />
    </button>
  );
}

// Cuatro cuadros: se vende mucho / poco × deja mucho / poco por unidad
function Matriz({ filas, onClick }) {
  const isMobile = useIsMobile();
  const con = filas.filter(f => f.tipo);
  if (con.length < 3) return null;
  const caja = (k) => { const T = TIPOS[k]; const xs = con.filter(f => f.tipo === k).sort((a, b) => (b.beneficio || 0) - (a.beneficio || 0)); return (
    <div key={k} style={{ border: `1px solid color-mix(in srgb, ${T.c} 55%, var(--line))`, borderRadius: 14, padding: 12, display: "grid", alignContent: "start", gap: 6, minWidth: 0 }}>
      <b style={{ color: T.c, fontSize: 15 }}>{T.t} <span style={{ color: "var(--muted)", fontWeight: 700 }}>({xs.length})</span></b>
      <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.4 }}>{T.consejo}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
        {xs.map(f => <button key={f.nombre} onClick={() => onClick(f)} style={{ ...C.tag, cursor: "pointer", minHeight: 36, color: "var(--text)", font: "inherit", fontSize: 12.5, fontWeight: 700 }}><Muestra c={f.color} />{f.nombre}</button>)}
        {!xs.length && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Ninguno</span>}
      </div>
    </div>); };
  return (
    <section style={C.panel}>
      <div style={{ fontWeight: 900, fontSize: 16 }}>Qué hacer con cada producto</div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "2px 0 12px" }}>Cada producto se compara con el resto: si se vende más o menos que la media y si deja más o menos por unidad.</div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
        {caja("caballo")}{caja("estrella")}{caja("perro")}{caja("enigma")}
      </div>
    </section>
  );
}

function Ficha({ f, cfg, busy, onClose, onCoste, onConfirmar, onIrStock }) {
  const [manual, setManual] = useState(f.origen === "manual" ? coma(f.coste) : "");
  const [precio, setPrecio] = useState(coma(f.precioMedio ?? f.precioCarta ?? ""));
  const parteTarjeta = f.ingresos > 0 ? f.tarjeta / f.ingresos : 0;
  const p = parseImporte(precio);
  const sim = f.coste != null && p > 0 ? simular({ precio: p, coste: f.coste, ivaBarra: cfg.ivaBarra, tarjetaPct: cfg.datafono ? cfg.tarjetaPct : 0, parteTarjeta }) : null;
  const minimo = precioMinimo({ coste: f.coste, objetivo: cfg.objetivo, ivaBarra: cfg.ivaBarra });
  const O = ORIGEN[f.origen] || ORIGEN.sin;
  const linea = (l, v, extra = {}) => <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderTop: "1px solid var(--line)", fontSize: 14, fontVariantNumeric: "tabular-nums", ...extra }}>{l}<span>{v}</span></div>;
  return (
    <Sheet title={f.nombre} onClose={onClose}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}><TipoBadge f={f} /><Badge c={O.c}>Coste: {O.t}</Badge></div>
      {f.tipo && <div style={{ fontSize: 13.5, color: "var(--muted)", marginBottom: 14 }}>{TIPOS[f.tipo].consejo}</div>}

      <div style={{ ...C.card, marginBottom: 14 }}>
        <div style={{ fontWeight: 900, marginBottom: 4 }}>En este periodo</div>
        {linea(<span style={{ color: "var(--muted)" }}>Vendidas</span>, `${num(f.uds, 0)}${f.inv ? ` + ${f.inv} invitaciones` : ""}`)}
        {linea(<span style={{ color: "var(--muted)" }}>Ventas sin IVA</span>, money(f.sinIva))}
        {f.datafono > 0 && linea(<span style={{ color: "var(--muted)" }}>Datáfono</span>, `−${money(f.datafono)}`)}
        {f.costeVendido != null && linea(<span style={{ color: "var(--muted)" }}>Coste de lo vendido</span>, `−${money(f.costeVendido)}`)}
        {f.costeInv > 0 && linea(<span style={{ color: "var(--muted)" }}>Coste de las invitaciones</span>, `−${money(f.costeInv)}`)}
        {linea(<b>Beneficio</b>, <b style={{ color: f.beneficio == null ? "var(--muted)" : f.beneficio < 0 ? "var(--red)" : "var(--green)" }}>{f.beneficio != null ? money(f.beneficio) : "Falta el coste"}</b>, { borderTopWidth: 2 })}
      </div>

      <div style={{ ...C.card, marginBottom: 14 }}>
        <div style={{ fontWeight: 900, marginBottom: 4 }}>Qué cuesta una unidad</div>
        {f.lineas.length > 0 && f.origen !== "manual" && f.lineas.map((l, i) => <React.Fragment key={i}>{linea(
          <span style={{ minWidth: 0 }}>{l.nombre || famInfo(l.familia).corto}<span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>{l.origen === "extra" ? "Ajustes de rentabilidad" : `${num(l.cantidad, 0)} ${famInfo(l.familia).medida === "ml" ? "ml" : "ud"}${l.origen === "media" ? " · precio medio de la familia" : ""}`}</span></span>,
          l.coste != null ? money(l.coste) : <span style={{ color: "var(--amber)", fontWeight: 800 }}>Sin precio</span>)}</React.Fragment>)}
        {f.origen === "nogasta" && <div style={{ fontSize: 13.5, color: "var(--muted)", padding: "6px 0" }}>Su receta dice que no gasta nada de stock (coste 0). Si tiene otro coste, escríbelo abajo.</div>}
        {f.origen === "sin" && !f.lineas.length && <div style={{ fontSize: 13.5, color: "var(--muted)", padding: "6px 0" }}>No sabemos qué lleva. Escribe lo que te cuesta una unidad o ponle receta en Stock.</div>}
        {f.faltaPrecio && <div style={{ fontSize: 13.5, color: "var(--amber)", padding: "6px 0" }}>Algún ingrediente no tiene precio de compra en el catálogo de Stock.</div>}
        {f.coste != null && linea(<b>Coste por unidad</b>, <b>{money(f.coste)}{f.pctCoste != null ? <span style={{ color: "var(--muted)", fontWeight: 700 }}> · {f.pctCoste} %</span> : null}</b>, { borderTopWidth: 2 })}
        {f.origen === "estimado" && f.items?.length > 0 && <button disabled={busy} onClick={() => onConfirmar(f)} style={{ ...C.btnGhost, width: "100%", minHeight: 44, marginTop: 10 }}><Icon n="check" s={16} />Confirmar esta receta</button>}
        {onIrStock && <button onClick={onIrStock} style={{ ...C.btnGhost, width: "100%", minHeight: 44, marginTop: 8 }}><Icon n="glass" s={16} />Cambiar la receta en Stock</button>}
      </div>

      <div style={{ ...C.card, marginBottom: 14 }}>
        <Field l="Coste a mano (sin IVA, por unidad)" mb={8}><MoneyInput value={manual} onChange={setManual} placeholder={f.coste != null && f.origen !== "manual" ? coma(f.coste) : "0,00"} /></Field>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>Si lo escribes, manda sobre la receta. Útil para guardarropa, comida o merchandising.</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button disabled={busy || manual === ""} onClick={() => onCoste(f.nombre, parseImporte(manual))} style={{ ...C.btnPrimary, flex: 1, minHeight: 44, opacity: manual === "" ? .5 : 1 }}>Guardar coste</button>
          {f.origen === "manual" && <button disabled={busy} onClick={() => { setManual(""); onCoste(f.nombre, null); }} style={{ ...C.btnGhost, minHeight: 44 }}>Quitar</button>}
        </div>
      </div>

      {f.coste != null && (
        <div style={C.card}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>¿Y si cambio el precio?</div>
          <Field l="Precio de venta (con IVA)" mb={10}><MoneyInput value={precio} onChange={setPrecio} /></Field>
          {sim && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div style={{ background: "var(--surface2)", borderRadius: 12, padding: "10px 12px" }}><div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 800 }}>Beneficio por unidad</div><b style={{ fontSize: 20, color: sim.benUd < 0 ? "var(--red)" : "var(--text)" }}>{money(sim.benUd)}</b></div>
            <div style={{ background: "var(--surface2)", borderRadius: 12, padding: "10px 12px" }}><div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 800 }}>Margen</div><b style={{ fontSize: 20 }}>{pct(sim.margen)}</b></div>
          </div>}
          {sim && f.uds > 0 && f.benUd != null && sim.benUd > 0 && Math.abs(sim.benUd - f.benUd) >= 0.01 && <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 10 }}>
            Para ganar lo mismo que ahora ({money(f.benUd * f.uds)}) te bastaría con vender <b style={{ color: "var(--text)" }}>{num(Math.ceil(f.benUd * f.uds / sim.benUd), 0)}</b> en vez de {num(f.uds, 0)}.
          </div>}
          {minimo != null && <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 10 }}>Precio mínimo para tu objetivo de {cfg.objetivo} % de margen: <b style={{ color: "var(--text)" }}>{money(minimo)}</b>.</div>}
        </div>
      )}
    </Sheet>
  );
}

// Ir uno por uno por los productos sin coste o con coste estimado
function Completar({ pendientes, busy, onClose, onCoste, onConfirmar }) {
  const [valores, setValores] = useState({});
  return (
    <Sheet title="Completar costes" onClose={onClose} footer={<button onClick={onClose} style={{ ...C.btnGhost, width: "100%", minHeight: 48 }}>Hecho</button>}>
      <div style={{ fontSize: 13.5, color: "var(--muted)", marginBottom: 12 }}>Escribe lo que te cuesta una unidad (sin IVA) o confirma la receta que proponemos. Se guarda para todos los eventos.</div>
      {!pendientes.length && <div style={C.empty}>Todos los productos tienen coste.</div>}
      {pendientes.map(f => (
        <div key={f.nombre} style={{ padding: "12px 0", borderTop: "1px solid var(--line)" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <Muestra c={f.color} /><b style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{f.nombre}</b>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{num(f.uds, 0)} vendidas · {money(f.sinIva)} sin IVA</span>
          </div>
          {f.origen === "estimado" && <button disabled={busy} onClick={() => onConfirmar(f)} style={{ ...C.btnGhost, width: "100%", minHeight: 44, marginBottom: 8, justifyContent: "space-between" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, textAlign: "left" }}><Icon n="check" s={16} />{f.items?.length ? "Confirmar receta" : "Confirmar: no gasta stock"}</span><span style={{ color: "var(--muted)" }}>{f.items?.length ? `≈ ${money(f.coste)}` : "0 €"}</span></button>}
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}><MoneyInput value={valores[f.nombre] ?? ""} onChange={(v) => setValores({ ...valores, [f.nombre]: v })} placeholder="Coste a mano" /></div>
            <button disabled={busy || !valores[f.nombre]} onClick={() => onCoste(f.nombre, parseImporte(valores[f.nombre]))} style={{ ...C.btnPrimary, minHeight: 44, opacity: valores[f.nombre] ? 1 : .5 }}>Guardar</button>
          </div>
        </div>
      ))}
    </Sheet>
  );
}

function AjustesRent({ cfg, rent, busy, onClose, onGuardar }) {
  const [extra, setExtra] = useState(coma(rent.extraCopa ?? ""));
  const [objetivo, setObjetivo] = useState(String(cfg.objetivo));
  const [datafono, setDatafono] = useState(cfg.datafono);
  const obj = Math.min(95, Math.max(0, parseInt(objetivo, 10) || 0));
  return (
    <Sheet title="Ajustes de rentabilidad" onClose={onClose}
      footer={<button disabled={busy} onClick={() => onGuardar({ extraCopa: extra === "" ? 0 : parseImporte(extra), objetivo: obj, datafono })} style={{ ...C.btnPrimary, width: "100%", minHeight: 48 }}>Guardar</button>}>
      <Field l="Vaso, hielo y otros por copa (sin IVA)">
        <MoneyInput value={extra} onChange={setExtra} />
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>Se suma al coste de las copas y chupitos (productos con destilado).</div>
      </Field>
      <Field l="Margen objetivo">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input inputMode="numeric" value={objetivo} onChange={e => setObjetivo(e.target.value.replace(/\D/g, "").slice(0, 2))} aria-label="Margen objetivo en %" style={{ ...C.input, width: 90, fontSize: 18, fontWeight: 900, textAlign: "right" }} /><b>%</b>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>Con él se calcula el precio mínimo de cada producto. En barras suele estar entre el 75 % y el 85 %.</div>
      </Field>
      <div style={{ ...C.toggleRow, marginBottom: 16 }}>
        <span>Descontar la comisión del datáfono<span style={{ display: "block", fontSize: 12.5, color: "var(--muted)", fontWeight: 500 }}>{cfg.tarjetaPct > 0 ? `${num(cfg.tarjetaPct)} % de lo cobrado con tarjeta` : "Ahora está a 0 % en Ajustes › Comisiones e IVA"}</span></span>
        <Switch on={datafono} onClick={() => setDatafono(!datafono)} />
      </div>
      <div style={{ fontSize: 12.5, color: "var(--muted)" }}>El IVA de la barra ({cfg.ivaBarra} %) y la comisión del datáfono se cambian en Ajustes › Comisiones e IVA.</div>
    </Sheet>
  );
}

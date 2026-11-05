// ===================== CRM · STOCK (fase 1) =====================
// Pasos del evento: Catálogo → Entradas → Recetas → Recuento final → Resultado.
// Lo vendido sale del TPV (solo lectura). Los movimientos no se borran: se anulan.
import React, { useEffect, useMemo, useState } from "react";
import * as crm from "./crmdb";
import { money, r2, parseImporte, fechaCorta, useIsMobile, C, Icon, Tile, Badge, Seg, Head, Sheet, Field, IconGrid, MoneyInput } from "./ui";
import { Vacio, Switch } from "./Ingresos";
import { FAMILIAS, famInfo, UNIDADES, uniTxt, TIPOS_MOV, tipoInfo, stockCfg, num, medidaTxt, cantTxt, factor, formato, sugerirReceta, recetaTxt, calcularStock, CATALOGO_MONTEAGUDO } from "./stockModelo";

const QUIEN = "Admin";
const ESTADO_FAM = {
  cuadra: { t: "Cuadra", c: "var(--green)", i: "check" },
  falta: { t: "Revisar", c: "var(--amber)", i: "alert" },
  sobra: { t: "Sale de más", c: "#3b82f6", i: "alert" },
  pendiente: { t: "Sin recuento", c: "var(--muted)", i: "clock" },
  sinreceta: { t: "Ningún producto lo descuenta", c: "var(--muted)", i: "dots" },
  info: { t: "Saldo aparte", c: "var(--muted)", i: "crate" },
};
const NIVEL = { alta: { t: "Fiabilidad alta", c: "var(--green)" }, media: { t: "Fiabilidad media", c: "var(--amber)" }, baja: { t: "Fiabilidad baja", c: "var(--red)" } };

export function Stock({ ev, sales, ajustes, onGuardarAjustes, flash }) {
  const isMobile = useIsMobile();
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [vista, setVista] = useState("resumen");
  const cargar = async () => { setError(null); try { setD(await crm.loadStock(ev.id)); } catch (e) { setError(navigator.onLine ? "No se han podido cargar los datos de stock." : "El stock necesita conexión a internet."); } };
  useEffect(() => { setD(null); setVista("resumen"); cargar(); }, [ev.id]);
  const run = async (fn, okMsg) => {
    if (busy) return false;
    setBusy(true);
    try { await fn(); if (okMsg) flash(okMsg); await cargar(); return true; }
    catch (e) { flash(navigator.onLine ? (e?.message && e.message.length < 80 ? e.message : "No se ha podido guardar") : "Sin conexión: no se ha guardado", "warn"); return false; }
    finally { setBusy(false); }
  };
  const cfg = stockCfg(ajustes);
  const S = useMemo(() => d ? calcularStock({ ev, sales, articulos: d.articulos, movimientos: d.movimientos, recetas: d.recetas, conteo: d.conteo, lineas: d.lineas, cfg }) : null, [d, ev, sales, ajustes]);

  if (error) return <div style={{ ...C.panel, borderColor: "var(--amber)", color: "var(--amber)", fontWeight: 700, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}><span style={{ display: "flex", alignItems: "center", gap: 8 }}><Icon n="alert" s={18} />{error}</span><button onClick={cargar} style={C.ghost}>Reintentar</button></div>;
  if (!d || !S) return <div style={{ color: "var(--muted)", padding: 30, textAlign: "center" }}>Cargando stock…</div>;

  const props = { ev, d, S, cfg, busy, run, isMobile, ir: setVista, ajustes, onGuardarAjustes };
  const titulo = { entradas: ["Entradas y salidas", "plus"], recetas: ["Recetas", "glass"], recuento: ["Recuento final", "clipboard"], catalogo: ["Catálogo", "box"] }[vista];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {vista !== "resumen" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => setVista("resumen")} style={C.btnGhost} aria-label="Volver al resumen"><Icon n="right" s={16} style={{ transform: "rotate(180deg)" }} />{isMobile ? "" : "Resumen"}</button>
          <Tile n={titulo[1]} s={36} /><b style={{ fontSize: 19 }}>{titulo[0]}</b>
        </div>
      )}
      {vista === "resumen" && <Resumen {...props} />}
      {vista === "entradas" && <Entradas {...props} />}
      {vista === "recetas" && <Recetas {...props} />}
      {vista === "recuento" && <Recuento {...props} />}
      {vista === "catalogo" && <Catalogo {...props} />}
    </div>
  );
}

/* ===================== RESUMEN ===================== */
function Resumen({ ev, d, S, isMobile, ir }) {
  const F = S.fiabilidad;
  const activos = d.articulos.filter(a => a.activo);
  const enRecuento = S.enJuego.filter(f => (f.entrada - f.devolucion) > 0);
  const contados = d.lineas.length;
  const prodVendidos = S.productos.filter(p => p.vendidas + p.invitaciones > 0);
  const prodOk = prodVendidos.filter(p => p.estado === "confirmada" || p.estado === "nogasta").length;
  const pasos = [
    { k: "catalogo", i: "box", t: "Catálogo", sub: activos.length ? `${activos.length} artículos` : "Sin artículos", hecho: activos.length > 0 },
    { k: "entradas", i: "plus", t: "Entradas", sub: S.nMovs ? `${S.nMovs} apuntes · ${money(S.valorEntrada)}` : "Apunta lo que llega", hecho: S.nMovs > 0 },
    { k: "recetas", i: "glass", t: "Recetas", sub: prodVendidos.length ? `${prodOk} de ${prodVendidos.length} confirmadas` : `${S.productos.length} productos del TPV`, hecho: prodVendidos.length > 0 ? prodOk === prodVendidos.length : S.productos.length > 0 && S.productos.every(p => p.estado === "confirmada" || p.estado === "nogasta") },
    { k: "recuento", i: "clipboard", t: "Recuento final", sub: F.sellado ? "Sellado" : d.conteo ? `${contados} de ${enRecuento.length} contados` : "Al cerrar el evento", hecho: F.sellado },
  ];
  const siguiente = pasos.find(p => !p.hecho)?.k;
  const sellado = F.sellado;
  const fams = S.familias.filter(f => !f.noAudita);
  const envases = S.familias.find(f => f.noAudita);
  const nv = NIVEL[F.nivel];
  return (<>
    <section style={{ ...C.hero, padding: isMobile ? 16 : 22 }}>
      {sellado ? (<>
        <div style={C.label}>Resultado del stock · {ev.name}</div>
        {S.faltaCoste > 0.5
          ? <><div style={{ fontSize: isMobile ? 38 : 50, fontWeight: 900, letterSpacing: "-.02em", lineHeight: 1.05, marginTop: 4, color: "var(--amber)" }}>{money(S.faltaCoste)}</div><div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>de producto que falta y el TPV no explica, a precio de coste.</div></>
          : <><div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: isMobile ? 34 : 44, fontWeight: 900, lineHeight: 1.05, marginTop: 4, color: "var(--green)" }}><Icon n="check" s={isMobile ? 32 : 40} w={2.6} />Todo cuadra</div><div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>Lo que falta en la barra coincide con lo vendido en el TPV.</div></>}
      </>) : (<>
        <div style={C.label}>Stock de {ev.name}</div>
        <div style={{ fontSize: isMobile ? 38 : 50, fontWeight: 900, letterSpacing: "-.02em", lineHeight: 1.05, marginTop: 4 }}>{money(S.valorEntrada)}</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>en mercancía a precio de coste, sin IVA. Al cerrar, haz el recuento final para ver si cuadra con lo vendido.</div>
      </>)}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        {(S.nMovs > 0 || sellado) && <Badge c={nv.c}><Icon n="shield" s={12} w={2.2} />{nv.t}</Badge>}
        {sellado && <Badge>Consumido {money(S.consumidoCoste)} a coste</Badge>}
        {sellado && S.sobraCoste < -0.5 && <Badge c="#3b82f6">Sale de más {money(Math.abs(S.sobraCoste))}</Badge>}
      </div>
    </section>

    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,minmax(0,1fr))", gap: 8 }}>
      {pasos.map((p, i) => { const sig = p.k === siguiente; return (
        <button key={p.k} onClick={() => ir(p.k)} style={{ textAlign: "left", cursor: "pointer", padding: 14, borderRadius: 16, minWidth: 0, color: "var(--text)",
          border: `2px solid ${sig ? "var(--accent)" : "var(--line)"}`, background: sig ? "color-mix(in srgb, var(--accent) 10%, var(--surface))" : "var(--surface)" }}>
          <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <Tile n={p.i} s={36} c={p.hecho ? "var(--green)" : sig ? "var(--accent)" : "var(--muted)"} />
            {p.hecho ? <Badge c="var(--green)"><Icon n="check" s={11} w={2.6} />Hecho</Badge> : sig ? <Badge c="var(--accent)" solid>Siguiente</Badge> : <span style={{ fontSize: 12, fontWeight: 900, color: "var(--muted)" }}>{i + 1}</span>}
          </span>
          <b style={{ display: "block", fontSize: 15, marginTop: 10 }}>{p.t}</b>
          <span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.sub}</span>
        </button>); })}
    </div>

    {fams.length === 0 && <section style={C.panel}><Vacio i="box" t="Aún no hay nada en el stock de este evento." sub={activos.length ? "Apunta las entradas de mercancía de la factura o el albarán." : "Empieza cargando el catálogo."} /></section>}
    {fams.length > 0 && (
      <section style={C.panel}>
        <Head i="chart" t={sellado || d.conteo ? "¿Cuadra con lo vendido?" : "Cómo va el evento"} sub={sellado || d.conteo ? "Consumido de verdad frente a lo que explica el TPV, por familia." : "Lo que entró, lo vendido según el TPV y lo que debería quedar."} />
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
          {fams.map(f => <FamiliaCard key={f.k} f={f} conRecuento={!!d.conteo} />)}
        </div>
      </section>
    )}

    {(S.nMovs > 0) && (
      <section style={C.panel}>
        <Head i="shield" c={nv.c} t={nv.t} sub="Cuánto te puedes fiar del resultado." />
        <Check ok={F.sellado} t={F.sellado ? "Recuento final sellado" : "Recuento final sin sellar"} accion={!F.sellado ? ["Ir al recuento", () => ir("recuento")] : null} />
        <Check ok={F.contadosPct === 100} t={`${F.contadosPct} % de los artículos contados`} />
        <Check ok={F.recetaPct >= 90} t={`${F.recetaPct} % de lo vendido con receta confirmada`} accion={F.recetaPct < 90 ? ["Revisar recetas", () => ir("recetas")] : null} />
        {F.sinReceta.length > 0 && <div style={{ fontSize: 12.5, color: "var(--amber)", fontWeight: 700, marginTop: 8 }}>Sin receta: {F.sinReceta.map(p => p.nombre).join(", ")}. Lo que se venda de ellos no se descuenta del stock.</div>}
      </section>
    )}

    {envases && (
      <section style={C.panel}>
        <Head i="crate" c={envases.c} t="Envases retornables" sub="Van aparte: devolver cajas vacías no toca el stock de bebida." />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
          <Dato l="Cargados" v={num(envases.entra, 0)} />
          <Dato l="Devueltos" v={num(envases.devuelto, 0)} />
          <Dato l="Pendientes" v={num(envases.entra - envases.devuelto, 0)} c={envases.entra - envases.devuelto > 0 ? "var(--amber)" : undefined} />
        </div>
      </section>
    )}
  </>);
}
const Dato = ({ l, v, c, sub }) => <div style={{ padding: "9px 11px", borderRadius: 12, background: "var(--surface2)", border: "1px solid var(--line)", minWidth: 0 }}><div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: .8 }}>{l}</div><div style={{ fontWeight: 900, fontSize: 17, marginTop: 2, color: c || "var(--text)", whiteSpace: "nowrap" }}>{v}</div>{sub && <div style={{ fontSize: 11, color: "var(--muted)" }}>{sub}</div>}</div>;
const Check = ({ ok, t, accion }) => (
  <div style={{ ...C.row }}>
    <span style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700, fontSize: 14 }}><span style={{ width: 26, height: 26, borderRadius: 8, display: "grid", placeItems: "center", background: ok ? "color-mix(in srgb, var(--green) 18%, transparent)" : "color-mix(in srgb, var(--amber) 18%, transparent)", color: ok ? "var(--green)" : "var(--amber)" }}><Icon n={ok ? "check" : "alert"} s={15} w={2.4} /></span>{t}</span>
    {accion && <button onClick={accion[1]} style={C.btnSm}>{accion[0]}<Icon n="right" s={14} /></button>}
  </div>
);
function FamiliaCard({ f, conRecuento }) {
  const e = ESTADO_FAM[f.estado] || ESTADO_FAM.pendiente;
  const neto = r2(f.entra - f.devuelto);
  const botellas = (v) => f.medida === "ml" && f.medidaMedia > 0 ? ` ≈ ${num(v / f.medidaMedia, 1)} botellas` : "";
  const max = Math.max(1, neto, f.real || 0, f.justificado);
  const barra = (v, c, t) => <div style={{ marginTop: 8 }}><div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", fontWeight: 700, marginBottom: 4 }}><span>{t}</span><span style={{ color: "var(--text)" }}>{medidaTxt(f.k, v)}</span></div><div style={{ height: 9, borderRadius: 5, background: "var(--surface2)", overflow: "hidden" }}><div style={{ width: `${Math.max(0, v) / max * 100}%`, height: "100%", background: c, borderRadius: 5 }} /></div></div>;
  return (
    <div style={{ border: `1px solid ${f.estado === "falta" ? "color-mix(in srgb, var(--amber) 55%, transparent)" : "var(--line)"}`, borderRadius: 14, padding: 14, background: "var(--surface)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}><Tile n={f.i} c={f.c} s={34} /><b style={{ fontSize: 15 }}>{f.t}</b></span>
        <Badge c={e.c}><Icon n={e.i} s={11} w={2.4} />{e.t}</Badge>
      </div>
      {barra(neto, "var(--muted)", "Entró (menos devuelto)")}
      {conRecuento && f.real != null ? barra(f.real, f.c, "Consumido de verdad") : null}
      {barra(f.justificado, "var(--green)", "Explicado por el TPV y mermas")}
      {!conRecuento && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--line)" }}><span style={{ color: "var(--muted)", fontWeight: 700 }}>Debería quedar</span><b>{medidaTxt(f.k, f.deberia)}{botellas(f.deberia)}</b></div>}
      {f.dif != null && f.estado !== "sinreceta" && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "2px 8px", fontSize: 13.5, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 800, color: f.estado === "cuadra" ? "var(--green)" : f.estado === "falta" ? "var(--amber)" : "#60a5fa" }}>{f.estado === "cuadra" ? (Math.abs(f.dif) < 0.005 ? "Sin diferencia" : "Diferencia pequeña") : f.dif > 0 ? "Falta sin justificar" : "Se vendió más de lo que salió"}</span>
            <b style={{ whiteSpace: "nowrap" }}>{f.dif > 0 ? "−" : f.dif < 0 ? "+" : ""}{medidaTxt(f.k, Math.abs(f.dif))}{botellas(Math.abs(f.dif))}</b>
          </div>
          {Math.abs(f.difCoste) >= 0.01 && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{money(Math.abs(f.difCoste))} a precio de coste{f.estado === "cuadra" ? " · dentro de lo normal" : ""}</div>}
          {f.estado === "falta" && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, lineHeight: 1.45 }}>Posibles causas: copas más cargadas que la receta, invitaciones o roturas sin apuntar, botellas sin contar o un error en el recuento.</div>}
          {f.estado === "sobra" && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, lineHeight: 1.45 }}>Suele ser una receta mayor de lo que se sirve, o una entrada de mercancía sin apuntar.</div>}
        </div>
      )}
      {f.estado === "sinreceta" && f.real != null && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Consumido {medidaTxt(f.k, f.real)}; ningún producto del TPV lo descuenta en su receta.</div>}
      {f.sinContar.length > 0 && conRecuento && <div style={{ fontSize: 12, color: "var(--amber)", fontWeight: 700, marginTop: 8 }}>Sin contar: {f.sinContar.map(x => x.a.nombre).join(", ")}</div>}
    </div>
  );
}

/* ===================== ENTRADAS Y SALIDAS ===================== */
function Entradas({ ev, d, S, busy, run, isMobile, ir }) {
  const [form, setForm] = useState(null);
  const [filtro, setFiltro] = useState("todos");
  const [confirmar, setConfirmar] = useState(null);
  const artById = Object.fromEntries(d.articulos.map(a => [a.id, a]));
  const anulados = new Set(d.movimientos.filter(m => m.tipo === "anulacion").map(m => m.anulaId));
  const lista = d.movimientos.filter(m => m.tipo !== "anulacion" && (filtro === "todos" || m.tipo === filtro));
  const activos = d.articulos.filter(a => a.activo);
  if (!activos.length) return <section style={C.panel}><Vacio i="box" t="Primero necesitas el catálogo." sub="Carga el de Monteagudo con un toque o crea tus artículos." /><div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}><button onClick={() => ir("catalogo")} style={C.btnPrimary}><Icon n="box" s={16} />Ir al catálogo</button></div></section>;
  return (<>
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,minmax(0,1fr))", gap: 8 }}>
      {TIPOS_MOV.map((t, i) => (
        <button key={t.k} onClick={() => setForm({ tipo: t.k })} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 12px", borderRadius: 14, cursor: "pointer", textAlign: "left", minWidth: 0,
          border: i === 0 ? "none" : "1px solid var(--line)", background: i === 0 ? "var(--accent)" : "var(--surface)", color: i === 0 ? "#fff" : "var(--text)" }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", flexShrink: 0, background: i === 0 ? "rgba(255,255,255,.2)" : `color-mix(in srgb, ${t.c} 18%, transparent)`, color: i === 0 ? "#fff" : t.c }}><Icon n={t.i} s={17} w={2.2} /></span>
          <span style={{ minWidth: 0 }}><span style={{ display: "block", fontWeight: 900, fontSize: 14 }}>{t.t}</span><span style={{ display: "block", fontSize: 11.5, opacity: .8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{["Llega mercancía", "Vuelve al proveedor", "Rotura o derrame", "Personal, artistas"][i]}</span></span>
        </button>))}
    </div>
    <section style={C.panel}>
      <Head i="receipt" t="Apuntes del evento" sub="No se borran: si algo está mal, se anula y se apunta bien." right={<b style={{ fontSize: 17 }}>{money(S.valorEntrada)}</b>} />
      {d.movimientos.length > 0 && <div style={{ marginBottom: 6 }}><Seg size="sm" valor={filtro} onChange={setFiltro} opciones={[{ k: "todos", t: "Todos" }, ...TIPOS_MOV.map(t => ({ k: t.k, t: t.t }))]} /></div>}
      {lista.length === 0 && <Vacio i="plus" t="Todavía no hay apuntes." sub="Empieza por la entrada de mercancía: lo que pone la factura o el albarán." />}
      {lista.map(m => { const a = artById[m.articuloId], t = tipoInfo(m.tipo), fam = famInfo(a?.familia), anul = anulados.has(m.id); return (
        <div key={m.id} style={{ ...C.row, opacity: anul ? .5 : 1, alignItems: "center" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
            <Tile n={fam.i} c={fam.c} s={36} />
            <span style={{ minWidth: 0 }}>
              <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: anul ? "line-through" : "none" }}>{a?.nombre || "Artículo"}</b>
              <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>{cantTxt(a, m.cantidad)}{m.documento ? ` · ${m.documento}` : ""} · {fechaCorta(m.creadoEn.slice(0, 10))}</span>
            </span>
          </span>
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
            <Badge c={anul ? "var(--muted)" : t.c}>{anul ? "Anulado" : t.t}</Badge>
            {!anul && (confirmar === m.id
              ? <span style={{ display: "flex", gap: 4 }}><button disabled={busy} onClick={async () => { await run(() => crm.anularMovimiento(m, QUIEN), "Apunte anulado"); setConfirmar(null); }} style={{ ...C.btnSm, color: "var(--red)", borderColor: "var(--red)" }}>Sí, anular</button><button onClick={() => setConfirmar(null)} style={C.btnSm}>No</button></span>
              : <button onClick={() => setConfirmar(m.id)} style={{ ...C.btnSm, color: "var(--muted)", padding: "4px 9px" }}>Anular</button>)}
          </span>
        </div>); })}
    </section>
    {form && <MovForm tipo0={form.tipo} articulos={activos} busy={busy} onClose={() => setForm(null)}
      onSave={async (x, otro) => { const ok = await run(() => crm.addMovimiento({ ...x, eventoId: ev.id, creadoPor: QUIEN }), `${tipoInfo(x.tipo).t} apuntada`); if (ok && !otro) setForm(null); return ok; }} />}
  </>);
}

const Stepper = ({ l, v, onChange, step = 1, big, sub }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ ...C.label, textAlign: "center" }}>{l}</div>
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button type="button" onClick={() => onChange(Math.max(0, r2((Number(v) || 0) - step)))} aria-label={`Quitar ${l}`} style={{ width: big ? 56 : 46, height: big ? 56 : 46, borderRadius: 14, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0 }}><Icon n="minus" s={20} w={2.6} /></button>
      <input inputMode="decimal" value={v === 0 ? "0" : String(v ?? "").replace(".", ",")} onChange={e => { const t = e.target.value.replace(/[^\d.,]/g, "").slice(0, 8); onChange(t === "" ? 0 : parseImporte(t)); }} onFocus={e => e.target.select()}
        style={{ ...C.input, textAlign: "center", fontWeight: 900, fontSize: big ? 28 : 22, padding: big ? "10px 4px" : "8px 4px", minWidth: 0 }} aria-label={l} />
      <button type="button" onClick={() => onChange(r2((Number(v) || 0) + step))} aria-label={`Añadir ${l}`} style={{ width: big ? 56 : 46, height: big ? 56 : 46, borderRadius: 14, border: "none", background: "var(--accent)", color: "#fff", cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0 }}><Icon n="plus" s={20} w={2.6} /></button>
    </div>
    {sub && <div style={{ fontSize: 11.5, color: "var(--muted)", textAlign: "center", marginTop: 4 }}>{sub}</div>}
  </div>
);

function ArtPicker({ articulos, valor, onChange }) {
  const [q, setQ] = useState("");
  const [fam, setFam] = useState("");
  const sel = articulos.find(a => a.id === valor);
  if (sel) return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, border: `2px solid ${famInfo(sel.familia).c}`, background: `color-mix(in srgb, ${famInfo(sel.familia).c} 10%, var(--surface2))` }}>
      <Tile n={famInfo(sel.familia).i} c={famInfo(sel.familia).c} s={40} />
      <span style={{ flex: 1, minWidth: 0 }}><b style={{ display: "block" }}>{sel.nombre}</b><span style={{ fontSize: 12, color: "var(--muted)" }}>{formato(sel) || famInfo(sel.familia).t}</span></span>
      <button type="button" onClick={() => onChange(null)} style={C.btnSm}>Cambiar</button>
    </div>
  );
  const fams = FAMILIAS.filter(f => articulos.some(a => a.familia === f.k));
  const lista = articulos.filter(a => (!fam || a.familia === fam) && (!q || a.nombre.toLowerCase().includes(q.toLowerCase()) || a.codigo === q.trim()));
  return (
    <div>
      <div style={{ position: "relative", marginBottom: 8 }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }}><Icon n="search" s={17} /></span>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar artículo o código" style={{ ...C.input, paddingLeft: 40 }} />
      </div>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6 }}>
        <button type="button" onClick={() => setFam("")} style={{ ...C.seg, ...(fam === "" ? C.segOn : {}) }}>Todos</button>
        {fams.map(f => <button key={f.k} type="button" onClick={() => setFam(f.k)} style={{ ...C.seg, ...(fam === f.k ? { background: f.c, borderColor: f.c, color: "#fff" } : {}) }}><Icon n={f.i} s={14} />{f.corto}</button>)}
      </div>
      <div style={{ maxHeight: 300, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 12 }}>
        {lista.length === 0 && <div style={{ padding: 16, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Nada con esa búsqueda.</div>}
        {lista.map((a, i) => { const f = famInfo(a.familia); return (
          <button key={a.id} type="button" onClick={() => onChange(a.id)} style={{ ...C.listBtn, borderTop: i ? "1px solid var(--line)" : "none", padding: "10px 10px" }}>
            <Tile n={f.i} c={f.c} s={32} />
            <span style={{ flex: 1, minWidth: 0 }}><b style={{ display: "block", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.nombre}</b><span style={{ fontSize: 11.5, color: "var(--muted)" }}>{formato(a) || f.t}{a.codigo ? ` · cód. ${a.codigo}` : ""}</span></span>
            <Icon n="right" s={16} c="var(--muted)" />
          </button>); })}
      </div>
    </div>
  );
}

function MovForm({ tipo0, articulos, busy, onClose, onSave }) {
  const isMobile = useIsMobile();
  const [tipo, setTipo] = useState(tipo0);
  const [artId, setArtId] = useState(null);
  const [cajas, setCajas] = useState(0);
  const [sueltas, setSueltas] = useState(0);
  const [coste, setCoste] = useState("");
  const [costeTocado, setCosteTocado] = useState(false);
  const [doc, setDoc] = useState("");
  const [nota, setNota] = useState("");
  const a = articulos.find(x => x.id === artId);
  useEffect(() => { setCajas(0); setSueltas(0); setCosteTocado(false); setCoste(a?.coste != null ? String(r2(a.coste * (a.porCaja || 1))).replace(".", ",") : ""); }, [artId]);
  const porCaja = a?.porCaja || 1;
  const total = r2(cajas * porCaja + sueltas);
  const ok = a && total > 0;
  const t = tipoInfo(tipo);
  // Si no se toca el precio, se usa el coste exacto del catálogo (sin redondeos de pasar por la caja)
  const costeUnidad = coste === "" ? null : !costeTocado && a?.coste != null ? a.coste : Math.round(parseImporte(coste) / porCaja * 10000) / 10000;
  const guardar = async (otro) => {
    if (!ok || busy) return;
    const hecho = await onSave({ tipo, articuloId: a.id, cantidad: total, cajas: porCaja > 1 ? cajas : null, sueltas: porCaja > 1 ? sueltas : null, costeUnidad: tipo === "entrada" ? costeUnidad : null, documento: doc, nota }, otro);
    if (hecho && otro) { setArtId(null); setNota(""); }
  };
  return (
    <Sheet title={t.largo} onClose={onClose}
      footer={<div style={{ display: "flex", gap: 8 }}>
        <button disabled={!ok || busy} onClick={() => guardar(true)} style={{ ...C.btnGhost, opacity: ok && !busy ? 1 : .45 }}><Icon n="plus" s={16} />{isMobile ? "Y otro" : "Guardar y otro"}</button>
        <button disabled={!ok || busy} onClick={() => guardar(false)} style={{ ...C.btnPrimary, flex: 1, minHeight: 52, fontSize: 16, opacity: ok && !busy ? 1 : .45 }}>{busy ? "Guardando…" : !a ? "Elige el artículo" : total > 0 ? `Guardar ${num(total)} ${uniTxt(a.unidad, total)}` : "Pon la cantidad"}</button>
      </div>}>
      <Field l="Tipo"><Seg full size="sm" valor={tipo} onChange={setTipo} opciones={TIPOS_MOV.map(x => ({ k: x.k, t: isMobile ? x.t.replace("Consumo interno", "Interno") : x.t, c: x.c, ink: x.ink }))} /></Field>
      <Field l="Artículo"><ArtPicker articulos={articulos} valor={artId} onChange={setArtId} /></Field>
      {a && <>
        <div style={{ display: "grid", gridTemplateColumns: porCaja > 1 ? "1fr 1fr" : "1fr", gap: 12, marginBottom: 12 }}>
          {porCaja > 1 && <Stepper l={`Cajas de ${porCaja}`} v={cajas} onChange={setCajas} big />}
          <Stepper l={porCaja > 1 ? `${uniTxt(a.unidad, 2)} sueltas` : uniTxt(a.unidad, 2)} v={sueltas} onChange={setSueltas} big step={1} />
        </div>
        <div style={{ textAlign: "center", padding: "10px 12px", borderRadius: 12, background: `color-mix(in srgb, ${t.c} 12%, var(--surface2))`, marginBottom: 16 }}>
          <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 700 }}>Total </span><b style={{ fontSize: 22 }}>{num(total)} {uniTxt(a.unidad, total)}</b>
          {famInfo(a.familia).medida === "ml" && a.ml && total > 0 && <span style={{ fontSize: 13, color: "var(--muted)" }}> · {num(total * a.ml / 1000, 1)} L</span>}
        </div>
        {tipo === "entrada" && <Field l={porCaja > 1 ? "Precio de la caja, sin IVA" : `Precio por ${uniTxt(a.unidad, 1)}, sin IVA`}>
          <MoneyInput value={coste} onChange={(v) => { setCoste(v); setCosteTocado(true); }} />
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>{coste !== "" && total > 0 ? `Esta entrada vale ${money(costeUnidad * total)}.` : "Sirve para calcular el valor del stock y de las diferencias."}</div>
        </Field>}
        {(tipo === "entrada" || tipo === "devolucion") && <Field l="Nº de factura o albarán (opcional)"><input value={doc} maxLength={60} onChange={e => setDoc(e.target.value)} placeholder="Ej.: 2026/1862" style={C.input} /></Field>}
        <Field l="Nota (opcional)" mb={4}><input value={nota} maxLength={300} onChange={e => setNota(e.target.value)} placeholder={tipo === "merma" ? "Ej.: se cayó una botella en barra 2" : ""} style={C.input} /></Field>
      </>}
    </Sheet>
  );
}

/* ===================== RECETAS ===================== */
const PRESETS = (cfg) => [
  { k: "copa", t: "Copa", i: "glass", c: "#a855f7", items: [{ familia: "destilado", cantidad: cfg.copaMl }, { familia: "refresco", cantidad: cfg.refrescoMl }] },
  { k: "chupito", t: "Chupito", i: "bottle", c: "#a855f7", items: [{ familia: "destilado", cantidad: cfg.chupitoMl }] },
  { k: "cerveza", t: "Cerveza", i: "beer", c: "#eab308", items: [{ familia: "cerveza", cantidad: 1 }] },
  { k: "refresco", t: "Refresco", i: "soda", c: "#ff5a3c", items: [{ familia: "refresco", cantidad: cfg.refrescoMl }] },
  { k: "agua", t: "Agua", i: "drop", c: "#0ea5e9", items: [{ familia: "agua", cantidad: 1 }] },
  { k: "energetica", t: "Energética", i: "bolt", c: "#22d3a6", items: [{ familia: "energetica", cantidad: 1 }] },
  { k: "nada", t: "No gasta stock", i: "x", c: "var(--muted)", items: [] },
];
const ESTADO_REC = { confirmada: ["Confirmada", "var(--green)"], nogasta: ["No gasta stock", "var(--muted)"], sugerida: ["Sugerida", "var(--amber)"], "nogasta-sugerida": ["Sugerida", "var(--amber)"], sinreceta: ["Falta receta", "var(--red)"] };

function Recetas({ d, S, cfg, busy, run, isMobile, ajustes, onGuardarAjustes }) {
  const [edit, setEdit] = useState(null);
  const sugeridas = S.productos.filter(p => p.estado === "sugerida" || p.estado === "nogasta-sugerida");
  const setCfg = (p) => run(() => onGuardarAjustes({ ...ajustes, stock: { ...cfg, ...p } }), "Medida guardada");
  return (<>
    <section style={C.panel}>
      <Head i="glass" c="#a855f7" t="Medidas de la casa" sub="Se usan en las recetas de copa, chupito y refresco. Valen para todos los eventos." />
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3,minmax(0,1fr))", gap: 12 }}>
        <Field l="Alcohol por copa" mb={0}><Seg full size="sm" valor={String(cfg.copaMl)} onChange={(k) => setCfg({ copaMl: Number(k) })} opciones={[40, 50, 60, 70].map(v => ({ k: String(v), t: `${v} ml` }))} /></Field>
        <Field l="Alcohol por chupito" mb={0}><Seg full size="sm" valor={String(cfg.chupitoMl)} onChange={(k) => setCfg({ chupitoMl: Number(k) })} opciones={[25, 30, 35, 40].map(v => ({ k: String(v), t: `${v} ml` }))} /></Field>
        <Field l="Refresco por copa" mb={0}><Seg full size="sm" valor={String(cfg.refrescoMl)} onChange={(k) => setCfg({ refrescoMl: Number(k) })} opciones={[150, 200, 237, 250].map(v => ({ k: String(v), t: `${v} ml` }))} /></Field>
      </div>
    </section>
    {sugeridas.length > 0 && (
      <section style={{ ...C.panel, borderColor: "color-mix(in srgb, var(--amber) 55%, transparent)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Tile n="sparkle" c="var(--amber)" s={38} />
        <span style={{ flex: "1 1 220px" }}><b style={{ display: "block" }}>{sugeridas.length} {sugeridas.length === 1 ? "receta sugerida" : "recetas sugeridas"} por el nombre</b><span style={{ fontSize: 12.5, color: "var(--muted)" }}>Revísalas y confírmalas para que el resultado sea fiable.</span></span>
        <button disabled={busy} onClick={() => run(() => crm.saveRecetas(sugeridas.map(p => ({ producto: p.nombre, items: p.items }))), "Recetas confirmadas")} style={C.btnPrimary}><Icon n="check" s={16} w={2.4} />Confirmar todas</button>
      </section>
    )}
    <section style={C.panel}>
      <Head i="pos" t="Productos del TPV" sub="Qué descuenta cada venta. Las invitaciones también cuentan. Los bonos se descomponen en sus productos." />
      {S.productos.length === 0 && <Vacio i="pos" t="Este evento aún no tiene productos en el TPV." />}
      {S.productos.map(p => { const e = ESTADO_REC[p.estado]; return (
        <button key={p.nombre} onClick={() => setEdit(p)} style={C.listBtn}>
          <span style={{ width: 36, height: 36, borderRadius: 10, background: p.color || "var(--surface2)", flexShrink: 0, display: "grid", placeItems: "center", color: "#fff", fontWeight: 900, fontSize: 14 }}>{p.nombre.charAt(0)}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nombre}</b>
            <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>{recetaTxt(p.items, d.articulos)}</span>
          </span>
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
            <Badge c={e[1]}>{e[0]}</Badge>
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{num(p.vendidas, 0)} vendidos{p.invitaciones ? ` · ${num(p.invitaciones, 0)} inv.` : ""}</span>
          </span>
        </button>); })}
    </section>
    {edit && <RecetaSheet p={edit} cfg={cfg} articulos={d.articulos.filter(a => a.activo)} busy={busy} onClose={() => setEdit(null)}
      onSave={async (items) => { const ok = await run(() => crm.saveReceta(edit.nombre, items), "Receta guardada"); if (ok) setEdit(null); }}
      onQuitar={edit.estado === "confirmada" || edit.estado === "nogasta" ? async () => { const ok = await run(() => crm.borrarReceta(edit.nombre), "Receta quitada"); if (ok) setEdit(null); } : null} />}
  </>);
}

function RecetaSheet({ p, cfg, articulos, busy, onClose, onSave, onQuitar }) {
  const [items, setItems] = useState(() => (p.items || []).map(x => ({ ...x })));
  const setIt = (i, patch) => setItems(l => l.map((x, j) => j === i ? { ...x, ...patch } : x));
  const valido = items.every(it => it.familia && Number(it.cantidad) > 0);
  const fams = FAMILIAS.filter(f => !f.noAudita);
  return (
    <Sheet title={p.nombre} onClose={onClose}
      footer={<div style={{ display: "flex", gap: 8 }}>
        {onQuitar && <button disabled={busy} onClick={onQuitar} style={{ ...C.btnGhost, color: "var(--muted)" }}>Quitar</button>}
        <button disabled={!valido || busy} onClick={() => onSave(items)} style={{ ...C.btnPrimary, flex: 1, minHeight: 52, fontSize: 16, opacity: valido && !busy ? 1 : .45 }}>{busy ? "Guardando…" : items.length ? "Guardar receta" : "Guardar: no gasta stock"}</button>
      </div>}>
      <Field l="Empieza por una plantilla">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {PRESETS(cfg).map(x => <button key={x.k} type="button" onClick={() => setItems(x.items.map(i => ({ ...i })))} style={{ ...C.seg, padding: "8px 12px" }}><Icon n={x.i} s={15} c={x.c} />{x.t}</button>)}
        </div>
      </Field>
      <div style={C.label}>Cada {p.nombre.toLowerCase()} gasta</div>
      {items.length === 0 && <div style={{ ...C.empty, marginBottom: 12 }}>No gasta nada del stock (por ejemplo, una entrada o el guardarropa).</div>}
      {items.map((it, i) => { const f = famInfo(it.familia); const artsFam = articulos.filter(a => a.familia === it.familia); return (
        <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 12, marginBottom: 10, background: "var(--surface2)" }}>
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8 }}>
            {fams.map(x => <button key={x.k} type="button" onClick={() => setIt(i, { familia: x.k, articuloId: undefined, cantidad: x.medida === "ml" ? (x.k === "destilado" ? cfg.copaMl : cfg.refrescoMl) : 1 })} style={{ ...C.seg, ...(it.familia === x.k ? { background: x.c, borderColor: x.c, color: "#fff" } : {}) }}><Icon n={x.i} s={14} />{x.corto}</button>)}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><input inputMode="decimal" value={String(it.cantidad ?? "").replace(".", ",")} onChange={e => setIt(i, { cantidad: parseImporte(e.target.value.replace(/[^\d.,]/g, "").slice(0, 7)) })} style={{ ...C.input, width: 90, textAlign: "right", fontWeight: 900, fontSize: 17, padding: "8px 10px" }} aria-label="Cantidad" /><b style={{ color: "var(--muted)" }}>{f.medida === "ml" ? "ml" : "ud"}</b></span>
            <select value={it.articuloId || ""} onChange={e => setIt(i, { articuloId: e.target.value || undefined })} style={{ ...C.miniSelect, flex: "1 1 160px", padding: "9px 10px" }} aria-label="Artículo concreto">
              <option value="">Cualquiera de {f.corto.toLowerCase()}</option>
              {artsFam.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
            <button type="button" onClick={() => setItems(l => l.filter((_, j) => j !== i))} aria-label="Quitar" style={{ ...C.btnSm, padding: "8px 9px", color: "var(--muted)" }}><Icon n="trash" s={15} /></button>
          </div>
        </div>); })}
      <button type="button" onClick={() => setItems(l => [...l, { familia: "destilado", cantidad: cfg.copaMl }])} style={{ ...C.btnGhost, width: "100%", marginBottom: 12 }}><Icon n="plus" s={16} />Añadir otro ingrediente</button>
      <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.45 }}>«Cualquiera» descuenta de la familia: una copa genérica no dice si fue ginebra o ron, así que se compara el total de destilados. Elige un artículo solo si ese producto siempre lleva el mismo (por ejemplo, «CERVEZA» = Estrella Galicia lata).</div>
    </Sheet>
  );
}

/* ===================== RECUENTO FINAL ===================== */
function Recuento({ ev, d, S, busy, run, isMobile, ir }) {
  const [abierto, setAbierto] = useState(null); // artículo que se está contando
  const [fam, setFam] = useState("");
  const [extra, setExtra] = useState(false);
  const [confirmSellar, setConfirmSellar] = useState(false);
  const c = d.conteo;
  const lineaDe = Object.fromEntries(d.lineas.map(l => [l.articuloId, l]));
  const conMov = S.enJuego.filter(f => (f.entrada - f.devolucion) > 0 || lineaDe[f.a.id]).map(f => f.a);
  const lista = [...conMov, ...d.articulos.filter(a => lineaDe[a.id] && !conMov.some(x => x.id === a.id))];
  const faltan = lista.filter(a => !lineaDe[a.id]);
  const visibles = lista.filter(a => !fam || a.familia === fam);
  const fams = FAMILIAS.filter(f => lista.some(a => a.familia === f.k));
  const siguiente = (desde) => { const orden = visibles.filter(a => !lineaDe[a.id] && a.id !== desde.id); return orden[0] || null; };
  const sellado = c?.estado === "sellado";

  if (!c) return (
    <section style={{ ...C.hero, padding: isMobile ? 18 : 26 }}>
      <Tile n="clipboard" s={52} />
      <div style={{ fontWeight: 900, fontSize: 22, marginTop: 12 }}>Recuento final</div>
      <div style={{ fontSize: 14, color: "var(--muted)", marginTop: 6, lineHeight: 1.5, maxWidth: 560 }}>Al cerrar el evento, cuenta lo que queda de cada artículo: cajas cerradas, botellas sueltas y la abierta (¼, ½ o ¾). No se enseña lo que debería haber, para que el recuento sea limpio.</div>
      <div style={{ fontSize: 13.5, marginTop: 12 }}><b>{lista.length}</b> {lista.length === 1 ? "artículo entró" : "artículos entraron"} en este evento.</div>
      <button disabled={busy || lista.length === 0} onClick={() => run(() => crm.empezarConteo(ev.id), "Recuento empezado")} style={{ ...C.btnPrimary, marginTop: 16, minHeight: 52, fontSize: 16, padding: "0 22px", opacity: lista.length ? 1 : .45 }}><Icon n="clipboard" s={18} />Empezar recuento</button>
      {lista.length === 0 && <div style={{ fontSize: 12.5, color: "var(--amber)", marginTop: 10, fontWeight: 700 }}>Primero apunta las entradas de mercancía.</div>}
    </section>
  );
  const pct = lista.length ? Math.round((lista.length - faltan.length) / lista.length * 100) : 0;
  return (<>
    <section style={{ ...C.panel, ...(sellado ? { borderColor: "var(--green)", background: "color-mix(in srgb, var(--green) 7%, var(--surface))" } : {}) }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}><Tile n={sellado ? "lock" : "clipboard"} c={sellado ? "var(--green)" : "var(--accent)"} s={38} />
          <span><b style={{ display: "block", fontSize: 16 }}>{sellado ? "Recuento sellado" : `Contados ${lista.length - faltan.length} de ${lista.length}`}</b><span style={{ fontSize: 12.5, color: "var(--muted)" }}>{sellado ? `El ${new Date(c.selladoEn).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}` : faltan.length ? `Faltan ${faltan.length}` : "¡Todo contado! Ya puedes sellar."}</span></span></span>
        {sellado
          ? <span style={{ display: "flex", gap: 8 }}><button onClick={() => ir("resumen")} style={C.btnPrimary}><Icon n="chart" s={16} />Ver resultado</button><button disabled={busy} onClick={() => run(() => crm.reabrirConteo(c.id), "Recuento reabierto")} style={C.btnGhost}>Reabrir</button></span>
          : <b style={{ fontSize: 20, color: faltan.length ? "var(--text)" : "var(--green)" }}>{pct} %</b>}
      </div>
      {!sellado && <div style={{ height: 10, borderRadius: 6, background: "var(--surface2)", overflow: "hidden", marginTop: 12 }}><div style={{ width: `${pct}%`, height: "100%", background: faltan.length ? "var(--accent)" : "var(--green)", transition: "width .2s" }} /></div>}
    </section>

    <section style={C.panel}>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8 }}>
        <button onClick={() => setFam("")} style={{ ...C.seg, ...(fam === "" ? C.segOn : {}) }}>Todos · {lista.length}</button>
        {fams.map(f => { const n = lista.filter(a => a.familia === f.k), hechos = n.filter(a => lineaDe[a.id]).length; return <button key={f.k} onClick={() => setFam(f.k)} style={{ ...C.seg, ...(fam === f.k ? { background: f.c, borderColor: f.c, color: "#fff" } : {}) }}><Icon n={f.i} s={14} />{f.corto} · {hechos}/{n.length}</button>; })}
      </div>
      {visibles.map(a => { const f = famInfo(a.familia), l = lineaDe[a.id]; return (
        <button key={a.id} disabled={sellado} onClick={() => setAbierto(a)} style={{ ...C.listBtn, cursor: sellado ? "default" : "pointer" }}>
          <Tile n={f.i} c={f.c} s={38} />
          <span style={{ flex: 1, minWidth: 0 }}><b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.nombre}</b><span style={{ fontSize: 12, color: "var(--muted)" }}>{formato(a) || f.t}</span></span>
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
            {l ? <><b style={{ fontSize: 15 }}>{num(l.total)} {uniTxt(a.unidad, l.total)}</b><Badge c="var(--green)"><Icon n="check" s={11} w={2.6} />Contado</Badge></> : <Badge c="var(--amber)">Sin contar</Badge>}
          </span>
        </button>); })}
      {!sellado && <button onClick={() => setExtra(true)} style={{ ...C.btnSm, marginTop: 10 }}><Icon n="plus" s={14} />Contar otro artículo</button>}
    </section>

    {!sellado && (
      <div style={{ position: "sticky", bottom: 0, paddingTop: 12, paddingBottom: 4, background: "linear-gradient(transparent, var(--bg) 30%)" }}>
        <button disabled={busy} onClick={() => faltan.length ? setConfirmSellar(true) : run(() => crm.sellarConteo(c.id, QUIEN), "Recuento sellado")} style={{ ...C.btnPrimary, width: "100%", minHeight: 54, fontSize: 16, background: faltan.length ? "var(--surface2)" : "var(--green)", color: faltan.length ? "var(--text)" : "#04241b", border: faltan.length ? "1px solid var(--line)" : "none" }}><Icon n="lock" s={18} />{faltan.length ? `Sellar recuento (faltan ${faltan.length})` : "Sellar recuento"}</button>
      </div>
    )}

    {abierto && <ContarSheet a={abierto} linea={lineaDe[abierto.id]} busy={busy} onClose={() => setAbierto(null)}
      onSave={async (v, seguir) => { const ok = await run(() => crm.saveLinea(c.id, abierto.id, v, QUIEN), "Contado"); if (ok) setAbierto(seguir ? siguiente(abierto) : null); }}
      onQuitar={lineaDe[abierto.id] ? async () => { const ok = await run(() => crm.borrarLinea(c.id, abierto.id), "Vuelve a sin contar"); if (ok) setAbierto(null); } : null} />}
    {extra && (
      <Sheet title="Contar otro artículo" onClose={() => setExtra(false)}>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>Por ejemplo, algo que había de antes y no se apuntó como entrada.</div>
        <ArtPicker articulos={d.articulos.filter(a => a.activo && !lista.some(x => x.id === a.id))} valor={null} onChange={(id) => { setExtra(false); setAbierto(d.articulos.find(a => a.id === id)); }} />
      </Sheet>
    )}
    {confirmSellar && (
      <Sheet title="¿Sellar con artículos sin contar?" onClose={() => setConfirmSellar(false)}
        footer={<div style={{ display: "flex", gap: 8 }}><button onClick={() => setConfirmSellar(false)} style={{ ...C.btnGhost, flex: 1 }}>Seguir contando</button><button disabled={busy} onClick={async () => { const ok = await run(() => crm.sellarConteo(c.id, QUIEN), "Recuento sellado"); if (ok) setConfirmSellar(false); }} style={{ ...C.btnPrimary, flex: 1 }}>Sellar igualmente</button></div>}>
        <div style={{ fontSize: 14, lineHeight: 1.5 }}>Faltan <b>{faltan.length}</b>: {faltan.map(a => a.nombre).join(", ")}.</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>Se quedarán como «sin contar» (no como cero) y la fiabilidad del resultado bajará. Si de verdad no queda nada, ábrelos y pulsa «No queda nada».</div>
      </Sheet>
    )}
  </>);
}

function ContarSheet({ a, linea, busy, onClose, onSave, onQuitar }) {
  const [cajas, setCajas] = useState(linea?.cajas || 0);
  const [sueltas, setSueltas] = useState(linea?.sueltas || 0);
  const [abierta, setAbierta] = useState(linea?.abierta || 0);
  useEffect(() => { setCajas(linea?.cajas || 0); setSueltas(linea?.sueltas || 0); setAbierta(linea?.abierta || 0); }, [a.id]);
  const f = famInfo(a.familia);
  const porCaja = a.porCaja || 1;
  const conAbierta = a.unidad === "botella" && (a.ml || 0) >= 500;
  const total = r2(cajas * porCaja + sueltas + abierta);
  return (
    <Sheet title={a.nombre} onClose={onClose}
      footer={<div style={{ display: "flex", gap: 8 }}>
        <button disabled={busy} onClick={() => onSave({ cajas: 0, sueltas: 0, abierta: 0, total: 0 }, true)} style={C.btnGhost}>No queda nada</button>
        <button disabled={busy} onClick={() => onSave({ cajas, sueltas, abierta, total }, true)} style={{ ...C.btnPrimary, flex: 1, minHeight: 54, fontSize: 16 }}>{busy ? "Guardando…" : "Guardar y siguiente"}</button>
      </div>}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}><Tile n={f.i} c={f.c} s={44} /><span style={{ fontSize: 13, color: "var(--muted)" }}>{formato(a) || f.t}</span></div>
      <div style={{ display: "grid", gap: 16, marginBottom: 16 }}>
        {porCaja > 1 && <Stepper l={`Cajas cerradas (de ${porCaja})`} v={cajas} onChange={setCajas} big />}
        <Stepper l={porCaja > 1 ? `${uniTxt(a.unidad, 2)} sueltas llenas` : `${uniTxt(a.unidad, 2)} llenas`} v={sueltas} onChange={setSueltas} big />
        {conAbierta && <Field l="Botella abierta" mb={0}><Seg full valor={String(abierta)} onChange={(k) => setAbierta(Number(k))} opciones={[{ k: "0", t: "Ninguna" }, { k: "0.25", t: "¼" }, { k: "0.5", t: "½" }, { k: "0.75", t: "¾" }]} /></Field>}
      </div>
      <div style={{ textAlign: "center", padding: "12px", borderRadius: 14, background: `color-mix(in srgb, ${f.c} 12%, var(--surface2))` }}>
        <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 700 }}>Queda </span><b style={{ fontSize: 26 }}>{num(total)} {uniTxt(a.unidad, total)}</b>
      </div>
      {onQuitar && <button disabled={busy} onClick={onQuitar} style={{ ...C.btnSm, marginTop: 12, color: "var(--muted)" }}>Dejar como sin contar</button>}
    </Sheet>
  );
}

/* ===================== CATÁLOGO ===================== */
function Catalogo({ d, busy, run, isMobile }) {
  const [edit, setEdit] = useState(null);
  const [verOcultos, setVerOcultos] = useState(false);
  const activos = d.articulos.filter(a => a.activo), ocultos = d.articulos.filter(a => !a.activo);
  const tieneMonteagudo = d.articulos.some(a => a.proveedor === "Monteagudo");
  const sembrar = () => run(() => crm.sembrarCatalogo(CATALOGO_MONTEAGUDO.filter(x => !d.articulos.some(a => a.codigo === x.codigo && a.proveedor === x.proveedor))), "Catálogo de Monteagudo cargado");
  const nuevo = () => setEdit({ nombre: "", familia: "destilado", unidad: "botella", ml: 700, porCaja: 1, coste: null, retornable: false, activo: true });
  if (!d.articulos.length) return (
    <section style={{ ...C.hero, padding: isMobile ? 18 : 26 }}>
      <Tile n="box" s={52} />
      <div style={{ fontWeight: 900, fontSize: 22, marginTop: 12 }}>Empieza con tu catálogo</div>
      <div style={{ fontSize: 14, color: "var(--muted)", marginTop: 6, lineHeight: 1.5, maxWidth: 580 }}>He preparado los <b style={{ color: "var(--text)" }}>32 artículos de Distribuciones Monteagudo</b> que salen en tus facturas, con su código, formato (70 cl, 1 L, caja de 24…) y el coste por botella sin IVA. Después puedes cambiar lo que quieras.</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
        <button disabled={busy} onClick={sembrar} style={{ ...C.btnPrimary, minHeight: 50, padding: "0 20px" }}><Icon n="box" s={18} />Cargar catálogo de Monteagudo</button>
        <button onClick={nuevo} style={C.btnGhost}><Icon n="plus" s={16} />Crear a mano</button>
      </div>
    </section>
  );
  return (<>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button onClick={nuevo} style={C.btnPrimary}><Icon n="plus" s={16} w={2.4} />Nuevo artículo</button>
      {!tieneMonteagudo && <button disabled={busy} onClick={sembrar} style={C.btnGhost}><Icon n="box" s={16} />Añadir los de Monteagudo</button>}
    </div>
    {FAMILIAS.map(f => { const xs = activos.filter(a => a.familia === f.k); if (!xs.length) return null; return (
      <section key={f.k} style={C.panel}>
        <Head i={f.i} c={f.c} t={f.t} sub={`${xs.length} ${xs.length === 1 ? "artículo" : "artículos"}${f.noAudita ? " · no cuentan como bebida" : ""}`} />
        {xs.map(a => (
          <button key={a.id} onClick={() => setEdit(a)} style={C.listBtn}>
            <Tile n={f.i} c={f.c} s={34} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.nombre}</b>
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{formato(a) && <span>{formato(a)}</span>}{a.codigo && <span>cód. {a.codigo}</span>}{a.confirmar && <Badge c="var(--amber)">Confirmar con proveedor</Badge>}</span>
            </span>
            <span style={{ textAlign: "right", flexShrink: 0 }}>{a.coste != null ? <><b style={{ display: "block", fontSize: 14.5 }}>{money(a.coste)}</b><span style={{ fontSize: 11, color: "var(--muted)" }}>por {uniTxt(a.unidad, 1)}</span></> : <span style={{ fontSize: 12, color: "var(--muted)" }}>Sin coste</span>}</span>
          </button>))}
      </section>); })}
    {ocultos.length > 0 && <div><button onClick={() => setVerOcultos(v => !v)} style={{ ...C.btnSm, color: "var(--muted)" }}><Icon n={verOcultos ? "eyeOff" : "eye"} s={14} />{verOcultos ? "Ocultar" : "Ver"} artículos ocultos ({ocultos.length})</button>
      {verOcultos && <section style={{ ...C.panel, marginTop: 8 }}>{ocultos.map(a => <button key={a.id} onClick={() => setEdit(a)} style={{ ...C.listBtn, opacity: .6 }}><Tile n={famInfo(a.familia).i} c={famInfo(a.familia).c} s={30} /><span style={{ flex: 1 }}>{a.nombre}</span><Icon n="right" s={16} c="var(--muted)" /></button>)}</section>}</div>}
    {edit && <ArtSheet a={edit} busy={busy} onClose={() => setEdit(null)} onSave={async (x) => { const ok = await run(() => crm.saveArticulo(x), x.id ? "Artículo guardado" : "Artículo creado"); if (ok) setEdit(null); }} />}
  </>);
}

function ArtSheet({ a, busy, onClose, onSave }) {
  const isMobile = useIsMobile();
  const [f, setF] = useState(() => ({ ...a, coste: a.coste != null ? String(a.coste).replace(".", ",") : "", ml: a.ml != null ? String(a.ml) : "", porCaja: String(a.porCaja || 1) }));
  const set = (p) => setF(x => ({ ...x, ...p }));
  const fam = famInfo(f.familia);
  const valido = f.nombre.trim().length > 0;
  const costeN = f.coste === "" ? null : parseImporte(f.coste);
  const porCaja = Math.max(1, parseInt(f.porCaja, 10) || 1);
  const Chips = ({ vals, v, onPick, fmt }) => <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>{vals.map(x => <button key={x} type="button" onClick={() => onPick(String(x))} style={{ ...C.seg, ...(String(v) === String(x) ? C.segOn : {}) }}>{fmt(x)}</button>)}</div>;
  return (
    <Sheet title={a.id ? "Editar artículo" : "Nuevo artículo"} onClose={onClose}
      footer={<button disabled={!valido || busy} onClick={() => onSave({ ...f, coste: costeN, ml: f.ml === "" ? null : parseImporte(f.ml), porCaja })} style={{ ...C.btnPrimary, width: "100%", minHeight: 52, fontSize: 16, opacity: valido && !busy ? 1 : .45 }}>{busy ? "Guardando…" : valido ? "Guardar" : "Escribe el nombre"}</button>}>
      <Field l="Nombre"><input autoFocus={!a.id} value={f.nombre} maxLength={80} onChange={e => set({ nombre: e.target.value })} placeholder="Ej.: Ginebra Larios 1 L" style={C.input} /></Field>
      <Field l="Familia"><IconGrid cols={isMobile ? 4 : 4} items={FAMILIAS.map(x => ({ k: x.k, t: x.corto, i: x.i, c: x.c }))} valor={f.familia} onChange={(k) => set({ familia: k })} /></Field>
      <Field l="Se cuenta por"><Seg full size="sm" valor={f.unidad} onChange={(k) => set({ unidad: k })} opciones={UNIDADES.slice(0, 4).map(u => ({ k: u.k, t: u.t }))} /></Field>
      {fam.medida === "ml" || f.unidad === "botella" || f.unidad === "lata" ? <Field l="Contenido de cada una (ml)">
        <Chips vals={[200, 237, 250, 330, 500, 700, 1000, 1500, 2000]} v={f.ml} onPick={(v) => set({ ml: v })} fmt={(x) => x >= 1000 ? `${String(x / 1000).replace(".", ",")} L` : `${x} ml`} />
        <input inputMode="numeric" value={f.ml} onChange={e => set({ ml: e.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder="ml" style={{ ...C.input, width: 140 }} />
      </Field> : null}
      <Field l="Unidades por caja">
        <Chips vals={[1, 6, 12, 24]} v={f.porCaja} onPick={(v) => set({ porCaja: v })} fmt={(x) => x === 1 ? "Sueltas" : `Caja de ${x}`} />
        <input inputMode="numeric" value={f.porCaja} onChange={e => set({ porCaja: e.target.value.replace(/\D/g, "").slice(0, 4) })} style={{ ...C.input, width: 140 }} aria-label="Unidades por caja" />
      </Field>
      <Field l={`Coste por ${uniTxt(f.unidad, 1)}, sin IVA`}>
        <MoneyInput value={f.coste} onChange={(v) => set({ coste: v })} placeholder="0,00" />
        {costeN != null && porCaja > 1 && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>= {money(costeN * porCaja)} la caja de {porCaja}</div>}
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field l="Proveedor"><input value={f.proveedor || ""} maxLength={80} onChange={e => set({ proveedor: e.target.value })} style={C.input} /></Field>
        <Field l="Código del proveedor"><input value={f.codigo || ""} maxLength={40} onChange={e => set({ codigo: e.target.value })} style={{ ...C.input, fontFamily: "monospace" }} /></Field>
      </div>
      <label style={{ ...C.toggleRow, marginBottom: 12 }}><span>Retornable (lleva envase con fianza)</span><Switch on={!!f.retornable} onClick={() => set({ retornable: !f.retornable })} /></label>
      <label style={{ ...C.toggleRow, marginBottom: 12 }}><span>Pendiente de confirmar con el proveedor</span><Switch on={!!f.confirmar} onClick={() => set({ confirmar: !f.confirmar })} /></label>
      {a.id && <label style={{ ...C.toggleRow, marginBottom: 4 }}><span>Visible en el catálogo</span><Switch on={f.activo !== false} onClick={() => set({ activo: f.activo === false })} /></label>}
    </Sheet>
  );
}

// ===================== CRM · STOCK · facturas, sobrante y almacén (fases 2 y 3) =====================
// Factura en PDF → revisión línea a línea → "Aplicar al stock" (entradas, devoluciones, envases y su gasto).
// Al cerrar: lo que sobra cerrado se devuelve al proveedor o se guarda en el almacén para el próximo evento.
import React, { useEffect, useMemo, useState } from "react";
import * as crm from "./crmdb";
import { money, r2, fechaCorta, useIsMobile, C, Icon, Tile, Badge, Seg, Head, Sheet, Field } from "./ui";
import { Vacio, Switch } from "./Ingresos";
import { famInfo, uniTxt, num, cantTxt, formato, articuloDesdeLinea, propuestaDevolucion, FAMILIAS } from "./stockModelo";
import { catsGasto } from "./categorias";
import { interpretarMonteagudo, leerPdf, unidadesLinea } from "./facturaPdf";

const QUIEN = "Admin";
const TIPO_DOC = { factura: ["Factura", "var(--green)"], abono: ["Abono", "#3b82f6"], mixta: ["Factura con devoluciones", "#a855f7"], devolucion: ["Devolución", "#3b82f6"] };
const ESTADO_DOC = { aplicado: ["Aplicada", "var(--green)"], anulado: ["Anulada", "var(--muted)"], entregada: ["Entregada · falta el abono", "var(--amber)"], abonada: ["Abonada", "var(--green)"], propuesta: ["Propuesta", "var(--muted)"] };
const ACCIONES = { entrada: ["Entra", "var(--green)"], devolucion: ["Devolución", "#3b82f6"], vincular: ["Ya devuelto", "#14b8a6"], ignorar: ["No se aplica", "var(--muted)"], pendiente: ["Elige artículo", "var(--amber)"] };

async function cargarPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const w = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = w.default;
  return pdfjs;
}
async function huellaDe(buf) {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, "0")).join("");
}
const eur = (v) => money(v);

/* ===================== SUBIR FACTURA (PDF) ===================== */
export function SubirFactura({ ev, d, busy, run, onClose, onAplicada }) {
  const isMobile = useIsMobile();
  const [estado, setEstado] = useState("elegir"); // elegir | leyendo | revisar | error
  const [error, setError] = useState("");
  const [doc, setDoc] = useState(null);        // lo leído del PDF
  const [huella, setHuella] = useState(null);
  const [lineas, setLineas] = useState([]);    // líneas con decisión
  const [edit, setEdit] = useState(null);      // índice de la línea en edición
  const [conGasto, setConGasto] = useState(true);
  const [actCoste, setActCoste] = useState(true);
  const [creando, setCreando] = useState(false);
  const sellado = d.conteo?.estado === "sellado";

  // Devoluciones entregadas que esperan su abono: unidades devueltas por artículo
  const pendAbono = useMemo(() => {
    const out = {};
    d.documentos.filter(x => x.tipo === "devolucion" && x.estado === "entregada").forEach(x => (x.lineas || []).forEach(l => { out[l.articuloId] = (out[l.articuloId] || 0) + (l.unidades || 0); }));
    return out;
  }, [d.documentos]);
  const artPorCodigo = (codigo, prov) => d.articulos.find(a => a.codigo === codigo && (!a.proveedor || a.proveedor === prov)) || d.articulos.find(a => a.codigo === codigo);

  const decidir = (l, articulo) => {
    if (!articulo) return { ...l, articuloId: null, accion: "pendiente", unidades: null };
    const u = unidadesLinea(l.cantidad, articulo);
    const accion = l.cantidad > 0 ? "entrada" : (pendAbono[articulo.id] > 0 ? "vincular" : "devolucion");
    return { ...l, articuloId: articulo.id, accion, unidades: u.unidades, cajas: u.cajas, sueltas: u.sueltas, dudosa: u.dudosa || articulo.confirmar };
  };
  // Si se crean artículos nuevos, las líneas que estaban sin artículo se enlazan solas por su código
  useEffect(() => { if (!doc) return; setLineas(ls => ls.map(l => (l.articuloId || l.accion === "ignorar") ? l : decidir(l, artPorCodigo(l.codigo, doc.proveedor)))); }, [d.articulos]);

  const leer = async (file) => {
    setError("");
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { setError("El PDF es demasiado grande (máximo 15 MB)."); return; }
    setEstado("leyendo");
    try {
      const buf = await file.arrayBuffer();
      const h = await huellaDe(buf.slice(0));
      const pdfjs = await cargarPdfjs();
      const r = interpretarMonteagudo(await leerPdf(buf, pdfjs));
      if (!r) { setEstado("error"); setError("Este PDF no lo reconozco todavía. Por ahora leo las facturas de Distribuciones Monteagudo; las demás se apuntan a mano en Entradas."); return; }
      const ya = await crm.buscarDocumento({ huella: h, proveedor: r.proveedor, numero: r.numero }).catch(() => null);
      if (ya) { setEstado("error"); setError(`La ${r.tipo === "abono" ? "factura de abono" : "factura"} ${r.numero || ""} ya está importada${ya.evento_id !== ev.id ? " en otro evento" : " en este evento"}. Si la importaste mal, anúlala primero en su evento.`); return; }
      setDoc(r); setHuella(h);
      setLineas(r.lineas.map((l, i) => decidir({ ...l, idx: i }, artPorCodigo(l.codigo, r.proveedor))));
      setEstado("revisar");
    } catch (e) { setEstado("error"); setError("No se ha podido leer el PDF. ¿Es una factura original (no una foto escaneada)?"); }
  };

  const artById = Object.fromEntries(d.articulos.map(a => [a.id, a]));
  const pendientes = lineas.filter(l => l.accion === "pendiente");
  const envaseLinea = (l) => l.articuloId && famInfo(artById[l.articuloId]?.familia).noAudita;
  const grupos = [
    { k: "pend", t: "Sin artículo: elige o crea", ls: pendientes },
    { k: "bebida", t: "Bebida y material", ls: lineas.filter(l => l.accion !== "pendiente" && !envaseLinea(l)) },
    { k: "envase", t: "Envases (van aparte)", ls: lineas.filter(l => l.accion !== "pendiente" && envaseLinea(l)) },
  ].filter(g => g.ls.length);
  const nEntra = lineas.filter(l => l.accion === "entrada").length, nDev = lineas.filter(l => l.accion === "devolucion").length, nVinc = lineas.filter(l => l.accion === "vincular").length;
  const ivas = doc?.pie?.ivas || [];
  const listo = doc && pendientes.length === 0 && lineas.some(l => l.accion !== "ignorar");
  const crearTodos = async () => {
    const nuevos = []; const vistos = new Set();
    pendientes.forEach(l => { if (!vistos.has(l.codigo)) { vistos.add(l.codigo); nuevos.push(articuloDesdeLinea(l.descripcion, l.codigo, doc.proveedor)); } });
    setCreando(true);
    await run(() => crm.sembrarCatalogo(nuevos.map((x, i) => ({ ...x, orden: 100 + i }))), `${nuevos.length} ${nuevos.length === 1 ? "artículo creado" : "artículos creados"} en el catálogo`);
    setCreando(false);
  };

  const aplicar = () => run(async () => {
    const cat = (catsGasto(true).find(c => c.k === "Barra y producto") || catsGasto(true)[0] || { k: "Barra y producto" }).k;
    const lineasDoc = lineas.map(l => ({ idx: l.idx, pagina: l.pagina, codigo: l.codigo, descripcion: l.descripcion, cantidad: l.cantidad, precio: l.precio, dto: l.dto, iva: l.iva, importe: l.importe, repetida: !!l.repetida, articuloId: l.articuloId, unidades: l.unidades, accion: l.accion }));
    const creado = await crm.crearDocumento({ eventoId: ev.id, proveedor: doc.proveedor, numero: doc.numero, fecha: doc.fecha, tipo: doc.tipo, estado: "aplicado", base: doc.checks.sumaLineas, total: doc.pie?.total ?? null, ivas, lineas: lineasDoc, huella });
    try {
      const movs = lineas.filter(l => l.accion === "entrada" || l.accion === "devolucion").map(l => ({
        eventoId: ev.id, articuloId: l.articuloId, tipo: l.accion, cantidad: Math.abs(l.unidades), cajas: l.cajas != null ? Math.abs(l.cajas) : null, sueltas: l.sueltas != null ? Math.abs(l.sueltas) : null,
        costeUnidad: l.unidades ? Math.abs(l.importe || 0) / Math.abs(l.unidades) : null, documento: doc.numero, documentoId: creado.id,
        trasRecuento: l.accion === "devolucion" && sellado, creadoPor: QUIEN, clave: `doc:${huella.slice(0, 24)}:${l.idx}`,
      }));
      await crm.addMovimientos(movs);
      if (actCoste) {
        const porArt = {};
        lineas.filter(l => l.accion === "entrada" && l.unidades > 0).forEach(l => { const x = porArt[l.articuloId] = porArt[l.articuloId] || { u: 0, v: 0 }; x.u += l.unidades; x.v += Math.abs(l.importe || 0); });
        for (const [id, x] of Object.entries(porArt)) { const a = artById[id]; if (a && x.u > 0) await crm.saveArticulo({ ...a, coste: Math.round(x.v / x.u * 10000) / 10000 }); }
      }
      const gastos = [];
      if (conGasto) {
        const etiqueta = doc.tipo === "abono" ? "Abono" : "Factura";
        for (const v of ivas) {
          const importe = r2((v.base || 0) + (v.cuota || 0));
          if (!importe) continue;
          const g = await crm.saveGasto({ eventoId: ev.id, tipo: "normal", categoria: cat, concepto: `${doc.proveedor} · ${etiqueta} ${doc.numero || ""}${ivas.length > 1 ? ` (IVA ${v.pct} %)` : ""}`.trim(), proveedor: doc.proveedor, previsto: null, real: importe, estado: "confirmado", fecha: doc.fecha, iva: v.pct, factura: true, nota: "Creado desde Stock al aplicar la factura" });
          gastos.push(g.id);
        }
      }
      const devs = nVinc ? d.documentos.filter(x => x.tipo === "devolucion" && x.estado === "entregada") : [];
      for (const dv of devs) await crm.actualizarDocumento(dv.id, { estado: "abonada", vinculoId: creado.id });
      await crm.actualizarDocumento(creado.id, { gastos, ...(devs[0] ? { vinculoId: devs[0].id } : {}) });
    } catch (e) {
      await crm.actualizarDocumento(creado.id, { estado: "anulado", huella: null }).catch(() => {});
      throw e;
    }
  }, `${TIPO_DOC[doc.tipo][0]} ${doc.numero || ""} aplicada al stock`).then(ok => { if (ok) { onAplicada?.(conGasto); onClose(); } });

  if (estado !== "revisar") return (
    <Sheet title="Subir factura del proveedor" onClose={onClose}>
      <label style={{ display: "flex", alignItems: "center", gap: 14, padding: 18, borderRadius: 16, border: "2px dashed var(--line)", cursor: estado === "leyendo" ? "wait" : "pointer", marginBottom: 14 }}>
        <Tile n="file" s={48} />
        <span style={{ flex: 1, minWidth: 0 }}><b style={{ display: "block", fontSize: 16 }}>{estado === "leyendo" ? "Leyendo la factura…" : "Elige el PDF de la factura o del abono"}</b><span style={{ fontSize: 12.5, color: "var(--muted)" }}>Se lee aquí mismo; el PDF no se sube a ningún sitio. Antes de tocar el stock podrás revisar cada línea.</span></span>
        <input type="file" accept="application/pdf,.pdf" disabled={estado === "leyendo"} onChange={e => leer(e.target.files?.[0])} style={{ display: "none" }} />
      </label>
      {error && <div style={{ display: "flex", gap: 8, color: "var(--amber)", fontWeight: 700, fontSize: 13.5, lineHeight: 1.45 }}><Icon n="alert" s={18} style={{ marginTop: 1 }} />{error}</div>}
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 12, lineHeight: 1.5 }}>Sirve para facturas normales, facturas con devoluciones y facturas de abono. Las cajas se convierten solas en botellas (por ejemplo, 10,583 cajas de 12 = 127 botellas).</div>
    </Sheet>
  );

  const ch = doc.checks;
  const cuadra = ch.cuadraBase && ch.cuadraIva && ch.cuadraTotal;
  const td = TIPO_DOC[doc.tipo];
  return (<>
    <Sheet title={`${td[0]} ${doc.numero || ""}`} onClose={onClose}
      footer={<div>
        {pendientes.length > 0 && <div style={{ fontSize: 12.5, color: "var(--amber)", fontWeight: 700, marginBottom: 8, textAlign: "center" }}>{pendientes.length} {pendientes.length === 1 ? "línea no tiene" : "líneas no tienen"} artículo: elígelo, créalo o márcala como «no se aplica».</div>}
        <button disabled={!listo || busy} onClick={aplicar} style={{ ...C.btnPrimary, width: "100%", minHeight: 54, fontSize: 16, opacity: listo && !busy ? 1 : .45 }}>{busy ? "Aplicando…" : `Aplicar al stock de ${ev.name}`}</button>
      </div>}>
      {/* Cabecera de la factura */}
      <div style={{ ...C.hero, padding: 14, borderRadius: 16, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}><Tile n="file" c={td[1]} s={38} /><span><b style={{ display: "block", fontSize: 16 }}>{doc.proveedor}</b><span style={{ fontSize: 12.5, color: "var(--muted)" }}>{doc.fecha ? new Date(doc.fecha + "T12:00:00").toLocaleDateString("es-ES") : ""} · {doc.lineas.length} líneas · {ch.codigos} códigos</span></span></span>
          <Badge c={td[1]}>{td[0]}</Badge>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3,minmax(0,1fr))", gap: 8, marginTop: 12 }}>
          <Mini l="Base" v={eur(ch.sumaLineas)} />
          <Mini l={ivas.length > 1 ? "IVA (21 % + 10 %)" : `IVA ${ivas[0]?.pct ?? ""} %`} v={eur(ivas.reduce((t, v) => t + (v.cuota || 0), 0))} />
          <Mini l="Total factura" v={eur(doc.pie?.total ?? 0)} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13, fontWeight: 800, color: cuadra ? "var(--green)" : "var(--amber)" }}>
          <Icon n={cuadra ? "check" : "alert"} s={16} w={2.4} />{cuadra ? "Las líneas suman exactamente el total de la factura" : "Las líneas no suman el total impreso: revisa antes de aplicar"}
        </div>
        {doc.avisos.length > 0 && <div style={{ fontSize: 12, color: "var(--amber)", marginTop: 6 }}>{doc.avisos.join(" · ")}</div>}
      </div>

      {/* Resumen de lo que va a pasar */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {nEntra > 0 && <Badge c="var(--green)"><Icon n="plus" s={11} w={2.6} />{nEntra} entran</Badge>}
        {nDev > 0 && <Badge c="#3b82f6"><Icon n="truck" s={11} w={2.2} />{nDev} devoluciones{sellado ? " (tras el recuento)" : ""}</Badge>}
        {nVinc > 0 && <Badge c="#14b8a6"><Icon n="link" s={11} w={2.2} />{nVinc} ya devueltas</Badge>}
        {pendientes.length > 0 && <Badge c="var(--amber)"><Icon n="alert" s={11} w={2.2} />{pendientes.length} sin artículo</Badge>}
      </div>
      {pendientes.length > 0 && <button disabled={busy || creando} onClick={crearTodos} style={{ ...C.btnGhost, width: "100%", marginBottom: 12 }}><Icon n="plus" s={16} />Crear en el catálogo los {new Set(pendientes.map(l => l.codigo)).size} artículos que faltan</button>}

      {grupos.map(g => (
        <div key={g.k} style={{ marginBottom: 12 }}>
          <div style={{ ...C.label, color: g.k === "pend" ? "var(--amber)" : undefined }}>{g.t}</div>
          {g.ls.map(l => <LineaFactura key={l.idx} l={l} a={artById[l.articuloId]} onClick={() => setEdit(l.idx)} />)}
        </div>
      ))}

      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 4 }}>
        <label style={{ ...C.toggleRow, marginBottom: 10 }}><span><b style={{ display: "block" }}>Crear el gasto en Gastos</b><span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>{ivas.map(v => `${eur(r2((v.base || 0) + (v.cuota || 0)))} con IVA ${v.pct} %`).join(" + ")} · con factura{doc.tipo === "abono" ? " (resta)" : ""}</span></span><Switch on={conGasto} onClick={() => setConGasto(v => !v)} /></label>
        {nEntra > 0 && <label style={C.toggleRow}><span><b style={{ display: "block" }}>Actualizar el coste del catálogo</b><span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>Con el precio de esta factura, ya con su descuento</span></span><Switch on={actCoste} onClick={() => setActCoste(v => !v)} /></label>}
      </div>
    </Sheet>
    {edit != null && <LineaSheet l={lineas.find(x => x.idx === edit)} articulos={d.articulos.filter(a => a.activo)} pendAbono={pendAbono} sellado={sellado}
      onClose={() => setEdit(null)}
      onSave={(cambios) => { setLineas(ls => ls.map(x => x.idx === edit ? cambios : x)); setEdit(null); }}
      decidir={decidir} artById={artById} />}
  </>);
}
const Mini = ({ l, v }) => <div style={{ padding: "8px 10px", borderRadius: 12, background: "var(--surface2)", border: "1px solid var(--line)", minWidth: 0 }}><div style={{ fontSize: 10.5, color: "var(--muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: .8 }}>{l}</div><div style={{ fontWeight: 900, fontSize: 16, marginTop: 2, whiteSpace: "nowrap" }}>{v}</div></div>;

function LineaFactura({ l, a, onClick }) {
  const f = a ? famInfo(a.familia) : null, ac = ACCIONES[l.accion];
  const pc = a?.porCaja || 1;
  const origen = `${num(l.cantidad, 3)}${pc > 1 ? ` ${Math.abs(l.cantidad) === 1 ? "caja" : "cajas"}` : ""}`;
  return (
    <button onClick={onClick} style={{ ...C.listBtn, alignItems: "flex-start", opacity: l.accion === "ignorar" ? .55 : 1 }}>
      {f ? <Tile n={f.i} c={f.c} s={34} /> : <Tile n="alert" c="var(--amber)" s={34} />}
      <span style={{ flex: 1, minWidth: 0 }}>
        <b style={{ display: "block", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: a ? "var(--text)" : "var(--amber)" }}>{a ? a.nombre : "Sin artículo en el catálogo"}</b>
        <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><span style={{ fontFamily: "monospace" }}>{l.codigo}</span> · {l.descripcion}</span>
        {a && l.unidades != null && <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, marginTop: 2 }}>{origen}{pc > 1 ? ` = ${num(l.unidades, 3)} ${uniTxt(a.unidad, l.unidades)}` : ` ${uniTxt(a.unidad, l.unidades)}`}</span>}
        <span style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
          {l.repetida && <Badge c="var(--amber)">Línea repetida en la factura</Badge>}
          {l.dudosa && <Badge c="var(--amber)">Unidad sin confirmar</Badge>}
        </span>
      </span>
      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
        <b style={{ fontSize: 14.5 }}>{money(l.importe || 0)}</b>
        <Badge c={ac[1]}>{ac[0]}</Badge>
      </span>
    </button>
  );
}

function LineaSheet({ l, articulos, pendAbono, sellado, onClose, onSave, decidir, artById }) {
  const [x, setX] = useState(l);
  const a = artById[x.articuloId];
  const elegir = (id) => setX(decidir({ ...l }, articulos.find(q => q.id === id)));
  const acciones = l.cantidad > 0 ? ["entrada", "ignorar"] : ["devolucion", ...(a && pendAbono[a.id] > 0 ? ["vincular"] : []), "ignorar"];
  const ok = x.accion === "ignorar" || (x.articuloId && x.unidades != null && Number(x.unidades) !== 0);
  return (
    <Sheet title={`Línea · código ${l.codigo}`} onClose={onClose}
      footer={<button disabled={!ok} onClick={() => onSave(x.articuloId || x.accion === "ignorar" ? x : { ...x, accion: "pendiente" })} style={{ ...C.btnPrimary, width: "100%", minHeight: 52, fontSize: 16, opacity: ok ? 1 : .45 }}>Listo</button>}>
      <div style={{ padding: 12, borderRadius: 12, background: "var(--surface2)", border: "1px solid var(--line)", marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: .8 }}>Tal cual en la factura (página {l.pagina})</div>
        <div style={{ fontWeight: 800, marginTop: 4 }}>{l.descripcion}</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>Cantidad {num(l.cantidad, 3)} · precio {money(l.precio || 0)}{l.dto ? ` · dto. ${num(l.dto)} %` : ""} · IVA {l.iva ?? "—"} % · importe <b style={{ color: "var(--text)" }}>{money(l.importe || 0)}</b></div>
      </div>
      <Field l="Artículo del catálogo">
        <select value={x.articuloId || ""} onChange={e => elegir(e.target.value)} style={{ ...C.input, padding: "11px 12px" }}>
          <option value="">— Elige el artículo —</option>
          {FAMILIAS.map(f => { const xs = articulos.filter(q => q.familia === f.k); return xs.length ? <optgroup key={f.k} label={f.t}>{xs.map(q => <option key={q.id} value={q.id}>{q.nombre}{q.codigo ? ` (${q.codigo})` : ""}</option>)}</optgroup> : null; })}
        </select>
      </Field>
      {a && x.accion !== "ignorar" && <Field l={`Cuántas ${uniTxt(a.unidad, 2)} son`}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input inputMode="decimal" value={String(Math.abs(x.unidades ?? 0)).replace(".", ",")} onChange={e => { const v = parseFloat(e.target.value.replace(/[^\d.,]/g, "").replace(",", ".")) || 0; setX({ ...x, unidades: Math.sign(l.cantidad) * v, dudosa: false }); }} style={{ ...C.input, width: 130, textAlign: "right", fontWeight: 900, fontSize: 18 }} />
          <span style={{ fontSize: 13, color: "var(--muted)" }}>{a.porCaja > 1 ? `${num(Math.abs(l.cantidad), 3)} cajas × ${a.porCaja}` : "1 por cada unidad de la factura"}</span>
        </div>
        {a.confirmar && <div style={{ fontSize: 12, color: "var(--amber)", marginTop: 6 }}>Este artículo está pendiente de confirmar con el proveedor (por ejemplo, si son paquetes o vasos). Corrige el número si hace falta.</div>}
      </Field>}
      <Field l="Qué hacer con esta línea" mb={4}>
        <Seg full size="sm" valor={x.accion} onChange={(k) => setX({ ...x, accion: k })} opciones={acciones.map(k => ({ k, t: ACCIONES[k][0], c: ACCIONES[k][1], ink: "#fff" }))} />
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, lineHeight: 1.45 }}>
          {x.accion === "entrada" && "Suma al stock del evento."}
          {x.accion === "devolucion" && (sellado ? "Resta del stock. Como el recuento ya está sellado, se entiende que sale de lo que sobró (no cambia el consumo)." : "Resta del stock del evento.")}
          {x.accion === "vincular" && "Ya la marcaste como devuelta en «Qué hacer con lo que sobra»: no se descuenta otra vez, solo se concilia el abono."}
          {x.accion === "ignorar" && "No toca el stock (por ejemplo, un portes o algo que no controlas)."}
        </div>
      </Field>
    </Sheet>
  );
}

/* ===================== LISTA DE FACTURAS ===================== */
export function Documentos({ ev, d, busy, run, onRecargarCRM }) {
  const [ver, setVer] = useState(null);
  const docs = d.documentos.filter(x => x.tipo !== "devolucion");
  if (!docs.length) return null;
  return (<>
    <section style={C.panel}>
      <Head i="file" t="Facturas y abonos del evento" sub="Toca una para ver sus líneas o anularla." />
      {docs.map(x => { const t = TIPO_DOC[x.tipo], e = ESTADO_DOC[x.estado]; return (
        <button key={x.id} onClick={() => setVer(x)} style={{ ...C.listBtn, opacity: x.estado === "anulado" ? .5 : 1 }}>
          <Tile n="file" c={t[1]} s={36} />
          <span style={{ flex: 1, minWidth: 0 }}><b style={{ display: "block" }}>{t[0]} {x.numero}</b><span style={{ fontSize: 12, color: "var(--muted)" }}>{x.proveedor} · {x.fecha ? fechaCorta(x.fecha) : ""} · {x.lineas.length} líneas</span></span>
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}><b>{money(x.total || 0)}</b><Badge c={e[1]}>{e[0]}</Badge></span>
        </button>); })}
    </section>
    {ver && <DocDetalle x={ver} d={d} busy={busy} onClose={() => setVer(null)}
      onAnular={async () => { const ok = await run(() => anularDocumento(ver, d), "Factura anulada: el stock y el gasto vuelven a como estaban"); if (ok) { setVer(null); onRecargarCRM?.(); } }} />}
  </>);
}
async function anularDocumento(x, d) {
  const anulados = new Set(d.movimientos.filter(m => m.tipo === "anulacion").map(m => m.anulaId));
  for (const m of d.movimientos.filter(m => m.documentoId === x.id && m.tipo !== "anulacion" && !anulados.has(m.id))) await crm.anularMovimiento(m, QUIEN);
  for (const g of x.gastos || []) await crm.deleteGasto(g).catch(() => {});
  for (const dv of d.documentos.filter(y => y.tipo === "devolucion" && y.vinculoId === x.id)) await crm.actualizarDocumento(dv.id, { estado: "entregada", vinculoId: null });
  await crm.actualizarDocumento(x.id, { estado: "anulado", huella: null, vinculoId: null });
}
function DocDetalle({ x, d, busy, onClose, onAnular }) {
  const [conf, setConf] = useState(false);
  const artById = Object.fromEntries(d.articulos.map(a => [a.id, a]));
  const t = TIPO_DOC[x.tipo];
  return (
    <Sheet title={`${t[0]} ${x.numero}`} onClose={onClose}
      footer={x.estado === "aplicado" ? (conf
        ? <div style={{ display: "flex", gap: 8 }}><button onClick={() => setConf(false)} style={{ ...C.btnGhost, flex: 1 }}>No</button><button disabled={busy} onClick={onAnular} style={{ ...C.btnGhost, flex: 2, color: "var(--red)", borderColor: "var(--red)" }}><Icon n="trash" s={16} />Sí, anular la factura</button></div>
        : <button onClick={() => setConf(true)} style={{ ...C.btnGhost, width: "100%", color: "var(--muted)" }}>Anular esta factura</button>) : null}>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>{x.proveedor} · {x.fecha ? new Date(x.fecha + "T12:00:00").toLocaleDateString("es-ES") : ""} · total {money(x.total || 0)}{x.gastos?.length ? " · con su gasto en Gastos" : ""}</div>
      {conf && <div style={{ fontSize: 13, color: "var(--amber)", fontWeight: 700, marginBottom: 10 }}>Se deshacen sus entradas y devoluciones y se borra su gasto. Después podrás volver a importarla.</div>}
      {x.lineas.map(l => <LineaFactura key={l.idx} l={l} a={artById[l.articuloId]} onClick={() => {}} />)}
    </Sheet>
  );
}

/* ===================== QUÉ HACER CON LO QUE SOBRA (devolver o guardar en el almacén) ===================== */
export function Sobrante({ ev, d, busy, run, isMobile, ir }) {
  const sellado = d.conteo?.estado === "sellado";
  const base = useMemo(() => propuestaDevolucion({ articulos: d.articulos, lineas: d.lineas, movimientos: d.movimientos }), [d]);
  const [plan, setPlan] = useState(() => Object.fromEntries(base.map(p => [p.a.id, { destino: p.a.familia === "vaso" ? "almacen" : "devolver", unidades: p.pendiente }])));
  useEffect(() => { setPlan(Object.fromEntries(base.map(p => [p.a.id, { destino: plan[p.a.id]?.destino || (p.a.familia === "vaso" ? "almacen" : "devolver"), unidades: p.pendiente }]))); }, [base]);
  const envases = d.articulos.filter(a => a.activo && famInfo(a.familia).noAudita);
  const [vacios, setVacios] = useState({});
  const costeDe = (a) => { const ms = d.movimientos.filter(m => m.articuloId === a.id && (m.tipo === "entrada" || m.tipo === "traspaso_entrada") && m.costeUnidad != null); const u = ms.reduce((t, m) => t + m.cantidad, 0); return u ? ms.reduce((t, m) => t + m.cantidad * m.costeUnidad, 0) / u : (a.coste || 0); };
  const devs = d.documentos.filter(x => x.tipo === "devolucion" && x.estado !== "anulado");
  const filas = base.filter(p => p.pendiente > 0);
  const aDevolver = filas.filter(p => plan[p.a.id]?.destino === "devolver" && plan[p.a.id]?.unidades > 0);
  const aAlmacen = filas.filter(p => plan[p.a.id]?.destino === "almacen" && plan[p.a.id]?.unidades > 0);
  const estimado = r2(aDevolver.reduce((t, p) => t + plan[p.a.id].unidades * costeDe(p.a), 0));
  const valorAlm = r2(aAlmacen.reduce((t, p) => t + plan[p.a.id].unidades * costeDe(p.a), 0));
  const nVacios = Object.values(vacios).reduce((t, v) => t + (v || 0), 0);

  const lineaTxt = (a, u) => { const pc = a.porCaja || 1; if (pc <= 1) return `${num(u)} ${uniTxt(a.unidad, u)}`; const c = Math.floor(u / pc + 1e-9), s = r2(u - c * pc); return [c ? `${c} ${c === 1 ? "caja" : "cajas"} de ${pc}` : null, s ? `${num(s)} ${uniTxt(a.unidad, s)}` : null].filter(Boolean).join(" + ") || `${num(u)} ${uniTxt(a.unidad, u)}`; };
  const mensaje = () => {
    const ls = aDevolver.map(p => `• ${lineaTxt(p.a, plan[p.a.id].unidades)} de ${p.a.nombre}${p.a.codigo ? ` (cód. ${p.a.codigo})` : ""}`);
    const vs = envases.filter(a => vacios[a.id] > 0).map(a => `• ${vacios[a.id]} ${vacios[a.id] === 1 ? "caja vacía" : "cajas vacías"} de ${a.nombre}`);
    return [`Hola, os devolvemos lo que ha sobrado de *${ev.name}*${ev.date ? ` (${ev.date.split("-").reverse().join("/")})` : ""}:`, "", ...ls, ...(vs.length ? ["", "Envases:", ...vs] : []), "", `Abono estimado: ${money(estimado)} + IVA.`, "Gracias."].join("\n");
  };
  const confirmar = () => run(async () => {
    let docId = null;
    if (aDevolver.length || nVacios) {
      const lineas = [...aDevolver.map(p => ({ articuloId: p.a.id, nombre: p.a.nombre, codigo: p.a.codigo, unidades: plan[p.a.id].unidades, coste: costeDe(p.a) })),
        ...envases.filter(a => vacios[a.id] > 0).map(a => ({ articuloId: a.id, nombre: a.nombre, codigo: a.codigo, unidades: vacios[a.id], coste: a.coste || 0, envase: true }))];
      const doc = await crm.crearDocumento({ eventoId: ev.id, proveedor: aDevolver[0]?.a.proveedor || envases[0]?.proveedor || "Proveedor", tipo: "devolucion", estado: "entregada", base: estimado, total: null, lineas });
      docId = doc.id;
      await crm.addMovimientos(lineas.map(l => ({ eventoId: ev.id, articuloId: l.articuloId, tipo: "devolucion", cantidad: l.unidades, costeUnidad: l.coste, documentoId: doc.id, trasRecuento: true, creadoPor: QUIEN, clave: `dev:${doc.id}:${l.articuloId}` })));
    }
    if (aAlmacen.length) await crm.addMovimientos(aAlmacen.map(p => ({ eventoId: ev.id, articuloId: p.a.id, tipo: "traspaso_salida", cantidad: plan[p.a.id].unidades, costeUnidad: costeDe(p.a), trasRecuento: true, creadoPor: QUIEN, nota: "Sobrante guardado en el almacén", clave: `alm:${ev.id}:${p.a.id}:${Date.now()}` })));
  }, aDevolver.length && aAlmacen.length ? "Devolución y almacén apuntados" : aAlmacen.length ? "Guardado en el almacén" : "Devolución apuntada");

  if (!sellado) return (
    <section style={C.panel}><Vacio i="clipboard" t="Primero sella el recuento final." sub="Así sé exactamente qué ha sobrado cerrado." /><div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}><button onClick={() => ir("recuento")} style={C.btnPrimary}><Icon n="clipboard" s={16} />Ir al recuento</button></div></section>
  );
  return (<>
    {devs.map(x => { const e = ESTADO_DOC[x.estado], abono = x.vinculoId ? d.documentos.find(y => y.id === x.vinculoId) : null; return (
      <section key={x.id} style={{ ...C.panel, borderColor: x.estado === "abonada" ? "var(--green)" : "color-mix(in srgb, var(--amber) 55%, transparent)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}><Tile n="truck" c="#3b82f6" s={38} /><span><b style={{ display: "block" }}>Devolución a {x.proveedor}</b><span style={{ fontSize: 12.5, color: "var(--muted)" }}>{fechaCorta(x.creadoEn.slice(0, 10))} · {x.lineas.length} artículos · estimado {money(x.base || 0)} + IVA</span></span></span>
          <Badge c={e[1]}>{e[0]}</Badge>
        </div>
        {x.estado === "entregada" && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>Cuando llegue la factura de abono, súbela en Entradas: se concilia con esta devolución sin descontar dos veces.</div>}
        {abono && <div style={{ fontSize: 13, marginTop: 8 }}>Abono real <b>{money(Math.abs(abono.base || 0))}</b> sin IVA · diferencia con lo estimado <b style={{ color: Math.abs(Math.abs(abono.base || 0) - (x.base || 0)) < 1 ? "var(--green)" : "var(--amber)" }}>{money(Math.abs(abono.base || 0) - (x.base || 0))}</b></div>}
      </section>); })}

    {filas.length === 0 ? (
      <section style={C.panel}><Vacio i="check" t="No queda nada cerrado por devolver ni guardar." sub={devs.length ? "Ya está todo apuntado." : "Según el recuento, no sobró nada cerrado."} /></section>
    ) : (<>
      <section style={{ ...C.hero, padding: isMobile ? 16 : 20 }}>
        <div style={C.label}>Lo que sobró cerrado · {ev.name}</div>
        <div style={{ fontSize: 14, color: "var(--muted)", marginTop: 4, lineHeight: 1.5 }}>Sale del recuento final. Decide qué se devuelve a {filas[0].a.proveedor || "proveedor"} y qué se guarda en el almacén para el próximo evento. Las botellas abiertas no cuentan.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
          <div style={{ padding: "10px 12px", borderRadius: 12, background: "var(--surface2)", border: "1px solid var(--line)" }}><div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: .8 }}>Se devuelve</div><div style={{ fontWeight: 900, fontSize: 19, color: "#60a5fa" }}>{money(estimado)}</div><div style={{ fontSize: 11, color: "var(--muted)" }}>abono estimado, sin IVA</div></div>
          <div style={{ padding: "10px 12px", borderRadius: 12, background: "var(--surface2)", border: "1px solid var(--line)" }}><div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: .8 }}>Se guarda</div><div style={{ fontWeight: 900, fontSize: 19, color: "#2dd4bf" }}>{money(valorAlm)}</div><div style={{ fontSize: 11, color: "var(--muted)" }}>en el almacén, a coste</div></div>
        </div>
      </section>
      <section style={C.panel}>
        <Head i="box" t="Artículo por artículo" right={<span style={{ display: "flex", gap: 6 }}><button onClick={() => setPlan(p => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { ...v, destino: "devolver" }])))} style={C.btnSm}>Todo devolver</button><button onClick={() => setPlan(p => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { ...v, destino: "almacen" }])))} style={C.btnSm}>Todo al almacén</button></span>} />
        {filas.map(p => { const f = famInfo(p.a.familia), x = plan[p.a.id] || { destino: "devolver", unidades: p.pendiente }; return (
          <div key={p.a.id} style={{ ...C.row, flexWrap: "wrap" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: "1 1 220px" }}><Tile n={f.i} c={f.c} s={34} /><span style={{ minWidth: 0 }}><b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.a.nombre}</b><span style={{ fontSize: 12, color: "var(--muted)" }}>{lineaTxt(p.a, x.unidades)}{p.yaDevuelto ? ` · ya salieron ${num(p.yaDevuelto)}` : ""}</span></span></span>
            <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginLeft: isMobile ? 44 : 0 }}>
              <input inputMode="decimal" value={String(x.unidades).replace(".", ",")} onChange={e => { const v = Math.min(p.pendiente, parseFloat(e.target.value.replace(/[^\d.,]/g, "").replace(",", ".")) || 0); setPlan(q => ({ ...q, [p.a.id]: { ...x, unidades: v } })); }} style={{ ...C.input, width: 70, textAlign: "right", fontWeight: 900, padding: "8px 10px" }} aria-label={`Unidades de ${p.a.nombre}`} />
              <Seg size="sm" valor={x.destino} onChange={(k) => setPlan(q => ({ ...q, [p.a.id]: { ...x, destino: k } }))} opciones={[{ k: "devolver", t: "Devolver", i: "truck", c: "#3b82f6" }, { k: "almacen", t: "Almacén", i: "box", c: "#14b8a6" }, { k: "nada", t: "Nada", c: "var(--surface)", ink: "var(--text)" }]} />
            </span>
          </div>); })}
      </section>
      {envases.length > 0 && aDevolver.length > 0 && (
        <section style={C.panel}>
          <Head i="crate" c="#64748b" t="Cajas vacías que devuelves" sub="Opcional. Bajan el saldo de envases, no el de bebida." />
          {envases.map(a => <div key={a.id} style={C.row}><span style={{ display: "flex", alignItems: "center", gap: 10 }}><Tile n="crate" c="#64748b" s={32} /><b>{a.nombre}</b></span><input inputMode="numeric" value={vacios[a.id] || ""} placeholder="0" onChange={e => setVacios(v => ({ ...v, [a.id]: parseInt(e.target.value.replace(/\D/g, "").slice(0, 4), 10) || 0 }))} style={{ ...C.input, width: 80, textAlign: "right", fontWeight: 900, padding: "8px 10px" }} aria-label={`Cajas vacías de ${a.nombre}`} /></div>)}
        </section>
      )}
      <div style={{ position: "sticky", bottom: 0, paddingTop: 12, paddingBottom: 4, background: "linear-gradient(transparent, var(--bg) 30%)", display: "flex", gap: 8, flexWrap: "wrap" }}>
        {aDevolver.length > 0 && <a href={`https://wa.me/?text=${encodeURIComponent(mensaje())}`} target="_blank" rel="noopener noreferrer" style={{ ...C.btnGhost, flex: "1 1 180px", textDecoration: "none", background: "rgba(37,211,102,.14)", borderColor: "rgba(37,211,102,.55)", color: "#4ade80", minHeight: 50 }}><Icon n="whatsapp" s={18} />Enviar la lista por WhatsApp</a>}
        <button disabled={busy || (!aDevolver.length && !aAlmacen.length && !nVacios)} onClick={confirmar} style={{ ...C.btnPrimary, flex: "2 1 220px", minHeight: 50, opacity: busy || (!aDevolver.length && !aAlmacen.length && !nVacios) ? .45 : 1 }}><Icon n="check" s={18} w={2.4} />{aDevolver.length && aAlmacen.length ? "Confirmar: entregado y guardado" : aAlmacen.length ? "Guardar en el almacén" : "Marcar como entregado"}</button>
      </div>
    </>)}
  </>);
}

/* ===================== ALMACÉN GENERAL (entre eventos) ===================== */
export function useAlmacen(dep) {
  const [alm, setAlm] = useState(null);
  const [err, setErr] = useState(false);
  const cargar = () => crm.loadAlmacen().then(setAlm).catch(() => setErr(true));
  useEffect(() => { cargar(); }, [dep]);
  return { alm, err, cargar };
}
export function Almacen({ d, busy, run, isMobile, alm, recargarAlm }) {
  const [ajuste, setAjuste] = useState(null);
  const [extra, setExtra] = useState(false);
  if (!alm) return <div style={{ color: "var(--muted)", padding: 30, textAlign: "center" }}>Cargando almacén…</div>;
  const filas = d.articulos.map(a => ({ a, q: alm.saldo[a.id] || 0, c: alm.costeMedio[a.id] ?? a.coste ?? 0 })).filter(x => Math.abs(x.q) > 0.0001);
  const valor = r2(filas.reduce((t, x) => t + Math.max(0, x.q) * x.c, 0));
  const ajustar = async (a, nuevo) => { const ok = await run(() => crm.ajustarAlmacen(a.id, r2(nuevo - (alm.saldo[a.id] || 0)), "Recuento del almacén", QUIEN), "Almacén actualizado"); if (ok) { await recargarAlm(); setAjuste(null); } };
  return (<>
    <section style={{ ...C.hero, padding: isMobile ? 16 : 22 }}>
      <div style={C.label}>Almacén general · todos los eventos</div>
      <div style={{ fontSize: isMobile ? 36 : 46, fontWeight: 900, letterSpacing: "-.02em", lineHeight: 1.05, marginTop: 4 }}>{money(valor)}</div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>{filas.length} {filas.length === 1 ? "artículo guardado" : "artículos guardados"}, a precio de coste. Lo que sobra de un evento se guarda aquí, y el siguiente lo toma desde «Traer del almacén».</div>
    </section>
    <section style={C.panel}>
      <Head i="box" c="#14b8a6" t="Qué hay en el almacén" right={<button onClick={() => setExtra(true)} style={C.btnSm}><Icon n="plus" s={14} />Apuntar lo que ya había</button>} />
      {filas.length === 0 && <Vacio i="box" t="El almacén está vacío." sub="Al cerrar un evento, en «Qué hacer con lo que sobra» elige «Almacén». Si ya tienes género guardado, apúntalo con el botón de arriba." />}
      {FAMILIAS.map(f => { const xs = filas.filter(x => x.a.familia === f.k); if (!xs.length) return null; return (
        <div key={f.k}>
          <div style={{ ...C.label, color: f.c, marginTop: 10 }}>{f.t}</div>
          {xs.map(x => (
            <button key={x.a.id} onClick={() => setAjuste(x.a)} style={C.listBtn}>
              <Tile n={f.i} c={f.c} s={34} />
              <span style={{ flex: 1, minWidth: 0 }}><b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.a.nombre}</b><span style={{ fontSize: 12, color: "var(--muted)" }}>{cantTxt(x.a, x.q)}</span></span>
              <span style={{ textAlign: "right", flexShrink: 0 }}><b style={{ display: "block" }}>{money(Math.max(0, x.q) * x.c)}</b><span style={{ fontSize: 11, color: "var(--muted)" }}>Ajustar</span></span>
            </button>))}
        </div>); })}
    </section>
    {(ajuste || extra) && <AjusteSheet a={ajuste} articulos={d.articulos.filter(a => a.activo && !famInfo(a.familia).noAudita)} actual={ajuste ? (alm.saldo[ajuste.id] || 0) : 0} busy={busy} onClose={() => { setAjuste(null); setExtra(false); }} onSave={ajustar} />}
  </>);
}
function AjusteSheet({ a: a0, articulos, actual, busy, onClose, onSave }) {
  const [id, setId] = useState(a0?.id || "");
  const a = a0 || articulos.find(x => x.id === id);
  const [cajas, setCajas] = useState(0), [sueltas, setSueltas] = useState(0);
  useEffect(() => { const pc = a?.porCaja || 1; const c = Math.floor(Math.max(0, actual) / pc + 1e-9); setCajas(pc > 1 ? c : 0); setSueltas(pc > 1 ? r2(Math.max(0, actual) - c * pc) : Math.max(0, actual)); }, [a?.id]);
  const total = a ? r2(cajas * (a.porCaja || 1) + sueltas) : 0;
  return (
    <Sheet title={a0 ? a0.nombre : "Apuntar lo que hay en el almacén"} onClose={onClose}
      footer={<button disabled={!a || busy || total === r2(actual)} onClick={() => onSave(a, total)} style={{ ...C.btnPrimary, width: "100%", minHeight: 52, fontSize: 16, opacity: a && total !== r2(actual) && !busy ? 1 : .45 }}>{a ? `Hay ${num(total)} ${uniTxt(a.unidad, total)}` : "Elige el artículo"}</button>}>
      {!a0 && <Field l="Artículo"><select value={id} onChange={e => setId(e.target.value)} style={{ ...C.input, padding: "11px 12px" }}><option value="">— Elige —</option>{FAMILIAS.map(f => { const xs = articulos.filter(q => q.familia === f.k); return xs.length ? <optgroup key={f.k} label={f.t}>{xs.map(q => <option key={q.id} value={q.id}>{q.nombre}</option>)}</optgroup> : null; })}</select></Field>}
      {a && <>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>Cuenta lo que hay ahora en el almacén. Ahora mismo figura: <b style={{ color: "var(--text)" }}>{cantTxt(a, actual)}</b>.</div>
        <div style={{ display: "grid", gridTemplateColumns: (a.porCaja || 1) > 1 ? "1fr 1fr" : "1fr", gap: 12 }}>
          {(a.porCaja || 1) > 1 && <NumStep l={`Cajas de ${a.porCaja}`} v={cajas} onChange={setCajas} />}
          <NumStep l={(a.porCaja || 1) > 1 ? `${uniTxt(a.unidad, 2)} sueltas` : uniTxt(a.unidad, 2)} v={sueltas} onChange={setSueltas} />
        </div>
      </>}
    </Sheet>
  );
}
const NumStep = ({ l, v, onChange }) => (
  <div><div style={{ ...C.label, textAlign: "center" }}>{l}</div>
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <button type="button" onClick={() => onChange(Math.max(0, v - 1))} aria-label={`Quitar ${l}`} style={{ width: 48, height: 48, borderRadius: 14, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", display: "grid", placeItems: "center", cursor: "pointer" }}><Icon n="minus" s={20} w={2.6} /></button>
      <input inputMode="decimal" value={String(v).replace(".", ",")} onChange={e => onChange(parseFloat(e.target.value.replace(/[^\d.,]/g, "").replace(",", ".")) || 0)} onFocus={e => e.target.select()} aria-label={l} style={{ ...C.input, textAlign: "center", fontWeight: 900, fontSize: 22, padding: "8px 4px", minWidth: 0 }} />
      <button type="button" onClick={() => onChange(v + 1)} aria-label={`Añadir ${l}`} style={{ width: 48, height: 48, borderRadius: 14, border: "none", background: "var(--accent)", color: "#fff", display: "grid", placeItems: "center", cursor: "pointer" }}><Icon n="plus" s={20} w={2.6} /></button>
    </div>
  </div>
);

// Traer género del almacén al evento abierto
export function TraerAlmacen({ ev, d, alm, busy, run, onClose, onHecho }) {
  const filas = d.articulos.map(a => ({ a, q: alm?.saldo[a.id] || 0, c: alm?.costeMedio[a.id] ?? a.coste ?? null })).filter(x => x.q > 0.0001);
  const [sel, setSel] = useState({});
  const total = Object.values(sel).reduce((t, v) => t + (v || 0), 0);
  const traer = async () => {
    const ok = await run(() => crm.addMovimientos(filas.filter(x => sel[x.a.id] > 0).map(x => ({ eventoId: ev.id, articuloId: x.a.id, tipo: "traspaso_entrada", cantidad: Math.min(x.q, sel[x.a.id]), costeUnidad: x.c, creadoPor: QUIEN, nota: "Traído del almacén", clave: `almin:${ev.id}:${x.a.id}:${Date.now()}` }))), "Traído del almacén al evento");
    if (ok) { onHecho?.(); onClose(); }
  };
  return (
    <Sheet title={`Traer del almacén a ${ev.name}`} onClose={onClose}
      footer={<div style={{ display: "flex", gap: 8 }}><button onClick={() => setSel(Object.fromEntries(filas.map(x => [x.a.id, x.q])))} style={C.btnGhost}>Todo</button><button disabled={!total || busy} onClick={traer} style={{ ...C.btnPrimary, flex: 1, minHeight: 52, fontSize: 16, opacity: total && !busy ? 1 : .45 }}>{total ? "Traer al evento" : "Elige qué traer"}</button></div>}>
      {filas.length === 0 && <Vacio i="box" t="El almacén está vacío." />}
      {filas.map(x => { const f = famInfo(x.a.familia); return (
        <div key={x.a.id} style={{ ...C.row, flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: "1 1 200px" }}><Tile n={f.i} c={f.c} s={34} /><span style={{ minWidth: 0 }}><b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.a.nombre}</b><span style={{ fontSize: 12, color: "var(--muted)" }}>Hay {cantTxt(x.a, x.q)}</span></span></span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input inputMode="decimal" placeholder="0" value={sel[x.a.id] ? String(sel[x.a.id]).replace(".", ",") : ""} onChange={e => { const v = Math.min(x.q, parseFloat(e.target.value.replace(/[^\d.,]/g, "").replace(",", ".")) || 0); setSel(s => ({ ...s, [x.a.id]: v })); }} style={{ ...C.input, width: 80, textAlign: "right", fontWeight: 900, padding: "8px 10px" }} aria-label={`Traer ${x.a.nombre}`} />
            <button onClick={() => setSel(s => ({ ...s, [x.a.id]: x.q }))} style={C.btnSm}>Todo</button>
          </span>
        </div>); })}
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>Se apunta en el evento como entrada «Del almacén», con su coste, y sale del almacén.</div>
    </Sheet>
  );
}

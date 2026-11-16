// ===================== CRM · STOCK · facturas, sobrante y almacén (fases 2 y 3) =====================
// Factura en PDF → revisión línea a línea → "Aplicar al stock" (entradas, devoluciones, envases y su gasto).
// Al cerrar: lo que sobra cerrado se devuelve al proveedor o se guarda en el almacén para el próximo evento.
import React, { useEffect, useMemo, useState } from "react";
import * as crm from "./crmdb";
import { money, r2, fechaCorta, useIsMobile, C, Icon, Tile, Badge, Seg, Head, Sheet, Field } from "./ui";
import { Vacio, Switch } from "./Ingresos";
import { famInfo, uniTxt, num, cantTxt, formato, articuloDesdeLinea, repartoSobrante, cantAbierta, valorAlmacen, IVA_FAMILIA, cuentasPedido, FAMILIAS } from "./stockModelo";
import { catsGasto } from "./categorias";
import { interpretarMonteagudo, interpretarGenerico, leerPdf, unidadesLinea } from "./facturaPdf";

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
  // Por código del proveedor; si la factura no trae códigos, por el nombre (el que se creó a partir de esta misma descripción)
  const artPorCodigo = (codigo, prov, desc) => {
    if (codigo) { const a = d.articulos.find(a => a.codigo === codigo && (!a.proveedor || a.proveedor === prov)) || d.articulos.find(a => a.codigo === codigo && !a.proveedor); if (a) return a; }
    const n = desc ? articuloDesdeLinea(desc, "", prov).nombre.toLowerCase() : null;
    return n ? d.articulos.find(a => a.nombre.toLowerCase() === n && (!a.proveedor || a.proveedor === prov)) || null : null;
  };

  const decidir = (l, articulo) => {
    if (!articulo) return { ...l, articuloId: null, accion: "pendiente", unidades: null };
    const u = unidadesLinea(l.cantidad, articulo);
    const accion = l.cantidad > 0 ? "entrada" : (pendAbono[articulo.id] > 0 ? "vincular" : "devolucion");
    return { ...l, articuloId: articulo.id, accion, unidades: u.unidades, cajas: u.cajas, sueltas: u.sueltas, dudosa: u.dudosa || articulo.confirmar };
  };
  // Si se crean artículos nuevos, las líneas que estaban sin artículo se enlazan solas por su código
  useEffect(() => { if (!doc) return; setLineas(ls => ls.map(l => (l.articuloId || l.accion === "ignorar") ? l : decidir(l, artPorCodigo(l.codigo, doc.proveedor, l.descripcion)))); }, [d.articulos]);

  const leer = async (file) => {
    setError("");
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { setError("El PDF es demasiado grande (máximo 15 MB)."); return; }
    setEstado("leyendo");
    try {
      const buf = await file.arrayBuffer();
      const h = await huellaDe(buf.slice(0));
      const pdfjs = await cargarPdfjs();
      const paginas = await leerPdf(buf, pdfjs);
      if (!paginas.some(p => p.items.length > 5)) { setEstado("error"); setError("Este PDF no tiene texto: parece una foto o un escaneo. Esos no se pueden leer; apunta la entrada a mano o pide al proveedor la factura en PDF original."); return; }
      // Monteagudo con su lector exacto; el resto, con el lector general (se revisa todo antes de aplicar)
      const r = interpretarMonteagudo(paginas) || interpretarGenerico(paginas);
      if (!r) { setEstado("error"); setError("No encuentro la tabla de productos en este PDF (necesito una cabecera tipo «Descripción · Cantidad · Importe»). Apunta la entrada a mano en Entradas y, si me pasas el PDF, lo enseño a leerlo."); return; }
      const ya = await crm.buscarDocumento({ huella: h, proveedor: r.proveedor, numero: r.numero }).catch(() => null);
      if (ya) { setEstado("error"); setError(`La ${r.tipo === "abono" ? "factura de abono" : "factura"} ${r.numero || ""} ya está importada${ya.evento_id !== ev.id ? " en otro evento" : " en este evento"}. Si la importaste mal, anúlala primero en su evento.`); return; }
      setDoc(r); setHuella(h); setConGasto((r.pie?.ivas || []).length > 0);
      setLineas(r.lineas.map((l, i) => decidir({ ...l, idx: i }, artPorCodigo(l.codigo, r.proveedor, l.descripcion))));
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
    pendientes.forEach(l => { const k = l.codigo || l.descripcion; if (!vistos.has(k)) { vistos.add(k); nuevos.push(articuloDesdeLinea(l.descripcion, l.codigo, doc.proveedor)); } });
    setCreando(true);
    await run(() => crm.sembrarCatalogo(nuevos.map((x, i) => ({ ...x, orden: 100 + i }))), `${nuevos.length} ${nuevos.length === 1 ? "artículo creado" : "artículos creados"} en el catálogo`);
    setCreando(false);
  };

  const aplicar = () => run(async () => {
    const cat = (catsGasto(true).find(c => c.k === "Barra y producto") || catsGasto(true)[0] || { k: "Barra y producto" }).k;
    const lineasDoc = lineas.map(l => ({ idx: l.idx, pagina: l.pagina, codigo: l.codigo, descripcion: l.descripcion, cantidad: l.cantidad, precio: l.precio, dto: l.dto, iva: l.iva, importe: l.importe, repetida: !!l.repetida, articuloId: l.articuloId, unidades: l.unidades, accion: l.accion }));
    const numero = doc.albaran ? `ALB ${doc.numero || ""}`.trim().slice(0, 40) : doc.numero;
    const creado = await crm.crearDocumento({ eventoId: ev.id, proveedor: (doc.proveedor || "Proveedor").trim().slice(0, 80), numero, fecha: doc.fecha, tipo: doc.tipo, estado: "aplicado", base: doc.checks.sumaLineas, total: doc.pie?.total ?? null, ivas, lineas: lineasDoc, huella });
    try {
      const movs = lineas.filter(l => l.accion === "entrada" || l.accion === "devolucion").map(l => ({
        eventoId: ev.id, articuloId: l.articuloId, tipo: l.accion, cantidad: Math.abs(l.unidades), cajas: l.cajas != null ? Math.abs(l.cajas) : null, sueltas: l.sueltas != null ? Math.abs(l.sueltas) : null,
        // Sin importe (albarán sin precios): sin coste en la entrada → se usa el del catálogo
        costeUnidad: l.unidades && l.importe != null ? Math.abs(l.importe) / Math.abs(l.unidades) : null, documento: numero, documentoId: creado.id,
        trasRecuento: l.accion === "devolucion" && sellado, creadoPor: QUIEN, clave: `doc:${huella.slice(0, 24)}:${l.idx}`,
      }));
      await crm.addMovimientos(movs);
      if (actCoste) {
        const porArt = {};
        lineas.filter(l => l.accion === "entrada" && l.unidades > 0 && l.importe != null).forEach(l => { const x = porArt[l.articuloId] = porArt[l.articuloId] || { u: 0, v: 0 }; x.u += l.unidades; x.v += Math.abs(l.importe || 0); });
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
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 12, lineHeight: 1.5 }}>Sirve para facturas, facturas con devoluciones, abonos y albaranes. Las de Distribuciones Monteagudo se leen al céntimo; las de otros proveedores, con un lector general que hay que revisar línea a línea. Las fotos o escaneos no se pueden leer. Las cajas se convierten solas en botellas (por ejemplo, 10,583 cajas de 12 = 127 botellas).</div>
    </Sheet>
  );

  const ch = doc.checks;
  const cuadra = ch.cuadraBase && ch.cuadraIva && ch.cuadraTotal;
  const sinComprobar = doc.generico && !ch.comprobado;
  const td = doc.albaran ? ["Albarán", "var(--green)"] : TIPO_DOC[doc.tipo];
  return (<>
    <Sheet title={`${td[0]} ${doc.numero || ""}`} onClose={onClose}
      footer={<div>
        {pendientes.length > 0 && <div style={{ fontSize: 12.5, color: "var(--amber)", fontWeight: 700, marginBottom: 8, textAlign: "center" }}>{pendientes.length} {pendientes.length === 1 ? "línea no tiene" : "líneas no tienen"} artículo: elígelo, créalo o márcala como «no se aplica».</div>}
        <button disabled={!listo || busy} onClick={aplicar} style={{ ...C.btnPrimary, width: "100%", minHeight: 54, fontSize: 16, opacity: listo && !busy ? 1 : .45 }}>{busy ? "Aplicando…" : `Aplicar al stock de ${ev.name}`}</button>
      </div>}>
      {/* Cabecera de la factura */}
      <div style={{ ...C.hero, padding: 14, borderRadius: 16, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: "1 1 200px" }}><Tile n="file" c={td[1]} s={38} /><span style={{ minWidth: 0, flex: 1 }}>{doc.generico
            ? <input aria-label="Proveedor" value={doc.proveedor} maxLength={80} onChange={e => setDoc(x => ({ ...x, proveedor: e.target.value }))} style={{ ...C.input, fontWeight: 900, fontSize: 16, padding: "6px 10px", marginBottom: 4 }} />
            : <b style={{ display: "block", fontSize: 16 }}>{doc.proveedor}</b>}<span style={{ fontSize: 12.5, color: "var(--muted)" }}>{doc.fecha ? new Date(doc.fecha + "T12:00:00").toLocaleDateString("es-ES") : ""} · {doc.lineas.length} líneas · {ch.codigos} códigos</span></span></span>
          <Badge c={td[1]}>{td[0]}</Badge>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3,minmax(0,1fr))", gap: 8, marginTop: 12 }}>
          <Mini l="Base" v={eur(ch.sumaLineas)} />
          <Mini l={ivas.length > 1 ? "IVA (21 % + 10 %)" : `IVA ${ivas[0]?.pct ?? ""} %`} v={eur(ivas.reduce((t, v) => t + (v.cuota || 0), 0))} />
          <Mini l="Total factura" v={eur(doc.pie?.total ?? 0)} />
        </div>
        {doc.generico && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10, lineHeight: 1.45 }}>Leída con el lector general: comprueba el proveedor, cada artículo y las cantidades antes de aplicar.</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13, fontWeight: 800, color: cuadra && !sinComprobar ? "var(--green)" : "var(--amber)" }}>
          <Icon n={cuadra && !sinComprobar ? "check" : "alert"} s={16} w={2.4} />{sinComprobar ? "No he podido leer el total impreso: compáralo tú con la base de arriba" : cuadra ? "Las líneas suman exactamente el total de la factura" : "Las líneas no suman el total impreso: revisa antes de aplicar"}
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
        {ivas.length > 0
          ? <label style={{ ...C.toggleRow, marginBottom: 10 }}><span><b style={{ display: "block" }}>Crear el gasto en Gastos</b><span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>{ivas.map(v => `${eur(r2((v.base || 0) + (v.cuota || 0)))} con IVA ${v.pct} %`).join(" + ")} · con factura{doc.tipo === "abono" ? " (resta)" : ""}</span></span><Switch on={conGasto} onClick={() => setConGasto(v => !v)} /></label>
          : <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>{doc.albaran ? "Es un albarán: el gasto se apunta cuando llegue la factura." : "No he leído el IVA de este documento: apunta el gasto a mano en Gastos."}</div>}
        {nEntra > 0 && <label style={C.toggleRow}><span><b style={{ display: "block" }}>Actualizar el coste del catálogo</b><span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>Con el precio de esta factura, ya con su descuento</span></span><Switch on={actCoste} onClick={() => setActCoste(v => !v)} /></label>}
      </div>
    </Sheet>
    {edit != null && <LineaSheet l={lineas.find(x => x.idx === edit)} articulos={d.articulos.filter(a => a.activo)} pendAbono={pendAbono} sellado={sellado}
      onClose={() => setEdit(null)}
      onSave={(cambios) => { setLineas(ls => ls.map(x => x.idx === edit ? cambios : x)); setEdit(null); }}
      decidir={decidir} artById={artById} />}
  </>);
}
const Mini = ({ l, v }) => <div style={{ padding: "8px 10px", borderRadius: 12, background: "var(--surface2)", border: "1px solid var(--line)", minWidth: 0 }}><div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: .8 }}>{l}</div><div style={{ fontWeight: 900, fontSize: 16, marginTop: 2, whiteSpace: "nowrap" }}>{v}</div></div>;

function LineaFactura({ l, a, onClick }) {
  const f = a ? famInfo(a.familia) : null, ac = ACCIONES[l.accion];
  const pc = a?.porCaja || 1;
  const origen = `${num(l.cantidad, 3)}${pc > 1 ? ` ${Math.abs(l.cantidad) === 1 ? "caja" : "cajas"}` : ""}`;
  return (
    <button onClick={onClick} style={{ ...C.listBtn, alignItems: "flex-start", opacity: l.accion === "ignorar" ? .55 : 1 }}>
      {f ? <Tile n={f.i} c={f.c} s={34} /> : <Tile n="alert" c="var(--amber)" s={34} />}
      <span style={{ flex: 1, minWidth: 0 }}>
        <b style={{ display: "block", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: a ? "var(--text)" : "var(--amber)" }}>{a ? a.nombre : "Sin artículo en el catálogo"}</b>
        <span style={{ display: "block", fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.codigo ? <><span style={{ fontFamily: "monospace" }}>{l.codigo}</span> · </> : null}{l.descripcion}</span>
        {a && l.unidades != null && <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, marginTop: 2 }}>{origen}{pc > 1 ? ` = ${num(l.unidades, 3)} ${uniTxt(a.unidad, l.unidades)}` : ` ${uniTxt(a.unidad, l.unidades)}`}</span>}
        <span style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
          {l.repetida && <Badge c="var(--amber)">Línea repetida en la factura</Badge>}
          {l.dudosa && <Badge c="var(--amber)">Unidad sin confirmar</Badge>}
        </span>
      </span>
      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
        <b style={{ fontSize: 14.5, color: l.importe == null ? "var(--muted)" : undefined }}>{l.importe == null ? "Sin precio" : money(l.importe)}</b>
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
    <Sheet title={l.codigo ? `Línea · código ${l.codigo}` : "Línea de la factura"} onClose={onClose}
      footer={<button disabled={!ok} onClick={() => onSave(x.articuloId || x.accion === "ignorar" ? x : { ...x, accion: "pendiente" })} style={{ ...C.btnPrimary, width: "100%", minHeight: 52, fontSize: 16, opacity: ok ? 1 : .45 }}>Listo</button>}>
      <div style={{ padding: 12, borderRadius: 12, background: "var(--surface2)", border: "1px solid var(--line)", marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: .8 }}>Tal cual en la factura (página {l.pagina})</div>
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
  // Reparto: lo cerrado y lleno se puede devolver; lo abierto y los packs incompletos van al almacén
  const base = useMemo(() => repartoSobrante({ articulos: d.articulos, lineas: d.lineas, movimientos: d.movimientos }), [d]);
  const filas = base.filter(p => p.pendiente > 0);
  const [plan, setPlan] = useState({});            // { artId: { devolver: unidades, guardar: el resto va al almacén } }
  useEffect(() => { setPlan(q => Object.fromEntries(filas.map(p => [p.a.id, { devolver: Math.min(q[p.a.id]?.devolver ?? p.propDevolver, p.devolverMax), guardar: q[p.a.id]?.guardar ?? true }]))); }, [base]);
  const planDe = (p) => plan[p.a.id] || { devolver: p.propDevolver, guardar: true };
  const devolverU = (p) => Math.max(0, Math.min(planDe(p).devolver, p.devolverMax));
  const restoU = (p) => r2(p.pendiente - devolverU(p));
  const almacenU = (p) => (planDe(p).guardar ? restoU(p) : 0);
  const setDevolver = (p, v) => setPlan(q => ({ ...q, [p.a.id]: { ...planDe(p), devolver: Math.max(0, Math.min(p.devolverMax, Math.round(Number(v) || 0))) } }));
  const envases = d.articulos.filter(a => a.activo && famInfo(a.familia).noAudita);
  const [vacios, setVacios] = useState({});
  const costeDe = (a) => { const ms = d.movimientos.filter(m => m.articuloId === a.id && (m.tipo === "entrada" || m.tipo === "traspaso_entrada") && m.costeUnidad != null); const u = ms.reduce((t, m) => t + m.cantidad, 0); return u ? ms.reduce((t, m) => t + m.cantidad * m.costeUnidad, 0) / u : (a.coste || 0); };
  const devs = d.documentos.filter(x => x.tipo === "devolucion" && x.estado !== "anulado");
  const aDevolver = filas.filter(p => devolverU(p) > 0);
  const aAlmacen = filas.filter(p => almacenU(p) > 0);
  const estimado = r2(aDevolver.reduce((t, p) => t + devolverU(p) * costeDe(p.a), 0));
  const valorAlm = r2(aAlmacen.reduce((t, p) => t + almacenU(p) * costeDe(p.a), 0));
  const nVacios = Object.values(vacios).reduce((t, v) => t + (v || 0), 0);
  // Cajas vacías que siguen fuera (cargadas y aún no devueltas): se pueden devolver aunque no sobre bebida
  const anulados = useMemo(() => new Set(d.movimientos.filter(m => m.tipo === "anulacion").map(m => m.anulaId)), [d.movimientos]);
  const envPend = Object.fromEntries(envases.map(a => { const ms = d.movimientos.filter(m => m.articuloId === a.id && !anulados.has(m.id));
    const q = ms.reduce((t, m) => t + (m.tipo === "entrada" || m.tipo === "traspaso_entrada" ? m.cantidad : m.tipo === "devolucion" || m.tipo === "traspaso_salida" ? -m.cantidad : 0), 0); return [a.id, Math.max(0, r2(q))]; }));
  const envasesCon = envases.filter(a => envPend[a.id] > 0);
  const envVal = r2(envases.reduce((t, a) => t + (vacios[a.id] || 0) * costeDe(a), 0));
  const abonoTotal = r2(estimado + envVal);
  // Cuentas del pedido: lo que entró, lo que vuelve, lo que se guarda y lo que de verdad cuesta (sin IVA)
  const cuentas = useMemo(() => cuentasPedido({ articulos: d.articulos, movimientos: d.movimientos,
    plan: [...aDevolver.map(p => ({ articuloId: p.a.id, destino: "devolver", unidades: devolverU(p) })), ...aAlmacen.map(p => ({ articuloId: p.a.id, destino: "almacen", unidades: almacenU(p) }))], vacios }), [d, plan, vacios]);

  const queda = (p) => [p.cajas ? `${num(p.cajas, 0)} ${p.cajas === 1 ? "caja" : "cajas"} de ${p.a.porCaja}` : null, p.sueltas ? `${num(p.sueltas)} ${uniTxt(p.a.unidad, p.sueltas)}${p.cajas ? " sueltas" : ""}` : null, p.abierta ? `${({ 0.25: "¼", 0.5: "½", 0.75: "¾" })[p.abierta] || num(p.abierta)} abierta` : null].filter(Boolean).join(" + ") || cantAbierta(p.a, p.total);
  const lineaTxt = (a, u) => { const pc = a.porCaja || 1; if (pc <= 1) return `${num(u)} ${uniTxt(a.unidad, u)}`; const c = Math.floor(u / pc + 1e-9), s = r2(u - c * pc); return [c ? `${c} ${c === 1 ? "caja" : "cajas"} de ${pc}` : null, s ? `${num(s)} ${uniTxt(a.unidad, s)}` : null].filter(Boolean).join(" + ") || `${num(u)} ${uniTxt(a.unidad, u)}`; };
  const mensaje = () => {
    const ls = aDevolver.map(p => `• ${lineaTxt(p.a, devolverU(p))} de ${p.a.nombre}${p.a.codigo ? ` (cód. ${p.a.codigo})` : ""}`);
    const vs = envases.filter(a => vacios[a.id] > 0).map(a => `• ${vacios[a.id]} ${vacios[a.id] === 1 ? "caja vacía" : "cajas vacías"} de ${a.nombre}`);
    return [`Hola, os devolvemos lo que ha sobrado de *${ev.name}*${ev.date ? ` (${ev.date.split("-").reverse().join("/")})` : ""}:`, "", ...ls, ...(vs.length ? ["", "Envases:", ...vs] : []), "", envVal > 0 && estimado > 0 ? `Abono estimado: ${money(estimado)} de bebida + ${money(envVal)} de envases = ${money(abonoTotal)} + IVA.` : `Abono estimado: ${money(abonoTotal)} + IVA.`, "Gracias."].join("\n");
  };
  const confirmar = () => run(async () => {
    let docId = null;
    if (aDevolver.length || nVacios) {
      const lineas = [...aDevolver.map(p => ({ articuloId: p.a.id, nombre: p.a.nombre, codigo: p.a.codigo, unidades: devolverU(p), coste: costeDe(p.a) })),
        ...envases.filter(a => vacios[a.id] > 0).map(a => ({ articuloId: a.id, nombre: a.nombre, codigo: a.codigo, unidades: Math.min(vacios[a.id], envPend[a.id] || 0), coste: costeDe(a), envase: true })).filter(l => l.unidades > 0)];
      const doc = await crm.crearDocumento({ eventoId: ev.id, proveedor: aDevolver[0]?.a.proveedor || envasesCon.find(a => vacios[a.id] > 0)?.proveedor || "Proveedor", tipo: "devolucion", estado: "entregada", base: abonoTotal, total: null, lineas });
      docId = doc.id;
      await crm.addMovimientos(lineas.map(l => ({ eventoId: ev.id, articuloId: l.articuloId, tipo: "devolucion", cantidad: l.unidades, costeUnidad: l.coste, documentoId: doc.id, trasRecuento: true, creadoPor: QUIEN, clave: `dev:${doc.id}:${l.articuloId}` })));
    }
    if (aAlmacen.length) await crm.addMovimientos(aAlmacen.map(p => ({ eventoId: ev.id, articuloId: p.a.id, tipo: "traspaso_salida", cantidad: almacenU(p), costeUnidad: costeDe(p.a), trasRecuento: true, creadoPor: QUIEN, nota: p.abierta ? "Sobrante guardado en el almacén (con botella abierta)" : "Sobrante guardado en el almacén", clave: `alm:${ev.id}:${p.a.id}:${Date.now()}` })));
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
      <section style={C.panel}><Vacio i="check" t="No queda nada por devolver ni guardar." sub={devs.length ? "Ya está todo apuntado." : "Según el recuento, no sobró nada."} /></section>
    ) : (<>
      <section style={{ ...C.hero, padding: isMobile ? 16 : 20 }}>
        <div style={C.label}>Lo que sobró · {ev.name}</div>
        <div style={{ fontSize: 14, color: "var(--muted)", marginTop: 4, lineHeight: 1.5 }}>Ya está repartido: <b style={{ color: "var(--text)" }}>lo cerrado y lleno se devuelve</b> a {filas[0].a.proveedor || "proveedor"} (te hará una factura de abono) y <b style={{ color: "var(--text)" }}>lo abierto y los packs incompletos van al almacén</b>. Si quieres devolver menos, baja el número: el resto pasa solo al almacén.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
          <div style={{ padding: "10px 12px", borderRadius: 12, background: "var(--surface2)", border: "1px solid var(--line)" }}><div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: .8 }}>Se devuelve</div><div style={{ fontWeight: 900, fontSize: 19, color: "var(--blue)" }}>{money(abonoTotal)}</div><div style={{ fontSize: 12, color: "var(--muted)" }}>abono estimado, sin IVA{envVal > 0 ? ` (${money(envVal)} de envases)` : ""}</div></div>
          <div style={{ padding: "10px 12px", borderRadius: 12, background: "var(--surface2)", border: "1px solid var(--line)" }}><div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: .8 }}>Se guarda</div><div style={{ fontWeight: 900, fontSize: 19, color: "var(--teal)" }}>{money(valorAlm)}</div><div style={{ fontSize: 12, color: "var(--muted)" }}>en el almacén, a precio de compra</div></div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
          <button onClick={() => setPlan(Object.fromEntries(filas.map(p => [p.a.id, { devolver: p.devolverMax, guardar: true }])))} style={C.btnSm}><Icon n="truck" s={14} />Devolver todo lo cerrado</button>
          <button onClick={() => setPlan(Object.fromEntries(filas.map(p => [p.a.id, { devolver: 0, guardar: true }])))} style={C.btnSm}><Icon n="box" s={14} />Todo al almacén</button>
        </div>
      </section>
      <section style={C.panel}>
        <Head i="box" t="Artículo por artículo" sub="Toca − o + para decidir cuánto se devuelve. El resto va al almacén." />
        {filas.map(p => { const f = famInfo(p.a.familia), dv = devolverU(p), al = almacenU(p), resto = restoU(p), c = costeDe(p.a), pl = planDe(p); return (
          <div key={p.a.id} style={{ padding: "12px 0", borderTop: "1px solid var(--line)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, marginBottom: 10 }}>
              <Tile n={f.i} c={f.c} s={34} />
              <span style={{ minWidth: 0, flex: 1 }}><b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.a.nombre}</b>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Queda {queda(p)} · {money(p.pendiente * c)}</span></span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div style={{ borderRadius: 12, padding: 10, border: `1px solid ${dv > 0 ? "color-mix(in srgb, var(--blue) 55%, var(--line))" : "var(--line)"}`, background: "var(--surface2)", minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "var(--blue)", textTransform: "uppercase", letterSpacing: .6 }}>Devolver</div>
                {p.devolverMax > 0 ? <>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6 }}>
                    <button type="button" onClick={() => setDevolver(p, dv - 1)} disabled={dv <= 0} aria-label={`Devolver una menos de ${p.a.nombre}`} style={pasoBtn}><Icon n="minus" s={18} w={2.6} /></button>
                    <input inputMode="numeric" value={String(dv)} onChange={e => setDevolver(p, parseInt(e.target.value.replace(/\D/g, ""), 10) || 0)} onFocus={e => e.target.select()} aria-label={`Unidades a devolver de ${p.a.nombre}`} style={{ ...C.input, textAlign: "center", fontWeight: 900, fontSize: 18, padding: "8px 2px", minWidth: 0 }} />
                    <button type="button" onClick={() => setDevolver(p, dv + 1)} disabled={dv >= p.devolverMax} aria-label={`Devolver una más de ${p.a.nombre}`} style={{ ...pasoBtn, background: "var(--blue)", color: "#fff", border: "none" }}><Icon n="plus" s={18} w={2.6} /></button>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{dv > 0 ? `${lineaTxt(p.a, dv)} · ${money(dv * c)}` : "Nada"}{dv < p.devolverMax ? <> · <button type="button" onClick={() => setDevolver(p, p.devolverMax)} style={linkBtn}>máx. {num(p.devolverMax, 0)}</button></> : null}</div>
                </> : <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>Nada: está abierto o suelto</div>}
              </div>
              <div style={{ borderRadius: 12, padding: 10, border: `1px solid ${al > 0 ? "color-mix(in srgb, var(--teal) 55%, var(--line))" : "var(--line)"}`, background: "var(--surface2)", minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "var(--teal)", textTransform: "uppercase", letterSpacing: .6 }}>Almacén</div>
                <div style={{ fontWeight: 900, fontSize: 16, marginTop: 8, overflowWrap: "anywhere" }}>{resto > 0 ? (pl.guardar ? cantAbierta(p.a, resto) : "Nada") : "Nada"}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{al > 0 ? money(al * c) : resto > 0 ? "No se guarda" : "—"}{resto > 0 ? <> · <button type="button" onClick={() => setPlan(q => ({ ...q, [p.a.id]: { ...pl, guardar: !pl.guardar } }))} style={linkBtn}>{pl.guardar ? "no guardar" : "guardar"}</button></> : null}</div>
              </div>
            </div>
          </div>); })}
      </section>
    </>)}
    {envasesCon.length > 0 && (
      <section style={C.panel}>
        <Head i="crate" c="#64748b" t="Cajas vacías que devuelves" sub="Recuperas su fianza. Bajan el saldo de envases, no el de bebida." />
        {envasesCon.map(a => <div key={a.id} style={C.row}>
          <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}><Tile n="crate" c="#64748b" s={32} /><span style={{ minWidth: 0 }}><b style={{ display: "block" }}>{a.nombre}</b><span style={{ fontSize: 12, color: "var(--muted)" }}>Fuera: {num(envPend[a.id], 0)} · {money(costeDe(a))} cada una</span></span></span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <input inputMode="numeric" value={vacios[a.id] || ""} placeholder="0" onChange={e => setVacios(v => ({ ...v, [a.id]: Math.min(envPend[a.id], parseInt(e.target.value.replace(/\D/g, "").slice(0, 4), 10) || 0) }))} style={{ ...C.input, width: 70, textAlign: "right", fontWeight: 900, padding: "8px 10px" }} aria-label={`Cajas vacías de ${a.nombre}`} />
            <button type="button" onClick={() => setVacios(v => ({ ...v, [a.id]: envPend[a.id] }))} style={C.btnSm}>Todas</button>
          </span>
        </div>)}
      </section>
    )}
    <CuentasPedido c={cuentas} />
    {(filas.length > 0 || envasesCon.length > 0) && (
      <div style={{ position: "sticky", bottom: 0, paddingTop: 12, paddingBottom: 4, background: "linear-gradient(transparent, var(--bg) 30%)", display: "flex", gap: 8, flexWrap: isMobile ? "nowrap" : "wrap" }}>
        {(aDevolver.length > 0 || nVacios > 0) && <a href={`https://wa.me/?text=${encodeURIComponent(mensaje())}`} target="_blank" rel="noopener noreferrer" style={{ ...C.btnGhost, flex: isMobile ? "0 0 auto" : "1 1 180px", textDecoration: "none", background: "rgba(37,211,102,.14)", borderColor: "rgba(37,211,102,.55)", color: "var(--wa)", minHeight: 50 }} aria-label="Enviar la lista por WhatsApp"><Icon n="whatsapp" s={18} />{isMobile ? "WhatsApp" : "Enviar la lista por WhatsApp"}</a>}
        <button disabled={busy || (!aDevolver.length && !aAlmacen.length && !nVacios)} onClick={confirmar} style={{ ...C.btnPrimary, flex: isMobile ? "1 1 auto" : "2 1 220px", minWidth: 0, minHeight: 50, opacity: busy || (!aDevolver.length && !aAlmacen.length && !nVacios) ? .45 : 1 }}><Icon n="check" s={18} w={2.4} />{isMobile ? "Confirmar" : (aDevolver.length || nVacios) && aAlmacen.length ? "Confirmar: devolver y guardar" : aAlmacen.length ? "Guardar en el almacén" : "Marcar como entregado"}</button>
      </div>
    )}
  </>);
}

const pasoBtn = { width: 40, height: 44, flexShrink: 0, borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--text)", display: "grid", placeItems: "center", cursor: "pointer", padding: 0 };
const linkBtn = { background: "none", border: "none", padding: "6px 2px", margin: "-6px 0", color: "var(--accent)", fontWeight: 800, fontSize: 12, cursor: "pointer", font: "inherit", textDecoration: "underline" };

// Cuentas del pedido (sin IVA): entró − vuelve − se guarda = lo que cuesta el evento
export function CuentasPedido({ c, titulo = "Cuentas del pedido" }) {
  if (!c || !(c.entro > 0)) return null;
  const L = ({ t, v, sub, signo = "", fuerte, color }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 0", borderTop: fuerte ? "2px solid var(--text)" : "1px solid var(--line)", fontVariantNumeric: "tabular-nums" }}>
      <span style={{ minWidth: 0 }}><span style={{ fontWeight: fuerte ? 900 : 700 }}>{t}</span>{sub && <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>{sub}</span>}</span>
      <b style={{ flexShrink: 0, fontSize: fuerte ? 18 : 15, color }}>{signo}{money(Math.abs(v))}</b>
    </div>);
  return (
    <section style={C.panel}>
      <Head i="receipt" t={titulo} sub="Sin IVA y a precio de coste. Se recalcula al decidir qué devuelves y qué guardas." />
      <L t="Entró en el evento" v={c.entro} sub={`Compras y lo traído del almacén${c.entroEnvases > 0 ? ` · ${money(c.entroEnvases)} son fianza de envases` : ""}`} />
      <L t="Vuelve al proveedor" v={c.vuelve} signo="− " color="var(--blue)" sub="Lo ya devuelto, lo que marcas para devolver y las cajas vacías" />
      {c.almacen > 0 && <L t="Se guarda en el almacén" v={c.almacen} signo="− " color="var(--teal)" sub="Sigue siendo tuyo, para el próximo evento" />}
      <L t="Te cuesta el evento" v={c.coste} fuerte />
      {c.fianzaPendiente > 0 && <div style={{ fontSize: 12.5, color: "var(--amber)", fontWeight: 700, marginTop: 4 }}>De ello, {money(c.fianzaPendiente)} es fianza de cajas que aún no has devuelto: la recuperas al devolverlas.</div>}
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>Bebida consumida de verdad (ventas, invitaciones, mermas y lo que falte): <b style={{ color: "var(--text)" }}>{money(c.consumido)}</b>.</div>
    </section>
  );
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
  const [socio, setSocio] = useState(false);
  if (!alm) return <div style={{ color: "var(--muted)", padding: 30, textAlign: "center" }}>Cargando almacén…</div>;
  const filas = d.articulos.map(a => ({ a, q: alm.saldo[a.id] || 0, c: alm.costeMedio[a.id] ?? a.coste ?? 0 })).filter(x => Math.abs(x.q) > 0.0001);
  const valor = r2(filas.reduce((t, x) => t + Math.max(0, x.q) * x.c, 0));
  const V = valorAlmacen(filas.map(x => ({ a: x.a, q: x.q, coste: x.c })));
  const ajustar = async (a, nuevo) => { const ok = await run(() => crm.ajustarAlmacen(a.id, r2(nuevo - (alm.saldo[a.id] || 0)), "Recuento del almacén", QUIEN), "Almacén actualizado"); if (ok) { await recargarAlm(); setAjuste(null); } };
  return (<>
    <section style={{ ...C.hero, padding: isMobile ? 16 : 22 }}>
      <div style={C.label}>Almacén general · todos los eventos</div>
      <div style={{ fontSize: isMobile ? 36 : 46, fontWeight: 900, letterSpacing: "-.02em", lineHeight: 1.05, marginTop: 4 }}>{money(valor)}</div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>{filas.length} {filas.length === 1 ? "artículo guardado" : "artículos guardados"}, a precio de compra y sin IVA (con IVA: {money(V.total)}). Las botellas abiertas cuentan por lo que queda: ½ botella = la mitad de su precio.</div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>El próximo evento lo toma desde «Traer del almacén». Si un socio se queda algo, apúntalo aquí y verás lo que vale.</div>
      {filas.length > 0 && <button onClick={() => setSocio(true)} style={{ ...C.btnPrimary, marginTop: 12, minHeight: 48 }}><Icon n="users" s={17} />Un socio se lo queda</button>}
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
              <span style={{ flex: 1, minWidth: 0 }}><b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.a.nombre}</b><span style={{ fontSize: 12, color: "var(--muted)" }}>{cantAbierta(x.a, x.q)} · {money(x.c)} {x.a.unidad === "lata" ? "la lata" : "cada una"}</span></span>
              <span style={{ textAlign: "right", flexShrink: 0 }}><b style={{ display: "block" }}>{money(Math.max(0, x.q) * x.c)}</b><span style={{ fontSize: 12, color: "var(--muted)" }}>Ajustar</span></span>
            </button>))}
        </div>); })}
    </section>
    {socio && <SocioSeLoQueda filas={filas} busy={busy} onClose={() => setSocio(false)}
      onConfirmar={async (nombre, sel) => {
        const ok = await run(async () => { for (const x of filas) { const q = sel[x.a.id] || 0; if (q > 0) await crm.ajustarAlmacen(x.a.id, -q, `Se lo queda ${nombre} · ${money(q * x.c)} sin IVA`, QUIEN); } }, `Apuntado: ${nombre} se lo queda`);
        if (ok) { await recargarAlm(); setSocio(false); }
      }} />}
    {(ajuste || extra) && <AjusteSheet a={ajuste} articulos={d.articulos.filter(a => a.activo && !famInfo(a.familia).noAudita)} actual={ajuste ? (alm.saldo[ajuste.id] || 0) : 0} busy={busy} onClose={() => { setAjuste(null); setExtra(false); }} onSave={ajustar} />}
  </>);
}
// Un socio (o quien sea) compra lo que hay en el almacén: se elige qué y cuánto y se ve lo que vale a precio de compra
function SocioSeLoQueda({ filas, busy, onClose, onConfirmar }) {
  const [nombre, setNombre] = useState("");
  const [sel, setSel] = useState({});
  const elegidas = filas.filter(x => sel[x.a.id] > 0).map(x => ({ a: x.a, q: sel[x.a.id], coste: x.c }));
  const V = valorAlmacen(elegidas);
  const listo = nombre.trim() && elegidas.length > 0;
  const texto = () => [`${nombre.trim()} se queda del almacén:`, ...elegidas.map(x => `• ${cantAbierta(x.a, x.q)} de ${x.a.nombre}: ${money(x.q * x.coste)}`), "", `Total a precio de compra: ${money(V.base)} sin IVA (${money(V.total)} con IVA).`].join("\n");
  return (
    <Sheet title="Un socio se lo queda" onClose={onClose}
      footer={<div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}><span style={{ fontWeight: 800 }}>Vale</span><span style={{ textAlign: "right" }}><b style={{ fontSize: 22 }}>{money(V.base)}</b><span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>sin IVA · {money(V.total)} con IVA</span></span></div>
        <div style={{ display: "flex", gap: 8 }}>
          {listo && <a href={`https://wa.me/?text=${encodeURIComponent(texto())}`} target="_blank" rel="noopener noreferrer" style={{ ...C.btnGhost, textDecoration: "none", minHeight: 50, background: "rgba(37,211,102,.14)", borderColor: "rgba(37,211,102,.55)", color: "var(--wa)" }} aria-label="Enviar por WhatsApp"><Icon n="whatsapp" s={18} /></a>}
          <button disabled={!listo || busy} onClick={() => onConfirmar(nombre.trim(), sel)} style={{ ...C.btnPrimary, flex: 1, minHeight: 50, opacity: listo && !busy ? 1 : .45 }}>{!nombre.trim() ? "Escribe quién se lo queda" : !elegidas.length ? "Elige qué se lleva" : "Apuntar y sacarlo del almacén"}</button>
        </div>
      </div>}>
      <Field l="¿Quién se lo queda?"><input value={nombre} maxLength={60} onChange={e => setNombre(e.target.value)} placeholder="Nombre del socio" style={C.input} /></Field>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={C.label}>Qué se lleva</div>
        <button type="button" onClick={() => setSel(Object.fromEntries(filas.map(x => [x.a.id, Math.max(0, x.q)])))} style={C.btnSm}>Todo</button>
      </div>
      {filas.filter(x => x.q > 0).map(x => (
        <div key={x.a.id} style={{ ...C.row, gap: 8 }}>
          <span style={{ minWidth: 0, flex: 1 }}><b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.a.nombre}</b><span style={{ fontSize: 12, color: "var(--muted)" }}>Hay {cantAbierta(x.a, x.q)} · {money(x.c)} cada una{sel[x.a.id] > 0 ? ` · ${money(sel[x.a.id] * x.c)}` : ""}</span></span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <input inputMode="decimal" placeholder="0" value={sel[x.a.id] ? String(sel[x.a.id]).replace(".", ",") : ""} onChange={e => { const v = Math.min(x.q, parseFloat(e.target.value.replace(/[^\d.,]/g, "").replace(",", ".")) || 0); setSel(s => ({ ...s, [x.a.id]: v })); }} aria-label={`Cuánto se lleva de ${x.a.nombre}`} style={{ ...C.input, width: 70, textAlign: "right", fontWeight: 900, padding: "8px 10px" }} />
            <button type="button" onClick={() => setSel(s => ({ ...s, [x.a.id]: x.q }))} style={C.btnSm}>Todo</button>
          </span>
        </div>))}
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10, lineHeight: 1.45 }}>Se valora a lo que costó comprarlo (las abiertas por lo que queda). Al apuntarlo sale del almacén con una nota con su nombre y el importe. El cobro, apúntalo en Ingresos o en el reparto entre socios.</div>
    </Sheet>
  );
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

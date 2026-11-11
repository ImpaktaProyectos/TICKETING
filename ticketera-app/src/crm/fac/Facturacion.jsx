// ===================== FACTURACIÓN =====================
// Facturas emitidas y de gastos, contactos y datos fiscales. Módulo APARTE: no toca los números de los eventos.
// Las facturas emitidas se numeran y bloquean en el servidor (fac_emitir) con huella encadenada (preparado VERI*FACTU).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { C, Icon, Tile, Badge, Seg, Sheet, Field, useIsMobile } from "../ui";
import * as fdb from "./facdb";
import { calcular, baseLinea, eur, fechaES, num, IVAS, IRPFS, trimestre, MESES, CATEGORIAS_GASTO, diasVencida, textoRecordatorio } from "./calculo";
import { webSubir } from "../crmdb";

const hoyISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const masDias = (iso, n) => { const d = new Date(iso + "T12:00"); d.setDate(d.getDate() + (Number(n) || 0)); return d.toISOString().slice(0, 10); };
const nuevoId = () => Math.random().toString(36).slice(2, 10);
const lineaVacia = (iva = 21) => ({ id: nuevoId(), concepto: "", cantidad: 1, precio: "", descuento: "", iva });
const gastoVacio = () => ({ tipo: "recibida", estado: "pendiente", fecha: hoyISO(), categoria: CATEGORIAS_GASTO[0], lineas: [{ id: nuevoId(), concepto: "", cantidad: 1, precio: "", iva: 21 }], irpf_pct: 0, contacto: {} });
const PAGOS = ["Transferencia", "Bizum", "Tarjeta", "Efectivo", "Domiciliación"];
const PLANTILLAS = [{ k: "clasica", t: "Clásica", sub: "Logo, línea de color y tabla limpia" }, { k: "moderna", t: "Moderna", sub: "Cabecera a color, muy de marca" }, { k: "minimal", t: "Minimal", sub: "Blanco y negro, sobria" }];
const COLORES = ["#ff5a3c", "#15171c", "#2563eb", "#7c3aed", "#0e9f75", "#db2777", "#d97706"];
const estadoDe = (f) => {
  if (f.tipo === "recibida") return f.estado === "pagada" ? ["Pagada", "var(--green)"] : ["Por pagar", "var(--amber)"];
  if (f.estado === "borrador") return ["Borrador", "var(--muted)"];
  if (f.estado === "pagada") return ["Cobrada", "var(--green)"];
  if (f.vencimiento && f.vencimiento < hoyISO()) return ["Vencida", "var(--red)"];
  return ["Pendiente", "var(--amber)"];
};
async function cargarPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const w = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = w.default;
  return pdfjs;
}
const descargarBlob = (blob, nombre) => { const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); };

export default function Facturacion({ flash }) {
  const isMobile = useIsMobile();
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  const [vista, setVista] = useState("resumen");
  const [editor, setEditor] = useState(null);      // factura emitida en borrador (editable)
  const [ver, setVer] = useState(null);            // factura emitida (solo ver y acciones)
  const [gasto, setGasto] = useState(null);        // factura recibida
  const [contacto, setContacto] = useState(null);  // { ...contacto, alGuardar }
  const [busy, setBusy] = useState(false);
  const [recordar, setRecordar] = useState(null);  // factura a la que mandar un recordatorio de cobro
  const [recurrente, setRecurrente] = useState(null); // plantilla de factura que se repite
  const cargar = async () => { try { const x = await fdb.cargar(); setD(x); setError(""); return x; } catch (e) { setError(e.message || "No se han podido cargar las facturas"); return null; } };
  useEffect(() => { (async () => {
    const x = await cargar();
    // Facturas que se repiten: al abrir, se preparan como borradores las que tocan (nunca se emiten solas)
    if (x?.hayRecurrentes && x.recurrentes.some(r => r.activa)) {
      try { const n = await fdb.generarRecurrentes(); if (n > 0) { flash(n === 1 ? "Se ha preparado 1 factura que se repite: está en borradores" : `Se han preparado ${n} facturas que se repiten: están en borradores`); await cargar(); } } catch {}
    }
  })(); }, []);
  const archivarPdf = async (em) => { const { pdfFactura } = await import("./pdfFactura"); const doc = await pdfFactura({ ...em, rectifica_codigo: d?.facturas.find(z => z.id === em.rectifica_id)?.codigo }, d?.emisor); const path = await fdb.subirArchivo(em, doc.output("blob")); await fdb.ponerArchivo(em.id, path); return path; };
  const run = async (fn, okMsg) => { setBusy(true); try { const r = await fn(); if (okMsg) flash(okMsg); return r ?? true; } catch (e) { flash(e.message || "Algo ha fallado", "warn"); return null; } finally { setBusy(false); } };

  if (error && !d) return <div style={{ ...C.panel, color: "var(--amber)", fontWeight: 700 }}>{error} <button onClick={cargar} style={{ ...C.btnSm, marginLeft: 8 }}>Reintentar</button></div>;
  if (!d) return <div style={{ color: "var(--muted)", padding: 30, textAlign: "center" }}>Cargando facturación…</div>;
  const E = d.emisor;
  const nuevaFactura = (base = {}) => {
    if (!E) { setVista("ajustes"); flash("Primero tus datos fiscales: solo se piden una vez", "warn"); return; }
    setEditor({ tipo: "emitida", estado: "borrador", fecha: hoyISO(), vencimiento: masDias(hoyISO(), E.vencimiento_dias ?? 30), lineas: [lineaVacia(Number(E.iva_def ?? 21))], irpf_pct: Number(E.irpf_def || 0), forma_pago: E.iban ? "Transferencia" : "", plantilla: E.plantilla, contacto: {}, ...base });
  };
  const VISTAS = [{ k: "resumen", t: "Resumen", i: "chart" }, { k: "ventas", t: "Ventas", i: "file" }, { k: "gastos", t: "Gastos", i: "receipt" }, { k: "contactos", t: isMobile ? "Contactos" : "Contactos", i: "users" }, { k: "ajustes", t: isMobile ? "Datos" : "Datos fiscales", i: "building" }].map(v => isMobile ? { k: v.k, t: v.t } : v);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ overflowX: "auto", maxWidth: "100%" }}><Seg size={isMobile ? "sm" : "md"} valor={vista} onChange={setVista} opciones={VISTAS} /></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setGasto(gastoVacio())} style={C.btnGhost}><Icon n="receipt" s={17} />{isMobile ? "Gasto" : "Añadir gasto"}</button>
          <button onClick={() => nuevaFactura()} style={C.btnPrimary}><Icon n="plus" s={17} w={2.4} />{isMobile ? "Factura" : "Nueva factura"}</button>
        </div>
      </div>

      {!E && vista !== "ajustes" && (
        <section style={{ ...C.panel, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", borderColor: "color-mix(in srgb, var(--accent) 45%, var(--line))" }}>
          <Tile n="building" s={44} />
          <div style={{ flex: "1 1 260px" }}><div style={{ fontWeight: 900, fontSize: 16 }}>Antes de la primera factura: tus datos fiscales</div><div style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 2 }}>Razón social, NIF y dirección. Se piden una vez y salen solos en todas tus facturas.</div></div>
          <button onClick={() => setVista("ajustes")} style={C.btnPrimary}>Rellenar ahora</button>
        </section>)}

      {vista === "resumen" && <Resumen d={d} isMobile={isMobile} busy={busy} flash={flash} run={run} onVer={(f) => f.tipo === "recibida" ? setGasto(f) : f.estado === "borrador" ? setEditor(f) : setVer(f)}
        onRecordar={(f) => setRecordar(f)} onRecurrente={(r) => setRecurrente(r)} />}
      {vista === "ventas" && <Lista d={d} tipo="emitida" isMobile={isMobile} onNueva={() => nuevaFactura()} onAbrir={(f) => f.estado === "borrador" ? setEditor(f) : setVer(f)} />}
      {vista === "gastos" && <Lista d={d} tipo="recibida" isMobile={isMobile} onNueva={() => setGasto(gastoVacio())} onAbrir={(f) => setGasto(f)} />}
      {vista === "contactos" && <Contactos d={d} isMobile={isMobile} onAbrir={(c) => setContacto(c)} />}
      {vista === "ajustes" && <DatosFiscales E={E} busy={busy} isMobile={isMobile} flash={flash}
        onGuardar={async (x) => { const r = await run(() => fdb.guardarEmisor(x), E ? "Datos fiscales guardados" : "Listo: ya puedes hacer facturas"); if (r) { await cargar(); if (!E) setVista("ventas"); } }} />}

      {editor && <Editor f={editor} E={E} d={d} busy={busy} isMobile={isMobile} flash={flash}
        onCerrar={() => setEditor(null)}
        onNuevoContacto={(nombre, alGuardar) => setContacto({ tipo: "cliente", nombre, alGuardar })}
        onGuardar={async (x, silencio) => { const r = await run(() => fdb.guardarFactura(x), silencio ? null : "Borrador guardado"); if (r) { await cargar(); return r; } return null; }}
        onBorrar={async (x) => { if (x.id && !(await run(() => fdb.borrarFactura(x), "Borrador borrado"))) return; setEditor(null); cargar(); }}
        onEmitir={async (x) => {
          const g = await run(() => fdb.guardarFactura(x)); if (!g) return;
          const em = await run(() => fdb.emitir(g.id)); if (!em) { await cargar(); return; }
          // La factura ya está emitida aunque falle el PDF: se avisa y se puede volver a guardar desde la factura
          let pdfOk = true; try { await archivarPdf(em); } catch { pdfOk = false; }
          flash(pdfOk ? `Factura ${em.codigo} emitida` : `Factura ${em.codigo} emitida, pero no se ha podido guardar el PDF en el archivo. Ábrela y pulsa «Guardar PDF»`, pdfOk ? undefined : "warn");
          setEditor(null); await cargar(); setVer({ ...em });
        }} />}
      {ver && <VerFactura f={d.facturas.find(x => x.id === ver.id) || ver} d={d} E={E} busy={busy} isMobile={isMobile} flash={flash} onCerrar={() => setVer(null)}
        onArchivar={async (f) => { if (await run(() => archivarPdf(f), "PDF guardado en el archivo")) cargar(); }}
        onRecordar={(f) => setRecordar(f)}
        onRepetir={d.hayRecurrentes ? (f) => { setVer(null); setRecurrente(nuevaRecurrente(f)); } : null}
        onPagada={async (f, v) => { if (await run(() => fdb.marcarPagada(f, v), v ? "Marcada como cobrada" : "Marcada como pendiente")) cargar(); }}
        onDuplicar={(f) => { setVer(null); nuevaFactura({ contacto_id: f.contacto_id, contacto: f.contacto, lineas: f.lineas.map(l => ({ ...l, id: nuevoId() })), irpf_pct: f.irpf_pct, forma_pago: f.forma_pago, notas: f.notas, plantilla: f.plantilla }); }}
        onRectificar={(f) => { setVer(null); nuevaFactura({ rectificativa: true, rectifica_id: f.id, contacto_id: f.contacto_id, contacto: f.contacto, lineas: f.lineas.map(l => ({ ...l, id: nuevoId(), cantidad: -num(l.cantidad) })), irpf_pct: f.irpf_pct, motivo: "", plantilla: f.plantilla }); }} />}
      {gasto && <FormGasto g={gasto} d={d} busy={busy} isMobile={isMobile} onCerrar={() => setGasto(null)}
        onNuevoContacto={(nombre, alGuardar, extra) => setContacto({ tipo: "proveedor", nombre, ...extra, alGuardar })}
        onGuardar={async (x, archivo) => {
          const r = await run(async () => { let g = await fdb.guardarFactura(x); if (archivo) { const ext = (archivo.name.split(".").pop() || "pdf").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5); const path = await fdb.subirArchivo(g, archivo, ext); g = await fdb.guardarFactura({ ...g, archivo_path: path }); } return g; }, x.id ? "Gasto actualizado" : "Gasto añadido");
          if (r) { setGasto(null); cargar(); } }}
        onBorrar={async (x) => { if (await run(() => fdb.borrarFactura(x), "Gasto borrado")) { setGasto(null); cargar(); } }} />}
      {contacto && <FormContacto c={contacto} busy={busy} onCerrar={() => setContacto(null)}
        onGuardar={async (x) => { const r = await run(() => fdb.guardarContacto(x), x.id ? "Contacto actualizado" : "Contacto guardado"); if (r) { contacto.alGuardar?.(r); setContacto(null); cargar(); } }}
        onBorrar={async (x) => { if (await run(() => fdb.borrarContacto(x.id), "Contacto borrado")) { setContacto(null); cargar(); } }} />}
      {recordar && <Recordatorio f={recordar} d={d} E={E} onCerrar={() => setRecordar(null)}
        onEnviado={async (f) => { setRecordar(null); try { await fdb.marcarRecordada(f.id); cargar(); } catch {} }} />}
      {recurrente && <FormRecurrente r={recurrente} d={d} busy={busy} onCerrar={() => setRecurrente(null)}
        onGuardar={async (x) => { const r = await run(() => fdb.guardarRecurrente(x), x.id ? "Factura que se repite actualizada" : "Listo: se preparará sola cada periodo como borrador"); if (r) { setRecurrente(null); const y = await cargar(); if (y && x.activa !== false) { try { const n = await fdb.generarRecurrentes(); if (n > 0) { flash(`${n === 1 ? "1 borrador preparado" : `${n} borradores preparados`} ya`); cargar(); } } catch {} } } }}
        onBorrar={async (x) => { if (await run(() => fdb.borrarRecurrente(x.id), "Ya no se repite")) { setRecurrente(null); cargar(); } }} />}
    </div>
  );
}

// Plantilla recurrente a partir de una factura: el primer borrador, el día 1 del mes que viene (nunca en el pasado)
function nuevaRecurrente(f) {
  const [a, m] = hoyISO().split("-").map(Number), inicio = m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`;
  return { nombre: `${f.contacto?.nombre || "Cliente"} · mensual`, activa: true, cada_meses: 1, inicio,
    contacto_id: f.contacto_id, contacto: f.contacto, lineas: (f.lineas || []).map(l => ({ concepto: l.concepto, cantidad: num(l.cantidad), precio: num(l.precio), descuento: num(l.descuento), iva: num(l.iva) })),
    irpf_pct: f.irpf_pct, forma_pago: f.forma_pago, notas: f.notas, plantilla: f.plantilla };
}

/* ---------------- Resumen del trimestre ---------------- */
function Resumen({ d, isMobile, busy, flash, run, onVer, onRecordar, onRecurrente }) {
  const hoy = hoyISO(), anioAct = +hoy.slice(0, 4);
  const [anio, setAnio] = useState(anioAct);
  const [tri, setTri] = useState(trimestre(hoy));
  const [zip, setZip] = useState(false);
  const dentro = (f) => f.fecha?.slice(0, 4) === String(anio) && (tri === 0 || trimestre(f.fecha) === tri);
  const ventas = d.facturas.filter(f => f.tipo === "emitida" && f.estado !== "borrador" && dentro(f));
  const gastos = d.facturas.filter(f => f.tipo === "recibida" && dentro(f));
  const s = (xs, k) => xs.reduce((t, f) => t + num(f[k]), 0);
  const ivaRep = s(ventas, "cuota_iva"), ivaSop = s(gastos, "cuota_iva");
  const porCobrar = d.facturas.filter(f => f.tipo === "emitida" && f.estado === "emitida");
  const vencidas = porCobrar.filter(f => diasVencida(f, hoy) > 0).sort((a, b) => a.vencimiento.localeCompare(b.vencimiento));
  const borradores = d.facturas.filter(f => f.tipo === "emitida" && f.estado === "borrador");
  const anios = [...new Set([anioAct, ...d.facturas.map(f => +String(f.fecha).slice(0, 4))])].filter(Boolean).sort((a, b) => b - a);
  const kpis = [
    ["Facturado (base)", eur(s(ventas, "base")), `${ventas.length} ${ventas.length === 1 ? "factura" : "facturas"}`, "var(--text)"],
    ["Gastos (base)", eur(s(gastos, "base")), `${gastos.length} ${gastos.length === 1 ? "factura" : "facturas"}`, "var(--text)"],
    ["IVA a liquidar", eur(ivaRep - ivaSop), `Repercutido ${eur(ivaRep)} − soportado ${eur(ivaSop)}`, ivaRep - ivaSop >= 0 ? "var(--amber)" : "var(--green)"],
    ["Retenciones IRPF", eur(s(ventas, "cuota_irpf")), `Te retienen · tú retienes ${eur(s(gastos, "cuota_irpf"))}`, "var(--text)"],
  ];
  const exportar = async () => {
    if (!ventas.length && !gastos.length) { flash("No hay facturas en este periodo", "warn"); return; }
    setZip(true);
    await run(async () => {
      const { crearZip } = await import("./zip"); const { pdfFactura } = await import("./pdfFactura");
      const raiz = `Facturas_${anio}${tri ? `_T${tri}` : ""}`, arch = [];
      for (const f of ventas) {
        let datos; if (f.archivo_path) { try { datos = new Uint8Array(await (await fdb.bajarArchivo(f.archivo_path)).arrayBuffer()); } catch {} }
        if (!datos) datos = new Uint8Array((await pdfFactura({ ...f, rectifica_codigo: d.facturas.find(z => z.id === f.rectifica_id)?.codigo }, d.emisor)).output("arraybuffer"));
        arch.push({ nombre: `${raiz}/${fdb.carpeta(f)}/${fdb.nombreArchivo(f)}`, datos });
      }
      for (const f of gastos) if (f.archivo_path) { try { const ext = f.archivo_path.split(".").pop(); arch.push({ nombre: `${raiz}/${fdb.carpeta(f)}/${fdb.nombreArchivo(f, ext)}`, datos: new Uint8Array(await (await fdb.bajarArchivo(f.archivo_path)).arrayBuffer()) }); } catch {} }
      const n2 = (v) => num(v).toFixed(2).replace(".", ",");
      const fila = (xs) => "﻿" + xs.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
      arch.push({ nombre: `${raiz}/Libro_facturas_emitidas.csv`, datos: fila([["Fecha", "Número", "Rectifica a", "NIF cliente", "Cliente", "Base", "Tipo IVA %", "Cuota IVA", "IRPF %", "Retención IRPF", "Total factura", "Estado"],
        ...ventas.slice().sort((a, b) => (a.codigo || "").localeCompare(b.codigo || "")).flatMap(f => (f.desglose?.length ? f.desglose : [{ tipo: 0, base: f.base, cuota: 0 }]).map((x, i) => [fechaES(f.fecha), f.codigo, d.facturas.find(z => z.id === f.rectifica_id)?.codigo || "", f.contacto?.nif, f.contacto?.nombre, n2(x.base), x.tipo, n2(x.cuota), i ? "" : num(f.irpf_pct), i ? "" : n2(f.cuota_irpf), i ? "" : n2(f.total), i ? "" : estadoDe(f)[0]]))]) });
      arch.push({ nombre: `${raiz}/Libro_facturas_recibidas.csv`, datos: fila([["Fecha", "Nº factura proveedor", "NIF proveedor", "Proveedor", "Categoría", "Base", "Tipo IVA %", "Cuota IVA", "IRPF %", "Retención IRPF", "Total factura", "Estado", "Archivo"],
        ...gastos.slice().sort((a, b) => a.fecha.localeCompare(b.fecha)).flatMap(f => (f.desglose?.length ? f.desglose : [{ tipo: 0, base: f.base, cuota: 0 }]).map((x, i) => [fechaES(f.fecha), f.num_proveedor, f.contacto?.nif, f.contacto?.nombre, f.categoria, n2(x.base), x.tipo, n2(x.cuota), i ? "" : num(f.irpf_pct), i ? "" : n2(f.cuota_irpf), i ? "" : n2(f.total), i ? "" : estadoDe(f)[0], f.archivo_path ? "Sí" : "Falta"]))]) });
      descargarBlob(crearZip(arch), `${raiz}.zip`);
    }, "ZIP listo para la gestoría");
    setZip(false);
  };
  return (<>
    <section style={{ ...C.panel, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
      <select value={anio} onChange={e => setAnio(+e.target.value)} aria-label="Año" style={{ ...C.miniSelect, fontSize: 14, padding: "9px 28px 9px 12px" }}>{anios.map(a => <option key={a} value={a}>{a}</option>)}</select>
      <div style={{ overflowX: "auto", maxWidth: "100%" }}><Seg size="sm" valor={tri} onChange={setTri} opciones={[{ k: 1, t: "1T" }, { k: 2, t: "2T" }, { k: 3, t: "3T" }, { k: 4, t: "4T" }, { k: 0, t: "Año" }]} /></div>
      <div style={{ flex: 1 }} />
      <button onClick={exportar} disabled={busy || zip} style={{ ...C.btnGhost, opacity: zip ? .6 : 1 }}><Icon n="download" s={17} />{zip ? "Preparando…" : isMobile ? "ZIP gestoría" : `Descargar ${tri ? `${tri}T` : "año"} para la gestoría`}</button>
    </section>
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,minmax(0,1fr))" : "repeat(4,minmax(0,1fr))", gap: 12 }}>
      {kpis.map(([l, v, sub, c]) => <div key={l} style={C.card}><div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 700 }}>{l}</div><div style={{ fontSize: isMobile ? 19 : 24, fontWeight: 900, letterSpacing: -.4, color: c, marginTop: 4 }}>{v}</div><div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>{sub}</div></div>)}
    </div>
    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: -6 }}>Cálculo orientativo para tu gestoría (modelos 303, 130 y 111). El ZIP lleva las facturas ordenadas por mes en «ingresos» y «gastos» y los libros de registro en CSV.</div>
    {vencidas.length > 0 && <section style={{ ...C.panel, borderColor: "color-mix(in srgb, var(--red) 45%, var(--line))" }}>
      <div style={{ fontWeight: 900, marginBottom: 2, display: "flex", alignItems: "center", gap: 8 }}><Icon n="alert" s={18} c="var(--red)" />Vencidas sin cobrar <span style={{ color: "var(--muted)", fontWeight: 700 }}>· {vencidas.length} · {eur(s(vencidas, "total"))}</span></div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>Manda un recordatorio por correo o WhatsApp con un toque.</div>
      {vencidas.slice(0, 10).map(f => { const dv = diasVencida(f, hoy); return (
        <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid var(--line)" }}>
          <div style={{ flex: 1, minWidth: 0 }}><FilaFactura f={f} onClick={() => onVer(f)} extra={`hace ${dv} ${dv === 1 ? "día" : "días"}${f.recordada_en ? ` · avisado el ${fechaES(f.recordada_en.slice(0, 10))}` : ""}`} sinBorde /></div>
          <button onClick={() => onRecordar(f)} style={{ ...C.btnSm, flexShrink: 0 }}><Icon n="mail" s={15} />{isMobile ? "" : "Recordar"}</button>
        </div>); })}
    </section>}
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
      <section style={C.panel}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Pendiente de cobro <span style={{ color: "var(--muted)", fontWeight: 700 }}>· {eur(s(porCobrar, "total"))}</span></div>
        {porCobrar.length ? porCobrar.slice(0, 8).map(f => <FilaFactura key={f.id} f={f} onClick={() => onVer(f)} />) : <div style={C.empty}>Todo cobrado.</div>}
      </section>
      <section style={C.panel}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Borradores <span style={{ color: "var(--muted)", fontWeight: 700 }}>· {borradores.length}</span></div>
        {borradores.length ? borradores.slice(0, 8).map(f => <FilaFactura key={f.id} f={f} onClick={() => onVer(f)} />) : <div style={C.empty}>Sin borradores.</div>}
      </section>
    </div>
    {d.hayRecurrentes && <section style={C.panel}>
      <div style={{ fontWeight: 900, marginBottom: 2, display: "flex", alignItems: "center", gap: 8 }}><Icon n="refresh" s={17} />Facturas que se repiten <span style={{ color: "var(--muted)", fontWeight: 700 }}>· {d.recurrentes.filter(r => r.activa).length}</span></div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>Cuotas, alquileres, igualas… Cada periodo se prepara un borrador para que lo revises y lo emitas. Se crean desde una factura emitida con «Repetir».</div>
      {d.recurrentes.length ? d.recurrentes.map(r => { const t = calcular(r.lineas || [], r.irpf_pct); return (
        <button key={r.id} onClick={() => onRecurrente(r)} style={{ ...C.listBtn, padding: "11px 4px", opacity: r.activa ? 1 : .55 }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontWeight: 800, fontSize: 14.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.nombre}</span>
            <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)" }}>{r.contacto?.nombre} · {CADA[r.cada_meses] || `cada ${r.cada_meses} meses`} · {r.activa ? `próxima ${fechaES(proximaDe(r))}` : "en pausa"}</span>
          </span>
          <b style={{ fontVariantNumeric: "tabular-nums" }}>{eur(t.total)}</b>
        </button>); }) : <div style={C.empty}>Ninguna todavía.</div>}
    </section>}
  </>);
}

const CADA = { 1: "cada mes", 2: "cada 2 meses", 3: "cada trimestre", 6: "cada semestre", 12: "cada año" };
// Misma regla que fac_generar_recurrentes: inicio + n × meses (si el día no existe, el último del mes)
const proximaDe = (r) => { const [a, m, dd] = r.inicio.split("-").map(Number); const k = m - 1 + (r.generadas || 0) * (r.cada_meses || 1); const y = a + Math.floor(k / 12), mm = k % 12; const dim = new Date(Date.UTC(y, mm + 1, 0)).getUTCDate(); return `${y}-${String(mm + 1).padStart(2, "0")}-${String(Math.min(dd, dim)).padStart(2, "0")}`; };

function FilaFactura({ f, onClick, extra, sinBorde }) {
  const [t, c] = estadoDe(f);
  return (
    <button onClick={onClick} style={{ ...C.listBtn, padding: "11px 4px", ...(sinBorde ? { borderTop: "none" } : null) }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontWeight: 800, fontSize: 14.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.contacto?.nombre || <span style={{ color: "var(--muted)" }}>Sin {f.tipo === "recibida" ? "proveedor" : "cliente"}</span>}</span>
        <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)" }}>{f.tipo === "recibida" ? `${f.num_proveedor || "Sin nº"} · ${f.categoria || ""}` : f.codigo || "Borrador"}{f.rectificativa ? " · rectificativa" : ""} · {fechaES(f.fecha)}{extra ? ` · ${extra}` : ""}</span>
      </span>
      <span style={{ textAlign: "right", flexShrink: 0 }}>
        <b style={{ display: "block", fontSize: 15, fontVariantNumeric: "tabular-nums" }}>{eur(f.total)}</b>
        <Badge c={c}>{t}</Badge>
      </span>
    </button>
  );
}

/* ---------------- Listas de ventas y gastos ---------------- */
function Lista({ d, tipo, isMobile, onNueva, onAbrir }) {
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState("todas");
  const todas = d.facturas.filter(f => f.tipo === tipo);
  const lista = todas.filter(f => {
    const [t] = estadoDe(f);
    if (filtro === "borrador" && t !== "Borrador") return false;
    if (filtro === "pendiente" && !["Pendiente", "Vencida", "Por pagar"].includes(t)) return false;
    if (filtro === "pagada" && !["Cobrada", "Pagada"].includes(t)) return false;
    const k = q.trim().toLowerCase(); if (!k) return true;
    return [f.codigo, f.num_proveedor, f.contacto?.nombre, f.contacto?.nif, f.categoria, String(f.total)].some(v => String(v || "").toLowerCase().includes(k));
  });
  const ops = tipo === "emitida" ? [{ k: "todas", t: "Todas" }, { k: "borrador", t: "Borradores" }, { k: "pendiente", t: "Pendientes" }, { k: "pagada", t: "Cobradas" }] : [{ k: "todas", t: "Todas" }, { k: "pendiente", t: "Por pagar" }, { k: "pagada", t: "Pagadas" }];
  return (
    <section style={C.panel}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 6 }}>
        <div style={{ position: "relative", flex: "1 1 220px" }}>
          <span style={{ position: "absolute", left: 12, top: 12, color: "var(--muted)" }}><Icon n="search" s={17} /></span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={tipo === "emitida" ? "Buscar por cliente, número, NIF…" : "Buscar por proveedor, nº, categoría…"} aria-label="Buscar" style={{ ...C.input, paddingLeft: 38 }} />
        </div>
        <div style={{ overflowX: "auto", maxWidth: "100%" }}><Seg size="sm" valor={filtro} onChange={setFiltro} opciones={ops} /></div>
      </div>
      {!todas.length ? (
        <div style={{ ...C.empty, marginTop: 10 }}>
          <div style={{ fontWeight: 800, color: "var(--text)", marginBottom: 6 }}>{tipo === "emitida" ? "Aún no has hecho ninguna factura" : "Aún no hay facturas de gastos"}</div>
          {tipo === "emitida" ? "Haz la primera en menos de un minuto: cliente, conceptos y listo." : "Sube la foto o el PDF de cada factura que te llegue: quedará ordenada para la gestoría."}
          <div style={{ marginTop: 12 }}><button onClick={onNueva} style={C.btnPrimary}><Icon n="plus" s={16} w={2.4} />{tipo === "emitida" ? "Nueva factura" : "Añadir gasto"}</button></div>
        </div>
      ) : lista.length ? lista.map(f => <FilaFactura key={f.id} f={f} onClick={() => onAbrir(f)} />) : <div style={{ ...C.empty, marginTop: 10 }}>Nada coincide con la búsqueda.</div>}
    </section>
  );
}

/* ---------------- Selector de contacto ---------------- */
function ElegirContacto({ d, tipo, valor, onElegir, onNuevo }) {
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState(!valor?.nombre);
  useEffect(() => { if (valor?.nombre) setAbierto(false); }, [valor?.nombre]);   // p. ej. al rellenarlo leyendo un PDF
  const lista = d.contactos.filter(c => (tipo === "cliente" ? c.tipo !== "proveedor" : c.tipo !== "cliente")).filter(c => !q.trim() || [c.nombre, c.nif, c.email].some(v => String(v || "").toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 8);
  if (valor?.nombre && !abierto) return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 12, padding: 12 }}>
      <Tile n={tipo === "cliente" ? "user" : "store"} s={36} />
      <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, lineHeight: 1.45 }}>
        <div style={{ fontWeight: 900, fontSize: 15 }}>{valor.nombre}</div>
        <div style={{ color: valor.nif ? "var(--muted)" : "var(--red)", fontWeight: valor.nif ? 400 : 700 }}>{valor.nif ? `NIF ${valor.nif}` : "Falta el NIF"}</div>
        {(valor.direccion || valor.ciudad) && <div style={{ color: "var(--muted)" }}>{[valor.direccion, [valor.cp, valor.ciudad].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}</div>}
      </div>
      <button onClick={() => setAbierto(true)} style={C.btnSm}>Cambiar</button>
    </div>);
  return (
    <div>
      <div style={{ position: "relative" }}>
        <span style={{ position: "absolute", left: 12, top: 12, color: "var(--muted)" }}><Icon n="search" s={17} /></span>
        <input autoFocus={!valor?.nombre} value={q} onChange={e => setQ(e.target.value)} placeholder={tipo === "cliente" ? "Busca o escribe el cliente…" : "Busca o escribe el proveedor…"} aria-label={tipo === "cliente" ? "Cliente" : "Proveedor"} style={{ ...C.input, paddingLeft: 38 }} />
      </div>
      <div style={{ marginTop: 6, border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
        {lista.map(c => <button key={c.id} onClick={() => { onElegir(c); setAbierto(false); setQ(""); }} style={{ ...C.listBtn, borderTop: "none", borderBottom: "1px solid var(--line)", padding: "10px 12px" }}>
          <span style={{ flex: 1, minWidth: 0 }}><b style={{ display: "block" }}>{c.nombre}</b><span style={{ fontSize: 12.5, color: "var(--muted)" }}>{c.nif || "Sin NIF"}{c.ciudad ? ` · ${c.ciudad}` : ""}</span></span><Icon n="right" s={16} c="var(--muted)" /></button>)}
        <button onClick={() => onNuevo(q.trim(), (c) => { onElegir(c); setAbierto(false); setQ(""); })} style={{ ...C.listBtn, borderTop: "none", padding: "11px 12px", color: "var(--accent)", fontWeight: 800 }}><Icon n="plus" s={16} w={2.4} />{q.trim() ? `Crear «${q.trim()}»` : `Nuevo ${tipo === "cliente" ? "cliente" : "proveedor"}`}</button>
      </div>
      {valor?.nombre && <button onClick={() => setAbierto(false)} style={{ ...C.btnSm, marginTop: 8 }}>Dejar {valor.nombre}</button>}
    </div>);
}

/* ---------------- Editor de factura (borrador) ---------------- */
function Editor({ f: inicial, E, d, busy, isMobile, flash, onCerrar, onGuardar, onBorrar, onEmitir, onNuevoContacto }) {
  const [f, setF] = useState(() => ({ ...inicial, lineas: (inicial.lineas || []).map(l => ({ id: l.id || nuevoId(), ...l, precio: l.precio === "" ? "" : String(l.precio ?? "").replace(".", ","), cantidad: String(l.cantidad ?? 1).replace(".", ","), descuento: l.descuento ? String(l.descuento).replace(".", ",") : "" })) }));
  const [confirmar, setConfirmar] = useState(false);
  const [otraFecha, setOtraFecha] = useState(!!inicial.fecha_operacion);
  const set = (k, v) => setF(o => ({ ...o, [k]: v }));
  const setL = (id, k, v) => setF(o => ({ ...o, lineas: o.lineas.map(l => l.id === id ? { ...l, [k]: v } : l) }));
  const limpio = () => ({ ...f, fecha_operacion: otraFecha ? f.fecha_operacion : null, lineas: f.lineas.filter(l => String(l.concepto).trim() || num(l.precio)).map(l => ({ id: l.id, concepto: String(l.concepto).trim(), cantidad: num(l.cantidad), precio: num(l.precio), descuento: num(l.descuento), iva: num(l.iva) })) });
  const T = calcular(limpio().lineas, f.irpf_pct);
  const original = useRef(JSON.stringify(limpio()));
  const cambiado = JSON.stringify(limpio()) !== original.current;
  const rect = f.rectificativa ? d.facturas.find(x => x.id === f.rectifica_id) : null;
  const serie = f.rectificativa ? "R" : E?.serie || "F", anio = (f.fecha || hoyISO()).slice(0, 4);
  const siguiente = `${serie}${anio}-${String(d.facturas.filter(x => x.tipo === "emitida" && x.serie === serie && x.numero && String(x.fecha).startsWith(anio)).reduce((m, x) => Math.max(m, x.numero), 0) + 1).padStart(4, "0")}`;
  const hayExento = limpio().lineas.some(l => num(l.iva) === 0);
  const faltas = [!f.contacto?.nombre && "el cliente", f.contacto?.nombre && !f.contacto?.nif && "el NIF del cliente", !limpio().lineas.length && "al menos una línea", f.rectificativa && !String(f.motivo || "").trim() && "el motivo de la rectificación", hayExento && !String(f.notas || "").trim() && "la causa de la exención de IVA (en Notas)", f.fecha > hoyISO() && "una fecha que no sea futura"].filter(Boolean);
  const cerrar = async () => { if (cambiado && (f.contacto?.nombre || limpio().lineas.length)) { const r = await onGuardar(limpio(), true); if (r) flash("Guardado como borrador"); } onCerrar(); };
  const vistaPrevia = async () => { const { pdfFactura } = await import("./pdfFactura"); const doc = await pdfFactura({ ...limpio(), estado: "borrador", rectifica_codigo: rect?.codigo }, E); const u = URL.createObjectURL(doc.output("blob")); window.open(u, "_blank") || descargarBlob(doc.output("blob"), "borrador.pdf"); };
  const lab = (t) => <div style={C.label}>{t}</div>;

  const lineas = (
    <div>
      {!isMobile && <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 58px 96px 58px 74px 92px 34px", gap: 6, fontSize: 11.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: .8, padding: "0 2px 6px" }}>
        <span>Concepto</span><span>Cant.</span><span>Precio</span><span>Dto. %</span><span>IVA</span><span style={{ textAlign: "right" }}>Importe</span><span /></div>}
      {f.lineas.map((l, i) => isMobile ? (
        <div key={l.id} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 10, marginBottom: 8, background: "var(--surface2)" }}>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={l.concepto} onChange={e => setL(l.id, "concepto", e.target.value)} placeholder={`Concepto ${i + 1}`} aria-label={`Concepto ${i + 1}`} style={{ ...C.input, background: "var(--surface)" }} />
            <button onClick={() => set("lineas", f.lineas.filter(x => x.id !== l.id))} aria-label={`Quitar línea ${i + 1}`} style={{ ...C.btnSm, padding: "0 10px" }}><Icon n="trash" s={16} /></button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "0.8fr 1.2fr 1.2fr", gap: 6, marginTop: 6 }}>
            <input value={l.cantidad} inputMode="decimal" onChange={e => setL(l.id, "cantidad", e.target.value)} aria-label="Cantidad" placeholder="Cant." style={{ ...C.input, background: "var(--surface)" }} />
            <input value={l.precio} inputMode="decimal" onChange={e => setL(l.id, "precio", e.target.value)} aria-label="Precio sin IVA" placeholder="Precio €" style={{ ...C.input, background: "var(--surface)", fontWeight: 800 }} />
            <select value={l.iva} onChange={e => setL(l.id, "iva", +e.target.value)} aria-label="IVA" style={{ ...C.input, background: "var(--surface)" }}>{IVAS.map(v => <option key={v} value={v}>{v} % IVA</option>)}</select>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, fontSize: 13 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--muted)" }}>Dto. <input value={l.descuento} inputMode="decimal" onChange={e => setL(l.id, "descuento", e.target.value)} aria-label="Descuento %" placeholder="0" style={{ ...C.input, width: 64, padding: "7px 8px", background: "var(--surface)" }} /> %</label>
            <b>{eur(baseLinea({ cantidad: num(l.cantidad), precio: num(l.precio), descuento: num(l.descuento) }))}</b>
          </div>
        </div>
      ) : (
        <div key={l.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 58px 96px 58px 74px 92px 34px", gap: 6, alignItems: "center", marginBottom: 6 }}>
          <input value={l.concepto} onChange={e => setL(l.id, "concepto", e.target.value)} placeholder={`Concepto ${i + 1}`} aria-label={`Concepto ${i + 1}`} style={C.input} />
          <input value={l.cantidad} inputMode="decimal" onChange={e => setL(l.id, "cantidad", e.target.value)} aria-label="Cantidad" style={{ ...C.input, textAlign: "right" }} />
          <input value={l.precio} inputMode="decimal" onChange={e => setL(l.id, "precio", e.target.value)} aria-label="Precio sin IVA" placeholder="0,00" style={{ ...C.input, textAlign: "right", fontWeight: 800 }} />
          <input value={l.descuento} inputMode="decimal" onChange={e => setL(l.id, "descuento", e.target.value)} aria-label="Descuento %" placeholder="0" style={{ ...C.input, textAlign: "right" }} />
          <select value={l.iva} onChange={e => setL(l.id, "iva", +e.target.value)} aria-label="IVA" style={{ ...C.input, padding: "11px 6px" }}>{IVAS.map(v => <option key={v} value={v}>{v} %</option>)}</select>
          <b style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{eur(baseLinea({ cantidad: num(l.cantidad), precio: num(l.precio), descuento: num(l.descuento) }))}</b>
          <button onClick={() => set("lineas", f.lineas.filter(x => x.id !== l.id))} aria-label={`Quitar línea ${i + 1}`} style={{ ...C.btnSm, padding: "8px", justifyContent: "center" }}><Icon n="x" s={15} /></button>
        </div>))}
      <button onClick={() => set("lineas", [...f.lineas, lineaVacia(Number(f.lineas.at(-1)?.iva ?? E?.iva_def ?? 21))])} style={{ ...C.btnGhost, width: "100%", borderStyle: "dashed", marginTop: 4 }}><Icon n="plus" s={16} w={2.4} />Añadir línea</button>
    </div>);

  const totales = (
    <div style={{ ...C.card, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "3px 0" }}><span style={{ color: "var(--muted)" }}>Base imponible</span><b>{eur(T.base)}</b></div>
      {T.desglose.map(x => <div key={x.tipo} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "3px 0" }}><span style={{ color: "var(--muted)" }}>IVA {x.tipo} %</span><span>{eur(x.cuota)}</span></div>)}
      {num(f.irpf_pct) > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "3px 0" }}><span style={{ color: "var(--muted)" }}>Retención IRPF {num(f.irpf_pct)} %</span><span>− {eur(T.cuota_irpf)}</span></div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderTop: "1px solid var(--line)", marginTop: 8, paddingTop: 10 }}><b>Total</b><b style={{ fontSize: 26, letterSpacing: -.5 }}>{eur(T.total)}</b></div>
    </div>);

  return (
    <div role="dialog" aria-label={f.rectificativa ? "Factura rectificativa" : "Factura"} style={{ position: "fixed", inset: 0, zIndex: 90, background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "max(12px, env(safe-area-inset-top)) 16px 12px", borderBottom: "1px solid var(--line)", background: "var(--surface)" }}>
        <button onClick={cerrar} aria-label="Cerrar" style={{ ...C.btnSm, padding: "9px 11px" }}><Icon n="x" s={17} /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: 17 }}>{f.rectificativa ? "Factura rectificativa" : f.id ? "Borrador de factura" : "Nueva factura"}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Al emitirla será la {siguiente}{cambiado ? " · se guarda como borrador al cerrar" : ""}</div>
        </div>
        {!isMobile && <button onClick={vistaPrevia} style={C.btnGhost}><Icon n="eye" s={17} />Vista previa</button>}
      </header>
      <div style={{ flex: 1, overflow: "auto", WebkitOverflowScrolling: "touch" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: isMobile ? 14 : 24, display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0,1fr) 320px", gap: 20, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {rect && <div style={{ ...C.card, borderColor: "color-mix(in srgb, var(--amber) 50%, var(--line))" }}>
              <div style={{ fontWeight: 800 }}>Rectifica a la factura {rect.codigo} ({eur(rect.total)})</div>
              <div style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 10px" }}>Las cantidades van en negativo para anularla; cámbialas si solo corriges una parte.</div>
              <Field l="Motivo de la rectificación" mb={0}><input value={f.motivo || ""} maxLength={500} onChange={e => set("motivo", e.target.value)} placeholder="Ej.: error en el precio, devolución…" style={C.input} /></Field>
            </div>}
            <section style={C.panel}>{lab("Cliente")}<ElegirContacto d={d} tipo="cliente" valor={f.contacto} onElegir={(c) => setF(o => ({ ...o, contacto_id: c.id, contacto: fdb.fotoContacto(c) }))} onNuevo={onNuevoContacto} /></section>
            <section style={C.panel}>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3,minmax(0,1fr))", gap: 10 }}>
                <Field l="Fecha" mb={0}><input type="date" value={f.fecha} max={hoyISO()} onChange={e => setF(o => ({ ...o, fecha: e.target.value, vencimiento: o.vencimiento && E ? masDias(e.target.value, E.vencimiento_dias) : o.vencimiento }))} style={C.input} /></Field>
                <Field l="Vencimiento" mb={0}><input type="date" value={f.vencimiento || ""} onChange={e => set("vencimiento", e.target.value)} style={C.input} /></Field>
                <Field l="Forma de pago" mb={0}><select value={f.forma_pago || ""} onChange={e => set("forma_pago", e.target.value)} style={C.input}><option value="">—</option>{PAGOS.map(p => <option key={p}>{p}</option>)}</select></Field>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}><input type="checkbox" checked={otraFecha} onChange={e => { setOtraFecha(e.target.checked); if (e.target.checked && !f.fecha_operacion) set("fecha_operacion", f.fecha); }} />El servicio se hizo otro día</label>
              {otraFecha && <div style={{ maxWidth: 240, marginTop: 8 }}><Field l="Fecha de la operación" mb={0}><input type="date" value={f.fecha_operacion || ""} onChange={e => set("fecha_operacion", e.target.value)} style={C.input} /></Field></div>}
            </section>
            <section style={C.panel}>{isMobile && lab("Conceptos")}{lineas}</section>
            <section style={C.panel}>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "220px minmax(0,1fr)", gap: 12 }}>
                <Field l="Retención IRPF" mb={0}><select value={num(f.irpf_pct)} onChange={e => set("irpf_pct", +e.target.value)} style={C.input}>{IRPFS.map(v => <option key={v} value={v}>{v ? `${v} %` : "Sin retención"}</option>)}</select>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>Autónomos que facturan a empresas: 15 % (7 % los 3 primeros años).</div></Field>
                <Field l={hayExento ? "Notas (indica la causa de la exención de IVA)" : "Notas para el cliente"} mb={0}><textarea value={f.notas || ""} maxLength={2000} rows={3} onChange={e => set("notas", e.target.value)} placeholder={hayExento ? "Ej.: Operación exenta de IVA según el art. 20.Uno.14º de la Ley 37/1992" : "Gracias por confiar en nosotros."} style={{ ...C.input, resize: "vertical", fontFamily: "inherit" }} /></Field>
              </div>
            </section>
            <section style={C.panel}>
              {lab("Plantilla")}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
                {PLANTILLAS.map(p => <button key={p.k} onClick={() => set("plantilla", p.k)} aria-pressed={(f.plantilla || E?.plantilla) === p.k} style={{ textAlign: "left", padding: 10, borderRadius: 12, cursor: "pointer", border: `2px solid ${(f.plantilla || E?.plantilla) === p.k ? "var(--accent)" : "var(--line)"}`, background: "var(--surface2)", color: "var(--text)" }}>
                  <MiniPlantilla k={p.k} color={E?.color} /><div style={{ fontWeight: 800, fontSize: 13.5, marginTop: 6 }}>{p.t}</div>{!isMobile && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{p.sub}</div>}</button>)}
              </div>
            </section>
          </div>
          <aside style={{ position: isMobile ? "static" : "sticky", top: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            {totales}
            {faltas.length > 0 && <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>Para emitirla falta: {faltas.join(", ")}.</div>}
            {!isMobile && <>
              <button onClick={() => setConfirmar(true)} disabled={busy || faltas.length > 0} style={{ ...C.btnPrimary, padding: "14px 18px", fontSize: 16, opacity: faltas.length ? .45 : 1 }}><Icon n="check" s={18} w={2.6} />Emitir factura</button>
              <button onClick={async () => { const r = await onGuardar(limpio()); if (r) { original.current = JSON.stringify(limpio()); setF(o => ({ ...o, id: r.id })); } }} disabled={busy} style={C.btnGhost}>Guardar borrador</button>
              {f.id && <button onClick={() => onBorrar(f)} style={{ ...C.btnSm, color: "var(--red)", alignSelf: "flex-start" }}><Icon n="trash" s={15} />Borrar borrador</button>}
            </>}
          </aside>
        </div>
      </div>
      {isMobile && <footer style={{ display: "flex", gap: 8, padding: "10px 14px calc(10px + env(safe-area-inset-bottom))", borderTop: "1px solid var(--line)", background: "var(--surface)" }}>
        <button onClick={vistaPrevia} aria-label="Vista previa" style={{ ...C.btnGhost, padding: "12px" }}><Icon n="eye" s={18} /></button>
        <button onClick={async () => { const r = await onGuardar(limpio()); if (r) { original.current = JSON.stringify(limpio()); setF(o => ({ ...o, id: r.id })); } }} disabled={busy} style={{ ...C.btnGhost, flex: 1 }}>Guardar</button>
        <button onClick={() => setConfirmar(true)} disabled={busy || faltas.length > 0} style={{ ...C.btnPrimary, flex: 1.6, opacity: faltas.length ? .45 : 1 }}>Emitir · {eur(T.total)}</button>
      </footer>}
      {confirmar && <Sheet title="Emitir factura" onClose={() => setConfirmar(false)} footer={<div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setConfirmar(false)} style={{ ...C.btnGhost, flex: 1 }}>Revisar</button>
          <button onClick={async () => { setConfirmar(false); await onEmitir(limpio()); }} disabled={busy} style={{ ...C.btnPrimary, flex: 1.5 }}>Emitir {siguiente}</button></div>}>
        <div style={{ fontSize: 15, lineHeight: 1.55 }}>
          <p style={{ marginTop: 0 }}>Se numerará como <b>{siguiente}</b> para <b>{f.contacto?.nombre}</b> por <b>{eur(T.total)}</b>.</p>
          <p>Una vez emitida <b>no se puede cambiar ni borrar</b> (lo exige la ley): si hay un error, se corrige con una factura rectificativa.</p>
          <p style={{ color: "var(--muted)", fontSize: 13.5, marginBottom: 0 }}>Se guarda el PDF en tu archivo de facturas, ordenado por año, trimestre y mes.</p>
        </div>
      </Sheet>}
    </div>
  );
}

// Miniatura de cada plantilla (para elegir de un vistazo)
function MiniPlantilla({ k, color = "#ff5a3c" }) {
  const g = "var(--line)";
  return (
    <div aria-hidden="true" style={{ height: 70, borderRadius: 8, background: "#fff", border: "1px solid #e6e8ec", overflow: "hidden", position: "relative" }}>
      {k === "moderna" ? <div style={{ height: 18, background: color }} /> : <div style={{ height: 4, margin: "14px 8px 0", background: k === "minimal" ? "#15171c" : color, borderRadius: 2 }} />}
      <div style={{ display: "flex", gap: 6, padding: "8px 8px 0" }}><div style={{ flex: 1, height: 5, background: "#e6e8ec", borderRadius: 2 }} /><div style={{ flex: 1, height: 5, background: "#e6e8ec", borderRadius: 2 }} /></div>
      <div style={{ height: 6, margin: "8px 8px 0", background: k === "clasica" ? `${color}33` : k === "moderna" ? color : "#15171c", borderRadius: 2, opacity: k === "minimal" ? .2 : 1 }} />
      <div style={{ position: "absolute", right: 8, bottom: 8, width: 30, height: 8, borderRadius: 2, background: k === "minimal" ? "#15171c" : color }} />
    </div>);
}

/* ---------------- Ver una factura emitida ---------------- */
function VerFactura({ f, d, E, busy, isMobile, flash, onCerrar, onPagada, onDuplicar, onRectificar, onArchivar, onRecordar, onRepetir }) {
  const [pdf, setPdf] = useState(false);
  const rect = d.facturas.find(x => x.id === f.rectifica_id);
  const rectificadaPor = d.facturas.filter(x => x.rectifica_id === f.id && x.estado !== "borrador");
  const [t, c] = estadoDe(f);
  const obtener = async () => {
    if (f.archivo_path) { try { return await fdb.bajarArchivo(f.archivo_path); } catch {} }
    const { pdfFactura } = await import("./pdfFactura"); return (await pdfFactura({ ...f, rectifica_codigo: rect?.codigo }, E)).output("blob");
  };
  const nombre = fdb.nombreArchivo(f);
  const accion = async (modo) => {
    setPdf(true);
    try {
      const blob = await obtener();
      if (modo === "compartir" && navigator.canShare) { const file = new File([blob], nombre, { type: "application/pdf" }); if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: `Factura ${f.codigo}` }); return; } }
      descargarBlob(blob, nombre);
    } catch (e) { if (e?.name !== "AbortError") flash("No se ha podido preparar el PDF", "warn"); } finally { setPdf(false); }
  };
  return (
    <Sheet title={`Factura ${f.codigo}`} onClose={onCerrar} footer={<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button onClick={() => accion("descargar")} disabled={pdf} style={{ ...C.btnGhost, flex: "1 1 140px" }}><Icon n="download" s={17} />{pdf ? "Preparando…" : "Descargar PDF"}</button>
      <button onClick={() => accion("compartir")} disabled={pdf} style={{ ...C.btnPrimary, flex: "1 1 140px" }}><Icon n="share" s={17} />Enviar</button>
    </div>}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div><div style={{ fontWeight: 900, fontSize: 17 }}>{f.contacto?.nombre}</div><div style={{ color: "var(--muted)", fontSize: 13 }}>NIF {f.contacto?.nif} · {fechaES(f.fecha)}{f.vencimiento ? ` · vence ${fechaES(f.vencimiento)}` : ""}</div></div>
        <Badge c={c}>{t}</Badge>
      </div>
      <div style={{ fontSize: 32, fontWeight: 900, letterSpacing: -.6, margin: "14px 0 6px" }}>{eur(f.total)}</div>
      <div style={{ fontSize: 13, color: "var(--muted)" }}>Base {eur(f.base)} · IVA {eur(f.cuota_iva)}{num(f.cuota_irpf) ? ` · IRPF −${eur(f.cuota_irpf)}` : ""}</div>
      {rect && <div style={{ ...C.tag, marginTop: 10 }}>Rectifica a {rect.codigo}{f.motivo ? ` · ${f.motivo}` : ""}</div>}
      {rectificadaPor.length > 0 && <div style={{ ...C.tag, marginTop: 10, color: "var(--amber)" }}>Rectificada por {rectificadaPor.map(x => x.codigo).join(", ")}</div>}
      {!f.archivo_path && <div style={{ ...C.card, marginTop: 12, padding: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", borderColor: "color-mix(in srgb, var(--amber) 50%, var(--line))" }}>
        <Icon n="alert" s={18} c="var(--amber)" />
        <span style={{ flex: "1 1 200px", fontSize: 13.5 }}><b>El PDF no está en tu archivo.</b> <span style={{ color: "var(--muted)" }}>Guárdalo para que vaya en el ZIP de la gestoría tal y como se emitió.</span></span>
        <button onClick={() => onArchivar(f)} disabled={busy} style={C.btnSm}><Icon n="upload" s={15} />Guardar PDF</button>
      </div>}
      {f.estado === "emitida" && f.recordada_en && <div style={{ ...C.tag, marginTop: 10 }}>Recordatorio enviado el {fechaES(f.recordada_en.slice(0, 10))}</div>}
      <div style={{ marginTop: 14 }}>
        {(f.lineas || []).map((l, i) => <div key={i} style={{ ...C.row, fontSize: 14 }}><span style={{ flex: 1, minWidth: 0 }}>{l.concepto || "—"}<span style={{ color: "var(--muted)" }}> · {String(l.cantidad).replace(".", ",")} × {eur(l.precio)}{num(l.descuento) ? ` −${l.descuento} %` : ""} · IVA {l.iva} %</span></span><b>{eur(baseLinea(l))}</b></div>)}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
        <button onClick={() => onPagada(f, f.estado !== "pagada")} disabled={busy} style={C.btnSm}><Icon n={f.estado === "pagada" ? "x" : "check"} s={15} />{f.estado === "pagada" ? "Marcar como pendiente" : "Marcar como cobrada"}</button>
        <button onClick={() => onDuplicar(f)} style={C.btnSm}><Icon n="copy" s={15} />Duplicar</button>
        {!f.rectificativa && <button onClick={() => onRectificar(f)} style={C.btnSm}><Icon n="edit" s={15} />Rectificar</button>}
        {f.estado === "emitida" && <button onClick={() => onRecordar(f)} style={C.btnSm}><Icon n="mail" s={15} />Recordar pago</button>}
        {!f.rectificativa && onRepetir && <button onClick={() => onRepetir(f)} style={C.btnSm}><Icon n="refresh" s={15} />Repetir</button>}
      </div>
      <details style={{ marginTop: 16, fontSize: 12, color: "var(--muted)" }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>Registro y huella (VERI*FACTU)</summary>
        <div style={{ marginTop: 8, wordBreak: "break-all", lineHeight: 1.5 }}>Registrada el {new Date(f.registrada_en).toLocaleString("es-ES")}<br />Huella: {f.huella}<br />Anterior: {f.huella_anterior || "— (primera factura)"}</div>
      </details>
    </Sheet>
  );
}

/* ---------------- Recordatorio de cobro ---------------- */
const telWa = (t) => { let x = String(t || "").replace(/[^\d+]/g, ""); if (x.startsWith("+")) return x.slice(1); if (x.startsWith("00")) return x.slice(2); return x.length === 9 ? `34${x}` : x; };
function Recordatorio({ f, d, E, onCerrar, onEnviado }) {
  const ct = d.contactos.find(c => c.id === f.contacto_id) || {};
  const email = f.contacto?.email || ct.email || "", tel = ct.telefono || "";
  const inicial = textoRecordatorio(f, E || f.emisor || {}, hoyISO());
  const [asunto, setAsunto] = useState(inicial.asunto);
  const [cuerpo, setCuerpo] = useState(inicial.cuerpo);
  const abrir = (url) => { window.open(url, "_blank"); onEnviado(f); };
  return (
    <Sheet title="Recordar el pago" onClose={onCerrar} footer={<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button onClick={() => abrir(`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`)} style={{ ...C.btnPrimary, flex: "1 1 140px" }}><Icon n="mail" s={17} />Correo</button>
      <button onClick={() => abrir(`https://wa.me/${telWa(tel)}?text=${encodeURIComponent(cuerpo)}`)} disabled={!tel} title={tel ? "" : "Este contacto no tiene teléfono"} style={{ ...C.btnGhost, flex: "1 1 140px", opacity: tel ? 1 : .45 }}><Icon n="whatsapp" s={17} />WhatsApp</button>
    </div>}>
      <div style={{ fontSize: 13.5, color: "var(--muted)", marginBottom: 12 }}>{f.codigo} · {f.contacto?.nombre} · <b style={{ color: "var(--text)" }}>{eur(f.total)}</b>{email ? ` · ${email}` : " · sin correo (podrás escribirlo en tu programa de correo)"}</div>
      <Field l="Asunto"><input value={asunto} onChange={e => setAsunto(e.target.value)} style={C.input} /></Field>
      <Field l="Mensaje" mb={0}><textarea value={cuerpo} onChange={e => setCuerpo(e.target.value)} rows={9} style={{ ...C.input, resize: "vertical", fontFamily: "inherit" }} /></Field>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Se abre tu correo o WhatsApp con el mensaje listo. Para adjuntar el PDF, descárgalo desde la factura.</div>
    </Sheet>);
}

/* ---------------- Factura que se repite ---------------- */
function FormRecurrente({ r: inicial, d, busy, onCerrar, onGuardar, onBorrar }) {
  const [r, setR] = useState(() => ({ ...inicial, lineas: (inicial.lineas || []).map(l => ({ ...l, precio: String(l.precio ?? "").replace(".", ",") })) }));
  const set = (k, v) => setR(o => ({ ...o, [k]: v }));
  const limpio = () => ({ ...r, lineas: r.lineas.map(l => ({ ...l, precio: num(l.precio), cantidad: num(l.cantidad) || 1 })).filter(l => String(l.concepto || "").trim() || l.precio) });
  const T = calcular(limpio().lineas, r.irpf_pct);
  const listo = String(r.nombre || "").trim() && r.inicio && limpio().lineas.length;
  return (
    <Sheet title={r.id ? "Factura que se repite" : "Repetir esta factura"} onClose={onCerrar} footer={<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      {r.id && <button onClick={() => onBorrar(r)} aria-label="Dejar de repetir" style={{ ...C.btnGhost, color: "var(--red)", padding: "11px 13px" }}><Icon n="trash" s={17} /></button>}
      <div style={{ flex: 1, fontWeight: 900, fontSize: 18 }}>{eur(T.total)}</div>
      <button onClick={() => onGuardar(limpio())} disabled={busy || !listo} style={{ ...C.btnPrimary, opacity: listo ? 1 : .45 }}>{r.id ? "Guardar" : "Repetir"}</button>
    </div>}>
      <div style={{ fontSize: 13.5, color: "var(--muted)", marginBottom: 12 }}>Para <b style={{ color: "var(--text)" }}>{r.contacto?.nombre}</b>. Cada periodo se prepara un <b>borrador</b> con fecha del día: lo revisas y lo emites tú.</div>
      <Field l="Nombre (solo para ti)"><input value={r.nombre || ""} maxLength={120} onChange={e => set("nombre", e.target.value)} style={C.input} /></Field>
      <Field l="Cada cuánto"><Seg full size="sm" valor={r.cada_meses} onChange={(v) => set("cada_meses", v)} opciones={[{ k: 1, t: "Mes" }, { k: 3, t: "Trimestre" }, { k: 6, t: "Semestre" }, { k: 12, t: "Año" }]} /></Field>
      <Field l={r.id ? "Empezó el" : "Primer borrador el"}><input type="date" value={r.inicio || ""} onChange={e => set("inicio", e.target.value)} disabled={!!r.id && r.generadas > 0} style={C.input} /></Field>
      <Field l="Conceptos">
        {r.lineas.map((l, i) => <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 110px", gap: 6, marginBottom: 6 }}>
          <input value={l.concepto || ""} onChange={e => setR(o => ({ ...o, lineas: o.lineas.map((x, j) => j === i ? { ...x, concepto: e.target.value } : x) }))} aria-label={`Concepto ${i + 1}`} style={C.input} />
          <input value={l.precio} inputMode="decimal" onChange={e => setR(o => ({ ...o, lineas: o.lineas.map((x, j) => j === i ? { ...x, precio: e.target.value } : x) }))} aria-label={`Precio ${i + 1}`} style={{ ...C.input, textAlign: "right", fontWeight: 800 }} />
        </div>)}
        <div style={{ fontSize: 12, color: "var(--muted)" }}>Escribe <b>{"{mes}"}</b> o <b>{"{año}"}</b> y se cambiará por el del periodo. Ej.: «Cuota de {"{mes}"} {"{año}"}».</div>
      </Field>
      {r.id && <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}><input type="checkbox" checked={r.activa !== false} onChange={e => set("activa", e.target.checked)} />Activa (desmárcala para pausarla)</label>}
    </Sheet>);
}

/* ---------------- Factura de gasto (recibida) ---------------- */
function FormGasto({ g: inicial, d, busy, isMobile, onCerrar, onGuardar, onBorrar, onNuevoContacto }) {
  const [g, setG] = useState(() => ({ ...inicial, lineas: (inicial.lineas || []).map(l => ({ id: l.id || nuevoId(), ...l, precio: l.precio === "" ? "" : String(l.precio ?? "").replace(".", ",") })) }));
  const [archivo, setArchivo] = useState(null);
  const [desdeTotal, setDesdeTotal] = useState("");
  const [leido, setLeido] = useState(null);   // { campos: [...], nifNuevo } tras leer el PDF
  const set = (k, v) => setG(o => ({ ...o, [k]: v }));
  // Al elegir un PDF se leen sus datos (en el navegador) y se rellenan solo los campos vacíos
  const elegirArchivo = async (file) => {
    setArchivo(file); setLeido(null);
    if (!file || !/pdf$/i.test(file.type || file.name)) return;
    try {
      const [{ leerPdf }, { interpretarGasto, textoDePaginas }, pdfjs] = await Promise.all([import("../facturaPdf"), import("./leerGasto"), cargarPdfjs()]);
      const x = interpretarGasto(textoDePaginas(await leerPdf(await file.arrayBuffer(), pdfjs)), d.emisor?.nif);
      const campos = [], cambios = {};
      const ct = x.nif && d.contactos.find(c => (c.nif || "").toUpperCase() === x.nif);
      if (ct && !g.contacto?.nombre) { cambios.contacto_id = ct.id; cambios.contacto = fdb.fotoContacto(ct); campos.push("proveedor"); }
      if (x.numero && !g.num_proveedor) { cambios.num_proveedor = x.numero; campos.push("número"); }
      if (x.fecha && (!g.id && g.fecha === hoyISO())) { cambios.fecha = x.fecha; campos.push("fecha"); }
      if (x.base != null && x.base > 0 && !g.lineas.some(l => num(l.precio))) { cambios.lineas = [{ ...g.lineas[0], precio: String(x.base).replace(".", ","), iva: x.iva ?? g.lineas[0]?.iva ?? 21 }, ...g.lineas.slice(1)]; campos.push("importe"); }
      setG(o => ({ ...o, ...cambios }));
      setLeido({ campos, nifNuevo: x.nif && !ct && !g.contacto?.nombre ? x.nif : null, total: x.total });
    } catch { setLeido({ campos: [], error: true }); }
  };
  const setL = (id, k, v) => setG(o => ({ ...o, lineas: o.lineas.map(l => l.id === id ? { ...l, [k]: v } : l) }));
  const limpio = () => ({ ...g, lineas: g.lineas.filter(l => num(l.precio)).map(l => ({ id: l.id, concepto: g.categoria || "Gasto", cantidad: 1, precio: num(l.precio), iva: num(l.iva) })) });
  const T = calcular(limpio().lineas, g.irpf_pct);
  const verArchivo = async () => { try { window.open(await fdb.urlArchivo(g.archivo_path), "_blank"); } catch {} };
  const listo = g.contacto?.nombre && limpio().lineas.length;
  return (
    <Sheet title={g.id ? "Factura de gasto" : "Añadir gasto"} onClose={onCerrar} footer={<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      {g.id && <button onClick={() => onBorrar(g)} aria-label="Borrar gasto" style={{ ...C.btnGhost, color: "var(--red)", padding: "11px 13px" }}><Icon n="trash" s={17} /></button>}
      <div style={{ flex: 1, fontWeight: 900, fontSize: 18 }}>{eur(T.total)}</div>
      <button onClick={() => onGuardar(limpio(), archivo)} disabled={busy || !listo} style={{ ...C.btnPrimary, opacity: listo ? 1 : .45 }}>{g.id ? "Guardar" : "Añadir gasto"}</button>
    </div>}>
      <Field l="Factura (PDF o foto)">
        <label style={{ display: "flex", alignItems: "center", gap: 12, border: "2px dashed var(--line)", borderRadius: 14, padding: 14, cursor: "pointer", background: "var(--surface2)" }}>
          <Tile n="upload" s={38} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}><b style={{ display: "block" }}>{archivo ? archivo.name : g.archivo_path ? "Factura adjunta" : "Subir o hacer foto"}</b><span style={{ color: "var(--muted)" }}>{archivo ? `${Math.round(archivo.size / 1024)} KB` : "Si es un PDF, leemos sus datos. Se guarda en su mes y en «gastos»"}</span></span>
          <input type="file" accept="application/pdf,image/*" onChange={e => elegirArchivo(e.target.files?.[0] || null)} style={{ display: "none" }} />
        </label>
        {leido && <div style={{ fontSize: 12.5, marginTop: 8, color: leido.campos.length ? "var(--green)" : "var(--muted)" }}>
          {leido.campos.length ? <>Leído del PDF: {leido.campos.join(", ")}{leido.total ? ` · total ${eur(leido.total)}` : ""}. <b>Revísalo antes de guardar.</b></> : leido.error ? "No se ha podido leer el PDF: rellena los datos a mano." : "No se han reconocido datos en el PDF: rellénalos a mano."}
          {leido.nifNuevo && <div style={{ marginTop: 6, color: "var(--text)" }}>El NIF {leido.nifNuevo} no está en tus proveedores. <button onClick={() => onNuevoContacto("", (c) => setG(o => ({ ...o, contacto_id: c.id, contacto: fdb.fotoContacto(c) })), { nif: leido.nifNuevo })} style={{ ...C.btnSm, marginLeft: 4 }}><Icon n="plus" s={14} w={2.4} />Crear proveedor</button></div>}
        </div>}
        {g.archivo_path && !archivo && <button onClick={verArchivo} style={{ ...C.btnSm, marginTop: 8 }}><Icon n="eye" s={15} />Ver factura adjunta</button>}
      </Field>
      <Field l="Proveedor"><ElegirContacto d={d} tipo="proveedor" valor={g.contacto} onElegir={(c) => setG(o => ({ ...o, contacto_id: c.id, contacto: fdb.fotoContacto(c) }))} onNuevo={onNuevoContacto} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field l="Nº de su factura"><input value={g.num_proveedor || ""} maxLength={60} onChange={e => set("num_proveedor", e.target.value)} placeholder="Ej. A-2026/154" style={C.input} /></Field>
        <Field l="Fecha"><input type="date" value={g.fecha} onChange={e => set("fecha", e.target.value)} style={C.input} /></Field>
      </div>
      <Field l="Categoría"><select value={g.categoria || ""} onChange={e => set("categoria", e.target.value)} style={C.input}>{CATEGORIAS_GASTO.map(c => <option key={c}>{c}</option>)}</select></Field>
      <Field l="Importes sin IVA">
        {g.lineas.map((l, i) => <div key={l.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 112px 34px", gap: 6, marginBottom: 6 }}>
          <input value={l.precio} inputMode="decimal" onChange={e => setL(l.id, "precio", e.target.value)} placeholder="Base imponible €" aria-label={`Base ${i + 1}`} style={{ ...C.input, fontWeight: 800 }} />
          <select value={l.iva} onChange={e => setL(l.id, "iva", +e.target.value)} aria-label="IVA" style={C.input}>{IVAS.map(v => <option key={v} value={v}>IVA {v} %</option>)}</select>
          <button onClick={() => set("lineas", g.lineas.length > 1 ? g.lineas.filter(x => x.id !== l.id) : g.lineas)} aria-label="Quitar" style={{ ...C.btnSm, padding: 8, justifyContent: "center" }}><Icon n="x" s={15} /></button>
        </div>)}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => set("lineas", [...g.lineas, { id: nuevoId(), precio: "", iva: 10 }])} style={C.btnSm}><Icon n="plus" s={14} w={2.4} />Otro tipo de IVA</button>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--muted)" }}>¿Solo sabes el total?
            <input value={desdeTotal} inputMode="decimal" onChange={e => setDesdeTotal(e.target.value)} placeholder="Total €" aria-label="Total con IVA" style={{ ...C.input, width: 96, padding: "6px 8px" }} />
            <button onClick={() => { const iva = num(g.lineas[0]?.iva ?? 21), base = Math.round(num(desdeTotal) / (1 + iva / 100) * 100) / 100; if (base > 0) setG(o => ({ ...o, lineas: [{ ...o.lineas[0], precio: String(base).replace(".", ",") }, ...o.lineas.slice(1)] })); }} style={C.btnSm}>Calcular</button></span>
        </div>
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field l="IRPF retenido"><select value={num(g.irpf_pct)} onChange={e => set("irpf_pct", +e.target.value)} style={C.input}>{IRPFS.map(v => <option key={v} value={v}>{v ? `${v} %` : "Sin retención"}</option>)}</select></Field>
        <Field l="Estado"><Seg full size="sm" valor={g.estado} onChange={(v) => set("estado", v)} opciones={[{ k: "pendiente", t: "Por pagar" }, { k: "pagada", t: "Pagada" }]} /></Field>
      </div>
      <div style={{ ...C.card, padding: 12, fontSize: 13.5 }}>Base {eur(T.base)} · IVA {eur(T.cuota_iva)}{T.cuota_irpf ? ` · IRPF −${eur(T.cuota_irpf)}` : ""} · <b>Total {eur(T.total)}</b></div>
      <Field l="Notas" mb={0}><input value={g.notas || ""} maxLength={2000} onChange={e => set("notas", e.target.value)} style={C.input} /></Field>
    </Sheet>
  );
}

/* ---------------- Contactos ---------------- */
function Contactos({ d, isMobile, onAbrir }) {
  const [q, setQ] = useState(""); const [tipo, setTipo] = useState("todos");
  const uso = useMemo(() => { const m = {}; d.facturas.forEach(f => { if (f.contacto_id && f.estado !== "borrador") m[f.contacto_id] = (m[f.contacto_id] || 0) + num(f.total); }); return m; }, [d.facturas]);
  const lista = d.contactos.filter(c => tipo === "todos" || c.tipo === tipo || c.tipo === "ambos").filter(c => !q.trim() || [c.nombre, c.nif, c.email, c.ciudad].some(v => String(v || "").toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <section style={C.panel}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 6 }}>
        <div style={{ position: "relative", flex: "1 1 220px" }}><span style={{ position: "absolute", left: 12, top: 12, color: "var(--muted)" }}><Icon n="search" s={17} /></span><input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nombre, NIF, correo…" aria-label="Buscar contactos" style={{ ...C.input, paddingLeft: 38 }} /></div>
        <Seg size="sm" valor={tipo} onChange={setTipo} opciones={[{ k: "todos", t: "Todos" }, { k: "cliente", t: "Clientes" }, { k: "proveedor", t: "Proveedores" }]} />
        <button onClick={() => onAbrir({ tipo: tipo === "proveedor" ? "proveedor" : "cliente" })} style={C.btnPrimary}><Icon n="plus" s={16} w={2.4} />{isMobile ? "Nuevo" : "Nuevo contacto"}</button>
      </div>
      {lista.length ? lista.map(c => <button key={c.id} onClick={() => onAbrir(c)} style={C.listBtn}>
        <Tile n={c.tipo === "proveedor" ? "store" : "user"} s={36} />
        <span style={{ flex: 1, minWidth: 0 }}><b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.nombre}</b><span style={{ fontSize: 12.5, color: "var(--muted)" }}>{c.nif || "Sin NIF"}{c.ciudad ? ` · ${c.ciudad}` : ""} · {c.tipo === "ambos" ? "cliente y proveedor" : c.tipo}</span></span>
        {uso[c.id] ? <b style={{ fontVariantNumeric: "tabular-nums" }}>{eur(uso[c.id])}</b> : null}
      </button>) : <div style={{ ...C.empty, marginTop: 10 }}>{d.contactos.length ? "Nada coincide con la búsqueda." : "Tus clientes y proveedores aparecerán aquí. También se crean al hacer una factura."}</div>}
    </section>);
}
function FormContacto({ c: inicial, busy, onCerrar, onGuardar, onBorrar }) {
  const [c, setC] = useState({ pais: "España", ...inicial });
  const set = (k, v) => setC(o => ({ ...o, [k]: v }));
  const inp = (k, l, o = {}) => <Field l={l}><input value={c[k] || ""} onChange={e => set(k, o.up ? e.target.value.toUpperCase() : e.target.value)} maxLength={o.max || 160} inputMode={o.im} autoComplete="off" style={C.input} /></Field>;
  return (
    <Sheet title={c.id ? c.nombre : c.tipo === "proveedor" ? "Nuevo proveedor" : "Nuevo cliente"} onClose={onCerrar} footer={<div style={{ display: "flex", gap: 8 }}>
      {c.id && <button onClick={() => onBorrar(c)} aria-label="Borrar contacto" style={{ ...C.btnGhost, color: "var(--red)", padding: "11px 13px" }}><Icon n="trash" s={17} /></button>}
      <button onClick={() => onGuardar(c)} disabled={busy || !String(c.nombre || "").trim()} style={{ ...C.btnPrimary, flex: 1, opacity: String(c.nombre || "").trim() ? 1 : .45 }}>Guardar</button></div>}>
      <Field l="Tipo"><Seg full size="sm" valor={c.tipo || "cliente"} onChange={(v) => set("tipo", v)} opciones={[{ k: "cliente", t: "Cliente" }, { k: "proveedor", t: "Proveedor" }, { k: "ambos", t: "Los dos" }]} /></Field>
      {inp("nombre", "Nombre o razón social")}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{inp("nif", "NIF / CIF", { up: true, max: 20 })}{inp("telefono", "Teléfono", { im: "tel", max: 40 })}</div>
      {inp("email", "Correo", { im: "email" })}
      {inp("direccion", "Dirección", { max: 200 })}
      <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 10 }}>{inp("cp", "C. P.", { im: "numeric", max: 10 })}{inp("ciudad", "Ciudad", { max: 80 })}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{inp("provincia", "Provincia", { max: 80 })}{inp("pais", "País", { max: 60 })}</div>
      <Field l="Notas" mb={0}><textarea value={c.notas || ""} maxLength={1000} rows={2} onChange={e => set("notas", e.target.value)} style={{ ...C.input, resize: "vertical", fontFamily: "inherit" }} /></Field>
    </Sheet>);
}

/* ---------------- Datos fiscales ---------------- */
function DatosFiscales({ E, busy, isMobile, flash, onGuardar }) {
  const [x, setX] = useState(() => ({ tipo: "sociedad", pais: "España", serie: "F", iva_def: 21, irpf_def: 0, vencimiento_dias: 30, plantilla: "clasica", color: "#ff5a3c", qr: false, ...(E || {}) }));
  const [subiendo, setSubiendo] = useState(false);
  const set = (k, v) => setX(o => ({ ...o, [k]: v }));
  const nifOk = /^[A-Z0-9]{8,12}$/.test(String(x.nif || "").toUpperCase().replace(/[^A-Z0-9]/g, ""));
  const listo = String(x.razon_social || "").trim().length >= 2 && nifOk && String(x.direccion || "").trim();
  const inp = (k, l, o = {}) => <Field l={l}><input value={x[k] ?? ""} onChange={e => set(k, o.up ? e.target.value.toUpperCase() : e.target.value)} maxLength={o.max || 160} inputMode={o.im} placeholder={o.ph} style={C.input} /></Field>;
  const subirLogo = async (file) => { if (!file) return; setSubiendo(true); try { set("logo_url", await webSubir("facturacion", "logo", file)); } catch { flash("No se ha podido subir el logo", "warn"); } finally { setSubiendo(false); } };
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0,1fr) minmax(0,1fr)", gap: 14, alignItems: "start" }}>
      <section style={C.panel}>
        <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 4 }}>{E ? "Tus datos fiscales" : "Tus datos fiscales (solo una vez)"}</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>Salen en todas tus facturas. Si cambian, las facturas ya emitidas conservan los datos que tenían.</div>
        <Field l="Facturas como"><Seg full size="sm" valor={x.tipo} onChange={(v) => set("tipo", v)} opciones={[{ k: "sociedad", t: "Sociedad" }, { k: "autonomo", t: "Autónomo" }]} /></Field>
        {inp("razon_social", x.tipo === "autonomo" ? "Nombre y apellidos" : "Razón social", { ph: x.tipo === "autonomo" ? "Como en tu DNI" : "Ej.: Impakta Proyectos S.L." })}
        {inp("nombre_comercial", "Nombre comercial (opcional)")}
        <Field l="NIF / CIF"><input value={x.nif || ""} onChange={e => set("nif", e.target.value.toUpperCase())} maxLength={14} style={{ ...C.input, borderColor: x.nif && !nifOk ? "var(--red)" : "var(--line)" }} />{x.nif && !nifOk && <div style={{ fontSize: 12, color: "var(--red)", marginTop: 4 }}>Revisa el NIF: 9 letras y números, sin guiones.</div>}</Field>
        {inp("direccion", "Dirección fiscal", { max: 200 })}
        <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 10 }}>{inp("cp", "C. P.", { im: "numeric", max: 10 })}{inp("ciudad", "Ciudad", { max: 80 })}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{inp("provincia", "Provincia", { max: 80 })}{inp("pais", "País", { max: 60 })}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{inp("email", "Correo", { im: "email" })}{inp("telefono", "Teléfono", { im: "tel", max: 40 })}</div>
        {inp("iban", "IBAN para cobrar (sale en la factura)", { up: true, max: 40, ph: "ES00 0000 0000 0000 0000 0000" })}
      </section>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <section style={C.panel}>
          <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 12 }}>Aspecto de tus facturas</div>
          <Field l="Logo">
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 120, height: 56, borderRadius: 10, border: "1px solid var(--line)", background: "#fff", display: "grid", placeItems: "center", overflow: "hidden" }}>{x.logo_url ? <img src={x.logo_url} alt="Logo" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /> : <span style={{ fontSize: 12, color: "#8a909c" }}>Sin logo</span>}</div>
              <label style={{ ...C.btnSm, cursor: "pointer" }}><Icon n="upload" s={15} />{subiendo ? "Subiendo…" : x.logo_url ? "Cambiar" : "Subir logo"}<input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={e => subirLogo(e.target.files?.[0])} style={{ display: "none" }} /></label>
              {x.logo_url && <button onClick={() => set("logo_url", null)} style={C.btnSm}>Quitar</button>}
            </div>
          </Field>
          <Field l="Color de marca"><div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {COLORES.map(co => <button key={co} onClick={() => set("color", co)} aria-label={`Color ${co}`} aria-pressed={x.color === co} style={{ width: 32, height: 32, borderRadius: 10, background: co, border: x.color === co ? "3px solid var(--text)" : "2px solid var(--line)", cursor: "pointer" }} />)}
            <input type="color" value={x.color} onChange={e => set("color", e.target.value)} aria-label="Otro color" style={{ width: 40, height: 34, border: "none", background: "transparent", cursor: "pointer" }} /></div></Field>
          <Field l="Plantilla por defecto"><div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
            {PLANTILLAS.map(p => <button key={p.k} onClick={() => set("plantilla", p.k)} aria-pressed={x.plantilla === p.k} style={{ textAlign: "left", padding: 8, borderRadius: 12, cursor: "pointer", border: `2px solid ${x.plantilla === p.k ? "var(--accent)" : "var(--line)"}`, background: "var(--surface2)", color: "var(--text)" }}><MiniPlantilla k={p.k} color={x.color} /><div style={{ fontWeight: 800, fontSize: 13, marginTop: 6 }}>{p.t}</div></button>)}
          </div></Field>
          <Field l="Pie de factura (opcional)" mb={0}><input value={x.pie || ""} maxLength={600} onChange={e => set("pie", e.target.value)} placeholder="Ej.: Inscrita en el Registro Mercantil de Albacete, tomo…" style={C.input} /></Field>
        </section>
        <section style={C.panel}>
          <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 12 }}>Para ir más rápido</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
            <Field l="IVA habitual"><select value={x.iva_def} onChange={e => set("iva_def", +e.target.value)} style={C.input}>{IVAS.map(v => <option key={v} value={v}>{v} %</option>)}</select></Field>
            <Field l="IRPF habitual"><select value={x.irpf_def} onChange={e => set("irpf_def", +e.target.value)} style={C.input}>{IRPFS.map(v => <option key={v} value={v}>{v ? `${v} %` : "Sin retención"}</option>)}</select></Field>
            <Field l="Vencimiento (días)"><input value={x.vencimiento_dias} inputMode="numeric" onChange={e => set("vencimiento_dias", Math.min(365, parseInt(e.target.value.replace(/\D/g, "") || "0", 10)))} style={C.input} /></Field>
            <Field l="Serie"><input value={x.serie} maxLength={4} onChange={e => set("serie", e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))} style={C.input} disabled={!!E} title={E ? "La serie no se cambia una vez empezada la numeración" : ""} /></Field>
          </div>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13.5, cursor: "pointer" }}><input type="checkbox" checked={!!x.qr} onChange={e => set("qr", e.target.checked)} style={{ marginTop: 3 }} /><span><b>QR tributario en el PDF</b><br /><span style={{ color: "var(--muted)" }}>Déjalo desactivado de momento: el QR lleva a la web de la AEAT para comprobar la factura, pero esta app todavía no envía las facturas a Hacienda, así que no la encontraría. Consúltalo con tu gestoría. Cada factura lleva igualmente su huella encadenada a la anterior.</span></span></label>
        </section>
        <button onClick={() => onGuardar({ ...x, nif: String(x.nif || "").toUpperCase().replace(/[^A-Z0-9]/g, "") })} disabled={busy || !listo} style={{ ...C.btnPrimary, padding: "14px 18px", fontSize: 16, opacity: listo ? 1 : .45 }}>{E ? "Guardar cambios" : "Guardar y empezar a facturar"}</button>
      </div>
    </div>);
}

// ===================== CRM · IMPRENTA DE TALONARIOS CON QR =====================
// Tres pantallas, todas dentro de <Sheet>:
//  · DisenoEntrada: el diseño de la entrada del evento (15 × 10 cm). O lo sube el diseñador (PDF o imagen hecha sobre la
//    plantilla) y encima solo se pone el QR, o la plataforma lo monta con el flyer y los datos del evento.
//  · GenerarTandas: entradas con QR para varios puntos de venta de una vez (p. ej. 15 puntos × 100).
//  · DescargarImprenta: un PDF por punto (con hoja separadora) y una hoja de control, todo en un ZIP para la imprenta;
//    o solo los puntos que elijas, o un rango concreto para reimprimir.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabase";
import { webSubir } from "./crmdb";
import { reducirImagen } from "../imagenes";
import { money, C, Icon, Sheet, Field, Seg, MoneyInput, parseImporte } from "./ui";

const num = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const coma = (v) => (v == null ? "" : String(v).replace(".", ","));
const errorTxt = (e) => String(e?.message || e || "No se ha podido hacer").replace(/^.*?ERROR:\s*/, "");
const MOTIVO_TANDA = { aforo: "se pasaría del aforo de la sala (Gestionar evento › paso 3)", punto: "uno de los puntos de venta ya no existe", cantidad: "la cantidad tiene que ir de 1 a 2.000", precio: "revisa el precio", sin_web: "activa antes la venta online del evento (puede quedarse en borrador)", evento: "evento no válido", sesion: "vuelve a entrar" };

// ---------- Utilidades del navegador ----------
const descargar = (bytes, nombre, tipo = "application/pdf") => {
  const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
  const a = document.createElement("a"); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
};
const bytesDe = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error("No se ha podido descargar el diseño"); return new Uint8Array(await r.arrayBuffer()); };
// Imagen (flyer) → JPG sin transparencias, con un tamaño razonable para imprimir
async function aJpg(url, max = 2400) {
  const img = await new Promise((ok, mal) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = () => mal(new Error("No se ha podido cargar el flyer")); i.src = url; });
  const e = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * e); c.height = Math.round(img.naturalHeight * e);
  const g = c.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  const b = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.92));
  return { tipo: "jpg", bytes: new Uint8Array(await b.arrayBuffer()) };
}
async function medidasImagen(file) {
  const url = URL.createObjectURL(file);
  try { return await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok({ anchoPx: i.naturalWidth, altoPx: i.naturalHeight }); i.onerror = () => mal(new Error("No se ha podido leer la imagen")); i.src = url; }); }
  finally { URL.revokeObjectURL(url); }
}
async function renderPagina(bytes, pagina = 1, ancho = 900, tipo = "image/jpeg") {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const w = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = w.default;
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const p = await doc.getPage(pagina); const v1 = p.getViewport({ scale: 1 }); const vp = p.getViewport({ scale: ancho / v1.width });
  const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
  await p.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
  return c.toDataURL(tipo, 0.85);
}

// ¿Hay textos o dibujos en las zonas reservadas (QR y número)? Mira los bordes nítidos (las letras los tienen;
// un fondo liso o un degradado suave, no). Devuelve, por zona, la proporción de píxeles con borde.
export async function lienzoDiseno(file, esPdf, sangrado) {
  const anchoMm = sangrado ? 156 : 150, pxmm = 12;
  const c = document.createElement("canvas"); c.width = Math.round(anchoMm * pxmm); c.height = Math.round((sangrado ? 106 : 100) * pxmm);
  const g = c.getContext("2d", { willReadFrequently: true }); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  if (esPdf) {
    const url = await renderPagina(new Uint8Array(await file.arrayBuffer()), 1, c.width, "image/png");
    const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = url; });
    g.drawImage(img, 0, 0, c.width, c.height);
  } else {
    const url = URL.createObjectURL(file);
    try { const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = url; }); g.drawImage(img, 0, 0, c.width, c.height); }
    finally { URL.revokeObjectURL(url); }
  }
  return { c, g, pxmm, off: sangrado ? 3 : 0 };
}
export function ocupacionZona({ g, pxmm, off }, z, margen = 1.5) {
  const x = Math.max(0, Math.round((off + z.x - margen) * pxmm)), y = Math.max(0, Math.round((off + z.y - margen) * pxmm));
  const w = Math.round((z.ancho + 2 * margen) * pxmm), h = Math.round((z.alto + 2 * margen) * pxmm);
  const d = g.getImageData(x, y, w, h).data, L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  let bordes = 0;
  for (let yy = 0; yy < h - 1; yy++) for (let xx = 0; xx < w - 1; xx++) { const i = yy * w + xx; if (Math.abs(L[i + 1] - L[i]) + Math.abs(L[i + w] - L[i]) > 48) bordes++; }
  return bordes / (w * h);
}

let fuentesCache = null;
async function motor() {
  const I = await import("./imprenta.js");
  if (!fuentesCache) fuentesCache = await I.cargarFuentesNavegador();
  return { I, fuentes: fuentesCache };
}
// Ficha web del evento (flyer y color de marca)
async function fichaWeb(evId) {
  const { data } = await supabase.from("ticket_web_eventos").select("flyer_url, diseno").eq("evento_id", evId).maybeSingle();
  return data || {};
}
// Diseño listo para el motor (descarga el archivo o el flyer una sola vez)
async function prepararDiseno(d, ficha) {
  if (!d || d.modo === "auto") {
    const ajustes = { color: ficha?.diseno?.color || "#ff5a3c", ...(d?.ajustes || {}) };
    return { modo: "auto", numero: true, ajustes, flyer: ficha?.flyer_url ? await aJpg(ficha.flyer_url) : null };
  }
  const bytes = await bytesDe(d.archivo_url);
  const mime = /\.png(\?|$)/i.test(d.archivo_url) ? "image/png" : "image/jpeg";
  return { ...d, bytes, mime, sangrado: d.ajustes?.sangrado !== false };
}
const ENTRADA_MUESTRA = { numero: 101, qr_hex: "03" + "5a".repeat(32), estado: "valida" };

/* =================== Diseño de la entrada =================== */
export function DisenoEntrada({ ev, flash, onClose, onCambio }) {
  const [lista, setLista] = useState(null);
  const [ficha, setFicha] = useState({});
  const [abierto, setAbierto] = useState(null);   // diseño en vista previa / edición
  const [busy, setBusy] = useState("");
  const fileRef = useRef(null), flyerRef = useRef(null);
  const cargar = async () => {
    const [{ data }, f] = await Promise.all([supabase.from("ticket_pv_disenos").select("*").eq("evento_id", ev.id).order("creado_en"), fichaWeb(ev.id)]);
    setLista(data || []); setFicha(f);
  };
  useEffect(() => { cargar(); }, [ev.id]);

  const plantilla = async () => {
    setBusy("plantilla");
    try { const { I, fuentes } = await motor(); descargar(await I.pdfPlantilla({ fuentes }), "plantilla_entrada_TIXFAST_15x10.pdf"); flash("Plantilla descargada: pásasela al diseñador"); }
    catch (e) { flash(errorTxt(e), "warn"); }
    setBusy("");
  };
  const subirPropio = async (file) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return flash("El archivo pasa de 10 MB. Expórtalo más ligero (PDF o JPG a 300 ppp).", "warn");
    const esPdf = /pdf/i.test(file.type) || /\.pdf$/i.test(file.name);
    if (!esPdf && !/^image\/(jpeg|png)$/.test(file.type)) return flash("Sube el diseño en PDF, JPG o PNG", "warn");
    setBusy("subir");
    try {
      const { I } = await motor();
      let rev;
      if (esPdf) {
        const { PDFDocument } = await import("pdf-lib");
        const d = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()), { ignoreEncryption: true });
        const { width, height } = d.getPage(0).getSize();
        rev = I.revisarDiseno({ tipo: "pdf", anchoMm: width / 72 * 25.4, altoMm: height / 72 * 25.4 });
        if (rev.ok && d.getPageCount() > 1) rev.avisos.push("El PDF tiene varias páginas: se usa solo la primera.");
      } else rev = I.revisarDiseno({ tipo: "imagen", ...(await medidasImagen(file)) });
      if (!rev.ok) { setBusy(""); return flash(rev.error, "warn"); }
      // El QR no puede tapar ningún texto: la zona del QR tiene que estar libre (la del número de la matriz, si se pone)
      const lz = await lienzoDiseno(file, esPdf, rev.sangrado);
      const [zQR, zNum] = I.zonasReservadas(true);
      const oQR = ocupacionZona(lz, zQR), oNum = ocupacionZona(lz, zNum);
      if (oQR > 0.0015) { setBusy(""); return flash("El diseño tiene texto o dibujo donde va el QR (el recuadro rojo de arriba a la derecha de la plantilla). El QR lo taparía: déjalo libre y vuelve a subirlo.", "warn"); }
      if (oQR > 0.0003) rev.avisos.push("Hay algo de dibujo cerca del hueco del QR. Revisa en la vista previa que el QR no tapa nada importante.");
      const numeroLibre = oNum <= 0.0015;
      if (!numeroLibre) rev.avisos.push("La zona del número de la matriz tiene diseño: el número de entrada solo saldrá debajo del QR, no en la matriz.");
      const url = await webSubir(ev.id, "entrada-diseno", file);
      const { data, error } = await supabase.from("ticket_pv_disenos").insert({ evento_id: ev.id, nombre: (file.name || "Diseño").replace(/\.[^.]+$/, "").slice(0, 80) || "Diseño", modo: "propio", archivo_url: url, archivo_tipo: esPdf ? "pdf" : "imagen", ajustes: { sangrado: rev.sangrado, avisos: rev.avisos, numeroMatriz: numeroLibre } }).select("*").single();
      if (error) throw error;
      await cargar(); setAbierto(data); onCambio && onCambio();
      flash(rev.avisos.length ? "Diseño subido, revisa los avisos" : "Diseño subido");
    } catch (e) { flash(errorTxt(e), "warn"); }
    setBusy("");
  };
  const subirFlyer = async (file) => {
    if (!file) return;
    setBusy("flyer");
    try {
      const url = await webSubir(ev.id, "flyer", await reducirImagen(file, 2400, "image/jpeg"));
      const { data: ya } = await supabase.from("ticket_web_eventos").select("evento_id").eq("evento_id", ev.id).maybeSingle();
      if (!ya) throw new Error("Activa antes la venta online del evento (puede quedarse en borrador) para guardar el flyer");
      const { error } = await supabase.from("ticket_web_eventos").update({ flyer_url: url }).eq("evento_id", ev.id);
      if (error) throw error;
      await cargar(); flash("Flyer guardado (también se usa en la web del evento)");
    } catch (e) { flash(errorTxt(e), "warn"); }
    setBusy("");
  };
  const crearAuto = async () => {
    setBusy("auto");
    const { data, error } = await supabase.from("ticket_pv_disenos").insert({ evento_id: ev.id, nombre: "Automático con el flyer", modo: "auto", ajustes: { color: ficha?.diseno?.color || "#ff5a3c", encuadre: "centro" } }).select("*").single();
    setBusy("");
    if (error) return flash(errorTxt(error), "warn");
    await cargar(); setAbierto(data); onCambio && onCambio();
  };

  if (abierto) return <VistaDiseno ev={ev} d={abierto} ficha={ficha} flash={flash} onClose={() => setAbierto(null)} onCambio={async () => { setAbierto(null); await cargar(); onCambio && onCambio(); }} />;
  return (
    <Sheet title="Diseño de la entrada" onClose={onClose}>
      <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.5, marginBottom: 14 }}>
        Entradas de <b style={{ color: "var(--text)" }}>15 × 10 cm</b> en horizontal: la <b style={{ color: "var(--text)" }}>matriz</b> a la izquierda (se corta por el perforado) y el <b style={{ color: "var(--text)" }}>QR arriba a la derecha</b>, siempre en el mismo sitio.
      </div>
      {lista === null ? <div style={{ color: "var(--muted)" }}>Cargando…</div> : lista.map((d) => (
        <button key={d.id} onClick={() => setAbierto(d)} style={{ ...C.listBtn, width: "100%", borderTop: "1px solid var(--line)", borderRadius: 0, padding: "10px 4px", minHeight: 52 }}>
          <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
            <span style={{ display: "block", fontWeight: 700 }}>{d.nombre}</span>
            <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)" }}>{d.modo === "auto" ? "La plataforma monta el flyer con los datos del evento" : `Del diseñador (${d.archivo_tipo === "pdf" ? "PDF" : "imagen"}): encima solo el QR`}</span>
          </span>
          <Icon n="eye" s={16} c="var(--muted)" />
        </button>))}
      {lista && lista.length === 0 && <div style={C.empty}>Aún no hay ningún diseño. Elige una de las dos formas:</div>}

      <div style={{ ...C.card, marginTop: 14 }}>
        <div style={{ fontWeight: 800, marginBottom: 4 }}>1 · Diseño del diseñador</div>
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.45, marginBottom: 10 }}>Descarga la plantilla, el diseñador diseña encima dejando libres los huecos del QR y del número, y lo subes en PDF (mejor) o JPG/PNG a 300 ppp. Encima de su diseño solo ponemos el QR.</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={plantilla} disabled={!!busy} style={{ ...C.btnGhost, minHeight: 44 }}><Icon n="download" s={16} />{busy === "plantilla" ? "Creando…" : "Descargar plantilla"}</button>
          <button onClick={() => fileRef.current?.click()} disabled={!!busy} style={{ ...C.btnPrimary, minHeight: 44 }}><Icon n="plus" s={16} />{busy === "subir" ? "Revisando…" : "Subir diseño"}</button>
          <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png" hidden onChange={(e) => { subirPropio(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
      </div>
      <div style={{ ...C.card, marginTop: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 4 }}>2 · Diseño automático con el flyer</div>
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.45, marginBottom: 10 }}>La plataforma coloca el flyer y pone el nombre del evento, la fecha, el lugar, el tipo de entrada (VIP, general…) y lo que incluye (copa…).</div>
        {ficha.flyer_url ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <img src={ficha.flyer_url} alt="Flyer" style={{ width: 44, height: 55, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }} />
            <button onClick={crearAuto} disabled={!!busy} style={{ ...C.btnPrimary, minHeight: 44 }}>{busy === "auto" ? "Creando…" : "Crear diseño automático"}</button>
            <button onClick={() => flyerRef.current?.click()} disabled={!!busy} style={{ ...C.btnGhost, minHeight: 44 }}>Cambiar flyer</button>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 13, color: "var(--amber)", fontWeight: 700, marginBottom: 8 }}>Este evento aún no tiene flyer.</div>
            <button onClick={() => flyerRef.current?.click()} disabled={!!busy} style={{ ...C.btnPrimary, minHeight: 44 }}><Icon n="plus" s={16} />{busy === "flyer" ? "Subiendo…" : "Subir el flyer"}</button>
          </div>
        )}
        <input ref={flyerRef} type="file" accept="image/jpeg,image/png" hidden onChange={(e) => { subirFlyer(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
    </Sheet>
  );
}

function VistaDiseno({ ev, d, ficha, flash, onClose, onCambio }) {
  const [img, setImg] = useState("");
  const [err, setErr] = useState("");
  const [f, setF] = useState({ nombre: d.nombre, numero: d.numero !== false, color: d.ajustes?.color || ficha?.diseno?.color || "#ff5a3c", encuadre: d.ajustes?.encuadre || "centro", tipo: "General", incluye: "" });
  const [busy, setBusy] = useState("");
  const [borrar, setBorrar] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const actual = { ...d, numero: f.numero, ajustes: { ...(d.ajustes || {}), color: f.color, encuadre: f.encuadre } };
  const pintar = async () => {
    setErr(""); setImg("");
    try {
      const { I, fuentes } = await motor();
      const dis = await prepararDiseno(actual, ficha);
      const lote = { nombre: f.tipo || "Entrada", incluye: f.incluye, desde: 101, hasta: 150 };
      const r = await I.pdfLoteImprenta({ ev, punto: { nombre: "Punto de venta" }, lote, entradas: [ENTRADA_MUESTRA], diseno: dis, fuentes, conSeparador: false });
      setImg(await renderPagina(r.bytes, 1, 1000));
    } catch (e) { setErr(errorTxt(e)); }
  };
  useEffect(() => { pintar(); }, [f.numero, f.color, f.encuadre]);
  const guardar = async () => {
    setBusy("guardar");
    const { error } = await supabase.from("ticket_pv_disenos").update({ nombre: f.nombre.trim().slice(0, 80) || "Diseño", numero: f.numero, ajustes: actual.ajustes, actualizado_en: new Date().toISOString() }).eq("id", d.id);
    setBusy("");
    if (error) return flash(errorTxt(error), "warn");
    flash("Diseño guardado"); onCambio();
  };
  const quitar = async () => {
    setBusy("borrar"); const { error } = await supabase.from("ticket_pv_disenos").delete().eq("id", d.id); setBusy("");
    if (error) return flash(errorTxt(error), "warn");
    flash("Diseño borrado"); onCambio();
  };
  const avisos = d.ajustes?.avisos || [];
  return (
    <Sheet title="Vista previa del diseño" onClose={onClose} footer={
      <div style={{ display: "flex", gap: 8 }}>
        {borrar ? <><button onClick={quitar} disabled={!!busy} style={{ ...C.btnGhost, color: "var(--red)", borderColor: "var(--red)" }}>Sí, borrar</button><button onClick={() => setBorrar(false)} style={C.btnGhost}>No</button></>
          : <button onClick={() => setBorrar(true)} style={{ ...C.btnGhost, color: "var(--red)", padding: "0 14px" }} aria-label="Borrar diseño"><Icon n="trash" s={18} /></button>}
        <button onClick={guardar} disabled={!!busy} style={{ ...C.btnPrimary, flex: 1, minHeight: 52 }}>{busy === "guardar" ? "Guardando…" : "Guardar"}</button>
      </div>}>
      <div style={{ background: "#d9dbe0", borderRadius: 12, padding: 6, marginBottom: 8, minHeight: 120, display: "grid", placeItems: "center" }}>
        {img ? <img src={img} alt="Vista previa de la entrada" style={{ width: "100%", height: "auto", display: "block", borderRadius: 6 }} /> : <span style={{ color: "#444", fontSize: 13 }}>{err || "Preparando la vista previa…"}</span>}
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>Así sale cada entrada, con las marcas de corte alrededor. El QR y el número de la muestra son de ejemplo.</div>
      {avisos.map((a, i) => <div key={i} style={{ fontSize: 13, color: "var(--amber)", fontWeight: 700, marginBottom: 8 }}>{a}</div>)}
      <Field l="Nombre del diseño"><input value={f.nombre} maxLength={80} onChange={(e) => set("nombre", e.target.value)} style={C.input} /></Field>
      {d.modo === "auto" ? <>
        <Field l="Encuadre del flyer"><Seg full valor={f.encuadre} onChange={(v) => set("encuadre", v)} opciones={[{ k: "arriba", t: "Arriba" }, { k: "centro", t: "Centro" }, { k: "abajo", t: "Abajo" }]} /></Field>
        <Field l="Color de la etiqueta del tipo de entrada">
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input type="color" value={f.color} onChange={(e) => set("color", e.target.value)} style={{ width: 52, height: 44, border: "1px solid var(--line)", borderRadius: 10, background: "var(--surface2)", padding: 4 }} />
            <span style={{ fontSize: 13, color: "var(--muted)" }}>Por defecto, el de la web del evento</span>
          </div>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field l="Muestra: tipo"><input value={f.tipo} onChange={(e) => set("tipo", e.target.value)} onBlur={pintar} style={C.input} /></Field>
          <Field l="Muestra: incluye"><input value={f.incluye} placeholder="1 copa" onChange={(e) => set("incluye", e.target.value)} onBlur={pintar} style={C.input} /></Field>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: -6 }}>El tipo y lo que incluye se ponen al generar cada tanda; aquí son solo para ver cómo queda.</div>
      </> : (
        <label style={C.toggleRow}><span>Poner también el número de entrada<span style={{ display: "block", fontSize: 12.5, color: "var(--muted)", fontWeight: 500 }}>Bajo el QR y en la matriz (si esa zona del diseño está libre). Sirve para controlar las ventas y devoluciones de cada punto.</span></span><input type="checkbox" checked={f.numero} onChange={(e) => set("numero", e.target.checked)} style={{ width: 22, height: 22, accentColor: "var(--accent)", flexShrink: 0 }} /></label>
      )}
    </Sheet>
  );
}

/* =================== Generar tandas para varios puntos =================== */
export function GenerarTandas({ ev, puntos, disenos, flash, onClose, onHecho }) {
  const activos = puntos.filter((p) => p.activo);
  const [filas, setFilas] = useState(() => Object.fromEntries(activos.map((p) => [p.id, { si: false, cantidad: "100" }])));
  const [tipo, setTipo] = useState("General");
  const [incluye, setIncluye] = useState("");
  const [precio, setPrecio] = useState("");
  const [diseno, setDiseno] = useState(disenos[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const elegidas = activos.filter((p) => filas[p.id]?.si && parseInt(filas[p.id].cantidad, 10) > 0);
  const total = elegidas.reduce((s, p) => s + parseInt(filas[p.id].cantidad, 10), 0);
  const fuera = elegidas.some((p) => parseInt(filas[p.id].cantidad, 10) > 2000);
  const ok = elegidas.length > 0 && total <= 10000 && !fuera && precio !== "" && tipo.trim();
  const set = (id, k, v) => setFilas((x) => ({ ...x, [id]: { ...x[id], [k]: v } }));
  const todos = (si) => setFilas((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, { ...v, si }])));
  const crear = async () => {
    if (!ok || busy) return;
    setBusy(true);
    const tandas = elegidas.map((p) => ({ pv: p.id, cantidad: parseInt(filas[p.id].cantidad, 10), nombre: tipo.trim(), precio: parseImporte(precio), comision_tipo: p.comision_tipo, comision_valor: num(p.comision_valor), incluye: incluye.trim() }));
    const { data, error } = await supabase.rpc("pv_crear_tandas", { p_evento: ev.id, p_tandas: tandas, p_diseno: diseno || null });
    setBusy(false);
    if (error) { const m = /TANDA:(\d+):(\w+)/.exec(error.message || ""); return flash(m ? `No se ha creado ninguna: en «${elegidas[m[1] - 1]?.nombre}», ${MOTIVO_TANDA[m[2]] || m[2]}` : errorTxt(error), "warn"); }
    if (!data?.ok) return flash({ total: "Como mucho 10.000 entradas por vez", vacio: "Elige al menos un punto", diseno: "Ese diseño no es de este evento" }[data?.motivo] || "No se ha podido crear", "warn");
    flash(`${data.total} entradas creadas para ${data.lotes.length} punto${data.lotes.length === 1 ? "" : "s"}`);
    onHecho(data.lotes.map((l) => l.lote));
  };
  return (
    <Sheet title="Generar tandas con QR" onClose={onClose} footer={
      <button onClick={crear} disabled={!ok || busy} style={{ ...C.btnPrimary, width: "100%", minHeight: 52, opacity: ok && !busy ? 1 : .5 }}>
        {busy ? "Creando entradas…" : !elegidas.length ? "Elige los puntos de venta" : fuera ? "Máximo 2.000 por punto" : total > 10000 ? "Máximo 10.000 por vez" : precio === "" ? "Escribe el precio" : `Crear ${total} entradas para ${elegidas.length} punto${elegidas.length === 1 ? "" : "s"}`}
      </button>}>
      <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.45, marginBottom: 12 }}>Cada punto recibe su numeración seguida. Si algo falla no se crea ninguna, así nunca quedan tandas a medias.</div>
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 10 }}>
        <Field l="Tipo de entrada"><input value={tipo} maxLength={80} placeholder="General, VIP…" onChange={(e) => setTipo(e.target.value)} style={C.input} /></Field>
        <Field l="Precio (no se imprime)"><MoneyInput value={precio} onChange={setPrecio} /></Field>
      </div>
      <Field l="Incluye (sale en la entrada, opcional)"><input value={incluye} maxLength={80} placeholder="Ej. 1 copa" onChange={(e) => setIncluye(e.target.value)} style={C.input} /></Field>
      <Field l="Diseño">
        <select value={diseno} onChange={(e) => setDiseno(e.target.value)} style={C.input}>
          {disenos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          <option value="">Automático con el flyer (sin guardar)</option>
        </select>
      </Field>
      <Field l={`Puntos de venta (${elegidas.length} elegidos · ${total} entradas)`}>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button type="button" onClick={() => todos(true)} style={{ ...C.btnGhost, minHeight: 44 }}>Todos</button>
          <button type="button" onClick={() => todos(false)} style={{ ...C.btnGhost, minHeight: 44 }}>Ninguno</button>
        </div>
        {activos.length === 0 && <div style={{ color: "var(--muted)", fontSize: 14 }}>No tienes puntos de venta activos.</div>}
        {activos.map((p) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, borderTop: "1px solid var(--line)", padding: "6px 0", minHeight: 52 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, cursor: "pointer", minHeight: 44 }}>
              <input type="checkbox" checked={!!filas[p.id]?.si} onChange={(e) => set(p.id, "si", e.target.checked)} style={{ width: 22, height: 22, accentColor: "var(--accent)", flexShrink: 0 }} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nombre}</span>
                <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>comisión {p.comision_tipo === "pct" ? `${coma(p.comision_valor)} %` : `${money(p.comision_valor)}/entrada`}</span>
              </span>
            </label>
            <input inputMode="numeric" aria-label={`Entradas para ${p.nombre}`} value={filas[p.id]?.cantidad || ""} disabled={!filas[p.id]?.si} onChange={(e) => set(p.id, "cantidad", e.target.value.replace(/\D/g, "").slice(0, 4))} style={{ ...C.input, width: 84, textAlign: "right", opacity: filas[p.id]?.si ? 1 : .5 }} />
          </div>
        ))}
      </Field>
    </Sheet>
  );
}

/* =================== Descargar para imprenta =================== */
export function DescargarImprenta({ ev, puntos, lotes, disenos, inicial, flash, onClose }) {
  const conQR = useMemo(() => lotes.filter((l) => l.modo === "qr" && l.pedido_id).sort((a, b) => a.desde - b.desde), [lotes]);
  const [sel, setSel] = useState(() => new Set(inicial?.length ? inicial : conQR.map((l) => l.id)));
  const [rango, setRango] = useState({ desde: "", hasta: "" });
  const [forzar, setForzar] = useState("");    // "" = el diseño de cada entrega
  const [prog, setProg] = useState(null);      // { hecho, total, texto }
  const punto = (id) => puntos.find((p) => p.id === id) || { nombre: "Punto de venta" };
  const elegidos = conQR.filter((l) => sel.has(l.id));
  const uno = elegidos.length === 1 ? elegidos[0] : null;
  const rd = parseInt(rango.desde, 10), rh = parseInt(rango.hasta, 10);
  const conRango = uno && rango.desde !== "" && rango.hasta !== "";
  const rangoMal = conRango && (!(rd >= uno.desde && rh <= uno.hasta && rh >= rd));
  const total = conRango && !rangoMal ? rh - rd + 1 : elegidos.reduce((s, l) => s + (l.hasta - l.desde + 1), 0);
  const toggle = (id) => setSel((x) => { const n = new Set(x); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const generar = async () => {
    if (!elegidos.length || rangoMal || prog) return;
    setProg({ hecho: 0, total, texto: "Preparando…" });
    try {
      const { I, fuentes } = await motor();
      const ficha = await fichaWeb(ev.id);
      const cacheD = new Map();
      const disenoDe = async (l) => {
        const id = forzar || l.diseno_id || disenos[0]?.id || "";
        if (!cacheD.has(id)) cacheD.set(id, await prepararDiseno(disenos.find((d) => d.id === id) || null, ficha));
        return cacheD.get(id);
      };
      const archivos = {}, filas = [];
      let hecho = 0, orden = 0;
      for (const l of elegidos) {
        orden++;
        setProg({ hecho, total, texto: `${punto(l.pv_id).nombre}: leyendo entradas…` });
        const todas = [];
        for (let desde = 0; ; desde += 1000) {
          const { data, error } = await supabase.from("ticket_web_entradas").select("numero, qr_hex, estado, prueba").eq("pedido_id", l.pedido_id).order("numero").range(desde, desde + 999);
          if (error) throw error;
          todas.push(...(data || [])); if (!data || data.length < 1000) break;
        }
        let lista = todas.filter((x) => x.estado === "valida");
        if (conRango) lista = lista.filter((x) => x.numero >= rd && x.numero <= rh);
        if (!lista.length) continue;
        const loteImp = conRango ? { ...l, desde: rd, hasta: rh } : l;
        const dis = await disenoDe(l);
        const base = hecho;
        const r = await I.pdfLoteImprenta({ ev, punto: punto(l.pv_id), lote: { ...loteImp, relleno: l.hasta }, entradas: lista, diseno: dis, fuentes,
          onProgreso: (n) => setProg({ hecho: base + n, total, texto: `${punto(l.pv_id).nombre}: ${n} de ${lista.length}` }) });
        const nombre = I.nombreArchivo(orden, punto(l.pv_id), loteImp);
        archivos[nombre] = r.bytes; hecho += lista.length;
        filas.push({ punto: punto(l.pv_id).nombre, tipo: l.nombre + (l.incluye ? ` (${l.incluye})` : ""), desde: lista[0].numero, hasta: lista[lista.length - 1].numero, cantidad: lista.length, archivo: nombre });
        const anuladas = todas.length - todas.filter((x) => x.estado === "valida").length;
        if (anuladas && !conRango) filas[filas.length - 1].tipo += ` · ${anuladas} anuladas no incluidas`;
      }
      if (!filas.length) { setProg(null); return flash("No hay entradas válidas para imprimir en lo elegido", "warn"); }
      setProg({ hecho, total, texto: "Preparando la descarga…" });
      const n = Object.keys(archivos);
      if (n.length === 1) descargar(archivos[n[0]], n[0]);
      else {
        const control = await I.pdfControl({ ev, filas, fuentes, diseno: cacheD.values().next().value });
        const { zipSync } = await import("fflate");
        const zip = zipSync({ "00_hoja_de_control.pdf": [control, { level: 0 }], ...Object.fromEntries(n.map((k) => [k, [archivos[k], { level: 0 }]])) });
        descargar(zip, `imprenta_${I.limpio(ev.name || "evento")}_${hecho}_entradas.zip`, "application/zip");
      }
      flash(`Listo: ${hecho} entradas en ${filas.length} PDF${filas.length === 1 ? "" : "s"}`);
      setProg(null);
    } catch (e) { setProg(null); flash(errorTxt(e), "warn"); }
  };

  return (
    <Sheet title="Descargar para imprenta" onClose={prog ? () => {} : onClose} footer={
      prog ? (
        <div>
          <div style={{ height: 10, borderRadius: 6, background: "var(--surface2)", overflow: "hidden" }}><div style={{ width: `${Math.round(100 * prog.hecho / Math.max(prog.total, 1))}%`, height: "100%", background: "var(--accent)", transition: "width .2s" }} /></div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>{prog.texto} · no cierres esta ventana</div>
        </div>
      ) : (
        <button onClick={generar} disabled={!elegidos.length || rangoMal} style={{ ...C.btnPrimary, width: "100%", minHeight: 52, opacity: elegidos.length && !rangoMal ? 1 : .5 }}>
          <Icon n="download" s={16} />{!elegidos.length ? "Elige qué imprimir" : rangoMal ? "Revisa el rango" : elegidos.length === 1 ? `Descargar PDF (${total} entradas)` : `Descargar ZIP · ${elegidos.length} PDF · ${total} entradas`}
        </button>
      )}>
      <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.45, marginBottom: 12 }}>
        Un PDF por punto de venta, una entrada por página (15 × 10 cm con 3 mm de sangrado y marcas de corte) y una hoja separadora al principio. Si eliges varios, van en un ZIP con la hoja de control para la imprenta. Las entradas devueltas o anuladas no se imprimen.
      </div>
      {conQR.length === 0 ? <div style={C.empty}>Aún no hay entregas con QR en este evento. Créalas con «Generar tandas».</div> : <>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button type="button" onClick={() => setSel(new Set(conQR.map((l) => l.id)))} style={{ ...C.btnGhost, minHeight: 44 }}>Todas</button>
          <button type="button" onClick={() => setSel(new Set())} style={{ ...C.btnGhost, minHeight: 44 }}>Ninguna</button>
        </div>
        {conQR.map((l) => (
          <label key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, borderTop: "1px solid var(--line)", padding: "8px 0", minHeight: 52, cursor: "pointer" }}>
            <input type="checkbox" checked={sel.has(l.id)} onChange={() => toggle(l.id)} style={{ width: 22, height: 22, accentColor: "var(--accent)", flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{punto(l.pv_id).nombre}</span>
              <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)" }}>{l.nombre}{l.incluye ? ` · incluye ${l.incluye}` : ""} · nº {l.desde}–{l.hasta} ({l.hasta - l.desde + 1})</span>
            </span>
          </label>
        ))}
        {uno && <Field l="Solo un rango (para reimprimir, opcional)" mb={12}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
            <input inputMode="numeric" placeholder={`Desde ${uno.desde}`} value={rango.desde} onChange={(e) => setRango((r) => ({ ...r, desde: e.target.value.replace(/\D/g, "").slice(0, 7) }))} style={C.input} />
            <input inputMode="numeric" placeholder={`Hasta ${uno.hasta}`} value={rango.hasta} onChange={(e) => setRango((r) => ({ ...r, hasta: e.target.value.replace(/\D/g, "").slice(0, 7) }))} style={C.input} />
          </div>
          {rangoMal && <div style={{ fontSize: 12.5, color: "var(--red)", marginTop: 4 }}>El rango tiene que estar entre {uno.desde} y {uno.hasta}.</div>}
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>Al reimprimir salen exactamente los mismos QR: no se crean entradas nuevas.</div>
        </Field>}
        <Field l="Diseño">
          <select value={forzar} onChange={(e) => setForzar(e.target.value)} style={C.input}>
            <option value="">El de cada entrega</option>
            {disenos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          </select>
        </Field>
      </>}
    </Sheet>
  );
}

// ===================== ORGANIZACIONES · microsite de la marca =====================
// Cada organización (la discoteca, la marca de fiestas…) tiene su microsite /o/<enlace> con todos sus
// eventos, fotos y su identidad. Aquí se personaliza al 100 %, con la página real en pequeño al lado.
import React, { useEffect, useRef, useState } from "react";
import * as crm from "./crmdb";
import { useIsMobile, C, Icon, Tile, Badge, Seg, Sheet, Field } from "./ui";
import { Microsite, ESTILOS_ORG, SECCIONES_ORG, disenoOrg, REDES_ORG, IcoRed } from "../web/Microsite.jsx";

const PASOS = [
  { k: "identidad", t: "Identidad", i: "building", sub: "Nombre, logo, frase y quiénes sois." },
  { k: "fotos", t: "Fotos", i: "upload", sub: "La portada a pantalla completa y la galería. Lo que hace que entren ganas de ir." },
  { k: "estilo", t: "Estilo", i: "sparkle", sub: "Plantilla, colores, letra y efectos." },
  { k: "contenido", t: "Contenido", i: "file", sub: "Qué secciones salen y en qué orden, reservados VIP, ubicación, preguntas y redes." },
  { k: "eventos", t: "Eventos", i: "ticket", sub: "Qué eventos salen en el microsite y cuál va destacado." },
  { k: "publicar", t: "Publicar", i: "globe", sub: "Revisa y ponlo en marcha. Compártelo en la bio de Instagram." },
];
const COLORES = ["#ff5a3c", "#a855f7", "#3b82f6", "#22d3a6", "#ffb400", "#ec4899", "#f97316", "#e11d48", "#c8a24a", "#eceef5"];
const LETRAS = [{ k: "inter", t: "Moderna" }, { k: "serif", t: "Elegante" }, { k: "mono", t: "Techno" }];
const ayuda = { fontSize: 12, color: "var(--muted)", marginTop: 4 };
const urlOrg = (slug) => `${window.location.origin}/o/${slug}`;

async function reducirImagen(file, max, tipo) {
  try {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 700 * 1024) return file;
    const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise(r => cv.toBlob(r, tipo, 0.86));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + (tipo === "image/png" ? ".png" : ".jpg"), { type: tipo });
  } catch { return file; }
}
function useAncho() {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  useEffect(() => { const f = () => setW(window.innerWidth); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return w;
}

/* ===================== Lista ===================== */
export function Organizaciones({ flash }) {
  const isMobile = useIsMobile();
  const [lista, setLista] = useState(null);
  const [sel, setSel] = useState(null);
  const [nueva, setNueva] = useState(false);
  const [nombre, setNombre] = useState("");
  const [busy, setBusy] = useState(false);
  const cargar = () => crm.orgListar().then(l => { setLista(l); return l; }).catch(() => { setLista([]); flash("No se han podido cargar las organizaciones", "warn"); return []; });
  useEffect(() => { cargar().then(l => { if (l.length === 1) setSel(l[0].id); }); }, []);
  const o = lista?.find(x => x.id === sel);
  if (lista === null) return <div style={{ ...C.panel, color: "var(--muted)", textAlign: "center" }}>Cargando…</div>;
  if (o) return <EditorOrg key={o.id} org={o} flash={flash} isMobile={isMobile} onVolver={lista.length > 1 ? () => setSel(null) : null}
    onCambio={(patch) => setLista(l => l.map(x => x.id === o.id ? { ...x, ...patch } : x))}
    onBorrada={() => { setSel(null); cargar(); }} onNueva={() => setNueva(true)} />;
  return (<>
    {lista.length === 0 ? (
      <section style={{ ...C.hero, padding: isMobile ? 18 : 30, textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}><Tile n="globe" s={56} /></div>
        <div style={{ fontSize: isMobile ? 22 : 28, fontWeight: 900 }}>Tu carta de presentación online</div>
        <div style={{ color: "var(--muted)", fontSize: 14, maxWidth: 560, margin: "8px auto 18px" }}>Un microsite para tu discoteca o tu marca de fiestas: portada a pantalla completa, todos tus eventos a la venta, galería, reservados VIP y redes. Tus clientes compran entradas de varias fiestas a la vez con un solo formulario.</div>
        <button onClick={() => setNueva(true)} style={{ ...C.btnPrimary, minHeight: 50, padding: "0 26px", fontSize: 16 }}><Icon n="plus" s={18} w={2.4} />Crear mi organización</button>
      </section>
    ) : (
      <section style={C.panel}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1, fontWeight: 900, fontSize: 17 }}>Tus organizaciones</div>
          <button onClick={() => setNueva(true)} style={C.btnPrimary}><Icon n="plus" s={16} w={2.4} />Nueva</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3,minmax(0,1fr))", gap: 12 }}>
          {lista.map(x => { const d = disenoOrg(x.diseno); const foto = d.portada[0] || d.galeria[0]; return (
            <button key={x.id} onClick={() => setSel(x.id)} style={{ ...C.card, padding: 0, overflow: "hidden", textAlign: "left", cursor: "pointer", color: "var(--text)", border: "1px solid var(--line)" }}>
              <span style={{ display: "block", height: 120, background: foto ? `center/cover url("${foto}")` : `linear-gradient(135deg, ${d.color}, ${d.color2})` }} />
              <span style={{ display: "block", padding: 12 }}>
                <b style={{ display: "block", fontSize: 16 }}>{x.nombre}</b>
                <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>/o/{x.slug}</span>
                <span style={{ display: "flex", gap: 6, marginTop: 8 }}>{x.publicada ? <Badge c="var(--green)" solid>Publicada</Badge> : <Badge>Borrador</Badge>}</span>
              </span>
            </button>); })}
        </div>
      </section>
    )}
    {nueva && <Sheet title="Nueva organización" onClose={() => setNueva(false)}
      footer={<button disabled={busy || nombre.trim().length < 2} onClick={async () => {
        setBusy(true);
        try { const x = await crm.orgCrear(nombre); setNueva(false); setNombre(""); await cargar(); setSel(x.id); flash("Organización creada"); }
        catch (e) { flash(e.message || "No se ha podido crear", "warn"); } finally { setBusy(false); }
      }} style={{ ...C.btnPrimary, width: "100%", minHeight: 50, fontSize: 16, opacity: nombre.trim().length < 2 ? .5 : 1 }}><Icon n="check" s={17} w={2.4} />{busy ? "Creando…" : "Crear y personalizar"}</button>}>
      <Field l="Nombre"><input autoFocus style={{ ...C.input, fontWeight: 800, fontSize: 17 }} value={nombre} maxLength={80} onChange={e => setNombre(e.target.value)} placeholder="Ej. Odiseo Eventos, Sala Apolo…" /></Field>
      <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Su enlace será {window.location.host}/o/{crm.slugDe(nombre || "tu-marca")}. Se puede cambiar después.</div>
    </Sheet>}
  </>);
}

/* ===================== Editor ===================== */
function EditorOrg({ org, flash, isMobile, onVolver, onCambio, onBorrada, onNueva }) {
  const ancho = useAncho();
  const lateral = ancho >= 1080;
  const [o, setO] = useState(org);
  const [d, setDRaw] = useState(() => disenoOrg(org.diseno));
  const [estado, setEstado] = useState("");
  const [paso, setPasoRaw] = useState(0);
  const [pub, setPub] = useState(null);            // eventos y pasados tal como los ve el público
  const [evs, setEvs] = useState(null);            // eventos con venta online de la cuenta
  const [grande, setGrande] = useState(false);
  const [borrar, setBorrar] = useState(false);
  const arriba = useRef(null);
  const t = useRef(null), pend = useRef({});
  const guardar = (patch) => {
    pend.current = { ...pend.current, ...patch }; setEstado("guardando"); clearTimeout(t.current);
    t.current = setTimeout(() => { const p = pend.current; pend.current = {}; crm.orgGuardar(o.id, p).then(() => { setEstado("guardado"); onCambio(p); }).catch(() => setEstado("error")); }, 700);
  };
  useEffect(() => () => { clearTimeout(t.current); if (Object.keys(pend.current).length) crm.orgGuardar(o.id, pend.current).catch(() => {}); }, []);
  const set = (patch) => { setO(x => ({ ...x, ...patch })); guardar(patch); };
  const dRef = useRef(d); dRef.current = d;
  const setD = (patch) => { const n = { ...dRef.current, ...patch }; dRef.current = n; setDRaw(n); guardar({ diseno: n }); };
  const setSub = (k, patch) => setD({ [k]: { ...dRef.current[k], ...patch } });
  const recargarPub = () => crm.orgPublica(o.slug).then(setPub).catch(() => {});
  const recargarEvs = () => crm.orgEventos().then(setEvs).catch(() => setEvs([]));
  useEffect(() => { recargarPub(); recargarEvs(); }, [o.slug]);
  const setPaso = (i) => { setPasoRaw(i); setTimeout(() => arriba.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30); };
  const subir = async (tipo, file, max = 2000) => {
    if (!file) return null;
    if (file.size > 25 * 1024 * 1024) { flash("Foto demasiado grande (máx. 25 MB)", "warn"); return null; }
    try { return await crm.orgSubir(o.id, tipo, await reducirImagen(file, max, tipo === "logo" ? "image/png" : "image/jpeg")); }
    catch { flash("No se ha podido subir la foto", "warn"); return null; }
  };
  const subirVarias = async (campo, files, maxN) => {
    const hueco = maxN - (dRef.current[campo] || []).length;
    const lista = [...files].filter(f => /^image\//.test(f.type)).slice(0, Math.max(0, hueco));
    if (!lista.length) { flash(hueco <= 0 ? `Máximo ${maxN} fotos` : "Elige fotos (JPG, PNG o WEBP)", "warn"); return; }
    const urls = [];
    for (const f of lista) { const u = await subir(campo, f); if (u) urls.push(u); }
    if (urls.length) setD({ [campo]: [...(dRef.current[campo] || []), ...urls].slice(0, maxN) });
    flash(`${urls.length} foto${urls.length === 1 ? "" : "s"} añadida${urls.length === 1 ? "" : "s"}`);
  };
  const url = urlOrg(o.slug);
  const enOrg = (evs || []).filter(e => e.organizacion_id === o.id);
  const req = [
    { t: "Nombre", ok: o.nombre.trim().length >= 2, paso: 0 },
    { t: o.logo_url ? "Logo" : "Logo (recomendado: sin él sale el nombre en texto)", ok: !!o.logo_url, opc: true, paso: 0 },
    { t: "Al menos una foto de portada o de galería", ok: d.portada.length + d.galeria.length > 0, paso: 1 },
    { t: "Al menos un evento asignado", ok: enOrg.length > 0, paso: 4 },
  ];
  const listo = req.every(r => r.ok || r.opc);
  const vista = { ...(pub || {}), slug: o.slug, nombre: o.nombre, lema: o.lema, descripcion: o.descripcion, logo_url: o.logo_url, ciudad: o.ciudad, diseno: d, eventos: pub?.eventos || [], pasados: pub?.pasados || [], vista_previa: !o.publicada };
  const previa = <MovilOrg o={vista} />;
  const tarjeta = (i, t, sub, children, extra) => (
    <section style={{ ...C.panel, padding: isMobile ? 14 : 18 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
        <Tile n={i} s={36} />
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 900, fontSize: 16 }}>{t}</div>{sub && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}</div>
        {extra}
      </div>
      {children}
    </section>
  );
  const Sw = ({ on, onClick, l, sub }) => (
    <label style={{ ...C.toggleRow, padding: "11px 0", borderTop: "1px solid var(--line)", cursor: "pointer" }}>
      <span><span style={{ display: "block" }}>{l}</span>{sub && <span style={{ display: "block", fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>{sub}</span>}</span>
      <button type="button" role="switch" aria-checked={on} onClick={onClick} style={{ ...C.switch, background: on ? "var(--green)" : "var(--line)" }}><span style={{ ...C.knob, transform: on ? "translateX(22px)" : "translateX(2px)" }} /></button>
    </label>
  );

  const contenido = [
    /* ---------- 1 · Identidad ---------- */
    <div key="identidad" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {tarjeta("building", "Quiénes sois", null, <>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "0 12px" }}>
          <Field l="Nombre"><input style={{ ...C.input, fontWeight: 800, fontSize: 17 }} value={o.nombre} maxLength={80} onChange={e => set({ nombre: e.target.value })} /></Field>
          <Field l="Ciudad o zona"><input style={C.input} value={o.ciudad || ""} maxLength={120} placeholder="Ej. Albacete" onChange={e => set({ ciudad: e.target.value })} /></Field>
        </div>
        <Field l="Frase (sale bajo el nombre en la portada)"><input style={C.input} value={o.lema || ""} maxLength={160} placeholder="Ej. La discoteca más grande de La Mancha" onChange={e => set({ lema: e.target.value })} /></Field>
        <Field l="Titular de la portada (opcional)"><input style={C.input} value={d.titular} maxLength={60} placeholder={`Si lo dejas vacío sale «${o.nombre}»`} onChange={e => setD({ titular: e.target.value })} /></Field>
        <Field l="Sobre nosotros" mb={0}><textarea style={{ ...C.input, minHeight: 130, resize: "vertical", fontFamily: "inherit" }} value={o.descripcion || ""} maxLength={6000} placeholder="Vuestra historia, el ambiente, la música, qué os hace únicos…" onChange={e => set({ descripcion: e.target.value })} /></Field>
      </>)}
      {tarjeta("sparkle", "Logo", "PNG con fondo transparente queda mejor. Sale en la barra, en «Sobre nosotros» y en el pie.", (
        <FotoUna url={o.logo_url} alto={150} contener onFile={async (f) => { const u = await subir("logo", f, 800); if (u) set({ logo_url: u }); }} onQuitar={() => set({ logo_url: null })} t="Logo" />
      ))}
    </div>,

    /* ---------- 2 · Fotos ---------- */
    <div key="fotos" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {tarjeta("eye", `Portada (${d.portada.length}/8)`, "Fotos a pantalla completa que van pasando solas. Si no pones ninguna, se usan las de la galería o los flyers.", (
        <Galeria fotos={d.portada} max={8} isMobile={isMobile} onOrden={(a) => setD({ portada: a })} onSubir={(fs) => subirVarias("portada", fs, 8)} etiqueta="Primera" />
      ))}
      {tarjeta("upload", `Galería (${d.galeria.length}/24)`, "Fotos de la sala, del público, de los artistas. Sección «Así se vive».", <>
        <Galeria fotos={d.galeria} max={24} isMobile={isMobile} onOrden={(a) => setD({ galeria: a })} onSubir={(fs) => subirVarias("galeria", fs, 24)} />
        <Field l="Cómo se muestra" mb={0}><Seg full valor={d.galeriaEstilo} onChange={(v) => setD({ galeriaEstilo: v })} opciones={[{ k: "mosaico", t: "Mosaico" }, { k: "carrusel", t: "Carrusel" }]} /></Field>
      </>)}
    </div>,

    /* ---------- 3 · Estilo ---------- */
    <div key="estilo" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {tarjeta("sparkle", "Plantilla", lateral ? "Mira el cambio en el móvil de la derecha." : null, (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,minmax(0,1fr))", gap: 10 }}>
          {ESTILOS_ORG.map(s => { const on = d.estilo === s.k; return (
            <button key={s.k} onClick={() => setD({ estilo: s.k, ...(s.k === "editorial" && d.fondo === "oscuro" && d.estilo !== "editorial" ? { fondo: "claro", letra: "serif" } : {}), ...(s.k !== "editorial" && d.estilo === "editorial" && d.letra === "serif" ? { letra: "inter", fondo: "oscuro" } : {}) })} aria-pressed={on} style={{ textAlign: "left", padding: 8, borderRadius: 14, cursor: "pointer", color: "var(--text)", border: `2px solid ${on ? "var(--accent)" : "var(--line)"}`, background: on ? "color-mix(in srgb, var(--accent) 8%, var(--surface))" : "var(--surface)" }}>
              <Muestra k={s.k} c={d.color} c2={d.color2} />
              <b style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>{on && <Icon n="check" s={14} w={3} c="var(--accent)" />}{s.t}</b>
              <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)", marginTop: 2, lineHeight: 1.35 }}>{s.sub}</span>
            </button>); })}
        </div>), <button onClick={() => setGrande(true)} style={{ ...C.btnSm, flexShrink: 0 }}><Icon n="eye" s={14} />{isMobile ? "Ver" : "Ver en grande"}</button>)}
      {tarjeta("drop", "Colores", "El principal va en botones y precios; el segundo, en degradados y brillos.", <>
        {[["color", "Color principal"], ["color2", "Segundo color"]].map(([k, l]) => (
          <Field key={k} l={l}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {COLORES.map(c => <button key={c} onClick={() => setD({ [k]: c })} aria-label={`${l} ${c}`} aria-pressed={d[k] === c} style={{ width: 36, height: 36, borderRadius: 11, background: c, cursor: "pointer", border: d[k] === c ? "3px solid var(--text)" : "3px solid transparent" }} />)}
              <input type="color" value={d[k]} onChange={e => setD({ [k]: e.target.value })} aria-label={`Otro ${l.toLowerCase()}`} style={{ width: 48, height: 36, border: "none", background: "transparent", cursor: "pointer" }} />
            </div>
          </Field>))}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
          <Field l="Fondo"><Seg full valor={d.fondo} onChange={(v) => setD({ fondo: v })} opciones={[{ k: "oscuro", t: "Oscuro", i: "moon" }, { k: "claro", t: "Claro", i: "sun" }]} /></Field>
          <Field l="Letra"><Seg full valor={d.letra} onChange={(v) => setD({ letra: v })} opciones={LETRAS} /></Field>
        </div>
      </>)}
      {tarjeta("bolt", "Efectos y FOMO", "El FOMO usa siempre datos reales: nunca se inventan cifras.", <>
        <Sw on={d.efectos.movimiento} onClick={() => setSub("efectos", { movimiento: !d.efectos.movimiento })} l="Fotos de portada en movimiento" sub="Fundido y zoom lento, tipo cine." />
        <Sw on={d.efectos.cinta} onClick={() => setSub("efectos", { cinta: !d.efectos.cinta })} l="Cinta con los próximos eventos" sub="Los nombres y fechas pasando bajo la portada." />
        <Sw on={d.efectos.grano} onClick={() => setSub("efectos", { grano: !d.efectos.grano })} l="Textura de grano" sub="Acabado de película, más premium." />
        <Sw on={d.fomo.cuenta} onClick={() => setSub("fomo", { cuenta: !d.fomo.cuenta })} l="Cuenta atrás del próximo evento" />
        <Sw on={d.fomo.ritmo} onClick={() => setSub("fomo", { ritmo: !d.fomo.ritmo })} l="«X entradas vendidas en 24 h»" sub="Solo sale si son 5 o más." />
        <Sw on={d.fomo.quedan} onClick={() => setSub("fomo", { quedan: !d.fomo.quedan })} l="«¡Últimas entradas!» y % vendido" sub="Solo cuando de verdad quedan pocas." />
      </>)}
    </div>,

    /* ---------- 4 · Contenido ---------- */
    <div key="contenido" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {tarjeta("clipboard", "Secciones", "Actívalas y ordénalas. La portada va siempre arriba.", (
        <div>{d.secciones.map((s, i) => { const def = SECCIONES_ORG.find(x => x.k === s.k); const mover = (dir) => { const a = [...d.secciones]; const j = i + dir; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setD({ secciones: a }); }; return (
          <div key={s.k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
            <span style={{ display: "flex", gap: 4 }}>
              <button onClick={() => mover(-1)} disabled={i === 0} aria-label={`Subir ${def.t}`} style={{ ...C.btnSm, width: 34, height: 34, padding: 0, justifyContent: "center", opacity: i === 0 ? .35 : 1 }}><Icon n="up" s={14} /></button>
              <button onClick={() => mover(1)} disabled={i === d.secciones.length - 1} aria-label={`Bajar ${def.t}`} style={{ ...C.btnSm, width: 34, height: 34, padding: 0, justifyContent: "center", opacity: i === d.secciones.length - 1 ? .35 : 1 }}><Icon n="chev" s={14} /></button>
            </span>
            <span style={{ flex: 1, fontWeight: 800, opacity: s.on ? 1 : .55 }}>{def.t}</span>
            <button type="button" role="switch" aria-checked={s.on} aria-label={`Mostrar ${def.t}`} onClick={() => setD({ secciones: d.secciones.map(x => x.k === s.k ? { ...x, on: !x.on } : x) })} style={{ ...C.switch, background: s.on ? "var(--green)" : "var(--line)" }}><span style={{ ...C.knob, transform: s.on ? "translateX(22px)" : "translateX(2px)" }} /></button>
          </div>); })}</div>
      ))}
      {tarjeta("award", "Reservados VIP", "Un bloque llamativo con botón directo a vuestro WhatsApp.", <>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "0 12px" }}>
          <Field l="Título"><input style={C.input} value={d.vip.titulo} maxLength={60} onChange={e => setSub("vip", { titulo: e.target.value })} /></Field>
          <Field l="WhatsApp de reservas"><input style={C.input} inputMode="tel" value={d.vip.whatsapp} maxLength={30} placeholder="612 345 678" onChange={e => setSub("vip", { whatsapp: e.target.value })} /></Field>
        </div>
        <Field l="Texto"><textarea style={{ ...C.input, minHeight: 80, resize: "vertical", fontFamily: "inherit" }} value={d.vip.texto} maxLength={600} placeholder="Botella, zona privada y atención preferente. Plazas limitadas cada noche." onChange={e => setSub("vip", { texto: e.target.value })} /></Field>
        <Field l="Texto del botón" mb={0}><input style={C.input} value={d.vip.boton} maxLength={30} onChange={e => setSub("vip", { boton: e.target.value })} /></Field>
        {!d.secciones.find(s => s.k === "vip")?.on && <div style={{ ...ayuda, color: "var(--amber)", fontWeight: 700 }}>Activa «Reservados VIP» en Secciones para que se vea.</div>}
      </>)}
      {tarjeta("home", "Ubicación y horario", null, <>
        <Field l="Dirección"><input style={C.input} value={d.ubicacion.direccion} maxLength={200} placeholder="Calle, número, ciudad" onChange={e => setSub("ubicacion", { direccion: e.target.value })} /></Field>
        <Field l="Horario" mb={0}><textarea style={{ ...C.input, minHeight: 70, resize: "vertical", fontFamily: "inherit" }} value={d.ubicacion.horario} maxLength={300} placeholder={"Viernes y sábados de 00:00 a 06:00\nVísperas de festivo"} onChange={e => setSub("ubicacion", { horario: e.target.value })} /></Field>
      </>)}
      {tarjeta("alert", `Preguntas frecuentes (${d.faq.length})`, "Dress code, edad, cómo llegar, si se puede entrar con la entrada en el móvil…", <>
        {d.faq.map((x, i) => (
          <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 10, marginBottom: 10, background: "var(--surface2)" }}>
            <input style={{ ...C.input, fontWeight: 800, marginBottom: 6 }} value={x.p} maxLength={140} placeholder="Pregunta" onChange={e => setD({ faq: d.faq.map((y, j) => j === i ? { ...y, p: e.target.value } : y) })} />
            <textarea style={{ ...C.input, minHeight: 60, resize: "vertical", fontFamily: "inherit" }} value={x.r} maxLength={800} placeholder="Respuesta" onChange={e => setD({ faq: d.faq.map((y, j) => j === i ? { ...y, r: e.target.value } : y) })} />
            <button onClick={() => setD({ faq: d.faq.filter((_, j) => j !== i) })} style={{ ...C.btnSm, marginTop: 6 }}><Icon n="trash" s={14} />Quitar</button>
          </div>))}
        <button onClick={() => setD({ faq: [...d.faq, { p: "", r: "" }] })} style={C.btnGhost}><Icon n="plus" s={16} w={2.4} />Añadir pregunta</button>
      </>)}
      {tarjeta("globe", "Redes y contacto", "Salen como iconos en el pie.", (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "0 12px" }}>
          {REDES_ORG.map(r => <Field key={r.k} l={r.t}><div style={{ position: "relative" }}><span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", display: "grid" }}><IcoRed n={r.k} s={17} /></span>
            <input style={{ ...C.input, paddingLeft: 40 }} value={d.redes[r.k] || ""} maxLength={160} placeholder={{ instagram: "@tumarca", tiktok: "@tumarca", whatsapp: "612 345 678", spotify: "Enlace a tu playlist", web: "tumarca.es", email: "hola@tumarca.es", telefono: "612 345 678" }[r.k]} onChange={e => setSub("redes", { [r.k]: e.target.value })} /></div></Field>)}
        </div>
      ))}
    </div>,

    /* ---------- 5 · Eventos ---------- */
    <div key="eventos" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {tarjeta("ticket", "Eventos de esta organización", "Marca los que pertenecen a esta organización. Salen solos en el microsite mientras están publicados y no han terminado.", (
        evs === null ? <div style={{ color: "var(--muted)" }}>Cargando…</div> : evs.length === 0 ? <div style={{ color: "var(--muted)" }}>Aún no tienes eventos con venta online. Créalos en «Eventos».</div> :
        <div>{evs.map(e => { const mio = e.organizacion_id === o.id, otra = e.organizacion_id && !mio, oculto = d.ocultos.includes(e.slug), dest = d.destacado === e.slug; const fin = e.fin ? new Date(e.fin) < new Date() : false; return (
          <div key={e.evento_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid var(--line)", flexWrap: "wrap" }}>
            <button type="button" role="checkbox" aria-checked={mio} onClick={async () => {
              try { await crm.orgAsignarEvento(e.evento_id, mio ? null : o.id); await recargarEvs(); recargarPub(); flash(mio ? "Quitado del microsite" : "Añadido al microsite"); } catch { flash("No se ha podido cambiar", "warn"); }
            }} style={{ width: 28, height: 28, borderRadius: 8, border: `2px solid ${mio ? "var(--accent)" : "var(--line)"}`, background: mio ? "var(--accent)" : "transparent", color: "#fff", display: "grid", placeItems: "center", cursor: "pointer", flexShrink: 0 }}>{mio && <Icon n="check" s={15} w={3} />}</button>
            <span style={{ width: 42, height: 42, borderRadius: 10, overflow: "hidden", background: "var(--surface2)", flexShrink: 0 }}>{e.flyer_url && <img src={e.flyer_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}</span>
            <span style={{ flex: "1 1 160px", minWidth: 0 }}>
              <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.nombre}</b>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{e.fecha}{e.estado !== "publicado" ? ` · ${e.estado}` : ""}{fin ? " · ya pasó" : ""}{otra ? " · en otra organización" : ""}</span>
            </span>
            {mio && <span style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setD({ destacado: dest ? "" : e.slug })} style={{ ...C.btnSm, borderColor: dest ? "var(--amber)" : "var(--line)", color: dest ? "var(--amber)" : "var(--text)" }}><Icon n="award" s={14} />{dest ? "Destacado" : "Destacar"}</button>
              <button onClick={() => setD({ ocultos: oculto ? d.ocultos.filter(x => x !== e.slug) : [...d.ocultos, e.slug] })} style={C.btnSm}><Icon n={oculto ? "eye" : "x"} s={14} />{oculto ? "Mostrar" : "Ocultar"}</button>
            </span>}
          </div>); })}</div>
      ))}
    </div>,

    /* ---------- 6 · Publicar ---------- */
    <div key="publicar" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {tarjeta("check", listo ? "Todo listo" : "Antes de publicar", listo ? "Tu microsite tiene lo necesario." : "Toca lo que falta.", (
        <div>{req.map(r => (
          <button key={r.t} onClick={() => !r.ok && setPaso(r.paso)} style={{ ...C.listBtn, cursor: r.ok ? "default" : "pointer", padding: "11px 4px" }}>
            <span style={{ width: 28, height: 28, borderRadius: 28, display: "grid", placeItems: "center", flexShrink: 0, background: r.ok ? "var(--green)" : "color-mix(in srgb, var(--amber) 18%, transparent)", color: r.ok ? "#04231a" : "var(--amber)" }}><Icon n={r.ok ? "check" : "alert"} s={15} w={2.6} /></span>
            <span style={{ flex: 1, fontWeight: 800, color: r.ok ? "var(--text)" : "var(--amber)" }}>{r.t}</span>
            {!r.ok && <span style={{ ...C.btnSm, color: "var(--accent)" }}>Completar<Icon n="right" s={13} /></span>}
          </button>))}</div>))}
      <section style={{ ...C.hero, padding: isMobile ? 16 : 20 }}>
        <div style={{ fontWeight: 900, fontSize: 18 }}>{o.publicada ? "Tu microsite está publicado" : "Publicar el microsite"}</div>
        <div style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 14px" }}>{o.publicada ? "Cualquiera con el enlace lo ve. Los cambios se ven al momento." : "Mientras no lo publiques, solo tú lo ves (con la sesión abierta)."}</div>
        {o.publicada
          ? <button onClick={() => { set({ publicada: false }); flash("Microsite oculto"); }} style={{ ...C.btnGhost, width: "100%" }}><Icon n="eyeOff" s={15} />Despublicar</button>
          : <button onClick={() => { if (!listo) { flash("Falta algo: mira la lista", "warn"); return; } set({ publicada: true }); flash("¡Publicado!"); }} disabled={!listo} style={{ ...C.btnPrimary, width: "100%", minHeight: 56, fontSize: 17, opacity: listo ? 1 : .45 }}><Icon n="sparkle" s={19} />Publicar ahora</button>}
      </section>
      {tarjeta("link", "Enlace", "Ponlo en la bio de Instagram, en los flyers y en los estados de WhatsApp.", <>
        <EnlaceOrg o={o} flash={flash} onCambio={(slug) => { setO(x => ({ ...x, slug })); onCambio({ slug }); }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8, marginTop: 12 }}>
          <button onClick={async () => { try { await navigator.clipboard.writeText(url); flash("Enlace copiado"); } catch { flash(url); } }} style={{ ...C.btnGhost, minHeight: 48 }}><Icon n="copy" s={16} />Copiar</button>
          <a href={`https://wa.me/?text=${encodeURIComponent(`${o.nombre}: todos nuestros eventos y entradas aquí 👉 ${url}`)}`} target="_blank" rel="noopener noreferrer" style={{ ...C.btnGhost, minHeight: 48, textDecoration: "none", color: "#25d366", boxSizing: "border-box" }}><Icon n="whatsapp" s={16} />WhatsApp</a>
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ ...C.btnGhost, minHeight: 48, textDecoration: "none", boxSizing: "border-box" }}><Icon n="eye" s={16} />Abrir</a>
        </div>
      </>)}
      {!lateral && tarjeta("phone", "Así lo verán", "Es la página de verdad.", <div style={{ display: "flex", justifyContent: "center" }}>{previa}</div>)}
      <section style={{ ...C.panel, padding: 14 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={onNueva} style={C.btnSm}><Icon n="plus" s={14} />Otra organización</button>
          {borrar ? <><button onClick={async () => { try { await crm.orgBorrar(o.id); flash("Organización borrada"); onBorrada(); } catch { flash("No se ha podido borrar", "warn"); } }} style={{ ...C.btnSm, borderColor: "var(--red)", color: "var(--red)" }}>Sí, borrar (sus eventos no se borran)</button><button onClick={() => setBorrar(false)} style={C.btnSm}>No</button></>
            : <button onClick={() => setBorrar(true)} style={{ ...C.btnSm, color: "var(--muted)" }}><Icon n="trash" s={14} />Borrar organización</button>}
        </div>
      </section>
    </div>,
  ];

  return (<>
    <section style={{ ...C.hero, padding: isMobile ? 14 : 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {onVolver && <button onClick={onVolver} style={C.btnSm}><Icon n="right" s={14} style={{ transform: "rotate(180deg)" }} />Todas</button>}
        {o.logo_url ? <img src={o.logo_url} alt="" style={{ height: 30, maxWidth: 110, objectFit: "contain" }} /> : null}
        <b style={{ fontSize: 18, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.nombre}</b>
        {o.publicada ? <Badge c="var(--green)" solid>Publicada</Badge> : <Badge>Borrador</Badge>}
        <span style={{ fontSize: 12, fontWeight: 700, color: estado === "error" ? "var(--red)" : "var(--muted)" }}>{estado === "guardando" ? "Guardando…" : estado === "guardado" ? "Guardado" : estado === "error" ? "No se ha guardado" : "Se guarda solo"}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <code style={{ background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 10px", fontSize: 13, overflowWrap: "anywhere", flex: "1 1 220px", minWidth: 0 }}>{url}</code>
        <a href={url} target="_blank" rel="noopener noreferrer" style={{ ...C.btnSm, textDecoration: "none" }}><Icon n="eye" s={14} />{o.publicada ? "Abrir" : "Vista previa"}</a>
      </div>
    </section>

    <nav ref={arriba} aria-label="Pasos" style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: isMobile ? 3 : 8, scrollMarginTop: 12 }}>
      {PASOS.map((p, i) => { const on = i === paso; return (
        <button key={p.k} onClick={() => setPaso(i)} aria-current={on ? "step" : undefined} style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: "center", gap: isMobile ? 4 : 10, padding: isMobile ? "9px 2px" : "11px 12px", borderRadius: 14, cursor: "pointer", minWidth: 0, textAlign: "left", border: `2px solid ${on ? "var(--accent)" : "var(--line)"}`, background: on ? "color-mix(in srgb, var(--accent) 9%, var(--surface))" : "var(--surface)", color: "var(--text)" }}>
          <span style={{ width: isMobile ? 26 : 30, height: isMobile ? 26 : 30, borderRadius: 30, display: "grid", placeItems: "center", flexShrink: 0, background: on ? "var(--accent)" : "var(--surface2)", color: on ? "#fff" : "var(--muted)" }}><Icon n={p.i} s={isMobile ? 13 : 15} /></span>
          <b style={{ fontSize: isMobile ? 10.5 : 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{p.t}</b>
        </button>); })}
    </nav>

    <div style={{ display: "grid", gridTemplateColumns: lateral ? "minmax(0,1fr) 330px" : "1fr", gap: 18, alignItems: "start" }}>
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 900, color: "var(--accent)", textTransform: "uppercase", letterSpacing: 1.4 }}>Paso {paso + 1} de 6</div>
          <div style={{ fontSize: isMobile ? 22 : 26, fontWeight: 900 }}>{PASOS[paso].t}</div>
          <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 2 }}>{PASOS[paso].sub}</div>
        </div>
        {contenido[paso]}
        <div style={{ position: "sticky", bottom: isMobile ? -12 : -22, zIndex: 5, display: "flex", gap: 8, padding: "12px 0", paddingBottom: isMobile ? "calc(12px + env(safe-area-inset-bottom))" : 12, background: "linear-gradient(180deg, transparent, var(--bg) 35%)" }}>
          {paso > 0 && <button onClick={() => setPaso(paso - 1)} style={{ ...C.btnGhost, minHeight: 50 }}><Icon n="right" s={16} style={{ transform: "rotate(180deg)" }} />Atrás</button>}
          {paso < 5 && <button onClick={() => setPaso(paso + 1)} style={{ ...C.btnPrimary, minHeight: 50, flex: 1, fontSize: 15.5 }}>Siguiente: {PASOS[paso + 1].t}<Icon n="right" s={16} /></button>}
        </div>
      </div>
      {lateral && <aside style={{ position: "sticky", top: 0 }}>
        <div style={{ ...C.label, textAlign: "center" }}>Así lo verán</div>
        <div style={{ display: "flex", justifyContent: "center" }}>{previa}</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 10 }}><button onClick={() => setGrande(true)} style={C.btnSm}><Icon n="eye" s={14} />Ver en grande</button></div>
      </aside>}
    </div>
    {grande && <PreviaGrande o={vista} url={url} isMobile={isMobile} onClose={() => setGrande(false)} />}
  </>);
}

/* ===================== Piezas ===================== */
function MovilOrg({ o, ancho = 270, alto = 560 }) {
  return (
    <div style={{ width: ancho + 20, height: alto + 20, borderRadius: 40, padding: 10, background: "#111", boxShadow: "0 18px 50px rgba(0,0,0,.35), inset 0 0 0 2px #2a2a2a", flexShrink: 0 }}>
      <div aria-label="Vista previa del microsite" style={{ position: "relative", width: ancho, height: alto, borderRadius: 30, overflow: "auto", overscrollBehavior: "contain", scrollbarWidth: "none", background: "#000" }}>
        <div style={{ position: "relative", width: 390, zoom: ancho / 390, pointerEvents: "none" }}><Microsite o={o} previa /></div>
      </div>
    </div>
  );
}
function PreviaGrande({ o, url, isMobile, onClose }) {
  const [modo, setModo] = useState(isMobile ? "movil" : "ordenador");
  const ancho = useAncho();
  const anchoPc = Math.min(1280, ancho - 48);
  return (
    <div role="dialog" aria-label="Vista previa" style={{ position: "fixed", inset: 0, zIndex: 95, background: "rgba(8,9,13,.92)", backdropFilter: "blur(6px)", display: "flex", flexDirection: "column", alignItems: "center", padding: "14px 12px calc(14px + env(safe-area-inset-bottom))", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
        {!isMobile && <Seg valor={modo} onChange={setModo} opciones={[{ k: "movil", t: "Móvil", i: "phone" }, { k: "ordenador", t: "Ordenador", i: "pos" }]} />}
        <a href={url} target="_blank" rel="noopener noreferrer" style={{ ...C.btnSm, textDecoration: "none" }}><Icon n="link" s={14} />Abrir la página real</a>
        <button onClick={onClose} style={{ ...C.btnSm, background: "#fff", color: "#111" }}><Icon n="x" s={14} />Cerrar</button>
      </div>
      {modo === "movil"
        ? <MovilOrg o={o} ancho={Math.min(390, ancho - 44)} alto={Math.min(780, window.innerHeight - 110)} />
        : <div style={{ position: "relative", width: anchoPc, flex: 1, minHeight: 0, borderRadius: 14, overflow: "auto", background: "#000", boxShadow: "0 18px 50px rgba(0,0,0,.5)" }}>
            <div style={{ position: "relative", width: 1280, zoom: anchoPc / 1280, pointerEvents: "none" }}><Microsite o={o} previa /></div>
          </div>}
    </div>
  );
}
// Dibujo de cada plantilla
function Muestra({ k, c, c2 }) {
  const b = (st) => <span style={{ position: "absolute", ...st }} />;
  const foto = `linear-gradient(135deg, ${c}, ${c2})`;
  return (
    <span style={{ position: "relative", display: "block", height: 96, borderRadius: 10, overflow: "hidden", background: k === "editorial" ? "#f4f1ea" : "#0b0b10", border: "1px solid var(--line)" }}>
      {k === "noche" && <>{b({ inset: 0, height: 56, background: foto, opacity: .85 })}{b({ left: 0, right: 0, top: 30, height: 30, background: "linear-gradient(transparent,#0b0b10)" })}{b({ left: 8, top: 34, width: "55%", height: 10, background: "#fff", borderRadius: 3 })}{[0, 1, 2].map(i => b({ key: i, left: 8 + i * 30 + "%", top: 64, width: "26%", height: 26, background: "rgba(255,255,255,.12)", borderRadius: 6 }))}</>}
      {k === "neon" && <>{b({ inset: 0, background: `radial-gradient(60% 60% at 20% 30%, ${c}, transparent), radial-gradient(60% 60% at 85% 70%, ${c2}, transparent)`, opacity: .9 })}{b({ left: 8, top: 30, width: "62%", height: 12, background: `linear-gradient(90deg,#fff,${c},${c2})`, borderRadius: 3, boxShadow: `0 0 12px ${c}` })}{b({ left: 8, top: 66, width: "40%", height: 14, border: `2px solid ${c}`, borderRadius: 6, boxShadow: `0 0 10px ${c}` })}</>}
      {k === "editorial" && <>{b({ left: 8, right: "45%", top: 10, bottom: 10, background: foto })}{b({ left: "60%", top: 18, width: "32%", height: 8, background: "#1c1a16" })}{b({ left: "60%", top: 32, width: "24%", height: 4, background: "#8a8478" })}{b({ left: "60%", top: 64, width: "30%", height: 1, background: "#1c1a16" })}{b({ left: "60%", top: 72, width: "18%", height: 8, background: c })}</>}
      {k === "club" && <>{b({ left: 0, right: 0, top: 0, height: 44, background: foto })}{b({ left: 6, top: 50, width: "86%", height: 18, background: "#fff" })}{b({ left: 0, right: 0, top: 74, height: 22, background: c })}</>}
    </span>
  );
}
function FotoUna({ url, alto, contener, onFile, onQuitar, t }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const tomar = async (f) => { if (!f) return; setBusy(true); try { await onFile(f); } finally { setBusy(false); } };
  return (
    <div>
      <button type="button" onClick={() => !busy && ref.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); tomar(e.dataTransfer.files?.[0]); }} aria-label={url ? `Cambiar ${t}` : `Subir ${t}`}
        style={{ position: "relative", width: "100%", height: alto, borderRadius: 16, border: `2px dashed ${url ? "transparent" : "var(--line)"}`, background: url && contener ? "repeating-conic-gradient(var(--surface2) 0 25%, var(--surface) 0 50%) 0 0/18px 18px" : "var(--surface2)", cursor: busy ? "wait" : "pointer", overflow: "hidden", padding: 0, display: "grid", placeItems: "center", color: "var(--muted)" }}>
        {url ? <img src={url} alt={t} style={{ width: "100%", height: "100%", objectFit: contener ? "contain" : "cover", padding: contener ? 14 : 0, boxSizing: "border-box" }} />
          : <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, fontWeight: 800 }}><span style={{ width: 46, height: 46, borderRadius: 14, background: "color-mix(in srgb, var(--accent) 14%, transparent)", color: "var(--accent)", display: "grid", placeItems: "center" }}><Icon n="upload" s={20} /></span><span style={{ color: "var(--text)" }}>Subir {t.toLowerCase()}</span></span>}
        {busy && <span style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.55)", color: "#fff", display: "grid", placeItems: "center", fontWeight: 900 }}>Subiendo…</span>}
      </button>
      <input ref={ref} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; tomar(f); }} />
      {url && <div style={{ display: "flex", gap: 6, marginTop: 8 }}><button onClick={() => ref.current?.click()} style={C.btnSm}><Icon n="upload" s={14} />Cambiar</button><button onClick={onQuitar} style={C.btnSm}><Icon n="trash" s={14} />Quitar</button></div>}
    </div>
  );
}
function Galeria({ fotos, max, isMobile, onOrden, onSubir, etiqueta = "Portada" }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [encima, setEncima] = useState(false);
  const subir = async (files) => { if (!files?.length) return; setBusy(true); try { await onSubir(files); } finally { setBusy(false); } };
  const mover = (i, dir) => { const j = i + dir; if (j < 0 || j >= fotos.length) return; const a = [...fotos]; [a[i], a[j]] = [a[j], a[i]]; onOrden(a); };
  const fb = { width: 30, height: 30, borderRadius: 8, border: "none", background: "rgba(0,0,0,.6)", color: "#fff", display: "grid", placeItems: "center", cursor: "pointer", padding: 0 };
  return (
    <div onDragOver={e => { e.preventDefault(); setEncima(true); }} onDragLeave={() => setEncima(false)} onDrop={e => { e.preventDefault(); setEncima(false); subir(e.dataTransfer.files); }} style={{ marginBottom: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,minmax(0,1fr))" : "repeat(4,minmax(0,1fr))", gap: 10 }}>
        {fotos.map((u, i) => (
          <div key={u + i} style={{ position: "relative", aspectRatio: "4/3", borderRadius: 12, overflow: "hidden", background: "var(--surface2)", border: "1px solid var(--line)" }}>
            <img src={u} alt={`Foto ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            {i === 0 && <span style={{ position: "absolute", top: 6, left: 6, background: "rgba(0,0,0,.6)", color: "#fff", fontSize: 11, fontWeight: 800, borderRadius: 6, padding: "2px 7px" }}>{etiqueta}</span>}
            <span style={{ position: "absolute", left: 6, right: 6, bottom: 6, display: "flex", justifyContent: "space-between" }}>
              <span style={{ display: "flex", gap: 4 }}>
                <button onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Mover a la izquierda" style={{ ...fb, opacity: i === 0 ? .4 : 1 }}><Icon n="right" s={14} style={{ transform: "rotate(180deg)" }} /></button>
                <button onClick={() => mover(i, 1)} disabled={i === fotos.length - 1} aria-label="Mover a la derecha" style={{ ...fb, opacity: i === fotos.length - 1 ? .4 : 1 }}><Icon n="right" s={14} /></button>
              </span>
              <button onClick={() => onOrden(fotos.filter((_, k) => k !== i))} aria-label={`Quitar foto ${i + 1}`} style={fb}><Icon n="trash" s={14} /></button>
            </span>
          </div>))}
        {fotos.length < max && (
          <button onClick={() => !busy && ref.current?.click()} style={{ aspectRatio: "4/3", borderRadius: 12, border: `2px dashed ${encima ? "var(--accent)" : "var(--line)"}`, background: encima ? "color-mix(in srgb, var(--accent) 8%, var(--surface2))" : "var(--surface2)", color: "var(--muted)", cursor: busy ? "wait" : "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, fontWeight: 800, fontSize: 13 }}>
            <span style={{ width: 40, height: 40, borderRadius: 12, background: "color-mix(in srgb, var(--accent) 14%, transparent)", color: "var(--accent)", display: "grid", placeItems: "center" }}><Icon n="plus" s={20} w={2.4} /></span>
            {busy ? "Subiendo…" : "Añadir fotos"}
          </button>)}
      </div>
      <input ref={ref} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => { const fl = e.target.files; subir(fl ? [...fl] : []); e.target.value = ""; }} />
      <div style={ayuda}>{isMobile ? "Puedes elegir varias a la vez." : "Puedes elegir o arrastrar varias a la vez."} Se reducen solas para que la página cargue rápido.</div>
    </div>
  );
}
function EnlaceOrg({ o, flash, onCambio }) {
  const [v, setV] = useState(o.slug);
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ color: "var(--muted)", fontSize: 13 }}>{window.location.host}/o/</span>
      <input style={{ ...C.input, flex: "1 1 180px", width: "auto" }} value={v} onChange={e => setV(crm.slugDe(e.target.value).slice(0, 60))} aria-label="Enlace de la organización" />
      {v !== o.slug && <button disabled={busy || v.length < 3} onClick={async () => { setBusy(true); try { const s = await crm.orgCambiarSlug(o.id, v); onCambio(s); flash("Enlace cambiado"); } catch (e) { flash(e.message, "warn"); } finally { setBusy(false); } }} style={C.btnPrimary}>Guardar enlace</button>}
    </div>
  );
}

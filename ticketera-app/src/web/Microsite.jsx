// ===================== MICROSITE DE LA ORGANIZACIÓN =====================
// /o/<organización>: la carta de presentación de la discoteca o la marca. Portada a pantalla completa,
// todos sus eventos a la venta, galería, ediciones pasadas, sobre nosotros, reservados, ubicación,
// preguntas frecuentes y redes. Se compra de varios eventos a la vez con un solo carrito.
// El FOMO sale siempre de datos reales del servidor (nunca inventados).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../supabase";
import { money, eur, fecha, hora, cap, reducido, tema, Mensaje, card, btn, Aviso, CSS_PUB, LETRA } from "./comun";
import { useCarrito, BarraCarrito, HojaCarrito, ElegirEntradas, CompraVarios } from "./Carrito";

/* ---------- Opciones (las mismas que edita el CRM) ---------- */
export const ESTILOS_ORG = [
  { k: "noche", t: "Noche", sub: "Oscuro y elegante, con brillo de tu color" },
  { k: "neon", t: "Neón", sub: "Degradados y luces de discoteca" },
  { k: "editorial", t: "Editorial", sub: "Revista de lujo: serif y mucho aire" },
  { k: "club", t: "Club", sub: "Tipografía gigante y bloques de color" },
];
export const SECCIONES_ORG = [
  { k: "proximos", t: "Próximos eventos" }, { k: "galeria", t: "Galería" }, { k: "sobre", t: "Sobre nosotros" },
  { k: "pasados", t: "Ediciones pasadas" }, { k: "vip", t: "Reservados VIP" }, { k: "ubicacion", t: "Ubicación y horario" },
  { k: "faq", t: "Preguntas frecuentes" },
];
export const DISENO_ORG_DEF = {
  estilo: "noche", color: "#ff5a3c", color2: "#a855f7", fondo: "oscuro", letra: "inter",
  portada: [], galeria: [], galeriaEstilo: "mosaico", titular: "", boton: "Ver próximos eventos",
  secciones: SECCIONES_ORG.map(s => ({ k: s.k, on: s.k !== "vip" && s.k !== "faq" })),
  efectos: { cinta: true, grano: true, brillo: true, movimiento: true },
  fomo: { cuenta: true, ritmo: true, quedan: true },
  vip: { titulo: "Reservados VIP", texto: "", whatsapp: "", boton: "Reservar por WhatsApp" },
  ubicacion: { direccion: "", horario: "", maps: "" },
  faq: [], redes: {}, destacado: "", ocultos: [],
};
export const disenoOrg = (d) => {
  const x = { ...DISENO_ORG_DEF, ...(d || {}) };
  ["efectos", "fomo", "vip", "ubicacion", "redes"].forEach(k => { x[k] = { ...DISENO_ORG_DEF[k], ...((d || {})[k] || {}) }; });
  const conocidas = new Set((x.secciones || []).map(s => s.k));
  x.secciones = [...(x.secciones || []).filter(s => SECCIONES_ORG.some(o => o.k === s.k)), ...SECCIONES_ORG.filter(s => !conocidas.has(s.k)).map(s => ({ k: s.k, on: false }))];
  return x;
};
// Estilo visual de cada plantilla
function temaOrg(d) {
  const editorial = d.estilo === "editorial", club = d.estilo === "club", neon = d.estilo === "neon";
  const T = tema({ color: d.color, fondo: d.fondo, letra: d.letra || (editorial ? "serif" : "inter") });
  const titulo = { fontFamily: editorial ? LETRA.serif : T.letra, fontWeight: editorial ? 700 : 900, letterSpacing: club ? "-.045em" : editorial ? "-.01em" : "-.03em", textTransform: club ? "uppercase" : "none", lineHeight: club ? .88 : 1.02 };
  return { ...T, d, editorial, club, neon, r: club ? 0 : editorial ? 6 : 22, titulo,
    vars: { ...T.vars, "--c2": d.color2 || d.color, "--r": `${club ? 0 : editorial ? 6 : 22}px`,
      ...(neon && T.osc ? { "--bg": "#07060d", "--card": "rgba(24,18,40,.72)" } : {}),
      ...(editorial && !T.osc ? { "--bg": "#f4f1ea", "--card": "rgba(255,255,255,.75)", "--card2": "#ebe6db", "--line": "rgba(30,25,15,.12)" } : {}) } };
}

/* ---------- Página pública ---------- */
export default function PaginaOrganizacion({ slug }) {
  const [o, setO] = useState(undefined);
  const [error, setError] = useState(false);
  const offset = useRef(0);
  const cargar = async () => {
    try {
      const { data, error: e } = await supabase.rpc("web_organizacion_publica", { p_slug: slug });
      if (e) throw e;
      if (data?.ahora) offset.current = new Date(data.ahora).getTime() - Date.now();
      setO(data || null); setError(false);
    } catch { setError(true); }
  };
  useEffect(() => { cargar(); const t = setInterval(cargar, 90000); return () => clearInterval(t); }, [slug]);
  useEffect(() => { if (o?.nombre) document.title = `${o.nombre}${o.lema ? " · " + o.lema : ""}`; }, [o?.nombre]);
  if (o === undefined && !error) return <Mensaje titulo="Cargando…" />;
  if (error && !o) return <Mensaje titulo="No se ha podido cargar" texto="Revisa tu conexión e inténtalo de nuevo."><button onClick={cargar} style={btn("#ff5a3c", "#fff")}>Reintentar</button></Mensaje>;
  if (!o) return <Mensaje titulo="Esta página no está disponible" texto="Puede que el enlace no sea correcto o que aún no esté publicada." />;
  return <Microsite o={o} offset={offset.current} />;
}

export function Microsite({ o, offset = 0, previa = false }) {
  const d = disenoOrg(o.diseno);
  const T = temaOrg(d);
  const carrito = useCarrito(previa ? null : o.slug);
  const [hoja, setHoja] = useState(null);           // null | "carrito" | { evento }
  const [comprando, setComprando] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [scrolled, setScrolled] = useState(false);
  const raiz = useRef(null);
  const ahora = Date.now() + offset;
  const ocultos = new Set(d.ocultos || []);
  const eventos = (o.eventos || []).filter(e => !ocultos.has(e.slug));
  const orden = d.destacado ? [...eventos.filter(e => e.slug === d.destacado), ...eventos.filter(e => e.slug !== d.destacado)] : eventos;
  const proximo = eventos.find(e => e.en_venta) || eventos.find(e => e.proximo) || eventos[0];
  const fotosPortada = (d.portada?.length ? d.portada : d.galeria?.length ? d.galeria : eventos.map(e => e.flyer_url)).filter(Boolean).slice(0, 8);
  const secciones = d.secciones.filter(s => s.on);
  const ir = (id) => raiz.current?.querySelector("#" + id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  useEffect(() => {
    if (previa) return;
    const f = () => setScrolled(window.scrollY > window.innerHeight * .6);
    f(); window.addEventListener("scroll", f, { passive: true }); return () => window.removeEventListener("scroll", f);
  }, [previa]);

  if (comprando) return (
    <div ref={raiz} style={{ ...T.vars, minHeight: previa ? "100%" : "100dvh", background: "var(--bg)", color: "var(--text)", fontFamily: T.letra }}>
      <style>{CSS_PUB + CSS_ORG}</style>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "max(14px, env(safe-area-inset-top)) 16px 60px" }}>
        <Cabecera o={o} T={T} />
        <CompraVarios org={o} carrito={carrito} T={T} onVolver={() => setComprando(false)} />
      </div>
    </div>
  );

  const bloques = {
    proximos: <Proximos key="proximos" eventos={orden} T={T} d={d} ahora={ahora} destacado={d.destacado} onEntradas={(e) => setHoja({ evento: e.slug })} previa={previa} carrito={carrito} />,
    galeria: (d.galeria || []).length > 0 && <GaleriaOrg key="galeria" fotos={d.galeria} estilo={d.galeriaEstilo} T={T} onAbrir={setLightbox} />,
    sobre: (o.descripcion || o.logo_url) && <Sobre key="sobre" o={o} T={T} />,
    pasados: (o.pasados || []).length > 0 && <Pasados key="pasados" pasados={o.pasados} T={T} />,
    vip: <Vip key="vip" vip={d.vip} o={o} T={T} />,
    ubicacion: (d.ubicacion.direccion || d.ubicacion.horario) && <Ubicacion key="ubicacion" u={d.ubicacion} T={T} />,
    faq: (d.faq || []).filter(x => x.p).length > 0 && <Faq key="faq" faq={d.faq.filter(x => x.p)} T={T} />,
  };

  return (
    <div ref={raiz} className={`org org-${d.estilo}`} style={{ ...T.vars, minHeight: previa ? "100%" : "100dvh", background: "var(--bg)", color: "var(--text)", fontFamily: T.letra, position: "relative", overflowX: "hidden" }}>
      <style>{CSS_PUB + CSS_ORG}</style>
      {d.efectos.grano && <div aria-hidden="true" className="org-grano" style={{ position: previa ? "absolute" : "fixed" }} />}
      {o.vista_previa && !previa && <div style={{ position: "relative", zIndex: 30, background: "#ffb400", color: "#1a1205", fontWeight: 800, fontSize: 14, textAlign: "center", padding: "8px 12px" }}>Vista previa: esta página aún no está publicada. Solo tú la ves.</div>}

      {/* Barra superior: transparente sobre la portada, sólida al bajar */}
      <nav className={"org-nav" + (scrolled ? " org-nav-on" : "")} style={previa ? { position: "absolute" } : null} aria-label={o.nombre}>
        <a href={previa ? undefined : `/o/${o.slug}`} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, color: "inherit", textDecoration: "none" }}>
          {o.logo_url ? <img src={o.logo_url} alt={o.nombre} style={{ height: 34, maxWidth: 130, objectFit: "contain" }} /> : <b style={{ ...T.titulo, fontSize: 19, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.nombre}</b>}
        </a>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="pub-solo-ancho"><span style={{ display: "flex", gap: 2 }}>
            {secciones.some(s => s.k === "galeria") && (d.galeria || []).length > 0 && <button onClick={() => ir("galeria")} className="org-navlink">Galería</button>}
            {secciones.some(s => s.k === "ubicacion") && d.ubicacion.direccion && <button onClick={() => ir("ubicacion")} className="org-navlink">Ubicación</button>}
          </span></span>
          <button onClick={() => ir("eventos")} style={{ ...btn(T.d.color, T.tinta), padding: "10px 16px", fontSize: 14.5, borderRadius: T.club ? 0 : 30 }}>Entradas</button>
          {carrito.n > 0 && <button onClick={() => setHoja("carrito")} aria-label={`Carrito: ${carrito.n} entradas`} style={{ ...btn("var(--card2)", "var(--text)"), padding: "10px 12px", borderRadius: T.club ? 0 : 30, border: "1px solid var(--line)", fontSize: 14 }}>🛒 {carrito.n}</button>}
        </div>
      </nav>

      <div className="pub-cont">
        <Portada o={o} d={d} T={T} fotos={fotosPortada} proximo={proximo} ahora={ahora} previa={previa} onEntradas={() => ir("eventos")} onComprar={(e) => setHoja({ evento: e.slug })} />
        {d.efectos.cinta && eventos.length > 0 && <Cinta eventos={eventos} T={T} />}
        <div style={{ position: "relative", zIndex: 2, paddingBottom: carrito.n ? 130 : 40 }}>
          {secciones.map(s => bloques[s.k]).filter(Boolean)}
          <Pie o={o} d={d} T={T} />
        </div>
      </div>

      <BarraCarrito carrito={carrito} T={T} previa={previa} onAbrir={() => setHoja("carrito")} />
      {hoja === "carrito" && <HojaCarrito carrito={carrito} T={T} previa={previa} orgNombre={o.nombre} onClose={() => setHoja(null)} onContinuar={() => { setHoja(null); setComprando(true); if (!previa) window.scrollTo({ top: 0 }); }} />}
      {hoja?.evento && <ElegirEntradas slug={hoja.evento} carrito={carrito} T={T} previa={previa} onClose={() => setHoja(null)} />}
      {lightbox != null && <Visor fotos={d.galeria} i={lightbox} onI={setLightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

/* ---------- Portada ---------- */
function Portada({ o, d, T, fotos, proximo, ahora, previa, onEntradas, onComprar }) {
  const [i, setI] = useState(0);
  useEffect(() => { if (fotos.length < 2 || reducido() || !d.efectos.movimiento) return; const t = setInterval(() => setI(x => (x + 1) % fotos.length), 5200); return () => clearInterval(t); }, [fotos.length, d.efectos.movimiento]);
  const titular = (d.titular || "").trim();
  return (
    <header className="org-portada" style={{ minHeight: previa ? 720 : "min(100svh, 980px)" }}>
      {fotos.length ? fotos.map((u, k) => <img key={u + k} src={u} alt="" aria-hidden="true" loading={k ? "lazy" : "eager"} className={k === i && d.efectos.movimiento ? "pub-kb" : ""} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: k === i ? 1 : 0, transition: "opacity 1.4s ease" }} />)
        : <div style={{ position: "absolute", inset: 0, background: `radial-gradient(90% 70% at 20% 10%, ${d.color}, transparent 60%), radial-gradient(80% 60% at 90% 80%, ${d.color2}, transparent 60%), #07070b` }} />}
      <div style={{ position: "absolute", inset: 0, background: T.editorial && !T.osc ? "linear-gradient(180deg, rgba(0,0,0,.25), rgba(0,0,0,.15) 40%, rgba(0,0,0,.7))" : "linear-gradient(180deg, rgba(0,0,0,.55) 0%, rgba(0,0,0,.15) 35%, rgba(0,0,0,.35) 62%, var(--bg) 100%)" }} />
      {T.neon && <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: `radial-gradient(60% 40% at 15% 85%, ${d.color}55, transparent), radial-gradient(50% 40% at 90% 30%, ${d.color2}55, transparent)`, mixBlendMode: "screen" }} />}
      <div className="org-marco" style={{ position: "relative", zIndex: 2, flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", paddingTop: 96, paddingBottom: 30, color: "#fff" }}>
        {o.ciudad && <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: 3, textTransform: "uppercase", opacity: .85, marginBottom: 10 }}>{o.ciudad}</div>}
        <h1 className={T.neon ? "org-neon" : ""} style={{ ...T.titulo, fontSize: T.club ? "clamp(54px, 15cqw, 190px)" : "clamp(46px, 11cqw, 140px)", margin: 0, overflowWrap: "anywhere", textShadow: T.neon ? undefined : "0 4px 30px rgba(0,0,0,.4)" }}>{titular || o.nombre}</h1>
        {o.lema && <div style={{ fontSize: "clamp(18px, 2.6cqw, 26px)", fontWeight: 700, marginTop: 14, maxWidth: 760, lineHeight: 1.3, opacity: .95, fontStyle: T.editorial ? "italic" : "normal" }}>{o.lema}</div>}
        {proximo && <Proximo e={proximo} T={T} d={d} ahora={ahora} onComprar={onComprar} />}
        {!proximo && <div style={{ marginTop: 24 }}><button onClick={onEntradas} style={{ ...btn(d.color, T.tinta), padding: "16px 26px", fontSize: 17, borderRadius: T.club ? 0 : 16 }}>{d.boton || "Ver próximos eventos"}</button></div>}
      </div>
      {fotos.length > 1 && <div style={{ position: "absolute", zIndex: 3, right: 18, bottom: 22, display: "flex", gap: 6 }}>{fotos.map((_, k) => <button key={k} onClick={() => setI(k)} aria-label={`Foto ${k + 1}`} style={{ width: k === i ? 26 : 8, height: 8, borderRadius: 8, border: "none", padding: 0, background: k === i ? "#fff" : "rgba(255,255,255,.45)", cursor: "pointer", transition: "width .3s" }} />)}</div>}
    </header>
  );
}

// Tarjeta del próximo evento sobre la portada, con cuenta atrás real
function Proximo({ e, T, d, ahora, onComprar }) {
  const [t, setT] = useState(ahora);
  useEffect(() => { const x = setInterval(() => setT(v => v + 1000), 1000); return () => clearInterval(x); }, []);
  const inicio = e.inicio || e.fecha;
  const ms = inicio ? new Date(String(inicio).length <= 10 ? inicio + "T22:00" : inicio).getTime() - t : 0;
  const s = Math.max(0, Math.floor(ms / 1000));
  const partes = [[Math.floor(s / 86400), "días"], [Math.floor(s % 86400 / 3600), "h"], [Math.floor(s % 3600 / 60), "min"], [s % 60, "s"]];
  const pct = e.aforo ? Math.round(e.vendidas / e.aforo * 100) : null;
  return (
    <div className="org-proximo" style={{ marginTop: 26, borderRadius: T.club ? 0 : 22 }}>
      {e.flyer_url && <img src={e.flyer_url} alt="" style={{ width: 92, height: 92, objectFit: "cover", borderRadius: T.club ? 0 : 14, flexShrink: 0 }} />}
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase", color: d.color }}>Próximo evento</div>
        <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.1, marginTop: 3, overflowWrap: "anywhere" }}>{e.nombre}</div>
        <div style={{ fontSize: 14, opacity: .85, fontWeight: 700, marginTop: 3 }}>{cap(fecha(inicio))}{e.recinto ? ` · ${e.recinto}` : ""}</div>
        {d.fomo.ritmo && e.vendidas_24h >= 5 && <div style={{ marginTop: 6, fontSize: 13.5, fontWeight: 800, color: "#ffd166" }}>▲ {e.vendidas_24h} entradas vendidas en las últimas 24 h</div>}
        {d.fomo.quedan && pct != null && pct >= 60 && e.en_venta && <div style={{ marginTop: 6, fontSize: 13.5, fontWeight: 800, color: "#ff8a65" }}>Se agota: {pct} % vendido</div>}
      </div>
      {d.fomo.cuenta && ms > 0 && <div style={{ display: "flex", gap: 6 }} aria-label="Cuenta atrás">
        {partes.map(([v, l]) => <div key={l} style={{ minWidth: 52, textAlign: "center", background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.18)", borderRadius: T.club ? 0 : 12, padding: "8px 4px" }}>
          <div style={{ fontSize: 24, fontWeight: 900, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{String(v).padStart(2, "0")}</div><div style={{ fontSize: 11, fontWeight: 800, opacity: .75, marginTop: 3 }}>{l}</div></div>)}
      </div>}
      {e.en_venta && <button onClick={() => onComprar(e)} style={{ ...btn(d.color, T.tinta), padding: "16px 22px", fontSize: 17, borderRadius: T.club ? 0 : 14, boxShadow: `0 14px 34px -10px ${d.color}` }}>Entradas{e.desde != null ? ` · ${Number(e.desde) ? `desde ${eur(e.desde)}` : "gratis"}` : ""}</button>}
    </div>
  );
}

/* ---------- Cinta que pasa con los próximos eventos ---------- */
function Cinta({ eventos, T }) {
  const txt = eventos.map(e => `${e.nombre} · ${cap(new Date(String(e.inicio || e.fecha).length <= 10 ? (e.inicio || e.fecha) + "T12:00" : (e.inicio || e.fecha)).toLocaleDateString("es-ES", { day: "numeric", month: "short" }))}`);
  const fila = [...txt, ...txt, ...txt, ...txt];
  return (
    <div className="org-cinta" style={{ background: T.club ? "var(--c)" : "transparent", color: T.club ? T.tinta : "var(--text)" }} aria-hidden="true">
      <div className="org-cinta-pista">{fila.map((t, k) => <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 22 }}><span>{t}</span><span style={{ color: T.club ? T.tinta : "var(--c)" }}>✦</span></span>)}</div>
    </div>
  );
}

const Titulo = ({ T, eyebrow, children, id }) => (
  <div id={id} style={{ scrollMarginTop: 80, marginBottom: 22 }}>
    {eyebrow && <div style={{ fontSize: 12.5, fontWeight: 900, letterSpacing: 3, textTransform: "uppercase", color: "var(--c)", marginBottom: 8 }}>{eyebrow}</div>}
    <h2 className={T.neon ? "org-neon" : ""} style={{ ...T.titulo, fontSize: T.club ? "clamp(40px, 9cqw, 96px)" : "clamp(32px, 6cqw, 64px)", margin: 0 }}>{children}</h2>
  </div>
);

/* ---------- Próximos eventos ---------- */
function Proximos({ eventos, T, d, ahora, destacado, onEntradas, previa, carrito }) {
  return (
    <section className="org-marco org-seccion">
      <Titulo T={T} eyebrow={`${eventos.length} ${eventos.length === 1 ? "evento" : "eventos"}`} id="eventos">Próximos eventos</Titulo>
      {eventos.length === 0 ? <div style={{ ...card, textAlign: "center", color: "var(--muted)", padding: 30, borderRadius: "var(--r)" }}>Muy pronto anunciaremos nuevas fechas. Síguenos en redes para enterarte el primero.</div>
        : <div className="org-eventos">{eventos.map(e => <TarjetaEvento key={e.slug} e={e} T={T} d={d} ahora={ahora} grande={e.slug === destacado} onEntradas={onEntradas} previa={previa} enCarrito={carrito.lineas.filter(l => l.evento === e.slug).reduce((s, l) => s + l.cantidad, 0)} />)}</div>}
    </section>
  );
}
function TarjetaEvento({ e, T, d, ahora, grande, onEntradas, previa, enCarrito }) {
  const inicio = e.inicio || e.fecha;
  const dt = new Date(String(inicio).length <= 10 ? inicio + "T12:00" : inicio);
  const dias = Math.ceil((dt.getTime() - ahora) / 86400000);
  const agotado = !e.en_venta && !e.proximo && e.estado !== "cerrado" && e.aforo != null && e.vendidas >= e.aforo;
  const cerrada = e.estado === "cerrado" || (!e.en_venta && !e.proximo && !agotado);
  const lanzamiento = e.venta_inicio && new Date(e.venta_inicio).getTime() > ahora;
  const pct = e.aforo ? Math.round(e.vendidas / e.aforo * 100) : null;
  const pocas = d.fomo.quedan && e.en_venta && e.quedan != null && e.aforo && (e.quedan <= 30 || e.quedan / e.aforo <= .15);
  const etiqueta = agotado ? null : lanzamiento ? `A la venta el ${dt && new Date(e.venta_inicio).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}` : pocas ? `¡Últimas ${e.quedan}!` : d.fomo.ritmo && e.vendidas_24h >= 5 ? `${e.vendidas_24h} vendidas hoy` : dias >= 0 && dias <= 7 && e.en_venta ? (dias === 0 ? "¡Es hoy!" : dias === 1 ? "¡Mañana!" : `En ${dias} días`) : null;
  const href = previa ? undefined : `/e/${e.slug}`;
  return (
    <article className={"org-ev" + (grande ? " org-ev-grande" : "")} style={{ borderRadius: "var(--r)" }}>
      <a href={href} aria-label={`${e.nombre}, ${cap(fecha(inicio))}`} style={{ position: "relative", display: "block", aspectRatio: grande ? "16/11" : "4/5", overflow: "hidden", borderRadius: "var(--r) var(--r) 0 0", background: `linear-gradient(150deg, ${e.color || d.color}, #111)` }}>
        {e.flyer_url && <img src={e.flyer_url} alt="" loading="lazy" className="org-ev-img" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", filter: agotado || cerrada ? "grayscale(.8) brightness(.7)" : "none" }} />}
        <div style={{ position: "absolute", left: 12, top: 12, background: "rgba(0,0,0,.72)", backdropFilter: "blur(8px)", color: "#fff", borderRadius: T.club ? 0 : 14, padding: "8px 12px", textAlign: "center", lineHeight: 1 }}>
          <div style={{ fontSize: 26, fontWeight: 900 }}>{dt.getDate()}</div>
          <div style={{ fontSize: 11.5, fontWeight: 900, letterSpacing: 1.5, textTransform: "uppercase", marginTop: 3 }}>{dt.toLocaleDateString("es-ES", { month: "short" }).replace(".", "")}</div>
        </div>
        {etiqueta && <div className={pocas ? "pub-pulso" : ""} style={{ position: "absolute", right: 12, top: 12, background: pocas ? "#ff3b30" : "var(--c)", color: pocas ? "#fff" : T.tinta, borderRadius: T.club ? 0 : 30, padding: "6px 12px", fontWeight: 900, fontSize: 13 }}>{etiqueta}</div>}
        {agotado && <div className="org-sello">Agotado</div>}
        {e.borrador && <div style={{ position: "absolute", left: 12, bottom: 12, background: "#ffb400", color: "#1a1205", borderRadius: 8, padding: "3px 8px", fontWeight: 900, fontSize: 12 }}>BORRADOR</div>}
      </a>
      <div style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
        <a href={href} style={{ color: "inherit", textDecoration: "none" }}>
          <div style={{ ...T.titulo, fontSize: grande ? 30 : 22, lineHeight: 1.05, overflowWrap: "anywhere" }}>{e.nombre}</div>
          <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 14, marginTop: 5 }}>{cap(dt.toLocaleDateString("es-ES", { weekday: "long" }))}{String(inicio).length > 10 ? ` · ${String(inicio).slice(11, 16)}` : ""}{e.recinto ? ` · ${e.recinto}` : ""}{e.edad_minima ? ` · +${e.edad_minima}` : ""}</div>
        </a>
        {d.fomo.quedan && e.en_venta && pct != null && pct >= 50 && <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 800, color: "var(--muted)" }}><span style={{ flex: 1, height: 5, borderRadius: 5, background: "var(--card2)", overflow: "hidden" }}><span style={{ display: "block", width: `${Math.min(100, pct)}%`, height: "100%", background: "linear-gradient(90deg, var(--c), var(--c2))" }} /></span>{pct} %</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: "auto", paddingTop: 4 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {e.en_venta && e.desde != null ? <><div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>Desde</div><div style={{ fontSize: 22, fontWeight: 900, color: "var(--c)" }}>{Number(e.desde) ? eur(e.desde) : "Gratis"}</div></>
              : <div style={{ fontWeight: 900, color: "var(--muted)" }}>{agotado ? "Sin entradas" : lanzamiento || e.proximo ? "Próximamente" : "Venta cerrada"}</div>}
          </div>
          {e.en_venta && <button onClick={() => onEntradas(e)} style={{ ...btn(enCarrito ? "var(--card2)" : T.d.color, enCarrito ? "var(--text)" : T.tinta), padding: "13px 18px", borderRadius: T.club ? 0 : 14, border: enCarrito ? "1px solid var(--c)" : "none" }}>{enCarrito ? `✓ ${enCarrito} en el carrito` : "+ Entradas"}</button>}
        </div>
      </div>
    </article>
  );
}

/* ---------- Galería: mosaico o carrusel ---------- */
function GaleriaOrg({ fotos, estilo, T, onAbrir }) {
  return (
    <section className="org-seccion" id="galeria" style={{ scrollMarginTop: 80 }}>
      <div className="org-marco"><Titulo T={T} eyebrow="Galería">Así se vive</Titulo></div>
      {estilo === "carrusel"
        ? <div className="org-carrusel">{fotos.map((u, k) => <button key={u + k} onClick={() => onAbrir(k)} aria-label={`Ampliar foto ${k + 1}`} style={{ borderRadius: "var(--r)" }}><img src={u} alt="" loading="lazy" /></button>)}</div>
        : <div className="org-marco"><div className="org-mosaico">{fotos.map((u, k) => <button key={u + k} onClick={() => onAbrir(k)} aria-label={`Ampliar foto ${k + 1}`} className={k % 7 === 0 ? "org-m-gr" : k % 7 === 4 ? "org-m-al" : ""} style={{ borderRadius: "var(--r)" }}><img src={u} alt="" loading="lazy" /></button>)}</div></div>}
    </section>
  );
}
function Visor({ fotos, i, onI, onClose }) {
  useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowRight") onI((i + 1) % fotos.length); if (e.key === "ArrowLeft") onI((i - 1 + fotos.length) % fotos.length); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [i]);
  const f = { position: "absolute", top: "50%", transform: "translateY(-50%)", width: 48, height: 48, borderRadius: 48, border: "none", background: "rgba(255,255,255,.14)", color: "#fff", fontSize: 26, cursor: "pointer" };
  return createPortal(
    <div role="dialog" aria-label="Foto ampliada" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(0,0,0,.94)", display: "grid", placeItems: "center", padding: 16 }}>
      <img src={fotos[i]} alt="" style={{ maxWidth: "100%", maxHeight: "88vh", objectFit: "contain", borderRadius: 10 }} />
      <button onClick={(e) => { e.stopPropagation(); onI((i - 1 + fotos.length) % fotos.length); }} aria-label="Foto anterior" style={{ ...f, left: 12 }}>‹</button>
      <button onClick={(e) => { e.stopPropagation(); onI((i + 1) % fotos.length); }} aria-label="Foto siguiente" style={{ ...f, right: 12 }}>›</button>
      <button onClick={onClose} aria-label="Cerrar" style={{ ...f, top: 30, right: 14, transform: "none", fontSize: 20 }}>✕</button>
      <div style={{ position: "absolute", bottom: 20, color: "#fff", fontWeight: 800, opacity: .8 }}>{i + 1} / {fotos.length}</div>
    </div>, document.body);
}

/* ---------- Sobre nosotros ---------- */
function Sobre({ o, T }) {
  return (
    <section className="org-marco org-seccion">
      <div className="org-sobre">
        <div>
          <Titulo T={T} eyebrow="Sobre nosotros">{o.nombre}</Titulo>
          {o.descripcion && <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7, fontSize: 17, opacity: .92, fontFamily: T.editorial ? LETRA.serif : "inherit" }}>{o.descripcion}</div>}
        </div>
        {o.logo_url && <div style={{ display: "grid", placeItems: "center", background: "var(--card)", border: "1px solid var(--line)", borderRadius: "var(--r)", padding: 30, minHeight: 200 }}><img src={o.logo_url} alt={o.nombre} style={{ maxWidth: "80%", maxHeight: 180, objectFit: "contain" }} /></div>}
      </div>
    </section>
  );
}

/* ---------- Ediciones pasadas (te lo perdiste) ---------- */
function Pasados({ pasados, T }) {
  return (
    <section className="org-seccion">
      <div className="org-marco"><Titulo T={T} eyebrow="Ediciones pasadas">Te lo perdiste</Titulo></div>
      <div className="org-carrusel org-pasados">
        {pasados.map(p => (
          <a key={p.slug} href={`/e/${p.slug}`} style={{ borderRadius: "var(--r)" }}>
            <img src={p.flyer_url} alt="" loading="lazy" />
            <span><b>{p.nombre}</b><br />{cap(fecha(p.fecha, false))}</span>
          </a>))}
      </div>
    </section>
  );
}

/* ---------- Reservados VIP ---------- */
function Vip({ vip, o, T }) {
  const tel = String(vip.whatsapp || "").replace(/[^\d]/g, "").replace(/^(?=[67]\d{8}$)/, "34");
  if (!tel && !vip.texto) return null;
  return (
    <section className="org-marco org-seccion">
      <div className="org-vip" style={{ borderRadius: "var(--r)" }}>
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 900, letterSpacing: 3, textTransform: "uppercase", opacity: .85 }}>Experiencia VIP</div>
          <div style={{ ...T.titulo, fontSize: "clamp(32px, 6cqw, 60px)", marginTop: 6 }}>{vip.titulo || "Reservados VIP"}</div>
          {vip.texto && <div style={{ marginTop: 10, fontSize: 17, lineHeight: 1.55, opacity: .92, whiteSpace: "pre-wrap" }}>{vip.texto}</div>}
        </div>
        {tel && <a href={`https://wa.me/${tel}?text=${encodeURIComponent(`Hola, quiero información de reservados en ${o.nombre}.`)}`} target="_blank" rel="noopener noreferrer" style={{ ...btn("#fff", "#111"), padding: "17px 24px", fontSize: 17, textDecoration: "none", borderRadius: T.club ? 0 : 16 }}><IcoRed n="whatsapp" c="#25d366" />{vip.boton || "Reservar por WhatsApp"}</a>}
      </div>
    </section>
  );
}

/* ---------- Ubicación ---------- */
function Ubicacion({ u, T }) {
  const mapa = u.maps || (u.direccion ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(u.direccion)}` : "");
  return (
    <section className="org-marco org-seccion" id="ubicacion" style={{ scrollMarginTop: 80 }}>
      <Titulo T={T} eyebrow="Dónde estamos">Ven a vernos</Titulo>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
        {u.direccion && <div style={{ ...card, borderRadius: "var(--r)", padding: 22 }}><div style={{ fontSize: 12.5, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase", color: "var(--c)" }}>Dirección</div><div style={{ fontSize: 19, fontWeight: 800, marginTop: 8, lineHeight: 1.4 }}>{u.direccion}</div>
          {mapa && <a href={mapa} target="_blank" rel="noopener noreferrer" style={{ ...btn("var(--card2)", "var(--text)"), marginTop: 14, textDecoration: "none", border: "1px solid var(--line)" }}>Cómo llegar →</a>}</div>}
        {u.horario && <div style={{ ...card, borderRadius: "var(--r)", padding: 22 }}><div style={{ fontSize: 12.5, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase", color: "var(--c)" }}>Horario</div><div style={{ fontSize: 17, fontWeight: 700, marginTop: 8, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{u.horario}</div></div>}
      </div>
    </section>
  );
}

/* ---------- Preguntas frecuentes ---------- */
function Faq({ faq, T }) {
  return (
    <section className="org-marco org-seccion">
      <Titulo T={T} eyebrow="Antes de venir">Preguntas frecuentes</Titulo>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 860 }}>
        {faq.map((x, i) => <details key={i} className="org-faq" style={{ borderRadius: "var(--r)" }}><summary>{x.p}</summary><div style={{ padding: "0 18px 18px", lineHeight: 1.6, opacity: .9, whiteSpace: "pre-wrap" }}>{x.r}</div></details>)}
      </div>
    </section>
  );
}

/* ---------- Pie con redes ---------- */
const REDES = [
  { k: "instagram", t: "Instagram", url: (v) => /^https?:/.test(v) ? v : `https://instagram.com/${v.replace(/^@/, "")}` },
  { k: "tiktok", t: "TikTok", url: (v) => /^https?:/.test(v) ? v : `https://www.tiktok.com/@${v.replace(/^@/, "")}` },
  { k: "whatsapp", t: "WhatsApp", url: (v) => `https://wa.me/${v.replace(/[^\d]/g, "").replace(/^(?=[67]\d{8}$)/, "34")}` },
  { k: "spotify", t: "Spotify", url: (v) => v },
  { k: "web", t: "Web", url: (v) => /^https?:/.test(v) ? v : `https://${v}` },
  { k: "email", t: "Correo", url: (v) => `mailto:${v}` },
  { k: "telefono", t: "Teléfono", url: (v) => `tel:${v.replace(/[^\d+]/g, "")}` },
];
export const REDES_ORG = REDES;
function Pie({ o, d, T }) {
  const redes = REDES.filter(r => String(d.redes?.[r.k] || "").trim());
  return (
    <footer className="org-marco" style={{ padding: "50px 0 30px", borderTop: "1px solid var(--line)", marginTop: 30 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", justifyContent: "space-between" }}>
        <div style={{ minWidth: 0 }}>
          {o.logo_url ? <img src={o.logo_url} alt={o.nombre} style={{ height: 44, maxWidth: 180, objectFit: "contain" }} /> : <div style={{ ...T.titulo, fontSize: 28 }}>{o.nombre}</div>}
          {o.lema && <div style={{ color: "var(--muted)", marginTop: 6, fontWeight: 600 }}>{o.lema}</div>}
        </div>
        {redes.length > 0 && <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {redes.map(r => <a key={r.k} href={r.url(String(d.redes[r.k]).trim())} target={r.k === "email" || r.k === "telefono" ? undefined : "_blank"} rel="noopener noreferrer" aria-label={r.t} title={r.t}
            style={{ width: 48, height: 48, borderRadius: T.club ? 0 : 48, display: "grid", placeItems: "center", background: "var(--card)", border: "1px solid var(--line)", color: "var(--text)" }}><IcoRed n={r.k} /></a>)}
        </div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--muted)", fontSize: 12.5, fontWeight: 700, marginTop: 28 }}>Entradas con <img src="/brand/tixfast_isotipo_app.svg" alt="TIXFAST" width="16" height="16" /></div>
    </footer>
  );
}
function Cabecera({ o, T }) {
  return <a href={`/o/${o.slug}`} style={{ display: "flex", alignItems: "center", gap: 10, color: "inherit", textDecoration: "none", marginBottom: 6 }}>
    {o.logo_url ? <img src={o.logo_url} alt="" style={{ height: 36, maxWidth: 140, objectFit: "contain" }} /> : <b style={{ ...T.titulo, fontSize: 22 }}>{o.nombre}</b>}
  </a>;
}

const RED_PATH = {
  instagram: "M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zm5 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm5.5-1.5h.01",
  tiktok: "M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.5 2.5 2.5 4.5 5 5",
  whatsapp: "M4 20l1.3-3.9A8 8 0 1 1 8 19L4 20zM9 9c0 3 3 6 6 6l1.2-1.4-2-1-1 .8a5 5 0 0 1-2.6-2.6l.8-1-1-2L9 9z",
  spotify: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM7.5 9.5c3-1 6.5-.7 9 .8M8 12.5c2.5-.7 5.3-.4 7.3.7M8.5 15.3c2-.5 4-.3 5.6.6",
  web: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z",
  email: "M3 6h18v12H3zM3 7l9 6 9-6",
  telefono: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z",
};
export const IcoRed = ({ n, c = "currentColor", s = 20 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={RED_PATH[n] || RED_PATH.web} /></svg>;

/* ---------- Estilos del microsite ---------- */
const CSS_ORG = `
.org-marco{max-width:1180px;margin:0 auto;padding-left:20px;padding-right:20px}
.org-seccion{padding-top:72px}
.org-nav{position:fixed;top:0;left:0;right:0;z-index:40;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 18px;padding-top:max(12px,env(safe-area-inset-top));color:#fff;transition:background .3s,backdrop-filter .3s,border-color .3s;border-bottom:1px solid transparent}
.org-nav-on{background:color-mix(in srgb,var(--bg) 82%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);color:var(--text);border-bottom-color:var(--line)}
.org-navlink{background:transparent;border:none;color:inherit;font:inherit;font-weight:800;font-size:14.5px;padding:10px 12px;cursor:pointer;opacity:.9}
.org-portada{position:relative;display:flex;flex-direction:column;overflow:hidden;isolation:isolate}
.org-proximo{display:flex;align-items:center;gap:16px;flex-wrap:wrap;background:rgba(10,10,14,.55);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.16);padding:16px;max-width:900px}
.org-cinta{overflow:hidden;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:16px 0;font-weight:900;font-size:clamp(18px,3.4cqw,30px);text-transform:uppercase;letter-spacing:-.01em;white-space:nowrap;position:relative;z-index:2}
.org-cinta-pista{display:inline-flex;gap:22px;animation:orgCinta 40s linear infinite;padding-left:22px}
@keyframes orgCinta{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.org-eventos{display:grid;grid-template-columns:minmax(0,1fr);grid-auto-flow:dense;gap:18px}
@container pub (min-width:640px){.org-eventos{grid-template-columns:repeat(2,minmax(0,1fr))}}
@container pub (min-width:980px){.org-eventos{grid-template-columns:repeat(3,minmax(0,1fr))}.org-ev-grande{grid-column:span 2}}
.org-ev{display:flex;flex-direction:column;background:var(--card);border:1px solid var(--line);overflow:hidden;transition:transform .25s,box-shadow .25s,border-color .25s}
.org-ev:hover{transform:translateY(-4px);border-color:color-mix(in srgb,var(--c) 60%,transparent);box-shadow:0 24px 60px -24px var(--c)}
.org-ev:hover .org-ev-img{transform:scale(1.04)}
.org-ev-img{transition:transform .6s ease}
.org-sello{position:absolute;inset:0;display:grid;place-items:center;font-weight:900;font-size:clamp(30px,7cqw,54px);letter-spacing:.06em;text-transform:uppercase;color:#fff;text-shadow:0 2px 20px rgba(0,0,0,.6);transform:rotate(-12deg)}
.org-mosaico{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:150px;grid-auto-flow:dense;gap:10px}
@container pub (min-width:760px){.org-mosaico{grid-template-columns:repeat(4,minmax(0,1fr));grid-auto-rows:210px;gap:14px}}
.org-mosaico button,.org-carrusel button,.org-carrusel a{position:relative;display:block;border:none;padding:0;overflow:hidden;cursor:zoom-in;background:#000}
.org-mosaico img,.org-carrusel img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .6s ease}
.org-mosaico button:hover img,.org-carrusel button:hover img{transform:scale(1.05)}
.org-m-gr{grid-column:span 2;grid-row:span 2}
.org-m-al{grid-row:span 2}
.org-carrusel{display:flex;gap:14px;overflow-x:auto;scroll-snap-type:x mandatory;padding:0 20px 8px;scrollbar-width:none}
.org-carrusel::-webkit-scrollbar{display:none}
.org-carrusel>*{flex:0 0 min(78%,420px);aspect-ratio:4/5;scroll-snap-align:center}
.org-pasados>*{flex-basis:min(46%,240px);cursor:pointer}
.org-pasados img{filter:grayscale(1) brightness(.7);transition:filter .4s}
.org-pasados a:hover img{filter:none}
.org-pasados span{position:absolute;left:0;right:0;bottom:0;padding:30px 12px 12px;background:linear-gradient(transparent,rgba(0,0,0,.85));color:#fff;font-size:13px;font-weight:700;line-height:1.3;text-align:left}
.org-sobre{display:grid;grid-template-columns:minmax(0,1fr);gap:26px;align-items:center}
@container pub (min-width:860px){.org-sobre{grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:50px}}
.org-vip{display:flex;align-items:center;gap:24px;flex-wrap:wrap;padding:clamp(24px,5cqw,52px);color:#fff;background:radial-gradient(120% 120% at 0% 0%,var(--c),transparent 60%),radial-gradient(120% 120% at 100% 100%,var(--c2),transparent 55%),#0d0b12;border:1px solid rgba(255,255,255,.12)}
.org-faq{background:var(--card);border:1px solid var(--line)}
.org-faq summary{cursor:pointer;padding:18px;font-weight:800;font-size:17px;list-style:none;display:flex;justify-content:space-between;gap:12px}
.org-faq summary::after{content:"+";font-size:22px;line-height:1;color:var(--c)}
.org-faq[open] summary::after{content:"−"}
.org-faq summary::-webkit-details-marker{display:none}
.org-grano{inset:0;z-index:50;pointer-events:none;opacity:.07;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.org-neon{background:linear-gradient(92deg,#fff 10%,var(--c) 45%,var(--c2) 85%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 22px color-mix(in srgb,var(--c) 55%,transparent))}
.org-club .org-ev{border-width:2px;border-color:var(--text)}
.org-editorial .org-ev{box-shadow:none}
.pub-hoja{animation:orgSube .28s cubic-bezier(.2,.8,.2,1)}
@keyframes orgSube{from{transform:translateY(30px);opacity:0}to{transform:none;opacity:1}}
@media (prefers-reduced-motion:reduce){.org-cinta-pista,.pub-hoja{animation:none}.org-ev,.org-ev-img,.org-mosaico img{transition:none}}
`;

/* ---------- «Más fiestas de…» en la página de cada evento ---------- */
export function MasFiestas({ org, actual, T, carrito, onEntradas }) {
  const [evs, setEvs] = useState(null);
  useEffect(() => {
    supabase.rpc("web_organizacion_publica", { p_slug: org.slug }).then(({ data }) => {
      const ocultos = new Set(data?.diseno?.ocultos || []);
      setEvs((data?.eventos || []).filter(e => e.slug !== actual && !ocultos.has(e.slug) && (e.en_venta || e.proximo)));
    }).catch(() => setEvs([]));
  }, [org.slug, actual]);
  if (!evs || !evs.length) return null;
  return (
    <section style={{ ...card, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
        <h2 style={{ fontSize: 20, margin: 0, fontWeight: 900 }}>Más fiestas de {org.nombre}</h2>
        <a href={`/o/${org.slug}`} style={{ color: "var(--c)", fontWeight: 800, fontSize: 14, whiteSpace: "nowrap" }}>Ver todas →</a>
      </div>
      <div style={{ fontSize: 13.5, color: "var(--muted)", marginBottom: 12 }}>Añade entradas de varias fiestas y págalas juntas con un solo formulario.</div>
      <div style={{ display: "flex", gap: 12, overflowX: "auto", scrollSnapType: "x mandatory", scrollbarWidth: "none", paddingBottom: 4 }}>
        {evs.map(e => { const n = carrito.lineas.filter(l => l.evento === e.slug).reduce((s, l) => s + l.cantidad, 0); const ini = e.inicio || e.fecha; return (
          <div key={e.slug} style={{ flex: "0 0 min(70%, 230px)", scrollSnapAlign: "start", display: "flex", flexDirection: "column", background: "var(--card2)", border: "1px solid var(--line)", borderRadius: 16, overflow: "hidden" }}>
            <a href={`/e/${e.slug}`} style={{ display: "block", aspectRatio: "1/1", background: `linear-gradient(150deg, ${e.color || "var(--c)"}, #111)` }}>{e.flyer_url && <img src={e.flyer_url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}</a>
            <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
              <a href={`/e/${e.slug}`} style={{ color: "inherit", textDecoration: "none" }}>
                <div style={{ fontWeight: 900, lineHeight: 1.15, overflowWrap: "anywhere" }}>{e.nombre}</div>
                <div style={{ color: "var(--muted)", fontSize: 13, fontWeight: 700, marginTop: 3 }}>{cap(fecha(ini, false))}</div>
              </a>
              {e.en_venta ? <button onClick={() => onEntradas(e.slug)} style={{ ...btn(n ? "transparent" : T.d.color, n ? "var(--text)" : T.tinta), marginTop: "auto", padding: "11px 12px", fontSize: 14.5, border: n ? "1px solid var(--c)" : "none" }}>{n ? `✓ ${n} en el carrito` : `+ Entradas${e.desde != null ? ` · ${Number(e.desde) ? eur(e.desde) : "gratis"}` : ""}`}</button>
                : <div style={{ marginTop: "auto", fontWeight: 800, color: "var(--muted)", fontSize: 14 }}>Próximamente</div>}
            </div>
          </div>); })}
      </div>
    </section>
  );
}

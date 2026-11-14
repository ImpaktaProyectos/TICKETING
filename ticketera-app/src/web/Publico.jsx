// ===================== PÁGINA PÚBLICA DE VENTA =====================
// /e/<enlace>            → página del evento: flyer, tramos, cuenta atrás y compra
// /mis-entradas/<acceso> → las entradas del comprador con su QR y el PDF
// No necesita sesión. Solo habla con las funciones públicas del servidor (nunca con las tablas).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabase";
import { avisosDe } from "./avisos";
import QrCodigo from "../qr/QrCodigo";
import { textoQR, money, eur, fecha, hora, tema, Mensaje, MIS, cap, reducido, Diapositivas, Galeria, card, btn, Chip, Aviso, Linea, Tramo, CuentaAtras, AvisosCompra, PruebaSocial, CAMPOS, ERRORES, lbl, inpP, Campo, Check, CSS_PUB, InfoPrivacidad, PRIVACIDAD_VERSION } from "./comun";
export { textoQR } from "./comun";
import { useCarrito, BarraCarrito, HojaCarrito, ElegirEntradas, CompraVarios } from "./Carrito";
import PaginaOrganizacion, { MasFiestas } from "./Microsite";
import { codigoRP } from "./rrppEnlace";
const PanelRRPP = React.lazy(() => import("./PanelRRPP"));

export default function Publico() {
  const m = window.location.pathname.match(/^\/(e|o|mis-entradas|compra|rp)\/([^/?#]+)/);
  if (!m) return <Mensaje titulo="Página no encontrada" />;
  const v = decodeURIComponent(m[2]);
  if (m[1] === "e") return <PaginaEvento slug={v.toLowerCase()} />;
  if (m[1] === "o") return <PaginaOrganizacion slug={v.toLowerCase()} />;
  if (m[1] === "compra") return <MisCompra acceso={v} />;
  if (m[1] === "rp") return <React.Suspense fallback={<Mensaje titulo="Cargando tu panel…" />}><PanelRRPP acceso={v} /></React.Suspense>;
  return <MisEntradas acceso={v} />;
}

/* ===================== Página del evento ===================== */
function PaginaEvento({ slug }) {
  const [ev, setEv] = useState(undefined);       // undefined = cargando · null = no existe
  const [error, setError] = useState(false);
  const [org, setOrg] = useState(null);          // organización del evento (microsite y carrito)
  const offset = useRef(0);                      // diferencia reloj servidor - móvil
  useEffect(() => { supabase.rpc("web_evento_organizacion", { p_slug: slug }).then(({ data }) => setOrg(data || null)).catch(() => {}); }, [slug]);

  const cargar = async () => {
    try {
      const { data, error: e } = await supabase.rpc("web_evento_publico", { p_slug: slug });
      if (e) throw e;
      if (data?.ahora) offset.current = new Date(data.ahora).getTime() - Date.now();
      setEv(data || null); setError(false);
    } catch { setError(true); }
  };
  // En directo: cada 20 s mientras la página está a la vista (las cifras de lo que queda bajan con cada venta real)
  useEffect(() => {
    cargar();
    const t = setInterval(() => { if (document.visibilityState !== "hidden") cargar(); }, 20000);
    const vis = () => { if (document.visibilityState === "visible") cargar(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [slug]);
  useEffect(() => { if (ev?.nombre) document.title = `${ev.nombre} · Entradas`; }, [ev?.nombre]);

  if (ev === undefined && !error) return <Mensaje titulo="Cargando…" />;
  if (error && !ev) return <Mensaje titulo="No se ha podido cargar" texto="Revisa tu conexión e inténtalo de nuevo."><button onClick={cargar} style={btn("#ff5a3c", "#fff")}>Reintentar</button></Mensaje>;
  if (!ev) return <Mensaje titulo="Este evento no está disponible" texto="Puede que el enlace no sea correcto o que la venta aún no esté publicada." />;
  return <Landing ev={ev} org={org} offset={offset.current} onRecargar={cargar} />;
}

/* Plantillas de la página (se eligen en CRM › Entradas › Diseño) */
export const PLANTILLAS_WEB = [
  { k: "clasica", t: "Clásica", sub: "Flyer al lado y entradas a la vista" },
  { k: "inmersiva", t: "Inmersiva", sub: "Fotos a pantalla completa, tipo cine" },
  { k: "festival", t: "Festival", sub: "Galería arriba, line-up y mucha energía" },
  { k: "minimal", t: "Minimal", sub: "Limpia y elegante, una columna" },
];

// La página completa a partir de los datos del evento. «previa»: dentro del CRM (sin compras ni lecturas del móvil)
export function Landing({ ev, org = null, offset = 0, onRecargar = () => {}, previa = false }) {
  const [cantLocal, setCant] = useState({});     // { tramoId: n } (evento sin organización)
  const [paso, setPaso] = useState("elegir");    // elegir | datos | varios
  const [hoja, setHoja] = useState(null);        // null | "carrito" | { evento }
  // Con organización, las entradas van a su carrito (compartido con su microsite y sus otros eventos)
  const carrito = useCarrito(org && !previa ? org.slug : null);
  const conCarrito = !!(org && !previa);
  const [entradasVisibles, setEntradasVisibles] = useState(false);
  const raiz = useRef(null);
  const T = tema(ev.diseno);
  const plantilla = PLANTILLAS_WEB.some(p => p.k === T.d.plantilla) ? T.d.plantilla : "clasica";
  const ahora = Date.now() + offset;
  const lanzamiento = ev.venta_inicio && new Date(ev.venta_inicio).getTime() > ahora;
  const tramos = ev.tramos || [];
  const enVenta = tramos.filter(t => t.estado === "venta");
  const av = avisosDe(ev.avisos);
  // «El más elegido»: el tramo en venta con más ventas (mínimo 5), si hay más de uno a elegir
  const topId = av.masVendido && enVenta.length > 1 ? (() => { const m = [...enVenta].sort((a, b) => (b.vendidas || 0) - (a.vendidas || 0))[0]; return (m?.vendidas || 0) >= 5 ? m.id : null; })() : null;
  const cant = conCarrito ? Object.fromEntries(tramos.map(t => [t.id, carrito.de(ev.slug, t.id)])) : cantLocal;
  const ponerN = (t, n) => conCarrito ? carrito.poner(ev, t, n) : setCant(c => ({ ...c, [t.id]: n }));
  const total = tramos.reduce((s, t) => s + (cant[t.id] || 0) * Number(t.precio), 0);
  const nEnt = Object.values(cant).reduce((s, n) => s + n, 0);
  const cerrado = ev.estado === "cerrado" || (ev.fin && new Date(ev.fin).getTime() < ahora);
  const abierta = !lanzamiento && !cerrado && enVenta.length > 0;
  const desde = enVenta.length ? Math.min(...enVenta.map(t => Number(t.precio) || 0)) : null;
  const fotos = (Array.isArray(T.d.galeria) ? T.d.galeria : []).filter(Boolean);
  const lineup = String(T.d.lineup || "").split(/\n+/).map(s => s.trim()).filter(Boolean);
  const textoBoton = (T.d.textoBoton || "").trim() || "Comprar entradas";
  const misPedidos = previa ? [] : (() => { try { return (JSON.parse(localStorage.getItem(MIS) || "[]") || []).filter(p => p.slug === ev.slug); } catch { return []; } })();
  const irAEntradas = () => raiz.current?.querySelector("#entradas")?.scrollIntoView({ behavior: "smooth", block: "start" });

  // La barra «Comprar» se esconde mientras las entradas ya están a la vista
  useEffect(() => {
    const els = [...(raiz.current?.querySelectorAll("#entradas, [data-cta]") || [])]; if (!els.length || typeof IntersectionObserver === "undefined") return;
    const vistos = new Set();
    const io = new IntersectionObserver((xs) => { xs.forEach(x => x.isIntersecting ? vistos.add(x.target) : vistos.delete(x.target)); setEntradasVisibles(vistos.size > 0); }, { threshold: .12 });
    els.forEach(e => io.observe(e)); return () => io.disconnect();
  }, [paso, plantilla, abierta]);

  const avisos = <>
    {ev.vista_previa && !previa && <Aviso c="#ffb400">Vista previa: solo tú ves esta página. Las compras son de prueba.</Aviso>}
    {!ev.vista_previa && ev.modo === "pruebas" && <Aviso c="#ffb400">Venta de prueba: las entradas que se emiten no son válidas.</Aviso>}
  </>;
  const datos = (grande) => <>
    <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: grande ? 17 : 16 }}>
      <Linea ico="cal">{cap(fecha(ev.inicio || ev.fecha))}{ev.fin ? ` · hasta las ${hora(ev.fin)}` : ""}</Linea>
      {(ev.recinto || ev.direccion) && <Linea ico="pin">{[ev.recinto, ev.direccion].filter(Boolean).join(" · ")}{ev.maps_url && <> · <a href={ev.maps_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--c)", fontWeight: 800 }}>Cómo llegar</a></>}</Linea>}
    </div>
    {(ev.edad_minima || ev.vestimenta) && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
      {ev.edad_minima ? <Chip>+{ev.edad_minima} años</Chip> : null}
      {ev.vestimenta ? <Chip>Vestimenta: {ev.vestimenta}</Chip> : null}
    </div>}
  </>;
  const titulo = (size) => <h1 style={{ fontSize: size || "clamp(30px, 6cqw, 48px)", lineHeight: 1.02, letterSpacing: "-.03em", margin: "4px 0 12px", fontWeight: 900, overflowWrap: "anywhere" }}>{ev.nombre}</h1>;
  const lema = T.d.lema ? <div style={{ fontSize: 18, fontWeight: 700, opacity: .9, marginBottom: 14, lineHeight: 1.35 }}>{T.d.lema}</div> : null;
  const boton = (extra) => abierta ? <button data-cta onClick={irAEntradas} style={{ ...btn(T.d.color, T.tinta), padding: "17px 24px", fontSize: 18, flexWrap: "wrap", rowGap: 2, maxWidth: "100%", boxShadow: `0 14px 34px -10px ${T.d.color}`, ...extra }}>{textoBoton}{desde != null && <span style={{ opacity: .85, fontWeight: 800 }}>· {desde ? `desde ${eur(desde)}` : "gratis"}</span>}</button> : null;
  const flyer = (radio = 20) => ev.flyer_url ? <img src={ev.flyer_url} alt={`Cartel de ${ev.nombre}`} style={{ width: "100%", display: "block", borderRadius: radio, boxShadow: "0 30px 60px -20px rgba(0,0,0,.6)" }} />
    : <div style={{ aspectRatio: "4/5", borderRadius: radio, background: `linear-gradient(150deg, ${T.d.color}, #111)` }} />;

  // Bloque de compra: cuenta atrás, venta cerrada, tramos o formulario
  const compra = (
    <section id="entradas" style={{ scrollMarginTop: 16 }}>
      {misPedidos.length > 0 && <div style={{ ...card, marginBottom: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ flex: 1, minWidth: 180, fontWeight: 700 }}>Ya tienes entradas para este evento en este móvil.</span>
        <a href={`/mis-entradas/${misPedidos[0].acceso}`} style={{ ...btn("var(--card2)", "var(--text)"), textDecoration: "none", border: "1px solid var(--line)" }}>Ver mis entradas</a>
      </div>}
      {lanzamiento ? <CuentaAtras hasta={ev.venta_inicio} offset={offset} color={T.d.color} onFin={onRecargar} />
        : cerrado ? <div style={{ ...card, textAlign: "center", fontWeight: 800, fontSize: 18 }}>La venta online ha terminado.</div>
        : paso === "elegir" ? (<>
          <h2 style={{ fontSize: 24, margin: "0 0 12px", fontWeight: 900 }}>Entradas</h2>
          {tramos.length === 0 && <div style={card}>Aún no hay entradas a la venta.</div>}
          <PruebaSocial ev={ev} avisos={av} offset={offset} />
          {tramos.map((t, i) => <Tramo key={t.id} t={t} sig={tramos.slice(i + 1).find(x => x.estado === "proximo")} avisos={av} n={cant[t.id] || 0} T={T}
            offset={offset} top={t.id === topId} onFin={onRecargar} onN={(n) => ponerN(t, n)} />)}
          {enVenta.length === 0 && tramos.length > 0 && <div style={{ ...card, marginTop: 8, fontWeight: 700 }}>Ahora mismo no hay entradas a la venta.</div>}
          {av.confianza && <div style={{ display: "flex", gap: "6px 14px", flexWrap: "wrap", justifyContent: "center", fontSize: 12.5, color: "var(--muted)", fontWeight: 700, marginTop: 6 }}>
            <span>✓ Entrada nominativa con QR</span><span>✓ QR de un solo uso</span><span>✓ Al momento en tu móvil y tu correo</span>
          </div>}
        </>) : paso === "varios" ? <CompraVarios org={org} carrito={carrito} T={T} onVolver={() => setPaso("elegir")} />
        : <Formulario ev={ev} tramos={tramos} cant={cant} total={total} T={T} onVolver={() => setPaso("elegir")} onExito={() => conCarrito && carrito.quitarEvento(ev.slug)} />}
    </section>
  );
  const extras = <>
    {org && !previa && <MasFiestas org={org} actual={ev.slug} T={T} carrito={carrito} onEntradas={(slug) => setHoja({ evento: slug })} />}
    {lineup.length > 0 && <section style={{ ...card, padding: 20 }}>
      <h2 style={{ fontSize: 13, margin: "0 0 12px", fontWeight: 900, letterSpacing: 2.4, textTransform: "uppercase", color: "var(--c)" }}>Line-up</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", alignItems: "baseline" }}>
        {lineup.map((a, i) => <span key={i} style={{ fontSize: i === 0 ? "clamp(26px,5cqw,38px)" : "clamp(19px,3.4cqw,26px)", fontWeight: 900, letterSpacing: "-.02em", textTransform: "uppercase", lineHeight: 1.1 }}>{a}</span>)}
      </div>
    </section>}
    {ev.descripcion && <section style={card}><h2 style={{ fontSize: 18, margin: "0 0 8px", fontWeight: 900 }}>Sobre el evento</h2><div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, opacity: .92 }}>{ev.descripcion}</div></section>}
    {ev.autorizacion_url && <section style={card}>
      <b>¿Vienen menores de {ev.autorizacion_edad || 16} años?</b>
      <div style={{ color: "var(--muted)", marginTop: 4, lineHeight: 1.45 }}>Descarga la autorización, imprímela, rellénala y tráela firmada el día del evento.</div>
      <a href={ev.autorizacion_url} target="_blank" rel="noopener noreferrer" style={{ ...btn("var(--card2)", "var(--text)"), display: "inline-flex", marginTop: 10, textDecoration: "none", border: "1px solid var(--line)" }}>Descargar autorización (PDF)</a>
    </section>}
  </>;
  const cabecera = (sobreFoto) => (
    <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14, color: sobreFoto ? "#fff" : "inherit" }}>
      {org && !previa ? <a href={`/o/${org.slug}`} style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "inherit", textDecoration: "none", fontWeight: 800, fontSize: 14, minWidth: 0 }}>
          {org.logo_url ? <img src={org.logo_url} alt="" style={{ height: 34, maxWidth: 120, objectFit: "contain" }} /> : <span aria-hidden="true">←</span>}<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{org.logo_url ? "" : org.nombre}</span>
        </a>
        : ev.logo_url ? <img src={ev.logo_url} alt="" style={{ height: 40, maxWidth: 180, objectFit: "contain" }} /> : <span />}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: sobreFoto ? "rgba(255,255,255,.8)" : "var(--muted)", fontWeight: 700 }}>Entradas con <img src="/brand/tixfast_isotipo_app.svg" alt="TIXFAST" width="18" height="18" /></span>
    </header>
  );
  const marco = { maxWidth: 1120, margin: "0 auto", padding: "0 16px" };
  const pie = { paddingBottom: "calc(130px + env(safe-area-inset-bottom))" };

  // Al rellenar los datos, la página se centra solo en la compra
  let cuerpo;
  if (paso === "datos" || paso === "varios") cuerpo = (
    <div style={{ ...marco, maxWidth: 640, paddingTop: "max(14px, env(safe-area-inset-top))", ...pie }}>
      {cabecera(false)}{avisos}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 6 }}>
        {ev.flyer_url && <img src={ev.flyer_url} alt="" style={{ width: 56, height: 56, borderRadius: 12, objectFit: "cover" }} />}
        <div style={{ minWidth: 0 }}><div style={{ fontWeight: 900, fontSize: 20, overflowWrap: "anywhere" }}>{ev.nombre}</div><div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 14 }}>{cap(fecha(ev.inicio || ev.fecha))}</div></div>
      </div>
      {compra}
    </div>);
  else if (plantilla === "inmersiva") cuerpo = (<>
    <section style={{ position: "relative", minHeight: previa ? 700 : "min(92svh, 860px)", display: "flex", flexDirection: "column", color: "#fff", overflow: "hidden" }}>
      <Diapositivas fotos={fotos.length ? fotos : ev.flyer_url ? [ev.flyer_url] : []} color={T.d.color} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,.55) 0%, rgba(0,0,0,.1) 35%, rgba(0,0,0,.25) 60%, var(--bg) 100%)" }} />
      <div style={{ ...marco, width: "100%", position: "relative", flex: 1, display: "flex", flexDirection: "column", paddingTop: "max(14px, env(safe-area-inset-top))", paddingBottom: 28 }}>
        {cabecera(true)}{avisos}
        <div style={{ marginTop: "auto", display: "flex", gap: 22, alignItems: "flex-end" }}>
          {ev.flyer_url && fotos.length > 0 && <div className="pub-solo-ancho" style={{ width: 210, flexShrink: 0 }}>{flyer(16)}</div>}
          <div style={{ minWidth: 0, textShadow: "0 2px 18px rgba(0,0,0,.45)" }}>
            {titulo("clamp(40px, 9cqw, 92px)")}
            {lema}
            <div style={{ color: "#fff" }}>{datos(true)}</div>
            <div style={{ marginTop: 20 }}>{boton()}</div>
          </div>
        </div>
      </div>
    </section>
    <div style={{ ...marco, ...pie }}>
      <div className="pub-dos" style={{ marginTop: 10 }}>
        <div>{compra}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{fotos.length > 1 && <Galeria fotos={fotos} />}{extras}</div>
      </div>
    </div>
  </>);
  else if (plantilla === "festival") cuerpo = (<>
    <div style={{ ...marco, paddingTop: "max(14px, env(safe-area-inset-top))" }}>{cabecera(false)}{avisos}</div>
    <div style={{ ...marco }}>
      {fotos.length ? <Galeria fotos={fotos} alto="min(62svh, 560px)" grande /> : <div style={{ maxWidth: 520, margin: "0 auto" }}>{flyer()}</div>}
    </div>
    <div style={{ background: "var(--c)", color: T.tinta, margin: "22px 0 0", padding: "22px 0" }}>
      <div style={{ ...marco, display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <h1 style={{ fontSize: "clamp(36px, 8cqw, 78px)", lineHeight: .95, letterSpacing: "-.035em", margin: 0, fontWeight: 900, textTransform: "uppercase", overflowWrap: "anywhere" }}>{ev.nombre}</h1>
          {T.d.lema && <div style={{ fontSize: 18, fontWeight: 800, marginTop: 8 }}>{T.d.lema}</div>}
        </div>
        {abierta && <button data-cta onClick={irAEntradas} style={{ ...btn(T.tinta === "#fff" ? "#0b0c10" : "#fff", T.tinta === "#fff" ? "#fff" : "#111"), padding: "17px 22px", fontSize: 18, flex: "1 1 260px", maxWidth: 420, flexWrap: "wrap", rowGap: 2 }}>{textoBoton}{desde != null && <span style={{ opacity: .8 }}>· {desde ? `desde ${eur(desde)}` : "gratis"}</span>}</button>}
      </div>
    </div>
    <div style={{ ...marco, ...pie, marginTop: 22 }}>
      <div className="pub-dos">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>{datos(true)}{compra}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{fotos.length > 0 && ev.flyer_url && <div style={{ maxWidth: 420 }}>{flyer(18)}</div>}{extras}</div>
      </div>
    </div>
  </>);
  else if (plantilla === "minimal") cuerpo = (
    <div style={{ ...marco, maxWidth: 680, paddingTop: "max(14px, env(safe-area-inset-top))", ...pie }}>
      {cabecera(false)}{avisos}
      <div style={{ textAlign: "center", padding: "18px 0 6px" }}>
        <div style={{ fontSize: 12.5, fontWeight: 900, letterSpacing: 3, textTransform: "uppercase", color: "var(--c)" }}>{cap(fecha(ev.inicio || ev.fecha, false))}</div>
        <h1 style={{ fontSize: "clamp(34px, 7cqw, 60px)", lineHeight: 1.02, letterSpacing: "-.03em", margin: "10px 0 10px", fontWeight: 900, overflowWrap: "anywhere" }}>{ev.nombre}</h1>
        {lema}
      </div>
      <div style={{ maxWidth: 460, margin: "6px auto 20px" }}>{flyer(22)}</div>
      <div style={{ ...card, marginBottom: 18 }}>{datos(false)}</div>
      {compra}
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 22 }}>{fotos.length > 0 && <Galeria fotos={fotos} />}{extras}</div>
    </div>);
  else cuerpo = (
    <div style={{ ...marco, paddingTop: "max(14px, env(safe-area-inset-top))", ...pie }}>
      {cabecera(false)}{avisos}
      <div className="pub-grid">
        <div className="pub-flyer">{flyer()}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>{titulo()}{lema}{datos(false)}</div>
          {compra}
          {fotos.length > 0 && <Galeria fotos={fotos} />}
          {extras}
        </div>
      </div>
    </div>);

  return (
    <div ref={raiz} style={{ ...T.vars, minHeight: previa ? "100%" : "100dvh", background: "var(--bg)", color: "var(--text)", fontFamily: T.letra, position: "relative", overflowX: "hidden" }}>
      <style>{CSS_PUB}</style>
      {T.d.fondoFlyer && ev.flyer_url && plantilla !== "inmersiva" && <div aria-hidden="true" style={{ position: previa ? "absolute" : "fixed", inset: -40, backgroundImage: `url("${ev.flyer_url}")`, backgroundSize: "cover", backgroundPosition: "center", filter: "blur(40px) saturate(1.3)", opacity: T.osc ? .35 : .22, transform: "scale(1.1)", zIndex: 0 }} />}
      <div className="pub-cont" style={{ position: "relative", zIndex: 1 }}>{cuerpo}</div>

      {/* Barra fija: total y continuar, o el botón de comprar mientras las entradas no se ven */}
      {conCarrito && paso === "elegir" && carrito.n > 0 ? <BarraCarrito carrito={carrito} T={T} onAbrir={() => setHoja("carrito")} />
      : abierta && paso === "elegir" && (nEnt > 0 ? (
        <div className="pub-barra" style={previa ? barraPrevia : null}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 700 }}>{nEnt} {nEnt === 1 ? "entrada" : "entradas"}</div>
            <div style={{ fontSize: 24, fontWeight: 900 }}>{total ? eur(total) : "Gratis"}</div>
          </div>
          <button onClick={() => { setPaso("datos"); if (!previa) window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ ...btn(T.d.color, T.tinta), padding: "16px 26px", fontSize: 17 }}>Continuar →</button>
        </div>
      ) : !entradasVisibles && (
        <div className="pub-barra" style={previa ? barraPrevia : null}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.nombre}</div>
            <div style={{ fontSize: 20, fontWeight: 900 }}>{desde ? `Desde ${eur(desde)}` : "Entrada gratuita"}</div>
          </div>
          <button onClick={irAEntradas} style={{ ...btn(T.d.color, T.tinta), padding: "16px 22px", fontSize: 17 }}>{textoBoton}</button>
        </div>
      ))}
      {!previa && abierta && paso === "elegir" && av.notificaciones && <AvisosCompra social={ev.social} servidor={ev.ahora} offset={offset} T={T} />}
      {hoja === "carrito" && <HojaCarrito carrito={carrito} T={T} orgNombre={org?.nombre} onClose={() => setHoja(null)}
        onContinuar={() => { setHoja(null); setPaso(carrito.eventos.length === 1 && carrito.eventos[0] === ev.slug ? "datos" : "varios"); window.scrollTo({ top: 0, behavior: "smooth" }); }} />}
      {hoja?.evento && <ElegirEntradas slug={hoja.evento} carrito={carrito} T={T} onClose={() => setHoja(null)} />}
    </div>
  );
}
/* ---------- Datos y compra ---------- */
function Formulario({ ev, tramos, cant, total, T, onVolver, onExito }) {
  const form = ev.formulario || {};
  const items = tramos.filter(t => cant[t.id] > 0);
  const plazas = items.flatMap(t => Array.from({ length: cant[t.id] }, (_, k) => ({ tramo: t.id, nombreTramo: t.nombre, k })));
  const [c, setC] = useState({ nombre: "", email: "", email2: "" });
  const [as, setAs] = useState(() => plazas.map(() => ({ nombre: "", dni: "" })));
  const [acepta, setAcepta] = useState(false);
  const [aceptaEdad, setAceptaEdad] = useState(false);
  const [novedades, setNovedades] = useState(false);   // casilla aparte y desmarcada (consentimiento libre)
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setC(x => ({ ...x, [k]: v }));
  const pedir = (k) => (form[k] || "no") !== "no";
  const oblig = (k) => form[k] === "obligatorio";
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim());

  const enviar = async (e) => {
    e.preventDefault(); setErr("");
    if (c.nombre.trim().length < 3) return setErr(ERRORES.nombre);
    if (!emailOk) return setErr(ERRORES.email);
    if (c.email.trim().toLowerCase() !== c.email2.trim().toLowerCase()) return setErr("Los dos correos no coinciden.");
    for (const f of CAMPOS) if (oblig(f.k) && !String(c[f.k] || "").trim()) return setErr(`Falta: ${f.t}.`);
    if (as.some(a => a.nombre.trim().length < 3)) return setErr(ERRORES.nombre_asistente);
    if (oblig("dni_asistente") && as.some(a => !a.dni.trim())) return setErr("Falta el DNI de algún asistente.");
    if (ev.edad_minima && !aceptaEdad) return setErr(ERRORES.edad);
    if (!acepta) return setErr(ERRORES.condiciones);
    setBusy(true);
    try {
      const comprador = { nombre: c.nombre.trim(), email: c.email.trim(), acepta: true, acepta_edad: aceptaEdad, marketing: novedades, privacidad: PRIVACIDAD_VERSION, rrpp: codigoRP() };
      CAMPOS.forEach(f => { if (pedir(f.k) && c[f.k]) comprador[f.k] = String(c[f.k]).trim(); });
      const { data, error } = await supabase.rpc("web_comprar", {
        p_slug: ev.slug, p_items: items.map(t => ({ tramo: t.id, cantidad: cant[t.id] })), p_comprador: comprador,
        p_asistentes: plazas.map((p, i) => ({ tramo: p.tramo, nombre: as[i].nombre.trim(), dni: pedir("dni_asistente") ? as[i].dni.trim() : "" })),
      });
      if (error) throw error;
      if (!data?.ok) { const k = String(data?.motivo || ""); setErr((k.startsWith("falta_") ? `Falta: ${CAMPOS.find(f => f.k === k.slice(6))?.t || k.slice(6)}.` : ERRORES[k] || "No se ha podido completar la compra.") + (data?.tramo ? ` (${data.tramo})` : "")); setBusy(false); return; }
      try { const l = JSON.parse(localStorage.getItem(MIS) || "[]") || []; l.unshift({ slug: ev.slug, acceso: data.acceso, codigo: data.codigo, t: Date.now() }); localStorage.setItem(MIS, JSON.stringify(l.slice(0, 30))); } catch {}
      try { onExito && onExito(); } catch {}
      window.location.assign(`/mis-entradas/${data.acceso}?nueva=1`);
    } catch { setErr(navigator.onLine ? "No se ha podido completar la compra. Inténtalo de nuevo." : "Sin conexión. Conéctate y vuelve a intentarlo."); setBusy(false); }
  };

  return (
    <form onSubmit={enviar} style={{ marginTop: 22 }} noValidate>
      <button type="button" onClick={onVolver} style={{ ...btn("transparent", "var(--text)"), padding: "8px 0", fontSize: 15 }}>← Cambiar entradas</button>
      <div style={{ ...card, marginTop: 8 }}>
        <h2 style={{ fontSize: 20, margin: "0 0 4px", fontWeight: 900 }}>Tu pedido</h2>
        {items.map(t => <div key={t.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontWeight: 700 }}><span>{cant[t.id]} × {t.nombre}</span><span>{money(t.precio * cant[t.id])}</span></div>)}
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--line)", marginTop: 6, paddingTop: 10, fontWeight: 900, fontSize: 20 }}><span>Total</span><span>{total ? eur(total) : "Gratis"}</span></div>
      </div>

      <div style={{ ...card, marginTop: 12 }}>
        <h2 style={{ fontSize: 20, margin: "0 0 12px", fontWeight: 900 }}>Tus datos</h2>
        <Campo l="Nombre y apellidos *" v={c.nombre} on={v => set("nombre", v)} ac="name" />
        <Campo l="Correo electrónico *" v={c.email} on={v => set("email", v)} type="email" ac="email" im="email" sub="Aquí te enviaremos las entradas." />
        <Campo l="Repite el correo *" v={c.email2} on={v => set("email2", v)} type="email" ac="email" im="email" />
        {CAMPOS.filter(f => pedir(f.k)).map(f => f.sel
          ? <label key={f.k} style={lbl}><span>{f.t}{oblig(f.k) ? " *" : ""}</span><select value={c[f.k] || ""} onChange={e => set(f.k, e.target.value)} style={inpP}><option value="">Elige…</option>{f.sel.map(o => <option key={o}>{o}</option>)}</select></label>
          : <Campo key={f.k} l={`${f.t}${oblig(f.k) ? " *" : ""}`} v={c[f.k] || ""} on={v => set(f.k, v)} type={f.type} ac={f.ac} im={f.im} />)}
      </div>

      <div style={{ ...card, marginTop: 12 }}>
        <h2 style={{ fontSize: 20, margin: "0 0 4px", fontWeight: 900 }}>Asistentes</h2>
        <div style={{ color: "var(--muted)", fontSize: 14, marginBottom: 12 }}>Las entradas son nominativas: en cada una sale el nombre de quien la usa.</div>
        {plazas.map((p, i) => (
          <div key={i} style={{ borderTop: i ? "1px solid var(--line)" : "none", paddingTop: i ? 12 : 0, marginTop: i ? 4 : 0 }}>
            <div style={{ fontWeight: 900, fontSize: 14, color: "var(--c)", marginBottom: 6 }}>Entrada {i + 1} · {p.nombreTramo}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 220px" }}><Campo l="Nombre y apellidos *" v={as[i].nombre} on={v => setAs(l => l.map((x, j) => j === i ? { ...x, nombre: v } : x))} ac={i === 0 ? "name" : "off"} /></div>
              {i === 0 && c.nombre && !as[0].nombre && <button type="button" onClick={() => setAs(l => l.map((x, j) => j === 0 ? { ...x, nombre: c.nombre } : x))} style={{ ...btn("var(--card2)", "var(--text)"), fontSize: 14, padding: "10px 12px", marginBottom: 12, border: "1px solid var(--line)" }}>Soy yo</button>}
            </div>
            {pedir("dni_asistente") && <Campo l={`DNI / NIE${oblig("dni_asistente") ? " *" : ""}`} v={as[i].dni} on={v => setAs(l => l.map((x, j) => j === i ? { ...x, dni: v } : x))} ac="off" />}
          </div>))}
      </div>

      <div style={{ ...card, marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        {ev.edad_minima ? <Check v={aceptaEdad} on={setAceptaEdad}>Confirmo que todos los asistentes tienen {ev.edad_minima} años o más{ev.autorizacion_url ? ` (los menores de ${ev.autorizacion_edad || 16} traerán la autorización firmada)` : ""}.</Check> : null}
        <Check v={acepta} on={setAcepta}>Acepto las condiciones de compra. Las entradas son nominativas, de un solo uso y no se pueden revender.</Check>
        <Check v={novedades} on={setNovedades}>Quiero recibir novedades, preventas y ofertas de {ev.legal?.razon_social || "este organizador"} por correo. <span style={{ color: "var(--muted)" }}>Opcional. Me puedo dar de baja cuando quiera.</span></Check>
        <InfoPrivacidad legal={ev.legal} />
      </div>

      {err && <div role="alert" style={{ marginTop: 12, background: "#c62828", color: "#fff", borderRadius: 12, padding: "12px 14px", fontWeight: 800 }}>{err}</div>}
      <button type="submit" disabled={busy} style={{ ...btn(T.d.color, T.tinta), width: "100%", marginTop: 14, padding: "18px", fontSize: 18, opacity: busy ? .6 : 1 }}>
        {busy ? "Emitiendo tus entradas…" : total && ev.modo !== "pruebas" && !ev.vista_previa ? `Pagar ${eur(total)}` : "Conseguir mis entradas"}
      </button>
      {(ev.modo === "pruebas" || ev.vista_previa) && <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, marginTop: 8 }}>Venta de prueba: no se cobra nada y las entradas no son válidas.</div>}
    </form>
  );
}
/* ===================== Mis entradas ===================== */
function MisEntradas({ acceso }) {
  const [d, setD] = useState(undefined);
  const [pdf, setPdf] = useState(false);
  const [correo, setCorreo] = useState("");      // estado del envío por correo
  const nueva = new URLSearchParams(window.location.search).has("nueva");
  const enviarCorreo = async (auto = false) => {
    setCorreo("enviando");
    try {
      const { data } = await supabase.functions.invoke("web-enviar-entradas", { body: { acceso, origen: window.location.origin } });
      const m = data?.ok ? "enviado" : data?.motivo || "error";
      setCorreo(auto && m !== "enviado" ? "" : m);
    } catch { setCorreo(auto ? "" : "error"); }
  };
  // Recién compradas: se mandan al correo una vez (si el envío está activado)
  useEffect(() => {
    if (!nueva) return;
    const k = "tixfast_correo_" + acceso;
    try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, "1"); } catch {}
    enviarCorreo(true);
  }, [acceso]);
  useEffect(() => {
    if (!/^[0-9a-f-]{36}$/i.test(acceso)) { setD(null); return; }
    supabase.rpc("web_pedido", { p_acceso: acceso }).then(({ data, error }) => setD(error ? "error" : data || null));
    document.title = "Mis entradas";
  }, [acceso]);
  if (d === undefined) return <Mensaje titulo="Cargando tus entradas…" />;
  if (d === "error") return <Mensaje titulo="No se han podido cargar" texto="Revisa tu conexión y vuelve a abrir el enlace." />;
  if (!d) return <Mensaje titulo="Enlace no válido" texto="Revisa que el enlace esté completo." />;
  const T = tema(d.evento.diseno), ev = d.evento, p = d.pedido;
  const desde = ev.inicio ? new Date(new Date(ev.inicio).getTime() - (ev.qr_horas_antes ?? 24) * 3600000) : null;
  const descargar = async () => {
    setPdf(true);
    try { const { pdfEntradas } = await import("./pdfEntradas.js"); await pdfEntradas(d); }
    catch (e) { console.error(e); alert("No se ha podido crear el PDF. Inténtalo de nuevo."); }
    finally { setPdf(false); }
  };
  const copiar = async () => { try { await navigator.clipboard.writeText(window.location.href.split("?")[0]); alert("Enlace copiado"); } catch {} };
  return (
    <div style={{ ...T.vars, minHeight: "100dvh", background: "var(--bg)", color: "var(--text)", fontFamily: T.letra }}>
      <style>{CSS_PUB}</style>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "max(16px, env(safe-area-inset-top)) 16px calc(30px + env(safe-area-inset-bottom))" }}>
        {nueva && <div style={{ ...card, background: "#0f9d63", color: "#fff", border: "none", marginBottom: 14, textAlign: "center" }}>
          <div style={{ fontSize: 26, fontWeight: 900 }}>¡Ya tienes tus entradas!</div>
          <div style={{ marginTop: 4, opacity: .95 }}>Pedido {p.codigo}. Guarda esta página o descarga el PDF.</div>
        </div>}
        {p.prueba && <Aviso c="#ffb400">Entradas de PRUEBA: no son válidas para entrar.</Aviso>}
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
          {ev.flyer_url && <img src={ev.flyer_url} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 12 }} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 22, lineHeight: 1.1, overflowWrap: "anywhere" }}>{ev.nombre}</div>
            <div style={{ color: "var(--muted)", fontWeight: 700, marginTop: 4 }}>{fecha(ev.inicio || ev.fecha)}{ev.recinto ? ` · ${ev.recinto}` : ""}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          <button onClick={descargar} disabled={pdf} style={{ ...btn(T.d.color, T.tinta), flex: "1 1 200px" }}>{pdf ? "Creando PDF…" : "Descargar PDF"}</button>
          <button onClick={copiar} style={{ ...btn("var(--card2)", "var(--text)"), flex: "1 1 140px", border: "1px solid var(--line)" }}>Copiar enlace</button>
          <button onClick={() => enviarCorreo(false)} disabled={correo === "enviando"} style={{ ...btn("var(--card2)", "var(--text)"), flex: "1 1 100%", border: "1px solid var(--line)", fontSize: 15 }}>{correo === "enviando" ? "Enviando…" : `Enviar a ${p.email}`}</button>
        </div>
        {correo && correo !== "enviando" && <div role="status" style={{ ...card, marginBottom: 14, fontWeight: 700, fontSize: 14, borderColor: correo === "enviado" ? "#0f9d63" : "var(--line)" }}>
          {{ enviado: `Enviadas a ${p.email}. Si no las ves, mira en «Spam» o «Promociones».`, sin_correo: "El envío por correo aún no está activado. Descarga el PDF o guarda este enlace.", espera: "Acabamos de enviarlas: espera un par de minutos antes de pedirlo otra vez.", limite: "Ya se han enviado varias veces. Descarga el PDF o guarda este enlace." }[correo] || "No se ha podido enviar el correo. Descarga el PDF o guarda este enlace."}
        </div>}
        <EntradasDePedido d={d} T={T} />
        <div style={{ textAlign: "center", marginTop: 18 }}><a href={`/e/${ev.slug}`} style={{ color: "var(--muted)", fontWeight: 700 }}>Volver al evento</a></div>
      </div>
    </div>
  );
}

// Las entradas de un pedido (un evento), con su QR. Se usa en «Mis entradas» y en la compra de varios eventos
function EntradasDePedido({ d, T }) {
  const ev = d.evento;
  const desde = ev.inicio ? new Date(new Date(ev.inicio).getTime() - (ev.qr_horas_antes ?? 24) * 3600000) : null;
  return (<>
        {d.entradas.map(x => (
          <div key={x.numero} style={{ ...card, marginBottom: 12, padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", background: "linear-gradient(135deg, var(--c), color-mix(in srgb, var(--c) 55%, #000))", color: T.tinta }}>
              <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 1.5, textTransform: "uppercase", opacity: .85 }}>{x.tramo} · Nº {String(x.numero).padStart(4, "0")}</div>
              <div style={{ fontSize: 24, fontWeight: 900, marginTop: 2, overflowWrap: "anywhere" }}>{x.asistente}</div>
            </div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, position: "relative" }}>
              {x.estado === "valida" && x.qr_hex ? (
                <>
                  {x.prueba && <span style={{ background: "#ffb400", color: "#1a1205", fontWeight: 900, padding: "4px 12px", borderRadius: 8, fontSize: 14, letterSpacing: 1 }}>PRUEBA · NO VÁLIDA</span>}
                  <div style={{ background: "#fff", padding: 10, borderRadius: 14 }}>
                    <QrCodigo texto={textoQR(x.qr_hex)} margen={2} style={{ width: 240, height: 240 }} />
                  </div>
                </>) : <div style={{ fontWeight: 900, color: "#ff6b6b", padding: 30 }}>ENTRADA ANULADA</div>}
              <div style={{ color: "var(--muted)", fontSize: 13, textAlign: "center" }}>{desde ? `Válida desde el ${fecha(desde.toISOString())}${ev.fin ? ` hasta las ${hora(ev.fin)} del ${fecha(ev.fin, false)}` : ""}.` : "Válida para el día del evento."} Un solo uso.</div>
            </div>
          </div>))}
        {(ev.edad_minima || ev.vestimenta || ev.autorizacion_url) && <div style={{ ...card, fontSize: 14, lineHeight: 1.5 }}>
          {ev.edad_minima ? <div><b>Edad mínima:</b> {ev.edad_minima} años.</div> : null}
          {ev.vestimenta ? <div><b>Vestimenta:</b> {ev.vestimenta}</div> : null}
          {ev.autorizacion_url ? <div style={{ marginTop: 6 }}>Menores de {ev.autorizacion_edad || 16}: <a href={ev.autorizacion_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--c)", fontWeight: 800 }}>descarga la autorización</a>, rellénala y tráela impresa.</div> : null}
        </div>}
  </>);
}

/* ===================== Mis entradas de una compra de varios eventos ===================== */
function MisCompra({ acceso }) {
  const [d, setD] = useState(undefined);
  const [pdf, setPdf] = useState(null);
  const [correo, setCorreo] = useState("");
  const nueva = new URLSearchParams(window.location.search).has("nueva");
  const enviarCorreo = async (auto = false) => {
    setCorreo("enviando");
    try {
      const { data } = await supabase.functions.invoke("web-enviar-entradas", { body: { compra: acceso, origen: window.location.origin } });
      const m = data?.ok ? "enviado" : data?.motivo || "error";
      setCorreo(auto && m !== "enviado" ? "" : m);
    } catch { setCorreo(auto ? "" : "error"); }
  };
  useEffect(() => {
    if (!nueva) return;
    const k = "tixfast_correo_c_" + acceso;
    try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, "1"); } catch {}
    enviarCorreo(true);
  }, [acceso]);
  useEffect(() => {
    if (!/^[0-9a-f-]{36}$/i.test(acceso)) { setD(null); return; }
    supabase.rpc("web_compra", { p_acceso: acceso }).then(({ data, error }) => setD(error ? "error" : data || null));
    document.title = "Mis entradas";
  }, [acceso]);
  if (d === undefined) return <Mensaje titulo="Cargando tus entradas…" />;
  if (d === "error") return <Mensaje titulo="No se han podido cargar" texto="Revisa tu conexión y vuelve a abrir el enlace." />;
  if (!d) return <Mensaje titulo="Enlace no válido" texto="Revisa que el enlace esté completo." />;
  const c = d.compra, o = d.organizacion, pedidos = d.pedidos || [];
  const T = tema(o?.diseno ? { color: o.diseno.color, fondo: o.diseno.fondo, letra: o.diseno.letra } : pedidos[0]?.evento?.diseno);
  const n = pedidos.reduce((s, p) => s + (p.entradas || []).length, 0);
  const descargar = async (p, i) => {
    setPdf(i);
    try { const { pdfEntradas } = await import("./pdfEntradas.js"); await pdfEntradas(p); }
    catch (e) { console.error(e); alert("No se ha podido crear el PDF. Inténtalo de nuevo."); }
    finally { setPdf(null); }
  };
  const copiar = async () => { try { await navigator.clipboard.writeText(window.location.href.split("?")[0]); alert("Enlace copiado"); } catch {} };
  return (
    <div style={{ ...T.vars, minHeight: "100dvh", background: "var(--bg)", color: "var(--text)", fontFamily: T.letra }}>
      <style>{CSS_PUB}</style>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "max(16px, env(safe-area-inset-top)) 16px calc(30px + env(safe-area-inset-bottom))" }}>
        {o && <a href={`/o/${o.slug}`} style={{ display: "flex", alignItems: "center", gap: 10, color: "inherit", textDecoration: "none", marginBottom: 14, fontWeight: 900, fontSize: 18 }}>
          {o.logo_url ? <img src={o.logo_url} alt={o.nombre} style={{ height: 36, maxWidth: 160, objectFit: "contain" }} /> : o.nombre}</a>}
        {nueva && <div style={{ ...card, background: "#0f9d63", color: "#fff", border: "none", marginBottom: 14, textAlign: "center" }}>
          <div style={{ fontSize: 26, fontWeight: 900 }}>¡Ya tienes tus entradas!</div>
          <div style={{ marginTop: 4, opacity: .95 }}>Compra {c.codigo} · {n} {n === 1 ? "entrada" : "entradas"}{pedidos.length > 1 ? ` para ${pedidos.length} eventos` : ""}. Guarda esta página.</div>
        </div>}
        {c.prueba && <Aviso c="#ffb400">Entradas de PRUEBA: no son válidas para entrar.</Aviso>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          <button onClick={copiar} style={{ ...btn("var(--card2)", "var(--text)"), flex: "1 1 140px", border: "1px solid var(--line)" }}>Copiar enlace</button>
          <button onClick={() => enviarCorreo(false)} disabled={correo === "enviando"} style={{ ...btn("var(--card2)", "var(--text)"), flex: "1 1 200px", border: "1px solid var(--line)", fontSize: 15 }}>{correo === "enviando" ? "Enviando…" : `Enviar a ${c.email}`}</button>
        </div>
        {correo && correo !== "enviando" && <div role="status" style={{ ...card, marginBottom: 14, fontWeight: 700, fontSize: 14, borderColor: correo === "enviado" ? "#0f9d63" : "var(--line)" }}>
          {{ enviado: `Enviadas a ${c.email}. Si no las ves, mira en «Spam» o «Promociones».`, sin_correo: "El envío por correo aún no está activado. Descarga los PDF o guarda este enlace.", espera: "Acabamos de enviarlas: espera un par de minutos antes de pedirlo otra vez.", limite: "Ya se han enviado varias veces. Descarga los PDF o guarda este enlace." }[correo] || "No se ha podido enviar el correo. Descarga los PDF o guarda este enlace."}
        </div>}
        {pedidos.map((p, i) => (
          <section key={p.acceso || i} style={{ marginTop: i ? 26 : 0 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
              {p.evento.flyer_url && <img src={p.evento.flyer_url} alt="" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 12 }} />}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 900, fontSize: 21, lineHeight: 1.1, overflowWrap: "anywhere" }}>{p.evento.nombre}</div>
                <div style={{ color: "var(--muted)", fontWeight: 700, marginTop: 4 }}>{fecha(p.evento.inicio || p.evento.fecha)}{p.evento.recinto ? ` · ${p.evento.recinto}` : ""}</div>
              </div>
            </div>
            <button onClick={() => descargar(p, i)} disabled={pdf != null} style={{ ...btn(T.d.color, T.tinta), width: "100%", marginBottom: 12 }}>{pdf === i ? "Creando PDF…" : `Descargar PDF de ${p.evento.nombre}`}</button>
            <EntradasDePedido d={p} T={T} />
          </section>))}
        {o && <div style={{ textAlign: "center", marginTop: 18 }}><a href={`/o/${o.slug}`} style={{ color: "var(--muted)", fontWeight: 700 }}>Ver más eventos de {o.nombre}</a></div>}
      </div>
    </div>
  );
}

const barraPrevia = { position: "sticky", left: 0, right: 0, bottom: 0, transform: "none", width: "auto", borderRadius: 0 };

// ===================== PÁGINA PÚBLICA DE VENTA =====================
// /e/<enlace>            → página del evento: flyer, tramos, cuenta atrás y compra
// /mis-entradas/<acceso> → las entradas del comprador con su QR y el PDF
// /r/<token>             → reserva online de mesas VIP (plano en directo y pago del adelanto)
// /b/<token>             → ficha de bebidas de un reservado (solo su mesa y las listas, nada más)
// /p/<enlace>            → puesto de un evento Multipuesto (con su PIN): escanear y ver sus ventas
// No necesita sesión. Solo habla con las funciones públicas del servidor (nunca con las tablas).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabase";
import { avisosDe } from "./avisos";
import QrCodigo from "../qr/QrCodigo";
import { textoQR, money, eur, fecha, hora, tema, Mensaje, Esqueleto, MIS, cap, reducido, Diapositivas, Galeria, card, btn, Chip, Aviso, Linea, Tramo, CuentaAtras, AvisosCompra, PruebaSocial, CAMPOS, ERRORES, lbl, inpP, Campo, Check, CSS_PUB, InfoPrivacidad, PRIVACIDAD_VERSION, precioConDescuento } from "./comun";
export { textoQR } from "./comun";
const PaginaCambio = React.lazy(() => import("./Cambio.jsx"));
const PanelPuntoVenta = React.lazy(() => import("./PanelPuntoVenta.jsx"));
import { useCarrito, BarraCarrito, HojaCarrito, ElegirEntradas, CompraVarios } from "./Carrito";
import PaginaOrganizacion, { MasFiestas } from "./Microsite";
const PaginaReservas = React.lazy(() => import("./Reservas"));
const WidgetReservas = React.lazy(() => import("./Reservas").then(m => ({ default: m.WidgetReservas })));
import { Lanzamiento, useCola, paseDe } from "./Lanzamiento.jsx";
import { Icono } from "../iconos";
const PaginaBebidas = React.lazy(() => import("./Bebidas"));
const PaginaPuesto = React.lazy(() => import("./Puesto"));

import { codigoRP } from "./rrppEnlace";
import { pagos, gastosDe } from "./pagosApi";
const PanelRRPP = React.lazy(() => import("./PanelRRPP"));
const CuentaRRPP = React.lazy(() => import("./CuentaRRPP"));

export default function Publico() {
  const ruta = window.location.pathname;
  // Portal de RRPP con cuenta: /rp (entrar o crear cuenta) y /rp/unirse/<token> (pedir colaborar con un organizador)
  const unirse = ruta.match(/^\/rp\/unirse\/([0-9a-f-]{36})\/?$/i);
  if (unirse || /^\/rp\/?$/.test(ruta)) return <React.Suspense fallback={<Mensaje titulo="Cargando…" />}><CuentaRRPP token={unirse ? unirse[1].toLowerCase() : null} /></React.Suspense>;
  // Cambio de nombre de una entrada: /cambio (subir la entrada) y /cambio/<acceso> (vuelta del pago)
  // y entradas perdidas: /cambio/recuperar/<acceso> (vuelta del pago de la recuperación)
  // Panel del punto de venta (local que vende entradas físicas): /pv/<enlace>
  const pv = ruta.match(/^\/pv\/([0-9a-f-]{36})\/?$/i);
  if (pv) return <React.Suspense fallback={<Mensaje titulo="Cargando…" />}><PanelPuntoVenta token={pv[1].toLowerCase()} /></React.Suspense>;
  const cambio = ruta.match(/^\/cambio(?:\/(recuperar\/)?([0-9a-f-]{36}))?\/?$/i);
  if (cambio) return <React.Suspense fallback={<Mensaje titulo="Cargando…" />}><PaginaCambio acceso={cambio[2] && !cambio[1] ? cambio[2].toLowerCase() : null} recuperar={cambio[2] && cambio[1] ? cambio[2].toLowerCase() : null} /></React.Suspense>;
  const m = ruta.match(/^\/(e|o|mis-entradas|compra|r|b|p|rp)\/([^/?#]+)/);
  if (!m) return <Mensaje titulo="Página no encontrada" />;
  const v = decodeURIComponent(m[2]);
  if (m[1] === "e") return <PaginaEvento slug={v.toLowerCase()} />;
  if (m[1] === "o") return <PaginaOrganizacion slug={v.toLowerCase()} />;
  if (m[1] === "compra") return <MisCompra acceso={v} />;
  if (m[1] === "r") return <React.Suspense fallback={<Mensaje titulo="Cargando…" />}><PaginaReservas token={v} /></React.Suspense>;
  if (m[1] === "p") return <React.Suspense fallback={<Mensaje titulo="Cargando…" />}><PaginaPuesto token={v} /></React.Suspense>;
  if (m[1] === "b") return <React.Suspense fallback={<Mensaje titulo="Cargando…" />}><PaginaBebidas token={v} /></React.Suspense>;
  if (m[1] === "rp") return <React.Suspense fallback={<Mensaje titulo="Cargando tu panel…" />}><PanelRRPP acceso={v} /></React.Suspense>;
  return <MisEntradas acceso={v} />;
}

/* Visitas: un identificador al azar del navegador (no es un dato personal) para no contar dos veces
   a la misma persona; el servidor ignora las repetidas en 30 minutos. Si falla, no pasa nada. */
function apuntarVisita(slug) {
  let id = null;
  try { id = localStorage.getItem("tixfast_visitante"); if (!id) { id = crypto.randomUUID(); localStorage.setItem("tixfast_visitante", id); } } catch { id = Math.random().toString(36).slice(2) + Date.now().toString(36); }
  let rp = null;
  try { rp = new URLSearchParams(window.location.search).get("rp"); } catch {}
  supabase.rpc("web_registrar_visita", { p_slug: slug, p_visitante: id, p_rp: rp }).then(() => {}, () => {});
}

/* ===================== Página del evento ===================== */
function PaginaEvento({ slug }) {
  const [ev, setEv] = useState(undefined);       // undefined = cargando · null = no existe
  const [error, setError] = useState(false);
  const [org, setOrg] = useState(null);          // organización del evento (microsite y carrito)
  const offset = useRef(0);                      // diferencia reloj servidor - móvil
  useEffect(() => { supabase.rpc("web_evento_organizacion", { p_slug: slug }).then(({ data }) => setOrg(data || null)).catch(() => {}); }, [slug]);
  useEffect(() => { apuntarVisita(slug); }, [slug]);

  const evRef = useRef(null);
  // Durante la cuenta atrás de un lanzamiento no hace falta refrescar (miles de personas mirando = miles de peticiones)
  const enCuentaAtras = () => { const x = evRef.current; return !!(x?.diseno?.lanzamiento?.activo && x?.venta_inicio && new Date(x.venta_inicio).getTime() - (Date.now() + offset.current) > 30000); };
  const cargar = async () => {
    try {
      const { data, error: e } = await supabase.rpc("web_evento_publico", { p_slug: slug });
      if (e) throw e;
      if (data?.ahora) offset.current = new Date(data.ahora).getTime() - Date.now();
      evRef.current = data || null; setEv(data || null); setError(false);
    } catch { setError(true); }
  };
  // En directo: cada 20 s mientras la página está a la vista (las cifras de lo que queda bajan con cada venta real)
  useEffect(() => {
    cargar();
    const t = setInterval(() => { if (document.visibilityState !== "hidden" && !enCuentaAtras()) cargar(); }, 20000);
    const vis = () => { if (document.visibilityState === "visible" && !enCuentaAtras()) cargar(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [slug]);
  useEffect(() => { if (ev?.nombre) document.title = `${ev.nombre} · Entradas`; }, [ev?.nombre]);

  if (ev === undefined && !error) return <Esqueleto />;
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
export function Landing({ ev, org = null, offset = 0, onRecargar = () => {}, previa = false, simularLanz = null }) {
  const [cantLocal, setCant] = useState({});     // { tramoId: n } (evento sin organización)
  const [paso, setPaso] = useState("elegir");    // elegir | datos | varios
  const [hoja, setHoja] = useState(null);        // null | "carrito" | { evento }
  // Con organización, las entradas van a su carrito (compartido con su microsite y sus otros eventos)
  const carrito = useCarrito(org && !previa ? org.slug : null);
  const conCarrito = !!(org && !previa);
  const [entradasVisibles, setEntradasVisibles] = useState(false);
  const raiz = useRef(null);
  const T = tema(ev.diseno);
  // Cola virtual: solo en eventos con lanzamiento (el servidor decide si hace falta esperar)
  const lz = T.d.lanzamiento;
  const { cola, esperando: enColaRaw } = useCola(ev, { activo: !!lz?.activo && !previa, offset });
  const enCola = !previa && enColaRaw;
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
    {!previa && cola?.estado === "dentro" && cola.espero && cola.hasta && <Aviso c="#22d3a6">¡Es tu turno! Tienes hasta las {new Date(cola.hasta).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} para comprar.</Aviso>}
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
          {enVenta.length === 0 && tramos.length > 0 && !tramos.some(t => t.estado === "proximo") && !ev.vista_previa && <ListaEspera ev={ev} T={T} />}
          {av.confianza && <div style={{ display: "flex", gap: "6px 14px", flexWrap: "wrap", justifyContent: "center", fontSize: 12.5, color: "var(--muted)", fontWeight: 700, marginTop: 6 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icono n="ok" s={14} w={2.4} />Entrada nominativa con QR</span><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icono n="ok" s={14} w={2.4} />QR de un solo uso</span><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icono n="ok" s={14} w={2.4} />Al momento en tu móvil y tu correo</span>
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
    {!previa && <section style={{ ...card, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.45, flex: "1 1 200px" }}>¿Ya tienes entrada y no puedes ir, o la has perdido? El cambio de nombre tiene el precio que pone el organizador y la recuperación es un servicio de pago de TIXFAST.</span>
      <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {ev.cambio_nombre !== false && <a href="/cambio" style={{ ...btn("var(--card2)", "var(--text)"), padding: "10px 14px", fontSize: 14, textDecoration: "none", border: "1px solid var(--line)", minHeight: 44 }}>Cambio de nombre{Number(ev.cambio_precio) > 0 ? ` · ${eur(ev.cambio_precio)}` : ""}</a>}
        <a href="/cambio?recuperar" style={{ ...btn("var(--card2)", "var(--text)"), padding: "10px 14px", fontSize: 14, textDecoration: "none", border: "1px solid var(--line)", minHeight: 44 }}>Recuperar mi entrada</a>
      </span>
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
  // Lanzamiento de festival: cuenta atrás a pantalla completa hasta que abre la venta (sin precios: el servidor no los envía).
  // Justo al abrir se mantiene unos segundos («Abriendo la venta…») mientras llegan las entradas.
  const vIni = ev.venta_inicio ? new Date(ev.venta_inicio).getTime() : 0;
  const modoLanz = !!lz?.activo && paso === "elegir" && (simularLanz != null || lanzamiento || enCola || (vIni > 0 && tramos.length === 0 && ahora - vIni < 90000));
  let cuerpo;
  if (modoLanz) cuerpo = (<>
    <Lanzamiento ev={ev} lz={lz} T={T} offset={offset} previa={previa} simular={simularLanz} onAbierta={onRecargar} cabecera={cabecera(true)} cola={cola} enCola={enCola} />
    <div style={{ ...marco, ...pie, paddingTop: 22 }}>
      {avisos}
      <div className="pub-dos">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <section style={card}>{titulo("clamp(26px, 5cqw, 40px)")}{lema}{datos(false)}</section>
          {ev.flyer_url && <div style={{ maxWidth: 420 }}>{flyer(18)}</div>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{extras}</div>
      </div>
    </div>
  </>);
  else if (paso === "datos" || paso === "varios") cuerpo = (
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
      {!previa && <SeccionReservados slug={ev.slug} T={T} />}

      {/* Barra fija: total y continuar, o el botón de comprar mientras las entradas no se ven */}
      {conCarrito && paso === "elegir" && carrito.n > 0 ? <BarraCarrito carrito={carrito} T={T} onAbrir={() => setHoja("carrito")} />
      : abierta && !modoLanz && paso === "elegir" && (nEnt > 0 ? (
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
      {!previa && abierta && !modoLanz && paso === "elegir" && av.notificaciones && <AvisosCompra social={ev.social} servidor={ev.ahora} offset={offset} T={T} />}
      {hoja === "carrito" && <HojaCarrito carrito={carrito} T={T} orgNombre={org?.nombre} onClose={() => setHoja(null)}
        onContinuar={() => { setHoja(null); setPaso(carrito.eventos.length === 1 && carrito.eventos[0] === ev.slug ? "datos" : "varios"); window.scrollTo({ top: 0, behavior: "smooth" }); }} />}
      {hoja?.evento && <ElegirEntradas slug={hoja.evento} carrito={carrito} T={T} onClose={() => setHoja(null)} />}
    </div>
  );
}
/* ---------- Reservados VIP dentro del portal de entradas ---------- */
// Abajo del todo de la página del evento, plegado: mesas libres y precio desde. Al desplegarlo,
// el plano en directo y todo el flujo de reserva (pack, botellas, datos y pago del adelanto).
// Solo aparece si el organizador tiene activada la reserva online de este evento.
function SeccionReservados({ slug, T }) {
  const [token, setToken] = useState(null);
  const [resumen, setResumen] = useState(null);
  const cancelada = useMemo(() => new URLSearchParams(window.location.search).get("reserva_cancelada"), []);
  const [abierto, setAbierto] = useState(() => !!cancelada || window.location.hash === "#reservados");
  const ref = useRef(null);
  useEffect(() => {
    let vivo = true;
    supabase.rpc("reservas_de_evento", { p_slug: slug }).then(async ({ data }) => {
      if (!vivo || !data) return;
      setToken(data);
      const { data: d } = await supabase.rpc("reservas_publico", { p_token: data });
      if (!vivo || !d) return;
      const precios = (d.tarifas || []).map(t => Number(t.precio)).filter(n => n > 0);
      setResumen({ libres: (d.mesas || []).filter(m => m.libre).length, desde: precios.length ? Math.min(...precios) : null, adelanto: Number(d.online?.adelanto_pct) || 0 });
    }, () => {});
    return () => { vivo = false; };
  }, [slug]);
  // Volviendo de una reserva sin pagar, o con el enlace #reservados: se abre y se baja hasta aquí
  useEffect(() => { if (token && abierto) setTimeout(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 350); }, [token]);
  if (!token) return null;
  const sub = resumen ? (resumen.libres ? `${resumen.libres} ${resumen.libres === 1 ? "mesa disponible" : "mesas disponibles"}` : "Todas las mesas reservadas") + (resumen.desde != null ? ` · desde ${eur(resumen.desde)}` : "") : "Plano de la sala, mesas y botellas";
  const punto = (i, t) => <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "#b9bfcc", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 999, padding: "6px 11px" }}><Icono n={i} s={14} />{t}</span>;
  return (
    <section ref={ref} id="reservados" aria-label="Reservados VIP" style={{ position: "relative", zIndex: 1, maxWidth: 1120, margin: "0 auto", marginTop: "calc(24px - 130px - env(safe-area-inset-bottom))", padding: "0 16px calc(140px + env(safe-area-inset-bottom))", scrollMarginTop: 12 }}>
      <div style={{ background: "#0d0f15", color: "#f3f4f8", border: "1px solid rgba(255,255,255,.1)", borderRadius: 22, overflow: "hidden", boxShadow: "0 24px 60px -30px rgba(0,0,0,.6)", fontFamily: T.letra }}>
        <button type="button" onClick={() => setAbierto(v => !v)} aria-expanded={abierto} aria-controls="reservados-panel"
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "18px 16px", background: "none", border: "none", color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer", minHeight: 76 }}>
          <span aria-hidden="true" style={{ width: 50, height: 50, borderRadius: 15, display: "grid", placeItems: "center", background: T.d.color, color: T.tinta, flexShrink: 0, boxShadow: `0 10px 26px -10px ${T.d.color}` }}><Icono n="estrella" s={24} w={2.1} /></span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 11.5, fontWeight: 900, letterSpacing: 1.2, textTransform: "uppercase", color: T.d.color }}>Zona VIP</span>
            <span style={{ display: "block", fontWeight: 900, fontSize: 20, lineHeight: 1.15 }}>Reserva tu mesa</span>
            <span style={{ display: "block", fontSize: 13.5, color: "#9aa1b4", fontWeight: 600, marginTop: 3 }}>{sub}</span>
          </span>
          <span aria-hidden="true" style={{ width: 44, height: 44, borderRadius: 12, display: "grid", placeItems: "center", border: "1px solid rgba(255,255,255,.12)", color: "#c9ced9", transform: abierto ? "rotate(180deg)" : "none", transition: "transform .25s" }}><Icono n="abajo" s={20} w={2.3} /></span>
        </button>
        {!abierto && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "0 16px 18px" }}>
          {punto("mapa", "Plano en directo")}{punto("botella", "Elige tus botellas")}{resumen?.adelanto > 0 ? punto("candado", `Asegúrala con el ${resumen.adelanto} %`) : punto("ok", "Confirmación al momento")}
        </div>}
        {abierto && <div id="reservados-panel" style={{ padding: "4px 14px 18px", borderTop: "1px solid rgba(255,255,255,.08)" }}>
          <React.Suspense fallback={<div style={{ color: "#9aa1b4", padding: "18px 4px", fontWeight: 700 }}>Cargando el plano…</div>}>
            <div style={{ paddingTop: 14 }}><WidgetReservas token={token} slug={slug} color={T.d.color} cancelada={cancelada} /></div>
          </React.Suspense>
        </div>}
      </div>
    </section>
  );
}
/* ---------- Lista de espera (cuando todo está agotado) ---------- */
function ListaEspera({ ev, T }) {
  const [c, setC] = useState({ nombre: "", email: "", cantidad: 1, mkt: false });
  const [estado, setEstado] = useState("");
  const [err, setErr] = useState("");
  const enviar = async (e) => {
    e.preventDefault(); setErr("");
    if (c.nombre.trim().length < 3) return setErr(ERRORES.nombre);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim())) return setErr(ERRORES.email);
    setEstado("enviando");
    try {
      const { data, error } = await supabase.rpc("web_espera_apuntar", { p_slug: ev.slug, p_nombre: c.nombre.trim(), p_email: c.email.trim(), p_cantidad: c.cantidad, p_marketing: c.mkt });
      if (error) throw error;
      if (!data?.ok) { setErr(ERRORES[data?.motivo] || "No se ha podido apuntar."); setEstado(""); return; }
      setEstado("hecho");
    } catch { setErr(navigator.onLine ? "No se ha podido apuntar. Inténtalo de nuevo." : "Sin conexión."); setEstado(""); }
  };
  if (estado === "hecho") return <div role="status" style={{ ...card, marginTop: 10, borderColor: "var(--c)" }}><b>Estás en la lista de espera.</b><div style={{ color: "var(--muted)", fontSize: 14, marginTop: 4 }}>Si salen más entradas, el organizador te avisará a {c.email.trim()}.</div></div>;
  return (
    <form onSubmit={enviar} noValidate style={{ ...card, marginTop: 10 }}>
      <h3 style={{ fontSize: 18, margin: "0 0 4px", fontWeight: 900 }}>Avísame si salen más entradas</h3>
      <div style={{ color: "var(--muted)", fontSize: 14, marginBottom: 12 }}>Apúntate a la lista de espera. No pagas nada ahora.</div>
      <Campo l="Nombre y apellidos" v={c.nombre} on={v => setC(x => ({ ...x, nombre: v }))} ac="name" />
      <Campo l="Correo electrónico" v={c.email} on={v => setC(x => ({ ...x, email: v }))} type="email" ac="email" im="email" />
      <label style={lbl}><span>¿Cuántas entradas querrías?</span>
        <select value={c.cantidad} onChange={e => setC(x => ({ ...x, cantidad: +e.target.value }))} style={inpP}>{[1, 2, 3, 4, 5, 6, 8, 10].map(n => <option key={n} value={n}>{n}</option>)}</select>
      </label>
      <Check v={c.mkt} on={v => setC(x => ({ ...x, mkt: v }))}>Quiero recibir también novedades de {ev.legal?.razon_social || "este organizador"}. <span style={{ color: "var(--muted)" }}>Opcional.</span></Check>
      {err && <div role="alert" style={{ marginTop: 10, color: "#ff6b6b", fontWeight: 800 }}>{err}</div>}
      <button type="submit" disabled={estado === "enviando"} style={{ ...btn(T.d.color, T.tinta), width: "100%", marginTop: 12, padding: "15px", fontSize: 16 }}>{estado === "enviando" ? "Apuntando…" : "Apuntarme a la lista de espera"}</button>
    </form>
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
  // Código descuento: se puede traer en el enlace (?codigo=VERANO) o escribirlo aquí
  const [cod, setCod] = useState(() => { try { return (new URLSearchParams(window.location.search).get("codigo") || "").toUpperCase().slice(0, 30); } catch { return ""; } });
  const [desc, setDesc] = useState(null);          // { ok, tipo, valor, tramos, minimo, codigo } o { ok:false, motivo }
  const [verCod, setVerCod] = useState(() => !!cod);
  const nEntradas = items.reduce((n, t) => n + cant[t.id], 0);
  const descOk = desc?.ok && nEntradas >= (desc.minimo || 1) ? desc : null;
  const totalFinal = descOk ? items.reduce((sum, t) => sum + precioConDescuento(t.precio, t.id, descOk) * cant[t.id], 0) : total;
  const ahorro = Math.max(0, Math.round((total - totalFinal) * 100) / 100);
  const aplicar = async (codigo = cod) => {
    const k = String(codigo || "").trim().toUpperCase();
    if (!k) { setDesc(null); return; }
    setDesc({ cargando: true });
    try {
      const { data, error } = await supabase.rpc("web_descuento_comprobar", { p_slug: ev.slug, p_codigo: k, p_email: emailOk ? c.email.trim() : null });
      if (error) throw error;
      setDesc(data || { ok: false, motivo: "descuento_no_valido" });
    } catch { setDesc({ ok: false, motivo: "red" }); }
  };
  useEffect(() => { if (cod) aplicar(cod); }, []);   // código que llega en el enlace
  const [pagando, setPagando] = useState(false);
  const set = (k, v) => setC(x => ({ ...x, [k]: v }));
  const pedir = (k) => (form[k] || "no") !== "no";
  const oblig = (k) => form[k] === "obligatorio";
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim());
  // Pago con Stripe (por ahora solo en modo pruebas con «pago de prueba» activado)
  const conPago = !ev.vista_previa && ((total > 0 && ev.modo === "pruebas" && !!ev.pago_pruebas) || (ev.modo !== "pruebas" && !!ev.cobro_real));
  const gastos = conPago ? gastosDe(totalFinal, plazas.length, ev.gastos_cfg) : 0;

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
      const comprador = { nombre: c.nombre.trim(), email: c.email.trim(), acepta: true, acepta_edad: aceptaEdad, marketing: novedades, privacidad: PRIVACIDAD_VERSION, rrpp: codigoRP(), pase: paseDe(ev.slug) };
      CAMPOS.forEach(f => { if (pedir(f.k) && c[f.k]) comprador[f.k] = String(c[f.k]).trim(); });
      if (desc?.ok) comprador.descuento = desc.codigo;
      const { data, error } = await supabase.rpc("web_comprar", {
        p_slug: ev.slug, p_items: items.map(t => ({ tramo: t.id, cantidad: cant[t.id] })), p_comprador: comprador,
        p_asistentes: plazas.map((p, i) => ({ tramo: p.tramo, nombre: as[i].nombre.trim(), dni: pedir("dni_asistente") ? as[i].dni.trim() : "" })),
      });
      if (error) throw error;
      if (!data?.ok) { const k = String(data?.motivo || ""); setErr((k.startsWith("falta_") ? `Falta: ${CAMPOS.find(f => f.k === k.slice(6))?.t || k.slice(6)}.` : ERRORES[k] || "No se ha podido completar la compra.") + (data?.tramo ? ` (${data.tramo})` : "")); setBusy(false); return; }
      try { const l = JSON.parse(localStorage.getItem(MIS) || "[]") || []; l.unshift({ slug: ev.slug, acceso: data.acceso, codigo: data.codigo, t: Date.now() }); localStorage.setItem(MIS, JSON.stringify(l.slice(0, 30))); } catch {}
      if (data.pago) {   // reservadas: se paga en Stripe y al volver salen las entradas
        setPagando(true);
        const r = await pagos(supabase, "checkout", { acceso: data.acceso });
        if (r?.url) { try { onExito && onExito(); } catch {} window.location.assign(r.url); return; }
        if (r?.pagado) { window.location.assign(`/mis-entradas/${data.acceso}?nueva=1`); return; }
        setPagando(false); setBusy(false);
        setErr(r?.motivo === "sin_pasarela" ? "El pago con tarjeta aún no está activado en este evento." : "No se ha podido abrir el pago. Inténtalo de nuevo.");
        return;
      }
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
        {gastos > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontWeight: 700, color: "var(--muted)" }}><span>Gastos de gestión</span><span>{money(gastos)}</span></div>}
        {ahorro > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontWeight: 800, color: "var(--c)" }}><span>Código {descOk.codigo}</span><span>−{money(ahorro)}</span></div>}
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--line)", marginTop: 6, paddingTop: 10, fontWeight: 900, fontSize: 20 }}><span>Total</span><span>{totalFinal ? eur(totalFinal + gastos) : "Gratis"}</span></div>
        {total > 0 && (!verCod
          ? <button type="button" onClick={() => setVerCod(true)} style={{ ...btn("transparent", "var(--c)"), padding: "12px 0 0", fontSize: 15, minHeight: 44 }}>¿Tienes un código descuento?</button>
          : <div style={{ marginTop: 12 }}>
              <label style={{ ...lbl, marginBottom: 6 }}><span>Código descuento</span>
                <span style={{ display: "flex", gap: 8 }}>
                  <input value={cod} onChange={e => { setCod(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 30)); setDesc(null); }} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); aplicar(); } }}
                    autoCapitalize="characters" autoComplete="off" enterKeyHint="done" style={{ ...inpP, flex: 1, minWidth: 0, letterSpacing: ".06em" }} />
                  <button type="button" onClick={() => aplicar()} disabled={!cod || desc?.cargando} style={{ ...btn("var(--card2)", "var(--text)"), border: "1px solid var(--line)", padding: "0 18px", minHeight: 48, fontSize: 15, flexShrink: 0 }}>{desc?.cargando ? "…" : "Aplicar"}</button>
                </span>
              </label>
              {desc && !desc.cargando && (desc.ok
                ? <div role="status" style={{ fontSize: 14, fontWeight: 800, color: "var(--c)" }}>{descOk ? `Código aplicado: ${desc.tipo === "porcentaje" ? `${Number(desc.valor)} % menos` : `${money(desc.valor)} menos por entrada`}` : `Este código es para compras de ${desc.minimo} entradas o más.`}{descOk && ahorro <= 0 ? " (no vale para las entradas elegidas)" : ""}</div>
                : <div role="alert" style={{ fontSize: 14, fontWeight: 800, color: "#ff6b6b" }}>{desc.motivo === "red" ? (navigator.onLine ? "No se ha podido comprobar el código. Vuelve a intentarlo." : "Sin conexión. Vuelve a intentarlo.") : ERRORES[desc.motivo] || "Ese código no vale."}</div>)}
            </div>)}
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
        {pagando ? "Abriendo el pago seguro…" : busy ? (conPago ? "Reservando tus entradas…" : "Emitiendo tus entradas…") : conPago || (totalFinal && ev.modo !== "pruebas" && !ev.vista_previa) ? `Pagar ${eur(totalFinal + gastos)}` : "Conseguir mis entradas"}
      </button>
      {conPago ? <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, marginTop: 8, lineHeight: 1.45 }}>Pago de PRUEBA con Stripe: usa la tarjeta 4242 4242 4242 4242, cualquier fecha futura y cualquier CVC. No se cobra nada de verdad y las entradas no valen en la puerta.</div>
        : (ev.modo === "pruebas" || ev.vista_previa) && <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, marginTop: 8 }}>Venta de prueba: no se cobra nada y las entradas no son válidas.</div>}
      {totalFinal > 0 && <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 12.5, marginTop: 8, lineHeight: 1.45 }}>Las entradas no admiten devolución. Si no puedes ir, puedes pasarla a otra persona con un cambio de nombre{ev.cambio_nombre === false ? " (este evento no lo permite)" : ""}.</div>}
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
  const cargar = () => supabase.rpc("web_pedido", { p_acceso: acceso }).then(({ data, error }) => setD(error ? "error" : data || null));
  const estado = d && d !== "error" ? d.pedido?.estado : null;
  // Recién compradas: se mandan al correo una vez (si el envío está activado), cuando ya están emitidas
  useEffect(() => {
    if (!nueva || !estado || estado === "pendiente" || estado === "anulado") return;
    const k = "tixfast_correo_" + acceso;
    try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, "1"); } catch {}
    enviarCorreo(true);
  }, [acceso, estado]);
  useEffect(() => {
    if (!/^[0-9a-f-]{36}$/i.test(acceso)) { setD(null); return; }
    cargar();
    document.title = "Mis entradas";
  }, [acceso]);
  // Vuelve de Stripe: se confirma el pago y salen las entradas
  useEffect(() => {
    if (estado !== "pendiente") return;
    let vivo = true, n = 0;
    const mirar = async () => {
      if (!vivo) return;
      try { const r = await pagos(supabase, "confirmar", { acceso }); if (r?.estado && r.estado !== "pendiente") { await cargar(); return; } } catch {}
      if (++n < 40) setTimeout(mirar, n < 10 ? 2000 : 5000); else cargar();
    };
    mirar();
    return () => { vivo = false; };
  }, [estado, acceso]);
  if (d === undefined) return <Mensaje titulo="Cargando tus entradas…" />;
  if (d === "error") return <Mensaje titulo="No se han podido cargar" texto="Revisa tu conexión y vuelve a abrir el enlace." />;
  if (!d) return <Mensaje titulo="Enlace no válido" texto="Revisa que el enlace esté completo." />;
  if (estado === "pendiente") return <Mensaje titulo="Confirmando tu pago…" texto="Un momento: en cuanto Stripe lo confirme salen tus entradas. No cierres esta página." />;
  if (estado === "anulado" && !(d.entradas || []).length) return <Mensaje titulo="El pago no se completó" texto="No se ha cobrado nada y las entradas se han liberado. Puedes volver a comprarlas.">
    {d.evento?.slug && <a href={`/e/${d.evento.slug}`} style={{ ...btn("#ff5a3c", "#fff"), marginTop: 16, textDecoration: "none" }}>Volver al evento</a>}</Mensaje>;
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
        {p.estado === "invitacion" && !nueva && <div style={{ ...card, background: "var(--c)", color: T.tinta, border: "none", marginBottom: 14, textAlign: "center" }}>
          <div style={{ fontSize: 24, fontWeight: 900 }}>Tienes una invitación</div>
          <div style={{ marginTop: 4, opacity: .95 }}>A nombre de {p.nombre}. Enseña el QR en la puerta o descarga el PDF.</div>
        </div>}
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
        <EntradasDePedido d={d} T={T} acceso={acceso} onCambio={cargar} />
        <div style={{ textAlign: "center", marginTop: 18 }}><a href={`/e/${ev.slug}`} style={{ color: "var(--muted)", fontWeight: 700 }}>Volver al evento</a></div>
      </div>
    </div>
  );
}

// Las entradas de un pedido (un evento), con su QR. Se usa en «Mis entradas» y en la compra de varios eventos
function EntradasDePedido({ d, T, acceso, onCambio }) {
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
        <CambioNombrePedido ev={ev} entradas={d.entradas} T={T} />
        {(ev.edad_minima || ev.vestimenta || ev.autorizacion_url) && <div style={{ ...card, fontSize: 14, lineHeight: 1.5 }}>
          {ev.edad_minima ? <div><b>Edad mínima:</b> {ev.edad_minima} años.</div> : null}
          {ev.vestimenta ? <div><b>Vestimenta:</b> {ev.vestimenta}</div> : null}
          {ev.autorizacion_url ? <div style={{ marginTop: 6 }}>Menores de {ev.autorizacion_edad || 16}: <a href={ev.autorizacion_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--c)", fontWeight: 800 }}>descarga la autorización</a>, rellénala y tráela impresa.</div> : null}
        </div>}
  </>);
}

/* ---------- «¿No puedes ir a la fiesta?»: cambio de nombre (de pago, el precio lo pone el organizador) ---------- */
// Lleva a la página de cambio de nombre con la entrada ya elegida (sin tener que subirla ni escanearla).
function CambioNombrePedido({ ev, entradas, T }) {
  const validas = (entradas || []).filter(x => x.estado === "valida" && !x.prueba && x.qr_hex);
  if (ev.cambio_nombre === false || !validas.length) return null;
  const precio = Number(ev.cambio_precio) || 0;
  const ir = (x) => { try { sessionStorage.setItem("tixfast_cambio_qr", textoQR(x.qr_hex)); } catch { /* sin almacenamiento: tendrá que subirla */ } window.location.assign("/cambio"); };
  return (
    <section style={{ ...card, marginBottom: 12 }}>
      <h2 style={{ fontSize: 19, margin: "0 0 6px", fontWeight: 900 }}>¿No puedes ir a la fiesta?</h2>
      <div style={{ color: "var(--muted)", fontSize: 14.5, lineHeight: 1.5 }}>
        Puedes hacer aquí el cambio de nombre de tu entrada a otra persona. Recibirá su entrada con un QR nuevo y la tuya dejará de ser válida. Las entradas no admiten devolución.
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, margin: "12px 0", padding: "10px 12px", borderRadius: 12, background: "var(--card2)", border: "1px solid var(--line)" }}>
        <span style={{ fontWeight: 700 }}>Coste del cambio de nombre</span>
        <b style={{ fontSize: 17 }}>{precio > 0 ? eur(precio) : "Gratis"}</b>
      </div>
      {validas.map(x => (
        <button key={x.numero} onClick={() => ir(x)} style={{ ...btn("var(--c)", T.tinta), width: "100%", marginTop: 8, minHeight: 50, flexWrap: "wrap", rowGap: 2 }}>
          Hacer el cambio de nombre{validas.length > 1 ? <span style={{ fontWeight: 700, opacity: .85 }}>· nº {String(x.numero).padStart(4, "0")} ({x.asistente})</span> : null}
        </button>
      ))}
      <div style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 8, lineHeight: 1.45 }}>El precio lo fija el organizador del evento. El cambio se puede hacer hasta poco antes de que empiece.</div>
    </section>
  );
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

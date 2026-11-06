// ===================== PÁGINA PÚBLICA DE VENTA =====================
// /e/<enlace>            → página del evento: flyer, tramos, cuenta atrás y compra
// /mis-entradas/<acceso> → las entradas del comprador con su QR y el PDF
// No necesita sesión. Solo habla con las funciones públicas del servidor (nunca con las tablas).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabase";
import QrCodigo from "../qr/QrCodigo";
import { base32, hexToBytes, QR_PREFIJO } from "../qr/token";

const money = (v) => { const n = Number(v) || 0; return n === 0 ? "Gratis" : n.toLocaleString("es-ES", { style: "currency", currency: "EUR" }); };
const eur = (v) => (Number(v) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
const fecha = (v, conHora = true) => { if (!v) return ""; const d = new Date(String(v).length <= 10 ? v + "T12:00" : v); if (isNaN(d)) return ""; return d.toLocaleString("es-ES", { weekday: "long", day: "numeric", month: "long", ...(conHora && String(v).length > 10 ? { hour: "2-digit", minute: "2-digit" } : {}) }); };
const hora = (v) => { if (!v) return ""; const d = new Date(v); return isNaN(d) ? "" : d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }); };
export const textoQR = (hex) => (hex ? QR_PREFIJO + base32(hexToBytes(hex)) : "");
const tintaSobre = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return "#fff"; const n = parseInt(m[1], 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); const L = .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; return 1.05 / (L + .05) >= 3 ? "#fff" : "#111"; };
const LETRA = { inter: "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", serif: "Georgia,'Times New Roman',serif", mono: "'Roboto Mono',ui-monospace,monospace" };
const MIS = "tixfast_mis_pedidos";

function tema(diseno) {
  const d = { color: "#ff5a3c", fondo: "oscuro", fondoFlyer: true, letra: "inter", ...(diseno || {}) };
  const osc = d.fondo !== "claro";
  return {
    d, osc, letra: LETRA[d.letra] || LETRA.inter, tinta: tintaSobre(d.color),
    vars: osc
      ? { "--bg": "#08090d", "--card": "rgba(22,24,32,.86)", "--card2": "#1d2029", "--text": "#f3f4f8", "--muted": "#a1a7b8", "--line": "rgba(255,255,255,.1)", "--c": d.color }
      : { "--bg": "#f6f6f8", "--card": "rgba(255,255,255,.92)", "--card2": "#f1f2f5", "--text": "#15171a", "--muted": "#666c76", "--line": "#e3e5e9", "--c": d.color },
  };
}

export default function Publico() {
  const m = window.location.pathname.match(/^\/(e|mis-entradas)\/([^/?#]+)/);
  if (!m) return <Mensaje titulo="Página no encontrada" />;
  return m[1] === "e" ? <PaginaEvento slug={decodeURIComponent(m[2]).toLowerCase()} /> : <MisEntradas acceso={m[2]} />;
}

function Mensaje({ titulo, texto, children }) {
  return (
    <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#08090d", color: "#f3f4f8", fontFamily: LETRA.inter, padding: 24, textAlign: "center" }}>
      <div style={{ maxWidth: 420 }}>
        <img src="/brand/tixfast_isotipo_app.svg" alt="TIXFAST" width="52" height="52" style={{ display: "block", margin: "0 auto 14px" }} />
        <div style={{ fontWeight: 900, fontSize: 22 }}>{titulo}</div>
        {texto && <div style={{ color: "#a1a7b8", marginTop: 8, lineHeight: 1.5 }}>{texto}</div>}
        {children}
      </div>
    </div>
  );
}

/* ===================== Página del evento ===================== */
function PaginaEvento({ slug }) {
  const [ev, setEv] = useState(undefined);       // undefined = cargando · null = no existe
  const [error, setError] = useState(false);
  const [cant, setCant] = useState({});          // { tramoId: n }
  const [paso, setPaso] = useState("elegir");    // elegir | datos
  const offset = useRef(0);                      // diferencia reloj servidor - móvil

  const cargar = async () => {
    try {
      const { data, error: e } = await supabase.rpc("web_evento_publico", { p_slug: slug });
      if (e) throw e;
      if (data?.ahora) offset.current = new Date(data.ahora).getTime() - Date.now();
      setEv(data || null); setError(false);
    } catch { setError(true); }
  };
  useEffect(() => { cargar(); const t = setInterval(cargar, 60000); return () => clearInterval(t); }, [slug]);
  useEffect(() => { if (ev?.nombre) document.title = `${ev.nombre} · Entradas`; }, [ev?.nombre]);

  if (ev === undefined && !error) return <Mensaje titulo="Cargando…" />;
  if (error && !ev) return <Mensaje titulo="No se ha podido cargar" texto="Revisa tu conexión e inténtalo de nuevo."><button onClick={cargar} style={btn("#ff5a3c", "#fff")}>Reintentar</button></Mensaje>;
  if (!ev) return <Mensaje titulo="Este evento no está disponible" texto="Puede que el enlace no sea correcto o que la venta aún no esté publicada." />;

  const T = tema(ev.diseno);
  const ahora = Date.now() + offset.current;
  const lanzamiento = ev.venta_inicio && new Date(ev.venta_inicio).getTime() > ahora;
  const tramos = ev.tramos || [];
  const enVenta = tramos.filter(t => t.estado === "venta");
  const total = tramos.reduce((s, t) => s + (cant[t.id] || 0) * Number(t.precio), 0);
  const nEnt = Object.values(cant).reduce((s, n) => s + n, 0);
  const cerrado = ev.estado === "cerrado" || (ev.fin && new Date(ev.fin).getTime() < ahora);
  const misPedidos = (() => { try { return (JSON.parse(localStorage.getItem(MIS) || "[]") || []).filter(p => p.slug === ev.slug); } catch { return []; } })();

  return (
    <div style={{ ...T.vars, minHeight: "100dvh", background: "var(--bg)", color: "var(--text)", fontFamily: T.letra, position: "relative", overflowX: "hidden" }}>
      <style>{CSS_PUB}</style>
      {T.d.fondoFlyer && ev.flyer_url && <div aria-hidden="true" style={{ position: "fixed", inset: -40, backgroundImage: `url("${ev.flyer_url}")`, backgroundSize: "cover", backgroundPosition: "center", filter: "blur(40px) saturate(1.3)", opacity: T.osc ? .35 : .22, transform: "scale(1.1)", zIndex: 0 }} />}
      <div style={{ position: "relative", zIndex: 1, maxWidth: 1080, margin: "0 auto", padding: "max(14px, env(safe-area-inset-top)) 16px calc(120px + env(safe-area-inset-bottom))" }}>
        {/* Cabecera */}
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
          {ev.logo_url ? <img src={ev.logo_url} alt="" style={{ height: 40, maxWidth: 180, objectFit: "contain" }} /> : <span />}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>Entradas con <img src="/brand/tixfast_isotipo_app.svg" alt="TIXFAST" width="18" height="18" /></span>
        </header>
        {ev.vista_previa && <Aviso c="#ffb400">Vista previa: solo tú ves esta página. Las compras son de prueba.</Aviso>}
        {!ev.vista_previa && ev.modo === "pruebas" && <Aviso c="#ffb400">Venta de prueba: las entradas que se emiten no son válidas.</Aviso>}

        <div className="pub-grid">
          {/* Flyer */}
          <div className="pub-flyer">
            {ev.flyer_url ? <img src={ev.flyer_url} alt={`Cartel de ${ev.nombre}`} style={{ width: "100%", display: "block", borderRadius: 20, boxShadow: "0 30px 60px -20px rgba(0,0,0,.6)" }} />
              : <div style={{ aspectRatio: "4/5", borderRadius: 20, background: `linear-gradient(150deg, ${T.d.color}, #111)` }} />}
          </div>

          {/* Info + entradas */}
          <div>
            <h1 style={{ fontSize: "clamp(30px, 6vw, 48px)", lineHeight: 1.02, letterSpacing: "-.03em", margin: "4px 0 12px", fontWeight: 900, overflowWrap: "anywhere" }}>{ev.nombre}</h1>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 16 }}>
              <Linea ico="cal">{fecha(ev.inicio || ev.fecha)}{ev.fin ? ` · hasta las ${hora(ev.fin)}` : ""}</Linea>
              {(ev.recinto || ev.direccion) && <Linea ico="pin">{[ev.recinto, ev.direccion].filter(Boolean).join(" · ")}{ev.maps_url && <> · <a href={ev.maps_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--c)", fontWeight: 800 }}>Cómo llegar</a></>}</Linea>}
            </div>
            {(ev.edad_minima || ev.vestimenta) && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
              {ev.edad_minima ? <Chip>+{ev.edad_minima} años</Chip> : null}
              {ev.vestimenta ? <Chip>Vestimenta: {ev.vestimenta}</Chip> : null}
            </div>}

            {misPedidos.length > 0 && <div style={{ ...card, marginTop: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ flex: 1, minWidth: 180, fontWeight: 700 }}>Ya tienes entradas para este evento en este móvil.</span>
              <a href={`/mis-entradas/${misPedidos[0].acceso}`} style={{ ...btn("var(--card2)", "var(--text)"), textDecoration: "none", border: "1px solid var(--line)" }}>Ver mis entradas</a>
            </div>}

            {lanzamiento ? <CuentaAtras hasta={ev.venta_inicio} offset={offset.current} color={T.d.color} onFin={cargar} />
              : cerrado ? <div style={{ ...card, marginTop: 20, textAlign: "center", fontWeight: 800, fontSize: 18 }}>La venta online ha terminado.</div>
              : paso === "elegir" ? (
                <section style={{ marginTop: 22 }}>
                  <h2 style={{ fontSize: 22, margin: "0 0 12px", fontWeight: 900 }}>Entradas</h2>
                  {tramos.length === 0 && <div style={card}>Aún no hay entradas a la venta.</div>}
                  {tramos.map((t, i) => <Tramo key={t.id} t={t} sig={tramos.slice(i + 1).find(x => x.estado === "proximo")} avisos={ev.avisos || {}} n={cant[t.id] || 0} T={T}
                    onN={(n) => setCant(c => ({ ...c, [t.id]: n }))} />)}
                  {enVenta.length === 0 && tramos.length > 0 && <div style={{ ...card, marginTop: 8, fontWeight: 700 }}>Ahora mismo no hay entradas a la venta.</div>}
                </section>
              ) : <Formulario ev={ev} tramos={tramos} cant={cant} total={total} T={T} onVolver={() => setPaso("elegir")} />}

            {ev.descripcion && <section style={{ ...card, marginTop: 22 }}><h2 style={{ fontSize: 18, margin: "0 0 8px", fontWeight: 900 }}>Sobre el evento</h2><div style={{ whiteSpace: "pre-wrap", lineHeight: 1.55, color: "var(--text)", opacity: .92 }}>{ev.descripcion}</div></section>}
            {ev.autorizacion_url && <section style={{ ...card, marginTop: 12 }}>
              <b>¿Vienen menores de {ev.autorizacion_edad || 16} años?</b>
              <div style={{ color: "var(--muted)", marginTop: 4, lineHeight: 1.45 }}>Descarga la autorización, imprímela, rellénala y tráela firmada el día del evento.</div>
              <a href={ev.autorizacion_url} target="_blank" rel="noopener noreferrer" style={{ ...btn("var(--card2)", "var(--text)"), display: "inline-flex", marginTop: 10, textDecoration: "none", border: "1px solid var(--line)" }}>Descargar autorización (PDF)</a>
            </section>}
          </div>
        </div>
      </div>

      {/* Barra fija: total y continuar */}
      {!lanzamiento && !cerrado && paso === "elegir" && nEnt > 0 && (
        <div className="pub-barra">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 700 }}>{nEnt} {nEnt === 1 ? "entrada" : "entradas"}</div>
            <div style={{ fontSize: 24, fontWeight: 900 }}>{total ? eur(total) : "Gratis"}</div>
          </div>
          <button onClick={() => { setPaso("datos"); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ ...btn(T.d.color, T.tinta), padding: "16px 26px", fontSize: 17 }}>Continuar →</button>
        </div>
      )}
    </div>
  );
}

const card = { background: "var(--card)", border: "1px solid var(--line)", borderRadius: 18, padding: 16, backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" };
const btn = (bg, color) => ({ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, background: bg, color, border: "none", borderRadius: 14, padding: "13px 20px", fontWeight: 900, fontSize: 16, cursor: "pointer", fontFamily: "inherit" });
const Chip = ({ children }) => <span style={{ border: "1px solid var(--line)", background: "var(--card)", borderRadius: 30, padding: "7px 13px", fontSize: 14, fontWeight: 800 }}>{children}</span>;
const Aviso = ({ c, children }) => <div role="status" style={{ background: c, color: "#1a1205", borderRadius: 12, padding: "10px 14px", fontWeight: 800, fontSize: 14, marginBottom: 14 }}>{children}</div>;
const ICO = { cal: "M4 6h16v15H4zM4 10h16M8 3v4M16 3v4", pin: "M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" };
const Linea = ({ ico, children }) => (
  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--c)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true"><path d={ICO[ico]} /></svg>
    <span style={{ fontWeight: 600, lineHeight: 1.4, textTransform: "none" }}>{children}</span>
  </div>
);

/* ---------- Un tramo ---------- */
function Tramo({ t, sig, avisos, n, T, onN }) {
  const venta = t.estado === "venta";
  const max = Math.max(0, Math.min(t.max_por_compra || 10, t.quedan ?? 99));
  const pctVend = t.cantidad ? Math.round((1 - (t.quedan ?? 0) / t.cantidad) * 100) : null;
  const umbralN = parseInt(avisos.umbralN, 10);
  const pocas = venta && avisos.activo !== false && t.cantidad && t.quedan != null && t.quedan > 0 &&
    ((Number.isFinite(umbralN) && t.quedan <= umbralN) || t.quedan / t.cantidad * 100 <= (avisos.umbralPct ?? 15));
  const etiqueta = t.estado === "agotado" ? "Agotado" : t.estado === "finalizado" ? "Finalizado" : t.estado === "proximo" ? (t.venta_inicio ? `Desde el ${fecha(t.venta_inicio)}` : "Próximamente") : null;
  return (
    <div style={{ ...card, marginBottom: 10, display: "flex", flexDirection: "column", gap: 10, opacity: venta ? 1 : .6, borderColor: n ? "var(--c)" : "var(--line)", boxShadow: n ? "0 0 0 1px var(--c)" : "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: 18, textDecoration: t.estado === "agotado" ? "line-through" : "none" }}>{t.nombre}</div>
          {t.descripcion && <div style={{ color: "var(--muted)", fontSize: 14, marginTop: 2 }}>{t.descripcion}</div>}
          {t.copas > 0 && <div style={{ color: "var(--muted)", fontSize: 14, marginTop: 2 }}>Incluye {t.copas} {t.copas === 1 ? "copa" : "copas"}</div>}
        </div>
        <div style={{ fontWeight: 900, fontSize: 22, color: venta ? "var(--c)" : "var(--muted)", flexShrink: 0 }}>{money(t.precio)}</div>
      </div>
      {pocas && <div className="pub-pulso" style={{ alignSelf: "flex-start", background: "var(--c)", color: T.tinta, borderRadius: 30, padding: "5px 12px", fontWeight: 900, fontSize: 13 }}>
        {Number.isFinite(umbralN) && t.quedan <= umbralN ? `¡Últimas ${t.quedan} entradas!` : "¡Quedan pocas!"}</div>}
      {venta && avisos.mostrarVendido !== false && pctVend != null && pctVend >= 30 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 800, color: "var(--muted)" }}>
          <span style={{ flex: 1, height: 6, borderRadius: 6, background: "var(--card2)", overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${pctVend}%`, background: "var(--c)" }} /></span>{pctVend} % vendido
        </div>)}
      {venta && avisos.siguientePrecio !== false && sig && Number(sig.precio) > Number(t.precio) && <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 700 }}>Después sube a {eur(sig.precio)}</div>}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        {etiqueta ? <span style={{ fontWeight: 900, color: "var(--muted)" }}>{etiqueta}</span> : <span style={{ fontSize: 13, color: "var(--muted)" }}>Máx. {t.max_por_compra} por compra</span>}
        {venta && <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button aria-label={`Quitar una entrada ${t.nombre}`} disabled={n <= 0} onClick={() => onN(Math.max(0, n - 1))} style={{ ...stepBtn, opacity: n <= 0 ? .35 : 1 }}>−</button>
          <span aria-live="polite" style={{ minWidth: 30, textAlign: "center", fontWeight: 900, fontSize: 20 }}>{n}</span>
          <button aria-label={`Añadir una entrada ${t.nombre}`} disabled={n >= max} onClick={() => onN(Math.min(max, n + 1))} style={{ ...stepBtn, background: "var(--c)", color: T.tinta, borderColor: "var(--c)", opacity: n >= max ? .35 : 1 }}>+</button>
        </div>}
      </div>
    </div>
  );
}
const stepBtn = { width: 44, height: 44, borderRadius: 12, border: "1px solid var(--line)", background: "var(--card2)", color: "var(--text)", fontSize: 24, fontWeight: 800, cursor: "pointer", lineHeight: 1, fontFamily: "inherit" };

/* ---------- Cuenta atrás de lanzamiento ---------- */
function CuentaAtras({ hasta, offset, color, onFin }) {
  const [ahora, setAhora] = useState(Date.now() + offset);
  useEffect(() => { const t = setInterval(() => setAhora(Date.now() + offset), 250); return () => clearInterval(t); }, [offset]);
  const ms = Math.max(0, new Date(hasta).getTime() - ahora);
  useEffect(() => { if (ms === 0) { const t = setTimeout(onFin, 800); return () => clearTimeout(t); } }, [ms === 0]);
  const s = Math.floor(ms / 1000), u = [[Math.floor(s / 86400), "días"], [Math.floor(s % 86400 / 3600), "horas"], [Math.floor(s % 3600 / 60), "min"], [s % 60, "seg"]];
  return (
    <section style={{ ...card, marginTop: 22, textAlign: "center", padding: "22px 14px" }}>
      <div style={{ fontWeight: 900, letterSpacing: 2, textTransform: "uppercase", fontSize: 13, color: "var(--muted)" }}>La venta empieza en</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8, margin: "14px 0 10px" }}>
        {u.map(([v, l]) => <div key={l} style={{ background: "var(--card2)", borderRadius: 14, padding: "12px 4px", border: "1px solid var(--line)" }}>
          <div style={{ fontSize: "clamp(30px, 9vw, 52px)", fontWeight: 900, color, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{String(v).padStart(2, "0")}</div>
          <div style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)", marginTop: 4 }}>{l}</div>
        </div>)}
      </div>
      <div style={{ fontWeight: 700 }}>{fecha(hasta)}</div>
    </section>
  );
}

/* ---------- Datos y compra ---------- */
const CAMPOS = [
  { k: "telefono", t: "Teléfono", type: "tel", ac: "tel" }, { k: "dni", t: "DNI / NIE", ac: "off" }, { k: "nacimiento", t: "Fecha de nacimiento", type: "date", ac: "bday" },
  { k: "cp", t: "Código postal", ac: "postal-code", im: "numeric" }, { k: "direccion", t: "Dirección", ac: "street-address" }, { k: "ciudad", t: "Ciudad", ac: "address-level2" },
  { k: "genero", t: "Género", sel: ["Mujer", "Hombre", "No binario", "Prefiero no decirlo"] },
];
const ERRORES = {
  email: "Revisa el correo.", nombre: "Escribe tu nombre completo.", condiciones: "Tienes que aceptar las condiciones.", edad: "Confirma la edad mínima.",
  vacio: "Elige al menos una entrada.", cantidad: "Demasiadas entradas en una compra.", asistentes: "Falta el nombre de algún asistente.", nombre_asistente: "Escribe el nombre completo de cada asistente.",
  limite_email: "Has llegado al máximo de entradas por persona para este evento.", tramo_proximo: "Ese tramo aún no está a la venta.", tramo_agotado: "Ese tramo se acaba de agotar.",
  tramo_finalizado: "Ese tramo ya no está a la venta.", max_compra: "Superas el máximo por compra de un tramo.", sin_sitio: "No quedan tantas entradas en ese tramo.",
  pago_no_disponible: "El pago online aún no está disponible para este evento.", demasiados_intentos: "Demasiados intentos seguidos. Espera unos minutos.", cerrado: "La venta está cerrada.", no_existe: "El evento ya no existe.",
};
function Formulario({ ev, tramos, cant, total, T, onVolver }) {
  const form = ev.formulario || {};
  const items = tramos.filter(t => cant[t.id] > 0);
  const plazas = items.flatMap(t => Array.from({ length: cant[t.id] }, (_, k) => ({ tramo: t.id, nombreTramo: t.nombre, k })));
  const [c, setC] = useState({ nombre: "", email: "", email2: "" });
  const [as, setAs] = useState(() => plazas.map(() => ({ nombre: "", dni: "" })));
  const [acepta, setAcepta] = useState(false);
  const [aceptaEdad, setAceptaEdad] = useState(false);
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
      const comprador = { nombre: c.nombre.trim(), email: c.email.trim(), acepta: true, acepta_edad: aceptaEdad };
      CAMPOS.forEach(f => { if (pedir(f.k) && c[f.k]) comprador[f.k] = String(c[f.k]).trim(); });
      const { data, error } = await supabase.rpc("web_comprar", {
        p_slug: ev.slug, p_items: items.map(t => ({ tramo: t.id, cantidad: cant[t.id] })), p_comprador: comprador,
        p_asistentes: plazas.map((p, i) => ({ tramo: p.tramo, nombre: as[i].nombre.trim(), dni: pedir("dni_asistente") ? as[i].dni.trim() : "" })),
      });
      if (error) throw error;
      if (!data?.ok) { const k = String(data?.motivo || ""); setErr((k.startsWith("falta_") ? `Falta: ${CAMPOS.find(f => f.k === k.slice(6))?.t || k.slice(6)}.` : ERRORES[k] || "No se ha podido completar la compra.") + (data?.tramo ? ` (${data.tramo})` : "")); setBusy(false); return; }
      try { const l = JSON.parse(localStorage.getItem(MIS) || "[]") || []; l.unshift({ slug: ev.slug, acceso: data.acceso, codigo: data.codigo, t: Date.now() }); localStorage.setItem(MIS, JSON.stringify(l.slice(0, 30))); } catch {}
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
        <Check v={acepta} on={setAcepta}>Acepto las condiciones de compra y que mis datos se usen para gestionar mis entradas. Las entradas son nominativas, de un solo uso y no se pueden revender.</Check>
      </div>

      {err && <div role="alert" style={{ marginTop: 12, background: "#c62828", color: "#fff", borderRadius: 12, padding: "12px 14px", fontWeight: 800 }}>{err}</div>}
      <button type="submit" disabled={busy} style={{ ...btn(T.d.color, T.tinta), width: "100%", marginTop: 14, padding: "18px", fontSize: 18, opacity: busy ? .6 : 1 }}>
        {busy ? "Emitiendo tus entradas…" : total && ev.modo !== "pruebas" && !ev.vista_previa ? `Pagar ${eur(total)}` : "Conseguir mis entradas"}
      </button>
      {(ev.modo === "pruebas" || ev.vista_previa) && <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, marginTop: 8 }}>Venta de prueba: no se cobra nada y las entradas no son válidas.</div>}
    </form>
  );
}
const lbl = { display: "flex", flexDirection: "column", gap: 6, marginBottom: 12, fontWeight: 800, fontSize: 14 };
const inpP = { width: "100%", boxSizing: "border-box", background: "var(--card2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 12, padding: "13px 14px", fontSize: 16, fontFamily: "inherit", outline: "none" };
const Campo = ({ l, v, on, type = "text", ac, im, sub }) => (
  <label style={lbl}><span>{l}</span><input type={type} value={v} onChange={e => on(e.target.value)} autoComplete={ac} inputMode={im} style={inpP} />{sub && <span style={{ fontWeight: 600, fontSize: 12.5, color: "var(--muted)" }}>{sub}</span>}</label>
);
const Check = ({ v, on, children }) => (
  <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", lineHeight: 1.4, fontSize: 14.5 }}>
    <input type="checkbox" checked={v} onChange={e => on(e.target.checked)} style={{ width: 22, height: 22, flexShrink: 0, accentColor: "var(--c)", marginTop: 1 }} /><span>{children}</span>
  </label>
);

/* ===================== Mis entradas ===================== */
function MisEntradas({ acceso }) {
  const [d, setD] = useState(undefined);
  const [pdf, setPdf] = useState(false);
  const nueva = new URLSearchParams(window.location.search).has("nueva");
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
        </div>
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
        <div style={{ textAlign: "center", marginTop: 18 }}><a href={`/e/${ev.slug}`} style={{ color: "var(--muted)", fontWeight: 700 }}>Volver al evento</a></div>
      </div>
    </div>
  );
}

const CSS_PUB = `
*{box-sizing:border-box}
body{margin:0}
.pub-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:20px}
@media (min-width:860px){.pub-grid{grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);gap:36px;align-items:start}.pub-flyer{position:sticky;top:20px}}
.pub-barra{position:fixed;left:0;right:0;bottom:0;z-index:20;display:flex;align-items:center;gap:14px;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:var(--card);border-top:1px solid var(--line);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}
@media (min-width:860px){.pub-barra{left:50%;right:auto;bottom:18px;transform:translateX(-50%);width:min(620px,calc(100vw - 32px));border:1px solid var(--line);border-radius:18px;box-shadow:0 20px 50px rgba(0,0,0,.35)}}
@keyframes pubPulso{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
.pub-pulso{animation:pubPulso 1.6s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.pub-pulso{animation:none}}
button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid var(--c);outline-offset:2px}
`;

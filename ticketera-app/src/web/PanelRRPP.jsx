// ===================== PANEL DEL RRPP =====================
// /rp/<acceso>: el enlace personal que el organizador le manda por WhatsApp. Sin cuenta ni contraseña.
// El RRPP ve SOLO lo suyo: sus eventos, su enlace y su QR, sus ventas y su comisión.
// Puede vender en efectivo (emite las entradas al momento) y anular una venta suya en los 15 minutos siguientes.
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../supabase";
import QrCodigo from "../qr/QrCodigo";
import { eur, fecha, hora, cap, tema, Mensaje, card, btn, CAMPOS, ERRORES, Campo, Check, lbl, inpP, stepBtn, CSS_PUB } from "./comun";

const T = tema({ color: "#ff5a3c" });
const ORIGEN = typeof window !== "undefined" ? window.location.origin : "";
const enlaceDe = (ev, codigo) => `${ORIGEN}/e/${ev.slug}?rp=${codigo}`;
const telWa = (t) => { const d = String(t || "").replace(/\D/g, ""); return d.length === 9 ? "34" + d : d; };
const wa = (texto, tel) => `https://wa.me/${tel ? telWa(tel) : ""}?text=${encodeURIComponent(texto)}`;
const num2 = (v) => (Number(v) || 0).toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function textoComision(c, tramos = []) {
  if (!c) return "Sin comisión configurada";
  if (c.tipo === "porcentaje") return Number(c.valor) ? `${num2(c.valor)} % del precio de cada entrada` : "Sin comisión configurada";
  if (c.tipo === "tramos") {
    const l = tramos.filter(t => Number(c.tramos?.[t.id]) > 0).map(t => `${t.nombre} ${eur(c.tramos[t.id])}`);
    return l.length ? `Según la entrada: ${l.join(" · ")}` : "Sin comisión configurada";
  }
  return Number(c.valor) ? `${eur(c.valor)} por entrada` : "Sin comisión configurada";
}

export default function PanelRRPP({ acceso }) {
  const [d, setD] = useState(undefined);
  const [vista, setVista] = useState("eventos");
  const [vender, setVender] = useState(null);     // evento en el que vende en efectivo
  const [qr, setQr] = useState(null);             // evento cuyo QR se enseña en grande
  const [aviso, setAviso] = useState("");
  const valido = /^[0-9a-f-]{36}$/i.test(acceso);
  const cargar = async () => {
    if (!valido) { setD(null); return; }
    try { const { data, error } = await supabase.rpc("rrpp_panel", { p_acceso: acceso }); if (error) throw error; setD(data || null); }
    catch { setD(x => x === undefined ? "error" : x); }
  };
  useEffect(() => {
    cargar(); document.title = "Mi panel de RRPP";
    const t = setInterval(() => { if (document.visibilityState !== "hidden") cargar(); }, 30000);
    return () => clearInterval(t);
  }, [acceso]);
  const avisar = (m) => { setAviso(m); setTimeout(() => setAviso(""), 2600); };

  if (d === undefined) return <Mensaje titulo="Cargando tu panel…" />;
  if (d === "error") return <Mensaje titulo="No se ha podido cargar" texto="Revisa tu conexión y vuelve a abrir el enlace."><button onClick={() => { setD(undefined); cargar(); }} style={{ ...btn("#ff5a3c", "#fff"), marginTop: 16 }}>Reintentar</button></Mensaje>;
  if (!d) return <Mensaje titulo="Enlace no válido" texto="Este enlace ya no funciona. Pide al organizador que te mande uno nuevo." />;

  const r = d.rrpp, eventos = d.eventos || [];
  const total = eventos.reduce((s, e) => s + Number(e.comision_total || 0), 0);
  const copiar = async (t, msg = "Enlace copiado") => { try { await navigator.clipboard.writeText(t); avisar(msg); } catch { avisar("No se ha podido copiar"); } };
  const compartir = async (ev) => {
    const url = enlaceDe(ev, r.codigo), texto = `🎟️ Entradas para ${ev.nombre}${ev.fecha ? ` · ${fecha(ev.fecha, false)}` : ""}`;
    if (navigator.share) { try { await navigator.share({ title: ev.nombre, text: texto, url }); return; } catch (e) { if (e?.name === "AbortError") return; } }
    window.open(wa(`${texto}\n${url}`), "_blank", "noopener");
  };

  return (
    <div style={{ ...T.vars, minHeight: "100dvh", background: "var(--bg)", color: "var(--text)", fontFamily: T.letra }}>
      <style>{CSS_PUB}</style>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "18px 16px calc(40px + env(safe-area-inset-bottom))" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <img src="/brand/tixfast_isotipo_app.svg" alt="" width="40" height="40" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 20, lineHeight: 1.15 }}>Hola, {String(r.nombre).split(" ")[0]}</div>
            <div style={{ color: "var(--muted)", fontSize: 13.5, fontWeight: 700 }}>RRPP de {d.organizador} · código <b style={{ color: "var(--text)", letterSpacing: 1 }}>{r.codigo}</b></div>
          </div>
        </header>

        <div style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 800 }}>Tu comisión acumulada</div>
            <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: -.5 }}>{eur(total)}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 13, color: "var(--muted)", fontWeight: 700, lineHeight: 1.5 }}>
            {eventos.reduce((s, e) => s + Number(e.online || 0) + Number(e.efectivo_n || 0), 0)} entradas vendidas<br />
            {eventos.length} {eventos.length === 1 ? "evento" : "eventos"}
          </div>
        </div>

        <div role="tablist" style={{ display: "flex", gap: 6, background: "var(--card2)", border: "1px solid var(--line)", borderRadius: 14, padding: 4, marginBottom: 14 }}>
          {[["eventos", "Mis eventos"], ["ventas", "Mis ventas"]].map(([k, t]) => (
            <button key={k} role="tab" aria-selected={vista === k} onClick={() => setVista(k)} style={{ flex: 1, border: "none", borderRadius: 10, padding: "11px 8px", fontWeight: 900, fontSize: 15, cursor: "pointer", fontFamily: "inherit", background: vista === k ? "var(--c)" : "transparent", color: vista === k ? T.tinta : "var(--text)" }}>{t}</button>))}
        </div>

        {vista === "eventos" && (eventos.length ? eventos.map(ev => (
          <TarjetaEvento key={ev.id} ev={ev} codigo={r.codigo} onCopiar={() => copiar(enlaceDe(ev, r.codigo))} onCompartir={() => compartir(ev)} onQr={() => setQr(ev)} onVender={() => setVender(ev)} />
        )) : <div style={{ ...card, color: "var(--muted)", textAlign: "center" }}>Todavía no tienes eventos asignados. Cuando el organizador publique uno, aparecerá aquí con tu enlace.</div>)}

        {vista === "ventas" && <Ventas ventas={d.ventas || []} acceso={acceso} onCambio={cargar} avisar={avisar} copiar={copiar} />}

        <div style={{ color: "var(--muted)", fontSize: 12.5, textAlign: "center", marginTop: 22, lineHeight: 1.5 }}>
          Este enlace es personal: no lo compartas. Para vender, comparte tu enlace de cada evento.<br />Si lo pierdes, pide uno nuevo al organizador.
        </div>
      </div>

      {qr && <Hoja titulo={qr.nombre} onClose={() => setQr(null)}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 16, display: "grid", placeItems: "center" }}>
          <QrCodigo texto={enlaceDe(qr, r.codigo)} mm={60} style={{ width: "min(70vw, 280px)", height: "auto" }} />
        </div>
        <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 14, marginTop: 12 }}>Que lo escaneen con la cámara: compran con tu código {r.codigo}.</div>
      </Hoja>}
      {vender && <VentaEfectivo ev={vender} acceso={acceso} onClose={() => setVender(null)} onHecho={() => { cargar(); }} avisar={avisar} />}
      {aviso && <div role="status" style={{ position: "fixed", left: "50%", bottom: "calc(22px + env(safe-area-inset-bottom))", transform: "translateX(-50%)", background: "#15171c", color: "#fff", borderRadius: 12, padding: "11px 16px", fontWeight: 800, zIndex: 90, boxShadow: "0 10px 30px rgba(0,0,0,.4)" }}>{aviso}</div>}
    </div>
  );
}

function TarjetaEvento({ ev, codigo, onCopiar, onCompartir, onQr, onVender }) {
  const tramos = ev.tramos || [];
  const aLaVenta = tramos.some(t => t.estado === "venta");
  const l = ev.liquidacion;
  const n = Number(ev.online || 0) + Number(ev.efectivo_n || 0);
  return (
    <section style={{ ...card, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: 18, lineHeight: 1.2 }}>{ev.nombre}</div>
          <div style={{ color: "var(--muted)", fontSize: 13.5, fontWeight: 700, marginTop: 2 }}>{cap([fecha(ev.fecha, false), ev.recinto].filter(Boolean).join(" · "))}</div>
        </div>
        {ev.modo === "pruebas" && <span style={{ background: "#ffb400", color: "#1a1205", borderRadius: 8, padding: "3px 8px", fontSize: 12, fontWeight: 900, flexShrink: 0 }}>PRUEBAS</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8, marginTop: 14 }}>
        <Dato t="Por tu enlace" v={ev.online} />
        <Dato t="En efectivo" v={ev.efectivo_n} sub={Number(ev.efectivo_importe) ? eur(ev.efectivo_importe) : ""} />
        <Dato t="Comisión" v={eur(ev.comision_total)} fuerte />
      </div>
      <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>Ganas: {textoComision(ev.comision, tramos)}{Number(ev.pruebas) ? ` · ${ev.pruebas} de prueba (no cuentan)` : ""}</div>

      {l && <div style={{ marginTop: 10, borderRadius: 12, padding: "10px 12px", fontWeight: 800, fontSize: 14, background: Number(l.resultado) < 0 ? "rgba(255,180,0,.14)" : "rgba(34,211,166,.14)", border: `1px solid ${Number(l.resultado) < 0 ? "rgba(255,180,0,.4)" : "rgba(34,211,166,.4)"}` }}>
        Liquidado: {l.entradas} entradas · comisión {eur(l.comision)}{Number(l.efectivo) ? ` · efectivo que tenías ${eur(l.efectivo)}` : ""}
        <div style={{ marginTop: 2 }}>{Number(l.resultado) > 0 ? `Te pagan ${eur(l.resultado)}` : Number(l.resultado) < 0 ? `Entregas ${eur(-l.resultado)} al organizador` : "Cuentas a cero"}</div>
      </div>}

      <div style={{ marginTop: 14, background: "var(--card2)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px", fontSize: 13.5, fontWeight: 700, wordBreak: "break-all" }}>
        {ORIGEN.replace(/^https?:\/\//, "")}/e/{ev.slug}?rp={codigo}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 8 }}>
        <button onClick={onCompartir} style={{ ...btn("var(--c)", T.tinta), padding: "12px 6px", fontSize: 14.5 }}>Compartir</button>
        <button onClick={onCopiar} style={{ ...btn("var(--card2)", "var(--text)"), padding: "12px 6px", fontSize: 14.5, border: "1px solid var(--line)" }}>Copiar</button>
        <button onClick={onQr} style={{ ...btn("var(--card2)", "var(--text)"), padding: "12px 6px", fontSize: 14.5, border: "1px solid var(--line)" }}>Ver QR</button>
      </div>
      {ev.efectivo && aLaVenta && !l && <button onClick={onVender} style={{ ...btn("transparent", "var(--text)"), width: "100%", marginTop: 8, border: "2px solid var(--c)" }}>💶 Vender en efectivo</button>}
      {!aLaVenta && <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 10 }}>{n ? "La venta de este evento está cerrada." : "Las entradas de este evento aún no están a la venta."}</div>}
    </section>
  );
}

const Dato = ({ t, v, sub, fuerte }) => (
  <div style={{ background: "var(--card2)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 10px" }}>
    <div style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 800 }}>{t}</div>
    <div style={{ fontSize: fuerte ? 18 : 20, fontWeight: 900, color: fuerte ? "var(--c)" : "var(--text)", marginTop: 2 }}>{v ?? 0}</div>
    {sub && <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>{sub}</div>}
  </div>
);

function Ventas({ ventas, acceso, onCambio, avisar, copiar }) {
  const [busy, setBusy] = useState("");
  const anular = async (v) => {
    if (!window.confirm(`¿Anular la venta de ${v.comprador} (${v.entradas} ${v.entradas === 1 ? "entrada" : "entradas"})? Las entradas dejarán de valer y tendrás que devolverle el dinero.`)) return;
    setBusy(v.acceso);
    try {
      const { data, error } = await supabase.rpc("rrpp_anular_venta", { p_acceso: acceso, p_pedido: v.acceso });
      if (error || !data?.ok) avisar(data?.motivo === "tarde" ? "Han pasado más de 15 minutos: pídeselo al organizador" : "No se ha podido anular");
      else { avisar("Venta anulada"); onCambio(); }
    } finally { setBusy(""); }
  };
  if (!ventas.length) return <div style={{ ...card, color: "var(--muted)", textAlign: "center" }}>Aún no hay ventas a tu nombre. Comparte tu enlace o vende en efectivo.</div>;
  return (
    <div style={{ ...card, padding: 6 }}>
      {ventas.map((v, i) => (
        <div key={i} style={{ padding: "12px 10px", borderTop: i ? "1px solid var(--line)" : "none", opacity: v.anulado ? .5 : 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 900, fontSize: 15.5 }}>{v.comprador} · {v.entradas} {v.entradas === 1 ? "entrada" : "entradas"}</div>
              <div style={{ color: "var(--muted)", fontSize: 13, fontWeight: 700 }}>{v.evento} · {new Date(v.creado_en).toLocaleDateString("es-ES", { day: "numeric", month: "short" })} {hora(v.creado_en)}</div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontWeight: 900 }}>{v.anulado ? "Anulada" : v.efectivo ? eur(v.total) : "Enlace"}</div>
              <div style={{ fontSize: 12, fontWeight: 800, color: v.prueba ? "#ffb400" : "var(--muted)" }}>{v.prueba ? "Prueba" : v.efectivo ? "Efectivo" : "Online"}</div>
            </div>
          </div>
          {v.efectivo && v.acceso && !v.anulado && <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <a href={wa(`Tus entradas 🎟️ ${ORIGEN}/mis-entradas/${v.acceso}`)} target="_blank" rel="noopener noreferrer" style={{ ...btn("var(--card2)", "var(--text)"), padding: "8px 12px", fontSize: 13.5, border: "1px solid var(--line)", textDecoration: "none" }}>Reenviar por WhatsApp</a>
            <button onClick={() => copiar(`${ORIGEN}/mis-entradas/${v.acceso}`, "Enlace de las entradas copiado")} style={{ ...btn("var(--card2)", "var(--text)"), padding: "8px 12px", fontSize: 13.5, border: "1px solid var(--line)" }}>Copiar enlace</button>
            {v.anulable && <button disabled={busy === v.acceso} onClick={() => anular(v)} style={{ ...btn("transparent", "#ff6b6b"), padding: "8px 12px", fontSize: 13.5, border: "1px solid rgba(255,107,107,.5)" }}>Anular</button>}
          </div>}
        </div>))}
    </div>
  );
}

function Hoja({ titulo, onClose, children }) {
  useEffect(() => { const k = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={titulo} onClick={onClose} style={{ ...T.vars, position: "fixed", inset: 0, zIndex: 70, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "flex-end", justifyContent: "center", fontFamily: T.letra }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#15171e", color: "var(--text)", width: "100%", maxWidth: 560, maxHeight: "92dvh", overflow: "auto", borderRadius: "22px 22px 0 0", padding: "18px 16px calc(22px + env(safe-area-inset-bottom))", border: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
          <b style={{ fontSize: 19 }}>{titulo}</b>
          <button onClick={onClose} aria-label="Cerrar" style={{ ...btn("var(--card2)", "var(--text)"), padding: "8px 12px", fontSize: 14, border: "1px solid var(--line)" }}>Cerrar</button>
        </div>
        {children}
      </div>
    </div>, document.body);
}

/* ---------- Venta en efectivo: el RRPP cobra en mano y las entradas se emiten al momento ---------- */
function VentaEfectivo({ ev, acceso, onClose, onHecho, avisar }) {
  const tramos = (ev.tramos || []).filter(t => t.estado === "venta");
  const form = ev.formulario || {};
  const oblig = (k) => form[k] === "obligatorio";
  const [cant, setCant] = useState(() => (tramos.length === 1 ? { [tramos[0].id]: 1 } : {}));
  const [c, setC] = useState({ nombre: "", email: "", telefono: "" });
  const [porEntrada, setPorEntrada] = useState(false);
  const [as, setAs] = useState({});
  const [cobrado, setCobrado] = useState(false);
  const [edad, setEdad] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [hecho, setHecho] = useState(null);
  const set = (k, v) => setC(x => ({ ...x, [k]: v }));
  const plazas = useMemo(() => tramos.flatMap(t => Array.from({ length: cant[t.id] || 0 }, (_, k) => ({ tramo: t.id, nombreTramo: t.nombre, k }))), [cant]);
  const total = tramos.reduce((s, t) => s + (cant[t.id] || 0) * Number(t.precio || 0), 0);
  const prueba = ev.modo === "pruebas";
  const extra = CAMPOS.filter(f => oblig(f.k) && f.k !== "telefono");

  const enviar = async (e) => {
    e.preventDefault(); setErr("");
    if (!plazas.length) return setErr("Elige al menos una entrada.");
    if (c.nombre.trim().length < 3) return setErr("Escribe el nombre y apellido del comprador.");
    if (c.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim())) return setErr("Revisa el correo (o déjalo vacío).");
    if (oblig("telefono") && !c.telefono.trim()) return setErr("Falta el teléfono.");
    for (const f of extra) if (!String(c[f.k] || "").trim()) return setErr(`Falta: ${f.t}.`);
    const nombres = plazas.map((p, i) => (porEntrada ? (as[i]?.nombre || "") : c.nombre).trim());
    if (nombres.some(n => n.length < 3)) return setErr("Escribe el nombre de cada asistente.");
    if (oblig("dni_asistente") && plazas.some((p, i) => !(as[i]?.dni || "").trim())) return setErr("Falta el DNI de algún asistente.");
    if (ev.edad_minima && !edad) return setErr(ERRORES.edad);
    if (!cobrado) return setErr(prueba ? "Confirma que es una venta de prueba." : `Confirma que has cobrado ${eur(total)}.`);
    setBusy(true);
    try {
      const comprador = { nombre: c.nombre.trim(), email: c.email.trim(), acepta: true, acepta_edad: !!edad };
      if (c.telefono.trim()) comprador.telefono = c.telefono.trim();
      extra.forEach(f => { comprador[f.k] = String(c[f.k] || "").trim(); });
      const { data, error } = await supabase.rpc("rrpp_vender", {
        p_acceso: acceso, p_slug: ev.slug, p_items: tramos.filter(t => cant[t.id] > 0).map(t => ({ tramo: t.id, cantidad: cant[t.id] })),
        p_comprador: comprador, p_asistentes: plazas.map((p, i) => ({ tramo: p.tramo, nombre: nombres[i], dni: (as[i]?.dni || "").trim() })),
      });
      if (error) throw error;
      if (!data?.ok) {
        const k = String(data?.motivo || "");
        setErr((k === "efectivo_no" ? "El organizador no permite vender en efectivo en este evento." : k === "rrpp_evento" ? "Ya no estás en este evento." : k.startsWith("falta_") ? `Falta: ${CAMPOS.find(f => f.k === k.slice(6))?.t || k.slice(6)}.` : ERRORES[k] || "No se ha podido emitir. Inténtalo de nuevo.") + (data?.tramo ? ` (${data.tramo})` : ""));
        setBusy(false); return;
      }
      if (data.correo) { try { await supabase.functions.invoke("web-enviar-entradas", { body: { acceso: data.acceso, origen: ORIGEN } }); } catch {} }
      setHecho({ ...data, total, n: plazas.length });
      onHecho();
    } catch { setErr(navigator.onLine ? "No se ha podido emitir. Inténtalo de nuevo." : "Sin conexión. Conéctate y vuelve a intentarlo."); }
    setBusy(false);
  };

  if (hecho) {
    const link = `${ORIGEN}/mis-entradas/${hecho.acceso}`;
    return (
      <Hoja titulo="Entradas emitidas" onClose={onClose}>
        <div style={{ textAlign: "center", padding: "6px 0 14px" }}>
          <div style={{ fontSize: 46 }}>✅</div>
          <div style={{ fontWeight: 900, fontSize: 22 }}>{hecho.n} {hecho.n === 1 ? "entrada" : "entradas"} para {c.nombre.split(" ")[0]}</div>
          <div style={{ color: "var(--muted)", marginTop: 4 }}>{hecho.prueba ? "Venta de prueba: no valen en la puerta." : `Has cobrado ${eur(hecho.total)} en efectivo.`}{hecho.correo ? " Le llegan también por correo." : ""}</div>
        </div>
        <a href={wa(`Tus entradas para ${ev.nombre} 🎟️\n${link}`, c.telefono)} target="_blank" rel="noopener noreferrer" style={{ ...btn("#25d366", "#06210f"), width: "100%", textDecoration: "none" }}>Enviar por WhatsApp</a>
        <a href={link} target="_blank" rel="noopener noreferrer" style={{ ...btn("var(--card2)", "var(--text)"), width: "100%", marginTop: 8, border: "1px solid var(--line)", textDecoration: "none" }}>Ver las entradas (con QR)</a>
        <button onClick={() => { setHecho(null); setCant(tramos.length === 1 ? { [tramos[0].id]: 1 } : {}); setC({ nombre: "", email: "", telefono: "" }); setAs({}); setCobrado(false); setEdad(false); }} style={{ ...btn("transparent", "var(--text)"), width: "100%", marginTop: 8, border: "1px solid var(--line)" }}>Otra venta</button>
        <div style={{ color: "var(--muted)", fontSize: 12.5, textAlign: "center", marginTop: 10 }}>¿Te has equivocado? Puedes anularla en «Mis ventas» durante 15 minutos.</div>
      </Hoja>
    );
  }

  return (
    <Hoja titulo={`Vender en efectivo · ${ev.nombre}`} onClose={onClose}>
      <form onSubmit={enviar} noValidate>
        {prueba && <div style={{ background: "#ffb400", color: "#1a1205", borderRadius: 12, padding: "10px 12px", fontWeight: 800, fontSize: 14, marginBottom: 12 }}>Evento en pruebas: las entradas salen marcadas como PRUEBA y no se cuentan.</div>}
        <div style={{ ...lbl, marginBottom: 6 }}>Entradas</div>
        {tramos.map(t => (
          <div key={t.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
            <div style={{ minWidth: 0 }}><div style={{ fontWeight: 900 }}>{t.nombre}</div><div style={{ color: "var(--muted)", fontSize: 13, fontWeight: 700 }}>{eur(t.precio)}{t.quedan != null ? ` · quedan ${t.quedan}` : ""}</div></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button type="button" aria-label={`Quitar ${t.nombre}`} onClick={() => setCant(x => ({ ...x, [t.id]: Math.max(0, (x[t.id] || 0) - 1) }))} style={stepBtn}>−</button>
              <b style={{ minWidth: 22, textAlign: "center", fontSize: 18 }}>{cant[t.id] || 0}</b>
              <button type="button" aria-label={`Añadir ${t.nombre}`} onClick={() => setCant(x => ({ ...x, [t.id]: Math.min(t.max || 20, t.quedan ?? 99, (x[t.id] || 0) + 1) }))} style={stepBtn}>+</button>
            </div>
          </div>))}
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900, fontSize: 20, padding: "12px 0 16px" }}><span>A cobrar</span><span>{eur(total)}</span></div>

        <Campo l="Nombre y apellido del comprador *" v={c.nombre} on={v => set("nombre", v)} ac="off" />
        <Campo l={`Teléfono${oblig("telefono") ? " *" : " (para mandarle las entradas por WhatsApp)"}`} v={c.telefono} on={v => set("telefono", v)} type="tel" ac="off" im="tel" />
        <Campo l="Correo (opcional)" v={c.email} on={v => set("email", v)} type="email" ac="off" im="email" sub="Si lo pones, le llegan también por correo." />
        {extra.map(f => f.sel
          ? <label key={f.k} style={lbl}><span>{f.t} *</span><select value={c[f.k] || ""} onChange={e => set(f.k, e.target.value)} style={inpP}><option value="">Elige…</option>{f.sel.map(o => <option key={o}>{o}</option>)}</select></label>
          : <Campo key={f.k} l={`${f.t} *`} v={c[f.k] || ""} on={v => set(f.k, v)} type={f.type} ac="off" im={f.im} />)}

        {plazas.length > 1 && <div style={{ margin: "4px 0 12px" }}><Check v={porEntrada} on={setPorEntrada}>Poner un nombre distinto en cada entrada</Check></div>}
        {(porEntrada || oblig("dni_asistente")) && plazas.map((p, i) => (
          <div key={i} style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            <div style={{ fontWeight: 900, fontSize: 13.5, color: "var(--c)", marginBottom: 6 }}>Entrada {i + 1} · {p.nombreTramo}</div>
            {porEntrada && <Campo l="Nombre *" v={as[i]?.nombre || ""} on={v => setAs(x => ({ ...x, [i]: { ...x[i], nombre: v } }))} ac="off" />}
            {oblig("dni_asistente") && <Campo l="DNI / NIE *" v={as[i]?.dni || ""} on={v => setAs(x => ({ ...x, [i]: { ...x[i], dni: v } }))} ac="off" />}
          </div>))}

        <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "8px 0 4px" }}>
          {ev.edad_minima ? <Check v={edad} on={setEdad}>El comprador confirma que todos tienen {ev.edad_minima} años o más.</Check> : null}
          <Check v={cobrado} on={setCobrado}>{prueba ? "Es una venta de prueba." : <>He cobrado <b>{eur(total)}</b> en efectivo y el comprador acepta las condiciones de compra.</>}</Check>
        </div>
        {err && <div role="alert" style={{ marginTop: 12, background: "#c62828", color: "#fff", borderRadius: 12, padding: "12px 14px", fontWeight: 800 }}>{err}</div>}
        <button type="submit" disabled={busy} style={{ ...btn("var(--c)", T.tinta), width: "100%", marginTop: 14, padding: 17, fontSize: 17, opacity: busy ? .6 : 1 }}>{busy ? "Emitiendo…" : `Emitir ${plazas.length || ""} ${plazas.length === 1 ? "entrada" : "entradas"}`}</button>
      </form>
    </Hoja>
  );
}

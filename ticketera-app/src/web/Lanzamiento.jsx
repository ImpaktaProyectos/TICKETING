// ===================== LANZAMIENTO: CUENTA ATRÁS A PANTALLA COMPLETA (festivales) =====================
// Se ve en la página del evento mientras la venta no ha abierto y el organizador lo tiene activado.
// · 3 estilos: «cine» (fotos en fundido con zoom lento), «neon» (números con brillo del color de la marca) y
//   «tablero» (números que caen como en las pantallas de un aeropuerto).
// · Últimos 10 segundos: el número ocupa toda la pantalla. A cero: destello, «¡Venta abierta!» y se pasa a la venta.
// · La hora es la del servidor (offset). Aunque alguien cambie la hora del móvil, el servidor no deja comprar antes.
// · Al abrir, cada móvil pide la venta en un momento distinto de los 2,5 s siguientes (no todos a la vez).
// · Antes de abrir no se ven precios: el servidor ni siquiera los envía.
import React, { useEffect, useRef, useState } from "react";
import { supabase } from "../supabase";
import { Diapositivas, fecha, cap, btn, inpP, reducido } from "./comun";

export const ESTILOS_LANZAMIENTO = [
  { k: "cine", t: "Cinematográfico", sub: "Tus fotos en fundido con zoom lento y los números encima" },
  { k: "neon", t: "Neón", sub: "Números con brillo del color de tu marca que laten cada segundo" },
  { k: "tablero", t: "Tablero", sub: "Los números caen como en las pantallas de un aeropuerto" },
];

const CSS_LZ = `
@keyframes lzSube{0%{transform:translateY(38%);opacity:0}100%{transform:none;opacity:1}}
@keyframes lzLatido{0%{transform:scale(1.7);opacity:0}18%{transform:scale(1);opacity:1}80%{opacity:1}100%{transform:scale(.92);opacity:.0}}
@keyframes lzOnda{0%{transform:scale(.6);opacity:.55}100%{transform:scale(1.9);opacity:0}}
@keyframes lzNeon{0%,100%{opacity:1}92%{opacity:1}94%{opacity:.75}96%{opacity:1}}
@keyframes lzPulso{0%{transform:scale(1.06)}100%{transform:scale(1)}}
@keyframes lzCae{0%{transform:perspective(400px) rotateX(-92deg);filter:brightness(.6)}100%{transform:perspective(400px) rotateX(0);filter:none}}
@keyframes lzDestello{0%{opacity:0}12%{opacity:1}100%{opacity:0}}
@keyframes lzAbre{0%{transform:scale(.6);opacity:0}30%{transform:scale(1.08);opacity:1}100%{transform:scale(1);opacity:1}}
.lz-sube{animation:lzSube .45s cubic-bezier(.2,.9,.2,1) both}
.lz-latido{animation:lzLatido 1s ease-out both}
.lz-onda{animation:lzOnda 1s ease-out both}
.lz-neon{animation:lzNeon 4s linear infinite}
.lz-pulso{animation:lzPulso .5s ease-out both}
.lz-cae{animation:lzCae .42s cubic-bezier(.3,1.4,.5,1) both;transform-origin:50% 0}
.lz-destello{animation:lzDestello 1.4s ease-out both}
.lz-abre{animation:lzAbre .9s cubic-bezier(.2,.9,.2,1) both}
@media (prefers-reduced-motion:reduce){.lz-sube,.lz-latido,.lz-onda,.lz-neon,.lz-pulso,.lz-cae,.lz-destello,.lz-abre{animation:none}}
`;

const dos = (n) => String(n).padStart(2, "0");
function partes(ms) {
  const s = Math.floor(ms / 1000);
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

// Archivo de calendario con la hora de apertura
function calendario(ev, url) {
  const ini = new Date(ev.venta_inicio), fin = new Date(ini.getTime() + 30 * 60000);
  const f = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s) => String(s || "").replace(/[\\,;]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//TIXFAST//Lanzamiento//ES", "BEGIN:VEVENT", `UID:${ev.slug}-${f(ini)}@tixfast`, `DTSTAMP:${f(new Date())}`,
    `DTSTART:${f(ini)}`, `DTEND:${f(fin)}`, `SUMMARY:${esc(`Abre la venta: ${ev.nombre}`)}`, `DESCRIPTION:${esc(`Entradas: ${url}`)}`, `URL:${url}`,
    "BEGIN:VALARM", "TRIGGER:-PT10M", "ACTION:DISPLAY", `DESCRIPTION:${esc(`En 10 minutos abre la venta de ${ev.nombre}`)}`, "END:VALARM", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  a.download = `venta-${ev.slug || "evento"}.ics`; document.body.appendChild(a); a.click(); a.remove();
}

// «Avísame cuando abra»
function Avisame({ ev, T, previa }) {
  const clave = `tixfast_avisame_${ev.slug}`;
  const [email, setEmail] = useState("");
  const [estado, setEstado] = useState(() => { try { return localStorage.getItem(clave) ? "hecho" : ""; } catch { return ""; } });
  const [err, setErr] = useState("");
  const enviar = async (e) => {
    e.preventDefault(); setErr("");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setErr("Revisa el correo.");
    if (previa) return setEstado("hecho");
    setEstado("enviando");
    try {
      const { data, error } = await supabase.rpc("web_avisame", { p_slug: ev.slug, p_email: email.trim(), p_marketing: false });
      if (error) throw error;
      if (!data?.ok) { setErr(data?.motivo === "ya_abierta" ? "¡La venta ya está abierta!" : data?.motivo === "demasiados_intentos" ? "Demasiados intentos. Espera un minuto." : "No se ha podido apuntar."); setEstado(""); return; }
      try { localStorage.setItem(clave, "1"); } catch { /* nada */ }
      setEstado("hecho");
    } catch { setErr(navigator.onLine ? "No se ha podido apuntar. Inténtalo otra vez." : "Sin conexión."); setEstado(""); }
  };
  if (estado === "hecho") return <div role="status" style={{ fontWeight: 800, fontSize: 15, padding: "12px 16px", borderRadius: 14, background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.2)" }}>Te avisaremos por correo en cuanto abra la venta.</div>;
  return (
    <form onSubmit={enviar} noValidate style={{ width: "100%", maxWidth: 460 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input type="email" inputMode="email" autoComplete="email" aria-label="Tu correo electrónico" placeholder="Tu correo" value={email} onChange={(e) => setEmail(e.target.value)}
          style={{ ...inpP, flex: "1 1 200px", minWidth: 0, background: "rgba(255,255,255,.95)", color: "#111", border: "none" }} />
        <button type="submit" disabled={estado === "enviando"} style={{ ...btn(T.d.color, T.tinta), flex: "1 1 140px", minHeight: 50, padding: "0 18px" }}>{estado === "enviando" ? "Apuntando…" : "Avísame cuando abra"}</button>
      </div>
      {err && <div role="alert" style={{ marginTop: 8, fontWeight: 800, color: "#ffd0c7" }}>{err}</div>}
      <div style={{ fontSize: 12, opacity: .75, marginTop: 6 }}>Solo para avisarte de la apertura, una vez.</div>
    </form>
  );
}

// Un bloque de cifra según el estilo
function Cifra({ v, l, estilo, color, grande }) {
  const t = dos(v);
  const tam = grande ? "clamp(54px, 17vw, 170px)" : "clamp(40px, 12vw, 120px)";
  if (estilo === "tablero") return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, minWidth: 0 }}>
      <div style={{ display: "flex", gap: "clamp(3px, 1vw, 8px)" }}>
        {t.split("").map((c, i) => (
          <div key={i} style={{ position: "relative", width: "clamp(34px, 10vw, 96px)", height: "clamp(50px, 15vw, 140px)", borderRadius: 10, background: "linear-gradient(180deg,#232529 0 49.6%,#16181b 50.4% 100%)", boxShadow: "0 10px 30px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.08)", overflow: "hidden" }}>
            <span key={c} className="lz-cae" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: "clamp(36px, 11vw, 108px)", fontWeight: 900, color: "#f5f5f0", fontVariantNumeric: "tabular-nums" }}>{c}</span>
            <span aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 2, background: "rgba(0,0,0,.65)" }} />
          </div>))}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: 2.2, textTransform: "uppercase", opacity: .85 }}>{l}</div>
    </div>
  );
  const neon = estilo === "neon";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0 }}>
      <div key={neon && l === "seg" ? t : undefined} className={neon && l === "seg" ? "lz-pulso" : undefined} style={{ lineHeight: 1 }}>
        <span key={t} className="lz-sube" style={{ display: "block", fontSize: tam, fontWeight: 900, letterSpacing: "-.04em", fontVariantNumeric: "tabular-nums",
          color: neon ? "#fff" : "#fff", textShadow: neon ? `0 0 4px #fff, 0 0 12px ${color}, 0 0 26px ${color}` : "0 4px 24px rgba(0,0,0,.55)" }}>{t}</span>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: 2.4, textTransform: "uppercase", marginTop: 6, opacity: .85, color: neon ? color : "#fff", textShadow: neon ? `0 0 12px ${color}` : "none" }}>{l}</div>
    </div>
  );
}

export function Lanzamiento({ ev, lz, T, offset = 0, previa = false, simular = null, onAbierta, cabecera = null }) {
  const estilo = ESTILOS_LANZAMIENTO.some((e) => e.k === lz?.estilo) ? lz.estilo : "cine";
  const color = T.d.color || "#ff5a3c";
  // «simular»: en la vista previa del CRM, segundos que faltan (p. ej. 12 para ver el final sin esperar)
  const objetivo = useRef(simular != null ? Date.now() + simular * 1000 : new Date(ev.venta_inicio).getTime());
  useEffect(() => { objetivo.current = simular != null ? Date.now() + simular * 1000 : new Date(ev.venta_inicio).getTime(); }, [simular, ev.venta_inicio]);
  const reloj = () => (simular != null ? Date.now() : Date.now() + offset);
  const [ahora, setAhora] = useState(reloj);
  useEffect(() => { const t = setInterval(() => setAhora(reloj()), 200); return () => clearInterval(t); }, [offset, simular]);
  const ms = Math.max(0, objetivo.current - ahora);
  const p = partes(ms);
  const final = ms > 0 && ms <= 10000;
  const quedanS = Math.ceil(ms / 1000);   // 10, 9, … 1
  const abierta = ms === 0;
  const fotos = (Array.isArray(lz?.fotos) && lz.fotos.length ? lz.fotos : Array.isArray(T.d.galeria) && T.d.galeria.length ? T.d.galeria : ev.flyer_url ? [ev.flyer_url] : []).filter(Boolean);
  const url = typeof window !== "undefined" ? `${window.location.origin}/e/${ev.slug}` : "";

  // Al llegar a cero: destello y, tras un momento distinto para cada móvil, se pide la venta (y se reintenta si aún no está)
  const [intentos, setIntentos] = useState(0);
  useEffect(() => {
    if (!abierta || previa || simular != null) return;
    let vivo = true;
    const espera = (intentos === 0 ? 1600 : 2000) + Math.random() * 2500;
    const t = setTimeout(async () => { try { await onAbierta?.(); } catch { /* reintenta */ } if (vivo && intentos < 30) setIntentos((n) => n + 1); }, espera);
    return () => { vivo = false; clearTimeout(t); };
  }, [abierta, intentos]);

  const unidades = [...(p.d > 0 ? [[p.d, "días"]] : []), [p.h, "horas"], [p.m, "min"], [p.s, "seg"]];
  const fondo = estilo === "tablero"
    ? <div style={{ position: "absolute", inset: 0, background: `radial-gradient(120% 80% at 50% 0%, ${color}33, #0a0b0d 60%)` }} />
    : <>
        <Diapositivas fotos={fotos} color={color} />
        <div style={{ position: "absolute", inset: 0, background: estilo === "neon" ? `radial-gradient(90% 70% at 50% 45%, ${color}30, rgba(5,5,10,.88) 70%)` : "linear-gradient(180deg, rgba(0,0,0,.55), rgba(0,0,0,.25) 40%, rgba(0,0,0,.7))" }} />
        {estilo === "neon" && <div aria-hidden="true" style={{ position: "absolute", inset: 0, backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }} />}
      </>;

  return (
    <section aria-label="Cuenta atrás para la apertura de la venta" className="lz" style={{ position: "relative", minHeight: previa ? 680 : "100svh", color: "#fff", overflow: "hidden", display: "flex", flexDirection: "column", background: "#0a0b0d", isolation: "isolate" }}>
      <style>{CSS_LZ}</style>
      {fondo}

      <div style={{ position: "relative", zIndex: 2, width: "100%", maxWidth: 1120, margin: "0 auto", padding: "max(14px, env(safe-area-inset-top)) 16px 0", boxSizing: "border-box" }}>{cabecera}</div>

      <div style={{ position: "relative", zIndex: 2, flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "16px 16px 28px", gap: 18 }}>
        {!final && !abierta && <>
          <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: 3.2, textTransform: "uppercase", color: estilo === "neon" ? color : "#fff", opacity: .95, textShadow: estilo === "neon" ? `0 0 14px ${color}` : "0 2px 12px rgba(0,0,0,.5)" }}>{(lz?.texto || "La venta abre en").slice(0, 60)}</div>
          <div className={estilo === "neon" ? "lz-neon" : undefined} style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", gap: estilo === "tablero" ? "clamp(10px, 3vw, 28px)" : "clamp(10px, 4vw, 40px)", flexWrap: "nowrap", maxWidth: "100%" }}>
            {unidades.map(([v, l]) => <Cifra key={l} v={v} l={l} estilo={estilo} color={color} grande={unidades.length === 3} />)}
          </div>
          <h1 style={{ margin: "6px 0 0", fontSize: "clamp(26px, 6vw, 56px)", lineHeight: 1.02, fontWeight: 900, letterSpacing: "-.03em", textTransform: estilo === "cine" ? "none" : "uppercase", overflowWrap: "anywhere", textShadow: "0 4px 24px rgba(0,0,0,.5)", maxWidth: 900 }}>{ev.nombre}</h1>
          <div style={{ fontWeight: 700, opacity: .9, fontSize: 15 }}>Apertura: {cap(fecha(simular != null ? new Date(objetivo.current).toISOString() : ev.venta_inicio))}</div>
          <Avisame ev={ev} T={T} previa={previa || simular != null} />
          <button type="button" onClick={() => !previa && calendario(ev, url)} style={{ ...btn("rgba(255,255,255,.12)", "#fff"), border: "1px solid rgba(255,255,255,.25)", minHeight: 46, padding: "10px 16px", fontSize: 14.5, backdropFilter: "blur(8px)" }}>Añadir al calendario</button>
        </>}

        {/* Últimos 10 segundos: el número a pantalla completa */}
        {final && (
          <div aria-live="assertive" style={{ position: "relative", display: "grid", placeItems: "center", minHeight: "60svh", width: "100%" }}>
            <span key={"o" + quedanS} className="lz-onda" aria-hidden="true" style={{ position: "absolute", width: "min(70vw, 520px)", aspectRatio: "1", borderRadius: "50%", border: `3px solid ${color}` }} />
            <span aria-hidden="true" style={{ position: "absolute", width: "min(80vw, 600px)", aspectRatio: "1", borderRadius: "50%", background: `radial-gradient(circle, ${color}66, transparent 65%)` }} />
            <span key={quedanS} className="lz-latido" style={{ position: "relative", fontSize: "clamp(160px, 48vw, 460px)", fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: "#fff", textShadow: `0 0 18px ${color}` }}>{quedanS}</span>
            <div style={{ position: "absolute", bottom: 0, fontWeight: 900, letterSpacing: 3, textTransform: "uppercase", fontSize: 14 }}>{ev.nombre}</div>
          </div>
        )}

        {/* Cero: destello y paso a la venta */}
        {abierta && (
          <div aria-live="assertive" style={{ display: "grid", placeItems: "center", minHeight: "60svh", gap: 14 }}>
            <div className="lz-destello" aria-hidden="true" style={{ position: "absolute", inset: 0, background: `radial-gradient(circle at 50% 50%, #fff, ${color} 45%, transparent 75%)` }} />
            <div className="lz-abre" style={{ fontSize: "clamp(44px, 12vw, 130px)", fontWeight: 900, lineHeight: .95, letterSpacing: "-.03em", textTransform: "uppercase", textShadow: `0 0 22px ${color}` }}>¡Venta<br />abierta!</div>
            <div style={{ fontWeight: 800, fontSize: 16, opacity: .9 }}>{previa || simular != null ? "Aquí aparece la venta de entradas." : "Abriendo la venta…"}</div>
          </div>
        )}
      </div>
    </section>
  );
}

import React, { useEffect, useRef, useState } from "react";
import { leerToken, verificarToken } from "./token";
import * as Q from "./qrdb";
import { scopedKey } from "../db";

/* ============================================================================
   VALIDADOR DE TICKETS CON QR (un móvil por barra)
   - Lee el QR con la cámara (Android: lector nativo; iPhone: lector en segundo plano).
   - Con internet: el servidor decide (comprueba la firma y marca el canje a la vez → nunca dos veces).
   - Sin internet: comprueba la firma en el propio móvil, mira lo ya canjeado que conoce,
     acepta con aviso naranja y lo sube al volver la red (las copias aparecen en el informe).
   ========================================================================== */

const hora = (t) => { try { return new Date(t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
const diaHora = (t) => { try { return new Date(t).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
const kHist = (ev) => scopedKey("tixfast_qr_hist_" + ev);
const leerHist = (ev) => { try { const h = JSON.parse(localStorage.getItem(kHist(ev)) || "[]"); return Array.isArray(h) ? h : []; } catch { return []; } };
const guardarHist = (ev, h) => { try { localStorage.setItem(kHist(ev), JSON.stringify(h.slice(0, 60))); } catch {} };

// Qué ve el camarero en cada caso (corto y claro)
function explicar(r) {
  const donde = [r.barra, r.dispositivo || r.disp].filter(Boolean).join(" · ");
  switch (r.motivo) {
    case "ya_canjeado": if (r.web) return { t: "YA HA ENTRADO", d: `Esta entrada se escaneó a las ${hora(r.canjeado_en || r.t)}${donde ? " en " + donde : ""}. Es una copia: no dejes pasar.` };
      return { t: "YA CANJEADO", d: `Se sirvió a las ${hora(r.canjeado_en || r.t)}${donde ? " en " + donde : ""}. Es una copia: no sirvas.` };
    case "falso": return { t: "TICKET NO VÁLIDO", d: "La firma no es de TIXFAST: está manipulado o es falso. No sirvas." };
    case "otro_evento": return { t: "DE OTRO EVENTO", d: `Este ticket es de «${r.evento || "otro evento"}». No vale aquí.` };
    case "anulado": return { t: "TICKET ANULADO", d: "Esa venta se anuló en caja. No sirvas." };
    case "caducado": return { t: "EVENTO TERMINADO", d: `El evento terminó${r.fin ? " el " + diaHora(r.fin) : ""}. Los tickets ya no valen.` };
    case "repetido_aqui": return { t: "YA LO HAS ESCANEADO", d: `Lo validaste aquí a las ${hora(r.t)}. Si te lo enseñan otra vez, es el mismo ticket: no vuelvas a servir.` };
    case "temprano": return { t: "AÚN NO ES LA HORA", d: `Esta entrada vale desde el ${diaHora(r.desde)}.` };
    case "reemitida": return { t: "QR SUSTITUIDO", d: "Esta entrada se volvió a emitir y este QR ya no vale. Pide al titular el QR nuevo." };
    case "prueba_ok": return { t: "ENTRADA DE PRUEBA", d: "Queda validada, pero es de prueba: no vale para entrar al evento." };
    case "prueba": return { t: "TICKET DE PRUEBA", d: "Se imprimió en modo prueba. No vale para servir." };
    case "no_encontrado": return { t: "FOLIO NO ENCONTRADO", d: "Revisa el número. Si la venta se hizo sin internet, puede que aún no haya subido: prueba con el QR." };
    case "falta_vale": return { t: "ES UN BONO", d: "Escribe también el número del vale que pone en el ticket (·1, ·2…)." };
    case "sin_red_folio": return { t: "SIN INTERNET", d: "Sin conexión solo se puede validar con el QR, no escribiendo el folio." };
    case "ilegible": case "no_tixfast": default: return { t: "NO ES UN TICKET DE TIXFAST", d: "Ese código no es de un ticket. Prueba otra vez o escribe el folio." };
  }
}

// ===== Sonidos de escaneo =====
// Pitido de «correcto», zumbido de «error» y tono de «aviso». Se generan aquí (sin descargar nada) como
// pequeños WAV y suenan con un <audio>: así van por el canal multimedia del teléfono → el volumen se sube
// y se baja con sus botones (y en iPhone suenan aunque el interruptor de silencio esté puesto).
// En iPhone el audio necesita un primer toque en la pantalla: se «desbloquea» con él.
const K_MUDO = "tixfast_validador_mudo";
function wav(notas, { vol = 0.9, rate = 22050 } = {}) {
  // notas: [{ f, ini, dur, forma }] en segundos
  const total = Math.max(...notas.map(n => n.ini + n.dur)) + 0.03;
  const n = Math.ceil(total * rate), pcm = new Int16Array(n);
  notas.forEach(({ f, ini, dur, forma = "sine" }) => {
    const a = Math.floor(ini * rate), z = Math.floor(dur * rate);
    for (let i = 0; i < z && a + i < n; i++) {
      const t = i / rate, fase = 2 * Math.PI * f * t;
      let v = forma === "square" ? Math.sign(Math.sin(fase)) * 0.6 : forma === "triangle" ? 2 / Math.PI * Math.asin(Math.sin(fase)) : Math.sin(fase);
      const env = Math.min(1, i / (rate * 0.006)) * Math.min(1, (z - i) / (rate * 0.03));   // sin chasquidos
      pcm[a + i] = Math.max(-32767, Math.min(32767, pcm[a + i] + v * env * vol * 32767));
    }
  });
  const buf = new ArrayBuffer(44 + n * 2), d = new DataView(buf);
  const str = (o, t) => [...t].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); d.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt "); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, rate, true); d.setUint32(28, rate * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); str(36, "data"); d.setUint32(40, n * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}
const SONIDOS = {
  bien: [{ f: 988, ini: 0, dur: 0.11 }, { f: 1319, ini: 0.1, dur: 0.2 }],                                   // «ding-ding» ascendente
  mal: [{ f: 220, ini: 0, dur: 0.28, forma: "square" }, { f: 165, ini: 0.32, dur: 0.42, forma: "square" }],  // zumbido grave doble
  aviso: [{ f: 660, ini: 0, dur: 0.16, forma: "triangle" }, { f: 660, ini: 0.22, dur: 0.16, forma: "triangle" }],
};
function useSonido() {
  const aud = useRef(null);
  const [mudo, setMudo] = useState(() => { try { return localStorage.getItem(K_MUDO) === "1"; } catch { return false; } });
  const mudoRef = useRef(mudo); mudoRef.current = mudo;
  const preparar = () => {
    if (aud.current) return aud.current;
    try { aud.current = Object.fromEntries(Object.entries(SONIDOS).map(([k, notas]) => { const a = new Audio(wav(notas, { vol: k === "mal" ? 0.75 : 0.9 })); a.preload = "auto"; a.dataset.sonido = k; return [k, a]; })); }
    catch { aud.current = {}; }
    return aud.current;
  };
  // Primer toque: crea los sonidos y los «desbloquea» (play mudo y pausa)
  const listo = useRef(false);
  const activar = () => {
    if (listo.current) return; listo.current = true;   // solo con el primer toque
    const A = preparar();
    Object.values(A).forEach(a => { try { a.muted = true; const p = a.play(); if (p?.then) p.then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; }); else { a.pause(); a.muted = false; } } catch {} });
  };
  const sonar = (k) => {
    if (mudoRef.current) return;
    const a = preparar()[k]; if (!a) return;
    try { a.pause(); a.currentTime = 0; a.muted = false; a.volume = 1; a.play()?.catch?.(() => {}); } catch {}
  };
  const vib = (p) => { try { navigator.vibrate?.(p); } catch {} };
  const bien = () => { sonar("bien"); vib(60); };
  const mal = () => { sonar("mal"); vib([220, 90, 220]); };
  const aviso = () => { sonar("aviso"); vib([80, 60, 80]); };
  const alternarMudo = () => setMudo(m => { const n = !m; try { localStorage.setItem(K_MUDO, n ? "1" : "0"); } catch {} if (!n) setTimeout(() => sonar("bien"), 50); return n; });
  useEffect(() => () => { Object.values(aud.current || {}).forEach(a => { try { URL.revokeObjectURL(a.src); } catch {} }); }, []);
  return { activar, bien, mal, aviso, mudo, alternarMudo };
}

export default function Validador({ ev, punto, events = [], sales = [], onExit }) {
  const video = useRef(null);
  const scanner = useRef(null);
  const ocupado = useRef(false);
  const recientes = useRef({});           // tickets canjeados aquí hace un momento (no se repite el aviso)
  const ultimoMalo = useRef({ t: "", at: 0 });
  const [empezado, setEmpezado] = useState(false);
  const [camErr, setCamErr] = useState(null);
  const [linterna, setLinterna] = useState(null);   // null = no disponible
  const [res, setRes] = useState(null);             // resultado en pantalla
  const [hist, setHist] = useState(() => leerHist(ev.id));
  const [online, setOnline] = useState(navigator.onLine);
  const [cola, setCola] = useState(() => Q.colaCanjes(ev.id).length);
  const [folioAbierto, setFolioAbierto] = useState(false);
  const [folio, setFolio] = useState("");
  const [motor, setMotor] = useState("");
  const [comprobando, setComprobando] = useState(false);
  const snd = useSonido();
  const evRef = useRef(ev); evRef.current = ev;
  const folioRef = useRef(false); folioRef.current = folioAbierto;
  const procesarRef = useRef(null);
  const timerRes = useRef(null);
  const salesRef = useRef(sales); salesRef.current = sales;

  const nombreProducto = (prod6) => { for (const p of ev.puntos || []) for (const x of p.products || []) if (String(x.id).replace(/-/g, "").slice(0, 12) === prod6) return x.name; return ""; };

  // Conexión + sincronización: sube la cola y descarga lo canjeado por las otras barras
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    let vivo = true;
    const ciclo = async () => {
      if (!navigator.onLine) return;
      try { await Q.subirCola(ev.id, punto.id); } catch {}
      try { await Q.descargarCanjes(ev.id, ev.puntos); } catch {}
      try { await Q.descargarWeb(ev.id); } catch {}
      if (vivo) setCola(Q.colaCanjes(ev.id).length);
    };
    ciclo();
    const t = setInterval(ciclo, 15000);
    window.addEventListener("online", ciclo);
    return () => { vivo = false; clearInterval(t); window.removeEventListener("online", on); window.removeEventListener("offline", off); window.removeEventListener("online", ciclo); };
  }, [ev.id, punto.id]);

  // Cámara
  const arrancar = async () => {
    snd.activar();
    setEmpezado(true); setCamErr(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("sin cámara"), { name: "NotSupported" });
      const QrScanner = (await import("qr-scanner")).default;
      if (scanner.current) { try { scanner.current.destroy(); } catch {} }
      const sc = new QrScanner(video.current, (r) => procesarRef.current?.(r?.data || ""), {
        preferredCamera: "environment", maxScansPerSecond: 12, returnDetailedScanResult: true,
        highlightScanRegion: false, highlightCodeOutline: false, onDecodeError: () => {},
      });
      scanner.current = sc;
      await sc.start();
      try { setMotor(("BarcodeDetector" in window) ? "nativo" : "js"); } catch {}
      try { setLinterna((await sc.hasFlash()) ? false : null); } catch { setLinterna(null); }
    } catch (e) {
      const n = e?.name || String(e || "");
      setCamErr(/NotAllowed|Permission/i.test(n) ? "permiso" : /NotFound|Overconstrained/i.test(n) ? "nocam" : /NotSupported|sin cámara/i.test(n + (e?.message || "")) ? "nosoporta" : "error");
    }
  };
  useEffect(() => {
    // Sin pasos de más: si la cámara ya tiene permiso, se abre sola al entrar
    let vivo = true;
    (async () => { try { const st = await navigator.permissions?.query({ name: "camera" }); if (vivo && st?.state === "granted") arrancar(); } catch {} })();
    const tocar = () => snd.activar();
    window.addEventListener("pointerdown", tocar);
    return () => { vivo = false; window.removeEventListener("pointerdown", tocar); };
  }, []);
  useEffect(() => {
    // Se descarga ya el lector (y su versión para iPhone) para que funcione aunque luego se vaya internet
    import("qr-scanner").catch(() => {});
    import("qr-scanner/qr-scanner-worker.min.js").catch(() => {});
    return () => { try { scanner.current?.destroy(); } catch {} };
  }, []);

  const toggleLinterna = async () => { try { await scanner.current?.toggleFlash(); setLinterna(!!scanner.current?.isFlashOn()); } catch {} };

  const mostrar = (r) => {
    setRes(r);
    if (r.tipo === "ok") snd.bien(); else if (r.tipo === "aviso") snd.aviso(); else snd.mal();
    const h = [{ tipo: r.tipo, t: Date.now(), nombre: r.nombre || "", titulo: r.tipo === "ok" ? (r.asistente || r.nombre || "Ticket válido") : explicar(r).t, offline: !!r.sinConexion }, ...leerHist(ev.id)];
    guardarHist(ev.id, h); setHist(h.slice(0, 60));
    clearTimeout(timerRes.current);
    timerRes.current = setTimeout(() => setRes(null), r.tipo === "ok" ? 1200 : 2600);
  };
  const cerrarRes = () => { clearTimeout(timerRes.current); setRes(null); };

  // Decide si un QR vale. Con internet manda el servidor; sin internet, el móvil.
  const decidir = async (tk) => {   // (el resultado se pinta en cuanto llega; la cámara nunca se para)
    const e = evRef.current;
    if (!tk) return { tipo: "mal", motivo: "no_tixfast" };
    const local = verificarToken(tk, e.qrClave);
    if (!local) {
      const otro = events.find(x => x.id !== e.id && x.qrClave && verificarToken(tk, x.qrClave));
      if (navigator.onLine) Q.canjearQR({ eventoId: e.id, puntoId: punto.id, hex: tk.hex, ms: 4000 }).catch(() => {});   // queda registrado el intento
      return { tipo: "mal", motivo: otro ? "otro_evento" : "falso", evento: otro?.name };
    }
    if (tk.ver === 2) return { tipo: "aviso", motivo: "prueba" };
    const nombre = nombreProducto(tk.prod);
    const venta = salesRef.current.find(s => s.clientUuid === tk.ventaUuid || s.id === tk.ventaUuid);
    const usado = Q.usadosLocales(e.id)[tk.clave];
    const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    if (navigator.onLine) {
      try {
        // Rapidez: si el servidor tarda más de 2,5 s, decide el móvil. El canje sube después con el
        // MISMO id, así que si el servidor sí llegó a apuntarlo, no sale como copia.
        const r = await Q.canjearQR({ eventoId: e.id, puntoId: punto.id, hex: tk.hex, canjeId: id, ms: 2500 });
        if (r?.ok) { Q.marcarUsado(e.id, tk.clave, { barra: punto.name, disp: "este móvil" }); return { ...r, tipo: "ok", nombre: r.nombre || nombre, unidades: r.unidades || 1 }; }
        if (r?.motivo === "ya_canjeado") Q.marcarUsado(e.id, tk.clave, { barra: r.barra, disp: r.dispositivo, t: new Date(r.canjeado_en).getTime() });
        return { tipo: "mal", ...r, nombre: r?.nombre || nombre };
      } catch (err) {
        if (!Q.esErrorDeRed(err)) return { tipo: "mal", motivo: "error", nombre };
        // sin respuesta: seguimos sin internet
      }
    }
    // ===== Sin internet =====
    if (tk.web) {
      const W = Q.webLocal(e.id), w = W.entradas[tk.ventaUuid];
      const extra = w ? { web: true, asistente: w.n, nombre: w.t, numero: w.num, prueba: !!w.p } : { web: true, prueba: tk.prueba };
      if (usado) return { tipo: "mal", motivo: "ya_canjeado", t: usado.t, barra: usado.barra, disp: usado.disp, ...extra };
      if (w?.a) return { tipo: "mal", motivo: "anulado", ...extra };
      if (w && tk.idx !== w.e - 1) return { tipo: "mal", motivo: "reemitida", ...extra };
      const ini = e.startsAt ? new Date(e.startsAt).getTime() : null;   // hora local del evento
      if (ini && Date.now() < ini - (W.horas ?? 24) * 3600000) return { tipo: "mal", motivo: "temprano", desde: new Date(ini - (W.horas ?? 24) * 3600000).toISOString(), ...extra };
      if (e.endsAt && Date.now() > new Date(e.endsAt).getTime()) return { tipo: "mal", motivo: "caducado", fin: e.endsAt, ...extra };
      const idw = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
      Q.encolarCanje(e.id, { id: idw, hex: tk.hex, t: Date.now(), punto: punto.id, nombre: extra.nombre || "" });
      Q.marcarUsado(e.id, tk.clave, { barra: punto.name, disp: "este móvil", local: true });
      setCola(Q.colaCanjes(e.id).length);
      return { tipo: "ok", unidades: 1, sinConexion: true, desconocida: !w, ...extra };
    }
    if (usado) return { tipo: "mal", motivo: "ya_canjeado", t: usado.t, barra: usado.barra, disp: usado.disp, nombre };
    if (venta?.voided) return { tipo: "mal", motivo: "anulado", nombre };
    if (e.endsAt && Date.now() > new Date(e.endsAt).getTime()) return { tipo: "mal", motivo: "caducado", fin: e.endsAt, nombre };
    Q.encolarCanje(e.id, { id, hex: tk.hex, t: Date.now(), punto: punto.id, nombre });
    Q.marcarUsado(e.id, tk.clave, { barra: punto.name, disp: "este móvil", local: true });
    setCola(Q.colaCanjes(e.id).length);
    return { tipo: "ok", nombre, unidades: 1, sinConexion: true };
  };

  const procesar = async (texto) => {
    if (ocupado.current || folioRef.current) return;
    const now = Date.now();
    const tk = leerToken(texto);
    // El mismo ticket sigue delante de la cámara (se lee ~10 veces por segundo): no se repite el aviso.
    // Si se retira y vuelve a aparecer más tarde, sí se comprueba (así una copia nunca pasa en silencio).
    if (tk) { const visto = recientes.current[tk.clave]; recientes.current[tk.clave] = now; if (visto && now - visto < 2000) return; }
    if (!tk && ultimoMalo.current.t === texto && now - ultimoMalo.current.at < 4000) return;
    ocupado.current = true;
    const previo = tk ? Q.usadosLocales(evRef.current.id)[tk.clave] : null;   // antes de que el servidor lo sobrescriba
    const lento = setTimeout(() => setComprobando(true), 250);
    try {
      let r = await decidir(tk);
      if (r.tipo === "ok" && r.web && r.prueba) r = { ...r, tipo: "aviso", motivo: "prueba_ok" };
      if (tk) recientes.current[tk.clave] = Date.now(); else ultimoMalo.current = { t: texto, at: Date.now() };
      // Lo acaba de servir este mismo móvil: aviso ámbar claro en vez de «copia»
      if (tk && r.motivo === "ya_canjeado") { const u = previo; if (u && u.disp === "este móvil" && Date.now() - (u.t || 0) < 60000) { mostrar({ ...r, tipo: "aviso", motivo: "repetido_aqui", t: u.t }); return; } }
      mostrar(r);
    } finally { clearTimeout(lento); setComprobando(false); setTimeout(() => { ocupado.current = false; }, 250); }
  };

  procesarRef.current = procesar;

  const enviarFolio = async () => {
    const f = folio.trim(); if (!f) return;
    snd.activar();
    if (!navigator.onLine) { mostrar({ tipo: "mal", motivo: "sin_red_folio" }); return; }
    ocupado.current = true;
    try {
      const r = await Q.canjearFolio({ eventoId: ev.id, puntoId: punto.id, folio: f });
      setFolioAbierto(false); setFolio("");
      mostrar(r?.ok ? { tipo: "ok", nombre: r.nombre, unidades: 1 } : { tipo: r?.motivo === "falta_vale" || r?.motivo === "no_encontrado" ? "aviso" : "mal", ...r });
    } catch (e) {
      mostrar({ tipo: "mal", motivo: Q.esErrorDeRed(e) ? "sin_red_folio" : "error" });
    } finally { setTimeout(() => { ocupado.current = false; }, 600); }
  };

  const okHoy = hist.filter(h => h.tipo === "ok").length;
  const malHoy = hist.filter(h => h.tipo === "mal").length;
  const exp = res && res.tipo !== "ok" ? explicar(res) : null;
  // Verde algo translúcido: se sigue viendo la cámara para apuntar al siguiente ticket
  const fondoRes = res ? (res.tipo === "ok" ? (res.sinConexion ? "rgba(15,122,82,.9)" : "rgba(15,157,99,.88)") : res.tipo === "aviso" ? "#b7791f" : "#c62828") : null;
  const tamNombre = (t) => { const n = String(t || "").length; return n <= 8 ? 64 : n <= 12 ? 52 : n <= 18 ? 40 : 30; };

  return (
    <div style={V.wrap}>
      {/* Cabecera */}
      <header style={V.top}>
        <img src="/brand/tixfast_isotipo_app.svg" alt="" width="30" height="30" style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Validar tickets · {punto.name}</div>
          <div style={{ fontSize: 12, color: ev.endsAt && Date.now() > new Date(ev.endsAt).getTime() ? "#ff8a80" : "rgba(255,255,255,.65)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ev.name}{ev.endsAt ? (Date.now() > new Date(ev.endsAt).getTime() ? " · evento terminado" : ` · valen hasta ${diaHora(ev.endsAt)}`) : ""}</div>
        </div>
        <span style={{ ...V.pill, background: online ? (cola ? "rgba(255,180,0,.18)" : "rgba(34,211,166,.16)") : "rgba(255,180,0,.2)", color: online && !cola ? "#5ee6bd" : "#ffcf5a" }}>
          <span style={{ width: 8, height: 8, borderRadius: 8, background: online && !cola ? "#22d3a6" : "#ffb400" }} />
          {online ? (cola ? `${cola} por subir` : "En línea") : `Sin conexión${cola ? " · " + cola : ""}`}
        </span>
        <button onClick={() => { snd.activar(); snd.alternarMudo(); }} aria-pressed={snd.mudo} aria-label={snd.mudo ? "Activar el sonido" : "Silenciar los pitidos"} title={snd.mudo ? "Sonido apagado" : "Sonido encendido"}
          style={{ ...V.salir, padding: "7px 9px", display: "grid", placeItems: "center", ...(snd.mudo ? { background: "rgba(255,77,77,.18)", borderColor: "rgba(255,77,77,.6)", color: "#ff8a80" } : {}) }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 9h4l5-4v14l-5-4H4z" />
            {snd.mudo ? <path d="M17 9l5 6M22 9l-5 6" /> : <path d="M16.5 8.5a5 5 0 0 1 0 7M19.5 5.5a9 9 0 0 1 0 13" />}
          </svg>
        </button>
        <button onClick={onExit} style={V.salir}>Salir</button>
      </header>

      {/* Cámara */}
      <div style={V.cam}>
        <video ref={video} muted playsInline style={V.video} />
        {!empezado && (
          <div style={V.centro}>
            <div style={{ fontSize: 46, marginBottom: 10 }}>📷</div>
            <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 6 }}>Escanea el QR de cada ticket</div>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,.7)", maxWidth: 320, margin: "0 auto 20px", lineHeight: 1.4 }}>Verde: sirve. Rojo: no sirvas (copia, anulado o falso). Cada ticket vale una sola vez, en cualquier barra, hasta que termina el evento.</div>
            <button onClick={arrancar} style={V.btnGrande}>Empezar a validar</button>
          </div>
        )}
        {empezado && camErr && (
          <div style={V.centro}>
            <div style={{ fontSize: 42, marginBottom: 8 }}>🚫</div>
            <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 6 }}>{camErr === "permiso" ? "Falta el permiso de la cámara" : camErr === "nocam" ? "No se encuentra la cámara" : camErr === "nosoporta" ? "Este navegador no deja usar la cámara" : "No se pudo abrir la cámara"}</div>
            <div style={{ fontSize: 13.5, color: "rgba(255,255,255,.72)", maxWidth: 340, margin: "0 auto 18px", lineHeight: 1.45 }}>
              {camErr === "permiso" ? "Toca el candado de la barra de direcciones y permite la cámara para esta web. En iPhone: Ajustes › Safari › Cámara › Permitir." : "Ábrelo en Chrome (Android) o Safari (iPhone). Mientras tanto puedes validar escribiendo el folio."}
            </div>
            <button onClick={arrancar} style={V.btnGrande}>Reintentar</button>
          </div>
        )}
        {empezado && !camErr && (
          <>
            <div style={V.marco}><span style={{ ...V.esq, top: 0, left: 0, borderWidth: "4px 0 0 4px" }} /><span style={{ ...V.esq, top: 0, right: 0, borderWidth: "4px 4px 0 0" }} /><span style={{ ...V.esq, bottom: 0, left: 0, borderWidth: "0 0 4px 4px" }} /><span style={{ ...V.esq, bottom: 0, right: 0, borderWidth: "0 4px 4px 0" }} /></div>
            <div style={V.pista}>Acerca el QR del ticket al recuadro</div>
          </>
        )}

        {comprobando && !res && <div style={V.comprobando} role="status">Comprobando…</div>}

        {/* Resultado a pantalla completa (la cámara sigue leyendo debajo) */}
        {res && (
          <button onClick={cerrarRes} style={{ ...V.res, background: fondoRes }} aria-live="assertive">
            <div style={V.icoRes}>
              {res.tipo === "ok"
                ? <svg width="70" height="70" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                : res.tipo === "aviso"
                  ? <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><path d="M12 7v6M12 17h.01" /></svg>
                  : <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>}
            </div>
            {res.tipo === "ok" ? (
              <>
                <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 2, opacity: .9 }}>{res.web ? "ADELANTE" : "SIRVE"}</div>
                {res.web ? (<>
                  <div style={{ fontSize: tamNombre(res.asistente), fontWeight: 900, lineHeight: 1.02, margin: "8px 0 6px", overflowWrap: "anywhere" }}>{res.asistente || "ENTRADA VÁLIDA"}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, opacity: .92 }}>{[res.nombre, res.numero ? `nº ${res.numero}` : null].filter(Boolean).join(" · ")}</div>
                  {res.desconocida && <div style={V.etq}>Firma correcta · aún no estaba en la lista de este móvil</div>}
                </>) : <div style={{ fontSize: tamNombre(res.nombre), fontWeight: 900, lineHeight: 1.02, margin: "8px 0 10px", overflowWrap: "anywhere" }}>{res.nombre || "TICKET VÁLIDO"}</div>}
                {res.unidades > 1 && <div style={{ fontSize: 28, fontWeight: 900 }}>× {res.unidades}</div>}
                {res.sinConexion && <div style={V.etq}>Sin conexión · se subirá solo</div>}
              </>
            ) : (
              <>
                <div style={{ fontSize: 40, fontWeight: 900, lineHeight: 1.05, margin: "6px 0 12px" }}>{exp.t}</div>
                {(res.asistente || res.nombre) && <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8, opacity: .95 }}>{[res.asistente, res.nombre].filter(Boolean).join(" · ")}</div>}
                <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.35, maxWidth: 420 }}>{exp.d}</div>
              </>
            )}
            <div style={{ position: "absolute", bottom: 18, left: 0, right: 0, fontSize: 14, fontWeight: 700, opacity: .85 }}>Escanea el siguiente: la cámara sigue activa</div>
          </button>
        )}
      </div>

      {/* Pie: acciones + últimos */}
      <div style={V.pie}>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button onClick={() => { snd.activar(); setFolioAbierto(true); }} style={V.btn}>⌨️ Escribir folio</button>
          {linterna !== null && <button onClick={toggleLinterna} style={{ ...V.btn, ...(linterna ? { background: "#ffd54a", color: "#1a1300", borderColor: "#ffd54a" } : {}) }}>🔦 Linterna</button>}
        </div>
        <div style={{ display: "flex", gap: 8, fontSize: 12.5, color: "rgba(255,255,255,.7)", marginBottom: 6 }}>
          <span>✅ <b style={{ color: "#fff" }}>{okHoy}</b> servidos aquí</span>
          <span>·</span>
          <span>⛔ <b style={{ color: "#fff" }}>{malHoy}</b> rechazados</span>
          {motor && <span style={{ marginLeft: "auto", opacity: .6 }}>lector {motor}</span>}
        </div>
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
          {hist.slice(0, 12).map((h, i) => (
            <div key={i} style={{ ...V.chip, borderColor: h.tipo === "ok" ? "rgba(34,211,166,.5)" : h.tipo === "aviso" ? "rgba(255,180,0,.5)" : "rgba(255,77,77,.55)" }}>
              <span style={{ width: 7, height: 7, borderRadius: 7, background: h.tipo === "ok" ? "#22d3a6" : h.tipo === "aviso" ? "#ffb400" : "#ff4d4d", flexShrink: 0 }} />
              <span style={{ whiteSpace: "nowrap", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }}>{h.titulo}</span>
              <span style={{ opacity: .6 }}>{hora(h.t)}</span>
            </div>
          ))}
          {!hist.length && <div style={{ fontSize: 12.5, color: "rgba(255,255,255,.5)" }}>Aquí verás los últimos tickets validados.</div>}
        </div>
      </div>

      {/* Escribir folio */}
      {folioAbierto && (
        <div style={V.hojaWrap} onClick={() => setFolioAbierto(false)}>
          <div style={V.hoja} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4 }}>Escribir el folio</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,.65)", marginBottom: 12, lineHeight: 1.4 }}>Está impreso al lado del QR. En los bonos, añade el número del vale: <b>BAR-0012·2</b></div>
            <input autoFocus value={folio} onChange={e => setFolio(e.target.value.toUpperCase())} onKeyDown={e => { if (e.key === "Enter") enviarFolio(); }} placeholder="Ej. BAR-0012" autoCapitalize="characters" autoCorrect="off" spellCheck={false} style={V.input} />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={() => setFolioAbierto(false)} style={{ ...V.btn, flex: 1 }}>Cancelar</button>
              <button onClick={enviarFolio} disabled={!folio.trim()} style={{ ...V.btnGrande, flex: 2, padding: "14px", opacity: folio.trim() ? 1 : .5 }}>Validar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const V = {
  wrap: { position: "fixed", inset: 0, zIndex: 60, background: "#05060a", color: "#fff", display: "flex", flexDirection: "column", fontFamily: "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" },
  top: { display: "flex", alignItems: "center", gap: 10, padding: "calc(10px + env(safe-area-inset-top)) 12px 10px", background: "#0b0c10", borderBottom: "1px solid rgba(255,255,255,.08)" },
  pill: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, padding: "6px 10px", borderRadius: 20, whiteSpace: "nowrap", flexShrink: 0 },
  salir: { background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,.2)", borderRadius: 10, padding: "8px 12px", fontWeight: 700, fontSize: 13, cursor: "pointer", flexShrink: 0 },
  cam: { position: "relative", flex: 1, overflow: "hidden", background: "#000" },
  video: { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" },
  centro: { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24, background: "radial-gradient(circle at 50% 40%, #151826, #05060a 70%)" },
  btnGrande: { background: "linear-gradient(160deg,#ff6a3d,#ff3d2e)", color: "#fff", border: 0, borderRadius: 14, padding: "16px 26px", fontWeight: 800, fontSize: 17, cursor: "pointer" },
  marco: { position: "absolute", left: "50%", top: "46%", width: "min(64vw, 300px)", height: "min(64vw, 300px)", transform: "translate(-50%,-50%)", pointerEvents: "none" },
  esq: { position: "absolute", width: 38, height: 38, borderStyle: "solid", borderColor: "#fff", borderRadius: 6 },
  comprobando: { position: "absolute", left: "50%", top: 16, transform: "translateX(-50%)", background: "rgba(0,0,0,.7)", borderRadius: 20, padding: "8px 16px", fontSize: 15, fontWeight: 800 },
  pista: { position: "absolute", left: 0, right: 0, bottom: 18, textAlign: "center", fontSize: 14, fontWeight: 700, textShadow: "0 1px 4px rgba(0,0,0,.8)" },
  res: { position: "absolute", inset: 0, border: 0, color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "24px 22px", cursor: "pointer", fontFamily: "inherit" },
  icoRes: { width: 104, height: 104, borderRadius: 104, background: "rgba(255,255,255,.18)", display: "grid", placeItems: "center", marginBottom: 14 },
  etq: { marginTop: 10, background: "rgba(0,0,0,.25)", borderRadius: 20, padding: "6px 14px", fontSize: 14, fontWeight: 700 },
  pie: { padding: "12px 12px calc(12px + env(safe-area-inset-bottom))", background: "#0b0c10", borderTop: "1px solid rgba(255,255,255,.08)" },
  btn: { flex: 1, background: "rgba(255,255,255,.06)", color: "#fff", border: "1px solid rgba(255,255,255,.16)", borderRadius: 12, padding: "12px 10px", fontWeight: 700, fontSize: 14.5, cursor: "pointer" },
  chip: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "6px 10px", borderRadius: 20, border: "1px solid", background: "rgba(255,255,255,.04)", flexShrink: 0 },
  hojaWrap: { position: "absolute", inset: 0, zIndex: 5, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "flex-end", justifyContent: "center" },
  hoja: { width: "100%", maxWidth: 520, background: "#12141b", borderRadius: "18px 18px 0 0", padding: "18px 16px calc(18px + env(safe-area-inset-bottom))", border: "1px solid rgba(255,255,255,.1)" },
  input: { width: "100%", boxSizing: "border-box", background: "#05060a", color: "#fff", border: "2px solid rgba(255,255,255,.2)", borderRadius: 12, padding: "14px", fontSize: 22, fontWeight: 800, letterSpacing: 1, fontFamily: "'Roboto Mono', ui-monospace, monospace" },
};

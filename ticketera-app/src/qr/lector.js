// ===================== LECTOR QR COMPARTIDO: cámara y sonidos =====================
// Lo usan el validador de las barras (qr/Validador.jsx) y el de los puestos Multipuesto (web/Puesto.jsx).
// La decisión de si un ticket vale NO está aquí: cada pantalla decide con su servidor.
import { useEffect, useRef, useState } from "react";

// ===== Sonidos de escaneo =====
// Pitido de «correcto», zumbido de «error» y tono de «aviso». Se generan aquí (sin descargar nada).
// Suenan de dos formas, la que funcione en cada móvil:
//  1) Web Audio: la más fiable en iPhone. Se pide la sesión de audio «playback», que va por el canal
//     multimedia (botones de volumen) y suena aunque el interruptor de silencio esté puesto (iOS 16.4+).
//  2) <audio> de reserva (iPhone antiguo o si Web Audio no arranca).
// En iPhone el audio solo se puede desbloquear con un toque «de verdad» (al levantar el dedo, un clic o
// una tecla; NO al apoyar el dedo). Se reintenta en cada toque hasta que queda desbloqueado.
const K_MUDO = "tixfast_validador_mudo";
const RATE = 22050;
function muestras(notas, vol) {
  // notas: [{ f, ini, dur, forma }] en segundos → muestras entre -1 y 1
  const total = Math.max(...notas.map(n => n.ini + n.dur)) + 0.03;
  const n = Math.ceil(total * RATE), out = new Float32Array(n);
  notas.forEach(({ f, ini, dur, forma = "sine" }) => {
    const a = Math.floor(ini * RATE), z = Math.floor(dur * RATE);
    for (let i = 0; i < z && a + i < n; i++) {
      const t = i / RATE, fase = 2 * Math.PI * f * t;
      const v = forma === "square" ? Math.sign(Math.sin(fase)) * 0.6 : forma === "triangle" ? 2 / Math.PI * Math.asin(Math.sin(fase)) : Math.sin(fase);
      const env = Math.min(1, i / (RATE * 0.006)) * Math.min(1, (z - i) / (RATE * 0.03));   // sin chasquidos
      out[a + i] = Math.max(-1, Math.min(1, out[a + i] + v * env * vol));
    }
  });
  return out;
}
function wavDataUri(m) {
  // WAV en data: URI (más fiable en Safari que un blob:)
  const n = m.length, buf = new ArrayBuffer(44 + n * 2), d = new DataView(buf);
  const str = (o, t) => [...t].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); d.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt "); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, RATE, true); d.setUint32(28, RATE * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); str(36, "data"); d.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) d.setInt16(44 + i * 2, Math.round(m[i] * 32767), true);
  const bytes = new Uint8Array(buf); let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return "data:audio/wav;base64," + btoa(bin);
}
const SONIDOS = {
  bien: [{ f: 988, ini: 0, dur: 0.11 }, { f: 1319, ini: 0.1, dur: 0.2 }],                                   // «ding-ding» ascendente
  mal: [{ f: 220, ini: 0, dur: 0.28, forma: "square" }, { f: 165, ini: 0.32, dur: 0.42, forma: "square" }],  // zumbido grave doble
  aviso: [{ f: 660, ini: 0, dur: 0.16, forma: "triangle" }, { f: 660, ini: 0.22, dur: 0.16, forma: "triangle" }],
};
const VOL = { bien: 0.9, mal: 0.75, aviso: 0.9 };

// Un único motor de sonido para toda la app (el validador y el puesto lo comparten)
const motor = { ctx: null, buffers: null, audios: null, audioOk: {}, datos: null };
const datos = () => motor.datos || (motor.datos = Object.fromEntries(Object.keys(SONIDOS).map(k => [k, muestras(SONIDOS[k], VOL[k])])));
function contexto() {
  if (motor.ctx) return motor.ctx;
  try {
    // iPhone: que suene por el canal multimedia aunque el interruptor de silencio esté puesto
    try { if (navigator.audioSession && navigator.audioSession.type !== "playback") navigator.audioSession.type = "playback"; } catch {}
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    const ctx = new AC();
    motor.buffers = Object.fromEntries(Object.entries(datos()).map(([k, m]) => { const b = ctx.createBuffer(1, m.length, RATE); b.getChannelData(0).set(m); return [k, b]; }));
    try { ctx.addEventListener?.("statechange", () => window.dispatchEvent(new Event("tixfast-sonido"))); } catch {}
    motor.ctx = ctx;
  } catch { motor.ctx = null; }
  return motor.ctx;
}
function audios() {
  if (motor.audios) return motor.audios;
  try { motor.audios = Object.fromEntries(Object.entries(datos()).map(([k, m]) => { const a = new Audio(wavDataUri(m)); a.preload = "auto"; a.setAttribute("playsinline", ""); return [k, a]; })); }
  catch { motor.audios = {}; }
  return motor.audios;
}
const webAudioListo = () => motor.ctx?.state === "running";
// Se llama DENTRO de un toque: arranca Web Audio y desbloquea los <audio>
function desbloquear() {
  const ctx = contexto();
  if (ctx) {
    try { if (ctx.state !== "running") ctx.resume?.().catch?.(() => {}); } catch {}
    try { const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, RATE); s.connect(ctx.destination); s.start(0); } catch {}   // silencio: iOS lo exige
  }
  Object.entries(audios()).forEach(([k, a]) => {
    if (motor.audioOk[k]) return;
    try {
      a.muted = true;
      const p = a.play();
      const fin = (ok) => { try { a.pause(); a.currentTime = 0; } catch {} a.muted = false; if (ok) motor.audioOk[k] = true; };
      if (p?.then) p.then(() => fin(true)).catch(() => fin(false)); else fin(true);
    } catch { a.muted = false; }
  });
}
function reproducir(k) {
  const ctx = motor.ctx;
  if (ctx && ctx.state !== "running") { try { ctx.resume?.().catch?.(() => {}); } catch {} }
  if (ctx && ctx.state === "running" && motor.buffers?.[k]) {
    try { const s = ctx.createBufferSource(); s.buffer = motor.buffers[k]; s.connect(ctx.destination); s.start(0); return; } catch {}
  }
  const a = audios()[k]; if (!a) return;
  try { a.pause(); a.currentTime = 0; a.muted = false; a.volume = 1; a.play()?.catch?.(() => {}); } catch {}
}

export function useSonido() {
  const [mudo, setMudo] = useState(() => { try { return localStorage.getItem(K_MUDO) === "1"; } catch { return false; } });
  const mudoRef = useRef(mudo); mudoRef.current = mudo;
  // ¿Ya está desbloqueado? (si no, la pantalla puede pedir un toque)
  const [listo, setListo] = useState(() => webAudioListo());
  const comprobar = () => setTimeout(() => setListo(webAudioListo() || Object.values(motor.audioOk).some(Boolean)), 120);
  const activar = () => { desbloquear(); comprobar(); };
  useEffect(() => {
    // Toques válidos para el iPhone: al levantar el dedo, clic o tecla. Se reintenta en cada uno.
    const toque = () => { if (!webAudioListo()) activar(); };
    const opt = { capture: true, passive: true };
    ["touchend", "click", "keydown", "pointerup"].forEach(e => window.addEventListener(e, toque, opt));
    // Al volver a la app (tras bloquear el móvil o una llamada) el iPhone pausa el audio: se reanuda
    const volver = () => { if (document.visibilityState === "visible" && motor.ctx && motor.ctx.state !== "running") { try { motor.ctx.resume().catch(() => {}); } catch {} comprobar(); } };
    document.addEventListener("visibilitychange", volver);
    const cambio = () => comprobar();
    window.addEventListener("tixfast-sonido", cambio);
    return () => { ["touchend", "click", "keydown", "pointerup"].forEach(e => window.removeEventListener(e, toque, opt)); document.removeEventListener("visibilitychange", volver); window.removeEventListener("tixfast-sonido", cambio); };
  }, []);
  const sonar = (k) => { if (!mudoRef.current) reproducir(k); };
  const vib = (p) => { try { navigator.vibrate?.(p); } catch {} };
  const bien = () => { sonar("bien"); vib(60); };
  const mal = () => { sonar("mal"); vib([220, 90, 220]); };
  const aviso = () => { sonar("aviso"); vib([80, 60, 80]); };
  // Al activar el sonido suena un pitido de prueba en el mismo toque (así se comprueba que se oye)
  const alternarMudo = () => {
    const n = !mudoRef.current; mudoRef.current = n;
    try { localStorage.setItem(K_MUDO, n ? "1" : "0"); } catch {}
    setMudo(n);
    if (!n) { desbloquear(); reproducir("bien"); comprobar(); }
  };
  const probar = () => { desbloquear(); reproducir("bien"); comprobar(); };
  return { activar, bien, mal, aviso, mudo, alternarMudo, listo, probar };
}

// ===== Cámara =====
// Android: lector nativo (BarcodeDetector); iPhone: lector en segundo plano (qr-scanner).
// Si la cámara ya tiene permiso, se abre sola al entrar, y si el móvil la cierra (pantalla bloqueada,
// cambio de app), se vuelve a abrir sola al volver.
// Opciones: alArrancar (p. ej. desbloquear el sonido) · mantenerEncendida (la pantalla no se apaga)
//           · claveCamara (recuerda en este móvil si se usa la cámara trasera o la delantera)
export function useCamaraQR(onTexto, { alArrancar, mantenerEncendida = false, claveCamara = null } = {}) {
  const video = useRef(null);
  const scanner = useRef(null);
  const cb = useRef(onTexto); cb.current = onTexto;
  const alArrancarRef = useRef(alArrancar); alArrancarRef.current = alArrancar;
  const wake = useRef(null);
  const [empezado, setEmpezado] = useState(false);
  const [camErr, setCamErr] = useState(null);
  const [linterna, setLinterna] = useState(null);   // null = no disponible
  const [motor, setMotor] = useState("");
  const [camara, setCamara] = useState(() => { try { return (claveCamara && localStorage.getItem(claveCamara)) || "environment"; } catch { return "environment"; } });
  const camaraRef = useRef(camara); camaraRef.current = camara;
  const pedirPantalla = async () => {
    if (!mantenerEncendida || document.visibilityState !== "visible") return;
    try { if (!wake.current || wake.current.released) wake.current = await navigator.wakeLock?.request("screen"); } catch {}
  };
  const arrancar = async () => {
    alArrancarRef.current?.();
    setEmpezado(true); setCamErr(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("sin cámara"), { name: "NotSupported" });
      const QrScanner = (await import("qr-scanner")).default;
      if (scanner.current) { try { scanner.current.destroy(); } catch {} }
      const sc = new QrScanner(video.current, (r) => cb.current?.(r?.data || ""), {
        preferredCamera: camaraRef.current, maxScansPerSecond: 15, returnDetailedScanResult: true,
        highlightScanRegion: false, highlightCodeOutline: false, onDecodeError: () => {},
      });
      scanner.current = sc;
      await sc.start();
      pedirPantalla();
      try { setMotor(("BarcodeDetector" in window) ? "nativo" : "js"); } catch {}
      try { setLinterna((await sc.hasFlash()) ? false : null); } catch { setLinterna(null); }
    } catch (e) {
      const n = e?.name || String(e || "");
      setCamErr(/NotAllowed|Permission/i.test(n) ? "permiso" : /NotFound|Overconstrained/i.test(n) ? "nocam" : /NotSupported|sin cámara/i.test(n + (e?.message || "")) ? "nosoporta" : "error");
    }
  };
  useEffect(() => {
    let vivo = true;
    (async () => { try { const st = await navigator.permissions?.query({ name: "camera" }); if (vivo && st?.state === "granted") arrancar(); } catch {} })();
    // Se descarga ya el lector (y su versión para iPhone) para que funcione aunque luego se vaya internet
    import("qr-scanner").catch(() => {});
    import("qr-scanner/qr-scanner-worker.min.js").catch(() => {});
    // Al volver a la pantalla (tras bloquear el móvil o cambiar de app) la cámara y la pantalla se reactivan solas
    const volver = () => { if (document.visibilityState !== "visible" || !scanner.current) return; scanner.current.start().catch(() => {}); pedirPantalla(); };
    document.addEventListener("visibilitychange", volver);
    return () => { vivo = false; document.removeEventListener("visibilitychange", volver); try { scanner.current?.destroy(); } catch {} try { wake.current?.release(); } catch {} };
  }, []);
  const toggleLinterna = async () => { try { await scanner.current?.toggleFlash(); setLinterna(!!scanner.current?.isFlashOn()); } catch {} };
  // Cámara trasera ↔ delantera (modo mostrador: el móvil en un soporte mirando a la cola)
  const cambiarCamara = async () => {
    const n = camaraRef.current === "user" ? "environment" : "user";
    setCamara(n); camaraRef.current = n;
    try { if (claveCamara) localStorage.setItem(claveCamara, n); } catch {}
    try { await scanner.current?.setCamera(n); } catch {}
  };
  return { video, empezado, camErr, linterna, motor, arrancar, toggleLinterna, camara, cambiarCamara };
}

// ===== Pistola lectora (USB o Bluetooth en modo teclado) =====
// Estas lectoras «escriben» el código muy deprisa y pulsan Intro. Se distingue de una persona
// tecleando por la velocidad (menos de 60 ms entre letras). No se activa si se está escribiendo en un campo.
export function useLectorTeclado(onTexto, activo = true) {
  const cb = useRef(onTexto); cb.current = onTexto;
  useEffect(() => {
    if (!activo) return;
    let buf = "", ultima = 0;
    const tecla = (e) => {
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const ahora = Date.now();
      if (ahora - ultima > 60) buf = "";
      ultima = ahora;
      if (e.key === "Enter") { if (buf.length >= 10) { e.preventDefault(); cb.current?.(buf); } buf = ""; return; }
      if (e.key.length === 1) buf += e.key;
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [activo]);
}

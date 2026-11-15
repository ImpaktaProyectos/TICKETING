// ===================== LECTOR QR COMPARTIDO: cámara y sonidos =====================
// Lo usan el validador de las barras (qr/Validador.jsx) y el de los puestos Multipuesto (web/Puesto.jsx).
// La decisión de si un ticket vale NO está aquí: cada pantalla decide con su servidor.
import { useEffect, useRef, useState } from "react";

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
export function useSonido() {
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

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { RequireSession } from "./auth.jsx";

// Red de seguridad: si algo falla al dibujar, NO se queda en blanco.
// Las ventas pendientes están guardadas en el dispositivo, así que no se pierde nada.
class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("TIXFAST error:", error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    const box = { minHeight: "100dvh", display: "grid", placeItems: "center", background: "#0b0c10", color: "#eceef5", fontFamily: "Inter, -apple-system, sans-serif", padding: 24, textAlign: "center" };
    const btn = { background: "#ff5a3c", color: "#fff", border: "none", borderRadius: 12, padding: "14px 22px", fontWeight: 800, fontSize: 16, marginTop: 18, cursor: "pointer" };
    return (
      <div style={box}>
        <div style={{ maxWidth: 380 }}>
          <img src="/brand/tixfast_isotipo_app.svg" alt="TIXFAST" width="56" height="56" style={{ display: "block", margin: "0 auto" }} />
          <div style={{ fontWeight: 800, fontSize: 20, marginTop: 8 }}>Algo ha fallado en la pantalla</div>
          <div style={{ color: "#838aa0", fontSize: 14, marginTop: 8 }}>Tus ventas están guardadas en este dispositivo y no se han perdido. Pulsa para recargar y seguir vendiendo.</div>
          <button style={btn} onClick={() => window.location.reload()}>🔄 Recargar y seguir</button>
        </div>
      </div>
    );
  }
}

// Páginas públicas de venta (/e/<evento>) y de entradas (/mis-entradas/<acceso>): sin sesión ni TPV
const PUBLICA = /^\/(e|mis-entradas)\//.test(window.location.pathname);
const Publico = React.lazy(() => import("./web/Publico.jsx"));

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      {PUBLICA ? (
        <React.Suspense fallback={<div style={{ minHeight: "100dvh", background: "#08090d" }} />}><Publico /></React.Suspense>
      ) : (
        <RequireSession>
          <App />
        </RequireSession>
      )}
    </ErrorBoundary>
  </React.StrictMode>
);

// Errores sueltos de red/promesas: se registran, nunca tumban la app
window.addEventListener("unhandledrejection", (e) => { console.warn("Promesa no controlada:", e.reason); e.preventDefault(); });

// PWA: la app abre sin wifi, pero SIEMPRE se actualiza si hay versión nueva
if (!PUBLICA && "serviceWorker" in navigator) {   // la página pública no instala la app
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      // Busca actualización al abrir y cada 60s mientras esté abierta
      reg.update();
      setInterval(() => reg.update(), 60000);
      reg.addEventListener("updatefound", () => {
        const nuevo = reg.installing;
        if (!nuevo) return;
        nuevo.addEventListener("statechange", () => {
          // Hay versión nueva lista y ya había una app instalada -> recargar
          if (nuevo.state === "installed" && navigator.serviceWorker.controller) {
            nuevo.postMessage("SKIP_WAITING");
          }
        });
      });
      // Ya NO se recarga sola (podía pillar a mitad de una venta): avisa y se actualiza al pulsar "Actualizar"
      const habiaVersion = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!habiaVersion) return;                      // primera instalación: nada que avisar
        window.__tixfastUpdate = true;
        window.dispatchEvent(new Event("tixfast-update"));
      });
    } catch (e) { console.warn("SW no registrado:", e); }
  });
}

// Detecta versión nueva publicada (compara el archivo principal de la app) y AVISA, sin recargar sola
(() => {
  const actual = () => { const s = document.querySelector('script[type="module"][src*="/assets/"]'); return s ? s.getAttribute("src") : null; };
  const mio = actual();
  if (!mio || PUBLICA) return;                                    // modo desarrollo
  const check = async () => {
    if (!navigator.onLine || window.__tixfastUpdate) return;
    try {
      const html = await (await fetch("/", { cache: "no-store" })).text();
      const m = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/) || html.match(/src="(\/assets\/[^"]+\.js)"/);
      if (m && m[1] && m[1] !== mio) { window.__tixfastUpdate = true; window.dispatchEvent(new Event("tixfast-update")); }
    } catch {}
  };
  setTimeout(check, 15000);
  setInterval(check, 60000);
})();

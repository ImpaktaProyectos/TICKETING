import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { RequireSession } from "./auth.jsx";

// Red de seguridad: si algo falla al dibujar, NO se queda en blanco.
// Las ventas pendientes están guardadas en el dispositivo, así que no se pierde nada.
class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("Ticketera error:", error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    const box = { minHeight: "100dvh", display: "grid", placeItems: "center", background: "#0b0c10", color: "#eceef5", fontFamily: "Manrope, sans-serif", padding: 24, textAlign: "center" };
    const btn = { background: "#ff5a3c", color: "#fff", border: "none", borderRadius: 12, padding: "14px 22px", fontWeight: 800, fontSize: 16, marginTop: 18, cursor: "pointer" };
    return (
      <div style={box}>
        <div style={{ maxWidth: 380 }}>
          <div style={{ fontSize: 44 }}>⚠️</div>
          <div style={{ fontWeight: 800, fontSize: 20, marginTop: 8 }}>Algo ha fallado en la pantalla</div>
          <div style={{ color: "#838aa0", fontSize: 14, marginTop: 8 }}>Tus ventas están guardadas en este dispositivo y no se han perdido. Pulsa para recargar y seguir vendiendo.</div>
          <button style={btn} onClick={() => window.location.reload()}>🔄 Recargar y seguir</button>
        </div>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <RequireSession>
        <App />
      </RequireSession>
    </ErrorBoundary>
  </React.StrictMode>
);

// Errores sueltos de red/promesas: se registran, nunca tumban la app
window.addEventListener("unhandledrejection", (e) => { console.warn("Promesa no controlada:", e.reason); e.preventDefault(); });

// PWA: la app abre sin wifi, pero SIEMPRE se actualiza si hay versión nueva
if ("serviceWorker" in navigator) {
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
      let recargando = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (recargando) return;
        recargando = true;
        window.location.reload();
      });
    } catch (e) { console.warn("SW no registrado:", e); }
  });
}

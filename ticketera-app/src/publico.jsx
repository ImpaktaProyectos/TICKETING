// Entrada ligera de las páginas públicas (/e, /o, /compra, /mis-entradas).
// No importa el TPV ni el CRM: el comprador solo descarga lo que necesita.
import React from "react";
import ReactDOM from "react-dom/client";
import Publico from "./web/Publico.jsx";
import { guardarCodigoRP } from "./web/rrppEnlace.js";

guardarCodigoRP();   // ?rp=CODIGO del enlace de un RRPP

class Red extends React.Component {
  constructor(p) { super(p); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("TIXFAST web:", error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#08090d", color: "#eceef5", fontFamily: "Inter, -apple-system, sans-serif", padding: 24, textAlign: "center" }}>
        <div style={{ maxWidth: 360 }}>
          <div style={{ fontWeight: 800, fontSize: 20 }}>No se ha podido cargar la página</div>
          <div style={{ color: "#838aa0", fontSize: 14, marginTop: 8 }}>Si estabas comprando, no se ha cobrado nada que no veas confirmado. Prueba a recargar.</div>
          <button onClick={() => window.location.reload()} style={{ background: "#ff5a3c", color: "#fff", border: "none", borderRadius: 12, padding: "14px 22px", fontWeight: 800, fontSize: 16, marginTop: 18, cursor: "pointer" }}>Recargar</button>
        </div>
      </div>
    );
  }
}

window.addEventListener("unhandledrejection", (e) => { console.warn("Promesa no controlada:", e.reason); e.preventDefault(); });

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode><Red><Publico /></Red></React.StrictMode>
);

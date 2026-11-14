// ===================== CAPA PARA VENTANAS (hojas, avisos, vistas previas) =====================
// En iPhone, una ventana «fija» dibujada DENTRO de una zona con scroll queda atrapada: la tapa la barra de abajo
// (el botón de guardar no se ve) y el scroll se queda «enganchado». Por eso todas las ventanas se dibujan aquí:
// en el CRM, en su capa propia (#crm-capas, conserva el tema claro/oscuro); en el resto de la app, en <body>.
// La capa lleva SIEMPRE la tipografía, el color y el suavizado de la app: así toda ventana parece la misma aplicación.
import React from "react";
import { createPortal } from "react-dom";

export const FUENTE_APP = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const estilo = { fontFamily: FUENTE_APP, color: "var(--text)", fontSize: 15, lineHeight: 1.4, WebkitFontSmoothing: "antialiased", MozOsxFontSmoothing: "grayscale", WebkitTextSizeAdjust: "100%" };

export function Capa({ children }) {
  if (typeof document === "undefined") return children;
  return createPortal(<div className="tx-capa" style={estilo}>{children}</div>, document.getElementById("crm-capas") || document.body);
}

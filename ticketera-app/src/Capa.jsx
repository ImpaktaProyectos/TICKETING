// ===================== CAPA PARA VENTANAS (hojas, avisos, vistas previas) =====================
// En iPhone, una ventana «fija» dibujada DENTRO de una zona con scroll queda atrapada: la tapa la barra de abajo
// (el botón de guardar no se ve) y el scroll se queda «enganchado». Por eso todas las ventanas se dibujan aquí:
// en el CRM, en su capa propia (#crm-capas, conserva el tema claro/oscuro); en el resto de la app, en <body>.
import { createPortal } from "react-dom";

export function Capa({ children }) {
  if (typeof document === "undefined") return children;
  return createPortal(children, document.getElementById("crm-capas") || document.body);
}

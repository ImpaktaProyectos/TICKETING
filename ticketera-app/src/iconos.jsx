// ===================== ICONOS DE TIXFAST =====================
// Un solo juego de iconos para toda la app: SVG propios, en línea (sin cargar nada de fuera),
// trazo uniforme y color heredado (currentColor), para que se vean bien en claro y oscuro.
// Uso: <Icono n="estrella" s={16} />  ·  Los emojis quedan solo como CONTENIDO que elige el
// organizador (el emoji de cada tarifa o producto) y en los mensajes de WhatsApp al cliente.
import React from "react";

const RUTAS = {
  estrella: "M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z",
  mapa: "M9 4.5L3.5 6.3v13.2L9 17.7l6 1.8 5.5-1.8V4.5L15 6.3l-6-1.8zM9 4.5v13.2M15 6.3v13.2",
  imprimir: "M6 9V3.5h12V9M6 17.5H4a2 2 0 01-2-2V11a2 2 0 012-2h16a2 2 0 012 2v4.5a2 2 0 01-2 2h-2M6 13.5h12v7H6z",
  dinero: "M2.5 7h19v10h-19zM12 9.6a2.4 2.4 0 110 4.8 2.4 2.4 0 010-4.8zM5.8 11.9v.2M18.2 11.9v.2",
  tarjeta: "M2.5 6h19v12h-19zM2.5 10h19",
  lapiz: "M17 3.5a2.6 2.6 0 013.6 3.6L8 19.7 3 21l1.3-5z",
  web: "M12 2.5a9.5 9.5 0 100 19 9.5 9.5 0 000-19zM2.5 12h19M12 2.5c3 3.4 3 15.6 0 19-3-3.4-3-15.6 0-19",
  personas: "M16.5 21v-2a4 4 0 00-4-4h-5a4 4 0 00-4 4v2M10 3.5a4 4 0 100 8 4 4 0 000-8M20.5 21v-2a4 4 0 00-3-3.85M14.5 3.63a4 4 0 010 7.75",
  botella: "M10 2.5h4M10.6 2.5v3.9c0 1-2.6 2.2-2.6 4.6v8.5a2 2 0 002 2h4a2 2 0 002-2V11c0-2.4-2.6-3.6-2.6-4.6V2.5",
  aviso: "M12 9v4.5M12 17.2v.01M10.3 3.8L1.9 18a2 2 0 001.7 3h16.8a2 2 0 001.7-3L13.7 3.8a2 2 0 00-3.4 0z",
  descargar: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3",
  cerrar: "M18 6L6 18M6 6l12 12",
  ok: "M20 6L9 17l-5-5",
  tarjetas: "M3.5 3.5h7v7h-7zM13.5 3.5h7v7h-7zM3.5 13.5h7v7h-7zM13.5 13.5h7v7h-7z",
  chat: "M21 11.5a8.5 8.5 0 01-8.5 8.5c-1.6 0-3.1-.4-4.4-1.2L3 20l1.2-5.1A8.5 8.5 0 1121 11.5z",
  calendario: "M8 2.5v4M16 2.5v4M3.5 9h17M5 4.5h14a1.5 1.5 0 011.5 1.5v14a1.5 1.5 0 01-1.5 1.5H5A1.5 1.5 0 013.5 20V6A1.5 1.5 0 015 4.5z",
};

export function Icono({ n, s = 16, w = 1.9, style }) {
  const d = RUTAS[n];
  if (!d) return null;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, display: "block", ...style }}>
      <path d={d} />
    </svg>
  );
}
// Para ponerlo delante de un texto, en línea
export const enTexto = { display: "inline-block", verticalAlign: "-3px", marginRight: 6 };

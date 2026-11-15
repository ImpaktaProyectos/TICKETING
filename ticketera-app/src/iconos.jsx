// ===================== ICONOS DE TIXFAST =====================
// Un solo juego de iconos para toda la app: SVG propios, en línea (sin cargar nada de fuera),
// trazo uniforme y color heredado (currentColor), para que se vean bien en claro y oscuro.
// Uso: <Icono n="estrella" s={16} />  ·  Los emojis quedan solo como CONTENIDO que elige el
// organizador (el emoji de cada tarifa o producto) y en los mensajes de WhatsApp al cliente.
import React from "react";

export const RUTAS = {
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
  candado: "M6 10.5h12a1.5 1.5 0 011.5 1.5v7.5A1.5 1.5 0 0118 21H6a1.5 1.5 0 01-1.5-1.5V12A1.5 1.5 0 016 10.5zM8 10.5V7a4 4 0 018 0v3.5",
  flecha: "M5 12h14M13 6l6 6-6 6",
  atras: "M19 12H5M11 18l-6-6 6-6",
  abajo: "M6 9l6 6 6-6",
  copa: "M8 2.5h8l-.6 6.2a3.4 3.4 0 01-6.8 0L8 2.5zM12 12.1v8.4M8.5 21h7",
  mesa: "M4 10.5h16M6.5 10.5V7.8A3.3 3.3 0 019.8 4.5h4.4a3.3 3.3 0 013.3 3.3v2.7M4 10.5v5a1.5 1.5 0 001.5 1.5h13a1.5 1.5 0 001.5-1.5v-5M6.5 17v3M17.5 17v3",
  mezcla: "M7 3.5h10l-1.4 16.1a1.5 1.5 0 01-1.5 1.4H9.9a1.5 1.5 0 01-1.5-1.4L7 3.5zM7.6 9.5h8.8M13 3.5l2.5-2",
  ayuda: "M12 2.5a9.5 9.5 0 100 19 9.5 9.5 0 000-19zM9.4 9.2a2.7 2.7 0 015.2 1c0 1.8-2.6 2.3-2.6 3.8M12 17.2v.01",
  enDirecto: "M12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM7.1 16.9a7 7 0 010-9.8M16.9 7.1a7 7 0 010 9.8",
  fuego: "M12 21.5a7 7 0 01-7-7c0-4.4 4.2-6.6 4.2-11 2.8 1.6 4.4 4.4 4.4 7 .9-.6 1.6-1.7 1.8-2.9 2 1.7 3.6 4.2 3.6 6.9a7 7 0 01-7 7zM12 21.5a2.8 2.8 0 01-2.8-2.8c0-1.9 2.8-3.7 2.8-3.7s2.8 1.8 2.8 3.7a2.8 2.8 0 01-2.8 2.8z",
  reloj: "M12 2.5a9.5 9.5 0 100 19 9.5 9.5 0 000-19zM12 7v5l3.2 2",
  carrito: "M2.5 3.5h2.6l2.3 11.2a1.5 1.5 0 001.5 1.2h8.6a1.5 1.5 0 001.5-1.1L20.8 7H6.2M9.5 20.5h.01M17.5 20.5h.01",
  ticket: "M3.5 7.5A1.5 1.5 0 015 6h14a1.5 1.5 0 011.5 1.5V10a2 2 0 000 4v2.5A1.5 1.5 0 0119 18H5a1.5 1.5 0 01-1.5-1.5V14a2 2 0 000-4zM14.5 6v12",
  // Elementos del plano de la sala
  micro: "M12 2.5a3 3 0 013 3v6a3 3 0 01-6 0v-6a3 3 0 013-3zM5.5 11a6.5 6.5 0 0013 0M12 17.5v4M8.5 21.5h7",
  auriculares: "M3.5 16v-3.5a8.5 8.5 0 0117 0V16M3.5 16a2 2 0 012-2h1A1.5 1.5 0 018 15.5v4A1.5 1.5 0 016.5 21h-1a2 2 0 01-2-2zM20.5 16a2 2 0 00-2-2h-1a1.5 1.5 0 00-1.5 1.5v4a1.5 1.5 0 001.5 1.5h1a2 2 0 002-2z",
  pista: "M12 1.5v4M12 5.5a7.5 7.5 0 100 15 7.5 7.5 0 000-15zM4.5 13h15M12 5.5c2.4 2.2 2.4 12.8 0 15M12 5.5c-2.4 2.2-2.4 12.8 0 15M6.2 9h11.6M6.2 17h11.6",
  altavoz: "M6 2.5h12a1.5 1.5 0 011.5 1.5v16a1.5 1.5 0 01-1.5 1.5H6A1.5 1.5 0 014.5 20V4A1.5 1.5 0 016 2.5zM15.5 14.5a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0zM12 6.5h.01",
  pantalla: "M3 4.5h18v11.5H3zM8.5 20.5h7M12 16v4.5",
  percha: "M10 5.5a2 2 0 114 0c0 1.2-2 1.5-2 3l8.3 6.4a1.4 1.4 0 01-.9 2.6H4.6a1.4 1.4 0 01-.9-2.6L12 8.5",
  aseos: "M8.3 4.2a1.6 1.6 0 11-3.2 0 1.6 1.6 0 013.2 0zM18.9 4.2a1.6 1.6 0 11-3.2 0 1.6 1.6 0 013.2 0zM5.7 21v-5.5H4.6V9.8A1.3 1.3 0 015.9 8.5h1.6a1.3 1.3 0 011.3 1.3v5.7H7.7V21M16.2 21v-4.5h-2l1.8-6.9a1.3 1.3 0 011.3-1h.3a1.3 1.3 0 011.3 1l1.8 6.9h-2V21M12 2.5v19",
  puerta: "M5 21.5V4a1.5 1.5 0 011.5-1.5h11A1.5 1.5 0 0119 4v17.5M3 21.5h18M15 12.5h.01",
  salida: "M14 3.5h5.5A1.5 1.5 0 0121 5v14a1.5 1.5 0 01-1.5 1.5H14M3 12h11M9.5 7.5L14 12l-4.5 4.5",
  escalera: "M3.5 20.5h4v-4h4v-4h4v-4h4v-4",
  pared: "M3 6.5h18v11H3zM3 12h18M9 6.5V12M15 12v5.5",
  columna: "M6.5 3.5h11M6.5 20.5h11M8.5 3.5v17M15.5 3.5v17",
  carpa: "M2.5 20.5L12 3.5l9.5 17zM12 3.5v17M8.5 20.5L12 14l3.5 6.5",
  zona: "M3.5 8V3.5H8M16 3.5h4.5V8M20.5 16v4.5H16M8 20.5H3.5V16",
  arbol: "M12 21.5v-5.5M12 2.5l-6 8h3l-4 5.5h14l-4-5.5h3z",
  camion: "M2.5 6h11v10h-11zM13.5 9.5h4.2l2.8 3.3V16h-7M7.5 18a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM18.5 18a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z",
  texto: "M4.5 6V4.5h15V6M12 4.5v15M9 19.5h6",
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

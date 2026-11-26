// ===================== ICONOS DE PRODUCTO (TPV, tarifas y reservados) =====================
// Un juego propio de iconos para lo que se vende en un evento: comida, dulces, bebidas, copas,
// entradas y accesos, merch y servicios. Mismo dibujo en todos: rejilla de 24, contorno sin relleno,
// trazo redondeado y color heredado (currentColor). Así una tecla del TPV se reconoce de un vistazo
// y todas parecen de la misma familia.
//
// Cómo se guarda: en la columna «emoji» del producto va «i:<clave>» (por ejemplo «i:cerveza»).
// Los productos antiguos que aún tienen un emoji se dibujan con su icono equivalente (EMOJI_A_ICONO),
// sin tocar la base de datos. Si llega algo que no se reconoce, se usa el icono genérico «producto».
import React, { useState } from "react";
import { Capa } from "./Capa.jsx";

// Círculo como trazo de path (para poder juntarlo todo en un solo <path>)
const c = (x, y, r) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

export const ICONOS_PRODUCTO = {
  // ---------- Comida ----------
  hamburguesa: "M4 10.5C4 6.4 7.6 4 12 4s8 2.4 8 6.5zM3.5 13.5c1.4 0 1.4-1 2.8-1s1.4 1 2.8 1 1.4-1 2.9-1 1.4 1 2.8 1 1.4-1 2.8-1 1.4 1 2.9 1M4.5 16.5h15v1A2.5 2.5 0 0117 20H7a2.5 2.5 0 01-2.5-2.5zM9 7.5h.01M12 6.5h.01M15 7.5h.01",
  perrito: "M4.75 9.5h14.5a1.75 1.75 0 010 3.5H4.75a1.75 1.75 0 010-3.5zM3 12.5c.3 3 2.2 5 4.8 5h8.4c2.6 0 4.5-2 4.8-5M7 11.25l1.5-.75 1.5.75 1.5-.75 1.5.75 1.5-.75 1.5.75 1.5-.75",
  patatas: "M5.5 10.5h13l-1.6 9.2a1.5 1.5 0 01-1.5 1.3H8.6a1.5 1.5 0 01-1.5-1.3zM8 10.5L7 4M10.5 10.5V3.5M13.5 10.5l.5-6.5M16 10.5l1.5-5M5.8 12.5c2 1 10.4 1 12.4 0",
  pizza: "M12 21L3.5 6.5C8.6 3.2 15.4 3.2 20.5 6.5zM4.9 8.9c4.3-2.5 9.9-2.5 14.2 0" + c(10, 11.5, 1.1) + c(14, 11.5, 1.1) + c(12, 15.5, 1.1),
  taco: "M3 17.5a9 9 0 0118 0zM6.5 17.5a5.5 5.5 0 0111 0M7 9.5c.8-.9 1.7-.9 2.5 0M14.5 9.5c.8-.9 1.7-.9 2.5 0",
  wrap: "M4 16l8-8a4.24 4.24 0 016 6l-8 8zM12 8l6 6M7.5 12.5l6 6",
  kebab: "M12 2.5v19M8 5h8l-1 13H9zM8.4 9.5h7.2M8.8 14h6.4M9.5 21.5h5",
  bocadillo: "M3 10.5a3 3 0 013-3h12a3 3 0 013 3H3zM3 13.5c1.5 0 1.5-1 3-1s1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1M3 16h18v.5a2 2 0 01-2 2H5a2 2 0 01-2-2z",
  pan: "M4.5 16.5l12-12a2.12 2.12 0 013 3l-12 12a2.12 2.12 0 01-3-3zM8.5 12.5l1.5 1.5M11.5 9.5l1.5 1.5M14.5 6.5l1.5 1.5",
  cruasan: "M4 15.5c0-5 3.6-9 8-9s8 4 8 9c-1.5 0-2.5-1-3-2.5-.8 1.5-2.5 2.5-5 2.5s-4.2-1-5-2.5c-.5 1.5-1.5 2.5-3 2.5zM9.5 7.3l1.3 7.6M14.5 7.3l-1.3 7.6",
  tapa: "M4 14h16v2.5a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 16.5zM6 14c0-2.2 2.7-4 6-4s6 1.8 6 4M12 10V3.5M10.5 3.5h3",
  pollo: "M15.5 3.5a5 5 0 00-5 5c0 1.3.4 2.3 1 3.1L7.6 15.5a2 2 0 10-2.1 3 2 2 0 103-2.1l3.9-3.9c.8.6 1.8 1 3.1 1a5 5 0 000-10z",
  carne: "M8 4.5c4-1.5 9.5 0 11.5 4s-.5 9-5 10.5S6 20.5 4.5 17 4 6 8 4.5zM8.5 9.5c2 0 3.2 1 4 2.5M10.5 14.5c1.5.4 3 0 4-1.2",
  brocheta: "M3.5 20.5l17-17" + c(8, 16, 2.4) + c(12, 12, 2.4) + c(16, 8, 2.4),
  huevo: "M12 3.5c3 0 4 2 6 3s3 3.5 2 6-1 4-4 5.5-6 2-8.5.5S3 15 3.5 12s2-3 3.5-5 2-3.5 5-3.5z" + c(12, 12, 3),
  queso: "M3 11.5L16 5l5 6.5zM3 11.5V18h18v-6.5" + c(8, 15, 1.2) + c(15.5, 14.5, 1.5),
  jamon: "M6.5 20.5l-2-2 2.2-2.2C5 12 7 6 12.5 4c3-1 6.5 1 7.3 4 .9 3.6-2 7.6-6.3 9.2-2 .7-3.9.9-5.6.5zM16.5 7c-1.5 1-2.5 2.8-2.5 5",
  ensalada: "M3.5 11.5h17a8.5 8.5 0 01-17 0zM9 20.5h6M8 11.5c0-2.5 1.5-4.5 4-5 0 2.5-1.5 4.5-4 5zM12.5 11.5c.5-2 2.2-3.3 4.5-3.5-.3 2-1.8 3.3-4 3.5",
  sopa: "M3.5 11h17a8.5 8.5 0 01-17 0zM9 20h6M9 8c-1-1 1-2 0-3.5M12 8c-1-1 1-2 0-3.5M15 8c-1-1 1-2 0-3.5",
  bol: "M3.5 11.5h17a8.5 8.5 0 01-17 0zM9 20.5h6M13 9l6.5-6M10.5 9L16 3",
  pasta: "M3.5 12h17a8.5 8.5 0 01-17 0zM9 20.5h6M6.5 12c.5-1.5 1.5-2 2.5-1.5s1.5 1 2.5.5 2-1 3-.5 2 1 3 1.5M16 9l3-6.5M13.5 9.5l3.5-6",
  paella: "M2 12h3M19 12h3M5 12a7 3.5 0 0014 0 7 3.5 0 00-14 0zM5 12v1.5a7 3.5 0 0014 0V12M9.5 11.5h.01M12.5 12.5h.01M14.5 11h.01",
  sushi: "M4 15.5a2 2 0 012-2h12a2 2 0 012 2v1a2 2 0 01-2 2H6a2 2 0 01-2-2zM5 13.5c1-3 4-4.5 7-4.5s6 1.5 7 4.5M10 9.3l-1 4.2M14 9.3l1 4.2",
  gamba: "M17.5 4.5C11 4.5 6 8 6 13s3 6.5 6 6.5c2 0 3-1.2 3-2.5s-1-2.5-3-2M17.5 4.5a2 2 0 010 4c-3 0-5.5 2-5.5 5M6.5 9.5L3 7.5M8.5 7L7 4",
  calamares: c(8.5, 9.5, 4.5) + c(8.5, 9.5, 2) + c(15.5, 14.5, 4.5) + c(15.5, 14.5, 2),
  aceitunas: c(8.5, 14.5, 4.5) + c(16, 12, 3.5) + "M8.5 10V6c2 0 3.5-1 4.5-2.5",
  nachos: "M3.5 13h17l-1.5 5.5a2 2 0 01-2 1.5H7a2 2 0 01-2-1.5zM6.5 13l2.5-7 3.5 7M11 13l4.5-6 2.5 6",
  palomitas: "M5 9.5h14l-1.7 10.2a1.5 1.5 0 01-1.5 1.3H8.2a1.5 1.5 0 01-1.5-1.3zM10 9.5l.5 11.5M14 9.5l-.5 11.5M5 9.5a2.5 2.5 0 012.8-3.3A3 3 0 0112 4a3 3 0 014.2 2.2A2.5 2.5 0 0119 9.5",
  snack: "M6 3.5h12l-1 3 1 11.5-1 3H7l-1-3L7 6.5zM6.6 6.5h10.8M6.3 18h11.4M10 11l4 3M14 11l-4 3",
  picante: "M7 19c6-1 11.5-6 11.5-12.5 0-1-.5-1.5-1.5-1.5-1.5 0-2 1.5-2.5 3-1.5 4-5 8-8 9-1.2.4-1 2 .5 2zM17 5c0-1 .5-2 1.5-2.5",
  vegano: "M5 19c0-8 5-13.5 15-14.5-1 10-6.5 15-15 14.5zM5 19l8-8",
  plato: "M3 18h18M4.5 18a7.5 7.5 0 0115 0M12 7.5V5.5M10.5 5.5h3",

  // ---------- Dulces y fruta ----------
  donut: c(12, 12, 8.5) + c(12, 12, 3) + "M7.5 7.5l1 .6M15.5 7l.4 1M6.8 14l.9.7M16 15.5l1-.3M12.5 5.5l.6.8",
  galleta: c(12, 12, 8.5) + "M9 8.5h.01M14.5 9h.01M8.5 14h.01M13 13h.01M15.5 16h.01",
  tarta: "M4 20.5h16M5 20.5v-8h14v8M5 15c1.5 1 2.5 1 3.5 0s2.5-1 3.5 0 2.5 1 3.5 0 2.5-1 3.5 0M12 12.5V9M12 6.5c-.8 0-1-.8-1-1.3S12 3.5 12 3.5s1 1.2 1 1.7-.2 1.3-1 1.3z",
  magdalena: "M6 12.5h12l-1.5 8h-9zM6 12.5a2.5 2.5 0 01-.5-4.8A4 4 0 0112 4.5a4 4 0 016.5 3.2 2.5 2.5 0 01-.5 4.8M10 12.5l.5 8M14 12.5l-.5 8",
  chocolate: "M6.5 3.5h11a1 1 0 011 1v15a1 1 0 01-1 1h-11a1 1 0 01-1-1v-15a1 1 0 011-1zM5.5 9h13M5.5 14.5h13M12 3.5v17",
  caramelo: c(12, 12, 4) + "M8.5 10L4 7.5v9L8.5 14M15.5 10L20 7.5v9L15.5 14",
  piruleta: c(12, 9, 5.5) + "M12 14.5v7M9 9a3 3 0 016 0",
  helado: "M7.5 11h9L12 21.5zM7 11a5 5 0 1110 0M9.3 14.5h5.4",
  polo: "M8 7.5a4 4 0 018 0V16a1.5 1.5 0 01-1.5 1.5h-5A1.5 1.5 0 018 16zM12 17.5V21",
  flan: "M3.5 18.5h17M6 18.5l2-9h8l2 9M8 9.5c0-1.5 1.8-2.5 4-2.5s4 1 4 2.5",
  gofre: "M6.5 4.5h11a2 2 0 012 2v11a2 2 0 01-2 2h-11a2 2 0 01-2-2v-11a2 2 0 012-2zM4.5 9.5h15M4.5 14.5h15M9.5 4.5v15M14.5 4.5v15",
  crepe: "M3.5 7.5c6-2 11-2 17 0L12 20.5zM5.5 10c4.5-1.2 8.5-1.2 13 0",
  churros: "M5 20.5c1-6 3-12 7-16.5M9 20.5c.5-5 2.5-10 6.5-14M13 20.5c.5-4 2-8 5.5-11",
  algodon: "M12 21.5V13M7.5 13a4 4 0 01-1-7.8A4.5 4.5 0 0112 3a4.5 4.5 0 015.5 2.2 4 4 0 01-1 7.8z",
  fruta: "M12 7.5c-2-1.5-7-1.5-7 4.5 0 4 2.5 9 5 9 1 0 1.3-.5 2-.5s1 .5 2 .5c2.5 0 5-5 5-9 0-6-5-6-7-4.5zM12 7.5c0-2 1-3.5 3-4",
  sandia: "M3 9a9 9 0 0018 0zM5.5 9a6.5 6.5 0 0013 0M9 12h.01M12 13.5h.01M15 12h.01",
  limon: c(12, 12, 8.5) + c(12, 12, 5.5) + "M12 6.5v11M6.5 12h11M8.1 8.1l7.8 7.8M15.9 8.1l-7.8 7.8",
  platano: "M5 6c0 7.5 4.5 13.5 11.5 13.5 1.8 0 3.3-.4 4.5-1.2C14.5 18 10 13 9 6.5L8 4H5.5z",

  // ---------- Bebidas ----------
  refresco: "M5.5 8h13M6.5 8l1.3 12.1a1.5 1.5 0 001.5 1.4h5.4a1.5 1.5 0 001.5-1.4L17.5 8M6 8l.6-2.5h10.8L18 8M12 5.5V4.5l3-2",
  lata: "M7 4.5h10v15a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 017 19.5zM7 4.5L8 3h8l1 1.5M7 7.5h10M7 17.5h10",
  energetica: "M7 4.5h10v15a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 017 19.5zM7 4.5L8 3h8l1 1.5M12.8 8.5L10.3 13h3.2l-2 4",
  agua: "M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11zM9 14.5a3 3 0 003 3",
  botellaAgua: "M10 2.5h4M10.5 2.5V5c-2 .8-3 2-3 4v10.5A1.5 1.5 0 009 21h6a1.5 1.5 0 001.5-1.5V9c0-2-1-3.2-3-4V2.5M7.5 11h9M7.5 16h9",
  zumo: "M7 7.5h10v13H7zM7 7.5L8.5 4h7L17 7.5M13 4V2.5h3M10 13a2 2 0 104 0 2 2 0 10-4 0",
  batido: "M7 9h10l-1.2 11.1a1.5 1.5 0 01-1.5 1.4H9.7a1.5 1.5 0 01-1.5-1.4zM7 9c0-1.7 2.2-3 5-3s5 1.3 5 3M13 6l2-3.5h2.5",
  cafe: "M4.5 9.5h12v5a5 5 0 01-5 5h-2a5 5 0 01-5-5zM16.5 11h1.5a2.5 2.5 0 010 5h-2M8.5 2.5c-.6.8-.6 1.7 0 2.5s.6 1.7 0 2.5M12.5 2.5c-.6.8-.6 1.7 0 2.5s.6 1.7 0 2.5",
  te: "M4.5 9.5h12v5a5 5 0 01-5 5h-2a5 5 0 01-5-5zM16.5 11h1.5a2.5 2.5 0 010 5h-2M10.5 13V4.5M9.5 13h2v2.2h-2z",
  hielo: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9",
  vaso: "M5.5 4.5h13l-1.6 15.1a1.5 1.5 0 01-1.5 1.4H8.6a1.5 1.5 0 01-1.5-1.4zM6.3 11h11.4",
  retornable: "M5.5 4.5h13l-1.6 15.1a1.5 1.5 0 01-1.5 1.4H8.6a1.5 1.5 0 01-1.5-1.4zM14.5 12.5a2.5 2.5 0 11-1-2M14.5 9.5v1.5H13",

  // ---------- Copas ----------
  cerveza: "M5 7h10v12.5a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 015 19.5zM15 9.5h2a2 2 0 012 2v4a2 2 0 01-2 2h-2M8.5 10.5v7M11.5 10.5v7M5 7a2.5 2.5 0 012.3-3.5A3 3 0 0112.5 3.5 2.5 2.5 0 0115 7",
  cana: "M7 3.5h10l-1.4 16.1a1.5 1.5 0 01-1.5 1.4H9.9a1.5 1.5 0 01-1.5-1.4zM7.4 8h9.2",
  botellin: "M10 2.5h4M10.5 2.5v4l-2 3.5v10a1.5 1.5 0 001.5 1.5h4a1.5 1.5 0 001.5-1.5V10l-2-3.5v-4M8.5 13h7v4h-7",
  vino: "M7.5 3h9c.5 4 .5 9-4.5 9.5C7 12 7 7 7.5 3zM12 12.5v8M8.5 21h7M7.3 7h9.4",
  cava: "M9.5 2.5h5c.3 5 .2 9.5-2.5 10-2.7-.5-2.8-5-2.5-10zM12 12.5v8M9 21h6M11.5 6.5h.01M12.8 8.8h.01",
  botella: "M10 2.5h4M10.5 2.5V6c-2 1-3 2.5-3 4.5v9a1.5 1.5 0 001.5 1.5h6a1.5 1.5 0 001.5-1.5v-9c0-2-1-3.5-3-4.5V2.5M7.5 13h9v4.5h-9z",
  coctel: "M3.5 4h17L12 13zM12 13v7.5M8 21h8M6.2 6.8h11.6" + c(10.5, 8.5, 0.9),
  cubata: "M6 3.5h12l-1.3 16.1a1.5 1.5 0 01-1.5 1.4H8.8a1.5 1.5 0 01-1.5-1.4zM6.6 10.5h10.8M13 10.5L15.5 2" + c(10, 15, 1.6),
  chupito: "M7 7h10l-1.3 11.7a1.5 1.5 0 01-1.5 1.3H9.8a1.5 1.5 0 01-1.5-1.3zM7.6 12h8.8M8.3 17h7.4",
  whisky: "M4.5 8h15l-1.3 11.1a1.5 1.5 0 01-1.5 1.4H7.3a1.5 1.5 0 01-1.5-1.4zM8 12.5l3-1.5 1.5 3-3 1.5zM13 13.2l2.5-.7.7 2.5-2.5.7z",
  jarra: "M5.5 4.5h10l1 3v12a1.5 1.5 0 01-1.5 1.5H7a1.5 1.5 0 01-1.5-1.5zM5.5 4.5L3.5 6.5M16.5 9h1.5a2 2 0 012 2v3.5a2 2 0 01-2 2h-1.5M5.5 11h11M9 14.5h.01M12.5 16h.01M10.5 18h.01",

  // ---------- Entradas y accesos ----------
  entrada: "M3.5 7.5A1.5 1.5 0 015 6h14a1.5 1.5 0 011.5 1.5V10a2 2 0 000 4v2.5A1.5 1.5 0 0119 18H5a1.5 1.5 0 01-1.5-1.5V14a2 2 0 000-4zM14.5 6v2M14.5 11v2M14.5 16v2",
  abono: "M3.5 9.5A1.5 1.5 0 015 8h12a1.5 1.5 0 011.5 1.5v1.5a1.75 1.75 0 000 3.5v1.5A1.5 1.5 0 0117 17.5H5a1.5 1.5 0 01-1.5-1.5v-1.5a1.75 1.75 0 000-3.5zM7 5h12.5A1.5 1.5 0 0121 6.5V14M13.5 8v9.5",
  vip: "M3.5 8l4 3.5L12 5l4.5 6.5 4-3.5-1.5 10.5h-14zM5 21h14",
  premium: "M6.5 4h11l3.5 5-9 11L3 9zM3 9h18M9.5 4L8 9l4 11M14.5 4L16 9l-4 11",
  estrella: "M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z",
  pulsera: "M3.5 11a8.5 5 0 1017 0 8.5 5 0 10-17 0M6.5 11a5.5 2.8 0 1011 0 5.5 2.8 0 10-11 0M10 15.5h4v4h-4z",
  credencial: "M6.5 6h11a1.5 1.5 0 011.5 1.5v12a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 015 19.5v-12A1.5 1.5 0 016.5 6zM10 3h4v4.5h-4zM9 17h6" + c(12, 12.5, 2),
  reservado: "M4 11V8a2.5 2.5 0 012.5-2.5h11A2.5 2.5 0 0120 8v3M2.5 13a1.5 1.5 0 013 0v2h13v-2a1.5 1.5 0 013 0v4.5h-19zM5 17.5V20M19 17.5V20",
  mesa: "M4 10.5h16M6.5 10.5V7.8A3.3 3.3 0 019.8 4.5h4.4a3.3 3.3 0 013.3 3.3v2.7M4 10.5v5a1.5 1.5 0 001.5 1.5h13a1.5 1.5 0 001.5-1.5v-5M6.5 17v3M17.5 17v3",
  persona: c(12, 7.5, 4) + "M4.5 21a7.5 7.5 0 0115 0",
  grupo: "M16.5 21v-2a4 4 0 00-4-4h-5a4 4 0 00-4 4v2M10 3.5a4 4 0 100 8 4 4 0 000-8M20.5 21v-2a4 4 0 00-3-3.85M14.5 3.63a4 4 0 010 7.75",
  parking: "M5 3.5h14a1.5 1.5 0 011.5 1.5v14a1.5 1.5 0 01-1.5 1.5H5A1.5 1.5 0 013.5 19V5A1.5 1.5 0 015 3.5zM9.5 17V7h3.5a3 3 0 010 6H9.5",
  bus: "M5 3.5h14a1.5 1.5 0 011.5 1.5v12h-17V5A1.5 1.5 0 015 3.5zM3.5 11h17M6.5 17v3M17.5 17v3M7.5 14h.01M16.5 14h.01",
  camping: "M2.5 20.5L12 4l9.5 16.5zM12 4v16.5M8.5 20.5L12 14l3.5 6.5",
  musica: "M9 18V5.5l11-2v12.5" + c(6.5, 18, 2.5) + c(17.5, 16, 2.5),
  micro: "M12 2.5a3 3 0 013 3v6a3 3 0 01-6 0v-6a3 3 0 013-3zM5.5 11a6.5 6.5 0 0013 0M12 17.5v4M8.5 21.5h7",
  dj: "M3.5 16v-3.5a8.5 8.5 0 0117 0V16M3.5 16a2 2 0 012-2h1A1.5 1.5 0 018 15.5v4A1.5 1.5 0 016.5 21h-1a2 2 0 01-2-2zM20.5 16a2 2 0 00-2-2h-1a1.5 1.5 0 00-1.5 1.5v4a1.5 1.5 0 001.5 1.5h1a2 2 0 002-2z",
  fiesta: "M3.5 20.5L8 8l8 8zM8 8c3-1 6 2 5 5M13 5.5c0-1 .5-2 1.5-2.5M17 8.5c1 0 2-.5 2.5-1.5M15.5 3.5h.01M20.5 11.5h.01M18.5 4.5l-.5 1",
  fuego: "M12 21.5a7 7 0 01-7-7c0-4.4 4.2-6.6 4.2-11 2.8 1.6 4.4 4.4 4.4 7 .9-.6 1.6-1.7 1.8-2.9 2 1.7 3.6 4.2 3.6 6.9a7 7 0 01-7 7z",
  atraccion: c(12, 10, 6.5) + "M12 3.5v13M5.5 10h13M7.4 5.4l9.2 9.2M16.6 5.4l-9.2 9.2M8 21l4-4.5 4 4.5",
  trofeo: "M7.5 3.5h9v5a4.5 4.5 0 01-9 0zM7.5 5.5h-3c0 3 1.5 4.5 3.5 4.5M16.5 5.5h3c0 3-1.5 4.5-3.5 4.5M12 13v4M8.5 20.5h7l-.5-3.5H9z",
  diana: c(12, 12, 8.5) + c(12, 12, 5) + c(12, 12, 1.5),
  luna: "M20 14.5A8.5 8.5 0 119.5 4a6.5 6.5 0 0010.5 10.5z",
  sol: c(12, 12, 4) + "M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4",
  corazon: "M12 20s-8.5-5-8.5-11A4.5 4.5 0 0112 6.5 4.5 4.5 0 0120.5 9c0 6-8.5 11-8.5 11z",

  // ---------- Merch y servicios ----------
  camiseta: "M8.5 3.5L3 6.5l2 4.5 2.5-1v10.5h9V10l2.5 1 2-4.5-5.5-3a3.5 3.5 0 01-7 0z",
  sudadera: "M9 3.5L5 5.5 3 19.5h3.5l1-7v8h9v-8l1 7H21L19 5.5l-4-2c0 2-1.3 3.5-3 3.5S9 5.5 9 3.5zM9.5 16h5",
  gorra: "M4 15a8 8 0 0116 0zM4 15h16.5a1 1 0 01.7 1.7l-.5.5a2 2 0 01-1.4.6H5a1 1 0 01-1-1zM12 7V5.5",
  bolsa: "M5 8.5h14l-1 12H6zM9 8.5V7a3 3 0 016 0v1.5",
  mochila: "M7 7.5h10a2 2 0 012 2V19a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 015 19V9.5a2 2 0 012-2zM9.5 7.5V5a2.5 2.5 0 015 0v2.5M8 14h8v3.5H8z",
  gafas: c(6.5, 14, 3.5) + c(17.5, 14, 3.5) + "M10 14c1.3-1 2.7-1 4 0M3 14V9l2-3M21 14V9l-2-3",
  abanico: "M12 20.5L3.5 9a10.5 10.5 0 0117 0zM12 20.5L8 7.9M12 20.5V7.2M12 20.5l4-12.6",
  paraguas: "M3 12a9 9 0 0118 0zM12 12v6.5a2 2 0 01-4 0M12 3V2",
  cartel: "M5 3.5h14v17H5zM5 15l4-4 4 4 2-2 4 4M14.5 8.5h.01",
  vinilo: c(12, 12, 8.5) + c(12, 12, 2.5) + "M12 6.5a5.5 5.5 0 015.5 5.5",
  bandera: "M5 21.5V3.5M5 4.5h12l-2.5 4 2.5 4H5",
  guardarropa: "M10 5.5a2 2 0 114 0c0 1.2-2 1.5-2 3l8.3 6.4a1.4 1.4 0 01-.9 2.6H4.6a1.4 1.4 0 01-.9-2.6L12 8.5",
  taquilla: c(8, 15, 4.5) + "M11.2 11.8L20 3M17 6l2.5 2.5M14.5 8.5l2 2",
  bateria: "M3.5 7.5h14a1.5 1.5 0 011.5 1.5v6a1.5 1.5 0 01-1.5 1.5h-14A1.5 1.5 0 012 15V9a1.5 1.5 0 011.5-1.5zM21.5 10.5v3M11.5 9.5L9 12h3.5L10 14.5",
  movil: "M7.5 2.5h9a1.5 1.5 0 011.5 1.5v16a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 016 20V4a1.5 1.5 0 011.5-1.5zM11 18.5h2",
  linterna: "M8 3.5h8v4l-2 3v10h-4v-10l-2-3zM8 7.5h8M12 13.5v2",
  globo: "M12 15.5c-3.6 0-6-3.2-6-6.5a6 6 0 0112 0c0 3.3-2.4 6.5-6 6.5zM11 17h2l-1-1.5zM12 17c0 2 1.5 2 1.5 4.5",
  aseos: c(6.7, 4.2, 1.6) + c(17.3, 4.2, 1.6) + "M5.7 21v-5.5H4.6V9.8A1.3 1.3 0 015.9 8.5h1.6a1.3 1.3 0 011.3 1.3v5.7H7.7V21M16.2 21v-4.5h-2l1.8-6.9a1.3 1.3 0 011.3-1h.3a1.3 1.3 0 011.3 1l1.8 6.9h-2V21M12 2.5v19",

  // ---------- Otros ----------
  ficha: c(12, 12, 8.5) + c(12, 12, 5.5),
  dinero: "M2.5 7h19v10h-19zM5.8 11.9v.2M18.2 11.9v.2" + c(12, 12, 2.4),
  tarjeta: "M2.5 6h19v12h-19zM2.5 10h19M6 14.5h4",
  recibo: "M5.5 3h13v18l-2.2-1.5-2.1 1.5-2.2-1.5L9.8 21l-2.1-1.5L5.5 21zM9 8h6M9 12h6M9 16h3",
  regalo: "M3.5 8h17v4h-17zM5 12h14v8.5H5zM12 8v12.5M12 8C11 5 7.5 3 7 5.5S10 8 12 8zM12 8c1-3 4.5-5 5-2.5S14 8 12 8z",
  extra: c(12, 12, 8.5) + "M12 8v8M8 12h8",
  etiqueta: "M3 12.6V4.5A1.5 1.5 0 014.5 3h8.1a1.5 1.5 0 011.1.4l7.5 7.5a1.5 1.5 0 010 2.1l-7.6 7.6a1.5 1.5 0 01-2.1 0L3.4 13.6a1.5 1.5 0 01-.4-1zM8 7.5h.01",
  reloj: c(12, 12, 8.5) + "M12 7.5V12l3 2",
  producto: "M3.5 7.5A1 1 0 014.5 6.5h15a1 1 0 011 1v3h-17zM5 10.5v9a1 1 0 001 1h12a1 1 0 001-1v-9M10 14.5h4",
};

// Catálogo del selector: categoría → [clave, nombre, palabras para buscar]
export const CATEGORIAS_ICONOS = [
  { k: "comida", l: "Comida", items: [
    ["hamburguesa", "Hamburguesa", "burger"], ["perrito", "Perrito caliente", "hot dog salchicha frankfurt"], ["patatas", "Patatas fritas", "papas salchipapa bravas"],
    ["pizza", "Pizza", "porcion"], ["taco", "Taco", "mexicano"], ["wrap", "Wrap o burrito", "durum fajita"], ["kebab", "Kebab", "shawarma"],
    ["bocadillo", "Bocadillo", "sandwich montado bocata"], ["pan", "Pan", "baguette barra"], ["cruasan", "Cruasán", "croissant bolleria desayuno"],
    ["tapa", "Tapa o pincho", "pintxo montadito"], ["pollo", "Pollo", "alitas muslo"], ["carne", "Carne", "filete chuleton costillas churrasco bacon"],
    ["brocheta", "Brocheta", "pincho moruno"], ["huevo", "Huevo", "frito desayuno"], ["queso", "Queso", "tabla"], ["jamon", "Jamón", "iberico embutido"],
    ["ensalada", "Ensalada", "verde"], ["sopa", "Sopa o caldo", "guiso olla ramen"], ["bol", "Bol o arroz", "poke wok fideos asiatico curry"],
    ["pasta", "Pasta", "espagueti macarrones"], ["paella", "Paella", "arroz cazuela migas"], ["sushi", "Sushi", "japones nigiri"],
    ["gamba", "Gambas", "marisco tempura"], ["calamares", "Calamares", "rabas anillas pulpo"], ["aceitunas", "Aceitunas", "olivas encurtidos"],
    ["nachos", "Nachos", "totopos"], ["palomitas", "Palomitas", "cine"], ["snack", "Snack", "bolsa patatas frutos secos cacahuetes pretzel"],
    ["picante", "Picante", "guindilla chile"], ["vegano", "Vegano", "vegetariano hoja verde"], ["plato", "Plato o menú", "comida menu del dia"]] },
  { k: "dulce", l: "Dulces y fruta", items: [
    ["donut", "Dónut", "rosquilla"], ["galleta", "Galleta", "cookie"], ["tarta", "Tarta", "pastel cumpleaños"], ["magdalena", "Magdalena", "cupcake muffin"],
    ["chocolate", "Chocolate", "tableta"], ["caramelo", "Caramelo", "chuches golosinas"], ["piruleta", "Piruleta", "chupachups"], ["helado", "Helado", "cucurucho"],
    ["polo", "Polo", "granizado hielo"], ["flan", "Flan", "postre natillas"], ["gofre", "Gofre", "waffle"], ["crepe", "Crep", "tortitas crepes"],
    ["churros", "Churros", "porras"], ["algodon", "Algodón de azúcar", "feria"], ["fruta", "Fruta", "manzana naranja"], ["sandia", "Sandía", "melon"],
    ["limon", "Limón", "citrico lima"], ["platano", "Plátano", "banana"]] },
  { k: "bebida", l: "Bebidas", items: [
    ["refresco", "Refresco", "cola vaso"], ["lata", "Lata", "refresco"], ["energetica", "Energética", "red bull"], ["agua", "Agua", "gota"],
    ["botellaAgua", "Botella de agua", "agua"], ["zumo", "Zumo", "brick"], ["batido", "Batido", "leche smoothie bubble tea"], ["cafe", "Café", "cortado"],
    ["te", "Té", "infusion mate"], ["hielo", "Hielo", "cubitos"], ["vaso", "Vaso", "reutilizable"], ["retornable", "Vaso retornable", "reutilizable devolucion ecovaso fianza"]] },
  { k: "copas", l: "Copas", items: [
    ["cerveza", "Cerveza", "jarra"], ["cana", "Caña", "cerveza tubo"], ["botellin", "Botellín", "tercio cerveza"], ["vino", "Vino", "tinto blanco vermut"],
    ["cava", "Cava", "champan brindis"], ["botella", "Botella", "champan reservado"], ["coctel", "Cóctel", "martini"], ["cubata", "Cubata", "combinado gin tonic mojito ron"],
    ["chupito", "Chupito", "shot"], ["whisky", "Whisky", "rocas licor"], ["jarra", "Jarra", "sangria tinto de verano"]] },
  { k: "entrada", l: "Entradas y accesos", items: [
    ["entrada", "Entrada", "ticket general"], ["abono", "Abono", "varios dias bono"], ["vip", "VIP", "corona"], ["premium", "Premium", "diamante"],
    ["estrella", "Estrella", "destacado"], ["pulsera", "Pulsera", "acceso"], ["credencial", "Acreditación", "pase staff prensa"], ["reservado", "Reservado", "sofa zona vip"],
    ["mesa", "Mesa", "reserva"], ["persona", "Persona", "infantil niño adulto"], ["grupo", "Grupo", "pack amigos"], ["parking", "Parking", "aparcamiento"],
    ["bus", "Autobús", "lanzadera transporte"], ["camping", "Camping", "tienda acampada"], ["musica", "Música", "concierto"], ["micro", "Micrófono", "karaoke"],
    ["dj", "DJ", "auriculares sesion"], ["fiesta", "Fiesta", "celebracion"], ["fuego", "Fuego", "hot"], ["atraccion", "Atracción", "noria feria"],
    ["trofeo", "Trofeo", "premio torneo"], ["diana", "Diana", "dardos juego"], ["luna", "Noche", "luna"], ["sol", "Día", "sol"], ["corazon", "Corazón", "amor"]] },
  { k: "merch", l: "Merch y servicios", items: [
    ["camiseta", "Camiseta", "merch"], ["sudadera", "Sudadera", "chaqueta"], ["gorra", "Gorra", "merch"], ["bolsa", "Bolsa", "tote bolso"],
    ["mochila", "Mochila", ""], ["gafas", "Gafas", "sol"], ["abanico", "Abanico", ""], ["paraguas", "Chubasquero", "paraguas lluvia"],
    ["cartel", "Cartel", "poster lamina"], ["vinilo", "Disco", "vinilo cd"], ["bandera", "Bandera", ""], ["guardarropa", "Guardarropa", "ropero percha"],
    ["taquilla", "Taquilla", "llave locker"], ["bateria", "Carga de móvil", "bateria powerbank"], ["movil", "Móvil", "telefono"], ["linterna", "Linterna", "luz"],
    ["globo", "Globo", ""], ["aseos", "Aseos", "baños"]] },
  { k: "otros", l: "Otros", items: [
    ["ficha", "Ficha", "token moneda consumicion"], ["dinero", "Dinero", "euro efectivo"], ["tarjeta", "Tarjeta", "pago"], ["recibo", "Recibo", "ticket"],
    ["regalo", "Regalo", "peluche sorteo"], ["extra", "Extra", "suplemento"], ["etiqueta", "Etiqueta", "oferta gratis nuevo"], ["reloj", "Hora", "early bird"],
    ["producto", "Producto", "caja paquete otro"]] },
];
export const ICONOS_TODOS = CATEGORIAS_ICONOS.flatMap(cat => cat.items);

// Emojis antiguos → icono equivalente (los productos ya creados se ven bien sin tocar nada)
export const EMOJI_A_ICONO = {
  "🍔": "hamburguesa", "🌭": "perrito", "🍟": "patatas", "🍕": "pizza", "🌮": "taco", "🌯": "wrap", "🥙": "kebab", "🥪": "bocadillo", "🥖": "pan", "🧆": "tapa",
  "🍗": "pollo", "🍖": "carne", "🥩": "carne", "🥓": "carne", "🍳": "huevo", "🥚": "huevo", "🧀": "queso", "🥗": "ensalada", "🍝": "pasta", "🍜": "bol",
  "🍲": "sopa", "🥘": "paella", "🍛": "bol", "🍚": "bol", "🍱": "plato", "🍣": "sushi", "🍤": "gamba", "🦐": "gamba", "🦑": "calamares", "🐙": "calamares",
  "🥟": "tapa", "🫓": "pan", "🥞": "crepe", "🧇": "gofre", "🥨": "snack", "🥐": "cruasan", "🍞": "pan", "🌽": "vegano", "🥔": "patatas", "🫒": "aceitunas",
  "🥜": "snack", "🍿": "palomitas", "🧂": "snack", "🥫": "lata", "🍢": "brocheta", "🍡": "brocheta", "🫕": "sopa", "🥣": "bol", "🌶": "picante", "🥬": "vegano",
  "🍩": "donut", "🍪": "galleta", "🎂": "tarta", "🍰": "tarta", "🧁": "magdalena", "🥧": "tarta", "🍫": "chocolate", "🍬": "caramelo", "🍭": "piruleta", "🍮": "flan",
  "🍦": "helado", "🍨": "helado", "🍧": "polo", "🍯": "caramelo", "🍓": "fruta", "🍉": "sandia", "🍌": "platano", "🍎": "fruta", "🍊": "fruta", "🍋": "limon",
  "🍍": "fruta", "🥥": "fruta", "🍇": "fruta", "🍒": "fruta",
  "🥤": "refresco", "💧": "agua", "🧃": "zumo", "🧋": "batido", "🥛": "batido", "☕": "cafe", "🍵": "te", "🧉": "cubata", "🧊": "hielo", "🫗": "chupito", "🍶": "botella", "⚡": "energetica",
  "🍺": "cerveza", "🍻": "cerveza", "🍷": "vino", "🥂": "cava", "🍾": "botella", "🍸": "coctel", "🍹": "cubata", "🥃": "whisky", "♻": "retornable",
  "🎟": "entrada", "🎫": "entrada", "⭐": "estrella", "🌟": "premium", "👑": "vip", "💎": "premium", "🎉": "fiesta", "🎊": "fiesta", "🎶": "musica", "🎵": "musica",
  "🎤": "micro", "🎧": "dj", "🪩": "fiesta", "🔥": "fuego", "💃": "musica", "🕺": "musica", "🎭": "entrada", "🎪": "atraccion", "🎡": "atraccion", "🎠": "atraccion",
  "🎢": "atraccion", "🎯": "diana", "🎳": "diana", "🎱": "diana", "🏆": "trofeo", "🥇": "trofeo", "🍀": "regalo", "🎰": "regalo", "🅿": "parking", "🚌": "bus",
  "🔞": "persona", "🧒": "persona", "👶": "persona", "🎃": "fiesta", "🎄": "fiesta", "❤": "corazon", "☀": "sol", "🌙": "luna", "🛋": "reservado", "⛺": "camping",
  "👕": "camiseta", "🧥": "sudadera", "🧢": "gorra", "👜": "bolsa", "🎒": "mochila", "👓": "gafas", "🕶": "gafas", "🧣": "sudadera", "🧦": "camiseta", "🪭": "abanico",
  "🌂": "paraguas", "🔑": "taquilla", "🔦": "linterna", "🔋": "bateria", "📱": "movil", "💡": "pulsera", "🏷": "pulsera", "🎁": "regalo", "🧸": "regalo", "🎈": "globo",
  "🪪": "credencial", "🧴": "botellaAgua", "🚬": "producto", "🧻": "producto", "🚻": "aseos",
  "🪙": "ficha", "💶": "dinero", "💳": "tarjeta", "🧾": "recibo", "✅": "producto", "➕": "extra", "🆓": "etiqueta", "🆕": "etiqueta",
};

// Valor guardado → clave del icono
export function claveIcono(v) {
  const s = String(v || "").trim();
  if (s.startsWith("i:")) return ICONOS_PRODUCTO[s.slice(2)] ? s.slice(2) : "producto";
  for (const ch of Array.from(s.replace(/️/g, ""))) if (EMOJI_A_ICONO[ch]) return EMOJI_A_ICONO[ch];
  return "producto";
}
export const valorIcono = (clave) => "i:" + clave;

export function IconoProducto({ v, s = 24, w = 1.6, style }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, display: "block", ...style }}>
      <path d={ICONOS_PRODUCTO[claveIcono(v)]} />
    </svg>
  );
}

const normTxt = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const RECIENTES = "tixfast_iconos_recientes";
const leerRecientes = () => { try { const r = JSON.parse(localStorage.getItem(RECIENTES) || "[]"); return Array.isArray(r) ? r.filter(k => ICONOS_PRODUCTO[k]) : []; } catch { return []; } };
const guardarReciente = (k) => { try { localStorage.setItem(RECIENTES, JSON.stringify([k, ...leerRecientes().filter(x => x !== k)].slice(0, 12))); } catch {} };

// Selector de icono: botón con el icono actual; al pulsar, hoja con buscador y categorías
export function SelectorIcono({ value, onChange, size = 52, color }) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState(null);
  const [q, setQ] = useState("");
  const actual = claveIcono(value);
  const recientes = leerRecientes();
  const elegir = (k) => { guardarReciente(k); onChange(valorIcono(k)); setOpen(false); setQ(""); };
  const nq = normTxt(q.trim());
  const nombre = (k) => (ICONOS_TODOS.find(x => x[0] === k) || [k, k])[1];
  const lista = nq ? ICONOS_TODOS.filter(([k, l, kw]) => normTxt(`${k} ${l} ${kw}`).includes(nq))
    : cat ? (CATEGORIAS_ICONOS.find(x => x.k === cat)?.items || [])
    : (recientes.length ? recientes.map(k => [k, nombre(k), ""]) : CATEGORIAS_ICONOS[0].items);
  const chip = (on) => ({ flexShrink: 0, minHeight: 40, padding: "0 14px", borderRadius: 999, border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`, background: on ? "var(--accent)" : "var(--surface2)", color: on ? "#fff" : "var(--text)", fontWeight: 600, fontSize: 14, cursor: "pointer", font: "inherit" });
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Icono: ${nombre(actual)}. Cambiar`}
        style={{ width: size, height: size, flexShrink: 0, borderRadius: 12, border: "1px solid var(--line)", background: color || "var(--surface2)", color: color ? "#fff" : "var(--text)", cursor: "pointer", display: "grid", placeItems: "center", padding: 0 }}>
        <IconoProducto v={value} s={Math.round(size * 0.52)} />
      </button>
      {open && (
        <Capa>
          <div className="tx-icosel-fondo" onClick={() => setOpen(false)}>
            <div className="tx-icosel" role="dialog" aria-label="Elige un icono" onClick={e => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 17 }}>Elige un icono</div>
                <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar" style={{ width: 44, height: 44, borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", display: "grid", placeItems: "center", cursor: "pointer" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
              </div>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar: cerveza, perrito, VIP, parking…" enterKeyHint="search"
                style={{ width: "100%", boxSizing: "border-box", minHeight: 44, padding: "0 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontSize: 16, font: "inherit", marginBottom: 12 }} />
              {!nq && (
                <div className="scroll-x" style={{ display: "flex", gap: 8, marginBottom: 12, overflowX: "auto", paddingBottom: 2 }}>
                  <button type="button" onClick={() => setCat(null)} style={chip(cat === null)}>{recientes.length ? "Recientes" : "Comida"}</button>
                  {CATEGORIAS_ICONOS.filter((x, i) => recientes.length || i > 0).map(x => <button type="button" key={x.k} onClick={() => setCat(x.k)} style={chip(cat === x.k)}>{x.l}</button>)}
                </div>
              )}
              <div className="tx-icosel-lista">
                {lista.length ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(76px, 1fr))", gap: 8 }}>
                    {lista.map(([k, l]) => (
                      <button type="button" key={k} onClick={() => elegir(k)} aria-pressed={k === actual}
                        style={{ minHeight: 76, borderRadius: 12, border: `1px solid ${k === actual ? "var(--accent)" : "var(--line)"}`, background: k === actual ? "color-mix(in srgb, var(--accent) 14%, var(--surface2))" : "var(--surface2)", color: "var(--text)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 4px", font: "inherit" }}>
                        <IconoProducto v={valorIcono(k)} s={26} />
                        <span style={{ fontSize: 12, lineHeight: 1.2, color: "var(--muted)", textAlign: "center" }}>{l}</span>
                      </button>
                    ))}
                  </div>
                ) : <div style={{ color: "var(--muted)", fontSize: 14, padding: "8px 0" }}>Sin resultados. Prueba con otra palabra o usa «Producto».</div>}
              </div>
            </div>
          </div>
          <style>{`
.tx-icosel-fondo{position:fixed;inset:0;z-index:95;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center}
.tx-icosel{width:100%;max-height:86dvh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--line);border-radius:16px 16px 0 0;padding:16px 16px calc(16px + env(safe-area-inset-bottom));box-sizing:border-box}
.tx-icosel-lista{overflow-y:auto;overscroll-behavior:contain;min-height:0;flex:1}
@media (min-width:640px){.tx-icosel-fondo{align-items:center;padding:24px}.tx-icosel{max-width:600px;border-radius:16px;padding:24px}}
`}</style>
        </Capa>
      )}
    </>
  );
}

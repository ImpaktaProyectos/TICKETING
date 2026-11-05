import React, { useMemo } from "react";
import qrcode from "qrcode-generator";

// QR en SVG, nítido en la impresora térmica (sin suavizado: cada módulo cae en puntos exactos).
// Modo alfanumérico + corrección de errores M: el código de TIXFAST cabe en un QR de 29×29.
export function matrizQR(texto, nivel = "M") {
  const q = qrcode(0, nivel);
  q.addData(texto, /^[0-9A-Z $%*+\-./:]+$/.test(texto) ? "Alphanumeric" : "Byte");
  q.make();
  const n = q.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!q.isDark(r, c)) continue;
      let w = 1; while (c + w < n && q.isDark(r, c + w)) w++;   // une módulos seguidos: menos trazos
      d += `M${c} ${r}h${w}v1h-${w}z`;
      c += w - 1;
    }
  }
  return { n, d };
}

// modulo: mm por cuadradito. 0,625 mm = 5 puntos exactos de una impresora de 203 ppp (nítido).
// mm: si se da, tamaño total fijo (margen blanco incluido) en lugar de calcularlo por módulo.
export default function QrCodigo({ texto, modulo = 0.625, mm, margen = 2, color = "#000", fondo = "#fff", style }) {
  const m = useMemo(() => (texto ? matrizQR(texto) : null), [texto]);
  if (!m) return null;
  const t = m.n + margen * 2;
  if (!mm) mm = Math.round(t * modulo * 1000) / 1000;
  return (
    <svg width={mm + "mm"} height={mm + "mm"} viewBox={`${-margen} ${-margen} ${t} ${t}`} shapeRendering="crispEdges" role="img" aria-label="Código QR del ticket" style={{ display: "block", flexShrink: 0, background: fondo, ...style }}>
      <rect x={-margen} y={-margen} width={t} height={t} fill={fondo} />
      <path d={m.d} fill={color} />
    </svg>
  );
}

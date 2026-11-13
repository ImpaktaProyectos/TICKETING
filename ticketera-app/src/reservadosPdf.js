// ===================== RESERVADOS · hoja para imprimir (equipo de reservados) =====================
// Una ficha por reservado con todo lo que necesita quien atiende: dónde está, quién viene, cuántos son,
// qué botellas y refrescos, qué ha pagado ya y qué queda por cobrar, promotor y notas.
// Con casillas para marcar a mano la llegada y cada botella servida. A4 vertical.
import { jsPDF } from "jspdf";
import { fechaLarga } from "./mensajesReservados.js";

const limpia = (s) => String(s ?? "").replace(/−/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x00-\xff€–—…]/gu, "").trim();
const eur = (v) => (Number(v) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR", useGrouping: "always" });
const ESTADO = { reservado: "Reservado", llegado: "Ha llegado", novino: "No vino", libre: "Libre" };
const TAM = { pequeno: "Pequeño", grande: "Grande" };
const METODO = { efectivo: "efectivo", bizum: "Bizum", transferencia: "transferencia", tarjeta: "tarjeta" };

// filas: [{ r, C (calcPedido), s (stats de la noche), promotor }] · ev: { name, date }
export function pdfReservados(filas, ev) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, H = 297, M = 12, AN = W - M * 2;
  const negro = [21, 23, 28], gris = [100, 106, 118], linea = [210, 214, 220], fondo = [244, 245, 247], acento = [255, 90, 60];
  let y = M;
  const txt = (s, x, yy, o = {}) => { doc.setFont("helvetica", o.b ? "bold" : "normal"); doc.setFontSize(o.s || 9.5); doc.setTextColor(...(o.c || negro)); doc.text(limpia(s), x, yy, { align: o.a || "left", maxWidth: o.w }); };
  const lineas = (s, w, size) => { doc.setFontSize(size); return doc.splitTextToSize(limpia(s), w); };
  const caja = (x, yy, lado = 4) => { doc.setDrawColor(...negro); doc.setLineWidth(.35); doc.rect(x, yy - lado + .8, lado, lado); };

  const ocupados = filas.filter(f => f.r.estado !== "libre");
  const libres = filas.filter(f => f.r.estado === "libre");
  const personas = ocupados.reduce((t, f) => t + (Number(f.C.personas) || Number(f.r.personas) || 0), 0);
  const botellas = ocupados.reduce((t, f) => t + (f.C.n || 0), 0);

  // ---------- Cabecera ----------
  doc.setFillColor(...negro); doc.rect(0, 0, W, 24, "F");
  txt("RESERVADOS", M, 10.5, { b: true, s: 16, c: [255, 255, 255] });
  txt(`${ev?.name || ""}${ev?.date ? " · " + fechaLarga(ev.date) : ""}`, M, 17.5, { s: 10.5, c: [255, 255, 255] });
  txt(`${ocupados.length} reservas · ${personas || "-"} personas · ${botellas} botellas`, W - M, 17.5, { s: 9.5, c: [255, 255, 255], a: "right" });
  y = 31;

  // ---------- Una ficha por reservado ----------
  ocupados.forEach(({ r, C, s, promotor }) => {
    const bots = C.botellas || [];
    const notas = r.nota ? lineas(r.nota, AN - 8, 9) : [];
    const alto = 30 + Math.max(1, bots.length) * 5.6 + (notas.length ? notas.length * 4.2 + 3 : 0);
    if (y + alto > H - 12) { doc.addPage(); y = M + 4; }
    const top = y - 5;
    doc.setDrawColor(...linea); doc.setLineWidth(.4); doc.roundedRect(M, top, AN, alto, 2.5, 2.5, "S");
    doc.setFillColor(...fondo); doc.roundedRect(M, top, AN, 11, 2.5, 2.5, "F"); doc.rect(M, top + 6, AN, 5, "F");
    doc.setFillColor(...acento); doc.rect(M, top, 1.6, 11, "F");

    // Fila 1: nombre del reservado (dónde está), tamaño y capacidad · estado · llegada
    txt(r.nombre, M + 5, y + 1.6, { b: true, s: 14 });
    doc.setFont("helvetica", "bold"); doc.setFontSize(14); const wN = doc.getTextWidth(limpia(r.nombre));
    txt(`${TAM[r.tamano] || ""}${r.personas ? ` · caben ${r.personas}` : ""} · ${ESTADO[r.estado] || r.estado}`, M + 7 + wN, y + 1.4, { s: 9, c: gris });
    caja(W - M - 44, y + 1.6); txt("Llegada  ____:____", W - M - 38, y + 1.4, { s: 9, b: true });
    y += 11;

    // Fila 2: cliente, teléfono, personas
    txt("Cliente", M + 5, y, { s: 7.5, c: gris }); txt("Teléfono", M + 92, y, { s: 7.5, c: gris }); txt("Personas", M + 140, y, { s: 7.5, c: gris });
    y += 4.4;
    txt(r.cliente || "-", M + 5, y, { b: true, s: 11, w: 84 }); txt(r.telefono || "-", M + 92, y, { s: 10.5, w: 46 });
    txt(String(C.personas ?? "-"), M + 140, y, { b: true, s: 11 });
    y += 6.5;

    // Fila 3: tarifa y botellas (con casilla para marcar cada una servida)
    txt(C.tarifa ? `Botellas · ${C.tarifa.nombre}` : "Botellas", M + 5, y, { s: 7.5, c: gris }); y += 4.6;
    if (!bots.length) { txt(C.tarifa?.botellas ? `${C.incl} incluida(s) en la tarifa · por elegir` : "Sin botellas apuntadas", M + 5, y, { s: 9.5, c: gris }); y += 5.6; }
    bots.forEach((b, i) => { caja(M + 5, y + .4, 3.6); txt(`${i + 1}. ${b.bebida || "Botella"}${b.mezcla ? `  +  ${b.mezcla}` : ""}`, M + 11, y, { s: 10, b: true, w: AN - 18 }); y += 5.6; });

    // Dinero (columna derecha, a la altura del cliente)
    const xD = W - M - 4, yD = top + 16;
    const pagaTaq = C.total != null ? Math.max(0, Math.round((C.total - Math.min(Number(r.senal) || 0, C.total)) * 100) / 100) : null;
    txt(`Total ${C.total != null ? eur(C.total) : "-"}`, xD, yD, { a: "right", s: 9.5, b: true });
    txt(Number(r.senal) > 0 ? `Señal ${eur(r.senal)}${r.senalMetodo ? ` (${METODO[r.senalMetodo] || r.senalMetodo})` : ""}` : "Sin señal", xD, yD + 4.6, { a: "right", s: 8.5, c: gris });
    txt(s?.tarifaCobrada ? "YA COBRADO" : pagaTaq != null ? `A cobrar: ${eur(pagaTaq)}` : "", xD, yD + 9.6, { a: "right", s: 10.5, b: true, c: s?.tarifaCobrada ? [14, 159, 117] : acento });

    // Promotor y notas
    if (promotor?.nombre) { txt(`Promotor: ${promotor.nombre}${promotor.telefono ? ` · ${promotor.telefono}` : ""}`, M + 5, y, { s: 8.5, c: gris }); y += 4.4; }
    if (notas.length) { doc.setFont("helvetica", "italic"); doc.setFontSize(9); doc.setTextColor(...negro); doc.text(notas, M + 5, y); y += notas.length * 4.2; }
    y = top + alto + 8;
  });
  if (!ocupados.length) { txt("Aún no hay ninguna reserva.", M, y, { c: gris }); y += 8; }

  // ---------- Reservados libres ----------
  if (libres.length) {
    if (y + 14 > H - 12) { doc.addPage(); y = M + 4; }
    txt("Libres", M, y, { b: true, s: 11 }); y += 5;
    txt(libres.map(f => `${f.r.nombre}${f.r.personas ? ` (${f.r.personas})` : ""}`).join("   ·   "), M, y, { s: 9.5, c: gris, w: AN }); y += 6;
  }

  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); txt(`${ev?.name || ""} · Reservados · impreso el ${new Date().toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`, M, H - 6, { s: 7.5, c: gris }); txt(`Página ${i} de ${n}`, W - M, H - 6, { s: 7.5, c: gris, a: "right" }); }
  return doc;
}

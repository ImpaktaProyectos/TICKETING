// Cálculo de importes de una factura: MISMA regla que fac_emitir en la base de datos
// (base de línea = cantidad × precio − descuento, redondeada a céntimos; IVA por tipo sobre la suma de bases).
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
export const num = (v) => { const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
export const baseLinea = (l) => r2(num(l.cantidad) * num(l.precio) * (1 - Math.min(Math.max(num(l.descuento), 0), 100) / 100));
export function calcular(lineas = [], irpfPct = 0) {
  const g = new Map();
  lineas.forEach(l => { const t = num(l.iva); g.set(t, r2((g.get(t) || 0) + baseLinea(l))); });
  const desglose = [...g.entries()].sort((a, b) => b[0] - a[0]).map(([tipo, base]) => ({ tipo, base, cuota: r2(base * tipo / 100) }));
  const base = r2(desglose.reduce((s, d) => s + d.base, 0));
  const cuota_iva = r2(desglose.reduce((s, d) => s + d.cuota, 0));
  const cuota_irpf = r2(base * num(irpfPct) / 100);
  return { base, cuota_iva, cuota_irpf, total: r2(base + cuota_iva - cuota_irpf), desglose };
}
export const eur = (v) => (Number(v) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR", useGrouping: "always" });
export const fechaES = (d) => { if (!d) return ""; const x = new Date(String(d).length <= 10 ? d + "T12:00" : d); return isNaN(x) ? "" : x.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }); };
export const IVAS = [21, 10, 4, 0];
export const IRPFS = [0, 1, 2, 7, 15, 19];
export const trimestre = (d) => Math.floor((new Date(d + "T12:00").getMonth()) / 3) + 1;
export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
// URL de cotejo de la AEAT para el QR tributario (RD 1007/2023, Orden HAC/1177/2024)
export const urlQR = (f) => `https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?nif=${encodeURIComponent(f.emisor?.nif || "")}&numserie=${encodeURIComponent(f.codigo || "")}&fecha=${(f.fecha || "").split("-").reverse().join("-")}&importe=${Number(f.total || 0).toFixed(2)}`;
export const CATEGORIAS_GASTO = ["Proveedores y compras", "Alquiler", "Sonido e iluminación", "Artistas y DJ", "Personal", "Publicidad y marketing", "Transporte", "Suministros", "Software y suscripciones", "Gestoría y asesoría", "Seguros", "Bancos y comisiones", "Otros"];

// Días que lleva vencida una factura (0 si no ha vencido o no tiene vencimiento)
export const diasVencida = (f, hoy) => { if (!f.vencimiento || !hoy || f.vencimiento >= hoy) return 0; return Math.round((new Date(hoy + "T12:00") - new Date(f.vencimiento + "T12:00")) / 864e5); };
// Texto del recordatorio de cobro (correo o WhatsApp)
export function textoRecordatorio(f, E = {}, hoy) {
  const dias = diasVencida(f, hoy), quien = E.nombre_comercial || E.razon_social || "";
  const asunto = `Recordatorio: factura ${f.codigo} pendiente de pago`;
  const cuerpo = [`Hola${f.contacto?.nombre ? `, ${f.contacto.nombre}` : ""}:`, "",
    `Te recordamos que la factura ${f.codigo} del ${fechaES(f.fecha)}, por ${eur(f.total)}, ${dias ? `venció el ${fechaES(f.vencimiento)} (hace ${dias} ${dias === 1 ? "día" : "días"})` : f.vencimiento ? `vence el ${fechaES(f.vencimiento)}` : "está pendiente de pago"}.`,
    E.iban ? `Puedes hacer la transferencia a ${E.iban} indicando «${f.codigo}».` : "",
    "Si ya la has pagado, no hagas caso de este mensaje.", "", "Un saludo,", quien].filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n");
  return { asunto, cuerpo };
}

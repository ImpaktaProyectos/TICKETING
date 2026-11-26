// ===================== CRM · AUTORIZACIÓN DE MENORES (plantilla genérica) =====================
// Los datos del organizador (datos fiscales) y del evento se ponen solos; el padre, madre o tutor
// rellena a mano (o en pantalla) sus datos, los del menor y la firma.
// Plantilla genérica: conviene que un asesor la revise (la normativa de espectáculos cambia según la comunidad).
const fechaLarga = (v) => { if (!v) return ""; const d = new Date(String(v).length <= 10 ? v + "T12:00" : v); return isNaN(d) ? "" : d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); };
const horaTxt = (v) => { const d = new Date(v); return isNaN(d) || String(v).length <= 10 ? "" : d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }); };

export const DIAS_CONSERVACION = 30;

// Datos del organizador a partir de los datos fiscales de Facturación
export const organizadorDe = (e = {}) => ({
  nombre: e.razon_social || e.nombre_comercial || "",
  nif: e.nif || "",
  direccion: [e.direccion, [e.cp, e.ciudad].filter(Boolean).join(" "), e.provincia].filter(Boolean).join(", "),
  email: e.email || "", telefono: e.telefono || "",
});

// Devuelve el contenido ya redactado: { titulo, secciones:[{t, p?:[], campos?:[]}] }
export function textoAutorizacion({ organizador: o, evento: ev, edad = 16 }) {
  const cuando = [fechaLarga(ev.inicio), horaTxt(ev.inicio) && `a las ${horaTxt(ev.inicio)}`].filter(Boolean).join(" ");
  const donde = ev.lugar ? ` en ${ev.lugar}` : "";
  const org = `${o.nombre}${o.nif ? ` (NIF ${o.nif})` : ""}`;
  const reglas = [
    ev.edadMinima ? `La edad mínima de acceso al evento es de ${ev.edadMinima} años; esta autorización solo es válida para los menores de ${edad} años que el organizador admita según la normativa aplicable.` : `Esta autorización se pide a los menores de ${edad} años.`,
    ev.vestimenta ? `Código de vestimenta: ${ev.vestimenta}.` : "",
  ].filter(Boolean);
  return {
    titulo: "AUTORIZACIÓN PARA MENORES DE EDAD",
    subtitulo: `${ev.nombre}${cuando ? ` · ${cuando}` : ""}${donde}`,
    secciones: [
      { t: "Datos del padre, madre o tutor/a legal", campos: ["Nombre y apellidos", "DNI / NIE", "Teléfono de contacto", "Correo electrónico"] },
      { t: "Datos del menor", campos: ["Nombre y apellidos", "Fecha de nacimiento", "DNI / NIE o pasaporte"] },
      { t: "Autorización", p: [
        `Como padre, madre o tutor/a legal del menor indicado, AUTORIZO su asistencia al evento «${ev.nombre}»${cuando ? `, que se celebrará el ${cuando}` : ""}${donde}, organizado por ${org}${o.direccion ? `, con domicilio en ${o.direccion}` : ""}.`,
        "Declaro que conozco las características del evento, que asumo la responsabilidad sobre el menor durante el mismo y que he leído y acepto las normas de acceso del organizador.",
        ...reglas,
        "El menor deberá presentar esta autorización firmada, una copia del DNI/NIE de quien firma y su propio documento de identidad. Si falta algo, el organizador puede denegar el acceso.",
      ] },
      { t: "Protección de datos", p: [
        `Responsable del tratamiento: ${org}${o.direccion ? `, ${o.direccion}` : ""}${o.email ? `. Contacto: ${o.email}` : ""}.`,
        `Finalidad: comprobar esta autorización en el acceso al evento. Legitimación: tu consentimiento. Conservación: solo el tiempo necesario y, como máximo, ${DIAS_CONSERVACION} días después del evento. No se ceden datos a terceros salvo obligación legal.`,
        `Puedes ejercer tus derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a ${o.email || "la dirección del responsable"}. También puedes reclamar ante la Agencia Española de Protección de Datos (www.aepd.es).`,
      ] },
    ],
    firma: ["Lugar y fecha", "Firma del padre, madre o tutor/a legal"],
    nota: "Adjuntar copia del DNI/NIE de quien firma.",
  };
}

// PDF A4 (Helvetica incluida en el PDF: no usa tipografías de la app). Se crea en el navegador.
export async function pdfAutorizacion(datos) {
  const { jsPDF } = await import("jspdf");
  const T = textoAutorizacion(datos);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, M = 18, ancho = W - 2 * M;
  let y = 20;
  const salto = (h) => { if (y + h > 285) { doc.addPage(); y = 20; } };
  doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.setTextColor(20);
  doc.text(T.titulo, W / 2, y, { align: "center" }); y += 7;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(80);
  const sub = doc.splitTextToSize(T.subtitulo, ancho); doc.text(sub, W / 2, y, { align: "center" }); y += sub.length * 5 + 5;
  T.secciones.forEach(s => {
    salto(14);
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(20); doc.text(s.t, M, y); y += 2;
    doc.setDrawColor(200); doc.line(M, y, W - M, y); y += 5;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(40);
    (s.campos || []).forEach(c => { salto(9); doc.text(c + ":", M, y); doc.setDrawColor(120); doc.line(M + 52, y + 0.5, W - M, y + 0.5); y += 8; });
    (s.p || []).forEach(p => { const l = doc.splitTextToSize(p, ancho); salto(l.length * 4.6 + 2); doc.text(l, M, y); y += l.length * 4.6 + 2.5; });
    y += 3;
  });
  salto(40); y += 8;
  doc.setFontSize(10); doc.setDrawColor(120); doc.setTextColor(40);
  doc.text(T.firma[0] + ":", M, y); doc.line(M + 36, y + 0.5, M + 80, y + 0.5);
  doc.text(T.firma[1] + ":", M + 92, y); doc.line(M + 92, y + 22, W - M, y + 22);
  y += 30; doc.setFontSize(9); doc.setTextColor(110); doc.text(T.nota, M, y);
  return doc;
}

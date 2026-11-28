// COPIA de ticketera-app/src/web/calendario.js (la función del servidor no puede importar la app). Si cambias uno, cambia el otro.
// ===================== AÑADIR AL CALENDARIO (Apple, Google, Outlook) =====================
// Calcula las citas de calendario de un pedido: una por cada día distinto (entradas de día) o una para todo el evento
// (abonos y entradas normales). Las horas del evento se guardan en hora de España sin zona («2026-12-12T23:30»):
// aquí se pasan a hora universal para que cada móvil las muestre bien, esté donde esté.
// Lo usa la página «Mis entradas» (enlace de Google Calendar) y, con la misma lógica, la función «calendario»
// del servidor (archivo .ics para el calendario del móvil).

// Hora de España («AAAA-MM-DDTHH:MM») → instante real
export function madridAUtc(local) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(local || ""));
  if (!m) return null;
  const supuesto = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 12), +(m[5] || 0));
  const desfase = (t) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t;
  };
  let t = supuesto - desfase(supuesto);
  t = supuesto - desfase(t);   // segunda vuelta: acierta también los días de cambio de hora
  return new Date(t);
}

const HORA = 3600000;
// Citas del pedido: [{ titulo, inicio: Date, fin: Date, lugar, detalles }]
export function citasPedido(ev, entradas = [], enlace = "") {
  const ini = madridAUtc(ev?.inicio || ev?.fecha);
  if (!ini) return [];
  let fin = ev?.fin ? new Date(ev.fin) : null;
  if (!fin || isNaN(fin) || fin <= ini) fin = new Date(ini.getTime() + 6 * HORA);
  const lugar = [ev?.recinto, ev?.direccion].filter(Boolean).join(", ");
  const validas = (entradas || []).filter((x) => !x.estado || x.estado === "valida");
  const dias = [...new Set(validas.filter((x) => x.acceso === "dia" && x.dia).map((x) => x.dia))].sort();
  const hayGenerales = !validas.length || validas.some((x) => !(x.acceso === "dia" && x.dia));
  const texto = (extra) => [extra, "Tus entradas y el QR:", enlace].filter(Boolean).join("\n");
  const citas = [];
  if (hayGenerales) citas.push({ titulo: ev?.nombre || "Evento", inicio: ini, fin, lugar, detalles: texto(null) });
  // Entradas de día: misma hora de inicio que el evento, ese día; dura lo que la primera noche (como mucho 12 h)
  const horaIni = /T(\d{2}:\d{2})/.exec(String(ev?.inicio || ""))?.[1] || "20:00";
  const duracion = Math.min(12 * HORA, Math.max(2 * HORA, (ev?.fin && !dias.length ? fin - ini : 8 * HORA)));
  for (const d of dias) {
    const i = madridAUtc(`${d}T${horaIni}`);
    citas.push({ titulo: `${ev?.nombre || "Evento"} · ${new Date(d + "T12:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}`,
      inicio: i, fin: new Date(i.getTime() + duracion), lugar, detalles: texto("Entrada de día: solo vale esta jornada.") });
  }
  return citas;
}

const utc = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
// Enlace para añadir una cita a Google Calendar
export function enlaceGoogle(c) {
  const q = new URLSearchParams({ action: "TEMPLATE", text: c.titulo, dates: `${utc(c.inicio)}/${utc(c.fin)}`, details: c.detalles || "", location: c.lugar || "", ctz: "Europe/Madrid" });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

// Archivo .ics (calendario del iPhone, Mac, Outlook…) con aviso un día antes y tres horas antes
export function archivoIcs(citas, uid = "tixfast") {
  const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/[,;]/g, (x) => "\\" + x).replace(/\r?\n/g, "\\n");
  const plegar = (l) => { const out = []; let s = l; while (s.length > 74) { out.push(s.slice(0, 74)); s = " " + s.slice(74); } out.push(s); return out.join("\r\n"); };
  const lineas = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//TIXFAST//Entradas//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  citas.forEach((c, i) => lineas.push("BEGIN:VEVENT", `UID:${uid}-${i}@tixfast`, `DTSTAMP:${utc(new Date())}`, `DTSTART:${utc(c.inicio)}`, `DTEND:${utc(c.fin)}`,
    `SUMMARY:${esc(c.titulo)}`, ...(c.lugar ? [`LOCATION:${esc(c.lugar)}`] : []), `DESCRIPTION:${esc(c.detalles)}`,
    "BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY", `DESCRIPTION:${esc(`Mañana: ${c.titulo}`)}`, "END:VALARM",
    "BEGIN:VALARM", "TRIGGER:-PT3H", "ACTION:DISPLAY", `DESCRIPTION:${esc(`En 3 horas: ${c.titulo}. Lleva tu entrada.`)}`, "END:VALARM",
    "END:VEVENT"));
  lineas.push("END:VCALENDAR");
  return lineas.map(plegar).join("\r\n") + "\r\n";
}

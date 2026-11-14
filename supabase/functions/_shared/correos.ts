// TIXFAST · correos de la plataforma (Brevo) y sus plantillas
// Secretos de la función: BREVO_API_KEY, CORREO_REMITENTE y SITE_URL. Nada de eso va en el código.
// Los correos comerciales llevan siempre el enlace para dejar de recibirlos.

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const eur = (v: number) => `${Number(v).toFixed(2).replace(".", ",").replace(",00", "")} €`;
const dia = (iso: string) => new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "long", timeZone: "Europe/Madrid" });

export type Plantilla = { asunto: string; titulo: string; texto: string[]; boton?: { texto: string; url: string }; nota?: string; comercial: boolean };
export type Contexto = { precio: number | null; datos: Record<string, any>; config: Record<string, any>; sitio: string };

// Textos de cada momento. {sitio}/?accion=… abre la app en el paso correcto.
export function plantilla(tipo: string, c: Contexto): Plantilla | null {
  const p = c.precio != null ? eur(c.precio) : "la cuota mensual";
  const ret = c.config?.oferta_retencion || { descuento: 50, meses: 3 };
  const rec = c.config?.oferta_recuperar || { descuento: 30, meses: 2 };
  const ir = (a = "") => `${c.sitio}/${a ? `?accion=${a}` : ""}`;
  switch (tipo) {
    case "bienvenida": return { comercial: true, asunto: "Bienvenido a TIXFAST 🎉", titulo: "Tu cuenta ya está lista",
      texto: ["Con TIXFAST vendes en barra en un toque, imprimes tickets y controlas cada euro de la noche: cajas, gastos, socios y liquidaciones.",
        "La venta de entradas online es gratis siempre. Para el TPV y el CRM tienes 7 días de prueba sin coste."],
      boton: { texto: "Empezar mi prueba de 7 días", url: ir("prueba") } };
    case "sin_prueba": return c.datos?.dia >= 5
      ? { comercial: true, asunto: "¿Te ayudamos a montar tu primer evento?", titulo: "Tu primer evento, en 10 minutos",
        texto: ["Crea el evento, añade tus barras y productos con su precio y ya puedes vender e imprimir tickets.", "Empieza la prueba de 7 días y, si tienes dudas, responde a este correo: te ayudamos."],
        boton: { texto: "Empezar la prueba gratis", url: ir("prueba") } }
      : { comercial: true, asunto: "Tu próxima noche, sin colas ni descuadres", titulo: "Pruébalo una noche, sin riesgo",
        texto: ["Las barras venden más rápido, cada ticket queda registrado y al cerrar tienes el cierre de caja hecho.", `7 días gratis. Después, ${p} al mes y cancelas cuando quieras.`],
        boton: { texto: "Empezar la prueba gratis", url: ir("prueba") } };
    case "prueba_consejos": return { comercial: false, asunto: "3 claves para tu primer evento con TIXFAST", titulo: "Saca el máximo a tu prueba",
      texto: ["1. Crea tus barras y productos (con colores y emojis para encontrarlos rápido).", "2. Conecta la impresora de 80 mm y haz un ticket de prueba desde el menú.", "3. Al acabar la noche, haz el cierre de cada barra: verás lo vendido, el efectivo y la tarjeta."],
      boton: { texto: "Abrir TIXFAST", url: ir() } };
    case "prueba_acaba": return { comercial: false, asunto: `Tu prueba acaba el ${dia(c.datos.prueba_hasta)}`, titulo: "Tu prueba gratuita está a punto de acabar",
      texto: [`El ${dia(c.datos.prueba_hasta)} empezará tu suscripción y se cobrarán ${p}. Después se renueva automáticamente cada mes.`, "Si no quieres continuar, cancela antes de esa fecha desde Ajustes › Tu cuenta y no se te cobrará nada."],
      boton: { texto: "Ver mi suscripción", url: ir("cuenta") } };
    case "impago": return c.datos?.ultimo
      ? { comercial: false, asunto: "Último aviso: actualiza tu tarjeta para no perder el acceso", titulo: "Tu acceso se pausará mañana",
        texto: ["No hemos podido cobrar tu suscripción. Si no actualizas la tarjeta, mañana se pausarán el TPV y el CRM.", "Tus datos no se pierden: en cuanto se cobre, todo vuelve a funcionar."],
        boton: { texto: "Actualizar mi tarjeta", url: ir("tarjeta") } }
      : { comercial: false, asunto: "No hemos podido cobrar tu suscripción", titulo: "Revisa tu forma de pago",
        texto: ["El último cobro de TIXFAST no se ha podido hacer (tarjeta caducada, sin saldo o bloqueada por el banco).", "Actualízala en un minuto y sigue trabajando sin cortes."],
        boton: { texto: "Actualizar mi tarjeta", url: ir("tarjeta") } };
    case "cancela": return { comercial: true, asunto: `Antes de que te vayas: ${ret.descuento} % durante ${ret.meses} meses`, titulo: "Nos encantaría que te quedaras",
      texto: [`Hemos visto que has cancelado tu suscripción. Si es por el precio, te dejamos ${ret.descuento} % de descuento durante ${ret.meses} meses.`, "¿Temporada baja? También puedes pausarla unos meses sin pagar y volver cuando tengas eventos."],
      boton: { texto: "Quedarme con el descuento", url: ir("quedarme") } };
    case "recuperar": return { comercial: true, asunto: `Vuelve a TIXFAST con un ${rec.descuento} % de descuento`, titulo: "Te echamos de menos",
      texto: [`Si vuelves ahora, tienes ${rec.descuento} % de descuento durante ${rec.meses} meses.`, "Tus eventos, productos y cuentas siguen guardados, tal y como los dejaste."],
      boton: { texto: "Volver con el descuento", url: ir("volver") } };
    case "inactivo": return { comercial: true, asunto: "¿Todo bien con TIXFAST?", titulo: "Hace días que no entras",
      texto: ["Si tienes algún problema o no sabes cómo hacer algo, responde a este correo y te ayudamos.", "¿No tienes eventos hasta dentro de un tiempo? Puedes pausar la suscripción desde Ajustes › Tu cuenta y no pagar mientras tanto."],
      boton: { texto: "Abrir TIXFAST", url: ir() } };
  }
  return null;
}

export function html(t: Plantilla, bajaUrl?: string) {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f4f5f7;font-family:Inter,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#15171a">
<div style="max-width:560px;margin:0 auto;padding:24px 14px"><div style="background:#fff;border-radius:18px;border:1px solid #e6e8eb;padding:24px">
<div style="font-weight:900;font-size:15px;color:#ff5a3c;letter-spacing:1px">TIXFAST</div>
<div style="font-size:24px;font-weight:900;line-height:1.2;margin:10px 0 12px">${esc(t.titulo)}</div>
${t.texto.map((x) => `<p style="font-size:15.5px;line-height:1.55;color:#3b4048;margin:0 0 12px">${esc(x)}</p>`).join("")}
${t.boton ? `<a href="${esc(t.boton.url)}" style="display:block;text-align:center;background:#ff5a3c;color:#fff;text-decoration:none;font-weight:900;font-size:16.5px;padding:15px;border-radius:14px;margin-top:16px">${esc(t.boton.texto)}</a>` : ""}
${t.nota ? `<p style="font-size:13px;color:#6f747d;margin:14px 0 0">${esc(t.nota)}</p>` : ""}
</div><div style="text-align:center;font-size:12px;color:#8c929b;margin-top:14px;line-height:1.6">TIXFAST · TPV y ticketera para eventos${bajaUrl ? `<br><a href="${esc(bajaUrl)}" style="color:#8c929b">No quiero recibir más correos como este</a>` : ""}</div></div></body></html>`;
}

export async function enviar(email: string, t: Plantilla, bajaUrl?: string) {
  const clave = Deno.env.get("BREVO_API_KEY"), remitente = Deno.env.get("CORREO_REMITENTE");
  if (!clave || !remitente) throw new Error("Correo sin configurar (BREVO_API_KEY / CORREO_REMITENTE)");
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST", headers: { "api-key": clave, "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ sender: { email: remitente, name: "TIXFAST" }, replyTo: { email: remitente, name: "TIXFAST" }, to: [{ email }], subject: t.asunto,
      htmlContent: html(t, bajaUrl), textContent: [t.titulo, ...t.texto, t.boton ? `${t.boton.texto}: ${t.boton.url}` : "", bajaUrl ? `Darte de baja: ${bajaUrl}` : ""].filter(Boolean).join("\n\n"),
      ...(bajaUrl ? { headers: { "List-Unsubscribe": `<${bajaUrl}>` } } : {}) }),
  });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
}

export const sitio = () => (Deno.env.get("SITE_URL") || "").replace(/\/$/, "");
export const bajaUrl = (token: string) => `${Deno.env.get("SUPABASE_URL")}/functions/v1/crecimiento?baja=${token}`;

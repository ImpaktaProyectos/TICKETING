// ===================== CAMBIO DE NOMBRE DE UNA ENTRADA (página pública /cambio) =====================
// Las entradas no se devuelven, pero se pueden pasar a otra persona:
//  1) Se sube la entrada (foto o PDF) o se escanea su QR: así se sabe de qué entrada y evento se trata.
//  2) Se ponen los datos de la persona nueva y se paga el cambio (el precio lo pone el organizador; puede ser gratis).
//  3) La persona nueva recibe su entrada con un QR nuevo; el QR anterior deja de valer al momento.
// /cambio/<acceso> es la página de vuelta (tras pagar): confirma el pago y enseña la entrada nueva.
import React, { useEffect, useRef, useState } from "react";
import { supabase } from "../supabase";
import { pagos } from "./pagosApi";
import { leerToken } from "../qr/token";
import { useCamaraQR } from "../qr/lector";
import { tema, card, btn, Mensaje, Campo, Check, CSS_PUB, fecha, eur } from "./comun";

const T = tema();
const MOTIVO = {
  qr: "No encontramos esa entrada. Prueba con otra foto más nítida o con el PDF de la entrada.",
  qr_antiguo: "Este QR ya no vale: la entrada cambió de nombre después. Usa la entrada más reciente.",
  anulada: "Esta entrada está anulada.",
  usada: "Esta entrada ya se ha usado para entrar al evento.",
  no_permitido: "El organizador de este evento no permite cambios de nombre.",
  plazo: "Ya no se puede cambiar el nombre: el plazo para este evento ha terminado.",
  limite: "Esta entrada ya ha cambiado de nombre demasiadas veces. Habla con el organizador.",
  sin_cobro: "El organizador aún no puede cobrar los cambios de nombre online. Habla con él.",
  nombre: "Escribe el nombre y los apellidos de la persona nueva.",
  email: "Revisa el correo electrónico de la persona nueva.",
  dni: "Revisa el DNI.",
  demasiados_intentos: "Demasiados intentos seguidos. Espera unos minutos y vuelve a probar.",
};
const textoMotivo = (m) => MOTIVO[m] || "No se ha podido completar. Vuelve a intentarlo.";

function Marco({ children }) {
  return (
    <div style={{ ...T.vars, minHeight: "100dvh", background: "var(--bg)", color: "var(--text)", fontFamily: T.letra }}>
      <style>{CSS_PUB}</style>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "18px 16px calc(40px + env(safe-area-inset-bottom))" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <img src="/brand/tixfast_isotipo_app.svg" alt="TIXFAST" width="34" height="34" />
          <div style={{ fontWeight: 900, fontSize: 19 }}>Tus entradas</div>
        </div>
        {children}
      </div>
    </div>
  );
}

// Lee el QR de una foto o de un PDF (cada página del PDF, hasta encontrarlo)
async function leerArchivo(file) {
  const QrScanner = (await import("qr-scanner")).default;
  const probar = async (fuente) => { try { const r = await QrScanner.scanImage(fuente, { returnDetailedScanResult: true }); return r?.data || ""; } catch { return ""; } };
  if (/pdf/i.test(file.type) || /\.pdf$/i.test(file.name)) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const w = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = w.default;
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    for (let i = 1; i <= Math.min(doc.numPages, 20); i++) {
      const pag = await doc.getPage(i);
      const vp = pag.getViewport({ scale: 2.5 });
      const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
      await pag.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      const t = await probar(c);
      if (t && leerToken(t)) return t;
    }
    return "";
  }
  return probar(file);
}

export default function PaginaCambio({ acceso, recuperar }) {
  const [pestana, setPestana] = useState(() => { try { return new URL(window.location.href).searchParams.has("recuperar") ? "perdida" : "cambio"; } catch { return "cambio"; } });
  useEffect(() => { document.title = "TIXFAST · Cambio de nombre y entradas perdidas"; }, []);
  if (recuperar) return <ResultadoRecuperar acceso={recuperar} />;
  if (acceso) return <Resultado acceso={acceso} />;
  return (
    <Marco>
      <div role="tablist" aria-label="Qué necesitas" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, background: "var(--card2)", border: "1px solid var(--line)", borderRadius: 14, padding: 4, marginBottom: 14 }}>
        {[["cambio", "Pasar mi entrada"], ["perdida", "He perdido mi entrada"]].map(([k, t]) => (
          <button key={k} role="tab" aria-selected={pestana === k} onClick={() => setPestana(k)} style={{ minHeight: 44, borderRadius: 10, border: "none", cursor: "pointer", fontWeight: 800, fontSize: 14.5, fontFamily: "inherit",
            background: pestana === k ? "var(--c)" : "transparent", color: pestana === k ? T.tinta : "var(--text)" }}>{t}</button>))}
      </div>
      {pestana === "cambio" ? <Solicitud dentro /> : <Recuperar />}
    </Marco>
  );
}

/* ---------- 1) Subir la entrada · 2) Datos de la persona nueva · 3) Pagar ---------- */
function Solicitud({ dentro }) {
  const Caja = dentro ? React.Fragment : Marco;
  const [hex, setHex] = useState("");
  const [info, setInfo] = useState(null);       // respuesta de web_cambio_consultar
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [camara, setCamara] = useState(false);
  const [n, setN] = useState({ nombre: "", dni: "", email: "", email2: "" });
  const [acepto, setAcepto] = useState(false);
  const archivo = useRef(null);
  const cancelado = (() => { try { return new URL(window.location.href).searchParams.get("pago") === "cancelado"; } catch { return false; } })();

  const consultar = async (texto) => {
    setErr("");
    const tk = leerToken(texto);
    if (!tk || !tk.web) { setErr("Ese QR no es de una entrada de TIXFAST. Sube la entrada que te llegó al comprar."); return; }
    setBusy("consultar");
    try {
      const { data, error } = await supabase.rpc("web_cambio_consultar", { p_hex: tk.hex });
      if (error) throw error;
      if (!data?.ok) { setErr(textoMotivo(data?.motivo)); setBusy(""); return; }
      setHex(tk.hex); setInfo(data); setCamara(false);
    } catch { setErr(navigator.onLine ? "No se ha podido comprobar la entrada. Vuelve a intentarlo." : "Sin conexión."); }
    setBusy("");
  };
  // Viene de «Mis entradas» con la entrada ya elegida: no hace falta subirla ni escanearla
  useEffect(() => {
    let t = null; try { t = sessionStorage.getItem("tixfast_cambio_qr"); sessionStorage.removeItem("tixfast_cambio_qr"); } catch { /* nada */ }
    if (t) consultar(t);
  }, []);
  const subir = async (file) => {
    if (!file) return;
    setErr(""); setBusy("leer");
    try {
      const t = await leerArchivo(file);
      if (!t) { setErr("No encontramos el QR en ese archivo. Prueba con el PDF de la entrada o con una captura donde se vea entero."); setBusy(""); return; }
      await consultar(t);
    } catch { setErr("No se ha podido leer el archivo."); setBusy(""); }
  };
  const enviar = async (e) => {
    e.preventDefault(); setErr("");
    const nombre = n.nombre.trim().replace(/\s+/g, " ");
    if (nombre.length < 5 || !nombre.includes(" ")) return setErr(MOTIVO.nombre);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(n.email.trim())) return setErr(MOTIVO.email);
    if (n.email.trim().toLowerCase() !== n.email2.trim().toLowerCase()) return setErr("Los dos correos no coinciden.");
    if (!acepto) return setErr("Marca la casilla para confirmar el cambio.");
    setBusy("enviar");
    try {
      const { data, error } = await supabase.rpc("web_cambio_solicitar", { p_hex: hex, p_nuevo: { nombre, dni: n.dni.trim(), email: n.email.trim() } });
      if (error) throw error;
      if (!data?.ok) { setErr(textoMotivo(data?.motivo)); setBusy(""); return; }
      if (data.pago) {
        const r = await pagos(supabase, "checkout", { acceso: data.acceso });
        if (r?.url) { window.location.assign(r.url); return; }
        setErr(r?.motivo === "sin_pasarela" ? "El pago online aún no está disponible. Habla con el organizador." : "No se ha podido abrir el pago. Vuelve a intentarlo.");
        setBusy(""); return;
      }
      window.location.assign(`/cambio/${data.acceso}?hecho=1`);
    } catch { setErr(navigator.onLine ? "No se ha podido hacer el cambio. Vuelve a intentarlo." : "Sin conexión."); setBusy(""); }
  };

  if (!info) return (
    <Caja>
      {cancelado && <div style={{ ...card, marginBottom: 12, borderColor: "var(--c)", fontWeight: 700 }}>Has cancelado el pago: el nombre no ha cambiado. Puedes volver a intentarlo.</div>}
      <section style={card}>
        <div style={{ fontWeight: 900, fontSize: 18 }}>¿No puedes ir? Pásale tu entrada a otra persona</div>
        <div style={{ color: "var(--muted)", marginTop: 6, lineHeight: 1.5, fontSize: 14.5 }}>Las entradas no se devuelven, pero puedes cambiar el nombre. Sube tu entrada: la persona nueva recibirá la suya con un QR nuevo y la tuya dejará de valer.</div>
        <input ref={archivo} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={e => { subir(e.target.files?.[0]); e.target.value = ""; }} />
        <button onClick={() => archivo.current?.click()} disabled={!!busy} style={{ ...btn("var(--c)", T.tinta), width: "100%", marginTop: 14, minHeight: 52, opacity: busy ? .6 : 1 }}>
          {busy === "leer" ? "Leyendo la entrada…" : busy === "consultar" ? "Comprobando…" : "Subir mi entrada (PDF o foto)"}
        </button>
        <button onClick={() => setCamara(c => !c)} disabled={!!busy} style={{ ...btn("var(--card2)", "var(--text)"), width: "100%", marginTop: 10, minHeight: 48, border: "1px solid var(--line)" }}>
          {camara ? "Cerrar la cámara" : "Escanear el QR con la cámara"}
        </button>
        {camara && <Camara onTexto={(t) => { if (!busy && leerToken(t)) consultar(t); }} />}
        {err && <div role="alert" style={{ color: "#ff6b6b", fontWeight: 700, marginTop: 12, lineHeight: 1.4 }}>{err}</div>}
      </section>
      <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 14, lineHeight: 1.5 }}>Tu entrada está en el correo de la compra o en «Mis entradas». Si la tienes en otro móvil, haz una captura de pantalla del QR y súbela. ¿No la encuentras? Usa «He perdido mi entrada».</div>
    </Caja>
  );

  const ev = info.evento || {}, x = info.entrada || {};
  const precio = Number(info.precio) || 0;
  return (
    <Caja>
      <section style={{ ...card, display: "flex", gap: 14, alignItems: "center" }}>
        {ev.flyer && <img src={ev.flyer} alt="" width="64" height="80" style={{ objectFit: "cover", borderRadius: 10, flexShrink: 0 }} />}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: 17 }}>{ev.nombre}</div>
          <div style={{ color: "var(--muted)", fontSize: 14 }}>{fecha(ev.inicio || ev.fecha)}{ev.recinto ? ` · ${ev.recinto}` : ""}</div>
          <div style={{ fontSize: 14, marginTop: 4 }}>Entrada nº {x.numero}{x.tramo ? ` · ${x.tramo}` : ""} · a nombre de <b>{x.titular}</b></div>
        </div>
      </section>
      {!info.puede ? (
        <section style={{ ...card, marginTop: 12 }}>
          <div style={{ fontWeight: 800 }}>{textoMotivo(info.motivo)}</div>
          <button onClick={() => { setInfo(null); setHex(""); }} style={{ ...btn("var(--card2)", "var(--text)"), width: "100%", marginTop: 12, border: "1px solid var(--line)" }}>Probar con otra entrada</button>
        </section>
      ) : (
        <form onSubmit={enviar} style={{ ...card, marginTop: 12 }}>
          <div style={{ fontWeight: 900, fontSize: 17, marginBottom: 12 }}>Datos de la persona nueva</div>
          <Campo l="Nombre y apellidos" v={n.nombre} on={(v) => setN({ ...n, nombre: v })} ac="off" />
          <Campo l="DNI (opcional)" v={n.dni} on={(v) => setN({ ...n, dni: v })} ac="off" sub="Si el evento pide DNI en la puerta, ponlo: saldrá en la entrada." />
          <Campo l="Correo electrónico" type="email" v={n.email} on={(v) => setN({ ...n, email: v })} ac="off" im="email" sub="Aquí le llegará su entrada." />
          <Campo l="Repite el correo" type="email" v={n.email2} on={(v) => setN({ ...n, email2: v })} ac="off" im="email" />
          <div style={{ background: "var(--card2)", border: "1px solid var(--line)", borderRadius: 12, padding: 12, margin: "4px 0 12px", fontSize: 14.5, display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span>Precio del cambio de nombre</span><b>{precio > 0 ? eur(precio) : "Gratis"}</b>
          </div>
          <Check v={acepto} on={setAcepto}>Entiendo que mi entrada actual dejará de valer y que no hay devolución del dinero de la entrada.</Check>
          {err && <div role="alert" style={{ color: "#ff6b6b", fontWeight: 700, marginTop: 12, lineHeight: 1.4 }}>{err}</div>}
          <button type="submit" disabled={!!busy} style={{ ...btn("var(--c)", T.tinta), width: "100%", marginTop: 14, minHeight: 54, opacity: busy ? .6 : 1 }}>
            {busy ? (precio > 0 ? "Abriendo el pago seguro…" : "Cambiando…") : precio > 0 ? `Pagar ${eur(precio)} y cambiar el nombre` : "Cambiar el nombre"}
          </button>
          {info.prueba && <div style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 8, textAlign: "center" }}>Entrada de PRUEBA: el pago es de prueba (tarjeta 4242 4242 4242 4242).</div>}
          <button type="button" onClick={() => { setInfo(null); setHex(""); setErr(""); }} style={{ ...btn("transparent", "var(--muted)"), width: "100%", marginTop: 6, minHeight: 44, fontWeight: 700, fontSize: 14 }}>Usar otra entrada</button>
        </form>
      )}
    </Caja>
  );
}

function Camara({ onTexto }) {
  const cam = useCamaraQR(onTexto);
  useEffect(() => { if (!cam.empezado) cam.arrancar(); }, []);
  return (
    <div style={{ marginTop: 12 }}>
      <video ref={cam.video} playsInline muted style={{ width: "100%", maxHeight: 320, objectFit: "cover", borderRadius: 14, background: "#000", display: "block" }} />
      {cam.camErr && <div style={{ color: "#ff6b6b", fontWeight: 700, marginTop: 8 }}>{cam.camErr === "permiso" ? "Da permiso a la cámara en tu navegador o sube la entrada como archivo." : "No se ha podido abrir la cámara. Sube la entrada como archivo."}</div>}
    </div>
  );
}

/* ---------- Página de vuelta: confirma el pago y enseña la entrada nueva ---------- */
function Resultado({ acceso }) {
  const [d, setD] = useState(undefined);
  const [envio, setEnvio] = useState("");
  const enviado = useRef(false);
  const cargar = async () => {
    try {
      const { data } = await supabase.rpc("web_cambio_estado", { p_acceso: acceso });
      setD(data?.ok ? data : null);
      return data;
    } catch { setD("error"); return null; }
  };
  const mandarCorreo = async () => {
    setEnvio("enviando");
    try { const { data } = await supabase.functions.invoke("web-enviar-entradas", { body: { acceso, origen: window.location.origin } }); setEnvio(data?.ok ? "ok" : "no"); }
    catch { setEnvio("no"); }
  };
  useEffect(() => {
    let vivo = true, n = 0;
    (async () => {
      const u = new URL(window.location.href);
      if (u.searchParams.get("pago")) { try { await pagos(supabase, "confirmar", { acceso }); } catch {} }
      // Espera a que el pago se confirme (el aviso de Stripe puede tardar unos segundos)
      while (vivo && n++ < 15) {
        const x = await cargar();
        if (!x || x.estado !== "pendiente") break;
        await new Promise(r => setTimeout(r, 2000));
      }
    })();
    return () => { vivo = false; };
  }, [acceso]);
  // En cuanto está hecho, la entrada nueva se manda al correo de la persona nueva (una vez)
  useEffect(() => { if (d?.estado === "hecho" && !enviado.current) { enviado.current = true; mandarCorreo(); } }, [d?.estado]);

  if (d === undefined) return <Mensaje titulo="Comprobando el cambio…" />;
  if (d === null || d === "error") return <Mensaje titulo="No encontramos este cambio" texto="Si acabas de pagar, espera un momento y recarga la página."><a href="/cambio" style={{ ...btn("#ff5a3c", "#fff"), marginTop: 16, textDecoration: "none" }}>Volver</a></Mensaje>;
  const hecho = d.estado === "hecho";
  return (
    <Marco>
      <section style={card}>
        <div style={{ fontWeight: 900, fontSize: 20 }}>{hecho ? "¡Nombre cambiado!" : d.estado === "pendiente" ? "Esperando el pago…" : d.estado === "caducado" ? "El cambio no se completó" : "No se pudo completar el cambio"}</div>
        <div style={{ color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>
          {hecho ? <>La entrada de <b style={{ color: "var(--text)" }}>{d.evento}</b> ya está a nombre de <b style={{ color: "var(--text)" }}>{d.nombre}</b>, con un QR nuevo. La entrada anterior ya no vale.</>
            : d.estado === "pendiente" ? "En cuanto se confirme el pago, la entrada pasará a la persona nueva. No cierres esta página."
            : d.estado === "caducado" ? "No se llegó a pagar a tiempo. La entrada sigue a nombre de la persona anterior: puedes volver a intentarlo."
            : "La entrada cambió o se usó antes de completar el cambio. Habla con el organizador."}
        </div>
        {hecho && <>
          <a href={`/mis-entradas/${acceso}`} style={{ ...btn("var(--c)", T.tinta), width: "100%", marginTop: 14, minHeight: 52, textDecoration: "none" }}>Ver la entrada nueva</a>
          <button onClick={mandarCorreo} disabled={envio === "enviando"} style={{ ...btn("var(--card2)", "var(--text)"), width: "100%", marginTop: 10, border: "1px solid var(--line)" }}>
            {envio === "enviando" ? "Enviando…" : envio === "ok" ? "Enviada al correo ✓ · reenviar" : "Enviar la entrada al correo"}
          </button>
          {envio === "no" && <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>No se ha podido enviar el correo ahora. Guarda este enlace o pulsa «Ver la entrada nueva».</div>}
        </>}
        {!hecho && d.estado !== "pendiente" && <a href="/cambio" style={{ ...btn("var(--card2)", "var(--text)"), width: "100%", marginTop: 14, border: "1px solid var(--line)", textDecoration: "none" }}>Volver a intentarlo</a>}
      </section>
    </Marco>
  );
}

/* ---------- Entradas perdidas: servicio de recuperación (1 €, para TIXFAST) ----------
   Seguridad: las entradas SOLO se reenvían al correo con el que se compraron (nunca se enseñan aquí ni van a otro
   correo), la respuesta es siempre la misma haya o no entradas, se piden dos datos y hay límites de intentos. */
const MOTIVO_REC = {
  email: "Escribe el correo con el que compraste las entradas.",
  segundo_dato: "Escribe también tu nombre y apellidos o tu teléfono, tal y como los pusiste al comprar.",
  datos: "Revisa los datos: alguno es demasiado largo.",
  limite_correo: "Ya se han pedido 3 recuperaciones para este correo hoy. Revisa tu correo (también la carpeta de spam) o vuelve mañana.",
  demasiados_intentos: "Demasiados intentos desde esta conexión. Vuelve a probar más tarde.",
};
function Recuperar() {
  const [d, setD] = useState({ email: "", nombre: "", telefono: "", web: "" });
  const [acepto, setAcepto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [precio, setPrecio] = useState(1);
  useEffect(() => { supabase.rpc("web_recuperar_precio").then(({ data }) => { if (Number(data) > 0) setPrecio(Number(data)); }, () => {}); }, []);
  const cancelado = (() => { try { return new URL(window.location.href).searchParams.get("recuperar") === "cancelado"; } catch { return false; } })();
  const enviar = async (e) => {
    e.preventDefault(); setErr("");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email.trim())) return setErr(MOTIVO_REC.email);
    if (d.nombre.trim().length < 2 && d.telefono.replace(/\D/g, "").length < 9) return setErr(MOTIVO_REC.segundo_dato);
    if (!acepto) return setErr("Marca la casilla para confirmar que lo has entendido.");
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("web_recuperar_pedir", { p_datos: { email: d.email.trim(), nombre: d.nombre.trim(), telefono: d.telefono.trim(), web: d.web } });
      if (error) throw error;
      if (!data?.ok) { setErr(MOTIVO_REC[data?.motivo] || "No se ha podido completar. Vuelve a intentarlo."); setBusy(false); return; }
      const r = await pagos(supabase, "recuperar_checkout", { acceso: data.acceso });
      if (r?.url) { window.location.assign(r.url); return; }
      setErr(r?.motivo === "sin_pasarela" ? "El pago online aún no está disponible. Inténtalo más tarde." : "No se ha podido abrir el pago. Vuelve a intentarlo.");
    } catch { setErr(navigator.onLine ? "No se ha podido completar. Vuelve a intentarlo." : "Sin conexión."); }
    setBusy(false);
  };
  return (
    <>
      {cancelado && <div style={{ ...card, marginBottom: 12, borderColor: "var(--c)", fontWeight: 700 }}>Has cancelado el pago: no se ha cobrado nada.</div>}
      <form onSubmit={enviar} style={card}>
        <div style={{ fontWeight: 900, fontSize: 18 }}>¿Has perdido tu entrada?</div>
        <div style={{ color: "var(--muted)", marginTop: 6, lineHeight: 1.5, fontSize: 14.5 }}>Buscamos tus entradas y te las volvemos a enviar <b style={{ color: "var(--text)" }}>al correo con el que las compraste</b>. Por seguridad nunca se enseñan aquí ni se mandan a otro correo.</div>
        <div style={{ marginTop: 14 }}>
          <Campo l="Correo de la compra" type="email" v={d.email} on={(v) => setD({ ...d, email: v })} ac="email" im="email" />
          <Campo l="Nombre y apellidos" v={d.nombre} on={(v) => setD({ ...d, nombre: v })} ac="name" sub="Como los pusiste al comprar. Si no te acuerdas, escribe tu teléfono." />
          <Campo l="Teléfono (si lo diste al comprar)" type="tel" v={d.telefono} on={(v) => setD({ ...d, telefono: v })} ac="tel" im="tel" />
          {/* Casilla trampa: invisible para las personas; si la rellena un programa, la solicitud no sigue */}
          <input tabIndex={-1} autoComplete="off" aria-hidden="true" value={d.web} onChange={e => setD({ ...d, web: e.target.value })} style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }} />
        </div>
        <div style={{ background: "var(--card2)", border: "1px solid var(--line)", borderRadius: 12, padding: 12, margin: "4px 0 12px", fontSize: 14.5, display: "flex", justifyContent: "space-between", gap: 10 }}>
          <span>Servicio de recuperación</span><b>{eur(precio)}</b>
        </div>
        <Check v={acepto} on={setAcepto}>Entiendo que se cobra {eur(precio)} aunque no se encuentre ninguna entrada con estos datos, y que las entradas solo se envían al correo de la compra.</Check>
        {err && <div role="alert" style={{ color: "#ff6b6b", fontWeight: 700, marginTop: 12, lineHeight: 1.4 }}>{err}</div>}
        <button type="submit" disabled={busy} style={{ ...btn("var(--c)", T.tinta), width: "100%", marginTop: 14, minHeight: 54, opacity: busy ? .6 : 1 }}>{busy ? "Abriendo el pago seguro…" : `Pagar ${eur(precio)} y buscar mis entradas`}</button>
      </form>
      <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 14, lineHeight: 1.5 }}>¿Ya no tienes acceso a ese correo? Ve al evento con tu DNI: en la puerta pueden buscar tu entrada por tu nombre.</div>
    </>
  );
}

// Vuelta del pago: siempre el mismo mensaje (nunca se dice si había entradas)
function ResultadoRecuperar({ acceso }) {
  const [estado, setEstado] = useState(undefined);
  useEffect(() => {
    let vivo = true, n = 0;
    (async () => {
      try { await pagos(supabase, "recuperar_confirmar", { acceso }); } catch {}
      while (vivo && n++ < 12) {
        let e = null;
        try { const { data } = await supabase.rpc("web_recuperar_estado", { p_acceso: acceso }); e = data?.ok ? data.estado : null; } catch {}
        if (!vivo) return;
        setEstado(e);
        if (e !== "pendiente") break;
        await new Promise(r => setTimeout(r, 2500));
      }
    })();
    return () => { vivo = false; };
  }, [acceso]);
  if (estado === undefined) return <Mensaje titulo="Comprobando el pago…" />;
  return (
    <Marco>
      <section style={card}>
        <div style={{ fontWeight: 900, fontSize: 20 }}>{estado === "hecho" ? "Solicitud completada" : estado === "pendiente" ? "Esperando el pago…" : "No se completó el pago"}</div>
        <div style={{ color: "var(--muted)", marginTop: 8, lineHeight: 1.55 }}>
          {estado === "hecho" ? <>Si hay entradas con esos datos, ya las hemos enviado <b style={{ color: "var(--text)" }}>al correo de la compra</b>. Revisa también la carpeta de spam. Si en 15 minutos no te llega nada, es que los datos no coinciden con ninguna compra: prueba con otro correo, o ve al evento con tu DNI.</>
            : estado === "pendiente" ? "En cuanto se confirme el pago buscaremos tus entradas. No cierres esta página."
            : "No se ha cobrado nada. Puedes volver a intentarlo."}
        </div>
        {estado !== "pendiente" && <a href="/cambio?recuperar" style={{ ...btn("var(--card2)", "var(--text)"), width: "100%", marginTop: 14, border: "1px solid var(--line)", textDecoration: "none" }}>Volver</a>}
      </section>
    </Marco>
  );
}

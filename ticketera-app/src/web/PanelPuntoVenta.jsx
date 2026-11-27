// ===================== PANEL DEL PUNTO DE VENTA (página pública /pv/<enlace>) =====================
// El local que vende entradas físicas abre este enlace en su móvil (sin cuenta ni contraseña).
// · «Vender»: escanea la entrada al venderla (o pulsa «+1 vendida» si no hay tiempo). Solo sirve para que el
//   organizador sepa cuántas lleva vendidas: la entrada vale para entrar igual, se registre o no.
// · «Devolver»: escanea las que no ha vendido para devolverlas; quedan anuladas al momento.
// · «Venta al móvil» (si el organizador lo permite): cobra en efectivo y el comprador recibe la entrada en su correo.
import React, { useEffect, useRef, useState } from "react";
import { supabase } from "../supabase";
import { leerToken } from "../qr/token";
import { useCamaraQR, useSonido } from "../qr/lector";
import { tema, card, btn, Mensaje, Campo, CSS_PUB, fecha, eur, stepBtn, cap } from "./comun";

const T = tema();
const VERDE = "#22d3a6", ROJO = "#ff4d4d", AMBAR = "#ffb400";   // los de la app (--green, --red, --amber)
const MOTIVO = {
  no_es_tuya: "Esta entrada no es de tus talonarios.",
  devuelta: "Esta entrada está devuelta (anulada). No la vendas.",
  registrada: "Esta entrada está registrada como vendida. Si no la has vendido, pulsa «Deshacer» en la venta y vuelve a devolverla.",
  empezado: "El evento ya ha empezado: ya no se pueden devolver entradas.",
  no_se_puede: "Esta entrada no se puede devolver (puede que ya se haya usado). Habla con el organizador.",
  todas: "Ya tienes registradas todas las entradas de esta entrega.",
  liquidada: "Esta entrega ya está liquidada con el organizador: ya no se puede cambiar.",
  no_permitido: "El organizador no tiene activada la venta al móvil en tu local.",
  cantidad: "Elige entre 1 y 10 entradas.",
  nombre: "Escribe el nombre y los apellidos del comprador.",
  email: "Revisa el correo electrónico del comprador.",
  agotado: "No quedan suficientes entradas de este tipo.",
  pasado: "Este evento ya ha terminado.",
  sin_web: "Este evento aún no tiene la venta abierta.",
  tramo: "Ese tipo de entrada ya no está disponible.",
  demasiados_intentos: "Demasiados intentos seguidos. Espera un minuto.",
  no_existe: "Este enlace ya no funciona. Pide al organizador el enlace nuevo.",
};
const textoMotivo = (m) => MOTIVO[m] || "No se ha podido hacer. Revisa la conexión y vuelve a intentarlo.";

function Marco({ nombre, children }) {
  return (
    <div style={{ ...T.vars, minHeight: "100dvh", background: "var(--bg)", color: "var(--text)", fontFamily: T.letra }}>
      <style>{CSS_PUB}</style>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "18px 16px calc(40px + env(safe-area-inset-bottom))" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, minWidth: 0 }}>
          <img src="/brand/tixfast_isotipo_app.svg" alt="TIXFAST" width="34" height="34" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 19, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nombre || "Punto de venta"}</div>
            <div style={{ color: "var(--muted)", fontSize: 13, fontWeight: 700 }}>Panel del punto de venta</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function PanelPuntoVenta({ token }) {
  const [d, setD] = useState(undefined);
  const [evId, setEvId] = useState(null);
  const [modo, setModo] = useState(null);   // "vender" | "devolver" | "movil" | null
  const cargar = async () => {
    try {
      const { data, error } = await supabase.rpc("pv_panel", { p_token: token });
      if (error) throw error;
      setD(data);
      return data;
    } catch { setD((x) => (x && x.ok ? x : "error")); return null; }
  };
  useEffect(() => { cargar(); const t = setInterval(() => { if (document.visibilityState === "visible") cargar(); }, 30000); return () => clearInterval(t); }, [token]);

  if (d === undefined) return <Mensaje titulo="Cargando…" />;
  if (d === "error") return <Mensaje titulo="Sin conexión" texto="No se ha podido cargar. Comprueba la conexión y vuelve a intentarlo."><button onClick={() => { setD(undefined); cargar(); }} style={{ ...btn("#ff5a3c", "#fff"), marginTop: 16, minHeight: 48 }}>Reintentar</button></Mensaje>;
  if (!d.ok) return <Mensaje titulo={d.motivo === "no_existe" ? "Enlace no válido" : "Ahora no se puede"} texto={textoMotivo(d.motivo)} />;

  const eventos = d.eventos || [];
  const ev = eventos.find((e) => e.id === evId) || eventos[0];
  if (!ev) return <Marco nombre={d.punto?.nombre}><section style={card}><div style={{ fontWeight: 900, fontSize: 18 }}>No tienes entradas para vender ahora</div><div style={{ color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>Cuando el organizador te entregue entradas de un evento, aparecerán aquí.</div></section></Marco>;

  const lotesQR = (ev.lotes || []).filter((l) => l.modo === "qr");
  const puedeMovil = d.punto?.venta_directa && (ev.tramos || []).length > 0;

  return (
    <Marco nombre={d.punto?.nombre}>
      {eventos.length > 1 && (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6, marginBottom: 8 }}>
          {eventos.map((e) => (
            <button key={e.id} onClick={() => { setEvId(e.id); setModo(null); }} style={{ ...btn(e.id === ev.id ? "var(--c)" : "var(--card2)", e.id === ev.id ? T.tinta : "var(--text)"), padding: "10px 14px", fontSize: 14, minHeight: 44, flex: "0 0 auto", border: "1px solid var(--line)" }}>{e.nombre}</button>
          ))}
        </div>
      )}
      <section style={card}>
        <div style={{ fontWeight: 900, fontSize: 20, lineHeight: 1.2 }}>{ev.nombre}</div>
        <div style={{ color: "var(--muted)", marginTop: 4, fontSize: 14 }}>{cap(fecha(ev.inicio || ev.fecha))}{ev.recinto ? ` · ${ev.recinto}` : ""}</div>
        <Resumen ev={ev} />
      </section>

      {/* Acciones principales */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
        {lotesQR.length > 0 && <Accion activo={modo === "vender"} color={VERDE} onClick={() => setModo(modo === "vender" ? null : "vender")} titulo="Vender" sub="Escanear al vender" />}
        {lotesQR.length > 0 && <Accion activo={modo === "devolver"} color={AMBAR} onClick={() => setModo(modo === "devolver" ? null : "devolver")} titulo="Devolver" sub="Las no vendidas" />}
        {puedeMovil && <Accion activo={modo === "movil"} color="var(--c)" onClick={() => setModo(modo === "movil" ? null : "movil")} titulo="Venta al móvil" sub="Entrada al correo" ancho />}
      </div>

      {(modo === "vender" || modo === "devolver") && <Escaner key={modo + ev.id} token={token} modo={modo} onCambio={cargar} />}
      {modo === "movil" && <VentaMovil key={ev.id} token={token} ev={ev} onHecho={cargar} />}

      {(ev.lotes || []).length > 0 && (
        <section style={{ ...card, marginTop: 14 }}>
          <div style={{ fontWeight: 900, fontSize: 17, marginBottom: 4 }}>Tus entregas</div>
          {(ev.lotes || []).map((l) => <Lote key={l.id} l={l} token={token} onCambio={cargar} />)}
        </section>
      )}

      <div style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.5, marginTop: 14, textAlign: "center" }}>
        Las entradas que vendes valen siempre para entrar, las registres o no. Registrarlas solo sirve para que el organizador sepa cuántas llevas.
        Las que no vendas, devuélvelas antes del evento: quedarán anuladas.
      </div>
      <button onClick={cargar} style={{ ...btn("transparent", "var(--muted)"), width: "100%", minHeight: 44, fontSize: 14, fontWeight: 700, marginTop: 6 }}>Actualizar</button>
    </Marco>
  );
}

function Accion({ activo, color, onClick, titulo, sub, ancho }) {
  return (
    <button onClick={onClick} aria-pressed={activo} style={{ ...btn(activo ? color : "var(--card2)", activo ? "#111" : "var(--text)"), flexDirection: "column", gap: 2, minHeight: 72, border: `2px solid ${activo ? color : "var(--line)"}`, gridColumn: ancho ? "1 / -1" : undefined }}>
      <span style={{ fontSize: 17 }}>{titulo}</span>
      <span style={{ fontSize: 12.5, fontWeight: 700, opacity: .8 }}>{sub}</span>
    </button>
  );
}

function Resumen({ ev }) {
  const lotes = ev.lotes || [];
  const entregadas = lotes.reduce((s, l) => s + l.entregadas, 0);
  const registradas = lotes.reduce((s, l) => s + l.registradas, 0);
  const devueltas = lotes.reduce((s, l) => s + l.devueltas, 0);
  const movil = ev.directas?.entradas || 0;
  const cifras = [["Entregadas", entregadas], ["Vendidas", registradas], ["Devueltas", devueltas]];
  if (movil) cifras.push(["Al móvil", movil]);
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cifras.length}, 1fr)`, gap: 8, marginTop: 14 }}>
      {cifras.map(([k, v]) => (
        <div key={k} style={{ background: "var(--card2)", borderRadius: 12, padding: "10px 6px", textAlign: "center", minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: 22 }}>{v}</div>
          <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>{k}</div>
        </div>
      ))}
    </div>
  );
}

function Lote({ l, token, onCambio }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const sumar = async (delta) => {
    setBusy(true); setErr("");
    try {
      const { data } = await supabase.rpc("pv_sumar", { p_token: token, p_lote: l.id, p_delta: delta });
      if (!data?.ok) setErr(textoMotivo(data?.motivo)); else await onCambio();
    } catch { setErr(textoMotivo()); }
    setBusy(false);
  };
  const plazo = l.devolver_hasta ? new Date(l.devolver_hasta) : null;
  const quedan = l.entregadas - l.registradas - l.devueltas;
  return (
    <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 800 }}>{l.nombre} · {eur(l.precio)}</div>
        <div style={{ color: "var(--muted)", fontSize: 13.5, fontWeight: 700 }}>nº {l.desde} a {l.hasta}</div>
      </div>
      <div style={{ color: "var(--muted)", fontSize: 14, marginTop: 4, lineHeight: 1.45 }}>
        {l.registradas} vendidas · {l.devueltas} devueltas · {Math.max(quedan, 0)} sin registrar{l.liquidado ? " · liquidada" : ""}
      </div>
      {plazo && !isNaN(plazo) && <div style={{ color: plazo < new Date() ? ROJO : AMBAR, fontSize: 13.5, fontWeight: 800, marginTop: 4 }}>Devuelve las no vendidas antes del {plazo.toLocaleString("es-ES", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}</div>}
      {!l.liquidado && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
          <button disabled={busy} onClick={() => sumar(1)} style={{ ...btn(VERDE, "#111"), flex: 1, minHeight: 48, opacity: busy ? .6 : 1 }}>+1 vendida</button>
          <button disabled={busy || l.registradas === 0} aria-label="Quitar una vendida" onClick={() => sumar(-1)} style={{ ...stepBtn, width: 48, height: 48, opacity: busy || l.registradas === 0 ? .4 : 1 }}>−</button>
        </div>
      )}
      {l.modo !== "qr" && !l.liquidado && <div style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 6 }}>Estas entradas no llevan QR de TIXFAST: usa «+1 vendida» al venderlas.</div>}
      {err && <div role="alert" style={{ color: ROJO, fontWeight: 700, marginTop: 8 }}>{err}</div>}
    </div>
  );
}

/* ---------- Escáner: vender (registrar) o devolver (anular) ---------- */
function Escaner({ token, modo, onCambio }) {
  const snd = useSonido();
  const [res, setRes] = useState(null);    // { tipo: ok|ya|mal, texto, hex, numero }
  const [lista, setLista] = useState([]);  // lo hecho en esta sesión
  const ultimo = useRef({ t: "", en: 0 });
  const ocupado = useRef(false);
  const procesar = async (texto) => {
    const ahora = Date.now();
    if (ocupado.current || (texto === ultimo.current.t && ahora - ultimo.current.en < 3000)) return;
    ultimo.current = { t: texto, en: ahora };
    const tk = leerToken(texto);
    if (!tk) { snd.mal(); setRes({ tipo: "mal", texto: "Esto no es una entrada de TIXFAST." }); return; }
    ocupado.current = true;
    try {
      const { data } = await supabase.rpc("pv_escanear", { p_token: token, p_hex: tk.hex, p_accion: modo });
      if (data?.ok) {
        const ya = !!data.ya;
        if (ya) snd.aviso(); else snd.bien();
        const txt = modo === "vender" ? (ya ? `La nº ${data.numero} ya estaba registrada como vendida.` : `Vendida la nº ${data.numero}.`)
                                       : (ya ? `La nº ${data.numero} ya estaba devuelta.` : `Devuelta la nº ${data.numero}. Ya no vale para entrar.`);
        setRes({ tipo: ya ? "ya" : "ok", texto: txt, hex: tk.hex, numero: data.numero });
        if (!ya) { setLista((l) => [{ numero: data.numero, hex: tk.hex }, ...l].slice(0, 50)); onCambio(); }
      } else { snd.mal(); setRes({ tipo: "mal", texto: textoMotivo(data?.motivo) }); }
    } catch { snd.mal(); setRes({ tipo: "mal", texto: "Sin conexión: no se ha registrado. Vuelve a escanearla." }); ultimo.current = { t: "", en: 0 }; }
    ocupado.current = false;
  };
  const procesarRef = useRef(procesar); procesarRef.current = procesar;
  const cam = useCamaraQR((t) => procesarRef.current(t), { alArrancar: () => snd.activar(), mantenerEncendida: true, claveCamara: "tixfast_pv_camara" });
  useEffect(() => { if (!cam.empezado) cam.arrancar(); }, []);
  const deshacer = async (x) => {
    try {
      const { data } = await supabase.rpc("pv_escanear", { p_token: token, p_hex: x.hex, p_accion: "deshacer" });
      if (data?.ok) { setLista((l) => l.filter((y) => y.hex !== x.hex)); setRes({ tipo: "ya", texto: `Deshecha la venta de la nº ${x.numero}.` }); onCambio(); }
    } catch { setRes({ tipo: "mal", texto: "Sin conexión: no se ha deshecho." }); }
  };
  const color = res?.tipo === "ok" ? VERDE : res?.tipo === "ya" ? AMBAR : ROJO;
  return (
    <section style={{ ...card, marginTop: 14 }}>
      <div style={{ fontWeight: 900, fontSize: 17 }}>{modo === "vender" ? "Escanea cada entrada al venderla" : "Escanea las entradas que devuelves"}</div>
      <div style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 4, lineHeight: 1.45 }}>
        {modo === "vender" ? "Apunta al QR de la entrada. Si no da tiempo, no pasa nada: la entrada vale igual." : "Cada entrada devuelta queda anulada al momento: no la vendas después."}
      </div>
      <video ref={cam.video} playsInline muted style={{ width: "100%", maxHeight: 300, objectFit: "cover", borderRadius: 14, background: "#000", display: "block", marginTop: 12 }} />
      {cam.camErr && <div style={{ color: ROJO, fontWeight: 700, marginTop: 8 }}>{cam.camErr === "permiso" ? "Da permiso a la cámara en el navegador para poder escanear." : "No se ha podido abrir la cámara."}</div>}
      {res && <div role="status" style={{ marginTop: 12, borderRadius: 12, padding: "12px 14px", background: color, color: "#111", fontWeight: 900, fontSize: 16, lineHeight: 1.35 }}>{res.texto}</div>}
      {modo === "vender" && lista.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ color: "var(--muted)", fontSize: 13, fontWeight: 800, marginBottom: 6 }}>Vendidas ahora ({lista.length})</div>
          {lista.slice(0, 8).map((x) => (
            <div key={x.hex} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, borderTop: "1px solid var(--line)", padding: "4px 0" }}>
              <span style={{ fontWeight: 800 }}>nº {x.numero}</span>
              <button onClick={() => deshacer(x)} style={{ ...btn("transparent", "var(--muted)"), minHeight: 44, fontSize: 14, fontWeight: 700, padding: "8px 10px" }}>Deshacer</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------- Venta al móvil: cobra en efectivo y la entrada llega al correo ---------- */
function VentaMovil({ token, ev, onHecho }) {
  const tramos = ev.tramos || [];
  const [tramo, setTramo] = useState(tramos[0]?.id || "");
  const [n, setN] = useState(1);
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [paso, setPaso] = useState("datos");   // datos | confirmar | hecho
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [hecho, setHecho] = useState(null);
  const [envio, setEnvio] = useState("");
  const t = tramos.find((x) => x.id === tramo);
  const total = (Number(t?.precio) || 0) * n;
  const max = Math.min(10, t?.disponibles ?? 10);

  const seguir = (e) => {
    e.preventDefault(); setErr("");
    if (!t) return setErr("Elige el tipo de entrada.");
    if (nombre.trim().length < 3) return setErr(textoMotivo("nombre"));
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setErr(textoMotivo("email"));
    setPaso("confirmar");
  };
  const vender = async () => {
    setBusy(true); setErr("");
    try {
      const { data } = await supabase.rpc("pv_venta_directa", { p_token: token, p_tramo: tramo, p_cantidad: n, p_comprador: { nombre: nombre.trim(), email: email.trim() } });
      if (!data?.ok) { setErr(textoMotivo(data?.motivo)); setPaso("datos"); }
      else {
        setHecho(data); setPaso("hecho"); onHecho();
        setEnvio("enviando");
        try { const r = await supabase.functions.invoke("web-enviar-entradas", { body: { acceso: data.acceso, origen: window.location.origin } }); setEnvio(r.data?.ok ? "ok" : "no"); }
        catch { setEnvio("no"); }
      }
    } catch { setErr("Sin conexión: la venta no se ha hecho. Vuelve a intentarlo."); }
    setBusy(false);
  };
  const nueva = () => { setPaso("datos"); setNombre(""); setEmail(""); setN(1); setHecho(null); setEnvio(""); setErr(""); };

  if (paso === "hecho" && hecho) {
    const enlace = `${window.location.origin}/mis-entradas/${hecho.acceso}`;
    const wa = `https://wa.me/?text=${encodeURIComponent(`Tu entrada para ${ev.nombre}: ${enlace}`)}`;
    return (
      <section style={{ ...card, marginTop: 14 }}>
        <div style={{ fontWeight: 900, fontSize: 20, color: VERDE }}>¡Venta hecha!</div>
        <div style={{ marginTop: 6, lineHeight: 1.5 }}>
          {n === 1 ? "1 entrada" : `${n} entradas`} a nombre de <b>{nombre}</b> (nº {hecho.desde}{hecho.hasta !== hecho.desde ? ` a ${hecho.hasta}` : ""}).
          Cobra <b>{eur(hecho.total)}</b> en efectivo.{hecho.prueba ? " (Evento en modo PRUEBA: estas entradas no valen.)" : ""}
        </div>
        <div style={{ color: envio === "no" ? ROJO : "var(--muted)", fontSize: 14, marginTop: 8, fontWeight: 700 }}>
          {envio === "enviando" ? "Enviando la entrada al correo…" : envio === "ok" ? `Entrada enviada a ${email}.` : envio === "no" ? "No se ha podido enviar el correo: pásale el enlace por WhatsApp." : ""}
        </div>
        <a href={wa} target="_blank" rel="noopener noreferrer" style={{ ...btn("#25d366", "#111"), width: "100%", boxSizing: "border-box", marginTop: 12, minHeight: 50, textDecoration: "none" }}>Enviar por WhatsApp</a>
        <a href={enlace} target="_blank" rel="noopener noreferrer" style={{ ...btn("var(--card2)", "var(--text)"), width: "100%", boxSizing: "border-box", marginTop: 8, minHeight: 48, textDecoration: "none", border: "1px solid var(--line)" }}>Ver la entrada</a>
        <button onClick={nueva} style={{ ...btn("var(--c)", T.tinta), width: "100%", marginTop: 8, minHeight: 50 }}>Nueva venta</button>
      </section>
    );
  }

  if (paso === "confirmar") return (
    <section style={{ ...card, marginTop: 14 }}>
      <div style={{ fontWeight: 900, fontSize: 18 }}>¿Has cobrado?</div>
      <div style={{ marginTop: 8, lineHeight: 1.55 }}>
        {n} × {t?.nombre} para <b>{nombre}</b><br />
        <span style={{ color: "var(--muted)" }}>{email}</span>
      </div>
      <div style={{ fontWeight: 900, fontSize: 28, marginTop: 10 }}>{eur(total)}</div>
      <div style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 2 }}>a cobrar en efectivo</div>
      {err && <div role="alert" style={{ color: ROJO, fontWeight: 700, marginTop: 10 }}>{err}</div>}
      <button disabled={busy} onClick={vender} style={{ ...btn(VERDE, "#111"), width: "100%", marginTop: 14, minHeight: 54, opacity: busy ? .6 : 1 }}>{busy ? "Creando la entrada…" : `Cobrado ${eur(total)} · crear entrada`}</button>
      <button disabled={busy} onClick={() => setPaso("datos")} style={{ ...btn("transparent", "var(--muted)"), width: "100%", marginTop: 6, minHeight: 44, fontSize: 14, fontWeight: 700 }}>Volver</button>
    </section>
  );

  return (
    <form onSubmit={seguir} style={{ ...card, marginTop: 14 }}>
      <div style={{ fontWeight: 900, fontSize: 17, marginBottom: 10 }}>Venta al móvil</div>
      <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
        {tramos.map((x) => {
          const sin = x.disponibles !== null && x.disponibles !== undefined && x.disponibles <= 0;
          return (
            <button type="button" key={x.id} disabled={sin} onClick={() => { setTramo(x.id); setN(1); }} style={{ ...btn(tramo === x.id ? "var(--c)" : "var(--card2)", tramo === x.id ? T.tinta : "var(--text)"), justifyContent: "space-between", minHeight: 50, border: "1px solid var(--line)", opacity: sin ? .45 : 1, fontSize: 15 }}>
              <span style={{ textAlign: "left" }}>{x.nombre}{sin ? " · agotada" : ""}</span><span>{eur(x.precio)}</span>
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
        <span style={{ fontWeight: 800 }}>Entradas</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button type="button" aria-label="Una menos" onClick={() => setN(Math.max(1, n - 1))} style={stepBtn}>−</button>
          <span style={{ fontWeight: 900, fontSize: 20, minWidth: 24, textAlign: "center" }}>{n}</span>
          <button type="button" aria-label="Una más" onClick={() => setN(Math.min(Math.max(max, 1), n + 1))} style={stepBtn}>+</button>
        </div>
      </div>
      <Campo l="Nombre y apellidos del comprador" v={nombre} on={setNombre} ac="off" />
      <Campo l="Correo del comprador" v={email} on={setEmail} type="email" im="email" ac="off" sub="Ahí le llega la entrada con su QR." />
      {err && <div role="alert" style={{ color: ROJO, fontWeight: 700, marginTop: 4 }}>{err}</div>}
      <button type="submit" style={{ ...btn("var(--c)", T.tinta), width: "100%", marginTop: 10, minHeight: 54 }}>Seguir · {eur(total)}</button>
    </form>
  );
}

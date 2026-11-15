// ===================== /p/… · PANTALLA DEL PUESTO (food truck, caseta, proveedor) =====================
// Acceso (sin cuentas ni contraseñas largas):
//   1) La organización ACTIVA el móvil: QR que se escanea allí mismo (15 min) o enlace que envía (24 h).
//      Un solo uso.  →  /p/activar?c=<código>
//   2) La primera vez, el puesto CREA SU PROPIO PIN (6 cifras; la organización no lo ve).
//   3) El móvil queda desbloqueado 12 horas; luego pide el PIN del puesto para otras 12.
//   4) /p/sesion vuelve a abrir este móvil (icono en la pantalla de inicio).
// Con el móvil desbloqueado el puesto solo puede:
//   · escanear los tickets de los productos que la organización le ha permitido,
//   · ver lo que ha entregado y lo que factura (ya con la comisión de la organización quitada).
// MODO MOSTRADOR: el móvil mira a la cola (cámara delantera) y solo dice CORRECTO / NO VÁLIDO.
// No enseña facturación, historial ni pedidos; para salir hace falta el PIN del puesto.
// Cada canje lo decide SIEMPRE el servidor. Sin internet no se da nada por bueno: el ticket queda
// «pendiente de comprobar», se comprueba solo al volver la red y hasta entonces NO se entrega.
// Un ticket de un producto que este puesto no sirve sale «NO VÁLIDO AQUÍ» y sigue valiendo en su sitio.
// Rápido en cola: la cámara no se apaga, varios tickets seguidos se suman en un «pedido» y
// funciona con pistola lectora USB/Bluetooth.
import React, { useEffect, useRef, useState } from "react";
import { supabase } from "../supabase";
import { leerToken } from "../qr/token";
import { useSonido, useCamaraQR, useLectorTeclado } from "../qr/lector";

const eur = (n) => (Number(n) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
const hora = (t) => { try { return new Date(t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
const horaExacta = (t) => { try { return new Date(t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); } catch { return ""; } };
const limpio = (t) => String(t || "").trim();
const cap = (t) => { const x = limpio(t); return x.charAt(0).toUpperCase() + x.slice(1); };
const nuevoId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`.replace(/\D/g, "").padEnd(32, "0").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*/, "$1-$2-$3-$4-$5"));
const dispositivo = () => { const u = navigator.userAgent || ""; return /iPad/.test(u) ? "iPad" : /iPhone/.test(u) ? "iPhone" : /Android/.test(u) ? (/Mobile/.test(u) ? "Android" : "Tablet Android") : "Navegador"; };
const conTiempo = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("timeout"), { red: true })), ms))]);
const leer = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v ?? def; } catch { return def; } };
const guardar = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// Lo que ve el puesto en cada caso (corto y claro)
function explicar(r) {
  switch (r.motivo) {
    case "no_aqui": return { t: "TICKET NO VÁLIDO AQUÍ", d: `Es de ${limpio(r.nombre) || "otro producto"} y aquí no se sirve. El ticket SIGUE VALIENDO${r.aceptan?.length ? `: que lo canjee en ${r.aceptan.join(", ")}` : " en su puesto"}.` };
    case "ya_canjeado": return { t: "YA CANJEADO", d: `Se entregó a las ${hora(r.canjeado_en)}${r.barra ? ` en ${r.barra}` : ""}. Es una copia: no entregues.` };
    case "anulado": return { t: "TICKET ANULADO", d: "Esa venta se anuló en caja. No entregues." };
    case "caducado": return { t: "EVENTO TERMINADO", d: "Los tickets de este evento ya no valen." };
    case "prueba": return { t: "TICKET DE PRUEBA", d: "Se imprimió en modo prueba. No vale." };
    case "falso": return { t: "TICKET NO VÁLIDO", d: "No es un ticket de este evento o está manipulado. No entregues." };
    case "error": return { t: "NO SE HA PODIDO COMPROBAR", d: "Vuelve a escanearlo. Si sigue fallando, avisa a la organización." };
    default: return { t: "NO ES UN TICKET", d: "Ese código no es un ticket de TIXFAST. Prueba otra vez." };
  }
}
// Modo mostrador: lo ve el cliente → solo correcto / no válido, sin datos internos
function explicarCliente(r) {
  if (r.motivo === "no_aqui") return { t: "NO VÁLIDO AQUÍ", d: r.aceptan?.length ? `Este ticket es para: ${r.aceptan.join(", ")}. Sigue siendo válido allí.` : "Este ticket es de otro puesto. Sigue siendo válido allí." };
  if (r.motivo === "ya_canjeado") return { t: "YA UTILIZADO", d: "Este ticket ya se ha canjeado." };
  return { t: "NO VÁLIDO", d: "Este ticket no se puede canjear. Consulta en caja." };
}

// Este móvil recuerda su vínculo con el puesto (un puesto por móvil). Lo pendiente y el historial van con él.
const K_SES = "tixfast_puesto_ses", K_PEND = "tixfast_puesto_pend", K_HIST = "tixfast_puesto_hist", K_MOST = "tixfast_puesto_mostrador";
const sesionGuardada = () => { const x = leer(K_SES, null); return x?.sesion && new Date(x.caduca_en) > new Date() ? x : null; };

export default function PaginaPuesto({ token }) {
  const activar = token === "activar";
  const [ses, setSes] = useState(() => activar ? null : sesionGuardada());
  const [fase, setFase] = useState(activar ? "activando" : sesionGuardada() ? "cargando" : "sin");   // activando · cargando · crear_pin · pin · dentro · sin
  const [aviso, setAviso] = useState(null);
  const vincular = (r) => {   // móvil recién activado
    const x = { sesion: r.sesion, caduca_en: r.caduca_en, desbloqueado_hasta: r.desbloqueado_hasta, puesto: r.puesto, color: r.color, evento: r.evento };
    guardar(K_PEND, null); guardar(K_HIST, null); guardar(K_MOST, null);   // nada de un puesto anterior
    guardar(K_SES, x); setSes(x); setAviso(null);
    setFase(r.necesita_pin ? "crear_pin" : "dentro");
  };
  const salir = (msg) => { guardar(K_SES, null); guardar(K_PEND, null); guardar(K_MOST, null); setSes(null); setFase("sin"); setAviso(msg || null); };
  const desbloqueado = (hasta) => { const x = { ...leer(K_SES, {}), desbloqueado_hasta: hasta }; guardar(K_SES, x); setSes(x); setFase("dentro"); };
  // Activar con el código de la organización
  useEffect(() => {
    if (!activar) return;
    const c = new URLSearchParams(window.location.search).get("c") || "";
    try { window.history.replaceState(null, "", "/p/sesion"); } catch {}   // el código no se queda en el historial
    (async () => {
      try {
        const { data, error } = await conTiempo(supabase.rpc("puesto_activar", { p_codigo: c, p_dispositivo: dispositivo() }), 10000);
        if (error) throw error;
        if (data?.ok) vincular(data);
        else { setFase("sin"); setAviso("Este código de activación ya se ha usado o ha caducado. Pide otro a la organización."); }
      } catch { setFase("sin"); setAviso(navigator.onLine ? "No se ha podido activar. Vuelve a escanear el QR." : "Sin conexión: para activar el móvil hace falta internet."); }
    })();
  }, []);
  // Móvil ya vinculado: ¿sigue valiendo? ¿le falta crear el PIN? ¿han pasado las 12 h?
  useEffect(() => {
    if (fase !== "cargando" || !ses) return;
    (async () => {
      try {
        const { data, error } = await conTiempo(supabase.rpc("puesto_estado", { p_sesion: ses.sesion }), 8000);
        if (error) throw error;
        if (!data?.ok) return salir("Este móvil ya no está vinculado al puesto. Pide a la organización un código de activación.");
        const x = { ...ses, puesto: data.puesto, color: data.color, evento: data.evento, desbloqueado_hasta: data.desbloqueado_hasta };
        guardar(K_SES, x); setSes(x);
        setFase(data.necesita_pin ? "crear_pin" : data.desbloqueado ? "dentro" : "pin");
      } catch {   // sin conexión: se abre si seguía desbloqueado (el servidor decide igualmente cada canje)
        setFase(ses.desbloqueado_hasta && new Date(ses.desbloqueado_hasta) > new Date() ? "dentro" : "pin");
      }
    })();
  }, [fase]);

  if (fase === "dentro" && ses) return <Escaner sesion={ses.sesion} info={ses} onSalir={salir} onBloqueada={() => setFase("pin")} />;
  if (fase === "crear_pin" && ses) return <CrearPin info={ses} onHecho={() => setFase("dentro")} onSalir={salir} />;
  if (fase === "pin" && ses) return <Pantalla><Cabecera info={ses} /><PinPad titulo="Escribe el PIN del puesto" sub="Por seguridad, cada 12 horas" onPin={(pin) => desbloquearConPin(ses.sesion, pin, desbloqueado, salir)} /></Pantalla>;
  if (fase === "activando" || fase === "cargando") return <Pantalla><div style={{ fontWeight: 800, fontSize: 18 }}>{fase === "activando" ? "Activando este móvil…" : "Abriendo…"}</div></Pantalla>;
  return <Pantalla><div style={{ fontSize: 42 }}>📲</div><div style={{ fontWeight: 900, fontSize: 20, marginTop: 8 }}>{aviso ? "No se ha podido entrar" : "Este móvil no está activado"}</div>
    <div style={{ color: "rgba(255,255,255,.75)", marginTop: 8, maxWidth: 330, lineHeight: 1.45 }}>{aviso || "Escanea el QR de activación que te enseña la organización, o abre el enlace de activación que te han enviado."}</div></Pantalla>;
}

// PIN del puesto → desbloquea 12 h. Devuelve el mensaje de error (o null si ha ido bien)
async function desbloquearConPin(sesion, pin, alOk, salir) {
  try {
    const { data, error } = await conTiempo(supabase.rpc("puesto_desbloquear", { p_sesion: sesion, p_pin: pin }), 10000);
    if (error) throw error;
    if (data?.ok) { alOk(data.desbloqueado_hasta); return null; }
    if (data?.motivo === "sesion") { salir("Este móvil ya no está vinculado al puesto. Pide a la organización un código de activación."); return null; }
    return data?.motivo === "pin" ? `PIN incorrecto. Te quedan ${data.quedan} ${data.quedan === 1 ? "intento" : "intentos"}.`
      : data?.motivo === "bloqueado" ? `Demasiados intentos. Espera 15 minutos${data.hasta ? ` (hasta las ${hora(data.hasta)})` : ""} o pide ayuda a la organización.`
      : "No se ha podido comprobar el PIN.";
  } catch { return navigator.onLine ? "No se ha podido comprobar. Inténtalo otra vez." : "Sin conexión: el PIN se comprueba con internet."; }
}

/* ---------- Crear el PIN del puesto (la primera vez) ---------- */
function CrearPin({ info, onHecho, onSalir }) {
  const [primero, setPrimero] = useState(null);
  return (<Pantalla>
    <Cabecera info={info} />
    {!primero
      ? <PinPad key="a" titulo="Crea el PIN de tu puesto" sub="6 cifras. Lo pedirá cada 12 horas y para salir del modo mostrador. No uses 123456 ni números repetidos." onPin={async (p) => {
          if (/^(\d)\1{5}$/.test(p) || ["123456", "654321", "012345"].includes(p)) return "Ese PIN es muy fácil. Elige otro.";
          setPrimero(p); return null; }} />
      : <PinPad key="b" titulo="Repite el PIN" sub="Para comprobar que es correcto" onPin={async (p) => {
          if (p !== primero) { setPrimero(null); return "No coinciden. Empieza otra vez."; }
          try {
            const { data, error } = await conTiempo(supabase.rpc("puesto_crear_pin", { p_sesion: info.sesion, p_pin: p }), 10000);
            if (error) throw error;
            if (data?.ok || data?.motivo === "ya_tiene") { onHecho(); return null; }
            if (data?.motivo === "sesion") { onSalir("Este móvil ya no está vinculado al puesto."); return null; }
            setPrimero(null); return data?.motivo === "pin_debil" ? "Ese PIN es muy fácil. Elige otro." : "No se ha podido guardar el PIN. Empieza otra vez.";
          } catch { return "Sin conexión: hace falta internet para guardar el PIN."; }
        }} />}
  </Pantalla>);
}

const Cabecera = ({ info }) => <>
  <div style={{ width: 12, height: 12, borderRadius: 12, background: info?.color || "#ff5a3c", margin: "0 auto 8px" }} />
  <div style={{ fontWeight: 900, fontSize: 24 }}>{info?.puesto || "Puesto"}</div>
  <div style={{ color: "rgba(255,255,255,.7)", marginTop: 2 }}>{info?.evento || ""}</div>
</>;

// Teclado de 6 cifras. onPin(pin) devuelve un mensaje de error o null
function PinPad({ titulo, sub, onPin, compacto = false }) {
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const pulsar = async (d) => {
    if (busy) return;
    const n = (pin + d).slice(0, 6); setPin(n); setMsg(null);
    if (n.length < 6) return;
    setBusy(true);
    const e = await onPin(n);
    setBusy(false); setPin("");
    if (e) setMsg(e);
  };
  return (<div style={{ marginTop: compacto ? 0 : 22 }}>
    <div style={{ fontWeight: 900, fontSize: 18 }}>{titulo}</div>
    {sub && <div style={{ color: "rgba(255,255,255,.65)", fontSize: 13.5, marginTop: 4, maxWidth: 320, marginInline: "auto", lineHeight: 1.4 }}>{sub}</div>}
    <div aria-live="polite" aria-label={`${pin.length} de 6 cifras`} style={{ display: "flex", gap: 12, justifyContent: "center", margin: "14px 0 6px" }}>
      {Array.from({ length: 6 }, (_, i) => <span key={i} style={{ width: 16, height: 16, borderRadius: 16, background: i < pin.length ? "#fff" : "transparent", border: "2px solid rgba(255,255,255,.6)" }} />)}
    </div>
    <div role="status" style={{ minHeight: 40, color: "#ff8a80", fontWeight: 700, fontSize: 14, maxWidth: 320, margin: "0 auto", lineHeight: 1.35 }}>{busy ? <span style={{ color: "rgba(255,255,255,.7)" }}>Comprobando…</span> : msg}</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 76px)", gap: 12, justifyContent: "center", marginTop: 4 }}>
      {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "←"].map((d, i) => d === "" ? <span key={i} /> :
        <button key={i} disabled={busy} onClick={() => d === "←" ? setPin(pin.slice(0, -1)) : pulsar(d)} aria-label={d === "←" ? "Borrar" : d}
          style={{ height: 64, borderRadius: 18, border: "1px solid rgba(255,255,255,.18)", background: "rgba(255,255,255,.07)", color: "#fff", fontSize: 26, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{d}</button>)}
    </div>
  </div>);
}
const Pantalla = ({ children }) => <div style={{ minHeight: "100dvh", background: "#05060a", color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "24px 16px", boxSizing: "border-box", fontFamily: "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
  <img src="/brand/tixfast_isotipo_app.svg" alt="TIXFAST" width="40" height="40" style={{ marginBottom: 14 }} />{children}</div>;

/* ---------- Escanear ---------- */
function Escaner({ sesion, info, onSalir, onBloqueada }) {
  const kPend = K_PEND, kHist = K_HIST;
  const portada = info;
  const snd = useSonido();
  const procesarRef = useRef(null);
  const cam = useCamaraQR((t) => procesarRef.current?.(t), { alArrancar: () => snd.activar(), mantenerEncendida: true, claveCamara: "tixfast_puesto_camara" });
  useLectorTeclado((t) => procesarRef.current?.(t));   // pistola lectora USB/Bluetooth
  const [panel, setPanel] = useState(null);         // lo que dice el servidor de este puesto
  const [res, setRes] = useState(null);
  const [comprobando, setComprobando] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [pend, setPend] = useState(() => leer(kPend, []));
  const [hist, setHist] = useState(() => leer(kHist, []));
  const [verVentas, setVerVentas] = useState(false);
  // Modo mostrador: de cara al público. Solo «correcto / no válido»; para salir, el PIN del puesto
  const [mostrador, setMostrador] = useState(() => !!leer(K_MOST, false));
  const [salirMostrador, setSalirMostrador] = useState(false);
  const entrarMostrador = async () => {
    if (!window.confirm("¿Poner el modo mostrador? El móvil mirará a la cola y solo dirá si el ticket es correcto o no. Para salir hará falta el PIN del puesto.")) return;
    setVerVentas(false); setPedido(null); guardar(K_MOST, true); setMostrador(true);
    if (cam.camara !== "user") await cam.cambiarCamara();   // cámara delantera
    if (!cam.empezado) cam.arrancar();
  };
  const dejarMostrador = async () => { guardar(K_MOST, null); setMostrador(false); setSalirMostrador(false); if (cam.camara === "user") await cam.cambiarCamara(); };
  // Pedido: los tickets escaneados seguidos se suman (el cliente da 3 tickets → «3 × Hamburguesa»)
  const [pedido, setPedido] = useState(null);       // { items: { nombre: n }, total, t }
  const timerPedido = useRef(null);
  const sumarPedido = (nombre, n = 1) => {
    setPedido(p => { const items = { ...(p?.items || {}) }; const k = limpio(nombre) || "Producto"; items[k] = (items[k] || 0) + n; return { items, total: (p?.total || 0) + n, t: Date.now() }; });
    clearTimeout(timerPedido.current);
    timerPedido.current = setTimeout(() => setPedido(null), 20000);   // 20 s sin escanear → pedido nuevo
  };
  const cerrarPedido = () => { clearTimeout(timerPedido.current); setPedido(null); };
  const ocupado = useRef(false), recientes = useRef({}), timerRes = useRef(null), subiendo = useRef(false);

  const cargarPanel = async () => {
    try {
      const { data, error } = await conTiempo(supabase.rpc("puesto_panel", { p_sesion: sesion, p_limite: 500 }), 10000);
      if (error) return;
      if (data && !data.ok && data.motivo === "sesion") return onSalir("Este móvil ya no está vinculado al puesto. Pide a la organización un código de activación.");
      if (data && !data.ok && data.motivo === "bloqueada") return onBloqueada();   // pasaron las 12 h: pide el PIN
      if (data?.ok) setPanel(data);
    } catch {}
  };
  useEffect(() => {
    cargarPanel();
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    const tocar = () => snd.activar(); window.addEventListener("pointerdown", tocar);
    const t = setInterval(() => { if (document.visibilityState === "visible") cargarPanel(); }, 20000);
    return () => { clearInterval(t); window.removeEventListener("online", on); window.removeEventListener("offline", off); window.removeEventListener("pointerdown", tocar); };
  }, []);

  const apuntar = (r) => { const h = [{ tipo: r.tipo, t: Date.now(), titulo: r.tipo === "ok" ? limpio(r.nombre) || "Entregado" : r.tipo === "pend" ? "Pendiente de comprobar" : explicar(r).t }, ...leer(kHist, [])].slice(0, 60); guardar(kHist, h); setHist(h); };
  const mostrar = (r) => {
    setRes(r); apuntar(r);
    if (r.tipo === "ok") snd.bien(); else if (r.tipo === "pend") snd.aviso(); else snd.mal();
    clearTimeout(timerRes.current);
    timerRes.current = setTimeout(() => setRes(null), r.tipo === "ok" ? 900 : r.tipo === "pend" ? 4000 : 3500);   // verde breve: se sigue con el siguiente
  };
  const ponerPend = (q) => { guardar(kPend, q); setPend(q); };

  // Pregunta al servidor. Devuelve el resultado, o null si no hay conexión (queda pendiente)
  const preguntar = async (hex, id) => {
    try {
      const { data, error } = await conTiempo(supabase.rpc("puesto_canjear", { p_sesion: sesion, p_datos: hex, p_canje_id: id }), 6000);
      if (error) { if (!error.code || /fetch|network/i.test(error.message || "")) return null; return { ok: false, motivo: "error" }; }
      return data;
    } catch { return null; }
  };
  const tratar = (r) => {
    if (r?.motivo === "sesion") { onSalir("Este móvil ya no está vinculado al puesto. Pide a la organización un código de activación."); return null; }
    if (r?.motivo === "bloqueada") { onBloqueada(); return null; }
    if (r?.ok) { if (!r.repetido) sumarPedido(r.nombre, r.unidades || 1); cargarPanel(); return { ...r, tipo: "ok" }; }
    return { ...r, tipo: "mal" };
  };

  const procesar = async (texto) => {
    if (ocupado.current || (verVentas && !mostrador) || salirMostrador) return;
    const ahora = Date.now();
    const tk = leerToken(texto);
    const clave = tk ? tk.clave : texto;
    const visto = recientes.current[clave]; recientes.current[clave] = ahora;
    if (visto && ahora - visto < 2500) return;   // el mismo ticket sigue delante de la cámara
    if (!tk) { mostrar({ tipo: "mal", motivo: "ilegible" }); return; }
    if (pend.some(p => p.clave === tk.clave)) { mostrar({ tipo: "pend", repetido: true }); return; }
    ocupado.current = true;
    const lento = setTimeout(() => setComprobando(true), 250);
    try {
      const id = nuevoId();
      const r = navigator.onLine ? await preguntar(tk.hex, id) : null;
      if (r === null || r?.motivo === "bloqueada") {   // sin respuesta (o falta el PIN): NO se entrega; se comprueba solo después
        ponerPend([...leer(kPend, []), { id, hex: tk.hex, clave: tk.clave, t: Date.now() }]);
        if (r?.motivo === "bloqueada") { onBloqueada(); return; }
        mostrar({ tipo: "pend" });
        return;
      }
      const x = tratar(r); if (x) mostrar(x);
    } finally { clearTimeout(lento); setComprobando(false); setTimeout(() => { ocupado.current = false; }, 300); }
  };
  procesarRef.current = procesar;

  // Pendientes: se comprueban solos en cuanto hay conexión (con el MISMO id: nunca cuentan dos veces)
  useEffect(() => {
    const ciclo = async () => {
      if (subiendo.current || !navigator.onLine) return;
      const q = leer(kPend, []); if (!q.length) return;
      subiendo.current = true;
      try {
        for (const it of q) {
          const r = await preguntar(it.hex, it.id);
          if (r === null) break;
          if (r?.motivo === "bloqueada" || r?.motivo === "sesion") { tratar(r); break; }
          ponerPend(leer(kPend, []).filter(x => x.id !== it.id));
          const x = tratar(r);
          if (x) mostrar({ ...x, comprobado: true });
          await new Promise(ok => setTimeout(ok, 1800));   // que se vea cada resultado
        }
      } finally { subiendo.current = false; }
    };
    ciclo();
    const t = setInterval(ciclo, 4000);
    window.addEventListener("online", ciclo);
    return () => { clearInterval(t); window.removeEventListener("online", ciclo); };
  }, []);

  const totalUds = (panel?.resumen || []).reduce((a, x) => a + (x.unidades || 0), 0);
  const totalNeto = (panel?.resumen || []).reduce((a, x) => a + Number(x.neto || 0), 0);
  const color = panel?.puesto?.color || portada?.color || "#ff5a3c";
  const exp = res && res.tipo === "mal" ? (mostrador ? explicarCliente(res) : explicar(res)) : null;
  const fondo = res ? (res.tipo === "ok" ? "rgba(15,157,99,.94)" : res.tipo === "pend" ? "rgba(36,52,92,.97)" : "rgba(198,40,40,.96)") : null;

  return (
    <div style={V.wrap}>
      {mostrador ? <header style={{ ...V.top, borderTop: `4px solid ${color}` }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: 18, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{panel?.puesto?.nombre || portada?.puesto || "Puesto"}</div>
          <div style={{ fontSize: 12.5, color: "rgba(255,255,255,.7)" }}>Acerca tu ticket a la pantalla</div>
        </div>
        {!online && <span style={{ ...V.pill, background: "rgba(255,77,77,.2)", color: "#ff8a80" }}>Sin conexión</span>}
        <button onClick={() => setSalirMostrador(true)} aria-label="Salir del modo mostrador (pide el PIN)" style={{ ...V.btnTop, padding: "0 10px", fontSize: 13 }}>🔒 Salir</button>
      </header> : <header style={{ ...V.top, borderTop: `4px solid ${color}` }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: 16, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{panel?.puesto?.nombre || portada?.puesto || "Puesto"}</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,.65)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{panel?.evento?.nombre || portada?.evento || ""}</div>
        </div>
        <span style={{ ...V.pill, background: online ? (pend.length ? "rgba(255,180,0,.2)" : "rgba(34,211,166,.16)") : "rgba(255,77,77,.2)", color: online && !pend.length ? "#5ee6bd" : online ? "#ffcf5a" : "#ff8a80" }}>
          <span style={{ width: 8, height: 8, borderRadius: 8, background: online && !pend.length ? "#22d3a6" : online ? "#ffb400" : "#ff4d4d" }} />
          {online ? (pend.length ? `${pend.length} por comprobar` : "En línea") : "Sin conexión"}
        </span>
        {!mostrador && cam.empezado && !cam.camErr && <button onClick={cam.cambiarCamara} aria-label={cam.camara === "user" ? "Usar la cámara trasera" : "Usar la cámara delantera (modo mostrador)"} title="Cambiar de cámara" style={V.btnTop}>🔄</button>}
        <button onClick={entrarMostrador} aria-label="Modo mostrador: de cara al público, sin datos" title="Modo mostrador" style={{ ...V.btnTop, padding: "0 10px", fontSize: 13 }}>Mostrador</button>
        <button onClick={() => { snd.activar(); snd.alternarMudo(); }} aria-pressed={snd.mudo} aria-label={snd.mudo ? "Activar el sonido" : "Silenciar"} style={{ ...V.btnTop, ...(snd.mudo ? { color: "#ff8a80", borderColor: "rgba(255,77,77,.6)" } : {}) }}>{snd.mudo ? "🔇" : "🔊"}</button>
      </header>}

      {!mostrador && pend.length > 0 && <div role="alert" style={V.bandaPend}>⏳ {pend.length === 1 ? "1 ticket pendiente" : `${pend.length} tickets pendientes`} de comprobar: <b>no los entregues todavía</b>. Se comprueban solos al volver internet.</div>}

      <div style={V.cam}>
        <video ref={cam.video} muted playsInline style={{ ...V.video, transform: cam.camara === "user" ? "scaleX(-1)" : "none" }} />
        {!cam.empezado && <div style={V.centro}>
          <div style={{ fontSize: 46, marginBottom: 10 }}>📷</div>
          <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 6 }}>Escanea el QR de cada ticket</div>
          {mostrador ? <div style={{ height: 14 }} /> : <div style={{ fontSize: 14, color: "rgba(255,255,255,.72)", maxWidth: 330, margin: "0 auto 20px", lineHeight: 1.45 }}>Verde: entrega. Rojo: no entregues. Azul: sin conexión, espera a que se compruebe. Si el cliente te da varios tickets, escanéalos seguidos: arriba verás el pedido completo.{panel?.acepta?.length ? <><br /><br />Aquí se canjea: <b style={{ color: "#fff" }}>{panel.acepta.map(x => x.charAt(0).toUpperCase() + x.slice(1)).join(", ")}</b></> : null}</div>}
          <button onClick={cam.arrancar} style={V.btnGrande}>Empezar a escanear</button>
        </div>}
        {cam.empezado && cam.camErr && <div style={V.centro}>
          <div style={{ fontSize: 42, marginBottom: 8 }}>🚫</div>
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 6 }}>{cam.camErr === "permiso" ? "Falta el permiso de la cámara" : "No se pudo abrir la cámara"}</div>
          <div style={{ fontSize: 13.5, color: "rgba(255,255,255,.72)", maxWidth: 340, margin: "0 auto 18px", lineHeight: 1.45 }}>{cam.camErr === "permiso" ? "Permite la cámara para esta web. En iPhone: Ajustes › Safari › Cámara › Permitir." : "Ábrelo en Chrome (Android) o Safari (iPhone)."}</div>
          <button onClick={cam.arrancar} style={V.btnGrande}>Reintentar</button>
        </div>}
        {cam.empezado && !cam.camErr && <><div style={V.marco} /><div style={V.pista}>Acerca el QR del ticket al recuadro</div></>}
        {!mostrador && pedido && <div role="status" aria-live="polite" style={V.pedido}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 800, opacity: .8 }}>PEDIDO · ENTREGA</div>
            <div style={{ fontSize: 20, fontWeight: 900, lineHeight: 1.2 }}>{Object.entries(pedido.items).map(([n, c]) => `${c} × ${n}`).join(" · ")}</div>
          </div>
          <button onClick={cerrarPedido} style={V.btnListo}>Listo ✓</button>
        </div>}
        {comprobando && !res && <div style={V.comprobando} role="status">Comprobando…</div>}
        {res && <button onClick={() => { clearTimeout(timerRes.current); setRes(null); }} style={{ ...V.res, background: fondo }} aria-live="assertive">
          {res.tipo === "ok" && <>
            {res.comprobado && <div style={V.etq}>Comprobado al volver la conexión</div>}
            <div style={{ fontSize: mostrador ? 30 : 20, fontWeight: 900, letterSpacing: 2, marginTop: 8 }}>{mostrador ? "✓ CORRECTO" : "ENTREGA"}</div>
            <div style={{ fontSize: (n => n <= 7 ? 60 : n <= 10 ? 48 : n <= 14 ? 40 : 32)(limpio(res.nombre).length), fontWeight: 900, lineHeight: 1.05, margin: "8px 0", overflowWrap: "break-word", maxWidth: "100%" }}>{limpio(res.nombre) || "1 UNIDAD"}</div>
            {res.unidades > 1 && <div style={{ fontSize: 30, fontWeight: 900 }}>× {res.unidades}</div>}
            {!mostrador && pedido?.total > 1 && <div style={V.etq}>Pedido: {pedido.total} en total</div>}
          </>}
          {res.tipo === "pend" && <>
            <div style={{ fontSize: 46 }}>⏳</div>
            {mostrador ? <>
              <div style={{ fontSize: 30, fontWeight: 900, lineHeight: 1.1, margin: "8px 0" }}>UN MOMENTO</div>
              <div style={{ fontSize: 17, fontWeight: 600, maxWidth: 420, lineHeight: 1.4 }}>Estamos comprobando tu ticket. Espera un momento, por favor.</div>
            </> : <>
              <div style={{ fontSize: 30, fontWeight: 900, lineHeight: 1.1, margin: "8px 0" }}>SIN CONEXIÓN<br />NO ENTREGUES TODAVÍA</div>
              <div style={{ fontSize: 17, fontWeight: 600, maxWidth: 420, lineHeight: 1.4 }}>{res.repetido ? "Este ticket ya está esperando a comprobarse." : "Lo comprobamos solo en cuanto vuelva internet. Pide al cliente que espere un momento."}</div>
            </>}
          </>}
          {res.tipo === "mal" && <>
            {res.comprobado && <div style={V.etq}>Comprobado al volver la conexión</div>}
            <div style={{ fontSize: 38, fontWeight: 900, lineHeight: 1.05, margin: "8px 0 12px" }}>{exp.t}</div>
            <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.4, maxWidth: 440 }}>{exp.d}</div>
          </>}
          {!mostrador && <div style={{ position: "absolute", bottom: 18, left: 0, right: 0, fontSize: 14, fontWeight: 700, opacity: .85 }}>Escanea el siguiente: la cámara sigue activa</div>}
        </button>}
      </div>

      {mostrador && salirMostrador && <div style={V.hojaWrap}>
        <div role="dialog" aria-modal="true" aria-label="Salir del modo mostrador" style={{ ...V.hoja, padding: "18px 12px calc(16px + env(safe-area-inset-bottom))", textAlign: "center" }}>
          <PinPad compacto titulo="PIN del puesto para salir" sub="Solo el personal del puesto" onPin={(pin) => desbloquearConPin(sesion, pin, () => dejarMostrador(), onSalir)} />
          <button onClick={() => setSalirMostrador(false)} style={{ ...V.btn, width: "100%", marginTop: 14 }}>Cancelar</button>
        </div>
      </div>}
      {!mostrador && <div style={V.pie}>
        <button onClick={() => { setVerVentas(true); cargarPanel(); }} style={V.resumen}>
          <span style={{ textAlign: "left" }}><span style={{ display: "block", fontSize: 12, color: "rgba(255,255,255,.65)", fontWeight: 700 }}>ENTREGADAS</span><b style={{ fontSize: 24 }}>{panel ? totalUds : "…"}</b></span>
          <span style={{ textAlign: "right" }}><span style={{ display: "block", fontSize: 12, color: "rgba(255,255,255,.65)", fontWeight: 700 }}>TU FACTURACIÓN</span><b style={{ fontSize: 24, color: "#5ee6bd" }}>{panel ? eur(totalNeto) : "…"}</b></span>
          <span aria-hidden="true" style={{ fontSize: 13, color: "rgba(255,255,255,.7)" }}>Ver ›</span>
        </button>
        <div style={{ display: "flex", gap: 6, overflowX: "auto", marginTop: 8, paddingBottom: 2 }}>
          {hist.slice(0, 10).map((h, i) => <div key={i} style={{ ...V.chip, borderColor: h.tipo === "ok" ? "rgba(34,211,166,.5)" : h.tipo === "pend" ? "rgba(96,165,250,.6)" : "rgba(255,77,77,.55)" }}>
            <span style={{ whiteSpace: "nowrap", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" }}>{h.titulo}</span><span style={{ opacity: .6 }}>{hora(h.t)}</span></div>)}
        </div>
      </div>}

      {!mostrador && verVentas && <Ventas panel={panel} onCerrar={() => setVerVentas(false)} onSalir={async () => {
        if (!window.confirm("¿Desvincular este móvil del puesto? Para volver a usarlo hará falta un código de activación de la organización.")) return;
        try { await supabase.rpc("puesto_salir", { p_sesion: sesion }); } catch {}
        onSalir(null);
      }} />}
    </div>
  );
}

function Ventas({ panel, onCerrar, onSalir }) {
  const res = panel?.resumen || [];
  const neto = res.reduce((a, x) => a + Number(x.neto || 0), 0), valor = res.reduce((a, x) => a + Number(x.valor || 0), 0);
  return (<div style={V.hojaWrap} onClick={onCerrar}>
    <div role="dialog" aria-modal="true" aria-label="Mis ventas" onClick={e => e.stopPropagation()} style={V.hoja}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 16px 10px" }}>
        <div style={{ flex: 1 }}><div style={{ fontWeight: 900, fontSize: 19 }}>Mis ventas</div><div style={{ fontSize: 12.5, color: "rgba(255,255,255,.6)" }}>En tiempo real · facturación con la comisión de la organización ya quitada</div></div>
        <button onClick={onCerrar} style={V.btnTop} aria-label="Cerrar">✕</button>
      </div>
      <div data-scroll style={{ flex: 1, overflow: "auto", overscrollBehavior: "contain", padding: "0 16px 12px" }}>
        {!panel && <div style={{ color: "rgba(255,255,255,.6)" }}>Cargando…</div>}
        {panel && <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div style={V.tile}><div style={V.tileT}>Entregadas</div><b style={{ fontSize: 26 }}>{res.reduce((a, x) => a + x.unidades, 0)}</b></div>
            <div style={V.tile}><div style={V.tileT}>Tu facturación</div><b style={{ fontSize: 26, color: "#5ee6bd" }}>{eur(neto)}</b><div style={{ fontSize: 11.5, color: "rgba(255,255,255,.55)" }}>de {eur(valor)} vendidos</div></div>
          </div>
          <div style={{ fontWeight: 800, margin: "16px 0 6px" }}>Por producto</div>
          {!res.length && <div style={{ color: "rgba(255,255,255,.6)", fontSize: 14 }}>Aún no has entregado nada.</div>}
          {res.map((x, i) => <div key={i} style={{ display: "flex", gap: 10, padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,.08)" }}>
            <span style={{ flex: 1, minWidth: 0 }}><b>{limpio(x.nombre)}</b><span style={{ display: "block", fontSize: 12.5, color: "rgba(255,255,255,.6)" }}>{x.unidades} {x.unidades === 1 ? "unidad" : "unidades"}</span></span>
            <b style={{ color: "#5ee6bd" }}>{eur(x.neto)}</b></div>)}
          <div style={{ fontWeight: 800, margin: "16px 0 6px" }}>Historial</div>
          {(panel.historial || []).map((h, i) => <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,.06)", fontSize: 14 }}>
            <span style={{ color: "rgba(255,255,255,.6)", fontVariantNumeric: "tabular-nums" }}>{horaExacta(h.t)}</span>
            <span style={{ flex: 1, minWidth: 0 }}>{limpio(h.nombre)}{h.unidades > 1 ? ` ×${h.unidades}` : ""}</span>
            <span style={{ fontWeight: 800 }}>{eur(h.neto)}</span></div>)}
          {panel.rechazos > 0 && <div style={{ fontSize: 12.5, color: "rgba(255,255,255,.55)", marginTop: 10 }}>{panel.rechazos} {panel.rechazos === 1 ? "ticket rechazado" : "tickets rechazados"} (no cuentan).</div>}
        </>}
      </div>
      <div style={{ padding: "10px 16px calc(12px + env(safe-area-inset-bottom))", borderTop: "1px solid rgba(255,255,255,.08)", display: "flex", gap: 8 }}>
        <button onClick={onSalir} style={{ ...V.btn, flex: 1, color: "#ff8a80" }}>Desvincular este móvil</button>
        <button onClick={onCerrar} style={{ ...V.btnGrande, flex: 2, padding: 14 }}>Seguir escaneando</button>
      </div>
    </div>
  </div>);
}

const V = {
  wrap: { position: "fixed", inset: 0, background: "#05060a", color: "#fff", display: "flex", flexDirection: "column", fontFamily: "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" },
  top: { display: "flex", alignItems: "center", gap: 8, padding: "calc(10px + env(safe-area-inset-top)) 12px 10px", background: "#0b0c10", borderBottom: "1px solid rgba(255,255,255,.08)" },
  pill: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, padding: "6px 10px", borderRadius: 20, whiteSpace: "nowrap", flexShrink: 0 },
  btnTop: { minWidth: 44, minHeight: 44, background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,.2)", borderRadius: 12, fontWeight: 700, fontSize: 16, cursor: "pointer", flexShrink: 0 },
  bandaPend: { background: "#ffb400", color: "#1a1300", padding: "8px 12px", fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 },
  cam: { position: "relative", flex: 1, overflow: "hidden", background: "#000" },
  video: { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" },
  centro: { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24, background: "radial-gradient(circle at 50% 40%, #151826, #05060a 70%)" },
  btnGrande: { background: "linear-gradient(160deg,#ff6a3d,#ff3d2e)", color: "#fff", border: 0, borderRadius: 14, padding: "16px 26px", fontWeight: 800, fontSize: 17, cursor: "pointer", fontFamily: "inherit", minHeight: 50 },
  marco: { position: "absolute", left: "50%", top: "46%", width: "min(64vw, 300px)", height: "min(64vw, 300px)", transform: "translate(-50%,-50%)", border: "4px solid rgba(255,255,255,.85)", borderRadius: 18, pointerEvents: "none" },
  pista: { position: "absolute", left: 0, right: 0, bottom: 18, textAlign: "center", fontSize: 14, fontWeight: 700, textShadow: "0 1px 4px rgba(0,0,0,.8)" },
  pedido: { position: "absolute", left: 10, right: 10, top: 10, zIndex: 2, display: "flex", alignItems: "center", gap: 10, padding: "10px 10px 10px 14px", borderRadius: 16, background: "rgba(15,157,99,.95)", color: "#fff", boxShadow: "0 8px 24px rgba(0,0,0,.4)" },
  btnListo: { minHeight: 48, padding: "0 16px", borderRadius: 12, border: "2px solid rgba(255,255,255,.85)", background: "transparent", color: "#fff", fontWeight: 900, fontSize: 16, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 },
  comprobando: { position: "absolute", left: "50%", top: 16, transform: "translateX(-50%)", background: "rgba(0,0,0,.7)", borderRadius: 20, padding: "8px 16px", fontSize: 15, fontWeight: 800 },
  res: { position: "absolute", inset: 0, border: 0, color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "24px 22px", cursor: "pointer", fontFamily: "inherit" },
  etq: { background: "rgba(0,0,0,.25)", borderRadius: 20, padding: "6px 14px", fontSize: 14, fontWeight: 700 },
  pie: { padding: "10px 12px calc(10px + env(safe-area-inset-bottom))", background: "#0b0c10", borderTop: "1px solid rgba(255,255,255,.08)" },
  resumen: { display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 60, padding: "8px 12px", borderRadius: 14, border: "1px solid rgba(255,255,255,.14)", background: "rgba(255,255,255,.05)", color: "#fff", cursor: "pointer", fontFamily: "inherit", justifyContent: "space-between" },
  chip: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "6px 10px", borderRadius: 20, border: "1px solid", background: "rgba(255,255,255,.04)", flexShrink: 0 },
  btn: { minHeight: 48, background: "rgba(255,255,255,.06)", color: "#fff", border: "1px solid rgba(255,255,255,.16)", borderRadius: 12, padding: "12px 10px", fontWeight: 700, fontSize: 14.5, cursor: "pointer", fontFamily: "inherit" },
  hojaWrap: { position: "fixed", inset: 0, zIndex: 5, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "flex-end", justifyContent: "center" },
  hoja: { width: "100%", maxWidth: 560, maxHeight: "92dvh", display: "flex", flexDirection: "column", background: "#12141b", borderRadius: "20px 20px 0 0", border: "1px solid rgba(255,255,255,.1)", boxSizing: "border-box" },
  tile: { background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 14, padding: 12 },
  tileT: { fontSize: 11.5, fontWeight: 800, color: "rgba(255,255,255,.6)", textTransform: "uppercase", letterSpacing: .5 },
};

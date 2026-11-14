// ===================== PORTAL DEL RRPP CON CUENTA =====================
// /rp                  → entrar o crear la cuenta de RRPP; después, su panel.
// /rp/unirse/<token>   → enlace de un organizador para pedir ser su RRPP.
// Una cuenta sirve para colaborar con muchos organizadores: el panel muestra todos los eventos
// (cada uno con su enlace y su QR), todas las ventas y un único monedero.
// El dinero aún no se mueve por la app: el organizador liquida (Bizum, transferencia o efectivo) y queda apuntado.
import React, { useEffect, useState } from "react";
import { sbRRPP } from "./supabaseRRPP";
import QrCodigo from "../qr/QrCodigo";
import { eur, card, btn, Mensaje, Campo, Check, lbl, inpP, CSS_PUB } from "./comun";
import { T, ORIGEN, enlaceDe, compartirEvento, TarjetaEvento, Ventas, VentaEfectivo, Hoja, Dato } from "./PanelRRPP";

const n2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const suma = (xs, k) => n2(xs.reduce((s, x) => s + Number(x[k] || 0), 0));
const ERR_PERFIL = {
  nombre: "Escribe tu nombre de RRPP.", nombre_completo: "Escribe tu nombre y apellidos.", telefono: "Revisa el teléfono.",
  nif: "Revisa el DNI / NIF (o déjalo vacío).", iban: "Revisa el IBAN.", condiciones: "Tienes que aceptar las condiciones.", sesion: "Tu sesión ha caducado: vuelve a entrar.",
};

function Marco({ children, ancho = 640 }) {
  return (
    <div style={{ ...T.vars, minHeight: "100dvh", background: "var(--bg)", color: "var(--text)", fontFamily: T.letra }}>
      <style>{CSS_PUB}</style>
      <div style={{ maxWidth: ancho, margin: "0 auto", padding: "18px 16px calc(40px + env(safe-area-inset-bottom))" }}>{children}</div>
    </div>
  );
}

const Opciones = ({ valor, on, opciones, etiqueta }) => (
  <div role="radiogroup" aria-label={etiqueta} style={{ display: "flex", gap: 6, background: "var(--card2)", border: "1px solid var(--line)", borderRadius: 14, padding: 4, marginBottom: 12 }}>
    {opciones.map(([k, t]) => (
      <button key={k} type="button" role="radio" aria-checked={valor === k} onClick={() => on(k)} style={{ flex: 1, border: "none", borderRadius: 10, padding: "11px 6px", fontWeight: 900, fontSize: 14.5, cursor: "pointer", fontFamily: "inherit", background: valor === k ? "var(--c)" : "transparent", color: valor === k ? T.tinta : "var(--text)" }}>{t}</button>))}
  </div>
);

export default function CuentaRRPP({ token }) {
  const [sesion, setSesion] = useState(undefined);
  const [info, setInfo] = useState(token ? undefined : null);   // organizador del enlace de captación
  useEffect(() => {
    document.title = "TIXFAST · RRPP";
    sbRRPP.auth.getSession().then(({ data }) => setSesion(data?.session || null)).catch(() => setSesion(null));
    const { data: sub } = sbRRPP.auth.onAuthStateChange((_e, s) => setSesion(s || null));
    return () => sub.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!token) return;
    sbRRPP.rpc("rrpp_captacion_info", { p_token: token }).then(({ data, error }) => setInfo(error ? "error" : data || false)).catch(() => setInfo("error"));
  }, [token]);

  if (sesion === undefined || info === undefined) return <Mensaje titulo="Cargando…" />;
  if (token && info === false) return <Mensaje titulo="Enlace no válido" texto="Este enlace para RRPP ya no funciona. Pide al organizador uno nuevo."><a href="/rp" style={{ ...btn("#ff5a3c", "#fff"), marginTop: 16, textDecoration: "none" }}>Ir a mi cuenta de RRPP</a></Mensaje>;
  if (!sesion) return <Acceso info={info && info !== "error" ? info : null} />;
  return <Portal key={sesion.user.id} token={token} info={info && info !== "error" ? info : null} email={sesion.user.email} />;
}

/* ---------- Entrar o crear la cuenta ---------- */
function Acceso({ info }) {
  const [modo, setModo] = useState(info ? "alta" : "entrar");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [ver, setVer] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const entrar = async (mail) => {
    const { error } = await sbRRPP.auth.signInWithPassword({ email: mail, password: pass });
    if (error) setErr(/invalid/i.test(error.message) ? "Correo o contraseña incorrectos." : navigator.onLine ? "No se ha podido entrar. Inténtalo de nuevo." : "Sin conexión.");
  };
  const enviar = async (e) => {
    e.preventDefault(); setErr("");
    const mail = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return setErr("Revisa el correo.");
    if (pass.length < 8) return setErr("La contraseña debe tener al menos 8 caracteres.");
    setBusy(true);
    try {
      if (modo === "alta") {
        const { data, error } = await sbRRPP.functions.invoke("rrpp-registro", { body: { email: mail, password: pass } });
        if (error || !data?.ok) {
          const m = data?.motivo;
          if (m === "existe") { setModo("entrar"); setErr("Ya hay una cuenta con ese correo. Entra con tu contraseña."); }
          else setErr(m === "limite" ? "Demasiadas cuentas creadas desde esta conexión. Prueba dentro de un rato." : m === "email" ? "Revisa el correo." : m === "password" ? "Elige una contraseña más segura (8 caracteres o más)." : "No se ha podido crear la cuenta. Inténtalo de nuevo.");
          setBusy(false); return;
        }
      }
      await entrar(mail);
    } catch { setErr(navigator.onLine ? "No se ha podido conectar. Inténtalo de nuevo." : "Sin conexión."); }
    setBusy(false);
  };
  return (
    <Marco ancho={480}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
        <img src="/brand/tixfast_isotipo_app.svg" alt="" width="36" height="36" />
        <b style={{ fontSize: 17 }}>TIXFAST · RRPP</b>
      </div>
      {info ? <div style={{ ...card, marginBottom: 16, display: "flex", gap: 12, alignItems: "center" }}>
        {info.logo ? <img src={info.logo} alt="" width="52" height="52" style={{ borderRadius: 12, objectFit: "cover", flexShrink: 0 }} /> : null}
        <div><div style={{ fontWeight: 900, fontSize: 19, lineHeight: 1.2 }}>{info.organizador} quiere que seas su RRPP</div>
          <div style={{ color: "var(--muted)", fontSize: 14, marginTop: 4 }}>Crea tu cuenta (o entra si ya la tienes) y envíale tu solicitud. Con la misma cuenta puedes ser RRPP de varios organizadores.</div></div>
      </div> : <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 28, lineHeight: 1.1, margin: "0 0 8px", fontWeight: 900 }}>Tu panel de RRPP</h1>
        <div style={{ color: "var(--muted)", fontSize: 15 }}>Todos tus eventos con su enlace de venta, tus ventas en directo y tu monedero. Una sola cuenta para todos los organizadores.</div>
      </div>}
      <Opciones etiqueta="Acceso" valor={modo} on={(m) => { setModo(m); setErr(""); }} opciones={[["alta", "Crear cuenta"], ["entrar", "Ya tengo cuenta"]]} />
      <form onSubmit={enviar} noValidate style={card}>
        <Campo l="Correo electrónico" v={email} on={setEmail} type="email" ac="email" im="email" />
        <label style={lbl}><span>Contraseña{modo === "alta" ? " (8 caracteres o más)" : ""}</span>
          <div style={{ position: "relative" }}>
            <input type={ver ? "text" : "password"} value={pass} onChange={e => setPass(e.target.value)} autoComplete={modo === "alta" ? "new-password" : "current-password"} style={{ ...inpP, paddingRight: 84 }} />
            <button type="button" onClick={() => setVer(v => !v)} style={{ position: "absolute", right: 6, top: 6, bottom: 6, border: "none", borderRadius: 9, background: "transparent", color: "var(--muted)", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{ver ? "Ocultar" : "Mostrar"}</button>
          </div>
        </label>
        {err && <div role="alert" style={{ background: "#c62828", color: "#fff", borderRadius: 12, padding: "12px 14px", fontWeight: 800, marginBottom: 12 }}>{err}</div>}
        <button type="submit" disabled={busy} style={{ ...btn("var(--c)", T.tinta), width: "100%", padding: 16, opacity: busy ? .6 : 1 }}>{busy ? "Un momento…" : modo === "alta" ? "Crear mi cuenta" : "Entrar"}</button>
        <div style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 10, lineHeight: 1.45 }}>
          {modo === "alta" ? "Guarda bien tu contraseña: por ahora no se puede recuperar por correo." : "¿No recuerdas la contraseña? Por ahora no se puede recuperar por correo: escribe a TIXFAST."}
        </div>
      </form>
    </Marco>
  );
}

/* ---------- Ya dentro ---------- */
function Portal({ token, info, email }) {
  const [d, setD] = useState(undefined);
  const [unirse, setUnirse] = useState(!!token);
  const cargar = async () => {
    try {
      const { data, error } = await sbRRPP.rpc("rrpp_mi_panel");
      if (error) { if (/jwt|auth/i.test(error.message)) { await sbRRPP.auth.signOut(); return; } throw error; }
      setD(data || { perfil: null });
    } catch { setD(x => (x === undefined ? "error" : x)); }
  };
  useEffect(() => {
    cargar();
    const t = setInterval(() => { if (document.visibilityState !== "hidden") cargar(); }, 30000);
    return () => clearInterval(t);
  }, []);
  const terminarUnirse = () => { setUnirse(false); try { window.history.replaceState(null, "", "/rp"); } catch {} cargar(); };

  if (d === undefined) return <Mensaje titulo="Cargando tu panel…" />;
  if (d === "error") return <Mensaje titulo="No se ha podido cargar" texto="Revisa tu conexión."><button onClick={() => { setD(undefined); cargar(); }} style={{ ...btn("#ff5a3c", "#fff"), marginTop: 16 }}>Reintentar</button></Mensaje>;
  if (!d.perfil) return (
    <Marco>
      <Cabecera titulo="Crea tu perfil de RRPP" sub={info ? `Después enviamos tu solicitud a ${info.organizador}.` : "Lo verán los organizadores con los que colabores, para pagarte."} />
      <FormPerfil email={email} onGuardado={() => cargar()} />
    </Marco>
  );
  if (unirse && info) return <Unirse info={info} token={token} perfil={d.perfil} onFin={terminarUnirse} />;
  return <Panel d={d} cargar={cargar} email={email} />;
}

const Cabecera = ({ titulo, sub, derecha }) => (
  <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
    <img src="/brand/tixfast_isotipo_app.svg" alt="" width="40" height="40" />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontWeight: 900, fontSize: 20, lineHeight: 1.15 }}>{titulo}</div>
      {sub && <div style={{ color: "var(--muted)", fontSize: 13.5, fontWeight: 700 }}>{sub}</div>}
    </div>
    {derecha}
  </header>
);

/* ---------- Perfil: quién es y dónde cobra ---------- */
function FormPerfil({ perfil, email, onGuardado, onSalir }) {
  const p0 = perfil || {};
  const [f, setF] = useState({
    nombre: p0.nombre || "", nombre_completo: p0.nombre_completo || "", telefono: p0.telefono || "", ciudad: p0.ciudad || "", instagram: p0.instagram || "",
    cobro: p0.cobro || "bizum", cobro_bizum: p0.cobro_bizum || "", cobro_iban: p0.cobro_iban || "", cobro_titular: p0.cobro_titular || "",
    fiscal: p0.fiscal || "particular", nif: p0.nif || "", acepta: !!perfil,
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF(x => ({ ...x, [k]: v }));
  const guardar = async (e) => {
    e.preventDefault(); setErr("");
    if (f.nombre.trim().length < 2) return setErr(ERR_PERFIL.nombre);
    if (f.nombre_completo.trim().length < 3) return setErr(ERR_PERFIL.nombre_completo);
    if (f.telefono.replace(/\D/g, "").length < 9) return setErr(ERR_PERFIL.telefono);
    if (f.cobro === "transferencia" && f.cobro_iban.replace(/\s/g, "").length < 15) return setErr(ERR_PERFIL.iban);
    if (!f.acepta) return setErr(ERR_PERFIL.condiciones);
    setBusy(true);
    try {
      const { data, error } = await sbRRPP.rpc("rrpp_guardar_perfil", { p: { ...f, cobro_bizum: f.cobro === "bizum" ? (f.cobro_bizum.trim() || f.telefono.trim()) : f.cobro_bizum, acepta_condiciones: f.acepta } });
      if (error) throw error;
      if (!data?.ok) { setErr(ERR_PERFIL[data?.motivo] || "No se ha podido guardar."); setBusy(false); return; }
      onGuardado(data.perfil);
    } catch { setErr(navigator.onLine ? "No se ha podido guardar. Inténtalo de nuevo." : "Sin conexión."); }
    setBusy(false);
  };
  const titulo = (t) => <div style={{ fontWeight: 900, fontSize: 15, color: "var(--c)", margin: "6px 0 10px" }}>{t}</div>;
  return (
    <form onSubmit={guardar} noValidate>
      <div style={{ ...card, marginBottom: 12 }}>
        {titulo("Quién eres")}
        <Campo l="Tu nombre de RRPP *" v={f.nombre} on={set("nombre")} ac="nickname" sub="Como te conocen. Sale en tu código de venta." />
        <Campo l="Nombre y apellidos *" v={f.nombre_completo} on={set("nombre_completo")} ac="name" />
        <Campo l="Teléfono *" v={f.telefono} on={set("telefono")} type="tel" ac="tel" im="tel" />
        <Campo l="Ciudad" v={f.ciudad} on={set("ciudad")} ac="address-level2" />
        <Campo l="Instagram" v={f.instagram} on={set("instagram")} ac="off" sub="Opcional. Ej.: @tunombre" />
        <div style={{ color: "var(--muted)", fontSize: 13 }}>Correo de la cuenta: <b style={{ color: "var(--text)" }}>{email}</b></div>
      </div>
      <div style={{ ...card, marginBottom: 12 }}>
        {titulo("Dónde quieres cobrar")}
        <Opciones etiqueta="Cómo cobras" valor={f.cobro} on={set("cobro")} opciones={[["bizum", "Bizum"], ["transferencia", "Transferencia"]]} />
        {f.cobro === "bizum"
          ? <Campo l="Teléfono de Bizum" v={f.cobro_bizum} on={set("cobro_bizum")} type="tel" ac="tel" im="tel" sub="Si lo dejas vacío, usamos tu teléfono." />
          : <><Campo l="IBAN *" v={f.cobro_iban} on={set("cobro_iban")} ac="off" sub="ES00 0000 0000 0000 0000 0000" />
              <Campo l="Titular de la cuenta" v={f.cobro_titular} on={set("cobro_titular")} ac="name" /></>}
        {titulo("Datos fiscales")}
        <Opciones etiqueta="Tipo" valor={f.fiscal} on={set("fiscal")} opciones={[["particular", "Particular"], ["autonomo", "Autónomo"], ["empresa", "Empresa"]]} />
        <Campo l="DNI / NIF" v={f.nif} on={set("nif")} ac="off" sub="Opcional por ahora. Hará falta para cobrar por la app más adelante." />
      </div>
      <div style={{ ...card, marginBottom: 12 }}>
        <Check v={f.acepta} on={set("acepta")}>Acepto que los organizadores con los que colabore vean estos datos para pagarme mis comisiones, y las condiciones de RRPP de TIXFAST.</Check>
      </div>
      {err && <div role="alert" style={{ background: "#c62828", color: "#fff", borderRadius: 12, padding: "12px 14px", fontWeight: 800, marginBottom: 12 }}>{err}</div>}
      <button type="submit" disabled={busy} style={{ ...btn("var(--c)", T.tinta), width: "100%", padding: 16, opacity: busy ? .6 : 1 }}>{busy ? "Guardando…" : perfil ? "Guardar cambios" : "Guardar y continuar"}</button>
      {onSalir && <button type="button" onClick={onSalir} style={{ ...btn("transparent", "#ff6b6b"), width: "100%", marginTop: 10, border: "1px solid rgba(255,107,107,.5)" }}>Cerrar sesión</button>}
    </form>
  );
}

/* ---------- Pedir colaborar con un organizador ---------- */
function Unirse({ info, token, perfil, onFin }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const enviar = async () => {
    setBusy(true);
    try {
      const { data, error } = await sbRRPP.rpc("rrpp_solicitar", { p_token: token, p_mensaje: msg.trim() || null });
      if (error) throw error;
      setRes(data?.ok ? data.estado : data?.motivo === "propio" ? "propio" : data?.motivo === "codigo_ocupado" ? "codigo" : "error");
    } catch { setRes("error"); }
    setBusy(false);
  };
  const textos = {
    solicitada: ["Solicitud enviada", `${info.organizador} tiene que aceptarte. Cuando lo haga, sus eventos aparecerán en tu panel con tu enlace.`],
    activa: ["Ya eres RRPP de " + info.organizador, "Sus eventos están en tu panel."],
    pausada: ["Tu colaboración está en pausa", `${info.organizador} la ha pausado. Habla con él para reactivarla.`],
    propio: ["Es tu propia organización", "No puedes ser RRPP de ti mismo."],
    codigo: ["No se ha podido enviar", "Ese organizador ya tiene un RRPP con tu código. Escríbele para que lo resuelva."],
    error: ["No se ha podido enviar", "Revisa tu conexión e inténtalo de nuevo."],
  };
  return (
    <Marco ancho={520}>
      <Cabecera titulo={`Hola, ${perfil.nombre}`} sub={`Tu código: ${perfil.codigo}`} />
      {res ? <div style={{ ...card, textAlign: "center" }}>
        <div style={{ fontWeight: 900, fontSize: 21 }}>{textos[res][0]}</div>
        <div style={{ color: "var(--muted)", marginTop: 6 }}>{textos[res][1]}</div>
        {res === "error" ? <button onClick={() => setRes(null)} style={{ ...btn("var(--card2)", "var(--text)"), width: "100%", marginTop: 16, border: "1px solid var(--line)" }}>Volver</button>
          : <button onClick={onFin} style={{ ...btn("var(--c)", T.tinta), width: "100%", marginTop: 16 }}>Ir a mi panel</button>}
      </div> : <div style={card}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
          {info.logo ? <img src={info.logo} alt="" width="52" height="52" style={{ borderRadius: 12, objectFit: "cover" }} /> : null}
          <div><div style={{ fontWeight: 900, fontSize: 19 }}>Ser RRPP de {info.organizador}</div>
            <div style={{ color: "var(--muted)", fontSize: 14 }}>{info.eventos ? `${info.eventos} ${info.eventos === 1 ? "evento próximo" : "eventos próximos"}` : "Sin eventos publicados ahora mismo"}</div></div>
        </div>
        <div style={{ fontSize: 14.5, lineHeight: 1.5, marginBottom: 12 }}>Le llegará tu perfil: nombre, teléfono y dónde cobras. Si te acepta, verás sus eventos con tu enlace de venta.</div>
        <label style={lbl}><span>Mensaje (opcional)</span>
          <textarea value={msg} maxLength={300} onChange={e => setMsg(e.target.value)} rows={3} placeholder="Ej.: Soy Nico, muevo grupos de la uni" style={{ ...inpP, resize: "vertical" }} /></label>
        <button onClick={enviar} disabled={busy} style={{ ...btn("var(--c)", T.tinta), width: "100%", padding: 16, opacity: busy ? .6 : 1 }}>{busy ? "Enviando…" : "Enviar solicitud"}</button>
        <button onClick={onFin} style={{ ...btn("transparent", "var(--muted)"), width: "100%", marginTop: 8 }}>Ahora no</button>
      </div>}
    </Marco>
  );
}

/* ---------- Panel: eventos, ventas y monedero ---------- */
function Panel({ d, cargar, email }) {
  const [vista, setVista] = useState("eventos");
  const [vender, setVender] = useState(null);
  const [qr, setQr] = useState(null);
  const [perfil, setPerfil] = useState(false);
  const [aviso, setAviso] = useState("");
  const avisar = (m) => { setAviso(m); setTimeout(() => setAviso(""), 2600); };
  const pf = d.perfil, orgs = d.organizadores || [];
  const codigo = pf.codigo;
  const eventos = orgs.flatMap(o => (o.eventos || []).map(e => ({ ...e, organizador: o.organizador })));
  const abiertos = eventos.filter(e => !e.liquidacion);
  const com = suma(abiertos, "comision_total"), ef = suma(abiertos, "efectivo_importe"), saldo = n2(com - ef);
  const cobrado = suma(d.cobros || [], "comision");
  const copiar = async (t, msg = "Enlace copiado") => { try { await navigator.clipboard.writeText(t); avisar(msg); } catch { avisar("No se ha podido copiar"); } };
  const venderRpc = (ev) => (p) => sbRRPP.rpc("rrpp_vender_cuenta", { p_rrpp: ev.rrpp, ...p });
  const anular = (pedido) => sbRRPP.rpc("rrpp_anular_cuenta", { p_pedido: pedido });
  const salir = async () => { if (window.confirm("¿Cerrar sesión en este móvil?")) await sbRRPP.auth.signOut(); };

  return (
    <Marco>
      <Cabecera titulo={`Hola, ${pf.nombre}`} sub={<>Tu código: <b style={{ color: "var(--text)", letterSpacing: 1 }}>{codigo}</b></>}
        derecha={<button onClick={() => setPerfil(true)} style={{ ...btn("var(--card2)", "var(--text)"), padding: "9px 14px", fontSize: 14, border: "1px solid var(--line)" }}>Mi perfil</button>} />

      <section aria-label="Monedero" style={{ ...card, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 800 }}>Tu monedero · {saldo < 0 ? "tienes que entregar" : "pendiente de cobrar"}</div>
            <div style={{ fontSize: 32, fontWeight: 900, letterSpacing: -.5, color: saldo < 0 ? "#ffb400" : "var(--text)" }}>{eur(Math.abs(saldo))}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 12.5, color: "var(--muted)", fontWeight: 700, lineHeight: 1.5 }}>Cobras por {pf.cobro === "transferencia" ? "transferencia" : "Bizum"}<br />{pf.cobro === "transferencia" ? `···· ${String(pf.cobro_iban || "").slice(-4)}` : pf.cobro_bizum || pf.telefono}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8, marginTop: 12 }}>
          <Dato t="Comisión pendiente" v={eur(com)} fuerte />
          <Dato t="Efectivo en tu mano" v={eur(ef)} />
          <Dato t="Ya cobrado" v={eur(cobrado)} />
        </div>
        {ef > 0 && <div style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 8 }}>El efectivo que cobraste se descuenta de tu comisión al liquidar.</div>}
      </section>

      <div role="tablist" style={{ display: "flex", gap: 6, background: "var(--card2)", border: "1px solid var(--line)", borderRadius: 14, padding: 4, marginBottom: 14 }}>
        {[["eventos", "Eventos"], ["ventas", "Ventas"], ["cobros", "Cobros"]].map(([k, t]) => (
          <button key={k} role="tab" aria-selected={vista === k} onClick={() => setVista(k)} style={{ flex: 1, border: "none", borderRadius: 10, padding: "11px 6px", fontWeight: 900, fontSize: 15, cursor: "pointer", fontFamily: "inherit", background: vista === k ? "var(--c)" : "transparent", color: vista === k ? T.tinta : "var(--text)" }}>{t}</button>))}
      </div>

      {vista === "eventos" && (orgs.length ? orgs.map(o => (
        <div key={o.rrpp} style={{ marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 2px 10px" }}>
            {o.logo ? <img src={o.logo} alt="" width="28" height="28" style={{ borderRadius: 8, objectFit: "cover" }} /> : null}
            <b style={{ fontSize: 16, flex: 1 }}>{o.organizador}</b>
            {o.estado !== "activa" && <span style={{ background: o.estado === "solicitada" ? "rgba(255,180,0,.16)" : "var(--card2)", border: "1px solid var(--line)", borderRadius: 8, padding: "3px 8px", fontSize: 12, fontWeight: 900 }}>{o.estado === "solicitada" ? "Pendiente de aceptar" : "En pausa"}</span>}
          </div>
          {o.estado === "solicitada" ? <div style={{ ...card, color: "var(--muted)", marginBottom: 14, fontSize: 14.5 }}>Has pedido ser RRPP de {o.organizador}. Cuando te acepte, aquí verás sus eventos con tu enlace.</div>
            : (o.eventos || []).length ? o.eventos.map(ev => (
              <TarjetaEvento key={ev.id} ev={ev} codigo={codigo} onCopiar={() => copiar(enlaceDe(ev, codigo))} onCompartir={() => compartirEvento(ev, codigo)} onQr={() => setQr(ev)} onVender={() => setVender(ev)} />))
            : <div style={{ ...card, color: "var(--muted)", marginBottom: 14, fontSize: 14.5 }}>{o.estado === "pausada" ? `${o.organizador} ha pausado tu colaboración.` : "No tiene eventos a la venta ahora mismo."}</div>}
        </div>))
        : <div style={{ ...card, color: "var(--muted)", textAlign: "center", lineHeight: 1.5 }}>Aún no colaboras con ningún organizador.<br />Pídele su <b style={{ color: "var(--text)" }}>enlace para RRPP</b>: al abrirlo con esta cuenta le envías tu solicitud.</div>)}

      {vista === "ventas" && <Ventas ventas={d.ventas || []} anularVenta={anular} onCambio={cargar} avisar={avisar} copiar={copiar} />}

      {vista === "cobros" && <Cobros orgs={orgs} cobros={d.cobros || []} pf={pf} onPerfil={() => setPerfil(true)} />}

      <div style={{ color: "var(--muted)", fontSize: 12.5, textAlign: "center", marginTop: 22, lineHeight: 1.5 }}>Tu código {codigo} es el mismo con todos los organizadores.<br />Cuenta: {email}</div>

      {qr && <Hoja titulo={qr.nombre} onClose={() => setQr(null)}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 16, display: "grid", placeItems: "center" }}>
          <QrCodigo texto={enlaceDe(qr, codigo)} mm={60} style={{ width: "min(70vw, 280px)", height: "auto" }} />
        </div>
        <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 14, marginTop: 12 }}>Que lo escaneen con la cámara: compran con tu código {codigo}.</div>
      </Hoja>}
      {vender && <VentaEfectivo ev={vender} vender={venderRpc(vender)} onClose={() => setVender(null)} onHecho={cargar} avisar={avisar} />}
      {perfil && <Hoja titulo="Mi perfil" onClose={() => setPerfil(false)}>
        <FormPerfil perfil={pf} email={email} onGuardado={() => { setPerfil(false); avisar("Perfil guardado"); cargar(); }} onSalir={salir} />
      </Hoja>}
      {aviso && <div role="status" style={{ position: "fixed", left: "50%", bottom: "calc(22px + env(safe-area-inset-bottom))", transform: "translateX(-50%)", background: "#15171c", color: "#fff", borderRadius: 12, padding: "11px 16px", fontWeight: 800, zIndex: 90, boxShadow: "0 10px 30px rgba(0,0,0,.4)" }}>{aviso}</div>}
    </Marco>
  );
}

function Cobros({ orgs, cobros, pf, onPerfil }) {
  const porOrg = orgs.map(o => {
    const ab = (o.eventos || []).filter(e => !e.liquidacion);
    return { o, com: suma(ab, "comision_total"), ef: suma(ab, "efectivo_importe") };
  }).filter(x => x.com || x.ef);
  return (<>
    <div style={{ ...card, marginBottom: 14 }}>
      <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 8 }}>Pendiente por organizador</div>
      {porOrg.length ? porOrg.map(({ o, com, ef }) => { const s = n2(com - ef); return (
        <div key={o.rrpp} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 0", borderTop: "1px solid var(--line)" }}>
          <div style={{ minWidth: 0 }}><b>{o.organizador}</b><div style={{ color: "var(--muted)", fontSize: 13, fontWeight: 700 }}>Comisión {eur(com)}{ef ? ` · efectivo ${eur(ef)}` : ""}</div></div>
          <div style={{ textAlign: "right", flexShrink: 0 }}><b style={{ color: s < 0 ? "#ffb400" : "var(--text)" }}>{eur(Math.abs(s))}</b><div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 800 }}>{s < 0 ? "le entregas" : "te paga"}</div></div>
        </div>); })
        : <div style={{ color: "var(--muted)", fontSize: 14 }}>Nada pendiente.</div>}
      <div style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 10, lineHeight: 1.5 }}>Cada organizador te liquida al acabar su evento por {pf.cobro === "transferencia" ? "transferencia" : "Bizum"}. <button onClick={onPerfil} style={{ background: "none", border: "none", color: "var(--c)", fontWeight: 800, padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5 }}>Cambiar dónde cobro</button></div>
    </div>
    <div style={{ ...card, padding: 6 }}>
      <div style={{ fontWeight: 900, fontSize: 16, padding: "10px 10px 4px" }}>Liquidaciones</div>
      {cobros.length ? cobros.map((c, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "12px 10px", borderTop: "1px solid var(--line)" }}>
          <div style={{ minWidth: 0 }}><b>{c.evento}</b><div style={{ color: "var(--muted)", fontSize: 13, fontWeight: 700 }}>{c.entradas} entradas · comisión {eur(c.comision)} · {new Date(c.cerrada_en).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}</div></div>
          <div style={{ textAlign: "right", flexShrink: 0, fontWeight: 900 }}>{Number(c.resultado) > 0 ? `Cobrado ${eur(c.resultado)}` : Number(c.resultado) < 0 ? `Entregado ${eur(-c.resultado)}` : "A cero"}</div>
        </div>))
        : <div style={{ color: "var(--muted)", fontSize: 14, padding: "6px 10px 12px" }}>Aún no te han liquidado ningún evento.</div>}
    </div>
  </>);
}

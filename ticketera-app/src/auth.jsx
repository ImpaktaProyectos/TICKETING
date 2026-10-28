import React, { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";
import { setUserScope, pendingCount } from "./db";

/* ============================================================
   SESIÓN
   ============================================================ */
export function useSession() {
  const [session, setSession] = useState(undefined);
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);
  return { session, recovery, endRecovery: () => setRecovery(false) };
}

export function RequireSession({ children }) {
  const { session, recovery, endRecovery } = useSession();
  if (session === undefined) return <Splash />;
  if (recovery) return <NewPassword onDone={endRecovery} />;
  if (!session) return <Landing />;
  setUserScope(session.user.id);
  // key = cuenta: al cambiar de cuenta la app se reinicia de cero, sin datos de la anterior
  return <React.Fragment key={session.user.id}>{children}</React.Fragment>;
}

export const logout = () => {
  const n = pendingCount();
  if (n > 0 && !window.confirm(`Hay ${n} operaciones de esta cuenta SIN SUBIR a la nube. Se quedarán guardadas en este equipo y subirán cuando vuelvas a entrar con esta misma cuenta. ¿Cerrar sesión igualmente?`)) return;
  return supabase.auth.signOut();
};

/* Mensajes de Supabase traducidos y en tono de marca */
function niceError(error) {
  const m = String(error?.message || error || "").toLowerCase();
  if (m.includes("invalid login")) return "El correo o la contraseña no son correctos.";
  if (m.includes("email not confirmed")) return "Confirma tu correo desde el email que te hemos enviado y vuelve a entrar.";
  if (m.includes("already registered") || m.includes("already been registered")) return "Ese correo ya tiene cuenta. Entra con tu contraseña.";
  if (m.includes("password") && (m.includes("6") || m.includes("short") || m.includes("least"))) return "La contraseña debe tener al menos 6 caracteres.";
  if (m.includes("rate") || m.includes("too many") || m.includes("security purposes")) return "Demasiados intentos. Espera un minuto y vuelve a probar.";
  if (m.includes("signup") && m.includes("disabled")) return "El alta de cuentas está cerrada. Pide acceso al administrador de TIXFAST.";
  if (m.includes("fetch") || m.includes("network")) return "Sin conexión. Revisa internet y vuelve a intentarlo.";
  if (m.includes("valid email") || m.includes("invalid email")) return "Escribe un correo válido.";
  return "No se ha podido completar. Inténtalo de nuevo.";
}

/* ============================================================
   LANDING DE ACCESO (según manual de marca TIXFAST V2)
   ============================================================ */
function Landing() {
  const emailRef = useRef(null);
  const goToLogin = (e) => {
    e && e.preventDefault();
    const card = document.getElementById("acceso");
    if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => emailRef.current && emailRef.current.focus({ preventScroll: true }), 350);
  };
  return (
    <div className="tf">
      <style>{LANDING_CSS}</style>
      <header className="tf-top tf-shell">
        <a href="/" aria-label="TIXFAST, inicio"><img className="tf-brand" src="/brand/tixfast_logo_horizontal_claro.svg" alt="TIXFAST" /></a>
        <nav className="tf-nav">
          <a href="#funciones">Funciones</a>
          <a href="#acceso" className="tf-nav-btn" onClick={goToLogin}>Entrar</a>
        </nav>
      </header>

      <main className="tf-shell">
        <div className="tf-grid">
          <section className="tf-hero">
            <div className="tf-eyebrow">TPV táctil para eventos</div>
            <h1>Vende en un toque.<br /><span>Controla cada euro.</span></h1>
            <p className="tf-sub">Tu barra vende. TIXFAST imprime los tickets y te permite consultar la facturación en directo. Incluso si falla la conexión, sigues operando.</p>
            <div className="tf-proof"><span>Impresión térmica de 80 mm</span><span>Varias barras</span><span>Venta sin conexión</span></div>
            <TabletMock />
            <div className="tf-caption">Interfaz de ejemplo. Los importes son ilustrativos.</div>
          </section>

          <LoginCard emailRef={emailRef} />
        </div>

        <section className="tf-features" id="funciones">
          <div className="tf-label">Diseñado para operar</div>
          <h2>Todo lo que necesitas. Nada que te frene.</h2>
          <p className="tf-intro">Una herramienta para vender consumiciones, imprimir al instante y controlar la recaudación de cada barra.</p>
          <div className="tf-featgrid">
            {FEATURES.map((f, i) => (
              <article className="tf-feat" key={f.t}>
                <div className="tf-num">{String(i + 1).padStart(2, "0")} / {f.k}</div>
                <h3>{f.t}</h3>
                <p>{f.d}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="tf-how">
          <div><div className="tf-label">Cómo funciona</div><h2>Listo para la barra.</h2></div>
          <div className="tf-steps">
            <div className="tf-step"><strong>01</strong><p>Crea tu evento y organiza las barras que vas a utilizar.</p></div>
            <div className="tf-step"><strong>02</strong><p>Configura tus productos, cantidades y bonos de consumición.</p></div>
            <div className="tf-step"><strong>03</strong><p>Conecta tu impresora térmica y empieza a vender.</p></div>
          </div>
        </section>

        <section className="tf-cta">
          <h2>Tu próxima barra, con TIXFAST.</h2>
          <a href="#acceso" className="tf-cta-btn" onClick={goToLogin}>Entrar a la plataforma</a>
        </section>
      </main>

      <footer className="tf-footer">
        <div className="tf-shell tf-footer-in">
          <span className="tf-footer-brand"><img src="/brand/tixfast_isotipo_app.svg" alt="" width="20" height="20" /> TIXFAST · Sistema TPV para eventos</span>
          <span>© {new Date().getFullYear()} TIXFAST</span>
        </div>
      </footer>
    </div>
  );
}

const FEATURES = [
  { k: "VENTA", t: "Un toque y listo", d: "Botones grandes de color, cantidades rápidas, comandas de varios productos y bonos." },
  { k: "IMPRESIÓN", t: "Un ticket por consumición", d: "Tickets térmicos de 80 mm con corte automático y diseños personalizables." },
  { k: "VISIBILIDAD", t: "Todas las barras en directo", d: "Consulta la facturación por barra, producto y hora, y exporta los datos." },
  { k: "CAJA", t: "Cuadra al céntimo", d: "Fondo de caja, cobro en efectivo o tarjeta con cambio, cierres Z y anulaciones con PIN." },
  { k: "FIABILIDAD", t: "El wifi no marca el ritmo", d: "Vende sin conexión, sincroniza al volver y guarda copias de seguridad cada 30 minutos." },
  { k: "EQUIPOS", t: "Cada rol, su acceso", d: "Administración, supervisión y cajeros con diferentes permisos. Tus datos, solo tuyos." },
];

function TabletMock() {
  const tiles = [["🍺", "Cerveza", "3,00 €"], ["🍸", "Copa", "6,00 €"], ["💧", "Agua", "2,00 €"], ["🥤", "Refresco", "3,00 €"], ["🍔", "Hamburguesa", "8,00 €"], ["🎟️", "Bonocopas", "4 tickets"]];
  return (
    <div className="tf-tablet" role="img" aria-label="Ejemplo ilustrativo del TPV de TIXFAST con productos y venta actual">
      <div className="tf-tbar"><strong>TIXFAST &nbsp;·&nbsp; Barra principal</strong><span className="tf-online">● &nbsp;Sincronizado</span></div>
      <div className="tf-twrap">
        <div className="tf-tiles">
          {tiles.map(([e, n, p]) => <div className="tf-tile" key={n}><div className="e">{e}</div><div><div className="n">{n}</div><div className="p">{p}</div></div></div>)}
        </div>
        <div className="tf-tright">
          <small>VENTA ACTUAL</small>
          <div><small>2 × Copa<br />1 × Agua</small></div>
          <div><small>TOTAL</small><div className="tf-total">14,00 €</div></div>
          <div className="tf-print">Imprimir tickets</div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Tarjeta de acceso (siempre visible) ---------------- */
function LoginCard({ emailRef }) {
  const [mode, setMode] = useState("in");     // in | up | reset
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);       // { kind: "err" | "ok", text }

  const switchMode = (m) => { setMode(m); setMsg(null); setTimeout(() => emailRef.current && emailRef.current.focus(), 30); };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setMsg(null);
    const mail = email.trim();
    if (!mail) { setMsg({ kind: "err", text: "Escribe tu correo electrónico." }); return; }
    setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email: mail, password: pass });
        if (error) setMsg({ kind: "err", text: niceError(error) });
      } else if (mode === "up") {
        const { data, error } = await supabase.auth.signUp({ email: mail, password: pass });
        if (error) setMsg({ kind: "err", text: niceError(error) });
        else if (!data?.session) setMsg({ kind: "ok", text: "Cuenta creada. Te hemos enviado un email para confirmarla; después, entra con tu contraseña." });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(mail, { redirectTo: window.location.origin });
        if (error) setMsg({ kind: "err", text: niceError(error) });
        else setMsg({ kind: "ok", text: "Si ese correo tiene cuenta, recibirás un enlace para crear una contraseña nueva." });
      }
    } catch (err) {
      setMsg({ kind: "err", text: niceError(err) });
    }
    setBusy(false);
  };

  const T = {
    in: { tag: "Acceso a la plataforma", h: "Tu evento empieza aquí.", sub: "Accede para gestionar tus eventos, barras y caja.", cta: "Entrar" },
    up: { tag: "Nueva cuenta", h: "Crea tu cuenta.", sub: "Tendrás tu propio espacio, privado, para tus eventos y barras.", cta: "Crear cuenta" },
    reset: { tag: "Recuperar acceso", h: "¿Has olvidado tu contraseña?", sub: "Escribe tu correo y te enviaremos un enlace para crear una nueva.", cta: "Enviar enlace" },
  }[mode];

  return (
    <aside className="tf-login" id="acceso" aria-label="Acceso a TIXFAST">
      <div className="tf-login-head">
        <img className="tf-tinyicon" src="/brand/tixfast_isotipo_app.svg" alt="TIXFAST" />
        <span className="tf-tag">{T.tag}</span>
      </div>
      <h2>{T.h}</h2>
      <p className="tf-muted">{T.sub}</p>

      <form onSubmit={submit} noValidate>
        <label className="tf-field" htmlFor="tf-email">Correo electrónico</label>
        <input ref={emailRef} id="tf-email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
          placeholder="tu@email.com" value={email} onChange={e => setEmail(e.target.value)} />

        {mode !== "reset" && (<>
          <label className="tf-field" htmlFor="tf-pass">Contraseña</label>
          <div className="tf-pass">
            <input id="tf-pass" type={show ? "text" : "password"} autoComplete={mode === "in" ? "current-password" : "new-password"}
              placeholder={mode === "in" ? "Tu contraseña" : "Mínimo 6 caracteres"} value={pass} onChange={e => setPass(e.target.value)} />
            <button type="button" className="tf-eye" onClick={() => setShow(s => !s)} aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}>{show ? "Ocultar" : "Mostrar"}</button>
          </div>
        </>)}

        {mode === "in"
          ? <p className="tf-rightlink"><button type="button" onClick={() => switchMode("reset")}>¿Has olvidado tu contraseña?</button></p>
          : <div style={{ height: 22 }} />}

        {msg && <div className={"tf-msg " + (msg.kind === "ok" ? "ok" : "err")} role={msg.kind === "err" ? "alert" : "status"}>{msg.text}</div>}

        <button className="tf-primary" type="submit" disabled={busy}>{busy ? "Un momento…" : T.cta}</button>
      </form>

      <div className="tf-or" />
      {mode === "in"
        ? <p className="tf-help">¿Organizas eventos? <button type="button" onClick={() => switchMode("up")}>Solicitar acceso</button></p>
        : <p className="tf-help">¿Ya tienes cuenta? <button type="button" onClick={() => switchMode("in")}>Entrar</button></p>}
    </aside>
  );
}

/* ---------------- Nueva contraseña (al abrir el enlace del email) ---------------- */
function NewPassword({ onDone }) {
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (pass.length < 6) { setMsg({ kind: "err", text: "La contraseña debe tener al menos 6 caracteres." }); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pass });
    setBusy(false);
    if (error) setMsg({ kind: "err", text: niceError(error) });
    else { setMsg({ kind: "ok", text: "Contraseña cambiada. Entrando…" }); setTimeout(onDone, 900); }
  };
  return (
    <div className="tf tf-center">
      <style>{LANDING_CSS}</style>
      <aside className="tf-login tf-solo">
        <div className="tf-login-head"><img className="tf-tinyicon" src="/brand/tixfast_isotipo_app.svg" alt="TIXFAST" /><span className="tf-tag">Nueva contraseña</span></div>
        <h2>Crea tu nueva contraseña.</h2>
        <p className="tf-muted">Úsala a partir de ahora para entrar en TIXFAST.</p>
        <form onSubmit={submit}>
          <label className="tf-field" htmlFor="tf-np">Nueva contraseña</label>
          <input id="tf-np" type="password" autoComplete="new-password" placeholder="Mínimo 6 caracteres" value={pass} onChange={e => setPass(e.target.value)} autoFocus />
          <div style={{ height: 22 }} />
          {msg && <div className={"tf-msg " + (msg.kind === "ok" ? "ok" : "err")}>{msg.text}</div>}
          <button className="tf-primary" type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar contraseña"}</button>
        </form>
      </aside>
    </div>
  );
}

function Splash() {
  return (
    <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#0B0C10" }}>
      <img src="/brand/tixfast_isotipo_app.svg" alt="TIXFAST" width="64" height="64" style={{ animation: "tfPulse 1.4s ease-in-out infinite" }} />
      <style>{"@keyframes tfPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.55;transform:scale(.94)}}"}</style>
    </div>
  );
}

/* ============================================================
   ESTILOS (paleta y tipografía del manual: Inter / Inter Display)
   ============================================================ */
const LANDING_CSS = `
.tf{--ink:#15171A;--muted:#6F747D;--border:#E6E8EB;--coral:#FF5A3C;--coral-d:#EB4A2D;--night:#0B0C10;--green:#22D3A6;
  min-height:100dvh;background:#FAFAFB;color:var(--ink);font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  -webkit-font-smoothing:antialiased;font-optical-sizing:auto;}
.tf *{box-sizing:border-box}
:where(.tf) :where(h1,h2,h3,p){margin:0}
:where(.tf) a{color:inherit;text-decoration:none}
.tf button{font-family:inherit}
.tf-shell{max-width:1460px;margin:0 auto;padding:0 55px}
.tf-top{height:96px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border)}
.tf-brand{height:40px;width:auto;display:block}
.tf-nav{display:flex;align-items:center;gap:26px;font-size:14px;color:#595D66}
.tf-nav a:hover{color:var(--ink)}
.tf-nav-btn{border:1px solid #D8DBDF;padding:11px 20px;border-radius:11px;color:#222 !important;font-weight:650;background:#fff;transition:border-color .15s}
.tf-nav-btn:hover{border-color:var(--ink)}
.tf-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(360px,.85fr);gap:6%;padding-top:72px;align-items:start}
.tf-hero{padding-top:10px}
.tf-eyebrow,.tf-label{font-size:11px;font-weight:700;letter-spacing:2px;color:#8C929B;text-transform:uppercase;margin-bottom:22px}
.tf-hero h1{font-variation-settings:'opsz' 32;font-size:clamp(42px,4.4vw,68px);font-weight:700;letter-spacing:-.055em;line-height:1.06;max-width:820px}
.tf-hero h1 span{color:var(--coral)}
.tf-sub{font-size:18px;max-width:610px;line-height:1.65;color:#686F79;margin-top:24px}
.tf-proof{display:flex;gap:22px;flex-wrap:wrap;margin:30px 0 4px}
.tf-proof span{font-size:13px;color:#3B4048;display:flex;align-items:center;gap:8px;font-weight:500}
.tf-proof span:before{content:'✓';font-weight:800;color:var(--coral)}
.tf-tablet{background:#0D0F14;border:8px solid #262932;border-radius:26px;margin-top:40px;overflow:hidden;box-shadow:0 30px 60px rgba(20,21,25,.16);color:#fff;max-width:780px}
.tf-tbar{padding:16px 20px;display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#A9B0B8;border-bottom:1px solid #242732}
.tf-tbar strong{color:#fff;font-weight:650}
.tf-online{color:#86DFBE}
.tf-twrap{display:grid;grid-template-columns:minmax(0,3fr) minmax(150px,1fr);gap:12px;padding:13px}
.tf-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.tf-tile{min-height:100px;border:1px solid #333944;border-radius:13px;background:#1B2028;padding:14px 12px;display:flex;flex-direction:column;justify-content:space-between}
.tf-tile .e{font-size:22px;line-height:1}
.tf-tile .n{font-size:12px;font-weight:650}
.tf-tile .p{font-size:12px;color:#AEB6C1;margin-top:2px}
.tf-tright{border-radius:13px;background:#171B22;padding:14px 11px;display:flex;flex-direction:column;justify-content:space-between;gap:11px}
.tf-tright small{color:#8C96A0;font-size:10px;line-height:1.5}
.tf-total{font-size:23px;letter-spacing:-.04em;font-weight:750}
.tf-print{background:var(--coral);font-size:10px;text-align:center;padding:12px 5px;border-radius:8px;font-weight:700}
.tf-caption{font-size:11px;margin-top:16px;color:#A0A6AC}

.tf-login{position:sticky;top:28px;background:#fff;border:1px solid #E6E8EC;border-radius:24px;box-shadow:0 18px 42px rgba(20,25,35,.06);padding:34px 34px 28px;scroll-margin-top:16px}
.tf-login-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:30px;gap:12px}
.tf-tinyicon{width:46px;height:46px;display:block}
.tf-tag{display:inline-flex;color:#818791;font-size:11px;border:1px solid #E2E5E8;border-radius:50px;padding:8px 12px;white-space:nowrap}
.tf-login h2{font-variation-settings:'opsz' 32;font-size:26px;font-weight:700;letter-spacing:-.04em;margin-bottom:8px}
.tf-muted{color:#7D828A;font-size:14px;line-height:1.5;margin-bottom:24px}
.tf-field{display:block;font-size:13px;font-weight:600;margin:16px 0 8px}
.tf-login input{height:54px;width:100%;border:1px solid #DDE0E5;background:#fff;color:var(--ink);border-radius:12px;padding:0 15px;font-size:16px;outline:none;font-family:inherit;transition:border-color .15s,box-shadow .15s}
.tf-login input::placeholder{color:#A2A7AE}
.tf-login input:focus{border-color:var(--coral);box-shadow:0 0 0 4px rgba(255,90,60,.12)}
.tf-pass{position:relative}
.tf-pass input{padding-right:88px}
.tf-eye{position:absolute;right:8px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:#6B7179;font-size:12px;font-weight:600;padding:8px 10px;border-radius:8px;cursor:pointer}
.tf-eye:hover{background:#F2F3F5}
.tf-rightlink{text-align:right;margin:12px 0 22px}
.tf-rightlink button,.tf-help button{border:0;background:none;padding:0;cursor:pointer;font-size:13px}
.tf-rightlink button{color:#6B7179}
.tf-rightlink button:hover{color:var(--ink)}
.tf-primary{border:0;border-radius:12px;background:var(--coral);height:56px;width:100%;font-size:16px;font-weight:700;color:#fff;cursor:pointer;transition:background .15s,transform .08s}
.tf-primary:hover{background:var(--coral-d)}
.tf-primary:active{transform:scale(.99)}
.tf-primary:disabled{opacity:.65;cursor:default}
.tf-primary:focus-visible,.tf button:focus-visible,.tf a:focus-visible{outline:3px solid rgba(255,90,60,.45);outline-offset:2px}
.tf-msg{font-size:13px;line-height:1.45;border-radius:10px;padding:11px 13px;margin-bottom:14px}
.tf-msg.err{background:#FFF1EE;color:#B4321B;border:1px solid #FFD5CC}
.tf-msg.ok{background:#E9FBF5;color:#0E7A5C;border:1px solid #BDEFDF}
.tf-or{height:1px;background:#ECEEF0;margin:26px 0 22px}
.tf-help{text-align:center;color:#636B74;font-size:13px}
.tf-help button{color:#24282E;font-weight:700;text-decoration:underline;text-underline-offset:3px}

.tf-features{padding:110px 0 96px}
.tf-features h2,.tf-cta h2{font-variation-settings:'opsz' 32;font-size:40px;letter-spacing:-.05em;font-weight:700;margin-bottom:14px}
.tf-intro{color:#727981;font-size:16px;line-height:1.7;max-width:700px}
.tf-featgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:32px}
.tf-feat{background:#fff;border:1px solid #E7E9EB;border-radius:16px;padding:28px 25px;min-height:170px}
.tf-num{font-size:11px;color:var(--coral);font-weight:700;margin-bottom:32px;letter-spacing:.3px}
.tf-feat h3{font-size:17px;font-weight:700;letter-spacing:-.02em;margin-bottom:8px}
.tf-feat p{color:#7A818A;line-height:1.55;font-size:14px}
.tf-how{border-top:1px solid var(--border);padding:48px 0 70px;display:grid;grid-template-columns:220px 1fr;gap:30px}
.tf-how h2{font-weight:700;font-size:22px;letter-spacing:-.03em}
.tf-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:25px}
.tf-step strong{display:block;color:var(--coral);font-weight:700;font-size:12px;margin-bottom:14px}
.tf-step p{font-size:15px;line-height:1.6;color:#5A616A}
.tf-cta{background:var(--night);color:#fff;border-radius:24px;padding:56px 48px;margin-bottom:70px;display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap}
.tf-cta h2{margin:0;font-size:34px}
.tf-cta-btn{background:var(--coral);color:#fff !important;font-weight:700;padding:17px 26px;border-radius:12px;white-space:nowrap}
.tf-cta-btn:hover{background:var(--coral-d)}
.tf-footer{background:#F2F3F5;border-top:1px solid #E5E7EA;padding:30px 0;color:#8D929A;font-size:12px}
.tf-footer-in{display:flex;justify-content:space-between;gap:20px;align-items:center}
.tf-footer-brand{display:inline-flex;align-items:center;gap:10px}
.tf-center{display:grid;place-items:center;padding:24px}
.tf-solo{position:static;width:100%;max-width:460px}

@media(max-width:1100px){.tf-grid{grid-template-columns:minmax(0,1.2fr) minmax(340px,1fr);gap:4%}}
@media(max-width:860px){
  .tf-shell{padding:0 20px}
  .tf-top{height:72px}
  .tf-brand{height:28px}
  .tf-nav a:first-child{display:none}
  .tf-nav-btn{padding:9px 16px}
  .tf-grid{display:flex;flex-direction:column;gap:40px;padding-top:16px}
  .tf-login{order:-1;width:100%;position:static;border-radius:20px;padding:24px 22px 22px;box-shadow:0 10px 30px rgba(20,25,35,.06)}
  .tf-login-head{margin-bottom:18px}
  .tf-tinyicon{width:42px;height:42px}
  .tf-login h2{font-size:24px}
  .tf-muted{margin-bottom:14px}
  .tf-field{margin-top:12px}
  .tf-login input{height:52px}
  .tf-rightlink{margin:12px 0 18px}
  .tf-or{margin:22px 0 18px}
  .tf-hero h1{font-size:42px}
  .tf-sub{font-size:16px;margin-top:16px}
  .tf-proof{gap:12px;margin:20px 0 0}
  .tf-tablet{margin-top:28px}
  .tf-twrap{grid-template-columns:3fr 1.2fr;gap:8px;padding:9px}
  .tf-tiles{gap:6px}
  .tf-tile{padding:11px 8px;min-height:84px}
  .tf-tile .e{font-size:18px}
  .tf-tile .n,.tf-tile .p{font-size:10px}
  .tf-tright{padding:8px}
  .tf-total{font-size:16px}
  .tf-print{padding:9px 3px;font-size:8px}
  .tf-features{padding:64px 0}
  .tf-features h2{font-size:30px}
  .tf-featgrid{grid-template-columns:1fr 1fr}
  .tf-feat{padding:22px;min-height:0}
  .tf-num{margin-bottom:20px}
  .tf-how{grid-template-columns:1fr}
  .tf-steps{grid-template-columns:1fr}
  .tf-cta{padding:36px 26px;border-radius:20px}
  .tf-cta h2{font-size:26px}
  .tf-footer-in{flex-direction:column;align-items:flex-start}
}
@media(max-width:480px){
  .tf-featgrid{grid-template-columns:1fr}
  .tf-hero h1{font-size:38px}
  .tf-proof span{font-size:12px}
  .tf-tbar{font-size:9px;padding:12px 10px}
  .tf-twrap{grid-template-columns:1fr}
  .tf-tright{display:none}
  .tf-cta-btn{width:100%;text-align:center}
}
@media(prefers-reduced-motion:reduce){.tf *{transition:none !important;scroll-behavior:auto !important}}
`;

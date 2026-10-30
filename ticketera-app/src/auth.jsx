import React, { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";
import { setUserScope, pendingCount } from "./db";

/* ============================================================
   SESIÓN
   ============================================================ */
// Sesión guardada en este equipo. Sin internet no se puede renovar el pase de acceso
// (caduca cada hora), pero la cuenta sigue siendo la misma: la usamos para poder vender
// offline y se renueva sola en cuanto vuelve la conexión.
const SB_KEY = "sb-xnhcquehlyalwgqmdiov-auth-token";
function storedSession() {
  try { const s = JSON.parse(localStorage.getItem(SB_KEY) || "null"); return s && s.user && s.user.id && s.refresh_token ? s : null; } catch { return null; }
}

export function useSession() {
  const [session, setSession] = useState(undefined);
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    let settled = false;
    // Sin red: entramos al momento con la sesión guardada (sin esperar a nadie)
    if (!navigator.onLine) { const st = storedSession(); if (st) { settled = true; setSession(st); } }
    // Wifi sin internet: si la comprobación tarda, entramos con la sesión guardada
    const slow = setTimeout(() => { if (!settled) { const st = storedSession(); if (st) { settled = true; setSession(st); } } }, 2500);
    supabase.auth.getSession().then(({ data, error }) => {
      clearTimeout(slow);
      if (data?.session) { settled = true; setSession(data.session); return; }
      if (settled) return;
      settled = true;
      const st = storedSession();
      setSession(st && (error || !navigator.onLine) ? st : null);
    }).catch(() => { clearTimeout(slow); if (!settled) { settled = true; setSession(storedSession()); } });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (!s && event !== "SIGNED_OUT" && storedSession()) return;   // sin red: no echamos al usuario
      if (s || event === "SIGNED_OUT") { settled = true; setSession(s); }
    });
    // Al volver internet, renueva el pase en segundo plano
    const onOnline = () => { supabase.auth.getSession().then(({ data }) => { if (data?.session) setSession(data.session); }).catch(() => {}); };
    window.addEventListener("online", onOnline);
    return () => { clearTimeout(slow); sub.subscription.unsubscribe(); window.removeEventListener("online", onOnline); };
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
   Escritorio: mensaje 60 % + acceso 40 %. Móvil: acceso primero.
   ============================================================ */
function Landing() {
  const emailRef = useRef(null);
  const [mode, setMode] = useState("in");
  const [floatOn, setFloatOn] = useState(false);

  // Móvil: cuando el acceso queda por encima de la pantalla, aparece un botón flotante "Entrar"
  useEffect(() => {
    const card = document.getElementById("acceso");
    if (!card || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setFloatOn(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 });
    io.observe(card);
    return () => io.disconnect();
  }, []);

  const goToLogin = (e, m) => {
    e && e.preventDefault();
    if (m) setMode(m);
    const card = document.getElementById("acceso");
    if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => emailRef.current && emailRef.current.focus({ preventScroll: true }), 450);
  };

  return (
    <div className="tf">
      <style>{LANDING_CSS}</style>
      <div className="tf-safe" aria-hidden="true" />

      <header className="tf-top">
        <div className="tf-shell tf-top-in">
          <a href="/" aria-label="TIXFAST, inicio"><img className="tf-brand" src="/brand/tixfast_logo_horizontal_claro.svg" alt="TIXFAST" /></a>
          <nav className="tf-nav" aria-label="Principal">
            <a href="#funciones">Funciones</a>
            <a href="#como">Cómo funciona</a>
            <a href="#preguntas">Preguntas</a>
            <a href="#acceso" className="tf-nav-btn" onClick={e => goToLogin(e, "in")}>Entrar</a>
          </nav>
        </div>
      </header>

      <main>
        {/* ---------- HERO + ACCESO ---------- */}
        <div className="tf-shell">
          <div className="tf-grid">
            <section className="tf-hero">
              <div className="tf-pill"><i />TPV táctil para barras de eventos</div>
              <h1>Vende en un toque.<br /><span>Controla cada euro.</span></h1>
              <p className="tf-sub">Tu barra vende. TIXFAST imprime los tickets y te enseña la facturación de cada barra en directo. Si cae el wifi, sigues vendiendo.</p>
              <div className="tf-hero-cta">
                <a href="#acceso" className="tf-btn tf-btn-dark" onClick={e => goToLogin(e, "up")}>Solicitar acceso</a>
                <a href="#funciones" className="tf-btn tf-btn-ghost">Ver funciones</a>
              </div>
              <ul className="tf-proof">
                <li>Impresión térmica de 80 mm</li>
                <li>Varias barras a la vez</li>
                <li>Venta sin conexión</li>
              </ul>
            </section>

            <LoginCard emailRef={emailRef} mode={mode} setMode={setMode} />
          </div>

          <Showcase />
          <p className="tf-caption">Interfaz de ejemplo. Los importes son ilustrativos.</p>
        </div>

        {/* ---------- DATOS RÁPIDOS ---------- */}
        <section className="tf-facts" aria-label="TIXFAST en cifras">
          <div className="tf-shell tf-facts-in">
            {FACTS.map(([n, t]) => <div className="tf-fact" key={n}><b>{n}</b><span>{t}</span></div>)}
          </div>
        </section>

        {/* ---------- FUNCIONES ---------- */}
        <section className="tf-section tf-shell" id="funciones">
          <div className="tf-head">
            <div className="tf-label">Diseñado para operar</div>
            <h2>Todo lo que necesitas.<br className="tf-br" /> Nada que te frene.</h2>
            <p className="tf-intro">Vende consumiciones, imprime al instante y controla la recaudación de cada barra desde una sola herramienta.</p>
          </div>
          <div className="tf-featgrid">
            {FEATURES.map((f, i) => (
              <article className="tf-feat" key={f.t}>
                <div className="tf-viz" aria-hidden="true">{f.viz}</div>
                <div className="tf-num">{String(i + 1).padStart(2, "0")} / {f.k}</div>
                <h3>{f.t}</h3>
                <p>{f.d}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ---------- CÓMO FUNCIONA ---------- */}
        <section className="tf-section tf-shell tf-how" id="como">
          <div className="tf-head">
            <div className="tf-label">Cómo funciona</div>
            <h2>Listo para la barra en tres pasos.</h2>
          </div>
          <ol className="tf-steps">
            {STEPS.map(([t, d], i) => (
              <li className="tf-step" key={t}>
                <span className="tf-step-n">{i + 1}</span>
                <h3>{t}</h3>
                <p>{d}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ---------- OPERACIÓN NOCTURNA ---------- */}
        <section className="tf-night">
          <div className="tf-shell tf-night-in">
            <div className="tf-night-copy">
              <div className="tf-label tf-label-dark">Operación nocturna</div>
              <h2>Hecho para la barra, <span>no para la oficina.</span></h2>
              <p>Contraste alto, botones grandes y cada producto con su color y su emoji para encontrarlo sin pensar, aunque haya poca luz y mucha cola.</p>
              <ul className="tf-checks">
                <li>Funciona en ordenador, tablet y móvil</li>
                <li>Se instala como app desde el navegador</li>
                <li>Cada barra con su caja y su numeración</li>
                <li>Anulación de la última venta, con PIN si lo activas</li>
              </ul>
            </div>
            <PhoneMock />
          </div>
        </section>

        {/* ---------- PREGUNTAS ---------- */}
        <section className="tf-section tf-shell tf-faq" id="preguntas">
          <div className="tf-head">
            <div className="tf-label">Preguntas frecuentes</div>
            <h2>Lo que nos preguntan antes de abrir la barra.</h2>
          </div>
          <div className="tf-faq-list">
            {FAQ.map(([q, a]) => (
              <details className="tf-q" key={q}>
                <summary>{q}<span aria-hidden="true" /></summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ---------- CTA FINAL ---------- */}
        <section className="tf-shell">
          <div className="tf-cta">
            <img src="/brand/tixfast_isotipo_app.svg" alt="" width="56" height="56" />
            <h2>Tu próxima barra, con TIXFAST.</h2>
            <p>Entra en tu cuenta o solicita acceso para tu próximo evento.</p>
            <div className="tf-cta-btns">
              <a href="#acceso" className="tf-btn tf-btn-coral" onClick={e => goToLogin(e, "in")}>Entrar a la plataforma</a>
              <a href="#acceso" className="tf-btn tf-btn-ghost-d" onClick={e => goToLogin(e, "up")}>Solicitar acceso</a>
            </div>
          </div>
        </section>
      </main>

      <footer className="tf-footer">
        <div className="tf-shell tf-footer-in">
          <div className="tf-footer-brand">
            <img src="/brand/tixfast_logo_horizontal_claro.svg" alt="TIXFAST" height="24" />
            <span>Sistema TPV para eventos</span>
          </div>
          <nav className="tf-footer-nav" aria-label="Pie">
            <a href="#funciones">Funciones</a>
            <a href="#como">Cómo funciona</a>
            <a href="#preguntas">Preguntas</a>
            <a href="#acceso" onClick={e => goToLogin(e, "in")}>Entrar</a>
          </nav>
          <span className="tf-copy">© {new Date().getFullYear()} TIXFAST</span>
        </div>
      </footer>

      <a href="#acceso" className={"tf-float" + (floatOn ? " on" : "")} onClick={e => goToLogin(e, "in")} tabIndex={floatOn ? 0 : -1} aria-hidden={!floatOn}>
        <img src="/brand/tixfast_isotipo_solo_blanco.svg" alt="" width="22" height="18" />Entrar a TIXFAST
      </a>
    </div>
  );
}

const FACTS = [
  ["1 toque", "un ticket por consumición"],
  ["80 mm", "impresión térmica con corte"],
  ["Sin wifi", "sigues vendiendo e imprimiendo"],
  ["30 min", "copia de seguridad en la nube"],
];

const STEPS = [
  ["Crea tu evento", "Ponle nombre y fecha y añade las barras que vas a abrir."],
  ["Configura la carta", "Productos con su precio, color y emoji, bonos y el diseño del ticket."],
  ["Conecta y vende", "Enchufa la impresora térmica, imprime un ticket de prueba y abre la barra."],
];

const FAQ = [
  ["¿Necesito internet durante el evento?", "Para vender, no. Si cae la conexión, TIXFAST sigue vendiendo e imprimiendo y guarda las ventas en el equipo; se suben solas cuando vuelve. La conexión hace falta para entrar en la cuenta y para ver en directo la facturación de otras barras."],
  ["¿Qué impresora necesito?", "Una impresora térmica de tickets de 80 mm conectada al ordenador. Desde la propia app puedes imprimir un ticket de prueba para comprobar el tamaño y el corte antes de abrir."],
  ["¿Funciona en tablet y móvil?", "Sí. Funciona desde el navegador en ordenador, tablet y móvil, y se puede instalar como app en la pantalla de inicio."],
  ["¿Puedo tener varias barras en el mismo evento?", "Sí. Cada barra tiene sus productos, su fondo de caja y su numeración, y desde administración ves la facturación de todas."],
  ["¿Qué pasa si se apaga el ordenador?", "Las ventas sincronizadas ya están en la nube y, además, TIXFAST guarda una copia de seguridad cada 30 minutos. Entras desde otro equipo y sigues donde lo dejaste."],
  ["¿Quién puede ver mis datos?", "Solo tu cuenta. Cada organizador tiene su propio espacio privado con sus eventos, barras y ventas."],
];

/* ---------------- Ilustraciones (maquetas, no capturas) ---------------- */
const TILES = [
  ["🍺", "CERVEZA", "3,00 €", "#f59e0b", "#b45309"],
  ["🍸", "COPA", "6,00 €", "#8b5cf6", "#5b21b6"],
  ["💧", "AGUA", "2,00 €", "#0ea5e9", "#0369a1"],
  ["🥤", "REFRESCO", "3,00 €", "#ef4444", "#b91c1c"],
  ["🍔", "HAMBURGUESA", "8,00 €", "#16a34a", "#166534"],
  ["🌭", "PERRITO", "5,00 €", "#f97316", "#c2410c"],
  ["🥃", "CHUPITO", "2,50 €", "#ec4899", "#be185d"],
  ["🎟️", "BONOCOPAS", "20,00 €", "#fcd34d", "#f59e0b", true],
];
const tileBg = (a, b) => ({ background: `linear-gradient(160deg, ${a}, ${b})` });

function TicketMock({ className = "" }) {
  return (
    <div className={"tf-ticket " + className}>
      <img src="/brand/tixfast_logo_ticket_1bit.svg" alt="" />
      <div className="t-ev">FIESTA DE VERANO</div>
      <div className="t-cut" />
      <div className="t-prod">COPA</div>
      <div className="t-sub">1 consumición</div>
      <div className="t-cut" />
      <div className="t-meta"><span>Barra principal</span><span>23:41</span></div>
    </div>
  );
}

function Showcase() {
  return (
    <div className="tf-show" role="img" aria-label="Ejemplo ilustrativo del TPV de TIXFAST: productos de colores, venta actual con cambio y ticket impreso">
      <div className="tf-device">
        <div className="tf-dbar">
          <div><b>FIESTA DE VERANO</b><small>Barra principal</small></div>
          <div className="tf-dpills"><span><i />En línea</span><span className="hide-s"><i />Impresora OK</span></div>
        </div>
        <div className="tf-dbody">
          <div className="tf-dmain">
            <div className="tf-chips"><span className="on">×1</span><span>×2</span><span>×3</span><span>×4</span><span className="hide-s">×5</span><span className="hide-s">×10</span></div>
            <div className="tf-dtiles">
              {TILES.map(([e, n, p, a, b, bono]) => (
                <div className={"tf-dtile" + (bono ? " bono" : "")} style={tileBg(a, b)} key={n}>
                  {bono && <em>4 tickets</em>}
                  <span className="e">{e}</span><span className="n">{n}</span><span className="p">{p}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="tf-dcart">
            <small>VENTA ACTUAL</small>
            <div className="tf-lines">
              <div><span>2 × Copa</span><b>12,00 €</b></div>
              <div><span>1 × Agua</span><b>2,00 €</b></div>
            </div>
            <div className="tf-dtotal"><small>TOTAL</small><b>14,00 €</b></div>
            <div className="tf-dpay">
              <div><small>Entrega</small><b>20,00 €</b></div>
              <div className="g"><small>Cambio</small><b>6,00 €</b></div>
            </div>
            <div className="tf-dprint">Imprimir 3 tickets</div>
          </div>
        </div>
      </div>
      <TicketMock className="tf-ticket-float" />
      <div className="tf-live">
        <div className="tf-live-h"><i />Barras en directo</div>
        <LiveBars />
      </div>
    </div>
  );
}

function LiveBars() {
  return (
    <div className="tf-bars">
      {[["Barra principal", "1.240 €", 100], ["Barra VIP", "860 €", 69], ["Terraza", "410 €", 33]].map(([n, v, w]) => (
        <div className="tf-bar" key={n}>
          <div className="tf-bar-t"><span>{n}</span><b>{v}</b></div>
          <div className="tf-bar-track"><div style={{ width: w + "%" }} /></div>
        </div>
      ))}
    </div>
  );
}

function PhoneMock() {
  return (
    <div className="tf-phone" role="img" aria-label="Ejemplo ilustrativo de TIXFAST en el móvil">
      <div className="tf-phone-scr">
        <div className="tf-island" />
        <div className="tf-pbar"><div><b>FIESTA DE VERANO</b><small>Barra: <em>Barra principal</em></small></div><span className="tf-pmenu">☰</span></div>
        <div className="tf-padv"><span>💶</span><div><b>Venta avanzada</b><small>Cobro con cálculo del cambio</small></div><i /></div>
        <div className="tf-ptiles">
          {TILES.slice(0, 6).map(([e, n, p, a, b]) => (
            <div className="tf-ptile" style={tileBg(a, b)} key={n}><span className="e">{e}</span><span className="n">{n}</span><span className="p">{p}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}

const FEATURES = [
  {
    k: "VENTA", t: "Un toque y listo",
    d: "Botones grandes con el color y el emoji de cada producto, cantidades rápidas y comandas de varios productos.",
    viz: (
      <div className="v-tiles">
        {TILES.slice(0, 3).map(([e, n, , a, b], i) => <div key={n} className={"v-tile" + (i === 1 ? " tap" : "")} style={tileBg(a, b)}><span>{e}</span>{n}</div>)}
      </div>
    ),
  },
  {
    k: "IMPRESIÓN", t: "Un ticket por consumición",
    d: "Tickets térmicos de 80 mm con corte entre cada uno y el nombre del producto bien grande para el camarero.",
    viz: <TicketMock className="v-ticket" />,
  },
  {
    k: "VISIBILIDAD", t: "Todas las barras en directo",
    d: "Facturación por barra, producto y hora mientras el evento sigue abierto. Exporta los datos cuando quieras.",
    viz: <div className="v-live"><LiveBars /></div>,
  },
  {
    k: "COBRO", t: "Cobra y da el cambio",
    d: "Registra efectivo o tarjeta, el importe entregado y el cambio calculado al momento. Bonos y ofertas en un toque.",
    viz: (
      <div className="v-calc">
        <div><span>Total</span><b>14,00 €</b></div>
        <div><span>Entrega</span><b>20,00 €</b></div>
        <div className="g"><span>Cambio</span><b>6,00 €</b></div>
      </div>
    ),
  },
  {
    k: "FIABILIDAD", t: "El wifi no marca el ritmo",
    d: "Sin conexión sigues vendiendo e imprimiendo. Todo se sube solo al volver, con copia en la nube cada 30 minutos.",
    viz: (
      <div className="v-sync">
        <span className="amber"><i />Sin conexión · 12 ventas guardadas</span>
        <span className="arrow">↓</span>
        <span className="green"><i />Sincronizado</span>
      </div>
    ),
  },
  {
    k: "CONTROL", t: "Caja y equipo bajo control",
    d: "Fondo de caja, cierre con descuadre, anulaciones con PIN y accesos de administrador, supervisor y cajero.",
    viz: (
      <div className="v-roles">
        <div className="v-chips"><span>Administrador</span><span>Supervisor</span><span className="on">Cajero</span></div>
        <div className="v-pin"><i /><i /><i /><i className="o" /></div>
      </div>
    ),
  },
];

/* ---------------- Tarjeta de acceso (siempre visible) ---------------- */
function LoginCard({ emailRef, mode, setMode }) {   // mode: in | up | reset
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);       // { kind: "err" | "ok", text }
  useEffect(() => { setMsg(null); }, [mode]);

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
   ESTILOS (paleta y tipografía del manual: Inter / Inter Display / Roboto Mono)
   ============================================================ */
const LANDING_CSS = `
.tf{--ink:#15171A;--muted:#6F747D;--soft:#8C929B;--border:#E6E8EB;--coral:#FF5A3C;--coral-d:#EB4A2D;--night:#0B0C10;--green:#22D3A6;--paper:#FAFAFB;
  --safe-t:env(safe-area-inset-top);--safe-b:env(safe-area-inset-bottom);
  min-height:100dvh;padding:0 env(safe-area-inset-right) 0 env(safe-area-inset-left);box-sizing:border-box;background:var(--paper);color:var(--ink);
  font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;font-optical-sizing:auto;overflow-x:clip}
.tf *{box-sizing:border-box}
:where(.tf) :where(h1,h2,h3,p,ul,ol){margin:0;padding:0}
:where(.tf) :where(ul,ol){list-style:none}
:where(.tf) a{color:inherit;text-decoration:none}
.tf button{font-family:inherit}
.tf h1,.tf h2{font-variation-settings:'opsz' 32;font-weight:700;text-wrap:balance}
.tf-shell{max-width:1320px;margin:0 auto;padding:0 48px}
.tf-safe{position:fixed;top:0;left:0;right:0;height:env(safe-area-inset-top);background:var(--night);z-index:60}

/* ---------- Cabecera ---------- */
.tf-top{position:sticky;top:env(safe-area-inset-top);z-index:40;background:rgba(250,250,251,.86);backdrop-filter:saturate(1.6) blur(14px);-webkit-backdrop-filter:saturate(1.6) blur(14px);border-bottom:1px solid var(--border);margin-top:env(safe-area-inset-top)}
.tf-top-in{height:76px;display:flex;align-items:center;justify-content:space-between}
.tf-brand{height:34px;width:auto;display:block}
.tf-nav{display:flex;align-items:center;gap:30px;font-size:14px;color:#595D66;font-weight:500}
.tf-nav a{transition:color .15s}
.tf-nav a:hover{color:var(--ink)}
.tf-nav-btn{border:1px solid #D8DBDF;padding:10px 20px;border-radius:11px;color:var(--ink) !important;font-weight:650;background:#fff;transition:border-color .15s,box-shadow .15s}
.tf-nav-btn:hover{border-color:var(--ink);box-shadow:0 4px 14px rgba(20,25,35,.08)}

/* ---------- Hero ---------- */
.tf-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(380px,.9fr);gap:64px;padding:64px 0 56px;align-items:center}
.tf-hero{animation:tfUp .7s cubic-bezier(.2,.7,.2,1) both}
.tf-pill{display:inline-flex;align-items:center;gap:10px;background:#fff;border:1px solid var(--border);border-radius:99px;padding:8px 14px 8px 12px;font-size:12.5px;font-weight:600;color:#4A4F57;margin-bottom:26px}
.tf-pill i{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 4px rgba(34,211,166,.18)}
.tf-hero h1{font-size:clamp(44px,5vw,74px);letter-spacing:-.055em;line-height:1.03}
.tf-hero h1 span{color:var(--coral)}
.tf-sub{font-size:19px;max-width:580px;line-height:1.6;color:#5F656E;margin-top:24px}
.tf-hero-cta{display:flex;gap:12px;flex-wrap:wrap;margin-top:32px}
.tf-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:52px;padding:0 24px;border-radius:12px;font-weight:700;font-size:15px;transition:background .15s,border-color .15s,transform .08s,box-shadow .15s;white-space:nowrap;cursor:pointer}
.tf-btn:active{transform:scale(.98)}
.tf-btn-dark{background:var(--ink);color:#fff !important}
.tf-btn-dark:hover{background:#2A2D33}
.tf-btn-ghost{border:1px solid #D8DBDF;background:#fff;color:var(--ink)}
.tf-btn-ghost:hover{border-color:var(--ink)}
.tf-btn-coral{background:var(--coral);color:#fff !important;box-shadow:0 10px 24px rgba(255,90,60,.28)}
.tf-btn-coral:hover{background:var(--coral-d)}
.tf-btn-ghost-d{border:1px solid rgba(255,255,255,.22);color:#fff !important}
.tf-btn-ghost-d:hover{border-color:#fff}
.tf-proof{display:flex;gap:10px 24px;flex-wrap:wrap;margin-top:30px}
.tf-proof li{font-size:13.5px;color:#3B4048;display:flex;align-items:center;gap:8px;font-weight:500}
.tf-proof li:before{content:'';width:18px;height:18px;border-radius:50%;flex-shrink:0;background:rgba(255,90,60,.12) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 8.2l2.5 2.4L12 5.4' fill='none' stroke='%23FF5A3C' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/12px no-repeat}

/* ---------- Escaparate (tablet + ticket + barras) ---------- */
.tf-show{position:relative;margin:8px auto 0;max-width:1140px;padding:0 180px 0 110px;animation:tfUp .8s .12s cubic-bezier(.2,.7,.2,1) both}
.tf-show:before{content:'';position:absolute;inset:8% 10% -6% 6%;background:radial-gradient(closest-side,rgba(255,90,60,.16),transparent);filter:blur(30px);z-index:0}
.tf-device{position:relative;z-index:1;background:#0B0C10;border:10px solid #23262E;border-radius:28px;overflow:hidden;box-shadow:0 40px 80px -20px rgba(15,17,22,.35),0 0 0 1px rgba(0,0,0,.06);color:#ECEEF5}
.tf-dbar{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;background:#14161D;border-bottom:1px solid #2A2E3A}
.tf-dbar b{display:block;font-size:14px;font-weight:800;letter-spacing:-.01em}
.tf-dbar small{font-size:11px;color:#838AA0}
.tf-dpills{display:flex;gap:8px}
.tf-dpills span{display:inline-flex;align-items:center;gap:6px;font-size:10.5px;font-weight:700;border:1px solid #2A2E3A;border-radius:8px;padding:6px 10px;background:#1C1F29}
.tf-dpills i{width:7px;height:7px;border-radius:50%;background:var(--green)}
.tf-dbody{display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:14px;padding:14px}
.tf-chips{display:flex;gap:6px;margin-bottom:10px}
.tf-chips span{font-size:11px;font-weight:800;padding:6px 10px;border-radius:8px;background:#1C1F29;border:1px solid #2A2E3A;color:#C9CDD8}
.tf-chips span.on{background:var(--coral);border-color:var(--coral);color:#fff}
.tf-dtiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}
.tf-dtile{position:relative;border-radius:14px;min-height:104px;padding:12px 6px 10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:#fff;text-align:center;box-shadow:inset 0 1px 0 rgba(255,255,255,.18)}
.tf-dtile .e{font-size:26px;line-height:1.1}
.tf-dtile .n{font-size:11px;font-weight:800;letter-spacing:-.01em;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.tf-dtile .p{font-size:13px;font-weight:800}
.tf-dtile.bono{color:#3A2A00;outline:2px solid rgba(255,255,255,.55);outline-offset:-2px}
.tf-dtile em{position:absolute;top:6px;left:6px;font-style:normal;font-size:8.5px;font-weight:800;background:rgba(0,0,0,.18);border-radius:6px;padding:2px 6px}
.tf-dcart{background:#14161D;border:1px solid #2A2E3A;border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:12px}
.tf-dcart small{font-size:10px;color:#838AA0;letter-spacing:.08em;font-weight:600}
.tf-lines{display:flex;flex-direction:column;gap:6px;font-size:12px}
.tf-lines div{display:flex;justify-content:space-between;color:#C9CDD8}
.tf-dtotal{border-top:1px solid #2A2E3A;padding-top:10px}
.tf-dtotal b{display:block;font-size:28px;letter-spacing:-.04em;font-weight:800;margin-top:2px}
.tf-dpay{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.tf-dpay div{background:#1C1F29;border-radius:10px;padding:8px 10px}
.tf-dpay b{display:block;font-size:14px;font-weight:800;margin-top:2px}
.tf-dpay .g{background:rgba(34,211,166,.12)}
.tf-dpay .g b{color:var(--green)}
.tf-dprint{background:var(--coral);text-align:center;padding:12px 6px;border-radius:10px;font-weight:800;font-size:12.5px;margin-top:auto}

.tf-ticket{background:#fff;color:#000;font-family:'Roboto Mono',ui-monospace,monospace;text-align:center;padding:16px 16px 22px;position:relative;
  -webkit-mask:radial-gradient(6px at 50% calc(100% + 1px),#0000 98%,#000) 50% / 14px 100%;mask:radial-gradient(6px at 50% calc(100% + 1px),#0000 98%,#000) 50% / 14px 100%}
.tf-ticket img{height:22px;width:auto;display:block;margin:0 auto 8px}
.tf-ticket .t-ev{font-size:10px;font-weight:700;letter-spacing:.06em}
.tf-ticket .t-cut{border-top:1.5px dashed #000;margin:10px 0}
.tf-ticket .t-prod{font-family:Inter,sans-serif;font-size:38px;font-weight:800;letter-spacing:-.03em;line-height:1}
.tf-ticket .t-sub{font-size:10px;margin-top:6px}
.tf-ticket .t-meta{display:flex;justify-content:space-between;font-size:9px}
.tf-ticket-float{position:absolute;z-index:2;right:-6px;top:16%;width:200px;transform:rotate(4deg);filter:drop-shadow(0 24px 30px rgba(15,17,22,.22))}
.tf-live{position:absolute;z-index:2;left:0;bottom:-104px;width:260px;background:#fff;border:1px solid var(--border);border-radius:16px;padding:14px 16px;box-shadow:0 24px 50px -12px rgba(15,17,22,.22)}
.tf-live-h{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;margin-bottom:10px}
.tf-live-h i{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 0 3px rgba(34,211,166,.2)}
.tf-bars{display:flex;flex-direction:column;gap:9px}
.tf-bar-t{display:flex;justify-content:space-between;font-size:11.5px;color:#4A4F57;margin-bottom:4px}
.tf-bar-t b{color:var(--ink)}
.tf-bar-track{height:6px;border-radius:9px;background:#EEF0F2;overflow:hidden}
.tf-bar-track div{height:100%;border-radius:9px;background:var(--coral)}
.tf-caption{font-size:11px;margin-top:132px;color:#A0A6AC;text-align:center}

/* ---------- Datos ---------- */
.tf-facts{margin-top:56px;border-top:1px solid var(--border);border-bottom:1px solid var(--border);background:#fff}
.tf-facts-in{display:grid;grid-template-columns:repeat(4,1fr)}
.tf-fact{padding:30px 24px;display:flex;flex-direction:column;gap:6px;border-left:1px solid var(--border)}
.tf-fact:first-child{border-left:0;padding-left:0}
.tf-fact b{font-variation-settings:'opsz' 32;font-size:30px;font-weight:700;letter-spacing:-.04em}
.tf-fact span{font-size:14px;color:var(--muted)}

/* ---------- Secciones ---------- */
.tf-section{padding-top:112px;scroll-margin-top:calc(80px + env(safe-area-inset-top))}
.tf-head{max-width:720px;margin-bottom:40px}
.tf-label{font-size:11px;font-weight:700;letter-spacing:2px;color:var(--soft);text-transform:uppercase;margin-bottom:16px}
.tf-head h2,.tf-night h2{font-size:clamp(32px,3.4vw,46px);letter-spacing:-.05em;line-height:1.08}
.tf-intro{color:#6A717A;font-size:17px;line-height:1.65;margin-top:16px}

.tf-featgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.tf-feat{background:#fff;border:1px solid #E7E9EB;border-radius:20px;padding:12px 12px 26px;transition:transform .2s,box-shadow .2s,border-color .2s}
.tf-feat:hover{transform:translateY(-3px);box-shadow:0 22px 44px -18px rgba(15,17,22,.18);border-color:#DCDFE3}
.tf-feat .tf-num,.tf-feat h3,.tf-feat p{padding:0 14px}
.tf-viz{height:168px;border-radius:14px;background:#F4F5F7;margin-bottom:22px;display:grid;place-items:center;overflow:hidden;position:relative}
.tf-num{font-size:11px;color:var(--coral);font-weight:700;margin-bottom:10px;letter-spacing:.3px}
.tf-feat h3{font-size:18px;font-weight:700;letter-spacing:-.02em;margin-bottom:8px}
.tf-feat p{color:#727981;line-height:1.55;font-size:14.5px}

.v-tiles{display:flex;gap:10px}
.v-tile{width:84px;height:92px;border-radius:14px;color:#fff;font-size:10px;font-weight:800;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;box-shadow:0 10px 20px -8px rgba(0,0,0,.3)}
.v-tile span{font-size:26px}
.v-tile.tap{transform:scale(.94);position:relative}
.v-tile.tap:after{content:'';position:absolute;inset:-7px;border-radius:19px;border:2px solid var(--coral);animation:tfTap 1.8s ease-out infinite}
.v-ticket{width:170px;transform:translateY(22px) rotate(-3deg);filter:drop-shadow(0 12px 18px rgba(15,17,22,.14));padding-top:14px}
.v-ticket .t-prod{font-size:32px}
.v-live{width:78%;background:#fff;border-radius:14px;padding:14px 16px;box-shadow:0 10px 24px -12px rgba(15,17,22,.2)}
.v-calc{width:78%;display:flex;flex-direction:column;gap:6px}
.v-calc div{display:flex;justify-content:space-between;align-items:center;background:#fff;border-radius:10px;padding:9px 14px;font-size:13px;color:#4A4F57}
.v-calc b{color:var(--ink);font-size:15px}
.v-calc .g{background:#E9FBF5;color:#0E7A5C}
.v-calc .g b{color:#0E7A5C;font-size:18px}
.v-sync{display:flex;flex-direction:column;align-items:center;gap:6px}
.v-sync span{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;border-radius:99px;padding:9px 16px}
.v-sync i{width:7px;height:7px;border-radius:50%;background:currentColor}
.v-sync .amber{background:#FFF4D6;color:#8A5A00}
.v-sync .green{background:#E3FAF2;color:#0E7A5C}
.v-sync .arrow{padding:0;color:var(--soft);font-size:16px}
.v-roles{display:flex;flex-direction:column;align-items:center;gap:16px}
.v-chips{display:flex;gap:6px}
.v-chips span{font-size:11.5px;font-weight:700;background:#fff;border:1px solid var(--border);border-radius:99px;padding:7px 12px;color:#4A4F57}
.v-chips .on{background:var(--ink);border-color:var(--ink);color:#fff}
.v-pin{display:flex;gap:10px;background:#fff;border-radius:12px;padding:12px 16px;box-shadow:0 8px 18px -10px rgba(15,17,22,.2)}
.v-pin i{width:12px;height:12px;border-radius:50%;background:var(--ink)}
.v-pin i.o{background:transparent;border:2px solid #C8CCD2}

/* ---------- Pasos ---------- */
.tf-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;counter-reset:s;position:relative}
.tf-step{background:#fff;border:1px solid #E7E9EB;border-radius:20px;padding:28px 26px 30px;position:relative}
.tf-step-n{display:grid;place-items:center;width:40px;height:40px;border-radius:12px;background:rgba(255,90,60,.1);color:var(--coral);font-weight:800;font-size:16px;margin-bottom:22px}
.tf-step h3{font-size:18px;font-weight:700;letter-spacing:-.02em;margin-bottom:8px}
.tf-step p{font-size:14.5px;line-height:1.6;color:#6A717A}
.tf-step:not(:last-child):after{content:'';position:absolute;top:47px;right:-17px;width:18px;height:2px;background:#D9DCE0}

/* ---------- Noche ---------- */
.tf-night{margin-top:112px;background:var(--night);color:#ECEEF5;overflow:hidden;position:relative}
.tf-night:before{content:'';position:absolute;width:720px;height:720px;right:-120px;top:-260px;background:radial-gradient(closest-side,rgba(255,90,60,.16),transparent);pointer-events:none}
.tf-night-in{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:64px;align-items:center;padding-top:96px;padding-bottom:0;position:relative}
.tf-night-copy{padding-bottom:96px}
.tf-label-dark{color:#838AA0}
.tf-night h2 span{color:var(--coral)}
.tf-night p{color:#A3A9B8;font-size:17px;line-height:1.65;margin-top:18px;max-width:520px}
.tf-checks{margin-top:28px;display:grid;gap:12px}
.tf-checks li{display:flex;align-items:center;gap:12px;font-size:15px;color:#DADDE6}
.tf-checks li:before{content:'';width:22px;height:22px;border-radius:50%;flex-shrink:0;background:rgba(34,211,166,.14) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 8.2l2.5 2.4L12 5.4' fill='none' stroke='%2322D3A6' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/13px no-repeat}
.tf-phone{justify-self:center;align-self:end;width:300px;background:#23262E;border-radius:46px 46px 0 0;padding:11px 11px 0;box-shadow:0 -10px 60px rgba(0,0,0,.4)}
.tf-phone-scr{background:var(--night);border-radius:36px 36px 0 0;overflow:hidden;padding:46px 12px 18px;position:relative;height:470px}
.tf-island{position:absolute;top:11px;left:50%;transform:translateX(-50%);width:92px;height:27px;border-radius:20px;background:#000}
.tf-pbar{display:flex;justify-content:space-between;align-items:center;padding:6px 4px 12px;border-bottom:1px solid #2A2E3A;margin:0 -12px 12px;padding-left:16px;padding-right:16px}
.tf-pbar b{display:block;font-size:12.5px;font-weight:800}
.tf-pbar small{font-size:10px;color:#838AA0}
.tf-pbar em{font-style:normal;color:var(--coral);font-weight:700}
.tf-pmenu{width:30px;height:30px;border-radius:9px;border:1px solid #2A2E3A;display:grid;place-items:center;font-size:13px;background:#1C1F29}
.tf-padv{display:flex;align-items:center;gap:9px;border:1px solid #2A2E3A;background:#14161D;border-radius:12px;padding:9px 11px;margin-bottom:10px}
.tf-padv>span{font-size:18px}
.tf-padv div{flex:1;min-width:0}
.tf-padv b{display:block;font-size:11px}
.tf-padv small{font-size:9px;color:#838AA0}
.tf-padv i{width:30px;height:18px;border-radius:9px;background:#2A2E3A;position:relative}
.tf-padv i:after{content:'';position:absolute;left:2px;top:2px;width:14px;height:14px;border-radius:50%;background:#fff}
.tf-ptiles{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.tf-ptile{border-radius:14px;height:104px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;color:#fff;text-align:center}
.tf-ptile .e{font-size:28px;line-height:1.15}
.tf-ptile .n{font-size:11px;font-weight:800}
.tf-ptile .p{font-size:13px;font-weight:800}

/* ---------- Preguntas ---------- */
.tf-faq{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);gap:64px;align-items:start}
.tf-faq .tf-head{position:sticky;top:120px}
.tf-faq-list{border-top:1px solid var(--border)}
.tf-q{border-bottom:1px solid var(--border)}
.tf-q summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:20px;padding:22px 2px;font-size:17px;font-weight:650;letter-spacing:-.01em}
.tf-q summary::-webkit-details-marker{display:none}
.tf-q summary span{width:28px;height:28px;border-radius:50%;border:1px solid #D8DBDF;flex-shrink:0;position:relative;transition:transform .2s,background .2s,border-color .2s}
.tf-q summary span:before,.tf-q summary span:after{content:'';position:absolute;left:50%;top:50%;width:11px;height:1.8px;background:var(--ink);transform:translate(-50%,-50%);border-radius:2px}
.tf-q summary span:after{transform:translate(-50%,-50%) rotate(90deg);transition:transform .2s}
.tf-q[open] summary span{background:var(--ink);border-color:var(--ink)}
.tf-q[open] summary span:before,.tf-q[open] summary span:after{background:#fff}
.tf-q[open] summary span:after{transform:translate(-50%,-50%) rotate(0)}
.tf-q summary:hover{color:#000}
.tf-q p{padding:0 50px 24px 2px;color:#646B74;font-size:15.5px;line-height:1.65}

/* ---------- CTA ---------- */
.tf-cta{margin:112px 0 96px;background:var(--night);color:#fff;border-radius:28px;padding:64px 32px;text-align:center;position:relative;overflow:hidden}
.tf-cta:before{content:'';position:absolute;left:50%;top:-240px;width:640px;height:420px;transform:translateX(-50%);background:radial-gradient(closest-side,rgba(255,90,60,.28),transparent);pointer-events:none}
.tf-cta>*{position:relative}
.tf-cta img{display:block;margin:0 auto 22px}
.tf-cta h2{font-size:clamp(30px,3.4vw,46px);letter-spacing:-.05em;line-height:1.08}
.tf-cta p{color:#A3A9B8;margin-top:12px;font-size:17px}
.tf-cta-btns{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:30px}

/* ---------- Pie ---------- */
.tf-footer{border-top:1px solid #E5E7EA;padding:34px 0 calc(34px + env(safe-area-inset-bottom));color:#8D929A;font-size:13px;background:#F3F4F6}
.tf-footer-in{display:flex;justify-content:space-between;gap:24px;align-items:center;flex-wrap:wrap}
.tf-footer-brand{display:flex;align-items:center;gap:14px}
.tf-footer-brand img{height:24px;width:auto;display:block}
.tf-footer-nav{display:flex;gap:22px;flex-wrap:wrap}
.tf-footer-nav a:hover{color:var(--ink)}

/* ---------- Botón flotante (solo móvil) ---------- */
.tf-float{display:none}

/* ---------- Acceso ---------- */
.tf-login{background:#fff;border:1px solid #E6E8EC;border-radius:24px;box-shadow:0 30px 60px -24px rgba(20,25,35,.18),0 2px 6px rgba(20,25,35,.04);padding:34px 34px 28px;scroll-margin-top:calc(96px + env(safe-area-inset-top));animation:tfUp .7s .06s cubic-bezier(.2,.7,.2,1) both}
.tf-login-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:28px;gap:12px}
.tf-tinyicon{width:46px;height:46px;display:block}
.tf-tag{display:inline-flex;color:#818791;font-size:11px;border:1px solid #E2E5E8;border-radius:50px;padding:8px 12px;white-space:nowrap}
.tf-login h2{font-variation-settings:'opsz' 32;font-size:27px;font-weight:700;letter-spacing:-.04em;margin-bottom:8px}
.tf-muted{color:#7D828A;font-size:14.5px;line-height:1.5;margin-bottom:22px}
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
.tf-primary{border:0;border-radius:12px;background:var(--coral);height:56px;width:100%;font-size:16px;font-weight:700;color:#fff;cursor:pointer;transition:background .15s,transform .08s;box-shadow:0 10px 22px -8px rgba(255,90,60,.55)}
.tf-primary:hover{background:var(--coral-d)}
.tf-primary:active{transform:scale(.99)}
.tf-primary:disabled{opacity:.65;cursor:default}
.tf-primary:focus-visible,.tf button:focus-visible,.tf a:focus-visible,.tf summary:focus-visible{outline:3px solid rgba(255,90,60,.45);outline-offset:2px}
.tf-msg{font-size:13px;line-height:1.45;border-radius:10px;padding:11px 13px;margin-bottom:14px}
.tf-msg.err{background:#FFF1EE;color:#B4321B;border:1px solid #FFD5CC}
.tf-msg.ok{background:#E9FBF5;color:#0E7A5C;border:1px solid #BDEFDF}
.tf-or{height:1px;background:#ECEEF0;margin:26px 0 22px}
.tf-help{text-align:center;color:#636B74;font-size:13px}
.tf-help button{color:#24282E;font-weight:700;text-decoration:underline;text-underline-offset:3px}
.tf-center{display:grid;place-items:center;padding:calc(24px + env(safe-area-inset-top)) 24px 24px}
.tf-solo{width:100%;max-width:460px}

@keyframes tfUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes tfTap{0%{opacity:.9;transform:scale(.9)}70%,100%{opacity:0;transform:scale(1.15)}}

/* ---------- Responsive ---------- */
@media(max-width:1180px){
  .tf-shell{padding:0 32px}
  .tf-grid{grid-template-columns:minmax(0,1.2fr) minmax(360px,1fr);gap:40px}
  .tf-show{padding:0 150px 0 70px}
  .tf-dbody{grid-template-columns:minmax(0,1fr) 190px}
  .tf-featgrid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:900px){
  .tf-shell{padding:0 20px}
  .tf-top-in{height:64px}
  .tf-brand{height:26px}
  .tf-nav a:not(.tf-nav-btn){display:none}
  .tf-nav-btn{padding:8px 16px}
  .tf-grid{display:flex;flex-direction:column;gap:44px;padding:16px 0 40px}
  .tf-login{order:-1;width:100%;border-radius:20px;padding:24px 22px 22px;box-shadow:0 14px 34px -14px rgba(20,25,35,.16);scroll-margin-top:calc(76px + env(safe-area-inset-top))}
  .tf-login-head{margin-bottom:18px}
  .tf-tinyicon{width:42px;height:42px}
  .tf-login h2{font-size:24px}
  .tf-muted{margin-bottom:12px}
  .tf-field{margin-top:12px}
  .tf-login input{height:52px}
  .tf-rightlink{margin:12px 0 18px}
  .tf-or{margin:22px 0 18px}
  .tf-hero h1{font-size:clamp(34px,9.3vw,56px)}
  .tf-sub{font-size:16.5px;margin-top:18px}
  .tf-hero-cta{margin-top:24px}
  .tf-proof{margin-top:24px}
  .tf-show{padding:0 0 40px}
  .tf-device{border-width:7px;border-radius:22px}
  .tf-dbody{grid-template-columns:1fr;padding:10px}
  .tf-dcart{display:none}
  .tf-ticket-float{width:150px;right:-8px;top:auto;bottom:-6px}
  .tf-ticket-float .t-prod{font-size:28px}
  .tf-live{display:none}
  .tf-caption{margin-top:18px}
  .tf-facts{margin-top:40px}
  .tf-facts-in{grid-template-columns:1fr 1fr}
  .tf-fact{padding:22px 16px}
  .tf-fact:nth-child(odd){border-left:0;padding-left:0}
  .tf-fact:nth-child(n+3){border-top:1px solid var(--border)}
  .tf-fact b{font-size:24px}
  .tf-fact span{font-size:13px}
  .tf-section{padding-top:72px}
  .tf-head{margin-bottom:28px}
  .tf-intro{font-size:16px}
  .tf-steps{grid-template-columns:1fr;gap:12px}
  .tf-step{display:grid;grid-template-columns:40px 1fr;column-gap:16px;padding:22px}
  .tf-step-n{grid-row:span 2;margin:0}
  .tf-step:not(:last-child):after{display:none}
  .tf-night{margin-top:72px}
  .tf-night-in{grid-template-columns:1fr;gap:40px;padding-top:64px}
  .tf-night-copy{padding-bottom:0}
  .tf-night p{font-size:16px}
  .tf-phone{width:270px}
  .tf-phone-scr{height:400px}
  .tf-faq{grid-template-columns:1fr;gap:0}
  .tf-faq .tf-head{position:static}
  .tf-q summary{font-size:16px;padding:20px 2px}
  .tf-q p{padding-right:8px;font-size:15px}
  .tf-cta{margin:72px 0 64px;padding:48px 22px;border-radius:22px}
  .tf-cta p{font-size:16px}
  .tf-footer-in{flex-direction:column;align-items:flex-start;gap:16px}
  .tf-float{display:flex;align-items:center;justify-content:center;gap:10px;position:fixed;z-index:50;left:16px;right:16px;bottom:calc(14px + env(safe-area-inset-bottom));height:56px;border-radius:16px;background:var(--coral);color:#fff !important;font-weight:700;font-size:16px;box-shadow:0 18px 40px -10px rgba(255,90,60,.55),0 0 0 1px rgba(255,255,255,.12) inset;transform:translateY(140%);opacity:0;transition:transform .3s cubic-bezier(.2,.7,.2,1),opacity .3s;pointer-events:none}
  .tf-float.on{transform:none;opacity:1;pointer-events:auto}
  .tf-footer{padding-bottom:calc(100px + env(safe-area-inset-bottom))}
}
@media(max-width:600px){
  .tf-featgrid{grid-template-columns:1fr}
  .tf-viz{height:150px}
  .tf-dtiles{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
  .tf-dtile:nth-child(n+7){display:none}
  .tf-dtile{min-height:84px;border-radius:11px}
  .tf-dtile .e{font-size:21px}
  .tf-dtile .n{font-size:9.5px}
  .tf-dtile .p{font-size:11px}
  .tf-dbar{padding:10px 12px}
  .tf-dbar b{font-size:12px}
  .hide-s{display:none !important}
  .tf-show{padding-bottom:0}
  .tf-ticket-float{display:none}
  .tf-hero-cta .tf-btn{flex:1}
  .tf-br{display:none}
  .tf-cta-btns .tf-btn{width:100%}
}
@media(prefers-reduced-motion:reduce){.tf *,.tf{animation:none !important;transition:none !important;scroll-behavior:auto !important}}
`;

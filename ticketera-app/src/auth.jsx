import React, { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { setUserScope, pendingCount } from "./db";

export function useSession() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  return session;
}

export function RequireSession({ children }) {
  const session = useSession();
  if (session === undefined) return <Splash text="Cargando…" />;
  if (!session) return <Login />;
  setUserScope(session.user.id);
  // key = cuenta: al cambiar de cuenta la app se reinicia de cero, sin datos de la anterior
  return <React.Fragment key={session.user.id}>{children}</React.Fragment>;
}

export const logout = () => {
  const n = pendingCount();
  if (n > 0 && !window.confirm(`Hay ${n} operaciones de esta cuenta SIN SUBIR a la nube. Se quedarán guardadas en este equipo y subirán cuando vuelvas a entrar con esta misma cuenta. ¿Cerrar sesión igualmente?`)) return;
  return supabase.auth.signOut();
};

function Login() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [mode, setMode] = useState("in");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr(""); setBusy(true);
    const { error } = mode === "in"
      ? await supabase.auth.signInWithPassword({ email, password: pass })
      : await supabase.auth.signUp({ email, password: pass });
    setBusy(false);
    if (error) setErr(error.message);
    else if (mode === "up") setErr("Cuenta creada. Si pide confirmación, revisa el email y luego entra.");
  };
  return (
    <div style={S.wrap}><div style={S.card}>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 22, textAlign: "center", marginBottom: 4 }}><span style={{ color: "#ff5a3c" }}>●</span> TICKETERA</div>
      <div style={{ textAlign: "center", color: "#838aa0", fontSize: 13, marginBottom: 20 }}>Inicia sesión con la cuenta del operador</div>
      <input style={S.input} type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
      <div style={{ height: 10 }} />
      <input style={S.input} type="password" placeholder="Contraseña" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />
      {err && <div style={{ color: "#ff8a8a", fontSize: 12, marginTop: 10 }}>{err}</div>}
      <button onClick={submit} disabled={busy} style={{ ...S.primary, marginTop: 16, opacity: busy ? .6 : 1 }}>{busy ? "…" : mode === "in" ? "Entrar" : "Crear cuenta"}</button>
      <button onClick={() => { setMode(mode === "in" ? "up" : "in"); setErr(""); }} style={S.link}>{mode === "in" ? "Crear una cuenta nueva" : "Ya tengo cuenta · Entrar"}</button>
    </div></div>
  );
}
function Splash({ text }) { return <div style={S.wrap}><div style={{ color: "#838aa0", fontFamily: "'Manrope',sans-serif" }}>{text}</div></div>; }

const S = {
  wrap: { height: "100vh", display: "grid", placeItems: "center", background: "radial-gradient(1100px 560px at 50% -10%, #211a30, #0b0c10)", fontFamily: "'Manrope',sans-serif", color: "#eceef5" },
  card: { width: 380, maxWidth: "92%", background: "#14161d", border: "1px solid #2a2e3a", borderRadius: 22, padding: 28, boxShadow: "0 30px 80px rgba(0,0,0,.55)" },
  input: { width: "100%", background: "#1c1f29", color: "#eceef5", border: "1px solid #2a2e3a", borderRadius: 10, padding: "12px 13px", fontSize: 15, outline: "none", boxSizing: "border-box" },
  primary: { width: "100%", background: "#ff5a3c", color: "#fff", border: "none", borderRadius: 12, padding: "13px", fontWeight: 800, fontSize: 15, cursor: "pointer" },
  link: { width: "100%", background: "transparent", color: "#838aa0", border: "none", marginTop: 12, fontSize: 13, cursor: "pointer" },
};

// ===================== FICHA DE BEBIDAS DEL CLIENTE · /b/<token> =====================
// El cliente de un reservado elige la bebida y la mezcla de cada botella de su pack (y extras,
// con su precio si lo hay). Solo ve su mesa, el evento y las listas: nada más. Sus botellas se
// vuelcan directamente en el pedido del reservado y puede cambiarlas por el mismo enlace hasta
// el día siguiente al evento.
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";

const eur = (v) => Number(v).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
const fechaTxt = (v) => { if (!v) return ""; const d = new Date(`${v}T12:00:00`); if (isNaN(+d)) return ""; const t = d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }); return t.charAt(0).toUpperCase() + t.slice(1); };

const CSS = `
  :root { --bg:#0b0c10; --surface:#14161d; --surface2:#1c1f28; --line:#2a2e3a; --text:#f2f3f7; --muted:#9298a6; --accent:#ff5a3c; --green:#22d3a6; --amber:#ffb400; --red:#ff4d4d; }
  * { box-sizing: border-box; } html, body { margin: 0; background: var(--bg); }
  .bb-page { min-height: 100dvh; color: var(--text); font-family: Inter, -apple-system, "Segoe UI", sans-serif; display: flex; justify-content: center; padding: 18px 14px calc(30px + env(safe-area-inset-bottom)); }
  .bb-card { width: 100%; max-width: 480px; }
  .bb-sel { width: 100%; min-height: 48px; padding: 0 12px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface2); color: var(--text); font: inherit; font-size: 16px; font-weight: 600; }
  .bb-btn { width: 100%; min-height: 52px; border: none; border-radius: 14px; background: var(--accent); color: #fff; font: inherit; font-size: 17px; font-weight: 900; cursor: pointer; }
  .bb-sec { width: 100%; min-height: 48px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface2); color: var(--text); font: inherit; font-size: 14.5px; font-weight: 800; cursor: pointer; }
`;

export default function PaginaBebidas({ token }) {
  const [d, setD] = useState(null);           // ficha cargada (o false si no existe)
  const [botellas, setBotellas] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { document.title = "Tus bebidas · TIXFAST"; }, []);
  useEffect(() => {
    supabase.rpc("bebidas_ficha", { p_token: token }).then(({ data, error }) => {
      if (error || !data?.ok) { setD(false); return; }
      setD(data);
      const incl = Math.max(0, data.incluidas || 0);
      const previas = (Array.isArray(data.botellas) ? data.botellas : []).map(b => ({ bebida: b.bebida || "", mezcla: b.mezcla || "" }));
      const n = Math.max(incl, previas.length, incl || 1);
      setBotellas(Array.from({ length: Math.max(n, 1) }, (_, i) => previas[i] || { bebida: "", mezcla: "" }));
    }, () => setD(false));
  }, [token]);

  const incl = Math.max(0, d?.incluidas || 0);
  const maxBot = incl + Math.max(0, d?.max_extra || 0);
  const extras = Math.max(0, botellas.length - incl);
  const listo = botellas.length > 0 && botellas.every(b => b.bebida && b.mezcla);
  const resumen = useMemo(() => botellas.filter(b => b.bebida && b.mezcla).map(b => `${b.bebida} + ${b.mezcla}`), [botellas]);

  const enviar = async () => {
    if (!listo || enviando) return;
    setEnviando(true); setErr("");
    const { data, error } = await supabase.rpc("bebidas_guardar", { p_token: token, p_botellas: botellas });
    setEnviando(false);
    if (error || !data?.ok) { setErr(data?.motivo === "pasado" ? "El evento ya ha pasado: este enlace ya no sirve." : "No se ha podido guardar. Revisa las botellas e inténtalo otra vez."); return; }
    setHecho(true); window.scrollTo(0, 0);
  };

  if (d === null) return <div className="bb-page"><style>{CSS}</style><div style={{ margin: "auto", color: "var(--muted)", fontWeight: 700 }}>Cargando…</div></div>;
  if (d === false) return (<div className="bb-page"><style>{CSS}</style>
    <div className="bb-card" style={{ margin: "auto", textAlign: "center" }}>
      <div style={{ fontSize: 40 }}>🤔</div>
      <div style={{ fontWeight: 900, fontSize: 20, marginTop: 6 }}>Este enlace no funciona</div>
      <div style={{ color: "var(--muted)", fontSize: 14.5, marginTop: 6, lineHeight: 1.5 }}>Puede que haya caducado o que el evento ya haya pasado. Pide uno nuevo a quien te lo envió.</div>
    </div></div>);

  return (<div className="bb-page"><style>{CSS}</style>
    <div className="bb-card">
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--accent)" }}>Tu reservado</div>
      <h1 style={{ margin: "4px 0 2px", fontSize: 26, lineHeight: 1.15 }}>{d.evento || "Tu evento"}</h1>
      <div style={{ color: "var(--muted)", fontSize: 14.5, fontWeight: 600 }}>{[fechaTxt(d.fecha), d.mesa ? `Mesa ${d.mesa}` : null].filter(Boolean).join(" · ")}</div>

      {hecho ? (
        <div style={{ background: "var(--surface)", border: "1px solid rgba(34,211,166,.5)", borderRadius: 18, padding: 18, marginTop: 18 }}>
          <div style={{ fontSize: 34 }}>🥂</div>
          <div style={{ fontWeight: 900, fontSize: 20, marginTop: 4 }}>{d.cliente ? `¡Listo, ${d.cliente}!` : "¡Listo!"} Bebidas apuntadas</div>
          <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
            {resumen.map((t, i) => <div key={i} style={{ background: "var(--surface2)", borderRadius: 10, padding: "9px 12px", fontSize: 14.5, fontWeight: 700 }}>🍾 {t}</div>)}
          </div>
          {extras > 0 && d.precio_extra != null && <div style={{ color: "var(--amber)", fontSize: 13.5, fontWeight: 700, marginTop: 10 }}>{extras} {extras === 1 ? "botella extra" : "botellas extra"} · {eur(extras * d.precio_extra)} (se paga en el local)</div>}
          <div style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 12, lineHeight: 1.5 }}>Todo estará preparado en vuestra mesa. Si cambiáis de idea, vuelve a abrir este mismo enlace.</div>
          <button className="bb-sec" style={{ marginTop: 12 }} onClick={() => setHecho(false)}>Cambiar las bebidas</button>
        </div>
      ) : (<>
        {d.respondido && <div style={{ background: "rgba(34,211,166,.1)", border: "1px solid rgba(34,211,166,.4)", color: "var(--green)", borderRadius: 12, padding: "10px 12px", fontSize: 13.5, fontWeight: 700, marginTop: 14 }}>Ya elegisteis vuestras bebidas. Puedes repasarlas o cambiarlas aquí.</div>}
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 18, padding: 16, marginTop: 14 }}>
          <div style={{ fontWeight: 900, fontSize: 17 }}>{d.cliente ? `${d.cliente}, elegid` : "Elegid"} vuestras botellas</div>
          <div style={{ color: "var(--muted)", fontSize: 13.5, margin: "4px 0 12px", lineHeight: 1.5 }}>
            {incl > 0 ? `Vuestra reserva incluye ${incl} ${incl === 1 ? "botella" : "botellas"}: elige la bebida y la mezcla de cada una.` : "Elige la bebida y la mezcla de cada botella."}
          </div>
          {botellas.map((b, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: .6, marginBottom: 5 }}>
                <span>Botella {i + 1}{i < incl ? " · incluida" : d.precio_extra != null ? ` · extra, ${eur(d.precio_extra)}` : " · extra"}</span>
                {i >= incl && <button onClick={() => setBotellas(x => x.filter((_, j) => j !== i))} style={{ border: "none", background: "none", color: "var(--red)", font: "inherit", fontWeight: 800, cursor: "pointer", minHeight: 24 }}>Quitar</button>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <select className="bb-sel" value={b.bebida} aria-label={`Bebida ${i + 1}`} onChange={e => setBotellas(x => x.map((y, j) => j === i ? { ...y, bebida: e.target.value } : y))}>
                  <option value="">🍾 Bebida…</option>{(d.bebidas || []).map(v => <option key={v}>{v}</option>)}</select>
                <select className="bb-sel" value={b.mezcla} aria-label={`Mezcla ${i + 1}`} onChange={e => setBotellas(x => x.map((y, j) => j === i ? { ...y, mezcla: e.target.value } : y))}>
                  <option value="">🥤 Mezcla…</option>{(d.mezclas || []).map(v => <option key={v}>{v}</option>)}</select>
              </div>
            </div>))}
          {botellas.length < maxBot && <button className="bb-sec" onClick={() => setBotellas(x => [...x, { bebida: "", mezcla: "" }])}>+ Añadir botella extra{d.precio_extra != null ? ` · ${eur(d.precio_extra)}` : ""}</button>}
          {extras > 0 && d.precio_extra != null && <div style={{ color: "var(--amber)", fontSize: 13.5, fontWeight: 700, marginTop: 10 }}>{extras} {extras === 1 ? "botella extra" : "botellas extra"} · {eur(extras * d.precio_extra)} que se pagan en el local, aparte de la reserva.</div>}
        </div>
        {err && <div role="alert" style={{ color: "var(--red)", fontSize: 14, fontWeight: 700, marginTop: 10 }}>{err}</div>}
        <button className="bb-btn" style={{ marginTop: 14, opacity: listo ? 1 : .45 }} disabled={!listo || enviando} onClick={enviar}>
          {enviando ? "Guardando…" : "Confirmar nuestras bebidas"}</button>
        {!listo && <div style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", marginTop: 8 }}>Elige la bebida y la mezcla de cada botella para confirmar.</div>}
      </>)}
      <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 12, marginTop: 22 }}>Reservados con TIXFAST</div>
    </div>
  </div>);
}

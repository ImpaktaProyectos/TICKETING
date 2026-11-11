// ===================== CARRITO DE VARIOS EVENTOS =====================
// Un carrito por organización, guardado en el móvil del comprador y compartido entre su microsite
// (/o/<organización>) y las páginas de sus eventos (/e/<evento>). Se paga todo de una vez:
// un formulario, una compra (web_comprar_varios: todo o nada) y un «Mis entradas».
// Los precios que se ven aquí son orientativos: el total lo calcula siempre el servidor.
import { avisosDe } from "./avisos";
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../supabase";
import { money, eur, fecha, cap, card, btn, Tramo, CAMPOS, ERRORES, Campo, Check, lbl, inpP, MIS, stepBtn, InfoPrivacidad, PRIVACIDAD_VERSION } from "./comun";

const CLAVE = (org) => "tixfast_carrito_" + org;
const AVISO = "tixfast-carrito";
const DIA = 24 * 3600 * 1000;
const leer = (org) => {
  try { const c = JSON.parse(localStorage.getItem(CLAVE(org)) || "null"); return c && Array.isArray(c.lineas) && Date.now() - (c.t || 0) < DIA ? c.lineas : []; }
  catch { return []; }
};
const escribir = (org, lineas) => {
  try { localStorage.setItem(CLAVE(org), JSON.stringify({ lineas, t: Date.now() })); } catch {}
  window.dispatchEvent(new CustomEvent(AVISO, { detail: org }));
};
const lineaDe = (ev, t, cantidad) => ({ evento: ev.slug, eventoNombre: ev.nombre, inicio: ev.inicio || ev.fecha, flyer: ev.flyer_url || null, prueba: ev.modo === "pruebas" || !!ev.vista_previa || !!ev.borrador,
  tramo: t.id, tramoNombre: t.nombre, precio: Number(t.precio) || 0, cantidad, max: Math.max(1, Math.min(t.max_por_compra || 10, t.quedan ?? 99)) });

// org = slug de la organización (sin organización = carrito en memoria, p. ej. la vista previa del CRM)
export function useCarrito(org) {
  const [lineas, setLineas] = useState(() => (org ? leer(org) : []));
  useEffect(() => {
    if (!org) return;
    setLineas(leer(org));
    const local = (e) => { if (e.detail === org) setLineas(leer(org)); };
    const otraPestana = (e) => { if (e.key === CLAVE(org)) setLineas(leer(org)); };
    window.addEventListener(AVISO, local); window.addEventListener("storage", otraPestana);
    return () => { window.removeEventListener(AVISO, local); window.removeEventListener("storage", otraPestana); };
  }, [org]);
  const guardar = (fn) => {
    const base = org ? leer(org) : lineas;
    const nuevas = fn(base).filter(l => l.cantidad > 0);
    if (org) escribir(org, nuevas); setLineas(nuevas);
  };
  const poner = (ev, t, cantidad) => guardar(ls => {
    const i = ls.findIndex(l => l.evento === ev.slug && l.tramo === t.id);
    if (i < 0) return cantidad > 0 ? [...ls, lineaDe(ev, t, cantidad)] : ls;
    return ls.map((l, k) => k === i ? { ...lineaDe(ev, t, cantidad) } : l);
  });
  const cambiar = (evento, tramo, cantidad) => guardar(ls => ls.map(l => l.evento === evento && l.tramo === tramo ? { ...l, cantidad: Math.max(0, Math.min(l.max, cantidad)) } : l));
  const quitarEvento = (evento) => guardar(ls => ls.filter(l => l.evento !== evento));
  const vaciar = () => guardar(() => []);
  const n = lineas.reduce((s, l) => s + l.cantidad, 0);
  const total = lineas.reduce((s, l) => s + l.cantidad * l.precio, 0);
  const eventos = [...new Set(lineas.map(l => l.evento))];
  const de = (evento, tramo) => lineas.find(l => l.evento === evento && l.tramo === tramo)?.cantidad || 0;
  return { org, lineas, poner, cambiar, quitarEvento, vaciar, n, total, eventos, de };
}
const grupos = (lineas) => {
  const m = new Map();
  lineas.forEach(l => { if (!m.has(l.evento)) m.set(l.evento, { evento: l.evento, nombre: l.eventoNombre, inicio: l.inicio, flyer: l.flyer, lineas: [] }); m.get(l.evento).lineas.push(l); });
  return [...m.values()].sort((a, b) => String(a.inicio || "").localeCompare(String(b.inicio || "")));
};

/* ---------- Barra fija del carrito ---------- */
export function BarraCarrito({ carrito, T, onAbrir, previa, extra = 0, extraTotal = 0, texto }) {
  const n = carrito.n + extra, total = carrito.total + extraTotal;
  if (!n) return null;
  const ev = carrito.eventos.length;
  return (
    <div className="pub-barra" style={previa ? { position: "sticky", left: 0, right: 0, bottom: 0, transform: "none", width: "auto", borderRadius: 0 } : null}>
      <button onClick={onAbrir} aria-label="Ver el carrito" style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 12, background: "transparent", border: "none", color: "var(--text)", cursor: "pointer", textAlign: "left", padding: 0, fontFamily: "inherit" }}>
        <span style={{ position: "relative", width: 44, height: 44, borderRadius: 14, background: "var(--card2)", border: "1px solid var(--line)", display: "grid", placeItems: "center", flexShrink: 0 }}>
          <IcoBolsa />
          <span style={{ position: "absolute", top: -6, right: -6, minWidth: 22, height: 22, borderRadius: 22, background: "var(--c)", color: T.tinta, fontSize: 12, fontWeight: 900, display: "grid", placeItems: "center", padding: "0 5px" }}>{n}</span>
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 13, color: "var(--muted)", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n} {n === 1 ? "entrada" : "entradas"}{ev > 1 ? ` · ${ev} eventos` : ""}</span>
          <span style={{ display: "block", fontSize: 22, fontWeight: 900 }}>{total ? eur(total) : "Gratis"}</span>
        </span>
      </button>
      <button onClick={onAbrir} style={{ ...btn(T.d.color, T.tinta), padding: "16px 22px", fontSize: 17 }}>{texto || "Continuar →"}</button>
    </div>
  );
}
const IcoBolsa = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 7h12l1 14H5L6 7z" /><path d="M9 7a3 3 0 0 1 6 0" /></svg>;

/* ---------- Hoja lateral / inferior ---------- */
export function Hoja({ titulo, onClose, children, pie, previa, T }) {
  useEffect(() => { if (previa) return; const k = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); const o = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { window.removeEventListener("keydown", k); document.body.style.overflow = o; }; }, []);
  const contenido = (
    <div role="dialog" aria-label={titulo} onClick={onClose} style={{ ...(T?.vars || {}), fontFamily: T?.letra, position: previa ? "absolute" : "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.62)", backdropFilter: "blur(6px)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} className="pub-hoja" style={{ width: "100%", maxWidth: 560, maxHeight: "90dvh", display: "flex", flexDirection: "column", background: "var(--bg)", color: "var(--text)", borderRadius: "24px 24px 0 0", border: "1px solid var(--line)", boxShadow: "0 -20px 60px rgba(0,0,0,.4)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 18px 10px" }}>
          <div style={{ flex: 1, fontWeight: 900, fontSize: 20 }}>{titulo}</div>
          <button onClick={onClose} aria-label="Cerrar" style={{ ...stepBtn, width: 40, height: 40, fontSize: 18 }}>✕</button>
        </div>
        <div style={{ overflow: "auto", padding: "0 18px 12px", flex: 1 }}>{children}</div>
        {pie && <div style={{ padding: "12px 18px calc(14px + env(safe-area-inset-bottom))", borderTop: "1px solid var(--line)" }}>{pie}</div>}
      </div>
    </div>
  );
  return previa ? contenido : createPortal(contenido, document.body);
}

export function HojaCarrito({ carrito, T, onClose, onContinuar, previa, orgNombre }) {
  const gs = grupos(carrito.lineas);
  const mezcla = new Set(carrito.lineas.map(l => l.prueba)).size > 1;
  return (
    <Hoja titulo="Tu carrito" onClose={onClose} previa={previa} T={T}
      pie={carrito.n > 0 && <>
        {mezcla && <div style={{ color: "#ff8a65", fontWeight: 800, fontSize: 13.5, marginBottom: 8 }}>Hay eventos en modo prueba y eventos reales: se compran por separado. Quita uno de los dos para seguir.</div>}
        <button disabled={mezcla} onClick={onContinuar} style={{ ...btn(T.d.color, T.tinta), width: "100%", padding: 17, fontSize: 18, opacity: mezcla ? .5 : 1 }}>Continuar · {carrito.total ? eur(carrito.total) : "Gratis"}</button>
        <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 12.5, marginTop: 8 }}>Un solo formulario para todo{gs.length > 1 ? ` · ${gs.length} eventos` : ""}</div>
      </>}>
      {gs.length === 0 && <div style={{ color: "var(--muted)", textAlign: "center", padding: 30 }}>Aún no has añadido entradas.{orgNombre ? ` Elige las fiestas de ${orgNombre} que quieras.` : ""}</div>}
      {gs.map(g => (
        <div key={g.evento} style={{ ...card, marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
            {g.flyer ? <img src={g.flyer} alt="" style={{ width: 52, height: 52, borderRadius: 12, objectFit: "cover" }} /> : <span style={{ width: 52, height: 52, borderRadius: 12, background: "var(--c)" }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 900, fontSize: 16.5, overflowWrap: "anywhere" }}>{g.nombre}</div>
              <div style={{ color: "var(--muted)", fontSize: 13, fontWeight: 700 }}>{cap(fecha(g.inicio))}</div>
            </div>
            <button onClick={() => carrito.quitarEvento(g.evento)} aria-label={`Quitar ${g.nombre}`} style={{ ...btn("transparent", "var(--muted)"), padding: "8px", fontSize: 13 }}>Quitar</button>
          </div>
          {g.lineas.map(l => (
            <div key={l.tramo} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--line)" }}>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 800 }}>{l.tramoNombre}</div><div style={{ color: "var(--muted)", fontSize: 13 }}>{money(l.precio)} c/u</div></div>
              <button aria-label={`Quitar una ${l.tramoNombre}`} onClick={() => carrito.cambiar(l.evento, l.tramo, l.cantidad - 1)} style={{ ...stepBtn, width: 38, height: 38, fontSize: 20 }}>−</button>
              <span style={{ minWidth: 24, textAlign: "center", fontWeight: 900, fontSize: 18 }}>{l.cantidad}</span>
              <button aria-label={`Añadir una ${l.tramoNombre}`} disabled={l.cantidad >= l.max} onClick={() => carrito.cambiar(l.evento, l.tramo, l.cantidad + 1)} style={{ ...stepBtn, width: 38, height: 38, fontSize: 20, background: "var(--c)", color: T.tinta, borderColor: "var(--c)", opacity: l.cantidad >= l.max ? .35 : 1 }}>+</button>
            </div>))}
        </div>))}
    </Hoja>
  );
}

/* ---------- Elegir entradas de un evento sin salir de la página ---------- */
export function ElegirEntradas({ slug, carrito, T, onClose, previa }) {
  const [ev, setEv] = useState(undefined);
  useEffect(() => { supabase.rpc("web_evento_publico", { p_slug: slug }).then(({ data }) => setEv(data || null)).catch(() => setEv(null)); }, [slug]);
  const tramos = ev?.tramos || [];
  const nEv = tramos.reduce((s, t) => s + carrito.de(slug, t.id), 0);
  return (
    <Hoja titulo={ev ? ev.nombre : "Entradas"} onClose={onClose} previa={previa} T={T}
      pie={<button onClick={onClose} style={{ ...btn(nEv ? T.d.color : "var(--card2)", nEv ? T.tinta : "var(--text)"), width: "100%", padding: 16, fontSize: 17 }}>{nEv ? `Hecho · ${carrito.n} en el carrito` : "Cerrar"}</button>}>
      {ev === undefined && <div style={{ color: "var(--muted)", padding: 24, textAlign: "center" }}>Cargando entradas…</div>}
      {ev === null && <div style={{ color: "var(--muted)", padding: 24, textAlign: "center" }}>No se han podido cargar. Inténtalo de nuevo.</div>}
      {ev && <>
        <div style={{ color: "var(--muted)", fontWeight: 700, marginBottom: 12 }}>{cap(fecha(ev.inicio || ev.fecha))}{ev.recinto ? ` · ${ev.recinto}` : ""}</div>
        {tramos.length === 0 && <div style={card}>Aún no hay entradas a la venta.</div>}
        {tramos.map((t, i) => <Tramo key={t.id} t={t} sig={tramos.slice(i + 1).find(x => x.estado === "proximo")} avisos={avisosDe(ev.avisos)} n={carrito.de(slug, t.id)} T={T} onN={(n) => carrito.poner(ev, t, n)} />)}
        <a href={`/e/${slug}`} style={{ display: "block", textAlign: "center", color: "var(--muted)", fontWeight: 800, marginTop: 6 }}>Ver toda la información del evento</a>
      </>}
    </Hoja>
  );
}

/* ---------- Un formulario para todos los eventos ---------- */
const NIVEL = { no: 0, opcional: 1, obligatorio: 2 };
const NOMBRE_NIVEL = ["no", "opcional", "obligatorio"];
export function CompraVarios({ org, carrito, T, onVolver }) {
  const [evs, setEvs] = useState(null);            // datos frescos de cada evento
  const [errCarga, setErrCarga] = useState(false);
  const slugs = carrito.eventos.join("|");
  useEffect(() => {
    let vivo = true; setEvs(null); setErrCarga(false);
    Promise.all(carrito.eventos.map(s => supabase.rpc("web_evento_publico", { p_slug: s }).then(r => r.data)))
      .then(xs => { if (vivo) setEvs(Object.fromEntries(xs.filter(Boolean).map(x => [x.slug, x]))); })
      .catch(() => { if (vivo) setErrCarga(true); });
    return () => { vivo = false; };
  }, [slugs]);

  // Líneas con su precio y estado actuales
  const lineas = useMemo(() => !evs ? [] : carrito.lineas.map(l => {
    const t = evs[l.evento]?.tramos?.find(x => x.id === l.tramo);
    return { ...l, t, precio: t ? Number(t.precio) : l.precio, ok: !!t && t.estado === "venta" && (t.quedan == null || t.quedan >= l.cantidad) };
  }), [evs, carrito.lineas]);
  const gs = grupos(lineas);
  const total = lineas.reduce((s, l) => s + l.precio * l.cantidad, 0);
  const problemas = lineas.filter(l => !l.ok);
  // Se piden los datos del evento más exigente
  const form = useMemo(() => {
    const f = {};
    Object.values(evs || {}).forEach(e => Object.entries(e.formulario || {}).forEach(([k, v]) => { if ((NIVEL[v] || 0) > (NIVEL[f[k]] || 0)) f[k] = v; }));
    return f;
  }, [evs]);
  const pedir = (k) => (form[k] || "no") !== "no", oblig = (k) => form[k] === "obligatorio";
  const conEdad = Object.values(evs || {}).filter(e => e.edad_minima);
  const legal = Object.values(evs || {}).find(e => e.legal)?.legal || null;
  const prueba = Object.values(evs || {}).some(e => e.modo === "pruebas" || e.vista_previa);

  const [c, setC] = useState({ nombre: "", email: "", email2: "" });
  const [as, setAs] = useState({});                // { "evento|i": { nombre, dni } }
  const [acepta, setAcepta] = useState(false);
  const [aceptaEdad, setAceptaEdad] = useState(false);
  const [novedades, setNovedades] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setC(x => ({ ...x, [k]: v }));
  const plazasDe = (g) => g.lineas.flatMap(l => Array.from({ length: l.cantidad }, (_, k) => ({ tramo: l.tramo, nombreTramo: l.tramoNombre })));
  const a = (ev, i) => as[`${ev}|${i}`] || { nombre: "", dni: "" };
  const setA = (ev, i, patch) => setAs(x => ({ ...x, [`${ev}|${i}`]: { ...a(ev, i), ...patch } }));
  const dniAsis = (ev) => (evs?.[ev]?.formulario?.dni_asistente || "no");
  const copiarDe = (desde, hacia, n) => setAs(x => { const y = { ...x }; for (let i = 0; i < n; i++) { const o = x[`${desde}|${i}`]; if (o?.nombre) y[`${hacia}|${i}`] = { ...(y[`${hacia}|${i}`] || {}), nombre: o.nombre, dni: o.dni || "" }; } return y; });

  const enviar = async (e) => {
    e.preventDefault(); setErr("");
    if (problemas.length) return setErr("Revisa las entradas marcadas: alguna ya no está disponible en esa cantidad.");
    if (c.nombre.trim().length < 3) return setErr(ERRORES.nombre);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim())) return setErr(ERRORES.email);
    if (c.email.trim().toLowerCase() !== c.email2.trim().toLowerCase()) return setErr("Los dos correos no coinciden.");
    for (const f of CAMPOS) if (oblig(f.k) && !String(c[f.k] || "").trim()) return setErr(`Falta: ${f.t}.`);
    for (const g of gs) {
      const ps = plazasDe(g);
      for (let i = 0; i < ps.length; i++) {
        if (a(g.evento, i).nombre.trim().length < 3) return setErr(`${ERRORES.nombre_asistente} (${g.nombre})`);
        if (dniAsis(g.evento) === "obligatorio" && !a(g.evento, i).dni.trim()) return setErr(`Falta el DNI de algún asistente de ${g.nombre}.`);
      }
    }
    if (conEdad.length && !aceptaEdad) return setErr(ERRORES.edad);
    if (!acepta) return setErr(ERRORES.condiciones);
    setBusy(true);
    let clave; try { clave = sessionStorage.getItem("tixfast_clave_" + org.slug) || crypto.randomUUID(); sessionStorage.setItem("tixfast_clave_" + org.slug, clave); } catch { clave = crypto.randomUUID(); }
    try {
      const comprador = { nombre: c.nombre.trim(), email: c.email.trim(), acepta: true, acepta_edad: aceptaEdad, marketing: novedades, privacidad: PRIVACIDAD_VERSION };
      CAMPOS.forEach(f => { if (pedir(f.k) && c[f.k]) comprador[f.k] = String(c[f.k]).trim(); });
      const asistentes = gs.flatMap(g => plazasDe(g).map((p, i) => ({ evento: g.evento, tramo: p.tramo, nombre: a(g.evento, i).nombre.trim(), dni: dniAsis(g.evento) !== "no" ? a(g.evento, i).dni.trim() : "" })));
      const { data, error } = await supabase.rpc("web_comprar_varios", {
        p_org: org.slug, p_lineas: lineas.map(l => ({ evento: l.evento, tramo: l.tramo, cantidad: l.cantidad })), p_comprador: comprador, p_asistentes: asistentes, p_clave: clave,
      });
      if (error) throw error;
      if (!data?.ok) {
        const k = String(data?.motivo || "");
        const base = k.startsWith("falta_") ? `Falta: ${CAMPOS.find(f => f.k === k.slice(6))?.t || k.slice(6)}.` : k === "modos_mezclados" ? "No se pueden mezclar eventos de prueba y reales en la misma compra." : k === "evento_ajeno" ? "Uno de los eventos ya no pertenece a esta organización." : ERRORES[k] || "No se ha podido completar la compra.";
        setErr(`${base}${data?.evento_nombre ? ` · ${data.evento_nombre}` : ""}${data?.tramo ? ` (${data.tramo}${data?.quedan != null ? `: quedan ${data.quedan}` : ""})` : ""}. No se ha cobrado ni emitido nada.`);
        setBusy(false); return;
      }
      try { sessionStorage.removeItem("tixfast_clave_" + org.slug); } catch {}
      try { const l = JSON.parse(localStorage.getItem(MIS) || "[]") || []; l.unshift({ org: org.slug, compra: data.acceso, codigo: data.codigo, t: Date.now() }); localStorage.setItem(MIS, JSON.stringify(l.slice(0, 30))); } catch {}
      carrito.vaciar();
      window.location.assign(`/compra/${data.acceso}?nueva=1`);
    } catch { setErr(navigator.onLine ? "No se ha podido completar la compra. Inténtalo de nuevo (no se te cobrará dos veces)." : "Sin conexión. Conéctate y vuelve a intentarlo."); setBusy(false); }
  };

  if (errCarga) return <div style={{ ...card, marginTop: 20 }}>No se han podido cargar los eventos. Revisa la conexión. <button onClick={onVolver} style={{ ...btn("var(--card2)", "var(--text)"), marginTop: 10 }}>Volver</button></div>;
  if (!evs) return <div style={{ ...card, marginTop: 20, color: "var(--muted)", textAlign: "center" }}>Preparando tu compra…</div>;
  return (
    <form onSubmit={enviar} style={{ marginTop: 10 }} noValidate>
      <button type="button" onClick={onVolver} style={{ ...btn("transparent", "var(--text)"), padding: "8px 0", fontSize: 15 }}>← Seguir eligiendo</button>
      <div style={{ ...card, marginTop: 8 }}>
        <h2 style={{ fontSize: 20, margin: "0 0 6px", fontWeight: 900 }}>Tu compra{gs.length > 1 ? ` · ${gs.length} eventos` : ""}</h2>
        {gs.map(g => (
          <div key={g.evento} style={{ padding: "10px 0", borderTop: "1px solid var(--line)" }}>
            <div style={{ fontWeight: 900 }}>{g.nombre} <span style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>· {cap(fecha(g.inicio, false))}</span></div>
            {g.lineas.map(l => <div key={l.tramo} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "3px 0", fontWeight: 700, color: l.ok ? "var(--text)" : "#ff6b6b" }}>
              <span>{l.cantidad} × {l.tramoNombre}{!l.ok ? (l.t ? (l.t.quedan != null && l.t.estado === "venta" ? ` · quedan ${l.t.quedan}` : " · ya no está a la venta") : " · ya no existe") : ""}</span><span>{money(l.precio * l.cantidad)}</span></div>)}
          </div>))}
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--line)", marginTop: 4, paddingTop: 10, fontWeight: 900, fontSize: 20 }}><span>Total</span><span>{total ? eur(total) : "Gratis"}</span></div>
      </div>

      <div style={{ ...card, marginTop: 12 }}>
        <h2 style={{ fontSize: 20, margin: "0 0 12px", fontWeight: 900 }}>Tus datos</h2>
        <Campo l="Nombre y apellidos *" v={c.nombre} on={v => set("nombre", v)} ac="name" />
        <Campo l="Correo electrónico *" v={c.email} on={v => set("email", v)} type="email" ac="email" im="email" sub="Aquí te enviaremos todas las entradas." />
        <Campo l="Repite el correo *" v={c.email2} on={v => set("email2", v)} type="email" ac="email" im="email" />
        {CAMPOS.filter(f => pedir(f.k)).map(f => f.sel
          ? <label key={f.k} style={lbl}><span>{f.t}{oblig(f.k) ? " *" : ""}</span><select value={c[f.k] || ""} onChange={e => set(f.k, e.target.value)} style={inpP}><option value="">Elige…</option>{f.sel.map(o => <option key={o}>{o}</option>)}</select></label>
          : <Campo key={f.k} l={`${f.t}${oblig(f.k) ? " *" : ""}`} v={c[f.k] || ""} on={v => set(f.k, v)} type={f.type} ac={f.ac} im={f.im} />)}
      </div>

      <div style={{ ...card, marginTop: 12 }}>
        <h2 style={{ fontSize: 20, margin: "0 0 4px", fontWeight: 900 }}>Asistentes</h2>
        <div style={{ color: "var(--muted)", fontSize: 14, marginBottom: 6 }}>Las entradas son nominativas: en cada una sale el nombre de quien la usa.</div>
        {gs.map((g, gi) => { const ps = plazasDe(g), prev = gs[gi - 1]; return (
          <div key={g.evento} style={{ borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <div style={{ flex: 1, fontWeight: 900, fontSize: 16, color: "var(--c)" }}>{g.nombre}</div>
              {prev && <button type="button" onClick={() => copiarDe(prev.evento, g.evento, ps.length)} style={{ ...btn("var(--card2)", "var(--text)"), fontSize: 13, padding: "8px 12px", border: "1px solid var(--line)" }}>Copiar nombres de {prev.nombre.length > 18 ? "la anterior" : prev.nombre}</button>}
            </div>
            {ps.map((p, i) => (
              <div key={i}>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 220px" }}><Campo l={`Entrada ${i + 1} · ${p.nombreTramo} *`} v={a(g.evento, i).nombre} on={v => setA(g.evento, i, { nombre: v })} ac={gi === 0 && i === 0 ? "name" : "off"} /></div>
                  {i === 0 && c.nombre && !a(g.evento, 0).nombre && <button type="button" onClick={() => setA(g.evento, 0, { nombre: c.nombre })} style={{ ...btn("var(--card2)", "var(--text)"), fontSize: 14, padding: "10px 12px", marginBottom: 12, border: "1px solid var(--line)" }}>Soy yo</button>}
                </div>
                {dniAsis(g.evento) !== "no" && <Campo l={`DNI / NIE${dniAsis(g.evento) === "obligatorio" ? " *" : ""}`} v={a(g.evento, i).dni} on={v => setA(g.evento, i, { dni: v })} ac="off" />}
              </div>))}
          </div>); })}
      </div>

      <div style={{ ...card, marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        {conEdad.length > 0 && <Check v={aceptaEdad} on={setAceptaEdad}>Confirmo que los asistentes cumplen la edad mínima de cada evento ({conEdad.map(e => `${e.nombre}: +${e.edad_minima}`).join(" · ")}).</Check>}
        <Check v={acepta} on={setAcepta}>Acepto las condiciones de compra. Las entradas son nominativas, de un solo uso y no se pueden revender.</Check>
        <Check v={novedades} on={setNovedades}>Quiero recibir novedades, preventas y ofertas de {legal?.razon_social || org.nombre} por correo. <span style={{ color: "var(--muted)" }}>Opcional. Me puedo dar de baja cuando quiera.</span></Check>
        <InfoPrivacidad legal={legal} organizador={org.nombre} />
      </div>

      {err && <div role="alert" style={{ marginTop: 12, background: "#c62828", color: "#fff", borderRadius: 12, padding: "12px 14px", fontWeight: 800 }}>{err}</div>}
      <button type="submit" disabled={busy || problemas.length > 0} style={{ ...btn(T.d.color, T.tinta), width: "100%", marginTop: 14, padding: "18px", fontSize: 18, opacity: busy || problemas.length ? .6 : 1 }}>
        {busy ? "Emitiendo tus entradas…" : total && !prueba ? `Pagar ${eur(total)}` : `Conseguir mis entradas${gs.length > 1 ? ` (${gs.length} eventos)` : ""}`}
      </button>
      {prueba && <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, marginTop: 8 }}>Venta de prueba: no se cobra nada y las entradas no son válidas.</div>}
      <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 12.5, marginTop: 8 }}>Se compra todo o nada: si una entrada se agota en este momento, no se emite ninguna.</div>
    </form>
  );
}

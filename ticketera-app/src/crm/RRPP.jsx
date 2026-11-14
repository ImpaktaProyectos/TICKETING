// ===================== CRM · RRPP =====================
// Relaciones públicas del organizador: su enlace personal (panel sin cuenta), comisión configurable por evento
// (fija, porcentaje o por tipo de entrada), recuento en directo (por enlace y en efectivo) y liquidación.
// Los RRPP se dan de alta solos con su cuenta (/rp) y piden colaborar desde el enlace para RRPP del organizador
// (/rp/unirse/<token>); el organizador acepta o rechaza y ve dónde cobra cada uno. También se pueden añadir a mano
// (sin cuenta, con un enlace personal a su panel).
// La liquidación se paga o se cobra fuera de la app (Bizum, transferencia, efectivo) y queda apuntada,
// con su gasto en el CRM. Todo el cálculo lo hace el servidor (rrpp_resumen / rrpp_liquidar).
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { C, Icon, Tile, Badge, Seg, Sheet, Field, money, r2, parseImporte } from "./ui";

const ORIGEN = typeof window !== "undefined" ? window.location.origin : "";
const telWa = (t) => { const d = String(t || "").replace(/\D/g, ""); return d.length === 9 ? "34" + d : d; };
const wa = (texto, tel) => `https://wa.me/${tel ? telWa(tel) : ""}?text=${encodeURIComponent(texto)}`;
const num = (v) => (Number(v) || 0).toLocaleString("es-ES", { maximumFractionDigits: 2 });
const TIPOS = [{ k: "fija", t: "€ por entrada" }, { k: "porcentaje", t: "% del precio" }, { k: "tramos", t: "Según la entrada" }];
const METODOS = [{ k: "bizum", t: "Bizum" }, { k: "transferencia", t: "Transferencia" }, { k: "efectivo", t: "Efectivo" }, { k: "otro", t: "Otro" }];
const nuevoCodigo = (nombre) => {
  const base = String(nombre || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "RRPP";
  return (base.length < 3 ? (base + "RRP").slice(0, 3) : base) + String(Math.floor(Math.random() * 90) + 10);
};
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

export function describirComision(c, tramos = []) {
  if (!c || !c.tipo) return "Sin comisión";
  if (c.tipo === "porcentaje") return Number(c.valor) ? `${num(c.valor)} % del precio` : "Sin comisión";
  if (c.tipo === "tramos") { const l = tramos.filter(t => Number(c.tramos?.[t.id]) > 0).map(t => `${t.nombre} ${money(c.tramos[t.id])}`); return l.length ? l.join(" · ") : "Sin comisión"; }
  return Number(c.valor) ? `${money(c.valor)} por entrada` : "Sin comisión";
}

export default function RRPP({ ev, isMobile, flash, onDatos }) {
  const [d, setD] = useState(null);           // { lista, rrpp, cfg, web, tramos }
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ficha, setFicha] = useState(null);   // RRPP en edición ({} = nuevo)
  const [liq, setLiq] = useState(null);       // fila a liquidar
  const [cfg, setCfg] = useState(null);       // comisión del evento en edición
  const [capt, setCapt] = useState(undefined); // enlace para RRPP del organizador (null = aún no creado)

  const cargar = async () => {
    try {
      const [lista, rrpp, conf, web, tramos, cap] = await Promise.all([
        supabase.rpc("rrpp_resumen", { p_evento: ev.id }).then(ok),
        supabase.from("ticket_rrpp").select("id, nombre, telefono, codigo, acceso, activo, todos_eventos").order("nombre").then(ok),
        supabase.from("ticket_rrpp_config").select("*").eq("evento_id", ev.id).maybeSingle().then(ok),
        supabase.from("ticket_web_eventos").select("slug, estado, modo").eq("evento_id", ev.id).maybeSingle().then(ok),
        supabase.from("ticket_web_tramos").select("id, nombre, precio, orden").eq("evento_id", ev.id).order("orden").then(ok),
        supabase.from("ticket_rrpp_captacion").select("token, activo").maybeSingle().then(ok),
      ]);
      setCapt(cap || null);
      const c = conf || { tipo: "fija", valor: 0, tramos: {}, efectivo: true };
      setD({ lista: lista || [], rrpp: rrpp || [], cfg: c, web, tramos: tramos || [] });
      setCfg(x => x && x.evento === ev.id ? x : { evento: ev.id, tipo: c.tipo, valor: String(c.valor ?? 0).replace(".", ","), tramos: Object.fromEntries(Object.entries(c.tramos || {}).map(([k, v]) => [k, String(v).replace(".", ",")])), efectivo: c.efectivo !== false, cambiado: false });
      setError("");
    } catch (e) { setError(e.message || "No se ha podido cargar"); }
  };
  useEffect(() => { setD(null); setCfg(null); cargar(); const t = setInterval(() => document.visibilityState !== "hidden" && cargar(), 30000); return () => clearInterval(t); }, [ev.id]);
  const run = async (fn, msg) => { setBusy(true); try { const r = await fn(); if (msg) flash(msg); await cargar(); return r ?? true; } catch (e) { flash(e.message || "Algo ha fallado", "warn"); return null; } finally { setBusy(false); } };

  if (error && !d) return <div style={{ ...C.panel, color: "var(--amber)", fontWeight: 700 }}>{error} <button onClick={cargar} style={{ ...C.btnSm, marginLeft: 8 }}>Reintentar</button></div>;
  if (!d || !cfg) return <div style={{ color: "var(--muted)", padding: 30, textAlign: "center" }}>Cargando RRPP…</div>;

  const porId = Object.fromEntries(d.rrpp.map(x => [x.id, x]));
  const todas = d.lista.map(f => ({ ...f, ...porId[f.rrpp_id], rrpp_id: f.rrpp_id }));
  const solicitudes = todas.filter(f => f.estado === "solicitada");
  const filas = todas.filter(f => f.estado !== "solicitada");
  const enEvento = filas.filter(f => f.en_evento || Number(f.online) + Number(f.efectivo_n) > 0 || f.liquidacion);
  const fuera = filas.filter(f => !enEvento.includes(f));
  const tot = enEvento.reduce((t, f) => ({ n: t.n + Number(f.online) + Number(f.efectivo_n), com: t.com + Number(f.comision), ef: t.ef + (f.liquidacion ? 0 : Number(f.efectivo_importe)), pend: t.pend + (f.liquidacion ? 0 : Number(f.comision)) }), { n: 0, com: 0, ef: 0, pend: 0 });
  const enlacePanel = (f) => `${ORIGEN}/rp/${f.acceso}`;
  const enlaceCapt = capt ? `${ORIGEN}/rp/unirse/${capt.token}` : "";
  const mensajeCapt = () => `¿Quieres ser RRPP de mis eventos? 🎟️ Crea tu cuenta de RRPP y envíame tu solicitud aquí:\n${enlaceCapt}\n\nCon la misma cuenta ves todos tus eventos, tu enlace de venta de cada uno, tus ventas en directo y tu monedero.`;
  const crearCapt = () => run(async () => { ok(await supabase.from("ticket_rrpp_captacion").insert({})); }, "Enlace para RRPP creado");
  const cambiarCapt = () => window.confirm("¿Cambiar tu enlace para RRPP? El anterior dejará de funcionar (los RRPP que ya tienes siguen igual).") &&
    run(async () => { ok(await supabase.from("ticket_rrpp_captacion").update({ token: crypto.randomUUID() }).eq("token", capt.token)); }, "Enlace cambiado");
  const responder = (f, estado) => run(async () => { const r = ok(await supabase.rpc("rrpp_responder", { p_rrpp: f.rrpp_id, p_estado: estado })); if (!r?.ok) throw new Error("No se ha podido guardar"); },
    estado === "activa" ? `${f.nombre} ya es tu RRPP` : "Solicitud rechazada");
  const mensajePanel = (f) => `Hola ${String(f.nombre).split(" ")[0]} 👋 Este es tu panel de RRPP: ${enlacePanel(f)}\n\nAhí tienes tu enlace de venta y tu QR de cada evento, tus ventas en directo y tu comisión. Es personal, no lo compartas.`;

  const guardarCfg = () => run(async () => {
    const fila = { evento_id: ev.id, tipo: cfg.tipo, valor: Math.max(0, parseImporte(cfg.valor) || 0), efectivo: cfg.efectivo, actualizado_en: new Date().toISOString(),
      tramos: Object.fromEntries(Object.entries(cfg.tramos || {}).map(([k, v]) => [k, Math.max(0, parseImporte(v) || 0)]).filter(([, v]) => v > 0)) };
    if (fila.tipo === "porcentaje" && fila.valor > 100) throw new Error("El porcentaje no puede pasar de 100");
    ok(await supabase.from("ticket_rrpp_config").upsert(fila));
    setCfg(x => ({ ...x, cambiado: false }));
  }, "Comisión guardada");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!d.web && <div style={{ ...C.panel, borderColor: "color-mix(in srgb, var(--amber) 50%, var(--line))", fontSize: 14 }}><b>Este evento no tiene venta online en TIXFAST.</b> Actívala en Entradas › Venta online para que los RRPP tengan su enlace y puedan vender en efectivo.</div>}
      {d.web?.modo === "pruebas" && <div style={{ ...C.panel, fontSize: 14 }}><Badge c="var(--amber)">Pruebas</Badge> La venta está en modo pruebas: las ventas de los RRPP salen como prueba y no cuentan para la comisión.</div>}

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,minmax(0,1fr))" : "repeat(4,minmax(0,1fr))", gap: 12 }}>
        {[["Entradas de RRPP", String(tot.n), "por enlace y en efectivo"], ["Comisiones", money(tot.com), `${enEvento.length} RRPP en este evento`], ["Por liquidar", money(tot.pend), "comisión aún no pagada"], ["Efectivo en sus manos", money(tot.ef), "lo entregan al liquidar"]].map(([l, v, s]) => (
          <div key={l} style={C.card}><div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 700 }}>{l}</div><div style={{ fontSize: isMobile ? 20 : 24, fontWeight: 900, letterSpacing: -.4, marginTop: 4 }}>{v}</div><div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>{s}</div></div>))}
      </div>

      <section style={C.panel}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <Tile n="link" s={38} />
          <div style={{ flex: 1 }}><div style={{ fontWeight: 900, fontSize: 16 }}>Tu enlace para RRPP</div><div style={{ color: "var(--muted)", fontSize: 13 }}>Mándalo a quien quiera ser tu RRPP: crea su cuenta, pone sus datos y dónde cobra, y te llega su solicitud aquí. Sirve para todos tus eventos.</div></div>
        </div>
        {capt ? <>
          <div style={{ ...C.tag, display: "block", wordBreak: "break-all", padding: "8px 10px", borderRadius: 10 }}>{enlaceCapt}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <a href={wa(mensajeCapt())} target="_blank" rel="noopener noreferrer" style={{ ...C.btnSm, textDecoration: "none" }}><Icon n="whatsapp" s={15} />Mandar por WhatsApp</a>
            <button onClick={async () => { try { await navigator.clipboard.writeText(enlaceCapt); flash("Enlace copiado"); } catch { flash("No se ha podido copiar", "warn"); } }} style={C.btnSm}><Icon n="copy" s={15} />Copiar</button>
            <button onClick={cambiarCapt} disabled={busy} style={{ ...C.btnSm, color: "var(--muted)" }}><Icon n="refresh" s={15} />Cambiar enlace</button>
          </div>
        </> : <button onClick={crearCapt} disabled={busy || capt === undefined} style={C.btnPrimary}><Icon n="link" s={16} w={2.4} />Crear mi enlace para RRPP</button>}
      </section>

      {solicitudes.length > 0 && <section style={{ ...C.panel, borderColor: "color-mix(in srgb, var(--accent) 55%, var(--line))" }}>
        <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 4 }}>Solicitudes para ser tu RRPP <span style={{ color: "var(--muted)", fontWeight: 700 }}>· {solicitudes.length}</span></div>
        {solicitudes.map(f => (
          <div key={f.rrpp_id} style={{ borderTop: "1px solid var(--line)", padding: "12px 2px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <b style={{ fontSize: 15.5 }}>{f.nombre}</b><span style={{ ...C.tag, padding: "2px 8px", fontSize: 11.5, letterSpacing: 1 }}>{f.codigo}</span>
              {f.solicitado_en && <span style={{ color: "var(--muted)", fontSize: 12.5 }}>{new Date(f.solicitado_en).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}</span>}
            </div>
            <DatosCuenta p={f.perfil} />
            {f.mensaje && <div style={{ fontSize: 14, marginTop: 6, fontStyle: "italic" }}>«{f.mensaje}»</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button onClick={() => responder(f, "activa")} disabled={busy} style={C.btnPrimary}><Icon n="check" s={16} w={2.6} />Aceptar</button>
              <button onClick={() => window.confirm(`¿Rechazar la solicitud de ${f.nombre}?`) && responder(f, "rechazada")} disabled={busy} style={{ ...C.btnSm, color: "var(--muted)" }}><Icon n="x" s={15} />Rechazar</button>
            </div>
          </div>))}
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>Al aceptar, vende en todos tus eventos con la comisión de cada evento. Puedes quitarle de un evento o ponerle comisión propia en su ficha.</div>
      </section>}

      <section style={C.panel}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <Tile n="percent" s={38} />
          <div style={{ flex: 1 }}><div style={{ fontWeight: 900, fontSize: 16 }}>Comisión en este evento</div><div style={{ color: "var(--muted)", fontSize: 13 }}>La misma para todos los RRPP. Se puede cambiar para uno en su ficha.</div></div>
        </div>
        <div style={{ overflowX: "auto" }}><Seg size="sm" valor={cfg.tipo} onChange={(v) => setCfg(x => ({ ...x, tipo: v, cambiado: true }))} opciones={TIPOS} /></div>
        <div style={{ marginTop: 12 }}>
          {cfg.tipo !== "tramos"
            ? <div style={{ display: "flex", alignItems: "center", gap: 8, maxWidth: 260 }}>
                <input value={cfg.valor} inputMode="decimal" aria-label={cfg.tipo === "fija" ? "Euros por entrada" : "Porcentaje"} onChange={e => setCfg(x => ({ ...x, valor: e.target.value, cambiado: true }))} style={{ ...C.input, fontWeight: 900, fontSize: 18 }} />
                <b style={{ fontSize: 16, whiteSpace: "nowrap" }}>{cfg.tipo === "fija" ? "€ por entrada" : "% del precio"}</b>
              </div>
            : d.tramos.length ? d.tramos.map(t => (
                <div key={t.id} style={{ ...C.row, borderTop: "1px solid var(--line)" }}>
                  <span style={{ fontWeight: 800 }}>{t.nombre} <span style={{ color: "var(--muted)", fontWeight: 600 }}>· {money(t.precio)}</span></span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}><input value={cfg.tramos?.[t.id] ?? ""} inputMode="decimal" placeholder="0" aria-label={`Comisión ${t.nombre}`} onChange={e => setCfg(x => ({ ...x, tramos: { ...x.tramos, [t.id]: e.target.value }, cambiado: true }))} style={{ ...C.input, width: 90, textAlign: "right", fontWeight: 800 }} /> €</span>
                </div>))
              : <div style={C.empty}>Este evento aún no tiene tipos de entrada en la venta online.</div>}
        </div>
        <label style={{ ...C.toggleRow, marginTop: 14, cursor: "pointer" }}>
          <span>Los RRPP pueden vender en efectivo <span style={{ color: "var(--muted)", fontWeight: 600 }}>(emiten la entrada al momento desde su panel)</span></span>
          <input type="checkbox" checked={cfg.efectivo} onChange={e => setCfg(x => ({ ...x, efectivo: e.target.checked, cambiado: true }))} style={{ width: 22, height: 22, accentColor: "var(--accent)" }} />
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <button onClick={guardarCfg} disabled={busy || !cfg.cambiado} style={{ ...C.btnPrimary, opacity: cfg.cambiado ? 1 : .45 }}><Icon n="check" s={16} w={2.6} />Guardar comisión</button>
        </div>
      </section>

      <section style={C.panel}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>RRPP en este evento <span style={{ color: "var(--muted)", fontWeight: 700 }}>· {enEvento.length}</span></div>
          <button onClick={() => setFicha({})} style={C.btnSm}><Icon n="plus" s={15} w={2.4} />Añadir a mano</button>
        </div>
        {enEvento.length ? enEvento.map(f => (
          <FilaRRPP key={f.rrpp_id} f={f} tramos={d.tramos} cfg={d.cfg} isMobile={isMobile} onFicha={() => setFicha(f)} onLiquidar={() => setLiq(f)}
            onWhatsApp={() => window.open(f.cuenta ? wa("", f.telefono) : wa(mensajePanel(f), f.telefono), "_blank", "noopener")}
            onDeshacer={() => window.confirm(`¿Deshacer la liquidación de ${f.nombre}? Se borra también su gasto del CRM.`) && run(async () => { const r = ok(await supabase.rpc("rrpp_deshacer_liquidacion", { p_id: f.liquidacion.id })); if (!r?.ok) throw new Error("No se ha podido deshacer"); onDatos?.(); }, "Liquidación deshecha")} />
        )) : <div style={{ ...C.empty, marginTop: 8 }}>
          <div style={{ fontWeight: 800, color: "var(--text)", marginBottom: 6 }}>Aún no hay RRPP</div>
          Manda tu enlace para RRPP: cada uno crea su cuenta y te pide colaborar. Cuando le aceptes, verá tus eventos con su enlace de venta y su QR, y sus ventas en directo. También puedes añadir uno a mano.
        </div>}
        {fuera.length > 0 && <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontWeight: 800, color: "var(--muted)", fontSize: 13.5 }}>No venden en este evento · {fuera.length}</summary>
          {fuera.map(f => <div key={f.rrpp_id} style={{ ...C.row }}><span style={{ fontWeight: 800 }}>{f.nombre} {!f.activo && <Badge>En pausa</Badge>}</span><button onClick={() => setFicha(f)} style={C.btnSm}><Icon n="edit" s={14} />Ficha</button></div>)}
        </details>}
      </section>

      {ficha && <FichaRRPP key={ficha.rrpp_id || "nuevo"} f={ficha} ev={ev} tramos={d.tramos} busy={busy} onClose={() => setFicha(null)} mensaje={mensajePanel}
        onGuardar={async (x) => { const r = await run(() => guardarRRPP(x, ev.id), x.rrpp_id ? "RRPP actualizado" : "RRPP añadido"); if (r) setFicha(x.rrpp_id ? null : { ...r, rrpp_id: r.id, en_evento: true, propia: false, recien: true }); }}
        onNuevoEnlace={(x) => window.confirm(`¿Cambiar el enlace de ${x.nombre}? El anterior dejará de funcionar y tendrás que mandarle el nuevo.`) && run(async () => { ok(await supabase.from("ticket_rrpp").update({ acceso: crypto.randomUUID(), actualizado_en: new Date().toISOString() }).eq("id", x.rrpp_id)); setFicha(null); }, "Enlace cambiado: mándale el nuevo")} />}
      {liq && <Liquidar f={liq} busy={busy} onClose={() => setLiq(null)}
        onConfirmar={async (metodo, nota) => { const r = await run(async () => { const x = ok(await supabase.rpc("rrpp_liquidar", { p_evento: ev.id, p_rrpp: liq.rrpp_id, p_metodo: metodo, p_nota: nota })); if (!x?.ok) throw new Error(x?.motivo === "ya_liquidado" ? "Ya estaba liquidado" : "No se ha podido liquidar"); onDatos?.(); return x; }, "Liquidación apuntada"); if (r) setLiq(null); }} />}
    </div>
  );
}

async function guardarRRPP(x, eventoId) {
  const base = { nombre: String(x.nombre || "").trim().slice(0, 60), telefono: String(x.telefono || "").trim().slice(0, 30) || null, activo: x.activo !== false, actualizado_en: new Date().toISOString() };
  if (!base.nombre) throw new Error("Falta el nombre");
  let fila;
  if (x.rrpp_id) fila = ok(await supabase.from("ticket_rrpp").update(x.cuenta ? { activo: base.activo, actualizado_en: base.actualizado_en } : base).eq("id", x.rrpp_id).select("*").single());
  else {
    for (let i = 0; i < 5 && !fila; i++) {
      const { data, error } = await supabase.from("ticket_rrpp").insert({ ...base, codigo: nuevoCodigo(base.nombre) }).select("*").single();
      if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
      fila = data;
    }
    if (!fila) throw new Error("No se ha podido crear el código");
  }
  // En este evento: si vende y su comisión propia (o la del evento)
  const ev = { evento_id: eventoId, rrpp_id: fila.id, activo: x.en_evento !== false, actualizado_en: new Date().toISOString(),
    tipo: x.propia ? x.tipo : null, valor: x.propia && x.tipo !== "tramos" ? Math.max(0, parseImporte(x.valor) || 0) : null,
    tramos: x.propia && x.tipo === "tramos" ? Object.fromEntries(Object.entries(x.tramosC || {}).map(([k, v]) => [k, Math.max(0, parseImporte(v) || 0)]).filter(([, v]) => v > 0)) : null };
  if (x.propia && x.tipo === "porcentaje" && ev.valor > 100) throw new Error("El porcentaje no puede pasar de 100");
  ok(await supabase.from("ticket_rrpp_eventos").upsert(ev));
  return fila;
}

function FilaRRPP({ f, tramos, cfg, isMobile, onFicha, onLiquidar, onWhatsApp, onDeshacer }) {
  const l = f.liquidacion;
  const n = Number(f.online) + Number(f.efectivo_n);
  const resultado = r2(Number(f.comision) - Number(f.efectivo_importe));
  return (
    <div style={{ borderTop: "1px solid var(--line)", padding: "14px 2px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Tile n="megaphone" s={38} c={f.en_evento && f.activo ? "var(--accent)" : "var(--muted)"} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: 15.5, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>{f.nombre}<span style={{ ...C.tag, padding: "2px 8px", fontSize: 11.5, letterSpacing: 1 }}>{f.codigo}</span>{f.cuenta && <Badge c="var(--accent)">Cuenta</Badge>}{!f.activo && <Badge>En pausa</Badge>}{f.activo && !f.en_evento && <Badge>Ya no vende aquí</Badge>}</div>
          <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{f.propia ? `Comisión propia: ${describirComision(f, tramos)}` : `Comisión: ${describirComision(cfg, tramos)}`}{Number(f.pruebas) ? ` · ${f.pruebas} de prueba` : ""}</div>
        </div>
        <button onClick={onFicha} aria-label={`Ficha de ${f.nombre}`} style={{ ...C.btnSm, padding: "8px 10px" }}><Icon n="edit" s={15} /></button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,minmax(0,1fr))" : "repeat(4,minmax(0,1fr))", gap: 8, marginTop: 10 }}>
        <Mini t="Por enlace" v={f.online} />
        <Mini t="En efectivo" v={`${f.efectivo_n}${Number(f.efectivo_importe) ? ` · ${money(f.efectivo_importe)}` : ""}`} />
        <Mini t="Comisión" v={money(f.comision)} c="var(--accent)" />
        <Mini t={l ? "Liquidado" : resultado < 0 ? "Te debe" : "Le pagas"} v={money(Math.abs(l ? l.resultado : resultado))} c={l ? "var(--green)" : resultado < 0 ? "var(--amber)" : "var(--text)"} />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        {(!f.cuenta || f.telefono) && <button onClick={onWhatsApp} style={C.btnSm}><Icon n="whatsapp" s={15} />{f.cuenta ? "WhatsApp" : "Mandar su panel"}</button>}
        {l ? <>
          <span style={{ ...C.tag, color: "var(--green)" }}><Icon n="check" s={13} w={2.6} />Liquidado {l.metodo ? `· ${METODOS.find(m => m.k === l.metodo)?.t || l.metodo}` : ""} · {new Date(l.cerrada_en).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}</span>
          <button onClick={onDeshacer} style={{ ...C.btnSm, color: "var(--muted)" }}>Deshacer</button>
        </> : n > 0 && <button onClick={onLiquidar} style={{ ...C.btnSm, borderColor: "var(--accent)", color: "var(--accent)" }}><Icon n="wallet" s={15} />Liquidar</button>}
      </div>
    </div>
  );
}
const Mini = ({ t, v, c }) => <div style={{ background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 10px" }}><div style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 700 }}>{t}</div><div style={{ fontWeight: 900, fontSize: 15.5, color: c || "var(--text)" }}>{v}</div></div>;

function FichaRRPP({ f, tramos, busy, onClose, onGuardar, onNuevoEnlace, mensaje }) {
  const nuevo = !f.rrpp_id;
  const [x, setX] = useState(() => ({
    rrpp_id: f.rrpp_id, cuenta: !!f.cuenta, nombre: f.nombre || "", telefono: f.telefono || "", activo: f.activo !== false, en_evento: nuevo ? true : f.en_evento !== false,
    propia: !!f.propia, tipo: f.tipo || "fija", valor: f.valor != null ? String(f.valor).replace(".", ",") : "",
    tramosC: Object.fromEntries(Object.entries(f.tramos || {}).map(([k, v]) => [k, String(v).replace(".", ",")])),
  }));
  const set = (k, v) => setX(o => ({ ...o, [k]: v }));
  const enlace = f.acceso ? `${ORIGEN}/rp/${f.acceso}` : "";
  const sw = (v, on) => <button type="button" onClick={() => on(!v)} role="switch" aria-checked={v} style={{ ...C.switch, background: v ? "var(--accent)" : "var(--surface2)", border: "1px solid var(--line)" }}><span style={{ ...C.knob, transform: `translateX(${v ? 22 : 2}px)` }} /></button>;
  return (
    <Sheet title={nuevo ? "Nuevo RRPP" : f.nombre} onClose={onClose} footer={<button onClick={() => onGuardar(x)} disabled={busy || !x.nombre.trim()} style={{ ...C.btnPrimary, width: "100%", opacity: x.nombre.trim() ? 1 : .45 }}>{nuevo ? "Añadir RRPP" : "Guardar"}</button>}>
      {f.cuenta ? <Field l="Sus datos (los pone él en su cuenta)"><div style={{ ...C.card, padding: "10px 12px" }}><b>{f.nombre}</b> · código {f.codigo}<DatosCuenta p={f.perfil} copiar /></div></Field> : <>
      <Field l="Nombre"><input value={x.nombre} maxLength={60} onChange={e => set("nombre", e.target.value)} placeholder="Ej.: Nico" style={C.input} autoFocus={nuevo} /></Field>
      <Field l="Teléfono (para mandarle su panel)"><input value={x.telefono} maxLength={30} inputMode="tel" onChange={e => set("telefono", e.target.value)} placeholder="600 000 000" style={C.input} /></Field></>}
      {f.recien && <div style={{ ...C.card, borderColor: "var(--accent)", marginBottom: 14, fontSize: 14 }}><b>Listo.</b> Ahora mándale su panel: ahí tiene su enlace de venta y su QR de cada evento.</div>}
      {!nuevo && !f.cuenta && <Field l="Su panel">
        <div style={{ ...C.tag, display: "block", wordBreak: "break-all", padding: "8px 10px", borderRadius: 10 }}>{enlace}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <a href={wa(mensaje(f), x.telefono)} target="_blank" rel="noopener noreferrer" style={{ ...C.btnSm, textDecoration: "none" }}><Icon n="whatsapp" s={15} />Mandar por WhatsApp</a>
          <button onClick={async () => { try { await navigator.clipboard.writeText(enlace); } catch {} }} style={C.btnSm}><Icon n="copy" s={15} />Copiar</button>
          <button onClick={() => onNuevoEnlace(f)} style={{ ...C.btnSm, color: "var(--muted)" }}><Icon n="refresh" s={15} />Cambiar enlace</button>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Su código de venta: <b>{f.codigo}</b>. Solo ve sus ventas, nunca las de otros RRPP ni tu CRM.</div>
      </Field>}
      <div style={{ ...C.toggleRow, marginBottom: 14 }}><span>Vende en este evento</span>{sw(x.en_evento, v => set("en_evento", v))}</div>
      <div style={{ ...C.toggleRow, marginBottom: 14 }}><span>Comisión propia en este evento <span style={{ color: "var(--muted)", fontWeight: 600 }}>(si no, la del evento)</span></span>{sw(x.propia, v => set("propia", v))}</div>
      {x.propia && <div style={{ marginBottom: 14 }}>
        <div style={{ overflowX: "auto" }}><Seg size="sm" valor={x.tipo} onChange={v => set("tipo", v)} opciones={TIPOS} /></div>
        <div style={{ marginTop: 10 }}>
          {x.tipo !== "tramos"
            ? <div style={{ display: "flex", alignItems: "center", gap: 8 }}><input value={x.valor} inputMode="decimal" aria-label="Valor" onChange={e => set("valor", e.target.value)} style={{ ...C.input, maxWidth: 140, fontWeight: 900 }} /><b style={{ whiteSpace: "nowrap" }}>{x.tipo === "fija" ? "€ por entrada" : "% del precio"}</b></div>
            : tramos.map(t => <div key={t.id} style={C.row}><span style={{ fontWeight: 800 }}>{t.nombre}</span><span style={{ display: "flex", alignItems: "center", gap: 6 }}><input value={x.tramosC?.[t.id] ?? ""} inputMode="decimal" placeholder="0" aria-label={`Comisión ${t.nombre}`} onChange={e => set("tramosC", { ...x.tramosC, [t.id]: e.target.value })} style={{ ...C.input, width: 90, textAlign: "right" }} /> €</span></div>)}
        </div>
      </div>}
      {!nuevo && <div style={{ ...C.toggleRow, marginBottom: 6 }}><span>Activo <span style={{ color: "var(--muted)", fontWeight: 600 }}>(en pausa: no puede vender ni su código cuenta; sigue viendo lo que ya vendió)</span></span>{sw(x.activo, v => set("activo", v))}</div>}
    </Sheet>
  );
}

function Liquidar({ f, busy, onClose, onConfirmar }) {
  const [metodo, setMetodo] = useState(Number(f.comision) - Number(f.efectivo_importe) < 0 ? "efectivo" : f.perfil?.cobro === "transferencia" ? "transferencia" : "bizum");
  const [nota, setNota] = useState("");
  const res = r2(Number(f.comision) - Number(f.efectivo_importe));
  return (
    <Sheet title={`Liquidar a ${f.nombre}`} onClose={onClose} footer={<button onClick={() => onConfirmar(metodo, nota)} disabled={busy} style={{ ...C.btnPrimary, width: "100%" }}>{res > 0 ? `Apuntar: le he pagado ${money(res)}` : res < 0 ? `Apuntar: me ha entregado ${money(-res)}` : "Apuntar liquidación"}</button>}>
      <div style={{ fontSize: 15, lineHeight: 1.6 }}>
        <div style={C.row}><span>Entradas vendidas (sin pruebas)</span><b>{Number(f.online) + Number(f.efectivo_n)}</b></div>
        <div style={C.row}><span>Su comisión</span><b>{money(f.comision)}</b></div>
        <div style={C.row}><span>Efectivo que cobró él</span><b>− {money(f.efectivo_importe)}</b></div>
        <div style={{ ...C.row, fontSize: 18 }}><b>{res > 0 ? "Le pagas" : res < 0 ? "Te entrega" : "Resultado"}</b><b style={{ color: res < 0 ? "var(--amber)" : "var(--accent)" }}>{money(Math.abs(res))}</b></div>
      </div>
      {res > 0 && f.perfil && <Field l="Dónde cobra"><div style={{ ...C.card, padding: "10px 12px" }}><DatosCuenta p={f.perfil} soloCobro copiar /></div></Field>}
      <Field l={res < 0 ? "Cómo te lo entrega" : "Cómo le pagas"}><Seg full size="sm" valor={metodo} onChange={setMetodo} opciones={METODOS} /></Field>
      <Field l="Nota (opcional)" mb={6}><input value={nota} maxLength={500} onChange={e => setNota(e.target.value)} style={C.input} /></Field>
      <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>Se apunta la comisión como gasto del evento (Personal) y queda cerrada con estas cifras. Si luego hay devoluciones, deshaz y vuelve a liquidar. El pago en sí lo haces tú por {METODOS.find(m => m.k === metodo)?.t.toLowerCase()}: la pasarela llegará en la siguiente fase.</div>
    </Sheet>
  );
}

// Datos que el RRPP con cuenta pone en su perfil (quién es y dónde cobra)
const FISCAL = { particular: "Particular", autonomo: "Autónomo", empresa: "Empresa" };
function DatosCuenta({ p, soloCobro, copiar }) {
  if (!p) return null;
  const cobro = p.cobro === "transferencia" ? (p.cobro_iban ? `IBAN ${p.cobro_iban.replace(/(.{4})/g, "$1 ").trim()}` : "Transferencia (sin IBAN)") : `Bizum ${p.cobro_bizum || p.telefono}`;
  const dato = p.cobro === "transferencia" ? p.cobro_iban : (p.cobro_bizum || p.telefono);
  return (
    <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 4, lineHeight: 1.55 }}>
      {!soloCobro && <div>{[p.nombre_completo, p.telefono, p.email].filter(Boolean).join(" · ")}</div>}
      {!soloCobro && (p.ciudad || p.instagram) && <div>{[p.ciudad, p.instagram].filter(Boolean).join(" · ")}</div>}
      <div style={{ color: "var(--text)", fontWeight: 700 }}>
        <span style={{ display: "inline-flex", verticalAlign: "-2px", marginRight: 6 }}><Icon n={p.cobro === "transferencia" ? "bank" : "phone"} s={14} /></span>Cobra por {cobro}{p.cobro === "transferencia" && p.cobro_titular ? ` · ${p.cobro_titular}` : ""}
        {copiar && dato && <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(String(dato).replace(/\s/g, "")); } catch {} }} aria-label="Copiar dato de cobro" style={{ ...C.btnSm, padding: "3px 8px", fontSize: 12, marginLeft: 8, verticalAlign: "middle" }}><Icon n="copy" s={12} />Copiar</button>}
      </div>
      {!soloCobro && <div>{FISCAL[p.fiscal] || "Particular"}{p.nif ? ` · ${p.nif}` : " · sin NIF"}</div>}
    </div>
  );
}

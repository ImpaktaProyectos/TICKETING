// ===================== RESERVADOS · RESERVA ONLINE (configuración) =====================
// El enlace público del evento (/r/<token>) donde el cliente ve el plano, elige mesa, pack,
// botellas y mezclas, y paga el adelanto. El dinero va directo al monedero del organizador.
import React, { useEffect, useState } from "react";
import { supabase } from "./supabase";
import QrCodigo from "./qr/QrCodigo";
import { BEBIDAS, MEZCLAS } from "./reservados";

const ESTADO_PEDIDO = { pendiente: ["Pagando", "#c084fc"], pagado: ["Pagada", "var(--green)"], caducado: ["No pagó", "var(--muted)"], cancelado: ["Cancelada", "var(--muted)"], conflicto: ["Revisar: pagó tarde", "var(--red)"] };
const K = {
  panel: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 16, marginBottom: 14 },
  lbl: { display: "block", fontSize: 12, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: .7, margin: "14px 0 6px" },
  input: { width: "100%", boxSizing: "border-box", minHeight: 44, padding: "10px 12px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontSize: 16, font: "inherit" },
  btn: { minHeight: 44, padding: "0 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontWeight: 800, fontSize: 14, cursor: "pointer" },
  chip: (on) => ({ minHeight: 40, padding: "0 13px", borderRadius: 999, border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`, background: on ? "rgba(255,90,60,.12)" : "var(--surface2)", color: on ? "var(--accent)" : "var(--text)", fontWeight: 800, cursor: "pointer" }),
};
const money = (n) => (Number(n) || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const lista = (t) => [...new Set(String(t || "").split(/[,\n]/).map(x => x.trim()).filter(Boolean))].slice(0, 80);

export function ReservaOnlineConfig({ ev, cfg, flash, tieneplano }) {
  const [w, setW] = useState(undefined);       // undefined = cargando · null = aún no creado
  const [d, setD] = useState(null);
  const [cuenta, setCuenta] = useState(undefined);
  const [pedidos, setPedidos] = useState([]);
  const [busy, setBusy] = useState(false);
  const cargar = async () => {
    const [{ data: fila, error }, { data: c }, { data: ps }] = await Promise.all([
      supabase.from("ticket_reservas_web").select("*").eq("evento_id", ev.id).maybeSingle(),
      supabase.from("ticket_pago_cuentas").select("estado, recibe, modo").eq("tipo", "organizador"),
      supabase.from("ticket_reserva_pedidos").select("codigo, mesa, nombre, telefono, estado, adelanto, total, creado_en").eq("evento_id", ev.id).order("creado_en", { ascending: false }).limit(30),
    ]);
    if (error) { setW(false); return; }
    setW(fila || null);
    setD(fila ? { ...fila, bebidasT: (fila.bebidas || []).join(", "), mezclasT: (fila.mezclas || []).join(", ") } : null);
    setCuenta((c || []).find(x => x.estado === "activa" && x.recibe) || (c || [])[0] || null);
    setPedidos(ps || []);
  };
  useEffect(() => { cargar(); }, [ev.id]);
  const enlace = w?.token ? `${window.location.origin}/r/${w.token}` : "";
  const guardar = async (patch = {}) => {
    setBusy(true);
    const datos = { evento_id: ev.id, activo: d?.activo ?? false, adelanto_pct: Math.max(0, Math.min(100, parseInt(d?.adelanto_pct, 10) || 0)), max_extra: Math.max(0, Math.min(20, parseInt(d?.max_extra, 10) || 0)),
      condiciones: String(d?.condiciones || "").trim().slice(0, 2000) || null, bebidas: lista(d?.bebidasT), mezclas: lista(d?.mezclasT), actualizado_en: new Date().toISOString(), ...patch };
    const { error } = await supabase.from("ticket_reservas_web").upsert(datos, { onConflict: "evento_id" });
    setBusy(false);
    if (error) { flash("No se ha podido guardar", "warn"); return; }
    flash(datos.activo ? "🌐 Reserva online guardada" : "Reserva online guardada (desactivada)"); cargar();
  };
  const crear = async () => {
    setBusy(true);
    const { error } = await supabase.from("ticket_reservas_web").insert({ evento_id: ev.id, activo: false, adelanto_pct: 50, bebidas: BEBIDAS.slice(0, 14), mezclas: MEZCLAS });
    setBusy(false); if (error) { flash("No se ha podido crear el enlace", "warn"); return; } cargar();
  };
  const monedero = async () => {
    setBusy(true);
    try {
      const { data } = await supabase.functions.invoke("pagos", { body: { accion: "alta", tipo: "organizador", origen: window.location.origin } });
      if (data?.url) { window.location.assign(data.url); return; }
      flash(data?.motivo === "sin_pasarela" ? "Los cobros con tarjeta aún no están configurados en TIXFAST." : "No se ha podido abrir el alta del monedero", "warn");
    } catch { flash("No se ha podido abrir el alta del monedero", "warn"); }
    setBusy(false);
  };
  const copiar = async () => { try { await navigator.clipboard.writeText(enlace); flash("🔗 Enlace copiado"); } catch { flash("Mantén pulsado el enlace para copiarlo", "warn"); } };
  const tarifasOnline = cfg.tarifas.filter(t => t.online !== false && String(t.precio ?? "") !== "");

  if (w === undefined) return <div style={K.panel}>Cargando la reserva online…</div>;
  if (w === false) return <div style={{ ...K.panel, color: "var(--muted)" }}>La reserva online aún no está disponible en la base de datos.</div>;
  return (<div style={K.panel}>
    <div style={{ fontSize: 15.5, fontWeight: 800 }}>8 · Reserva online 🌐</div>
    <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>Un enlace para tus clientes: ven el plano en directo, eligen mesa, pack, botellas y mezclas, y pagan el adelanto. La mesa se bloquea mientras pagan y, si no terminan, se libera sola.</div>
    {!w ? <button type="button" disabled={busy} onClick={crear} style={{ ...K.btn, marginTop: 12, background: "var(--accent)", border: "none", color: "#fff" }}>Crear el enlace de reservas</button> : <>
      <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 14, padding: 12, borderRadius: 14, border: `1px solid ${d.activo ? "var(--green)" : "var(--line)"}`, cursor: "pointer" }}>
        <span><b>{d.activo ? "Reservas abiertas" : "Reservas cerradas"}</b><span style={{ display: "block", fontSize: 13, color: "var(--muted)" }}>{d.activo ? "El enlace funciona y acepta reservas." : "El enlace muestra que no hay reservas disponibles."}</span></span>
        <input type="checkbox" checked={!!d.activo} onChange={e => setD(x => ({ ...x, activo: e.target.checked }))} style={{ width: 24, height: 24, accentColor: "var(--green)" }} />
      </label>
      {d.activo && !tieneplano && <div style={{ fontSize: 13, color: "var(--amber)", marginTop: 8 }}>Consejo: diseña el plano de la sala (Mapa › Plano de la sala) para que tus clientes vean dónde está cada mesa. Sin plano verán una lista.</div>}
      {d.activo && !tarifasOnline.length && <div style={{ fontSize: 13, color: "var(--red)", marginTop: 8 }}>Falta al menos una tarifa con precio marcada como «Reservable por la web» (apartado 3).</div>}

      <div style={K.lbl}>Adelanto que se paga al reservar</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{[0, 25, 30, 50, 100].map(v => <button key={v} type="button" onClick={() => setD(x => ({ ...x, adelanto_pct: v }))} style={K.chip(Number(d.adelanto_pct) === v)}>{v === 0 ? "Sin pago" : `${v} %`}</button>)}</div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>{Number(d.adelanto_pct) === 0 ? "La reserva se confirma sin pagar nada (más riesgo de que no vengan)." : `El cliente paga el ${d.adelanto_pct} % al reservar y el resto en el local. Los gastos de gestión se suman aparte.`}</div>
      {Number(d.adelanto_pct) > 0 && (cuenta?.estado === "activa" && cuenta?.recibe
        ? <div style={{ fontSize: 13, color: "var(--green)", fontWeight: 700, marginTop: 8 }}>✓ Monedero de cobros activo: los adelantos llegan a tu cuenta.</div>
        : <div style={{ marginTop: 10, padding: 12, borderRadius: 12, border: "1px solid var(--amber)", fontSize: 13.5 }}>
            <b>Para cobrar por la web necesitas tu monedero de cobros.</b> Es una cuenta segura de Stripe a tu nombre donde llega el dinero{cuenta ? " (tienes el alta a medias)" : ""}.
            <button type="button" disabled={busy} onClick={monedero} style={{ ...K.btn, width: "100%", marginTop: 8, borderColor: "var(--amber)" }}>{cuenta ? "Terminar el alta del monedero" : "Activar mi monedero de cobros"}</button>
          </div>)}

      <div style={K.lbl}>Botellas extra que puede añadir cada reserva</div>
      <input value={d.max_extra ?? 4} inputMode="numeric" onChange={e => setD(x => ({ ...x, max_extra: e.target.value.replace(/\D/g, "").slice(0, 2) }))} style={{ ...K.input, maxWidth: 120 }} aria-label="Botellas extra" />
      <div style={K.lbl}>Bebidas que se ofrecen</div>
      <textarea value={d.bebidasT} onChange={e => setD(x => ({ ...x, bebidasT: e.target.value }))} rows={3} style={{ ...K.input, resize: "vertical" }} aria-label="Bebidas (separadas por comas)" />
      <div style={K.lbl}>Mezclas</div>
      <textarea value={d.mezclasT} onChange={e => setD(x => ({ ...x, mezclasT: e.target.value }))} rows={2} style={{ ...K.input, resize: "vertical" }} aria-label="Mezclas (separadas por comas)" />
      <div style={K.lbl}>Condiciones de la reserva</div>
      <textarea value={d.condiciones || ""} onChange={e => setD(x => ({ ...x, condiciones: e.target.value.slice(0, 2000) }))} rows={3} placeholder="Ej.: el adelanto no se devuelve si no vienes. La mesa se guarda hasta la 1:30. Edad mínima 18 años." style={{ ...K.input, resize: "vertical" }} />
      <button type="button" disabled={busy} onClick={() => guardar()} style={{ ...K.btn, width: "100%", marginTop: 12, background: "var(--accent)", border: "none", color: "#fff", minHeight: 50 }}>{busy ? "Guardando…" : "Guardar la reserva online"}</button>

      <div style={K.lbl}>Enlace para tus clientes</div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ background: "#fff", padding: 8, borderRadius: 12, lineHeight: 0 }}><QrCodigo texto={enlace} modulo={3} /></div>
        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, overflowWrap: "anywhere", color: "var(--accent)" }}>{enlace}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            <button type="button" onClick={copiar} style={K.btn}>🔗 Copiar</button>
            <a href={`https://wa.me/?text=${encodeURIComponent(`Reserva tu mesa VIP para ${ev.name}: ${enlace}`)}`} target="_blank" rel="noopener noreferrer" style={{ ...K.btn, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>WhatsApp</a>
            <a href={enlace} target="_blank" rel="noopener noreferrer" style={{ ...K.btn, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>Ver la página ↗</a>
          </div>
        </div>
      </div>

      {pedidos.length > 0 && <>
        <div style={K.lbl}>Últimas reservas por la web</div>
        {pedidos.map(p => { const [t, c] = ESTADO_PEDIDO[p.estado] || [p.estado, "var(--muted)"]; return (
          <div key={p.codigo} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--line)", fontSize: 14 }}>
            <div style={{ flex: 1, minWidth: 0 }}><b>{p.mesa}</b> · {p.nombre}<div style={{ fontSize: 12.5, color: "var(--muted)" }}>{p.codigo} · {p.telefono} · adelanto {money(p.adelanto)} de {money(p.total)}</div></div>
            <span style={{ fontSize: 11.5, fontWeight: 900, color: c, border: `1px solid ${c}`, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>{t}</span>
          </div>); })}
        {pedidos.some(p => p.estado === "conflicto") && <div style={{ fontSize: 12.5, color: "var(--red)", marginTop: 6 }}>«Pagó tarde»: pagó después de que su mesa se liberara y otra persona la reservó. Devuélvele el adelanto o búscale otra mesa.</div>}
      </>}
    </>}
  </div>);
}

// ===================== Monedero del organizador (Stripe) =====================
// Al acabar cada evento, lo cobrado por las entradas y los gastos de gestión, menos la comisión de TIXFAST y la de los RRPP
// con monedero, llega aquí solo.
// Desde aquí se pasa al banco. El alta (DNI/CIF y cuenta bancaria) la hace Stripe; TIXFAST no guarda esos datos.
import React, { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { C, Icon, Tile, Badge, money } from "./ui";
import { pagos } from "../web/pagosApi";

const ESTADO = { enviado: ["Recibido", "var(--green)"], sin_monedero: ["Esperando tu monedero", "var(--amber)"], nada: ["Nada que cobrar", "var(--muted)"], error: ["Reintentando", "var(--red)"], preparado: ["Enviando…", "var(--accent)"] };

export function MonederoOrganizador({ flash }) {
  const [m, setM] = useState(undefined);
  const [busy, setBusy] = useState("");
  const cargar = async () => {
    try { const r = await pagos(supabase, "monedero", { tipo: "organizador" }); setM(r?.ok ? r : r?.motivo === "sin_pasarela" ? null : "error"); }
    catch { setM("error"); }
  };
  useEffect(() => {
    cargar();
    try { const u = new URL(window.location.href); if (u.searchParams.get("monedero")) { u.searchParams.delete("monedero"); window.history.replaceState(null, "", u.pathname + u.search); } } catch {}
  }, []);
  if (m === undefined || m === null) return null;
  if (m === "error") return null;
  const alta = async () => {
    setBusy("alta");
    try { const r = await pagos(supabase, "alta", { tipo: "organizador" }); if (r?.url) { window.location.assign(r.url); return; } flash("No se ha podido abrir el alta en Stripe", "warn"); }
    catch { flash("No se ha podido abrir el alta en Stripe", "warn"); }
    setBusy("");
  };
  const retirar = async () => {
    if (!window.confirm(`¿Pasar ${money(m.saldo.disponible)} a tu banco?`)) return;
    setBusy("retirar");
    try {
      const r = await pagos(supabase, "retirar", { tipo: "organizador" });
      if (r?.ok) { flash(`Enviado a tu banco: ${money(r.importe)}`); await cargar(); }
      else flash(r?.motivo === "sin_saldo" ? "Aún no hay saldo disponible" : "No se ha podido enviar", "warn");
    } catch { flash("No se ha podido enviar", "warn"); }
    setBusy("");
  };
  const c = m.cuenta, s = m.saldo || { disponible: 0, en_camino: 0 };
  return (
    <section style={C.panel}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <Tile n="wallet" s={38} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: 16, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>Tu monedero {m.modo === "pruebas" && <Badge c="var(--amber)">Modo pruebas</Badge>}</div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Al acabar cada evento llega solo lo cobrado por las entradas y los gastos de gestión, menos la comisión de TIXFAST (te llega su factura en Facturación › Gastos) y la de tus RRPP con monedero.</div>
        </div>
      </div>
      {!c ? <button onClick={alta} disabled={!!busy} style={C.btnPrimary}><Icon n="wallet" s={16} />{busy ? "Abriendo Stripe…" : "Activar mi monedero"}</button>
        : c.estado !== "activa" ? <>
          <div style={{ fontSize: 13.5, color: "var(--amber)", fontWeight: 700, marginBottom: 8 }}>{c.estado === "revision" ? "Stripe está revisando tus datos." : "Te falta terminar el alta en Stripe."}</div>
          <button onClick={alta} disabled={!!busy} style={C.btnPrimary}>{busy ? "Abriendo Stripe…" : c.estado === "revision" ? "Revisar mis datos" : "Terminar el alta"}</button>
        </> : <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ ...C.card, padding: "10px 12px" }}><div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 800 }}>Disponible</div><div style={{ fontSize: 22, fontWeight: 900 }}>{money(s.disponible)}</div></div>
            <div style={{ ...C.card, padding: "10px 12px" }}><div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 800 }}>En camino</div><div style={{ fontSize: 22, fontWeight: 900 }}>{money(s.en_camino)}</div></div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
            <button onClick={retirar} disabled={!!busy || !(s.disponible > 0)} style={{ ...C.btnPrimary, opacity: busy || !(s.disponible > 0) ? .5 : 1 }}><Icon n="bank" s={16} />{busy === "retirar" ? "Enviando…" : "Pasar a mi banco"}</button>
            {c.banco && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Cuenta {c.banco} · llega en 1-2 días laborables</span>}
          </div>
        </>}
      {(m.repartos?.length > 0) && <div style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Repartos de tus eventos</div>
        {m.repartos.map(r => { const [t, col] = ESTADO[r.estado] || [r.estado, "var(--muted)"]; return (
          <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderTop: "1px solid var(--line)", fontSize: 13.5 }}>
            <div style={{ minWidth: 0 }}><b>{r.evento}</b> · {r.beneficiario === "rrpp" ? `RRPP ${r.detalle?.nombre || ""}` : "para ti"}<div style={{ color: col, fontSize: 12, fontWeight: 800 }}>{t}{r.beneficiario === "rrpp" && r.estado === "sin_monedero" ? " · sin monedero: le pagas tú" : ""}</div>
              {r.beneficiario === "organizador" && Number(r.detalle?.comision) > 0 && <div style={{ color: "var(--muted)", fontSize: 12 }}>Entradas {money(r.detalle.cobrado)}{Number(r.detalle.gastos) > 0 ? ` + gastos ${money(r.detalle.gastos)}` : ""} − comisión TIXFAST {money(r.detalle.comision)}{Number(r.detalle.a_rrpp) > 0 ? ` − RRPP ${money(r.detalle.a_rrpp)}` : ""}</div>}</div>
            <b style={{ flexShrink: 0 }}>{money(r.importe)}</b>
          </div>); })}
      </div>}
    </section>
  );
}

// ===================== CRM · PANEL: avisos, venta online en directo y ranking de RRPP =====================
// Lo que el Panel del evento añade para que, de un vistazo, se sepa qué hacer:
//   · Avisos: lo pendiente (cierre Z, pagos, RRPP…) con un botón que lleva a donde se arregla.
//   · Venta online: visitas de la página del evento (también en los últimos 15 minutos) y cuántas acaban comprando.
//   · Ranking de RRPP: quién vende más entradas en este evento.
import React, { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { money, C, Icon } from "./ui";

const pct = (a, b) => (b ? Math.round((a - b) / Math.abs(b) * 100) : null);
const terminado = (ev) => {
  const fin = ev?.endsAt ? new Date(ev.endsAt) : ev?.date ? new Date(`${ev.date}T23:59:59`) : null;
  return fin && !isNaN(fin) ? fin < new Date() : false;
};
const diasHasta = (ev) => {
  if (!ev?.date) return null;
  const d = new Date(`${ev.date}T12:00:00`); if (isNaN(d)) return null;
  return Math.round((d - new Date()) / 86400000);
};

// Datos online del evento: RRPP, visitas y estado de la web. Las visitas se refrescan cada 30 s.
export function useDatosOnline(ev) {
  const [d, setD] = useState({ rrpp: null, visitas: null, web: undefined });
  useEffect(() => {
    let vivo = true;
    const sinErr = (p) => p.then(r => (r.error ? null : r.data), () => null);
    const visitas = () => sinErr(supabase.rpc("web_visitas_resumen", { p_evento: ev.id })).then(v => vivo && setD(x => ({ ...x, visitas: v || false })));
    setD({ rrpp: null, visitas: null, web: undefined });
    Promise.all([
      sinErr(supabase.rpc("rrpp_resumen", { p_evento: ev.id })),
      sinErr(supabase.from("ticket_web_eventos").select("slug, estado").eq("evento_id", ev.id).maybeSingle()),
    ]).then(([rrpp, web]) => vivo && setD(x => ({ ...x, rrpp: Array.isArray(rrpp) ? rrpp : null, web: web || null })));
    visitas();
    const t = setInterval(() => { if (document.visibilityState !== "hidden") visitas(); }, 30000);
    return () => { vivo = false; clearInterval(t); };
  }, [ev.id]);
  return d;
}

const vendidasRP = (r) => (Number(r.online) || 0) + (Number(r.efectivo_n) || 0);

/* ---------- Avisos ---------- */
export function AvisosEvento({ R, anterior, ev, sales, online, onIr, onIrTPV }) {
  const lista = [];
  const fin = terminado(ev);
  const sinZ = sales.filter(s => s.eventId === ev.id && !s.voided && !s.closureId).length;
  if (fin && sinZ > 0) lista.push({ c: "var(--red)", i: "alert", t: `Hay ${sinZ} ${sinZ === 1 ? "venta" : "ventas"} en el TPV sin cierre Z`, sub: "Haz el cierre Z de cada barra para cuadrar la caja.", b: "Ir al TPV", f: onIrTPV });
  if (R.G.pendiente > 0.005) lista.push({ c: "var(--amber)", i: "receipt", t: `Quedan ${money(R.G.pendiente)} de gastos por pagar`, sub: "Márcalos como pagados cuando los pagues.", b: "Ver gastos", f: () => onIr("gastos") });
  const pasados = Object.values(R.G.porCat || {}).filter(v => v.previsto > 0 && v.total > v.previsto + 0.005).length;
  if (pasados > 0) lista.push({ c: "var(--amber)", i: "scale", t: `${pasados} ${pasados === 1 ? "partida de gasto se pasa" : "partidas de gasto se pasan"} de lo previsto`, sub: "Revisa en qué se ha gastado más de la cuenta.", b: "Ver gastos", f: () => onIr("gastos") });
  const rr = online.rrpp || [];
  const solicitudes = rr.filter(r => r.estado === "solicitada").length;
  if (solicitudes > 0) lista.push({ c: "var(--accent)", i: "users", t: `${solicitudes} ${solicitudes === 1 ? "persona quiere" : "personas quieren"} ser RRPP`, sub: "Acepta o rechaza su solicitud.", b: "Ver RRPP", f: () => onIr("rrpp") });
  const sinLiquidar = rr.filter(r => Number(r.comision) > 0 && !r.liquidacion).length;
  if (fin && sinLiquidar > 0) lista.push({ c: "var(--amber)", i: "cash", t: `${sinLiquidar} ${sinLiquidar === 1 ? "RRPP pendiente" : "RRPP pendientes"} de liquidar`, sub: "Págales su comisión y apúntalo.", b: "Ver RRPP", f: () => onIr("rrpp") });
  const dias = diasHasta(ev);
  if (online.web !== undefined && !fin && dias != null && dias >= 0 && dias <= 21 && online.web?.estado !== "publicado")
    lista.push({ c: "var(--amber)", i: "globe", t: online.web ? "La venta online no está publicada" : "Este evento aún no tiene venta online", sub: dias === 0 ? "El evento es hoy." : `Faltan ${dias} ${dias === 1 ? "día" : "días"} para el evento.`, b: "Ir a Entradas", f: () => onIr("entradas") });
  const personas = Number(online.visitas?.personas) || 0;
  const vendidasOnline = rr.reduce((a, r) => a + (Number(r.online) || 0), 0);
  if (!fin && personas >= 50 && R.ingresos === 0 && vendidasOnline === 0)
    lista.push({ c: "var(--amber)", i: "eye", t: `${personas} personas han visto la página y nadie ha comprado`, sub: "Revisa el precio, las fotos o el texto de la venta.", b: "Ir a Entradas", f: () => onIr("entradas") });
  const d = anterior ? pct(R.ingresos, anterior.ingresos) : null;
  if (d != null && d <= -20) lista.push({ c: "var(--amber)", i: "trend", t: `Llevas un ${Math.abs(d)} % menos de ingresos que en ${anterior.ev.name}`, sub: fin ? "Compáralo en «Todos los eventos»." : "Aún estás a tiempo: comparte el enlace de venta y mueve a tus RRPP." });

  if (lista.length === 0) return (
    <div style={{ ...C.panel, display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "12px 16px" }}>
      <Icon n="check" s={18} c="var(--green)" /><span style={{ fontWeight: 800 }}>Todo en orden</span><span style={{ color: "var(--muted)", fontSize: 13.5 }}>· no hay nada pendiente en este evento</span>
    </div>
  );
  return (
    <div style={{ ...C.panel, marginBottom: 14, padding: "12px 16px" }}>
      <div style={{ fontWeight: 900, display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}><Icon n="alert" s={17} c="var(--accent)" />Pendiente <span style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>· {lista.length}</span></div>
      {lista.map((a, k) => (
        <div key={k} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: k ? "1px solid var(--line)" : "none", flexWrap: "wrap" }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", flexShrink: 0, background: `color-mix(in srgb, ${a.c} 15%, transparent)` }}><Icon n={a.i} s={17} c={a.c} /></span>
          <div style={{ flex: "1 1 180px", minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 14.5 }}>{a.t}</div>
            <div style={{ color: "var(--muted)", fontSize: 13 }}>{a.sub}</div>
          </div>
          {a.f && <button onClick={a.f} style={C.btnSm}>{a.b} <Icon n="right" s={14} c="currentColor" /></button>}
        </div>
      ))}
    </div>
  );
}

/* ---------- Venta online en directo ---------- */
export function VentaOnline({ online }) {
  const v = online.visitas;
  if (online.web === undefined) return null;
  if (!online.web) return null;
  const rr = online.rrpp || [];
  const vendidas = rr.reduce((a, r) => a + (Number(r.online) || 0), 0);
  const personas = Number(v?.personas) || 0;
  const conv = personas > 0 && vendidas > 0 ? Math.round(vendidas / personas * 1000) / 10 : null;
  const ult = Number(v?.ultimos15) || 0;
  const Dato = ({ n, l, c }) => <div style={{ minWidth: 0 }}><div style={{ fontSize: 26, fontWeight: 900, color: c, lineHeight: 1.1 }}>{n}</div><div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>{l}</div></div>;
  return (
    <div style={C.panel}>
      <div style={{ fontWeight: 900, display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <Icon n="eye" s={17} c="var(--accent)" />Visitas de la página de venta
        {ult > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 800, color: "var(--green)" }}><span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--green)" }} />{ult} ahora</span>}
      </div>
      {v === null ? <div style={{ color: "var(--muted)", fontSize: 13.5 }}>Cargando visitas…</div> : v === false ? <div style={{ color: "var(--muted)", fontSize: 13.5 }}>Las visitas aún no están disponibles.</div> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10 }}>
          <Dato n={personas} l="Personas" />
          <Dato n={Number(v.hoy) || 0} l="Hoy" />
          <Dato n={ult} l="Últimos 15 min" c={ult > 0 ? "var(--green)" : undefined} />
        </div>
      )}
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--line)", fontSize: 13.5, color: "var(--muted)" }}>
        {conv != null ? <>De cada 100 personas que entran, compran <b style={{ color: "var(--text)" }}>{String(conv).replace(".", ",")}</b>.</> : online.web.estado === "publicado" ? "Comparte el enlace de venta para empezar a recibir visitas." : "La página de venta no está publicada todavía."}
      </div>
    </div>
  );
}

/* ---------- Ranking de RRPP ---------- */
export function RankingRRPP({ online, onIr }) {
  const rr = (online.rrpp || []).filter(r => r.estado !== "solicitada" && (vendidasRP(r) > 0 || r.en_evento));
  if (!online.rrpp || rr.length === 0) return null;
  const visitasRP = online.visitas?.por_rrpp || {};
  const orden = [...rr].sort((a, b) => vendidasRP(b) - vendidasRP(a) || String(a.nombre).localeCompare(String(b.nombre))).slice(0, 5);
  const max = Math.max(1, ...orden.map(vendidasRP));
  const medalla = ["var(--amber)", "var(--muted)", "var(--accent)"];
  return (
    <div style={C.panel}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{ fontWeight: 900, display: "flex", alignItems: "center", gap: 8 }}><Icon n="award" s={17} c="var(--accent)" />Quién vende más</div>
        <button onClick={() => onIr("rrpp")} style={C.btnSm}>Ver RRPP <Icon n="right" s={14} c="currentColor" /></button>
      </div>
      {orden.map((r, i) => {
        const n = vendidasRP(r), vis = Number(visitasRP[String(r.codigo || "").toUpperCase()]) || 0;
        return (
          <div key={r.rrpp_id} style={{ padding: "8px 0", borderTop: "1px solid var(--line)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
              <span style={{ width: 24, height: 24, borderRadius: 12, flexShrink: 0, display: "grid", placeItems: "center", fontSize: 12.5, fontWeight: 900, background: i < 3 && n > 0 ? `color-mix(in srgb, ${medalla[i]} 22%, transparent)` : "var(--surface2)", color: i < 3 && n > 0 ? medalla[i] : "var(--muted)" }}>{i + 1}</span>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.nombre}</span>
              <b>{n} {n === 1 ? "entrada" : "entradas"}</b>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 5, paddingLeft: 34 }}>
              <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--surface2)" }}><div style={{ width: `${n / max * 100}%`, height: "100%", borderRadius: 3, background: "var(--accent)" }} /></div>
              <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>{vis} {vis === 1 ? "visita" : "visitas"}{Number(r.comision) > 0 ? ` · ${money(r.comision)}` : ""}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

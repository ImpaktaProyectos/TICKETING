// ===================== CRM · LIQUIDACIÓN DE SOCIOS (fase 3) =====================
// A recibir = beneficio × % del socio − dinero del evento que tiene + lo que pagó de su bolsillo.
// La suma de lo que se paga a los socios = dinero de la empresa (se comprueba siempre).
import React, { useState } from "react";
import { money, r2, useIsMobile, Dot, C, Icon, Tile } from "./ui";

const pctTxt = (v) => String(r2(v)).replace(".", ",") + " %";

export function calcularLiquidacion({ ev, tpv, ingresos, G, participacion, socios }) {
  const cobradosManual = ingresos.filter(i => i.estado === "cobrado");
  const ingresosCobrados = r2(tpv + cobradosManual.reduce((t, i) => t + i.importe, 0));
  const pendienteCobro = r2(ingresos.filter(i => i.estado === "pendiente").reduce((t, i) => t + i.importe, 0));
  const tiene = {};
  cobradosManual.filter(i => i.cobradoPor && !i.entregado).forEach(i => { tiene[i.cobradoPor] = r2((tiene[i.cobradoPor] || 0) + i.importe); });
  const adelanto = G.pagadoSocio || {};
  const gastosTotal = r2(G.total);
  const beneficio = r2(ingresosCobrados - gastosTotal);
  const sumTiene = r2(Object.values(tiene).reduce((t, v) => t + v, 0));
  const sumAdel = r2(Object.values(adelanto).reduce((t, v) => t + v, 0));
  const ingEmpresa = r2(ingresosCobrados - sumTiene);
  const gEmpresa = r2(gastosTotal - sumAdel);
  const cajaEmpresa = r2(ingEmpresa - gEmpresa);

  const part = participacion.filter(p => socios.some(s => s.id === p.socioId));
  const sumPct = r2(part.reduce((t, p) => t + p.porcentaje, 0));
  const pctOk = part.length > 0 && Math.abs(sumPct - 100) < 0.01;
  // Socios que no participan pero tienen dinero del evento o adelantaron gastos: también se liquidan (con 0 %)
  const ids = [...part.map(p => p.socioId), ...[...Object.keys(tiene), ...Object.keys(adelanto)].filter(id => !part.some(p => p.socioId === id) && socios.some(s => s.id === id))];
  const unicos = Array.from(new Set(ids));
  let repartido = 0;
  const conPct = unicos.filter(id => (part.find(p => p.socioId === id)?.porcentaje || 0) > 0);
  const ultimo = conPct[conPct.length - 1];
  const filas = unicos.map(id => {
    const s = socios.find(x => x.id === id);
    const pct = part.find(p => p.socioId === id)?.porcentaje || 0;
    let parte = 0;
    if (pct > 0) { parte = id === ultimo ? r2(beneficio - repartido) : r2(beneficio * pct / 100); repartido = r2(repartido + parte); }
    const t = tiene[id] || 0, a = adelanto[id] || 0;
    return { socioId: id, nombre: s?.nombre || "Socio", telefono: s?.telefono || "", color: s?.color || "", pct, parte, tiene: t, adelanto: a, resultado: r2(parte - t + a), pagado: false };
  });
  const sumResultado = r2(filas.reduce((t, f) => t + f.resultado, 0));
  return {
    evento: ev.name, fecha: ev.date || "", calculadoEn: new Date().toISOString(),
    ingresosCobrados, pendienteCobro, gastosTotal, gastosPendientes: r2(G.pendiente || 0), beneficio,
    comisiones: r2((G.auto || []).filter(a => a.categoria === "Comisiones").reduce((t, a) => t + a.importe, 0)),
    ivaHacienda: r2((G.auto || []).filter(a => a.categoria === "IVA a Hacienda").reduce((t, a) => t + a.importe, 0)),
    ingEmpresa, gEmpresa, cajaEmpresa, sumPct, pctOk, filas, cuadra: Math.abs(sumResultado - cajaEmpresa) < 0.011,
  };
}

const waNumero = (tel) => {
  let d = String(tel || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1); else if (d.startsWith("00")) d = d.slice(2);
  if (/^[6789]\d{8}$/.test(d)) d = "34" + d;
  return d;
};
export function mensajeWhatsApp(L, f) {
  const lineas = [
    `*Liquidación ${L.evento}*${L.fecha ? ` (${L.fecha.split("-").reverse().join("/")})` : ""}`,
    ``,
    `Resultado cobrado del evento: ${money(L.beneficio)}`,
    `Tu parte (${pctTxt(f.pct)}): ${money(f.parte)}`,
  ];
  if (f.tiene) lineas.push(`− Dinero del evento que tienes: ${money(f.tiene)}`);
  if (f.adelanto) lineas.push(`+ Lo que pagaste de tu bolsillo: ${money(f.adelanto)}`);
  lineas.push(``, f.resultado >= 0 ? `👉 *Te toca recibir: ${money(f.resultado)}*` : `👉 *Tienes que entregar: ${money(-f.resultado)}*`);
  return lineas.join("\n");
};
const waLink = (L, f) => { const n = waNumero(f.telefono); return `https://wa.me/${n}?text=${encodeURIComponent(mensajeWhatsApp(L, f))}`; };

export function Liquidacion({ L, guardada, busy, onCerrar, onReabrir, onMarcarPagado, onIrSocios, onIrIngresos }) {
  const isMobile = useIsMobile();
  const [confirmReabrir, setConfirmReabrir] = useState(false);
  const cerrada = !!guardada;
  const V = cerrada ? guardada.datos : L;          // lo que se muestra: congelado si está cerrada
  const cambios = cerrada && (Math.abs((guardada.datos.beneficio || 0) - L.beneficio) >= 0.01 || JSON.stringify((guardada.datos.filas || []).map(f => [f.socioId, f.resultado])) !== JSON.stringify(L.filas.map(f => [f.socioId, f.resultado])));
  const puedeCerrar = L.pctOk && L.cuadra && L.filas.length > 0;
  const pagados = (V.filas || []).filter(f => f.pagado).length;

  return (
    <div>
      {cerrada && (
        <div style={{ ...C.panel, borderColor: "var(--green)", background: "rgba(34,211,166,.08)", marginBottom: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Tile n="lock" c="var(--green)" s={42} />
          <span style={{ flex: "1 1 220px" }}>
            <b style={{ display: "block" }}>Liquidación cerrada el {new Date(guardada.cerradaEn).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</b>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Las cifras están congeladas. {pagados}/{(V.filas || []).length} pagos hechos.</span>
          </span>
          {confirmReabrir
            ? <span style={{ display: "flex", gap: 6 }}><button disabled={busy} onClick={() => { setConfirmReabrir(false); onReabrir(); }} style={{ ...C.small, color: "var(--amber)", borderColor: "var(--amber)" }}><Icon n="check" s={16} c="currentColor" style={{ verticalAlign: "-3px", marginRight: 6 }} />Sí, reabrir</button><button onClick={() => setConfirmReabrir(false)} style={C.small} aria-label="Cancelar"><Icon n="x" s={14} /></button></span>
            : <button onClick={() => setConfirmReabrir(true)} style={C.small}>↺ Reabrir</button>}
        </div>
      )}
      {cambios && <div style={{ ...C.panel, borderColor: "var(--amber)", color: "var(--amber)", fontWeight: 700, marginBottom: 14 }}><Icon n="alert" s={16} c="currentColor" style={{ verticalAlign: "-3px", marginRight: 6 }} />Desde el cierre han cambiado ingresos, gastos o socios: ahora el beneficio sería {money(L.beneficio)}. Reabre la liquidación si quieres recalcularla.</div>}

      {/* Beneficio a repartir */}
      <div style={{ ...C.hero, padding: isMobile ? 16 : 22, marginBottom: 14 }}>
        <div style={C.label}>Resultado cobrado · a repartir · {V.evento}</div>
        <div style={{ fontSize: isMobile ? 38 : 46, fontWeight: 900, letterSpacing: "-.02em", lineHeight: 1.05, margin: "4px 0 8px", color: V.beneficio >= 0 ? "var(--green)" : "var(--red)" }}>{money(V.beneficio)}</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "-2px 0 10px" }}>Solo cuenta lo que ya está cobrado. El «Resultado previsto» del Panel y de Gastos suma también lo pendiente de cobrar.</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span style={C.tag}><Icon n="wallet" s={14} c="currentColor" style={{ verticalAlign: "-3px", marginRight: 6 }} />Ingresos cobrados {money(V.ingresosCobrados)}</span>
          <span style={C.tag}><Icon n="receipt" s={14} c="currentColor" style={{ verticalAlign: "-3px", marginRight: 6 }} />Gastos {money(V.gastosTotal)}</span>
          <span style={C.tag}><Icon n="building" s={14} c="currentColor" style={{ verticalAlign: "-3px", marginRight: 6 }} />Dinero de la empresa {money(V.cajaEmpresa)}</span>
          {V.comisiones > 0 && <span style={C.tag}><Icon n="percent" s={14} c="currentColor" style={{ verticalAlign: "-3px", marginRight: 6 }} />Incluye comisiones {money(V.comisiones)}</span>}
          {V.ivaHacienda ? <span style={C.tag}><Icon n="bank" s={14} c="currentColor" style={{ verticalAlign: "-3px", marginRight: 6 }} />{V.ivaHacienda > 0 ? "Reserva IVA a Hacienda" : "IVA a devolver"} {money(Math.abs(V.ivaHacienda))}</span> : null}
        </div>
        {V.beneficio < 0 && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>El evento pierde dinero: la misma cuenta dice cuánto pone cada socio.</div>}
      </div>

      {/* Avisos antes de cerrar */}
      {!cerrada && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
          {!L.filas.length && <Aviso>Aún no hay socios en este evento. <button onClick={onIrSocios} style={C.small}>Ir a Socios</button></Aviso>}
          {L.filas.length > 0 && !L.pctOk && <Aviso>El reparto suma {pctTxt(L.sumPct)}: tiene que sumar 100 %. <button onClick={onIrSocios} style={C.small}>Ajustar en Socios</button></Aviso>}
          {L.pendienteCobro > 0 && <Aviso>Hay {money(L.pendienteCobro)} pendientes de cobrar: no entran en el reparto hasta que se cobren. <button onClick={onIrIngresos} style={C.small}>Ver ingresos</button></Aviso>}
          {L.gastosPendientes > 0 && <Aviso tipo="info">Hay {money(L.gastosPendientes)} en gastos aún sin pagar: ya están descontados y la empresa debe guardarlos para pagarlos.</Aviso>}
        </div>
      )}

      {/* Una tarjeta por socio */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill,minmax(300px,1fr))", gap: 12, marginBottom: 14 }}>
        {(V.filas || []).map(f => { const recibe = f.resultado >= 0; return (
          <div key={f.socioId} style={{ ...C.card, padding: 16, borderTop: `3px solid ${f.color || "var(--accent)"}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900, fontSize: 17, minWidth: 0 }}><Dot c={f.color} />{f.nombre}</span>
              <span style={{ ...C.tag, flexShrink: 0 }}>{pctTxt(f.pct)}</span>
            </div>
            <Linea l={V.beneficio < 0 ? "Su parte de la pérdida" : "Su parte del resultado"} v={money(f.parte)} />
            {f.tiene > 0 && <Linea l="− Dinero del evento que tiene" v={"−" + money(f.tiene)} c="var(--amber)" />}
            {f.adelanto > 0 && <Linea l="+ Pagó de su bolsillo" v={"+" + money(f.adelanto)} c="#60a5fa" />}
            <div style={{ marginTop: 10, padding: "12px 14px", borderRadius: 12, background: recibe ? "rgba(34,211,166,.12)" : "rgba(255,180,0,.12)", border: `2px solid ${recibe ? "var(--green)" : "var(--amber)"}`, textAlign: "center" }}>
              <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: recibe ? "var(--green)" : "var(--amber)" }}>{recibe ? "Le toca recibir" : "Tiene que entregar"}</div>
              <div style={{ fontSize: 30, fontWeight: 900, color: recibe ? "var(--green)" : "var(--amber)" }}>{money(Math.abs(f.resultado))}</div>
              {recibe && V.beneficio < 0 && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>de lo que adelantó, menos su parte de la pérdida</div>}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <a href={waLink(V, f)} target="_blank" rel="noopener noreferrer" style={{ ...C.ghost, flex: 1, textAlign: "center", textDecoration: "none", background: "rgba(37,211,102,.14)", borderColor: "rgba(37,211,102,.55)", color: "#4ade80", fontWeight: 900 }}><Icon n="whatsapp" s={16} c="currentColor" style={{ verticalAlign: "-3px", marginRight: 6 }} />WhatsApp</a>
              {cerrada && <button disabled={busy} onClick={() => onMarcarPagado(f.socioId, !f.pagado)} style={{ ...C.ghost, flex: 1, fontWeight: 900, ...(f.pagado ? { background: "var(--green)", color: "#04241b", borderColor: "var(--green)" } : {}) }}>{f.pagado ? <><Icon n="check" s={15} w={2.6} style={{ verticalAlign: "-3px", marginRight: 6 }} />Hecho</> : recibe ? "Marcar pagado" : "Marcar recibido"}</button>}
            </div>
            {!f.telefono && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, textAlign: "center" }}>Sin teléfono: WhatsApp te dejará elegir el contacto.</div>}
          </div>); })}
      </div>

      {/* Comprobación */}
      {(V.filas || []).length > 0 && (
        <div style={{ ...C.panel, marginBottom: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Tile n={V.cuadra ? "check" : "alert"} c={V.cuadra ? "var(--green)" : "var(--amber)"} s={38} />
          <span style={{ flex: "1 1 240px", fontSize: 13.5 }}>
            <b>{V.cuadra ? "La cuenta cuadra." : "La cuenta no cuadra."}</b> Lo que se paga a los socios ({money(r2((V.filas || []).reduce((t, f) => t + f.resultado, 0)))}) es el dinero de la empresa: {money(V.ingEmpresa)} cobrados − {money(V.gEmpresa)} de gastos = {money(V.cajaEmpresa)}.
          </span>
        </div>
      )}

      {!cerrada && L.filas.length > 0 && (
        <button disabled={!puedeCerrar || busy} onClick={() => onCerrar(L)} style={{ ...C.primary, width: "100%", padding: 18, fontSize: 17, opacity: puedeCerrar && !busy ? 1 : .45 }}><Icon n="lock" s={18} c="currentColor" style={{ verticalAlign: "-3px", marginRight: 6 }} />Cerrar liquidación y congelar cifras</button>
      )}
    </div>
  );
}

const Linea = ({ l, v, c }) => <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 0", fontSize: 14 }}><span style={{ color: "var(--muted)" }}>{l}</span><b style={{ color: c || "var(--text)" }}>{v}</b></div>;
const Aviso = ({ children, tipo }) => <div style={{ ...C.panel, padding: "10px 14px", borderColor: tipo === "info" ? "var(--line)" : "rgba(255,180,0,.55)", color: tipo === "info" ? "var(--muted)" : "var(--amber)", fontWeight: 700, fontSize: 13.5, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}><Icon n={tipo === "info" ? "file" : "alert"} s={17} />{children}</div>;

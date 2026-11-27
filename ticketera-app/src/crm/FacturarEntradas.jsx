// ===================== CRM · FACTURAR EL DINERO DE ENTRADAS =====================
// Elige los canales, y crea un borrador de factura emitida (un ingreso) o descarga el resumen para el gestor.
import React, { useState } from "react";
import { money, useIsMobile, C, Icon, Sheet } from "./ui";
import { ajustesCon } from "./fiscal";
import { canalesEntradas } from "./DineroEntradas";
import { lineasDeCanales, resumenCsv, cobradoDe, baseDe } from "./facturarEntradasCalc";

export default function FacturarEntradas({ ingresos, evNombre, ajustes, flash, onIrFacturacion, onClose }) {
  const isMobile = useIsMobile();
  const D = canalesEntradas(ingresos);
  const facturables = D.lista.filter(c => cobradoDe(c) > 0);
  const [sel, setSel] = useState(() => new Set(facturables.map(c => c.k)));
  const [pct, setPct] = useState(() => Number(ajustesCon(ajustes).iva.ventas.entradas ?? 21));
  const [busy, setBusy] = useState(false);
  const elegidos = facturables.filter(c => sel.has(c.k));
  const cobrado = elegidos.reduce((t, c) => t + cobradoDe(c), 0);
  const base = baseDe(cobrado, pct);
  const alternar = (k) => setSel(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const crear = async () => {
    setBusy(true);
    try {
      const { guardarFactura } = await import("./fac/facdb");
      await guardarFactura({ tipo: "emitida", estado: "borrador", fecha: new Date().toISOString().slice(0, 10), lineas: lineasDeCanales(elegidos, pct, evNombre), irpf_pct: 0, contacto: {}, notas: `Entradas vendidas · ${evNombre || ""}`.trim() });
      flash?.("Borrador creado en Facturación › Ventas: elige el cliente y emítela");
      onClose(); onIrFacturacion?.();
    } catch (e) { flash?.(e.message || "No se ha podido crear el borrador", "warn"); }
    setBusy(false);
  };
  const descargar = () => {
    const blob = new Blob([resumenCsv(elegidos, pct, evNombre)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `entradas_${(evNombre || "evento").replace(/[^\w]+/g, "_")}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <Sheet title="Facturar las entradas" onClose={onClose} footer={
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={crear} disabled={busy || !elegidos.length} style={{ ...C.btnPrimary, flex: "1 1 200px", opacity: elegidos.length ? 1 : .5 }}><Icon n="file" s={17} />{busy ? "Creando…" : "Crear borrador de factura"}</button>
        <button onClick={descargar} disabled={!elegidos.length} style={{ ...C.btnGhost, flex: isMobile ? "1 1 100%" : "0 0 auto", opacity: elegidos.length ? 1 : .5 }}><Icon n="download" s={16} />Resumen para el gestor</button>
      </div>}>
      {!facturables.length ? <div style={{ color: "var(--muted)" }}>Todavía no hay dinero de entradas cobrado para facturar.</div> : (<>
        <div style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.45, marginBottom: 12 }}>Marca los canales que quieres incluir. Solo cuenta lo ya cobrado. Se crea un <b style={{ color: "var(--text)" }}>borrador de factura emitida</b> (es un ingreso) con una línea por canal; después eliges el cliente y la emites.</div>
        {facturables.map(c => (
          <label key={c.k} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 56, padding: "8px 4px", borderTop: "1px solid var(--line)", cursor: "pointer" }}>
            <input type="checkbox" checked={sel.has(c.k)} onChange={() => alternar(c.k)} style={{ width: 22, height: 22, accentColor: "var(--accent)", flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.t}</span>
              <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>{c.udsSabidas && c.uds ? `${c.uds} entradas` : "Sin cantidad"}{c.pendiente > 0 ? ` · ${money(c.pendiente)} sin cobrar (no se incluye)` : ""}</span>
            </span>
            <b style={{ fontVariantNumeric: "tabular-nums" }}>{money(cobradoDe(c))}</b>
          </label>
        ))}
        <div style={{ borderTop: "1px solid var(--line)", marginTop: 4, paddingTop: 12 }}>
          <div style={C.label}>IVA de las entradas</div>
          <div style={{ display: "flex", gap: 6 }}>
            {[0, 10, 21].map(v => <button key={v} onClick={() => setPct(v)} aria-pressed={pct === v} style={{ ...C.btnGhost, flex: 1, minHeight: 44, ...(pct === v ? { borderColor: "var(--accent)", color: "var(--accent)" } : {}) }}>{v} %</button>)}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 14, color: "var(--muted)" }}><span>Base imponible</span><b style={{ color: "var(--text)" }}>{money(base)}</b></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "var(--muted)" }}><span>IVA incluido</span><b style={{ color: "var(--text)" }}>{money(cobrado - base)}</b></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 17, marginTop: 4 }}><b>Total</b><b>{money(cobrado)}</b></div>
        </div>
      </>)}
    </Sheet>
  );
}

// ===================== CÓDIGOS DESCUENTO · venta online =====================
// Porcentaje o euros menos por entrada; para un evento o para todos; con usos totales, usos por persona,
// mínimo de entradas, tipos de entrada y fechas de inicio y fin. El precio lo calcula siempre el servidor.
import React, { useEffect, useMemo, useState } from "react";
import * as crm from "./crmdb";
import { money, useIsMobile, C, Icon, Badge, Sheet, Field, Seccion, Seg } from "./ui";

const p2 = (n) => String(n).padStart(2, "0");
const aLocal = (iso) => { if (!iso) return ""; const d = new Date(iso); if (isNaN(d)) return ""; return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const aIso = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d.toISOString(); };
const fechaTxt = (iso) => new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const aleatorio = () => { const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return Array.from(crypto.getRandomValues(new Uint8Array(6)), b => a[b % a.length]).join(""); };
const num = (v) => String(v ?? "").replace(/[^\d]/g, "").slice(0, 6);

function estadoDe(d) {
  const ahora = Date.now();
  if (!d.activo) return { t: "Pausado", c: "var(--muted)" };
  if (d.fin && new Date(d.fin).getTime() <= ahora) return { t: "Caducado", c: "var(--red)" };
  if (d.usos_max && d.usos >= d.usos_max) return { t: "Agotado", c: "var(--red)" };
  if (d.inicio && new Date(d.inicio).getTime() > ahora) return { t: "Programado", c: "var(--amber)" };
  return { t: "Activo", c: "var(--green)" };
}
const valorTxt = (d) => d.tipo === "porcentaje" ? `${Number(d.valor)} % menos` : `${money(d.valor)} menos por entrada`;

export function Descuentos({ ev, events, flash }) {
  const isMobile = useIsMobile();
  const [lista, setLista] = useState(null);
  const [conVenta, setConVenta] = useState({});
  const [ed, setEd] = useState(null);
  const [tramos, setTramos] = useState([]);
  const [busy, setBusy] = useState(false);
  const cargar = () => crm.descuentosListar().then(setLista).catch(() => setLista([]));
  useEffect(() => { cargar(); crm.webListar().then(setConVenta).catch(() => {}); }, []);
  const eventos = useMemo(() => (events || []).filter(e => conVenta[e.id]), [events, conVenta]);
  const nombreEv = (id) => (events || []).find(e => e.id === id)?.name || "Evento borrado";
  useEffect(() => { if (ed?.evento_id) crm.webCargar(ed.evento_id).then(x => setTramos(x?.tramos || [])).catch(() => setTramos([])); else setTramos([]); }, [ed?.evento_id]);

  const nuevo = () => setEd({ codigo: aleatorio(), nombre: "", tipo: "porcentaje", valor: "10", evento_id: conVenta[ev.id] ? ev.id : "", tramos: [], usos_max: "", usos_por_email: "1", minimo_entradas: "1", inicio: "", fin: "", activo: true });
  const editar = (d) => setEd({ ...d, valor: String(Number(d.valor)).replace(".", ","), evento_id: d.evento_id || "", tramos: d.tramos || [], usos_max: d.usos_max ?? "", usos_por_email: d.usos_por_email ?? "", minimo_entradas: String(d.minimo_entradas || 1), inicio: aLocal(d.inicio), fin: aLocal(d.fin) });
  const guardar = async () => {
    const valor = parseFloat(String(ed.valor).replace(",", "."));
    if (!/^[A-Z0-9_-]{3,30}$/.test(ed.codigo)) return flash("El código: de 3 a 30 letras o números, sin espacios", "warn");
    if (!(valor > 0) || (ed.tipo === "porcentaje" && valor > 100)) return flash(ed.tipo === "porcentaje" ? "El porcentaje va de 1 a 100" : "Escribe cuántos euros se descuentan", "warn");
    if (ed.inicio && ed.fin && new Date(ed.fin) <= new Date(ed.inicio)) return flash("La fecha de fin tiene que ser después de la de inicio", "warn");
    setBusy(true);
    try { await crm.descuentoGuardar({ ...ed, valor, inicio: aIso(ed.inicio), fin: aIso(ed.fin) }); flash(ed.id ? "Código guardado" : `Código ${ed.codigo} creado`); setEd(null); cargar(); }
    catch (e) { flash(e.message || "No se ha podido guardar", "warn"); } finally { setBusy(false); }
  };
  const borrar = async (d) => {
    if (d.usos > 0) { await crm.descuentoActivar(d.id, false); flash("Ya se ha usado: queda pausado para conservar el historial"); setEd(null); cargar(); return; }
    if (!window.confirm(`¿Borrar el código ${d.codigo}?`)) return;
    try { await crm.descuentoBorrar(d.id); flash("Código borrado"); setEd(null); cargar(); } catch (e) { flash(e.message || "No se ha podido borrar", "warn"); }
  };
  const enlace = (d) => { const slug = d.evento_id ? conVenta[d.evento_id]?.slug : null; return slug ? `${window.location.origin}/e/${slug}?codigo=${d.codigo}` : null; };
  const copiar = async (t) => { try { await navigator.clipboard.writeText(t); flash("Copiado"); } catch { window.prompt("Copia", t); } };

  const set = (k, v) => setEd(x => ({ ...x, [k]: v }));
  const total = (lista || []).reduce((a, d) => ({ usos: a.usos + d.usos, ahorro: a.ahorro + d.ahorro, ventas: a.ventas + d.ventas }), { usos: 0, ahorro: 0, ventas: 0 });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...C.panel, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px", minWidth: 0, fontSize: 13.5, color: "var(--muted)", lineHeight: 1.45 }}>El comprador escribe el código al pagar o entra con un enlace que ya lo lleva puesto. El descuento solo se aplica si cumple todas las condiciones.</div>
        <button onClick={nuevo} style={{ ...C.btnPrimary, minHeight: 48, flex: isMobile ? "1 1 100%" : "0 0 auto" }}><Icon n="plus" s={16} w={2.4} />Nuevo código</button>
      </div>

      <Seccion id="desc-lista" i="percent" t="Códigos descuento" sub={lista?.length ? `${total.usos} compras con código · ${money(total.ventas)} vendidos · ${money(total.ahorro)} descontados` : "Crea tu primer código"} total={lista ? `${lista.length}` : ""}>
        {!lista ? <div style={{ color: "var(--muted)" }}>Cargando…</div>
          : !lista.length ? <div style={C.empty}>Aún no hay códigos. Crea uno para una preventa, un RRPP o tus seguidores.</div>
          : lista.map(d => { const st = estadoDe(d); const url = enlace(d); return (
            <div key={d.id} style={{ ...C.row, alignItems: "flex-start", flexWrap: "wrap" }}>
              <button onClick={() => editar(d)} style={{ flex: "1 1 240px", minWidth: 0, textAlign: "left", background: "transparent", border: "none", color: "var(--text)", cursor: "pointer", padding: 0, font: "inherit" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <b style={{ fontSize: 16, letterSpacing: ".04em" }}>{d.codigo}</b><Badge c={st.c}>{st.t}</Badge>
                </span>
                <span style={{ display: "block", fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                  {valorTxt(d)} · {d.evento_id ? nombreEv(d.evento_id) : "Todos los eventos"}{d.tramos?.length ? ` · ${d.tramos.length} tipo${d.tramos.length > 1 ? "s" : ""} de entrada` : ""}{d.minimo_entradas > 1 ? ` · desde ${d.minimo_entradas} entradas` : ""}
                </span>
                <span style={{ display: "block", fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
                  {d.usos}{d.usos_max ? ` / ${d.usos_max}` : ""} usos{d.usos_por_email ? ` · ${d.usos_por_email} por persona` : ""}{d.fin ? ` · hasta ${fechaTxt(d.fin)}` : ""}{d.nombre ? ` · ${d.nombre}` : ""}
                </span>
              </button>
              <span style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {url && <button onClick={() => copiar(url)} style={C.btnSm}><Icon n="link" s={14} />Enlace</button>}
                {url && <a href={`https://wa.me/?text=${encodeURIComponent(`Tienes ${valorTxt(d).toLowerCase()} con el código ${d.codigo}: ${url}`)}`} target="_blank" rel="noopener noreferrer" style={{ ...C.btnSm, textDecoration: "none" }}><Icon n="whatsapp" s={14} />WhatsApp</a>}
                <button onClick={async () => { await crm.descuentoActivar(d.id, !d.activo); cargar(); }} style={C.btnSm}>{d.activo ? "Pausar" : "Activar"}</button>
              </span>
            </div>); })}
      </Seccion>

      {ed && (
        <Sheet title={ed.id ? `Código ${ed.codigo}` : "Nuevo código descuento"} onClose={() => setEd(null)}
          footer={<div style={{ display: "flex", gap: 8 }}>
            {ed.id && <button onClick={() => borrar(ed)} style={{ ...C.btnSm, minHeight: 48, color: "var(--red)" }}>{ed.usos > 0 ? "Pausar" : "Borrar"}</button>}
            <button disabled={busy} onClick={guardar} style={{ ...C.btnPrimary, flex: 1, minHeight: 48 }}>{busy ? "Guardando…" : "Guardar código"}</button>
          </div>}>
          <Field l="Código (lo que escribe el comprador)">
            <div style={{ display: "flex", gap: 8 }}>
              <input style={{ ...C.input, letterSpacing: ".06em", fontWeight: 600 }} value={ed.codigo} maxLength={30} autoCapitalize="characters" autoComplete="off" onChange={e => set("codigo", e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))} />
              {!ed.id && <button type="button" onClick={() => set("codigo", aleatorio())} style={{ ...C.btnSm, minHeight: 44, flexShrink: 0 }}><Icon n="refresh" s={14} />Otro</button>}
            </div>
          </Field>
          <Field l="Descuento">
            <Seg full opciones={[{ k: "porcentaje", t: "Porcentaje" }, { k: "euros", t: "Euros por entrada" }]} valor={ed.tipo} onChange={v => set("tipo", v)} />
            <div style={{ position: "relative", marginTop: 8 }}>
              <input style={{ ...C.input, paddingRight: 40 }} inputMode="decimal" value={ed.valor} onChange={e => set("valor", e.target.value.replace(/[^\d.,]/g, "").slice(0, 7))} />
              <span style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontWeight: 600 }}>{ed.tipo === "porcentaje" ? "%" : "€"}</span>
            </div>
          </Field>
          <Field l="Para qué evento">
            <select value={ed.evento_id} onChange={e => setEd(x => ({ ...x, evento_id: e.target.value, tramos: [] }))} style={C.input}>
              <option value="">Todos mis eventos</option>
              {eventos.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </Field>
          {ed.evento_id && tramos.length > 0 && (
            <Field l="Tipos de entrada (si no marcas ninguno, vale para todos)">
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {tramos.map(t => { const on = ed.tramos.includes(t.id); return (
                  <label key={t.id} style={{ ...C.row, cursor: "pointer", minHeight: 44, gap: 10 }}>
                    <input type="checkbox" checked={on} onChange={() => set("tramos", on ? ed.tramos.filter(x => x !== t.id) : [...ed.tramos, t.id])} style={{ width: 20, height: 20 }} />
                    <span style={{ flex: 1 }}>{t.nombre}</span><b>{money(t.precio)}</b>
                  </label>); })}
              </div>
            </Field>)}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr", gap: "0 12px" }}>
            <Field l="Usos en total"><input style={C.input} inputMode="numeric" placeholder="Sin límite" value={ed.usos_max} onChange={e => set("usos_max", num(e.target.value))} /></Field>
            <Field l="Usos por persona"><input style={C.input} inputMode="numeric" placeholder="Sin límite" value={ed.usos_por_email} onChange={e => set("usos_por_email", num(e.target.value))} /></Field>
            <Field l="Mínimo de entradas"><input style={C.input} inputMode="numeric" value={ed.minimo_entradas} onChange={e => set("minimo_entradas", num(e.target.value).slice(0, 2))} /></Field>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "-8px 0 14px" }}>Un uso es una compra. La persona se reconoce por su correo.</div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "0 12px" }}>
            <Field l="Válido desde"><input type="datetime-local" style={C.input} value={ed.inicio} onChange={e => set("inicio", e.target.value)} /></Field>
            <Field l="Caduca el"><input type="datetime-local" style={C.input} value={ed.fin} onChange={e => set("fin", e.target.value)} /></Field>
          </div>
          <Field l="Nota interna (opcional)"><input style={C.input} maxLength={80} placeholder="RRPP Laura, seguidores de Instagram…" value={ed.nombre || ""} onChange={e => set("nombre", e.target.value)} /></Field>
          {ed.id && <div style={{ fontSize: 13, color: "var(--muted)" }}>Usado {ed.usos} {ed.usos === 1 ? "vez" : "veces"} · {money(ed.ventas)} vendidos · {money(ed.ahorro)} descontados</div>}
        </Sheet>
      )}
    </div>
  );
}

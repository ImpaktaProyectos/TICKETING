// ===================== CLIENTES · quién compra tus entradas =====================
// Todo sale de las entradas vendidas online (nada inventado). Cada organizador solo ve a los suyos (RLS).
// Pensado para usarse cumpliendo el RGPD: marketing solo con permiso, derechos de acceso, oposición y supresión a un clic.
import React, { useEffect, useMemo, useState } from "react";
import * as crm from "./crmdb";
import { money, useIsMobile, C, Icon, Tile, Badge, Seg, Sheet, Field } from "./ui";

const n0 = (v) => new Intl.NumberFormat("es-ES").format(Math.round(v || 0));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const diaTxt = (d) => { try { return new Date(d + "T12:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "short" }); } catch { return d; } };
const fechaHora = (iso) => { try { return new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
const ocultarTel = (t) => { const s = String(t || "").replace(/\s/g, ""); return s.length > 4 ? "•••• " + s.slice(-3) : s; };
const GENERO = { mujer: "Mujer", hombre: "Hombre", "no binario": "No binario", otro: "Otro", "prefiero no decirlo": "Prefiere no decirlo" };
// Provincia a partir de las dos primeras cifras del código postal
const PROV = { "01": "Álava", "02": "Albacete", "03": "Alicante", "04": "Almería", "05": "Ávila", "06": "Badajoz", "07": "Baleares", "08": "Barcelona", "09": "Burgos", "10": "Cáceres", "11": "Cádiz", "12": "Castellón", "13": "Ciudad Real", "14": "Córdoba", "15": "A Coruña", "16": "Cuenca", "17": "Girona", "18": "Granada", "19": "Guadalajara", "20": "Gipuzkoa", "21": "Huelva", "22": "Huesca", "23": "Jaén", "24": "León", "25": "Lleida", "26": "La Rioja", "27": "Lugo", "28": "Madrid", "29": "Málaga", "30": "Murcia", "31": "Navarra", "32": "Ourense", "33": "Asturias", "34": "Palencia", "35": "Las Palmas", "36": "Pontevedra", "37": "Salamanca", "38": "S. C. Tenerife", "39": "Cantabria", "40": "Segovia", "41": "Sevilla", "42": "Soria", "43": "Tarragona", "44": "Teruel", "45": "Toledo", "46": "Valencia", "47": "Valladolid", "48": "Bizkaia", "49": "Zamora", "50": "Zaragoza", "51": "Ceuta", "52": "Melilla" };
const ORDEN = [["recientes", "Recientes"], ["entradas", "Más entradas"], ["gasto", "Más gasto"], ["edad", "Edad"], ["nombre", "A-Z"]];

/* ---------- Resumen grande en la página de Entradas (se pulsa para ver los clientes) ---------- */
export function ResumenVentas({ ev, onAbrir }) {
  const isMobile = useIsMobile();
  const [d, setD] = useState(null);
  useEffect(() => { let vivo = true; setD(null); crm.clientesCargar(ev.id, false).then(x => vivo && setD(x)).catch(() => vivo && setD({ error: true })); return () => { vivo = false; }; }, [ev.id]);
  const r = d?.resumen;
  const aforo = r?.aforo;
  const lleno = aforo ? Math.min(100, pct(r.entradas, aforo)) : null;
  return (
    <button type="button" onClick={onAbrir} aria-label="Ver clientes y estadísticas de la venta"
      style={{ ...C.hero, display: "block", width: "100%", textAlign: "left", cursor: "pointer", color: "var(--text)", font: "inherit", padding: isMobile ? 16 : 22, position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 1.4, textTransform: "uppercase", color: "var(--muted)" }}>Entradas vendidas</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
            <span style={{ fontSize: isMobile ? 44 : 56, fontWeight: 900, letterSpacing: "-.03em", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{r ? n0(r.entradas) : "—"}</span>
            {aforo ? <span style={{ fontSize: 18, fontWeight: 800, color: "var(--muted)" }}>de {n0(aforo)}</span> : null}
            {r?.hoy > 0 && <Badge c="var(--green)">+{n0(r.hoy)} en 24 h</Badge>}
          </div>
          {lleno != null && (
            <div style={{ marginTop: 12 }}>
              <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={lleno} aria-label="Aforo vendido" style={{ height: 10, borderRadius: 10, background: "var(--surface2)", overflow: "hidden" }}>
                <div style={{ width: `${lleno}%`, height: "100%", borderRadius: 10, background: "var(--accent)" }} />
              </div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 5, fontWeight: 700 }}>{lleno} % del aforo · quedan {n0(Math.max(0, aforo - r.entradas))}</div>
            </div>
          )}
          {d?.error && <div style={{ fontSize: 13, color: "var(--amber)", marginTop: 6 }}>No se han podido cargar las ventas.</div>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8, flex: "1 1 300px", minWidth: 0 }}>
          {[["Ingresos", r ? money(r.ingresos) : "—"], ["Compradores", r ? n0(r.compradores) : "—"], ["Edad media", r?.edad_media ? `${String(r.edad_media).replace(".", ",")}${isMobile ? "" : " años"}` : "—"]].map(([t, v]) => (
            <div key={t} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: isMobile ? "9px 8px" : "10px 12px", minWidth: 0 }}>
              <div style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 800 }}>{t}</div>
              <div style={{ fontSize: isMobile ? 14.5 : 17, fontWeight: 900, marginTop: 2, whiteSpace: "nowrap", letterSpacing: isMobile ? "-.02em" : 0 }}>{v}</div>
            </div>))}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Quién compra, de dónde son, edades, tipos de entrada y cuándo compran</span>
        <span style={{ ...C.btnPrimary, minHeight: 38, padding: "0 14px", flexShrink: 0 }}><Icon n="users" s={16} />Ver clientes<Icon n="chev" s={14} style={{ transform: "rotate(-90deg)" }} /></span>
      </div>
    </button>
  );
}

/* ---------- Gráficas sencillas (una sola tinta: la magnitud la marca la longitud) ---------- */
function BarrasV({ datos, alto = 150, formato = n0, etiquetaCada = 1, resumen }) {
  const [h, setH] = useState(null);
  const max = Math.max(1, ...datos.map(x => x.v));
  return (
    <div role="img" aria-label={resumen} style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: datos.length > 30 ? 1 : 3, height: alto, padding: "18px 0 0", borderBottom: "1px solid var(--line)" }}>
        {datos.map((x, i) => (
          <div key={x.k} onMouseEnter={() => setH(i)} onMouseLeave={() => setH(null)} onClick={() => setH(h === i ? null : i)} title={`${x.label}: ${formato(x.v)}`}
            style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", alignItems: "flex-end", cursor: "default", position: "relative" }}>
            <div style={{ width: "100%", height: `${Math.max(x.v ? 3 : 0, (x.v / max) * 100)}%`, background: h === i ? "var(--text)" : "var(--accent)", borderRadius: "4px 4px 0 0", opacity: h == null || h === i ? 1 : .55, transition: "opacity .12s" }} />
            {h === i && <div style={{ position: "absolute", bottom: `calc(${(x.v / max) * 100}% + 6px)`, left: "50%", transform: `translateX(${i < datos.length / 4 ? "-15%" : i > datos.length * .75 ? "-85%" : "-50%"})`, background: "var(--text)", color: "var(--bg, #000)", fontSize: 12, fontWeight: 800, padding: "4px 8px", borderRadius: 8, whiteSpace: "nowrap", zIndex: 2, pointerEvents: "none" }}>{x.label} · {formato(x.v)}</div>}
          </div>))}
      </div>
      <div style={{ display: "flex", gap: datos.length > 30 ? 1 : 3, marginTop: 5 }}>
        {datos.map((x, i) => <div key={x.k} style={{ flex: 1, minWidth: 0, fontSize: 10.5, color: "var(--muted)", textAlign: "center", whiteSpace: "nowrap", overflow: "visible" }}>{i % etiquetaCada === 0 ? x.corta ?? x.label : ""}</div>)}
      </div>
    </div>
  );
}
function BarrasH({ filas, formato = n0, total }) {
  const max = Math.max(1, ...filas.map(x => x.v));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {filas.map(x => (
        <div key={x.label} title={`${x.label}: ${formato(x.v)}`}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, marginBottom: 4 }}>
            <span style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{x.label}</span>
            <span style={{ fontWeight: 900, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{formato(x.v)}{total ? <span style={{ color: "var(--muted)", fontWeight: 700 }}> · {pct(x.v, total)} %</span> : null}{x.sub ? <span style={{ color: "var(--muted)", fontWeight: 700 }}> · {x.sub}</span> : null}</span>
          </div>
          <div style={{ height: 8, borderRadius: 8, background: "var(--surface2)" }}><div style={{ width: `${(x.v / max) * 100}%`, minWidth: x.v ? 4 : 0, height: "100%", borderRadius: 8, background: "var(--accent)" }} /></div>
        </div>))}
    </div>
  );
}
function Tarjeta({ t, sub, children, vacio, ancho }) {
  return (
    <section style={{ ...C.panel, minWidth: 0, gridColumn: ancho ? "1 / -1" : undefined }}>
      <div style={{ fontWeight: 900, fontSize: 15.5 }}>{t}</div>
      {sub && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
      <div style={{ marginTop: 14 }}>{vacio ? <div style={{ ...C.empty, padding: "18px 12px" }}>{vacio}</div> : children}</div>
    </section>
  );
}
const Kpi = ({ t, v, sub, c }) => (
  <div style={{ ...C.card, padding: "12px 14px" }}>
    <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 800 }}>{t}</div>
    <div style={{ fontSize: 24, fontWeight: 900, marginTop: 2, color: c || "var(--text)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v}</div>
    {sub && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
  </div>
);

/* ---------- Vista de clientes ---------- */
export function Clientes({ ev, onVolver, flash }) {
  const isMobile = useIsMobile();
  const [ambito, setAmbito] = useState("evento");
  const [pruebas, setPruebas] = useState(false);
  const [d, setD] = useState(null);
  const [legal, setLegal] = useState(null);
  const [verLegal, setVerLegal] = useState(false);
  const [q, setQ] = useState(""); const [orden, setOrden] = useState("recientes"); const [tramo, setTramo] = useState(""); const [soloMkt, setSoloMkt] = useState(false);
  const [geo, setGeo] = useState("provincia");
  const [ficha, setFicha] = useState(null);
  const [cuantos, setCuantos] = useState(60);
  const cargar = () => { setD(null); crm.clientesCargar(ambito === "evento" ? ev.id : null, pruebas).then(setD).catch(() => setD({ error: true })); };
  useEffect(cargar, [ev.id, ambito, pruebas]);
  useEffect(() => { crm.legalLeer().then(setLegal).catch(() => setLegal({})); }, []);
  const r = d?.resumen || {};
  const legalOk = legal && legal.razon_social && legal.email;

  const tramos = useMemo(() => [...new Set((d?.clientes || []).flatMap(c => c.tramos || []))].sort(), [d]);
  const lista = useMemo(() => {
    const t = q.trim().toLowerCase();
    let xs = (d?.clientes || []).filter(c => (!t || `${c.nombre} ${c.email} ${c.ciudad || ""} ${c.cp || ""}`.toLowerCase().includes(t)) && (!tramo || (c.tramos || []).includes(tramo)) && (!soloMkt || c.marketing));
    const by = { recientes: (a, b) => String(b.ultima).localeCompare(String(a.ultima)), entradas: (a, b) => b.entradas - a.entradas, gasto: (a, b) => b.gastado - a.gastado, edad: (a, b) => (a.edad ?? 999) - (b.edad ?? 999), nombre: (a, b) => String(a.nombre).localeCompare(String(b.nombre), "es") }[orden];
    return [...xs].sort(by);
  }, [d, q, orden, tramo, soloMkt]);

  // Ventas por día (si hay muchos días, por semanas)
  const dias = useMemo(() => {
    const xs = d?.por_dia || [];
    if (xs.length <= 45) return xs.map(x => ({ k: x.dia, label: diaTxt(x.dia), corta: String(new Date(x.dia + "T12:00").getDate()), v: x.entradas }));
    const sem = {}; xs.forEach(x => { const f = new Date(x.dia + "T12:00"); f.setDate(f.getDate() - ((f.getDay() + 6) % 7)); const k = f.toISOString().slice(0, 10); sem[k] = (sem[k] || 0) + x.entradas; });
    return Object.entries(sem).sort().map(([k, v]) => ({ k, label: `Semana del ${diaTxt(k)}`, corta: diaTxt(k), v }));
  }, [d]);
  const horas = useMemo(() => { const m = Object.fromEntries((d?.por_hora || []).map(x => [x.h, x.entradas])); return Array.from({ length: 24 }, (_, h) => ({ k: String(h), label: `${h}:00–${h}:59`, corta: h % 3 === 0 ? `${h}h` : "", v: m[h] || 0 })); }, [d]);
  const horaPico = horas.reduce((a, b) => (b.v > a.v ? b : a), { v: 0 });
  const geoFilas = geo === "provincia"
    ? Object.values((d?.por_provincia || []).reduce((acc, x) => { const nom = PROV[x.cp2] || "Otro"; acc[nom] = { label: nom, v: (acc[nom]?.v || 0) + x.compradores }; return acc; }, {})).sort((a, b) => b.v - a.v).slice(0, 10)
    : (d?.por_ciudad || []).slice(0, 10).map(x => ({ label: x.ciudad, v: x.compradores }));

  const exportarMarketing = () => {
    const xs = (d?.clientes || []).filter(c => c.marketing);
    if (!xs.length) { flash("Aún no hay compradores que hayan aceptado recibir novedades", "warn"); return; }
    const cel = (x) => { let s = String(x ?? "").replace(/[;\r\n]+/g, " "); if (/^[=+\-@\t]/.test(s)) s = "'" + s; return s; };
    const filas = [["Nombre", "Correo", "Ciudad", "Código postal", "Edad", "Entradas", "Última compra"], ...xs.map(c => [c.nombre, c.email, c.ciudad || "", c.cp || "", c.edad ?? "", c.entradas, new Date(c.ultima).toLocaleDateString("es-ES")])];
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + filas.map(f => f.map(cel).join(";")).join("\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `clientes-con-permiso-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    flash(`${xs.length} contactos exportados (solo los que aceptaron)`);
  };

  const pc = (x) => `${pct(x, r.compradores)} %`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Cabecera */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button onClick={onVolver} style={C.btnSm} aria-label="Volver a la venta del evento"><Icon n="chev" s={14} style={{ transform: "rotate(90deg)" }} />Volver</button>
        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          <div style={{ fontSize: isMobile ? 22 : 26, fontWeight: 900, lineHeight: 1.1 }}>Clientes</div>
          <div style={{ fontSize: 13, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ambito === "evento" ? ev.name : "Todos tus eventos"} · datos de las entradas vendidas online</div>
        </div>
        <Seg opciones={[{ k: "evento", t: "Este evento" }, { k: "todos", t: "Todos mis eventos" }]} valor={ambito} onChange={setAmbito} size="sm" />
        <button onClick={() => setPruebas(x => !x)} aria-pressed={pruebas} style={{ ...C.btnSm, ...(pruebas ? { borderColor: "var(--amber)", color: "var(--amber)" } : {}) }}>{pruebas ? "Con pruebas" : "Sin pruebas"}</button>
      </div>

      {legal && !legalOk && (
        <div role="alert" style={{ ...C.panel, borderColor: "var(--amber)", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Tile n="shield" c="var(--amber)" s={38} />
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <b>Completa tus datos como responsable de los datos</b>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>La ley obliga a decir a cada comprador quién guarda sus datos y cómo contactar. Sin ellos, tu web lo explica de forma incompleta.</div>
          </div>
          <button onClick={() => setVerLegal(true)} style={{ ...C.btnPrimary, minHeight: 40 }}>Completar ahora</button>
        </div>
      )}

      {!d ? <div style={{ ...C.panel, color: "var(--muted)", textAlign: "center" }}>Cargando…</div>
        : d.error ? <div style={{ ...C.panel, color: "var(--amber)", fontWeight: 700 }}>No se han podido cargar los clientes. Revisa la conexión.</div>
        : (<>
          {/* Números clave */}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 140 : 170}px, 1fr))`, gap: 10 }}>
            <Kpi t="Entradas vendidas" v={n0(r.entradas)} sub={r.aforo ? `de ${n0(r.aforo)} · ${pct(r.entradas, r.aforo)} %` : `${n0(r.pedidos)} pedidos`} />
            <Kpi t="Compradores" v={n0(r.compradores)} sub={r.compradores ? `${(r.entradas / r.compradores).toFixed(1).replace(".", ",")} entradas cada uno` : ""} />
            <Kpi t="Ingresos" v={money(r.ingresos)} sub={r.pedidos ? `${money(r.ingresos / r.pedidos)} por pedido` : ""} />
            <Kpi t="Edad media" v={r.edad_media ? `${String(r.edad_media).replace(".", ",")}` : "—"} sub={r.con_edad ? `de ${n0(r.con_edad)} con fecha de nacimiento` : "Pide la fecha de nacimiento"} />
            <Kpi t="Aceptan novedades" v={n0(r.marketing)} sub={r.compradores ? `${pc(r.marketing)} de los compradores` : ""} c="var(--green)" />
            {ambito === "todos" ? <Kpi t="Repiten" v={n0(r.repiten)} sub="compran en más de un evento" /> : <Kpi t="Últimas 24 h" v={`+${n0(r.hoy)}`} sub="entradas" />}
          </div>

          {r.entradas === 0 ? <div style={{ ...C.panel, ...C.empty }}>Aún no hay entradas vendidas {ambito === "evento" ? "en este evento" : ""}. Cuando empiecen las ventas, aquí verás quién compra.</div> : (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0,1fr)" : "repeat(2, minmax(0,1fr))", gap: 12 }}>
            <Tarjeta t="Ritmo de ventas" sub={dias.length > 0 ? `Entradas vendidas cada ${dias[0]?.label?.startsWith("Semana") ? "semana" : "día"} · mejor: ${dias.reduce((a, b) => (b.v > a.v ? b : a)).label}` : ""} ancho>
              <BarrasV datos={dias} alto={isMobile ? 130 : 170} etiquetaCada={Math.max(1, Math.ceil(dias.length / (isMobile ? 8 : 16)))} resumen={`Ventas por día, ${dias.length} días`} />
            </Tarjeta>
            <Tarjeta t="Por tipo de entrada" sub="Qué tramos funcionan mejor">
              <BarrasH filas={(d.por_tramo || []).map(x => ({ label: x.tramo, v: x.entradas, sub: money(x.ingresos) }))} total={r.entradas} />
            </Tarjeta>
            <Tarjeta t="Edades" sub={r.edad_media ? `Media: ${String(r.edad_media).replace(".", ",")} años` : ""} vacio={(d.por_edad || []).length ? null : "Activa «Fecha de nacimiento» en Opciones › Datos del comprador para ver las edades."}>
              <BarrasV datos={(d.por_edad || []).map(x => ({ k: x.rango, label: `${x.rango} años`, corta: x.rango, v: x.compradores }))} alto={140} resumen="Compradores por rango de edad" />
            </Tarjeta>
            <Tarjeta t="De dónde son" sub={(d.por_provincia || []).length || (d.por_ciudad || []).length ? "Compradores por zona" : ""} vacio={(d.por_provincia || []).length || (d.por_ciudad || []).length ? null : "Activa «Código postal» o «Ciudad» en Opciones › Datos del comprador para saber de dónde vienen."}>
              <div style={{ marginBottom: 12 }}><Seg opciones={[{ k: "provincia", t: "Provincia" }, { k: "ciudad", t: "Ciudad" }]} valor={geo} onChange={setGeo} size="sm" /></div>
              {geoFilas.length ? <BarrasH filas={geoFilas} total={r.compradores} /> : <div style={{ fontSize: 13, color: "var(--muted)" }}>Sin datos de {geo === "provincia" ? "código postal" : "ciudad"}.</div>}
            </Tarjeta>
            <Tarjeta t="¿A qué hora compran?" sub={horaPico.v ? `Más ventas entre las ${horaPico.label.replace("–", " y las ")}. Buen momento para publicar.` : ""}>
              <BarrasV datos={horas} alto={120} resumen="Entradas vendidas por hora del día" />
            </Tarjeta>
            {(d.por_genero || []).length > 0 && (
              <Tarjeta t="Género" sub="Según lo que indicó cada comprador">
                <BarrasH filas={d.por_genero.map(x => ({ label: GENERO[x.genero] || x.genero, v: x.compradores }))} total={r.compradores} />
              </Tarjeta>)}
            {ambito === "todos" && (d.por_evento || []).length > 0 && (
              <Tarjeta t="Por evento" sub="Entradas vendidas online en cada evento">
                <BarrasH filas={d.por_evento.slice(0, 10).map(x => ({ label: x.nombre, v: x.entradas }))} />
              </Tarjeta>)}
          </div>)}

          {/* Lista de clientes */}
          <section style={{ ...C.panel }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
              <div style={{ flex: "1 1 200px" }}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>Compradores <span style={{ color: "var(--muted)" }}>· {n0(lista.length)}</span></div>
                <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Uno por correo, con todas sus compras juntas</div>
              </div>
              <button onClick={exportarMarketing} style={C.btnSm} title="Solo quienes marcaron que quieren recibir novedades y no se han dado de baja"><Icon n="file" s={14} />Exportar contactos con permiso</button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar nombre, correo, ciudad…" aria-label="Buscar comprador" style={{ ...C.input, flex: "1 1 220px", width: "auto" }} />
              <select value={tramo} onChange={e => setTramo(e.target.value)} aria-label="Filtrar por tipo de entrada" style={{ ...C.miniSelect, minHeight: 42 }}>
                <option value="">Todas las entradas</option>{tramos.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <button onClick={() => setSoloMkt(x => !x)} aria-pressed={soloMkt} style={{ ...C.btnSm, ...(soloMkt ? { borderColor: "var(--green)", color: "var(--green)" } : {}) }}><Icon n="check" s={13} />Con permiso</button>
            </div>
            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 6 }} role="group" aria-label="Ordenar">
              {ORDEN.map(([k, t]) => <button key={k} onClick={() => setOrden(k)} aria-pressed={orden === k} style={{ ...C.seg, flexShrink: 0, ...(orden === k ? C.segOn : {}) }}>{t}</button>)}
            </div>
            {lista.length === 0 ? <div style={C.empty}>{(d.clientes || []).length ? "Nadie con estos filtros." : "Aún no hay compradores."}</div> : (
              <div>
                {!isMobile && (
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2.2fr) minmax(0,1.2fr) 60px 70px 90px 110px 26px", gap: 10, padding: "8px 6px", fontSize: 11.5, fontWeight: 900, color: "var(--muted)", textTransform: "uppercase", letterSpacing: .8, borderBottom: "1px solid var(--line)" }}>
                    <span>Comprador</span><span>Zona</span><span>Edad</span><span style={{ textAlign: "right" }}>Entradas</span><span style={{ textAlign: "right" }}>Gasto</span><span>Última compra</span><span />
                  </div>)}
                {lista.slice(0, cuantos).map(c => (
                  <button key={c.email} onClick={() => setFicha(c)} style={{ ...C.listBtn, padding: "10px 6px", borderTop: "1px solid var(--line)", borderRadius: 0, display: isMobile ? "flex" : "grid", gridTemplateColumns: "minmax(0,2.2fr) minmax(0,1.2fr) 60px 70px 90px 110px 26px", gap: 10, alignItems: "center", textAlign: "left" }}>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <b style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.nombre}</span>{c.marketing && <span title="Acepta recibir novedades" aria-label="Acepta recibir novedades" style={{ width: 8, height: 8, borderRadius: 8, background: "var(--green)", flexShrink: 0 }} />}{c.eventos > 1 && <Badge c="var(--blue)">{c.eventos} eventos</Badge>}</b>
                      <span style={{ display: "block", fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.email}{isMobile ? ` · ${c.entradas} ent. · ${money(c.gastado)}${c.edad != null ? ` · ${c.edad} años` : ""}` : ""}</span>
                    </span>
                    {!isMobile && <>
                      <span style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.ciudad || (c.cp ? PROV[String(c.cp).padStart(5, "0").slice(0, 2)] || c.cp : "—")}</span>
                      <span style={{ fontSize: 13 }}>{c.edad ?? "—"}</span>
                      <span style={{ fontSize: 13, fontWeight: 900, textAlign: "right" }}>{c.entradas}</span>
                      <span style={{ fontSize: 13, textAlign: "right" }}>{money(c.gastado)}</span>
                      <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{new Date(c.ultima).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}</span>
                    </>}
                    <Icon n="chev" s={14} c="var(--muted)" style={{ transform: "rotate(-90deg)", flexShrink: 0 }} />
                  </button>))}
                {lista.length > cuantos && <button onClick={() => setCuantos(x => x + 120)} style={{ ...C.btnGhost, width: "100%", marginTop: 10 }}>Ver más ({n0(lista.length - cuantos)})</button>}
              </div>)}
          </section>

          {/* Transparencia */}
          <section style={{ ...C.panel }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <Tile n="shield" s={38} />
              <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                <b>Cómo se tratan estos datos</b>
                <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>{legalOk ? `Responsable: ${legal.razon_social}${legal.nif ? ` (${legal.nif})` : ""} · ${legal.email}` : "Faltan tus datos como responsable."}</div>
              </div>
              <button onClick={() => setVerLegal(true)} style={C.btnSm}><Icon n="edit" s={14} />{legalOk ? "Editar" : "Completar"}</button>
            </div>
            <ul style={{ margin: "12px 0 0", paddingLeft: 18, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
              <li>Los datos de compra sirven para <b style={{ color: "var(--text)" }}>gestionar las entradas</b> (contrato). No hace falta permiso para eso.</li>
              <li>Para enviar <b style={{ color: "var(--text)" }}>publicidad o novedades</b> solo vale quien marcó la casilla al comprar (punto verde). Por eso la exportación solo incluye a esas personas.</li>
              <li>Cada comunicación debe llevar una forma fácil de darse de baja. Si alguien la pide, márcalo en su ficha.</li>
              <li>Si alguien pide ver o borrar sus datos, hazlo desde su ficha. Tienes un mes para responder.</li>
              <li>Solo tu cuenta puede ver esta información. No compartas la exportación ni la subas a sitios que no sean de confianza.</li>
            </ul>
          </section>
        </>)}

      {ficha && <FichaCliente c={ficha} onClose={() => setFicha(null)} flash={flash} onCambio={() => { setFicha(null); cargar(); }} />}
      {verLegal && <DatosLegales inicial={legal} onClose={() => setVerLegal(false)} onGuardado={(x) => { setLegal(x); setVerLegal(false); flash("Datos del responsable guardados"); }} flash={flash} />}
    </div>
  );
}

function FichaCliente({ c, onClose, flash, onCambio }) {
  const [busy, setBusy] = useState(false);
  const [borrar, setBorrar] = useState(false);
  const fila = (t, v) => v == null || v === "" ? null : <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderTop: "1px solid var(--line)", fontSize: 14 }}><span style={{ color: "var(--muted)" }}>{t}</span><b style={{ textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{v}</b></div>;
  const exportar = async () => {
    setBusy(true);
    try {
      const datos = await crm.clienteExportar(c.email);
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(datos, null, 2)], { type: "application/json" }));
      a.download = `datos-${c.email.replace(/[^a-z0-9]+/gi, "-")}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      flash("Archivo con todos sus datos descargado. Envíaselo si te lo ha pedido.");
    } catch { flash("No se ha podido exportar", "warn"); } finally { setBusy(false); }
  };
  const baja = async () => { setBusy(true); try { await crm.clienteBaja(c.email, true); flash("Dado de baja: ya no saldrá en los contactos para novedades"); onCambio(); } catch { flash("No se ha podido guardar", "warn"); } finally { setBusy(false); } };
  const suprimir = async () => { setBusy(true); try { await crm.clienteBorrar(c.email); flash("Datos borrados. Se conservan los importes, sin nombre ni contacto."); onCambio(); } catch (e) { flash(e.message || "No se ha podido borrar", "warn"); } finally { setBusy(false); } };
  return (
    <Sheet title={c.nombre} onClose={onClose}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {c.marketing ? <Badge c="var(--green)"><Icon n="check" s={11} w={2.6} />Acepta novedades</Badge> : <Badge>{c.baja ? "Dado de baja de novedades" : "Sin permiso para novedades"}</Badge>}
        {c.eventos > 1 && <Badge c="var(--blue)">Repite · {c.eventos} eventos</Badge>}
      </div>
      {fila("Correo", c.email)}
      {fila("Teléfono", c.telefono ? ocultarTel(c.telefono) : null)}
      {fila("Ciudad", c.ciudad)}
      {fila("Código postal", c.cp)}
      {fila("Edad", c.edad != null ? `${c.edad} años` : null)}
      {fila("Género", c.genero ? (GENERO[c.genero] || c.genero) : null)}
      {fila("Entradas", c.entradas)}
      {fila("Gasto total", money(c.gastado))}
      {fila("Tipos de entrada", (c.tramos || []).join(", "))}
      {fila("Primera compra", fechaHora(c.primera))}
      {fila("Última compra", fechaHora(c.ultima))}
      <div style={{ fontWeight: 900, margin: "16px 0 8px" }}>Sus derechos</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button disabled={busy} onClick={exportar} style={{ ...C.btnGhost, justifyContent: "flex-start" }}><Icon n="file" s={16} />Descargar todos sus datos (acceso)</button>
        {c.marketing && <button disabled={busy} onClick={baja} style={{ ...C.btnGhost, justifyContent: "flex-start" }}><Icon n="x" s={16} />No quiere recibir novedades (baja)</button>}
        {!borrar ? <button disabled={busy} onClick={() => setBorrar(true)} style={{ ...C.btnGhost, justifyContent: "flex-start", color: "var(--red)" }}><Icon n="trash" s={16} />Borrar sus datos (supresión)</button>
          : <div style={{ border: "1px solid var(--red)", borderRadius: 12, padding: 12 }}>
              <div style={{ fontSize: 13.5, lineHeight: 1.45 }}>Se borran su nombre, correo, teléfono y demás datos de todas sus compras. Los importes se quedan, sin saber de quién son, para tus cuentas. <b>No se puede deshacer.</b></div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}><button disabled={busy} onClick={suprimir} style={{ ...C.btnPrimary, background: "var(--red)", flex: 1 }}>{busy ? "Borrando…" : "Sí, borrar"}</button><button onClick={() => setBorrar(false)} style={C.btnGhost}>No</button></div>
            </div>}
      </div>
    </Sheet>
  );
}

function DatosLegales({ inicial, onClose, onGuardado, flash }) {
  const [d, setD] = useState({ razon_social: "", nif: "", direccion: "", email: "", conservar_meses: 24, ...(inicial || {}) });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setD(x => ({ ...x, [k]: e.target.value }));
  const guardar = async () => {
    if (!d.razon_social?.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email || "")) { flash("Faltan el nombre o razón social y un correo válido", "warn"); return; }
    setBusy(true);
    try { await crm.legalGuardar(d); onGuardado({ ...d }); } catch { flash("No se ha podido guardar", "warn"); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Responsable de los datos" onClose={onClose}
      footer={<button disabled={busy} onClick={guardar} style={{ ...C.btnPrimary, width: "100%", minHeight: 48 }}>{busy ? "Guardando…" : "Guardar"}</button>}>
      <div style={{ fontSize: 13.5, color: "var(--muted)", marginBottom: 14, lineHeight: 1.45 }}>Quien organiza los eventos es el <b style={{ color: "var(--text)" }}>responsable</b> de los datos de sus compradores. Estos datos salen en la información de privacidad de tu web de entradas.</div>
      <Field l="Nombre o razón social *"><input style={C.input} value={d.razon_social || ""} maxLength={160} onChange={set("razon_social")} placeholder="Ej. Odiseo Eventos S.L." /></Field>
      <Field l="NIF / CIF"><input style={C.input} value={d.nif || ""} maxLength={20} onChange={set("nif")} placeholder="Ej. B12345678" /></Field>
      <Field l="Dirección"><input style={C.input} value={d.direccion || ""} maxLength={240} onChange={set("direccion")} placeholder="Calle, número, ciudad" /></Field>
      <Field l="Correo para temas de privacidad *"><input style={C.input} type="email" value={d.email || ""} maxLength={160} onChange={set("email")} placeholder="privacidad@tumarca.es" /></Field>
      <Field l="Cuánto tiempo guardas los datos de compra" mb={4}>
        <select style={C.input} value={d.conservar_meses} onChange={set("conservar_meses")}>{[12, 24, 36, 60].map(m => <option key={m} value={m}>{m} meses después del evento</option>)}</select>
      </Field>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>Recomendado: 24 meses. Los datos para novedades se guardan hasta que la persona se dé de baja.</div>
    </Sheet>
  );
}

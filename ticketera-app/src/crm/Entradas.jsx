// ===================== ENTRADAS · gestor de la venta online =====================
// Poner un evento a la venta en 5 pasos (Evento › Flyer › Entradas › Opciones › Publicar),
// con calendario propio para día y hora y una vista en directo de cómo lo verá el comprador.
// Se guarda solo al escribir. La venta pública la hace el servidor (nunca desde aquí).
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as crm from "./crmdb";
import { money, useIsMobile, C, Icon, Tile, Badge, Seg, Sheet, Field, Seccion } from "./ui";
import { Landing, PLANTILLAS_WEB } from "../web/Publico.jsx";
import { Organizaciones } from "./Organizaciones.jsx";
import { ResumenVentas, Clientes } from "./Clientes.jsx";
import { DineroEntradas } from "./DineroEntradas.jsx";

const urlVenta = (slug) => `${window.location.origin}/e/${slug}`;
const ESTADOS = { borrador: { t: "Borrador", c: "var(--muted)" }, publicado: { t: "A la venta", c: "var(--green)" }, cerrado: { t: "Venta cerrada", c: "var(--red)" } };
const CAMPOS = [
  { k: "telefono", t: "Teléfono" }, { k: "dni", t: "DNI del comprador" }, { k: "nacimiento", t: "Fecha de nacimiento" },
  { k: "cp", t: "Código postal" }, { k: "direccion", t: "Dirección" }, { k: "ciudad", t: "Ciudad" }, { k: "genero", t: "Género" },
  { k: "dni_asistente", t: "DNI de cada asistente" },
];
const LETRAS = [{ k: "inter", t: "Moderna" }, { k: "serif", t: "Elegante" }, { k: "mono", t: "Techno" }];
const COLORES = ["#ff5a3c", "#a855f7", "#3b82f6", "#22d3a6", "#ffb400", "#ec4899", "#f97316", "#eceef5"];
const PASOS = [
  { k: "evento", t: "Evento", i: "calendar", sub: "Nombre, día y hora de inicio y de fin, y dónde es." },
  { k: "flyer", t: "Fotos", i: "upload", sub: "El flyer (sale en cada entrada) y las fotos de la marca o de otras ediciones para la galería." },
  { k: "entradas", t: "Entradas", i: "ticket", sub: "Los tramos: precio, cantidad y cuándo se vende cada uno." },
  { k: "diseno", t: "Diseño", i: "sparkle", sub: "Elige la plantilla de la página, tus colores y los textos. Todo está pensado para que compren." },
  { k: "opciones", t: "Opciones", i: "gear", sub: "Avisos de urgencia, datos del comprador, QR y límites. Ya vienen con valores que funcionan." },
  { k: "publicar", t: "Publicar", i: "sparkle", sub: "Revisa que esté todo y ponlo a la venta." },
];
// fecha-hora local «2026-12-31T23:30» <-> ISO
const p2 = (n) => String(n).padStart(2, "0");
const aLocal = (iso) => { if (!iso) return ""; const d = new Date(iso); if (isNaN(d)) return ""; return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const aIso = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d.toISOString(); };
const deLocal = (v) => { if (!v) return null; const d = new Date(v.length <= 10 ? v + "T12:00" : v); return isNaN(d) ? null : d; };
const cap = (x) => x ? x.charAt(0).toUpperCase() + x.slice(1) : x;
const fechaTxt = (v, larga) => { const d = deLocal(v); if (!d) return "Sin fecha"; const conHora = String(v).length > 10; return cap(d.toLocaleString("es-ES", { weekday: larga ? "long" : "short", day: "numeric", month: larga ? "long" : "short", hour: conHora ? "2-digit" : undefined, minute: conHora ? "2-digit" : undefined })); };
const sumarHoras = (v, h) => { const d = deLocal(v); if (!d) return ""; d.setHours(d.getHours() + h); return aLocal(d.toISOString()); };
const limpioNum = (v, dec) => String(v ?? "").replace(dec ? /[^\d.,]/g : /[^\d]/g, "").slice(0, 9);
const aNum = (v) => { const x = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(x) ? x : null; };

function useAutoguardado(fn, ms = 700) {
  const t = useRef(null), ult = useRef(null);
  const [estado, setEstado] = useState("");
  useEffect(() => () => { clearTimeout(t.current); if (ult.current) ult.current(); }, []);
  const programar = (...args) => {
    clearTimeout(t.current); setEstado("guardando");
    const go = () => { ult.current = null; fn(...args).then(() => setEstado("guardado")).catch(() => setEstado("error")); };
    ult.current = go; t.current = setTimeout(go, ms);
  };
  return [programar, estado];
}
function useAncho() {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  useEffect(() => { const f = () => setW(window.innerWidth); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return w;
}
// Fotos más ligeras antes de subirlas (la página pública se abre con datos móviles)
async function reducirImagen(file, max, tipo) {
  try {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 700 * 1024) return file;
    const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise(r => cv.toBlob(r, tipo, 0.86));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + (tipo === "image/png" ? ".png" : ".jpg"), { type: tipo });
  } catch { return file; }
}

/* ===================== Calendario: día y hora ===================== */
const DIAS = ["L", "M", "X", "J", "V", "S", "D"];
const HORAS_NOCHE = [18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
export function FechaHora({ valor, onChange, titulo = "Elige día y hora", placeholder = "Elegir día y hora", sugerencias = [], base, quitar = true, aviso }) {
  const [abierto, setAbierto] = useState(false);
  const [dia, setDia] = useState("");
  const [h, setH] = useState(22);
  const [m, setM] = useState(0);
  const [mes, setMes] = useState(() => new Date());
  const abrir = () => {
    const d = deLocal(valor) || deLocal(base) || new Date();
    setDia(valor ? valor.slice(0, 10) : ""); setH(valor && valor.length > 10 ? d.getHours() : (deLocal(base) && String(base).length > 10 ? deLocal(base).getHours() : 22)); setM(valor && valor.length > 10 ? d.getMinutes() : 0);
    setMes(new Date(d.getFullYear(), d.getMonth(), 1)); setAbierto(true);
  };
  const y = mes.getFullYear(), mo = mes.getMonth();
  const hueco = (new Date(y, mo, 1).getDay() + 6) % 7, nDias = new Date(y, mo + 1, 0).getDate();
  const hoyTxt = aLocal(new Date().toISOString()).slice(0, 10);
  const celdas = [...Array(hueco).fill(null), ...Array.from({ length: nDias }, (_, i) => `${y}-${p2(mo + 1)}-${p2(i + 1)}`)];
  const listo = () => { if (!dia) return; onChange(`${dia}T${p2(h)}:${p2(m)}`); setAbierto(false); };
  const elegido = dia ? deLocal(`${dia}T${p2(h)}:${p2(m)}`) : null;
  return (<>
    <div style={{ display: "flex", gap: 6 }}>
      <button type="button" onClick={abrir} style={{ ...C.input, display: "flex", alignItems: "center", gap: 10, cursor: "pointer", textAlign: "left", fontWeight: valor ? 800 : 600, color: valor ? "var(--text)" : "var(--muted)", minHeight: 46 }}>
        <Icon n="calendar" s={18} c={valor ? "var(--accent)" : "var(--muted)"} />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", }}>{valor ? fechaTxt(valor, true) : placeholder}</span>
      </button>
      {quitar && valor && <button type="button" onClick={() => onChange("")} aria-label="Quitar fecha" style={{ ...C.btnSm, padding: "0 12px" }}><Icon n="x" s={15} /></button>}
    </div>
    {abierto && (
      <Sheet title={titulo} onClose={() => setAbierto(false)}
        footer={<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ flex: 1, minWidth: 0, fontWeight: 800, fontSize: 14 }}>{elegido ? fechaTxt(`${dia}T${p2(h)}:${p2(m)}`, true) : <span style={{ color: "var(--muted)" }}>Toca un día</span>}</span>
          <button onClick={listo} disabled={!dia} style={{ ...C.btnPrimary, minHeight: 46, padding: "0 22px", opacity: dia ? 1 : .5 }}><Icon n="check" s={17} w={2.4} />Listo</button>
        </div>}>
        {aviso && <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>{aviso}</div>}
        {sugerencias.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {sugerencias.filter(s => s.v).map(s => <button key={s.t} onClick={() => { onChange(s.v); setAbierto(false); }} style={{ ...C.seg, borderColor: "var(--accent)", color: "var(--accent)" }}><Icon n="bolt" s={13} />{s.t}</button>)}
        </div>}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <button onClick={() => setMes(new Date(y, mo - 1, 1))} aria-label="Mes anterior" style={{ ...C.btnSm, width: 40, height: 40, justifyContent: "center", padding: 0 }}><Icon n="right" s={16} style={{ transform: "rotate(180deg)" }} /></button>
          <b style={{ fontSize: 17 }}>{mes.toLocaleDateString("es-ES", { month: "long", year: "numeric" })}</b>
          <button onClick={() => setMes(new Date(y, mo + 1, 1))} aria-label="Mes siguiente" style={{ ...C.btnSm, width: 40, height: 40, justifyContent: "center", padding: 0 }}><Icon n="right" s={16} /></button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, textAlign: "center" }}>
          {DIAS.map(d => <div key={d} style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)", padding: "4px 0" }}>{d}</div>)}
          {celdas.map((c, i) => c ? (
            <button key={c} onClick={() => setDia(c)} aria-label={fechaTxt(c, true)} aria-pressed={dia === c}
              style={{ height: 42, borderRadius: 12, border: c === hoyTxt && dia !== c ? "2px solid var(--accent)" : "1px solid transparent", cursor: "pointer", fontWeight: 800, fontSize: 15,
                background: dia === c ? "var(--accent)" : "var(--surface2)", color: dia === c ? "#fff" : c < hoyTxt ? "var(--muted)" : "var(--text)" }}>{+c.slice(8)}</button>
          ) : <span key={"v" + i} />)}
        </div>
        <div style={{ ...C.label, marginTop: 16 }}>Hora</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 6 }}>
          {HORAS_NOCHE.map(x => <button key={x} onClick={() => setH(x)} aria-pressed={h === x} style={{ height: 40, borderRadius: 10, cursor: "pointer", fontWeight: 800, border: "1px solid var(--line)", background: h === x ? "var(--accent)" : "var(--surface2)", color: h === x ? "#fff" : "var(--text)" }}>{p2(x)}</button>)}
        </div>
        <div style={{ ...C.label, marginTop: 14 }}>Minutos</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {[0, 15, 30, 45].map(x => <button key={x} onClick={() => setM(x)} aria-pressed={m === x} style={{ minWidth: 58, height: 40, borderRadius: 10, cursor: "pointer", fontWeight: 800, border: "1px solid var(--line)", background: m === x ? "var(--accent)" : "var(--surface2)", color: m === x ? "#fff" : "var(--text)" }}>:{p2(x)}</button>)}
          <select value={m} onChange={e => setM(+e.target.value)} aria-label="Otros minutos" style={{ ...C.miniSelect, height: 40 }}>{Array.from({ length: 12 }, (_, i) => i * 5).map(x => <option key={x} value={x}>:{p2(x)}</option>)}</select>
        </div>
      </Sheet>
    )}
  </>);
}

/* ===================== Pantalla principal ===================== */
export function Entradas(props) {
  const [modo, setModo] = useState(() => { try { return localStorage.getItem("tixfast_entradas_modo") || "eventos"; } catch { return "eventos"; } });
  const cambiar = (m) => { setModo(m); try { localStorage.setItem("tixfast_entradas_modo", m); } catch {} };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div role="tablist" aria-label="Entradas" style={{ display: "flex", gap: 6, background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 14, padding: 4, alignSelf: "flex-start", maxWidth: "100%" }}>
        {[["eventos", "Eventos", "ticket"], ["orgs", "Organizaciones", "globe"]].map(([k, t, i]) => (
          <button key={k} role="tab" aria-selected={modo === k} onClick={() => cambiar(k)} style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 40, padding: "0 16px", borderRadius: 11, border: "none", fontWeight: 900, fontSize: 14.5, cursor: "pointer", background: modo === k ? "var(--accent)" : "transparent", color: modo === k ? "#fff" : "var(--text)" }}><Icon n={i} s={16} />{t}</button>))}
      </div>
      {modo === "orgs" ? <Organizaciones flash={props.flash} /> : <EntradasEventos {...props} />}
    </div>
  );
}
function EntradasEventos({ ev, events, onSelectEvent, flash, ingresos, barras, onVentaEntradas, onEditarIngreso }) {
  const isMobile = useIsMobile();
  const [lista, setLista] = useState(null);        // { eventoId: resumen de su venta online }
  const [d, setD] = useState(null);                // { ficha, tramos } del evento elegido
  const [cargando, setCargando] = useState(true);
  const [nuevo, setNuevo] = useState(false);
  const [dup, setDup] = useState(false);
  const [elegir, setElegir] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verClientes, setVerClientes] = useState(false);

  const refrescarLista = () => crm.webListar().then(setLista).catch(() => setLista({}));
  useEffect(() => { refrescarLista(); }, []);
  useEffect(() => {
    let vivo = true; setCargando(true); setD(null);
    crm.webCargar(ev.id).then(x => { if (vivo) setD(x); }).catch(() => { if (vivo) setD({ ficha: null, tramos: [], error: true }); }).finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [ev.id]);

  const activar = async () => {
    setBusy(true);
    try { const ficha = await crm.webActivar(ev); setD({ ficha, tramos: [] }); refrescarLista(); flash("Venta online activada (en borrador)"); }
    catch (e) { flash(e.message || "No se ha podido activar", "warn"); } finally { setBusy(false); }
  };
  const ordenados = useMemo(() => [...events].sort((a, b) => String(b.startsAt || b.date || "").localeCompare(String(a.startsAt || a.date || ""))), [events]);
  const w = lista?.[ev.id];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ===== Evento elegido (se cambia en una lista) ===== */}
      <div style={{ ...C.panel, padding: 10, display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={() => setElegir(true)} aria-label={`Cambiar de evento (ahora: ${ev.name})`} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 12, background: "transparent", border: "none", color: "var(--text)", cursor: "pointer", textAlign: "left", padding: 2 }}>
          <Miniatura url={d?.ficha?.flyer_url || w?.flyer_url} s={48} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 11.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>Evento</span>
            <b style={{ display: "block", fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.name}</b>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{fechaTxt(ev.startsAt || ev.date)}</span>
          </span>
          <span style={{ ...C.btnSm, flexShrink: 0 }}>{isMobile ? "" : "Cambiar"}<Icon n="chev" s={14} /></span>
        </button>
        <button onClick={() => setNuevo(true)} aria-label="Nuevo evento" style={{ ...C.btnPrimary, minHeight: 44, ...(isMobile ? { padding: "0 14px" } : {}) }}><Icon n="plus" s={16} w={2.4} />{isMobile ? "Nuevo" : "Nuevo evento"}</button>
      </div>

      {/* ===== El dinero de entradas de todos los canales, siempre arriba ===== */}
      {!verClientes && ingresos && (
        <DineroEntradas ingresos={ingresos} titulo="Dinero de entradas · todos los canales"
          onAnadir={onVentaEntradas ? () => onVentaEntradas({}) : null}
          onEditar={(i) => (i.canal ? onVentaEntradas?.(i) : onEditarIngreso?.(i))}
          onClientes={d?.ficha ? () => { setVerClientes(true); window.scrollTo({ top: 0, behavior: "smooth" }); } : null} />
      )}

      {cargando ? <div style={{ ...C.panel, color: "var(--muted)", textAlign: "center" }}>Cargando…</div>
        : d?.error ? <div style={{ ...C.panel, color: "var(--amber)", fontWeight: 700 }}>No se ha podido cargar la venta online. Revisa la conexión.</div>
        : !d?.ficha ? (
          <section style={{ ...C.hero, padding: isMobile ? 18 : 28, textAlign: "center" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}><Tile n="ticket" s={56} /></div>
            <div style={{ fontSize: isMobile ? 22 : 28, fontWeight: 900 }}>Vende entradas de «{ev.name}» online</div>
            <div style={{ color: "var(--muted)", fontSize: 14, maxWidth: 520, margin: "8px auto 16px" }}>Tendrá su propia página de venta con el flyer, los tramos, cuenta atrás y entradas nominativas con QR de un solo uso. Empieza en borrador: nadie la ve hasta que la publiques.</div>
            <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
              {PASOS.map((p, i) => <span key={p.k} style={{ ...C.tag }}><b style={{ color: "var(--accent)" }}>{i + 1}</b>{p.t}</span>)}
            </div>
            <button disabled={busy} onClick={activar} style={{ ...C.btnPrimary, minHeight: 50, padding: "0 26px", fontSize: 16 }}><Icon n="sparkle" s={18} />{busy ? "Activando…" : "Empezar"}</button>
          </section>
        ) : verClientes ? <Clientes ev={ev} flash={flash} onVolver={() => setVerClientes(false)} />
        : (<>
          <ResumenVentas ev={ev} onAbrir={() => { setVerClientes(true); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
          <Editor key={ev.id} ev={ev} d={d} setD={setD} flash={flash} isMobile={isMobile} onDuplicar={() => setDup(true)} onCambio={refrescarLista} />
        </>)}

      {elegir && (
        <Sheet title="Tus eventos" onClose={() => setElegir(false)}
          footer={<button onClick={() => { setElegir(false); setNuevo(true); }} style={{ ...C.btnPrimary, width: "100%", minHeight: 46 }}><Icon n="plus" s={16} w={2.4} />Nuevo evento</button>}>
          {ordenados.map(e => { const x = lista?.[e.id]; const on = e.id === ev.id; const est = x ? ESTADOS[x.estado] : null; return (
            <button key={e.id} onClick={() => { onSelectEvent(e.id); setElegir(false); }} style={{ ...C.listBtn, padding: "10px 6px", borderRadius: 12, background: on ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "transparent" }}>
              <Miniatura url={x?.flyer_url} s={46} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</b>
                <span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{fechaTxt(e.startsAt || e.date)}</span>
                <span style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
                  {x ? <Badge c={est.c}>{est.t}</Badge> : <Badge>Sin venta online</Badge>}
                  {x?.modo === "pruebas" && <Badge c="var(--amber)">Pruebas</Badge>}
                  {x && <Badge c="var(--blue)">{x.vendidas}{x.aforo != null ? ` / ${x.aforo}` : ""} vendidas</Badge>}
                </span>
              </span>
              {on && <Icon n="check" s={18} c="var(--accent)" w={2.6} />}
            </button>); })}
        </Sheet>
      )}
      {nuevo && <NuevoEvento busy={busy} onClose={() => setNuevo(false)} onCrear={async (nombre, inicio, fin) => {
        setBusy(true);
        try {
          const id = await crm.webNuevoEvento(nombre, inicio);
          if (fin) await crm.webGuardarEvento(id, { fin: aIso(fin) });
          await crm.webActivar({ id, name: nombre }).catch(() => null);   // listo para configurar su venta online
          setNuevo(false); flash("Evento creado"); await refrescarLista(); setTimeout(() => onSelectEvent(id), 900);
        } catch { flash("No se ha podido crear el evento", "warn"); } finally { setBusy(false); }
      }} />}
      {dup && d?.ficha && <NuevoEvento titulo="Duplicar evento" nota="Se copian la ficha, los tramos, el formulario y el diseño. Sin ventas y en borrador." inicial={`${ev.name} (COPIA)`} sinFecha busy={busy} onClose={() => setDup(false)}
        onCrear={async (nombre) => {
          setBusy(true);
          try { const r = await crm.webDuplicar(ev, d.ficha, d.tramos, nombre); setDup(false); flash("Evento duplicado"); await refrescarLista(); setTimeout(() => onSelectEvent(r.id), 900); }
          catch { flash("No se ha podido duplicar", "warn"); } finally { setBusy(false); }
        }} />}
    </div>
  );
}
const Miniatura = ({ url, s }) => (
  <span style={{ width: s, height: s, borderRadius: 12, flexShrink: 0, overflow: "hidden", background: "var(--surface2)", display: "grid", placeItems: "center", border: "1px solid var(--line)" }}>
    {url ? <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Icon n="ticket" s={Math.round(s * .42)} c="var(--muted)" />}
  </span>
);

/* ===================== Ficha del evento: pasos ===================== */
function Editor({ ev, d, setD, flash, isMobile, onDuplicar, onCambio }) {
  const f = d.ficha;
  const ancho = useAncho();
  const lateral = ancho >= 1080;                   // vista del móvil fija a la derecha
  const [evLocal, setEvLocal] = useState({ nombre: ev.name || "", inicio: ev.startsAt || "", fin: aLocal(ev.endsAt), recinto: ev.venue || "" });
  const [guardarFicha, estFicha] = useAutoguardado(async (patch) => { await crm.webGuardarFicha(ev.id, patch); });
  const [guardarEv, estEv] = useAutoguardado(async (patch) => { await crm.webGuardarEvento(ev.id, patch); });
  const pend = useRef({});
  const setFicha = (patch) => { setD(x => ({ ...x, ficha: { ...x.ficha, ...patch } })); pend.current = { ...pend.current, ...patch }; const p = pend.current; guardarFicha(p); setTimeout(() => { if (pend.current === p) pend.current = {}; }, 800); };
  const pendEv = useRef({});
  const setEv = (k, v, col, conv = (x) => x) => { setEvLocal(x => ({ ...x, [k]: v })); pendEv.current = { ...pendEv.current, [col]: conv(v) }; const p = pendEv.current; guardarEv(p); setTimeout(() => { if (pendEv.current === p) pendEv.current = {}; }, 800); };
  const setInicio = (v) => { setEvLocal(x => ({ ...x, inicio: v })); pendEv.current = { ...pendEv.current, inicio: v || null, ...(v ? { fecha: v.slice(0, 10) } : {}) }; const p = pendEv.current; guardarEv(p); setTimeout(() => { if (pendEv.current === p) pendEv.current = {}; }, 800); };
  const estado = [estFicha, estEv].includes("error") ? "error" : [estFicha, estEv].includes("guardando") ? "guardando" : (estFicha || estEv) ? "guardado" : "";
  useEffect(() => { if (estado === "guardado") onCambio && onCambio(); }, [estado]);

  const url = urlVenta(f.slug);
  const copiar = async () => { try { await navigator.clipboard.writeText(url); flash("Enlace copiado"); } catch { flash(url); } };
  const subir = async (tipo, file, campo) => {
    if (!file) return;
    const img = tipo !== "autorizacion";
    if (file.size > (img ? 25 : 10) * 1024 * 1024) { flash(`Archivo demasiado grande (máx. ${img ? 25 : 10} MB)`, "warn"); return; }
    const listo = img ? await reducirImagen(file, tipo === "logo" ? 600 : 1600, tipo === "logo" ? "image/png" : "image/jpeg") : file;
    try { const u = await crm.webSubir(ev.id, tipo, listo); setFicha({ [campo]: u }); flash("Subido"); }
    catch { flash("No se ha podido subir el archivo", "warn"); }
  };
  const form = { ...crm.FORM_DEF, ...(f.formulario || {}) };
  const avisos = { ...crm.AVISOS_DEF, ...(f.avisos || {}) };
  const diseno = { ...crm.DISENO_DEF, ...(f.diseno || {}) };
  const fRef = useRef(f); fRef.current = f;
  const setDiseno = (patch) => setFicha({ diseno: { ...crm.DISENO_DEF, ...(fRef.current.diseno || {}), ...patch } });
  const galeria = Array.isArray(diseno.galeria) ? diseno.galeria : [];
  const subirGaleria = async (files) => {
    const hueco = 12 - galeria.length; const lista = [...files].filter(x => /^image\//.test(x.type)).slice(0, Math.max(0, hueco));
    if (!lista.length) { flash(hueco <= 0 ? "Máximo 12 fotos" : "Elige fotos (JPG, PNG o WEBP)", "warn"); return; }
    const urls = [];
    for (const fl of lista) {
      if (fl.size > 25 * 1024 * 1024) continue;
      try { urls.push(await crm.webSubir(ev.id, "galeria", await reducirImagen(fl, 1600, "image/jpeg"))); } catch {}
    }
    if (urls.length) { const act = Array.isArray(fRef.current.diseno?.galeria) ? fRef.current.diseno.galeria : []; setDiseno({ galeria: [...act, ...urls].slice(0, 12) }); }
    flash(urls.length === lista.length ? `${urls.length} foto${urls.length > 1 ? "s" : ""} añadida${urls.length > 1 ? "s" : ""}` : `Se han subido ${urls.length} de ${lista.length}`, urls.length === lista.length ? undefined : "warn");
  };
  const est = ESTADOS[f.estado] || ESTADOS.borrador;
  const finMal = !!(evLocal.fin && evLocal.inicio && new Date(evLocal.fin) <= new Date(evLocal.inicio));
  // Lo imprescindible para poder publicar
  const req = [
    { k: "nombre", t: "Nombre del evento", ok: evLocal.nombre.trim().length >= 3, paso: 0 },
    { k: "inicio", t: "Día y hora de inicio", ok: !!evLocal.inicio && evLocal.inicio.length > 10, paso: 0 },
    { k: "fin", t: "Hora de fin (hasta entonces vale el QR)", ok: !!evLocal.fin && !finMal, paso: 0 },
    { k: "flyer", t: "Flyer", ok: !!f.flyer_url, paso: 1 },
    { k: "tramo", t: "Al menos un tramo de entradas visible", ok: d.tramos.some(t => t.visible), paso: 2 },
  ];
  const listo = req.every(r => r.ok);
  const hecho = [req[0].ok && req[1].ok && req[2].ok, req[3].ok, req[4].ok, true, true, f.estado === "publicado"];

  const [vista, setVista] = useState(f.estado === "publicado" ? "ventas" : "config");
  const [paso, setPasoRaw] = useState(() => { if (f.estado !== "borrador") return 5; const i = req.findIndex(r => !r.ok); return i < 0 ? 5 : req[i].paso; });
  const arriba = useRef(null);
  const setPaso = (i) => { setPasoRaw(i); setVista("config"); setTimeout(() => arriba.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30); };
  const [verPrevia, setVerPrevia] = useState(false);
  const [confirmarCierre, setConfirmarCierre] = useState(false);
  const cambiarEstado = (v) => {
    if (v === "publicado" && !listo) { flash("Falta algo para publicar: mira la lista", "warn"); setPaso(5); return; }
    setFicha({ estado: v }); setConfirmarCierre(false);
    flash(v === "publicado" ? "¡Publicado! Ya se puede comprar en el enlace" : v === "cerrado" ? "Venta cerrada" : "Pasado a borrador: la página ya no es pública");
  };
  const wa = `https://wa.me/?text=${encodeURIComponent(`${evLocal.nombre} · ${fechaTxt(evLocal.inicio)} · Entradas: ${url}`)}`;
  const evPrevia = {
    slug: f.slug, estado: f.estado, modo: f.modo, vista_previa: true, nombre: evLocal.nombre || ev.name, fecha: (evLocal.inicio || "").slice(0, 10) || ev.date,
    inicio: evLocal.inicio, fin: aIso(evLocal.fin), recinto: evLocal.recinto, descripcion: f.descripcion, direccion: f.direccion, maps_url: f.maps_url,
    edad_minima: f.edad_minima, autorizacion_url: f.autorizacion_url, autorizacion_edad: f.autorizacion_edad, vestimenta: f.vestimenta,
    flyer_url: f.flyer_url, logo_url: f.logo_url, diseno, formulario: form, avisos, venta_inicio: f.venta_inicio,
    tramos: d.tramos.filter(t => t.visible).map(t => ({ id: t.id, nombre: t.nombre, descripcion: t.descripcion, precio: t.precio, cantidad: t.cantidad, max_por_compra: t.max_por_compra, copas: t.copas, venta_inicio: t.venta_inicio, venta_fin: t.venta_fin, estado: "venta", quedan: t.cantidad == null ? null : Math.max(0, t.cantidad - (t.vendidas || 0)) })),
  };
  const previa = <MovilReal ev={evPrevia} />;
  const tarjeta = (i, t, sub, children, extra) => (
    <section style={{ ...C.panel, padding: isMobile ? 14 : 18 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
        <Tile n={i} s={36} />
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 900, fontSize: 16 }}>{t}</div>{sub && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}</div>
        {extra}
      </div>
      {children}
    </section>
  );

  const contenido = [
    /* ---------- 1 · Evento ---------- */
    <div key="evento" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {tarjeta("calendar", "Lo imprescindible", "Se comparte con el TPV. La hora de fin marca hasta cuándo valen los QR.", <>
        <Field l="Nombre del evento"><input style={{ ...C.input, fontWeight: 800, fontSize: 17 }} value={evLocal.nombre} maxLength={80} onChange={e => setEv("nombre", e.target.value, "nombre", v => v.toUpperCase())} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "0 12px" }}>
          <Field l="Empieza"><FechaHora valor={evLocal.inicio} onChange={setInicio} titulo="¿Cuándo empieza?" placeholder="Elegir día y hora de inicio" quitar={false} /></Field>
          <Field l="Termina"><FechaHora valor={evLocal.fin} onChange={(v) => setEv("fin", v, "fin", aIso)} titulo="¿Cuándo termina?" placeholder="Elegir día y hora de fin" base={evLocal.inicio}
            aviso="Si acaba de madrugada, elige el día siguiente (o usa un atajo)."
            sugerencias={evLocal.inicio && evLocal.inicio.length > 10 ? [{ t: "4 h después", v: sumarHoras(evLocal.inicio, 4) }, { t: "6 h después", v: sumarHoras(evLocal.inicio, 6) }, { t: "8 h después", v: sumarHoras(evLocal.inicio, 8) }] : []} /></Field>
        </div>
        {finMal && <div style={{ fontSize: 13, color: "var(--red)", fontWeight: 700, marginTop: -6, marginBottom: 6 }}>La hora de fin es anterior al inicio. Si acaba de madrugada, elige el día siguiente.</div>}
        {evLocal.inicio && evLocal.inicio.length <= 10 && <div style={{ fontSize: 13, color: "var(--amber)", fontWeight: 700, marginTop: -6 }}>Falta la hora de inicio: toca la fecha y elige la hora.</div>}
      </>)}
      {tarjeta("globe", "Organización", "La marca o la sala que organiza. El evento sale en su microsite y se puede comprar junto a sus otras fiestas.", (
        <SelectorOrg valor={f.organizacion_id || ""} onChange={(v) => setFicha({ organizacion_id: v || null })} />
      ))}
      {tarjeta("building", "Dónde y cómo", "Aparece en la página de venta.", <>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "0 12px" }}>
          <Field l="Recinto"><input style={C.input} value={evLocal.recinto} maxLength={120} placeholder="Ej. Sala Apolo" onChange={e => setEv("recinto", e.target.value, "recinto")} /></Field>
          <Field l="Dirección"><input style={C.input} value={f.direccion || ""} maxLength={300} placeholder="Calle, número, ciudad" onChange={e => setFicha({ direccion: e.target.value, maps_url: e.target.value ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((evLocal.recinto ? evLocal.recinto + ", " : "") + e.target.value)}` : null })} /></Field>
          <Field l="Vestimenta"><input style={C.input} value={f.vestimenta || ""} maxLength={300} placeholder="Ej. Total white · Etiqueta · Libre" onChange={e => setFicha({ vestimenta: e.target.value })} /></Field>
          <Field l="Edad mínima"><div style={{ position: "relative" }}><input inputMode="numeric" style={{ ...C.input, paddingRight: 52 }} value={f.edad_minima ?? ""} placeholder="Sin mínimo" onChange={e => { const v = limpioNum(e.target.value); setFicha({ edad_minima: v === "" ? null : Math.min(99, +v) }); }} />{f.edad_minima != null && <span style={sufijo}>años</span>}</div></Field>
        </div>
        <Field l="Descripción" mb={0}><textarea style={{ ...C.input, minHeight: 110, resize: "vertical", fontFamily: "inherit" }} value={f.descripcion || ""} maxLength={4000} placeholder="Line-up, horarios, normas, cómo llegar…" onChange={e => setFicha({ descripcion: e.target.value })} /></Field>
      </>)}
    </div>,

    /* ---------- 2 · Flyer ---------- */
    <div key="flyer" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {tarjeta("upload", "Flyer o cartel", "Vertical u horizontal. JPG, PNG o WEBP. Se reduce solo para que la página cargue rápido.", (
        <Subida t="Flyer" url={f.flyer_url} img grande accept="image/*" onFile={(fl) => subir("flyer", fl, "flyer_url")} onQuitar={() => setFicha({ flyer_url: null })} alto={isMobile ? 300 : 360} />
      ))}
      {tarjeta("eye", `Galería de fotos (${galeria.length}/12)`, "Fotos de la fiesta, del local o de otras ediciones. Pasan solas en la página y se pueden ampliar.", (
        <GaleriaEditor fotos={galeria} isMobile={isMobile} onOrden={(arr) => setDiseno({ galeria: arr })} onSubir={subirGaleria} />
      ))}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
        {tarjeta("sparkle", "Logo", "Opcional. Se muestra arriba en la página.", (
          <Subida t="Logo" url={f.logo_url} img accept="image/*" onFile={(fl) => subir("logo", fl, "logo_url")} onQuitar={() => setFicha({ logo_url: null })} alto={130} />
        ))}
        {tarjeta("file", "Autorización para menores", "PDF opcional: lo descargan, lo rellenan y lo traen a mano.", <>
          <Subida t="Autorización (PDF)" url={f.autorizacion_url} accept="application/pdf" onFile={(fl) => subir("autorizacion", fl, "autorizacion_url")} onQuitar={() => setFicha({ autorizacion_url: null })} alto={130} />
          <Field l="Se pide a menores de" mb={0}><div style={{ position: "relative" }}><input inputMode="numeric" style={{ ...C.input, paddingRight: 52 }} value={f.autorizacion_edad ?? 16} onChange={e => setFicha({ autorizacion_edad: Math.min(99, +limpioNum(e.target.value) || 0) })} /><span style={sufijo}>años</span></div></Field>
        </>)}
      </div>
    </div>,

    /* ---------- 3 · Entradas ---------- */
    <Tramos key="entradas" ev={ev} d={d} setD={setD} ficha={f} setFicha={setFicha} flash={flash} isMobile={isMobile} inicio={evLocal.inicio} />,

    /* ---------- 4 · Diseño ---------- */
    <div key="diseno" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {tarjeta("sparkle", "Plantilla de la página", lateral ? "Mira el cambio en el móvil de la derecha." : "Toca una y mírala en «Ver cómo queda».", (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,minmax(0,1fr))", gap: 10 }}>
          {PLANTILLAS_WEB.map(pl => { const on = (diseno.plantilla || "clasica") === pl.k; return (
            <button key={pl.k} onClick={() => setDiseno({ plantilla: pl.k })} aria-pressed={on} style={{ textAlign: "left", padding: 8, borderRadius: 14, cursor: "pointer", color: "var(--text)", border: `2px solid ${on ? "var(--accent)" : "var(--line)"}`, background: on ? "color-mix(in srgb, var(--accent) 8%, var(--surface))" : "var(--surface)" }}>
              <Esquema k={pl.k} color={diseno.color} oscuro={diseno.fondo !== "claro"} />
              <b style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 14.5 }}>{on && <Icon n="check" s={14} w={3} c="var(--accent)" />}{pl.t}</b>
              <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)", marginTop: 2, lineHeight: 1.35 }}>{pl.sub}</span>
            </button>); })}
        </div>
      ), <button onClick={() => setVerPrevia(true)} style={{ ...C.btnSm, flexShrink: 0 }}><Icon n="eye" s={14} />{isMobile ? "Ver" : "Ver en grande"}</button>)}
      {tarjeta("sparkle", "Colores y letra", null, <>
        <Field l="Color principal (botones y precios)">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {COLORES.map(c => <button key={c} onClick={() => setDiseno({ color: c })} aria-label={`Color ${c}`} aria-pressed={diseno.color === c} style={{ width: 38, height: 38, borderRadius: 12, background: c, cursor: "pointer", border: diseno.color === c ? "3px solid var(--text)" : "3px solid transparent" }} />)}
            <input type="color" value={diseno.color} onChange={e => setDiseno({ color: e.target.value })} aria-label="Otro color" style={{ width: 48, height: 38, border: "none", background: "transparent", cursor: "pointer" }} />
          </div>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
          <Field l="Fondo"><Seg full valor={diseno.fondo} onChange={(v) => setDiseno({ fondo: v })} opciones={[{ k: "oscuro", t: "Oscuro", i: "moon" }, { k: "claro", t: "Claro", i: "sun" }]} /></Field>
          <Field l="Tipo de letra"><Seg full valor={diseno.letra} onChange={(v) => setDiseno({ letra: v })} opciones={LETRAS} /></Field>
        </div>
        <Sw on={diseno.fondoFlyer} onClick={() => setDiseno({ fondoFlyer: !diseno.fondoFlyer })} l="Usar el flyer difuminado de fondo" sub="En la plantilla Inmersiva el fondo son tus fotos." />
      </>)}
      {tarjeta("megaphone", "Textos que venden", "Cortos y directos. Si los dejas vacíos, la página funciona igual.", <>
        <Field l="Frase bajo el nombre"><input style={C.input} value={diseno.lema || ""} maxLength={120} placeholder="Ej. La fiesta más grande del año vuelve a KM Cero" onChange={e => setDiseno({ lema: e.target.value })} /></Field>
        <Field l="Texto del botón de compra"><input style={C.input} value={diseno.textoBoton || ""} maxLength={28} placeholder="Comprar entradas" onChange={e => setDiseno({ textoBoton: e.target.value })} /><div style={ayuda}>Ej. «Quiero mi entrada», «Reserva ya». Junto al botón sale el precio «desde».</div></Field>
        <Field l="Line-up (uno por línea)" mb={0}><textarea style={{ ...C.input, minHeight: 100, resize: "vertical", fontFamily: "inherit" }} value={diseno.lineup || ""} maxLength={800} placeholder={"CABEZA DE CARTEL\nDJ INVITADO\nRESIDENTES"} onChange={e => setDiseno({ lineup: e.target.value })} /><div style={ayuda}>El primero sale más grande.</div></Field>
      </>)}
    </div>,

    /* ---------- 5 · Opciones ---------- */
    <div key="opciones" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {tarjeta("bolt", "Avisos de urgencia", "Siempre con datos reales: solo salen cuando de verdad quedan pocas.", <>
        <Sw primero on={avisos.activo} onClick={() => setFicha({ avisos: { ...avisos, activo: !avisos.activo } })} l="Mostrar «¡Quedan pocas!» y «Últimas entradas»" />
        {avisos.activo && <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "0 12px", marginTop: 10 }}>
          <Field l="Avisar cuando quede menos del"><div style={{ position: "relative" }}><input inputMode="numeric" style={{ ...C.input, paddingRight: 30 }} value={avisos.umbralPct} onChange={e => setFicha({ avisos: { ...avisos, umbralPct: Math.min(100, +limpioNum(e.target.value) || 0) } })} /><span style={sufijo}>%</span></div></Field>
          <Field l="«Últimas X» a partir de (entradas)"><input inputMode="numeric" style={C.input} placeholder="Ej. 20" value={avisos.umbralN} onChange={e => setFicha({ avisos: { ...avisos, umbralN: limpioNum(e.target.value) } })} /></Field>
        </div>}
        <Sw on={avisos.mostrarVendido} onClick={() => setFicha({ avisos: { ...avisos, mostrarVendido: !avisos.mostrarVendido } })} l="Barra de «% vendido» en cada tramo" />
        <Sw on={avisos.siguientePrecio} onClick={() => setFicha({ avisos: { ...avisos, siguientePrecio: !avisos.siguientePrecio } })} l="Avisar del precio del siguiente tramo («Después sube a 22 €»)" />
      </>)}
      {tarjeta("user", "Datos que se piden al comprar", "Nombre completo, correo y el nombre de cada asistente se piden siempre (entradas nominativas).", <>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
          <Badge c="var(--green)"><Icon n="lock" s={11} w={2.4} />Nombre completo</Badge>
          <Badge c="var(--green)"><Icon n="lock" s={11} w={2.4} />Correo</Badge>
          <Badge c="var(--green)"><Icon n="lock" s={11} w={2.4} />Nombre de cada asistente</Badge>
        </div>
        {CAMPOS.map(c => (
          <div key={c.k} style={{ ...C.row, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700 }}>{c.t}</span>
            <Seg size="sm" valor={form[c.k]} onChange={(v) => setFicha({ formulario: { ...form, [c.k]: v } })} opciones={[{ k: "no", t: "No pedir" }, { k: "opcional", t: "Opcional" }, { k: "obligatorio", t: "Obligatorio" }]} />
          </div>))}
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Pide solo lo que necesites: cuantos menos datos, más gente termina la compra (y menos datos personales que custodiar).</div>
      </>)}
      {tarjeta("clock", "Lanzamiento, QR y límites", "Cuenta atrás, desde cuándo vale el QR y cuántas entradas por persona.", <>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "0 12px" }}>
          <Field l="La venta empieza (cuenta atrás)"><FechaHora valor={aLocal(f.venta_inicio)} onChange={(v) => setFicha({ venta_inicio: aIso(v) })} titulo="¿Cuándo se abre la venta?" placeholder="En cuanto publiques" /><div style={ayuda}>Si es futura, la página muestra una cuenta atrás.</div></Field>
          <Field l="El QR vale desde"><div style={{ position: "relative" }}><input inputMode="numeric" style={{ ...C.input, paddingRight: 120 }} value={f.qr_horas_antes} onChange={e => setFicha({ qr_horas_antes: Math.min(720, +limpioNum(e.target.value) || 0) })} /><span style={sufijo}>h antes del inicio</span></div><div style={ayuda}>Hasta la hora de fin. Ni antes ni después.</div></Field>
          <Field l="Máximo por persona (correo)"><input inputMode="numeric" style={C.input} value={f.max_por_email} onChange={e => setFicha({ max_por_email: Math.max(1, Math.min(100, +limpioNum(e.target.value) || 1)) })} /><div style={ayuda}>Contra la reventa y los bots.</div></Field>
        </div>
        <EnlaceEditable ev={ev} f={f} setD={setD} flash={flash} />
      </>)}
    </div>,

    /* ---------- 6 · Publicar ---------- */
    <div key="publicar" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {tarjeta("check", listo ? "Todo listo para vender" : "Antes de publicar", listo ? "Lo imprescindible está completo." : "Toca lo que falta para ir directo.", (
        <div>{req.map(r => (
          <button key={r.k} onClick={() => !r.ok && setPaso(r.paso)} style={{ ...C.listBtn, cursor: r.ok ? "default" : "pointer", padding: "11px 4px" }}>
            <span style={{ width: 28, height: 28, borderRadius: 28, display: "grid", placeItems: "center", flexShrink: 0, background: r.ok ? "var(--green)" : "color-mix(in srgb, var(--amber) 18%, transparent)", color: r.ok ? "#04231a" : "var(--amber)" }}><Icon n={r.ok ? "check" : "alert"} s={15} w={2.6} /></span>
            <span style={{ flex: 1, fontWeight: 800, color: r.ok ? "var(--text)" : "var(--amber)" }}>{r.t}</span>
            {!r.ok && <span style={{ ...C.btnSm, color: "var(--accent)" }}>Completar<Icon n="right" s={13} /></span>}
          </button>))}
        </div>))}
      {tarjeta("shield", "¿Entradas de prueba o reales?", null, (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
          {[["pruebas", "Pruebas", "Se puede «comprar» cualquier tramo sin pagar. Las entradas salen marcadas como PRUEBA y no valen en la puerta."], ["real", "Real", "Entradas válidas para entrar. Por ahora solo se emiten los tramos gratuitos (0 €); los de pago llegarán con la pasarela de cobro."]].map(([k, t, s]) => {
            const on = (f.modo || "pruebas") === k; return (
              <button key={k} onClick={() => setFicha({ modo: k })} aria-pressed={on} style={{ textAlign: "left", padding: 14, borderRadius: 14, cursor: "pointer", color: "var(--text)", border: `2px solid ${on ? (k === "real" ? "var(--green)" : "var(--amber)") : "var(--line)"}`, background: on ? `color-mix(in srgb, ${k === "real" ? "var(--green)" : "var(--amber)"} 9%, var(--surface))` : "var(--surface)" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900, fontSize: 15.5 }}><span style={{ width: 20, height: 20, borderRadius: 20, border: `2px solid ${on ? "var(--text)" : "var(--line)"}`, display: "grid", placeItems: "center" }}>{on && <span style={{ width: 10, height: 10, borderRadius: 10, background: "var(--text)" }} />}</span>{t}</span>
                <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)", marginTop: 6, lineHeight: 1.4 }}>{s}</span>
              </button>); })}
        </div>))}
      <section style={{ ...C.hero, padding: isMobile ? 16 : 20 }}>
        {f.estado === "borrador" && <>
          <div style={{ fontWeight: 900, fontSize: 18 }}>Poner a la venta</div>
          <div style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 14px" }}>{f.venta_inicio && new Date(f.venta_inicio) > new Date() ? `Se publica ya con cuenta atrás: la venta se abre el ${fechaTxt(aLocal(f.venta_inicio), true)}.` : "La página será pública y se podrá comprar en el enlace."}</div>
          <button onClick={() => cambiarEstado("publicado")} disabled={!listo} style={{ ...C.btnPrimary, width: "100%", minHeight: 56, fontSize: 17, opacity: listo ? 1 : .45, background: f.modo === "real" ? "var(--green)" : "var(--accent)", color: f.modo === "real" ? "#04231a" : "#fff" }}><Icon n="sparkle" s={19} />{f.modo === "real" ? "Publicar ahora" : "Publicar en modo pruebas"}</button>
          {!listo && <div style={{ fontSize: 12.5, color: "var(--amber)", fontWeight: 700, marginTop: 8, textAlign: "center" }}>Completa la lista de arriba para poder publicar.</div>}
        </>}
        {f.estado !== "borrador" && <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Badge c={est.c} solid>{est.t}</Badge>
            {f.modo === "pruebas" && <Badge c="var(--amber)">Modo pruebas</Badge>}
          </div>
          <div style={{ fontWeight: 900, fontSize: 18, marginTop: 8 }}>{f.estado === "publicado" ? "Tu evento está a la venta" : "La venta está cerrada"}</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>{f.estado === "publicado" ? "Comparte el enlace. Puedes seguir cambiando cosas: se actualiza al momento." : "La página se ve, pero ya no se puede comprar."}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            {f.estado === "cerrado" && <button onClick={() => cambiarEstado("publicado")} style={{ ...C.btnPrimary, flex: "1 1 180px", minHeight: 46 }}>Volver a abrir la venta</button>}
            {f.estado === "publicado" && (confirmarCierre
              ? <><button onClick={() => cambiarEstado("cerrado")} style={{ ...C.btnGhost, flex: "1 1 160px", borderColor: "var(--red)", color: "var(--red)" }}>Sí, cerrar la venta</button><button onClick={() => setConfirmarCierre(false)} style={{ ...C.btnGhost, flex: "1 1 100px" }}>No</button></>
              : <button onClick={() => setConfirmarCierre(true)} style={{ ...C.btnGhost, flex: "1 1 160px" }}><Icon n="lock" s={15} />Cerrar la venta</button>)}
            <button onClick={() => cambiarEstado("borrador")} style={{ ...C.btnGhost, flex: "1 1 160px" }}><Icon n="eyeOff" s={15} />Pasar a borrador</button>
          </div>
        </>}
      </section>
      {tarjeta("link", "Comparte el enlace", null, <Compartir url={url} wa={wa} copiar={copiar} borrador={f.estado === "borrador"} onDuplicar={onDuplicar} />)}
      {!lateral && tarjeta("phone", "Así lo verá el comprador", "Es la página de verdad, con tu plantilla, fotos y entradas.", <div style={{ display: "flex", justifyContent: "center" }}>{previa}</div>)}
    </div>,
  ];

  return (<>
    {/* ===== Cabecera: estado y enlace ===== */}
    <section style={{ ...C.hero, padding: isMobile ? 14 : 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Badge c={est.c} solid={f.estado === "publicado"}>{est.t}</Badge>
        {f.modo === "pruebas" && <Badge c="var(--amber)">Modo pruebas</Badge>}
        <span style={{ fontSize: 12, fontWeight: 700, color: estado === "error" ? "var(--red)" : "var(--muted)", display: "inline-flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
          {estado === "guardando" ? "Guardando…" : estado === "guardado" ? <><Icon n="check" s={13} w={2.6} />Guardado</> : estado === "error" ? "No se ha guardado" : "Se guarda solo"}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <code style={{ background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 10px", fontSize: 13, overflowWrap: "anywhere", flex: "1 1 220px", minWidth: 0 }}>{url}</code>
        <button onClick={copiar} style={C.btnSm}><Icon n="copy" s={14} />Copiar</button>
        <a href={url} target="_blank" rel="noopener noreferrer" style={{ ...C.btnSm, textDecoration: "none" }}><Icon n="eye" s={14} />{f.estado === "borrador" ? "Vista previa" : "Abrir"}</a>
      </div>
      {/* Configurar / Ventas */}
      <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
        {[["config", "Configurar", "gear"], ["ventas", "Ventas y asistentes", "users"]].map(([k, t, i]) => (
          <button key={k} onClick={() => setVista(k)} style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 44, borderRadius: 12, fontWeight: 900, fontSize: 14.5, cursor: "pointer", border: `1px solid ${vista === k ? "var(--accent)" : "var(--line)"}`, background: vista === k ? "var(--accent)" : "var(--surface2)", color: vista === k ? "#fff" : "var(--text)" }}><Icon n={i} s={16} />{t}</button>))}
      </div>
    </section>

    {vista === "ventas" ? <Ventas ev={ev} flash={flash} isMobile={isMobile} /> : (<>
      {/* ===== Pasos ===== */}
      <nav ref={arriba} aria-label="Pasos" style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: isMobile ? 3 : 8, scrollMarginTop: 12 }}>
        {PASOS.map((p, i) => { const on = i === paso; const ok = hecho[i] && i !== 3 && i !== 4; return (
          <button key={p.k} onClick={() => setPaso(i)} aria-current={on ? "step" : undefined}
            style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: "center", gap: isMobile ? 4 : 10, padding: isMobile ? "9px 2px" : "11px 12px", borderRadius: 14, cursor: "pointer", minWidth: 0, textAlign: "left",
              border: `2px solid ${on ? "var(--accent)" : "var(--line)"}`, background: on ? "color-mix(in srgb, var(--accent) 9%, var(--surface))" : "var(--surface)", color: "var(--text)" }}>
            <span style={{ width: isMobile ? 26 : 30, height: isMobile ? 26 : 30, borderRadius: 30, display: "grid", placeItems: "center", flexShrink: 0, fontWeight: 900, fontSize: 13,
              background: ok ? "var(--green)" : on ? "var(--accent)" : "var(--surface2)", color: ok ? "#04231a" : on ? "#fff" : "var(--muted)" }}>{ok ? <Icon n="check" s={14} w={3} /> : i + 1}</span>
            <span style={{ minWidth: 0 }}>
              <b style={{ display: "block", fontSize: isMobile ? 10.5 : 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.t}</b>
              {!isMobile && <span style={{ display: "block", fontSize: 11.5, color: ok ? "var(--green)" : "var(--muted)", fontWeight: 700 }}>{i === 3 ? (PLANTILLAS_WEB.find(x => x.k === diseno.plantilla) || PLANTILLAS_WEB[0]).t : i === 4 ? "Opcional" : ok ? "Hecho" : i === 5 ? (listo ? "Listo" : "Pendiente") : "Pendiente"}</span>}
            </span>
          </button>); })}
      </nav>

      <div style={{ display: "grid", gridTemplateColumns: lateral ? "minmax(0,1fr) 330px" : "1fr", gap: 18, alignItems: "start" }}>
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 900, color: "var(--accent)", textTransform: "uppercase", letterSpacing: 1.4 }}>Paso {paso + 1} de 6</div>
            <div style={{ fontSize: isMobile ? 22 : 26, fontWeight: 900, letterSpacing: "-.01em" }}>{PASOS[paso].t}</div>
            <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 2 }}>{PASOS[paso].sub}</div>
          </div>
          {contenido[paso]}
          {/* Atrás / Siguiente */}
          <div style={{ position: "sticky", bottom: isMobile ? -12 : -22, zIndex: 5, display: "flex", gap: 8, padding: "12px 0", paddingBottom: isMobile ? "calc(12px + env(safe-area-inset-bottom))" : 12, background: "linear-gradient(180deg, transparent, var(--bg) 35%)" }}>
            {paso > 0 && <button onClick={() => setPaso(paso - 1)} style={{ ...C.btnGhost, minHeight: 50, flex: "0 0 auto" }}><Icon n="right" s={16} style={{ transform: "rotate(180deg)" }} />Atrás</button>}
            {paso < 5 && <button onClick={() => setPaso(paso + 1)} style={{ ...C.btnPrimary, minHeight: 50, flex: 1, fontSize: 15.5 }}>Siguiente: {PASOS[paso + 1].t}<Icon n="right" s={16} /></button>}
          </div>
        </div>
        {lateral && <aside style={{ position: "sticky", top: 0 }}>
          <div style={{ ...C.label, textAlign: "center" }}>Así lo verá el comprador</div>
          <div style={{ display: "flex", justifyContent: "center" }}>{previa}</div>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 10 }}><button onClick={() => setVerPrevia(true)} style={C.btnSm}><Icon n="eye" s={14} />Ver en grande</button><a href={url} target="_blank" rel="noopener noreferrer" style={{ ...C.btnSm, textDecoration: "none" }}><Icon n="link" s={14} />Página real</a></div>
        </aside>}
      </div>
    </>)}
    {verPrevia && <PreviaGrande ev={evPrevia} url={url} isMobile={isMobile} onClose={() => setVerPrevia(false)} />}
  </>);
}
const sufijo = { position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontWeight: 800, pointerEvents: "none", fontSize: 13.5 };
const ayuda = { fontSize: 12, color: "var(--muted)", marginTop: 4 };

function Compartir({ url, wa, copiar, borrador, onDuplicar }) {
  return (<>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8 }}>
      <button onClick={copiar} style={{ ...C.btnGhost, minHeight: 48 }}><Icon n="copy" s={16} />Copiar enlace</button>
      <a href={wa} target="_blank" rel="noopener noreferrer" style={{ ...C.btnGhost, minHeight: 48, textDecoration: "none", color: "#25d366", boxSizing: "border-box" }}><Icon n="whatsapp" s={16} />WhatsApp</a>
      <a href={url} target="_blank" rel="noopener noreferrer" style={{ ...C.btnGhost, minHeight: 48, textDecoration: "none", boxSizing: "border-box" }}><Icon n="eye" s={16} />{borrador ? "Vista previa" : "Abrir página"}</a>
      <button onClick={onDuplicar} style={{ ...C.btnGhost, minHeight: 48 }}><Icon n="copy" s={16} />Duplicar evento</button>
    </div>
    {borrador && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>En borrador solo tú puedes ver la página (con la sesión abierta). Las compras que hagas son de prueba.</div>}
  </>);
}

/* ===================== Vista previa: la página de verdad, en pequeño ===================== */
function MovilReal({ ev, ancho = 270, alto = 560 }) {
  return (
    <div style={{ width: ancho + 20, height: alto + 20, borderRadius: 40, padding: 10, background: "#111", boxShadow: "0 18px 50px rgba(0,0,0,.35), inset 0 0 0 2px #2a2a2a", flexShrink: 0 }}>
      <div aria-label="Vista previa de la página de venta" style={{ width: ancho, height: alto, borderRadius: 30, overflow: "auto", overscrollBehavior: "contain", scrollbarWidth: "none", background: "#000" }}>
        <div style={{ width: 390, zoom: ancho / 390, pointerEvents: "none", minHeight: alto * 390 / ancho }}><Landing ev={ev} previa /></div>
      </div>
    </div>
  );
}
function PreviaGrande({ ev, url, isMobile, onClose }) {
  const [modo, setModo] = useState(isMobile ? "movil" : "ordenador");
  const ancho = useAncho();
  const anchoPc = Math.min(1280, ancho - 48), zoomPc = anchoPc / 1280;
  return (
    <div role="dialog" aria-label="Vista previa" style={{ position: "fixed", inset: 0, zIndex: 95, background: "rgba(8,9,13,.92)", backdropFilter: "blur(6px)", display: "flex", flexDirection: "column", alignItems: "center", padding: "14px 12px calc(14px + env(safe-area-inset-bottom))", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
        {!isMobile && <Seg valor={modo} onChange={setModo} opciones={[{ k: "movil", t: "Móvil", i: "phone" }, { k: "ordenador", t: "Ordenador", i: "pos" }]} />}
        <a href={url} target="_blank" rel="noopener noreferrer" style={{ ...C.btnSm, textDecoration: "none" }}><Icon n="link" s={14} />Abrir la página real</a>
        <button onClick={onClose} style={{ ...C.btnSm, background: "#fff", color: "#111" }}><Icon n="x" s={14} />Cerrar</button>
      </div>
      {modo === "movil"
        ? <MovilReal ev={ev} ancho={Math.min(390, ancho - 44)} alto={Math.min(780, window.innerHeight - 110)} />
        : <div style={{ width: anchoPc, flex: 1, minHeight: 0, borderRadius: 14, overflow: "auto", background: "#000", boxShadow: "0 18px 50px rgba(0,0,0,.5)" }}>
            <div style={{ width: 1280, zoom: zoomPc, pointerEvents: "none" }}><Landing ev={ev} previa /></div>
          </div>}
    </div>
  );
}
// Dibujo de cada plantilla (para elegir de un vistazo)
function Esquema({ k, color, oscuro }) {
  const bg = oscuro ? "#0f1117" : "#f3f4f6", blk = oscuro ? "rgba(255,255,255,.16)" : "rgba(0,0,0,.12)", foto = `linear-gradient(135deg, ${color}, #3b1d5e)`;
  const b = (st) => <span style={{ position: "absolute", borderRadius: 3, ...st }} />;
  return (
    <span style={{ position: "relative", display: "block", height: 92, borderRadius: 10, overflow: "hidden", background: bg, border: "1px solid var(--line)" }}>
      {k === "clasica" && <>{b({ left: 8, top: 10, width: "38%", bottom: 10, background: foto, borderRadius: 6 })}{b({ left: "50%", top: 12, width: "40%", height: 9, background: blk })}{b({ left: "50%", top: 27, width: "28%", height: 5, background: blk })}{[0, 1, 2].map(i => b({ key: i, left: "50%", top: 40 + i * 13, width: "42%", height: 9, background: blk }))}</>}
      {k === "inmersiva" && <>{b({ inset: 0, background: foto, borderRadius: 0 })}{b({ inset: 0, background: "linear-gradient(180deg,transparent 30%,rgba(0,0,0,.75))", borderRadius: 0 })}{b({ left: 10, bottom: 30, width: "62%", height: 12, background: "rgba(255,255,255,.9)" })}{b({ left: 10, bottom: 12, width: "34%", height: 10, background: color, borderRadius: 5 })}</>}
      {k === "festival" && <>{b({ left: 6, right: 6, top: 6, height: 38, background: foto, borderRadius: 6 })}{b({ left: 0, right: 0, top: 50, height: 16, background: color, borderRadius: 0 })}{b({ left: 8, top: 54, width: "50%", height: 8, background: "rgba(255,255,255,.9)" })}{b({ left: 8, top: 72, width: "42%", height: 12, background: blk })}{b({ right: 8, top: 72, width: "40%", height: 12, background: blk })}</>}
      {k === "minimal" && <>{b({ left: "30%", right: "30%", top: 8, height: 7, background: blk })}{b({ left: "34%", right: "34%", top: 20, height: 40, background: foto, borderRadius: 6 })}{b({ left: "26%", right: "26%", top: 66, height: 8, background: blk })}{b({ left: "26%", right: "26%", top: 78, height: 8, background: color })}</>}
    </span>
  );
}
function GaleriaEditor({ fotos, isMobile, onOrden, onSubir }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [encima, setEncima] = useState(false);
  const subir = async (files) => { if (!files?.length) return; setBusy(true); try { await onSubir(files); } finally { setBusy(false); } };
  const mover = (i, dir) => { const j = i + dir; if (j < 0 || j >= fotos.length) return; const a = [...fotos]; [a[i], a[j]] = [a[j], a[i]]; onOrden(a); };
  return (
    <div onDragOver={e => { e.preventDefault(); setEncima(true); }} onDragLeave={() => setEncima(false)} onDrop={e => { e.preventDefault(); setEncima(false); subir(e.dataTransfer.files); }}>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,minmax(0,1fr))" : "repeat(4,minmax(0,1fr))", gap: 10 }}>
        {fotos.map((u, i) => (
          <div key={u + i} style={{ position: "relative", aspectRatio: "4/3", borderRadius: 12, overflow: "hidden", background: "var(--surface2)", border: "1px solid var(--line)" }}>
            <img src={u} alt={`Foto ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            {i === 0 && <span style={{ position: "absolute", top: 6, left: 6, background: "rgba(0,0,0,.6)", color: "#fff", fontSize: 11, fontWeight: 800, borderRadius: 6, padding: "2px 7px" }}>Portada</span>}
            <span style={{ position: "absolute", left: 6, right: 6, bottom: 6, display: "flex", gap: 4, justifyContent: "space-between" }}>
              <span style={{ display: "flex", gap: 4 }}>
                <button onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Mover a la izquierda" style={{ ...fotoBtn, opacity: i === 0 ? .4 : 1 }}><Icon n="right" s={14} style={{ transform: "rotate(180deg)" }} /></button>
                <button onClick={() => mover(i, 1)} disabled={i === fotos.length - 1} aria-label="Mover a la derecha" style={{ ...fotoBtn, opacity: i === fotos.length - 1 ? .4 : 1 }}><Icon n="right" s={14} /></button>
              </span>
              <button onClick={() => onOrden(fotos.filter((_, k) => k !== i))} aria-label={`Quitar foto ${i + 1}`} style={fotoBtn}><Icon n="trash" s={14} /></button>
            </span>
          </div>))}
        {fotos.length < 12 && (
          <button onClick={() => !busy && ref.current?.click()} style={{ aspectRatio: "4/3", borderRadius: 12, border: `2px dashed ${encima ? "var(--accent)" : "var(--line)"}`, background: encima ? "color-mix(in srgb, var(--accent) 8%, var(--surface2))" : "var(--surface2)", color: "var(--muted)", cursor: busy ? "wait" : "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, fontWeight: 800, fontSize: 13 }}>
            <span style={{ width: 40, height: 40, borderRadius: 12, background: "color-mix(in srgb, var(--accent) 14%, transparent)", color: "var(--accent)", display: "grid", placeItems: "center" }}><Icon n={busy ? "refresh" : "plus"} s={20} w={2.4} /></span>
            {busy ? "Subiendo…" : "Añadir fotos"}
          </button>)}
      </div>
      <input ref={ref} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => { const fl = e.target.files; subir(fl ? [...fl] : []); e.target.value = ""; }} />
      <div style={ayuda}>{isMobile ? "Puedes elegir varias a la vez." : "Puedes elegir o arrastrar varias a la vez."} La primera es la portada en las plantillas Inmersiva y Festival.</div>
    </div>
  );
}
const fotoBtn = { width: 30, height: 30, borderRadius: 8, border: "none", background: "rgba(0,0,0,.6)", color: "#fff", display: "grid", placeItems: "center", cursor: "pointer", padding: 0 };

/* ===================== Piezas ===================== */
function SelectorOrg({ valor, onChange }) {
  const [orgs, setOrgs] = useState(null);
  useEffect(() => { crm.orgListar().then(setOrgs).catch(() => setOrgs([])); }, []);
  if (orgs === null) return <div style={{ color: "var(--muted)" }}>Cargando…</div>;
  if (!orgs.length) return <div style={{ fontSize: 13.5, color: "var(--muted)" }}>Aún no tienes organizaciones. Créala en la pestaña <b>Organizaciones</b> (arriba) y luego elígela aquí.</div>;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button onClick={() => onChange("")} aria-pressed={!valor} style={{ ...C.seg, borderColor: !valor ? "var(--accent)" : "var(--line)", color: !valor ? "var(--accent)" : "var(--text)" }}>Ninguna</button>
      {orgs.map(o => <button key={o.id} onClick={() => onChange(o.id)} aria-pressed={valor === o.id} style={{ ...C.seg, borderColor: valor === o.id ? "var(--accent)" : "var(--line)", color: valor === o.id ? "var(--accent)" : "var(--text)", display: "inline-flex", alignItems: "center", gap: 8 }}>
        {o.logo_url && <img src={o.logo_url} alt="" style={{ height: 18, maxWidth: 50, objectFit: "contain" }} />}{valor === o.id && <Icon n="check" s={14} w={3} />}{o.nombre}</button>)}
    </div>
  );
}
const Sw = ({ on, onClick, l, sub, primero }) => (
  <label style={{ ...C.toggleRow, padding: "11px 0", borderTop: primero ? "none" : "1px solid var(--line)", cursor: "pointer" }}>
    <span><span style={{ display: "block" }}>{l}</span>{sub && <span style={{ display: "block", fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>{sub}</span>}</span>
    <button type="button" role="switch" aria-checked={on} onClick={onClick} style={{ ...C.switch, background: on ? "var(--green)" : "var(--line)" }}><span style={{ ...C.knob, transform: on ? "translateX(22px)" : "translateX(2px)" }} /></button>
  </label>
);

function Subida({ t, url, img, grande, accept, onFile, onQuitar, alto }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [encima, setEncima] = useState(false);
  const tomar = async (fl) => { if (!fl) return; setBusy(true); try { await onFile(fl); } finally { setBusy(false); } };
  return (
    <div>
      <button type="button" onClick={() => !busy && ref.current?.click()} aria-label={url ? `Cambiar ${t}` : `Subir ${t}`}
        onDragOver={e => { e.preventDefault(); setEncima(true); }} onDragLeave={() => setEncima(false)} onDrop={e => { e.preventDefault(); setEncima(false); tomar(e.dataTransfer.files?.[0]); }}
        style={{ width: "100%", height: alto, borderRadius: 16, border: `2px dashed ${encima ? "var(--accent)" : url ? "transparent" : "var(--line)"}`, background: encima ? "color-mix(in srgb, var(--accent) 8%, var(--surface2))" : "var(--surface2)", cursor: busy ? "wait" : "pointer", overflow: "hidden", padding: 0, display: "grid", placeItems: "center", color: "var(--muted)", position: "relative" }}>
        {url && img ? <img src={url} alt={t} style={{ width: "100%", height: "100%", objectFit: "contain", background: "var(--bg)" }} />
          : url ? <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, color: "var(--green)", fontWeight: 800 }}><Icon n="file" s={30} />PDF subido</span>
          : <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 14, padding: 12, textAlign: "center" }}>
              <span style={{ width: grande ? 64 : 46, height: grande ? 64 : 46, borderRadius: 18, background: "color-mix(in srgb, var(--accent) 14%, transparent)", color: "var(--accent)", display: "grid", placeItems: "center" }}><Icon n="upload" s={grande ? 28 : 20} /></span>
              <span style={{ color: "var(--text)" }}>{grande ? "Toca para subir el flyer" : "Subir"}</span>
              {grande && <span style={{ fontWeight: 600, fontSize: 12.5 }}>o arrástralo aquí desde el ordenador</span>}
            </span>}
        {busy && <span style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.55)", color: "#fff", display: "grid", placeItems: "center", fontWeight: 900 }}>Subiendo…</span>}
      </button>
      <input ref={ref} type="file" accept={accept} style={{ display: "none" }} onChange={e => { const fl = e.target.files?.[0]; e.target.value = ""; tomar(fl); }} />
      {url && <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => ref.current?.click()} style={C.btnSm}><Icon n="upload" s={14} />Cambiar</button>
        {!img && <a href={url} target="_blank" rel="noopener noreferrer" style={{ ...C.btnSm, textDecoration: "none" }}><Icon n="eye" s={14} />Ver</a>}
        <button type="button" onClick={onQuitar} style={C.btnSm}><Icon n="trash" s={14} />Quitar</button>
      </div>}
      {!url && <div style={{ height: 12 }} />}
    </div>
  );
}

function EnlaceEditable({ ev, f, setD, flash }) {
  const [v, setV] = useState(f.slug);
  const [busy, setBusy] = useState(false);
  const cambio = v !== f.slug;
  return (
    <Field l="Enlace de la página" mb={0}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ color: "var(--muted)", fontSize: 13 }}>{window.location.host}/e/</span>
        <input style={{ ...C.input, flex: "1 1 180px", width: "auto" }} value={v} onChange={e => setV(crm.slugDe(e.target.value).slice(0, 60))} aria-label="Enlace del evento" />
        {cambio && <button disabled={busy || v.length < 3} onClick={async () => { setBusy(true); try { await crm.webCambiarSlug(ev.id, v); setD(x => ({ ...x, ficha: { ...x.ficha, slug: v } })); flash("Enlace cambiado"); } catch (e) { flash(e.message, "warn"); } finally { setBusy(false); } }} style={C.btnPrimary}>Guardar enlace</button>}
      </div>
      <div style={ayuda}>Si ya lo has compartido, el enlace antiguo dejará de funcionar. Es provisional hasta que tengáis vuestro dominio.</div>
    </Field>
  );
}

/* ===================== Tramos ===================== */
const PLANTILLAS = [
  { t: "Entrada gratis", sub: "Una lista con plazas limitadas", i: "ticket", tramos: [{ nombre: "Entrada gratuita", precio: 0, cantidad: 200 }] },
  { t: "Anticipada + taquilla", sub: "Más barata si compras antes", i: "trend", tramos: [{ nombre: "Anticipada", precio: 10, cantidad: 200 }, { nombre: "Taquilla", precio: 15, cantidad: null }] },
  { t: "3 tandas que suben", sub: "Cuando se agota una, sube el precio", i: "bolt", tramos: [{ nombre: "1ª tanda", precio: 8, cantidad: 100 }, { nombre: "2ª tanda", precio: 10, cantidad: 150 }, { nombre: "3ª tanda", precio: 12, cantidad: 200 }] },
];
function Tramos({ ev, d, setD, ficha, setFicha, flash, isMobile, inicio }) {
  const tramos = d.tramos;
  const timers = useRef({});
  const [borrarId, setBorrarId] = useState(null);
  const [abiertoId, setAbiertoId] = useState(null);       // «más ajustes» del tramo
  const guardar = (t) => {
    clearTimeout(timers.current[t.id]);
    timers.current[t.id] = setTimeout(() => crm.webGuardarTramo(t).catch(() => flash("No se ha podido guardar el tramo", "warn")), 600);
  };
  const set = (id, patch) => setD(x => { const ts = x.tramos.map(t => t.id === id ? { ...t, ...patch } : t); guardar(ts.find(t => t.id === id)); return { ...x, tramos: ts }; });
  const crear = async (base) => {
    const orden = d.tramos.reduce((m, t) => Math.max(m, t.orden + 1), 0);
    const t = { evento_id: ev.id, nombre: "Anticipada", precio: 0, cantidad: 100, orden, max_por_compra: 10, visible: true, copas: 0, vendidas: 0, ...base };
    const id = await crm.webGuardarTramo(t);
    setD(x => ({ ...x, tramos: [...x.tramos, { ...t, id }] }));
    return id;
  };
  const anadir = async () => { try { const id = await crear({ nombre: tramos.length ? `Tramo ${tramos.length + 1}` : "Anticipada" }); setAbiertoId(null); setTimeout(() => document.getElementById("tramo-" + id)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60); } catch { flash("No se ha podido añadir", "warn"); } };
  const plantilla = async (p) => {
    try { let o = 0; for (const x of p.tramos) { await crear({ ...x, orden: o++ }); } if (p.tramos.length > 1 && !ficha.secuencial) setFicha({ secuencial: true }); flash(`Añadido: ${p.t}. Ajusta precios y cantidades.`); }
    catch { flash("No se ha podido añadir", "warn"); }
  };
  const borrar = async (t) => {
    if (t.vendidas > 0) { flash("Tiene entradas vendidas: ocúltalo en vez de borrarlo", "warn"); setBorrarId(null); return; }
    try { await crm.webBorrarTramo(t.id); setD(x => ({ ...x, tramos: x.tramos.filter(y => y.id !== t.id) })); setBorrarId(null); } catch { flash("No se ha podido borrar", "warn"); }
  };
  const mover = (i, dir) => {
    const j = i + dir; if (j < 0 || j >= tramos.length) return;
    const ts = [...tramos]; [ts[i], ts[j]] = [ts[j], ts[i]];
    const conOrden = ts.map((t, k) => ({ ...t, orden: k }));
    setD(x => ({ ...x, tramos: conOrden })); conOrden.forEach(guardar);
  };
  const total = tramos.reduce((s, t) => s + (t.vendidas || 0), 0), aforo = tramos.every(t => t.cantidad != null) ? tramos.reduce((s, t) => s + t.cantidad, 0) : null;
  const bt = { ...C.btnSm, width: isMobile ? 40 : 34, height: isMobile ? 40 : 34, padding: 0, justifyContent: "center" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {tramos.length === 0 ? (
        <section style={{ ...C.panel, padding: isMobile ? 14 : 18 }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>Empieza con una plantilla</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2, marginBottom: 12 }}>Un toque y luego cambias nombres, precios y cantidades.</div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3,minmax(0,1fr))", gap: 10 }}>
            {PLANTILLAS.map(p => (
              <button key={p.t} onClick={() => plantilla(p)} style={{ ...C.card, textAlign: "left", cursor: "pointer", color: "var(--text)", display: "flex", flexDirection: "column", gap: 8, border: "2px solid var(--line)" }}>
                <Tile n={p.i} s={36} />
                <b style={{ fontSize: 15 }}>{p.t}</b>
                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{p.sub}</span>
                <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{p.tramos.map(x => <span key={x.nombre} style={{ ...C.tag, fontSize: 11.5, padding: "2px 8px" }}>{x.nombre} · {x.precio ? money(x.precio) : "0 €"}</span>)}</span>
              </button>))}
          </div>
          <button onClick={anadir} style={{ ...C.btnGhost, marginTop: 12, width: isMobile ? "100%" : "auto" }}><Icon n="plus" s={16} w={2.4} />Empezar de cero</button>
        </section>
      ) : (
        <section style={{ ...C.panel, padding: isMobile ? 12 : 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 16 }}>{tramos.length} tramo{tramos.length > 1 ? "s" : ""}</b><span style={{ fontSize: 13, color: "var(--muted)", marginLeft: 8 }}>{total} vendidas{aforo != null ? ` de ${aforo}` : ""}</span></div>
            <button onClick={anadir} style={{ ...C.btnPrimary, minHeight: 42 }}><Icon n="plus" s={16} w={2.4} />Añadir tramo</button>
          </div>
          <Sw on={ficha.secuencial} onClick={() => setFicha({ secuencial: !ficha.secuencial })} l="Tramos en orden" sub="El siguiente se abre solo cuando el anterior se agota o termina." />
        </section>
      )}
      {tramos.map((t, i) => {
        const pct = t.cantidad ? Math.min(100, Math.round(t.vendidas / t.cantidad * 100)) : null;
        const mas = abiertoId === t.id;
        return (
          <section id={"tramo-" + t.id} key={t.id} style={{ ...C.panel, padding: isMobile ? 12 : 16, opacity: t.visible ? 1 : .65, borderLeft: `4px solid ${t.visible ? "var(--accent)" : "var(--line)"}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", fontWeight: 900, background: "color-mix(in srgb, var(--accent) 14%, var(--surface2))", color: "var(--accent)", flexShrink: 0 }}>{i + 1}</span>
              <input value={t.nombre} maxLength={60} onChange={e => set(t.id, { nombre: e.target.value })} aria-label="Nombre del tramo" style={{ ...C.input, flex: 1, minWidth: 0, fontWeight: 900, fontSize: 16 }} />
              {!t.visible && <Badge>Oculto</Badge>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3,minmax(0,1fr))", gap: 10 }}>
              <Mini l="Precio" suf="€"><input inputMode="decimal" value={t.precio} onChange={e => set(t.id, { precio: aNum(limpioNum(e.target.value, true)) ?? 0 })} style={{ ...inp, fontSize: 18 }} /></Mini>
              <Mini l="Cantidad" sub="Vacío = sin límite"><input inputMode="numeric" value={t.cantidad ?? ""} placeholder="∞" onChange={e => { const v = limpioNum(e.target.value); set(t.id, { cantidad: v === "" ? null : Math.max(+v, t.vendidas) }); }} style={{ ...inp, fontSize: 18 }} /></Mini>
              <div style={{ gridColumn: isMobile ? "1 / -1" : "auto" }}><Mini l="Descripción corta"><input value={t.descripcion || ""} maxLength={200} placeholder="Ej. Incluye una copa" onChange={e => set(t.id, { descripcion: e.target.value })} style={inp} /></Mini></div>
            </div>
            {mas && <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--line)" }}>
              <MiniD l="Empieza a venderse"><FechaHora valor={aLocal(t.venta_inicio)} onChange={(v) => set(t.id, { venta_inicio: aIso(v) })} titulo={`${t.nombre}: empieza a venderse`} placeholder="Ya (al publicar)" /></MiniD>
              <MiniD l="Deja de venderse"><FechaHora valor={aLocal(t.venta_fin)} onChange={(v) => set(t.id, { venta_fin: aIso(v) })} titulo={`${t.nombre}: deja de venderse`} placeholder="Al agotarse" base={inicio} sugerencias={inicio && inicio.length > 10 ? [{ t: "Al empezar el evento", v: inicio }] : []} /></MiniD>
              <Mini l="Máx. por compra"><input inputMode="numeric" value={t.max_por_compra} onChange={e => set(t.id, { max_por_compra: Math.max(1, Math.min(50, +limpioNum(e.target.value) || 1)) })} style={inp} /></Mini>
              <Mini l="Copas incluidas" sub="Se canjean en la barra con el QR"><input inputMode="numeric" value={t.copas} onChange={e => set(t.id, { copas: Math.min(20, +limpioNum(e.target.value) || 0) })} style={inp} /></Mini>
            </div>}
            {!mas && (t.venta_inicio || t.venta_fin || t.copas > 0 || t.max_por_compra !== 10) && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              {t.venta_inicio && <span style={C.tag}>Desde {fechaTxt(aLocal(t.venta_inicio))}</span>}
              {t.venta_fin && <span style={C.tag}>Hasta {fechaTxt(aLocal(t.venta_fin))}</span>}
              {t.copas > 0 && <span style={C.tag}>{t.copas} copa{t.copas > 1 ? "s" : ""}</span>}
              {t.max_por_compra !== 10 && <span style={C.tag}>Máx. {t.max_por_compra} por compra</span>}
            </div>}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button onClick={() => setAbiertoId(mas ? null : t.id)} style={{ ...C.btnSm, minHeight: isMobile ? 40 : 34 }}><Icon n="clock" s={14} />{mas ? "Menos ajustes" : "Fechas, copas y límites"}</button>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--muted)" }}>{t.vendidas} vendidas</span>
              {pct != null && <span style={{ flex: "1 1 60px", height: 8, borderRadius: 6, background: "var(--surface2)", overflow: "hidden", minWidth: 40 }}><span style={{ display: "block", width: `${pct}%`, height: "100%", background: pct >= 100 ? "var(--red)" : "linear-gradient(90deg,#ff5a3c,#ff8a3c)" }} /></span>}
              <span style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                <button onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Subir tramo" style={{ ...bt, opacity: i === 0 ? .35 : 1 }}><Icon n="up" s={15} /></button>
                <button onClick={() => mover(i, 1)} disabled={i === tramos.length - 1} aria-label="Bajar tramo" style={{ ...bt, opacity: i === tramos.length - 1 ? .35 : 1 }}><Icon n="chev" s={15} /></button>
                <button onClick={() => set(t.id, { visible: !t.visible })} aria-label={t.visible ? "Ocultar tramo" : "Mostrar tramo"} title={t.visible ? "Ocultar" : "Mostrar"} style={bt}><Icon n={t.visible ? "eyeOff" : "eye"} s={15} /></button>
                {borrarId === t.id
                  ? <><button onClick={() => borrar(t)} style={{ ...C.btnSm, minHeight: isMobile ? 40 : 34, borderColor: "var(--red)", color: "var(--red)" }}>Borrar</button><button onClick={() => setBorrarId(null)} style={{ ...C.btnSm, minHeight: isMobile ? 40 : 34 }}>No</button></>
                  : <button onClick={() => setBorrarId(t.id)} aria-label="Borrar tramo" style={bt}><Icon n="trash" s={15} /></button>}
              </span>
            </div>
          </section>);
      })}
    </div>
  );
}
const inp = { ...C.input, padding: "10px 11px", fontWeight: 800 };
const MiniD = ({ l, children }) => <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}><span style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)" }}>{l}</span>{children}</div>;
const Mini = ({ l, sub, suf, children }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
    <span style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)" }}>{l}</span>
    <span style={{ position: "relative", display: "block" }}>{children}{suf && <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontWeight: 800, pointerEvents: "none" }}>{suf}</span>}</span>
    {sub && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{sub}</span>}
  </label>
);

/* ===================== Ventas: pedidos y asistentes ===================== */
function Ventas({ ev, flash, isMobile }) {
  const [v, setV] = useState(null);
  const [q, setQ] = useState("");
  const [verPruebas, setVerPruebas] = useState(true);
  const cargar = () => crm.webVentas(ev.id).then(setV).catch(() => setV({ pedidos: [], entradas: [], error: true }));
  useEffect(() => { cargar(); }, [ev.id]);
  const pedidoDe = useMemo(() => Object.fromEntries((v?.pedidos || []).map(p => [p.id, p])), [v]);
  const lista = (v?.entradas || []).filter(e => verPruebas || !e.prueba).filter(e => { if (!q.trim()) return true; const p = pedidoDe[e.pedido_id] || {}; const s = `${e.asistente} ${e.dni || ""} ${p.email || ""} ${p.codigo || ""} ${e.numero}`.toLowerCase(); return s.includes(q.trim().toLowerCase()); });
  const validas = (v?.entradas || []).filter(e => e.estado === "valida");
  const canjeDe = useMemo(() => { const m = {}; (v?.canjes || []).forEach(c => { if (!m[c.venta_uuid] || c.canjeado_en > m[c.venta_uuid].canjeado_en) m[c.venta_uuid] = c; }); return m; }, [v]);
  const dentro = validas.filter(e => canjeDe[e.id]).length;
  const [titular, setTitular] = useState(null);   // entrada a reemitir / cambiar titular
  const MOTIVO = { ya_canjeado: "Copia (ya había entrado)", anulado: "Entrada anulada", reemitida: "QR sustituido", temprano: "Antes de la hora", caducado: "Evento terminado", falso: "QR falso", otro_evento: "De otro evento", no_encontrado: "No encontrada", ilegible: "No es de TIXFAST" };
  const csv = () => {
    const cel = (x) => { let s = String(x ?? "").replace(/[;\r\n]+/g, " "); if (/^[=+\-@\t]/.test(s)) s = "'" + s; return s; };
    const filas = [["Nº", "Asistente", "DNI asistente", "Tramo", "Precio", "Estado", "Prueba", "Pedido", "Comprador", "Correo", "Fecha"], ...lista.map(e => { const p = pedidoDe[e.pedido_id] || {}; return [e.numero, e.asistente, e.dni || "", e.tramo_nombre, e.precio, e.estado, e.prueba ? "sí" : "no", p.codigo, p.nombre, p.email, new Date(e.creado_en).toLocaleString("es-ES")]; })];
    const blob = new Blob(["﻿" + filas.map(f => f.map(cel).join(";")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${crm.slugDe(ev.name)}-asistentes.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const anular = async (e) => { try { await crm.webAnularEntrada(e.id, e.estado === "valida"); flash(e.estado === "valida" ? `Entrada nº ${e.numero} anulada: su QR ya no vale` : `Entrada nº ${e.numero} recuperada`); cargar(); } catch (er) { flash(er.message || "No se ha podido cambiar", "warn"); } };
  return (
    <Seccion id="ent-ventas" i="users" t="Ventas y asistentes" sub="Cada entrada es nominativa. Busca por nombre, DNI, correo o código de pedido."
      total={`${validas.length} entradas`} acciones={<span style={{ display: "flex", gap: 6 }}><button onClick={cargar} style={C.btnSm}><Icon n="refresh" s={14} />Actualizar</button><button onClick={csv} disabled={!lista.length} style={C.btnSm}><Icon n="file" s={14} />CSV</button></span>}>
      {!v ? <div style={{ color: "var(--muted)" }}>Cargando…</div> : (<>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <span style={C.tag}>{(v.pedidos || []).length} pedidos</span>
          <span style={C.tag}>{validas.length} entradas válidas</span>
          {validas.some(e => e.prueba) && <span style={{ ...C.tag, color: "var(--amber)" }}>{validas.filter(e => e.prueba).length} de prueba</span>}
          <span style={{ ...C.tag, color: "var(--green)" }}><Icon n="check" s={13} w={2.4} />{dentro} dentro</span>
          <span style={C.tag}>{validas.length - dentro} por entrar</span>
          {(v.rechazos || []).length > 0 && <span style={{ ...C.tag, color: "var(--red)" }}>{v.rechazos.length} intentos rechazados</span>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar…" aria-label="Buscar asistente" style={{ ...C.input, flex: "1 1 220px", width: "auto" }} />
          <button onClick={() => setVerPruebas(x => !x)} style={C.btnSm}>{verPruebas ? "Ocultar pruebas" : "Ver pruebas"}</button>
        </div>
        {lista.length === 0 && <div style={C.empty}>{(v.entradas || []).length ? "Nada con esta búsqueda." : "Aún no hay entradas vendidas."}</div>}
        {lista.slice(0, 300).map(e => { const p = pedidoDe[e.pedido_id] || {}; return (
          <div key={e.id} style={{ ...C.row, alignItems: "flex-start", opacity: e.estado === "anulada" ? .55 : 1 }}>
            <span style={{ minWidth: 0, flex: 1 }}>
              <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: e.estado === "anulada" ? "line-through" : "none" }}>nº {e.numero} · {e.asistente}</b>
              <span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{e.tramo_nombre} · {p.email} · pedido {p.codigo}{e.dni ? ` · DNI ${e.dni}` : ""}</span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {e.prueba && <Badge c="var(--amber)">Prueba</Badge>}
              {e.estado === "anulada" && <Badge c="var(--red)">Anulada</Badge>}
              {canjeDe[e.id] && <Badge c="var(--green)"><Icon n="check" s={11} w={2.6} />Dentro {new Date(canjeDe[e.id].canjeado_en).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</Badge>}
              {e.estado === "valida" && <button onClick={() => setTitular({ e, nombre: e.asistente })} style={C.btnSm}>Titular / reemitir</button>}
              <b>{money(e.precio)}</b>
              <button onClick={() => anular(e)} style={C.btnSm}>{e.estado === "valida" ? "Anular" : "Recuperar"}</button>
            </span>
          </div>); })}
        {(v.rechazos || []).length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Intentos rechazados en la puerta</div>
            {v.rechazos.slice(0, 30).map((x, i) => (
              <div key={i} style={{ ...C.row, fontSize: 13 }}>
                <span style={{ minWidth: 0 }}><b style={{ color: "var(--red)" }}>{MOTIVO[x.motivo] || x.motivo}</b>{x.detalle?.asistente ? ` · ${x.detalle.asistente}` : ""}{x.detalle?.numero ? ` · nº ${x.detalle.numero}` : ""}</span>
                <span style={{ color: "var(--muted)", flexShrink: 0 }}>{new Date(x.creado_en).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}{x.dispositivo ? ` · ${x.dispositivo}` : ""}</span>
              </div>))}
          </div>)}
        {titular && <Sheet title={`Entrada nº ${titular.e.numero}`} onClose={() => setTitular(null)}
          footer={<button disabled={titular.busy} onClick={async () => { setTitular(t => ({ ...t, busy: true })); try { await crm.webReemitir(titular.e.id, titular.nombre); flash("Entrada reemitida: el QR anterior ya no vale"); setTitular(null); cargar(); } catch (er) { flash(er.message || "No se ha podido", "warn"); setTitular(t => ({ ...t, busy: false })); } }} style={{ ...C.btnPrimary, width: "100%" }}><Icon n="refresh" s={16} />Reemitir con este titular</button>}>
          <div style={{ fontSize: 13.5, color: "var(--muted)", marginBottom: 12, lineHeight: 1.45 }}>Se genera un QR nuevo y <b style={{ color: "var(--text)" }}>el anterior deja de valer</b>. Úsalo si alguien ha perdido la entrada, si la ha compartido o si cambia de titular. El comprador la verá actualizada en su enlace «Mis entradas».</div>
          <Field l="Nombre del titular"><input style={C.input} value={titular.nombre} maxLength={120} onChange={e => setTitular(t => ({ ...t, nombre: e.target.value }))} /></Field>
        </Sheet>}
        {lista.length > 300 && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Se muestran 300 de {lista.length}. Usa el buscador o descarga el CSV.</div>}
      </>)}
    </Seccion>
  );
}

/* ===================== Nuevo / duplicar evento ===================== */
function NuevoEvento({ titulo = "Nuevo evento", nota, inicial = "", sinFecha, busy, onCrear, onClose }) {
  const [nombre, setNombre] = useState(inicial);
  const [inicio, setInicio] = useState("");
  const [fin, setFin] = useState("");
  const ok = nombre.trim().length >= 3;
  const finMal = !!(fin && inicio && new Date(fin) <= new Date(inicio));
  return (
    <Sheet title={titulo} onClose={onClose} footer={<button disabled={busy || !ok || finMal} onClick={() => onCrear(nombre.trim(), inicio || null, fin || null)} style={{ ...C.btnPrimary, width: "100%", minHeight: 50, fontSize: 16, opacity: ok && !finMal ? 1 : .5 }}><Icon n="check" s={17} w={2.4} />{busy ? "Creando…" : titulo === "Nuevo evento" ? "Crear y configurar la venta" : "Duplicar"}</button>}>
      {nota && <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>{nota}</div>}
      <Field l="Nombre"><input autoFocus style={{ ...C.input, fontWeight: 800, fontSize: 17 }} value={nombre} maxLength={80} onChange={e => setNombre(e.target.value)} placeholder="Ej. FIESTA DE VERANO" /></Field>
      {!sinFecha && <>
        <Field l="Empieza"><FechaHora valor={inicio} onChange={setInicio} titulo="¿Cuándo empieza?" placeholder="Elegir día y hora de inicio" /></Field>
        <Field l="Termina"><FechaHora valor={fin} onChange={setFin} titulo="¿Cuándo termina?" placeholder="Elegir día y hora de fin" base={inicio} aviso="Si acaba de madrugada, elige el día siguiente (o usa un atajo)."
          sugerencias={inicio ? [{ t: "4 h después", v: sumarHoras(inicio, 4) }, { t: "6 h después", v: sumarHoras(inicio, 6) }, { t: "8 h después", v: sumarHoras(inicio, 8) }] : []} /></Field>
        {finMal && <div style={{ fontSize: 13, color: "var(--red)", fontWeight: 700, marginTop: -8, marginBottom: 10 }}>La hora de fin es anterior al inicio.</div>}
      </>}
      <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Se crea también en el TPV con una barra, para que puedas vender en él. Lo demás (flyer, entradas…) lo pones en el siguiente paso.</div>
    </Sheet>
  );
}

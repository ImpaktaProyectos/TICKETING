// ===================== ENTRADAS · gestor de la venta online =====================
// Todos los eventos con su venta online, y la ficha completa del evento seleccionado:
// datos, imágenes, tramos, avisos, formulario de compra, diseño, validez del QR y ventas.
// Se guarda solo al escribir. La venta pública la hace el servidor (nunca desde aquí).
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as crm from "./crmdb";
import { money, useIsMobile, C, Icon, Tile, Badge, Seg, Sheet, Field, Seccion } from "./ui";

const urlVenta = (slug) => `${window.location.origin}/e/${slug}`;
const ESTADOS = { borrador: { t: "Borrador", c: "var(--muted)" }, publicado: { t: "A la venta", c: "var(--green)" }, cerrado: { t: "Cerrado", c: "var(--red)" } };
const CAMPOS = [
  { k: "telefono", t: "Teléfono" }, { k: "dni", t: "DNI del comprador" }, { k: "nacimiento", t: "Fecha de nacimiento" },
  { k: "cp", t: "Código postal" }, { k: "direccion", t: "Dirección" }, { k: "ciudad", t: "Ciudad" }, { k: "genero", t: "Género" },
  { k: "dni_asistente", t: "DNI de cada asistente" },
];
const LETRAS = [{ k: "inter", t: "Moderna" }, { k: "serif", t: "Elegante" }, { k: "mono", t: "Techno" }];
const COLORES = ["#ff5a3c", "#a855f7", "#3b82f6", "#22d3a6", "#ffb400", "#ec4899", "#f97316", "#eceef5"];
// fecha-hora local (input) <-> ISO
const aLocal = (iso) => { if (!iso) return ""; const d = new Date(iso); if (isNaN(d)) return ""; const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const aIso = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d.toISOString(); };
const fechaTxt = (v) => { if (!v) return "Sin fecha"; const d = new Date(v.length <= 10 ? v + "T12:00" : v); return isNaN(d) ? v : d.toLocaleString("es-ES", { weekday: "short", day: "2-digit", month: "short", hour: v.length > 10 ? "2-digit" : undefined, minute: v.length > 10 ? "2-digit" : undefined }); };
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

export function Entradas({ ev, events, onSelectEvent, flash }) {
  const isMobile = useIsMobile();
  const [lista, setLista] = useState(null);        // { eventoId: resumen de su venta online }
  const [d, setD] = useState(null);                // { ficha, tramos } del evento elegido
  const [cargando, setCargando] = useState(true);
  const [nuevo, setNuevo] = useState(false);
  const [dup, setDup] = useState(false);
  const [busy, setBusy] = useState(false);

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ===== Todos los eventos ===== */}
      <Seccion id="ent-lista" i="calendar" t="Tus eventos" sub="Elige uno para configurar su venta online. Cada evento tiene su propio enlace."
        total={`${events.length}`}
        acciones={<button onClick={() => setNuevo(true)} style={C.btnPrimary}><Icon n="plus" s={16} w={2.4} />Nuevo evento</button>}>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill,minmax(250px,1fr))", gap: 10 }}>
          {ordenados.map(e => { const w = lista?.[e.id]; const on = e.id === ev.id; const est = w ? ESTADOS[w.estado] : null; return (
            <button key={e.id} onClick={() => onSelectEvent(e.id)} style={{ ...C.card, textAlign: "left", cursor: "pointer", color: "var(--text)", display: "flex", gap: 12, alignItems: "center", padding: 12,
              border: `2px solid ${on ? "var(--accent)" : "var(--line)"}`, background: on ? "color-mix(in srgb, var(--accent) 7%, var(--surface))" : "var(--surface)" }}>
              <span style={{ width: 52, height: 52, borderRadius: 12, flexShrink: 0, overflow: "hidden", background: "var(--surface2)", display: "grid", placeItems: "center" }}>
                {w?.flyer_url ? <img src={w.flyer_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Icon n="ticket" s={22} c="var(--muted)" />}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</b>
                <span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{fechaTxt(e.startsAt || e.date)}</span>
                <span style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  {w ? <Badge c={est.c}>{est.t}</Badge> : <Badge>Sin venta online</Badge>}
                  {w?.modo === "pruebas" && <Badge c="var(--amber)">Pruebas</Badge>}
                  {w && <Badge c="var(--blue)">{w.vendidas}{w.aforo != null ? ` / ${w.aforo}` : ""} vendidas</Badge>}
                </span>
              </span>
            </button>); })}
        </div>
      </Seccion>

      {/* ===== El evento elegido ===== */}
      {cargando ? <div style={{ ...C.panel, color: "var(--muted)", textAlign: "center" }}>Cargando…</div>
        : d?.error ? <div style={{ ...C.panel, color: "var(--amber)", fontWeight: 700 }}>No se ha podido cargar la venta online. Revisa la conexión.</div>
        : !d?.ficha ? (
          <section style={{ ...C.hero, padding: isMobile ? 18 : 26, textAlign: "center" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}><Tile n="ticket" s={56} /></div>
            <div style={{ fontSize: isMobile ? 22 : 28, fontWeight: 900 }}>Vende entradas de «{ev.name}» online</div>
            <div style={{ color: "var(--muted)", fontSize: 14, maxWidth: 520, margin: "8px auto 16px" }}>Tendrá su propia página de venta con el flyer, los tramos, cuenta atrás y entradas nominativas con QR de un solo uso. Empieza en borrador: nadie la ve hasta que la publiques.</div>
            <button disabled={busy} onClick={activar} style={{ ...C.btnPrimary, minHeight: 50, padding: "0 26px", fontSize: 16 }}><Icon n="sparkle" s={18} />Activar venta online</button>
          </section>
        ) : <Editor key={ev.id} ev={ev} d={d} setD={setD} flash={flash} isMobile={isMobile} onDuplicar={() => setDup(true)} onCambio={refrescarLista} />}

      {nuevo && <NuevoEvento busy={busy} onClose={() => setNuevo(false)} onCrear={async (nombre, inicio) => {
        setBusy(true);
        try { const id = await crm.webNuevoEvento(nombre, inicio); setNuevo(false); flash("Evento creado"); await refrescarLista(); setTimeout(() => onSelectEvent(id), 900); }
        catch { flash("No se ha podido crear el evento", "warn"); } finally { setBusy(false); }
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

/* ===================== Ficha del evento ===================== */
function Editor({ ev, d, setD, flash, isMobile, onDuplicar, onCambio }) {
  const f = d.ficha;
  const [evLocal, setEvLocal] = useState({ nombre: ev.name || "", inicio: ev.startsAt || "", fin: aLocal(ev.endsAt), recinto: ev.venue || "" });
  const [guardarFicha, estFicha] = useAutoguardado(async (patch) => { await crm.webGuardarFicha(ev.id, patch); });
  const [guardarEv, estEv] = useAutoguardado(async (patch) => { await crm.webGuardarEvento(ev.id, patch); });
  const pend = useRef({});
  const setFicha = (patch) => { setD(x => ({ ...x, ficha: { ...x.ficha, ...patch } })); pend.current = { ...pend.current, ...patch }; const p = pend.current; guardarFicha(p); setTimeout(() => { if (pend.current === p) pend.current = {}; }, 800); };
  const pendEv = useRef({});
  const setEv = (k, v, col, conv = (x) => x) => { setEvLocal(x => ({ ...x, [k]: v })); pendEv.current = { ...pendEv.current, [col]: conv(v) }; const p = pendEv.current; guardarEv(p); setTimeout(() => { if (pendEv.current === p) pendEv.current = {}; }, 800); };
  const estado = [estFicha, estEv].includes("error") ? "error" : [estFicha, estEv].includes("guardando") ? "guardando" : (estFicha || estEv) ? "guardado" : "";
  useEffect(() => { if (estado === "guardado") onCambio && onCambio(); }, [estado]);

  const url = urlVenta(f.slug);
  const copiar = async () => { try { await navigator.clipboard.writeText(url); flash("Enlace copiado"); } catch { flash(url); } };
  const subir = async (tipo, file, campo) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { flash("Archivo demasiado grande (máx. 10 MB)", "warn"); return; }
    try { flash("Subiendo…"); const u = await crm.webSubir(ev.id, tipo, file); setFicha({ [campo]: u }); flash("Subido"); }
    catch { flash("No se ha podido subir el archivo", "warn"); }
  };
  const form = { ...crm.FORM_DEF, ...(f.formulario || {}) };
  const avisos = { ...crm.AVISOS_DEF, ...(f.avisos || {}) };
  const diseno = { ...crm.DISENO_DEF, ...(f.diseno || {}) };
  const est = ESTADOS[f.estado];
  const listo = !!(f.flyer_url && d.tramos.length && evLocal.inicio);

  return (<>
    {/* ===== Estado, enlace y publicación ===== */}
    <section style={{ ...C.hero, padding: isMobile ? 16 : 22 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Badge c={est.c} solid={f.estado === "publicado"}>{est.t}</Badge>
            {f.modo === "pruebas" && <Badge c="var(--amber)">Modo pruebas · entradas sin valor</Badge>}
            <span style={{ fontSize: 12, fontWeight: 700, color: estado === "error" ? "var(--red)" : "var(--muted)", display: "inline-flex", alignItems: "center", gap: 4 }}>
              {estado === "guardando" ? "Guardando…" : estado === "guardado" ? <><Icon n="check" s={13} w={2.6} />Guardado</> : estado === "error" ? "No se ha guardado" : ""}
            </span>
          </div>
          <div style={{ fontSize: isMobile ? 24 : 32, fontWeight: 900, letterSpacing: "-.02em", marginTop: 8, overflowWrap: "anywhere" }}>{evLocal.nombre || ev.name}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <code style={{ background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 10px", fontSize: 13, overflowWrap: "anywhere", flex: "1 1 220px" }}>{url}</code>
            <button onClick={copiar} style={C.btnSm}><Icon n="copy" s={14} />Copiar</button>
            <a href={url} target="_blank" rel="noopener noreferrer" style={{ ...C.btnSm, textDecoration: "none" }}><Icon n="eye" s={14} />{f.estado === "borrador" ? "Vista previa" : "Abrir"}</a>
            <button onClick={onDuplicar} style={C.btnSm}><Icon n="copy" s={14} />Duplicar evento</button>
          </div>
          {f.estado === "borrador" && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>En borrador solo tú puedes ver la página (con la sesión abierta). Las compras que hagas son de prueba.</div>}
        </div>
        <div style={{ flex: "0 1 300px", display: "flex", flexDirection: "column", gap: 8 }}>
          <Seg full valor={f.estado} onChange={(v) => { if (v === "publicado" && !listo) flash("Antes de publicar: pon fecha, flyer y al menos un tramo", "warn"); setFicha({ estado: v }); }}
            opciones={[{ k: "borrador", t: "Borrador" }, { k: "publicado", t: "Publicar" }, { k: "cerrado", t: "Cerrar" }]} />
          <Seg full size="sm" valor={f.modo} onChange={(v) => setFicha({ modo: v })} opciones={[{ k: "pruebas", t: "Pruebas" }, { k: "real", t: "Real (solo gratis)" }]} />
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{f.modo === "pruebas" ? "Se puede «comprar» cualquier tramo sin pagar. Las entradas salen marcadas como PRUEBA." : "Por ahora solo se emiten los tramos gratuitos (0 €). Los de pago llegarán con la pasarela de cobro."}</div>
        </div>
      </div>
      {!listo && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        <Paso hecho={!!evLocal.inicio} t="Fecha y hora" /><Paso hecho={!!f.flyer_url} t="Flyer" /><Paso hecho={d.tramos.length > 0} t="Al menos un tramo" />
      </div>}
    </section>

    {/* ===== Datos del evento ===== */}
    <Seccion id="ent-datos" i="file" t="Datos del evento" sub="Nombre, fecha, horas y recinto se comparten con el TPV.">
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "0 12px" }}>
        <Field l="Nombre del evento"><input style={C.input} value={evLocal.nombre} maxLength={80} onChange={e => setEv("nombre", e.target.value, "nombre", v => v.toUpperCase())} /></Field>
        <Field l="Recinto"><input style={C.input} value={evLocal.recinto} maxLength={120} placeholder="Ej. Sala Apolo" onChange={e => setEv("recinto", e.target.value, "recinto")} /></Field>
        <Field l="Empieza (fecha y hora)"><input type="datetime-local" style={C.input} value={evLocal.inicio} onChange={e => { const v = e.target.value; setEvLocal(x => ({ ...x, inicio: v })); pendEv.current = { ...pendEv.current, inicio: v || null, ...(v ? { fecha: v.slice(0, 10) } : {}) }; guardarEv(pendEv.current); }} /></Field>
        <Field l="Termina (fecha y hora)"><input type="datetime-local" style={C.input} value={evLocal.fin} onChange={e => setEv("fin", e.target.value, "fin", aIso)} /></Field>
        <Field l="Dirección"><input style={C.input} value={f.direccion || ""} maxLength={300} placeholder="Calle, número, ciudad" onChange={e => setFicha({ direccion: e.target.value, maps_url: e.target.value ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((evLocal.recinto ? evLocal.recinto + ", " : "") + e.target.value)}` : null })} /></Field>
        <Field l="Vestimenta"><input style={C.input} value={f.vestimenta || ""} maxLength={300} placeholder="Ej. Total white · Etiqueta · Libre" onChange={e => setFicha({ vestimenta: e.target.value })} /></Field>
        <Field l="Edad mínima"><input inputMode="numeric" style={C.input} value={f.edad_minima ?? ""} placeholder="Sin mínimo" onChange={e => { const v = limpioNum(e.target.value); setFicha({ edad_minima: v === "" ? null : Math.min(99, +v) }); }} /></Field>
      </div>
      {evLocal.fin && evLocal.inicio && new Date(evLocal.fin) <= new Date(evLocal.inicio) && <div style={{ fontSize: 12.5, color: "var(--red)", fontWeight: 700, marginBottom: 10 }}>La hora de fin es anterior al inicio. Si acaba de madrugada, pon el día siguiente.</div>}
      <Field l="Descripción" mb={0}><textarea style={{ ...C.input, minHeight: 110, resize: "vertical", fontFamily: "inherit" }} value={f.descripcion || ""} maxLength={4000} placeholder="Line-up, horarios, normas, cómo llegar…" onChange={e => setFicha({ descripcion: e.target.value })} /></Field>
    </Seccion>

    {/* ===== Imágenes y documentos ===== */}
    <Seccion id="ent-imagenes" i="file" t="Flyer, logo y autorización" sub="El flyer es lo primero que se ve en la página y sale en cada entrada.">
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1.2fr 1fr 1fr", gap: 12 }}>
        <Subida t="Flyer o cartel" sub="Vertical u horizontal. JPG, PNG o WEBP." url={f.flyer_url} img accept="image/*" onFile={(fl) => subir("flyer", fl, "flyer_url")} onQuitar={() => setFicha({ flyer_url: null })} alto={220} />
        <Subida t="Logo (opcional)" sub="Se muestra arriba en la página." url={f.logo_url} img accept="image/*" onFile={(fl) => subir("logo", fl, "logo_url")} onQuitar={() => setFicha({ logo_url: null })} alto={110} />
        <div>
          <Subida t="Autorización para menores (PDF)" sub="La gente la descarga, la imprime, la rellena y la trae a mano." url={f.autorizacion_url} accept="application/pdf" onFile={(fl) => subir("autorizacion", fl, "autorizacion_url")} onQuitar={() => setFicha({ autorizacion_url: null })} alto={110} />
          <Field l="Se pide a menores de" mb={0}><div style={{ position: "relative" }}><input inputMode="numeric" style={{ ...C.input, paddingRight: 46 }} value={f.autorizacion_edad ?? 16} onChange={e => setFicha({ autorizacion_edad: Math.min(99, +limpioNum(e.target.value) || 0) })} /><span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontWeight: 800 }}>años</span></div></Field>
        </div>
      </div>
    </Seccion>

    {/* ===== Tramos ===== */}
    <Tramos ev={ev} d={d} setD={setD} ficha={f} setFicha={setFicha} flash={flash} isMobile={isMobile} />

    {/* ===== Avisos FOMO ===== */}
    <Seccion id="ent-avisos" i="bolt" t="Avisos de urgencia" sub="Siempre con datos reales: solo salen cuando de verdad quedan pocas.">
      <Sw on={avisos.activo} onClick={() => setFicha({ avisos: { ...avisos, activo: !avisos.activo } })} l="Mostrar «¡Quedan pocas!» y «Últimas entradas»" />
      {avisos.activo && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
        <Field l="Avisar cuando quede menos del"><div style={{ position: "relative" }}><input inputMode="numeric" style={{ ...C.input, paddingRight: 30 }} value={avisos.umbralPct} onChange={e => setFicha({ avisos: { ...avisos, umbralPct: Math.min(100, +limpioNum(e.target.value) || 0) } })} /><span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontWeight: 800 }}>%</span></div></Field>
        <Field l="«Últimas X» a partir de (entradas)"><input inputMode="numeric" style={C.input} placeholder="Ej. 20" value={avisos.umbralN} onChange={e => setFicha({ avisos: { ...avisos, umbralN: limpioNum(e.target.value) } })} /></Field>
      </div>}
      <Sw on={avisos.mostrarVendido} onClick={() => setFicha({ avisos: { ...avisos, mostrarVendido: !avisos.mostrarVendido } })} l="Barra de «% vendido» en cada tramo" />
      <Sw on={avisos.siguientePrecio} onClick={() => setFicha({ avisos: { ...avisos, siguientePrecio: !avisos.siguientePrecio } })} l="Avisar del precio del siguiente tramo («Después sube a 22 €»)" />
    </Seccion>

    {/* ===== Formulario de compra ===== */}
    <Seccion id="ent-form" i="user" t="Datos que se piden al comprar" sub="Nombre completo y correo siempre. Las entradas son nominativas: se pide el nombre de cada asistente.">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <Badge c="var(--green)"><Icon n="lock" s={11} w={2.4} />Nombre completo · obligatorio</Badge>
        <Badge c="var(--green)"><Icon n="lock" s={11} w={2.4} />Correo · obligatorio</Badge>
        <Badge c="var(--green)"><Icon n="lock" s={11} w={2.4} />Nombre de cada asistente · obligatorio</Badge>
      </div>
      {CAMPOS.map(c => (
        <div key={c.k} style={{ ...C.row, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700 }}>{c.t}</span>
          <Seg size="sm" valor={form[c.k]} onChange={(v) => setFicha({ formulario: { ...form, [c.k]: v } })} opciones={[{ k: "no", t: "No pedir" }, { k: "opcional", t: "Opcional" }, { k: "obligatorio", t: "Obligatorio" }]} />
        </div>))}
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Pide solo lo que necesites: cuantos menos datos, más gente termina la compra (y menos datos personales que custodiar).</div>
    </Seccion>

    {/* ===== Diseño ===== */}
    <Seccion id="ent-diseno" i="sparkle" t="Diseño de la página" sub="Colores de tu marca. La página siempre es sencilla: el flyer, las entradas y comprar.">
      <Field l="Color principal (botones y precios)">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {COLORES.map(c => <button key={c} onClick={() => setFicha({ diseno: { ...diseno, color: c } })} aria-label={`Color ${c}`} aria-pressed={diseno.color === c} style={{ width: 34, height: 34, borderRadius: 10, background: c, cursor: "pointer", border: diseno.color === c ? "3px solid var(--text)" : "3px solid transparent" }} />)}
          <input type="color" value={diseno.color} onChange={e => setFicha({ diseno: { ...diseno, color: e.target.value } })} aria-label="Otro color" style={{ width: 44, height: 34, border: "none", background: "transparent", cursor: "pointer" }} />
        </div>
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
        <Field l="Fondo"><Seg full valor={diseno.fondo} onChange={(v) => setFicha({ diseno: { ...diseno, fondo: v } })} opciones={[{ k: "oscuro", t: "Oscuro", i: "moon" }, { k: "claro", t: "Claro", i: "sun" }]} /></Field>
        <Field l="Tipo de letra"><Seg full valor={diseno.letra} onChange={(v) => setFicha({ diseno: { ...diseno, letra: v } })} opciones={LETRAS} /></Field>
      </div>
      <Sw on={diseno.fondoFlyer} onClick={() => setFicha({ diseno: { ...diseno, fondoFlyer: !diseno.fondoFlyer } })} l="Usar el flyer difuminado de fondo" />
    </Seccion>

    {/* ===== Lanzamiento y seguridad ===== */}
    <Seccion id="ent-lanzamiento" i="clock" t="Lanzamiento, QR y límites" sub="Cuenta atrás, desde cuándo vale el QR y cuántas entradas por persona.">
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 12 }}>
        <Field l="La venta empieza (cuenta atrás)"><input type="datetime-local" style={C.input} value={aLocal(f.venta_inicio)} onChange={e => setFicha({ venta_inicio: aIso(e.target.value) })} /><div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Vacío = se vende en cuanto publiques. Si es futura, la página muestra una cuenta atrás.</div></Field>
        <Field l="El QR vale desde"><div style={{ position: "relative" }}><input inputMode="numeric" style={{ ...C.input, paddingRight: 110 }} value={f.qr_horas_antes} onChange={e => setFicha({ qr_horas_antes: Math.min(720, +limpioNum(e.target.value) || 0) })} /><span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontWeight: 800 }}>h antes del inicio</span></div><div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Hasta la hora de fin. Ni antes ni después.</div></Field>
        <Field l="Máximo por persona (correo)"><input inputMode="numeric" style={C.input} value={f.max_por_email} onChange={e => setFicha({ max_por_email: Math.max(1, Math.min(100, +limpioNum(e.target.value) || 1)) })} /><div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Contra la reventa y los bots.</div></Field>
      </div>
      <EnlaceEditable ev={ev} f={f} setD={setD} flash={flash} />
    </Seccion>

    {/* ===== Ventas ===== */}
    <Ventas ev={ev} flash={flash} isMobile={isMobile} />
  </>);
}

const Paso = ({ hecho, t }) => <span style={{ ...C.tag, color: hecho ? "var(--green)" : "var(--amber)", borderColor: hecho ? "var(--green)" : "var(--amber)" }}><Icon n={hecho ? "check" : "alert"} s={13} w={2.4} />{t}</span>;
const Sw = ({ on, onClick, l, sub }) => (
  <label style={{ ...C.toggleRow, padding: "10px 0", borderTop: "1px solid var(--line)" }}>
    <span><span style={{ display: "block" }}>{l}</span>{sub && <span style={{ display: "block", fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>{sub}</span>}</span>
    <button type="button" role="switch" aria-checked={on} onClick={onClick} style={{ ...C.switch, background: on ? "var(--green)" : "var(--line)" }}><span style={{ ...C.knob, transform: on ? "translateX(22px)" : "translateX(2px)" }} /></button>
  </label>
);

function Subida({ t, sub, url, img, accept, onFile, onQuitar, alto }) {
  const ref = useRef(null);
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={C.label}>{t}</div>
      <button type="button" onClick={() => ref.current?.click()} style={{ width: "100%", height: alto, borderRadius: 14, border: `2px dashed ${url ? "transparent" : "var(--line)"}`, background: "var(--surface2)", cursor: "pointer", overflow: "hidden", padding: 0, display: "grid", placeItems: "center", color: "var(--muted)", position: "relative" }}>
        {url && img ? <img src={url} alt={t} style={{ width: "100%", height: "100%", objectFit: "contain", background: "var(--bg)" }} />
          : url ? <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, color: "var(--green)", fontWeight: 800 }}><Icon n="file" s={28} />PDF subido</span>
          : <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, fontWeight: 800, fontSize: 13 }}><Icon n="upload" s={24} />Subir</span>}
      </button>
      <input ref={ref} type="file" accept={accept} style={{ display: "none" }} onChange={e => { const fl = e.target.files?.[0]; e.target.value = ""; onFile(fl); }} />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{sub}</span>
        {url && <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>{!img && <a href={url} target="_blank" rel="noopener noreferrer" style={{ ...C.btnSm, textDecoration: "none" }}>Ver</a>}<button type="button" onClick={onQuitar} style={C.btnSm}>Quitar</button></span>}
      </div>
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
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Si ya lo has compartido, el enlace antiguo dejará de funcionar. Es provisional hasta que tengáis vuestro dominio.</div>
    </Field>
  );
}

/* ===================== Tramos ===================== */
function Tramos({ ev, d, setD, ficha, setFicha, flash, isMobile }) {
  const tramos = d.tramos;
  const timers = useRef({});
  const guardar = (t) => {
    clearTimeout(timers.current[t.id]);
    timers.current[t.id] = setTimeout(() => crm.webGuardarTramo(t).catch(() => flash("No se ha podido guardar el tramo", "warn")), 600);
  };
  const set = (id, patch) => setD(x => { const ts = x.tramos.map(t => t.id === id ? { ...t, ...patch } : t); guardar(ts.find(t => t.id === id)); return { ...x, tramos: ts }; });
  const anadir = async () => {
    const orden = tramos.reduce((m, t) => Math.max(m, t.orden + 1), 0);
    const t = { evento_id: ev.id, nombre: tramos.length ? `Tramo ${tramos.length + 1}` : "Anticipada", precio: 0, cantidad: 100, orden, max_por_compra: 10, visible: true, copas: 0, vendidas: 0 };
    try { const id = await crm.webGuardarTramo(t); setD(x => ({ ...x, tramos: [...x.tramos, { ...t, id }] })); } catch { flash("No se ha podido añadir", "warn"); }
  };
  const borrar = async (t) => {
    if (t.vendidas > 0) { flash("Tiene entradas vendidas: ocúltalo en vez de borrarlo", "warn"); return; }
    try { await crm.webBorrarTramo(t.id); setD(x => ({ ...x, tramos: x.tramos.filter(y => y.id !== t.id) })); } catch { flash("No se ha podido borrar", "warn"); }
  };
  const mover = (i, dir) => {
    const j = i + dir; if (j < 0 || j >= tramos.length) return;
    const ts = [...tramos]; [ts[i], ts[j]] = [ts[j], ts[i]];
    const conOrden = ts.map((t, k) => ({ ...t, orden: k }));
    setD(x => ({ ...x, tramos: conOrden })); conOrden.forEach(guardar);
  };
  const total = tramos.reduce((s, t) => s + (t.vendidas || 0), 0), aforo = tramos.every(t => t.cantidad != null) ? tramos.reduce((s, t) => s + t.cantidad, 0) : null;
  return (
    <Seccion id="ent-tramos" i="ticket" t="Tramos de entradas" sub="Precio, cantidad y cuándo se vende cada uno. Un tramo termina al agotarse o al llegar su fecha de fin."
      total={`${total}${aforo != null ? ` / ${aforo}` : ""}`} acciones={<button onClick={anadir} style={C.btnPrimary}><Icon n="plus" s={16} w={2.4} />Añadir tramo</button>}>
      <Sw on={ficha.secuencial} onClick={() => setFicha({ secuencial: !ficha.secuencial })} l="Tramos en orden" sub="El siguiente tramo se abre solo cuando el anterior se agota o termina." />
      {tramos.length === 0 && <div style={{ ...C.empty, marginTop: 10 }}>Añade el primer tramo: por ejemplo «Anticipada», 15 €, 100 entradas.</div>}
      {tramos.map((t, i) => {
        const pct = t.cantidad ? Math.min(100, Math.round(t.vendidas / t.cantidad * 100)) : null;
        return (
          <div key={t.id} style={{ padding: "14px 0", borderTop: "1px solid var(--line)", opacity: t.visible ? 1 : .6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, display: "grid", placeItems: "center", fontWeight: 900, background: "color-mix(in srgb, #ff5a3c 14%, var(--surface2))", color: "var(--accent)", flexShrink: 0 }}>{i + 1}</span>
              <input value={t.nombre} maxLength={60} onChange={e => set(t.id, { nombre: e.target.value })} aria-label="Nombre del tramo" style={{ ...C.input, flex: 1, minWidth: 0, fontWeight: 900, padding: "9px 11px" }} />
              {!t.visible && <Badge>Oculto</Badge>}
              <button onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Subir" style={{ ...C.btnSm, padding: 7, opacity: i === 0 ? .35 : 1 }}><Icon n="up" s={14} /></button>
              <button onClick={() => mover(i, 1)} disabled={i === tramos.length - 1} aria-label="Bajar" style={{ ...C.btnSm, padding: 7, opacity: i === tramos.length - 1 ? .35 : 1 }}><Icon n="chev" s={14} /></button>
              <button onClick={() => borrar(t)} aria-label="Borrar tramo" style={{ ...C.btnSm, padding: 7 }}><Icon n="trash" s={14} /></button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,minmax(0,1fr))", gap: 10 }}>
              <Mini l="Precio" suf="€"><input inputMode="decimal" value={t.precio} onChange={e => set(t.id, { precio: aNum(limpioNum(e.target.value, true)) ?? 0 })} style={inp} /></Mini>
              <Mini l="Cantidad" sub="Vacío = sin límite"><input inputMode="numeric" value={t.cantidad ?? ""} placeholder="∞" onChange={e => { const v = limpioNum(e.target.value); set(t.id, { cantidad: v === "" ? null : Math.max(+v, t.vendidas) }); }} style={inp} /></Mini>
              <Mini l="Máx. por compra"><input inputMode="numeric" value={t.max_por_compra} onChange={e => set(t.id, { max_por_compra: Math.max(1, Math.min(50, +limpioNum(e.target.value) || 1)) })} style={inp} /></Mini>
              <Mini l="Copas incluidas"><input inputMode="numeric" value={t.copas} onChange={e => set(t.id, { copas: Math.min(20, +limpioNum(e.target.value) || 0) })} style={inp} /></Mini>
              <Mini l="Empieza a venderse" sub="Vacío = ya"><input type="datetime-local" value={aLocal(t.venta_inicio)} onChange={e => set(t.id, { venta_inicio: aIso(e.target.value) })} style={inp} /></Mini>
              <Mini l="Deja de venderse" sub="Vacío = al agotarse"><input type="datetime-local" value={aLocal(t.venta_fin)} onChange={e => set(t.id, { venta_fin: aIso(e.target.value) })} style={inp} /></Mini>
              <div style={{ gridColumn: isMobile ? "1 / -1" : "span 2" }}><Mini l="Descripción corta (opcional)"><input value={t.descripcion || ""} maxLength={200} placeholder="Ej. Incluye una copa · Acceso antes de la 1:00" onChange={e => set(t.id, { descripcion: e.target.value })} style={inp} /></Mini></div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 800 }}>{t.vendidas} vendidas{t.cantidad != null ? ` de ${t.cantidad}` : ""}</span>
              {pct != null && <span style={{ flex: "1 1 140px", height: 8, borderRadius: 6, background: "var(--surface2)", overflow: "hidden" }}><span style={{ display: "block", width: `${pct}%`, height: "100%", background: pct >= 100 ? "var(--red)" : "linear-gradient(90deg,#ff5a3c,#ff8a3c)" }} /></span>}
              <button onClick={() => set(t.id, { visible: !t.visible })} style={C.btnSm}><Icon n={t.visible ? "eyeOff" : "eye"} s={14} />{t.visible ? "Ocultar" : "Mostrar"}</button>
            </div>
          </div>);
      })}
    </Seccion>
  );
}
const inp = { ...C.input, padding: "9px 10px", fontWeight: 800 };
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
  return (
    <Sheet title={titulo} onClose={onClose} footer={<button disabled={busy || nombre.trim().length < 3} onClick={() => onCrear(nombre.trim(), inicio || null)} style={{ ...C.btnPrimary, width: "100%", opacity: nombre.trim().length < 3 ? .5 : 1 }}><Icon n="check" s={17} w={2.4} />{busy ? "Creando…" : titulo === "Nuevo evento" ? "Crear evento" : "Duplicar"}</button>}>
      {nota && <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>{nota}</div>}
      <Field l="Nombre"><input autoFocus style={C.input} value={nombre} maxLength={80} onChange={e => setNombre(e.target.value)} placeholder="Ej. FIESTA DE VERANO" /></Field>
      {!sinFecha && <Field l="Empieza (fecha y hora)"><input type="datetime-local" style={C.input} value={inicio} onChange={e => setInicio(e.target.value)} /></Field>}
      <div style={{ fontSize: 12, color: "var(--muted)" }}>Se crea también en el TPV con una barra, para que puedas vender en él.</div>
    </Sheet>
  );
}

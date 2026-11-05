// ===================== CRM · AJUSTES =====================
// Conexiones con ticketeras · Categorías · Comisiones e IVA. Todo se guarda en la cuenta (vale para todos los eventos).
import React, { useEffect, useMemo, useState } from "react";
import { money, r2, fechaCorta, parseImporte, hoy, useIsMobile, C, Icon, Tile, Badge, Seg, Head, Sheet, Field } from "./ui";
import { GRUPOS, grupoInfo, CATS_ING, GCATS, catsIngreso, catsGasto, esAuto, ICONOS_CAT, COLORES_CAT, TICKETERA_CAT } from "./categorias";
import { ajustesCon, TIPOS_IVA } from "./fiscal";
import { Switch } from "./Ingresos";

const pctTxt = (v) => String(r2(v || 0)).replace(".", ",");
const ESTADO_CX = {
  ok: { t: "Conectada", c: "var(--green)", i: "check" },
  error: { t: "Con error", c: "var(--red)", i: "alert" },
  sin_probar: { t: "Sin probar", c: "var(--amber)", i: "clock" },
};
const MAIL_FV = (() => {
  const asunto = "Solicitud de API key de integración (TIXFAST)";
  const cuerpo = [
    "Hola, equipo de Fourvenues:", "",
    "Quiero conectar mi cuenta con mi sistema de gestión de eventos (TIXFAST) para consultar las ventas de entradas de mis eventos.", "",
    "Sala / organización: ", "Email de la cuenta de Fourvenues: ", "",
    "Uso: solo lectura de eventos y entradas vendidas (importes, tarifas y devoluciones) para el control económico de cada evento. No se modifica ningún dato.",
    "Endpoints que necesito: GET /events, GET /tickets y GET /channels.", "",
    "Me gustaría empezar en el entorno de pruebas (alpha) y después pasar a producción.", "",
    "Muchas gracias.",
  ].join("\n");
  return `mailto:integrations@fourvenues.com?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
})();

export function Ajustes({ ev, events, ajustes, conexion, vinculos, busy, seccion, setSeccion, preview, onGuardarAjustes, onRenombrar, onGuardarClave, onProbar, onDesconectar, onCargarEventos, onVincular, onDesvincular, onSync, onImportar, onVolver }) {
  const isMobile = useIsMobile();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Tile n="gear" s={38} /><div><div style={{ fontWeight: 900, fontSize: 20 }}>Ajustes del CRM</div><div style={{ fontSize: 12.5, color: "var(--muted)" }}>Valen para todos los eventos de la cuenta.</div></div></div>
        <button onClick={onVolver} style={C.btnGhost}><Icon n="right" s={16} style={{ transform: "rotate(180deg)" }} />Volver</button>
      </div>
      <Seg full size={isMobile ? "sm" : "md"} valor={seccion} onChange={setSeccion} opciones={[
        { k: "conexiones", t: isMobile ? "Ticketera" : "Conexión con ticketera", i: isMobile ? null : "link" },
        { k: "categorias", t: "Categorías", i: isMobile ? null : "pos" },
        { k: "fiscal", t: isMobile ? "Comisión e IVA" : "Comisiones e IVA", i: isMobile ? null : "percent" },
      ]} />
      {seccion === "conexiones" && <Conexiones {...{ ev, events, conexion, vinculos, busy, onGuardarClave, onProbar, onDesconectar, onCargarEventos, onVincular, onDesvincular, onSync, onImportar }} />}
      {seccion === "categorias" && <Categorias ajustes={ajustes} busy={busy} onGuardar={onGuardarAjustes} onRenombrar={onRenombrar} />}
      {seccion === "fiscal" && <Fiscal ajustes={ajustes} busy={busy} preview={preview} ev={ev} onGuardar={onGuardarAjustes} />}
    </div>
  );
}

/* ===================== CONEXIONES ===================== */
function Conexiones({ ev, events, conexion, vinculos, busy, onGuardarClave, onProbar, onDesconectar, onCargarEventos, onVincular, onDesvincular, onSync, onImportar }) {
  const isMobile = useIsMobile();
  const [editar, setEditar] = useState(!conexion);
  const [entorno, setEntorno] = useState(conexion?.entorno || "prueba");
  const [clave, setClave] = useState("");
  const [ver, setVer] = useState(false);
  const [confirmDes, setConfirmDes] = useState(false);
  const [vinc, setVinc] = useState(null); // evento a vincular
  useEffect(() => { setEditar(!conexion); setEntorno(conexion?.entorno || "prueba"); }, [conexion?.id]);
  const est = conexion ? ESTADO_CX[conexion.estado] || ESTADO_CX.sin_probar : null;
  const claveOk = clave.trim().length >= 8;
  const guardar = async () => { if (busy || (!claveOk && !conexion)) return; const ok = await onGuardarClave(entorno, clave.trim() || null); if (ok) { setClave(""); setEditar(false); } };

  return (<>
    <section style={C.panel}>
      <Head i="globe" c="#a855f7" t="Fourvenues" sub="Las entradas vendidas online entran solas en Ingresos."
        right={est ? <Badge c={est.c}><Icon n={est.i} s={11} w={2.4} />{est.t}</Badge> : <Badge>Sin conectar</Badge>} />
      {conexion && !editar && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3,minmax(0,1fr))", gap: 8, marginBottom: 12 }}>
            <Dato l="Clave" v={<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon n="key" s={15} />••••{conexion.claveFin}</span>} />
            <Dato l="Entorno" v={conexion.entorno === "real" ? "Real" : "Pruebas"} />
            <Dato l="Última sincronización" v={conexion.ultimaSync ? new Date(conexion.ultimaSync).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Todavía no"} />
          </div>
          {conexion.error && <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--red)", fontWeight: 700, fontSize: 13, marginBottom: 12 }}><Icon n="alert" s={16} />{conexion.error}</div>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button disabled={busy} onClick={onProbar} style={C.btnPrimary}><Icon n="check" s={16} w={2.4} />Probar conexión</button>
            <button onClick={() => setEditar(true)} style={C.btnGhost}><Icon n="key" s={16} />Cambiar clave o entorno</button>
            {confirmDes
              ? <><button disabled={busy} onClick={async () => { await onDesconectar(); setConfirmDes(false); }} style={{ ...C.btnGhost, color: "var(--red)", borderColor: "var(--red)" }}>Sí, desconectar</button><button onClick={() => setConfirmDes(false)} style={C.btnGhost}>No</button></>
              : <button onClick={() => setConfirmDes(true)} style={{ ...C.btnGhost, color: "var(--muted)" }}>Desconectar</button>}
          </div>
          {confirmDes && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Se borra la clave. Lo ya sincronizado se queda en Ingresos.</div>}
        </div>
      )}
      {editar && (
        <div>
          <Field l="Entorno">
            <Seg full valor={entorno} onChange={setEntorno} opciones={[{ k: "prueba", t: "Pruebas", i: "edit" }, { k: "real", t: "Real", i: "check", c: "var(--green)", ink: "#04241b" }]} />
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{entorno === "prueba" ? "Datos de prueba de Fourvenues (sin ventas reales). Empieza por aquí." : "Ventas reales de tus eventos."}</div>
          </Field>
          <Field l={conexion ? "Nueva clave (déjala vacía para mantener la actual)" : "Clave de Fourvenues (API key)"}>
            <div style={{ position: "relative" }}>
              <input type={ver ? "text" : "password"} value={clave} onChange={e => setClave(e.target.value.slice(0, 500))} placeholder="Pega aquí la clave" autoComplete="off" spellCheck={false} style={{ ...C.input, paddingRight: 46, fontFamily: "monospace" }} />
              <button type="button" onClick={() => setVer(v => !v)} aria-label={ver ? "Ocultar" : "Ver"} style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 34, height: 34, borderRadius: 8, border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", display: "grid", placeItems: "center" }}><Icon n={ver ? "eyeOff" : "eye"} s={18} /></button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)", marginTop: 6 }}><Icon n="lock" s={13} />Se guarda cifrada en el servidor y no se vuelve a mostrar, ni siquiera a ti.</div>
          </Field>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button disabled={busy || (!claveOk && !(conexion && entorno !== conexion.entorno))} onClick={guardar} style={{ ...C.btnPrimary, opacity: busy || (!claveOk && !(conexion && entorno !== conexion.entorno)) ? .45 : 1 }}><Icon n="check" s={16} w={2.4} />Guardar y probar</button>
            {conexion && <button onClick={() => { setEditar(false); setClave(""); setEntorno(conexion.entorno); }} style={C.btnGhost}>Cancelar</button>}
          </div>
        </div>
      )}
      {!conexion && (
        <div style={{ marginTop: 16, padding: 12, borderRadius: 12, background: "var(--surface2)", border: "1px solid var(--line)" }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>¿Aún no tienes la clave?</div>
          <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>Fourvenues la da por email a cada organizador. Te dejo el mensaje escrito: solo rellena el nombre de tu sala y el email de tu cuenta. Mientras llega, puedes importar las ventas con un CSV.</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <a href={MAIL_FV} style={{ ...C.btnGhost, textDecoration: "none" }}><Icon n="mail" s={16} />Pedir la clave a Fourvenues</a>
            <button onClick={onImportar} style={C.btnGhost}><Icon n="upload" s={16} />Importar CSV</button>
          </div>
        </div>
      )}
    </section>

    {conexion && (
      <section style={C.panel}>
        <Head i="link" t="Eventos vinculados" sub="Une cada evento de TIXFAST con su evento en Fourvenues. Se actualiza solo al abrir el CRM." />
        {events.map(e => { const v = vinculos.find(x => x.eventoId === e.id); return (
          <div key={e.id} style={{ ...C.row, flexWrap: isMobile ? "wrap" : "nowrap" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: isMobile ? "1 1 100%" : 1 }}>
              <Tile n="calendar" c={v ? "#a855f7" : "var(--muted)"} s={34} />
              <span style={{ minWidth: 0 }}>
                <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}{e.id === ev.id && <span style={{ color: "var(--muted)", fontWeight: 600, fontSize: 12 }}> · abierto ahora</span>}</b>
                <span style={{ fontSize: 12, color: v?.error ? "var(--amber)" : "var(--muted)" }}>{v ? (v.error || `↔ ${v.extNombre || v.extId}`) : e.date ? fechaCorta(e.date) + " " + e.date.slice(0, 4) : "Sin fecha"}</span>
              </span>
            </span>
            <span style={{ display: "flex", gap: 6, flexShrink: 0, marginLeft: isMobile ? 44 : 0 }}>
              {v ? <>
                <button disabled={busy} onClick={() => onSync(e.id)} style={C.btnSm}><Icon n="refresh" s={14} />Sincronizar</button>
                <button disabled={busy} onClick={() => onDesvincular(e.id)} style={{ ...C.btnSm, color: "var(--muted)" }}>Quitar</button>
              </> : <button onClick={() => setVinc(e)} style={{ ...C.btnSm, color: "var(--accent)", borderColor: "color-mix(in srgb, var(--accent) 55%, transparent)" }}><Icon n="link" s={14} />Vincular</button>}
            </span>
          </div>); })}
      </section>
    )}

    <section style={C.panel}>
      <Head i="upload" t="Importar desde CSV" sub="Para cualquier ticketera: exporta las ventas en CSV y súbelas a este evento. Si lo vuelves a importar, se actualiza (no se duplica)." />
      <button onClick={onImportar} style={C.btnGhost}><Icon n="upload" s={16} />Importar CSV en {ev.name}</button>
    </section>

    {vinc && <VincularSheet evento={vinc} busy={busy} onCargar={onCargarEventos} onClose={() => setVinc(null)} onVincular={async (id, nombre) => { const ok = await onVincular(vinc.id, id, nombre); if (ok) setVinc(null); }} />}
  </>);
}
const Dato = ({ l, v }) => <div style={{ padding: "9px 11px", borderRadius: 12, background: "var(--surface2)", border: "1px solid var(--line)", minWidth: 0 }}><div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: .8 }}>{l}</div><div style={{ fontWeight: 900, fontSize: 14.5, marginTop: 2 }}>{v}</div></div>;

function VincularSheet({ evento, busy, onCargar, onClose, onVincular }) {
  const [lista, setLista] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const [manual, setManual] = useState("");
  const cargar = async () => { setCargando(true); setError(""); try { setLista(await onCargar()); } catch (e) { setError(e.message || "No se han podido cargar"); } finally { setCargando(false); } };
  useEffect(() => { cargar(); }, []);
  return (
    <Sheet title={`Vincular ${evento.name}`} onClose={onClose}>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>Elige su evento en Fourvenues.</div>
      {cargando && <div style={{ color: "var(--muted)", padding: 16, textAlign: "center" }}>Cargando eventos de Fourvenues…</div>}
      {error && <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--amber)", fontWeight: 700, fontSize: 13, marginBottom: 10 }}><Icon n="alert" s={16} />{error}</div>}
      {lista && lista.length === 0 && <div style={C.empty}>Fourvenues no devuelve eventos con esta clave.</div>}
      {(lista || []).map(x => (
        <button key={x.id} disabled={busy} onClick={() => onVincular(x.id, x.nombre)} style={C.listBtn}>
          <Tile n="ticket" c="#a855f7" s={34} />
          <span style={{ flex: 1, minWidth: 0 }}><b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.nombre}</b><span style={{ fontSize: 12, color: "var(--muted)" }}>{x.fecha ? fechaCorta(x.fecha) + " " + x.fecha.slice(0, 4) : x.id}</span></span>
          <Icon n="right" s={18} c="var(--muted)" />
        </button>))}
      <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
        <Field l="O escribe el ID del evento en Fourvenues" mb={8}><input value={manual} maxLength={100} onChange={e => setManual(e.target.value)} placeholder="ID del evento" style={{ ...C.input, fontFamily: "monospace" }} /></Field>
        <button disabled={busy || !manual.trim()} onClick={() => onVincular(manual.trim(), null)} style={{ ...C.btnGhost, opacity: manual.trim() ? 1 : .45 }}><Icon n="link" s={16} />Vincular con este ID</button>
      </div>
    </Sheet>
  );
}

/* ===================== CATEGORÍAS ===================== */
function Categorias({ ajustes, busy, onGuardar, onRenombrar }) {
  const isMobile = useIsMobile();
  const [ambito, setAmbito] = useState("gasto");
  const [edit, setEdit] = useState(null); // { cat, nueva }
  const lista = ambito === "gasto" ? catsGasto(false) : catsIngreso(false);
  const ivaVentas = ajustesCon(ajustes).iva;
  const guardarLista = (nueva) => onGuardar({ ...ajustes, categorias: { ...(ajustes.categorias || {}), [ambito]: nueva.map(({ c, ...x }) => (ambito === "ingreso" && c === grupoInfo(x.g).c ? x : { ...x, c })) } });
  const toggle = (k) => guardarLista(lista.map(c => c.k === k ? { ...c, oculta: !c.oculta } : c));
  const mover = (ix, d) => { const l = [...lista]; const j = ix + d; if (j < 0 || j >= l.length) return; [l[ix], l[j]] = [l[j], l[ix]]; guardarLista(l); };
  const restaurar = () => onGuardar({ ...ajustes, categorias: { ...(ajustes.categorias || {}), [ambito]: null } });
  return (
    <section style={C.panel}>
      <Head i="pos" t="Categorías" sub="Cambia el nombre, el icono o el color, ocúltalas o crea nuevas. Las ocultas no salen al apuntar, pero lo ya apuntado se mantiene."
        right={<button onClick={() => setEdit({ cat: ambito === "gasto" ? { k: "", i: "dots", c: "#838aa0", iva: 21, factura: true } : { k: "", g: "otros", i: "sparkle" }, nueva: true })} style={C.btnPrimary}><Icon n="plus" s={16} w={2.4} />Nueva categoría</button>} />
      <div style={{ marginBottom: 8 }}><Seg valor={ambito} onChange={setAmbito} opciones={[{ k: "gasto", t: "Gastos", i: "receipt" }, { k: "ingreso", t: "Ingresos", i: "wallet" }]} /></div>
      {lista.map((c, ix) => (
        <div key={c.k} style={{ ...C.row, opacity: c.oculta ? .5 : 1 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: isMobile ? "1 1 100%" : 1 }}>
            <Tile n={c.i} c={c.c} s={34} />
            <span style={{ minWidth: 0 }}>
              <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.k}</b>
              <span style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3 }}>
                {ambito === "gasto"
                  ? <>{c.factura !== false ? <Badge c="var(--green)">Con factura</Badge> : <Badge c="var(--amber)">Sin factura</Badge>}<Badge>{c.iva ? `IVA ${c.iva} %` : "Sin IVA"}</Badge></>
                  : <><Badge c={grupoInfo(c.g).c}>{grupoInfo(c.g).t}</Badge>{ivaVentas.activo && <Badge>IVA {pctTxt(ivaVentas.ventas[c.g])} %</Badge>}</>}
                {c.oculta && <Badge>Oculta</Badge>}
              </span>
            </span>
          </span>
          <span style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            <button disabled={busy || ix === 0} onClick={() => mover(ix, -1)} style={{ ...C.btnSm, padding: "7px 8px", opacity: ix === 0 ? .35 : 1 }} aria-label="Subir"><Icon n="up" s={15} /></button>
            <button disabled={busy} onClick={() => toggle(c.k)} style={{ ...C.btnSm, padding: "7px 8px" }} aria-label={c.oculta ? "Mostrar" : "Ocultar"}><Icon n={c.oculta ? "eyeOff" : "eye"} s={15} /></button>
            <button onClick={() => setEdit({ cat: c })} style={{ ...C.btnSm, padding: "7px 8px" }} aria-label="Editar"><Icon n="edit" s={15} /></button>
          </span>
        </div>))}
      <div style={{ marginTop: 12 }}><button disabled={busy || !(ajustes.categorias || {})[ambito]} onClick={restaurar} style={{ ...C.btnSm, color: "var(--muted)", opacity: (ajustes.categorias || {})[ambito] ? 1 : .4 }}><Icon n="refresh" s={14} />Volver a las de serie</button></div>
      {edit && <CategoriaSheet ambito={ambito} {...edit} lista={lista} busy={busy} onClose={() => setEdit(null)}
        onSave={async (cat, viejo) => {
          if (viejo && viejo !== cat.k) { const ok = await onRenombrar(ambito, viejo, cat.k); if (!ok) return; }
          const nueva = edit.nueva ? [...lista, cat] : lista.map(c => c.k === viejo ? cat : c);
          const ok = await guardarLista(nueva); if (ok) setEdit(null);
        }} />}
    </section>
  );
}

function CategoriaSheet({ ambito, cat, nueva, lista, busy, onClose, onSave }) {
  const [f, setF] = useState(() => ({ ...cat, c: cat.c || grupoInfo(cat.g).c }));
  const set = (p) => setF(x => ({ ...x, ...p }));
  const nombre = (f.k || "").trim();
  const repetido = lista.some(c => c.k.toLowerCase() === nombre.toLowerCase() && c.k !== cat.k);
  const protegido = !nueva && ((ambito === "ingreso" && cat.k === TICKETERA_CAT) || (ambito === "gasto" && ["Artistas", "Personal", "Técnicos"].includes(cat.k)));
  const valido = nombre.length > 0 && nombre.length <= 60 && !repetido && !esAuto(nombre);
  return (
    <Sheet title={nueva ? "Nueva categoría" : "Editar categoría"} onClose={onClose}
      footer={<button disabled={!valido || busy} onClick={() => onSave({ ...f, k: nombre }, nueva ? null : cat.k)} style={{ ...C.btnPrimary, width: "100%", minHeight: 52, fontSize: 16, opacity: valido && !busy ? 1 : .45 }}>{busy ? "Guardando…" : repetido ? "Ya existe ese nombre" : "Guardar"}</button>}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}><Tile n={f.i} c={f.c} s={52} /><b style={{ fontSize: 18 }}>{nombre || "Nombre"}</b></div>
      <Field l="Nombre"><input autoFocus={nueva} disabled={protegido} value={f.k} maxLength={60} onChange={e => set({ k: e.target.value })} style={{ ...C.input, opacity: protegido ? .6 : 1 }} placeholder="Ej.: Seguridad" />
        {protegido && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{ambito === "ingreso" ? "La usa la ticketera para las entradas online" : "La usan los botones Personal y Artista"}; el nombre no se cambia, pero sí el icono y el color.</div>}
        {!nueva && !protegido && nombre && nombre !== cat.k && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Se cambiará el nombre también en todo lo ya apuntado.</div>}
      </Field>
      <Field l="Icono">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(44px, 1fr))", gap: 6 }}>
          {ICONOS_CAT.map(i => <button key={i} type="button" onClick={() => set({ i })} aria-label={i} style={{ height: 44, borderRadius: 10, cursor: "pointer", display: "grid", placeItems: "center", border: `2px solid ${f.i === i ? f.c : "var(--line)"}`, background: f.i === i ? `color-mix(in srgb, ${f.c} 16%, var(--surface2))` : "var(--surface2)", color: f.i === i ? f.c : "var(--text)" }}><Icon n={i} s={19} /></button>)}
        </div>
      </Field>
      <Field l="Color">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {COLORES_CAT.map(c => <button key={c} type="button" onClick={() => set({ c })} aria-label={`Color ${c}`} style={{ width: 32, height: 32, borderRadius: "50%", background: c, cursor: "pointer", border: f.c === c ? "3px solid #fff" : "2px solid transparent", boxShadow: f.c === c ? `0 0 0 2px ${c}` : "none" }} />)}
        </div>
      </Field>
      {ambito === "ingreso" && <Field l="Cuenta como">
        <Seg full size="sm" valor={f.g} onChange={(g) => set({ g, c: f.c === grupoInfo(f.g).c ? grupoInfo(g).c : f.c })} opciones={GRUPOS.map(g => ({ k: g.k, t: g.t, c: g.c, ink: "#fff" }))} />
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Decide en qué grupo se suma en el resumen y qué IVA de ventas se le aplica.</div>
      </Field>}
      {ambito === "gasto" && <>
        <Field l="IVA habitual"><Seg full valor={String(f.iva ?? 21)} onChange={(k) => set({ iva: Number(k) })} opciones={TIPOS_IVA.map(t => ({ k: String(t), t: t ? `${t} %` : "Sin IVA" }))} /></Field>
        <Field l="¿Suele llevar factura?"><Seg full valor={f.factura !== false ? "si" : "no"} onChange={(k) => set({ factura: k === "si" })} opciones={[{ k: "si", t: "Con factura", i: "file", c: "var(--green)", ink: "#04241b" }, { k: "no", t: "Sin factura", i: "x", c: "var(--amber)", ink: "#1a1205" }]} />
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Es lo que sale marcado al apuntar un gasto de esta categoría; en cada gasto se puede cambiar.</div></Field>
      </>}
    </Sheet>
  );
}

/* ===================== COMISIONES E IVA ===================== */
function Fiscal({ ajustes, busy, preview, ev, onGuardar }) {
  const isMobile = useIsMobile();
  const base = ajustesCon(ajustes);
  const aTxt = (a) => ({ comisiones: Object.fromEntries(Object.entries(a.comisiones).map(([k, v]) => [k, v ? pctTxt(v) : ""])), iva: { activo: a.iva.activo, ventas: { ...a.iva.ventas } } });
  const [f, setF] = useState(() => aTxt(base));
  useEffect(() => { setF(aTxt(ajustesCon(ajustes))); }, [ajustes]);
  const draft = { ...ajustes, comisiones: Object.fromEntries(Object.entries(f.comisiones).map(([k, v]) => [k, Math.min(k === "ticketeraFijo" ? 100 : 30, parseImporte(v))])), iva: { activo: !!f.iva.activo, ventas: f.iva.ventas } };
  const cambiado = JSON.stringify({ c: draft.comisiones, i: draft.iva }) !== JSON.stringify({ c: base.comisiones, i: { activo: !!base.iva.activo, ventas: base.iva.ventas } });
  const P = useMemo(() => preview(draft), [JSON.stringify(draft)]);
  const setC = (k, v) => setF(x => ({ ...x, comisiones: { ...x.comisiones, [k]: v.replace(/[^\d.,]/g, "").slice(0, 6) } }));
  const lineaDe = (k) => P.comisiones.find(l => l.k === k);
  const CAMPOS = [
    { k: "tarjeta", t: "Tarjeta / datáfono", sub: "Ventas con tarjeta del TPV y cobros con tarjeta", i: "card" },
    { k: "bizum", t: "Bizum", sub: "Cobros por Bizum", i: "phone" },
    { k: "transferencia", t: "Transferencias", sub: "Cobros por transferencia", i: "bank" },
  ];
  return (<>
    <section style={C.panel}>
      <Head i="percent" c="#f43f5e" t="Comisiones" sub="Lo que se quedan el datáfono, Bizum, el banco o la ticketera. Se resta como gasto automático." />
      {CAMPOS.map(c => { const l = lineaDe(c.k); return (
        <div key={c.k} style={{ ...C.row, flexWrap: isMobile ? "wrap" : "nowrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: isMobile ? "1 1 100%" : 1 }}><Tile n={c.i} c="#f43f5e" s={34} /><span style={{ minWidth: 0 }}><b style={{ display: "block" }}>{c.t}</b><span style={{ fontSize: 12, color: "var(--muted)" }}>{c.sub}</span></span></span>
          <span style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, marginLeft: isMobile ? 44 : 0 }}>
            <PctInput v={f.comisiones[c.k]} onChange={(v) => setC(c.k, v)} />
            <span style={{ minWidth: 92, textAlign: "right", fontSize: 13, color: l ? "var(--rose)" : "var(--muted)", fontWeight: 800 }}>{l ? "−" + money(l.importe) : "—"}</span>
          </span>
        </div>); })}
      <div style={{ ...C.row, flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: "1 1 220px" }}><Tile n="globe" c="#a855f7" s={34} /><span style={{ minWidth: 0 }}><b style={{ display: "block" }}>Ticketera online</b><span style={{ fontSize: 12, color: "var(--muted)" }}>Lo que cobra la ticketera al organizador</span></span></span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: isMobile ? 1 : 0, minWidth: 0, marginLeft: isMobile ? 44 : 0, flexWrap: "wrap" }}>
          <PctInput v={f.comisiones.ticketeraPct} onChange={(v) => setC("ticketeraPct", v)} />
          <b style={{ color: "var(--muted)" }}>+</b>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><input inputMode="decimal" value={f.comisiones.ticketeraFijo} onChange={e => setC("ticketeraFijo", e.target.value)} placeholder="0" style={{ ...C.input, width: 70, textAlign: "right", fontWeight: 900, padding: "8px 10px" }} aria-label="Euros por entrada" /><span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 700 }}>€/entrada</span></span>
          <span style={{ minWidth: 92, textAlign: "right", fontSize: 13, color: lineaDe("ticketera") ? "var(--rose)" : "var(--muted)", fontWeight: 800 }}>{lineaDe("ticketera") ? "−" + money(lineaDe("ticketera").importe) : "—"}</span>
        </span>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>Las cifras de la derecha son de {ev.name}. Total comisiones: <b style={{ color: "var(--text)" }}>{money(P.comisionTotal)}</b>.</div>
    </section>

    <section style={C.panel}>
      <Head i="bank" c="#64748b" t="IVA" sub="Para ver el beneficio real sin IVA y cuánto toca pagar a Hacienda."
        right={<label style={{ display: "inline-flex", alignItems: "center", gap: 10, fontWeight: 800 }}>Calcular IVA <Switch on={!!f.iva.activo} onClick={() => setF(x => ({ ...x, iva: { ...x.iva, activo: !x.iva.activo } }))} /></label>} />
      <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5, marginBottom: 12 }}>
        Los precios de venta ya llevan el IVA dentro. En cada gasto indicas si tiene factura y su IVA: el IVA de los gastos <b style={{ color: "var(--text)" }}>con factura</b> se recupera; el de los gastos <b style={{ color: "var(--text)" }}>sin factura</b> no, y cuentan enteros. La facturación del TPV no cambia.
      </div>
      <div style={C.label}>IVA de las ventas</div>
      {GRUPOS.map(g => { const v = P.iva.ventas.find(x => x.k === g.k); return (
        <div key={g.k} style={{ ...C.row, flexWrap: isMobile ? "wrap" : "nowrap", opacity: f.iva.activo ? 1 : .55 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: isMobile ? "1 1 100%" : 1 }}><Tile n={g.i} c={g.c} s={32} /><span><b>{g.t}</b>{v && <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>{money(v.total)} vendidos · IVA {money(v.iva)}</span>}</span></span>
          <span style={{ marginLeft: isMobile ? 42 : 0 }}><Seg size="sm" valor={String(f.iva.ventas[g.k])} onChange={(k) => setF(x => ({ ...x, iva: { ...x.iva, ventas: { ...x.iva.ventas, [g.k]: Number(k) } } }))} opciones={TIPOS_IVA.map(t => ({ k: String(t), t: `${t} %` }))} /></span>
        </div>); })}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,minmax(0,1fr))", gap: 8, marginTop: 14, opacity: f.iva.activo ? 1 : .55 }}>
        <Dato l="IVA de ventas" v={money(P.iva.repercutido)} />
        <Dato l="IVA gastos con factura" v={"−" + money(P.iva.soportado)} />
        <Dato l={P.iva.neto >= 0 ? "A pagar (estimado)" : "A devolver (estimado)"} v={<span style={{ color: P.iva.neto >= 0 ? "var(--amber)" : "var(--green)" }}>{money(Math.abs(P.iva.neto))}</span>} />
        <Dato l="Gastos sin factura" v={money(P.iva.sinFactura)} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)", marginTop: 10 }}><Icon n="alert" s={13} />Es una estimación para el control del evento. Confirma los tipos de IVA con tu gestor.</div>
    </section>

    <div style={{ position: "sticky", bottom: 0, paddingBottom: 4, background: "linear-gradient(transparent, var(--bg) 30%)", paddingTop: 12 }}>
      <button disabled={!cambiado || busy} onClick={() => onGuardar(draft)} style={{ ...C.btnPrimary, width: "100%", minHeight: 52, fontSize: 16, opacity: cambiado && !busy ? 1 : .45 }}>{busy ? "Guardando…" : cambiado ? "Guardar comisiones e IVA" : "Sin cambios"}</button>
    </div>
  </>);
}
const PctInput = ({ v, onChange }) => <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><input inputMode="decimal" value={v} onChange={e => onChange(e.target.value)} placeholder="0" style={{ ...C.input, width: 70, textAlign: "right", fontWeight: 900, padding: "8px 10px" }} aria-label="Porcentaje" /><b style={{ color: "var(--muted)" }}>%</b></span>;

/* ===================== IMPORTAR CSV ===================== */
// Lee el CSV en el propio navegador (no se sube el fichero), agrupa por tipo de entrada y lo guarda en Ingresos.
function parseCSV(texto) {
  const t = texto.replace(/^﻿/, "");
  const primera = t.split(/\r?\n/)[0] || "";
  const sep = [";", ",", "\t"].map(s => [s, primera.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const filas = []; let fila = [], campo = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else q = false; } else campo += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { fila.push(campo); campo = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && t[i + 1] === "\n") i++; fila.push(campo); campo = ""; if (fila.some(c => c.trim() !== "")) filas.push(fila); fila = []; }
    else campo += ch;
  }
  fila.push(campo); if (fila.some(c => c.trim() !== "")) filas.push(fila);
  return filas;
}
export function numCSV(v) {
  let s = String(v || "").replace(/[^\d,.\-]/g, "");
  if (!s) return 0;
  const c = s.lastIndexOf(","), p = s.lastIndexOf(".");
  if (c > -1 && p > -1) s = c > p ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (c > -1) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = parseFloat(s); return Number.isFinite(n) ? n : 0;
}
const ANULADA = /cancel|anulad|devuel|reembols|refund|rechaz/i;
const busca = (cab, re) => { const i = cab.findIndex(h => re.test(h)); return i < 0 ? "" : String(i); };

export function ImportarCSV({ ev, busy, onClose, onImportar }) {
  const isMobile = useIsMobile();
  const [filas, setFilas] = useState(null);
  const [nombreFich, setNombreFich] = useState("");
  const [error, setError] = useState("");
  const [map, setMap] = useState({ importe: "", tipo: "", estado: "", fecha: "" });
  const [ticketera, setTicketera] = useState("Fourvenues");
  const leer = (file) => {
    setError("");
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError("El fichero es demasiado grande (máx. 5 MB)."); return; }
    const r = new FileReader();
    r.onload = () => {
      const f = parseCSV(String(r.result || ""));
      if (f.length < 2) { setError("No se han encontrado filas en el CSV."); return; }
      const cab = f[0].map(h => h.trim());
      setFilas(f); setNombreFich(file.name);
      setMap({ importe: busca(cab, /total.*pag|importe|total|precio|price|amount|pagado/i), tipo: busca(cab, /tarifa|rate|tipo|entrada|ticket|producto|product/i), estado: busca(cab, /estado|status/i), fecha: busca(cab, /fecha|date|creado|created/i) });
    };
    r.onerror = () => setError("No se ha podido leer el fichero.");
    r.readAsText(file, "utf-8");
  };
  const cab = filas ? filas[0].map(h => h.trim() || "(sin nombre)") : [];
  const datos = filas ? filas.slice(1) : [];
  const res = useMemo(() => {
    if (!filas || map.importe === "") return null;
    const g = {}; let anuladas = 0;
    datos.forEach(f => {
      if (map.estado !== "" && ANULADA.test(f[+map.estado] || "")) { anuladas++; return; }
      const imp = numCSV(f[+map.importe]);
      const nombre = (map.tipo !== "" ? (f[+map.tipo] || "").trim() : "") || "Entradas";
      const x = g[nombre] = g[nombre] || { nombre: nombre.slice(0, 120), importe: 0, unidades: 0, fecha: null };
      x.importe += Math.max(0, imp); x.unidades++;
      if (map.fecha !== "") { const m = String(f[+map.fecha] || "").match(/(\d{4})-(\d{2})-(\d{2})|(\d{2})\/(\d{2})\/(\d{4})/); const d = m ? (m[1] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[6]}-${m[5]}-${m[4]}`) : null; if (d && (!x.fecha || d > x.fecha)) x.fecha = d; }
    });
    const grupos = Object.values(g).map(x => ({ ...x, importe: r2(x.importe) })).sort((a, b) => b.importe - a.importe).slice(0, 200);
    return { grupos, total: r2(grupos.reduce((t, x) => t + x.importe, 0)), unidades: grupos.reduce((t, x) => t + x.unidades, 0), anuladas };
  }, [filas, map]);
  const ok = res && res.grupos.length > 0 && res.total > 0 && ticketera.trim();
  const sel = (k, l, opcional) => (
    <Field l={l} mb={10}><select value={map[k]} onChange={e => setMap(m => ({ ...m, [k]: e.target.value }))} style={{ ...C.input, padding: "10px 12px" }}>
      <option value="">{opcional ? "— No usar —" : "— Elige la columna —"}</option>
      {cab.map((h, i) => <option key={i} value={String(i)}>{h}{datos[0]?.[i] ? ` · ej.: ${String(datos[0][i]).slice(0, 24)}` : ""}</option>)}
    </select></Field>
  );
  return (
    <Sheet title={`Importar ventas · ${ev.name}`} onClose={onClose}
      footer={<button disabled={!ok || busy} onClick={() => onImportar(ticketera.trim(), res.grupos)} style={{ ...C.btnPrimary, width: "100%", minHeight: 52, fontSize: 16, opacity: ok && !busy ? 1 : .45 }}>{busy ? "Importando…" : ok ? `Importar ${money(res.total)} · ${res.unidades} entradas` : filas ? "Elige la columna del importe" : "Elige un fichero CSV"}</button>}>
      <label style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, border: "2px dashed var(--line)", cursor: "pointer", marginBottom: 14 }}>
        <Tile n="upload" s={40} />
        <span style={{ flex: 1, minWidth: 0 }}><b style={{ display: "block" }}>{nombreFich || "Elige el fichero CSV"}</b><span style={{ fontSize: 12, color: "var(--muted)" }}>{filas ? `${datos.length} filas` : "Se lee aquí mismo; el fichero no se sube a ningún sitio."}</span></span>
        <input type="file" accept=".csv,text/csv,text/plain" onChange={e => leer(e.target.files?.[0])} style={{ display: "none" }} />
      </label>
      {error && <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--amber)", fontWeight: 700, fontSize: 13, marginBottom: 10 }}><Icon n="alert" s={16} />{error}</div>}
      {filas && <>
        <Field l="Ticketera" mb={10}><input value={ticketera} maxLength={40} onChange={e => setTicketera(e.target.value)} style={C.input} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "0 10px" }}>
          {sel("importe", "Columna del importe")}
          {sel("tipo", "Tipo de entrada (opcional)", true)}
          {sel("estado", "Estado (quita anuladas)", true)}
          {sel("fecha", "Fecha (opcional)", true)}
        </div>
        {res && <div style={{ marginTop: 6 }}>
          <div style={C.label}>Se va a importar</div>
          {res.grupos.map(g => <div key={g.nombre} style={C.row}><span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}><Tile n="ticket" c="#a855f7" s={30} /><span style={{ minWidth: 0 }}><b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.nombre}</b><span style={{ fontSize: 12, color: "var(--muted)" }}>{g.unidades} entradas</span></span></span><b>{money(g.importe)}</b></div>)}
          {res.anuladas > 0 && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{res.anuladas} filas anuladas o devueltas no se cuentan.</div>}
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Si ya importaste antes de {ticketera || "esta ticketera"} en este evento, se sustituye (no se suma dos veces).</div>
        </div>}
      </>}
    </Sheet>
  );
}

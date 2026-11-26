// ===================== INVITACIONES · entradas de regalo con su QR =====================
// Eliges evento y tipo de entrada, escribes nombre y correo, y se crea una entrada nominativa a 0 € con QR
// de un solo uso. Se envía al correo (si el envío está configurado) y siempre se puede compartir el enlace.
// No cuentan como ventas ni ingresos; si se marca, ocupan aforo del tipo de entrada.
import React, { useEffect, useMemo, useState } from "react";
import * as crm from "./crmdb";
import { useIsMobile, C, Icon, Badge, Sheet, Field, Seccion } from "./ui";

const enlaceDe = (acceso) => `${window.location.origin}/mis-entradas/${acceso}`;
const fechaCorta = (iso) => new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const CORREO = { enviado: "Invitación enviada por correo", sin_correo: "Invitación creada. El envío por correo aún no está configurado: comparte el enlace", limite: "Ya se ha enviado 3 veces: comparte el enlace", espera: "Espera 2 minutos para volver a enviarla" };

export function Invitaciones({ ev, events, flash }) {
  const isMobile = useIsMobile();
  const [conVenta, setConVenta] = useState(null);     // eventos con venta online { id: resumen }
  const [eventoId, setEventoId] = useState(ev.id);
  const [tramos, setTramos] = useState([]);
  const [lista, setLista] = useState(null);
  const [nueva, setNueva] = useState(null);
  const [hecha, setHecha] = useState(null);           // invitación recién creada (para compartir)
  const [busy, setBusy] = useState(false);
  const [espera, setEspera] = useState([]);

  useEffect(() => { crm.webListar().then(setConVenta).catch(() => setConVenta({})); }, []);
  const eventos = useMemo(() => (events || []).filter(e => conVenta?.[e.id]).sort((a, b) => String(b.startsAt || b.date || "").localeCompare(String(a.startsAt || a.date || ""))), [events, conVenta]);
  useEffect(() => { if (conVenta && !conVenta[eventoId] && eventos[0]) setEventoId(eventos[0].id); }, [conVenta]);
  const cargar = () => {
    setLista(null);
    crm.webCargar(eventoId).then(x => setTramos(x?.tramos || [])).catch(() => setTramos([]));
    crm.invitacionesListar(eventoId).then(setLista).catch(() => setLista([]));
    crm.esperaListar(eventoId).then(setEspera).catch(() => setEspera([]));
  };
  useEffect(cargar, [eventoId]);
  const evSel = (events || []).find(e => e.id === eventoId) || ev;

  const abrir = (de = {}) => setNueva({ tramoId: tramos[0]?.id || "", nombre: "", email: "", cantidad: 1, aforo: true, nota: "", ...de });
  const crear = async () => {
    const n = nueva;
    if (!n.tramoId) return flash("Elige el tipo de entrada", "warn");
    if (n.nombre.trim().length < 3) return flash("Escribe el nombre completo", "warn");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(n.email.trim())) return flash("Revisa el correo", "warn");
    setBusy(true);
    try {
      const r = await crm.invitar({ eventoId, tramoId: n.tramoId, nombre: n.nombre.trim(), email: n.email.trim(), cantidad: n.cantidad, aforo: n.aforo, nota: n.nota });
      const envio = await crm.invitacionEnviar(r.acceso);
      const m = envio?.ok ? "enviado" : envio?.motivo;
      flash(CORREO[m] || "Invitación creada. No se ha podido enviar el correo: comparte el enlace", m === "enviado" ? undefined : "warn");
      setHecha({ acceso: r.acceso, nombre: n.nombre.trim(), email: n.email.trim(), enviado: m === "enviado" });
      if (n.esperaId) await crm.esperaAvisado([n.esperaId]).catch(() => {});
      setNueva(null); cargar();
    } catch (e) { flash(e.message || "No se ha podido crear", "warn"); } finally { setBusy(false); }
  };
  const reenviar = async (p) => {
    const r = await crm.invitacionEnviar(p.acceso);
    const m = r?.ok ? "enviado" : r?.motivo;
    flash(CORREO[m] || "No se ha podido enviar el correo", m === "enviado" ? undefined : "warn"); cargar();
  };
  const anular = async (p) => {
    if (!window.confirm(`¿Anular la invitación de ${p.nombre}? Sus entradas dejarán de valer en la puerta.`)) return;
    try { await crm.invitacionAnular(p.id); flash("Invitación anulada"); cargar(); } catch (e) { flash(e.message, "warn"); }
  };
  const copiar = async (texto, ok = "Enlace copiado") => { try { await navigator.clipboard.writeText(texto); flash(ok); } catch { window.prompt("Copia el enlace", texto); } };
  const wa = (p) => `https://wa.me/?text=${encodeURIComponent(`¡Hola, ${String(p.nombre).split(" ")[0]}! Tienes una invitación para ${evSel.name}. Aquí está tu entrada con el QR para entrar: ${enlaceDe(p.acceso)}`)}`;

  const activas = (lista || []).filter(p => p.estado === "invitacion");
  const nEntradas = activas.reduce((n, p) => n + p.entradas.filter(x => x.estado === "valida").length, 0);

  if (conVenta && !eventos.length) return (
    <div style={{ ...C.panel, ...C.empty }}>Para invitar, primero activa la venta online de un evento (en «Eventos»). Las invitaciones usan sus tipos de entrada y su QR.</div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...C.panel, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <Field l="Evento" mb={0}>
            <select value={eventoId} onChange={e => setEventoId(e.target.value)} style={{ ...C.input, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {eventos.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </Field>
        </div>
        <button onClick={() => abrir()} disabled={!tramos.length} style={{ ...C.btnPrimary, minHeight: 48, flex: isMobile ? "1 1 100%" : "0 0 auto" }}><Icon n="plus" s={16} w={2.4} />Nueva invitación</button>
      </div>
      {!tramos.length && lista && <div style={{ ...C.panel, color: "var(--amber)", fontWeight: 700 }}>Este evento aún no tiene tipos de entrada. Créalos en «Eventos › Entradas».</div>}

      <Seccion id="inv-lista" i="ticket" t="Invitaciones" sub="Entradas nominativas a 0 € con QR de un solo uso. No cuentan como ventas." total={`${nEntradas} ${nEntradas === 1 ? "entrada" : "entradas"}`}>
        {!lista ? <div style={{ color: "var(--muted)" }}>Cargando…</div>
          : !lista.length ? <div style={C.empty}>Aún no hay invitaciones en este evento.</div>
          : lista.map(p => { const val = p.entradas.filter(x => x.estado === "valida").length; const anulada = p.estado !== "invitacion"; return (
            <div key={p.id} style={{ ...C.row, alignItems: "flex-start", flexWrap: "wrap", opacity: anulada ? .55 : 1 }}>
              <span style={{ flex: "1 1 220px", minWidth: 0 }}>
                <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: anulada ? "line-through" : "none" }}>{p.nombre}</b>
                <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)", marginTop: 2, overflowWrap: "anywhere" }}>
                  {p.email} · {p.entradas[0]?.tramo_nombre || ""} · {anulada ? p.entradas.length : val} {(anulada ? p.entradas.length : val) === 1 ? "entrada" : "entradas"} · {fechaCorta(p.creado_en)}{p.datos?.nota ? ` · ${p.datos.nota}` : ""}
                </span>
                <span style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  {anulada ? <Badge c="var(--red)">Anulada</Badge> : p.email_envios > 0 ? <Badge c="var(--green)"><Icon n="mail" s={11} />Enviada{p.email_envios > 1 ? ` ×${p.email_envios}` : ""}</Badge> : <Badge c="var(--amber)">Sin enviar por correo</Badge>}
                  {p.datos?.aforo === false && !anulada && <Badge>Fuera de aforo</Badge>}
                </span>
              </span>
              {!anulada && <span style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button onClick={() => copiar(enlaceDe(p.acceso))} style={C.btnSm}><Icon n="copy" s={14} />Enlace</button>
                <a href={wa(p)} target="_blank" rel="noopener noreferrer" style={{ ...C.btnSm, textDecoration: "none" }}><Icon n="whatsapp" s={14} />WhatsApp</a>
                <button onClick={() => reenviar(p)} style={C.btnSm}><Icon n="mail" s={14} />Reenviar</button>
                <button onClick={() => anular(p)} style={{ ...C.btnSm, color: "var(--red)" }}>Anular</button>
              </span>}
            </div>); })}
      </Seccion>

      {espera.length > 0 && (
        <Seccion id="inv-espera" i="clock" t="Lista de espera" sub="Gente que se apuntó cuando estaba agotado. Invítales o avísales si sacas más entradas." total={`${espera.reduce((n, x) => n + x.cantidad, 0)} entradas`}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <button onClick={() => copiar(espera.filter(x => !x.avisado_en).map(x => x.email).join(", "), "Correos copiados")} style={C.btnSm}><Icon n="copy" s={14} />Copiar correos sin avisar</button>
            <button onClick={() => {
              const filas = [["Nombre", "Correo", "Entradas", "Acepta novedades", "Apuntado", "Avisado"], ...espera.map(x => [x.nombre, x.email, x.cantidad, x.marketing ? "sí" : "no", new Date(x.creado_en).toLocaleString("es-ES"), x.avisado_en ? new Date(x.avisado_en).toLocaleString("es-ES") : ""])];
              const blob = new Blob(["\ufeff" + filas.map(f => f.map(c => String(c).replace(/[;\r\n]+/g, " ").replace(/^([=+\-@])/, "'$1")).join(";")).join("\n")], { type: "text/csv;charset=utf-8" });
              const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "lista-de-espera.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
            }} style={C.btnSm}><Icon n="file" s={14} />CSV</button>
            {espera.some(x => !x.avisado_en) && <button onClick={async () => { await crm.esperaAvisado(espera.filter(x => !x.avisado_en).map(x => x.id)); flash("Marcados como avisados"); cargar(); }} style={C.btnSm}><Icon n="check" s={14} />Marcar todos como avisados</button>}
          </div>
          {espera.map(x => (
            <div key={x.id} style={{ ...C.row, flexWrap: "wrap", opacity: x.avisado_en ? .6 : 1 }}>
              <span style={{ flex: "1 1 200px", minWidth: 0 }}>
                <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.nombre}</b>
                <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)", overflowWrap: "anywhere" }}>{x.email} · quiere {x.cantidad} · {fechaCorta(x.creado_en)}{x.avisado_en ? " · avisado" : ""}</span>
              </span>
              <span style={{ display: "flex", gap: 8 }}>
                <button onClick={() => abrir({ nombre: x.nombre, email: x.email, cantidad: Math.min(20, x.cantidad), esperaId: x.id })} disabled={!tramos.length} style={C.btnSm}><Icon n="mail" s={14} />Invitar</button>
                <a href={`mailto:${x.email}?subject=${encodeURIComponent(`Entradas para ${evSel.name}`)}&body=${encodeURIComponent(`¡Hola, ${x.nombre.split(" ")[0]}! Te apuntaste a la lista de espera de ${evSel.name}. Ya hay entradas disponibles: ${conVenta?.[eventoId]?.slug ? `${window.location.origin}/e/${conVenta[eventoId].slug}` : ""}`)}`} onClick={() => crm.esperaAvisado([x.id]).then(cargar).catch(() => {})} style={{ ...C.btnSm, textDecoration: "none" }}>Avisar</a>
                <button onClick={async () => { await crm.esperaBorrar(x.id); cargar(); }} aria-label={`Quitar a ${x.nombre} de la lista`} style={{ ...C.btnSm, width: 44, justifyContent: "center" }}><Icon n="trash" s={14} /></button>
              </span>
            </div>))}
        </Seccion>
      )}

      {nueva && (
        <Sheet title="Nueva invitación" onClose={() => setNueva(null)}
          footer={<button disabled={busy} onClick={crear} style={{ ...C.btnPrimary, width: "100%", minHeight: 50 }}><Icon n="mail" s={16} />{busy ? "Creando…" : `Crear y enviar ${nueva.cantidad > 1 ? `${nueva.cantidad} entradas` : "la entrada"}`}</button>}>
          <div style={{ fontSize: 13.5, color: "var(--muted)", marginBottom: 14, lineHeight: 1.45 }}>{evSel.name}. Se crea una entrada a 0 € con su QR y se envía al correo. También podrás copiar el enlace o mandarlo por WhatsApp.</div>
          <Field l="Tipo de entrada">
            <select value={nueva.tramoId} onChange={e => setNueva(x => ({ ...x, tramoId: e.target.value }))} style={C.input}>
              {tramos.map(t => <option key={t.id} value={t.id}>{t.nombre}{t.cantidad != null ? ` · quedan ${Math.max(0, t.cantidad - (t.vendidas || 0))}` : ""}</option>)}
            </select>
          </Field>
          <Field l="Nombre y apellidos"><input style={C.input} value={nueva.nombre} maxLength={120} autoComplete="off" onChange={e => setNueva(x => ({ ...x, nombre: e.target.value }))} /></Field>
          <Field l="Correo electrónico"><input style={C.input} type="email" inputMode="email" autoComplete="off" value={nueva.email} maxLength={160} onChange={e => setNueva(x => ({ ...x, email: e.target.value }))} /></Field>
          <Field l="Número de entradas">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button type="button" aria-label="Una menos" disabled={nueva.cantidad <= 1} onClick={() => setNueva(x => ({ ...x, cantidad: Math.max(1, x.cantidad - 1) }))} style={{ ...C.btnSm, width: 48, minHeight: 48, justifyContent: "center", fontSize: 20 }}>−</button>
              <b style={{ minWidth: 36, textAlign: "center", fontSize: 20, fontVariantNumeric: "tabular-nums" }}>{nueva.cantidad}</b>
              <button type="button" aria-label="Una más" disabled={nueva.cantidad >= 20} onClick={() => setNueva(x => ({ ...x, cantidad: Math.min(20, x.cantidad + 1) }))} style={{ ...C.btnSm, width: 48, minHeight: 48, justifyContent: "center", fontSize: 20 }}>+</button>
              {nueva.cantidad > 1 && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Todas a su nombre (1/{nueva.cantidad}, 2/{nueva.cantidad}…)</span>}
            </div>
          </Field>
          <label style={{ ...C.row, cursor: "pointer", gap: 12, minHeight: 48 }}>
            <span style={{ flex: 1 }}><b style={{ display: "block" }}>Cuenta para el aforo</b><span style={{ fontSize: 12.5, color: "var(--muted)" }}>Resta del total de ese tipo de entrada. Quítalo para invitaciones fuera de aforo (staff, prensa…).</span></span>
            <input type="checkbox" checked={nueva.aforo} onChange={e => setNueva(x => ({ ...x, aforo: e.target.checked }))} style={{ width: 22, height: 22 }} />
          </label>
          <Field l="Nota interna (opcional)"><input style={C.input} maxLength={200} placeholder="Prensa, artista, patrocinador…" value={nueva.nota} onChange={e => setNueva(x => ({ ...x, nota: e.target.value }))} /></Field>
        </Sheet>
      )}

      {hecha && (
        <Sheet title="Invitación creada" onClose={() => setHecha(null)}
          footer={<button onClick={() => setHecha(null)} style={{ ...C.btnPrimary, width: "100%", minHeight: 48 }}>Hecho</button>}>
          <div style={{ fontSize: 14, marginBottom: 14, lineHeight: 1.45 }}>{hecha.enviado ? <>Enviada a <b>{hecha.email}</b>.</> : <>Creada para <b>{hecha.nombre}</b>. No ha salido por correo: mándale el enlace.</>}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => copiar(enlaceDe(hecha.acceso))} style={{ ...C.btnSm, minHeight: 48, flex: "1 1 140px", justifyContent: "center" }}><Icon n="copy" s={15} />Copiar enlace</button>
            <a href={wa(hecha)} target="_blank" rel="noopener noreferrer" style={{ ...C.btnSm, minHeight: 48, flex: "1 1 140px", justifyContent: "center", textDecoration: "none" }}><Icon n="whatsapp" s={15} />Enviar por WhatsApp</a>
          </div>
        </Sheet>
      )}
    </div>
  );
}

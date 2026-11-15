// ===================== MIS PLANOS (hoja dentro del editor) =====================
// Guardar el plano actual con un nombre («Sala Aula 69», «Carpa San Juan»…), cargar uno guardado
// en este evento, renombrar o borrar. El número de planos guardados depende del plan.
import React, { useEffect, useState } from "react";
import { Capa } from "../Capa";
import { supabase } from "../supabase";
import { useAcceso, limiteDe, cambiarPlan } from "../cuenta";
import { listarPlanos, guardarPlano, renombrarPlano, borrarPlano } from "./biblioteca";

const K = {
  btn: { minHeight: 44, padding: "0 13px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontWeight: 800, fontSize: 14, cursor: "pointer" },
  input: { width: "100%", boxSizing: "border-box", minHeight: 46, padding: "0 12px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--text)", fontSize: 16, font: "inherit" },
};
const euros = (v) => Number(v).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
const cuando = (iso) => { try { return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }); } catch { return ""; } };

export function MisPlanos({ planoActual, reservados, nombreSugerido = "", onCargar, onCerrar }) {
  const acc = useAcceso();
  const limite = limiteDe(acc, "planos");
  const [lista, setLista] = useState(null);
  const [nombre, setNombre] = useState(nombreSugerido);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [editando, setEditando] = useState(null);   // { id, nombre }
  const [superior, setSuperior] = useState(null);   // nivel superior contratable (Premium)
  const cargar = () => listarPlanos().then(setLista).catch(e => { setLista([]); setMsg({ t: e.message, mal: true }); });
  useEffect(() => { cargar(); supabase.rpc("ticket_planes_disponibles").then(({ data }) => setSuperior((data || []).find(x => x.id !== "pro" && x.limites?.planos == null) || null), () => {}); }, []);
  const lleno = limite != null && lista && lista.length >= limite;
  const existente = lista?.find(x => x.nombre.trim().toLowerCase() === nombre.trim().toLowerCase());
  const hacer = async (fn, ok) => { setBusy(true); setMsg(null); try { await fn(); if (ok) setMsg({ t: ok }); await cargar(); } catch (e) { setMsg({ t: e?.mostrar ? e.message : "No se ha podido completar", mal: true }); } setBusy(false); };
  const guardar = () => {
    if (!nombre.trim()) { setMsg({ t: "Ponle un nombre al plano.", mal: true }); return; }
    if (existente && !window.confirm(`Ya tienes «${existente.nombre}». ¿Sustituirlo por este plano?`)) return;
    hacer(() => guardarPlano(nombre, planoActual, reservados, existente?.id || null), existente ? `✓ «${nombre.trim()}» actualizado` : `✓ Guardado en Mis planos`);
  };
  const subir = async () => {
    if (!window.confirm(`¿Pasar a ${superior.nombre} por ${euros(superior.precio_mes)} al mes? Este mes solo se cobra la diferencia.`)) return;
    setBusy(true); setMsg(null);
    try { await cambiarPlan(superior.id); setMsg({ t: `✓ Ya tienes ${superior.nombre}: guarda todos los planos que quieras.` }); }
    catch (e) { setMsg({ t: e?.mostrar ? e.message : "No se ha podido cambiar de plan", mal: true }); }
    setBusy(false);
  };

  return (<Capa>
    <div onClick={() => !busy && onCerrar()} style={{ position: "fixed", inset: 0, zIndex: 170, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "end center" }}>
      <div role="dialog" aria-modal="true" aria-label="Mis planos" onClick={e => e.stopPropagation()} data-scroll
        style={{ width: "100%", maxWidth: 560, maxHeight: "92dvh", overflow: "auto", overscrollBehavior: "contain", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "22px 22px 0 0", padding: "16px 16px calc(18px + env(safe-area-inset-bottom))", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1 }}><div style={{ fontWeight: 900, fontSize: 19 }}>📚 Mis planos</div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Guardados en tu cuenta para usarlos en otros eventos.{limite != null && lista ? ` ${lista.length} de ${limite}.` : ""}</div></div>
          <button type="button" onClick={onCerrar} disabled={busy} aria-label="Cerrar" style={{ ...K.btn, width: 44, padding: 0 }}>✕</button>
        </div>

        {planoActual && <div style={{ marginTop: 14, padding: 12, borderRadius: 14, border: "1px solid var(--line)", background: "var(--surface2)" }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Guardar el plano de este evento</div>
          <input value={nombre} maxLength={60} onChange={e => setNombre(e.target.value)} placeholder="Ej.: Sala Aula 69" aria-label="Nombre del plano" style={K.input} />
          {lleno && !existente
            ? <div style={{ fontSize: 13.5, marginTop: 8 }}>
                <b>Has llegado a {limite} planos guardados.</b> Sustituye uno poniendo su mismo nombre{superior ? <>, o pasa a <b>{superior.nombre}</b> para guardar todos los que quieras.</> : ". Pronto habrá un plan superior para guardar más."}
                {superior && <button type="button" disabled={busy} onClick={subir} style={{ ...K.btn, width: "100%", marginTop: 8, borderColor: "var(--accent)", color: "var(--accent)" }}>Pasar a {superior.nombre} · {euros(superior.precio_mes)}/mes</button>}
              </div>
            : <button type="button" disabled={busy} onClick={guardar} style={{ ...K.btn, width: "100%", marginTop: 8, background: "var(--accent)", border: "none", color: "#fff" }}>{existente ? `Sustituir «${existente.nombre}»` : "Guardar en Mis planos"}</button>}
        </div>}

        {msg && <div role="status" style={{ marginTop: 10, fontSize: 14, fontWeight: 700, color: msg.mal ? "var(--red)" : "var(--green)" }}>{msg.t}</div>}

        <div style={{ fontWeight: 800, marginTop: 16, marginBottom: 6 }}>Planos guardados</div>
        {lista === null && <div style={{ color: "var(--muted)", fontSize: 14 }}>Cargando…</div>}
        {lista && !lista.length && <div style={{ color: "var(--muted)", fontSize: 14 }}>Aún no tienes planos guardados.</div>}
        <div style={{ display: "grid", gap: 8 }}>
          {(lista || []).map(x => { const mesas = x.plano.elementos.filter(e => e.tipo === "mesa").length; return (
            <div key={x.id} style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 12 }}>
              {editando?.id === x.id
                ? <div style={{ display: "flex", gap: 8 }}><input value={editando.nombre} maxLength={60} autoFocus onChange={e => setEditando({ ...editando, nombre: e.target.value })} style={{ ...K.input, flex: 1 }} aria-label="Nuevo nombre" />
                    <button type="button" disabled={busy} onClick={() => hacer(() => renombrarPlano(x.id, editando.nombre), "✓ Renombrado").then(() => setEditando(null))} style={K.btn}>OK</button></div>
                : <div style={{ fontWeight: 900, fontSize: 16 }}>{x.nombre}</div>}
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{String(x.plano.ancho).replace(".", ",")} × {String(x.plano.largo).replace(".", ",")} m · {mesas} {mesas === 1 ? "mesa" : "mesas"} · {cuando(x.actualizado_en)}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                <button type="button" disabled={busy} onClick={async () => { setBusy(true); setMsg({ t: "Preparando el plano y sus mesas…" }); try { await onCargar(x); } catch { setMsg({ t: "No se ha podido cargar el plano.", mal: true }); } setBusy(false); }} style={{ ...K.btn, background: "var(--accent)", border: "none", color: "#fff" }}>Usar en este evento</button>
                <button type="button" disabled={busy} onClick={() => setEditando({ id: x.id, nombre: x.nombre })} style={K.btn}>Renombrar</button>
                <button type="button" disabled={busy} onClick={() => window.confirm(`¿Borrar «${x.nombre}» de Mis planos? Los eventos que ya lo usan no cambian.`) && hacer(() => borrarPlano(x.id), "Plano borrado")} style={{ ...K.btn, color: "var(--red)" }}>Borrar</button>
              </div>
            </div>); })}
        </div>
      </div>
    </div>
  </Capa>);
}

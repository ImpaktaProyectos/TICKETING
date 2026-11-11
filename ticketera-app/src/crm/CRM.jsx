// ===================== TIXFAST · MODO CRM (fase 1: ingresos y socios) =====================
// Separado del TPV: se carga solo al abrirlo y solo escribe en tablas ticket_crm_*.
// Lo vendido en las barras se LEE de las ventas que ya tiene la app (nunca se copia ni se modifica).
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as crm from "./crmdb";
import { money, r2, hoy, fechaCorta, parseImporte, isInvite, useIsMobile, Dot, C, Icon, Avatar, Head, Tile, TEMAS, useTema } from "./ui";
import { Gastos, totalesGastos } from "./Gastos";
import { Liquidacion, calcularLiquidacion } from "./Liquidacion";
import { GRUPOS_VISTA, grupoVista, catInfo, fuenteAuto, setCategorias, TICKETERA_CAT } from "./categorias";
import { fiscalEvento } from "./fiscal";
import { Dashboard } from "./Dashboard";
import { Ingresos, IngresoForm, esExterno } from "./Ingresos";
import { VentaEntradasForm } from "./DineroEntradas";
import { Ajustes, ImportarCSV } from "./Ajustes";
import { Prevision } from "./Prevision";
import { Entradas } from "./Entradas";
import { Stock } from "./Stock";
import { useReservados, resCfg } from "../reservados";

const COLORES = ["#ff5a3c", "#a855f7", "#3b82f6", "#22d3a6", "#ffb400", "#ec4899", "#14b8a6", "#f97316"];

// Menú del CRM agrupado (opción A). Las pestañas y lo que hacen no cambian.
const NAV_GRUPOS = [
  ["Resumen", [["dashboard", "chart", "Panel"]]],
  ["Dinero", [["ingresos", "wallet", "Ingresos"], ["gastos", "receipt", "Gastos"], ["entradas", "ticket", "Entradas"], ["liquidacion", "scale", "Liquidación"]]],
  ["Planificar", [["prevision", "trend", "Previsión"], ["stock", "box", "Stock"]]],
  ["Equipo", [["socios", "users", "Socios"]]],
];
const NAV_TODO = NAV_GRUPOS.flatMap(g => g[1]);
const NAV_MOVIL = NAV_TODO.filter(n => ["dashboard", "ingresos", "gastos", "entradas"].includes(n[0]));
const NAV_MAS = NAV_TODO.filter(n => !NAV_MOVIL.includes(n));

export default function CRM({ events, sales, gastosCaja = [], ev, onSelectEvent, onExit, flash }) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState("dashboard");
  const [data, setData] = useState(null);      // { socios, participacion, ingresos, fuentes }
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editVenta, setEditVenta] = useState(null);
  const [editIng, setEditIng] = useState(null); // ingreso en edición (o {} para nuevo)
  const [ajSeccion, setAjSeccion] = useState("conexiones");
  const [volverA, setVolverA] = useState("dashboard");
  const [importar, setImportar] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const autoSync = useRef(new Set());

  const cargar = async () => {
    setError(null);
    try { const d = await crm.loadCRM(ev.id); setCategorias(d.ajustes?.categorias); setData(d); }
    catch (e) { setError(navigator.onLine ? "No se han podido cargar los datos del CRM." : "El CRM necesita conexión a internet."); }
  };
  useEffect(() => { setData(null); if (ev?.id) cargar(); }, [ev?.id]);
  const run = async (fn, okMsg) => {
    if (busy) return false;
    setBusy(true);
    try { await fn(); if (okMsg) flash(okMsg); await cargar(); return true; }
    catch (e) { flash(e?.mostrar ? e.message : navigator.onLine ? "No se ha podido guardar" : "Sin conexión: no se ha guardado", "warn"); return false; }
    finally { setBusy(false); }
  };
  const aviso = (msg) => { const e = new Error(msg); e.mostrar = true; return e; };
  const abrirAjustes = (sec) => { if (tab !== "ajustes") setVolverA(tab); setAjSeccion(sec || "conexiones"); setTab("ajustes"); };

  // ---- Ticketera: sincronizar ventas (el servidor habla con Fourvenues) ----
  const sincronizar = async (eventoId = ev.id, silencioso = false) => {
    if (sincronizando) return false;
    setSincronizando(true);
    try {
      const r = await crm.ticketera("sincronizar", { evento_id: eventoId, categoria: TICKETERA_CAT });
      if (!silencioso) flash(`Fourvenues: ${r.entradas} entradas · ${money(r.total)}`);
      await cargar(); return true;
    } catch (e) { if (!silencioso) flash(e.message || "No se ha podido sincronizar", "warn"); await cargar(); return false; }
    finally { setSincronizando(false); }
  };
  const vinculo = (data?.vinculos || []).find(v => v.eventoId === ev.id) || null;
  // Al abrir un evento vinculado, se actualiza solo si hace más de 10 minutos (una vez por sesión)
  useEffect(() => {
    if (!data || !vinculo || !data.conexion || autoSync.current.has(ev.id)) return;
    autoSync.current.add(ev.id);
    if (!vinculo.ultimaSync || Date.now() - new Date(vinculo.ultimaSync).getTime() > 10 * 60000) sincronizar(ev.id, true);
  }, [data, ev.id]);

  // ---- Barras del TPV (solo lectura, en directo) ----
  const resv = useReservados(ev.id);
  const barras = useMemo(() => {
    const ss = sales.filter(s => s.eventId === ev.id);
    const filas = ev.puntos.map(p => {
      const v = ss.filter(s => s.puntoId === p.id && !s.voided && !isInvite(s));
      const inv = ss.filter(s => s.puntoId === p.id && !s.voided && isInvite(s)).length;
      return { punto: p, fuente: (data?.fuentes || {})[p.id] || fuenteAuto(p), tickets: v.length, total: r2(v.reduce((t, s) => t + s.price, 0)),
        efectivo: r2(v.filter(s => s.pago === "efectivo").reduce((t, s) => t + s.price, 0)), tarjeta: r2(v.filter(s => s.pago === "tarjeta").reduce((t, s) => t + s.price, 0)), invitaciones: inv };
    }).filter(b => !b.punto.archivado || b.tickets > 0);
    // Señales de reservados: se cobran antes de la fiesta (las tiene quien las cobró) y en taquilla ya se descuentan,
    // así que aquí se suman para que el total del reservado cuadre. Van al mismo tipo que la taquilla de reservados.
    const cfgR = resCfg(ev);
    const conSenal = (resv.reservados || []).filter(r => r.estado !== "libre" && Number(r.senal) > 0);
    if (conSenal.length) {
      const pRes = ev.puntos.find(p => cfgR.puntos.includes(p.id));
      const por = (m) => r2(conSenal.filter(r => r.senalMetodo === m).reduce((t, r) => t + Number(r.senal), 0));
      const quien = {};
      conSenal.forEach(r => { const p = cfgR.promotores.find(x => x.id === r.promotorId); const k = p?.nombre || ""; quien[k] = r2((quien[k] || 0) + Number(r.senal)); });
      filas.push({ punto: { id: "__senales_reservados", name: "Señales de reservados" }, senal: true, fuente: pRes ? ((data?.fuentes || {})[pRes.id] || fuenteAuto(pRes)) : "otros",
        tickets: conSenal.length, total: r2(conSenal.reduce((t, r) => t + Number(r.senal), 0)), efectivo: por("efectivo"), tarjeta: por("tarjeta"), bizum: por("bizum"), transferencia: por("transferencia"),
        invitaciones: 0, quien: Object.entries(quien).map(([nombre, v]) => ({ nombre, v })) });
    }
    return filas;
  }, [sales, ev, data?.fuentes, resv.reservados]);

  const socios = data?.socios || [];
  const socioById = (id) => socios.find(s => s.id === id);
  const ingresos = data?.ingresos || [];

  // ---- Totales ----
  const T = useMemo(() => {
    const porGrupo = Object.fromEntries(GRUPOS_VISTA.map(g => [g.k, 0]));
    barras.forEach(b => { porGrupo.tpv += b.total; });
    ingresos.forEach(i => { const g = grupoVista(catInfo(i.categoria).g); porGrupo[g] += i.importe; });
    const tpv = r2(barras.reduce((t, b) => t + b.total, 0));
    const ticketera = r2(ingresos.filter(esExterno).reduce((t, i) => t + i.importe, 0));
    const manual = r2(ingresos.filter(i => !esExterno(i)).reduce((t, i) => t + i.importe, 0));
    const pendiente = r2(ingresos.filter(i => i.estado === "pendiente").reduce((t, i) => t + i.importe, 0));
    const enSocios = {};
    ingresos.filter(i => i.cobradoPor && !i.entregado && i.estado === "cobrado").forEach(i => { enSocios[i.cobradoPor] = r2((enSocios[i.cobradoPor] || 0) + i.importe); });
    Object.keys(porGrupo).forEach(k => { porGrupo[k] = r2(porGrupo[k]); });
    return { porGrupo, tpv, ticketera, manual, pendiente, total: r2(tpv + ticketera + manual), enSocios };
  }, [barras, ingresos, data?.ajustes]);
  // Comisiones e IVA (según Ajustes) → entran como gastos automáticos
  const fiscal = (ajustes) => fiscalEvento({ ev, sales, ingresos, gastos: data?.gastos || [], fuentes: data?.fuentes, ajustes, senales: barras.find(b => b.senal)?.total || 0 });
  const F = useMemo(() => fiscal(data?.ajustes), [ev, sales, ingresos, data?.gastos, data?.fuentes, data?.ajustes]);
  const G = useMemo(() => totalesGastos(ev, data?.gastos || [], gastosCaja, F.auto), [ev, data?.gastos, gastosCaja, F]);
  const senalesQuien = useMemo(() => barras.find(b => b.senal)?.quien || [], [barras]);
  const L = useMemo(() => calcularLiquidacion({ ev, tpv: T.tpv, ingresos, G, participacion: data?.participacion || [], socios, senales: senalesQuien }), [ev, T.tpv, ingresos, G, data?.participacion, socios, senalesQuien]);

  const [tema, cambiarTema] = useTema();
  // Las variables de color del tema se aplican a todo el CRM (y a sus ventanas, que cuelgan de aquí)
  const [mas, setMas] = useState(false);
  const irA = (k) => { setMas(false); if (k === "ajustes") abrirAjustes(); else setTab(k); };
  const titulo = (NAV_TODO.find(n => n[0] === tab) || [null, null, "Ajustes"])[2];
  const fechaEv = (() => { try { const d = new Date(ev.startsAt || (ev.date + "T12:00:00")); return d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" }); } catch { return ""; } })();
  const subEv = [fechaEv, ev.venue].filter(Boolean).join(" · ");
  // Opción A: barra lateral clara agrupada (ordenador) / barra inferior con «Más» (móvil). Solo cambia el marco.
  const wrap = { position: "absolute", inset: 0, overflow: "hidden", display: "flex", flexDirection: isMobile ? "column" : "row", ...TEMAS[tema], background: "var(--bg)", color: "var(--text)" };
  const navBtn = (on) => ({ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 10px", borderRadius: 10, border: "none", cursor: "pointer", textAlign: "left", font: "inherit", fontSize: 14.5, fontWeight: on ? 800 : 650, background: on ? "color-mix(in srgb, var(--accent) 13%, transparent)" : "transparent", color: on ? "var(--accent)" : "var(--text)" });
  const enMas = NAV_MAS.some(n => n[0] === tab) || tab === "ajustes";
  return (
    <div style={wrap}>
      {!isMobile && (
        <aside aria-label="Menú del CRM" style={{ width: 248, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16, background: "var(--surface)", borderRight: "1px solid var(--line)", padding: "max(18px, env(safe-area-inset-top)) 14px 16px", boxSizing: "border-box", overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 6px" }}>
            <img src="/brand/tixfast_isotipo_app.svg" alt="" width={32} height={32} style={{ flexShrink: 0 }} />
            <div style={{ fontWeight: 900, fontSize: 16, letterSpacing: -0.2 }}>TIXFAST <span style={{ color: "var(--muted)", fontWeight: 700 }}>CRM</span></div>
          </div>
          <label style={{ display: "block", background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 12, padding: "9px 10px 10px" }}>
            <span style={{ display: "block", fontSize: 11, fontWeight: 800, color: "var(--muted)", letterSpacing: 1, textTransform: "uppercase", padding: "0 2px" }}>Evento</span>
            <select value={ev.id} onChange={e => onSelectEvent(e.target.value)} aria-label="Evento" style={{ width: "100%", background: "transparent", border: "none", color: "var(--text)", fontWeight: 900, fontSize: 14.5, padding: "2px 0", outline: "none", cursor: "pointer" }}>
              {events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            {subEv && <span style={{ display: "block", fontSize: 12, color: "var(--muted)", padding: "0 2px", textTransform: "capitalize" }}>{subEv}</span>}
          </label>
          <nav aria-label="Secciones del CRM" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {NAV_GRUPOS.map(([g, items]) => (
              <div key={g} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", letterSpacing: 1, textTransform: "uppercase", padding: "0 10px 4px" }}>{g}</div>
                {items.map(([k, ico, l]) => <button key={k} onClick={() => irA(k)} aria-current={tab === k ? "page" : undefined} style={navBtn(tab === k)}><Icon n={ico} s={18} c="currentColor" />{l}</button>)}
              </div>))}
          </nav>
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 2, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            <button onClick={() => (tab === "ajustes" ? setTab(volverA) : abrirAjustes())} aria-current={tab === "ajustes" ? "page" : undefined} style={navBtn(tab === "ajustes")}><Icon n="gear" s={18} c="currentColor" />Ajustes</button>
            <button onClick={cambiarTema} role="switch" aria-checked={tema === "claro"} style={navBtn(false)}><Icon n={tema === "claro" ? "moon" : "sun"} s={18} c="currentColor" />{tema === "claro" ? "Modo oscuro" : "Modo claro"}</button>
            <button onClick={onExit} style={{ ...navBtn(false), color: "var(--accent)", fontWeight: 800 }}>← Volver al TPV</button>
          </div>
        </aside>
      )}

      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>   {/* minHeight 0: el contenido largo hace scroll dentro y la barra de abajo no se sale de la pantalla */}
        {isMobile && (
          <header style={{ ...C.head, flexDirection: "column", alignItems: "stretch", gap: 8, padding: "max(10px, env(safe-area-inset-top)) 12px 10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <img src="/brand/tixfast_isotipo_app.svg" alt="TIXFAST" width={30} height={30} style={{ flexShrink: 0 }} />
              <select value={ev.id} onChange={e => onSelectEvent(e.target.value)} style={C.headSelect} aria-label="Evento">
                {events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <button onClick={onExit} style={C.backBtn}>← TPV</button>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, padding: "0 2px" }}>
              <h1 style={{ margin: 0, fontSize: 21, fontWeight: 900, letterSpacing: -0.3 }}>{titulo}</h1>
              {subEv && <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700, textTransform: "capitalize", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{subEv}</span>}
            </div>
          </header>
        )}

      <main style={{ flex: 1, overflow: "auto", padding: isMobile ? 12 : "26px 34px 40px", WebkitOverflowScrolling: "touch" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>
          {!isMobile && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 700, textTransform: "capitalize" }}>{ev.name}{subEv ? ` · ${subEv}` : ""}</div>
              <h1 style={{ margin: "4px 0 0", fontSize: 28, fontWeight: 900, letterSpacing: -0.5 }}>{titulo}</h1>
            </div>
          )}
          {error && <div style={{ ...C.panel, borderColor: "var(--amber)", color: "var(--amber)", fontWeight: 700, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}><span style={{ display: "flex", alignItems: "center", gap: 8 }}><Icon n="alert" s={18} />{error}</span><button onClick={cargar} style={C.ghost}>Reintentar</button></div>}
          {!data && !error && <Esqueleto />}
          {data && tab === "dashboard" && (
            <Dashboard ev={ev} events={events} sales={sales} gastosCaja={gastosCaja} ajustes={data.ajustes} onSelectEvent={onSelectEvent} refreshKey={data} />
          )}
          {data && tab === "ingresos" && (
            <Ingresos ev={ev} T={T} F={F} barras={barras} ingresos={ingresos} socios={socios} socioById={socioById} isMobile={isMobile}
              conexion={data.conexion} vinculo={vinculo} sincronizando={sincronizando}
              onSync={() => sincronizar(ev.id)} onImportar={() => setImportar(true)} onAjustes={() => abrirAjustes("conexiones")}
              onNuevo={() => setEditIng({})} onEditar={(i) => setEditIng(i)} onVentaEntradas={(i) => setEditVenta(i)}
              onFuente={(pid, f) => run(() => crm.setFuentePunto(pid, f), "Tipo de ingreso actualizado")}
              onEntregar={(socioId) => run(() => crm.setEntregado(ingresos.filter(i => i.cobradoPor === socioId && !i.entregado && i.estado === "cobrado").map(i => i.id), true), "Marcado como entregado")} />
          )}
          {data && tab === "gastos" && (
            <Gastos ev={ev} events={events} gastos={data.gastos} G={G} F={F} onAjustes={() => abrirAjustes("fiscal")} socios={socios} socioById={socioById} ingresosTotal={T.total} isMobile={isMobile} busy={busy}
              onSave={(x) => run(() => crm.saveGasto({ ...x, eventoId: ev.id }), x.id ? "Gasto actualizado" : "Gasto añadido")}
              onDelete={(x) => run(() => crm.deleteGasto(x.id), "Gasto borrado")}
              onCopiar={(desde) => run(async () => { const nn = await crm.copiarPresupuesto(desde.id, ev.id); if (!nn) throw new Error("vacío"); }, `Presupuesto de ${desde.name} copiado`)} />
          )}
          {data && tab === "entradas" && (
            <Entradas ev={ev} events={events} onSelectEvent={onSelectEvent} flash={flash} ingresos={ingresos} barras={barras} onVentaEntradas={(i) => setEditVenta(i)} onEditarIngreso={(i) => setEditIng(i)} />
          )}
          {data && tab === "prevision" && (
            <Prevision ev={ev} events={events} ingresos={ingresos} gastos={data.gastos} G={G} F={F} ajustes={data.ajustes || {}}
              vinculo={vinculo} conexion={data.conexion} sincronizando={sincronizando} flash={flash}
              onSync={() => sincronizar(ev.id)} onIrGastos={() => setTab("gastos")}
              onGuardarDefecto={async (pv) => { await crm.saveAjustes({ ...(data.ajustes || {}), prevision: pv }); await cargar(); }} />
          )}
          {data && tab === "stock" && (
            <Stock ev={ev} sales={sales} ajustes={data.ajustes || {}} flash={flash} onRecargarCRM={cargar}
              onGuardarAjustes={async (datos) => { await crm.saveAjustes(datos); await cargar(); }} />
          )}
          {data && tab === "liquidacion" && (
            <Liquidacion L={L} guardada={data.liquidacion} busy={busy}
              onIrSocios={() => setTab("socios")} onIrIngresos={() => setTab("ingresos")}
              onCerrar={(datos) => run(() => crm.cerrarLiquidacion(ev.id, datos), "Liquidación cerrada")}
              onReabrir={() => run(() => crm.reabrirLiquidacion(ev.id), "Liquidación reabierta")}
              onMarcarPagado={(socioId, v) => run(() => crm.actualizarLiquidacion(ev.id, { ...data.liquidacion.datos, filas: data.liquidacion.datos.filas.map(f => f.socioId === socioId ? { ...f, pagado: v } : f) }), v ? "Marcado como hecho" : "Desmarcado")} />
          )}
          {data && tab === "ajustes" && (
            <Ajustes ev={ev} events={events} ajustes={data.ajustes || {}} conexion={data.conexion} vinculos={data.vinculos || []} busy={busy || sincronizando}
              seccion={ajSeccion} setSeccion={setAjSeccion} preview={fiscal} onVolver={() => setTab(volverA)}
              onGuardarAjustes={(datos) => run(() => crm.saveAjustes(datos), "Ajustes guardados")}
              onRenombrar={(ambito, viejo, nuevo) => run(() => crm.renombrarCategoria(ambito, viejo, nuevo))}
              onGuardarClave={async (entorno, clave) => {
                const ok = await run(async () => { try { await crm.guardarConexion(entorno, clave); } catch (e) { throw aviso("No se ha podido guardar la clave. Revisa que esté completa."); } });
                if (!ok) return false;
                try { await crm.ticketera("probar"); flash("Conectado con Fourvenues"); } catch (e) { flash(e.message, "warn"); }
                await cargar(); return true;
              }}
              onProbar={() => run(async () => { try { await crm.ticketera("probar"); } catch (e) { throw aviso(e.message); } }, "La conexión funciona")}
              onDesconectar={() => run(() => crm.borrarConexion(), "Fourvenues desconectado")}
              onCargarEventos={async () => (await crm.ticketera("eventos")).eventos}
              onVincular={async (eventoId, extId, extNombre) => { const ok = await run(() => crm.vincular(eventoId, extId, extNombre), "Evento vinculado"); if (ok) sincronizar(eventoId); return ok; }}
              onDesvincular={(eventoId) => run(() => crm.desvincular(eventoId), "Vínculo quitado")}
              onSync={(eventoId) => sincronizar(eventoId)}
              onImportar={() => setImportar(true)} />
          )}
          {data && tab === "socios" && (
            <Socios ev={ev} data={data} T={T} G={G} isMobile={isMobile} busy={busy}
              onGuardarSocio={(s) => run(() => crm.saveSocio(s), s.id ? "Socio actualizado" : "Socio añadido")}
              onActivo={(s, a) => run(() => crm.setSocioActivo(s.id, a), a ? "Socio reactivado" : "Socio quitado")}
              onReparto={(lista) => run(() => crm.saveParticipacion(ev.id, lista), "Reparto guardado")} />
          )}
        </div>
      </main>

        {isMobile && (
          <nav aria-label="Secciones del CRM" style={{ display: "flex", background: "var(--surface)", borderTop: "1px solid var(--line)", paddingBottom: "env(safe-area-inset-bottom)", flexShrink: 0 }}>
            {[...NAV_MOVIL, ["__mas", "dots", "Más"]].map(([k, ico, l]) => { const on = k === "__mas" ? enMas : tab === k; return (
              <button key={k} onClick={() => (k === "__mas" ? setMas(true) : irA(k))} aria-current={on && k !== "__mas" ? "page" : undefined} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "8px 2px 8px", background: "transparent", border: "none", cursor: "pointer", font: "inherit", fontSize: 11.5, fontWeight: on ? 800 : 650, color: on ? "var(--accent)" : "var(--muted)" }}>
                <Icon n={ico} s={21} c="currentColor" /><span style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l}</span>
              </button>); })}
          </nav>
        )}
      </div>

      {mas && (
        <div onClick={() => setMas(false)} style={{ ...C.modalWrap, alignItems: "flex-end" }}>
          <div role="dialog" aria-label="Más secciones" onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 520, background: "var(--surface)", borderRadius: "22px 22px 0 0", padding: "10px 14px", paddingBottom: "calc(14px + env(safe-area-inset-bottom))", boxSizing: "border-box" }}>
            <div style={{ width: 40, height: 4, borderRadius: 4, background: "var(--line)", margin: "4px auto 10px" }} />
            {[...NAV_MAS, ["ajustes", "gear", "Ajustes"]].map(([k, ico, l]) => <button key={k} onClick={() => irA(k)} style={{ ...navBtn(tab === k), padding: "13px 10px", fontSize: 15.5 }}><Icon n={ico} s={20} c="currentColor" />{l}</button>)}
            <button onClick={cambiarTema} role="switch" aria-checked={tema === "claro"} style={{ ...navBtn(false), padding: "13px 10px", fontSize: 15.5 }}><Icon n={tema === "claro" ? "moon" : "sun"} s={20} c="currentColor" />{tema === "claro" ? "Modo oscuro" : "Modo claro"}</button>
            <button onClick={() => setMas(false)} style={{ ...C.ghost, width: "100%", marginTop: 8 }}>Cerrar</button>
          </div>
        </div>
      )}

      {importar && <ImportarCSV ev={ev} busy={busy} onClose={() => setImportar(false)}
        onImportar={async (ticketera, grupos) => { const ok = await run(() => crm.importarCSV(ev.id, ticketera, TICKETERA_CAT, grupos), `Importadas las ventas de ${ticketera}`); if (ok) setImportar(false); }} />}
      {editVenta && <VentaEntradasForm ingreso={editVenta} socios={socios.filter(s => s.activo || s.id === editVenta.cobradoPor)} busy={busy}
        onClose={() => setEditVenta(null)}
        onSave={async (x) => { const ok = await run(() => crm.saveIngreso({ ...x, eventoId: ev.id }), x.id ? "Ventas actualizadas" : `${x.unidades} entradas añadidas`); if (ok) setEditVenta(null); }}
        onDelete={async (x) => { const ok = await run(() => crm.deleteIngreso(x.id), "Ventas borradas"); if (ok) setEditVenta(null); }} />}
      {editIng && <IngresoForm ev={ev} ingreso={editIng} socios={socios.filter(s => s.activo || s.id === editIng.cobradoPor)} usadas={ingresos.map(i => i.categoria)} busy={busy}
        onClose={() => setEditIng(null)}
        onSave={async (x) => { const ok = await run(() => crm.saveIngreso({ ...x, eventoId: ev.id }), x.id ? "Ingreso actualizado" : "Ingreso añadido"); if (ok) setEditIng(null); }}
        onDelete={async (x) => { const ok = await run(() => crm.deleteIngreso(x.id), "Ingreso borrado"); if (ok) setEditIng(null); }} />}
    </div>
  );
}

/* ===================== SOCIOS ===================== */
function Socios({ ev, data, T, G, isMobile, busy, onGuardarSocio, onActivo, onReparto }) {
  const activos = data.socios.filter(s => s.activo);
  const inactivos = data.socios.filter(s => !s.activo);
  const inicial = () => Object.fromEntries(data.participacion.map(p => [p.socioId, String(p.porcentaje).replace(".", ",")]));
  const [rep, setRep] = useState(inicial);
  useEffect(() => { setRep(inicial()); }, [data.participacion, ev.id]);
  const [nuevo, setNuevo] = useState({ nombre: "", telefono: "" });
  const [edit, setEdit] = useState(null);
  const [verInactivos, setVerInactivos] = useState(false);

  const participan = Object.keys(rep).filter(id => rep[id] != null && data.socios.some(s => s.id === id));
  const suma = r2(participan.reduce((t, id) => t + parseImporte(rep[id]), 0));
  const cambiado = JSON.stringify(Object.entries(rep).sort()) !== JSON.stringify(Object.entries(inicial()).sort());
  const toggle = (id) => setRep(r => { const x = { ...r }; if (x[id] != null) delete x[id]; else x[id] = "0"; return x; });
  const iguales = () => { const ids = participan.length ? participan : activos.map(s => s.id); if (!ids.length) return; const base = Math.floor(10000 / ids.length) / 100; const x = {}; ids.forEach((id, i) => { x[id] = String(i === ids.length - 1 ? r2(100 - base * (ids.length - 1)) : base).replace(".", ","); }); setRep(x); };
  const guardarReparto = () => onReparto(participan.map(id => ({ socioId: id, porcentaje: parseImporte(rep[id]) })));
  const color = () => COLORES[data.socios.length % COLORES.length];

  return (
    <div>
      {/* Reparto del evento */}
      <div style={{ ...C.panel, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Tile n="users" s={32} /><b style={{ fontSize: 15.5 }}>Socios en {ev.name}</b></div>
          <button onClick={iguales} disabled={!activos.length} style={C.btnSm}><Icon n="scale" s={15} />A partes iguales</button>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>Marca quién participa en este evento y con qué porcentaje. Puede cambiar de un evento a otro.</div>
        {activos.length === 0 && <div style={C.empty}>Primero añade los socios aquí abajo.</div>}
        {activos.map(s => { const on = rep[s.id] != null; const tiene = T.enSocios[s.id] || 0; const pago = (G?.pagadoSocio || {})[s.id] || 0; return (
          <div key={s.id} style={{ ...C.row, opacity: on ? 1 : .6 }}>
            <button onClick={() => toggle(s.id)} style={{ ...C.check, ...(on ? C.checkOn : {}) }} aria-label={on ? "Quitar del evento" : "Añadir al evento"}>{on ? <Icon n="check" s={16} w={2.8} c="#fff" style={{ margin: "auto" }} /> : null}</button>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800 }}><Avatar nombre={s.nombre} c={s.color} s={26} />{s.nombre}</span>
              {tiene > 0 && <span style={{ display: "block", fontSize: 12, color: "var(--amber)", fontWeight: 700, marginTop: 2 }}>Tiene {money(tiene)} del evento</span>}
              {pago > 0 && <span style={{ display: "block", fontSize: 12, color: "var(--blue)", fontWeight: 700, marginTop: 2 }}>Ha adelantado {money(pago)} de su bolsillo</span>}
            </span>
            {on && <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <input inputMode="decimal" value={rep[s.id]} onChange={e => setRep(r => ({ ...r, [s.id]: e.target.value.replace(/[^\d.,]/g, "").slice(0, 7) }))} style={{ ...C.input, width: 82, textAlign: "right", fontWeight: 900, fontSize: 16, padding: "8px 10px" }} aria-label={`Porcentaje de ${s.nombre}`} />
              <b style={{ color: "var(--muted)" }}>%</b></span>}
          </div>); })}
        {activos.length > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            <span style={{ fontWeight: 900, color: participan.length === 0 ? "var(--muted)" : Math.abs(suma - 100) < 0.01 ? "var(--green)" : "var(--amber)" }}>
              {participan.length === 0 ? "Nadie marcado" : Math.abs(suma - 100) < 0.01 ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon n="check" s={16} w={2.6} />Suma 100 %</span> : <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon n="alert" s={16} />Suma {String(suma).replace(".", ",")} % (debe ser 100 %)</span>}
            </span>
            <button onClick={guardarReparto} disabled={busy || !cambiado || (participan.length > 0 && Math.abs(suma - 100) >= 0.01)} style={{ ...C.primary, opacity: busy || !cambiado || (participan.length > 0 && Math.abs(suma - 100) >= 0.01) ? .45 : 1 }}>Guardar reparto</button>
          </div>
        )}
      </div>

      {/* Socios de la cuenta */}
      <div style={C.panel}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}><Tile n="user" c="#3b82f6" s={32} /><b style={{ fontSize: 15.5 }}>Socios de la cuenta</b></div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>Se crean una vez y se eligen en cada evento.</div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr auto", gap: 8, marginBottom: 12 }}>
          <input value={nuevo.nombre} maxLength={80} onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })} placeholder="Nombre del socio" style={C.input} onKeyDown={e => { if (e.key === "Enter" && nuevo.nombre.trim()) { onGuardarSocio({ ...nuevo, color: color() }); setNuevo({ nombre: "", telefono: "" }); } }} />
          <input value={nuevo.telefono} maxLength={30} inputMode="tel" onChange={e => setNuevo({ ...nuevo, telefono: e.target.value })} placeholder="Teléfono (opcional)" style={C.input} />
          <button disabled={!nuevo.nombre.trim() || busy} onClick={() => { onGuardarSocio({ ...nuevo, color: color() }); setNuevo({ nombre: "", telefono: "" }); }} style={{ ...C.btnPrimary, opacity: nuevo.nombre.trim() ? 1 : .45 }}><Icon n="plus" s={17} w={2.4} />Añadir</button>
        </div>
        {activos.map(s => (
          <div key={s.id} style={C.row}>
            {edit?.id === s.id ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", width: "100%" }}>
                <input autoFocus value={edit.nombre} maxLength={80} onChange={e => setEdit({ ...edit, nombre: e.target.value })} style={{ ...C.input, flex: "1 1 160px" }} />
                <input value={edit.telefono} maxLength={30} onChange={e => setEdit({ ...edit, telefono: e.target.value })} placeholder="Teléfono" style={{ ...C.input, flex: "1 1 140px" }} />
                <div style={{ display: "flex", gap: 4 }}>{COLORES.map(c => <button key={c} onClick={() => setEdit({ ...edit, color: c })} style={{ width: 26, height: 26, borderRadius: "50%", background: c, border: edit.color === c ? "3px solid #fff" : "2px solid transparent" }} aria-label="Color" />)}</div>
                <button onClick={() => { if (edit.nombre.trim()) { onGuardarSocio(edit); setEdit(null); } }} style={{ ...C.small, color: "var(--green)", borderColor: "var(--green)" }}>Guardar</button>
                <button onClick={() => setEdit(null)} style={C.small} aria-label="Cancelar"><Icon n="x" s={14} /></button>
              </div>
            ) : (<>
              <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}><Avatar nombre={s.nombre} c={s.color} s={30} /><b>{s.nombre}</b>{s.telefono && <a href={`tel:${s.telefono.replace(/[^\d+]/g, "")}`} style={{ color: "var(--muted)", fontSize: 12.5 }}>{s.telefono}</a>}</span>
              <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button onClick={() => setEdit({ ...s })} style={C.btnSm} aria-label="Editar"><Icon n="edit" s={15} /></button>
                <button onClick={() => onActivo(s, false)} style={{ ...C.btnSm, color: "var(--muted)" }}>Quitar</button>
              </span>
            </>)}
          </div>
        ))}
        {inactivos.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <button onClick={() => setVerInactivos(v => !v)} style={{ ...C.small, color: "var(--muted)" }}>{verInactivos ? "Ocultar" : "Ver"} socios quitados ({inactivos.length})</button>
            {verInactivos && inactivos.map(s => <div key={s.id} style={{ ...C.row, opacity: .6 }}><span style={{ display: "flex", alignItems: "center", gap: 8 }}><Avatar nombre={s.nombre} c={s.color} s={24} />{s.nombre}</span><button onClick={() => onActivo(s, true)} style={C.small}>Recuperar</button></div>)}
          </div>
        )}
      </div>
    </div>
  );
}

/* Carga: bloques grises con la forma de lo que va a salir (la pantalla no «salta») */
function Esqueleto() {
  const b = (h, w = "100%") => <div style={{ height: h, width: w, borderRadius: 14, background: "linear-gradient(90deg, var(--surface) 0%, var(--surface2) 50%, var(--surface) 100%)", backgroundSize: "200% 100%", animation: "crmShimmer 1.2s ease-in-out infinite" }} />;
  return (
    <div aria-busy="true" aria-label="Cargando" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <style>{"@keyframes crmShimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}"}</style>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>{b(92)}{b(92)}{b(92)}{b(92)}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12 }}>{b(220)}{b(220)}</div>
      {b(160)}
    </div>
  );
}

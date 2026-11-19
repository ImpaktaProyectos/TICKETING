/* Ticketera · Service Worker v4
   Regla de oro: con internet se sirve la versión nueva de la página.
   Los archivos con huella en el nombre (/assets/…) no cambian nunca: salen de la copia del equipo.
   Si la red no contesta en 3 s (wifi «conectado» sin internet), se abre la copia para poder vender.
   Nunca intercepta Supabase (login, datos, tiempo real). */
const CACHE = "ticketera-v5";

// Al instalar se guarda YA todo lo necesario para abrir sin internet (no hace falta una segunda visita)
self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      const res = await fetch("/", { cache: "reload" });
      if (res.ok) {
        const html = await res.clone().text();
        await cache.put("/", res);
        const assets = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map(m => m[1]);
        const extra = ["/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/brand/tixfast_isotipo_app.svg", "/brand/tixfast_logo_horizontal_oscuro.svg", "/brand/tixfast_logo_horizontal_claro.svg", "/brand/tixfast_logo_ticket_1bit.svg"];
        await Promise.all([...new Set([...assets, ...extra])].map(u => cache.add(new Request(u, { cache: "reload" })).catch(() => {})));
      }
    } catch {}
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    // Borra cachés de versiones anteriores
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Permite forzar la actualización desde la app
self.addEventListener("message", (e) => { if (e.data === "SKIP_WAITING") self.skipWaiting(); });

// Archivos de la app con huella en el nombre (/assets/app-AbC123.js): nunca cambian, cada versión
// tiene nombres nuevos. Se sirven desde la copia del equipo (al momento, también con wifi sin internet).
const esFijo = (url) => url.origin === self.location.origin && url.pathname.startsWith("/assets/");
const esPagina = (req) => req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
const ESPERA_PAGINA_MS = 3000;

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                  // ventas/escrituras pasan directas
  const url = new URL(req.url);
  if (url.hostname.endsWith("supabase.co")) return;   // NO tocar API/realtime de Supabase

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const guardar = (net) => {
      if (net && net.status === 200) {
        const sameOrigin = url.origin === self.location.origin;
        const fonts = /gstatic|googleapis/.test(url.hostname);
        if (sameOrigin || fonts) cache.put(req, net.clone()).catch(() => {});
      }
      return net;
    };
    // 1) Archivos fijos: copia del equipo primero; si no está, de internet (y se guarda)
    if (esFijo(url)) {
      const hit = await cache.match(req);
      if (hit) return hit;
      return guardar(await fetch(req));
    }
    // 2) Lo demás (la página): RED PRIMERO, así una versión nueva se ve al instante.
    //    Si la red no contesta en 3 s (wifi sin internet) y hay copia, se abre la copia;
    //    la respuesta de la red, si llega, se guarda para la próxima vez.
    const red = fetch(req).then(guardar);
    const copia = async () => {
      const hit = await cache.match(req);
      if (hit) return hit;
      if (esPagina(req)) { const home = await cache.match("/"); if (home) return home; }
      return null;
    };
    try {
      if (!esPagina(req)) return await red;
      const lenta = new Promise(res => setTimeout(() => res("lenta"), ESPERA_PAGINA_MS));
      const r = await Promise.race([red, lenta]);
      if (r !== "lenta") return r;
      const c = await copia();
      if (c) { e.waitUntil(red.catch(() => {})); return c; }
      return await red;
    } catch {
      // Sin conexión: tiramos de la copia guardada
      const c = await copia();
      return c || Response.error();
    }
  })());
});

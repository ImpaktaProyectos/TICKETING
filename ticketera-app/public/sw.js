/* Ticketera · Service Worker v3
   Regla de oro: con internet SIEMPRE se sirve la versión nueva.
   La copia guardada solo se usa cuando NO hay conexión (para poder vender offline).
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

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                  // ventas/escrituras pasan directas
  const url = new URL(req.url);
  if (url.hostname.endsWith("supabase.co")) return;   // NO tocar API/realtime de Supabase

  // RED PRIMERO para todo lo de la app: así una versión nueva se ve al instante.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const net = await fetch(req);
      if (net && net.status === 200) {
        const sameOrigin = url.origin === self.location.origin;
        const fonts = /gstatic|googleapis/.test(url.hostname);
        if (sameOrigin || fonts) cache.put(req, net.clone());
      }
      return net;
    } catch {
      // Sin conexión: tiramos de la copia guardada
      const hit = await cache.match(req);
      if (hit) return hit;
      if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
        const home = await cache.match("/");
        if (home) return home;
      }
      return Response.error();
    }
  })());
});

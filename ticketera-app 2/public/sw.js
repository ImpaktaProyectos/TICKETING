/* Ticketera · Service Worker — permite abrir la app SIN wifi tras instalarla.
   NUNCA intercepta Supabase (login, datos, tiempo real) para no romper la sincronización. */
const CACHE = "ticketera-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                 // ventas/escrituras (POST) pasan directas
  const url = new URL(req.url);
  if (url.hostname.endsWith("supabase.co")) return;  // NO tocar API/realtime de Supabase

  // Navegación (HTML): red primero, y si no hay, la copia guardada
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const net = await fetch(req);
        const c = await caches.open(CACHE);
        c.put("/", net.clone());
        return net;
      } catch {
        const c = await caches.open(CACHE);
        return (await c.match("/")) || (await c.match(req)) || Response.error();
      }
    })());
    return;
  }

  // Recursos (JS, CSS, fuentes, imágenes): usa caché y guarda al vuelo
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req);
    if (hit) return hit;
    try {
      const net = await fetch(req);
      const okOrigin = url.origin === self.location.origin || /gstatic|googleapis/.test(url.hostname);
      if (net && net.status === 200 && okOrigin) c.put(req, net.clone());
      return net;
    } catch {
      return hit || Response.error();
    }
  })());
});

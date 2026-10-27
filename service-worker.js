const CACHE_NAME = "bleed-cycle-pwa-v23";
const CACHE_PREFIX = "bleed-cycle-pwa-";
const APP_SHELL = "./index.html";
const ASSETS = [
  "./", APP_SHELL, "./styles.css?v=23", "./app.js?v=23",
  "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png"
];

self.addEventListener("install", (event) => {
  // A partial download must never replace the working offline release.
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      await cache.addAll(ASSETS.map(asset => new Request(asset, { cache: "reload" })));
      await self.skipWaiting();
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
  })());
});

async function deleteOldCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
}

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await deleteOldCaches();
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: "window" });
    clients.forEach(client => client.postMessage({ type: "APP_UPDATED", version: CACHE_NAME }));
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "CLEAR_OLD_CACHES") event.waitUntil(deleteOldCaches());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith(self.registration.scope.replace(url.origin, ""))) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // The shell and its versioned assets stay together until a complete release installs.
    const cached = await cache.match(event.request.mode === "navigate" ? APP_SHELL : event.request);
    return cached || fetch(event.request);
  })());
});

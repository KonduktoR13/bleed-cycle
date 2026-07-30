const CACHE_NAME = "bleed-cycle-pwa-v22";
const APP_SHELL = "./index.html";
const ASSETS = [
  "./",
  APP_SHELL,
  "./styles.css?v=22",
  "./app.js?v=22",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(precacheFreshAssets());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      const oldKeys = keys.filter((key) => key !== CACHE_NAME);
      const hadPreviousVersion = oldKeys.some((key) => key.startsWith("bleed-cycle-pwa-"));
      return Promise.all(oldKeys.map((key) => caches.delete(key)))
        .then(() => self.clients.claim())
        .then(() => (hadPreviousVersion ? refreshOpenClients() : undefined));
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "CLEAR_OLD_CACHES") {
    event.waitUntil(deleteOldCaches());
  }
});

function precacheFreshAssets() {
  return caches.open(CACHE_NAME).then((cache) => Promise.all(
    ASSETS.map((asset) => fetch(new Request(asset, { cache: "reload" })).then((response) => {
      if (!response.ok) throw new Error(`Failed to cache ${asset}`);
      return cache.put(asset, response);
    }))
  ));
}

function deleteOldCaches() {
  return caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
  ));
}

function refreshOpenClients() {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => Promise.all(
    clients.map((client) => {
      client.postMessage({ type: "APP_UPDATED", version: CACHE_NAME });
      if ("navigate" in client && client.url) return client.navigate(client.url).catch(() => {});
      return undefined;
    })
  ));
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(new Request(event.request, { cache: "reload" })).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(APP_SHELL, copy));
        return response;
      }).catch(() => caches.match(APP_SHELL))
    );
    return;
  }
  event.respondWith(
    fetch(new Request(event.request, { cache: "reload" })).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return caches.match(APP_SHELL);
    }))
  );
});

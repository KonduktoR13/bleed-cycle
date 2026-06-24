const CACHE_NAME = "bleed-cycle-pwa-v20";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
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
});

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
      fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
        return response;
      }).catch(() => caches.match("./index.html"))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fresh = fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
      if (cached) {
        fresh.catch(() => {});
        return cached;
      }
      return fresh.catch(() => caches.match("./index.html"));
    })
  );
});

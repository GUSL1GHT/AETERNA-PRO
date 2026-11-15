importScripts("./outbox.js");

const CACHE_NAME = "aeterna-pro-v5";
const BACKEND_URL = ["localhost", "127.0.0.1"].includes(self.location.hostname)
  ? "http://127.0.0.1:3000"
  : "https://aeterna-pro-backend.onrender.com";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./assets/app.css",
  "./assets/app.js",
  "./manifest.webmanifest",
  "./outbox.js",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith('aeterna-pro-') && key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  if (new URL(event.request.url).origin !== self.location.origin) return;
  // GitHub Pages permite guardar los archivos 10 minutos; «no-cache» obliga a comprobar si hay versión nueva.
  const request = event.request.mode === 'navigate'
    ? new Request(event.request.url, { cache: 'no-cache', credentials: 'same-origin' })
    : new Request(event.request, { cache: 'no-cache' });
  event.respondWith(fetch(request).then((response) => {
    if (response.ok && event.request.mode === 'navigate') {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
    }
    return response;
  }).catch(() => caches.match(event.request, { ignoreSearch: true })));
});

// Envía los enlaces compartidos que quedaron pendientes, aunque la app esté cerrada.
self.addEventListener("sync", (event) => {
  if (event.tag === self.AeternaOutbox.SYNC_TAG) {
    event.waitUntil(self.AeternaOutbox.flush(BACKEND_URL));
  }
});

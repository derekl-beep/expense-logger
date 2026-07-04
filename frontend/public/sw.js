// Minimal service worker — just enough for real PWA installability
// (Chrome/Android's install criteria require one with a fetch handler).
// Deliberately no ambition around offline data sync: API routes are never
// cached, so expense/budget data is never served stale. Only the static
// app shell and hashed build assets are cached.

const CACHE_VERSION = "v1";
const CACHE_NAME = `expense-logger-${CACHE_VERSION}`;

const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Hashed build assets are immutable — cache-first, filling the cache on
  // first fetch.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            return res;
          })
      )
    );
    return;
  }

  // Page navigations: always prefer the network (so a new deploy is picked
  // up immediately); fall back to the cached shell only when offline.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/")));
  }

  // Everything else (API routes) is left untouched — no caching, always
  // hits the network, so financial data is never served stale.
});

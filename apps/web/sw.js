// Minimal app-shell service worker, purely for PWA installability (Chrome's install criteria
// require a registered service worker with a fetch handler) and offline resilience for the
// static shell itself -- NOT a general-purpose cache. This is a live trading dashboard: every
// /api/ response must always come from the network, never from a cache, or the operator could
// see stale account/price/order state and mistake it for current truth. Only the exact known
// static asset paths are ever touched; everything else (all /api/ calls, anything unrecognized)
// passes straight through untouched.
const CACHE_NAME = "dokkaebi-shell-v1";
const SHELL_ASSETS = ["/", "/index.html", "/app.js", "/styles.css", "/favicon.svg", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (!SHELL_ASSETS.includes(url.pathname)) return;

  // Network-first: always tries live content first (so a redeploy is picked up immediately
  // while online), and only serves the cached copy if the network request itself fails (e.g.
  // genuinely offline) -- never silently serves stale shell content over a working connection.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

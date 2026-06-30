// Minimal service worker. Its presence is what makes Chrome offer "Install",
// and installation is what registers the app as an Android share target.
const CACHE = "weekend-table-v1";

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/"])).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

// Network-first, falling back to cache. Never intercept API calls.
self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET" || new URL(request.url).pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(request).then((r) => r || caches.match("/")))
  );
});

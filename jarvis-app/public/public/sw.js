// Minimal app-shell service worker. Network-first so users always get fresh code
// and live data; falls back to a cached shell only when offline. Supabase API
// requests are never intercepted.
const SHELL = "jarvis-shell-v1";
const ASSETS = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave Supabase + others alone
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/index.html")));
    return;
  }
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(SHELL).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req)),
  );
});

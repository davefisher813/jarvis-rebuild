// App-shell service worker, network-first with a self-healing cache.
//
// IMPORTANT FIX: a previous version cached hashed JS/CSS bundles and never
// invalidated them, so after a new deploy the cached index.html pointed at old
// bundle filenames that no longer existed on the server, producing a blank
// (black) screen. This version:
//   1. bumps the cache name (v2) so the old poisoned cache is purged on activate,
//   2. never caches HTML or hashed build assets (always fetched fresh from network),
//   3. only caches a tiny set of stable icons/manifest for offline shell.
const SHELL = "jarvis-shell-v2";
const STABLE = ["/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(STABLE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave Supabase + others alone

  // HTML navigations: always network. Never serve a cached HTML shell that could
  // reference stale bundle hashes. Only fall back to a bare offline message.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => new Response("<!doctype html><meta charset=utf-8><title>Offline</title><body style='background:#000;color:#fff;font-family:-apple-system,sans-serif;padding:2rem'>You're offline. Reconnect and reopen JARVIS.</body>", { headers: { "Content-Type": "text/html" } })));
    return;
  }

  // Hashed build assets (/assets/...) are immutable per deploy: always network,
  // never cached, so a new deploy can never collide with an old cached bundle.
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(fetch(req));
    return;
  }

  // Everything else (stable icons/manifest): cache-first for offline, refreshed
  // in the background.
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(req, copy));
        return res;
      }).catch(() => hit);
      return hit || net;
    }),
  );
});

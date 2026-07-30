// App-shell service worker v3: instant reopen without the v1 poison bug.
//
// History: v1 cached HTML but not its hashed bundles, so a deploy could leave
// cached HTML pointing at assets that no longer existed (black screen). v2
// overcorrected to network-everything, which made every reopen a full reload.
//
// v3 does it properly:
//   - /assets/* bundles are IMMUTABLE (content-hashed filenames): cache-first,
//     forever. A filename can never point at different bytes, so this is the
//     safest possible caching.
//   - HTML navigations: stale-while-revalidate. Serve the last good HTML
//     instantly (reopen paints at once), refresh it from the network in the
//     background. A deploy therefore applies on the NEXT open. Because every
//     bundle the cached HTML references is itself cached, the pair always
//     works offline: the v1 poison cannot recur.
//   - Old caches are purged on activate; the asset cache is trimmed so it
//     holds roughly the last couple of deploys.
const HTML_CACHE = "jarvis-html-v3";
const ASSET_CACHE = "jarvis-assets-v3";
const STABLE_CACHE = "jarvis-shell-v3";
const KEEP = [HTML_CACHE, ASSET_CACHE, STABLE_CACHE];
const STABLE = ["/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];
const ASSET_LIMIT = 60; // ~3 deploys of bundles; trimmed oldest-first

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(STABLE_CACHE).then((c) => c.addAll(STABLE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trimAssets() {
  const c = await caches.open(ASSET_CACHE);
  const keys = await c.keys();
  if (keys.length <= ASSET_LIMIT) return;
  // Cache API keys come back in insertion order; drop the oldest first.
  for (const k of keys.slice(0, keys.length - ASSET_LIMIT)) await c.delete(k);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave Supabase + others alone

  // HTML navigations: cached-first for instant paint, revalidate in background.
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      const cache = await caches.open(HTML_CACHE);
      const hit = await cache.match("/index-shell");
      // no-store: the revalidation must reach the server, never the HTTP
      // cache, or a deploy could sit unseen behind a cached 200.
      const refresh = fetch(req.url, { cache: "no-store" }).then(async (res) => {
        if (res && res.ok) await cache.put("/index-shell", res.clone());
        return res;
      }).catch(() => null);
      if (hit) {
        e.waitUntil(refresh); // background revalidate; applies next open
        return hit;
      }
      const net = await refresh;
      if (net) return net;
      return new Response(
        "<!doctype html><meta charset=utf-8><title>Offline</title><body style='background:#000;color:#fff;font-family:-apple-system,sans-serif;padding:2rem'>You're offline. Reconnect and reopen JARVIS.</body>",
        { headers: { "Content-Type": "text/html" } },
      );
    })());
    return;
  }

  // Immutable hashed bundles: cache-first, populate on first fetch.
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res && res.ok) {
        await cache.put(req, res.clone());
        e.waitUntil(trimAssets());
      }
      return res;
    })());
    return;
  }

  // Stable icons/manifest: cache-first with background refresh.
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(STABLE_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    }),
  );
});

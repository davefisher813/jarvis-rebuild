import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// THE VERSION CHECK REACHES THE NETWORK (issue 110, 2026-10-18). shared/buildCheck.ts asks which bundle is deployed by
// fetching /index.html: a plain fetch, not a navigation. The worker answered every such request cache-first with a
// background refresh, so the first check after a deploy read the PREVIOUS deploy's HTML and said "not stale"; only the
// second check saw the new build. Measured on the real worker (a build swapped under a live page): check 1 old, check 2
// new. A resume of the home-screen app is one check, so a merged fix could sit unseen until a cold launch. This runs the
// worker's real fetch handler and holds the two files that name the deployed build outside every cache.

function loadFetchHandler() {
  const src = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
  const listeners = new Map<string, (e: unknown) => void>();
  const self = {
    addEventListener: (name: string, fn: (e: unknown) => void) => { listeners.set(name, fn); },
    registration: { showNotification: async () => {} },
    clients: { matchAll: async () => [], openWindow: async () => null, claim: async () => {} },
    skipWaiting: async () => {},
    location: { origin: "https://app.example" },
  };
  const cached = { match: async () => new Response("STALE"), put: async () => {}, keys: async () => [], addAll: async () => {} };
  const caches = { open: async () => cached, keys: async () => [], delete: async () => true, match: async () => new Response("STALE") };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function("self", "caches", "fetch", "Response", "URL", "setTimeout", src)(self, caches, async () => new Response("FRESH"), Response, URL, setTimeout);
  return listeners.get("fetch")!;
}

function ask(handler: (e: unknown) => void, path: string, mode = "cors") {
  const respondWith = vi.fn();
  handler({ request: { method: "GET", url: "https://app.example" + path, mode }, respondWith, waitUntil: () => {} });
  return respondWith;
}

describe("the worker never answers the version check from a cache", () => {
  const handler = loadFetchHandler();

  it("/index.html and /version.json pass straight through to the network", () => {
    expect(ask(handler, "/index.html")).not.toHaveBeenCalled();
    expect(ask(handler, "/version.json")).not.toHaveBeenCalled();
  });

  it("every other same-origin request is still handled by the worker", () => {
    expect(ask(handler, "/icon-192.png")).toHaveBeenCalledTimes(1);
    expect(ask(handler, "/assets/index-abc.js")).toHaveBeenCalledTimes(1);
    expect(ask(handler, "/", "navigate")).toHaveBeenCalledTimes(1);
  });

  it("the stable cache is renamed, so the stale /index.html entry the old worker kept is purged on activate", () => {
    const src = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
    expect(src).toMatch(/STABLE_CACHE = "jarvis-shell-v5"/);
    expect(src).not.toMatch(/jarvis-shell-v4/);
  });
});

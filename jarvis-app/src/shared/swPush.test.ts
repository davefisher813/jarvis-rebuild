import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// public/sw.js is a classic worker script, not a module, so it is loaded the
// way the browser loads it: as text, with a fake `self`. What is proven: a
// push with a payload shows that payload; a push with garbage still shows a
// generic alert (Clemenza, condition 5: a dropped push is the quietest failure
// and iOS revokes the subscription after a few of them); a tap opens the app.

function loadWorker() {
  const src = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
  const listeners = new Map<string, (e: unknown) => void>();
  const showNotification = vi.fn(async () => {});
  const openWindow = vi.fn(async () => null);
  const clients: { matchAll: ReturnType<typeof vi.fn>; openWindow: typeof openWindow; claim: () => Promise<void> } = {
    matchAll: vi.fn(async () => []),
    openWindow,
    claim: async () => {},
  };
  const self = {
    addEventListener: (name: string, fn: (e: unknown) => void) => { listeners.set(name, fn); },
    registration: { showNotification },
    clients,
    skipWaiting: async () => {},
    location: { origin: "https://app.example" },
  };
  const caches = { open: async () => ({ addAll: async () => {}, match: async () => undefined, put: async () => {}, keys: async () => [] }), keys: async () => [], delete: async () => true, match: async () => undefined };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function("self", "caches", "fetch", "Response", "URL", "setTimeout", src)(self, caches, async () => new Response(""), Response, URL, setTimeout);
  return { listeners, showNotification, clients };
}

function pushEvent(payload: unknown, parseable = true) {
  const waits: Promise<unknown>[] = [];
  return {
    e: {
      data: { json: () => { if (!parseable) throw new SyntaxError("garbage"); return payload; } },
      waitUntil: (p: Promise<unknown>) => { waits.push(p); },
    },
    settle: () => Promise.all(waits),
  };
}

describe("the worker shows every push", () => {
  it("registers push and notificationclick handlers", () => {
    const { listeners } = loadWorker();
    expect(listeners.has("push")).toBe(true);
    expect(listeners.has("notificationclick")).toBe(true);
  });

  it("shows the server's payload as sent", async () => {
    const { listeners, showNotification } = loadWorker();
    const { e, settle } = pushEvent({ title: "Morning Brief", body: "Three things today", tag: "brief", url: "/today", icon: "/icon-192.png", badge: "/icon-192.png", actions: [] });
    listeners.get("push")!(e);
    await settle();
    expect(showNotification).toHaveBeenCalledTimes(1);
    const [title, opts] = showNotification.mock.calls[0] as unknown as [string, { body: string; tag: string; data: { url: string } }];
    expect(title).toBe("Morning Brief");
    expect(opts.body).toBe("Three things today");
    expect(opts.tag).toBe("brief");
    expect(opts.data.url).toBe("/today");
  });

  it("shows a generic alert for a payload it cannot parse, never nothing", async () => {
    const { listeners, showNotification } = loadWorker();
    const { e, settle } = pushEvent(null, false);
    listeners.get("push")!(e);
    await settle();
    expect(showNotification).toHaveBeenCalledTimes(1);
    const [title, opts] = showNotification.mock.calls[0] as unknown as [string, { body: string; data: { url: string } }];
    expect(title).toBe("JARVIS");
    expect(opts.body.length).toBeGreaterThan(0);
    expect(opts.data.url).toBe("/");
  });

  it("shows a generic alert for a push with no data at all", async () => {
    const { listeners, showNotification } = loadWorker();
    const waits: Promise<unknown>[] = [];
    listeners.get("push")!({ data: null, waitUntil: (p: Promise<unknown>) => { waits.push(p); } });
    await Promise.all(waits);
    expect(showNotification).toHaveBeenCalledTimes(1);
    expect((showNotification.mock.calls[0] as unknown as [string])[0]).toBe("JARVIS");
  });

  it("a tap opens the app at the payload's url when no window is open", async () => {
    const { listeners, clients } = loadWorker();
    const waits: Promise<unknown>[] = [];
    listeners.get("notificationclick")!({ notification: { close: () => {}, data: { url: "/today" } }, waitUntil: (p: Promise<unknown>) => { waits.push(p); } });
    await Promise.all(waits);
    expect(clients.openWindow).toHaveBeenCalledWith("/today");
  });

  it("a tap focuses an open window and tells it where to go", async () => {
    const { listeners, clients } = loadWorker();
    const focus = vi.fn(async () => {});
    const postMessage = vi.fn();
    clients.matchAll.mockResolvedValue([{ focus, postMessage }]);
    const waits: Promise<unknown>[] = [];
    listeners.get("notificationclick")!({ notification: { close: () => {}, data: { url: "/today" } }, waitUntil: (p: Promise<unknown>) => { waits.push(p); } });
    await Promise.all(waits);
    expect(postMessage).toHaveBeenCalledWith({ type: "jarvis:open", url: "/today" });
    expect(focus).toHaveBeenCalled();
    expect(clients.openWindow).not.toHaveBeenCalled();
  });
});

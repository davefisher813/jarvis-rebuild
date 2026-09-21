import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { webPushStatus, footFor, switchLocked, urlBase64ToUint8Array, resubscribeIfNeeded, enableWebPush, ALL_OR_NOTHING, type WebPushEnv, type WebPushStatus } from "./webPush";

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

const base: WebPushEnv = { native: false, hasServiceWorker: true, standalone: true, hasPushManager: true, permission: "default", hasKey: null, subscribed: false };

describe("one state, one sentence", () => {
  const cases: [Partial<WebPushEnv>, WebPushStatus][] = [
    [{ native: true }, "native"],
    [{ hasServiceWorker: false }, "no-sw"],
    [{ standalone: false }, "not-standalone"],
    [{ hasPushManager: false }, "no-push"],
    [{ permission: "denied" }, "denied"],
    [{ hasKey: false }, "no-key"],
    [{}, "off"],
    [{ subscribed: true }, "on"],
    [{ subscribed: true, permission: "granted" }, "on"],
    // Order matters: a Safari tab is told to add to the Home Screen before it
    // is told anything about permission, because permission is moot there.
    [{ standalone: false, permission: "denied" }, "not-standalone"],
  ];
  for (const [patch, want] of cases) {
    it(`${JSON.stringify(patch)} is ${want}`, () => {
      expect(webPushStatus({ ...base, ...patch })).toBe(want);
    });
  }

  it("every non native state has a sentence, and the on and off ones say all or nothing", () => {
    const all: WebPushStatus[] = ["no-sw", "not-standalone", "no-push", "denied", "no-key", "off", "on"];
    for (const s of all) expect(footFor(s).length, s).toBeGreaterThan(10);
    expect(footFor("off")).toContain(ALL_OR_NOTHING);
    expect(footFor("on")).toContain(ALL_OR_NOTHING);
    expect(footFor("not-standalone")).toContain("Home Screen");
    expect(footFor("no-push")).toContain("16.4");
    expect(footFor("denied")).toContain("Settings");
  });

  it("only off and on can be tapped", () => {
    expect(switchLocked("off")).toBe(false);
    expect(switchLocked("on")).toBe(false);
    for (const s of ["no-sw", "not-standalone", "no-push", "denied", "no-key", "native"] as WebPushStatus[]) expect(switchLocked(s), s).toBe(true);
  });
});

describe("the key decoder", () => {
  it("turns a base64url VAPID public key into the 65 bytes PushManager wants", () => {
    const bytes = Uint8Array.from({ length: 65 }, (_, i) => (i * 37 + 4) % 256);
    const b64url = Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(b64url).toHaveLength(87);
    const out = urlBase64ToUint8Array(b64url);
    expect(out).toHaveLength(65);
    expect(Array.from(out)).toEqual(Array.from(bytes));
  });
});

// ---- the browser, faked -----------------------------------------------------

type Store = Record<string, string>;
function storage(init: Store = {}) {
  const s: Store = { ...init };
  return { getItem: (k: string) => (k in s ? s[k]! : null), setItem: (k: string, v: string) => { s[k] = v; }, removeItem: (k: string) => { delete s[k]; }, dump: () => s };
}

function fakeWindow(opts: { session?: Store; standalone?: boolean; permission?: string } = {}) {
  const session = storage(opts.session);
  const w = {
    navigator: { standalone: opts.standalone ?? true, serviceWorker: {} },
    matchMedia: () => ({ matches: opts.standalone ?? true }),
    sessionStorage: session,
    Notification: { permission: opts.permission ?? "granted" },
    PushManager: function PushManager() {},
  };
  return { w: w as unknown as Window, session };
}

describe("silent re-subscribe tries once per session", () => {
  let getSubscription: ReturnType<typeof vi.fn>;
  let subscribe: ReturnType<typeof vi.fn>;
  const local = storage();
  beforeEach(() => {
    getSubscription = vi.fn();
    subscribe = vi.fn();
    vi.stubGlobal("localStorage", local);
    local.setItem("jarvis.webpush.v1", JSON.stringify({ on: true, endpoint: "https://push.example/old", token: "t" }));
    vi.stubGlobal("navigator", { serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription, subscribe } }) } });
    vi.stubGlobal("Notification", { permission: "granted", requestPermission: vi.fn() });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("keeps an existing subscription and asks the server nothing", async () => {
    getSubscription.mockResolvedValue({ endpoint: "https://push.example/old" });
    const fetchImpl = vi.fn();
    const { w } = fakeWindow();
    expect(await resubscribeIfNeeded({ getToken: () => "jwt", fetchImpl: fetchImpl as unknown as typeof fetch }, w)).toBe("kept");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("re-subscribes once when the browser lost the subscription, then stops for the session", async () => {
    getSubscription.mockResolvedValue(null);
    subscribe.mockResolvedValue({ endpoint: "https://push.example/new", toJSON: () => ({ endpoint: "https://push.example/new" }) });
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith("/api/push")) return { ok: true, json: async () => ({ publicKey: Buffer.alloc(65, 1).toString("base64url"), token: "tok" }) };
      return { ok: false, json: async () => ({}) };
    });
    const { w, session } = fakeWindow();
    const first = await resubscribeIfNeeded({ getToken: () => "jwt", fetchImpl: fetchImpl as unknown as typeof fetch }, w);
    expect(first).toBe("resubscribed");
    expect(session.getItem("jarvis.webpush.retry.v1")).toBe("1");
    // Same session, browser still says no subscription: no second attempt.
    getSubscription.mockResolvedValue(null);
    const calls = fetchImpl.mock.calls.length;
    expect(await resubscribeIfNeeded({ getToken: () => "jwt", fetchImpl: fetchImpl as unknown as typeof fetch }, w)).toBe("skipped");
    expect(fetchImpl.mock.calls.length).toBe(calls);
  });

  it("after a failure it does not try again this session", async () => {
    getSubscription.mockResolvedValue(null);
    subscribe.mockRejectedValue(new Error("push service said no"));
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ publicKey: Buffer.alloc(65, 1).toString("base64url") }) }));
    const { w, session } = fakeWindow();
    expect(await resubscribeIfNeeded({ getToken: () => "jwt", fetchImpl: fetchImpl as unknown as typeof fetch }, w)).toBe("failed");
    expect(session.getItem("jarvis.webpush.retry.v1")).toBe("1");
    const calls = fetchImpl.mock.calls.length;
    expect(await resubscribeIfNeeded({ getToken: () => "jwt", fetchImpl: fetchImpl as unknown as typeof fetch }, w)).toBe("skipped");
    expect(fetchImpl.mock.calls.length).toBe(calls);
  });

  it("does nothing when the switch was never on, or in a Safari tab", async () => {
    local.setItem("jarvis.webpush.v1", JSON.stringify({ on: false }));
    const fetchImpl = vi.fn();
    expect(await resubscribeIfNeeded({ getToken: () => "jwt", fetchImpl: fetchImpl as unknown as typeof fetch }, fakeWindow().w)).toBe("skipped");
    local.setItem("jarvis.webpush.v1", JSON.stringify({ on: true }));
    expect(await resubscribeIfNeeded({ getToken: () => "jwt", fetchImpl: fetchImpl as unknown as typeof fetch }, fakeWindow({ standalone: false }).w)).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("the tap asks first", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("calls Notification.requestPermission synchronously, before any await", async () => {
    const order: string[] = [];
    const requestPermission = vi.fn(() => { order.push("ask"); return Promise.resolve("denied" as NotificationPermission); });
    vi.stubGlobal("Notification", { permission: "default", requestPermission });
    vi.stubGlobal("localStorage", storage());
    const p = enableWebPush({ getToken: () => { order.push("token"); return "jwt"; } });
    // Synchronous part of the call has run: the ask came before anything else.
    expect(order[0]).toBe("ask");
    expect(await p).toBe("denied");
  });

  it("a dismissed dialog is not a denial", async () => {
    vi.stubGlobal("Notification", { permission: "default", requestPermission: vi.fn(async () => "default" as NotificationPermission) });
    vi.stubGlobal("localStorage", storage());
    expect(await enableWebPush({ getToken: () => "jwt" })).toBe("dismissed");
  });

  it("a server with no key stops before subscribing", async () => {
    vi.stubGlobal("Notification", { permission: "granted", requestPermission: vi.fn() });
    vi.stubGlobal("localStorage", storage());
    const subscribe = vi.fn();
    vi.stubGlobal("navigator", { serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription: vi.fn(async () => null), subscribe } }) } });
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ publicKey: null }) }));
    expect(await enableWebPush({ getToken: () => "jwt", fetchImpl: fetchImpl as unknown as typeof fetch })).toBe("no-key");
    expect(subscribe).not.toHaveBeenCalled();
  });
});

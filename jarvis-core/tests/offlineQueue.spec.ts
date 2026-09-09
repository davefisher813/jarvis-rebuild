import { describe, it, expect, vi } from "vitest";
import { InMemoryAdapter } from "../src/core/inMemoryAdapter.js";
import { Store, UUID_RE, isNetworkError, type StorePersistence } from "../src/core/store.js";
import type { DataAdapter } from "../src/core/adapter.js";
import type { ItemData, QueuedOp, ServerTime } from "../src/core/types.js";

// S3-Q14 (2026-09-04): "Nothing is held when the signal drops." spec.ts's
// D1-D10 steps are the approved, harness-mirrored single source of truth and
// stay untouched (core.spec.ts already proves they still pass unchanged).
// This file is new coverage for the capability spec.ts's own header says was
// "deliberately out of scope": creates and deletes now queue offline too, the
// queue can persist across a restart, and a pending create/delete is visible
// locally the instant it is made, not only after reconnect.

function fakePersistence(): StorePersistence & { saves: QueuedOp[][] } {
  let stored: QueuedOp[] = [];
  const saves: QueuedOp[][] = [];
  return {
    load: () => stored,
    save: (q) => { stored = q; saves.push(structuredClone(q)); },
    saves,
  };
}

describe("offline create", () => {
  it("is visible immediately, under a stable id, while still offline", async () => {
    const store = new Store(new InMemoryAdapter());
    store.goOffline();
    const id = await store.create("U", "note", { title: "Grocery list" });
    expect(id).toBeTruthy();
    expect(store.queueLen()).toBe(1);
    expect((await store.read("U", id))?.data.title).toBe("Grocery list");
    expect((await store.listForUser("U", "note")).map((i) => i.id)).toEqual([id]);
  });

  it("never leaks across owners while pending", async () => {
    const store = new Store(new InMemoryAdapter());
    store.goOffline();
    const id = await store.create("U", "note", { title: "Private" });
    expect(await store.read("OTHER", id)).toBeNull();
    expect(await store.listForUser("OTHER", "note")).toEqual([]);
  });

  it("reconnect creates the real record under the SAME id, nothing left pending", async () => {
    const adapter = new InMemoryAdapter();
    const store = new Store(adapter);
    store.goOffline();
    const id = await store.create("U", "note", { title: "Grocery list" });
    await store.reconnect();
    expect(store.queueLen()).toBe(0);
    expect((await store.read("U", id))?.data.title).toBe("Grocery list");
    expect(adapter.snapshotCount()).toBe(1); // it is a real row now, not just local
  });

  it("an offline edit to a still-pending create folds into the local copy AND replays after it", async () => {
    const adapter = new InMemoryAdapter();
    const store = new Store(adapter);
    store.goOffline();
    const id = await store.create("U", "note", { title: "Grocery list", body: "" });
    const res = await store.update("U", id, { body: "milk" });
    expect(res).toBe("queued");
    expect((await store.read("U", id))?.data).toEqual({ title: "Grocery list", body: "milk" });
    expect(store.queueLen()).toBe(2); // the create, and the update queued to replay after it
    await store.reconnect();
    expect((await store.read("U", id))?.data).toEqual({ title: "Grocery list", body: "milk" });
  });

  it("created and deleted within the same offline session tells the server nothing", async () => {
    const adapter = new InMemoryAdapter();
    const store = new Store(adapter);
    store.goOffline();
    const id = await store.create("U", "note", { title: "Oops" });
    await store.delete("U", id);
    expect(store.queueLen()).toBe(0);
    expect(await store.read("U", id)).toBeNull();
    await store.reconnect();
    expect(adapter.snapshotCount()).toBe(0); // the server never heard about it
  });
});

describe("offline delete of an already-synced record", () => {
  it("is hidden locally the instant it is made, while the row itself still exists until reconnect", async () => {
    const adapter = new InMemoryAdapter();
    const store = new Store(adapter);
    const id = await store.create("U", "task", { text: "Call the vet" });
    store.goOffline();
    await store.delete("U", id);
    expect(await store.read("U", id)).toBeNull();
    expect(await store.listForUser("U", "task")).toEqual([]);
    expect(adapter.snapshotCount()).toBe(1); // still there server-side, queued to go
    await store.reconnect();
    expect(adapter.snapshotCount()).toBe(0);
    expect(store.queueLen()).toBe(0);
  });
});

// HMN-F-15 (2026-09-05): Undo after a delete puts the record back under the
// id it had, so everything that pointed at it still opens it. The adapter
// took an explicit id since the queue's replay; the Store now passes one
// through, online and offline.
describe("create under a chosen id (Undo after delete)", () => {
  it("online: the record comes back under the same id once the row is gone", async () => {
    const adapter = new InMemoryAdapter();
    const store = new Store(adapter);
    const id = await store.create("U", "note", { title: "Keep me" });
    await store.delete("U", id);
    expect(await store.read("U", id)).toBeNull();
    const back = await store.create("U", "note", { title: "Keep me" }, id);
    expect(back).toBe(id);
    expect((await store.read("U", id))?.data.title).toBe("Keep me");
    expect(adapter.snapshotCount()).toBe(1);
  });

  it("offline, undoing a delete that has not left the phone: the delete is forgotten and nothing is created twice", async () => {
    const adapter = new InMemoryAdapter();
    const store = new Store(adapter);
    const id = await store.create("U", "note", { title: "Keep me" });
    store.goOffline();
    await store.delete("U", id);
    expect(await store.read("U", id)).toBeNull();
    expect(store.queueLen()).toBe(1);
    const back = await store.create("U", "note", { title: "Keep me" }, id);
    expect(back).toBe(id);
    // Visible again at once, and the server never hears about it.
    expect((await store.read("U", id))?.data.title).toBe("Keep me");
    expect((await store.listForUser("U", "note")).map((i) => i.id)).toEqual([id]);
    expect(store.queueLen()).toBe(0);
    await store.reconnect();
    expect(adapter.snapshotCount()).toBe(1);
    expect((await store.read("U", id))?.data.title).toBe("Keep me");
  });

  it("offline, undoing a delete that already synced: the create replays under the same id", async () => {
    const adapter = new InMemoryAdapter();
    const store = new Store(adapter);
    const id = await store.create("U", "note", { title: "Keep me" });
    await store.delete("U", id);
    store.goOffline();
    const back = await store.create("U", "note", { title: "Keep me" }, id);
    expect(back).toBe(id);
    expect((await store.read("U", id))?.data.title).toBe("Keep me");
    await store.reconnect();
    expect(store.queueLen()).toBe(0);
    expect((await store.read("U", id))?.data.title).toBe("Keep me");
    expect(adapter.snapshotCount()).toBe(1);
  });
});

describe("offline queue: mixed ops drain in order on reconnect", () => {
  it("a create, an update to it, and a delete of something else all land correctly", async () => {
    const adapter = new InMemoryAdapter();
    const store = new Store(adapter);
    const existing = await store.create("U", "task", { text: "Old task" });
    store.goOffline();
    const fresh = await store.create("U", "task", { text: "New task", done: false });
    await store.update("U", fresh, { done: true });
    await store.delete("U", existing);
    expect(store.queueLen()).toBe(3);
    await store.reconnect();
    expect(store.queueLen()).toBe(0);
    expect(await store.read("U", existing)).toBeNull();
    expect((await store.read("U", fresh))?.data).toEqual({ text: "New task", done: true });
  });
});

describe("reconnect failure mid-drain", () => {
  // Wraps an adapter so its FIRST create() throws once (network dropped
  // again mid-reconnect), then behaves normally after.
  function flakyOnce(inner: DataAdapter): DataAdapter {
    let thrown = false;
    return {
      create: (o: string, t: string, d: ItemData, id?: string) => {
        if (!thrown) { thrown = true; return Promise.reject(new Error("network dropped again")); }
        return inner.create(o, t, d, id);
      },
      createMany: (o: string, t: string, d: ItemData[]) => inner.createMany(o, t, d),
      read: (o: string, id: string) => inner.read(o, id),
      apply: (o: string, id: string, p: ItemData, st?: ServerTime) => inner.apply(o, id, p, st),
      del: (o: string, id: string) => inner.del(o, id),
      listForUser: (o: string, t?: string) => inner.listForUser(o, t),
      getSubscriptionTier: () => inner.getSubscriptionTier(),
    };
  }

  it("leaves the whole queue intact, in order, for the next reconnect to retry", async () => {
    const adapter = new InMemoryAdapter();
    const flaky = flakyOnce(adapter);
    const store = new Store(flaky);
    store.goOffline();
    const id = await store.create("U", "note", { title: "Resilient" });
    await expect(store.reconnect()).rejects.toThrow("network dropped again");
    // Nothing lost: still queued, still visible locally.
    expect(store.queueLen()).toBe(1);
    expect((await store.read("U", id))?.data.title).toBe("Resilient");
    expect(adapter.snapshotCount()).toBe(0); // the failed attempt never landed
    // A later, successful reconnect picks up exactly where it left off.
    await store.reconnect();
    expect(store.queueLen()).toBe(0);
    expect(adapter.snapshotCount()).toBe(1);
  });
});

describe("persistence: the queue survives a kill", () => {
  it("saves after every queued write, and a fresh Store restores from it with pending items visible", async () => {
    const persistence = fakePersistence();
    const store1 = new Store(new InMemoryAdapter(), persistence);
    store1.goOffline();
    const id = await store1.create("U", "note", { title: "Survives a kill" });
    expect(persistence.saves.length).toBeGreaterThan(0);
    expect(persistence.saves.at(-1)).toEqual([
      { op: "create", id, ownerId: "U", entityType: "note", data: { title: "Survives a kill" }, queuedAt: expect.any(Number) },
    ]);

    // "App kill": store1 is discarded, unreconnected, with one op still
    // queued. A brand new Store, same persistence, is what a relaunch builds.
    const store2 = new Store(new InMemoryAdapter(), persistence);
    expect(store2.queueLen()).toBe(1);
    expect((await store2.read("U", id))?.data.title).toBe("Survives a kill");
  });

  it("saving nothing (an online-only session) never touches persistence", async () => {
    const persistence = fakePersistence();
    const store = new Store(new InMemoryAdapter(), persistence);
    await store.create("U", "note", { title: "Ordinary" });
    expect(persistence.saves).toEqual([]);
  });

  it("reconnecting from a restored queue clears persistence back to empty", async () => {
    const persistence = fakePersistence();
    const adapter = new InMemoryAdapter();
    const store1 = new Store(adapter, persistence);
    store1.goOffline();
    await store1.create("U", "note", { title: "Queued" });

    const store2 = new Store(adapter, persistence);
    await store2.reconnect();
    expect(persistence.saves.at(-1)).toEqual([]);
    expect(store2.queueLen()).toBe(0);
  });

  it("no persistence given behaves exactly as before: in-memory only, nothing to restore from", () => {
    const store = new Store(new InMemoryAdapter());
    expect(store.queueLen()).toBe(0);
  });
});

// PLUMB-F-01 (2026-09-05): "Offline creates get an id Postgres rejects, so
// they never sync and jam the queue." item.id is a uuid column and the
// queued id is inserted as-is on replay, so the id has to BE a uuid. The
// in-memory adapter accepts any string, which is why nothing here noticed
// "offline_<uuid>"; these pin the shape directly.
describe("PLUMB-F-01: an offline create's id is a bare uuid", () => {
  it("every queued id matches the uuid shape the id column accepts", async () => {
    const store = new Store(new InMemoryAdapter());
    store.goOffline();
    const ids = await Promise.all(
      Array.from({ length: 20 }, (_, i) => store.create("U", "note", { title: "n" + i })),
    );
    for (const id of ids) expect(id).toMatch(UUID_RE);
    expect(new Set(ids).size).toBe(20);
    expect(ids.some((id) => id.startsWith("offline_"))).toBe(false);
  });

  it("the fallback (no crypto.randomUUID) is uuid-shaped and unique inside one millisecond", async () => {
    // An exotic webview with a crypto object that lacks randomUUID.
    vi.stubGlobal("crypto", {});
    try {
      expect("randomUUID" in crypto).toBe(false);
      const store = new Store(new InMemoryAdapter());
      store.goOffline();
      const ids = await Promise.all(Array.from({ length: 50 }, () => store.create("U", "note", {})));
      for (const id of ids) expect(id).toMatch(UUID_RE);
      expect(new Set(ids).size).toBe(50);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a replayed create that hits duplicate key (23505) counts as landed and the queue moves on", async () => {
    const inner = new InMemoryAdapter();
    // Postgres shape of the error postgrest-js hands back on a unique violation.
    const dup = { code: "23505", message: "duplicate key value violates unique constraint \"item_pkey\"", details: "", hint: "" };
    const adapter: DataAdapter = {
      create: async (o: string, t: string, d: ItemData, id?: string) => {
        if (id && (await inner.read(o, id))) throw dup;
        return inner.create(o, t, d, id);
      },
      createMany: (o: string, t: string, d: ItemData[]) => inner.createMany(o, t, d),
      read: (o: string, id: string) => inner.read(o, id),
      apply: (o: string, id: string, p: ItemData, st?: ServerTime) => inner.apply(o, id, p, st),
      del: (o: string, id: string) => inner.del(o, id),
      listForUser: (o: string, t?: string) => inner.listForUser(o, t),
      getSubscriptionTier: () => inner.getSubscriptionTier(),
    };
    const store = new Store(adapter);
    store.goOffline();
    const id = await store.create("U", "note", { title: "Landed once already" });
    await store.update("U", id, { body: "and edited" });
    // The first attempt reached the server but its response was lost: the row
    // exists, the queue still holds the create.
    await inner.create("U", "note", { title: "Landed once already" }, id);
    await store.reconnect();
    expect(store.queueLen()).toBe(0);
    expect((await store.read("U", id))?.data).toEqual({ title: "Landed once already", body: "and edited" });
    expect(inner.snapshotCount()).toBe(1);
  });

  it("any other create failure still stops the drain and keeps the queue intact", async () => {
    const inner = new InMemoryAdapter();
    const adapter: DataAdapter = {
      create: async () => { throw { code: "42501", message: "permission denied" }; },
      createMany: (o: string, t: string, d: ItemData[]) => inner.createMany(o, t, d),
      read: (o: string, id: string) => inner.read(o, id),
      apply: (o: string, id: string, p: ItemData, st?: ServerTime) => inner.apply(o, id, p, st),
      del: (o: string, id: string) => inner.del(o, id),
      listForUser: (o: string, t?: string) => inner.listForUser(o, t),
      getSubscriptionTier: () => inner.getSubscriptionTier(),
    };
    const store = new Store(adapter);
    store.goOffline();
    await store.create("U", "note", { title: "Refused" });
    await expect(store.reconnect()).rejects.toMatchObject({ code: "42501" });
    expect(store.queueLen()).toBe(1);
  });
});

// PLUMB-F-02 (2026-09-05): "reconnect() has no in-flight guard: overlapping
// replays double-apply and can revert the newest edit." Two "online" events
// close together (WKWebView fires them in pairs) each started a drain over
// the same queue.
describe("PLUMB-F-02: overlapping reconnects share one drain", () => {
  // Wraps an adapter so every write takes a scripted amount of time. Uneven
  // latency is what turns "applied twice" into "the oldest patch landed
  // last" (the audit's repro: APPLIED_ORDER n1, n2, n3, n1 and FINAL_N 1).
  function slow(inner: DataAdapter, delaysMs: number[], applied: ItemData[]): DataAdapter {
    let i = 0;
    const wait = () => new Promise((r) => setTimeout(r, delaysMs[i++ % delaysMs.length]));
    return {
      create: async (o: string, t: string, d: ItemData, id?: string) => { await wait(); return inner.create(o, t, d, id); },
      createMany: (o: string, t: string, d: ItemData[]) => inner.createMany(o, t, d),
      read: (o: string, id: string) => inner.read(o, id),
      apply: async (o: string, id: string, p: ItemData, st?: ServerTime) => { await wait(); applied.push(p); return inner.apply(o, id, p, st); },
      del: async (o: string, id: string) => { await wait(); return inner.del(o, id); },
      listForUser: (o: string, t?: string) => inner.listForUser(o, t),
      getSubscriptionTier: () => inner.getSubscriptionTier(),
    };
  }

  it("three offline edits replay once each, in order, and the newest wins (two concurrent reconnects, uneven latency)", async () => {
    const inner = new InMemoryAdapter();
    const applied: ItemData[] = [];
    const store = new Store(slow(inner, [30, 5, 5, 5], applied));
    const id = await inner.create("U", "task", { n: 0 });
    store.goOffline();
    await store.update("U", id, { n: 1 });
    await store.update("U", id, { n: 2 });
    await store.update("U", id, { n: 3 });
    await Promise.all([store.reconnect(), store.reconnect()]);
    expect(applied).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect((await inner.read("U", id))?.data.n).toBe(3);
    expect(store.queueLen()).toBe(0);
  });

  it("a create at the head of the queue is inserted exactly once and stops being pending", async () => {
    const inner = new InMemoryAdapter();
    let creates = 0;
    const counting: DataAdapter = {
      ...slow(inner, [10], []),
      create: async (o: string, t: string, d: ItemData, id?: string) => { creates++; await new Promise((r) => setTimeout(r, 10)); return inner.create(o, t, d, id); },
    };
    const store = new Store(counting);
    store.goOffline();
    const id = await store.create("U", "note", { title: "Once" });
    await store.update("U", id, { body: "edited" });
    await Promise.all([store.reconnect(), store.reconnect(), store.reconnect()]);
    expect(creates).toBe(1);
    expect(inner.snapshotCount()).toBe(1);
    expect((await store.read("U", id))?.data).toEqual({ title: "Once", body: "edited" });
    // The list no longer overlays a pending copy over the real row.
    expect((await store.listForUser("U", "note")).length).toBe(1);
  });

  it("a second call while a drain is in flight returns that drain's own promise; after it settles a new call starts fresh", async () => {
    const inner = new InMemoryAdapter();
    const store = new Store(slow(inner, [10], []));
    const id = await inner.create("U", "task", { n: 0 });
    store.goOffline();
    await store.update("U", id, { n: 1 });
    const first = store.reconnect();
    expect(store.reconnect()).toBe(first);
    await first;
    // Nothing queued: a fresh reconnect is a new (immediately settled) drain, not the old one.
    const again = store.reconnect();
    expect(again).not.toBe(first);
    await again;
    expect(store.queueLen()).toBe(0);
  });

  it("a failed drain releases the latch so the next online event can retry", async () => {
    const inner = new InMemoryAdapter();
    let fail = true;
    const flaky: DataAdapter = {
      ...slow(inner, [1], []),
      apply: async (o: string, id: string, p: ItemData, st?: ServerTime) => {
        if (fail) throw new Error("dropped");
        return inner.apply(o, id, p, st);
      },
    };
    const store = new Store(flaky);
    const id = await inner.create("U", "task", { n: 0 });
    store.goOffline();
    await store.update("U", id, { n: 1 });
    await expect(store.reconnect()).rejects.toThrow("dropped");
    fail = false;
    await store.reconnect();
    expect((await inner.read("U", id))?.data.n).toBe(1);
    expect(store.queueLen()).toBe(0);
  });
});

// PLUMB-F-08 (2026-09-05): "Offline edits vanish from view until reconnect."
// The overlay covered creates and deletes; an edit to an already-synced row
// read as its old value until the network came back.
describe("PLUMB-F-08: an offline edit is visible at once", () => {
  it("a tick made offline shows in read() and listForUser() before reconnect, and the server has it after", async () => {
    const adapter = new InMemoryAdapter();
    const store = new Store(adapter);
    const id = await store.create("U", "task", { text: "Call the vet", done: false });
    store.goOffline();
    expect(await store.update("U", id, { done: true })).toBe("queued");
    expect((await store.read("U", id))?.data.done).toBe(true);
    expect((await store.listForUser("U", "task")).find((i) => i.id === id)?.data.done).toBe(true);
    // The server row itself is untouched until reconnect.
    expect((await adapter.read("U", id))?.data.done).toBe(false);
    await store.reconnect();
    expect((await adapter.read("U", id))?.data.done).toBe(true);
    expect((await store.read("U", id))?.data.done).toBe(true);
  });

  it("several edits fold in order, and a clear shows as absent, exactly as the row will read after replay", async () => {
    const adapter = new InMemoryAdapter();
    const store = new Store(adapter);
    const id = await store.create("U", "event", { title: "Lift", start: "06:00", recurrence: "weekly" });
    store.goOffline();
    await store.update("U", id, { start: "06:30" });
    await store.update("U", id, { start: "07:00" });
    await store.update("U", id, { recurrence: undefined } as unknown as ItemData);
    const offline = (await store.read("U", id))!.data;
    expect(offline).toEqual({ title: "Lift", start: "07:00" });
    expect(Object.prototype.hasOwnProperty.call(offline, "recurrence")).toBe(false);
    await store.reconnect();
    expect((await store.read("U", id))!.data).toEqual(offline);
  });

  it("never shows another owner's queued edit", async () => {
    const adapter = new InMemoryAdapter();
    const store = new Store(adapter);
    const mine = await store.create("U", "task", { text: "Mine", done: false });
    store.goOffline();
    await store.update("U", mine, { done: true });
    expect(await store.read("OTHER", mine)).toBeNull();
    expect(await store.listForUser("OTHER", "task")).toEqual([]);
  });

  it("a relaunch mid-offline shows the held edits: on a synced row and on a same-session capture", async () => {
    const persistence = fakePersistence();
    const adapter = new InMemoryAdapter();
    const store1 = new Store(adapter, persistence);
    const synced = await store1.create("U", "task", { text: "Synced", done: false });
    store1.goOffline();
    await store1.update("U", synced, { done: true });
    const captured = await store1.create("U", "note", { title: "Draft", body: "" });
    await store1.update("U", captured, { body: "milk, eggs" });

    // "App kill", then relaunch against the same persistence.
    const store2 = new Store(adapter, persistence);
    expect(store2.queueLen()).toBe(3);
    expect((await store2.read("U", synced))?.data.done).toBe(true);
    expect((await store2.read("U", captured))?.data).toEqual({ title: "Draft", body: "milk, eggs" });
    await store2.reconnect();
    expect((await adapter.read("U", synced))?.data.done).toBe(true);
    expect((await adapter.read("U", captured))?.data).toEqual({ title: "Draft", body: "milk, eggs" });
  });

  it("an offline delete still hides a row that also has a queued edit", async () => {
    const store = new Store(new InMemoryAdapter());
    const id = await store.create("U", "task", { text: "Doomed", done: false });
    store.goOffline();
    await store.update("U", id, { done: true });
    await store.delete("U", id);
    expect(await store.read("U", id)).toBeNull();
    expect(await store.listForUser("U", "task")).toEqual([]);
  });
});

// PLUMB-F-09 (2026-09-05): "the queue only engages on the browser's offline
// event; a write that fails while onLine is true is dropped, not queued."
// One bar of signal, a captive portal or a Supabase blip left navigator.onLine
// true, the write threw straight through, and the change was gone.
describe("PLUMB-F-09: a write that finds the signal gone is queued, not lost", () => {
  // An adapter that fails the next N writes with whatever the network is
  // doing today, then behaves.
  function flaky(fail: unknown, times = 1) {
    const real = new InMemoryAdapter();
    let left = times;
    const guard = () => { if (left > 0) { left--; throw fail; } };
    const adapter: DataAdapter = {
      create: async (o, t, d, id) => { guard(); return real.create(o, t, d, id); },
      createMany: (o, t, ds) => real.createMany(o, t, ds),
      read: (o, id) => real.read(o, id),
      apply: async (o, id, p, st) => { guard(); return real.apply(o, id, p, st); },
      del: async (o, id) => { guard(); return real.del(o, id); },
      listForUser: (o, t) => real.listForUser(o, t),
      getSubscriptionTier: () => real.getSubscriptionTier(),
    };
    return { adapter, real };
  }

  it("a capture whose create never reached the server is held, shown, and replayed", async () => {
    const { adapter, real } = flaky(new TypeError("Failed to fetch"));
    const store = new Store(adapter);
    const id = await store.create("U", "note", { title: "One bar of signal" });
    // Held, and visible: a capture app whose list does not show what was just
    // written has, for the user, lost it.
    expect(store.queueLen()).toBe(1);
    expect((await store.read("U", id))?.data.title).toBe("One bar of signal");
    expect(await real.read("U", id)).toBeNull();
    await store.reconnect();
    expect(store.queueLen()).toBe(0);
    expect((await real.read("U", id))?.data.title).toBe("One bar of signal");
  });

  it("an edit that met a 5xx is held and replayed, and reads show it meanwhile", async () => {
    const real = new InMemoryAdapter();
    const id = await real.create("U", "task", { text: "Call the coach", done: false });
    let fail = true;
    const adapter: DataAdapter = {
      create: (o, t, d, i) => real.create(o, t, d, i),
      createMany: (o, t, ds) => real.createMany(o, t, ds),
      read: (o, i) => real.read(o, i),
      apply: async (o, i, p, st) => { if (fail) { fail = false; throw { status: 503, message: "upstream" }; } return real.apply(o, i, p, st); },
      del: (o, i) => real.del(o, i),
      listForUser: (o, t) => real.listForUser(o, t),
      getSubscriptionTier: () => real.getSubscriptionTier(),
    };
    const store = new Store(adapter);
    expect(await store.update("U", id, { text: "Call the coach back" })).toBe("queued");
    expect((await store.read("U", id))?.data.text).toBe("Call the coach back");
    await store.reconnect();
    expect((await real.read("U", id))?.data.text).toBe("Call the coach back");
  });

  it("a delete that never landed is held, and the row does not come back meanwhile", async () => {
    const { adapter, real } = flaky(new TypeError("Failed to fetch"));
    const id = await real.create("U", "note", { title: "Gone" });
    const store = new Store(adapter);
    await store.delete("U", id);
    expect(await store.read("U", id)).toBeNull();
    expect((await store.listForUser("U")).length).toBe(0);
    await store.reconnect();
    expect(await real.read("U", id)).toBeNull();
  });

  it("an answer FROM the server is still the caller's problem: it throws, nothing queues, nothing goes offline", async () => {
    // Row-level security saying no is not a network drop, and retrying it
    // forever would be wrong.
    const { adapter } = flaky({ status: 403, message: "new row violates row-level security policy" });
    const store = new Store(adapter);
    await expect(store.create("U", "note", { title: "Not mine" })).rejects.toBeTruthy();
    expect(store.queueLen()).toBe(0);
    // Still online: the next write goes straight out.
    const id = await store.create("U", "note", { title: "Mine" });
    expect(store.queueLen()).toBe(0);
    expect(id).toBeTruthy();
  });

  it("a Postgres error is the server speaking, whatever its message says", async () => {
    const { adapter } = flaky({ code: "23514", message: "connection check constraint failed" });
    const store = new Store(adapter);
    await expect(store.create("U", "note", { title: "x" })).rejects.toBeTruthy();
    expect(store.queueLen()).toBe(0);
  });

  it("tells the app the signal dropped, once, so it can start retrying", async () => {
    const { adapter } = flaky(new TypeError("Failed to fetch"));
    const store = new Store(adapter);
    let told = 0;
    store.onDropped(() => { told++; });
    await store.create("U", "note", { title: "a" });
    expect(told).toBe(1);
    // Already offline: a second write queues without a second alarm.
    await store.create("U", "note", { title: "b" });
    expect(told).toBe(1);
    expect(store.queueLen()).toBe(2);
  });

  it("a listener that throws never breaks the write", async () => {
    const { adapter } = flaky(new TypeError("Failed to fetch"));
    const store = new Store(adapter);
    store.onDropped(() => { throw new Error("listener is broken"); });
    const id = await store.create("U", "note", { title: "still held" });
    expect(id).toBeTruthy();
    expect(store.queueLen()).toBe(1);
  });
});

describe("PLUMB-F-09: what counts as the signal dropping", () => {
  it("says yes to a request that got no answer, and to the far end falling over", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError({ status: 0, message: "" })).toBe(true);
    expect(isNetworkError({ status: 502 })).toBe(true);
    expect(isNetworkError({ message: "Network request failed" })).toBe(true);
    expect(isNetworkError({ message: "TypeError: Load failed" })).toBe(true);
  });

  it("says no to every answer the server actually gave", () => {
    expect(isNetworkError({ status: 400, message: "bad request" })).toBe(false);
    expect(isNetworkError({ status: 403, message: "row-level security" })).toBe(false);
    expect(isNetworkError({ status: 404 })).toBe(false);
    expect(isNetworkError({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(isNetworkError({ code: "PGRST116", message: "no rows" })).toBe(false);
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError("offline")).toBe(false);
  });
});

// PLUMB-F-10 (2026-09-05): "a replayed offline patch overwrites a newer edit
// made on another device." The phone offline at 9 AM, the laptop at noon, the
// phone reconnecting at 5 PM, and the 9 AM name replaced the noon name.
// Server-time-wins (D7, D10) was only ever about ARRIVAL order.
describe("PLUMB-F-10: a held edit carries its own age", () => {
  const HOUR = 3600_000;

  function rig() {
    let wall = Date.now();
    const adapter = new InMemoryAdapter(() => wall);
    return { adapter, store: new Store(adapter), at: (ms: number) => { wall = ms; } };
  }

  it("the noon edit on the laptop survives the 9 AM edit the phone replays at 5 PM", async () => {
    const { adapter, store, at } = rig();
    const id = await store.create("U", "task", { text: "Book the field" });

    // 9 AM, phone offline.
    store.goOffline();
    await store.update("U", id, { text: "Book the field (phone, 9 AM)" });

    // Noon, laptop, straight to the server.
    at(Date.now() + 3 * HOUR);
    await adapter.apply("U", id, { text: "Book the field (laptop, noon)" });

    // 5 PM, the phone reconnects.
    await store.reconnect();
    expect((await adapter.read("U", id))?.data.text).toBe("Book the field (laptop, noon)");
    expect(store.queueLen()).toBe(0); // refused, not stuck
  });

  it("a held edit newer than the row still lands", async () => {
    const { adapter, store, at } = rig();
    const id = await store.create("U", "task", { text: "Original" });
    at(Date.now() - HOUR); // the other device's edit happened an hour ago
    await adapter.apply("U", id, { text: "From an hour ago" });
    store.goOffline();
    await store.update("U", id, { text: "From just now" });
    await store.reconnect();
    expect((await adapter.read("U", id))?.data.text).toBe("From just now");
  });

  it("says so once for the whole drain, however many edits were refused", async () => {
    const { adapter, store, at } = rig();
    const a = await store.create("U", "task", { text: "A" });
    const b = await store.create("U", "task", { text: "B" });
    store.goOffline();
    await store.update("U", a, { text: "A held" });
    await store.update("U", b, { text: "B held" });
    at(Date.now() + 3 * HOUR);
    await adapter.apply("U", a, { text: "A newer" });
    await adapter.apply("U", b, { text: "B newer" });

    const told: number[] = [];
    store.onKeptNewer((n) => told.push(n));
    await store.reconnect();
    expect(told).toEqual([2]);
  });

  it("says nothing when every held edit landed", async () => {
    const { store } = rig();
    const id = await store.create("U", "task", { text: "A" });
    store.goOffline();
    await store.update("U", id, { text: "A held" });
    const told: number[] = [];
    store.onKeptNewer((n) => told.push(n));
    await store.reconnect();
    expect(told).toEqual([]);
  });

  it("an edit against a capture made in the same offline session is never refused by its own create", async () => {
    const { adapter, store, at } = rig();
    store.goOffline();
    const id = await store.create("U", "note", { title: "Draft", body: "" });
    await store.update("U", id, { body: "milk, eggs" });
    // The create lands NOW, hours after the edit was made: asking whether the
    // row is newer than the edit would refuse every held edit of a held
    // capture.
    at(Date.now() + 3 * HOUR);
    await store.reconnect();
    expect((await adapter.read("U", id))?.data.body).toBe("milk, eggs");
  });

  it("a queue persisted by a build that never stamped the age still replays", async () => {
    const adapter = new InMemoryAdapter();
    const id = await adapter.create("U", "task", { text: "Old queue" });
    const persistence: StorePersistence = {
      load: () => [{ op: "update", id, ownerId: "U", patch: { text: "From the old build" } }],
      save: () => {},
    };
    const store = new Store(adapter, persistence);
    await store.reconnect();
    expect((await adapter.read("U", id))?.data.text).toBe("From the old build");
  });

  it("stamps queuedAt on what it queues, so the age is there to carry", async () => {
    const persistence = fakePersistence();
    const store = new Store(new InMemoryAdapter(), persistence);
    const id = await store.create("U", "task", { text: "x" });
    store.goOffline();
    const before = Date.now();
    await store.update("U", id, { text: "y" });
    const queued = persistence.saves[persistence.saves.length - 1]!.find((op) => op.op === "update");
    expect(queued && queued.op === "update" ? queued.queuedAt : undefined).toBeGreaterThanOrEqual(before);
  });
});

describe("PLUMB-F-10: a held session is never refused by itself", () => {
  const HOUR = 3600_000;

  it("three held edits to one task all land, none refused by the first one's own write", async () => {
    let wall = Date.now();
    const adapter = new InMemoryAdapter(() => wall);
    const store = new Store(adapter);
    const id = await store.create("U", "counter", { n: 0, a: false, b: false });
    store.goOffline();
    await store.update("U", id, { a: true });
    await store.update("U", id, { b: true });
    await store.update("U", id, { n: 9 });
    wall = Date.now() + HOUR; // the drain itself happens later
    await store.reconnect();
    expect((await adapter.read("U", id))?.data).toEqual({ n: 9, a: true, b: true });
  });

  it("three held edits that all lost to one newer edit are one thing he is told about", async () => {
    let wall = Date.now();
    const adapter = new InMemoryAdapter(() => wall);
    const store = new Store(adapter);
    const id = await store.create("U", "task", { text: "Original" });
    store.goOffline();
    await store.update("U", id, { text: "held 1" });
    await store.update("U", id, { text: "held 2" });
    await store.update("U", id, { text: "held 3" });
    wall = Date.now() + 3 * HOUR;
    await adapter.apply("U", id, { text: "From the laptop" });
    const told: number[] = [];
    store.onKeptNewer((n) => told.push(n));
    await store.reconnect();
    expect(told).toEqual([1]); // one record, not three patches
    expect((await adapter.read("U", id))?.data.text).toBe("From the laptop");
  });
});

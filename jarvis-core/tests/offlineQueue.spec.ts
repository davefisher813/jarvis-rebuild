import { describe, it, expect } from "vitest";
import { InMemoryAdapter } from "../src/core/inMemoryAdapter.js";
import { Store, type StorePersistence } from "../src/core/store.js";
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

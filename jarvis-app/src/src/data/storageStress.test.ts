import { Store, InMemoryAdapter } from "@core";
import { describe, it, expect } from "vitest";

// Storage + sync stress tests. These hammer the exact failure modes that broke
// the old Firebase build: tombstone resurrection, scalar sync drift, lost
// offline edits, and field clobbering. They run against InMemoryAdapter, which
// is a faithful port of the same contract the SupabaseAdapter implements (hard
// DELETE, UPDATE-not-upsert, server-time last-write-wins, per-owner isolation).

const U = "userA";

function fresh() {
  const adapter = new InMemoryAdapter();
  return { adapter, store: new Store(adapter) };
}

describe("storage + sync stress", () => {
  it("deleted items never resurrect (a queued edit to a deleted id is a no-op)", async () => {
    const { adapter, store } = fresh();
    const id = await store.create(U, "task", { text: "buy milk", done: false });
    store.goOffline();
    expect(await store.update(U, id, { done: true })).toBe("queued");
    await store.delete(U, id); // delete applies immediately, even offline
    expect(await store.read(U, id)).toBeNull();
    await store.reconnect(); // queued edit replays against a now-missing id
    expect(store.queueLen()).toBe(0);
    expect(await store.read(U, id)).toBeNull(); // still gone
    expect((await store.listForUser(U)).length).toBe(0);
    expect(adapter.snapshotCount()).toBe(0); // nothing left behind
  });

  it("a direct update to a deleted id returns false and creates nothing", async () => {
    const { adapter, store } = fresh();
    const id = await store.create(U, "note", { title: "x" });
    await store.delete(U, id);
    expect(await store.update(U, id, { title: "y" })).toBe(false);
    expect(adapter.snapshotCount()).toBe(0);
  });

  it("scalar last-write-wins by server time; stale writes are rejected", async () => {
    const { store } = fresh();
    const id = await store.create(U, "settings", { theme: "dark" });
    const cur = (await store.read(U, id))!.serverTime;
    expect(await store.update(U, id, { theme: "light" }, cur + 5)).toBe(true);
    expect((await store.read(U, id))!.data.theme).toBe("light");
    expect(await store.update(U, id, { theme: "dark" }, cur + 1)).toBe(false); // stale
    expect((await store.read(U, id))!.data.theme).toBe("light"); // unchanged
  });

  it("field-level merge: patches to different fields do not clobber each other", async () => {
    const { store } = fresh();
    const id = await store.create(U, "budget", { groceries: 100 });
    await store.update(U, id, { rent: 2000 });
    await store.update(U, id, { utilities: 150 });
    expect((await store.read(U, id))!.data).toEqual({ groceries: 100, rent: 2000, utilities: 150 });
  });

  it("offline queue flushes in order with no loss", async () => {
    const { store } = fresh();
    const id = await store.create(U, "counter", { n: 0, a: false, b: false });
    store.goOffline();
    await store.update(U, id, { a: true });
    await store.update(U, id, { b: true });
    await store.update(U, id, { n: 9 });
    expect(store.queueLen()).toBe(3);
    expect((await store.read(U, id))!.data).toEqual({ n: 0, a: false, b: false }); // not applied yet
    await store.reconnect();
    expect(store.queueLen()).toBe(0);
    expect((await store.read(U, id))!.data).toEqual({ n: 9, a: true, b: true });
  });

  it("owner isolation: one user cannot read, update, or delete another's item", async () => {
    const { store } = fresh();
    const A = "userA";
    const B = "userB";
    const id = await store.create(A, "secret", { v: 1 });
    expect(await store.read(B, id)).toBeNull();
    expect(await store.update(B, id, { v: 2 })).toBe(false);
    await store.delete(B, id); // no-op for a non-owner
    expect((await store.read(A, id))!.data.v).toBe(1); // untouched
    expect((await store.listForUser(B)).length).toBe(0);
  });

  it("no loss under heavy churn: create 200, delete half, update the rest", async () => {
    const { adapter, store } = fresh();
    const ids: string[] = [];
    for (let i = 0; i < 200; i++) ids.push(await store.create(U, "task", { i, done: false }));
    for (let i = 0; i < ids.length; i += 2) await store.delete(U, ids[i]!);
    for (let i = 1; i < ids.length; i += 2) expect(await store.update(U, ids[i]!, { done: true })).toBe(true);
    const list = await store.listForUser(U);
    expect(list.length).toBe(100);
    expect(adapter.snapshotCount()).toBe(100);
    expect(list.every((it) => it.data.done === true)).toBe(true);
    expect(list.every((it) => (it.data.i as number) % 2 === 1)).toBe(true); // no deleted survivor
  });

  it("re-applying the same edit is idempotent (no duplicate, no corruption)", async () => {
    const { adapter, store } = fresh();
    const id = await store.create(U, "task", { text: "x", done: false });
    await store.update(U, id, { done: true });
    await store.update(U, id, { done: true }); // same edit again
    expect((await store.read(U, id))!.data.done).toBe(true);
    expect(adapter.snapshotCount()).toBe(1);
    expect((await store.listForUser(U)).length).toBe(1);
  });
});

import { describe, it, expect } from "vitest";
import { InMemoryAdapter } from "../src/core/inMemoryAdapter.js";
import { Store } from "../src/core/store.js";
import { SupabaseAdapter, wireTime } from "../src/core/supabaseAdapter.js";
import type { QueuedOp } from "../src/core/types.js";

// Phase 0 D8 (2026-10-10): the row has carried created_at since migration
// 0001 and no reader ever asked for it. Item.createdAt is now the one place
// the app reads it from, and this file pins the one shape both adapters
// answer: epoch ms, the same unit as serverTime. The Supabase side is proven
// through its row mapper (jarvis-app/src/data/supabaseAdapter.test.ts pins the
// select string and the ISO parse); here the in-memory adapter is held to the
// same rules, because every Store test in this repo runs on it.

describe("Phase 0 D8: createdAt on an Item", () => {
  it("is stamped from the server clock on a live create and read back unchanged", async () => {
    let wall = 1_700_000_000_000;
    const adapter = new InMemoryAdapter(() => wall);
    const id = await adapter.create("U", "task", { text: "Dated" });
    const made = wall;
    wall += 60_000;
    const row = await adapter.read("U", id);
    expect(row).toMatchObject({ id, ownerId: "U", entityType: "task", data: { text: "Dated" }, createdAt: made });
    expect(typeof row!.createdAt).toBe("number");
  });

  it("a given createdAt wins over the clock, which is how a replayed offline create is dated", async () => {
    let wall = 1_700_000_000_000;
    const adapter = new InMemoryAdapter(() => wall);
    const sixAm = wall - 5 * 3600_000;
    const id = await adapter.create("U", "note", { title: "Before the workout" }, undefined, sixAm);
    expect((await adapter.read("U", id))?.createdAt).toBe(sixAm);
    expect((await adapter.listForUser("U", "note"))[0]?.createdAt).toBe(sixAm);
  });

  it("an edit never moves it: createdAt is the birth, serverTime is the last write", async () => {
    let wall = 1_700_000_000_000;
    const adapter = new InMemoryAdapter(() => wall);
    const id = await adapter.create("U", "task", { text: "a", done: false });
    const before = await adapter.read("U", id);
    wall += 3600_000;
    await adapter.apply("U", id, { done: true });
    const after = await adapter.read("U", id);
    expect(after?.createdAt).toBe(before?.createdAt);
    expect(after!.serverTime).toBeGreaterThan(before!.serverTime);
  });

  it("createMany stamps every row the same way create does", async () => {
    const wall = 1_700_000_000_000;
    const adapter = new InMemoryAdapter(() => wall);
    const ids = await adapter.createMany("U", "contact", [{ name: "A" }, { name: "B" }]);
    for (const id of ids) expect((await adapter.read("U", id))?.createdAt).toBe(wall);
  });

  it("a read is a copy: mutating the answer never changes the stored createdAt", async () => {
    const adapter = new InMemoryAdapter(() => 1_700_000_000_000);
    const id = await adapter.create("U", "task", { text: "x" });
    const row = (await adapter.read("U", id))!;
    row.createdAt = 1;
    expect((await adapter.read("U", id))?.createdAt).toBe(1_700_000_000_000);
  });

  it("the Store shows the same createdAt online and for a pending offline create", async () => {
    const adapter = new InMemoryAdapter();
    const store = new Store(adapter);
    const live = await store.create("U", "task", { text: "live" });
    expect(typeof (await store.read("U", live))?.createdAt).toBe("number");

    store.goOffline();
    const before = Date.now();
    const held = await store.create("U", "task", { text: "held" });
    const pending = (await store.listForUser("U", "task")).find((i) => i.id === held);
    expect(pending?.createdAt).toBeGreaterThanOrEqual(before);
    // The pending copy and the queued op share one number (D1 change 2).
    expect(pending?.createdAt).toBe(pending?.serverTime);
  });
});

// Review finding 4 (2026-10-10): an age the wire cannot carry is omitted, never
// thrown. The mock client is the same chainable stand-in
// jarvis-app/src/data/supabaseAdapter.test.ts uses: every builder method
// records its call and returns itself; awaiting resolves the preset answer.
type Call = [string, unknown[]];
function mockClient(result: unknown) {
  const calls: Call[] = [];
  const chain = () => {
    const q: Record<string, unknown> = {};
    for (const m of ["insert", "select", "eq", "maybeSingle", "single", "delete", "update", "order", "range", "limit"]) {
      q[m] = (...a: unknown[]) => { calls.push([m, a]); return q; };
    }
    (q as { then: unknown }).then = (res: (v: unknown) => void) => res(result);
    return q;
  };
  return {
    calls,
    from(t: string) { calls.push(["from", [t]]); return chain(); },
    rpc(n: string, a: unknown) { calls.push(["rpc", [n, a]]); return chain(); },
  };
}
const find = (calls: Call[], name: string) => calls.find((c) => c[0] === name);

describe("an age the wire cannot carry is omitted, never thrown", () => {
  const BAD = [NaN, Infinity, -Infinity, 9e15, -1];

  it("wireTime answers an ISO string for a real moment and undefined for anything else", () => {
    expect(wireTime(1_700_000_000_000)).toBe("2023-11-14T22:13:20.000Z");
    expect(wireTime(0)).toBe("1970-01-01T00:00:00.000Z");
    expect(wireTime(undefined)).toBeUndefined();
    for (const b of BAD) expect(wireTime(b)).toBeUndefined();
  });

  it("create with NaN, Infinity or 9e15 sends no created_at and does not throw", async () => {
    for (const b of BAD) {
      const c = mockClient({ data: { id: "r1" }, error: null });
      await expect(new SupabaseAdapter(c as never).create("u1", "note", { title: "X" }, "r1", b)).resolves.toBe("r1");
      expect(find(c.calls, "insert")![1][0]).toEqual({ id: "r1", entity_type: "note", data: { title: "X" } });
    }
  });

  it("apply with NaN, Infinity or 9e15 sends the two arguments it always did, and applyIfOlder falls back to the plain merge", async () => {
    for (const b of BAD) {
      const c = mockClient({ data: true, error: null });
      await expect(new SupabaseAdapter(c as never).apply("u1", "r1", { title: "Y" }, undefined, b)).resolves.toBe(true);
      expect(find(c.calls, "rpc")![1]).toEqual(["item_apply_patch", { p_id: "r1", p_patch: { title: "Y" } }]);
      const older = mockClient({ data: true, error: null });
      await expect(new SupabaseAdapter(older as never).applyIfOlder("u1", "r1", { title: "Y" }, b)).resolves.toBe("applied");
      expect(find(older.calls, "rpc")![1][0]).toBe("item_apply_patch");
    }
  });

  it("a Store whose persisted queue holds a create with queuedAt NaN drains without throwing", async () => {
    const c = mockClient({ data: { id: "held-1" }, error: null });
    const queue: QueuedOp[] = [{ op: "create", id: "held-1", ownerId: "u1", entityType: "task", data: { text: "held" }, queuedAt: NaN }];
    const persistence = { load: () => queue, save: (q: QueuedOp[]) => { queue.splice(0, queue.length, ...q); } };
    const store = new Store(new SupabaseAdapter(c as never), persistence);
    expect(store.pending()).toBe(true);
    await expect(store.reconnect()).resolves.toBeUndefined();
    expect(store.pending()).toBe(false);
    expect(queue).toEqual([]);
    expect(find(c.calls, "insert")![1][0]).toEqual({ id: "held-1", entity_type: "task", data: { text: "held" } });
  });
});

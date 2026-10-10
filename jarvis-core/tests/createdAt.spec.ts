import { describe, it, expect } from "vitest";
import { InMemoryAdapter } from "../src/core/inMemoryAdapter.js";
import { Store } from "../src/core/store.js";

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

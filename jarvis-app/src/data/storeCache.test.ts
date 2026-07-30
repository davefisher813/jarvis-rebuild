import { describe, it, expect, vi, afterEach } from "vitest";
import { Store, InMemoryAdapter } from "@core";

// The listForUser read cache (cold-start fix): concurrent reads share one
// fetch, the result stays warm briefly, and every write invalidates.

function counting() {
  const adapter = new InMemoryAdapter();
  let calls = 0;
  const orig = adapter.listForUser.bind(adapter);
  adapter.listForUser = (ownerId: string) => { calls++; return orig(ownerId); };
  return { adapter, calls: () => calls };
}

afterEach(() => vi.useRealTimers());

describe("Store list cache", () => {
  it("coalesces a burst of reads into one adapter fetch (the boot pattern)", async () => {
    const { adapter, calls } = counting();
    const store = new Store(adapter);
    await Promise.all([store.listForUser("u1"), store.listForUser("u1"), store.listForUser("u1")]);
    await store.listForUser("u1"); // still inside the TTL window
    expect(calls()).toBe(1);
  });

  it("caches per user, not globally", async () => {
    const { adapter, calls } = counting();
    const store = new Store(adapter);
    await store.listForUser("u1");
    await store.listForUser("u2");
    expect(calls()).toBe(2);
  });

  it("a write invalidates, so reads after writes are always fresh", async () => {
    const { adapter, calls } = counting();
    const store = new Store(adapter);
    await store.listForUser("u1");
    const id = await store.create("u1", "task", { text: "x" });
    const after = await store.listForUser("u1");
    expect(calls()).toBe(2);
    expect(after.some((i) => i.id === id)).toBe(true);

    await store.update("u1", id, { text: "y" });
    expect((await store.listForUser("u1")).find((i) => i.id === id)?.data.text).toBe("y");

    await store.delete("u1", id);
    expect((await store.listForUser("u1")).some((i) => i.id === id)).toBe(false);
    expect(calls()).toBe(4);
  });

  it("expires after the TTL so external changes are picked up", async () => {
    vi.useFakeTimers();
    const { adapter, calls } = counting();
    const store = new Store(adapter);
    await store.listForUser("u1");
    vi.advanceTimersByTime(3100);
    await store.listForUser("u1");
    expect(calls()).toBe(2);
  });

  it("a failed fetch is not cached; the next read retries", async () => {
    const adapter = new InMemoryAdapter();
    let calls = 0;
    adapter.listForUser = () => { calls++; return calls === 1 ? Promise.reject(new Error("net")) : Promise.resolve([]); };
    const store = new Store(adapter);
    await expect(store.listForUser("u1")).rejects.toThrow("net");
    await expect(store.listForUser("u1")).resolves.toEqual([]);
    expect(calls).toBe(2);
  });

  it("offline queued updates still invalidate (queue replay stays authoritative)", async () => {
    const { adapter } = counting();
    const store = new Store(adapter);
    const id = await store.create("u1", "task", { text: "x" });
    await store.listForUser("u1");
    store.goOffline();
    await store.update("u1", id, { text: "offline edit" });
    store.goOffline(); // still offline; local list should not serve the stale cache blindly
    await store.reconnect();
    expect((await store.listForUser("u1")).find((i) => i.id === id)?.data.text).toBe("offline edit");
  });
});

describe("Store createMany (bulk import)", () => {
  it("creates a batch in order and invalidates the list cache once", async () => {
    const adapter = new InMemoryAdapter();
    let listCalls = 0;
    const orig = adapter.listForUser.bind(adapter);
    adapter.listForUser = (o: string) => { listCalls++; return orig(o); };
    const store = new Store(adapter);
    await store.listForUser("u1");
    const ids = await store.createMany("u1", "person", [{ name: "A" }, { name: "B" }, { name: "C" }]);
    expect(ids).toHaveLength(3);
    const after = await store.listForUser("u1");
    expect(after.map((i) => i.data.name)).toEqual(["A", "B", "C"]);
    expect(listCalls).toBe(2); // cached read + one fresh read after the batch
  });

  it("empty batch is a no-op", async () => {
    const store = new Store(new InMemoryAdapter());
    expect(await store.createMany("u1", "person", [])).toEqual([]);
  });
});

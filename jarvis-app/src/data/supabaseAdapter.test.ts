import { describe, it, expect } from "vitest";
import { SupabaseAdapter } from "@core";

// A chainable, awaitable stand-in for the supabase-js query builder. Every
// builder method records its call and returns the same object; awaiting it
// resolves the preset {data,error}. Lets us assert the adapter issues the
// right table / rpc / payload without any network.
type Call = [string, unknown[]];
function chain(result: unknown, calls: Call[]) {
  const q: Record<string, unknown> = {};
  for (const m of ["insert", "select", "eq", "maybeSingle", "single", "delete", "update", "order", "range"]) {
    q[m] = (...a: unknown[]) => { calls.push([m, a]); return q; };
  }
  (q as { then: unknown }).then = (res: (v: unknown) => void) => res(result);
  return q;
}
function mockClient(result: unknown) {
  const calls: Call[] = [];
  return {
    calls,
    from(t: string) { calls.push(["from", [t]]); return chain(result, calls); },
    rpc(n: string, a: unknown) { calls.push(["rpc", [n, a]]); return chain(result, calls); },
  };
}

const ROW = { id: "r1", owner_id: "u1", entity_type: "note", data: { title: "X" }, updated_at: "2026-05-20T10:00:00Z", created_at: "2026-05-19T08:00:00Z" };
const find = (calls: Call[], name: string) => calls.find((c) => c[0] === name);

describe("SupabaseAdapter (mock client, no network)", () => {
  it("create inserts entity_type + data into 'item' and returns the new id", async () => {
    const c = mockClient({ data: { id: "r1" }, error: null });
    const id = await new SupabaseAdapter(c as never).create("u1", "note", { title: "X" });
    expect(id).toBe("r1");
    expect(find(c.calls, "from")![1][0]).toBe("item");
    expect(find(c.calls, "insert")![1][0]).toEqual({ entity_type: "note", data: { title: "X" } });
  });

  it("read maps a row to an Item with ownerId and epoch serverTime", async () => {
    const c = mockClient({ data: ROW, error: null });
    const item = await new SupabaseAdapter(c as never).read("u1", "r1");
    expect(item).toMatchObject({ id: "r1", ownerId: "u1", entityType: "note" });
    expect(item!.serverTime).toBe(Date.parse("2026-05-20T10:00:00Z"));
  });

  // Phase 0 D8 and D1 change 2 (2026-10-10): the app reads created_at, and a
  // write held offline carries the moment it was made.
  it("read and list both select created_at, and map it to createdAt", async () => {
    const c1 = mockClient({ data: ROW, error: null });
    const item = await new SupabaseAdapter(c1 as never).read("u1", "r1");
    expect(find(c1.calls, "select")![1][0]).toMatch(/\bcreated_at\b/);
    expect(item!.createdAt).toBe(Date.parse("2026-05-19T08:00:00Z"));
    const c2 = mockClient({ data: [ROW], error: null });
    const [listed] = await new SupabaseAdapter(c2 as never).listForUser("u1", "note");
    expect(find(c2.calls, "select")![1][0]).toMatch(/\bcreated_at\b/);
    expect(listed!.createdAt).toBe(Date.parse("2026-05-19T08:00:00Z"));
  });

  it("create with createdAt sends created_at, and without it sends none", async () => {
    const made = Date.parse("2026-05-19T06:02:00Z");
    const c = mockClient({ data: { id: "r1" }, error: null });
    await new SupabaseAdapter(c as never).create("u1", "note", { title: "X" }, "r1", made);
    expect(find(c.calls, "insert")![1][0]).toEqual({ id: "r1", created_at: new Date(made).toISOString(), entity_type: "note", data: { title: "X" } });
    const plain = mockClient({ data: { id: "r2" }, error: null });
    await new SupabaseAdapter(plain as never).create("u1", "note", { title: "X" });
    expect(find(plain.calls, "insert")![1][0]).not.toHaveProperty("created_at");
  });

  // Review finding 4 (2026-10-10): an age that is not a real moment is omitted, never a RangeError at the head of the queue.
  it("create and apply with NaN, Infinity or 9e15 send no age and do not throw", async () => {
    for (const bad of [NaN, Infinity, 9e15]) {
      const c = mockClient({ data: { id: "r1" }, error: null });
      await expect(new SupabaseAdapter(c as never).create("u1", "note", { title: "X" }, "r1", bad)).resolves.toBe("r1");
      expect(find(c.calls, "insert")![1][0]).toEqual({ id: "r1", entity_type: "note", data: { title: "X" } });
      const a = mockClient({ data: true, error: null });
      await expect(new SupabaseAdapter(a as never).apply("u1", "r1", { title: "Y" }, undefined, bad)).resolves.toBe(true);
      expect(find(a.calls, "rpc")![1]).toEqual(["item_apply_patch", { p_id: "r1", p_patch: { title: "Y" } }]);
    }
  });

  it("apply with clientAt sends p_client_at, and without it sends the two arguments it always did", async () => {
    const made = Date.parse("2026-05-19T09:00:00Z");
    const c = mockClient({ data: true, error: null });
    await new SupabaseAdapter(c as never).apply("u1", "r1", { title: "Y" }, undefined, made);
    expect(find(c.calls, "rpc")![1]).toEqual(["item_apply_patch", { p_id: "r1", p_patch: { title: "Y" }, p_client_at: new Date(made).toISOString() }]);
  });

  it("read returns null when the row is missing or not owned", async () => {
    const c = mockClient({ data: null, error: null });
    expect(await new SupabaseAdapter(c as never).read("u1", "missing")).toBeNull();
  });

  it("apply calls the server-side merge rpc and returns its boolean", async () => {
    const c = mockClient({ data: true, error: null });
    const ok = await new SupabaseAdapter(c as never).apply("u1", "r1", { title: "Y" });
    expect(ok).toBe(true);
    expect(find(c.calls, "rpc")![1]).toEqual(["item_apply_patch", { p_id: "r1", p_patch: { title: "Y" } }]);
  });

  it("del is a HARD delete (no tombstone update)", async () => {
    const c = mockClient({ data: null, error: null });
    await new SupabaseAdapter(c as never).del("u1", "r1");
    expect(find(c.calls, "delete")).toBeTruthy();
    expect(find(c.calls, "update")).toBeUndefined(); // never flips a deleted flag
  });

  it("listForUser maps every row", async () => {
    const c = mockClient({ data: [ROW, { ...ROW, id: "r2" }], error: null });
    const items = await new SupabaseAdapter(c as never).listForUser("u1");
    expect(items.map((i) => i.id)).toEqual(["r1", "r2"]);
  });

  it("throws when the backend returns an error", async () => {
    const c = mockClient({ data: null, error: { message: "boom" } });
    await expect(new SupabaseAdapter(c as never).create("u1", "note", {})).rejects.toBeTruthy();
  });
});

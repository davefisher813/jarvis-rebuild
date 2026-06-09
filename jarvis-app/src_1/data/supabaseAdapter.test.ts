import { describe, it, expect } from "vitest";
import { SupabaseAdapter } from "@core";

// A chainable, awaitable stand-in for the supabase-js query builder. Every
// builder method records its call and returns the same object; awaiting it
// resolves the preset {data,error}. Lets us assert the adapter issues the
// right table / rpc / payload without any network.
type Call = [string, unknown[]];
function chain(result: unknown, calls: Call[]) {
  const q: Record<string, unknown> = {};
  for (const m of ["insert", "select", "eq", "maybeSingle", "single", "delete", "update", "order"]) {
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

const ROW = { id: "r1", owner_id: "u1", entity_type: "note", data: { title: "X" }, updated_at: "2026-05-20T10:00:00Z" };
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

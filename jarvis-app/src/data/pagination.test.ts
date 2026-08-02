import { describe, it, expect } from "vitest";
import { createSupabaseAdapter } from "@core";

// PostgREST silently truncates at max-rows (1000 by default): a short array,
// no error. Since every service reads the whole item table through
// listForUser, an un-paged read would make a heavy user's data start
// vanishing with nothing in the logs. These lock the paging in.
//
// A hand-rolled fake stands in for the Supabase client so the assertions are
// about OUR paging maths, not about the network.
function fakeDb(totalRows: number, pageCap = 1000) {
  const calls: Array<[number, number]> = [];
  const rows = Array.from({ length: totalRows }, (_, i) => ({
    id: String(i).padStart(6, "0"),
    owner_id: "u1",
    entity_type: "task",
    data: { text: "t" + i },
    updated_at: "2026-08-02T00:00:00Z",
  }));
  const builder = () => {
    const q: Record<string, unknown> = {};
    const api = {
      select: () => api,
      order: () => api,
      range: (from: number, to: number) => {
        calls.push([from, to]);
        const slice = rows.slice(from, Math.min(to + 1, from + pageCap));
        return Promise.resolve({ data: slice, error: null });
      },
    };
    return q && api;
  };
  return { db: { from: () => builder() }, calls };
}

function adapterOver(db: unknown) {
  // createSupabaseAdapter builds its own client, so reach the class through a
  // cast: the paging logic under test lives on the instance, not the factory.
  const a = createSupabaseAdapter("https://x.supabase.co", "anon") as unknown as {
    db: unknown;
    listForUser(o: string): Promise<unknown[]>;
  };
  a.db = db;
  return a;
}

describe("listForUser paging", () => {
  it("returns everything when the table is under one page", async () => {
    const { db, calls } = fakeDb(37);
    const items = await adapterOver(db).listForUser("u1");
    expect(items).toHaveLength(37);
    expect(calls).toHaveLength(1); // a short page proves the end, so stop
  });

  it("keeps paging past the 1000-row cap instead of truncating", async () => {
    const { db, calls } = fakeDb(2500);
    const items = await adapterOver(db).listForUser("u1");
    expect(items).toHaveLength(2500);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls[0]).toEqual([0, 999]);
    expect(calls[1]).toEqual([1000, 1999]);
  });

  it("handles an exact multiple of the page size without dropping or looping", async () => {
    const { db, calls } = fakeDb(2000);
    const items = await adapterOver(db).listForUser("u1");
    expect(items).toHaveLength(2000);
    // two full pages, then one empty page to prove there is no more
    expect(calls).toHaveLength(3);
  });

  it("returns an empty list for an empty table", async () => {
    const { db } = fakeDb(0);
    expect(await adapterOver(db).listForUser("u1")).toHaveLength(0);
  });
});

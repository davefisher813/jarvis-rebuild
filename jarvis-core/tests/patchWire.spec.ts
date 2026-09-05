import { describe, it, expect } from "vitest";
import { InMemoryAdapter } from "../src/core/inMemoryAdapter.js";
import { Store, type StorePersistence } from "../src/core/store.js";
import { mergePatch, stripNulls, toWire } from "../src/core/patch.js";
import type { DataAdapter } from "../src/core/adapter.js";
import type { ItemData, QueuedOp, ServerTime } from "../src/core/types.js";

// SCHED-F-01 (2026-09-05): the wire shape of a clear. Every service said
// "remove this field" with `undefined`; JSON.stringify drops the key, the
// server's `data || p_patch` never sees it, and the old value comes back on
// the next refresh. These tests pin the contract at the seam: what leaves
// Store is null, null survives the JSON round trip, and a jsonb-style merge
// of it clears the field.

// Records exactly what the adapter is handed, then applies it the way the
// real backend does: postgrest-js JSON-encodes the body, Postgres runs
// `jsonb_strip_nulls(data || p_patch)` (migrations 0001 + 0031).
function jsonbAdapter(): DataAdapter & { received: ItemData[]; rows: Map<string, ItemData> } {
  const rows = new Map<string, ItemData>();
  const received: ItemData[] = [];
  let seq = 0;
  return {
    received,
    rows,
    async create(_o: string, _t: string, data: ItemData, id?: string) {
      const useId = id ?? "row" + ++seq;
      rows.set(useId, JSON.parse(JSON.stringify(data)) as ItemData);
      return useId;
    },
    async createMany(o: string, t: string, datas: ItemData[]) {
      const ids: string[] = [];
      for (const d of datas) ids.push(await this.create(o, t, d));
      return ids;
    },
    async read(o: string, id: string) {
      const data = rows.get(id);
      return data ? { id, ownerId: o, entityType: "event", data, serverTime: 1 } : null;
    },
    async apply(_o: string, id: string, patch: ItemData, _st?: ServerTime) {
      received.push(patch);
      const cur = rows.get(id);
      if (!cur) return false;
      const wire = JSON.parse(JSON.stringify(patch)) as ItemData; // the body postgrest sends
      rows.set(id, stripNulls({ ...cur, ...wire }) as ItemData); // jsonb_strip_nulls(data || p_patch)
      return true;
    },
    async del(_o: string, id: string) { rows.delete(id); },
    async listForUser(o: string) {
      return [...rows.entries()].map(([id, data]) => ({ id, ownerId: o, entityType: "event", data, serverTime: 1 }));
    },
  };
}

describe("SCHED-F-01: a clear leaves Store as null, never undefined", () => {
  it("toWire maps every top-level undefined to null and leaves everything else alone", () => {
    const out = toWire({ recurrence: undefined, until: undefined, title: "Run", n: 0, nested: { a: undefined } } as unknown as ItemData);
    expect(Object.prototype.hasOwnProperty.call(out, "recurrence")).toBe(true);
    expect(out.recurrence).toBeNull();
    expect(out.until).toBeNull();
    expect(out.title).toBe("Run");
    expect(out.n).toBe(0);
    // Only the top level is the contract: a nested undefined is inside a value
    // the server replaces wholesale, so it simply vanishes, as JSON would have it.
    expect(JSON.parse(JSON.stringify(out.nested))).toEqual({});
  });

  it("{recurrence: undefined} reaches the adapter as {recurrence: null}, and the clear survives the JSON round trip", async () => {
    const adapter = jsonbAdapter();
    const store = new Store(adapter);
    const id = await store.create("U", "event", { title: "Lift", recurrence: "weekly", until: "2026-12-01" });

    await store.update("U", id, { recurrence: undefined, until: undefined } as unknown as ItemData);

    const sent = adapter.received[0]!;
    expect(Object.prototype.hasOwnProperty.call(sent, "recurrence")).toBe(true);
    expect(sent.recurrence).toBeNull();
    expect(sent.until).toBeNull();
    // What postgrest-js actually puts on the wire still carries the key.
    expect(JSON.parse(JSON.stringify(sent))).toEqual({ recurrence: null, until: null });
    // And the server-side merge removes it from the row.
    expect(adapter.rows.get(id)).toEqual({ title: "Lift" });
  });

  it("the same clear queued offline is persisted as null and replays as null", async () => {
    let stored: QueuedOp[] = [];
    const persistence: StorePersistence = { load: () => stored, save: (q) => { stored = JSON.parse(JSON.stringify(q)) as QueuedOp[]; } };
    const adapter = jsonbAdapter();
    const store = new Store(adapter, persistence);
    const id = await store.create("U", "event", { title: "Lift", end: "08:00" });
    store.goOffline();
    await store.update("U", id, { end: undefined } as unknown as ItemData);
    // The persisted op (a JSON round trip, like localStorage) still says end: null.
    expect(stored).toHaveLength(1);
    expect((stored[0] as { patch: ItemData }).patch).toEqual({ end: null });
    await store.reconnect();
    expect(adapter.received.at(-1)).toEqual({ end: null });
    expect(adapter.rows.get(id)).toEqual({ title: "Lift" });
  });

  it("control: the same patch handed straight to a jsonb-style adapter does NOT clear (the bug, isolated)", async () => {
    const adapter = jsonbAdapter();
    const id = await adapter.create("U", "event", { title: "Lift", recurrence: "weekly" });
    await adapter.apply("U", id, { recurrence: undefined } as unknown as ItemData);
    expect(adapter.rows.get(id)).toEqual({ title: "Lift", recurrence: "weekly" });
  });
});

describe("SCHED-F-01: InMemoryAdapter merges like the server, so tests see what the phone sees", () => {
  it("an undefined value handed directly to apply leaves the old value (JSON never carried the key)", async () => {
    const adapter = new InMemoryAdapter();
    const id = await adapter.create("U", "event", { title: "Lift", recurrence: "weekly" });
    await adapter.apply("U", id, { recurrence: undefined } as unknown as ItemData);
    expect((await adapter.read("U", id))!.data).toEqual({ title: "Lift", recurrence: "weekly" });
  });

  it("a null value clears the key and the row no longer carries it", async () => {
    const adapter = new InMemoryAdapter();
    const id = await adapter.create("U", "event", { title: "Lift", recurrence: "weekly", exdates: ["2026-09-14"] });
    await adapter.apply("U", id, { recurrence: null, exdates: null });
    const data = (await adapter.read("U", id))!.data;
    expect(data).toEqual({ title: "Lift" });
    expect(Object.keys(data)).toEqual(["title"]);
  });

  it("a missing key leaves the old value untouched (shallow merge, like data || p_patch)", async () => {
    const adapter = new InMemoryAdapter();
    const id = await adapter.create("U", "event", { title: "Lift", trained: { "2026-09-01": 40 } });
    await adapter.apply("U", id, { title: "Push" });
    expect((await adapter.read("U", id))!.data).toEqual({ title: "Push", trained: { "2026-09-01": 40 } });
  });

  it("mergePatch strips nulls at every depth but leaves null array elements alone, as jsonb_strip_nulls does", () => {
    const out = mergePatch({ a: 1 }, { b: { c: null, d: [null, { e: null, f: 2 }] }, g: null });
    expect(out).toEqual({ a: 1, b: { d: [null, { f: 2 }] } });
  });
});

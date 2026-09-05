// @vitest-environment jsdom
// Laws for the preload layer (addendum locked principle 2): lists answer
// instantly from cache, a background refresh repaints only on real change,
// mutations write through so a flow always reads its own writes, and
// pre-generation is capped, cache-first, and gated by AI Control.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { InMemoryAdapter, type DataAdapter, type Item, type ItemData, type ServerTime } from "@core";
import { CachedAdapter } from "./CachedAdapter";
import { readPreload, writePreload, clearPreload, listSignature } from "./preloadCache";
import { cachedDraft, contentHash, pregenerate, rememberDraft, PREGEN_CAP } from "../ai/pregen";
import { setAIControl } from "../ai/levelStore";

const U = "user1";

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { localStorage.clear(); });
afterEach(() => { setAIControl(undefined); localStorage.clear(); });

describe("preload cache", () => {
  it("round-trips a typed list and refuses another owner's cache", () => {
    const items: Item[] = [{ id: "a", ownerId: U, entityType: "task", data: { text: "t" }, serverTime: 1 }];
    writePreload(U, "task", items);
    expect(readPreload(U, "task")).toEqual(items);
    expect(readPreload("someone-else", "task")).toBeNull();
  });

  it("clearPreload removes every cached type and nothing else", () => {
    writePreload(U, "task", []);
    writePreload(U, "note", []);
    localStorage.setItem("jarvis.appearance", "keep");
    clearPreload();
    expect(readPreload(U, "task")).toBeNull();
    expect(readPreload(U, "note")).toBeNull();
    expect(localStorage.getItem("jarvis.appearance")).toBe("keep");
  });

  it("an oversized list is not cached at all, never truncated", () => {
    const items: Item[] = Array.from({ length: 501 }, (_, i) => ({
      id: "i" + i, ownerId: U, entityType: "task", data: {}, serverTime: i,
    }));
    writePreload(U, "task", items);
    expect(readPreload(U, "task")).toBeNull();
  });
});

describe("stale-while-revalidate adapter", () => {
  it("a cold list hits the network and warms the cache", async () => {
    const inner = new InMemoryAdapter();
    await inner.create(U, "task", { text: "a" });
    const adapter = new CachedAdapter(inner);
    const out = await adapter.listForUser(U, "task");
    expect(out.length).toBe(1);
    expect(readPreload(U, "task")!.length).toBe(1);
  });

  it("a warm list answers from cache and repaints only on real change", async () => {
    const inner = new InMemoryAdapter();
    await inner.create(U, "task", { text: "a" });
    const fresh: string[] = [];
    const adapter = new CachedAdapter(inner, (t) => fresh.push(t));
    await adapter.listForUser(U, "task"); // warm
    await adapter.listForUser(U, "task"); // cached, refresh finds no change
    await flush();
    expect(fresh).toEqual([]);
    await inner.create(U, "task", { text: "b" }); // change behind the cache
    await adapter.listForUser(U, "task");
    await flush();
    expect(fresh).toEqual(["task"]);
  });

  it("read-your-writes: create, patch, and delete all show in the next cached list", async () => {
    const inner = new InMemoryAdapter();
    const adapter = new CachedAdapter(inner);
    const first = await adapter.create(U, "task", { text: "a", done: false });
    await adapter.listForUser(U, "task"); // warm the cache
    const second = await adapter.create(U, "task", { text: "b", done: false });
    let list = await adapter.listForUser(U, "task");
    expect(list.map((i) => i.id).sort()).toEqual([first, second].sort());
    await adapter.apply(U, first, { done: true });
    list = await adapter.listForUser(U, "task");
    expect(list.find((i) => i.id === first)!.data.done).toBe(true);
    await adapter.del(U, second);
    list = await adapter.listForUser(U, "task");
    expect(list.some((i) => i.id === second)).toBe(false);
  });

  // SCHED-F-01 (2026-09-05): the write-through merges like the server (a
  // null clears and is stripped), so the cached row is the shape the refresh
  // brings back. A plain spread used to leave `recurrence: null` sitting in
  // the cache until the next refresh replaced it.
  it("read-your-writes: a cleared field (null) leaves the cached row entirely, matching the server", async () => {
    const inner = new InMemoryAdapter();
    const adapter = new CachedAdapter(inner);
    const id = await adapter.create(U, "event", { title: "Lift", recurrence: "weekly", until: "2026-12-01" });
    await adapter.listForUser(U, "event"); // warm the cache
    await adapter.apply(U, id, { recurrence: null, until: null });
    const cached = readPreload(U, "event")!.find((i) => i.id === id)!;
    expect(cached.data).toEqual({ title: "Lift" });
    expect(Object.keys(cached.data)).toEqual(["title"]);
    // And the cached row holds exactly what the server row holds.
    expect(cached.data).toEqual((await inner.read(U, id))!.data);
  });

  it("untyped lists bypass the cache so backup always reads the truth", async () => {
    const inner = new InMemoryAdapter();
    const adapter = new CachedAdapter(inner);
    await adapter.create(U, "task", { text: "a" });
    await adapter.listForUser(U, "task");
    const all = await adapter.listForUser(U);
    expect(all.length).toBe(1);
    // No untyped cache entry was written.
    expect(localStorage.getItem("jarvis.preload.v1" + ".undefined")).toBeNull();
  });

  it("listSignature detects both membership and content change", () => {
    const a: Item = { id: "a", ownerId: U, entityType: "task", data: {}, serverTime: 1 };
    expect(listSignature([a])).not.toBe(listSignature([]));
    expect(listSignature([a])).not.toBe(listSignature([{ ...a, serverTime: 2 }]));
    expect(listSignature([a])).toBe(listSignature([{ ...a }]));
  });
});

// THE REFRESH THAT ARRIVED LATE (Dave 2026-08-30, from his phone: "things
// aren't clearing. There's bugs with tasks and reminders. They eventually
// did but it took a couple of tries").
//
// Read-your-writes above is tested only in the quiet case, where no refresh
// is in flight. But a refresh is a NETWORK ROUND TRIP, and the one fired by
// the list render he is looking at is still open when he ticks something a
// second later. That refresh captured the server's list BEFORE the tick, and
// on arrival it called writePreload unconditionally -- overwriting the
// write-through that had just marked the task done. The next reload read the
// clobbered cache and the task came back undone.
//
// "A couple of tries" is the signature of exactly this: the second tick
// usually lands with no refresh in flight, so it sticks.
//
// The harness holds a refresh open on demand and resolves it with the
// snapshot the server would have returned at the moment the read started,
// which is precisely the pre-write list.
class HeldRefresh implements DataAdapter {
  private release: (() => void) | null = null;
  hold = false;
  constructor(private inner: DataAdapter) {}
  create(o: string, t: string, d: ItemData) { return this.inner.create(o, t, d); }
  createMany(o: string, t: string, d: ItemData[]) { return this.inner.createMany(o, t, d); }
  read(o: string, id: string) { return this.inner.read(o, id); }
  apply(o: string, id: string, p: ItemData, st?: ServerTime) { return this.inner.apply(o, id, p, st); }
  del(o: string, id: string) { return this.inner.del(o, id); }
  async listForUser(o: string, t?: string): Promise<Item[]> {
    const snapshot = await this.inner.listForUser(o, t);
    if (!this.hold) return snapshot;
    // Resolves with the snapshot taken BEFORE the caller's next write, which
    // is what a round trip that started earlier actually returns.
    return new Promise<Item[]>((resolve) => { this.release = () => resolve(snapshot); });
  }
  /** Let the held refresh land. */
  land(): void { const r = this.release; this.release = null; r?.(); }
}

describe("law: a background refresh never discards a newer write", () => {
  it("a tick that lands mid-refresh survives the refresh (the reason it took two tries)", async () => {
    const inner = new InMemoryAdapter();
    const id = await inner.create(U, "task", { text: "Clean out closet", done: false });
    const held = new HeldRefresh(inner);
    const adapter = new CachedAdapter(held);

    await adapter.listForUser(U, "task"); // cold: warms the cache

    // The render he is looking at. Answers from cache and opens a refresh.
    held.hold = true;
    await adapter.listForUser(U, "task");
    await flush();

    // He ticks it while that refresh is still open.
    await adapter.apply(U, id, { done: true });
    expect(readPreload(U, "task")!.find((i) => i.id === id)!.data.done).toBe(true);

    // The refresh lands, carrying the server's PRE-tick list.
    held.hold = false;
    held.land();
    await flush();

    // It must not have undone the tick.
    expect(readPreload(U, "task")!.find((i) => i.id === id)!.data.done).toBe(true);
    const list = await adapter.listForUser(U, "task");
    expect(list.find((i) => i.id === id)!.data.done).toBe(true);
  });

  it("a delete that lands mid-refresh is not resurrected by it", async () => {
    const inner = new InMemoryAdapter();
    const id = await inner.create(U, "task", { text: "gone" });
    const held = new HeldRefresh(inner);
    const adapter = new CachedAdapter(held);

    await adapter.listForUser(U, "task");
    held.hold = true;
    await adapter.listForUser(U, "task");
    await flush();

    await adapter.del(U, id);
    held.hold = false;
    held.land();
    await flush();

    // The tombstone-resurrection feel this whole rebuild exists to kill.
    expect(readPreload(U, "task")!.some((i) => i.id === id)).toBe(false);
  });

  // The guard drops a refresh, so the cache stays on the local write until a
  // later refresh brings the server's version. Today now REPAINTS on every
  // onFresh, so if that exchange could not settle, the home page would reload
  // itself forever. This walks the real loop -- list, repaint, list -- and
  // asserts it goes quiet, rather than trusting that it must.
  it("the write/refresh exchange settles instead of repainting forever", async () => {
    const inner = new InMemoryAdapter();
    const id = await inner.create(U, "task", { text: "t", done: false });
    const held = new HeldRefresh(inner);
    let repaints = 0;
    const adapter: CachedAdapter = new CachedAdapter(held, () => {
      repaints++;
      // What a subscribed surface does with the notification: list again.
      if (repaints < 20) void adapter.listForUser(U, "task");
    });

    await adapter.listForUser(U, "task"); // warm
    held.hold = true;
    await adapter.listForUser(U, "task");
    await flush();
    await adapter.apply(U, id, { done: true }); // races the open refresh
    held.hold = false;
    held.land();
    await flush();

    // Let the loop run itself out.
    for (let i = 0; i < 10; i++) await flush();

    expect(repaints, "it converges quickly, it does not spin").toBeLessThan(5);
    const list = await adapter.listForUser(U, "task");
    expect(list.find((i) => i.id === id)!.data.done, "and settles on the write").toBe(true);
  });

  it("with no write racing it, a refresh still updates the cache and repaints", async () => {
    // The guard must not cost the feature: this is the ordinary path.
    const inner = new InMemoryAdapter();
    await inner.create(U, "task", { text: "a" });
    const fresh: string[] = [];
    const adapter = new CachedAdapter(inner, (t) => fresh.push(t));
    await adapter.listForUser(U, "task");
    await inner.create(U, "task", { text: "b" }); // changed behind the cache
    await adapter.listForUser(U, "task");
    await flush();
    expect(fresh).toEqual(["task"]);
    expect(readPreload(U, "task")!.length).toBe(2);
  });
});

describe("law: pre-generation is capped, cache-first, and obeys AI Control", () => {
  const req = (id: string, calls: { n: number }) => ({
    kind: "reply",
    sourceId: id,
    hash: "h1",
    build: async () => { calls.n++; return "draft " + id; },
  });

  it("generates on miss, then serves from cache with zero calls", async () => {
    setAIControl({ level: "draft" });
    const calls = { n: 0 };
    await pregenerate([req("s1", calls)]);
    expect(calls.n).toBe(1);
    expect(cachedDraft("reply", "s1", "h1")).toBe("draft s1");
    await pregenerate([req("s1", calls)]);
    expect(calls.n).toBe(1); // cache hit, no second call
  });

  it("regenerates only when the source hash changes", async () => {
    setAIControl({ level: "draft" });
    const calls = { n: 0 };
    await pregenerate([req("s1", calls)]);
    await pregenerate([{ ...req("s1", calls), hash: "h2" }]);
    expect(calls.n).toBe(2);
    expect(cachedDraft("reply", "s1", "h1")).toBeNull();
    expect(cachedDraft("reply", "s1", "h2")).toBe("draft s1");
  });

  it("caps a pass at five calls", async () => {
    setAIControl({ level: "everything" });
    const calls = { n: 0 };
    const many = Array.from({ length: 9 }, (_, i) => req("s" + i, calls));
    const made = await pregenerate(many);
    expect(made).toBe(PREGEN_CAP);
    expect(calls.n).toBe(PREGEN_CAP);
  });

  it("Off and On Request produce ZERO pre-generation calls", async () => {
    for (const level of ["off", "request"] as const) {
      const calls = { n: 0 };
      setAIControl({ level });
      const made = await pregenerate([req("s-" + level, calls)]);
      expect(made).toBe(0);
      expect(calls.n).toBe(0);
    }
  });

  it("a pinned-off feature is skipped even when the master allows background", async () => {
    setAIControl({ level: "everything", pins: { emailDrafts: "off" } });
    const calls = { n: 0 };
    await pregenerate([{ ...req("s9", calls), pin: "emailDrafts" }]);
    expect(calls.n).toBe(0);
  });

  // The write half, added 2026-08-24 with the first real consumer. Without
  // it the cache only ever filled from the background pass, so a draft the
  // user actually WAITED for was thrown away when the card closed and
  // rebuilt from scratch the next time they opened it.
  it("remembers a draft the foreground built, at the same key", () => {
    rememberDraft("reply", "fg1", "h1", "typed by hand");
    expect(cachedDraft("reply", "fg1", "h1")).toBe("typed by hand");
  });

  it("a remembered draft counts as a cache hit, so the pass skips it", async () => {
    setAIControl({ level: "draft" });
    const calls = { n: 0 };
    rememberDraft("reply", "fg2", "h1", "already here");
    await pregenerate([req("fg2", calls)]);
    expect(calls.n).toBe(0);
  });

  // It stores what the user waited for; it is not a way around the gate.
  it("remembering is not a model call, so Off can still hold a draft", () => {
    setAIControl({ level: "off" });
    rememberDraft("reply", "fg3", "h1", "asked for explicitly");
    expect(cachedDraft("reply", "fg3", "h1")).toBe("asked for explicitly");
  });

  it("refuses to remember an empty draft, which would look like a hit", () => {
    rememberDraft("reply", "fg4", "h1", "");
    expect(cachedDraft("reply", "fg4", "h1")).toBeNull();
  });

  it("contentHash is stable and change-sensitive", () => {
    expect(contentHash("abc")).toBe(contentHash("abc"));
    expect(contentHash("abc")).not.toBe(contentHash("abd"));
  });
});

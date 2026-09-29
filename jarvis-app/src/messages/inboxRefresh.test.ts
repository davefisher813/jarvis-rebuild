import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  refreshInboxAccount, refreshInboxAccounts, loadMoreInbox, ensureThreadAnalysis, splitForSize, markGone, unmarkGone,
  resetInboxRefreshState, singleFlight, pool, ANALYSIS_COOLDOWN_MS, TRIAGE_BATCH, MAIL_PAGE,
} from "./inboxRefresh";
import { FakeMailbox } from "./fakeMailbox";
import { loadAccount, loadRows, isFresh, markRead, saveAccount } from "./mailCache";
import { loadTriageFor, saveTriageFor, isAnalysed, buildTriageInput } from "./triage";
import { AIBudgetError } from "../ai/aiBudget";
import type { AIService } from "../ai/AIService";
import type { ThreadRow } from "../connections/google/map";

// The claim this file exists to prove: reopening an unchanged inbox is TWO
// SMALL READS. No thread metadata, no bodies, no paid AI. One new reply reads
// and analyses one thread. A failure advances nothing.

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    raw: m,
  };
}
type Mem = ReturnType<typeof memStorage>;

const scope = { userId: "u1", account: "dave@example.com" };
let box: FakeMailbox;
let storage: Mem;
let t = 1_800_000_000_000;
const clock = () => t;
const deps = () => ({ storage, now: clock });

beforeEach(() => {
  resetInboxRefreshState();
  box = new FakeMailbox("dave@example.com");
  storage = memStorage();
  t = 1_800_000_000_000;
  for (let i = 1; i <= 5; i++) box.add("t" + i);
});

const zero = () => ({ list: 0, history: 0, metadata: 0, bodies: 0, mutation: 0, profile: 0 });
function measure<T>(fn: () => Promise<T>): Promise<{ r: T; cost: ReturnType<typeof zero> }> {
  const before = { ...box.counters };
  return fn().then((r) => ({
    r,
    cost: Object.fromEntries(Object.entries(box.counters).map(([k, v]) => [k, v - before[k as keyof typeof before]])) as ReturnType<typeof zero>,
  }));
}

describe("bootstrap", () => {
  it("reads the window once, keeps a string checkpoint, and persists", async () => {
    const { r, cost } = await measure(() => refreshInboxAccount(scope, box.api(), deps()));
    expect(r.ok).toBe(true);
    expect(r.bootstrapped).toBe(true);
    expect(r.rows).toHaveLength(5);
    expect(cost.metadata).toBe(5);
    expect(cost.bodies).toBe(0);
    const c = loadAccount(scope, t, storage)!;
    expect(typeof c.historyId).toBe("string");
    // Larger than 2**53: a number-typed checkpoint would have rounded it.
    expect(c.historyId).toBe(box.historyId);
    expect(BigInt(c.historyId!) > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(c.rows.every((x) => x.account === "dave@example.com")).toBe(true);
    expect(c.complete).toBe(true);
  });

  it("a change that lands while the window is being read is not lost", async () => {
    let fired = false;
    const api = box.api({
      getThreadMeta: async (id) => {
        box.counters.metadata++;
        if (!fired) { fired = true; box.receive("t3", { snippet: "arrived mid-read" }); }
        const th = box.threads.get(id);
        return th ? (await box.api().getThreadMeta(id)) : null;
      },
    });
    const r = await refreshInboxAccount(scope, api, deps());
    expect(r.ok).toBe(true);
    expect(r.rows.find((x) => x.id === "t3")!.snippet).toBe("arrived mid-read");
    expect(loadAccount(scope, t, storage)!.historyId).toBe(box.historyId);
  });
});

describe("reopening an unchanged inbox", () => {
  it("costs one list and one history read: no thread metadata, no bodies", async () => {
    await refreshInboxAccount(scope, box.api(), deps());
    t += 10 * 60e3;
    const { r, cost } = await measure(() => refreshInboxAccount(scope, box.api(), deps()));
    expect(r.ok).toBe(true);
    expect(r.changed).toEqual([]);
    expect(r.hydrated).toBe(0);
    expect(cost).toEqual({ list: 1, history: 1, metadata: 0, bodies: 0, mutation: 0, profile: 0 });
  });

  it("an empty inbox is a valid cached answer", async () => {
    const empty = new FakeMailbox();
    const first = await refreshInboxAccount(scope, empty.api(), deps());
    expect(first.ok).toBe(true);
    expect(first.rows).toEqual([]);
    expect(loadRows(scope, t, storage)).toEqual({ rows: [], page: MAIL_PAGE, ts: t });
    const { cost } = await measure(() => Promise.resolve());
    void cost;
    const again = await refreshInboxAccount(scope, empty.api(), deps());
    expect(again.hydrated).toBe(0);
    expect(empty.counters.metadata).toBe(0);
  });
});

describe("what changed", () => {
  beforeEach(async () => { await refreshInboxAccount(scope, box.api(), deps()); t += 60e3; });

  it("one new reply hydrates and reports only that thread", async () => {
    const newId = box.receive("t2");
    const { r, cost } = await measure(() => refreshInboxAccount(scope, box.api(), deps()));
    expect(cost.metadata).toBe(1);
    expect(r.changed.map((x) => x.id)).toEqual(["t2"]);
    expect(r.changed[0]!.lastMsgId).toBe(newId);
    expect(cost.bodies).toBe(0);
  });

  it("a new thread is hydrated, others are not", async () => {
    box.add("t6");
    const { r, cost } = await measure(() => refreshInboxAccount(scope, box.api(), deps()));
    expect(cost.metadata).toBe(1);
    expect(r.rows).toHaveLength(6);
    expect(r.changed.map((x) => x.id)).toEqual(["t6"]);
  });

  it("a label-only change updates the row but is not a content change (no analysis)", async () => {
    expect(loadAccount(scope, t, storage)!.rows.find((x) => x.id === "t4")!.unread).toBe(true);
    box.markRead("t4");
    const { r, cost } = await measure(() => refreshInboxAccount(scope, box.api(), deps()));
    expect(cost.metadata).toBe(1);
    expect(r.rows.find((x) => x.id === "t4")!.unread).toBe(false);
    expect(r.changed).toEqual([]);
  });

  it("archived or deleted elsewhere leaves the window, with no thread reads", async () => {
    box.archive("t1");
    box.remove("t2");
    const { r, cost } = await measure(() => refreshInboxAccount(scope, box.api(), deps()));
    expect(r.rows.map((x) => x.id).sort()).toEqual(["t3", "t4", "t5"]);
    expect(r.removedIds.sort()).toEqual(["t1", "t2"]);
    expect(cost.metadata).toBe(0);
  });

  it("deleting the latest message moves the content revision", async () => {
    box.add("m1", { messages: 2 });
    await refreshInboxAccount(scope, box.api(), deps());
    t += 60e3;
    box.deleteLatestMessage("m1");
    const r = await refreshInboxAccount(scope, box.api(), deps());
    expect(r.changed.map((x) => x.id)).toEqual(["m1"]);
  });

  it("paged history is read to the end and deduplicated", async () => {
    for (let i = 0; i < 4; i++) box.receive("t1");
    box.receive("t2");
    box.historyPageSize = 2; // 5 events, 3 pages, t1 four times over
    const { r, cost } = await measure(() => refreshInboxAccount(scope, box.api(), deps()));
    expect(cost.history).toBe(3);
    expect(cost.metadata).toBe(2);
    expect(r.changed.map((x) => x.id).sort()).toEqual(["t1", "t2"]);
    expect(loadAccount(scope, t, storage)!.historyId).toBe(box.historyId);
  });

  it("a change outside the window costs no thread read", async () => {
    const wide = new FakeMailbox();
    for (let i = 1; i <= 45; i++) wide.add("w" + i);
    resetInboxRefreshState();
    const s2 = memStorage();
    const d2 = { storage: s2, now: clock };
    await refreshInboxAccount(scope, wide.api(), { ...d2, want: MAIL_PAGE });
    const oldest = "w1"; // the oldest thread is beyond the 30 newest
    expect(loadAccount(scope, t, s2)!.rows.some((x) => x.id === oldest)).toBe(false);
    wide.receive(oldest); // ...but a reply makes it the NEWEST, so it enters the window
    const before = wide.counters.metadata;
    const r = await refreshInboxAccount(scope, wide.api(), { ...d2, want: MAIL_PAGE });
    expect(r.rows[0]!.id).toBe(oldest);
    expect(wide.counters.metadata - before).toBe(1);
    // a change to a thread deep below the window changes nothing on screen
    wide.receive("w2");
    wide.archive("w3");
    const r3 = await refreshInboxAccount(scope, wide.api(), { ...d2, want: MAIL_PAGE });
    expect(r3.ok).toBe(true);
    expect(r3.rows).toHaveLength(MAIL_PAGE);
  });
});

describe("history expiry", () => {
  it("re-reads the window's metadata and keeps the analysis cache", async () => {
    await refreshInboxAccount(scope, box.api(), deps());
    saveTriageFor(scope, { t1: { bucket: "needs_you", gist: "kept", lastMsgId: loadAccount(scope, t, storage)!.rows.find((x) => x.id === "t1")!.lastMsgId } }, storage);
    // Something happened after our checkpoint (a label change: not content),
    // and Gmail has since forgotten everything up to it.
    box.markRead("t5");
    box.expireHistory();
    t += 60e3;
    const { r, cost } = await measure(() => refreshInboxAccount(scope, box.api(), deps()));
    expect(r.ok).toBe(true);
    expect(r.resynced).toBe(true);
    expect(cost.metadata).toBe(5);
    // Nothing's CONTENT moved, so nothing needs analysing again.
    expect(r.changed).toEqual([]);
    expect(loadTriageFor(scope, storage).t1!.gist).toBe("kept");
    expect(loadAccount(scope, t, storage)!.historyId).toBe(box.historyId);
  });
});

describe("a failure advances nothing", () => {
  beforeEach(async () => { await refreshInboxAccount(scope, box.api(), deps()); t += 60e3; });

  it("a failed thread read is not swallowed and the checkpoint stays put", async () => {
    const before = loadAccount(scope, t, storage)!;
    box.add("t6");
    box.failMeta.add("t6");
    const r = await refreshInboxAccount(scope, box.api(), deps());
    expect(r.ok).toBe(false);
    expect(r.stale).toBe(true);
    expect(r.error).toBeInstanceOf(Error);
    expect(r.rows.map((x) => x.id)).toEqual(before.rows.map((x) => x.id));
    const after = loadAccount(scope, t, storage)!;
    expect(after.historyId).toBe(before.historyId);
    expect(after.checkedAt).toBe(before.checkedAt);
    // ...and the next good read picks the thread up.
    box.failMeta.clear();
    const ok = await refreshInboxAccount(scope, box.api(), deps());
    expect(ok.ok).toBe(true);
    expect(ok.rows.some((x) => x.id === "t6")).toBe(true);
  });

  it("a failed list or history read leaves the cache exactly as it was", async () => {
    const before = JSON.stringify(loadAccount(scope, t, storage));
    box.failList = true;
    expect((await refreshInboxAccount(scope, box.api(), deps())).ok).toBe(false);
    box.failList = false;
    box.failHistory = true;
    expect((await refreshInboxAccount(scope, box.api(), deps())).ok).toBe(false);
    expect(JSON.stringify(loadAccount(scope, t, storage))).toBe(before);
  });

  it("a refresh for a signed-out owner writes nothing", async () => {
    box.receive("t1");
    const before = JSON.stringify(loadAccount(scope, t, storage));
    const r = await refreshInboxAccount(scope, box.api(), { ...deps(), isCurrent: () => false });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(loadAccount(scope, t, storage))).toBe(before);
  });
});

describe("one read for everyone who asks", () => {
  it("the tab and the pump share one in-flight refresh", async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    const api = box.api({ listInboxThreadRefs: async (m, tok) => { await gate; return box.api().listInboxThreadRefs(m, tok); } });
    const a = refreshInboxAccount(scope, api, { ...deps(), reason: "mount" });
    const b = refreshInboxAccount(scope, api, { ...deps(), reason: "pump" });
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.joined).toBe(false);
    expect(rb.joined).toBe(true);
    expect(ra.rows).toEqual(rb.rows);
    expect(box.counters.metadata).toBe(5); // one read of five, not two
  });

  it("singleFlight releases the key so the next call runs fresh", async () => {
    let n = 0;
    await singleFlight("k", async () => { n++; });
    await singleFlight("k", async () => { n++; });
    expect(n).toBe(2);
  });

  it("two accounts refresh independently and one failing does not fail the other", async () => {
    const other = new FakeMailbox("work@example.com");
    other.add("t1"); // the SAME thread id as the first account's t1
    other.failList = true;
    const out = await refreshInboxAccounts("u1", [
      { email: "dave@example.com", api: box.api() },
      { email: "work@example.com", api: other.api() },
    ], deps());
    expect(out[0]!.result.ok).toBe(true);
    expect(out[1]!.result.ok).toBe(false);
    expect(out[0]!.result.rows).toHaveLength(5);
  });

  it("the same thread id in two accounts never shares a cache entry", async () => {
    const other = new FakeMailbox("work@example.com");
    other.add("t1", { subject: "the work one" });
    await refreshInboxAccount(scope, box.api(), deps());
    await refreshInboxAccount({ userId: "u1", account: "work@example.com" }, other.api(), deps());
    expect(loadAccount(scope, t, storage)!.rows.find((x) => x.id === "t1")!.subject).toBe("Subject t1");
    expect(loadAccount({ userId: "u1", account: "work@example.com" }, t, storage)!.rows[0]!.subject).toBe("the work one");
    // and another OWNER on the same phone sees neither
    expect(loadAccount({ userId: "u2", account: "dave@example.com" }, t, storage)).toBeNull();
  });
});

describe("mutation overlay", () => {
  it("an in-flight read cannot put back a thread that was just archived", async () => {
    await refreshInboxAccount(scope, box.api(), deps());
    t += 60e3;
    box.receive("t1"); // gives the refresh something to read
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    const api = box.api({
      getThreadMeta: async (id) => { await gate; return box.api().getThreadMeta(id); },
    });
    const inflight = refreshInboxAccount(scope, api, deps());
    await Promise.resolve();
    markGone(scope, ["t1"], t + 1); // archived from this screen while the read is out
    release();
    const r = await inflight;
    expect(r.rows.some((x) => x.id === "t1")).toBe(false);
    unmarkGone(scope, ["t1"]);
  });

  it("a read that STARTS after the archive is trusted (the server says where the thread is)", async () => {
    await refreshInboxAccount(scope, box.api(), deps());
    markGone(scope, ["t1"], t - 1);
    t += 60e3;
    const r = await refreshInboxAccount(scope, box.api(), deps());
    expect(r.rows.some((x) => x.id === "t1")).toBe(true);
  });
});

describe("Load More follows the cursor", () => {
  it("lists and reads only the next page, never the earlier ones again", async () => {
    const big = new FakeMailbox();
    for (let i = 1; i <= 75; i++) big.add("b" + i);
    big.listPageSize = 30;
    const d = { storage, now: clock };
    const first = await refreshInboxAccount(scope, big.api(), { ...d, want: MAIL_PAGE });
    expect(first.rows).toHaveLength(30);
    expect(first.complete).toBe(false);
    const before = { ...big.counters };
    const more = await loadMoreInbox(scope, big.api(), MAIL_PAGE, d);
    expect(more.ok).toBe(true);
    expect(more.rows).toHaveLength(60);
    expect(big.counters.list - before.list).toBe(1);
    expect(big.counters.metadata - before.metadata).toBe(30);
    const last = await loadMoreInbox(scope, big.api(), MAIL_PAGE, d);
    expect(last.rows).toHaveLength(75);
    expect(last.complete).toBe(true);
    expect(loadAccount(scope, t, storage)!.nextPageToken).toBeUndefined();
    expect(new Set(last.rows.map((r) => r.id)).size).toBe(75);
  });
});

describe("storage that fails", () => {
  it("keeps the answer in memory so a remount does not spend the requests again", async () => {
    const full = { ...memStorage(), setItem: () => { throw new DOMException("quota", "QuotaExceededError"); } };
    const d = { storage: full, now: clock };
    await refreshInboxAccount(scope, box.api(), d);
    t += 60e3;
    const { cost, r } = await measure(() => refreshInboxAccount(scope, box.api(), d));
    expect(r.ok).toBe(true);
    expect(cost.metadata).toBe(0);
  });

  it("a future timestamp is not trusted as a cache", async () => {
    saveAccount(scope, { rows: [], marks: {}, historyId: "5", checkedAt: t + 3600e3, updatedAt: t, page: 30, complete: true, reads: {} }, storage);
    const r = await refreshInboxAccount(scope, box.api(), deps());
    expect(r.bootstrapped).toBe(true);
    expect(r.rows).toHaveLength(5);
  });

  it("one corrupt account entry is isolated", async () => {
    await refreshInboxAccount(scope, box.api(), deps());
    const other = { userId: "u1", account: "work@example.com" };
    const w = new FakeMailbox("work@example.com");
    w.add("x1");
    await refreshInboxAccount(other, w.api(), deps());
    const key = [...storage.raw.keys()].find((k) => k.includes(encodeURIComponent("work@example.com")))!;
    storage.raw.set(key, "{corrupt");
    // clear the write-through memory for the corrupt key by using a fresh object over the same map
    const fresh = { getItem: storage.getItem, setItem: storage.setItem, removeItem: storage.removeItem };
    expect(loadAccount(scope, t, fresh)).not.toBeNull();
    expect(loadAccount(other, t, fresh)).toBeNull();
  });

  it("read clocks are per account and only advance when told", async () => {
    await refreshInboxAccount(scope, box.api(), deps());
    expect(isFresh(scope, "sweep", t, storage)).toBe(false);
    markRead(scope, "sweep", t, storage);
    expect(isFresh(scope, "sweep", t + 1000, storage)).toBe(true);
    expect(isFresh({ userId: "u1", account: "other@example.com" }, "sweep", t + 1000, storage)).toBe(false);
  });
});

describe("pool", () => {
  it("never runs more than n at once and rejects on the first failure", async () => {
    let live = 0; let peak = 0;
    await pool([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async () => { live++; peak = Math.max(peak, live); await Promise.resolve(); await Promise.resolve(); live--; });
    expect(peak).toBeLessThanOrEqual(4);
    await expect(pool([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error("boom"); })).rejects.toThrow("boom");
  });
});

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

function fakeAi(impl?: (input: string, n: number) => Promise<string> | string) {
  let n = 0;
  const inputs: string[] = [];
  const ai = {
    available: true,
    complete: vi.fn(async (msgs: { content: string }[]) => {
      const input = msgs[0]!.content;
      inputs.push(input);
      n++;
      if (impl) return impl(input, n);
      // Answer every id in the fenced listing as needs_you.
      const ids = [...input.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]!);
      return JSON.stringify(ids.map((id) => ({ id, bucket: "needs_you", gist: "g " + id, by: "" })));
    }),
  };
  return { ai: ai as unknown as AIService, spy: ai.complete, inputs };
}

async function rowsOf(mb: FakeMailbox, s = storage): Promise<ThreadRow[]> {
  return (await refreshInboxAccount(scope, mb.api(), { storage: s, now: clock })).rows;
}

describe("analysis: only what is new is asked", () => {
  it("analyses every unanswered thread once, then never again for unchanged mail", async () => {
    const rows = await rowsOf(box);
    const { ai, spy } = fakeAi();
    const first = await ensureThreadAnalysis(scope, rows, { ai, storage, now: clock });
    expect(first.status).toBe("ok");
    expect(first.analysed).toBe(5);
    expect(spy).toHaveBeenCalledTimes(1);
    const again = await ensureThreadAnalysis(scope, rows, { ai, storage, now: clock });
    expect(again.status).toBe("idle");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("one new reply is one thread in one request", async () => {
    const rows0 = await rowsOf(box);
    const { ai, spy, inputs } = fakeAi();
    await ensureThreadAnalysis(scope, rows0, { ai, storage, now: clock });
    t += 60e3;
    box.receive("t3");
    const r = await refreshInboxAccount(scope, box.api(), deps());
    const res = await ensureThreadAnalysis(scope, r.rows, { ai, storage, now: clock });
    expect(res.analysed).toBe(1);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(inputs[1]!).toContain('"id":"t3"');
    expect(inputs[1]!).not.toContain('"id":"t1"');
  });

  it("a label-only change is never analysed", async () => {
    const rows0 = await rowsOf(box);
    const { ai, spy } = fakeAi();
    await ensureThreadAnalysis(scope, rows0, { ai, storage, now: clock });
    t += 60e3;
    box.markRead("t2");
    const r = await refreshInboxAccount(scope, box.api(), deps());
    await ensureThreadAnalysis(scope, r.rows, { ai, storage, now: clock });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("batches are at most 12 and each fits the size limit", async () => {
    const big = new FakeMailbox();
    for (let i = 1; i <= 30; i++) big.add("z" + i, { snippet: "x".repeat(400) });
    const rows = await rowsOf(big);
    const { ai, spy, inputs } = fakeAi();
    await ensureThreadAnalysis(scope, rows, { ai, storage, now: clock });
    expect(spy).toHaveBeenCalledTimes(Math.ceil(30 / TRIAGE_BATCH));
    for (const i of inputs) expect(i.length).toBeLessThan(26000);
    const many = rows.map((r) => ({ ...r, snippet: "y".repeat(200), subject: "s".repeat(500) }));
    const parts = splitForSize(many.slice(0, 12), 6000);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length === 1 || buildTriageInput(p).length <= 6000).toBe(true);
  });

  it("successful batches are cached even when a later one fails", async () => {
    const big = new FakeMailbox();
    for (let i = 1; i <= 24; i++) big.add("q" + i);
    const rows = await rowsOf(big);
    const { ai } = fakeAi((input, n) => {
      if (n === 2) throw new Error("network down");
      const ids = [...input.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]!);
      return JSON.stringify(ids.map((id) => ({ id, bucket: "noise", gist: "g", by: "" })));
    });
    const res = await ensureThreadAnalysis(scope, rows, { ai, storage, now: clock });
    expect(res.status).toBe("partial");
    expect(res.analysed).toBe(12);
    expect(res.failed).toBe(12);
    const cache = loadTriageFor(scope, storage);
    expect(Object.values(cache).filter(isAnalysed)).toHaveLength(12);
    expect(Object.values(cache).filter((e) => e.fallback)).toHaveLength(12);
  });
});

describe("analysis: failure never becomes a storm", () => {
  it("a budget refusal stops the whole batch and asks nothing more during the cooldown", async () => {
    const big = new FakeMailbox();
    for (let i = 1; i <= 30; i++) big.add("s" + i);
    const rows = await rowsOf(big);
    const { ai, spy } = fakeAi(() => { throw new AIBudgetError({ code: "AI_BUDGET_REACHED", limitMicrousd: 5_000_000 }); });
    const first = await ensureThreadAnalysis(scope, rows, { ai, storage, now: clock });
    expect(first.status).toBe("budget");
    expect(first.message).toBe("AI paused. You reached your $5 limit.");
    expect(spy).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) {
      expect((await ensureThreadAnalysis(scope, rows, { ai, storage, now: clock })).status).toBe("cooldown");
    }
    expect(spy).toHaveBeenCalledTimes(1);
    // Try Again goes around the cooldown, once, on purpose.
    await ensureThreadAnalysis(scope, rows, { ai, storage, now: clock, force: true });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("an auth refusal stops the batch too", async () => {
    const big = new FakeMailbox();
    for (let i = 1; i <= 30; i++) big.add("a" + i);
    const rows = await rowsOf(big);
    const { ai, spy } = fakeAi(() => { throw new Error("AI request failed (401). unauthorized"); });
    expect((await ensureThreadAnalysis(scope, rows, { ai, storage, now: clock })).status).toBe("auth");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a timeout is not re-sent (the first request may still be billed)", async () => {
    vi.useFakeTimers();
    try {
      const rows = await rowsOf(box);
      const { ai, spy } = fakeAi(() => new Promise<string>(() => { /* never answers */ }));
      const p = ensureThreadAnalysis(scope, rows, { ai, storage, now: clock, timeoutMs: 5000 });
      await vi.advanceTimersByTimeAsync(6000);
      const res = await p;
      expect(spy).toHaveBeenCalledTimes(1);
      expect(res.status).toBe("failed");
      expect(res.failed).toBe(5);
    } finally { vi.useRealTimers(); }
  });

  it("an unreadable reply is repeated once, a network error never", async () => {
    const rows = await rowsOf(box);
    const bad = fakeAi(() => "not json at all");
    await ensureThreadAnalysis(scope, rows, { ai: bad.ai, storage, now: clock });
    expect(bad.spy).toHaveBeenCalledTimes(2);
    const s2 = memStorage();
    const rows2 = await rowsOf(box, s2);
    const down = fakeAi(() => { throw new Error("network"); });
    await ensureThreadAnalysis(scope, rows2, { ai: down.ai, storage: s2, now: clock });
    expect(down.spy).toHaveBeenCalledTimes(1);
  });

  it("a failed thread is a visible fallback, never passed off as an answer, and retried a bounded number of times", async () => {
    const rows = await rowsOf(box);
    const down = fakeAi(() => { throw new Error("network"); });
    await ensureThreadAnalysis(scope, rows, { ai: down.ai, storage, now: clock });
    const e = loadTriageFor(scope, storage).t1!;
    expect(e.fallback).toBe(true);
    expect(isAnalysed(e)).toBe(false);
    expect(e.bucket).toBe("worth_knowing");
    // Inside the cooldown: nothing.
    expect((await ensureThreadAnalysis(scope, rows, { ai: down.ai, storage, now: clock })).status).toBe("cooldown");
    // After it: one more try, then no more.
    t += ANALYSIS_COOLDOWN_MS + 1;
    await ensureThreadAnalysis(scope, rows, { ai: down.ai, storage, now: clock });
    expect(down.spy).toHaveBeenCalledTimes(2);
    t += ANALYSIS_COOLDOWN_MS + 1;
    expect((await ensureThreadAnalysis(scope, rows, { ai: down.ai, storage, now: clock })).status).toBe("idle");
    expect(down.spy).toHaveBeenCalledTimes(2);
  });

  it("with AI unavailable nothing is asked and nothing is recorded", async () => {
    const rows = await rowsOf(box);
    const off = { available: false, complete: vi.fn() } as unknown as AIService;
    expect((await ensureThreadAnalysis(scope, rows, { ai: off, storage, now: clock })).status).toBe("unavailable");
    expect(Object.keys(loadTriageFor(scope, storage))).toHaveLength(0);
  });

  it("tab and pump asking together send one request, not two", async () => {
    const rows = await rowsOf(box);
    const { ai, spy } = fakeAi();
    const [a, b] = await Promise.all([
      ensureThreadAnalysis(scope, rows, { ai, storage, now: clock }),
      ensureThreadAnalysis(scope, rows, { ai, storage, now: clock }),
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(a.analysed).toBe(b.analysed);
  });

  it("the triage cache is scoped: another account's answer is not this one's", async () => {
    const rows = await rowsOf(box);
    const { ai } = fakeAi();
    await ensureThreadAnalysis(scope, rows, { ai, storage, now: clock });
    expect(loadTriageFor({ userId: "u1", account: "work@example.com" }, storage)).toEqual({});
    expect(loadTriageFor({ userId: "u2", account: "dave@example.com" }, storage)).toEqual({});
    expect(Object.keys(loadTriageFor(scope, storage))).toHaveLength(5);
  });
});

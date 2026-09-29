import { describe, it, expect } from "vitest";
import {
  ROWS_MAX_AGE_MS, FRESH_MS, loadAccount, saveAccount,
  loadRows, saveRows, mirrorRows, clearRows, clearAllMailCache, clearOwnerMailCache, dropLegacyMailCache,
  loadReads, markRead, isFresh, invalidate,
} from "./mailCache";
import type { ThreadRow } from "../connections/google/map";

function mem() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    raw: m,
  };
}
const A = { userId: "u1", account: "dave@example.com" };
const B = { userId: "u1", account: "work@example.com" };
const row = (id: string, account = A.account): ThreadRow => ({
  id, from: "Wei", fromEmail: "wei@x.com", subject: "s", snippet: "",
  dateMs: 1, unread: false, count: 1, inInbox: true, lastMsgId: "m" + id, account,
});

describe("mailCache rows: the inbox he already read", () => {
  it("round-trips the rows and the page size", () => {
    const s = mem();
    saveRows(A, [row("a"), row("b")], 30, 1000, s);
    const got = loadRows(A, 1500, s);
    expect(got?.rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(got?.page).toBe(30);
    expect(got?.ts).toBe(1000);
  });

  it("refuses rows too old to be worth painting, and junk", () => {
    const s = mem();
    saveRows(A, [row("a")], 30, 1000, s);
    expect(loadRows(A, 1000 + ROWS_MAX_AGE_MS + 1, s)).toBeNull();
    // A clock that went backwards is not a fresh cache either: a timestamp
    // from the future is not trusted.
    expect(loadRows(A, 500, s)).toBeNull();
    const key = [...s.raw.keys()][0]!;
    const junk = { getItem: (k: string) => (k === key ? "{not json" : null), setItem: s.setItem };
    expect(loadRows(A, 1000, junk)).toBeNull();
    const norow = { getItem: (k: string) => (k === key ? JSON.stringify({ v: 2, rows: [{ nope: true }], checkedAt: 1000 }) : null), setItem: s.setItem };
    expect(loadRows(A, 1000, norow)?.rows, "a row with no id would render as a dead line").toEqual([]);
  });

  it("an EMPTY inbox is a valid cached answer, not a miss", () => {
    const s = mem();
    saveRows(A, [], 30, 1000, s);
    const got = loadRows(A, 1500, s);
    expect(got).not.toBeNull();
    expect(got?.rows).toEqual([]);
  });

  it("mirrors an archive without pretending the mail was re-read", () => {
    const s = mem();
    saveRows(A, [row("a"), row("b")], 30, 1000, s);
    mirrorRows(A, [row("b")], 1200, s);
    const got = loadRows(A, 1500, s);
    expect(got?.rows.map((r) => r.id)).toEqual(["b"]);
    // The timestamp did NOT move: nothing was read, so the next expiry is
    // still owed and the screen cannot stay stale forever by being tidied.
    expect(got?.ts).toBe(1000);
  });

  it("deleting the LAST row persists the emptied list", () => {
    const s = mem();
    saveRows(A, [row("a")], 30, 1000, s);
    mirrorRows(A, [], 1200, s);
    expect(loadRows(A, 1500, s)?.rows).toEqual([]);
  });

  it("mirroring into an empty cache writes nothing rather than inventing one", () => {
    const s = mem();
    mirrorRows(A, [row("a")], 1200, s);
    expect(loadRows(A, 1000, s)).toBeNull();
    saveRows(A, [row("a")], 30, 1000, s);
    clearRows(A, s);
    expect(loadRows(A, 1000, s)).toBeNull();
    expect(s.raw.size).toBe(0);
  });
});

describe("mailCache is scoped by owner and account", () => {
  it("two accounts, and two owners, never read each other's rows", () => {
    const s = mem();
    saveRows(A, [row("a")], 30, 1000, s);
    saveRows(B, [row("b", B.account)], 30, 1000, s);
    expect(loadRows(A, 1500, s)?.rows.map((r) => r.id)).toEqual(["a"]);
    expect(loadRows(B, 1500, s)?.rows.map((r) => r.id)).toEqual(["b"]);
    expect(loadRows({ userId: "u2", account: A.account }, 1500, s)).toBeNull();
  });

  it("the account is normalised: case and padding do not fork the cache", () => {
    const s = mem();
    saveRows(A, [row("a")], 30, 1000, s);
    expect(loadRows({ userId: "u1", account: "  Dave@Example.COM " }, 1500, s)?.rows).toHaveLength(1);
  });

  it("one corrupt account is isolated from the rest", () => {
    const s = mem();
    saveRows(A, [row("a")], 30, 1000, s);
    saveRows(B, [row("b", B.account)], 30, 1000, s);
    const bad = [...s.raw.keys()].find((k) => k.includes(encodeURIComponent("work@example.com")))!;
    const view = { getItem: (k: string) => (k === bad ? "}}corrupt" : s.getItem(k)), setItem: s.setItem };
    expect(loadRows(A, 1500, view)?.rows).toHaveLength(1);
    expect(loadRows(B, 1500, view)).toBeNull();
  });

  it("storage that refuses the write still answers from memory, for the life of the app", () => {
    const full = { ...mem(), setItem: () => { throw new DOMException("quota", "QuotaExceededError"); } };
    saveRows(A, [row("a")], 30, 1000, full);
    // The screen remounts: same storage object, and the answer is still there.
    expect(loadRows(A, 1500, full)?.rows.map((r) => r.id)).toEqual(["a"]);
    markRead(A, "threads", 1200, full);
    expect(isFresh(A, "threads", 1300, full)).toBe(true);
  });

  it("clears every owner's and every account's mail, and the pre-scoping keys", () => {
    const s = mem();
    saveRows(A, [row("a")], 30, 1000, s);
    saveRows({ userId: "u2", account: "x@y.com" }, [row("z")], 30, 1000, s);
    s.setItem("jarvis.mail.rows.v1", "old");
    s.setItem("jarvis.mail.reads.v1", "old");
    s.setItem("something.else", "keep");
    clearAllMailCache(s);
    expect([...s.raw.keys()]).toEqual(["something.else"]);
    expect(loadRows(A, 1500, s)).toBeNull();
  });

  it("clears one owner's mail and leaves another's", () => {
    const s = mem();
    saveRows(A, [row("a")], 30, 1000, s);
    saveRows({ userId: "u2", account: "x@y.com" }, [row("z")], 30, 1000, s);
    clearOwnerMailCache("u1", s as unknown as Storage);
    expect(loadRows(A, 1500, s)).toBeNull();
    expect(loadRows({ userId: "u2", account: "x@y.com" }, 1500, s)).not.toBeNull();
  });

  it("drops the unscoped legacy keys, because their owner cannot be proven", () => {
    const s = mem();
    s.setItem("jarvis.mail.rows.v1", "{}");
    s.setItem("jarvis.mail.reads.v1", "{}");
    dropLegacyMailCache(s);
    expect(s.raw.size).toBe(0);
  });
});

describe("mailCache reads: what was fetched, and when", () => {
  const seeded = () => { const s = mem(); saveRows(A, [row("a")], 30, 900, s); return s; };

  it("a pass is fresh only for its own window", () => {
    const s = seeded();
    markRead(A, "threads", 1000, s);
    expect(isFresh(A, "threads", 1000 + FRESH_MS.threads - 1, s)).toBe(true);
    expect(isFresh(A, "threads", 1000 + FRESH_MS.threads, s)).toBe(false);
    // Never read is never fresh.
    expect(isFresh(A, "drafts", 1000, s)).toBe(false);
    // A clock that went backwards is not fresh.
    expect(isFresh(A, "threads", 900, s)).toBe(false);
  });

  it("the clocks are per account", () => {
    const s = seeded();
    saveRows(B, [row("b", B.account)], 30, 900, s);
    markRead(A, "sweep", 1000, s);
    expect(isFresh(A, "sweep", 1100, s)).toBe(true);
    expect(isFresh(B, "sweep", 1100, s)).toBe(false);
  });

  it("a pass with no cached account has nowhere to record itself, which reads as never read", () => {
    const s = mem();
    markRead(A, "threads", 1000, s);
    expect(isFresh(A, "threads", 1100, s)).toBe(false);
  });

  it("the expensive passes are allowed to be staler than the inbox", () => {
    expect(FRESH_MS.threads).toBeLessThan(FRESH_MS.drafts);
    expect(FRESH_MS.sweep).toBeGreaterThanOrEqual(4 * 3600e3);
    for (const v of Object.values(FRESH_MS)) expect(v).toBeGreaterThan(0);
  });

  it("each pass keeps its own clock", () => {
    const s = seeded();
    markRead(A, "threads", 1000, s);
    markRead(A, "sweep", 1000, s);
    expect(loadReads(A, s)).toEqual({ threads: 1000, sweep: 1000 });
    const later = 1000 + FRESH_MS.threads + 1;
    expect(isFresh(A, "threads", later, s)).toBe(false);
    expect(isFresh(A, "sweep", later, s)).toBe(true);
  });

  it("a write that changed the inbox drops the passes it invalidates, and only those", () => {
    const s = seeded();
    markRead(A, "threads", 1000, s);
    markRead(A, "waiting", 1000, s);
    markRead(A, "sweep", 1000, s);
    invalidate(A, ["waiting", "sweep"], s);
    expect(isFresh(A, "threads", 1100, s)).toBe(true);
    expect(isFresh(A, "waiting", 1100, s)).toBe(false);
    expect(isFresh(A, "sweep", 1100, s)).toBe(false);
  });

  it("shrugs off junk in the reads", () => {
    const s = seeded();
    const key = [...s.raw.keys()][0]!;
    const cur = JSON.parse(s.raw.get(key)!);
    cur.reads = { threads: "soon", nonsense: { at: 5 }, sweep: { at: 7, rev: "r" } };
    s.raw.set(key, JSON.stringify(cur));
    const fresh = { getItem: s.getItem, setItem: s.setItem };
    expect(loadReads(A, fresh)).toEqual({ sweep: 7 });
    expect(loadAccount(A, 1500, fresh)?.reads.sweep?.rev).toBe("r");
  });

  it("saveAccount keeps a string history checkpoint intact", () => {
    const s = mem();
    saveAccount(A, { rows: [], marks: {}, historyId: "9007199254740993", checkedAt: 1000, updatedAt: 1000, page: 30, complete: true, reads: {} }, s);
    expect(loadAccount(A, 1500, s)?.historyId).toBe("9007199254740993");
  });
});

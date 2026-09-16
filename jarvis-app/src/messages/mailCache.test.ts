import { describe, it, expect } from "vitest";
import {
  ROWS_KEY, READS_KEY, ROWS_MAX_AGE_MS, FRESH_MS,
  loadRows, saveRows, mirrorRows, clearRows, loadReads, markRead, isFresh, invalidate,
} from "./mailCache";
import type { ThreadRow } from "../connections/google/map";

function mem() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    raw: m,
  };
}
const row = (id: string): ThreadRow => ({
  id, from: "Wei", fromEmail: "wei@x.com", subject: "s", snippet: "",
  dateMs: 1, unread: false, count: 1, inInbox: true, lastMsgId: "m" + id,
});

describe("mailCache rows: the inbox he already read", () => {
  it("round-trips the rows and the page size", () => {
    const s = mem();
    saveRows([row("a"), row("b")], 30, 1000, s);
    const got = loadRows(1500, s);
    expect(got?.rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(got?.page).toBe(30);
    expect(got?.ts).toBe(1000);
  });

  it("refuses rows too old to be worth painting, and junk", () => {
    const s = mem();
    saveRows([row("a")], 30, 1000, s);
    expect(loadRows(1000 + ROWS_MAX_AGE_MS + 1, s)).toBeNull();
    // A clock that went backwards is not a fresh cache either.
    expect(loadRows(500, s)).toBeNull();
    s.setItem(ROWS_KEY, "{not json");
    expect(loadRows(1000, s)).toBeNull();
    s.setItem(ROWS_KEY, JSON.stringify({ rows: [{ nope: true }], ts: 1000 }));
    expect(loadRows(1000, s), "a row with no id would render as a dead line").toBeNull();
  });

  it("mirrors an archive without pretending the mail was re-read", () => {
    const s = mem();
    saveRows([row("a"), row("b")], 30, 1000, s);
    mirrorRows([row("b")], 1200, s);
    const got = loadRows(1500, s);
    expect(got?.rows.map((r) => r.id)).toEqual(["b"]);
    // The timestamp did NOT move: nothing was read, so the next expiry is
    // still owed and the screen cannot stay stale forever by being tidied.
    expect(got?.ts).toBe(1000);
  });

  it("mirroring into an empty cache writes nothing rather than inventing one", () => {
    const s = mem();
    mirrorRows([row("a")], 1200, s);
    expect(loadRows(1000, s)).toBeNull();
    clearRows(s);
    expect(s.raw.has(ROWS_KEY)).toBe(false);
  });
});

describe("mailCache reads: what was fetched, and when", () => {
  it("a pass is fresh only for its own window", () => {
    const s = mem();
    markRead("threads", 1000, s);
    expect(isFresh("threads", 1000 + FRESH_MS.threads - 1, s)).toBe(true);
    expect(isFresh("threads", 1000 + FRESH_MS.threads, s)).toBe(false);
    // Never read is never fresh.
    expect(isFresh("drafts", 1000, s)).toBe(false);
    // A clock that went backwards is not fresh.
    expect(isFresh("threads", 900, s)).toBe(false);
  });

  it("the expensive passes are allowed to be staler than the inbox", () => {
    // The inbox is what he came to see; the sent sweep pulls eight full
    // message bodies to learn something that moves in days.
    expect(FRESH_MS.threads).toBeLessThan(FRESH_MS.drafts);
    expect(FRESH_MS.sweep).toBeGreaterThanOrEqual(4 * 3600e3);
    for (const v of Object.values(FRESH_MS)) expect(v).toBeGreaterThan(0);
  });

  it("each pass keeps its own clock", () => {
    const s = mem();
    markRead("threads", 1000, s);
    markRead("sweep", 1000, s);
    expect(loadReads(s)).toEqual({ threads: 1000, sweep: 1000 });
    // The inbox goes stale long before the sweep does.
    const later = 1000 + FRESH_MS.threads + 1;
    expect(isFresh("threads", later, s)).toBe(false);
    expect(isFresh("sweep", later, s)).toBe(true);
  });

  it("a write that changed the inbox drops the passes it invalidates, and only those", () => {
    const s = mem();
    markRead("threads", 1000, s);
    markRead("waiting", 1000, s);
    markRead("sweep", 1000, s);
    invalidate(["waiting", "sweep"], s);
    expect(isFresh("threads", 1100, s)).toBe(true);
    expect(isFresh("waiting", 1100, s)).toBe(false);
    expect(isFresh("sweep", 1100, s)).toBe(false);
  });

  it("shrugs off junk", () => {
    const s = mem();
    s.setItem(READS_KEY, "{not json");
    expect(loadReads(s)).toEqual({});
    s.setItem(READS_KEY, JSON.stringify({ threads: "soon", nonsense: 5 }));
    expect(loadReads(s)).toEqual({});
  });
});

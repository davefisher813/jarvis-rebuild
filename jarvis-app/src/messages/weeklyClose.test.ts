import { describe, it, expect } from "vitest";
import {
  amnestyDue, amnestyPromise, amnestyLine, AMNESTY_AT,
  closeCandidates, closeDue, type CloseSet,
  saveClosedBatch, loadClosedBatch, clearClosedBatch, closedBatchLive, putBackLine, CLOSE_UNDO_DAYS,
} from "./weeklyClose";
import type { ThreadRow } from "../connections/google/map";

// THE SUNDAY CLOSE and its bigger sibling THE AMNESTY. Both rest on one
// promise (archive, never delete) and one law (needs-you is never in the
// set), so both are tested at the line where that promise could break.

const row = (id: string, ageDays: number, over: Partial<ThreadRow> = {}): ThreadRow => ({
  id, from: "Sender " + id, fromEmail: id + "@x.com", subject: "S", snippet: "",
  unread: false, inInbox: true, dateMs: Date.parse("2026-08-25T12:00:00Z") - ageDays * 86400e3,
  count: 1, lastMsgId: "m" + id, ...over,
});
const NOW = Date.parse("2026-08-25T12:00:00Z");

describe("needs-you is never in the set, however old", () => {
  it("refuses a needs_you thread even at a year old", () => {
    const rows = [row("a", 365)];
    const set = closeCandidates(rows, { a: { bucket: "needs_you" } }, [], NOW);
    expect(set.count).toBe(0);
  });

  it("refuses UNSORTED mail, because not having read it proves nothing", () => {
    expect(closeCandidates([row("a", 365)], {}, [], NOW).count).toBe(0);
  });

  it("refuses a VIP whatever the bucket says", () => {
    const set = closeCandidates([row("a", 90)], { a: { bucket: "noise" } }, ["a@x.com"], NOW);
    expect(set.count).toBe(0);
  });

  it("takes old noise and old worth-knowing", () => {
    const rows = [row("a", 30), row("b", 30), row("c", 2)];
    const set = closeCandidates(rows, {
      a: { bucket: "noise" }, b: { bucket: "worth_knowing" }, c: { bucket: "noise" },
    }, [], NOW);
    // c is two days old: the fortnight rule protects recent mail.
    expect(set.ids).toEqual(["a", "b"]);
  });
});

describe("the weekly clock", () => {
  it("is due when it has never run, and a week after it last did", () => {
    expect(closeDue("2026-08-25", "")).toBe(true);
    expect(closeDue("2026-08-25", "2026-08-18")).toBe(true);
    expect(closeDue("2026-08-25", "2026-08-20")).toBe(false);
  });
});


// 9A: THE AMNESTY (Dave 2026-08-25, the Anti-Inbox catalog).
describe("the amnesty", () => {
  const set = (count: number): CloseSet => ({ count, ids: [], senders: [] });

  it("still comes on the weekly clock, as it always did", () => {
    expect(amnestyDue(set(3), "2026-08-25", "2026-08-18")).toBe(true);
    expect(amnestyDue(set(3), "2026-08-25", "2026-08-24")).toBe(false);
  });

  it("comes when the BACKLOG is the problem, whatever day it is", () => {
    // Three weeks of avoidance should not have to wait for Sunday: the loop
    // is anxiety, avoidance, a bigger pile, more anxiety.
    expect(amnestyDue(set(AMNESTY_AT), "2026-08-25", "2026-08-24")).toBe(true);
    expect(amnestyDue(set(AMNESTY_AT - 1), "2026-08-25", "2026-08-24")).toBe(false);
  });

  it("never offers to amnesty nothing", () => {
    expect(amnestyDue(set(0), "2026-08-25", "")).toBe(false);
    expect(amnestyDue(set(0), "2026-08-25", "2020-01-01")).toBe(false);
  });

  it("promises only things that are true", () => {
    const p = amnestyPromise();
    // Archive, never delete, is the law the whole one-tap action rests on.
    expect(p).toMatch(/archived/i);
    expect(p).toMatch(/never deleted/i);
    expect(p).toMatch(/undo/i);
    expect(p).not.toMatch(/permanent|forever gone|erased/i);
  });

  it("names the age, not a verdict on the person", () => {
    expect(amnestyLine(set(17))).toBe("17 Threads older than two weeks");
    expect(amnestyLine(set(1))).toBe("1 Thread older than two weeks");
    // Never "ignored", "neglected", "you failed to".
    expect(amnestyLine(set(17)).toLowerCase()).not.toMatch(/ignor|neglect|fail|behind/);
  });
});

// EMAIL-F-08 (2026-09-05): "Close It Out promises Undo for a week and has no
// undo." The card's promise is the reason a one-tap archive of sixty threads
// is safe to offer. The toast now carries an Undo, and this store is the
// other seven days of that sentence: what was archived, when, and through
// which account each thread must be put back.
describe("the week-long way back", () => {
  function mem() {
    const s: Record<string, string> = {};
    return {
      getItem: (k: string) => s[k] ?? null,
      setItem: (k: string, v: string) => { s[k] = v; },
      removeItem: (k: string) => { delete s[k]; },
    };
  }

  it("remembers what the close archived, with the account each thread lives in", () => {
    const st = mem();
    saveClosedBatch("2026-08-25", [{ id: "t1", account: "a@x.com" }, { id: "t2" }], st);
    const back = loadClosedBatch(st);
    expect(back?.dateISO).toBe("2026-08-25");
    expect(back?.threads).toEqual([{ id: "t1", account: "a@x.com" }, { id: "t2" }]);
  });

  it("is offered for the week it promised, and not a day longer", () => {
    const st = mem();
    saveClosedBatch("2026-08-25", [{ id: "t1" }], st);
    const back = loadClosedBatch(st);
    expect(closedBatchLive(back, "2026-08-25")).toBe(true);
    expect(closedBatchLive(back, "2026-08-31")).toBe(true);
    expect(closedBatchLive(back, "2026-09-01")).toBe(false); // day 7
    expect(CLOSE_UNDO_DAYS).toBe(7);
    expect(closedBatchLive(null, "2026-08-25")).toBe(false);
  });

  it("a batch that was put back is gone, not offered again", () => {
    const st = mem();
    saveClosedBatch("2026-08-25", [{ id: "t1" }], st);
    clearClosedBatch(st);
    expect(loadClosedBatch(st)).toBeNull();
  });

  it("says how many, counting rather than claiming", () => {
    expect(putBackLine({ dateISO: "2026-08-25", threads: [{ id: "t1" }] }))
      .toBe("1 Conversation archived in the close");
    expect(putBackLine({ dateISO: "2026-08-25", threads: [{ id: "t1" }, { id: "t2" }] }))
      .toBe("2 Conversations archived in the close");
  });
});

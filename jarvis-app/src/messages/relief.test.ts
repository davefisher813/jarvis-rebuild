// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { cleanBody, isLong, leadIn, wordCount } from "./bodyText";
import { byRank, sortByDeadline, type TriageMap } from "./triage";
import { recordToss, tossOffer, tossLine, markAsked, TOSS_THRESHOLD } from "./selfClean";
import { loadMinutes, saveMinutes, clampMinutes, fmtClock, drainReceipt } from "./drain";
import type { ThreadRow } from "../connections/google/map";

const GRAMMARLY = `Grammarly Upgrade to Pro and write with confidence.

 <http://grammarly.com/>  <http://grammarly.com/>
Redeem your offer →
<https://discount.grammarly.com/api/discounts/live?hash=bc6048c4e45537c5ffec63b039bb07aa78f2123>

Unsubscribe
`;

function row(id: string, dateMs: number): ThreadRow {
  return {
    id, from: "X", fromEmail: "x@y.com", subject: "s", snippet: "", unread: true,
    inInbox: true, dateMs, count: 1, lastMsgId: id + "m",
  };
}

describe("no text walls", () => {
  it("strips the plumbing out of a marketing body", () => {
    const out = cleanBody(GRAMMARLY);
    expect(out).toContain("Upgrade to Pro");
    expect(out).not.toContain("http");
    expect(out).not.toContain("discount.grammarly.com");
    expect(out.toLowerCase()).not.toContain("unsubscribe");
    expect(out).not.toMatch(/\n\n\n/); // no runs of blank layout lines
  });

  it("leaves a short human email completely alone", () => {
    const human = "Hey, can you send the roster by Friday?\n\nThanks,\nRidgeley";
    expect(cleanBody(human)).toBe(human);
    expect(isLong(human)).toBe(false);
  });

  it("only folds bodies that are actually walls", () => {
    expect(isLong("word ".repeat(50))).toBe(false);
    expect(isLong("word ".repeat(200))).toBe(true);
  });

  it("cuts the lead-in on a sentence, never mid-word", () => {
    const long = "First sentence here. Second sentence follows. " + "filler ".repeat(120);
    const lead = leadIn(long);
    expect(lead.endsWith("…")).toBe(true);
    expect(lead).not.toMatch(/\bfille…$/);
    expect(wordCount(long)).toBeGreaterThan(100);
  });
});

describe("real deadlines", () => {
  const now = new Date("2026-08-05T12:00:00Z"); // a Wednesday

  it("ranks what the sender said, and never invents urgency", () => {
    expect(byRank("today", now)).toBeLessThan(byRank("tomorrow", now));
    expect(byRank("tomorrow", now)).toBeLessThan(byRank("next week", now));
    expect(byRank("", now)).toBe(500);              // nothing said: middle
    expect(byRank("no rush", now)).toBeGreaterThan(500); // explicitly last
    expect(byRank("sometime around the thing", now)).toBe(500); // unparsed: middle
  });

  it("reads a weekday relative to today", () => {
    expect(byRank("Friday", now)).toBe(2);
    expect(byRank("Monday", now)).toBe(5);
  });

  // EMAIL-F-11 (2026-09-05), each line verified by running the old code:
  // `aug 14 @ Aug13 2pm -> 0 Today`, `aug 14 @ Aug13 9am -> 1 Tomorrow`,
  // `once you know -> 0 Today`, `month end -> 4` (Monday).
  it("a dated deadline is counted in calendar days, so tomorrow stays tomorrow all day", () => {
    const morning = new Date("2026-08-13T09:00:00");
    const afternoon = new Date("2026-08-13T14:00:00");
    const lateNight = new Date("2026-08-13T23:30:00");
    expect(byRank("aug 14", morning)).toBe(1);
    expect(byRank("aug 14", afternoon)).toBe(1);
    expect(byRank("aug 14", lateNight)).toBe(1);
    expect(byRank("aug 13", afternoon)).toBe(0);
    expect(byRank("Aug 20", afternoon)).toBe(7);
  });

  it("keywords are whole words: 'know' is not 'now', and 'nowhere' is not urgent", () => {
    expect(byRank("once you know", now)).toBe(500);
    expect(byRank("nowhere near", now)).toBe(500);
    expect(byRank("now", now)).toBe(0);
    expect(byRank("by today", now)).toBe(0);
    expect(byRank("ASAP please", now)).toBe(0);
  });

  it("a weekday is a weekday word, so 'month end' is not Monday and 'sunset' is not Sunday", () => {
    expect(byRank("month end", now)).toBe(500);
    expect(byRank("sunset", now)).toBe(500);
    expect(byRank("mon", now)).toBe(5);
    expect(byRank("Tues", now)).toBe(6);
    expect(byRank("Thursday", now)).toBe(1);
    expect(byRank("Wednesday", now)).toBe(7); // said on a Wednesday: next one
  });

  it("sorts Needs You by the stated deadline, newest first on a tie", () => {
    const rows = [row("a", 100), row("b", 300), row("c", 200)];
    const map: TriageMap = {
      a: { bucket: "needs_you", gist: "", lastMsgId: "am", by: "no rush" },
      b: { bucket: "needs_you", gist: "", lastMsgId: "bm" },
      c: { bucket: "needs_you", gist: "", lastMsgId: "cm", by: "today" },
    };
    expect(sortByDeadline(rows, map, now).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });
});

describe("self-cleaning inbox", () => {
  beforeEach(() => localStorage.clear());

  it("counts only what was thrown away unread", () => {
    recordToss("promo@x.com", true);
    const counts = recordToss("promo@x.com", false); // read then archived: filing
    expect(counts["promo@x.com"]).toBe(1);
  });

  it("offers only after the threshold, and never twice about one sender", () => {
    let counts = {};
    for (let i = 0; i < TOSS_THRESHOLD - 1; i++) counts = recordToss("promo@x.com", true);
    expect(tossOffer(counts)).toBeNull();
    counts = recordToss("promo@x.com", true);
    expect(tossOffer(counts)?.sender).toBe("promo@x.com");
    markAsked("promo@x.com");
    expect(tossOffer(counts)).toBeNull();
  });

  it("says it in one plain line with no scolding", () => {
    const line = tossLine("peloton@x.com", 6);
    // SPEC MOVED (short copy, 2026-08-15)
    expect(line).toBe("Peloton · Archived unread 6 times");
    expect(line.toLowerCase()).not.toContain("should");
  });
});

describe("the drain", () => {
  beforeEach(() => localStorage.clear());

  it("remembers the number the user picked", () => {
    expect(loadMinutes()).toBe(5);
    saveMinutes(10);
    expect(loadMinutes()).toBe(10);
  });

  it("keeps a typed number sane without silently ignoring it", () => {
    expect(clampMinutes(0)).toBe(1);
    expect(clampMinutes(900)).toBe(60);
    expect(clampMinutes(7)).toBe(7);
    expect(clampMinutes(NaN)).toBe(5);
  });

  it("counts down and stops at zero", () => {
    expect(fmtClock(125000)).toBe("2:05");
    expect(fmtClock(0)).toBe("0:00");
    expect(fmtClock(-5000)).toBe("0:00");
  });

  it("reports what got done and nothing about the remainder", () => {
    const r = drainReceipt(4, 5);
    expect(r).toBe("4 Handled in 5 minutes");
    expect(r).not.toMatch(/left|remaining|still|other/i);
  });
});

import { describe, it, expect } from "vitest";
import { foundRows, foundLine, openCount, FOUND_CLEAN, FOUND_UNKNOWN } from "./found";
import type { MailSnapshot } from "../messages/home";

// UP-MIND-13. The connect screen is the demo for every future pitch, and the
// one thing it must never do is claim something it does not know. These
// pin the count, the sentence, and the two honest alternatives.

const snap = (over: Partial<MailSnapshot> = {}): MailSnapshot => ({
  ts: Date.now(), needsYou: 0, threads: [], waiting: [], promises: [], ...over,
});

describe("what the first thirty seconds says", () => {
  it("counts everything still open, once each", () => {
    expect(openCount(snap({
      needsYou: 5,
      waiting: [{ threadId: "w1", to: "Rob", subject: "Field", days: 9 }],
      promises: [{ threadId: "p1", text: "Send the roster" }],
    }))).toBe(7);
  });

  it("says the true number, singular and plural", () => {
    expect(foundLine(7)).toBe("I found 7 things still open from the last 30 days");
    expect(foundLine(1)).toBe("I found 1 thing still open from the last 30 days");
  });

  // The empty case is a good outcome, and the failure case is a different
  // sentence entirely: a read that failed must never render as clean.
  it("keeps clean and could-not-read as separate sentences", () => {
    expect(FOUND_CLEAN).not.toBe(FOUND_UNKNOWN);
    expect(FOUND_CLEAN).toContain("clean");
    expect(FOUND_UNKNOWN).toContain("Couldn't");
  });
});

describe("the three examples", () => {
  const thread = (over = {}) => ({
    id: "t1", from: "Nadia", fromEmail: "n@x.com", subject: "Invoice 4021",
    gist: "needs the invoice", by: "today", ...over,
  } as MailSnapshot["threads"][number]);

  it("shows the verbatim sentence when a claim is anchored to one", () => {
    const rows = foundRows(snap({
      needsYou: 1,
      threads: [thread({ byEv: { sourceMsgId: "m1", span: "Can you get it back to me by close of play today?", confidence: "high" } })],
    }), "2026-08-15", new Date("2026-08-15T09:00:00"));
    expect(rows[0]!.sentence).toBe("Can you get it back to me by close of play today?");
  });

  it("falls back to the gist rather than inventing a sentence", () => {
    const rows = foundRows(snap({ needsYou: 1, threads: [thread()] }), "2026-08-15", new Date("2026-08-15T09:00:00"));
    expect(rows[0]!.sentence).toBe("needs the invoice");
  });

  it("gives every row something the screen can actually finish", () => {
    const rows = foundRows(snap({
      needsYou: 2,
      threads: [thread(), thread({ id: "t2", from: "Rob", subject: "Field booking", by: "" })],
    }), "2026-08-15", new Date("2026-08-15T09:00:00"));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.taskText.trim().length).toBeGreaterThan(0);
  });

  it("shows at most three, however full the inbox is", () => {
    // Distinct senders and gists: mailNotices folds two rows that read
    // the same into one, which is its own law.
    const many = Array.from({ length: 9 }, (_, i) => thread({ id: "t" + i, from: "Sender " + i, subject: "Subject " + i, gist: "wants thing " + i, by: "" }));
    expect(foundRows(snap({ needsYou: 9, threads: many }), "2026-08-15")).toHaveLength(3);
  });

  it("shows nothing at all from an empty snapshot", () => {
    expect(foundRows(snap(), "2026-08-15")).toEqual([]);
  });
});

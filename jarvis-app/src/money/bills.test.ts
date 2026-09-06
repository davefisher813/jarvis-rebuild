import { describe, it, expect } from "vitest";
import { activeBills, billSubline, dayPhrase, monthDay, paydayNext, paydayLine } from "./bills";
import type { TaskItem } from "../tasks/TasksService";
import type { TaskData } from "../notes/types";

// Money v1 bill language. These pin the laws, not just the strings:
// autopay NEVER claims "paid", receipts are dated, overdue is words.

const TODAY = "2026-08-03"; // a Monday

const bill = (over: Partial<TaskData> = {}): TaskItem =>
  ({ id: "b", data: { text: "Electric", category: "", done: false, bill: { amount: 120 }, ...over } }) as TaskItem;

describe("billSubline", () => {
  it("speaks proximity, not dates, on the near horizon", () => {
    expect(billSubline(bill({ due: "2026-08-03" }), TODAY).text).toBe("Due today");
    expect(billSubline(bill({ due: "2026-08-04" }), TODAY).text).toBe("Due tomorrow");
    expect(billSubline(bill({ due: "2026-08-06" }), TODAY).text).toBe("Due in 3 days");
    expect(billSubline(bill({ due: "2026-08-30" }), TODAY).text).toBe("Due Aug 30");
  });

  it("overdue is words, stated flat", () => {
    expect(billSubline(bill({ due: "2026-08-02" }), TODAY)).toEqual({ text: "Was due yesterday", state: "overdue" });
    expect(billSubline(bill({ due: "2026-08-01" }), TODAY).text).toBe("Was due 2 days ago");
  });

  it("manual payments get a dated receipt", () => {
    // recurring: paid 2 days ago, rolled to next month
    const paid = bill({ recurrence: "monthly", lastDone: "2026-08-01", due: "2026-09-01" });
    expect(billSubline(paid, TODAY)).toEqual({ text: "Paid Aug 1", state: "paid" });
    // one-time: done keeps its receipt past the 5-day freshness window
    const once = bill({ done: true, lastDone: "2026-07-20" });
    expect(billSubline(once, TODAY)).toEqual({ text: "Paid Jul 20", state: "paid" });
  });

  it("autopay NEVER says paid: only scheduled language, before and after", () => {
    const upcoming = bill({ bill: { amount: 1850, autopay: true }, recurrence: "monthly", due: "2026-08-07" });
    expect(billSubline(upcoming, TODAY).text).toBe("Set to autopay · Friday");
    const rolled = bill({ bill: { amount: 1850, autopay: true }, recurrence: "monthly", due: "2026-09-01", lastDone: "2026-08-01" });
    expect(billSubline(rolled, TODAY).text).toBe("Autopay scheduled Aug 1");
    for (const b of [upcoming, rolled]) {
      expect(billSubline(b, TODAY).text.toLowerCase()).not.toContain("paid");
      expect(billSubline(b, TODAY).text.toLowerCase()).not.toContain("handled");
    }
  });

  // HMN-F-11 (2026-09-05): a once bill set to autopay read "Set to autopay ·
  // today" every day after its date, forever, because dayPhrase had no past
  // tense and the roll only handled recurring bills. Once the roll marks it
  // handled its receipt is the last word, and it still never says "paid".
  it("a once autopay bill keeps its scheduled receipt after its date has gone", () => {
    const handled = bill({ bill: { amount: 85, autopay: true }, done: true, due: "2026-07-20", lastDone: "2026-07-20" });
    expect(billSubline(handled, TODAY)).toEqual({ text: "Autopay scheduled Jul 20", state: "paid" });
    expect(billSubline(handled, TODAY).text.toLowerCase()).not.toContain("paid");
    // Before the roll runs, the line at least says the day it was, not "today".
    const lapsed = bill({ bill: { amount: 85, autopay: true }, due: "2026-07-20" });
    expect(billSubline(lapsed, TODAY).text).toBe("Set to autopay · Jul 20");
  });
});

describe("activeBills", () => {
  it("keeps unpaid bills and recent receipts, drops finished stories, sorts by due", () => {
    const tasks = [
      bill({ text: "old", done: true, lastDone: "2026-06-01" }), // paid 2 months ago: gone
      bill({ text: "recent", done: true, lastDone: "2026-07-20" }), // recent receipt: stays
      bill({ text: "b2", due: "2026-08-10" }),
      bill({ text: "b1", due: "2026-08-04" }),
      { id: "t", data: { text: "not a bill", category: "", done: false } } as TaskItem,
    ];
    const out = activeBills(tasks, TODAY);
    expect(out.map((t) => t.data.text)).toEqual(["b1", "b2", "recent"]);
  });
});

describe("payday anchoring", () => {
  it("advances the anchor to the next payday on or after today", () => {
    expect(paydayNext({ amount: 1200, next: "2026-08-07", freq: "biweekly" }, TODAY)).toBe("2026-08-07");
    expect(paydayNext({ amount: 1200, next: "2026-07-10", freq: "biweekly" }, TODAY)).toBe("2026-08-07");
    expect(paydayNext({ amount: 1200, next: "2026-05-31", freq: "monthly" }, TODAY)).toBe("2026-08-31");
  });

  // HMN-F-05 (2026-09-05): beyond UTC+12 the weekly hop read as six days and
  // the biweekly as thirteen, because local noon is still the previous day in
  // UTC and the walk read its date back through toISOString(). Kiritimati is
  // UTC+14 in every season, so the case holds year round.
  it("weekly and biweekly hops are whole weeks fourteen hours ahead of Greenwich", () => {
    const prevTz = process.env.TZ;
    process.env.TZ = "Pacific/Kiritimati";
    try {
      // Anchored on a Monday, the next payday is a Monday.
      expect(paydayNext({ amount: 900, next: "2026-01-05", freq: "weekly" }, "2026-01-20")).toBe("2026-01-26");
      expect(paydayNext({ amount: 900, next: "2026-01-05", freq: "biweekly" }, "2026-03-01")).toBe("2026-03-02");
    } finally {
      process.env.TZ = prevTz;
    }
  });

  it("counts unpaid bills in the window, including overdue; autopay-rolled past next payday drops out", () => {
    const p = { amount: 1200, next: "2026-08-07", freq: "biweekly" as const };
    const line = paydayLine(p, [
      bill({ text: "electric", due: "2026-08-05" }), // in window: 120
      bill({ text: "water", bill: { amount: 45 }, due: "2026-08-01" }), // overdue, still owed: 45
      bill({ text: "rent", bill: { amount: 1850 }, due: "2026-08-20" }), // after payday: out of window
    ], TODAY);
    expect(line!.title).toBe("Between now and Friday");
    expect(line!.sub).toBe("$1,200 in · $165 of bills out");
  });

  // HMN-F-10 (2026-09-05), option A. The line carried a fourth filter that
  // dropped an autopay bill rolled in the last five days whose next date was
  // still ahead. On the monthly case the rolled date lands past payday and
  // `due <= payday` had already excluded it, so the filter only ever changed
  // the answer for weekly autopay, where it hid a real outflow: the Yours
  // hero subtracted the $500 and this row said nothing at all.
  it("a weekly autopay bill rolled two days ago and due before payday is money out", () => {
    const p = { amount: 1200, next: "2026-08-07", freq: "biweekly" as const };
    const weekly = bill({
      text: "childcare",
      bill: { amount: 500, autopay: true },
      recurrence: "weekly",
      lastDone: "2026-08-01",
      due: "2026-08-05",
    });
    const line = paydayLine(p, [weekly], TODAY);
    expect(line).not.toBeNull();
    expect(line!.sub).toBe("$1,200 in · $500 of bills out");
    // And it agrees with the hero, which counts by the same one rule
    // (MoneyFlow.tsx: unpaid, dated, due on or before payday).
    const heroOut = [weekly]
      .filter((t) => !t.data.done && !!t.data.due && t.data.due <= paydayNext(p, TODAY))
      .reduce((sum, t) => sum + (t.data.bill?.amount ?? 0), 0);
    expect(line!.sub).toContain("$" + heroOut.toLocaleString() + " of bills out");
  });

  it("says nothing when there is nothing honest to say", () => {
    const p = { amount: 1200, next: "2026-08-07", freq: "weekly" as const };
    expect(paydayLine(p, [], TODAY)).toBeNull();
    expect(paydayLine(p, [bill({ due: "2026-09-01" })], TODAY)).toBeNull();
  });
});

describe("date words", () => {
  it("phrases days like a person", () => {
    expect(dayPhrase("2026-08-03", TODAY)).toBe("today");
    expect(dayPhrase("2026-08-04", TODAY)).toBe("tomorrow");
    expect(dayPhrase("2026-08-07", TODAY)).toBe("Friday");
    expect(dayPhrase("2026-08-30", TODAY)).toBe("Aug 30");
    expect(monthDay("2026-12-05")).toBe("Dec 5");
  });

  // HMN-F-11: a date already behind us used to come back as "today".
  it("says a day behind us in the past tense", () => {
    expect(dayPhrase("2026-08-02", TODAY)).toBe("yesterday");
    expect(dayPhrase("2026-07-20", TODAY)).toBe("Jul 20");
  });
});

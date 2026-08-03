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
});

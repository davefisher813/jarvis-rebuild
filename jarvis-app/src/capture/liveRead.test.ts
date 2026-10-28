import { describe, it, expect } from "vitest";
import { liveRead, type LiveLanes } from "./liveRead";

// THE LIVE READ (research standard, rule 12, 2026-10-19). 2026-10-19 is a Monday.
const TODAY = "2026-10-19";
const ALL: LiveLanes = { strands: true, decisions: true, ledger: true, tracker: true };
const CTX = {
  people: [{ id: "p1", name: "Marco" }, { id: "p2", name: "Dana Reyes" }],
  projects: [{ id: "pr1", title: "Kitchen Remodel" }],
  categories: [{ id: "c1", name: "Work" }],
};
const read = (t: string, lanes: Partial<LiveLanes> = {}) => liveRead(t, TODAY, CTX, { ...ALL, ...lanes });

describe("liveRead: the facts the receipt will draw, read while the line is typed", () => {
  it("an event reads its day and time, and names no contact: a name in the words files nobody", () => {
    const r = read("Dinner with Marco Thursday 7pm")!;
    expect(r.entity).toMatchObject({ kind: "event", date: "2026-10-22", start: "19:00" });
    expect(r.names).toEqual({});
  });

  it("a payment already made reads as an expense; with no tracker it is not one, and claims no day", () => {
    expect(read("Spent 30 on gas")!.entity).toMatchObject({ kind: "expense", expense: { amountCents: 3000 } });
    const closed = read("Spent 30 on gas", { tracker: false })!;
    expect(closed.entity.kind).toBe("task");
    expect(closed.entity.expense).toBeUndefined();
    expect(closed.entity.date).toBeUndefined();
  });

  it("an amount owed reads as a bill; with no ledger it is a task, never a bill", () => {
    expect(read("$1,200 rent on the 1st")!.entity).toMatchObject({ kind: "bill", bill: { amount: 1200 }, date: "2026-11-01" });
    const closed = read("$1,200 rent on the 1st", { ledger: false });
    expect(closed?.entity.bill).toBeUndefined();
  });

  it("a reminder reads its clock time", () => {
    expect(read("Remind me to stretch at 6pm")!.entity.reminder).toEqual({ time: "18:00" });
  });

  it("the stated destinations read first: Remember, Never, Decision", () => {
    expect(read("Remember Marco prefers texts")!.entity).toMatchObject({ kind: "fact", factType: "relationship" });
    expect(read("Never schedule meetings before 9am")!.entity).toMatchObject({ kind: "fact", rule: true });
    expect(read("Decision: go with the blue one")!.entity.kind).toBe("decision");
  });

  it("a lane whose store is closed is closed here too", () => {
    expect(read("Remember Marco prefers texts", { strands: false })?.entity.kind).not.toBe("fact");
    expect(read("Decision: go with the blue one", { decisions: false })?.entity.kind).not.toBe("decision");
  });

  it("a #tag that names one area reads it", () => {
    expect(read("Buy milk tomorrow #work 30 min")!.area).toBe("c1");
  });

  it("several lines say only how many", () => {
    expect(read("Lunch\nCall mom\nBuy milk")!.items).toBe(3);
  });

  it("says nothing for a note, an empty box, or a paste too long to read live", () => {
    expect(read("The quick brown fox jumps over")).toBeNull();
    expect(read("   ")).toBeNull();
    expect(read("Dinner with Marco Thursday 7pm ".repeat(200))).toBeNull();
  });

  it("names the project a title contains", () => {
    expect(read("Order tile for the Kitchen Remodel")?.names.project).toBe("Kitchen Remodel");
  });
});

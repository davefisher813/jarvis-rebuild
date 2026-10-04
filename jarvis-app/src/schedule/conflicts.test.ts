import { describe, it, expect } from "vitest";
import {
  dayItemsFor, findConflicts, nextFreeSlot, conflictLine, hasRealConflict, shiftNewConflicts, spanText, moveNote,
} from "./conflicts";
import { withConflictCheck, askFor, type ConflictAsk } from "./withConflictCheck";
import type { EventItem } from "./types";
import { planDay } from "./planDay";
import { splitProtectedRanges } from "../routine/types";
import type { ProtectedRange } from "../routine/types";

// The Schedule audit's P0 #2: nothing asked "what does this land on" before a
// write. These pin the question: what counts as a real conflict, what is only
// soft, what the nearest free slot is, and that the wrapper warns and then
// ALWAYS allows.

const DAY = "2026-10-02";
const ev = (id: string, title: string, start: string, end: string | undefined, extra: Partial<EventItem["data"]> = {}): EventItem => ({
  id, data: { title, date: DAY, start, end, category: "", ...extra } as EventItem["data"],
});
const hm = (h: number, m = 0) => h * 60 + m;

// The audit's day: Breakfast is a hard protected block, Gym and Lunch are
// flexible (soft) blocks, Deep Work is a block that holds tasks.
const ranges: ProtectedRange[] = [
  { s: hm(9, 30), e: hm(10), label: "Breakfast", id: "b1", kind: "meal" },
  { s: hm(10), e: hm(12), label: "Gym", id: "b2", kind: "gym", soft: true, mode: "protects" },
  { s: hm(12), e: hm(13), label: "Lunch", id: "b3", kind: "meal", soft: true },
  { s: hm(14), e: hm(16), label: "Deep Work", id: "b4", kind: "focus" },
];

describe("dayItemsFor", () => {
  it("classifies events, planner blocks, protected, flexible and holding blocks", () => {
    const items = dayItemsFor(
      [ev("e1", "Golf", "11:20", "13:20"), ev("t1", "Write report", "08:00", "09:00", { sourceTaskId: "task" })],
      DAY, ranges,
    );
    const kind = (title: string) => items.find((i) => i.title === title)?.kind;
    expect(kind("Golf")).toBe("event");
    expect(kind("Write report")).toBe("task");
    expect(kind("Breakfast")).toBe("protected");
    expect(kind("Gym")).toBe("flexible");
    expect(kind("Lunch")).toBe("flexible");
    expect(items.find((i) => i.title === "Deep Work")).toMatchObject({ kind: "flexible", holds: true });
  });

  // KEPT CLEAR WHEN POSSIBLE REACHES A BLEND (2026-10-04). A commute or a gym
  // is busy time (a wall) until its flexible switch is on; the conflict check
  // used to hold a blend as protected whatever the switch said.
  it("a Can Blend block is a wall, and flexible once its switch is on", () => {
    const blends: ProtectedRange[] = [
      { s: hm(7), e: hm(8), label: "Drive", id: "c1", kind: "commute" },
      { s: hm(8), e: hm(9), label: "School Run", id: "c2", kind: "commute", soft: true },
    ];
    const kind = (title: string) => dayItemsFor([], DAY, blends).find((i) => i.title === title)?.kind;
    expect(kind("Drive")).toBe("protected");
    expect(kind("School Run")).toBe("flexible");
  });

  it("an event with no end is an hour, like the calendar says", () => {
    const [i] = dayItemsFor([ev("e", "Call", "09:00", undefined)], DAY);
    expect(i).toMatchObject({ start: hm(9), end: hm(10) });
  });

  it("a recurring event counts on the days it occurs, and not on the others", () => {
    const daily = ev("d", "Standup", "09:00", "09:15", { date: "2026-09-01", recurrence: "daily" });
    expect(dayItemsFor([daily], DAY).map((i) => i.title)).toEqual(["Standup"]);
    const weekly = ev("w", "Class", "09:00", "10:00", { date: "2026-09-01", recurrence: "weekly" });
    // 2026-09-01 is a Tuesday; 2026-10-02 is a Friday.
    expect(dayItemsFor([weekly], DAY)).toEqual([]);
  });
});

describe("findConflicts", () => {
  const items = dayItemsFor([ev("golf", "Golf", "11:20", "13:20")], DAY, ranges);

  it("the audit's repro: a 9:30 to 9:45 task lands on protected Breakfast, a REAL conflict", () => {
    const cs = findConflicts(items, { start: hm(9, 30), end: hm(9, 45), forTask: true });
    expect(cs.map((c) => [c.item.title, c.severity])).toEqual([["Breakfast", "conflict"]]);
    expect(hasRealConflict(cs)).toBe(true);
  });

  it("the audit's other repro: fixed Golf 11:20 to 1:20 reports Gym and Lunch as SOFT", () => {
    const cs = findConflicts(items, { start: hm(11, 20), end: hm(13, 20), ignoreId: "golf" });
    expect(cs.map((c) => [c.item.title, c.severity])).toEqual([["Gym", "soft"], ["Lunch", "soft"]]);
    expect(hasRealConflict(cs)).toBe(false);
  });

  it("overlapping a fixed event is a real conflict; the event itself is ignored when moving it", () => {
    expect(findConflicts(items, { start: hm(12), end: hm(13) }).some((c) => c.item.title === "Golf" && c.severity === "conflict")).toBe(true);
    expect(findConflicts(items, { start: hm(12), end: hm(13), ignoreId: "golf" }).some((c) => c.item.title === "Golf")).toBe(false);
  });

  it("touching is not overlapping: ending at 9:30 and starting at 10:00 are both clear of Breakfast", () => {
    expect(findConflicts(items, { start: hm(8, 30), end: hm(9, 30) })).toEqual([]);
    expect(findConflicts(items, { start: hm(10), end: hm(10, 30) }).some((c) => c.item.title === "Breakfast")).toBe(false);
  });

  it("a task landing in a block that holds tasks is not a conflict; an event there is a soft one", () => {
    expect(findConflicts(items, { start: hm(14), end: hm(15), forTask: true })).toEqual([]);
    expect(findConflicts(items, { start: hm(14), end: hm(15) }).map((c) => [c.item.title, c.severity])).toEqual([["Deep Work", "soft"]]);
  });

  it("two planned tasks at one time conflict", () => {
    const day = dayItemsFor([ev("t1", "Taxes", "16:00", "17:00", { sourceTaskId: "a" })], DAY);
    expect(findConflicts(day, { start: hm(16, 30), end: hm(17, 30), forTask: true })[0]).toMatchObject({ severity: "conflict", item: { kind: "task" } });
  });

  it("a proposal with no length is still a quarter hour, not a free pass", () => {
    expect(findConflicts(items, { start: hm(9, 40), end: hm(9, 40) }).length).toBe(1);
  });
});

describe("nextFreeSlot", () => {
  it("the audit's repro: from 9:30 the nearest free hour is after Breakfast AND the Gym and Lunch, not 10:00", () => {
    const items = dayItemsFor([], DAY, ranges);
    // 10:00 to 11:00 is clear of every REAL conflict but sits in flexible Gym;
    // the first slot clear of everything is 1:00 PM.
    expect(nextFreeSlot(items, 60, hm(9, 30), { forTask: true })).toBe(hm(13));
  });

  it("with no flexible blocks, it is exactly where the blocker ends", () => {
    const items = dayItemsFor([ev("e", "Interview", "09:00", "10:30")], DAY, [ranges[0]!]);
    expect(nextFreeSlot(items, 30, hm(9), {})).toBe(hm(10, 30));
  });

  it("falls back to the nearest start clear of every REAL conflict when only flexible time is left", () => {
    const wall = [ev("e", "All day", "13:00", "23:00")];
    const items = dayItemsFor(wall, DAY, [{ s: hm(8), e: hm(13), label: "Gym", soft: true, kind: "gym", mode: "protects", id: "g" }]);
    expect(nextFreeSlot(items, 60, hm(9))).toBe(hm(9));
  });

  it("null when nothing fits before the day ends", () => {
    const items = dayItemsFor([ev("e", "Everything", "00:00", "23:59")], DAY);
    expect(nextFreeSlot(items, 60, hm(9))).toBeNull();
  });

  it("an ignored event does not block its own new slot", () => {
    const items = dayItemsFor([ev("mine", "Mine", "09:00", "10:00")], DAY);
    expect(nextFreeSlot(items, 60, hm(9), { ignoreId: "mine" })).toBe(hm(9));
  });
});

describe("conflictLine", () => {
  it("one line naming what it overlaps", () => {
    const cs = findConflicts(dayItemsFor([], DAY, ranges), { start: hm(9, 30), end: hm(9, 45) });
    expect(conflictLine(cs)).toBe("Overlaps Breakfast 9:30 to 10:00 AM");
  });
  it("names the real conflict first and counts the rest", () => {
    const items = dayItemsFor([ev("golf", "Golf", "11:20", "13:20")], DAY, ranges);
    const cs = findConflicts(items, { start: hm(11, 30), end: hm(12, 30) });
    expect(conflictLine(cs)).toBe("Overlaps Golf 11:20 AM to 1:20 PM and 2 More");
  });
  it("a span across noon keeps both meridiems; no overlap is no line", () => {
    expect(spanText(hm(11, 30), hm(12, 30))).toBe("11:30 AM to 12:30 PM");
    expect(conflictLine([])).toBe("");
  });
});

describe("shiftNewConflicts (Running Late)", () => {
  it("counts the clashes the push CREATES with what did not move, not the ones already there", () => {
    const day = [
      ev("moving", "Interview", "11:30", "12:30"),
      ev("series", "Team sync", "13:00", "14:00", { recurrence: "daily", date: "2026-09-01" }),
    ];
    const r = shiftNewConflicts(day, DAY, [day[0]!], 45, []);
    expect(r.count).toBe(1);
    expect(r.first?.item.title).toBe("Team sync");
  });
  it("a protected block counts too, and a clear push is zero", () => {
    const day = [ev("m", "Call", "09:00", "09:30")];
    expect(shiftNewConflicts(day, DAY, day, 30, ranges).count).toBe(1);
    expect(shiftNewConflicts(day, DAY, day, 240, ranges).count).toBe(0);
  });
});

describe("moveNote (a nudge's toast line)", () => {
  const items = dayItemsFor([ev("m", "Call", "08:00", "09:00"), ev("o", "Interview", "09:30", "10:30")], DAY, []);
  const call = { id: "m", start: "08:00", end: "09:00" };

  it("names what a nudge into an occupied slot lands on", () => {
    expect(moveNote(items, call, "09:15")).toBe("Overlaps Interview 9:30 to 10:30 AM");
  });
  it("is quiet when the nudge lands on nothing", () => {
    expect(moveNote(items, call, "08:15")).toBe("");
  });
  it("does not repeat a clash the event already had", () => {
    const clash = dayItemsFor([ev("m", "Call", "09:00", "10:00"), ev("o", "Interview", "09:30", "10:30")], DAY, []);
    expect(moveNote(clash, { id: "m", start: "09:00", end: "10:00" }, "09:15")).toBe("");
  });
});

describe("withConflictCheck: warn, then allow", () => {
  const items = dayItemsFor([], DAY, ranges);
  const input = { items, start: "09:30", end: "09:45", forTask: true };
  const prompts: ConflictAsk[] = [];
  const asker = (choice: "book" | "alt" | "cancel") => async (a: ConflictAsk) => { prompts.push(a); return choice; };

  it("a clear proposal commits without asking", async () => {
    let asked = false;
    const r = await withConflictCheck({ items, start: "08:00", end: "09:00" }, async () => { asked = true; return "cancel"; }, async (s) => s.start);
    expect(asked).toBe(false);
    expect(r).toMatchObject({ status: "booked", value: "08:00", conflicts: [] });
  });

  it("offers one line, the nearest free slot, and the three choices", async () => {
    const found = askFor(input)!;
    expect(found.ask.line).toBe("Overlaps Breakfast 9:30 to 10:00 AM");
    expect(found.ask.tone).toBe("conflict");
    expect(found.ask.altLabel).toBe("1:00 PM");
  });

  it("Book Anyway writes the original time", async () => {
    const wrote: string[] = [];
    const r = await withConflictCheck(input, asker("book"), async (s) => { wrote.push(`${s.start}-${s.end}`); });
    expect(wrote).toEqual(["09:30-09:45"]);
    expect(r.status).toBe("booked");
    expect(r.conflicts.length).toBe(1);
  });

  it("Use writes the free slot, keeping the length", async () => {
    const wrote: string[] = [];
    const r = await withConflictCheck(input, asker("alt"), async (s) => { wrote.push(`${s.start}-${s.end}`); });
    expect(wrote).toEqual(["13:00-13:15"]);
    expect(r.status).toBe("moved");
  });

  it("Cancel writes nothing", async () => {
    let wrote = false;
    const r = await withConflictCheck(input, asker("cancel"), async () => { wrote = true; });
    expect(wrote).toBe(false);
    expect(r.status).toBe("cancelled");
  });

  it("with no way to ask, it still commits (never blocks) and returns the conflicts", async () => {
    const wrote: string[] = [];
    const r = await withConflictCheck(input, undefined, async (s) => { wrote.push(s.start); });
    expect(wrote).toEqual(["09:30"]);
    expect(r.conflicts.length).toBe(1);
  });

  it("choosing Use when no slot exists falls back to booking as asked", async () => {
    const full = dayItemsFor([ev("e", "Everything", "00:00", "23:59")], DAY);
    const wrote: string[] = [];
    const r = await withConflictCheck({ items: full, start: "09:00", end: "10:00" }, async (a) => { expect(a.altLabel).toBeNull(); return "alt"; }, async (s) => { wrote.push(s.start); });
    expect(wrote).toEqual(["09:00"]);
    expect(r.status).toBe("booked");
  });
});


describe("Plan My Day never proposes into a fixed event or a protected block", () => {
  it("every pick on the audit's day clears every real conflict, judged by the same rules the prompt uses", () => {
    const golf = ev("golf", "Golf", "11:20", "13:20");
    const split = splitProtectedRanges(ranges);
    const tasks = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, text: id, category: "", durationMin: 45 }));
    const plan = planDay(tasks, [golf], hm(8), hm(20), 10, split.hard, split.soft, split.focus);
    expect(plan.blocks.length).toBeGreaterThan(0);
    const items = dayItemsFor([golf], DAY, ranges);
    for (const b of plan.blocks) {
      const real = findConflicts(items, { start: hhm(b.start), end: hhm(b.end), forTask: true }).filter((c) => c.severity === "conflict");
      expect(real, `${b.taskId} at ${b.start}`).toEqual([]);
    }
  });
});
const hhm = (t: string) => hm(Number(t.slice(0, 2)), Number(t.slice(3, 5)));

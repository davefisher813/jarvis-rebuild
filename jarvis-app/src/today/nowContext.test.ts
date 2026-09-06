// Group B laws (addendum items 10-12): the Now line is derived facts in
// short-copy grammar; Gap Fill offers only what actually fits and stays
// silent otherwise; the Hyperfocus Guard is a fact line that warns inside
// ten minutes and never blocks anything.

import { describe, it, expect } from "vitest";
import { nowContext, gapFill, hyperfocusGuard, fmtSpan, GAP_MIN_MINUTES } from "./nowContext";
import type { EventItem } from "../schedule/types";

const ev = (title: string, start: string, end?: string): EventItem =>
  ({ id: title, data: { title, date: "2026-08-15", start, category: "", ...(end ? { end } : {}) } }) as EventItem;

const TODAY = "2026-08-15";

describe("Now Context (item 10)", () => {
  it("free time states the next commitment and the open span", () => {
    const ctx = nowContext([ev("Practice", "18:00", "19:30")], [], "15:20");
    expect(ctx.line).toBe("Free until 6 PM · 2 hr 40 min open");
    expect(ctx.gapMin).toBe(160);
    expect(ctx.nextStart).toBe("18:00");
  });

  it("inside an event says so, with its end", () => {
    const ctx = nowContext([ev("Practice", "18:00", "19:30")], [], "18:30");
    expect(ctx.line).toBe("In: Practice until 7:30 PM");
    expect(ctx.gapMin).toBeNull();
  });

  it("protected routine blocks count as commitments", () => {
    const ctx = nowContext([], [{ s: 17 * 60, e: 18 * 60, label: "Dinner" }], "16:00");
    expect(ctx.line).toBe("Free until 5 PM · 1 hr open");
    expect(ctx.nextTitle).toBe("Dinner");
  });

  it("an empty rest-of-day is a clear fact, not a guess", () => {
    const ctx = nowContext([ev("Morning", "08:00", "09:00")], [], "20:00");
    expect(ctx.line).toBe("Clear from here");
    expect(ctx.gapMin).toBeNull();
  });

  it("spans format tight", () => {
    expect(fmtSpan(45)).toBe("45 min");
    expect(fmtSpan(120)).toBe("2 hr");
    expect(fmtSpan(160)).toBe("2 hr 40 min");
  });
});

// LEAVE BY (UP-CORE-07, 2026-09-05): the free window ends when you have to
// stand up, not when the thing starts, and the guard counts to the leaving.
describe("Leave By in the Now line and the guard", () => {
  const withTravel = (title: string, start: string, travelMin: number): EventItem =>
    ({ id: title, data: { title, date: "2026-08-15", start, category: "", location: "Rink 2", travelMin } }) as EventItem;

  it("free time ends at the leave time, and says what the leaving is for", () => {
    const ctx = nowContext([withTravel("Practice", "18:00", 20)], [], "15:20");
    expect(ctx.line).toBe("Free until 5:40 PM · then leave for Practice");
    expect(ctx.nextLeave).toEqual({ at: "17:40", title: "Practice" });
    // The gap on offer is the time actually free, not the time until it starts.
    expect(ctx.gapMin).toBe(140);
  });

  it("an event with no travel time reads exactly as it always has", () => {
    const ctx = nowContext([ev("Practice", "18:00", "19:30")], [], "15:20");
    expect(ctx.line).toBe("Free until 6 PM · 2 hr 40 min open");
    expect(ctx.nextLeave).toBeNull();
  });

  it("the guard warns about the leaving, inside ten minutes of it", () => {
    expect(hyperfocusGuard([withTravel("Practice", "18:00", 20)], "15:00"))
      .toEqual({ text: "Leave for Practice at 5:40 PM", warn: false });
    expect(hyperfocusGuard([withTravel("Practice", "18:00", 20)], "17:32"))
      .toEqual({ text: "Leave for Practice in 8 min", warn: true });
  });
});

describe("Gap Fill (item 11)", () => {
  const task = (id: string, text: string, extra = {}) => ({ id, text, category: "work", done: false, ...extra });

  it("offers the task that fits, due-today first", () => {
    const pick = gapFill(
      [task("a", "Long thing"), task("b", "Due today", { due: TODAY })],
      60,
      TODAY,
      () => 30,
    );
    expect(pick!.id).toBe("b");
    expect(pick!.estimateMin).toBe(30);
  });

  it("silent when nothing fits the gap", () => {
    expect(gapFill([task("a", "Big")], 40, TODAY, () => 45)).toBeNull();
  });

  it("silent on slivers, inside events, and for bills", () => {
    expect(gapFill([task("a", "T")], GAP_MIN_MINUTES - 1, TODAY, () => 10)).toBeNull();
    expect(gapFill([task("a", "T")], null, TODAY, () => 10)).toBeNull();
    expect(gapFill([task("a", "Rent", { bill: { amount: 1 } })], 60, TODAY, () => 10)).toBeNull();
  });

  // B6-5 (2026-09-04): "The Now card can offer a reminder as work." Every
  // other chokepoint that turns tasks into a work queue excludes reminders
  // (filters.ts, upnext.ts); this one did not, so a free gap could deal a
  // reminder like Morning Meds a Start button and a ritual sheet.
  it("silent for a reminder, even when it would otherwise fit", () => {
    expect(gapFill([task("a", "Take meds", { reminder: { time: "09:00" } })], 60, TODAY, () => 10)).toBeNull();
  });

  // TODAY-F-20 (2026-09-05): the planner has never offered a paused
  // category's tasks; this door could.
  it("silent for a task in a category paused for the season", () => {
    expect(gapFill([task("a", "Book the field")], 60, TODAY, () => 10, new Set(["work"]))).toBeNull();
  });

  // UP-CORE-02 (2026-09-05): the task's own length beats the category median,
  // which is the entire point of the offer: a ten minute call fits a thirty
  // minute gap that its category's 45 minute median would have hidden it from.
  it("a task's own length fits the gap its category's median would not", () => {
    const pick = gapFill([task("a", "Call the dentist", { estimateMin: 10 })], 30, TODAY, () => 45);
    expect(pick!.id).toBe("a");
    expect(pick!.estimateMin).toBe(10);
  });

  it("a task's own length also keeps it out of a gap it cannot fit", () => {
    expect(gapFill([task("a", "Write the report", { estimateMin: 180 })], 60, TODAY, () => 20)).toBeNull();
  });

  it("still offers work from every category that is not paused", () => {
    const pick = gapFill(
      [task("a", "Paused thing"), { id: "b", text: "Live thing", category: "family", done: false }],
      60, TODAY, () => 10, new Set(["work"]),
    );
    expect(pick!.id).toBe("b");
  });
});

describe("Hyperfocus Guard (item 12)", () => {
  it("states the next commitment as a fact", () => {
    const g = hyperfocusGuard([ev("Practice", "18:00")], "15:00")!;
    expect(g).toEqual({ text: "Practice at 6 PM", warn: false });
  });

  it("warns inside ten minutes, in minutes", () => {
    const g = hyperfocusGuard([ev("Practice", "18:00")], "17:52")!;
    expect(g).toEqual({ text: "Practice in 8 min", warn: true });
  });

  it("nothing coming renders nothing", () => {
    expect(hyperfocusGuard([ev("Done", "08:00")], "20:00")).toBeNull();
  });
});

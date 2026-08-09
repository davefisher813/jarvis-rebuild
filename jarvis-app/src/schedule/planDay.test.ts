import { describe, it, expect } from "vitest";
import { planDay } from "./planDay";
import type { EventItem } from "./types";

const ev = (id: string, start: string, end: string): EventItem => ({ id, data: { title: id, date: "2026-05-20", start, category: "", end } });
const task = (id: string, dur: number) => ({ id, text: id, category: "", durationMin: dur });

describe("planDay", () => {
  it("places tasks back-to-back with a buffer when the day is empty", () => {
    const plan = planDay([task("a", 45), task("b", 30)], [], 540, 1260, 10); // 9:00 start
    expect(plan.unplaced).toHaveLength(0);
    expect(plan.blocks[0]).toMatchObject({ taskId: "a", start: "09:00", end: "09:45" });
    expect(plan.blocks[1]).toMatchObject({ taskId: "b", start: "09:55", end: "10:25" }); // 10m buffer
  });

  it("works around an existing event", () => {
    const plan = planDay([task("a", 60)], [ev("mtg", "09:00", "10:00")], 540, 1260, 10);
    expect(plan.blocks[0]).toMatchObject({ start: "10:00", end: "11:00" }); // jumps past the meeting
  });

  it("returns tasks that don't fit as unplaced, never overlapping", () => {
    const plan = planDay([task("a", 60), task("b", 60)], [], 540, 600, 10); // only 60 min window
    expect(plan.blocks).toHaveLength(1);
    expect(plan.unplaced.map((t) => t.id)).toEqual(["b"]);
  });

  it("empty task list yields an empty plan", () => {
    expect(planDay([], [], 540, 1260)).toEqual({ blocks: [], unplaced: [] });
  });

  it("routes tasks around protected (blocked) ranges just like events", () => {
    // 12:00-13:00 protected (lunch). A 60-min task starting 9:00 must jump it.
    const plan = planDay([task("a", 240)], [], 540, 1260, 10, [{ s: 720, e: 780 }]);
    // 240 min from 9:00 would hit lunch, so it lands after 13:00.
    expect(plan.blocks[0]).toMatchObject({ start: "13:00", end: "17:00" });
  });

  it("still plans normally when blocked is empty (backward compatible)", () => {
    const a = planDay([task("a", 45)], [], 540, 1260, 10);
    const b = planDay([task("a", 45)], [], 540, 1260, 10, []);
    expect(a).toEqual(b);
  });
});

describe("work-hours placement windows (6.7)", () => {
  it("a windowed task lands inside its window even when earlier gaps exist", () => {
    // Day runs 7:00-21:00; work window 9:00-17:00. Task must not land at 7:00.
    const plan = planDay([{ id: "w", text: "w", category: "work", durationMin: 60, windowS: 540, windowE: 1020 }], [], 420, 1260, 10);
    expect(plan.blocks[0]).toMatchObject({ start: "09:00", end: "10:00" });
  });

  // The 2026-08-09 fix. The old behavior, "evening plan cannot place a work
  // task, it comes back unplaced", was pinned by a test right here, and it is
  // exactly what made the feature read as broken: "No room" over a wide-open
  // evening. Windows are soft now.
  it("an evening plan spills a work task past its window, labeled, instead of lying about room", () => {
    // Planning starts 19:00; work window ended 17:00. Plenty of evening room.
    const plan = planDay([{ id: "w", text: "w", category: "work", durationMin: 45, windowS: 540, windowE: 1020 }], [], 1140, 1380, 10);
    expect(plan.unplaced).toHaveLength(0);
    expect(plan.blocks[0]).toMatchObject({ taskId: "w", start: "19:00", end: "19:45", outsideWindow: true });
  });

  it("the window still wins whenever it has room: inside placement carries no label", () => {
    const plan = planDay([{ id: "w", text: "w", category: "work", durationMin: 60, windowS: 540, windowE: 1020 }], [], 420, 1260, 10);
    expect(plan.blocks[0]).toMatchObject({ start: "09:00", end: "10:00" });
    expect(plan.blocks[0]!.outsideWindow).toBeUndefined();
  });

  it("a genuinely full day is still 'no room': soft windows never overlap anything", () => {
    // The whole day is one solid event; nowhere to spill to.
    const plan = planDay(
      [{ id: "w", text: "w", category: "work", durationMin: 45, windowS: 540, windowE: 1020 }],
      [ev("wall", "07:00", "21:00")], 420, 1260, 10,
    );
    expect(plan.blocks).toHaveLength(0);
    expect(plan.unplaced.map((t) => t.id)).toEqual(["w"]);
  });

  it("unwindowed tasks flow around a windowed one without inheriting its limits", () => {
    const plan = planDay(
      [
        { id: "w", text: "w", category: "work", durationMin: 60, windowS: 540, windowE: 1020 },
        { id: "p", text: "p", category: "", durationMin: 60 },
      ],
      [], 420, 1260, 10,
    );
    const w = plan.blocks.find((b) => b.taskId === "w")!;
    const p = plan.blocks.find((b) => b.taskId === "p")!;
    expect(w.start).toBe("09:00");
    // The cursor bug used to shove p to 10:10, after w, wasting the open
    // morning. First-fit gives the unwindowed task the 7:00 gap w refused.
    expect(p.start).toBe("07:00");
  });

  it("a later pick backfills an earlier gap instead of the day reading full", () => {
    // Morning gap 7:00-8:30 exists; first pick is long and lands after the
    // meetings; the short second pick must come back for the morning gap.
    const plan = planDay(
      [task("long", 180), task("short", 30)],
      [ev("m1", "08:30", "09:15"), ev("m2", "09:20", "12:20")],
      420, 1260, 10,
    );
    const long = plan.blocks.find((b) => b.taskId === "long")!;
    const short = plan.blocks.find((b) => b.taskId === "short")!;
    expect(long.start).toBe("12:20");
    expect(short).toMatchObject({ start: "07:00", end: "07:30" });
    expect(plan.unplaced).toHaveLength(0);
  });
});

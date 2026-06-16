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
});

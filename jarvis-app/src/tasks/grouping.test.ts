import { describe, it, expect } from "vitest";
import { urgencyFor, distanceFor } from "./grouping";
import type { TaskData } from "../notes/types";

const TODAY = "2026-09-07";
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const task = (overrides: Partial<TaskData>): TaskData => ({
  text: "t", category: "", done: false, ...overrides,
});

// BUG (2026-09-07): both functions checked the truthy `task.recurrence`
// instead of `task.recurrence === "daily"`, so ANY recurring task - weekly,
// monthly - got the same "never overdue, always TODAY" pass the comment
// above each function says is a dailies-only rule. A weekly task 40 days
// late printed "TODAY" forever, the same word as a task due this minute,
// instead of climbing the same OVER A MONTH ladder every other late task
// climbs.
describe("grouping: only a daily task is exempt from going overdue (2026-09-07)", () => {
  describe("urgencyFor", () => {
    it("a daily task overdue by any amount still reads TODAY, not OVERDUE", () => {
      const t = task({ due: addDays(TODAY, -40), recurrence: "daily" });
      expect(urgencyFor(t, TODAY)).toEqual({ label: "TODAY", kind: "today" });
    });

    it("a weekly task 40 days late is OVERDUE, not TODAY", () => {
      const t = task({ due: addDays(TODAY, -40), recurrence: "weekly" });
      expect(urgencyFor(t, TODAY)).toEqual({ label: "OVERDUE", kind: "overdue" });
    });

    it("a monthly task past due is OVERDUE, not TODAY", () => {
      const t = task({ due: addDays(TODAY, -5), recurrence: "monthly" });
      expect(urgencyFor(t, TODAY)).toEqual({ label: "OVERDUE", kind: "overdue" });
    });

    it("a non-recurring task past due is unaffected: still OVERDUE", () => {
      const t = task({ due: addDays(TODAY, -1) });
      expect(urgencyFor(t, TODAY)).toEqual({ label: "OVERDUE", kind: "overdue" });
    });
  });

  describe("distanceFor", () => {
    it("a daily task overdue by any amount still reads TODAY", () => {
      const t = task({ due: addDays(TODAY, -40), recurrence: "daily" });
      expect(distanceFor(t, TODAY)).toEqual({ label: "TODAY", kind: "today" });
    });

    it("a weekly task 40 days late climbs to OVER A MONTH, same as any other task", () => {
      const t = task({ due: addDays(TODAY, -40), recurrence: "weekly" });
      expect(distanceFor(t, TODAY)).toEqual({ label: "OVER A MONTH", kind: "late" });
    });

    it("a weekly task 10 days late reads 1 WEEK LATE, not TODAY", () => {
      const t = task({ due: addDays(TODAY, -10), recurrence: "weekly" });
      expect(distanceFor(t, TODAY)).toEqual({ label: "1 WEEK LATE", kind: "late" });
    });

    it("a monthly task 2 days late reads 2 DAYS LATE, not TODAY", () => {
      const t = task({ due: addDays(TODAY, -2), recurrence: "monthly" });
      expect(distanceFor(t, TODAY)).toEqual({ label: "2 DAYS LATE", kind: "late" });
    });

    it("a recurring task due exactly today still reads TODAY, whatever the recurrence", () => {
      const t = task({ due: TODAY, recurrence: "weekly" });
      expect(distanceFor(t, TODAY)).toEqual({ label: "TODAY", kind: "today" });
    });
  });
});

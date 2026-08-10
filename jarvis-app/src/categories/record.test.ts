import { describe, it, expect } from "vitest";
import { categoryRecord, whenLabel } from "./record";
import type { CompletionSample } from "../shared/timeSense";

// The Record (2026-08-10): named history plus insight, derived from the
// samples completions already write. 2026-08-10 is a Monday, so "this week"
// is exactly today in these fixtures.

const TODAY = "2026-08-10";

function at(iso: string, hour: number, cat = "c1", id?: string): CompletionSample {
  const d = new Date(`${iso}T${String(hour).padStart(2, "0")}:00:00`);
  const s: CompletionSample = { t: d.getTime(), h: d.getHours(), dow: d.getDay(), cat };
  if (id) s.id = id;
  return s;
}

const TASKS = [
  { id: "t1", data: { text: "Take out trash" } },
  { id: "t2", data: { text: "Call the bank" } },
];

describe("whenLabel", () => {
  it("names the day like a person would", () => {
    expect(whenLabel(at(TODAY, 9).t, TODAY)).toBe("Today");
    expect(whenLabel(at("2026-08-09", 9).t, TODAY)).toBe("Yesterday");
    expect(whenLabel(at("2026-08-06", 9).t, TODAY)).toBe("Thursday");
    expect(whenLabel(at("2026-08-01", 9).t, TODAY)).toBe("Aug 1");
  });
});

describe("categoryRecord", () => {
  it("joins samples to task names, newest first, scoped to the category", () => {
    const r = categoryRecord("c1", [
      at("2026-08-06", 9, "c1", "t2"),
      at("2026-08-09", 9, "other", "t1"), // other category: out
      at(TODAY, 8, "c1", "t1"),
    ], TASKS, TODAY);
    expect(r.recent.map((e) => e.text)).toEqual(["Take out trash", "Call the bank"]);
    expect(r.recent.map((e) => e.when)).toEqual(["Today", "Thursday"]);
  });

  it("splits weeks at Monday and counts both sides", () => {
    const r = categoryRecord("c1", [
      at("2026-08-04", 9, "c1", "t1"), // last week (Tue)
      at("2026-08-09", 9, "c1", "t1"), // last week (Sun)
      at(TODAY, 8, "c1", "t2"), // this week (Mon)
    ], TASKS, TODAY);
    expect(r.thisWeek).toBe(1);
    expect(r.lastWeek).toBe(2);
  });

  it("a sample whose task is gone still counts but is never named", () => {
    const r = categoryRecord("c1", [at(TODAY, 8, "c1", "deleted"), at(TODAY, 9, "c1")], TASKS, TODAY);
    expect(r.thisWeek).toBe(2);
    expect(r.recent).toEqual([]);
  });

  it("caps the list", () => {
    const samples = Array.from({ length: 9 }, () => at(TODAY, 8, "c1", "t1"));
    expect(categoryRecord("c1", samples, TASKS, TODAY, 5).recent).toHaveLength(5);
  });

  it("insight needs history and a clear winner", () => {
    // 8 samples, 5 on Tuesdays: a real pattern.
    const tuesdays = ["2026-07-07", "2026-07-14", "2026-07-21", "2026-07-28", "2026-08-04"];
    const spread = ["2026-07-08", "2026-07-16", "2026-07-24"];
    const r = categoryRecord("c1", [...tuesdays, ...spread].map((d) => at(d, 9, "c1", "t1")), TASKS, TODAY);
    expect(r.insight).toBe("Most gets done on Tuesdays");
    // Too little history: silent.
    const few = categoryRecord("c1", tuesdays.map((d) => at(d, 9, "c1", "t1")), TASKS, TODAY);
    expect(few.insight).toBeNull();
  });

  it("no clear winner means no forced insight", () => {
    // 8 samples split 4/4 across two weekdays: a tie is not a pattern.
    const tuesdays = ["2026-07-07", "2026-07-14", "2026-07-21", "2026-07-28"];
    const wednesdays = ["2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22"];
    const r = categoryRecord("c1", [...tuesdays, ...wednesdays].map((d) => at(d, 9, "c1", "t1")), TASKS, TODAY);
    expect(r.insight).toBeNull();
  });
});

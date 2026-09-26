import { describe, it, expect } from "vitest";
import { allRecords, filterRecords, groupByDay, metricCategory } from "./records";
import { buildCsv, buildSummary, exportFilename } from "./exportData";
import { periodFor, periodOverview } from "./analytics";
import type { Workout } from "../gym/types";
import type { MetricDef } from "../gym/metrics";

// All Data and Export (the approved Health design, 2026-09-14, items 8 and
// 11): every record with its date, value, unit and source; the CSV says the
// same things in columns; the summary says how the numbers were made.
const T = (iso: string, h: number) => new Date(`${iso}T${String(h).padStart(2, "0")}:00:00`).getTime();
const sleep: MetricDef = { id: "m1", data: { name: "Sleep", type: "number", unit: "hrs", presetKey: "sleep", createdOn: "2026-09-01" } };
const weight: MetricDef = { id: "m2", data: { name: "Weight", type: "number", unit: "lb", presetKey: "bodyweight", createdOn: "2026-09-01" } };
const workout: Workout = { id: "w1", data: { programId: "p", dayId: "d", dayName: "Push", date: "2026-09-12", startedAt: T("2026-09-12", 18), endedAt: T("2026-09-12", 19), exercises: [
  { exerciseId: "e", name: "Bench, flat", kind: "weight_reps", unit: "lb", sets: [{ id: "a", w: 135, r: 5 }, { id: "b", w: 95, r: 8, warmup: true }] },
] } };
const inputs = {
  workouts: [workout], metricDefs: [sleep, weight],
  metricLogs: [{ id: "l1", data: { metricId: "m1", date: "2026-09-13", value: 7.5, at: T("2026-09-13", 8) } }, { id: "l2", data: { metricId: "m2", date: "2026-09-12", value: 184, at: T("2026-09-12", 7) } }],
  lightsOut: [{ id: "lo1", data: { category: "sleep" as const, at: T("2026-09-12", 23) } }],
  tookIt: [{ id: "t1", data: { category: "medication" as const, at: T("2026-09-13", 9), medId: "md1" } }],
  medDefs: [{ id: "md1", data: { category: "medication" as const, name: "Vitamin D", amount: "2000 IU", order: 0, at: 1 } }],
  callIt: [{ id: "c1", data: { category: "load" as const, rpe: 7, at: T("2026-09-12", 19) } }],
  pointAtIt: [{ id: "p1", data: { category: "body" as const, x: 0.5, y: 0.4, side: "front" as const, at: T("2026-09-12", 20), region: "Left Knee", feel: "stiffness" as const, level: "mild" as const }, }],
  meals: [{ id: "me1", data: { category: "fuel" as const, at: T("2026-09-13", 12), text: "Eggs and toast" } }],
  checkins: [{ id: "ck1", data: { category: "body" as const, at: T("2026-09-13", 21), energy: "high" as const } }],
};

describe("allRecords", () => {
  it("lists every kind with its category, value and source, newest day first", () => {
    const rows = allRecords(inputs);
    expect(rows.map((r) => r.category)).toEqual(["checkins", "nutrition", "medication", "sleep", "sleep", "effort", "workouts", "sets", "effort", "body"]);
    expect(rows.find((r) => r.category === "workouts")).toMatchObject({ title: "Push", value: "60 min", detail: "1 working set", source: "Logged by hand" });
    expect(rows.find((r) => r.category === "sets")).toMatchObject({ title: "Bench, flat", value: "1 set", detail: "135 lb × 5" });
    expect(rows.find((r) => r.category === "medication")).toMatchObject({ title: "Vitamin D", value: "2000 IU" });
    // §AM (2026-09-26): the words are joined by a comma; the middot between
    // facts is the CSS's to draw, never a string's.
    expect(rows.find((r) => r.title.startsWith("Discomfort"))).toMatchObject({ value: "Stiffness, Mild" });
    expect(metricCategory(weight)).toBe("body");
  });
  it("filters by category, period, one day and a search, and groups by day", () => {
    const rows = allRecords(inputs);
    expect(filterRecords(rows, { category: "sleep", period: null, date: null, query: "" }).map((r) => r.title)).toEqual(["Sleep", "Bedtime"]);
    expect(filterRecords(rows, { category: "all", period: periodFor("custom", "2026-09-14", { from: "2026-09-13", to: "2026-09-13" }), date: null, query: "" })).toHaveLength(4);
    expect(filterRecords(rows, { category: "all", period: null, date: "2026-09-12", query: "" })).toHaveLength(6);
    expect(filterRecords(rows, { category: "all", period: null, date: null, query: "eggs" }).map((r) => r.title)).toEqual(["Meal"]);
    expect(groupByDay(rows).map((g) => [g.date, g.rows.length])).toEqual([["2026-09-13", 4], ["2026-09-12", 6]]);
  });
});

describe("export", () => {
  it("writes a CSV with readable columns, escaped commas, and only the chosen categories", () => {
    const csv = buildCsv(allRecords(inputs), ["sets", "nutrition"]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("Date,Time,Category,Record,Value,Detail,Source");
    expect(lines).toHaveLength(3);
    expect(lines.some((l) => l.includes("\"Bench, flat\""))).toBe(true);
    expect(csv).not.toContain("Vitamin D");
  });
  it("summarises the period with counts and the notes on how each number was made", () => {
    const p = periodFor("7d", "2026-09-14");
    const text = buildSummary(periodOverview([workout], sleep, inputs.metricLogs, p), allRecords(inputs), ["workouts", "sleep"]);
    expect(text).toContain("Workouts: 1");
    expect(text).toContain("Working sets: 1");
    expect(text).toContain("7h 30m average across 1 logged nights");
    expect(text).toContain("A day with no log is a gap, never a zero.");
    expect(exportFilename("csv", p, ["sleep"])).toBe("jarvis-sleep-2026-09-08-to-2026-09-14.csv");
  });
});

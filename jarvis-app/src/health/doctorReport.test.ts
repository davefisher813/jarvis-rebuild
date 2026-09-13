import { describe, it, expect } from "vitest";
import { buildDoctorReport, doctorReportText, reportWindow } from "./doctorReport";
import type { AteBeforeEntry, CallItEntry, LightsOutEntry, TookItEntry } from "./types";

const DAY = 86400000;

describe("buildDoctorReport", () => {
  it("only includes rows inside the window, sorted by time", () => {
    const now = Date.parse("2026-08-27T12:00:00Z");
    const tookIt: TookItEntry[] = [
      { id: "t1", data: { category: "medication", at: now - 3 * DAY } },
      { id: "t2", data: { category: "medication", at: now - 60 * DAY } }, // out of window
    ];
    const report = buildDoctorReport({ tookIt, ateBefore: [], lightsOut: [], callIt: [] }, 6, now);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]!.kind).toBe("dose");
  });

  it("computes no average, no rate, no verdict -- rows carry only date/at/kind/label", () => {
    const now = Date.now();
    const tookIt: TookItEntry[] = [{ id: "t1", data: { category: "medication", at: now - DAY } }];
    const report = buildDoctorReport({ tookIt, ateBefore: [], lightsOut: [], callIt: [] }, 6, now);
    for (const row of report.rows) expect(Object.keys(row).sort()).toEqual(["at", "date", "kind", "label"]);
    expect(Object.keys(report).sort()).toEqual(["fromDate", "generatedAt", "rows", "toDate"]);
  });

  it("includes food, sleep, and session marks together with dose marks", () => {
    const now = Date.now();
    const ateBefore: AteBeforeEntry[] = [{ id: "a1", data: { category: "fuel", date: "2026-08-26", ate: true, at: now - DAY } }];
    const lightsOut: LightsOutEntry[] = [{ id: "l1", data: { category: "sleep", at: now - DAY } }];
    const callIt: CallItEntry[] = [{ id: "c1", data: { category: "load", rpe: 7, at: now - DAY } }];
    const report = buildDoctorReport({ tookIt: [], ateBefore, lightsOut, callIt }, 6, now);
    expect(report.rows.map((r) => r.kind).sort()).toEqual(["food", "lights_out", "session"]);
  });
});

describe("doctorReportText", () => {
  it("labels itself the family's own log, not a medical record", () => {
    const report = buildDoctorReport({ tookIt: [], ateBefore: [], lightsOut: [], callIt: [] });
    const text = doctorReportText(report);
    expect(text).toMatch(/family's own log/i);
    expect(text).toMatch(/not a medical record/i);
  });

  // UP-ATH-11 (2026-09-06): what actually crosses the device boundary when
  // the athlete taps Export or Copy. It is the log and the log only.
  it("carries every logged row, dated, with no interpretation of any of it", () => {
    const now = new Date("2026-09-06T18:00:00").getTime();
    const tookIt: TookItEntry[] = [{ id: "t1", data: { category: "medication", at: now - DAY } }];
    const lightsOut: LightsOutEntry[] = [{ id: "l1", data: { category: "sleep", at: now - 2 * DAY } }];
    const ateBefore: AteBeforeEntry[] = [{ id: "a1", data: { category: "fuel", date: "2026-09-04", ate: true, at: now - 2 * DAY } }];
    const callIt: CallItEntry[] = [{ id: "c1", data: { category: "load", rpe: 7, at: now - DAY } }];
    const text = doctorReportText(buildDoctorReport({ tookIt, ateBefore, lightsOut, callIt }, 6, now));
    const body = text.split("\n").slice(4);
    expect(body.filter((l) => l.trim().length > 0)).toHaveLength(4);
    expect(text).toContain("2026-09-05");
    expect(text).toContain("Dose Logged");
    expect(text).toContain("Ate Before");
    expect(text).toContain("Lights Out");
    // No verdict about any of it, on any line.
    for (const word of ["adherence", "average", "trend", "improving", "worse", "should"]) {
      expect(text.toLowerCase(), word + " is a reading, and this file does not read").not.toContain(word);
    }
  });
});

// Health Push F, H-47: the window and the kinds are the person's to choose.
describe("buildDoctorReport with options", () => {
  const now = Date.parse("2026-09-13T12:00:00");
  const tookIt: TookItEntry[] = [
    { id: "t1", data: { category: "medication", at: now - DAY, medId: "m1" } },
    { id: "t2", data: { category: "medication", at: now - 2 * DAY, medId: "m1", amount: "1 tab" } },
    { id: "t3", data: { category: "medication", at: now - 3 * DAY } },
    { id: "t4", data: { category: "medication", at: now - 80 * DAY, medId: "m1" } },
  ];
  const medDefs = [{ id: "m1", data: { category: "medication" as const, name: "Vitamin D", amount: "2000 IU", order: 0, at: 1 } }];
  const meals = [{ id: "e1", data: { category: "fuel" as const, at: now - DAY, text: "Eggs and toast" } }];
  const lightsOut: LightsOutEntry[] = [{ id: "l1", data: { category: "sleep", at: now - DAY } }];

  it("a dose names its med and amount; a meal is a row; the window is inclusive on both ends", () => {
    const r = buildDoctorReport({ tookIt, ateBefore: [], lightsOut, callIt: [], meals, medDefs }, { from: now - 3 * DAY, to: now });
    expect(r.rows).toHaveLength(5);
    expect(r.rows.slice(0, 2).map((x) => x.label)).toEqual(["Dose Logged", "Vitamin D · 1 tab"]);
    expect(r.rows.map((x) => [x.kind, x.label])).toContainEqual(["dose", "Vitamin D · 1 tab"]);
    expect(r.rows.map((x) => [x.kind, x.label])).toContainEqual(["dose", "Vitamin D · 2000 IU"]);
    expect(r.rows.map((x) => [x.kind, x.label])).toContainEqual(["dose", "Dose Logged"]);
    expect(r.rows.map((x) => [x.kind, x.label])).toContainEqual(["meal", "Meal · Eggs and toast"]);
    expect(r.rows.some((x) => x.at === now - 80 * DAY)).toBe(false);
    expect(r.fromDate).toBe("2026-09-10");
    expect(r.toDate).toBe("2026-09-13");
  });

  it("kinds narrow the rows, and the three-month range reaches thirteen weeks back", () => {
    const only = buildDoctorReport({ tookIt, ateBefore: [], lightsOut, callIt: [], meals, medDefs }, { ...reportWindow("3m", { from: "", to: "" }, now), kinds: ["lights_out", "meal"] });
    expect(only.rows).toHaveLength(2);
    expect(new Set(only.rows.map((x) => x.kind))).toEqual(new Set(["lights_out", "meal"]));
    const wide = buildDoctorReport({ tookIt, ateBefore: [], lightsOut: [], callIt: [], medDefs }, reportWindow("3m", { from: "", to: "" }, now));
    expect(wide.rows.some((x) => x.at === now - 80 * DAY)).toBe(true);
  });

  it("reportWindow honours two good dates and falls back to six weeks on bad ones", () => {
    const c = reportWindow("custom", { from: "2026-09-01", to: "2026-09-03" }, now);
    expect(new Date(c.from).getDate()).toBe(1);
    expect(new Date(c.to).getDate()).toBe(3);
    const bad = reportWindow("custom", { from: "2026-09-05", to: "2026-09-01" }, now);
    expect(bad).toEqual({ from: now - 42 * DAY, to: now });
  });
});

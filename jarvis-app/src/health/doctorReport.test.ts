import { describe, it, expect } from "vitest";
import { buildDoctorReport, doctorReportText } from "./doctorReport";
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
});

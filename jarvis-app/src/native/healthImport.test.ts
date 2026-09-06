import { describe, it, expect } from "vitest";
import { workoutFromHealth, importedUidOf, metricLogsFromHealth, activityLabel, STEPS_PRESET_KEY, SLEEP_PRESET_KEY } from "./healthImport";
import type { HealthWorkoutRecord } from "./bridge";
import type { MetricDef } from "../gym/metrics";

// UP-ATH-31 (2026-09-06, fork option A). The Swift plugin and the dedupe were
// both staged and tested; nothing turned a HealthKit sample into a record
// this app stores. This is that mapping, and its refusals.

const NOW = new Date("2026-09-06T09:00:00").getTime();
const run: HealthWorkoutRecord = {
  uid: "0F2A-1",
  start: new Date("2026-09-05T06:30:00").getTime(),
  end: new Date("2026-09-05T07:02:00").getTime(),
  activityType: "running",
  sourceName: "Apple Watch",
};

function def(id: string, presetKey: string, over: Partial<MetricDef["data"]> = {}): MetricDef {
  return { id, data: { name: presetKey, type: "number", presetKey, createdOn: "2026-01-01", ...over } };
}

describe("an imported workout", () => {
  it("becomes one done-kind session on the day it happened, in the athlete's words", () => {
    const w = workoutFromHealth(run, () => NOW);
    expect(w.dayName).toBe("Run");
    expect(w.date).toBe("2026-09-05");
    expect(w.exercises).toHaveLength(1);
    expect(w.exercises[0]!.kind).toBe("done");
    expect(w.exercises[0]!.sets).toEqual([{ id: "apple-health-0F2A-1-1", done: true }]);
  });

  it("belongs to no program and no program day, because it does not", () => {
    const w = workoutFromHealth(run, () => NOW);
    expect(w.programId).toBe("");
    expect(w.dayId).toBe("");
  });

  it("carries its source, so the card can say where it came from and a re-sync knows its own", () => {
    const w = workoutFromHealth(run, () => NOW);
    expect(w.source).toEqual({ type: "apple_health", ref: "0F2A-1", ts: NOW });
    expect(importedUidOf(w)).toBe("0F2A-1");
    expect(importedUidOf({ ...w, source: undefined })).toBeNull();
  });

  it("keeps an unrecognised activity's own name rather than flattening it", () => {
    expect(activityLabel("running")).toBe("Run");
    expect(activityLabel("curling")).toBe("curling");
  });

  it("stores no energy figure of any kind", () => {
    const w = workoutFromHealth(run, () => NOW);
    expect(JSON.stringify(w).toLowerCase()).not.toContain("calor");
    expect(JSON.stringify(w).toLowerCase()).not.toContain("energy");
  });
});

describe("imported steps and sleep", () => {
  const steps = [{ dayISO: "2026-09-05", steps: 8214 }, { dayISO: "2026-09-06", steps: 0 }];
  const sleep = [{ dayISO: "2026-09-05", asleepMinutes: 447, inBedMinutes: 480 }];

  it("land only on metrics the person actually turned on", () => {
    expect(metricLogsFromHealth({ steps, sleep, defs: [] }, NOW)).toEqual([]);
    const logs = metricLogsFromHealth({ steps, sleep, defs: [def("m-steps", STEPS_PRESET_KEY)] }, NOW);
    expect(logs).toEqual([{ metricId: "m-steps", date: "2026-09-05", value: 8214, at: NOW }]);
  });

  it("skip a hidden metric: off the strip is off", () => {
    const logs = metricLogsFromHealth({ steps, defs: [def("m-steps", STEPS_PRESET_KEY, { hidden: true })] }, NOW);
    expect(logs).toEqual([]);
  });

  it("record sleep as hours asleep, and never the in-bed figure or a stage breakdown", () => {
    const logs = metricLogsFromHealth({ sleep, defs: [def("m-sleep", SLEEP_PRESET_KEY)] }, NOW);
    expect(logs).toEqual([{ metricId: "m-sleep", date: "2026-09-05", value: 7.5, at: NOW }]);
  });

  it("write nothing for a day with nothing in it, rather than a zero", () => {
    const logs = metricLogsFromHealth({ steps, defs: [def("m-steps", STEPS_PRESET_KEY)] }, NOW);
    expect(logs.some((l) => l.date === "2026-09-06")).toBe(false);
  });
});

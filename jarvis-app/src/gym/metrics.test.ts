import { describe, expect, it } from "vitest";
import { activeMetrics, logOn, numericValue, formatMetric, newMetricDefData, METRIC_PRESETS, type MetricDef, type MetricLog } from "./metrics";

const def = (over: Partial<MetricDef["data"]> = {}, id = "m1"): MetricDef =>
  ({ id, data: { name: "Sleep", type: "number", unit: "hrs", createdOn: "2026-08-31", ...over } });
const log = (over: Partial<MetricLog["data"]>, id = "l1"): MetricLog =>
  ({ id, data: { metricId: "m1", date: "2026-08-31", at: 0, ...over } });

describe("activeMetrics", () => {
  it("drops hidden defs, keeps the rest ordered", () => {
    const defs = [def({ name: "B", order: 2 }, "1"), def({ name: "A", order: 1 }, "2"), def({ name: "Hidden", hidden: true }, "3")];
    expect(activeMetrics(defs).map((d) => d.id)).toEqual(["2", "1"]);
  });
});

describe("logOn", () => {
  it("finds the one log for a metric on a day, undefined otherwise", () => {
    const logs = [log({ value: 7.5 })];
    expect(logOn(logs, "m1", "2026-08-31")?.data.value).toBe(7.5);
    expect(logOn(logs, "m1", "2026-09-01")).toBeUndefined();
    expect(logOn(logs, "m2", "2026-08-31")).toBeUndefined();
  });
});

describe("numericValue", () => {
  it("yesno reads as 1 or 0", () => {
    expect(numericValue({ type: "yesno" }, log({ yes: true }))).toBe(1);
    expect(numericValue({ type: "yesno" }, log({ yes: false }))).toBe(0);
  });
  it("everything else reads its own value field, undefined when nothing logged", () => {
    expect(numericValue({ type: "number" }, log({ value: 7.5 }))).toBe(7.5);
    expect(numericValue({ type: "number" }, undefined)).toBeUndefined();
  });
});

describe("formatMetric", () => {
  it("never fabricates a zero for an empty log -- EMPTY IS LEGAL", () => {
    expect(formatMetric({ type: "number", unit: "hrs" }, undefined)).toBe("Not logged yet");
    expect(formatMetric({ type: "yesno" }, undefined)).toBe("Not logged yet");
  });
  it("formats each type in its own words", () => {
    expect(formatMetric({ type: "number", unit: "hrs" }, log({ value: 7.5 }))).toBe("7.5 hrs");
    expect(formatMetric({ type: "scale5" }, log({ value: 3 }))).toBe("3/5");
    expect(formatMetric({ type: "minutes" }, log({ value: 20 }))).toBe("20 min");
    expect(formatMetric({ type: "yesno" }, log({ yes: true }))).toBe("Yes");
    expect(formatMetric({ type: "yesno" }, log({ yes: false }))).toBe("No");
  });
});

describe("newMetricDefData", () => {
  it("trims the name and drops absent fields rather than storing them empty", () => {
    const d = newMetricDefData("  Sleep  ", "number", "hrs", "sleep", "2026-08-31", 0);
    expect(d.name).toBe("Sleep");
    expect(d.unit).toBe("hrs");
    expect(d.presetKey).toBe("sleep");
  });
  it("a custom metric with no preset carries no presetKey at all", () => {
    const d = newMetricDefData("Mood Journal", "yesno", undefined, undefined, "2026-08-31", 0);
    expect("presetKey" in d).toBe(false);
    expect("unit" in d).toBe(false);
  });
});

describe("METRIC_PRESETS", () => {
  it("every preset has a unique key and no preset is mood or a calorie feature", () => {
    const keys = METRIC_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(METRIC_PRESETS.some((p) => /mood/i.test(p.name))).toBe(false);
    expect(METRIC_PRESETS.some((p) => /calor/i.test(p.name))).toBe(false);
  });
});

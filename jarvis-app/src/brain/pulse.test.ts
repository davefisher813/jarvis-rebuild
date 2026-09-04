import { describe, it, expect } from "vitest";
import { pulseLines, PULSE_MIN_DAYS, PULSE_WINDOW_DAYS } from "./pulse";
import { pulseState, pulsePlan, pulsePresets, PULSE_KEYS } from "../gym/metrics";
import type { MetricDef, MetricLog, MetricType } from "../gym/metrics";

// THE DAILY PULSE (handoff item 11, decision c2, Dave's option A). What is
// worth pinning is not the arithmetic, it is the refusals: no score, no
// verdict, silence below the floor, and hidden means hidden.

const TODAY = "2026-09-04";

const def = (id: string, name: string, type: MetricType, over: Partial<MetricDef["data"]> = {}): MetricDef => ({
  id, data: { name, type, order: 0, createdOn: "2026-01-01", ...over },
});

const log = (metricId: string, date: string, v: { value?: number; yes?: boolean }): MetricLog => ({
  id: metricId + date, data: { metricId, date, at: 0, ...v },
});

const back = (n: number): string => {
  const d = new Date(TODAY + "T00:00:00");
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

describe("the group: four presets, one tap", () => {
  it("is four of the library's own presets, adding nothing new", () => {
    expect(pulsePresets()).toHaveLength(4);
    expect(pulsePresets().map((p) => p.key)).toEqual([...PULSE_KEYS]);
  });

  it("does not offer mood, because a standing ruling keeps mood out of the presets", () => {
    expect(PULSE_KEYS as readonly string[]).not.toContain("mood");
  });

  it("does not offer fatigue alongside energy, which is the same axis inverted", () => {
    expect(PULSE_KEYS as readonly string[]).not.toContain("fatigue");
    expect(PULSE_KEYS as readonly string[]).toContain("energy");
  });

  it("reads off, partial and on", () => {
    expect(pulseState([])).toBe("off");
    expect(pulseState([def("a", "Sleep", "number", { presetKey: "sleep" })])).toBe("partial");
    const all = pulsePresets().map((p, i) => def("d" + i, p.name, p.type, { presetKey: p.key }));
    expect(pulseState(all)).toBe("on");
  });

  it("counts a hidden pulse metric as not on", () => {
    const all = pulsePresets().map((p, i) => def("d" + i, p.name, p.type, { presetKey: p.key }));
    all[1]!.data.hidden = true;
    expect(pulseState(all)).toBe("partial");
  });
});

describe("the plan: un-hide, never duplicate", () => {
  it("creates all four from nothing", () => {
    const p = pulsePlan([]);
    expect(p.create).toHaveLength(4);
    expect(p.unhide).toHaveLength(0);
  });

  it("un-hides an existing def rather than creating a second one", () => {
    // A duplicate def for the same presetKey would strand the first one's
    // logged history behind an invisible record. HIDE, NEVER DELETE means the
    // history has to come back with the metric.
    const hidden = def("d1", "Sleep", "number", { presetKey: "sleep", hidden: true });
    const p = pulsePlan([hidden]);
    expect(p.unhide.map((d) => d.id)).toEqual(["d1"]);
    expect(p.create.map((x) => x.key)).not.toContain("sleep");
    expect(p.create).toHaveLength(3);
  });

  it("leaves an already-on metric alone", () => {
    const on = def("d1", "Stress", "scale5", { presetKey: "stress" });
    const p = pulsePlan([on]);
    expect(p.unhide).toHaveLength(0);
    expect(p.create.map((x) => x.key)).not.toContain("stress");
  });
});

describe("what the Brain is told", () => {
  it("says nothing when nothing is logged", () => {
    expect(pulseLines([def("a", "Sleep", "number", { unit: "hrs" })], [], TODAY)).toEqual([]);
  });

  it("stays silent below the floor, because two days is an anecdote", () => {
    const d = def("a", "Sleep", "number", { unit: "hrs" });
    const few = Array.from({ length: PULSE_MIN_DAYS - 1 }, (_, i) => log("a", back(i), { value: 7 }));
    expect(pulseLines([d], few, TODAY)).toEqual([]);
    const enough = Array.from({ length: PULSE_MIN_DAYS }, (_, i) => log("a", back(i), { value: 7 }));
    expect(pulseLines([d], enough, TODAY)).toHaveLength(1);
  });

  it("reports in the metric's own units and never as a verdict", () => {
    const d = def("a", "Sleep", "number", { unit: "hrs" });
    const logs = [log("a", back(0), { value: 6 }), log("a", back(1), { value: 7 }), log("a", back(2), { value: 8 })];
    const [line] = pulseLines([d], logs, TODAY);
    expect(line).toBe("Sleep: 7 hrs on average over the last 3 days");
    for (const word of ["poor", "low", "bad", "good", "missed", "should", "%"]) {
      expect(line!.toLowerCase()).not.toContain(word);
    }
  });

  it("reads a 1 to 5 scale as out of 5, not as a percentage", () => {
    const d = def("a", "Soreness", "scale5");
    const logs = [3, 4, 4].map((v, i) => log("a", back(i), { value: v }));
    expect(pulseLines([d], logs, TODAY)[0]).toBe("Soreness: 3.7 out of 5 over the last 3 days");
  });

  it("reads a yes/no metric as a count, because an average of it means nothing", () => {
    const d = def("a", "Feeling Sick", "yesno");
    const logs = [true, false, true, false].map((v, i) => log("a", back(i), { yes: v }));
    expect(pulseLines([d], logs, TODAY)[0]).toBe("Feeling Sick: yes on 2 of 4 logged days");
  });

  it("never composes a score across metrics", () => {
    // The health doctrine's hardest line: no single number ever stands for a
    // person. Every metric reports itself and nothing joins them.
    const defs = [def("a", "Sleep", "number", { unit: "hrs" }), def("b", "Stress", "scale5")];
    const logs = [
      ...[7, 7, 7].map((v, i) => log("a", back(i), { value: v })),
      ...[2, 2, 2].map((v, i) => log("b", back(i), { value: v })),
    ];
    const out = pulseLines(defs, logs, TODAY);
    expect(out).toHaveLength(2);
    for (const l of out) expect(l).not.toMatch(/readiness|overall|score|index/i);
  });

  it("never reads a hidden metric, because hiding has to mean hiding", () => {
    const d = def("a", "Bodyweight", "number", { unit: "lb", hidden: true });
    const logs = [200, 201, 202].map((v, i) => log("a", back(i), { value: v }));
    expect(pulseLines([d], logs, TODAY)).toEqual([]);
  });

  it("ignores logs older than the window", () => {
    const d = def("a", "Sleep", "number", { unit: "hrs" });
    const old = Array.from({ length: 5 }, (_, i) => log("a", back(PULSE_WINDOW_DAYS + i), { value: 9 }));
    expect(pulseLines([d], old, TODAY)).toEqual([]);
  });

  it("is not fooled by a timezone east of UTC", () => {
    // The 2026-09-04 audit found this exact class of bug twice elsewhere, so
    // the day walk here is local and stepped with setDate. Today's own log
    // must count, wherever the user is.
    const d = def("a", "Sleep", "number", { unit: "hrs" });
    const logs = [0, 1, 2].map((i) => log("a", back(i), { value: 8 }));
    expect(pulseLines([d], logs, TODAY)[0]).toContain("over the last 3 days");
  });
});

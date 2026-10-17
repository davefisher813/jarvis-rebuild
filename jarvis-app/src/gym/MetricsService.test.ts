import { describe, expect, it } from "vitest";
import { InMemoryAdapter, Store } from "@core";
import { MetricsService } from "./MetricsService";
import { newMetricDefData, METRIC_PRESETS } from "./metrics";

// ONE DEFINITION PER PRESET (2026-10-17, the Sleep row drawn twice in Insights).
describe("MetricsService.createDef", () => {
  const sleep = METRIC_PRESETS.find((p) => p.key === "sleep")!;
  it("turning a preset on twice makes one definition and returns its id both times", async () => {
    const svc = new MetricsService(new Store(new InMemoryAdapter()), "u");
    const a = await svc.createDef(newMetricDefData(sleep.name, sleep.type, sleep.unit, sleep.key, "2026-10-17", 0));
    const b = await svc.createDef(newMetricDefData(sleep.name, sleep.type, sleep.unit, sleep.key, "2026-10-17", 0));
    expect(b).toBe(a);
    expect((await svc.listDefs()).filter((d) => d.data.presetKey === "sleep")).toHaveLength(1);
  });
  it("a hidden preset is turned back on rather than made again", async () => {
    const svc = new MetricsService(new Store(new InMemoryAdapter()), "u");
    const a = (await svc.createDef(newMetricDefData(sleep.name, sleep.type, sleep.unit, sleep.key, "2026-10-17", 0)))!;
    await svc.updateDef(a, { hidden: true });
    expect(await svc.createDef(newMetricDefData(sleep.name, sleep.type, sleep.unit, sleep.key, "2026-10-17", 0))).toBe(a);
    const d = (await svc.listDefs()).find((x) => x.id === a)!;
    expect(d.data.hidden).toBe(false);
  });
  it("two custom metrics with no preset are two definitions", async () => {
    const svc = new MetricsService(new Store(new InMemoryAdapter()), "u");
    const a = await svc.createDef(newMetricDefData("Mood", "number", undefined, undefined, "2026-10-17", 0));
    const b = await svc.createDef(newMetricDefData("Mood", "number", undefined, undefined, "2026-10-17", 0));
    expect(a).not.toBe(b);
  });
});

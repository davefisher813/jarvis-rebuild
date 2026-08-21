import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { ScheduleService } from "./ScheduleService";
import { planDuplicateIds, supersededPlanEventIds, isPlanEvent } from "./planDedupe";
import type { EventItem } from "./types";

// One planner event per task per day (hotfix 2026-08-21). These pin the law
// from HOTFIX_GCAL_DUPES onto the planner's own output: sweep by source id
// before writing, never trust absence, and heal visible duplicates on read.

const DAY = "2026-08-21";
const ev = (id: string, data: Partial<EventItem["data"]>): EventItem => ({
  id,
  data: { title: "T", date: DAY, start: "09:00", category: "", ...data } as EventItem["data"],
});

describe("isPlanEvent", () => {
  it("planner output only: sourceTaskId set, not gcal, not recurring", () => {
    expect(isPlanEvent(ev("a", { sourceTaskId: "t1" }))).toBe(true);
    expect(isPlanEvent(ev("b", {}))).toBe(false);
    expect(isPlanEvent(ev("c", { sourceTaskId: "t1", gcalId: "g1" }))).toBe(false);
    expect(isPlanEvent(ev("d", { sourceTaskId: "t1", recurrence: "weekly" }))).toBe(false);
  });
});

describe("planDuplicateIds", () => {
  it("[edge] no duplicates, nothing deleted", () => {
    const evs = [ev("a", { sourceTaskId: "t1" }), ev("b", { sourceTaskId: "t2", start: "10:00" })];
    expect(planDuplicateIds(evs, null)).toEqual([]);
  });

  it("keeps the earliest copy on a non-today day", () => {
    const evs = [
      ev("late", { sourceTaskId: "t1", start: "14:00" }),
      ev("early", { sourceTaskId: "t1", start: "09:00" }),
    ];
    expect(planDuplicateIds(evs, null)).toEqual(["late"]);
  });

  it("first-upcoming wins when viewing today", () => {
    // 8:30 already passed at 14:00; the 16:40 copy is the one still actionable.
    const evs = [
      ev("past", { sourceTaskId: "t1", start: "08:30" }),
      ev("next", { sourceTaskId: "t1", start: "16:40" }),
    ];
    expect(planDuplicateIds(evs, 14 * 60)).toEqual(["past"]);
  });

  it("falls back to earliest when every copy has passed", () => {
    const evs = [
      ev("a", { sourceTaskId: "t1", start: "08:00" }),
      ev("b", { sourceTaskId: "t1", start: "09:00" }),
    ];
    expect(planDuplicateIds(evs, 22 * 60)).toEqual(["b"]);
  });

  it("never touches user events, gcal imports, or recurring series", () => {
    const evs = [
      ev("u1", { start: "09:00" }),
      ev("u2", { start: "09:00" }),
      ev("g1", { sourceTaskId: "t1", gcalId: "g", start: "09:00" }),
      ev("g2", { sourceTaskId: "t1", gcalId: "g", start: "09:00" }),
      ev("r1", { sourceTaskId: "t2", recurrence: "daily", start: "09:00" }),
      ev("r2", { sourceTaskId: "t2", recurrence: "daily", start: "09:00" }),
    ];
    expect(planDuplicateIds(evs, null)).toEqual([]);
  });

  it("[edge] the screenshot day: five tasks placed twice collapse to one each", () => {
    const evs = [
      ev("a1", { sourceTaskId: "visuals", start: "13:00", end: "13:45" }),
      ev("a2", { sourceTaskId: "visuals", start: "13:50", end: "15:20" }),
      ev("b1", { sourceTaskId: "christine", start: "13:00", end: "13:10" }),
      ev("b2", { sourceTaskId: "christine", start: "13:55", end: "14:40" }),
      ev("c1", { sourceTaskId: "bridge", start: "13:20", end: "13:40" }),
      ev("c2", { sourceTaskId: "bridge", start: "14:50", end: "15:35" }),
      ev("d1", { sourceTaskId: "apps", start: "15:30", end: "16:30" }),
      ev("d2", { sourceTaskId: "apps", start: "15:45", end: "16:30" }),
      ev("e1", { sourceTaskId: "alberto", start: "08:30", end: "09:15" }),
      ev("e2", { sourceTaskId: "alberto", start: "16:40", end: "17:40" }),
    ];
    const gone = planDuplicateIds(evs, 13 * 60 + 30); // 1:30 PM, mid-screenshot day
    expect(gone.length).toBe(5);
    const kept = evs.filter((e) => !gone.includes(e.id)).map((e) => e.id).sort();
    // First-upcoming per task at 1:30 PM; alberto's 8:30 copy has passed, so
    // the 4:40 copy survives and the stale morning one goes.
    expect(kept).toEqual(["a2", "b2", "c2", "d1", "e2"]);
  });
});

describe("supersededPlanEventIds", () => {
  it("targets only the committing tasks' prior plan events", () => {
    const evs = [
      ev("a", { sourceTaskId: "t1" }),
      ev("b", { sourceTaskId: "t2" }),
      ev("c", {}),
      ev("d", { sourceTaskId: "t3", gcalId: "g" }),
    ];
    expect(supersededPlanEventIds(evs, ["t1", "t3"])).toEqual(["a"]);
  });
});

describe("ScheduleService.commitPlan: replace, never add", () => {
  it("re-planning the same task moves its block instead of multiplying it", async () => {
    const svc = new ScheduleService(new Store(new InMemoryAdapter()), "u");
    await svc.commitPlan(DAY, [{ taskId: "t1", text: "Finish Visuals", category: "work", start: "13:00", end: "13:45" }]);
    await svc.commitPlan(DAY, [{ taskId: "t1", text: "Finish Visuals", category: "work", start: "13:50", end: "15:20" }]);
    const evs = await svc.eventsOn(DAY);
    const mine = evs.filter((e) => e.data.sourceTaskId === "t1");
    expect(mine.length).toBe(1);
    expect(mine[0]!.data.start).toBe("13:50");
  });

  it("a commit leaves other tasks' plan events and user events alone", async () => {
    const svc = new ScheduleService(new Store(new InMemoryAdapter()), "u");
    await svc.createEvent("Dentist", { date: DAY, start: "09:00" });
    await svc.commitPlan(DAY, [{ taskId: "t1", text: "A", category: "", start: "10:00", end: "10:30" }]);
    await svc.commitPlan(DAY, [{ taskId: "t2", text: "B", category: "", start: "11:00", end: "11:30" }]);
    expect((await svc.eventsOn(DAY)).length).toBe(3);
  });

  it("a commit for another day never touches this day's placement", async () => {
    const svc = new ScheduleService(new Store(new InMemoryAdapter()), "u");
    await svc.commitPlan(DAY, [{ taskId: "t1", text: "A", category: "", start: "10:00", end: "10:30" }]);
    await svc.commitPlan("2026-08-22", [{ taskId: "t1", text: "A", category: "", start: "09:00", end: "09:30" }]);
    expect((await svc.eventsOn(DAY)).length).toBe(1);
    expect((await svc.eventsOn("2026-08-22")).length).toBe(1);
  });
});

describe("ScheduleService.healPlanDuplicates", () => {
  it("collapses an existing mess to one block per task, no manual deleting", async () => {
    const svc = new ScheduleService(new Store(new InMemoryAdapter()), "u");
    for (const [s, e] of [["13:00", "13:45"], ["13:50", "15:20"]] as const) {
      await svc.createEvent("Finish Visuals", { date: DAY, start: s, end: e, sourceTaskId: "t1" });
    }
    const healed = await svc.healPlanDuplicates(DAY, 13 * 60 + 30);
    expect(healed).toBe(1);
    const mine = (await svc.eventsOn(DAY)).filter((e) => e.data.sourceTaskId === "t1");
    expect(mine.length).toBe(1);
    expect(mine[0]!.data.start).toBe("13:50");
  });

  it("[edge] a clean day heals nothing", async () => {
    const svc = new ScheduleService(new Store(new InMemoryAdapter()), "u");
    await svc.createEvent("Solo", { date: DAY, start: "09:00", sourceTaskId: "t1" });
    expect(await svc.healPlanDuplicates(DAY, null)).toBe(0);
    expect((await svc.eventsOn(DAY)).length).toBe(1);
  });
});

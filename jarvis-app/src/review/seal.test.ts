import { describe, it, expect } from "vitest";
import { computeSeal, worthSealing, monthKeyOf, prevMonthKey, SealService, type MonthSealData, ENTITY_MONTH_SEAL } from "./seal";
import type { WindowRow } from "../brain/window";
import type { Goal } from "../life/types";
import type { Workout } from "../gym/types";

const row = (over: Partial<WindowRow>): WindowRow => ({
  type: "task.completed", day: "2026-08-10", h: 10, category: null, n: null, flag: null, kind: null, ...over,
});

const goal = (over: Partial<Goal["data"]>): Goal => ({
  id: "g" + Math.abs(JSON.stringify(over).length), data: { title: "G", state: "on_track", ...over } as Goal["data"],
});

const workout = (date: string): Workout => ({
  id: "w" + date, data: { programId: "p", dayId: "d", dayName: "Push", date, startedAt: 1, endedAt: 2, exercises: [] },
});

describe("month keys", () => {
  it("cuts and steps months, including the January edge", () => {
    expect(monthKeyOf("2026-08-25")).toBe("2026-08");
    expect(prevMonthKey("2026-08-25")).toBe("2026-07");
    expect(prevMonthKey("2026-01-01")).toBe("2025-12");
  });
});

describe("computeSeal", () => {
  it("folds one month and ignores the neighbours", () => {
    const rows = [
      row({ day: "2026-08-03", category: "work" }),
      row({ day: "2026-08-04", category: "work" }),
      row({ day: "2026-08-04", category: "home" }),
      row({ day: "2026-09-01" }), // next month: out
      row({ day: "2026-08-05", kind: "workout" }), // a session is not a task
      row({ type: "task.pushed", day: "2026-08-06" }),
      row({ type: "app.opened", day: "2026-08-03" }),
      row({ type: "app.opened", day: "2026-08-03" }), // same day counts once
      row({ type: "app.opened", day: "2026-08-07" }),
    ];
    const goals = [
      goal({ saved: [{ d: "2026-08-09", amount: 200 }, { d: "2026-07-30", amount: 50 }] }),
      goal({ state: "achieved" }),
      goal({ dropped: { on: "2026-08-10" } }),
    ];
    const d = computeSeal("2026-08", { rows, workouts: [workout("2026-08-05"), workout("2026-07-31")], goals, sealedAt: 123 });
    expect(d.done).toBe(3);
    expect(d.pushed).toBe(1);
    expect(d.daysIn).toBe(2);
    expect(d.byCategory).toEqual({ work: 2, home: 1 });
    expect(d.sessions).toBe(1);
    expect(d.deposits).toBe(1);
    expect(d.saved).toBe(200);
    expect(d.goalsLive).toBe(1); // achieved and dropped are not live
    expect(d.goalsAchieved).toBe(1);
    expect(d.bandStart).toBeNull(); // three completions is thin evidence
    expect(d.sealedAt).toBe(123);
  });

  it("a month with no evidence is not worth sealing", () => {
    const empty = computeSeal("2026-08", { rows: [], workouts: [], goals: [], sealedAt: 1 });
    expect(worthSealing(empty)).toBe(false);
    expect(worthSealing({ ...empty, sessions: 1 })).toBe(true);
  });
});

describe("SealService", () => {
  function memStore() {
    const items: { id: string; entityType: string; data: unknown }[] = [];
    let n = 0;
    return {
      items,
      store: {
        listForUser: async (_o: string, t: string) => items.filter((i) => i.entityType === t),
        create: async (_o: string, t: string, data: unknown) => { const id = "s" + ++n; items.push({ id, entityType: t, data }); return id; },
      } as never,
    };
  }
  const sealData = (month: string, sealedAt: number): MonthSealData => ({
    month, sealedAt, done: 1, pushed: 0, daysIn: 1, byCategory: {}, bandStart: null,
    sessions: 0, deposits: 0, saved: 0, goalsLive: 0, goalsAchieved: 0,
  });

  it("dedupes a two-device race: earliest write wins on read", async () => {
    const { store } = memStore();
    const svc = new SealService(store, "u1");
    await svc.create(sealData("2026-08", 100));
    await svc.create(sealData("2026-08", 200));
    await svc.create(sealData("2026-07", 300));
    const all = await svc.list();
    expect(all.map((s) => s.data.month)).toEqual(["2026-07", "2026-08"]);
    expect(all.find((s) => s.data.month === "2026-08")!.data.sealedAt).toBe(100);
    expect((await svc.findMonth("2026-08"))!.data.sealedAt).toBe(100);
    expect(await svc.findMonth("2026-06")).toBeNull();
  });

  it("stores under the registered entity type", () => {
    expect(ENTITY_MONTH_SEAL).toBe("month_seal");
  });
});

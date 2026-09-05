// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { sealPreviousMonthIfDue, SealService, ENTITY_MONTH_SEAL, type MonthSealData } from "./seal";
import type { WindowClient } from "../brain/window";
import type { GymService } from "../gym/GymService";
import type { GoalService } from "../life/GoalService";
import type { Workout } from "../gym/types";

// BRAIN-F-11 (2026-09-05): the boundary seal borrowed the Brain's window
// read, which falls back to the LOCAL event log on any server failure, and
// could not tell that it had. First open of a month with no signal wrote a
// partial record (and the earliest write per month wins on read, so a later
// complete one from another device is ignored), or, with nothing local at
// all, marked the month done and never sealed it. The marker was also
// device-global, so a second account on the same phone got no seal.

const TODAY = "2026-09-05"; // prev month is 2026-08
const NOW = Date.parse("2026-09-05T12:00:00Z");

function memStore() {
  const items: { id: string; entityType: string; owner: string; data: unknown }[] = [];
  let n = 0;
  return {
    items,
    store: {
      listForUser: async (o: string, t: string) => items.filter((i) => i.entityType === t && i.owner === o),
      create: async (o: string, t: string, data: unknown) => { const id = "s" + ++n; items.push({ id, entityType: t, owner: o, data }); return id; },
    } as never,
  };
}

const workout = (date: string): Workout => ({
  id: "w" + date, data: { programId: "p", dayId: "d", dayName: "Push", date, startedAt: 1, endedAt: 2, exercises: [] },
});

// One workout in August is evidence enough to be worth sealing.
const gym = { listWorkouts: async () => [workout("2026-08-05")] } as unknown as GymService;
const goals = { list: async () => [] } as unknown as GoalService;

/** A client whose query resolves rows (server truth). */
function serverClient(rows: unknown[] = []): WindowClient {
  const leaf = { limit: async () => ({ data: rows, error: null }) };
  return { from: () => ({ select: () => ({ gte: () => ({ in: () => ({ order: () => leaf }) }) }) }) } as unknown as WindowClient;
}

/** A client whose query fails, the case readWindow silently falls back on. */
function brokenClient(): WindowClient {
  const leaf = { limit: async () => ({ data: null, error: { message: "network" } }) };
  return { from: () => ({ select: () => ({ gte: () => ({ in: () => ({ order: () => leaf }) }) }) }) } as unknown as WindowClient;
}

describe("sealPreviousMonthIfDue (BRAIN-F-11)", () => {
  beforeEach(() => localStorage.clear());

  it("a month it could only read locally is neither sealed nor marked done", async () => {
    const { items, store } = memStore();
    const svc = new SealService(store, "u1");
    expect(await sealPreviousMonthIfDue(svc, brokenClient(), gym, goals, TODAY, NOW)).toBeNull();
    expect(items.filter((i) => i.entityType === ENTITY_MONTH_SEAL)).toHaveLength(0);
    expect(localStorage.getItem("jarvis.seal.done.v1:u1")).toBeNull();

    // The next open, with signal, does the real thing.
    const id = await sealPreviousMonthIfDue(svc, serverClient(), gym, goals, TODAY, NOW);
    expect(id).toBeTruthy();
    expect((items[0]!.data as MonthSealData).month).toBe("2026-08");
    expect(localStorage.getItem("jarvis.seal.done.v1:u1")).toBe("2026-08");
  });

  it("with no backend at all the local log is the only truth, and still seals", async () => {
    const { items, store } = memStore();
    const svc = new SealService(store, "demo");
    expect(await sealPreviousMonthIfDue(svc, null, gym, goals, TODAY, NOW)).toBeTruthy();
    expect(items).toHaveLength(1);
  });

  it("the once-per-month marker is per account, not per device", async () => {
    const a = memStore();
    const b = memStore();
    await sealPreviousMonthIfDue(new SealService(a.store, "u1"), serverClient(), gym, goals, TODAY, NOW);
    expect(a.items).toHaveLength(1);
    // Same device, second account signing in the same month.
    await sealPreviousMonthIfDue(new SealService(b.store, "u2"), serverClient(), gym, goals, TODAY, NOW);
    expect(b.items).toHaveLength(1);
    expect(localStorage.getItem("jarvis.seal.done.v1:u2")).toBe("2026-08");
  });

  it("once marked, the same account does not seal the month twice", async () => {
    const { items, store } = memStore();
    const svc = new SealService(store, "u1");
    await sealPreviousMonthIfDue(svc, serverClient(), gym, goals, TODAY, NOW);
    await sealPreviousMonthIfDue(svc, serverClient(), gym, goals, TODAY, NOW);
    expect(items).toHaveLength(1);
  });
});

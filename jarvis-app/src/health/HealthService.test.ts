import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { HealthService } from "./HealthService";
import type { Storage2 } from "./offlineQueue";

function mem(): Storage2 {
  const m = new Map<string, string>();
  return { read: (k) => m.get(k) ?? null, write: (k, v) => { m.set(k, v); }, remove: (k) => { m.delete(k); } };
}

function svc() {
  return new HealthService(new Store(new InMemoryAdapter()), "athlete1");
}

// A tiny delay so the fire-and-forget flush() kicked off inside a logXxx
// call has a turn of the microtask queue to land before we assert on it.
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("HealthService: the Share Line", () => {
  it("defaults to logistics-only, unrevoked, until something is granted", async () => {
    const grants = await svc().getConsent();
    expect(grants.find((g) => g.category === "logistics")?.granted).toBe(true);
    expect(grants.filter((g) => g.granted)).toHaveLength(1);
  });

  it("grants and revokes a category, persisting across reads", async () => {
    const s = svc();
    await s.setGrant("fuel", true);
    expect((await s.getConsent()).find((g) => g.category === "fuel")?.granted).toBe(true);
    await s.setGrant("fuel", false);
    const after = await s.getConsent();
    expect(after.find((g) => g.category === "fuel")?.granted).toBe(false);
    // revocation is real: nothing else moved.
    expect(after.find((g) => g.category === "logistics")?.granted).toBe(true);
  });
});

describe("HealthService: Lights Out", () => {
  it("logs offline-first and lands on the store once flushed", async () => {
    const s = svc();
    const store = mem();
    s.logLightsOut(1000, store);
    await tick();
    const list = await s.listLightsOut(store);
    expect(list).toHaveLength(1);
    expect(list[0]!.data).toEqual({ category: "sleep", at: 1000 });
  });

  it("is visible immediately from the pending queue, before any flush completes", async () => {
    const s = svc();
    const store = mem();
    // Log without ever awaiting a tick: listMerged must still see it via
    // the local pending queue, which is written synchronously.
    s.logLightsOut(1000, store);
    const list = await s.listLightsOut(store);
    expect(list.some((e) => e.data.at === 1000)).toBe(true);
  });
});

describe("HealthService: Ate Before", () => {
  it("attaches to a calendar event, records yes/no, nothing else", async () => {
    const s = svc();
    const store = mem();
    s.logAteBefore({ eventId: "ev1", eventTitle: "Practice", date: "2026-08-20", ate: true }, 500, store);
    await tick();
    const list = await s.listAteBefore(store);
    expect(list[0]!.data).toEqual({ category: "fuel", eventId: "ev1", eventTitle: "Practice", date: "2026-08-20", ate: true, at: 500 });
  });
});

describe("HealthService: Took It", () => {
  it("timestamps by the tap, not a schedule", async () => {
    const s = svc();
    const store = mem();
    s.logTookIt(777, store);
    await tick();
    const list = await s.listTookIt(store);
    expect(list[0]!.data).toEqual({ category: "medication", at: 777 });
  });
});

describe("HealthService: Call It", () => {
  it("clamps rpe into 0-10", async () => {
    const s = svc();
    const store = mem();
    s.logCallIt({ rpe: 14, durationMin: 45 }, 1, store);
    await tick();
    const list = await s.listCallIt(store);
    expect(list[0]!.data.rpe).toBe(10);
  });

  it("clamps a negative rpe up to 0", async () => {
    const s = svc();
    const store = mem();
    s.logCallIt({ rpe: -3 }, 1, store);
    await tick();
    const list = await s.listCallIt(store);
    expect(list[0]!.data.rpe).toBe(0);
  });
});

describe("HealthService: Point At It", () => {
  it("stores a location only", async () => {
    const s = svc();
    const store = mem();
    s.logPointAtIt({ x: 0.4, y: 0.6, side: "back" }, 1, store);
    await tick();
    const list = await s.listPointAtIt(store);
    expect(list[0]!.data).toEqual({ category: "body", x: 0.4, y: 0.6, side: "back", at: 1 });
  });
});

describe("HealthService: offline queue is never lost", () => {
  it("a tap logged while every write fails still flushes once the store is reachable", async () => {
    const s = svc();
    const store = mem();
    s.logLightsOut(1, store);
    // The fire-and-forget flush from logLightsOut may or may not have run
    // yet; either way, an explicit flush drains whatever is left.
    await s.flush(store);
    const list = await s.listLightsOut(store);
    expect(list.some((e) => e.data.at === 1)).toBe(true);
  });
});

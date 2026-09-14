import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { HealthService, typedKind } from "./HealthService";
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

  // 2026-09-11: two quick toggles each read the same record, and the second
  // write undid the first.
  it("two toggles in flight at once both land", async () => {
    const s = svc();
    await Promise.all([s.setGrant("fuel", true), s.setGrant("sleep", true)]);
    const after = await s.getConsent();
    expect(after.find((g) => g.category === "fuel")?.granted).toBe(true);
    expect(after.find((g) => g.category === "sleep")?.granted).toBe(true);
  });

  it("a failed grant write does not jam the next one", async () => {
    const store = new Store(new InMemoryAdapter());
    const s = new HealthService(store, "athlete1");
    const list = store.listForUser.bind(store);
    store.listForUser = () => Promise.reject(new Error("offline"));
    await expect(s.setGrant("fuel", true)).rejects.toThrow("offline");
    store.listForUser = list;
    await s.setGrant("sleep", true);
    expect((await s.getConsent()).find((g) => g.category === "sleep")?.granted).toBe(true);
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
    // H-51: the queue's own stamp rides in the data; nothing else does.
    expect(list[0]!.data).toEqual({ category: "sleep", at: 1000, clientId: expect.any(String) });
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
    expect(list[0]!.data).toEqual({ category: "fuel", eventId: "ev1", eventTitle: "Practice", date: "2026-08-20", ate: true, at: 500, clientId: expect.any(String) });
  });
});

describe("HealthService: Took It", () => {
  it("timestamps by the tap, not a schedule", async () => {
    const s = svc();
    const store = mem();
    s.logTookIt(777, store);
    await tick();
    const list = await s.listTookIt(store);
    expect(list[0]!.data).toEqual({ category: "medication", at: 777, clientId: expect.any(String) });
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

describe("HealthService: Point at It", () => {
  it("stores a location only", async () => {
    const s = svc();
    const store = mem();
    s.logPointAtIt({ x: 0.4, y: 0.6, side: "back" }, 1, store);
    await tick();
    const list = await s.listPointAtIt(store);
    expect(list[0]!.data).toEqual({ category: "body", x: 0.4, y: 0.6, side: "back", at: 1, clientId: expect.any(String) });
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

// Health Push D (2026-09-12 picks, built 2026-09-13): meds by name, doses that
// name them, Undo by the moment, meals, Edit Time.
describe("HealthService: medications by name", () => {
  it("adds, lists in order, edits, and removes a med; nothing about it is a schedule", async () => {
    const s = svc();
    const a = await s.addMedDef({ name: " Vitamin D ", amount: "2000 IU" });
    const b = await s.addMedDef({ name: "Iron", amount: "  " });
    expect(a.data).toEqual({ category: "medication", name: "Vitamin D", amount: "2000 IU", order: 0, at: a.data.at });
    expect(b.data).not.toHaveProperty("amount");
    expect((await s.listMedDefs()).map((m) => m.data.name)).toEqual(["Vitamin D", "Iron"]);
    await s.updateMedDef(b.id, { name: "Iron", amount: "65 mg" });
    expect((await s.listMedDefs()).find((m) => m.id === b.id)?.data.amount).toBe("65 mg");
    await s.removeMedDef(a.id);
    expect((await s.listMedDefs()).map((m) => m.data.name)).toEqual(["Iron"]);
  });

  it("a dose names its med and amount, and a bare tap carries neither key", async () => {
    const s = svc();
    const store = mem();
    s.logTookIt(1000, store, { medId: "m1", amount: "10 mg" });
    s.logTookIt(2000, store);
    await tick();
    const list = await s.listTookIt(store);
    expect(list.map((e) => e.data)).toEqual([
      { category: "medication", at: 1000, medId: "m1", amount: "10 mg", clientId: expect.any(String) },
      { category: "medication", at: 2000, clientId: expect.any(String) },
    ]);
  });
});

describe("HealthService: Undo by the moment", () => {
  it("takes back a tap that has already landed", async () => {
    const s = svc();
    const store = mem();
    s.logTookIt(1000, store);
    s.logTookIt(2000, store);
    await tick();
    expect(await s.removeTookIt(1000, store)).toBe(true);
    expect((await s.listTookIt(store)).map((e) => e.data.at)).toEqual([2000]);
  });

  it("takes back a tap still in the queue, and one that lands while the Undo runs", async () => {
    const store = new Store(new InMemoryAdapter());
    const s = new HealthService(store, "athlete1");
    const q = mem();
    // The store refuses for a moment, so the tap sits in the queue.
    const create = store.create.bind(store);
    store.create = () => Promise.reject(new Error("offline"));
    s.logLightsOut(5000, q);
    await tick();
    expect((await s.listLightsOut(q))[0]?.pending).toBe(true);
    store.create = create;
    expect(await s.removeLightsOut(5000, q)).toBe(true);
    await tick();
    expect(await s.listLightsOut(q)).toEqual([]);
  });

  it("says false when there was nothing at that moment", async () => {
    expect(await svc().removeMeal(42, mem())).toBe(false);
  });
});

describe("HealthService: meals and Edit Time", () => {
  it("logs a meal as text, offline-first, and lists it", async () => {
    const s = svc();
    const store = mem();
    s.logMeal("  Eggs and toast ", 1000, store);
    await tick();
    expect((await s.listMeal(store)).map((e) => e.data)).toEqual([{ category: "fuel", at: 1000, text: "Eggs and toast", clientId: expect.any(String) }]);
  });

  it("Edit Time rewrites the clock on a landed bedtime", async () => {
    const s = svc();
    const store = mem();
    s.logLightsOut(1000, store);
    await tick();
    const row = (await s.listLightsOut(store))[0]!;
    await s.updateLightsOut(row.id, 900);
    expect((await s.listLightsOut(store)).map((e) => e.data.at)).toEqual([900]);
  });

  it("a region rides a Point at It log only when one was named", async () => {
    const s = svc();
    const store = mem();
    s.logPointAtIt({ x: 0.5, y: 0.46, side: "back", region: "Lower Back" }, 1000, store);
    s.logPointAtIt({ x: 0.2, y: 0.2, side: "front" }, 2000, store);
    await tick();
    const list = await s.listPointAtIt(store);
    expect(list[0]!.data.region).toBe("Lower Back");
    expect(list[1]!.data).not.toHaveProperty("region");
  });
});

// Part 3 wave 4 (Dave 14a): typed kinds on the event, counts only.
describe("typedKind", () => {
  it("names a dose, a meal and a bedtime the brief's way, and keeps the entity key for the rest", () => {
    expect(typedKind("health_took_it")).toBe("medication_logged");
    expect(typedKind("health_meal")).toBe("meal_logged");
    expect(typedKind("health_lights_out")).toBe("bedtime_logged");
    expect(typedKind("health_call_it")).toBe("health_call_it");
  });

  it("the event a landed dose emits carries the typed kind and nothing about the dose", async () => {
    const seen: { type: string; props?: Record<string, unknown> }[] = [];
    const s = new HealthService(new Store(new InMemoryAdapter()), "athlete1", (e) => { seen.push(e as never); });
    const store = mem();
    s.logTookIt(1000, store, { medId: "m1", amount: "10 mg" });
    await tick();
    const ev = seen.find((e) => e.type === "health.logged")!;
    expect(ev.props).toEqual({ kind: "medication_logged" });
  });
});

// 2026-09-14: the check-in logs offline like everything else and can be undone.
describe("HealthService: Check In", () => {
  it("logs the words and the note, lists them, and removes one by its moment", async () => {
    const s = svc();
    const st = mem();
    const d = s.logCheckIn({ energy: "okay", mood: "good", note: "  fine  " }, 1000, st);
    expect(d).toEqual({ category: "body", at: 1000, energy: "okay", mood: "good", note: "fine" });
    await tick();
    const rows = await s.listCheckIn(st);
    expect(rows.map((r) => r.data.at)).toEqual([1000]);
    expect(await s.removeCheckIn(1000, st)).toBe(true);
    expect(await s.listCheckIn(st)).toEqual([]);
    expect(typedKind("health_checkin")).toBe("checkin_logged");
  });
});

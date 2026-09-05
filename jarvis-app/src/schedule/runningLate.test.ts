import { describe, it, expect, vi } from "vitest";
import { shiftFutureEvents, shiftPlan, restoreShift } from "./runningLate";
import type { EventItem } from "./types";

const ev = (id: string, start: string, end?: string, recurrence?: string): EventItem =>
  ({ id, data: { title: id, date: "2026-08-09", start, category: "", ...(end ? { end } : {}), ...(recurrence ? { recurrence } : {}) } }) as EventItem;

function fakeSvc() {
  return { editTime: vi.fn(async () => true), editEnd: vi.fn(async () => true) };
}

describe("shiftFutureEvents", () => {
  it("moves future one-off events, start and end together", async () => {
    const svc = fakeSvc();
    const r = await shiftFutureEvents(svc, [ev("a", "14:00", "15:00")], "10:00", 30);
    expect(r.moved).toBe(1);
    expect(svc.editTime).toHaveBeenCalledWith("a", "14:30");
    expect(svc.editEnd).toHaveBeenCalledWith("a", "15:30");
  });

  it("leaves the past and every recurring event alone", async () => {
    const svc = fakeSvc();
    const r = await shiftFutureEvents(
      svc,
      [ev("past", "08:00"), ev("daily", "14:00", "14:30", "daily"), ev("f", "15:00")],
      "10:00", 15,
    );
    expect(r.moved).toBe(1);
    expect(r.skipped).toBe(1);
    expect(svc.editTime).toHaveBeenCalledTimes(1);
    expect(svc.editTime).toHaveBeenCalledWith("f", "15:15");
  });

  // TODAY-F-08 (2026-09-05): the shift can die halfway through, and the
  // caller's Undo has to cover what already moved.
  it("shiftPlan names every event a shift will touch before any write goes out", () => {
    const p = shiftPlan([ev("past", "08:00"), ev("daily", "14:00", "14:30", "daily"), ev("a", "14:00", "15:00"), ev("b", "16:00")], "10:00");
    expect(p.prior).toEqual([
      { id: "a", start: "14:00", end: "15:00" },
      { id: "b", start: "16:00", end: null },
    ]);
    expect(p.skipped).toBe(1);
  });

  it("a write that fails partway leaves a restore list that covers what moved", async () => {
    const svc = fakeSvc();
    let n = 0;
    svc.editTime = vi.fn(async () => { if (++n === 2) throw new Error("offline"); return true; });
    const events = [ev("a", "14:00", "15:00"), ev("b", "16:00")];
    const { prior } = shiftPlan(events, "10:00");
    await expect(shiftFutureEvents(svc, events, "10:00", 30)).rejects.toThrow();
    const restore = fakeSvc();
    await restoreShift(restore, prior);
    expect(restore.editTime).toHaveBeenCalledWith("a", "14:00");
    expect(restore.editTime).toHaveBeenCalledWith("b", "16:00");
  });

  it("restoreShift puts every prior time back exactly", async () => {
    const svc = fakeSvc();
    const r = await shiftFutureEvents(svc, [ev("a", "14:00", "15:00"), ev("b", "16:00")], "10:00", 60);
    const restore = fakeSvc();
    await restoreShift(restore, r.prior);
    expect(restore.editTime).toHaveBeenCalledWith("a", "14:00");
    expect(restore.editEnd).toHaveBeenCalledWith("a", "15:00");
    expect(restore.editTime).toHaveBeenCalledWith("b", "16:00");
  });
});

// SCHED-F-18 (2026-09-05): "Shifts clamp at 23:59 and collapse a late event
// to zero length." Running Late +1 hour at 22:00 with a 23:15-23:45 event
// turned it into 23:59-23:59. addMinutes clamps; a move must refuse.
describe("a shift that would cross midnight is refused, not clamped", () => {
  it("leaves the late event where it is and counts it", async () => {
    const svc = fakeSvc();
    const r = await shiftFutureEvents(svc, [ev("late", "23:15", "23:45"), ev("ok", "20:00", "21:00")], "19:00", 60);
    expect(r.moved).toBe(1);
    expect(r.crossed).toBe(1);
    expect(svc.editTime).toHaveBeenCalledTimes(1);
    expect(svc.editTime).toHaveBeenCalledWith("ok", "21:00");
  });

  it("the restore list covers only what moved", () => {
    const p = shiftPlan([ev("late", "23:15", "23:45"), ev("ok", "20:00", "21:00")], "19:00", 60);
    expect(p.prior.map((x) => x.id)).toEqual(["ok"]);
    expect(p.crossed).toBe(1);
  });

  it("[edge] an event with no end refuses on its start alone", async () => {
    const svc = fakeSvc();
    const r = await shiftFutureEvents(svc, [ev("late", "23:30")], "22:00", 60);
    expect(r.moved).toBe(0);
    expect(r.crossed).toBe(1);
    expect(svc.editTime).not.toHaveBeenCalled();
  });

  it("a shift that still fits the day is unchanged", async () => {
    const svc = fakeSvc();
    const r = await shiftFutureEvents(svc, [ev("late", "22:00", "22:30")], "21:00", 60);
    expect(r.moved).toBe(1);
    expect(r.crossed).toBe(0);
    expect(svc.editEnd).toHaveBeenCalledWith("late", "23:30");
  });
});

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

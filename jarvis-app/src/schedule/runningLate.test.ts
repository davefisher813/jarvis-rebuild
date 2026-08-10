import { describe, it, expect, vi } from "vitest";
import { shiftFutureEvents, restoreShift } from "./runningLate";
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

import { describe, it, expect } from "vitest";
import { nextOpening, BOOK_MIN } from "./bookTime";
import type { EventItem } from "../schedule/types";

const ev = (id: string, date: string, start: string, end: string): EventItem =>
  ({ id, data: { title: id, date, start, end, category: "" } });

const day = (date: string, events: EventItem[] = [], busy: { s: number; e: number }[] = []) =>
  ({ date, events, busy });

const T = "2026-08-21";
const M = "2026-08-22";

describe("Block Time For It finds a real slot", () => {
  it("takes the next opening today, rounded to a quarter hour", () => {
    // 14:07 now, nothing booked: the next opening is 14:15, not 14:07.
    const b = nextOpening(day(T), day(M), 14 * 60 + 7);
    expect(b).toEqual({ date: T, start: "14:15", end: "14:45" });
  });

  it("steps over an event", () => {
    const b = nextOpening(day(T, [ev("a", T, "14:00", "15:30")]), day(M), 14 * 60);
    expect(b?.start).toBe("15:30");
  });

  it("steps over a hard routine block", () => {
    // Dinner 17:00-18:00 is not free time even though no event sits on it.
    const b = nextOpening(day(T, [], [{ s: 17 * 60, e: 18 * 60 }]), day(M), 16 * 60 + 50);
    expect(b?.start).toBe("18:00");
  });

  it("falls to tomorrow when today is spent, and starts tomorrow at the top", () => {
    const b = nextOpening(day(T), day(M), 21 * 60);
    expect(b).toEqual({ date: M, start: "08:00", end: "08:30" });
  });

  it("[edge] a gap shorter than the block is not a gap", () => {
    // 14:15 to 14:30 is fifteen minutes. The block needs thirty.
    const b = nextOpening(day(T, [ev("a", T, "08:00", "14:15"), ev("b", T, "14:30", "21:00")]), day(M), 14 * 60);
    expect(b?.date).toBe(M);
  });

  it("[edge] both days full is null, never a block at midnight", () => {
    const full = [ev("x", T, "08:00", "21:00")];
    const fullM = [ev("y", M, "08:00", "21:00")];
    expect(nextOpening(day(T, full), day(M, fullM), 9 * 60)).toBeNull();
  });

  it("the block is always BOOK_MIN long", () => {
    const b = nextOpening(day(T), day(M), 10 * 60);
    const min = (t: string) => Number(t.split(":")[0]) * 60 + Number(t.split(":")[1]);
    expect(min(b!.end) - min(b!.start)).toBe(BOOK_MIN);
  });
});

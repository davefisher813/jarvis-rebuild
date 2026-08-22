import { describe, it, expect } from "vitest";
import {
  loadWindows, saveWindows, isOpenNow, nextOpen, closedLine, minLabel,
  addWindow, removeWindow, setWindowStart, setWindowLen, toggleDay,
  DEFAULT_WINDOWS, MAX_WINDOWS, type WindowSettings,
} from "./batching";

// 2026-08-20: Thursday. Weekday, so day gating never muddies a time assertion.
const at = (h: number, m = 0) => new Date(2026, 7, 20, h, m, 0);
const W = (on: boolean, hours: number[], days = [0, 1, 2, 3, 4, 5, 6]): WindowSettings =>
  ({ on, windows: hours.map((h) => ({ startMin: h * 60, minutes: 45 })), days });
const mem = () => {
  const m: Record<string, string> = {};
  return { getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => { m[k] = v; } };
};

describe("email windows", () => {
  it("is off by default: a way of working has to be chosen", () => {
    expect(DEFAULT_WINDOWS.on).toBe(false);
    expect(isOpenNow(DEFAULT_WINDOWS, at(3))).toBe(true);
  });

  it("fresh defaults run weekdays only", () => {
    expect(DEFAULT_WINDOWS.days).toEqual([1, 2, 3, 4, 5]);
  });

  it("opens at each window and stays open for ITS length", () => {
    const w = W(true, [9, 13, 17]);
    w.windows[2] = { startMin: 17 * 60, minutes: 90 };
    expect(isOpenNow(w, at(9, 0))).toBe(true);
    expect(isOpenNow(w, at(9, 44))).toBe(true);
    expect(isOpenNow(w, at(9, 45))).toBe(false);
    expect(isOpenNow(w, at(11))).toBe(false);
    // The 5 PM window was stretched to 90 and honors it.
    expect(isOpenNow(w, at(18, 15))).toBe(true);
    expect(isOpenNow(w, at(18, 30))).toBe(false);
  });

  it("a day the feature does not run is an open day", () => {
    const weekdays = W(true, [9], [1, 2, 3, 4, 5]);
    // 2026-08-22 is a Saturday.
    expect(isOpenNow(weekdays, new Date(2026, 7, 22, 3, 0, 0))).toBe(true);
  });

  it("knows when the next one is, rolling over days it skips", () => {
    const w = W(true, [9, 13, 17]);
    expect(nextOpen(w, at(10))?.getHours()).toBe(13);
    const tmr = nextOpen(w, at(20))!;
    expect(tmr.getHours()).toBe(9);
    expect(tmr.getDate()).toBe(21);
    // Friday evening on a weekday setting rolls all the way to Monday.
    const weekdays = W(true, [9], [1, 2, 3, 4, 5]);
    const fridayNight = new Date(2026, 7, 21, 20, 0, 0);
    const mon = nextOpen(weekdays, fridayNight)!;
    expect(mon.getDay()).toBe(1);
    expect(mon.getDate()).toBe(24);
  });

  it("says WHEN, never how many are waiting", () => {
    const w = W(true, [9, 13, 17]);
    expect(closedLine(w, at(10))).toBe("Opens at 1 PM");
    expect(closedLine(w, at(10))).not.toMatch(/\d+ (email|message|unread)/);
    expect(closedLine(w, at(20))).toBe("Opens at 9 AM tomorrow");
    const weekdays = W(true, [9], [1, 2, 3, 4, 5]);
    expect(closedLine(weekdays, new Date(2026, 7, 21, 20, 0, 0))).toBe("Opens Monday");
  });

  it("reads minutes like a person", () => {
    expect(minLabel(9 * 60)).toBe("9 AM");
    expect(minLabel(13 * 60 + 30)).toBe("1:30 PM");
    expect(minLabel(0)).toBe("12 AM");
  });
});

describe("the editor's operations", () => {
  const base = W(false, [9, 13]);

  it("adds a window after the latest one, and stops at the cap", () => {
    let w = addWindow(base);
    expect(w.windows.length).toBe(3);
    expect(w.windows[2]!.startMin).toBe(13 * 60 + 45 + 60);
    for (let i = 0; i < 10; i++) w = addWindow(w);
    expect(w.windows.length).toBe(MAX_WINDOWS);
  });

  it("re-sorts when a start time moves past a neighbour", () => {
    const w = setWindowStart(base, 0, 15 * 60);
    expect(w.windows.map((x) => x.startMin)).toEqual([13 * 60, 15 * 60]);
  });

  it("[edge] the last window cannot be removed: zero windows is a lock, not a curtain", () => {
    const one = W(true, [9]);
    expect(removeWindow(one, 0)).toBe(one);
    expect(removeWindow(base, 0).windows.length).toBe(1);
  });

  it("[edge] the last day cannot be toggled off", () => {
    const w: WindowSettings = { ...base, days: [3] };
    expect(toggleDay(w, 3)).toBe(w);
    expect(toggleDay(base, 3).days).toEqual([0, 1, 2, 4, 5, 6]);
  });

  it("sets a length on one window without touching the others", () => {
    const w = setWindowLen(base, 1, 90);
    expect(w.windows[0]!.minutes).toBe(45);
    expect(w.windows[1]!.minutes).toBe(90);
  });
});

describe("storage", () => {
  it("round-trips v2", () => {
    const s = mem();
    const w = { ...W(true, [8]), days: [2, 4] };
    saveWindows(w, s);
    expect(loadWindows(s)).toEqual(w);
  });

  it("migrates v1 keeping every day, because v1 ran every day", () => {
    const s = mem();
    s.setItem("jarvis.mail.windows.v1", JSON.stringify({ on: true, hours: [9, 13, 17] }));
    const w = loadWindows(s);
    expect(w.on).toBe(true);
    expect(w.windows.map((x) => x.startMin)).toEqual([9 * 60, 13 * 60, 17 * 60]);
    expect(w.windows.every((x) => x.minutes === 45)).toBe(true);
    expect(w.days).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("[edge] survives garbage and an all-invalid window list", () => {
    const s = mem();
    s.setItem("jarvis.mail.windows.v2", "{not json");
    expect(loadWindows(s)).toEqual(DEFAULT_WINDOWS);
    s.setItem("jarvis.mail.windows.v2", JSON.stringify({ on: true, windows: [{ startMin: -5, minutes: 9999 }], days: [1] }));
    const w = loadWindows(s);
    // Nothing valid to open means the curtain may not claim to be on.
    expect(w.on).toBe(false);
  });
});

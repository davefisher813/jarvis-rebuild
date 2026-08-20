import { describe, it, expect } from "vitest";
import {
  loadWindows, saveWindows, isOpenNow, nextOpen, closedLine, hourLabel,
  DEFAULT_WINDOWS, WINDOW_MINUTES,
} from "./batching";

const at = (h: number, m = 0) => new Date(2026, 7, 20, h, m, 0);

describe("email windows", () => {
  it("is off by default: a way of working has to be chosen", () => {
    expect(DEFAULT_WINDOWS.on).toBe(false);
    expect(isOpenNow(DEFAULT_WINDOWS, at(3))).toBe(true);
  });

  it("opens at each hour and stays open for the window", () => {
    const w = { on: true, hours: [9, 13, 17] };
    expect(isOpenNow(w, at(9, 0))).toBe(true);
    expect(isOpenNow(w, at(9, WINDOW_MINUTES - 1))).toBe(true);
    expect(isOpenNow(w, at(9, WINDOW_MINUTES))).toBe(false);
    expect(isOpenNow(w, at(13, 10))).toBe(true);
    expect(isOpenNow(w, at(11))).toBe(false);
  });

  it("knows when the next one is, including rolling to tomorrow", () => {
    const w = { on: true, hours: [9, 13, 17] };
    expect(nextOpen(w, at(10))?.getHours()).toBe(13);
    const tmr = nextOpen(w, at(20))!;
    expect(tmr.getHours()).toBe(9);
    expect(tmr.getDate()).toBe(21);
  });

  it("says WHEN, never how many are waiting", () => {
    const w = { on: true, hours: [9, 13, 17] };
    const line = closedLine(w, at(10));
    expect(line).toBe("Opens at 1 PM");
    expect(line).not.toMatch(/\d+ (email|message|unread)/);
    expect(closedLine(w, at(20))).toBe("Opens at 9 AM tomorrow");
  });

  it("reads hours like a person", () => {
    expect(hourLabel(9)).toBe("9 AM");
    expect(hourLabel(13)).toBe("1 PM");
    expect(hourLabel(0)).toBe("12 AM");
    expect(hourLabel(12)).toBe("12 PM");
  });

  it("round-trips and survives garbage", () => {
    let v: string | null = null;
    const st = { getItem: () => v, setItem: (_k: string, s: string) => { v = s; } };
    saveWindows({ on: true, hours: [8, 16] }, st);
    expect(loadWindows(st)).toEqual({ on: true, hours: [8, 16] });
    expect(loadWindows({ getItem: () => "{" })).toEqual(DEFAULT_WINDOWS);
    expect(loadWindows({ getItem: () => '{"on":true,"hours":[99,-1]}' }).hours).toEqual(DEFAULT_WINDOWS.hours);
  });
});

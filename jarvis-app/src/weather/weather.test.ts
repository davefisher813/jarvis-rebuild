// @vitest-environment jsdom
// Weather Fact laws (addendum item 4): threshold-gated with SILENCE on mild
// days, stale age shown and a dead snapshot says nothing, cache-first fetch,
// coarse location only, and weather never touches another number in the app
// (pinned by a static scan: the weather module exports strings, not math
// consumed by Leave By or anything else).

import { describe, it, expect, beforeEach } from "vitest";
import {
  morningLine,
  eventLine,
  staleSuffix,
  getWeather,
  writeCoords,
  readCoords,
  writeSnapshot,
  type WeatherSnapshot,
} from "./weather";

const TODAY = "2026-08-15";
const NOW = new Date(2026, 7, 15, 8, 0).getTime();
const now = () => NOW;

function snap(overrides: Partial<{ tempF: number[]; precipProb: number[]; windMph: number[]; fetchedAt: number }> = {}): WeatherSnapshot {
  const hours = Array.from({ length: 24 }, (_, h) => `${TODAY}T${String(h).padStart(2, "0")}:00`);
  return {
    fetchedAt: overrides.fetchedAt ?? NOW,
    hourly: {
      time: hours,
      tempF: overrides.tempF ?? Array(24).fill(72),
      precipProb: overrides.precipProb ?? Array(24).fill(5),
      windMph: overrides.windMph ?? Array(24).fill(5),
    },
  };
}

beforeEach(() => localStorage.clear());

describe("thresholds gate every line", () => {
  it("a mild day says NOTHING", () => {
    expect(morningLine(snap(), TODAY, now)).toBeNull();
    expect(eventLine(snap(), TODAY, "18:00", now)).toBeNull();
  });

  it("a rain window states its hours", () => {
    const p = Array(24).fill(5);
    for (let h = 9; h <= 10; h++) p[h] = 70;
    const line = morningLine(snap({ precipProb: p }), TODAY, now)!;
    expect(line).toMatch(/Rain likely 9 AM-11 AM/); // SPEC MOVED (short copy, 2026-08-15)
  });

  it("heat and cold speak only past the gates", () => {
    const hot = Array(24).fill(72); hot[14] = 91;
    expect(morningLine(snap({ tempF: hot }), TODAY, now)).toMatch(/91 At the peak/);
    const brisk = Array(24).fill(72); brisk[14] = 84.9;
    expect(morningLine(snap({ tempF: brisk }), TODAY, now)).toBeNull();
  });

  it("an event line reads its start hour, not the day", () => {
    const p = Array(24).fill(5); p[18] = 80;
    expect(eventLine(snap({ precipProb: p }), TODAY, "18:00", now)).toMatch(/Rain likely at start/);
    expect(eventLine(snap({ precipProb: p }), TODAY, "12:00", now)).toBeNull();
  });
});

describe("staleness is stated, death is silence", () => {
  it("a fresh snapshot earns no caveat", () => {
    expect(staleSuffix(snap(), now)).toBe("");
  });
  it("an old snapshot says how old", () => {
    expect(staleSuffix(snap({ fetchedAt: NOW - 40 * 60_000 }), now)).toBe(" · checked 40 min ago"); // SPEC MOVED
    expect(staleSuffix(snap({ fetchedAt: NOW - 3 * 3600e3 }), now)).toBe(" · checked 3 hr ago"); // SPEC MOVED
  });
  it("a day-old snapshot renders nothing at all", () => {
    const dead = snap({ fetchedAt: NOW - 25 * 3600e3, precipProb: Array(24).fill(90) });
    expect(staleSuffix(dead, now)).toBeNull();
    expect(morningLine(dead, TODAY, now)).toBeNull();
  });
});

describe("fetch is cache-first and fails to stale", () => {
  it("a fresh cache makes zero network calls", async () => {
    writeSnapshot(snap());
    let calls = 0;
    const fetchImpl = (async () => { calls++; return new Response("{}"); }) as typeof fetch;
    const out = await getWeather(now, fetchImpl);
    expect(out).not.toBeNull();
    expect(calls).toBe(0);
  });

  it("no location and no cache means null, not a request", async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls++; return new Response("{}"); }) as typeof fetch;
    expect(await getWeather(now, fetchImpl)).toBeNull();
    expect(calls).toBe(0);
  });

  it("a failed refresh serves the stale snapshot", async () => {
    writeSnapshot(snap({ fetchedAt: NOW - 2 * 3600e3 }));
    writeCoords({ lat: 41.05, lon: -73.54 });
    const fetchImpl = (async () => { throw new Error("offline"); }) as typeof fetch;
    const out = await getWeather(now, fetchImpl);
    expect(out!.fetchedAt).toBe(NOW - 2 * 3600e3);
  });
});

describe("location is coarse", () => {
  it("stores two decimals, a neighborhood, nothing finer", () => {
    writeCoords({ lat: 41.05366789, lon: -73.53879123 });
    expect(readCoords()).toEqual({ lat: 41.05, lon: -73.54 });
  });
});

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
  morningFact,
  eventFact,
  WEATHER_EMOJI,
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
    // SPEC MOVED (Colour Key sweep, 2026-09-26): the age carries no baked-in
    // separator; the line draws it as its own fact and CSS draws the dot.
    expect(staleSuffix(snap({ fetchedAt: NOW - 40 * 60_000 }), now)).toBe("Checked 40 min ago");
    expect(staleSuffix(snap({ fetchedAt: NOW - 3 * 3600e3 }), now)).toBe("Checked 3 hr ago");
  });
  it("the age rides beside the sentence, never inside it", () => {
    const p = Array(24).fill(5); p[18] = 80;
    const old = snap({ precipProb: p, fetchedAt: NOW - 40 * 60_000 });
    expect(morningFact(old, TODAY, now)).toMatchObject({ kind: "rain", stale: "Checked 40 min ago" });
    expect(morningFact(old, TODAY, now)?.text).not.toMatch(/\u00B7|Checked/);
    expect(eventFact(old, TODAY, "18:00", now)).toEqual({ kind: "rain", text: "Rain likely at start", stale: "Checked 40 min ago" });
    // A fresh read has no age at all, not an empty one.
    expect(eventFact(snap({ precipProb: p }), TODAY, "18:00", now)).toEqual({ kind: "rain", text: "Rain likely at start" });
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

// THE SYMBOL IS PICKED WHERE THE SENTENCE IS (2026-09-15, Dave: "add weather
// emojis when there's a weather notification. Right now it's just grey text
// that looks terrible"). The kind rides with the words rather than being
// guessed later by re-reading them, so a reworded sentence can never end up
// under the wrong glyph.
describe("weather facts carry their condition", () => {
  const wsnap = (over: Partial<WeatherSnapshot["hourly"]> = {}): WeatherSnapshot => ({
    fetchedAt: Date.now(),
    hourly: {
      time: ["2026-09-15T08:00", "2026-09-15T09:00", "2026-09-15T10:00"],
      precipProb: [0, 0, 0],
      tempF: [70, 70, 70],
      windMph: [2, 2, 2],
      ...over,
    },
  } as WeatherSnapshot);

  it("names rain, and says the same sentence the string form always said", () => {
    const s = wsnap({ precipProb: [0, 80, 80] });
    const fact = morningFact(s, "2026-09-15");
    expect(fact?.kind).toBe("rain");
    expect(fact?.text).toBe(morningLine(s, "2026-09-15"));
    expect(fact?.text).toMatch(/^Rain likely/);
  });

  it("names heat, cold and wind off the same thresholds as the words", () => {
    expect(morningFact(wsnap({ tempF: [70, 96, 80] }), "2026-09-15")?.kind).toBe("hot");
    expect(morningFact(wsnap({ tempF: [70, 20, 60] }), "2026-09-15")?.kind).toBe("cold");
    expect(morningFact(wsnap({ windMph: [2, 40, 3] }), "2026-09-15")?.kind).toBe("wind");
  });

  it("stays silent on a mild day, glyph and all", () => {
    expect(morningFact(wsnap(), "2026-09-15")).toBeNull();
    expect(morningLine(wsnap(), "2026-09-15")).toBeNull();
  });

  it("does the same for an event's own hour", () => {
    const s = wsnap({ precipProb: [0, 90, 0] });
    const fact = eventFact(s, "2026-09-15", "09:00");
    expect(fact?.kind).toBe("rain");
    expect(fact?.text).toBe(eventLine(s, "2026-09-15", "09:00"));
  });

  it("has a symbol for every condition it can report, and none of them is a face", () => {
    for (const k of ["rain", "hot", "cold", "wind"] as const) {
      expect(WEATHER_EMOJI[k], `${k} has no symbol`).toBeTruthy();
    }
    // A forecast reports; it does not react. No 🥵 / 🥶 / ☹️ shapes here.
    const faces = /[\u{1F600}-\u{1F64F}]|[\u{1F910}-\u{1F97F}]/u;
    for (const v of Object.values(WEATHER_EMOJI)) expect(v).not.toMatch(faces);
  });

  it("gives each condition its own symbol, so two never read alike", () => {
    expect(new Set(Object.values(WEATHER_EMOJI)).size).toBe(4);
  });
});

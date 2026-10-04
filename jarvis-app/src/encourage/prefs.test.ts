// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_FEEDBACK, QUIET_KEY, effectiveFeedback, isQuietToday, readFeedback, sanitizeFeedback,
  setLiveFeedback, setQuietToday,
} from "./prefs";

beforeEach(() => { localStorage.clear(); setLiveFeedback(null); });

describe("feedback defaults (the Gentle set from the brief)", () => {
  it("Celebration Gentle, Motion Follow System, no sound, no haptics, brief factual, private", () => {
    expect(DEFAULT_FEEDBACK).toEqual({
      celebration: "gentle", motion: "system", sound: false, haptics: false,
      encouragement: "factual", accountability: "private",
    });
  });

  it("nothing stored reads as the defaults", () => {
    expect(readFeedback()).toEqual(DEFAULT_FEEDBACK);
  });

  it("a value this build does not know falls back to the quiet default, never a loud one", () => {
    const got = sanitizeFeedback({ celebration: "fireworks", motion: "wild", encouragement: "hype", sound: "yes", haptics: 1, accountability: "public" });
    expect(got).toEqual(DEFAULT_FEEDBACK);
  });

  it("keeps valid choices and always stays private", () => {
    const got = sanitizeFeedback({ celebration: "expressive", sound: true, accountability: "shared" });
    expect(got.celebration).toBe("expressive");
    expect(got.sound).toBe(true);
    expect(got.accountability).toBe("private");
  });

  it("garbage in is the defaults out", () => {
    for (const bad of [null, undefined, 3, "x", []]) expect(sanitizeFeedback(bad)).toEqual(DEFAULT_FEEDBACK);
  });
});

describe("effective feedback", () => {
  const calm = { systemReduced: false, quiet: false };

  it("Gentle pulses once and shows no burst, sound or tap", () => {
    expect(effectiveFeedback(DEFAULT_FEEDBACK, calm)).toMatchObject({ celebrate: "gentle", pulse: true, burst: false, sound: false, haptic: false, reduced: false });
  });

  it("Expressive is the only level with the burst", () => {
    expect(effectiveFeedback({ ...DEFAULT_FEEDBACK, celebration: "expressive" }, calm).burst).toBe(true);
    expect(effectiveFeedback({ ...DEFAULT_FEEDBACK, celebration: "gentle" }, calm).burst).toBe(false);
  });

  it("Off draws no pulse and no burst", () => {
    const e = effectiveFeedback({ ...DEFAULT_FEEDBACK, celebration: "off" }, calm);
    expect(e.pulse).toBe(false);
    expect(e.burst).toBe(false);
  });

  it("the phone's reduce-motion request removes the pulse and the burst even when Expressive", () => {
    const e = effectiveFeedback({ ...DEFAULT_FEEDBACK, celebration: "expressive" }, { systemReduced: true, quiet: false });
    expect(e.reduced).toBe(true);
    expect(e.pulse).toBe(false);
    expect(e.burst).toBe(false);
  });

  it("the Reduced setting does the same without the phone asking", () => {
    const e = effectiveFeedback({ ...DEFAULT_FEEDBACK, celebration: "expressive", motion: "reduced" }, calm);
    expect(e.reduced).toBe(true);
    expect(e.pulse).toBe(false);
  });

  it("sound and haptics are independent of celebration and of each other", () => {
    const offWithSound = effectiveFeedback({ ...DEFAULT_FEEDBACK, celebration: "off", sound: true }, calm);
    expect(offWithSound.sound).toBe(true);
    expect(offWithSound.haptic).toBe(false);
    const tapOnly = effectiveFeedback({ ...DEFAULT_FEEDBACK, haptics: true }, calm);
    expect(tapOnly.haptic).toBe(true);
    expect(tapOnly.sound).toBe(false);
  });

  it("Quiet Today turns off pulse, burst, sound and tap and nothing else", () => {
    const loud = { ...DEFAULT_FEEDBACK, celebration: "expressive" as const, sound: true, haptics: true };
    const e = effectiveFeedback(loud, { systemReduced: false, quiet: true });
    expect(e).toMatchObject({ celebrate: "off", pulse: false, burst: false, sound: false, haptic: false });
  });
});

describe("Quiet Today", () => {
  it("is for one date and is simply not set tomorrow", () => {
    setQuietToday(true, "2026-10-04");
    expect(isQuietToday("2026-10-04")).toBe(true);
    expect(isQuietToday("2026-10-05")).toBe(false);
  });

  it("turning it off clears it", () => {
    setQuietToday(true, "2026-10-04");
    setQuietToday(false, "2026-10-04");
    expect(isQuietToday("2026-10-04")).toBe(false);
    expect(localStorage.getItem(QUIET_KEY)).toBeNull();
  });

  it("a blocked store never throws", () => {
    const real = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error("blocked"); };
    try { expect(isQuietToday("2026-10-04")).toBe(false); } finally { Storage.prototype.getItem = real; }
  });
});

describe("the live set", () => {
  it("wins over the mirror once the provider has set it", () => {
    setLiveFeedback({ ...DEFAULT_FEEDBACK, celebration: "off" });
    expect(readFeedback().celebration).toBe("off");
  });
});

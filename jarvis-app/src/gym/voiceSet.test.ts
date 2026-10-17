import { describe, it, expect } from "vitest";
import { normalizeHeard, parseVoiceSet, voiceEntry, voiceReadBack, voiceSpoken } from "./voiceSet";
import type { SetEntry } from "./types";

// Voice set logging, the Logging Standard addendum 5 (Alfred 2026-10-17): a
// deliberate phrase starts it, the app reads the set back, he confirms. The
// parser is the first half: "Log" or nothing.

const LIFT = { kind: "weight_reps" as const, unit: "lb" };
const LAST: SetEntry = { id: "s1", w: 225, r: 5, at: 123, moved: "grind", state: "reported" };

describe("parseVoiceSet: the command phrase", () => {
  it("reads a set only when Log leads the words", () => {
    expect(parseVoiceSet("Log 225 for 5", LIFT)).toEqual({ ok: true, set: { w: 225, r: 5 } });
    expect(parseVoiceSet("log 225 x 5", LIFT)).toEqual({ ok: true, set: { w: 225, r: 5 } });
    const bare = parseVoiceSet("225 for 5", LIFT);
    expect(bare.ok).toBe(false);
    expect(!bare.ok && bare.reason).toBe("Start With Log, Like Log 225 for 5");
  });

  it("never logs a bare yes, ok or a Log with nothing after it", () => {
    for (const t of ["yes", "Yes.", "ok", "OK!", "yeah", "confirm", "Log yes", "log ok", "Log", "log.", "logs 225 for 5", "blog 225 for 5", ""]) {
      expect(parseVoiceSet(t, LIFT, LAST).ok, t).toBe(false);
    }
    const empty = parseVoiceSet("Log", LIFT);
    expect(!empty.ok && empty.reason).toBe("Now Say the Set, Like Log 225 for 5");
  });

  it("forgives what a speech engine adds: capitals, commas, a full stop, the times sign", () => {
    for (const t of ["Log 225 for 5.", "LOG 225 FOR 5", "Log, 225 for 5!", "Log: 225 for 5?", "  Log   225   for   5  ", "Log 225 × 5", "Log 225 lbs. for 5."]) {
      expect(parseVoiceSet(t, LIFT), t).toEqual({ ok: true, set: { w: 225, r: 5 } });
    }
    expect(normalizeHeard("Log 22.5 for 5.")).toBe("log 22.5 for 5");
    expect(normalizeHeard("Log 1,000 in 4:30.")).toBe("log 1000 in 4:30");
  });

  it("keeps the numbers a recognizer writes with punctuation in them", () => {
    expect(parseVoiceSet("Log 22.5 for 8.", { kind: "weight_reps", unit: "kg" })).toEqual({ ok: true, set: { w: 22.5, r: 8 } });
    expect(parseVoiceSet("Log 1:30.", { kind: "time_longer", unit: "sec" })).toEqual({ ok: true, set: { v: 90 } });
    expect(parseVoiceSet("Log 7 rounds + 12", { kind: "rounds" })).toEqual({ ok: true, set: { r: 7, extra: 12 } });
  });
});

describe("parseVoiceSet: same and done, the way the capture box reads them", () => {
  it("Log same repeats the last working set as a new event", () => {
    const r = parseVoiceSet("Log same.", LIFT, LAST);
    expect(r).toEqual({ ok: true, set: { w: 225, r: 5, state: "reported" } });
    const again = parseVoiceSet("log same again", LIFT, LAST);
    expect(again.ok && again.set).not.toHaveProperty("at");
    expect(again.ok && again.set).not.toHaveProperty("moved");
  });

  it("Log same with nothing logged yet says so", () => {
    const r = parseVoiceSet("Log same", LIFT);
    expect(!r.ok && r.reason).toBe("Nothing Logged Yet to Repeat");
  });

  it("Log done marks a done exercise, and is not a set on a lift", () => {
    expect(parseVoiceSet("Log done", { kind: "done" })).toEqual({ ok: true, set: { done: true } });
    expect(parseVoiceSet("Log done", LIFT).ok).toBe(false);
  });

  it("a rep count on its own takes the last weight, or stands alone", () => {
    expect(parseVoiceSet("Log 8 reps", LIFT, LAST)).toEqual({ ok: true, set: { w: 225, r: 8 } });
    expect(parseVoiceSet("Log 8 reps", LIFT)).toEqual({ ok: true, set: { r: 8 } });
  });

  it("a skip is not a set", () => {
    const r = parseVoiceSet("Log skip", LIFT, LAST);
    expect(!r.ok && r.reason).toBe("Voice Logs Sets, Not Skips");
  });
});

describe("parseVoiceSet: parseSet's refusals pass straight through", () => {
  it("refuses a unit the exercise does not use instead of converting it", () => {
    expect(parseVoiceSet("Log 100 kilos for 5", { kind: "weight_reps", unit: "kg" })).toEqual({ ok: true, set: { w: 100, r: 5 } });
    const r = parseVoiceSet("Log 100 kilos for 5", LIFT);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("Not a Set Yet, Try Log 225 for 5");
  });

  it("refuses a bare number on a lift, where it could be either", () => {
    expect(parseVoiceSet("Log 225", LIFT).ok).toBe(false);
  });

  it("digits only: a number said as words is not read", () => {
    expect(parseVoiceSet("Log two twenty five for five", LIFT).ok).toBe(false);
  });
});

describe("the read-back and the entry", () => {
  it("reads the set back on screen in the app's own words, Title Case", () => {
    expect(voiceReadBack("Bench Press", LIFT, { w: 225, r: 5 })).toBe("Log 225 Lb × 5 on Bench Press");
    expect(voiceReadBack("Plank", { kind: "done" }, { done: true })).toBe("Mark Plank Done");
  });

  it("says it aloud with the times sign spoken the way he said it", () => {
    expect(voiceSpoken("Bench Press", LIFT, { w: 225, r: 5 })).toBe("225 lb for 5, Bench Press");
  });

  it("the entry is reported, with a fresh id every time", () => {
    const a = voiceEntry({ w: 225, r: 5 });
    const b = voiceEntry({ w: 225, r: 5 });
    expect(a).toMatchObject({ w: 225, r: 5, state: "reported" });
    expect(a.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
    expect(voiceEntry({ w: 1, r: 1, state: "observed" }).state).toBe("reported");
  });
});

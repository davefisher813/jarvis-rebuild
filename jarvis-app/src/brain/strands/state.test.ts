import { describe, it, expect } from "vitest";
import { bucketFor, confidenceWord, isWatching, readinessWord, stateForStrand, STRAND_STATE_LABEL, toneForReadinessWord, toneForStrandState } from "./state";
import type { Strand } from "./types";
import { watchingCount } from "../readiness";

// The closed set from laws/astra.test.ts, copied rather than imported: a
// test module imported from a test re-runs every describe it holds.
const STATE_WORDS = ["FIXED", "FOCUS", "PROTECTED", "FLEXIBLE", "PROPOSED", "LIVE", "COMPLETED", "KNOWN", "LEARNED", "WATCHING", "NEEDS CONFIRMATION", "FADING", "RULE"];

const TODAY = "2026-09-12";
const strand = (over: Partial<Strand["data"]> = {}): Strand => ({
  id: "s",
  data: {
    text: "x", category: "energy", source: "watched", strength: "influence", status: "active",
    createdAt: "2026-08-01", lastConfirmed: "2026-09-01", ...over,
  },
});

describe("stateForStrand (C-40, C-47)", () => {
  it("told and asked are KNOWN, watched and uploaded are LEARNED", () => {
    expect(stateForStrand(strand({ source: "told" }), TODAY)).toBe("KNOWN");
    expect(stateForStrand(strand({ source: "asked" }), TODAY)).toBe("KNOWN");
    expect(stateForStrand(strand({ source: "watched" }), TODAY)).toBe("LEARNED");
    expect(stateForStrand(strand({ source: "uploaded" }), TODAY)).toBe("LEARNED");
  });

  it("a paused watched strand has no state word", () => {
    expect(stateForStrand(strand({ status: "paused" }), TODAY)).toBeNull();
  });

  it("a season without confirmation is FADING, whatever the source", () => {
    expect(stateForStrand(strand({ lastConfirmed: "2026-05-01" }), TODAY)).toBe("FADING");
    expect(stateForStrand(strand({ source: "told", lastConfirmed: "2026-05-01" }), TODAY)).toBe("FADING");
    // But not a paused one: he already said stop.
    expect(stateForStrand(strand({ status: "paused", lastConfirmed: "2026-05-01" }), TODAY)).toBeNull();
  });

  it("every word it can say is in the closed vocabulary, and never stored", () => {
    for (const w of Object.values(STRAND_STATE_LABEL)) expect(STATE_WORDS).toContain(w.toUpperCase());
    for (const w of ["Known", "Close", "Waiting"] as const) {
      // The readiness word is a display word, not a state word: only Known
      // is in the closed set, and the other two never render as .fact.st in
      // a colour that claims a state.
      expect(["good", "warn", "gray"]).toContain(toneForReadinessWord(w));
    }
    const src = strand();
    expect(Object.keys(src.data)).not.toContain("state");
  });

  it("tones: Known and Learned are plain caps, Fading is amber (§AM)", () => {
    // Neither Known nor Learned is done, due or late, so neither wears a key
    // colour; the caps of .fact.st are the distinction. Fading asks him to
    // confirm, which is "needs you soon".
    expect(toneForStrandState("KNOWN")).toBe("");
    expect(toneForStrandState("LEARNED")).toBe("");
    expect(toneForStrandState("FADING")).toBe("warn");
  });
});

describe("bucketFor (the filter chips)", () => {
  it("files by source, except that a fading fact goes to Needs Confirmation", () => {
    expect(bucketFor(strand({ source: "told" }), TODAY)).toBe("known");
    expect(bucketFor(strand({ source: "watched" }), TODAY)).toBe("learned");
    expect(bucketFor(strand({ source: "watched", status: "paused" }), TODAY)).toBe("learned");
    expect(bucketFor(strand({ source: "told", lastConfirmed: "2026-05-01" }), TODAY)).toBe("needs");
  });
});

describe("readinessWord (C-39)", () => {
  it("maps five states onto three words", () => {
    expect(readinessWord("known")).toBe("Known");
    expect(readinessWord("ready")).toBe("Close");
    expect(readinessWord("close")).toBe("Close");
    expect(readinessWord("waiting")).toBe("Waiting");
    expect(readinessWord("muted")).toBe("Waiting");
  });
  it("watching is close or ready, nothing else", () => {
    expect(isWatching("close")).toBe(true);
    expect(isWatching("ready")).toBe(true);
    expect(isWatching("known")).toBe(false);
    expect(isWatching("waiting")).toBe(false);
    expect(isWatching("muted")).toBe(false);
  });
});

describe("confidenceWord (C-41)", () => {
  it("High at twice the gate, Medium at the gate, nothing under it", () => {
    expect(confidenceWord(20, 10)).toBe("High");
    expect(confidenceWord(19, 10)).toBe("Medium");
    expect(confidenceWord(10, 10)).toBe("Medium");
    expect(confidenceWord(9, 10)).toBeNull();
    expect(confidenceWord(5, 0)).toBeNull();
  });
});

describe("watchingCount (the fact on a WATCHING row)", () => {
  // AMENDED 2026-09-26 (pass-off): a facts line is Title Case after every
  // number ("45 Min", never "45 min"), so the unit takes its capital too.
  it("says of-the-gate short of it, and the count alone once past it, in Title Case", () => {
    expect(watchingCount({ have: 4, need: 5, unit: "pushes in one area" })).toBe("4 of 5 Pushes in One Area");
    expect(watchingCount({ have: 28, need: 10, unit: "completions" })).toBe("28 Completions");
    expect(watchingCount({ have: 10, need: 10, unit: "completions" })).toBe("10 Completions");
  });
});

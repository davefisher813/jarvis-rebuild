import { describe, it, expect } from "vitest";
import { stateForEvent, stateForBlock, stateForProposed, toneFor, type StateWord } from "./stateWord";

// THE STATE VOCABULARY (C-28, Astra pass 2026-09-12). Seven words, one
// derivation, nothing stored. These pin the derivation itself; the law in
// laws/astra.test.ts pins that no surface invents an eighth word.

const NOW = { today: "2026-09-12", nowMin: 15 * 60 + 21 }; // 3:21 PM
const ev = (over: Partial<{ date: string; start: string; end: string | null }> = {}) => ({
  date: "2026-09-12", start: "10:00", end: "11:00", ...over,
});

describe("an event says whether the clock has passed it", () => {
  it("is FIXED while it is still ahead, and on any other day", () => {
    expect(stateForEvent(ev({ start: "16:00", end: "17:00" }), NOW)).toBe("FIXED");
    expect(stateForEvent(ev({ date: "2026-09-13" }), NOW)).toBe("FIXED");
    // Yesterday's row is about yesterday, not about now.
    expect(stateForEvent(ev({ date: "2026-09-11" }), NOW)).toBe("FIXED");
  });

  it("is COMPLETED once its end is behind now, today only", () => {
    expect(stateForEvent(ev(), NOW)).toBe("COMPLETED");
    // Running right now is not finished.
    expect(stateForEvent(ev({ start: "15:00", end: "16:00" }), NOW)).toBe("FIXED");
    // An event with no end is an hour long, the same assumption the day
    // view has always drawn it with.
    expect(stateForEvent(ev({ start: "14:00", end: null }), NOW)).toBe("COMPLETED");
    expect(stateForEvent(ev({ start: "14:30", end: null }), NOW)).toBe("FIXED");
  });

  it("says nothing about the clock when there is no clock to ask", () => {
    expect(stateForEvent(ev(), null)).toBe("FIXED");
  });
});

describe("a block says what kind of wall it is", () => {
  it("holds tasks is FOCUS, protects is PROTECTED, blends is FLEXIBLE", () => {
    expect(stateForBlock({ label: "Deep Work", kind: "focus" })).toBe("FOCUS");
    expect(stateForBlock({ label: "Dinner", kind: "meal" })).toBe("PROTECTED");
    expect(stateForBlock({ label: "Commute", kind: "commute" })).toBe("FLEXIBLE");
  });

  it("soft is FLEXIBLE whatever its mode, because the planner may route through it", () => {
    expect(stateForBlock({ label: "Dinner", kind: "meal", soft: true })).toBe("FLEXIBLE");
    expect(stateForBlock({ label: "Deep Work", kind: "focus", soft: true })).toBe("FLEXIBLE");
  });

  it("reads an explicit mode over the kind's default", () => {
    expect(stateForBlock({ label: "Errands", kind: "errand", mode: "protects" })).toBe("PROTECTED");
    expect(stateForBlock({ label: "Dinner", kind: "meal", mode: "holds" })).toBe("FOCUS");
  });

  it("a draft is PROPOSED until somebody accepts it", () => {
    expect(stateForProposed()).toBe("PROPOSED");
  });
});

describe("the tones are the ones the pass ruled", () => {
  it("sky for the two that shape the day, red for LIVE, good for COMPLETED, quiet for the rest", () => {
    const tones: Record<StateWord, string> = {
      FOCUS: "sky", PROTECTED: "sky", LIVE: "red", COMPLETED: "good",
      FIXED: "gray", FLEXIBLE: "gray", PROPOSED: "gray",
    };
    for (const [word, tone] of Object.entries(tones)) {
      expect(toneFor(word as StateWord), word).toBe(tone);
    }
  });
});

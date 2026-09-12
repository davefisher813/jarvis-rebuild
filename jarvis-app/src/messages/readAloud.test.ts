// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { speak, pauseSpeaking, resumeSpeaking, nextSentence, stopSpeaking, sentencesOf } from "./readAloud";

// E-22 (Push D): Pause and Next. A fake SpeechSynthesis that records every
// utterance and lets the test end the current one by hand, so the sentence
// chain is observable and so a cancelled utterance's end handler (which real
// engines fire) is proven not to advance the player.
class FakeUtterance {
  text: string; rate = 1; onend: (() => void) | null = null; onerror: (() => void) | null = null;
  constructor(t: string) { this.text = t; }
}
const spoken: FakeUtterance[] = [];
let current: FakeUtterance | null = null;
const synth = {
  cancel: vi.fn(() => { const c = current; current = null; c?.onend?.(); }),
  speak: vi.fn((u: FakeUtterance) => { spoken.push(u); current = u; }),
};
const endCurrent = () => { const c = current; current = null; c?.onend?.(); };

beforeEach(() => {
  spoken.length = 0; current = null;
  synth.cancel.mockClear(); synth.speak.mockClear();
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = FakeUtterance;
  stopSpeaking();
  spoken.length = 0;
});

describe("readAloud sentences", () => {
  it("splits on sentence ends only", () => {
    expect(sentencesOf("Nadia is due today. Ridgeley, 3 days. You said you would call.")).toEqual([
      "Nadia is due today.", "Ridgeley, 3 days.", "You said you would call.",
    ]);
  });

  it("speaks one sentence at a time and fires onEnd once after the last", () => {
    const onEnd = vi.fn();
    expect(speak("One. Two. Three.", onEnd)).toBe(true);
    expect(spoken.map((u) => u.text)).toEqual(["One."]);
    endCurrent();
    endCurrent();
    expect(spoken.map((u) => u.text)).toEqual(["One.", "Two.", "Three."]);
    expect(onEnd).not.toHaveBeenCalled();
    endCurrent();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("Pause keeps the place, Play resumes that sentence, and the cancel's end event does not advance", () => {
    const onEnd = vi.fn();
    speak("One. Two. Three.", onEnd);
    endCurrent(); // now on Two.
    pauseSpeaking(); // the engine fires onend for the cancelled utterance
    expect(spoken.map((u) => u.text)).toEqual(["One.", "Two."]);
    expect(onEnd).not.toHaveBeenCalled();
    expect(resumeSpeaking()).toBe(true);
    expect(spoken.map((u) => u.text)).toEqual(["One.", "Two.", "Two."]);
  });

  it("Next skips to the following sentence; past the last it ends", () => {
    const onEnd = vi.fn();
    speak("One. Two. Three.", onEnd);
    expect(nextSentence()).toBe(true);
    expect(spoken.map((u) => u.text)).toEqual(["One.", "Two."]);
    expect(nextSentence()).toBe(true);
    expect(spoken.map((u) => u.text)).toEqual(["One.", "Two.", "Three."]);
    expect(onEnd).not.toHaveBeenCalled();
    expect(nextSentence()).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(resumeSpeaking()).toBe(false); // nothing left to resume
  });

  it("Stop is an end: onEnd fires once and nothing resumes", () => {
    const onEnd = vi.fn();
    speak("One. Two.", onEnd);
    stopSpeaking();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(resumeSpeaking()).toBe(false);
    expect(spoken.map((u) => u.text)).toEqual(["One."]);
  });
});

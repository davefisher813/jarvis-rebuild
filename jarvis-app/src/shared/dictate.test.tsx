// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useRef, useState } from "react";
import Dictate, { DICTATION_HINT } from "./Dictate";
import { spokenInto, dictationErrorLine } from "./useDictation";

const showToast = vi.fn();
vi.mock("./toast", () => ({ showToast: (...a: unknown[]) => showToast(...a) }));

// A FAKE SpeechRecognition: the page's own, planted on window, so the hook
// feature-detects it and the test drives results and errors by hand.
class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = "";
  interimResults = false;
  continuous = false;
  started = 0;
  stopped = 0;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() { FakeRecognition.last = this; }
  start() { this.started++; }
  stop() { this.stopped++; this.onend?.(); }
  abort() { this.onend?.(); }
  say(words: string, final: boolean) {
    this.onresult?.({ resultIndex: 0, results: { length: 1, 0: { isFinal: final, length: 1, 0: { transcript: words } } } });
  }
  fail(code: string) { this.onerror?.({ error: code }); this.onend?.(); }
}

function plant() { (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRecognition; }
function unplant() {
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  delete w.SpeechRecognition; delete w.webkitSpeechRecognition;
}

// The draft the way QuickCapture holds it: spokenInto appends the phrase being
// said, replacing it until it settles, and typing clears the base.
function Harness({ onText }: { onText?: (t: string, f: boolean) => void } = {}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [text, setText] = useState("");
  const base = useRef<string | null>(null);
  return (
    <>
      <textarea ref={ref} aria-label="Message" value={text} onChange={(e) => { base.current = null; setText(e.target.value); }} />
      <Dictate target={ref} onText={onText ?? ((w, f) => setText((cur) => spokenInto(base, cur, w, f)))} />
    </>
  );
}

beforeEach(() => { showToast.mockReset(); localStorage.clear(); FakeRecognition.last = null; });
afterEach(() => { cleanup(); unplant(); });

describe("Speak, with dictation on the page", () => {
  it("a tap starts listening and says so; a second tap stops", () => {
    plant();
    render(<Harness />);
    const btn = screen.getByRole("button", { name: "Speak" });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(btn);
    const rec = FakeRecognition.last!;
    expect(rec.started).toBe(1);
    expect(rec.interimResults, "the words appear while they are said").toBe(true);
    expect(screen.getByRole("button", { name: "Listening" })).toHaveAttribute("aria-pressed", "true");
    expect(showToast, "no keyboard hint where the mic is real").not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Listening" }));
    expect(rec.stopped).toBe(1);
    expect(screen.getByRole("button", { name: "Speak" })).toBeInTheDocument();
  });

  it("the words land in the editable draft, interim then final, and nothing is committed", () => {
    plant();
    render(<Harness />);
    const box = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Dinner Thursday" } });
    fireEvent.click(screen.getByRole("button", { name: "Speak" }));
    const rec = FakeRecognition.last!;
    act(() => rec.say("with", false));
    expect(box.value).toBe("Dinner Thursday with");
    act(() => rec.say("with Marco", false));
    expect(box.value, "an interim replaces the last interim").toBe("Dinner Thursday with Marco");
    act(() => rec.say("with Marco at seven", true));
    expect(box.value).toBe("Dinner Thursday with Marco at seven");
    act(() => rec.say("tomorrow", false));
    expect(box.value, "the next phrase lands after the settled one").toBe("Dinner Thursday with Marco at seven tomorrow");
  });

  it("onText is called with the interim and then the final, in that order", () => {
    plant();
    const onText = vi.fn();
    render(<Harness onText={onText} />);
    fireEvent.click(screen.getByRole("button", { name: "Speak" }));
    act(() => FakeRecognition.last!.say("call", false));
    act(() => FakeRecognition.last!.say("call Alberto", true));
    expect(onText.mock.calls).toEqual([["call", false], ["call Alberto", true]]);
  });

  it("a denied microphone is SAID, in a line under the button", () => {
    plant();
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Speak" }));
    act(() => FakeRecognition.last!.fail("not-allowed"));
    expect(screen.getByRole("alert")).toHaveTextContent(dictationErrorLine("not-allowed"));
    expect(screen.getByRole("alert")).toHaveTextContent(/microphone/i);
    expect(screen.getByRole("button", { name: "Speak" }), "and the button is Speak again").toBeInTheDocument();
  });

  it("a recognition failure is said too, never swallowed", () => {
    plant();
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Speak" }));
    act(() => FakeRecognition.last!.fail("network"));
    expect(screen.getByRole("alert")).toHaveTextContent(dictationErrorLine("network"));
    // A fresh tap clears the line and listens again.
    fireEvent.click(screen.getByRole("button", { name: "Speak" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Listening" })).toBeInTheDocument();
  });
});

describe("Speak, where the page has no dictation", () => {
  it("focuses the field, which is what raises the keyboard, and says where the mic is EVERY time", () => {
    render(<Harness />);
    const btn = screen.getByRole("button", { name: "Speak" });
    expect(btn, "it is not a toggle here").not.toHaveAttribute("aria-pressed");
    fireEvent.click(btn);
    expect(document.activeElement).toBe(screen.getByLabelText("Message"));
    expect(showToast).toHaveBeenCalledWith({ message: DICTATION_HINT });
    fireEvent.click(btn);
    expect(showToast, "a button that does nothing is a dead button").toHaveBeenCalledTimes(2);
  });

  it("promises only what it does", () => {
    expect(DICTATION_HINT).toBe("Tap the Mic on Your Keyboard to Talk");
  });
});

describe("spokenInto", () => {
  it("joins with one space, replaces an interim, and lets a final go", () => {
    const held = { current: null as string | null };
    expect(spokenInto(held, "", "hello", false)).toBe("hello");
    expect(spokenInto(held, "hello", "hello there", false)).toBe("hello there");
    expect(spokenInto(held, "hello there", "hello there friend", true)).toBe("hello there friend");
    expect(held.current).toBeNull();
    expect(spokenInto(held, "A line ", "more", false)).toBe("A line more");
  });
});

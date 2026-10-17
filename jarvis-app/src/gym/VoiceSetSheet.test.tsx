// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import VoiceSetSheet from "./VoiceSetSheet";
import { voiceDraftStore } from "./sessionDrafts";
import { DICTATION_HINT } from "../shared/Dictate";
import type { SetEntry } from "./types";

// VOICE SET LOGGING, BUILT AS A TEST (the Logging Standard addendum 5; Alfred
// ruled 2026-10-17 on Dave's "Whatever is standard"): a deliberate phrase, a
// read-back, one confirming tap, and nothing logged without it.

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
}

const spoken: string[] = [];
class FakeUtterance { text: string; rate = 1; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(t: string) { this.text = t; } }

type W = { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown; speechSynthesis?: unknown; SpeechSynthesisUtterance?: unknown };
function plantSpeech() {
  const w = window as unknown as W;
  w.SpeechRecognition = FakeRecognition;
  w.SpeechSynthesisUtterance = FakeUtterance;
  w.speechSynthesis = { cancel: () => {}, speak: (u: FakeUtterance) => { spoken.push(u.text); } };
  (globalThis as unknown as W).SpeechSynthesisUtterance = FakeUtterance;
}
function unplant() {
  const w = window as unknown as W;
  delete w.SpeechRecognition; delete w.webkitSpeechRecognition; delete w.speechSynthesis; delete w.SpeechSynthesisUtterance;
  delete (globalThis as unknown as W).SpeechSynthesisUtterance;
}

const LAST: SetEntry = { id: "s1", w: 225, r: 5, state: "reported" };

function sheet(over: Partial<Parameters<typeof VoiceSetSheet>[0]> = {}) {
  const onLog = vi.fn();
  const onClose = vi.fn();
  render(<VoiceSetSheet name="Bench Press" kind="weight_reps" unit="lb" lastSet={LAST} onLog={onLog} onClose={onClose} {...over} />);
  return { onLog, onClose, field: screen.getByLabelText("Say or Type the Set") as HTMLInputElement };
}

beforeEach(() => { localStorage.clear(); spoken.length = 0; FakeRecognition.last = null; });
afterEach(() => { cleanup(); unplant(); });

describe("VoiceSetSheet: the field", () => {
  it("opens with the cursor in the field, so the keyboard's mic is one tap away", () => {
    const { field } = sheet();
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("enterkeyhint", "go");
    expect(field).toHaveAttribute("placeholder", "Log 225 for 5");
  });
});

describe("VoiceSetSheet: the read-back", () => {
  it("reads the set back as the words change, and the button stays off until it is a set", () => {
    const { field } = sheet();
    const btn = screen.getByRole("button", { name: "Log Set" });
    expect(btn).toBeDisabled();
    fireEvent.change(field, { target: { value: "225 for 5" } });
    expect(screen.getByText("Start With Log, Like Log 225 for 5")).toBeInTheDocument();
    expect(btn).toBeDisabled();
    fireEvent.change(field, { target: { value: "Log 230 for 5." } });
    expect(screen.getByRole("status")).toHaveTextContent("Log 230 Lb × 5 on Bench Press");
    expect(btn).toBeEnabled();
  });

  it("a row with nothing to say shows nothing: an empty field draws no line where Speak is real", () => {
    plantSpeech();
    sheet();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("VoiceSetSheet: he confirms, once", () => {
  it("one tap logs exactly one reported set with a fresh id, closing the sheet first", () => {
    const { field, onLog, onClose } = sheet();
    fireEvent.change(field, { target: { value: "Log 230 for 5" } });
    const btn = screen.getByRole("button", { name: "Log Set" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onLog).toHaveBeenCalledTimes(1);
    const entry = onLog.mock.calls[0]![0] as SetEntry;
    expect(entry).toMatchObject({ w: 230, r: 5, state: "reported" });
    expect(entry.id).toBeTruthy();
    expect(entry.id).not.toBe(LAST.id);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose.mock.invocationCallOrder[0]!, "the sheet is gone before the receipt is raised").toBeLessThan(onLog.mock.invocationCallOrder[0]!);
  });

  it("Return in the field is the confirm", () => {
    const { field, onLog } = sheet();
    fireEvent.change(field, { target: { value: "log same" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog.mock.calls[0]![0]).toMatchObject({ w: 225, r: 5, state: "reported" });
    expect((onLog.mock.calls[0]![0] as SetEntry).id).not.toBe(LAST.id);
  });

  it("nothing logs without the confirm: not a valid read-back, not a bare yes, not Return on words that are not a set", () => {
    const { field, onLog, onClose } = sheet();
    fireEvent.change(field, { target: { value: "Log 230 for 5" } });
    fireEvent.change(field, { target: { value: "yes" } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Log Set" }));
    fireEvent.change(field, { target: { value: "ok" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onLog).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onLog).not.toHaveBeenCalled();
  });
});

describe("VoiceSetSheet: speech", () => {
  it("Speak listens; a spoken set is read back aloud once, the mic closes, and still nothing logs until the tap", () => {
    plantSpeech();
    const { field, onLog } = sheet();
    fireEvent.click(screen.getByRole("button", { name: "Speak" }));
    const rec = FakeRecognition.last!;
    expect(rec.started).toBe(1);
    expect(screen.getByRole("button", { name: "Listening" })).toHaveAttribute("aria-pressed", "true");
    act(() => rec.say("Log 225", false));
    act(() => rec.say("Log 225", true));
    expect(spoken, "not a set yet, so nothing is said").toEqual([]);
    act(() => rec.say("for 5.", true));
    expect(field.value).toBe("Log 225 for 5.");
    expect(spoken).toEqual(["225 lb for 5, Bench Press"]);
    expect(rec.stopped, "the mic closes before the app speaks").toBe(1);
    expect(screen.getByRole("status")).toHaveTextContent("Log 225 Lb × 5 on Bench Press");
    expect(onLog).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Log Set" }));
    expect(onLog).toHaveBeenCalledTimes(1);
  });

  it("where the page has no speech, no dead Speak button: the line says where the mic is", () => {
    sheet();
    expect(screen.queryByRole("button", { name: "Speak" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(DICTATION_HINT);
  });
});

describe("VoiceSetSheet: the words survive a kill", () => {
  it("writes per keystroke, reads back on reopen, and the confirm spends it", () => {
    const scope = { startedAt: 1000, exerciseId: "bench" };
    const first = sheet({ draftScope: scope });
    fireEvent.change(first.field, { target: { value: "Log 230 for 4" } });
    expect(voiceDraftStore(1000, "bench").read()).toBe("Log 230 for 4");
    cleanup();
    const again = sheet({ draftScope: scope });
    expect(again.field.value).toBe("Log 230 for 4");
    fireEvent.keyDown(again.field, { key: "Enter" });
    expect(again.onLog).toHaveBeenCalledTimes(1);
    expect(voiceDraftStore(1000, "bench").read()).toBe("");
  });
});

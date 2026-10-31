// @vitest-environment jsdom
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import VoiceBar from "./VoiceBar";
import { barLinesFor, ROTATE_FOR } from "../capture/examples";

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); });

// THE SPEECH BOX'S FRONT DOOR (2026-10-31; amends "does not imply voice": voice is built now, recorded and transcribed on the
// server). Two doors in one pill: the words open typing, the mic opens it recording.
describe("VoiceBar", () => {
  it("the words open typing and the mic opens recording", () => {
    const onTap = vi.fn();
    const onMic = vi.fn();
    render(<VoiceBar onTap={onTap} onMic={onMic} />);
    fireEvent.click(screen.getByRole("button", { name: "Quick capture" }));
    expect(onTap).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Voice capture" }));
    expect(onMic).toHaveBeenCalledTimes(1);
  });

  it("with no recording door, there is no mic", () => {
    render(<VoiceBar onTap={() => {}} />);
    expect(screen.queryByRole("button", { name: "Voice capture" })).toBeNull();
  });
});

// THE DOCK IS ONE LINE (Dave 2026-10-05, the perfect bar), and its words are an example of what to say on this screen.
describe("VoiceBar, one line", () => {
  it("one Title Case line, no wordmark, and the screen's own kind of thing first", () => {
    const { container } = render(<VoiceBar screen="schedule" onTap={() => {}} onMic={() => {}} onSearch={() => {}} onWhatNow={() => {}} />);
    const bar = container.querySelector(".voice-bar")!;
    expect(bar.querySelector(".voice-name")).toBeNull();
    expect(bar.querySelector(".voice-hint")!.textContent).toBe(barLinesFor("schedule")[0]);
    expect(barLinesFor("schedule")[0]).toBe("Dinner at 7 PM");
    expect(barLinesFor("money")[0]).toBe("Spent $42 on Gas");
  });

  it("rotates every four seconds for the first twenty captures, then stands still", () => {
    vi.useFakeTimers();
    const { container, unmount } = render(<VoiceBar screen="today" onTap={() => {}} />);
    const hint = () => container.querySelector(".voice-hint")!.textContent;
    const first = hint();
    act(() => { vi.advanceTimersByTime(4000); });
    expect(hint()).not.toBe(first);
    unmount();
    localStorage.setItem("jarvis.capture.count.v1", String(ROTATE_FOR));
    const later = render(<VoiceBar screen="today" onTap={() => {}} />);
    const still = later.container.querySelector(".voice-hint")!.textContent;
    act(() => { vi.advanceTimersByTime(12000); });
    expect(later.container.querySelector(".voice-hint")!.textContent).toBe(still);
  });

  it("every bar line is short enough to fit the pill without losing a character", () => {
    for (const s of ["today", "schedule", "life", "money", "notes", "brain", "more", "messages"]) {
      for (const l of barLinesFor(s)) expect(l.length, l).toBeLessThanOrEqual(16);
    }
  });

  it("the bolt and the search are the same object: one class, no accent variant", () => {
    const { container } = render(<VoiceBar onTap={() => {}} onSearch={() => {}} onWhatNow={() => {}} />);
    const round = [...container.querySelectorAll("button.voice-search")];
    expect(round.map((b) => b.getAttribute("aria-label"))).toEqual(["What should I do now", "Search everything"]);
    expect(round.every((b) => b.className === "voice-search")).toBe(true);
  });
});

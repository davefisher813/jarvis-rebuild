// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import VoiceBar from "./VoiceBar";

describe("VoiceBar", () => {
  it("opens capture on tap and does not imply voice", () => {
    const onTap = vi.fn();
    render(<VoiceBar onTap={onTap} />);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(btn.getAttribute("aria-label")).toBe("Quick capture");
  });
});

// THE DOCK IS ONE LINE (Dave 2026-10-05, the perfect bar: "JARVIS" sat top-left and a lowercase "Add anything" dropped to
// the bottom right of a 72px pill, and the two round buttons were different objects by theme).
describe("VoiceBar, one line", () => {
  it("is the disc and one Title Case placeholder: no wordmark beside it, no lowercase hint", () => {
    const { container } = render(<VoiceBar onTap={() => {}} onSearch={() => {}} onWhatNow={() => {}} />);
    const bar = container.querySelector(".voice-bar")!;
    expect(bar.querySelector(".voice-name")).toBeNull();
    expect(bar.textContent).toBe("Add Anything");
    expect(bar.querySelector(".voice-hint")!.textContent).toBe("Add Anything");
    expect(bar.children.length).toBe(2); // the disc and the hint, nothing else to stagger
  });

  it("the bolt and the search are the same object: one class, no accent variant", () => {
    const { container } = render(<VoiceBar onTap={() => {}} onSearch={() => {}} onWhatNow={() => {}} />);
    const round = [...container.querySelectorAll("button.voice-search")];
    expect(round.map((b) => b.getAttribute("aria-label"))).toEqual(["What should I do now", "Search everything"]);
    expect(round.every((b) => b.className === "voice-search")).toBe(true);
  });
});

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

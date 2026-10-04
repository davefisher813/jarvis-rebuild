// @vitest-environment jsdom
// SHELL-F-26 (2026-09-05): About said "Version 1.0" on every build ever made,
// while Settings > Advanced showed the real build stamp two taps away. The
// row is also the door to the test bench, so it had to keep taking taps.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import AboutPage from "./AboutPage";

describe("AboutPage", () => {
  it("names the build it is actually running, not a frozen 1.0", () => {
    render(<AboutPage onBack={() => {}} />);
    expect(screen.queryByText("Version 1.0")).not.toBeInTheDocument();
    expect(screen.getByText(/^Build /)).toBeInTheDocument();
  });

  it("still opens the test bench on the fifth tap", () => {
    const onSecret = vi.fn();
    render(<AboutPage onBack={() => {}} onSecret={onSecret} />);
    const stamp = screen.getByText(/^Build /);
    for (let i = 0; i < 5; i++) fireEvent.click(stamp);
    expect(onSecret).toHaveBeenCalledTimes(1);
  });

  // Slice 09 QA (2026-10-04): the build line is a full control now: a button
  // role, a tab stop, and Enter or Space count as a tap.
  it("the build line is a real control: button role, focusable, and five Enters open the door", () => {
    const onSecret = vi.fn();
    render(<AboutPage onBack={() => {}} onSecret={onSecret} />);
    const line = screen.getByRole("button", { name: /^Build / });
    expect(line).toHaveClass("about-build");
    expect(line).toHaveAttribute("tabindex", "0");
    for (let i = 0; i < 5; i++) fireEvent.keyDown(line, { key: "Enter" });
    expect(onSecret).toHaveBeenCalledTimes(1);
  });
});

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
});

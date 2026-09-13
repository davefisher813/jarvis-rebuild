// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import RestTimer from "./RestTimer";

// H-18 (Health Push B, 2026-09-12): +30s, offered only while the rest runs.
afterEach(() => cleanup());

describe("RestTimer +30s", () => {
  it("offers +30s while resting and hands the extension to the caller", () => {
    const onExtend = vi.fn();
    render(<RestTimer endsAt={Date.now() + 90_000} onDismiss={() => {}} onExtend={onExtend} />);
    fireEvent.click(screen.getByRole("button", { name: "+30s" }));
    expect(onExtend).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Skip Rest" })).toBeInTheDocument();
  });
  it("offers nothing to extend once the rest is over", () => {
    render(<RestTimer endsAt={Date.now() - 1_000} onDismiss={() => {}} onExtend={() => {}} />);
    expect(screen.queryByRole("button", { name: "+30s" })).toBeNull();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });
});

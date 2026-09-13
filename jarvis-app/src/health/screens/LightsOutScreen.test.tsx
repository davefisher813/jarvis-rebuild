// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import LightsOutScreen from "./LightsOutScreen";

// Health Push D, H-41 (2026-09-12): Edit Time on the last bedtime.
const AT = new Date("2026-09-12T23:40:00").getTime();

describe("LightsOutScreen: Edit Time", () => {
  it("writes the clock on the same night, and nothing else", () => {
    const onEditTime = vi.fn();
    render(<LightsOutScreen last={{ id: "l1", data: { category: "sleep", at: AT } }} onLog={() => {}} onEditTime={onEditTime} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Time" }));
    fireEvent.change(screen.getByLabelText("Bedtime time"), { target: { value: "23:15" } });
    expect(onEditTime).toHaveBeenCalledWith("l1", new Date("2026-09-12T23:15:00").getTime());
  });

  it("offers no Edit Time on a row still on its way to the store, or without a seam", () => {
    const { rerender } = render(<LightsOutScreen last={{ id: "pending-0", pending: true, data: { category: "sleep", at: AT } }} onLog={() => {}} onEditTime={() => {}} onBack={() => {}} />);
    expect(screen.queryByRole("button", { name: "Edit Time" })).not.toBeInTheDocument();
    rerender(<LightsOutScreen last={{ id: "l1", data: { category: "sleep", at: AT } }} onLog={() => {}} onBack={() => {}} />);
    expect(screen.queryByRole("button", { name: "Edit Time" })).not.toBeInTheDocument();
  });

  it("the tap still logs, and there is still no duration anywhere on the screen", () => {
    const onLog = vi.fn();
    const { container } = render(<LightsOutScreen last={null} onLog={onLog} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Lights Out" }));
    expect(onLog).toHaveBeenCalled();
    expect(container.textContent).not.toMatch(/hours|duration|slept/i);
  });
});

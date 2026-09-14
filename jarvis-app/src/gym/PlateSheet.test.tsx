// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import PlateSheet from "./PlateSheet";

// 2026-09-14 (the reference's plate calculator): the plates per side for a
// total that includes the bar, and the nearest when the rack cannot build it.
const rack = { bar: 45, plates: [45, 25, 10, 5, 2.5], unit: "lb" as const };
describe("PlateSheet", () => {
  it("says what goes on each side, and steps the total by the smallest pair", () => {
    render(<PlateSheet total={135} unit="lb" rack={rack} onClose={() => {}} />);
    expect(screen.getByText("45")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More Total weight" }));
    expect(screen.getAllByText("45").length).toBeGreaterThan(0);
    expect(screen.getByText("2.5")).toBeInTheDocument();
  });
  it("closes on Back to Workout", () => {
    const onClose = vi.fn();
    render(<PlateSheet total={45} unit="lb" rack={rack} onClose={onClose} />);
    expect(screen.getByText("Just the bar")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Back to Workout"));
    expect(onClose).toHaveBeenCalled();
  });
});

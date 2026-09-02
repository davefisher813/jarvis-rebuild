// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import ExerciseSheet from "./ExerciseSheet";

// THE CLOCK ON THE SHEET (2026-09-02). A format turns the strip into a
// clock: the kind follows the format, the strip goes away, the cap is
// built from the parts.
describe("ExerciseSheet, the clock", () => {
  it("AMRAP: scores rounds, hides the strip, saves a 12:00 window", () => {
    const onSave = vi.fn();
    render(<ExerciseSheet mode="new" library={[]} history={[]} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/e\.g\./i), { target: { value: "Cindy" } });
    expect(screen.getByText("What You Track")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "AMRAP" }));
    expect(screen.queryByText("What You Track")).toBeNull();
    expect(screen.getByText("AMRAP · 12:00")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/^Save|^Add/));
    expect(onSave).toHaveBeenCalledTimes(1);
    const d = onSave.mock.calls[0]![0];
    expect(d.kind).toBe("rounds");
    expect(d.sets).toEqual([]);
    expect(d.cond).toEqual({ format: "amrap", capSec: 720 });
  });
  it("Tabata: eight rounds of 0:20 / 0:10 make a 4:00 cap", () => {
    const onSave = vi.fn();
    render(<ExerciseSheet mode="new" library={[]} history={[]} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/e\.g\./i), { target: { value: "Bike" } });
    fireEvent.click(screen.getByRole("button", { name: "Tabata" }));
    expect(screen.getByText("Tabata · 8 × 0:20 / 0:10")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/^Save|^Add/));
    expect(onSave.mock.calls[0]![0].cond).toEqual({ format: "tabata", capSec: 240, intervalSec: 20, restSec: 10, rounds: 8 });
  });
  it("For Time: scores time in seconds", () => {
    const onSave = vi.fn();
    render(<ExerciseSheet mode="new" library={[]} history={[]} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/e\.g\./i), { target: { value: "Fran" } });
    fireEvent.click(screen.getByRole("button", { name: "For Time" }));
    fireEvent.click(screen.getByText(/^Save|^Add/));
    const d = onSave.mock.calls[0]![0];
    expect(d.kind).toBe("time_faster");
    expect(d.unit).toBe("sec");
    expect(d.cond).toEqual({ format: "for_time", capSec: 720 });
  });
});

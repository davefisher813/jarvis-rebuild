// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import LiftGoalSheet from "./LiftGoalSheet";

// GYM-F-20 (2026-09-05): "Touch 30" on Vertical Jump saved with the target
// stepper untouched, and the card read "0 In -- hit it" at 100% while the
// next session's receipt celebrated a Goal Hit. Double-tapping Save made two
// goals out of one.

const base = {
  exercise: "Vertical Jump", kind: "height" as const, unit: "in",
  healthCategoryIds: [], onCancel: () => {},
};

const typeTitle = (text: string) =>
  fireEvent.change(screen.getByPlaceholderText("e.g. Vertical Jump Target"), { target: { value: text } });

describe("LiftGoalSheet", () => {
  it("refuses a zero target and says which number is missing", () => {
    const onSave = vi.fn();
    render(<LiftGoalSheet {...base} onSave={onSave} />);
    typeTitle("Touch 30");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Set a target above zero.")).toBeInTheDocument();
  });

  it("saves once the target is a real number", () => {
    const onSave = vi.fn();
    render(<LiftGoalSheet {...base} onSave={onSave} />);
    typeTitle("Touch 30");
    fireEvent.click(screen.getByRole("button", { name: "More Target" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const measure = onSave.mock.calls[0]![0].measure;
    expect(measure.kind).toBe("lift");
    expect(measure.target.v).toBeGreaterThan(0);
  });

  it("a second tap on Save makes no second goal", () => {
    const onSave = vi.fn();
    render(<LiftGoalSheet {...base} onSave={onSave} />);
    typeTitle("Touch 30");
    fireEvent.click(screen.getByRole("button", { name: "More Target" }));
    const save = screen.getByRole("button", { name: "Save" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("a title alone is still not a goal, and an empty title still says so", () => {
    const onSave = vi.fn();
    render(<LiftGoalSheet {...base} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Add a goal.")).toBeInTheDocument();
  });
});

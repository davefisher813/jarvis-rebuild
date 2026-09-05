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

  // GYM-F-28 (2026-09-05): `initial` and `onDelete` had been on this sheet
  // since it was written and no caller ever passed them, so a lift goal set
  // here could only be changed from Bigger Picture. GymFlow passes both now.
  it("opens on an existing goal as an edit, with its numbers already in", () => {
    const onSave = vi.fn();
    render(<LiftGoalSheet {...base} onSave={onSave}
      initial={{ title: "Touch 30", measure: { kind: "lift", exercise: "Vertical Jump", measureKind: "height", target: { v: 30 }, unit: "in" } }} />);
    expect(screen.getByText("Edit Goal")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. Vertical Jump Target")).toHaveValue("Touch 30");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]![0].measure.target.v).toBe(30);
  });

  it("Delete Goal takes two taps, because a deleted goal does not come back", () => {
    const onDelete = vi.fn();
    render(<LiftGoalSheet {...base} onSave={() => {}} onDelete={onDelete}
      initial={{ title: "Touch 30" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Goal" }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Tap Again to Delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("says nothing about deleting when the caller cannot delete", () => {
    render(<LiftGoalSheet {...base} onSave={() => {}} />);
    expect(screen.queryByRole("button", { name: "Delete Goal" })).toBeNull();
  });

  it("a title alone is still not a goal, and an empty title still says so", () => {
    const onSave = vi.fn();
    render(<LiftGoalSheet {...base} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Add a goal.")).toBeInTheDocument();
  });
});

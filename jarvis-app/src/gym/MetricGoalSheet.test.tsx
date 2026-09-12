// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import MetricGoalSheet from "./MetricGoalSheet";

// Dave's ask 2026-09-12: a goal option wherever the data is entered. This is
// the metric side of D12-A/C's lift goal, set from the metric's own log
// sheet rather than a generic dashboard button.

const base = {
  metricId: "m1", metricName: "Bodyweight", unit: "lb",
  healthCategoryIds: [], onCancel: () => {},
};

const typeTitle = (text: string) =>
  fireEvent.change(screen.getByPlaceholderText("e.g. Bodyweight Target"), { target: { value: text } });

describe("MetricGoalSheet", () => {
  it("defaults the target to today's own reading, and Bring Down", () => {
    const onSave = vi.fn();
    render(<MetricGoalSheet {...base} currentValue={190} onSave={onSave} />);
    expect(screen.getByRole("button", { name: "Bring Down" })).toHaveClass("active");
    typeTitle("Cut to 170");
    fireEvent.click(screen.getByRole("button", { name: "Less Target" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const measure = onSave.mock.calls[0]![0].measure;
    expect(measure.kind).toBe("metric");
    expect(measure.direction).toBe("down");
    expect(measure.target).toBe(189);
    // Today's reading is stamped as the baseline a fresh goal measures from.
    expect(measure.startValue).toBe(190);
  });

  it("refuses a zero target and says which number is missing", () => {
    const onSave = vi.fn();
    render(<MetricGoalSheet {...base} onSave={onSave} />);
    typeTitle("Cut to 170");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Set a target above zero.")).toBeInTheDocument();
  });

  it("Raise Up is the other direction, chosen explicitly", () => {
    const onSave = vi.fn();
    render(<MetricGoalSheet {...base} unit="reps" onSave={onSave} />);
    typeTitle("20 reps");
    fireEvent.click(screen.getByRole("button", { name: "Raise Up" }));
    fireEvent.click(screen.getByRole("button", { name: "More Target" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0]![0].measure.direction).toBe("up");
  });

  it("a second tap on Save makes no second goal", () => {
    const onSave = vi.fn();
    render(<MetricGoalSheet {...base} currentValue={190} onSave={onSave} />);
    typeTitle("Cut to 170");
    const save = screen.getByRole("button", { name: "Save" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("opens on an existing goal as an edit, with its numbers already in and the baseline untouched", () => {
    const onSave = vi.fn();
    render(<MetricGoalSheet {...base} currentValue={182}
      initial={{ title: "Cut to 170", measure: { kind: "metric", metricId: "m1", metricName: "Bodyweight", unit: "lb", direction: "down", target: 170, startValue: 190 } }}
      onSave={onSave} />);
    expect(screen.getByText("Edit Goal")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. Bodyweight Target")).toHaveValue("Cut to 170");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const measure = onSave.mock.calls[0]![0].measure;
    expect(measure.target).toBe(170);
    // 182 is today's reading, but this goal already has a start -- editing
    // must not silently reset it to the day it happened to be reopened.
    expect(measure.startValue).toBe(190);
  });

  it("Delete Goal takes two taps, because a deleted goal does not come back", () => {
    const onDelete = vi.fn();
    render(<MetricGoalSheet {...base} onSave={() => {}} onDelete={onDelete}
      initial={{ title: "Cut to 170" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Goal" }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Tap Again to Delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("says nothing about deleting when the caller cannot delete", () => {
    render(<MetricGoalSheet {...base} onSave={() => {}} />);
    expect(screen.queryByRole("button", { name: "Delete Goal" })).toBeNull();
  });

  it("a title alone is still not a goal, and an empty title still says so", () => {
    const onSave = vi.fn();
    render(<MetricGoalSheet {...base} currentValue={190} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Add a goal.")).toBeInTheDocument();
  });
});

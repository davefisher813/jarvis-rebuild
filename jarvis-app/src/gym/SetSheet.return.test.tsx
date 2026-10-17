// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import SetSheet from "./SetSheet";
import { fieldsFor } from "./measures";
import type { SetEntry } from "./types";

// THE SET SHEET UNDER THE LOGGING STANDARD (2026-10-17). Rule 4: Return in a
// field is the Save button. Addendum 1: a logged set saved by hand is
// reported; a planned set has not happened and carries no state.

afterEach(() => cleanup());

const sheet = (entry: SetEntry, planned = false) => {
  const onSave = vi.fn();
  render(<SetSheet title="Set 2" kind="weight_reps" fields={fieldsFor("weight_reps", { unit: "lb" })} entry={entry} moveTracking planned={planned}
    onSave={onSave} onCancel={() => {}} />);
  return onSave;
};

describe("SetSheet: Return saves", () => {
  it("Return in the weight field saves what both fields say, and the key says Go", () => {
    const onSave = sheet({ id: "s1", w: 225, r: 5 });
    const weight = screen.getByLabelText("Set 2 weight");
    expect(weight).toHaveAttribute("enterkeyhint", "go");
    fireEvent.change(weight, { target: { value: "230" } });
    fireEvent.keyDown(weight, { key: "Enter" });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]![0]).toMatchObject({ w: 230, r: 5 });
  });
  it("Return in the reps field saves too", () => {
    const onSave = sheet({ id: "s1", w: 225, r: 5 });
    const reps = screen.getByLabelText("Set 2 reps");
    fireEvent.change(reps, { target: { value: "6" } });
    fireEvent.keyDown(reps, { key: "Enter" });
    expect(onSave.mock.calls[0]![0]).toMatchObject({ w: 225, r: 6 });
  });
});

describe("SetSheet: the state stamp", () => {
  it("a logged set saved here is reported", () => {
    const onSave = sheet({ id: "s1", w: 225, r: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0]![0].state).toBe("reported");
  });
  it("a planned set carries no state: it has not happened", () => {
    const onSave = sheet({ id: "p2", w: 225, r: 5 }, true);
    fireEvent.change(screen.getByLabelText("Set 2 weight"), { target: { value: "230" } });
    fireEvent.keyDown(screen.getByLabelText("Set 2 weight"), { key: "Enter" });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]![0]).toEqual({ w: 230, r: 5 });
  });
});

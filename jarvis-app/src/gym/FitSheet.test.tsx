// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import FitSheet from "./FitSheet";
import type { ProgramDay } from "./types";
import { DEFAULT_GYM_SETTINGS, rackFrom } from "./settings";

const DEFAULT_RACK = rackFrom(DEFAULT_GYM_SETTINGS);

// A PICK, NOT A COMPLETION (Dave 2026-10-16, T, the colour code: green is
// done). The Doing Today list wore the task checkbox and its done green on
// every lift before a set was logged, so a plan read as finished. The mark is
// the picker's own neutral Picked chip; green waits for the work.

const day: ProgramDay = {
  id: "d1", name: "Push",
  exercises: [
    { id: "e1", name: "Bench Press", kind: "weight_reps", sets: [{ id: "s1", w: 185, r: 5 }, { id: "s2", w: 185, r: 5 }] },
    { id: "e2", name: "Dips", kind: "weight_reps", sets: [{ id: "s3", r: 12 }] },
  ],
};

describe("FitSheet: Doing Today", () => {
  it("marks a picked lift with the neutral chip and never with the done check", () => {
    render(<FitSheet day={day} history={[]} rack={DEFAULT_RACK} onStart={() => {}} onCancel={() => {}} />);
    expect(document.querySelector(".task-check"), "no completion checkbox before any work").toBeNull();
    expect(document.querySelector(".done"), "nothing reads as done").toBeNull();
    const bench = screen.getByRole("checkbox", { name: /Bench Press, doing today/ });
    expect(bench.querySelector(".chip")).toHaveClass("active");
    expect(bench.querySelector(".chip")).toHaveTextContent("Picked");
  });

  it("unticking a lift drops the mark and keeps the last one on", () => {
    render(<FitSheet day={day} history={[]} rack={DEFAULT_RACK} onStart={() => {}} onCancel={() => {}} />);
    const bench = screen.getByRole("checkbox", { name: /Bench Press/ });
    fireEvent.click(bench);
    expect(screen.getByRole("checkbox", { name: /Bench Press, not today/ }).querySelector(".chip")).not.toHaveClass("active");
    expect(screen.getByRole("checkbox", { name: /Bench Press, not today/ }).querySelector(".chip")).toHaveTextContent("Pick");
    // The last lift on cannot be unticked: a workout you did not do is not a workout.
    fireEvent.click(screen.getByRole("checkbox", { name: /Dips/ }));
    expect(screen.getByRole("checkbox", { name: /Dips, doing today/ })).toBeInTheDocument();
  });
});

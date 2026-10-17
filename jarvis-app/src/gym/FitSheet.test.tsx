// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import FitSheet from "./FitSheet";
import type { ProgramDay } from "./types";
import { DEFAULT_GYM_SETTINGS, rackFrom } from "./settings";

const DEFAULT_RACK = rackFrom(DEFAULT_GYM_SETTINGS);

// DOING TODAY, AS THE BOARD DRAWS IT (Dave's approved mockup board,
// 2026-10-16, screen 3): the day and its planned length as the title, the
// lifts numbered in program order with no check and no green before any work,
// the length pills with one red outline, the levers as switch rows, the fit
// line as plain text, then Start and Cancel.

const day: ProgramDay = {
  id: "d1", name: "Push Day", coolDown: [{ id: "c1", name: "Stretch" }], coolDownMin: 5,
  exercises: [
    { id: "e1", name: "Bench", kind: "weight_reps", unit: "lb", sets: [{ id: "s1", w: 275, r: 5 }, { id: "s2", w: 275, r: 5 }, { id: "s3", w: 275, r: 5 }] },
    { id: "e2", name: "Dips", kind: "weight_reps", sets: [{ id: "s4", r: 8 }] },
  ],
};

describe("FitSheet: the board's order and marks", () => {
  it("title, the numbered list, the length pills, the levers, the fit line, Start and Cancel, in that order", () => {
    render(<FitSheet day={day} history={[]} rack={DEFAULT_RACK} onStart={() => {}} onCancel={() => {}} />);
    const html = document.body.innerHTML;
    const at = (needle: string) => { const i = html.indexOf(needle); expect(i, needle).toBeGreaterThan(-1); return i; };
    expect(at('class="fit-title"')).toBeLessThan(at('class="fit-no"'));
    expect(at('class="fit-no"')).toBeLessThan(at(">How Long Do You Have<"));
    expect(at(">How Long Do You Have<")).toBeLessThan(at('role="switch"'));
    expect(at('role="switch"')).toBeLessThan(at('class="fit-line"'));
    expect(at('class="fit-line"')).toBeLessThan(at(">Start · "));
    expect(at(">Start · ")).toBeLessThan(at(">Cancel<"));
    expect(screen.getByText(/^Push Day · Plan /)).toHaveClass("fit-title");
    expect(screen.getByText("2 Exercises, in Program Order")).toHaveClass("fact");
  });

  it("marks a picked lift with its number and never with a check or the done green", () => {
    render(<FitSheet day={day} history={[]} rack={DEFAULT_RACK} onStart={() => {}} onCancel={() => {}} />);
    expect(document.querySelector(".task-check"), "no completion checkbox before any work").toBeNull();
    expect(document.querySelector(".done, .lime, .chip-lime"), "nothing reads as done").toBeNull();
    const bench = screen.getByRole("checkbox", { name: /Bench, doing today/ });
    expect(bench.querySelector(".fit-no")).toHaveTextContent("1");
    expect(bench.querySelector(".fit-no")).not.toHaveClass("off");
    expect(bench.querySelector(".conn-meta")).toHaveTextContent("275 Lb × 5");
    expect(screen.getByRole("checkbox", { name: /Dips, doing today/ }).querySelector(".fit-no")).toHaveTextContent("2");
  });

  it("unticking a lift dims and strikes its badge and greys the row; the last one on cannot be unticked", () => {
    render(<FitSheet day={day} history={[]} rack={DEFAULT_RACK} onStart={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Bench/ }));
    const off = screen.getByRole("checkbox", { name: /Bench, not today/ });
    expect(off).toHaveClass("fit-row-off");
    expect(off.querySelector(".fit-no")).toHaveClass("off");
    expect(off.querySelector(".conn-name")).toHaveClass("fit-off");
    fireEvent.click(screen.getByRole("checkbox", { name: /Dips/ }));
    expect(screen.getByRole("checkbox", { name: /Dips, doing today/ })).toBeInTheDocument();
    // The fit line counts what is picked.
    expect(screen.getByText("1 of 2 Exercises")).toBeInTheDocument();
  });

  it("the length pills: one selected, outlined, nothing filled; the levers wear the board's words", () => {
    render(<FitSheet day={day} history={[]} rack={DEFAULT_RACK} onStart={() => {}} onCancel={() => {}} />);
    const pills = [...document.querySelectorAll(".fit-time .chip")];
    expect(pills.map((p) => p.textContent)).toEqual(["30 Min", "45 Min", "1h", "No Cap"]);
    expect(pills.filter((p) => p.classList.contains("active")).map((p) => p.textContent)).toEqual(["No Cap"]);
    fireEvent.click(screen.getByRole("button", { name: "45 Min" }));
    expect(pills.filter((p) => p.classList.contains("active")).map((p) => p.textContent)).toEqual(["45 Min"]);
    // The cool-down lever reads as Keep, on by default, with its one grey line.
    const keep = screen.getByText("Keep Warm-Up & Cool-Down").closest(".row")!;
    expect(keep.querySelector('[role="switch"]')).toHaveAttribute("aria-checked", "true");
    expect(keep.querySelector(".conn-meta")).toHaveTextContent("Counts Toward Your Time");
    // The fit line is plain text with bold values and no pill.
    const line = document.querySelector(".fit-line")!;
    expect(line.querySelector(".pill, .pill-act, .se-chip")).toBeNull();
    expect(line.querySelectorAll("b").length).toBeGreaterThanOrEqual(2);
    expect(line.textContent).toMatch(/^Fits:/);
    expect(line.textContent).toContain("All 2 Exercises");
  });
});

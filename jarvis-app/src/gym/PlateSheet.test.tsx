// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import PlateSheet from "./PlateSheet";
import type { LoadStyle } from "./equipment";

// 2026-09-14 (the reference's plate calculator): the plates per side for a
// total that includes the bar, and the nearest when the rack cannot build it.
//
// REBUILT 2026-09-16 (Dave: "the plate calculator has to factor in all of the
// weight loading options not just dumbbells"). It answers in the terms of the
// hardware now, so the cases below are one per kind of hardware.
const rack = { bar: 45, plates: [45, 25, 10, 5, 2.5], unit: "lb" as const };
const barbell: LoadStyle = { equipment: "barbell", counted: "total" };
const machine: LoadStyle = { equipment: "machine", counted: "total" };
const dumbbell: LoadStyle = { equipment: "dumbbell", counted: "each_hand" };
const stack: LoadStyle = { equipment: "stack", counted: "total" };

describe("PlateSheet", () => {
  it("says what goes on each side, and steps the total by the smallest pair", () => {
    render(<PlateSheet total={135} unit="lb" rack={rack} style={barbell} onClose={() => {}} />);
    expect(screen.getByText("45")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More Weight" }));
    expect(screen.getAllByText("45").length).toBeGreaterThan(0);
    expect(screen.getByText("2.5")).toBeInTheDocument();
  });

  it("closes on Back to Workout", () => {
    const onClose = vi.fn();
    render(<PlateSheet total={45} unit="lb" rack={rack} style={barbell} onClose={onClose} />);
    expect(screen.getByText("Just the Bar")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Back to Workout"));
    expect(onClose).toHaveBeenCalled();
  });

  // A TOTAL UNDER THE BAR IS NOT A LOADED BAR (Dave photographed 35 lb reading
  // "Includes the 45 lb bar / Just the bar").
  it("refuses to call a weight under the bar a loaded bar", () => {
    render(<PlateSheet total={35} unit="lb" rack={rack} style={barbell} onClose={() => {}} />);
    expect(screen.getByText("The Bar Alone Is 45 Lb")).toBeInTheDocument();
    expect(screen.queryByText("Just the Bar")).toBeNull();
  });

  // A PLATE-LOADED MACHINE HAS NO 45 TO TAKE OFF. Its spec has said
  // plates: true, hasBar: false since it was written; the sheet subtracted a
  // barbell's bar from it anyway, which put every machine out by a bar.
  it("subtracts no bar on a plate-loaded machine", () => {
    render(<PlateSheet total={90} unit="lb" rack={rack} style={machine} onClose={() => {}} />);
    // 90 with no bar is 45 a side, not the 22.5 a barbell reading would give.
    expect(screen.getByText("45")).toBeInTheDocument();
    expect(screen.queryByText(/Includes the/)).toBeNull();
  });

  it("totals the pair for a dumbbell instead of halving it", () => {
    render(<PlateSheet total={50} unit="lb" rack={rack} style={dumbbell} onClose={() => {}} />);
    expect(screen.getByText("100 Lb Moved")).toBeInTheDocument();
    expect(screen.getByText("2 × 50 Lb")).toBeInTheDocument();
    expect(screen.queryByText("On Each Side")).toBeNull();
  });

  it("finds the pin on a stack", () => {
    render(<PlateSheet total={100} unit="lb" rack={rack} style={stack} onClose={() => {}} />);
    expect(screen.getByText("A Pin at 100 Lb")).toBeInTheDocument();
  });

  // The weight opens the sheet, so each case needs its own mount: the total is
  // a useState initializer and a rerender cannot move it.
  it("says so when the number falls between notches", () => {
    render(<PlateSheet total={95} unit="lb" rack={rack} style={stack} onClose={() => {}} />);
    expect(screen.getByText("This Stack Steps in 10 Lb")).toBeInTheDocument();
    expect(screen.getByText("Nearest Pin 100")).toBeInTheDocument();
  });
});

// THE CATALOG, CHECKED ON WHAT THE SHEET DRAWS (Dave 2026-10-05, "45 min v 45
// Min"): every fact and meta line is Title Case, and a unit behind a number is a
// word with a capital ("45 Lb"). These lines were written in sentence case with
// a lowercase unit.
describe("PlateSheet: the catalog (2026-10-05)", () => {
  const SMALL = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);
  const lowercaseWords = (el: Element) => (el.textContent ?? "").split(/\s+/).slice(1).filter((w) => /^[a-z]{2,}$/.test(w) && !SMALL.has(w));
  const lines = () => Array.from(document.querySelectorAll(".fact, .conn-meta"));

  const cases: Array<[string, number, object]> = [
    ["a loaded bar", 135, barbell],
    ["the bar alone", 45, barbell],
    ["under the bar", 35, barbell],
    ["a dumbbell pair", 50, dumbbell],
    ["a pin on a stack", 100, stack],
    ["between notches", 95, stack],
  ];
  for (const [name, total, style] of cases) {
    it(name + ": every fact and meta line is Title Case, units capitalized", () => {
      render(<PlateSheet total={total} unit="lb" rack={rack} style={style as never} onClose={() => {}} />);
      expect(lines().length).toBeGreaterThan(0);
      for (const l of lines()) expect(lowercaseWords(l), l.textContent ?? "").toEqual([]);
    });
  }
});

// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import CatChipLine, { chipArea } from "./CatChipLine";
import { setCategoryRegistry } from "./categories";

// THE UNIFIED CHIP (Dave 2026-10-09, the pass-off, item 14): the area as a small chip in its own colour with the words that
// belong beside it right next to it, one piece for task rows and note rows. A row with no area shows no chip at all.
describe("CatChipLine", () => {
  beforeAll(() => setCategoryRegistry([{ id: "w", name: "Work", color: "blue" }, { id: "x", name: "Legacy", color: "red" }]));

  it("draws the chip first and the words right after it, in one line fact", () => {
    const { container } = render(<div className="r-k"><CatChipLine category="w" text="Kitchen Remodel" /></div>);
    const line = container.querySelector(".r-k > .r-goal.r-parent")!;
    expect([...line.children].map((c) => c.className)).toEqual(["cat-chip cat-fg-blue", "r-goal-t"]);
    expect(line.querySelector(".cat-chip")).toHaveTextContent("Work");
    expect(line.querySelector(".r-goal-t")).toHaveTextContent("Kitchen Remodel");
  });

  it("no area: no chip, the words stand alone", () => {
    const { container } = render(<CatChipLine category="" text="Kitchen Remodel" />);
    expect(container.querySelector(".cat-chip")).toBeNull();
    expect(container.textContent).toBe("Kitchen Remodel");
    // An id the registry cannot name is no area either: a chip never shows an id.
    const { container: c2 } = render(<CatChipLine category="0b8c1d2e-1111-2222-3333-444455556666" text="Garage" />);
    expect(c2.querySelector(".cat-chip")).toBeNull();
  });

  it("an area with no words is the chip alone, and nothing at all draws nothing", () => {
    const { container } = render(<CatChipLine category="w" />);
    expect(container.querySelector(".r-goal-t")).toBeNull();
    expect(container.querySelector(".cat-chip")).toHaveTextContent("Work");
    const { container: empty } = render(<CatChipLine category={null} text="   " />);
    expect(empty.innerHTML).toBe("");
  });

  it("a note's first line is his own sentence, so the casing check leaves it as written", () => {
    const { container } = render(<CatChipLine category="w" text="3 tents and tables" sentence />);
    expect(container.querySelector(".r-goal-t")).toHaveAttribute("data-sentence");
    const { container: task } = render(<CatChipLine category="w" text="Kitchen Remodel" />);
    expect(task.querySelector(".r-goal-t")).not.toHaveAttribute("data-sentence");
  });

  it("a category never wears the action red: a legacy red area chips in orange", () => {
    expect(chipArea("x")).toEqual({ name: "Legacy", slot: "orange" });
    expect(chipArea(undefined)).toBeNull();
  });
});

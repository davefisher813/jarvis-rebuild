// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Quiet } from "./quiet";

// What the component emphasizes, as a list of the strings it wrapped in .qd.
const lit = (s: string, heat: "warm" | "hot" | null = null): string[] => {
  const { container } = render(<Quiet s={s} heat={heat} />);
  return Array.from(container.querySelectorAll(".qd")).map((e) => e.textContent ?? "");
};

describe("what counts as data", () => {
  it("lights the numbers the line is actually about", () => {
    expect(lit("61 Days")).toEqual(["61"]);
    expect(lit("Left 28m ago")).toEqual(["28m"]);
    expect(lit("3/16 done")).toEqual(["3/16"]);
    expect(lit("until 1:00 PM")).toEqual(["1:00"]);
    expect(lit("Slid 3d")).toEqual(["3d"]);
    expect(lit("90% there")).toEqual(["90%"]);
    // Unfused, so the figure lights and the loose unit stays prose. The house
    // form is "45m"; this is what a producer that forgot looks like.
    expect(lit("about 45 min")).toEqual(["45"]);
  });

  // THE BUG (Dave's screenshot, 2026-08-24). Both of these lit up like live
  // data on the home screen.
  it("leaves a number that is part of an identifier alone", () => {
    expect(lit("Missing Items From Order #D2565")).toEqual([]);
    expect(lit("Order A1 shipped")).toEqual([]);
    expect(lit("Route 66 diner")).toEqual(["66"]); // standalone: still data
  });

  it("leaves an ordinal date alone", () => {
    expect(lit("Friday, August 28th")).toEqual([]);
    expect(lit("the 1st of the month")).toEqual([]);
    expect(lit("2nd try")).toEqual([]);
  });

  it("still lights a fused unit, which is the house form", () => {
    expect(lit("59d")).toEqual(["59d"]);
    expect(lit("2h left")).toEqual(["2h"]);
  });

  it("handles a line with both kinds at once", () => {
    expect(lit("Order #D2565 · 61 Days")).toEqual(["61"]);
    expect(lit("Due August 28th · 3 left")).toEqual(["3"]);
  });

  it("passes heat through to the data only", () => {
    const { container } = render(<Quiet s="61 Days" heat="hot" />);
    expect(container.querySelector(".qd-hot")?.textContent).toBe("61");
  });

  it("returns the string untouched when there is nothing to light", () => {
    const { container } = render(<Quiet s="Nothing needs you" />);
    expect(container.querySelectorAll(".qd").length).toBe(0);
    expect(container.textContent).toBe("Nothing needs you");
  });

  it("never loses or reorders a character", () => {
    for (const s of [
      "Order #D2565 · 61 Days", "Friday, August 28th", "3/16 done",
      "Left 28m ago", "90% there", "2nd try", "until 1:00 PM",
    ]) {
      const { container } = render(<Quiet s={s} />);
      expect(container.textContent).toBe(s);
    }
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Quiet } from "./quiet";

// What the component emphasizes, as a list of the strings it wrapped in .qd.
const lit = (s: string): string[] => {
  const { container } = render(<Quiet s={s} />);
  return Array.from(container.querySelectorAll(".qd")).map((e) => e.textContent ?? "");
};
/** The data this line marks HOT (a count of days that has slipped: red). */
const hot = (s: string): string[] => {
  const { container } = render(<Quiet s={s} />);
  return Array.from(container.querySelectorAll(".qd-hot")).map((e) => e.textContent ?? "");
};
/** The data this line marks SOON (a count of days still running: amber). */
const soon = (s: string): string[] => {
  const { container } = render(<Quiet s={s} />);
  return Array.from(container.querySelectorAll(".qd-soon")).map((e) => e.textContent ?? "");
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

  // A DAY COUNT IS THE ONE HOT DATUM (Dave 2026-09-21, on two rows of one
  // card: "One is red. The other isn't. They should both be red and all
  // instances"). It was the producer's call on the producer's own rungs, so
  // the same number was red in one row, plain in the next and amber on
  // another screen. It is a rule about the shape of the datum now, which is
  // the only kind that can reach inside a sentence a model wrote.
  //
  // UPDATED 2026-09-26 (Dave's pick, the Colour Key): every count of days
  // still takes a colour, but the colour follows the way it runs. Slipped
  // (an age) is late, red; forward ("3 days left", "in 5 days") is needs
  // you soon, amber. A count is one or the other, never both.
  it("makes every count of days that has slipped hot, in both forms", () => {
    expect(hot("61 Days")).toEqual(["61"]);
    expect(hot("Invoice \u00b7 84 Days")).toEqual(["84"]);
    expect(hot("Slid 3d")).toEqual(["3d"]);
    expect(hot("59d waiting")).toEqual(["59d"]);
    expect(hot("Overdue by 4 days")).toEqual(["4"]);
    expect(soon("61 Days")).toEqual([]);
  });

  it("makes a count of days that runs forward amber, not red", () => {
    expect(soon("Mailchimp trial ends, 3 days left")).toEqual(["3"]);
    expect(hot("Mailchimp trial ends, 3 days left")).toEqual([]);
    expect(soon("Renews in 5 days")).toEqual(["5"]);
    expect(soon("Ends in 3d")).toEqual(["3d"]);
    expect(soon("3d to go")).toEqual(["3d"]);
    expect(soon("12 days remaining")).toEqual(["12"]);
    expect(soon("Due within 2 days")).toEqual(["2"]);
    // "in" must touch the figure: a count that merely sits in a sentence
    // with "in" earlier on is still an age.
    expect(hot("Sat in drafts 9 days")).toEqual(["9"]);
  });

  it("leaves every other datum cool", () => {
    expect(hot("Left 28m ago")).toEqual([]);
    expect(hot("2h left")).toEqual([]);
    expect(hot("3/16 done")).toEqual([]);
    expect(hot("until 1:00 PM")).toEqual([]);
    expect(hot("90% there")).toEqual([]);
    expect(hot("about 45 min")).toEqual([]);
    // "3 left" is not a count of days, whatever is left.
    expect(hot("Due August 28th \u00b7 3 left")).toEqual([]);
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

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import GoalRowRuled from "./GoalRowRuled";

// THE CHECK-IN WEARS WHAT IT SAYS (§AM, 2026-09-26). It was green whatever
// it said, so "Behind" read as good news. A check-in is one of three words
// (checkin.ts): ahead and on track are green, behind is amber. Anything
// else stays a plain fact.
const checkinOn = (checkin: string) => {
  const { container } = render(
    <GoalRowRuled title="Run a Half" tone="cat-fg-green" body="" status={null} bar={null} checkin={checkin} />,
  );
  const el = container.querySelector(".goal-sub .fact") as HTMLElement;
  expect(el).toHaveProperty("textContent", "Check-in: " + checkin);
  return el;
};

describe("GoalRowRuled check-in", () => {
  it("is green when ahead or on track", () => {
    for (const w of ["Ahead", "On Track"]) {
      const el = checkinOn(w);
      expect(el.classList.contains("good")).toBe(true);
      expect(el.classList.contains("warn")).toBe(false);
    }
  });

  it("is amber when behind", () => {
    const el = checkinOn("Behind");
    expect(el.classList.contains("warn")).toBe(true);
    expect(el.classList.contains("good")).toBe(false);
  });

  it("stays a plain fact for a word that is not a check-in", () => {
    for (const w of ["Unsure", "Off Track"]) {
      const el = checkinOn(w);
      for (const t of ["good", "warn", "red"]) expect(el.classList.contains(t)).toBe(false);
      expect(el.className).toBe("r-goal fact");
    }
  });

  it("is absent while a status capsule speaks for the goal", () => {
    const { container } = render(
      <GoalRowRuled title="Run a Half" tone="cat-fg-green" body="1 of 4 Done" status={{ text: "On Track", tone: "good" }} bar={null} checkin="Behind" />,
    );
    expect(container.querySelector(".goal-sub .fact")).toBeNull();
  });
});

// A FINISHED GOAL'S DATE IS A NEUTRAL DATE (§AM F5, 2026-09-26). The Done
// capsule carries the meaning, so "Finished September 12" is small caps in
// the row's grey. It went through the measure line's number bolding, so the
// day read as a white count inside a grey date.
describe("GoalRowRuled finish date", () => {
  it("draws the date as a .fact.date with nothing bolded", () => {
    const { container } = render(
      <GoalRowRuled title="Run a Half" tone="cat-fg-green" body="" when="Finished September 12" status={{ text: "Done", tone: "good" }} bar={null} />,
    );
    const meter = container.querySelector(".goal-meter") as HTMLElement;
    const date = meter.querySelector(".fact.date");
    expect(date?.textContent).toBe("Finished September 12");
    expect(meter.querySelector("b")).toBeNull();
    expect(meter.querySelector(".gstat")?.textContent).toBe("Done");
  });

  it("keeps the measure line's numbers bold when there is no date", () => {
    const { container } = render(
      <GoalRowRuled title="Run a Half" tone="cat-fg-green" body="1 of 4 Done" status={null} bar={null} />,
    );
    const meter = container.querySelector(".goal-meter") as HTMLElement;
    expect(meter.querySelector(".fact.date")).toBeNull();
    expect(meter.querySelector("b")?.textContent).toBe("1");
  });
});

// CLEAN ROWS (Dave 2026-10-05, locked: "Clean rows, no pills anywhere"). A goal with nothing under it used to offer
// Add a Project as a capsule on its row. A row with nothing to say shows nothing; the goal's own page holds the
// Add Project primary, and the row is the door to it.
describe("GoalRowRuled has no pill", () => {
  it("a goal with nothing under it draws its title and nothing else", () => {
    const { container } = render(<GoalRowRuled title="learn spanish" tone="cat-fg-green" body="" status={null} bar={null} onOpen={() => {}} />);
    expect(container.querySelectorAll(".pill-act, .row-act, .btn-sm, .quiet-action")).toHaveLength(0);
    expect(container.querySelector(".goal-meter")).toBeNull();
    expect(container.querySelector(".task-name")).toHaveTextContent("Learn Spanish");
    expect(container.querySelector(".chev")).not.toBeNull();
  });

  it("the next milestone is shown in Title Case", () => {
    const { container } = render(<GoalRowRuled title="Apartment" tone="cat-fg-green" body="" status={null} bar={null} next="hang art in hallway" />);
    expect(container.querySelector(".r-next-v")).toHaveTextContent("Hang Art in Hallway");
  });
});

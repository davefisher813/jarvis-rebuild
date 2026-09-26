// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import GoalRowRuled from "./GoalRowRuled";

// THE CHECK-IN WEARS WHAT IT SAYS (§AM, 2026-09-26). It was green whatever
// it said, so "Behind" read as good news. On track is green, behind is
// amber, off track red; a word outside the key stays a plain fact.
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

  it("is amber when behind or at risk", () => {
    for (const w of ["Behind", "At Risk"]) {
      const el = checkinOn(w);
      expect(el.classList.contains("warn")).toBe(true);
      expect(el.classList.contains("good")).toBe(false);
    }
  });

  it("is red when off track or missed", () => {
    for (const w of ["Off Track", "Missed"]) {
      expect(checkinOn(w).classList.contains("red")).toBe(true);
    }
  });

  it("stays a plain fact for a word with no meaning in the key", () => {
    const el = checkinOn("Unsure");
    for (const t of ["good", "warn", "red", "est"]) expect(el.classList.contains(t)).toBe(false);
    expect(el.className).toBe("r-goal fact");
  });

  it("is absent while a status capsule speaks for the goal", () => {
    const { container } = render(
      <GoalRowRuled title="Run a Half" tone="cat-fg-green" body="1 of 4 Done" status={{ text: "On Track", tone: "good" }} bar={null} checkin="Behind" />,
    );
    expect(container.querySelector(".goal-sub .fact")).toBeNull();
  });
});

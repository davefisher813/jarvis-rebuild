// The decision list anatomy (Dave 2026-08-18 styling pass): the linked
// home renders as a colored fact in the sub line, the recorded date rides
// the name line, and long decision sentences wrap instead of truncating.
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useEffect } from "react";
import { NotesProvider, useDecisions } from "../data/NotesProvider";
import DecisionsFlow from "./DecisionsFlow";

function Seed() {
  const svc = useDecisions();
  useEffect(() => {
    void svc.create({
      decision: "Student template ships before the other two are even started",
      why: "Northlake gives 60 warm leads on day one",
      linkedType: "project",
      linkedId: "p1",
      linkedLabel: "Rebuild Bridge App",
    });
  }, [svc]);
  return null;
}

describe("Decision list anatomy", () => {
  it("renders the linked home as a colored fact with a date in the name line", async () => {
    const { container } = render(
      <NotesProvider userId="u-dec-list"><Seed /><DecisionsFlow onBack={() => {}} /></NotesProvider>,
    );
    await waitFor(() => expect(screen.getByText("Rebuild Bridge App")).toBeInTheDocument());
    expect(screen.getByText("Rebuild Bridge App").className).toContain("fact-link");
    expect(container.querySelector(".dec-when")).toBeInTheDocument();
    // Long decision sentences wrap (two-line clamp) rather than truncating.
    const name = container.querySelector(".dec-name");
    expect(name).toBeInTheDocument();
    expect(name!.textContent).toContain("Student template ships");
  });
});

// ONE LINE, LIKE EVERY OTHER EMPTY STATE (Dave 2026-09-03, pic 1: "too much
// subtext"). This state ran two full sentences over three lines while its
// siblings run one short line each. The count is the point: a sub that has
// to be read twice is not an empty state, it is a paragraph on an empty
// screen.
describe("the empty state", () => {
  it("offers the payoff in one short line, not two sentences", async () => {
    render(<NotesProvider userId="u-dec-empty"><DecisionsFlow onBack={() => {}} /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Worth Remembering")).toBeInTheDocument());
    const sub = screen.getByText(/reason is still here/);
    expect(sub.textContent).toBe("The reason is still here in six weeks");
    expect(sub.textContent!.trim().split(/\s+/).length, "one line's worth").toBeLessThanOrEqual(9);
    expect(sub.textContent, "one sentence, so no full stop mid-line").not.toMatch(/\.\s/);
    expect(screen.getByText("Record a Decision")).toBeInTheDocument();
  });
});

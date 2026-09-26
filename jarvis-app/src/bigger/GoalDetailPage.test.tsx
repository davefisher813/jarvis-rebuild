// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import GoalDetailPage from "./GoalDetailPage";
import type { Goal } from "../life/types";
import type { GoalReach } from "./reach";

// LIFE-F-27 (2026-09-05): the dropped line promised "The reason is in your
// decisions" whether or not a decision had been written. The drop marks the
// goal even when the decision write came back empty, and then the page sent
// you looking for a record that is not there.

const EMPTY: GoalReach = { filedIds: [], taggedIds: [], openTagged: 0, progress: null };

function view(goal: Goal) {
  render(
    <GoalDetailPage
      goal={goal}
      reach={EMPTY}
      projects={[]}
      nextActionTextOf={() => null}
      onBack={() => {}}
      onEdit={() => {}}
      onOpenProject={() => {}}
      onAddProject={() => {}}
    />,
  );
}

describe("a dropped goal's line (LIFE-F-27)", () => {
  // §AM (2026-09-26): the date is a small-caps fact of its own and the
  // pointer is the line under it, never joined by a typed middle dot.
  it("points at the decision when there is one", () => {
    view({ id: "g1", data: { title: "Half marathon", state: "on_track", dropped: { on: "2026-08-14", decisionId: "d1" } } });
    expect(screen.getByText("Dropped Aug 14")).toHaveClass("fact", "date");
    expect(screen.getByText("The reason is in your decisions")).toBeInTheDocument();
    expect(screen.queryByText(/\u00b7/)).toBeNull();
  });

  it("says only the date when no decision was written", () => {
    view({ id: "g2", data: { title: "Half marathon", state: "on_track", dropped: { on: "2026-08-14" } } });
    expect(screen.getByText("Dropped Aug 14")).toBeInTheDocument();
    expect(screen.queryByText(/reason is in your decisions/)).not.toBeInTheDocument();
  });
});

// C-36 and C-37 (Astra, 2026-09-12).
describe("the goal page's milestones and check-in", () => {
  it("asks how it is going only when nothing can be measured, and says the last answer back", () => {
    const onCheckin = vi.fn();
    render(
      <GoalDetailPage
        goal={{ id: "g", data: { title: "Build massive recruiting network", state: "on_track" } }}
        reach={EMPTY} projects={[]} health="unmeasured"
        checkin={{ word: "on_track", on: "2026-09-03" }} onCheckin={onCheckin}
        nextActionTextOf={() => null} onBack={() => {}} onEdit={() => {}} onOpenProject={() => {}} onAddProject={() => {}}
      />,
    );
    expect(screen.getByText("How Is This Going?")).toBeInTheDocument();
    // The answer is the pressed pill; the line under the pills says when,
    // as a small-caps date (§AM, 2026-09-26).
    expect(screen.getByText("On Track")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Checked in Sep 3")).toHaveClass("fact", "date");
    // Unmeasured is not a status, so the hero draws no "No Measure" (§AK).
    expect(screen.queryByText("No Measure")).toBeNull();
    fireEvent.click(screen.getByText("Behind"));
    expect(onCheckin).toHaveBeenCalledWith("behind");
  });

  it("never asks once a measure exists", () => {
    render(
      <GoalDetailPage
        goal={{ id: "g", data: { title: "Read 12 books", state: "on_track", measure: { kind: "count", target: 12 } } }}
        reach={EMPTY} projects={[]} health="on_track" onCheckin={() => {}}
        nextActionTextOf={() => null} onBack={() => {}} onEdit={() => {}} onOpenProject={() => {}} onAddProject={() => {}}
      />,
    );
    expect(screen.queryByText("How Is This Going?")).toBeNull();
  });

  it("lists milestones with the next one first and its Done, and adds one from the row", () => {
    const onDone = vi.fn(); const onAdd = vi.fn();
    render(
      <GoalDetailPage
        goal={{ id: "g", data: { title: "Make apartment aesthetic", state: "on_track", measure: { kind: "milestones", items: [
          { id: "a", text: "Pick a paint color", done: "2026-09-01" }, { id: "b", text: "Finish bedroom" }, { id: "c", text: "Hang art in hallway" },
        ] } } }}
        reach={EMPTY} projects={[]} health="on_track" moving={2}
        onMilestoneDone={onDone} onAddMilestone={onAdd}
        nextActionTextOf={() => null} onBack={() => {}} onEdit={() => {}} onOpenProject={() => {}} onAddProject={() => {}}
      />,
    );
    expect(screen.getByText("Next Milestone")).toBeInTheDocument();
    // The head says it is next; the row does not say it again (§AK).
    expect(screen.queryByText("Up Next")).toBeNull();
    // A count with no state is white: bold inside its fact (§AM).
    expect(screen.getByText("2 Projects").tagName).toBe("B");
    fireEvent.click(screen.getByText("Done"));
    expect(onDone).toHaveBeenCalledWith("b", true);
    expect(screen.getAllByRole("checkbox").length).toBe(3);
    fireEvent.click(screen.getByText("Add Milestone"));
    fireEvent.change(screen.getByPlaceholderText(/The next step/), { target: { value: "Buy lamps" } });
    fireEvent.keyDown(screen.getByPlaceholderText(/The next step/), { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith("Buy lamps");
  });
});

// THE HERO'S ONE GREY (§AK and §AM, 2026-09-26).
describe("the goal hero", () => {
  const base = { nextActionTextOf: () => null, onBack: () => {}, onEdit: () => {}, onOpenProject: () => {}, onAddProject: () => {} };

  it("draws the pace as the date alone, in the key's colour, not a second grey", () => {
    const { container } = render(
      <GoalDetailPage {...base}
        goal={{ id: "g", data: { title: "Read 12 books", state: "on_track", measure: { kind: "count", target: 12 }, by: "2026-10-01" } }}
        reach={EMPTY} projects={[]} health="behind"
        measure={{ done: 4, target: 12, pct: 33, met: false, line: "4 of 12 Done" }}
        pace={{ when: "Past its date", tone: "red" }}
      />,
    );
    expect(screen.getByText("Past its date")).toHaveClass("fact", "red");
    expect(container.querySelectorAll(".proj-detail-hero .bp-sub").length).toBe(1);
    expect(container.querySelector(".proj-detail-hero")?.textContent).not.toMatch(/\u00b7/);
  });

  it("a finished goal with no filed record does not say Done under its Done", () => {
    const { container } = render(
      <GoalDetailPage {...base}
        goal={{ id: "g", data: { title: "Get health insurance", state: "achieved" } }}
        reach={EMPTY} projects={[]} health="done"
      />,
    );
    expect(screen.getAllByText("Done").length).toBe(1);
    expect(container.querySelector(".proj-detail-hero .bp-sub")).toBeNull();
  });

  it("a dollar goal with nothing saved says the zero in the amount's own shape", () => {
    render(
      <GoalDetailPage {...base}
        goal={{ id: "g", data: { title: "Emergency fund", state: "on_track", moneyTarget: 2000 } }}
        reach={EMPTY} projects={[]}
      />,
    );
    expect(screen.getByText("$0 of $2,000 Saved")).toBeInTheDocument();
  });
});

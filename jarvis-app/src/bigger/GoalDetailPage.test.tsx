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
  it("points at the decision when there is one", () => {
    view({ id: "g1", data: { title: "Half marathon", state: "on_track", dropped: { on: "2026-08-14", decisionId: "d1" } } });
    expect(screen.getByText("Dropped Aug 14 · The reason is in your decisions")).toBeInTheDocument();
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
    expect(screen.getByText(/Last check-in · On Track/)).toBeInTheDocument();
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
    expect(screen.getByText("2 Projects")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Done"));
    expect(onDone).toHaveBeenCalledWith("b", true);
    expect(screen.getAllByRole("checkbox").length).toBe(3);
    fireEvent.click(screen.getByText("Add Milestone"));
    fireEvent.change(screen.getByPlaceholderText(/The next step/), { target: { value: "Buy lamps" } });
    fireEvent.keyDown(screen.getByPlaceholderText(/The next step/), { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith("Buy lamps");
  });
});

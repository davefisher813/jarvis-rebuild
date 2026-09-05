// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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

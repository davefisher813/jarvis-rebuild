// @vitest-environment jsdom
// A ROUND FINISHED IS FINISHED (issue #115, seen 2026-10-18): Finish Round with holes left blank read Keep Scoring.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ScorecardView } from "./PageViews";
import { newScorecardPage, setScore, takeSnapshot } from "./pageModel";

afterEach(cleanup);
const noop = () => {};
const draw = (page: ReturnType<typeof newScorecardPage>) =>
  render(<ScorecardView page={page} onHole={noop} onPlayer={noop} onAddPlayer={noop} onCourse={noop} onHoles={noop} onDate={noop} />);

describe("the scorecard's head action", () => {
  const start = newScorecardPage({ course: "Pine Valley", holes: 9, players: ["Dave"], date: "2026-11-02" });
  const played = setScore(start, start.records[0]!.id, 1, 5);
  it("a fresh round starts at hole 1, a round in progress keeps scoring", () => {
    draw(start); expect(screen.getByRole("button", { name: "Start Hole 1" })).toBeInTheDocument(); cleanup();
    draw(played); expect(screen.getByRole("button", { name: "Keep Scoring" })).toBeInTheDocument();
  });
  it("a round finished with holes left blank reads Review Holes, never Keep Scoring", () => {
    draw(takeSnapshot(played, "finish", Date.now()));
    expect(screen.getByRole("button", { name: "Review Holes" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Keep Scoring" })).toBeNull();
  });
  it("another kind of snapshot does not finish a round", () => {
    draw(takeSnapshot(played, "manual", Date.now()));
    expect(screen.getByRole("button", { name: "Keep Scoring" })).toBeInTheDocument();
  });
});

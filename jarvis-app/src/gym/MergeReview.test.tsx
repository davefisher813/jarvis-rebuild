// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MergeReviewSheet } from "./DuplicateReview";
import type { LibraryRow } from "./libraryEdit";
import { EMPTY_CLASS, type Classification } from "./classify";
import type { MergePlan, MergeState } from "./merge";

// THE REVIEW SHEET (handoff §5, steps 1 to 8). What the sheet itself is
// responsible for: showing both exercises in full, letting the survivor be
// swapped, resolving conflicts explicitly, and -- the two that were broken --
// a pending state that cannot be double-submitted, and a failure that stays on
// screen with a Retry instead of quietly claiming success.

const row = (over: Partial<LibraryRow> = {}): LibraryRow => ({
  key: "k", name: "Bench Press", kind: "weight_reps", sessions: 9, sets: 30,
  lastDate: "2026-09-08", firstDate: "2026-05-01", hidden: false, ...over,
});

const c = (over: Partial<Classification> = {}): Classification => ({ ...EMPTY_CLASS, ...over });

const plan = (over: Partial<MergePlan> = {}): MergePlan => ({
  keep: { row: row({ key: "b", name: "Bench Press" }), classification: c({ primary: ["chest"], equipment: "barbell" }) },
  fold: { row: row({ key: "a", name: "Bench", sessions: 1, sets: 3, firstDate: "2026-08-01" }), classification: c({ primary: ["shoulders"], equipment: "smith" }) },
  patch: { workouts: [{ id: "w1", exercises: [] }], programs: [] },
  inverse: { workouts: [{ id: "w1", exercises: [] }], programs: [] },
  sessions: 1, programDays: 1, sets: 3, goals: [], survivorKey: "kb", signature: "sig",
  ...over,
});

const state = (over: Partial<MergeState> = {}): MergeState => ({ plan: plan(), stage: "reviewing", take: [], applied: 0, ...over });

const noop = { onSwap: () => {}, onTake: () => {}, onMerge: () => {}, onCancel: () => {} };

describe("the review shows both exercises in full", () => {
  it("names both, with their record counts, dates and equipment", () => {
    render(<MergeReviewSheet {...noop} state={state()} />);
    expect(screen.getByText("Keeping")).toBeInTheDocument();
    expect(screen.getByText("Folding In")).toBeInTheDocument();
    expect(screen.getByText("Bench Press")).toHaveClass("dup-name");
    expect(screen.getByText("Bench")).toHaveClass("dup-name");
    expect(screen.getByText("9 sessions, 30 sets")).toBeInTheDocument();
    expect(screen.getByText("1 session, 3 sets")).toBeInTheDocument();
    // Each equipment reads twice: once on its own side, once in the conflict
    // row that asks which of the two the merged exercise keeps.
    expect(screen.getAllByText("Barbell")).toHaveLength(2);
    expect(screen.getAllByText("Smith Machine")).toHaveLength(2);
  });

  it("says the folded name stays searchable", () => {
    render(<MergeReviewSheet {...noop} state={state()} />);
    expect(screen.getByText("This name becomes a searchable alias")).toBeInTheDocument();
  });

  it("summarises what moves", () => {
    render(<MergeReviewSheet {...noop} state={state()} />);
    expect(screen.getByText("1 session, 3 sets, 1 program day")).toBeInTheDocument();
  });

  it("offers the other exercise as the survivor instead", () => {
    const onSwap = vi.fn();
    render(<MergeReviewSheet {...noop} onSwap={onSwap} state={state()} />);
    fireEvent.click(screen.getByRole("button", { name: "Keep Bench Instead" }));
    expect(onSwap).toHaveBeenCalled();
  });
});

describe("conflicts are resolved explicitly", () => {
  it("lists only the fields where both sides answered differently", () => {
    render(<MergeReviewSheet {...noop} state={state()} />);
    expect(screen.getByText("Conflicts")).toBeInTheDocument();
    expect(screen.getByText("Primary Muscles")).toBeInTheDocument();
    expect(screen.getByText("Equipment")).toBeInTheDocument();
    expect(screen.queryByText("Movement Pattern")).toBeNull();
  });

  it("has no conflict section when only one side ever answered", () => {
    const p = plan({
      keep: { row: row({ key: "b", name: "Bench Press" }), classification: c({ primary: ["chest"] }) },
      fold: { row: row({ key: "a", name: "Bench" }), classification: c() },
    });
    render(<MergeReviewSheet {...noop} state={state({ plan: p })} />);
    expect(screen.queryByText("Conflicts")).toBeNull();
  });

  it("hands the field up when the other answer is chosen", () => {
    const onTake = vi.fn();
    render(<MergeReviewSheet {...noop} onTake={onTake} state={state()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Use Bench" })[0]!);
    expect(onTake).toHaveBeenCalledWith("primary");
  });
});

describe("pending cannot be double-submitted", () => {
  it("merges on one tap and says so", () => {
    const onMerge = vi.fn();
    render(<MergeReviewSheet {...noop} onMerge={onMerge} state={state()} />);
    expect(screen.getByRole("button", { name: "Merge Exercises" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Merge Exercises" }));
    expect(onMerge).toHaveBeenCalledTimes(1);
  });

  it("refuses every further tap while the write is in flight", () => {
    const onMerge = vi.fn();
    render(<MergeReviewSheet {...noop} onMerge={onMerge} state={state({ stage: "pending" })} />);
    const btn = screen.getByRole("button", { name: "Merging" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onMerge).not.toHaveBeenCalled();
  });

  it("cannot be cancelled or swapped out from under a write in flight", () => {
    const onCancel = vi.fn();
    const onSwap = vi.fn();
    render(<MergeReviewSheet {...noop} onCancel={onCancel} onSwap={onSwap} state={state({ stage: "pending" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep Bench Instead" }));
    expect(onSwap).not.toHaveBeenCalled();
  });
});

describe("a failure stays on screen", () => {
  it("says it failed, says what landed, and says both exercises are intact", () => {
    render(<MergeReviewSheet {...noop} state={state({ stage: "failed", applied: 0 })} />);
    expect(screen.getByText("Merge Failed")).toBeInTheDocument();
    expect(screen.getByText("Nothing was changed, both exercises are exactly as they were")).toBeInTheDocument();
  });

  it("offers Retry rather than pretending it worked", () => {
    const onMerge = vi.fn();
    render(<MergeReviewSheet {...noop} onMerge={onMerge} state={state({ stage: "failed", applied: 0 })} />);
    expect(screen.queryByRole("button", { name: "Merge Exercises" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onMerge).toHaveBeenCalledTimes(1);
  });

  it("keeps the pair on screen so the review item is not lost, and counts what is left", () => {
    const p = plan({ patch: { workouts: [{ id: "w1", exercises: [] }, { id: "w2", exercises: [] }], programs: [{ id: "p1", weeks: [] }] } });
    render(<MergeReviewSheet {...noop} state={state({ plan: p, stage: "failed", applied: 1 })} />);
    expect(screen.getByText("Bench")).toBeInTheDocument();
    expect(screen.getByText("Bench Press")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 saved and nothing was deleted, Retry finishes the rest")).toBeInTheDocument();
  });
});

describe("the sheet is a sheet", () => {
  it("opens over the page rather than inside it", () => {
    const { container } = render(<MergeReviewSheet {...noop} state={state()} />);
    expect(document.body.querySelector(".sheet-scrim")).not.toBeNull();
    expect(container.querySelector(".sheet-scrim")).toBeNull();
  });
});

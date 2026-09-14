// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import LibraryPage from "./LibraryPage";
import type { LibraryRow } from "./libraryEdit";

// Dave, 2026-09-14: "the exercise page edit button doesn't work."
//
// It always fired. It rendered its card INLINE, after the list, after the
// floor line and after Show Hidden -- so on a real library it opened
// thousands of pixels below the fold and nothing appeared to happen. jsdom
// has no viewport, which is exactly why the old tests passed through it.
// These pin the shape that cannot have the bug: the editor is portaled to
// document.body, over the page, the way every other sheet in this folder is.

const row = (over: Partial<LibraryRow> = {}): LibraryRow => ({
  key: "bench", name: "Bench Press", kind: "weight_reps", sessions: 4, lastDate: "2026-09-08", hidden: false, ...over,
});

const many = Array.from({ length: 40 }, (_, i) => row({ key: `k${i}`, name: `Lift ${i}` }));

const base = { todayIso: "2026-09-12", onOpen: () => {}, onRename: () => {}, onMerge: () => {}, onToggleHidden: () => {} };

describe("LibraryPage: Edit opens over the page, not below it", () => {
  it("portals the editor out of the scrolling list", () => {
    const { container } = render(<LibraryPage {...base} rows={many} onBack={() => {}} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
    const scrim = document.body.querySelector(".sheet-scrim");
    expect(scrim).not.toBeNull();
    // The thing that was broken: it must NOT be a child of the page, because
    // a child of the page is a child of the scroller.
    expect(container.querySelector(".sheet-scrim")).toBeNull();
    expect(screen.getByLabelText("Lift Name")).toHaveValue("Lift 0");
  });

  it("renames from the sheet bar and closes", () => {
    const onRename = vi.fn();
    render(<LibraryPage {...base} rows={[row()]} onRename={onRename} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Lift Name"), { target: { value: "Barbell Bench Press" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onRename).toHaveBeenCalledWith(row(), "Barbell Bench Press");
    expect(document.body.querySelector(".sheet-scrim")).toBeNull();
  });

  it("closes without renaming when the name was not touched", () => {
    const onRename = vi.fn();
    render(<LibraryPage {...base} rows={[row()]} onRename={onRename} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onRename).not.toHaveBeenCalled();
  });
});

describe("LibraryPage: muscles per lift", () => {
  it("is absent without the wiring, and tags the lift with it", () => {
    const onSetMuscles = vi.fn();
    const { rerender } = render(<LibraryPage {...base} rows={[row()]} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByText("What it works")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    rerender(<LibraryPage {...base} rows={[row()]} muscles={{}} onSetMuscles={onSetMuscles} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText("Untagged lifts are left out of Weekly Volume")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Chest" }));
    expect(onSetMuscles).toHaveBeenCalledWith(row(), ["chest"]);
  });

  it("adds a second muscle rather than replacing the first, and untags on a second tap", () => {
    const onSetMuscles = vi.fn();
    const { rerender } = render(
      <LibraryPage {...base} rows={[row()]} muscles={{ bench: ["chest"] }} onSetMuscles={onSetMuscles} onBack={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Triceps" }));
    expect(onSetMuscles).toHaveBeenCalledWith(row(), ["chest", "triceps"]);
    fireEvent.click(screen.getByRole("button", { name: "Chest" }));
    expect(onSetMuscles).toHaveBeenLastCalledWith(row(), []);
    rerender(<LibraryPage {...base} rows={[row()]} muscles={{ bench: ["chest"] }} onSetMuscles={onSetMuscles} onBack={() => {}} />);
    // And the row itself says what it is tagged with, which nothing did before.
    expect(screen.getAllByText("Chest").length).toBeGreaterThan(0);
  });
});

describe("LibraryPage: same lift, two names", () => {
  const forked = [
    row({ key: "a", name: "Bench", sessions: 1 }),
    row({ key: "b", name: "Bench Press", sessions: 9 }),
  ];

  it("is absent without the wiring", () => {
    render(<LibraryPage {...base} rows={forked} onBack={() => {}} />);
    expect(screen.queryByText("Same Lift, Two Names?")).toBeNull();
  });

  it("offers the merge into the side with the history, and never merges on its own", () => {
    const onMerge = vi.fn();
    const onMergePreview = vi.fn(() => ({ sessions: 1, programDays: 0 }));
    render(
      <LibraryPage {...base} rows={forked} onMerge={onMerge} onMergePreview={onMergePreview}
        dismissedDupes={[]} onDismissDuplicate={() => {}} onBack={() => {}} />,
    );
    expect(screen.getByText("Same Lift, Two Names?")).toBeInTheDocument();
    expect(screen.getByText("Bench and Bench Press")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Merge Into Bench Press" }));
    // The review card first -- a merge rewrites history and never runs on one tap.
    expect(onMerge).not.toHaveBeenCalled();
    expect(screen.getByText("Merge Bench Into Bench Press")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect(onMerge).toHaveBeenCalledWith(forked[0], "b");
  });

  it("puts a pair away for good when it is waved off", () => {
    const onDismissDuplicate = vi.fn();
    render(
      <LibraryPage {...base} rows={forked} dismissedDupes={[]} onDismissDuplicate={onDismissDuplicate} onBack={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Not the Same" }));
    expect(onDismissDuplicate).toHaveBeenCalledWith("a|b");
  });

  it("says nothing about a clean library", () => {
    render(
      <LibraryPage {...base} rows={[row({ key: "a", name: "Back Squat" }), row({ key: "b", name: "Deadlift" })]}
        dismissedDupes={[]} onDismissDuplicate={() => {}} onBack={() => {}} />,
    );
    expect(screen.queryByText("Same Lift, Two Names?")).toBeNull();
  });
});

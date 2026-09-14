// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import LibraryPage from "./LibraryPage";
import type { LibraryRow } from "./libraryEdit";
import { EMPTY_CLASS, type ClassStore } from "./classify";

// DUPLICATES AND MERGE, THE PAGE'S HALF (handoff §5 and §6).
//
// What the page is now responsible for: ONE compact summary row instead of
// three stacked cards, a dedicated review room behind it, distinguishing facts
// on every pair before a merge is offered, and a Keep Separate that persists.
// The page NEVER merges. It hands an ordered pair up, and the reviewed flow in
// GymFlow does the write (see merge.test.ts and MergeReview.test.tsx).

const row = (over: Partial<LibraryRow> = {}): LibraryRow => ({
  key: "bench", name: "Bench Press", kind: "weight_reps", sessions: 4, sets: 12,
  lastDate: "2026-09-08", firstDate: "2026-06-01", hidden: false, ...over,
});

const base = {
  store: {} as ClassStore,
  todayIso: "2026-09-12",
  onOpen: () => {}, onRename: () => {}, onSetClass: () => {}, onMerge: () => {}, onToggleHidden: () => {},
  onBack: () => {},
};

const forked = [
  row({ key: "a", name: "Bench", sessions: 1, sets: 3, firstDate: "2026-08-01" }),
  row({ key: "b", name: "Bench Press", sessions: 9, sets: 30, firstDate: "2026-05-02" }),
];

describe("LibraryPage favorites", () => {
  it("says Favorite on a starred row and offers the toggle in the overflow", () => {
    const onToggleFavorite = vi.fn();
    render(<LibraryPage {...base} rows={[row({ favorite: true })]} onToggleFavorite={onToggleFavorite} />);
    // A label never wears a data hue (HEALTH law 2), so Favorite is a plain
    // fact chip rather than a lime one.
    expect(screen.getByText("Favorite")).toHaveClass("fact");
    fireEvent.click(screen.getByRole("button", { name: "More for Bench Press" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove From Favorites" }));
    expect(onToggleFavorite).toHaveBeenCalledWith(expect.objectContaining({ key: "bench" }));
  });

  it("offers no toggle without the seam", () => {
    render(<LibraryPage {...base} rows={[row()]} />);
    fireEvent.click(screen.getByRole("button", { name: "More for Bench Press" }));
    expect(screen.queryByRole("button", { name: /Favorites/ })).toBeNull();
  });
});

describe("LibraryPage: the duplicate summary row", () => {
  it("is absent without the wiring", () => {
    render(<LibraryPage {...base} rows={forked} />);
    expect(screen.queryByText("Possible Duplicates")).toBeNull();
  });

  it("is one compact row with the real unresolved count, not a stack of cards", () => {
    render(<LibraryPage {...base} rows={forked} dismissedDupes={[]} onDismissDuplicate={() => {}} />);
    expect(screen.getByText("Possible Duplicates")).toBeInTheDocument();
    expect(screen.getByText("1 pair")).toHaveClass("fact", "amber");
    // The library is still the page: the row is a row, and the exercises are
    // right there under it rather than pushed off the screen.
    expect(screen.getByText("Bench Press")).toBeInTheDocument();
    expect(screen.getByText("Bench")).toBeInTheDocument();
  });

  it("says nothing about a clean library", () => {
    render(
      <LibraryPage {...base} rows={[row({ key: "a", name: "Back Squat" }), row({ key: "b", name: "Deadlift" })]}
        dismissedDupes={[]} onDismissDuplicate={() => {}} />,
    );
    expect(screen.queryByText("Possible Duplicates")).toBeNull();
  });
});

describe("LibraryPage: the duplicate review room", () => {
  const open = () => fireEvent.click(screen.getByRole("button", { name: "Review" }));

  it("shows what separates the two before it offers to weld them", () => {
    const store: ClassStore = {
      a: { ...EMPTY_CLASS, equipment: "smith" },
      b: { ...EMPTY_CLASS, equipment: "barbell" },
    };
    render(<LibraryPage {...base} store={store} rows={forked} dismissedDupes={[]} onDismissDuplicate={() => {}} />);
    open();
    // The equipment differs, which is the fact most likely to prove these are
    // NOT one exercise, so it is stated in amber on the pair itself.
    expect(screen.getByText("Barbell and Smith Machine")).toHaveClass("fact", "amber");
    expect(screen.getByText("1 and 9 sessions")).toBeInTheDocument();
    expect(screen.getByText(/A matching name is not a proof/)).toBeInTheDocument();
  });

  it("hands up the pair with the fuller history as the survivor, and never merges itself", () => {
    const onMerge = vi.fn();
    render(<LibraryPage {...base} rows={forked} onMerge={onMerge} dismissedDupes={[]} onDismissDuplicate={() => {}} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Review Merge" }));
    expect(onMerge).toHaveBeenCalledTimes(1);
    const [keep, fold] = onMerge.mock.calls[0]!;
    expect(keep.key).toBe("b");
    expect(fold.key).toBe("a");
  });

  it("puts a pair away for good with Keep Separate", () => {
    const onDismissDuplicate = vi.fn();
    render(<LibraryPage {...base} rows={forked} dismissedDupes={[]} onDismissDuplicate={onDismissDuplicate} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Keep Separate" }));
    expect(onDismissDuplicate).toHaveBeenCalledWith("a|b");
  });

  it("stops offering a pair that was kept separate", () => {
    render(<LibraryPage {...base} rows={forked} dismissedDupes={["a|b"]} onDismissDuplicate={() => {}} />);
    expect(screen.queryByText("Possible Duplicates")).toBeNull();
  });
});

describe("LibraryPage: merge from the overflow", () => {
  it("picks the survivor and hands the ordered pair up", () => {
    const onMerge = vi.fn();
    render(<LibraryPage {...base} rows={forked} onMerge={onMerge} />);
    fireEvent.click(screen.getByRole("button", { name: "More for Bench" }));
    fireEvent.click(screen.getByRole("button", { name: "Merge Into Another Exercise" }));
    const picks = screen.getAllByText("Bench Press");
    fireEvent.click(picks[picks.length - 1]!);
    const [keep, fold] = onMerge.mock.calls[0]!;
    expect(keep.key).toBe("b");
    expect(fold.key).toBe("a");
  });
});

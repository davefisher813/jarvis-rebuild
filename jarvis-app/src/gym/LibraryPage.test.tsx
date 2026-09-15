// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import LibraryPage from "./LibraryPage";
import type { LibraryRow } from "./libraryEdit";
import { EMPTY_CLASS, type ClassStore } from "./classify";

// EXERCISES: THE ROW, AND WHAT IS ON IT (the 2026-09-14 handoff, §2 and §7).
//
// The row used to carry a Goal pill and an Edit pill on every single line, and
// wrote its facts as one grey sentence. These pin the shape that replaced it:
// the name is the door to the exercise, the chips are doors into their own
// fields, the amber nag appears only when it is true, and everything that is
// not an everyday tap is behind ONE overflow menu.

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

describe("LibraryPage: the row's anatomy", () => {
  it("is titled Exercises and badges the real count", () => {
    render(<LibraryPage {...base} rows={[row(), row({ key: "sq", name: "Squat" })]} />);
    expect(screen.getByText("Exercises")).toHaveClass("nav-title");
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("carries no Goal or Edit pill on the row, and one overflow instead", () => {
    render(<LibraryPage {...base} rows={[row()]} onSetGoal={() => {}} />);
    expect(screen.queryByRole("button", { name: "Goal" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.getByRole("button", { name: "More for Bench Press" })).toBeInTheDocument();
  });

  it("says the two counts as separate fields, not one grey sentence", () => {
    render(<LibraryPage {...base} rows={[row()]} />);
    expect(screen.getByText("4 sessions")).toHaveClass("fact");
    // "Last yesterday" was half of a run-on; when it happened is its own
    // field now, and it opens with a capital because it is the first word of
    // a line rather than the tail of a sentence.
    expect(screen.getByText("Tuesday")).toHaveClass("fact", "cyan");
  });

  it("offers Assign Muscles in amber, and only while there is no primary", () => {
    const { rerender } = render(<LibraryPage {...base} rows={[row()]} />);
    expect(screen.getByRole("button", { name: "Assign Muscles" })).toHaveClass("ex-chip", "amber");
    rerender(<LibraryPage {...base} store={{ bench: { ...EMPTY_CLASS, primary: ["chest"] } }} rows={[row()]} />);
    expect(screen.queryByRole("button", { name: "Assign Muscles" })).toBeNull();
    expect(screen.getByRole("button", { name: "Chest, edit" })).toHaveClass("ex-chip", "on");
  });

  it("marks a secondary muscle differently from a primary one", () => {
    render(<LibraryPage {...base} store={{ bench: { ...EMPTY_CLASS, primary: ["chest"], secondary: ["triceps"] } }} rows={[row()]} />);
    expect(screen.getByRole("button", { name: "Chest, edit" })).toHaveClass("on");
    expect(screen.getByRole("button", { name: "Triceps, edit" })).toHaveClass("sec");
  });

  it("opens the exercise from its name and the editor from a chip", () => {
    const onOpen = vi.fn();
    render(<LibraryPage {...base} rows={[row()]} onOpen={onOpen} />);
    fireEvent.click(screen.getByText("Bench Press"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ key: "bench" }));
    fireEvent.click(screen.getByRole("button", { name: "Assign Muscles" }));
    // The sheet lands on the muscle question, over the page.
    expect(document.body.querySelector(".sheet-scrim")).not.toBeNull();
    expect(screen.getByText("Muscles Worked")).toBeInTheDocument();
    // The chip kept its own verb: the exercise opened once, from the name.
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  // Dave 2026-09-15: "I want all rows clickable."
  it("opens the exercise from anywhere on its row, and from Enter on the row", () => {
    const onOpen = vi.fn();
    render(<LibraryPage {...base} rows={[row()]} onOpen={onOpen} />);
    const rowEl = document.querySelector(".ex-row") as HTMLElement;
    fireEvent.click(rowEl);
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(rowEl, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(2);
    // Enter on the overflow is the overflow's, not the row's.
    fireEvent.keyDown(screen.getByRole("button", { name: "More for Bench Press" }), { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("holds Edit Details, Rename, Set Goal, Merge, Favorites and Hide in the overflow", () => {
    render(<LibraryPage {...base} rows={[row()]} onSetGoal={() => {}} onToggleFavorite={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "More for Bench Press" }));
    for (const label of ["Edit Details", "Rename", "Set Goal", "Merge Into Another Exercise", "Add to Favorites", "Hide From Suggestions"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });
});

// H-23, still true: the old names read on the row.
describe("LibraryPage's alias line", () => {
  it("lists what the exercise used to be called, only when there is one", () => {
    const { rerender } = render(<LibraryPage {...base} rows={[row({ aliases: ["Flat Bench", "Bench"] })]} />);
    expect(screen.getByText("Also Flat Bench, Bench")).toHaveClass("ex-chip", "quiet");
    rerender(<LibraryPage {...base} rows={[row()]} />);
    expect(screen.queryByText(/^Also /)).toBeNull();
  });
});

describe("LibraryPage: search, filters and sort", () => {
  const rows = [
    row({ key: "a", name: "Bench Press", lastDate: "2026-09-08", sessions: 9 }),
    row({ key: "b", name: "Back Squat", lastDate: "2026-09-10", sessions: 2, aliases: ["Squat"] }),
    row({ key: "c", name: "Calf Raise", lastDate: null, sessions: 0 }),
  ];

  it("finds an exercise by an old name", () => {
    render(<LibraryPage {...base} rows={rows} />);
    fireEvent.change(screen.getByLabelText("Search Exercises"), { target: { value: "squat" } });
    expect(screen.getByText("Back Squat")).toBeInTheDocument();
    expect(screen.queryByText("Bench Press")).toBeNull();
  });

  it("filters to the ones with no muscle yet, and counts them on the chip", () => {
    render(<LibraryPage {...base} store={{ a: { ...EMPTY_CLASS, primary: ["chest"] } }} rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(screen.getByRole("button", { name: "Missing Muscles 2" }));
    expect(screen.queryByText("Bench Press")).toBeNull();
    expect(screen.getByText("Back Squat")).toBeInTheDocument();
  });

  it("cycles the sort and says which one is on", () => {
    render(<LibraryPage {...base} rows={rows} />);
    expect(screen.getByRole("button", { name: "Recently Trained" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Recently Trained" }));
    expect(screen.getByRole("button", { name: "Name" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(screen.getByRole("button", { name: "Most Used" })).toBeInTheDocument();
  });

  it("keeps the search after an edit closes", () => {
    render(<LibraryPage {...base} rows={rows} />);
    fireEvent.change(screen.getByLabelText("Search Exercises"), { target: { value: "bench" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign Muscles" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Search Exercises")).toHaveValue("bench");
    expect(screen.queryByText("Back Squat")).toBeNull();
  });

  it("explains a short list rather than leaving it unexplained", () => {
    render(<LibraryPage {...base} rows={[...rows, row({ key: "h", name: "Old Thing", hidden: true })]} />);
    expect(screen.getByText(/Hidden/)).toBeInTheDocument();
  });
});

describe("LibraryPage: select mode", () => {
  const rows = [row({ key: "a", name: "Bench Press" }), row({ key: "b", name: "Incline Press" })];

  it("is absent without the batch seam", () => {
    render(<LibraryPage {...base} rows={rows} />);
    expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
  });

  it("previews the change before it writes, and writes only on Apply", () => {
    const onBatch = vi.fn();
    render(<LibraryPage {...base} rows={rows} onBatch={onBatch} />);
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: "Select All Shown" }));
    expect(screen.getByText("2 Selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Classify" }));
    fireEvent.click(screen.getByRole("button", { name: "Chest" }));
    // Preview first. Nothing has been written.
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(onBatch).not.toHaveBeenCalled();
    expect(screen.getByText("2 Changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onBatch).toHaveBeenCalledTimes(1);
    const [next, changed] = onBatch.mock.calls[0]!;
    expect(changed).toBe(2);
    expect((next as ClassStore).a!.primary).toEqual(["chest"]);
    expect((next as ClassStore).b!.primary).toEqual(["chest"]);
  });

  it("leaves every other field alone when it replaces one", () => {
    const onBatch = vi.fn();
    const store: ClassStore = { a: { ...EMPTY_CLASS, primary: ["back"], equipment: "barbell", movement: "hinge", tags: ["comp"] } };
    render(<LibraryPage {...base} store={store} rows={rows} onBatch={onBatch} />);
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: "Select All Shown" }));
    fireEvent.click(screen.getByRole("button", { name: "Classify" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    fireEvent.click(screen.getByRole("button", { name: "Chest" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const next = onBatch.mock.calls[0]![0] as ClassStore;
    expect(next.a!.primary).toEqual(["chest"]);
    expect(next.a!.equipment).toBe("barbell");
    expect(next.a!.movement).toBe("hinge");
    expect(next.a!.tags).toEqual(["comp"]);
  });
});

describe("LibraryPage: a filtered list does not yank a row out from under you", () => {
  // Bench Press leads: the list sorts by recency, and these two would
  // otherwise tie and fall to alphabetical order, which puts Back Squat first.
  const rows = [
    row({ key: "a", name: "Bench Press", lastDate: "2026-09-11" }),
    row({ key: "b", name: "Back Squat", lastDate: "2026-09-02" }),
  ];

  it("keeps a just-classified row in the Missing Muscles list, marked Saved", () => {
    const { rerender } = render(<LibraryPage {...base} rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(screen.getByRole("button", { name: "Missing Muscles 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide Filters" }));
    expect(screen.getByText("Bench Press")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Assign Muscles" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /^Chest/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    // The store comes back with the write applied, which takes the row out of
    // the filter -- and it stays put anyway, so the next tap lands where the
    // thumb already is.
    rerender(<LibraryPage {...base} store={{ a: { ...EMPTY_CLASS, primary: ["chest"] } }} rows={rows} />);
    expect(screen.getByText("Bench Press")).toBeInTheDocument();
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("lets go of it the moment the filter changes", () => {
    const { rerender } = render(<LibraryPage {...base} rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(screen.getByRole("button", { name: "Missing Muscles 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide Filters" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Assign Muscles" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /^Chest/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    rerender(<LibraryPage {...base} store={{ a: { ...EMPTY_CLASS, primary: ["chest"] } }} rows={rows} />);
    // Re-applying the filter is the confirmation: now the list is honest.
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(screen.getByRole("button", { name: "Missing Muscles 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Missing Muscles 1" }));
    expect(screen.queryByText("Bench Press")).toBeNull();
    expect(screen.getByText("Back Squat")).toBeInTheDocument();
  });

  it("holds nothing when no filter is on, because nothing can drop out", () => {
    const { rerender } = render(<LibraryPage {...base} rows={rows} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Assign Muscles" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /^Chest/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    rerender(<LibraryPage {...base} store={{ a: { ...EMPTY_CLASS, primary: ["chest"] } }} rows={rows} />);
    expect(screen.queryByText("Saved")).toBeNull();
  });
});

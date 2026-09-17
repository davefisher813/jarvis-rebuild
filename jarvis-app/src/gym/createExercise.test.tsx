// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import LibraryPage from "./LibraryPage";
import { withCreated, type LibraryEntry } from "./library";
import type { LibraryRow } from "./libraryEdit";

// ---------------------------------------------------------------------------
// DAVE, 2026-09-17, on the Exercises page: "I should be able to create
// exercises here."
//
// The library is a DERIVATION -- every exercise ever put in a program or
// logged in a session -- so the only way to get a lift into it was to use it.
// That is backwards for the page whose whole job is classifying, goal-setting
// and merging: you could not organize a lift you had not done yet.
// ---------------------------------------------------------------------------

const entry = (over: Partial<LibraryEntry> = {}): LibraryEntry =>
  ({ key: "k1", name: "Bench Press", kind: "weight_reps", lastUsed: 5, lastSets: [], ...over });

describe("a created lift is a seed, and a sighting always beats it", () => {
  it("joins the library with no history, sorted among the never-done", () => {
    const lib = withCreated([entry()], [{ key: "c1", name: "Zercher Squat", kind: "weight_reps" }]);
    const made = lib.find((e) => e.name === "Zercher Squat")!;
    expect(made.lastUsed).toBe(0);
    expect(made.lastSets).toEqual([]);
    expect(made.exerciseKey).toBe("c1");
    // The one with real sightings leads; a seed has no recency to sort by.
    expect(lib[0]!.name).toBe("Bench Press");
  });

  it("drops a seed the derivation already knows by key", () => {
    const lib = withCreated([entry({ key: "c1", name: "Bench Press" })], [{ key: "c1", name: "Bench Press", kind: "weight_reps" }]);
    expect(lib).toHaveLength(1);
    // The real entry survives, with its history, not the empty seed.
    expect(lib[0]!.lastUsed).toBe(5);
  });

  // The seed is minted with its own fresh key, so once the lift is actually
  // logged the derived entry can carry a different key for the same name.
  // Matching on name and measurement is what stops the page showing it twice.
  it("drops a seed the derivation already knows by name at the same measurement", () => {
    const lib = withCreated([entry({ key: "real", name: "bench press" })], [{ key: "seed", name: "Bench Press", kind: "weight_reps" }]);
    expect(lib).toHaveLength(1);
    expect(lib[0]!.key).toBe("real");
  });

  it("keeps a same-named lift that measures something else, which is a different exercise", () => {
    const lib = withCreated([entry({ name: "Farmer Carry" })], [{ key: "c2", name: "Farmer Carry", kind: "distance" }]);
    expect(lib).toHaveLength(2);
  });

  it("does not create the same seed twice", () => {
    const lib = withCreated([], [
      { key: "a", name: "Zercher Squat", kind: "weight_reps" },
      { key: "b", name: "Zercher Squat", kind: "weight_reps" },
    ]);
    expect(lib).toHaveLength(1);
  });

  it("returns the library untouched when nothing was created", () => {
    const base = [entry()];
    expect(withCreated(base, [])).toBe(base);
  });
});

const row = (over: Partial<LibraryRow> = {}): LibraryRow =>
  ({ key: "k1", name: "Bench Press", kind: "weight_reps", sessions: 3, sets: 9,
     lastDate: "2026-09-15", firstDate: "2026-08-01", hidden: false, ...over });

const base = {
  store: {}, todayIso: "2026-09-17",
  onOpen: () => {}, onRename: () => {}, onSetClass: () => {}, onMerge: () => {},
  onToggleHidden: () => {}, onBack: () => {},
};

describe("the Exercises page can make one", () => {
  it("offers Add Exercise at the foot of the list", () => {
    render(<LibraryPage {...base} rows={[row()]} onCreate={() => {}} />);
    expect(screen.getByRole("button", { name: "Add Exercise" })).toBeInTheDocument();
    cleanup();
  });

  it("offers it from the empty state too, which is where you need it most", () => {
    render(<LibraryPage {...base} rows={[]} onCreate={() => {}} />);
    expect(screen.getByRole("button", { name: "Add Exercise" })).toBeInTheDocument();
    cleanup();
  });

  it("stays out of the way when the page has no way to create", () => {
    render(<LibraryPage {...base} rows={[row()]} />);
    expect(screen.queryByRole("button", { name: "Add Exercise" })).toBeNull();
    cleanup();
  });

  // AMENDED 2026-09-17 ("the modal should be a full add exercise modal").
  // The first version was a two-question sheet of its own: a name and a
  // measurement, with the other nine axes left to the classification editor.
  // It is the same ExerciseSheet the program day and the live session open
  // now, so these read that one instead.
  it("opens the whole exercise editor, not a name and a menu", () => {
    render(<LibraryPage {...base} rows={[row()]} onCreate={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Exercise" }));
    expect(screen.getByText("New Exercise")).toBeInTheDocument();
    for (const t of ["Sets", "Equipment", "Measure", "Muscle", "Rest Timer"]) {
      expect(screen.getAllByText(t).length, t).toBeGreaterThan(0);
    }
    cleanup();
  });

  it("hands the whole draft back, not two fields of it", () => {
    const onCreate = vi.fn();
    render(<LibraryPage {...base} rows={[row()]} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Exercise" }));
    fireEvent.change(screen.getByLabelText("Exercise name"), { target: { value: "Zercher Squat" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const draft = onCreate.mock.calls[0]![0];
    expect(draft).toMatchObject({ name: "Zercher Squat", kind: "weight_reps" });
    // The planned strip rides along, which is the thing the old sheet could
    // not carry at all.
    expect(Array.isArray(draft.sets)).toBe(true);
    expect(draft.sets.length).toBeGreaterThan(0);
    cleanup();
  });

  it("creates nothing from an empty name", () => {
    const onCreate = vi.fn();
    render(<LibraryPage {...base} rows={[row()]} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Exercise" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onCreate).not.toHaveBeenCalled();
    cleanup();
  });

  it("closes without creating on Cancel", () => {
    const onCreate = vi.fn();
    render(<LibraryPage {...base} rows={[row()]} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Exercise" }));
    fireEvent.change(screen.getByLabelText("Exercise name"), { target: { value: "Zercher Squat" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Exercise name")).toBeNull();
    cleanup();
  });

  // "The add exercise option should be at the top of the page not the bottom."
  it("leads the list rather than following thirty-two rows of it", () => {
    const { container } = render(<LibraryPage {...base} rows={[row(), row({ key: "k2", name: "Squat" })]} onCreate={() => {}} />);
    const card = container.querySelector(".list-card-ruled")!;
    expect(card.firstElementChild, "Add Exercise is not the first thing in the list").toHaveClass("row-create");
    cleanup();
  });
});

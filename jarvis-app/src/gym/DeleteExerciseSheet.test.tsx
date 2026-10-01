// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import DeleteExerciseSheet from "./DeleteExerciseSheet";
import LibraryPage from "./LibraryPage";
import type { DeletePlan } from "./deleteExercise";
import type { LibraryRow } from "./libraryEdit";
import type { ClassStore } from "./classify";

// THE DELETE CONFIRM (2026-10-01). Three states, one for each question the
// athlete is really being asked, and the wording of each is the contract: it
// says exactly what leaves, with the numbers the records produced.

const plan = (over: Partial<DeletePlan> = {}): DeletePlan => ({
  row: { key: "k", name: "Test Press", kind: "weight_reps", exerciseKey: "k" },
  keys: ["k"], tier: "unused", sessions: 0, sets: 0, emptied: 0, programDays: 0, goals: 0, clears: [], ...over,
});
const noop = { onDelete: () => {}, onArchive: () => {}, onCancel: () => {} };

describe("DeleteExerciseSheet: an exercise nobody has used", () => {
  it("states only what leaves, with one Delete and a way out, and no archive question", () => {
    render(<DeleteExerciseSheet {...noop} plan={plan()} stage="asking" />);
    expect(screen.getByText("Delete Exercise", { selector: ".eyebrow" })).toBeInTheDocument();
    expect(screen.getByText("Test Press")).toHaveClass("dup-name");
    expect(screen.getByText("It leaves your Exercises list")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Exercise" })).toHaveClass("destructive");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive Instead" })).toBeNull();
    expect(screen.queryByText(/session/i)).toBeNull();
  });

  it("names the saved details that go with it, only the ones there are", () => {
    render(<DeleteExerciseSheet {...noop} plan={plan({ clears: ["its muscles and details", "its favorite mark"] })} stage="asking" />);
    expect(screen.getByText("It also clears its muscles and details and its favorite mark")).toBeInTheDocument();
  });
});

describe("DeleteExerciseSheet: an exercise in programs", () => {
  it("says Used in N program days and that each one loses it, and touches no session", () => {
    render(<DeleteExerciseSheet {...noop} plan={plan({ tier: "programs", programDays: 3 })} stage="asking" />);
    expect(screen.getByText("Used in 3 program days")).toBeInTheDocument();
    expect(screen.getByText("It comes out of 3 program days")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Exercise" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive Instead" })).toBeNull();
    expect(screen.queryByText(/history/i)).toBeNull();
  });
});

describe("DeleteExerciseSheet: an exercise with logged history", () => {
  const history = plan({ tier: "history", sessions: 5, sets: 14, emptied: 2, programDays: 1 });

  it("asks in so many words: delete it and its history, or archive it instead, or cancel", () => {
    render(<DeleteExerciseSheet {...noop} plan={history} stage="asking" />);
    expect(screen.getByText("5 sessions, 14 sets")).toHaveClass("fact", "lime");
    expect(screen.getByText("Used in 1 program day")).toBeInTheDocument();
    expect(screen.getByText("Its 5 sessions come out of your history")).toBeInTheDocument();
    expect(screen.getByText("2 Sessions left empty are removed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Exercise and Its History" })).toHaveClass("destructive");
    expect(screen.getByRole("button", { name: "Archive Instead" })).not.toHaveClass("destructive");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    // There is no plain "Delete Exercise" button here: deleting the exercise
    // and deleting the log are one decision, and the label says both.
    expect(screen.queryByRole("button", { name: "Delete Exercise" })).toBeNull();
  });

  it("each button does its own thing and only that", () => {
    const onDelete = vi.fn(), onArchive = vi.fn(), onCancel = vi.fn();
    render(<DeleteExerciseSheet plan={history} stage="asking" onDelete={onDelete} onArchive={onArchive} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Archive Instead" }));
    expect([onDelete.mock.calls.length, onArchive.mock.calls.length, onCancel.mock.calls.length]).toEqual([0, 1, 0]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect([onDelete.mock.calls.length, onArchive.mock.calls.length, onCancel.mock.calls.length]).toEqual([0, 1, 1]);
    fireEvent.click(screen.getByRole("button", { name: "Delete Exercise and Its History" }));
    expect([onDelete.mock.calls.length, onArchive.mock.calls.length, onCancel.mock.calls.length]).toEqual([1, 1, 1]);
  });

  it("a tap outside is Cancel, never Delete", () => {
    const onDelete = vi.fn(), onCancel = vi.fn();
    render(<DeleteExerciseSheet plan={history} stage="asking" onDelete={onDelete} onArchive={() => {}} onCancel={onCancel} />);
    fireEvent.click(document.querySelector(".sheet-scrim")!);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("while it is writing, every button is dead so a second tap is not a second delete", () => {
    render(<DeleteExerciseSheet {...noop} plan={history} stage="pending" />);
    for (const b of screen.getAllByRole("button")) expect(b).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deleting" })).toBeInTheDocument();
  });
});

describe("DeleteExerciseSheet: goals and failures", () => {
  it("says the goals on it stay", () => {
    render(<DeleteExerciseSheet {...noop} plan={plan({ goals: 1 })} stage="asking" />);
    expect(screen.getByText("1 Goal on it stays as it is")).toBeInTheDocument();
  });

  it("a partial failure stays on the sheet and says how far it got", () => {
    render(<DeleteExerciseSheet {...noop} plan={plan()} stage="asking" note="2 of 5 saved, Delete Exercise finishes the rest" />);
    expect(screen.getByText("Not Everything Saved")).toBeInTheDocument();
    expect(screen.getByText("2 of 5 saved, Delete Exercise finishes the rest")).toBeInTheDocument();
  });
});

describe("LibraryPage: Delete Exercise in the row menu", () => {
  const row: LibraryRow = {
    key: "bench", name: "Bench Press", kind: "weight_reps", sessions: 4, sets: 12,
    lastDate: "2026-09-08", firstDate: "2026-06-01", hidden: false,
  };
  const base = {
    store: {} as ClassStore, todayIso: "2026-09-12",
    onOpen: () => {}, onRename: () => {}, onSetClass: () => {}, onMerge: () => {}, onToggleHidden: () => {}, onBack: () => {},
  };

  it("is the last item, in the destructive red, and asks the flow rather than deleting", () => {
    const onDelete = vi.fn();
    render(<LibraryPage {...base} rows={[row]} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "More for Bench Press" }));
    const items = Array.from(document.querySelectorAll(".sheet-actions .btn")).map((b) => b.textContent);
    expect(items.slice(-2)).toEqual(["Delete Exercise", "Cancel"]);
    const del = screen.getByRole("button", { name: "Delete Exercise" });
    expect(del).toHaveClass("destructive");
    fireEvent.click(del);
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ key: "bench" }));
  });

  it("is absent without the wiring", () => {
    render(<LibraryPage {...base} rows={[row]} />);
    fireEvent.click(screen.getByRole("button", { name: "More for Bench Press" }));
    expect(screen.queryByRole("button", { name: "Delete Exercise" })).toBeNull();
  });
});

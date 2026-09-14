// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import LibraryPage from "./LibraryPage";
import type { LibraryRow } from "./libraryEdit";
import { EMPTY_CLASS, type ClassStore } from "./classify";

// Dave, 2026-09-14: "the exercise page edit button doesn't work."
//
// It always fired. It rendered its card INLINE, after the list, after the
// floor line and after Show Hidden -- so on a real library it opened thousands
// of pixels below the fold and nothing appeared to happen. jsdom has no
// viewport, which is exactly why the old tests passed through it. These pin
// the shape that cannot have the bug: every editor is portaled to
// document.body, over the page, the way every other sheet in this folder is.
//
// And the second pass's own rule: the editor is ONE editor (§4), reached from a
// chip on the row and from Edit Details in the overflow, and it writes the
// whole classification in one call with the scope the athlete chose.

const row = (over: Partial<LibraryRow> = {}): LibraryRow => ({
  key: "bench", name: "Bench Press", kind: "weight_reps", sessions: 4, sets: 12,
  lastDate: "2026-09-08", firstDate: "2026-06-01", hidden: false, ...over,
});

const many = Array.from({ length: 40 }, (_, i) => row({ key: `k${i}`, name: `Lift ${i}` }));

const base = {
  store: {} as ClassStore,
  todayIso: "2026-09-12",
  onOpen: () => {}, onRename: () => {}, onSetClass: () => {}, onMerge: () => {}, onToggleHidden: () => {},
  onBack: () => {},
};

describe("LibraryPage: every editor opens over the page, not below it", () => {
  it("portals the classification editor out of the scrolling list", () => {
    const { container } = render(<LibraryPage {...base} rows={many} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Assign Muscles" })[0]!);
    expect(document.body.querySelector(".sheet-scrim")).not.toBeNull();
    // The thing that was broken: it must NOT be a child of the page, because
    // a child of the page is a child of the scroller.
    expect(container.querySelector(".sheet-scrim")).toBeNull();
  });

  it("portals the rename sheet too", () => {
    const { container } = render(<LibraryPage {...base} rows={many} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^More for/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(document.body.querySelector(".sheet-scrim")).not.toBeNull();
    expect(container.querySelector(".sheet-scrim")).toBeNull();
    expect(screen.getByLabelText("Exercise Name")).toHaveValue("Lift 0");
  });
});

describe("LibraryPage: rename", () => {
  const openRename = () => {
    fireEvent.click(screen.getByRole("button", { name: "More for Bench Press" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  };

  it("renames from the sheet bar and closes", () => {
    const onRename = vi.fn();
    render(<LibraryPage {...base} rows={[row()]} onRename={onRename} />);
    openRename();
    fireEvent.change(screen.getByLabelText("Exercise Name"), { target: { value: "Barbell Bench Press" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ key: "bench" }), "Barbell Bench Press");
    expect(document.body.querySelector(".sheet-scrim")).toBeNull();
  });

  it("closes without renaming when the name was not touched", () => {
    const onRename = vi.fn();
    render(<LibraryPage {...base} rows={[row()]} onRename={onRename} />);
    openRename();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onRename).not.toHaveBeenCalled();
  });
});

describe("LibraryPage: the classification editor", () => {
  it("cycles a muscle through primary, secondary and off in one control", () => {
    const onSetClass = vi.fn();
    render(<LibraryPage {...base} rows={[row()]} onSetClass={onSetClass} />);
    fireEvent.click(screen.getByRole("button", { name: "Assign Muscles" }));
    fireEvent.click(screen.getByRole("button", { name: /^Chest/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSetClass).toHaveBeenCalledWith(
      expect.objectContaining({ key: "bench" }),
      expect.objectContaining({ primary: ["chest"], secondary: [] }),
      "all",
    );
  });

  it("makes a second tap secondary rather than replacing the primary", () => {
    const onSetClass = vi.fn();
    render(<LibraryPage {...base} rows={[row()]} onSetClass={onSetClass} />);
    fireEvent.click(screen.getByRole("button", { name: "Assign Muscles" }));
    fireEvent.click(screen.getByRole("button", { name: /^Chest/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Triceps/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Triceps/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const [, next] = onSetClass.mock.calls[0]!;
    expect(next).toMatchObject({ primary: ["chest"], secondary: ["triceps"] });
  });

  it("asks about scope only when it is correcting an assignment that exists", () => {
    const { rerender } = render(<LibraryPage {...base} rows={[row()]} />);
    fireEvent.click(screen.getByRole("button", { name: "Assign Muscles" }));
    // A first answer has one sensible scope, so it is not a question.
    expect(screen.queryByText("Applies To")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    rerender(<LibraryPage {...base} store={{ bench: { ...EMPTY_CLASS, primary: ["back"] } }} rows={[row()]} />);
    fireEvent.click(screen.getByRole("button", { name: "Back, edit" }));
    expect(screen.getByText("Applies To")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Existing and Future" })).toBeInTheDocument();
  });

  it("stamps the window when the correction is for future records only", () => {
    const onSetClass = vi.fn();
    render(<LibraryPage {...base} store={{ bench: { ...EMPTY_CLASS, primary: ["back"] } }} rows={[row()]} onSetClass={onSetClass} />);
    fireEvent.click(screen.getByRole("button", { name: "Back, edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Future Records" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const [, next, scope] = onSetClass.mock.calls[0]!;
    expect(scope).toBe("future");
    expect(next).toMatchObject({ from: "2026-09-12" });
    expect(next.until).toBeUndefined();
  });

  it("holds movement, type, execution and the machine's identity behind More Details", () => {
    render(<LibraryPage {...base} rows={[row()]} />);
    fireEvent.click(screen.getByRole("button", { name: "Assign Muscles" }));
    expect(screen.queryByText("Movement Pattern")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More Details" }));
    expect(screen.getByText("Movement Pattern")).toBeInTheDocument();
    expect(screen.getByText("Exercise Type")).toBeInTheDocument();
    expect(screen.getByText("Equipment Identity")).toBeInTheDocument();
    expect(screen.getByLabelText("Machine ID")).toBeInTheDocument();
  });

  it("writes equipment, movement, type and identity together", () => {
    const onSetClass = vi.fn();
    render(<LibraryPage {...base} rows={[row()]} onSetClass={onSetClass} />);
    fireEvent.click(screen.getByRole("button", { name: "Assign Muscles" }));
    fireEvent.click(screen.getByRole("button", { name: "Equipment Smith Machine" }));
    fireEvent.click(screen.getByRole("button", { name: "More Details" }));
    fireEvent.click(screen.getByRole("button", { name: "Movement Horizontal Push" }));
    fireEvent.click(screen.getByRole("button", { name: "Type Strength" }));
    fireEvent.change(screen.getByLabelText("Machine"), { target: { value: "Rack 3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const [, next] = onSetClass.mock.calls[0]!;
    expect(next).toMatchObject({ equipment: "smith", movement: "push_h", type: "strength", machineName: "Rack 3" });
  });

  it("says a declared measurement never rewrites what is already recorded", () => {
    render(<LibraryPage {...base} rows={[row()]} />);
    fireEvent.click(screen.getByRole("button", { name: "Assign Muscles" }));
    expect(screen.getByText("Sessions already logged keep the numbers and units they were recorded with")).toBeInTheDocument();
  });
});

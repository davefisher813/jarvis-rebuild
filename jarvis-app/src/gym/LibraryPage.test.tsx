// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import LibraryPage from "./LibraryPage";
import type { LibraryRow } from "./libraryEdit";

// Dave's ask 2026-09-12: "the list of exercises there's a goal option."

const row = (over: Partial<LibraryRow> = {}): LibraryRow => ({
  key: "bench", name: "Bench Press", kind: "weight_reps", sessions: 4, lastDate: "2026-09-08", hidden: false, ...over,
});

const base = { todayIso: "2026-09-12", onOpen: () => {}, onRename: () => {}, onMerge: () => {}, onToggleHidden: () => {} };

describe("LibraryPage's Goal pill", () => {
  it("is absent when the caller offers no goal wiring", () => {
    render(<LibraryPage {...base} rows={[row()]} onBack={() => {}} />);
    expect(screen.queryByRole("button", { name: "Goal" })).toBeNull();
  });

  it("opens straight on the lift, without opening the row for Edit or Lift Detail", () => {
    const onSetGoal = vi.fn();
    const onOpen = vi.fn();
    render(<LibraryPage {...base} onOpen={onOpen} rows={[row()]} onSetGoal={onSetGoal} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Goal" }));
    expect(onSetGoal).toHaveBeenCalledWith(row());
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("sits beside Edit, not in place of it", () => {
    render(<LibraryPage {...base} rows={[row()]} onSetGoal={() => {}} onBack={() => {}} />);
    expect(screen.getByRole("button", { name: "Goal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });
});

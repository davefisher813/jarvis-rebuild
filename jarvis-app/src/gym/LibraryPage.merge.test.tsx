// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import LibraryPage from "./LibraryPage";
import type { LibraryRow } from "./libraryEdit";

// Part 3 wave 1 (2026-09-13): favorites, and a merge reviewed before it runs.
const row = (over: Partial<LibraryRow> = {}): LibraryRow => ({
  key: "bench", name: "Bench Press", kind: "weight_reps", sessions: 4, lastDate: "2026-09-08", hidden: false, ...over,
});
const base = { todayIso: "2026-09-12", onOpen: () => {}, onRename: () => {}, onMerge: () => {}, onToggleHidden: () => {}, onBack: () => {} };

describe("LibraryPage favorites", () => {
  it("says Favorite on a starred row and offers the toggle in the edit card", () => {
    const onToggleFavorite = vi.fn();
    render(<LibraryPage {...base} rows={[row({ favorite: true })]} onToggleFavorite={onToggleFavorite} />);
    expect(screen.getByText("Favorite")).toHaveClass("pill", "pill-good");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove From Favorites" }));
    expect(onToggleFavorite).toHaveBeenCalledWith(expect.objectContaining({ key: "bench" }));
  });

  it("offers no toggle without the seam", () => {
    render(<LibraryPage {...base} rows={[row()]} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByRole("button", { name: /Favorites/ })).toBeNull();
  });
});

describe("LibraryPage merge review", () => {
  const rows = [row(), row({ key: "flat", name: "Flat Bench", sessions: 2 })];

  it("shows what the merge reaches, and only Merge writes", () => {
    const onMerge = vi.fn();
    const onMergePreview = vi.fn(() => ({ sessions: 2, programDays: 1 }));
    render(<LibraryPage {...base} rows={rows} onMerge={onMerge} onMergePreview={onMergePreview} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Merge Into Another Lift" }));
    // The picker is single-select: the row itself is the pick.
    const picks = screen.getAllByText("Bench Press");
    fireEvent.click(picks[picks.length - 1]!);
    expect(onMergePreview).toHaveBeenCalledWith(expect.objectContaining({ key: "flat" }), "bench");
    expect(screen.getByText("Merge Flat Bench Into Bench Press")).toBeInTheDocument();
    expect(screen.getByText("2 sessions")).toBeInTheDocument();
    expect(screen.getByText("1 program day")).toBeInTheDocument();
    expect(onMerge).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect(onMerge).toHaveBeenCalledWith(expect.objectContaining({ key: "flat" }), "bench");
  });

  it("Cancel on the review writes nothing", () => {
    const onMerge = vi.fn();
    render(<LibraryPage {...base} rows={rows} onMerge={onMerge} onMergePreview={() => ({ sessions: 2, programDays: 0 })} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Merge Into Another Lift" }));
    // The picker is single-select: the row itself is the pick.
    const picks = screen.getAllByText("Bench Press");
    fireEvent.click(picks[picks.length - 1]!);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/Merge Flat Bench Into/)).toBeNull();
    expect(onMerge).not.toHaveBeenCalled();
  });
});

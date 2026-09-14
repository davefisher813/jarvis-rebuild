// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import ExerciseSheet from "./ExerciseSheet";
import type { Exercise } from "./types";

// Health Push E (2026-09-12): H-26 Load and H-24 Pair With on the sheet.
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save" }));
const existing: Exercise = { id: "e1", name: "DB Press", kind: "weight_reps", unit: "lb", sets: [{ id: "s1", w: 50, r: 10 }], exerciseKey: "k1" };

describe("ExerciseSheet: Load (H-26)", () => {
  it("defaults to the whole load and writes nothing; Each Dumbbell writes load: each", () => {
    const onSave = vi.fn();
    render(<ExerciseSheet mode="edit" initial={existing} library={[]} history={[]} onSave={onSave} onCancel={() => {}} />);
    save();
    expect(onSave.mock.calls[0]![0]).not.toHaveProperty("load");
    fireEvent.click(screen.getByRole("button", { name: "Load" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Each Dumbbell" }));
    expect(screen.getByText("The number on each chip is one dumbbell")).toBeInTheDocument();
    save();
    expect(onSave.mock.calls[1]![0].load).toBe("each");
  });

  it("is not offered on a kind with no weight", () => {
    render(<ExerciseSheet mode="edit" initial={{ ...existing, kind: "reps", unit: undefined, sets: [{ id: "s1", r: 10 }] }} library={[]} history={[]} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole("button", { name: "Load" })).toBeNull();
  });
});

describe("ExerciseSheet: Pair With (H-24)", () => {
  it("names the partner and opens the picker; absent without the seam", () => {
    const onPairWith = vi.fn();
    const { rerender } = render(<ExerciseSheet mode="edit" initial={existing} library={[]} history={[]} onSave={() => {}} onCancel={() => {}} partner="Row" onPairWith={onPairWith} />);
    expect(screen.getByText("Pair With")).toBeInTheDocument();
    expect(screen.getByText("Row")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(onPairWith).toHaveBeenCalled();
    rerender(<ExerciseSheet mode="edit" initial={existing} library={[]} history={[]} onSave={() => {}} onCancel={() => {}} partner={null} onPairWith={onPairWith} />);
    expect(screen.getByText("Not paired")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose" })).toBeInTheDocument();
    rerender(<ExerciseSheet mode="edit" initial={existing} library={[]} history={[]} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText("Pair With")).toBeNull();
  });
});

// Part 3 wave 2: the round's rest lives on the sheet, only once grouped.
describe("ExerciseSheet: Rest After the Round", () => {
  it("is offered only with a partner, and writes roundRestSec when set", () => {
    const onSave = vi.fn();
    const { rerender } = render(<ExerciseSheet mode="edit" initial={existing} library={[]} history={[]} onSave={onSave} onCancel={() => {}} onPairWith={() => {}} partner={null} />);
    expect(screen.queryByText("Rest After the Round")).toBeNull();
    rerender(<ExerciseSheet mode="edit" initial={existing} library={[]} history={[]} onSave={onSave} onCancel={() => {}} onPairWith={() => {}} partner="Row" />);
    expect(screen.getByText("Rest After the Round")).toBeInTheDocument();
    expect(screen.getByText("Off · Rest after every set")).toBeInTheDocument();
    save();
    expect(onSave.mock.calls[0]![0]).not.toHaveProperty("roundRestSec");
    fireEvent.click(screen.getByRole("button", { name: "More Rest After the Round" }));
    save();
    expect(onSave.mock.calls[1]![0].roundRestSec).toBe(15);
  });
});

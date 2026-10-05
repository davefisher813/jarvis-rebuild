// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import ExerciseSheet from "./ExerciseSheet";
import type { Exercise } from "./types";

// Health Push E (2026-09-12): H-26 Load and H-24 Pair With on the sheet.
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save" }));
const existing: Exercise = { id: "e1", name: "DB Press", kind: "weight_reps", unit: "lb", sets: [{ id: "s1", w: 50, r: 10 }], exerciseKey: "k1" };

describe("ExerciseSheet: Equipment (Part 3 wave 5, was Load; split 2026-09-14)", () => {
  it("writes nothing until said; picking equipment carries its own reading", () => {
    const onSave = vi.fn();
    render(<ExerciseSheet mode="edit" initial={existing} library={[]} history={[]} onSave={onSave} onCancel={() => {}} />);
    save();
    expect(onSave.mock.calls[0]![0]).not.toHaveProperty("equipment");
    expect(onSave.mock.calls[0]![0]).not.toHaveProperty("counted");
    expect(onSave.mock.calls[0]![0]).not.toHaveProperty("load");
    fireEvent.click(screen.getByRole("button", { name: "Equipment" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Dumbbells" }));
    save();
    expect(onSave.mock.calls[1]![0].equipment).toBe("dumbbell");
    // Its default reading came with it -- no second tap to say Each Hand.
    expect(onSave.mock.calls[1]![0].counted).toBe("each_hand");
  });

  it("renames the Weight row and asks Counted As only when it is a real question", () => {
    render(<ExerciseSheet mode="edit" initial={existing} library={[]} history={[]} onSave={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Equipment" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Dumbbells" }));
    expect(screen.getByText("Weight Per Hand")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Counted as" })).toBeInTheDocument();
    // A stack has exactly one reading, so it costs no row and no tap.
    fireEvent.click(screen.getByRole("button", { name: "Equipment" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Selectorized Machine" }));
    expect(screen.queryByRole("button", { name: "Counted as" })).toBeNull();
    expect(screen.getByText("Weight")).toBeInTheDocument();
    // Assistance is not a load, and the row says so.
    fireEvent.click(screen.getByRole("button", { name: "Equipment" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Assisted" }));
    expect(screen.getByText("Assistance")).toBeInTheDocument();
  });

  it("reads the retired values so nothing saved before this changes meaning", () => {
    const first = render(<ExerciseSheet mode="edit" initial={{ ...existing, load: "each" }} library={[]} history={[]} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getAllByText("Dumbbells").length).toBeGreaterThan(0);
    expect(screen.getByText("Weight Per Hand")).toBeInTheDocument();
    first.unmount();
    // "One Side at a Time" was a COUNT, never equipment: it keeps its
    // meaning as a per-side reading with the hardware left unsaid. A fresh
    // mount, not a rerender -- the sheet reads `initial` once, on purpose.
    render(<ExerciseSheet mode="edit" initial={{ ...existing, equipment: "unilateral" } as unknown as Exercise} library={[]} history={[]} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Weight Per Side")).toBeInTheDocument();
  });

  it("is not offered on a kind with no weight", () => {
    render(<ExerciseSheet mode="edit" initial={{ ...existing, kind: "reps", unit: undefined, sets: [{ id: "s1", r: 10 }] }} library={[]} history={[]} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole("button", { name: "Equipment" })).toBeNull();
  });
});

describe("ExerciseSheet: Pair With (H-24)", () => {
  it("names the partner and opens the picker; absent without the seam", () => {
    const onPairWith = vi.fn();
    const { rerender } = render(<ExerciseSheet mode="edit" initial={existing} library={[]} history={[]} onSave={() => {}} onCancel={() => {}} partner="Row" onPairWith={onPairWith} />);
    expect(screen.getByText("Pair With")).toBeInTheDocument();
    expect(screen.getByText("Row")).toBeInTheDocument();
    // CLEAN ROW (Dave 2026-10-05, locked): no Change capsule; the row is the door, with a chevron.
    const door = screen.getByText("Pair With").closest(".row")!;
    expect(door.querySelector(".pill-act")).toBeNull();
    expect(door.querySelector(".chev")).not.toBeNull();
    fireEvent.click(door);
    expect(onPairWith).toHaveBeenCalled();
    rerender(<ExerciseSheet mode="edit" initial={existing} library={[]} history={[]} onSave={() => {}} onCancel={() => {}} partner={null} onPairWith={onPairWith} />);
    // Unpaired says nothing (§AK), and no capsule says it for the row either.
    expect(screen.queryByText("Not paired")).toBeNull();
    expect(screen.queryByRole("button", { name: "Choose" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Pair With/ })).toBeInTheDocument();
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
    expect(screen.getByText("Rest After Every Set")).toBeInTheDocument();
    save();
    expect(onSave.mock.calls[0]![0]).not.toHaveProperty("roundRestSec");
    fireEvent.click(screen.getByRole("button", { name: "Rest After the Round" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "1:00" }));
    save();
    expect(onSave.mock.calls[1]![0].roundRestSec).toBe(60);
  });
});

// THE CATALOG, CHECKED ON WHAT THE SHEET DRAWS (Dave 2026-10-05): every meta line under a row is
// Title Case ("Varies by Set", "Offered During a Pair's Rest"), not the sentence case they were
// written in.
describe("ExerciseSheet: the meta lines follow the catalog (2026-10-05)", () => {
  const SMALL = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);
  const lowercaseWords = (t: string) => t.split(/\s+/).slice(1).filter((w) => /^[a-z]{2,}$/.test(w) && !SMALL.has(w));

  it("a lift's meta lines, including Filler's and a varying strip's, are Title Case", () => {
    const varying: Exercise = { ...existing, sets: [{ id: "s1", w: 50, r: 10 }, { id: "s2", w: 60, r: 8 }] };
    render(<ExerciseSheet mode="edit" initial={varying} library={[]} history={[]} onSave={() => {}} onCancel={() => {}} />);
    const metas = Array.from(document.querySelectorAll(".conn-meta")).map((m) => m.textContent ?? "");
    expect(metas).toContain("Offered During a Pair's Rest");
    expect(metas).toContain("Varies by Set");
    for (const t of metas) expect(lowercaseWords(t), t).toEqual([]);
  });
});

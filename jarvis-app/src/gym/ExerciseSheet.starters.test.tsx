// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import ExerciseSheet from "./ExerciseSheet";
import type { LibraryEntry } from "./library";
import type { Exercise } from "./types";
import type { Adoption } from "./libraryView";

// THE CATALOG IN THE NAME'S TYPEAHEAD (Dave 2026-10-17: the stock exercises in
// search-as-you-type on the create sheet). His own lead, the preloaded catalog
// fills in behind them, and a starter picked there is adopted the way a picker
// adopts one: a fresh key the sheet saves under, its primary on the Muscle
// row, its primary and secondaries handed to the flow's one door, after the
// caller's own save and never on a pick alone.

const own = (name: string, over: Partial<LibraryEntry> = {}): LibraryEntry =>
  ({ key: "ek-" + name, exerciseKey: "ek-" + name, name, kind: "weight_reps", lastUsed: 1, lastSets: [], ...over });

beforeEach(() => { localStorage.clear(); });

function sheet(library: LibraryEntry[], withDoor = true) {
  const calls: string[] = [];
  const onSave = vi.fn((_d: Omit<Exercise, "id">) => { calls.push("save"); });
  const onAdopt = vi.fn((_a: Adoption[]) => { calls.push("adopt"); });
  const onCancel = vi.fn();
  render(<ExerciseSheet mode="new" library={library} history={[]} onSave={onSave} onCancel={onCancel} {...(withDoor ? { onAdopt } : {})} />);
  return { onSave, onAdopt, onCancel, calls };
}
const type = (v: string) => {
  fireEvent.focus(screen.getByLabelText("Exercise name"));
  fireEvent.change(screen.getByLabelText("Exercise name"), { target: { value: v } });
};
const suggestions = () => [...document.querySelector(".xs-group")!.querySelectorAll(".xs-row[role=button] .conn-name")].map((n) => n.textContent);

describe("the name's typeahead reaches the catalog", () => {
  it("offers a starter after his own, five in all", () => {
    sheet([own("Close Grip Bench Press")]);
    type("bench");
    expect(suggestions()).toEqual(["Close Grip Bench Press", "Bench Press", "Incline Bench Press", "Decline Bench Press", "Bench Dip"]);
    type("press");
    expect(suggestions()).toHaveLength(5);
    expect(suggestions()[0]).toBe("Close Grip Bench Press");
  });

  it("never offers back a starter he already has, by name or by an old name", () => {
    sheet([own("Bench Press"), own("Strict Press", { aliases: ["Overhead Press"] })]);
    type("press");
    expect(suggestions()).not.toContain("Overhead Press");
    expect(suggestions().filter((s) => s === "Bench Press")).toHaveLength(1);
  });

  it("keeps a starter offered when it is exactly what was typed", () => {
    sheet([]);
    type("Deadlift");
    expect(suggestions()).toContain("Deadlift");
  });

  it("is not offered at all without the flow's door", () => {
    sheet([own("Close Grip Bench Press")], false);
    type("bench");
    expect(suggestions()).toEqual(["Close Grip Bench Press"]);
  });
});

describe("picking a starter there adopts it as a picker does", () => {
  it("saves under the adopted key with its primary, then hands the adoption to the door", () => {
    const { onSave, onAdopt, calls } = sheet([]);
    type("incline");
    fireEvent.mouseDown(screen.getByText("Incline Bench Press", { selector: ".conn-name" }));
    // The Muscle row says what the catalog said.
    expect(screen.getByRole("button", { name: "Muscle" })).toHaveTextContent("Chest");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(calls).toEqual(["save", "adopt"]);
    const draft = onSave.mock.calls[0]![0];
    const [a] = onAdopt.mock.calls[0]![0];
    expect(draft).toMatchObject({ name: "Incline Bench Press", kind: "weight_reps", muscleGroup: "chest" });
    expect(draft.exerciseKey).toBe(a!.seed.key);
    expect(a!.seed).toMatchObject({ name: "Incline Bench Press", kind: "weight_reps" });
    expect(a!.cls).toMatchObject({ primary: ["chest"], secondary: ["shoulders", "triceps"] });
  });

  it("a Muscle he changed leads, and the catalog's secondaries fill in behind it", () => {
    const { onAdopt } = sheet([]);
    type("incline");
    fireEvent.mouseDown(screen.getByText("Incline Bench Press", { selector: ".conn-name" }));
    fireEvent.click(screen.getByRole("button", { name: "Muscle" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Shoulders" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onAdopt.mock.calls[0]![0][0]!.cls).toMatchObject({ primary: ["shoulders"], secondary: ["triceps"] });
  });

  it("Cancel leaves nothing behind", () => {
    const { onAdopt, onCancel } = sheet([]);
    type("incline");
    fireEvent.mouseDown(screen.getByText("Incline Bench Press", { selector: ".conn-name" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onAdopt).not.toHaveBeenCalled();
  });

  it("renamed after the pick, it is his own lift and the catalog's muscles do not follow it", () => {
    const { onSave, onAdopt } = sheet([]);
    type("incline");
    fireEvent.mouseDown(screen.getByText("Incline Bench Press", { selector: ".conn-name" }));
    fireEvent.change(screen.getByLabelText("Exercise name"), { target: { value: "Low Incline Press" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalled();
    expect(onAdopt).not.toHaveBeenCalled();
  });

  it("picking one of his own after a starter drops the starter's adoption", () => {
    const { onSave, onAdopt } = sheet([own("Close Grip Bench Press")]);
    type("bench");
    fireEvent.mouseDown(screen.getByText("Bench Press", { selector: ".conn-name" }));
    type("close");
    fireEvent.mouseDown(screen.getByText("Close Grip Bench Press", { selector: ".conn-name" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ exerciseKey: "ek-Close Grip Bench Press" });
    expect(onAdopt).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import ExerciseSheet from "./ExerciseSheet";
import LoadSheet from "./LoadSheet";
import SessionScreen from "./SessionScreen";
import MusclePickSheet, { tapMuscle, MAX_SECONDARY } from "./MusclePickSheet";
import type { Exercise } from "./types";
import type { LiveSession } from "./liveSession";

vi.mock("../shared/toast", () => ({ showToast: vi.fn(), hideToast: vi.fn(), subscribeToast: vi.fn() }));
import { showToast } from "../shared/toast";

// DAVE, 2026-10-09 (pass-off item 5, mockups 3, 6, 7 and 8): equipment is a
// property of an exercise, tappable right on the workout's exercise list and
// in the logging view, and the names stop carrying it. The exercise shows what
// it trains, primary and secondary, and both are picked where it is.

describe("the exercise sheet's save door", () => {
  const typeName = (v: string) => fireEvent.change(screen.getByPlaceholderText("Exercise Name"), { target: { value: v } });

  it("lands Chest Flys (Machine) as Chest Flys with the machine as its equipment", () => {
    const onSave = vi.fn();
    render(<ExerciseSheet mode="new" library={[]} history={[]} onSave={onSave} onCancel={() => {}} />);
    typeName("Chest Flys (Machine)");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ name: "Chest Flys", equipment: "stack", counted: "total" });
  });

  it("keeps an equipment picked on the sheet over the word in the name", () => {
    const onSave = vi.fn();
    render(<ExerciseSheet mode="new" library={[]} history={[]} onSave={onSave} onCancel={() => {}} />);
    typeName("Fly (Machine)");
    fireEvent.click(screen.getByRole("button", { name: "Equipment" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Cable" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ name: "Fly", equipment: "cable" });
  });

  it("never touches brackets that are not equipment", () => {
    const onSave = vi.fn();
    render(<ExerciseSheet mode="new" library={[]} history={[]} onSave={onSave} onCancel={() => {}} />);
    typeName("Row (Wide Grip)");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0]![0].name).toBe("Row (Wide Grip)");
    expect(onSave.mock.calls[0]![0]).not.toHaveProperty("equipment");
  });
});

describe("the equipment selector (mockup 7)", () => {
  it("is one row per equipment with the selection mark on the picked one, never red", () => {
    render(<LoadSheet name="Bench Press" initial={{ equipment: "barbell" }} onSave={() => {}} onCancel={() => {}} />);
    const group = screen.getByRole("radiogroup", { name: "Equipment" });
    const rows = within(group).getAllByRole("radio");
    expect(rows.map((r) => r.textContent?.replace(/The bar.*$/, ""))).toEqual([
      "Barbell", "Dumbbells", "Kettlebell", "Cable", "Selectorized Machine", "Plate-Loaded Machine", "Smith Machine",
      "Bodyweight", "Assisted", "Band", "Other",
    ]);
    const picked = within(group).getByRole("radio", { checked: true });
    expect(picked).toHaveAccessibleName("Equipment Barbell");
    expect(picked.querySelector(".radio.on")).not.toBeNull();
    expect(group.querySelectorAll(".radio.on")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("hands back the picked equipment with Done", () => {
    const onSave = vi.fn();
    render(<LoadSheet name="Fly" initial={{}} onSave={onSave} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: "Equipment Cable" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ equipment: "cable" });
  });
});

describe("the secondary muscles selector (mockup 8)", () => {
  beforeEach(() => { vi.mocked(showToast).mockClear(); });

  it("one muscle holds one role, and a fourth secondary is refused", () => {
    const one = tapMuscle({ primary: ["chest"], secondary: [] }, "secondary", "chest");
    expect(one).toEqual({ primary: ["chest"], secondary: [] });
    const full = { primary: ["chest" as const], secondary: ["shoulders" as const, "triceps" as const, "core" as const] };
    expect(full.secondary).toHaveLength(MAX_SECONDARY);
    expect(tapMuscle(full, "secondary", "biceps")).toBe("full");
    // Promoting a secondary to primary takes it out of secondary.
    expect(tapMuscle(full, "primary", "triceps")).toEqual({ primary: ["chest", "triceps"], secondary: ["shoulders", "core"] });
  });

  it("groups the chips by body region, locks the primary, and says the limit when it is hit", () => {
    const onSave = vi.fn();
    render(<MusclePickSheet name="Bench Press" role="secondary" initial={{ primary: ["chest"], secondary: ["shoulders", "triceps"] }} onSave={onSave} onCancel={() => {}} />);
    for (const head of ["Upper Body", "Lower Body", "Core"]) expect(screen.getAllByText(head).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Chest, primary" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Chest, primary" })).toHaveClass("chip", "active", "chip-lime");
    expect(screen.getByRole("button", { name: "Shoulders, secondary" })).toHaveClass("chip-half", "chip-lime");
    fireEvent.click(screen.getByRole("button", { name: "Biceps" }));
    fireEvent.click(screen.getByRole("button", { name: "Quads" }));
    expect(showToast).toHaveBeenCalledWith({ message: "Up to 3 Secondary Muscles" });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onSave).toHaveBeenCalledWith({ primary: ["chest"], secondary: ["shoulders", "triceps", "biceps"] });
  });
});

describe("the logging view and its exercise list", () => {
  const bench: Exercise = { id: "a", name: "Bench Press", kind: "weight_reps", unit: "lb", equipment: "barbell", sets: [{ id: "a1", w: 225, r: 5 }] };
  const fly: Exercise = { id: "b", name: "Chest Flys", kind: "weight_reps", unit: "lb", sets: [{ id: "b1", w: 100, r: 10 }] };
  const live: LiveSession = {
    programId: "p", dayId: "d1", dayName: "Push Day", date: "2026-10-10", startedAt: 0, idx: 0,
    exercises: [
      { exerciseId: "a", name: "Bench Press", kind: "weight_reps", unit: "lb", equipment: "barbell", counted: "total", sets: [] },
      { exerciseId: "b", name: "Chest Flys", kind: "weight_reps", unit: "lb", sets: [] },
    ],
  };
  const musclesOf = (e: { name: string }) => (e.name === "Bench Press"
    ? { primary: ["chest" as const], secondary: ["shoulders" as const, "triceps" as const] }
    : { primary: [], secondary: [] });
  const renderScreen = (over: Partial<Parameters<typeof SessionScreen>[0]> = {}) => render(
    <SessionScreen live={live} exercise={bench} dayExercises={[bench, fly]} programDay={{ id: "d1", name: "Push Day", exercises: [bench, fly] }}
      history={[]} library={[]} onLog={() => {}} onSetLogged={() => {}} onSkip={() => {}} onMove={() => {}} onSwap={() => {}}
      onSetLoad={() => {}} musclesOf={musclesOf} onSetMuscles={() => {}} onAddMidSession={() => {}} onFit={() => {}}
      onFinish={() => {}} onBack={() => {}} {...over} />,
  );

  it("shows the primary and secondary muscles on the exercise, each a door to its picker", () => {
    renderScreen();
    const primary = screen.getByRole("button", { name: "Primary Chest" });
    expect(primary).toHaveClass("se-chip", "se-chip-when", "se-chip-door");
    fireEvent.click(screen.getByRole("button", { name: "Secondary Shoulders, Triceps" }));
    expect(screen.getByText("Secondary", { selector: ".sheet-bar-title" })).toBeInTheDocument();
  });

  it("puts a tappable equipment chip on every row of the list, and it answers for that row", () => {
    const onSetLoad = vi.fn();
    renderScreen({ onSetLoad });
    const list = document.querySelector(".list-card-ruled")!;
    expect(within(list as HTMLElement).getByRole("button", { name: "Equipment for Bench Press: Barbell" })).toHaveClass("se-chip-pair", "se-chip-door");
    // The row that is not on screen opens the selector for itself, and the
    // tap does not walk the session to it.
    fireEvent.click(within(list as HTMLElement).getByRole("button", { name: "Equipment for Chest Flys: Not Set" }));
    expect(screen.getByText("Chest Flys", { selector: ".sheet-bar-title" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Equipment Selectorized Machine" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onSetLoad).toHaveBeenCalledWith(expect.objectContaining({ equipment: "stack" }), 1);
  });

  it("an untouched row says nothing about its state, and its muscle is the row's one grey", () => {
    renderScreen();
    expect(screen.queryByText("To Do")).toBeNull();
    const list = document.querySelector(".list-card-ruled")!;
    expect(within(list as HTMLElement).getByText("Chest", { selector: ".fact" })).toBeInTheDocument();
  });

  it("reaches the exercise's history from the More sheet", () => {
    const onOpenHistory = vi.fn();
    renderScreen({ onOpenHistory });
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: "Exercise History" }));
    expect(onOpenHistory).toHaveBeenCalled();
  });
});

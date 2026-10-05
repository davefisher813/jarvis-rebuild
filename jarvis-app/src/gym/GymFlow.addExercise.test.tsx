// @vitest-environment jsdom
//
// WHAT THE ADD EXERCISE SHEET WAS TOLD, KEPT (2026-10-04). Both adds opened
// the same full editor and each saved a few of its fields:
//
//   - the library page's Add Exercise wrote a seed of name, measure and load
//     and dropped the strip, the rest timer, the warm-up ramp, the filler flag,
//     the note and the clock the sheet had just shown as set;
//   - a lift added to a finished workout dropped the same, and its muscle.
//
// The library path now carries them on the seed, and the sheet lays them back
// in when the lift is picked into a day or a session (where a rest or a ramp
// takes effect). A saved workout has no clock, rest or ramp to run, so that
// path stops drawing the rows it cannot keep, and files the muscle it was
// told where a muscle lives. Driven through the real flow and the real stores.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useGym } from "../data/NotesProvider";
import type { GymService } from "./GymService";
import type { ProgramData, WorkoutData } from "./types";
import { readGymSettings, writeGymSettings } from "./settings";
import { withCreated, type LibraryEntry } from "./library";
import ExerciseSheet from "./ExerciseSheet";
import GymFlow from "./GymFlow";

vi.mock("../shared/toast", () => ({ showToast: () => {}, hideToast: () => {} }));
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

beforeEach(() => { localStorage.clear(); });

const PROGRAM: ProgramData = {
  name: "Block",
  weeks: [{ id: "w1", label: "Week 1", days: [{ id: "d1", name: "Push", exercises: [{ id: "e1", name: "Bench Press", kind: "weight_reps", exerciseKey: "ek-bench", sets: [] }] }] }],
};
const T0 = new Date("2026-09-19T12:00:00").getTime();
const FINISHED: WorkoutData = {
  programId: "p1", dayId: "d1", dayName: "Push Day", date: "2026-09-18",
  startedAt: T0 - 86_400_000, endedAt: T0 - 86_400_000 + 47 * 60_000,
  exercises: [{ exerciseId: "bench", name: "Bench Press", kind: "weight_reps", unit: "lb", exerciseKey: "ek-bench", sets: [{ id: "s0", w: 185, r: 5 }] }],
};

let n = 0;
async function mount(flow: (gymId: string) => JSX.Element, seed?: (gym: GymService) => Promise<string | void>) {
  const user = "gym-add-ex-" + ++n;
  let gym: GymService | null = null;
  function Grab() { gym = useGym(); return null; }
  const view = render(<NotesProvider userId={user}><Grab /></NotesProvider>);
  await waitFor(() => expect(gym).toBeTruthy());
  let id = "";
  await act(async () => { await gym!.createProgram(PROGRAM); id = ((await seed?.(gym!)) as string) ?? ""; });
  view.rerender(<NotesProvider userId={user}><Grab />{flow(id)}</NotesProvider>);
  return { gym: gym! as GymService };
}

const pick = (button: string, item: string) => {
  fireEvent.click(screen.getByRole("button", { name: button }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: item }));
};
// The page lists the program's lift once it has loaded; a tap before that lands
// on a page that is about to be redrawn.
const loaded = () => screen.findByText("Bench Press", { selector: ".ex-name" }, { timeout: 4000 });
const lastCreated = () => (readGymSettings().createdLifts ?? []).at(-1)!;

describe("the library page's Add Exercise keeps what its sheet planned", () => {
  it("writes the strip, rest, ramp, filler and note onto the seed", async () => {
    await mount(() => <GymFlow startLibrary onBack={() => {}} />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Add Exercise" }));
    fireEvent.change(screen.getByLabelText("Exercise name"), { target: { value: "Zercher Squat" } });
    pick("Rest Timer", "2:00");
    fireEvent.click(screen.getByRole("switch", { name: "Warm-up ramp" }));
    fireEvent.click(screen.getByRole("switch", { name: "Filler" }));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Pause at the bottom" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(lastCreated()?.name).toBe("Zercher Squat"));
    const seed = lastCreated();
    expect(seed.plan).toMatchObject({ restSec: 120, ramp: true, filler: true, note: "Pause at the bottom" });
    // The strip the sheet showed (its default is three sets) is the plan.
    expect(seed.plan!.sets!.length).toBe(3);
  });

  it("writes a clock onto the seed", async () => {
    await mount(() => <GymFlow startLibrary onBack={() => {}} />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Add Exercise" }));
    fireEvent.change(screen.getByLabelText("Exercise name"), { target: { value: "Cindy" } });
    pick("Clock", "AMRAP");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(lastCreated()?.name).toBe("Cindy"));
    expect(lastCreated().plan).toMatchObject({ cond: { format: "amrap", capSec: 720 } });
  });
});

describe("a created lift hands its plan back when it is picked", () => {
  const seeded = (): LibraryEntry[] => withCreated([], [{
    key: "ek-z", name: "Zercher Squat", kind: "weight_reps",
    plan: { restSec: 120, ramp: true, filler: true, note: "Pause at the bottom", sets: [{ id: "a", w: 95, r: 5 }, { id: "b", w: 95, r: 5 }] },
  }, {
    key: "ek-c", name: "Cindy", kind: "rounds",
    plan: { cond: { format: "amrap", capSec: 1200 } },
  }]);

  function pickByTyping(typed: string, name: string) {
    fireEvent.focus(screen.getByLabelText("Exercise name"));
    fireEvent.change(screen.getByLabelText("Exercise name"), { target: { value: typed } });
    fireEvent.mouseDown(screen.getByText(name, { selector: ".conn-name" }));
  }

  it("the rest, ramp, filler, note and strip come back into the sheet and save", () => {
    const onSave = vi.fn();
    render(<ExerciseSheet mode="new" library={seeded()} history={[]} onSave={onSave} onCancel={() => {}} />);
    pickByTyping("Zerch", "Zercher Squat");
    expect(screen.getByRole("switch", { name: "Warm-up ramp" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Filler" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const d = onSave.mock.calls[0]![0];
    expect(d).toMatchObject({ name: "Zercher Squat", exerciseKey: "ek-z", restSec: 120, ramp: true, filler: true, note: "Pause at the bottom" });
    expect(d.sets).toHaveLength(2);
    expect(d.sets[0]).toMatchObject({ w: 95, r: 5 });
  });

  it("the clock comes back too, with its length", () => {
    const onSave = vi.fn();
    render(<ExerciseSheet mode="new" library={seeded()} history={[]} onSave={onSave} onCancel={() => {}} />);
    pickByTyping("Cind", "Cindy");
    expect(screen.getByText("20:00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0]![0].cond).toEqual({ format: "amrap", capSec: 1200 });
  });

  it("a note already typed is the athlete's and is not overwritten", () => {
    const onSave = vi.fn();
    render(<ExerciseSheet mode="new" library={seeded()} history={[]} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Heavy today" } });
    pickByTyping("Zerch", "Zercher Squat");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0]![0].note).toBe("Heavy today");
  });

  // 2026-10-05: a pick applies only the fields the plan names. A plan holds
  // no zero rest or off flag, and every created lift has one (its strip), so
  // resetting the absent ones wiped what was already set on the open sheet.
  const withPlain = (): LibraryEntry[] => [
    ...seeded(),
    ...withCreated([], [{ key: "ek-p", name: "Plain Press", kind: "weight_reps", plan: { sets: [{ id: "a", w: 45, r: 8 }] } }]),
  ];

  it("a plan that names only its strip leaves the rest, ramp and clock the athlete set", () => {
    const onSave = vi.fn();
    render(<ExerciseSheet mode="new" library={withPlain()} history={[]} onSave={onSave} onCancel={() => {}} />);
    pick("Rest Timer", "3:00");
    fireEvent.click(screen.getByRole("switch", { name: "Warm-up ramp" }));
    pickByTyping("Plain", "Plain Press");
    expect(screen.getByRole("switch", { name: "Warm-up ramp" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ exerciseKey: "ek-p", restSec: 180, ramp: true });
  });

  it("changing the pick does not leave the first lift's note on the second", () => {
    const onSave = vi.fn();
    render(<ExerciseSheet mode="new" library={withPlain()} history={[]} onSave={onSave} onCancel={() => {}} />);
    pickByTyping("Zerch", "Zercher Squat");
    expect(screen.getByLabelText("Note")).toHaveValue("Pause at the bottom");
    pickByTyping("Plain", "Plain Press");
    expect(screen.getByLabelText("Note")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ exerciseKey: "ek-p" });
    expect(onSave.mock.calls[0]![0].note).toBeFalsy();
  });
});

describe("a lift added to a finished workout", () => {
  async function open() {
    return mount(
      (id) => <GymFlow startWorkoutId={id} onBack={() => {}} />,
      async (gym) => (await gym.saveWorkout(FINISHED))!,
    );
  }

  it("does not draw the rows a saved session cannot keep", async () => {
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "Add Exercise" }, { timeout: 4000 }));
    expect(await screen.findByLabelText("Exercise name")).toBeInTheDocument();
    // What a record keeps stays.
    for (const kept of ["Measure", "Muscle"]) expect(screen.getAllByText(kept).length, kept).toBeGreaterThan(0);
    // What only a live session or a day can use does not.
    for (const gone of ["Rest Timer", "Warm-Up Ramp", "Filler", "Clock", "In the Session"]) expect(screen.queryByText(gone), gone).toBeNull();
    expect(screen.queryByLabelText("Note")).toBeNull();
  });

  it("saves the lift with its strip and files the muscle it was told in the classification", async () => {
    const { gym } = await open();
    fireEvent.click(await screen.findByRole("button", { name: "Add Exercise" }, { timeout: 4000 }));
    fireEvent.change(await screen.findByLabelText("Exercise name"), { target: { value: "Cable Fly" } });
    pick("Muscle", "Chest");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    // The muscle is where every other muscle lives, so the amber Assign
    // Muscles chip is not waiting on a lift the athlete already classified.
    await waitFor(() => expect(Object.values(readGymSettings().classByKey ?? {}).some((c) => (c as { primary?: string[] }).primary?.includes("chest"))).toBe(true));
    fireEvent.click(await screen.findByRole("button", { name: "Save Changes" }));
    await waitFor(async () => {
      const w = (await gym.listWorkouts())[0]!;
      expect(w.data.exercises.map((e) => e.name)).toContain("Cable Fly");
    });
    const w = (await gym.listWorkouts())[0]!;
    const fly = w.data.exercises.find((e) => e.name === "Cable Fly")!;
    expect(fly.sets.length).toBeGreaterThan(0);
    const key = fly.exerciseKey!;
    expect((readGymSettings().classByKey as Record<string, { primary: string[] }>)[key]!.primary).toEqual(["chest"]);
  });

  it("an already-classified lift keeps the muscle it has", async () => {
    // Bench Press is in the workout under ek-bench, classified as chest; add it again as triceps.
    writeGymSettings({ ...readGymSettings(), classByKey: { "ek-bench": { primary: ["chest"] } } as never });
    const { gym } = await open();
    fireEvent.click(await screen.findByRole("button", { name: "Add Exercise" }, { timeout: 4000 }));
    fireEvent.focus(await screen.findByLabelText("Exercise name"));
    fireEvent.change(screen.getByLabelText("Exercise name"), { target: { value: "Bench" } });
    // Picked from the library, so it carries the lift's own key.
    fireEvent.mouseDown(screen.getByText("Bench Press", { selector: ".conn-name" }));
    pick("Muscle", "Triceps");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument());
    expect(gym).toBeTruthy();
    expect((readGymSettings().classByKey as Record<string, { primary: string[] }>)["ek-bench"]!.primary).toEqual(["chest"]);
  });
});

// THE MULTI-PICK ROUTE CARRIES THE PLAN TOO (2026-10-05). "Add from Your
// Lifts" built each day exercise from the entry's measure and last strip and
// never read entry.plan, so a lift made on the library page lost its rest,
// ramp, filler, note, clock and strip on the main way of putting it on a day,
// and the seed was then dropped as a real sighting existed.
describe("Add from Your Lifts carries what the lift's sheet planned", () => {
  it("a created lift lands on the day with its rest, ramp, filler, note and strip", async () => {
    writeGymSettings({ ...readGymSettings(), createdLifts: [{
      key: "ek-z", name: "Zercher Squat", kind: "weight_reps",
      plan: { restSec: 120, ramp: true, filler: true, note: "Pause at the bottom", sets: [{ id: "a", w: 95, r: 5 }, { id: "b", w: 95, r: 5 }] },
    }] } as never);
    const { gym } = await mount(() => <GymFlow onBack={() => {}} />);
    // The program page lists its days; the day row opens its exercises.
    fireEvent.click(await screen.findByText("Push", { selector: ".row-grow .conn-name, .row-grow *" }, { timeout: 4000 }));
    fireEvent.click(await screen.findByText("Add from Your Lifts"));
    fireEvent.click(await screen.findByText("Zercher Squat", { selector: ".conn-name" }));
    fireEvent.click(screen.getByRole("button", { name: "Add 1" }));
    await waitFor(async () => {
      const day = (await gym.listPrograms())[0]!.data.weeks[0]!.days[0]!;
      expect(day.exercises.map((e) => e.name)).toContain("Zercher Squat");
    });
    const ex = (await gym.listPrograms())[0]!.data.weeks[0]!.days[0]!.exercises.find((e) => e.name === "Zercher Squat")!;
    expect(ex).toMatchObject({ exerciseKey: "ek-z", restSec: 120, ramp: true, filler: true, note: "Pause at the bottom" });
    expect(ex.sets).toHaveLength(2);
    expect(ex.sets[0]).toMatchObject({ w: 95, r: 5 });
  });
});

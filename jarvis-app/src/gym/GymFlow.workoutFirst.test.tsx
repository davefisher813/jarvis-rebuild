// @vitest-environment jsdom
//
// THE WORKOUT-FIRST FLOW (Dave 2026-10-09, items 1, 3 and 4), driven through
// the real flow and the real stores: Start Workout with no program opens the
// empty workout; exercises are added as he goes; and on the receipt the
// workout connects to a program day or becomes a program of its own, written
// through GymService, so a program actually emerges from what he logged.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useGym } from "../data/NotesProvider";
import type { GymService } from "./GymService";
import type { ProgramData, WorkoutData, WorkoutExercise } from "./types";
import { readLive, writeLive, type LiveSession } from "./liveSession";
import { readGymSettings, writeGymSettings } from "./settings";
import { SCRATCH_DAY_ID, SCRATCH_DAY_NAME } from "./nextDay";
import { todayISO } from "../tasks/grouping";
import GymFlow from "./GymFlow";

vi.mock("../shared/toast", () => ({ showToast: () => {}, hideToast: () => {} }));
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

beforeEach(() => { localStorage.clear(); });

const BENCH: WorkoutExercise = { exerciseId: "mid1", name: "Bench Press", kind: "weight_reps", unit: "lb", exerciseKey: "ek-bench", sets: [{ id: "s1", w: 185, r: 5 }, { id: "s2", w: 185, r: 5 }], custom: true, plan: [] };
const DIPS: WorkoutExercise = { exerciseId: "mid2", name: "Dips", kind: "weight_reps", unit: "lb", exerciseKey: "ek-dips", sets: [{ id: "s3", r: 12 }], custom: true, plan: [] };

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const pastScratch = (n: number): WorkoutData => {
  const startedAt = Date.now() - n * 86_400_000;
  return { programId: "", dayId: SCRATCH_DAY_ID, dayName: SCRATCH_DAY_NAME, date: daysAgo(n), startedAt, endedAt: startedAt + 40 * 60_000, exercises: [BENCH, DIPS] };
};
const liveScratch = (): LiveSession => ({
  programId: "", dayId: SCRATCH_DAY_ID, dayName: SCRATCH_DAY_NAME, date: todayISO(),
  startedAt: Date.now() - 30 * 60_000, lastActivityAt: Date.now(), idx: 1, exercises: [BENCH, DIPS],
});

let n = 0;
async function mount(seed: (gym: GymService) => Promise<void>, onBack = vi.fn()) {
  const user = "gym-workout-first-" + ++n;
  let gym: GymService | null = null;
  function Grab() { gym = useGym(); return null; }
  const view = render(<NotesProvider userId={user}><Grab /></NotesProvider>);
  await waitFor(() => expect(gym).toBeTruthy());
  await act(async () => { await seed(gym!); });
  view.rerender(<NotesProvider userId={user}><Grab /><GymFlow startDayId={SCRATCH_DAY_ID} onBack={onBack} /></NotesProvider>);
  return { gym: gym! as GymService, onBack };
}

describe("Start Workout with no program", () => {
  it("opens the empty workout; Cancel discards it and goes back", async () => {
    const { onBack } = await mount(async () => {});
    expect(await screen.findByText("Let’s Get to Work", undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText("New Workout")).toBeInTheDocument();
    expect(readLive()?.dayId).toBe(SCRATCH_DAY_ID);
    expect(readLive()?.programId).toBe("");
    // The one filled red is Add Exercise, and nothing that cannot work is drawn: no Finish.
    expect(screen.getByRole("button", { name: "Add Exercise" })).toHaveClass("btn-primary", "btn-launch");
    expect(screen.queryByRole("button", { name: "Finish" })).toBeNull();
    // No library yet, so no Suggestions to draw.
    expect(screen.queryByText("Suggestions")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(readLive()).toBeNull();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("suggests what he trained recently, and one tap adds it and opens the workout", async () => {
    writeGymSettings({ ...readGymSettings(), classByKey: { "ek-bench": { primary: ["chest"], secondary: [], tags: [], equipment: "barbell" } } });
    await mount(async (gym) => { await gym.saveWorkout(pastScratch(2)); });
    const head = (await screen.findByText("Suggestions", undefined, { timeout: 4000 })).closest(".sh2") as HTMLElement;
    const card = head.nextElementSibling as HTMLElement;
    const bench = within(card).getByText("Bench Press").closest('.row[role="button"]') as HTMLElement;
    expect([...bench.querySelectorAll(".fact")].map((f) => f.textContent)).toEqual(["Chest", "Barbell"]);
    expect(bench.querySelector(".fact.violet")?.textContent).toBe("Barbell");
    fireEvent.click(bench);
    await waitFor(() => expect(readLive()?.exercises.map((e) => e.name)).toEqual(["Bench Press"]));
    // It keeps its identity, so its history follows it.
    expect(readLive()!.exercises[0]!.exerciseKey).toBe("ek-bench");
    expect(readLive()!.exercises[0]!.equipment).toBe("barbell");
    expect(await screen.findByRole("button", { name: "Finish" })).toBeInTheDocument();
  });
});

const finishToReceipt = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Finish" }, { timeout: 4000 }));
  return (await screen.findByText("Workout Complete")).closest(".sheet-scrim") as HTMLElement;
};

describe("after the workout, the program emerges from it", () => {
  it("Save as a New Program makes a program of what he logged and saves the workout as its first", async () => {
    writeLive(liveScratch());
    const { gym, onBack } = await mount(async () => {});
    const receipt = await finishToReceipt();
    expect(within(receipt).getByText("Keep This Workout")).toBeInTheDocument();
    // No program day exists, so there is nothing to connect to and no row that cannot work.
    expect(within(receipt).queryByText("Connect to a Program")).toBeNull();
    fireEvent.click(within(receipt).getByText("Save as a New Program"));
    const name = await screen.findByLabelText("Program name");
    expect(name).toHaveValue("New Program");
    fireEvent.change(name, { target: { value: "Push Day" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await gym.listWorkouts()).length).toBe(1), { timeout: 4000 });
    const [program] = await gym.listPrograms();
    expect(program!.data.name).toBe("Push Day");
    const day = program!.data.weeks[0]!.days[0]!;
    expect(day.exercises.map((e) => [e.name, e.exerciseKey, e.sets.length])).toEqual([["Bench Press", "ek-bench", 2], ["Dips", "ek-dips", 1]]);
    const [w] = await gym.listWorkouts();
    expect(w!.data.programId).toBe(program!.id);
    expect(w!.data.dayId).toBe(day.id);
    expect(w!.data.exercises.map((e) => e.exerciseId)).toEqual(day.exercises.map((e) => e.id));
    expect(readLive()).toBeNull();
    // Started from Health, so it goes back there.
    await waitFor(() => expect(onBack).toHaveBeenCalled());
  });

  it("Connect to a Program adds it to the day he picks, each exercise once", async () => {
    const PROGRAM: ProgramData = { name: "Block", weeks: [{ id: "w1", label: "Week 1", days: [
      { id: "d1", name: "Push", exercises: [{ id: "e1", name: "Bench Press", kind: "weight_reps", exerciseKey: "ek-bench", sets: [] }] },
    ] }] };
    writeLive(liveScratch());
    const { gym } = await mount(async (g) => { await g.createProgram(PROGRAM); });
    const receipt = await finishToReceipt();
    fireEvent.click(within(receipt).getByText("Connect to a Program"));
    const picker = (await screen.findByText("Block")).closest(".sheet-scrim") as HTMLElement;
    fireEvent.click(within(picker).getByText("Push"));
    await waitFor(async () => expect((await gym.listWorkouts()).length).toBe(1), { timeout: 4000 });
    const day = (await gym.listPrograms())[0]!.data.weeks[0]!.days[0]!;
    expect(day.exercises.map((e) => e.name)).toEqual(["Bench Press", "Dips"]);
    expect(day.exercises[0]!.id).toBe("e1");
    const [w] = await gym.listWorkouts();
    expect(w!.data.dayId).toBe("d1");
    expect(w!.data.dayName).toBe("Push");
    expect(w!.data.exercises[0]!.exerciseId).toBe("e1");
  });

  it("Keep as a One-Off saves it with no program", async () => {
    writeLive(liveScratch());
    const { gym } = await mount(async () => {});
    const receipt = await finishToReceipt();
    fireEvent.click(within(receipt).getByText("Keep as a One-Off"));
    await waitFor(async () => expect((await gym.listWorkouts()).length).toBe(1), { timeout: 4000 });
    expect((await gym.listPrograms()).length).toBe(0);
    expect((await gym.listWorkouts())[0]!.data.dayId).toBe(SCRATCH_DAY_ID);
  });
});

describe("the Program Suggestion, on the third similar workout", () => {
  const seedTwo = async (gym: GymService) => { await gym.saveWorkout(pastScratch(3)); await gym.saveWorkout(pastScratch(6)); };
  const classify = () => writeGymSettings({ ...readGymSettings(), classByKey: {
    "ek-bench": { primary: ["chest"], secondary: [], tags: [] },
    "ek-dips": { primary: ["triceps"], secondary: [], tags: [] },
  } });

  it("is offered on Done, and Create Program saves it under the suggested name", async () => {
    classify();
    writeLive(liveScratch());
    const { gym } = await mount(seedTwo);
    const receipt = await finishToReceipt();
    fireEvent.click(within(receipt).getByRole("button", { name: "Done" }));
    const sheet = (await screen.findByText("Looks Like a Push Day")).closest(".sheet-scrim") as HTMLElement;
    expect(within(sheet).getByText("3 Similar Workouts")).toHaveClass("fact", "lime");
    // One fact per muscle he classified, the dot drawn by CSS.
    expect([...sheet.querySelectorAll(".facts .fact")].map((f) => f.textContent)).toEqual(["3 Similar Workouts", "Chest", "Triceps"]);
    // Nothing was written before his tap.
    expect((await gym.listPrograms()).length).toBe(0);
    fireEvent.click(within(sheet).getByText("Create Program"));
    await waitFor(async () => expect((await gym.listWorkouts()).length).toBe(3), { timeout: 4000 });
    const programs = await gym.listPrograms();
    expect(programs.map((p) => p.data.name)).toEqual(["Push Day"]);
    const newest = (await gym.listWorkouts()).find((w) => w.data.date === todayISO())!;
    expect(newest.data.programId).toBe(programs[0]!.id);
  });

  it("Not Now saves it as a one-off and does not offer the same workout again", async () => {
    classify();
    writeLive(liveScratch());
    const { gym } = await mount(seedTwo);
    const receipt = await finishToReceipt();
    fireEvent.click(within(receipt).getByRole("button", { name: "Done" }));
    const sheet = (await screen.findByText("Looks Like a Push Day")).closest(".sheet-scrim") as HTMLElement;
    fireEvent.click(within(sheet).getByText("Not Now"));
    await waitFor(async () => expect((await gym.listWorkouts()).length).toBe(3), { timeout: 4000 });
    expect((await gym.listPrograms()).length).toBe(0);
    expect(readGymSettings().declinedPatterns).toEqual(["ek-bench|ek-dips"]);
  });

  it("stays away when he turned it off in Customize", async () => {
    classify();
    writeGymSettings({ ...readGymSettings(), suggestPrograms: false });
    writeLive(liveScratch());
    const { gym } = await mount(seedTwo);
    const receipt = await finishToReceipt();
    fireEvent.click(within(receipt).getByRole("button", { name: "Done" }));
    await waitFor(async () => expect((await gym.listWorkouts()).length).toBe(3), { timeout: 4000 });
    expect(screen.queryByText("Looks Like a Push Day")).toBeNull();
  });
});

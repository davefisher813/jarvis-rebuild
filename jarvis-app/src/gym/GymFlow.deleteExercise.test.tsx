// @vitest-environment jsdom
//
// DELETE EXERCISE, END TO END THROUGH THE EXERCISES PAGE (2026-10-01).
//
// The pure half is proven in deleteExercise.test.ts. This is the half that
// can go wrong where the pieces meet: the menu item opens the confirm, the
// confirm writes through the real store, the list and the library lose the
// exercise, the toast's Undo puts every record and setting back exactly, and an
// exercise that is in a workout right now is refused.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useGym } from "../data/NotesProvider";
import type { GymService } from "./GymService";
import type { ProgramData, WorkoutData, Workout } from "./types";
import { readGymSettings, writeGymSettings, type GymSettings } from "./settings";
import { writeLive, type LiveSession } from "./liveSession";
import { shownLibraryCount, seedsFromSettings } from "./libraryView";
import GymFlow from "./GymFlow";

const showToast = vi.fn();
vi.mock("../shared/toast", () => ({ showToast: (...a: unknown[]) => showToast(...a), hideToast: () => {} }));

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const T0 = new Date("2026-09-19T12:00:00").getTime();
const sets = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, w: 100 + i, r: 5 }));
const BENCH = { id: "e1", name: "Bench Press", kind: "weight_reps" as const, exerciseKey: "ek-bench", sets: [] };
const CURL = { id: "e2", name: "Curl", kind: "weight_reps" as const, exerciseKey: "ek-curl", sets: [] };
const PROGRAM: ProgramData = {
  name: "Block", weeks: [{ id: "w1", label: "Week 1", days: [{ id: "d1", name: "Push", exercises: [BENCH, CURL] }] }],
};
const day = (n: number) => new Date(T0 - n * 86_400_000).toISOString().slice(0, 10);
const session = (n: number, exercises: WorkoutData["exercises"]): WorkoutData => ({
  programId: "p1", dayId: "d1", dayName: "Push", date: day(n), startedAt: T0 - n * 86_400_000, endedAt: T0 - n * 86_400_000 + 3_000_000, exercises,
});
const benchEx = (key: string) => ({ exerciseId: "e1", name: "Bench Press", kind: "weight_reps" as const, exerciseKey: key, unit: "lb", sets: sets(3) });
const curlEx = { exerciseId: "e2", name: "Curl", kind: "weight_reps" as const, exerciseKey: "ek-curl", unit: "lb", sets: sets(2) };

const SEED_SETTINGS = {
  createdLifts: [{ key: "ek-test", name: "Test Press", kind: "weight_reps" }],
  favoriteKeys: ["ek-test", "ek-curl"],
  aliases: { "ek-test": ["Old Press"] },
  classByKey: { "ek-test": { primary: ["chest"] }, "ek-curl": { primary: ["biceps"] } },
  muscleByKey: { "ek-test": ["chest"], "ek-curl": ["biceps"] },
} as unknown as Partial<GymSettings>;

let n = 0;
async function mount(opts: { history?: boolean } = {}) {
  const user = "gym-del-ex-" + ++n;
  let gym: GymService | null = null;
  function Grab() { gym = useGym(); return null; }
  const view = render(<NotesProvider userId={user}><Grab /></NotesProvider>);
  await waitFor(() => expect(gym).toBeTruthy());
  await act(async () => {
    await gym!.createProgram(PROGRAM);
    if (opts.history) {
      await gym!.saveWorkout(session(3, [benchEx("ek-bench"), curlEx]));
      await gym!.saveWorkout(session(2, [benchEx("ek-bench")]));
      await gym!.saveWorkout(session(1, [curlEx]));
    }
  });
  view.rerender(<NotesProvider userId={user}><Grab /><GymFlow startLibrary onBack={() => {}} /></NotesProvider>);
  return { gym: gym! as GymService };
}

const rowNamed = (name: string) => screen.queryByText(name, { selector: ".ex-name" });
const openMenu = async (name: string) => { fireEvent.click(await screen.findByRole("button", { name: `More for ${name}` })); };
const toastWith = (re: RegExp) => showToast.mock.calls.map((c) => c[0] as { message: string; actionLabel?: string; onAction?: () => void }).find((c) => re.test(c.message));
const listed = () => Array.from(document.querySelectorAll(".ex-name")).map((e) => e.textContent);

beforeEach(() => { showToast.mockReset(); localStorage.clear(); });

describe("GymFlow: Delete Exercise on a hand-made exercise nobody used", () => {
  it("opens the confirm from the row menu, deletes, and Undo restores the settings byte for byte", async () => {
    writeGymSettings({ ...readGymSettings(), ...SEED_SETTINGS });
    const before = JSON.stringify(readGymSettings());
    await mount();
    expect(await screen.findByText("Test Press", { selector: ".ex-name" })).toBeInTheDocument();
    // Bench Press, Curl and the hand-made one, once the program has loaded.
    await waitFor(() => expect(document.querySelector(".nav-count")!.textContent).toBe("3"));

    await openMenu("Test Press");
    fireEvent.click(screen.getByRole("button", { name: "Delete Exercise" }));
    // Nothing is written by asking.
    expect(JSON.stringify(readGymSettings())).toBe(before);
    const sheet = await screen.findByRole("dialog", { name: "Delete Test Press" });
    expect(within(sheet).getByText("It leaves your Exercises list")).toBeInTheDocument();
    expect(within(sheet).getByText("It also clears its muscles and details, its favorite mark and its old names")).toBeInTheDocument();

    await act(async () => { fireEvent.click(within(sheet).getByRole("button", { name: "Delete Exercise" })); });
    await waitFor(() => expect(rowNamed("Test Press")).toBeNull());
    expect(document.querySelector(".nav-count")!.textContent).toBe("2");
    const gs = readGymSettings();
    expect(gs.createdLifts).toEqual([]);
    expect(gs.favoriteKeys).toEqual(["ek-curl"]);
    expect(gs.aliases).toEqual({});
    expect(gs.classByKey).toEqual({ "ek-curl": { primary: ["biceps"] } });
    expect(gs.muscleByKey).toEqual({ "ek-curl": ["biceps"] });
    // The badge on the Health dashboard follows the same settings.
    expect(shownLibraryCount([], [], seedsFromSettings(gs))).toBe(0);

    const t = toastWith(/Test Press deleted/);
    expect(t?.actionLabel).toBe("Undo");
    await act(async () => { t!.onAction!(); });
    await waitFor(() => expect(rowNamed("Test Press")).toBeInTheDocument());
    expect(JSON.stringify(readGymSettings())).toBe(before);
    expect(toastWith(/Test Press is back/)).toBeTruthy();
  });

  it("Cancel leaves everything exactly as it was", async () => {
    writeGymSettings({ ...readGymSettings(), ...SEED_SETTINGS });
    const before = JSON.stringify(readGymSettings());
    await mount();
    await openMenu("Test Press");
    fireEvent.click(screen.getByRole("button", { name: "Delete Exercise" }));
    const sheet = await screen.findByRole("dialog", { name: "Delete Test Press" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(rowNamed("Test Press")).toBeInTheDocument();
    expect(JSON.stringify(readGymSettings())).toBe(before);
    expect(toastWith(/deleted/)).toBeUndefined();
  });
});

describe("GymFlow: Delete Exercise on one that is only in programs", () => {
  it("says how many program days, removes it from the program, and Undo puts the program back", async () => {
    const { gym } = await mount();
    const programBefore = JSON.stringify(await gym.listPrograms(true));
    await openMenu("Curl");
    fireEvent.click(screen.getByRole("button", { name: "Delete Exercise" }));
    const sheet = await screen.findByRole("dialog", { name: "Delete Curl" });
    expect(within(sheet).getByText("Used in 1 program day")).toBeInTheDocument();
    await act(async () => { fireEvent.click(within(sheet).getByRole("button", { name: "Delete Exercise" })); });
    await waitFor(() => expect(rowNamed("Curl")).toBeNull());
    const after = await gym.listPrograms(true);
    expect(after[0]!.data.weeks[0]!.days[0]!.exercises.map((e) => e.name)).toEqual(["Bench Press"]);

    await act(async () => { toastWith(/Curl deleted/)!.onAction!(); });
    await waitFor(() => expect(rowNamed("Curl")).toBeInTheDocument());
    expect(JSON.stringify(await gym.listPrograms(true))).toBe(programBefore);
  });
});

describe("GymFlow: Delete Exercise with logged history", () => {
  it("asks, then deletes the exercise and its history, removes emptied sessions, and Undo restores them all by id", async () => {
    const { gym } = await mount({ history: true });
    const workoutsBefore = await gym.listWorkouts();
    const programBefore = JSON.stringify(await gym.listPrograms(true));
    expect(workoutsBefore).toHaveLength(3);

    await openMenu("Bench Press");
    fireEvent.click(screen.getByRole("button", { name: "Delete Exercise" }));
    const sheet = await screen.findByRole("dialog", { name: "Delete Bench Press" });
    expect(within(sheet).getByText("2 sessions, 6 sets")).toBeInTheDocument();
    expect(within(sheet).getByText("1 Session left empty is removed")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Archive Instead" })).toBeInTheDocument();

    await act(async () => { fireEvent.click(within(sheet).getByRole("button", { name: "Delete Exercise and Its History" })); });
    await waitFor(() => expect(rowNamed("Bench Press")).toBeNull());
    expect(rowNamed("Curl")).toBeInTheDocument();

    const left = await gym.listWorkouts();
    expect(left).toHaveLength(2); // the Bench-only session went
    expect(left.flatMap((w) => w.data.exercises.map((e) => e.name))).toEqual(["Curl", "Curl"]);
    expect((await gym.listPrograms(true))[0]!.data.weeks[0]!.days[0]!.exercises.map((e) => e.name)).toEqual(["Curl"]);

    await act(async () => { toastWith(/Bench Press deleted/)!.onAction!(); });
    await waitFor(() => expect(rowNamed("Bench Press")).toBeInTheDocument());
    const back = await gym.listWorkouts();
    const key = (ws: Workout[]) => JSON.stringify(ws.map((w) => ({ id: w.id, data: w.data })).sort((a, b) => a.id.localeCompare(b.id)));
    expect(back.map((w) => w.id).sort()).toEqual(workoutsBefore.map((w) => w.id).sort());
    expect(key(back)).toBe(key(workoutsBefore));
    expect(JSON.stringify(await gym.listPrograms(true))).toBe(programBefore);
  });

  it("a write that fails partway keeps the sheet, says how far it got, and the retry finishes with an Undo that still restores everything", async () => {
    const { gym } = await mount({ history: true });
    const workoutsBefore = JSON.stringify((await gym.listWorkouts()).sort((a, b) => a.id.localeCompare(b.id)));
    const programBefore = JSON.stringify(await gym.listPrograms(true));
    const real = gym.removeWorkout.bind(gym);
    gym.removeWorkout = vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementation(real);

    await openMenu("Bench Press");
    fireEvent.click(screen.getByRole("button", { name: "Delete Exercise" }));
    const sheet = await screen.findByRole("dialog", { name: "Delete Bench Press" });
    await act(async () => { fireEvent.click(within(sheet).getByRole("button", { name: "Delete Exercise and Its History" })); });
    // The list has not lost it, no success is claimed, and the sheet says what landed.
    expect(await screen.findByText("Not Everything Saved")).toBeInTheDocument();
    expect(screen.getByText("2 of 3 saved, Delete Exercise finishes the rest")).toBeInTheDocument();
    expect(toastWith(/Bench Press deleted/)).toBeUndefined();
    expect(readGymSettings().classByKey ?? {}).not.toHaveProperty("ek-bench");

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Delete Exercise and Its History" })); });
    await waitFor(() => expect(rowNamed("Bench Press")).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await gym.listWorkouts()).toHaveLength(2);

    await act(async () => { toastWith(/Bench Press deleted/)!.onAction!(); });
    await waitFor(() => expect(rowNamed("Bench Press")).toBeInTheDocument());
    expect(JSON.stringify((await gym.listWorkouts()).sort((a, b) => a.id.localeCompare(b.id)))).toBe(workoutsBefore);
    expect(JSON.stringify(await gym.listPrograms(true))).toBe(programBefore);
  });

  it("Archive Instead archives it and deletes nothing", async () => {
    const { gym } = await mount({ history: true });
    await openMenu("Bench Press");
    fireEvent.click(screen.getByRole("button", { name: "Delete Exercise" }));
    const sheet = await screen.findByRole("dialog", { name: "Delete Bench Press" });
    await act(async () => { fireEvent.click(within(sheet).getByRole("button", { name: "Archive Instead" })); });
    await waitFor(() => expect(rowNamed("Bench Press")).toBeNull());
    expect(await gym.listWorkouts()).toHaveLength(3);
    const cls = readGymSettings().classByKey as Record<string, { archived?: boolean }>;
    expect(cls["ek-bench"]?.archived).toBe(true);
    expect(toastWith(/Bench Press archived/)?.actionLabel).toBe("Undo");
  });

  it("goals on the exercise are not touched", async () => {
    await mount({ history: true });
    // No goals service in this harness: the sheet simply has no goal line.
    await openMenu("Bench Press");
    fireEvent.click(screen.getByRole("button", { name: "Delete Exercise" }));
    const sheet = await screen.findByRole("dialog", { name: "Delete Bench Press" });
    expect(within(sheet).queryByText(/goal/)).toBeNull();
  });
});

describe("GymFlow: an exercise in the workout in progress cannot be deleted", () => {
  it("is refused with 'In your workout right now', and nothing opens or changes", async () => {
    const live: LiveSession = {
      programId: "p1", dayId: "d1", dayName: "Push", date: day(0), startedAt: Date.now() - 60_000, idx: 0,
      exercises: [benchEx("ek-bench")], pausedAt: Date.now() - 30_000,
    } as LiveSession;
    writeLive(live);
    const { gym } = await mount();
    const programBefore = JSON.stringify(await gym.listPrograms(true));
    await openMenu("Bench Press");
    fireEvent.click(screen.getByRole("button", { name: "Delete Exercise" }));
    expect(toastWith(/In your workout right now/)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(rowNamed("Bench Press")).toBeInTheDocument();
    expect(JSON.stringify(await gym.listPrograms(true))).toBe(programBefore);

    // An exercise that is not in the workout is still deletable.
    showToast.mockReset();
    await openMenu("Curl");
    fireEvent.click(screen.getByRole("button", { name: "Delete Exercise" }));
    expect(await screen.findByRole("dialog", { name: "Delete Curl" })).toBeInTheDocument();
    expect(listed()).toContain("Curl");
  });
});

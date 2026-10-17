// @vitest-environment jsdom
//
// THE PROGRAM PAGE AND THE DAY PAGE, AFTER DAVE'S 2026-10-16 PASS, driven
// through the real flow and the real stores:
//
//   P.  the exercise count on the program page is the Exercises page's default
//       view, the same number the Health hub shows (archived and hidden out);
//   R.  an add to a day shows on the very next render, before the store
//       answers, and a failed write puts the old list back;
//   T.  warm-up and cool-down frame the exercise list with one anatomy, the
//       wash waits for content, and Same as Last Time and Log a Past Workout
//       are real buttons.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useGym } from "../data/NotesProvider";
import type { GymService } from "./GymService";
import type { ProgramData, WorkoutData } from "./types";
import { readGymSettings, writeGymSettings } from "./settings";
import { shownLibraryCount, seedsFromSettings } from "./libraryView";
import GymFlow from "./GymFlow";

vi.mock("../shared/toast", () => ({ showToast: () => {}, hideToast: () => {} }));
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

beforeEach(() => { localStorage.clear(); });

const PROGRAM: ProgramData = {
  name: "Block",
  weeks: [{ id: "w1", label: "Week 1", days: [{
    id: "d1", name: "Push",
    exercises: [
      { id: "e1", name: "Bench Press", kind: "weight_reps", exerciseKey: "ek-bench", sets: [{ id: "s1", w: 185, r: 5 }] },
      { id: "e2", name: "Cable Curls", kind: "weight_reps", exerciseKey: "ek-curl", sets: [{ id: "s2", w: 40, r: 12 }] },
      { id: "e3", name: "Dips", kind: "weight_reps", exerciseKey: "ek-dips", sets: [{ id: "s3", r: 12 }] },
    ],
  }] }],
};
const T0 = new Date("2026-09-19T12:00:00").getTime();
const PAST: WorkoutData = {
  programId: "p1", dayId: "d1", dayName: "Push", date: "2026-09-18",
  startedAt: T0 - 86_400_000, endedAt: T0 - 86_400_000 + 47 * 60_000,
  exercises: [{ exerciseId: "e1", name: "Bench Press", kind: "weight_reps", unit: "lb", exerciseKey: "ek-bench", sets: [{ id: "s0", w: 185, r: 5 }] }],
};

let n = 0;
async function mount(seed?: (gym: GymService) => Promise<void>, program: ProgramData = PROGRAM) {
  const user = "gym-day-page-" + ++n;
  let gym: GymService | null = null;
  function Grab() { gym = useGym(); return null; }
  const view = render(<NotesProvider userId={user}><Grab /></NotesProvider>);
  await waitFor(() => expect(gym).toBeTruthy());
  await act(async () => { await gym!.createProgram(program); await seed?.(gym!); });
  view.rerender(<NotesProvider userId={user}><Grab /><GymFlow onBack={() => {}} /></NotesProvider>);
  return { gym: gym! as GymService };
}
const openDay = async () => {
  // The Days card lists the day before Recent lists its workout; the first "Push" is the day row.
  const rows = await screen.findAllByText("Push", { selector: ".row-grow .conn-name, .row-grow *" }, { timeout: 4000 });
  fireEvent.click(rows[0]!);
  await screen.findByText("Add Exercise");
};

describe("P: the program page's exercise count is the Exercises page's default view", () => {
  it("leaves out an archived exercise, and says the number the Health hub says", async () => {
    writeGymSettings({ ...readGymSettings(), classByKey: { "ek-curl": { primary: [], secondary: [], tags: [], archived: true } } });
    const { gym } = await mount();
    const row = await screen.findByText("Your Exercises", undefined, { timeout: 4000 });
    const count = row.closest(".row")!.querySelector(".row-value .fact b")!;
    const programs = await gym.listPrograms(true);
    expect(shownLibraryCount(programs, [], seedsFromSettings(readGymSettings()))).toBe(2);
    expect(count).toHaveTextContent("2 Exercises");
  });
});

describe("R: a program edit shows at once", () => {
  it("the day lists the added exercise on the next render, before the store answers", async () => {
    const { gym } = await mount();
    await openDay();
    // The store is held open: the write never answers inside this test.
    const held = vi.spyOn(gym, "updateProgram").mockImplementation(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "Add Exercise" }));
    fireEvent.click(await screen.findByText("New Exercise"));
    fireEvent.change(await screen.findByLabelText("Exercise name"), { target: { value: "Zercher Squat" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    expect(held).toHaveBeenCalledTimes(1);
    // On screen already, with the write still in flight.
    expect(screen.getByText("Zercher Squat", { selector: ".conn-name" })).toBeInTheDocument();
    held.mockRestore();
  });

  it("a write that fails puts the old list back", async () => {
    const { gym } = await mount();
    await openDay();
    const failed = vi.spyOn(gym, "updateProgram").mockRejectedValue(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Add Exercise" }));
    fireEvent.click(await screen.findByText("New Exercise"));
    fireEvent.change(await screen.findByLabelText("Exercise name"), { target: { value: "Zercher Squat" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    await waitFor(() => expect(screen.queryByText("Zercher Squat", { selector: ".conn-name" })).toBeNull());
    expect(failed).toHaveBeenCalled();
    failed.mockRestore();
  });
});

describe("T: the day page's blocks and its log actions", () => {
  it("warm-up above the exercises, cool-down straight under them, both heads toned, no wash until there is content", async () => {
    await mount();
    await openDay();
    const warm = screen.getByText("Warm-Up").closest(".card")!;
    const cool = screen.getByText("Cool-Down").closest(".card")!;
    expect(screen.getByText("Warm-Up")).toHaveClass("eyebrow", "eyebrow-warn");
    expect(screen.getByText("Cool-Down")).toHaveClass("eyebrow", "eyebrow-cool");
    // Empty: the label keeps its hue, the card has no wash.
    expect(warm).not.toHaveClass("banner-warn");
    expect(cool).not.toHaveClass("banner-cool");
    // The same action in the same place on both.
    expect(warm.querySelector(".row .see-all")).toHaveTextContent("Add");
    expect(cool.querySelector(".row .see-all")).toHaveTextContent("Add");
    // Order: warm-up, the Exercises head, the list, the cool-down, then the disclosure and the rest.
    const all = Array.from(document.body.querySelectorAll("*"));
    const at = (el: Element) => all.indexOf(el);
    const list = screen.getByText("Bench Press", { selector: ".conn-name" }).closest(".list-card")!;
    const head = screen.getByText("Exercises", { selector: ".sh2 .t" });
    const about = screen.getByText("About Changes to This Workout");
    expect(at(warm)).toBeLessThan(at(head));
    expect(at(head)).toBeLessThan(at(list));
    expect(at(list)).toBeLessThan(at(cool));
    expect(at(cool)).toBeLessThan(at(about));
  });

  it("a block with content wears its wash", async () => {
    const week = PROGRAM.weeks[0]!;
    const withBlocks: ProgramData = { ...PROGRAM, weeks: [{ ...week, days: [{ ...week.days[0]!, warmUp: [{ id: "b1", name: "Bike", amount: "5 Min" }], coolDown: [{ id: "b2", name: "Stretch" }] }] }] };
    await mount(undefined, withBlocks);
    await openDay();
    expect(screen.getByText("Warm-Up").closest(".card")).toHaveClass("banner-warn");
    expect(screen.getByText("Cool-Down").closest(".card")).toHaveClass("banner-cool");
    expect(screen.getByText("Bike")).toBeInTheDocument();
    expect(screen.getByText("Stretch")).toBeInTheDocument();
  });

  it("Same as Last Time and Log a Past Workout are real secondary buttons under Start", async () => {
    await mount(async (gym) => { await gym.saveWorkout(PAST); });
    await openDay();
    const same = await screen.findByRole("button", { name: "Same as Last Time" });
    const past = screen.getByRole("button", { name: "Log a Past Workout" });
    for (const b of [same, past]) {
      expect(b).toHaveClass("btn", "btn-secondary", "btn-block");
      expect(b).not.toHaveClass("row-create");
    }
    expect(same.closest(".gym-log")).toBe(past.closest(".gym-log"));
    expect(screen.getByRole("button", { name: "Start Push" }).closest(".gym-log")).toBe(same.closest(".gym-log"));
  });
});

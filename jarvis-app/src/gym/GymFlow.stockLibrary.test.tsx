// @vitest-environment jsdom
//
// DAVE'S THREE LIBRARY ANSWERS (2026-10-17), driven through the real flow and
// the real stores:
//
//   3. the Exercises page lists every exercise, stock and custom, and a
//      starter is written only when he touches it, through the flow's one
//      door (adoptStarters);
//   4. the create sheet's name typeahead reaches the catalog, and a starter
//      picked there lands with its key and every muscle, the save's own seed
//      and equipment kept;
//   5. the day-fill picker takes a typed name as well as picks, landing on the
//      day's own new-exercise sheet.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useGym } from "../data/NotesProvider";
import type { GymService } from "./GymService";
import type { ProgramData } from "./types";
import { readGymSettings } from "./settings";
import { readClassStore } from "./classify";
import GymFlow from "./GymFlow";

vi.mock("../shared/toast", () => ({ showToast: () => {}, hideToast: () => {} }));
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

beforeEach(() => { localStorage.clear(); });

const PROGRAM: ProgramData = {
  name: "Block",
  weeks: [{ id: "w1", label: "Week 1", days: [{
    id: "d1", name: "Push",
    exercises: [{ id: "e1", name: "Bench Press", kind: "weight_reps", unit: "lb", exerciseKey: "ek-bench", sets: [{ id: "s1", w: 185, r: 5 }] }],
  }] }],
};

let n = 0;
async function mount(flow: JSX.Element) {
  const user = "gym-stock-" + ++n;
  let gym: GymService | null = null;
  function Grab() { gym = useGym(); return null; }
  const view = render(<NotesProvider userId={user}><Grab /></NotesProvider>);
  await waitFor(() => expect(gym).toBeTruthy());
  await act(async () => { await gym!.createProgram(PROGRAM); });
  view.rerender(<NotesProvider userId={user}><Grab />{flow}</NotesProvider>);
  return { gym: gym! as GymService };
}
const created = () => readGymSettings().createdLifts ?? [];
const classes = () => { const gs = readGymSettings(); return readClassStore(gs.classByKey, gs.muscleByKey); };
const ownList = () => document.querySelector(".sh2 + .pad-x .list-card-ruled") as HTMLElement;

describe("3: the Exercises page is stock and custom", () => {
  it("lists his lifts once and the catalog under its muscle heads, writing nothing by showing it", async () => {
    await mount(<GymFlow startLibrary onBack={() => {}} />);
    await screen.findByText("Deadlift", { selector: ".ex-name" }, { timeout: 4000 });
    // His Bench Press, once, in his list; the catalog's copy is not offered beside it.
    expect(screen.getAllByText("Bench Press", { selector: ".ex-name" })).toHaveLength(1);
    expect(within(ownList()).getByText("Bench Press")).toBeInTheDocument();
    expect(screen.getByText("Back", { selector: ".sh2 .t" })).toBeInTheDocument();
    // The badge counts his own.
    expect(document.querySelector(".nav-count")).toHaveTextContent("1");
    expect(created()).toEqual([]);
    expect(classes()).toEqual({});
  });

  it("hiding a starter adopts it with its muscles, then hides the adopted exercise", async () => {
    await mount(<GymFlow startLibrary onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "More for Deadlift" }, { timeout: 4000 }));
    fireEvent.click(screen.getByRole("button", { name: "Hide From Suggestions" }));
    const seed = created().find((c) => c.name === "Deadlift")!;
    expect(seed).toBeTruthy();
    expect(classes()[seed.key]).toMatchObject({ primary: ["back"], secondary: ["glutes", "hamstrings", "forearms"] });
    expect(readGymSettings().hiddenKeys).toContain(seed.key);
    // His now, and hidden: off the page by default, and the catalog does not offer it back.
    await waitFor(() => expect(screen.queryByText("Deadlift", { selector: ".ex-name" })).toBeNull());
  });
});

describe("4: the create sheet's typeahead reaches the catalog", () => {
  it("a starter picked there is saved once, under its adopted key, with every muscle and the sheet's own plan", async () => {
    await mount(<GymFlow startLibrary onBack={() => {}} />);
    await screen.findByText("Bench Press", { selector: ".ex-name" }, { timeout: 4000 });
    fireEvent.click(screen.getByRole("button", { name: "Add Exercise" }));
    fireEvent.focus(screen.getByLabelText("Exercise name"));
    fireEvent.change(screen.getByLabelText("Exercise name"), { target: { value: "incline" } });
    const nameCard = screen.getByLabelText("Exercise name").closest(".xs-group") as HTMLElement;
    fireEvent.mouseDown(within(nameCard).getByText("Incline Bench Press"));
    fireEvent.click(screen.getByRole("switch", { name: "Warm-up ramp" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(created().filter((c) => c.name === "Incline Bench Press")).toHaveLength(1));
    const seed = created().find((c) => c.name === "Incline Bench Press")!;
    // The save's own seed survived the adoption (its plan is the sheet's).
    expect(seed.plan).toMatchObject({ ramp: true });
    // And the adoption filled in the catalog's secondaries behind the primary.
    expect(classes()[seed.key]).toMatchObject({ primary: ["chest"], secondary: ["shoulders", "triceps"] });
    // His now: in his list, and gone from the catalog's.
    await waitFor(() => expect(within(ownList()).getByText("Incline Bench Press")).toBeInTheDocument());
    expect(screen.getAllByText("Incline Bench Press", { selector: ".ex-name" })).toHaveLength(1);
  });
});

describe("5: the day-fill picker takes picks and a typed name", () => {
  const openFill = async () => {
    const rows = await screen.findAllByText("Push", { selector: ".row-grow .conn-name, .row-grow *" }, { timeout: 4000 });
    fireEvent.click(rows[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "Add Exercise" }));
    fireEvent.click(await screen.findByText("Add from Your Exercises"));
  };

  it("offers Use Anyway, and lands the typed name on the day's new-exercise sheet", async () => {
    const { gym } = await mount(<GymFlow onBack={() => {}} />);
    await openFill();
    fireEvent.change(screen.getByLabelText("Search Exercises"), { target: { value: "landmine twist" } });
    fireEvent.click(screen.getByRole("button", { name: /Use .landmine twist. Anyway/ }));
    expect(await screen.findByText("New Exercise")).toBeInTheDocument();
    expect(screen.getByLabelText("Exercise name")).toHaveValue("Landmine Twist");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    await waitFor(async () => {
      const [p] = await gym.listPrograms(true);
      expect(p!.data.weeks[0]!.days[0]!.exercises.map((e) => e.name)).toEqual(["Bench Press", "Landmine Twist"]);
    });
  });

  it("what was ticked first is added too, not thrown away", async () => {
    const { gym } = await mount(<GymFlow onBack={() => {}} />);
    await openFill();
    fireEvent.change(screen.getByLabelText("Search Exercises"), { target: { value: "deadlift" } });
    fireEvent.click(screen.getByText("Deadlift", { selector: ".conn-name" }));
    fireEvent.change(screen.getByLabelText("Search Exercises"), { target: { value: "landmine twist" } });
    fireEvent.click(screen.getByRole("button", { name: /Use .landmine twist. Anyway/ }));
    expect(await screen.findByLabelText("Exercise name")).toHaveValue("Landmine Twist");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    await waitFor(async () => {
      const [p] = await gym.listPrograms(true);
      expect(p!.data.weeks[0]!.days[0]!.exercises.map((e) => e.name)).toEqual(["Bench Press", "Deadlift", "Landmine Twist"]);
    });
    // The ticked starter was adopted through the door, with its muscles.
    const seed = created().find((c) => c.name === "Deadlift")!;
    expect(classes()[seed.key]).toMatchObject({ primary: ["back"] });
  });
});

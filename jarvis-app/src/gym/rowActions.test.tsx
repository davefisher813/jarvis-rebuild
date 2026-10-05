// @vitest-environment jsdom
//
// CLEAN ROWS IN THE GYM (Dave 2026-10-05, locked; docs/jarvis-unified/ROW-ACTIONS-SPEC.md).
//
//   tap          the row's own door
//   swipe left   the row's ONE quick verb, then Delete behind it (a day: Start; a lift: Favorite or Assign Muscles; a set: Skip)
//   long press   the menu
//   no pill in a row or a card; a section's Add is its head's capsule (or a sheet group's label row)
//
// Driven through the real components and the real stores, and read from the DOM they draw.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useGym } from "../data/NotesProvider";
import { capsulesInCards } from "../laws/catalogCheck";
import type { GymService } from "./GymService";
import type { Exercise, ProgramData, SetEntry, Workout } from "./types";
import GymFlow from "./GymFlow";
import SessionScreen from "./SessionScreen";
import SetStrip from "./SetStrip";
import ClassifySheet from "./ClassifySheet";
import GymSwipeRow from "./GymSwipeRow";
import { EMPTY_CLASS } from "./classify";
import type { LiveSession } from "./liveSession";

vi.mock("../shared/toast", () => ({ showToast: vi.fn(), hideToast: vi.fn(), subscribeToast: vi.fn() }));
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

beforeEach(() => { localStorage.clear(); });

const PROGRAM: ProgramData = {
  name: "Block",
  weeks: [{
    id: "w1", label: "Week 1", days: [
      { id: "d1", name: "Push", exercises: [{ id: "e1", name: "Bench Press", kind: "weight_reps", exerciseKey: "ek-bench", sets: [] }] },
      { id: "d2", name: "Rest Day", exercises: [] },
    ],
  }],
};

let n = 0;
async function mountFlow() {
  const user = "gym-row-actions-" + ++n;
  let gym: GymService | null = null;
  function Grab() { gym = useGym(); return null; }
  const view = render(<NotesProvider userId={user}><Grab /></NotesProvider>);
  await waitFor(() => expect(gym).toBeTruthy());
  await act(async () => { await gym!.createProgram(PROGRAM); });
  view.rerender(<NotesProvider userId={user}><Grab /><GymFlow onBack={() => {}} /></NotesProvider>);
  await screen.findByText("Push", { selector: ".conn-name.truncate" }, { timeout: 4000 });
  return view;
}

describe("the program page", () => {
  it("a day is a clean row: swipe left is Start then Delete, and Add Day is the Days head's capsule", async () => {
    const { container } = await mountFlow();
    const add = screen.getByRole("button", { name: "Add Day" });
    expect(add.closest(".sh2"), "Add Day lives in the head").not.toBeNull();
    expect(add.closest(".card")).toBeNull();
    expect(container.querySelector(".row-create"), "no create row at the foot of any list").toBeNull();
    const tray = (name: string) => [...screen.getByText(name, { selector: ".conn-name.truncate" }).closest(".task-swipe")!.querySelectorAll(":scope > button")].map((b) => b.getAttribute("aria-label"));
    expect(tray("Push")).toEqual(["Start Push", "Delete Push"]);
    // A day with nothing in it has nothing to start: it never invents a verb, and Delete is all it holds.
    expect(tray("Rest Day")).toEqual(["Delete Rest Day"]);
    expect(capsulesInCards(container)).toEqual([]);
  });

  it("a day with exercises opens its screen, where Add is the Exercises head's capsule and the card holds only rows", async () => {
    const { container } = await mountFlow();
    fireEvent.click(screen.getByText("Push", { selector: ".conn-name.truncate" }));
    const add = await screen.findByRole("button", { name: "Add Exercise" });
    expect(add.closest(".sh2"), "Add Exercise lives in the head").not.toBeNull();
    expect(add.closest(".card")).toBeNull();
    expect(container.querySelector(".row-create:not(.row-create-bare)"), "the two doors are not rows in the card").toBeNull();
    expect(capsulesInCards(container)).toEqual([]);
  });
});

const EX: Exercise = {
  id: "e1", name: "Lateral Shoulder Raise", kind: "weight_reps", unit: "lb", exerciseKey: "k-lat",
  sets: [{ id: "p1", w: 20, r: 10 }, { id: "p2", w: 20, r: 10 }],
};
const live = (logged: SetEntry[]): LiveSession => ({
  programId: "p", dayId: "d1", dayName: "Auxiliary Day", date: "2026-09-26", startedAt: 0, idx: 0,
  exercises: [{ exerciseId: "e1", name: "Lateral Shoulder Raise", kind: "weight_reps", unit: "lb", exerciseKey: "k-lat", sets: logged }],
});
const workouts: Workout[] = [];

describe("the live session", () => {
  const renderScreen = (over: Partial<Parameters<typeof SessionScreen>[0]> = {}) => render(
    <SessionScreen
      live={live([])} exercise={EX} dayExercises={[EX]}
      programDay={{ id: "d1", name: "Auxiliary Day", exercises: [EX], warmUp: [{ id: "b1", name: "Bike, easy" }], warmUpMin: 5 }}
      history={workouts} library={[]}
      onLog={() => {}} onSetLogged={() => {}} onSkip={() => {}} onMove={() => {}} onSwap={() => {}} onAddMidSession={() => {}}
      onFit={() => {}} onFinish={() => {}} onBack={() => {}} onCancel={() => {}}
      {...over}
    />,
  );

  it("Add Exercise is This Session's head capsule and Cancel Workout stands under the list, not inside the card", () => {
    const { container } = renderScreen();
    const add = screen.getByRole("button", { name: "Add Exercise" });
    expect(add.closest(".sh2")).not.toBeNull();
    expect(add.closest(".card")).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel Workout" }).closest(".card")).toBeNull();
    expect(container.querySelector(".row-create")).toBeNull();
    expect(capsulesInCards(container)).toEqual([]);
  });

  it("the warm-up's skip is its label row's, not a row at the foot of its card", () => {
    const onFit = vi.fn();
    const { container } = renderScreen({ onFit });
    const skip = screen.getByRole("button", { name: "Skip the Warm-Up" });
    expect(skip.parentElement!.className).toBe("grp");
    expect(container.querySelector(".card .row-create")).toBeNull();
    fireEvent.click(skip);
    expect(onFit).toHaveBeenCalledWith({ warmSkipped: true });
  });
});

describe("a set", () => {
  const entries: SetEntry[] = [{ id: "a", w: 185, r: 5 }, { id: "b", w: 185, r: 5 }];
  const strip = (extra: Partial<Parameters<typeof SetStrip>[0]> = {}) => {
    const onChange = vi.fn();
    const view = render(<SetStrip kind="weight_reps" unit="lb" entries={entries} onChange={onChange} {...extra} />);
    return { ...view, onChange };
  };

  it("swipe left is Skip, then Delete, and its editor's Duplicate and Skip ride its label row", () => {
    const { container, onChange } = strip();
    const tray = [...container.querySelector(".task-swipe")!.querySelectorAll(":scope > button")].map((b) => b.getAttribute("aria-label"));
    expect(tray).toEqual(["Skip set 1", "Delete set 1"]);
    fireEvent.click(screen.getByLabelText("Skip set 1"));
    expect(onChange.mock.calls[0]![0][0]).toMatchObject({ id: "a", skipped: true });
    fireEvent.click(container.querySelector(".set-chip")!);
    const dup = screen.getByRole("button", { name: "Duplicate" });
    expect(dup.closest(".grp-acts")!.parentElement!.className).toBe("grp");
    expect(container.querySelector(".set-chip-editor .pill-act, .set-chip-editor .row-pair")).toBeNull();
    expect(capsulesInCards(container)).toEqual([]);
  });

  it("Add a Set is the strip's label row's capsule, never a row at its foot", () => {
    const { container, onChange } = strip();
    const add = screen.getByRole("button", { name: "Add Set" });
    expect(add.parentElement!.className).toBe("grp");
    expect(container.querySelector(".row-create")).toBeNull();
    fireEvent.click(add);
    expect(onChange.mock.calls[0]![0]).toHaveLength(3);
  });
});

describe("the exercise's archive state", () => {
  it("is a switch on its row, not an Archive or Restore capsule, and the row flips it", () => {
    const onSave = vi.fn();
    const { baseElement } = render(
      <ClassifySheet name="Barbell Row" initial={EMPTY_CLASS} todayIso="2026-09-17" onSave={onSave} onCancel={() => {}} />,
    );
    fireEvent.click(screen.getByText("More Details"));
    const sw = baseElement.querySelector('[role="switch"][aria-label="Archived"]')!;
    expect(sw, "the archive state is a switch").not.toBeNull();
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(sw.closest(".row")!.querySelector(".pill-act")).toBeNull();
    expect(baseElement.querySelector(".pill-act")).toBeNull();
    // The whole row is the control; nothing is written until Save.
    fireEvent.click(sw.closest(".row")!);
    expect(baseElement.querySelector('[role="switch"][aria-label="Archived"]')!.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0]![0].archived).toBe(true);
  });
});

describe("the gym's swipe row", () => {
  it("lays the verb at the edge and Delete one slot in, naming the record on both", () => {
    const run = vi.fn();
    const del = vi.fn();
    const { container } = render(
      <GymSwipeRow name="Push" verb={{ label: "Start", icon: null, run }} onDelete={del}><div className="row">Push</div></GymSwipeRow>,
    );
    const [verb, trash] = [...container.querySelectorAll(".task-swipe > button")];
    expect(verb!.className).toContain("task-verb");
    expect(trash!.className).toContain("task-del");
    expect(verb!.getAttribute("aria-label")).toBe("Start Push");
    expect(trash!.getAttribute("aria-label")).toBe("Delete Push");
    fireEvent.click(verb!);
    expect(run).toHaveBeenCalled();
    fireEvent.click(trash!);
    expect(del).toHaveBeenCalled();
  });

  it("a long press opens its menu with every action again", () => {
    const pick = vi.fn();
    const { container } = render(
      <GymSwipeRow name="Push" menu={[{ label: "Review Merge", onPick: pick }, { label: "Keep Separate", onPick: vi.fn() }]}>
        <div className="row">Push</div>
      </GymSwipeRow>,
    );
    fireEvent.contextMenu(container.querySelector(".row")!);
    const sheet = document.querySelector(".action-sheet") as HTMLElement;
    expect([...sheet.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Review Merge", "Keep Separate"]);
    fireEvent.click(within(sheet).getByText("Review Merge"));
    expect(pick).toHaveBeenCalled();
  });
});

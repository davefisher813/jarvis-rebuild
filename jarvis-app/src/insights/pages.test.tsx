// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import InsightsPage from "./InsightsPage";
import AllDataPage from "./AllDataPage";
import AssignMusclesSheet from "./AssignMusclesSheet";
import { allRecords } from "./records";
import { periodFor } from "./analytics";
import type { Workout } from "../gym/types";
import type { MetricDef } from "../gym/metrics";

// The approved Health design (2026-09-14): Insights is a page whose period
// drives its cards, All Data is a browser whose filters the caller keeps,
// and Assign Muscles writes one map with a batch and per-row choices.
const T = (iso: string, h: number) => new Date(`${iso}T${String(h).padStart(2, "0")}:00:00`).getTime();
const w = (id: string, date: string, wgt: number, key = "k1", name = "Incline Bench"): Workout =>
  ({ id, data: { programId: "p", dayId: "d", dayName: "Push", date, startedAt: T(date, 18), endedAt: T(date, 19), exercises: [{ exerciseId: "e", exerciseKey: key, name, kind: "weight_reps", unit: "lb", sets: [{ id: "s", w: wgt, r: 5, at: T(date, 18) + 60000 }] }] } }) as Workout;
const sleep: MetricDef = { id: "m1", data: { name: "Sleep", type: "number", unit: "hrs", presetKey: "sleep", createdOn: "2026-09-01" } };
const logs = [{ id: "l1", data: { metricId: "m1", date: "2026-09-12", value: 7, at: 1 } }, { id: "l2", data: { metricId: "m1", date: "2026-09-13", value: 8, at: 1 } }];
const none = { callIt: [], pointAtIt: [], meals: [], tookIt: [], checkins: [] };
const today = "2026-09-14";

describe("InsightsPage", () => {
  const workouts = [w("a", "2026-08-31", 125), w("b", "2026-09-07", 130), w("c", "2026-09-13", 135)];
  it("leads with the comparable gain, shows the unassigned sets and the nights, and opens the records", () => {
    const onOpenLift = vi.fn(), onOpenWorkout = vi.fn(), onAssign = vi.fn(), onAll = vi.fn();
    render(<InsightsPage view="insights" onView={() => {}} today={today} workouts={workouts} metricDefs={[sleep]} metricLogs={logs} logs={none} muscleMap={new Map()} cards={null}
      onOpenLift={onOpenLift} onOpenWorkout={onOpenWorkout} onOpenAllData={onAll} onAssignMuscles={onAssign} onExport={() => {}} />);
    expect(screen.getByText("Incline Bench")).toBeInTheDocument();
    expect(screen.getAllByText("135 Lb").length).toBeGreaterThan(0);
    expect(screen.getByText("+10 Lb Since Aug 31")).toBeInTheDocument();
    expect(screen.getByText("3 Comparable Sessions")).toBeInTheDocument();
    // The chart's points open their session, and the list twin is there.
    fireEvent.click(screen.getByRole("button", { name: "Sep 7, 130 lb, open the session" }));
    expect(onOpenWorkout).toHaveBeenCalledWith("b");
    expect(screen.getByText("As a List")).toBeInTheDocument();
    // Unassigned sets are shown, not dropped, with the coverage stated.
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    // Casing sweep 1 (2026-09-26): Title Case by the whole rule (§H2), units spelled "Min".
    expect(screen.getByText("0 of 1 Working Sets Mapped")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Assign Muscles"));
    expect(onAssign).toHaveBeenCalledWith([{ name: "Incline Bench", exerciseKey: "k1", sets: 1 }]);
    // Sleep over the nights logged, never a zero for a night not logged.
    expect(screen.getByText("7h 30m")).toBeInTheDocument();
    expect(screen.getByText("Average Across 2 Logged Nights of 7")).toBeInTheDocument();
    fireEvent.click(screen.getByText("View Sleep Logs"));
    expect(onAll).toHaveBeenCalledWith("sleep", expect.objectContaining({ key: "7d" }));
  });
  it("changes every card with the period, and labels a chart that spans more than it", () => {
    render(<InsightsPage view="insights" onView={() => {}} today={today} workouts={workouts} metricDefs={[sleep]} metricLogs={logs} logs={none} muscleMap={new Map([["k1", ["chest"]]])} cards={null}
      onOpenLift={() => {}} onOpenWorkout={() => {}} onOpenAllData={() => {}} onAssignMuscles={() => {}} onExport={() => {}} />);
    expect(screen.getByText("1 of 1 Working Sets Mapped")).toBeInTheDocument();
    fireEvent.click(screen.getByText("30 Days"));
    expect(screen.getByText("3 of 3 Working Sets Mapped")).toBeInTheDocument();
    // AMENDED 2026-09-16: the basis is kept, not printed on the card's face
    // (Dave: "this is not a manual"). <details> renders its content whether or
    // not it is open, so the law still reads the words; what changed is that
    // they are behind a summary that names the question.
    expect(screen.getByText("What Is Being Compared")).toBeInTheDocument();
    expect(screen.getByText(/Spans the Sessions, Not Only This Period/)).toBeInTheDocument();
    // THE CATALOG (Dave 2026-10-05): the basis lines are Title Case, like every other fact line.
    expect(screen.getByText("Same Exercise, Same Equipment, Same Unit, Same Rep Count")).toBeInTheDocument();
    expect(screen.getByText("First Muscle Whole, the Rest Half, by the App's Convention")).toBeInTheDocument();
    expect(screen.getByText("Working Sets Only, Warm-Ups Not Counted")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Strength" }));
    expect(screen.getByText("3 Sessions in the Period")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Rest and Readings" }));
    // AMENDED 2026-09-16 (Dave's Rest and Readings screenshot). The row said
    // "Not logged · No log in 7 days" -- the same fact twice -- and the logged
    // form ran to three clauses whose third was the second subtracted from the
    // period. Two facts: when it last happened, and how much of the window is
    // covered.
    expect(screen.getByText(/2 of 30 Days/)).toBeInTheDocument();
    expect(screen.queryByText(/without a log/), "the subtraction is not printed").toBeNull();
  });
  // THE OVERVIEW CARD IS A CHOICE (Dave 2026-09-18: "I have no way to select
  // exercises"). It picked the biggest comparable change and showed it, full
  // stop: the one exercise on the page you could not change. The pick is
  // still the default, and it says on the card that it is one.
  it("lets the overview card be pointed at any exercise, and back at the default", () => {
    const two = [...workouts, w("d", "2026-09-08", 95, "k2", "Lat Pull Down"), w("e", "2026-09-12", 115, "k2", "Lat Pull Down")];
    const onOpenLift = vi.fn();
    render(<InsightsPage view="insights" onView={() => {}} today={today} workouts={two} metricDefs={[sleep]} metricLogs={logs} logs={none} muscleMap={new Map()} cards={null}
      onOpenLift={onOpenLift} onOpenWorkout={() => {}} onOpenAllData={() => {}} onAssignMuscles={() => {}} onExport={() => {}} />);
    // The default, and the card says it chose its own subject.
    const head = () => document.querySelector(".ins-card .ins-head")!;
    expect(head()).toHaveTextContent("Incline Bench");
    expect(screen.getByText("Biggest Gain")).toBeInTheDocument();

    // Point it somewhere else: the head names it and the numbers follow.
    fireEvent.click(screen.getAllByLabelText("Choose exercise")[0]!);
    fireEvent.click(screen.getByText("Lat Pull Down"));
    expect(head()).toHaveTextContent("Lat Pull Down");
    expect(screen.getByText("+20 Lb Since Sep 8")).toBeInTheDocument();
    // A chosen exercise is not the automatic pick, so it stops claiming to be.
    expect(screen.queryByText("Biggest Gain")).toBeNull();
    // And View Sets still opens the exercise it is now about.
    fireEvent.click(screen.getAllByText("View Sets")[0]!);
    expect(onOpenLift).toHaveBeenCalledWith(expect.objectContaining({ name: "Lat Pull Down" }));

    // Back to the default, which is one of the answers, not a Clear button.
    fireEvent.click(screen.getAllByLabelText("Choose exercise")[0]!);
    fireEvent.click(screen.getByText("Biggest Gain"));
    expect(head()).toHaveTextContent("Incline Bench");
    expect(screen.getByText("Biggest Gain")).toBeInTheDocument();
  });

  // A lift you picked that has nothing to compare keeps its head, so the
  // choice stays on screen and changeable. What it does NOT do is explain
  // what a comparison would need (Dave 2026-09-18: "Instructional subtext.
  // It shouldn't be anywhere") -- the missing chart already says that, and
  // the counts it does have are facts.
  it("keeps the card and its picker when the chosen lift has no comparison", () => {
    const one = [...workouts, w("d", "2026-09-08", 95, "k2", "Lat Pull Down")];
    render(<InsightsPage view="insights" onView={() => {}} today={today} workouts={one} metricDefs={[sleep]} metricLogs={logs} logs={none} muscleMap={new Map()} cards={null}
      onOpenLift={() => {}} onOpenWorkout={() => {}} onOpenAllData={() => {}} onAssignMuscles={() => {}} onExport={() => {}} />);
    fireEvent.click(screen.getAllByLabelText("Choose exercise")[0]!);
    fireEvent.click(screen.getByText("Lat Pull Down"));
    expect(document.querySelector(".ins-card .ins-head")).toHaveTextContent("Lat Pull Down");
    expect(screen.queryByText(/No two sessions at the same rep count/), "no manual").toBeNull();
    expect(screen.queryByText(/are what it takes/), "nor the other wording of it").toBeNull();
    // The counts it has, instead of a paragraph about the one it has not.
    expect(screen.getByText("1 Session in the Period")).toBeInTheDocument();
    expect(screen.getByText("1 Recorded in All")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Choose exercise").length, "still changeable").toBeGreaterThan(0);
  });

  it("is honest when there is nothing", () => {
    render(<InsightsPage view="insights" onView={() => {}} today={today} workouts={[]} metricDefs={[]} metricLogs={[]} logs={none} muscleMap={new Map()} cards={null}
      onOpenLift={() => {}} onOpenWorkout={() => {}} onOpenAllData={() => {}} onAssignMuscles={() => {}} onExport={() => {}} />);
    expect(screen.getByText("Nothing Logged Yet")).toBeInTheDocument();
  });
});

// THE CATALOG (Dave 2026-10-05): an imported record's quiet line is Title Case after the comma.
describe("AllDataPage: an imported record's quiet line", () => {
  it("reads 'Walk, Imported', the word after the comma capitalized", () => {
    const rec = { id: "x1", category: "effort", date: "2026-09-13", at: T("2026-09-13", 9), title: "Steps", value: "9,000", detail: "Walk", source: "Imported", hue: "lime", open: { kind: "metric", id: "x1" } } as never;
    const filter = { category: "all" as const, range: "30d" as const, period: periodFor("30d", today), date: null, query: "" };
    render(<AllDataPage view="data" onView={() => {}} records={[rec]} filter={filter} onFilter={() => {}} today={today} scrollRef={{ current: 0 }} onOpen={() => {}} onDelete={() => {}} onExport={() => {}} />);
    expect(screen.getByText("Walk, Imported")).toBeInTheDocument();
  });
});

describe("AllDataPage", () => {
  const records = allRecords({ workouts: [w("a", "2026-09-13", 135)], metricDefs: [sleep], metricLogs: logs, lightsOut: [], tookIt: [], medDefs: [], callIt: [], pointAtIt: [], meals: [{ id: "me", data: { category: "fuel", at: T("2026-09-13", 12), text: "Oats" } }], checkins: [] });
  // DELETE IS BEHIND THE ROW'S OPTIONS since 2026-09-16 (the health polish
  // handoff: "Delete moves into entry options with existing confirmation and
  // undo behavior. Do not expose accidental destructive pills in browsing
  // lists"). The door is the app's own RowMenuButton, the sheet is its own
  // ActionSheet, and the caller's Undo is untouched -- which is what this
  // still proves: the same onDelete, with the same record.
  it("filters by kind and day, opens a record, and offers Delete behind the row's options", () => {
    const onFilter = vi.fn(), onOpen = vi.fn(), onDelete = vi.fn();
    const filter = { category: "all" as const, range: "30d" as const, period: periodFor("30d", today), date: null, query: "" };
    const { rerender } = render(<AllDataPage view="data" onView={() => {}} records={records} filter={filter} onFilter={onFilter} today={today} scrollRef={{ current: 0 }} onOpen={onOpen} onDelete={onDelete} onExport={() => {}} />);
    expect(screen.getByText("Push")).toBeInTheDocument();
    expect(screen.getByText("Oats")).toBeInTheDocument();
    // The kind filter is a selector since 2026-09-16, not a wrapping chip
    // cloud (health polish: "Counts can appear inside selection menu rather
    // than a large wrapping cloud"). The count still shows, as the sub line
    // of the choice, where there is room for it.
    fireEvent.click(screen.getByLabelText("Filter by kind of record"));
    expect(screen.getAllByText("1 Recorded").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Nutrition"));
    expect(onFilter).toHaveBeenCalledWith(expect.objectContaining({ category: "nutrition" }));
    // No destructive pill sits in the list any more; the row's options hold it.
    expect(screen.queryByLabelText("Delete Meal")).toBeNull();
    fireEvent.click(screen.getByLabelText("More Actions for Meal"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ title: "Meal" }));
    fireEvent.click(screen.getByText("Push"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ open: { kind: "workout", id: "a" } }));
    rerender(<AllDataPage view="data" onView={() => {}} records={records} filter={{ ...filter, category: "sleep", date: "2026-09-12", period: null }} onFilter={onFilter} today={today} scrollRef={{ current: 0 }} onOpen={onOpen} onDelete={onDelete} onExport={() => {}} />);
    expect(screen.getByText("Clear Sep 12")).toBeInTheDocument();
    expect(screen.queryByText("Oats")).toBeNull();
  });
});

// THE CATALOG (Dave 2026-10-05): the context under a discomfort row, with no named spot, is "Spots on the Map".
describe("InsightsPage: a discomfort row with no named spot", () => {
  it("says Spots on the Map, Title Case, as its one grey", () => {
    const pointAtIt = [{ id: "p1", data: { category: "body", at: T("2026-09-12", 9), side: "front" } }];
    render(<InsightsPage view="insights" onView={() => {}} today={today} workouts={[]} metricDefs={[]} metricLogs={[]} logs={{ ...none, pointAtIt: pointAtIt as never }} muscleMap={new Map()} cards={null}
      onOpenLift={() => {}} onOpenWorkout={() => {}} onOpenAllData={() => {}} onAssignMuscles={() => {}} onExport={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Rest and Readings" }));
    expect(screen.getByText("Spots on the Map")).toBeInTheDocument();
  });
});

describe("AssignMusclesSheet", () => {
  it("applies a batch to every row, lets one row differ, and saves one map", () => {
    const onSave = vi.fn();
    render(<AssignMusclesSheet untagged={[{ name: "Row", exerciseKey: "r", sets: 6 }, { name: "Curl", exerciseKey: "c", sets: 3 }]} current={{ x: ["quads"] }} onSave={onSave} onClose={() => {}} />);
    // THE CATALOG (Dave 2026-10-05): the rule under the count is a Title Case fact like every other.
    expect(screen.getByText("The First Muscle Counts a Set Whole, the Rest Half")).toBeInTheDocument();
    const batch = screen.getByRole("group", { name: "Muscles for every exercise" });
    fireEvent.click(batch.querySelector('[aria-pressed]')!);
    fireEvent.click(screen.getByText("Apply to All Listed"));
    const curl = screen.getByRole("group", { name: "Muscles for Curl" });
    // Biceps, fifth since Traps joined the list after Back (2026-09-27).
    fireEvent.click([...curl.querySelectorAll("[aria-pressed]")][4]!);
    fireEvent.click(screen.getByText("Save Muscles"));
    expect(onSave).toHaveBeenCalledWith({ x: ["quads"], r: ["chest"], c: ["chest", "biceps"] });
  });
});

// CLEAN ROWS, NO PILLS, ACTIONS IN HEADS (Dave 2026-10-05, locked; Alfred 2026-10-04: "All Data", "Log Something" and the
// export buttons under a card). Export Data is the section's own action, so it is a head's capsule; All Data is a door row,
// the same row as Exercises and Program; neither is a button in a row at the foot of the page.
describe("Insights and All Data: the page's actions are heads and doors", () => {
  it("Insights: Export Data is the Your Data head's capsule and All Data is a door row", () => {
    const onExport = vi.fn(), onAll = vi.fn();
    const { container } = render(<InsightsPage view="insights" onView={() => {}} today={today} workouts={[]} metricDefs={[]} metricLogs={[]} logs={none} muscleMap={new Map()} cards={null}
      onOpenLift={() => {}} onOpenWorkout={() => {}} onOpenAllData={onAll} onAssignMuscles={() => {}} onExport={onExport} />);
    const head = screen.getByText("Your Data").closest(".sh2")!;
    const exp = head.querySelector("button")!;
    expect(exp.textContent).toBe("Export Data");
    expect(exp).toHaveClass("see-all", "pill-action");
    fireEvent.click(exp);
    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ key: "7d" }));
    const door = [...container.querySelectorAll(".h-door")].find((d) => d.textContent === "All Data")!;
    expect(door.querySelector(".chev")).not.toBeNull();
    fireEvent.click(door);
    expect(onAll).toHaveBeenCalledWith("all", expect.objectContaining({ key: "7d" }));
    expect(container.querySelector(".h-foot-acts")).toBeNull();
  });

  it("All Data: Export Data is the Records head's capsule, not a button row at the foot", () => {
    const onExport = vi.fn();
    const filter = { category: "all" as const, range: "30d" as const, period: periodFor("30d", today), date: null, query: "" };
    const { container } = render(<AllDataPage view="data" onView={() => {}} records={[]} filter={filter} onFilter={() => {}} today={today} scrollRef={{ current: 0 }} onOpen={() => {}} onDelete={() => {}} onExport={onExport} />);
    const head = screen.getByText("Records").closest(".sh2")!;
    expect(head.querySelector("button")).toHaveClass("see-all", "pill-action");
    fireEvent.click(head.querySelector("button")!);
    expect(onExport).toHaveBeenCalled();
    expect(container.querySelector(".h-foot-acts")).toBeNull();
  });
});

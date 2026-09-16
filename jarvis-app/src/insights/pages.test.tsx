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
    expect(screen.getAllByText("135 lb").length).toBeGreaterThan(0);
    expect(screen.getByText("+10 lb since Aug 31")).toBeInTheDocument();
    expect(screen.getByText("3 comparable sessions")).toBeInTheDocument();
    // The chart's points open their session, and the list twin is there.
    fireEvent.click(screen.getByRole("button", { name: "Sep 7, 130 lb, open the session" }));
    expect(onOpenWorkout).toHaveBeenCalledWith("b");
    expect(screen.getByText("As a List")).toBeInTheDocument();
    // Unassigned sets are shown, not dropped, with the coverage stated.
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(screen.getByText("0 of 1 working sets mapped")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Assign Muscles"));
    expect(onAssign).toHaveBeenCalledWith([{ name: "Incline Bench", exerciseKey: "k1", sets: 1 }]);
    // Sleep over the nights logged, never a zero for a night not logged.
    expect(screen.getByText("7h 30m")).toBeInTheDocument();
    expect(screen.getByText("Average across 2 logged nights of 7")).toBeInTheDocument();
    fireEvent.click(screen.getByText("View Sleep Logs"));
    expect(onAll).toHaveBeenCalledWith("sleep", expect.objectContaining({ key: "7d" }));
  });
  it("changes every card with the period, and labels a chart that spans more than it", () => {
    render(<InsightsPage view="insights" onView={() => {}} today={today} workouts={workouts} metricDefs={[sleep]} metricLogs={logs} logs={none} muscleMap={new Map([["k1", ["chest"]]])} cards={null}
      onOpenLift={() => {}} onOpenWorkout={() => {}} onOpenAllData={() => {}} onAssignMuscles={() => {}} onExport={() => {}} />);
    expect(screen.getByText("1 of 1 working sets mapped")).toBeInTheDocument();
    fireEvent.click(screen.getByText("28 Days"));
    expect(screen.getByText("3 of 3 working sets mapped")).toBeInTheDocument();
    expect(screen.getByText(/Spans the sessions, not only this period/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Strength" }));
    expect(screen.getByText("3 sessions in the period")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Rest and Readings" }));
    expect(screen.getByText(/2 of 28 days logged · 26 without a log/)).toBeInTheDocument();
  });
  it("is honest when there is nothing", () => {
    render(<InsightsPage view="insights" onView={() => {}} today={today} workouts={[]} metricDefs={[]} metricLogs={[]} logs={none} muscleMap={new Map()} cards={null}
      onOpenLift={() => {}} onOpenWorkout={() => {}} onOpenAllData={() => {}} onAssignMuscles={() => {}} onExport={() => {}} />);
    expect(screen.getByText("Nothing Logged Yet")).toBeInTheDocument();
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
    const filter = { category: "all" as const, range: "28d" as const, period: periodFor("28d", today), date: null, query: "" };
    const { rerender } = render(<AllDataPage view="data" onView={() => {}} records={records} filter={filter} onFilter={onFilter} today={today} scrollRef={{ current: 0 }} onOpen={onOpen} onDelete={onDelete} onExport={() => {}} />);
    expect(screen.getByText("Push")).toBeInTheDocument();
    expect(screen.getByText("Oats")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Nutrition · 1"));
    expect(onFilter).toHaveBeenCalledWith(expect.objectContaining({ category: "nutrition" }));
    // No destructive pill sits in the list any more; the row's options hold it.
    expect(screen.queryByLabelText("Delete Meal")).toBeNull();
    fireEvent.click(screen.getByLabelText("More Actions for Meal"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ title: "Meal" }));
    fireEvent.click(screen.getByText("Push"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ open: { kind: "workout", id: "a" } }));
    rerender(<AllDataPage view="data" onView={() => {}} records={records} filter={{ ...filter, category: "sleep", date: "2026-09-12", period: null }} onFilter={onFilter} today={today} scrollRef={{ current: 0 }} onOpen={onOpen} onDelete={onDelete} onExport={() => {}} />);
    expect(screen.getByText("Sep 12 · Clear")).toBeInTheDocument();
    expect(screen.queryByText("Oats")).toBeNull();
  });
});

describe("AssignMusclesSheet", () => {
  it("applies a batch to every row, lets one row differ, and saves one map", () => {
    const onSave = vi.fn();
    render(<AssignMusclesSheet untagged={[{ name: "Row", exerciseKey: "r", sets: 6 }, { name: "Curl", exerciseKey: "c", sets: 3 }]} current={{ x: ["quads"] }} onSave={onSave} onClose={() => {}} />);
    const batch = screen.getByRole("group", { name: "Muscles for every exercise" });
    fireEvent.click(batch.querySelector('[aria-pressed]')!);
    fireEvent.click(screen.getByText("Apply to All Listed"));
    const curl = screen.getByRole("group", { name: "Muscles for Curl" });
    fireEvent.click([...curl.querySelectorAll("[aria-pressed]")][3]!);
    fireEvent.click(screen.getByText("Save Muscles"));
    expect(onSave).toHaveBeenCalledWith({ x: ["quads"], r: ["chest"], c: ["chest", "biceps"] });
  });
});

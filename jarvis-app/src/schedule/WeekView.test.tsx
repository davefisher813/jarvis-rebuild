// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import ScheduleFlow from "./ScheduleFlow";

describe("Schedule views", () => {
  it("Week shows seven day-rows with bars, Repeats sits at the foot of Month, a row opens its day", async () => {
    const { container } = render(<NotesProvider userId="u1"><ScheduleFlow /></NotesProvider>);
    // SPEC MOVED (Library chassis 2026-08-18): the title renders twice
    // (large + condensed bar); wait on the pair.
    await screen.findAllByText("Schedule");
    // SCHEDULE AUDIT 2026-08-29: the tab lands on DAY now (the timeline is
    // the daily question; the month grid is the browsing one), so no grid
    // and no week strip until asked for.
    expect(container.querySelector(".cal-grid")).toBeFalsy();
    fireEvent.click(screen.getByText("Month"));
    await waitFor(() => expect(container.querySelector(".cal-grid")).toBeTruthy());
    // D1 (approved 2026-09-01): Repeats is out of the segment and at the foot of Month.
    expect(container.querySelectorAll(".sched-seg .seg")).toHaveLength(3);
    expect(screen.getByText("Repeats")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Week"));
    // D2: seven day-rows with capacity bars, no strip, no day list under it.
    await waitFor(() => expect(container.querySelectorAll(".wk-row").length).toBe(7));
    expect(container.querySelectorAll(".wk-bar")).toHaveLength(7);
    expect(container.querySelector(".week-strip")).toBeFalsy();
    expect(container.querySelector(".plan-head")).toBeFalsy();
    // A row is a door to its day, not a picker under a list.
    fireEvent.click(container.querySelectorAll(".wk-row")[3]!);
    await waitFor(() => expect(container.querySelector(".sched-seg .seg.active")).toHaveTextContent("Day"));
    await waitFor(() => {
      expect(container.querySelector(".cal-grid")).toBeFalsy();
      expect(container.querySelector(".wk-row")).toBeFalsy();
    });
  });
});

// SCHED-F-16 (2026-09-05): "Task changes from another device do not refresh
// the Anytime strip." The task subscription pointed at the events reloader.
describe("Schedule: a fresh task list from another device repaints Anytime", () => {
  it("a task that arrives by background refresh shows in the strip without opening Plan My Day", async () => {
    const { NotesProvider: Provider, useTasks } = await import("../data/NotesProvider");
    const { notifyFreshLists } = await import("../data/store");
    const { ENTITY_TASK } = await import("../notes/types");
    let tasks: import("../tasks/TasksService").TasksService | null = null;
    function Grab() { tasks = useTasks(); return null; }
    render(<Provider userId="u1"><Grab /><ScheduleFlow /></Provider>);
    await screen.findAllByText("Schedule");
    expect(screen.queryByText("Call the vet")).not.toBeInTheDocument();
    // "Another device" writes a task; the store's refresh then reports the
    // task list changed, which is the only signal this tab gets.
    await tasks!.createTask("Call the vet");
    notifyFreshLists(ENTITY_TASK);
    await waitFor(() => expect(screen.getByText("Call the vet")).toBeInTheDocument());
  });
});

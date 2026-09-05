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

// SCHED-F-14 (2026-09-05): reload() had no catch and setLoading(false) was
// its last line, so a read that failed at open left SkeletonRows up for good
// with no message. The page now says so and offers the retry.
describe("Schedule: a read that fails at open is a row with a retry, not skeleton rows forever", () => {
  it("shows Couldn't load this day, drops the skeleton, and Try Again loads the day", async () => {
    const { vi } = await import("vitest");
    const { ScheduleService } = await import("./ScheduleService");
    const spy = vi.spyOn(ScheduleService.prototype, "healPlanDuplicates").mockRejectedValueOnce(new Error("no signal"));
    try {
      const { container } = render(<NotesProvider userId="u-sched-fail"><ScheduleFlow /></NotesProvider>);
      await screen.findAllByText("Schedule");
      await waitFor(() => expect(screen.getByText("Couldn't load this day")).toBeInTheDocument());
      expect(container.querySelector(".skel-rows, .skel-row, .skel-line")).toBeNull();
      fireEvent.click(screen.getByText("Try Again"));
      await waitFor(() => expect(screen.queryByText("Couldn't load this day")).not.toBeInTheDocument());
      await waitFor(() => expect(container.querySelector(".skel-line")).toBeNull());
      expect(screen.getByText("No events")).toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });
});

// SCHED-F-03 (2026-09-05): "Editing one occurrence of a repeating event opens
// on the series anchor date, and This Event saves the split onto that anchor
// date." The sheet was seeded from the stored record, and the exdate used the
// selected day while the copy used the anchor, so the day he was looking at
// kept its occurrence and a duplicate appeared back at the start of the series.
describe("Schedule: editing one occurrence of a repeating event", () => {
  it("opens on the day tapped, and This Event splits that day", async () => {
    const { useSchedule } = await import("../data/NotesProvider");
    const { notifyFreshLists } = await import("../data/store");
    const { ENTITY_EVENT } = await import("./types");
    const { todayISO, addDays } = await import("./calendar");
    let sched: import("./ScheduleService").ScheduleService | null = null;
    function Grab() { sched = useSchedule(); return null; }
    render(<NotesProvider userId="u-occurrence"><Grab /><ScheduleFlow /></NotesProvider>);
    await screen.findAllByText("Schedule");
    const anchor = todayISO();
    const nextWeek = addDays(anchor, 7);
    const id = (await sched!.createEvent("Team Sync", { date: anchor, start: "10:00", recurrence: "weekly" }))!;
    notifyFreshLists(ENTITY_EVENT);
    // A week forward, to the occurrence that is not the anchor.
    for (let i = 0; i < 7; i++) fireEvent.click(screen.getByLabelText("Next"));
    await waitFor(() => expect(screen.getByText("Team Sync")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Team Sync"));
    // The Date field names the occurrence in front of him, not the anchor.
    await waitFor(() => expect(screen.getByLabelText("Date")).toHaveValue(nextWeek));
    fireEvent.click(screen.getByLabelText("Apply to"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "This Event" }));
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "11:00" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.queryByText("Edit Event")).not.toBeInTheDocument());
    // The series skips that day, and the one standalone copy lands on it too.
    await waitFor(async () => expect((await sched!.event(id))!.exdates).toEqual([nextWeek]));
    const copies = (await sched!.listEvents()).filter((e) => e.id !== id);
    expect(copies.map((e) => e.data.date)).toEqual([nextWeek]);
    expect(copies[0]!.data.start).toBe("11:00");
  });
});

// SCHED-F-09 (2026-09-05): "Undo after deleting or moving an event restores a
// lossy copy." Deleting the daily gym block and tapping Undo gave back a
// block that was no longer the Training Door, ran forever, and had forgotten
// the days that were skipped.
describe("Schedule: Undo after a delete puts the whole event back", () => {
  it("the door, the end date and the skipped days all come back, on the same event", async () => {
    const { useSchedule } = await import("../data/NotesProvider");
    const { notifyFreshLists } = await import("../data/store");
    const { subscribeToast, resetToasts } = await import("../shared/toast");
    const { ENTITY_EVENT } = await import("./types");
    const { todayISO, addDays } = await import("./calendar");
    resetToasts();
    let sched: import("./ScheduleService").ScheduleService | null = null;
    function Grab() { sched = useSchedule(); return null; }
    render(<NotesProvider userId="u-undo-delete"><Grab /><ScheduleFlow /></NotesProvider>);
    await screen.findAllByText("Schedule");
    const today = todayISO();
    const id = (await sched!.createEvent("Lift", {
      date: today, start: "17:30", end: "18:30", recurrence: "daily", until: addDays(today, 60),
    }))!;
    await sched!.editGymDoor(id, true);
    await sched!.addExdate(id, addDays(today, 3));
    notifyFreshLists(ENTITY_EVENT);
    // Tomorrow, so the row is not folded behind Earlier when the clock has
    // already passed it today.
    fireEvent.click(screen.getByLabelText("Next"));
    await waitFor(() => expect(screen.getByText("Lift")).toBeInTheDocument());
    let undo: (() => void) | undefined;
    const stop = subscribeToast((t) => { if (t?.message === "Event deleted") undo = t.onAction; });
    try {
      fireEvent.click(screen.getByText("Lift"));
      await screen.findByText("Edit Event");
      fireEvent.click(screen.getByText("Delete Event"));
      await waitFor(() => expect(undo).toBeTruthy());
      expect(await sched!.event(id)).toBeNull();
      undo!();
      await waitFor(async () => expect(await sched!.event(id)).toBeTruthy());
      const back = (await sched!.event(id))!;
      expect(back.gym).toBe(true);
      expect(back.until).toBe(addDays(today, 60));
      expect(back.exdates).toEqual([addDays(today, 3)]);
    } finally {
      stop();
    }
  });
});

// SCHED-F-10 (2026-09-05): "The blend offer attaches tasks to repeating
// events, which the sheet then hides and wipes on Save." The tuck appeared
// under a weekly commute, the row then claimed a task on every week's copy,
// and the editor showed no Tasks group at all.
describe("Schedule: the blend offer goes to blocks that can hold a task", () => {
  it("no tuck under a repeating block, and the one-off beside it still gets one", async () => {
    const { useSchedule, useTasks } = await import("../data/NotesProvider");
    const { notifyFreshLists } = await import("../data/store");
    const { ENTITY_EVENT } = await import("./types");
    const { ENTITY_TASK } = await import("../notes/types");
    const { todayISO, addDays } = await import("./calendar");
    let sched: import("./ScheduleService").ScheduleService | null = null;
    let tasks: import("../tasks/TasksService").TasksService | null = null;
    function Grab() { sched = useSchedule(); tasks = useTasks(); return null; }
    const { container } = render(<NotesProvider userId="u-blend-repeat"><Grab /><ScheduleFlow /></NotesProvider>);
    await screen.findAllByText("Schedule");
    const day = addDays(todayISO(), 1);
    await tasks!.createTask("Call the plumber");
    await sched!.createEvent("Commute", { date: day, start: "08:00", end: "08:45", recurrence: "weekly" });
    notifyFreshLists(ENTITY_TASK);
    notifyFreshLists(ENTITY_EVENT);
    fireEvent.click(screen.getByLabelText("Next"));
    await waitFor(() => expect(screen.getByText("Commute")).toBeInTheDocument());
    expect(container.querySelector(".blend-tuck")).toBeNull();
    // The same task, the same kind of block, not repeating: the offer stands.
    await sched!.createEvent("Commute Home", { date: day, start: "17:00", end: "17:45" });
    notifyFreshLists(ENTITY_EVENT);
    await waitFor(() => expect(container.querySelectorAll(".blend-tuck")).toHaveLength(1));
    expect(container.querySelector(".blend-tuck")!.textContent).toContain("Call the plumber");
  });
});

// SCHED-F-11 (2026-09-05): "a series date change is silently ignored". Apply
// To: All Events plus Tomorrow closed the sheet and moved nothing, because
// the save path only called moveDay for a one-off.
describe("Schedule: All Events plus a new date moves the whole series", () => {
  it("a day later on one occurrence slides the anchor a day, not onto that occurrence", async () => {
    const { useSchedule } = await import("../data/NotesProvider");
    const { notifyFreshLists } = await import("../data/store");
    const { ENTITY_EVENT } = await import("./types");
    const { todayISO, addDays } = await import("./calendar");
    let sched: import("./ScheduleService").ScheduleService | null = null;
    function Grab() { sched = useSchedule(); return null; }
    render(<NotesProvider userId="u-series-move"><Grab /><ScheduleFlow /></NotesProvider>);
    await screen.findAllByText("Schedule");
    const anchor = todayISO();
    const id = (await sched!.createEvent("Team Sync", { date: anchor, start: "10:00", recurrence: "weekly" }))!;
    notifyFreshLists(ENTITY_EVENT);
    // Open next week's occurrence, a week away from the anchor.
    for (let i = 0; i < 7; i++) fireEvent.click(screen.getByLabelText("Next"));
    await waitFor(() => expect(screen.getByText("Team Sync")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Team Sync"));
    await screen.findByText("Edit Event");
    // Apply To is already All Events; the Date field moves the day (the
    // sheet's Tomorrow chip writes the same field).
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: addDays(anchor, 8) } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.queryByText("Edit Event")).not.toBeInTheDocument());
    // One day later, from the anchor: the series keeps its shape and its start.
    await waitFor(async () => expect((await sched!.event(id))!.date).toBe(addDays(anchor, 1)));
    expect((await sched!.event(id))!.recurrence).toBe("weekly");
  });
});

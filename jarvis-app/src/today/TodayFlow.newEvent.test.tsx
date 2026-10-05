// @vitest-environment jsdom
// SCHEDULE AUDIT 2026-10-01, item 8: "No explicit New Event on the Today page."
// The pill on the day card's head opens the same New Event sheet the Schedule
// tab's "+" does, set to today, and the event it saves lands on today.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useSchedule } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { todayISO } from "../schedule/calendar";
import type { ScheduleService } from "../schedule/ScheduleService";
import TodayFlow from "./TodayFlow";

const showToast = vi.fn();
vi.mock("../shared/toast", () => ({ showToast: (...a: unknown[]) => showToast(...a), hideToast: () => {} }));
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

beforeEach(() => { showToast.mockReset(); localStorage.clear(); });

describe("TodayFlow: New Event", () => {
  it("opens the New Event sheet on today and saves the event onto today", async () => {
    let sched: ScheduleService | null = null;
    function Grab() { sched = useSchedule(); return null; }
    const { container } = render(
      <NotesProvider userId={"today-new-event-" + Math.random().toString(36).slice(2)}>
        <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
          <Grab />
          <TodayFlow onGoSchedule={() => {}} onGoTasks={() => {}} />
        </GoogleSessionProvider>
      </NotesProvider>,
    );
    await waitFor(() => expect(container.querySelector(".skel-screen")).toBeNull());
    fireEvent.click(await screen.findByRole("button", { name: "New Event" }));
    expect(document.querySelector(".sheet-bar-title")).toHaveTextContent("New Event");
    expect((screen.getByLabelText("Date") as HTMLInputElement).value, "set to today").toBe(todayISO());
    fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "Coffee With Sam" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(document.querySelector(".sheet-bar-title")).toBeNull());
    await waitFor(async () => {
      const made = (await sched!.eventsOn(todayISO())).map((e) => e.data.title);
      expect(made).toContain("Coffee With Sam");
    });
    const call = showToast.mock.calls.map((c) => c[0] as { message: string; actionLabel?: string }).find((c) => /Coffee With Sam/.test(c.message));
    expect(call?.actionLabel, "and the toast offers the way back").toBe("Undo");
  });

  it("Cancel leaves nothing behind", async () => {
    let sched: ScheduleService | null = null;
    function Grab() { sched = useSchedule(); return null; }
    const { container } = render(
      <NotesProvider userId={"today-new-event-c-" + Math.random().toString(36).slice(2)}>
        <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
          <Grab />
          <TodayFlow onGoSchedule={() => {}} onGoTasks={() => {}} />
        </GoogleSessionProvider>
      </NotesProvider>,
    );
    await waitFor(() => expect(container.querySelector(".skel-screen")).toBeNull());
    fireEvent.click(await screen.findByRole("button", { name: "New Event" }));
    fireEvent.click(screen.getByText("Cancel"));
    expect(document.querySelector(".sheet-bar-title")).toBeNull();
    expect(await sched!.eventsOn(todayISO())).toEqual([]);
  });
});

// SCHEDULE AUDIT 2026-10-01, item 7: the Now card's open window offers what
// fits instead of going straight to Focus.
describe("TodayFlow: Schedule something here", () => {
  it("the Open row opens the gap sheet, and Book puts the task into the gap", async () => {
    const { useTasks } = await import("../data/NotesProvider");
    const { notifyFreshLists } = await import("../data/store");
    const { ENTITY_EVENT } = await import("../schedule/types");
    const { ENTITY_TASK } = await import("../notes/types");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 1, 9, 0, 0));
    try {
      let sched: ScheduleService | null = null;
      let tasks: ReturnType<typeof useTasks> | null = null;
      function Grab() { sched = useSchedule(); tasks = useTasks(); return null; }
      const { container } = render(
        <NotesProvider userId={"today-gap-" + Math.random().toString(36).slice(2)}>
          <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
            <Grab />
            <TodayFlow onGoSchedule={() => {}} onGoTasks={() => {}} />
          </GoogleSessionProvider>
        </NotesProvider>,
      );
      await waitFor(() => expect(container.querySelector(".skel-screen")).toBeNull());
      await sched!.createEvent("Board Call", { date: "2026-10-01", start: "13:00", end: "14:00" });
      const taskId = (await tasks!.createTask("Update insurance docs", { estimateMin: 30 }))!;
      notifyFreshLists(ENTITY_EVENT);
      notifyFreshLists(ENTITY_TASK);
      // NO FILL IT CAPSULE (Dave 2026-10-05, locked: a row has no pill). The open window IS the row, and its tap is the door.
      const openRow = await screen.findByText(/^\d.* Open$/);
      expect(screen.queryByRole("button", { name: "Fill It" })).toBeNull();
      fireEvent.click(openRow);
      const dialog = screen.getByRole("dialog", { name: "Schedule something here" });
      expect(within(dialog).getByText("Focus"), "Focus is still one tap away").toBeInTheDocument();
      fireEvent.click(await screen.findByLabelText(/^Book Update insurance docs at/));
      await waitFor(async () => {
        const evs = await sched!.eventsOn("2026-10-01");
        const booked = evs.find((e) => e.data.sourceTaskId === taskId);
        expect(booked, "the task is on the day, in the gap").toBeTruthy();
        expect(booked!.data.start).toBe("09:00");
        expect(booked!.data.end).toBe("09:30");
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

// @vitest-environment jsdom
//
// SCHEDULE AUDIT 2026-10-01, item 7: "+ 30 Min Open" blocks launched Focus (or
// a blank form) instead of offering to schedule something into the gap. On the
// Schedule tab a tap on an Open row now offers the tasks that fit, one tap each
// to book them into the gap, with New Event and Focus beside them.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useSchedule, useTasks } from "../data/NotesProvider";
import type { ScheduleService } from "./ScheduleService";
import { notifyFreshLists } from "../data/store";
import { ENTITY_EVENT } from "./types";
import { ENTITY_TASK } from "../notes/types";
import ScheduleFlow from "./ScheduleFlow";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

describe("Schedule: an Open row offers something to put in it", () => {
  const setup = async (onFocus?: () => void) => {
    let sched: ScheduleService | null = null;
    let tasks: ReturnType<typeof useTasks> | null = null;
    function Grab() { sched = useSchedule(); tasks = useTasks(); return null; }
    render(
      <NotesProvider userId={"u-sched-gap-" + Math.random().toString(36).slice(2)}>
        <Grab />
        <ScheduleFlow onFocus={onFocus} />
      </NotesProvider>,
    );
    await screen.findAllByText("Schedule");
    await sched!.createEvent("Board Call", { date: "2026-10-01", start: "13:00", end: "14:00" });
    const taskId = (await tasks!.createTask("Update insurance docs", { estimateMin: 30 }))!;
    notifyFreshLists(ENTITY_EVENT);
    notifyFreshLists(ENTITY_TASK);
    return { sched: sched!, taskId };
  };

  it("lists what fits, books it into the gap, and offers Focus and New Event", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 1, 9, 0, 0));
    try {
      const onFocus = vi.fn();
      const { sched, taskId } = await setup(onFocus);
      const gap = await waitFor(() => {
        const g = document.querySelector<HTMLElement>(".sched-gap");
        if (!g) throw new Error("no gap row yet");
        return g;
      }, { timeout: 4000 });
      const start = gap.dataset.gapStart!;
      fireEvent.click(gap);
      const dialog = await screen.findByRole("dialog", { name: "Schedule something here" });
      expect(within(dialog).getByText("New Event")).toBeInTheDocument();
      fireEvent.click(within(dialog).getByText("Focus"));
      expect(onFocus).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog", { name: "Schedule something here" })).toBeNull();

      fireEvent.click(document.querySelector<HTMLElement>(".sched-gap")!);
      fireEvent.click(await screen.findByLabelText(/^Book Update insurance docs at/));
      await waitFor(async () => {
        const booked = (await sched.eventsOn("2026-10-01")).find((e) => e.data.sourceTaskId === taskId);
        expect(booked, "the task is on the day").toBeTruthy();
        expect(booked!.data.start, "at the gap's start").toBe(start);
      }, { timeout: 4000 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("New Event from the sheet opens the form at the gap's start, as the row used to", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 1, 9, 0, 0));
    try {
      await setup();
      const gap = await waitFor(() => {
        const g = document.querySelector<HTMLElement>(".sched-gap");
        if (!g) throw new Error("no gap row yet");
        return g;
      }, { timeout: 4000 });
      const start = gap.dataset.gapStart!;
      fireEvent.click(gap);
      const dialog = await screen.findByRole("dialog", { name: "Schedule something here" });
      fireEvent.click(within(dialog).getByText("New Event"));
      expect(await screen.findByLabelText("Event title")).toBeInTheDocument();
      expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe(start);
    } finally {
      vi.useRealTimers();
    }
  });
});

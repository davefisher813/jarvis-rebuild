// @vitest-environment jsdom
//
// WARN, THEN ALLOW, END TO END (the Schedule audit's P0 #2, 2026-10-01).
// The pure rules are pinned in conflicts.test.ts; these drive the real tab
// through the real services to show the prompt is on the real commit paths and
// that Cancel and Book Anyway do what they say.
import { describe, it, expect } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useSchedule, useRoutine, useTasks } from "../data/NotesProvider";
import type { ScheduleService } from "./ScheduleService";
import type { RoutineService } from "../routine/RoutineService";
import type { TasksService } from "../tasks/TasksService";
import { todayISO, addDays } from "./calendar";
import { useOneShot } from "../shell/intents";
import { DEFAULT_ROUTINE } from "../routine/types";
import ScheduleFlow from "./ScheduleFlow";

let openId = "";
function Shell() {
  const ev = useOneShot<string>();
  return (
    <>
      <button onClick={() => ev.fire(openId)}>fire</button>
      <ScheduleFlow openId={ev.value} openNonce={ev.nonce} onOpenConsumed={ev.clear} />
    </>
  );
}

// The tab reads its events, tasks and routine once on mount, so a test seeds
// them FIRST and only then lets the tab mount, as a real open would find them.
type Handles = { sched: ScheduleService; routine: RoutineService; tasks: TasksService };
function setup(user: string, seed: (h: Handles) => Promise<void>): { get: () => Handles } {
  let handles: Handles | null = null;
  function Gate() {
    const sched = useSchedule();
    const routine = useRoutine();
    const tasks = useTasks();
    const [ready, setReady] = useState(false);
    useEffect(() => {
      handles = { sched, routine, tasks };
      void seed(handles).then(() => setReady(true));
    }, [sched, routine, tasks]);
    return ready ? <Shell /> : null;
  }
  render(<NotesProvider userId={user}><Gate /></NotesProvider>);
  return { get: () => handles! };
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

describe("Schedule: saving an event onto something asks first", () => {
  it("Golf over a flexible Gym: one line, Cancel keeps the old time, Book Anyway moves it", async () => {
    const today = todayISO();
    const t = setup("u-conflict-save", async (h) => {
      await h.routine.save({
        ...DEFAULT_ROUTINE,
        protectedBlocks: [{ id: "gym", label: "Gym", startMin: 10 * 60, endMin: 12 * 60, days: ALL_DAYS, kind: "gym", soft: true, mode: "protects" }],
      });
      openId = (await h.sched.createEvent("Golf", { date: today, start: "15:00", end: "17:00" }))!;
    });
    await screen.findAllByText("Schedule");

    fireEvent.click(screen.getByText("fire"));
    expect(await screen.findByText("Edit Event", undefined, { timeout: 4000 })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "11:20" } });
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "13:20" } });
    // The sheet itself already names it while he is still editing.
    expect(await screen.findByText("Overlaps Gym 10:00 AM to 12:00 PM")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Save"));

    // The prompt: the same single line, and the three choices.
    expect(await screen.findByText("Heads Up")).toBeInTheDocument();
    expect(screen.getAllByText("Overlaps Gym 10:00 AM to 12:00 PM").length).toBeGreaterThan(0);
    expect(screen.getByText("Book Anyway")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel", { selector: ".sheet-actions button" }));

    // Nothing was written, and the sheet is still open to try again.
    await waitFor(() => expect(screen.queryByText("Heads Up")).not.toBeInTheDocument());
    expect((await t.get().sched.event(openId))!.start).toBe("15:00");
    expect(screen.getByText("Edit Event")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Save"));
    fireEvent.click(await screen.findByText("Book Anyway"));
    await waitFor(async () => expect((await t.get().sched.event(openId))!.start).toBe("11:20"));
  });

  it("a rename that does not touch the times never asks, even if it was already overlapping", async () => {
    const today = todayISO();
    setup("u-conflict-rename", async (h) => {
      await h.routine.save({
        ...DEFAULT_ROUTINE,
        protectedBlocks: [{ id: "bf", label: "Breakfast", startMin: 9 * 60 + 30, endMin: 10 * 60, days: ALL_DAYS, kind: "meal" }],
      });
      openId = (await h.sched.createEvent("Standup", { date: today, start: "09:30", end: "10:00" }))!;
    });
    await screen.findAllByText("Schedule");
    fireEvent.click(screen.getByText("fire"));
    expect(await screen.findByText("Edit Event", undefined, { timeout: 4000 })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.queryByText("Edit Event")).not.toBeInTheDocument());
    expect(screen.queryByText("Already Booked")).not.toBeInTheDocument();
  });
});

describe("Schedule: Plan My Day does not offer what is already booked", () => {
  it("a task booked on another day is not a pick", async () => {
    const today = todayISO();
    setup("u-plan-booked", async (h) => {
      const booked = (await h.tasks.createTask("Already booked thing", {}))!;
      await h.tasks.createTask("Fresh thing", {});
      await h.sched.createEvent("Already booked thing", { date: addDays(today, 1), start: "10:00", end: "11:00", sourceTaskId: booked });
    });
    await screen.findAllByText("Schedule");
    // Not in the Anytime strip behind the sheet either: Drop would book twice.
    expect(await screen.findByText("Fresh thing")).toBeInTheDocument();
    expect(screen.queryByText("Already booked thing")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByText("Plan My Day"));
    expect((await screen.findAllByText("Fresh thing")).length).toBeGreaterThan(1);
    expect(screen.queryByText("Already booked thing")).not.toBeInTheDocument();
  });
});

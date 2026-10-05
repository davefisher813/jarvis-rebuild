// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useSchedule, useTasks } from "../data/NotesProvider";
import type { ScheduleService } from "./ScheduleService";
import { notifyFreshLists } from "../data/store";
import { ENTITY_EVENT } from "./types";
import { ENTITY_TASK } from "../notes/types";
import { todayISO, addDays } from "./calendar";
import { writeDraft } from "../dayloop/dayLoop";
import ScheduleFlow from "./ScheduleFlow";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

// ROUND-1 REVIEW (2026-10-05, Dave's decisions D2). "Reply to Nadia Re: Invoice" sat under Deep Work as an offer AND, in the same
// list, as its own Proposed row at 6:30 PM: one task in two places on one day. A task the standing proposal already places is not
// offered again. And the proposal's second answer, Not Today, is a line in the day head's overflow, so only Accept the Day stands
// under the card.
describe("Schedule: a proposal and an offer never name the same task, and the proposal's answers are tidy", () => {
  const setup = async () => {
    let sched: ScheduleService | null = null;
    let tasks: ReturnType<typeof useTasks> | null = null;
    function Grab() { sched = useSchedule(); tasks = useTasks(); return null; }
    const view = render(
      <NotesProvider userId={"u-sched-r1-" + Math.random().toString(36).slice(2)}>
        <Grab />
        <ScheduleFlow />
      </NotesProvider>,
    );
    await screen.findAllByText("Schedule");
    const day = addDays(todayISO(), 1);
    const taskId = (await tasks!.createTask("Call the plumber"))!;
    await sched!.createEvent("Commute Home", { date: day, start: "17:00", end: "17:45" });
    writeDraft({
      date: day,
      blocks: [{ taskId, text: "Call the plumber", category: "", start: "19:00", end: "19:30" }],
      anytime: [], accepted: false, eventIds: [], dismissed: false,
    });
    notifyFreshLists(ENTITY_TASK);
    notifyFreshLists(ENTITY_EVENT);
    fireEvent.click(screen.getByLabelText("Next"));
    await waitFor(() => expect(screen.getByText("Commute Home")).toBeInTheDocument());
    return view;
  };

  it("offers no copy of a task the proposed day already places, until the proposal is dismissed", async () => {
    const { container } = await setup();
    // The proposal stands: its row is on the day, and the offer under the commute is not drawn.
    await waitFor(() => expect(container.querySelector(".sched-proposed")).not.toBeNull());
    expect(container.querySelector(".blend-tuck")).toBeNull();
    // Accept the Day is the one button under the card; Not Today is not drawn there.
    const foot = container.querySelector(".day-foot")!;
    expect(Array.from(foot.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Accept the Day"]);
    // Not Today lives in the head's overflow and clears the proposal.
    const head = container.querySelector(".sc-dayhead") as HTMLElement;
    fireEvent.click(within(head).getByRole("button", { name: /^More for / }));
    fireEvent.click(screen.getByRole("button", { name: "Not Today" }));
    // The task is the day's to place again, so the offer under the commute stands.
    await waitFor(() => expect(container.querySelectorAll(".blend-tuck")).toHaveLength(1));
    expect(container.querySelector(".blend-tuck")!.textContent).toContain("Call the Plumber");
    expect(container.querySelector(".day-foot")).toBeNull();
  });
});

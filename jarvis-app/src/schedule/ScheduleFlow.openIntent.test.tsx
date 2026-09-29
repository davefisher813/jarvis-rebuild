// @vitest-environment jsdom
//
// ONE-SHOT OPEN (audit 2026-09-29). A search hit, a notification or a note's
// link asks the Schedule tab to open an event. The tab used to key that on the
// id alone and never hand it back, so opening the SAME event a second time
// (search it again, tap its banner again) changed nothing the tab could see
// and the tap did nothing. shell/intents.ts is the shape every other tab
// already uses: a nonce so a repeat is a change, and a clear once it acted.
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useSchedule } from "../data/NotesProvider";
import type { ScheduleService } from "./ScheduleService";
import { todayISO } from "./calendar";
import { useOneShot } from "../shell/intents";
import ScheduleFlow from "./ScheduleFlow";

let id = "";
function Shell() {
  const ev = useOneShot<string>();
  return (
    <>
      <button onClick={() => ev.fire(id)}>fire</button>
      <ScheduleFlow openId={ev.value} openNonce={ev.nonce} onOpenConsumed={ev.clear} />
    </>
  );
}

describe("Schedule: an event asked for twice opens twice", () => {
  it("opens the same event again after its sheet was cancelled", async () => {
    let sched: ScheduleService | null = null;
    function Grab() { sched = useSchedule(); return null; }
    render(<NotesProvider userId="u-sched-open-twice"><Grab /><Shell /></NotesProvider>);
    await screen.findAllByText("Schedule");
    await act(async () => { id = (await sched!.createEvent("Team Sync", { date: todayISO(), start: "10:00" }))!; });

    fireEvent.click(screen.getByText("fire"));
    expect(await screen.findByText("Edit Event", undefined, { timeout: 4000 })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByText("Edit Event")).not.toBeInTheDocument());

    fireEvent.click(screen.getByText("fire"));
    expect(await screen.findByText("Edit Event", undefined, { timeout: 4000 })).toBeInTheDocument();
  });
});

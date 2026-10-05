// @vitest-environment jsdom
//
// COPY YESTERDAY KEEPS THE MEETING (2026-10-04). The toast says "1 event
// copied" and the write went through createEvent with six hand-listed fields,
// so yesterday's call arrived today without its Join link, notes, travel time,
// project or training door. Driven through the real tab and the real service.
import { describe, it, expect } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useSchedule } from "../data/NotesProvider";
import type { ScheduleService } from "./ScheduleService";
import { todayISO, addDays } from "./calendar";
import ScheduleFlow from "./ScheduleFlow";

let handle: ScheduleService | null = null;
function Gate({ seed }: { seed: (s: ScheduleService) => Promise<void> }) {
  const sched = useSchedule();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    handle = sched;
    void seed(sched).then(() => setReady(true));
  }, [sched]);
  return ready ? <ScheduleFlow /> : null;
}

describe("Schedule: Copy Yesterday", () => {
  it("brings yesterday's one-off over with its link, notes, travel, project and door", async () => {
    const today = todayISO();
    const yesterday = addDays(today, -1);
    render(
      <NotesProvider userId="u-copy-yesterday">
        <Gate seed={async (s) => {
          await s.createEvent("Parent Call", {
            date: yesterday, start: "10:00", end: "11:00", location: "Rink 2",
            url: "https://zoom.example/j/9", notes: "Bring the chart", travelMin: 25, bufferMin: 10, projectId: "proj-1", gym: true,
          });
        }} />
      </NotesProvider>,
    );
    fireEvent.click(await screen.findByText("Copy Yesterday", undefined, { timeout: 4000 }));
    await waitFor(async () => expect((await handle!.listEvents()).filter((e) => e.data.date === today)).toHaveLength(1));
    const copy = (await handle!.listEvents()).find((e) => e.data.date === today)!;
    expect(copy.data).toMatchObject({
      title: "Parent Call", start: "10:00", end: "11:00", location: "Rink 2",
      url: "https://zoom.example/j/9", notes: "Bring the chart", travelMin: 25, bufferMin: 10, projectId: "proj-1", gym: true,
    });
  });
});

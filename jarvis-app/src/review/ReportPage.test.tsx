// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useCategories, useSchedule, useTasks } from "../data/NotesProvider";
import { todayISO } from "../tasks/grouping";
import ReportFlow from "./ReportPage";

// BRAIN-F-16 (2026-09-05): item 13 wired the calendar into the BOUNDARY seal
// (AppShell hands sealPreviousMonthIfDue the schedule) but not into the live
// path, so "September, So Far" never showed Where the Hours Went, whatever
// was on the calendar. Sealed months showed it; the month you are in did not.

function SeededMonth() {
  const cats = useCategories();
  const schedule = useSchedule();
  const tasks = useTasks();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      const id = (await cats.create("Work", "blue"))!;
      // Anchored on the first of this month so the whole month counts, well
      // over the hours floor whichever day the test runs on.
      const first = todayISO().slice(0, 7) + "-01";
      await schedule.createEvent("Standup", { date: first, start: "09:00", end: "10:00", category: id, recurrence: "daily" });
      const t = (await tasks.createTask("Email Sam", { category: id }))!;
      await tasks.toggleDone(t);
      setReady(true);
    })();
  }, [cats, schedule, tasks]);
  return ready ? <ReportFlow onBack={() => {}} live /> : null;
}

describe("the live month's report (BRAIN-F-16)", () => {
  it("shows Where the Hours Went from the calendar it can already read", async () => {
    const { container } = render(<NotesProvider userId="rep-f16"><SeededMonth /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Your Month · Still Open")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Where the Hours Went")).toBeInTheDocument());
    // The legend names the area the calendar time was tagged with.
    expect(container.querySelector(".rep-leg")?.textContent).toContain("Work");
  });
});

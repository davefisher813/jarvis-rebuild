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
    await waitFor(() => expect(screen.getByText("Your Month So Far")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Where the Hours Went")).toBeInTheDocument());
    // The legend names the area the calendar time was tagged with.
    expect(container.querySelector(".rep-leg")?.textContent).toContain("Work");
  });
});

// CLICK-THROUGH AUDIT 2026-09-29: "YOUR HOURS 3 PM to 6 PM: tapping has no
// effect". There is no hours setting to edit here (the band is read off when
// things got finished), so the card is not an editor. It is the report's
// "tap anything for its receipts" convention: the tap opens the Receipts sheet
// with the fact under the band, and its Done closes it. Driving it without the
// sheet in view (it rises from the foot of the screen) reads as a dead tap.
import { fireEvent } from "@testing-library/react";
import { ReportScreen } from "./ReportPage";
import type { MonthReport } from "./report";

const HOURS_REPORT: MonthReport = {
  month: "2026-08", monthName: "August",
  hero: { big: "3", label: "Things Moved", anchor: null, wins: [] },
  tiles: [{ num: "84", label: "Done", tint: "good", delta: { text: "+12 vs July", up: true } }],
  hours: { label: "3 PM to 6 PM", byHour: Array.from({ length: 24 }, (_, h) => (h >= 15 && h < 18 ? 9 : 1)), bandStart: 15 },
  went: null, time: null, worth: [], patterns: [], life: [], learned: null, did: null, closer: null,
  sealed: { title: "August Sealed", sub: "September Compares to This" },
};

describe("Your Hours in the monthly report", () => {
  it("a tap opens the Receipts sheet for the band, and Done closes it", () => {
    render(<ReportScreen report={HOURS_REPORT} capped={false} onCap={() => {}} onBack={() => {}} />);
    expect(document.querySelector(".sheet-scrim")).toBeNull();
    fireEvent.click(screen.getByText("Your Hours"));
    const sheet = document.querySelector(".sheet-scrim")!;
    expect(sheet, "the tap does something").toBeTruthy();
    expect(sheet.textContent).toContain("Your Hours: 3 PM to 6 PM");
    expect(sheet.textContent).toContain("84 Finishes This Month");
    fireEvent.click(screen.getByText("Done", { selector: ".sheet-scrim button" }));
    expect(document.querySelector(".sheet-scrim")).toBeNull();
  });
});

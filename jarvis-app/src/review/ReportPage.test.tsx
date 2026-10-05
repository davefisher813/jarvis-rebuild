// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
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
  tiles: [{ num: "84", label: "Done", tint: "good", delta: { text: "+12 Vs July", up: true } }],
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
    // The receipts are the three busiest hours, as rows in the app's own words: what the bars are made of, not one loud sentence
    // in a box (Dave 2026-10-05, the review).
    expect([...sheet.querySelectorAll(".rep-receipts .rep-receipt-line")].map((e) => e.textContent)).toEqual(["3 PM: 9 Finishes", "4 PM: 9 Finishes", "5 PM: 9 Finishes"]);
    // They are evidence in the primary ink, not a grey sub line: the receipt line is its own class, never .conn-meta.
    expect(sheet.querySelector(".rep-receipts .conn-meta")).toBeNull();
    expect(sheet.textContent).toContain("4 PM: 9 Finishes");
    expect(sheet.textContent).toContain("5 PM: 9 Finishes");
    expect(sheet.textContent).not.toContain("This Month; the");
    fireEvent.click(screen.getByText("Done", { selector: ".sheet-scrim button" }));
    expect(document.querySelector(".sheet-scrim")).toBeNull();
  });
});

// CLEAN ROWS, NO PILLS (Dave 2026-10-05, locked; ROW-ACTIONS-SPEC sections 1 and 2). Do One, Drop One and every life
// card's door (Open Money, Check In) were capsules in a strip under their rows. A row is a door now: tap it and its
// sheet holds the verb filled with the quieter one beneath it; the first verb is also the row's swipe-left.
describe("the report's rows wear the row-action model (2026-10-05)", () => {
  const REPORT: MonthReport = {
    ...HOURS_REPORT, hours: null,
    worth: [{ id: "carried", title: "2 Tasks Followed You All Month", sub: null, carried: [{ id: "t1", text: "File Taxes", n: 4 }, { id: "t2", text: "Call Mom", n: 3 }], receipts: ["File Taxes, 4 Pushes", "Call Mom, 3 Pushes"] }],
    life: [{ id: "money", title: "Bills Paid on Time", facts: [{ text: "12 Paid" }], exit: { label: "Open Money", kind: "money" }, receipts: ["Rent, Paid Oct 1"] }],
  };

  it("draws no capsule anywhere in a card, and the swipe-left carries the sheet's first verb", () => {
    const { container } = render(<ReportScreen report={REPORT} capped={false} onCap={() => {}} onBack={() => {}} onOpenTask={() => {}} onDropTask={() => {}} onExit={() => {}} />);
    // The One Change card is absent here; every other capsule would be in a row or a card.
    expect(container.querySelector(".card .pill-act, .card .row-act, .card .btn-sm, .card .quiet-action")).toBeNull();
    expect(container.querySelector(".rep-btnrow")).toBeNull();
    expect([...container.querySelectorAll(".notice-alt")].map((b) => b.textContent)).toEqual(["Do One", "Open Money"]);
  });

  it("a tap opens the sheet: the receipts, Do One filled, Drop One beneath it, and each does its job", () => {
    const onOpenTask = vi.fn();
    const onDropTask = vi.fn();
    render(<ReportScreen report={REPORT} capped={false} onCap={() => {}} onBack={() => {}} onOpenTask={onOpenTask} onDropTask={onDropTask} />);
    fireEvent.click(screen.getByText("2 Tasks Followed You All Month"));
    const sheet = document.querySelector(".sheet-scrim")!;
    expect(sheet.textContent).toContain("File Taxes, 4 Pushes");
    expect(sheet.querySelector(".btn-primary")!.textContent).toBe("Do One");
    fireEvent.click(sheet.querySelector(".btn-danger-text")!);
    expect(onDropTask).toHaveBeenCalledWith({ id: "t1", text: "File Taxes", n: 4 });
    expect(document.querySelector(".sheet-scrim")).toBeNull();
    fireEvent.click(screen.getByText("2 Tasks Followed You All Month"));
    fireEvent.click(document.querySelector(".sheet-scrim .btn-primary")!);
    expect(onOpenTask).toHaveBeenCalledWith("t1");
  });

  it("a life card whose door is not wired has no verb, not one that does nothing", () => {
    const { container } = render(<ReportScreen report={REPORT} capped={false} onCap={() => {}} onBack={() => {}} />);
    expect(container.querySelector(".notice-alt")).toBeNull();
    fireEvent.click(screen.getByText("Bills Paid on Time"));
    expect(document.querySelector(".sheet-scrim .btn-primary")).toBeNull();
  });
});

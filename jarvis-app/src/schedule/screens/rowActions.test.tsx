// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import SchedulePage from "./SchedulePage";
import DayRow from "./DayRow";
import LockedRow from "./LockedRow";
import GapSheet from "./GapSheet";
import PlanDaySheet from "./PlanDaySheet";
import EventSheet from "./EventSheet";
import { numberCaseViolations } from "../../laws/catalogCheck";
import { setCategoryRegistry } from "../../shared/categories";
import type { EventItem } from "../types";

// THE SCHEDULE, ROW BY ROW, AGAINST THE CATALOG (Dave 2026-10-05, locked: clean rows, no pills anywhere; section actions in the
// section head; the row's moment surfaces its one action as text; typed titles shown in Title Case; Alfred's pass of
// 2026-10-04: the Month's selected day, the Week's strings, Copy Yesterday and the Anytime Drop pills).
// Each test renders the real component through its real markup and reads what is drawn.

setCategoryRegistry([
  { id: "orgB", name: "Ridgeley", color: "sky" },
  { id: "elite", name: "Elite", color: "red" },
  { id: "health", name: "Health", color: "green" },
]);

const ev = (id: string, title: string, start: string, over: Partial<EventItem["data"]> = {}): EventItem =>
  ({ id, data: { title, date: "2026-10-05", start, end: start.replace(/^(\d\d)/, (m) => String(Number(m) + 1).padStart(2, "0")), category: "orgB", ...over } }) as EventItem;

const base = {
  year: 2026, month: 9, selected: "2026-10-05", todayDate: "2026-10-05",
  dots: {} as Record<number, string[]>, dayEvents: [] as EventItem[], mode: "day" as const,
  windowStartMin: 7 * 60, windowEndMin: 21 * 60,
};

const CAPSULES = ".pill-act, .row-act, .btn-sm, .quiet-action";

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn() as never; });

describe("Schedule > Month: the picked day is a disc sized to the number (Alfred 2026-10-04)", () => {
  const css = ["components.css", "ruled.css"].map((f) => readFileSync(new URL("../../styles/" + f, import.meta.url), "utf8")).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");

  it("marks exactly one cell as the picked date, and it is a real day cell, not a wrapper", () => {
    const { container } = render(<SchedulePage {...base} mode="month" selected="2026-10-04" />);
    const sel = container.querySelectorAll(".cal-cell.sel");
    expect(sel.length).toBe(1);
    expect(sel[0]!.getAttribute("aria-current")).toBe("date");
    expect(sel[0]!.textContent).toBe("4");
  });

  it("the cell itself paints no fill: the fill is a 40px disc behind the numeral, so it can never cover the cell", () => {
    expect(css, "no rounded slab on the cell").not.toMatch(/\.cal-cell\.sel\s*\{[^}]*background/);
    const disc = css.match(/\.cal-cell\.sel::before\s*\{[^}]*\}/)?.[0] ?? "";
    expect(disc).toMatch(/width:\s*40px/);
    expect(disc).toMatch(/height:\s*40px/);
    expect(disc).toMatch(/border-radius:\s*var\(--r-circle\)/);
    expect(disc).toMatch(/background-color:\s*var\(--sel-bg\)/);
    expect(css).toMatch(/\.cal-cell\.sel\s*\{[^}]*color:\s*var\(--sel-fg\)/);
  });

  it("light and dark differ in colour only: no theme repaints the disc's shape", () => {
    for (const m of css.matchAll(/\[data-theme="(?:light|dark)"\][^{]*\.cal-cell[^{]*\{([^}]*)\}/g)) {
      expect(m[1], "a theme rule on the picked day may only change colour").not.toMatch(/width|height|border-radius|padding|transform/);
    }
  });
});

describe("Schedule > Week: every string follows the catalog", () => {
  const weekRow = (date: string, day: number, dow: number, count: number, openMin: number, longest: { s: number; e: number } | null = null) => ({
    date, day, dow, windowS: 7 * 60, windowE: 23 * 60 + 30, blocks: [], count, openMin, longest,
  });
  const cells = [5, 6, 7, 8].map((d, i) => ({ date: `2026-10-0${d}`, day: d, dow: i, colors: [] as string[] }));

  it("'4 Blocks', '53 Min Open' and 'Longest Open Stretch Tue 10:37 to 11:30 PM'", () => {
    const rows = [weekRow("2026-10-05", 5, 0, 4, 0), weekRow("2026-10-06", 6, 1, 0, 53, { s: 22 * 60 + 37, e: 23 * 60 + 30 }), weekRow("2026-10-07", 7, 2, 0, 0)];
    const { container } = render(<SchedulePage {...base} todayDate="2026-10-06" mode="week" weekCells={cells as never} weekRows={rows} />);
    expect(Array.from(container.querySelectorAll(".wk-open")).map((n) => n.textContent)).toEqual(["4 Blocks", "53 Min Open", "Full"]);
    expect(container.querySelector(".wk-head .n")!.textContent).toBe("53 Min Open");
    const note = container.querySelector(".wk-note")!.textContent!;
    expect(note).toMatch(/^Longest Open Stretch /);
    expect(note).toMatch(/10:37 to 11:30 PM$/);
    expect(numberCaseViolations(container)).toEqual([]);
  });

  it("every drawn word on the week is Title Case: no lowercase word opens a run, a lowercase 'open' or 'blocks' never appears", () => {
    const rows = [weekRow("2026-10-05", 5, 0, 5, 0), weekRow("2026-10-06", 6, 1, 1, 0), weekRow("2026-10-07", 7, 2, 0, 120, { s: 600, e: 720 })];
    const { container } = render(<SchedulePage {...base} todayDate="2026-10-07" mode="week" weekCells={cells as never} weekRows={rows} />);
    const text = container.querySelector(".week-rows")!.textContent + " " + container.querySelector(".wk-note")!.textContent + " " + container.querySelector(".wk-head")!.textContent;
    expect(text).not.toMatch(/\b(open|blocks?|stretch|longest|week)\b/);
  });
});

describe("Schedule > Day: Copy Yesterday is the section head's, never the card's (Alfred R3)", () => {
  it("an empty day has the capsule in the head beside Plan My Day, and no capsule in any card or plate", () => {
    const { container } = render(<SchedulePage {...base} onPickSlot={() => {}} onCopyDay={() => {}} onPlanDay={() => {}} onNew={() => {}} />);
    const copy = screen.getByText("Copy Yesterday");
    expect(copy.closest(".sh2")).not.toBeNull();
    expect(copy.className).toContain("pill-action");
    expect(screen.getByText("Plan My Day").closest(".sh2")).toBe(copy.closest(".sh2"));
    expect(container.querySelectorAll(".card " + CAPSULES.split(", ").join(", .card ")).length).toBe(0);
    expect(container.querySelectorAll(".empty-state .row-act, .empty-state .pill-act").length).toBe(0);
    // The empty state keeps its own words and its one button.
    expect(screen.getByText("No Events")).toBeInTheDocument();
    expect(numberCaseViolations(container)).toEqual([]);
  });

  it("a day with rows has no Copy Yesterday at all (it is a day to build on, not to copy over)", () => {
    render(<SchedulePage {...base} dayEvents={[ev("a", "interview", "09:00")]} onPickSlot={() => {}} onCopyDay={() => {}} onPlanDay={() => {}} />);
    expect(screen.queryByText("Copy Yesterday")).toBeNull();
  });

  it("a day with only protected blocks still offers it in the head, never as a row at the foot of the list", () => {
    const { container } = render(<SchedulePage {...base} locked={[{ s: 12 * 60, e: 13 * 60, label: "lunch", id: "L1", soft: true }]} onPickSlot={() => {}} onCopyDay={() => {}} onPlanDay={() => {}} />);
    expect(screen.getByText("Copy Yesterday").closest(".sh2")).not.toBeNull();
    expect(container.querySelector(".sched-list .row-act")).toBeNull();
  });
});

describe("Schedule > Day: typed titles are shown in Title Case, stored as typed (Alfred R2)", () => {
  const holder = { s: 13 * 60, e: 15 * 60, label: "deep work", id: "dw", kind: "focus", mode: "holds" };
  const proposed = {
    blocks: [{ taskId: "p1", text: "reply to nadia", category: "elite", start: "13:15", end: "13:45" }, { taskId: "p2", text: "finish jarvis on mac", category: "orgB", start: "16:00", end: "16:45" }],
    openId: null, onToggle: vi.fn(), onDuration: vi.fn(), onDrop: vi.fn(), onAccept: vi.fn(),
  };

  it("an event, a protected block, a nested pick, a standalone pick and an Anytime task all read in Title Case", () => {
    const tasks = [{ id: "t1", data: { text: "get new car insurance" } }, { id: "t2", data: { text: "check on health insurance receipts" } }, { id: "t3", data: { text: "get ein number" } }] as never;
    const { container } = render(
      <SchedulePage {...base} dayEvents={[ev("a", "interview with reynolds", "09:00"), ev("b", "send all proposals", "11:00")]}
        locked={[holder]} proposed={proposed} anytimeItems={tasks} onPickSlot={() => {}} onScheduleTask={() => {}} onToggleTask={() => {}} />,
    );
    const titles = Array.from(container.querySelectorAll(".sched-t, .block-held-t, .task-name")).map((n) => n.textContent);
    expect(titles).toEqual(expect.arrayContaining([
      "Interview with Reynolds", "Send All Proposals", "Deep Work", "Reply to Nadia", "Finish Jarvis on Mac",
      "Get New Car Insurance", "Check on Health Insurance Receipts", "Get EIN Number",
    ]));
    for (const t of titles) expect(t, `"${t}" must be Title Case`).not.toMatch(/^[a-z]/);
    expect(numberCaseViolations(container)).toEqual([]);
  });

  it("the states say their words in Title Case, with the number first: 'Nothing Scheduled', '2 Clashes Today'", () => {
    const { container, rerender } = render(<SchedulePage {...base} windowStartMin={600} windowEndMin={600} />);
    expect(container.querySelector(".sc-fact")!.textContent).toBe("Nothing Scheduled");
    rerender(<SchedulePage {...base} dayEvents={[ev("a", "x", "09:00")]} onFixOverlap={() => {}} clashCount={2} />);
    expect(screen.getByText(/2 Clashes Today/)).toBeInTheDocument();
    expect(numberCaseViolations(container)).toEqual([]);
  });
});

describe("Schedule > Day: the clash row holds no pill; its moment has come, so it says its one word", () => {
  it("'Fix It' is quiet text in the key colour, the whole row opens the same sheet", () => {
    const onFix = vi.fn();
    const { container } = render(<SchedulePage {...base} dayEvents={[ev("a", "x", "09:00")]} overlap={{ line: "Interview and Proposals" }} onFixOverlap={onFix} onPickSlot={() => {}} />);
    const fix = screen.getByRole("button", { name: "Fix the overlap" });
    expect(fix).toBeInTheDocument();
    expect(container.querySelectorAll(".row-ctx").length).toBe(1);
    expect(container.querySelector(".row-ctx")!.textContent).toBe("Fix It");
    expect(container.querySelector(".row-ctx")!.className).not.toMatch(/pill|row-act|btn/);
    expect(container.querySelectorAll(CAPSULES).length).toBe(0);
  });
});

describe("DayRow: a training block's verb is the swipe, the menu and, when it is next, one quiet word", () => {
  const door = (extra: Record<string, unknown> = {}) => ({ dayName: "push day", facts: { exercises: 6, estMin: 55 }, onStart: vi.fn(), ...extra });
  const row = (props: Record<string, unknown> = {}) => {
    const g = door();
    const r = render(<DayRow e={ev("g", "gym", "17:00", { category: "health" })} conflict={false} isNext={false} isPast={false} now={null} onOpen={() => {}} onDelete={() => {}} gymDoor={g} {...props} />);
    return { ...r, g };
  };

  it("draws no Start Training capsule; the day's name is Title Case", () => {
    const { container } = row();
    expect(container.querySelectorAll(CAPSULES).length).toBe(0);
    expect(container.querySelector(".sched-gym-name")!.textContent).toBe("Push Day");
    expect(container.querySelectorAll(".row-ctx").length, "not next: stays clean").toBe(0);
  });

  it("swipe left leads with Start, and Delete stays behind the same reveal", () => {
    const { g } = row();
    const rail = Array.from(document.querySelectorAll(".sched-actions .sched-act")).map((b) => b.textContent);
    expect(rail).toEqual(["Start", "Delete"]);
    fireEvent.click(screen.getByText("Start"));
    expect(g.onStart).toHaveBeenCalledTimes(1);
  });

  it("the next block surfaces Start as text on the row; a running session says Resume", () => {
    const { container, g } = row({ isNext: true, now: "16:00" });
    const word = container.querySelector(".row-ctx")!;
    expect(word.textContent).toBe("Start");
    fireEvent.click(word);
    expect(g.onStart).toHaveBeenCalledTimes(1);
    const resume = vi.fn();
    const b = render(<DayRow e={ev("g2", "gym", "17:00")} conflict={false} isNext now="16:00" isPast={false} onOpen={() => {}} gymDoor={{ dayName: "pull day", onResume: resume }} />);
    expect(b.container.querySelector(".row-ctx")!.textContent).toBe("Resume");
  });

  it("a trained block has nothing to start, and the long-press menu holds the verb again", () => {
    const trained = render(<DayRow e={ev("g3", "gym", "07:00")} conflict={false} isNext now="06:00" isPast={false} onOpen={() => {}} gymDoor={{ trainedMin: 52 }} />);
    expect(trained.container.querySelectorAll(".row-ctx").length).toBe(0);
    trained.unmount();
    row();
    fireEvent.contextMenu(screen.getByRole("button", { name: /Gym/ }));
    const labels = Array.from(document.querySelectorAll(".action-sheet button")).map((b) => b.textContent);
    expect(labels[0]).toBe("Start Push Day");
    expect(labels).toContain("Delete");
  });
});

describe("LockedRow: no chevron grip, the actions are the swipe and the menu, and the name is Title Case", () => {
  const l = { s: 13 * 60, e: 14 * 60, label: "deep work", id: "dw", kind: "focus", mode: "holds" };

  it("draws no grip, and a hold or right click opens the block's actions", () => {
    const onShift = vi.fn(), onDelete = vi.fn(), onFill = vi.fn();
    const { container } = render(<LockedRow l={l} past={false} onShift={onShift} onDelete={onDelete} onFillBlock={onFill} />);
    expect(container.querySelector(".sched-grip")).toBeNull();
    expect(screen.queryByLabelText("Quick actions")).toBeNull();
    expect(container.querySelector(".sched-t")!.textContent).toBe("Deep Work");
    fireEvent.contextMenu(container.querySelector(".sched-locked")!);
    const labels = Array.from(document.querySelectorAll(".action-sheet button")).map((b) => b.textContent);
    expect(labels).toEqual(["Put a Task in This Block", "−15 Min", "+15 Min", "Delete", "Cancel"]);
    fireEvent.click(screen.getByRole("button", { name: "+15 Min" }));
    expect(onShift).toHaveBeenCalledWith(15);
  });

  it("a past block is a record: no rail, no menu", () => {
    const { container } = render(<LockedRow l={{ ...l, mode: "protects", kind: "meal" }} past onShift={() => {}} onDelete={() => {}} />);
    fireEvent.contextMenu(container.querySelector(".sched-locked")!);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });
});

describe("Plan My Day and the gap sheet: no pill on a row, no button at the foot of a list", () => {
  it("a gap's offers say Book as text; the whole row books", () => {
    const onBook = vi.fn();
    render(<GapSheet start="12:15" end="13:00" minutes={45} options={[{ id: "t1", text: "call the dentist", category: "health", minutes: 15 }]} onBook={onBook} onClose={() => {}} />);
    expect(screen.getByText("Call the Dentist")).toBeInTheDocument();
    expect(document.querySelectorAll(".gap-offer .pill-act").length).toBe(0);
    fireEvent.click(document.querySelector(".gap-offer .row-ctx")!);
    expect(onBook).toHaveBeenCalledTimes(1);
  });

  it("the plan sheet's picks read in Title Case and its rows carry no capsule of their own", () => {
    render(<PlanDaySheet date="2026-08-20" dayLabel="Today" events={[]} startMin={9 * 60} endMin={17 * 60} onCommit={() => {}} onClose={() => {}}
      tasks={[{ id: "t1", text: "email vendor", category: "work", suggested: true, overdue: false }]} />);
    expect(screen.getByText("Email Vendor")).toBeInTheDocument();
    expect(document.querySelectorAll(".card .row .pill-act, .card .row .row-act").length).toBe(0);
    expect(document.querySelector(".plan-load")!.textContent).toMatch(/Open/);
  });

  it("a day that cannot hold the picks says Drop as one quiet word, the same as its whole-row tap", () => {
    const tasks = ["a one", "b two", "c three"].map((text, i) => ({ id: "t" + i, text, category: "work", suggested: true, overdue: false }));
    render(<PlanDaySheet date="2026-08-20" dayLabel="Today" events={[]} startMin={9 * 60} endMin={9 * 60 + 40} onCommit={() => {}} onClose={() => {}} tasks={tasks} />);
    const word = Array.from(document.querySelectorAll(".card .row .row-ctx")).find((n) => /^Drop/.test(n.textContent ?? ""));
    expect(word, "an over-full day offers Drop as text").toBeTruthy();
    expect(document.querySelectorAll(".card .row .pill-act").length).toBe(0);
  });
});

describe("EventSheet: a guest row and a task row say their one verb as text", () => {
  it("the guests' Open and Add, and the attached task's Detach, are text on the row, never capsules", () => {
    render(
      <EventSheet mode="edit"
        initial={{ title: "Board sync", date: "2026-10-05", attendees: [{ email: "marco@example.com", name: "Marco Diaz" }, { email: "nadia@example.com" }] }}
        categories={[{ id: "orgB", name: "Ridgeley", color: "sky" }] as never}
        knownPeople={[{ id: "p1", name: "Marco Diaz", email: "marco@example.com" }]}
        onOpenPerson={() => {}} onAddPerson={() => {}} onSave={() => {}} onCancel={() => {}} />,
    );
    expect(document.querySelectorAll(".xs-group .pill-act, .xs-group .row-act").length).toBe(0);
    expect(Array.from(document.querySelectorAll(".row-ctx")).map((b) => b.textContent)).toEqual(["Open", "Add"]);
  });
});

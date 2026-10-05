// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import TodayPage from "./TodayPage";
import NoticeCard from "./NoticeCard";
import MoveHeadliner from "./MoveHeadliner";
import RemindersStrip from "./RemindersStrip";
import YourDay from "./YourDay";
import { TodayPeek, resetPeekClaim } from "./usePeekOnce";
import type { EventItem } from "../schedule/types";
import type { TaskItem } from "../tasks/TasksService";
import type { ReminderView } from "../tasks/reminders";
import { setCategoryRegistry } from "../shared/categories";

// CLEAN ROWS, GESTURES FOR VERBS (Dave 2026-10-05, locked; docs/jarvis-unified/ROW-ACTIONS-SPEC.md). The catalog gate for
// the Today list: no capsule on a row, the swipe-left verb per state, the contextual action only when its moment has come,
// section-level actions on the section head, the swipe taught once and never again.

setCategoryRegistry([{ id: "work", name: "Work", color: "blue" }]);
const ev = (id: string, start: string): EventItem => ({ id, data: { title: id, date: "2026-05-20", start, category: "work" } });
const tk = (id: string, due: string | null): TaskItem => ({ id, data: { text: id, category: "work", done: false, due } });
const rv = (id: string, time: string): ReminderView => ({ id, text: id, time, unscheduled: false, paused: false, category: "", done: false, missed: false, snoozed: false, letGo: false });
const noop = () => {};

const base = {
  greeting: "Good Morning",
  dateLong: "Wednesday, May 20",
  summary: { events: 1, due: 1, overdue: 0, moves: 0 },
  todayEvents: [ev("e1", "09:00")],
  now: "08:00",
  nowLabel: "8:00",
  tomorrowEvents: [],
  tomorrowDate: "Thu, May 21",
  tasks: [] as TaskItem[],
  today: "2026-05-20",
  onSeeAllSchedule: noop,
  onSeeAllTasks: noop,
};
const trayOf = (el: Element) => Array.from(el.querySelectorAll(":scope > button")).map((b) => b.textContent);

beforeEach(() => { localStorage.clear(); resetPeekClaim(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the headliner: its tray is the quickest verb for the state the task is in", () => {
  const facts = { urgency: null };
  it("ready to work: Start Now, then Tomorrow, and no capsule", () => {
    const { container } = render(<MoveHeadliner title="Call Bank" facts={facts} onStart={noop} onTomorrow={noop} onToggle={noop} />);
    expect(trayOf(container.querySelector(".notice-swipe")!)).toEqual(["Start Now", "Tomorrow"]);
    expect(container.querySelectorAll(".pill-act").length).toBe(0);
    expect(container.querySelectorAll(".row-ctx").length, "not late, so the row stays clean").toBe(0);
    expect(container.querySelector(".task-done-rail")!.textContent, "swipe right completes").toBe("Done");
  });
  it("active (a block running): Wrap Up first, Stop beside it", () => {
    const { container } = render(<MoveHeadliner title="Call Bank" facts={facts} onDone={noop} onStop={noop} />);
    expect(trayOf(container.querySelector(".notice-swipe")!)).toEqual(["Wrap Up", "Stop"]);
  });
  it("late: its moment has come, so the same verb shows on the row as text", () => {
    const run = vi.fn();
    const { container } = render(<MoveHeadliner title="Call Bank" facts={{ urgency: { label: "2 DAYS LATE", kind: "late" } }} onStart={run} />);
    const ctx = container.querySelector(".row-ctx") as HTMLElement;
    expect(ctx.textContent).toBe("Start Now");
    fireEvent.click(ctx);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("a notice row has no capsule, and an offer keeps its own", () => {
  it("a row's verb is the first button in its tray; one verb and no door means the tap does it", () => {
    const run = vi.fn();
    const { container } = render(<NoticeCard form="row" icon={null} title="Rebuild Bridge App" action={{ label: "Wrap Up", onClick: run }} onDismiss={noop} />);
    expect(container.querySelectorAll(".pill-act").length).toBe(0);
    expect(trayOf(container.querySelector(".notice-swipe")!)).toEqual(["Wrap Up", "Dismiss"]);
    fireEvent.click(container.querySelector(".notice-vrow")!);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("two verbs and no door: the tap opens the row's sheet holding every action", () => {
    const wrap = vi.fn();
    const { container } = render(<NoticeCard form="row" icon={null} title="Revisit" action={{ label: "Keep", onClick: wrap }} alt={{ label: "Change It", onClick: noop }} onDismiss={noop} />);
    fireEvent.click(container.querySelector(".notice-vrow")!);
    const sheet = document.querySelector(".action-sheet") as HTMLElement;
    expect(Array.from(sheet.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Keep", "Change It", "Dismiss"]);
    fireEvent.click(within(sheet).getByText("Keep"));
    expect(wrap).toHaveBeenCalledTimes(1);
  });
  it("the verb shows on the row only once its moment has come", () => {
    const { container, rerender } = render(<NoticeCard form="row" icon={null} title="Con Edison" action={{ label: "Paid", onClick: noop }} onOpen={noop} />);
    expect(container.querySelectorAll(".row-ctx").length).toBe(0);
    rerender(<NoticeCard form="row" icon={null} title="Con Edison" action={{ label: "Paid", onClick: noop }} onOpen={noop} due />);
    expect(container.querySelector(".row-ctx")!.textContent).toBe("Paid");
    expect(container.querySelectorAll(".pill-act").length).toBe(0);
  });
  it("an offer (a permission ask) keeps its capsule in the row form, and the card form is untouched", () => {
    const { container, rerender } = render(<NoticeCard form="row" offer icon={null} title="Add Daily Weather" action={{ label: "Allow", onClick: noop }} />);
    expect(container.querySelectorAll(".pill-act").length).toBe(1);
    rerender(<NoticeCard form="card" icon={null} title="Brain Suggestion" action={{ label: "Add", onClick: noop }} />);
    expect(container.querySelectorAll(".pill-act").length).toBe(1);
  });
});

describe("reminders: Snooze is the swipe, and surfaces on the row only when due", () => {
  it("no Adjust capsule; the tray is Snooze then Delete", () => {
    const { container } = render(<RemindersStrip items={[rv("meds", "14:00")]} now="10:00" onSnooze={noop} onDelete={noop} onTick={noop} />);
    expect(container.querySelectorAll(".pill-act").length).toBe(0);
    const tray = Array.from(container.querySelectorAll(".task-swipe > button")).map((b) => b.textContent);
    expect(tray).toEqual(["Snooze", "Delete"]);
    expect(container.querySelectorAll(".row-ctx").length, "a future reminder stays clean").toBe(0);
  });
  it("a reminder due within ten minutes shows Snooze on the row, as text, running the same action", () => {
    const snooze = vi.fn();
    const { container } = render(<RemindersStrip items={[rv("meds", "10:05"), rv("later", "16:00")]} now="10:00" onSnooze={snooze} onTick={noop} />);
    const ctx = container.querySelectorAll(".row-ctx");
    expect(ctx.length).toBe(1);
    fireEvent.click(ctx[0]!);
    expect(snooze).toHaveBeenCalledWith("meds");
  });
});

describe("section-level actions live on the section head, never in a card", () => {
  const day = { events: [ev("e1", "09:00")], now: "08:00", nowLabel: "8:00", onSeeAll: noop };
  it("Plan My Day is the head's capsule, New Event and Schedule wait behind its More button, and no card holds a capsule", () => {
    const { container } = render(<YourDay {...day} onPlanDay={noop} onNewEvent={noop} />);
    const head = container.querySelector(".sh2")!;
    // ONE CAPSULE AND ONE OVERFLOW (D1, 2026-10-05): the head never wraps four controls onto a second row.
    expect(Array.from(head.querySelectorAll(".see-all.pill-action:not(.head-more)")).map((b) => b.textContent)).toEqual(["Plan My Day"]);
    expect(head.querySelectorAll(".head-more")).toHaveLength(1);
    fireEvent.click(screen.getByLabelText("Day Actions"));
    expect(Array.from(document.querySelectorAll(".action-sheet button")).map((b) => b.textContent)).toEqual(["New Event", "Schedule", "Cancel"]);
    expect(container.querySelectorAll(".card .plan-cta, .card .btn").length).toBe(0);
  });
  it("an empty day keeps its own words and loses the buttons", () => {
    const { container } = render(<YourDay {...day} events={[]} onPlanDay={noop} onPlanTomorrow={noop} />);
    expect(container.querySelector(".card .empty-title")).toBeTruthy();
    expect(container.querySelectorAll(".card button").length).toBe(0);
    // Plan Tomorrow rides the head, behind its More button when Plan My Day holds the capsule.
    fireEvent.click(screen.getByLabelText("Day Actions"));
    expect(Array.from(document.querySelectorAll(".action-sheet button")).map((b) => b.textContent)).toContain("Plan Tomorrow");
  });
  it("Plan Tomorrow is ONE capsule in one place: the Tomorrow head when the page has one, else Tonight's", () => {
    const evening = { doneDue: 1, dueTotal: 1, eventsLeft: 0, openCount: 0, thingsDone: 1 };
    const { container } = render(<TodayPage {...base} evening={evening} tomorrowEvents={[ev("t1", "09:00")]} onPlanTomorrow={noop} onPlanDay={noop} />);
    const all = screen.getAllByRole("button", { name: "Plan Tomorrow" });
    expect(all.length).toBe(1);
    expect(all[0]).toHaveClass("see-all", "pill-action");
    expect(all[0]!.closest(".sh2")!.textContent).toContain("Tomorrow");
    expect(container.querySelectorAll(".card .plan-cta").length).toBe(0);
  });
  it("an empty Tomorrow is its head and the capsule, with no plate behind it", () => {
    const evening = { doneDue: 1, dueTotal: 1, eventsLeft: 0, openCount: 0, thingsDone: 1 };
    render(<TodayPage {...base} evening={evening} onPlanTomorrow={noop} />);
    const all = screen.getAllByRole("button", { name: "Plan Tomorrow" });
    expect(all.length).toBe(1);
    expect(all[0]!.closest(".sh2")).toBeTruthy();
    expect(all[0]!.closest(".card")).toBeNull();
  });
});

describe("Today list: task titles in Title Case, rows clean, completing from the tray", () => {
  const evening = { doneDue: 0, dueTotal: 2, eventsLeft: 0, openCount: 2, thingsDone: 0 };
  it("shows what he typed in Title Case, acronyms intact, with no capsule and Done in the tray", () => {
    const onToggle = vi.fn();
    const { container } = render(<TodayPage {...base} evening={evening} tasks={[{ id: "a", data: { text: "get new car insurance", category: "work", done: false, due: "2026-05-20" } }, { id: "b", data: { text: "get EIN number", category: "work", done: false, due: "2026-05-18" } }]} onToggleTask={onToggle} />);
    expect(screen.getByText("Get New Car Insurance")).toBeInTheDocument();
    expect(screen.getByText("Get EIN Number")).toBeInTheDocument();
    expect(container.querySelectorAll(".task-row .pill-act, .task-row .row-act").length).toBe(0);
    // The evening recap is calm: no urgency chips, so no row claims its moment, and the verb lives on the tray.
    expect(container.querySelectorAll(".task-row .row-ctx").length).toBe(0);
    expect(trayOf(container.querySelector(".task-row")!.closest(".notice-swipe")!)).toEqual(["Done"]);
  });
});

describe("teaching the swipe: one tip, one peek, once, and nothing permanent", () => {
  const withRow = { upNext: [tk("over", "2026-05-18")], onStartTask: noop, onUpNext: noop };
  it("shows the tip on first run, and a dismiss ends it for good", () => {
    const { unmount } = render(<TodayPage {...base} {...withRow} />);
    expect(screen.getByText("Swipe a Task for Quick Actions")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Tip" }));
    expect(screen.queryByText("Swipe a Task for Quick Actions")).toBeNull();
    unmount();
    render(<TodayPage {...base} {...withRow} />);
    expect(screen.queryByText("Swipe a Task for Quick Actions")).toBeNull();
  });
  it("shows no tip when there is nothing to swipe", () => {
    render(<TodayPage {...base} />);
    expect(screen.queryByText("Swipe a Task for Quick Actions")).toBeNull();
  });
  it("the first swipeable row peeks open once, ever, and slides back", () => {
    vi.useFakeTimers();
    const { container, unmount } = render(<TodayPage {...base} {...withRow} />);
    const mover = () => container.querySelector(".hl .notice-card") as HTMLElement;
    expect(mover().style.transform).toBe("");
    act(() => { vi.advanceTimersByTime(1000); });
    // The peek shows the quickest action WHOLE: one 88px well, never a clipped "tart Now" (two-action tray, 176px of reveal).
    expect(mover().style.transform, "slid left by exactly one action well").toBe("translateX(-88px)");
    act(() => { vi.advanceTimersByTime(1000); });
    expect(mover().style.transform, "and back").toBe("");
    unmount();
    // A second launch never peeks again.
    resetPeekClaim();
    const again = render(<TodayPage {...base} {...withRow} />);
    act(() => { vi.advanceTimersByTime(1000); });
    expect((again.container.querySelector(".hl .notice-card") as HTMLElement).style.transform).toBe("");
  });
  it("never peeks under Reduced Motion, though the tip still shows", () => {
    vi.useFakeTimers();
    const mm = vi.fn().mockReturnValue({ matches: true });
    Object.defineProperty(window, "matchMedia", { value: mm, configurable: true });
    try {
      const { container } = render(<TodayPage {...base} {...withRow} />);
      act(() => { vi.advanceTimersByTime(1000); });
      expect((container.querySelector(".hl .notice-card") as HTMLElement).style.transform).toBe("");
      expect(screen.getByText("Swipe a Task for Quick Actions")).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "matchMedia", { value: undefined, configurable: true });
    }
  });
  it("rows outside Today never peek", () => {
    vi.useFakeTimers();
    const { container } = render(<NoticeCard form="row" icon={null} title="Elsewhere" action={{ label: "Go", onClick: noop }} onOpen={noop} />);
    act(() => { vi.advanceTimersByTime(1000); });
    expect((container.querySelector(".notice-card") as HTMLElement).style.transform).toBe("");
  });
  it("a context provider is what makes a row Today's", () => {
    vi.useFakeTimers();
    const { container } = render(<TodayPeek.Provider value={true}><NoticeCard form="row" icon={null} title="Here" action={{ label: "Go", onClick: noop }} onOpen={noop} /></TodayPeek.Provider>);
    act(() => { vi.advanceTimersByTime(1000); });
    expect((container.querySelector(".notice-card") as HTMLElement).style.transform).toMatch(/translateX/);
  });
});

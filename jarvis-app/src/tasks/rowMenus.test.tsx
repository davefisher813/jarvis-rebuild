// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import TasksPage, { MomentumRow } from "./screens/TasksPage";
import RemindersPage from "./screens/RemindersPage";
import { setCategoryRegistry } from "../shared/categories";
import { pageSections } from "./reminders";
import type { TaskItem } from "./TasksService";
import type { ReminderInfo } from "../notes/types";

// LONG PRESS IS THE ROW'S CONTEXT MENU (Dave 2026-10-05, locked). Every row on the Life lists opens a RowActionSheet on a
// hold (the swipe controller's own hold, via shared/useRowMenu), whose lines are the row's tray and its sheet, never a tray
// that slides open behind the menu.
setCategoryRegistry([{ id: "work", name: "Work", color: "blue" }]);
const hold = (el: Element) => { fireEvent.touchStart(el, { touches: [{ clientX: 10, clientY: 10 }] }); act(() => { vi.advanceTimersByTime(520); }); };
const menu = () => Array.from(document.querySelectorAll(".action-sheet button")).map((b) => b.textContent);
const noop = () => {};
const task = (id: string, text: string, due: string | null): TaskItem => ({ id, data: { text, category: "work", done: false, due } });

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the suggested task (MomentumRow): a hold opens Start, Done, Not Now", () => {
  it("lists them, runs the pick, and leaves the tray shut", () => {
    vi.useFakeTimers();
    const onNotNow = vi.fn();
    const { container } = render(<MomentumRow task={task("m1", "email the landlord", "2026-05-20")} reason={null} today="2026-05-20" onOpen={noop} onToggle={noop} onStart={noop} onNotNow={onNotNow} />);
    hold(container.querySelector(".momentum-row")!);
    expect(menu()).toEqual(["Start", "Done", "Not Now", "Cancel"]);
    expect(document.querySelector(".sheet-scrim .eyebrow")!.textContent).toBe("Email the Landlord");
    expect((container.querySelector(".momentum-row") as HTMLElement).style.transform).toBe("");
    fireEvent.click(screen.getByText("Not Now", { selector: ".action-sheet button" }));
    expect(onNotNow).toHaveBeenCalledTimes(1);
  });
});

describe("a task row on the Life list: the hold opens the menu and not the tray", () => {
  it("a hold lists the row's verbs and Delete last, with the tray still shut", () => {
    vi.useFakeTimers();
    const { container } = render(
      <TasksPage filter="all" counts={{ all: 1, today: 1, upcoming: 0, done: 0, email: 0, daily: 0, overdue: 0 }} items={[task("a", "call the bank", "2026-05-20")]} today="2026-05-20"
        onFilter={noop} onToggle={noop} onOpenTask={noop} onDeleteTask={noop} onSnoozeTask={noop} onStartTask={noop} onNew={noop} />,
    );
    const row = container.querySelector(".task-row")!;
    hold(row);
    expect(menu().at(-2)).toBe("Delete");
    expect(menu().at(-1)).toBe("Cancel");
    expect(menu()[0]).toBe("Start");
    expect((row as HTMLElement).style.transform, "the hold must not also slide the tray open").toBe("");
  });
});

describe("a reminder row: the hold opens the verb, Done, Details, Delete", () => {
  const info = (r: ReminderInfo, text: string, id: string): TaskItem => ({ id, data: { text, category: "", done: false, reminder: r } } as TaskItem);
  it("lists them and keeps the tray shut", () => {
    vi.useFakeTimers();
    const sections = pageSections([info({ time: "14:00" }, "Follow Up with Alberto", "later1")], "today", "2026-09-15", "09:30");
    render(<RemindersPage chrome={{ back: "Today", onBack: noop }} sections={sections} tab="today" onTab={noop} query="" onQuery={noop} searchOpen={false}
      onSearchToggle={noop} today="2026-09-15" onNew={noop} onSettings={noop} onOpen={noop} onTick={noop} onSnooze={noop} onResume={noop} onRestore={noop} onDelete={noop} />);
    const row = screen.getByText("Follow Up with Alberto").closest(".rem-card, .task-row, .rem-row, [role='button']")!;
    hold(row);
    expect(menu()).toEqual(["Snooze", "Done", "Details", "Delete", "Cancel"]);
    expect(document.querySelector(".task-swipe [style*='translateX']"), "no row slid open").toBeNull();
  });
});

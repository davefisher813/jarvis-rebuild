// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TaskRow } from "./screens/TasksPage";
import type { TaskItem } from "./TasksService";
import { taskVerb, isStartVerb } from "./rowVerb";
import { setCategoryRegistry } from "../shared/categories";

// CLEAN ROWS, GESTURES FOR VERBS (Dave 2026-10-05, locked; docs/jarvis-unified/ROW-ACTIONS-SPEC.md). The catalog gate for
// the Life task row: no capsule on the row, the swipe-left verb per state (ready Start, active Wrap Up, low priority
// Move, otherwise Done), swipe right completes, the contextual verb shows on the row only once its moment has come
// (overdue), the long press is the menu, and every title is drawn in Title Case.

setCategoryRegistry([{ id: "work", name: "Work", color: "blue" }]);
afterEach(() => { cleanup(); vi.useRealTimers(); });

const TODAY = "2026-05-20";
const task = (id: string, text: string, due: string | null, extra: Partial<TaskItem["data"]> = {}): TaskItem =>
  ({ id, data: { text, category: "work", done: false, due, ...extra } });
const noop = () => {};
const tray = (c: HTMLElement) => [...c.querySelectorAll(".task-swipe > button")].map((b) => b.textContent);

describe("taskVerb: the one quickest verb, by state", () => {
  const can = { canStart: true, canMove: true, canDone: true };
  const open = { done: false };
  it("ready to work is Start, blocked is Unblock, active is Wrap Up", () => {
    expect(taskVerb(open, { ...can, startLabel: "Start" })).toBe("Start");
    expect(taskVerb(open, { ...can, startLabel: "Unblock" })).toBe("Unblock");
    expect(taskVerb(open, { ...can, startLabel: "Resume" })).toBe("Wrap Up");
    expect(isStartVerb("Start") && isStartVerb("Unblock") && !isStartVerb("Wrap Up")).toBe(true);
  });
  it("low priority is Move, a bill is Mark Paid, and otherwise it is Done", () => {
    expect(taskVerb(open, { ...can, lowPriority: true })).toBe("Move");
    expect(taskVerb({ done: false, bill: { amount: 10, dueDay: 1 } as never }, can)).toBe("Mark Paid");
    expect(taskVerb(open, { canStart: false, canMove: true, canDone: true })).toBe("Done");
  });
  it("a done task has no verb, and a row that can do nothing has none either", () => {
    expect(taskVerb({ done: true }, can)).toBeNull();
    expect(taskVerb(open, { canStart: false, canMove: false, canDone: false })).toBeNull();
  });
});

describe("the task row: no pill, and the swipe-left tray follows the state", () => {
  const row = (item: TaskItem, props: Partial<Parameters<typeof TaskRow>[0]> = {}) =>
    render(<TaskRow item={item} today={TODAY} onToggle={noop} onOpen={noop} onDelete={noop} onSnooze={noop} onStart={noop} {...props} />);

  it("ready to work: Start, then Tomorrow, then Delete, and no capsule anywhere on the row", () => {
    const { container } = row(task("a", "call the bank", TODAY));
    expect(tray(container)).toEqual(["Start", "Tomorrow", "Delete"]);
    expect(container.querySelectorAll(".pill-act, .row-act, .btn-sm, .quiet-action")).toHaveLength(0);
    expect(container.querySelector(".task-done-rail")).toHaveTextContent("Done");
  });

  it("the verb is Resume's Wrap Up when work is in hand, and Unblock when blocked", () => {
    expect(tray(row(task("a", "x", TODAY), { startLabel: () => "Resume" }).container)[0]).toBe("Wrap Up");
    cleanup();
    expect(tray(row(task("a", "x", TODAY), { startLabel: () => "Unblock" }).container)[0]).toBe("Unblock");
  });

  it("low priority: Move is the verb and is Tomorrow, so the tray is Move and Delete", () => {
    const onSnooze = vi.fn();
    const { container } = row(task("a", "x", TODAY), { lowPriority: true, onSnooze });
    expect(tray(container)).toEqual(["Move", "Delete"]);
    fireEvent.click(container.querySelector(".task-verb")!);
    expect(onSnooze).toHaveBeenCalledWith("a");
  });

  it("a caller with no Start falls through to Done; a bill is Mark Paid and is never moved to tomorrow", () => {
    expect(tray(row(task("a", "x", TODAY), { onStart: undefined }).container)).toEqual(["Done", "Tomorrow", "Delete"]);
    cleanup();
    expect(tray(row(task("b", "rent", TODAY, { bill: { amount: 900, dueDay: 1 } as never })).container)).toEqual(["Mark Paid", "Delete"]);
  });

  it("a done row keeps Delete behind the reveal and nothing else", () => {
    const { container } = row(task("a", "x", TODAY, { done: true }));
    expect(tray(container)).toEqual(["Delete"]);
    expect(container.querySelector(".task-done-rail")).toBeNull();
  });

  it("the verb names its record, and runs the row's own door", () => {
    const onStart = vi.fn();
    row(task("a", "call the bank", TODAY), { onStart });
    fireEvent.click(screen.getByRole("button", { name: "Start Call the Bank" }));
    expect(onStart).toHaveBeenCalledWith("a");
  });

  it("a caller's own verb (Drop on a Health row) replaces the state's, still as a swipe and never a pill", () => {
    const run = vi.fn();
    const { container } = row(task("a", "x", TODAY), { action: { label: "Drop", onClick: run }, onStart: undefined });
    expect(tray(container)[0]).toBe("Drop");
    expect(container.querySelectorAll(".pill-act")).toHaveLength(0);
    fireEvent.click(container.querySelector(".task-verb")!);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("contextual surfacing: the verb shows on the row only when its moment has come", () => {
  const ctx = (c: HTMLElement) => [...c.querySelectorAll(".row-ctx")].map((b) => b.textContent);
  const row = (item: TaskItem, props: Partial<Parameters<typeof TaskRow>[0]> = {}) =>
    render(<TaskRow item={item} today={TODAY} onToggle={noop} onOpen={noop} onDelete={noop} onSnooze={noop} onStart={noop} {...props} />);

  it("an overdue task shows its verb as text, running the same action; a future one stays clean", () => {
    const onStart = vi.fn();
    const late = row(task("a", "x", "2026-05-18"), { onStart });
    expect(ctx(late.container)).toEqual(["Start"]);
    expect(late.container.querySelectorAll(".pill-act")).toHaveLength(0);
    fireEvent.click(late.container.querySelector(".row-ctx")!);
    expect(onStart).toHaveBeenCalledWith("a");
    cleanup();
    expect(ctx(row(task("b", "x", "2026-05-25")).container), "future: nothing").toEqual([]);
    cleanup();
    expect(ctx(row(task("c", "x", null)).container), "undated: nothing").toEqual([]);
  });

  it("Done is the check on the left, so it is never surfaced as words", () => {
    expect(ctx(row(task("a", "x", "2026-05-18"), { onStart: undefined }).container)).toEqual([]);
  });

  it("a done row surfaces nothing", () => {
    expect(ctx(row(task("a", "x", "2026-05-18", { done: true })).container)).toEqual([]);
  });
});

describe("swipe right completes, and the long press is the menu", () => {
  it("swiping right past half the rail ticks the row (after the burst window)", () => {
    vi.useFakeTimers();
    const onToggle = vi.fn();
    const { container } = render(<TaskRow item={task("a", "x", TODAY)} today={TODAY} onToggle={onToggle} onOpen={noop} onDelete={noop} onStart={noop} />);
    const el = container.querySelector(".task-row")!;
    fireEvent.touchStart(el, { touches: [{ clientX: 10, clientY: 10 }] });
    fireEvent.touchMove(el, { touches: [{ clientX: 80, clientY: 12 }] });
    fireEvent.touchEnd(el);
    act(() => { vi.advanceTimersByTime(700); });
    expect(onToggle).toHaveBeenCalledWith("a");
  });

  it("a hold opens the menu, the verb first and Delete last; nothing in it is a second capsule on the row", () => {
    vi.useFakeTimers();
    const { container } = render(<TaskRow item={task("a", "call the bank", TODAY)} today={TODAY} onToggle={noop} onOpen={noop} onDelete={noop}
      onSnooze={noop} onStart={noop} onRename={noop} onFirstStep={noop} />);
    const el = container.querySelector(".task-row")!;
    fireEvent.touchStart(el, { touches: [{ clientX: 10, clientY: 10 }] });
    act(() => { vi.advanceTimersByTime(500); });
    fireEvent.touchEnd(el);
    const items = [...document.querySelectorAll(".action-sheet")[0]!.querySelectorAll("button")].map((b) => b.textContent);
    expect(items).toEqual(["Start", "First Step", "Done", "Move to Tomorrow", "Rename", "Delete"]);
    expect(container.querySelectorAll(".pill-act")).toHaveLength(0);
  });

  it("the menu never makes a person do the hold: every line is also the tray, the sheet or the check", () => {
    const { container } = render(<TaskRow item={task("a", "x", TODAY)} today={TODAY} onToggle={noop} onOpen={noop} onDelete={noop} onSnooze={noop} onStart={noop} />);
    expect(tray(container)).toEqual(["Start", "Tomorrow", "Delete"]);
    expect(container.querySelector(".task-check-tap")).not.toBeNull();
  });
});

describe("Title Case on every title the row draws", () => {
  it("shows a title typed in any case in Title Case, with acronyms and the number rule", () => {
    const { container, unmount } = render(<TaskRow item={task("a", "get new car insurance", TODAY)} today={TODAY} onToggle={noop} onOpen={noop} />);
    expect(container.querySelector(".task-name")).toHaveTextContent("Get New Car Insurance");
    unmount();
    const b = render(<TaskRow item={task("b", "create ai financial advisor", TODAY)} today={TODAY} onToggle={noop} onOpen={noop} />);
    expect(b.container.querySelector(".task-name")).toHaveTextContent("Create AI Financial Advisor");
    b.unmount();
    const c = render(<TaskRow item={task("c", "get ein number", TODAY)} today={TODAY} onToggle={noop} onOpen={noop} />);
    expect(c.container.querySelector(".task-name")).toHaveTextContent("Get EIN Number");
    c.unmount();
    const d = render(<TaskRow item={task("d", "2 blocks of focus", TODAY)} today={TODAY} onToggle={noop} onOpen={noop} />);
    expect(d.container.querySelector(".task-name")).toHaveTextContent("2 Blocks of Focus");
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act } from "@testing-library/react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import TasksPage from "./screens/TasksPage";
import type { TaskItem } from "./TasksService";
import type { TaskFilter } from "./filters";
import { setCategoryRegistry } from "../shared/categories";

setCategoryRegistry([
  { id: "orgB", name: "Ridgeley", color: "sky" },
  { id: "elite", name: "Elite", color: "red" },
  { id: "family", name: "Family", color: "pink" },
  { id: "money", name: "Money", color: "yellow" },
  { id: "health", name: "Health", color: "green" },
  { id: "brain", name: "Brain", color: "blue" },
  { id: "friends", name: "Friends", color: "teal" },
]);


const tk = (id: string, due: string | null, cat = "orgB"): TaskItem => ({ id, data: { text: id, category: cat, done: false, due } });
const counts: Record<TaskFilter, number> = { all: 6, daily: 0, today: 2, overdue: 1, upcoming: 3, done: 1 };

describe("TasksPage", () => {
  it("renders the filter chip row with counts", () => {
    const { container } = render(<TasksPage filter="today" counts={counts} items={[tk("a", "2026-05-20")]} today="2026-05-20" />);
    expect(container.querySelector(".chip-row")).toBeTruthy();
    expect(container.textContent).toContain("3"); // an upcoming count surfaces
  });

  it("renders task rows with category check and urgency colors", () => {
    const { container } = render(
      <TasksPage filter="today" counts={counts} items={[tk("over", "2026-05-18"), tk("due", "2026-05-20")]} today="2026-05-20" />,
    );
    expect(container.querySelector(".task-check.cat-bd-sky")).toBeTruthy();
    expect(container.querySelector(".urgency-red")).toBeTruthy();
    expect(container.querySelector(".urgency-warn")).toBeTruthy();
  });

  it("shows an empty state when the filter has no items", () => {
    const { container } = render(<TasksPage filter="done" counts={{ all: 0, daily: 0, today: 0, overdue: 0, upcoming: 0, done: 0 }} items={[]} today="2026-05-20" />);
    expect(container.querySelector(".empty-state")).toBeTruthy();
  });

  it("fires onToggle after the completion animation window (optimistic check)", () => {
    vi.useFakeTimers();
    const onToggle = vi.fn();
    const { container } = render(<TasksPage filter="today" counts={counts} items={[tk("a", "2026-05-20")]} today="2026-05-20" onToggle={onToggle} />);
    fireEvent.click(container.querySelector(".task-check") as HTMLElement);
    // check flips immediately (optimistic), burst plays, toggle is held 600ms
    expect(container.querySelector(".task-check.done")).toBeTruthy();
    expect(container.querySelector(".burst")).toBeTruthy();
    expect(onToggle).not.toHaveBeenCalled();
    // a second tap during the window is ignored (no double toggle)
    fireEvent.click(container.querySelector(".task-check") as HTMLElement);
    vi.advanceTimersByTime(700);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith("a");
    vi.useRealTimers();
  });

  it("un-completing fires immediately with no ceremony", () => {
    const onToggle = vi.fn();
    const doneTask: TaskItem = { id: "d", data: { text: "d", category: "orgB", done: true, due: "2026-05-20" } };
    const { container } = render(<TasksPage filter="done" counts={counts} items={[doneTask]} today="2026-05-20" onToggle={onToggle} />);
    fireEvent.click(container.querySelector(".task-check") as HTMLElement);
    expect(onToggle).toHaveBeenCalledWith("d");
  });
});

// B6 / B8 (2026-08-23): editing and adding without leaving the list.
describe("TasksPage editing in place", () => {
  // Dave 2026-08-24: "when I tap to edit a task it now edits the text
  // instead... it's WAY more important that I can easily click and edit the
  // tasks." B6 gave the title's TAP to InlineEdit, and the test that shipped
  // with it asserted exactly that, so the suite was holding the complaint in
  // place. The title is the biggest thing on the row and what a thumb aims
  // for when the intent is "open this". The tap opens; rename is the hold.
  const hold = (el: Element) => {
    fireEvent.touchStart(el, { touches: [{ clientX: 10, clientY: 10 }] });
    act(() => { vi.advanceTimersByTime(500); });
    fireEvent.touchEnd(el);
  };

  it("tapping the title opens the editor, because that is what a tap means", () => {
    const onOpenTask = vi.fn();
    const onRenameTask = vi.fn();
    const { container } = render(
      <TasksPage filter="today" counts={counts} items={[tk("a", "2026-05-20")]} today="2026-05-20"
        onRenameTask={onRenameTask} onOpenTask={onOpenTask} />,
    );
    const title = container.querySelector(".conn-name")!;
    // Not editable at rest: nothing to fall into.
    expect(title.getAttribute("contenteditable")).not.toBe("true");
    fireEvent.click(title);
    expect(onOpenTask).toHaveBeenCalledWith("a");
    expect(onRenameTask).not.toHaveBeenCalled();
  });

  it("holding the title renames it where it stands", () => {
    vi.useFakeTimers();
    const onRenameTask = vi.fn();
    const onOpenTask = vi.fn();
    const { container } = render(
      <TasksPage filter="today" counts={counts} items={[tk("a", "2026-05-20")]} today="2026-05-20"
        onRenameTask={onRenameTask} onOpenTask={onOpenTask} />,
    );
    hold(container.querySelector(".conn-name")!);
    const field = container.querySelector('[contenteditable="true"]')!;
    expect(field).toBeTruthy();
    field.textContent = "Renamed";
    fireEvent.blur(field);
    expect(onRenameTask).toHaveBeenCalledWith("a", "Renamed");
    // The hold must not ALSO open the sheet: one gesture, one outcome.
    expect(onOpenTask).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("a done task is not renamable, so the hold does nothing", () => {
    vi.useFakeTimers();
    const onRenameTask = vi.fn();
    const done = { ...tk("a", "2026-05-20"), data: { ...tk("a", "2026-05-20").data, done: true } } as TaskItem;
    const { container } = render(
      <TasksPage filter="today" counts={counts} items={[done]} today="2026-05-20" onRenameTask={onRenameTask} />,
    );
    hold(container.querySelector(".conn-name")!);
    expect(container.querySelector('[contenteditable="true"]')).toBeNull();
    vi.useRealTimers();
  });

  it("keeps the rest of the row opening the full editor", () => {
    const onOpenTask = vi.fn();
    const { container } = render(
      <TasksPage filter="today" counts={counts} items={[tk("a", "2026-05-20")]} today="2026-05-20"
        onRenameTask={() => {}} onOpenTask={onOpenTask} />,
    );
    fireEvent.click(container.querySelector(".eyebrow")!);
    expect(onOpenTask).toHaveBeenCalledWith("a");
  });

  it("does not save an empty title or an unchanged one", () => {
    const onRenameTask = vi.fn();
    const { container } = render(
      <TasksPage filter="today" counts={counts} items={[tk("a", "2026-05-20")]} today="2026-05-20"
        onRenameTask={onRenameTask} />,
    );
    const title = container.querySelector(".conn-name")!;
    title.textContent = "   ";
    fireEvent.blur(title);
    expect(onRenameTask).not.toHaveBeenCalled();
  });

  it("ends the list with the way to grow it, and never as a second red fill", () => {
    const onNew = vi.fn();
    const { container } = render(
      <TasksPage filter="today" counts={counts} items={[tk("a", "2026-05-20")]} today="2026-05-20" onNew={onNew} />,
    );
    const add = container.querySelector(".row-act")!;
    expect(add).toHaveTextContent("Add a Task");
    expect(add.className).not.toContain("btn-primary");
    fireEvent.click(add);
    expect(onNew).toHaveBeenCalled();
  });

  it("offers no trailing add on the done list", () => {
    const { container } = render(
      <TasksPage filter="done" counts={counts} items={[tk("a", "2026-05-20")]} today="2026-05-20" onNew={() => {}} />,
    );
    expect(container.querySelector(".row-act")).toBeNull();
  });
});

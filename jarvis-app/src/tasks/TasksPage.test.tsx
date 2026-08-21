// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
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

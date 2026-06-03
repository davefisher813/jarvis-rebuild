// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import TasksPage from "./screens/TasksPage";
import type { TaskItem } from "./TasksService";
import type { TaskFilter } from "./filters";
import { setCategoryRegistry } from "../shared/categories";

setCategoryRegistry([
  { id: "tucci", name: "Tucci", color: "sky" },
  { id: "elite", name: "Elite", color: "red" },
  { id: "family", name: "Family", color: "pink" },
  { id: "money", name: "Money", color: "yellow" },
  { id: "health", name: "Health", color: "green" },
  { id: "brain", name: "Brain", color: "blue" },
  { id: "friends", name: "Friends", color: "teal" },
]);


const tk = (id: string, due: string | null, cat = "tucci"): TaskItem => ({ id, data: { text: id, category: cat, done: false, due } });
const counts: Record<TaskFilter, number> = { daily: 0, today: 2, overdue: 1, upcoming: 3, done: 1 };

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
    const { container } = render(<TasksPage filter="done" counts={{ daily: 0, today: 0, overdue: 0, upcoming: 0, done: 0 }} items={[]} today="2026-05-20" />);
    expect(container.querySelector(".empty-state")).toBeTruthy();
  });

  it("fires onToggle with the task id when the check is tapped", () => {
    const onToggle = vi.fn();
    const { container } = render(<TasksPage filter="today" counts={counts} items={[tk("a", "2026-05-20")]} today="2026-05-20" onToggle={onToggle} />);
    fireEvent.click(container.querySelector(".task-check") as HTMLElement);
    expect(onToggle).toHaveBeenCalledWith("a");
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import TasksPage from "./screens/TasksPage";
import type { TaskItem } from "./TasksService";
import type { TaskFilter } from "./filters";

// ONE LEADING CONTROL ON A TASK ROW (2026-10-05, the perfect bar: "TWO leading controls, a star and a check"). The completion check is the
// row's only leading control. The star appears only while the task is remembered, in the gutter, and Remember is a line in the long press.
const run = vi.fn(async () => {});
let on = false;
vi.mock("../shared/EntityStar", () => ({
  default: ({ quiet }: { quiet?: boolean }) => (quiet && !on ? null : <button type="button" className={"row-star" + (on ? " on" : "")} aria-label="Forget this" />),
  useRemember: () => ({ on, run }),
}));

const counts: Record<TaskFilter, number> = { all: 1, daily: 0, today: 1, overdue: 0, upcoming: 0, email: 0, done: 0 };
const item: TaskItem = { id: "t1", data: { text: "Draft the Coach Onboarding Email", category: "", done: false, due: null } };
const page = () => render(<TasksPage filter="all" counts={counts} items={[item]} today="2026-05-20" />);

describe("a task row's leading controls", () => {
  it("is the check alone, and Remember is on the long press", () => {
    on = false; run.mockClear();
    const { container } = page();
    const row = container.querySelector(".task-row")!;
    expect(row.querySelector(".row-star"), "no empty star").toBeNull();
    expect(row.querySelectorAll(".task-check-tap")).toHaveLength(1);
    fireEvent.contextMenu(screen.getByText("Draft the Coach Onboarding Email"));
    fireEvent.click(within(document.querySelector(".action-sheet") as HTMLElement).getByText("Remember"));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a remembered task wears the filled star beside its check, and offers Forget", () => {
    on = true; run.mockClear();
    const { container } = page();
    expect(container.querySelector(".task-row > .row-star.on")).not.toBeNull();
    fireEvent.contextMenu(screen.getByText("Draft the Coach Onboarding Email"));
    expect(within(document.querySelector(".action-sheet") as HTMLElement).getByText("Forget")).toBeInTheDocument();
  });
});

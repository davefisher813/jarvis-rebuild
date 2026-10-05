// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTasks } from "../data/NotesProvider";
import UpNextFlow from "../upnext/UpNextFlow";
import TasksPage from "./screens/TasksPage";
import type { TaskItem } from "./TasksService";
import type { TaskFilter } from "./filters";
import { todayISO } from "./grouping";

// ONE TITLE, ONE CASING (2026-10-05, the perfect bar: Focus said "Call With Nadia at 10 AM" while the list and the schedule said
// "Call with Nadia at 10 AM"). A typed title is stored as typed and SHOWN in Title Case, small words small, the same on every screen.
const TYPED = "call With nadia at 10 AM";
const SHOWN = "Call with Nadia at 10 AM";

function Seeded() {
  const tasks = useTasks();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void (async () => { await tasks.createTask(TYPED, { due: todayISO() }); setReady(true); })();
  }, [tasks]);
  return ready ? <UpNextFlow onClose={() => {}} /> : null;
}

describe("a task's title reads the same on every screen", () => {
  it("Focus and the Tasks list draw the same cased title", async () => {
    const { container } = render(<NotesProvider userId="title-across"><Seeded /></NotesProvider>);
    await waitFor(() => expect(container.querySelector(".focus-task")?.textContent).toBe(SHOWN));

    const counts: Record<TaskFilter, number> = { all: 1, daily: 0, today: 1, overdue: 0, upcoming: 0, email: 0, done: 0 };
    const item: TaskItem = { id: "t1", data: { text: TYPED, done: false, due: null } };
    const list = render(<TasksPage filter="all" counts={counts} items={[item]} today="2026-05-20" />);
    expect(list.container.querySelector(".task-name")!.textContent).toBe(SHOWN);
    expect(screen.queryByText("Call With Nadia at 10 AM")).toBeNull();
  });
});

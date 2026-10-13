// @vitest-environment jsdom
// Issue 102, parity on Schedule: an Anytime row opens the same Edit Task sheet,
// and Mark Done there sets the task done (it did not flip, and a refused write
// no longer closes the sheet). The chain itself is pinned in saveTaskEdit.test.ts.
import { describe, it, expect, vi, afterEach } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTasks } from "../data/NotesProvider";
import type { TasksService } from "../tasks/TasksService";
import { subscribeToast, resetToasts, type ToastState } from "../shared/toast";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";
import ScheduleFlow from "./ScheduleFlow";

let svcRef: { svc: TasksService; id: string } | null = null;
function Gate() {
  const tasks = useTasks();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void (async () => {
      svcRef = { svc: tasks, id: (await tasks.createTask("Send Invoice", {}))! };
      setReady(true);
    })();
  }, [tasks]);
  return ready ? <ScheduleFlow /> : null;
}

const openSheet = async () => {
  fireEvent.click(await screen.findByText("Send Invoice", undefined, { timeout: 4000 }));
  await screen.findByText("Edit Task");
};

afterEach(() => { vi.restoreAllMocks(); });

describe("ScheduleFlow: Mark Done from the Edit Task sheet (issue 102)", () => {
  it("sets the task done, closes the sheet, and the toast offers Undo", async () => {
    resetToasts();
    const seen: ToastState[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t); });
    render(<NotesProvider userId="sched-markdone-1"><Gate /></NotesProvider>);
    await openSheet();
    fireEvent.click(screen.getByText("Mark Done"));
    await waitFor(() => expect(screen.queryByText("Edit Task")).not.toBeInTheDocument());
    await waitFor(async () => expect((await svcRef!.svc.task(svcRef!.id))!.done).toBe(true));
    expect(seen.some((t) => t.actionLabel === "Undo")).toBe(true);
    stop();
  });

  it("a refused completion keeps the sheet open and says so", async () => {
    resetToasts();
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    render(<NotesProvider userId="sched-markdone-2"><Gate /></NotesProvider>);
    await openSheet();
    vi.spyOn(svcRef!.svc, "completeTask").mockRejectedValue(new Error("offline"));
    fireEvent.click(screen.getByText("Mark Done"));
    await waitFor(() => expect(seen).toContain(WRITE_FAILED_MESSAGE));
    expect(screen.getByText("Edit Task")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Save")).toBeInTheDocument());
    expect((await svcRef!.svc.task(svcRef!.id))!.done).toBeFalsy();
    stop();
  });
});

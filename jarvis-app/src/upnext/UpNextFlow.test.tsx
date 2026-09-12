// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTasks } from "../data/NotesProvider";
import type { TasksService } from "../tasks/TasksService";
import UpNextFlow from "./UpNextFlow";
import { todayISO } from "../tasks/grouping";
import { subscribeToast, type ToastState } from "../shared/toast";

// 2026-09-11: Undo on Up Next called toggleDone a second time, which on a
// recurring task rolls it out another period instead of taking the tick back.
// It restores the pre-tick snapshot now (LIFE-F-02 / SHARED-F-03).

let captured: { svc: TasksService; id: string } | null = null;

function Seeded() {
  const tasks = useTasks();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      const id = await tasks.createTask("Water plants", { due: todayISO(), recurrence: "weekly" });
      captured = { svc: tasks, id: id! };
      setReady(true);
    })();
  }, [tasks]);
  return ready ? <UpNextFlow onClose={() => {}} /> : null;
}

describe("Up Next Undo", () => {
  it("puts a ticked recurring task back exactly as it was", async () => {
    const seen: { t: ToastState | null } = { t: null };
    const stop = subscribeToast((t) => { if (t?.actionLabel === "Undo") seen.t = t; });
    try {
      render(<NotesProvider userId="upnext-undo"><Seeded /></NotesProvider>);
      await waitFor(() => expect(screen.getByText("Water plants")).toBeInTheDocument());
      const before = (await captured!.svc.task(captured!.id))!;
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
      await waitFor(() => expect(seen.t).not.toBeNull(), { timeout: 3000 });
      expect((await captured!.svc.task(captured!.id))!.due).not.toBe(before.due);
      // Tapped twice: the same answer either way.
      await Promise.resolve(seen.t!.onAction!());
      await Promise.resolve(seen.t!.onAction!());
      const after = (await captured!.svc.task(captured!.id))!;
      expect(after.due).toBe(before.due);
      expect(after.runLen ?? null).toBeNull();
      expect(after.done).toBe(false);
    } finally {
      stop();
    }
  });
});

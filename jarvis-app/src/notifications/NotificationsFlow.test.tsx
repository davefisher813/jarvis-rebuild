// SPEC MOVED (Catalog V3.1, 2026-08-18): Title Case everywhere; copy assertions updated.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useEffect, useState } from "react";
import { NotesProvider, useTasks } from "../data/NotesProvider";
import NotificationsFlow from "./NotificationsFlow";
import { subscribeToast, resetToasts, type ToastState } from "../shared/toast";

describe("NotificationsFlow", () => {
  it("shows caught-up empty state with no data", async () => {
    render(<NotesProvider userId="u1"><NotificationsFlow /></NotesProvider>);
    expect(await screen.findByText("You're All Caught Up")).toBeInTheDocument();
  });
});

// SHELL-F-22 (2026-09-05): a notification could be opened or marked Done by
// tap, but only waved off by swiping left. A swipe is undiscoverable on a
// screen whose rows also open on tap, so the one action that clears a row
// was the one action nothing on screen mentioned.
describe("NotificationsFlow: Dismiss without the swipe", () => {
  // The flow reads the feed once on mount, so the task has to be there
  // before it renders: this seeds inside the same provider (and so the same
  // in-memory store) and mounts the screen when the write has landed.
  function Seeded() {
    const tasks = useTasks();
    const [ready, setReady] = useState(false);
    useEffect(() => {
      void tasks.createTask("Call the plumber", { due: "2020-01-01" }).then(() => setReady(true));
    }, [tasks]);
    return ready ? <NotificationsFlow /> : null;
  }

  beforeEach(() => { localStorage.clear(); });
  afterEach(() => vi.useRealTimers());

  it("a long press offers Dismiss, and dismissing clears the row", async () => {
    render(<NotesProvider userId="u-notif-longpress"><Seeded /></NotesProvider>);
    // One overdue task can raise two nudges (the sliding one and the overdue
    // one), which is the feed's business; what matters here is that the row
    // held is the row that goes.
    const rows = await screen.findAllByText("Call the plumber");

    vi.useFakeTimers();
    const shell = rows[0]!.closest(".swipe-shell")!;
    fireEvent.touchStart(shell, { touches: [{ clientX: 5, clientY: 5 }] });
    act(() => { vi.advanceTimersByTime(500); });

    const dismiss = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Dismiss")!;
    expect(dismiss).toBeTruthy();
    fireEvent.click(dismiss);
    expect(screen.queryAllByText("Call the plumber").length).toBe(rows.length - 1);
  });
});

// 2026-09-11: one overdue task shows twice (sliding + overdue). Done cleared
// only the tapped row, so Done on the twin toggled it back to not-done; and
// Undo was a second toggleDone, which rolls a recurring task forward again.
describe("NotificationsFlow: Done and Undo on a task", () => {
  let svc: ReturnType<typeof useTasks> | null = null;
  let taskId = "";
  function Seeded({ weekly }: { weekly?: boolean }) {
    const tasks = useTasks();
    const [ready, setReady] = useState(false);
    useEffect(() => {
      svc = tasks;
      void tasks.createTask("Water plants", { due: "2020-01-01", ...(weekly ? { recurrence: "weekly" as const } : {}) })
        .then((id) => { taskId = id!; setReady(true); });
    }, [tasks, weekly]);
    return ready ? <NotificationsFlow /> : null;
  }

  beforeEach(() => { localStorage.clear(); resetToasts(); });

  it("Done clears every row for the task, so the twin cannot un-complete it", async () => {
    render(<NotesProvider userId="u-notif-done-twin"><Seeded /></NotesProvider>);
    const rows = await screen.findAllByText("Water plants");
    expect(rows.length).toBe(2); // sliding + overdue
    fireEvent.click(screen.getAllByText("Done")[0]!);
    await waitFor(() => expect(screen.queryAllByText("Water plants")).toHaveLength(0));
    expect((await svc!.task(taskId))!.done).toBe(true);
  });

  it("Undo restores a recurring task as it was, never rolls it forward again", async () => {
    let toast: ToastState | null = null;
    const unsub = subscribeToast((t) => { toast = t; });
    try {
      render(<NotesProvider userId="u-notif-done-undo"><Seeded weekly /></NotesProvider>);
      await screen.findAllByText("Water plants");
      fireEvent.click(screen.getAllByText("Done")[0]!);
      await waitFor(() => expect(screen.queryAllByText("Water plants")).toHaveLength(0));
      expect((await svc!.task(taskId))!.due).not.toBe("2020-01-01");

      act(() => { (toast as ToastState | null)?.onAction?.(); });
      await waitFor(async () => {
        const after = (await svc!.task(taskId))!;
        expect(after.done).toBe(false);
        expect(after.due).toBe("2020-01-01");
      });
    } finally {
      unsub();
    }
  });
});

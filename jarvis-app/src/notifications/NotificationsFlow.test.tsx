// SPEC MOVED (Catalog V3.1, 2026-08-18): Title Case everywhere; copy assertions updated.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useEffect, useState } from "react";
import { NotesProvider, useTasks } from "../data/NotesProvider";
import NotificationsFlow from "./NotificationsFlow";

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

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { useEffect, useState, type ReactNode } from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
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
      await waitFor(() => expect(screen.getByText("Water Plants")).toBeInTheDocument());
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

// FOCUS IS THE WHOLE SCREEN, AND STAYS OPEN AFTER 15 MIN (issue 108, Dave 2026-10-13: "the task title, a countdown, then the
// existing controls"). The countdown is the fifteen-minute block's: the window the 15 Min capsule will run before one starts,
// the block's own time left while it runs on THIS card, and nothing for a card it is not running on. Each fails without the
// change (there was no countdown, 15 Min closed the screen from Today, and the deck did not follow a completion made elsewhere).
let seq = 0;
function Seed({ children }: { children: (s: { svc: TasksService; a: string; b: string }) => ReactNode }) {
  const tasks = useTasks();
  const [seed, setSeed] = useState<{ a: string; b: string } | null>(null);
  useEffect(() => {
    (async () => {
      const a = await tasks.createTask("Water plants", { due: todayISO() });
      const b = await tasks.createTask("Read the report", {});
      setSeed({ a: a!, b: b! });
    })();
  }, [tasks]);
  return seed ? <>{children({ svc: tasks, ...seed })}</> : null;
}
const runFace = (taskId: string, over = false) => ({
  taskId, text: "Water plants", over,
  line: over ? "15 Min Up" : "14:32 Left", clock: over ? "0:00" : "14:32",
});
const noop = () => {};
const answers = { onFifteenDone: noop, onFifteenAgain: noop, onFifteenStop: noop };

describe("Focus: the countdown and the 15 Min flow (issue 108)", () => {
  const mount = (ui: (s: { svc: TasksService; a: string; b: string }) => ReactNode) =>
    render(<NotesProvider userId={"upnext-108-" + seq++}><Seed>{ui}</Seed></NotesProvider>);

  it("before a block starts the card shows the window the 15 Min capsule will run, and it is not a moving clock", async () => {
    const { container } = mount(() => <UpNextFlow onClose={noop} onFifteen={noop} />);
    await waitFor(() => expect(screen.getByText("Water Plants")).toBeInTheDocument());
    const clock = container.querySelector(".focus-clock")!;
    expect(clock.querySelector(".hero-num")).toHaveTextContent("15:00");
    expect(clock.querySelector(".conn-meta")).toHaveTextContent("Fifteen Minutes");
    expect(clock.getAttribute("role")).toBeNull();
    expect(container.querySelector(".focus-card > .eyebrow")).toHaveTextContent("Jarvis");
    expect(screen.getByRole("button", { name: "Focus 15 Minutes" })).toBeInTheDocument();
  });

  it("offers no window it cannot run: with no 15 Min door there is no countdown to preview", async () => {
    const { container } = mount(() => <UpNextFlow onClose={noop} />);
    await waitFor(() => expect(screen.getByText("Water Plants")).toBeInTheDocument());
    expect(container.querySelector(".focus-clock")).toBeNull();
  });

  it("while the block runs on this card it is the block's own time left, the capsule is gone and the running card says it once", async () => {
    const { container } = mount((s) => <UpNextFlow onClose={noop} onFifteen={noop} fifteen={runFace(s.a)} {...answers} />);
    await waitFor(() => expect(container.querySelector("[role='timer']")).not.toBeNull());
    const t = container.querySelector("[role='timer']")!;
    expect(t.querySelector(".hero-num")).toHaveTextContent("14:32");
    expect(t.querySelector(".conn-meta")).toHaveTextContent("Left");
    expect(screen.queryByRole("button", { name: "Focus 15 Minutes" })).toBeNull();
    expect([...container.querySelectorAll(".focus-live .btn")].map((b) => b.textContent)).toEqual(["Done", "Another 15", "Stop"]);
    expect(container.querySelector(".focus-live .conn-meta"), "the time is not said twice").toBeNull();
  });

  it("once the block is up it reads 0:00 and says how long it was, in the amber", async () => {
    const { container } = mount((s) => <UpNextFlow onClose={noop} onFifteen={noop} fifteen={runFace(s.a, true)} {...answers} />);
    await waitFor(() => expect(container.querySelector("[role='timer']")).not.toBeNull());
    expect(container.querySelector(".focus-clock .hero-num")).toHaveTextContent("0:00");
    expect(container.querySelector(".focus-clock .conn-meta")).toHaveTextContent("15 Min Up");
    expect(container.querySelector(".focus-clock .conn-meta")).toHaveClass("warn");
  });

  it("a block running on a card that is not on the screen draws no countdown, and its own line stays on the running card", async () => {
    const { container } = mount((s) => <UpNextFlow onClose={noop} onFifteen={noop} fifteen={runFace(s.b)} {...answers} />);
    await waitFor(() => expect(screen.getByText("Water Plants")).toBeInTheDocument());
    expect(container.querySelector(".focus-clock")).toBeNull();
    expect(container.querySelector(".focus-live .conn-meta")).toHaveTextContent("14:32 Left");
  });

  it("Quick Wins keeps its own 10:00 run line and draws no countdown on the card", async () => {
    const { container } = mount(() => <UpNextFlow onClose={noop} onFifteen={noop} />);
    await waitFor(() => expect(screen.getByText("Water Plants")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Quick Wins" }));
    await waitFor(() => expect(container.querySelector(".focus-run-line")).toHaveTextContent("10:00 Left"));
    expect(container.querySelector(".focus-clock")).toBeNull();
  });

  it("holds the capsule still until the block has begun, so a second tap cannot book a second one", async () => {
    let finish: () => void = noop;
    const onFifteen = vi.fn(() => new Promise<void>((r) => { finish = r; }));
    mount(() => <UpNextFlow onClose={noop} onFifteen={onFifteen} />);
    const btn = await screen.findByRole("button", { name: "Focus 15 Minutes" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onFifteen).toHaveBeenCalledTimes(1);
    expect(btn).toBeDisabled();
    await act(async () => { finish(); });
    await waitFor(() => expect(btn).not.toBeDisabled());
    // And a start that failed (the promise settled with no block running) leaves the capsule tappable again.
    fireEvent.click(btn);
    expect(onFifteen).toHaveBeenCalledTimes(2);
    await act(async () => { finish(); });
  });

  it("follows a completion made underneath it: Done on the running card (Today writes it) moves the deck on", async () => {
    let at: { svc: TasksService; a: string } | null = null;
    const { container } = mount((s) => { at = { svc: s.svc, a: s.a }; return <UpNextFlow onClose={noop} onFifteen={noop} fifteen={runFace(s.a)} {...answers} />; });
    await waitFor(() => expect(container.querySelector(".focus-task")).toHaveTextContent("Water Plants"));
    expect(container.querySelector("[role='timer']")).not.toBeNull();
    await act(async () => { await at!.svc.toggleDone(at!.a); });
    await waitFor(() => expect(container.querySelector(".focus-task")).toHaveTextContent(/Read/));
    expect(container.querySelector(".focus-task")).not.toHaveTextContent("Water Plants");
    // The block belongs to the task he finished, so the new card has no clock of its own.
    expect(container.querySelector("[role='timer']")).toBeNull();
  });
});

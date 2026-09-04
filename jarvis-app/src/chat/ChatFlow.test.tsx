// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useOptionalStrands, useTasks } from "../data/NotesProvider";
import ChatFlow from "./ChatFlow";

// jsdom has no scrollIntoView; ChatFlow's own autoscroll effect calls it on
// every message, unrelated to what this file is testing.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

// S4-Q23 (2026-09-04): "Chat writes permanent facts with no undo." ChatFlow
// had no test file at all before this one -- every capture typed into Chat
// got a reply reading "Done · Undo on the toast" (provLine, kind "action")
// with no showToast anywhere on that path, so the promise on the receipt was
// simply false. A told-rank fact is the highest-priority thing JARVIS
// remembers, which made an untappable Undo there the most consequential case,
// but the bug and the fix are the same for every kind captured through chat.

const showToast = vi.fn();
vi.mock("../shared/toast", () => ({ showToast: (...a: unknown[]) => showToast(...a) }));

let strandsRef: ReturnType<typeof useOptionalStrands> | null = null;
let tasksRef: ReturnType<typeof useTasks> | null = null;
function Capture() {
  strandsRef = useOptionalStrands();
  tasksRef = useTasks();
  return null;
}

const renderChat = (userId: string) =>
  render(
    <NotesProvider userId={userId}>
      <Capture />
      <ChatFlow />
    </NotesProvider>,
  );

const sendText = (text: string) => {
  fireEvent.change(screen.getByPlaceholderText("Ask · tell · paste"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
};

beforeEach(() => { showToast.mockReset(); strandsRef = null; tasksRef = null; });
afterEach(() => { vi.restoreAllMocks(); });

describe("ChatFlow capture undo (S4-Q23)", () => {
  it("a fact typed into chat gets a real Undo toast, and Undo forgets it", async () => {
    renderChat("u-chat-fact");
    sendText("I never work out on Sundays");
    await waitFor(() => expect(screen.getByText(/^JARVIS will remember that:/)).toBeInTheDocument());
    // The reply's own provenance line claims this.
    expect(screen.getByText("Done · Undo on the toast")).toBeInTheDocument();

    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
    const call = showToast.mock.calls[0]![0] as { message: string; actionLabel: string; onAction: () => Promise<void> };
    expect(call.message).toBe("Saved");
    expect(call.actionLabel).toBe("Undo");

    await waitFor(() => expect(strandsRef).toBeTruthy());
    expect(await strandsRef!.list()).toHaveLength(1);
    await act(async () => { await call.onAction(); });
    expect(await strandsRef!.list()).toHaveLength(0);
  });

  it("an ordinary task typed into chat gets the same real Undo, not just facts", async () => {
    renderChat("u-chat-task");
    sendText("call the plumber back");
    await waitFor(() => expect(screen.getByText(/^Saved: /)).toBeInTheDocument());

    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
    const call = showToast.mock.calls[0]![0] as { message: string; actionLabel: string; onAction: () => Promise<void> };
    expect(call.message).toBe("Saved");
    expect(call.actionLabel).toBe("Undo");

    await waitFor(async () => expect(await tasksRef!.listTasks()).toHaveLength(1));
    await act(async () => { await call.onAction(); });
    expect(await tasksRef!.listTasks()).toHaveLength(0);
  });

  it("a refused fact (Brain full) raises no toast at all, since nothing was saved", async () => {
    renderChat("u-chat-full");
    await waitFor(() => expect(strandsRef).toBeTruthy());
    await act(async () => {
      for (let i = 0; i < 12; i++) await strandsRef!.add("v " + i, "routine", "2026-01-01");
    });
    sendText("I never work out on Sundays");
    await waitFor(() => expect(screen.getByText("The Brain is full · Prune it in What JARVIS Knows")).toBeInTheDocument());
    expect(showToast).not.toHaveBeenCalled();
  });
});

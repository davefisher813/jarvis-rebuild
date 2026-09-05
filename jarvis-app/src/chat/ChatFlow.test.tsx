// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useOptionalStrands, useTasks, useChat } from "../data/NotesProvider";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";
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
let chatRef: ReturnType<typeof useChat> | null = null;
function Capture() {
  strandsRef = useOptionalStrands();
  tasksRef = useTasks();
  chatRef = useChat();
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

beforeEach(() => { showToast.mockReset(); strandsRef = null; tasksRef = null; chatRef = null; });
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

// SHELL-F-07 (2026-09-05): "move dentist to tomorrow" moved it to today at
// UTC+13 and UTC+14. ChatFlow computed tomorrow as local noon plus a fixed
// day, read back through toISOString(); beyond UTC+12 local noon is still
// yesterday in UTC. Kiritimati is UTC+14 in every season.
describe("ChatFlow reschedule (SHELL-F-07)", () => {
  it("move X to tomorrow lands on the next local day fourteen hours ahead of Greenwich", async () => {
    const prevTz = process.env.TZ;
    process.env.TZ = "Pacific/Kiritimati";
    try {
      renderChat("u-chat-tz");
      await waitFor(() => expect(tasksRef).toBeTruthy());
      let id = "";
      await act(async () => { id = (await tasksRef!.createTask("Dentist", { category: "" }))!; });
      const now = new Date();
      const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const today = iso(now);
      const t = new Date(now); t.setDate(t.getDate() + 1);
      const want = iso(t);
      expect(want).not.toBe(today);
      sendText("move dentist to tomorrow");
      await waitFor(() => expect(screen.getByText("Moved to tomorrow: Dentist")).toBeInTheDocument());
      expect((await tasksRef!.task(id))?.due).toBe(want);
    } finally {
      process.env.TZ = prevTz;
    }
  });
});

// SHELL-F-17 (2026-09-05): the box emptied before the first write, inside a
// try/finally with no catch, so a store that rejected left no bubble, no
// toast and no text. The words now stay in the box until the bubble is
// stored, and a read that fails behind the reply says so.
describe("ChatFlow keeps the message when the store rejects (SHELL-F-17)", () => {
  it("a rejected user bubble leaves the draft in the box with the standard toast, and the next tap sends it", async () => {
    renderChat("u-chat-reject");
    await waitFor(() => expect(chatRef).toBeTruthy());
    vi.spyOn(chatRef!, "append").mockRejectedValueOnce(new Error("store down"));
    sendText("call the plumber back");
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ message: WRITE_FAILED_MESSAGE }));
    const box = screen.getByPlaceholderText("Ask · tell · paste") as HTMLInputElement;
    expect(box.value).toBe("call the plumber back");
    expect(screen.queryByText("call the plumber back", { selector: ".chat-text" })).not.toBeInTheDocument();
    expect(await tasksRef!.listTasks()).toHaveLength(0);

    // The store is back: the same words go through on the next tap.
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText(/^Saved: /)).toBeInTheDocument());
    expect(box.value).toBe("");
  });

  it("a command whose task read throws still shows the bubble and says the records could not be reached", async () => {
    renderChat("u-chat-listfail");
    await waitFor(() => expect(tasksRef).toBeTruthy());
    vi.spyOn(tasksRef!, "listTasks").mockRejectedValueOnce(new Error("rls"));
    sendText("Complete the plumber");
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ message: "Couldn't reach your records · Try again" }));
    expect(screen.getByText("Complete the plumber", { selector: ".chat-text" })).toBeInTheDocument();
    // Busy is released: the box takes the next message.
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled();
  });
});

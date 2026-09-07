// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useOptionalStrands, useTasks, useChat, usePeople } from "../data/NotesProvider";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";
import ChatFlow, { recentTurns } from "./ChatFlow";
import type { AIService } from "../ai/AIService";

// jsdom has no scrollIntoView; ChatFlow's own autoscroll effect calls it on
// every message, unrelated to what this file is testing.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

// UP-MIND-01 class (2026-09-07): the "text" branch of runDraft opens
// MessageDraftSheet directly and never gathered a voice before this fix.
// available: true is all that branch reads off ai; nothing else on this
// path calls complete().
vi.mock("../ai/useAI", () => ({ useAI: () => ({ available: true } as unknown as AIService) }));
const draftProps: { voice?: string }[] = [];
vi.mock("../people/MessageDraftSheet", () => ({
  default: (props: { voice?: string }) => { draftProps.push(props); return null; },
}));

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

const renderChat = (userId: string, onOpen?: (kind: string, id: string) => void) =>
  render(
    <NotesProvider userId={userId}>
      <Capture />
      <ChatFlow {...(onOpen ? { onOpen } : {})} />
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
    // SHELL-F-26 (2026-09-05): the bubble used to promise "Undo on the
    // toast" under every stored action, including yesterday's, and a toast
    // lives five seconds. The Undo below is real; the bubble no longer says
    // where it is long after it is gone.
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.queryByText("Done · Undo on the toast")).not.toBeInTheDocument();

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
    // Busy is released: the box takes the next message. Asserted by typing
    // one, because BROWSER-F-12 (2026-09-05) also disables Send on an EMPTY
    // box, so "not disabled" on its own would now be testing the wrong thing:
    // the box is empty here, the message having just gone.
    fireEvent.change(screen.getByPlaceholderText("Ask · tell · paste"), { target: { value: "and again" } });
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled();
  });
});

// BROWSER-F-12 (2026-09-05), option A. Chat rendered its own composer AND the
// shell kept the capture dock visible under it: two fields making nearly the
// same promise on one screen. And Send with nothing typed was a dead tap, not
// a disabled control, so pressing it moved nothing for 1.1 seconds.
describe("BROWSER-F-12: one input, and Send says when it cannot send", () => {
  it("Send is disabled until there is something to send", async () => {
    renderChat("u-chat-empty");
    await waitFor(() => expect(chatRef).toBeTruthy());
    const box = screen.getByPlaceholderText("Ask · tell · paste");
    expect(screen.getByRole("button", { name: "Send" }), "nothing typed").toBeDisabled();
    fireEvent.change(box, { target: { value: "what's on today?" } });
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled();
    // Whitespace is nothing typed.
    fireEvent.change(box, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Send" }), "spaces are not a message").toBeDisabled();
  });
});

// UP-MIND-02 (2026-09-05): every record an answer used has been stored on the
// bubble since Chat shipped and nothing rendered it, so an answer about a
// task left the user to go and find that task themselves.
describe("UP-MIND-02: tap what Chat cites", () => {
  it("renders the records behind an answer as chips, and tapping one opens it", async () => {
    const opened: string[] = [];
    renderChat("u-chat-refs", (kind, id) => opened.push(kind + ":" + id));
    await waitFor(() => expect(tasksRef).toBeTruthy());
    const t = await tasksRef!.createTask("Call the plumber");
    sendText("Complete the plumber");
    await waitFor(() => expect(screen.getByText("Done: Call the plumber")).toBeInTheDocument());
    const chip = await screen.findByRole("button", { name: "Call the plumber" });
    fireEvent.click(chip);
    expect(opened).toEqual(["task:" + t]);
  });

  it("renders no chip when the shell gave it nowhere to go", async () => {
    renderChat("u-chat-norefs");
    await waitFor(() => expect(tasksRef).toBeTruthy());
    await tasksRef!.createTask("Call the plumber");
    sendText("Complete the plumber");
    await waitFor(() => expect(screen.getByText("Done: Call the plumber")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Call the plumber" })).toBeNull();
  });
});

// UP-MIND-04 (2026-09-05): the AI path used to send exactly one message, so
// "and what about the week after" arrived as a fragment with no conversation
// behind it.
describe("UP-MIND-04: the AI path carries the conversation", () => {
  const turn = (role: "user" | "jarvis", text: string) => ({ data: { role, text } });

  it("sends the last turns, alternating, ending with what was just typed", () => {
    const out = recentTurns([
      turn("user", "what's on today"),
      turn("jarvis", "2 Events"),
      turn("user", "and the week after"),
    ], "and the week after");
    expect(out).toEqual([
      { role: "user", content: "what's on today" },
      { role: "assistant", content: "2 Events" },
      { role: "user", content: "and the week after" },
    ]);
  });

  it("starts on a user turn, whatever the history begins with", () => {
    const out = recentTurns([turn("jarvis", "Saved"), turn("user", "hello")], "hello");
    expect(out[0]).toEqual({ role: "user", content: "hello" });
    expect(out).toHaveLength(1);
  });

  it("caps the history so a long conversation cannot blow the input limit", () => {
    const many = [];
    for (let i = 0; i < 40; i++) many.push(turn(i % 2 === 0 ? "user" : "jarvis", "x".repeat(2000)));
    many.push(turn("user", "latest"));
    const out = recentTurns(many, "latest");
    expect(out.reduce((n, t) => n + t.content.length, 0)).toBeLessThan(8000);
  });
});

// UP-MIND-01 class (2026-09-07): "draft a text to X" opens MessageDraftSheet
// straight from ChatFlow, on a door of its own separate from the email
// branch two lines up in runDraft (which already gathered voice). This one
// never did, so a text drafted from Chat sounded like nobody.
describe("ChatFlow: drafting a text gathers a real voice first (UP-MIND-01 class)", () => {
  it("passes MessageDraftSheet a non-empty voice, not the missing prop it used to get", async () => {
    draftProps.length = 0;
    let peopleRef: ReturnType<typeof usePeople> | null = null;
    function Grab() { peopleRef = usePeople(); return null; }
    render(
      <NotesProvider userId="chat-text-voice">
        <Grab />
        <ChatFlow />
      </NotesProvider>,
    );
    await waitFor(() => expect(peopleRef).toBeTruthy());
    await act(async () => { await peopleRef!.create({ name: "Nadia Brandt", group: "contacts", phone: "555-0101" }); });
    sendText("draft a text to Nadia Brandt about the venue");
    await waitFor(() => expect(screen.getByText("Drafting a text to Nadia Brandt")).toBeInTheDocument());
    await waitFor(() => expect(draftProps.length).toBeGreaterThan(0));
    await waitFor(() => expect(draftProps.at(-1)!.voice).toMatch(/^User: /));
  });
});

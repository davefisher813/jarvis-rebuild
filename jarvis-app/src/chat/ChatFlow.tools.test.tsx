// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTasks, useChat, useDecisions } from "../data/NotesProvider";
import ChatFlow from "./ChatFlow";
import type { AIService, AITurn } from "../ai/AIService";
import { AIProviderError } from "../ai/providerFailure";
import { MAX_STEPS } from "./tools/dispatcher";

// THE CHAT WITH TOOLS, END TO END (chat box order, 2026-10-24): a real question through the real ChatFlow, the real dispatcher and the
// real records, with only the model scripted. Behind chat_tools_v1: off, the chat is exactly what it was.

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
const ai = vi.hoisted(() => ({ available: true, complete: vi.fn(), completeTurn: vi.fn() }));
vi.mock("../ai/useAI", () => ({ useAI: () => ai as unknown as AIService }));
const toast = vi.hoisted(() => ({ show: vi.fn() }));
vi.mock("../shared/toast", () => ({ showToast: (o: unknown) => toast.show(o) }));
const flags = vi.hoisted(() => ({ tools: true }));
vi.mock("../substrate/flags", async (orig) => {
  const real = await orig<typeof import("../substrate/flags")>();
  return { ...real, flagOn: (f: Parameters<typeof real.flagOn>[0]) => (f === "chat_tools_v1" ? flags.tools : real.flagOn(f)) };
});

// A question no deterministic rule answers, so it reaches the model.
const Q = "Why does the plumber keep rescheduling?";
const asks = (name: string, input: Record<string, unknown>, id = "toolu_01AAAAAA"): AITurn => ({ text: "", toolCalls: [{ id, name: name as never, input }], stop: "tool_use" });
const says = (text: string): AITurn => ({ text, toolCalls: [], stop: "end_turn" });

let tasksRef: ReturnType<typeof useTasks> | null = null;
let chatRef: ReturnType<typeof useChat> | null = null;
let decisionsRef: ReturnType<typeof useDecisions> | null = null;
function Capture() { tasksRef = useTasks(); chatRef = useChat(); decisionsRef = useDecisions(); return null; }

function renderChat(userId: string, onOpen?: (k: string, id: string) => void) {
  render(<NotesProvider userId={userId}><Capture /><ChatFlow {...(onOpen ? { onOpen } : {})} /></NotesProvider>);
}
async function ask(text: string) {
  fireEvent.change(await screen.findByPlaceholderText("Ask, Tell or Paste"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

beforeEach(() => {
  ai.complete.mockReset(); ai.completeTurn.mockReset(); ai.available = true; toast.show.mockReset();
  flags.tools = true; tasksRef = null; chatRef = null; decisionsRef = null;
});

describe("a question the model looks up", () => {
  it("searches the real records, answers from what it found, and cites what it used", async () => {
    ai.completeTurn.mockResolvedValueOnce(asks("search_items", { query: "plumber" })).mockResolvedValueOnce(says("Call the plumber is open and has no date."));
    const onOpen = vi.fn();
    renderChat("u-tools-ok", onOpen);
    await waitFor(() => expect(tasksRef).not.toBeNull());
    const id = await tasksRef!.createTask("Call the plumber");
    await ask(Q);

    expect(await screen.findByText("Call the plumber is open and has no date.")).toBeInTheDocument();
    expect(ai.complete).not.toHaveBeenCalled();
    expect(ai.completeTurn).toHaveBeenCalledTimes(2);

    // The first step sent the question and the menu; the second carried the model's call and what the dispatcher found.
    const [first, system, firstOpts] = ai.completeTurn.mock.calls[0]!;
    expect(first).toEqual([{ role: "user", content: Q }]);
    expect(firstOpts).toMatchObject({ kind: "chat" });
    expect(String(system.instructions)).toContain("look it up with a tool");
    expect(firstOpts.tools).toEqual(["search_items", "read_document", "get_schedule", "search_email", "recall_facts", "get_activity", "create_task", "update_task", "capture_decision"]);
    const second = ai.completeTurn.mock.calls[1]![0] as { role: string; content: { type: string; content?: string }[] }[];
    expect(second.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    const result = second[2]!.content[0]!;
    expect(result.type).toBe("tool_result");
    expect(JSON.parse(result.content!)).toMatchObject({ ok: true, items: [{ ref: `task:${id}`, kind: "task", title: "Call the plumber" }] });

    // The record the answer named is a chip that opens it; the stored bubble is an AI answer with that source.
    fireEvent.click(await screen.findByRole("button", { name: "Call the plumber" }));
    expect(onOpen).toHaveBeenCalledWith("task", id);
    const stored = (await chatRef!.list()).filter((m) => m.data.role === "jarvis");
    expect(stored).toHaveLength(1);
    expect(stored[0]!.data.provenance).toEqual({ kind: "ai", refs: [{ kind: "task", id, label: "Call the plumber" }] });
  });

  it("a record it only came across, and the answer never names, earns no chip", async () => {
    ai.completeTurn.mockResolvedValueOnce(asks("search_items", { query: "plumber" })).mockResolvedValueOnce(says("Nothing is booked."));
    renderChat("u-tools-nochip");
    await waitFor(() => expect(tasksRef).not.toBeNull());
    await tasksRef!.createTask("Call the plumber");
    await ask(Q);
    await screen.findByText("Nothing is booked.");
    expect(screen.queryByRole("button", { name: "Call the plumber" })).toBeNull();
  });

  it("says what it is looking at while it looks, and takes the line away when the answer lands", async () => {
    let release!: (t: AITurn) => void;
    ai.completeTurn.mockResolvedValueOnce(asks("get_schedule", { from: "2026-10-26", to: "2026-10-26" }))
      .mockImplementationOnce(() => new Promise<AITurn>((r) => { release = r; }));
    renderChat("u-tools-working");
    await ask(Q);
    expect(await screen.findByText("Checking your schedule…")).toBeInTheDocument();
    release(says("Nothing today."));
    expect(await screen.findByText("Nothing today.")).toBeInTheDocument();
    expect(screen.queryByText("Checking your schedule…")).toBeNull();
  });

  it("a call the dispatcher refuses goes back to the model as an error it can read, and the turn goes on", async () => {
    ai.completeTurn.mockResolvedValueOnce(asks("run_query", { sql: "select * from item" })).mockResolvedValueOnce(says("I could not look that up."));
    renderChat("u-tools-refused");
    await ask(Q);
    expect(await screen.findByText("I could not look that up.")).toBeInTheDocument();
    const second = ai.completeTurn.mock.calls[1]![0] as { content: { is_error?: boolean; content?: string }[] }[];
    expect(second[2]!.content[0]!.is_error).toBe(true);
    expect(JSON.parse(second[2]!.content[0]!.content!).error.code).toBe("unknown_tool");
  });

  it("a ref the model made up is refused: it cannot open a note it never found", async () => {
    ai.completeTurn.mockResolvedValueOnce(asks("read_document", { ref: "note:invented" })).mockResolvedValueOnce(says("I could not open that."));
    renderChat("u-tools-unseen");
    await ask(Q);
    await screen.findByText("I could not open that.");
    const second = ai.completeTurn.mock.calls[1]![0] as { content: { content?: string }[] }[];
    expect(JSON.parse(second[2]!.content[0]!.content!).error.code).toBe("unseen_ref");
  });
});

describe("when the turn does not end in an answer", () => {
  it("a model that never stops asking is ended in code, with a line that says so and nothing to retry", async () => {
    ai.completeTurn.mockResolvedValue(asks("search_items", { query: "plumber" }));
    renderChat("u-tools-cap");
    await ask(Q);
    expect(await screen.findByText("That took more lookups than one question gets · Try asking it a narrower way")).toBeInTheDocument();
    expect(ai.completeTurn).toHaveBeenCalledTimes(MAX_STEPS);
    expect(screen.queryByRole("button", { name: "Try Again" })).toBeNull();
  });

  it("an empty finish says so and can be tried again", async () => {
    ai.completeTurn.mockResolvedValueOnce(says("")).mockResolvedValueOnce(says("Friday."));
    renderChat("u-tools-empty");
    await ask(Q);
    expect(await screen.findByText("I didn't get an answer back · Try again")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(await screen.findByText("Friday.")).toBeInTheDocument();
  });

  it("a provider failure on any step is told in its own words, as it is without tools", async () => {
    ai.completeTurn.mockResolvedValueOnce(asks("search_items", { query: "plumber" })).mockRejectedValueOnce(new AIProviderError("AI_PROVIDER_CREDIT"));
    renderChat("u-tools-credit");
    await ask(Q);
    expect(await screen.findByText("The AI provider account is out of credit · Add credit, then ask again")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try Again" })).toBeNull();
  });

  it("nothing a tool does is ever written to the person's records, and a model that says it was is not believed", async () => {
    ai.completeTurn.mockResolvedValueOnce(asks("search_items", { query: "plumber" })).mockResolvedValueOnce(says("Done."));
    renderChat("u-tools-readonly");
    await waitFor(() => expect(tasksRef).not.toBeNull());
    await tasksRef!.createTask("Call the plumber");
    const before = JSON.stringify(await tasksRef!.listTasks());
    await ask(Q);
    // "Done." after a lookup is a claim nothing backs, so the thread says so instead.
    await screen.findByText("Nothing was changed · Ask again and I'll put it on a card for you to confirm");
    expect(screen.queryByText("Done.")).toBeNull();
    expect(JSON.stringify(await tasksRef!.listTasks())).toBe(before);
  });
});

describe("the flag", () => {
  it("off, the chat answers exactly as it did: one plain call, no menu", async () => {
    flags.tools = false;
    ai.complete.mockResolvedValueOnce("Plain answer.");
    renderChat("u-tools-off");
    await ask(Q);
    expect(await screen.findByText("Plain answer.")).toBeInTheDocument();
    expect(ai.complete).toHaveBeenCalledTimes(1);
    expect(ai.completeTurn).not.toHaveBeenCalled();
  });
});

// ---- THE WRITES (chat box order, 2026-10-24): "reads free, writes ask" ----
//
// The model never changes anything. It asks, the dispatcher turns the ask into a card showing the exact content, and only the person's tap
// makes the change. The receipt in the thread and the Undo on the toast come from what the app made.

const MOVE = "Move the plumber task to Friday";
const lastToast = () => toast.show.mock.calls[toast.show.mock.calls.length - 1]![0] as { message: string; actionLabel?: string; onAction?: () => Promise<void> };
const stored = async () => (await chatRef!.list()).map((m) => ({ role: m.data.role, text: m.data.text, kind: m.data.provenance?.kind }));

async function setUpPlumber(userId: string) {
  renderChat(userId);
  await waitFor(() => expect(tasksRef).not.toBeNull());
  const id = (await tasksRef!.createTask("Call the plumber", { due: "2026-10-29" }))!;
  return id;
}

/** The model searches, then asks to move the task, then answers in words. */
function scriptMove(id: string, after = "I put the move on a card. Tap Move Task to confirm.") {
  ai.completeTurn
    .mockResolvedValueOnce(asks("search_items", { query: "plumber" }, "toolu_01SEARCH1"))
    .mockResolvedValueOnce(asks("update_task", { ref: `task:${id}`, due: "2026-10-30" }, "toolu_01UPDATE1"))
    .mockResolvedValueOnce(says(after));
}

describe("a change the model proposes", () => {
  it("shows the exact change on a card and changes nothing until the tap", async () => {
    const id = await setUpPlumber("u-w-card");
    scriptMove(id);
    await ask(MOVE);

    expect(await screen.findByText("I put the move on a card. Tap Move Task to confirm.")).toBeInTheDocument();
    const card = (await screen.findByRole("group", { name: "Proposed Change" })).querySelector(".chat-text")!;
    expect(card.textContent).toBe("Change this task?\nCall the plumber\nDue Fri, Oct 30 (was Thu, Oct 29)");
    expect(screen.getByRole("button", { name: "Move Task" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not Now" })).toBeInTheDocument();
    expect((await tasksRef!.task(id))!.due).toBe("2026-10-29");

    // The model was told, in the card's own words, that it is waiting and nothing changed.
    const third = ai.completeTurn.mock.calls[2]![0] as { content: { content?: string }[] }[];
    const result = JSON.parse(third[4]!.content[0]!.content!);
    expect(result).toMatchObject({ ok: true, status: "awaiting_approval", card: ["Change this task?", "Call the plumber", "Due Fri, Oct 30 (was Thu, Oct 29)"] });
    expect(result.note).toContain("Nothing has been changed");
    expect(toast.show).not.toHaveBeenCalled();
  });

  it("the tap makes the change, writes the receipt from what was made, and brings its own Undo", async () => {
    const id = await setUpPlumber("u-w-tap");
    scriptMove(id);
    await ask(MOVE);
    fireEvent.click(await screen.findByRole("button", { name: "Move Task" }));

    expect(await screen.findByText("Moved to Fri, Oct 30: Call the plumber")).toBeInTheDocument();
    expect((await tasksRef!.task(id))!.due).toBe("2026-10-30");
    // The card has done its job and is gone.
    await waitFor(() => expect(screen.queryByRole("group", { name: "Proposed Change" })).toBeNull());
    const receipt = (await chatRef!.list()).find((m) => m.data.text.startsWith("Moved to"))!;
    expect(receipt.data.provenance).toEqual({ kind: "action", refs: [{ kind: "task", id, label: "Call the plumber" }] });
    // Undo is on the toast and puts the old day back.
    expect(lastToast()).toMatchObject({ message: "Task moved", actionLabel: "Undo" });
    await lastToast().onAction!();
    expect((await tasksRef!.task(id))!.due).toBe("2026-10-29");
  });

  it("a second tap on the same card changes nothing more", async () => {
    const id = await setUpPlumber("u-w-twice");
    scriptMove(id);
    await ask(MOVE);
    const btn = await screen.findByRole("button", { name: "Move Task" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await screen.findByText("Moved to Fri, Oct 30: Call the plumber");
    await waitFor(() => expect(screen.queryByRole("group", { name: "Proposed Change" })).toBeNull());
    expect((await stored()).filter((m) => m.text.startsWith("Moved to"))).toHaveLength(1);
    expect(toast.show.mock.calls.filter(([o]) => (o as { message: string }).message === "Task moved")).toHaveLength(1);
  });

  it("Not Now leaves the task alone and the thread says so", async () => {
    const id = await setUpPlumber("u-w-no");
    scriptMove(id);
    await ask(MOVE);
    fireEvent.click(await screen.findByRole("button", { name: "Not Now" }));
    expect(await screen.findByText("Left it alone: Call the plumber")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Proposed Change" })).toBeNull();
    expect((await tasksRef!.task(id))!.due).toBe("2026-10-29");
    expect(toast.show).not.toHaveBeenCalled();
  });

  it("a task changed somewhere else since the card was drawn is not overwritten, and the thread says so", async () => {
    const id = await setUpPlumber("u-w-stale");
    scriptMove(id);
    await ask(MOVE);
    await screen.findByRole("button", { name: "Move Task" });
    await tasksRef!.setDue(id, "2026-11-12");
    fireEvent.click(screen.getByRole("button", { name: "Move Task" }));
    expect(await screen.findByText("That task changed since this card was drawn · Nothing was changed")).toBeInTheDocument();
    expect((await tasksRef!.task(id))!.due).toBe("2026-11-12");
    await waitFor(() => expect(screen.queryByRole("group", { name: "Proposed Change" })).toBeNull());
    expect((await stored()).find((m) => m.text.startsWith("That task changed"))!.kind).toBe("error");
  });

  it("a newer card for the same task replaces the older one: two cards never both work", async () => {
    const id = await setUpPlumber("u-w-replace");
    scriptMove(id);
    await ask(MOVE);
    await screen.findByRole("button", { name: "Move Task" });
    ai.completeTurn
      .mockResolvedValueOnce(asks("search_items", { query: "plumber" }, "toolu_02SEARCH2"))
      .mockResolvedValueOnce(asks("update_task", { ref: `task:${id}`, due: "2026-11-02" }, "toolu_02UPDATE2"))
      .mockResolvedValueOnce(says("Here is Monday instead."));
    await ask("Move the plumber task to Monday");
    await screen.findByText("Here is Monday instead.");
    await waitFor(() => expect(screen.getAllByRole("group", { name: "Proposed Change" })).toHaveLength(1));
    expect(screen.getByRole("group", { name: "Proposed Change" }).textContent).toContain("Due Mon, Nov 2");
    fireEvent.click(screen.getByRole("button", { name: "Move Task" }));
    await screen.findByText("Moved to Mon, Nov 2: Call the plumber");
    expect((await tasksRef!.task(id))!.due).toBe("2026-11-02");
  });
});

describe("a new task, and a decision", () => {
  it("a task the person asked for is a card, then a task, then an Undo that removes it", async () => {
    renderChat("u-w-new");
    await waitFor(() => expect(tasksRef).not.toBeNull());
    ai.completeTurn
      .mockResolvedValueOnce(asks("create_task", { text: "Call the plumber about the leak", due: "2026-10-30", priority: "high" }))
      .mockResolvedValueOnce(says("It is on a card for you."));
    await ask("Can you add a task to call the plumber about the leak on Friday?");
    expect((await screen.findByRole("group", { name: "Proposed Change" })).querySelector(".chat-text")!.textContent)
      .toBe("Add this task?\nCall the plumber about the leak\nDue Fri, Oct 30\nHigh Priority");
    expect(await tasksRef!.listTasks()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Add Task" }));
    expect(await screen.findByText("Added: Call the plumber about the leak")).toBeInTheDocument();
    const [made] = await tasksRef!.listTasks();
    expect(made!.data).toMatchObject({ text: "Call the plumber about the leak", due: "2026-10-30", priority: "high", done: false });
    expect(lastToast()).toMatchObject({ message: "Task added", actionLabel: "Undo" });
    await lastToast().onAction!();
    expect(await tasksRef!.listTasks()).toHaveLength(0);
  });

  it("a decision is a card, then a record in the log", async () => {
    renderChat("u-w-decision");
    await waitFor(() => expect(decisionsRef).not.toBeNull());
    ai.completeTurn
      .mockResolvedValueOnce(asks("capture_decision", { decision: "Use Ridgeline for the roof", why: "Best warranty", ruled_out: "Summit Roofing" }))
      .mockResolvedValueOnce(says("Ready when you are."));
    await ask("Should we save that we are going with Ridgeline for the roof?");
    expect((await screen.findByRole("group", { name: "Proposed Change" })).querySelector(".chat-text")!.textContent)
      .toBe("Save this decision?\nUse Ridgeline for the roof\nWhy: Best warranty\nInstead of: Summit Roofing");
    expect(await decisionsRef!.list()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Save Decision" }));
    expect(await screen.findByText("Saved decision · Use Ridgeline for the roof")).toBeInTheDocument();
    const [rec] = await decisionsRef!.list();
    expect(rec!.data).toMatchObject({ decision: "Use Ridgeline for the roof", why: "Best warranty", ruledOut: ["Summit Roofing"], source: { kind: "chat" } });
    await lastToast().onAction!();
    expect(await decisionsRef!.list()).toHaveLength(0);
  });
});

describe("a change that never reaches the screen is never claimed", () => {
  it("a model that says it did it, after proposing, is replaced by what the dispatcher did", async () => {
    const id = await setUpPlumber("u-w-claim");
    scriptMove(id, "Done. I've moved the plumber task to Friday.");
    await ask(MOVE);
    expect(await screen.findByText("Waiting for your OK on the card below · Nothing has changed yet")).toBeInTheDocument();
    expect(screen.queryByText(/I've moved/)).toBeNull();
    expect((await stored()).some((m) => /I've moved/.test(m.text))).toBe(false);
    expect((await tasksRef!.task(id))!.due).toBe("2026-10-29");
    expect(await screen.findByRole("button", { name: "Move Task" })).toBeInTheDocument();
  });

  it("a model that says it did it without asking for anything is told so, and nothing is made", async () => {
    const id = await setUpPlumber("u-w-nocall");
    ai.completeTurn.mockResolvedValueOnce(says("I've moved the plumber task to Friday."));
    await ask(MOVE);
    expect(await screen.findByText("Nothing was changed · Ask again and I'll put it on a card for you to confirm")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Proposed Change" })).toBeNull();
    expect((await tasksRef!.task(id))!.due).toBe("2026-10-29");
  });

  it("a model that proposes and says nothing leaves the card and one honest line, not an error", async () => {
    const id = await setUpPlumber("u-w-silent");
    ai.completeTurn
      .mockResolvedValueOnce(asks("search_items", { query: "plumber" }))
      .mockResolvedValueOnce(asks("update_task", { ref: `task:${id}`, due: "2026-10-30" }))
      .mockResolvedValueOnce(says(""));
    await ask(MOVE);
    expect(await screen.findByText("Waiting for your OK on the card below · Nothing has changed yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try Again" })).toBeNull();
  });

  it("a report of what JARVIS did earlier is true and is left alone", async () => {
    renderChat("u-w-report");
    ai.completeTurn.mockResolvedValueOnce(asks("get_activity", {})).mockResolvedValueOnce(says("I added Call the plumber at 9:12 and moved Pay rent."));
    await ask("What did you do for me today?");
    expect(await screen.findByText("I added Call the plumber at 9:12 and moved Pay rent.")).toBeInTheDocument();
  });

  it("a request the record rules out gets no card, and the model's own words say why", async () => {
    renderChat("u-w-noop");
    await waitFor(() => expect(tasksRef).not.toBeNull());
    const id = (await tasksRef!.createTask("Pay rent", { due: "2026-10-31" }))!;
    ai.completeTurn
      .mockResolvedValueOnce(asks("search_items", { query: "rent" }))
      .mockResolvedValueOnce(asks("update_task", { ref: `task:${id}`, due: "2026-10-31" }))
      .mockResolvedValueOnce(says("Pay rent is already due that day."));
    await ask("Why is rent not on the 31st?");
    expect(await screen.findByText("Pay rent is already due that day.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Proposed Change" })).toBeNull();
    const third = ai.completeTurn.mock.calls[2]![0] as { content: { content?: string }[] }[];
    expect(JSON.parse(third[4]!.content[0]!.content!).error.code).toBe("nothing_to_change");
  });
});

describe("five minutes", () => {
  it("a card left too long says nothing was changed and cannot be approved", async () => {
    // The store reads the clock when it is made, so the clock is set before the screen is.
    const real = Date.now();
    let skew = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => real + skew);
    try {
      const id = await setUpPlumber("u-w-expire");
      scriptMove(id);
      await ask(MOVE);
      await screen.findByRole("button", { name: "Move Task" });
      skew = 5 * 60_000 + 1000;
      fireEvent.click(screen.getByRole("button", { name: "Move Task" }));
      expect(await screen.findByText("Timed out · Nothing was changed")).toBeInTheDocument();
      expect(lastToast().message).toBe("That card timed out · Nothing was changed");
      expect((await tasksRef!.task(id))!.due).toBe("2026-10-29");
      expect(screen.queryByRole("button", { name: "Move Task" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      await waitFor(() => expect(screen.queryByRole("group", { name: "Proposed Change" })).toBeNull());
    } finally {
      clock.mockRestore();
    }
  });
});

describe("a card outlives the screen, for its five minutes, and only for this account", () => {
  it("is still there, and still works, when the person comes back to Chat", async () => {
    const away = (id: string) => (
      <NotesProvider userId={id}><Capture /></NotesProvider>
    );
    const here = (id: string) => (
      <NotesProvider userId={id}><Capture /><ChatFlow /></NotesProvider>
    );
    const view = render(here("u-w-back"));
    await waitFor(() => expect(tasksRef).not.toBeNull());
    const id = (await tasksRef!.createTask("Call the plumber", { due: "2026-10-29" }))!;
    scriptMove(id);
    await ask(MOVE);
    await screen.findByRole("button", { name: "Move Task" });

    view.rerender(away("u-w-back"));
    await waitFor(() => expect(screen.queryByPlaceholderText("Ask, Tell or Paste")).toBeNull());
    view.rerender(here("u-w-back"));

    fireEvent.click(await screen.findByRole("button", { name: "Move Task" }));
    expect(await screen.findByText("Moved to Fri, Oct 30: Call the plumber")).toBeInTheDocument();
    expect((await tasksRef!.task(id))!.due).toBe("2026-10-30");
  });

  it("another account never sees it", async () => {
    const id = await setUpPlumber("u-w-owner");
    scriptMove(id);
    await ask(MOVE);
    await screen.findByRole("button", { name: "Move Task" });
    cleanup();
    renderChat("u-w-stranger");
    await screen.findByPlaceholderText("Ask, Tell or Paste");
    expect(screen.queryByRole("group", { name: "Proposed Change" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move Task" })).toBeNull();
  });
});

describe("the routing", () => {
  it("with the tools on, a sentence that changes something that exists goes to the model and is not filed as a new task", async () => {
    const id = await setUpPlumber("u-w-route");
    ai.completeTurn.mockResolvedValueOnce(says("Which plumber task do you mean?"));
    await ask(MOVE);
    expect(await screen.findByText("Which plumber task do you mean?")).toBeInTheDocument();
    const titles = (await tasksRef!.listTasks()).map((t) => t.data.text);
    expect(titles).toEqual(["Call the plumber"]);
    expect((await tasksRef!.task(id))!.due).toBe("2026-10-29");
  });

  it("the commands the app reads itself still come first: today and tomorrow are done on the spot, with their own Undo", async () => {
    const id = await setUpPlumber("u-w-det");
    await ask("Move the plumber to tomorrow");
    expect(await screen.findByText(/^Moved to tomorrow: Call the plumber/)).toBeInTheDocument();
    expect(ai.completeTurn).not.toHaveBeenCalled();
    expect((await tasksRef!.task(id))!.due).not.toBe("2026-10-29");
  });

  it("with the tools off, nothing is different: the sentence is a capture, as it always was", async () => {
    flags.tools = false;
    renderChat("u-w-off");
    await waitFor(() => expect(tasksRef).not.toBeNull());
    await ask(MOVE);
    expect(await screen.findByText(/^Saved: /)).toBeInTheDocument();
    expect(ai.completeTurn).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Proposed Change" })).toBeNull();
  });

  it("with the AI unavailable the sentence is a capture too: there is no model to route it to", async () => {
    ai.available = false;
    renderChat("u-w-noai");
    await waitFor(() => expect(tasksRef).not.toBeNull());
    await ask(MOVE);
    await screen.findByText(/^Saved: /);
    expect(ai.completeTurn).not.toHaveBeenCalled();
  });
});

// ---- THE INDEPENDENT REVIEW OF THE WRITE PATH (2026-10-24): what it found, held as tests ----

describe("the model's words cannot switch the guard off", () => {
  it("an unrelated lookup in the same turn does not exempt a claim", async () => {
    const id = await setUpPlumber("u-g-activity");
    ai.completeTurn
      .mockResolvedValueOnce(asks("get_activity", {}, "toolu_01ACTIVE1"))
      .mockResolvedValueOnce(asks("search_items", { query: "plumber" }, "toolu_01SEARCH1"))
      .mockResolvedValueOnce(asks("update_task", { ref: `task:${id}`, due: "2026-10-30" }, "toolu_01UPDATE1"))
      .mockResolvedValueOnce(says("I've moved the plumber task to Friday."));
    await ask(MOVE);
    expect(await screen.findByText("Waiting for your OK on the card below · Nothing has changed yet")).toBeInTheDocument();
    expect((await stored()).some((m) => /I've moved/.test(m.text))).toBe(false);
    expect((await tasksRef!.task(id))!.due).toBe("2026-10-29");
  });

  it("a polite way of asking is still a request for a change: 'Can you please move it' answered 'Done! I've moved it' is not believed", async () => {
    const id = await setUpPlumber("u-g-polite");
    ai.completeTurn.mockResolvedValueOnce(says("Done! I've moved it."));
    await ask("Can you please move the plumber task to Friday?");
    expect(await screen.findByText("Nothing was changed · Ask again and I'll put it on a card for you to confirm")).toBeInTheDocument();
    expect((await stored()).some((m) => /moved it/.test(m.text))).toBe(false);
    expect((await tasksRef!.task(id))!.due).toBe("2026-10-29");
  });

  it("a claim that comes with a cheerful 'no problem' is still a claim", async () => {
    const id = await setUpPlumber("u-g-noprob");
    scriptMove(id, "I've moved the plumber task to Friday, no problem.");
    await ask(MOVE);
    await screen.findByText("Waiting for your OK on the card below · Nothing has changed yet");
    expect((await stored()).some((m) => /no problem/.test(m.text))).toBe(false);
  });

  it("only the claiming sentences go: the rest of the answer is kept as the model wrote it, and the app's own line follows", async () => {
    const id = await setUpPlumber("u-g-surgery");
    scriptMove(id, "You have the dentist at 3. I've moved the plumber task to Friday. Anything else?");
    await ask(MOVE);
    await waitFor(async () => expect((await stored()).some((m) => m.role === "jarvis")).toBe(true));
    const bubble = (await stored()).find((m) => m.role === "jarvis")!;
    expect(bubble.text).toBe("You have the dentist at 3. Anything else?\nWaiting for your OK on the card below · Nothing has changed yet");
    // What the model kept is still its answer, so it still says so; the card stays up.
    expect(bubble.kind).toBe("ai");
    expect(await screen.findByRole("button", { name: "Move Task" })).toBeInTheDocument();
  });

  it("a turn that only reads what JARVIS did earlier is a report, and a true one", async () => {
    renderChat("u-g-report");
    ai.completeTurn.mockResolvedValueOnce(asks("get_activity", {})).mockResolvedValueOnce(says("I added Call the plumber at 9:12. I moved Pay rent to Friday."));
    await ask("What did you do for me today?");
    expect(await screen.findByText("I added Call the plumber at 9:12. I moved Pay rent to Friday.")).toBeInTheDocument();
  });
});

describe("the thread tells the truth about the cards when the turn ends", () => {
  it("a card tapped while the model is still writing is not described as waiting, and a pointer to it is dropped with nothing false in its place", async () => {
    const id = await setUpPlumber("u-g-race");
    let release!: (t: AITurn) => void;
    ai.completeTurn
      .mockResolvedValueOnce(asks("search_items", { query: "plumber" }, "toolu_01SEARCH1"))
      .mockResolvedValueOnce(asks("update_task", { ref: `task:${id}`, due: "2026-10-30" }, "toolu_01UPDATE1"))
      .mockImplementationOnce(() => new Promise<AITurn>((r) => { release = r; }));
    await ask(MOVE);
    fireEvent.click(await screen.findByRole("button", { name: "Move Task" }));
    await screen.findByText("Moved to Fri, Oct 30: Call the plumber");
    expect((await tasksRef!.task(id))!.due).toBe("2026-10-30");

    release(says("I put the move on a card. Tap Move Task to confirm."));
    await waitFor(() => expect(ai.completeTurn).toHaveBeenCalledTimes(3));
    // The turn ends with a handful of promise ticks; give it them, then look at what was stored.
    await new Promise((r) => setTimeout(r, 80));
    expect((await stored()).map((m) => m.text)).toEqual([MOVE, "Moved to Fri, Oct 30: Call the plumber"]);
    expect(screen.queryByText(/Waiting for your OK/)).toBeNull();
  });

  it("two requests for one task in one reply leave one card, and the model is told which card replaced which", async () => {
    const id = await setUpPlumber("u-g-twice");
    ai.completeTurn
      .mockResolvedValueOnce(asks("search_items", { query: "plumber" }, "toolu_01SEARCH1"))
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          { id: "toolu_01UPDATE1", name: "update_task" as never, input: { ref: `task:${id}`, due: "2026-10-30" } },
          { id: "toolu_01UPDATE2", name: "update_task" as never, input: { ref: `task:${id}`, mark_done: true } },
        ],
        stop: "tool_use",
      })
      .mockResolvedValueOnce(says("Only the last change is on a card now."));
    await ask(MOVE);
    await screen.findByText("Only the last change is on a card now.");
    const groups = await screen.findAllByRole("group", { name: "Proposed Change" });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.textContent).toContain("Mark it done");
    expect(groups[0]!.textContent).not.toContain("Fri, Oct 30");

    const third = ai.completeTurn.mock.calls[2]![0] as { content: { content?: string }[] }[];
    const results = third[4]!.content.map((b) => JSON.parse(b.content!));
    expect(results[0]).not.toHaveProperty("replaced_earlier_card");
    expect(results[1].replaced_earlier_card).toEqual([["Change this task?", "Call the plumber", "Due Fri, Oct 30 (was Thu, Oct 29)"]]);
  });
});

describe("a card survives the session's token being refreshed", () => {
  it("the provider rebuilds every service on a new token; the card is the person's, and stays", async () => {
    const tree = (token: string, withChat = true) => (
      <NotesProvider userId="u-g-token" accessToken={token}><Capture />{withChat && <ChatFlow />}</NotesProvider>
    );
    const view = render(tree("tok-1"));
    await waitFor(() => expect(tasksRef).not.toBeNull());
    const id = (await tasksRef!.createTask("Call the plumber", { due: "2026-10-29" }))!;
    scriptMove(id);
    await ask(MOVE);
    await screen.findByRole("button", { name: "Move Task" });

    view.rerender(tree("tok-2"));
    expect(await screen.findByRole("button", { name: "Move Task" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Proposed Change" }).textContent).toContain("Due Fri, Oct 30 (was Thu, Oct 29)");
  });
});

describe("a task made from a card says where it came from", () => {
  it("is stamped as made in Chat, and carries nothing the card did not show", async () => {
    renderChat("u-g-source");
    await waitFor(() => expect(tasksRef).not.toBeNull());
    ai.completeTurn
      .mockResolvedValueOnce(asks("create_task", { text: "Call the plumber about the leak" }))
      .mockResolvedValueOnce(says("It is on a card."));
    await ask("Can you add a task to call the plumber about the leak?");
    fireEvent.click(await screen.findByRole("button", { name: "Add Task" }));
    await screen.findByText("Added: Call the plumber about the leak");
    const [made] = await tasksRef!.listTasks();
    expect(made!.data.source).toMatchObject({ type: "chat" });
    expect(Object.keys(made!.data).sort()).toEqual(["category", "done", "source", "text"]);
  });
});

describe("a new thing that happens to open with an edit verb stays a capture", () => {
  it("'Clear the gutters before Friday' is a task to save, not a request to change one", async () => {
    renderChat("u-g-gutters");
    await waitFor(() => expect(tasksRef).not.toBeNull());
    await ask("Clear the gutters before Friday");
    expect(await screen.findByText(/^Saved: /)).toBeInTheDocument();
    expect(ai.completeTurn).not.toHaveBeenCalled();
  });
});

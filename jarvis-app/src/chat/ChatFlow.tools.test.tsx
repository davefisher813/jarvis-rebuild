// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTasks, useChat } from "../data/NotesProvider";
import ChatFlow from "./ChatFlow";
import type { AIService, AITurn } from "../ai/AIService";
import { AIProviderError } from "../ai/providerFailure";
import { MAX_STEPS } from "./tools/dispatcher";

// THE CHAT WITH TOOLS, END TO END (chat box order, 2026-10-24): a real question through the real ChatFlow, the real dispatcher and the
// real records, with only the model scripted. Behind chat_tools_v1: off, the chat is exactly what it was.

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
const ai = vi.hoisted(() => ({ available: true, complete: vi.fn(), completeTurn: vi.fn() }));
vi.mock("../ai/useAI", () => ({ useAI: () => ai as unknown as AIService }));
vi.mock("../shared/toast", () => ({ showToast: () => {} }));
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
function Capture() { tasksRef = useTasks(); chatRef = useChat(); return null; }

function renderChat(userId: string, onOpen?: (k: string, id: string) => void) {
  render(<NotesProvider userId={userId}><Capture /><ChatFlow {...(onOpen ? { onOpen } : {})} /></NotesProvider>);
}
async function ask(text: string) {
  fireEvent.change(await screen.findByPlaceholderText("Ask, Tell or Paste"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

beforeEach(() => { ai.complete.mockReset(); ai.completeTurn.mockReset(); flags.tools = true; tasksRef = null; chatRef = null; });

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
    expect(firstOpts.tools).toEqual(["search_items", "read_document", "get_schedule", "search_email", "recall_facts", "get_activity"]);
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

  it("nothing a tool does is ever written to the person's records", async () => {
    ai.completeTurn.mockResolvedValueOnce(asks("search_items", { query: "plumber" })).mockResolvedValueOnce(says("Done."));
    renderChat("u-tools-readonly");
    await waitFor(() => expect(tasksRef).not.toBeNull());
    await tasksRef!.createTask("Call the plumber");
    const before = JSON.stringify(await tasksRef!.listTasks());
    await ask(Q);
    await screen.findByText("Done.");
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

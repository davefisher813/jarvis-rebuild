// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTasks, useNotes } from "../data/NotesProvider";
import ChatFlow from "./ChatFlow";
import { readChatter } from "./chatter";
import type { AIService } from "../ai/AIService";

// J-01 (Dave, 2026-10-27): "plain chat messages silently becoming tasks". Conversation is answered, not filed; and when the brain
// cannot run the thread SAYS so and offers the manual path instead of guessing a task.

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
const ai = vi.hoisted(() => ({ available: true, complete: vi.fn(), completeTurn: vi.fn() }));
vi.mock("../ai/useAI", () => ({ useAI: () => ai as unknown as AIService }));
vi.mock("../shared/toast", () => ({ showToast: () => {} }));

let tasksRef: ReturnType<typeof useTasks> | null = null;
let notesRef: ReturnType<typeof useNotes> | null = null;
function Capture() { tasksRef = useTasks(); notesRef = useNotes(); return null; }
function renderChat(userId: string) { render(<NotesProvider userId={userId}><Capture /><ChatFlow /></NotesProvider>); }
async function say(text: string) {
  fireEvent.change(await screen.findByPlaceholderText("Ask, Tell or Paste"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}
const taskCount = async () => (await tasksRef!.listTasks()).length;

beforeEach(() => { ai.available = true; ai.complete.mockReset(); ai.completeTurn.mockReset(); tasksRef = null; notesRef = null; });

describe("what counts as talk", () => {
  it.each([
    ["hello", "greeting"], ["Hey!", "greeting"], ["good morning jarvis", "greeting"],
    ["thanks", "thanks"], ["Thank you so much.", "thanks"],
    ["ok", "ack"], ["never mind", "ack"], ["lol", "ack"], ["that makes sense", "ack"], ["yes", "ack"],
    ["I'm tired today", "mood"], ["I feel overwhelmed", "mood"],
    ["tell me a joke", "request"], ["summarize my day", "request"], ["can you help me plan my week", "request"],
  ])("%s is conversation (%s)", (line, kind) => {
    expect(readChatter(line as string)?.kind).toBe(kind);
  });

  it.each([
    "buy milk", "Call Marco tomorrow at 3", "dentist friday", "renew passport", "Need to follow up with Mike about summer roster",
    "ok call Marco", "thanks for the invite, reply to Sarah", "I'm out of milk", "no more meetings after 4", "email 5 people",
  ])("%s may be a thing to do, so it is not claimed", (line) => {
    expect(readChatter(line)).toBeNull();
  });
});

describe("in the chat box", () => {
  it("'thanks' is answered, and no task is made", async () => {
    renderChat("u-j01-thanks");
    await waitFor(() => expect(tasksRef).not.toBeNull());
    const before = await taskCount();
    await say("thanks");
    expect(await screen.findByText("Anytime")).toBeInTheDocument();
    expect(await taskCount()).toBe(before);
    expect(ai.complete).not.toHaveBeenCalled();
  });

  it("'never mind' files no rule and no task", async () => {
    renderChat("u-j01-nm");
    await waitFor(() => expect(tasksRef).not.toBeNull());
    const before = await taskCount();
    await say("never mind");
    expect(await screen.findByText("Got it · Nothing was saved")).toBeInTheDocument();
    expect(await taskCount()).toBe(before);
  });

  it("a feeling goes to the AI as a conversation turn, not to the capture lane", async () => {
    ai.complete.mockResolvedValue("That sounds like a lot. Want me to lighten today?");
    renderChat("u-j01-mood");
    await waitFor(() => expect(tasksRef).not.toBeNull());
    const before = await taskCount();
    await say("I'm tired today");
    expect(await screen.findByText(/That sounds like a lot/)).toBeInTheDocument();
    expect(ai.complete).toHaveBeenCalled();
    expect(await taskCount()).toBe(before);
  });

  it("a feeling with no AI says it cannot answer, and saves nothing", async () => {
    ai.available = false;
    renderChat("u-j01-mood-off");
    await waitFor(() => expect(tasksRef).not.toBeNull());
    const before = await taskCount();
    await say("I'm tired today");
    expect(await screen.findByText("I can answer that when you're back online")).toBeInTheDocument();
    expect(await taskCount()).toBe(before);
  });

  it("with the brain unable to run, an unreadable line is handed back, not saved as a task", async () => {
    ai.available = false;
    renderChat("u-j01-off");
    await waitFor(() => expect(tasksRef).not.toBeNull());
    const before = await taskCount();
    await say("summer roster stuff");
    expect(await screen.findByText("I couldn't read that without the AI · Nothing was saved")).toBeInTheDocument();
    expect(await taskCount()).toBe(before);
    expect(screen.queryByText(/^Saved: /)).toBeNull();
    expect(screen.getByRole("button", { name: "Try Again" })).toBeInTheDocument();
  });

  it("an AI call that fails mid-capture is the same: said, and nothing saved", async () => {
    ai.complete.mockRejectedValue(new TypeError("Failed to fetch"));
    renderChat("u-j01-fail");
    await waitFor(() => expect(tasksRef).not.toBeNull());
    const before = await taskCount();
    await say("summer roster stuff");
    expect(await screen.findByText("I couldn't read that without the AI · Nothing was saved")).toBeInTheDocument();
    expect(await taskCount()).toBe(before);
  });

  it("the manual path files it as a task when the person taps Save as Task, with the receipt", async () => {
    ai.available = false;
    renderChat("u-j01-manual-task");
    await waitFor(() => expect(tasksRef).not.toBeNull());
    const before = await taskCount();
    await say("summer roster stuff");
    fireEvent.click(await screen.findByRole("button", { name: "Save as Task" }));
    expect(await screen.findByText("Saved: Summer Roster Stuff")).toBeInTheDocument();
    expect(await taskCount()).toBe(before + 1);
    expect(screen.queryByRole("button", { name: "Save as Task" })).toBeNull();
  });

  it("Save as Note files a note, not a task", async () => {
    ai.available = false;
    renderChat("u-j01-manual-note");
    await waitFor(() => expect(notesRef).not.toBeNull());
    const before = await taskCount();
    await say("summer roster stuff");
    fireEvent.click(await screen.findByRole("button", { name: "Save as Note" }));
    expect(await screen.findByText("Saved: Summer Roster Stuff")).toBeInTheDocument();
    expect(await taskCount()).toBe(before);
    expect((await notesRef!.listNotes()).some((n) => /summer roster stuff/i.test(JSON.stringify(n.data)))).toBe(true);
  });

  it("a line the rules DO read is still captured with no AI: that is what the box is for", async () => {
    ai.available = false;
    renderChat("u-j01-confident");
    await waitFor(() => expect(tasksRef).not.toBeNull());
    const before = await taskCount();
    await say("Call Marco about the roster");
    expect(await screen.findByText(/^Saved: /)).toBeInTheDocument();
    expect(await taskCount()).toBe(before + 1);
  });
});

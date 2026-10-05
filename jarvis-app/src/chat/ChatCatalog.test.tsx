// @vitest-environment jsdom
// CHAT, THE CATALOG ON WHAT IS DRAWN (Alfred 2026-10-04, the perfect bar 2026-10-05).
//
//   - the placeholder reads "Ask · Tell · Paste" (Title Case after every dot);
//   - "9 Tasks Due", not "9 Tasks due", in the day's count;
//   - one grey per bubble: a records answer draws no "From your records" second line (it said nothing the answer did
//     not), an AI answer keeps its one provenance line, an action receipt keeps its green "Done".
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useChat, useTasks } from "../data/NotesProvider";
import ChatFlow from "./ChatFlow";
import type { AIService } from "../ai/AIService";
import type { ChatService } from "./ChatService";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
vi.mock("../ai/useAI", () => ({ useAI: () => ({ available: false } as unknown as AIService) }));
vi.mock("../shared/toast", () => ({ showToast: vi.fn() }));

let chatRef: ChatService | null = null;
let tasksRef: ReturnType<typeof useTasks> | null = null;
function Grab() {
  chatRef = useChat();
  tasksRef = useTasks();
  return null;
}
afterEach(() => { chatRef = null; tasksRef = null; });

async function openChat(seed: { role: "user" | "jarvis"; text: string; provenance?: { kind: "records" | "ai" | "action" } }[]) {
  const user = "u-chat-catalog-" + Math.random().toString(36).slice(2);
  const view = render(<NotesProvider userId={user}><Grab /></NotesProvider>);
  await waitFor(() => expect(chatRef && tasksRef).toBeTruthy());
  for (const s of seed) await chatRef!.append(s);
  view.rerender(<NotesProvider userId={user}><Grab /><ChatFlow /></NotesProvider>);
  await waitFor(() => expect(document.querySelectorAll(".chat-text")).toHaveLength(seed.length));
}

describe("Chat catalog", () => {
  it("the placeholder is Title Case after the dots", async () => {
    await openChat([]);
    expect(screen.getByPlaceholderText("Ask · Tell · Paste")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Ask · tell · paste")).toBeNull();
  });

  it("a records answer draws no provenance line: one grey, and the answer is the content", async () => {
    await openChat([{ role: "jarvis", text: "Nothing on today", provenance: { kind: "records" } }]);
    expect(document.querySelector(".chat-prov")).toBeNull();
    expect(screen.queryByText(/from your records/i)).toBeNull();
  });

  it("an AI answer keeps its one line, in Title Case", async () => {
    await openChat([{ role: "jarvis", text: "Two things today", provenance: { kind: "ai" } }]);
    expect(document.querySelectorAll(".chat-prov")).toHaveLength(1);
    expect(screen.getByText("From Your Data + AI")).toBeInTheDocument();
  });

  it("an action receipt keeps its green Done, unless its own words already open with it", async () => {
    await openChat([
      { role: "jarvis", text: "Saved Marco to the Gym", provenance: { kind: "action" } },
      { role: "jarvis", text: "Done: Call the plumber", provenance: { kind: "action" } },
    ]);
    const bubbles = Array.from(document.querySelectorAll(".chat-bubble"));
    expect(bubbles[0]!.querySelector(".chat-prov .fact.good")?.textContent).toBe("Done");
    // One "Done", not two: the text says it, so the line under it does not repeat it.
    expect(bubbles[1]!.querySelector(".chat-prov")).toBeNull();
  });

  it("the day's count reads 9 Tasks Due, not 9 Tasks due", async () => {
    await openChat([]);
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    for (let i = 0; i < 9; i++) await tasksRef!.createTask("Task " + i, { due: iso });
    fireEvent.change(screen.getByPlaceholderText("Ask · Tell · Paste"), { target: { value: "what's on today?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("0 Events · 9 Tasks Due")).toBeInTheDocument());
  });
});

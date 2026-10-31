// @vitest-environment jsdom
// A QUESTION FROM THE SPEECH BOX IS ASKED IN CHAT (2026-10-31). "What is on my schedule tomorrow?" was saved as a Note in the
// 2026-10-28 test. The box hands it to Chat, which asks it as his turn and answers it; nothing is filed.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useChat, useNotes, useTasks } from "../data/NotesProvider";
import ChatFlow from "./ChatFlow";
import type { AIService } from "../ai/AIService";
import type { ChatService } from "./ChatService";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
vi.mock("../ai/useAI", () => ({ useAI: () => ({ available: false } as unknown as AIService) }));
vi.mock("../shared/toast", () => ({ showToast: () => {} }));

const refs: { chat: ChatService | null; notes: ReturnType<typeof useNotes> | null; tasks: ReturnType<typeof useTasks> | null } = { chat: null, notes: null, tasks: null };
function Grab() { refs.chat = useChat(); refs.notes = useNotes(); refs.tasks = useTasks(); return null; }

beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("ChatFlow: a question from the speech box", () => {
  it("is asked as his turn, once, and nothing is saved as a note or a task", async () => {
    const consumed = vi.fn();
    render(<NotesProvider userId="u-ask-text"><Grab /><ChatFlow askText="What is on my schedule tomorrow?" askTextNonce={1} onAskTextConsumed={consumed} /></NotesProvider>);
    await waitFor(async () => {
      const msgs = await refs.chat!.list();
      expect(msgs.some((m) => m.data.role === "user" && m.data.text === "What is on my schedule tomorrow?")).toBe(true);
    });
    expect(consumed).toHaveBeenCalledTimes(1);
    const mine = (await refs.chat!.list()).filter((m) => m.data.role === "user");
    expect(mine).toHaveLength(1);
    expect(await refs.notes!.listNotes()).toHaveLength(0);
    expect(await refs.tasks!.listTasks()).toHaveLength(0);
  });
});

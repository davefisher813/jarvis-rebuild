// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { AIService } from "../ai/AIService";
import type { ThreadRow } from "../connections/google/map";
import DeckFlow from "./DeckFlow";

// Regression for the audit-2026-08-07 HIGH: card A's in-flight prepare
// resolving AFTER the deck advanced to card B used to land A's thread and
// plan on B's card. The visible failure chain: B's header over A's prepared
// reply, the primary button re-sending A's reply, and B archived without
// ever being decided, the silent skip the snapshot comment in MessagesFlow
// names as this feature's worst failure.

const row = (id: string, from: string, subject: string): ThreadRow => ({
  id, from, fromEmail: from.toLowerCase() + "@x.com", subject, snippet: "",
  dateMs: 100, unread: false, count: 1, inInbox: true, lastMsgId: "m-" + id,
});

const gThread = (id: string, from: string, subject: string, body: string) => ({
  id,
  messages: [{
    id: "m-" + id, threadId: id, snippet: "",
    payload: {
      mimeType: "text/plain", body: { data: btoa(body) },
      headers: [
        { name: "From", value: from + " <" + from.toLowerCase() + "@x.com>" },
        { name: "Subject", value: subject },
        { name: "Date", value: "Mon" },
        { name: "Message-ID", value: "<" + id + "@x>" },
      ],
    },
  }],
});

// The AI answers with a reply plan whose text names which thread's body it
// actually read, so a cross-card leak is directly visible in the DOM.
const aiByBody = () => new AIService({
  available: true,
  getToken: () => "tok",
  fetchImpl: (async (_url: unknown, init?: { body?: string }) => {
    const req = init?.body ?? "";
    const tag = req.includes("ALPHA-BODY") ? "REPLY-FOR-A" : req.includes("BRAVO-BODY") ? "REPLY-FOR-B" : "REPLY-UNKNOWN";
    return {
      ok: true, status: 200, text: async () => "",
      json: async () => ({ text: JSON.stringify({ kind: "reply", why: "needs an answer", reply: tag }) }),
    };
  }) as unknown as typeof fetch,
});

describe("DeckFlow prepare race", () => {
  it("drops card A's late prepare instead of landing it on card B", async () => {
    // A's thread fetch is a promise we hold open; B's resolves immediately.
    let releaseA: (v: ReturnType<typeof gThread>) => void = () => {};
    const aGate = new Promise<ReturnType<typeof gThread>>((res) => { releaseA = res; });
    const api = makeFakeGoogleApi({
      getThread: async (id: string) =>
        id === "tA" ? aGate : gThread("tB", "Bravo", "Second", "BRAVO-BODY"),
      searchThreads: async () => [], // no per-recipient voice examples needed
    });

    render(
      <NotesProvider userId="u1">
        <DeckFlow
          ai={aiByBody()}
          apiFor={() => api}
          threads={[row("tA", "Alpha", "First"), row("tB", "Bravo", "Second")]}
          onDone={vi.fn()} onExit={vi.fn()} onOpenThread={vi.fn()}
          onEditReply={vi.fn()} onHandled={vi.fn()}
        />
      </NotesProvider>,
    );

    // Card A is stuck preparing; Later is deliberately still enabled.
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Preparing...")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Later"));

    // The deck advances to B and B's plan arrives.
    expect(await screen.findByText("Bravo")).toBeInTheDocument();
    expect(await screen.findByText("REPLY-FOR-B")).toBeInTheDocument();

    // NOW card A's fetch finally resolves. Pre-fix, its continuation ran to
    // completion and overwrote B's card with A's thread and plan.
    await act(async () => { releaseA(gThread("tA", "Alpha", "First", "ALPHA-BODY")); });

    await waitFor(() => {
      expect(screen.getByText("Bravo")).toBeInTheDocument();
      expect(screen.getByText("REPLY-FOR-B")).toBeInTheDocument();
      expect(screen.queryByText("REPLY-FOR-A")).not.toBeInTheDocument();
      expect(screen.queryByText("Preparing...")).not.toBeInTheDocument();
    });
  });

  it("Later that fails to save its task stays on the card instead of silently losing it", async () => {
    const api = makeFakeGoogleApi({
      getThread: async () => gThread("tA", "Alpha", "First", "ALPHA-BODY"),
      searchThreads: async () => [],
    });
    // Break task creation: the deferred-task write rejects.
    const onHandled = vi.fn();
    render(
      <NotesProvider userId="u-later-fail">
        <BreakTasks />
        <DeckFlow
          ai={new AIService({ available: false })}
          apiFor={() => api}
          threads={[row("tA", "Alpha", "First")]}
          onDone={vi.fn()} onExit={vi.fn()} onOpenThread={vi.fn()}
          onEditReply={vi.fn()} onHandled={onHandled}
        />
      </NotesProvider>,
    );
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Preparing...")).not.toBeInTheDocument());
    fireEvent.click(screen.getByText("Later"));
    // Still on the card, not advanced past it: deferring never means losing.
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());
    expect(onHandled).not.toHaveBeenCalled();
  });
});

// Sabotages TasksService.createTask inside the provider tree so later() fails.
import { useTasks } from "../data/NotesProvider";
function BreakTasks() {
  const tasks = useTasks();
  tasks.createTask = async () => { throw new Error("storage down"); };
  return null;
}

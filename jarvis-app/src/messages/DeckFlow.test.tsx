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
          queueSend={vi.fn()}
          onDone={vi.fn()} onOpenThread={vi.fn()}
          onEditReply={vi.fn()} onHandled={vi.fn()}
        />
      </NotesProvider>,
    );

    // Card A is stuck preparing; Later is deliberately still enabled.
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Reading it...")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Later"));

    // The deck advances to B and B's plan arrives.
    expect(await screen.findByText("Bravo")).toBeInTheDocument();
    expect(await screen.findByText(/REPLY-FOR-B/)).toBeInTheDocument();

    // NOW card A's fetch finally resolves. Pre-fix, its continuation ran to
    // completion and overwrote B's card with A's thread and plan.
    await act(async () => { releaseA(gThread("tA", "Alpha", "First", "ALPHA-BODY")); });

    await waitFor(() => {
      expect(screen.getByText("Bravo")).toBeInTheDocument();
      expect(screen.getByText(/REPLY-FOR-B/)).toBeInTheDocument();
      expect(screen.queryByText(/REPLY-FOR-A/)).not.toBeInTheDocument();
      expect(screen.queryByText("Reading it...")).not.toBeInTheDocument();
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
          queueSend={vi.fn()}
          onDone={vi.fn()} onOpenThread={vi.fn()}
          onEditReply={vi.fn()} onHandled={onHandled}
        />
      </NotesProvider>,
    );
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Reading it...")).not.toBeInTheDocument());
    fireEvent.click(screen.getByText("Later"));
    // Still on the card, not advanced past it: deferring never means losing.
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());
    expect(onHandled).not.toHaveBeenCalled();
  });
});

// E7 (2026-08-23): the deck's finish line.
describe("DeckFlow progress bar", () => {
  const plainApi = () => makeFakeGoogleApi({
    getThread: async (id: string) => gThread(id, "Alpha", "First", "BODY"),
    searchThreads: async () => [],
  });

  const mount = (threads: ThreadRow[], limitMs?: number) => render(
    <NotesProvider userId="u1">
      <DeckFlow
        ai={new AIService({ available: false })}
        apiFor={() => plainApi()}
        threads={threads}
        limitMs={limitMs}
        queueSend={vi.fn()}
        onDone={vi.fn()} onOpenThread={vi.fn()}
        onEditReply={vi.fn()} onHandled={vi.fn()}
      />
    </NotesProvider>,
  );

  it("draws a bar that starts empty and advances with the deck", async () => {
    const { container } = mount([row("tA", "Alpha", "First"), row("tB", "Bravo", "Second"),
      row("tC", "Cara", "Third"), row("tD", "Dan", "Fourth")]);
    expect(await screen.findByText("Alpha")).toBeInTheDocument();

    const fill = () => container.querySelector(".deck-bar-fill") as HTMLElement | null;
    expect(fill()).toBeTruthy();
    expect(fill()!.style.width).toBe("0%");

    await waitFor(() => expect(screen.queryByText("Reading it...")).not.toBeInTheDocument());
    fireEvent.click(screen.getByText("Later"));
    await screen.findByText("Bravo");
    // One of four done. The bar is the only thing on screen that says a deck
    // of four ends, without doing arithmetic between two numbers.
    expect(fill()!.style.width).toBe("25%");
  });

  it("counts DOWN in the ring, never up and never a total (2A)", async () => {
    const { container } = mount([row("tA", "Alpha", "First"), row("tB", "Bravo", "Second")]);
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    const ring = () => container.querySelector(".sweep-ring-n");
    expect(ring()!.textContent).toBe("2");
    await waitFor(() => expect(screen.queryByText("Reading it...")).not.toBeInTheDocument());
    fireEvent.click(screen.getByText("Later"));
    await screen.findByText("Bravo");
    // The number fell. "1 of 2" is dead: an up-counter is a guilt meter.
    expect(ring()!.textContent).toBe("1");
    expect(screen.queryByText(/1 of 2/)).toBeNull();
  });

  it("always runs a session clock (5A): untimed sweeps do not exist", async () => {
    const { container } = mount([row("tA", "Alpha", "First")]);
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    // The default five-minute session, already ticking in the title.
    expect(container.querySelector(".sweep-clock")!.textContent).toMatch(/^[45]:\d\d$/);
  });

  it("wears the card's cost once the plan is known (5A)", async () => {
    const { container } = mount([row("tA", "Alpha", "First")]);
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Reading it...")).not.toBeInTheDocument());
    // ai unavailable = no plan = open and reply, honestly the slowest.
    expect(container.querySelector(".sweep-cost")!.textContent).toBe("~1 min");
  });

  it("deals a hand of at most nine, whatever the pile holds (3A)", async () => {
    const pile = Array.from({ length: 40 }, (_, i) => row("t" + i, "Sender" + i, "S" + i));
    const { container } = mount(pile);
    expect(await screen.findByText("Sender0")).toBeInTheDocument();
    expect(container.querySelector(".sweep-ring-n")!.textContent).toBe("9");
    // And the floor says so (L2 in embryo): the deck keeps the rest.
    expect(container.querySelector(".sweep-floor")!.textContent).toContain("deck keeps the rest");
  });
});

// Sabotages TasksService.createTask inside the provider tree so later() fails.
import { useTasks } from "../data/NotesProvider";
function BreakTasks() {
  const tasks = useTasks();
  tasks.createTask = async () => { throw new Error("storage down"); };
  return null;
}

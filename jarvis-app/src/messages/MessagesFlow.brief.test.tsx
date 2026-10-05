// @vitest-environment jsdom
import "../shared/tiptapTest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useEffect } from "react";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useSchedule } from "../data/NotesProvider";
import type { ScheduleService } from "../schedule/ScheduleService";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { AIService } from "../ai/AIService";
import type { GmailMeta, GmailThreadMeta } from "../connections/google/map";
import MessagesFlow from "./MessagesFlow";
import ToastHost from "../shared/ToastHost";
import { resetOutboxForTest } from "./outbox";
import { resetInboxRefreshState } from "./inboxRefresh";
import { resetEmailScheduleState } from "./emailSchedule";

// THE BRIEF, THROUGH THE REAL SCREEN (2026-09-29).
//
// What the unit tests prove about threadBrief, the finish card and Reply
// Coverage, this proves about the wiring: opening a thread and tapping Reply
// read the thread ONCE; the appointment is above the messages and needs no
// tap to reach; a v3 summary paints before the upgrade lands; a late answer
// for the last thread never draws over this one; and typing a hundred
// characters into a reply makes no model call and no request of any kind.

const NOW = new Date("2026-09-21T19:00:00Z"); // Monday afternoon, the day the message below was written

const msg = (id: string, from: string, subject: string, snippet: string, labels: string[], dateMs: number): GmailMeta => ({
  id, snippet, labelIds: labels, internalDate: String(dateMs),
  payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: subject }] },
});

const SENT = Date.UTC(2026, 8, 21, 18, 0); // 2026-09-21 14:00 in New York
const THREADS: GmailThreadMeta[] = [
  { id: "t1", messages: [msg("m1", "Ridgeley <t@x.com>", "Practice", "Quick question", ["INBOX"], SENT - 3600_000), msg("m2", "Ridgeley <t@x.com>", "Re: Practice", "See you Tuesday", ["INBOX", "UNREAD"], SENT)] },
  { id: "t2", messages: [msg("m9", "Dana <d@x.com>", "Roster", "Send the roster", ["INBOX", "UNREAD"], SENT - 60_000)] },
];

const part = (id: string, threadId: string, from: string, subject: string, body: string, ms: number, mid: string) => ({
  id, threadId, snippet: "", internalDate: String(ms),
  payload: { mimeType: "text/plain", body: { data: btoa(body) }, headers: [
    { name: "From", value: from }, { name: "Subject", value: subject }, { name: "Date", value: new Date(ms).toUTCString() }, { name: "Message-ID", value: mid },
  ] },
});
const FULL: Record<string, unknown> = {
  t1: { id: "t1", messages: [
    part("m1", "t1", "Ridgeley <t@x.com>", "Practice", "Hi Dave, quick question about practice.", SENT - 3600_000, "<a@x>"),
    part("m2", "t1", "Ridgeley <t@x.com>", "Re: Practice", "See you Tuesday at 3 PM. Please send the waiver.", SENT, "<b@x>"),
  ] },
  t2: { id: "t2", messages: [part("m9", "t2", "Dana <d@x.com>", "Roster", "Send the roster when you can.", SENT - 60_000, "<c@x>")] },
};

const BRIEF_T1 = JSON.stringify({
  summary: "Coach wants a waiver", replies: ["Waiver attached", "Works", "Cannot"],
  meetingCandidates: [{ messageId: "m2", quote: "See you Tuesday at 3 PM", title: "Practice", status: "agreed" }],
  replyRequirements: [{ messageId: "m2", quote: "Please send the waiver", kind: "request", label: "waiver", match: { kind: "attachment", topicTerms: ["waiver"] } }],
});
const BRIEF_T2 = JSON.stringify({ summary: "Wants the roster", replies: ["Sending it"], meetingCandidates: [], replyRequirements: [] });

interface Harness { ai: AIService; briefPrompts: string[]; fetchCount: () => number; release: () => void }
// A model that answers the v4 brief from the thread its prompt is about, counts every request,
// and can be held until the test lets it go.
function makeAI(hold: boolean | ((prompt: string) => boolean) = false): Harness {
  const briefPrompts: string[] = [];
  let all = 0;
  let open!: () => void;
  const gate = new Promise<void>((r) => { open = r; });
  const ai = new AIService({
    available: true,
    getToken: () => "tok",
    fetchImpl: (async (_url: unknown, init: { body?: string }) => {
      all++;
      const prompt = String(JSON.parse(init.body ?? "{}").messages?.[0]?.content ?? "");
      // The inbox sort: both threads need him, so both rows are on screen.
      let text = JSON.stringify([{ id: "t1", bucket: "needs_you", gist: "Practice time" }, { id: "t2", bucket: "needs_you", gist: "The roster" }]);
      if (prompt.includes("meetingCandidates")) {
        briefPrompts.push(prompt);
        if (typeof hold === "function" ? hold(prompt) : hold) await gate;
        text = prompt.includes("Send the roster when you can") ? BRIEF_T2 : BRIEF_T1;
      }
      return { ok: true, status: 200, json: async () => ({ text }), text: async () => "" };
    }) as unknown as typeof fetch,
  });
  return { ai, briefPrompts, fetchCount: () => all, release: () => open() };
}

const gmail: { threadReads: number } = { threadReads: 0 };
function makeApi() {
  return makeFakeGoogleApi({
    listThreads: async () => THREADS,
    getThread: async (id: string) => { gmail.threadReads++; return FULL[id] as never; },
  });
}

let schedule: ScheduleService | null = null;
function Grab() {
  const s = useSchedule();
  useEffect(() => { schedule = s; }, [s]);
  return null;
}
function wrap(node: React.ReactNode, api = makeApi()) {
  return (
    <NotesProvider userId="u1">
      <Grab />
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => api}>
        <ToastHost />
        {node}
      </GoogleSessionProvider>
    </NotesProvider>
  );
}

beforeEach(() => {
  localStorage.clear(); resetOutboxForTest(); resetInboxRefreshState(); resetEmailScheduleState();
  gmail.threadReads = 0; schedule = null;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function openT1(h: Harness, api = makeApi()) {
  render(wrap(<MessagesFlow ai={h.ai} configured />, api));
  fireEvent.click(await screen.findByText("Connect Google"));
  fireEvent.click(await screen.findByText("Ridgeley"));
}

describe("the thread is read once, and the appointment is on top", () => {
  it("opening the thread shows the appointment above the messages with no tap to reach it", async () => {
    const h = makeAI();
    await openT1(h);
    const add = await screen.findByRole("button", { name: "Add to Calendar" });
    expect(add).toBeInTheDocument();
    expect(screen.getByText("3:00 PM")).toBeInTheDocument();
    // Above the first message.
    const firstMessage = screen.getByText("Hi Dave, quick question about practice.");
    expect(add.compareDocumentPosition(firstMessage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The state card is collapsed and has no calendar action of its own.
    expect(screen.getAllByText("Add to Calendar")).toHaveLength(1);
    expect(h.briefPrompts).toHaveLength(1);
    // Nothing was written by looking.
    expect(await schedule!.listEvents()).toHaveLength(0);
  });

  it("Add writes one event from the message's own day, and a second tap writes none", async () => {
    const h = makeAI();
    await openT1(h);
    const add = await screen.findByRole("button", { name: "Add to Calendar" });
    fireEvent.click(add);
    fireEvent.click(add);
    await screen.findByText("On Your Calendar");
    const evs = await schedule!.listEvents();
    expect(evs).toHaveLength(1);
    // Tuesday counted from the Monday it was written, at 3 PM in the reader's clock.
    expect(evs[0]!.data).toMatchObject({ title: "Practice", date: "2026-09-22", start: "15:00", source: { type: "email", ref: "t1" } });
  });

  it("tapping Reply after opening costs NO second call: same thread, same revision, one reading", async () => {
    const h = makeAI();
    await openT1(h);
    await screen.findByRole("button", { name: "Add to Calendar" });
    expect(h.briefPrompts).toHaveLength(1);
    fireEvent.click(await screen.findByText("Reply"));
    await screen.findByText("Answered 0 of 1");
    expect(h.briefPrompts).toHaveLength(1);
  });

  it("tapping Reply while the opening read is still in flight joins it: one call, not two", async () => {
    const h = makeAI(true);
    await openT1(h);
    // The model has not answered. Reply is tapped anyway.
    fireEvent.click(await screen.findByText("Reply"));
    await waitFor(() => expect(h.briefPrompts).toHaveLength(1));
    await act(async () => { h.release(); });
    await screen.findByText("Answered 0 of 1");
    expect(h.briefPrompts).toHaveLength(1);
  });

  it("a v3 summary paints at once, and is replaced by the v4 reading when it lands", async () => {
    localStorage.setItem("jarvis.mail.brief.v3", JSON.stringify({ m2: { summary: "Old summary from v3", replies: ["Ok"], state: "waiting_on_you" } }));
    const h = makeAI(true);
    await openT1(h);
    expect(await screen.findByText("Old summary from v3")).toBeInTheDocument();
    // The inbox cache was not cleared, and no appointment is offered yet.
    expect(localStorage.getItem("jarvis.mail.brief.v3")).toContain("Old summary from v3");
    expect(screen.queryByRole("button", { name: "Add to Calendar" })).toBeNull();
    await act(async () => { h.release(); });
    expect(await screen.findByText("Coach wants a waiver")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Add to Calendar" })).toBeInTheDocument();
    expect(screen.queryByText("Old summary from v3")).toBeNull();
  });

  it("a late answer for the last thread is ignored: it never draws over the one on screen", async () => {
    // Only Ridgeley's read is held; Dana's answers at once.
    const h = makeAI((prompt) => !prompt.includes("Send the roster when you can"));
    render(wrap(<MessagesFlow ai={h.ai} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByText("Ridgeley"));
    await waitFor(() => expect(h.briefPrompts).toHaveLength(1));
    // Back out and open the other thread while the first answer is still out.
    fireEvent.click(screen.getByText("Email"));
    fireEvent.click(await screen.findByText("Dana"));
    // Dana's own reply chip is on screen (one short message has no summary card).
    expect(await screen.findByText("Sending it")).toBeInTheDocument();
    // NOW the old answer lands.
    await act(async () => { h.release(); await new Promise((r) => setTimeout(r, 50)); });
    // Nothing of Ridgeley's reading draws over Dana's: not its chips, not its appointment.
    expect(screen.getByText("Sending it")).toBeInTheDocument();
    expect(screen.queryByText("Waiver attached")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add to Calendar" })).toBeNull();
    expect(screen.queryByText("Practice")).toBeNull();
  });
});

describe("Reply Coverage in the composer", () => {
  it("counts what the words answer, needs a real attachment for the waiver, and makes no model call and no request per keystroke", async () => {
    const h = makeAI();
    await openT1(h);
    await screen.findByRole("button", { name: "Add to Calendar" });
    fireEvent.click(await screen.findByText("Reply"));
    await screen.findByText("Answered 0 of 1");

    const type = async (text: string) => { await act(async () => { screen.getByLabelText("Message").querySelector("p")!.textContent = text; }); };
    // Saying it is attached is not attaching it.
    await type("Waiver attached");
    await waitFor(() => expect(screen.getByLabelText("Message").textContent).toContain("Waiver attached"));
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(screen.getByText("Answered 0 of 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText("Open, Nothing Is Attached")).toBeInTheDocument();
    // A decline is an answer (and does not complete it).
    await type("Can't send waiver until Friday");
    await waitFor(() => expect(screen.getByText("Answered 1 of 1")).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText("Answered, Deferred")).toBeInTheDocument();
    // Delete the sentence and the check goes back.
    await type("Thanks");
    await waitFor(() => expect(screen.getByText("Answered 0 of 1")).toBeInTheDocument(), { timeout: 2000 });

    // 100 keystrokes: not one model call, not one request of any kind, not one thread read.
    const prompts = h.briefPrompts.length;
    const requests = h.fetchCount();
    const reads = gmail.threadReads;
    for (let i = 1; i <= 100; i++) await type("Tuesday works, four players, yes you can publish ".repeat(3).slice(0, i));
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(h.briefPrompts.length).toBe(prompts);
    expect(h.fetchCount()).toBe(requests);
    expect(gmail.threadReads).toBe(reads);
  });

  it("the person can mark an ask answered by hand, and the mark survives being saved and reopened", async () => {
    const h = makeAI();
    await openT1(h);
    await screen.findByRole("button", { name: "Add to Calendar" });
    fireEvent.click(await screen.findByText("Reply"));
    await screen.findByText("Answered 0 of 1");
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    fireEvent.click(await screen.findByRole("button", { name: "Mark Answered" }));
    expect(await screen.findByText("Answered 1 of 1")).toBeInTheDocument();
    // The draft autosaves locally with the mark and the revision it was made on.
    await act(async () => { screen.getByLabelText("Message").querySelector("p")!.textContent = "Handled it by phone"; });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem("jarvis.mail.composeDraft.v1") ?? "{}").new;
      expect(saved?.sourceRevision).toBe("m2");
      expect(Object.values(saved?.overrides ?? {})).toEqual(["addressed"]);
    }, { timeout: 2000 });
  });

  it("a forward is not a reply: no indicator", async () => {
    const h = makeAI();
    await openT1(h);
    await screen.findByRole("button", { name: "Add to Calendar" });
    fireEvent.click(await screen.findByText("Forward"));
    await screen.findByPlaceholderText("To");
    expect(screen.queryByText(/Answered/)).toBeNull();
  });

  it("a new message is not a reply: no indicator", async () => {
    const h = makeAI();
    render(wrap(<MessagesFlow ai={h.ai} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByLabelText("New Message"));
    await screen.findByPlaceholderText("To");
    expect(screen.queryByText(/Answered/)).toBeNull();
    expect(h.briefPrompts).toHaveLength(0);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { AIService } from "../ai/AIService";
import MessagesFlow from "./MessagesFlow";
import MailOutboxPump from "./MailOutboxPump";
import ToastHost from "../shared/ToastHost";
import { enqueueOutbox, getOutbox, loadOutbox, patchOutbox, resetOutboxForTest, INTERRUPTED_LINE, type OutboxItem } from "./outbox";
import { enqueueTodaySend, getTodayOutbox, markTodaySendState, resetTodayOutboxForTest } from "./todayOutbox";
import { processOutboxSend, type SendDeps } from "./sendPump";
import { loadNudgeCounts } from "./escalate";
import { loadChases, setChase } from "./followUp";

const noAI = new AIService({ available: false });

beforeEach(() => { localStorage.clear(); resetOutboxForTest(); });

// AppShell in miniature: the pump and the toast host outlive the tab; the
// tab itself is keyed on `active` and unmounts the moment another tab is
// tapped, exactly as AppShell.tsx renders it.
function Shell({ api }: { api: ReturnType<typeof makeFakeGoogleApi> }) {
  const [active, setActive] = useState<"messages" | "today">("messages");
  return (
    <NotesProvider userId="u1">
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => api}>
        <MailOutboxPump ai={noAI} />
        <ToastHost />
        <button onClick={() => setActive("today")}>Today Tab</button>
        <div key={active}>{active === "messages" && <MessagesFlow ai={noAI} configured />}</div>
      </GoogleSessionProvider>
    </NotesProvider>
  );
}

const item = (over: Partial<OutboxItem> = {}): OutboxItem => ({
  id: "o1", to: "wei@x.com", subject: "Re: Waiver", body: "On it", threadId: "th1",
  dueMs: Date.now(), scheduled: false, state: "held", ...over,
});

// EMAIL-F-01 (2026-09-05): "Send and Schedule Send only leave while the
// Email tab is open." The record's own repro: tap Send, see the hold, tap the
// Today tab. The mail must still go.
describe("MailOutboxPump: a queued send leaves while the Email tab is unmounted", () => {
  it("a held send fires after he switches tabs mid-hold", async () => {
    const sent: { threadId?: string }[] = [];
    const api = makeFakeGoogleApi({ sendMessage: async (_raw, threadId) => { sent.push({ threadId }); return { id: "s1" }; } });
    render(<Shell api={api} />);
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByLabelText("New Message"));
    fireEvent.change(screen.getByPlaceholderText("To"), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByText("Send"));
    await waitFor(() => expect(screen.getByText("Nothing has left yet")).toBeInTheDocument());
    const [queued] = getOutbox();
    expect(queued!.state).toBe("held");

    // The tab switch: MessagesFlow is gone, and with it the effect that used
    // to be the only pump for this queue.
    fireEvent.click(screen.getByText("Today Tab"));
    expect(screen.queryByText("Nothing has left yet")).toBeNull();
    expect(screen.queryByLabelText("New Message")).toBeNull();

    // The hold runs out (Send Now's own move, standing in for twelve seconds
    // of wall clock so the test does not have to wait them).
    patchOutbox(queued!.id, { dueMs: Date.now() });
    await waitFor(() => expect(sent).toHaveLength(1), { timeout: 4000 });
    await waitFor(() => expect(getOutbox()).toHaveLength(0));
    expect(loadOutbox()).toHaveLength(0);
    // And he is told, wherever he is.
    expect(await screen.findByText("Sent")).toBeInTheDocument();
  });

  it("a scheduled send fires at its moment with no screen mounted but the pump", async () => {
    const sent: string[] = [];
    const api = makeFakeGoogleApi({ sendMessage: async (raw) => { sent.push(raw); return { id: "s1" }; } });
    render(
      <NotesProvider userId="u1">
        <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => api}>
          <MailOutboxPump ai={noAI} />
          <Connector />
        </GoogleSessionProvider>
      </NotesProvider>,
    );
    fireEvent.click(await screen.findByText("connect"));
    await screen.findByText("tokened");
    // "Tomorrow Morning", and the morning has arrived.
    enqueueOutbox(item({ id: "sched", scheduled: true, dueMs: Date.now() - 1000 }));
    await waitFor(() => expect(sent).toHaveLength(1), { timeout: 4000 });
    await waitFor(() => expect(getOutbox()).toHaveLength(0));
  });
});

// EMAIL-F-05 (2026-09-05): the stale-sending sweep on mount. The Today
// queue had the same shape with no card at all: an item left "sending" by a
// killed process was simply never retried and never shown.
describe("MailOutboxPump: the stale-sending sweep on mount", () => {
  it("a Today send left mid-flight by a dead process surfaces in the mail outbox as interrupted", () => {
    resetTodayOutboxForTest();
    enqueueTodaySend({ to: "wei@x.com", subject: "Re: Waiver", body: "On it", threadId: "th1", todayKind: "reply" });
    const [queued] = getTodayOutbox();
    markTodaySendState(queued!.id, "sending");
    render(
      <NotesProvider userId="u1">
        <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
          <MailOutboxPump ai={noAI} />
        </GoogleSessionProvider>
      </NotesProvider>,
    );
    expect(getTodayOutbox()).toHaveLength(0);
    const landed = getOutbox().find((o) => o.id === queued!.id);
    expect(landed).toBeDefined();
    expect(landed!.state).toBe("failed");
    expect(landed!.error).toBe(INTERRUPTED_LINE);
    expect(landed!.body).toBe("On it");
  });

  it("a mail send stored as sending by a dead process reads as interrupted, and the pump never auto-resends it", async () => {
    localStorage.setItem("jarvis.mail.outbox.v1", JSON.stringify([item({ id: "stuck", state: "sending", dueMs: Date.now() - 60_000 })]));
    resetOutboxForTest();
    let sends = 0;
    const api = makeFakeGoogleApi({ sendMessage: async () => { sends += 1; return { id: "s1" }; } });
    render(
      <NotesProvider userId="u1">
        <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => api}>
          <MailOutboxPump ai={noAI} />
          <Connector />
        </GoogleSessionProvider>
      </NotesProvider>,
    );
    fireEvent.click(await screen.findByText("connect"));
    await screen.findByText("tokened");
    expect(getOutbox()[0]!.state).toBe("failed");
    expect(getOutbox()[0]!.error).toBe(INTERRUPTED_LINE);
    await new Promise((r) => setTimeout(r, 1300));
    expect(sends).toBe(0);
    expect(getOutbox()).toHaveLength(1);
  });
});

// A tokened session with nothing on screen: the pump must be enough.
import { useGoogle } from "../connections/google/GoogleSession";
function Connector() {
  const g = useGoogle();
  return (
    <div>
      <button onClick={() => void g.connect()}>connect</button>
      {g.hasToken && <span>tokened</span>}
    </div>
  );
}

describe("processOutboxSend: the side effects the tab used to own", () => {
  const depsWith = (api: ReturnType<typeof makeFakeGoogleApi> | null, over: Partial<SendDeps> = {}): SendDeps => ({
    apiFor: () => api, ai: noAI, tasks: null, trackOpens: false, ...over,
  });

  it("with no api available, it reverts to held for the next tick rather than sticking as sending", async () => {
    enqueueOutbox(item({ state: "sending" }));
    await processOutboxSend(getOutbox()[0]!, depsWith(null));
    expect(getOutbox()[0]!.state).toBe("held");
  });

  it("deletes the Gmail draft it started from, only after the message actually left", async () => {
    let deleted: string | null = null;
    let sends = 0;
    const api = makeFakeGoogleApi({
      sendMessage: async () => { sends += 1; return { id: "s1" }; },
      deleteDraft: async (id) => { deleted = id; },
    });
    enqueueOutbox(item({ editingDraftId: "d1" }));
    await processOutboxSend(getOutbox()[0]!, depsWith(api));
    await waitFor(() => expect(deleted).toBe("d1"));
    expect(sends).toBe(1);
    expect(getOutbox()).toHaveLength(0);
  });

  it("a handoff archives the thread once it has gone", async () => {
    const modified: { id: string; remove: string[] }[] = [];
    const api = makeFakeGoogleApi({ modifyThread: async (id, _add, remove) => { modified.push({ id, remove }); } });
    enqueueOutbox(item({ handoffTo: "Sarah", threadId: "th-hand" }));
    await processOutboxSend(getOutbox()[0]!, depsWith(api));
    await waitFor(() => expect(modified).toEqual([{ id: "th-hand", remove: ["INBOX"] }]));
  });

  it("a send flagged as a nudge climbs the ladder; a plain reply does not", async () => {
    const api = makeFakeGoogleApi();
    enqueueOutbox(item({ id: "n1", threadId: "th-nudge", nudge: true }));
    enqueueOutbox(item({ id: "r1", threadId: "th-reply" }));
    for (const o of [...getOutbox()]) await processOutboxSend(o, depsWith(api));
    expect(loadNudgeCounts()["th-nudge"]).toBe(1);
    expect(loadNudgeCounts()["th-reply"]).toBeUndefined();
  });

  // EMAIL-F-02 (2026-09-05): "Chase If No Reply is set and cleared in the
  // same breath." Compose showed "In 3 days", he sent, and no chase card
  // ever appeared: setChase ran, then clearChase on the same thread id ran
  // right after it (MessagesFlow.tsx:1329-1334, ported verbatim). Verified
  // by running the same call order: after setChase 1, after clearChase 0.
  it("Chase If No Reply survives the send that set it", async () => {
    const api = makeFakeGoogleApi();
    enqueueOutbox(item({ threadId: "th-chase", chaseDays: 3 }));
    await processOutboxSend(getOutbox()[0]!, depsWith(api));
    const chase = loadChases().find((c) => c.threadId === "th-chase");
    expect(chase).toBeDefined();
    expect(chase!.dueISO > chase!.setISO).toBe(true);
  });

  it("a send with the chase Off retires the old chase on that thread", async () => {
    setChase({ threadId: "th-old", to: "wei@x.com", subject: "Waiver", setISO: "2026-09-01", days: 3 });
    const api = makeFakeGoogleApi();
    enqueueOutbox(item({ threadId: "th-old", chaseDays: 0 }));
    await processOutboxSend(getOutbox()[0]!, depsWith(api));
    expect(loadChases().some((c) => c.threadId === "th-old")).toBe(false);
  });

  it("a new chase replaces the old one on the same thread, never stacks", async () => {
    setChase({ threadId: "th-again", to: "wei@x.com", subject: "Waiver", setISO: "2026-09-01", days: 7 });
    const api = makeFakeGoogleApi();
    enqueueOutbox(item({ threadId: "th-again", chaseDays: 2 }));
    await processOutboxSend(getOutbox()[0]!, depsWith(api));
    const mine = loadChases().filter((c) => c.threadId === "th-again");
    expect(mine).toHaveLength(1);
    expect(mine[0]!.setISO).not.toBe("2026-09-01");
  });

  it("a failed send stays in the outbox as failed with a human error, never dropped", async () => {
    const api = makeFakeGoogleApi({ sendMessage: async () => { throw new Error("send 500"); } });
    enqueueOutbox(item({ state: "sending" }));
    await processOutboxSend(getOutbox()[0]!, depsWith(api));
    expect(getOutbox()[0]!.state).toBe("failed");
    expect(getOutbox()[0]!.error).toMatch(/Google's mail service/);
    expect(loadOutbox()[0]!.state).toBe("failed");
  });
});

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
import { enqueueOutbox, getOutbox, loadOutbox, patchOutbox, resetOutboxForTest, type OutboxItem } from "./outbox";
import { processOutboxSend, type SendDeps } from "./sendPump";
import { loadNudgeCounts } from "./escalate";

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

  it("a failed send stays in the outbox as failed with a human error, never dropped", async () => {
    const api = makeFakeGoogleApi({ sendMessage: async () => { throw new Error("send 500"); } });
    enqueueOutbox(item({ state: "sending" }));
    await processOutboxSend(getOutbox()[0]!, depsWith(api));
    expect(getOutbox()[0]!.state).toBe("failed");
    expect(getOutbox()[0]!.error).toMatch(/Google's mail service/);
    expect(loadOutbox()[0]!.state).toBe("failed");
  });
});

// @vitest-environment jsdom
// GUARD TEST (Money ledger acceptance 3), the Sweep's bill card. A bill plan
// the model read off an email is approved. It goes to the ledger, keyed to the
// thread, with a due date only if the email wrote one; the task pipeline never
// sees it; the same thread is never filed twice.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useLedger, useTasks } from "../data/NotesProvider";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { AIService } from "../ai/AIService";
import type { ThreadRow } from "../connections/google/map";
import type { LedgerService } from "../money/ledger/LedgerService";
import type { TasksService } from "../tasks/TasksService";
import { clearRejections, recentRejections } from "../money/ledger/guard";
import DeckFlow from "./DeckFlow";
import { SESSION_KEY } from "./sweepSession";

const showToast = vi.fn();
vi.mock("../shared/toast", () => ({ showToast: (...a: unknown[]) => showToast(...a), hideToast: () => {} }));

let ledger: LedgerService | null = null;
let tasks: TasksService | null = null;
function Grab() { ledger = useLedger(); tasks = useTasks(); return null; }

const row = (id: string): ThreadRow => ({
  id, from: "Geico", fromEmail: "billing@geico.com", subject: "Your premium", snippet: "",
  dateMs: 100, unread: false, count: 1, inInbox: true, lastMsgId: "m-" + id,
});
const gThread = (id: string, body: string) => ({
  id,
  messages: [{
    id: "m-" + id, threadId: id, snippet: "",
    payload: {
      mimeType: "text/plain", body: { data: btoa(body) },
      headers: [
        { name: "From", value: "Geico <billing@geico.com>" }, { name: "Subject", value: "Your premium" },
        { name: "Date", value: "Mon" }, { name: "Message-ID", value: "<" + id + "@x>" },
      ],
    },
  }],
});
const planAI = (bill: Record<string, unknown>) => new AIService({
  available: true,
  getToken: () => "tok",
  fetchImpl: (async () => ({
    ok: true, status: 200, text: async () => "",
    json: async () => ({ text: JSON.stringify({ kind: "bill", why: "A premium is due.", bill }) }),
  })) as unknown as typeof fetch,
});

function mount(id: string, body: string, bill: Record<string, unknown>, uid: string) {
  const archived: string[] = [];
  const api = makeFakeGoogleApi({
    getThread: async () => gThread(id, body),
    searchThreads: async () => [],
    modifyThread: async (tid: string) => { archived.push(tid); },
  });
  render(
    <NotesProvider userId={uid}>
      <Grab />
      <DeckFlow
        ai={planAI(bill)} apiFor={() => api} threads={[row(id)]} queueSend={vi.fn()}
        onDone={vi.fn()} onPark={vi.fn()} onOpenThread={vi.fn()} onEditReply={vi.fn()} onHandled={vi.fn()}
      />
    </NotesProvider>,
  );
  return { archived };
}
const toasts = () => showToast.mock.calls.map((c) => c[0] as { message: string; actionLabel?: string; onAction?: () => void });

beforeEach(() => {
  localStorage.clear(); localStorage.removeItem(SESSION_KEY); showToast.mockReset(); ledger = null; tasks = null; clearRejections();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("Sweep: a bill plan is filed in Money, never as a task", () => {
  it("Add Bill & Next files the bill with the email's own due date and archives the mail", async () => {
    const { archived } = mount("tg1", "Your Geico premium of $214 is due September 15.", { name: "Geico", amount: 214, due: "2026-09-15" }, "u-deck-bill");
    fireEvent.click(await screen.findByText("Add Bill & Next"));
    await waitFor(async () => expect(await ledger!.listBills()).toHaveLength(1));
    const [bill] = await ledger!.listBills();
    expect(bill!.data).toMatchObject({ vendor: "Geico", amountCents: 21400, dueDate: "2026-09-15", source: { type: "email", fingerprint: "gmail:tg1", ref: "tg1" } });
    expect(bill!.data.recurrence).toBeUndefined();
    expect(await tasks!.listTasks()).toEqual([]);
    expect(recentRejections()).toEqual([]);
    expect(toasts().some((t) => t.message === "Added to Money · $214.00")).toBe(true);
    await waitFor(() => expect(archived).toEqual(["tg1"]));
  });

  it("a due date the email never wrote is dropped, so the bill's due date stays blank", async () => {
    mount("tg2", "Your Geico premium is $214. Pay when you can.", { name: "Geico", amount: 214, due: "2026-09-15" }, "u-deck-bill-nodate");
    fireEvent.click(await screen.findByText("Add Bill & Next"));
    await waitFor(async () => expect(await ledger!.listBills()).toHaveLength(1));
    expect((await ledger!.listBills())[0]!.data.dueDate).toBeUndefined();
  });

  it("a thread already in Money at the same amount is reported and the mail is cleared", async () => {
    const { archived } = mount("tg3", "Your Geico premium of $214 is due September 15.", { name: "Geico", amount: 214 }, "u-deck-bill-dup");
    await waitFor(() => expect(ledger).not.toBeNull());
    await ledger!.addBill({ vendor: "Geico", amount: 214 }, { type: "email", fingerprint: "gmail:tg3", ref: "tg3" }, "email");
    fireEvent.click(await screen.findByText("Add Bill & Next"));
    await waitFor(() => expect(toasts().some((t) => t.message === "Already in Money · Geico $214.00")).toBe(true));
    expect(await ledger!.listBills()).toHaveLength(1);
    await waitFor(() => expect(archived).toEqual(["tg3"]));
  });

  it("a changed amount is an update offer: nothing doubled, nothing archived until answered", async () => {
    const { archived } = mount("tg4", "Your Geico premium is now $230.", { name: "Geico", amount: 230 }, "u-deck-bill-upd");
    await waitFor(() => expect(ledger).not.toBeNull());
    await ledger!.addBill({ vendor: "Geico", amount: 214 }, { type: "email", fingerprint: "gmail:tg4", ref: "tg4" }, "email");
    fireEvent.click(await screen.findByText("Add Bill & Next"));
    await waitFor(() => expect(toasts().some((t) => t.message === "Geico is already in Money at $214.00 · Update it to $230.00?")).toBe(true));
    expect(await ledger!.listBills()).toHaveLength(1);
    expect((await ledger!.listBills())[0]!.data.amountCents).toBe(21400);
    expect(archived).toEqual([]);
    toasts().find((t) => t.actionLabel === "Update")!.onAction!();
    await waitFor(async () => expect((await ledger!.listBills())[0]!.data.amountCents).toBe(23000));
    expect(await tasks!.listTasks()).toEqual([]);
  });
});

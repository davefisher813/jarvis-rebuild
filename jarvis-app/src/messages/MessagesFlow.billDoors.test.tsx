// @vitest-environment jsdom
// GUARD TEST (Money ledger acceptance 3), Messages' two bill doors: the
// waiting row's Add as Bill, and the thread card's Add Bill pill. A bill-shaped
// subject or invoice is fed at the real MessagesFlow. The task pipeline must
// not receive it; Money must, once, and a change is an update offer.
import "../shared/tiptapTest";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useLedger, useTasks } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { AIService } from "../ai/AIService";
import type { GmailThreadMeta } from "../connections/google/map";
import type { LedgerService } from "../money/ledger/LedgerService";
import type { TasksService } from "../tasks/TasksService";
import { clearRejections, recentRejections } from "../money/ledger/guard";
import MessagesFlow from "./MessagesFlow";
import MailOutboxPump from "./MailOutboxPump";
import ToastHost from "../shared/ToastHost";
import { resetInboxRefreshState } from "./inboxRefresh";
import { resetOutboxForTest } from "./outbox";

const noAI = new AIService({ available: false });
const aiReturning = (text: string) => new AIService({
  available: true,
  getToken: () => "tok",
  fetchImpl: (async () => ({ ok: true, status: 200, json: async () => ({ text }), text: async () => "" })) as unknown as typeof fetch,
});

let ledger: LedgerService | null = null;
let tasks: TasksService | null = null;
function Grab() { ledger = useLedger(); tasks = useTasks(); return null; }

const DAY = 86400e3;
const sent = (subject: string): GmailThreadMeta => ({ id: "w1", messages: [{
  id: "wm1", snippet: subject, labelIds: ["SENT"], internalDate: String(Date.now() - 12 * DAY),
  payload: { headers: [
    { name: "From", value: "Me <me@example.com>" }, { name: "To", value: "Con Edison <billing@coned.com>" },
    { name: "Subject", value: subject },
  ] },
}] });

function mount(api: ReturnType<typeof makeFakeGoogleApi>, uid: string, ai: AIService = aiReturning(JSON.stringify([{ id: "t1", bucket: "noise", gist: "g" }, { id: "t2", bucket: "noise", gist: "promo" }]))) {
  return render(
    <NotesProvider userId={uid}>
      <Grab />
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => api}>
        <MailOutboxPump ai={noAI} />
        <ToastHost />
        <MessagesFlow ai={ai} configured />
      </GoogleSessionProvider>
    </NotesProvider>,
  );
}

beforeEach(() => {
  localStorage.clear(); ledger = null; tasks = null; clearRejections();
  resetOutboxForTest(); resetInboxRefreshState();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("Messages: the waiting row's Add as Bill", () => {
  it("files the bill in Money with no due date, writes no task, and a second tap says it is already there", async () => {
    const api = makeFakeGoogleApi({ searchThreads: async () => [sent("Invoice $84.12 for September")] });
    mount(api, "u-bill-wait");
    fireEvent.click(await screen.findByText("Connect Google"));
    const onRow = (await screen.findAllByText("More")).find((el) => el.className.includes("pill-act"))!;
    fireEvent.click(onRow);
    fireEvent.click(await screen.findByText("Add as Bill"));

    await waitFor(async () => expect(await ledger!.listBills()).toHaveLength(1));
    const [bill] = await ledger!.listBills();
    expect(bill!.data).toMatchObject({ vendor: "Con Edison", amountCents: 8412, source: { type: "email", fingerprint: "gmail:w1", ref: "w1" } });
    // A subject states no due date and no repeat: neither is invented.
    expect(bill!.data.dueDate).toBeUndefined();
    expect(bill!.data.recurrence).toBeUndefined();
    expect(await tasks!.listTasks()).toEqual([]);
    expect(recentRejections()).toEqual([]);
    expect(await screen.findByText("Added to Money · $84.12")).toBeInTheDocument();
  });

  const tapAddAsBill = async () => {
    const onRow = (await screen.findAllByText("More")).find((el) => el.className.includes("pill-act"))!;
    fireEvent.click(onRow);
    fireEvent.click(await screen.findByText("Add as Bill"));
  };

  it("a second approval of the same thread is reported, not doubled", async () => {
    const api = makeFakeGoogleApi({ searchThreads: async () => [sent("Invoice $84.12 for September")] });
    mount(api, "u-bill-wait-dup");
    fireEvent.click(await screen.findByText("Connect Google"));
    await tapAddAsBill();
    await screen.findByText("Added to Money · $84.12");
    await tapAddAsBill();
    expect(await screen.findByText("Already in Money · Con Edison $84.12")).toBeInTheDocument();
    expect(await ledger!.listBills()).toHaveLength(1);
    expect(await tasks!.listTasks()).toEqual([]);
  });

  it("a thread whose bill is in Money at another amount is offered as an update", async () => {
    const api = makeFakeGoogleApi({ searchThreads: async () => [sent("Invoice $90.00 for September")] });
    mount(api, "u-bill-wait-upd");
    fireEvent.click(await screen.findByText("Connect Google"));
    await waitFor(() => expect(ledger).not.toBeNull());
    await ledger!.addBill({ vendor: "Con Edison", amount: 84.12 }, { type: "email", fingerprint: "gmail:w1", ref: "w1" }, "email");
    await tapAddAsBill();
    expect(await screen.findByText("Con Edison is already in Money at $84.12 · Update it to $90.00?")).toBeInTheDocument();
    expect((await ledger!.listBills())[0]!.data.amountCents).toBe(8412); // offered, not written
    fireEvent.click(screen.getByText("Update"));
    await waitFor(async () => expect((await ledger!.listBills())[0]!.data.amountCents).toBe(9000));
    expect(await ledger!.listBills()).toHaveLength(1);
    expect(await screen.findByText("Updated in Money · $90.00")).toBeInTheDocument();
  });

  it("writes nothing and says why when the subject states no amount", async () => {
    // No amount, no Add as Bill offer at all; the bill door never opens.
    const api = makeFakeGoogleApi({ searchThreads: async () => [sent("Your invoice is ready")] });
    mount(api, "u-bill-wait-none");
    fireEvent.click(await screen.findByText("Connect Google"));
    const onRow = (await screen.findAllByText("More")).find((el) => el.className.includes("pill-act"))!;
    fireEvent.click(onRow);
    await screen.findByText("More Moves");
    expect(screen.queryByText("Add as Bill")).toBeNull();
    expect(await ledger!.listBills()).toEqual([]);
  });
});

// The thread card: an invoice attachment with an amount in the body offers Add
// Bill. The same thread, opened from the list.
const invoiceThread = (body: string) => ({
  id: "t1",
  messages: [{
    id: "m1", threadId: "t1", snippet: "",
    payload: {
      mimeType: "multipart/mixed",
      headers: [{ name: "From", value: "Con Edison <billing@coned.com>" }, { name: "Subject", value: "Your invoice" }, { name: "Date", value: "Mon" }, { name: "Message-ID", value: "<a@x>" }],
      parts: [
        { mimeType: "text/plain", body: { data: btoa(body) } },
        { filename: "invoice.pdf", mimeType: "application/pdf", body: { attachmentId: "att1", size: 1000 } },
      ],
    },
  }],
});
const listed: GmailThreadMeta[] = [{ id: "t1", messages: [{
  id: "m1", snippet: "Your invoice", labelIds: ["INBOX"], internalDate: String(Date.now() - 1000),
  payload: { headers: [{ name: "From", value: "Con Edison <billing@coned.com>" }, { name: "Subject", value: "Your invoice" }] },
}] }];

describe("Messages: the thread card's Add Bill", () => {
  const open = async (body: string, uid: string) => {
    const api = makeFakeGoogleApi({ listThreads: async () => listed, getThread: async () => invoiceThread(body) as never, searchThreads: async () => [] });
    mount(api, uid, noAI);
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByText("Con Edison"));
    return screen.findByText("Add Bill");
  };

  it("files the invoice in Money keyed to the thread, with no due date, and makes no task", async () => {
    fireEvent.click(await open("Amount due: $84.12", "u-bill-card"));
    expect(await screen.findByText("Added to Money · $84.12")).toBeInTheDocument();
    const bills = await ledger!.listBills();
    expect(bills).toHaveLength(1);
    expect(bills[0]!.data).toMatchObject({ vendor: "Con Edison", amountCents: 8412, source: { type: "email", fingerprint: "gmail:t1", ref: "t1" } });
    expect(bills[0]!.data.dueDate).toBeUndefined();
    expect(await tasks!.listTasks()).toEqual([]);
    expect(recentRejections()).toEqual([]);
  });

  it("a thread already in Money at another amount gets an update offer, not a second bill", async () => {
    const pill = await open("Amount due: $90.00", "u-bill-card-upd");
    await ledger!.addBill({ vendor: "Con Edison", amount: 84.12 }, { type: "email", fingerprint: "gmail:t1", ref: "t1" }, "email");
    fireEvent.click(pill);
    expect(await screen.findByText("Con Edison is already in Money at $84.12 · Update it to $90.00?")).toBeInTheDocument();
    expect(await ledger!.listBills()).toHaveLength(1);
    fireEvent.click(screen.getByText("Update"));
    await waitFor(async () => expect((await ledger!.listBills())[0]!.data.amountCents).toBe(9000));
    expect(await tasks!.listTasks()).toEqual([]);
  });
});

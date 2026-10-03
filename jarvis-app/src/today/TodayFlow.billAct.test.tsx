// @vitest-environment jsdom
// GUARD TEST (Money ledger acceptance 3), Today's mail-act door. An invoice
// the triage pass read as a bill is fed at the real TodayFlow and tapped. The
// task pipeline must not receive it; Money must.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useLedger, useTasks } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { setCategoryRegistry } from "../shared/categories";
import type { AIService } from "../ai/AIService";
import type { LedgerService } from "../money/ledger/LedgerService";
import type { TasksService } from "../tasks/TasksService";
import { readAct } from "../messages/mailAct";
import { isBillShaped, clearRejections, recentRejections } from "../money/ledger/guard";
import { saveMailSnapshot, type MailSnapshot, type MailThread } from "../messages/home";
import { todayISO, addDays } from "../schedule/calendar";
import TodayFlow from "./TodayFlow";

const showToast = vi.fn();
vi.mock("../shared/toast", () => ({ showToast: (...a: unknown[]) => showToast(...a), hideToast: () => {} }));
vi.mock("../ai/useAI", () => ({ useAI: () => ({ available: false } as unknown as AIService) }));
vi.mock("../people/MessageDraftSheet", () => ({ default: () => null }));
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const USER = "today-bill-act-user";
let ledger: LedgerService | null = null;
let tasks: TasksService | null = null;
function Grab() { ledger = useLedger(); tasks = useTasks(); return null; }

const TODAY = todayISO();
const DUE = addDays(TODAY, 3);

const thread = (id: string, amount: number): MailThread => ({
  id, from: "ConEdison", fromEmail: "billing@coned.com", subject: "Your invoice", gist: "Invoice ready",
  account: "me@x.com", lastMsgId: "m" + id, revision: "m" + id,
  // The raw proposal the triage pass wrote: kind "invoice" is a bill word.
  act: { kind: "invoice", title: "ConEdison", date: DUE, amount },
});
const save = (threads: MailThread[]) =>
  saveMailSnapshot({ ts: Date.now(), owner: USER, needsYou: threads.length, threads, waiting: [], promises: [], actionable: [] } as MailSnapshot);

function mount() {
  return render(
    <NotesProvider userId={USER}>
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
        <Grab />
        <TodayFlow onGoSchedule={() => {}} onGoTasks={() => {}} onGoEmail={() => {}} />
      </GoogleSessionProvider>
    </NotesProvider>,
  );
}
const messages = () => showToast.mock.calls.map((c) => (c[0] as { message: string }).message);

beforeEach(() => {
  showToast.mockReset(); localStorage.clear(); ledger = null; tasks = null; setCategoryRegistry([]); clearRejections();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("Today: an invoice in the mail becomes a Money bill, never a task", () => {
  it("readAct reads the invoice as a bill, and the task door would refuse it", async () => {
    const act = readAct({ kind: "invoice", title: "ConEdison", date: DUE, amount: 84.12 }, TODAY)!;
    expect(act.verb).toBe("bill");
    expect(isBillShaped({ bill: { amount: act.amount } })).toBe(true);
  });

  it("Add Bill files it in the ledger with the mail's date and writes no task", async () => {
    save([thread("tb1", 84.12)]);
    mount();
    fireEvent.click(await screen.findByText("Add Bill"));
    await waitFor(async () => expect(await ledger!.listBills()).toHaveLength(1));

    const [bill] = await ledger!.listBills();
    expect(bill!.data).toMatchObject({ vendor: "ConEdison", amountCents: 8412, dueDate: DUE, source: { type: "email", fingerprint: "gmail:tb1", ref: "tb1" } });
    expect(bill!.data.recurrence).toBeUndefined();
    // Nothing reached the task pipeline: no task at all, and no refusal logged.
    expect(await tasks!.listTasks()).toEqual([]);
    expect(recentRejections()).toEqual([]);
    await waitFor(() => expect(messages().some((m) => /^In Money/.test(m) && m.includes("$84.12"))).toBe(true));
  });

  it("a thread already in Money at another amount is offered as an update, not doubled", async () => {
    // The mail came back changed ($90) for a thread whose first bill ($84.12)
    // was approved earlier, so the ledger already holds it.
    save([thread("tb2", 90)]);
    mount();
    await waitFor(() => expect(ledger).not.toBeNull());
    await ledger!.addBill({ vendor: "ConEdison", amount: 84.12, dueDate: DUE }, { type: "email", fingerprint: "gmail:tb2", ref: "tb2" }, "email");
    fireEvent.click(await screen.findByText("Add Bill"));
    await waitFor(() => expect(messages().some((m) => m.includes("already in Money at $84.12") && m.includes("Update it to $90.00"))).toBe(true));

    // Offered, not written: one bill, still $84.12.
    let bills = await ledger!.listBills();
    expect(bills).toHaveLength(1);
    expect(bills[0]!.data.amountCents).toBe(8412);

    const offer = showToast.mock.calls.map((c) => c[0] as { message: string; actionLabel?: string; onAction?: () => void }).find((t) => t.actionLabel === "Update")!;
    offer.onAction!();
    await waitFor(async () => expect((await ledger!.listBills())[0]!.data.amountCents).toBe(9000));
    bills = await ledger!.listBills();
    expect(bills).toHaveLength(1);
    expect(bills[0]!.data.history.at(-1)!.action).toBe("corrected");
    expect(await tasks!.listTasks()).toEqual([]);
  });
});

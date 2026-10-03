// @vitest-environment jsdom
// LEDGER BILLS ON TODAY (Money ledger, lane B). A ledger bill is not a task, so
// it never shows in Today's task lists; the bill card is its door. An overdue
// one (from an explicit due date) and a due-soon one reach the card the way a
// legacy bill does, a bill with no due date never does, and the card's Paid
// button goes through the same Mark Paid door the Money tab uses.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useLedger } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { todayISO, addDays } from "../schedule/calendar";
import type { LedgerService } from "../money/ledger/LedgerService";
import type { BillInput } from "../money/ledger/bill";
import type { AIService } from "../ai/AIService";
import TodayFlow from "./TodayFlow";

vi.mock("../shared/toast", () => ({ showToast: () => {}, hideToast: () => {} }));
vi.mock("../ai/useAI", () => ({ useAI: () => ({ available: false } as unknown as AIService) }));
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const T = todayISO();
let ledgerRef: LedgerService | null = null;

function Seed({ bills, children }: { bills: BillInput[]; children: ReactNode }) {
  const ledger = useLedger();
  const started = useRef(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    ledgerRef = ledger;
    void (async () => { for (const b of bills) await ledger.addBill(b); })().then(() => setReady(true));
  }, [ledger, bills]);
  return ready ? <>{children}</> : null;
}

function mount(user: string, bills: BillInput[], onOpenEntity?: (k: string, id: string) => void) {
  return render(
    <NotesProvider userId={user}>
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
        <Seed bills={bills}>
          <TodayFlow onGoSchedule={() => {}} onGoTasks={() => {}} onOpenEntity={onOpenEntity} />
        </Seed>
      </GoogleSessionProvider>
    </NotesProvider>,
  );
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("the Today bill card carries ledger bills", () => {
  it("an overdue ledger bill reaches the card in the Colour Key's red, with its amount", async () => {
    mount("tl-over", [{ vendor: "ConEdison", amount: 84.12, dueDate: addDays(T, -2) }]);
    expect(await screen.findByText("ConEdison")).toBeInTheDocument();
    expect(screen.getByText("$84.12")).toBeInTheDocument();
    expect(screen.getByText("2 Days Late")).toHaveClass("fact", "red");
  });

  it("a ledger bill due tomorrow reaches it, in the warn tone", async () => {
    mount("tl-soon", [{ vendor: "Water", amount: 40, dueDate: addDays(T, 1) }]);
    expect(await screen.findByText("Water")).toBeInTheDocument();
    expect(screen.getByText("Due Tomorrow")).toHaveClass("fact", "warn");
  });

  it("a bill with no due date is never due and never late: no card at all", async () => {
    mount("tl-nodate", [{ vendor: "Ghost Bill", amount: 40 }]);
    await waitFor(() => expect(ledgerRef).not.toBeNull());
    await new Promise((r) => setTimeout(r, 60));
    expect(screen.queryByText("Ghost Bill")).toBeNull();
    expect(screen.queryByText(/Late/)).toBeNull();
  });

  it("a bill far out is not on the card", async () => {
    mount("tl-far", [{ vendor: "Far Off", amount: 40, dueDate: addDays(T, 30) }]);
    await waitFor(() => expect(ledgerRef).not.toBeNull());
    await new Promise((r) => setTimeout(r, 60));
    expect(screen.queryByText("Far Off")).toBeNull();
  });

  it("tapping the card opens that bill in Money through the shell's door", async () => {
    const opened: [string, string][] = [];
    mount("tl-open", [{ vendor: "ConEdison", amount: 84.12, dueDate: addDays(T, -2) }], (k, id) => opened.push([k, id]));
    fireEvent.click(await screen.findByText("ConEdison"));
    const [b] = await ledgerRef!.listBills();
    expect(opened).toEqual([["bill", b!.id]]);
  });

  it("Paid asks 'I paid this' first (the shared door), then the card is gone and the bill is the person's confirmed", async () => {
    mount("tl-pay", [{ vendor: "ConEdison", amount: 84.12, dueDate: addDays(T, -2) }]);
    await screen.findByText("ConEdison");
    fireEvent.click(screen.getByText("Paid"));
    expect(await screen.findByText("Mark Paid")).toBeInTheDocument();
    expect((await ledgerRef!.listBills())[0]!.data.paidAt).toBeUndefined();
    fireEvent.click(screen.getByText("I Paid This"));
    await waitFor(() => expect(screen.queryByText("2 Days Late")).toBeNull());
    expect((await ledgerRef!.listBills())[0]!.data).toMatchObject({ paidAt: T, paidEvidence: { type: "user_confirmed" } });
  });

  it("an autopay ledger bill is on the card but offers no Paid button", async () => {
    mount("tl-auto", [{ vendor: "Rent", amount: 1850, dueDate: addDays(T, 1), autopay: true }]);
    await screen.findByText("Rent");
    expect(screen.queryByText("Paid")).toBeNull();
  });
});

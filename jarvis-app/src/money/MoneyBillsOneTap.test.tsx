// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useLedger, useTracker } from "../data/NotesProvider";
import type { TrackerService } from "./TrackerService";
import MoneyFlow from "./MoneyFlow";
import type { LedgerService } from "./ledger/LedgerService";
import { todayISO } from "../tasks/grouping";
import { addDays } from "../schedule/calendar";
import { monthDay } from "./bills";
import { subscribeToast, resetToasts } from "../shared/toast";

// DAVE'S OPEN QUESTION: single tap with Undo, or an explicit confirm. The
// answer is one constant (confirmMarkPaid.ts). This file flips it to false and
// proves the other branch works end to end: one tap writes the person's own
// confirmation dated today, and the toast's Undo is unmarkBillPaid.
vi.mock("./confirmMarkPaid", () => ({ CONFIRM_MARK_PAID: false }));

const T = todayISO();
let ledgerRef: LedgerService | null = null;
let trackerRef: TrackerService | null = null;

function Seed({ children }: { children: ReactNode }) {
  const ledger = useLedger();
  const tracker = useTracker();
  const started = useRef(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    ledgerRef = ledger;
    trackerRef = tracker;
    void ledger.addBill({ vendor: "Water", amount: 40, dueDate: addDays(T, -1) }).then(() => setReady(true));
  }, [ledger, tracker]);
  return ready ? <>{children}</> : null;
}

afterEach(() => resetToasts());

describe("CONFIRM_MARK_PAID = false: one tap, then Undo", () => {
  it("the check marks it paid at once, dated today, with no confirm sheet, and Undo takes it back", async () => {
    let undo: (() => void) | undefined;
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) { seen.push(t.message); undo = t.onAction; } });
    render(<NotesProvider userId="one-tap"><Seed><MoneyFlow /></Seed></NotesProvider>);
    await screen.findByText("Water");
    fireEvent.click(screen.getByLabelText("Mark paid"));
    await screen.findByText(`Paid ${monthDay(T)}`);
    expect(screen.queryByText("I Paid This")).toBeNull();
    const [b] = await ledgerRef!.listBills();
    // The payment is filed too, and it is the bill's evidence (the live audit, 2026-10-19).
    const txs = (await trackerRef!.load()).txs;
    expect(txs.map((t) => [t.data.merchant, t.data.amountCents, t.data.date])).toEqual([["Water", 4000, T]]);
    expect(b!.data).toMatchObject({ paidAt: T, paidEvidence: { type: "transaction", transactionId: txs[0]!.id } });
    expect(seen).toContain("Marked Paid");

    undo!();
    await waitFor(async () => expect((await ledgerRef!.listBills())[0]!.data.paidAt).toBeUndefined());
    await screen.findByText("1 Day Late");
    // Undo takes the payment back out of the Tracker with the paid state.
    expect((await trackerRef!.load()).txs).toEqual([]);
    const history = (await ledgerRef!.listBills())[0]!.data.history.map((h) => h.action);
    expect(history).toEqual(["created", "marked paid", "paid state removed"]);
    stop();
  });
});

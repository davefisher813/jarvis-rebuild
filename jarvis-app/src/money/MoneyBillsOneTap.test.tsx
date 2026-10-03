// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useLedger } from "../data/NotesProvider";
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

function Seed({ children }: { children: ReactNode }) {
  const ledger = useLedger();
  const started = useRef(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    ledgerRef = ledger;
    void ledger.addBill({ vendor: "Water", amount: 40, dueDate: addDays(T, -1) }).then(() => setReady(true));
  }, [ledger]);
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
    expect(b!.data).toMatchObject({ paidAt: T, paidEvidence: { type: "user_confirmed" } });
    expect(seen).toContain("Marked Paid");

    undo!();
    await waitFor(async () => expect((await ledgerRef!.listBills())[0]!.data.paidAt).toBeUndefined());
    await screen.findByText("1 Day Late");
    const history = (await ledgerRef!.listBills())[0]!.data.history.map((h) => h.action);
    expect(history).toEqual(["created", "marked paid", "paid state removed"]);
    stop();
  });
});

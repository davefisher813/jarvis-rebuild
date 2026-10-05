// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useLedger, useTracker } from "../../data/NotesProvider";
import type { LedgerService } from "../ledger/LedgerService";
import type { TrackerService } from "../TrackerService";
import { subscribeToast, resetToasts, type ToastState } from "../../shared/toast";
import { NOT_MATCH_KEY } from "../notMatch";
import { billStatus } from "../ledger/status";
import MatchesCard from "./MatchesCard";
import { capsulesInCards } from "../../laws/catalogCheck";

const TODAY = "2026-10-03";
interface Handles { ledger: LedgerService; tracker: TrackerService }

function Harness({ into, children }: { into: { current?: Handles }; children?: React.ReactNode }) {
  const ledger = useLedger();
  const tracker = useTracker();
  const [ready, setReady] = useState(false);
  useEffect(() => { into.current = { ledger, tracker }; setReady(true); }, [ledger, tracker, into]);
  return ready ? <>{children}</> : null;
}

const pay = { date: "2026-09-08", month: "2026-09", merchant: "Stop & Shop", name: "STOP & SHOP #123", amountCents: 4712, category: "Groceries", account: "CHK" };
const toasts: ToastState[] = [];
let off: () => void;
beforeEach(() => { localStorage.clear(); resetToasts(); toasts.length = 0; off = subscribeToast((t) => { if (t) toasts.push(t); }); });
afterEach(() => { off(); vi.restoreAllMocks(); });

async function seedReceiptPair(h: Handles) {
  const txId = (await h.tracker.saveTx(null, pay))!;
  const r = await h.ledger.addReceipt({ vendor: "Stop & Shop", amount: "47.12", transactionDate: "2026-09-08" }, "manual", TODAY);
  if (!r.ok) throw new Error("seed");
  return { txId, receiptId: r.id };
}

describe("the Matches card", () => {
  it("shows nothing when there is nothing to ask", async () => {
    const h: { current?: Handles } = {};
    const { container } = render(<NotesProvider userId="mc-empty"><Harness into={h}><MatchesCard /></Harness></NotesProvider>);
    await waitFor(() => expect(h.current).toBeTruthy());
    expect(container.querySelector(".match-row")).toBeNull();
    expect(screen.queryByText("Matches")).toBeNull();
  });

  it("shows a receipt and a payment that look alike, in plain words, and links nothing by itself", async () => {
    const h: { current?: Handles } = {};
    render(<NotesProvider userId="mc-show"><Harness into={h}><MatchesCard /></Harness></NotesProvider>);
    await waitFor(() => expect(h.current).toBeTruthy());
    const { receiptId } = await seedReceiptPair(h.current!);
    expect(await screen.findByText(/Stop & Shop Receipt \$47\.12 Looks Like Your Sep 8 Payment/)).toBeInTheDocument();
    expect(screen.getByText("Matches")).toBeInTheDocument();
    // both sides are named
    expect(screen.getByText("Receipt")).toBeInTheDocument();
    expect(screen.getByText("Payment")).toBeInTheDocument();
    // THE ROW IS CLEAN (Dave 2026-10-05, locked: no pill on a row): both answers are the swipe tray's buttons, and the
    // row carries no capsule of any kind.
    expect(screen.getByRole("button", { name: /^Link / })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Not a Match / })).toBeInTheDocument();
    expect(document.querySelector(".match-row .pill-act, .match-row .quiet-action, .match-row .btn-sm")).toBeNull();
    expect(capsulesInCards(document.body)).toEqual([]);
    // never automatic
    expect((await h.current!.ledger.getReceipt(receiptId))!.data.linkedTransactionId).toBeUndefined();
  });

  it("Link links the pair, says what changed, and Undo takes it back", async () => {
    const h: { current?: Handles } = {};
    render(<NotesProvider userId="mc-link"><Harness into={h}><MatchesCard /></Harness></NotesProvider>);
    await waitFor(() => expect(h.current).toBeTruthy());
    const { receiptId, txId } = await seedReceiptPair(h.current!);
    fireEvent.click(await screen.findByRole("button", { name: /^Link / }));
    await waitFor(async () => expect((await h.current!.ledger.getReceipt(receiptId))!.data.linkedTransactionId).toBe(txId));
    const done = toasts.find((t) => t.message === "Linked · Counted Once");
    expect(done, "a confirmation of what changed").toBeTruthy();
    expect(done!.actionLabel).toBe("Undo");
    // both records still exist; the card is gone
    expect(await h.current!.ledger.listReceipts()).toHaveLength(1);
    await waitFor(() => expect(screen.queryByText("Matches")).toBeNull());
    done!.onAction!();
    await waitFor(async () => expect((await h.current!.ledger.getReceipt(receiptId))!.data.linkedTransactionId).toBeUndefined());
  });

  it("Not a Match is remembered and does not return, even on a fresh visit", async () => {
    const h: { current?: Handles } = {};
    const first = render(<NotesProvider userId="mc-no"><Harness into={h}><MatchesCard /></Harness></NotesProvider>);
    await waitFor(() => expect(h.current).toBeTruthy());
    const { receiptId, txId } = await seedReceiptPair(h.current!);
    fireEvent.click(await screen.findByRole("button", { name: /^Not a Match / }));
    await waitFor(() => expect(screen.queryByText("Matches")).toBeNull());
    expect(JSON.parse(localStorage.getItem(NOT_MATCH_KEY)!)).toEqual([`${receiptId}|${txId}`]);
    // nothing was written to the ledger
    expect((await h.current!.ledger.getReceipt(receiptId))!.data.linkedTransactionId).toBeUndefined();
    first.unmount();
    render(<NotesProvider userId="mc-no"><Harness into={h}><MatchesCard /></Harness></NotesProvider>);
    await waitFor(() => expect(h.current).toBeTruthy());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Matches")).toBeNull();
  });

  it("a stale proposal (already linked elsewhere) refreshes quietly, with no error", async () => {
    const h: { current?: Handles } = {};
    render(<NotesProvider userId="mc-stale"><Harness into={h}><MatchesCard /></Harness></NotesProvider>);
    await waitFor(() => expect(h.current).toBeTruthy());
    await seedReceiptPair(h.current!);
    await screen.findByRole("button", { name: /^Link / });
    const ledger = h.current!.ledger;
    vi.spyOn(ledger, "approveReceiptMatch").mockResolvedValue({ ok: false, reason: "already_linked" });
    vi.spyOn(ledger, "receiptMatches").mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: /^Link / }));
    await waitFor(() => expect(screen.queryByText("Matches")).toBeNull());
    expect(toasts.filter((t) => /Couldn't|Linked/.test(t.message))).toEqual([]);
  });

  it("a bill and the payment that looks like it: Link marks it paid with the payment as evidence", async () => {
    const h: { current?: Handles } = {};
    render(<NotesProvider userId="mc-bill"><Harness into={h}><MatchesCard /></Harness></NotesProvider>);
    await waitFor(() => expect(h.current).toBeTruthy());
    const txId = (await h.current!.tracker.saveTx(null, { ...pay, merchant: "ConEdison", name: "CONED", amountCents: 8412, category: "Utilities", date: "2026-10-04", month: "2026-10" }))!;
    const b = await h.current!.ledger.addBill({ vendor: "ConEdison", amount: "84.12", dueDate: "2026-10-05" });
    if (!b.ok) throw new Error("seed");
    expect(await screen.findByText(/ConEdison Bill \$84\.12 Looks Like Your Oct 4 Payment/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Link / }));
    await waitFor(async () => expect(billStatus((await h.current!.ledger.getBill(b.id))!.data, "2026-10-06")).toBe("paid"));
    expect((await h.current!.ledger.getBill(b.id))!.data.paidEvidence).toEqual({ type: "transaction", transactionId: txId });
    expect(toasts.map((t) => t.message)).toContain("Linked · Bill Marked Paid");
  });

  it("a tap anywhere on the row asks the same two questions", async () => {
    const h: { current?: Handles } = {};
    render(<NotesProvider userId="mc-row"><Harness into={h}><MatchesCard /></Harness></NotesProvider>);
    await waitFor(() => expect(h.current).toBeTruthy());
    await seedReceiptPair(h.current!);
    fireEvent.click(await screen.findByText(/Looks Like Your Sep 8 Payment/));
    // the sheet's two choices (the row's own two are its swipe tray, named for the record)
    expect(await screen.findByRole("button", { name: "Not a Match" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link" })).toBeInTheDocument();
  });
});

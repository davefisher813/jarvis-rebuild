import type { LedgerService } from "./ledger/LedgerService";
import type { TrackerService } from "./TrackerService";
import type { TrackerTx } from "./tracker";

// A TRANSACTION'S LINKS, KEPT HONEST WHEN IT MOVES (Money ledger, 2026-10-03).
//
// A payment can be the other half of a receipt (a link, never a merge) or the
// evidence that a bill is paid. Both live on the payment as ids. Deleting the
// payment, or turning the match down, has to leave neither of them pointing at
// nothing, and a bill must not stay "paid" on the strength of a payment that is
// gone (hard rule 2: paid is never claimed without evidence).
//
// Everything here goes through LedgerService, so the history lines are written
// by the same code that wrote the link, and each action hands back its Undo.

export interface LinkChange {
  /** What changed, for the confirmation. */
  said: string;
  undo: () => Promise<void>;
}

/** Is this payment the evidence behind its bill? Only then does the bill's paid
 *  state depend on it; a payment the person merely tagged does not. */
async function isEvidence(ledger: LedgerService, tx: TrackerTx): Promise<boolean> {
  if (!tx.data.paysBillId) return false;
  const bill = await ledger.getBill(tx.data.paysBillId);
  const ev = bill?.data.paidEvidence;
  return ev?.type === "transaction" && ev.transactionId === tx.id;
}

/** Turn a match down from the payment's side: the receipt becomes unmatched, or
 *  the bill goes back to unpaid. Null when the payment holds no such link. */
export async function unmatchTx(ledger: LedgerService, tx: TrackerTx, which: "receipt" | "bill"): Promise<LinkChange | null> {
  const receiptId = tx.data.matchedReceiptId;
  if (which === "receipt" && receiptId) {
    const r = await ledger.unmatchReceipt(receiptId);
    if (!r.ok) return null;
    return { said: "Unmatched", undo: async () => { await ledger.approveReceiptMatch(receiptId, tx.id); } };
  }
  const billId = tx.data.paysBillId;
  if (which === "bill" && billId && (await isEvidence(ledger, tx))) {
    const r = await ledger.unmarkBillPaid(billId);
    if (!r.ok) return null;
    return { said: "Unmatched · Bill Unpaid", undo: async () => { await ledger.approveBillMatch(billId, tx.id); } };
  }
  return null;
}

/** Delete a payment. Its receipt is unmatched and a bill it paid goes back to
 *  unpaid first; Undo brings the payment back under its own id and links them
 *  again. */
export async function removeTxWithLinks(tracker: TrackerService, ledger: LedgerService | null, tx: TrackerTx): Promise<() => Promise<void>> {
  const receiptId = tx.data.matchedReceiptId;
  const billId = tx.data.paysBillId;
  let relinkBill = false;
  if (ledger) {
    if (receiptId) await ledger.unmatchReceipt(receiptId);
    if (billId && (await isEvidence(ledger, tx))) {
      await ledger.unmarkBillPaid(billId);
      relinkBill = true;
    }
  }
  await tracker.removeTx(tx.id);
  return async () => {
    const back: TrackerTx = { id: tx.id, data: { ...tx.data } };
    delete back.data.matchedReceiptId;
    delete back.data.paysBillId;
    await tracker.restoreTx(back);
    if (!ledger) return;
    if (receiptId) await ledger.approveReceiptMatch(receiptId, tx.id);
    if (billId && relinkBill) await ledger.approveBillMatch(billId, tx.id);
  };
}

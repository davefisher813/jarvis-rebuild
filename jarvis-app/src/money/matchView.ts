import type { MatchProposal } from "./ledger/reconcile";
import type { Bill, Receipt } from "./ledger/types";
import { pairKey } from "./notMatch";
import { fmtCents, fmtDay, type TrackerTx } from "./tracker";

// A MATCH PROPOSAL, SAID BOTH WAYS (Money ledger, 2026-10-03). The pure half
// of the Matches card: which proposals are still worth showing, and the plain
// words for each side. Nothing here links anything; that is the person's tap.

export type ProposalKind = "receipt" | "bill";

export interface SideView {
  /** "Receipt", "Bill", "Payment". */
  label: string;
  /** The name as the person (or the bank) wrote it. */
  name: string;
  amount: string;
  /** The day: a receipt's date, a bill's due date, a payment's date. */
  day: string;
}

export interface ProposalView {
  key: string;
  kind: ProposalKind;
  recordId: string;
  transactionId: string;
  /** "Stop & Shop receipt $47.12 looks like your Sep 8 payment". */
  headline: string;
  record: SideView;
  payment: SideView;
}

export function buildProposals(input: {
  receiptProposals: MatchProposal[];
  billProposals: MatchProposal[];
  receipts: Receipt[];
  bills: Bill[];
  txs: TrackerTx[];
  /** pairKey() values the person turned down. */
  notMatches: Set<string>;
}): ProposalView[] {
  const txById = new Map(input.txs.map((t) => [t.id, t]));
  const out: ProposalView[] = [];
  // One transaction can be proposed for several records; once shown for one it
  // is not offered to a second in the same list, or approving the first would
  // leave a card the service has to refuse.
  const taken = new Set<string>();
  const take = (kind: ProposalKind, recordId: string, tx: TrackerTx): boolean => {
    if (input.notMatches.has(pairKey(recordId, tx.id)) || taken.has(`${kind}:${tx.id}`)) return false;
    taken.add(`${kind}:${tx.id}`);
    return true;
  };
  for (const p of input.receiptProposals) {
    const r = input.receipts.find((x) => x.id === p.recordId);
    const t = txById.get(p.transactionId);
    if (!r || !t || !take("receipt", r.id, t)) continue;
    const amount = fmtCents(r.data.amountCents);
    out.push({
      key: pairKey(r.id, t.id), kind: "receipt", recordId: r.id, transactionId: t.id,
      headline: `${r.data.vendor} receipt ${amount} looks like your ${fmtDay(t.data.date)} payment`,
      record: { label: "Receipt", name: r.data.vendor, amount, day: r.data.transactionDate },
      payment: { label: "Payment", name: t.data.merchant, amount: fmtCents(t.data.amountCents), day: t.data.date },
    });
  }
  for (const p of input.billProposals) {
    const b = input.bills.find((x) => x.id === p.recordId);
    const t = txById.get(p.transactionId);
    if (!b || !t || !b.data.dueDate || !take("bill", b.id, t)) continue;
    const amount = fmtCents(b.data.amountCents);
    out.push({
      key: pairKey(b.id, t.id), kind: "bill", recordId: b.id, transactionId: t.id,
      headline: `${b.data.vendor} bill ${amount} looks like your ${fmtDay(t.data.date)} payment`,
      record: { label: "Bill", name: b.data.vendor, amount, day: b.data.dueDate },
      payment: { label: "Payment", name: t.data.merchant, amount: fmtCents(t.data.amountCents), day: t.data.date },
    });
  }
  return out;
}

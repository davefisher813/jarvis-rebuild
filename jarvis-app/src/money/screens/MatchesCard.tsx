import { useCallback, useEffect, useMemo, useState } from "react";
import { useOptionalLedger } from "../../data/NotesProvider";
import { attemptWrite } from "../../shared/guard";
import { showToast } from "../../shared/toast";
import { lineCase } from "../../shared/casing";
import { pressable } from "../../shared/pressable";
import RowActionSheet from "../../shared/RowActionSheet";
import type { MatchProposal } from "../ledger/reconcile";
import type { Bill, Receipt } from "../ledger/types";
import { fmtDay, type TrackerTx, ENTITY_MONEY_TX } from "../tracker";
import { ENTITY_MONEY_BILL, ENTITY_MONEY_RECEIPT } from "../ledger/types";
import { buildProposals, type ProposalView } from "../matchView";
import { loadNotMatches, rememberNotMatch } from "../notMatch";
import { useLedgerEvents } from "../useLedgerEvents";

// THE MATCHES CARD (Money ledger, 2026-10-03). A proposal is a question, never
// an action: "this receipt looks like that payment". Nothing here links until
// the person taps Link, and a link is not a merge, so both records keep
// existing and the pair is counted once. Not a Match is remembered, so the
// same question does not come back.

interface Loaded {
  receiptProposals: MatchProposal[];
  billProposals: MatchProposal[];
  receipts: Receipt[];
  bills: Bill[];
  txs: TrackerTx[];
}

const EMPTY: Loaded = { receiptProposals: [], billProposals: [], receipts: [], bills: [], txs: [] };

// NO GREY AT ALL (2026-10-05, Dave's visual catalog gate, R1 and R5). Each side
// was a label, an amount, a day and a name: two greys a line, four a row, and
// the name said the vendor the headline already says (a proposal only exists
// when the two vendors are the same after normalising, so the name can add
// nothing but its spelling). Now the label and the amount are the white facts
// (a number with no state) and the day the small-caps date: the headline above
// is the row's title and carries the words, so the line carries only what it
// does not.
function Side({ label, amount, day }: { label: string; amount: string; day: string }) {
  return (
    <div className="facts">
      <span className="fact"><b>{label}</b></span>
      <span className="fact"><b>{amount}</b></span>
      <span className="fact date">{fmtDay(day)}</span>
    </div>
  );
}

export default function MatchesCard({ onChanged }: { onChanged?: () => void }) {
  const ledger = useOptionalLedger();
  const [data, setData] = useState<Loaded>(EMPTY);
  const [notMatches, setNotMatches] = useState<Set<string>>(() => loadNotMatches());
  const [menu, setMenu] = useState<ProposalView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ledger) return;
    const [receiptProposals, billProposals, receipts, bills, txs] = await Promise.all([
      ledger.receiptMatches(), ledger.billMatches(), ledger.listReceipts(), ledger.listBills(), ledger.listTxs(),
    ]);
    setData({ receiptProposals, billProposals, receipts, bills, txs });
  }, [ledger]);
  useEffect(() => { void load(); }, [load]);
  useLedgerEvents([ENTITY_MONEY_RECEIPT, ENTITY_MONEY_BILL, ENTITY_MONEY_TX], load);

  const views = useMemo(() => buildProposals({ ...data, notMatches }), [data, notMatches]);
  if (!ledger || views.length === 0) return null;

  const link = async (v: ProposalView) => {
    if (busy) return;
    setBusy(v.key);
    try {
      let res: Awaited<ReturnType<typeof ledger.approveReceiptMatch>> | undefined;
      const wrote = await attemptWrite(async () => {
        res = v.kind === "receipt"
          ? await ledger.approveReceiptMatch(v.recordId, v.transactionId)
          : await ledger.approveBillMatch(v.recordId, v.transactionId);
      });
      if (!wrote || !res) return;
      if (res.ok) {
        // What changed, said plainly, with the way back.
        showToast({
          message: v.kind === "receipt" ? "Linked · Counted Once" : "Linked · Bill Marked Paid",
          actionLabel: "Undo",
          onAction: () => void (async () => {
            await attemptWrite(() => (v.kind === "receipt" ? ledger.unmatchReceipt(v.recordId) : ledger.unmarkBillPaid(v.recordId)));
            await load();
            onChanged?.();
          })(),
        });
      } else if (res.reason !== "already_linked" && res.reason !== "missing") {
        showToast({ message: "Couldn't Link That" });
      }
      // A stale proposal (matched elsewhere since it was drawn) just refreshes.
      await load();
      onChanged?.();
    } finally {
      setBusy(null);
    }
  };
  const notAMatch = (v: ProposalView) => setNotMatches(rememberNotMatch(v.recordId, v.transactionId));

  return (
    <>
      <div className="sh2 sh2-quiet"><span className="t">Matches</span><span className="n">{views.length}</span></div>
      <div className="pad-x"><div className="card list-card-ruled">
        {views.map((v) => (
          // The row is a door to the same two choices its buttons make, so a
          // tap anywhere on it asks rather than guesses.
          <div className="task-row p2 match-row" key={v.key} {...pressable(() => setMenu(v))}>
            <div className="task-title">
              <span className="task-name">{lineCase(v.headline)}</span>
              <Side label={v.record.label} amount={v.record.amount} day={v.record.day} />
              <Side label={v.payment.label} amount={v.payment.amount} day={v.payment.day} />
            </div>
            <div className="match-acts">
              <button className="pill-act" disabled={busy !== null} onClick={(e) => { e.stopPropagation(); void link(v); }}>Link</button>
              <button className="quiet-action" onClick={(e) => { e.stopPropagation(); notAMatch(v); }}>Not a Match</button>
            </div>
          </div>
        ))}
      </div></div>
      {menu && (
        <RowActionSheet
          title={lineCase(menu.headline)}
          actions={[
            { label: "Link", onPick: () => void link(menu) },
            { label: "Not a Match", onPick: () => notAMatch(menu) },
          ]}
          onCancel={() => setMenu(null)}
        />
      )}
    </>
  );
}

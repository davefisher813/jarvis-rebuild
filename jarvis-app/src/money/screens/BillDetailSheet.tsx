import { useEffect, useState } from "react";
import { FormSheet, Group, Row, Note, DeleteRow } from "../../shared/FormSheet";
import Provenance from "../../shared/ProvenanceLine";
import { sourceOpener } from "../../shared/openSource";
import type { Source } from "../../shared/provenance";
import { Calendar, Link2 } from "../../shared/icons";
import { DollarGlyph, RepeatGlyph, WalletGlyph, CheckCircleGlyph } from "../../shared/glyphs";
import { useOptionalLedger } from "../../data/NotesProvider";
import { lineCase } from "../../shared/casing";
import { monthDay } from "../bills";
import { billAmount, evidenceLine, historyLines, ledgerChip, ledgerStatusWord } from "../billView";
import { isPaid } from "../ledger/status";
import type { Bill } from "../ledger/types";
import type { TrackerTx } from "../tracker";

// THE BILL'S OWN PAGE (Money ledger, lane B). Everything the ledger knows
// about one bill, in plain words: where it stands, what proves it paid, where
// it came from, and every change to it, oldest first. Nothing on it is
// guessed. A bill with no due date shows no date; a bill is "Paid" only with
// the evidence line saying who said so.
//
// Actions are the sheet's rows, not a menu: Mark Paid (or, when a correction
// reopened a paid bill, Confirm It Is Still Paid), Remove Paid State, Delete
// Bill. Delete comes back through the parent's Undo (restoreBill).
export default function BillDetailSheet({ bill, today, onClose, onEdit, onMarkPaid, onRemovePaid, onDelete, onOpenEntity }: {
  bill: Bill;
  today: string;
  onClose: () => void;
  onEdit: () => void;
  onMarkPaid: () => void;
  onRemovePaid: () => void;
  onDelete: () => void;
  /** The shell's door to an email thread, the one every From-an-email line uses. */
  onOpenEntity?: (kind: string, id: string) => void;
}) {
  const d = bill.data;
  const ledger = useOptionalLedger();
  const [txs, setTxs] = useState<TrackerTx[]>([]);
  // The payment that proved it paid is read only when there is one to read.
  const wantsTx = d.paidEvidence?.type === "transaction";
  useEffect(() => {
    if (!wantsTx || !ledger) return;
    let live = true;
    void ledger.listTxs().then((t) => { if (live) setTxs(t); }, () => undefined);
    return () => { live = false; };
  }, [wantsTx, ledger]);

  const paid = isPaid(d);
  const reopened = !paid && !!d.paidAt && !!d.paidNeedsReconfirm;
  const chip = ledgerChip(d, today);
  const evidence = evidenceLine(d, txs);
  const history = historyLines(d.history, d.currency);
  const source: Source | undefined = d.source !== "manual" && d.source.type === "email"
    ? { type: "email", ...(d.source.ref ? { ref: d.source.ref } : {}), ts: Date.parse(d.history[0]?.at ?? "") || 0 }
    : undefined;
  const open = source && onOpenEntity ? sourceOpener(onOpenEntity)(source) : undefined;

  return (
    <FormSheet title="Bill" onCancel={onClose} onSave={onEdit} saveLabel="Edit">
      <Group label="Bill">
        <Row tone="yellow" glyph={<WalletGlyph />} label="Vendor"><span className="bill-val">{d.vendor}</span></Row>
        <Row tone="green" glyph={<DollarGlyph />} label="Amount"><span className={"money-amt bill-val" + (paid ? " paid" : "")}>{billAmount(d)}</span></Row>
        {/* A bill with no due date shows no Due row at all (2026-10-05, the
            visual catalog gate, R1: a row with nothing to say shows nothing,
            and "None" is the placeholder the rule names; it used to say "None"). */}
        {d.dueDate && (
          <Row tone="orange" glyph={<Calendar className="ic" />} label="Due">
            <span className="bill-val">{monthDay(d.dueDate)}</span>
          </Row>
        )}
        <Row tone="blue" glyph={<CheckCircleGlyph />} label="Status">
          {chip
            ? <span className={"uchip bill-val " + chip.cls}>{chip.text}</span>
            : <span className={"bill-val" + (paid ? " fact good" : "")}>{ledgerStatusWord(d, today)}</span>}
        </Row>
        {d.recurrence && <Row tone="sky" glyph={<RepeatGlyph />} label="Repeats"><span className="bill-val">{lineCase(d.recurrence)}</span></Row>}
        {d.autopay && <Row tone="blue" glyph={<RepeatGlyph />} label="Autopay"><span className="bill-val">On</span></Row>}
        {d.notes && <Row label="Notes"><span className="bill-val bill-notes">{d.notes}</span></Row>}
        {d.payUrl && !paid && (
          <Row tone="indigo" glyph={<Link2 className="ic" />} label="Pay Link">
            <a className="bill-pay bill-val" href={d.payUrl} target="_blank" rel="noopener noreferrer">Pay</a>
          </Row>
        )}
      </Group>
      {evidence && <Note>{evidence}</Note>}
      {source && <div className="pad-x bill-prov"><Provenance source={source} onOpen={open} /></div>}

      {(!paid || reopened) && (
        <Group className="xs-actions">
          <Row onClick={onMarkPaid} chev label={reopened ? "Confirm It Is Still Paid" : "Mark Paid"} />
        </Group>
      )}
      {!!d.paidAt && (
        <Group className="xs-actions">
          <Row onClick={onRemovePaid} label="Remove Paid State" />
        </Group>
      )}

      <Group label="History">
        {/* ONE GREY PER ROW (2026-10-05, visual catalog gate, R1). The line
            under what happened was the one grey ("You" beside a small-caps
            day) and every change under it was two more (the field name and
            the word "to" in the grey, the values in white). Each change is
            now ONE white fact, so who did it is the row's only grey. */}
        {history.map((h, i) => (
          <Row key={i} label={h.what} meta={<><span className="fact">{h.who}</span>{h.when && <span className="fact date">{h.when}</span>}</>}>
            {h.changes.length > 0 && (
              <div className="bill-changes">
                {h.changes.map((c) => (
                  <div key={c.label} className="bill-change">
                    <span className="fact"><b>{`${c.label} ${c.from} to ${c.to}`}</b></span>
                  </div>
                ))}
              </div>
            )}
          </Row>
        ))}
      </Group>

      <Group className="xs-actions"><DeleteRow label="Delete Bill" onClick={onDelete} /></Group>
    </FormSheet>
  );
}

import { useEffect, useState } from "react";
import { FormSheet, Group, Row, Note, DeleteRow } from "../../shared/FormSheet";
import Provenance from "../../shared/ProvenanceLine";
import { sourceOpener } from "../../shared/openSource";
import { sourceOf } from "../../shared/provenance";
import { Calendar, Link2 } from "../../shared/icons";
import { DollarGlyph, RepeatGlyph, WalletGlyph, CheckCircleGlyph } from "../../shared/glyphs";
import { useOptionalLedger } from "../../data/NotesProvider";
import { lineCase, titleCase } from "../../shared/casing";
import { monthDay } from "../bills";
import { billAmount, evidenceLine, historyLines, ledgerChip, ledgerStatusWord } from "../billView";
import { isPaid } from "../ledger/status";
import { ENTITY_MONEY_BILL, type Bill } from "../ledger/types";
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
  // The key colour of where the bill stands: late red, due amber, and nothing for a bill that is paid or far out.
  const stateTone: "red" | "warn" | undefined = paid ? undefined : chip?.cls === "u-late" ? "red" : chip?.cls === "u-today" ? "warn" : undefined;
  // Due soon or late, with a date to say it: the Due row says all of it, and a Status row would repeat it.
  const inState = !paid && !reopened && !!d.dueDate && !!stateTone && !!chip;
  const evidence = evidenceLine(d, txs);
  const history = historyLines(d.history, d.currency);
  // Phase 0 D3 (2026-10-10): the ledger's own source shape read into the one
  // Source by the one map (provenance.ts sourceOf), not by hand here.
  const source = sourceOf(ENTITY_MONEY_BILL, d);
  const open = source && onOpenEntity ? sourceOpener(onOpenEntity)(source) : undefined;

  return (
    <FormSheet title={titleCase(d.vendor)} onCancel={onClose} onSave={onEdit} saveLabel="Edit">
      <Group label="Bill">
        <Row tone="yellow" glyph={<WalletGlyph />} label="Vendor"><span className="bill-val">{titleCase(d.vendor)}</span></Row>
        <Row tone="green" glyph={<DollarGlyph />} label="Amount"><span className={"money-amt bill-val" + (paid ? " paid" : "")}>{billAmount(d)}</span></Row>
        {/* A bill with no due date shows no Due row at all (2026-10-05, the
            visual catalog gate, R1: a row with nothing to say shows nothing,
            and "None" is the placeholder the rule names; it used to say "None"). */}
        {/* THE DUE DATE AND THE STATUS WEAR THE BILL'S STATE (Dave 2026-10-05, the Colour Key: a due date drawn grey is a
            violation). Due in a day or two is amber, late is red, paid is green on the status. The chip class the ledger
            returns (.uchip) is a ruled-list class and does nothing inside a sheet, so the state reads as a fact tone here:
            the same two key colours, no capsule in a row. */}
        {/* ONE ROW SAYS WHERE THE BILL STANDS (round 3 review: "Due Oct 7" in amber with "Due in 2 Days" in amber beneath it said
            the same thing twice). While it is due or late the Due row carries both facts, the date and how far, in the state's
            one colour; the Status row is for what the date cannot say (paid, to confirm, autopay, nothing owed yet). */}
        {d.dueDate && (
          <Row tone="orange" glyph={<Calendar className="ic" />} label="Due">
            {inState && chip ? (
              <span className="bill-val facts">
                <span className={"fact " + stateTone}>{monthDay(d.dueDate)}</span>
                <span className={"fact " + stateTone}>{chip.text.replace(/^due\s+/i, "").replace(/^./, (c) => c.toUpperCase())}</span>
              </span>
            ) : (
              <span className={"bill-val fact" + (stateTone ? " " + stateTone : "")}>{monthDay(d.dueDate)}</span>
            )}
          </Row>
        )}
        {!inState && (
          <Row tone="blue" glyph={<CheckCircleGlyph />} label="Status">
            <span className={"bill-val fact" + (paid ? " good" : stateTone ? " " + stateTone : "")}>{chip ? chip.text : ledgerStatusWord(d, today)}</span>
          </Row>
        )}
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

      {/* THE PRIMARY IS THE SHEET'S ONE FILLED BUTTON, THE QUIETER ACTIONS BENEATH IT (Dave 2026-10-05, locked: the detail sheet
          holds every action with the primary prominent). Mark Paid used to be a grey row the weight of the details, while
          Delete Bill was the loudest thing on the sheet. */}
      {(!paid || reopened) && (
        <div className="rem-detail-acts">
          <button type="button" className="btn btn-primary" onClick={onMarkPaid}>{reopened ? "Confirm It Is Still Paid" : "Mark Paid"}</button>
        </div>
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

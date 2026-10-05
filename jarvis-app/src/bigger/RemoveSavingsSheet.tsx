import { createPortal } from "react-dom";
import type { SavedEntry } from "../life/types";
import { formatMoney } from "../money/types";
import { monthDay } from "../money/bills";
import { savedTotal } from "./savings";

// REMOVE A SAVINGS ENTRY, THE CONFIRM (Dave 2026-10-01).
//
// A logged entry can be wrong (a mistyped amount) and the total stays wrong
// until it is corrected, so a tap on the row offers Edit Amount and Remove
// Entry. Removing takes money off the goal's total, so it is asked in so many
// words first, the same shape as Delete Exercise and Delete Block: what the
// entry is, what happens to the total, a way out. It writes nothing; the
// caller removes and offers Undo afterwards.

/** What the sheet says, from the entries themselves so it cannot disagree with them. */
// ONE GREY LINE, NOT TWO (2026-10-05, the catalog hard gate). It used to hand
// back two stacked grey lines, "The $500 entry" (which only repeated the
// amount the card above already names) and "Saved goes from $600 to $100"
// (sentence case, both amounts in the grey). The repeat is gone, and what is
// left is one fact whose two amounts are numbers with no state, so they step
// up to white (R4), the way every other facts line draws a count.
// The entry reads "Saved $500 on Jul 1", not "$500 on Jul 1": a drawn phrase that opens with a
// number takes its next word capitalised ("$500 On Jul 1"), so it opens with the verb instead
// (2026-10-05). `said` is the same entry as a screen reader says it, for the dialog's name.
export function removeSavingsLines(entry: SavedEntry, all: SavedEntry[] | undefined): { what: string; said: string; lead: string; before: string; after: string } {
  const total = savedTotal(all);
  return {
    what: `Saved ${formatMoney(entry.amount)} on ${monthDay(entry.d)}`,
    said: `${formatMoney(entry.amount)} on ${monthDay(entry.d)}`,
    lead: "Saved Goes from",
    before: formatMoney(Math.max(0, total)),
    after: formatMoney(Math.max(0, total - entry.amount)),
  };
}

export default function RemoveSavingsSheet({ entry, all, pending = false, onRemove, onCancel }: {
  entry: SavedEntry;
  all: SavedEntry[] | undefined;
  pending?: boolean;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const { what, said, lead, before, after } = removeSavingsLines(entry, all);
  return createPortal(
    <div className="sheet-scrim" onClick={pending ? () => undefined : onCancel}>
      <div className="card" role="dialog" aria-label={`Remove ${said}`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Remove Entry</div></div>
        <div className="pad-x"><div className="card pad"><div className="dup-name">{what}</div></div></div>

        <div className="grp xs-grp"><div className="eyebrow">What Goes</div></div>
        <div className="pad-x"><div className="card pad">
          <div className="facts"><span className="fact">{lead} <b>{before}</b> to <b>{after}</b></span></div>
        </div></div>
        <div className="pad-x"><div className="input-hint">You can undo it right after</div></div>

        <div className="pad-x sheet-actions">
          <button type="button" className="btn btn-block btn-secondary destructive" disabled={pending} onClick={onRemove}>
            {pending ? "Removing" : "Remove Entry"}
          </button>
          <button type="button" className="btn btn-tertiary btn-block" disabled={pending} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

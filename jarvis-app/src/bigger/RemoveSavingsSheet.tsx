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
export function removeSavingsLines(entry: SavedEntry, all: SavedEntry[] | undefined): { what: string; goes: string[] } {
  const total = savedTotal(all);
  const after = Math.max(0, total - entry.amount);
  return {
    what: `${formatMoney(entry.amount)} on ${monthDay(entry.d)}`,
    goes: [
      `The ${formatMoney(entry.amount)} entry`,
      `Saved goes from ${formatMoney(Math.max(0, total))} to ${formatMoney(after)}`,
    ],
  };
}

export default function RemoveSavingsSheet({ entry, all, pending = false, onRemove, onCancel }: {
  entry: SavedEntry;
  all: SavedEntry[] | undefined;
  pending?: boolean;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const { what, goes } = removeSavingsLines(entry, all);
  return createPortal(
    <div className="sheet-scrim" onClick={pending ? () => undefined : onCancel}>
      <div className="card" role="dialog" aria-label={`Remove ${what}`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Remove Entry</div></div>
        <div className="pad-x"><div className="card pad"><div className="dup-name">{what}</div></div></div>

        <div className="grp xs-grp"><div className="eyebrow">What Goes</div></div>
        <div className="pad-x"><div className="card pad">
          {goes.map((l) => <div className="conn-meta" key={l}>{l}</div>)}
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

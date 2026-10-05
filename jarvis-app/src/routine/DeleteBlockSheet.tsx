import { createPortal } from "react-dom";
import { fmtTime } from "../schedule/calendar";
import { lineCase } from "../shared/casing";
import type { ProtectedBlock } from "./types";

// DELETE BLOCK, THE CONFIRM (Dave 2026-10-01).
//
// Delete Block removed a protected time at once and offered only an Undo toast.
// During verification a real block was deleted by a stray tap and had to be
// recreated by hand. Deleting a block takes away a time that repeats every week
// and every one-day change made to it, so it is asked in so many words first,
// the same shape as Delete Exercise: what the block is, what goes with it, and
// a way out. It writes nothing; the caller deletes and offers Undo afterwards.
// Reached from both doors: Edit Block in Your Routine and the block sheet on
// the Schedule and Today screens. (A swipe on a row is its own deliberate
// gesture and keeps its Undo.)

const DOW_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (min: number): string => {
  const t = fmtTime(`${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`);
  return `${t.time} ${t.ap}`;
};

export function daysLine(days: number[]): string {
  const s = [...new Set(days)].sort((a, b) => a - b);
  if (s.length === 7) return "Every day";
  if (s.length === 5 && [1, 2, 3, 4, 5].every((d) => s.includes(d))) return "Weekdays";
  if (s.length === 2 && s.includes(0) && s.includes(6)) return "Weekends";
  return s.map((d) => DOW_ABBR[d]).join(" ");
}

/** What the sheet says, computed from the block itself so it cannot disagree with it.
 *
 *  2026-10-05 (the catalog gate): `when` was one string, "Mon Wed \u00b7 9:00 AM to
 *  10:00 AM", drawn inside one .fact, so the separator was baked into a fact (R6)
 *  and the days and the clock shared one grey (R1). It is `days` and `time` now,
 *  two facts the stylesheet separates. The first "What Goes" line repeated the
 *  block's own days and clock, which the card above it already shows, so it is
 *  gone; the lines left are Title Case like every other line the app writes. */
export function blockDeleteLines(block: ProtectedBlock): { days: string; time: string; goes: string[] } {
  const exceptions = Object.keys(block.exceptions ?? {}).length;
  const goes = [lineCase("It leaves every day it repeats on")];
  if (exceptions > 0) goes.push(lineCase(`${exceptions} one-day ${exceptions === 1 ? "change" : "changes"} made to it`));
  return { days: daysLine(block.days), time: `${clock(block.startMin)} to ${clock(block.endMin)}`, goes };
}

export default function DeleteBlockSheet({ block, pending = false, onDelete, onCancel }: {
  block: ProtectedBlock;
  pending?: boolean;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const { days, time, goes } = blockDeleteLines(block);
  return createPortal(
    <div className="sheet-scrim" onClick={pending ? () => undefined : onCancel}>
      <div className="card" role="dialog" aria-label={`Delete ${block.label}`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Delete Block</div></div>
        <div className="pad-x"><div className="card pad">
          {/* The name wraps: clipping it is how two blocks look the same. */}
          <div className="dup-name">{block.label}</div>
          <div className="facts"><span className="fact date">{days}</span><span className="fact date">{time}</span></div>
        </div></div>

        <div className="grp xs-grp"><div className="eyebrow">What Goes</div></div>
        <div className="pad-x"><div className="card pad">
          {goes.map((l) => <div className="conn-meta" key={l}>{l}</div>)}
        </div></div>
        <div className="pad-x"><div className="input-hint">You can undo it right after</div></div>

        <div className="pad-x sheet-actions">
          <button type="button" className="btn btn-block btn-secondary destructive" disabled={pending} onClick={onDelete}>
            {pending ? "Deleting" : "Delete Block"}
          </button>
          <button type="button" className="btn btn-tertiary btn-block" disabled={pending} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

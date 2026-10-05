import { sameLocalDay, clockOf, type DoseRow } from "../meds";
import { shortDateFromMs } from "../../shared/dateFormat";
import { useState } from "react";
import RowShell from "../../brain/RowShell";
import RowSheet from "../../brain/RowSheet";

// THE DOSE TIMELINE (Health Push D, H-38). What happened, newest first: the
// med's name, the amount, the clock. Today's rows carry Undo; a row still on
// its way to the store (pending) does not, because its id is not yet real.
// CLEAN ROWS (Dave 2026-10-05, locked): Undo is not a capsule on the row. It is
// the swipe-left of today's row and the answer on the sheet a tap opens.
// Nothing here is a tally of anything undone.
export default function DoseTimeline({ doses, now = Date.now(), limit = 14, onUndo }: {
  doses: DoseRow[];
  now?: number;
  limit?: number;
  onUndo?: (row: DoseRow) => void;
}) {
  const [open, setOpen] = useState<DoseRow | null>(null);
  const recent = [...doses].sort((a, b) => b.at - a.at).slice(0, limit);
  if (recent.length === 0) return null;
  return (
    <>
      <div className="sh2 sh2-quiet"><span className="t">The Timeline</span></div>
      <div className="pad-x"><div className="card list-card-ruled shell-rows">
        {recent.map((d) => {
          const today = sameLocalDay(d.at, now);
          const undoable = !!onUndo && today && !d.pending;
          const when = today ? clockOf(d.at) : shortDateFromMs(d.at) + " " + clockOf(d.at);
          return (
            <RowShell key={d.id} verb={undoable ? { label: "Undo", run: () => onUndo!(d) } : undefined}>
              {/* A tap opens what the row holds: a receipt shown whole, and Undo when it can be undone. */}
              <div className="row" role="button" tabIndex={0} onClick={() => { if (undoable) setOpen(d); }} onKeyDown={(e) => { if (undoable && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setOpen(d); } }}>
                <div className="row-grow">
                  <div className="conn-name">{d.name}</div>
                  <div className="facts">
                    {/* When it was taken is a neutral time, small caps (§AM
                        F5): not the medication area's blue on words. */}
                    <span className="fact date">{when}</span>
                    {d.amount && <span className="fact">{d.amount}</span>}
                  </div>
                </div>
              </div>
            </RowShell>
          );
        })}
      </div></div>
      {open && onUndo && (
        <RowSheet eyebrow="Dose" text={open.name}
          facts={<><span className="fact date">{clockOf(open.at)}</span>{open.amount && <span className="fact">{open.amount}</span>}</>}
          answers={[{ label: "Undo", onPick: () => onUndo(open) }]} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

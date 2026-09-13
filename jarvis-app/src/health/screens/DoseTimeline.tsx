import { sameLocalDay, clockOf, type DoseRow } from "../meds";
import { shortDateFromMs } from "../../shared/dateFormat";

// THE DOSE TIMELINE (Health Push D, H-38). What happened, newest first: the
// med's name, the amount, the clock. Today's rows carry Undo; a row still on
// its way to the store (pending) does not, because its id is not yet real.
// Nothing here is a tally of anything undone.
export default function DoseTimeline({ doses, now = Date.now(), limit = 14, onUndo }: {
  doses: DoseRow[];
  now?: number;
  limit?: number;
  onUndo?: (row: DoseRow) => void;
}) {
  const recent = [...doses].sort((a, b) => b.at - a.at).slice(0, limit);
  if (recent.length === 0) return null;
  return (
    <>
      <div className="sh2 sh2-quiet"><span className="t">The Timeline</span></div>
      <div className="pad-x"><div className="card list-card-ruled">
        {recent.map((d) => {
          const today = sameLocalDay(d.at, now);
          return (
            <div className="row" key={d.id}>
              <div className="row-grow">
                <div className="conn-name">{d.name}</div>
                <div className="facts">
                  <span className="fact hblue">{today ? clockOf(d.at) : shortDateFromMs(d.at) + " " + clockOf(d.at)}</span>
                  {d.amount && <span className="fact">{d.amount}</span>}
                </div>
              </div>
              {onUndo && today && !d.pending && (
                <button type="button" className="pill-act pill-quiet" onClick={() => onUndo(d)} aria-label={"Undo " + d.name + " at " + clockOf(d.at)}>Undo</button>
              )}
            </div>
          );
        })}
      </div></div>
    </>
  );
}

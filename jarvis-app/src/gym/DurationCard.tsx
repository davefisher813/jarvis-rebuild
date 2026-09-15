import { useRef, useState } from "react";
import { own } from "../shared/rowDoor";
import type { WorkoutData, WorkoutRevision } from "./types";
import { durationOf } from "../insights/analytics";
import { capAfterNumber } from "../shared/casing";
import { fmtTime } from "../schedule/calendar";

// THE DURATION, SHOWN AND CORRECTABLE (the approved Health design,
// 2026-09-14, item 9: a 627-minute session). The cause: a session's end is
// stamped when Finish is tapped, so a session left open (the app closed with
// it live, the phone in a locker, a finish the next morning) records the
// whole wall clock as time trained; parked time is the only stretch the app
// already subtracts. Nothing is capped or rewritten here. The card says how
// the number was made (start, end, parked, the span of the logged sets) and
// lets the person set the end, either to the last logged set or to a time
// they type; every correction is kept as a revision with the value it
// replaced, so the original is never lost.

const clock = (ms: number) => { const d = new Date(ms); const t = fmtTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`); return `${t.time} ${t.ap}`; };
const hhmm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const minutes = (n: number) => capAfterNumber(`${n} min`);

export default function DurationCard({ workout, onCorrect }: {
  workout: WorkoutData;
  /** Absent, the card only reads. */
  onCorrect?: (endedAt: number, revision: WorkoutRevision) => void;
}) {
  const d = durationOf(workout);
  const [editing, setEditing] = useState(false);
  const [endIn, setEndIn] = useState(hhmm(workout.endedAt));
  const revisions = workout.revisions ?? [];
  const endRef = useRef<HTMLInputElement>(null);
  const correct = (to: number) => {
    if (!onCorrect || !Number.isFinite(to) || to <= workout.startedAt || to === workout.endedAt) return;
    onCorrect(to, { at: Date.now(), field: "endedAt", from: workout.endedAt, to });
    setEditing(false);
  };
  const commitTyped = () => {
    const m = /^(\d{2}):(\d{2})$/.exec(endIn);
    if (!m) return;
    const t = new Date(workout.startedAt);
    t.setHours(Number(m[1]), Number(m[2]), 0, 0);
    // An end typed earlier than the start is the next morning.
    if (t.getTime() <= workout.startedAt) t.setDate(t.getDate() + 1);
    correct(t.getTime());
  };
  return (
    <>
      <div className="sh2 sh2-quiet"><span className="t">Duration</span>{d.flagged && <span className="n">Review</span>}</div>
      <div className="pad-x"><div className="card list-card-ruled">
        <div className="row">
          <div className="row-grow"><div className="conn-name">Active</div></div>
          <div className="facts"><span className={"fact " + (d.flagged ? "amber" : "lime")}>{minutes(d.activeMin)}</span></div>
        </div>
        <div className="row">
          <div className="row-grow"><div className="conn-name">Elapsed</div></div>
          <div className="facts"><span className="fact">{clock(workout.startedAt)} to {clock(workout.endedAt)}</span><span className="fact amber">{minutes(d.elapsedMin)}</span></div>
        </div>
        {d.pausedMin > 0 && (
          <div className="row">
            <div className="row-grow"><div className="conn-name">Parked</div></div>
            <div className="facts"><span className="fact amber">{minutes(d.pausedMin)}</span></div>
          </div>
        )}
        {d.firstSetAt != null && d.lastSetAt != null && (
          <div className="row">
            <div className="row-grow"><div className="conn-name">Sets Logged</div></div>
            <div className="facts"><span className="fact">{clock(d.firstSetAt)} to {clock(d.lastSetAt)}</span><span className="fact lime">{minutes(Math.max(1, d.setSpanMin ?? 0))}</span></div>
          </div>
        )}
        {d.flagged && (
          <div className="row"><div className="row-grow"><div className="conn-name">The recorded end runs far past the last logged set, so this session may have been left open</div></div></div>
        )}
        {revisions.map((r, i) => (
          <div className="row" key={i}>
            <div className="row-grow"><div className="conn-name">Corrected</div></div>
            <div className="facts"><span className="fact">{clock(r.from)} to {clock(r.to)}</span></div>
          </div>
        ))}
        {onCorrect && !editing && (
          <>
            {d.lastSetAt != null && d.lastSetAt !== workout.endedAt && (
              <button type="button" className="row-create" onClick={() => correct(d.lastSetAt!)}>End at the Last Set</button>
            )}
            <button type="button" className="row-create" onClick={() => setEditing(true)}>Set the End Time</button>
          </>
        )}
        {onCorrect && editing && (
          // The label lands in the field (Dave 2026-09-15: "I want all rows clickable").
          <div className="row" onClick={() => endRef.current?.focus()}>
            <div className="row-grow"><div className="conn-name">End Time</div></div>
            <input ref={endRef} className="input set-field" type="time" aria-label="End time" value={endIn} onChange={(e) => setEndIn(e.target.value)} />
            <button type="button" className="pill-act" onClick={own(commitTyped)}>Save</button>
          </div>
        )}
      </div></div>
    </>
  );
}

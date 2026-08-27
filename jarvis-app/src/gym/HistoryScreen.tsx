import { useMemo, useState } from "react";
import type { Workout } from "./types";
import { exerciseHistory, trendLine, doneCount, movedFact } from "./history";
import { monthDay } from "../money/bills";
import { DayDivide } from "../shared/anatomy";

// A disclosure pair: right when collapsed, down when open. Both are the one
// drawn .chev arrow, rotated; neither is an svg (see the chevron law).
const CHEV = <div className="chev" />;
const CHEV_DOWN = <div className="chev chev-down" />;

// V2 anatomy: one day label per group of receipts, not a date repeated on
// every row (same shape as CategoryDetail's Record).
function groupByDay(entries: { date: string; text: string }[]): { day: string; rows: string[] }[] {
  const out: { day: string; rows: string[] }[] = [];
  for (const e of entries) {
    const last = out[out.length - 1];
    if (last && last.day === e.date) last.rows.push(e.text);
    else out.push({ day: e.date, rows: [e.text] });
  }
  return out;
}

// History (gym session 2): one row per exercise, the trend as plain numbers,
// tap to unfold the dated receipts. Gaps between dates are just gaps.
export default function HistoryScreen({ workouts, onBack }: { workouts: Workout[]; onBack: () => void }) {
  const rows = exerciseHistory(workouts);
  const [open, setOpen] = useState<string | null>(null);

  // THE `done` BLIND SPOT FIX (catalog §4.8): exerciseHistory skips done-kind
  // work entirely (it produces no number to rank), so without this a whole
  // category of real training -- cuff work, mobility, prehab -- never showed
  // up here at all. A plain count per name, newest-name-first is not tracked;
  // this is not a log, just "you've done this N times".
  const doneRows = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const w of workouts) {
      for (const ex of w.data.exercises) {
        if (ex.kind !== "done" || ex.skipped || seen.has(ex.name)) continue;
        if (!ex.sets.some((s) => s.done && !s.skipped)) continue;
        seen.add(ex.name);
        names.push(ex.name);
      }
    }
    return names.map((name) => ({ name, n: doneCount(workouts, name) }));
  }, [workouts]);

  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">History</div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state"><div className="empty-title">No Numbers Yet</div>
          {/* B14: not a button, because history is earned in the gym, but the
              bare title read as broken instead of as new. */}
          <div className="empty-sub">Log a set in any session and it shows up here</div></div>
      ) : (
        <div><div className="list-flat">
          {rows.map((r) => {
            const key = r.name + r.kind;
            const isOpen = open === key;
            return (
              <div key={key}>
                <div className="row" role="button" tabIndex={0} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : key)}>
                  <div className="row-grow">
                    <div className="conn-name truncate">{r.name}</div>
                    <div className="eyebrow">{trendLine(r)}</div>
                  </div>
                  {/* V2 anatomy: the session count is a pill, not prose. */}
                  <span className="pill pill-good">{r.sessions}</span>
                  {isOpen ? CHEV_DOWN : CHEV}
                </div>
                {isOpen && (() => {
                  // HOW IT MOVED (catalog §4.5): feeds history as a fact, once
                  // there is history to feed. Never shown collapsed -- it is
                  // detail, not a headline.
                  const fact = movedFact(workouts, r.name);
                  return fact ? <div className="pad-x"><div className="bp-sub">{fact}</div></div> : null;
                })()}
                {isOpen && groupByDay(r.entries).map((g) => (
                  <div key={g.day}>
                    <DayDivide label={monthDay(g.day)} />
                    {g.rows.map((text, i) => (
                      <div className="row" key={g.day + i}>
                        <div className="row-grow"><div className="conn-name">{text}</div></div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
        </div></div>
      )}

      {doneRows.length > 0 && (
        <>
          <div className="sh2"><span className="t">Done Work</span></div>
          <div><div className="list-flat">
            {doneRows.map((d) => (
              <div className="row" key={d.name}>
                <div className="row-grow">
                  <div className="conn-name truncate">{d.name}</div>
                  <div className="eyebrow">{d.n > 1 ? `Done ${d.n} times` : "Done"}</div>
                </div>
              </div>
            ))}
          </div></div>
        </>
      )}
      <div className="screen-foot" />
    </div>
  );
}

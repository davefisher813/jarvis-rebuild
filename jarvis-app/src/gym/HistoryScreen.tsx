import { useMemo } from "react";
import type { Workout, MeasureKind } from "./types";
import { exerciseHistory, trendLine, doneCount } from "./history";
import { liftSessions, chartValue } from "./chartData";
import { sameLiftAnyKind } from "./identity";

const CHEV = <div className="chev" />;

/** The door's own visual: a bare polyline of the last few sessions' values,
 *  no axis, no labels -- the row already says the trend in words (trendLine);
 *  this just makes "there's a chart in here" legible before you tap. */
function Sparkline({ workouts, name, exerciseKey, kind }: { workouts: Workout[]; name: string; exerciseKey?: string; kind: MeasureKind }) {
  const vals = useMemo(() => liftSessions(workouts, { name, exerciseKey }, kind).slice(-8).map(chartValue), [workouts, name, exerciseKey, kind]);
  if (vals.length < 2) return null;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const stepX = 44 / (vals.length - 1);
  const pts = vals.map((v, i) => `${(i * stepX).toFixed(1)},${(16 - ((v - min) / span) * 16).toFixed(1)}`).join(" ");
  return (
    <svg className="row-sparkline" viewBox="0 0 44 16" role="img" aria-label="Trend">
      <polyline points={pts} fill="none" stroke="var(--blue)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// History (gym session 2): one row per exercise, the trend as plain numbers.
// D9-A: the row itself is now the door to the lift's own chart, weekly
// bars, metric lane, goal, plateau and dated receipts (LiftDetailScreen) --
// what used to unfold inline here (the day-by-day list) lives there now, so
// there is one place a lift's whole story reads, not two. Gaps between
// dates are just gaps.
export default function HistoryScreen({ workouts, onBack, onOpenLift }: {
  workouts: Workout[]; onBack: () => void;
  // GYM-F-04 (2026-09-05): the key rides along so the lift detail derives the
  // lift's WHOLE history, across a rename, not just what its current name
  // happens to match.
  onOpenLift: (row: { name: string; exerciseKey?: string; kind: MeasureKind; unit?: string; timeUnit?: string }) => void;
}) {
  const rows = exerciseHistory(workouts);

  // THE `done` BLIND SPOT FIX (catalog §4.8): exerciseHistory skips done-kind
  // work entirely (it produces no number to rank), so without this a whole
  // category of real training -- cuff work, mobility, prehab -- never showed
  // up here at all. A plain count per name, newest-name-first is not tracked;
  // this is not a log, just "you've done this N times".
  const doneRows = useMemo(() => {
    // GYM-F-04: one row per LIFT, so a renamed piece of done work does not
    // show up twice; the row wears the newest name it was logged under.
    const rows: { name: string; exerciseKey?: string }[] = [];
    for (const w of workouts) {
      for (const ex of w.data.exercises) {
        if (ex.kind !== "done" || ex.skipped) continue;
        if (!ex.sets.some((s) => s.done && !s.skipped)) continue;
        const seen = rows.find((r) => sameLiftAnyKind(r, ex));
        if (seen) { seen.name = ex.name; if (ex.exerciseKey) seen.exerciseKey = ex.exerciseKey; continue; }
        rows.push({ name: ex.name, ...(ex.exerciseKey ? { exerciseKey: ex.exerciseKey } : {}) });
      }
    }
    return rows.map((r) => ({ name: r.name, key: r.exerciseKey ?? r.name, n: doneCount(workouts, r) }));
  }, [workouts]);

  return (
    <div className="screen ruled health-ruled">
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
        <>
        {/* THE TRAINING SURFACE ONTO THE RULINGS (2026-09-03): every list on a
            ruled screen is a card, and the two lists here read alike -- Done
            Work already had its head, so the lifts get theirs ("if one should,
            all should", the Schedule heads ruling). */}
        <div className="sh2 sh2-quiet"><span className="t">Lifts</span></div>
        <div className="pad-x"><div className="card list-card-ruled">
          {rows.map((r) => (
            <div className="row" role="button" tabIndex={0} key={(r.exerciseKey ?? r.name) + r.kind}
              onClick={() => onOpenLift({ name: r.name, exerciseKey: r.exerciseKey, kind: r.kind, unit: r.unit, timeUnit: r.timeUnit })}>
              <div className="row-grow">
                <div className="conn-name truncate">{r.name}</div>
                {/* Row meta is quiet sentence case app-wide (gym
                    reformat 2026-08-31); eyebrows are kickers, not
                    sublines. */}
                {/* KILL THE GREY SUBTEXT (Dave 2026-09-10): the trend is the
                    whole reason this row exists, so it wears the reading hue
                    rather than the same grey as the name above it. */}
                <div className="r-k"><span className="se-chip se-chip-last">{trendLine(r)}</span></div>
              </div>
              <Sparkline workouts={workouts} name={r.name} exerciseKey={r.exerciseKey} kind={r.kind} />
              {/* V2 anatomy: the session count is a pill, not prose. */}
              <span className="pill pill-good">{r.sessions}</span>
              {CHEV}
            </div>
          ))}
        </div></div>
        </>
      )}

      {doneRows.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Done Work</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {doneRows.map((d) => (
              <div className="row" key={d.key}>
                <div className="row-grow">
                  <div className="conn-name truncate">{d.name}</div>
                  <div className="r-k"><span className="se-chip se-chip-done">{d.n > 1 ? <>{d.n}<em>Times</em></> : "Done"}</span></div>
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

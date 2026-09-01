import { useMemo } from "react";
import type { Workout, MeasureKind } from "./types";
import { exerciseHistory, trendLine, doneCount } from "./history";
import { liftSessions, chartValue } from "./chartData";

const CHEV = <div className="chev" />;

/** The door's own visual: a bare polyline of the last few sessions' values,
 *  no axis, no labels -- the row already says the trend in words (trendLine);
 *  this just makes "there's a chart in here" legible before you tap. */
function Sparkline({ workouts, name, kind }: { workouts: Workout[]; name: string; kind: MeasureKind }) {
  const vals = useMemo(() => liftSessions(workouts, name, kind).slice(-8).map(chartValue), [workouts, name, kind]);
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
  onOpenLift: (row: { name: string; kind: MeasureKind; unit?: string; timeUnit?: string }) => void;
}) {
  const rows = exerciseHistory(workouts);

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
          {rows.map((r) => (
            <div className="row" role="button" tabIndex={0} key={r.name + r.kind}
              onClick={() => onOpenLift({ name: r.name, kind: r.kind, unit: r.unit, timeUnit: r.timeUnit })}>
              <div className="row-grow">
                <div className="conn-name truncate">{r.name}</div>
                {/* Row meta is quiet sentence case app-wide (gym
                    reformat 2026-08-31); eyebrows are kickers, not
                    sublines. */}
                <div className="conn-meta">{trendLine(r)}</div>
              </div>
              <Sparkline workouts={workouts} name={r.name} kind={r.kind} />
              {/* V2 anatomy: the session count is a pill, not prose. */}
              <span className="pill pill-good">{r.sessions}</span>
              {CHEV}
            </div>
          ))}
        </div></div>
      )}

      {doneRows.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Done Work</span></div>
          <div><div className="list-flat">
            {doneRows.map((d) => (
              <div className="row" key={d.name}>
                <div className="row-grow">
                  <div className="conn-name truncate">{d.name}</div>
                  <div className="conn-meta">{d.n > 1 ? `Done ${d.n} times` : "Done"}</div>
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

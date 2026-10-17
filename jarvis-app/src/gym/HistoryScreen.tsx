import { useMemo, useState } from "react";
import type { Workout, MeasureKind } from "./types";
import { exerciseHistory, trendLine, doneCount, sessionGroups } from "./history";
import { liftSessions, chartValue } from "./chartData";
import { sameLiftAnyKind } from "./identity";
import { monthDay } from "../money/bills";
import { liftTitle, lineCase, workoutTitle } from "../shared/casing";
import { spanLabel } from "../shared/duration";
import { durationOf } from "../insights/analytics";
import { todayISO } from "../tasks/grouping";
import SkeletonRows from "../shared/SkeletonRows";
import ActionSheet from "./ActionSheet";
import { isSessionPR } from "./prs";
import { Check } from "../shared/icons";

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
//
// Health Push E (H-32, Dave's picks 2026-09-12): a Lifts / Sessions control
// at the top. Lifts is this screen as it was; Sessions is every workout,
// newest first, grouped by the week it fell in, each row a door to that
// workout's own editor.
/** LOADING IS NOT EMPTY, AND A FAILED LOAD IS NOT EMPTY EITHER (Dave
 *  2026-09-27, on this screen reading "No Numbers Yet" over a full history:
 *  "My history is all gone too"). The gym's lists start empty and fill when
 *  the read lands, so an empty list means nothing until the read has
 *  answered. While it has not, this says it is loading; if it failed, it
 *  says the history did not load, that nothing was changed, and offers the
 *  retry. Shared with the program page, which had the same false empty. */
export function GymLoadState({ status, what, onRetry }: { status: "loading" | "failed"; what: "Your History" | "Your Training"; onRetry: () => void }) {
  // A load is the shimmer every other list uses (law L7), never an empty
  // state that says there is nothing here on a screen that does not know yet.
  if (status === "loading") {
    return <div className="pad-x" role="status" aria-label={`Loading ${what}`}><SkeletonRows /></div>;
  }
  return (
    <div className="empty-state" role="alert">
      <div className="empty-title">{what === "Your History" ? "Your History Didn't Load" : "Your Training Didn't Load"}</div>
      <div className="empty-sub">Nothing Was Changed · Check Your Connection</div>
      <button className="btn btn-primary" onClick={onRetry}>Try Again</button>
    </div>
  );
}

export default function HistoryScreen({ workouts, status = "ready", onRetry, onBack, onOpenLift, onOpenWorkout, onSameAsLastTime, onLogPast, mode: modeProp, onMode }: {
  workouts: Workout[]; onBack: () => void;
  /** Whether `workouts` is the answer yet (see GymLoadState). Defaults to
   *  ready for callers that hand in a list they already hold. */
  status?: "loading" | "failed" | "ready";
  onRetry?: () => void;
  // GYM-F-04 (2026-09-05): the key rides along so the lift detail derives the
  // lift's WHOLE history, across a rename, not just what its current name
  // happens to match.
  onOpenLift: (row: { name: string; exerciseKey?: string; kind: MeasureKind; unit?: string; timeUnit?: string }) => void;
  /** H-32: a session row opens that workout. Absent, the Sessions segment
   *  still lists them; the rows just do not open. */
  onOpenWorkout?: (workout: Workout) => void;
  /** 2026-09-13 (Dave's 18a): the host may hold the segment, so coming back
   *  from a workout opened under Sessions lands on Sessions. */
  mode?: "lifts" | "sessions";
  onMode?: (mode: "lifts" | "sessions") => void;
  /** TWO WAYS TO LOG, FROM HISTORY (Dave 2026-10-16, T): Same as Last Time
   *  and Log a Past Workout were reachable only from inside a program day.
   *  Both sit behind the nav bar's one Log action here, two taps from the
   *  screen that lists what was logged. Absent, the action is not drawn. */
  onSameAsLastTime?: () => void;
  onLogPast?: () => void;
}) {
  const [logOpen, setLogOpen] = useState(false);
  const [modeState, setModeState] = useState<"lifts" | "sessions">(modeProp ?? "lifts");
  const mode = modeProp ?? modeState;
  const setMode = (m: "lifts" | "sessions") => { setModeState(m); onMode?.(m); };
  const rows = exerciseHistory(workouts);
  const groups = useMemo(() => sessionGroups(workouts, todayISO()), [workouts]);
  /** GOLD MEANS A RECORD (the board, screen 4): the workouts in which a set
   *  beat every earlier session of its lift, judged against the history
   *  before that workout, the same read the session's PR mark makes. */
  const prWorkouts = useMemo(() => {
    const sorted = [...workouts].sort((a, b) => a.data.date.localeCompare(b.data.date) || a.data.startedAt - b.data.startedAt);
    const out = new Set<string>();
    sorted.forEach((w, i) => {
      const before = sorted.slice(0, i);
      for (const ex of w.data.exercises) {
        if (ex.skipped) continue;
        if (ex.sets.some((_, k) => isSessionPR(before, ex, ex.kind, ex.sets, k))) { out.add(w.id); break; }
      }
    });
    return out;
  }, [workouts]);
  /** Older months fold into one summary row until tapped (the board: "October · 29 Workouts"). */
  const [openMonths, setOpenMonths] = useState<Set<string>>(() => new Set());
  const toggleMonth = (label: string) => setOpenMonths((m) => { const n = new Set(m); if (n.has(label)) n.delete(label); else n.add(label); return n; });

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
    <div className="screen ruled health-ruled wo-screen">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">History</div>
        {(onSameAsLastTime || onLogPast) && (
          <button type="button" className="nav-action-text" onClick={() => setLogOpen(true)}>Log</button>
        )}
      </div>
      {logOpen && (
        <ActionSheet
          title="Log a Workout"
          actions={[
            ...(onSameAsLastTime ? [{ label: "Same as Last Time", onClick: onSameAsLastTime }] : []),
            ...(onLogPast ? [{ label: "Log a Past Workout", onClick: onLogPast }] : []),
          ]}
          onClose={() => setLogOpen(false)}
        />
      )}

      <div className="pad-x">
        <div className="segmented">
          <button type="button" className={"seg" + (mode === "lifts" ? " active" : "")} onClick={() => setMode("lifts")}>Exercises</button>
          <button type="button" className={"seg" + (mode === "sessions" ? " active" : "")} onClick={() => setMode("sessions")}>Workouts</button>
        </div>
      </div>

      {status !== "ready" && workouts.length === 0 ? (
        <GymLoadState status={status} what="Your History" onRetry={onRetry ?? (() => {})} />
      ) : mode === "sessions" ? (
        groups.length === 0 ? (
          <div className="empty-state"><div className="empty-title">No Workouts Yet</div>
            <div className="empty-sub">Finish a Workout and It Shows Up Here</div></div>
        ) : (
          groups.map((g) => {
            const week = g.label === "This Week" || g.label === "Last Week";
            const open = week || openMonths.has(g.label);
            return (
            <div key={g.label}>
              {/* A grey eyebrow over each group (the board, screen 4); the count is the month's own row. */}
              <div className="sh2 sh2-quiet"><span className="t">{g.label}</span></div>
              <div className="pad-x"><div className="card list-card-ruled">
                {!week && (
                  <div className="row" role="button" tabIndex={0} aria-expanded={open} onClick={() => toggleMonth(g.label)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleMonth(g.label); } }}>
                    <div className="row-grow"><div className="conn-name">{lineCase(`${g.rows.length} ${g.rows.length === 1 ? "workout" : "workouts"}`)}</div></div>
                    {CHEV}
                  </div>
                )}
                {open && g.rows.map((r) => (
                  <div className="row" role="button" tabIndex={0} key={r.workout.id} aria-label={"Open " + workoutTitle(r.workout.data.dayName) + " " + monthDay(r.date)}
                    onClick={() => onOpenWorkout?.(r.workout)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenWorkout?.(r.workout); } }}>
                    <div className="row-grow">
                      {/* ONE ROW SHAPE (the board): a green check (done), the name, a gold PR mark where a record fell,
                          then the date and the set count in the one grey, the length white on the right, the chevron. */}
                      <div className="conn-name truncate">
                        <Check className="ic hist-done" aria-label="Done" />
                        {workoutTitle(r.workout.data.dayName)}
                        {prWorkouts.has(r.workout.id) && <span className="se-pr">PR</span>}
                      </div>
                      <div className="facts">
                        <span className="fact date">{monthDay(r.date)}</span>
                        <span className="fact">{lineCase(`${r.sets} ${r.sets === 1 ? "set" : "sets"}`)}</span>
                        {durationOf(r.workout.data).flagged && <span className="fact">Worth Reviewing</span>}
                      </div>
                    </div>
                    {/* The length is a number with no state: white, flagged or not; the word for a flag is on the line (2026-10-16). */}
                    <div className="row-value"><span className="fact"><b>{spanLabel(durationOf(r.workout.data).flagged ? durationOf(r.workout.data).activeMin : r.minutes)}</b></span></div>
                    {onOpenWorkout && CHEV}
                  </div>
                ))}
              </div></div>
            </div>
            );
          })
        )
      ) : rows.length === 0 ? (
        <div className="empty-state"><div className="empty-title">No Numbers Yet</div>
          {/* B14: not a button, because history is earned in the gym, but the
              bare title read as broken instead of as new. */}
          <div className="empty-sub">Log a Set in Any Workout and It Shows Up Here</div></div>
      ) : (
        <>
        {/* THE TRAINING SURFACE ONTO THE RULINGS (2026-09-03): every list on a
            ruled screen is a card, and the two lists here read alike -- Done
            Work already had its head, so the lifts get theirs ("if one should,
            all should", the Schedule heads ruling). */}
        <div className="sh2 sh2-quiet"><span className="t">Exercises</span></div>
        <div className="pad-x"><div className="card list-card-ruled">
          {rows.map((r) => (
            <div className="row" role="button" tabIndex={0} key={(r.exerciseKey ?? r.name) + r.kind}
              onClick={() => onOpenLift({ name: r.name, exerciseKey: r.exerciseKey, kind: r.kind, unit: r.unit, timeUnit: r.timeUnit })}>
              <div className="row-grow">
                <div className="conn-name truncate">{liftTitle(r.name)}</div>
                {/* Row meta is quiet sentence case app-wide (gym
                    reformat 2026-08-31); eyebrows are kickers, not
                    sublines. */}
                {/* KILL THE GREY SUBTEXT (Dave 2026-09-10): the trend is the
                    whole reason this row exists, so it wears the reading hue
                    rather than the same grey as the name above it. */}
                <div className="facts"><span className="fact cyan">{trendLine(r)}</span></div>
              </div>
              <Sparkline workouts={workouts} name={r.name} exerciseKey={r.exerciseKey} kind={r.kind} />
              {/* The session count is a number with no state, so it is the key's white (§AM);
                  it wore the done green, which means done (Dave 2026-10-16). */}
              <div className="row-value"><span className="fact"><b>{r.sessions}</b></span></div>
              {CHEV}
            </div>
          ))}
        </div></div>
        </>
      )}

      {mode === "lifts" && doneRows.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Done Work</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {doneRows.map((d) => (
              <div className="row" key={d.key}>
                <div className="row-grow">
                  <div className="conn-name truncate">{liftTitle(d.name)}</div>
                  <div className="facts"><span className="fact lime">{d.n > 1 ? lineCase(`${d.n} times`) : "Done"}</span></div>
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

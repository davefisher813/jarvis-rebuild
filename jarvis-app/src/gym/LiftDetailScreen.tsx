import { useMemo, useState } from "react";
import { readHealthSettings } from "../health/settings";
import type { Workout, MeasureKind } from "./types";
import type { Goal } from "../life/types";
import { formatSet, inUnit, LB_PER_KG } from "./measures";
import { movedFact } from "./history";
import { liftSessions, chartValue, chartLabel, prIndexes, weeklySetCounts, weeklyVolume, daysAgo, e1rm } from "./chartData";
import { bestBefore } from "./prs";
import { plateauFlag, hardSetRows, volumeBreakdown, type MuscleMap } from "./insights";
import { liftMeasureState, type LiftMeasure } from "./goalMeasures";
import { activeMetrics, numericValue, type MetricDef, type MetricLog } from "./metrics";
import { MUSCLE_LABEL, type MuscleGroup } from "./muscles";
import { identityLine, valueLine, type Chip, type Classification } from "./classify";
import { capAfterNumber, liftTitle } from "../shared/casing";
import { agoPhrase, agoPhraseLower } from "./summary";
import { todayISO } from "../tasks/grouping";
import { shortDate } from "../shared/dateFormat";
import InsightEvidence from "../brain/InsightEvidence";
import { own, rowDoor } from "../shared/rowDoor";

const CHEV = <div className="chev" />;

// LIFT DETAIL, D9-A + D11-A + D12-A/C + D13-A/C (Training Catalog V2,
// approved 2026-08-31). One screen: the trend, the weekly work, an aligned
// metric lane on the SAME weekly axis (never a second axis on the trend
// chart itself -- two measures of different scale get two small charts, the
// oldest rule in the dataviz playbook), the goal riding the bar, the
// plateau card with a COMPUTED what-changed (never a guessed why), the
// published range row for this lift's own muscle, and the dated receipts.

const CHART_W = 300, CHART_H = 100, PAD = 10;
const WEEKS = 8;

function linePath(vals: number[]): { path: string; pts: { x: number; y: number }[] } {
  if (vals.length === 0) return { path: "", pts: [] };
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const flat = max === min; // every session equal: draw at mid-height, not
  // pinned to the floor (a flat line on the baseline read as "zero", live
  // render 2026-09-01).
  const stepX = vals.length > 1 ? (CHART_W - 2 * PAD) / (vals.length - 1) : 0;
  const pts = vals.map((v, i) => ({
    x: PAD + i * stepX,
    y: flat ? CHART_H / 2 : PAD + (CHART_H - 2 * PAD) * (1 - (v - min) / span),
  }));
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return { path, pts };
}

// Live-render audit 2026-09-01 (Dave's screenshot): a week axis where empty
// weeks render NOTHING collapses to one lone square floating in a blank
// card. Empty weeks now draw their own faint baseline tick, and a hairline
// base runs under all eight, so one logged week still reads as one week out
// of eight rather than as a rendering accident.
function Bars({ vals, tint }: { vals: number[]; tint: "blue" | "warn" }) {
  const max = Math.max(1, ...vals);
  return (
    <svg className="lift-bars" viewBox={`0 0 ${CHART_W} 36`} role="img" aria-label="Weekly bars">
      <line x1={PAD} y1={34.5} x2={CHART_W - PAD} y2={34.5} stroke="currentColor" opacity={0.1} />
      {vals.map((v, i) => {
        const w = (CHART_W - 2 * PAD) / vals.length;
        const h = v <= 0 ? 2 : Math.max(3, (v / max) * 28);
        return (
          <rect key={i} x={PAD + i * w + w * 0.15} y={34 - h} width={w * 0.7} height={h} rx={1.5}
            fill={tint === "blue" ? "var(--blue)" : "var(--warn)"} opacity={v > 0 ? 1 : 0.18} />
        );
      })}
    </svg>
  );
}

/** Each week's average of a metric's logged values, same rolling-from-now
 *  bucketing chartData.ts's own weeklySetCounts uses, so the lane lines up
 *  under the same bars. Presentation-only bucketing (the underlying reads --
 *  logOn, numericValue -- are the tested engine); undefined where a week
 *  has no logs at all rather than a fabricated zero. */
function weeklyMetricAvg(def: MetricDef, logs: MetricLog[], weeks: number, now: number): (number | undefined)[] {
  const out: number[][] = Array.from({ length: weeks }, () => []);
  for (const l of logs) {
    if (l.data.metricId !== def.id) continue;
    const days = daysAgo(l.data.date, now);
    const bucket = Math.floor(days / 7);
    if (bucket < 0 || bucket >= weeks) continue;
    const v = numericValue(def.data, l);
    if (v == null) continue;
    out[weeks - 1 - bucket]!.push(v);
  }
  return out.map((xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined));
}

export default function LiftDetailScreen({
  name, exerciseKey, kind, unit, timeUnit, workouts, muscleGroup, muscleMap, defs, logs, goal, onSetGoal,
  classification, onEditClass, onOpenLogs, note, onBack,
}: {
  name: string;
  /** GYM-F-04 (2026-09-05): the library key, so every derivation on this
   *  screen reads the lift's whole history rather than restarting at a
   *  rename. Absent for a lift logged before the library. */
  exerciseKey?: string;
  kind: MeasureKind;
  unit?: string;
  timeUnit?: string;
  workouts: Workout[];
  muscleGroup?: MuscleGroup;
  /** GYM-F-15 (2026-09-05): the PROGRAM's whole exercise-to-muscle map, the
   *  same one the Health page's range row is built from
   *  (insights.muscleMapFromProgram). Without it this screen could only count
   *  the one lift it is showing while labelling the number as the muscle's
   *  weekly total. */
  muscleMap?: MuscleMap;
  defs: MetricDef[];
  logs: MetricLog[];
  goal?: Goal;
  onSetGoal: () => void;
  /** WHAT THIS EXERCISE IS (2026-09-14, handoff §8: "Make classifications
   *  editable here and directly from the library using the same shared
   *  editor"). Optional so a caller with no classification wiring renders the
   *  page exactly as it did before. */
  classification?: Classification;
  onEditClass?: (open: Chip["field"]) => void;
  /** §7: "Not enough days yet renders as no line, never a guess" becomes
   *  "Not enough records" with a way to go and look at them. */
  onOpenLogs?: () => void;
  /** The note the athlete left on this exercise in the program. Read from the
   *  program by the caller: a logged WorkoutExercise carries no note field,
   *  and inventing one here would have meant a migration for a read. */
  note?: string;
  onBack: () => void;
}) {
  const now = Date.now();
  // GYM-F-04: one identity for every derivation on this screen.
  const lift = useMemo(() => ({ name, exerciseKey }), [name, exerciseKey]);
  const sessions = useMemo(() => liftSessions(workouts, lift, kind), [workouts, lift, kind]);
  // GYM-F-06 (2026-09-05): chartValue is in pounds so the line is continuous
  // across a unit change; the axis is shown in the unit this screen is in.
  const chartVals = useMemo(
    () => sessions.map((x) => (unit === "kg" ? Math.round(chartValue(x) / LB_PER_KG) : chartValue(x))),
    [sessions, unit],
  );
  /** A session's own top set, spoken in the unit this screen is showing. */
  const shownTop = (x: { top: import("./types").SetLog; unit?: string }) => inUnit(kind, x.top, x.unit, unit);
  const prs = useMemo(() => new Set(prIndexes(sessions, kind)), [sessions, kind]);
  const { path, pts } = useMemo(() => linePath(chartVals), [chartVals]);
  const setBars = useMemo(() => weeklySetCounts(workouts, lift, WEEKS, now), [workouts, lift, now]);
  const volBars = useMemo(() => weeklyVolume(workouts, lift, kind, WEEKS, now), [workouts, lift, kind, now]);
  const plateau = useMemo(() => plateauFlag(sessions, kind, lift, workouts), [sessions, kind, lift, workouts]);
  const shown = activeMetrics(defs);
  const [metricIdx, setMetricIdx] = useState(0);
  // Health Push E (H-34): the point he tapped, read out under the chart.
  const [sel, setSel] = useState<number | null>(null);
  const lane = shown[metricIdx];
  const laneVals = useMemo(() => (lane ? weeklyMetricAvg(lane, logs, WEEKS, now) : []), [lane, logs, now]);
  // GYM-F-15 (2026-09-05): this row is about the MUSCLE and cites a published
  // range that is about the muscle, so it has to sum every lift that trains
  // it, exactly as the Health page does. Counting only the lift on screen made
  // Incline Press read "Chest: 4 sets this week" against the Health page's own
  // "Chest 14", under-reporting the muscle against the range it names. The
  // lift's own entry is folded in on top of the program map so a lift since
  // renamed or removed from the plan still counts itself.
  const muscleRow = useMemo(() => {
    if (!muscleGroup) return null;
    const map = new Map(muscleMap ?? []);
    map.set(name, [muscleGroup]);
    // The band he set in Health Settings replaces the studied one here too
    // (Dave 2026-09-13), so the lift page and the Health page agree.
    const hb = readHealthSettings().volumeBand;
    const band = hb ? { ...hb, note: `Your band ${hb.low}-${hb.high} · Set in Health Settings`, source: "Your band, from Health Settings" } : undefined;
    return hardSetRows(workouts, map, now, band).find((r) => r.muscle === muscleGroup) ?? null;
  }, [muscleGroup, muscleMap, name, workouts, now]);
  /** This lift's own share of that total, so the row can say both numbers
   *  rather than leaving the athlete to wonder which one it means. */
  const liftShare = useMemo(() => {
    if (!muscleGroup) return 0;
    return hardSetRows(workouts, new Map([[name, [muscleGroup]]]), now)[0]?.sets ?? 0;
  }, [muscleGroup, name, workouts, now]);

  // §7: "A long performance sentence clipped mid-line" becomes three fields.
  // The change is the FIRST session's value against the LATEST, in the unit
  // this screen is showing, and the comparison period is the two dates that
  // produced it -- said out loud, because a change with no window behind it
  // is a number nobody can check.
  const change = useMemo(() => {
    if (chartVals.length < 2) return null;
    const first = chartVals[0]!;
    const latestV = chartVals[chartVals.length - 1]!;
    const delta = latestV - first;
    return { delta, from: first, to: latestV };
  }, [chartVals]);

  const goalState = goal?.data.measure?.kind === "lift" ? liftMeasureState(goal.data.measure as LiftMeasure, workouts) : null;

  const receipts = [...sessions].reverse().slice(0, 24);
  // BEST RECORDED SET (2026-09-14, the reference's Exercise progress page):
  // the one set that beat every other, its date, and how many sessions
  // stand behind it. The same bestBefore the PR mark reads, so the two can
  // never disagree. weight_reps also gets the Epley estimate, behind a row,
  // labelled as an estimate and never a suggested weight.
  const best = useMemo(() => bestBefore(workouts, lift, kind), [workouts, lift, kind]);
  const bestShown = best ? inUnit(kind, best.set, best.unit, unit) : null;
  const bestE1rm = kind === "weight_reps" && bestShown && bestShown.w != null && bestShown.r != null && bestShown.r > 0 ? e1rm(bestShown.w, bestShown.r) : null;
  const [e1rmOpen, setE1rmOpen] = useState(false);
  const [contribOpen, setContribOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  /** WHICH SETS MADE THAT NUMBER (§8: "View contributing sets"). The same
   *  breakdown the Health page's weekly volume row opens, so the two can
   *  never tell different stories about the same seven days. */
  const contributions = useMemo(() => {
    if (!muscleGroup) return [];
    const map = new Map(muscleMap ?? []);
    if (!map.has(name) && !(exerciseKey && map.has(exerciseKey))) map.set(name, [muscleGroup]);
    return volumeBreakdown(workouts, map, muscleGroup, now);
  }, [muscleGroup, muscleMap, name, exerciseKey, workouts, now]);
  /** The seven-day window the volume numbers cover, stated rather than
   *  implied by the words "this week". */
  const weekFrom = useMemo(() => {
    const d = new Date(now - 6 * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [now]);

  const celebrate = readHealthSettings().celebrations;
  const label = chartLabel(kind);
  const latest = chartVals.length ? chartVals[chartVals.length - 1]! : null;
  const todayIso = todayISO();

  return (
    <div className="screen ruled health-ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">{liftTitle(name)}</div>
        <span className="nav-action"></span>
      </div>

      {sessions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-title">No Numbers Yet</div>
          <div className="empty-sub">Log a set on this exercise and it shows up here</div>
        </div>
      ) : (
        <>
          {/* Live-render audit 2026-09-01: one session drew a giant empty
              plot around a single dot pinned to a corner, headlined by an
              e1RM that read as a contradiction of the PR below it. A line
              needs two points; until then the card states the facts and
              says when the chart starts. */}
          <div className="sh2 sh2-quiet"><span className="t">Performance and History</span></div>
          {best && bestShown && (
            <>
              <div className="pad-x"><div className="card pad">
                {/* THREE FIELDS, NOT A SENTENCE (§7). Best set, what it has
                    changed by, and the window that comparison covers -- each
                    one labelled, each one wrapping rather than clipping. */}
                <div className="row">
                  <div className="row-grow">
                    <div className="ex-cells">
                      <div className="ex-cell">
                        <div className="ex-cell-n">{formatSet({ kind, unit, timeUnit }, bestShown)}</div>
                        <div className="ex-cell-k">Best Set</div>
                      </div>
                      {change && (
                        <div className="ex-cell">
                          <div className="ex-cell-n">{`${change.delta > 0 ? "+" : ""}${Math.round(change.delta * 10) / 10}${unit ? " " + unit : ""}`}</div>
                          <div className="ex-cell-k">Change</div>
                        </div>
                      )}
                      <div className="ex-cell">
                        <div className="ex-cell-n">{sessions.length}</div>
                        <div className="ex-cell-k">{sessions.length === 1 ? "Session" : "Sessions"}</div>
                      </div>
                    </div>
                    <div className="facts">
                      <span className="fact cyan">{`Best on ${shortDate(best.date)}`}</span>
                      <span className="fact date">{`${shortDate(sessions[0]!.date)} to ${shortDate(sessions[sessions.length - 1]!.date)}`}</span>
                    </div>
                  </div>
                  {celebrate && <span className="se-pr">PR</span>}
                </div>
                {bestE1rm != null && (
                  <>
                    <div className="ins-acts">
                      <button type="button" className="pill-act pill-quiet" aria-expanded={e1rmOpen} onClick={() => setE1rmOpen((o) => !o)}>{e1rmOpen ? "Hide the Estimate" : "Estimated One-Rep Max"}</button>
                    </div>
                    {e1rmOpen && (
                      <div className="facts">
                        <span className="fact est">{`${bestE1rm}${unit ? " " + unit : ""}`}</span>
                        <span className="fact">Epley estimate, not a tested lift or a suggested weight</span>
                      </div>
                    )}
                  </>
                )}
              </div></div>
            </>
          )}
          <div className="sh2 sh2-quiet"><span className="t">Trend</span></div>
          {sessions.length < 2 ? (
            <div className="pad-x"><div className="card list-card-ruled">
              <div className="row">
                <div className="row-grow">
                  <div className="conn-name">Best so far · {formatSet({ kind, unit, timeUnit }, shownTop(sessions[sessions.length - 1]!))}</div>
                  <div className="conn-meta">{label} {latest != null ? `${latest}${unit ? " " + unit : ""}` : "--"} · logged {agoPhraseLower(sessions[sessions.length - 1]!.date, todayIso)}</div>
                </div>
              </div>
              <div className="row"><div className="row-grow"><div className="conn-meta">The trend line starts at your second session</div></div></div>
            </div></div>
          ) : (
            <div className="pad-x"><div className="card pad banner-blue">
              <div className="row-stack">
                {/* H-31 / H-34: the unit joins the caption. */}
                <div className="conn-meta">{label}{unit ? " · " + unit : ""}</div>
                {/* The latest number is white (§AM: a number with no state).
                    For weight_reps it is the Epley estimate, so it wears the
                    estimate primitive (sky); .fact has no size of its own and
                    takes the headline's. */}
                <div className="p3-q">{latest == null
                  ? "--"
                  : kind === "weight_reps"
                    ? <span className="fact est">{`${latest}${unit ? " " + unit : ""}`}</span>
                    : `${latest}${unit ? " " + unit : ""}`}</div>
              </div>
              <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="lift-chart" role="img"
                aria-label={`${name} ${label} trend over ${sessions.length} sessions`}>
                <line x1={PAD} y1={CHART_H - PAD} x2={CHART_W - PAD} y2={CHART_H - PAD} stroke="currentColor" opacity={0.12} />
                {path && <path d={path} fill="none" stroke="var(--blue)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
                {pts.map((p, i) => prs.has(i) ? (
                  <circle key={i} cx={p.x} cy={p.y} r={4} fill="var(--good)" />
                ) : null)}
                {/* H-34: the tapped point, in the reading hue. */}
                {sel != null && pts[sel] && <circle cx={pts[sel]!.x} cy={pts[sel]!.y} r={4.5} fill="var(--hl-cyan)" />}
                {/* Each point has a hit area wider than its dot, and answers
                    the keyboard; no axes are drawn (H-34). */}
                {pts.map((p, i) => (
                  <circle key={"h" + i} cx={p.x} cy={p.y} r={10} fill="transparent" role="button" tabIndex={0}
                    aria-label={`Session ${i + 1} of ${pts.length}`} onClick={() => setSel(i)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel(i); } }} />
                ))}
              </svg>
              {sel != null && sessions[sel] && (
                <div className="facts">
                  {/* THREE FACTS, THREE SPANS (2026-09-16). One span carrying
                      two middots of its own is a sentence with punctuation in
                      it; components.css draws the separator so no string has
                      to. The hue stays on the date, which is the datum the
                      tapped point is about. */}
                  <span className="fact cyan">{shortDate(sessions[sel]!.date)}</span>
                  <span className="fact">{formatSet({ kind, unit, timeUnit }, shownTop(sessions[sel]!))}</span>
                  <span className="fact">{`${kind === "weight_reps" ? "Est" : "Best"} ${chartVals[sel]}${unit ? " " + unit : ""}`}</span>
                </div>
              )}
              {/* Three facts in one grey run-on, and the two that matter --
                  how many sessions and how many bests -- were at the end of
                  it. Chips, aligned, the PR count in the ramp's lime. */}
              <div className="se-chips">
                <span className="se-chip se-chip-when">{agoPhrase(sessions[0]!.date, todayIso)} to {agoPhraseLower(sessions[sessions.length - 1]!.date, todayIso)}</span>
                <span className="se-chip se-chip-last">{sessions.length}<em>Sessions</em></span>
                {prs.size > 0 && readHealthSettings().celebrations && <span className="se-chip se-chip-best">{prs.size}<em>{prs.size === 1 ? "PR" : "PRs"}</em></span>}
              </div>
            </div></div>
          )}

          <div className="sh2 sh2-quiet"><span className="t">Weekly Work</span></div>
          <div className="pad-x"><div className="card pad">
            <Bars vals={setBars} tint="blue" />
            <div className="conn-meta">Working sets, last {WEEKS} weeks</div>
            {volBars && (
              <>
                <Bars vals={volBars.map((v) => v)} tint="warn" />
                <div className="conn-meta">{unit ?? "lb"} moved, last {WEEKS} weeks</div>
              </>
            )}
          </div></div>

          {shown.length > 0 && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Aligned With</span></div>
              <div className="pad-x"><div className="card pad">
                <div className="chip-row">
                  {shown.map((d, i) => (
                    <div key={d.id} className={"chip" + (i === metricIdx ? " active" : "")} role="button" tabIndex={0} onClick={() => setMetricIdx(i)}>{d.data.name}</div>
                  ))}
                </div>
                {lane && <Bars vals={laneVals.map((v) => v ?? 0)} tint="blue" />}
                {/* §7: the old caption explained the app's own honesty rule in
                    grey, mid-card. The rule has not changed; it just says the
                    fact instead of the policy, and offers the logs. */}
                {lane && (
                  // The row opens the logs, same as its pill (Dave 2026-09-15: "I want all rows clickable").
                  <div className="row" {...(onOpenLogs ? rowDoor(onOpenLogs) : {})}>
                    <div className="row-grow">
                      <div className="conn-meta">{`${lane.data.name}, same ${WEEKS} weeks`}</div>
                      {laneVals.every((v) => v == null) && <div className="facts"><span className="fact">Not enough records</span></div>}
                    </div>
                    {/* A TEXT ACTION, NOT A CAPSULE (2026-09-16, polish rule
                        2, which names this family by name: View Sets, View
                        Sleep Logs). It only ever navigated to the records
                        behind the lane, and a .pill-act is this app's word for
                        a verb that acts on the row it sits in. The rest of
                        this family became .see-all in September; this one was
                        missed. */}
                    {onOpenLogs && <button type="button" className="see-all" onClick={own(onOpenLogs)}>View Logs</button>}
                  </div>
                )}
              </div></div>
            </>
          )}

          <div className="sh2 sh2-quiet"><span className="t">Goals</span></div>
          {goal && goalState ? (
            /* GYM-F-28 (2026-09-05): the goal card was a flat panel, so a goal
               set here could only be changed from Bigger Picture. It opens the
               same sheet that made it, now in edit mode. */
            <div className="pad-x"><div className={"card pad " + (goalState.met ? "banner-good" : "banner-yellow")}
              role="button" tabIndex={0} aria-label="Edit Goal" onClick={onSetGoal}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSetGoal(); } }}>
              <div className="row-stack">
                <div className="conn-name">{goal.data.title}</div>
                <div className="conn-meta">{goalState.line}</div>
              </div>
              <div className="bp-bar"><div className="bp-bar-fill" style={{ width: `${goalState.pct}%`, background: goalState.met ? "var(--good)" : "var(--cat-yellow)" }} /></div>
              {goalState.met && <span className="pill pill-good">Goal</span>}
            </div></div>
          ) : (
            <div className="pad-x"><div className="card list-card-ruled">
              {/* §7: the old sub explained the three goal types in grey on a
                  row that could not set any of them. The action is the row,
                  and the type is picked inside the sheet it opens. */}
              <div className="row" role="button" tabIndex={0} onClick={onSetGoal}>
                <div className="row-grow"><div className="conn-name">Set Goal</div></div>
                {CHEV}
              </div>
            </div></div>
          )}

          {plateau && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Plateau</span></div>
              <div className="pad-x"><div className="card list-card-ruled banner-warn">
                <div className="row">
                  <div className="row-grow">
                    <div className="conn-name">{capAfterNumber(`${plateau.flatSessions} sessions with no new best`)}</div>
                    <div className="conn-meta">Best was {plateau.peakValue} on {plateau.peakDate} · Now {plateau.currentValue}</div>
                  </div>
                </div>
                {plateau.whatChanged.length > 0 && (
                  // Bare .eyebrow, not .grp: inside a card the .grp kicker
                  // paints itself accent-red, and red is a verb, not a label.
                  <div className="row"><div className="row-grow"><div className="eyebrow">What Changed</div></div></div>
                )}
                {plateau.whatChanged.map((r) => (
                  <div className="row" key={r.label}>
                    <div className="row-grow"><div className="conn-name">{r.label}</div></div>
                    <div className="conn-meta">{r.moving}{r.unit ? ` ${r.unit}` : ""} to {r.flat}{r.unit ? ` ${r.unit}` : ""}</div>
                  </div>
                ))}
                <div className="row"><div className="row-grow"><div className="conn-meta">Correlation, not cause</div></div></div>
                <div className="row"><div className="row-grow"><InsightEvidence evidence={plateau.evidence} /></div></div>
              </div></div>
            </>
          )}

          {/* CLASSIFICATION (§8). The same shared editor the library opens,
              reached from the same chips, so the two surfaces cannot drift
              into two different answers. */}
          {classification && onEditClass && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Classification</span></div>
              <div className="pad-x"><div className="card list-card-ruled">
                {([
                  { field: "muscles" as const, label: "Muscles" },
                  { field: "equipment" as const, label: "Equipment" },
                  { field: "measure" as const, label: "Measurement" },
                  { field: "movement" as const, label: "Movement" },
                  { field: "type" as const, label: "Type" },
                  { field: "execution" as const, label: "Execution" },
                  { field: "tag" as const, label: "Tags" },
                ]).map((f) => {
                  const v = valueLine(classification, f.field);
                  return (
                    <div className="row" key={f.field} role="button" tabIndex={0}
                      onClick={() => onEditClass(f.field)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEditClass(f.field); } }}>
                      <div className="row-grow">
                        <div className="conn-name">{f.label}</div>
                        {v
                          ? <div className="facts"><span className="fact">{v}</span></div>
                          : <div className="facts"><span className={"fact" + (f.field === "muscles" ? " amber" : "")}>{f.field === "muscles" ? "Assign muscles" : "Not set"}</span></div>}
                      </div>
                      {CHEV}
                    </div>
                  );
                })}
              </div></div>
            </>
          )}

          {/* MUSCLE VOLUME (§8: "show separate values such as Back: 17
              working sets. This exercise: 8 sets. Explicit date range. View
              contributing sets").

              WORKING sets, never the harder word (§8's own last line).
              Nothing in this app records whether a set was taken anywhere near
              failure, so the harder word would assert a fact the records do
              not carry. Warm-ups and drops are excluded, which the app does
              know, and the published range keeps its own wording where it is
              cited, as research rather than as a total. */}
          {muscleRow && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Muscle Volume</span></div>
              <div className="pad-x"><div className="card pad">
                <div className="ex-cells">
                  <div className="ex-cell">
                    <div className="ex-cell-n">{muscleRow.sets}</div>
                    <div className="ex-cell-k">{`${MUSCLE_LABEL[muscleRow.muscle]} Working Sets`}</div>
                  </div>
                  <div className="ex-cell">
                    <div className="ex-cell-n">{liftShare}</div>
                    <div className="ex-cell-k">This Exercise</div>
                  </div>
                </div>
                <div className="facts">
                  <span className="fact cyan">{`${shortDate(weekFrom)} to ${shortDate(todayIso)}`}</span>
                  <span className="fact">Warm-ups and drop sets left out</span>
                </div>
                {contributions.length > 0 && (
                  <>
                    <div className="ins-acts">
                      <button type="button" className="pill-act pill-quiet" aria-expanded={contribOpen}
                        onClick={() => setContribOpen((o) => !o)}>
                        {contribOpen ? "Hide Contributing Sets" : "View Contributing Sets"}
                      </button>
                    </div>
                    {contribOpen && contributions.map((v, i) => (
                      <div className="row" key={v.name + v.date + i}>
                        <div className="row-grow">
                          <div className="conn-name">{v.name}</div>
                          <div className="facts">
                            <span className="fact cyan">{shortDate(v.date)}</span>
                            <span className="fact">{v.primary ? "Primary" : "Secondary, counted half"}</span>
                          </div>
                        </div>
                        <div className="conn-meta">{`${v.sets} ${v.sets === 1 ? "set" : "sets"}`}</div>
                      </div>
                    ))}
                  </>
                )}
                {/* RESEARCH, KEPT SEPARATE FROM THE RECORDED TOTAL (§8). */}
                <div className="ins-acts">
                  <button type="button" className="pill-act pill-quiet" aria-expanded={rangeOpen}
                    onClick={() => setRangeOpen((o) => !o)}>
                    {rangeOpen ? "Hide Evidence and Calculation" : "Evidence and Calculation"}
                  </button>
                </div>
                {rangeOpen && (
                  <div className="facts">
                    <span className="fact">{muscleRow.range.note}</span>
                    <span className="fact">{muscleRow.range.source}</span>
                    <span className="fact">A primary muscle counts a whole set, a secondary counts half. This app's counting rule, not the cited work's.</span>
                  </div>
                )}
              </div></div>
            </>
          )}

          {/* NOTES AND EQUIPMENT (§8's fifth section). The machine's own
              identity, and the most recent note the athlete left on this
              exercise in a session. */}
          {(classification && (identityLine(classification) || valueLine(classification, "execution"))) || note ? (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Notes and Equipment</span></div>
              <div className="pad-x"><div className="card list-card-ruled">
                {classification && identityLine(classification) && (
                  <div className="row"><div className="row-grow">
                    <div className="conn-name">Equipment Identity</div>
                    <div className="facts"><span className="fact">{identityLine(classification)}</span></div>
                  </div></div>
                )}
                {classification && valueLine(classification, "execution") && (
                  <div className="row"><div className="row-grow">
                    <div className="conn-name">Execution</div>
                    <div className="facts"><span className="fact">{valueLine(classification, "execution")}</span></div>
                  </div></div>
                )}
                {note && (
                  <div className="row"><div className="row-grow">
                    <div className="conn-name">Note</div>
                    <div className="conn-meta">{note}</div>
                  </div></div>
                )}
              </div></div>
            </>
          ) : null}

          {/* MILESTONES (2026-09-14): the first session and the best set, dated. */}
          <div className="sh2 sh2-quiet"><span className="t">Milestones</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            <div className="row">
              <div className="row-grow"><div className="conn-name">First Session</div><div className="facts"><span className="fact cyan">{shortDate(sessions[0]!.date)}</span></div></div>
            </div>
            {best && bestShown && (
              <div className="row">
                <div className="row-grow"><div className="conn-name">{`Best ${formatSet({ kind, unit, timeUnit }, bestShown)}`}</div><div className="facts"><span className="fact cyan">{shortDate(best.date)}</span></div></div>
              </div>
            )}
          </div></div>

          <div className="sh2 sh2-quiet"><span className="t">Sessions</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {(() => {
              // HOW IT MOVED (catalog §4.5): a fact once there is history to
              // feed, never a headline. Lives INSIDE the card now: floating
              // between a head and a card it read as a stray line (live
              // screenshot, 2026-09-01).
              const fact = movedFact(workouts, lift);
              return fact ? <div className="row"><div className="row-grow"><div className="conn-meta">{fact}</div></div></div> : null;
            })()}
            {receipts.map((s) => (
              // GYM-F-30 (2026-09-05): keyed by the workout, not the date --
              // two sessions can land on one day.
              <div className="row" key={s.workoutId}>
                <div className="row-grow">
                  <div className="conn-name">{formatSet({ kind, unit, timeUnit }, shownTop(s))}</div>
                  <div className="conn-meta">{agoPhrase(s.date, todayIso)}</div>
                </div>
                {prs.has(sessions.indexOf(s)) && <span className="pill pill-good">PR</span>}
              </div>
            ))}
          </div></div>
        </>
      )}
    </div>
  );
}

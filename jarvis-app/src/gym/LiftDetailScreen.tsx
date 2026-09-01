import { useMemo, useState } from "react";
import type { Workout, MeasureKind } from "./types";
import type { Goal } from "../life/types";
import { formatSet } from "./measures";
import { movedFact } from "./history";
import { liftSessions, chartValue, chartLabel, prIndexes, weeklySetCounts, weeklyVolume, daysAgo } from "./chartData";
import { plateauFlag, hardSetRows } from "./insights";
import { liftMeasureState, type LiftMeasure } from "./goalMeasures";
import { activeMetrics, numericValue, type MetricDef, type MetricLog } from "./metrics";
import { MUSCLE_LABEL, type MuscleGroup } from "./muscles";
import { capAfterNumber } from "../shared/casing";
import { agoPhrase, agoPhraseLower } from "./summary";
import { todayISO } from "../tasks/grouping";

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
  name, kind, unit, timeUnit, workouts, muscleGroup, defs, logs, goal, onSetGoal, onBack,
}: {
  name: string;
  kind: MeasureKind;
  unit?: string;
  timeUnit?: string;
  workouts: Workout[];
  muscleGroup?: MuscleGroup;
  defs: MetricDef[];
  logs: MetricLog[];
  goal?: Goal;
  onSetGoal: () => void;
  onBack: () => void;
}) {
  const now = Date.now();
  const sessions = useMemo(() => liftSessions(workouts, name, kind), [workouts, name, kind]);
  const chartVals = useMemo(() => sessions.map(chartValue), [sessions]);
  const prs = useMemo(() => new Set(prIndexes(sessions, kind)), [sessions, kind]);
  const { path, pts } = useMemo(() => linePath(chartVals), [chartVals]);
  const setBars = useMemo(() => weeklySetCounts(workouts, name, WEEKS, now), [workouts, name, now]);
  const volBars = useMemo(() => weeklyVolume(workouts, name, kind, WEEKS, now), [workouts, name, kind, now]);
  const plateau = useMemo(() => plateauFlag(sessions, kind, name, workouts), [sessions, kind, name, workouts]);
  const shown = activeMetrics(defs);
  const [metricIdx, setMetricIdx] = useState(0);
  const lane = shown[metricIdx];
  const laneVals = useMemo(() => (lane ? weeklyMetricAvg(lane, logs, WEEKS, now) : []), [lane, logs, now]);
  const muscleRow = useMemo(() => {
    if (!muscleGroup) return null;
    const map = new Map([[name, muscleGroup]]);
    return hardSetRows(workouts, map, now)[0] ?? null;
  }, [muscleGroup, name, workouts, now]);

  const goalState = goal?.data.measure?.kind === "lift" ? liftMeasureState(goal.data.measure as LiftMeasure, workouts) : null;

  const receipts = [...sessions].reverse().slice(0, 24);
  const label = chartLabel(kind);
  const latest = chartVals.length ? chartVals[chartVals.length - 1]! : null;
  const todayIso = todayISO();

  return (
    <div className="screen train-skin">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">{name}</div>
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
          <div className="sh2 sh2-quiet"><span className="t">Trend</span></div>
          {sessions.length < 2 ? (
            <div className="pad-x"><div className="card">
              <div className="row">
                <div className="row-grow">
                  <div className="conn-name">Best so far · {formatSet({ kind, unit, timeUnit }, sessions[sessions.length - 1]!.top)}</div>
                  <div className="conn-meta">{label} {latest != null ? `${latest}${unit ? " " + unit : ""}` : "--"} · logged {agoPhraseLower(sessions[sessions.length - 1]!.date, todayIso)}</div>
                </div>
              </div>
              <div className="row"><div className="row-grow"><div className="conn-meta">The trend line starts at your second session</div></div></div>
            </div></div>
          ) : (
            <div className="pad-x"><div className="card pad banner-blue">
              <div className="row-stack">
                <div className="conn-meta">{label}</div>
                <div className="p3-q blue">{latest != null ? `${latest}${unit ? " " + unit : ""}` : "--"}</div>
              </div>
              <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="lift-chart" role="img"
                aria-label={`${name} ${label} trend over ${sessions.length} sessions`}>
                <line x1={PAD} y1={CHART_H - PAD} x2={CHART_W - PAD} y2={CHART_H - PAD} stroke="currentColor" opacity={0.12} />
                {path && <path d={path} fill="none" stroke="var(--blue)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
                {pts.map((p, i) => prs.has(i) ? (
                  <circle key={i} cx={p.x} cy={p.y} r={4} fill="var(--good)" />
                ) : null)}
              </svg>
              <div className="conn-meta">{agoPhrase(sessions[0]!.date, todayIso)} to {agoPhraseLower(sessions[sessions.length - 1]!.date, todayIso)} · {sessions.length} sessions · {prs.size} PR{prs.size === 1 ? "" : "s"}</div>
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
                {lane && <div className="conn-meta">{lane.data.name}, same {WEEKS} weeks · Not enough days yet renders as no line, never a guess</div>}
              </div></div>
            </>
          )}

          <div className="sh2 sh2-quiet"><span className="t">Goal</span></div>
          {goal && goalState ? (
            <div className="pad-x"><div className={"card pad " + (goalState.met ? "banner-good" : "banner-yellow")}>
              <div className="row-stack">
                <div className="conn-name">{goal.data.title}</div>
                <div className="conn-meta">{goalState.line}</div>
              </div>
              <div className="bp-bar"><div className="bp-bar-fill" style={{ width: `${goalState.pct}%`, background: goalState.met ? "var(--good)" : "var(--cat-yellow)" }} /></div>
              {goalState.met && <span className="pill pill-good">Goal</span>}
            </div></div>
          ) : (
            <div className="pad-x"><div className="card">
              <div className="row" role="button" tabIndex={0} onClick={onSetGoal}>
                <div className="row-grow"><div className="conn-name">Set a Goal on This Lift</div><div className="conn-meta">A weight, a rep count, or a time to clear</div></div>
                {CHEV}
              </div>
            </div></div>
          )}

          {plateau && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Plateau</span></div>
              <div className="pad-x"><div className="card banner-warn">
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
              </div></div>
            </>
          )}

          {muscleRow && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Weekly Hard Sets · {MUSCLE_LABEL[muscleRow.muscle]}</span></div>
              <div className="pad-x"><div className="card">
                <div className="row">
                  <div className="row-grow"><div className="conn-name">{muscleRow.sets} sets this week</div><div className="conn-meta">{muscleRow.range.note}</div></div>
                </div>
                <div className="row"><div className="row-grow"><div className="conn-meta">{muscleRow.range.source}</div></div></div>
              </div></div>
            </>
          )}

          <div className="sh2 sh2-quiet"><span className="t">Sessions</span></div>
          <div className="pad-x"><div className="card">
            {(() => {
              // HOW IT MOVED (catalog §4.5): a fact once there is history to
              // feed, never a headline. Lives INSIDE the card now: floating
              // between a head and a card it read as a stray line (live
              // screenshot, 2026-09-01).
              const fact = movedFact(workouts, name);
              return fact ? <div className="row"><div className="row-grow"><div className="conn-meta">{fact}</div></div></div> : null;
            })()}
            {receipts.map((s) => (
              <div className="row" key={s.date}>
                <div className="row-grow">
                  <div className="conn-name">{formatSet({ kind, unit, timeUnit }, s.top)}</div>
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

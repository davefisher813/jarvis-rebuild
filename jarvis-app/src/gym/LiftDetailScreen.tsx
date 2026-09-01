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
  const stepX = vals.length > 1 ? (CHART_W - 2 * PAD) / (vals.length - 1) : 0;
  const pts = vals.map((v, i) => ({
    x: PAD + i * stepX,
    y: PAD + (CHART_H - 2 * PAD) * (1 - (v - min) / span),
  }));
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return { path, pts };
}

function Bars({ vals, tint }: { vals: number[]; tint: "blue" | "warn" }) {
  const max = Math.max(1, ...vals);
  return (
    <svg className="lift-bars" viewBox={`0 0 ${CHART_W} 36`} role="img" aria-label="Weekly bars">
      {vals.map((v, i) => {
        const w = (CHART_W - 2 * PAD) / vals.length;
        const h = v <= 0 ? 0 : Math.max(2, (v / max) * 28);
        return (
          <rect key={i} x={PAD + i * w + w * 0.15} y={34 - h} width={w * 0.7} height={h} rx={2}
            fill={tint === "blue" ? "var(--blue)" : "var(--warn)"} opacity={v > 0 ? 1 : 0.15} />
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

  return (
    <div className="screen">
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
        <div className="pad-x">
          <div className="card pad banner-blue">
            <div className="row-stack">
              <div className="conn-meta">{label}</div>
              <div className="p3-q blue">{latest != null ? `${latest}${unit ? " " + unit : ""}` : "--"}</div>
            </div>
            <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="lift-chart" role="img"
              aria-label={`${name} ${label} trend over ${sessions.length} sessions`}>
              {path && <path d={path} fill="none" stroke="var(--blue)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
              {pts.map((p, i) => prs.has(i) ? (
                <circle key={i} cx={p.x} cy={p.y} r={4} fill="var(--good)" />
              ) : null)}
            </svg>
            <div className="conn-meta">{sessions[0]!.date} to {sessions[sessions.length - 1]!.date} · {prs.size} PR{prs.size === 1 ? "" : "s"}</div>
          </div>

          <div className="grp"><div className="eyebrow">Weekly Work</div></div>
          <div className="card pad">
            <Bars vals={setBars} tint="blue" />
            <div className="conn-meta">Working sets, last {WEEKS} weeks</div>
            {volBars && (
              <>
                <Bars vals={volBars.map((v) => v)} tint="warn" />
                <div className="conn-meta">{unit ?? "lb"} moved, last {WEEKS} weeks</div>
              </>
            )}
          </div>

          {shown.length > 0 && (
            <>
              <div className="grp"><div className="eyebrow">Aligned With</div></div>
              <div className="card pad">
                <div className="chip-row">
                  {shown.map((d, i) => (
                    <div key={d.id} className={"chip" + (i === metricIdx ? " active" : "")} role="button" tabIndex={0} onClick={() => setMetricIdx(i)}>{d.data.name}</div>
                  ))}
                </div>
                {lane && <Bars vals={laneVals.map((v) => v ?? 0)} tint="blue" />}
                {lane && <div className="conn-meta">{lane.data.name}, same {WEEKS} weeks · Not enough days yet renders as no line, never a guess</div>}
              </div>
            </>
          )}

          <div className="grp"><div className="eyebrow">Goal</div></div>
          {goal && goalState ? (
            <div className={"card pad " + (goalState.met ? "banner-good" : "banner-yellow")}>
              <div className="row-stack">
                <div className="conn-name">{goal.data.title}</div>
                <div className="conn-meta">{goalState.line}</div>
              </div>
              <div className="bp-bar"><div className="bp-bar-fill" style={{ width: `${goalState.pct}%`, background: goalState.met ? "var(--good)" : "var(--cat-yellow)" }} /></div>
              {goalState.met && <span className="pill pill-good">Goal</span>}
            </div>
          ) : (
            <div className="card">
              <div className="row" role="button" tabIndex={0} onClick={onSetGoal}>
                <div className="row-grow"><div className="conn-name">Set a Goal on This Lift</div><div className="conn-meta">A weight, a rep count, or a time to clear</div></div>
                {CHEV}
              </div>
            </div>
          )}

          {plateau && (
            <>
              <div className="grp"><div className="eyebrow">Plateau</div></div>
              <div className="card banner-warn">
                <div className="row">
                  <div className="row-grow">
                    <div className="conn-name">{capAfterNumber(`${plateau.flatSessions} sessions with no new best`)}</div>
                    <div className="conn-meta">Best was {plateau.peakValue} on {plateau.peakDate} · Now {plateau.currentValue}</div>
                  </div>
                </div>
                {plateau.whatChanged.length > 0 && (
                  <div className="grp"><div className="eyebrow">What Changed</div></div>
                )}
                {plateau.whatChanged.map((r) => (
                  <div className="row" key={r.label}>
                    <div className="row-grow"><div className="conn-name">{r.label}</div></div>
                    <div className="conn-meta">{r.moving}{r.unit ? ` ${r.unit}` : ""} to {r.flat}{r.unit ? ` ${r.unit}` : ""}</div>
                  </div>
                ))}
                <div className="row"><div className="row-grow"><div className="conn-meta">Correlation, not cause</div></div></div>
              </div>
            </>
          )}

          {muscleRow && (
            <>
              <div className="grp"><div className="eyebrow">Weekly Hard Sets · {MUSCLE_LABEL[muscleRow.muscle]}</div></div>
              <div className="card">
                <div className="row">
                  <div className="row-grow"><div className="conn-name">{muscleRow.sets} sets this week</div><div className="conn-meta">{muscleRow.range.note}</div></div>
                </div>
                <div className="row"><div className="row-grow"><div className="conn-meta">{muscleRow.range.source}</div></div></div>
              </div>
            </>
          )}

          <div className="grp"><div className="eyebrow">Sessions</div></div>
          {(() => {
            // HOW IT MOVED (catalog §4.5): a fact once there is history to
            // feed, never a headline -- quiet, above the dated list.
            const fact = movedFact(workouts, name);
            return fact ? <div className="conn-meta">{fact}</div> : null;
          })()}
          <div className="card">
            {receipts.map((s) => (
              <div className="row" key={s.date}>
                <div className="row-grow">
                  <div className="conn-name">{formatSet({ kind, unit, timeUnit }, s.top)}</div>
                  <div className="conn-meta">{s.date}</div>
                </div>
                {prs.has(sessions.indexOf(s)) && <span className="pill pill-good">PR</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

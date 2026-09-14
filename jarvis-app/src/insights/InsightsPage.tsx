import { useMemo, useState, type ReactNode } from "react";
import type { Workout } from "../gym/types";
import type { MetricDef, MetricLog } from "../gym/metrics";
import { activeMetrics } from "../gym/metrics";
import { chartableExercises } from "../gym/chartData";
import { MUSCLE_LABEL } from "../gym/muscles";
import type { MuscleMap } from "../gym/insights";
import type { CallItEntry, PointAtItEntry, MealEntry, TookItEntry, CheckInEntry } from "../health/types";
import { monthDay } from "../money/bills";
import { pressable } from "../shared/pressable";
import { capAfterNumber } from "../shared/casing";
import { FileText } from "../shared/icons";
import HealthNav, { type HealthView } from "./HealthNav";
import { periodFor, periodOverview, muscleBreakdown, liftTable, hoursLabel, weekdayShort, inPeriod, type RangeKey, type Period } from "./analytics";
import { comparableGain, type LiftId, type RepGain } from "./findings";
import type { DataCategory } from "./records";

// INSIGHTS (the approved Health design, 2026-09-14, items 3 to 7). A real
// page: the period (7, 28, 90 days or two dates) drives every card that
// reads the period; a card that reads a different span says so on its
// face. Overview leads with the best comparable change, where the sets
// went (with the unassigned sets shown, never dropped) and sleep over the
// nights logged. Strength is any exercise's sessions, sets and comparable
// trend, with the chart's table beside it. The third section is the
// tracked metrics and the health logs as records: values, dates, counts,
// gaps. Nothing here claims a cause, and nothing invents a value for a day
// with no log.

export type InsightsSection = "overview" | "strength" | "rest";

export interface HealthLogsInput {
  callIt: CallItEntry[];
  pointAtIt: PointAtItEntry[];
  meals: MealEntry[];
  tookIt: TookItEntry[];
  checkins: CheckInEntry[];
}

const CHEV = <div className="chev" />;
const CW = 300, CH = 90, PAD = 12;

function localDay(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The comparable sessions behind a gain, oldest first, for the chart. */
function gainSeries(workouts: Workout[], g: RepGain): { workoutId: string; date: string; w: number }[] {
  const rows = liftTable(workouts, g.lift).slice().reverse();
  const out: { workoutId: string; date: string; w: number }[] = [];
  for (const r of rows) {
    const w = workouts.find((x) => x.id === r.workoutId);
    const ex = w?.data.exercises.find((e) => (g.lift.exerciseKey ? e.exerciseKey === g.lift.exerciseKey : e.name === g.lift.name));
    if (!ex) continue;
    const best = Math.max(...ex.sets.filter((s) => !s.skipped && !s.warmup && !s.drop && s.r === g.reps && s.w != null).map((s) => s.w!), -Infinity);
    if (Number.isFinite(best)) out.push({ workoutId: r.workoutId, date: r.date, w: best });
  }
  return out;
}

export default function InsightsPage({
  view, onView, today, workouts, metricDefs, metricLogs, logs, muscleMap, cards,
  onOpenLift, onOpenWorkout, onOpenAllData, onAssignMuscles, onExport,
}: {
  view: HealthView;
  onView: (v: HealthView) => void;
  today: string;
  workouts: Workout[];
  metricDefs: MetricDef[];
  metricLogs: MetricLog[];
  logs: HealthLogsInput;
  muscleMap: MuscleMap;
  /** The evidence cards (Weekly Volume, plateaus, correlations, the
   *  lighter week), built by the caller from the same records. */
  cards: ReactNode;
  onOpenLift: (lift: LiftId) => void;
  onOpenWorkout: (id: string) => void;
  onOpenAllData: (category: DataCategory | "all", period: Period) => void;
  onAssignMuscles: (untagged: { name: string; exerciseKey?: string; sets: number }[]) => void;
  onExport: (period: Period) => void;
}) {
  const [range, setRange] = useState<RangeKey>("7d");
  const [custom, setCustom] = useState({ from: periodFor("28d", today).from, to: today });
  const [section, setSection] = useState<InsightsSection>("overview");
  const period = periodFor(range, today, custom);
  const sleepDef = metricDefs.find((d) => d.data.presetKey === "sleep" && !d.data.hidden) ?? null;
  const overview = useMemo(() => periodOverview(workouts, sleepDef, metricLogs, period), [workouts, sleepDef, metricLogs, period]);
  const breakdown = useMemo(() => muscleBreakdown(workouts, muscleMap, period), [workouts, muscleMap, period]);
  const lifts = useMemo(() => chartableExercises(workouts), [workouts]);
  const [liftIdx, setLiftIdx] = useState(0);
  const lift = lifts[liftIdx] ?? null;
  // The headline: the best comparable change on a lift trained in the period.
  const headline = useMemo(() => {
    let best: RepGain | null = null;
    for (const ex of lifts) {
      if (ex.kind !== "weight_reps") continue;
      const g = comparableGain(workouts, ex);
      if (!g || !inPeriod(g.to.date, period)) continue;
      if (!best || g.sessions > best.sessions || (g.sessions === best.sessions && Math.abs(g.delta) > Math.abs(best.delta))) best = g;
    }
    return best;
  }, [lifts, workouts, period]);
  const series = useMemo(() => (headline ? gainSeries(workouts, headline) : []), [workouts, headline]);
  const empty = workouts.length === 0 && metricLogs.length === 0 && logs.callIt.length + logs.pointAtIt.length + logs.meals.length + logs.tookIt.length + logs.checkins.length === 0;
  const rangeLabel = `${monthDay(period.from)} to ${monthDay(period.to)}`;
  const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "-" : "") + Math.abs(n);

  const chart = (pts: { date: string; w: number; workoutId: string }[], unit: string) => {
    if (pts.length < 2) return null;
    const min = Math.min(...pts.map((p) => p.w)), max = Math.max(...pts.map((p) => p.w));
    const span = max - min || 1;
    const stepX = (CW - 2 * PAD) / (pts.length - 1);
    const xy = pts.map((p, i) => ({ x: PAD + i * stepX, y: PAD + (CH - 2 * PAD) * (1 - (p.w - min) / span) }));
    const path = xy.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    return (
      <svg viewBox={`0 0 ${CW} ${CH + 16}`} className="ins-chart" role="img" aria-label={`Best set at this rep count over ${pts.length} sessions, in ${unit}`}>
        <line x1={PAD} y1={CH - PAD} x2={CW - PAD} y2={CH - PAD} stroke="currentColor" opacity={0.12} />
        <path d={path} fill="none" stroke="var(--hl-lime)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {xy.map((p, i) => (
          <g key={pts[i]!.workoutId}>
            <circle cx={p.x} cy={p.y} r={4} fill="var(--hl-lime)" />
            <circle cx={p.x} cy={p.y} r={11} fill="transparent" role="button" tabIndex={0} aria-label={`${monthDay(pts[i]!.date)}, ${pts[i]!.w} ${unit}, open the session`}
              onClick={() => onOpenWorkout(pts[i]!.workoutId)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenWorkout(pts[i]!.workoutId); } }} />
            <text x={p.x} y={CH + 10} textAnchor="middle" className="ins-axis">{monthDay(pts[i]!.date)}</text>
          </g>
        ))}
      </svg>
    );
  };

  const rangeChips = (
    <div className="pad-x">
      <div className="chip-row chip-wrap-row" role="group" aria-label="Period">
        {(["7d", "28d", "90d", "custom"] as RangeKey[]).map((k) => (
          <div key={k} {...pressable(() => setRange(k))} className={"chip" + (range === k ? " active" : "")} aria-pressed={range === k}>
            {k === "7d" ? "7 Days" : k === "28d" ? "28 Days" : k === "90d" ? "90 Days" : "Custom"}
          </div>
        ))}
        <span className="fact ins-range">{rangeLabel}</span>
      </div>
      {range === "custom" && (
        <div className="ins-dates">
          <input className="input" type="date" aria-label="From" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
          <input className="input" type="date" aria-label="Through" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
        </div>
      )}
    </div>
  );

  const sleepCard = (
    <div className="pad-x"><div className="card ins-card">
      <div className="ins-head">
        <span className="ins-dot hue-hl-violet" />
        <span className="ins-t">Sleep</span>
        <span className="fact">{rangeLabel}</span>
      </div>
      {overview.sleep.nights === 0 ? (
        <div className="facts"><span className="fact">No night logged in this period</span></div>
      ) : (
        <>
          <div className="ins-big violet">{hoursLabel(overview.sleep.avgHours!)}</div>
          <div className="facts"><span className="fact">{`Average across ${overview.sleep.nights} logged ${overview.sleep.nights === 1 ? "night" : "nights"} of ${period.days}`}</span></div>
          {period.days <= 28 && (
            <div className="ins-nights" role="img" aria-label={`${overview.sleep.nights} of ${period.days} nights logged`}>
              {overview.sleep.byDay.map((d) => (
                <div key={d.date} className={"ins-night" + (d.hours != null ? " on" : "")} title={d.hours != null ? `${monthDay(d.date)} · ${hoursLabel(d.hours)}` : `${monthDay(d.date)} · Not logged`}>
                  <i />{period.days <= 7 ? weekdayShort(d.date) : ""}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <div className="ins-acts">
        <button type="button" className="pill-act pill-quiet" onClick={() => onOpenAllData("sleep", period)}>View Sleep Logs</button>
      </div>
    </div></div>
  );

  const musclesCard = (
    <div className="pad-x"><div className="card ins-card">
      <div className="ins-head">
        <span className="ins-dot hue-hl-lime" />
        <span className="ins-t">Where Your Sets Went</span>
        <span className="fact">{rangeLabel}</span>
      </div>
      {breakdown.total === 0 ? (
        <div className="facts"><span className="fact">No working sets in this period</span></div>
      ) : (
        <>
          {breakdown.rows.map((r) => (
            <div className="ins-bar" key={r.muscle}>
              <span className="ins-bar-k">{MUSCLE_LABEL[r.muscle]}</span>
              <span className="ins-bar-track"><i className="lime" style={{ width: `${Math.min(100, (r.sets / Math.max(1, breakdown.total)) * 100)}%` }} /></span>
              <span className="fact lime">{Number.isInteger(r.sets) ? r.sets : r.sets.toFixed(1)}</span>
            </div>
          ))}
          {breakdown.unassigned > 0 && (
            <div className="ins-bar">
              <span className="ins-bar-k">Unassigned</span>
              <span className="ins-bar-track"><i className="amber" style={{ width: `${Math.min(100, (breakdown.unassigned / Math.max(1, breakdown.total)) * 100)}%` }} /></span>
              <span className="fact amber">{breakdown.unassigned}</span>
            </div>
          )}
          <div className="facts">
            <span className="fact">{`${breakdown.assigned} of ${breakdown.total} working sets mapped`}</span>
            <span className="fact">First muscle whole, the rest half · The app's convention</span>
          </div>
          <div className="ins-acts">
            {breakdown.unassigned > 0 && <button type="button" className="pill-act" onClick={() => onAssignMuscles(breakdown.untagged)}>Assign Muscles</button>}
            <button type="button" className="pill-act pill-quiet" onClick={() => onOpenAllData("sets", period)}>View Sets</button>
          </div>
        </>
      )}
    </div></div>
  );

  const headlineCard = headline ? (
    <div className="pad-x"><div className="card ins-card">
      <div {...pressable(() => onOpenLift(headline.lift))} className="ins-head">
        <span className="ins-dot hue-hl-lime" />
        <span className="ins-t">{headline.lift.name}</span>
        {CHEV}
      </div>
      <div className="facts"><span className="fact">{`Best set at ${headline.reps} reps`}</span></div>
      <div className="ins-big lime">{`${headline.to.w} ${headline.lift.unit ?? "lb"}`}</div>
      <div className="facts">
        <span className="fact lime">{`${sign(headline.delta)} ${headline.lift.unit ?? "lb"} since ${monthDay(headline.from.date)}`}</span>
        <span className="fact">{`${headline.sessions} comparable sessions`}</span>
      </div>
      {chart(series, headline.lift.unit ?? "lb")}
      <details className="ins-table">
        <summary>As a List</summary>
        <table>
          <thead><tr><th>Date</th><th>{`Best at ${headline.reps} reps`}</th></tr></thead>
          <tbody>{series.map((p) => <tr key={p.workoutId}><td>{monthDay(p.date)}</td><td>{`${p.w} ${headline.lift.unit ?? "lb"}`}</td></tr>)}</tbody>
        </table>
      </details>
      <div className="facts"><span className="fact">Same exercise, same equipment, same unit, same rep count · Spans the sessions, not only this period</span></div>
      <div className="ins-acts"><button type="button" className="pill-act pill-quiet" onClick={() => onOpenLift(headline.lift)}>View Sets</button></div>
    </div></div>
  ) : null;

  const strength = (
    <>
      {lifts.length === 0 ? (
        <div className="empty-state"><div className="empty-title">No Sets Logged Yet</div><div className="empty-sub">A logged session puts its lifts here</div></div>
      ) : (
        <>
          <div className="pad-x">
            <div className="chip-row chip-wrap-row" role="group" aria-label="Exercise">
              {lifts.map((l, i) => (
                <div key={(l.exerciseKey ?? l.name) + l.kind} {...pressable(() => setLiftIdx(i))} className={"chip" + (i === liftIdx ? " active" : "")} aria-pressed={i === liftIdx}>{l.name}</div>
              ))}
            </div>
          </div>
          {lift && (() => {
            const table = liftTable(workouts, lift);
            const g = lift.kind === "weight_reps" ? comparableGain(workouts, lift) : null;
            const pts = g ? gainSeries(workouts, g) : [];
            const inRange = table.filter((r) => inPeriod(r.date, period));
            return (
              <>
                <div className="pad-x"><div className="card ins-card">
                  <div className="ins-head"><span className="ins-dot hue-hl-lime" /><span className="ins-t">{lift.name}</span></div>
                  <div className="facts">
                    <span className="fact lime">{`${inRange.length} ${inRange.length === 1 ? "session" : "sessions"} in the period`}</span>
                    <span className="fact">{capAfterNumber(`${table.length} recorded in all`)}</span>
                  </div>
                  {g ? (
                    <>
                      <div className="facts">
                        <span className="fact lime">{`${sign(g.delta)} ${lift.unit ?? "lb"} at ${g.reps} reps`}</span>
                        <span className="fact">{`${monthDay(g.from.date)} to ${monthDay(g.to.date)} · ${g.sessions} comparable sessions`}</span>
                      </div>
                      {chart(pts, lift.unit ?? "lb")}
                    </>
                  ) : (
                    <div className="facts"><span className="fact">No two sessions at the same rep count, equipment and unit yet, so no comparison is claimed</span></div>
                  )}
                  <div className="ins-acts"><button type="button" className="pill-act pill-quiet" onClick={() => onOpenLift(lift)}>Open Exercise Page</button></div>
                </div></div>
                <div className="sh2 sh2-quiet"><span className="t">Sessions</span><span className="n">{table.length}</span></div>
                <div className="pad-x"><div className="card list-card-ruled">
                  {table.map((r) => (
                    <div {...pressable(() => onOpenWorkout(r.workoutId))} className="row" key={r.workoutId}>
                      <div className="row-grow">
                        <div className="conn-name">{monthDay(r.date)}</div>
                        <div className="facts">
                          <span className="fact lime">{`${r.working} working`}</span>
                          <span className="fact">{r.sets.join(", ")}</span>
                        </div>
                      </div>
                      {CHEV}
                    </div>
                  ))}
                </div></div>
              </>
            );
          })()}
        </>
      )}
    </>
  );

  // The third section: every tracked thing as records, with its gaps.
  const restRows = (() => {
    const rows: { key: string; title: string; hue: string; value: string; context: string; category: DataCategory }[] = [];
    const daysIn = (dates: string[]) => new Set(dates.filter((d) => inPeriod(d, period))).size;
    for (const def of activeMetrics(metricDefs)) {
      const mine = metricLogs.filter((l) => l.data.metricId === def.id && inPeriod(l.data.date, period) && (l.data.value != null || l.data.yes != null));
      const latest = mine.sort((a, b) => a.data.date.localeCompare(b.data.date))[mine.length - 1];
      const days = daysIn(mine.map((l) => l.data.date));
      const value = !latest ? "Not logged" : def.data.type === "yesno" ? (latest.data.yes ? "Yes" : "No") : `${latest.data.value}${def.data.type === "scale5" ? "/5" : def.data.unit ? " " + def.data.unit : ""}`;
      const isSleep = def.data.presetKey === "sleep";
      rows.push({ key: def.id, title: def.data.name, hue: isSleep ? "violet" : "cyan", value, context: latest ? `Latest ${monthDay(latest.data.date)} · ${days} of ${period.days} days logged · ${period.days - days} without a log` : `No log in ${period.days} days`, category: isSleep ? "sleep" : def.data.presetKey === "bodyweight" ? "body" : "other" });
    }
    const effort = logs.callIt.filter((e) => inPeriod(localDay(e.data.at), period));
    if (effort.length) rows.push({ key: "effort", title: "Session Effort", hue: "cyan", value: `${effort[effort.length - 1]!.data.rpe}/10 latest`, context: capAfterNumber(`${effort.length} rated ${effort.length === 1 ? "session" : "sessions"} · ${daysIn(effort.map((e) => localDay(e.data.at)))} days`), category: "effort" });
    const sore = logs.pointAtIt.filter((e) => inPeriod(localDay(e.data.at), period));
    if (sore.length) rows.push({ key: "discomfort", title: "Discomfort", hue: "pink", value: `${sore.length} ${sore.length === 1 ? "entry" : "entries"}`, context: [...new Set(sore.map((e) => e.data.region).filter(Boolean))].join(", ") || "Spots on the map", category: "effort" });
    const meals = logs.meals.filter((e) => inPeriod(localDay(e.data.at), period));
    if (meals.length) rows.push({ key: "meals", title: "Meals", hue: "amber", value: capAfterNumber(`${meals.length} logged`), context: `${daysIn(meals.map((e) => localDay(e.data.at)))} of ${period.days} days`, category: "nutrition" });
    const doses = logs.tookIt.filter((e) => inPeriod(localDay(e.data.at), period));
    if (doses.length) rows.push({ key: "doses", title: "Medication", hue: "hblue", value: `${doses.length} ${doses.length === 1 ? "dose" : "doses"} logged`, context: `${daysIn(doses.map((e) => localDay(e.data.at)))} of ${period.days} days`, category: "medication" });
    const checks = logs.checkins.filter((e) => inPeriod(localDay(e.data.at), period));
    if (checks.length) rows.push({ key: "checkins", title: "Check Ins", hue: "cyan", value: capAfterNumber(`${checks.length} logged`), context: `${daysIn(checks.map((e) => localDay(e.data.at)))} of ${period.days} days`, category: "checkins" });
    return rows;
  })();
  const rest = (
    <>
      {sleepCard}
      {restRows.length === 0 ? (
        <div className="empty-state"><div className="empty-title">Nothing Tracked in This Period</div><div className="empty-sub">Sleep, effort, discomfort, meals, doses and your metrics list here as they are logged</div></div>
      ) : (
        <div className="pad-x"><div className="card list-card-ruled">
          {restRows.map((r) => (
            <div {...pressable(() => onOpenAllData(r.category, period))} className="row" key={r.key}>
              <div className="row-grow">
                <div className="conn-name">{r.title}</div>
                <div className="facts"><span className={"fact " + r.hue}>{r.value}</span><span className="fact">{r.context}</span></div>
              </div>
              {CHEV}
            </div>
          ))}
        </div></div>
      )}
      <div className="pad-x"><div className="facts"><span className="fact">Records, dates and counts only · Nothing here reads a cause into a coincidence</span></div></div>
    </>
  );

  return (
    <>
      <HealthNav view={view} onView={onView} />
      <div className="nav-large">See What Is Changing</div>
      {rangeChips}
      <div className="pad-x">
        <div className="segmented" role="tablist" aria-label="Insights sections">
          {(["overview", "strength", "rest"] as InsightsSection[]).map((s) => (
            <button type="button" role="tab" aria-selected={section === s} className={"seg" + (section === s ? " active" : "")} key={s} onClick={() => setSection(s)}>
              {s === "overview" ? "Overview" : s === "strength" ? "Strength" : "Rest and Readings"}
            </button>
          ))}
        </div>
      </div>
      {empty ? (
        <div className="empty-state"><div className="empty-title">Nothing Logged Yet</div><div className="empty-sub">Finish a workout or log a night of sleep and the numbers start here</div></div>
      ) : section === "overview" ? (
        <>
          {headlineCard ?? (
            <div className="pad-x"><div className="card ins-card">
              <div className="ins-head"><span className="ins-dot hue-hl-lime" /><span className="ins-t">Strength</span></div>
              <div className="facts"><span className="fact">No comparable change to show: two sessions at the same rep count, equipment and unit are what it takes</span></div>
            </div></div>
          )}
          {musclesCard}
          {sleepCard}
          {cards}
        </>
      ) : section === "strength" ? strength : rest}
      <div className="pad-x h-foot-acts">
        <button type="button" className="btn btn-secondary" onClick={() => onOpenAllData("all", period)}><FileText className="ic" />All Data</button>
        <button type="button" className="btn btn-secondary" onClick={() => onExport(period)}>Export Data</button>
      </div>
      <div className="screen-foot" />
    </>
  );
}

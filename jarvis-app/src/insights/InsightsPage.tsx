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
import { PickSheet } from "../gym/ActionSheet";
import { FileText } from "../shared/icons";
import HealthNav, { type HealthView } from "./HealthNav";
import { periodFor, periodOverview, muscleBreakdown, liftTable, hoursLabel, weekdayShort, inPeriod, type RangeKey, type Period } from "./analytics";
import { comparableGain, type LiftId, type RepGain } from "./findings";
import type { DataCategory } from "./records";

// INSIGHTS (the approved Health design, 2026-09-14, items 3 to 7). A real
// page: the period (7, 30, 90 days or two dates) drives every card that
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
// THE DATE LABELS FIT, OR THEY ARE NOT DRAWN (2026-09-16, the polish handoff
// asks for a check on clipped chart labels; the arithmetic says they were).
//
// Two ways this broke, both of them measurable rather than a matter of taste:
//
//  1. THE ENDS. Every label was textAnchor="middle", and the first and last
//     points sit at x = PAD and x = CW - PAD. "Sep 16" is about 32 user units
//     wide, so half of it hung 4 units past each edge of the viewBox and the
//     SVG clipped it. The end labels anchor to their own edge now.
//  2. THE MIDDLE. With eight or more sessions the points are closer together
//     than a date is wide, so the labels overlapped into a grey smear. Only
//     labels that clear their neighbour are drawn, and the last session always
//     is: which sessions those are changes with the count, but every label on
//     screen is readable, which is the whole job of an axis.
//
// LABEL_W is deliberately generous (--type-scale goes to 1.4, and these are
// SVG user units that scale with it), because an axis that omits one date is
// fine and an axis that prints two on top of each other is not.
const LABEL_W = 46;

/** The indices whose date is drawn: the last session always, then backwards
 *  while each one clears the one after it. Takes the real x of every point,
 *  because they are not evenly spaced (see chartX below). */
export function axisTicks(xs: number[]): number[] {
  if (xs.length <= 1) return xs.length === 1 ? [0] : [];
  const keep = [xs.length - 1];
  for (let i = xs.length - 2; i >= 0; i--) {
    if (xs[keep[keep.length - 1]!]! - xs[i]! >= LABEL_W) keep.push(i);
  }
  return keep.reverse();
}

/** WHERE A SESSION SITS ON THE AXIS (2026-09-16, the polish handoff: "Use real
 *  temporal spacing and preserve multiple points with identical dates; do not
 *  misrepresent repeated Aug 24 entries as separate evenly spaced dates").
 *
 *  The chart spaced its points by INDEX, so a lift trained twice on one
 *  morning and then not again for six weeks drew three evenly spaced dots and
 *  read as steady fortnightly progress. That is the chart inventing a shape
 *  the data does not have, which is the one thing a chart must not do.
 *
 *  x is the day itself now. Two sessions on one date land on one x and stack
 *  by their weight, which is what actually happened: two readings, one day.
 *  A set of points that all share a date has no span to scale, so they sit
 *  together in the middle rather than dividing by zero.
 *
 *  `dates` are ISO days, oldest first. */
export function chartX(dates: string[], w = CW, pad = PAD): number[] {
  const day = (d: string) => Date.parse(d + "T00:00:00Z") / 86_400_000;
  const ds = dates.map(day);
  const first = ds[0] ?? 0, last = ds[ds.length - 1] ?? 0;
  const span = last - first;
  const inner = w - 2 * pad;
  if (!Number.isFinite(span) || span <= 0) return ds.map(() => pad + inner / 2);
  return ds.map((d) => pad + (inner * (d - first)) / span);
}

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
  const [custom, setCustom] = useState({ from: periodFor("30d", today).from, to: today });
  const [section, setSection] = useState<InsightsSection>("overview");
  const period = periodFor(range, today, custom);
  const sleepDef = metricDefs.find((d) => d.data.presetKey === "sleep" && !d.data.hidden) ?? null;
  const overview = useMemo(() => periodOverview(workouts, sleepDef, metricLogs, period), [workouts, sleepDef, metricLogs, period]);
  const breakdown = useMemo(() => muscleBreakdown(workouts, muscleMap, period), [workouts, muscleMap, period]);
  const lifts = useMemo(() => chartableExercises(workouts), [workouts]);
  /** Which picker is open, or none. Two cards on this page choose a lift and
   *  they choose independently, so the flag says which one asked. */
  const [picking, setPicking] = useState<"overview" | "strength" | null>(null);
  const [liftIdx, setLiftIdx] = useState(0);
  const lift = lifts[liftIdx] ?? null;
  /** THE OVERVIEW CARD IS A CHOICE, NOT ONLY A VERDICT (Dave 2026-09-18: "I
   *  have no way to select exercises").
   *
   *  It picked the biggest comparable change and showed it, full stop: the
   *  one exercise on the page you could not change. The pick is still the
   *  default -- it is a good answer to "what is changing" and it is what the
   *  card is for -- but it is a default now, and null means it. */
  const [ovIdx, setOvIdx] = useState<number | null>(null);
  // The headline: the best comparable change on a lift trained in the period.
  const autoHeadline = useMemo(() => {
    let best: RepGain | null = null;
    for (const ex of lifts) {
      if (ex.kind !== "weight_reps") continue;
      const g = comparableGain(workouts, ex);
      if (!g || !inPeriod(g.to.date, period)) continue;
      if (!best || g.sessions > best.sessions || (g.sessions === best.sessions && Math.abs(g.delta) > Math.abs(best.delta))) best = g;
    }
    return best;
  }, [lifts, workouts, period]);
  /** The lift the overview card is about: the chosen one, or the auto pick.
   *  A chosen lift is NOT gated on the period the way the auto pick is --
   *  you asked for that exercise, so the card spans its sessions and says so
   *  on its face, exactly as it already did for the automatic one. */
  const ovLift = ovIdx != null ? lifts[ovIdx] ?? null : autoHeadline?.lift ?? null;
  const headline = useMemo(() => {
    if (ovIdx == null) return autoHeadline;
    const ex = lifts[ovIdx];
    return ex && ex.kind === "weight_reps" ? comparableGain(workouts, ex) : null;
  }, [ovIdx, lifts, workouts, autoHeadline]);
  const series = useMemo(() => (headline ? gainSeries(workouts, headline) : []), [workouts, headline]);
  /** The overview picker's options: the default first, then every chartable
   *  lift. "Biggest Gain" is a real row rather than a Clear button, because
   *  it is one of the answers, not the absence of one. */
  const ovPickItems = [{ id: "auto", label: "Biggest Gain" }, ...lifts.map((l, i) => ({ id: String(i), label: l.name }))];
  const ovPick = (ids: string[]) => {
    const id = ids[0];
    if (id === "auto") setOvIdx(null);
    else { const i = Number(id); if (Number.isFinite(i)) setOvIdx(i); }
    setPicking(null);
  };
  const empty = workouts.length === 0 && metricLogs.length === 0 && logs.callIt.length + logs.pointAtIt.length + logs.meals.length + logs.tookIt.length + logs.checkins.length === 0;
  const rangeLabel = `${monthDay(period.from)} to ${monthDay(period.to)}`;
  const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "-" : "") + Math.abs(n);

  const chart = (pts: { date: string; w: number; workoutId: string }[], unit: string) => {
    if (pts.length < 2) return null;
    const min = Math.min(...pts.map((p) => p.w)), max = Math.max(...pts.map((p) => p.w));
    const span = max - min || 1;
    const xs = chartX(pts.map((p) => p.date));
    const xy = pts.map((p, i) => ({ x: xs[i]!, y: PAD + (CH - 2 * PAD) * (1 - (p.w - min) / span) }));
    const path = xy.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const ticks = new Set(axisTicks(xs));
    return (
      <svg viewBox={`0 0 ${CW} ${CH + 16}`} className="ins-chart" role="img" aria-label={`Best set at this rep count over ${pts.length} sessions, in ${unit}`}>
        <line x1={PAD} y1={CH - PAD} x2={CW - PAD} y2={CH - PAD} stroke="currentColor" opacity={0.12} />
        <path d={path} fill="none" stroke="var(--hl-lime)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {xy.map((p, i) => (
          <g key={pts[i]!.workoutId}>
            <circle cx={p.x} cy={p.y} r={4} fill="var(--hl-lime)" />
            <circle cx={p.x} cy={p.y} r={11} fill="transparent" role="button" tabIndex={0} aria-label={`${monthDay(pts[i]!.date)}, ${pts[i]!.w} ${unit}, open the session`}
              onClick={() => onOpenWorkout(pts[i]!.workoutId)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenWorkout(pts[i]!.workoutId); } }} />
            {ticks.has(i) && (
              <text x={p.x} y={CH + 10} className="ins-axis"
                textAnchor={p.x <= PAD + 1 ? "start" : p.x >= CW - PAD - 1 ? "end" : "middle"}>
                {monthDay(pts[i]!.date)}
              </text>
            )}
          </g>
        ))}
      </svg>
    );
  };

  const rangeChips = (
    <div className="pad-x">
      <div className="chip-row chip-wrap-row" role="group" aria-label="Period">
        {(["7d", "30d", "90d", "custom"] as RangeKey[]).map((k) => (
          <div key={k} {...pressable(() => setRange(k))} className={"chip" + (range === k ? " active" : "")} aria-pressed={range === k}>
            {k === "7d" ? "7 Days" : k === "30d" ? "30 Days" : k === "90d" ? "90 Days" : "Custom"}
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

  // SAID ONCE, AT THE TOP (2026-09-16, the polish handoff: "No repeated full
  // date range on every card when shared section heading is sufficient"). The
  // period chips above already print the range, and then every card head
  // printed it again, so one screen said "Sep 10 to Sep 16" three times and
  // the only card whose scope is DIFFERENT -- the headline lift, which spans
  // every session and says so -- was the one with no label at all. The chips
  // are the heading; a card labels its scope only when it is not the page's.
  const sleepCard = (
    <div className="pad-x"><div className="card ins-card">
      <div className="ins-head">
        <span className="ins-dot hue-hl-violet" />
        <span className="ins-t">Sleep</span>
      </div>
      {overview.sleep.nights === 0 ? (
        <div className="facts"><span className="fact">No night logged in this period</span></div>
      ) : (
        <>
          <div className="ins-big violet">{hoursLabel(overview.sleep.avgHours!)}</div>
          <div className="facts"><span className="fact">{`Average across ${overview.sleep.nights} logged ${overview.sleep.nights === 1 ? "night" : "nights"} of ${period.days}`}</span></div>
          {period.days <= 31 && (
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
        <button type="button" className="see-all" onClick={() => onOpenAllData("sleep", period)}>View Sleep Logs</button>
      </div>
    </div></div>
  );

  // THE CARD FEET ARE LINKS, NOT PILLS (health polish 2026-09-16, rule 2 names
// four of these by name: View Sets, View Sleep Logs). Every one of them only
// ever navigated to the records behind its card, and a .pill-act is this app's
// word for a verb that ACTS on the row it sits in -- so a grey capsule here
// promised a control and delivered a page change. They are .see-all now, the
// same red text action a section head uses, which is what the catalog already
// had for "go and look at this".
//
// What did NOT change: Assign Muscles stays a real .pill-act, because it
// writes; and the disclosures keep their capsules, because aria-expanded is a
// control and rule 3 wants methodology behind a labelled one.
const musclesCard = (
    <div className="pad-x"><div className="card ins-card">
      <div className="ins-head">
        <span className="ins-dot hue-hl-lime" />
        <span className="ins-t">Where Your Sets Went</span>
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
          {/* THE METHOD GOES IN A DISCLOSURE (health polish rule 3: "Do not
              turn every grey paragraph into a colored badge. Essential
              metadata gets one short readable line. Methodology, citations,
              limitations and edit effects remain available in labeled
              disclosures. No meaning may be silently removed").

              Two grey lines sat under every reading of this card, on every
              visit, saying the same thing they said last time. The first is
              the fact -- how much of the period is actually mapped -- and it
              stays on the face, because it is what makes the bars above it
              mean anything. The second is the counting convention, which you
              need once and then never again, so it is behind a summary that
              names it. Nothing is removed. */}
          <div className="facts">
            <span className="fact">{capAfterNumber(`${breakdown.assigned} of ${breakdown.total} working sets mapped`)}</span>
          </div>
          <details className="ins-table">
            <summary>How Sets Are Counted</summary>
            <div className="facts">
              <span className="fact">First muscle whole, the rest half</span><span className="fact">The app's convention</span>
            </div>
            <div className="facts">
              <span className="fact">Working sets only</span><span className="fact">Warm-ups are not counted</span>
            </div>
          </details>
          <div className="ins-acts">
            {breakdown.unassigned > 0 && <button type="button" className="pill-act" onClick={() => onAssignMuscles(breakdown.untagged)}>Assign Muscles</button>}
            <button type="button" className="see-all" onClick={() => onOpenAllData("sets", period)}>View Sets</button>
          </div>
        </>
      )}
    </div></div>
  );

  /** THE CARD, AND THE ONE CONTROL IT WAS MISSING. The head row chooses the
   *  exercise; "View Sets" at the foot is still the way into its page, so
   *  nothing that used to be one tap away is two now. */
  const ovHead = (
    <div {...pressable(() => setPicking("overview"))} className="ins-head" aria-label="Choose exercise">
      <span className="ins-dot hue-hl-lime" />
      <span className="ins-t">{ovLift ? ovLift.name : "Choose an Exercise"}</span>
      {CHEV}
    </div>
  );
  const ovSheet = picking === "overview" ? (
    <PickSheet title="Exercise" items={ovPickItems} onPick={ovPick} onCancel={() => setPicking(null)} />
  ) : null;

  const headlineCard = headline ? (
    <div className="pad-x"><div className="card ins-card">
      {ovHead}
      <div className="facts">
        {/* WHY THIS ONE, WHEN NOBODY PICKED IT. The default is the biggest
            comparable change, and a card that chose its own subject has to
            say so or it reads as the only exercise you have. */}
        {ovIdx == null && <span className="fact">Biggest gain</span>}
        <span className="fact">{`Best set at ${headline.reps} reps`}</span>
        {/* THE ONE CARD THAT IS NOT THE PAGE'S PERIOD (polish: "Trend period
            clearly 'All history'... Do not imply every card follows the same
            date scope"). Every other card on this screen reads the chips at
            the top; this one spans every comparable session there has ever
            been, and that difference has to be on its face, not only in the
            basis line at its foot. */}
        <span className="fact">All History</span>
      </div>
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
      {/* THE BASIS IS KEPT, NOT PRINTED (2026-09-16, Dave: "this is not a
          manual, we don't need instructions everywhere"; polish rule 3:
          "Methodology... remains available in labeled disclosures"). Two
          clauses of grey under the chart, on every visit, saying what the
          comparison holds constant. It is the answer to one question asked
          once, so it sits behind the question. */}
      <details className="ins-table">
        <summary>What Is Being Compared</summary>
        <div className="facts"><span className="fact">Same exercise, same equipment, same unit, same rep count</span></div>
        <div className="facts"><span className="fact">Spans the sessions, not only this period</span></div>
      </details>
      <div className="ins-acts"><button type="button" className="see-all" onClick={() => onOpenLift(headline.lift)}>View Sets</button></div>
    </div></div>
  ) : (
    /* A LIFT YOU PICKED THAT HAS NO COMPARISON YET IS NOT AN EMPTY PAGE
       (2026-09-18). It keeps its head, so the choice you made is on screen
       and changeable, and it says what is missing rather than what is
       wrong. Nothing is claimed from one session. */
    <div className="pad-x"><div className="card ins-card">
      {ovHead}
      <div className="facts">
        <span className="fact">{ovLift
          ? "No two sessions at the same rep count, equipment and unit yet, so no comparison is claimed"
          : "No comparable change to show: two sessions at the same rep count, equipment and unit are what it takes"}</span>
      </div>
      {ovLift && <div className="ins-acts"><button type="button" className="see-all" onClick={() => onOpenLift(ovLift)}>View Sets</button></div>}
    </div></div>
  );

  const strength = (
    <>
      {lifts.length === 0 ? (
        <div className="empty-state"><div className="empty-title">No Sets Logged Yet</div><div className="empty-sub">A logged session puts its lifts here</div></div>
      ) : (
        <>
          {/* ONE SELECTOR, NOT A CLOUD (health polish 2026-09-16: "Replace
              giant multirow exercise pill cloud with one full-width selector
              and searchable sheet. Keep selected exercise title immediately
              above its metrics").

              Every chartable lift was a chip, so a real library wrapped four
              or five rows deep and the reading you came for started below the
              fold. The chip row was also lying about its own kind: a .chip
              cloud in this app is a filter you combine, and this is a single
              choice of one. It is the app's own picker now -- the sheet the
              gym rows already open -- behind a row that names the current
              choice, so the card under it starts at the top of the screen
              however many lifts you have. */}
          <div className="sh2 sh2-quiet"><span className="t">Exercise</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            <div {...pressable(() => setPicking("strength"))} className="row" aria-label="Choose exercise">
              <div className="row-grow"><div className="conn-name">{lift ? lift.name : "Choose an Exercise"}</div></div>
              {lifts.length > 1 && <span className="row-value">{capAfterNumber(`${lifts.length} logged`)}</span>}
              {CHEV}
            </div>
          </div></div>
          {picking === "strength" && (
            <PickSheet
              title="Exercise"
              items={lifts.map((l, i) => ({ id: String(i), label: l.name }))}
              onPick={(ids) => { const i = Number(ids[0]); if (Number.isFinite(i)) setLiftIdx(i); setPicking(null); }}
              onCancel={() => setPicking(null)}
            />
          )}
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
                        <span className="fact">{`${monthDay(g.from.date)} to ${monthDay(g.to.date)}`}</span>
                        <span className="fact">{`${g.sessions} comparable sessions`}</span>
                      </div>
                      {chart(pts, lift.unit ?? "lb")}
                    </>
                  ) : (
                    <div className="facts"><span className="fact">No two sessions at the same rep count, equipment and unit yet, so no comparison is claimed</span></div>
                  )}
                  <div className="ins-acts"><button type="button" className="see-all" onClick={() => onOpenLift(lift)}>Open Exercise Page</button></div>
                </div></div>
                <div className="sh2 sh2-quiet"><span className="t">Sessions</span><span className="n">{table.length}</span></div>
                <div className="pad-x"><div className="card list-card-ruled">
                  {table.map((r) => (
                    <div {...pressable(() => onOpenWorkout(r.workoutId))} className="row" key={r.workoutId}>
                      <div className="row-grow">
                        <div className="conn-name">{monthDay(r.date)}</div>
                        {/* The count is the fact; the sets are a table behind
                            it, the same answer All Data took (2026-09-16).
                            "120 lb × 6, 130 lb × 8, 140 lb × 6, 150 lb × 6"
                            wrapped two grey lines on every row of this list. */}
                        <div className="facts"><span className="fact lime">{capAfterNumber(`${r.working} working`)}</span></div>
                        <details className="exp-more ad-sets" onClick={(e) => e.stopPropagation()}>
                          <summary>{`The ${r.sets.length === 1 ? "Set" : "Sets"}`}</summary>
                          <div className="ins-rows">
                            {r.sets.map((x, i) => (
                              <div className="ins-row" key={x + i}><span className="ins-k">{`Set ${i + 1}`}</span><span className="ins-sub">{x}</span></div>
                            ))}
                          </div>
                        </details>
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
      // SAY IT ONCE, AND DO NOT PRINT ARITHMETIC (2026-09-16, Dave's Rest and
      // Readings screenshot: "Not logged · No log in 7 days"). The value
      // already says Not logged; the context said it again in other words.
      // And the logged version ran to three clauses, the third of which was
      // the second subtracted from the period -- a number the reader can do
      // and did not ask for.
      rows.push({ key: def.id, title: def.data.name, hue: isSleep ? "violet" : "cyan", value, context: latest ? `Latest ${monthDay(latest.data.date)} · ${days} of ${period.days} days` : "", category: isSleep ? "sleep" : def.data.presetKey === "bodyweight" ? "body" : "other" });
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
                <div className="facts"><span className={"fact " + r.hue}>{r.value}</span>{r.context && <span className="fact">{r.context}</span>}</div>
              </div>
              {CHEV}
            </div>
          ))}
        </div></div>
      )}
      <div className="pad-x"><div className="facts"><span className="fact">Records, dates and counts only</span><span className="fact">Nothing here reads a cause into a coincidence</span></div></div>
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
          {headlineCard}
          {ovSheet}
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

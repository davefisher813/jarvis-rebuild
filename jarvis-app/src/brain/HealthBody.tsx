import { useState, type ReactNode } from "react";
import type { Program, Workout } from "../gym/types";
import type { TrainingSummary } from "../gym/summary";
import { agoPhrase, mondayOf } from "../gym/summary";
import type { MetricDef, MetricLog } from "../gym/metrics";
import { activeMetrics } from "../gym/metrics";
import { nextDayFor, SCRATCH_DAY_ID, SCRATCH_DAY_NAME } from "../gym/nextDay";
import { todayDow, WEEKDAY_ABBR } from "../gym/pins";
import { estimateDay } from "../gym/fit";
import { readGymSettings, rackFrom } from "../gym/settings";
import { BarbellGlyph, ClockGlyph, PulseGlyph, MoonGlyph, DropGlyph, SmileGlyph, MealGlyph } from "../shared/glyphs";
import { Plus, Timer, Gauge, Check } from "../shared/icons";
import { capAfterNumber } from "../shared/casing";
import { fmtTime } from "../schedule/calendar";
import { dayPhrase, monthDay } from "../money/bills";
import { weekdayLongDate } from "../shared/dateFormat";
import { pressable } from "../shared/pressable";
import type { HueKind } from "../health/hue";
import { hueFor, hueForMetric } from "../health/hue";
import type { LogRow, LogOpen } from "../health/log";

/** H-12 (Health Push C): the session waiting to be resumed, as the hero. */
export interface LiveHero { dayName: string; nextExercise: string | null; setNo: number; setTotal: number; logged: number }
/** H-43: the Water tile, a +1 on the tile itself. */
export interface WaterTile { name: string; today: number; unit: string; onPlus: () => void }

// THE HEALTH PAGE, TO THE REFERENCE (Dave 2026-09-14: "update all of the
// formatting and functionality of the health page based on the html chatgpt
// created. The only thing you are to not adjust is the actual styling").
//
// What the reference draws, and what each became here, in JARVIS's own
// dress (the tile, the hero card, the facts line, the ramp by meaning):
//   - Three tabs: Overview, Training, Logs. One segmented control.
//   - Overview: YOUR NEXT WORKOUT with the program named beside it, the day,
//     "N lifts · About M min", a filled Start Workout, and Have Less Time?
//     which opens 20 min / 30 min / Full Workout. A shorter pick starts the
//     day with that budget, so the fit sheet opens already priced to it.
//   - Quick Log: the shortcut tiles he chose in Customize (Health Settings),
//     Water as a +1, Medication as an optional tile with its last dose.
//   - Training at a Glance: last workout, exercises logged, workouts this
//     week, latest sleep log. Absent until there is a session to count.
//   - This Week: the count, the range, and seven dated circles with a check
//     on a trained day.
//   - The last session, one row, as the way into its review.
//   - Training: the program's days with what is up next and what was last,
//     Open Session, and the program itself.
//   - Logs: today's timeline, then the doors (Medication, Other Metrics,
//     Rate a Session, Review and Export, Settings).
// The 2026-09-13 simplification's rules still hold where the reference does
// not speak: no sentence under a tile, no pill facts, the adds at the foot.
// Nothing about what is stored, derived or scored moves.

const CHEV = <div className="chev" />;
type Tab = "overview" | "training" | "logs";

// S5-Q29 (2026-09-04): the one-tap loggers grafted from the Health module.
// Ate Before stays dormant: its screen needs calendar candidates this page
// has no source for. Check In joined 2026-09-14 (the reference's check-in).
export type HealthLoggerKey = "lightsOut" | "tookIt" | "callIt" | "pointAtIt" | "meal" | "checkin";
/** What each logger MEASURES, which is what decides its hue (Health R4 /
 *  H-04, 2026-09-12). Total over the key union on purpose. */
const LOGGER_KIND: Record<HealthLoggerKey, HueKind> = {
  lightsOut: "sleep",
  tookIt: "medication",
  callIt: "reading",
  pointAtIt: "discomfort",
  meal: "meal",
  checkin: "reading",
};
/** The glyph a logger's tile leads with: what kind of thing it logs. */
function loggerGlyph(key: HealthLoggerKey): ReactNode {
  if (key === "lightsOut") return <MoonGlyph />;
  if (key === "meal") return <MealGlyph />;
  if (key === "checkin") return <SmileGlyph />;
  if (key === "tookIt") return <Check className="ic" />;
  if (key === "callIt") return <Gauge className="ic" />;
  return <PulseGlyph />;
}
export interface HealthLoggerRow {
  key: HealthLoggerKey;
  label: string;
  /** What tapping it does, for the logger's own screen. The tile no longer
   *  prints it (2026-09-13: no sentence under a tile). */
  sub: string;
  /** The last thing logged, short enough for a tile's value slot ("Today").
   *  Null before anything is logged, and the tile says Log it. */
  value: string | null;
}

/** "7h 20m" for minutes past an hour, "45 min" under it, "184 lb", "3/5", "Yes". */
function tileValue(def: MetricDef, log: MetricLog | undefined): { big: string; small: string }[] | null {
  if (!log) return null;
  const d = def.data;
  if (d.type === "yesno") return log.data.yes == null ? null : [{ big: log.data.yes ? "Yes" : "No", small: "" }];
  const v = log.data.value;
  if (v == null) return null;
  const trim = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(1))));
  if (d.type === "scale5") return [{ big: trim(v), small: "/5" }];
  if (d.type === "minutes") {
    if (v >= 60) { const h = Math.floor(v / 60); const m = Math.round(v % 60); return m ? [{ big: String(h), small: "h" }, { big: String(m), small: "m" }] : [{ big: String(h), small: "h" }]; }
    return [{ big: trim(v), small: "min" }];
  }
  return [{ big: trim(v), small: d.unit ?? "" }];
}

/** The tile's glyph says what KIND of thing it holds, in the tile's hue. */
function metricGlyph(def: MetricDef): ReactNode {
  if (def.data.presetKey === "sleep") return <MoonGlyph />;
  if (def.data.type === "minutes") return <Timer className="ic" />;
  if (def.data.type === "scale5") return <Gauge className="ic" />;
  if (def.data.type === "yesno") return <Check className="ic" />;
  return <PulseGlyph />;
}

/** Sep 7 to 13, for the week holding `today`. */
function weekRange(today: string): string {
  const mon = mondayOf(today);
  const d = new Date(mon + "T00:00:00");
  d.setDate(d.getDate() + 6);
  const sun = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${monthDay(mon)} to ${monthDay(sun)}`;
}
/** The day-of-month for each of Mon..Sun of the week holding `today`. */
function weekDates(today: string): number[] {
  const mon = new Date(mondayOf(today) + "T00:00:00");
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return d.getDate(); });
}

export default function HealthBody({
  program, workouts, training, today, isEvening, gymEvent, metricDefs, metricLogs,
  onStart, onOpenGym, onOpenMetric, onManageMetrics, insights, sections, more, adds,
  healthLoggers, onOpenHealthLogger, onOpenMedication, medSub, medTile = false,
  live = null, onResume, water = null, log = [], onOpenLog, pendingCount = 0, onOpenSettings,
  onRateSession, onOpenExport,
}: {
  program: Program | null;
  workouts: Workout[];
  training: TrainingSummary | null;
  today: string;
  isEvening: boolean;
  /** Today's gym block on the calendar, if there is one: its start time. */
  gymEvent: { start: string } | null;
  metricDefs: MetricDef[];
  metricLogs: MetricLog[];
  /** The day to start, by id. SCRATCH_DAY_ID starts an empty session. A
   *  budget (Have Less Time?) opens the fit sheet already priced to it. */
  onStart: (dayId: string, budgetMin?: number) => void;
  onOpenGym: () => void;
  onOpenMetric: (def: MetricDef) => void;
  onManageMetrics: () => void;
  /** The insight cards, when any qualified; rendered as handed in. */
  insights?: ReactNode;
  /** Projects, Training Goals, Coming Up and Up Next, defined once by
   *  CategoryDetail and handed in (Dave 2026-09-10: one copy of each). On
   *  this page only the ones holding something are drawn. */
  sections?: ReactNode;
  /** Repetitions, the week's receipt, notes: the quiet tail, as handed in. */
  more?: ReactNode;
  /** The creates for those sections, one compact row at the very foot
   *  (Dave 2026-09-13: "should be at the very very bottom"). */
  adds?: ReactNode;
  /** S5-Q29: the grafted one-tap loggers, in display order. */
  healthLoggers: HealthLoggerRow[];
  onOpenHealthLogger: (key: HealthLoggerKey) => void;
  /** Dave 2026-09-10: "medication related stuff should all be its own page." */
  onOpenMedication?: () => void;
  /** When the last dose was logged ("Today"), or null before the first. */
  medSub?: string | null;
  /** The reference's optional Medication shortcut: a tile in Quick Log with
   *  the last dose as its value, on when he chose it in Customize. */
  medTile?: boolean;
  /** H-12: a live or parked session makes the hero a Resume. */
  live?: LiveHero | null;
  onResume?: () => void;
  /** H-43: the Water shortcut's tile, when it is on. */
  water?: WaterTile | null;
  /** H-48: today's entries, oldest first. */
  log?: LogRow[];
  onOpenLog?: (o: LogOpen) => void;
  /** H-53: what is still waiting to sync. Hidden at zero. */
  pendingCount?: number;
  /** H-40: the door to Health Settings, which the reference calls Customize. */
  onOpenSettings?: () => void;
  /** The Logs tab's doors: Rate a Session and Review and Export. */
  onRateSession?: () => void;
  onOpenExport?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [less, setLess] = useState(false);
  const dow = todayDow();
  const next = nextDayFor(program, workouts, dow);
  const est = next ? estimateDay(next.day, workouts, rackFrom(readGymSettings())).min : 0;
  const when = gymEvent
    ? `${isEvening ? "Tonight" : "Today"} ${fmtTime(gymEvent.start).time} ${fmtTime(gymEvent.start).ap}`
    : next?.when === "today" ? "Today" : next?.when === "tomorrow" ? "Tomorrow" : next?.when ? next.when : null;
  const liftsOf = (n: number) => capAfterNumber(`${n} ${n === 1 ? "lift" : "lifts"}`);
  const dots = training?.weekDots ?? new Array<boolean>(7).fill(false);
  const dates = weekDates(today);
  // The Water preset is its own tile (H-43) when the shortcut is on, so it
  // is not drawn twice.
  const shownMetrics = activeMetrics(metricDefs).filter((d) => !(water && d.data.presetKey === "water"));
  const days = (program?.data.weeks ?? []).flatMap((w) => w.days);
  // Every day of the program except the one already offered above it.
  const otherDays = days.filter((d) => d.id !== next?.day.id);
  const last = training?.last ?? null;
  const prFromLast = !!(last && training?.pr && training.pr.date === last.date);
  const programDays = days.length;
  const programFact = program ? (programDays > 0 ? capAfterNumber(`${programDays} day program`) : program.data.name) : null;
  // Training at a Glance's fourth tile: the latest sleep log, from his own
  // Sleep metric when he tracks one.
  const sleepDef = metricDefs.find((d) => d.data.presetKey === "sleep" && !d.data.hidden) ?? null;
  const sleepLatest = sleepDef
    ? metricLogs.filter((l) => l.data.metricId === sleepDef.id && l.data.value != null && l.data.date <= today).sort((a, b) => a.data.date.localeCompare(b.data.date)).pop() ?? null
    : null;
  const sleepValue = sleepLatest && sleepDef ? tileValue(sleepDef, sleepLatest) : null;
  const sessionsThisWeek = training?.sessionsThisWeek ?? 0;
  const glance = !!(last || sessionsThisWeek > 0 || sleepValue);
  const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  // ONE TILE ANATOMY for a logger and a metric alike: glyph and name on top
  // with the + at the end, then the value (or Log it), then when. The hue is
  // what the tile MEASURES (health/hue.ts), never its slot in the grid.
  const tile = (key: string, name: string, hue: string, glyph: ReactNode, value: ReactNode | null, meta: string | null, onOpen: () => void) => (
    <div {...pressable(onOpen)} className={"h-tile" + (value ? "" : " h-tile-empty")} data-hue={hue} key={key}>
      <div className="ht-top">
        <span className="ht-ico" aria-hidden="true">{glyph}</span>
        <span className="ht-w">{name}</span>
        <span className="ht-plus" aria-hidden="true"><Plus className="ic" /></span>
      </div>
      <div className="ht-n">{value ?? <span className="ht-none">Log it</span>}</div>
      {meta && <div className="ht-m">{meta}</div>}
    </div>
  );
  const metricTile = (def: MetricDef) => {
    const mine = metricLogs.filter((l) => l.data.metricId === def.id && l.data.date <= today).sort((a, b) => a.data.date.localeCompare(b.data.date));
    const latest = mine[mine.length - 1];
    const val = tileValue(def, latest);
    const meta = !latest ? null : latest.data.date === today ? "Today" : capFirst(dayPhrase(latest.data.date, today));
    const value = val ? val.map((p, j) => <span key={j}>{p.big}{p.small && <small>{p.small}</small>}</span>) : null;
    return tile(def.id, def.data.name, hueForMetric(def), metricGlyph(def), value, meta, () => onOpenMetric(def));
  };
  const loggerTile = (l: HealthLoggerRow) =>
    tile(l.key, l.label, hueFor(LOGGER_KIND[l.key]), loggerGlyph(l.key), l.value ? <span>{l.value}</span> : null, null, () => onOpenHealthLogger(l.key));
  // WATER IS A +1 ON THE TILE (H-43, Health Push C, 2026-09-12). The tile
  // itself is the tap; the count is today's; Undo rides the caller's toast.
  const waterTile = (w: WaterTile) => (
    <div {...pressable(w.onPlus)} className={"h-tile" + (w.today > 0 ? "" : " h-tile-empty")} data-hue="cyan" key="water">
      <div className="ht-top">
        <span className="ht-ico" aria-hidden="true"><DropGlyph /></span>
        <span className="ht-w">{w.name}</span>
        <span className="ht-plus" aria-hidden="true"><Plus className="ic" /></span>
      </div>
      <div className="ht-n">{w.today > 0 ? <span>{w.today}<small>{w.unit}</small></span> : <span className="ht-none">Log it</span>}</div>
      {w.today > 0 && <div className="ht-m">Today</div>}
    </div>
  );
  // A STAT TILE reads, it does not log: no +, the value and its caption.
  const statTile = (key: string, name: string, hue: string, glyph: ReactNode, value: ReactNode, caption: string | null) => (
    <div className="h-tile h-tile-stat" data-hue={hue} key={key}>
      <div className="ht-top">
        <span className="ht-ico" aria-hidden="true">{glyph}</span>
        <span className="ht-w">{name}</span>
      </div>
      <div className="ht-n">{value}</div>
      {caption && <div className="ht-m">{caption}</div>}
    </div>
  );
  // THE LOG (H-48): the glyph says what kind of thing the row is, the time
  // wears the same hue, and one fact sits beside it.
  const logGlyph = (kind: HueKind): ReactNode =>
    kind === "sets" ? <BarbellGlyph /> : kind === "sleep" ? <MoonGlyph /> : kind === "medication" ? <Check className="ic" /> : kind === "meal" ? <MealGlyph /> : kind === "water" ? <DropGlyph /> : <ClockGlyph />;
  const clockOf = (at: number) => {
    const d = new Date(at);
    const t = fmtTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
    return `${t.time} ${t.ap}`;
  };
  const door = (label: string, onOpen: () => void, value?: string | null) => (
    <div {...pressable(onOpen)} className="task-row p2" key={label}>
      <div className="task-title"><span className="task-name">{label}</span></div>
      {value && <span className="h-door-v">{value}</span>}
      {CHEV}
    </div>
  );

  const hero = (
    <div className="pad-x h-hero-wrap"><div className="card list-card-ruled h-hero-card">
      {live ? (
        // H-12 (Health Push C, 2026-09-12): a session in flight leads the
        // page. The next lift in cyan, where he is in it, what is logged in
        // lime, and the one red move is Resume.
        <div {...pressable(onResume ?? onOpenGym)} className="h-hero">
          <span className="h-hero-ico"><BarbellGlyph /></span>
          <div className="h-hero-b">
            <div className="h-hero-t">{`Resume ${live.dayName}`}</div>
            <div className="facts h-hero-facts">
              {live.nextExercise && <span className="fact cyan">{`Next: ${live.nextExercise}`}</span>}
              {live.setTotal > 0 && <span className="fact">{capAfterNumber(`Set ${live.setNo} of ${live.setTotal}`)}</span>}
              <span className="fact lime">{capAfterNumber(`${live.logged} logged`)}</span>
            </div>
          </div>
          <button className="pill-act" onClick={(e) => { e.stopPropagation(); (onResume ?? onOpenGym)(); }}>Resume</button>
        </div>
      ) : next ? (
        <>
          <div className="h-hero-head">
            <span className="h-eyebrow">Your Next Workout</span>
            {programFact && <span className="fact">{programFact}</span>}
          </div>
          <div {...pressable(onOpenGym)} className="h-hero">
            <span className="h-hero-ico"><BarbellGlyph /></span>
            <div className="h-hero-b">
              <div className="h-hero-t">{next.day.name}</div>
              <div className="facts h-hero-facts">
                {when && <span className="fact">{when}</span>}
                {next.day.exercises.length > 0 && <span className="fact lime">{liftsOf(next.day.exercises.length)}</span>}
                {est > 0 && <span className="fact amber">{capAfterNumber(`About ${est} min`)}</span>}
              </div>
            </div>
            {CHEV}
          </div>
          {/* THE ONE FILLED PRIMARY ON THIS PAGE, and under it the
              reference's Have Less Time?: two shorter budgets and the full
              workout. A budget walks into the fit sheet already priced. */}
          <div className="h-hero-cta">
            <button type="button" className="btn btn-primary btn-block" onClick={() => onStart(next.day.id)}>Start Workout</button>
            {est > 0 && (
              <button type="button" className="btn btn-tertiary btn-block" aria-expanded={less} onClick={() => setLess((o) => !o)}>Have Less Time?</button>
            )}
            {less && est > 0 && (
              <div className="h-less">
                <div className="h-less-q">How much time do you have?</div>
                <div className="h-pick h-less-picks" role="group" aria-label="How much time do you have">
                  {[20, 30].filter((m) => m < est).map((m) => (
                    <button type="button" className="h-pick-c" key={m} onClick={() => onStart(next.day.id, m)}>{capAfterNumber(`${m} min`)}</button>
                  ))}
                  <button type="button" className="h-pick-c h-pick-new" onClick={() => onStart(next.day.id)}>Full Workout</button>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <div {...pressable(onOpenGym)} className="h-hero">
          <span className="h-hero-ico"><BarbellGlyph /></span>
          <div className="h-hero-b">
            <div className="h-hero-t">{program ? program.data.name : "Set Up a Program"}</div>
          </div>
          {CHEV}
        </div>
      )}
      {/* OPEN SESSION DOES NOT SCROLL (Dave 2026-09-10): the program days
          scroll past it, it never moves off the edge. */}
      {program && (
        <div className="h-pick-wrap">
          <div className="h-pick" role="group" aria-label="Start another session">
            {otherDays.map((d) => (
              <button className="h-pick-c" key={d.id} onClick={() => onStart(d.id)}>{d.name}</button>
            ))}
          </div>
          <button className="h-pick-c h-pick-new" onClick={() => onStart(SCRATCH_DAY_ID)}><Plus className="ic" />{SCRATCH_DAY_NAME}</button>
        </div>
      )}
    </div></div>
  );

  const overview = (
    <>
      {hero}

      {/* QUICK LOG: the shortcuts he chose (Customize is Health Settings),
          Water as a +1, Medication as an optional tile, his own metrics. */}
      <div className="sh2 sh2-quiet"><span className="t">Quick Log</span>
        {onOpenSettings && <button className="see-all pill-action" onClick={onOpenSettings}>Customize</button>}</div>
      <div className="pad-x"><div className="h-tiles">
        {healthLoggers.map((l) => loggerTile(l))}
        {water && waterTile(water)}
        {medTile && onOpenMedication && tile("medication", "Medication", hueFor("medication"), <Check className="ic" />, medSub ? <span>{medSub}</span> : null, null, onOpenMedication)}
        {shownMetrics.map((d) => metricTile(d))}
        <div {...pressable(onManageMetrics)} className="h-tile h-tile-add">
          <div className="ht-top">
            <span className="ht-ico" aria-hidden="true"><Plus className="ic" /></span>
            <span className="ht-w">Track More</span>
          </div>
          <div className="ht-n"><span className="ht-none">Add a Metric</span></div>
        </div>
      </div></div>

      {/* TRAINING AT A GLANCE: four readings, absent until there is one. */}
      {glance && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Training at a Glance</span></div>
          <div className="pad-x"><div className="h-tiles">
            {last && statTile("last", "Last Workout", "amber", <Timer className="ic" />, <span>{last.minutes}<small>min</small></span>, `${last.dayName} · ${capFirst(agoPhrase(last.date, today))}`)}
            {last && statTile("lifts", "Exercises Logged", "lime", <BarbellGlyph />, <span>{last.exercises}</span>, last.dayName)}
            {statTile("week", "Workouts This Week", "lime", <Check className="ic" />, <span>{sessionsThisWeek}</span>, weekRange(today))}
            {sleepValue && sleepLatest && statTile("sleep", "Latest Sleep Log", "violet", <MoonGlyph />,
              sleepValue.map((p, j) => <span key={j}>{p.big}{p.small && <small>{p.small}</small>}</span>),
              sleepLatest.data.date === today ? "Today" : capFirst(dayPhrase(sleepLatest.data.date, today)))}
          </div></div>
        </>
      )}

      {/* THIS WEEK: the count, the range, seven dated circles. */}
      <div className="sh2 sh2-quiet"><span className="t">This Week</span></div>
      <div className="pad-x"><div className="card list-card-ruled">
        <div className="h-week-head">
          <span className="h-week-n">{capAfterNumber(`${sessionsThisWeek} ${sessionsThisWeek === 1 ? "workout" : "workouts"} logged`)}</span>
          <span className="fact">{weekRange(today)}</span>
        </div>
        <div className="h-week h-week-dates" aria-label="Days trained this week">
          {WEEKDAY_ABBR.map((d, i) => (
            <div className={"h-day" + (dots[i] ? " on" : "") + (i === dow ? " today" : "")} key={i}
              aria-label={dots[i] ? `${d}, trained` : i === dow ? `${d}, today` : d}>
              {d}<i>{dots[i] ? <Check className="ic" /> : dates[i]}</i>
            </div>
          ))}
        </div>
        {last && (
          <div {...pressable(onOpenGym)} className="task-row p2 h-last">
            <div className="task-title">
              <span className="h-last-k">Review Your Last Session</span>
              <div className="facts">
                <span className="fact h-last-day">{last.dayName}</span>
                <span className="fact">{capAfterNumber(agoPhrase(last.date, today))}</span>
                <span className="fact lime">{liftsOf(last.exercises)}</span>
                {prFromLast && training?.pr && <span className="fact lime">{`PR ${training.pr.text}`}</span>}
              </div>
            </div>
            {CHEV}
          </div>
        )}
      </div></div>

      {/* The sections that hold something, then the findings, then the tail,
          and the creates last of all. */}
      {sections}

      {insights}

      {more}

      {adds}
    </>
  );

  const trainingTab = (
    <>
      <div className="sh2 sh2-quiet"><span className="t">Your Program</span>
        {program && <span className="n">{program.data.name}</span>}</div>
      <div className="pad-x"><div className="card list-card-ruled">
        {days.map((d) => {
          const isNext = d.id === next?.day.id;
          const isLast = !!(last && workouts.find((w) => w.data.date === last.date && w.data.dayId === d.id));
          return (
            <div {...pressable(() => onStart(d.id))} className="task-row p2" key={d.id}>
              <div className="task-title">
                <span className="task-name">{d.name}</span>
                <div className="facts">
                  {isNext && <span className="fact h-next">Up Next</span>}
                  {isLast && !isNext && <span className="fact">Last Workout</span>}
                  <span className="fact lime">{liftsOf(d.exercises.length)}</span>
                </div>
              </div>
              {CHEV}
            </div>
          );
        })}
        {program
          ? <div {...pressable(() => onStart(SCRATCH_DAY_ID))} className="task-row p2">
              <div className="task-title"><span className="task-name">{SCRATCH_DAY_NAME}</span></div>
              {CHEV}
            </div>
          : <div {...pressable(onOpenGym)} className="task-row p2">
              <div className="task-title"><span className="task-name">Set Up a Program</span></div>
              {CHEV}
            </div>}
      </div></div>
      <div className="pad-x h-tab-foot">
        <button type="button" className="btn btn-secondary btn-block" onClick={onOpenGym}>Open the Program</button>
        <button type="button" className="btn btn-tertiary btn-block" onClick={() => setTab("overview")}>Back to Next Workout</button>
      </div>
    </>
  );

  const logsTab = (
    <>
      <div className="sh2 sh2-quiet"><span className="t">Your Timeline</span>{log.length > 0 && <span className="n">{log.length}</span>}</div>
      <div className="pad-x"><div className="h-timeline-date">{weekdayLongDate(today)}</div></div>
      {log.length > 0 ? (
        <div className="pad-x"><div className="card list-card-ruled">
          {log.map((r) => {
            const hue = r.hue ?? hueFor(r.kind);
            return (
              <div {...pressable(() => onOpenLog?.(r.open))} className="row h-log-row" key={r.id}>
                <span className="h-log-ico" data-hue={hue} aria-hidden="true">{logGlyph(r.kind)}</span>
                <div className="row-grow">
                  <div className="conn-name">{r.title}</div>
                  <div className="facts">
                    <span className={"fact " + hue}>{clockOf(r.at)}</span>
                    {r.detail && <span className="fact">{r.detail}</span>}
                  </div>
                </div>
                {CHEV}
              </div>
            );
          })}
        </div></div>
      ) : (
        <div className="pad-x"><div className="card pad">
          <div className="empty-state">
            <div className="empty-title">Nothing Logged Yet</div>
            <div className="empty-sub">Quick Log on the overview writes here</div>
          </div>
        </div></div>
      )}
      {/* H-53: one quiet receipt, what is still waiting to sync. Hidden at
          zero, so it only ever says something true. */}
      {pendingCount > 0 && (
        <div className="pad-x h-sync">{capAfterNumber(`${pendingCount} waiting to sync`)}</div>
      )}
      {/* THE DOORS. Medication is its own page (Dave 2026-09-10); the rest
          are the reference's Daily Health doors. */}
      <div className="pad-x h-doors"><div className="card list-card-ruled">
        {onOpenMedication && door("Medication", onOpenMedication, medSub)}
        {door("Other Metrics", onManageMetrics)}
        {onRateSession && door("Rate a Session", onRateSession)}
        {onOpenExport && door("Review and Export", onOpenExport)}
        {onOpenSettings && door("Settings", onOpenSettings)}
      </div></div>
    </>
  );

  return (
    <>
      <div className="pad-x h-tabs">
        <div className="segmented" role="tablist" aria-label="Health views">
          {(["overview", "training", "logs"] as Tab[]).map((t) => (
            <button type="button" role="tab" aria-selected={tab === t} className={"seg" + (tab === t ? " active" : "")} key={t} onClick={() => setTab(t)}>
              {t === "overview" ? "Overview" : t === "training" ? "Training" : "Logs"}
            </button>
          ))}
        </div>
      </div>
      {tab === "overview" ? overview : tab === "training" ? trainingTab : logsTab}
    </>
  );
}

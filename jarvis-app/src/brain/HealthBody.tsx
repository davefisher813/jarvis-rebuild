import type { ReactNode } from "react";
import type { Program, Workout } from "../gym/types";
import type { TrainingSummary } from "../gym/summary";
import { agoPhrase } from "../gym/summary";
import type { MetricDef, MetricLog } from "../gym/metrics";
import { activeMetrics } from "../gym/metrics";
import { nextDayFor, SCRATCH_DAY_ID, SCRATCH_DAY_NAME } from "../gym/nextDay";
import { todayDow } from "../gym/pins";
import { estimateDay } from "../gym/fit";
import { readGymSettings, rackFrom } from "../gym/settings";
import { BarbellGlyph, ClockGlyph, PulseGlyph } from "../shared/glyphs";
import { Plus, Timer, Gauge, Check } from "../shared/icons";
import { capAfterNumber } from "../shared/casing";
import { fmtTime } from "../schedule/calendar";
import { dayPhrase } from "../money/bills";
import { pressable } from "../shared/pressable";
import type { HueKind } from "../health/hue";
import { hueFor, hueForMetric } from "../health/hue";
import type { LogRow, LogOpen } from "../health/log";

/** H-12 (Health Push C): the session waiting to be resumed, as the hero. */
export interface LiveHero { dayName: string; nextExercise: string | null; setNo: number; setTotal: number; logged: number }
/** H-43: the Water tile, a +1 on the tile itself. */
export interface WaterTile { name: string; today: number; unit: string; onPlus: () => void }

// THE HEALTH PAGE, SIMPLIFIED (Dave 2026-09-13: "this page would be
// intimidating overwhelming for me and it is my app so it needs to be
// simplified in a good way").
//
// Five things he named, and what each became:
//   1. The log tiles did not invite a log. A tile now says what it is (a
//      coloured glyph and the name in full ink), carries a filled + in its
//      own hue so it reads as a thing you tap, and an empty tile says Log it
//      in that hue instead of a dim grey that looked switched off.
//   2. The training card was chaotic: three chips, a chip row, the week, a
//      last-session row with three more chips and a PR row with two. It is
//      the day's name, one facts line, a filled red Start, the other sessions
//      as real outlined buttons, the week, and ONE line for the last session
//      (the PR joins it only when it came from that session).
//   3. Grey subtext. The sentences under tiles and doors are gone; what
//      remains is a datum in its hue or a name in full ink.
//   4. Pills that were text in a pill. Facts are the .facts line now,
//      coloured words with no ground; the only capsules left are controls.
//   5. The Add rows and the empty goals note. Empty sections are not drawn
//      on this page; their creates are one compact row at the very foot
//      (`adds`), and the "set one from a lift" note is gone with its section.
//
// Nothing about what is stored, derived or scored moves.

const CHEV = <div className="chev" />;
const DAYS = ["M", "T", "W", "T", "F", "S", "S"];

// S5-Q29 (2026-09-04): the one-tap loggers grafted from the Health module.
// Ate Before stays dormant: its screen needs calendar candidates this page
// has no source for.
export type HealthLoggerKey = "lightsOut" | "tookIt" | "callIt" | "pointAtIt" | "meal";
/** What each logger MEASURES, which is what decides its hue (Health R4 /
 *  H-04, 2026-09-12). Total over the key union on purpose. */
const LOGGER_KIND: Record<HealthLoggerKey, HueKind> = {
  lightsOut: "sleep",
  tookIt: "medication",
  callIt: "reading",
  pointAtIt: "discomfort",
  meal: "meal",
};
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
  if (def.data.type === "minutes") return <Timer className="ic" />;
  if (def.data.type === "scale5") return <Gauge className="ic" />;
  if (def.data.type === "yesno") return <Check className="ic" />;
  return <PulseGlyph />;
}

export default function HealthBody({
  program, workouts, training, today, isEvening, gymEvent, metricDefs, metricLogs,
  onStart, onOpenGym, onOpenMetric, onManageMetrics, insights, sections, more, adds,
  healthLoggers, onOpenHealthLogger, onOpenHealthMore, onOpenMedication, medSub,
  live = null, onResume, water = null, log = [], onOpenLog, pendingCount = 0, onOpenSettings,
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
  /** The day to start, by id. SCRATCH_DAY_ID starts an empty session. */
  onStart: (dayId: string) => void;
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
  /** HMN-F-06 (2026-09-05): the door to the rest of the health module. */
  onOpenHealthMore?: () => void;
  /** H-12: a live or parked session makes the hero a Resume. */
  live?: LiveHero | null;
  onResume?: () => void;
  /** H-43: the Water shortcut's tile, when it is on. */
  water?: WaterTile | null;
  /** H-48: today's entries, oldest first. Nothing renders at zero. */
  log?: LogRow[];
  onOpenLog?: (o: LogOpen) => void;
  /** H-53: what is still waiting to sync. Hidden at zero. */
  pendingCount?: number;
  /** H-40: the door to Health Settings. */
  onOpenSettings?: () => void;
}) {
  const dow = todayDow();
  const next = nextDayFor(program, workouts, dow);
  const est = next ? estimateDay(next.day, workouts, rackFrom(readGymSettings())).min : 0;
  const when = gymEvent
    ? `${isEvening ? "Tonight" : "Today"} ${fmtTime(gymEvent.start).time} ${fmtTime(gymEvent.start).ap}`
    : next?.when === "today" ? "Today" : next?.when === "tomorrow" ? "Tomorrow" : next?.when ? next.when : null;
  const lifts = next ? capAfterNumber(`${next.day.exercises.length} ${next.day.exercises.length === 1 ? "lift" : "lifts"}`) : "";
  const dots = training?.weekDots ?? new Array<boolean>(7).fill(false);
  // The Water preset is its own tile (H-43) when the shortcut is on, so it
  // is not drawn twice.
  const shownMetrics = activeMetrics(metricDefs).filter((d) => !(water && d.data.presetKey === "water"));
  // Every day of the program except the one already offered above it.
  const otherDays = (program?.data.weeks ?? []).flatMap((w) => w.days).filter((d) => d.id !== next?.day.id);
  const last = training?.last ?? null;
  const prFromLast = !!(last && training?.pr && training.pr.date === last.date);

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
    const meta = !latest ? null : latest.data.date === today ? "Today" : (() => { const p = dayPhrase(latest.data.date, today); return p.charAt(0).toUpperCase() + p.slice(1); })();
    const value = val ? val.map((p, j) => <span key={j}>{p.big}{p.small && <small>{p.small}</small>}</span>) : null;
    return tile(def.id, def.data.name, hueForMetric(def), metricGlyph(def), value, meta, () => onOpenMetric(def));
  };
  const loggerTile = (l: HealthLoggerRow) =>
    tile(l.key, l.label, hueFor(LOGGER_KIND[l.key]), <ClockGlyph />, l.value ? <span>{l.value}</span> : null, null, () => onOpenHealthLogger(l.key));
  // WATER IS A +1 ON THE TILE (H-43, Health Push C, 2026-09-12). The tile
  // itself is the tap; the count is today's; Undo rides the caller's toast.
  const waterTile = (w: WaterTile) => (
    <div {...pressable(w.onPlus)} className={"h-tile" + (w.today > 0 ? "" : " h-tile-empty")} data-hue="cyan" key="water">
      <div className="ht-top">
        <span className="ht-ico" aria-hidden="true"><PulseGlyph /></span>
        <span className="ht-w">{w.name}</span>
        <span className="ht-plus" aria-hidden="true"><Plus className="ic" /></span>
      </div>
      <div className="ht-n">{w.today > 0 ? <span>{w.today}<small>{w.unit}</small></span> : <span className="ht-none">Log it</span>}</div>
      {w.today > 0 && <div className="ht-m">Today</div>}
    </div>
  );
  // THE LOG (H-48): the glyph says what kind of thing the row is, the time
  // wears the same hue, and one fact sits beside it.
  const logGlyph = (kind: HueKind): ReactNode =>
    kind === "sets" ? <BarbellGlyph /> : kind === "sleep" ? <ClockGlyph /> : kind === "medication" ? <Check className="ic" /> : <PulseGlyph />;
  const clockOf = (at: number) => {
    const d = new Date(at);
    const t = fmtTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
    return `${t.time} ${t.ap}`;
  };

  return (
    <>
      {/* TRAINING: A CHOICE, NOT A VERDICT (Dave 2026-09-10), and calm
          (2026-09-13). The suggestion leads with Start; every other day of
          the program and Open Session sit under it as buttons; the week is
          seven dots; the last session is one line. */}
      <div className="sh2 sh2-quiet"><span className="t">Training</span>
        <button className="see-all pill-action" onClick={onOpenGym}>Program</button></div>
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
          <div {...pressable(onOpenGym)} className="h-hero">
            <span className="h-hero-ico"><BarbellGlyph /></span>
            <div className="h-hero-b">
              <div className="h-hero-t">{next.day.name}</div>
              <div className="facts h-hero-facts">
                {when && <span className="fact">{when}</span>}
                {next.day.exercises.length > 0 && <span className="fact lime">{lifts}</span>}
                {est > 0 && <span className="fact amber">{capAfterNumber(`${est} min`)}</span>}
              </div>
            </div>
            <button className="pill-act" onClick={(e) => { e.stopPropagation(); onStart(next.day.id); }}>Start</button>
          </div>
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
        <div className="h-week" aria-label="Days trained this week">
          {DAYS.map((d, i) => (
            <div className={"h-day" + (dots[i] ? " on" : "") + (i === dow ? " today" : "")} key={i}><i />{d}</div>
          ))}
        </div>
        {last && (
          <div {...pressable(onOpenGym)} className="task-row p2 h-last">
            <div className="task-title">
              <span className="h-last-k">Last Session</span>
              <div className="facts">
                <span className="fact h-last-day">{last.dayName}</span>
                <span className="fact">{capAfterNumber(agoPhrase(last.date, today))}</span>
                <span className="fact amber">{capAfterNumber(`${last.minutes} min`)}</span>
                {prFromLast && training?.pr && <span className="fact lime">{`PR ${training.pr.text}`}</span>}
              </div>
            </div>
            {CHEV}
          </div>
        )}
      </div></div>

      {/* DAILY LOG: one grid for the loggers and his own metrics (Dave
          2026-09-10), every tile an invitation to log (2026-09-13). */}
      <div className="sh2 sh2-quiet"><span className="t">Daily Log</span>
        <button className="see-all pill-action" onClick={onManageMetrics}>Add</button></div>
      <div className="pad-x"><div className="h-tiles">
        {healthLoggers.map((l) => loggerTile(l))}
        {water && waterTile(water)}
        {shownMetrics.map((d) => metricTile(d))}
        {shownMetrics.length === 0 && (
          <div {...pressable(onManageMetrics)} className="h-tile h-tile-add">
            <div className="ht-top">
              <span className="ht-ico" aria-hidden="true"><Plus className="ic" /></span>
              <span className="ht-w">Track More</span>
            </div>
            <div className="ht-n"><span className="ht-none">Add a Metric</span></div>
          </div>
        )}
      </div></div>
      {/* MEDICATION IS ITS OWN PAGE (Dave 2026-09-10), so it is a door, not a
          tile. The door says when the last dose was, in medication blue, and
          nothing else. */}
      {(onOpenMedication || onOpenHealthMore || onOpenSettings) && (
        <div className="pad-x h-doors"><div className="card list-card-ruled">
          {onOpenMedication && (
            <div {...pressable(onOpenMedication)} className="task-row p2">
              <div className="task-title"><span className="task-name">Medication</span></div>
              {medSub && <span className="h-door-v">{medSub}</span>}
              {CHEV}
            </div>
          )}
          {/* H-40: Health Settings, behind a door rather than a head, the
              way Dave asked this page kept simple (2026-09-13). */}
          {onOpenSettings && (
            <div {...pressable(onOpenSettings)} className="task-row p2">
              <div className="task-title"><span className="task-name">Settings</span></div>
              {CHEV}
            </div>
          )}
          {onOpenHealthMore && (
            <div {...pressable(onOpenHealthMore)} className="task-row p2">
              <div className="task-title"><span className="task-name">More</span></div>
              {CHEV}
            </div>
          )}
        </div></div>
      )}

      {/* THE LOG (H-48, Health Push C): today's entries in order, each a
          door back to the screen that made it. Absent until something is
          written today, so a quiet day adds no furniture. */}
      {log.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Log</span><span className="n">{log.length}</span></div>
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
        </>
      )}
      {/* H-53: one quiet receipt, what is still waiting to sync. Hidden at
          zero, so it only ever says something true. */}
      {pendingCount > 0 && (
        <div className="pad-x h-sync">{capAfterNumber(`${pendingCount} waiting to sync`)}</div>
      )}

      {/* The sections that hold something, then the findings, then the tail,
          and the creates last of all. */}
      {sections}

      {insights}

      {more}

      {adds}
    </>
  );
}

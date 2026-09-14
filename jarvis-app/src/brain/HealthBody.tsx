import { useMemo, useState, type ReactNode } from "react";
import type { Program, Workout } from "../gym/types";
import { nextDayFor, SCRATCH_DAY_ID, SCRATCH_DAY_NAME } from "../gym/nextDay";
import { buildLibrary } from "../gym/library";
import { todayDow } from "../gym/pins";
import { estimateDay } from "../gym/fit";
import { readGymSettings, rackFrom } from "../gym/settings";
import ActionSheet from "../gym/ActionSheet";
import { BarbellGlyph, MoonGlyph, ClockGlyph, PulseGlyph } from "../shared/glyphs";
import { Plus, Timer, FileText } from "../shared/icons";
import { capAfterNumber } from "../shared/casing";
import { fmtTime } from "../schedule/calendar";
import { monthDay } from "../money/bills";
import { pressable } from "../shared/pressable";
import { hoursLabel, weekdayShort, type PeriodOverview } from "../insights/analytics";
import type { Finding } from "../insights/findings";
import HealthNav, { type HealthView } from "../insights/HealthNav";

/** H-12 (Health Push C): the session waiting to be resumed, as the hero. */
export interface LiveHero { dayName: string; nextExercise: string | null; setNo: number; setTotal: number; logged: number }

// THE HEALTH LANDING PAGE, TO THE APPROVED DESIGN (Dave 2026-09-14, "Your
// week, in view."). The order is the design's: the week as one card (the
// range, the workout count, seven bars for seven real dates, working sets,
// training time, sleep over logged nights), the next workout as a compact
// card with Start, Adjust Time and Change Workout (Resume, and no Start,
// while a session is open), up to three findings under Your Progress with
// View Insights, then All Data and Log Something. Every number on the week
// card opens the records behind it; a bar opens that day. Every value is
// one of insights/analytics.ts's, the same functions Insights and the
// record browser read, so the page cannot disagree with them.
//
// The dress is the app's: black, charcoal cards, white text at full ink,
// the hues by meaning (lime for training, amber for time, violet for sleep,
// cyan for exploration, amber again for a record that needs a look).

const CHEV = <div className="chev" />;

// S5-Q29 (2026-09-04): the one-tap loggers, now the rows of Log Something.
export type HealthLoggerKey = "lightsOut" | "tookIt" | "callIt" | "pointAtIt" | "meal" | "checkin";
export interface HealthLoggerRow {
  key: HealthLoggerKey;
  label: string;
  sub: string;
  value: string | null;
}
/** One row of the Log Something sheet: a label and what tapping it does. */
export interface LogAction { label: string; onPick: () => void }

export type RecordsOpen =
  | { kind: "workouts" }
  | { kind: "sets" }
  | { kind: "sleep" }
  | { kind: "day"; date: string };

export default function HealthBody({
  program, workouts, overview, today, isEvening, gymEvent, findings,
  live = null, onResume, onStart, onAdjustTime, onOpenGym, onOpenRecords, onOpenFinding, onOpenInsights, onOpenAllData,
  logActions, onOpenSettings, sections, more, adds, view, onView, onOpenExercises, onOpenHistory,
}: {
  program: Program | null;
  workouts: Workout[];
  /** The last seven days, from insights/analytics.periodOverview. */
  overview: PeriodOverview;
  today: string;
  isEvening: boolean;
  gymEvent: { start: string } | null;
  findings: Finding[];
  live?: LiveHero | null;
  onResume?: () => void;
  /** Start a day by id (SCRATCH_DAY_ID for an empty session). */
  onStart: (dayId: string) => void;
  /** Adjust Time: the fit sheet, which previews the changes before the start. */
  onAdjustTime: (dayId: string) => void;
  onOpenGym: () => void;
  /** THE THREE DOORS (Cowork 2026-09-14, Dave: "Add a visible shortcut row
   *  near the top of Health, immediately below the weekly overview:
   *  Exercises · Program · History. Exercises must open the complete library
   *  in one tap. Do not bury it inside a program or More menu."). Optional:
   *  a caller without gym wiring renders no doors to nothing. */
  onOpenExercises?: () => void;
  onOpenHistory?: () => void;
  onOpenRecords: (o: RecordsOpen) => void;
  onOpenFinding: (f: Finding) => void;
  onOpenInsights: () => void;
  onOpenAllData: () => void;
  /** The rows of Log Something, built by the caller from what he tracks. */
  logActions: LogAction[];
  onOpenSettings?: () => void;
  /** Projects, Training Goals, Coming Up and Up Next, handed in once. */
  sections?: ReactNode;
  more?: ReactNode;
  adds?: ReactNode;
  view: HealthView;
  onView: (v: HealthView) => void;
}) {
  const [logOpen, setLogOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const dow = todayDow();
  const next = nextDayFor(program, workouts, dow);
  const est = next ? estimateDay(next.day, workouts, rackFrom(readGymSettings())).min : 0;
  const when = gymEvent
    ? `${isEvening ? "Tonight" : "Today"} ${fmtTime(gymEvent.start).time} ${fmtTime(gymEvent.start).ap}`
    : next?.when === "today" ? "Today" : next?.when === "tomorrow" ? "Tomorrow" : next?.when ? next.when : null;
  const days = (program?.data.weeks ?? []).flatMap((w) => w.days);
  // The count beside the Exercises door, from the same builder the library
  // itself is built from, so the badge and the page can never disagree.
  const exerciseCount = useMemo(() => buildLibrary(program ? [program] : [], workouts).length, [program, workouts]);
  const maxMin = Math.max(1, ...overview.days.map((d) => d.activeMin));
  const range = `${monthDay(overview.period.from)} to ${monthDay(overview.period.to)}`;
  const findGlyph = (f: Finding): ReactNode =>
    f.open.kind === "sleep" ? <MoonGlyph /> : f.open.kind === "assign" ? <PulseGlyph /> : f.open.kind === "duration" ? <Timer className="ic" /> : f.hue === "lime" ? <BarbellGlyph /> : <ClockGlyph />;

  return (
    <>
      <HealthNav view={view} onView={onView} />
      <div className="nav-large">Your Week, in View</div>

      {/* THE WEEK, IN VIEW. One period for every number on the card. */}
      <div className="pad-x"><div className="card h-week-card">
        <div className="h-week-top">
          <span className="h-eyebrow">Last 7 Days</span>
          <span className="fact">{range}</span>
        </div>
        <div className="h-week-main">
          <button type="button" className="h-week-count" aria-label={`${overview.workouts} workouts, open the workouts`} onClick={() => onOpenRecords({ kind: "workouts" })}>
            <b>{overview.workouts}</b><span>{overview.workouts === 1 ? "workout" : "workouts"}</span>
          </button>
          <div className="h-bars" role="group" aria-label="Workouts by day">
            {overview.days.map((d) => (
              <button type="button" key={d.date} className={"h-bar" + (d.workouts > 0 ? " on" : "") + (d.date === today ? " today" : "")}
                aria-label={`${weekdayShort(d.date)} ${monthDay(d.date)}${d.workouts > 0 ? `, ${d.workouts} ${d.workouts === 1 ? "workout" : "workouts"}` : ""}`}
                onClick={() => onOpenRecords({ kind: "day", date: d.date })}>
                <i style={{ height: d.workouts > 0 ? `${Math.max(12, Math.round((d.activeMin / maxMin) * 36))}px` : undefined }} />
                {weekdayShort(d.date)}
              </button>
            ))}
          </div>
        </div>
        <div className="h-stats">
          <button type="button" className="h-stat lime" onClick={() => onOpenRecords({ kind: "sets" })}>
            <b>{overview.workingSets}</b><span>Working Sets</span>
          </button>
          <button type="button" className="h-stat amber" onClick={() => onOpenRecords({ kind: "workouts" })}>
            <b>{overview.trainingMin}<small> min</small></b><span>Training Time</span>
          </button>
          <button type="button" className="h-stat violet" onClick={() => onOpenRecords({ kind: "sleep" })}>
            <b>{overview.sleep.avgHours != null ? hoursLabel(overview.sleep.avgHours) : "None"}</b>
            <span>{overview.sleep.nights > 0 ? `Sleep · ${overview.sleep.nights} ${overview.sleep.nights === 1 ? "night" : "nights"}` : "Sleep · Not logged"}</span>
          </button>
        </div>
      </div></div>

      {/* THE THREE DOORS, immediately under the week. Not a section of its
          own and not a menu: one row, three words, each one tap from the
          top of the page. */}
      {(onOpenExercises || onOpenHistory) && (
        <div className="pad-x"><div className="card h-doors">
          {onOpenExercises && (
            <button type="button" className="h-door" onClick={onOpenExercises}>
              <span className="h-door-k">Exercises</span>
              <span className="h-door-n">{exerciseCount}</span>
            </button>
          )}
          <button type="button" className="h-door" onClick={onOpenGym}>
            <span className="h-door-k">Program</span>
            <span className="h-door-n">{days.length}</span>
          </button>
          {onOpenHistory && (
            <button type="button" className="h-door" onClick={onOpenHistory}>
              <span className="h-door-k">History</span>
              <span className="h-door-n">{workouts.length}</span>
            </button>
          )}
        </div></div>
      )}

      {/* NEXT WORKOUT. Resume while a session is open, and no Start beside it. */}
      <div className="pad-x h-hero-wrap"><div className="card list-card-ruled h-hero-card">
        <div className="h-hero-head">
          <span className="h-eyebrow">{live ? "Session Open" : "Next Workout"}</span>
          {program && <button type="button" className="pill-act pill-quiet" onClick={onOpenGym}>Program</button>}
        </div>
        {live ? (
          <>
            <div {...pressable(onResume ?? onOpenGym)} className="h-hero">
              <span className="h-hero-ico"><BarbellGlyph /></span>
              <div className="h-hero-b">
                <div className="h-hero-t">{live.dayName}</div>
                <div className="facts h-hero-facts">
                  {live.nextExercise && <span className="fact cyan">{`Next: ${live.nextExercise}`}</span>}
                  <span className="fact lime">{capAfterNumber(`${live.logged} logged`)}</span>
                </div>
              </div>
              {CHEV}
            </div>
            <div className="h-hero-cta">
              <button type="button" className="btn btn-primary btn-block" onClick={onResume ?? onOpenGym}>Resume Workout</button>
            </div>
          </>
        ) : next ? (
          <>
            <div {...pressable(onOpenGym)} className="h-hero">
              <span className="h-hero-ico"><BarbellGlyph /></span>
              <div className="h-hero-b">
                <div className="h-hero-t">{next.day.name}</div>
                <div className="facts h-hero-facts">
                  {when && <span className="fact">{when}</span>}
                  <span className="fact lime">{capAfterNumber(`${next.day.exercises.length} ${next.day.exercises.length === 1 ? "exercise" : "exercises"}`)}</span>
                  {est > 0 && <span className="fact amber">{capAfterNumber(`About ${est} min`)}</span>}
                </div>
              </div>
              {CHEV}
            </div>
            <div className="h-hero-cta">
              <button type="button" className="btn btn-primary btn-block" onClick={() => onStart(next.day.id)}>Start Workout</button>
            </div>
            <div className="h-next-acts">
              {est > 0 && <button type="button" className="pill-act pill-quiet" onClick={() => onAdjustTime(next.day.id)}>Adjust Time</button>}
              <button type="button" className="pill-act pill-quiet" onClick={() => setChangeOpen(true)}>Change Workout</button>
            </div>
          </>
        ) : (
          <div {...pressable(onOpenGym)} className="h-hero">
            <span className="h-hero-ico"><BarbellGlyph /></span>
            <div className="h-hero-b"><div className="h-hero-t">{program ? program.data.name : "Set Up a Program"}</div></div>
            {CHEV}
          </div>
        )}
      </div></div>

      {/* YOUR PROGRESS: up to three findings, each a door to its records. */}
      <div className="sh2 sh2-quiet"><span className="t">Your Progress</span>
        <button className="see-all pill-action" onClick={onOpenInsights}>View Insights</button></div>
      <div className="pad-x"><div className="card list-card-ruled">
        {findings.length === 0 ? (
          <div className="row"><div className="row-grow">
            <div className="conn-name">Nothing to Read Yet</div>
            <div className="facts"><span className="fact">A logged workout or a night of sleep is enough to start</span></div>
          </div></div>
        ) : findings.map((f) => (
          <div {...pressable(() => onOpenFinding(f))} className="task-row p2 h-find" key={f.id}>
            <span className="h-log-ico" data-hue={f.hue} aria-hidden="true">{findGlyph(f)}</span>
            <div className="task-title">
              <span className="task-name">{f.title}</span>
              <div className="facts">
                <span className={"fact " + f.hue}>{f.value}</span>
                <span className="fact">{f.context}</span>
              </div>
              {f.action && <div className="facts"><span className="fact cyan">{f.action}</span></div>}
            </div>
            {CHEV}
          </div>
        ))}
      </div></div>

      {/* DATA ACCESS: the records, and a log, without hunting for either. */}
      <div className="pad-x h-foot-acts">
        <button type="button" className="btn btn-secondary" onClick={onOpenAllData}><FileText className="ic" />All Data</button>
        <button type="button" className="btn btn-secondary" onClick={() => setLogOpen(true)}><Plus className="ic" />Log Something</button>
      </div>
      {onOpenSettings && (
        <div className="pad-x h-foot-acts"><button type="button" className="btn btn-tertiary" onClick={onOpenSettings}>Customize</button></div>
      )}

      {sections}
      {more}
      {adds}

      {logOpen && (
        <ActionSheet title="Log Something" actions={logActions.map((a) => ({ label: a.label, onClick: a.onPick }))} onClose={() => setLogOpen(false)} />
      )}
      {changeOpen && (
        <ActionSheet
          title="Change Workout"
          actions={[
            ...days.filter((d) => d.id !== next?.day.id).map((d) => ({ label: d.name, onClick: () => onStart(d.id) })),
            { label: SCRATCH_DAY_NAME, onClick: () => onStart(SCRATCH_DAY_ID) },
          ]}
          onClose={() => setChangeOpen(false)}
        />
      )}
    </>
  );
}

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
          {/* NOTHING LOGGED IS NOT A READING (polish pass 2026-09-16; the
              handoff names this one: "show a dash with Sleep not logged; never
              zero or the large purple word None").

              "None" sat at the same 28px in the same violet as a real average,
              so an empty tile shouted louder than seven hours of sleep and the
              eye read it as a value. A dash is the app saying it has nothing,
              at the weight that deserves, and the label under it says which
              nothing. The hue goes with the number: a dash is not a datum, and
              a hue on a non-datum is the failure health skin law 2 exists for.

              AN EN DASH, NOT AN EM DASH (Dave's pick, polish conflict 1). The
              app bans U+2014 outright (laws.test.ts:63) and the two files that
              may carry one are both about quoting somebody else's punctuation.
              At this size the two are all but indistinguishable. */}
          <button type="button" className="h-stat violet" onClick={() => onOpenRecords({ kind: "sleep" })}>
            {overview.sleep.avgHours != null ? (
              <b>{hoursLabel(overview.sleep.avgHours)}</b>
            ) : (
              <b className="h-stat-none" aria-label="No sleep logged">{"\u2013"}</b>
            )}
            <span>{overview.sleep.nights > 0 ? capAfterNumber(`Sleep · ${overview.sleep.nights} ${overview.sleep.nights === 1 ? "night" : "nights"}`) : "Sleep Not Logged"}</span>
          </button>
        </div>
      </div></div>

      {/* THE THREE DOORS, immediately under the week (Dave 2026-09-14: "Add a
          visible shortcut row near the top of Health, immediately below the
          weekly overview... Do not bury it"). HealthDoors.test.tsx holds them
          to that position.

          A COUNT SAYS WHAT IT COUNTS (Dave 2026-09-16, picking "keep your
          order, take the better rows" off the polish comparison). They used to
          be three words in a strip with a bare number under each: "24" told
          you nothing without reading the word above it, and a strip of three
          buttons is not a shape this app uses anywhere else. They are the
          app's own rows now -- name, value, chevron -- so they read like every
          other navigation row on a ruled page, and the count carries its noun
          through capAfterNumber like every other counted line in the app.

          The polish mockup moved this block BELOW the next workout, under a
          "Your Health" head. That was declined: on a phone it lands about
          600px down past two cards, which is the burying the 09-14 note was
          written against. Position is his; the row treatment is the mockup's. */}
      {(onOpenExercises || onOpenHistory) && (
        <div className="pad-x"><div className="card list-card-ruled h-doors">
          {onOpenExercises && (
            <button type="button" className="h-door" onClick={onOpenExercises}>
              <span className="h-door-k">Exercises</span>
              <span className="h-door-n">{capAfterNumber(`${exerciseCount} ${exerciseCount === 1 ? "exercise" : "exercises"}`)}</span>
              {CHEV}
            </button>
          )}
          <button type="button" className="h-door" onClick={onOpenGym}>
            <span className="h-door-k">Program</span>
            <span className="h-door-n">{capAfterNumber(`${days.length} ${days.length === 1 ? "day" : "days"}`)}</span>
            {CHEV}
          </button>
          {onOpenHistory && (
            <button type="button" className="h-door" onClick={onOpenHistory}>
              <span className="h-door-k">History</span>
              <span className="h-door-n">{capAfterNumber(`${workouts.length} ${workouts.length === 1 ? "session" : "sessions"}`)}</span>
              {CHEV}
            </button>
          )}
        </div></div>
      )}

      {/* NEXT WORKOUT. Resume while a session is open, and no Start beside it. */}
      <div className="pad-x h-hero-wrap"><div className="card list-card-ruled h-hero-card">
        <div className="h-hero-head">
          <span className="h-eyebrow">{live ? "Session Open" : "Next Workout"}</span>
          {/* NOT A GREY PILL (polish pass 2026-09-16, rule 2: "Remove isolated
              grey pill buttons... Replace each according to meaning"). This one
              only ever navigated, and a .pill-act is the app's word for a verb
              that acts on the row it sits in. It is the head's own text action
              now -- the same .see-all every section head in the app uses -- and
              it says WHICH program it opens rather than the word "Program",
              which the door below already says. */}
          {program && (
            <button type="button" className="see-all" onClick={onOpenGym}>
              {program.data.name}
            </button>
          )}
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
      {/* .see-all alone, not .see-all.pill-action: the capsule made a section
          link look like a control (polish rule 2). The head action is red text
          on the head's own baseline, which is what it is everywhere else. */}
      <div className="sh2 sh2-quiet"><span className="t">Your Progress</span>
        <button className="see-all" onClick={onOpenInsights}>View Insights</button></div>
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

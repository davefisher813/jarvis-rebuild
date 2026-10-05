import { useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Program, Workout } from "../gym/types";
import { nextDayFor, SCRATCH_DAY_ID, SCRATCH_DAY_NAME } from "../gym/nextDay";
import { seedsFromSettings, shownLibraryCount, shownSignature } from "../gym/libraryView";
import { todayDow } from "../gym/pins";
import { estimateDay } from "../gym/fit";
import { readGymSettings, rackFrom } from "../gym/settings";
import ActionSheet from "../gym/ActionSheet";
import { BarbellGlyph, MoonGlyph, ClockGlyph, PulseGlyph } from "../shared/glyphs";
import { Timer } from "../shared/icons";
import { lineCase } from "../shared/casing";
import { spanLabel } from "../shared/duration";
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
// card with Start (Resume, and no Start, while a session is open), up to
// three findings under Your Progress, then the Insights and All Data doors.
//
// CLEAN ROWS, NO PILLS (Dave 2026-10-05, locked). The next workout is a ROW:
// tap it and its sheet holds every action, Start first and filled, then
// Adjust Time and Change Workout beneath it. Start Workout stays on the card
// as this screen's one filled primary. Log Something is the Your Progress
// head's own capsule (a section-level action lives in the head); Insights and
// All Data are door rows like Exercises and Program; Customize is a door in
// the first card. Add Task, Add Event and Add Project are their sections'
// heads (CategoryDetail). Every number on the week
// card opens the records behind it; a bar opens that day. Every value is
// one of insights/analytics.ts's, the same functions Insights and the
// record browser read, so the page cannot disagree with them.
//
// The dress is the app's: black, charcoal cards, white text at full ink,
// and colour only for a meaning in the Colour Key (§AM, 2026-09-22): lime
// for what is logged, sky for what the app estimated, and a measured number
// with no state in white. Time and sleep used to wear amber and violet for
// WHAT they were, which the key does not give a colour to.

const CHEV = <div className="chev" />;

// S5-Q29 (2026-09-04): the one-tap loggers, now the rows of Log Something.
export type HealthLoggerKey = "lightsOut" | "tookIt" | "callIt" | "pointAtIt" | "meal" | "checkin";
/** One row of the Log Something sheet: a label and what tapping it does. */
export interface LogAction { label: string; onPick: () => void }

export type RecordsOpen =
  | { kind: "workouts" }
  | { kind: "sets" }
  | { kind: "sleep" }
  | { kind: "day"; date: string };

export default function HealthBody({
  program, libraryPrograms, workouts, overview, today, isEvening, gymEvent, findings,
  live = null, onResume, onStart, onAdjustTime, onOpenGym, onOpenRecords, onOpenFinding,
  logActions, onOpenSettings, sections, more, view, onView, onOpenExercises, onOpenHistory,
}: {
  program: Program | null;
  /** Every program, archived ones too: what the Exercises page builds from.
   *  Optional so a caller that only has the active one still counts honestly. */
  libraryPrograms?: Program[];
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
  /** The rows of Log Something, built by the caller from what he tracks. */
  logActions: LogAction[];
  onOpenSettings?: () => void;
  /** Projects, Training Goals, Coming Up and Up Next, handed in once. */
  sections?: ReactNode;
  more?: ReactNode;
  view: HealthView;
  onView: (v: HealthView) => void;
}) {
  const [logOpen, setLogOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [nextOpen, setNextOpen] = useState(false);
  const dow = todayDow();
  const next = nextDayFor(program, workouts, dow);
  const est = next ? estimateDay(next.day, workouts, rackFrom(readGymSettings())).min : 0;
  const when = gymEvent
    ? `${isEvening ? "Tonight" : "Today"} ${fmtTime(gymEvent.start).time}\u00a0${fmtTime(gymEvent.start).ap}`
    : next?.when === "today" ? "Today" : next?.when === "tomorrow" ? "Tomorrow" : next?.when ? next.when : null;
  // TODAY AND TOMORROW ARE DUE, SO AMBER; a later day is a neutral date in small caps (R8, D4; the round-2 review: "Health . TODAY"
  // drawn grey on the Next Workout card while the same word was amber on a task row). The time is never split from AM or PM.
  const whenTone = when && /^(Today|Tonight|Tomorrow)\b/.test(when) ? "warn" : "date";
  const days = (program?.data.weeks ?? []).flatMap((w) => w.days);
  // The count beside the Exercises door is the number of rows the Exercises
  // page lists when it opens (gym/libraryView.shownLibraryCount, the same
  // default view the page draws): every program, archived ones included, every
  // finished workout and the lifts added by hand, less the ones archived or
  // hidden, which sit behind the page's Archived and Hidden chips. It counted
  // only the active program's lifts and logged workouts, so a tester who added
  // four exercises by hand saw "0 Exercises" beside a list of four
  // (2026-09-30), and then it counted an archived exercise the page had
  // already taken off the list (2026-10-01). The hand-made, hidden and archived
  // state live in GymSettings, so they are read here the way the page reads
  // them and the memo is keyed on a signature of them.
  const gymSeeds = seedsFromSettings(readGymSettings());
  const seedSig = shownSignature(gymSeeds);
  const exerciseCount = useMemo(
    () => shownLibraryCount(libraryPrograms ?? (program ? [program] : []), workouts, gymSeeds),
    // gymSeeds is re-read every render; seedSig is its signature.
    [libraryPrograms, program, workouts, seedSig],
  );
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
          <span className="fact date">{range}</span>
        </div>
        <div className="h-week-main">
          <button type="button" className={"h-week-count" + (overview.workouts === 0 ? " zero" : "")} aria-label={`${overview.workouts} workouts, open the workouts`} onClick={() => onOpenRecords({ kind: "workouts" })}>
            {/* TITLE CASE, LIKE EVERY OTHER LABEL ON THIS CARD (Dave
                2026-09-17: "workouts doesn't follow title case rules").
                Working Sets and Training Time sit two rows below in the same
                type at the same size; this one word was lowercase, which read
                as a typo rather than as a different kind of thing. */}
            <b>{overview.workouts}</b><span>{overview.workouts === 1 ? "Workout" : "Workouts"}</span>
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
          <button type="button" className={"h-stat" + (overview.workingSets > 0 ? " lime" : "")} onClick={() => onOpenRecords({ kind: "sets" })}>
            <b>{overview.workingSets}</b><span>Working Sets</span>
          </button>
          <button type="button" className="h-stat" onClick={() => onOpenRecords({ kind: "workouts" })}>
            <b>{overview.trainingMin < 60 ? <>{overview.trainingMin}<small> Min</small></> : spanLabel(overview.trainingMin)}</b><span>Training Time</span>
          </button>
          {/* NOTHING LOGGED IS NOT A READING (polish pass 2026-09-16; the
              handoff names this one: "show a dash with Sleep not logged; never
              zero or the large purple word None").

              "None" sat at the same 28px in the same violet as a real average,
              so an empty tile shouted louder than seven hours of sleep and the
              eye read it as a value. A dash is the app saying it has nothing,
              at the weight that deserves, and the label under it says which
              nothing. A dash is not a datum, so it steps down to the grey.
              (The average itself is white since 2026-09-26: a measured number
              with no state, which is the Colour Key's white, not violet.)

              AN EN DASH, NOT AN EM DASH (Dave's pick, polish conflict 1). The
              app bans U+2014 outright (laws.test.ts:63) and the two files that
              may carry one are both about quoting somebody else's punctuation.
              At this size the two are all but indistinguishable. */}
          <button type="button" className="h-stat" onClick={() => onOpenRecords({ kind: "sleep" })}>
            {overview.sleep.avgHours != null ? (
              <b>{hoursLabel(overview.sleep.avgHours)}</b>
            ) : (
              <b className="h-stat-none" aria-label="No sleep logged">{"\u2013"}</b>
            )}
            <span>{overview.sleep.nights > 0 ? `Sleep Across ${overview.sleep.nights} ${overview.sleep.nights === 1 ? "Night" : "Nights"}` : "Sleep Not Logged"}</span>
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
          through lineCase like every other counted line in the app.

          The polish mockup moved this block BELOW the next workout, under a
          "Your Health" head. That was declined: on a phone it lands about
          600px down past two cards, which is the burying the 09-14 note was
          written against. Position is his; the row treatment is the mockup's. */}
      {(onOpenExercises || onOpenHistory || onOpenSettings) && (
        <div className="pad-x"><div className="card list-card-ruled h-doors">
          {onOpenExercises && (
            <button type="button" className="h-door" onClick={onOpenExercises}>
              <span className="h-door-k">Exercises</span>
              <span className="h-door-n">{lineCase(`${exerciseCount} ${exerciseCount === 1 ? "exercise" : "exercises"}`)}</span>
              {CHEV}
            </button>
          )}
          <button type="button" className="h-door" onClick={onOpenGym}>
            <span className="h-door-k">Program</span>
            <span className="h-door-n">{lineCase(`${days.length} ${days.length === 1 ? "day" : "days"}`)}</span>
            {CHEV}
          </button>
          {onOpenHistory && (
            <button type="button" className="h-door" onClick={onOpenHistory}>
              <span className="h-door-k">History</span>
              <span className="h-door-n">{lineCase(`${workouts.length} ${workouts.length === 1 ? "session" : "sessions"}`)}</span>
              {CHEV}
            </button>
          )}
          {onOpenSettings && (
            <button type="button" className="h-door" onClick={onOpenSettings}>
              <span className="h-door-k">Customize</span>
              {CHEV}
            </button>
          )}
        </div></div>
      )}

      {/* NEXT WORKOUT. Resume while a session is open, and no Start beside it. */}
      <div className="pad-x h-hero-wrap"><div className="card list-card-ruled h-hero-card">
        <div className="h-hero-head">
          <span className="h-eyebrow">{live ? "Session Open" : "Next Workout"}</span>
        </div>
        {live ? (
          <>
            <div {...pressable(onResume ?? onOpenGym)} className="h-hero">
              <span className="h-hero-ico"><BarbellGlyph /></span>
              <div className="h-hero-b">
                <div className="h-hero-t">{live.dayName}</div>
                <div className="facts h-hero-facts">
                  {live.nextExercise && <span className="fact cyan">{`Next: ${live.nextExercise}`}</span>}
                  <span className="fact lime">{lineCase(`${live.logged} logged`)}</span>
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
            <div {...pressable(() => setNextOpen(true))} className="h-hero">
              <span className="h-hero-ico"><BarbellGlyph /></span>
              <div className="h-hero-b">
                <div className="h-hero-t">{next.day.name}</div>
                <div className="facts h-hero-facts">
                  {when && <span className={"fact " + whenTone}>{when}</span>}
                  {/* A PLAIN COUNT IS WHITE, NEVER LIME (the ship-blocker review): lime is
                      "what is logged" in the Colour Key, and an exercise count on a
                      workout that has not started logs nothing. It read lime in dark
                      and neutral grey in light; a measured number with no state is
                      the one white, the same in both themes (§AM). */}
                  <span className="fact"><b>{lineCase(`${next.day.exercises.length} ${next.day.exercises.length === 1 ? "exercise" : "exercises"}`)}</b></span>
                  {/* The sky ink already says estimate, so no "About"
                      (2026-09-26): with it, the line cut the number away
                      at type scale 1.4 ("Abo..."). */}
                  {est > 0 && <span className="fact est">{spanLabel(est)}</span>}
                </div>
              </div>
              {CHEV}
            </div>
            <div className="h-hero-cta">
              <button type="button" className="btn btn-primary btn-block" onClick={() => onStart(next.day.id)}>Start Workout</button>
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

      {/* YOUR PROGRESS: up to three findings, each a door to its records. Log Something is the section's own action, so it
          is the head's capsule (Dave 2026-10-05, locked: a section-level action lives in the head, never in a card). */}
      <div className="sh2 sh2-quiet"><span className="t">Your Progress</span>
        <button type="button" className="see-all pill-action" onClick={() => setLogOpen(true)}>Log Something</button></div>
      <div className="pad-x"><div className="card list-card-ruled">
        {findings.length === 0 ? (
          /* An empty state, not a placeholder row (Colour Key, 2026-09-26): a
             row with nothing to say shows nothing. Its door is Log Something,
             in the head above it, so it carries no second one. */
          <div className="empty-state empty-compact">
            <div className="empty-icon cat-fg-green"><PulseGlyph /></div>
            <div className="empty-title">Nothing to Read Yet</div>
            <div className="empty-sub">A logged workout or a night of sleep is enough to start</div>
          </div>
        ) : findings.map((f) => (
          <div {...pressable(() => onOpenFinding(f))} className="task-row p2 h-find" key={f.id}>
            <span className="h-log-ico" data-hue={f.hue} aria-hidden="true">{findGlyph(f)}</span>
            <div className="task-title">
              <span className="task-name">{f.title}</span>
              {/* ONE SPAN PER FACT (2026-09-16, Dave's Health screenshot:
                  "· +140 lb at 2 reps since 2026-08-24 · 6 compa…"). The
                  context was one long string with its own middots in it, so
                  it could not wrap the way a row of facts does: it either ran
                  off the end of the row or wrapped and left the separator
                  leading the new line. components.css draws the separator
                  between facts; the finding hands over facts now. */}
              <div className="facts">
                {/* A reading with no state (the sleep average) is the key's
                    white, never a hue; the hue stays on the glyph. */}
                {f.plainValue
                  ? <span className="fact"><b>{f.value}</b></span>
                  : <span className={"fact " + f.hue}>{f.value}</span>}
                {f.context.map((c) => <span className="fact" key={c}>{c}</span>)}
              </div>
            </div>
            {CHEV}
          </div>
        ))}
      </div></div>

      {/* (Insights and All Data are the segmented control at the top of this page; they were also two door rows here, one screen
          down, which said the same two things twice. Dave 2026-10-05, the round-2 review: redundant navigation.) */}

      {sections}
      {more}

      {logOpen && (
        <ActionSheet title="Log Something" actions={logActions.map((a) => ({ label: a.label, onClick: a.onPick }))} onClose={() => setLogOpen(false)} />
      )}
      {nextOpen && next && createPortal(
        <div className="sheet-scrim" onClick={() => setNextOpen(false)}>
          <div className="card" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="grp"><div className="eyebrow">Next Workout</div></div>
            <div className="pad-x sheet-form">
              <div className="strand-head">{next.day.name}</div>
              <div className="facts">
                {when && <span className={"fact " + whenTone}>{when}</span>}
                <span className="fact"><b>{lineCase(`${next.day.exercises.length} ${next.day.exercises.length === 1 ? "exercise" : "exercises"}`)}</b></span>
                {est > 0 && <span className="fact est">{spanLabel(est)}</span>}
              </div>
            </div>
            <div className="pad-x sheet-actions">
              <button type="button" className="btn btn-primary btn-block" onClick={() => { setNextOpen(false); onStart(next.day.id); }}>Start Workout</button>
              {est > 0 && <button type="button" className="btn btn-secondary btn-block" onClick={() => { setNextOpen(false); onAdjustTime(next.day.id); }}>Adjust Time</button>}
              <button type="button" className="btn btn-secondary btn-block" onClick={() => { setNextOpen(false); setChangeOpen(true); }}>Change Workout</button>
              <button type="button" className="btn btn-secondary btn-block" onClick={() => { setNextOpen(false); onOpenGym(); }}>Open Program</button>
              <button type="button" className="btn btn-tertiary btn-block" onClick={() => setNextOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>,
        document.body,
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

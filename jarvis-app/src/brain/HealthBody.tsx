import type { ReactNode } from "react";
import type { Program, Workout } from "../gym/types";
import type { TrainingSummary } from "../gym/summary";
import { agoPhrase } from "../gym/summary";
import type { MetricDef, MetricLog } from "../gym/metrics";
import { activeMetrics, numericValue } from "../gym/metrics";
import { nextDayFor, SCRATCH_DAY_ID, SCRATCH_DAY_NAME } from "../gym/nextDay";
import { todayDow } from "../gym/pins";
import { estimateDay } from "../gym/fit";
import { readGymSettings, rackFrom } from "../gym/settings";
import { BarbellGlyph } from "../shared/glyphs";
import { capAfterNumber } from "../shared/casing";
import { fmtTime } from "../schedule/calendar";
import { dayPhrase } from "../money/bills";
import { pressable } from "../shared/pressable";

// THE HEALTH PAGE (Check, Health, Stop, Dave 2026-09-02: "The next session,
// then the week, then the numbers"; after "I don't like any of these" on
// three frames around the old content).
//
// The page leads with the one thing you came to do: the next session, as a
// hero with Start on it, and the week as seven dots under it. Then the
// numbers you track as tiles, each with a sparkline where there is history.
// Then the goals that reach here as the ruled goal row, and Up Next as
// ruled task rows. No "This Week · 1 EVENT" tile and no Coming Up band:
// the session is the event. Everything derived, nothing scored, and every
// section that has nothing to say renders nothing.

const CHEV = <div className="chev" />;
const DAYS = ["M", "T", "W", "T", "F", "S", "S"];

// S5-Q29 (2026-09-04): the four highest-value loggers from the dormant
// Health module (Track 3's student-athlete health track), grafted onto this
// page rather than standing up a whole new tab. "Highest-value" here means
// exactly the module's own labeled group, minus Ate Before: Lights Out,
// Took It, Call It and Point at It never need anything from outside
// HealthService to be useful; Ate Before's screen expects a list of
// today's practice/game calendar candidates, a real integration question
// this page has no answer to yet, so it stays dormant with the rest.
export type HealthLoggerKey = "lightsOut" | "tookIt" | "callIt" | "pointAtIt";
export interface HealthLoggerRow {
  key: HealthLoggerKey;
  label: string;
  /** What tapping it does. Always said, including before the first log. */
  sub: string;
  /** The last thing logged, short enough for a tile's value slot ("Today",
   *  "7/10"). Null before anything is logged, and the tile says Log it. */
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

function Spark({ pts }: { pts: number[] }) {
  if (pts.length < 2) return null;
  const w = 64, h = 22, lo = Math.min(...pts), hi = Math.max(...pts), rng = hi - lo || 1;
  const xy = pts.map((p, i) => [i * (w - 2) / (pts.length - 1) + 1, h - 2 - (p - lo) * (h - 4) / rng] as const);
  const d = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = xy[xy.length - 1]!;
  return (
    <svg className="ht-spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx.toFixed(1)} cy={ly.toFixed(1)} r={2.6} fill="currentColor" />
    </svg>
  );
}

export default function HealthBody({
  program, workouts, training, today, isEvening, gymEvent, metricDefs, metricLogs,
  onStart, onOpenGym, onOpenMetric, onManageMetrics, insights, sections, more,
  healthLoggers, onOpenHealthLogger, onOpenHealthMore, onOpenMedication, medSub,
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
  /** Projects, Goals Here, Coming Up and Up Next: the four sections EVERY
   *  area page shows, defined once by CategoryDetail and handed in, so the
   *  health page cannot grow a second copy of them (Dave 2026-09-10:
   *  "there's duplicate add buttons on the page"). */
  sections?: ReactNode;
  /** Streaks, notes, the week's receipt: the quiet tail, as handed in. */
  more?: ReactNode;
  /** S5-Q29: the grafted one-tap loggers, in display order. */
  healthLoggers: HealthLoggerRow[];
  onOpenHealthLogger: (key: HealthLoggerKey) => void;
  /** Dave 2026-09-10: "medication related stuff should all be its own page."
   *  The door to it, and the one line it says about itself. */
  onOpenMedication?: () => void;
  medSub?: string | null;
  /** HMN-F-06 (2026-09-05): the door to the rest of the health module.
   *  Absent on every template but Student, and the row is absent with it:
   *  a row that opens nothing is worse than no row. */
  onOpenHealthMore?: () => void;
}) {
  const dow = todayDow();
  const next = nextDayFor(program, workouts, dow);
  const est = next ? estimateDay(next.day, workouts, rackFrom(readGymSettings())).min : 0;
  const when = gymEvent
    ? `${isEvening ? "Tonight" : "Today"} ${fmtTime(gymEvent.start).time} ${fmtTime(gymEvent.start).ap}`
    : next?.when === "today" ? "Today" : next?.when === "tomorrow" ? "Tomorrow" : next?.when ? next.when : "Next up";
  // The hero's own facts, as chips rather than a middot sentence (Dave
  // 2026-09-10: "kill grey subtext throughout"). When leads, because it is
  // the one that decides whether you are doing this now.
  const heroChips = next
    ? [
        { k: "", v: when, hue: "se-chip-time" },
        { k: next.day.exercises.length === 1 ? "Lift" : "Lifts", v: String(next.day.exercises.length), hue: "se-chip-last" },
        ...(est > 0 ? [{ k: "Min", v: String(est), hue: "se-chip-budget" }] : []),
      ]
    : null;
  const dots = training?.weekDots ?? new Array<boolean>(7).fill(false);
  const shownMetrics = activeMetrics(metricDefs);
  // Every day of the program except the one already offered above it.
  const otherDays = (program?.data.weeks ?? []).flatMap((w) => w.days).filter((d) => d.id !== next?.day.id);

  // THE ACTIVITY RAMP, ASSIGNED (Dave 2026-09-10: "the lack of color is a
  // major issue in the health pages... All workout apps are vibrant with
  // colors. Especially neon colors"). Every tile in the log grid takes a hue
  // off the ramp by its position, the way Fitness gives move, exercise and
  // stand each their own. Stable per position rather than random, so a tile
  // does not change colour when another one is logged, and the same metric
  // keeps the same colour every time the page is opened.
  const RAMP = ["hl-lime", "hl-cyan", "hl-pink", "hl-violet", "hl-amber", "hl-blue"];
  const hueAt = (i: number) => RAMP[i % RAMP.length]!;

  const metricTile = (def: MetricDef, i: number) => {
    const mine = metricLogs.filter((l) => l.data.metricId === def.id && l.data.date <= today).sort((a, b) => a.data.date.localeCompare(b.data.date));
    const latest = mine[mine.length - 1];
    const val = tileValue(def, latest);
    const pts = def.data.type === "yesno" ? [] : mine.slice(-7).map((l) => numericValue(def.data, l)).filter((n): n is number => n != null);
    // One line when empty (Dave 2026-09-02: "Either log it or not logged
    // yet. No need for both"): the value slot says Log it, and there is no
    // meta line until there is a log to date.
    const meta = !latest ? null : latest.data.date === today ? "Today" : (() => { const p = dayPhrase(latest.data.date, today); return p.charAt(0).toUpperCase() + p.slice(1); })();
    return (
      <div {...pressable(() => onOpenMetric(def))} className={"h-tile hue-" + hueAt(i)} key={def.id}>
        <div className="ht-w">{def.data.name}</div>
        <div className="ht-n">
          {val ? val.map((p, j) => <span key={j}>{p.big}{p.small && <small>{p.small}</small>}</span>) : <span className="ht-none">Log it</span>}
        </div>
        {meta && <div className="ht-m">{meta}</div>}
        {pts.length >= 2 && <Spark pts={pts} />}
      </div>
    );
  };

  // ONE PLACE TO LOG (Dave 2026-09-10: "Daily logs should be combined with
  // metrics in the most efficient way possible"). Daily Log was four rows in
  // a card and Metrics was a grid of tiles directly under it: two heads, two
  // shapes, two scroll-lengths, for the one question "what am I writing down
  // today". They are one grid now. A logger tile carries the same three slots
  // a metric tile does -- the name, the value or Log it, and when it last
  // happened -- so nothing had to be invented to make them sit together.
  const loggerTile = (l: HealthLoggerRow, i: number) => (
    <div {...pressable(() => onOpenHealthLogger(l.key))} className={"h-tile hue-" + hueAt(i)} key={l.key}>
      <div className="ht-w">{l.label}</div>
      <div className="ht-n">{l.value ? <span>{l.value}</span> : <span className="ht-none">Log it</span>}</div>
      <div className="ht-m">{l.sub}</div>
    </div>
  );

  return (
    <>
      {/* TRAINING: A CHOICE, NOT A VERDICT (Dave 2026-09-10: "It almost always
          says leg day. There's not even a header above it. It should encourage
          the user to select a workout for the day or begin one from scratch.
          It can suggest one based on that day that's fine but this is a
          terrible way to start the page as of now").
          Three things were wrong. The card was the first thing on the page
          with no head over it, so it read as chrome rather than a section. It
          named one day and gave one button, which presents a decision already
          made -- and if the rotation's pick is not what he is doing today, the
          page has nothing for him. And there was no way at all to log a
          session that is not in the program.
          So: the suggestion still leads, and says out loud that it is a
          suggestion; every OTHER day of the program sits under it as a chip
          that starts it in one tap; and Open Session starts an empty one he
          fills as he goes. Nothing about how a session is stored moves. */}
      <div className="sh2 sh2-quiet"><span className="t">Training</span>
        <button className="see-all pill-action" onClick={onOpenGym}>Program</button></div>
      <div className="pad-x h-hero-wrap"><div className="card list-card-ruled h-hero-card">
        {next ? (
          <div {...pressable(onOpenGym)} className="h-hero">
            <span className="h-hero-ico"><BarbellGlyph /></span>
            <div className="h-hero-b">
              <div className="h-hero-t">{next.day.name}</div>
              {heroChips && (
                <div className="se-chips h-hero-chips">
                  {heroChips.map((c) => (
                    <span className={"se-chip " + c.hue} key={c.k + c.v}>{c.v}{c.k && <em>{c.k}</em>}</span>
                  ))}
                </div>
              )}
            </div>
            <button className="pill-act" onClick={(e) => { e.stopPropagation(); onStart(next.day.id); }}>Start</button>
          </div>
        ) : (
          <div {...pressable(onOpenGym)} className="h-hero">
            <span className="h-hero-ico"><BarbellGlyph /></span>
            <div className="h-hero-b">
              <div className="h-hero-t">{program ? program.data.name : "Set Up a Program"}</div>
              <div className="h-hero-s">{program ? "Add a day to train" : "A few lifts, a few days, and the page fills itself"}</div>
            </div>
            {CHEV}
          </div>
        )}
        {/* The rest of the week's work, one tap each. The suggested day is not
            repeated here -- it is the button above.
            OPEN SESSION DOES NOT SCROLL (Dave 2026-09-10: "There is no 'open
            session' button anywhere. It needs to be visible in the card"). It
            WAS there, at the end of the chip run, which on a five-day program
            is two swipes off the right edge of the phone -- so the one option
            that does not depend on the program was the one option he could
            not see. It sits outside the scroller now, pinned to the end of
            the row: the program days scroll past it, it never moves. */}
        {program && (
          <div className="h-pick-wrap">
            <div className="h-pick" role="group" aria-label="Start another session">
              {otherDays.map((d) => (
                <button className="h-pick-c" key={d.id} onClick={() => onStart(d.id)}>{d.name}</button>
              ))}
            </div>
            <button className="h-pick-c h-pick-new" onClick={() => onStart(SCRATCH_DAY_ID)}>{SCRATCH_DAY_NAME}</button>
          </div>
        )}
        <div className="h-week" aria-label="Days trained this week">
          {DAYS.map((d, i) => (
            <div className={"h-day" + (dots[i] ? " on" : "") + (i === dow ? " today" : "")} key={i}><i />{d}</div>
          ))}
        </div>
        {training?.last && (
          <div {...pressable(onOpenGym)} className="task-row p2 h-last">
            <div className="task-title">
              <span className="task-name">Last session</span>
              {/* KILL THE GREY SUBTEXT (Dave 2026-09-10). Three facts joined
                  by middots in one grey: which day, how long ago, how many
                  minutes. Each is its own chip now, and the day name -- the
                  one a person is actually scanning for -- leads in full ink. */}
              <div className="r-k">
                <span className="se-chip se-chip-last">{training.last.dayName}</span>
                <span className="se-chip se-chip-when">{capAfterNumber(agoPhrase(training.last.date, today))}</span>
                <span className="se-chip se-chip-budget">{training.last.minutes}<em>Min</em></span>
              </div>
            </div>
            {CHEV}
          </div>
        )}
        {training?.pr && (
          <div className="task-row p2">
            <div className="task-title">
              <span className="task-name">{training.pr.name}</span>
              <div className="r-k">
                <span className="se-chip se-chip-best">{training.pr.text}</span>
                <span className="se-chip se-chip-when">{capAfterNumber(agoPhrase(training.pr.date, today))}</span>
              </div>
            </div>
            <span className="se-pr">PR</span>
          </div>
        )}
      </div></div>

      {/* DAILY LOG (S5-Q29): the four grafted one-tap loggers. Same row anatomy
          as the Metrics section's own empty-state row below, so the page
          reads as one design rather than two features bolted together.
          The head was "Log It", the rows were "Lights Out / Took It / Call It
          / Point at It", and the whole group was named after the gestures
          rather than the things (Dave 2026-09-10: "the log it names make no
          sense... Right now I won't even attempt to use it"). The rows are
          nouns now and each says what it does; see CategoryDetail's
          healthLoggers. The verbs survive where they belong, on the big button
          inside each screen, because there "Lights Out" is what you are
          telling the app, not what you are choosing between. */}
      <div className="sh2 sh2-quiet"><span className="t">Daily Log</span>
        <button className="see-all pill-action" onClick={onManageMetrics}>Add</button></div>
      <div className="pad-x"><div className="h-tiles">
        {healthLoggers.map((l, i) => loggerTile(l, i))}
        {shownMetrics.map((d, i) => metricTile(d, healthLoggers.length + i))}
        {shownMetrics.length === 0 && (
          <div {...pressable(onManageMetrics)} className="h-tile h-tile-add">
            <div className="ht-w">Track Anything</div>
            <div className="ht-n"><span className="ht-none">Add</span></div>
            <div className="ht-m">Sleep, bodyweight, soreness, or your own</div>
          </div>
        )}
      </div></div>
      {/* MEDICATION IS ITS OWN PAGE NOW (Dave 2026-09-10: "medication related
          stuff should all be its own page"), so it is a row rather than a tile
          in the grid: it is a door to a page, not a thing you log in one tap.
          HMN-F-06's More row keeps the rest of the module behind it. */}
      {(onOpenMedication || onOpenHealthMore) && (
        <div className="pad-x h-doors"><div className="card list-card-ruled">
          {onOpenMedication && (
            <div {...pressable(onOpenMedication)} className="task-row p2">
              <div className="task-title">
                <span className="task-name">Medication</span>
                <div className="r-k"><span className="r-goal r-cat">{medSub ?? "Doses, refills, and the window"}</span></div>
              </div>
              {CHEV}
            </div>
          )}
          {onOpenHealthMore && (
            <div {...pressable(onOpenHealthMore)} className="task-row p2">
              <div className="task-title">
                <span className="task-name">More</span>
                <div className="r-k"><span className="r-goal r-cat">Sharing, the week, the locker</span></div>
              </div>
              {CHEV}
            </div>
          )}
        </div></div>
      )}

      {insights}

      {/* ONE DEFINITION OF THE FOUR SECTIONS (Dave 2026-09-10: "there's
          duplicate add buttons on the page").
          This body used to draw its own Goals Here and Up Next. When the area
          page grew Projects, Goals Here, Coming Up and Up Next as one shared
          block on 09-09, the health page got that block AND kept these two, so
          he scrolled past Goals Here twice and Add Task twice. A second copy
          of a section is a second copy of every rule about it, which is how
          they drift; there is one copy now and it is handed in here, so the
          health page and every other area page can never disagree about what
          those sections are or where their create rows go. */}
      {sections}

      {more}
    </>
  );
}

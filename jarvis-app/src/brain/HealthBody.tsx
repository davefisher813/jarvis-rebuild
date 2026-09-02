import type { ReactNode } from "react";
import type { Program, Workout } from "../gym/types";
import type { TrainingSummary } from "../gym/summary";
import { agoPhrase } from "../gym/summary";
import type { MetricDef, MetricLog } from "../gym/metrics";
import { activeMetrics, numericValue } from "../gym/metrics";
import { nextDayFor } from "../gym/nextDay";
import { todayDow } from "../gym/pins";
import { estimateDay } from "../gym/fit";
import { readGymSettings, rackFrom } from "../gym/settings";
import type { Progress } from "../bigger/progress";
import GoalRowRuled from "../bigger/GoalRowRuled";
import { BarbellGlyph } from "../shared/glyphs";
import { capAfterNumber } from "../shared/casing";
import { fmtTime } from "../schedule/calendar";
import { dayPhrase } from "../money/bills";

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

export interface HealthGoalRow {
  id: string; title: string; tone: string; body: string;
  status: { text: string; tone: "good" | "warn" } | null; bar: Progress | null;
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
  program, workouts, training, today, isEvening, gymEvent, metricDefs, metricLogs, goals, tasks, dueOf,
  onStart, onOpenGym, onOpenMetric, onManageMetrics, onOpenGoal, onToggleTask, onOpenTask, onAddTask, insights, more,
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
  goals: HealthGoalRow[];
  tasks: { id: string; text: string }[];
  dueOf: (id: string) => string | null;
  onStart: (dayId: string) => void;
  onOpenGym: () => void;
  onOpenMetric: (def: MetricDef) => void;
  onManageMetrics: () => void;
  onOpenGoal?: (id: string) => void;
  onToggleTask: (id: string) => void;
  onOpenTask?: (id: string) => void;
  onAddTask: () => void;
  /** The insight cards, when any qualified; rendered as handed in. */
  insights?: ReactNode;
  /** Streaks, notes, the week's receipt: the quiet tail, as handed in. */
  more?: ReactNode;
}) {
  const dow = todayDow();
  const next = nextDayFor(program, workouts, dow);
  const est = next ? estimateDay(next.day, workouts, rackFrom(readGymSettings())).min : 0;
  const when = gymEvent
    ? `${isEvening ? "Tonight" : "Today"} ${fmtTime(gymEvent.start).time} ${fmtTime(gymEvent.start).ap}`
    : next?.when === "today" ? "Today" : next?.when === "tomorrow" ? "Tomorrow" : next?.when ? next.when : "Next up";
  const heroLine = next
    ? capAfterNumber([when, `${next.day.exercises.length} ${next.day.exercises.length === 1 ? "exercise" : "exercises"}`, ...(est > 0 ? [`About ${est}m`] : [])].join(" · "))
    : null;
  const dots = training?.weekDots ?? new Array<boolean>(7).fill(false);
  const shownMetrics = activeMetrics(metricDefs);

  const metricTile = (def: MetricDef) => {
    const mine = metricLogs.filter((l) => l.data.metricId === def.id && l.data.date <= today).sort((a, b) => a.data.date.localeCompare(b.data.date));
    const latest = mine[mine.length - 1];
    const val = tileValue(def, latest);
    const pts = def.data.type === "yesno" ? [] : mine.slice(-7).map((l) => numericValue(def.data, l)).filter((n): n is number => n != null);
    const meta = !latest ? "Not logged yet" : latest.data.date === today ? "Today" : (() => { const p = dayPhrase(latest.data.date, today); return p.charAt(0).toUpperCase() + p.slice(1); })();
    return (
      <div className="h-tile" role="button" tabIndex={0} key={def.id} onClick={() => onOpenMetric(def)}>
        <div className="ht-w">{def.data.name}</div>
        <div className="ht-n">
          {val ? val.map((p, i) => <span key={i}>{p.big}{p.small && <small>{p.small}</small>}</span>) : <span className="ht-none">Log it</span>}
        </div>
        <div className="ht-m">{meta}</div>
        {pts.length >= 2 && <Spark pts={pts} />}
      </div>
    );
  };

  return (
    <>
      {/* THE HERO: the next session, with Start on it, and the week under it. */}
      <div className="pad-x h-hero-wrap"><div className="card list-card-ruled h-hero-card">
        {next ? (
          <div className="h-hero" role="button" tabIndex={0} onClick={onOpenGym}>
            <span className="h-hero-ico"><BarbellGlyph /></span>
            <div className="h-hero-b">
              <div className="h-hero-t">{next.day.name}</div>
              {heroLine && <div className="h-hero-s">{heroLine}</div>}
            </div>
            <button className="pill-act" onClick={(e) => { e.stopPropagation(); onStart(next.day.id); }}>Start</button>
          </div>
        ) : (
          <div className="h-hero" role="button" tabIndex={0} onClick={onOpenGym}>
            <span className="h-hero-ico"><BarbellGlyph /></span>
            <div className="h-hero-b">
              <div className="h-hero-t">{program ? program.data.name : "Set Up a Program"}</div>
              <div className="h-hero-s">{program ? "Add a day to train" : "A few lifts, a few days, and the page fills itself"}</div>
            </div>
            {CHEV}
          </div>
        )}
        <div className="h-week" aria-label="Days trained this week">
          {DAYS.map((d, i) => (
            <div className={"h-day" + (dots[i] ? " on" : "") + (i === dow ? " today" : "")} key={i}><i />{d}</div>
          ))}
        </div>
        {training?.last && (
          <div className="task-row p2 h-last" role="button" tabIndex={0} onClick={onOpenGym}>
            <div className="task-title">
              <span className="task-name">Last session</span>
              <div className="r-k"><span className="r-goal r-cat">{capAfterNumber(`${training.last.dayName} · ${agoPhrase(training.last.date, today)} · ${training.last.minutes}m`)}</span></div>
            </div>
            {CHEV}
          </div>
        )}
        {training?.pr && (
          <div className="task-row p2">
            <div className="task-title">
              <span className="task-name">{training.pr.name} · {training.pr.text}</span>
              <div className="r-k"><span className="r-goal r-cat">New best · {agoPhrase(training.pr.date, today)}</span></div>
            </div>
            <span className="gstat gstat-good">PR</span>
          </div>
        )}
      </div></div>

      {/* THE NUMBERS: tiles, each with its sparkline once there is history. */}
      <div className="sh2 sh2-quiet"><span className="t">Metrics</span>{shownMetrics.length > 0 && <span className="n">{shownMetrics.length}</span>}
        <button className="see-all pill-action" onClick={onManageMetrics}>Add</button></div>
      {shownMetrics.length === 0 ? (
        <div className="pad-x"><div className="card list-card-ruled">
          <div className="task-row p2" role="button" tabIndex={0} onClick={onManageMetrics}>
            <div className="task-title"><span className="task-name">Track anything you want</span>
              <div className="r-k"><span className="r-goal r-cat">Sleep, bodyweight, soreness, or your own</span></div></div>
            {CHEV}
          </div>
        </div></div>
      ) : (
        <div className="pad-x"><div className="h-tiles">{shownMetrics.map(metricTile)}</div></div>
      )}

      {insights}

      {goals.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Goals Here</span><span className="n">{goals.length}</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {goals.map((g) => (
              <GoalRowRuled key={g.id} title={g.title} tone={g.tone} body={g.body} status={g.status} bar={g.bar}
                onOpen={onOpenGoal ? () => onOpenGoal(g.id) : undefined} />
            ))}
          </div></div>
        </>
      )}

      <div className="sh2 sh2-quiet"><span className="t">Up Next</span>{tasks.length > 0 && <span className="n">{tasks.length}</span>}</div>
      <div className="pad-x"><div className="card list-card-ruled">
        {tasks.map((t) => {
          const due = dueOf(t.id);
          return (
            <div className="task-row p2" key={t.id}>
              <div className="task-check-tap" role="checkbox" aria-checked={false} aria-label="Mark done" onClick={() => onToggleTask(t.id)}>
                <div className="task-check" />
              </div>
              <div className="task-title" role={onOpenTask ? "button" : undefined} tabIndex={onOpenTask ? 0 : undefined}
                onClick={onOpenTask ? () => onOpenTask(t.id) : undefined}>
                <span className="task-name">{t.text}</span>
                {due && <div className="r-k"><span className="r-goal r-cat">{due}</span></div>}
              </div>
              {onOpenTask && CHEV}
            </div>
          );
        })}
        <button className="row row-act" onClick={onAddTask}>Add Task</button>
      </div></div>

      {more}
    </>
  );
}

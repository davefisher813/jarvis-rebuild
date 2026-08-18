import type { ReactNode } from "react";
import { Mail, DollarSign } from "lucide-react";
import type { EventItem } from "../schedule/types";
import type { TaskItem } from "../tasks/TasksService";
import { fmtTime } from "../schedule/calendar";
import { urgencyFor, type UrgencyKind } from "../tasks/grouping";
import { catColor, catName } from "../shared/categories";
import { useRef, useState } from "react";
import type { DaySummary } from "./todayData";
import RollingNumber from "../shared/RollingNumber";
import YourDay from "./YourDay";
import DayRing from "./DayRing";
import { useCondensed } from "../shared/PageHeader";
import { Burst, useBurst } from "../shared/Burst";
import { eveningSummary, EVENING_TASKS_NOTE, type EveningStats, type WeekRecap } from "./evening";
import { MorningWeatherLine, WeatherOfferRow } from "../weather/WeatherLine";

const localISODate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const URGENCY_CLASS: Record<UrgencyKind, string> = {
  overdue: "urgency-red",
  today: "urgency-warn",
  soon: "urgency-muted",
};

// One task row with the completion micro-burst wired to the check tap.
// Completion is optimistic: the check flips and the burst plays immediately,
// and the real toggle (which reloads the list and removes the row) is held
// for 600ms so the animation is actually visible before the row leaves.
function TaskRow({ t, u, onToggle, onOpen }: { t: TaskItem; u: { kind: UrgencyKind; label: string } | null; onToggle?: () => void; onOpen?: () => void }) {
  const [bursting, fireBurst] = useBurst();
  const [localDone, setLocalDone] = useState(false);
  const pending = useRef(false);
  const done = t.data.done || localDone;
  const tap = () => {
    if (pending.current) return; // ignore taps while the completion is in flight
    if (t.data.done) { onToggle?.(); return; } // un-completing: no ceremony
    pending.current = true;
    setLocalDone(true);
    fireBurst();
    setTimeout(() => { pending.current = false; setLocalDone(false); onToggle?.(); }, 600);
  };
  return (
    <div className={"task-row" + (localDone ? " just-done" : "")}>
      <div className="task-check-tap" role="checkbox" aria-checked={done} aria-label={done ? "Mark not done" : "Mark done"} onClick={tap}>
        <div className={"task-check " + (done ? "done" : "cat-bd-" + catColor(t.data.category))} />
        <Burst show={bursting} />
      </div>
      <div className="task-title" role="button" tabIndex={0} onClick={onOpen}>{t.data.text}</div>
      {u && <span className={"urgency " + URGENCY_CLASS[u.kind]}>{u.label}</span>}
    </div>
  );
}

const CheckIcon = () => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);
const GiftIcon = () => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 12 20 22 4 22 4 12" /><rect x="2" y="7" width="20" height="5" /><line x1="12" y1="22" x2="12" y2="7" /><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" /><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" /></svg>
);
const NextIcon = () => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="13 17 18 12 13 7" /><polyline points="6 17 11 12 6 7" />
  </svg>
);
const SunIcon = () => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 18a5 5 0 0 0-10 0" /><line x1="12" y1="2" x2="12" y2="9" /><line x1="4.2" y1="10.2" x2="5.6" y2="11.6" /><line x1="1" y1="18" x2="3" y2="18" /><line x1="21" y1="18" x2="23" y2="18" /><line x1="18.4" y1="11.6" x2="19.8" y2="10.2" /><polyline points="8 6 12 2 16 6" /><line x1="3" y1="22" x2="21" y2="22" />
  </svg>
);

function SchedRow({ ev }: { ev: EventItem }) {
  const t = fmtTime(ev.data.start);
  return (
    <div className="sched-row">
      <div className="sched-time">{t.time}<span className="ampm">{t.ap}</span></div>
      <div className="sched-body">
        <div className="sched-title">{ev.data.title}</div>
        <div className="sched-cat"><span className={"cat-dot cat-bg-" + catColor(ev.data.category)} />{catName(ev.data.category)}</div>
      </div>
    </div>
  );
}

export default function TodayPage({
  greeting,
  dateLong,
  summary,
  todayEvents,
  now,
  nowLabel,
  tomorrowEvents,
  tomorrowTasks = [],
  tomorrowDate,
  tasks,
  today,
  onToggleTask,
  onOpenTask,
  avatar = "DF",
  onSeeAllSchedule,
  onPlanDay,
  onPlanTomorrow,
  onRunningLate,
  onUpNext,
  upNext,
  onSeeAllUpNext,
  freshStart,
  locked,
  onOpenEvent,
  onEditRoutine,
  onSeeAllTasks,
  suggestions,
  banners,
  onSearch,
  onProfile,
  evening,
  weekly,
  ring,
  daypart,
  birthdays,
  emailLine,
  billLine,
  onOpenEmail,
}: {
  greeting: string;
  dateLong: string;
  // Email as a LINE, not a destination. Empty means nothing needs him, and
  // then nothing renders: a card saying "0 emails need you" is still homework.
  emailLine?: string;
  billLine?: string; // bills due within 3 days, from billsLine (2026-08-09)
  onOpenEmail?: () => void;
  summary: DaySummary;
  todayEvents: EventItem[];
  now: string;
  nowLabel: string;
  tomorrowEvents: EventItem[];
  tomorrowTasks?: TaskItem[]; // weeklies/monthlies due tomorrow: the heads-up
  tomorrowDate: string;
  tasks: TaskItem[];
  today: string;
  onToggleTask?: (id: string) => void;
  onOpenTask?: (id: string) => void;
  avatar?: string;
  onSeeAllSchedule: () => void;
  onPlanDay?: () => void;
  onPlanTomorrow?: () => void; // evening-only entry aiming the sheet at tomorrow (2026-08-09)
  onRunningLate?: (mins: number) => void; // shift the rest of today from here (2026-08-09)
  onUpNext?: () => void;
  upNext?: TaskItem[];
  onSeeAllUpNext?: () => void;
  freshStart?: () => void;
  locked?: { s: number; e: number; label: string }[];
  onOpenEvent?: (id: string) => void;
  onEditRoutine?: () => void;
  onSeeAllTasks: () => void;
  suggestions?: ReactNode;
  // Group A banners (Where You Were, Auto-Sweep receipt), above the day.
  banners?: ReactNode;
  onSearch?: () => void;
  onProfile?: () => void;
  evening?: EveningStats;
  weekly?: WeekRecap | null; // Sunday-evening close-out card
  ring?: { done: number; total: number };
  daypart?: "morning" | "evening" | null;
  birthdays?: { id: string; name: string }[]; // today's only; absent is the normal state
}) {
  // Catalog V3.1 (approved 2026-08-18): the workload line is tappable pills,
  // not floating text. Sky events land on Schedule, blue due and red overdue
  // land on Tasks. Rolling numbers kept.
  const parts = (
    <div className="day-pills">
      <span className="day-pill dp-sky" role="button" tabIndex={0} onClick={onSeeAllSchedule}>
        <RollingNumber value={summary.events} />&nbsp;{summary.events === 1 ? "event" : "events"}
      </span>
      <span className="day-pill dp-blue" role="button" tabIndex={0} onClick={onSeeAllTasks}>
        <RollingNumber value={summary.due} />&nbsp;due
      </span>
      {summary.overdue > 0 && (
        <span className="day-pill dp-red" role="button" tabIndex={0} onClick={onSeeAllTasks}>
          <RollingNumber value={summary.overdue} />&nbsp;overdue
        </span>
      )}
    </div>
  );

  // Evening posture: recap instead of workload, Tonight instead of Your Day,
  // Tomorrow promoted above the (softened) open tasks. Same page, same data.
  const dayEvents = evening ? todayEvents.filter((e) => e.data.start >= now) : todayEvents;

  // Up Next: the deck's top 3, first thing under the hero (Dave 2026-07-30).
  // Rows are the SAME task rows as every other list (all task lists identical,
  // Dave 2026-07-30); the title stays outside the card; See All lands on the
  // Tasks All filter. The one-card mode opens from the Focus button (YourDay).
  // Birthdays (ride-along 2026-08-03, previewed and approved): shown ONLY on
  // the day itself, above Up Next. People-pink because this is people data;
  // never red. The year is untrusted (contact imports), so no age is claimed.
  const birthdaySection = birthdays && birthdays.length > 0 && (
    <>
      <div className="sec-head">
        <div className="sec-left">
          <div className="sec-ico cat-bg-pink"><GiftIcon /></div>
          <div className="sec-title">{birthdays.length === 1 ? "Birthday" : "Birthdays"}</div>
        </div>
      </div>
      <div className="pad-x">
        <div className="card">
          {birthdays.map((b) => (
            <div className="row" key={b.id}>
              <div className="av av-32 cat-bg-pink">{b.name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</div>
              <div className="row-grow">
                <div className="conn-name truncate">{b.name}</div>
                <div className="eyebrow">Turns a year older today</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );

  const upNextSection = !evening && upNext && upNext.length > 0 && (
    <>
      <div className="sec-head">
        <div className="sec-left">
          <div className="sec-ico ico-accent"><NextIcon /></div>
          <div className="sec-title">Up Next</div>
        </div>
        {onSeeAllUpNext && <button className="see-all" onClick={onSeeAllUpNext}>See All</button>}
      </div>
      <div className="pad-x">
        <div className="card">
          {upNext.map((t) => (
            <TaskRow key={t.id} t={t} u={urgencyFor(t.data, today)} onToggle={() => onToggleTask?.(t.id)} onOpen={() => onOpenTask?.(t.id)} />
          ))}
        </div>
      </div>
    </>
  );

  const tasksSection = tasks.length > 0 && (
    <>
      <div className="sec-head">
        <div className="sec-left">
          <div className="sec-ico ico-good"><CheckIcon /></div>
          <div className="sec-title">{evening ? "Still Open" : "Today’s Tasks"}</div>
        </div>
        <button className="see-all" onClick={onSeeAllTasks}>See All</button>
      </div>
      <div className="pad-x">
        <div className="card">
          {tasks.map((t) => (
            <TaskRow key={t.id} t={t} u={evening ? null : urgencyFor(t.data, today)} onToggle={() => onToggleTask?.(t.id)} onOpen={() => onOpenTask?.(t.id)} />
          ))}
        </div>
      </div>
      {evening && <div className="pad-x"><div className="input-help">{EVENING_TASKS_NOTE}</div></div>}
    </>
  );

  const tomorrowSection = (tomorrowEvents.length > 0 || tomorrowTasks.length > 0) && (
    <>
      <div className="sec-head">
        <div className="sec-left">
          <div className="sec-ico ico-blue"><SunIcon /></div>
          <div className="sec-title">Tomorrow</div>
        </div>
        <button className="see-all" onClick={onSeeAllSchedule}>{tomorrowDate}</button>
      </div>
      <div className="pad-x">
        <div className="card">
          {tomorrowEvents.map((ev) => <SchedRow ev={ev} key={ev.id} />)}
          {/* Weeklies/monthlies surface on their day only; the day before gets
              this one quiet heads-up row (roadmap v2 dailies weaving). */}
          {tomorrowTasks.map((t) => (
            <div className="sched-row" key={t.id}>
              <div className="sched-time" />
              <div className="sched-body">
                <div className="sched-title">{t.data.text}</div>
                <div className="sched-cat"><span className={"cat-dot cat-bg-" + catColor(t.data.category)} />{catName(t.data.category)}</div>
              </div>
              <span className="pill pill-subdued">{t.data.recurrence}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );

  // Library chassis (Design 2, approved 2026-08-18): the JARVIS bar is the
  // sticky glass bar; it condenses over the hero with the red energy line
  // once the greeting scrolls away. Nothing collides with the clock.
  const [condProbe, condensed] = useCondensed();
  return (
    <div className="screen">
      <div className={"pagebar today-pagebar" + (condensed ? " on" : "")}>
      <div className="today-bar pagebar-row">
        <button className="today-av" aria-label="Account" onClick={onProfile}>
          <div className="av av-32 av-accent">{avatar}</div>
        </button>
        <div className="today-brand"><span className="j">J</span>ARVIS</div>
        {onSearch ? (
          <button className="today-search" aria-label="Search" onClick={onSearch}>
            <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          </button>
        ) : <div className="today-av" aria-hidden="true" />}
      </div>
      </div>
      <div className={"today-hero" + (daypart === "morning" ? " hero-morning" : daypart === "evening" ? " hero-evening" : "")}>
        <div className="today-hero-row">
          <div>
            <div className="eyebrow">{dateLong}</div>
            <div className="today-title">{greeting}</div>
            <div className="today-summary">{evening ? eveningSummary(evening) : parts}</div>
            {/* Weather Fact (addendum item 4): the morning line. Threshold-
                gated; a mild day renders nothing here. */}
            <MorningWeatherLine todayIso={localISODate()} />
          </div>
          {ring && <DayRing done={ring.done} total={ring.total} />}
        </div>
      </div>
      <div ref={condProbe} />

      {banners}

      {birthdaySection}

      {/* Weather's one-time connect moment: a single row, once, gone forever
          on decline (same doctrine as the gym page's Health row). */}
      <div className="pad-x"><WeatherOfferRow /></div>

      {/* Bills where the eyes are (2026-08-09): one quiet line when money is
          due within three days. Not tappable to nowhere: it only becomes a
          row-button when a Money destination exists. */}
      {billLine && (
        <>
          <div className="sec-head">
            <div className="sec-left">
              <div className="sec-ico ico-good"><DollarSign className="ic" /></div>
              <div className="sec-title">Money</div>
            </div>
          </div>
          <div className="pad-x">
            <div className="card">
              <div className="row">
                <div className="row-grow">
                  <div className="conn-name">{billLine}</div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {emailLine && (
        <>
          {/* Icon lives in the SECTION HEADER beside the title, like Up Next
              and every other section. Inside the card it read as a row badge
              and broke the one pattern this page has. */}
          <div className="sec-head">
            <div className="sec-left">
              <div className="sec-ico ico-blue"><Mail className="ic" /></div>
              <div className="sec-title">Email</div>
            </div>
          </div>
          <div className="pad-x">
            <div className="card">
              <div className="row" role="button" tabIndex={0} onClick={onOpenEmail}>
                <div className="row-grow">
                  <div className="conn-name">{emailLine}</div>
                  <div className="conn-meta">Deal with it here</div>
                </div>
                <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
              </div>
            </div>
          </div>
        </>
      )}

      {upNextSection}

      {freshStart && (
        <div className="pad-x">
          <div className="card">
            <div className="row" role="button" tabIndex={0} onClick={freshStart}>
              <div className="row-grow">
                <div className="conn-name">Rough day? Fresh start.</div>
                <div className="conn-meta">Re-plan what's left · nothing lost</div>
              </div>
              <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            </div>
          </div>
        </div>
      )}

      {suggestions}

      <YourDay
        events={dayEvents}
        locked={locked}
        now={now}
        nowLabel={nowLabel}
        onSeeAll={onSeeAllSchedule}
        onPlanDay={onPlanDay}
        onPlanTomorrow={onPlanTomorrow}
        onRunningLate={onRunningLate}
        onFocus={evening ? undefined : onUpNext}
        onOpenEvent={onOpenEvent}
        onEditRoutine={onEditRoutine}
        title={evening ? "Tonight" : "Your Day"}
        emptyText={evening ? "Nothing else tonight" : "Nothing scheduled today"}
      />

      {/* Sunday evening only: the weekly close-out card. Two lines, no charts;
          this is what the Insights page folds into (roadmap v2). */}
      {evening && weekly && (
        <>
          <div className="sec-head">
            <div className="sec-left">
              <div className="sec-ico ico-blue"><SunIcon /></div>
              <div className="sec-title">Your Week</div>
            </div>
          </div>
          <div className="pad-x"><div className="card">
            <div className="week-recap">
              <div className="t-body">
                <b>{weekly.things > 0 ? `${weekly.things} ${weekly.things === 1 ? "thing" : "things"} done` : "A quiet week"}</b>
                {weekly.events > 0 ? ` across ${weekly.events} ${weekly.events === 1 ? "event" : "events"} this week.` : " this week."}
              </div>
              {weekly.bestDay && <div className="t-meta">{weekly.bestDay} was your biggest day.</div>}
            </div>
          </div></div>
        </>
      )}

      {/* Daytime: Up Next (top of page) replaces the old task list; evening
          keeps the softened Still Open recap. */}
      {evening && tomorrowSection}
      {evening && tasksSection}
      {!evening && tomorrowSection}

      <div className="screen-foot" />
    </div>
  );
}

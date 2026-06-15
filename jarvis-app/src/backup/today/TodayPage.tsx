import type { ReactNode } from "react";
import type { EventItem } from "../schedule/types";
import type { TaskItem } from "../tasks/TasksService";
import { fmtTime } from "../schedule/calendar";
import { urgencyFor, type UrgencyKind } from "../tasks/grouping";
import { catColor, catName } from "../shared/categories";
import type { DaySummary } from "./todayData";
import YourDay from "./YourDay";

const URGENCY_CLASS: Record<UrgencyKind, string> = {
  overdue: "urgency-red",
  today: "urgency-warn",
  soon: "urgency-muted",
};

const CheckIcon = () => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
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
  tomorrowDate,
  tasks,
  today,
  onToggleTask,
  avatar = "DF",
  onSeeAllSchedule,
  onSeeAllTasks,
  suggestions,
  onSearch,
  onProfile,
}: {
  greeting: string;
  dateLong: string;
  summary: DaySummary;
  todayEvents: EventItem[];
  now: string;
  nowLabel: string;
  tomorrowEvents: EventItem[];
  tomorrowDate: string;
  tasks: TaskItem[];
  today: string;
  onToggleTask?: (id: string) => void;
  avatar?: string;
  onSeeAllSchedule: () => void;
  onSeeAllTasks: () => void;
  suggestions?: ReactNode;
  onSearch?: () => void;
  onProfile?: () => void;
}) {
  const parts: JSX.Element[] = [];
  parts.push(<span key="e">{summary.events} {summary.events === 1 ? "event" : "events"}</span>);
  parts.push(<span key="d"> &middot; {summary.due} {summary.due === 1 ? "task due" : "tasks due"}</span>);
  if (summary.overdue > 0) parts.push(<span key="o"> &middot; <span className="fg-red">{summary.overdue} overdue</span></span>);

  return (
    <div className="screen">
      <div className="today-bar">
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
      <div className="today-hero">
        <div className="eyebrow">{dateLong}</div>
        <div className="today-title">{greeting}</div>
        <div className="today-summary">{parts}</div>
      </div>

      {suggestions}

      <YourDay events={todayEvents} now={now} nowLabel={nowLabel} onSeeAll={onSeeAllSchedule} />

      {tasks.length > 0 && (
        <>
          <div className="sec-head">
            <div className="sec-left">
              <div className="sec-ico ico-good"><CheckIcon /></div>
              <div className="sec-title">Today&rsquo;s Tasks</div>
            </div>
            <button className="see-all" onClick={onSeeAllTasks}>See All</button>
          </div>
          <div className="pad-x">
            <div className="card">
              {tasks.map((t) => {
                const u = urgencyFor(t.data, today);
                return (
                  <div className="task-row" key={t.id}>
                    <div className="task-check-tap" role="checkbox" aria-checked={t.data.done} aria-label={t.data.done ? "Mark not done" : "Mark done"} onClick={() => onToggleTask?.(t.id)}>
                      <div className={"task-check " + (t.data.done ? "done" : "cat-bd-" + catColor(t.data.category))} />
                    </div>
                    <div className="task-title">{t.data.text}</div>
                    {u && <span className={"urgency " + URGENCY_CLASS[u.kind]}>{u.label}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {tomorrowEvents.length > 0 && (
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
            </div>
          </div>
        </>
      )}

      <div className="screen-foot" />
    </div>
  );
}

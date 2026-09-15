import { useRef, useState, type ReactNode } from "react";
import type { TaskItem } from "../TasksService";
import { homeSections, describeRepeat, repeatRuleOf, type HomeItem } from "../reminders";
import { fmtTime, addDays } from "../../schedule/calendar";
import { catName, catColor } from "../../shared/categories";
import LargeTitleNav from "../../shared/LargeTitleNav";
import { BarAction } from "../../shared/PageHeader";
import { rowDoor } from "../../shared/rowDoor";
import { Burst } from "../../shared/Burst";
import { Check, Plus } from "../../shared/icons";

// REMINDERS HOME (the reminders rebuild push B, 2026-09-15; Dave's
// preview). One page, organised by when: Now, Later Today, Upcoming,
// Unscheduled, then Paused and Completed collapsed to one row each. Reached
// from Today's strip (See All) and never a tab of its own (decision 2).
//
// A row is the strip's row with a second line: the time, the area and the
// rhythm as inline coloured words with middle dots, never filled chips
// (only real buttons look like buttons). The whole row opens the reminder.
// The ring is the only thing that completes it. Snooze is the same ten
// minutes it is on Today. An unscheduled row explains itself and offers Add
// a Time, which opens the same sheet with the schedule waiting.

function whenWord(it: HomeItem, today: string): string {
  if (!it.date || !it.time) return "";
  const t = fmtTime(it.time);
  const clock = `${t.time} ${t.ap}`;
  if (it.date === today) return `Today, ${clock}`;
  if (it.date === addDays(today, 1)) return `Tomorrow, ${clock}`;
  const [y, m, d] = it.date.split("-").map(Number);
  const day = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  return `${day}, ${clock}`;
}

export default function RemindersHome({
  items, today, now, onBack, onAdd, onOpen, onTick, onSnooze, onPause,
}: {
  items: TaskItem[];
  today: string;
  /** "HH:MM" */
  now: string;
  onBack: () => void;
  onAdd: () => void;
  onOpen: (id: string) => void;
  onTick: (id: string, done: boolean) => void;
  onSnooze: (id: string) => void;
  onPause: (id: string, paused: boolean) => void;
}) {
  const s = homeSections(items, today, now);
  const [burstId, setBurstId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const celebrate = (id: string) => {
    setBurstId(null);
    if (timer.current) clearTimeout(timer.current);
    requestAnimationFrame(() => {
      setBurstId(id);
      timer.current = setTimeout(() => setBurstId(null), 600);
    });
  };
  const total = s.now.length + s.laterToday.length + s.upcoming.length + s.unscheduled.length + s.paused.length + s.completed.length;

  const facts = (it: HomeItem, tone: "when" | "later") => {
    const rule = repeatRuleOf(it.reminder);
    return (
      <div className="facts">
        {it.time
          ? <span className={"fact " + tone}>{whenWord(it, today)}</span>
          : <span className="fact rem-unsch">{it.reminder.paused ? "Paused" : "Unscheduled"}</span>}
        {it.category && <span className="fact cat"><span className={"cd cat-bg-" + catColor(it.category)} />{catName(it.category)}</span>}
        {it.time && rule.kind !== "once" && <span className="fact">{describeRepeat(rule)}</span>}
      </div>
    );
  };

  const ring = (it: HomeItem) => (
    <div
      className={"cb" + (it.done ? " on" : "") + (burstId === it.id ? " just-checked" : "")}
      role="button"
      tabIndex={0}
      aria-label={it.done ? "Undo " + it.text : "Mark " + it.text + " done"}
      onClick={() => { if (!it.done) celebrate(it.id); onTick(it.id, !it.done); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!it.done) celebrate(it.id); onTick(it.id, !it.done); } }}
    >
      {it.done && <Check className="ic" />}
      <Burst show={burstId === it.id} />
    </div>
  );

  const row = (it: HomeItem, tone: "when" | "later", extra?: ReactNode) => (
    <div key={it.id} className={"rem-row" + (it.done ? " done" : "")} {...rowDoor(() => onOpen(it.id))}>
      {!it.reminder.paused && ring(it)}
      <div className="rem-body">
        <div className="rem-name">{it.text}</div>
        {facts(it, tone)}
        {!it.time && !it.reminder.paused && <div className="rem-explain">No timed alert. Here until you clear it or give it a time.</div>}
      </div>
      {extra}
    </div>
  );

  const head = (label: string, n: number, accent = false) => (
    <div className={"sh2" + (accent ? "" : " sh2-quiet")}><span className="t">{label}</span>{n > 0 && <span className="n">{n}</span>}</div>
  );

  return (
    <div className="screen ruled rem-home">
      <LargeTitleNav title="Reminders" back="Today" onBack={onBack}
        actions={<BarAction label="New Reminder" onClick={onAdd}><Plus className="ic" /></BarAction>} />

      {total === 0 && (
        <div className="pad-x"><div className="card">
          <button className="row row-act" onClick={onAdd}><Plus className="ic" />Add a Reminder</button>
        </div></div>
      )}

      {s.now.length > 0 && (<>
        {head("Now", s.now.length, true)}
        <div className="pad-x"><div className="card">
          {s.now.map((it) => row(it, "when", <button className="pill-act" onClick={() => onSnooze(it.id)}>Snooze 10m</button>))}
        </div></div>
      </>)}

      {s.laterToday.length > 0 && (<>
        {head("Later Today", s.laterToday.length)}
        <div className="pad-x"><div className="card">
          {s.laterToday.map((it) => row(it, "when", <button className="pill-act" onClick={() => onSnooze(it.id)}>Snooze 10m</button>))}
        </div></div>
      </>)}

      {s.upcoming.length > 0 && (<>
        {head("Upcoming", s.upcoming.length)}
        <div className="pad-x"><div className="card">
          {s.upcoming.map((it) => row(it, "later"))}
        </div></div>
      </>)}

      {s.unscheduled.length > 0 && (<>
        {head("Unscheduled", s.unscheduled.length)}
        <div className="pad-x"><div className="card">
          {s.unscheduled.map((it) => row(it, "later", <button className="pill-act" onClick={() => onOpen(it.id)}>Add a Time</button>))}
        </div></div>
      </>)}

      {s.paused.length > 0 && (
        <details className="exp-more rem-more">
          <summary>{"Paused · " + s.paused.length}</summary>
          <div className="card">
            {s.paused.map((it) => row(it, "later", <button className="pill-act" onClick={() => onPause(it.id, false)}>Resume</button>))}
          </div>
        </details>
      )}

      {s.completed.length > 0 && (
        <details className="exp-more rem-more">
          <summary>{"Completed Today · " + s.completed.length}</summary>
          <div className="card">
            {s.completed.map((it) => row(it, "later"))}
          </div>
        </details>
      )}
    </div>
  );
}

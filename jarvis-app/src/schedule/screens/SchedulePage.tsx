import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import PageHeader, { BarAction } from "../../shared/PageHeader";
import { ChevronLeft, ChevronRight, Plus, Camera } from "lucide-react";
import type { EventItem } from "../types";
import { monthMatrix, fmtTime, fmtRange, openSlots, minToHHMM } from "../calendar";
import { isFocusRange } from "../../routine/types";
import { catColor } from "../../shared/categories";
import SkeletonRows from "../../shared/SkeletonRows";
import DayRow from "./DayRow";
import AnytimeRow from "./AnytimeRow";
import type { TaskItem } from "../../tasks/TasksService";
import type { AttachInfo } from "../attachments";

// A protected block from Your Routine, rendered on the day it applies.
export interface LockedRange { s: number; e: number; label: string; soft?: boolean; kind?: string }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WD = ["S", "M", "T", "W", "T", "F", "S"];
const WK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WKLONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Mode = "day" | "week" | "month";
interface WeekCell { date: string; day: number; colors: string[]; }

function fullDay(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${WKLONG[d.getDay()]}, ${MONTHS[d.getMonth()]!.slice(0, 3)} ${d.getDate()}`;
}
function weekRange(cells: WeekCell[]): string {
  if (cells.length < 7) return "";
  const a = new Date(cells[0]!.date + "T00:00:00"), b = new Date(cells[6]!.date + "T00:00:00");
  const ma = MONTHS[a.getMonth()]!.slice(0, 3), mb = MONTHS[b.getMonth()]!.slice(0, 3);
  return ma === mb ? `${ma} ${a.getDate()} - ${b.getDate()}` : `${ma} ${a.getDate()} - ${mb} ${b.getDate()}`;
}

export default function SchedulePage({
  year, month, selected, todayDate, dots, dayEvents, conflicts,
  mode = "month", onMode, weekCells = [], loading,
  onPrev, onNext, onSelect, onNew, onOpenEvent, onPickSlot, onPlanDay, onUpload,
  locked = [], now, onEditRoutine, onShift, onMoveTo, onSkipToday, onPushTomorrow, onRunningLate,
  anytimeItems = [], onToggleTask, onScheduleTask, attachMap = {},
  windowStartMin, windowEndMin,
}: {
  year: number; month: number; selected: string; todayDate: string;
  dots: Record<number, string[]>; dayEvents: EventItem[]; conflicts?: Set<string>;
  mode?: Mode; onMode?: (m: Mode) => void; weekCells?: WeekCell[]; loading?: boolean;
  onPrev?: () => void; onNext?: () => void; onSelect?: (date: string) => void;
  onNew?: () => void; onOpenEvent?: (id: string) => void; onPickSlot?: (start: string) => void; onPlanDay?: () => void; onUpload?: () => void;
  locked?: LockedRange[]; now?: string | null; onEditRoutine?: () => void;
  onShift?: (id: string, mins: number) => void;
  onMoveTo?: (id: string, start: string) => void;
  onSkipToday?: (id: string) => void;
  onPushTomorrow?: (id: string) => void;
  onRunningLate?: (mins: number) => void;
  anytimeItems?: TaskItem[]; onToggleTask?: (id: string) => void; onScheduleTask?: (id: string) => void;
  attachMap?: Record<string, AttachInfo>;
  // The routine-derived planning window (minutes). Open rows honor the user's
  // real day instead of a hardcoded 8 AM to 9 PM (2026-08-10).
  windowStartMin?: number; windowEndMin?: number;
}) {
  // "1h 48m" / "45m": a gap states its size, because the size is what
  // decides whether it is worth anything.
  const gapLabel = (mins: number) => {
    const h = Math.floor(mins / 60), m = mins % 60;
    return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  };

  const cells = monthMatrix(year, month);
  const n = dayEvents.length;
  const slots = openSlots(
    dayEvents,
    minToHHMM(windowStartMin ?? 8 * 60),
    minToHHMM(windowEndMin ?? 21 * 60),
    30,
    locked,
  );
  const navLabel = mode === "month" ? null : mode === "week" ? weekRange(weekCells) : fullDay(selected);
  const [lateOpen, setLateOpen] = useState(false);
  const toMin = (hhmm: string) => { const p = hhmm.split(":"); return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0); };

  // Drag an Anytime row down onto the grid to give it a time (roadmap v2's one
  // kept gesture). Long-press to lift so a quick tap still scrolls/opens; the
  // drop only fires over the grid, so a mis-drop just falls back to nothing.
  const gridZoneRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; label: string; x: number; y: number; over: boolean } | null>(null);
  const overGrid = (x: number, y: number) => {
    const r = gridZoneRef.current?.getBoundingClientRect();
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };
  const beginDrag = (id: string, label: string, e: RPointerEvent) => {
    if (!onScheduleTask) return;
    const startX = e.clientX, startY = e.clientY;
    let active = false;
    let timer: number | undefined;
    const cleanup = () => {
      if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("jarvis-dragging");
      setDrag(null);
    };
    const move = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 10) cleanup(); // moved first: a scroll or tap, not a drag
        return;
      }
      ev.preventDefault();
      setDrag({ id, label, x: ev.clientX, y: ev.clientY, over: overGrid(ev.clientX, ev.clientY) });
    };
    const up = (ev: PointerEvent) => {
      const dropped = active && overGrid(ev.clientX, ev.clientY);
      cleanup();
      if (dropped) onScheduleTask(id);
    };
    timer = window.setTimeout(() => {
      active = true;
      document.body.classList.add("jarvis-dragging");
      setDrag({ id, label, x: startX, y: startY, over: overGrid(startX, startY) });
    }, 260);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
  };
  const isToday = selected === todayDate && !!now;
  // Merge events + protected blocks into one time-ordered list, so the routine
  // is REAL on the calendar (roadmap v2), not an invisible wall.
  // GAPS LIVE IN THE TIMELINE (Dave 2026-08-19, ADHD round): open time used
  // to render as a trailing list under the day, so "2 hours free at 1pm" sat
  // visually below 9pm and read as dead space. A gap is a time of day; it
  // belongs in time order, tappable where it actually falls.
  type Entry =
    | { kind: "event"; e: EventItem; s: number }
    | { kind: "locked"; l: LockedRange; s: number }
    | { kind: "gap"; start: string; end: string; s: number };
  const entries: Entry[] = [
    ...dayEvents.map((e): Entry => ({ kind: "event", e, s: toMin(e.data.start) })),
    ...locked.map((l): Entry => ({ kind: "locked", l, s: l.s })),
    ...(mode === "day" && onPickSlot
      ? slots.map((sl): Entry => ({ kind: "gap", start: sl.start, end: sl.end, s: toMin(sl.start) }))
      : []),
  ].sort((a, b) => a.s - b.s);
  const nowMin = now ? toMin(now) : 0;
  const nextId = isToday ? dayEvents.filter((e) => toMin(e.data.start) >= nowMin).sort((a, b) => toMin(a.data.start) - toMin(b.data.start))[0]?.id : undefined;
  const hasFuture = isToday && dayEvents.some((e) => toMin(e.data.start) >= nowMin && (!e.data.recurrence || e.data.recurrence === "none"));
  // Open at now: land the day view on the next thing, not the top of the day.
  const nextRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mode === "day" && isToday && entries.length > 5) nextRef.current?.scrollIntoView({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selected, loading]);

  return (
    <div className="screen">
      <PageHeader title="Schedule" actions={<>
        {onUpload && <BarAction label="Upload a Schedule" onClick={onUpload}><Camera className="ic" /></BarAction>}
        <BarAction label="New Event" onClick={onNew}><Plus className="ic" /></BarAction>
      </>} />

      <div className="sched-seg"><div className="segmented">
        {(["day", "week", "month"] as Mode[]).map((m) => (
          <button key={m} className={"seg" + (mode === m ? " active" : "")} onClick={() => onMode?.(m)}>{m[0]!.toUpperCase() + m.slice(1)}</button>
        ))}
      </div></div>

      <div className="cal-nav">
        <div className="mo">
          {mode === "month" ? <>{MONTHS[month]}<span className="yr">{year}</span></> : navLabel}
        </div>
        <div className="cal-steps">
          <button className="cal-step" onClick={onPrev} aria-label="Previous"><ChevronLeft className="ic" /></button>
          <button className="cal-step" onClick={onNext} aria-label="Next"><ChevronRight className="ic" /></button>
        </div>
      </div>

      {mode === "month" && (
        <div className="cal-grid">
          {WD.map((w, i) => <div className="cal-wd" key={i}>{w}</div>)}
          {cells.map((cell) => {
            const isSel = cell.date === selected, isToday = cell.date === todayDate;
            const cls = "cal-cell" + (!cell.inMonth ? " out" : "") + (isSel ? " sel" : isToday ? " today" : "");
            const cellDots = cell.inMonth && !isSel ? (dots[cell.day] ?? []).slice(0, 3) : [];
            return (
              <div className={cls} key={cell.date} onClick={() => cell.inMonth && onSelect?.(cell.date)}>
                {cell.day}
                <div className="cal-dots">{cellDots.map((c, i) => <div className={"cal-dot cat-bg-" + catColor(c)} key={i} />)}</div>
              </div>
            );
          })}
        </div>
      )}

      {mode === "week" && (
        <div className="week-strip">
          {weekCells.map((c, i) => {
            const isSel = c.date === selected, isToday = c.date === todayDate;
            return (
              <div className={"wk-cell" + (isSel ? " sel" : isToday ? " today" : "")} key={c.date} onClick={() => onSelect?.(c.date)}>
                <div className="wk-wd">{WK[i]}</div>
                <div className="wk-day">{c.day}</div>
                <div className="cal-dots">{c.colors.map((col, j) => <div className={"cal-dot cat-bg-" + catColor(col)} key={j} />)}</div>
              </div>
            );
          })}
        </div>
      )}

      <div className="grp"><div className="plan-head">
        {/* Date lives in the nav above; repeating it here wrapped the row (no-repetition law). */}
        <div className="eyebrow">{n} {n === 1 ? "Event" : "Events"}</div>
        <div className="plan-head-acts">
          {hasFuture && onRunningLate && (
            <button className={"plan-cta plan-cta-ghost" + (lateOpen ? " late-armed" : "")} onClick={() => setLateOpen((v) => !v)}>Running Late?</button>
          )}
          {onPlanDay && <button className="plan-cta" onClick={onPlanDay}>Plan My Day</button>}
        </div>
      </div></div>
      {lateOpen && onRunningLate && (
        <div className="pad-x late-chips">
          <div className="segmented">
            {[15, 30, 60].map((m) => (
              <button className="seg" key={m} onClick={() => { setLateOpen(false); onRunningLate(m); }}>
                {m === 60 ? "1 hour" : `${m} min`}
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === "day" && !loading && (
        <AnytimeRow items={anytimeItems} onToggle={onToggleTask} onSchedule={onScheduleTask} onDragStart={beginDrag} />
      )}

      {loading ? (
        <SkeletonRows />
      ) : entries.every((en) => en.kind === "gap") ? (
        <div className="empty-state"><div className="t-body">No events</div><button className="btn btn-primary" onClick={onNew}>New Event</button></div>
      ) : (
        <>
        <div className={"sched-list" + (mode === "day" && drag?.over ? " drop-target" : "")} ref={gridZoneRef}>
          {entries.map((en, i) =>
            en.kind === "gap" ? (
              <button
                className={"sched-row sched-gap" + (isToday && toMin(en.end) <= nowMin ? " past" : "")}
                key={"gap-" + i}
                onClick={() => onPickSlot?.(en.start)}
              >
                <div className="sched-time">{fmtTime(en.start).time}<span className="ampm">{fmtTime(en.start).ap}</span></div>
                <div className="sched-body">
                  <div className="sched-title sched-gap-title">
                    <span className="sched-open-plus">+</span>
                    {gapLabel(toMin(en.end) - toMin(en.start))} open
                  </div>
                  <div className="sched-cat">Until {fmtTime(en.end).time} {fmtTime(en.end).ap} &middot; tap to fill it</div>
                </div>
              </button>
            ) : en.kind === "locked" ? (
              <div
                className={"sched-row sched-locked" + (isToday && en.l.e <= nowMin ? " past" : "")}
                key={"lock-" + i}
                role="button"
                tabIndex={0}
                onClick={onEditRoutine}
              >
                <div className="sched-time">{fmtTime(minToHHMM(en.l.s)).time}<span className="ampm">{fmtTime(minToHHMM(en.l.s)).ap}</span></div>
                <div className="sched-body">
                  <div className="sched-title sched-lock-title">
                    <svg className="ic lock-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                    {en.l.label}
                  </div>
                  <div className="sched-cat">{isFocusRange(en.l) ? "Focus time · tasks land here" : "Protected"} &middot; until {fmtTime(minToHHMM(en.l.e)).time} {fmtTime(minToHHMM(en.l.e)).ap}</div>
                </div>
              </div>
            ) : (
              <div key={en.e.id} ref={en.e.id === nextId ? nextRef : undefined}>
                <DayRow
                  e={en.e}
                  conflict={conflicts?.has(en.e.id) ?? false}
                  attach={attachMap[en.e.id]}
                  isNext={en.e.id === nextId}
                  isPast={isToday ? (en.e.data.end ? toMin(en.e.data.end) : toMin(en.e.data.start) + 60) < nowMin : false}
                  now={isToday ? now! : null}
                  onOpen={() => onOpenEvent?.(en.e.id)}
                  onShift={onShift ? (m) => onShift(en.e.id, m) : undefined}
                  onMoveTo={onMoveTo ? (t) => onMoveTo(en.e.id, t) : undefined}
                  onSkipToday={onSkipToday ? () => onSkipToday(en.e.id) : undefined}
                  onPushTomorrow={onPushTomorrow ? () => onPushTomorrow(en.e.id) : undefined}
                />
              </div>
            ),
          )}
        </div>
        {/* The trailing "Open ..." list is retired: those rows are in the
            timeline now, at the hour they belong to. Week and month views,
            which have no timeline, keep the list. */}
        {mode !== "day" && slots.length > 0 && onPickSlot && (
          <div className="pad-x sched-open-list">
            {slots.slice(0, 4).map((sl, i) => (
              <button key={i} className="sched-open" onClick={() => onPickSlot(sl.start)}>
                <span className="sched-open-plus">+</span> Open {fmtRange(sl.start, sl.end)}
              </button>
            ))}
          </div>
        )}
        </>
      )}

      {drag && (
        <div className="anytime-ghost" style={{ left: drag.x, top: drag.y }}>{drag.label}</div>
      )}
    </div>
  );
}

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { EventItem } from "../types";
import { monthMatrix, fmtTime, fmtRange, openSlots } from "../calendar";
import { catColor, catName } from "../../shared/categories";
import SkeletonRows from "../../shared/SkeletonRows";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WD = ["S", "M", "T", "W", "T", "F", "S"];
const WK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WKLONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Mode = "day" | "week" | "month";
interface WeekCell { date: string; day: number; colors: string[]; }

function dayLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${MONTHS[d.getMonth()]!.slice(0, 3)} ${d.getDate()}`;
}
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
  onPrev, onNext, onSelect, onNew, onOpenEvent, onPickSlot, onPlanDay,
}: {
  year: number; month: number; selected: string; todayDate: string;
  dots: Record<number, string[]>; dayEvents: EventItem[]; conflicts?: Set<string>;
  mode?: Mode; onMode?: (m: Mode) => void; weekCells?: WeekCell[]; loading?: boolean;
  onPrev?: () => void; onNext?: () => void; onSelect?: (date: string) => void;
  onNew?: () => void; onOpenEvent?: (id: string) => void; onPickSlot?: (start: string) => void; onPlanDay?: () => void;
}) {
  const cells = monthMatrix(year, month);
  const n = dayEvents.length;
  const slots = openSlots(dayEvents);
  const navLabel = mode === "month" ? null : mode === "week" ? weekRange(weekCells) : fullDay(selected);

  return (
    <div className="screen">
      <div className="nav-bar">
        <div className="nav-large">Schedule</div>
        <button className="nav-action" onClick={onNew} aria-label="New event"><Plus className="ic" /></button>
      </div>

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
        <div className="eyebrow">{dayLabel(selected)} &middot; {n} {n === 1 ? "Event" : "Events"}</div>
        {onPlanDay && <button className="plan-cta" onClick={onPlanDay}>Plan my day</button>}
      </div></div>

      {loading ? (
        <SkeletonRows />
      ) : n === 0 ? (
        <div className="empty-state"><div className="t-body">No events</div><button className="btn btn-primary" onClick={onNew}>New Event</button></div>
      ) : (
        <>
        <div className="pad-x"><div className="card">
          {dayEvents.map((e) => {
            const t = fmtTime(e.data.start);
            const endT = e.data.end ? fmtTime(e.data.end) : null;
            const conflict = conflicts?.has(e.id) ?? false;
            const rep = e.data.recurrence && e.data.recurrence !== "none" ? e.data.recurrence : null;
            return (
              <div className={"sched-row" + (conflict ? " sched-row-warn" : "")} key={e.id} role="button" tabIndex={0} onClick={() => onOpenEvent?.(e.id)}>
                <div className="sched-time">{t.time}<span className="ampm">{t.ap}</span></div>
                <div className="sched-body">
                  <div className="sched-title">{e.data.title}{conflict && <span className="sched-badge">Overlaps</span>}</div>
                  <div className="sched-cat"><span className={"cat-dot cat-bg-" + catColor(e.data.category)} />{catName(e.data.category)}{endT && <span className="sched-until">until {endT.time} {endT.ap}</span>}{rep && <span className="sched-rep">Repeats {rep}</span>}</div>
                  {e.data.location && (
                    <a className="sched-loc" href={"https://maps.apple.com/?q=" + encodeURIComponent(e.data.location)} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}>
                      <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z" /><circle cx="12" cy="10" r="3" /></svg>
                      {e.data.location}
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div></div>
        {slots.length > 0 && onPickSlot && (
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
    </div>
  );
}

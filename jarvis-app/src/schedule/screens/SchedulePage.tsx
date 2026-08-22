import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import PageHeader, { BarAction } from "../../shared/PageHeader";
import { ChevronLeft, ChevronRight, Plus, Camera, AlertTriangle } from "../../shared/icons";
import type { EventItem } from "../types";
import { monthMatrix, fmtTime, openSlots, minToHHMM } from "../calendar";
import { isFocusRange, modeOf, freeOf } from "../../routine/types";
import { catColor } from "../../shared/categories";
import SkeletonRows from "../../shared/SkeletonRows";
import DayRow from "./DayRow";
import AnytimeRow from "./AnytimeRow";
import ProposedRow from "./ProposedRow";
import type { TaskItem } from "../../tasks/TasksService";
import type { AttachInfo } from "../attachments";
import { dropInto } from "../dayEdit";
import { LockGlyph } from "../../shared/glyphs";

// A dropped task gets an hour, the same hour the tap-to-fill path gives it.
const DROP_MINUTES = 60;

// A protected block from Your Routine, rendered on the day it applies.
export interface LockedRange { s: number; e: number; label: string; soft?: boolean; kind?: string }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WD = ["S", "M", "T", "W", "T", "F", "S"];
const WK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WKLONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// W1 (2026-08-21): "repeats" is a fourth view, not a settings page. What
// stands on your calendar forever belongs beside the calendar.
type Mode = "day" | "week" | "month" | "repeats";
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
  mode = "month", onMode, weekCells = [], loading, repeats = [], overlap, onFixOverlap, clashCount = 0, onOverlapBadge, onCopyDay, repeatMarks = new Set<string>(),
  onPrev, onNext, onSelect, onNew, onOpenEvent, onPickSlot, onPlanDay, onUpload,
  locked = [], now, onEditRoutine, onFillBlock, onShift, onMoveTo, onSetEnd, onSkipToday, onPushTomorrow, onRunningLate,
  proposed, dayFooter,
  anytimeItems = [], onToggleTask, onScheduleTask, attachMap = {}, blendMap = {},
  windowStartMin, windowEndMin,
}: {
  year: number; month: number; selected: string; todayDate: string;
  dots: Record<number, string[]>; dayEvents: EventItem[]; conflicts?: Set<string>;
  mode?: Mode; onMode?: (m: Mode) => void; weekCells?: WeekCell[]; loading?: boolean;
  // W1: the repeating series, already derived by the flow.
  repeats?: import("../repeats").RepeatRow[];
  // N5: the worst collision on this day, and the one-tap fix.
  overlap?: { line: string } | null;
  onFixOverlap?: () => void;
  // N5 completion (hotfix 2026-08-21): how many unacknowledged clash pairs
  // the day holds, and the badge tap that opens the fix sheet for a row.
  clashCount?: number;
  onOverlapBadge?: (eventId: string) => void;
  // N7: yesterday's shape, reused.
  onCopyDay?: () => void;
  // W2: the dates in this week that carry a repeating event.
  repeatMarks?: ReadonlySet<string>;
  onPrev?: () => void; onNext?: () => void; onSelect?: (date: string) => void;
  onNew?: () => void; onOpenEvent?: (id: string) => void; onPickSlot?: (start: string) => void; onPlanDay?: () => void; onUpload?: () => void;
  locked?: LockedRange[]; now?: string | null; onEditRoutine?: () => void;
  // The standing proposal for THIS date, drawn among the real rows.
  proposed?: import("../../today/YourDay").ProposedDay;
  dayFooter?: import("react").ReactNode;
  // Drop a task straight into a holding block (2026-08-21).
  onFillBlock?: (startMin: number, endMin: number) => void;
  onShift?: (id: string, mins: number) => void;
  onMoveTo?: (id: string, start: string) => void;
  onSetEnd?: (id: string, end: string) => void;
  onSkipToday?: (id: string) => void;
  onPushTomorrow?: (id: string) => void;
  onRunningLate?: (mins: number) => void;
  anytimeItems?: TaskItem[]; onToggleTask?: (id: string) => void; onScheduleTask?: (id: string, startHHMM?: string) => void;
  attachMap?: Record<string, AttachInfo>;
  // BLENDING (Dave, 2026-08-21). One confident offer per block, keyed by
  // event id: the task that fits this block well enough that adding it is a
  // shortcut rather than a gamble. Computed by the flow, rendered here.
  blendMap?: Record<string, { text: string; why: string; onAdd: () => void }>;
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
  // ONE DEFINITION OF BUSY (hotfix 2026-08-21). The planner counts a focus
  // block as OPEN by law (planLoad.ts: it is where picks go), and these Open
  // rows must read the same model: a "7h open" plan sheet next to a day list
  // whose Open rows dodge Deep Work is two stories about one day. Hard and
  // soft routine blocks stay busy here, exactly as before (2026-08-10: Open
  // rows must never span a Protected row).
  // A PROPOSAL IS BUSY TIME (blend, 2026-08-22). openSlots built its Open
  // rows from committed events only, so a proposal filling 11:00-11:45 would
  // sit INSIDE a row still calling that time open, and a drag would drop onto
  // it. Two stories about one day, which is the exact failure the definition
  // above exists to prevent. Proposals join the busy set while they stand.
  const hhmmToMin = (hhmm: string) => { const q = hhmm.split(":"); return Number(q[0] ?? 0) * 60 + Number(q[1] ?? 0); };
  const proposedBusy = (proposed?.blocks ?? []).map((b) => ({ s: hhmmToMin(b.start), e: hhmmToMin(b.end) }));
  const slots = openSlots(
    dayEvents,
    minToHHMM(windowStartMin ?? 8 * 60),
    minToHHMM(windowEndMin ?? 21 * 60),
    30,
    [...locked.filter((l) => !isFocusRange(l)).map((l) => ({ s: l.s, e: l.e })), ...proposedBusy],
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
  // Which gap the finger was over, snapped so the task FITS inside it rather
  // than hanging off the end. Null when the drop was on an event rather than
  // on open time, which falls back to the old behaviour on purpose: dropping
  // onto a busy hour is not a request to double-book it.
  const gapUnder = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)?.closest("[data-gap-start]") as HTMLElement | null;
    if (!el) return null;
    const start = el.dataset.gapStart, end = el.dataset.gapEnd;
    if (!start || !end) return null;
    return dropInto([{ s: toMin(start), e: toMin(end) }], toMin(start), DROP_MINUTES);
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
      // Read the gap BEFORE cleanup: cleanup drops the ghost and the drag
      // class, and elementFromPoint stops seeing what was under the finger.
      const at = dropped ? gapUnder(ev.clientX, ev.clientY) : null;
      cleanup();
      if (dropped) onScheduleTask(id, at ?? undefined);
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
    | { kind: "gap"; start: string; end: string; s: number }
    | { kind: "proposed"; b: import("../planDay").PlanBlock; s: number };
  // NESTING (2026-08-21, Dave: "why are blocks greyed out... we were supposed
  // to have blending options and the ability to do tasks in events").
  // A block that HOLDS tasks says "tasks land here" and they do land there,
  // but the day list drew them as four unrelated rows beside it. An event that
  // sits wholly inside a holding block is drawn INSIDE it instead. Catalog
  // O.11 extended: the top level stays in time order; a holder shows its own
  // work nested at its own times.
  const holders = locked.filter((l) => isFocusRange(l));
  const heldBy = new Map<string, EventItem[]>();
  const nestedIds = new Set<string>();
  if (mode === "day") {
    for (const e of dayEvents) {
      const s0 = toMin(e.data.start);
      const e0 = e.data.end ? toMin(e.data.end) : s0 + 60;
      const h = holders.find((l) => s0 >= l.s && e0 <= l.e);
      if (!h) continue;
      const key = h.label + "@" + h.s;
      heldBy.set(key, [...(heldBy.get(key) ?? []), e]);
      nestedIds.add(e.id);
    }
  }
  const entries: Entry[] = [
    ...dayEvents.filter((e) => !nestedIds.has(e.id)).map((e): Entry => ({ kind: "event", e, s: toMin(e.data.start) })),
    ...locked.map((l): Entry => ({ kind: "locked", l, s: l.s })),
    // B4 (2026-08-23): NOT mode-gated, for the same reason the proposals
    // above it are not. This day list renders under the week and month grids
    // too, so gating the gap ROWS on day mode meant the one view where you
    // are most likely to be looking for a free hour was the view that hid
    // them in a capped trailing list at the bottom. Same bug shape as
    // "6 Events · 5 Proposed" above a list showing none.
    ...(onPickSlot
      ? slots.map((sl): Entry => ({ kind: "gap", start: sl.start, end: sl.end, s: toMin(sl.start) }))
      : []),
    // NOT mode-gated. The day list renders under the month grid too, and
    // gating the ROWS on day-mode while the count line counted regardless
    // produced "6 Events · 5 Proposed" above a list showing none of them.
    ...(proposed?.blocks ?? []).map((b): Entry => ({ kind: "proposed", b, s: toMin(b.start) })),
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
        {(["day", "week", "month", "repeats"] as Mode[]).map((m) => (
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

      {/* W1: everything standing on the calendar, and when it stops. The
          endless ones are called out, because a repeat with no end date is
          the thing nobody notices until it is still going in March. */}
      {mode === "repeats" && (
        repeats.length === 0 ? (
          // B14: the sub described a future in which someone else had already
          // pressed a button elsewhere. The button is here now.
          <div className="empty-state"><div className="empty-title">Nothing Repeats Yet</div>
            <div className="empty-sub">Set one once and it handles itself</div>
            {onNew && <button className="btn btn-secondary" onClick={onNew}>New Repeating Event</button>}</div>
        ) : (
          <div className="pad-x"><div className="card">
            {repeats.map((r) => (
              <div className="row" role="button" tabIndex={0} key={r.id} onClick={() => onOpenEvent?.(r.id)}>
                <span className={"sched-bar cat-bg-" + catColor(r.category)} />
                <div className="row-grow">
                  <div className="conn-name">{r.title}</div>
                  <div className="conn-meta">{r.cadence} · {r.ends}{r.skipped > 0 ? ` · ${r.skipped} skipped` : ""}</div>
                </div>
                {r.endless && <span className="pill pill-subdued">No End</span>}
              </div>
            ))}
          </div></div>
        )
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
                {/* W2: a day carrying something STANDING gets a mark. Not a
                    count: the mark says "there is a fixture here", and a
                    number would be one more thing to read. */}
                {repeatMarks.has(c.date) && <div className="wk-rep" aria-label="Has a repeating event" />}
              </div>
            );
          })}
        </div>
      )}

      {/* A3 (audit 2026-08-21): everything below here is the DAY, and it was
          rendering under Repeats too. The repeats view is a list of what
          stands on the calendar forever; the day it happens to be showing
          underneath is a different question, glued to the bottom of the
          answer. Four modes, one of which has no day list. */}
      {mode !== "repeats" && (<>
      <div className="grp"><div className="plan-head">
        {/* Date lives in the nav above; repeating it here wrapped the row (no-repetition law). */}
        {/* It must not read "0 Events" over a day full of proposals. The
            count says what is committed and, separately, what is proposed;
            neither number pretends to be the other. */}
        <div className="eyebrow">
          {n} {n === 1 ? "Event" : "Events"}
          {proposedBusy.length > 0 && ` \u00b7 ${proposedBusy.length} Proposed`}
        </div>
        <div className="plan-head-acts">
          {hasFuture && onRunningLate && (
            <button className={"plan-cta plan-cta-ghost" + (lateOpen ? " late-armed" : "")} onClick={() => setLateOpen((v) => !v)}>Running Late?</button>
          )}
          {/* N7: most days are a variation on a day you already had. */}
          {mode === "day" && onCopyDay && n === 0 && (
            <button className="plan-cta plan-cta-ghost" onClick={onCopyDay}>Copy Yesterday</button>
          )}
          {/* B15 (2026-08-23): ghosted while a draft is standing.
              The runtime walk caught this and the source law could not: Plan
              My Day lives in this file and Accept the Day lives in
              ScheduleFlow's dayFooter, so a per-FILE scan sees one fill in
              each and two on the glass. Same resolution as Today's Focus
              button, and the same honest signal: dayFooter is only ever
              passed while a proposal is waiting to be accepted. */}
          {onPlanDay && <button className={"plan-cta" + (dayFooter ? " plan-cta-ghost" : "")} onClick={onPlanDay}>Plan My Day</button>}
        </div>
      </div></div>
      {/* N5: the day says when it does not fit, WHERE it does not fit, and
          offers the fix in the same breath. Before this the overlap was
          something you discovered by being late to the second thing.
          At two or more clashes the card folds to one quiet summary line
          (hotfix 2026-08-21): nine alarms taught nothing; one count does. */}
      {mode === "day" && overlap && onFixOverlap && clashCount < 2 && (
        <div className="pad-x"><div className="card"><div className="row">
          <div className="row-glyph cat-fg-orange"><AlertTriangle className="ic" /></div>
          <div className="row-grow">
            <div className="conn-name">Two Things Collide</div>
            <div className="conn-meta">{overlap.line}</div>
          </div>
          <button className="pill-act" onClick={onFixOverlap}>Fix It</button>
        </div></div></div>
      )}
      {mode === "day" && onFixOverlap && clashCount >= 2 && (
        <div className="pad-x">
          <button type="button" className="sched-open" onClick={onFixOverlap}>
            <span className="sched-open-plus">!</span> {clashCount} clashes today
            <span className="sched-fix">Fix</span>
          </button>
        </div>
      )}

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
        // B15: the head above already renders a filled Plan My Day, which
        // fills the whole day. New Event adds one row, so it takes the
        // secondary. This is the tab's most common first-run state and it was
        // showing two fills.
        <div className="empty-state"><div className="t-body">No events</div><button className="btn btn-secondary" onClick={onNew}>New Event</button></div>
      ) : (
        <>
        <div className={"sched-list" + (mode === "day" && drag?.over ? " drop-target" : "")} ref={gridZoneRef}>
          {entries.map((en, i) =>
            en.kind === "gap" ? (
              <button
                className={"sched-row sched-gap" + (isToday && toMin(en.end) <= nowMin ? " past" : "")}
                key={"gap-" + i}
                /* C3 (audit 2026-08-21): a dropped task used to land wherever
                   nextFreeSlot said, no matter which gap you dropped it on,
                   which made the drag a long-winded way to press a button.
                   The gap carries its own window so the drop can read it. */
                data-gap-start={en.start}
                data-gap-end={en.end}
                onClick={() => onPickSlot?.(en.start)}
              >
                <div className="sched-time">{fmtTime(en.start).time}<span className="ampm">{fmtTime(en.start).ap}</span></div>
                <div className="sched-body">
                  <div className="sched-title sched-gap-title">
                    <span className="sched-open-plus">+</span>
                    {gapLabel(toMin(en.end) - toMin(en.start))} open
                  </div>
                  <div className="sched-cat">Until {fmtTime(en.end).time} {fmtTime(en.end).ap} &middot; Tap to fill it</div>
                </div>
              </button>
            ) : en.kind === "proposed" ? (
              // Penciled into the day among the real rows, never below it.
              <ProposedRow
                key={"prop-" + en.b.taskId}
                block={en.b}
                open={proposed!.openId === en.b.taskId}
                onToggle={() => proposed!.onToggle(en.b.taskId)}
                onDuration={(m) => proposed!.onDuration(en.b.taskId, m)}
                onDrop={() => proposed!.onDrop(en.b.taskId)}
              />
            ) : en.kind === "locked" ? (() => {
              const held = heldBy.get(en.l.label + "@" + en.l.s) ?? [];
              const m = modeOf(en.l);
              const kicker = m === "holds"
                ? (held.length === 1 ? "Focus time · 1 task" : held.length ? `Focus time · ${held.length} tasks` : "Focus time · Tasks land here")
                : m === "blends" ? "Can blend · " + freeOf(en.l).join(" and ") + " free"
                : "Protected";
              return (
              <div
                className={"sched-row sched-locked" + (m === "holds" ? " sched-holds" : "") + (isToday && en.l.e <= nowMin ? " past" : "")}
                key={"lock-" + i}
                role="button"
                tabIndex={0}
                onClick={onEditRoutine}
              >
                <div className="sched-time">{fmtTime(minToHHMM(en.l.s)).time}<span className="ampm">{fmtTime(minToHHMM(en.l.s)).ap}</span></div>
                <div className="sched-body">
                  <div className="sched-title sched-lock-title">
                    {m === "holds" ? null : (
                      <LockGlyph className="ic lock-ic" />
                    )}
                    {en.l.label}
                  </div>
                  <div className="sched-cat">{kicker} &middot; Until {fmtTime(minToHHMM(en.l.e)).time} {fmtTime(minToHHMM(en.l.e)).ap}</div>
                  {/* The work this block is holding, at its own times. */}
                  {held.length > 0 && (
                    <div className="block-nest">
                      {held.map((h) => (
                        <div
                          className="block-held"
                          key={h.id}
                          role="button"
                          tabIndex={0}
                          onClick={(ev) => { ev.stopPropagation(); onOpenEvent?.(h.id); }}
                        >
                          <span className={"cat-dot cat-bg-" + catColor(h.data.category)} />
                          <span className="block-held-t truncate">{h.data.title}</span>
                          <span className="block-held-u">{fmtTime(h.data.start).time}{h.data.end ? "\u2013" + fmtTime(h.data.end).time : ""}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* THE HALF THAT WAS UNREACHABLE: blending only ever attached
                      to real calendar events, so the one block built to receive
                      tasks had no way to receive one. */}
                  {m === "holds" && onFillBlock && (
                    <button
                      type="button"
                      className="block-add"
                      onClick={(ev) => { ev.stopPropagation(); onFillBlock(en.l.s, en.l.e); }}
                    >+ Put a Task in This Block</button>
                  )}
                </div>
              </div>
              );
            })() : (
              <div key={en.e.id} ref={en.e.id === nextId ? nextRef : undefined}>
                <DayRow
                  e={en.e}
                  conflict={conflicts?.has(en.e.id) ?? false}
                  onFixOverlap={onOverlapBadge ? () => onOverlapBadge(en.e.id) : undefined}
                  attach={attachMap[en.e.id]}
                  isNext={en.e.id === nextId}
                  isPast={isToday ? (en.e.data.end ? toMin(en.e.data.end) : toMin(en.e.data.start) + 60) < nowMin : false}
                  now={isToday ? now! : null}
                  onOpen={() => onOpenEvent?.(en.e.id)}
                  onShift={onShift ? (m) => onShift(en.e.id, m) : undefined}
                  onMoveTo={onMoveTo ? (t) => onMoveTo(en.e.id, t) : undefined}
                  onSetEnd={onSetEnd ? (end) => onSetEnd(en.e.id, end) : undefined}
                  onSkipToday={onSkipToday ? () => onSkipToday(en.e.id) : undefined}
                  onPushTomorrow={onPushTomorrow ? () => onPushTomorrow(en.e.id) : undefined}
                />
                {/* The blend offer. It sits UNDER the block it belongs to,
                    because that is the sentence it is making: this task goes
                    in that block. One tap attaches it; there is no sheet, no
                    picker, and no confirmation, which is the entire point of
                    "just make it very easy to do things like that". */}
                {blendMap[en.e.id] && (
                  <div className="blend-tuck" role="button" tabIndex={0}
                    onClick={() => blendMap[en.e.id]!.onAdd()}>
                    <span className="blend-plus" aria-hidden>+</span>
                    <div className="row-grow">
                      <div className="blend-text truncate">{blendMap[en.e.id]!.text}</div>
                      <div className="blend-why">{blendMap[en.e.id]!.why}</div>
                    </div>
                  </div>
                )}
              </div>
            ),
          )}
        </div>
        {/* NO DEAD ENDS. A proposal you can see and edit but not accept is
            decoration. The same decision Today offers, under the same day. */}
        {dayFooter}
        {/* The trailing "Open ..." list is retired in EVERY mode now (B4,
            2026-08-23). It survived for week and month on the reasoning that
            those views have no timeline, which was never true: the day list
            it sat under is the timeline. So the same free hour appeared as a
            dashed row at 2pm in one view and as a bare button in a footer in
            another, and the footer silently capped at four. */}
        </>
      )}
      </>)}

      {drag && (
        <div className="anytime-ghost" style={{ left: drag.x, top: drag.y }}>{drag.label}</div>
      )}
    </div>
  );
}

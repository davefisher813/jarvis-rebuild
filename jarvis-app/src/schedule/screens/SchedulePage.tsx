import React, { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { LATE_CHOICES } from "../durations";
import PageHeader, { BarAction, BarText } from "../../shared/PageHeader";
import { useSelection } from "../../shared/useSelection";
import SelectBar from "../../shared/SelectBar";
import { ChevronLeft, ChevronRight, Plus, Camera, AlertTriangle } from "../../shared/icons";
import type { EventItem } from "../types";
import { monthMatrix, fmtTime, openSlots, minToHHMM } from "../calendar";
import { isFocusRange } from "../../routine/types";
import { catColor } from "../../shared/categories";
import SkeletonRows from "../../shared/SkeletonRows";
import DayRow from "./DayRow";
import LockedRow from "./LockedRow";
import AnytimeRow from "./AnytimeRow";
import ProposedRow from "./ProposedRow";
import type { TaskItem } from "../../tasks/TasksService";
import type { ParentLine } from "../../life/parent";
import type { AttachInfo } from "../attachments";
import { dropInto } from "../dayEdit";

// A dropped task gets an hour, the same hour the tap-to-fill path gives it.
const DROP_MINUTES = 60;

// A protected block from Your Routine, rendered on the day it applies.
import type { WeekRow } from "../weekRows";
import { capAfterNumber } from "../../shared/casing";
import { spanShort, longestStretch, stretchLabel } from "../weekRows";

export interface LockedRange { s: number; e: number; label: string; soft?: boolean; kind?: string; id?: string }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WD = ["S", "M", "T", "W", "T", "F", "S"];
const WK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WKLONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// W1 (2026-08-21): "repeats" is a fourth view, not a settings page. What
// stands on your calendar forever belongs beside the calendar.
type Mode = "day" | "week" | "month" | "repeats";
interface WeekCell { date: string; day: number; colors: string[]; }

// THE DATE IS THE HEAD (A Cleaner Top, Dave 2026-09-02: "This looks
// extremely sloppy"; picked "The date leads, the counts sit under it"). It
// is set at 22/800 now, so the weekday is short: "Wed, Sep 2", not
// "Wednesday, Sep 2", which wrapped beside the arrows on a 390px phone.
function fullDay(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${WKLONG[d.getDay()]!.slice(0, 3)}, ${MONTHS[d.getMonth()]!.slice(0, 3)} ${d.getDate()}`;
}
// THE LIST HAS A NAME (Dave 2026-09-02, from the Week screenshot: "maybe
// add 'the day' or 'today' to the top of the schedule because the week
// page has a title above it. If one should, all should"). Every mode's
// list opens on the same quiet head the Week wears: the day's word on the
// left, the fact on the right. Today, Tomorrow and Yesterday by name, any
// other day by its weekday; the date itself is the page head above.
function dayWord(iso: string, todayISO: string): string {
  const d = Math.round((new Date(iso + "T00:00:00").getTime() - new Date(todayISO + "T00:00:00").getTime()) / 86400000);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "Yesterday";
  return WKLONG[new Date(iso + "T00:00:00").getDay()]!;
}
// The week's word by the same rule: This Week, Next Week, Last Week, and
// otherwise "Week of Sep 7".
function weekWord(cells: WeekCell[], todayISO: string): string {
  if (cells.length < 7) return "This Week";
  const first = new Date(cells[0]!.date + "T00:00:00");
  const t = new Date(todayISO + "T00:00:00");
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const inWeek = (d: Date) => cells[0]!.date <= iso(d) && iso(d) <= cells[6]!.date;
  if (inWeek(t)) return "This Week";
  const next = new Date(t); next.setDate(t.getDate() + 7);
  if (inWeek(next)) return "Next Week";
  const last = new Date(t); last.setDate(t.getDate() - 7);
  if (inWeek(last)) return "Last Week";
  return `Week of ${MONTHS[first.getMonth()]!.slice(0, 3)} ${first.getDate()}`;
}
function weekRange(cells: WeekCell[]): string {
  if (cells.length < 7) return "";
  const a = new Date(cells[0]!.date + "T00:00:00"), b = new Date(cells[6]!.date + "T00:00:00");
  const ma = MONTHS[a.getMonth()]!.slice(0, 3), mb = MONTHS[b.getMonth()]!.slice(0, 3);
  return ma === mb ? `${ma} ${a.getDate()} - ${b.getDate()}` : `${ma} ${a.getDate()} - ${mb} ${b.getDate()}`;
}

export default function SchedulePage({
  year, month, selected, todayDate, dots, dayEvents, conflicts, gymDoorFor,
  mode = "month", onMode, weekCells = [], weekRows = [], loading, repeats = [], overlap, onFixOverlap, clashCount = 0, onOverlapBadge, onCopyDay, repeatMarks = new Set<string>(),
  onPrev, onNext, onSelect, onNew, onOpenEvent, onPickSlot, onPlanDay, onUpload, onDeleteMany,
  locked = [], now, onEditRoutine, onOpenBlock, onFillBlock, onShift, onMoveTo, onSetEnd, onSkipToday, onPushTomorrow, onRunningLate,
  onShiftBlock, onRetimeBlock, onResizeBlock,
  proposed, dayFooter,
  anytimeItems = [], onToggleTask, onScheduleTask, parentOf, attachMap = {}, firstMoveMap = {}, blendMap = {},
  windowStartMin, windowEndMin,
}: {
  year: number; month: number; selected: string; todayDate: string;
  dots: Record<number, string[]>; dayEvents: EventItem[]; conflicts?: Set<string>;
  // THE TRAINING DOOR (D4-C): the flow derives what a gym block says for
  // this date; the page just hands it to the row.
  gymDoorFor?: (e: EventItem) => import("./DayRow").GymDoorView | null;
  mode?: Mode; onMode?: (m: Mode) => void; weekCells?: WeekCell[]; loading?: boolean;
  // THE WEEK (D2, approved 2026-09-01): seven day-rows with capacity bars,
  // derived by the flow (schedule/weekRows.ts) from the same window and the
  // same open-slot rule the Day view uses.
  weekRows?: WeekRow[];
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
  // Bulk delete for the selected day (2026-08-24).
  onDeleteMany?: (ids: string[]) => void;
  locked?: LockedRange[]; now?: string | null;
  // Falls back to opening the full Your Routine screen when a row has no id
  // (older callers), or when onOpenBlock is not given (PlanDaySheet's generic
  // "Edit Routine" still uses this one directly, with no id).
  onEditRoutine?: (blockId?: string) => void;
  // THE ACTUAL TAP TARGET NOW (2026-08-28, Dave, all caps: "when I click on
  // something in the schedule it should allow me to edit it like a normal
  // scheduled event"). A tap on a locked row opens BlockSheet - the same
  // small sheet an event opens - instead of leaving for Your Routine.
  onOpenBlock?: (blockId: string) => void;
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
  // Same three moves, for a protected block instead of an event (Dave,
  // 2026-08-28: "edit ALL schedule items THE FUCKING SAME"). No skip/push:
  // a block is a weekly rule, not a single dated thing.
  onShiftBlock?: (id: string, mins: number) => void;
  onRetimeBlock?: (id: string, startMin: number) => void;
  onResizeBlock?: (id: string, endMin: number) => void;
  anytimeItems?: TaskItem[]; onToggleTask?: (id: string) => void; onScheduleTask?: (id: string, startHHMM?: string) => void;
  // The goal an Anytime task moves, by its short name (the ruled row).
  parentOf?: (t: TaskItem) => ParentLine | null;
  attachMap?: Record<string, AttachInfo>;
  // S6-Q36: the first move named on this event's source task, keyed by
  // event id (attachments.ts's firstMoveOf). Same shape as attachMap.
  firstMoveMap?: Record<string, string>;
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
  // Select mode over the events of the SELECTED day, which is exactly what
  // is on screen in Day mode. A month grid has no rows to tick.
  const dayIds = dayEvents.map((e) => e.id);
  const sel = useSelection(dayIds);
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
  // The morning folds shut on every visit: the point of the fold is that
  // the page opens on what is next, and a remembered "open" would undo it.
  const [earlierOpen, setEarlierOpen] = useState(false);
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
    | { kind: "proposed"; b: import("../planDay").PlanBlock; s: number }
    // THE DAY STARTS AT NOW (A Cleaner Top, Dave 2026-09-02, picked
    // "Everything behind you folds to one line, and the day starts at
    // Now"). Two markers ride the same list as the rows, so the order is
    // decided in one place: the fold that holds the morning, and the rule
    // that says where you are.
    | { kind: "earlier"; n: number; s: number }
    | { kind: "now"; s: number };
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

  // THE COUNT LINE (Schedule handoff §4.3, ruled 2026-09-01): what is on
  // screen. Blocks are everything that occupies time (events and protected
  // blocks); proposed is separate; open is the gaps the page already found.
  // Zero terms drop out; a day with nothing reads "Nothing scheduled".
  //
  // AMENDED 2026-09-02 (A Cleaner Top; Dave: "Does the count at the top
  // really have value? I don't think the user cares how many open blocks
  // there are"). He is right about two of the three. The block count is
  // visible by looking at the list, so it says nothing the page is not
  // already saying. What survives is the number you cannot see: open time
  // is the sum of every gap in the day, and it is the number that answers
  // "can I take this on" -- the same number the Week head carries, so the
  // two views now count the same thing. Proposals join it only while some
  // are standing, because that is a decision waiting, not decoration.
  //
  // THE DAY STARTS AT NOW (same catalog): on today the open time counts
  // FORWARD from now. An hour that has gone is not open.
  // The same day list renders under the month grid, so the fold belongs to
  // the LIST, not to Day mode: a past gap under a month grid is the same
  // dead offer it is anywhere else. Week has no day list, Repeats has no day.
  const foldable = isToday && mode !== "week" && mode !== "repeats";
  const endOfEntry = (en: Entry): number =>
    en.kind === "event" ? (en.e.data.end ? toMin(en.e.data.end) : toMin(en.e.data.start) + 60)
      : en.kind === "locked" ? en.l.e
      : en.kind === "gap" ? toMin(en.end)
      : en.s + 30;
  const pastEntries = foldable ? entries.filter((en) => endOfEntry(en) <= nowMin) : [];
  // A gap you are standing in the middle of is not the gap it says it is:
  // at 12:51 the 11:00 slot has nine minutes left, not two hours. Every gap
  // that straddles now is trimmed to now (rounded up to the next quarter,
  // the granularity everything else on this page uses), and one that has
  // less than fifteen minutes left stops being an offer at all.
  const ahead = (foldable ? entries.filter((en) => endOfEntry(en) > nowMin) : entries).flatMap((en): Entry[] => {
    if (!foldable || en.kind !== "gap" || toMin(en.start) >= nowMin) return [en];
    const from = Math.ceil(nowMin / 15) * 15;
    if (toMin(en.end) - from < 15) return [];
    return [{ ...en, start: minToHHMM(from), s: from }];
  });
  // An open slot that has gone is not an offer, so a past gap never renders,
  // folded or not. Past EVENTS are a record of the day and keep their rows.
  const pastShown = pastEntries.filter((en) => en.kind !== "gap");
  const openMin = ahead.filter((en) => en.kind === "gap").reduce((acc, en) => acc + (toMin(en.end) - toMin(en.start)), 0);
  const blockCount = entries.filter((en) => en.kind === "event" || en.kind === "locked").length;
  const countLine: React.ReactNode[] = [];
  if (openMin > 0) countLine.push(<span key="o"><b>{gapLabel(openMin)}</b> open</span>);
  else if (blockCount > 0) countLine.push(<span key="f">No open time</span>);
  if (proposedBusy.length > 0) countLine.push(<span key="p"><b>{proposedBusy.length}</b> proposed</span>);
  if (countLine.length === 0) countLine.push(<span key="n">Nothing scheduled</span>);
  // The list as it renders: the fold, what it holds when it is open, the
  // rule, then the day ahead. Off today (a past or future date) nothing is
  // "earlier" and nothing is "now", so the list is the entries themselves.
  const display: Entry[] = !foldable ? entries : [
    ...(pastShown.length > 0 ? [{ kind: "earlier", n: pastShown.length, s: 0 } as Entry] : []),
    ...(earlierOpen ? pastShown : []),
    ...(pastEntries.length > 0 ? [{ kind: "now", s: nowMin } as Entry] : []),
    ...ahead,
  ];

  return (
    <div className="screen ruled">
      <PageHeader title="Schedule" actions={sel.active ? <BarText label="Done" strong onClick={sel.exit} /> : <>
        {/* Select only appears in Day mode: a month grid has no rows to tick,
            and offering it there would be a control that does nothing. */}
        {onDeleteMany && mode === "day" && dayIds.length > 0 && <BarText label="Select" onClick={() => sel.enter()} />}
        {onUpload && <BarAction label="Upload a Schedule" onClick={onUpload}><Camera className="ic" /></BarAction>}
        <BarAction label="New Event" onClick={onNew}><Plus className="ic" /></BarAction>
      </>} />

      {/* D1 (approved 2026-09-01): the segment is Day / Week / Month. Repeats
          left it and lives at the foot of Month (and the + menu); while the
          repeats list is open, Month stays the lit segment it came from. */}
      <div className="sched-seg"><div className="segmented">
        {(["day", "week", "month"] as Mode[]).map((m) => (
          <button key={m} className={"seg" + (mode === m || (m === "month" && mode === "repeats") ? " active" : "")} onClick={() => onMode?.(m)}>{m[0]!.toUpperCase() + m.slice(1)}</button>
        ))}
      </div></div>

      {/* THE HEAD (A Cleaner Top, 2026-09-02). The date leads at 22/800 and
          the two arrows are bare chevrons at the right edge: the circles
          they wore were the only two circles on the page, and they read as
          buttons competing with the date rather than as its navigation. */}
      <div className="sc-head">
        <div className="sc-date">
          {mode === "month" ? <>{MONTHS[month]}<span className="yr">{year}</span></> : navLabel}
        </div>
        <span className="sc-sp" />
        <div className="sc-steps">
          <button className="sc-step" onClick={onPrev} aria-label="Previous"><ChevronLeft className="ic" /></button>
          <button className="sc-step" onClick={onNext} aria-label="Next"><ChevronRight className="ic" /></button>
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
            {/* WAVE 4, DUPLICATE DOORS (2026-08-29). This called the same
                onNew as the bar's "New Event" three rows up, and its label
                promised a repeating event that onNew does not create. A
                second door is bad; a second door with a false sign on it is
                worse, so this one is gone and the bar keeps the job. */}</div>
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

      {/* THE WEEK (D2, approved 2026-09-01; The Week catalog, 2026-09-02).
          Seven day-rows, one card. Each row: weekday and date on the left
          (today's date in a white disc), the capacity bar (one track placed
          by time across the day's waking window, blocks filled in their
          category colour, a container as a hollow outline, a now-line on
          today), and the open time on the right. Not a day picker: a row
          opens its day. */}
      {mode === "week" && (() => {
        // THE WEEK'S OWN LINE (Dave 2026-09-02, "Lean all the way into it"):
        // the week's open time as the head's count, and under the card the
        // clock the bars are drawn on and the one place a long thing would
        // fit. All derived; a full or finished week says so quietly.
        const ahead = weekRows.filter((r) => r.date >= todayDate);
        const totalOpen = ahead.reduce((acc, r) => acc + r.openMin, 0);
        const best = longestStretch(weekRows, todayDate);
        const tickWin = weekRows.find((r) => r.date === todayDate) ?? weekRows[0];
        // Ticks sit where the hours really are: the window's ends and noon.
        const ticks = tickWin
          ? [tickWin.windowS, ...(tickWin.windowS < 12 * 60 && tickWin.windowE > 12 * 60 ? [12 * 60] : []), tickWin.windowE]
              .map((m) => ({ m, pct: ((m - tickWin.windowS) / Math.max(1, tickWin.windowE - tickWin.windowS)) * 100 }))
          : [];
        const tickLabel = (m: number) => { const h = Math.floor(m / 60) % 24; const r = m % 60; if (h === 12 && r === 0) return "noon"; return `${h % 12 || 12}${r ? ":" + String(r).padStart(2, "0") : ""} ${h >= 12 ? "PM" : "AM"}`; };
        return (<>
        <div className="sh2 sh2-quiet wk-head"><span className="t">{weekWord(weekCells, todayDate)}</span>
          <span className="n">{ahead.length === 0 ? "Over" : totalOpen > 0 ? `${spanShort(totalOpen)} open` : "Full"}</span></div>
        <div className="pad-x"><div className="card list-card-ruled week-rows">
          {weekRows.map((r) => {
            const isToday = r.date === todayDate;
            const past = r.date < todayDate;
            const span = Math.max(1, r.windowE - r.windowS);
            const pctOf = (m: number) => Math.max(0, Math.min(100, ((m - r.windowS) / span) * 100));
            const nowMinLocal = isToday && now ? toMin(now) : null;
            return (
              <div className={"wk-row" + (isToday ? " today" : "") + (past ? " past" : "")} role="button" tabIndex={0} key={r.date}
                onClick={() => { onSelect?.(r.date); onMode?.("day"); }} aria-label={`Open ${WK[r.dow]} ${r.day}`}>
                <div className="wk-d"><span className="wk-w">{WK[r.dow]}</span><span className="wk-n">{r.day}</span></div>
                <div className="wk-b">
                  <div className="wk-bar" aria-hidden="true">
                    {r.blocks.map((b, i) => (
                      <span key={i} className={"wk-seg" + (b.hollow ? " hollow" : "") + " " + (b.hollow ? "cat-fg-" : "cat-bg-") + catColor(b.category)}
                        style={{ left: pctOf(b.s) + "%", width: Math.max(1.2, pctOf(b.e) - pctOf(b.s)) + "%" }} />
                    ))}
                    {nowMinLocal != null && <span className="wk-now" style={{ left: pctOf(nowMinLocal) + "%" }} />}
                  </div>
                </div>
                {past
                  ? <span className="wk-open">{r.count > 0 ? <><b>{r.count}</b> {r.count === 1 ? "block" : "blocks"}</> : ""}</span>
                  : r.openMin > 0
                    ? <span className="wk-open"><b>{spanShort(r.openMin)}</b> open</span>
                    : <span className="wk-open wk-full">Full</span>}
              </div>
            );
          })}
        </div></div>
        {ticks.length > 0 && (
          <div className="wk-ticks" aria-hidden="true">{ticks.map((t, i) => <span key={i} style={{ left: t.pct + "%" }} className={i === 0 ? "first" : i === ticks.length - 1 ? "last" : undefined}>{tickLabel(t.m)}</span>)}</div>
        )}
        {best && (
          <div className="wk-note">Longest open stretch <b>{WK[best.row.dow]} {stretchLabel(best.s, best.e)}</b> · {spanShort(best.e - best.s)}</div>
        )}
        </>);
      })()}

      {/* A3 (audit 2026-08-21): everything below here is the DAY, and it was
          rendering under Repeats too. The repeats view is a list of what
          stands on the calendar forever; the day it happens to be showing
          underneath is a different question, glued to the bottom of the
          answer. Four modes, one of which has no day list. */}
      {mode !== "repeats" && mode !== "week" && (<>
      {/* ONE QUIET LINE, AND ONE ACTION (A Cleaner Top, 2026-09-02). This
          was a caps eyebrow floating on the page ground with a right-aligned
          row of buttons under it: three bands of chrome before the first
          block. It is one row now, the fact on the left and Plan My Day at
          the right in the ghost pill the home page's head actions wear.
          Running Late? moved onto the Now rule, where the minute it is
          about actually is; Copy Yesterday moved into the empty state, the
          only place it ever rendered. */}
      {/* THE LIST HAS A NAME (Dave 2026-09-02): the same quiet head the
          Week's list wears, so the three modes open their lists alike. The
          day's word on the left, the fact on the right, Plan My Day past it. */}
      <div className="sh2 sh2-quiet wk-head sc-dayhead">
        <span className="t">{dayWord(selected, todayDate)}</span>
        <span className="n sc-fact">
          {countLine.map((c, i) => <React.Fragment key={i}>{i > 0 && <span className="sched-sep">{"\u00b7"}</span>}{c}</React.Fragment>)}
        </span>
        {onPlanDay && <button className="see-all pill-action" onClick={onPlanDay}>Plan My Day</button>}
      </div>
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

      {loading ? (
        <SkeletonRows />
      ) : entries.every((en) => en.kind === "gap") ? (
        // B15: the head above already renders a filled Plan My Day, which
        // fills the whole day. New Event adds one row, so it takes the
        // secondary. This is the tab's most common first-run state and it was
        // showing two fills.
        <>
          <div className="empty-state">
            <div className="t-body">No events</div>
            <button className="btn btn-secondary" onClick={onNew}>New Event</button>
            {/* N7: most days are a variation on a day you already had. It
                only ever rendered on an empty day, so this is where it
                belongs; in the head it was a third button on a row that
                already had two. */}
            {mode === "day" && onCopyDay && n === 0 && (
              <button className="row-act" onClick={onCopyDay}>Copy Yesterday</button>
            )}
          </div>
          {mode === "day" && (
            <AnytimeRow items={anytimeItems} onToggle={onToggleTask} onSchedule={onScheduleTask} onDragStart={beginDrag} parentOf={parentOf} />
          )}
        </>
      ) : (
        <>
        {/* ONE CARD (Dave 2026-09-01, "Go with pic 1. Apply that
            everywhere"): the day's timeline rides in the same card Today's
            Whole Day wears, rows together, hairlines between. */}
        <div className="pad-x"><div className="card sched-card">
        <div className={"sched-list" + (mode === "day" && drag?.over ? " drop-target" : "")} ref={gridZoneRef}>
          {display.map((en, i) =>
            en.kind === "earlier" ? (
              // Everything behind you, in one line. It says how much it
              // holds and nothing about how it went: a block that has
              // passed is a record, not a verdict.
              <button
                type="button"
                className="sched-earlier"
                key="earlier"
                aria-expanded={earlierOpen}
                onClick={() => setEarlierOpen((v) => !v)}
              >
                Earlier<span className="n">{en.n} {en.n === 1 ? "block" : "blocks"}</span>
                <span className={"chev chev-down" + (earlierOpen ? " chev-open" : "")} />
              </button>
            ) : en.kind === "now" ? (
              <React.Fragment key="now">
                <div className="sched-now">
                  <span className="w">Now</span>
                  <span className="l" />
                  {/* RUNNING LATE? LIVES ON THE RULE (A Cleaner Top): it is
                      an action about this minute, so it belongs on the line
                      that marks this minute, not in the page head. */}
                  {hasFuture && onRunningLate && (
                    <button
                      type="button"
                      className={"sched-late" + (lateOpen ? " on" : "")}
                      aria-expanded={lateOpen}
                      onClick={() => setLateOpen((v) => !v)}
                    >Running Late?</button>
                  )}
                  <span className="t">{fmtTime(now!).time} {fmtTime(now!).ap}</span>
                </div>
                {lateOpen && onRunningLate && (
                  <div className="pad-x late-chips">
                    <div className="segmented">
                      {LATE_CHOICES.map((m) => (
                        <button className="seg" key={m} onClick={() => { setLateOpen(false); onRunningLate(m); }}>
                          {m === 60 ? "1 hour" : `${m} min`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </React.Fragment>
            ) : en.kind === "gap" ? (
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
                {/* NO "TAP TO FILL IT" (Dave 2026-08-25: "there's no need to
                    say (tap to fill). The display for those slots also do not
                    stand out enough to make someone actually fill it. It
                    looks like everything else.").
                    Both halves of that are the same mistake. The label was
                    explaining an affordance the shape should carry, and the
                    shape was a schedule row: same gutter, same type, same
                    weight as a committed event. An open slot is the one thing
                    on this page that is an INVITATION rather than a fact, and
                    it now looks different in kind. The window it covers moves
                    into the title, so the second line has nothing left to say
                    and goes away with the instruction. */}
                <div className="sched-time">{fmtTime(en.start).time}<span className="ampm">{fmtTime(en.start).ap}</span></div>
                <div className="sched-body">
                  <div className="sched-title sched-gap-title">
                    <span className="sched-open-plus">+</span>
                    {gapLabel(toMin(en.end) - toMin(en.start))} open
                    <span className="sched-gap-win">until {fmtTime(en.end).time} {fmtTime(en.end).ap}</span>
                  </div>
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
              const id = en.l.id;
              return (
              <LockedRow
                key={"lock-" + i}
                l={en.l}
                past={isToday && en.l.e <= nowMin}
                onOpen={id && onOpenBlock ? () => onOpenBlock(id) : () => onEditRoutine?.(id)}
                heldCount={held.length}
                onFillBlock={onFillBlock ? () => onFillBlock(en.l.s, en.l.e) : undefined}
                onShift={onShiftBlock && id ? (m) => onShiftBlock(id, m) : undefined}
                onRetime={onRetimeBlock && id ? (s) => onRetimeBlock(id, s) : undefined}
                onResize={onResizeBlock && id ? (e) => onResizeBlock(id, e) : undefined}
              >
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
              </LockedRow>
              );
            })() : (
              <div key={en.e.id} ref={en.e.id === nextId ? nextRef : undefined}>
                <DayRow
                  e={en.e}
                  conflict={conflicts?.has(en.e.id) ?? false}
                  onFixOverlap={onOverlapBadge ? () => onOverlapBadge(en.e.id) : undefined}
                  attach={attachMap[en.e.id]}
                  firstMove={firstMoveMap[en.e.id]}
                  isNext={en.e.id === nextId}
                  isPast={isToday ? (en.e.data.end ? toMin(en.e.data.end) : toMin(en.e.data.start) + 60) < nowMin : false}
                  now={isToday ? now! : null}
                  onOpen={() => onOpenEvent?.(en.e.id)}
                  onShift={onShift ? (m) => onShift(en.e.id, m) : undefined}
                  onMoveTo={onMoveTo ? (t) => onMoveTo(en.e.id, t) : undefined}
                  onSetEnd={onSetEnd ? (end) => onSetEnd(en.e.id, end) : undefined}
                  selecting={sel.active}
                  picked={sel.isSelected(en.e.id)}
                  onPick={() => sel.toggle(en.e.id)}
                  onSkipToday={onSkipToday ? () => onSkipToday(en.e.id) : undefined}
                  onPushTomorrow={onPushTomorrow ? () => onPushTomorrow(en.e.id) : undefined}
                  gymDoor={gymDoorFor?.(en.e) ?? null}
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
          {/* N7: most days are a variation on a day you already had. It only
              ever offered itself on a day with no events of its own, so it
              is the last row of that day rather than a third button in the
              head (A Cleaner Top, 2026-09-02). A day with events never sees
              it; the empty state carries its own copy for the day that has
              no rows at all. */}
          {mode === "day" && onCopyDay && n === 0 && (
            <button className="row-act sched-copy" onClick={onCopyDay}>Copy Yesterday</button>
          )}
        </div>
        </div></div>
        {/* NO DEAD ENDS. A proposal you can see and edit but not accept is
            decoration. The same decision Today offers, under the same day. */}
        {dayFooter}
        {/* ANYTIME LIVES BELOW THE TIMELINE (ruled 2026-09-01, "Where does
            Anytime live? A section below the timeline"). It sat above,
            which put the unplaced work in front of the day it was not in. */}
        {mode === "day" && (
          <AnytimeRow items={anytimeItems} onToggle={onToggleTask} onSchedule={onScheduleTask} onDragStart={beginDrag} parentOf={parentOf} />
        )}
        {/* The trailing "Open ..." list is retired in EVERY mode now (B4,
            2026-08-23). It survived for week and month on the reasoning that
            those views have no timeline, which was never true: the day list
            it sat under is the timeline. So the same free hour appeared as a
            dashed row at 2pm in one view and as a bare button in a footer in
            another, and the footer silently capped at four. */}
        </>
      )}
      </>)}

      {/* D1: Repeats lives at the foot of Month. One row, the count, the door.
          Wrapped in .ruled (Dave 2026-09-02: "the bottom pill... it looks
          terrible. No need for a pill there.") -- .list-card-ruled already
          named it for the ruled card system, but Schedule never wears
          .ruled anywhere else, so the class was dead: this one card fell
          back to the base 22px-radius .card and read as a stray pill next
          to Accept the Day / Not Today. Scoped to just this card, not the
          page -- the rest of Schedule stays unported. */}
      {mode === "month" && (
        <div className="ruled">
        <div className="pad-x"><div className="card list-card-ruled">
          <div className="task-row p2" role="button" tabIndex={0} onClick={() => onMode?.("repeats")}>
            <div className="task-title"><span className="task-name">Repeats</span>
              <div className="r-k"><span className="r-goal r-cat">{repeats.length === 0 ? "Nothing repeats yet" : capAfterNumber(`${repeats.length} standing`)}</span></div></div>
            <div className="chev" />
          </div>
        </div></div>
        </div>
      )}

      {drag && (
        <div className="anytime-ghost" style={{ left: drag.x, top: drag.y }}>{drag.label}</div>
      )}
      {onDeleteMany && (
        <SelectBar sel={sel} noun="Event" onDelete={() => { onDeleteMany(sel.selected); sel.exit(); }} />
      )}
    </div>
  );
}

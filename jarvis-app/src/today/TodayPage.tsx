import type { ReactNode } from "react";
import { DollarSign, RotateCcw } from "../shared/icons";
import NoticeCard from "./NoticeCard";
import { rowDoor, own } from "../shared/rowDoor";
import { rankStream, DEALT, WAITING, NEW, AMBIENT } from "./stream";
import { cloneElement } from "react";
import type { EventItem } from "../schedule/types";
import type { AttachInfo } from "../schedule/attachments";
import type { TaskItem } from "../tasks/TasksService";
import { fmtTime } from "../schedule/calendar";
import { urgencyFor, distanceFor, type UrgencyKind } from "../tasks/grouping";
import { catColor, catName } from "../shared/categories";
import { useRef, useState } from "react";
import type { BillLine, DaySummary } from "./todayData";
import RollingNumber from "../shared/RollingNumber";
import YourDay from "./YourDay";
import DayRing from "./DayRing";
import { useCondensed } from "../shared/PageHeader";
import { useSyncState } from "../data/useSyncState";
import { Burst, useBurst } from "../shared/Burst";
import type { BurstSize } from "../shared/completion";
import { eveningFacts, todayPlanLine, EVENING_TASKS_NOTE, type EveningStats, type TodayPlan, type WeekRecap } from "./evening";
import { Facts } from "../messages/factsLine";
import MoveHeadliner, { SwipeShell } from "./MoveHeadliner";
import { TodayPeek } from "./usePeekOnce";
import SwipeTip from "../shared/SwipeTip";
import RowCtxAction from "../shared/RowCtxAction";
import RowActionSheet from "../shared/RowActionSheet";
import HeadMore from "../shared/HeadMore";

import { lineCase, titleCase } from "../shared/casing";
import { MorningWeatherLine, WeatherOfferRow } from "../weather/WeatherLine";
import { CheckCircleGlyph, GiftGlyph, SunriseGlyph, SweepGlyph, ParentLineGlyph } from "../shared/glyphs";
import StepCount, { stepsOf } from "../shared/StepCount";
import type { ParentLine } from "../life/parent";
import { originLabel } from "../tasks/origin";
import { useAvatarPhoto } from "../profile/avatarPhoto";

const localISODate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};


// One task row with the completion micro-burst wired to the check tap.
// Completion is optimistic: the check flips and the burst plays immediately,
// and the real toggle (which reloads the list and removes the row) is held
// for 600ms so the animation is actually visible before the row leaves.
// A stream member that is not a NoticeCard: carries the weight rankStream
// reads, renders only its children, so a TaskRow can ride the one stream
// without wearing notice clothes (Your Move, 2026-08-26).
function StreamMember(props: { weight: number; anchor?: boolean; children: ReactNode }) {
  return <>{props.children}</>;
}

// THE RULED ROW (2026-09-01, "Where Urgency Sits" + the Focus contract §4.1).
//   [ ring 24, neutral ][ name 16/500 / kicker: category bar · goal · chip ]
// Three things changed from the row this replaced, and each one is a Dave
// ruling, not taste:
//   1. The ring is never category-coloured. It is the completion control
//      only; the category rides the 4x11 bar on the kicker line.
//   2. The kicker names the GOAL the task moves (the "why"), with the
//      category as the bar's colour. A task with no goal says so quietly
//      and stays adoptable, instead of hiding it.
//   3. The urgency chip moved OFF the trailing slot onto the kicker line,
//      and it says the distance ("2 DAYS LATE"), not the state. Nothing due
//      tomorrow or later gets a chip at all.
// `u` is still accepted and still decides whether the row is urgent at all
// (the flow passes null in the evening to keep the recap calm), but the
// chip's WORDS come from distanceFor.
// SHARED-F-16 (2026-09-05): `burstSize` says how loud this tick should be.
// Clearing the last task of a six-month project used to burst exactly like
// ticking "buy milk"; the flow can answer that before the tick, from the
// projects and tasks it already holds, so the answer arrives with the row.
//
// NO CAPSULE ON THE ROW (Dave 2026-10-05, locked). The Start pill this row
// once could carry is gone (nothing passed it, so it was dead code too). The
// row's verbs are its gestures: swipe left is Done, swipe right is Done (the
// same tick, with its burst and its Undo), a tap opens the task, and a task
// that is LATE quietly shows Done as text on the row. The title is shown in
// Title Case whatever case it was typed in; the record keeps what he typed.
function TaskRow({ t, u, parent, today, burstSize = "small", onToggle, onOpen }: { t: TaskItem; u: { kind: UrgencyKind; label: string } | null; parent?: ParentLine | null; today?: string; burstSize?: BurstSize; onToggle?: () => void; onOpen?: () => void }) {
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
  const dist = u && today ? distanceFor(t.data, today) : null;
  // TRACE-02 (2026-09-07): the checklist rollup, display only. Same numbers
  // the task sheet's own Checklist group prints (TaskSheet.tsx:329), read off
  // the record rather than recomputed anywhere else.
  // TRACE-02b (2026-09-07): counted by the shared piece now, because the
  // Tasks page needed the same slot and section 0 allows exactly one version
  // of it. Today's own answer is unchanged.
  const steps = stepsOf(t.data);
  // THE REASON LINE IS GONE (2026-10-05, the catalog hard gate). This took a
  // `sub` string, the dealt card's reasonFor line joined with a typed middle dot,
  // and split it back apart on that dot to drop the half the chip already says.
  // Nothing passes `sub` (the dealt card is Your Move's row, MoveHeadliner), so it
  // was dead code carrying exactly the pattern R6 bans: a data builder's dotted
  // string cut up and printed inside a .r-k line. If a reason ever returns it
  // arrives as separate facts, never a string to split.
  const name = titleCase(t.data.text);
  const canTick = !!onToggle && !done;
  const late = dist?.kind === "late" && !done;
  return (
    <div className="pad-x">
    <SwipeShell
      menuTitle={name}
      actions={canTick ? [{ label: "Done", run: tap }] : []}
      {...(canTick ? { onRight: tap } : {})}
    >
    {/* THE WHOLE ROW IS THE DOOR (Dave 2026-09-15: "I want all rows
        clickable. How is the first thing that renders on the app not
        clickable?"). Only the title used to open the task; the ring's gutter,
        the kicker's padding and the space around the count were dead. The row
        takes the tap now, and the ring keeps its own verb. */}
    <div className={"task-row" + (localDone ? " just-done" : "")} {...(onOpen ? rowDoor(onOpen) : {})}>
      <div className="task-check-tap" role="checkbox" aria-checked={done} aria-label={done ? "Mark not done" : "Mark done"} onClick={own(tap)}>
        <div className={"task-check" + (done ? " done" : "")} />
        <Burst show={bursting} size={burstSize} />
      </div>
      <div className="task-title">
        <span className="task-name">{name}</span>
        {/* THE SECOND LINE ANSWERS THE PAGE'S QUESTION (Dave 2026-09-01,
            "Together" catalog, on the row he hated). Bar first, so the
            category mark sits at one x on every row. Chip next, so it sits
            at one x whenever it appears. Words last, taking what is left:
            a row with no reason says where it lives
            (The Row and Health, 2026-09-02): the parent's own glyph in its
            category colour, then the parent's full name. The vertical bar is
            gone; the glyph carries the colour now. Two lines, always. */}
        <div className="r-k">
          {dist && !done && <span className={"uchip " + (dist.kind === "late" ? "u-late" : "u-today")}>{dist.label}</span>}
          {parent
            ? <ParentLineGlyph p={parent} />
            : originLabel(t.data)
              ? <span className="r-goal r-cat">{originLabel(t.data)}</span>
              : null}
        </div>
      </div>
      {/* THE RIGHT SLOT HOLDS ONE THING (contract 4.1, lint rule 7): the
          row's one quiet verb once it is late, else the checklist count
          (TRACE-02, 2026-09-07), else nothing. No zeros, no placeholder
          (4.11). */}
      {late && canTick ? (
        <RowCtxAction when label="Done" onAct={tap} />
      ) : steps.total > 0 ? (
        <StepCount {...steps} />
      ) : null}
    </div>
    </SwipeShell>
    </div>
  );
}

const CheckIcon = () => (
  <CheckCircleGlyph />
);
const GiftIcon = () => (
  <GiftGlyph />
);
const NextIcon = () => (
  <SweepGlyph />
);
const SunIcon = () => (
  <SunriseGlyph />
);

function SchedRow({ ev, onOpen }: { ev: EventItem; onOpen?: () => void }) {
  const t = fmtTime(ev.data.start);
  return (
    <div
      className="sched-row sched-row-bare"
      // Every other event row on this page opens on tap (DayRow's onOpen).
      // The Tomorrow row never got that wiring, so it was the one event on
      // the page you could look at but not touch (Dave 2026-09-04: "I can't
      // click on the call on the home page to edit it").
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
    >
      {/* THE AREA IS A DOT, ONCE (Dave 2026-10-05, D4: "area colour only on a dot"). These rows wore Dave's category bar
          (2026-08-19) AND the dot on the line under the title, the one colour drawn twice. The dot carries the name, so it
          stays and the bar goes. */}
      <div className="sched-time">{t.time}<span className="ampm">{t.ap}</span></div>
      <div className="sched-body">
        {/* THE TITLE WRAPS TO TWO LINES BEFORE IT ENDS (Dave 2026-09-26, 2026-09-27): its own span is what the ruled row
            clamps, as DayRow's does. A bare text node in the flex title was cut at the card's edge mid-letter. */}
        <div className="sched-title"><span className="sched-t">{titleCase(ev.data.title)}</span></div>
        {/* An event with no area rendered a dot and nothing after it (Dave's
            2026-09-04 screenshot: the call landed from an email with no
            area, so the second line was one grey dot). It then said "No
            category", which is a line announcing an absence (§AK, 2026-09-22:
            a row with nothing to say shows nothing). The task rows on this
            page already went quiet for an orphan (tasks/origin.ts); so does
            this one: no area, no second line, and no stray dot either. */}
        {catName(ev.data.category) && (
          <div className="sched-cat"><span className={"cat-dot cat-bg-" + catColor(ev.data.category)} />{catName(ev.data.category)}</div>
        )}
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
  avatar = "",
  onSeeAllSchedule,
  onNewEvent,
  onPlanDay,
  onPlanTomorrow,
  onRunningLate,
  onUpNext,
  upNext,
  upNextReason,
  moveCategory,
  moveEstimate,
  moveReason,
  onTomorrowMove,
  fifteen,
  onFifteenDone,
  onFifteenAgain,
  onFifteenStop,
  freshStart,
  locked,
  onOpenEvent,
  onEditRoutine,
  onOpenBlock,
  skippedBlocks,
  onBackToNormal,
  onSeeAllTasks,
  onSeeAllOpen,
  onSeeAllOverdue,
  onGoBigger,
  movedLine,
  onStartTask,
  proposedDay,
  dayFooter,
  dayPrimary,
  blendMap,
  gymDoorFor,
  nowCard,
  liveGym,
  notices = [],
  reminders,
  offersQuiet,
  onSearch,
  onProfile,
  evening,
  plan = null,
  weekly,
  ring,
  daypart,
  birthdays,
  onTextPerson,
  onOpenPerson,
  onCallPerson,
  mail,
  onSeeAllMail,
  mailHead,
  mailEmpty,
  onClearMail,
  onClearPlan,
  billLine,
  onPayBill,
  onOpenBill,
  conflicts,
  attachMap,
  firstMoveMap,
  onShift,
  onMoveTo,
  onSetEnd,
  onSkipToday,
  onPushTomorrow,
  onShiftBlock,
  onDeleteEvent,
  onDeleteBlock,
  onRetimeBlock,
  onResizeBlock,
  parentOf,
  burstSizeOf,
}: {
  greeting: string;
  // Where a task lives, for the ruled row's second line (The Row and Health,
  // 2026-09-02): its project, else the goal it moves, else its category,
  // each with its own glyph. The flow derives it from the same index Pick 5
  // already builds; the page never reads projects or goals itself. Null
  // means the row says where the task came from if that is worth naming
  // (tasks/origin.ts), and otherwise nothing: an absent fact is an empty
  // line, never "No category" (§AK, 2026-09-22).
  parentOf?: (t: TaskItem) => ParentLine | null;
  // SHARED-F-16 (2026-09-05): whether ticking this row clears the last task
  // of its project, answered before the tick so the burst escalates with the
  // moment. Derived by the flow through shared/completion's burstSize, which
  // is the one place that judgement lives.
  burstSizeOf?: (t: TaskItem) => BurstSize;
  dateLong: string;
  // Email as WORK, not a count (Dave 2026-08-20: the old "14 emails need you
  // → deal with it here" line "serves absolutely no purpose"). The flow hands
  // this in already built; nothing needing him means nothing renders.
  mail?: ReactNode;
  /** The band's own head (slice 08: the unified Email band says Email, Open Email). */
  mailHead?: { title: string; action: string };
  onSeeAllMail?: () => void;
  // The band and its head appear together or not at all.
  mailEmpty?: boolean;
  /** Clear All, the band's one bulk action, drawn as the second capsule on its head (Dave 2026-10-05, locked: section-level
   *  actions live in the section head). Absent when the band has fewer than two notices. */
  onClearMail?: () => void;
  /** Clear This Plan, the standing draft's decline, which lives in the day head's overflow (Dave 2026-10-05, locked). */
  onClearPlan?: () => void;
  billLine?: BillLine; // bills due within 3 days, from billsLine (2026-08-09)
  onPayBill?: () => void; // marks the SOONEST due bill paid, with undo
  onOpenBill?: () => void; // the bill card's body: the bill, or the list of them
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
  // TODAY-F-18 (2026-09-05): this defaulted to "DF", one account's initials,
  // on a screen built for anybody. It is never reached (the flow always
  // passes real initials), and the day it is, an empty circle beats someone
  // else's name.
  avatar?: string;
  onSeeAllSchedule: () => void;
  /** The New Event pill on the day card's head (item 8, 2026-10-01). */
  onNewEvent?: () => void;
  onPlanDay?: () => void;
  onPlanTomorrow?: () => void; // evening-only entry aiming the sheet at tomorrow (2026-08-09)
  onRunningLate?: (mins: number) => void; // shift the rest of today from here (2026-08-09)
  onUpNext?: () => void;
  /** Count of open tasks behind the dealt card; the receipt line's number. */
  /** The dealt card's reason line (reasonFor, computed by the flow). */
  upNextReason?: string | null;
  upNext?: TaskItem[];
  // C-24 (Astra, 2026-09-12): the headliner's other two facts and its two
  // doors. All optional: a harness that renders this page without them gets
  // the title, the urgency and the reason, which is still the answer.
  /** The dealt task's area, as the dot plus its name. */
  moveCategory?: { name: string; slot: string } | null;
  /** "20m", the task's own estimate or its area's usual. */
  moveEstimate?: string | null;
  /** Why this one, now: "Fits before Deep Work". The sky fact, and silent
   *  when the pick has no placement to claim. */
  moveReason?: string | null;
  /** Books the dealt task into a named open slot tomorrow. */
  onTomorrowMove?: () => void;
  /** THE FIFTEEN, WHILE IT RUNS (2026-09-16). Present only while a block
   *  started from Start is running or has just run out. `line` is the clock
   *  ("14:32 Left") or the fact that it is up; `over` says which. */
  fifteen?: { taskId: string; text: string; line: string; over: boolean } | null;
  onFifteenDone?: () => void;
  onFifteenAgain?: () => void;
  onFifteenStop?: () => void;
  freshStart?: () => void;
  locked?: { s: number; e: number; label: string; id?: string; justToday?: boolean }[];
  // JUST THIS DAY (2026-10-01): the blocks today skips, and the one door back.
  skippedBlocks?: { s: number; e: number; label: string; id?: string }[];
  onBackToNormal?: (blockId: string) => void;
  onOpenEvent?: (id: string) => void;
  onEditRoutine?: (blockId?: string) => void;
  // The actual tap target on a locked row (2026-08-28): opens BlockSheet, the
  // same small sheet an event opens, instead of leaving for Your Routine.
  onOpenBlock?: (blockId: string) => void;
  // Same quick adjustments Schedule's day list offers (2026-08-28): shift,
  // retime, resize, skip today, push tomorrow, plus overlap and attached-task
  // awareness. Optional throughout - TodayFlow wires whichever it has.
  conflicts?: Set<string>;
  attachMap?: Record<string, AttachInfo>;
  // S6-Q36: same per-event shape as attachMap.
  firstMoveMap?: Record<string, string>;
  onShift?: (id: string, mins: number) => void;
  onMoveTo?: (id: string, start: string, end?: string) => void;
  onSetEnd?: (id: string, end: string) => void;
  onSkipToday?: (id: string) => void;
  onPushTomorrow?: (id: string) => void;
  // Same three moves, for a protected block (2026-08-28, Dave: "edit ALL
  // schedule items THE FUCKING SAME").
  onShiftBlock?: (id: string, mins: number) => void;
  /** Swipe left on a schedule row, Delete. The flow owns write and Undo. */
  onDeleteEvent?: (id: string) => void;
  onDeleteBlock?: (id: string) => void;
  onRetimeBlock?: (id: string, startMin: number) => void;
  onResizeBlock?: (id: string, endMin: number) => void;
  onSeeAllTasks: () => void;
  // TODAY-F-16 (2026-09-05): the door for the OPEN list this page draws
  // (overdue plus due today), which is not the same list as the due tile's.
  // Optional; falls back to onSeeAllTasks when the flow does not pass it.
  onSeeAllOpen?: () => void;
  // WAVE 4 (2026-08-29). Optional so the page still works without it; when
  // absent the red pill falls back to the unfiltered tab it always had.
  onSeeAllOverdue?: () => void;
  // Pick 5: the goal-aware pill lands on the Bigger Picture.
  onGoBigger?: () => void;
  // Pick 4: what today moved, already built by the flow. Absent most days.
  movedLine?: string | null;
  // Fifteen minutes on this one, starting now.
  onStartTask?: (id: string) => void;
  // The standing proposal and the one decision it asks for. Both go to
  // YourDay: there is one schedule on this page now, not two.
  proposedDay?: import("./YourDay").ProposedDay;
  dayFooter?: ReactNode;
  /** The draft's Accept, which rides Plan My Day's row (Dave 2026-09-11). */
  dayPrimary?: ReactNode;
  // The evening mood question. Its own notice: it is not a suggestion.
  // Blend offers for today's blocks (see YourDay). Built by the flow.
  blendMap?: import("./YourDay").BlendMap;
  // UP-ATH-02 (2026-09-06): the Training Door on a gym block, built by the
  // flow through gym/useGymDoor and drawn by the same DayRow Schedule uses.
  gymDoorFor?: (e: EventItem) => import("../schedule/screens/DayRow").GymDoorView | null;
  // The Now card (what is happening this minute) rides at the very top:
  // the page reads in the order the day happens (Dave 2026-08-19).
  nowCard?: ReactNode;
  // A workout in progress (2026-09-19). One row at the head of the Your Move
  // card, above the dealt task; never ranked, never folded.
  liveGym?: ReactNode;
  // Every notice JARVIS has for him, in priority order, rendered under the
  // one Heads Up head instead of floating loose down the page.
  notices?: ReactNode[];
  // The reminders strip. Its own band under Heads Up: reminders are neither
  // notices (they are not news) nor tasks (they are not work).
  reminders?: ReactNode;
  // V4 alert discipline: when two alert cards already rendered, offers wait.
  offersQuiet?: boolean;
  onSearch?: () => void;
  onProfile?: () => void;
  evening?: EveningStats;
  /** Today's committed picks, joined to the tasks as they stand. Null when no
      plan was committed today. Evening only; the flow gates it. */
  plan?: TodayPlan | null;
  weekly?: WeekRecap | null; // Sunday-evening close-out card
  ring?: { done: number; total: number };
  daypart?: "morning" | "evening" | null;
  birthdays?: { id: string; name: string; phone?: string }[]; // today's only; absent is the normal state
  // UP-CORE-03 (2026-09-05): the two things anyone actually does about a
  // birthday. Both open the app's existing person surfaces (Messages
  // Drafting, the Call Prep card), and both are hidden when there is no
  // number to use them with.
  onTextPerson?: (id: string) => void;
  onOpenPerson?: (id: string) => void;
  onCallPerson?: (id: string) => void;
}) {
  // The photo is read here, off the profile, rather than passed down: the
  // flow already hands this page the initials, and the photo follows a
  // change made on Account while Today stays mounted.
  const avatarPhoto = useAvatarPhoto();
  // THE STREAM SHOWS THREE (Dave 2026-08-26, from the five-way render
  // catalog: "Option 1 with a limit. Have a see all button if it exceeds 3
  // things"). Session-local, like a row's own expansion: navigating away and
  // back re-folds, which is the right default for a triage surface.
  const [streamOpen, setStreamOpen] = useState(false);
  // THE STAT TILES (ruled 2026-09-01, superseding Catalog V3.1's pills and
  // the contract's D5). Three rulings, one element:
  //   "Tinted, coloured by what it counts": time is blue, goal movement is
  //     green. These counts span every category, so category colour has
  //     nothing to derive from; the colour has to mean the KIND of count.
  //   "Number big, word small underneath": the number is what you read; the
  //     word sits under it at label size, present without competing.
  //   "Neutral until something is actually late, then amber, then red": a
  //     plain count of due work is quiet. Colour on the owed tiles appears
  //     only when something has slipped, so it always means one thing.
  // Zero tiles do not render (contract §4.11; the clean build greeted a new
  // user with three zeros). Every tile keeps the door it had: events land on
  // Schedule, due on Tasks, late on the Overdue filter, goals on the Bigger
  // Picture. Rolling numbers kept.
  // AMENDED 2026-09-25 (§AM, the Colour Key): time is no longer blue. A count
  // of events has no state, so the events tile is quiet.
  // AMENDED 2026-09-26 (§AM): each tile wears the key's colour for what it
  // counts, and nothing else. Due is amber (needs you soon). Late is red at
  // any count: the key has no threshold, so one late task is as late as
  // three. Events stay quiet, and so do goals (AMENDED 2026-10-05: the goal
  // tile counts the tasks that move a goal today, a count with no state, so
  // its number is white; green means done and nothing here is done).
  const parts = (
    <div className="stat-tiles">
      {summary.events > 0 && (
        <span className="stat-tile st-quiet" role="button" tabIndex={0} onClick={onSeeAllSchedule}>
          <span className="st-n"><RollingNumber value={summary.events} /></span>
          <span className="st-w">{summary.events === 1 ? "event" : "events"}</span>
        </span>
      )}
      {summary.due > 0 && (
        <span className="stat-tile st-warn" role="button" tabIndex={0} onClick={onSeeAllTasks}>
          <span className="st-n"><RollingNumber value={summary.due} /></span>
          <span className="st-w">due</span>
        </span>
      )}
      {summary.overdue > 0 && (
        /* WAVE 4, DUPLICATE DOORS (2026-08-29) still holds: this tile lands
           on the Overdue filter, not the unfiltered tab. It wears red,
           the key's late, from the first late task: it renders only when
           something has actually slipped. */
        <span className="stat-tile st-late" role="button" tabIndex={0} onClick={onSeeAllOverdue ?? onSeeAllTasks}>
          <span className="st-n"><RollingNumber value={summary.overdue} /></span>
          <span className="st-w">late</span>
        </span>
      )}
      {/* PICK 5 (Dave 2026-08-22) survives as the goal tile: it counts what
          moves something he said he wants, and lands on the Bigger Picture.
          Neutral since 2026-10-05 (it was green, and green means done). Absent
          on a day that moves nothing, which is a fact, not a scolding. */}
      {summary.moves > 0 && onGoBigger && (
        <span className="stat-tile st-goal" role="button" tabIndex={0} onClick={() => onGoBigger()}>
          <span className="st-n"><RollingNumber value={summary.moves} /></span>
          <span className="st-w">{summary.moves === 1 ? "goal" : "goals"}</span>
        </span>
      )}
    </div>
  );

  // Evening posture: recap instead of workload, Tonight instead of Your Day,
  // Tomorrow promoted above the (softened) open tasks. Same page, same data.
  const dayEvents = evening ? todayEvents.filter((e) => e.data.start >= now) : todayEvents;

  // The dealt task is a SAME task row as every other list (all task lists
  // identical, Dave 2026-07-30). The head's See All is the stream's own
  // fold, not a navigation; the Focus flow opens from its receipt and the
  // Focus button (YourDay).
  // Birthdays (ride-along 2026-08-03, previewed and approved): shown ONLY on
  // the day itself, above Up Next. People-pink because this is people data;
  // never red. The year is untrusted (contact imports), so no age is claimed.
  const [birthdaySheet, setBirthdaySheet] = useState<string | null>(null);
  const birthdaySection = birthdays && birthdays.length > 0 && (
    <>
      <div className="sh2 sh2-quiet"><span className="t">{birthdays.length === 1 ? "Birthday" : "Birthdays"}</span></div>
      <div className="heads-up-stream stream-grouped">
        <div className="card stream-card">
          {birthdays.map((b) => {
            // NO PILLS ON THE ROW (Dave 2026-10-05, locked). UP-CORE-03 (2026-09-05): the row said the fact and
            // offered nothing, so remembering was still entirely on him. Text opens Messages Drafting with the
            // message already written; Call opens the Call Prep card. Both hide with no number. They are the
            // swipe now (Text first, Call beside it), and a birthday is on the row only on the day itself, so Text
            // is also the one quiet word on it. The tap opens the person, or failing that the row's sheet.
            const text = b.phone && onTextPerson ? () => onTextPerson(b.id) : undefined;
            const call = b.phone && onCallPerson ? () => onCallPerson(b.id) : undefined;
            const verbs = [...(text ? [{ label: "Text", run: text }] : []), ...(call ? [{ label: "Call", run: call }] : [])];
            const door = onOpenPerson ? () => onOpenPerson(b.id) : verbs.length === 1 ? verbs[0]!.run : verbs.length > 1 ? () => setBirthdaySheet(b.id) : undefined;
            const name = titleCase(b.name);
            return (
              <div className="pad-x" key={b.id}>
                <SwipeShell actions={verbs} menuTitle={name}>
                  {/* ROW-TAP (Dave 2026-09-15: "I want all rows clickable"). */}
                  <div className="row" {...(door ? rowDoor(door) : {})}>
                    <div className="av av-32 cat-bg-pink">{b.name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</div>
                    <div className="row-grow">
                      <div className="conn-name truncate">{name}</div>
                      {/* A sub under a title is never caps (see InsightsFlow). */}
                      <div className="conn-meta">Turns a Year Older Today</div>
                    </div>
                    {text && <RowCtxAction when label="Text" onAct={text} />}
                  </div>
                </SwipeShell>
              </div>
            );
          })}
        </div>
      </div>
      {birthdaySheet && (() => {
        const b = birthdays.find((x) => x.id === birthdaySheet);
        if (!b) return null;
        return (
          <RowActionSheet
            title={titleCase(b.name)}
            actions={[
              ...(b.phone && onTextPerson ? [{ label: "Text", onPick: () => onTextPerson(b.id) }] : []),
              ...(b.phone && onCallPerson ? [{ label: "Call", onPick: () => onCallPerson(b.id) }] : []),
            ]}
            onCancel={() => setBirthdaySheet(null)}
          />
        );
      })()}
    </>
  );

  // YOUR MOVE (Combine B from the Up Next catalog, resumed 2026-08-26).
  // The dealt task stops being its own section and joins the one stream. It
  // carries its OWN weight, DEALT (2026-08-26 soundness pass), AND it is the
  // stream's anchor (2026-08-26, Dave's screenshot: "I don't want a task
  // wedged in between 2 arrows" -- resolved as "task leads, urgent notices
  // can still jump it"). Weight alone put it wherever DEALT fell that day,
  // which on a day with one heavier and one lighter notice is the middle;
  // anchor tells rankStream to keep it at an edge instead -- leading unless
  // something outranks it, in which case the WHOLE notice block moves above
  // it together. See stream.ts for the rule.
  // The section answers ONE question at the top of the page. In the evening
  // there is no dealt card and the stream stays what it was: Heads Up.
  const upNextTop = !evening ? upNext?.[0] : undefined;
  // The dealt task LEADS the band, and since 2026-09-16 it leads it at the
  // stream's own scale rather than as a promoted headliner (Dave: "There's no
  // need for this massive first task. It's not like it's not important than
  // the rest"). C-24's promotion is repealed; what survives it is the
  // position, the facts line that says why this one, and the verbs. The
  // stream is built from the notices alone; its anchor rule still holds for
  // the day the dealt task ever rejoins it.
  //
  // AND WHILE A FIFTEEN RUNS, IT IS THE HEADLINER (Dave 2026-09-16: "I still
  // haven't clicked a button and it helped me in any single way"). Start used
  // to write a calendar block and leave the page looking exactly as it did
  // before the tap. The block is now the one question at the top of the page
  // for as long as it lasts: the clock where the reason sits, and the verbs
  // that answer it. It outranks the dealt card because it IS the dealt card
  // acted on, and it holds the slot in the evening too, where there is
  // otherwise no headliner at all: a block started at 5:50 does not stop
  // mattering at six.
  //
  // The facts stay honest about which task this is. When the running block is
  // the task that was dealt, its own urgency, area and estimate still apply;
  // when he started something else (the momentum chain hands Start a
  // different task), the card carries only what the block itself knows.
  const fifteenIsDealt = !!fifteen && fifteen.taskId === upNextTop?.id;
  const headliner = fifteen ? (
    <MoveHeadliner
      title={titleCase(fifteen.text)}
      facts={{
        // THE SAME CHIP THE TASK ROWS WEAR (Dave 2026-09-16: "'today' should
        // be a chip"). distanceFor is the app's one chip producer, so the
        // dealt row cannot drift from the rows under it.
        urgency: fifteenIsDealt && upNextTop ? distanceFor(upNextTop.data, today) : null,
        category: fifteenIsDealt ? moveCategory ?? null : null,
        estimate: fifteenIsDealt ? moveEstimate ?? null : null,
        reason: fifteen.line,
        over: fifteen.over,
      }}
      onDone={onFifteenDone}
      // One question at the end, and it is his: finished, or another fifteen.
      // While it runs the second verb is the way out, because a block you
      // cannot stop is a trap, and stopping trims the calendar to the minutes
      // he actually sat rather than leaving a lie on the day.
      onAgain={fifteen.over ? onFifteenAgain : undefined}
      onStop={fifteen.over ? undefined : onFifteenStop}
      onOpen={() => onOpenTask?.(fifteen.taskId)}
    />
  ) : upNextTop ? (
    <MoveHeadliner
      title={titleCase(upNextTop.data.text)}
      facts={{
        urgency: distanceFor(upNextTop.data, today),
        category: moveCategory ?? null,
        estimate: moveEstimate ?? null,
        reason: moveReason ?? null,
      }}
      onToggle={onToggleTask ? () => onToggleTask(upNextTop.id) : undefined}
      onStart={onStartTask ? () => onStartTask(upNextTop.id) : undefined}
      onTomorrow={onTomorrowMove}
      onOpen={() => onOpenTask?.(upNextTop.id)}
    />
  ) : null;
  // FOCUS BELONGS TO YOUR MOVE'S HEAD (Dave 2026-09-11: "The focus button should be all the way up top under your move
  // and replace that small grey subtext that renders the up next page"; Dave 2026-10-03: "just have a red Focus button";
  // Dave 2026-10-05, locked: a section-level action is a capsule in the section head, never a pill hung under its card).
  // It was a centred .row-act under the Your Move card, which is the shape a standalone action took before the head
  // took them all. It is the same door the dealt row's receipt opened: one control, in the place the question is asked,
  // saying only its verb. The Focus screen is where the deck is counted.
  const focusCapsule = upNextTop && onUpNext
    ? <button className="see-all pill-action" onClick={onUpNext}>Focus</button>
    : null;

  // THE RECAP IS NOT A WALL (Dave's screenshot 2026-08-26: fifteen bare rows
  // filling two screens at 10:35 PM). Evening shows the top of what is still
  // open and folds the rest to a receipt, the same grammar Up Next and the
  // email band already use. The full list is one tap away and tomorrow's
  // planner is the real home for it; tonight is his.
  const EVENING_TASKS_SHOWN = 5;
  const shownTasks = evening ? tasks.slice(0, EVENING_TASKS_SHOWN) : tasks;
  const foldedTasks = tasks.length - shownTasks.length;
  const openDoor = onSeeAllOpen ?? onSeeAllTasks;
  const tasksSection = tasks.length > 0 && (
    <>
      {/* WAVE 4, DUPLICATE DOORS (2026-08-29). "See All" here and the fold
          receipt seven rows below both called onSeeAllTasks, and the receipt
          only exists in the evening, which is exactly when the head button
          was also on screen. The receipt wins where they overlap because it
          names the number it is hiding; the head keeps the job the rest of
          the day, when nothing is folded. */}
      {/* TODAY-F-16 (2026-09-05): both doors out of this section land where
          the section's own rows live. The list is overdue plus due today, and
          onSeeAllTasks opened Tasks on its default Today filter, which
          excludes overdue: "3 More still open" promised eight and delivered
          three or four. The due tile keeps onSeeAllTasks, because that tile
          really does count only what is due today. */}
      <div className="sh2 sh2-quiet"><span className="t">{evening ? "Still Open" : "Today’s Tasks"}</span>
        {foldedTasks <= 0 && <button className="see-all pill-action" onClick={openDoor}>See All</button>}</div>
      <div className="heads-up-stream stream-grouped">
        <div className="card stream-card">
          {shownTasks.map((t) => (
            <TaskRow key={t.id} t={t} u={evening ? null : urgencyFor(t.data, today)} parent={parentOf?.(t)} today={today} burstSize={burstSizeOf?.(t) ?? "small"} onToggle={() => onToggleTask?.(t.id)} onOpen={() => onOpenTask?.(t.id)} />
          ))}
          {foldedTasks > 0 && (
            <button className="receipt-line" onClick={openDoor}>
              <span className="rl-t">{lineCase(`${foldedTasks} More still open`)}</span>
              <div className="chev" />
            </button>
          )}
        </div>
      </div>
      {evening && <div className="pad-x"><div className="input-help">{EVENING_TASKS_NOTE}</div></div>}
    </>
  );

  // PLAN TOMORROW IS ONE CAPSULE IN ONE PLACE (Dave 2026-10-05, locked; Alfred R6: it wore two styles, a dark one on
  // the Tonight card and a red one here). It is a section-level action, so it lives on Tomorrow's head and nowhere
  // else, whether tomorrow holds anything or not. An empty Tomorrow is its head and the capsule, with no plate behind
  // it (rule 12: an action never sits alone in a box).
  const planTomorrowCapsule = onPlanTomorrow
    ? <button className="see-all pill-action" onClick={onPlanTomorrow}>Plan Tomorrow</button>
    : null;
  const tomorrowEmpty = tomorrowEvents.length === 0 && tomorrowTasks.length === 0 && onPlanTomorrow && (
    <div className="sh2 sh2-quiet"><span className="t">Tomorrow</span><span className="n">{tomorrowDate}</span>{planTomorrowCapsule}</div>
  );

  const tomorrowSection = (tomorrowEvents.length > 0 || tomorrowTasks.length > 0) && (
    <>
      {/* The date was styled as a tappable action but only opened Schedule,
          which the head already offers elsewhere. It reads as the fact it is
          now, and the action is the one that helps: set tomorrow up. */}
      <div className="sh2 sh2-quiet"><span className="t">Tomorrow</span><span className="n">{tomorrowDate}</span>{planTomorrowCapsule}</div>
      {/* ONE CARD, LIKE EVERY OTHER BAND (Dave 2026-10-05, the review: the hairlines under these rows ran to the screen's
          edge because the rows sat on the page, outside any card). In the card a hairline ends at the card's edge, the same
          place Your Move's and Reminders' do, in both themes. */}
      <div className="pad-x">
        <div className="card">
          {tomorrowEvents.map((ev) => (
            <SchedRow ev={ev} key={ev.id} onOpen={onOpenEvent ? () => onOpenEvent(ev.id) : undefined} />
          ))}
          {/* Weeklies/monthlies surface on their day only; the day before gets
              this one quiet heads-up row (roadmap v2 dailies weaving). */}
          {tomorrowTasks.map((t) => (
            <div className="sched-row sched-row-bare" key={t.id} {...(onOpenTask ? rowDoor(() => onOpenTask(t.id)) : {})}>
              <div className="sched-time" />
              <div className="sched-body">
                <div className="sched-title"><span className="sched-t">{titleCase(t.data.text)}</span></div>
                {catName(t.data.category) && (
                  <div className="sched-cat"><span className={"cat-dot cat-bg-" + catColor(t.data.category)} />{catName(t.data.category)}</div>
                )}
              </div>
              <span className="pill pill-subdued">{titleCase(t.data.recurrence ?? "")}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );

  // Library chassis (Design 2, approved 2026-08-18): the JARVIS bar is the
  // sticky glass bar; it condenses over the hero with the red energy line
  // once the greeting scrolls away. Nothing collides with the clock.
  const [condProbe, condensed, scrolled] = useCondensed();
  // UP-PLAT-05 (2026-09-06): whether this phone is caught up. Null outside a
  // provider (the visual harnesses render this page bare), which renders
  // nothing at all rather than claiming either state.
  const sync = useSyncState();
  // Everything JARVIS noticed, in one stream: the priority cards from the
  // flow first, then the standing facts (money, email), then the quiet
  // offers. Each is one tap from resolved; nothing here is a dead end.
  const headsUp: ReactNode[] = [
    ...notices,
    billLine ? (
      <NoticeCard
        key="money"
        weight={WAITING}
        icon={<DollarSign className="ic" />}
        tone="cat-fg-green"
        title={billLine.title}
        // §AM (2026-09-26): one bill is two facts, the dot drawn by the
        // stylesheet. The amount is a number with no state (white); the day
        // takes the key's tone for its window (today or tomorrow is due,
        // amber; later is a neutral date, small caps).
        sub={billLine.due ? (
          <div className="facts">
            {billLine.amount && <span className="fact"><b>{billLine.amount}</b></span>}
            <span className={"fact " + billLine.due.tone}>{billLine.due.text}</span>
          </div>
        ) : billLine.sub}
        // A bill card with no button is the same dead end the old email line
        // was: it tells him he owes money and stops. One tap marks it paid.
        action={onPayBill ? { label: "Paid", onClick: onPayBill } : undefined}
        // ROW-TAP (Dave 2026-09-15): the body opens the bill; paying is the
        // swipe, and once the bill is due today or late it is also the one
        // quiet word on the row (Dave 2026-10-05: no pill on a row).
        due={!!billLine.due?.now}
        onOpen={onOpenBill}
      />
    ) : null,
    freshStart ? (
      <NoticeCard
        key="fresh"
        weight={NEW}
        icon={<RotateCcw className="ic" />}
        tone="cat-fg-teal"
        title="Rough Day? Fresh Start."
        // §AM (2026-09-26): it read "Re-plan what's left · Nothing lost", a
        // dot baked into the line in the words' grey, and a first half that
        // only repeated the Re-plan pill beside it. The promise is the half
        // worth keeping: re-planning moves work to tomorrow, it deletes
        // nothing.
        sub="Nothing Lost"
        action={{ label: "Re-Plan", onClick: freshStart }}
        // ROW-TAP (Dave 2026-09-15): the body opens the same re-plan sheet.
        onOpen={freshStart}
      />
    ) : null,
    // AMBIENT (2026-08-26 soundness pass): the weather ask used to carry no
    // weight and rode the ranker's generic fallback by omission. Explicit
    // now, and named below that fallback -- a permission nag should never
    // out-rank even a producer that forgot to declare a weight.
    !offersQuiet ? <WeatherOfferRow key="weather" weight={AMBIENT} /> : null,
  ].filter(Boolean);

  return (
    <TodayPeek.Provider value={true}>
    <div className="screen ruled">
      <div className={"pagebar today-pagebar" + (condensed ? " on" : "") + (scrolled ? " solid" : "")}>
      <div className="today-bar pagebar-row">
        <button className="today-av" aria-label="Account" onClick={onProfile}>
          {/* His photo, when he has set one on Account (Dave's pick,
              2026-09-26), inside the same red disc; his initials otherwise. */}
          <div className="av av-32 av-accent">{avatarPhoto ? <img className="av-photo" src={avatarPhoto} alt="" /> : avatar}</div>
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
            {/* UP-PLAT-05 (2026-09-06): one quiet word when the Store is
                offline. Today is the screen he is on when a write is held,
                and until now nothing anywhere said so: the whole app looked
                identical whether or not anything had left the phone. It says
                only what is true and offers nothing, because the queue is
                already draining itself; Settings, Backup is where the count
                and the Retry live.
                §AM (2026-09-26): two facts, so the dot between them is drawn
                by the stylesheet in the separator's ink, never typed into the
                kicker in the date's. */}
            <div className="eyebrow">
              {sync && !sync.online
                ? <><span className="fact">{dateLong}</span><span className="fact">Offline</span></>
                : dateLong}
            </div>
            <div className="today-title">{greeting}</div>
            <div className="today-summary">{evening ? <Facts facts={eveningFacts(evening, movedLine)} /> : parts}</div>
            {/* Weather Fact (addendum item 4): the morning line. Threshold-
                gated; a mild day renders nothing here. */}
            <MorningWeatherLine todayIso={localISODate()} />
          </div>
          {/* C-23 (Astra, 2026-09-12): in the evening the ring lives inside
              How Today Went below and nowhere else, so the hero copy goes. */}
          {ring && !evening && <DayRing done={ring.done} total={ring.total} />}
        </div>
      </div>
      <div ref={condProbe} />

      {/* TEACHING THE SWIPE (Dave 2026-10-05, locked). One line at the top of the list on first run; gone for good after
          the first swipe or the first dismiss. It shows only when there is a row to swipe. Nothing permanent anywhere. */}
      {(headliner || notices.length > 0 || reminders || (evening && tasks.length > 0)) && <SwipeTip />}

      {/* HOW TODAY WENT (Dave, on the list since 2026-09-07: "'How did I do
          today' never re-evaluated"; built 2026-09-09).
          The plan he commits every morning was written to storage, scored at
          midnight into an event log, and read only by planCap to size the NEXT
          plan. The one person it was about never saw it.
          It is a receipt, not a set of controls: the same tasks are already
          tappable in Still Open below, and two places to tick one thing off is
          the repetition this page keeps having to remove. Every render
          re-derives it from the tasks as they stand right now
          (today/evening.ts, todayPlan), so ticking one off downstairs changes
          this the moment it happens, which is the whole of what
          "re-evaluated" had to mean. Evening only, and silent on a day with no
          committed plan. */}
      {plan && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">How Today Went</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            <div className="row">
              <div className="row-grow"><div className="conn-name">{todayPlanLine(plan)}</div></div>
              <DayRing done={plan.done} total={plan.total} />
            </div>
            {plan.picks.map((p) => (
              <div className="row" key={p.id}>
                <div className={"task-check" + (p.done ? " done" : "")} aria-hidden="true" />
                <div className="row-grow"><div className={"conn-name" + (p.done ? " pick-done" : "")}>{titleCase(p.text)}</div></div>
              </div>
            ))}
          </div></div>
        </>
      )}

      {/* THE DAY'S OWN ORDER (Dave 2026-08-19: "the order should have the
          same flow as the day", amended by Your Move 2026-08-26): Your Move
          → Email → Reminders → Your Day → Tomorrow. Nothing about this
          minute sits below tomorrow. */}
      {/* MERGE B (2026-08-24, Dave: "can't now and your day be combined
          somehow?"). Now was its own section here, directly above Your Day,
          which also drew a NOW rule through its own timeline: one fact, two
          formats, one scroll. That is the same thing he made us fix on the
          drafted day.

          The card now rides down to Your Day as its head, so Now is a
          position in the day rather than a section beside it. In the EVENING
          there is no now card, YourDay gets no head, and the full-day view it
          has always had comes back untouched. */}

      {birthdaySection}

      {/* YOUR MOVE: the one stream, and the dealt task is its first member
          (Combine B, 2026-08-26). Heads Up and Up Next were two sections
          answering the same question from different angles; now the page
          has a single place that says what needs him, sorted by weight,
          with the next task leading its band. Every member is a uniform
          row (the headliner is retired, see stream.ts); the deck behind
          the dealt task folds to the waiting receipt. Evening has no dealt
          card, so the stream stays what it always was there: Heads Up. */}
      {(headsUp.length > 0 || headliner || liveGym) && (() => {
        // FORM FOLLOWS DECISION (Law 3E). The stream ranks its members;
        // the producers only declare weight, form is decided here, in one
        // place, so no card can promote itself.
        const ranked = rankStream([...headsUp]);
        // STRIP THE BOXES, SHOW THREE (Dave 2026-08-26, five-way catalog:
        // "Option 1 with a limit. Have a see all button if it exceeds 3
        // things"). The cap counts ROWS: the ranker has already put the
        // heaviest three on top, so what folds is by definition the
        // lightest. Receipts never count and never fold; they are one quiet
        // line each and the deck receipt is the Focus flow's front door.
        const STREAM_SHOWN = 3;
        const foldable = ranked.rows.length > STREAM_SHOWN;
        const shownRows = streamOpen ? ranked.rows : ranked.rows.slice(0, STREAM_SHOWN);
        return (
          <>
            <div className="sh2 sh2-quiet">
              <span className="t">{evening ? "Heads Up" : "Your Move"}</span>
              {/* See All expands IN PLACE. It used to land on the Tasks
                  page, but what folds here is mostly notices, and notices
                  live nowhere else: a See All that navigates would show him
                  everything except what it hid. */}
              {foldable && (
                <button className="see-all pill-action" onClick={() => setStreamOpen((v) => !v)}>
                  {streamOpen ? "Less" : "See All"}
                </button>
              )}
              {focusCapsule}
            </div>
            <div className="heads-up-stream stream-grouped">
              {/* ONE CARD, THREE ROWS (Dave 2026-08-26: bare rows "don't
                  look like the rest of the home page"). The rows keep
                  Option 1's economy and ride inside one grouped card, the
                  same material as every other band on Today.
                  C-24: the headliner rides the same card, at its head. The
                  harness draws this band without a card at all, but every
                  band on the real page has one and Push A did not change
                  that; the anatomy inside it is the harness's. */}
              {(shownRows.length > 0 || headliner || liveGym) && (
                <div className="card stream-card">
                  {liveGym}
                  {headliner}
                  {/* THE PINNED CARD IS REPEALED, IN THE STREAM (Dave
                      2026-08-26, picking Option 1 with the tradeoff stated:
                      long titles truncate to one line, tap opens the full
                      thing). The pin existed so user-written titles could
                      wrap; the row's tap-to-expand already carries that
                      need, one tap later. Every member rows down, no
                      exceptions; the dealt task passes through untouched
                      because a task row is already the uniform. */}
                  {shownRows.map((r) => (r.type === NoticeCard || r.type === WeatherOfferRow
                    ? cloneElement(r, { form: "row" })
                    : r))}
                </div>
              )}
              {ranked.receipts}
            </div>
          </>
        );
      })()}

      {/* PICK 29, THE NOTICED LINE IS GONE (Dave 2026-08-22, filed under
          "Remove: pays for the rest"). An insight is the least urgent thing
          the app can say, and it was still taking a line on the busiest
          screen. It was not deleted: the same offer now lives on What JARVIS
          Knows, which is the page about what JARVIS has noticed, where it is
          the point instead of an interruption. */}

      {/* EMAIL IS ITS OWN BAND (2026-08-21, Dave: "emails should be sectioned
          off"). Three of the six rows on his Heads Up were mail wearing the
          same clothes as a moved task and a note he left open. Replies are a
          different kind of work from notices, and mixing them meant neither
          could be scanned. Heads Up keeps actual news. */}
      {/* The component must MOUNT to know whether it is empty, so it always
          renders (it returns null when there is nothing) and only the HEAD is
          conditional. Gating both on the same flag would mean it could never
          report itself non-empty. */}
      {mail && !mailEmpty && (
        <div className="sh2 sh2-quiet">
          {/* C-26 (Astra, 2026-09-12): the band is named for what it wants
              from him, not for the app it came out of. Open Inbox stays, and
              the rows under it are untouched. */}
          <span className="t">{mailHead?.title ?? "Ready to Send"}</span>
          {/* CLEAR ALL RIDES THE HEAD (Dave 2026-10-05, locked). When the band also has its door out (Open Inbox, which shows
              only when no receipt line below already opens the inbox), that door waits behind the head's More button: both
              capsules beside "Ready to Send" measured 116px for a title that needs 134, and a title cut to "Ready to S..."
              is the truncation the review bans. One capsule and an overflow never crowd it. */}
          {onClearMail && <button className="see-all pill-action" onClick={onClearMail}>Clear All</button>}
          {!onClearMail && onSeeAllMail && <button className="see-all pill-action" onClick={onSeeAllMail}>{mailHead?.action ?? "Open Inbox"}</button>}
          {onClearMail && onSeeAllMail && (
            <HeadMore label="Email Actions" actions={[{ label: mailHead?.action ?? "Open Inbox", onPick: onSeeAllMail }]} />
          )}
        </div>
      )}
      {/* stream-grouped: the mail rows ride inside one card (MailNotices
          wraps them); the receipt sits under it. */}
      {mail && <div className="heads-up-stream stream-grouped">{mail}</div>}

      {reminders}

      <YourDay
        events={dayEvents}
        proposed={proposedDay}
        footer={dayFooter}
        primary={dayPrimary}
        nowHead={!evening ? nowCard : undefined}
        locked={locked}
        now={now}
        nowLabel={nowLabel}
        onSeeAll={onSeeAllSchedule}
        onNewEvent={onNewEvent}
        onPlanDay={onPlanDay}
        onPlanTomorrow={onPlanTomorrow}
        tomorrowShown={!!(tomorrowSection || tomorrowEmpty)}
        onRunningLate={onRunningLate}
        onClearPlan={onClearPlan}
        onFocus={evening ? undefined : onUpNext}
        onOpenEvent={onOpenEvent}
        onEditRoutine={onEditRoutine}
        onOpenBlock={onOpenBlock}
        skippedBlocks={skippedBlocks}
        onBackToNormal={onBackToNormal}
        blendMap={blendMap}
        title={evening ? "Tonight" : "Your Day"}
        emptyText={evening ? "Nothing Else Tonight" : "Nothing Scheduled Today"}
        conflicts={conflicts}
        attachMap={attachMap}
        firstMoveMap={firstMoveMap}
        onShift={onShift}
        onMoveTo={onMoveTo}
        onSetEnd={onSetEnd}
        onSkipToday={onSkipToday}
        onPushTomorrow={onPushTomorrow}
        onDeleteEvent={onDeleteEvent}
        onDeleteBlock={onDeleteBlock}
        onShiftBlock={onShiftBlock}
        onRetimeBlock={onRetimeBlock}
        onResizeBlock={onResizeBlock}
        gymDoorFor={gymDoorFor}
      />

      {/* Sunday evening only: the weekly close-out card. Two lines, no charts;
          this is what the Insights page folds into (roadmap v2). */}
      {evening && weekly && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Your Week</span></div>
          <div className="pad-x"><div className="card">
            <div className="week-recap">
              <div className="t-body">
                <b>{weekly.things > 0 ? lineCase(`${weekly.things} ${weekly.things === 1 ? "thing" : "things"} done`) : "A Quiet Week"}</b>
                {weekly.events > 0 ? lineCase(` across ${weekly.events} ${weekly.events === 1 ? "event" : "events"} this week`) : " This Week"}
              </div>
              {weekly.bestDay && <div className="t-meta">{weekly.bestDay} was your biggest day.</div>}
            </div>
          </div></div>
        </>
      )}

      {/* Daytime: Up Next (top of page) replaces the old task list; evening
          keeps the softened Still Open recap. */}
      {evening && (tomorrowSection || tomorrowEmpty)}
      {evening && tasksSection}
      {!evening && (tomorrowSection || tomorrowEmpty)}

      {/* HOW DID TODAY GO lives at the BOTTOM (Dave, 2026-08-21: "it should
          be down at the bottom of the page somewhere because it's the end of
          the day"). It sat inside Heads Up, which is the stream of things
          JARVIS noticed and wants acted on NOW. A reflection question is the
          opposite of that: it is the last thing on the page because it is
          the last thing in the day, and it reads as a close-out instead of
          an interruption. */}

      <div className="screen-foot" />
    </div>
    </TodayPeek.Provider>
  );
}

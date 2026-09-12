import type { ReactNode } from "react";
import { DollarSign, RotateCcw } from "../shared/icons";
import NoticeCard from "./NoticeCard";
import { rankStream, DEALT, WAITING, NEW, AMBIENT } from "./stream";
import { cloneElement } from "react";
import type { EventItem } from "../schedule/types";
import type { AttachInfo } from "../schedule/attachments";
import type { TaskItem } from "../tasks/TasksService";
import { fmtTime } from "../schedule/calendar";
import { urgencyFor, distanceFor, type UrgencyKind } from "../tasks/grouping";
import { catColor, catName } from "../shared/categories";
import { useRef, useState } from "react";
import type { DaySummary } from "./todayData";
import RollingNumber from "../shared/RollingNumber";
import YourDay from "./YourDay";
import DayRing from "./DayRing";
import { useCondensed } from "../shared/PageHeader";
import { useSyncState } from "../data/useSyncState";
import { Burst, useBurst } from "../shared/Burst";
import type { BurstSize } from "../shared/completion";
import { eveningSummary, todayPlanLine, EVENING_TASKS_NOTE, type EveningStats, type TodayPlan, type WeekRecap } from "./evening";
import { capAfterNumber } from "../shared/casing";
import { MorningWeatherLine, WeatherOfferRow } from "../weather/WeatherLine";
import { CheckCircleGlyph, GiftGlyph, SunriseGlyph, SweepGlyph, ParentLineGlyph, BullseyeGlyph } from "../shared/glyphs";
import StepCount, { stepsOf } from "../shared/StepCount";
import type { ParentLine } from "../life/parent";

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
//   [ ring 24, neutral ][ name 16/500 / kicker: category bar · goal · chip ][ Start ]
// Three things changed from the row this replaced, and each one is a Dave
// ruling, not taste:
//   1. The ring is never category-coloured. It is the completion control
//      only; the category rides the 4x11 bar on the kicker line.
//   2. The kicker names the GOAL the task moves (the "why"), with the
//      category as the bar's colour. A task with no goal says so quietly
//      and stays adoptable, instead of hiding it.
//   3. The urgency chip moved OFF the trailing slot onto the kicker line,
//      and it says the distance ("2 DAYS LATE"), not the state. Start is
//      alone in the trailing slot now, so the name gets its width back and
//      stops truncating; nothing due tomorrow or later gets a chip at all.
// `u` is still accepted and still decides whether the row is urgent at all
// (the flow passes null in the evening to keep the recap calm), but the
// chip's WORDS come from distanceFor.
// SHARED-F-16 (2026-09-05): `burstSize` says how loud this tick should be.
// Clearing the last task of a six-month project used to burst exactly like
// ticking "buy milk"; the flow can answer that before the tick, from the
// projects and tasks it already holds, so the answer arrives with the row.
function TaskRow({ t, u, sub, parent, today, burstSize = "small", onToggle, onOpen, onStart }: { t: TaskItem; u: { kind: UrgencyKind; label: string } | null; sub?: string | null; parent?: ParentLine | null; today?: string; burstSize?: BurstSize; onToggle?: () => void; onOpen?: () => void; onStart?: () => void }) {
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
  // SAY IT ONCE. The reason line the dealt card owes (reasonFor) leads with
  // the due distance: "Due today", "Waiting 2 days". The kicker chip now says
  // exactly that, so when a chip renders, the reason's due-part is dropped
  // and only what the chip does NOT say survives ("your focus peak"). A
  // reason with nothing left after that renders no line at all.
  const reason = (() => {
    if (!sub) return null;
    if (!dist) return sub;
    const kept = sub.split(" \u00b7 ").filter((part) => !/^(due today|waiting )/i.test(part));
    return kept.length ? kept.join(" \u00b7 ") : null;
  })();
  return (
    <div className={"task-row" + (localDone ? " just-done" : "")}>
      <div className="task-check-tap" role="checkbox" aria-checked={done} aria-label={done ? "Mark not done" : "Mark done"} onClick={tap}>
        <div className={"task-check" + (done ? " done" : "")} />
        <Burst show={bursting} size={burstSize} />
      </div>
      <div className="task-title" role="button" tabIndex={0} onClick={onOpen}>
        <span className="task-name">{t.data.text}</span>
        {/* THE SECOND LINE ANSWERS THE PAGE'S QUESTION (Dave 2026-09-01,
            "Together" catalog, on the row he hated). Bar first, so the
            category mark sits at one x on every row. Chip next, so it sits
            at one x whenever it appears. Words last, taking what is left:
            on Today the question is WHY THIS, NOW, so the dealt card's
            reason ("Your focus peak") rides here, folded up from the caps
            eyebrow it used to be; a row with no reason says where it lives
            (The Row and Health, 2026-09-02): the parent's own glyph in its
            category colour, then the parent's full name. The vertical bar is
            gone; the glyph carries the colour now. Two lines, always. */}
        <div className="r-k">
          {dist && !done && <span className={"uchip " + (dist.kind === "late" ? "u-late" : "u-today")}>{dist.label}</span>}
          {reason
            ? <span className="r-goal r-why">{reason.charAt(0).toUpperCase() + reason.slice(1)}</span>
            : parent
              ? <ParentLineGlyph p={parent} />
              : <span className="r-goal r-cat">No category</span>}
        </div>
      </div>
      {/* THE RIGHT SLOT SAYS THE CHECKLIST IS THERE (TRACE-02, 2026-09-07).
          Dave: "there is no trace of events or steps (for tasks) anywhere in
          the app." A task can carry a checklist and it rendered in exactly
          two places in the whole app: the sheet you typed it into, and a
          search why-line. Close the sheet and the row was byte-identical to
          a task with nothing on it.
          Contract 4.1 rules this slot as holding exactly ONE of an action
          pill, a duration, or a step count, and the count is "used only where
          no action applies" -- which is every Today task row but the dealt
          one, whose Start pill owns the slot. So Start still wins, and the
          count fills a slot that was empty rather than crowding one that was
          not (lint rule 7, right-slot arity: never two children).
          Omitted entirely when the task has no checklist: no zeros, no
          placeholder (4.11). */}
      {onStart && !done ? (
        <button className="pill-act" onClick={(e) => { e.stopPropagation(); onStart(); }}>Start</button>
      ) : steps.total > 0 ? (
        <StepCount {...steps} />
      ) : null}
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
      className="sched-row"
      // Every other event row on this page opens on tap (DayRow's onOpen).
      // The Tomorrow row never got that wiring, so it was the one event on
      // the page you could look at but not touch (Dave 2026-09-04: "I can't
      // click on the call on the home page to edit it").
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
    >
      {/* Same category bar as every other event row (Dave 2026-08-19): the
          Tomorrow rows are a separate component and would have been the one
          place the signal went missing. */}
      <span className={"sched-bar cat-bg-" + catColor(ev.data.category)} />
      <div className="sched-time">{t.time}<span className="ampm">{t.ap}</span></div>
      <div className="sched-body">
        <div className="sched-title">{ev.data.title}</div>
        {/* An event with no area rendered a dot and nothing after it (Dave's
            2026-09-04 screenshot: the call landed from an email with no
            area, so the second line was one grey dot). The task rows on this
            same page already say "No category" for an orphan, the Things
            rule: conspicuous, never hidden, never a blank. Same words here. */}
        <div className="sched-cat"><span className={"cat-dot cat-bg-" + catColor(ev.data.category)} />{catName(ev.data.category) || "No category"}</div>
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
  onPlanDay,
  onPlanTomorrow,
  onRunningLate,
  onUpNext,
  upNext,
  upNextWaiting,
  upNextReason,
  freshStart,
  locked,
  onOpenEvent,
  onEditRoutine,
  onOpenBlock,
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
  onCallPerson,
  mail,
  onSeeAllMail,
  mailEmpty,
  billLine,
  onPayBill,
  conflicts,
  attachMap,
  firstMoveMap,
  onShift,
  onMoveTo,
  onSetEnd,
  onSkipToday,
  onPushTomorrow,
  onShiftBlock,
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
  // means the row says "No category" and stays adoptable, which is the
  // Things rule: orphans conspicuous, never hidden.
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
  onSeeAllMail?: () => void;
  // The band and its head appear together or not at all.
  mailEmpty?: boolean;
  billLine?: { title: string; sub: string }; // bills due within 3 days, from billsLine (2026-08-09)
  onPayBill?: () => void; // marks the SOONEST due bill paid, with undo
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
  onPlanDay?: () => void;
  onPlanTomorrow?: () => void; // evening-only entry aiming the sheet at tomorrow (2026-08-09)
  onRunningLate?: (mins: number) => void; // shift the rest of today from here (2026-08-09)
  onUpNext?: () => void;
  /** Count of open tasks behind the dealt card; the receipt line's number. */
  upNextWaiting?: number;
  /** The dealt card's reason line (reasonFor, computed by the flow). */
  upNextReason?: string | null;
  upNext?: TaskItem[];
  freshStart?: () => void;
  locked?: { s: number; e: number; label: string; id?: string }[];
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
  onMoveTo?: (id: string, start: string) => void;
  onSetEnd?: (id: string, end: string) => void;
  onSkipToday?: (id: string) => void;
  onPushTomorrow?: (id: string) => void;
  // Same three moves, for a protected block (2026-08-28, Dave: "edit ALL
  // schedule items THE FUCKING SAME").
  onShiftBlock?: (id: string, mins: number) => void;
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
  onCallPerson?: (id: string) => void;
}) {
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
  const lateKind = summary.overdue >= 3 ? "st-late" : "st-warn";
  const parts = (
    <div className="stat-tiles">
      {summary.events > 0 && (
        <span className="stat-tile st-time" role="button" tabIndex={0} onClick={onSeeAllSchedule}>
          <span className="st-n"><RollingNumber value={summary.events} /></span>
          <span className="st-w">{summary.events === 1 ? "event" : "events"}</span>
        </span>
      )}
      {summary.due > 0 && (
        <span className="stat-tile st-quiet" role="button" tabIndex={0} onClick={onSeeAllTasks}>
          <span className="st-n"><RollingNumber value={summary.due} /></span>
          <span className="st-w">due</span>
        </span>
      )}
      {summary.overdue > 0 && (
        /* WAVE 4, DUPLICATE DOORS (2026-08-29) still holds: this tile lands
           on the Overdue filter, not the unfiltered tab. It is the one tile
           that wears colour, because it is the one that means you are
           behind: amber for one or two, red from three. */
        <span className={"stat-tile " + lateKind} role="button" tabIndex={0} onClick={onSeeAllOverdue ?? onSeeAllTasks}>
          <span className="st-n"><RollingNumber value={summary.overdue} /></span>
          <span className="st-w">late</span>
        </span>
      )}
      {/* PICK 5 (Dave 2026-08-22) survives as the goal tile: it counts what
          moves something he said he wants, and lands on the Bigger Picture.
          Green, because moving a goal is the completion colour's job. Absent
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
  const birthdaySection = birthdays && birthdays.length > 0 && (
    <>
      <div className="sh2 sh2-quiet"><span className="t">{birthdays.length === 1 ? "Birthday" : "Birthdays"}</span></div>
      <div>
        <div>
          {birthdays.map((b) => (
            <div className="row" key={b.id}>
              <div className="av av-32 cat-bg-pink">{b.name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</div>
              <div className="row-grow">
                <div className="conn-name truncate">{b.name}</div>
                {/* A sub under a title is never caps (see InsightsFlow). */}
                <div className="conn-meta">Turns a year older today</div>
              </div>
              {/* UP-CORE-03 (2026-09-05): the row said the fact and offered
                  nothing, so remembering was still entirely on him. Text
                  opens Messages Drafting with the message already written;
                  Call opens the Call Prep card. No phone, no pills. */}
              {b.phone && onTextPerson && (
                <button type="button" className="pill-act" onClick={() => onTextPerson(b.id)}>Text</button>
              )}
              {b.phone && onCallPerson && (
                <button type="button" className="pill-act" onClick={() => onCallPerson(b.id)}>Call</button>
              )}
            </div>
          ))}
        </div>
      </div>
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
  const dealtRow = upNextTop ? (
    <StreamMember key="dealt" weight={DEALT} anchor>
      <TaskRow
        t={upNextTop}
        u={urgencyFor(upNextTop.data, today)}
        parent={parentOf?.(upNextTop)}
        today={today}
        burstSize={burstSizeOf?.(upNextTop) ?? "small"}
        sub={upNextReason ?? undefined}
        onToggle={() => onToggleTask?.(upNextTop.id)}
        onOpen={() => onOpenTask?.(upNextTop.id)}
        onStart={onStartTask ? () => onStartTask(upNextTop.id) : undefined}
      />
    </StreamMember>
  ) : null;
  // FOCUS BELONGS TO YOUR MOVE (Dave 2026-09-11: "The focus button should be
  // all the way up top under your move and replace that small grey subtext
  // that renders the up next page").
  //
  // Those two were always the same door -- TodayPage passed `onUpNext` to
  // YourDay as `onFocus`, and this receipt called `onUpNext` too -- so the
  // page carried one destination twice: once as a filled red button floating
  // at the bottom between two other buttons, and once as a grey caps line
  // here, which is where a person is actually standing when they want the
  // next thing. One control now, in the place the question gets asked, and it
  // still says how many are waiting because that is the fact that makes it
  // worth tapping.
  const waitingReceipt = upNextTop && onUpNext ? (
    // ...and it is the app's own centred pill (Dave 2026-09-11: "Focus should
    // be centered on the page and styled just like clear all and add to
    // calendar buttons"). Those two are .row-act in a centring wrapper, which
    // is what a standalone action under a card looks like in this app; a
    // full-width left-aligned row with a chevron was a LIST row pretending to
    // be a button.
    //
    // A BUTTON'S LABEL IS ITS LABEL (Dave 2026-09-11: "Focus got mixed up with
    // 23"). The waiting count rode inside the pill as a bare number chip, and
    // a bare number tucked against a verb inside one rounded shape does not
    // read as two facts -- it reads as one garbled label, "Focus 23". The
    // count is worth keeping (it is the fact that makes the button worth
    // tapping, and the Focus flow itself never states how deep the deck is),
    // so it stays, saying what it counts. A chip that is a whole phrase can
    // never be swallowed by the word in front of it, and it is set off in its
    // own weight and ink so the eye takes them as two things.
    <div key="waiting" className="notice-clear-row focus-row">
      <button className="row-act" onClick={onUpNext}>
        <BullseyeGlyph />
        <span className="fc-t">Focus</span>
        {(upNextWaiting ?? 0) > 0 && <span className="fc-n">{upNextWaiting} Waiting</span>}
      </button>
    </div>
  ) : null;

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
      <div>
        <div>
          {shownTasks.map((t) => (
            <TaskRow key={t.id} t={t} u={evening ? null : urgencyFor(t.data, today)} parent={parentOf?.(t)} today={today} burstSize={burstSizeOf?.(t) ?? "small"} onToggle={() => onToggleTask?.(t.id)} onOpen={() => onOpenTask?.(t.id)} />
          ))}
          {foldedTasks > 0 && (
            <button className="receipt-line" onClick={openDoor}>
              <span className="rl-t">{capAfterNumber(`${foldedTasks} More still open`)}</span>
              <div className="chev" />
            </button>
          )}
        </div>
      </div>
      {evening && <div className="pad-x"><div className="input-help">{EVENING_TASKS_NOTE}</div></div>}
    </>
  );

  const tomorrowEmpty = tomorrowEvents.length === 0 && tomorrowTasks.length === 0 && onPlanTomorrow && (
    <>
      <div className="sh2 sh2-quiet"><span className="t">Tomorrow</span><span className="n">{tomorrowDate}</span></div>
      <div className="pad-x"><button className="row row-act" onClick={onPlanTomorrow}>Plan Tomorrow</button></div>
    </>
  );

  const tomorrowSection = (tomorrowEvents.length > 0 || tomorrowTasks.length > 0) && (
    <>
      {/* The date was styled as a tappable action but only opened Schedule,
          which the head already offers elsewhere. It reads as the fact it is
          now, and the action is the one that helps: set tomorrow up. */}
      <div className="sh2 sh2-quiet"><span className="t">Tomorrow</span><span className="n">{tomorrowDate}</span>
        {onPlanTomorrow && <button className="see-all pill-action" onClick={onPlanTomorrow}>Plan It</button>}</div>
      <div>
        <div>
          {tomorrowEvents.map((ev) => (
            <SchedRow ev={ev} key={ev.id} onOpen={onOpenEvent ? () => onOpenEvent(ev.id) : undefined} />
          ))}
          {/* Weeklies/monthlies surface on their day only; the day before gets
              this one quiet heads-up row (roadmap v2 dailies weaving). */}
          {tomorrowTasks.map((t) => (
            <div className="sched-row" key={t.id}>
              <div className="sched-time" />
              <div className="sched-body">
                <div className="sched-title">{t.data.text}</div>
                <div className="sched-cat"><span className={"cat-dot cat-bg-" + catColor(t.data.category)} />{catName(t.data.category) || "No category"}</div>
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
        sub={billLine.sub}
        // A bill card with no button is the same dead end the old email line
        // was: it tells him he owes money and stops. One tap marks it paid.
        action={onPayBill ? { label: "Paid", onClick: onPayBill } : undefined}
      />
    ) : null,
    freshStart ? (
      <NoticeCard
        key="fresh"
        weight={NEW}
        icon={<RotateCcw className="ic" />}
        tone="cat-fg-teal"
        title="Rough Day? Fresh Start."
        sub="Re-plan what's left · Nothing lost"
        action={{ label: "Re-plan", onClick: freshStart }}
      />
    ) : null,
    // AMBIENT (2026-08-26 soundness pass): the weather ask used to carry no
    // weight and rode the ranker's generic fallback by omission. Explicit
    // now, and named below that fallback -- a permission nag should never
    // out-rank even a producer that forgot to declare a weight.
    !offersQuiet ? <WeatherOfferRow key="weather" weight={AMBIENT} /> : null,
  ].filter(Boolean);

  return (
    <div className="screen ruled">
      <div className={"pagebar today-pagebar" + (condensed ? " on" : "") + (scrolled ? " solid" : "")}>
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
            {/* UP-PLAT-05 (2026-09-06): one quiet word when the Store is
                offline. Today is the screen he is on when a write is held,
                and until now nothing anywhere said so: the whole app looked
                identical whether or not anything had left the phone. It says
                only what is true and offers nothing, because the queue is
                already draining itself; Settings, Backup is where the count
                and the Retry live. */}
            <div className="eyebrow">{dateLong}{sync && !sync.online ? " · Offline" : ""}</div>
            <div className="today-title">{greeting}</div>
            <div className="today-summary">{evening ? eveningSummary(evening, movedLine) : parts}</div>
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
                <div className="row-grow"><div className={"conn-name" + (p.done ? " pick-done" : "")}>{p.text}</div></div>
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
      {(headsUp.length > 0 || dealtRow) && (() => {
        // FORM FOLLOWS DECISION (Law 3E). The stream ranks its members;
        // the producers only declare weight, form is decided here, in one
        // place, so no card can promote itself.
        const ranked = rankStream([dealtRow, ...headsUp]);
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
            </div>
            <div className="heads-up-stream stream-grouped">
              {/* ONE CARD, THREE ROWS (Dave 2026-08-26: bare rows "don't
                  look like the rest of the home page"). The rows keep
                  Option 1's economy and ride inside one grouped card, the
                  same material as every other band on Today. */}
              {shownRows.length > 0 && (
                <div className="card stream-card">
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
              {waitingReceipt}
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
          <span className="t">Email</span>
          {onSeeAllMail && <button className="see-all pill-action" onClick={onSeeAllMail}>Open Inbox</button>}
        </div>
      )}
      {/* stream-grouped: the mail rows ride inside one card (MailNotices
          wraps them); the Clear All row and the receipt sit under it. */}
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
        onPlanDay={onPlanDay}
        onPlanTomorrow={onPlanTomorrow}
        tomorrowShown={!!tomorrowSection}
        onRunningLate={onRunningLate}
        onFocus={evening ? undefined : onUpNext}
        onOpenEvent={onOpenEvent}
        onEditRoutine={onEditRoutine}
        onOpenBlock={onOpenBlock}
        blendMap={blendMap}
        title={evening ? "Tonight" : "Your Day"}
        emptyText={evening ? "Nothing else tonight" : "Nothing scheduled today"}
        conflicts={conflicts}
        attachMap={attachMap}
        firstMoveMap={firstMoveMap}
        onShift={onShift}
        onMoveTo={onMoveTo}
        onSetEnd={onSetEnd}
        onSkipToday={onSkipToday}
        onPushTomorrow={onPushTomorrow}
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
  );
}

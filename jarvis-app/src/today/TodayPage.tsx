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
import { Burst, useBurst } from "../shared/Burst";
import { eveningSummary, EVENING_TASKS_NOTE, type EveningStats, type WeekRecap } from "./evening";
import { capAfterNumber } from "../shared/casing";
import { MorningWeatherLine, WeatherOfferRow } from "../weather/WeatherLine";
import { CheckCircleGlyph, GiftGlyph, SunriseGlyph, SweepGlyph } from "../shared/glyphs";

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
function TaskRow({ t, u, sub, goal, today, onToggle, onOpen, onStart }: { t: TaskItem; u: { kind: UrgencyKind; label: string } | null; sub?: string | null; goal?: string | null; today?: string; onToggle?: () => void; onOpen?: () => void; onStart?: () => void }) {
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
        <Burst show={bursting} />
      </div>
      <div className="task-title" role="button" tabIndex={0} onClick={onOpen}>
        <span className="task-name">{t.data.text}</span>
        <div className="r-k">
          <span className={"r-bar cat-bg-" + catColor(t.data.category)} />
          {goal
            ? <span className="r-goal">{goal}</span>
            : <span className="r-goal r-orphan">No goal</span>}
          {dist && !done && <span className={"uchip " + (dist.kind === "late" ? "u-late" : "u-today")}>{dist.label}</span>}
        </div>
        {/* The dealt card explains itself (Up Next Option 1, 2026-08-26):
            the reason rides under the kicker, same law as every automatic
            pick. List rows pass no sub and render exactly as before. */}
        {reason && <div className="eyebrow">{reason}</div>}
      </div>
      {onStart && !done && (
        <button className="pill-act" onClick={(e) => { e.stopPropagation(); onStart(); }}>Start</button>
      )}
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

function SchedRow({ ev }: { ev: EventItem }) {
  const t = fmtTime(ev.data.start);
  return (
    <div className="sched-row">
      {/* Same category bar as every other event row (Dave 2026-08-19): the
          Tomorrow rows are a separate component and would have been the one
          place the signal went missing. */}
      <span className={"sched-bar cat-bg-" + catColor(ev.data.category)} />
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
  upNextWaiting,
  upNextReason,
  freshStart,
  locked,
  onOpenEvent,
  onEditRoutine,
  onOpenBlock,
  onSeeAllTasks,
  onSeeAllOverdue,
  onGoBigger,
  movedLine,
  onStartTask,
  proposedDay,
  dayFooter,
  checkIn,
  blendMap,
  nowCard,
  notices = [],
  reminders,
  offersQuiet,
  onSearch,
  onProfile,
  evening,
  weekly,
  ring,
  daypart,
  birthdays,
  mail,
  onSeeAllMail,
  mailEmpty,
  billLine,
  onPayBill,
  conflicts,
  attachMap,
  onShift,
  onMoveTo,
  onSetEnd,
  onSkipToday,
  onPushTomorrow,
  onShiftBlock,
  onRetimeBlock,
  onResizeBlock,
  goalOf,
}: {
  greeting: string;
  // The goal a task moves, for the ruled row's kicker (2026-09-01). The flow
  // derives it from the same goal index Pick 5 already builds; the page never
  // reads goals itself. Absent means the row says "No goal" and stays
  // adoptable, which is the Things rule: orphans conspicuous, never hidden.
  goalOf?: (t: TaskItem) => string | null;
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
  // The evening mood question. Its own notice: it is not a suggestion.
  checkIn?: ReactNode;
  // Blend offers for today's blocks (see YourDay). Built by the flow.
  blendMap?: import("./YourDay").BlendMap;
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
  weekly?: WeekRecap | null; // Sunday-evening close-out card
  ring?: { done: number; total: number };
  daypart?: "morning" | "evening" | null;
  birthdays?: { id: string; name: string }[]; // today's only; absent is the normal state
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
                <div className="eyebrow">Turns a year older today</div>
              </div>
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
        goal={goalOf?.(upNextTop)}
        today={today}
        sub={upNextReason ?? undefined}
        onToggle={() => onToggleTask?.(upNextTop.id)}
        onOpen={() => onOpenTask?.(upNextTop.id)}
        onStart={onStartTask ? () => onStartTask(upNextTop.id) : undefined}
      />
    </StreamMember>
  ) : null;
  const waitingReceipt = upNextTop && (upNextWaiting ?? 0) > 0 && onUpNext ? (
    <button key="waiting" className="receipt-line" onClick={onUpNext}>
      <span className="rl-t">{capAfterNumber(`${upNextWaiting} More waiting · Skip deals the next one`)}</span>
      <div className="chev" />
    </button>
  ) : null;

  // THE RECAP IS NOT A WALL (Dave's screenshot 2026-08-26: fifteen bare rows
  // filling two screens at 10:35 PM). Evening shows the top of what is still
  // open and folds the rest to a receipt, the same grammar Up Next and the
  // email band already use. The full list is one tap away and tomorrow's
  // planner is the real home for it; tonight is his.
  const EVENING_TASKS_SHOWN = 5;
  const shownTasks = evening ? tasks.slice(0, EVENING_TASKS_SHOWN) : tasks;
  const foldedTasks = tasks.length - shownTasks.length;
  const tasksSection = tasks.length > 0 && (
    <>
      {/* WAVE 4, DUPLICATE DOORS (2026-08-29). "See All" here and the fold
          receipt seven rows below both called onSeeAllTasks, and the receipt
          only exists in the evening, which is exactly when the head button
          was also on screen. The receipt wins where they overlap because it
          names the number it is hiding; the head keeps the job the rest of
          the day, when nothing is folded. */}
      <div className="sh2 sh2-quiet"><span className="t">{evening ? "Still Open" : "Today’s Tasks"}</span>
        {foldedTasks <= 0 && <button className="see-all pill-action" onClick={onSeeAllTasks}>See All</button>}</div>
      <div>
        <div>
          {shownTasks.map((t) => (
            <TaskRow key={t.id} t={t} u={evening ? null : urgencyFor(t.data, today)} goal={goalOf?.(t)} today={today} onToggle={() => onToggleTask?.(t.id)} onOpen={() => onOpenTask?.(t.id)} />
          ))}
          {foldedTasks > 0 && (
            <button className="receipt-line" onClick={onSeeAllTasks}>
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
  const [condProbe, condensed, scrolled] = useCondensed();
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
        action={onPayBill ? { label: "Mark Paid", onClick: onPayBill } : undefined}
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
            <div className="eyebrow">{dateLong}</div>
            <div className="today-title">{greeting}</div>
            <div className="today-summary">{evening ? eveningSummary(evening, movedLine) : parts}</div>
            {/* Weather Fact (addendum item 4): the morning line. Threshold-
                gated; a mild day renders nothing here. */}
            <MorningWeatherLine todayIso={localISODate()} />
          </div>
          {ring && <DayRing done={ring.done} total={ring.total} />}
        </div>
      </div>
      <div ref={condProbe} />

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
      {mail && <div className="heads-up-stream">{mail}</div>}

      {reminders}

      <YourDay
        events={dayEvents}
        proposed={proposedDay}
        footer={dayFooter}
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
        onShift={onShift}
        onMoveTo={onMoveTo}
        onSetEnd={onSetEnd}
        onSkipToday={onSkipToday}
        onPushTomorrow={onPushTomorrow}
        onShiftBlock={onShiftBlock}
        onRetimeBlock={onRetimeBlock}
        onResizeBlock={onResizeBlock}
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
      {checkIn && <div className="today-checkin">{checkIn}</div>}

      <div className="screen-foot" />
    </div>
  );
}

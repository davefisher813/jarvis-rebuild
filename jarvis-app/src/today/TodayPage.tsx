import type { ReactNode } from "react";
import { DollarSign, RotateCcw } from "../shared/icons";
import NoticeCard from "./NoticeCard";
import { rankStream, WAITING, NEW } from "./stream";
import { cloneElement } from "react";
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
import { movesPillLabel } from "./goalPulse";
import { capAfterNumber } from "../shared/casing";
import { MorningWeatherLine, WeatherOfferRow } from "../weather/WeatherLine";
import { CheckCircleGlyph, GiftGlyph, SunriseGlyph, SweepGlyph } from "../shared/glyphs";

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
function TaskRow({ t, u, sub, onToggle, onOpen, onStart }: { t: TaskItem; u: { kind: UrgencyKind; label: string } | null; sub?: string | null; onToggle?: () => void; onOpen?: () => void; onStart?: () => void }) {
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
      <div className="task-title" role="button" tabIndex={0} onClick={onOpen}>
        {t.data.text}
        {/* The dealt card explains itself (Up Next Option 1, 2026-08-26):
            the reason rides under the title, same law as every automatic
            pick. List rows pass no sub and render exactly as before. */}
        {sub && <div className="eyebrow">{sub}</div>}
      </div>
      {/* The urgency label steps aside for Start: knowing a thing is due is
          not the problem, beginning it is. Done rows keep the label. */}
      {onStart && !done ? (
        <button className="pill-act" onClick={(e) => { e.stopPropagation(); onStart(); }}>Start</button>
      ) : u ? (
        <span className={"urgency " + URGENCY_CLASS[u.kind]}>{u.label}</span>
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
  onSeeAllUpNext,
  freshStart,
  locked,
  onOpenEvent,
  onEditRoutine,
  onSeeAllTasks,
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
}: {
  greeting: string;
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
  onSeeAllUpNext?: () => void;
  freshStart?: () => void;
  locked?: { s: number; e: number; label: string }[];
  onOpenEvent?: (id: string) => void;
  onEditRoutine?: () => void;
  onSeeAllTasks: () => void;
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
      {/* PICK 5 (Dave 2026-08-22). Events, due and overdue all count work by
          its SHAPE. None of them can tell him whether any of today is worth
          doing. This one counts what moves something he said he wants, in the
          goal colour the Bigger Picture already uses, and lands there. It is
          absent on a day that moves nothing, which is a fact, not a scolding. */}
      {summary.moves > 0 && onGoBigger && (
        <span className="day-pill dp-purple" role="button" tabIndex={0} onClick={() => onGoBigger()}>
          <RollingNumber value={summary.moves} />&nbsp;{movesPillLabel(summary.moves)}
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

  // ONE CARD (Option 1, approved 2026-08-26). The deck deals one: the top
  // task with its reason and the only Start on the section. The rest of the
  // deck is a receipt line that opens the Focus flow, where Skip lives.
  // Three equal rows asked him to rank them himself; that was the decision
  // tax this section existed to remove.
  const upNextTop = upNext?.[0];
  const upNextSection = !evening && upNextTop && (
    <>
      <div className="sh2 sh2-quiet"><span className="t">Up Next</span>{onSeeAllUpNext && <button className="see-all" onClick={onSeeAllUpNext}>See All</button>}</div>
      <div>
        <div>
          <TaskRow
            t={upNextTop}
            u={urgencyFor(upNextTop.data, today)}
            sub={upNextReason ?? undefined}
            onToggle={() => onToggleTask?.(upNextTop.id)}
            onOpen={() => onOpenTask?.(upNextTop.id)}
            onStart={onStartTask ? () => onStartTask(upNextTop.id) : undefined}
          />
          {(upNextWaiting ?? 0) > 0 && onUpNext && (
            <button className="receipt-line" onClick={onUpNext}>
              <span className="rl-t">{capAfterNumber(`${upNextWaiting} More waiting · Skip deals the next one`)}</span>
              <div className="chev" />
            </button>
          )}
        </div>
      </div>
    </>
  );

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
      <div className="sh2 sh2-quiet"><span className="t">{evening ? "Still Open" : "Today’s Tasks"}</span><button className="see-all" onClick={onSeeAllTasks}>See All</button></div>
      <div>
        <div>
          {shownTasks.map((t) => (
            <TaskRow key={t.id} t={t} u={evening ? null : urgencyFor(t.data, today)} onToggle={() => onToggleTask?.(t.id)} onOpen={() => onOpenTask?.(t.id)} />
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
        {onPlanTomorrow && <button className="see-all" onClick={onPlanTomorrow}>Plan It</button>}</div>
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
  const [condProbe, condensed] = useCondensed();
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
    !offersQuiet ? <WeatherOfferRow key="weather" /> : null,
  ].filter(Boolean);

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
          same flow as the day"): Now → Heads Up → Up Next → Your Day →
          Tomorrow. Nothing about this minute sits below tomorrow. */}
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

      {/* HEADS UP: the one notice stream. Every card, row, and offer JARVIS
          wants him to see lives here under one head, so the page has a
          single place to look instead of nine floating interruptions. */}
      {/* THE DAY DRAFT IS A COMMITMENT, NOT A NOTICE (cleanup 2026-08-22).
          Ranked with the stream it fell to the default weight and sank
          BELOW two verb rows on Dave's screenshot -- the most important
          block on the page, under trivia. It renders first, always. */}
      {headsUp.length > 0 && (() => {
        // FORM FOLLOWS DECISION (Law 3E). The stream ranks its members:
        // the heaviest becomes THE headliner, everything else drops to a
        // one-line verb row, and receipts collapse to the quiet line. The
        // producers only declare weight; form is decided here, in one
        // place, so no card can promote itself.
        const ranked = rankStream(headsUp);
        return (
          <>
            <div className="sh2 sh2-quiet"><span className="t">Heads Up</span></div>
            <div className="heads-up-stream">
              {ranked.headliner && (ranked.headliner.type === NoticeCard
                ? cloneElement(ranked.headliner, { form: "headliner" })
                : ranked.headliner)}
              {/* A PINNED CARD IS NOT A PROMOTION (2026-08-24, from the goal
                  nudge truncating "Run three times a week" to "Run three
                  ti..."). The stream still owns the HEADLINER, which is the
                  only real promotion; what a producer may pin is the card
                  form, and only for the reason the mail law already
                  established: a title that is USER CONTENT is any length the
                  world chooses, so the one-line row cannot hold it and the
                  row's rule of "the sub yields whole or not at all" then
                  costs the evidence line too. A pinned card can still be
                  outranked, still be dismissed, still be beaten to the
                  headline. It just is not shredded. */}
              {ranked.rows.map((r) => (r.type === NoticeCard && (r.props as { form?: string }).form !== "card"
                ? cloneElement(r, { form: "row" })
                : r))}
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
          {onSeeAllMail && <button className="see-all" onClick={onSeeAllMail}>Open Inbox</button>}
        </div>
      )}
      {mail && <div className="heads-up-stream">{mail}</div>}

      {reminders}

      {upNextSection}

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
        onRunningLate={onRunningLate}
        onFocus={evening ? undefined : onUpNext}
        onOpenEvent={onOpenEvent}
        onEditRoutine={onEditRoutine}
        blendMap={blendMap}
        title={evening ? "Tonight" : "Your Day"}
        emptyText={evening ? "Nothing else tonight" : "Nothing scheduled today"}
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

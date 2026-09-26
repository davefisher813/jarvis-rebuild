import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { focusStarted } from "../events/focus";
import { useSchedule, useTasks, useProfile, useCategories, useRoutine, usePeople, useProjects, useGoals, useDecisions, useNotes, useOptionalRules, useBrainDocs, useOptionalStrands } from "../data/NotesProvider";
import { pausedCategoryIds, effectiveKind } from "../categories/kinds";
import { goalTone, catName, catColor as catColorOf } from "../shared/categories";
import { workWindowOf, isSuggested, rankCandidates } from "../schedule/planMeta";
import type { Category } from "../categories/types";
import type { Project } from "../projects/types";
import type { Goal } from "../life/types";
import { todayISO, fmtTime, addMinutes, minToHHMM, shiftFitsDay, nextOccurrence, nextFreeSlot, addDays, daysBetween } from "../schedule/calendar";
import { ENTITY_EVENT, type EventItem } from "../schedule/types";
import { ENTITY_TASK } from "../notes/types";
import { useFreshLists } from "../data/useFreshLists";
import type { TaskItem } from "../tasks/TasksService";
import { greetingFor, longDate, shortDate } from "./greeting";
import { tomorrowISO, nowHHMM, daySummary, dayRing, todaysTasks, billsLine, billsDueSoon, payableBill } from "./todayData";
import TodayPage from "./TodayPage";
import MailNotices from "./MailNotices";
import ReportFlow, { reportSeen, markReportSeen } from "../review/ReportPage";
import { monthName as monthTitle } from "../review/report";
import { useOptionalSeal } from "../data/NotesProvider";
import NoticeCard from "./NoticeCard";
import { rowDoor, own } from "../shared/rowDoor";
import { FAILING, WAITING, NEW, RESUME, LIVE, spotIsDuplicate } from "./stream";
import { chainQuietToday, dismissChain, nextBest, chainReason } from "../tasks/momentum";
import { distanceFor, type Distance } from "../tasks/grouping";
import { AUTOMATION_LABEL, tuningAllows, tuningScope, tuningWeight, tuningsFrom, type TuningChoice } from "../rules/tuning";
import { leadFor } from "../schedule/leaveBy";
import { EventWeatherLine } from "../weather/WeatherLine";
import { capAfterNumber } from "../shared/casing";
import { movedBy, burstSize, celebrationLine, type Moved } from "../shared/completion";
import { birthdaysOn, upcomingBirthdays, type BirthdayHit } from "../people/birthdays";
import type { Person } from "../people/types";
import CallPrepSheet from "../people/CallPrepSheet";
import MessageDraftSheet from "../people/MessageDraftSheet";
import TaskSheet, { type SheetCategory, type TaskDraft } from "../tasks/screens/TaskSheet";
import EventSheet, { type EventDraft } from "../schedule/screens/EventSheet";
import EventDetailPage from "../schedule/screens/EventDetailPage";
import BlockSheet, { type BlockDraft } from "../schedule/screens/BlockSheet";
import PlanDaySheet from "../schedule/screens/PlanDaySheet";
import { aiPlanDay } from "../schedule/planDayAI";
import { DEFAULT_ROUTINE, planWindowFor, protectedRangesFor, type RoutineData } from "../routine/types";
import { chronotypeFor, peakWindowFor } from "../schedule/energy";
import { daySizing } from "../schedule/daySizing";
import { shiftFutureEvents, shiftPlan, restoreShift } from "../schedule/runningLate";
import { ensureCheckinNotifications, cancelCheckinNotifications, ensureEventReminders, ensureTaskReminders } from "../shared/notifications";
import { badgeCount, setAppBadge } from "../shared/badge";
import { isEvening, eveningStats, weekRecap, todayPlan } from "./evening";
import { pendingPicks } from "../events/planOutcome";
import { rememberLeanedOn } from "./leanedOn";
import { readSamples } from "../shared/timeSense";
import { settleDuePlans } from "../events/pipeline";
import { buildGoalIndex, liveGoals, reachOf, goalTitleForTask, sheetGoals } from "../bigger/reach";
import { buildParentIndex, parentForTask } from "../life/parent";
import { sheetEvents } from "../schedule/sheetEvents";
import { inheritFromThread } from "../messages/threadTasks";
import { endOfAct, type MailAct } from "../messages/mailAct";
import { dayPhrase } from "../money/bills";
import { rankProjects, closable, projectPaceParts, projectProgress } from "../bigger/progress";
import { movesCount, goalsMovedToday, movedLine, untouchedGoal, openWorkOf, dismissGoalNudge } from "./goalPulse";
import SkeletonScreen from "../shared/SkeletonScreen";
import type { Recurrence } from "../notes/types";
import { useAI } from "../ai/useAI";
import { useGoogle } from "../connections/google/GoogleSession";
import { mapThreadFull, buildReply } from "../connections/google/map";
import { cardDraftJob } from "../messages/cardDraftJob";
import { DUR_CHOICES, durLabel } from "../schedule/durations";
import { heldBy, heldLine, type HardLine } from "../brain/hardLines";
import {
  moveEvent as moveEventAdjust, undoMoveEvent as undoMoveEventAdjust, type MoveOutcome,
  resizeEvent as resizeEventAdjust, undoResizeEvent as undoResizeEventAdjust, type ResizeOutcome,
  skipEventToday as skipEventTodayAdjust, undoSkipEventToday as undoSkipEventTodayAdjust,
  pushEventTomorrow as pushEventTomorrowAdjust, undoPushEventTomorrow as undoPushEventTomorrowAdjust, type PushOutcome,
} from "../schedule/eventAdjust";
import { shiftBlock as shiftBlockAdjust, blockShiftFits, retimeBlock as retimeBlockAdjust, resizeBlock as resizeBlockAdjust, editBlockBasics, removeBlock as removeBlockAdjust } from "../routine/blockAdjust";
import { overlapsOn } from "../schedule/dayEdit";
import { isKept } from "../schedule/overlapAck";
import { attachInfo, firstMoveOf, type AttachInfo } from "../schedule/attachments";
import { cachedDraft, pregenerate, rememberDraft, PREGEN_CAP } from "../ai/pregen";
import { loadNudgeCounts } from "../messages/escalate";
import { settleAll } from "../messages/settle";
import { decide } from "../messages/mailAction";
import { enqueueTodaySend } from "../messages/todayOutbox";
import { planFromBlock } from "../tasks/ifThen";
import { endOf, FIFTEEN } from "../tasks/rightNow";
import { acceptBody } from "../messages/meetingTimes";
import { Facts } from "../messages/factsLine";
import { welcomeBack, loadLastSeen, markSeen } from "./welcomeBack";
import { proposeFirstMove, nextStart, endsAt, ritualIsReady, whyNotReady, ritualPlan, LENGTHS, DEFAULT_MINUTES, type Ritual } from "../tasks/startRitual";
import RitualSheet from "../tasks/screens/RitualSheet";
import { bestPerBlock, blockKind, recordBlend, loadBlendMemory } from "../schedule/blend";
import type { BlendMap } from "./YourDay";
import GymFlow from "../gym/GymFlow";
import { useGymDoor } from "../gym/useGymDoor";
import { loadMailSnapshot, mailNotices, type MailNotice } from "../messages/home";
import { showToast } from "../shared/toast";
import { attemptWrite } from "../shared/guard";
import RemindersStrip from "./RemindersStrip";
import RemindersFlow from "../tasks/screens/RemindersFlow";
import SnoozeSheet from "../tasks/screens/SnoozeSheet";
import RowActionSheet from "../shared/RowActionSheet";
import type { LinkCandidate } from "../tasks/screens/LinkedItemSheet";
import { displayTitle } from "../notes/docModel";
import type { LinkedItem, ContextTriggerConfig } from "../notes/types";
import { promptsDue, shownNow, snoozedForADay } from "../tasks/contextPrompts";
import ContextPromptSheet from "../tasks/screens/ContextPromptSheet";
import { SHORTCUTS } from "../health/settings";
import ReminderSheet from "../tasks/screens/ReminderSheet";
import { stripPick, missedReminders, snoozeTime, snoozeFrom } from "../tasks/reminders";
import { remindersToIcs, saveIcsFile } from "../tasks/ics";
import type { ReminderInfo } from "../notes/types";
import { runAutoSweep, retrySweep, undoSweep, readReceipt, setAsideCandidate, markOffered, liveMoved, dismissSweepCard, sweepCardDismissed, type SweepReceipt } from "../tasks/autoSweep";
import { restorableSpot, clearSpot, dismissSpot, spotAgo, type WorkSpot } from "../restore/whereYouWere";
import { readLive, isStillActive, type LiveSession } from "../gym/liveSession";
import { liveCard, type LiveCard } from "../gym/liveCard";
import { readFifteen, writeFifteen, clearFifteen, isStillLive, fifteenFace, extended, type LiveFifteen } from "./liveFifteen";
import { sourceOpener } from "../shared/openSource";
import { isQuiet, goQuiet, localQuietStore } from "../shared/quietFor";

// "All its work is done" is an observation, not a verdict: a project he is
// deliberately holding open can refuse the Close It offer for a few days.
const closeOfferStore = localQuietStore("jarvis.closeoffer.dismissed.v1");
// UP-CORE-03 (2026-09-05): the evening-before card, waved off per person.
const birthdayStore = localQuietStore("jarvis.birthday.dismissed.v1");
// What the drafted message has to carry. Handed to Messages Drafting as its
// `about`, which the sheet has accepted since it was built and no caller
// ever passed (BRAIN-F-24).
const BIRTHDAY_ABOUT = "a short happy-birthday message";
// "HH:MM" as minutes. calendar.ts keeps its own copy private, and this file
// needs the one comparison (UP-CORE-08's "which event am I inside").
const minsOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
// Calendar days forward, stepped with setDate so a clocks-change day counts
// as one day (the timezone law; same helper shape as schedule/calendar).
const addDaysISO = (iso: string, n: number): string => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
import DecisionCaptureSheet, { type AttachOption } from "../decisions/DecisionCaptureSheet";
import { OUTCOME_LABEL, type DecisionRecord, type OutcomeWord } from "../decisions/types";
import { nowContext, gapFill, fmtSpan } from "./nowContext";
import { scheduleTask, breakDownTask as splitIntoSteps, undoBreakdown, splitLine, type BreakdownResult } from "../tasks/taskMoves";
import { identityToText, voiceToText, contextToText } from "../ai/context";
import { meetingPrep, type PrepPerson } from "./meetingPrep";
import { loadLastContact } from "../people/lastContact";
import { useAIContext } from "../ai/useAIContext";
import { learnedDurations, readCommittedDurationsWindowed } from "../schedule/learnedDurations";
import { supabase } from "../auth/supabaseClient";
import type { WindowClient } from "../brain/window";
import { readDraft, writeDraft, draftDay, draftIsStale, reflowDay, slippedPlanEvents, plannedTaskIds, acceptInto, seedFrom, editDraft, liveBlocks, type DayDraft } from "../dayloop/dayLoop";
import { madeBy } from "../shared/provenance";
import { RowIcon } from "../shared/anatomy";
import { effectiveLevel } from "../ai/aiGate";
import { getAIControl } from "../ai/levelStore";
import { Suspense } from "react";
import { lazyWithRecovery } from "../shell/chunkRecovery";
import { isOffTrack, rankOpen, reasonFor } from "../upnext/upnext";
import { backOnTrackMessage } from "../tasks/lifecycle";
import { moveEventToAnytime, undoMoveToAnytime, duplicateEvent } from "../schedule/eventMoves";
import { ClockGlyph, DocGlyph, ForkGlyph, SweepGlyph, TargetGlyph, CheckCircleGlyph, BarbellGlyph, GiftGlyph, FolderOpenGlyph } from "../shared/glyphs";
import { Clock, CircleSlash, BellRing } from "../shared/icons";
import { isFromEmail } from "../tasks/origin";

// Up Next and Fresh Start (ADHD strategy Phase 1) load on demand: they are
// overlays, not tabs, and stay out of the boot bundle.
const SPARK_ICO = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /></svg>
);
const CLOCK_ICO = (
  <ClockGlyph />
);
// Double chevrons: things carried forward (sweep, slip, re-flow).
const SWEEP_ICO = (
  <SweepGlyph />
);
// A fork with one path taken: the Decision Record mark (matches anatomy.tsx).
const FORK_ICO = (
  <ForkGlyph />
);
// A goal, and a win claimed. Both come from the paired glyph module so light
// gets the filled twin and the hand-drawn ratchet does not move.
const GOAL_ICO = (
  <TargetGlyph />
);
const WIN_ICO = (
  <CheckCircleGlyph />
);
const UpNextFlow = lazyWithRecovery(() => import("../upnext/UpNextFlow"));
const FreshStartFlow = lazyWithRecovery(() => import("../upnext/FreshStartFlow"));

// BRAIN-F-05 class (2026-09-07): a hard line is typed as a name ("the
// school", "gym time"), never a category's id, so the re-flow guard has to
// resolve the moved block's category to that name before heldBy ever has a
// chance to match. Pulled out as its own function (rather than left inline
// in runReflow) so this composition is provable without driving the whole
// Plan My Day accept flow: catName and heldBy are each already exhaustively
// tested, this is the one line that puts them together correctly.
export function reflowHold(lines: HardLine[], event: { data: { title: string; category: string } } | undefined): HardLine | null {
  return heldBy(lines, { action: "reflow", blockTitle: event?.data.title, category: catName(event?.data.category) });
}

// The Momentum Chain's pick (UP-CORE-09): the task offered, and the area of
// the task just finished. That area is what "Same category" is measured
// against: nextBest falls through to other areas when the finished one has
// nothing open, and the suggestion's own area proves nothing.
type Momentum = { task: TaskItem; afterCategory: string };

// Read-only aggregation over the (already tested) Schedule and Tasks services.
export default function TodayFlow({
  onGoSchedule,
  onGoTasks,
  onGoTasksAll,
  onGoTasksOverdue,
  onGoEmail,
  onStartNow,
  onSearch,
  onProfile,
  onEditRoutine,
  onRestoreSpot,
  onOpenNote,
  onOpenProject,
  onOpenPerson,
  onAskSaid,
  onGoBigger,
  reminderOpenId,
  reminderNonce,
  onReminderOpened,
  onOpenEntity,
  focusNonce,
  onFocusOpened,
}: {
  /** FOCUS IS GLOBAL, AND IT LIVES HERE (2026-09-18). Every door to it -- the
   *  capture bar's bolt, the Tasks list's own control -- fires an intent on
   *  the shell, which lands on Today and opens this. One mount, one deck,
   *  one clock. */
  focusNonce?: number;
  onFocusOpened?: () => void;
  /** The reminders rebuild (push C): a banner's Open, and the door to any linked record. */
  reminderOpenId?: string;
  reminderNonce?: number;
  onReminderOpened?: () => void;
  onOpenEntity?: (kind: string, id: string) => void;
  onGoSchedule: () => void;
  onGoTasks: () => void;
  onGoTasksAll?: () => void;
  // WAVE 4 (2026-08-29): the red overdue pill and the blue due pill both
  // landed on the same unfiltered Tasks tab, so two pills carrying two
  // different numbers were one door drawn twice. Overdue now lands on
  // overdue.
  onGoTasksOverdue?: () => void;
  // Picks 3 and 5: the home page can now send him to a goal. With an id it
  // opens that goal; without one it lands on the Bigger Picture itself.
  onGoBigger?: (goalId?: string) => void;
  onGoEmail?: (threadId?: string, draftId?: string) => void;
  /** Start Now (Dave 2026-09-17): the Start screen for a task, on the Tasks tab. */
  onStartNow?: (id: string) => void;
  onSearch?: () => void;
  onProfile?: () => void;
  onEditRoutine?: (blockId?: string) => void;
  // Where You Were (addendum item 6): navigate back to a recorded spot.
  onRestoreSpot?: (kind: "note" | "task" | "event" | "gym", id: string) => void;
  // UP-CORE-08 (2026-09-05): open a note, for the meeting page the Now card
  // makes. The shell's own navigateToNote; absent means the pill is not
  // offered rather than tapping into nothing.
  onOpenNote?: (id: string) => void;
  // UP-CORE-18 (2026-09-05): open a project, for the near-deadline card.
  // Absent means the card is not offered rather than tapping into nothing.
  onOpenProject?: (id: string) => void;
  // UP-MIND-24 (2026-09-05): the two taps the meeting line offers. Absent
  // means the chips do not render: a chip that goes nowhere is a control
  // that lies about being one.
  onOpenPerson?: (personId: string) => void;
  onAskSaid?: (personId: string) => void;
}) {
  const ai = useAI();
  const gatherContext = useAIContext();
  // UP-MIND-23 class (2026-09-07): ScheduleFlow's own Plan My Day has ridden
  // with the full brain (profile + attributed strands) since item 04's
  // attribution work; this screen's copy of the same call never picked up
  // either, so a plan built from Today reasoned from routine hours and
  // energy alone. See onAIPlan below.
  const strandsSvc = useOptionalStrands();
  const brainDocs = useBrainDocs();
  const google = useGoogle();
  const schedule = useSchedule();
  // Read to answer "does the thing this bookmark names still exist" (Law 1),
  // and, since UP-CORE-08, to make and find a meeting's own page.
  const notesSvc = useNotes();
  const tasks = useTasks();
  const profile = useProfile();
  const rulesSvc = useOptionalRules();
  const routine = useRoutine();
  const [routineData, setRoutineData] = useState<RoutineData>(DEFAULT_ROUTINE);
  const [routineSet, setRoutineSet] = useState(true);
  const [name, setName] = useState("");
  const [planCap, setPlanCap] = useState<number | undefined>(undefined);
  // S4-Q28 (2026-09-04): fetched through the window (not the local device log
  // alone) so a duration committed on one phone teaches the planner on a
  // second one too. See learnedDurations.ts's readCommittedDurationsWindowed.
  const [estimates, setEstimates] = useState<Record<string, number>>({});
  const [todayEvents, setTodayEvents] = useState<EventItem[]>([]);
  const [tomorrowEvents, setTomorrowEvents] = useState<EventItem[]>([]);
  const [allEvents, setAllEvents] = useState<EventItem[]>([]);
  const [taskItems, setTaskItems] = useState<TaskItem[]>([]);
  // NOT THE EMAILS (Dave 2026-09-17: "they must go to the email section").
  // A task born from a thread is the Ready to Send band's: it never leads
  // Your Move, never rides the momentum chain, never sits in the slid card.
  const isMailTask = (t: TaskItem): boolean => isFromEmail(t.data);
  const notMail = (t: TaskItem): boolean => !isMailTask(t);
  const [prevMood, setPrevMood] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  // Group C (item 14): the Day Loop's draft for today.
  const [dayDraft, setDayDraft] = useState<DayDraft | null>(null);
  // The draft's Anytime tail, folded by default. The old line was dead grey
  // text (Dave 2026-08-22: "this should be a button"); now it discloses the
  // actual tasks in place, same pattern as the email fold.
  const [draftMoreOpen, setDraftMoreOpen] = useState(false);
  // THERE IS NO EDIT MODE ANY MORE (blend, 2026-08-22). A proposal is a
  // proposal: it is always editable, so the mode flag and its Cancel
  // snapshot went with the card. Undo is better without them -- a block
  // moved off the day lands in Anytime with an Add beside it, which is a
  // real way back rather than a modal that discards everything at once.
  // `tuning` is just which row has its editor open.
  const [tuning, setTuning] = useState<string | null>(null);
  // Whether the Email band has anything to show. Reported BY MailNotices, so
  // the head and the content can never disagree about being empty.
  const [mailEmpty, setMailEmpty] = useState(true);
  // WAVE 4: the mail band's foot receipt already opens the inbox and names
  // what is left there. When it is showing, the head's Open Inbox is a
  // second door to the same room, so the head stands down.
  const [mailResidual, setMailResidual] = useState(false);
  const reflowGuard = useRef(0);
  // Double-tap guard for the per-block Accept, same shape as the Schedule
  // tab's. A plain object would be new on every render and guard nothing.
  const acceptingOne = useRef(false);

  // Group B (item 10): the Now line self-updates on a minute tick.
  const [, setMinuteTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setMinuteTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  // Gap Fill dismissals: once per gap, keyed by the gap's next-commitment
  // start, so a new gap is a fresh (single) offer.
  const [gapDismissed, setGapDismissed] = useState<string | null>(null);

  // Re-flow overflow (push 16): the one block that stopped fitting, offered
  // Set Aside out loud, never dropped silently.
  const [overflowOffer, setOverflowOffer] = useState<{ eventId: string; title: string } | null>(null);
  // TODAY-F-19 (2026-09-05): the slippage card can be waved off for this
  // visit. Not stored: the plan is still behind the clock, so it is back the
  // next time Today opens, same rule as the live-gym card below.
  const [reflowHidden, setReflowHidden] = useState(false);

  // Group A: Auto-Sweep receipt (item 9) and the Where You Were spot (item 6).
  const [sweepReceipt, setSweepReceipt] = useState<SweepReceipt | null>(null);
  const [spot, setSpot] = useState<WorkSpot | null>(null);
  // S5-Q31 (2026-09-04): "a workout in progress is invisible outside the
  // gym." A live session is its own store (gym/liveSession.ts), entirely
  // separate from the Where You Were spot above, so it gets its own read
  // straight off localStorage instead of riding restorableSpot's five-minute
  // gap and there-when-active gate -- this card is unconditional: on while a
  // session is live, gone the moment it finishes or goes stale.
  const [liveGym, setLiveGym] = useState<LiveSession | null>(null);
  // 2026-09-14 (Dave: "when I hit start workout ... it automatically feeds to
  // the today page ... It still isn't doing that").
  //
  // THE READ RAN ONCE, ON MOUNT. That is enough when Today unmounts on a tab
  // switch, which it does -- and NOT enough for the one path that matters
  // most, because walking through the Training Door returns <GymFlow> from
  // inside this component (see the `gymDoor.opened` branch below). Today
  // never unmounts there, so starting a workout from Today's own door and
  // coming back left this at null and the card never appeared. The session
  // was written correctly the whole time; nobody asked for it again.
  //
  // So it is a function, called on mount, whenever the gym door closes, and
  // whenever the app comes back to the foreground -- the three moments the
  // answer can have changed without this component being rebuilt.
  const readLiveGym = useCallback(() => {
    const s = readLive();
    setLiveGym(s && isStillActive(s, todayISO()) ? s : null);
  }, []);
  useEffect(() => { readLiveGym(); }, [readLiveGym]);
  useEffect(() => {
    const onWake = () => { if (document.visibilityState === "visible") readLiveGym(); };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", readLiveGym);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", readLiveGym);
    };
  }, [readLiveGym]);

  // THE FIFTEEN, WHILE IT RUNS (Dave 2026-09-16: "All buttons need to do
  // something THAT ACTUALLY helps"). Start wrote a calendar block and said so
  // once; the page then looked exactly as it had before the tap, which is
  // what "it didn't help" means. The block is a thing on screen now for as
  // long as it lasts, and it lives in localStorage rather than in this
  // component for the same reason the gym session does: phones lock, apps
  // background, and a countdown held in React state is one that resets when
  // he checks a message. Same three moments the answer can change without a
  // rebuild, so the same three reads.
  const [fifteen, setFifteen] = useState<LiveFifteen | null>(null);
  const readFif = useCallback(() => {
    const f = readFifteen();
    if (f && !isStillLive(f, todayISO())) clearFifteen();
    setFifteen(f && isStillLive(f, todayISO()) ? f : null);
  }, []);
  useEffect(() => { readFif(); }, [readFif]);
  useEffect(() => {
    const onWake = () => { if (document.visibilityState === "visible") readFif(); };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", readFif);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", readFif);
    };
  }, [readFif]);
  // A COUNTDOWN TICKS IN SECONDS, AND ONLY WHILE THERE IS ONE. The page's
  // own heartbeat is a minute, which is right for "Now" and useless for a
  // clock a person is watching run out. This interval exists only while a
  // block is live, so a page with nothing running keeps the cost it had.
  const [, setSecondTick] = useState(0);
  useEffect(() => {
    if (!fifteen) return;
    const id = setInterval(() => {
      // The question expires where liveFifteen says it does, and the block
      // takes itself off the page when it gets there rather than waiting for
      // the next time something happens to read storage.
      if (!isStillLive(fifteen, todayISO())) { clearFifteen(); setFifteen(null); return; }
      setSecondTick((n) => n + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [fifteen]);
  // PLUMB-F-17 (2026-09-05): yesterday's picks were only scored at cold
  // start, so an app that lived across midnight left the Lately record and
  // the cap offer stale until the next full relaunch. Today is the screen
  // that shows both, so mounting it settles anything due. The call is a
  // no-op after the first pass of a given day.
  useEffect(() => { settleDuePlans(); }, []);
  // LAW: every notice on Today can be dismissed. Waving it off touches only
  // this visit's UI state, never the session itself -- the workout is still
  // live either way, so it is back the next time Today opens. A permanent
  // silence would defeat the one thing this card exists for.
  const [gymDismissed, setGymDismissed] = useState(false);
  useEffect(() => {
    // LAW 1 (Dave 2026-08-29): the spot is a bookmark, and a bookmark
    // outlives the page. Offering to resume a note that was deleted hours
    // ago is the home page confidently pointing at nothing, so the offer
    // has to ask whether the thing is still there before it renders. A gym
    // spot has no record to look up; it stands on its timestamp alone.
    void (async () => {
      const s = restorableSpot();
      if (!s) { setSpot(null); return; }
      try {
        const there =
          s.kind === "note" ? !!(await notesSvc.note(s.id))
          : s.kind === "task" ? !!(await tasks.task(s.id))
          : s.kind === "event" ? !!(await schedule.event(s.id))
          : true;
        setSpot(there ? s : null);
      } catch {
        // A lookup that fails is not proof the thing is gone; keep the offer.
        setSpot(s);
      }
    })();
    void (async () => {
      try {
        const r = await runAutoSweep(tasks, todayISO());
        setSweepReceipt(r);
        if (r && r.moved.length > 0) await reload();
      } catch {
        setSweepReceipt({ date: todayISO(), moved: [], failed: true });
      }
    })();
    // B5 (2026-09-04): rollAutopayBills' only caller was Money's own reload,
    // so a user who never opens Money (not a default tab) saw last month's
    // autopay bill sit there as Overdue in Notifications and due on Today --
    // the exact lie the roll-forward exists to prevent (money/bills.ts: an
    // autopay bill is never "overdue," the app cannot know a payment
    // cleared). Today is the one screen every user reaches, so it runs here
    // too. Cheap and idempotent per due date; harmless alongside Money's own
    // call on whichever session opens it first.
    void (async () => {
      try {
        const n = await tasks.rollAutopayBills(todayISO());
        if (n > 0) await reload();
      } catch { /* next open tries again; nothing was lost by waiting */ }
    })();
    // Once, at open: the sweep is a first-open-of-the-day event by definition.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Revisit Day (Decision Record, Screen 07): appears once, on the date set,
  // above the day. At most one per day, oldest first. Days that passed
  // unanswered expire first and never render again: ignored means gone.
  const decisionsSvc = useDecisions();
  const [revisit, setRevisit] = useState<DecisionRecord | null>(null);
  const [revisitSheet, setRevisitSheet] = useState(false);
  const loadRevisit = useCallback(async () => {
    try {
      await decisionsSvc.expirePastRevisits(todayISO());
      const due = await decisionsSvc.getRevisitsDue(todayISO());
      const first = due[0] ?? null;
      setRevisit(first);
      if (first && first.data.revisitState === "pending") await decisionsSvc.update(first.id, { revisitState: "shown" });
    } catch { /* the revisit card is an enhancement; a failed read stays quiet */ }
  }, [decisionsSvc]);
  useEffect(() => { void loadRevisit(); }, [loadRevisit]);
  const cats = useCategories();
  useEffect(() => {
    let on = true;
    routine.get().then((r) => { if (on) setRoutineData(r); });
    routine.isConfigured().then((c) => { if (on) setRoutineSet(c); });
    return () => { on = false; };
  }, [routine]);
  // Native check-in nudges (Phase 2 follow-on): reschedule daily locals from
  // the current routine and brief time. No-op on web; cancel-then-schedule so
  // routine edits always win. Fire-and-forget by design.
  // Gated on the Notifications page's switches (2026-08-09): those toggles
  // used to filter only the in-app feed while the actual lock-screen
  // notifications fired unconditionally, an off switch that switched nothing.
  const [notifyPrefs, setNotifyPrefs] = useState<{ events: boolean; checkins: boolean }>({ events: true, checkins: true });
  useEffect(() => {
    let on = true;
    Promise.all([routine.get(), profile.get()]).then(([r, prof]) => {
      if (!on) return;
      const n = prof?.notify;
      const prefs = { events: n?.events ?? true, checkins: n?.checkins ?? true };
      setNotifyPrefs(prefs);
      if (prefs.checkins) void ensureCheckinNotifications(r, prof?.briefTime);
      else void cancelCheckinNotifications();
    });
    return () => { on = false; };
  }, [routine, profile]);
  const peopleSvc = usePeople();
  const [birthdays, setBirthdays] = useState<BirthdayHit[]>([]);
  // UP-CORE-03 (2026-09-05): the people themselves, so a birthday row can
  // open the same Call Prep card and Messages Drafting sheet the People tab
  // opens. One person store, read once with the birthdays.
  const [peopleList, setPeopleList] = useState<Person[]>([]);
  const [msgPerson, setMsgPerson] = useState<{ id: string; about: string } | null>(null);
  // UP-MIND-01 class (2026-09-07): the mail-notice card drafts above
  // (cardVoiceRef) already read the How You Write doc; this second, older
  // MessageDraftSheet door - opened from the birthday row - never gathered
  // it, so a text drafted from a birthday sounded like nobody.
  const [msgVoice, setMsgVoice] = useState("");
  useEffect(() => {
    const person = msgPerson ? peopleList.find((p) => p.id === msgPerson.id) : undefined;
    if (!person) { setMsgVoice(""); return; }
    let live = true;
    void gatherContext({ personId: person.id, personName: person.data.name })
      .then((c) => voiceToText(c, { styleRule: false }))
      .catch(() => "")
      .then((v) => { if (live) setMsgVoice(v); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgPerson?.id]);
  const [callPerson, setCallPerson] = useState<string | null>(null);
  const [peopleTick, setPeopleTick] = useState(0);
  // A dismissal lives in storage, so a bump is what tells the render to go
  // read it again (the same pattern the sweep and goal cards use).
  const [birthdayDismissTick, setBirthdayDismissTick] = useState(0);
  // UP-CORE-08 (2026-09-05): which of today's events already have a note, in
  // ONE read (eventsWithNotes scans the note list once), plus the door that
  // makes one titled and linked the first time and opens it every time
  // after. Same function the Schedule tab's row glyph calls.
  const [notedEvents, setNotedEvents] = useState<ReadonlySet<string>>(new Set());
  const [noteTick, setNoteTick] = useState(0);
  // UP-CORE-14 (2026-09-05): what he has told the automations. Read once
  // with the rules list; every producer below asks before it speaks, and
  // every answer is a row in What JARVIS Learned that deleting reverts.
  const [tunings, setTunings] = useState<Record<string, TuningChoice>>({});
  const [tuneTick, setTuneTick] = useState(0);
  useEffect(() => {
    let on = true;
    if (!rulesSvc) return;
    rulesSvc.list().then((rs) => { if (on) setTunings(tuningsFrom(rs)); }).catch(() => {});
    return () => { on = false; };
  }, [rulesSvc, tuneTick]);
  // The write: one rule, with the card's own words as its evidence, and a
  // toast that says what just happened and where to undo it.
  const tune = async (name: string, choice: TuningChoice, evidence: string) => {
    if (!rulesSvc) return;
    const ok = await attemptWrite(async () => {
      const existing = (await rulesSvc.list()).find((r) => r.data.scope === tuningScope(name) && r.data.from === "frequency");
      // A second choice REPLACES the first: two rules about one producer
      // would be two answers to one question.
      if (existing) await rulesSvc.delete(existing.id);
      await rulesSvc.create("tuning", tuningScope(name), "frequency", choice, evidence);
    });
    if (!ok) return;
    setTuneTick((n) => n + 1);
    const label = AUTOMATION_LABEL[name] ?? name;
    showToast({
      message: choice === "never" ? `${label} · Off · Change it in Settings`
        : choice === "less" ? `${label} · Less often · Change it in Settings`
        : `${label} · More often · Change it in Settings`,
    });
  };
  // Two questions every producer asks: may I speak today, and how loud.
  const tuned = (name: string) => tuningAllows(tunings, name, today);
  const tuneProps = (name: string, evidence: string) => ({
    automation: name,
    onTune: (choice: TuningChoice) => void tune(name, choice, evidence),
  });
  useEffect(() => {
    let on = true;
    notesSvc.eventsWithNotes(todayEvents.map((e) => e.id)).then((set) => { if (on) setNotedEvents(set); }).catch(() => {});
    return () => { on = false; };
  }, [notesSvc, todayEvents, noteTick]);
  // UP-CORE-09 (2026-09-05): the Momentum Chain's slot, on the tab where
  // ticks actually happen. Holds the task offered after the last completion;
  // the next tick replaces it and Not Now empties it for the day.
  const [momentum, setMomentum] = useState<Momentum | null>(null);
  const [categories, setCategories] = useState<SheetCategory[]>([]);
  const [pausedCats, setPausedCats] = useState<ReadonlySet<string>>(new Set());
  const [catsFull, setCatsFull] = useState<Category[]>([]);
  const projectsSvc = useProjects();
  const goalsSvc = useGoals();
  const [projList, setProjList] = useState<Project[]>([]);
  // Bumps after a goal nudge is waved off so the derivation re-reads storage.
  const [goalNudgeTick, setGoalNudgeTick] = useState(0);
  // Same pattern for the two sweep cards: their dismissals live in storage,
  // so a bump is what tells the render to go read it again.
  const [sweepDismissTick, setSweepDismissTick] = useState(0);
  const [goalList, setGoalList] = useState<Goal[]>([]);
  useEffect(() => {
    let on = true;
    Promise.all([projectsSvc.list(), goalsSvc.list()]).then(([p, g]) => { if (on) { setProjList(p); setGoalList(g); } });
    return () => { on = false; };
  }, [projectsSvc, goalsSvc]);
  const [sheet, setSheet] = useState<{ mode: "edit"; id: string; initial: TaskDraft } | null>(null);
  const [eventSheet, setEventSheet] = useState<{ id: string; occurrence: string; initial: EventDraft } | null>(null);
  // THE SAME TAP AS AN EVENT (2026-08-28, Dave: "when I click on something in
  // the schedule it should allow me to edit it like a normal scheduled
  // event"). Same shape as eventSheet above, for a protected block.
  const [blockSheet, setBlockSheet] = useState<{ id: string; initial: BlockDraft } | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [upNextOpen, setUpNextOpen] = useState(false);
  const focusSeen = useRef(0);
  useEffect(() => {
    if (!focusNonce || focusNonce === focusSeen.current) return;
    focusSeen.current = focusNonce;
    setUpNextOpen(true);
    onFocusOpened?.();
  }, [focusNonce, onFocusOpened]);
  const [remAdjust, setRemAdjust] = useState<{ id: string; text: string } | null>(null);
  const [wrapUp, setWrapUp] = useState<string | null>(null);
  // THE MONTHLY REPORT (2026-08-25). Arrives as one row in the notice
  // stream, unannounced, when the previous month is sealed and this device
  // has not read it. No countdown, no teaser: anticipating a landmark
  // measurably reduces effort in the run-up (the catalog's own research).
  const [reportOpen, setReportOpen] = useState(false);
  const [reportMonth, setReportMonth] = useState<string | null>(null);
  const sealSvc = useOptionalSeal();
  useEffect(() => {
    let on = true;
    if (!sealSvc) return;
    sealSvc.list().then((seals) => {
      if (!on) return;
      const latest = seals[seals.length - 1];
      if (latest && reportSeen() !== latest.data.month) setReportMonth(latest.data.month);
    }).catch(() => {});
    return () => { on = false; };
  }, [sealSvc, reportOpen]);
  const [freshOpen, setFreshOpen] = useState(false);
  const [freshSkipped, setFreshSkipped] = useState(() => {
    try { return localStorage.getItem("jarvis.fresh.skip") === todayISO(); } catch { return false; }
  });

  const now = new Date();
  const today = todayISO(now);
  const tmrw = tomorrowISO(today);

  // Today's birthdays (derived from People; empty is the normal state).
  useEffect(() => {
    let on = true;
    peopleSvc.list().then((ps) => { if (on) { setBirthdays(birthdaysOn(ps, today)); setPeopleList(ps); } }).catch(() => {});
    return () => { on = false; };
  }, [peopleSvc, today, peopleTick]);
  // A logged call attempt changes what the Call Prep card says about "last
  // talked", so the read that fed it runs again.
  const reloadPeople = async () => { setPeopleTick((n) => n + 1); };

  const openEventNote = async (e: EventItem) => {
    const existing = await notesSvc.notesLinkedTo(e.id);
    if (existing[0]) { onOpenNote?.(existing[0].id); return; }
    let noteId: string | null = null;
    const ok = await attemptWrite(async () => {
      noteId = await notesSvc.createForEvent({ id: e.id, title: e.data.title, date: today, category: e.data.category });
    });
    setNoteTick((n) => n + 1);
    if (ok && noteId) onOpenNote?.(noteId);
  };

  // TODAY-F-14 (2026-09-05): a rejection anywhere in here used to be dropped
  // (the effect below never caught it) and setLoading(false) was the last
  // line, so a first launch with no signal, or any throw in the heal or the
  // reads, left the skeleton up for good with no card and no retry; the tab's
  // error boundary never fires because nothing threw during render. The page
  // now renders with whatever state exists (empty is legal) and the toast
  // carries the retry.
  const reload = useCallback(async () => {
    try {
      // Self-healing dedupe (hotfix 2026-08-21): one plan event per task per
      // day, first-upcoming wins. Acts only on duplicates this read can see,
      // so a cold read heals nothing rather than deleting on absence.
      const dNow = new Date();
      await schedule.healPlanDuplicates(today, dNow.getHours() * 60 + dNow.getMinutes());
      await schedule.healPlanDuplicates(tmrw, null);
      const [te, tm, tk, prof, all, capRule, durations] = await Promise.all([
        schedule.eventsOn(today),
        schedule.eventsOn(tmrw),
        tasks.listTasks(),
        profile.get(),
        schedule.listEvents(),
        // S4-Q26 (2026-09-04): read through the rules list, not the
        // profile field, so deleting the row in What JARVIS Learned
        // genuinely un-caps the day.
        rulesSvc ? rulesSvc.resolve("plan.cap", "day") : Promise.resolve(null),
        readCommittedDurationsWindowed(supabase as unknown as WindowClient | null, Date.now()),
      ]);
      // create() pre-announces, so this is a no-op in the normal case; see
      // that method's comment for why a second, generic announcement here
      // would say less than the toast already shown at creation.
      if (capRule && rulesSvc) await rulesSvc.announceIfFirstUse(capRule);
      setTodayEvents(te);
      setTomorrowEvents(tm);
      setTaskItems(tk);
      setAllEvents(all);
      setName(prof?.name ?? "");
      setPlanCap(capRule ? Number(capRule.data.to) || undefined : undefined);
      setEstimates(learnedDurations(durations, Date.now()));
      // Yesterday's evening mood sizes today's plan (Phase 2). Noon anchor keeps
      // the date subtraction clear of any midnight or DST edge.
      const y = new Date(today + "T12:00:00");
      y.setDate(y.getDate() - 1);
      setPrevMood(prof?.checkin?.[todayISO(y)]?.mood);
    } catch {
      showToast({ message: "Couldn't load today · Check your connection", actionLabel: "Retry", onAction: () => { void reload(); } });
    } finally {
      setLoading(false);
    }
  }, [schedule, tasks, profile, rulesSvc, today, tmrw]);

  useEffect(() => { reload(); }, [reload]);
  // THE REPAINT TODAY NEVER GOT (Dave 2026-08-30: "things aren't clearing").
  // useFreshLists shipped 2026-08-24 with the comment "no surface ever
  // subscribed"; Tasks and Schedule were wired that day and the HOME PAGE was
  // not. So when the background refresh detected that what he was looking at
  // was stale, every surface repainted except the one he opens first. Today
  // draws both tasks and events, so it listens for both.
  useFreshLists([ENTITY_TASK, ENTITY_EVENT], reload);

  // WHAT THE TICK MOVED (dopamine layer, 2026-08-20). The strongest finding
  // in the motivation literature is Amabile's: nothing drives people like
  // seeing progress in work that matters to them, and small wins move it a
  // lot. So a tick no longer says "Task completed" into the void; when the
  // task belonged to a project it says which project it just advanced and
  // how close that project now is. When it was the LAST one, the toast stops
  // being a receipt and becomes the offer to finish the thing.
  // Counts the tick that JUST happened. React state is still the pre-toggle
  // snapshot inside this handler, so counting only `done` reports the project
  // one task behind: ticking the last one said "One left". Counting the id
  // explicitly is correct whether the list is stale or fresh.
  const movedByTask = (t: { projectId?: string } | null, justDoneId: string): { moved: Moved; projectId: string } | null => {
    const pid = t?.projectId;
    if (!pid) return null;
    const proj = projList.find((p) => p.id === pid);
    if (!proj || proj.data.status === "done") return null;
    const mine = taskItems.filter((x) => x.data.projectId === pid);
    const done = mine.filter((x) => x.data.done || x.id === justDoneId).length;
    const moved = movedBy(proj.data.title, done, mine.length);
    return moved ? { moved, projectId: pid } : null;
  };

  const onToggleTask = async (id: string) => {
    const before = await tasks.task(id);
    const comeback = before ? backOnTrackMessage(before, today) : null;
    const ok = await attemptWrite(() => tasks.toggleDone(id));
    await reload();
    if (!ok) return;
    if (before && !before.done) setPromptCtx({ completedTaskId: id });
    // UP-CORE-09 (2026-09-05): THE CHAIN, ON TODAY. momentum.ts and its two
    // helpers have existed since item 7 and were wired to the Tasks tab
    // alone, so the dopamine of a tick on the page where ticks actually
    // happen bought a toast and nothing else, and the next small thing was
    // four taps away. Same producer, same quieting, same "two Not Nows and
    // it is done for the day" (chainQuietToday).
    if (before && !before.done && !chainQuietToday(today)) {
      // The season pause candidatesFor applies, at the other door a task
      // becomes work. nextBest already refuses bills and reminders.
      const fresh = (await tasks.listTasks()).filter((t) => !pausedCats.has(t.data.category ?? ""));
      const next = nextBest(fresh.filter(notMail), id, before.category ?? "");
      setMomentum(next ? { task: next, afterCategory: before.category ?? "" } : null);
    }
    const advanced = before && !before.done ? movedByTask(before, id) : null;
    if (comeback) {
      showToast({ message: comeback });
    } else if (advanced?.moved.cleared) {
      // The moment, offered at the moment. Delayed rewards are the ones ADHD
      // discounts hardest, so finishing the project is one tap from here
      // rather than four taps through a form later.
      showToast({
        message: advanced.moved.projectTitle + " · " + advanced.moved.line,
        actionLabel: "Finish It",
        onAction: async () => {
          const proj = projList.find((p) => p.id === advanced.projectId);
          if (!proj) return;
          await attemptWrite(() => projectsSvc.update(proj.id, { ...proj.data, status: "done" }));
          await reload();
          showToast({ message: celebrationLine("project", proj.id) + " · " + proj.data.title });
        },
      });
    } else if (advanced) {
      showToast({ message: advanced.moved.projectTitle + " · " + advanced.moved.line });
    } else if (before && !before.done) {
      // SHARED-F-03 (2026-09-05): Undo used to be a second toggleDone, which
      // flips whatever the row is NOW. Tick a task, un-tick it by hand, then
      // tap the Undo still on screen and it went back to done: Undo re-did.
      // It restores the state read before the tick instead, so it lands on
      // the same answer however many times it is tapped.
      showToast({ message: celebrationLine("task", id), actionLabel: "Undo", onAction: async () => { await attemptWrite(() => tasks.restoreCompletion(id, before)); await reload(); } });
    }
  };

  useEffect(() => {
    let on = true;
    cats.list().then((list) => { if (on) { setCategories(list.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color }))); setPausedCats(pausedCategoryIds(list)); setCatsFull(list); } });
    return () => { on = false; };
  }, [cats]);

  const onOpenTask = async (id: string) => {
    const t = await tasks.task(id);
    // B1-4 (2026-09-04): this sheet used to load and save a strict subset of
    // the same TaskSheet the Tasks tab opens, so a project, an extra area or
    // an if-then plan set from Tasks would silently vanish the moment the
    // task was edited from home instead. Same sheet, same fields, both ends.
    if (t) setSheet({ mode: "edit", id, initial: { text: t.text, category: t.category ?? "", extraCategories: t.extraCategories, due: t.due ?? "", repeat: t.recurrence ?? "", projectId: t.projectId ?? "", goalId: t.goalId ?? "", eventId: t.eventId ?? "", plan: t.plan, steps: t.steps, notes: t.notes, estimateMin: t.estimateMin, personId: t.personId } });
  };

  // Tappable schedule rows (roadmap v2): an event on Today opens the same
  // editor the Schedule uses, including Apply To for a repeating event
  // (B1-5, 2026-09-04: this sheet is the same EventSheet ScheduleFlow opens,
  // so it offers the same until/taskIds/Training Door controls; it has to
  // load and save the same fields or those controls lie).
  //
  // SCHED-F-03 here too (2026-09-11): the sheet names the OCCURRENCE, not the
  // series' first date. Today seeded e.date, so a weekly event that began in
  // August opened dated August, and "This Event" dropped its split there
  // while today's occurrence stayed put. Same resolution ScheduleFlow.openEdit
  // uses; from Today the next occurrence from today is today's.
  const openEventSheet = async (id: string) => {
    const e = await schedule.event(id);
    if (!e) return;
    const occurrence = (e.recurrence ?? "none") !== "none" ? nextOccurrence(e, todayISO()) ?? e.date : e.date;
    // TODAY-F-19 (Dave 2026-09-19: "Meeting Link and Meeting Notes don't
    // save"). This literal was a partial copy of ScheduleFlow.openEdit's,
    // and the comment above is the rule it broke: the sheet "has to load and
    // save the same fields or those controls lie". A stored Zoom link opened
    // as an empty field here, so his own link looked lost, and the meeting
    // section of the sheet was unusable from the tab today's events live on.
    // Travel, the weekday set and the guest list were missing for the same
    // reason and told the same lie. One literal now, matching openEdit's.
    setEventSheet({ id, occurrence, initial: { title: e.title, date: occurrence, start: e.start, end: e.end ?? "", category: e.category ?? "", location: e.location ?? "", recurrence: e.recurrence ?? "none", until: e.until ?? "", taskIds: e.taskIds ?? [], gym: !!e.gym, travelMin: e.travelMin ?? null, bufferMin: e.bufferMin ?? null, url: e.url ?? "", notes: e.notes ?? "", attendees: e.attendees ?? [], days: e.days ?? [], interval: e.interval ?? 1, projectId: e.projectId ?? "", goalId: e.goalId ?? "" } });
  };
  // EVENTS ARE FIRST-CLASS (Dave, on the list since 2026-09-07; built
  // 2026-09-09). Tapping an event opens its PAGE, here as well as on Schedule.
  // Today has no route to another tab, so it mounts the same page itself
  // rather than sending him somewhere: one door, one destination, wherever the
  // event was tapped. Edit on the page opens the sheet this used to open.
  const [eventDetail, setEventDetail] = useState<string | null>(null);
  // REMINDERS HOME (the reminders rebuild push B, 2026-09-15): a screen
  // pushed from the strip's See All, the way the event page is; not a route.
  const [remHome, setRemHome] = useState(false);
  const [remOpenId, setRemOpenId] = useState<string | null>(null);
  // BUG (Dave 2026-09-16, "I can't click on them on the Today page to edit
  // them"): RemindersFlow (pageless) was mounted on `remOpenId && (...)`, the
  // SAME value its own openId effect clears once it has opened the detail
  // sheet. Both state writes (RemindersFlow's local setDetailId AND this
  // component's onOpened -> setRemOpenId(null)) land in one batched commit,
  // so the sheet was set open and the whole tree it lives in unmounted in
  // the same render -- it never painted. Mounting now tracks its OWN flag
  // that a "consumed" openId is free to clear without taking the sheet with
  // it, the same way every other one-shot in this app (personOpenId,
  // factOpenId, ...) mounts its destination on a condition that outlives it.
  const [remFlowMounted, setRemFlowMounted] = useState(false);
  // Push D: the task just completed, for the reminders that asked to be
  // shown after it. One at a time; the next completion replaces it.
  const [promptCtx, setPromptCtx] = useState<{ completedTaskId?: string }>({});
  const [eventDetailNotes, setEventDetailNotes] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    if (!eventDetail) { setEventDetailNotes([]); return; }
    let on = true;
    notesSvc.notesLinkedTo(eventDetail)
      .then((rows) => { if (on) setEventDetailNotes(rows.map((n) => ({ id: n.id, title: n.title }))); })
      .catch(() => { if (on) setEventDetailNotes([]); });
    return () => { on = false; };
  }, [eventDetail, notesSvc]);
  const onOpenEvent = (id: string) => { setEventDetail(id); };
  // A task added from an event's page is FILED to it, born in its area, and
  // due on the day it has to be ready for. Same three facts ScheduleFlow's
  // copy writes; both go through TasksService.createTask's eventId.
  const addEventStep = async (eventId: string, ev: EventItem, text: string) => {
    const ok = await attemptWrite(() => tasks.createTask(text, { eventId, category: ev.data.category, due: ev.data.date }));
    await reload();
    if (ok) showToast({ message: "Added to " + ev.data.title });
  };

  // THE SAME ROW, THE SAME MOVES (2026-08-28). Schedule's day list could
  // shift an event -15m/+15m/+1h, retime it from a tap, resize it from a
  // tap, skip just today, or push it to tomorrow, all from the row, no
  // editor visit. Today's had none of that: an event here could only be
  // tapped open into the full sheet. Same fix as the two above - the reads
  // and writes live once in schedule/eventAdjust.ts, and this wiring only
  // owns the toast wording and the undo button, which legitimately differ
  // per surface (ScheduleFlow's says "· Just today" for a split-off repeat;
  // this one does too, for the identical reason).
  const onShift = async (id: string, mins: number) => {
    const e = await schedule.event(id);
    if (!e) return;
    // SCHED-F-18 (2026-09-05): refuse rather than clamp, the same answer the
    // event sheet's move chips give. addMinutes stops at 23:59, so +1 hr on a
    // 23:15-23:45 event collapsed it to a zero-length row.
    if (!shiftFitsDay(e.start, e.end, mins)) { showToast({ message: "That would run past midnight" }); return; }
    const word = mins < 0
      ? `Back ${Math.abs(mins) === 60 ? "1 hr" : Math.abs(mins) + " min"}`
      : `Forward ${mins === 60 ? "1 hr" : mins + " min"}`;
    let outcome: MoveOutcome | null = null;
    const ok = await attemptWrite(async () => { outcome = await moveEventAdjust(id, addMinutes(e.start, mins), today, schedule); });
    await reload();
    const o = outcome as MoveOutcome | null;
    if (!ok || !o?.ok) return;
    showToast({
      message: o.repeating ? word + " · Just today" : word,
      actionLabel: "Undo",
      onAction: async () => { await attemptWrite(() => undoMoveEventAdjust(id, today, o, schedule)); await reload(); },
    });
  };

  const onMoveTo = async (id: string, start: string) => {
    const t = fmtTime(start);
    const label = `Moved to ${t.time} ${t.ap}`;
    let outcome: MoveOutcome | null = null;
    const ok = await attemptWrite(async () => { outcome = await moveEventAdjust(id, start, today, schedule); });
    await reload();
    const o = outcome as MoveOutcome | null;
    if (!ok || !o?.ok) return;
    showToast({
      message: o.repeating ? label + " · Just today" : label,
      actionLabel: "Undo",
      onAction: async () => { await attemptWrite(() => undoMoveEventAdjust(id, today, o, schedule)); await reload(); },
    });
  };

  const onSetEnd = async (id: string, end: string) => {
    let r: ResizeOutcome | null = null;
    const ok = await attemptWrite(async () => { r = await resizeEventAdjust(id, end, schedule); });
    await reload();
    const res = r as ResizeOutcome | null;
    if (!ok || !res?.ok) return;
    const before = res.before;
    showToast({
      message: durLabel(res.minutes ?? 0),
      actionLabel: "Undo",
      onAction: async () => { await attemptWrite(() => undoResizeEventAdjust(id, before, schedule)); await reload(); },
    });
  };

  const onSkipToday = async (id: string) => {
    const ok = await attemptWrite(() => skipEventTodayAdjust(id, today, schedule));
    await reload();
    if (!ok) return;
    showToast({
      message: "Skipped today",
      actionLabel: "Undo",
      onAction: async () => { await attemptWrite(() => undoSkipEventTodayAdjust(id, today, schedule)); await reload(); },
    });
  };

  // SCHED-F-05 (2026-09-05): a repeating event pushes JUST TODAY'S
  // occurrence, the same split the other quiet moves make; the series keeps
  // its weekday. Today is always looking at today, so today is the
  // occurrence being pushed.
  const onPushTomorrow = async (id: string) => {
    let outcome: PushOutcome | null = null;
    const ok = await attemptWrite(async () => { outcome = await pushEventTomorrowAdjust(id, today, schedule); });
    await reload();
    const o = outcome as PushOutcome | null;
    if (!ok || !o?.ok) return;
    showToast({
      message: o.repeating ? "Moved to tomorrow · Just today" : "Moved to tomorrow",
      actionLabel: "Undo",
      onAction: async () => { await attemptWrite(() => undoPushEventTomorrowAdjust(id, o, schedule)); await reload(); },
    });
  };

  // THE SAME MOVES, FOR A PROTECTED BLOCK (2026-08-28, Dave: "It should
  // allow me to edit ALL schedule items THE FUCKING SAME"). Identical to
  // ScheduleFlow's copy: the routine is one record, so the write is always
  // "save the record back with this one block patched" and the undo is
  // always "save the record from before the patch."
  const onShiftBlock = async (id: string, mins: number) => {
    const before = routineData;
    // SCHED-F-18: the same refusal a late event gets, for a protected block.
    const cur = (before.protectedBlocks ?? []).find((b) => b.id === id);
    if (cur && !blockShiftFits(cur.startMin, cur.endMin, mins)) { showToast({ message: "That would run past midnight" }); return; }
    const after = shiftBlockAdjust(before, id, mins);
    if (!after) return;
    const ok = await attemptWrite(() => routine.save(after));
    if (!ok) return;
    setRoutineData(after);
    const word = mins < 0
      ? `Back ${Math.abs(mins) === 60 ? "1 hr" : Math.abs(mins) + " min"}`
      : `Forward ${mins === 60 ? "1 hr" : mins + " min"}`;
    showToast({
      message: word,
      actionLabel: "Undo",
      onAction: async () => { if (await attemptWrite(() => routine.save(before))) setRoutineData(before); },
    });
  };

  const onRetimeBlock = async (id: string, startMin: number) => {
    const before = routineData;
    const after = retimeBlockAdjust(before, id, startMin);
    if (!after) return;
    const ok = await attemptWrite(() => routine.save(after));
    if (!ok) return;
    setRoutineData(after);
    const t = fmtTime(minToHHMM(startMin));
    showToast({
      message: `Moved to ${t.time} ${t.ap}`,
      actionLabel: "Undo",
      onAction: async () => { if (await attemptWrite(() => routine.save(before))) setRoutineData(before); },
    });
  };

  const onResizeBlock = async (id: string, endMin: number) => {
    const before = routineData;
    const beforeBlock = (before.protectedBlocks ?? []).find((b) => b.id === id);
    const after = resizeBlockAdjust(before, id, endMin);
    if (!after || !beforeBlock) return;
    const ok = await attemptWrite(() => routine.save(after));
    if (!ok) return;
    setRoutineData(after);
    showToast({
      message: durLabel(endMin - beforeBlock.startMin),
      actionLabel: "Undo",
      onAction: async () => { if (await attemptWrite(() => routine.save(before))) setRoutineData(before); },
    });
  };

  // THE QUICK SHEET ITSELF (2026-08-28), identical to ScheduleFlow's copy:
  // opens on a tap instead of leaving for Your Routine, and Save patches only
  // name/time/days.
  const onOpenBlock = (id: string) => {
    const b = (routineData.protectedBlocks ?? []).find((x) => x.id === id);
    if (!b) return;
    setBlockSheet({ id, initial: { label: b.label, startMin: b.startMin, endMin: b.endMin, days: [...b.days] } });
  };
  const onSaveBlock = async (draft: BlockDraft) => {
    if (!blockSheet) return;
    const before = routineData;
    const after = editBlockBasics(before, blockSheet.id, draft);
    setBlockSheet(null);
    if (!after) return;
    const ok = await attemptWrite(() => routine.save(after));
    if (ok) setRoutineData(after);
  };
  const onDeleteBlock = async () => {
    if (!blockSheet) return;
    const before = routineData;
    const removed = (before.protectedBlocks ?? []).find((b) => b.id === blockSheet.id);
    const after = removeBlockAdjust(before, blockSheet.id);
    setBlockSheet(null);
    if (!after) return;
    const ok = await attemptWrite(() => routine.save(after));
    if (!ok) return;
    setRoutineData(after);
    showToast({
      message: (removed?.label ?? "Block") + " deleted",
      actionLabel: "Undo",
      onAction: async () => { if (await attemptWrite(() => routine.save(before))) setRoutineData(before); },
    });
  };
  const onEditBlockFull = () => {
    if (!blockSheet) return;
    const id = blockSheet.id;
    setBlockSheet(null);
    onEditRoutine?.(id);
  };

  const onSaveEvent = async (draft: EventDraft, scope?: "this" | "series") => {
    if (!eventSheet) return;
    const id = eventSheet.id;
    const recurring = (eventSheet.initial.recurrence ?? "none") !== "none";
    if (recurring && scope === "this") {
      // Same split ScheduleFlow.onSave uses: exdate the series on the
      // occurrence the sheet opened on (not the draft's date, which he may
      // have changed), stand the edited occurrence up as its own event.
      const occurrence = eventSheet.occurrence;
      await attemptWrite(async () => {
        await schedule.addExdate(id, occurrence);
        // The split copy carries the meeting and the travel too: "This
        // Event" on a recurring Zoom used to stand the occurrence up without
        // its link, which is the same disappearance by another route.
        const splitId = await schedule.createEvent(draft.title, { date: draft.date, start: draft.start, end: draft.end || undefined, category: draft.category || undefined, location: draft.location || undefined, travelMin: draft.travelMin ?? undefined, bufferMin: draft.bufferMin ?? undefined, url: draft.url, notes: draft.notes, projectId: draft.projectId || undefined, goalId: draft.goalId || undefined });
        if (splitId && draft.gym) await schedule.editGymDoor(splitId, true);
      });
    } else {
      const occurrence = eventSheet.occurrence;
      await attemptWrite(async () => {
        await schedule.editTitle(id, draft.title);
        if (!recurring) await schedule.moveDay(id, draft.date);
        // SCHED-F-11, as ScheduleFlow.onSave: All Events plus a new date
        // slides the whole series by the days the occurrence moved.
        else if (draft.date !== occurrence) {
          const cur = await schedule.event(id);
          if (cur) await schedule.moveDay(id, addDays(cur.date, daysBetween(occurrence, draft.date)));
        }
        await schedule.editTime(id, draft.start);
        await schedule.editEnd(id, draft.end);
        await schedule.editRecurrence(id, draft.recurrence);
        // After editRecurrence, which clears the weekday set for anything
        // that is not weekly. Same order ScheduleFlow.onSave uses.
        if (draft.recurrence === "weekly") await schedule.editWeekdays(id, draft.days ?? [], draft.interval ?? 1);
        await schedule.editUntil(id, draft.until || null);
        await schedule.editCategory(id, draft.category);
        await schedule.editLocation(id, draft.location);
        await schedule.editTravel(id, draft.travelMin ?? null, draft.bufferMin ?? null);
        await schedule.editMeeting(id, { url: draft.url ?? "", notes: draft.notes ?? "" });
        await schedule.editTaskIds(id, draft.taskIds ?? []);
        await schedule.editGymDoor(id, !!draft.gym);
        await schedule.editLinks(id, { projectId: draft.projectId || null, goalId: draft.goalId || null });
      });
    }
    setEventSheet(null);
    await reload();
  };

  // TODAY-F-11 (2026-09-05): Undo restores the WHOLE event, under its own id.
  // This call site copied seven fields by hand, so a deleted repeating event
  // came back with no end date, no attached tasks, no Training Door, no
  // provenance and no skipped days, wearing a new id that orphaned any plan
  // draft pointing at it. B1-3 gave tasks one recreateFrom for exactly this
  // reason; SCHED-F-09 gave events theirs, and this is the second caller.
  //
  // 2026-09-11: and "This Event" deletes THIS EVENT. EventSheet passes the
  // Apply To choice for a repeating event, and this handler used to take no
  // argument, so This Event deleted the whole series. Same as
  // ScheduleFlow.onDelete: skip the one occurrence, keep the series.
  const onDeleteEvent = async (scope?: "this" | "series") => {
    if (!eventSheet) return;
    const id = eventSheet.id;
    if ((eventSheet.initial.recurrence ?? "none") !== "none" && scope === "this") {
      const occurrence = eventSheet.occurrence;
      await attemptWrite(() => schedule.addExdate(id, occurrence));
      setEventSheet(null);
      await reload();
      return;
    }
    const e = await schedule.event(id);
    const ok = await attemptWrite(() => schedule.deleteEvent(id));
    setEventSheet(null);
    await reload();
    if (ok && e) {
      showToast({
        message: "Event deleted",
        actionLabel: "Undo",
        onAction: async () => {
          await attemptWrite(() => schedule.recreateFrom(e, id));
          await reload();
        },
      });
    }
  };

  // THE SWIPE'S DELETE (Dave 2026-09-20). onDeleteEvent above answers the
  // SHEET, so it reads eventSheet for the id and the Apply To scope. The rail
  // has neither: it is acting on a row, and a repeating row's rail deletes the
  // occurrence, never the series, because a gesture must not be able to remove
  // something the finger cannot see. Same snapshot-then-write-then-Undo shape
  // as the sheet's, so the two doors restore the same thing.
  const onDeleteEventRow = async (id: string) => {
    const e = await schedule.event(id);
    if (!e) return;
    if ((e.recurrence ?? "none") !== "none") {
      const ok = await attemptWrite(() => schedule.addExdate(id, today));
      await reload();
      // UNDO, WHICH THIS SHIPPED WITHOUT (toast sweep, same day). A skip is a
      // write: it puts the date in the event's exdates and the occurrence
      // leaves the calendar. Fifty-two of the app's sixty destructive toasts
      // offer a way back and this one did not, so the only route out of a
      // mis-swipe was opening the series and editing it by hand.
      // removeExdate is the exact inverse and was already on the service.
      if (ok) showToast({
        message: "Skipped today · The series stays",
        actionLabel: "Undo",
        onAction: async () => { await attemptWrite(() => schedule.removeExdate(id, today)); await reload(); },
      });
      return;
    }
    const ok = await attemptWrite(() => schedule.deleteEvent(id));
    await reload();
    if (!ok) return;
    showToast({
      message: "Event deleted",
      actionLabel: "Undo",
      onAction: async () => { await attemptWrite(() => schedule.recreateFrom(e, id)); await reload(); },
    });
  };
  // The block's twin. A protected block lives inside the routine record, so
  // "delete" is a save of the routine without it and Undo is a save of the
  // routine as it was: blockAdjust.removeBlock returns null when the id is not
  // there, which is the only refusal this can meet.
  const onDeleteBlockRow = async (id: string) => {
    const before = routineData;
    const removed = (before.protectedBlocks ?? []).find((b) => b.id === id);
    const after = removeBlockAdjust(before, id);
    if (!after) return;
    if (!(await attemptWrite(() => routine.save(after)))) return;
    setRoutineData(after);
    showToast({
      message: (removed?.label ?? "Block") + " deleted",
      actionLabel: "Undo",
      onAction: async () => { if (await attemptWrite(() => routine.save(before))) setRoutineData(before); },
    });
  };

  // THE SAME SHEET, THE SAME MOVES (2026-08-24). Editing a task from Today
  // offered neither Add to Schedule nor Break It Down, because TaskSheet
  // renders each only when its callback is passed and this flow passed
  // neither. Both moves live in tasks/taskMoves.ts precisely so this surface
  // can make them without a second copy of what they mean.
  const onScheduleFromToday = async () => {
    if (!sheet) return;
    const id = sheet.id;
    let landed = false;
    const ok = await attemptWrite(async () => { landed = (await scheduleTask(id, today, tasks, schedule)).ok; });
    setSheet(null);
    await reload();
    if (ok) showToast({ message: landed ? "Added to schedule" : "Couldn't find that task" });
  };


  // THE SAME SHEET, THE SAME MOVES (2026-08-24). Editing an event from Today
  // offered neither Move to Anytime nor Duplicate, because EventSheet renders
  // each only when its callback is passed and only ScheduleFlow passed them.
  // Both live in schedule/eventMoves.ts so this surface can make them without
  // a second copy of what they mean.
  const onEventToAnytime = async () => {
    if (!eventSheet) return;
    const id = eventSheet.id;
    type MoveRes = Awaited<ReturnType<typeof moveEventToAnytime>>;
    let res: MoveRes | null = null;
    const ok = await attemptWrite(async () => { res = await moveEventToAnytime(id, schedule, tasks); });
    setEventSheet(null);
    await reload();
    const r = res as MoveRes | null;
    if (!ok || !r?.ok || !r.event) return;
    const kept = r.event;
    const keptId = r.eventId;
    const madeTaskId = r.madeTaskId;
    showToast({
      message: "Moved to Anytime",
      actionLabel: "Undo",
      onAction: async () => {
        // TODAY-F-11: back under its own id, so nothing pointing at the block
        // is orphaned by the way back.
        await attemptWrite(() => undoMoveToAnytime(kept, madeTaskId, schedule, tasks, keptId));
        await reload();
      },
    });
  };

  const onEventDuplicate = async () => {
    if (!eventSheet) return;
    const id = eventSheet.id;
    let made: string | undefined;
    const ok = await attemptWrite(async () => {
      made = (await duplicateEvent(id, todayEvents, today, schedule)).madeId;
    });
    setEventSheet(null);
    await reload();
    if (!ok || !made) return;
    const madeId = made;
    showToast({
      message: "Duplicated",
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(() => schedule.deleteEvent(madeId));
        await reload();
      },
    });
  };

  const onSaveTask = async (draft: TaskDraft) => {
    if (sheet?.mode === "edit") {
      const rec = (draft.repeat || "") as "" | Recurrence;
      await attemptWrite(async () => {
        await tasks.editText(sheet.id, draft.text);
        await tasks.setCategories(sheet.id, [draft.category, ...(draft.extraCategories ?? [])].filter(Boolean));
        await tasks.setDue(sheet.id, draft.due || null);
        await tasks.setProject(sheet.id, draft.projectId ?? null);
        await tasks.setGoal(sheet.id, draft.goalId ?? null);
        await tasks.setEvent(sheet.id, draft.eventId ?? null);
        await tasks.setRecurrence(sheet.id, rec || null);
        await tasks.setPlan(sheet.id, draft.plan ?? null);
        await tasks.setSteps(sheet.id, draft.steps ?? []);
        await tasks.setNotes(sheet.id, draft.notes ?? null);
        await tasks.setEstimate(sheet.id, draft.estimateMin ?? null);
        await tasks.setPerson(sheet.id, draft.personId ?? null);
        if (draft.closeNow) await tasks.toggleDone(sheet.id);
      });
    }
    setSheet(null);
    await reload();
  };

  const onDeleteTask = async () => {
    if (sheet?.mode === "edit") {
      const id = sheet.id;
      const t = await tasks.task(id);
      const ok = await attemptWrite(() => tasks.deleteTask(id));
      // 2026-09-11: back under its own id (LIFE-F-15), so note links hold.
      if (ok && t) showToast({ message: "Task deleted", actionLabel: "Undo", onAction: async () => { await attemptWrite(() => tasks.recreateFrom(t, id)); await reload(); } });
    }
    setSheet(null);
    await reload();
  };

  // Candidates follow the plan's target date (2026-08-09): planning tomorrow
  // offers what is due by tomorrow and skips what tomorrow already holds.
  // "overdue" stays measured against the real today either way.
  const candidatesFor = (dateISO: string, evts: EventItem[]) => {
    const plannedTaskIds = new Set(evts.map((e) => e.data.sourceTaskId).filter((x): x is string => !!x));
    return taskItems
      // A REMINDER IS NOT A TASK (catalog Q1). It rides the task entity for
      // storage only: it never enters a task list, Up Next, or a plan. This
      // filter was missing, so "Morning Meds" sat in the planner under
      // Anytime asking to be given 45 minutes of deep work.
      .filter((t) => !t.data.done && !t.data.reminder && !plannedTaskIds.has(t.id) && (!t.data.due || (t.data.due as string) <= dateISO))
      // Season pause: a paused category's tasks are not offered. Bills are
      // EXEMPT: pausing Money in a low moment cannot silence rent.
      .filter((t) => !pausedCats.has(t.data.category ?? "") || !!t.data.bill)
      .map((t) => {
        const due = (t.data.due as string) || "";
        const win = workWindowOf(catsFull, t.data.category, routineData);
        return {
          id: t.id, text: t.data.text, category: t.data.category ?? "", due,
          suggested: isSuggested(due, dateISO, t.data.recurrence), overdue: !!due && due < today,
          // PICK 23 (2026-08-24): read through the upward index, not the
          // project chain alone. Plan My Day has ranked goal-moving tasks
          // above goalless ones since 2026-08-09, but it could only SEE the
          // filed ones, so most of his real work ranked as if it moved
          // nothing. A tagged task now claims its place in the day.
          goal: goalTitleForTask(goalIdx, t),
          // UP-CORE-02 (2026-09-05): the length he set on this task, so the
          // planner and the Day Loop draft deal it a slot that fits it
          // rather than one sized by its category.
          ...(t.data.estimateMin ? { estimateMin: t.data.estimateMin } : {}),
          ...(win ? { windowS: win.s, windowE: win.e } : {}),
        };
      })
      .sort(rankCandidates);
  };
  // Plan tomorrow, tonight (2026-08-09): the same sheet can aim at tomorrow.
  // Planning today at 10 PM is planning a dead day; the evening entry point
  // flips every derived input (date, events, window, protected ranges) to
  // tomorrow's, and the commit lands events on tomorrow.
  // tomorrowEvents state already exists above for the evening preview; the
  // planner reuses it and refreshes it on open.
  const [planTarget, setPlanTarget] = useState<"today" | "tomorrow">("today");
  const tomorrow = tomorrowISO(today);
  const planningTomorrow = planTarget === "tomorrow";
  const planDate = planningTomorrow ? tomorrow : today;
  const planEvents = planningTomorrow ? tomorrowEvents : todayEvents;
  const openPlan = async (target: "today" | "tomorrow") => {
    if (target === "tomorrow") setTomorrowEvents(await schedule.eventsOn(tomorrow));
    setPlanTarget(target);
    setPlanOpen(true);
  };
  const dow = planningTomorrow ? new Date(tomorrow + "T00:00:00").getDay() : new Date().getDay();
  const planWindow = planWindowFor(routineData, dow);
  const planStart = planningTomorrow
    ? planWindow.wakeMin // a future day starts at wake, not at "now"
    : (() => { const d = new Date(); const now = Math.ceil((d.getHours() * 60 + d.getMinutes()) / 15) * 15; return Math.max(now, planWindow.wakeMin); })();
  const planEnd = planWindow.endMin;
  // Phase 2 planning context: protected ranges for the target day, the
  // inferred energy peak, and how heavy yesterday felt.
  const blocked = protectedRangesFor(routineData, dow);
  // Overlap awareness and attached-task counts (2026-08-28), same as
  // Schedule's day list already computes for its own rows. Today reads the
  // identical pure functions on its own event/task lists rather than
  // reimplementing the overlap math or the attachment lookup.
  const todayOverlaps = overlapsOn(allEvents, today).filter((o) => !isKept(o, today));
  const conflicts = new Set<string>(todayOverlaps.flatMap((o) => [o.a.id, o.b.id]));
  const attachMap: Record<string, AttachInfo> = {};
  // S6-Q36: same per-event lookup as attachMap, alongside it.
  const firstMoveMap: Record<string, string> = {};
  for (const e of todayEvents) {
    const info = attachInfo(e, taskItems);
    if (info) attachMap[e.id] = info;
    const move = firstMoveOf(e, taskItems);
    if (move) firstMoveMap[e.id] = move;
  }
  const chrono = chronotypeFor(routineData);
  const peak = peakWindowFor(routineData, chrono);
  const energy = chrono !== "neutral" ? { chronotype: chrono, peakStartMin: peak.s, peakEndMin: peak.e } : undefined;
  const sizing = daySizing(prevMood);
  const onAIPlan = ai.available
    ? async (picks: { id: string; text: string; category: string; overdue: boolean }[], s: number, e: number, background: boolean) => {
        // Same wire as ScheduleFlow's onAIPlan: the profile line (routine,
        // goals, patterns) and strands ride with their real ids so the
        // model can honestly say which fact changed the plan (item 04
        // attribution). Strands are best-effort - a plan without
        // attribution beats no plan - but the profile is not: a failed
        // gatherContext here fails the same way ScheduleFlow's does.
        const ctx = await gatherContext();
        let strandList: { id: string; text: string; strength?: "influence" | "rule" }[] = [];
        try {
          strandList = strandsSvc ? (await strandsSvc.active()).map((x) => ({ id: x.id, text: x.data.text, strength: x.data.strength })) : [];
        } catch { /* a plan without attribution beats no plan */ }
        return aiPlanDay(ai, picks, planEvents, s, e, {
          work: { startMin: routineData.workStartMin, endMin: routineData.workEndMin },
          energy,
          gentle: sizing.light,
          profile: contextToText(ctx),
          strands: strandList,
          background,
        });
      }
    : undefined;
  const minLabel = (m: number) => {
    const t = fmtTime(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
    return `${t.time} ${t.ap}`;
  };

  // P7 (2026-08-20): make a task without leaving the planner. It lands on the
  // day being planned, so it is a candidate the instant it exists.
  const addPlanTask = async (text: string) => {
    let made: string | null = null;
    const ok = await attemptWrite(async () => { made = await tasks.createTask(text, { due: planDate }); });
    if (!ok || !made) return null;
    await reload();
    return { id: made as string, text, category: "", suggested: false, overdue: false, due: planDate };
  };

  // Read ONCE per mount, before the stamp is rewritten, or the return card
  // could never fire: marking today as seen would erase the gap it detects.
  const lastSeenRef = useRef<string | null>(loadLastSeen());
  useEffect(() => { markSeen(today); }, [today]);


  // BREAK IT DOWN, from Today (2026-08-21). The same operation Tasks already
  // offers, reachable from the card that actually notices the problem. A task
  // that has slid five days running is not a discipline failure; it is a task
  // whose first step was never obvious. One Undo restores the original.
  // ONE BREAKDOWN (2026-08-24). This was a near-copy of the one in TasksFlow,
  // and the copy had drifted in a way that mattered: it called
  // breakdownPrompt WITHOUT the identity context, so splitting a task from
  // Today produced worse steps than splitting the same task from the Tasks
  // tab. Nothing said so. Both routes go through tasks/taskMoves.ts now.
  const breakDownTask = async (taskId: string) => {
    const original = taskItems.find((t) => t.id === taskId);
    if (!original || !ai.available) return;
    showToast({ message: "Breaking it down…" });
    const identity = await gatherContext().then(identityToText).catch(() => "");
    let res: BreakdownResult | null = null;
    const ok = await attemptWrite(async () => {
      res = await splitIntoSteps(original.data.text, original, today, ai, tasks, identity);
    });
    await reload();
    if (!ok || !res) return;
    const r = res as BreakdownResult;
    if (r.reason === "no-ai") { showToast({ message: "Couldn't reach JARVIS · Try again" }); return; }
    showToast({
      message: splitLine(r.made.length),
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(() => undoBreakdown(r.made, r.original, tasks));
        await reload();
      },
    });
  };

  const onPlanCommit = async (blocks: { taskId: string; text: string; category: string; start: string; end: string; sitting?: number }[], picks: string[], leanedOn?: string[]) => {
    // Replace, never add (hotfix 2026-08-21): commitPlan sweeps each task's
    // prior plan event on this day before writing, against a fresh read.
    let ids: string[] = [];
    const ok = await attemptWrite(async () => {
      ids = (await schedule.commitPlan(planDate, blocks, undefined, { picks })).created;
      for (const b of blocks) {
        // A2 (2026-08-20): committing a plan already decides the WHEN, so the
        // if-then costs nothing to write. Gollwitzer and Sheeran put this at
        // d = 0.65; this is the cheapest possible way to buy it. Never
        // overwrites a plan he wrote himself.
        const existing = taskItems.find((t) => t.id === b.taskId);
        if (b.taskId && existing && !existing.data.plan) {
          await tasks.setPlan(b.taskId, planFromBlock(b.text, b.start));
        }
      }
    });
    // ONE PROPOSED DAY (merge phase 1). The commit RESOLVES the standing
    // draft instead of leaving it up beside the plan it just replaced.
    // Before this, editing the drafted day and committing left the card
    // offering "Accept the Day" for the superseded proposal, and accepting
    // it swept the blocks he had just written and put the old ones back.
    // Read fresh: another surface may have moved it while the sheet was open.
    if (ok) {
      // C-25 (wired 2026-09-13): the strand the plan leaned on, kept for the
      // day so the Why sheet on one of its picks can say so.
      rememberLeanedOn(planDate, leanedOn?.[0] ?? null);
      const resolved = acceptInto(readDraft(planDate), planDate, blocks, ids);
      if (resolved) {
        writeDraft(resolved);
        if (planDate === today) setDayDraft(resolved);
      }
    }
    setPlanOpen(false);
    setPlanTarget("today");
    await reload();
    if (!ok) return;
    showToast({
      message: `Planned ${blocks.length} ${blocks.length === 1 ? "block" : "blocks"}${planningTomorrow ? " for tomorrow" : ""}`,
      actionLabel: "Undo",
      onAction: async () => { await attemptWrite(async () => { for (const id of ids) await schedule.deleteEvent(id); }); await reload(); },
    });
  };

  // App icon badge (2026-08-09): mirrors the due-today count on every reload
  // and toggle, so the home screen answers "does JARVIS need me" honestly,
  // including going back to zero.
  useEffect(() => {
    void setAppBadge(badgeCount(taskItems, today));
  }, [taskItems, today]);

  // Event reminders (2026-08-09): today's and tomorrow's timed events get a
  // lock-screen nudge 15 minutes out, rescheduled whenever either day's
  // events change. Native-only; the seam no-ops everywhere else.
  //
  // S1-05: end rides along now so the builder can drop any rung longer than
  // the event itself (countdown.ts's law); this call site had the duration
  // in hand all along and simply never passed it on.
  useEffect(() => {
    const inputs = notifyPrefs.events
      ? [
          // S6-Q36: firstMove rides along so the closing rung of the
          // ladder can name the actual move instead of a placeholder.
          // UP-CORE-07 (2026-09-05): leaveMin buys the one rung that says
          // stand up now, for an event with a travel time.
          // UP-PLAT-01 (2026-09-06): the id rides along too, so a tap on the
          // rung opens THAT event's sheet instead of the Schedule tab.
          ...todayEvents.map((e) => ({ id: e.id, date: today, start: e.data.start, end: e.data.end, title: e.data.title, location: e.data.location, firstMove: firstMoveOf(e, taskItems), leaveMin: leadFor(e.data) ?? undefined })),
          ...tomorrowEvents.map((e) => ({ id: e.id, date: tomorrow, start: e.data.start, end: e.data.end, title: e.data.title, location: e.data.location, firstMove: firstMoveOf(e, taskItems), leaveMin: leadFor(e.data) ?? undefined })),
        ]
      : []; // pref off: an empty schedule cancels whatever was pending
    void ensureEventReminders(inputs);
  }, [todayEvents, tomorrowEvents, today, tomorrow, notifyPrefs.events, taskItems]);

  // S1-01 (2026-09-04): a reminder is a task wearing reminder facts, and
  // setting one never made the phone do anything, ever. Same rhythm as
  // events just above: rescheduled whenever today's reminder list or its
  // done/snooze state changes. No settings switch for this one (unlike
  // events, which sweeps in every calendar item whether the user wants a
  // buzz for it or not): setting a reminder is itself the opt-in.
  useEffect(() => {
    const inputs = taskItems
      .filter((t) => !!t.data.reminder)
      .map((t) => ({ id: t.id, text: t.data.text, reminder: t.data.reminder! }));
    // TODAY-F-15 (2026-09-05): the seam expands a week now, not two days, so
    // a weekend away no longer runs the arming out. AppShell re-arms on every
    // foreground as well, so this is no longer the only thing that ever does.
    void ensureTaskReminders(inputs, today);
  }, [taskItems, today]);

  // Running Late lands on Today too (2026-08-09): the plan lives here, so the
  // one-tap recovery for falling behind has to live here. Same shared shift
  // as the Schedule tab, recurring events left in place, full Undo.
  // TODAY-F-08 (2026-09-05): this was the one mutation on this screen that
  // did not run through a guard. Offline, the loop moved two events and threw
  // on the third; the rejection went unhandled, so there was no toast, no
  // Undo, no reload, and a half-shifted day with nothing saying so. The
  // restore list is taken BEFORE the writes (shiftPlan), so the failure path
  // can offer the same Undo the success path does. Not attemptWrite: its
  // standard toast carries no action, and a second showToast would overwrite
  // the one holding the recovery.
  const onRunningLate = async (mins: number) => {
    // SCHED-F-18 (2026-09-05): the plan is told the size of the shift, so
    // events it would carry past midnight are out of the restore list too.
    const { prior, skipped, crossed } = shiftPlan(todayEvents, nhm, mins);
    if (prior.length === 0) {
      if (crossed) showToast({ message: "Nothing moved · The rest would run past midnight" });
      return;
    }
    const undoShift = async () => { await attemptWrite(() => restoreShift(schedule, prior)); await reload(); };
    let moved = 0;
    try {
      moved = (await shiftFutureEvents(schedule, todayEvents, nhm, mins)).moved;
    } catch {
      await reload();
      showToast({ message: "Couldn't move the whole day · Some events moved", actionLabel: "Undo", onAction: undoShift });
      return;
    }
    if (moved === 0) return;
    await reload();
    showToast({
      message: `${moved} ${moved === 1 ? "event" : "events"} +${mins === 60 ? "1 hr" : mins + " min"}${skipped ? ` · ${skipped} repeating stayed` : ""}${crossed ? ` · ${crossed} would pass midnight` : ""}`,
      actionLabel: "Undo",
      onAction: undoShift,
    });
  };

  // NOTE (hotfix 2026-08-15): the loading return must sit BELOW every hook.
  // It briefly lived here, above the Day Loop effects, which is a hooks-order
  // violation (React #310): the first render bailed early, the second ran
  // more hooks, and the error boundary swallowed the whole app. The return
  // now lives after the last effect; everything between here and there is
  // pure derivation that is safe on empty loading-state data.
  // The same map every other provenance line in the app reads
  // (shared/openSource.ts), so Today's copy of the event page opens a source
  // exactly where the Schedule tab's copy does.
  const openSourceFor = onOpenEntity ? sourceOpener(onOpenEntity) : undefined;

  const nhm = nowHHMM(now);
  // Evening posture (Phase 2 follow-on): after the workday (or 6 PM), Today
  // recaps instead of pushing, and the check-in leads.
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // Fresh Start banner: only when the afternoon is honestly off track, never
  // in the evening posture, and never again today once waved off.
  const offTrack = !freshSkipped && !isEvening(nowMin, routineData) && isOffTrack(taskItems, today, nowMin);
  // Up Next: ONE dealt card (Option 1, Dave 2026-08-26 "go with what you
  // think is best"). The deck's top task with its reason on it; everything
  // behind it is a count on a receipt line that opens the Focus deck. One
  // target on screen, because choosing among three is a decision tax the
  // page was charging before work could start.
  const upNextAll = rankOpen(taskItems.filter(notMail), today);
  const upNextRows = upNextAll.slice(0, 1);
  const inPeakNow = !!energy && nowMin >= energy.peakStartMin && nowMin < energy.peakEndMin;

  // BLENDING ON TODAY (2026-08-21). The same offer the Schedule tab makes,
  // on the page he is actually on when the drive is forty minutes away. One
  // per block, one per task, only when the fit is clearly best.
  const blendMap: BlendMap = {};
  {
    const open = todayEvents.filter((e) => (e.data.taskIds ?? []).length === 0);
    const byEvent = bestPerBlock(
      open,
      taskItems.map((t) => ({
        id: t.id, text: t.data.text, category: t.data.category ?? "",
        done: t.data.done, due: t.data.due ?? null, projectId: t.data.projectId,
      })),
      loadBlendMemory(),
    );
    for (const e of open) {
      const fit = byEvent[e.id];
      if (!fit) continue;
      blendMap[e.id] = {
        text: fit.task.text,
        why: fit.why,
        onAdd: () => void (async () => {
          const prior = e.data.taskIds ?? [];
          const ok = await attemptWrite(() => schedule.editTaskIds(e.id, [...prior, fit.task.id]));
          if (!ok) return;
          recordBlend(blockKind(e.data), fit.task.category);
          await reload();
          showToast({
            message: "Added to " + e.data.title,
            actionLabel: "Undo",
            onAction: async () => { await attemptWrite(() => schedule.editTaskIds(e.id, prior)); await reload(); },
          });
        })(),
      };
    }
  }
  // Close-out (Session 5): Time Sense knows every completion today, not just
  // the due-today ones. The weekly recap card speaks on Sunday evenings only.
  const samples = readSamples();
  const dayStart = new Date(today + "T00:00:00").getTime();
  // TODAY-F-12 (2026-09-05): the day ends at tomorrow's midnight, stepped as
  // a calendar day; dayStart + 86,400,000 dropped the last hour of the
  // clocks-back Sunday and took the first hour of Monday in spring.
  const dayEnd = new Date(tomorrowISO(today) + "T00:00:00").getTime();
  const completionsToday = samples.filter((s) => s.t >= dayStart && s.t < dayEnd).length;
  // THE HOME PAGE LOOKS UP (Dave 2026-08-22, picks 1-5 and 31). One index per
  // render pass, shared by the hero pill, the Now card, both new notices and
  // the evening line, so no two of them can disagree about what moves what.
  const goalIdx = buildGoalIndex(projList, liveGoals(goalList));
  // WHERE A TASK LIVES (The Row and Health, 2026-09-02): the row's second
  // line, project first, then the goal it moves, then the category.
  const parentIdx = useMemo(() => buildParentIndex(projList, goalList, taskItems, allEvents), [projList, goalList, taskItems, allEvents]);
  const goalReach = (id: string) => {
    const g = goalList.find((x) => x.id === id);
    return g ? reachOf(taskItems, projList, g) : { filedIds: [], taggedIds: [], openTagged: 0, progress: null };
  };
  const movedGoals = goalsMovedToday(goalIdx, taskItems, samples, dayStart, dayEnd);
  // PICK 2: a project whose work is finished but which nobody has closed.
  // The tick-time toast already offers this at the instant of the last tap;
  // this is for every other way a project reaches the end (a sweep, an
  // import, the toast missed while the phone was in a pocket). One at a time.
  // LAW 2: "every task in it is finished" is not the same claim as "this
  // project is over", so the offer has to be refusable (see its onDismiss).
  const finishedProject = rankProjects(projList, taskItems, samples, Date.now())
    .filter(closable)
    .filter((p) => !isQuiet(p.project.id, today, closeOfferStore))[0] ?? null;
  const closeProject = async (id: string) => {
    const proj = projList.find((p) => p.id === id);
    if (!proj) return;
    const ok = await attemptWrite(() => projectsSvc.update(id, { ...proj.data, status: "done" }));
    await reload();
    if (ok) showToast({ message: celebrationLine("project", id) + " · " + proj.data.title });
  };
  // UP-CORE-18 (2026-09-05): A PROJECT WITH A DATE, WHEN THE DATE IS NEAR.
  // Three days, because a deadline further out than that is not today's
  // business and this page is about today. The line is the same arithmetic
  // the project row and the project page carry, so all three say one thing.
  const dueProject = (() => {
    if (!onOpenProject) return null;
    const soon = addDaysISO(today, 3);
    for (const p of projList) {
      if (p.data.status !== "active" || !p.data.due) continue;
      if (p.data.due > soon) continue;
      if (isQuiet(p.id, today, closeOfferStore)) continue;
      const pace = projectPaceParts(projectProgress(taskItems, p.id), p.data.due, today);
      if (pace) return { project: p, pace };
    }
    return null;
  })();
  // PICK 3: the goal nothing on today's plate touches. goalNudgeTick lets a
  // dismissal re-derive without a reload.
  void goalNudgeTick; // re-derive after a dismissal (same pattern as dismissTick)
  const untouched = untouchedGoal(goalIdx, goalList, goalReach, todaysTasks(taskItems, today), today);
  // The chain's one meta line: derived facts only, and the task's own length
  // when it has one (UP-CORE-02), because "10m" is what makes it startable.
  // §AK, §AM (2026-09-26): "Same category" is the line's one grey and the
  // length is an estimate the app worked out, so it is sky (.fact.est, as on
  // the headliner). "Keep going" came off the card: a second grey that said
  // nothing the slot, the tick a second ago and Start Now do not already say.
  // momentumSub keeps it, because that string is the tuning rule's stored
  // evidence, not the card's line. It does render, as the rule's line on
  // Settings > What JARVIS Learned, so it is a phrase joined by commas,
  // never typed dots (2026-09-26).
  //
  // DUE AND LATE WEAR THE KEY, THE WAY THE TASKS TAB DRAWS THEM (§AM R3/R8,
  // 2026-09-26). chainReason used to carry "due today" and "overdue" in the
  // line's plain grey, a meaning with no colour, while MomentumRow on Tasks
  // already drew the same task's due half as the distance chip. Both read
  // distanceFor off the task now. "Same category" is measured against the
  // FINISHED task's area, stored with the pick, so a suggestion nextBest
  // took from another area never claims it.
  const momentumParts = (m: Momentum) => {
    const t = m.task;
    const mins = t.data.estimateMin ?? estimates[t.data.category ?? ""];
    return {
      why: chainReason(t, m.afterCategory),
      due: distanceFor(t.data, today),
      len: mins ? durLabel(mins) : null,
    };
  };
  const momentumSub = (m: Momentum): string => {
    const { why, due, len } = momentumParts(m);
    const reason = [why?.toLowerCase(), due ? (due.kind === "late" ? "overdue" : "due today") : null].filter(Boolean).join(", ");
    return ["Keep going", reason, len].filter(Boolean).join(", ");
  };
  // The due half as a fact's words: the chip's own distance, in a sentence's
  // case ("Due today", "3 Days late", "Over a month late"), since a fact is
  // not a chip. Every late distance ends in "late", so the words say it too.
  const dueWords = (d: Distance): string => {
    if (d.kind === "today") return "Due today";
    const words = d.label.toLowerCase();
    const late = / late$/.test(words) ? words : words + " late";
    return capAfterNumber(late.charAt(0).toUpperCase() + late.slice(1));
  };
  // Null when there is nothing to say, so the card goes solo instead of
  // carrying an empty sub line.
  const momentumFacts = (m: Momentum) => {
    const { why, due, len } = momentumParts(m);
    if (!why && !due && !len) return null;
    // With a length on the line, a toned due fact would cost the length its
    // sky: Facts keeps the first colour on a line and drops the rest (K.3).
    // So the due half is the distance chip there, which is not a fact and
    // carries its own tint by rule (the headliner's and MomentumRow's own
    // .uchip, TODAY amber, N DAYS LATE red). Without a length it is the
    // line's one coloured fact: amber when due, red when late.
    //
    // THE LINE NEVER CLIPS A WORD (the lead, 2026-09-26). In .facts only the
    // last fact shrinks, so the short facts lead (the chip, the length) and
    // "Same category", the words, goes last. With the chip on the line there
    // is no room for the words as well: measured at 390px, TODAY, 15m and
    // Same category need about 230px, the card's line has 161 at scale 1
    // and 129 at 1.4, and the stream's one-line row leaves a short title's
    // sub 83 to 100px, so whichever fact sat before the words was cut
    // mid-word. So the chip branch says the two facts that make the task
    // startable, when and how long, the same two slots the dealt row above
    // it prints (MoveHeadliner: the chip, then the length), and the shared
    // area stays on the Tasks tab's row. A late chip stands alone
    // (2026-09-26): "2 DAYS LATE" fills the line at type scale 1.4 and the
    // length beside it was left its dot and an ellipsis.
    if (due && len && due.kind === "late") {
      return (
        <div className="facts">
          <span className="fact"><span className="uchip u-late">{due.label}</span></span>
        </div>
      );
    }
    if (due && len) {
      return (
        <div className="facts">
          <span className="fact"><span className={"uchip " + (due.kind === "late" ? "u-late" : "u-today")}>{due.label}</span></span>
          <span className="fact est">{len}</span>
        </div>
      );
    }
    return (
      <Facts facts={[
        due ? { text: dueWords(due), tone: due.kind === "late" ? "red" : "warn" } : null,
        len ? { text: len, tone: "est" } : null,
        why ? { text: why } : null,
      ]} />
    );
  };
  const evening = isEvening(nowMin, routineData) ? eveningStats(todayEvents, taskItems, today, nhm, completionsToday) : undefined;
  // C-24 (Astra, 2026-09-12): the headliner's own two facts. The area is a
  // dot plus plain words (G4), and the length is the task's own estimate
  // before its area's usual, the order every other surface asks in. Evening
  // has no dealt task, so it has no headliner either.
  // 2026-09-16: the ranker's own pick leads, full stop. "Not This One" and
  // the deal that honoured it are gone with the Why sheet that offered them:
  // re-ordering a deck was work the app asked of him, not work it did for
  // him. Tomorrow answers "not tonight" now, by booking a real slot.
  const moveTask = !evening ? upNextAll[0] ?? null : null;
  const moveCategory = moveTask
    && catName(moveTask.data.category)
    // A task with no area says nothing about it (2026-09-13): "No category"
    // on the first card of the day is a grey dot announcing an absence.
    ? { name: catName(moveTask.data.category), slot: catColorOf(moveTask.data.category) }
    : null;
  const moveEstimate = moveTask
    ? `${moveTask.data.estimateMin ?? estimates[moveTask.data.category ?? ""] ?? 45} min`
    : null;
  // UP-CORE-03: tomorrow's birthday, in the evening only, one at a time,
  // and silent once waved off. upcomingBirthdays already knows how to say
  // "Tomorrow" and already handles the year wrap.
  void birthdayDismissTick; // re-derive after a dismissal
  const tomorrowBirthday = evening
    ? upcomingBirthdays(peopleList, today, 1).filter((b) => b.inDays === 1 && !isQuiet(b.id, today, birthdayStore))[0] ?? null
    : null;
  // HOW TODAY WENT (Dave, on the list since 2026-09-07; built 2026-09-09).
  // Read every render, joined every render: pendingPicks is a storage read of
  // what he committed this morning and todayPlan joins it to the tasks as they
  // stand at this instant. Nothing memoised on purpose. The whole complaint
  // was that the answer was computed once and never asked again, and a
  // useMemo keyed on the wrong thing is exactly how that comes back.
  const plan = evening ? todayPlan(pendingPicks(today), taskItems) : null;
  const weekly = evening ? weekRecap(samples, allEvents, today) : null;
  // Day ring: what today asked for, and how much of it is behind him. Hero
  // tint by daypart. TODAY-F-09 (2026-09-05): the arithmetic lives in
  // todayData's dayRing so the evening's copy of it cannot drift.
  const ring = dayRing(taskItems, today);
  // GROUP A banners (items 6 and 9), above the day. Success is quiet;
  // failure is louder, and tappable to retry.
  // LAW 1: every read of the sweep receipt for DISPLAY goes through
  // liveMoved first, against the live task list. The receipt itself stays
  // whole -- Undo needs every entry it wrote, including the ones since
  // handled -- but no card is allowed to speak about a task that is done,
  // deleted, or has moved on. See autoSweep.ts for the full reasoning.
  void sweepDismissTick; // re-derive after a sweep-card dismissal
  const movedNow = liveMoved(sweepReceipt, taskItems, today);
  // NOT THE EMAILS (Dave 2026-09-17: "they have their own section on the
  // home page; there is no need to have repetitiveness"). A task that was
  // born from a thread is the email band's to surface, with its verb; the
  // slid-task card only ever names a task that is nothing but a task.
  const mailBorn = (id: string): boolean => { const t = taskItems.find((x) => x.id === id); return !!t && isMailTask(t); };
  const sweepCand = sweepReceipt && !sweepReceipt.failed ? setAsideCandidate(movedNow.filter((m) => !mailBorn(m.id)), today) : null;
  // THE DAY LOOP (Group C item 14). Draft at first open, deterministic and
  // instant; Accept stays the one honest commit moment.
  const todayDow = new Date().getDay();
  const todayWindow = planWindowFor(routineData, todayDow);
  const todayBlocked = protectedRangesFor(routineData, todayDow);
  const draftStart = (() => { const d = new Date(); const n = Math.ceil((d.getHours() * 60 + d.getMinutes()) / 15) * 15; return Math.max(n, todayWindow.wakeMin); })();
  useEffect(() => {
    if (loading || evening) return;
    const existing = readDraft(today);
    const nowM = (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); })();
    // A cached draft whose times have passed is redrafted from now, not
    // reused: the card must never propose the past (hotfix 2026-08-21).
    // Dismissal survives the redraft; a dismissed card stays dismissed.
    if (existing && !draftIsStale(existing, nowM)) { setDayDraft(existing); return; }
    if (existing?.dismissed) { setDayDraft(existing); return; }
    const cands = candidatesFor(today, todayEvents);
    if (cands.length === 0) return;
    const d = draftDay({
      date: today,
      candidates: cands,
      events: todayEvents,
      startMin: draftStart,
      endMin: todayWindow.endMin,
      blocked: todayBlocked,
      maxBlocks: sizing.maxBlocks,
      estimateFor: (c) => estimates[c] ?? 45,
    });
    writeDraft(d);
    setDayDraft(d);
    // Once per day-open; candidate churn intra-day must not redraft an
    // undecided card out from under the user.
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Overnight redraft: evening prepares tomorrow, so the next open is instant.
  useEffect(() => {
    if (loading || !evening) return;
    if (readDraft(tomorrow)) return;
    const dow = new Date(tomorrow + "T00:00:00").getDay();
    const win = planWindowFor(routineData, dow);
    const cands = candidatesFor(tomorrow, tomorrowEvents);
    if (cands.length === 0) return;
    writeDraft(draftDay({
      date: tomorrow,
      candidates: cands,
      events: tomorrowEvents,
      startMin: win.wakeMin,
      endMin: win.endMin,
      blocked: protectedRangesFor(routineData, dow),
      maxBlocks: sizing.maxBlocks,
      estimateFor: (c) => estimates[c] ?? 45,
    }));
  }, [loading, evening]); // eslint-disable-line react-hooks/exhaustive-deps

  // B12 (2026-08-23): FIRES EXACTLY ONCE, same as the Schedule tab's copy.
  //
  // There IS a stale-draft re-read below, and it is not a double-tap guard:
  // it awaits readDraft, so a second tap enters before the first tap's write
  // lands and both read accepted:false. The result was a duplicate day.
  // A ref closes the window a state flag leaves open.
  const acceptingDraft = useRef(false);
  const acceptDraft = async () => {
    if (!dayDraft || acceptingDraft.current) return;
    acceptingDraft.current = true;
    try {
      await acceptDraftInner();
    } finally {
      acceptingDraft.current = false;
    }
  };
  const acceptDraftInner = async () => {
    if (!dayDraft) return;
    // SOMEONE ELSE MAY HAVE ANSWERED IT (merge phase 1). Schedule commits
    // through the same door and resolves the same draft, but this tab's copy
    // in state does not hear about it. Accepting a copy that the store has
    // already marked accepted would sweep the blocks that commit wrote and
    // put this stale proposal back -- the same overwrite the sheet path had.
    // Adopt the store's answer and stop; nothing to commit.
    const stored = readDraft(today);
    if (stored?.accepted) {
      setDayDraft(stored);
      await reload();
      return;
    }
    // The card sat on screen past its own times: writing it would put blocks
    // in the past. Redraft from now, show the honest version, ask again.
    const nowM = (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); })();
    if (draftIsStale(dayDraft, nowM)) {
      const fresh = draftDay({
        date: today,
        candidates: candidatesFor(today, todayEvents),
        events: todayEvents,
        startMin: Math.max(Math.ceil(nowM / 15) * 15, todayWindow.wakeMin),
        endMin: todayWindow.endMin,
        blocked: todayBlocked,
        maxBlocks: sizing.maxBlocks,
        estimateFor: (c) => estimates[c] ?? 45,
      });
      // Nothing left to place (day full, or every candidate handled): the
      // card retires quietly instead of showing an empty plan.
      if (fresh.blocks.length === 0) {
        const done = { ...dayDraft, dismissed: true };
        writeDraft(done);
        setDayDraft(done);
        showToast({ message: "Those times had passed and nothing fits now" });
        return;
      }
      writeDraft(fresh);
      setDayDraft(fresh);
      showToast({ message: "Those times had passed · Day re-planned from now" });
      return;
    }
    // Replace, never add (hotfix 2026-08-21): commitPlan sweeps each task's
    // prior plan event on this day before writing. This card was the second
    // duplicate machine: it committed a cached draft with no check against
    // what the sheet had already planned.
    // SCHEDULE AUDIT 2026-08-29: committed from the LIVE view, recomputed
    // here against current state rather than closed over from the render.
    // Without this, accepting after a Start Fifteen block would hand
    // commitPlan the already-answered task, whose supersede sweep then
    // DELETES the committed block mid-work and reschedules it later: work
    // vanishing on the exact tap that was supposed to lock the day in.
    const live = liveBlocks(dayDraft.blocks, todayEvents, taskItems);
    if (live.length === 0) {
      // Every block got answered some other way while the card stood. The
      // day is already what the card proposed; there is nothing to write.
      const done = { ...dayDraft, dismissed: true };
      writeDraft(done);
      setDayDraft(done);
      return;
    }
    let ids: string[] = [];
    const ok = await attemptWrite(async () => {
      ids = (await schedule.commitPlan(today, live.map((b) => ({
        taskId: b.taskId, text: b.text, category: b.category, start: b.start, end: b.end,
        // Accept the Day IS committing a day plan (audit 2026-08-25): picks
        // ride the one event door in the card's own order.
      })), madeBy("plan"), { picks: live.map((b) => b.taskId) })).created;
    });
    if (!ok) return;
    const next = { ...dayDraft, blocks: live, accepted: true, eventIds: ids };
    writeDraft(next);
    setDayDraft(next);
    await reload();
    showToast({
      message: `Day planned · ${ids.length} ${ids.length === 1 ? "block" : "blocks"}`,
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(async () => { for (const id of ids) await schedule.deleteEvent(id); });
        const back = { ...next, accepted: false, eventIds: [] };
        writeDraft(back);
        setDayDraft(back);
        await reload();
      },
    });
  };

  const dismissDraft = () => {
    if (!dayDraft) return;
    const next = { ...dayDraft, dismissed: true };
    writeDraft(next);
    setDayDraft(next);
  };

  // Re-flow (push 16): the remainder re-draped around reality. Automatic
  // ONLY at Everything (a real receipt with undo every time); below that the
  // slippage is stated with a one-tap Re-flow.
  const hardRanges = todayBlocked.filter((b) => !b.soft).map((b) => ({ s: b.s, e: b.e }));
  const planEvs = dayDraft?.accepted ? todayEvents.filter((e) => dayDraft.eventIds.includes(e.id)) : [];
  const otherEvs = dayDraft?.accepted ? todayEvents.filter((e) => !dayDraft.eventIds.includes(e.id)) : [];
  // TODAY-F-01 (2026-09-05): the work that is finished, so a block he already
  // did is not "behind the clock". A recurring task records its completion as
  // lastDone and rolls its due date rather than setting done (TasksService
  // toggleDone), so both spellings of "finished today" count here.
  const doneTaskIds = new Set(
    taskItems.filter((t) => t.data.done || t.data.lastDone === today).map((t) => t.id),
  );
  const slippedCount = slippedPlanEvents(planEvs, nowMin, doneTaskIds).length;

  const runReflow = useCallback(async () => {
    if (!dayDraft?.accepted) return;
    const res = reflowDay(planEvs, otherEvs, nowMin, todayWindow.endMin, hardRanges, doneTaskIds);
    if (res.moves.length === 0 && res.overflow.length === 0) return;
    // UP-MIND-20 (2026-09-05): a block the user's Values protect is never
    // moved for them, whatever the level or the confidence, and the hold
    // leaves a receipt rather than a day that silently did not re-flow.
    // See reflowHold above (BRAIN-F-05 class): the category has to resolve
    // to its name before a Protect line can ever match it.
    const protectedMove = res.moves
      .map((m) => ({ m, l: reflowHold(valueLines, todayEvents.find((e) => e.id === m.eventId)) }))
      .find((x) => x.l);
    if (protectedMove?.l) { showToast({ message: heldLine(protectedMove.l) }); return; }
    const ok = await attemptWrite(async () => {
      for (const m of res.moves) {
        // UP-CORE-05 (2026-09-05): the block says re-flow moved it, for the
        // day, so a plan block that is not where he left it explains itself.
        await schedule.editTime(m.eventId, m.start, "reflow");
        await schedule.editEnd(m.eventId, m.end);
      }
    });
    await reload();
    if (!ok) return;
    if (res.overflow[0]) setOverflowOffer(res.overflow[0]);
    if (res.moves.length > 0) {
      showToast({
        message: `Re-flowed ${res.moves.length} ${res.moves.length === 1 ? "block" : "blocks"}`,
        actionLabel: "Undo",
        onAction: async () => {
          await attemptWrite(async () => {
            for (const m of res.moves) {
              await schedule.editTime(m.eventId, m.prevStart);
              await schedule.editEnd(m.eventId, m.prevEnd);
            }
          });
          await reload();
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayDraft, todayEvents, taskItems, nowMin]);

  useEffect(() => {
    if (loading || evening || !dayDraft?.accepted || slippedCount === 0) return;
    if (effectiveLevel(getAIControl()) !== "everything") return;
    const t = Date.now();
    if (t - reflowGuard.current < 5 * 60_000) return;
    reflowGuard.current = t;
    void runReflow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, evening, slippedCount, dayDraft]);

  // Hook order is unconditional: this must sit ABOVE the loading return.
  const [remSheet, setRemSheet] = useState<{ mode: "new" } | { mode: "edit"; id: string; text: string; reminder: ReminderInfo; due?: string | null; category?: string } | null>(null);

  // EVERY HOOK SITS ABOVE THE EARLY RETURN. React counts hooks by call order,
  // so one declared below `if (loading) return` runs on some renders and not
  // others, and the app dies with error #310 the moment loading flips. This
  // has bitten three times now. The guard is eslint's rules-of-hooks, which
  // reports it as an ERROR, and the commit gate is eslint at zero errors, so
  // it cannot ship. Do not move these down to be near what uses them.
  // THE DAY'S PLAN ALREADY ANSWERED IT (Dave 2026-08-22, from his own
  // screenshot: "Finish Jarvis Visuals" sat in the drafted day at 12:00 PM
  // and simultaneously headlined Heads Up as "Slid 3d · Break It Down").
  // That is the same task twice on one screen, which the locked law "no
  // repetition on any page" forbids, and the nag is the weaker of the two:
  // the card above has already given the task a time. A notice about a task
  // the plan holds is suppressed while that plan stands. A dismissed draft
  // holds nothing, so the notices come back.
  // The lengths the card offers. Literally the plan sheet's list, not a copy
  // of it: this was declared inline with a comment claiming it was "the same
  // set", which is precisely how a set stops being the same.
  const DRAFT_DURS = DUR_CHOICES;
  const draftMinutes = (d: DayDraft, taskId: string): number => {
    const b = d.blocks.find((x) => x.taskId === taskId);
    if (!b) return 0;
    const m = (hhmm: string) => { const p = hhmm.split(":"); return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0); };
    return m(b.end) - m(b.start);
  };

  // One door for every edit the card makes. Each edit re-places the WHOLE day
  // through the same engine the draft was cut with, so a length change moves
  // the times below it honestly rather than leaving the card showing a
  // duration that disagrees with the clock beside it.
  const applyEdit = (op: { minutes?: Record<string, number>; drop?: string; add?: string }) => {
    setDayDraft((cur) => {
      if (!cur) return cur;
      const ids = cur.blocks.map((b) => b.taskId);
      const minutes: Record<string, number> = {};
      for (const id of ids) minutes[id] = draftMinutes(cur, id);
      let next = ids;
      if (op.drop) next = ids.filter((id) => id !== op.drop);
      if (op.add && !ids.includes(op.add)) next = [...ids, op.add];
      Object.assign(minutes, op.minutes ?? {});
      const pool = candidatesFor(today, todayEvents);
      const edited = editDraft(cur, {
        ids: next, minutes, pool,
        events: todayEvents,
        startMin: draftStart,
        endMin: todayWindow.endMin,
        blocked: todayBlocked,
        estimateFor: (c) => estimates[c] ?? 45,
      });
      writeDraft(edited);
      return edited;
    });
  };

  const planned = useMemo(() => plannedTaskIds(dayDraft), [dayDraft]);
  // movedNow is already the live-checked list (Law 1); this drops the ones
  // the day draft has since given a time. Not memoized: liveMoved rebuilds
  // each render anyway, so a memo keyed on it would never hit.
  const unplannedMoved = movedNow.filter((m) => !planned.has(m.id));

  const [ritual, setRitual] = useState<Ritual | null>(null);

  // THE DRAFT PRE-GENERATION PASS lives above the loading return, because
  // hooks must run in the same order on every render and the skeleton is an
  // early one. Its helpers come with it: jobFor is referenced inside the
  // effect, so declaring it further down would put it in the temporal dead
  // zone at the moment the effect closes over it.
  // N13: fifty-five days deserves a different tone than three, and a chase he
  // set himself starts gentle whatever the clock says. The WAIT sets the
  // tone, the ASK sets what the draft is for (2026-08-21), so the card's
  // draft matches the button the card is wearing instead of climbing a ladder
  // the button no longer uses.
  const nudgeInstruction = (subject: string, days: number, sent: number) =>
    decide(subject, "", days, sent).primary.instruction ?? "";

  // UP-MIND-01 (2026-09-05): the card's draft reads the How You Write doc and
  // the Writing-bucket facts, which is what the Sweep deck has done since it
  // shipped (DeckFlow.tsx:146). Both cardDraft builders have always accepted
  // `voice` and this caller never passed it, so a reply drafted on the home
  // page sounded like nobody while the same reply drafted one tab over
  // sounded like him.
  //
  // Gathered ONCE per open, into a ref, because jobFor is synchronous and is
  // called from both the tap handler and the background pass: the two must
  // hash the same string or every pre-generated draft misses. styleRule:
  // false because CARD_REPLY_SYSTEM and CARD_NUDGE_SYSTEM already emit
  // STYLE_SCOPE_RULE, same reason the deck passes it.
  // UP-MIND-24: Contacts and their cached last-contact times, for the
  // meeting line. Read once per open; neither costs a request.
  // UP-MIND-20 (2026-09-05): the user's stated hard lines. Read only: the
  // app never writes a Value.
  const [valueLines, setValueLines] = useState<HardLine[]>([]);
  useEffect(() => {
    let live = true;
    void brainDocs.hardLines().then((l) => { if (live) setValueLines(l); }).catch(() => { /* no lines: the re-flow behaves as before */ });
    return () => { live = false; };
  }, [brainDocs]);
  const [prepPeople, setPrepPeople] = useState<PrepPerson[]>([]);
  const [prepLast, setPrepLast] = useState<Record<string, number>>({});
  useEffect(() => {
    let live = true;
    void peopleSvc.list()
      .then((list) => {
        if (!live) return;
        setPrepPeople(list.map((p) => ({ id: p.id, name: p.data.name, ...(p.data.email ? { email: p.data.email } : {}) })));
        const cache = loadLastContact();
        const out: Record<string, number> = {};
        for (const p of list) {
          const e = (p.data.email || "").trim().toLowerCase();
          const ms = e ? cache[e]?.ms : null;
          if (typeof ms === "number" && ms > 0) out[p.id] = ms;
        }
        setPrepLast(out);
      })
      .catch(() => { /* no meeting line: the day renders exactly as before */ });
    return () => { live = false; };
  }, [peopleSvc]);

  const cardVoiceRef = useRef("");
  const [cardVoiceReady, setCardVoiceReady] = useState(false);
  useEffect(() => {
    let live = true;
    void gatherContext()
      .then((c) => voiceToText(c, { styleRule: false }))
      .catch(() => "")
      .then((v) => {
        if (!live) return;
        cardVoiceRef.current = v;
        setCardVoiceReady(true);
      });
    return () => { live = false; };
  }, [gatherContext]);

  const jobFor = (n: { kind: string; threadId: string }) =>
    cardDraftJob(n, loadMailSnapshot(), loadNudgeCounts(), nudgeInstruction,
      (messages, system) => ai.complete(messages as { role: "user" | "assistant"; content: string }[], system),
      cardVoiceRef.current);

  //
  // The list is derived with the SAME mailNotices() call MailNotices renders
  // from, nudge counts included (a nudged wait can drop its card), so the
  // drafts that get warmed are the cards he can actually see. A separate
  // ranking here would warm the wrong five.
  // (The Now suggestion's swipe controller stood here. 55d2b15 took the dealt
  // task off the Now card -- "two surfaces on one screen each offering the
  // thing to do next" -- which took the markup that used it, and the hook call
  // was left behind running a gesture for a row that no longer exists. Found
  // by the swipe audit of 2026-09-20: one grep hit for the whole app.)

  const pregenRan = useRef(false);
  useEffect(() => {
    // Waits for the voice (UP-MIND-01): warming a draft with an empty voice
    // and then serving the tap path a voiced one would miss every entry the
    // background pass wrote, which is the exact failure the shared hash in
    // cardDraftJob exists to prevent.
    if (pregenRan.current || !ai.available || !cardVoiceReady) return;
    const snap = loadMailSnapshot();
    if (snap.threads.length === 0 && snap.waiting.length === 0) return;
    pregenRan.current = true;
    const jobs = mailNotices(snap, today, new Date(), PREGEN_CAP, [], [], loadNudgeCounts())
      .filter((n) => n.kind === "reply" || n.kind === "deadline" || n.kind === "nudge" || n.kind === "chase")
      .map((n) => jobFor(n))
      .filter((j): j is NonNullable<typeof j> => !!j);
    if (jobs.length) void pregenerate(jobs);
    // Deliberately not depending on the snapshot: this is a once-per-open
    // warm-up, and re-running it whenever mail reloads would turn a capped
    // background pass into a loop that spends five calls per refresh. The
    // pregenRan ref makes that true even if the deps below ever grow.
  }, [ai.available, today, cardVoiceReady]);

  // UP-ATH-02 (2026-09-06): the Training Door on Today. Schedule has had it
  // since D4-C off this same DayRow; the page the athlete is on at six in the
  // evening did not, so a gym block here was a plain row and the only way
  // into a session was Resume on one already running.
  // A BANNER'S OPEN LANDS ON THE REMINDER (push C): the shell fires the id;
  // the sheet opens once the day's tasks are in.
  useEffect(() => {
    if (!reminderOpenId || taskItems.length === 0) return;
    openReminder(reminderOpenId);
    onReminderOpened?.();
  }, [reminderOpenId, reminderNonce, taskItems.length]);

  // What a reminder can be about: today's records, and the notes and
  // decisions loaded once the sheet is open.
  const [extraLinkCandidates, setExtraLinkCandidates] = useState<LinkCandidate[]>([]);
  useEffect(() => {
    if (!remSheet) return;
    let on = true;
    void (async () => {
      try {
        const [notes, decisions] = await Promise.all([notesSvc.listNotes(), decisionsSvc.listAll()]);
        if (!on) return;
        setExtraLinkCandidates([
          ...notes.map((n) => ({ type: "note" as const, id: n.id, label: displayTitle(n.data as { title?: string }) || "Untitled" })),
          ...decisions.map((d) => ({ type: "decision" as const, id: d.id, label: d.data.decision })),
        ]);
      } catch { /* the picker lists what it has */ }
    })();
    return () => { on = false; };
  }, [remSheet !== null]);

  const gymDoor = useGymDoor(todayEvents, today, today);

  // THE EVENT'S OWN PAGE (2026-09-09), pushed the same way the gym door and
  // Brain's category page are: a screen, not a route. Read here and handed
  // down, so the page holds no service of its own.
  if (eventDetail) {
    const ev = allEvents.find((x) => x.id === eventDetail) ?? todayEvents.find((x) => x.id === eventDetail);
    if (ev) {
      return (
        <EventDetailPage
          event={ev}
          onBack={() => setEventDetail(null)}
          onEdit={() => { const id = eventDetail; setEventDetail(null); void openEventSheet(id); }}
          steps={taskItems.filter((t) => t.data.eventId === eventDetail).map((t) => ({ id: t.id, text: t.data.text, done: !!t.data.done }))}
          onToggleStep={(id) => void onToggleTask(id)}
          onAddStep={(text) => void addEventStep(eventDetail, ev, text)}
          linkedNotes={eventDetailNotes}
          openSourceFor={openSourceFor}
        />
      );
    }
  }
  // UP-ATH-02 (2026-09-06): walking through the Training Door mounts the gym
  // whole, exactly as Schedule does it, and coming back re-reads the day so
  // the block shows its fresh stamp.
  if (gymDoor.opened) {
    // readLiveGym on the way out: the session that was just started (or
    // finished) is the one thing this branch can change about Today, and
    // Today is not remounting to find out.
    return <GymFlow door={gymDoor.opened} onBack={() => { gymDoor.close(); readLiveGym(); void reload(); }} />;
  }
  if (reportOpen) {
    return <ReportFlow onBack={() => { setReportOpen(false); void reload(); }} onOpenTask={(id) => { setReportOpen(false); void onOpenTask(id); }} />;
  }

  // GROUP B (items 10-11): the Now line and the gap offer, derived fresh
  // every render (and the minute tick keeps renders coming).
  const nowCtx = nowContext(todayEvents, blocked, nhm);
  // UP-CORE-08: the event happening right now, if it is an event and not a
  // protected routine range. The Now card's pill is its page.
  // UP-CORE-20: the next commitment, when it has a place. A block with no
  // location is not outdoors as far as this app knows, and guessing is how a
  // weather line ends up on a phone call.
  const nextOutdoor = todayEvents
    .filter((e) => !!e.data.location && minsOf(e.data.start) > nowMin)
    .sort((a, b) => a.data.start.localeCompare(b.data.start))[0] ?? null;
  const insideEvent = todayEvents.find((e) => {
    const s0 = minsOf(e.data.start);
    const e0 = e.data.end ? minsOf(e.data.end) : s0 + 60;
    return s0 <= nowMin && nowMin < e0;
  }) ?? null;
  // UP-MIND-24 (2026-09-05): the next event within three hours that involves
  // somebody in Contacts. Derived fresh, no AI call, and null on almost
  // every render, which is the normal case and shows nothing.
  const prep = meetingPrep(
    todayEvents.map((e) => ({
      id: e.id, title: e.data.title, date: e.data.date, start: e.data.start,
      ...(e.data.location ? { location: e.data.location } : {}),
      ...(e.data.attendees?.length ? { attendees: e.data.attendees } : {}),
    })),
    prepPeople,
    taskItems.map((t) => ({
      id: t.id, text: t.data.text, done: t.data.done, due: t.data.due ?? null,
      ...(t.data.personId ? { personId: t.data.personId } : {}),
    })),
    today,
    nowMin,
    (personId) => prepLast[personId] ?? null,
  );
  const gapKey = today + ":" + (nowCtx.nextStart ?? "end");
  // Pick 1 + pick 31: the goal this gap task moves, when naming it says
  // something the task title did not already say.
  // UP-CORE-14: the gap offer is a row inside the Now card rather than a
  // notice, so there is nothing to hold; the tuning still governs whether it
  // speaks, set from any other card or from What JARVIS Learned.
  const gapPick = evening || gapDismissed === gapKey || !tuned("gap-fill")
    ? null
    : gapFill(
        taskItems.map((t) => ({ id: t.id, text: t.data.text, category: t.data.category ?? "", done: t.data.done, due: t.data.due, bill: t.data.bill, reminder: t.data.reminder, estimateMin: t.data.estimateMin })),
        nowCtx.gapMin,
        today,
        (cat) => estimates[cat] ?? 45,
        // TODAY-F-20 (2026-09-05): the same season pause candidatesFor
        // applies, at the other door a task becomes work.
        pausedCats,
      );
  // C-24: the gap fill is DATA now, not a second offer. When the task the
  // ranker dealt is also the one that fits the open window, the headliner
  // says so in its own facts line ("Fits before Deep Work"); when it is not,
  // nothing anywhere claims it does. Nothing else reads gapPick.
  const movePlacement = moveTask && gapPick?.id === moveTask.id && nowCtx.nextTitle
    ? `Fits before ${nowCtx.nextTitle}`
    : null;
  // WHAT IT MOVES CAME OFF THE CARD (Dave 2026-09-21: "get rid of the blue
  // subtext in pic 1 idk what that is or why it's there"). It was "Moves
  // <goal>" in the reason slot, in sky, and it was the thing he photographed.
  // It is lineage: true, derived, and unreadable on a row whose job is to say
  // what to do next. The slot now carries the placement when there is one and
  // the estimate when there is not, both in the row's own ink.

  // Approved V2 anatomy (preview 2026-08-15): the free window reads as two
  // stat tiles (sky until, green open); inside an event the event tile leads;
  // the gap task carries its blue type tile and an accent Start.
  const shortSpan = (min: number): string => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h === 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  };
  // NOW, WHILE A SESSION RUNS (Dave 2026-09-19: "It should go in the now
  // section"). Now says what he is inside of, and a workout in progress is
  // that, before any gap or block: the day, the time left or the time in, what
  // is logged, and Resume as its one door. Same read as the Your Move row.
  const liveNow = liveGym && !gymDismissed && tuned("live-gym") ? liveCard(liveGym) : null;
  // THE SESSION'S FACTS, ONE GREY (§AK, §AM, 2026-09-26). Both render sites
  // joined currentLine, the clock and the count into one string, so the dots
  // were typed and every fact wore the same grey. The lift's name is the
  // line's one grey; the numbers drawn up for it, the clock and the count are
  // data with no state, so they step up to white (F1); a budget that has run
  // out is over its limit, which is the key's red. With no lift to name, the
  // line says nothing rather than repeat the day the title already says.
  // `clock` is the time left when a timer was set, else the time in; the
  // count rides after it on Now, and stands in for it on Your Move.
  //
  // THE SHORT FACTS FIRST, THE LONG ONE LAST (2026-09-26). The line's last
  // fact is the one .facts lets shrink and ellipsize; every fact before it
  // keeps its width. With the lift's name and its plan leading as two
  // unshrinking facts, "Romanian Deadlift" plus "3 × 225 lb × 5" beside
  // the Resume pill already overran the column, so the plan was cut
  // mid-letter with no ellipsis and the clock and the count never showed.
  // The clock and the count are a few characters each, so they lead; the
  // lift, name and plan together, is ONE final fact, the only one on the
  // line whose length the world decides, and the one allowed to yield.
  const liveFacts = (card: LiveCard, clock: string | null, count: string | null, cls = "facts") => (
    <div className={cls}>
      {clock && (clock === "Time's up"
        ? <span className="fact red">{clock}</span>
        : <span className="fact"><b>{clock}</b></span>)}
      {count && <span className="fact"><b>{count}</b></span>}
      {card.current && <span className="fact">{card.current.name}{card.current.plan && <> <b>{card.current.plan}</b></>}</span>}
    </div>
  );
  const nowSection = !evening && (
    <>
      <div className="pad-x"><div className="card">
        {liveNow ? (
          <div className="row" {...rowDoor(() => onRestoreSpot?.("gym", gymCatId ?? ""))}>
            <RowIcon kind="gym" />
            <div className="row-stack">
              <div className="conn-name truncate">In: {liveNow.dayName}</div>
              {/* THE LIFT YOU ARE ON IS ON THE LINE (2026-09-21). liveCard
                  has always computed it -- currentLine, "Bench Press · 3 ×
                  225 lb × 5", written, documented as "the one line the card
                  leads with", unit tested -- and NEITHER render site used
                  it. The comment on the notice card below even says the card
                  reads "the exercise it is on WITH its numbers". It did not.
                  So while a workout was running, Today told you the day, the
                  minutes and the set count, and never the one fact you would
                  pick up the phone for. */}
              {liveFacts(liveNow, liveNow.left ?? liveNow.elapsed, liveNow.progress, "conn-meta facts")}
            </div>
            <button className="pill-act pill-go" onClick={own(() => onRestoreSpot?.("gym", gymCatId ?? ""))}>Resume</button>
          </div>
        ) : nowCtx.gapMin !== null && nowCtx.nextStart ? (
          // THE RAIL (Dave's pick C, 2026-08-22, replacing the green ring:
          // "doesn't look good"). Now and the next fixed thing, joined by the
          // same left-rail language the Schedule speaks; the gap is the space
          // between them, which is what a gap is. No meter: a ring at 9h 26m
          // of a 9h 30m gap was a full circle saying nothing.
          // ONE LINE, NOT A RAIL (Dave 2026-08-25: "The now display in the
          // schedule is currently way too vertical"). Measured on his
          // screenshot, Now ran about 510px before The Rest of Today began,
          // on an 844px screen.
          //
          // The rail spent four stacked lines and a drawn connector saying
          // two things: how much time is open, and what ends it. Both fit on
          // one line, and the drawing was illustrating a relationship nobody
          // was confused about. The aria-label was already the sentence this
          // now says out loud, which is the tell that the sentence was the
          // real content all along.
          <>
          {/* ONE ROW WHEN THERE IS ONE FACT (Dave 2026-09-11: "'Now' has a
              visual bug. Everything is out of alignment and wrapping for no
              reason").
              With nothing teed up, this card drew .now-line-one -- its own
              padded, baseline-aligned, nowrap line -- and then a SECOND full
              .row underneath holding nothing but Pick Something pushed right
              by margin-left:auto. The fact used one grid and the action used
              another, the pill hung under empty space, and "35m open / until
              Gym 11:00 AM" sat on a baseline the rest of the card does not
              use. That is the same defect the inside-a-block branch below
              already fixed in August ("the style looks awful. It's also extra
              vertical for no reason"); this branch never got the treatment.
              .now-line-one stays for the case it was written for -- a header
              ABOVE a suggestion -- where it really is a line of its own. */}
          {/* The header line above the suggestion went with the suggestion
              (C-24): the row below says the same two facts, on the one grid
              this card uses, with the outdoor line under them. */}
          {(
            // C-24 (Astra, 2026-09-12): NOW STOPPED DEALING ITS OWN TASK.
            //
            // This card used to draw a second task pick, with its own Start,
            // its own swipe and its own reason line, a few hundred pixels
            // under Your Move's. Two surfaces on one screen each offering
            // "the thing to do next", chosen by different derivations, is the
            // repetition this page keeps having to remove; the headliner is
            // where that offer lives now. The gap fill still exists as data
            // (nowContext.ts) and still feeds what the headliner can say
            // about fitting the gap. Now says what he is inside of, or how
            // much is open and until when, and hands over one door.
            // NO DEAD ENDS IN NOW (Dave 2026-08-19, "the more I can do without
            // thinking, the better"): when nothing is teed up, Now still hands
            // him the one-tap way in instead of stating the time and stopping.
            // ...on ONE row with the fact it belongs to (Dave 2026-09-11).
            // ROW-TAP (Dave 2026-09-15: "I want all rows clickable"): the row
            // is the open window, and filling it is its one verb, so the
            // whole line opens the same picker the pill does.
            <div className="row" {...rowDoor(() => setUpNextOpen(true))}>
              <RowIcon kind="event" />
              <div className="row-stack">
                <div className="conn-name truncate">{shortSpan(nowCtx.gapMin)} open</div>
                {/* §AM F5 (2026-09-26): when the window ends is a neutral
                    time, so it is small caps, the same "Until" the in-a-block
                    row below says; what ends it is the line's one grey.
                    The pair is the row's point, so it is the wrapping,
                    unclamped meta line (2026-09-26): on one line at type
                    scale 1.4 the title was left its dot and an ellipsis,
                    and the row no longer said what ends the window. */}
                <div className="conn-meta">
                  <span className="fact date">Until {fmtTime(nowCtx.nextStart).time} {fmtTime(nowCtx.nextStart).ap}</span>
                  <span className="fact">{nowCtx.nextTitle ?? "Your next event"}</span>
                </div>
                {nextOutdoor && <EventWeatherLine dateIso={today} start={nextOutdoor.data.start} />}
              </div>
              {/* MERGE B: Plan My Day used to sit here as well as in the
                  day's own button row a few hundred pixels below, which is
                  the same verb twice in one section. This card is about the
                  next few minutes; planning the day belongs to the day. */}
              <button className="pill-act" onClick={own(() => setUpNextOpen(true))}>Focus</button>
            </div>
          )}
          </>
        ) : (
          // INSIDE A NAMED BLOCK, OR NOTHING LEFT TODAY (2026-08-26, off a
          // screenshot of "In: Deep Work" / "until 5 PM" stacked over a
          // second row holding nothing but Pick Something: "the style looks
          // awful. It's also extra vertical for no reason and doesn't
          // assist the user with an action.")
          //
          // gapMin is null in both cases nowContext ever returns it null
          // for (inside a slot, or "Clear from here" with nothing left) --
          // gapFill's very first check bails on a null gapMin -- so gapPick
          // was ALWAYS null down here and that second row was NEVER
          // anything but Pick Something floating under a divider with
          // nothing beside it to connect it to. Two rows saying "you're in
          // Deep Work" and here's a thing to do, when the gap-task row two
          // cases up already proves one row can hold a title, a time, and a
          // pill together. Same anatomy, so the action reads as attached to
          // the fact instead of floating under it.
          // ROW-TAP (Dave 2026-09-15: "I want all rows clickable"): inside
          // an event the row opens that event; otherwise it opens the picker.
          <div className="row" {...rowDoor(() => { if (insideEvent) onOpenEvent(insideEvent.id); else setUpNextOpen(true); })}>
            <RowIcon kind="event" />
            {/* THE PRODUCER SAYS THE TWO HALVES (Dave 2026-09-11: "title case
                isn't being applied in the subtext in the now pill. 'until'
                should be capitalized"). This used to find the split itself
                with lastIndexOf(" until ") and print the tail verbatim, so a
                mid-sentence "until" became the first word of its own line in
                lowercase. nowContext hands over `head` and `tail` now, each
                already written as the line it is. */}
            <div className="row-stack">
              <div className="conn-name truncate">{nowCtx.head}</div>
              {/* §AM F5 (2026-09-26): the tail here is "Until 7:00 PM", a
                  neutral time stated as the row's fact, so it is small caps. */}
              {nowCtx.tail && <div className="conn-meta facts"><span className="fact date">{nowCtx.tail}</span></div>}
            </div>
            {/* UP-CORE-08 (2026-09-05): INSIDE A MEETING, THE PILL IS ITS
                PAGE. An exec pays for walking into the 2 PM with a page
                titled and linked, and this card is the one surface that
                knows which meeting he is in. One pill, not two: the title,
                the time and a verb already fill the row, and while you are
                IN a thing, its page beats a menu of other things. A routine
                block is not a meeting and keeps Pick Something. */}
            {/* UP-CORE-10 (2026-09-05): JOIN BEATS EVERYTHING while you are
                inside a meeting that has a link: being in the call is the
                thing, and the page for it is one row away on the schedule. */}
            {/* 2026-09-15 (Dave: "do the buttons really have any value to the
                user"). THE THIRD DOOR TO THE SAME DECK IS GONE. Pick
                Something here opened setUpNextOpen -- the identical sheet
                the Focus pill at the top of Your Move opens, and the
                identical sheet Pick Something opens from the OPEN-GAP row a
                few cases up. Three controls, three labels, one destination.
                The gap row keeps its copy, because open time is exactly the
                moment "pick something" is the answer. In here it is not: he
                is already inside Deep Work, and a verb offering him a
                different thing to do is the block arguing with itself. Join
                and Notes stay, because those act on the block he is in. With
                neither, the row states the fact and stops. */}
            {insideEvent?.data.url ? (
              <a className="pill-act" href={insideEvent.data.url} target="_blank" rel="noreferrer" onClick={own()}>Join</a>
            ) : null}
          </div>
        )}
        {/* UP-MIND-24 (2026-09-05): the next meeting with somebody the app
            knows, and what is already between you. Facts only: what is
            open and when you last wrote, never advice about it. Both taps
            are ones the user would otherwise make by hand. */}
        {prep && (
          // ROW-TAP (Dave 2026-09-15: "I want all rows clickable"): the row
          // is about the person you are about to meet, so it opens them.
          <div className="row" {...rowDoor(() => void (onOpenPerson ?? onAskSaid)?.(prep.person.id))}>
            <RowIcon kind="event" />
            <div className="row-stack">
              {/* THE NAME IS THE TITLE; THE FACTS GO UNDER IT (§AK, §AM,
                  2026-09-26). meetingPrep used to join the name, the count
                  and the last mail with typed dots, so the facts truncated
                  with the title and wore its ink. It hands over the parts
                  now: the count is white (a count with no state), "with
                  them" is the line's one grey, and the last mail is a
                  neutral date, so it is small caps. Its words were read on
                  meetingPrep's own clock, so nothing here reads a second. */}
              <div className="conn-name truncate">{prep.person.name}</div>
              {(prep.open.length > 0 || prep.lastMail) ? (
                <div className="conn-meta facts">
                  {prep.open.length > 0 && <span className="fact"><b>{capAfterNumber(`${prep.open.length} open`)}</b> with them</span>}
                  {prep.lastMail ? <span className="fact date">{prep.lastMail}</span> : null}
                </div>
              ) : null}
              {/* row-tap: chip strip inside the prep row, not a row of its own */}
              <div className="row mail-chips">
                {prep.open.length > 0 && (
                  <button className="chip" onClick={own(() => void onOpenPerson?.(prep.person.id))}>What's Open</button>
                )}
                <button className="chip" onClick={own(() => void onAskSaid?.(prep.person.id))}>What Did You Say</button>
              </div>
            </div>
          </div>
        )}
      </div></div>
    </>
  );

  // The Day Loop card: the whole day, drafted, one Accept. Purple spark: a
  // JARVIS-made proposal, not yet the user's plan.
  // ONE SCHEDULE ON TODAY (blend, 2026-08-22). Dave: "what's the point of
  // having two different schedule formats on the home page?" None, and the
  // drafted card was the wrong half to keep. The proposal is penciled into
  // Your Day among the real rows now (see ProposedRow); what survives here
  // is the one decision it asks for, drawn under the day.
  // SCHEDULE AUDIT 2026-08-29: the card renders and commits the LIVE view of
  // its blocks, not the cache. A task the day already answered (a committed
  // event carries its sourceTaskId -- Start Fifteen, a sheet commit on the
  // Schedule tab), or that is done or gone since the draft was cut, drops
  // here. Same checkpoint the Schedule tab uses, so the two surfaces cannot
  // tell different stories about one draft. See liveBlocks() in dayLoop.
  const liveDraftBlocks = !evening && dayDraft && !dayDraft.accepted && !dayDraft.dismissed
    ? liveBlocks(dayDraft.blocks, todayEvents, taskItems) : [];
  const draftStanding = dayDraft !== null && liveDraftBlocks.length > 0;

  const proposedDay = draftStanding ? {
    blocks: liveDraftBlocks,
    openId: tuning,
    onToggle: (id: string) => setTuning((t) => (t === id ? null : id)),
    onDuration: (id: string, minutes: number) => applyEdit({ minutes: { [id]: minutes } }),
    onDrop: (id: string) => { setTuning(null); applyEdit({ drop: id }); },
    // 2026-09-15 (Dave: "you can't even clear it if you've completed it").
    // A planned task is a task. It ticks off from the day that planned it,
    // through the same door every other completion on this page uses, so the
    // momentum chain and the burst behave exactly as they do elsewhere.
    onComplete: (id: string) => void onToggleTask(id),
    onOpen: (id: string) => void onOpenTask(id),
    // TAKE ONE BLOCK, NOT THE WHOLE DAY (button audit 2026-09-16; Dave: "add
    // it to Today"). The type has carried this since C-32 and only the
    // Schedule tab implemented it, so Today's only answer to a draft was all
    // of it or none. Same write the whole-day Accept makes, for one block,
    // and the block leaves the draft on its own: liveBlocks drops any block
    // whose task now has an event carrying its id, which is the checkpoint
    // both surfaces already share.
    onAccept: (id: string) => void acceptOneBlock(id),
  } : undefined;

  const acceptOneBlock = async (taskId: string) => {
    const b = liveDraftBlocks.find((x) => x.taskId === taskId);
    if (!b || acceptingOne.current) return;
    acceptingOne.current = true;
    try {
      let ids: string[] = [];
      const ok = await attemptWrite(async () => {
        ids = (await schedule.commitPlan(today, [{
          taskId: b.taskId, text: b.text, category: b.category, start: b.start, end: b.end,
        }], undefined, { picks: [b.taskId] })).created;
      });
      if (!ok) return;
      setTuning(null);
      await reload();
      showToast({
        message: "Booked " + fmtTime(b.start).time + fmtTime(b.start).ap,
        actionLabel: "Undo",
        onAction: async () => {
          await attemptWrite(async () => { for (const id of ids) await schedule.deleteEvent(id); });
          await reload();
        },
      });
    } finally {
      acceptingOne.current = false;
    }
  };

  const draftFooter = draftStanding ? (
    <>
      {dayDraft.anytime.length > 0 && (
        <>
          {/* THE FOLD THE APP ALREADY HAS (Dave 2026-09-11: "put 6 more anytime
              in a more appropriate place that follows the formatting and
              styling rules. It doesn't seem to be"). It was .draft-more: a
              red, --t-meta, left-aligned link on its own bare .row, floating
              under the card with the page's own column nowhere near it. Every
              other folded pile in this app -- "13 More waiting", "4 More
              Emails in Your Inbox", the done-projects receipt -- is a
              .receipt-line, which is the quiet caps row with the chevron on
              the right, and it sits at the foot of the thing it folds. Same
              control, same behaviour, the house shape. */}
          <button className="receipt-line" aria-expanded={draftMoreOpen} onClick={() => setDraftMoreOpen((o) => !o)}>
            <span className="rl-t">{capAfterNumber(`${dayDraft.anytime.length} More in Anytime`)}</span>
            <div className={"chev chev-down" + (draftMoreOpen ? " chev-open" : "")} />
          </button>
          {draftMoreOpen && dayDraft.anytime.map((a) => (
            // ROW-TAP (Dave 2026-09-15): the row is a task; it opens the task.
            <div className="row" key={a.id} {...rowDoor(() => void onOpenTask(a.id))}>
              <RowIcon kind="task" />
              <div className="row-grow"><div className="conn-name truncate">{a.text}</div></div>
              <button className="pill-act" onClick={own(() => applyEdit({ add: a.id }))}>Add</button>
            </div>
          ))}
        </>
      )}
      {/* FOUR FLOATING BUTTONS BECAME ONE ROW (Dave 2026-09-10 and 09-11).
          The bottom of Today had accumulated Focus, Plan My Day, Accept the
          Day and Not Today, on two different grids, none of them the page's
          own column. Focus went to Your Move as a centred pill; Accept moved
          UP into Plan My Day's row (draftPrimary below, YourDay's `primary`
          slot) so the two decisions about the day sit side by side instead of
          two sections apart. This is the quiet decline under them: clearing a
          draft has to stay reachable, because Plan My Day stands its AI
          refine down while a draft is standing, on purpose ("the card already
          showed him a plan; re-plan must not silently renumber it"). Same
          .receipt-line every quiet secondary in this app wears. */}
      {/* IT SAYS WHAT IT DECLINES (Dave 2026-09-19, on the homepage: two
          grey lines at the foot of the day, the second of them two words
          that name no object). "Not Today" answers a question the page
          stopped asking three sections ago; what the tap actually does is
          clear the plan standing above it. */}
      <button className="receipt-line" onClick={dismissDraft}>
        <span className="rl-t">Clear This Plan</span>
      </button>
    </>
  ) : null;

  // ACCEPT SITS BESIDE PLAN MY DAY (Dave 2026-09-11). Handed to YourDay as its
  // `primary` so it shares that row; it keeps the fill, because committing
  // every hour of the day is the bigger of the two moves on it.
  const draftPrimary = draftStanding ? (
    <button className="plan-cta plan-cta-block" onClick={() => void acceptDraft()}>Accept the Day</button>
  ) : null;

  // C-29 (Astra, 2026-09-12): once the day is accepted, the draft's own
  // receipt says so, where the Accept and Not Today used to sit. A quiet
  // line, not a control: the blocks are real events in the list above it
  // now, and there is nothing left to decide. No new lifecycle field:
  // `accepted` has been on the draft since the Day Loop shipped.
  const draftReceipt = !evening && dayDraft?.accepted && !dayDraft.dismissed && planEvs.length > 0 ? (
    <div className="receipt-line" aria-label={`Accepted, ${planEvs.length} ${planEvs.length === 1 ? "block" : "blocks"} planned`}>
      {/* One phrase, no typed dot (§AM F3, 2026-09-26): the count leads,
          the way every other receipt here reads. */}
      <span className="rl-t">{capAfterNumber(`${planEvs.length} ${planEvs.length === 1 ? "block" : "blocks"} accepted`)}</span>
    </div>
  ) : null;

  // Slippage stated out loud below Everything; automatic (receipted) at it.
  // TODAY-F-19 (2026-09-05): keyed, like every sibling in the notice stream.
  // These two went in unkeyed, so React matched them by position: when the
  // overflow card appeared or the ranking shifted, NoticeCard's own expanded
  // and swipe-offset state stayed with the slot and jumped onto whichever
  // card landed there.
  const reflowSection = !evening && !reflowHidden && dayDraft?.accepted && slippedCount > 0 && effectiveLevel(getAIControl()) !== "everything" && (
    <NoticeCard
      key="reflow"
      weight={WAITING}
      icon={SWEEP_ICO}
      tone="cat-fg-orange"
      title={slippedCount === 1 ? "1 Block Slipped" : `${slippedCount} Blocks Slipped`}
      sub="The plan is behind the clock"
      action={{ label: "Re-Flow", onClick: () => void runReflow() }}
      // ROW-TAP (Dave 2026-09-15: "I want all rows clickable"): the card is
      // about the day's plan, so its body opens the Schedule that holds it.
      onOpen={onGoSchedule}
      // Keying it revealed that it had no way out at all (the every-notice-
      // can-be-dismissed law only ever saw keyed cards). Waving it off is
      // this visit's UI state only, exactly like the live-gym card: the plan
      // really is behind the clock either way, so a stored silence would be
      // the app hiding a fact from him for the rest of the day.
      onDismiss={() => setReflowHidden(true)}
    />
  );

  const overflowSection = overflowOffer && (
    <NoticeCard
      key="overflow"
      weight={FAILING}
      icon={SWEEP_ICO}
      tone="cat-fg-orange"
      title={overflowOffer.title}
      sub="No room left today"
      // ROW-TAP (Dave 2026-09-15): the body opens the event that has no room.
      onOpen={() => onOpenEvent(overflowOffer.eventId)}
      // Leaving it where it is IS the dismissal, so it rides the swipe under
      // the standard word and the visible control is the offer the card
      // exists to make. Before this the one visible verb was "Leave", which
      // is the button for doing nothing.
      onDismiss={() => setOverflowOffer(null)}
      action={{
        label: "Set Aside",
        onClick: () => void (async () => {
          const ev = todayEvents.find((e) => e.id === overflowOffer.eventId);
          const taskId = ev?.data.sourceTaskId;
          const ok = await attemptWrite(async () => {
            await schedule.deleteEvent(overflowOffer.eventId);
            if (taskId) await tasks.setAside([taskId]);
          });
          setOverflowOffer(null);
          await reload();
          if (ok) showToast({ message: "Set aside · Keeps its place" });
        })(),
      }}
    />
  );

  // Revisit Day handlers (Screen 07). Still Good stamps a confirmed date and
  // clears the card, with undo. Change It opens the capture sheet prefilled
  // as a replacement, which lands on the supersede chain.
  // C-55 (Astra, 2026-09-12): the revisit notice can also say how it turned
  // out. Worked and Mixed answer the revisit (the call held, in its way) and
  // clear the card; Didn't keeps the card and offers Change It, which is the
  // supersede path. Expiry rule unchanged.
  const markRevisitOutcome = async (rec: DecisionRecord, word: OutcomeWord) => {
    const ok = await attemptWrite(() => decisionsSvc.markOutcome(rec.id, word));
    if (!ok) return;
    if (word === "didnt") { showToast({ message: "Outcome · Didn't", actionLabel: "Change It", onAction: () => setRevisitSheet(true) }); return; }
    await attemptWrite(() => decisionsSvc.confirmRevisit(rec.id));
    setRevisit(null);
    showToast({ message: "Outcome · " + OUTCOME_LABEL[word] });
  };
  const stillGood = async (rec: DecisionRecord) => {
    const ok = await attemptWrite(() => decisionsSvc.confirmRevisit(rec.id));
    setRevisit(null);
    if (ok) showToast({ message: "Kept, revisit cleared", actionLabel: "Undo", onAction: () => void (async () => {
      await attemptWrite(() => decisionsSvc.unconfirmRevisit(rec.id));
      await loadRevisit();
    })() });
  };
  const decisionAttachOptions: AttachOption[] = [
    ...projList.filter((p) => p.data.status !== "done").map((p) => ({ type: "project" as const, id: p.id, label: p.data.title })),
    ...goalList.filter((g) => g.data.state !== "achieved").map((g) => ({ type: "goal" as const, id: g.id, label: g.data.title })),
    ...catsFull.filter((c) => effectiveKind(c.data) === "org").map((c) => ({ type: "org" as const, id: c.id, label: c.data.name })),
  ];

  // CATALOG V4 L (page order, Dave 2026-08-18 "the landing page is chaos"):
  // alerts render in ONE fixed priority order and at most TWO show per open.
  // The rest wait for the next open; every card is also actionable away.
  // Order: revisit > failed sweep > sweep receipt > where-you-were.
  const DOC_ICO = (
    <DocGlyph />
  );
  // E1 · DESIGNING FOR THE RETURN (2026-08-20). You will stop using this for
  // two weeks at some point; everyone does. The apps that punish you for it
  // are the ones you never open again. No count of the pile, what is still
  // true, and one thing to start with.
  //
  // B4 (2026-09-04): the sweep's moved list is the PILE, not the good news.
  // It is every overdue task the sweep just pushed onto today, still sitting
  // there undone underneath this very card. Passing its length as "aged out"
  // said the opposite of what welcomeBack's own design law demands: it read
  // "N things aged out on their own" over tasks that had done no such thing.
  // There is no signal yet for tasks that genuinely resolved themselves while
  // away, so 0 (the honest, already-supported "Nothing was lost" case) is the
  // correct value until one exists. Building that signal is a real feature,
  // not a bug fix.
  const back = welcomeBack(lastSeenRef.current, today, 0);
  // Which task Your Move is already showing on its own. The dealt row is
  // evening-gated in TodayPage (`!evening ? upNext?.[0] : undefined`), so
  // this mirrors that gate: in the evening there is no dealt row, and the
  // Resume offer is then the only mention of the task and must stand.
  const dealtTaskId = evening ? undefined : upNextRows[0]?.id;
  const slideTaskId = sweepCand && sweepCand.slips >= 3 && !planned.has(sweepCand.id) ? sweepCand.id : undefined;
  // S5-Q31: a live session names no category of its own (a Program is
  // category-agnostic), so the tap target is whichever area the Brain
  // renders gym UI for -- any category CategoryDetail resolves to "health".
  const gymCatId = catsFull.find((c) => effectiveKind(c.data) === "health")?.id;
  // UP-PLAT-26 (2026-09-06): liveGymShown is the exact condition the
  // live-session card below renders on, read once so the two can never
  // disagree about whether that card is on screen. The tuning gate is part
  // of that condition: a live-gym card tuned off is not on screen, and the
  // Where You Were row is then the only offer to get back to the session,
  // so it must stand rather than be suppressed as a duplicate of nothing.
  // 2026-09-14: the category gate came OFF the render condition. A live
  // session is a fact about the athlete, not about whether a category in
  // their Brain happens to resolve to "health" -- and gating the card on one
  // meant a real workout in progress was invisible for a reason that has
  // nothing to do with the workout. The category is still what Resume needs
  // to land IN the session, so it gates the ACTION, not the card: without
  // one, the card still says a session is running and opens the Brain.
  const liveGymShown = !!(liveGym && !gymDismissed && tuned("live-gym"));
  const spotAlreadyShown = spotIsDuplicate(spot, { dealtTaskId, slideTaskId, liveGymShown });
  // THE SESSION LEADS YOUR MOVE, AS ONE ROW (Dave 2026-09-19: "I want the Home
  // Screen to render something whenever the user starts a workout ... a resume
  // button up top with the time left in the workout if there's a timer set").
  // The card built on 2026-09-14 rode the ranked stream, where it rowed down
  // to one line under the dealt task. It leaves the stream and takes the head
  // of the Your Move card: the day, the time left (or the time in), Resume.
  // The plan itself was too much for the home page (his words, off a rendered
  // comparison) and stays in the session. Same weight declared, same tuning,
  // same dismiss; only where it stands and how much it says changed. Now
  // carries the same session below (see nowSection).
  const liveGymHead = liveGymShown ? (() => {
      // WHAT HE DREW UP, ON TODAY (2026-09-14). The card used to say the day
      // and the name of the exercise on screen -- a bookmark. The plan has
      // been sitting on the live session the whole time (copied in at start),
      // so the card reads it: the day, how long it has been going, how much
      // is logged, the exercise it is on WITH its numbers, and the rest of
      // the plan under it.
      const card = liveCard(liveGym);
      return (
        <NoticeCard
          key="live-gym"
          {...tuneProps("live-gym", "Back to " + card.dayName)}
          weight={tuningWeight(tunings, "live-gym", LIVE)}
          icon={<BarbellGlyph />}
          tone="cat-fg-orange"
          title={card.fresh ? `${card.dayName} is ready` : `Back to ${card.dayName}`}
          sub={liveFacts(card, card.left ?? card.elapsed, (card.left ?? card.elapsed) ? null : card.progress)}
          action={{ label: card.fresh ? "Start" : "Resume", go: true, onClick: () => onRestoreSpot?.("gym", gymCatId ?? "") }}
          // ROW-TAP (Dave 2026-09-15: "I want all rows clickable"): the body
          // opens the session, like the pill.
          onOpen={() => onRestoreSpot?.("gym", gymCatId ?? "")}
          onDismiss={() => setGymDismissed(true)}
        />
      );
  })() : null;
  const alertCards = [
    // The welcome-back recap is a RECEIPT: it reports, it does not ask.
    // One quiet line; tapping it opens the pile it describes.
    // ONE SENTENCE, NO TYPED DOTS (§AM F3, 2026-09-26). welcomeBack hands
    // over its parts and this writes them as sentences: the greeting, what
    // aged out when anything did (agedOut is 0 today, see above, so it is
    // null and says nothing), and the one thing to start with.
    back ? (
      <button key="back" data-receipt className="receipt-line" onClick={() => setUpNextOpen(true)}>
        <span className="rl-t">{back.title}. {back.gone ? back.gone + ". " : ""}{back.ask}</span>
        <span className="chev" />
      </button>
    ) : null,
    revisit ? (
      <NoticeCard
        key="revisit"
        weight={WAITING}
        icon={FORK_ICO}
        tone="cat-fg-purple"
        title={revisit.data.decision}
        sub="You wanted to revisit this today"
        action={{ label: "Keep", onClick: () => void stillGood(revisit) }}
        alt={{ label: "Change It", onClick: () => setRevisitSheet(true) }}
        // ROW-TAP (Dave 2026-09-15): the body opens the decision's sheet.
        onOpen={() => setRevisitSheet(true)}
        foot={(
          <div className="dec-outcome-acts notice-foot-acts">
            {(["worked", "mixed", "didnt"] as OutcomeWord[]).map((w) => (
              <button type="button" key={w} className="pill-act" onClick={() => void markRevisitOutcome(revisit, w)}>{OUTCOME_LABEL[w]}</button>
            ))}
          </div>
        )}
      />
    ) : null,
    sweepReceipt && sweepReceipt.failed ? (
      <NoticeCard
        key="sweepfail"
        weight={FAILING}
        icon={SWEEP_ICO}
        tone="cat-fg-red"
        title="Couldn't Move Yesterday's Tasks"
        // One grey (§AK, 2026-09-26): "Try again" came off, because the
        // Retry pill beside it says it and does it.
        sub="Nothing was lost"
        // ROW-TAP (Dave 2026-09-15): nothing to open, so the body retries,
        // the same safe verb as the pill.
        onOpen={() => void (async () => { setSweepReceipt(await retrySweep(tasks, today)); await reload(); })()}
        action={{
          label: "Retry",
          onClick: () => void (async () => { setSweepReceipt(await retrySweep(tasks, today)); await reload(); })(),
        }}
      />
    ) : null,
    sweepReceipt && !sweepReceipt.failed && unplannedMoved.length > 0 && !sweepCardDismissed(today) && tuned("sweep-receipt") ? (
      <NoticeCard
        key="sweep"
        {...tuneProps("sweep-receipt", capAfterNumber(`${unplannedMoved.length} moved to today`))}
        weight={tuningWeight(tunings, "sweep-receipt", NEW)}
        icon={SWEEP_ICO}
        tone="cat-fg-orange"
        // The count is of what still needs a time, not of what moved: the
        // plan card above already holds the rest, and "5 Moved to Today"
        // beside a card that has timed four of them is a false alarm.
        title={unplannedMoved.length === 1 ? "1 Moved to Today" : `${unplannedMoved.length} Moved to Today`}
        // 2026-09-15: THE SECOND PLANNING DOOR IS GONE (Dave: "do the buttons
        // really have any value to the user"). This pill and Plan My Day at
        // the foot of the day were the identical call -- openPlan("today") --
        // about eight hundred pixels apart, so the page asked the same
        // question twice and answered it the same way. Plan My Day is the one
        // door. This card goes back to being what its words say it is, a
        // receipt that five things arrived, and the row-tap below already
        // shows you the five. Set Aside keeps the swipe, where every notice's
        // second path lives.
        // ROW-TAP (Dave 2026-09-15: "I want all rows clickable"): the body
        // opens Tasks, where the moved tasks are.
        onOpen={onGoTasks}
        alt={sweepCand && !planned.has(sweepCand.id) ? {
          label: "Set Aside",
          onClick: () => void (async () => {
            markOffered(sweepCand.id, today);
            const ok = await attemptWrite(() => tasks.setAside([sweepCand.id]));
            setSweepReceipt(readReceipt(today));
            await reload();
            if (ok) showToast({ message: "Set aside · Keeps its place", actionLabel: "Undo", onAction: async () => { await attemptWrite(() => tasks.restoreAside([sweepCand.id])); await reload(); } });
          })(),
        } : undefined}
        // LAW 2: DISMISS MEANS ONLY DISMISS (Dave 2026-08-29). This used to
        // run undoSweep -- a swipe labelled "Dismiss" that silently rewrote
        // every moved task's due date back to yesterday, emptying Today of
        // work he had already seen arrive. Undoing the sweep is a real and
        // occasionally wanted action, but it has to be asked for by name, so
        // it now rides the toast below under its own words. Dismissing hides
        // the card and touches nothing.
        onDismiss={() => {
          dismissSweepCard(today);
          setSweepDismissTick((n) => n + 1);
          showToast({
            message: "Hidden for today",
            actionLabel: "Undo the Move",
            onAction: async () => {
              if (!sweepReceipt) return;
              await attemptWrite(() => undoSweep(tasks, sweepReceipt));
              setSweepReceipt(null);
              await reload();
            },
          });
        }}
      />
    ) : null,
    // THE FIVE-DAY SLIDE (2026-08-21). A task that has moved three days
    // running is not being avoided out of laziness: it is too vague or too
    // big to start, which is what Break It Down exists for (catalog O.10).
    //
    // LAW 3, ONE VERB, AND IT IS "OPEN THE THING" (Dave 2026-08-29). The
    // card used to fire Break It Down directly: a heavyweight AI operation,
    // launched from a one-line row he reads in about a second, that silently
    // replaces the task with several new ones. That is not a glance
    // decision, and offering it here also meant the only two answers this
    // card accepted were "rewrite it with AI" or "never mention it again".
    //
    // Now the card states the fact and opens the task. Break It Down is the
    // second button in the sheet that opens, alongside Add to Schedule,
    // rename, re-date and delete -- the full set of honest answers to a task
    // that keeps sliding, in the one place that has the context to choose
    // between them. No longer gated on the AI either: the fact that
    // something has slid three days is worth saying whether or not a model
    // is available to reword it.
    sweepCand && sweepCand.slips >= 3 && !planned.has(sweepCand.id) ? (
      <NoticeCard
        key="slide"
        weight={FAILING}
        icon={SWEEP_ICO}
        tone="cat-fg-orange"
        title={sweepCand.text}
        sub={`Slid ${sweepCand.slips}d`}
        // 2026-09-15: THE DIAGNOSIS CARRIES ITS OWN REMEDY (Dave: "if they're
        // not going to give real, real value, then we have to adjust them or
        // get rid of some of them").
        //
        // This card's whole argument, written into it in August, is that "a
        // task that has slid five days running is not a discipline failure;
        // it is a task whose first step was never obvious" -- and the only
        // thing it offered was a tap to go look at it. It named a count of
        // failures and handed over nothing to do about it. Break It Down is
        // the move that argument points at, it already exists on this flow,
        // and it is one line from here.
        //
        // Offered only when a model is actually reachable: a button that
        // needs the AI and cannot have it is the exact shape this pass is
        // removing everywhere else. Without one the row still opens the task,
        // which is what it has always done.
        // 2026-09-17 (Dave): no Break It Down, and no verb at all: the row
        // opens the task, and the email band owns anything that came from mail.
        onOpen={() => { markOffered(sweepCand.id, today); void onOpenTask(sweepCand.id); }}
        // Quiet for DISMISS_DAYS, not forever: the old markOffered list had
        // no expiry, so one dismissal meant this task could never be flagged
        // again however long it kept sliding (Law 2).
        onDismiss={() => { markOffered(sweepCand.id, today); setSweepDismissTick((n) => n + 1); }}
      />
    ) : null,
    // ONE THING, ONE ROW (Dave 2026-08-30, from a screenshot of Your Move
    // holding "Clean out closet" twice: "same tasks are showing in your
    // move").
    //
    // The spot is a bookmark and can point at ANY entity, including one this
    // section is already showing for its own reasons. Open a task, come back
    // four hours later, and if the ranker also deals that same task you get
    // it twice in the same stream, wearing two different verbs: Start on the
    // dealt row and Resume here. Two rows, one task, and a reader has to
    // work out they are the same thing before deciding which button is the
    // real one.
    //
    // The dealt row wins where they collide. It is the section's anchor and
    // it carries more: the completion circle, the urgency chip, and the
    // reason the ranker chose it, against this card's one age line. Nothing
    // is destroyed -- the bookmark still stands, it just is not offered as a
    // second row while the same task is already the headline move.
    //
    // The slide card is checked for the same reason: it also names a task by
    // title, so it can collide the same way.
    spot && !spotAlreadyShown ? (
      <NoticeCard
        key="spot"
        weight={RESUME}
        icon={DOC_ICO}
        tone="cat-fg-yellow"
        title={spot.label}
        sub={spotAgo(spot)}
        action={{ label: "Resume", onClick: () => { clearSpot(); setSpot(null); onRestoreSpot?.(spot.kind, spot.id); } }}
        // ROW-TAP (Dave 2026-09-15): the body opens the bookmarked thing too.
        onOpen={() => { clearSpot(); setSpot(null); onRestoreSpot?.(spot.kind, spot.id); }}
        // LAW 2: this card had no dismiss at all -- its swipe rail was
        // empty, so the only exits were taking it or waiting out twelve
        // hours, and every visit longer than five minutes ago re-armed it.
        onDismiss={() => { dismissSpot(spot); setSpot(null); }}
      />
    ) : null,
    // S5-Q31: unconditional, unlike the spot card above -- no five-minute
    // gap to clear, no hiding itself once he is "active" elsewhere. It is
    // just true or not true, read straight off the live session, and gone
    // on its own the moment the session ends or goes stale.
    // PICK 2: A FINISHED THING SURFACES WHERE HE IS (Dave 2026-08-22). Wave 1
    // taught the Bigger Picture to offer Close It on a project whose work is
    // done. That only helps on a page he has no reason to open, and the whole
    // complaint was that the bigger picture is invisible. The last tick of
    // the last task IS the moment; it happens here, so the offer belongs
    // here. One at a time, and it disappears the instant it is taken.
    finishedProject && tuned("close-offer") ? (
      <NoticeCard
        key="finished"
        {...tuneProps("close-offer", finishedProject.project.data.title)}
        weight={tuningWeight(tunings, "close-offer", NEW)}
        icon={WIN_ICO}
        tone="cat-fg-green"
        title={finishedProject.project.data.title}
        sub={capAfterNumber(`All ${finishedProject.progress?.total ?? 0} done`)}
        // 2026-09-17 (Dave): every task done is a question, not a verdict.
        // Wrap Up asks: add more tasks, or finish the project.
        action={{ label: "Wrap Up", onClick: () => setWrapUp(finishedProject.project.id) }}
        // ROW-TAP (Dave 2026-09-15: "I want all rows clickable"): the body
        // opens the project; closing it stays on the pill.
        onOpen={onOpenProject ? () => onOpenProject(finishedProject.project.id) : undefined}
        // LAW 2 (2026-08-29): "every task in it is finished" is not the same
        // claim as "the project is over", and a project he is deliberately
        // keeping open had no way to say so -- the card returned every day
        // until he closed something he did not want closed. Quiet for three
        // days, the same window every other dismissal here uses.
        onDismiss={() => { goQuiet(finishedProject.project.id, today, closeOfferStore); setSweepDismissTick((n) => n + 1); }}
      />
    ) : null,
    // UP-CORE-18 (2026-09-05): the deadline that is close enough to be
    // today's business, with the pace it implies. Not a scolding: "2 a day
    // from here" is arithmetic, and waving it off quiets that project the
    // same three days every other offer here uses.
    dueProject && tuned("project-due") ? (
      <NoticeCard
        key={"projdue-" + dueProject.project.id}
        {...tuneProps("project-due", dueProject.project.data.title)}
        weight={tuningWeight(tunings, "project-due", WAITING)}
        icon={<FolderOpenGlyph />}
        tone="cat-fg-indigo"
        title={dueProject.project.data.title}
        // §AM (2026-09-26): two facts, the dot drawn by the stylesheet, and
        // the date in its meaning's colour (past red, due amber, a rate sky,
        // a date further off small caps). Built by the one facts helper, so
        // K.3 is enforced there rather than here.
        sub={<Facts facts={[{ text: dueProject.pace.count }, { text: dueProject.pace.when, tone: dueProject.pace.tone }]} />}
        action={{ label: "Open", onClick: () => onOpenProject?.(dueProject.project.id) }}
        // ROW-TAP (Dave 2026-09-15: "I want all rows clickable"): the body
        // opens the project too.
        onOpen={() => onOpenProject?.(dueProject.project.id)}
        onDismiss={() => { goQuiet(dueProject.project.id, today, closeOfferStore); setSweepDismissTick((n) => n + 1); }}
      />
    ) : null,
    // UP-CORE-09 (2026-09-05): KEEP GOING. One row slides into the slot the
    // finished task left, with the next best thing in it. It is a fresh
    // offer produced by his own tick seconds ago, so it rides the NEW band:
    // anything failing or waiting on him still outranks it. Start is the
    // same fifteen-minute block every other Start pill on this page commits.
    // The Tasks tab spells its dismissal "Not Now"; here it is the card's own
    // Dismiss rail, because every notice on Today wears the same one (the
    // uniform law), and it counts toward the same two that quiet the chain
    // for the day.
    momentum && tuned("momentum") ? (
      <NoticeCard
        key={"momentum-" + momentum.task.id}
        {...tuneProps("momentum", momentumSub(momentum))}
        weight={tuningWeight(tunings, "momentum", NEW)}
        icon={<CheckCircleGlyph />}
        tone="cat-fg-blue"
        title={momentum.task.data.text}
        sub={momentumFacts(momentum)}
        action={{ label: "Start Now", onClick: () => { const t = momentum.task; setMomentum(null); if (onStartNow) onStartNow(t.id); else void startFifteen(t); } }}
        // ROW-TAP (Dave 2026-09-15: "I want all rows clickable"): the body
        // opens the task.
        onOpen={() => void onOpenTask(momentum.task.id)}
        onDismiss={() => { dismissChain(today); setMomentum(null); }}
      />
    ) : null,
    // UP-CORE-03 (2026-09-05): THE NIGHT BEFORE. The birthday row on Today
    // only exists on the day itself, which means the first anyone hears of
    // it is the morning they are already late for. One quiet line the
    // evening before, with the message already draftable, is the whole
    // difference between remembering and scrambling. Only in the evening,
    // only for tomorrow, and it waves off per person like every other card.
    tomorrowBirthday && tuned("birthday") ? (
      <NoticeCard
        key={"birthday-" + tomorrowBirthday.id}
        {...tuneProps("birthday", tomorrowBirthday.name + ", birthday tomorrow")}
        weight={tuningWeight(tunings, "birthday", RESUME)}
        icon={<GiftGlyph />}
        tone="cat-fg-pink"
        title={tomorrowBirthday.name}
        sub="Birthday tomorrow"
        action={tomorrowBirthday.phone
          ? { label: "Text", onClick: () => setMsgPerson({ id: tomorrowBirthday.id, about: BIRTHDAY_ABOUT }) }
          : undefined}
        // ROW-TAP (Dave 2026-09-15: "I want all rows clickable"): the body
        // opens the person; texting stays on the pill.
        onOpen={onOpenPerson ? () => onOpenPerson(tomorrowBirthday.id) : undefined}
        onDismiss={() => { goQuiet(tomorrowBirthday.id, today, birthdayStore); setBirthdayDismissTick((n) => n + 1); }}
      />
    ) : null,
    // PICK 3: THE GOAL NOTHING TODAY TOUCHES. Not a scolding and not a
    // streak: one line of arithmetic he cannot see anywhere else, because
    // nothing on this page has ever mentioned a goal. Quiet for three days
    // when waved off, and silent entirely on a day whose plate already
    // covers every goal, which is the normal case.
    untouched && tuned("goal-nudge") ? (
      <NoticeCard
        key="goalnudge"
        {...tuneProps("goal-nudge", untouched.data.title)}
        /* HISTORY: this pinned form="card" so the goal's own words could
           wrap ("Run three times a week" shredded on the row form,
           2026-08-25). The pin is repealed in the stream (Dave 2026-08-26,
           Option 1: one-line rows, tap expands to the full card in place),
           so the stream rows this down like everything else; the evidence
           line comes back on the expand. */
        weight={tuningWeight(tunings, "goal-nudge", RESUME)}
        icon={GOAL_ICO}
        /* The goal's own area color, brand red when unhomed (Dave
           2026-08-31) -- same goalTone as Your Life and Money. The card's
           reflective purple stays where reflection lives (revisit, monthly
           report); this card is about a GOAL, so it wears the goal's color. */
        tone={goalTone(untouched.data.tags)}
        title={untouched.data.title}
        // §AK, §AM (2026-09-26): two facts, the dot drawn by the
        // stylesheet. The open count is a count with no state, so it is white;
        // the reason is the line's one grey. "Pick a project to move it" came
        // off: an instruction, a third grey, and what Resume already does.
        sub={(
          <div className="facts">
            <span className="fact"><b>{capAfterNumber(`${openWorkOf(goalReach(untouched.id))} open`)}</b></span>
            <span className="fact">Nothing today moves it</span>
          </div>
        )}
        // "Pick One", not "Pick Something" (2026-08-25). Measured on the
        // uniform card: the longer label took 139px of a 358px row and left
        // the goal's own name 133px when it needed 202, so a two-word button
        // was eating the sentence it was attached to. Same verb, same
        // meaning, and it matches Pick One on Tasks (which took this
        // shorter name itself on 2026-08-26, so the two are now identical).
        action={{ label: "Resume", onClick: () => onGoBigger?.(untouched.id) }}
        // ROW-TAP (Dave 2026-09-15: "I want all rows clickable"): the body
        // opens the goal.
        onOpen={() => onGoBigger?.(untouched.id)}
        onDismiss={() => { dismissGoalNudge(untouched.id, today); setGoalNudgeTick((n) => n + 1); }}
      />
    ) : null,
  ].filter(Boolean);
  // --- Reminders (2026-08-19). Everything here writes a date, never a
  // boolean, so a reminder resets itself at midnight with nothing scheduled.
  //
  // TODAY-F-17 (2026-09-05): the missed ones are in Your Move, so they are
  // not also in the strip (see stripReminders in tasks/reminders.ts). B4
  // added the notice cards and left the strip's missed rows standing, so 8 AM
  // meds appeared twice on one screen wearing two different sets of buttons,
  // which is exactly the "ton of notifications floating around" the one
  // stream rule exists to stop.
  const missedCards = missedReminders(taskItems, today, nhm);
  // THE STRIP'S PICK (Dave's pass-off, 2026-09-26): the next three still
  // ahead of the clock, and the missed ones as one red count row. The Heads
  // Up cards above keep chasing the first two missed; the count row is the
  // door to all of them.
  const remPick = stripPick(taskItems, today, nhm);
  const reminders = remPick.next;

  // A ticked reminder leaves the strip (the next one slides in), so the
  // toast says so and offers the way back, the same as every other row that
  // leaves a screen on a tap (undoLaw).
  const onTickReminder = async (id: string, done: boolean) => {
    const ok = await attemptWrite(() => (done ? tasks.tickReminder(id, today) : tasks.untickReminder(id)));
    await reload();
    if (!ok || !done) return;
    showToast({
      message: "Marked Done",
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(() => tasks.untickReminder(id));
        await reload();
      },
    });
  };
  // ADJUST, NOT A FIXED TEN MINUTES (Dave 2026-09-17): the strip's pill
  // opens Choose a Better Time, and the move is the same one occurrence
  // move the Reminders page makes.
  const onSnoozeReminder = async (id: string) => {
    const v = reminders.find((r) => r.id === id);
    if (v) setRemAdjust({ id, text: v.text });
  };
  // SWIPE LEFT, DELETE (Dave 2026-09-20). A reminder IS a task carrying a
  // ReminderInfo, which is why this deletes a task and recreates a reminder:
  // the snapshot is taken before the write so Undo puts back the schedule and
  // the area, not a bare line of text. Same shape as RemindersFlow's own
  // remove, because the row is the same row on a different screen and an Undo
  // that restores less on Today than on Reminders is a trap.
  const onDeleteReminder = async (id: string) => {
    const t = await tasks.task(id);
    if (!t?.reminder) return;
    const kept = { text: t.text, reminder: t.reminder, category: t.category ?? "", due: t.due ?? null };
    const ok = await attemptWrite(() => tasks.deleteTask(id));
    await reload();
    if (!ok) return;
    showToast({
      message: "Reminder Deleted",
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(() => tasks.createReminder(kept.text, kept.reminder, kept.category, kept.due));
        await reload();
      },
    });
  };
  const moveReminder = async (id: string, toDate: string, time: string) => {
    setRemAdjust(null);
    const ok = await attemptWrite(() => tasks.moveOccurrence(id, today, toDate, time));
    await reload();
    if (ok) showToast({ message: "Moved · " + (toDate === today ? "Today" : toDate) + ", " + fmtTime(time).time + " " + fmtTime(time).ap });
  };
  // A DAY AND AN AREA, NOT JUST A CLOCK (Dave 2026-09-11: "I can't even
  // select a date for a reminder. Expand the booking options"). A reminder has
  // always been a TASK carrying a ReminderInfo, so `due` and `category` were
  // there the whole time and this door simply never wrote them.
  const onSaveReminder = async (text: string, r: ReminderInfo, extra: { due: string | null; category: string; receipt: string }) => {
    const sheet = remSheet;
    setRemSheet(null);
    if (!sheet) return;
    let ok = false;
    if (sheet.mode === "new") {
      ok = await attemptWrite(async () => {
        const id = await tasks.createTask(text, { reminder: r, category: extra.category, due: extra.due });
        return !!id;
      });
    } else {
      ok = await attemptWrite(async () => {
        await tasks.editText(sheet.id, text);
        await tasks.editReminder(sheet.id, r);
        await tasks.setDue(sheet.id, extra.due);
        await tasks.setCategory(sheet.id, extra.category);
        await tasks.logReminderEvent(sheet.id, "edited");
      });
    }
    await reload();
    // THE RECEIPT IS CONCRETE (the reminders rebuild, 2026-09-15): the next
    // moment it fires, or the word Unscheduled, never a generic "Saved".
    if (ok) showToast({ message: extra.receipt });
  };
  // B4 (2026-09-04): "If You Miss It" defaults every reminder to "Ask Again
  // in 15m" (ReminderSheet.tsx's onMiss "nag"), but nothing ever read that
  // value -- missedReminders() was written for exactly this and had zero
  // callers, so a missed reminder just sat quiet in the strip forever,
  // whatever it was set to do. This surfaces it in Heads Up (at most two,
  // missedReminders' own cap) with the one action the setting promised: push
  // it 15 real minutes from now and ask again then. "Let It Go" reminders
  // never reach here at all -- missedReminders already drops them.
  //
  // S1-02: writing the snooze here is also what makes it a REAL follow-up
  // notification, not just a screen update. reload() refreshes taskItems,
  // which the S1-01 effect below is keyed on, so it re-derives every
  // reminder's fire time (this one now via effectiveTime's snoozedTo) and
  // reschedules the actual on-phone alert 15 minutes out. No separate
  // one-off notification call is needed here: the same reschedule-on-change
  // seam events already use for editing an event's time does the work.
  const onAskAgainReminder = async (id: string) => {
    const to = snoozeTime(nhm, 15);
    await attemptWrite(() => tasks.snoozeReminder(id, to, today));
    await reload();
    showToast({ message: "Asking again at " + fmtTime(to).time + " " + fmtTime(to).ap });
  };
  const missedReminderCards = missedCards.map((r) => (
    <NoticeCard
      key={"remind-" + r.id}
      weight={WAITING}
      icon={<BellRing className="ic" />}
      tone="cat-fg-slate"
      title={r.text}
      // §AM (2026-09-25/26): missed is one of the key's reds, and a time
      // with a meaning takes the key colour (F5): the same red the strip
      // gives a missed reminder's time, on the time's fact alone.
      sub={<Facts facts={[{ text: "Missed at " + fmtTime(r.time).time + " " + fmtTime(r.time).ap, tone: "red" }]} />}
      action={{ label: "Ask Again in 15m", onClick: () => void onAskAgainReminder(r.id) }}
      alt={{ label: "Done", onClick: () => void onTickReminder(r.id, true) }}
      // The row opens the reminder (Dave 2026-09-15: "I want all rows clickable").
      onOpen={() => openReminder(r.id)}
    />
  ));
  // B10 (2026-08-23): guarded already, but silent and final. A reminder is one
  // row with everything about it on the client, so it takes the same Undo the
  // event delete four hundred lines up already offers.
  // CALENDAR HANDOFF: iOS Calendar owns the alarm from here, which means it
  // fires offline, with JARVIS closed, forever. Still worth offering now that
  // S1-01 schedules real local notifications: a calendar entry survives the
  // app being deleted and rides to every device the calendar syncs to.
  //
  // TODAY-F-03 (2026-09-05): the toast fired unconditionally, one line after
  // a blob-and-anchor click the iOS web view silently ignores, so on the
  // phone nothing opened and the app said it had. The handoff is awaited now
  // (ics.ts saveIcsFile writes the file and hands it to the share sheet on
  // native), and the receipt only prints once it resolves.
  const addRemindersToCalendar = async (ids?: string[]) => {
    // A DONE REMINDER IS NOT AN APPOINTMENT (Dave, 2026-09-15, photographed:
    // both reminders on screen struck through, with Add All to Calendar
    // under them). This filtered on `reminder` alone, so the one control
    // there offered to put things he had already finished into his calendar.
    // Nothing else on the page treats a ticked reminder as live; neither
    // does this now.
    const picked = taskItems.filter((t) => t.data.reminder && !t.data.done && (!ids || ids.includes(t.id)));
    if (picked.length === 0) { showToast({ message: "Nothing left to add · These are all done" }); return; }
    const ics = remindersToIcs(
      picked.map((t) => ({ id: t.id, text: t.data.text, reminder: t.data.reminder! })),
      today,
    );
    try {
      await saveIcsFile(ics, picked.length === 1 ? "jarvis-reminder.ics" : "jarvis-reminders.ics");
      showToast({ message: "Opening Calendar · Tap Add to confirm" });
    } catch {
      showToast({ message: "Couldn't hand it to your calendar · Try again" });
    }
  };

  // A reminder opened from Today (the strip, a missed-reminder card) opens
  // its details sheet in place, over Today (Dave 2026-09-15: it was landing
  // on the Reminders page and staying there after the sheet closed). Going
  // to the full Reminders page is "See All" alone, below.
  const openReminder = (id: string) => { setRemOpenId(id); setRemFlowMounted(true); };

  // The sheet's writes that happen at once, not on Save: they each say what
  // they did and refresh the open sheet so the record it shows is the one
  // just written.
  // The linked record, opened through the shell. Opening never completes.
  const openLinked = (link: LinkedItem) => {
    const kind = link.type === "contact" ? "person" : link.type;
    onOpenEntity?.(kind, link.id);
  };
  const linkCandidates: LinkCandidate[] = [
    ...taskItems.filter((t) => !t.data.done && !t.data.reminder).map((t) => ({ type: "task" as const, id: t.id, label: t.data.text })),
    ...allEvents.map((e) => ({ type: "event" as const, id: e.id, label: e.data.title })),
    ...extraLinkCandidates,
    ...peopleList.map((p) => ({ type: "contact" as const, id: p.id, label: p.data.name })),
    ...SHORTCUTS.map((s) => ({ type: "healthItem" as const, id: s.key, label: s.label })),
  ];
  const prompts = promptsDue(taskItems, promptCtx, today, Date.now());
  const writePrompt = async (id: string, next: (ct: ContextTriggerConfig, nowMs: number) => ContextTriggerConfig) => {
    const t = taskItems.find((x) => x.id === id);
    const ct = t?.data.reminder?.contextTrigger;
    if (!ct) return;
    await attemptWrite(() => tasks.markPromptShown(id, next(ct, Date.now())));
    await reload();
  };

  // U1/U3 (2026-08-20): the home card drafts and sends. Before this it named
  // the email that needed him and then handed him a trip to another tab,
  // which is the same trip the count line used to make him take.
  //
  // Both paths are honest about failure: no account, no thread, or an
  // unusable model reply all return empty, and the card opens the thread
  // instead of inventing something to send over his name.
  const mailApiFor = (threadId: string) => {
    const snap = loadMailSnapshot();
    const t = snap.threads.find((x) => x.id === threadId);
    const list = google.apis("mail");
    if (list.length === 0) return null;
    const match = t?.account ? list.find((a) => a.email === t.account) : undefined;
    return (match ?? list[0])!.api;
  };


  // CACHE FIRST (2026-08-24). The prompt building moved to cardDraftJob so
  // that this path and the background pass below cannot describe the same
  // draft differently; a hash that disagreed by one space would miss every
  // pre-generated entry while looking like it worked.
  const draftForCard = async (n: { kind: string; threadId: string; title: string; sub: string }): Promise<string> => {
    if (!ai.available) return "";
    try {
      const job = jobFor(n);
      if (!job) return "";
      const hit = cachedDraft(job.kind, job.sourceId, job.hash);
      if (hit) return hit;
      const text = await job.build();
      // Worth remembering even though he waited for it: closing the card and
      // opening it again should not spend a second call on the same email.
      rememberDraft(job.kind, job.sourceId, job.hash, text);
      return text;
    } catch {
      return "";
    }
  };

  // THE BACKGROUND PASS. One run per open, for the mail notices actually on
  // screen, so tapping Draft on the top card is usually instant.
  //
  // Everything that keeps this cheap lives in pregen.ts: five calls a pass at
  // most, a cache hit costs nothing, and the AI Control gate is applied per
  // request with the emailDrafts pin, so Off never pre-generates and neither
  // does any level below Draft Only. What is added here is only WHICH drafts
  // are worth having ready.

  // TODAY-F-06 (2026-09-05): returns the QUEUE ID, not a boolean. The card
  // says "Sending in 12s" and offers an Undo, and it cannot cancel a send
  // whose id it was never told.
  const sendFromCard = async (n: { kind: string; threadId: string }, body: string): Promise<string | null> => {
    const api = mailApiFor(n.threadId);
    if (!api) return null;
    try {
      const full = mapThreadFull(await api.getThread(n.threadId));
      const last = full.messages[full.messages.length - 1];
      if (!last) return null;
      // A nudge goes to whoever the last message was addressed TO; a reply
      // goes back to whoever wrote it. Getting this backwards would send his
      // follow-up to himself, so it is derived, never assumed.
      const reply = buildReply(last, body);
      const to = n.kind === "nudge" ? (last.to || reply.to) : reply.to;
      // S2-2 (2026-09-04): queued, not sent -- the same 12-second hold and
      // Retry-on-failure the Sweep's Send & Next now gets, through a small
      // dedicated queue (todayOutbox.ts) whose pump lives in AppShell and so
      // survives leaving this tab, unlike this screen itself. The nudge
      // count and chase-clear that used to happen right here now happen in
      // TodayOutboxPump, once the send actually goes through.
      const snapThread = loadMailSnapshot().threads.find((x) => x.id === n.threadId);
      return enqueueTodaySend({
        to, subject: reply.subject, body, inReplyTo: reply.inReplyTo, threadId: full.id, account: snapThread?.account,
        todayKind: n.kind === "nudge" || n.kind === "chase" ? n.kind : "reply",
        // UP-MIND-16 (2026-09-05): who it is with, so the handled row the
        // pump emits remembers the person. Already resolved on the snapshot
        // (UP-MIND-10); the pump runs with no component above it.
        ...(snapThread?.personId ? { personId: snapThread.personId } : {}),
      });
    } catch {
      return null;
    }
  };

  // Trashes the mail behind a Today notice (2026-08-26, Dave: "I should be
  // able to delete from here"). Dismiss already existed and only ever hid
  // the card; the email stayed put and the notice came back on the next
  // snapshot refresh, which is not what "delete" means to him.
  // Same shape as MessagesFlow's own trashThread: settleAll so a failure is
  // never swallowed into a false receipt (the LAW below requires it for
  // every mail write in this file), and an undo that puts the thread back
  // in Gmail's inbox, not just back on screen.
  const deleteFromCard = async (n: MailNotice): Promise<{ ok: boolean; undo?: () => Promise<void> } | null> => {
    const api = mailApiFor(n.threadId);
    if (!api) return null;
    const { ok } = await settleAll([n.threadId], () => api.trashThread(n.threadId));
    if (!ok.length) return { ok: false };
    return {
      ok: true,
      undo: async () => {
        const { failed } = await settleAll([n.threadId], () => api.untrashThread(n.threadId));
        if (failed.length) showToast({ message: "Couldn't put it back · Still in trash" });
      },
    };
  };

  // N1: one tap books the slot, replies accepting it in his own words, and
  // blocks the time. Order matters: the CALENDAR write happens first, because
  // an accepted invitation with nothing in the diary is the exact failure
  // this feature exists to remove. A failed send leaves the event, which is
  // recoverable; a failed event after a sent yes is not.
  // ONE RECEIPT, AND IT IS THE TRUE ONE (Dave 2026-08-25, from the audit).
  //
  // This returned `true` on the send-failure path and showed its own honest
  // "Booked · Couldn't send the reply" toast. The caller then printed "Booked
  // and replied" in the same tick, and showToast holds exactly ONE message, so
  // the honest one was overwritten before it ever rendered. You would believe
  // you had accepted a meeting time in writing to somebody who was never told.
  //
  // The receipt is now the return value rather than a toast fired from in
  // here. Two functions cannot both own one line of text.
  const takeMeeting = async (threadId: string): Promise<string | null> => {
    const snap = loadMailSnapshot();
    const m = (snap.meetings ?? []).find((x) => x.threadId === threadId);
    if (!m) return null;
    const made = await attemptWrite(() =>
      schedule.createEvent("Call With " + m.from, { date: m.date, start: m.start, end: m.end }));
    if (!made) return null;
    await reload();
    const queued = await sendFromCard({ kind: "reply", threadId }, acceptBody({ ...m, free: true }));
    return queued ? "Booked and replied" : "Booked · Couldn't send the reply";
  };

  // THE EMAIL ALREADY DID THE DATA ENTRY (Dave 2026-08-25: "if it's something
  // that AI can act on it should have the option. Example would be it's an
  // appointment reminder and it adds it to the Jarvis schedule").
  //
  // Triage read the date, the time and the amount out of the email and then
  // the card offered him "Reply". This is the other half: the button writes
  // to the surface the email was always about.
  //
  // Everything it writes carries a gmail source, so every one of these can be
  // traced back to the mail that made it, and nothing auto-created is ever
  // mistaken for something he typed. It returns the receipt AND the undo,
  // because this is the only card that changes the schedule without opening
  // anything first, so a wrong one has to be one tap from gone.
  const takeAct = async (a: MailAct, threadId: string): Promise<{ receipt: string; undo?: () => Promise<void> } | null> => {
    const src = { type: "gmail" as const, ref: threadId, ts: Date.now() };
    const when = dayPhrase(a.date, today);
    // attemptWrite resolves a boolean, so the new id comes back out through a
    // local the way onEventDuplicate does it. Undo needs the id, and an undo
    // that cannot name what it is undoing is not an undo.
    let made: string | null = null;
    if (a.verb === "schedule") {
      const ok = await attemptWrite(async () => {
        made = await schedule.createEvent(a.title, {
          date: a.date, start: a.start!, end: endOfAct(a.start!, a.durationMin ?? 60), source: src,
        });
      });
      const id: string | null = made;
      if (!ok || !id) return null;
      await reload();
      return {
        receipt: `On your schedule · ${when} ${fmtTime(a.start!).time} ${fmtTime(a.start!).ap}`,
        undo: async () => { await attemptWrite(() => schedule.deleteEvent(id)); await reload(); },
      };
    }
    const ok = await attemptWrite(async () => {
      made = await tasks.createTask(a.title, {
        due: a.date,
        fromThread: threadId,
        source: src,
        // UP-MIND-10 (2026-09-05): the sender, when the snapshot resolved
        // them to someone in Contacts. Read off the snapshot rather than
        // matched here, so there is one resolver and one rule.
        ...(personIdOfThread(threadId) ? { personId: personIdOfThread(threadId)! } : {}),
        // A bill is a task wearing money facts (notes/types.ts), so Money
        // needs no separate write and the row appears where he pays things.
        ...(a.verb === "bill" ? { bill: { amount: a.amount! } } : {}),
        ...inheritFromThread(taskItems, threadId),
      });
    });
    const id: string | null = made;
    if (!ok || !id) return null;
    await reload();
    return {
      receipt: a.verb === "bill" ? `In Money · $${a.amount!.toFixed(2)} due ${when}` : `Added to your tasks · ${when}`,
      undo: async () => { await attemptWrite(() => tasks.deleteTask(id)); await reload(); },
    };
  };

  // Email that finishes on Today. A deadline a sender named, or a promise he
  // made, becomes a real task right here: the whole point is that he never
  // has to open the inbox to deal with what the inbox produced.
  // Just Fifteen, from any Up Next row. Same container the What Now sheet
  // makes: a real block on the real day, starting on the tap, because a
  // delayed commitment is the one that does not happen.
  // TODAY-F-07 (2026-09-05): TWO "START" PILLS ON ONE PAGE DID TWO THINGS.
  // Your Move's Start wrote a fifteen-minute block from now and said so; the
  // Now card's Start, a few rows below in the same red pill, opened the
  // task's edit sheet. Same word, same screen, a form instead of a block.
  // The Now card already knows the gap fits and what the task is estimated
  // at, so its Start starts, sized to that estimate rather than to a flat
  // fifteen. One Undo, because a block written by a single tap has to be
  // removable by a single tap.
  const startBlock = async (t: TaskItem, minutes: number) => {
    const start = nhm;
    let ids: string[] = [];
    const ok = await attemptWrite(async () => {
      ids = (await schedule.commitPlan(today, [{
        taskId: t.id, text: t.data.text, category: t.data.category ?? "",
        start, end: endOf(start, minutes),
      }])).created;
    });
    await reload();
    if (!ok) return;
    showToast({
      message: `${durLabel(minutes)} on ${t.data.text}`,
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(async () => { for (const id of ids) await schedule.deleteEvent(id); });
        await reload();
      },
    });
  };

  const startFifteen = async (t: TaskItem) => {
    const start = nhm;
    // commitPlan: starting on it NOW supersedes any block the planner had
    // parked later in the day; one plan event per task per day.
    const id = await attemptWrite(() => schedule.commitPlan(today, [{
      taskId: t.id, text: t.data.text, category: t.data.category ?? "",
      start, end: endOf(start, FIFTEEN),
    }]));
    await reload();
    if (!id) return;
    // "Fifteen minutes, and it ENDS" (tasks/rightNow.ts) is half a promise
    // until the end is visible and arrives. The block becomes the headliner
    // from here; the toast only confirms the write.
    const live: LiveFifteen = {
      taskId: t.id, text: t.data.text, startedAt: Date.now(),
      startHHMM: start, date: today, minutes: FIFTEEN, rounds: 1,
    };
    writeFifteen(live);
    setFifteen(live);
    // THE ONE TAP WHERE A BLOCK TRULY BEGINS NOW (moved here 2026-09-18 with
    // the What Now sheet's deletion, which used to be the only emitter).
    focusStarted(t.id, FIFTEEN, "fifteen");
    showToast({ message: `Fifteen minutes on ${t.data.text}` });
  };

  // THE END OF THE BLOCK ASKS ONE QUESTION, AND BOTH ANSWERS ARE REAL
  // (2026-09-16). Done ticks the task through the same door every other tick
  // on this page uses, so the chain, the receipts and the project arithmetic
  // all still happen. Another 15 grows the block that is already on the
  // calendar instead of booking a second one, because he did not stop and
  // start again. Stop is the way out while it runs, and it trims the event
  // to the minutes he actually sat: a block nobody sat through should not
  // leave a full fifteen on the day claiming he did.
  const fifteenCat = (id: string) => taskItems.find((x) => x.id === id)?.data.category ?? "";

  const endFifteen = () => { clearFifteen(); setFifteen(null); };

  const fifteenDone = async () => {
    const f = fifteen;
    if (!f) return;
    endFifteen();
    await onToggleTask(f.taskId);
  };

  const fifteenAgain = async () => {
    const f = fifteen;
    if (!f) return;
    const next = extended(f, FIFTEEN);
    const ok = await attemptWrite(() => schedule.commitPlan(today, [{
      taskId: f.taskId, text: f.text, category: fifteenCat(f.taskId),
      start: f.startHHMM, end: endOf(f.startHHMM, next.minutes),
    }]));
    if (!ok) return;
    writeFifteen(next);
    setFifteen(next);
    await reload();
    showToast({ message: "Fifteen more minutes" });
  };

  /** What the headliner shows while a block is live. Recomputed on every
   *  second tick, off the clock, never off a counter. */
  const liveFifteenFace = fifteen && isStillLive(fifteen, today) ? fifteenFace(fifteen) : null;

  const fifteenStop = async () => {
    const f = fifteen;
    if (!f) return;
    const sat = Math.max(1, Math.round((Date.now() - f.startedAt) / 60_000));
    endFifteen();
    const ok = await attemptWrite(() => schedule.commitPlan(today, [{
      taskId: f.taskId, text: f.text, category: fifteenCat(f.taskId),
      start: f.startHHMM, end: endOf(f.startHHMM, sat),
    }]));
    await reload();
    if (ok) showToast({ message: capAfterNumber(`${sat} ${sat === 1 ? "minute" : "minutes"} on it`) });
  };

  // NOT TONIGHT, AND HERE IS WHEN INSTEAD (Dave 2026-09-16: every button on
  // this page either does something that helps or comes off).
  //
  // This is the honest answer to "I am not doing this". It is not a snooze,
  // a dismissal or a re-deal: the task leaves today because its date moves,
  // and it lands on a real open slot tomorrow that the toast names, so the
  // question "when, then?" is answered on screen rather than implied. The
  // slot comes from the same nextFreeSlot the Schedule page books with, and
  // the write is commitPlan, which replaces any block that task already had
  // rather than leaving two. Undo puts both halves back.
  const moveToTomorrow = async (t: TaskItem) => {
    const mins = t.data.estimateMin && t.data.estimateMin > 0 ? t.data.estimateMin : 60;
    const start = nextFreeSlot(tomorrowEvents, tmrw, new Date(), mins);
    const end = addMinutes(start, mins);
    const wasDue = t.data.due ?? null;
    let evId: string | null = null;
    const ok = await attemptWrite(async () => {
      await tasks.setDue(t.id, tmrw);
      const r = await schedule.commitPlan(tmrw, [{
        taskId: t.id, text: t.data.text, category: t.data.category ?? "", start, end,
      }]);
      evId = r.created[0] ?? null;
    });
    await reload();
    if (!ok) return;
    const when = fmtTime(start);
    showToast({
      message: `Tomorrow at ${when.time}${when.ap}`,
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(async () => {
          if (evId) await schedule.deleteEvent(evId);
          await tasks.setDue(t.id, wasDue);
        });
        await reload();
      },
    });
  };

  // PICK 26 (Dave 2026-08-22): an email-born task lands with its lineage.
  // Not a guess: the ONLY signal used is that a task from this same thread
  // already exists and somebody already filed it. The first task off a thread
  // inherits nothing, which is correct, because there is nothing to inherit
  // yet; every one after it joins its sibling. See messages/threadTasks.ts.
  // UP-MIND-10 (2026-09-05): the snapshot already resolved the sender to a
  // Person at build time (snapshotRefresh / MessagesFlow), so Today reads
  // that id rather than running a second matcher over Contacts.
  const personIdOfThread = (threadId?: string): string | undefined =>
    threadId ? loadMailSnapshot().threads.find((t) => t.id === threadId)?.personId : undefined;

  const addTaskFromMail = async (text: string, due?: string, threadId?: string): Promise<boolean> => {
    const inherited = threadId ? inheritFromThread(taskItems, threadId) : {};
    // THE ID, NOT THE ABSENCE OF A THROW (2026-08-25). attemptWrite reports
    // true whenever nothing threw, and createTask returns null WITHOUT
    // throwing when the text is blank. A subject of "Re:" strips to an empty
    // string, so "Added to your tasks" could print with no task behind it.
    let made: string | null = null;
    const ok = await attemptWrite(async () => {
      made = await tasks.createTask(text, {
        due: due ?? today,
        ...(threadId ? { fromThread: threadId } : {}),
        ...(personIdOfThread(threadId) ? { personId: personIdOfThread(threadId)! } : {}),
        ...inherited,
      });
    });
    const id: string | null = made;
    if (ok && id) await reload();
    return !!(ok && id);
  };

  // ONE NOTICE STREAM (Dave 2026-08-19: "there's a ton of notifications
  // floating around, put them all under one thing"). Everything JARVIS
  // noticed lands in one labeled section on the page, in priority order.
  // The draft leads: accepting the day resolves most of the rest.
  // A missed reminder gets ONE row on this page and it is the card here, not
  // the strip row (TODAY-F-17, 2026-09-05): the card carries Ask Again, which
  // is the behaviour the "If You Miss It" setting names, and the strip drops
  // whatever Heads Up has taken. This comment used to say the opposite of
  // what the code did, which is how the same reminder ended up on screen
  // twice with two different sets of buttons.
  const reportNotice = reportMonth ? (
    <NoticeCard
      key="report"
      weight={WAITING}
      icon={<TargetGlyph />}
      // WAVE 3, THE RED DIET (2026-08-29). This was red. A monthly report
      // being ready is not late, not broken, and not destructive: it is a
      // nice thing that arrived, offered in the colour the app reserves for
      // "something is on fire". Red on a pleasant optional thing is how red
      // stops meaning anything, which is the whole failure mode L1 was
      // written against. Purple is the app's reflective tone and this is the
      // reflective object.
      tone="cat-fg-purple"
      title={`Your ${monthTitle(reportMonth)} is ready`}
      sub="Two minutes"
      action={{ label: "Read", onClick: () => setReportOpen(true) }}
      // ROW-TAP (Dave 2026-09-15): the body opens the report.
      onOpen={() => setReportOpen(true)}
      // LAW 2 (2026-08-29): it had no way out. Reading the report marked it
      // seen; NOT wanting to read it had no expression at all, so the card
      // sat there every day until he gave in. Dismiss marks the same month
      // seen -- "I have dealt with this" is the same fact either way -- and
      // next month's report is a new card.
      onDismiss={() => { markReportSeen(reportMonth); setReportMonth(null); }}
    />
  ) : null;
  const notices = [reportNotice, ...alertCards, ...missedReminderCards, reflowSection, overflowSection].filter(Boolean);

  const daypart = evening ? "evening" as const : now.getHours() < 12 ? "morning" as const : null;
  const initials = name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "JV";
  const remSheetNode = remSheet && (
      <ReminderSheet
        mode={remSheet.mode}
        initial={remSheet.mode === "edit" ? { text: remSheet.text, reminder: remSheet.reminder, due: remSheet.due, category: remSheet.category } : undefined}
        categories={categories.map((c) => ({ id: c.id, name: c.name, color: c.color as string }))}
        onSave={(text, r, extra) => void onSaveReminder(text, r, extra)}
        onOpenLinked={onOpenEntity ? openLinked : undefined}
        linkCandidates={linkCandidates}
        today={today}
        nowHHMM={nhm}
        onCancel={() => setRemSheet(null)}
      />
  );

  if (loading) return <SkeletonScreen />;

  if (remHome) {
    return (
      <RemindersFlow
        chrome={{ back: "Today", onBack: () => { setRemHome(false); setRemOpenId(null); } }}
        onOpenEntity={onOpenEntity}
        openId={remOpenId ?? undefined}
        onOpened={() => setRemOpenId(null)}
      />
    );
  }

  return (
    <>
    <TodayPage
      greeting={name ? `${greetingFor(now)}, ${name}` : greetingFor(now)}
      dateLong={longDate(now)}
      summary={daySummary(todayEvents, taskItems, today, movesCount(goalIdx, todaysTasks(taskItems, today)))}
      todayEvents={todayEvents}
      now={nhm}
      nowLabel={fmtTime(nhm).time}
      tomorrowEvents={tomorrowEvents}
      weekly={weekly}
      tomorrowTasks={taskItems.filter((t) => !t.data.done && t.data.recurrence && t.data.recurrence !== "daily" && t.data.due === tmrw)}
      tomorrowDate={shortDate(new Date(tmrw + "T00:00:00"))}
      tasks={todaysTasks(taskItems, today)}
      parentOf={(t) => parentForTask(parentIdx, t)}
      // SHARED-F-16 (2026-09-05): the escalating burst finally reaches a
      // row. burstSize has existed in shared/completion since the dopamine
      // layer landed and nothing called it, because movedBy was computed
      // AFTER the toggle, by which time the row had already burst. It is a
      // pure read of tasks and projects already in hand, so it can be
      // answered before the tap instead.
      burstSizeOf={(t) => (t.data.done ? "small" : burstSize(movedByTask(t.data, t.id)?.moved ?? null))}
      evening={evening}
      plan={plan}
      ring={ring}
      daypart={daypart}
      onToggleTask={onToggleTask}
      onOpenTask={onOpenTask}
      onPlanDay={() => void openPlan("today")}
      onPlanTomorrow={evening ? () => void openPlan("tomorrow") : undefined}
      onRunningLate={onRunningLate}
      onUpNext={() => setUpNextOpen(true)}
      upNext={upNextRows}
      upNextWaiting={Math.max(0, upNextAll.length - 1)}
      upNextReason={upNextAll[0] ? reasonFor(upNextAll[0], today, inPeakNow) : null}
      moveCategory={moveCategory}
      moveEstimate={moveEstimate}
      moveReason={movePlacement}
      onTomorrowMove={moveTask ? () => void moveToTomorrow(moveTask) : undefined}
      fifteen={liveFifteenFace}
      onFifteenDone={() => void fifteenDone()}
      onFifteenAgain={() => void fifteenAgain()}
      onFifteenStop={() => void fifteenStop()}
      blendMap={blendMap}
      // THE DOOR HE WALKED IN THROUGH READS RESUME (2026-09-19): the block
      // that started this session offers the way back, not a second Start.
      gymDoorFor={(e) => {
        const d = gymDoor.doorFor(e);
        return d && liveNow && liveGym?.doorEventId === e.id ? { ...d, onResume: () => onRestoreSpot?.("gym", gymCatId ?? "") } : d;
      }}
      onStartTask={onStartNow}
      onSeeAllMail={!mailEmpty && !mailResidual && onGoEmail ? () => onGoEmail() : undefined}
      mailEmpty={mailEmpty}
      mail={
        <MailNotices
          key="mail"
          today={today}
          nowHHMM={nhm}
          onDraft={ai.available ? draftForCard : undefined}
          onTakeMeeting={google.hasToken ? takeMeeting : undefined}
          onTakeAct={takeAct}
          onSend={google.hasToken ? sendFromCard : undefined}
          onDelete={google.hasToken ? deleteFromCard : undefined}
          onAddTask={addTaskFromMail}
          onOpenThread={onGoEmail ? (id) => onGoEmail(id) : undefined}
          onOpenDraft={onGoEmail ? (id) => onGoEmail(undefined, id) : undefined}
          onOpenEmail={onGoEmail ? () => onGoEmail() : undefined}
          onEmptyChange={setMailEmpty}
          onResidualChange={setMailResidual}
        />
      }
      billLine={billsLine(taskItems, today) ?? undefined}
      // B5 (2026-09-04): bills.ts's own first rule is that autopay never
      // says "paid" -- the app cannot know a payment cleared -- but this
      // offered the button on whatever bill was soonest, autopay or not.
      // The line above still shows an autopay bill (informational: "Set to
      // autopay" is exactly what money's law wants said); payableBill()
      // withholds only the false "Paid" affordance.
      onPayBill={(() => {
        const next = payableBill(taskItems, today);
        return next ? () => void onToggleTask(next.id) : undefined;
      })()}
      onOpenBill={(() => {
        const due = billsDueSoon(taskItems, today);
        const one = due.length === 1 ? due[0] : undefined;
        return one ? () => void onOpenTask(one.id) : onGoTasks;
      })()}
      freshStart={offTrack ? () => setFreshOpen(true) : undefined}
      locked={blocked}
      onOpenEvent={onOpenEvent}
      onEditRoutine={onEditRoutine}
      onOpenBlock={onOpenBlock}
      conflicts={conflicts}
      attachMap={attachMap}
      firstMoveMap={firstMoveMap}
      onShift={onShift}
      onMoveTo={onMoveTo}
      onSetEnd={onSetEnd}
      onSkipToday={onSkipToday}
      onPushTomorrow={onPushTomorrow}
      onDeleteEvent={(id: string) => void onDeleteEventRow(id)}
      onDeleteBlock={(id: string) => void onDeleteBlockRow(id)}
      onShiftBlock={onShiftBlock}
      onRetimeBlock={onRetimeBlock}
      onResizeBlock={onResizeBlock}
      today={today}
      nowCard={nowSection}
      liveGym={liveGymHead}
      proposedDay={proposedDay}
      dayFooter={draftFooter ?? draftReceipt}
      dayPrimary={draftPrimary}
      reminders={<>
        <RemindersStrip
          items={reminders}
          missed={remPick.missed}
          onTick={(id, done) => void onTickReminder(id, done)}
          onTickMissed={(id) => void onTickReminder(id, true)}
          onSnooze={(id) => void onSnoozeReminder(id)}
          onAdd={() => setRemSheet({ mode: "new" })}
          onOpen={openReminder}
          onDelete={(id) => void onDeleteReminder(id)}
          onAddAllToCalendar={() => void addRemindersToCalendar()}
          onSeeAll={() => setRemHome(true)}
        />
      </>}
      notices={notices}
      offersQuiet={notices.length >= 2}
      // TWO notices, not one glued pair. Bundling them into a single slot
      // put an AI suggestion immediately under the check-in's mood chips with
      // nothing between them, so the suggestion read as part of the question.
      // They are unrelated: one asks how today felt, the other proposes work.
      onSearch={onSearch}
      onProfile={onProfile}
      onSeeAllSchedule={onGoSchedule}
      onSeeAllTasks={onGoTasks}
      // TODAY-F-16 (2026-09-05): the "all" door landed in AppShell with WAVE
      // 4 and this flow has accepted it ever since without ever passing it
      // on, so Still Open's See All and its "N More still open" receipt both
      // opened Tasks on the Today filter, which hides every overdue row the
      // receipt had just counted.
      onSeeAllOpen={onGoTasksAll ?? onGoTasks}
      onSeeAllOverdue={onGoTasksOverdue}
      onGoBigger={onGoBigger ? () => onGoBigger() : undefined}
      movedLine={movedLine(movedGoals)}
      avatar={initials}
      birthdays={birthdays}
      onTextPerson={(id) => setMsgPerson({ id, about: BIRTHDAY_ABOUT })}
      onOpenPerson={onOpenPerson}
      onCallPerson={(id) => setCallPerson(id)}
    />
    {planOpen && (
      <PlanDaySheet
        key={planDate}
        chosenCap={planCap}
        events={planEvents}
        tasks={candidatesFor(planDate, planEvents)}
        startMin={planStart}
        endMin={planEnd}
        date={planDate}
        dayLabel={planningTomorrow ? new Date(tomorrow + "T12:00:00").toLocaleDateString([], { weekday: "long" }) : "Today"}
        target={planTarget}
        onTarget={(t) => void openPlan(t)}
        alreadyPlanned={planEvents.filter((e) => !!e.data.sourceTaskId).map((e) => e.data.title)}
        // Edit opens THE draft, not a second planner (merge phase 1).
        seed={seedFrom(readDraft(planDate), candidatesFor(planDate, planEvents).map((c) => c.id))}
        routineConfigured={routineSet}
        blocked={blocked}
        sizing={sizing}
        onEditRoutine={onEditRoutine ? () => { setPlanOpen(false); onEditRoutine(); } : undefined}
        onAddTask={addPlanTask}
        onCommit={onPlanCommit}
        onAIPlan={onAIPlan}
        energy={energy}
        onClose={() => { setPlanOpen(false); setPlanTarget("today"); }}
      />
    )}
    {revisitSheet && revisit && (
      <DecisionCaptureSheet
        mode="supersede"
        initial={{ ruledOut: revisit.data.ruledOut, linkedType: revisit.data.linkedType, linkedId: revisit.data.linkedId, linkedLabel: revisit.data.linkedLabel }}
        attachOptions={decisionAttachOptions}
        onSave={(draft) => void (async () => {
          const rec = revisit;
          let newId: string | null = null;
          const ok = await attemptWrite(async () => { newId = await decisionsSvc.supersede(rec.id, draft); });
          setRevisitSheet(false);
          setRevisit(null);
          if (ok && newId) {
            const created = newId;
            showToast({ message: "Decision replaced", actionLabel: "Undo", onAction: () => void (async () => {
              await attemptWrite(() => decisionsSvc.undoSupersede(created));
              await loadRevisit();
            })() });
          }
        })()}
        onCancel={() => setRevisitSheet(false)}
      />
    )}
    {/* UP-CORE-03 (2026-09-05): the same two person surfaces the People tab
        mounts, opened from the birthday row. MessageDraftSheet owns no
        services by law; the Call Prep card gets the same wiring PeopleFlow
        gives it, so a logged attempt behaves identically from either door. */}
    {msgPerson && peopleList.find((p) => p.id === msgPerson.id) && (
      <MessageDraftSheet
        person={peopleList.find((p) => p.id === msgPerson.id)!}
        ai={ai}
        about={msgPerson.about}
        voice={msgVoice}
        onClose={() => setMsgPerson(null)}
      />
    )}
    {callPerson && peopleList.find((p) => p.id === callPerson) && (
      <CallPrepSheet
        person={peopleList.find((p) => p.id === callPerson)!}
        onCall={async () => {
          const out = await peopleSvc.logCallAttempt(callPerson);
          await reloadPeople();
          return out;
        }}
        onUndoCall={async (prior) => { /* An Undo that fails silently is worse than no Undo (states sweep,
             2026-09-20): the sheet says the call attempt is back and the
             record still says otherwise. Same handler in four files, and
             unguarded in all four. */ await attemptWrite(async () => { await peopleSvc.restoreCallAttempt(callPerson, prior); await reloadPeople(); }); }}
        onCaptureNote={async (text) => {
          const person = peopleList.find((p) => p.id === callPerson);
          if (!person) return false;
          /* THE CAPTURE WRITES THREE RECORDS AND REPORTED NONE OF THEM
             (states sweep, 2026-09-20). A note, its first block and its link
             back to the person: if the second or third threw, the sheet had
             already been told true and a half-built note stayed behind.
             attemptWrite gives the standard failure toast AND the boolean
             this handler's contract already returns. */
          let noteId: string | null = null;
          const ok = await attemptWrite(async () => {
            noteId = await notesSvc.createNote("Call with " + person.data.name, "");
            if (!noteId) throw new Error("no note");
            await notesSvc.addBlock(noteId, { type: "text", text });
            await notesSvc.addConnection(noteId, "person", person.data.name, person.id);
          });
          return ok;
        }}
        onClose={() => setCallPerson(null)}
      />
    )}
    {sheet && (
      <TaskSheet
        events={sheetEvents(allEvents, today)}
        // THE SAME SHEET EVERYWHERE (2026-09-26): Today's copy handed over
        // no projects and no goals, so its Where group had no Project row
        // and a Goal row that could not be picked.
        projects={projList.map((p) => ({ id: p.id, title: p.data.title, category: p.data.category || undefined, goalTitle: liveGoals(goalList).find((g) => g.id === p.data.goalId)?.data.title, goalId: p.data.goalId }))}
        goals={sheetGoals(goalList, sheet.initial.goalId)}
        mode="edit"
        initial={sheet.initial}
        categories={categories}
        categoryMinutes={estimates}
        onSave={onSaveTask}
        onDelete={onDeleteTask}
        onSchedule={onScheduleFromToday}
        onBreakDown={ai.available && sheet ? () => void breakDownTask(sheet.id) : undefined}
        onCancel={() => setSheet(null)}
      />
    )}
    {eventSheet && (
      <EventSheet
        mode="edit"
        initial={eventSheet.initial}
        categories={categories}
        projects={projList.map((p) => ({ id: p.id, title: p.data.title, category: p.data.category || undefined, goalTitle: liveGoals(goalList).find((g) => g.id === p.data.goalId)?.data.title, goalId: p.data.goalId }))}
        goals={sheetGoals(goalList, eventSheet.initial.goalId)}
        onSave={onSaveEvent}
        onDelete={onDeleteEvent}
        onMoveToAnytime={onEventToAnytime}
        onDuplicate={onEventDuplicate}
        onCancel={() => setEventSheet(null)}
      />
    )}
    {blockSheet && (
      <BlockSheet
        initial={blockSheet.initial}
        onSave={onSaveBlock}
        onDelete={onDeleteBlock}
        onEditFull={onEditRoutine ? onEditBlockFull : undefined}
        onCancel={() => setBlockSheet(null)}
      />
    )}
    {upNextOpen && (
      <Suspense fallback={null}>
        <UpNextFlow
          onClose={() => { setUpNextOpen(false); void reload(); }}
          onStartNow={onStartNow ? (id) => { setUpNextOpen(false); onStartNow(id); } : undefined}
          onFifteen={(t) => { setUpNextOpen(false); void startFifteen(t); }}
          fifteen={liveFifteenFace}
          onFifteenDone={() => void fifteenDone()}
          onFifteenAgain={() => void fifteenAgain()}
          onFifteenStop={() => void fifteenStop()}
        />
      </Suspense>
    )}
    {freshOpen && (
      <Suspense fallback={null}>
        <FreshStartFlow
          onClose={() => {
            setFreshOpen(false);
            // Waving Fresh Start off silences the banner for the rest of the day.
            setFreshSkipped(true);
            try { localStorage.setItem("jarvis.fresh.skip", today); } catch { /* ok */ }
          }}
          onDone={() => { void reload(); }}
        />
      </Suspense>
    )}
    {ritual && (
      <RitualSheet
        initial={ritual}
        onCancel={() => setRitual(null)}
        onSet={(r) => {
          setRitual(null);
          // The container is a real block on the real day, not an app-only
          // timer: it has to survive him closing JARVIS, which is precisely
          // when starting goes wrong.
          void (async () => {
            const ok = await attemptWrite(() => schedule.createEvent(r.text, {
              date: today, start: r.startHHMM, end: endsAt(r),
              sourceTaskId: r.taskId,
            }));
            // S6-Q36 (2026-09-04): "the first move is thrown away, never
            // stored." It rides the task's own if-then plan now, the same
            // field TaskSheet's Plan group edits, so it can show up again
            // everywhere a plan does: the event row this just created
            // (attachments.ts's firstMoveOf), and the closing rung of its
            // reminder ladder (countdown.ts's ladderBody). Only written once
            // the event itself is real; a ritual that failed to schedule
            // leaves no half-set plan behind.
            //
            // TODAY-F-24 (2026-09-05): and only when the task has no plan of
            // his own. This wrote unconditionally, so Set a Start replaced a
            // hand-written "When I sit down at 9, open the spreadsheet" with
            // the ritual's cue. Read fresh rather than off the render's task
            // list: the sheet has been open, and this is the check that
            // decides whether his words survive. See ritualPlan().
            if (ok) {
              const existing = await tasks.task(r.taskId);
              const plan = ritualPlan(existing?.plan, r);
              if (plan) await attemptWrite(() => tasks.setPlan(r.taskId, plan));
            }
            await reload();
            if (ok) showToast({ message: `Starts ${r.startHHMM} · ${r.firstMove}` });
          })();
        }}
      />
    )}
    {remSheetNode}
    {remAdjust && (
      <SnoozeSheet title={remAdjust.text} fromDate={today} today={today} onPick={(d, t) => void moveReminder(remAdjust.id, d, t)} onCancel={() => setRemAdjust(null)} />
    )}
    {wrapUp && (
      <RowActionSheet title="Every task in it is done" onCancel={() => setWrapUp(null)} actions={[
        { label: "Add More Tasks", onPick: () => { const id = wrapUp; setWrapUp(null); onOpenProject?.(id); } },
        { label: "Finish Project", onPick: () => { const id = wrapUp; setWrapUp(null); void closeProject(id); } },
      ]} />
    )}
    {!remHome && remFlowMounted && (
      <RemindersFlow
        pageless
        onOpenEntity={onOpenEntity}
        openId={remOpenId ?? undefined}
        onOpened={() => setRemOpenId(null)}
      />
    )}
    {prompts[0] && (
      <ContextPromptSheet item={prompts[0]} eyebrow="After Completing a Task" onOpenLinked={onOpenEntity ? openLinked : undefined}
        onContinue={(id) => void writePrompt(id, shownNow)} onSnooze={(id) => void writePrompt(id, snoozedForADay)}
        onTurnOff={(id) => void (async () => { await attemptWrite(() => tasks.clearPrompt(id)); await reload(); showToast({ message: "Prompt Turned Off" }); })()} />
    )}
    </>
  );
}

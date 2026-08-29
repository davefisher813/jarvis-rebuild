import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSchedule, useTasks, useProfile, useCategories, useRoutine, usePeople, useProjects, useGoals, useDecisions, useNotes } from "../data/NotesProvider";
import { pausedCategoryIds, effectiveKind } from "../categories/kinds";
import { workWindowOf, isSuggested, rankCandidates } from "../schedule/planMeta";
import type { Category } from "../categories/types";
import type { Project } from "../projects/types";
import type { Goal } from "../life/types";
import { todayISO, fmtTime, addMinutes, minToHHMM } from "../schedule/calendar";
import type { EventItem } from "../schedule/types";
import type { TaskItem } from "../tasks/TasksService";
import { greetingFor, longDate, shortDate } from "./greeting";
import { tomorrowISO, nowHHMM, daySummary, todaysTasks, billsLine, billsDueSoon } from "./todayData";
import TodayPage from "./TodayPage";
import MailNotices from "./MailNotices";
import ReportFlow, { reportSeen, markReportSeen } from "../review/ReportPage";
import { monthName as monthTitle } from "../review/report";
import { useOptionalSeal } from "../data/NotesProvider";
import NoticeCard from "./NoticeCard";
import { FAILING, WAITING, NEW, RESUME } from "./stream";
import { capAfterNumber } from "../shared/casing";
import { movedBy, celebrationLine, type Moved } from "../shared/completion";
import { birthdaysOn, type BirthdayHit } from "../people/birthdays";
import CheckIn from "./CheckIn";
import TaskSheet, { type SheetCategory, type TaskDraft } from "../tasks/screens/TaskSheet";
import EventSheet, { type EventDraft } from "../schedule/screens/EventSheet";
import BlockSheet, { type BlockDraft } from "../schedule/screens/BlockSheet";
import PlanDaySheet from "../schedule/screens/PlanDaySheet";
import { aiPlanDay } from "../schedule/planDayAI";
import { DEFAULT_ROUTINE, planWindowFor, protectedRangesFor, type RoutineData } from "../routine/types";
import { chronotypeFor, peakWindowFor } from "../schedule/energy";
import { daySizing } from "../schedule/daySizing";
import { shiftFutureEvents, restoreShift } from "../schedule/runningLate";
import { ensureCheckinNotifications, cancelCheckinNotifications, ensureEventReminders } from "../shared/notifications";
import { badgeCount, setAppBadge } from "../shared/badge";
import { isEvening, eveningStats, weekRecap } from "./evening";
import { readSamples } from "../shared/timeSense";
import { buildGoalIndex, liveGoals, reachOf, goalTitleForTask } from "../bigger/reach";
import { inheritFromThread } from "../messages/threadTasks";
import { endOfAct, type MailAct } from "../messages/mailAct";
import { dayPhrase } from "../money/bills";
import { rankProjects, closable } from "../bigger/progress";
import { movesCount, movesLine, goalsMovedToday, movedLine, untouchedGoal, untouchedLine, openWorkOf, dismissGoalNudge } from "./goalPulse";
import SkeletonScreen from "../shared/SkeletonScreen";
import type { Recurrence } from "../notes/types";
import { useAI } from "../ai/useAI";
import { useGoogle } from "../connections/google/GoogleSession";
import { mapThreadFull, buildReply, encodeEmail } from "../connections/google/map";
import { cardDraftJob } from "../messages/cardDraftJob";
import { DUR_CHOICES, durLabel } from "../schedule/durations";
import {
  moveEvent as moveEventAdjust, undoMoveEvent as undoMoveEventAdjust, type MoveOutcome,
  resizeEvent as resizeEventAdjust, undoResizeEvent as undoResizeEventAdjust, type ResizeOutcome,
  skipEventToday as skipEventTodayAdjust, undoSkipEventToday as undoSkipEventTodayAdjust,
  pushEventTomorrow as pushEventTomorrowAdjust, undoPushEventTomorrow as undoPushEventTomorrowAdjust,
} from "../schedule/eventAdjust";
import { shiftBlock as shiftBlockAdjust, retimeBlock as retimeBlockAdjust, resizeBlock as resizeBlockAdjust, editBlockBasics, removeBlock as removeBlockAdjust } from "../routine/blockAdjust";
import { overlapsOn } from "../schedule/dayEdit";
import { isKept } from "../schedule/overlapAck";
import { attachInfo, type AttachInfo } from "../schedule/attachments";
import { cachedDraft, pregenerate, rememberDraft, PREGEN_CAP } from "../ai/pregen";
import { loadNudgeCounts, countNudge } from "../messages/escalate";
import { settleAll } from "../messages/settle";
import { decide } from "../messages/mailAction";
import { clearChase } from "../messages/followUp";
import { planFromBlock } from "../tasks/ifThen";
import { endOf, FIFTEEN } from "../tasks/rightNow";
import { acceptBody } from "../messages/meetingTimes";
import { welcomeBack, loadLastSeen, markSeen } from "./welcomeBack";
import { proposeFirstMove, nextStart, endsAt, ritualIsReady, whyNotReady, LENGTHS, DEFAULT_MINUTES, type Ritual } from "../tasks/startRitual";
import RitualSheet from "../tasks/screens/RitualSheet";
import { bestPerBlock, blockKind, recordBlend, loadBlendMemory } from "../schedule/blend";
import type { BlendMap } from "./YourDay";
import { loadMailSnapshot, mailNotices, type MailNotice } from "../messages/home";
import { showToast } from "../shared/toast";
import { attemptWrite } from "../shared/guard";
import RemindersStrip from "./RemindersStrip";
import ReminderSheet from "../tasks/screens/ReminderSheet";
import { todaysReminders, snoozeTime } from "../tasks/reminders";
import { remindersToIcs, downloadIcs } from "../tasks/ics";
import type { ReminderInfo } from "../notes/types";
import { runAutoSweep, retrySweep, undoSweep, readReceipt, setAsideCandidate, markOffered, liveMoved, dismissSweepCard, sweepCardDismissed, type SweepReceipt } from "../tasks/autoSweep";
import { restorableSpot, clearSpot, dismissSpot, spotAgo, type WorkSpot } from "../restore/whereYouWere";
import { isQuiet, goQuiet, localQuietStore } from "../shared/quietFor";

// "All its work is done" is an observation, not a verdict: a project he is
// deliberately holding open can refuse the Close It offer for a few days.
const closeOfferStore = localQuietStore("jarvis.closeoffer.dismissed.v1");
import DecisionCaptureSheet, { type AttachOption } from "../decisions/DecisionCaptureSheet";
import type { DecisionRecord } from "../decisions/types";
import { nowContext, gapFill, fmtSpan } from "./nowContext";
import { scheduleTask, breakDownTask as splitIntoSteps, undoBreakdown, splitLine, type BreakdownResult } from "../tasks/taskMoves";
import { identityToText } from "../ai/context";
import { useAIContext } from "../ai/useAIContext";
import { learnedDurations, readCommittedDurations } from "../schedule/learnedDurations";
import { readDraft, writeDraft, draftDay, draftIsStale, reflowDay, plannedTaskIds, acceptInto, seedFrom, editDraft, type DayDraft } from "../dayloop/dayLoop";
import { madeBy } from "../shared/provenance";
import { RowIcon, StatTiles } from "../shared/anatomy";
import { effectiveLevel } from "../ai/aiGate";
import { getAIControl } from "../ai/levelStore";
import { lazy, Suspense } from "react";
import { isOffTrack, rankOpen, reasonFor } from "../upnext/upnext";
import { backOnTrackMessage } from "../tasks/lifecycle";
import { moveEventToAnytime, undoMoveToAnytime, duplicateEvent } from "../schedule/eventMoves";
import { ClockGlyph, DocGlyph, ForkGlyph, SweepGlyph, TargetGlyph, CheckCircleGlyph } from "../shared/glyphs";
import { Clock, CircleSlash } from "../shared/icons";
import { useSwipe } from "../shared/useSwipe";

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
const UpNextFlow = lazy(() => import("../upnext/UpNextFlow"));
const FreshStartFlow = lazy(() => import("../upnext/FreshStartFlow"));

// Read-only aggregation over the (already tested) Schedule and Tasks services.
export default function TodayFlow({
  onGoSchedule,
  onGoTasks,
  onGoTasksAll,
  onGoTasksOverdue,
  onGoEmail,
  onSearch,
  onProfile,
  onEditRoutine,
  onRestoreSpot,
  onGoBigger,
}: {
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
  onSearch?: () => void;
  onProfile?: () => void;
  onEditRoutine?: (blockId?: string) => void;
  // Where You Were (addendum item 6): navigate back to a recorded spot.
  onRestoreSpot?: (kind: "note" | "task" | "event" | "gym", id: string) => void;
}) {
  const ai = useAI();
  const gatherContext = useAIContext();
  const google = useGoogle();
  const schedule = useSchedule();
  // Only ever read to answer "does the thing this bookmark names still
  // exist" (Law 1); Today renders no note content of its own.
  const notesSvc = useNotes();
  const tasks = useTasks();
  const profile = useProfile();
  const routine = useRoutine();
  const [routineData, setRoutineData] = useState<RoutineData>(DEFAULT_ROUTINE);
  const [routineSet, setRoutineSet] = useState(true);
  const [name, setName] = useState("");
  const [planCap, setPlanCap] = useState<number | undefined>(undefined);
  const [todayEvents, setTodayEvents] = useState<EventItem[]>([]);
  const [tomorrowEvents, setTomorrowEvents] = useState<EventItem[]>([]);
  const [allEvents, setAllEvents] = useState<EventItem[]>([]);
  const [taskItems, setTaskItems] = useState<TaskItem[]>([]);
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

  // Group A: Auto-Sweep receipt (item 9) and the Where You Were spot (item 6).
  const [sweepReceipt, setSweepReceipt] = useState<SweepReceipt | null>(null);
  const [spot, setSpot] = useState<WorkSpot | null>(null);
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
  const [eventSheet, setEventSheet] = useState<{ id: string; initial: EventDraft } | null>(null);
  // THE SAME TAP AS AN EVENT (2026-08-28, Dave: "when I click on something in
  // the schedule it should allow me to edit it like a normal scheduled
  // event"). Same shape as eventSheet above, for a protected block.
  const [blockSheet, setBlockSheet] = useState<{ id: string; initial: BlockDraft } | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [upNextOpen, setUpNextOpen] = useState(false);
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
    peopleSvc.list().then((ps) => { if (on) setBirthdays(birthdaysOn(ps, today)); }).catch(() => {});
    return () => { on = false; };
  }, [peopleSvc, today]);

  const reload = useCallback(async () => {
    // Self-healing dedupe (hotfix 2026-08-21): one plan event per task per
    // day, first-upcoming wins. Acts only on duplicates this read can see,
    // so a cold read heals nothing rather than deleting on absence.
    const dNow = new Date();
    await schedule.healPlanDuplicates(today, dNow.getHours() * 60 + dNow.getMinutes());
    await schedule.healPlanDuplicates(tmrw, null);
    const [te, tm, tk, prof, all] = await Promise.all([
      schedule.eventsOn(today),
      schedule.eventsOn(tmrw),
      tasks.listTasks(),
      profile.get(),
      schedule.listEvents(),
    ]);
    setTodayEvents(te);
    setTomorrowEvents(tm);
    setTaskItems(tk);
    setAllEvents(all);
    setName(prof?.name ?? "");
    setPlanCap(prof?.planCap ?? undefined);
    // Yesterday's evening mood sizes today's plan (Phase 2). Noon anchor keeps
    // the date subtraction clear of any midnight or DST edge.
    const y = new Date(today + "T12:00:00");
    y.setDate(y.getDate() - 1);
    setPrevMood(prof?.checkin?.[todayISO(y)]?.mood);
    setLoading(false);
  }, [schedule, tasks, profile, today, tmrw]);

  useEffect(() => { reload(); }, [reload]);

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
      showToast({ message: celebrationLine("task", id), actionLabel: "Undo", onAction: async () => { await attemptWrite(() => tasks.toggleDone(id)); await reload(); } });
    }
  };

  useEffect(() => {
    let on = true;
    cats.list().then((list) => { if (on) { setCategories(list.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color }))); setPausedCats(pausedCategoryIds(list)); setCatsFull(list); } });
    return () => { on = false; };
  }, [cats]);

  const onOpenTask = async (id: string) => {
    const t = await tasks.task(id);
    if (t) setSheet({ mode: "edit", id, initial: { text: t.text, category: t.category ?? "", due: t.due ?? "", repeat: t.recurrence ?? "" } });
  };

  // Tappable schedule rows (roadmap v2): an event on Today opens the same
  // editor the Schedule uses. Recurring edits from here apply to the series.
  const onOpenEvent = async (id: string) => {
    const e = await schedule.event(id);
    if (e) setEventSheet({ id, initial: { title: e.title, date: e.date, start: e.start, end: e.end ?? "", category: e.category ?? "", location: e.location ?? "", recurrence: e.recurrence ?? "none" } });
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

  const onPushTomorrow = async (id: string) => {
    let fromDate: string | undefined;
    const ok = await attemptWrite(async () => { const r = await pushEventTomorrowAdjust(id, schedule); fromDate = r.fromDate; });
    await reload();
    if (!ok || !fromDate) return;
    const from = fromDate;
    showToast({ message: "Moved to tomorrow", actionLabel: "Undo", onAction: async () => { await attemptWrite(() => undoPushEventTomorrowAdjust(id, from, schedule)); await reload(); } });
  };

  // THE SAME MOVES, FOR A PROTECTED BLOCK (2026-08-28, Dave: "It should
  // allow me to edit ALL schedule items THE FUCKING SAME"). Identical to
  // ScheduleFlow's copy: the routine is one record, so the write is always
  // "save the record back with this one block patched" and the undo is
  // always "save the record from before the patch."
  const onShiftBlock = async (id: string, mins: number) => {
    const before = routineData;
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

  const onSaveEvent = async (draft: EventDraft) => {
    if (!eventSheet) return;
    const id = eventSheet.id;
    await attemptWrite(async () => {
      await schedule.editTitle(id, draft.title);
      if ((eventSheet.initial.recurrence ?? "none") === "none") await schedule.moveDay(id, draft.date);
      await schedule.editTime(id, draft.start);
      await schedule.editEnd(id, draft.end);
      await schedule.editRecurrence(id, draft.recurrence);
      await schedule.editCategory(id, draft.category);
      await schedule.editLocation(id, draft.location);
    });
    setEventSheet(null);
    await reload();
  };

  const onDeleteEvent = async () => {
    if (!eventSheet) return;
    const e = await schedule.event(eventSheet.id);
    const ok = await attemptWrite(() => schedule.deleteEvent(eventSheet.id));
    setEventSheet(null);
    await reload();
    if (ok && e) {
      showToast({
        message: "Event deleted",
        actionLabel: "Undo",
        onAction: async () => {
          await attemptWrite(() => schedule.createEvent(e.title, { date: e.date, start: e.start, end: e.end, category: e.category || undefined, location: e.location, recurrence: e.recurrence }));
          await reload();
        },
      });
    }
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
    const madeTaskId = r.madeTaskId;
    showToast({
      message: "Moved to Anytime",
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(() => undoMoveToAnytime(kept, madeTaskId, schedule, tasks));
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
        await tasks.setCategory(sheet.id, draft.category);
        await tasks.setDue(sheet.id, draft.due || null);
        await tasks.setRecurrence(sheet.id, rec || null);
      });
    }
    setSheet(null);
    await reload();
  };

  const onDeleteTask = async () => {
    if (sheet?.mode === "edit") {
      const t = await tasks.task(sheet.id);
      const ok = await attemptWrite(() => tasks.deleteTask(sheet.id));
      if (ok && t) showToast({ message: "Task deleted", actionLabel: "Undo", onAction: async () => { await attemptWrite(() => tasks.createTask(t.text, { category: t.category || undefined, due: t.due ?? null, recurrence: t.recurrence })); await reload(); } });
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
  for (const e of todayEvents) {
    const info = attachInfo(e, taskItems);
    if (info) attachMap[e.id] = info;
  }
  const chrono = chronotypeFor(routineData);
  const peak = peakWindowFor(routineData, chrono);
  const energy = chrono !== "neutral" ? { chronotype: chrono, peakStartMin: peak.s, peakEndMin: peak.e } : undefined;
  const sizing = daySizing(prevMood);
  const onAIPlan = ai.available
    ? (picks: { id: string; text: string; category: string; overdue: boolean }[], s: number, e: number) => aiPlanDay(ai, picks, planEvents, s, e, {
        work: { startMin: routineData.workStartMin, endMin: routineData.workEndMin },
        energy,
        gentle: sizing.light,
      })
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
    if (r.reason === "no-ai") { showToast({ message: "Couldn't reach JARVIS" }); return; }
    showToast({
      message: splitLine(r.made.length),
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(() => undoBreakdown(r.made, r.original, tasks));
        await reload();
      },
    });
  };

  const onPlanCommit = async (blocks: { taskId: string; text: string; category: string; start: string; end: string }[], picks: string[]) => {
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
  useEffect(() => {
    const inputs = notifyPrefs.events
      ? [
          ...todayEvents.map((e) => ({ date: today, start: e.data.start, title: e.data.title, location: e.data.location })),
          ...tomorrowEvents.map((e) => ({ date: tomorrow, start: e.data.start, title: e.data.title, location: e.data.location })),
        ]
      : []; // pref off: an empty schedule cancels whatever was pending
    void ensureEventReminders(inputs);
  }, [todayEvents, tomorrowEvents, today, tomorrow, notifyPrefs.events]);

  // Running Late lands on Today too (2026-08-09): the plan lives here, so the
  // one-tap recovery for falling behind has to live here. Same shared shift
  // as the Schedule tab, recurring events left in place, full Undo.
  const onRunningLate = async (mins: number) => {
    const { moved, skipped, prior } = await shiftFutureEvents(schedule, todayEvents, nhm, mins);
    if (moved === 0) return;
    await reload();
    showToast({
      message: `${moved} ${moved === 1 ? "event" : "events"} +${mins === 60 ? "1 hr" : mins + " min"}${skipped ? ` · ${skipped} repeating stayed` : ""}`,
      actionLabel: "Undo",
      onAction: async () => { await restoreShift(schedule, prior); await reload(); },
    });
  };

  // NOTE (hotfix 2026-08-15): the loading return must sit BELOW every hook.
  // It briefly lived here, above the Day Loop effects, which is a hooks-order
  // violation (React #310): the first render bailed early, the second ran
  // more hooks, and the error boundary swallowed the whole app. The return
  // now lives after the last effect; everything between here and there is
  // pure derivation that is safe on empty loading-state data.
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
  const upNextAll = rankOpen(taskItems, today);
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
  const completionsToday = samples.filter((s) => s.t >= dayStart && s.t < dayStart + 86400000).length;
  // THE HOME PAGE LOOKS UP (Dave 2026-08-22, picks 1-5 and 31). One index per
  // render pass, shared by the hero pill, the Now card, both new notices and
  // the evening line, so no two of them can disagree about what moves what.
  const goalIdx = buildGoalIndex(projList, liveGoals(goalList));
  const goalReach = (id: string) => {
    const g = goalList.find((x) => x.id === id);
    return g ? reachOf(taskItems, projList, g) : { filedIds: [], taggedIds: [], openTagged: 0, progress: null };
  };
  const movedGoals = goalsMovedToday(goalIdx, taskItems, samples, dayStart, dayStart + 86400000);
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
  // PICK 3: the goal nothing on today's plate touches. goalNudgeTick lets a
  // dismissal re-derive without a reload.
  void goalNudgeTick; // re-derive after a dismissal (same pattern as dismissTick)
  const untouched = untouchedGoal(goalIdx, goalList, goalReach, todaysTasks(taskItems, today), today);
  const evening = isEvening(nowMin, routineData) ? eveningStats(todayEvents, taskItems, today, nhm, completionsToday) : undefined;
  const weekly = evening ? weekRecap(samples, allEvents, today) : null;
  // Day ring: due-today done over due-today total. Hero tint by daypart.
  const dueToday = taskItems.filter((t) => t.data.due === today);
  const ring = { done: dueToday.filter((t) => t.data.done).length, total: dueToday.length };
  // GROUP A banners (items 6 and 9), above the day. Success is quiet;
  // failure is louder, and tappable to retry.
  // LAW 1: every read of the sweep receipt for DISPLAY goes through
  // liveMoved first, against the live task list. The receipt itself stays
  // whole -- Undo needs every entry it wrote, including the ones since
  // handled -- but no card is allowed to speak about a task that is done,
  // deleted, or has moved on. See autoSweep.ts for the full reasoning.
  void sweepDismissTick; // re-derive after a sweep-card dismissal
  const movedNow = liveMoved(sweepReceipt, taskItems, today);
  const sweepCand = sweepReceipt && !sweepReceipt.failed ? setAsideCandidate(movedNow, today) : null;
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
    let ids: string[] = [];
    const ok = await attemptWrite(async () => {
      ids = (await schedule.commitPlan(today, dayDraft.blocks.map((b) => ({
        taskId: b.taskId, text: b.text, category: b.category, start: b.start, end: b.end,
        // Accept the Day IS committing a day plan (audit 2026-08-25): picks
        // ride the one event door in the card's own order.
      })), madeBy("plan"), { picks: dayDraft.blocks.map((b) => b.taskId) })).created;
    });
    if (!ok) return;
    const next = { ...dayDraft, accepted: true, eventIds: ids };
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
  const slippedCount = planEvs.filter((e) => {
    const p = e.data.start.split(":");
    return Number(p[0]) * 60 + Number(p[1]) < nowMin;
  }).length;

  const runReflow = useCallback(async () => {
    if (!dayDraft?.accepted) return;
    const res = reflowDay(planEvs, otherEvs, nowMin, todayWindow.endMin, hardRanges);
    if (res.moves.length === 0 && res.overflow.length === 0) return;
    const ok = await attemptWrite(async () => {
      for (const m of res.moves) {
        await schedule.editTime(m.eventId, m.start);
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
  }, [dayDraft, todayEvents, nowMin]);

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
  const [remSheet, setRemSheet] = useState<{ mode: "new" } | { mode: "edit"; id: string; text: string; reminder: ReminderInfo } | null>(null);

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

  const jobFor = (n: { kind: string; threadId: string }) =>
    cardDraftJob(n, loadMailSnapshot(), loadNudgeCounts(), nudgeInstruction,
      (messages, system) => ai.complete(messages as { role: "user" | "assistant"; content: string }[], system));

  //
  // The list is derived with the SAME mailNotices() call MailNotices renders
  // from, so the drafts that get warmed are the cards he can actually see. A
  // separate ranking here would warm the wrong five.
  // The Now suggestion's swipe (2026-08-25, pick 5A). Same controller every
  // other swipe row uses, so the gesture and its distances match the rest of
  // the app rather than being a second implementation on the home page.
  const nowSwipe = useSwipe({ revealW: 176 });

  const pregenRan = useRef(false);
  useEffect(() => {
    if (pregenRan.current || !ai.available) return;
    const snap = loadMailSnapshot();
    if (snap.threads.length === 0 && snap.waiting.length === 0) return;
    pregenRan.current = true;
    const jobs = mailNotices(snap, today, new Date(), PREGEN_CAP)
      .filter((n) => n.kind === "reply" || n.kind === "deadline" || n.kind === "nudge" || n.kind === "chase")
      .map((n) => jobFor(n))
      .filter((j): j is NonNullable<typeof j> => !!j);
    if (jobs.length) void pregenerate(jobs);
    // Deliberately not depending on the snapshot: this is a once-per-open
    // warm-up, and re-running it whenever mail reloads would turn a capped
    // background pass into a loop that spends five calls per refresh. The
    // pregenRan ref makes that true even if the deps below ever grow.
  }, [ai.available, today]);

  if (loading) return <SkeletonScreen />;
  if (reportOpen) {
    return <ReportFlow onBack={() => { setReportOpen(false); void reload(); }} onOpenTask={(id) => { setReportOpen(false); void onOpenTask(id); }} />;
  }

  // GROUP B (items 10-11): the Now line and the gap offer, derived fresh
  // every render (and the minute tick keeps renders coming).
  const nowCtx = nowContext(todayEvents, blocked, nhm);
  const estimates = learnedDurations(readCommittedDurations(), Date.now());
  const gapKey = today + ":" + (nowCtx.nextStart ?? "end");
  // Pick 1 + pick 31: the goal this gap task moves, when naming it says
  // something the task title did not already say.
  const gapPick = evening || gapDismissed === gapKey
    ? null
    : gapFill(
        taskItems.map((t) => ({ id: t.id, text: t.data.text, category: t.data.category ?? "", done: t.data.done, due: t.data.due, bill: t.data.bill })),
        nowCtx.gapMin,
        today,
        (cat) => estimates[cat] ?? 45,
      );
  const gapTask = gapPick ? taskItems.find((t) => t.id === gapPick.id) ?? null : null;
  const gapMoves = gapTask ? movesLine(goalTitleForTask(goalIdx, gapTask), gapTask.data.text) : null;

  // Approved V2 anatomy (preview 2026-08-15): the free window reads as two
  // stat tiles (sky until, green open); inside an event the event tile leads;
  // the gap task carries its blue type tile and an accent Start.
  const shortSpan = (min: number): string => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h === 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  };
  const nowSection = !evening && (
    <>
      <div className="pad-x"><div className="card">
        {nowCtx.gapMin !== null && nowCtx.nextStart ? (
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
          <div className="now-line-one">
            <span className="now-gap">{shortSpan(nowCtx.gapMin)} open</span>
            <span className="now-until">
              &middot; until {nowCtx.nextTitle ?? "your next event"} {fmtTime(nowCtx.nextStart).time} {fmtTime(nowCtx.nextStart).ap}
            </span>
          </div>
          {gapPick ? (
            // The task name and its buttons do NOT share a line. On a 390px
            // phone two pills plus a title truncated the title to "Create B...",
            // which is the one piece of information the card exists to carry.
            // START RIDES THE ROW; THE OTHER TWO ARE A SWIPE (Dave 2026-08-25,
            // pick 5A). The note this replaces was right at the time: two
            // pills PLUS a title truncated the title to "Create B...", the one
            // thing the card exists to say. One pill is a different sum, and
            // .pill-act caps itself at 9.5rem so the title keeps the rest.
            //
            // Set a Start and Not Now move to the swipe every other row in this
            // app already uses for its secondary actions, so nothing new is
            // being taught and the card gets ~280px back.
            <div className="task-swipe now-swipe">
              <button className="task-snooze" onClick={() => setRitual({
                taskId: gapPick.id,
                text: gapPick.text,
                firstMove: proposeFirstMove(gapPick.text),
                startHHMM: nextStart(nhm),
                minutes: DEFAULT_MINUTES,
              })} aria-label="Set a start time">
                <Clock className="ic" />
                <span className="swipe-label">Set a Start</span>
              </button>
              <button className="task-del" onClick={() => setGapDismissed(gapKey)} aria-label="Not now">
                <CircleSlash className="ic" />
                <span className="swipe-label">Not Now</span>
              </button>
              <div
                className={"task-row now-row" + (nowSwipe.dragging ? " swiping" : "")}
                style={nowSwipe.dx ? { transform: `translateX(${nowSwipe.dx}px)` } : undefined}
                {...nowSwipe.handlers}
              >
                <RowIcon kind="task" />
                <div className="row-stack">
                  <div className="conn-name truncate">{gapPick.text}</div>
                  {/* PICK 1: NOW SAYS WHAT IT MOVES (Dave 2026-08-22). "Fits
                      this gap" is the card's own premise restated: it is IN
                      the gap, he can see that. When the task points at a goal,
                      that slot carries the one thing he cannot see from here,
                      and pick 31 keeps it quiet when the goal only repeats the
                      task's own words. Two dot segments, never three: a third
                      wraps on a 390px phone. */}
                  <div className="conn-meta truncate">{gapPick.estimateMin} min · {gapMoves ?? "Fits this gap"}</div>
                </div>
                {/* B15 (2026-08-23): red TEXT, not a red fill. Start opens one
                    task. On a screen where Accept the Day commits every hour of
                    the day, the fill belongs to the bigger move. */}
                <button className="pill-act" onClick={(e) => { e.stopPropagation(); void onOpenTask(gapPick.id); }}>Start</button>
              </div>
            </div>
          ) : (
            // NO DEAD ENDS IN NOW (Dave 2026-08-19, "the more I can do without
            // thinking, the better"): when nothing is teed up, Now still hands
            // him the one-tap way in instead of stating the time and stopping.
            <div className="row">
              <div className="momentum-actions">
                {/* MERGE B: Plan My Day used to sit here as well as in the
                    day's own button row a few hundred pixels below, which is
                    the same verb twice in one section. This card is about the
                    next few minutes; planning the day belongs to the day. */}
                <button className="pill-act" onClick={() => setUpNextOpen(true)}>Pick Something</button>
              </div>
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
          <div className="row">
            <RowIcon kind="event" />
            <div className="row-stack">
              {(() => {
                const at = nowCtx.line.lastIndexOf(" until ");
                if (at < 0) return <div className="conn-name truncate">{nowCtx.line}</div>;
                return (
                  <>
                    <div className="conn-name truncate">{nowCtx.line.slice(0, at)}</div>
                    <div className="conn-meta truncate">{nowCtx.line.slice(at + 1)}</div>
                  </>
                );
              })()}
            </div>
            <button className="pill-act" onClick={() => setUpNextOpen(true)}>Pick Something</button>
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
  const draftStanding = !evening && dayDraft && !dayDraft.accepted && !dayDraft.dismissed && dayDraft.blocks.length > 0;

  const proposedDay = draftStanding ? {
    blocks: dayDraft.blocks,
    openId: tuning,
    onToggle: (id: string) => setTuning((t) => (t === id ? null : id)),
    onDuration: (id: string, minutes: number) => applyEdit({ minutes: { [id]: minutes } }),
    onDrop: (id: string) => { setTuning(null); applyEdit({ drop: id }); },
  } : undefined;

  const draftFooter = draftStanding ? (
    <>
      {dayDraft.anytime.length > 0 && (
        <>
          <div className="row">
            <button className="draft-more" aria-expanded={draftMoreOpen} onClick={() => setDraftMoreOpen((o) => !o)}>
              <span className="t">{capAfterNumber(`${dayDraft.anytime.length} more in Anytime`)}</span>
              <div className={"chev chev-down" + (draftMoreOpen ? " chev-open" : "")} />
            </button>
          </div>
          {draftMoreOpen && dayDraft.anytime.map((a) => (
            <div className="row" key={a.id}>
              <RowIcon kind="task" />
              <div className="row-grow"><div className="conn-name truncate">{a.text}</div></div>
              <button className="pill-act" onClick={() => applyEdit({ add: a.id })}>Add</button>
            </div>
          ))}
        </>
      )}
      {/* Two buttons, not three: Your Day already carries Plan My Day above
          the list, and a More Options here would be a second door to the
          same sheet on one screen. */}
      <div className="day-foot">
        <button className="btn btn-primary btn-sm" onClick={() => void acceptDraft()}>Accept the Day</button>
        <button className="btn-sm" onClick={dismissDraft}>Not Today</button>
      </div>
    </>
  ) : null;

  // Slippage stated out loud below Everything; automatic (receipted) at it.
  const reflowSection = !evening && dayDraft?.accepted && slippedCount > 0 && effectiveLevel(getAIControl()) !== "everything" && (
    <NoticeCard
      weight={WAITING}
      icon={SWEEP_ICO}
      tone="cat-fg-orange"
      title={slippedCount === 1 ? "1 Block Slipped" : `${slippedCount} Blocks Slipped`}
      sub="The plan is behind the clock"
      action={{ label: "Re-Flow", onClick: () => void runReflow() }}
    />
  );

  const overflowSection = overflowOffer && (
    <NoticeCard
      weight={FAILING}
      icon={SWEEP_ICO}
      tone="cat-fg-orange"
      title={overflowOffer.title}
      sub="No room left today"
      action={{ label: "Leave It", onClick: () => setOverflowOffer(null) }}
      alt={{
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
  const back = welcomeBack(lastSeenRef.current, today, sweepReceipt?.moved.length ?? 0);
  const alertCards = [
    // The welcome-back recap is a RECEIPT: it reports, it does not ask.
    // One quiet line; tapping it opens the pile it describes.
    back ? (
      <button key="back" data-receipt className="receipt-line" onClick={() => setUpNextOpen(true)}>
        <span className="rl-t">{back.title} · {back.sub}</span>
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
        action={{ label: "Still Good", onClick: () => void stillGood(revisit) }}
        alt={{ label: "Change It", onClick: () => setRevisitSheet(true) }}
      />
    ) : null,
    sweepReceipt && sweepReceipt.failed ? (
      <NoticeCard
        key="sweepfail"
        weight={FAILING}
        icon={SWEEP_ICO}
        tone="cat-fg-red"
        title="Couldn't Move Yesterday's Tasks"
        sub="Nothing was lost · Try again"
        action={{
          label: "Retry",
          onClick: () => void (async () => { setSweepReceipt(await retrySweep(tasks, today)); await reload(); })(),
        }}
      />
    ) : null,
    sweepReceipt && !sweepReceipt.failed && unplannedMoved.length > 0 && !sweepCardDismissed(today) ? (
      <NoticeCard
        key="sweep"
        weight={NEW}
        icon={SWEEP_ICO}
        tone="cat-fg-orange"
        // The count is of what still needs a time, not of what moved: the
        // plan card above already holds the rest, and "5 Moved to Today"
        // beside a card that has timed four of them is a false alarm.
        title={unplannedMoved.length === 1 ? "1 Moved to Today" : `${unplannedMoved.length} Moved to Today`}
        sub={unplannedMoved.length > 1 ? "No times yet" : undefined}
        action={{
          // PLAN THEM (2026-08-21). Seven untimed tasks arriving at once is
          // exactly how a day turns into the one Dave photographed. The list
          // is already assembled and the planner already takes a list, so
          // the forward move costs nothing.
          label: "Plan Them",
          onClick: () => void openPlan("today"),
        }}
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
        heat="warm"
        onOpen={() => { markOffered(sweepCand.id, today); void onOpenTask(sweepCand.id); }}
        // Quiet for DISMISS_DAYS, not forever: the old markOffered list had
        // no expiry, so one dismissal meant this task could never be flagged
        // again however long it kept sliding (Law 2).
        onDismiss={() => { markOffered(sweepCand.id, today); setSweepDismissTick((n) => n + 1); }}
      />
    ) : null,
    spot ? (
      <NoticeCard
        key="spot"
        weight={RESUME}
        icon={DOC_ICO}
        tone="cat-fg-yellow"
        title={spot.label}
        sub={spotAgo(spot)}
        action={{ label: "Resume", onClick: () => { clearSpot(); setSpot(null); onRestoreSpot?.(spot.kind, spot.id); } }}
        // LAW 2: this card had no dismiss at all -- its swipe rail was
        // empty, so the only exits were taking it or waiting out twelve
        // hours, and every visit longer than five minutes ago re-armed it.
        onDismiss={() => { dismissSpot(spot); setSpot(null); }}
      />
    ) : null,
    // PICK 2: A FINISHED THING SURFACES WHERE HE IS (Dave 2026-08-22). Wave 1
    // taught the Bigger Picture to offer Close It on a project whose work is
    // done. That only helps on a page he has no reason to open, and the whole
    // complaint was that the bigger picture is invisible. The last tick of
    // the last task IS the moment; it happens here, so the offer belongs
    // here. One at a time, and it disappears the instant it is taken.
    finishedProject ? (
      <NoticeCard
        key="finished"
        weight={NEW}
        icon={WIN_ICO}
        tone="cat-fg-green"
        title={finishedProject.project.data.title}
        sub={capAfterNumber(`All ${finishedProject.progress?.total ?? 0} done`)}
        action={{ label: "Close It", onClick: () => void closeProject(finishedProject.project.id) }}
        // LAW 2 (2026-08-29): "every task in it is finished" is not the same
        // claim as "the project is over", and a project he is deliberately
        // keeping open had no way to say so -- the card returned every day
        // until he closed something he did not want closed. Quiet for three
        // days, the same window every other dismissal here uses.
        onDismiss={() => { goQuiet(finishedProject.project.id, today, closeOfferStore); setSweepDismissTick((n) => n + 1); }}
      />
    ) : null,
    // PICK 3: THE GOAL NOTHING TODAY TOUCHES. Not a scolding and not a
    // streak: one line of arithmetic he cannot see anywhere else, because
    // nothing on this page has ever mentioned a goal. Quiet for three days
    // when waved off, and silent entirely on a day whose plate already
    // covers every goal, which is the normal case.
    untouched ? (
      <NoticeCard
        key="goalnudge"
        /* HISTORY: this pinned form="card" so the goal's own words could
           wrap ("Run three times a week" shredded on the row form,
           2026-08-25). The pin is repealed in the stream (Dave 2026-08-26,
           Option 1: one-line rows, tap expands to the full card in place),
           so the stream rows this down like everything else; the evidence
           line comes back on the expand. */
        weight={RESUME}
        icon={GOAL_ICO}
        tone="cat-fg-purple"
        title={untouched.data.title}
        sub={untouchedLine(openWorkOf(goalReach(untouched.id)))}
        // "Pick One", not "Pick Something" (2026-08-25). Measured on the
        // uniform card: the longer label took 139px of a 358px row and left
        // the goal's own name 133px when it needed 202, so a two-word button
        // was eating the sentence it was attached to. Same verb, same
        // meaning, and it matches Pick One on Tasks (which took this
        // shorter name itself on 2026-08-26, so the two are now identical).
        action={{ label: "Pick One", onClick: () => onGoBigger?.(untouched.id) }}
        onDismiss={() => { dismissGoalNudge(untouched.id, today); setGoalNudgeTick((n) => n + 1); }}
      />
    ) : null,
  ].filter(Boolean);
  // --- Reminders (2026-08-19). Everything here writes a date, never a
  // boolean, so a reminder resets itself at midnight with nothing scheduled.
  const reminders = todaysReminders(taskItems, today, nhm);

  const onTickReminder = async (id: string, done: boolean) => {
    await attemptWrite(() => (done ? tasks.tickReminder(id, today) : tasks.untickReminder(id)));
    await reload();
  };
  const onSnoozeReminder = async (id: string) => {
    const v = reminders.find((r) => r.id === id);
    if (!v) return;
    const to = snoozeTime(v.time, 10);
    await attemptWrite(() => tasks.snoozeReminder(id, to, today));
    await reload();
    showToast({ message: "Snoozed to " + to });
  };
  const onSaveReminder = async (text: string, r: ReminderInfo) => {
    const sheet = remSheet;
    setRemSheet(null);
    if (!sheet) return;
    if (sheet.mode === "new") await attemptWrite(() => tasks.createReminder(text, r));
    else await attemptWrite(async () => { await tasks.editText(sheet.id, text); await tasks.editReminder(sheet.id, r); });
    await reload();
  };
  // B10 (2026-08-23): guarded already, but silent and final. A reminder is one
  // row with everything about it on the client, so it takes the same Undo the
  // event delete four hundred lines up already offers.
  const onDeleteReminder = async () => {
    const sheet = remSheet;
    setRemSheet(null);
    if (!sheet || sheet.mode !== "edit") return;
    // The sheet already carries the text and the reminder it was editing, so
    // the snapshot costs nothing and cannot go stale.
    const { text: keptText, reminder: keptRem } = sheet;
    const ok = await attemptWrite(() => tasks.deleteTask(sheet.id));
    await reload();
    if (ok) {
      showToast({
        message: "Reminder deleted",
        actionLabel: "Undo",
        onAction: async () => {
          await attemptWrite(() => tasks.createReminder(keptText, keptRem));
          await reload();
        },
      });
    }
    showToast({ message: "Reminder deleted" });
  };
  // CALENDAR HANDOFF: the only way a reminder can actually go off on an
  // iPhone today without a native build. iOS owns the alarm from here, which
  // means it fires offline, with JARVIS closed, forever.
  const addRemindersToCalendar = (ids?: string[]) => {
    const picked = taskItems.filter((t) => t.data.reminder && (!ids || ids.includes(t.id)));
    if (picked.length === 0) return;
    const ics = remindersToIcs(
      picked.map((t) => ({ id: t.id, text: t.data.text, reminder: t.data.reminder! })),
      today,
    );
    downloadIcs(ics, picked.length === 1 ? "jarvis-reminder.ics" : "jarvis-reminders.ics");
    showToast({ message: "Opening Calendar · Tap Add to confirm" });
  };

  const openReminder = (id: string) => {
    const t = taskItems.find((x) => x.id === id);
    if (t?.data.reminder) setRemSheet({ mode: "edit", id, text: t.data.text, reminder: t.data.reminder });
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

  const sendFromCard = async (n: { kind: string; threadId: string }, body: string): Promise<boolean> => {
    const api = mailApiFor(n.threadId);
    if (!api) return false;
    try {
      const full = mapThreadFull(await api.getThread(n.threadId));
      const last = full.messages[full.messages.length - 1];
      if (!last) return false;
      // A nudge goes to whoever the last message was addressed TO; a reply
      // goes back to whoever wrote it. Getting this backwards would send his
      // follow-up to himself, so it is derived, never assumed.
      const reply = buildReply(last, body);
      const to = n.kind === "nudge" ? (last.to || reply.to) : reply.to;
      await api.sendMessage(encodeEmail({ to, subject: reply.subject, body, inReplyTo: reply.inReplyTo }), full.id);
      // The ladder climbs on what was actually SENT, so it cannot be gamed
      // by opening the drafter and closing it again. A chase he set retires
      // itself the moment it is answered.
      if (n.kind !== "reply") countNudge(n.threadId);
      if (n.kind === "chase") clearChase(n.threadId);
      return true;
    } catch {
      return false;
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
    const sent = await sendFromCard({ kind: "reply", threadId }, acceptBody({ ...m, free: true }));
    return sent ? "Booked and replied" : "Booked · Couldn't send the reply";
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
  const startFifteen = async (t: TaskItem) => {
    const start = nhm;
    // commitPlan: starting on it NOW supersedes any block the planner had
    // parked later in the day; one plan event per task per day.
    const id = await attemptWrite(() => schedule.commitPlan(today, [{
      taskId: t.id, text: t.data.text, category: t.data.category ?? "",
      start, end: endOf(start, FIFTEEN),
    }]));
    await reload();
    if (id) showToast({ message: `Fifteen minutes on ${t.data.text}` });
  };

  // PICK 26 (Dave 2026-08-22): an email-born task lands with its lineage.
  // Not a guess: the ONLY signal used is that a task from this same thread
  // already exists and somebody already filed it. The first task off a thread
  // inherits nothing, which is correct, because there is nothing to inherit
  // yet; every one after it joins its sibling. See messages/threadTasks.ts.
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
  // A missed reminder does NOT get its own notice card. The strip is on this
  // same screen, so a card here would show the identical reminder twice, and
  // duplicated notices are precisely what "there's a ton of notifications
  // floating around" meant. The strip carries the missed state itself.
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
      action={{ label: "Read It", onClick: () => setReportOpen(true) }}
      // LAW 2 (2026-08-29): it had no way out. Reading the report marked it
      // seen; NOT wanting to read it had no expression at all, so the card
      // sat there every day until he gave in. Dismiss marks the same month
      // seen -- "I have dealt with this" is the same fact either way -- and
      // next month's report is a new card.
      onDismiss={() => { markReportSeen(reportMonth); setReportMonth(null); }}
    />
  ) : null;
  const notices = [reportNotice, ...alertCards, reflowSection, overflowSection].filter(Boolean);

  const daypart = evening ? "evening" as const : now.getHours() < 12 ? "morning" as const : null;
  const initials = name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "JV";
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
      evening={evening}
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
      blendMap={blendMap}
      onStartTask={(id) => {
        const t = taskItems.find((x) => x.id === id);
        if (t) void startFifteen(t);
      }}
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
      onPayBill={() => {
        const next = billsDueSoon(taskItems, today)[0];
        if (next) void onToggleTask(next.id);
      }}
      freshStart={offTrack ? () => setFreshOpen(true) : undefined}
      locked={blocked}
      onOpenEvent={onOpenEvent}
      onEditRoutine={onEditRoutine}
      onOpenBlock={onOpenBlock}
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
      today={today}
      nowCard={nowSection}
      proposedDay={proposedDay}
      dayFooter={draftFooter}
      reminders={
        <RemindersStrip
          items={reminders}
          onTick={(id, done) => void onTickReminder(id, done)}
          onSnooze={(id) => void onSnoozeReminder(id)}
          onAdd={() => setRemSheet({ mode: "new" })}
          onOpen={openReminder}
          onAddAllToCalendar={() => addRemindersToCalendar()}
        />
      }
      notices={notices}
      offersQuiet={notices.length >= 2}
      // TWO notices, not one glued pair. Bundling them into a single slot
      // put an AI suggestion immediately under the check-in's mood chips with
      // nothing between them, so the suggestion read as part of the question.
      // They are unrelated: one asks how today felt, the other proposes work.
      checkIn={<CheckIn onChanged={() => { void reload(); }} />}
      onSearch={onSearch}
      onProfile={onProfile}
      onSeeAllSchedule={onGoSchedule}
      onSeeAllTasks={onGoTasks}
      onSeeAllOverdue={onGoTasksOverdue}
      onGoBigger={onGoBigger ? () => onGoBigger() : undefined}
      movedLine={movedLine(movedGoals)}
      avatar={initials}
      birthdays={birthdays}
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
    {sheet && (
      <TaskSheet
        mode="edit"
        initial={sheet.initial}
        categories={categories}
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
        <UpNextFlow onClose={() => { setUpNextOpen(false); void reload(); }} />
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
            await reload();
            if (ok) showToast({ message: `Starts ${r.startHHMM} · ${r.firstMove}` });
          })();
        }}
      />
    )}
    {remSheet && (
      <ReminderSheet
        mode={remSheet.mode}
        initial={remSheet.mode === "edit" ? { text: remSheet.text, reminder: remSheet.reminder } : undefined}
        onSave={(text, r) => void onSaveReminder(text, r)}
        onDelete={remSheet.mode === "edit" ? () => void onDeleteReminder() : undefined}
        onAddToCalendar={remSheet.mode === "edit" ? () => addRemindersToCalendar([remSheet.id]) : undefined}
        onCancel={() => setRemSheet(null)}
      />
    )}
    </>
  );
}

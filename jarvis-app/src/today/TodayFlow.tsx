import { useCallback, useEffect, useRef, useState } from "react";
import { useSchedule, useTasks, useProfile, useCategories, useRoutine, usePeople, useProjects, useGoals, useDecisions } from "../data/NotesProvider";
import { pausedCategoryIds, effectiveKind } from "../categories/kinds";
import { goalTitleOf, workWindowOf, isSuggested, rankCandidates } from "../schedule/planMeta";
import type { Category } from "../categories/types";
import type { Project } from "../projects/types";
import type { Goal } from "../life/types";
import { todayISO, fmtTime } from "../schedule/calendar";
import type { EventItem } from "../schedule/types";
import type { TaskItem } from "../tasks/TasksService";
import { greetingFor, longDate, shortDate } from "./greeting";
import { tomorrowISO, nowHHMM, daySummary, todaysTasks, billsLine, billsDueSoon } from "./todayData";
import TodayPage from "./TodayPage";
import MailNotices from "./MailNotices";
import NoticeCard from "./NoticeCard";
import { capAfterNumber } from "../shared/casing";
import { birthdaysOn, type BirthdayHit } from "../people/birthdays";
import TodaySuggestions from "./TodaySuggestions";
import CheckIn from "./CheckIn";
import TaskSheet, { type SheetCategory, type TaskDraft } from "../tasks/screens/TaskSheet";
import EventSheet, { type EventDraft } from "../schedule/screens/EventSheet";
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
import SkeletonScreen from "../shared/SkeletonScreen";
import type { Recurrence } from "../notes/types";
import { useAI } from "../ai/useAI";
import { useGoogle } from "../connections/google/GoogleSession";
import { mapThreadFull, buildReply, encodeEmail } from "../connections/google/map";
import { cardReplyPrompt, cardNudgePrompt, parseCardDraft } from "../messages/cardDraft";
import { ladderFor, loadNudgeCounts, countNudge } from "../messages/escalate";
import { clearChase } from "../messages/followUp";
import { acceptBody } from "../messages/meetingTimes";
import { loadMailSnapshot } from "../messages/home";
import { showToast } from "../shared/toast";
import { attemptWrite } from "../shared/guard";
import RemindersStrip from "./RemindersStrip";
import ReminderSheet from "../tasks/screens/ReminderSheet";
import { todaysReminders, snoozeTime } from "../tasks/reminders";
import { remindersToIcs, downloadIcs } from "../tasks/ics";
import type { ReminderInfo } from "../notes/types";
import { runAutoSweep, retrySweep, undoSweep, readReceipt, setAsideCandidate, markOffered, type SweepReceipt } from "../tasks/autoSweep";
import { restorableSpot, clearSpot, spotMeta, type WorkSpot } from "../restore/whereYouWere";
import DecisionCaptureSheet, { type AttachOption } from "../decisions/DecisionCaptureSheet";
import type { DecisionRecord } from "../decisions/types";
import { nowContext, gapFill, fmtSpan } from "./nowContext";
import { learnedDurations, readCommittedDurations } from "../schedule/learnedDurations";
import { readDraft, writeDraft, draftDay, reflowDay, type DayDraft } from "../dayloop/dayLoop";
import { madeBy } from "../shared/provenance";
import { RowIcon, StatTiles } from "../shared/anatomy";
import { effectiveLevel } from "../ai/aiGate";
import { getAIControl } from "../ai/levelStore";
import { lazy, Suspense } from "react";
import { isOffTrack, rankOpen } from "../upnext/upnext";
import { backOnTrackMessage } from "../tasks/lifecycle";

// Up Next and Fresh Start (ADHD strategy Phase 1) load on demand: they are
// overlays, not tabs, and stay out of the boot bundle.
const SPARK_ICO = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /></svg>
);
const CLOCK_ICO = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
);
// Double chevrons: things carried forward (sweep, slip, re-flow).
const SWEEP_ICO = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="13 17 18 12 13 7" /><polyline points="6 17 11 12 6 7" /></svg>
);
// A fork with one path taken: the Decision Record mark (matches anatomy.tsx).
const FORK_ICO = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>
);
const UpNextFlow = lazy(() => import("../upnext/UpNextFlow"));
const FreshStartFlow = lazy(() => import("../upnext/FreshStartFlow"));

// Read-only aggregation over the (already tested) Schedule and Tasks services.
export default function TodayFlow({
  onGoSchedule,
  onGoTasks,
  onGoTasksAll,
  onGoEmail,
  onSearch,
  onProfile,
  onEditRoutine,
  onRestoreSpot,
}: {
  onGoSchedule: () => void;
  onGoTasks: () => void;
  onGoTasksAll?: () => void;
  onGoEmail?: (threadId?: string) => void;
  onSearch?: () => void;
  onProfile?: () => void;
  onEditRoutine?: () => void;
  // Where You Were (addendum item 6): navigate back to a recorded spot.
  onRestoreSpot?: (kind: "note" | "task" | "event" | "gym", id: string) => void;
}) {
  const ai = useAI();
  const google = useGoogle();
  const schedule = useSchedule();
  const tasks = useTasks();
  const profile = useProfile();
  const routine = useRoutine();
  const [routineData, setRoutineData] = useState<RoutineData>(DEFAULT_ROUTINE);
  const [routineSet, setRoutineSet] = useState(true);
  const [name, setName] = useState("");
  const [todayEvents, setTodayEvents] = useState<EventItem[]>([]);
  const [tomorrowEvents, setTomorrowEvents] = useState<EventItem[]>([]);
  const [allEvents, setAllEvents] = useState<EventItem[]>([]);
  const [taskItems, setTaskItems] = useState<TaskItem[]>([]);
  const [prevMood, setPrevMood] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  // Group C (item 14): the Day Loop's draft for today.
  const [dayDraft, setDayDraft] = useState<DayDraft | null>(null);
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
    setSpot(restorableSpot());
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
  const [goalList, setGoalList] = useState<Goal[]>([]);
  useEffect(() => {
    let on = true;
    Promise.all([projectsSvc.list(), goalsSvc.list()]).then(([p, g]) => { if (on) { setProjList(p); setGoalList(g); } });
    return () => { on = false; };
  }, [projectsSvc, goalsSvc]);
  const [sheet, setSheet] = useState<{ mode: "edit"; id: string; initial: TaskDraft } | null>(null);
  const [eventSheet, setEventSheet] = useState<{ id: string; initial: EventDraft } | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [upNextOpen, setUpNextOpen] = useState(false);
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
    // Yesterday's evening mood sizes today's plan (Phase 2). Noon anchor keeps
    // the date subtraction clear of any midnight or DST edge.
    const y = new Date(today + "T12:00:00");
    y.setDate(y.getDate() - 1);
    setPrevMood(prof?.checkin?.[todayISO(y)]?.mood);
    setLoading(false);
  }, [schedule, tasks, profile, today, tmrw]);

  useEffect(() => { reload(); }, [reload]);

  const onToggleTask = async (id: string) => {
    const before = await tasks.task(id);
    const comeback = before ? backOnTrackMessage(before, today) : null;
    const ok = await attemptWrite(() => tasks.toggleDone(id));
    await reload();
    if (!ok) return;
    if (comeback) {
      showToast({ message: comeback });
    } else if (before && !before.done) {
      showToast({ message: "Task completed", actionLabel: "Undo", onAction: async () => { await attemptWrite(() => tasks.toggleDone(id)); await reload(); } });
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
          goal: goalTitleOf(projList, goalList, t.data.projectId),
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

  // P15: protect time from here instead of leaving for Routine and losing
  // your place. It writes a real routine block on the target day's weekday,
  // which is what "protected" means everywhere else in the app.
  const addProtectedBlock = async (label: string, s: number, e: number) => {
    const r = await routine.get();
    const day = new Date(planDate + "T12:00:00").getDay();
    const ok = await attemptWrite(() => routine.save({
      protectedBlocks: [...(r.protectedBlocks ?? []), { id: "pb-" + label.toLowerCase().replace(/\s+/g, "-") + "-" + s, label, startMin: s, endMin: e, days: [day] }],
    }));
    if (ok) { await reload(); showToast({ message: label + " protected · " + minLabel(s) + " to " + minLabel(e) });  }
    return !!ok;
  };

  const onPlanCommit = async (blocks: { taskId: string; text: string; category: string; start: string; end: string }[]) => {
    const ids: string[] = [];
    const ok = await attemptWrite(async () => {
      for (const b of blocks) {
        const id = await schedule.createEvent(b.text, { date: planDate, start: b.start, end: b.end, category: b.category || undefined, sourceTaskId: b.taskId });
        if (id) ids.push(id);
      }
    });
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
  // Up Next section: the deck's top 3, rendered as standard task rows.
  const upNextRows = rankOpen(taskItems, today).slice(0, 3);
  // Close-out (Session 5): Time Sense knows every completion today, not just
  // the due-today ones. The weekly recap card speaks on Sunday evenings only.
  const samples = readSamples();
  const dayStart = new Date(today + "T00:00:00").getTime();
  const completionsToday = samples.filter((s) => s.t >= dayStart && s.t < dayStart + 86400000).length;
  const evening = isEvening(nowMin, routineData) ? eveningStats(todayEvents, taskItems, today, nhm, completionsToday) : undefined;
  const weekly = evening ? weekRecap(samples, allEvents, today) : null;
  // Day ring: due-today done over due-today total. Hero tint by daypart.
  const dueToday = taskItems.filter((t) => t.data.due === today);
  const ring = { done: dueToday.filter((t) => t.data.done).length, total: dueToday.length };
  // GROUP A banners (items 6 and 9), above the day. Success is quiet;
  // failure is louder, and tappable to retry.
  const sweepCand = sweepReceipt && !sweepReceipt.failed ? setAsideCandidate(sweepReceipt) : null;
  // THE DAY LOOP (Group C item 14). Draft at first open, deterministic and
  // instant; Accept stays the one honest commit moment.
  const todayDow = new Date().getDay();
  const todayWindow = planWindowFor(routineData, todayDow);
  const todayBlocked = protectedRangesFor(routineData, todayDow);
  const draftStart = (() => { const d = new Date(); const n = Math.ceil((d.getHours() * 60 + d.getMinutes()) / 15) * 15; return Math.max(n, todayWindow.wakeMin); })();
  useEffect(() => {
    if (loading || evening) return;
    const existing = readDraft(today);
    if (existing) { setDayDraft(existing); return; }
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

  const acceptDraft = async () => {
    if (!dayDraft) return;
    const ids: string[] = [];
    const ok = await attemptWrite(async () => {
      for (const b of dayDraft.blocks) {
        const id = await schedule.createEvent(b.text, { date: today, start: b.start, end: b.end, category: b.category || undefined, sourceTaskId: b.taskId, source: madeBy("plan") });
        if (id) ids.push(id);
      }
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

  if (loading) return <SkeletonScreen />;

  // GROUP B (items 10-11): the Now line and the gap offer, derived fresh
  // every render (and the minute tick keeps renders coming).
  const nowCtx = nowContext(todayEvents, blocked, nhm);
  const estimates = learnedDurations(readCommittedDurations(), Date.now());
  const gapKey = today + ":" + (nowCtx.nextStart ?? "end");
  const gapPick = evening || gapDismissed === gapKey
    ? null
    : gapFill(
        taskItems.map((t) => ({ id: t.id, text: t.data.text, category: t.data.category ?? "", done: t.data.done, due: t.data.due, bill: t.data.bill })),
        nowCtx.gapMin,
        today,
        (cat) => estimates[cat] ?? 45,
      );

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
          <div className="now-stats">
            <StatTiles stats={[
              { num: `${fmtTime(nowCtx.nextStart).time} ${fmtTime(nowCtx.nextStart).ap}`, label: "free until", tint: "sky" },
              { num: shortSpan(nowCtx.gapMin), label: "open", tint: "good" },
            ]} />
          </div>
        ) : (
          <div className="row">
            <RowIcon kind="event" />
            <div className="row-stack">
              {(() => {
                const at = nowCtx.line.lastIndexOf(" until ");
                if (at < 0) return <div className="conn-name">{nowCtx.line}</div>;
                return (
                  <>
                    <div className="conn-name">{nowCtx.line.slice(0, at)}</div>
                    <div className="conn-meta">{nowCtx.line.slice(at + 1)}</div>
                  </>
                );
              })()}
            </div>
          </div>
        )}
        {gapPick ? (
          // The task name and its buttons do NOT share a line. On a 390px
          // phone two pills plus a title truncated the title to "Create B...",
          // which is the one piece of information the card exists to carry.
          <>
            <div className="row">
              <RowIcon kind="task" />
              <div className="row-stack">
                <div className="conn-name">{gapPick.text}</div>
                <div className="conn-meta">About {gapPick.estimateMin} min · Fits this gap</div>
              </div>
            </div>
            <div className="row row-acts">
              <div className="momentum-actions">
                <button className="btn btn-primary btn-sm" onClick={() => void onOpenTask(gapPick.id)}>Start</button>
                <button className="btn-sm" onClick={() => setGapDismissed(gapKey)}>Not Now</button>
              </div>
            </div>
          </>
        ) : (
          // NO DEAD ENDS IN NOW (Dave 2026-08-19, "the more I can do without
          // thinking, the better"): when nothing is teed up, Now still hands
          // him the one-tap way in instead of stating the time and stopping.
          <div className="row">
            <div className="momentum-actions">
              <button className="btn btn-primary btn-sm" onClick={() => setUpNextOpen(true)}>Pick Something</button>
              <button className="btn-sm" onClick={() => void openPlan("today")}>Plan My Day</button>
            </div>
          </div>
        )}
      </div></div>
    </>
  );

  // The Day Loop card: the whole day, drafted, one Accept. Purple spark: a
  // JARVIS-made proposal, not yet the user's plan.
  const draftSection = !evening && dayDraft && !dayDraft.accepted && !dayDraft.dismissed && dayDraft.blocks.length > 0 && (
    <>
      <div className="pad-x"><div className="card">
        <div className="draft-kick"><span className="cat-fg-purple">{SPARK_ICO}</span><span>Your Day, Drafted</span></div>
        {dayDraft.blocks.map((b) => (
          <div className="row" key={b.taskId}>
            <RowIcon kind="task" />
            <div className="row-grow"><div className="conn-name truncate">{b.text}</div></div>
            <span className="urgency urgency-muted">{fmtTime(b.start).time} {fmtTime(b.start).ap}</span>
          </div>
        ))}
        {dayDraft.anytime.length > 0 && (
          <div className="row"><div className="conn-meta">{capAfterNumber(`${dayDraft.anytime.length} more in Anytime`)}</div></div>
        )}
        <div className="row">
          <div className="momentum-actions">
            <button className="btn btn-primary btn-sm" onClick={() => void acceptDraft()}>Accept the Day</button>
            <button className="btn-sm" onClick={() => void openPlan("today")}>Edit</button>
            <button className="btn-sm" onClick={dismissDraft}>Not Today</button>
          </div>
        </div>
      </div></div>
    </>
  );

  // Slippage stated out loud below Everything; automatic (receipted) at it.
  const reflowSection = !evening && dayDraft?.accepted && slippedCount > 0 && effectiveLevel(getAIControl()) !== "everything" && (
    <NoticeCard
      icon={SWEEP_ICO}
      tone="cat-fg-orange"
      title={slippedCount === 1 ? "1 Block Slipped" : `${slippedCount} Blocks Slipped`}
      sub="The plan is behind the clock"
      action={{ label: "Re-Flow", onClick: () => void runReflow() }}
    />
  );

  const overflowSection = overflowOffer && (
    <NoticeCard
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
    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
  );
  const alertCards = [
    revisit ? (
      <NoticeCard
        key="revisit"
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
    sweepReceipt && !sweepReceipt.failed && sweepReceipt.moved.length > 0 ? (
      <NoticeCard
        key="sweep"
        icon={SWEEP_ICO}
        tone="cat-fg-orange"
        title={sweepReceipt.moved.length === 1 ? "Moved 1 Task to Today" : `Moved ${sweepReceipt.moved.length} Tasks to Today`}
        sub={sweepCand ? `${sweepCand.text} has moved ${sweepCand.slips} days running` : undefined}
        action={{
          label: "Undo",
          onClick: () => void (async () => { await attemptWrite(() => undoSweep(tasks, sweepReceipt)); setSweepReceipt(null); await reload(); })(),
        }}
        alt={sweepCand ? {
          label: "Set Aside",
          onClick: () => void (async () => {
            markOffered(sweepCand.id);
            const ok = await attemptWrite(() => tasks.setAside([sweepCand.id]));
            setSweepReceipt(readReceipt(today));
            await reload();
            if (ok) showToast({ message: "Set aside · Keeps its place", actionLabel: "Undo", onAction: async () => { await attemptWrite(() => tasks.restoreAside([sweepCand.id])); await reload(); } });
          })(),
        } : undefined}
        onDismiss={() => setSweepReceipt(null)}
      />
    ) : null,
    spot ? (
      <NoticeCard
        key="spot"
        icon={DOC_ICO}
        tone="cat-fg-yellow"
        title="Pick Up Where You Left Off"
        sub={spotMeta(spot)}
        onOpen={() => { clearSpot(); setSpot(null); onRestoreSpot?.(spot.kind, spot.id); }}
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
  const onDeleteReminder = async () => {
    const sheet = remSheet;
    setRemSheet(null);
    if (!sheet || sheet.mode !== "edit") return;
    await attemptWrite(() => tasks.deleteTask(sheet.id));
    await reload();
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

  const draftForCard = async (n: { kind: string; threadId: string; title: string; sub: string }): Promise<string> => {
    if (!ai.available) return "";
    try {
      const snap = loadMailSnapshot();
      if (n.kind === "nudge" || n.kind === "chase") {
        const w = snap.waiting.find((x) => x.threadId === n.threadId);
        const c = (snap.chases ?? []).find((x) => x.threadId === n.threadId);
        const to = w?.to ?? c?.to;
        const subject = w?.subject ?? c?.subject;
        if (!to || !subject) return "";
        // N13: fifty-five days deserves a different tone than three, and a
        // chase he set himself starts gentle whatever the clock says.
        const rung = ladderFor(w?.days ?? 0, loadNudgeCounts()[n.threadId] ?? 0);
        const p = cardNudgePrompt(to, subject, w?.days ?? 0);
        return parseCardDraft(await ai.complete(
          [{ role: "user", content: p.user }],
          p.system + "\n" + rung.instruction,
        ));
      }
      const t = snap.threads.find((x) => x.id === n.threadId);
      if (!t) return "";
      const p = cardReplyPrompt(t.from, t.subject, t.gist, t.snippet ?? t.gist ?? "");
      return parseCardDraft(await ai.complete([{ role: "user", content: p.user }], p.system));
    } catch {
      return "";
    }
  };

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

  // N1: one tap books the slot, replies accepting it in his own words, and
  // blocks the time. Order matters: the CALENDAR write happens first, because
  // an accepted invitation with nothing in the diary is the exact failure
  // this feature exists to remove. A failed send leaves the event, which is
  // recoverable; a failed event after a sent yes is not.
  const takeMeeting = async (threadId: string): Promise<boolean> => {
    const snap = loadMailSnapshot();
    const m = (snap.meetings ?? []).find((x) => x.threadId === threadId);
    if (!m) return false;
    const made = await attemptWrite(() =>
      schedule.createEvent("Call With " + m.from, { date: m.date, start: m.start, end: m.end }));
    if (!made) return false;
    await reload();
    const sent = await sendFromCard({ kind: "reply", threadId }, acceptBody({ ...m, free: true }));
    if (!sent) showToast({ message: "Booked · Couldn't send the reply" });
    return true;
  };

  // Email that finishes on Today. A deadline a sender named, or a promise he
  // made, becomes a real task right here: the whole point is that he never
  // has to open the inbox to deal with what the inbox produced.
  const addTaskFromMail = async (text: string, due?: string): Promise<boolean> => {
    const ok = await attemptWrite(() => tasks.createTask(text, { due: due ?? today }));
    if (ok) await reload();
    return !!ok;
  };

  // ONE NOTICE STREAM (Dave 2026-08-19: "there's a ton of notifications
  // floating around, put them all under one thing"). Everything JARVIS
  // noticed lands in one labeled section on the page, in priority order.
  // The draft leads: accepting the day resolves most of the rest.
  // A missed reminder does NOT get its own notice card. The strip is on this
  // same screen, so a card here would show the identical reminder twice, and
  // duplicated notices are precisely what "there's a ton of notifications
  // floating around" meant. The strip carries the missed state itself.
  const notices = [draftSection, ...alertCards, reflowSection, overflowSection].filter(Boolean);

  const daypart = evening ? "evening" as const : now.getHours() < 12 ? "morning" as const : null;
  const initials = name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "JV";
  return (
    <>
    <TodayPage
      greeting={name ? `${greetingFor(now)}, ${name}` : greetingFor(now)}
      dateLong={longDate(now)}
      summary={daySummary(todayEvents, taskItems, today)}
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
      onSeeAllUpNext={onGoTasksAll ?? onGoTasks}
      mail={
        <MailNotices
          key="mail"
          today={today}
          nowHHMM={nhm}
          onDraft={ai.available ? draftForCard : undefined}
          onTakeMeeting={google.hasToken ? takeMeeting : undefined}
          onSend={google.hasToken ? sendFromCard : undefined}
          onAddTask={addTaskFromMail}
          onOpenThread={onGoEmail ? (id) => onGoEmail(id) : undefined}
          onOpenEmail={onGoEmail ? () => onGoEmail() : undefined}
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
      today={today}
      nowCard={nowSection}
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
      suggestions={<><CheckIn onChanged={() => { void reload(); }} /><TodaySuggestions ai={ai} /></>}
      onSearch={onSearch}
      onProfile={onProfile}
      onSeeAllSchedule={onGoSchedule}
      onSeeAllTasks={onGoTasks}
      avatar={initials}
      birthdays={birthdays}
    />
    {planOpen && (
      <PlanDaySheet
        key={planDate}
        events={planEvents}
        tasks={candidatesFor(planDate, planEvents)}
        startMin={planStart}
        endMin={planEnd}
        date={planDate}
        dayLabel={planningTomorrow ? new Date(tomorrow + "T12:00:00").toLocaleDateString([], { weekday: "long" }) : "Today"}
        target={planTarget}
        onTarget={(t) => void openPlan(t)}
        alreadyPlanned={planEvents.filter((e) => !!e.data.sourceTaskId).map((e) => e.data.title)}
        peak={energy ? { s: energy.peakStartMin, e: energy.peakEndMin } : undefined}
        routineConfigured={routineSet}
        blocked={blocked}
        sizing={sizing}
        onEditRoutine={onEditRoutine ? () => { setPlanOpen(false); onEditRoutine(); } : undefined}
        onAddTask={addPlanTask}
        onProtect={addProtectedBlock}
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
        onCancel={() => setEventSheet(null)}
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

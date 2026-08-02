import { useCallback, useEffect, useState } from "react";
import { useSchedule, useTasks, useProfile, useCategories, useRoutine } from "../data/NotesProvider";
import { todayISO, fmtTime } from "../schedule/calendar";
import type { EventItem } from "../schedule/types";
import type { TaskItem } from "../tasks/TasksService";
import { greetingFor, longDate, shortDate } from "./greeting";
import { tomorrowISO, nowHHMM, daySummary, todaysTasks } from "./todayData";
import TodayPage from "./TodayPage";
import TodaySuggestions from "./TodaySuggestions";
import CheckIn from "./CheckIn";
import TaskSheet, { type SheetCategory, type TaskDraft } from "../tasks/screens/TaskSheet";
import EventSheet, { type EventDraft } from "../schedule/screens/EventSheet";
import PlanDaySheet from "../schedule/screens/PlanDaySheet";
import { aiPlanDay } from "../schedule/planDayAI";
import { DEFAULT_ROUTINE, planWindowFor, protectedRangesFor, type RoutineData } from "../routine/types";
import { chronotypeFor, peakWindowFor } from "../schedule/energy";
import { daySizing } from "../schedule/daySizing";
import { ensureCheckinNotifications } from "../shared/notifications";
import { isEvening, eveningStats, weekRecap } from "./evening";
import { readSamples } from "../shared/timeSense";
import SkeletonScreen from "../shared/SkeletonScreen";
import type { Recurrence } from "../notes/types";
import { useAI } from "../ai/useAI";
import { showToast } from "../shared/toast";
import { lazy, Suspense } from "react";
import { isOffTrack, rankOpen } from "../upnext/upnext";
import { backOnTrackMessage } from "../tasks/lifecycle";

// Up Next and Fresh Start (ADHD strategy Phase 1) load on demand: they are
// overlays, not tabs, and stay out of the boot bundle.
const UpNextFlow = lazy(() => import("../upnext/UpNextFlow"));
const FreshStartFlow = lazy(() => import("../upnext/FreshStartFlow"));

// Read-only aggregation over the (already tested) Schedule and Tasks services.
export default function TodayFlow({
  onGoSchedule,
  onGoTasks,
  onGoTasksAll,
  onSearch,
  onProfile,
  onEditRoutine,
}: {
  onGoSchedule: () => void;
  onGoTasks: () => void;
  onGoTasksAll?: () => void;
  onSearch?: () => void;
  onProfile?: () => void;
  onEditRoutine?: () => void;
}) {
  const ai = useAI();
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
  useEffect(() => {
    let on = true;
    Promise.all([routine.get(), profile.get()]).then(([r, prof]) => {
      if (on) void ensureCheckinNotifications(r, prof?.briefTime);
    });
    return () => { on = false; };
  }, [routine, profile]);
  const [categories, setCategories] = useState<SheetCategory[]>([]);
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
    await tasks.toggleDone(id);
    await reload();
    if (comeback) {
      showToast({ message: comeback });
    } else if (before && !before.done) {
      showToast({ message: "Task completed", actionLabel: "Undo", onAction: async () => { await tasks.toggleDone(id); await reload(); } });
    }
  };

  useEffect(() => {
    let on = true;
    cats.list().then((list) => { if (on) setCategories(list.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color }))); });
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
    await schedule.editTitle(id, draft.title);
    if ((eventSheet.initial.recurrence ?? "none") === "none") await schedule.moveDay(id, draft.date);
    await schedule.editTime(id, draft.start);
    await schedule.editEnd(id, draft.end);
    await schedule.editRecurrence(id, draft.recurrence);
    await schedule.editCategory(id, draft.category);
    await schedule.editLocation(id, draft.location);
    setEventSheet(null);
    await reload();
  };

  const onDeleteEvent = async () => {
    if (!eventSheet) return;
    const e = await schedule.event(eventSheet.id);
    await schedule.deleteEvent(eventSheet.id);
    setEventSheet(null);
    await reload();
    if (e) {
      showToast({
        message: "Event deleted",
        actionLabel: "Undo",
        onAction: async () => {
          await schedule.createEvent(e.title, { date: e.date, start: e.start, end: e.end, category: e.category || undefined, location: e.location, recurrence: e.recurrence });
          await reload();
        },
      });
    }
  };

  const onSaveTask = async (draft: TaskDraft) => {
    if (sheet?.mode === "edit") {
      const rec = (draft.repeat || "") as "" | Recurrence;
      await tasks.editText(sheet.id, draft.text);
      await tasks.setCategory(sheet.id, draft.category);
      await tasks.setDue(sheet.id, draft.due || null);
      await tasks.setRecurrence(sheet.id, rec || null);
    }
    setSheet(null);
    await reload();
  };

  const onDeleteTask = async () => {
    if (sheet?.mode === "edit") {
      const t = await tasks.task(sheet.id);
      await tasks.deleteTask(sheet.id);
      if (t) showToast({ message: "Task deleted", actionLabel: "Undo", onAction: async () => { await tasks.createTask(t.text, { category: t.category || undefined, due: t.due ?? null, recurrence: t.recurrence }); await reload(); } });
    }
    setSheet(null);
    await reload();
  };

  const plannedTaskIds = new Set(todayEvents.map((e) => e.data.sourceTaskId).filter((x): x is string => !!x));
  const planCandidates = taskItems
    .filter((t) => !t.data.done && !plannedTaskIds.has(t.id) && (!t.data.due || (t.data.due as string) <= today))
    .map((t) => {
      const due = (t.data.due as string) || "";
      return { id: t.id, text: t.data.text, category: t.data.category ?? "", due, suggested: !!due && due <= today, overdue: !!due && due < today };
    })
    .sort((a, b) => (a.suggested !== b.suggested ? (a.suggested ? -1 : 1) : (a.due || "z").localeCompare(b.due || "z")));
  const dow = new Date().getDay();
  const planWindow = planWindowFor(routineData, dow);
  const planStart = (() => { const d = new Date(); const now = Math.ceil((d.getHours() * 60 + d.getMinutes()) / 15) * 15; return Math.max(now, planWindow.wakeMin); })();
  const planEnd = planWindow.endMin;
  // Phase 2 planning context: protected ranges for today, the inferred energy
  // peak, and how heavy yesterday felt.
  const blocked = protectedRangesFor(routineData, dow);
  const chrono = chronotypeFor(routineData);
  const peak = peakWindowFor(routineData, chrono);
  const energy = chrono !== "neutral" ? { chronotype: chrono, peakStartMin: peak.s, peakEndMin: peak.e } : undefined;
  const sizing = daySizing(prevMood);
  const onAIPlan = ai.available
    ? (picks: { id: string; text: string; category: string; overdue: boolean }[], s: number, e: number) => aiPlanDay(ai, picks, todayEvents, s, e, {
        work: { startMin: routineData.workStartMin, endMin: routineData.workEndMin },
        energy,
        gentle: sizing.light,
      })
    : undefined;
  const onPlanCommit = async (blocks: { taskId: string; text: string; category: string; start: string; end: string }[]) => {
    const ids: string[] = [];
    for (const b of blocks) {
      const id = await schedule.createEvent(b.text, { date: today, start: b.start, end: b.end, category: b.category || undefined, sourceTaskId: b.taskId });
      if (id) ids.push(id);
    }
    setPlanOpen(false);
    await reload();
    showToast({
      message: `Planned ${blocks.length} ${blocks.length === 1 ? "block" : "blocks"}`,
      actionLabel: "Undo",
      onAction: async () => { for (const id of ids) await schedule.deleteEvent(id); await reload(); },
    });
  };

  if (loading) return <SkeletonScreen />;

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
      onPlanDay={() => setPlanOpen(true)}
      onUpNext={() => setUpNextOpen(true)}
      upNext={upNextRows}
      onSeeAllUpNext={onGoTasksAll ?? onGoTasks}
      freshStart={offTrack ? () => setFreshOpen(true) : undefined}
      locked={blocked}
      onOpenEvent={onOpenEvent}
      onEditRoutine={onEditRoutine}
      today={today}
      suggestions={<><CheckIn onChanged={() => { void reload(); }} /><TodaySuggestions ai={ai} /></>}
      onSearch={onSearch}
      onProfile={onProfile}
      onSeeAllSchedule={onGoSchedule}
      onSeeAllTasks={onGoTasks}
      avatar={initials}
    />
    {planOpen && (
      <PlanDaySheet
        events={todayEvents}
        tasks={planCandidates}
        startMin={planStart}
        endMin={planEnd}
        routineConfigured={routineSet}
        blocked={blocked}
        sizing={sizing}
        onEditRoutine={onEditRoutine ? () => { setPlanOpen(false); onEditRoutine(); } : undefined}
        onCommit={onPlanCommit}
        onAIPlan={onAIPlan}
        onClose={() => setPlanOpen(false)}
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
    </>
  );
}

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
import PlanDaySheet from "../schedule/screens/PlanDaySheet";
import { aiPlanDay } from "../schedule/planDayAI";
import { DEFAULT_ROUTINE, planWindowFor, type RoutineData } from "../routine/types";
import type { Recurrence } from "../notes/types";
import { useAI } from "../ai/useAI";
import { showToast } from "../shared/toast";

// Read-only aggregation over the (already tested) Schedule and Tasks services.
export default function TodayFlow({
  onGoSchedule,
  onGoTasks,
  onSearch,
  onProfile,
  onEditRoutine,
}: {
  onGoSchedule: () => void;
  onGoTasks: () => void;
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
  const [taskItems, setTaskItems] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const cats = useCategories();
  useEffect(() => {
    let on = true;
    routine.get().then((r) => { if (on) setRoutineData(r); });
    routine.isConfigured().then((c) => { if (on) setRoutineSet(c); });
    return () => { on = false; };
  }, [routine]);
  const [categories, setCategories] = useState<SheetCategory[]>([]);
  const [sheet, setSheet] = useState<{ mode: "edit"; id: string; initial: TaskDraft } | null>(null);
  const [planOpen, setPlanOpen] = useState(false);

  const now = new Date();
  const today = todayISO(now);
  const tmrw = tomorrowISO(today);

  const reload = useCallback(async () => {
    const [te, tm, tk, prof] = await Promise.all([
      schedule.eventsOn(today),
      schedule.eventsOn(tmrw),
      tasks.listTasks(),
      profile.get(),
    ]);
    setTodayEvents(te);
    setTomorrowEvents(tm);
    setTaskItems(tk);
    setName(prof?.name ?? "");
    setLoading(false);
  }, [schedule, tasks, profile, today, tmrw]);

  useEffect(() => { reload(); }, [reload]);

  const onToggleTask = async (id: string) => {
    const before = await tasks.task(id);
    await tasks.toggleDone(id);
    await reload();
    if (before && !before.done) {
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
  const planWindow = planWindowFor(routineData, new Date().getDay());
  const planStart = (() => { const d = new Date(); const now = Math.ceil((d.getHours() * 60 + d.getMinutes()) / 15) * 15; return Math.max(now, planWindow.wakeMin); })();
  const planEnd = planWindow.endMin;
  const onAIPlan = ai.available
    ? (picks: { id: string; text: string; category: string; overdue: boolean }[], s: number, e: number) => aiPlanDay(ai, picks, todayEvents, s, e, { startMin: routineData.workStartMin, endMin: routineData.workEndMin })
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

  if (loading) return <div className="screen" />;

  const nhm = nowHHMM(now);
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
      tomorrowDate={shortDate(new Date(tmrw + "T00:00:00"))}
      tasks={todaysTasks(taskItems, today)}
      onToggleTask={onToggleTask}
      onOpenTask={onOpenTask}
      onPlanDay={() => setPlanOpen(true)}
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
    </>
  );
}

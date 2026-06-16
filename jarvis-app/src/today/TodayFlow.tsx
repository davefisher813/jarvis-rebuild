import { useCallback, useEffect, useState } from "react";
import { useSchedule, useTasks, useProfile, useCategories } from "../data/NotesProvider";
import { todayISO, fmtTime } from "../schedule/calendar";
import type { EventItem } from "../schedule/types";
import type { TaskItem } from "../tasks/TasksService";
import { greetingFor, longDate, shortDate } from "./greeting";
import { tomorrowISO, nowHHMM, daySummary, todaysTasks } from "./todayData";
import TodayPage from "./TodayPage";
import TodaySuggestions from "./TodaySuggestions";
import TaskSheet, { type SheetCategory, type TaskDraft } from "../tasks/screens/TaskSheet";
import type { Recurrence } from "../notes/types";
import { useAI } from "../ai/useAI";
import { showToast } from "../shared/toast";

// Read-only aggregation over the (already tested) Schedule and Tasks services.
export default function TodayFlow({
  onGoSchedule,
  onGoTasks,
  onSearch,
  onProfile,
}: {
  onGoSchedule: () => void;
  onGoTasks: () => void;
  onSearch?: () => void;
  onProfile?: () => void;
}) {
  const ai = useAI();
  const schedule = useSchedule();
  const tasks = useTasks();
  const profile = useProfile();
  const [name, setName] = useState("");
  const [todayEvents, setTodayEvents] = useState<EventItem[]>([]);
  const [tomorrowEvents, setTomorrowEvents] = useState<EventItem[]>([]);
  const [taskItems, setTaskItems] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const cats = useCategories();
  const [categories, setCategories] = useState<SheetCategory[]>([]);
  const [sheet, setSheet] = useState<{ mode: "edit"; id: string; initial: TaskDraft } | null>(null);

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
      today={today}
      suggestions={<TodaySuggestions ai={ai} />}
      onSearch={onSearch}
      onProfile={onProfile}
      onSeeAllSchedule={onGoSchedule}
      onSeeAllTasks={onGoTasks}
      avatar={initials}
    />
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

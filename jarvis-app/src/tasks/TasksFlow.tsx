import { useCallback, useEffect, useState } from "react";
import { useTasks, useCategories, useSchedule } from "../data/NotesProvider";
import TasksPage from "./screens/TasksPage";
import TaskSheet, { type SheetCategory, type TaskDraft } from "./screens/TaskSheet";
import { partition, byCategory, type Partitioned, type TaskFilter } from "./filters";
import type { Recurrence, TaskData } from "../notes/types";
import { todayISO } from "./grouping";
import { nextFreeSlot, addMinutes } from "../schedule/calendar";
import { showToast } from "../shared/toast";

const EMPTY: Partitioned = { daily: [], today: [], overdue: [], upcoming: [], done: [] };
type SheetState = { mode: "new" } | { mode: "edit"; id: string; initial: TaskDraft } | null;

export default function TasksFlow() {
  const svc = useTasks();
  const cats = useCategories();
  const schedule = useSchedule();
  const today = todayISO();
  const tomorrow = (() => { const d = new Date(today + "T00:00:00"); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();
  const [parts, setParts] = useState<Partitioned>(EMPTY);
  const [filter, setFilter] = useState<TaskFilter>("today");
  const [catFilter, setCatFilter] = useState("all");
  const [categories, setCategories] = useState<SheetCategory[]>([]);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const items = await svc.listTasks();
    setParts(partition(items, today));
    setLoading(false);
  }, [svc, today]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    let on = true;
    cats.list().then((list) => {
      if (on) setCategories(list.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color })));
    });
    return () => { on = false; };
  }, [cats]);

  // Fall back to "All" if the selected category no longer exists.
  useEffect(() => {
    if (catFilter !== "all" && categories.length && !categories.some((c) => c.id === catFilter)) setCatFilter("all");
  }, [categories, catFilter]);

  const counts = {
    daily: parts.daily.length,
    today: parts.today.length,
    overdue: parts.overdue.length,
    upcoming: parts.upcoming.length,
    done: parts.done.length,
  };

  const onToggle = async (id: string) => {
    await svc.toggleDone(id);
    await reload();
  };

  const openEdit = async (id: string) => {
    const t = await svc.task(id);
    if (!t) return;
    setSheet({ mode: "edit", id, initial: { text: t.text, category: t.category ?? "", due: t.due ?? "", repeat: t.recurrence ?? "" } });
  };

  const onSave = async (draft: TaskDraft) => {
    const rec = (draft.repeat || "") as "" | Recurrence;
    if (sheet?.mode === "new") {
      await svc.createTask(draft.text, { category: draft.category || undefined, due: draft.due || null, recurrence: rec || undefined });
    } else if (sheet?.mode === "edit") {
      await svc.editText(sheet.id, draft.text);
      await svc.setCategory(sheet.id, draft.category);
      await svc.setDue(sheet.id, draft.due || null);
      await svc.setRecurrence(sheet.id, rec || null);
    }
    setSheet(null);
    await reload();
  };

  const onDelete = async () => {
    if (sheet?.mode === "edit") {
      const t = await svc.task(sheet.id);
      await svc.deleteTask(sheet.id);
      if (t) offerUndoTask(t);
    }
    setSheet(null);
    await reload();
  };

  const onDeleteRow = async (id: string) => {
    const t = await svc.task(id);
    await svc.deleteTask(id);
    if (t) offerUndoTask(t);
    await reload();
  };

  // Recreate a just-deleted task if the user taps Undo.
  const offerUndoTask = (t: TaskData) => {
    showToast({
      message: "Task deleted",
      actionLabel: "Undo",
      onAction: async () => {
        await svc.createTask(t.text, { category: t.category || undefined, due: t.due ?? null, recurrence: t.recurrence });
        await reload();
      },
    });
  };

  // Push a task to tomorrow without opening the editor.
  const onSnooze = async (id: string) => {
    await svc.setDue(id, tomorrow);
    await reload();
    showToast({ message: "Moved to tomorrow" });
  };

  // Drop the task into the next free slot on its due day (or today) as a 1h event.
  const onScheduleTask = async () => {
    if (sheet?.mode !== "edit") return;
    const t = await svc.task(sheet.id);
    if (!t) return;
    const date = t.due || today;
    const start = nextFreeSlot(await schedule.eventsOn(date), date, new Date());
    await schedule.createEvent(t.text, { date, start, end: addMinutes(start, 60), category: t.category || undefined });
    setSheet(null);
    showToast({ message: "Added to schedule" });
  };

  return (
    <>
      <TasksPage
        filter={filter}
        counts={counts}
        items={byCategory(parts[filter], catFilter)}
        categories={categories}
        catFilter={catFilter}
        onCatFilter={setCatFilter}
        today={today}
        onFilter={setFilter}
        onToggle={onToggle}
        onOpenTask={openEdit}
        onDeleteTask={onDeleteRow}
        onSnoozeTask={onSnooze}
        onNew={() => setSheet({ mode: "new" })}
        loading={loading}
      />
      {sheet && (
        <TaskSheet
          mode={sheet.mode}
          initial={sheet.mode === "edit" ? sheet.initial : undefined}
          categories={categories}
          onSave={onSave}
          onSchedule={sheet.mode === "edit" ? onScheduleTask : undefined}
          onDelete={sheet.mode === "edit" ? onDelete : undefined}
          onCancel={() => setSheet(null)}
        />
      )}
    </>
  );
}

import { useCallback, useEffect, useState } from "react";
import { useTasks, useCategories } from "../data/NotesProvider";
import TasksPage from "./screens/TasksPage";
import TaskSheet, { type SheetCategory, type TaskDraft } from "./screens/TaskSheet";
import { partition, type Partitioned, type TaskFilter } from "./filters";
import { todayISO } from "./grouping";

const EMPTY: Partitioned = { today: [], overdue: [], upcoming: [], done: [] };
type SheetState = { mode: "new" } | { mode: "edit"; id: string; initial: TaskDraft } | null;

export default function TasksFlow() {
  const svc = useTasks();
  const cats = useCategories();
  const today = todayISO();
  const [parts, setParts] = useState<Partitioned>(EMPTY);
  const [filter, setFilter] = useState<TaskFilter>("today");
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

  const counts = {
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
    setSheet({ mode: "edit", id, initial: { text: t.text, category: t.category ?? "", due: t.due ?? "" } });
  };

  const onSave = async (draft: TaskDraft) => {
    if (sheet?.mode === "new") {
      await svc.createTask(draft.text, { category: draft.category || undefined, due: draft.due || null });
    } else if (sheet?.mode === "edit") {
      await svc.editText(sheet.id, draft.text);
      await svc.setCategory(sheet.id, draft.category);
      await svc.setDue(sheet.id, draft.due || null);
    }
    setSheet(null);
    await reload();
  };

  const onDelete = async () => {
    if (sheet?.mode === "edit") await svc.deleteTask(sheet.id);
    setSheet(null);
    await reload();
  };

  return (
    <>
      <TasksPage
        filter={filter}
        counts={counts}
        items={parts[filter]}
        today={today}
        onFilter={setFilter}
        onToggle={onToggle}
        onOpenTask={openEdit}
        onNew={() => setSheet({ mode: "new" })}
        loading={loading}
      />
      {sheet && (
        <TaskSheet
          mode={sheet.mode}
          initial={sheet.mode === "edit" ? sheet.initial : undefined}
          categories={categories}
          onSave={onSave}
          onDelete={sheet.mode === "edit" ? onDelete : undefined}
          onCancel={() => setSheet(null)}
        />
      )}
    </>
  );
}

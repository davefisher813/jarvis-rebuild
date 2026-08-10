import { useCallback, useEffect, useRef, useState } from "react";
import { useTasks, useCategories, useSchedule } from "../data/NotesProvider";
import { pausedCategoryIds } from "../categories/kinds";
import TasksPage from "./screens/TasksPage";
import TaskSheet, { type SheetCategory, type TaskDraft } from "./screens/TaskSheet";
import { useProjects } from "../data/NotesProvider";
import type { Project } from "../projects/types";
import { partition, byCategory, filterOf, FILTERS, FILTER_LABEL, type Partitioned, type TaskFilter } from "./filters";
import type { Recurrence, TaskData } from "../notes/types";
import type { TaskItem } from "./TasksService";
import { todayISO } from "./grouping";
import { nextFreeSlot, addMinutes } from "../schedule/calendar";
import { showToast } from "../shared/toast";
import { setAsideCandidates, firstStepCandidate, isFirstStepDismissed, dismissFirstStep, backOnTrackMessage } from "./lifecycle";
import { useAI } from "../ai/useAI";
import { useAIContext } from "../ai/useAIContext";
import { identityToText } from "../ai/context";
import { firstStepPrompt, parseFirstStep } from "./firstStep";
import { localParse } from "../ai/capture";
import { emit } from "../events";

const EMPTY: Partitioned = { all: [], daily: [], today: [], overdue: [], upcoming: [], done: [] };
type SheetState = { mode: "new"; initial?: Partial<TaskDraft> } | { mode: "edit"; id: string; initial: TaskDraft } | null;

export default function TasksFlow({ openId, openFilter }: { openId?: string; openFilter?: string } = {}) {
  const svc = useTasks();
  const cats = useCategories();
  const schedule = useSchedule();
  const ai = useAI();
  const gatherContext = useAIContext();
  const today = todayISO();
  const tomorrow = (() => { const d = new Date(today + "T00:00:00"); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();
  const [parts, setParts] = useState<Partitioned>(EMPTY);
  const [allItems, setAllItems] = useState<TaskItem[]>([]);
  const [filter, setFilter] = useState<TaskFilter>(
    openFilter && (FILTERS as string[]).includes(openFilter) ? (openFilter as TaskFilter) : "today",
  );
  const [catFilter, setCatFilter] = useState("all");
  const projectsSvc = useProjects();
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => { let on = true; projectsSvc.list().then((p) => { if (on) setProjects(p); }); return () => { on = false; }; }, [projectsSvc]);
  const [categories, setCategories] = useState<SheetCategory[]>([]);
  const [pausedCats, setPausedCats] = useState<ReadonlySet<string>>(new Set());
  const [sheet, setSheet] = useState<SheetState>(null);
  const [loading, setLoading] = useState(true);
  // First Step offer state: the AI-drafted step, keyed to the sliding task.
  const [fsStep, setFsStep] = useState<{ taskId: string; step: string } | null>(null);
  const [fsBusy, setFsBusy] = useState(false);
  const [fsHidden, setFsHidden] = useState(false);
  const sweptRef = useRef(false);

  const reload = useCallback(async () => {
    const items = await svc.listTasks();
    setParts(partition(items, today));
    setAllItems(items);
    setLoading(false);
    return items;
  }, [svc, today]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Set Aside (lifecycle): once per day, long-overdue tasks quietly leave the
  // red wall for Someday territory, transparently and reversibly. The app
  // never shows a graveyard.
  useEffect(() => {
    if (loading || sweptRef.current) return;
    sweptRef.current = true;
    try {
      if (localStorage.getItem("jarvis.setaside.last") === today) return;
    } catch { /* private mode: sweep anyway */ }
    const cands = setAsideCandidates(allItems, today);
    if (cands.length === 0) return;
    const ids = cands.map((t) => t.id);
    void (async () => {
      await svc.setAside(ids);
      try { localStorage.setItem("jarvis.setaside.last", today); } catch { /* ok */ }
      await reload();
      showToast({
        message: `Set aside ${ids.length} quiet ${ids.length === 1 ? "task" : "tasks"}. Nothing is overdue.`,
        actionLabel: "Undo",
        onAction: async () => { await svc.restoreAside(ids); await reload(); },
      });
    })();
  }, [loading, allItems, svc, today, reload]);

  useEffect(() => {
    let on = true;
    cats.list().then((list) => {
      if (!on) return;
      setCategories(list.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color })));
      setPausedCats(pausedCategoryIds(list));
    });
    return () => { on = false; };
  }, [cats]);

  // Fall back to "All" if the selected category no longer exists.
  useEffect(() => {
    if (catFilter !== "all" && categories.length && !categories.some((c) => c.id === catFilter)) setCatFilter("all");
  }, [categories, catFilter]);

  const counts = {
    all: parts.all.length,
    daily: parts.daily.length,
    today: parts.today.length,
    overdue: parts.overdue.length,
    upcoming: parts.upcoming.length,
    done: parts.done.length,
  };

  const onToggle = async (id: string) => {
    const before = await svc.task(id);
    // Back On Track: completing a recurring task after a real gap gets the
    // comeback line instead of the stock toast. The old run still counts.
    const comeback = before ? backOnTrackMessage(before, today) : null;
    await svc.toggleDone(id);
    await reload();
    if (comeback) {
      showToast({ message: comeback });
    } else if (before && !before.done) {
      showToast({ message: "Task completed", actionLabel: "Undo", onAction: async () => { await svc.toggleDone(id); await reload(); } });
    }
  };

  // First Step (lifecycle): one offer at a time for the task that keeps
  // sliding. The AI drafts the smallest possible opening move; accepting adds
  // it to Today and sets the big task aside, out of the red.
  const fsCandidate = (() => {
    if (!ai.available || fsHidden || loading) return null;
    const c = firstStepCandidate(allItems, today, pausedCats);
    return c && !isFirstStepDismissed(c.id, today) ? c : null;
  })();

  const fsAsk = async () => {
    if (!fsCandidate || fsBusy) return;
    setFsBusy(true);
    try {
      // Phase 3: the step is drafted with JARVIS's voice and what the app
      // knows about this person, not from the task text alone. Context
      // failure must not block the offer, a generic step beats no step.
      const identity = await gatherContext().then(identityToText).catch(() => "");
      const p = firstStepPrompt(fsCandidate.data.text, "task", identity);
      const step = parseFirstStep(await ai.complete([{ role: "user", content: p.user }], p.system));
      if (!step) throw new Error("empty");
      setFsStep({ taskId: fsCandidate.id, step });
    } catch {
      showToast({ message: "Couldn't reach JARVIS. Try again in a bit." });
    } finally {
      setFsBusy(false);
    }
  };

  const fsAccept = async () => {
    if (!fsStep || !fsCandidate || fsStep.taskId !== fsCandidate.id) return;
    await svc.createTask(fsStep.step, { category: fsCandidate.data.category || undefined, due: today });
    await svc.setAside([fsCandidate.id]);
    dismissFirstStep(fsCandidate.id, today);
    setFsStep(null);
    setFsHidden(true);
    emit({ type: "suggestion.accepted", props: { kind: "first_step" } });
    await reload();
    showToast({ message: "First step added to Today. The big one waits in Upcoming." });
  };

  const fsDismiss = () => {
    if (fsCandidate) dismissFirstStep(fsCandidate.id, today);
    setFsStep(null);
    setFsHidden(true);
    emit({ type: "suggestion.dismissed", props: { kind: "first_step" } });
  };

  // Quick capture: create a task due today. UNTAGGED on purpose (2026-08-03):
  // it used to default to whichever category was first in the list, which
  // silently mis-tagged everything and poisoned every per-category number
  // downstream. No tag is honest; the AI capture path still assigns real
  // categories because it actually reasons about the text.
  //
  // Date words (2026-08-09): "call dentist friday" is one thought, and the
  // deterministic parser the offline capture path already uses can read it.
  // No AI call, no new grammar: today/tomorrow/weekday words set the due
  // date, anything else lands due today exactly as before. The toast names
  // the date so a task visibly leaving the Today filter never reads as a
  // broken save (audit 2026-07-30 precedent).
  const onQuickAdd = async (text: string) => {
    if (!text.trim()) return;
    const parsed = localParse(text.trim(), today);
    const due = parsed.date ?? today;
    await svc.createTask(text.trim(), { due });
    await reload();
    if (due !== today) {
      const label = new Date(due + "T00:00:00").toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
      showToast({ message: `Due ${label}` });
    }
  };

  // Bulk-remove finished tasks from the Done list. With Undo (2026-08-09):
  // this was the ONE delete on the page without it, and it is the delete
  // that takes the most at once.
  const onClearDone = async () => {
    const snapshot = parts.done.map((t) => ({ ...t.data }));
    for (const t of parts.done) await svc.deleteTask(t.id);
    await reload();
    showToast({
      message: `Cleared ${snapshot.length} completed`,
      actionLabel: "Undo",
      onAction: async () => {
        for (const d of snapshot) {
          const id = await svc.createTask(d.text, { category: d.category || undefined, due: d.due ?? null, recurrence: d.recurrence });
          if (id) await svc.toggleDone(id); // they come back DONE, as they were
        }
        await reload();
      },
    });
  };

  const openEdit = async (id: string) => {
    const t = await svc.task(id);
    if (!t) return;
    setSheet({ mode: "edit", id, initial: { text: t.text, category: t.category ?? "", due: t.due ?? "", repeat: t.recurrence ?? "", projectId: t.projectId ?? "" } });
  };

  // When arriving via a note connection, open that task once on mount.
  useEffect(() => {
    if (openId) openEdit(openId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  const onSave = async (draft: TaskDraft) => {
    const rec = (draft.repeat || "") as "" | Recurrence;
    if (sheet?.mode === "new") {
      await svc.createTask(draft.text, { category: draft.category || undefined, due: draft.due || null, recurrence: rec || undefined, projectId: draft.projectId });
    } else if (sheet?.mode === "edit") {
      await svc.editText(sheet.id, draft.text);
      await svc.setCategory(sheet.id, draft.category);
      await svc.setDue(sheet.id, draft.due || null);
      await svc.setProject(sheet.id, draft.projectId ?? null);
      await svc.setRecurrence(sheet.id, rec || null);
    }
    const wasNew = sheet?.mode === "new";
    setSheet(null);
    await reload();
    // A saved task must always be visible (audit 2026-07-30: a new task with
    // no due date landed in Upcoming while the user watched Today, which read
    // as "Save is broken"). Jump to the filter where it landed and clear a
    // category filter that would hide it, with a toast naming the move.
    if (wasNew) {
      const landed = filterOf({ text: draft.text, category: draft.category, done: false, due: draft.due || undefined, recurrence: rec || undefined }, today);
      if (draft.category && catFilter !== "all" && draft.category !== catFilter) setCatFilter("all");
      if (landed !== filter) {
        setFilter(landed);
        showToast({ message: `Saved to ${FILTER_LABEL[landed]}` });
      }
    }
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

  // One offer, one line, one action. The subtitle used to read "Want the
  // smallest possible first step?", which is helper text describing the button
  // sitting under it, and the dismiss was a full-weight secondary button
  // competing with the thing being offered. Today's Check In already offers and
  // dismisses this way; this card was the odd one out.
  const fsBanner = fsCandidate && (filter === "today" || filter === "overdue" || filter === "all") ? (
    <div className="pad-x">
      <div className="card pad">
        <div className="conn-name">&ldquo;{fsCandidate.data.text}&rdquo; keeps sliding.</div>
        {fsStep && fsStep.taskId === fsCandidate.id ? (
          <>
            {/* This line IS the answer, not a description of the button. */}
            <div className="conn-meta">Start with: {fsStep.step}</div>
            <div className="offer-row">
              <button className="btn btn-primary" onClick={fsAccept}>Add This Step</button>
              <button className="quiet-action" onClick={fsDismiss}>Not Now</button>
            </div>
          </>
        ) : (
          <div className="offer-row">
            <button className="btn btn-primary" onClick={fsAsk} disabled={fsBusy}>{fsBusy ? "Thinking..." : "First Step"}</button>
            <button className="quiet-action" onClick={fsDismiss}>Not Now</button>
          </div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <>
      <TasksPage
        filter={filter}
        counts={counts}
        items={byCategory(parts[filter], catFilter)}
        banner={fsBanner}
        categories={categories}
        catFilter={catFilter}
        onCatFilter={setCatFilter}
        today={today}
        onFilter={setFilter}
        onToggle={onToggle}
        onOpenTask={openEdit}
        onDeleteTask={onDeleteRow}
        onSnoozeTask={onSnooze}
        onQuickAdd={onQuickAdd}
        onClearDone={onClearDone}
        onNew={() => setSheet({
          mode: "new",
          // Prefill from the filter being viewed, so a task made while looking
          // at Today is due today by default (audit 2026-07-30).
          initial: filter === "today" || filter === "overdue" || filter === "all" ? { due: today } : filter === "daily" ? { repeat: "daily" } : undefined,
        })}
        loading={loading}
      />
      {sheet && (
        <TaskSheet
          projects={projects.map((p) => ({ id: p.id, title: p.data.title }))}
          mode={sheet.mode}
          initial={sheet.initial}
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

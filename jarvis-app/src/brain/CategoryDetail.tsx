import { useCallback, useEffect, useState } from "react";
import { useTasks, useSchedule, useNotes, useCategories, useProjects, useGoals, useRoutine } from "../data/NotesProvider";
import type { Category } from "../categories/types";
import type { NoteData, Recurrence } from "../notes/types";
import type { Project } from "../projects/types";
import type { Goal } from "../life/types";
import type { TaskItem } from "../tasks/TasksService";
import { effectiveKind } from "../categories/kinds";
import { weekReceipt, receiptLine, afterHoursLine, type WeekEvent } from "../categories/receipts";
import { readSamples } from "../shared/timeSense";
import { todayISO } from "../tasks/grouping";
import { nextActionOf } from "../bigger/related";
import { dayPhrase } from "../money/bills";
import TaskSheet, { type SheetCategory, type TaskDraft } from "../tasks/screens/TaskSheet";
import ProjectSheet from "../projects/ProjectSheet";
import CategorySheet, { type CategoryDraft } from "../categories/screens/CategorySheet";

const CHEV = (
  <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
);
const PLUS = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
);

const UP_NEXT_CAP = 6;
const NOTES_CAP = 4;

type SheetState = { kind: "closed" } | { kind: "task" } | { kind: "project" } | { kind: "edit" };

// The category page (2026-08-03), replacing the read-only archive. Pages are
// RECEIPTS for behavior happening elsewhere: This Week is derived from real
// completions and events, Up Next is the real open tasks, adds are born
// tagged. The org kind adds Projects (6.6 machinery scoped here) and the
// Season / Work hours settings via the editor.
export default function CategoryDetail({
  categoryId,
  onBack,
  onOpenNote,
  onChanged,
}: {
  categoryId: string;
  onBack: () => void;
  onOpenNote?: (id: string) => void;
  onChanged?: () => void;
}) {
  const tasksSvc = useTasks();
  const schedule = useSchedule();
  const notesSvc = useNotes();
  const catsSvc = useCategories();
  const projectsSvc = useProjects();
  const goalsSvc = useGoals();
  const routine = useRoutine();

  const [cat, setCat] = useState<Category | null>(null);
  const [allCats, setAllCats] = useState<Category[]>([]);
  const [open, setOpen] = useState<TaskItem[]>([]);
  const [allTasks, setAllTasks] = useState<TaskItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [notes, setNotes] = useState<{ id: string; title: string }[]>([]);
  const [events, setEvents] = useState<WeekEvent[]>([]);
  const [work, setWork] = useState<{ startMin: number; endMin: number } | null>(null);
  const [sheet, setSheet] = useState<SheetState>({ kind: "closed" });
  const today = todayISO();

  const reload = useCallback(async () => {
    const [c, cs, tk, pj, gl, nt, ev, rt] = await Promise.all([
      catsSvc.get(categoryId),
      catsSvc.list(),
      tasksSvc.listTasks(),
      projectsSvc.list(),
      goalsSvc.list(),
      notesSvc.listNotes(),
      schedule.listEvents(),
      routine.get(),
    ]);
    setCat(c);
    setAllCats(cs);
    setAllTasks(tk);
    setOpen(
      tk.filter((t) => t.data.category === categoryId && !t.data.done)
        .sort((a, b) => (a.data.due ?? "9999").localeCompare(b.data.due ?? "9999"))
        .slice(0, UP_NEXT_CAP),
    );
    setProjects(pj.filter((p) => p.data.category === categoryId && p.data.status !== "done"));
    setGoals(gl);
    setNotes(
      tk && nt
        ? nt.filter((n) => (n.data as unknown as NoteData).category === categoryId)
            .slice(0, NOTES_CAP)
            .map((n) => ({ id: n.id, title: ((n.data as unknown as NoteData).title || "Untitled") }))
        : [],
    );
    setEvents(ev.map((e) => ({ date: e.data.date, start: e.data.start, category: e.data.category })));
    setWork(rt ? { startMin: rt.workStartMin, endMin: rt.workEndMin } : null);
  }, [catsSvc, tasksSvc, projectsSvc, goalsSvc, notesSvc, schedule, routine, categoryId]);

  useEffect(() => { void reload(); }, [reload]);

  if (!cat) return <div className="screen" />;
  const kind = effectiveKind(cat.data);
  const isOrg = kind === "org";
  const paused = isOrg && cat.data.season === "paused";
  const receipt = weekReceipt(categoryId, readSamples(), events, today, cat.data.workHours ? work : null);
  const line = receiptLine(receipt);
  const ahLine = cat.data.workHours ? afterHoursLine(receipt) : null;

  const toggle = async (id: string) => { await tasksSvc.toggleDone(id); await reload(); };

  const saveTask = async (draft: TaskDraft) => {
    const rec = (draft.repeat || "") as "" | Recurrence;
    await tasksSvc.createTask(draft.text, { category: draft.category || undefined, due: draft.due || null, recurrence: rec || undefined, projectId: draft.projectId });
    setSheet({ kind: "closed" });
    await reload();
  };

  const dueLabel = (t: TaskItem): string | null => {
    const due = t.data.due;
    if (!due) return null;
    if (due < today) return "Overdue";
    const p = dayPhrase(due, today);
    return "Due " + (p === "today" || p === "tomorrow" ? p : p);
  };

  const sheetCats: SheetCategory[] = allCats.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color }));

  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title"><span className={"cat-dot cat-bg-" + cat.data.color} /> {cat.data.name}</div>
        <button className="nav-action-text" onClick={() => setSheet({ kind: "edit" })}>Edit</button>
      </div>

      {paused && (
        <div className="pad-x"><div className="card">
          <div className="row">
            <div className="row-grow"><div className="conn-name">Paused for now</div></div>
            <button className="btn-sm" onClick={async () => { await catsSvc.update(categoryId, { season: undefined }); onChanged?.(); await reload(); }}>Wake Up</button>
          </div>
        </div></div>
      )}

      {line && (
        <>
          <div className="sec-head"><div className="sec-left"><div className="sec-title">This Week</div></div></div>
          <div className="pad-x"><div className="card">
            <div className="row">
              <div className="row-grow">
                <div className="conn-name">{line}</div>
                {ahLine && <div className="eyebrow">{ahLine}</div>}
              </div>
            </div>
          </div></div>
        </>
      )}

      {isOrg && (
        <>
          <div className="sec-head"><div className="sec-left"><div className="sec-title">Projects</div></div></div>
          <div className="pad-x"><div className="card">
            {projects.map((p) => {
              const next = nextActionOf(allTasks, p.id);
              return (
                <div className="row" role="button" tabIndex={0} key={p.id}>
                  <div className="row-grow">
                    <div className="conn-name truncate">{p.data.title}</div>
                    <div className="bp-sub truncate">{next ? `Next: ${next.data.text}` : "No next action"}</div>
                  </div>
                  {CHEV}
                </div>
              );
            })}
            <div className="row ob-addrow" role="button" tabIndex={0} onClick={() => setSheet({ kind: "project" })}>
              <div className="sec-ico ico-accent">{PLUS}</div>
              <div className="row-grow"><div className="conn-name">Add Project</div></div>
            </div>
          </div></div>
        </>
      )}

      <div className="sec-head"><div className="sec-left"><div className="sec-title">Up Next</div></div></div>
      <div className="pad-x"><div className="card">
        {open.map((t) => {
          const due = dueLabel(t);
          return (
            <div className="row" key={t.id}>
              <div className="task-check-tap" role="checkbox" aria-checked={false} aria-label="Mark done" onClick={() => void toggle(t.id)}>
                <div className={"task-check cat-bd-" + cat.data.color} />
              </div>
              <div className="row-grow">
                <div className="conn-name truncate">{t.data.text}</div>
                {due && <div className="eyebrow">{due}</div>}
              </div>
            </div>
          );
        })}
        <div className="row ob-addrow" role="button" tabIndex={0} onClick={() => setSheet({ kind: "task" })}>
          <div className="sec-ico ico-accent">{PLUS}</div>
          <div className="row-grow"><div className="conn-name">Add Task</div></div>
        </div>
      </div></div>

      {notes.length > 0 && (
        <>
          <div className="sec-head"><div className="sec-left"><div className="sec-title">Notes</div></div></div>
          <div className="pad-x"><div className="card">
            {notes.map((n) => (
              <div className="row" role="button" tabIndex={0} key={n.id} onClick={() => onOpenNote?.(n.id)}>
                <div className="row-grow"><div className="conn-name truncate">{n.title}</div></div>
                {CHEV}
              </div>
            ))}
          </div></div>
        </>
      )}
      <div className="screen-foot" />

      {sheet.kind === "task" && (
        <TaskSheet mode="new" categories={sheetCats} initial={{ category: categoryId }} onSave={saveTask} onCancel={() => setSheet({ kind: "closed" })} />
      )}
      {sheet.kind === "project" && (
        <ProjectSheet mode="new" categories={allCats} goals={goals} initial={{ category: categoryId }}
          onSave={async (d) => { await projectsSvc.create(d); setSheet({ kind: "closed" }); await reload(); }}
          onCancel={() => setSheet({ kind: "closed" })} />
      )}
      {sheet.kind === "edit" && (
        <CategorySheet mode="edit"
          initial={{ name: cat.data.name, color: cat.data.color, icon: cat.data.icon ?? "folder", kind: cat.data.kind, season: cat.data.season, workHours: cat.data.workHours }}
          onSave={async (d: CategoryDraft) => {
            await catsSvc.update(categoryId, { name: d.name, color: d.color, icon: d.icon, kind: d.kind, season: d.season, workHours: d.workHours });
            setSheet({ kind: "closed" });
            onChanged?.();
            await reload();
          }}
          onDelete={async () => { await catsSvc.remove(categoryId); onChanged?.(); onBack(); }}
          onCancel={() => setSheet({ kind: "closed" })} />
      )}
    </div>
  );
}

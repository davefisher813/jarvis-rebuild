import { useCallback, useEffect, useRef, useState } from "react";
import { useTasks, useCategories, useSchedule, useRoutine } from "../data/NotesProvider";
import { pausedCategoryIds, offHoursCategoryIds } from "../categories/kinds";
import TasksPage from "./screens/TasksPage";
import TaskSheet, { type SheetCategory, type TaskDraft } from "./screens/TaskSheet";
import { useProjects } from "../data/NotesProvider";
import { movedBy, celebrationLine, type Moved } from "../shared/completion";
import type { Project } from "../projects/types";
import { partition, byCategory, filterOf, FILTERS, FILTER_LABEL, type Partitioned, type TaskFilter } from "./filters";
import type { Recurrence, TaskData } from "../notes/types";
import type { TaskItem } from "./TasksService";
import { todayISO } from "./grouping";
import { nextFreeSlot, addMinutes } from "../schedule/calendar";
import { showToast } from "../shared/toast";
import { attemptWrite } from "../shared/guard";
import { setAsideCandidates, firstStepCandidate, isFirstStepDismissed, dismissFirstStep, backOnTrackMessage } from "./lifecycle";
import { useAI } from "../ai/useAI";
import { useAIContext } from "../ai/useAIContext";
import { identityToText } from "../ai/context";
import { firstStepPrompt, parseFirstStep } from "./firstStep";
import { rankOpen } from "../upnext/upnext";
import { FIFTEEN } from "./rightNow";
import { breakdownPrompt, parseBreakdown } from "./breakdown";
import { emit } from "../events";
import { chainQuietToday, dismissChain, nextBest, chainReason } from "./momentum";
import { RowIcon } from "../shared/anatomy";
import { touchActivity, recordSpot } from "../restore/whereYouWere";
import { capAfterNumber } from "../shared/casing";
import { loadOverwhelmed, setOverwhelmed as setOverwhelmedFlag, theOneThing } from "./overwhelmed";
import { haptics } from "../shared/haptics";

const EMPTY: Partitioned = { all: [], daily: [], today: [], overdue: [], upcoming: [], done: [] };
type SheetState = { mode: "new"; initial?: Partial<TaskDraft> } | { mode: "edit"; id: string; initial: TaskDraft; source?: import("../shared/provenance").Source } | null;

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
  const [overwhelmed, setOverwhelmed] = useState(() => loadOverwhelmed(todayISO()));
  const [filter, setFilter] = useState<TaskFilter>(
    openFilter && (FILTERS as string[]).includes(openFilter) ? (openFilter as TaskFilter) : "today",
  );
  const [catFilter, setCatFilter] = useState("all");
  const projectsSvc = useProjects();
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => { let on = true; projectsSvc.list().then((p) => { if (on) setProjects(p); }); return () => { on = false; }; }, [projectsSvc]);
  const [categories, setCategories] = useState<SheetCategory[]>([]);
  const [pausedCats, setPausedCats] = useState<ReadonlySet<string>>(new Set());
  // Work-hours quiet set (audit 2026-08-10): after hours, work-category tasks
  // get no First Step offers. Same exclusion mechanics as the season pause.
  const [offHoursCats, setOffHoursCats] = useState<ReadonlySet<string>>(new Set());
  const routineSvc = useRoutine();
  const [sheet, setSheet] = useState<SheetState>(null);
  // Momentum Chain: the suggestion occupying a just-finished task's slot.
  const [momentum, setMomentum] = useState<{ afterId: string; task: TaskItem } | null>(null);
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
      // Silent automation law (corrections pack item 3): a failed automation
      // may never fail silently. On failure the line renders in error form
      // with a retry, louder than the success receipt.
      const runSweep = async (): Promise<void> => {
        try {
          await svc.setAside(ids);
        } catch {
          showToast({ message: "Couldn't set aside quiet tasks", actionLabel: "Retry", onAction: () => { void runSweep(); } });
          return;
        }
        try { localStorage.setItem("jarvis.setaside.last", today); } catch { /* ok */ }
        await reload();
        showToast({
          message: `Set aside ${ids.length} quiet ${ids.length === 1 ? "task" : "tasks"} · Nothing overdue`,
          actionLabel: "Undo",
          onAction: async () => { await attemptWrite(() => svc.restoreAside(ids)); await reload(); },
        });
      };
      await runSweep();
    })();
  }, [loading, allItems, svc, today, reload]);

  useEffect(() => {
    let on = true;
    void (async () => {
      const [list, rt] = await Promise.all([cats.list(), routineSvc.get()]);
      if (!on) return;
      setCategories(list.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color })));
      setPausedCats(pausedCategoryIds(list));
      const now = new Date();
      setOffHoursCats(offHoursCategoryIds(list, rt, now.getHours() * 60 + now.getMinutes()));
    })();
    return () => { on = false; };
  }, [cats, routineSvc]);

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

  // Which project this tick just moved, and how close it now is. Mirrors
  // TodayFlow exactly; the shared judgement lives in shared/completion.
  // Counts the tick that JUST happened. React state is still the pre-toggle
  // snapshot inside this handler, so counting only `done` reports the project
  // one task behind: ticking the last one said "One left". Counting the id
  // explicitly is correct whether the list is stale or fresh.
  const movedByTask = (t: { projectId?: string } | null, justDoneId: string): { moved: Moved; projectId: string } | null => {
    const pid = t?.projectId;
    if (!pid) return null;
    const proj = projects.find((x) => x.id === pid);
    if (!proj || proj.data.status === "done") return null;
    const mine = allItems.filter((x) => x.data.projectId === pid);
    const done = mine.filter((x) => x.data.done || x.id === justDoneId).length;
    const moved = movedBy(proj.data.title, done, mine.length);
    return moved ? { moved, projectId: pid } : null;
  };

  const onToggle = async (id: string) => {
    const before = await svc.task(id);
    // Back On Track: completing a recurring task after a real gap gets the
    // comeback line instead of the stock toast. The old run still counts.
    const comeback = before ? backOnTrackMessage(before, today) : null;
    const ok = await attemptWrite(() => svc.toggleDone(id));
    await reload();
    if (!ok) return;
    touchActivity(); // completing things is being HERE (Where You Were)
    if (before && !before.done) {
      // Momentum Chain (addendum item 7): the next best thing slides into
      // the finished slot, unless the chain was quieted for today.
      if (!chainQuietToday(today)) {
        const items = await svc.listTasks();
        const next = nextBest(items, id, before.category ?? "");
        setMomentum(next ? { afterId: id, task: next } : null);
      }
    }
    // The progress toast is UNIVERSAL, not a Today-page trick. A tick means
    // the same thing whichever screen it happened on, and a reward that only
    // appears on one surface teaches nothing.
    const advanced = before && !before.done ? movedByTask(before, id) : null;
    if (comeback) {
      showToast({ message: comeback });
    } else if (advanced?.moved.cleared) {
      // Delayed rewards are the ones ADHD discounts hardest, so finishing the
      // project is one tap from HERE rather than four taps through a form.
      showToast({
        message: advanced.moved.projectTitle + " · " + advanced.moved.line,
        actionLabel: "Finish It",
        onAction: async () => {
          const proj = projects.find((x) => x.id === advanced.projectId);
          if (!proj) return;
          await attemptWrite(() => projectsSvc.update(proj.id, { ...proj.data, status: "done" }));
          await reload();
          showToast({ message: celebrationLine("project", proj.id) + " · " + proj.data.title });
        },
      });
    } else if (advanced) {
      showToast({ message: advanced.moved.projectTitle + " · " + advanced.moved.line, actionLabel: "Undo", onAction: async () => { await attemptWrite(() => svc.toggleDone(id)); await reload(); } });
    } else if (before && !before.done) {
      showToast({ message: "Task completed", actionLabel: "Undo", onAction: async () => { await attemptWrite(() => svc.toggleDone(id)); await reload(); } });
    }
  };

  // First Step (lifecycle): one offer at a time for the task that keeps
  // sliding. The AI drafts the smallest possible opening move; accepting adds
  // it to Today and sets the big task aside, out of the red.
  const fsCandidate = (() => {
    if (!ai.available || fsHidden || loading) return null;
    const c = firstStepCandidate(allItems, today, new Set([...pausedCats, ...offHoursCats]));
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
      showToast({ message: "Couldn't reach JARVIS" });
    } finally {
      setFsBusy(false);
    }
  };

  const fsAccept = async () => {
    if (!fsStep || !fsCandidate || fsStep.taskId !== fsCandidate.id) return;
    const ok = await attemptWrite(async () => {
      await svc.createTask(fsStep.step, { category: fsCandidate.data.category || undefined, due: today });
      await svc.setAside([fsCandidate.id]);
    });
    if (!ok) return;
    dismissFirstStep(fsCandidate.id, today);
    setFsStep(null);
    setFsHidden(true);
    emit({ type: "suggestion.accepted", props: { kind: "first_step" } });
    await reload();
    showToast({ message: "First step on Today · Big one waits" });
  };

  const fsDismiss = () => {
    if (fsCandidate) dismissFirstStep(fsCandidate.id, today);
    setFsStep(null);
    setFsHidden(true);
    emit({ type: "suggestion.dismissed", props: { kind: "first_step" } });
  };

  // The quick-add box is GONE (2026-08-21, Dave: "the add task type box makes
  // no sense"). It was a third way to make a task on a screen that already had
  // the nav-bar "+" and the capture path, and a box that duplicates a button
  // is a decision the user has to make for no gain. The date parsing it used
  // was never the problem and was never its own: localParse lives in the
  // capture path and is still used there.
  // Bulk-remove finished tasks from the Done list. With Undo (2026-08-09):
  // this was the ONE delete on the page without it, and it is the delete
  // that takes the most at once.
  const onClearDone = async () => {
    const snapshot = parts.done.map((t) => ({ ...t.data }));
    const ok = await attemptWrite(async () => { for (const t of parts.done) await svc.deleteTask(t.id); });
    await reload();
    if (!ok) return;
    showToast({
      message: `Cleared ${snapshot.length} completed`,
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(async () => {
          for (const d of snapshot) {
            const id = await svc.createTask(d.text, { category: d.category || undefined, due: d.due ?? null, recurrence: d.recurrence });
            if (id) await svc.toggleDone(id); // they come back DONE, as they were
          }
        });
        await reload();
      },
    });
  };

  const openEdit = async (id: string) => {
    const t = await svc.task(id);
    if (!t) return;
    recordSpot({ kind: "task", id, label: t.text }); // Where You Were
    setSheet({ mode: "edit", id, initial: { text: t.text, category: t.category ?? "", extraCategories: t.extraCategories, due: t.due ?? "", repeat: t.recurrence ?? "", projectId: t.projectId ?? "" }, source: t.source });
  };

  // When arriving via a note connection, open that task once on mount.
  useEffect(() => {
    if (openId) openEdit(openId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  const onSave = async (draft: TaskDraft) => {
    const rec = (draft.repeat || "") as "" | Recurrence;
    let saved = true;
    if (sheet?.mode === "new") {
      saved = await attemptWrite(() => svc.createTask(draft.text, { category: draft.category || undefined, extraCategories: draft.extraCategories, due: draft.due || null, recurrence: rec || undefined, projectId: draft.projectId, plan: draft.plan }));
    } else if (sheet?.mode === "edit") {
      saved = await attemptWrite(async () => {
        await svc.editText(sheet.id, draft.text);
        await svc.setCategories(sheet.id, [draft.category, ...(draft.extraCategories ?? [])].filter(Boolean));
        await svc.setDue(sheet.id, draft.due || null);
        await svc.setProject(sheet.id, draft.projectId ?? null);
        await svc.setRecurrence(sheet.id, rec || null);
        await svc.setPlan(sheet.id, draft.plan ?? null);
      });
    }
    const wasNew = sheet?.mode === "new" && saved;
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
      const ok = await attemptWrite(() => svc.deleteTask(sheet.id));
      if (ok && t) offerUndoTask(t);
    }
    setSheet(null);
    await reload();
  };

  const onDeleteRow = async (id: string) => {
    const t = await svc.task(id);
    const ok = await attemptWrite(() => svc.deleteTask(id));
    if (ok && t) offerUndoTask(t);
    await reload();
  };

  // Recreate a just-deleted task if the user taps Undo.
  const offerUndoTask = (t: TaskData) => {
    showToast({
      message: "Task deleted",
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(() => svc.createTask(t.text, { category: t.category || undefined, due: t.due ?? null, recurrence: t.recurrence }));
        await reload();
      },
    });
  };

  // Push a task to tomorrow without opening the editor.
  const onSnooze = async (id: string) => {
    const ok = await attemptWrite(() => svc.setDue(id, tomorrow));
    await reload();
    if (ok) showToast({ message: "Moved to tomorrow" });
  };

  // Drop the task into the next free slot on its due day (or today) as a 1h event.
  const onScheduleTask = async () => {
    if (sheet?.mode !== "edit") return;
    const t = await svc.task(sheet.id);
    if (!t) return;
    const date = t.due || today;
    const start = nextFreeSlot(await schedule.eventsOn(date), date, new Date());
    const ok = await attemptWrite(() => schedule.createEvent(t.text, { date, start, end: addMinutes(start, 60), category: t.category || undefined }));
    setSheet(null);
    if (ok) showToast({ message: "Added to schedule" });
  };

  // A2 (audit 2026-08-21): the Tasks tab could not start anything. Same move
  // as Today's Start pill, deliberately identical: fifteen minutes, right
  // now, as a REAL block on the real day. Not an in-app timer, because a
  // timer dies when he closes JARVIS, which is exactly the moment starting
  // goes wrong.
  const onStartTask = async (id: string) => {
    const t = await svc.task(id);
    if (!t) return;
    const now = new Date();
    const start = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const ok = await attemptWrite(() => schedule.createEvent(t.text, {
      date: today, start, end: addMinutes(start, FIFTEEN),
      category: t.category || undefined, sourceTaskId: id,
    }));
    if (ok) { haptics.selection(); showToast({ message: `Fifteen minutes on ${t.text}` }); }
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
              {/* B15 (2026-08-23): this banner acts on ONE stalled task. The
                  screen's own red is Just Pick One For Me, which collapses
                  the whole page to a single open task. */}
              <button className="pill-act" onClick={fsAccept}>Add This Step</button>
              <button className="quiet-action" onClick={fsDismiss}>Not Now</button>
            </div>
          </>
        ) : (
          <div className="offer-row">
            <button className="pill-act" onClick={fsAsk} disabled={fsBusy}>{fsBusy ? "Thinking..." : "First Step"}</button>
            <button className="quiet-action" onClick={fsDismiss}>Not Now</button>
          </div>
        )}
      </div>
    </div>
  ) : null;

  // JUST PICK ONE FOR ME (Dave 2026-08-19): the same ranking Up Next uses,
  // taken down to one and opened. The point is that he never reads a list:
  // one tap goes from "Tasks" straight to a task that is already open.
  const pickOne = () => {
    const best = rankOpen(parts.all, today)[0];
    if (!best) { showToast({ message: "Nothing open · Enjoy it" }); return; }
    openEdit(best.id);
  };

  // MOVE ALL TO TODAY: an overdue pile is where the shame lives. One tap
  // resets it, with a single Undo that puts every original date back.
  const moveAllToToday = async () => {
    const stuck = parts.overdue;
    if (stuck.length === 0) return;
    const before = stuck.map((t) => ({ id: t.id, due: t.data.due ?? null }));
    const ok = await attemptWrite(async () => {
      for (const t of stuck) await svc.setDue(t.id, today);
    });
    await reload();
    if (!ok) return;
    showToast({
      message: capAfterNumber(`${stuck.length} ${stuck.length === 1 ? "task" : "tasks"} moved to today`),
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(async () => {
          for (const b of before) await svc.setDue(b.id, b.due);
        });
        await reload();
      },
    });
  };

  // BREAK IT DOWN: one big task becomes three or four startable ones. The
  // original is replaced by its steps (keeping both would mean the scary
  // version still sits in the list), and one Undo puts it back and removes
  // them. toggleDone is deliberately NOT used to retire the original: on a
  // recurring task it would roll the due date forward instead of closing it.
  const breakDown = async (text: string) => {
    const editingId = sheet?.mode === "edit" ? sheet.id : null;
    setSheet(null);
    showToast({ message: "Breaking it down..." });
    let steps: string[] = [];
    try {
      const identity = await gatherContext().then(identityToText).catch(() => "");
      const p = breakdownPrompt(text, identity);
      steps = parseBreakdown(await ai.complete([{ role: "user", content: p.user }], p.system));
    } catch {
      steps = [];
    }
    if (steps.length === 0) { showToast({ message: "Couldn't reach JARVIS" }); return; }
    const original = editingId ? parts.all.find((t) => t.id === editingId) ?? null : null;
    if (!original && editingId) { showToast({ message: "Couldn't find that task" }); return; }
    const made: string[] = [];
    const ok = await attemptWrite(async () => {
      for (const step of steps) {
        const id = await svc.createTask(step, {
          category: original?.data.category ?? "",
          due: original?.data.due ?? today,
          projectId: original?.data.projectId,
          source: { type: "chat", ts: Date.now() },
        });
        if (id) made.push(id);
      }
      if (editingId) await svc.deleteTask(editingId);
    });
    await reload();
    if (!ok) return;
    showToast({
      message: `Split into ${made.length} ${made.length === 1 ? "step" : "steps"}`,
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(async () => {
          for (const id of made) await svc.deleteTask(id);
          if (original) await svc.createTask(original.data.text, {
            category: original.data.category,
            due: original.data.due ?? null,
            recurrence: original.data.recurrence,
            projectId: original.data.projectId,
          });
        });
        await reload();
      },
    });
  };

  return (
    <>
      <TasksPage
        onPickOne={pickOne}
        overwhelmed={overwhelmed}
        onOverwhelmed={() => { haptics.selection(); setOverwhelmed(setOverwhelmedFlag(true, today)); }}
        onCalm={() => { haptics.selection(); setOverwhelmed(setOverwhelmedFlag(false, today)); }}
        onMoveAllToToday={() => void moveAllToToday()}
        filter={filter}
        counts={counts}
        items={overwhelmed
          // F1: the list IS the one thing. Nothing is deleted, deferred or
          // rescheduled; this is a view, and everything returns on one tap.
          ? [theOneThing(allItems, () => 30)].filter((t): t is TaskItem => !!t)
          : byCategory(parts[filter], catFilter)}
        banner={fsBanner}
        categories={categories}
        catFilter={catFilter}
        onCatFilter={setCatFilter}
        today={today}
        onFilter={setFilter}
        onToggle={onToggle}
        onOpenTask={openEdit}
        // B6: a rename is one field, so it does not cost a sheet. Undo comes
        // free with the row still on screen showing the old text if the
        // write fails.
        onRenameTask={(id, text) => void (async () => {
          const ok = await attemptWrite(() => svc.editText(id, text));
          if (ok) await reload();
        })()}
        onStartTask={(id) => void onStartTask(id)}
        momentum={momentum && {
          afterId: momentum.afterId,
          el: (
            <div className="row momentum-slot">
              <RowIcon kind="task" />
              <div className="row-stack">
                <div className="eyebrow">Keep Going</div>
                <div className="conn-name">{momentum.task.data.text}</div>
                {chainReason(momentum.task, momentum.task.data.category ?? "", today) && (
                  <div className="conn-meta">{chainReason(momentum.task, momentum.task.data.category ?? "", today)}</div>
                )}
              </div>
              <div className="momentum-actions">
                <button className="pill-act" onClick={() => { const id = momentum.task.id; setMomentum(null); openEdit(id); }}>Start</button>
                <button className="btn-sm" onClick={() => { dismissChain(today); setMomentum(null); }}>Not Now</button>
              </div>
            </div>
          ),
        }}
        onDeleteTask={onDeleteRow}
        onSnoozeTask={onSnooze}
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
          source={sheet.mode === "edit" ? sheet.source : undefined}
          categories={categories}
          onSave={onSave}
          otherPlans={allItems.map((t) => ({ id: t.id, text: t.data.text, plan: t.data.plan }))}
          onSchedule={sheet.mode === "edit" ? onScheduleTask : undefined}
          onBreakDown={sheet.mode === "edit" && ai.available ? (t) => void breakDown(t) : undefined}
          onDelete={sheet.mode === "edit" ? onDelete : undefined}
          onCancel={() => setSheet(null)}
        />
      )}
    </>
  );
}

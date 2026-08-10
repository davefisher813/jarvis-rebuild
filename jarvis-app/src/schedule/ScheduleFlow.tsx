import { useCallback, useEffect, useRef, useState } from "react";
import { useSchedule, useCategories, useTasks, useRoutine, useProjects, useGoals } from "../data/NotesProvider";
import { pausedCategoryIds } from "../categories/kinds";
import { goalTitleOf, workWindowOf } from "./planMeta";
import type { Category } from "../categories/types";
import type { Project } from "../projects/types";
import type { Goal } from "../life/types";
import SchedulePage from "./screens/SchedulePage";
import EventSheet, { type SheetCategory, type EventDraft } from "./screens/EventSheet";
import ScheduleUploadFlow from "./screens/ScheduleUploadFlow";
import { todayISO, weekOf, addDays, addMinutes, eventsForDate, findConflicts, nextFreeSlot, fmtRange } from "./calendar";
import { planDay } from "./planDay";
import { anytimeTasksForDay } from "./anytime";
import { suggestTitles, suggestLocations, repeatCandidate } from "./memory";
import { attachInfo, followUpCandidate, type AttachInfo } from "./attachments";
import type { EventItem, EventData } from "./types";
import { showToast } from "../shared/toast";
import PlanDaySheet from "./screens/PlanDaySheet";
import { aiPlanDay } from "./planDayAI";
import { DEFAULT_ROUTINE, planWindowFor, protectedRangesFor, splitProtectedRanges, type RoutineData } from "../routine/types";
import { chronotypeFor, peakWindowFor } from "./energy";
import { isSuggested, rankCandidates } from "./planMeta";
import { shiftFutureEvents, restoreShift } from "./runningLate";
import { useAI } from "../ai/useAI";
import { useAIContext } from "../ai/useAIContext";
import { contextToText } from "../ai/context";
import type { TaskItem } from "../tasks/TasksService";

type SheetState = { mode: "new" } | { mode: "edit"; id: string; initial: EventDraft } | null;

export default function ScheduleFlow({ onEditRoutine, openId }: { onEditRoutine?: () => void; openId?: string } = {}) {
  const svc = useSchedule();
  const cats = useCategories();
  const today = todayISO();
  const t0 = new Date(today + "T00:00:00");
  const [view, setView] = useState({ y: t0.getFullYear(), m: t0.getMonth() });
  const [selected, setSelected] = useState(today);
  const [dots, setDots] = useState<Record<number, string[]>>({});
  const [dayEvents, setDayEvents] = useState<EventItem[]>([]);
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
  const [sheet, setSheet] = useState<SheetState>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [mode, setMode] = useState<"day" | "week" | "month">("month");
  const [allEvents, setAllEvents] = useState<EventItem[]>([]);
  const tasksSvc = useTasks();
  const [taskItems, setTaskItems] = useState<TaskItem[]>([]);
  const [planOpen, setPlanOpen] = useState(false);
  const ai = useAI();
  // Brain Personalization Phase 1 (2026-08-06): the same assembled context
  // every other AI feature already reads (Life Philosophy, Values, How You
  // Write, habits, completion patterns, etc.), now also reaching the day
  // planner instead of it reasoning from work hours and energy alone.
  const gatherContext = useAIContext();
  const routine = useRoutine();
  const [routineData, setRoutineData] = useState<RoutineData>(DEFAULT_ROUTINE);
  const [routineSet, setRoutineSet] = useState(true);
  const [loading, setLoading] = useState(true);
  const [newStart, setNewStart] = useState<string | null>(null);
  // Soft anchor guard (roadmap v2): the one gentle nudge, at most once per day.
  const [guard, setGuard] = useState<{ id: string; date: string } | null>(null);
  const nudgedDays = useRef<Set<string>>(new Set());

  const reload = useCallback(async () => {
    setDots(await svc.daysWithEvents(view.y, view.m));
    setDayEvents(await svc.eventsOn(selected));
    setAllEvents(await svc.listEvents());
    setLoading(false);
  }, [svc, view.y, view.m, selected]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    let on = true;
    tasksSvc.listTasks().then((t) => { if (on) setTaskItems(t); });
    return () => { on = false; };
  }, [tasksSvc, planOpen]);

  useEffect(() => {
    let on = true;
    routine.get().then((r) => { if (on) setRoutineData(r); });
    routine.isConfigured().then((c) => { if (on) setRoutineSet(c); });
    return () => { on = false; };
  }, [routine]);

  useEffect(() => {
    let on = true;
    cats.list().then((list) => {
      if (!on) return;
      setCategories(list.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color })));
      setPausedCats(pausedCategoryIds(list));
      setCatsFull(list);
    });
    return () => { on = false; };
  }, [cats]);

  const stepMonth = (delta: number) =>
    setView((v) => {
      const m = v.m + delta;
      return { y: v.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    });

  const syncView = (iso: string) => { const d = new Date(iso + "T00:00:00"); setView({ y: d.getFullYear(), m: d.getMonth() }); };
  const onPrev = () => {
    if (mode === "month") stepMonth(-1);
    else { const next = addDays(selected, mode === "week" ? -7 : -1); setSelected(next); syncView(next); }
  };
  const onNext = () => {
    if (mode === "month") stepMonth(1);
    else { const next = addDays(selected, mode === "week" ? 7 : 1); setSelected(next); syncView(next); }
  };

  const conflicts = findConflicts(dayEvents);
  const toMin = (hhmm: string) => { const p = hhmm.split(":"); return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0); };
  const checkConflict = (date: string, startT: string, endT: string) => {
    const others = eventsForDate(allEvents, date).filter((e) => !(sheet && sheet.mode === "edit" && e.id === sheet.id));
    const s = toMin(startT), en = endT ? toMin(endT) : s + 60;
    return others.some((e) => { const es = toMin(e.data.start), ee = e.data.end ? toMin(e.data.end) : es + 60; return s < ee && es < en; });
  };

  const realToday = todayISO();
  const plannedTaskIds = new Set(dayEvents.map((e) => e.data.sourceTaskId).filter((x): x is string => !!x));
  const planCandidates = taskItems
    .filter((t) => !t.data.done && !plannedTaskIds.has(t.id) && (!t.data.due || (t.data.due as string) <= selected))
    // Season pause: paused categories are not offered; bills are exempt.
    .filter((t) => !pausedCats.has(t.data.category ?? "") || !!t.data.bill)
    .map((t) => {
      const due = (t.data.due as string) || "";
      const win = workWindowOf(catsFull, t.data.category, routineData);
      return {
        id: t.id, text: t.data.text, category: t.data.category ?? "", due,
        suggested: isSuggested(due, selected, t.data.recurrence), overdue: !!due && due < realToday,
        goal: goalTitleOf(projList, goalList, t.data.projectId),
        ...(win ? { windowS: win.s, windowE: win.e } : {}),
      };
    })
    .sort(rankCandidates);
  const planDow = (() => { const p = selected.split("-"); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay(); })();
  const planWindow = planWindowFor(routineData, planDow);
  const planStart = selected === todayISO()
    ? (() => { const d = new Date(); const now = Math.ceil((d.getHours() * 60 + d.getMinutes()) / 15) * 15; return Math.max(now, planWindow.wakeMin); })()
    : planWindow.wakeMin;
  const planEnd = planWindow.endMin;
  // Phase 2: protected ranges and the inferred energy peak for the selected
  // day. Mood sizing is a Today-surface behavior, so it is not applied here.
  const blocked = protectedRangesFor(routineData, planDow);
  const chrono = chronotypeFor(routineData);
  const peak = peakWindowFor(routineData, chrono);
  const energy = chrono !== "neutral" ? { chronotype: chrono, peakStartMin: peak.s, peakEndMin: peak.e } : undefined;
  const onAIPlan = ai.available
    ? async (picks: { id: string; text: string; category: string; overdue: boolean }[], s: number, e: number) => {
        const ctx = await gatherContext();
        return aiPlanDay(ai, picks, dayEvents, s, e, {
          work: { startMin: routineData.workStartMin, endMin: routineData.workEndMin },
          energy,
          profile: contextToText(ctx),
        });
      }
    : undefined;
  const onPlanCommit = async (blocks: { taskId: string; text: string; category: string; start: string; end: string }[]) => {
    const ids: string[] = [];
    for (const b of blocks) {
      const id = await svc.createEvent(b.text, { date: selected, start: b.start, end: b.end, category: b.category || undefined, sourceTaskId: b.taskId });
      if (id) ids.push(id);
    }
    setPlanOpen(false);
    await reload();
    showToast({
      message: `Planned ${blocks.length} ${blocks.length === 1 ? "block" : "blocks"}`,
      actionLabel: "Undo",
      onAction: async () => { for (const id of ids) await svc.deleteEvent(id); await reload(); },
    });
  };

  const suggestSlot = (date: string) => {
    const exclude = sheet && sheet.mode === "edit" ? sheet.id : null;
    return nextFreeSlot(allEvents.filter((e) => e.id !== exclude), date, new Date());
  };

  const weekCells = weekOf(selected).map((date) => {
    const evs = eventsForDate(allEvents, date);
    const day = new Date(date + "T00:00:00").getDate();
    const colors = Array.from(new Set(evs.map((e) => e.data.category))).slice(0, 3);
    return { date, day, colors };
  });

  const openEdit = async (id: string) => {
    const e = await svc.event(id);
    if (!e) return;
    // Use the event's own date, not the currently selected day: editing an
    // event from another day must not silently move it to the selected date.
    setSheet({ mode: "edit", id, initial: { title: e.title, date: e.date, start: e.start, end: e.end ?? "", category: e.category ?? "", location: e.location ?? "", recurrence: e.recurrence ?? "none", taskIds: e.taskIds ?? [] } });
  };

  // When arriving via a note connection, jump to the event's own date and open
  // it once on mount. Uses the event's real date, not the current selection.
  useEffect(() => {
    if (!openId) return;
    let on = true;
    (async () => {
      const e = await svc.event(openId);
      if (!on || !e) return;
      setSelected(e.date);
      syncView(e.date);
      setSheet({ mode: "edit", id: openId, initial: { title: e.title, date: e.date, start: e.start, end: e.end ?? "", category: e.category ?? "", location: e.location ?? "", recurrence: e.recurrence ?? "none", taskIds: e.taskIds ?? [] } });
    })();
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  const offerUndoEvent = (e: EventData) => {
    showToast({
      message: "Event deleted",
      actionLabel: "Undo",
      onAction: async () => {
        await svc.createEvent(e.title, { date: e.date, start: e.start, end: e.end, category: e.category || undefined, location: e.location, recurrence: e.recurrence });
        await reload();
      },
    });
  };

  const onSave = async (draft: EventDraft, scope?: "this" | "series") => {
    let newEventId: string | null = null;
    let newEventDate: string | null = null;
    if (sheet?.mode === "new") {
      newEventId = await svc.createEvent(draft.title, { date: draft.date, start: draft.start, end: draft.end || undefined, category: draft.category || undefined, location: draft.location || undefined, recurrence: draft.recurrence, taskIds: draft.taskIds });
      newEventDate = draft.date;
    } else if (sheet?.mode === "edit") {
      const id = sheet.id;
      const recurring = (sheet.initial.recurrence ?? "none") !== "none";
      if (recurring && scope === "this") {
        // Split one occurrence off the series into a standalone event.
        await svc.addExdate(id, selected);
        await svc.createEvent(draft.title, { date: draft.date, start: draft.start, end: draft.end || undefined, category: draft.category || undefined, location: draft.location || undefined });
      } else {
        await svc.editTitle(id, draft.title);
        if (!recurring) await svc.moveDay(id, draft.date);
        await svc.editTime(id, draft.start);
        await svc.editEnd(id, draft.end);
        await svc.editRecurrence(id, draft.recurrence);
        await svc.editCategory(id, draft.category);
        await svc.editLocation(id, draft.location);
        await svc.editTaskIds(id, draft.taskIds ?? []);
      }
    }
    setSheet(null);
    setNewStart(null);
    await reload();
    if (newEventId && newEventDate) {
      const guarded = await maybeAnchorGuard(newEventDate, newEventId);
      // Memory layer: third same-weekday in a row -> offer to make it repeat.
      // One nudge at a time (the guard wins), asked once (only at exactly 3),
      // and never applied silently.
      if (!guarded) {
        const cand = repeatCandidate(allEvents, { title: draft.title, date: newEventDate, recurrence: draft.recurrence });
        if (cand && cand.count === 3) {
          const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
          const evId = newEventId;
          showToast({
            message: `Third ${WD[cand.weekday]} in a row. Repeat weekly?`,
            actionLabel: "Make It Repeat",
            onAction: async () => { await svc.editRecurrence(evId, "weekly"); await reload(); },
          });
        }
      }
    }
  };

  const onDelete = async (scope?: "this" | "series") => {
    if (sheet?.mode === "edit") {
      const recurring = (sheet.initial.recurrence ?? "none") !== "none";
      if (recurring && scope === "this") {
        await svc.addExdate(sheet.id, selected);
      } else {
        const e = await svc.event(sheet.id);
        await svc.deleteEvent(sheet.id);
        if (e) offerUndoEvent(e);
      }
    }
    setSheet(null);
    setNewStart(null);
    await reload();
  };

  const onPickSlot = (start: string) => { setNewStart(start); setSheet({ mode: "new" }); };

  // --- Session 4 connections: attachments + the event-end follow-up ---
  const attachMap: Record<string, AttachInfo> = {};
  for (const e of dayEvents) {
    const info = attachInfo(e, taskItems);
    if (info) attachMap[e.id] = info;
  }
  const attachableTasks = taskItems
    .filter((t) => !t.data.done || dayEvents.some((e) => e.data.taskIds?.includes(t.id)))
    .map((t) => ({ id: t.id, text: t.data.text, category: t.data.category ?? "", done: t.data.done }));
  const onToggleAttached = async (id: string) => { await tasksSvc.toggleDone(id); await reloadTasks(); };

  // "N tasks were attached. Any done?": once per event, ever. Asked ids live in
  // localStorage so the question never comes back.
  const ASKED_KEY = "jarvis.attach.asked";
  const readAsked = (): string[] => { try { const v = JSON.parse(localStorage.getItem(ASKED_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
  const followUpBusy = useRef(false);
  useEffect(() => {
    if (loading || selected !== today || followUpBusy.current) return;
    const asked = readAsked();
    const cand = followUpCandidate(allEvents, taskItems, today, nowHHMM, new Set(asked));
    if (!cand) return;
    followUpBusy.current = true;
    try { localStorage.setItem(ASKED_KEY, JSON.stringify([...asked, cand.eventId].slice(-200))); } catch { /* private mode */ }
    showToast({
      message: `${cand.title} had ${cand.openCount} ${cand.openCount === 1 ? "task" : "tasks"} attached. Any done?`,
      actionLabel: "Review",
      onAction: () => { followUpBusy.current = false; openEdit(cand.eventId); },
    });
    // One question at a time: the next candidate (if any) waits half a minute.
    setTimeout(() => { followUpBusy.current = false; }, 30000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, selected, allEvents, taskItems]);

  // --- Roadmap v2 Anytime row ---
  // Tasks with no time for the selected day, shown as a strip above the grid.
  const reloadTasks = useCallback(async () => { setTaskItems(await tasksSvc.listTasks()); }, [tasksSvc]);
  const anytimeItems = mode === "day" ? anytimeTasksForDay(taskItems, dayEvents, selected) : [];

  // Tap the circle: complete the task (it leaves the strip).
  const onToggleTask = async (id: string) => { await tasksSvc.toggleDone(id); await reloadTasks(); };

  // Give-back: move a timed block back to Anytime. If it came from a task the
  // task still exists, so deleting the block returns it to the strip; a manual
  // event becomes a fresh task first. Undo restores the block either way.
  const onUnschedule = async (id: string) => {
    const e = await svc.event(id);
    if (!e) return;
    let restoredTaskId: string | undefined;
    if (!e.sourceTaskId) restoredTaskId = (await tasksSvc.createTask(e.title, { category: e.category || undefined })) ?? undefined;
    await svc.deleteEvent(id);
    await reload();
    await reloadTasks();
    showToast({
      message: "Moved to Anytime",
      actionLabel: "Undo",
      onAction: async () => {
        if (restoredTaskId) await tasksSvc.deleteTask(restoredTaskId);
        await svc.createEvent(e.title, { date: e.date, start: e.start, end: e.end, category: e.category || undefined, location: e.location, recurrence: e.recurrence, sourceTaskId: e.sourceTaskId });
        await reload(); await reloadTasks();
      },
    });
  };

  // The nudge: at most once per day, when a manual/tapped add reaches a 4th
  // timed item. Plan My Day is exempt (it schedules on purpose).
  const maybeAnchorGuard = async (date: string, newId: string): Promise<boolean> => {
    if (nudgedDays.current.has(date)) return false;
    if ((await svc.countOn(date)) >= 4) { nudgedDays.current.add(date); setGuard({ id: newId, date }); return true; }
    return false;
  };

  // Tap the name: give the task a time. Drops a 60-minute block at the next open
  // slot, carrying the task id so the strip and grid stay in sync. Undo removes it.
  const onScheduleTask = async (id: string) => {
    const t = await tasksSvc.task(id);
    if (!t) return;
    // Land the block through the SAME ladder Plan My Day uses (2026-08-10),
    // so one tapped task behaves exactly like a planned pick: focus zones
    // first, then open time, routing around events and protected blocks,
    // inside the routine window. planStart already begins at "now" when the
    // selected day is today, so it never proposes the past.
    const split = splitProtectedRanges(blocked);
    const drop = planDay(
      [{ id, text: t.text, category: t.category ?? "", durationMin: 60 }],
      eventsForDate(allEvents, selected), planStart, planEnd, 10, split.hard, split.soft, split.focus,
    );
    const start = drop.blocks[0]?.start ?? nextFreeSlot(allEvents, selected, new Date());
    const end = addMinutes(start, 60);
    const evId = await svc.createEvent(t.text, { date: selected, start, end, category: t.category || undefined, sourceTaskId: id });
    await reload();
    await reloadTasks();
    const guarded = evId ? await maybeAnchorGuard(selected, evId) : false;
    if (!guarded) showToast({
      message: `Scheduled ${fmtRange(start, end)}`,
      actionLabel: "Undo",
      onAction: async () => { if (evId) await svc.deleteEvent(evId); await reload(); await reloadTasks(); },
    });
  };

  // --- Roadmap v2 schedule basics ---
  const nowHHMM = (() => { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; })();

  // Swipe: push one event 15 minutes (start and end shift together).
  const onPush15 = async (id: string) => {
    const e = await svc.event(id);
    if (!e) return;
    await svc.editTime(id, addMinutes(e.start, 15));
    if (e.end) await svc.editEnd(id, addMinutes(e.end, 15));
    await reload();
    showToast({ message: "Pushed 15 minutes", actionLabel: "Undo", onAction: async () => { await svc.editTime(id, e.start); if (e.end) await svc.editEnd(id, e.end); await reload(); } });
  };

  // Swipe: push one event to tomorrow, same time.
  const onPushTomorrow = async (id: string) => {
    const e = await svc.event(id);
    if (!e) return;
    await svc.moveDay(id, addDays(e.date, 1));
    await reload();
    showToast({ message: "Moved to tomorrow", actionLabel: "Undo", onAction: async () => { await svc.moveDay(id, e.date); await reload(); } });
  };

  // Running Late: one tap shifts everything left in today as a unit. Recurring
  // events are skipped (shifting a series from one bad morning is wrong); the
  // toast says what moved and Undo restores every prior time.
  const onRunningLate = async (mins: number) => {
    const { moved, skipped, prior } = await shiftFutureEvents(svc, dayEvents, nowHHMM, mins);
    if (moved === 0) return;
    await reload();
    showToast({
      message: `Shifted ${moved} ${moved === 1 ? "event" : "events"} by ${mins === 60 ? "an hour" : mins + " minutes"}${skipped ? ` (${skipped} repeating left in place)` : ""}`,
      actionLabel: "Undo",
      onAction: async () => { await restoreShift(svc, prior); await reload(); },
    });
  };

  return (
    <>
      <SchedulePage
        year={view.y}
        month={view.m}
        selected={selected}
        todayDate={today}
        dots={dots}
        dayEvents={dayEvents}
        conflicts={conflicts}
        loading={loading}
        mode={mode}
        onMode={setMode}
        weekCells={weekCells}
        onPrev={onPrev}
        onNext={onNext}
        onSelect={setSelected}
        onNew={() => setSheet({ mode: "new" })}
        onOpenEvent={openEdit}
        onPickSlot={onPickSlot}
        onPlanDay={() => setPlanOpen(true)}
        onUpload={ai.available ? () => setUploadOpen(true) : undefined}
        locked={blocked}
        windowStartMin={planWindow.wakeMin}
        windowEndMin={planWindow.endMin}
        now={selected === today ? nowHHMM : null}
        onEditRoutine={onEditRoutine}
        onPush15={onPush15}
        onPushTomorrow={onPushTomorrow}
        onRunningLate={onRunningLate}
        anytimeItems={anytimeItems}
        onToggleTask={onToggleTask}
        onScheduleTask={onScheduleTask}
        attachMap={attachMap}
      />
      {planOpen && (
        <PlanDaySheet
          events={dayEvents}
          tasks={planCandidates}
          startMin={planStart}
          endMin={planEnd}
          routineConfigured={routineSet}
          blocked={blocked}
          onEditRoutine={onEditRoutine ? () => { setPlanOpen(false); onEditRoutine(); } : undefined}
          onCommit={onPlanCommit}
          onAIPlan={onAIPlan}
          onClose={() => setPlanOpen(false)}
        />
      )}
      {uploadOpen && (
        <ScheduleUploadFlow
          ai={ai}
          svc={svc}
          categories={categories}
          existingEvents={allEvents}
          onDone={async ({ createdCount, updatedCount, undo }) => {
            setUploadOpen(false);
            await reload();
            const parts: string[] = [];
            if (createdCount) parts.push(`${createdCount} added`);
            if (updatedCount) parts.push(`${updatedCount} updated`);
            showToast({
              message: parts.join(", "),
              actionLabel: "Undo",
              onAction: async () => { await undo(); await reload(); },
            });
          }}
          onCancel={() => setUploadOpen(false)}
        />
      )}
      {sheet && (
        <EventSheet
          mode={sheet.mode}
          initial={sheet.mode === "edit" ? sheet.initial : { date: selected, start: newStart ?? nextFreeSlot(dayEvents, selected, new Date()) }}
          categories={categories}
          checkConflict={checkConflict}
          suggestSlot={suggestSlot}
          onSave={onSave}
          onDelete={sheet.mode === "edit" ? onDelete : undefined}
          onMoveToAnytime={sheet.mode === "edit" ? () => { const id = sheet.id; setSheet(null); onUnschedule(id); } : undefined}
          onCancel={() => { setSheet(null); setNewStart(null); }}
          suggestTitles={(typed) => suggestTitles(allEvents, typed)}
          suggestLocations={(t) => suggestLocations(allEvents, t)}
          attachTasks={attachableTasks}
          onToggleTask={onToggleAttached}
        />
      )}
      {guard && (
        <div className="ag-scrim" onClick={() => setGuard(null)}>
          <div className="ag-card" onClick={(e) => e.stopPropagation()}>
            <div className="ag-title">That&rsquo;s four anchors</div>
            <div className="ag-body">A lighter day tends to stick. Want to keep this one in Anytime instead?</div>
            <div className="ag-acts">
              <button className="btn btn-primary btn-block" onClick={async () => { const g = guard; setGuard(null); if (g) await onUnschedule(g.id); }}>Keep in Anytime</button>
              <button className="btn btn-tertiary btn-block" onClick={() => setGuard(null)}>Leave it scheduled</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

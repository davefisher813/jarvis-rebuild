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
import { todayISO, weekOf, addDays, addMinutes, minutesBetween, fmtTime, eventsForDate, nextFreeSlot, fmtRange, minToHHMM } from "./calendar";
import { isKept, keepBoth } from "./overlapAck";
import OverlapSheet from "./screens/OverlapSheet";
import { planDay } from "./planDay";
import { anytimeTasksForDay } from "./anytime";
import { suggestTitles, suggestLocations, repeatCandidate } from "./memory";
import { attachInfo, followUpCandidate, type AttachInfo } from "./attachments";
import { bestPerBlock, blockKind, recordBlend, loadBlendMemory } from "./blend";
import type { EventItem, EventData } from "./types";
import { showToast } from "../shared/toast";
import { attemptWrite } from "../shared/guard";
import PlanDaySheet from "./screens/PlanDaySheet";
import { aiPlanDay } from "./planDayAI";
import { DEFAULT_ROUTINE, planWindowFor, protectedRangesFor, splitProtectedRanges, type RoutineData } from "../routine/types";
import { chronotypeFor, peakWindowFor } from "./energy";
import { isSuggested, rankCandidates } from "./planMeta";
import { shiftFutureEvents, restoreShift, type ShiftResult } from "./runningLate";
import { useAI } from "../ai/useAI";
import { useAIContext } from "../ai/useAIContext";
import { contextToText } from "../ai/context";
import type { TaskItem } from "../tasks/TasksService";
import { repeatRows, repeatDays } from "./repeats";
import { overlapsOn, overlapLine, copyDay, duplicateOf, durationOf, type Overlap } from "./dayEdit";
import { capAfterNumber } from "../shared/casing";

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
  const [mode, setMode] = useState<"day" | "week" | "month" | "repeats">("month");
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
    // Self-healing dedupe (hotfix 2026-08-21): a task never keeps two plan
    // events on the viewed day. Runs on what this read actually sees, so a
    // cold read heals nothing rather than deleting on absence.
    const d = new Date();
    const healNow = selected === todayISO() ? d.getHours() * 60 + d.getMinutes() : null;
    await svc.healPlanDuplicates(selected, healNow);
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

  // ONE OVERLAP MODEL (hotfix 2026-08-21): the badges, the collide card, and
  // the clash count all read this same pair list, minus the pairs Dave has
  // deliberately kept, so no two surfaces can tell different stories about
  // the same day. Container blocks (focus, protected) are routine ranges,
  // not events, and are never collision partners here.
  const dayOverlaps = overlapsOn(allEvents, selected).filter((o) => !isKept(o, selected));
  const conflicts = new Set<string>(dayOverlaps.flatMap((o) => [o.a.id, o.b.id]));
  const [fixing, setFixing] = useState<Overlap | null>(null);
  const toMin = (hhmm: string) => { const p = hhmm.split(":"); return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0); };
  const checkConflict = (date: string, startT: string, endT: string) => {
    const others = eventsForDate(allEvents, date).filter((e) => !(sheet && sheet.mode === "edit" && e.id === sheet.id));
    const s = toMin(startT), en = endT ? toMin(endT) : s + 60;
    return others.some((e) => { const es = toMin(e.data.start), ee = e.data.end ? toMin(e.data.end) : es + 60; return s < ee && es < en; });
  };

  const realToday = todayISO();
  const plannedTaskIds = new Set(dayEvents.map((e) => e.data.sourceTaskId).filter((x): x is string => !!x));
  const planCandidates = taskItems
    // A reminder is not a task (catalog Q1): never a plan candidate.
    .filter((t) => !t.data.done && !t.data.reminder && !plannedTaskIds.has(t.id) && (!t.data.due || (t.data.due as string) <= selected))
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
    // Replace, never add (hotfix 2026-08-21): commitPlan sweeps each task's
    // prior plan event on this day before writing, against a fresh read.
    let ids: string[] = [];
    const ok = await attemptWrite(async () => {
      ids = (await svc.commitPlan(selected, blocks)).created;
    });
    setPlanOpen(false);
    await reload();
    if (!ok) return;
    showToast({
      message: `Planned ${blocks.length} ${blocks.length === 1 ? "block" : "blocks"}`,
      actionLabel: "Undo",
      onAction: async () => { await attemptWrite(async () => { for (const id of ids) await svc.deleteEvent(id); }); await reload(); },
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
        await attemptWrite(() => svc.createEvent(e.title, { date: e.date, start: e.start, end: e.end, category: e.category || undefined, location: e.location, recurrence: e.recurrence }));
        await reload();
      },
    });
  };

  const onSave = async (draft: EventDraft, scope?: "this" | "series") => {
    let newEventId: string | null = null;
    let newEventDate: string | null = null;
    if (sheet?.mode === "new") {
      const created = await attemptWrite(async () => {
        newEventId = await svc.createEvent(draft.title, { date: draft.date, start: draft.start, end: draft.end || undefined, category: draft.category || undefined, location: draft.location || undefined, recurrence: draft.recurrence, until: draft.until || undefined, taskIds: draft.taskIds });
      });
      if (!created) newEventId = null;
      newEventDate = draft.date;
    } else if (sheet?.mode === "edit") {
      const id = sheet.id;
      const recurring = (sheet.initial.recurrence ?? "none") !== "none";
      if (recurring && scope === "this") {
        // Split one occurrence off the series into a standalone event.
        await attemptWrite(async () => {
          await svc.addExdate(id, selected);
          await svc.createEvent(draft.title, { date: draft.date, start: draft.start, end: draft.end || undefined, category: draft.category || undefined, location: draft.location || undefined });
        });
      } else {
        await attemptWrite(async () => {
          await svc.editTitle(id, draft.title);
          if (!recurring) await svc.moveDay(id, draft.date);
          await svc.editTime(id, draft.start);
          await svc.editEnd(id, draft.end);
          await svc.editRecurrence(id, draft.recurrence);
          await svc.editUntil(id, draft.until || null);
          await svc.editCategory(id, draft.category);
          await svc.editLocation(id, draft.location);
          await svc.editTaskIds(id, draft.taskIds ?? []);
        });
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
            message: `Third ${WD[cand.weekday]} running · repeat weekly?`,
            actionLabel: "Make It Repeat",
            onAction: async () => { await attemptWrite(() => svc.editRecurrence(evId, "weekly")); await reload(); },
          });
        }
      }
    }
  };

  const onDelete = async (scope?: "this" | "series") => {
    if (sheet?.mode === "edit") {
      const recurring = (sheet.initial.recurrence ?? "none") !== "none";
      if (recurring && scope === "this") {
        await attemptWrite(() => svc.addExdate(sheet.id, selected));
      } else {
        const e = await svc.event(sheet.id);
        const ok = await attemptWrite(() => svc.deleteEvent(sheet.id));
        if (ok && e) offerUndoEvent(e);
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
    .map((t) => ({ id: t.id, text: t.data.text, category: t.data.category ?? "", done: t.data.done, due: t.data.due ?? null, projectId: t.data.projectId }));
  const onToggleAttached = async (id: string) => { await attemptWrite(() => tasksSvc.toggleDone(id)); await reloadTasks(); };

  // BLENDING (Dave, 2026-08-21). Attaching a task to a block already worked;
  // it was just buried six fields deep in an editor. The offer now comes to
  // the block, on the day list, one tap, no sheet.
  //
  // Only ONE offer per block and only when it is clearly the best fit. A
  // suggestion that is a coin flip between two tasks is worse than silence,
  // because tapping it stops being a shortcut and starts being a gamble.
  const blendMem = loadBlendMemory();
  const blendTap = async (e: EventItem, taskId: string, categoryId: string) => {
    const prior = e.data.taskIds ?? [];
    const ok = await attemptWrite(() => svc.editTaskIds(e.id, [...prior, taskId]));
    if (!ok) return;
    // The vote is only cast when the blend actually lands. Learning from an
    // attach that failed to write would teach the app a habit he never had.
    recordBlend(blockKind(e.data), categoryId);
    await reload();
    showToast({
      message: "Added to " + e.data.title,
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(() => svc.editTaskIds(e.id, prior));
        await reload();
      },
    });
  };
  const blendMap: Record<string, { text: string; why: string; onAdd: () => void }> = {};
  {
    // A block that already holds something is not asking for more. One
    // suggestion at a time, or the day list turns into a second to-do list.
    const open = dayEvents.filter((e) => (e.data.taskIds ?? []).length === 0);
    const byEvent = bestPerBlock(open, attachableTasks, blendMem);
    for (const e of open) {
      const fit = byEvent[e.id];
      if (!fit) continue;
      blendMap[e.id] = {
        text: fit.task.text,
        why: fit.why,
        onAdd: () => { void blendTap(e, fit.task.id, fit.task.category); },
      };
    }
  }

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
      message: `${cand.title} · ${cand.openCount} attached ${cand.openCount === 1 ? "task" : "tasks"} · any done?`,
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
  const onToggleTask = async (id: string) => { await attemptWrite(() => tasksSvc.toggleDone(id)); await reloadTasks(); };

  // Give-back: move a timed block back to Anytime. If it came from a task the
  // task still exists, so deleting the block returns it to the strip; a manual
  // event becomes a fresh task first. Undo restores the block either way.
  const onUnschedule = async (id: string) => {
    const e = await svc.event(id);
    if (!e) return;
    let restoredTaskId: string | undefined;
    const ok = await attemptWrite(async () => {
      if (!e.sourceTaskId) restoredTaskId = (await tasksSvc.createTask(e.title, { category: e.category || undefined })) ?? undefined;
      await svc.deleteEvent(id);
    });
    await reload();
    await reloadTasks();
    if (!ok) return;
    showToast({
      message: "Moved to Anytime",
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(async () => {
          if (restoredTaskId) await tasksSvc.deleteTask(restoredTaskId);
          await svc.createEvent(e.title, { date: e.date, start: e.start, end: e.end, category: e.category || undefined, location: e.location, recurrence: e.recurrence, sourceTaskId: e.sourceTaskId });
        });
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
  const onScheduleTask = async (id: string, droppedAt?: string) => {
    const t = await tasksSvc.task(id);
    if (!t) return;
    // C3 (audit 2026-08-21): a drag that ignores WHERE you dropped is a
    // long-winded way to press a button. When the finger landed on real open
    // time, that IS the answer and the planner does not get a vote.
    if (droppedAt) {
      const okDrop = await attemptWrite(() => svc.commitPlan(selected, [{
        taskId: id, text: t.text, category: t.category ?? "",
        start: droppedAt, end: addMinutes(droppedAt, 60),
      }]));
      await reload();
      if (okDrop) showToast({ message: `Scheduled ${fmtTime(droppedAt).time}${fmtTime(droppedAt).ap}` });
      return;
    }
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
    let evId: string | null = null;
    const ok = await attemptWrite(async () => {
      const r = await svc.commitPlan(selected, [{ taskId: id, text: t.text, category: t.category ?? "", start, end }]);
      evId = r.created[0] ?? null;
    });
    await reload();
    await reloadTasks();
    if (!ok) return;
    const guarded = evId ? await maybeAnchorGuard(selected, evId) : false;
    if (!guarded) showToast({
      message: `Scheduled ${fmtRange(start, end)}`,
      actionLabel: "Undo",
      onAction: async () => { await attemptWrite(async () => { if (evId) await svc.deleteEvent(evId); }); await reload(); await reloadTasks(); },
    });
  };

  // --- Roadmap v2 schedule basics ---
  const nowHHMM = (() => { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; })();

  // MOVING IS THE WHOLE FEATURE (Dave 2026-08-19: "the schedule is still way
  // too difficult to move things around. Locked in stuff should be moveable
  // with no issue").
  //
  // Every move goes through here, including repeating events. A repeating
  // event used to be excluded from every quick action outright, which is why
  // "locked in" things felt immovable: the only way to shift one was the full
  // editor. Blocking was never the right answer. Moving a SERIES from a swipe
  // is the footgun; moving ONE DAY of it is not, and the split-one-occurrence
  // path the editor already uses does exactly that. So:
  //   one-off   -> edit the times in place
  //   repeating -> exclude this date and drop a standalone copy at the new
  //                time, labelled "just today", with the series untouched
  // Both paths return a single Undo that restores the world exactly.
  const moveEvent = async (id: string, toStart: string, label: string) => {
    const e = await svc.event(id);
    if (!e) return;
    const repeating = (e.recurrence ?? "none") !== "none";
    const dur = e.end ? minutesBetween(e.start, e.end) : null;
    const newEnd = dur !== null ? addMinutes(toStart, dur) : undefined;

    if (!repeating) {
      const ok = await attemptWrite(async () => {
        await svc.editTime(id, toStart);
        if (e.end) await svc.editEnd(id, newEnd!);
      });
      await reload();
      if (!ok) return;
      showToast({
        message: label,
        actionLabel: "Undo",
        onAction: async () => {
          await attemptWrite(async () => { await svc.editTime(id, e.start); if (e.end) await svc.editEnd(id, e.end); });
          await reload();
        },
      });
      return;
    }

    // Repeating: split just this day off the series.
    let copyId: string | null = null;
    const ok = await attemptWrite(async () => {
      await svc.addExdate(id, selected);
      copyId = await svc.createEvent(e.title, {
        date: selected, start: toStart, end: newEnd,
        category: e.category || undefined, location: e.location || undefined,
      });
    });
    await reload();
    if (!ok) return;
    showToast({
      message: label + " · just today",
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(async () => {
          if (copyId) await svc.deleteEvent(copyId);
          await svc.removeExdate(id, selected);
        });
        await reload();
      },
    });
  };

  // Shift by a relative amount: the quick actions. Negative shifts exist
  // because until now nothing in the app could move an event EARLIER.
  const onShift = async (id: string, mins: number) => {
    const e = await svc.event(id);
    if (!e) return;
    const word = mins < 0
      ? `Back ${Math.abs(mins) === 60 ? "1 hr" : Math.abs(mins) + " min"}`
      : `Forward ${mins === 60 ? "1 hr" : mins + " min"}`;
    await moveEvent(id, addMinutes(e.start, mins), word);
  };

  // Move to an exact time (the time tap, and later the drag drop).
  const onMoveTo = async (id: string, start: string) => {
    const t = fmtTime(start);
    await moveEvent(id, start, `Moved to ${t.time} ${t.ap}`);
  };

  // SKIP JUST THIS ONE: a repeating thing you are not doing today should not
  // need deleting or an editor visit. The series never notices.
  const onSkipToday = async (id: string) => {
    const e = await svc.event(id);
    if (!e) return;
    const ok = await attemptWrite(() => svc.addExdate(id, selected));
    await reload();
    if (!ok) return;
    showToast({
      message: "Skipped today",
      actionLabel: "Undo",
      onAction: async () => { await attemptWrite(() => svc.removeExdate(id, selected)); await reload(); },
    });
  };

  // Swipe: push one event to tomorrow, same time.
  const onPushTomorrow = async (id: string) => {
    const e = await svc.event(id);
    if (!e) return;
    const ok = await attemptWrite(() => svc.moveDay(id, addDays(e.date, 1)));
    await reload();
    if (!ok) return;
    showToast({ message: "Moved to tomorrow", actionLabel: "Undo", onAction: async () => { await attemptWrite(() => svc.moveDay(id, e.date)); await reload(); } });
  };

  // Running Late: one tap shifts everything left in today as a unit. Recurring
  // events are skipped (shifting a series from one bad morning is wrong); the
  // toast says what moved and Undo restores every prior time.
  const onRunningLate = async (mins: number) => {
    let shift: ShiftResult | null = null;
    const ok = await attemptWrite(async () => { shift = await shiftFutureEvents(svc, dayEvents, nowHHMM, mins); });
    await reload();
    if (!ok || !shift) return;
    const { moved, skipped, prior } = shift;
    if (moved === 0) return;
    showToast({
      message: `${moved} ${moved === 1 ? "event" : "events"} +${mins === 60 ? "1 hr" : mins + " min"}${skipped ? ` · ${skipped} repeating stayed` : ""}`,
      actionLabel: "Undo",
      onAction: async () => { await attemptWrite(() => restoreShift(svc, prior)); await reload(); },
    });
  };

  // N5: the worst collision on the selected day. Worst, not first: if two
  // things clash by five minutes and two clash by an hour, the hour is the
  // one he actually needs told about. Reads the same acknowledged-filtered
  // list as the badges.
  const worstOverlap = [...dayOverlaps].sort((a, b) => b.byMin - a.byMin)[0] ?? null;

  // Badge tap (N5 completion): open the fix sheet on the pair this event is
  // part of. The later event of the pair is the one the sheet moves.
  const openOverlapFix = (eventId: string) => {
    const o = dayOverlaps.find((x) => x.a.id === eventId || x.b.id === eventId) ?? null;
    if (o) setFixing(o);
  };
  // The named landing slot for Move to Next Free: the first slot that clears
  // the collision, so the search starts where the earlier event ends (an
  // evening clash must not be offered a morning slot). Null when the day has
  // nothing honest to offer: nextFreeSlot's fallback re-proposes its own
  // start, so the result is re-checked against the day before the button is
  // allowed to promise it.
  const overlapNextFree = (o: Overlap): string | null => {
    const others = eventsForDate(allEvents, selected).filter((e) => e.id !== o.b.id);
    const dur = durationOf(o.b.data);
    const aEnd = toMin(o.a.data.start) + durationOf(o.a.data);
    const slot = nextFreeSlot(others, selected, new Date(), dur, minToHHMM(Math.min(aEnd, 24 * 60 - 1)));
    const s = toMin(slot);
    const honest = s + dur <= 24 * 60 && s >= aEnd
      && !others.some((e) => { const es = toMin(e.data.start), ee = e.data.end ? toMin(e.data.end) : es + 60; return s < ee && es < s + dur; });
    return honest ? slot : null;
  };
  const overlapMoveToFree = async (o: Overlap) => {
    const slot = overlapNextFree(o);
    if (!slot) return;
    const before = { start: o.b.data.start, end: o.b.data.end };
    const dur = durationOf(o.b.data);
    const ok = await attemptWrite(async () => {
      await svc.editTime(o.b.id, slot);
      if (before.end) await svc.editEnd(o.b.id, addMinutes(slot, dur));
    });
    await reload();
    if (ok) showToast({
      message: `${o.b.data.title} moved to ${fmtRange(slot, before.end ? addMinutes(slot, dur) : undefined)}`,
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(async () => {
          await svc.editTime(o.b.id, before.start);
          if (before.end) await svc.editEnd(o.b.id, before.end);
        });
        await reload();
      },
    });
  };

  // N7: yesterday's one-offs, on today. Repeats are left alone: they already
  // appear here by themselves and copying one would double it.
  // E2: duplicate this event as a fresh one-off.
  const duplicateEvent = async (id: string) => {
    const src = allEvents.find((e) => e.id === id);
    if (!src) return;
    const d = duplicateOf(src.data, selected);
    let made: string | null = null;
    const ok = await attemptWrite(async () => {
      made = await svc.createEvent(d.title, { date: d.date, start: d.start, end: d.end, category: d.category || undefined, location: d.location });
    });
    setSheet(null);
    await reload();
    if (ok && made) showToast({
      message: "Duplicated",
      actionLabel: "Undo",
      onAction: async () => { await attemptWrite(() => svc.deleteEvent(made!)); await reload(); },
    });
  };

  const copyYesterday = async () => {
    const prev = addDays(selected, -1);
    const copies = copyDay(allEvents, prev, selected);
    if (copies.length === 0) { showToast({ message: "Nothing to copy from yesterday" }); return; }
    const made: string[] = [];
    const ok = await attemptWrite(async () => {
      for (const c of copies) {
        const id = await svc.createEvent(c.title, { date: c.date, start: c.start, end: c.end, category: c.category || undefined, location: c.location });
        if (id) made.push(id);
      }
    });
    await reload();
    if (ok) showToast({
      message: capAfterNumber(`${made.length} ${made.length === 1 ? "event" : "events"} copied`),
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(async () => { for (const id of made) await svc.deleteEvent(id); });
        await reload();
      },
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
        repeats={repeatRows(allEvents)}
        repeatMarks={repeatDays(allEvents, weekCells.map((c) => c.date))}
        overlap={worstOverlap ? { line: overlapLine(worstOverlap) } : null}
        onFixOverlap={worstOverlap ? () => openOverlapFix(worstOverlap.b.id) : undefined}
        clashCount={dayOverlaps.length}
        onOverlapBadge={openOverlapFix}
        onCopyDay={() => void copyYesterday()}
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
        onShift={onShift}
        onMoveTo={onMoveTo}
        onSkipToday={onSkipToday}
        onPushTomorrow={onPushTomorrow}
        onRunningLate={onRunningLate}
        anytimeItems={anytimeItems}
        onToggleTask={onToggleTask}
        onScheduleTask={onScheduleTask}
        attachMap={attachMap}
        blendMap={blendMap}
      />
      {fixing && (
        <OverlapSheet
          overlap={fixing}
          nextFree={overlapNextFree(fixing)}
          onNudge={(m) => { const o = fixing; setFixing(null); void onShift(o.b.id, m); }}
          onTomorrow={() => { const o = fixing; setFixing(null); void onPushTomorrow(o.b.id); }}
          onMoveToFree={() => { const o = fixing; setFixing(null); void overlapMoveToFree(o); }}
          onKeepBoth={() => { keepBoth(fixing, selected); setFixing(null); }}
          onClose={() => setFixing(null)}
        />
      )}
      {planOpen && (
        <PlanDaySheet
          events={dayEvents}
          tasks={planCandidates}
          startMin={planStart}
          endMin={planEnd}
          date={selected}
          dayLabel={selected === todayISO() ? "Today" : new Date(selected + "T12:00:00").toLocaleDateString([], { weekday: "long" })}
          alreadyPlanned={dayEvents.filter((e) => !!e.data.sourceTaskId).map((e) => e.data.title)}
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
          onDuplicate={sheet.mode === "edit" ? () => void duplicateEvent(sheet.id) : undefined}
          onMoveToAnytime={sheet.mode === "edit" ? () => { const id = sheet.id; setSheet(null); onUnschedule(id); } : undefined}
          onCancel={() => { setSheet(null); setNewStart(null); }}
          suggestTitles={(typed) => suggestTitles(allEvents, typed)}
          suggestLocations={(t) => suggestLocations(allEvents, t)}
          attachTasks={attachableTasks}
          onToggleTask={onToggleAttached}
          onBlend={(kind, categoryId) => recordBlend(kind, categoryId)}
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

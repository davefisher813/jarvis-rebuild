import { useCallback, useEffect, useState } from "react";
import { useSchedule, useCategories, useTasks, useRoutine } from "../data/NotesProvider";
import SchedulePage from "./screens/SchedulePage";
import EventSheet, { type SheetCategory, type EventDraft } from "./screens/EventSheet";
import { todayISO, weekOf, addDays, addMinutes, eventsForDate, findConflicts, nextFreeSlot } from "./calendar";
import type { EventItem, EventData } from "./types";
import { showToast } from "../shared/toast";
import PlanDaySheet from "./screens/PlanDaySheet";
import { aiPlanDay } from "./planDayAI";
import { DEFAULT_ROUTINE, planWindowFor, protectedRangesFor, type RoutineData } from "../routine/types";
import { chronotypeFor, peakWindowFor } from "./energy";
import { useAI } from "../ai/useAI";
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
  const [sheet, setSheet] = useState<SheetState>(null);
  const [mode, setMode] = useState<"day" | "week" | "month">("month");
  const [allEvents, setAllEvents] = useState<EventItem[]>([]);
  const tasksSvc = useTasks();
  const [taskItems, setTaskItems] = useState<TaskItem[]>([]);
  const [planOpen, setPlanOpen] = useState(false);
  const ai = useAI();
  const routine = useRoutine();
  const [routineData, setRoutineData] = useState<RoutineData>(DEFAULT_ROUTINE);
  const [routineSet, setRoutineSet] = useState(true);
  const [loading, setLoading] = useState(true);
  const [newStart, setNewStart] = useState<string | null>(null);

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
      if (on) setCategories(list.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color })));
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
    .map((t) => {
      const due = (t.data.due as string) || "";
      return { id: t.id, text: t.data.text, category: t.data.category ?? "", due, suggested: !!due && due <= selected, overdue: !!due && due < realToday };
    })
    .sort((a, b) => (a.suggested !== b.suggested ? (a.suggested ? -1 : 1) : (a.due || "z").localeCompare(b.due || "z")));
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
    ? (picks: { id: string; text: string; category: string; overdue: boolean }[], s: number, e: number) => aiPlanDay(ai, picks, dayEvents, s, e, {
        work: { startMin: routineData.workStartMin, endMin: routineData.workEndMin },
        energy,
      })
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
    setSheet({ mode: "edit", id, initial: { title: e.title, date: e.date, start: e.start, end: e.end ?? "", category: e.category ?? "", location: e.location ?? "", recurrence: e.recurrence ?? "none" } });
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
      setSheet({ mode: "edit", id: openId, initial: { title: e.title, date: e.date, start: e.start, end: e.end ?? "", category: e.category ?? "", location: e.location ?? "", recurrence: e.recurrence ?? "none" } });
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
    if (sheet?.mode === "new") {
      await svc.createEvent(draft.title, { date: draft.date, start: draft.start, end: draft.end || undefined, category: draft.category || undefined, location: draft.location || undefined, recurrence: draft.recurrence });
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
      }
    }
    setSheet(null);
    setNewStart(null);
    await reload();
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
    const future = dayEvents.filter((e) => (!e.data.recurrence || e.data.recurrence === "none") && e.data.start >= nowHHMM);
    if (future.length === 0) return;
    const prior = future.map((e) => ({ id: e.id, start: e.data.start, end: e.data.end ?? null }));
    for (const e of future) {
      await svc.editTime(e.id, addMinutes(e.data.start, mins));
      if (e.data.end) await svc.editEnd(e.id, addMinutes(e.data.end, mins));
    }
    await reload();
    const skipped = dayEvents.filter((e) => e.data.recurrence && e.data.recurrence !== "none" && e.data.start >= nowHHMM).length;
    showToast({
      message: `Shifted ${future.length} ${future.length === 1 ? "event" : "events"} by ${mins === 60 ? "an hour" : mins + " minutes"}${skipped ? ` (${skipped} repeating left in place)` : ""}`,
      actionLabel: "Undo",
      onAction: async () => { for (const p of prior) { await svc.editTime(p.id, p.start); if (p.end) await svc.editEnd(p.id, p.end); } await reload(); },
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
        locked={blocked}
        now={selected === today ? nowHHMM : null}
        onEditRoutine={onEditRoutine}
        onPush15={onPush15}
        onPushTomorrow={onPushTomorrow}
        onRunningLate={onRunningLate}
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
      {sheet && (
        <EventSheet
          mode={sheet.mode}
          initial={sheet.mode === "edit" ? sheet.initial : { date: selected, start: newStart ?? nextFreeSlot(dayEvents, selected, new Date()) }}
          categories={categories}
          checkConflict={checkConflict}
          suggestSlot={suggestSlot}
          onSave={onSave}
          onDelete={sheet.mode === "edit" ? onDelete : undefined}
          onCancel={() => { setSheet(null); setNewStart(null); }}
        />
      )}
    </>
  );
}

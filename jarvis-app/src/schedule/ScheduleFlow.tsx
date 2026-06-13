import { useCallback, useEffect, useState } from "react";
import { useSchedule, useCategories } from "../data/NotesProvider";
import SchedulePage from "./screens/SchedulePage";
import EventSheet, { type SheetCategory, type EventDraft } from "./screens/EventSheet";
import { todayISO, weekOf, addDays, eventsForDate, findConflicts, nextFreeSlot } from "./calendar";
import type { EventItem, EventData } from "./types";
import { showToast } from "../shared/toast";

type SheetState = { mode: "new" } | { mode: "edit"; id: string; initial: EventDraft } | null;

export default function ScheduleFlow() {
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

  const weekCells = weekOf(selected).map((date) => {
    const evs = eventsForDate(allEvents, date);
    const day = new Date(date + "T00:00:00").getDate();
    const colors = Array.from(new Set(evs.map((e) => e.data.category))).slice(0, 3);
    return { date, day, colors };
  });

  const openEdit = async (id: string) => {
    const e = await svc.event(id);
    if (!e) return;
    setSheet({ mode: "edit", id, initial: { title: e.title, date: selected, start: e.start, end: e.end ?? "", category: e.category ?? "", location: e.location ?? "", recurrence: e.recurrence ?? "none" } });
  };

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
      />
      {sheet && (
        <EventSheet
          mode={sheet.mode}
          initial={sheet.mode === "edit" ? sheet.initial : { date: selected, start: newStart ?? nextFreeSlot(dayEvents, selected, new Date()) }}
          categories={categories}
          checkConflict={checkConflict}
          onSave={onSave}
          onDelete={sheet.mode === "edit" ? onDelete : undefined}
          onCancel={() => { setSheet(null); setNewStart(null); }}
        />
      )}
    </>
  );
}

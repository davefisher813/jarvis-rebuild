import { useCallback, useEffect, useState } from "react";
import { useSchedule, useCategories } from "../data/NotesProvider";
import SchedulePage from "./screens/SchedulePage";
import EventSheet, { type SheetCategory, type EventDraft } from "./screens/EventSheet";
import { todayISO, weekOf, addDays, eventsForDate } from "./calendar";
import type { EventItem } from "./types";

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

  const weekCells = weekOf(selected).map((date) => {
    const evs = eventsForDate(allEvents, date);
    const day = new Date(date + "T00:00:00").getDate();
    const colors = Array.from(new Set(evs.map((e) => e.data.category))).slice(0, 3);
    return { date, day, colors };
  });

  const openEdit = async (id: string) => {
    const e = await svc.event(id);
    if (!e) return;
    setSheet({ mode: "edit", id, initial: { title: e.title, date: e.date, start: e.start, category: e.category ?? "", location: e.location ?? "" } });
  };

  const onSave = async (draft: EventDraft) => {
    if (sheet?.mode === "new") {
      await svc.createEvent(draft.title, { date: draft.date, start: draft.start, category: draft.category || undefined, location: draft.location || undefined });
    } else if (sheet?.mode === "edit") {
      await svc.editTitle(sheet.id, draft.title);
      await svc.moveDay(sheet.id, draft.date);
      await svc.editTime(sheet.id, draft.start);
      await svc.editCategory(sheet.id, draft.category);
      await svc.editLocation(sheet.id, draft.location);
    }
    setSheet(null);
    await reload();
  };

  const onDelete = async () => {
    if (sheet?.mode === "edit") await svc.deleteEvent(sheet.id);
    setSheet(null);
    await reload();
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
        loading={loading}
        mode={mode}
        onMode={setMode}
        weekCells={weekCells}
        onPrev={onPrev}
        onNext={onNext}
        onSelect={setSelected}
        onNew={() => setSheet({ mode: "new" })}
        onOpenEvent={openEdit}
      />
      {sheet && (
        <EventSheet
          mode={sheet.mode}
          initial={sheet.mode === "edit" ? sheet.initial : { date: selected, start: "09:00" }}
          categories={categories}
          onSave={onSave}
          onDelete={sheet.mode === "edit" ? onDelete : undefined}
          onCancel={() => setSheet(null)}
        />
      )}
    </>
  );
}

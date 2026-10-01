// MAKE AN EVENT FROM THE NEW EVENT SHEET'S DRAFT (schedule audit 2026-10-01,
// item 8). The Schedule tab has always made one from its "+"; Today had no
// New Event at all, so the page you start the day on could edit an event and
// not add one. The sheet is the same EventSheet; the write is this, so the
// two surfaces cannot disagree about which fields a new event carries.
import type { EventDraft } from "./screens/EventSheet";

interface EventMaker {
  createEvent(title: string, opts: Record<string, unknown>): Promise<string | null>;
  editGymDoor(id: string, gym: boolean): Promise<unknown>;
}

export async function createEventFromDraft(draft: EventDraft, events: EventMaker): Promise<string | null> {
  const id = await events.createEvent(draft.title, {
    date: draft.date, start: draft.start, end: draft.end || undefined,
    category: draft.category || undefined, location: draft.location || undefined,
    recurrence: draft.recurrence, until: draft.until || undefined,
    days: draft.days, interval: draft.interval, taskIds: draft.taskIds,
    travelMin: draft.travelMin ?? undefined, bufferMin: draft.bufferMin ?? undefined,
    url: draft.url, notes: draft.notes, projectId: draft.projectId || undefined,
  });
  if (id && draft.gym) await events.editGymDoor(id, true);
  return id;
}

import type { ScheduleService } from "../../schedule/ScheduleService";
import type { GoogleApi } from "./api";
import { mapGoogleEvent, mapGmailMessage, type MailRow } from "./map";

// Imports upcoming Google events into the engine as real events, skipping any
// already imported (matched on gcalId), so re-running is safe and idempotent.
// Returns the number of new events created.
export async function importCalendar(api: Pick<GoogleApi, "listUpcomingEvents">, schedule: ScheduleService, max = 25): Promise<number> {
  const events = await api.listUpcomingEvents(max);
  const existing = await schedule.listEvents();
  const seen = new Set(
    existing.map((e) => (e.data as { gcalId?: string }).gcalId).filter((x): x is string => !!x),
  );
  let created = 0;
  for (const g of events) {
    const m = mapGoogleEvent(g);
    if (!m || seen.has(m.gcalId)) continue;
    const id = await schedule.createEvent(m.title, {
      date: m.date,
      start: m.start,
      end: m.end,
      location: m.location,
      gcalId: m.gcalId,
    });
    if (id) {
      created++;
      seen.add(m.gcalId);
    }
  }
  return created;
}

// Fetches recent mail headers and maps them to display rows (read-only preview).
export async function listMail(api: Pick<GoogleApi, "listRecentMessages">, max = 15): Promise<MailRow[]> {
  const metas = await api.listRecentMessages(max);
  return metas.map(mapGmailMessage);
}

import type { ScheduleService } from "../../schedule/ScheduleService";
import type { GoogleApi } from "./api";
import { mapGoogleEvent, mapGmailMessage, type MailRow } from "./map";

// Imports upcoming Google events into the engine as real events, skipping any
// already imported (matched on gcalId), so re-running is safe and idempotent.
// Returns the number of new events created.
//
// Two hard-won rules live here:
//   1. SWEEP FIRST. Right after an app open, listEvents() can be read before
//      remote data has landed, so a past import's events are invisible and
//      everything imports again (Dave's schedule once held a dozen identical
//      midnight briefs, every one flagged Overlaps). The sweep deletes any
//      extra copies sharing a gcalId — keeping the first — so even if a cold
//      read ever duplicates again, the next connect heals it.
//   2. COLD-READ GUARD. A marker remembers that a past import happened; if the
//      store then shows zero imported events, the read was cold — wait and
//      re-read before trusting it, instead of re-importing the world.
const IMPORTED_MARK = "jarvis.gcal.imported.v1";

// localStorage is absent outside the browser (tests, SSR): fall back to a
// no-op store, which simply means the cold-read guard never engages there.
function defaultStorage(): Pick<Storage, "getItem" | "setItem"> {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch { /* fall through */ }
  return { getItem: () => null, setItem: () => {} };
}

async function trustedExisting(
  schedule: ScheduleService,
  storage: Pick<Storage, "getItem">,
  wait: (ms: number) => Promise<void>,
): Promise<Awaited<ReturnType<ScheduleService["listEvents"]>>> {
  let existing = await schedule.listEvents();
  const importedBefore = !!storage.getItem(IMPORTED_MARK);
  let tries = 0;
  while (importedBefore && tries < 3 && !existing.some((e) => (e.data as { gcalId?: string }).gcalId)) {
    await wait(800);
    existing = await schedule.listEvents();
    tries++;
  }
  return existing;
}

export async function importCalendar(
  api: Pick<GoogleApi, "listUpcomingEvents">,
  schedule: ScheduleService,
  max = 25,
  storage: Pick<Storage, "getItem" | "setItem"> = defaultStorage(),
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<number> {
  const events = await api.listUpcomingEvents(max);
  const existing = await trustedExisting(schedule, storage, wait);

  // Self-healing sweep: one event per gcalId, first one wins.
  const byGcal = new Map<string, string>(); // gcalId -> keeper event id
  for (const e of existing) {
    const gid = (e.data as { gcalId?: string }).gcalId;
    if (!gid) continue;
    if (byGcal.has(gid)) await schedule.deleteEvent(e.id);
    else byGcal.set(gid, e.id);
  }

  const seen = new Set(byGcal.keys());
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
  if (seen.size > 0) {
    try { storage.setItem(IMPORTED_MARK, "1"); } catch { /* marker is best-effort */ }
  }
  return created;
}

// Fetches recent mail headers and maps them to display rows (read-only preview).
export async function listMail(api: Pick<GoogleApi, "listRecentMessages">, max = 15): Promise<MailRow[]> {
  const metas = await api.listRecentMessages(max);
  return metas.map(mapGmailMessage);
}

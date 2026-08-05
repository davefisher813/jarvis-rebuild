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
//      midnight briefs, every one flagged Overlaps). The sweep deletes extra
//      copies (same gcalId, or same title+date+start under different ids) so
//      whatever caused them, the next import heals it.
//   2. COLD-READ GUARD. A marker remembers that a past import happened; if the
//      store then shows zero imported events, the read was cold, wait and
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

  // Self-healing sweep, two layers, gcal-imported events ONLY (a user-created
  // event is never touched):
  //   - one event per gcalId (repeated imports of the same event), and
  //   - one event per identical (title, date, start) slot (the same thing
  //     imported under DIFFERENT Google ids, e.g. an upstream automation
  //     writing the same brief into Google Calendar many times over).
  // First one wins. Two genuinely distinct primary-calendar events with the
  // same title at the same minute are indistinguishable from junk; we accept
  // collapsing them and say so here rather than pretending it cannot happen.
  const slotOf = (d: { title?: string; date?: string; start?: string }) =>
    (d.title || "") + "|" + (d.date || "") + "|" + (d.start || "");
  const seen = new Set<string>();
  const seenSlots = new Set<string>();
  for (const e of existing) {
    const d = e.data as { gcalId?: string; title?: string; date?: string; start?: string };
    if (!d.gcalId) continue;
    const slot = slotOf(d);
    if (seen.has(d.gcalId) || seenSlots.has(slot)) {
      await schedule.deleteEvent(e.id);
      continue;
    }
    seen.add(d.gcalId);
    seenSlots.add(slot);
  }

  let created = 0;
  for (const g of events) {
    const m = mapGoogleEvent(g);
    if (!m || seen.has(m.gcalId) || seenSlots.has(slotOf(m))) continue;
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
      seenSlots.add(slotOf(m));
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

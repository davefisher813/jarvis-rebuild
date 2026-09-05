import type { ScheduleService } from "../../schedule/ScheduleService";
import type { EventData } from "../../schedule/types";
import { todayISO, addDays } from "../../schedule/calendar";
import type { GoogleApi } from "./api";
import { mapGoogleEvent, type MappedEvent } from "./map";

// Keeps the Schedule tab in step with Google for the events that came from
// Google: new ones arrive, changed ones change, cancelled ones leave.
// Everything he made himself is untouched, and so is everything he added to
// an imported event.
//
// Three hard-won rules live here:
//   1. SWEEP FIRST. Right after an app open, listEvents() can be read before
//      remote data has landed, so a past import's events are invisible and
//      everything imports again (Dave's schedule once held a dozen identical
//      midnight briefs, every one flagged Overlaps). The sweep deletes extra
//      copies (same gcalId, or same title+date+start under different ids) so
//      whatever caused them, the next import heals it.
//   2. COLD-READ GUARD. A marker remembers that a past import happened; if the
//      store then shows zero imported events, the read was cold, wait and
//      re-read before trusting it, instead of re-importing the world.
//   3. NOTHING IS DELETED ON AN ABSENCE ALONE unless the window can vouch for
//      it. See the window notes below.
//
// PLUMB-F-07 (2026-09-05): this was create-only. A meeting moved in Google
// from Tuesday 3 PM to Thursday 4 PM stayed on Tuesday here, with Leave By
// and its reminders firing for the wrong day; a cancelled meeting stayed on
// the schedule; and only the next 25 upcoming events ever arrived. The row on
// Connections says events "flow into Schedule", and a wrong meeting time is
// the costliest thing this app can be wrong about.
const IMPORTED_MARK = "jarvis.gcal.imported.v1";

// How far ahead an import looks, and how many events it will take. The old
// cap was 25 events with no far end at all, which on a normal week meant the
// import stopped somewhere inside the next few days. Sixty days is the span
// the Schedule tab can actually be scrolled to care about, and 250 events
// covers a heavily booked one with room to spare (Google's own page limit is
// 2500).
const WINDOW_DAYS = 60;
const MAX_EVENTS = 250;

export interface ImportSummary {
  created: number;
  updated: number;
  removed: number;
}

// The Google-owned fields, in the order gcalHash records them.
function valuesOf(m: MappedEvent): [string, string, string, string, string] {
  return [m.title, m.date, m.start, m.end ?? "", m.location ?? ""];
}
function currentValues(d: EventData): [string, string, string, string, string] {
  return [d.title ?? "", d.date ?? "", d.start ?? "", d.end ?? "", d.location ?? ""];
}
function hashOf(m: MappedEvent): string {
  return JSON.stringify(valuesOf(m));
}
function readHash(raw: unknown): string[] | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) && v.length === 5 && v.every((x) => typeof x === "string") ? (v as string[]) : null;
  } catch {
    return null;
  }
}

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

// How much of himself is in this copy. Used only to decide WHICH duplicate
// survives the sweep: the one he filed, linked or marked as the gym door,
// rather than whichever happened to be created first. Before this, the sweep
// could keep the bare copy and delete the one he had worked on.
function userWork(d: EventData): number {
  return (d.category ? 1 : 0) + (d.taskIds?.length ? 1 : 0) + (d.gym ? 1 : 0) +
    (d.sourceTaskId ? 1 : 0) + (d.trained && Object.keys(d.trained).length ? 1 : 0);
}

export async function importCalendar(
  api: Pick<GoogleApi, "listUpcomingEvents">,
  schedule: ScheduleService,
  max = MAX_EVENTS,
  storage: Pick<Storage, "getItem" | "setItem"> = defaultStorage(),
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  now: Date = new Date(),
): Promise<ImportSummary> {
  const fromDate = todayISO(now);
  const fromTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const windowEnd = addDays(fromDate, WINDOW_DAYS);
  const raw = await api.listUpcomingEvents(max, {
    timeMaxISO: new Date(now.getTime() + WINDOW_DAYS * 86400000).toISOString(),
    showDeleted: true,
  });

  // Google's own word for "not happening" beats inferring it from an absence.
  const cancelled = new Set<string>();
  const live: MappedEvent[] = [];
  for (const g of raw) {
    if (g.status === "cancelled") {
      if (g.id) cancelled.add(g.id);
      continue;
    }
    const m = mapGoogleEvent(g);
    if (m) live.push(m);
  }
  const liveById = new Map(live.map((m) => [m.gcalId, m]));

  // THE WINDOW THIS IMPORT CAN VOUCH FOR. An imported event inside it that
  // Google no longer returns has genuinely gone; one outside it was simply
  // not asked about. Two clamps, both deliberately timid, because deleting
  // something real is far worse than leaving something stale:
  //   - the near end matches timeMin exactly, so an event earlier today that
  //     has already happened (and so is not in the feed) is never swept.
  //   - if the feed came back full it was probably truncated, so the far end
  //     retreats to before the last day it returned.
  const truncated = raw.length >= max && live.length > 0;
  const farEnd = truncated ? live[live.length - 1]!.date : windowEnd;
  const vouchedFor = (d: EventData): boolean => {
    const date = d.date ?? "";
    const start = d.start ?? "";
    if (date < fromDate || (date === fromDate && start < fromTime)) return false;
    return truncated ? date < farEnd : date <= farEnd;
  };
  // An empty feed is more often a bad read than a genuinely empty calendar,
  // so absence proves nothing when nothing came back. A cancelled event is
  // still explicitly cancelled and still goes.
  const trustAbsence = live.length > 0;

  const existing = await trustedExisting(schedule, storage, wait);

  // Self-healing sweep, two layers, gcal-imported events ONLY (a user-created
  // event is never touched):
  //   - one event per gcalId (repeated imports of the same event), and
  //   - one event per identical (title, date, start) slot (the same thing
  //     imported under DIFFERENT Google ids, e.g. an upstream automation
  //     writing the same brief into Google Calendar many times over).
  // The copy carrying his work wins; ties keep the first, as they always did.
  // Two genuinely distinct primary-calendar events with the same title at the
  // same minute are indistinguishable from junk; we accept collapsing them
  // and say so here rather than pretending it cannot happen.
  const slotOf = (d: { title?: string; date?: string; start?: string }) =>
    (d.title || "") + "|" + (d.date || "") + "|" + (d.start || "");
  const seen = new Set<string>();
  const seenSlots = new Set<string>();
  const kept: { id: string; data: EventData }[] = [];
  const byWork = [...existing].sort((a, b) => userWork(b.data) - userWork(a.data));
  for (const e of byWork) {
    const d = e.data;
    if (!d.gcalId) continue;
    const slot = slotOf(d);
    if (seen.has(d.gcalId) || seenSlots.has(slot)) {
      await schedule.deleteEvent(e.id);
      continue;
    }
    seen.add(d.gcalId);
    seenSlots.add(slot);
    kept.push({ id: e.id, data: d });
  }

  let updated = 0;
  let removed = 0;
  for (const e of kept) {
    const gcalId = e.data.gcalId!;
    const m = liveById.get(gcalId);
    if (!m) {
      if (cancelled.has(gcalId) || (trustAbsence && vouchedFor(e.data))) {
        await schedule.deleteEvent(e.id);
        removed++;
        seen.delete(gcalId);
        seenSlots.delete(slotOf(e.data));
      }
      continue;
    }
    // FIELD BY FIELD, AGAINST WHAT GOOGLE LAST SAID. A field he has changed
    // here reads differently from the record and is left exactly as he left
    // it, forever. A field he has not touched follows Google.
    //
    // An event with no record at all predates this (the importer was
    // create-only, so a change made here never meant anything and never
    // reached Google either): Google wins once, and the record written on
    // this pass protects every edit he makes from now on.
    const last = readHash(e.data.gcalHash);
    const incoming = valuesOf(m);
    const current = currentValues(e.data);
    const next: string[] = current.slice();
    let changed = false;
    for (let i = 0; i < incoming.length; i++) {
      const untouched = last === null || current[i] === last[i];
      if (untouched && incoming[i] !== current[i]) {
        next[i] = incoming[i]!;
        changed = true;
      }
    }
    const hash = hashOf(m);
    if (!changed && e.data.gcalHash === hash) continue;
    await schedule.applyGoogleChange(e.id, {
      title: next[0]!,
      date: next[1]!,
      start: next[2]!,
      end: next[3] || undefined,
      location: next[4] || undefined,
      gcalHash: hash,
    });
    if (changed) {
      updated++;
      seenSlots.delete(slotOf(e.data));
      seenSlots.add(slotOf({ title: next[0], date: next[1], start: next[2] }));
    }
  }

  let created = 0;
  for (const m of live) {
    if (seen.has(m.gcalId) || seenSlots.has(slotOf(m))) continue;
    const id = await schedule.createEvent(m.title, {
      date: m.date,
      start: m.start,
      end: m.end,
      location: m.location,
      gcalId: m.gcalId,
      gcalHash: hashOf(m),
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
  return { created, updated, removed };
}

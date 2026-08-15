// EventKit dedupe (native seven, item 2). Pure logic for Calendar events
// and Reminders arriving next to records JARVIS already holds (typed by
// hand, or imported earlier from Google or from a prior EventKit sync).
//
// Two passes, in order:
//   1. iCal UID: the same UID is the same event, wherever its start moved.
//   2. Title + start window: no UID match, but the same title starting
//      within 30 minutes is the same thing entered twice, not a new one.
// Anything else is fresh and imports with apple_calendar or apple_reminders
// provenance.

import { madeBy, type Source, type SourceType } from "../shared/provenance";

export const START_WINDOW_MS = 30 * 60 * 1000;

export interface IncomingEKItem {
  icalUid: string;
  title: string;
  // Epoch ms.
  start: number;
}

export interface ExistingScheduleItem {
  id: string;
  // Present when this record came from a calendar sync before.
  icalUid?: string;
  title: string;
  start: number;
}

export type EKMatchBy = "uid" | "title_window";

export interface EKMatch {
  incoming: IncomingEKItem;
  existingId: string;
  by: EKMatchBy;
}

export interface EKDedupeResult {
  fresh: IncomingEKItem[];
  matched: EKMatch[];
}

function normTitle(t: string): string {
  return t.trim().replace(/\s+/g, " ").toLowerCase();
}

export function dedupeEventKit(
  incoming: IncomingEKItem[],
  existing: ExistingScheduleItem[],
): EKDedupeResult {
  const fresh: IncomingEKItem[] = [];
  const matched: EKMatch[] = [];
  for (const item of incoming) {
    const byUid = existing.find((e) => !!e.icalUid && e.icalUid === item.icalUid);
    if (byUid) {
      matched.push({ incoming: item, existingId: byUid.id, by: "uid" });
      continue;
    }
    const title = normTitle(item.title);
    const byWindow = existing.find(
      (e) => normTitle(e.title) === title && Math.abs(e.start - item.start) <= START_WINDOW_MS,
    );
    if (byWindow) {
      matched.push({ incoming: item, existingId: byWindow.id, by: "title_window" });
      continue;
    }
    fresh.push(item);
  }
  return { fresh, matched };
}

// Provenance for a fresh import. kind picks the label the card renders:
// "From Apple Calendar" or "From Apple Reminders". ref is the iCal UID so
// the one sanctioned write (completing a reminder) can find its way back.
export function eventKitProvenance(
  kind: Extract<SourceType, "apple_calendar" | "apple_reminders">,
  item: IncomingEKItem,
  now: () => number = Date.now,
): Source {
  return madeBy(kind, item.icalUid, now);
}

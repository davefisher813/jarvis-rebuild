// THE LOCKER (catalog Part 8). Document storage with expiry tracking. Zero
// medical judgment: this file only sorts documents and flags the ones
// lapsing soon, so a recurring task can be generated. It never reads or
// interprets what a document says.

import { LOCKER_DOC_LABEL } from "./lockerLabels";
import type { LockerDocEntry, LockerDocKind } from "./types";

export { LOCKER_DOC_LABEL };

export const LOCKER_DOC_KINDS: LockerDocKind[] = ["physical", "insurance", "baseline", "exception", "waiver"];

// A document is worth a task once it lapses inside this many days -- early
// enough that a family can act before a check-in table turns them away.
export const EXPIRY_WARN_DAYS = 30;

export interface LockerExpiring {
  doc: LockerDocEntry;
  daysUntil: number; // negative once it has already lapsed
}

/** The latest logged document per kind (a re-upload replaces the prior
 *  reading, same "latest wins" idiom as bag.ts). */
export function currentDocs(entries: LockerDocEntry[]): LockerDocEntry[] {
  const byKind = new Map<LockerDocKind, LockerDocEntry>();
  for (const e of entries) {
    const prior = byKind.get(e.data.kind);
    if (!prior || e.data.at > prior.data.at) byKind.set(e.data.kind, e);
  }
  return LOCKER_DOC_KINDS.map((k) => byKind.get(k)).filter((e): e is LockerDocEntry => !!e);
}

/** Documents that lapse within EXPIRY_WARN_DAYS, soonest first. A caller
 *  turns each into one recurring task, "Renew the [document]", never a
 *  reading of what happens if it is not renewed. */
export function expiringDocs(entries: LockerDocEntry[], today: string, withinDays = EXPIRY_WARN_DAYS): LockerExpiring[] {
  const todayMs = Date.parse(today);
  const out: LockerExpiring[] = [];
  for (const doc of currentDocs(entries)) {
    if (!doc.data.expiresAt) continue;
    const daysUntil = Math.round((Date.parse(doc.data.expiresAt) - todayMs) / 86400000);
    if (daysUntil <= withinDays) out.push({ doc, daysUntil });
  }
  return out.sort((a, b) => a.daysUntil - b.daysUntil);
}

import type { HistoryEntry } from "./types";

// EVERY MONEY WRITE SHOWS IN THE RECORD'S HISTORY (spec acceptance 9).
//
// The item table is last-write-wins and keeps no past, so the past rides in the
// record: one list, appended in the same patch as the change it describes. A
// change and its history line either both land or neither does.

export type Clock = () => string;
export const isoNow: Clock = () => new Date().toISOString();

export function entry(by: HistoryEntry["by"], action: string, changes?: HistoryEntry["changes"], now: Clock = isoNow): HistoryEntry {
  return { at: now(), by, action, ...(changes && Object.keys(changes).length ? { changes } : {}) };
}

/** The fields that actually changed between two versions of a record. */
export function diffFields<T extends object>(before: T, after: T, fields: readonly (keyof T & string)[]): Record<string, { from?: unknown; to?: unknown }> {
  const out: Record<string, { from?: unknown; to?: unknown }> = {};
  for (const f of fields) {
    const a = before[f];
    const b = after[f];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) out[f] = { from: a ?? undefined, to: b ?? undefined };
  }
  return out;
}

/** A record's history with the new line on the end. Never mutates. */
export function appended(history: HistoryEntry[] | undefined, e: HistoryEntry): HistoryEntry[] {
  return [...(history ?? []), e];
}

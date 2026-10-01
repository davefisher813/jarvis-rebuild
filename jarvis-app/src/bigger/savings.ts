import type { SavedEntry } from "../life/types";
import { formatMoney } from "../money/types";
import { lineCase } from "../shared/casing";

// Money v1 savings derivation (2026-08-03). Progress is the sum of dated
// entries the user actually logged. Nothing else may feed it: not skipped
// purchases, not account balances, not intentions.

export function savedTotal(entries: SavedEntry[] | undefined): number {
  return (entries ?? []).reduce((sum, e) => sum + (Number.isFinite(e.amount) ? e.amount : 0), 0);
}

export function savingsPct(target: number, entries: SavedEntry[] | undefined): number {
  if (!(target > 0)) return 0;
  return Math.min(100, Math.round((savedTotal(entries) / target) * 100));
}

/** The hero line: what is saved against the target, zero included. It said
 *  "Nothing saved yet · Goal $2,000", a middle dot typed into a line that is
 *  drawn as one grey (§AM F3, 2026-09-26); the same shape as every other
 *  amount says the nothing and the target at once. */
export function savingsLine(target: number, entries: SavedEntry[] | undefined): string {
  const total = Math.max(0, savedTotal(entries));
  return lineCase(`${formatMoney(total)} of ${formatMoney(target)} saved`);
}

/** A logged entry with its place in the stored list, so a tap on a row can
 *  name the exact entry (two $50s on one day are otherwise the same thing). */
export interface SavedRow { entry: SavedEntry; index: number }

/** Entries newest-first for the receipts list. Same day: the one logged last
 *  first. */
export function savedRows(entries: SavedEntry[] | undefined): SavedRow[] {
  return (entries ?? [])
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.d.localeCompare(a.entry.d) || b.index - a.index);
}

export function savedNewestFirst(entries: SavedEntry[] | undefined): SavedEntry[] {
  return savedRows(entries).map((r) => r.entry);
}

/** The list with one entry's amount changed. Its day stays: this corrects a
 *  mistyped amount, it does not move money to another day. Null when the
 *  index is not in the list or the amount is not a positive number, so a stale
 *  tap writes nothing. */
export function editSavedAt(entries: SavedEntry[] | undefined, index: number, amount: number): SavedEntry[] | null {
  const list = entries ?? [];
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return null;
  if (!Number.isFinite(amount) || !(amount > 0)) return null;
  return list.map((e, i) => (i === index ? { ...e, amount } : e));
}

/** The list without one entry. Null when the index is not in the list. */
export function removeSavedAt(entries: SavedEntry[] | undefined, index: number): SavedEntry[] | null {
  const list = entries ?? [];
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return null;
  return list.filter((_, i) => i !== index);
}

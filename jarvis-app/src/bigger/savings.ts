import type { SavedEntry } from "../life/types";
import { formatMoney } from "../money/types";
import { capAfterNumber } from "../shared/casing";

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

/** The hero line. Honest null when nothing has been logged yet. */
export function savingsLine(target: number, entries: SavedEntry[] | undefined): string {
  const total = savedTotal(entries);
  if (total <= 0) return `Nothing saved yet · Goal ${formatMoney(target)}`;
  return capAfterNumber(`${formatMoney(total)} of ${formatMoney(target)} saved`);
}

/** Entries newest-first for the receipts list. */
export function savedNewestFirst(entries: SavedEntry[] | undefined): SavedEntry[] {
  return [...(entries ?? [])].sort((a, b) => b.d.localeCompare(a.d));
}

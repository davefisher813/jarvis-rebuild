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

/** The hero line: what is saved against the target, zero included. It said
 *  "Nothing saved yet · Goal $2,000", a middle dot typed into a line that is
 *  drawn as one grey (§AM F3, 2026-09-26); the same shape as every other
 *  amount says the nothing and the target at once. */
export function savingsLine(target: number, entries: SavedEntry[] | undefined): string {
  const total = Math.max(0, savedTotal(entries));
  return capAfterNumber(`${formatMoney(total)} of ${formatMoney(target)} saved`);
}

/** Entries newest-first for the receipts list. */
export function savedNewestFirst(entries: SavedEntry[] | undefined): SavedEntry[] {
  return [...(entries ?? [])].sort((a, b) => b.d.localeCompare(a.d));
}

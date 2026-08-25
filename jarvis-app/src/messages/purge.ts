import type { ThreadRow } from "../connections/google/map";
import { displayName } from "./names";

// 11C: THE PURGE (Dave 2026-08-25: "Another thing overlooked is cleaning it
// out and mass deletion").
//
// He was right and the catalog had the hole: every other item archives, and
// nothing DELETES. A cluttered account is its own anxiety, and "clean it out"
// is a different job from "get through today":
//
//   The sweep is about the DAY. Nine cards, five minutes, one at a time.
//   The purge is about the ACCOUNT. Hundreds of threads, by sender, at once.
//
// Grouping by sender is the whole idea. Nobody wants to make four hundred
// decisions; everybody can make eight. "DoorDash, 47" is one decision that
// removes 47 things, and the count is what tells you which decision is worth
// making first.
//
// THE STANDING LAW HOLDS: delete means Gmail's trash, recoverable for thirty
// days. This app never calls the permanent-delete endpoint, and the purge is
// the single most dangerous surface in it, so that line matters most here.

export interface SenderPile {
  /** Lowercased address: the identity, and the selection key. */
  email: string;
  /** What to show a person. */
  name: string;
  ids: string[];
  count: number;
  /** Newest message in the pile, so a pile that is still live reads as live. */
  newestMs: number;
  /** Nothing here was ever classified as needing him. */
  safe: boolean;
}

/**
 * Group an inbox into per-sender piles, biggest offender first.
 *
 * `safe` is the important field. A sender is safe to bulk-delete when NOT ONE
 * of their threads was classified as needing him. One needs-you thread makes
 * the whole pile unsafe, and unsafe piles are shown but never pre-selected:
 * the count is the reason to look, and the classification is the reason to be
 * careful, and a person deserves both rather than a bulk button that quietly
 * decides for them.
 */
export function senderPiles(
  rows: readonly ThreadRow[],
  buckets: Record<string, { bucket: string }> = {},
  vips: readonly string[] = [],
): SenderPile[] {
  const vip = new Set(vips.map((v) => v.toLowerCase()));
  const by = new Map<string, SenderPile>();
  for (const r of rows) {
    const email = (r.fromEmail || r.from || "").toLowerCase().trim();
    if (!email) continue;
    // A VIP never appears in a bulk-delete list at all. Not greyed out, not
    // unselected: absent. The one rule allowed to overrule everything else
    // cannot be quietly overruled by a big red button.
    if (vip.has(email)) continue;
    let p = by.get(email);
    if (!p) {
      p = { email, name: displayName(r.from) || email, ids: [], count: 0, newestMs: 0, safe: true };
      by.set(email, p);
    }
    p.ids.push(r.id);
    p.count += 1;
    if (r.dateMs > p.newestMs) p.newestMs = r.dateMs;
    if (buckets[r.id]?.bucket === "needs_you") p.safe = false;
  }
  // Biggest first: the whole point is to show which one decision removes the
  // most. Ties break on recency so two equal piles are not shuffled at random
  // between renders.
  return [...by.values()].sort((a, b) => b.count - a.count || b.newestMs - a.newestMs);
}

/** How many threads the current selection would delete. */
export function selectedCount(piles: readonly SenderPile[], picked: ReadonlySet<string>): number {
  return piles.reduce((n, p) => n + (picked.has(p.email) ? p.count : 0), 0);
}

export function selectedIds(piles: readonly SenderPile[], picked: ReadonlySet<string>): string[] {
  return piles.flatMap((p) => (picked.has(p.email) ? p.ids : []));
}

/**
 * The button. It names the number, always, because a bulk delete whose label
 * does not say how many is a button nobody should press.
 */
export function purgeLabel(n: number): string {
  return n === 0 ? "Pick Some Senders" : "Delete " + n;
}

/**
 * The line under it. Every clause is checkable, and none of them says
 * "permanently": that word would be a lie about what this does.
 */
export function purgePromise(): string {
  return "Goes to Gmail's trash · 30 days to change your mind";
}

/** Which senders the screen pre-selects: the safe machines, nothing else. */
export function defaultPicks(piles: readonly SenderPile[]): Set<string> {
  return new Set(piles.filter((p) => p.safe && p.count > 1).map((p) => p.email));
}

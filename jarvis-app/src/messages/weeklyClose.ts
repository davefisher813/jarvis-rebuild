import type { ThreadRow } from "../connections/google/map";
import { capAfterNumber } from "../shared/casing";

// THE SUNDAY CLOSE (N14, Dave 2026-08-20).
//
// Once a week: everything nobody chased, older than a fortnight, archived in
// one tap with a receipt of exactly what went. An inbox that actually reaches
// zero, without him reading a single one of them.
//
// Laws:
//   - NEEDS-YOU IS NEVER IN THE SET. Not once, not ever, however old. The
//     entire trust of a one-tap bulk action rests on this line.
//   - Nothing from a VIP, whatever bucket it landed in.
//   - Archive, never delete. Everything in the receipt is one search away in
//     Gmail, and Undo puts it all back.
//   - The receipt names senders, not counts alone. "47 archived" is a number
//     he has to trust; "Supabase, Apple, LinkedIn and 6 others" is a fact he
//     can check.

export const CLOSE_AFTER_DAYS = 14;
export const CLOSE_MAX = 60;

export interface CloseSet {
  ids: string[];
  senders: string[];
  count: number;
}

export function closeCandidates(
  rows: ThreadRow[],
  buckets: Record<string, { bucket: string }>,
  vips: string[],
  nowMs: number,
  days = CLOSE_AFTER_DAYS,
): CloseSet {
  const vip = new Set(vips.map((v) => v.toLowerCase()));
  const picked = rows.filter((r) => {
    const b = buckets[r.id]?.bucket;
    // Unsorted mail is NOT swept. Only what was positively classified as not
    // needing him is eligible; "we never got round to reading it" is not
    // evidence of anything.
    if (b !== "noise" && b !== "worth_knowing") return false;
    if (vip.has((r.fromEmail || "").toLowerCase())) return false;
    return nowMs - r.dateMs >= days * 86400e3;
  }).slice(0, CLOSE_MAX);

  const senders: string[] = [];
  for (const r of picked) {
    const n = (r.from || r.fromEmail || "").trim();
    if (n && !senders.includes(n)) senders.push(n);
  }
  return { ids: picked.map((r) => r.id), senders, count: picked.length };
}

export function closeLine(set: CloseSet): string {
  if (set.count === 0) return "";
  const shown = set.senders.slice(0, 3).join(", ");
  const more = set.senders.length - 3;
  const who = more > 0 ? `${shown} and ${more} other${more === 1 ? "" : "s"}` : shown;
  return capAfterNumber(`${set.count} nobody chased · ${who}`);
}

export function closeReceipt(set: CloseSet): string {
  return capAfterNumber(`${set.count} archived · Still searchable in Gmail`);
}

// Sunday, or the first open of a new week. Weekly, not daily: a close offered
// every morning is the pile with a new name.
const KEY = "jarvis.mail.close.v1";

export function lastClose(storage: Pick<Storage, "getItem"> = localStorage): string {
  try { return storage.getItem(KEY) || ""; } catch { return ""; }
}

export function markClosed(todayISO: string, storage: Pick<Storage, "setItem"> = localStorage): void {
  try { storage.setItem(KEY, todayISO); } catch { /* private mode */ }
}

export function closeDue(todayISO: string, last: string): boolean {
  if (!last) return true;
  return Math.round(
    (new Date(todayISO + "T12:00:00").getTime() - new Date(last + "T12:00:00").getTime()) / 86400e3,
  ) >= 7;
}

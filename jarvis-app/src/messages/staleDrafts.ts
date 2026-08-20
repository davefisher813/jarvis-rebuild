import { capAfterNumber } from "../shared/casing";

// DRAFTS YOU NEVER SENT (N10, Dave 2026-08-20).
//
// A draft sitting for two days is not a draft. It is a decision he is
// avoiding, wearing the costume of work in progress. Gmail will hold it
// forever and never mention it again, which is exactly how it stays there.
//
// Surfaced ONCE, with both real answers on the card: finish it, or bin it.
//
// Laws:
//   - Once per draft, ever. A daily reminder about the same unsent email is
//     nagging, and nagging is what this app removes.
//   - Bin means Gmail's draft delete, which removes a draft he wrote and
//     nothing else. It never touches a sent message or a thread.
//   - Silent under the threshold. A draft from this morning is just a draft.

const KEY = "jarvis.mail.staledraft.v1";
const CAP = 200;
export const STALE_DAYS = 2;

export interface DraftRow {
  id: string;
  to: string;
  subject: string;
  snippet: string;
  dateMs: number;
}

export function loadOffered(storage: Pick<Storage, "getItem"> = localStorage): string[] {
  try {
    const raw = JSON.parse(storage.getItem(KEY) || "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function markOffered(
  id: string,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): void {
  const next = [...new Set([...loadOffered(storage), id])].slice(-CAP);
  try { storage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
}

export function staleDrafts(
  drafts: DraftRow[],
  nowMs: number,
  offered: string[],
  days = STALE_DAYS,
): DraftRow[] {
  const seen = new Set(offered);
  return drafts
    .filter((d) => !seen.has(d.id))
    .filter((d) => d.dateMs > 0 && nowMs - d.dateMs >= days * 86400e3)
    .sort((a, b) => a.dateMs - b.dateMs); // oldest first: it has waited longest
}

export function staleLine(d: DraftRow, nowMs: number): string {
  const days = Math.floor((nowMs - d.dateMs) / 86400e3);
  const who = d.to.trim() ? "to " + d.to.trim() : "with no recipient";
  return capAfterNumber(`${days} days old · Draft ${who}`);
}

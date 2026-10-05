// SMALL FORMATTING FOR THE EMAIL TAB (docs/jarvis-unified, slice 05). Days
// and times come from the Hub's formatters so the two surfaces agree; what
// is here is what only mail needs: the sender's name, the row's time, the
// day groups, a byte count, and the one freshness line under the title.

import { dayLabel, timeOf } from "../hub/format";
import { shortDate } from "../shared/dateFormat";
import { accountsWord, NOT_SYNCED } from "./copy";
import type { EmailAccount, InboxRow } from "./emailClient";

/** The sender as the row says it: the name when there is one, else the address. */
export function senderOf(r: Pick<InboxRow, "from_name" | "from_address">): string {
  return r.from_name.trim() || r.from_address || "Unknown Sender";
}

/** The right-hand time on a row: the clock today, the short date otherwise. */
export function whenShort(iso: string, now: Date = new Date()): string {
  const label = dayLabel(iso, now);
  if (label === "Today") return timeOf(iso);
  if (label === "Yesterday") return label;
  return shortDate(iso.slice(0, 10));
}

export interface DayGroup { label: string; rows: InboxRow[] }

/** Rows under their day, in the order given (the caller sorted them newest first). */
export function dayGroups(rows: readonly InboxRow[], now: Date = new Date()): DayGroup[] {
  const out: DayGroup[] = [];
  for (const r of rows) {
    const label = dayLabel(r.internal_date, now) || "Undated";
    const last = out[out.length - 1];
    if (last && last.label === label) last.rows.push(r);
    else out.push({ label, rows: [r] });
  }
  return out;
}

/** "240 KB", "1.2 MB", "0 KB" for a size Gmail did not state. */
export function sizeLine(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A FACT, AS THE CATALOG DRAWS IT (2026-10-05, Dave's visual-catalog gate).
 * Every line of grey under a title on this tab is a list of these, drawn by
 * EmailFacts as separate .fact spans; the separator is the stylesheet's, so no
 * string here ever carries a middle dot. `tone` is the Colour Key: warn (due,
 * needs you), red (late), good (done, paid), date (a neutral date or time, small
 * caps); no tone is the row's one grey. `strong` is a number with no state, white.
 * `cat` is a category slot: a dot before the words, never a colour on them.
 */
export interface EmailFact { text: string; tone?: "warn" | "red" | "good" | "date"; strong?: boolean; cat?: string }

/** A day and a time as two neutral facts: Today, 9:12 AM. Replaces hub's whenLine here, which bakes a dot into one string. */
export function whenFacts(iso: string, now: Date = new Date()): EmailFact[] {
  const day = dayLabel(iso, now);
  const time = timeOf(iso);
  return [...(day ? [{ text: day, tone: "date" as const }] : []), ...(time ? [{ text: time, tone: "date" as const }] : [])];
}

/** The same day and time as one value in a key/value table: Today 9:12 AM. */
export function whenWords(iso: string, now: Date = new Date()): string {
  return whenFacts(iso, now).map((f) => f.text).join(" ");
}

/** "Updated Today" in the row's one grey, then the time as small caps. */
export function updatedFacts(iso: string, now: Date = new Date()): EmailFact[] {
  const day = dayLabel(iso, now);
  const time = timeOf(iso);
  return [{ text: day ? `Updated ${day}` : "Updated" }, ...(time ? [{ text: time, tone: "date" as const }] : [])];
}

/**
 * Honest freshness (E21): the oldest successful sync among the accounts that
 * are still connected, because the inbox is only as fresh as its stalest
 * mailbox. Updated Today, 9:12 AM, 2 Accounts as three facts; Not Synced Yet
 * before the first good sync. Empty with no live account.
 */
export function freshnessFacts(accounts: readonly EmailAccount[], now: Date = new Date()): EmailFact[] {
  const live = accounts.filter((a) => a.state !== "disconnected");
  if (live.length === 0) return [];
  const synced = live.filter((a) => a.last_sync_at).map((a) => a.last_sync_at!).sort();
  const n: EmailFact = { text: accountsWord(live.length), strong: true };
  if (synced.length === 0) return [{ text: NOT_SYNCED }, n];
  return [...updatedFacts(synced[0]!, now), n];
}

/** A copy line written as fragments joined by a middle dot, drawn as facts instead: the first wears `tone`, the rest are the one grey. For the few copy constants that render inside a facts line. */
export function dotFacts(line: string, tone?: EmailFact["tone"]): EmailFact[] {
  return line.split(" \u00B7 ").map((t) => t.trim()).filter(Boolean).map((text, i) => (i === 0 && tone ? { text, tone } : { text }));
}

/** Whether the sender's HTML would fetch a picture from the network (13: nothing is fetched until the person asks). */
export function hasRemoteImages(html: string): boolean {
  return /<img\b[^>]*\ssrc\s*=\s*["']?\s*https?:/i.test(html) || /url\s*\(\s*["']?\s*https?:/i.test(html);
}

/** The local part of an address, for a chip: "dave" of dave@example.com. */
export function shortAccount(address: string): string {
  const at = address.indexOf("@");
  return at > 0 ? address.slice(0, at) : address;
}

/**
 * One short label per mailbox: the local part when it tells them apart, the
 * domain when two mailboxes share a local part (dave@home and dave@work),
 * the whole address when neither does.
 */
export function accountLabels(addresses: readonly string[]): Record<string, string> {
  const domainOf = (a: string): string => (a.includes("@") ? a.slice(a.indexOf("@") + 1) : a);
  const tally = (pick: (a: string) => string): Record<string, number> => {
    const n: Record<string, number> = {};
    for (const a of addresses) { const k = pick(a); n[k] = (n[k] ?? 0) + 1; }
    return n;
  };
  const locals = tally(shortAccount);
  const domains = tally(domainOf);
  const out: Record<string, string> = {};
  for (const a of addresses) {
    out[a] = (locals[shortAccount(a)] ?? 0) === 1 ? shortAccount(a) : (domains[domainOf(a)] ?? 0) === 1 ? domainOf(a) : a;
  }
  return out;
}

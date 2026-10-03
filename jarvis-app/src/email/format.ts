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
 * Honest freshness (E21): the oldest successful sync among the accounts that
 * are still connected, because the inbox is only as fresh as its stalest
 * mailbox. "Updated Today · 9:12 AM · 2 Accounts"; "Not Synced Yet" before
 * the first good sync.
 */
export function freshnessLine(accounts: readonly EmailAccount[], now: Date = new Date()): string {
  const live = accounts.filter((a) => a.state !== "disconnected");
  if (live.length === 0) return "";
  const synced = live.filter((a) => a.last_sync_at).map((a) => a.last_sync_at!).sort();
  const n = accountsWord(live.length);
  if (synced.length === 0) return `${NOT_SYNCED} · ${n}`;
  const oldest = synced[0]!;
  return `Updated ${dayLabel(oldest, now)} · ${timeOf(oldest)} · ${n}`;
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

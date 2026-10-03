// WAITING, AND WHAT TODAY MAY SAY ABOUT EMAIL (docs/jarvis-unified, slice
// 08; IMPLEMENTATION-SPEC.md 08 E12 to E15, 09 M4 and T1, 12). The tracker's
// doors (resolve, reopen, a local follow-up date) each write one record and
// one receipt on the server; the reads bring the source thread back for the
// evidence, Open in Gmail, New Reply and a follow-up's real address; the
// words here are computed from the record alone, in the person's local
// dates. The Today rows are a pure function: a generic count first, then
// committed email-origin items due today or overdue, five at most, nothing
// padded, nothing proposed, no title that is not already the person's own.

import { callCommand, newRequestId, type CommandResult, type RpcClient } from "../substrate/commands/errors";
import type { WaitingData, WaitingItem } from "../substrate/waiting/types";
import type { TaskItem } from "../tasks/TasksService";
import type { EventItem } from "../schedule/types";
import type { MailAddress } from "./emailClient";

export interface WaitingWrite {
  action_id?: string | null;
  receipt_id?: string;
  item_id: string;
  item_updated_at: string;
  data: WaitingData;
  state?: string;
  safe_message?: string;
  replay?: boolean;
}

export const resolveWaiting = (client: RpcClient, id: string, note: string | null = null, requestId: string = newRequestId(), expectedUpdatedAt: string | null = null) =>
  callCommand<WaitingWrite>(client, "waiting_resolve", { p_item: id, p_note: note, p_idempotency_key: requestId, p_expected_updated_at: expectedUpdatedAt });
export const reopenWaiting = (client: RpcClient, id: string, requestId: string = newRequestId(), expectedUpdatedAt: string | null = null) =>
  callCommand<WaitingWrite>(client, "waiting_reopen", { p_item: id, p_idempotency_key: requestId, p_expected_updated_at: expectedUpdatedAt });
export const setFollowUp = (client: RpcClient, id: string, date: string | null, requestId: string = newRequestId(), expectedUpdatedAt: string | null = null) =>
  callCommand<WaitingWrite>(client, "waiting_follow_up", { p_item: id, p_date: date, p_idempotency_key: requestId, p_expected_updated_at: expectedUpdatedAt });

export interface ThreadMessage {
  id: string;
  account_id: string;
  account: string;
  provider_id: string;
  thread_id: string;
  internal_date: string;
  from_address: string;
  from_name: string;
  to_addresses: MailAddress[];
  cc_addresses: MailAddress[];
  subject: string;
  snippet: string;
  has_body: boolean;
  deleted: boolean;
  source_hash: string;
  reply_to: string;
  /** The Message-ID header the body kept, so a follow-up threads under it. */
  message_id_header: string;
  references: string[];
}

/** Where a Today row or a card sends the Email tab: the inbox narrowed to its cards, or one waiting record. */
export type EmailFocus = { kind: "candidates" } | { kind: "waiting"; id: string };
export const threadMessages = (client: RpcClient, thread: string, accountId: string | null = null) =>
  callCommand<ThreadMessage[]>(client, "thread_messages", { p_thread: thread, p_account: accountId });

export interface LatestInThread { message_id: string; internal_date: string; from_address: string; from_name: string; subject: string; account_id: string }
export const threadsLatest = (client: RpcClient, threads: string[]) =>
  callCommand<Record<string, LatestInThread>>(client, "threads_latest", { p_threads: threads });

export interface Evidence {
  id: string;
  type: "email" | "manual" | "import";
  account_id: string | null;
  message_id: string | null;
  provider_message_id: string | null;
  thread_id: string | null;
  excerpt: string;
  captured_at: string;
  source_timezone: string | null;
  availability: "available" | "deleted" | "disconnected";
}
export const readEvidence = (client: RpcClient, id: string) => callCommand<Evidence>(client, "evidence_read", { p_evidence: id });

export const reviewCount = (client: RpcClient): Promise<CommandResult<{ count: number; messages: number }>> => callCommand(client, "candidate_review_count", {});

// ---- the words, from the record and the local date ---------------------------

/** The local calendar date of an instant, in the zone given or the device's. */
export function localDate(iso: string, zone?: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso.slice(0, 10);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { ...(zone ? { timeZone: zone } : {}), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch { return d.toISOString().slice(0, 10); }
}

const DAY_MS = 86_400_000;
/** Whole days between two local dates (YYYY-MM-DD), b minus a. */
export const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY_MS);

/** How long the person has waited, in their own dates: Today, Yesterday, 3 Days, 2 Weeks, 3 Months. No urgency in it. */
export function ageWord(startedAt: string, today: string, zone?: string): string {
  const n = daysBetween(localDate(startedAt, zone), today);
  if (n <= 0) return "Today";
  if (n === 1) return "Yesterday";
  if (n < 14) return `${n} Days`;
  if (n < 60) return `${Math.floor(n / 7)} Weeks`;
  if (n < 365) return `${Math.floor(n / 30)} Months`;
  return `${Math.floor(n / 365)} ${Math.floor(n / 365) === 1 ? "Year" : "Years"}`;
}

export type FollowUpState = "none" | "overdue" | "today" | "upcoming";
export function followUpState(followUpOn: string | undefined, today: string): FollowUpState {
  if (!followUpOn) return "none";
  const n = daysBetween(today, followUpOn);
  return n < 0 ? "overdue" : n === 0 ? "today" : "upcoming";
}

/** A reply is a newer cached message in the thread from someone other than the person. It is shown, never acted on. */
export function newReply(item: Pick<WaitingData, "startedAt" | "threadId" | "status">, latest: LatestInThread | undefined, own: readonly string[]): LatestInThread | null {
  if (!latest || !item.threadId || item.status !== "open") return null;
  if (Date.parse(latest.internal_date) <= Date.parse(item.startedAt)) return null;
  const mine = new Set(own.map((a) => a.toLowerCase()));
  if (mine.has(latest.from_address.toLowerCase())) return null;
  return latest;
}

/** The real addresses a follow-up could go to, from the thread's own messages: each sender (its Reply-To first) that is not the person, newest first, each once. Never a guess from a name. */
export function followUpRecipients(msgs: readonly ThreadMessage[], own: readonly string[]): string[] {
  const mine = new Set(own.map((a) => a.toLowerCase()));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of msgs) {
    for (const a of [m.reply_to, m.from_address]) {
      const t = (a || "").trim();
      const low = t.toLowerCase();
      if (!t || !t.includes("@") || mine.has(low) || seen.has(low)) continue;
      seen.add(low);
      out.push(t);
    }
  }
  return out;
}

/** Open first: the overdue and today's follow-ups lead, then the rest newest first; resolved newest first. */
export function orderWaiting(items: readonly WaitingItem[], today: string): { open: WaitingItem[]; resolved: WaitingItem[] } {
  const rank = (d: WaitingData) => { const s = followUpState(d.followUpOn, today); return s === "overdue" ? 0 : s === "today" ? 1 : 2; };
  const open = items.filter((i) => i.data.status === "open").sort((a, b) => rank(a.data) - rank(b.data) || (a.data.followUpOn ?? "").localeCompare(b.data.followUpOn ?? "") || b.data.startedAt.localeCompare(a.data.startedAt) || a.id.localeCompare(b.id));
  const resolved = items.filter((i) => i.data.status === "resolved").sort((a, b) => (b.data.resolvedAt ?? "").localeCompare(a.data.resolvedAt ?? "") || a.id.localeCompare(b.id));
  return { open, resolved };
}

// ---- Today (12, T1): the one number and the committed items ------------------

export const TODAY_EMAIL_CAP = 5;

export interface TodayEmailRow {
  kind: "review" | "task" | "event" | "waiting";
  /** The destination item id, or "review" for the count. */
  id: string;
  title: string;
  line: string;
  /** Overdue items first (0), then today's (1); then the date, then the id. */
  sort: [number, string, string];
}

export const emailOriginTask = (t: TaskItem): boolean => !!t.data.fromThread || t.data.source?.type === "email";
export const emailOriginEvent = (e: EventItem): boolean => e.data.source?.type === "email" || (e.data.emailIds?.length ?? 0) > 0;

export function reviewLine(n: number): string {
  return `${n} Email ${n === 1 ? "Item" : "Items"} to Review`;
}

/** Oct 15 from 2026-10-15, without a zone shift. */
function monthDayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, d ?? 1)).toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" });
}

/** The rows Today may show for Email: the review count, then committed email-origin tasks due today or overdue, events today, and open waiting items whose follow-up is today or overdue. Five at most, each destination once, nothing padded, and never anything for tomorrow. */
export function emailTodayRows(input: { count: number; tasks: readonly TaskItem[]; events: readonly EventItem[]; waiting: readonly WaitingItem[]; today: string; excludeIds?: ReadonlySet<string>; cap?: number }): TodayEmailRow[] {
  const cap = input.cap ?? TODAY_EMAIL_CAP;
  const rows: TodayEmailRow[] = [];
  const seen = new Set<string>(input.excludeIds ?? []);
  const take = (r: TodayEmailRow) => { if (seen.has(r.id)) return; seen.add(r.id); rows.push(r); };
  for (const t of input.tasks) {
    if (t.data.done || !t.data.due || t.data.due > input.today || !emailOriginTask(t)) continue;
    const overdue = t.data.due < input.today;
    take({ kind: "task", id: t.id, title: t.data.text, line: overdue ? `Task · Was Due ${monthDayOf(t.data.due)}` : "Task · Due Today", sort: [overdue ? 0 : 1, t.data.due, t.id] });
  }
  for (const e of input.events) {
    if (e.data.date !== input.today || !emailOriginEvent(e)) continue;
    take({ kind: "event", id: e.id, title: e.data.title, line: `Schedule · ${e.data.start}${e.data.end ? " to " + e.data.end : ""}`, sort: [1, input.today + "T" + e.data.start, e.id] });
  }
  for (const w of input.waiting) {
    const d = w.data;
    if (d.status !== "open" || !d.followUpOn || d.followUpOn > input.today) continue;
    const overdue = d.followUpOn < input.today;
    take({ kind: "waiting", id: w.id, title: d.title, line: `Waiting On ${d.counterpartyDisplay || "Someone"} · ${overdue ? "Follow Up Was " + monthDayOf(d.followUpOn) : "Follow Up Today"}`, sort: [overdue ? 0 : 1, d.followUpOn, w.id] });
  }
  rows.sort((a, b) => a.sort[0] - b.sort[0] || a.sort[1].localeCompare(b.sort[1]) || a.sort[2].localeCompare(b.sort[2]));
  const head: TodayEmailRow[] = input.count > 0 ? [{ kind: "review", id: "review", title: reviewLine(input.count), line: "Open Email to Review", sort: [-1, "", ""] }] : [];
  return [...head, ...rows].slice(0, cap);
}

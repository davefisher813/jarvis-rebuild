// CARDS, FROM THE CLIENT'S SIDE (docs/jarvis-unified, slice 06;
// IMPLEMENTATION-SPEC.md 08 E07 to E11, 10, 13). A card is an email_candidate
// row the person can see: read for a page of messages (candidates_for),
// proposed by the deterministic rules or by a manual capture
// (candidate_propose), saved through slice 03's atomic door
// (capture_approve, in substrate/commands/captures.ts). What this file adds
// is the glue: the row's shape, the lines a card draws from its payload with
// no adapter and no network, the one reading per message per version, and
// the words for each kind. Nothing here decides anything a rule or the
// person did not.

import { callCommand, type CommandResult, type RpcClient } from "../substrate/commands/errors";
import type { CandidateCard } from "../substrate/commands/captures";
import type { PrepareContext } from "../substrate/destinations/types";
import { MODULE_OF } from "../substrate/destinations/types";
import type { CandidateOrigin, CandidateStatus, CaptureKind, CapturePayload } from "../substrate/contracts";
import { extractCandidates, readingKey, type ExtractInput, type Proposal, type Provenance } from "../substrate/extract";
import { moneyWords } from "../money/ledger/emailBill";
import { monthDay } from "../money/bills";
import { ACCOUNT_PREFIX } from "../messages/mailCache";
import { mailAccountKey } from "../messages/mailIdentity";
import { dayLabel, timeOf } from "../hub/format";
import type { InboxRow, MessageDetail } from "./emailClient";

export interface Candidate {
  id: string;
  message_id: string;
  account_id: string;
  kind: CaptureKind;
  origin: CandidateOrigin;
  agent_name: string | null;
  status: CandidateStatus;
  revision: number;
  payload: CapturePayload;
  payload_hash: string;
  provenance_by_field: Record<string, Provenance & { entered_by_user?: boolean }>;
  missing_fields: string[];
  fingerprint: string;
  source_hash: string;
  /** The message's hash now; a card read from another copy is stale (E25). */
  message_source_hash: string;
  destination_id: string | null;
  action_id: string | null;
  proposal_id: string | null;
  extractor_version: string;
  created_at: string;
  updated_at: string;
  /** The saved card of the same kind on this message, when there is one: an update to review, never a write. */
  saved_sibling: { id: string; payload: CapturePayload; destination_id: string | null; action_id: string | null } | null;
}

export function candidatesFor(client: RpcClient, messageIds: string[], includeDismissed = false): Promise<CommandResult<Candidate[]>> {
  return callCommand<Candidate[]>(client, "candidates_for", { p_messages: messageIds, p_include_dismissed: includeDismissed });
}

export interface Proposed { candidate_id: string; revision: number; status: CandidateStatus; payload_hash: string; replay: boolean; refreshed?: boolean; stale_marked: number }

export interface ProposeArgs {
  message_id: string;
  kind: CaptureKind;
  payload: CapturePayload | Record<string, unknown>;
  provenance: Record<string, Provenance>;
  missing: string[];
  fingerprint: string;
  extractor_version: string;
  source_hash: string;
  origin?: "rule" | "manual";
}

export function proposeCandidate(client: RpcClient, a: ProposeArgs): Promise<CommandResult<Proposed>> {
  return callCommand<Proposed>(client, "candidate_propose", {
    p_message: a.message_id, p_kind: a.kind, p_payload: a.payload, p_provenance: a.provenance, p_missing: a.missing,
    p_fingerprint: a.fingerprint, p_extractor_version: a.extractor_version, p_source_hash: a.source_hash, p_origin: a.origin ?? "rule",
  });
}

/** Every reading the rules made of a message, proposed; the count of cards that are new or refreshed. */
export async function proposeExtracted(client: RpcClient, proposals: Proposal[], message: { id: string; source_hash: string }): Promise<{ proposed: number; failed: number }> {
  let proposed = 0;
  let failed = 0;
  for (const p of proposals) {
    const r = await proposeCandidate(client, { message_id: message.id, kind: p.kind, payload: p.payload, provenance: p.provenance, missing: p.missing, fingerprint: p.fingerprint, extractor_version: p.extractor_version, source_hash: message.source_hash });
    if (!r.ok) failed++;
    else if (!r.value.replay || r.value.refreshed) proposed++;
  }
  return { proposed, failed };
}

/** The rules' input for a list row (subject and snippet) or an opened message (the body as text). */
export function extractInput(row: Pick<InboxRow, "account_id" | "id" | "account" | "from_address" | "from_name" | "subject" | "snippet" | "internal_date">, zone: string, body?: string | null): ExtractInput {
  return { account_id: row.account_id, message_id: row.id, account: row.account, from_address: row.from_address, from_name: row.from_name, subject: row.subject, body: body ?? row.snippet, internal_date: row.internal_date, zone };
}

/** Read a message with the rules; the proposals, in the catalog's order. */
export function readWithRules(row: Pick<InboxRow, "account_id" | "id" | "account" | "from_address" | "from_name" | "subject" | "snippet" | "internal_date">, zone: string, body?: string | null): Proposal[] {
  return extractCandidates(extractInput(row, zone, body));
}

/** The text of an opened message, as the rules should read it: plain text first, the snippet when there is none. */
export function textOf(m: Pick<MessageDetail, "text" | "snippet" | "html">): string {
  if (m.text && m.text.trim()) return m.text;
  if (m.html) return m.html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>|<\/li>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").trim();
  return m.snippet;
}

// ---- one reading per message per version, on this phone ------------------

type Store = Pick<Storage, "getItem" | "setItem">;
const readKey = (userId: string): string => ACCOUNT_PREFIX + mailAccountKey({ userId, account: "unified" }) + ":readings.v1";
const READINGS_MAX = 1500;

export function readingsOf(userId: string, storage: Store = localStorage): Set<string> {
  try {
    const raw = JSON.parse(storage.getItem(readKey(userId)) || "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string") : []);
  } catch { return new Set(); }
}

export function rememberReading(userId: string, key: string, storage: Store = localStorage): void {
  const set = readingsOf(userId, storage);
  set.add(key);
  const list = [...set];
  try { storage.setItem(readKey(userId), JSON.stringify(list.slice(Math.max(0, list.length - READINGS_MAX)))); } catch { /* private mode */ }
}

export { readingKey };

// ---- what a card says, from its payload alone ------------------------------

export const PROVISIONAL: readonly CandidateStatus[] = ["proposed", "needs_details", "conflict", "stale"];
export const isProvisional = (c: Pick<Candidate, "status">): boolean => PROVISIONAL.includes(c.status);
/** What "to review" means, on Today and in the review focus alike: the server's `candidate_review_count` counts exactly this set (0051), so the number on Today and the number in Email are one number. */
export const isToReview = (c: Pick<Candidate, "status">): boolean => c.status === "proposed" || c.status === "needs_details";
/** E25: the card was read from a copy of the message that is no longer the message. */
export const isStale = (c: Pick<Candidate, "status" | "source_hash" | "message_source_hash">): boolean => c.status === "stale" || (isProvisional(c) && c.source_hash !== c.message_source_hash);

export const PRIMARY: Record<CaptureKind, string> = { bill: "Save Bill", receipt: "Save Receipt", task: "Add Task", event: "Add to Schedule", waiting: "Track This" };
export const BADGE: Record<CaptureKind, string> = { bill: "Money", receipt: "Money", task: "Tasks", event: "Schedule", waiting: "Waiting On" };
export const CARD_TITLE: Record<CaptureKind, string> = { bill: "Save Bill to Money", receipt: "Save Receipt to Money", task: "Add to Tasks", event: "Add to Schedule", waiting: "Track What You're Waiting For" };
export const KIND_WORD: Record<CaptureKind, string> = { bill: "Bill", receipt: "Receipt", task: "Task", event: "Event", waiting: "Waiting" };

const money = (a: { minor_units: number; currency: string }): string => (a.minor_units > 0 && /^[A-Z]{3}$/.test(a.currency) ? moneyWords(a.minor_units, a.currency) : a.minor_units > 0 ? `${(a.minor_units / 100).toFixed(2)} · Currency Needed` : "Amount Needed");

/** The two lines under the badge: the value the card is about, and the facts around it. */
export function cardLines(c: Pick<Candidate, "payload">, now: Date = new Date()): { value: string; detail: string } {
  const p = c.payload;
  switch (p.kind) {
    case "bill": return { value: money(p.amount), detail: `${p.due_date ? "Due " + monthDay(p.due_date) : p.no_due_date_confirmed ? "No Due Date" : "Due Date Needed"} · ${p.issuer || "Issuer Needed"}` };
    case "receipt": return { value: money(p.amount), detail: `${p.merchant || "Merchant Needed"} · ${p.transaction_type === "refund" ? "Refunded" : "Paid"} ${monthDay(p.purchase_date)}` };
    case "task": return { value: p.title || "Title Needed", detail: p.due_date ? `Due ${monthDay(p.due_date)}` : "No Deadline" };
    case "event": {
      const t = p.time;
      if (t.all_day) return { value: p.title || "Title Needed", detail: `${monthDay(t.start_date)} · All Day` };
      const zone = t.timezone || undefined;
      let when = "";
      try {
        const d = new Date(t.start_at);
        const e = new Date(t.end_at);
        const day = dayLabel(t.start_at, now);
        const fmt = (x: Date) => x.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", ...(zone ? { timeZone: zone } : {}) });
        when = `${day} · ${fmt(d)} to ${fmt(e)}${zone ? " " + shortZone(zone) : " · Zone Needed"}`;
      } catch { when = `${dayLabel(t.start_at, now)} · ${timeOf(t.start_at)}`; }
      return { value: p.title || "Title Needed", detail: when };
    }
    case "waiting": return { value: p.title || "Title Needed", detail: `From ${p.counterparty_display || "Someone"}${p.follow_up_on ? " · Follow Up " + monthDay(p.follow_up_on) : ""}` };
  }
}

const ZONE_SHORT: Record<string, string> = { "America/New_York": "Eastern", "America/Chicago": "Central", "America/Denver": "Mountain", "America/Phoenix": "Arizona", "America/Los_Angeles": "Pacific", "America/Anchorage": "Alaska", "Pacific/Honolulu": "Hawaii", UTC: "UTC", "Europe/London": "London", "Europe/Berlin": "Central European" };
export function shortZone(zone: string): string {
  return ZONE_SHORT[zone] ?? zone.split("/").pop()?.replace(/_/g, " ") ?? zone;
}

/** The card as the approval needs it. */
export function toCard(c: Candidate, evidenceExcerpt?: string): CandidateCard {
  return { id: c.id, kind: c.kind, revision: c.revision, payloadHash: c.payload_hash, payload: c.payload, evidence: [], ...(evidenceExcerpt ? { evidenceExcerpt } : {}) };
}

/** The adapters' context for a card on this row. */
export function contextFor(row: Pick<InboxRow, "thread_id" | "account">, zone: string, now: () => Date = () => new Date()): PrepareContext {
  return { now: () => now().toISOString(), today: dateOnly(now(), zone), zone, threadId: row.thread_id, account: row.account };
}

function dateOnly(d: Date, zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch { return d.toISOString().slice(0, 10); }
}

/** The module a kind lands in, for a door's words. */
export const moduleOf = (kind: CaptureKind): string => MODULE_OF[kind];

/** The reader's zone. */
export function readerZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

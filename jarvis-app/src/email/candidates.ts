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
import type { EmailFact } from "./format";
import { localDate, windowTone } from "./waiting";

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
// 2026-10-05: CARD_TITLE ("Save Bill to Money") is gone. Under the card's badge ("Money") and over its button
// ("Save Bill") it was a third thin grey line saying what the card already says twice, stacked on the facts line:
// the exact pair Dave photographed on the Email card. The badge names where it lands, the button names the effect.
export const KIND_WORD: Record<CaptureKind, string> = { bill: "Bill", receipt: "Receipt", task: "Task", event: "Event", waiting: "Waiting" };

/** The headline amount, and what it still needs: a number with no currency reads as the number and asks for the currency as a need, never as a dotted string in the headline. */
const money = (a: { minor_units: number; currency: string }): { text: string; needs: string[] } =>
  a.minor_units > 0 && /^[A-Z]{3}$/.test(a.currency) ? { text: moneyWords(a.minor_units, a.currency), needs: [] }
    : a.minor_units > 0 ? { text: (a.minor_units / 100).toFixed(2), needs: ["Currency"] }
      : { text: "Amount Needed", needs: [] };

/**
 * The facts line of a card, in the catalog's order (2026-10-05): the one amber fact leads when something is
 * still needed, then the short dated facts, then the long free text last (a facts line ellipsizes only its last
 * fact). At most one coloured fact on the line: when a Needs fact is present, a window colour steps down to a
 * neutral date. Nothing missing means no Needs fact; nothing to say means no fact at all.
 */
function line(needs: readonly string[], lead: readonly EmailFact[], tail: readonly EmailFact[]): EmailFact[] {
  const need: EmailFact[] = needs.length ? [{ text: `Needs ${needs.join(", ")}`, tone: "warn" }] : [];
  const calm = need.length ? lead.map((f): EmailFact => (f.tone ? { ...f, tone: "date" } : f)) : lead;
  return [...need, ...calm, ...tail];
}

/** The headline under the badge, and the facts around it. The facts are separate spans (the catalog), never one string joined by a middle dot. */
export function cardLines(c: Pick<Candidate, "payload">, now: Date = new Date()): { value: string; facts: EmailFact[] } {
  const p = c.payload;
  const today = localDate(now.toISOString());
  const dueFact = (d: string | null | undefined): EmailFact[] => (d ? [{ text: `Due ${monthDay(d)}`, tone: windowTone(d, today) }] : []);
  switch (p.kind) {
    case "bill": {
      const m = money(p.amount);
      return { value: m.text, facts: line([...m.needs, ...(!p.due_date && !p.no_due_date_confirmed ? ["Due Date"] : []), ...(!p.issuer ? ["Issuer"] : [])], dueFact(p.due_date), p.issuer ? [{ text: p.issuer }] : []) };
    }
    case "receipt": {
      const m = money(p.amount);
      const refund = p.transaction_type === "refund";
      return { value: m.text, facts: line([...m.needs, ...(!p.purchase_date ? ["Purchase Date"] : []), ...(!p.merchant ? ["Merchant"] : [])], p.purchase_date ? [{ text: `${refund ? "Refunded" : "Paid"} ${monthDay(p.purchase_date)}`, tone: refund ? "date" : "good" }] : [], p.merchant ? [{ text: p.merchant }] : []) };
    }
    case "task": return { value: p.title || "Title Needed", facts: line([], dueFact(p.due_date), []) };
    case "event": {
      const t = p.time;
      const value = p.title || "Title Needed";
      if (t.all_day) return { value, facts: line([], [{ text: monthDay(t.start_date), tone: "date" }], [{ text: "All Day" }]) };
      const zone = t.timezone || undefined;
      try {
        const d = new Date(t.start_at);
        const e = new Date(t.end_at);
        const fmt = (x: Date) => x.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", ...(zone ? { timeZone: zone } : {}) });
        return { value, facts: line(zone ? [] : ["Zone"], [{ text: dayLabel(t.start_at, now), tone: "date" }, { text: `${fmt(d)} to ${fmt(e)}`, tone: "date" }], zone ? [{ text: shortZone(zone) }] : []) };
      } catch {
        return { value, facts: line([], [{ text: dayLabel(t.start_at, now), tone: "date" }, { text: timeOf(t.start_at), tone: "date" }], []) };
      }
    }
    case "waiting": return { value: p.title || "Title Needed", facts: line(p.counterparty_display ? [] : ["From"], p.follow_up_on ? [{ text: `Follow Up ${monthDay(p.follow_up_on)}`, tone: windowTone(p.follow_up_on, today) }] : [], p.counterparty_display ? [{ text: `From ${p.counterparty_display}` }] : []) };
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

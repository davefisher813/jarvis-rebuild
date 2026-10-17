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
import { centsWords, moneyWords } from "../money/ledger/emailBill";
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

/** Whether a card lives on this phone only (a manual capture not yet saved): nothing on the server knows it. */
export const LOCAL_PREFIX = "local:";
export const isLocalCandidate = (c: Pick<Candidate, "id">): boolean => c.id.startsWith(LOCAL_PREFIX);

/**
 * A MANUAL CAPTURE BEFORE IT IS SAVED (2026-10-17). Add to JARVIS and Track This used to write a needs_details card to the
 * server as the sheet opened, so a cancelled sheet left a card, a review count and a Today line behind. The sheet now opens
 * on this card, which exists only here; CaptureSheet proposes and approves it in one turn when the person saves.
 */
export function localCandidate(kind: CaptureKind, row: Pick<InboxRow, "id" | "account_id" | "source_hash">, payload: CapturePayload, missing: string[], now: Date): Candidate {
  const at = now.toISOString();
  return {
    id: LOCAL_PREFIX + kind + ":" + now.getTime().toString(36), message_id: row.id, account_id: row.account_id, kind, origin: "manual", agent_name: null,
    status: "needs_details", revision: 0, payload, payload_hash: "", provenance_by_field: {}, missing_fields: missing,
    fingerprint: `manual:${kind}:${now.getTime().toString(36)}`, source_hash: row.source_hash, message_source_hash: row.source_hash,
    destination_id: null, action_id: null, proposal_id: null, extractor_version: "manual", created_at: at, updated_at: at, saved_sibling: null,
  };
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

/**
 * WHAT THE RULES MAY PROPOSE FROM A LIST ROW (Dave 2026-10-13, task 42: hide the old rule candidates; Email v1 spec 5.2
 * and AC11; the Trim Decisions of 2026-10-08). A row in the list is only a subject and a snippet. Reading those for a
 * bill, a receipt, a task or a waiting card is the automatic pass the spec bans: no email-to-task or Waiting detection,
 * and no financial auto-parsing in v1 (manual entry only). So the list reads a row for the one kind the spec keeps, a
 * calendar event, and for nothing else. What the person asks for is not a list reading and is not narrowed here: Find
 * Useful Details, Add to JARVIS and Track This, an opened message's text and an opened calendar file read every kind
 * as before.
 *
 * Hidden, not deleted: the templates, the readings and every card already on the server are untouched. Put a kind
 * back in this list and the list proposes it again (the reading key below carries the list, so rows read before are
 * read again).
 */
export const LIST_ROW_KINDS: readonly CaptureKind[] = ["event"];

/**
 * A PAST EVENT IS NOT A PROPOSAL (2026-10-17, Alfred's sweep: a June 10, 2025 invitation proposed again). Nothing read
 * from mail is put on the Schedule behind the person's own clock: a timed event whose end has passed, or an all-day
 * event whose last day is over, is history, however it reached the reader (an old invite in a forwarded thread, a date
 * the rules misread as last year). Pure, so the list, the opened message, the calendar file and the cards already on
 * the server all answer the same.
 */
export function isPastEvent(p: CapturePayload, now: Date): boolean {
  if (p.kind !== "event") return false;
  const t = p.time;
  if (t.all_day) return t.end_date_exclusive <= localDate(now.toISOString());
  const end = Date.parse(t.end_at);
  return Number.isFinite(end) && end < now.getTime();
}

/** The proposals a list row may make: the rules' reading of it, cut to the kinds the list reads. */
export function listRowProposals(proposals: readonly Proposal[], now: Date = new Date()): Proposal[] {
  return proposals.filter((p) => LIST_ROW_KINDS.includes(p.kind) && !isPastEvent(p.payload, now));
}

/** The key a list row is read under: the version and the kinds the list reads, so a kind turned back on reads the rows again. */
export function listReadingKey(accountId: string, messageId: string, sourceHash: string): string {
  return `${readingKey(accountId, messageId, sourceHash)}:list:${LIST_ROW_KINDS.join(",")}`;
}

/**
 * WHAT THE WORDS OF AN OPENED MESSAGE MAY PROPOSE (Email v1 spec AC11: "Open mail / Find useful details: no automatic
 * task/Waiting candidates; supported financial/event templates only"). Opening a message, and Find Useful Details, read
 * its text for a bill, a receipt or an event. A task or a Waiting is never proposed from someone's words: those come from
 * the person's own Add to JARVIS and Track This, with their own fields. Hidden, not deleted: put a kind back in this list
 * and it is proposed again (the body reading key carries the list, so messages read before are read again).
 */
export const BODY_READ_KINDS: readonly CaptureKind[] = ["bill", "receipt", "event"];

/** The proposals an opened message's text may make: the rules' reading of it, cut to the kinds the spec keeps. */
export function bodyProposals(proposals: readonly Proposal[], now: Date = new Date()): Proposal[] {
  return proposals.filter((p) => BODY_READ_KINDS.includes(p.kind) && !isPastEvent(p.payload, now));
}

/** The key an opened message's text is read under: the version and the kinds read, so a kind turned back on reads the message again. */
export function bodyReadingKey(accountId: string, messageId: string, sourceHash: string): string {
  return `${readingKey(accountId, messageId, sourceHash)}:body:${BODY_READ_KINDS.join(",")}`;
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
/** What "to review" means in Email's review count and review list alike: the server's `candidate_review_count` (0051) and `candidates_to_review` (0068) read exactly this set, so the number and the list are one set. */
export const isToReview = (c: Pick<Candidate, "status">): boolean => c.status === "proposed" || c.status === "needs_details";
/** E25: the card was read from a copy of the message that is no longer the message. */
export const isStale = (c: Pick<Candidate, "status" | "source_hash" | "message_source_hash">): boolean => c.status === "stale" || (isProvisional(c) && c.source_hash !== c.message_source_hash);

export const PRIMARY: Record<CaptureKind, string> = { bill: "Save Bill", receipt: "Save Receipt", task: "Add Task", event: "Add to Schedule", waiting: "Track This" };
export const BADGE: Record<CaptureKind, string> = { bill: "Money", receipt: "Money", task: "Tasks", event: "Schedule", waiting: "Waiting On" };
// 2026-10-05: CARD_TITLE ("Save Bill to Money") is gone. Under the card's badge ("Money") and over its button
// ("Save Bill") it was a third thin grey line saying what the card already says twice, stacked on the facts line:
// the exact pair Dave photographed on the Email card. The badge names where it lands, the button names the effect.
export const KIND_WORD: Record<CaptureKind, string> = { bill: "Bill", receipt: "Receipt", task: "Task", event: "Event", waiting: "Waiting" };

/**
 * The headline amount, and what it still needs: a number with no currency reads as the number (thousands grouped, as
 * every amount is) and asks for the currency as a need, never as a dotted string in the headline. An amount that is
 * zero or below (a blank manual card, a credit or a refund proposed as a bill: a bill is never negative, and a
 * negative is not an amount to save) reads "Amount Needed" and names the Amount among the needs, like every other
 * field the card is still waiting for (issue 112, populated Money).
 */
const money = (a: { minor_units: number; currency: string }): { text: string; needs: string[] } =>
  a.minor_units > 0 && /^[A-Z]{3}$/.test(a.currency) ? { text: moneyWords(a.minor_units, a.currency), needs: [] }
    : a.minor_units > 0 ? { text: centsWords(a.minor_units), needs: ["Currency"] }
      : { text: "Amount Needed", needs: ["Amount"] };

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
        // 12-hour with AM or PM whatever the phone's own locale says (the clock law), in the zone the event is in.
        const fmt = (x: Date) => x.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, ...(zone ? { timeZone: zone } : {}) });
        // The span is built before the day, so a zone this runtime does not know throws here and falls to the catch below.
        const span = `${fmt(d)} to ${fmt(e)}`;
        return { value, facts: line(zone ? [] : ["Zone"], [{ text: zone ? dayIn(t.start_at, zone, now) : dayLabel(t.start_at, now), tone: "date" }, { text: span, tone: "date" }], zone ? [{ text: shortZone(zone) }] : []) };
      } catch {
        return { value, facts: line([], [{ text: dayLabel(t.start_at, now), tone: "date" }, { text: timeOf(t.start_at), tone: "date" }], []) };
      }
    }
    case "waiting": return { value: p.title || "Title Needed", facts: line(p.counterparty_display ? [] : ["From"], p.follow_up_on ? [{ text: `Follow Up ${monthDay(p.follow_up_on)}`, tone: windowTone(p.follow_up_on, today) }] : [], p.counterparty_display ? [{ text: `From ${p.counterparty_display}` }] : []) };
  }
}

/**
 * The day an event falls on in the zone its clock is printed in: Today, Yesterday, else the short date. The day used to
 * come from hub/format's dayLabel, which reads the date off the front of the ISO instant (the UTC date) while the times
 * beside it were printed in the event's zone, so an evening event was labelled a day late (10:00 PM Eastern on Oct 6 is
 * 02:00 Oct 7 UTC and read "Oct 7"). The event and "now" are both read in that one zone, so the three facts agree.
 */
function dayIn(iso: string, zone: string, now: Date): string {
  if (Number.isNaN(new Date(iso).getTime())) return "";
  const day = localDate(iso, zone);
  const today = localDate(now.toISOString(), zone);
  if (day === today) return "Today";
  const before = new Date(`${today}T12:00:00Z`);
  before.setUTCDate(before.getUTCDate() - 1);
  return day === before.toISOString().slice(0, 10) ? "Yesterday" : monthDay(day);
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

// DETERMINISTIC EXTRACTION, THE ONE DOOR (IMPLEMENTATION-SPEC.md 10, 10.1;
// prompt 06). Rules only, no model, no network: the same message text reads
// to the same cards on every device and every reopen, each with the fields it
// could read, the fields it could not (named, so the card asks), where every
// value came from, and a fingerprint from the semantic fields so the same card
// is one card. It runs over a message the person loaded or opened, or when
// they tap Find Useful Details; it never scans a mailbox.
//
// What it refuses, by shape: a bill's date never becomes a task or an event;
// a receipt is never a bill; a flight's receipt and its itinerary are two
// cards or none; a promise in the person's own words is not something they
// wait on; branding alone makes no card.

import type { CaptureKind } from "../contracts";
import { cyrb53 } from "../../messages/briefSource";
import { billTemplate, eventTemplate, receiptTemplate, taskTemplate, waitingTemplate, type Extracted, type Provenance, type TemplateInput } from "./templates";
import { excerptOf, sourceText } from "./text";

export type { Extracted, Provenance, TemplateInput };

/** Moves when a rule changes what it reads; a message is read once per version (10.1 step 1). */
export const EXTRACTOR_VERSION = "rules-2026-10-03";

export interface ExtractInput {
  account_id: string;
  message_id: string;
  account: string;
  from_address: string;
  from_name: string;
  subject: string;
  /** The body as text, or the snippet when only the list row is known. */
  body: string;
  internal_date: string;
  zone: string;
}

export interface Proposal extends Extracted {
  fingerprint: string;
  evidence_excerpt: string;
  extractor_version: string;
}

/** The semantic fingerprint (10.1 step 7): account, message, kind and the fields that make the card what it is. */
export function fingerprintOf(accountId: string, messageId: string, kind: CaptureKind, identity: Record<string, string | number | null>): string {
  const key = JSON.stringify([accountId, messageId, kind, Object.keys(identity).sort().map((k) => [k, identity[k]])]);
  return `fp1:${cyrb53(key).toString(36)}${cyrb53(key, 29).toString(36)}`;
}

/** Every card the rules can read from one message, at most one per kind, in the catalog's order. */
export function extractCandidates(input: ExtractInput): Proposal[] {
  const text = sourceText(input.subject, input.body);
  const t: TemplateInput = { text, from_address: input.from_address, from_name: input.from_name, account: input.account, internal_date: input.internal_date, zone: input.zone };
  const out: Extracted[] = [];
  const bill = billTemplate(t);
  const receipt = bill ? null : receiptTemplate(t);
  const financialDates = new Set<string>();
  if (bill) { out.push(bill); if (bill.payload.kind === "bill" && bill.payload.due_date) financialDates.add(bill.payload.due_date); }
  if (receipt) { out.push(receipt); if (receipt.payload.kind === "receipt") financialDates.add(receipt.payload.purchase_date); }
  const task = taskTemplate(t, financialDates);
  if (task) out.push(task);
  const event = eventTemplate(t, financialDates);
  if (event) out.push(event);
  const waiting = waitingTemplate(t);
  if (waiting) out.push(waiting);
  const excerpt = excerptOf(text);
  return out.map((e) => ({
    ...e,
    // Offsets past the excerpt are not offsets into anything a receipt keeps; the source stays, the span goes.
    provenance: Object.fromEntries(Object.entries(e.provenance).map(([k, p]) => [k, p.text_end !== undefined && p.text_end > excerpt.length ? { source: p.source, ...(p.note ? { note: p.note } : {}) } : p])),
    fingerprint: fingerprintOf(input.account_id, input.message_id, e.kind, e.identity),
    evidence_excerpt: excerpt,
    extractor_version: EXTRACTOR_VERSION,
  }));
}

/** The one key a message is read under, so a device does not propose the same reading twice (10.1 step 1). */
export function readingKey(accountId: string, messageId: string, sourceHash: string): string {
  return `${accountId}:${messageId}:${sourceHash}:${EXTRACTOR_VERSION}`;
}

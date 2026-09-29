import { noDashes } from "../ai/suggestions";
import { titleCase } from "../shared/casing";
import type {
  MeetingCandidate, MeetingStatus, NotificationActionKind, NotificationClassification, PromptLink,
  ReplyMatchKind, ReplyRequirement, ReplyRequirementKind,
} from "./mailContracts";
import { quoteIn, stableId, type SourceMessage } from "./briefSource";
import { readWhen } from "./meetingRead";
import { dayInZone } from "./zoneTime";

// THE WALL BEHIND THE THREE NEW READINGS (2026-09-29).
//
// Everything here takes what a model said about a conversation and decides how
// much of it survives. The rules are the same for all three readings:
//
//   - Enums are closed. A status, a kind or a match type outside its list is
//     dropped, not rounded to the nearest.
//   - A claim names a message and a sentence, and the sentence must be inside
//     that message (briefSource.quoteIn). No sentence that survives, no claim.
//   - The model never supplies a date, a time, a zone, an id or a URL. Dates
//     and times are read out of the sentence by code (meetingRead.ts), ids are
//     hashed locally, and a link is only ever a id from the list it was shown.
//   - Anything the sentence does not settle stays MISSING and is asked about.
//
// Nothing here writes anywhere. It returns shapes; a person taps to use them.

export const NOTIFICATION_KINDS: readonly NotificationActionKind[] = [
  "grant_access", "open_share", "accept_invite", "sign", "track", "add_travel",
  "fill_form", "fix_payment", "copy_code", "unsubscribe",
];
const STATUSES: readonly MeetingStatus[] = ["agreed", "requested", "proposed", "cancelled"];
const REQ_KINDS: readonly ReplyRequirementKind[] = ["question", "request", "decision", "commitment"];
const MATCH_KINDS: readonly ReplyMatchKind[] = ["choice", "date_time", "quantity", "attachment", "free_text"];

export const MAX_CANDIDATES = 5;
export const MAX_REQUIREMENTS = 8;
/** Minutes a meeting is given when the sender did not say. Always shown as a default, never as theirs. */
export const DEFAULT_MEETING_MIN = 60;

export interface ValidateContext {
  account: string;
  threadId: string;
  subject?: string;
  /** What THIS call showed the model, with the text it was shown. */
  messages: readonly SourceMessage[];
  zone: string;
}

const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, "").trim());
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const hhmmToMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const minToHhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** The message a claim names, when it is one this call showed. */
function messageFor(ctx: ValidateContext, id: unknown): SourceMessage | null {
  if (typeof id !== "string") return null;
  return ctx.messages.find((m) => m.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

export function validateMeetingCandidates(raw: unknown, ctx: ValidateContext): MeetingCandidate[] {
  if (!Array.isArray(raw)) return [];
  const out: MeetingCandidate[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isObj(item) || out.length >= MAX_CANDIDATES) continue;
    const msg = messageFor(ctx, item.messageId ?? item.sourceMessageId);
    if (!msg) continue;
    const quote = item.quote ?? item.sourceQuote;
    if (!quoteIn(msg.text, quote)) continue;
    const status = item.status;
    if (typeof status !== "string" || !(STATUSES as readonly string[]).includes(status)) continue;
    // A message with no readable time has no day it was written on: relative
    // words in it stay unresolved rather than counting from 1970.
    const when = readWhen(quote, Number.isFinite(msg.dateMs) && msg.dateMs > 0 ? dayInZone(msg.dateMs, ctx.zone) : null);
    // A claim about an appointment whose own sentence carries no day and no
    // time is not something a card can act on. A cancellation may name neither
    // ("I have to cancel"), and still removes an offer.
    if (status !== "cancelled" && !when.signals) continue;

    const titleRaw = typeof item.title === "string" ? item.title.trim() : "";
    const title = noDashes(clip(titleRaw || ctx.subject || "Appointment", 60)) || "Appointment";
    const id = stableId("mc", ctx.account, ctx.threadId, msg.id, quote);
    if (seen.has(id)) continue;
    seen.add(id);

    // Two days or two times in one sentence is not one meeting: nothing is
    // picked, and the fields the sentence does not settle stay missing.
    const date = when.conflicting ? undefined : when.date;
    const start = when.conflicting ? undefined : when.start;
    let end = when.conflicting ? undefined : when.end;
    let durationSource: "stated" | "default" = when.durationStated && end ? "stated" : "default";
    if (start && !end) {
      // The default is a default: it is drawn as "1h · Default" and never
      // as the sender's own length. It stays inside the day.
      end = minToHhmm(Math.min(24 * 60 - 1, hhmmToMin(start) + DEFAULT_MEETING_MIN));
      durationSource = "default";
    }
    const missing = when.conflicting
      ? [...new Set([...(when.date ? [] : ["date" as const]), "time" as const, ...when.missing.filter((m) => m === "timezone")])]
      : when.missing;
    out.push({
      id,
      sourceMessageId: msg.id,
      sourceQuote: quote.trim(),
      title,
      status: status as MeetingStatus,
      ...(date ? { date } : {}),
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
      ...(when.timeZone && !when.conflicting ? { timeZone: when.timeZone } : {}),
      ...(when.dayPart ? { dayPart: when.dayPart } : {}),
      missing: status === "cancelled" ? [] : missing,
      durationSource,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reply requirements
// ---------------------------------------------------------------------------

// Terms are matched as words later, so they are stored the way the matcher
// compares them: lower case, letters and digits and inner hyphens.
const termOf = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
  return t.length >= 2 && t.length <= 32 ? t : null;
};
const termList = (v: unknown, max: number): string[] => {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const t = termOf(x);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
};

export function validateReplyRequirements(raw: unknown, ctx: ValidateContext): ReplyRequirement[] {
  if (!Array.isArray(raw)) return [];
  const out: ReplyRequirement[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isObj(item) || out.length >= MAX_REQUIREMENTS) continue;
    const msg = messageFor(ctx, item.messageId ?? item.sourceMessageId);
    // Only what someone ELSE asked, and only inside the window where the
    // reader has not already answered. A promise the sender makes about
    // themselves is not an ask, and neither is a message the reader wrote.
    if (!msg || msg.role !== "other" || !msg.relevant) continue;
    const quote = item.quote ?? item.sourceQuote;
    if (!quoteIn(msg.text, quote)) continue;
    const kind = item.kind;
    if (typeof kind !== "string" || !(REQ_KINDS as readonly string[]).includes(kind)) continue;
    const match = isObj(item.match) ? item.match : null;
    if (!match) continue;
    const mk = match.kind;
    if (typeof mk !== "string" || !(MATCH_KINDS as readonly string[]).includes(mk)) continue;
    const topicTerms = termList(match.topicTerms, 6);
    const choices = mk === "choice" ? termList(match.choices, 6) : [];
    const evidenceTerms = termList(match.evidenceTerms, 8);
    // Nothing to match against means the checklist could never say "answered",
    // and a row that can only ever be open is a chore, not a help.
    if (mk === "choice" ? choices.length < 2 : topicTerms.length === 0) continue;
    const labelRaw = typeof item.label === "string" ? item.label.trim() : "";
    const label = titleCase(noDashes(clip(labelRaw || topicTerms[0] || "Reply", 32)));
    const id = stableId("rr", ctx.account, ctx.threadId, msg.id, quote);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      sourceMessageId: msg.id,
      sourceQuote: quote.trim(),
      kind: kind as ReplyRequirementKind,
      label,
      match: {
        kind: mk as ReplyMatchKind,
        topicTerms,
        ...(choices.length ? { choices } : {}),
        ...(evidenceTerms.length ? { evidenceTerms } : {}),
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * `undefined` means the reading did not ask (no link list was supplied);
 * `null` means it asked and nothing survived, which is the same as nothing
 * being wanted. The model may point at a link id it was shown and at nothing else.
 */
export function validateNotification(
  raw: unknown, links: readonly PromptLink[] | undefined, messages: readonly SourceMessage[],
): NotificationClassification | null | undefined {
  if (links === undefined) return undefined;
  if (raw === null) return null;
  if (!isObj(raw)) return null;
  const kind = raw.kind;
  if (typeof kind !== "string" || !(NOTIFICATION_KINDS as readonly string[]).includes(kind)) return null;
  let linkId: string | undefined;
  if (raw.linkId !== undefined && raw.linkId !== null) {
    if (typeof raw.linkId !== "string" || !links.some((l) => l.id === raw.linkId)) return null;
    linkId = raw.linkId;
  }
  let quote: string | undefined;
  if (raw.quote !== undefined && raw.quote !== null) {
    // A sentence offered as the reason must be in the mail. One that is not
    // means the model made the reason up, and then nothing it says stands.
    if (typeof raw.quote !== "string" || !messages.some((m) => quoteIn(m.text, raw.quote))) return null;
    quote = raw.quote.trim();
  }
  return { kind: kind as NotificationActionKind, ...(linkId ? { linkId } : {}), ...(quote ? { quote } : {}) };
}

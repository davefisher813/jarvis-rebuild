// Opening a thread used to fire TWO sequential AI calls: one for the summary,
// one for the quick replies. Same conversation sent twice, one after the
// other, every single time, cached never. Twenty emails opened was forty
// requests and two waits per open.
//
// One call now returns both, and the answer is cached against the thread's
// latest message id, so reopening a thread costs nothing until someone
// actually writes again.

import { noDashes } from "../ai/suggestions";
import { HOSTILE_CLAUSE, untrustedBlock } from "./untrusted";
import { BRIEF_SCHEMA_VERSION, type MeetingCandidate, type NotificationClassification, type PromptLink, type ReplyRequirements } from "./mailContracts";
import { mailMessageKey, type MailScope } from "./mailIdentity";
import type { SourceMessage } from "./briefSource";
import { validateMeetingCandidates, validateNotification, validateReplyRequirements } from "./briefValidate";

export interface Brief {
  summary: string;
  replies: string[];
  // UP-MIND-19 (2026-09-05): WHERE THE THREAD STANDS, above the messages.
  // Opening a fourteen-message thread should answer "where does this stand"
  // before showing a single message, and the vendor picked in message nine
  // should be one tap from the Decisions log.
  //
  // Every field is optional and every one is ABSENT when the model could not
  // establish it. Nothing here is filled with a hedge or a placeholder: the
  // card shows what is known and stops, which is the only way a state card
  // is worth trusting on a thread you have not read.
  state?: ThreadState;
  agreed?: string[];
  unresolved?: string[];
  deadline?: string;
  next?: string;
  // A real decision the thread contains, in its own words. It becomes a
  // "Worth remembering?" offer, and NOTHING is written without the tap.
  decision?: string;
  // THE THING THAT WAS ACTUALLY SET (Dave 2026-09-16: "this should be
  // EXTREMELY easy to add to the Jarvis calendar ... That's the entire
  // point of it being able to read my emails").
  //
  // A CONFIRMED time, not a proposed one: meetingTimes.ts already handles
  // "here are three slots, pick one". This is the other half, the one the
  // state card kept describing in prose it could not act on: "Interview set
  // for Monday at 3pm" was sitting in `agreed` as a sentence, and putting it
  // in the calendar meant reading it and typing it in again.
  //
  // It rides the brief because the brief is ALREADY one AI call per thread.
  // A separate extractor would double the mail spend to learn something the
  // same read already saw.
  meeting?: ConfirmedMeeting;
  // BRIEF v4 (2026-09-29): three more readings of the same conversation, from
  // the same one call, each optional and each meaning "not analysed" when
  // absent. See mailContracts.ts for the laws they share. Declared here so the
  // three screens that read them have one place to look; the prompt and the
  // validation that fill them are the brief's own.
  /** Appointments the conversation sets, asks for, proposes or cancels. [] means none. */
  meetingCandidates?: MeetingCandidate[];
  /** What the sender is waiting to hear back. [] means nothing. */
  replyRequirements?: ReplyRequirements;
  /** What a notification wants done. null means read and nothing is wanted. */
  notification?: NotificationClassification | null;
  /**
   * Set on every entry the v4 reading wrote, whether or not it found anything:
   * it is how a v4 answer is told from a v3 one that merely lacks the new
   * fields. A v3 entry still displays; it is upgraded on the next open.
   */
  schema?: number;
  /** True when the reading was given a link list, so a notification asked about is not asked twice. */
  linksSeen?: boolean;
}

/** A time both sides settled on, resolved against the reader's own today. */
export interface ConfirmedMeeting {
  /** What to call it, in the thread's words, short enough for a row. */
  title: string;
  date: string;   // YYYY-MM-DD
  start: string;  // HH:MM, 24-hour
  end: string;    // HH:MM, 24-hour
}

// The closed vocabulary. A state outside it is dropped rather than shown:
// "where does this stand" is only useful if the words mean the same thing
// every time.
export type ThreadState = "waiting_on_you" | "waiting_on_them" | "scheduled" | "settled" | "no_action";
export const THREAD_STATE_LABEL: Record<ThreadState, string> = {
  waiting_on_you: "Waiting on you",
  waiting_on_them: "Waiting on them",
  scheduled: "Scheduled",
  settled: "Settled",
  no_action: "Nothing needed",
};
const STATES = Object.keys(THREAD_STATE_LABEL) as ThreadState[];

// v2 (2026-09-05, UP-MIND-19): the cached shape gained the state card. The
// cache only invalidates when a NEW message arrives, so every thread already
// summarised would keep an entry with no state and never get one. One
// re-summary on the next open buys the card.
// v3 (2026-09-16): the cached shape gained the confirmed meeting. Same
// reasoning the v2 bump carried: the cache only invalidates when a NEW
// message arrives, so every thread already summarised would keep an entry
// with no meeting and never get one. One re-summary on the next open buys
// the calendar offer.
// v4 (2026-09-29): the cached shape gained meetingCandidates, replyRequirements
// and notification, all from the same one call. UNLIKE v2 and v3 this bump does
// NOT mean "everything is stale": the v3 entries keep their own key, are read
// as a fallback so an already-summarised thread paints its summary at once, and
// each thread is upgraded lazily, on the open that finds its entry without the
// v4 mark (ensureThreadBrief in threadBrief.ts). Nothing is cleared at deploy,
// and nothing pays for an upgrade until somebody opens that thread.
const KEY = "jarvis.mail.brief.v4";
const KEY_V3 = "jarvis.mail.brief.v3";
const CAP = 100;
const REPLY_MAX = 6; // words
// A WALL BEHIND THE INSTRUCTION (2026-08-25). The prompt asks for 15 words
// and a model that ignores it must still not be able to produce a paragraph.
// Cut on a word boundary with an ellipsis, never mid-word: the one truncation
// in this repo that was already done right is bodyText's leadIn, and this
// follows it.
const SUMMARY_MAX = 120;
type Cache = Record<string, Brief>;

export const BRIEF_SYSTEM =
  "You output only a JSON object, nothing else.\n" + HOSTILE_CLAUSE;

/**
 * The v4 reading's extra inputs. Present means "this is the v4 call": the
 * conversation carries message ids and dates in its own headers, and the model
 * is asked for the three new readings instead of the v3 `meeting`.
 */
export interface BriefPromptOptions {
  /** The zone every timestamp in the conversation headers is written in. */
  zone?: string;
  /** True for the v4 call. */
  v4?: boolean;
}

export function briefPrompt(convo: string, todayISO = "", links?: readonly PromptLink[], opts: BriefPromptOptions = {}): string {
  const v4 = !!opts.v4;
  return (
    "Read this email conversation.\n\n" +
    (todayISO && !v4 ? "Today is " + todayISO + ".\n\n" : "") +
    'Reply with ONLY: {"summary":"...","replies":["...","...","..."]}\n\n' +
    // THE SAME DISEASE AS THE PREVIEWS (Dave 2026-08-25: "The subtext on
    // email previews feels a little lengthy. It should be right to the
    // point"). This asked for "one or two sentences" and got 26 words that
    // named the sender already in the header, restated the subject already
    // above it, and referred to Dave in the third person.
    "summary: ONE line, at most 15 words. The reader can already see who it is from and what the subject is, so never repeat those, and never write the reader's name or \"the user\". Lead with what is being asked, or with the fact that matters. Keep dates, times, amounts and names of other people.\n" +
    "Good: \"Video appt Wed Sept 23, 1 PM ET, link to join\" / \"Wants the waiver signed before Friday\"\n" +
    "Bad: \"This is an automated reminder that Dave has a video appointment with Resolve Psychiatric Services at 1:00 pm ET on Wednesday, September 23rd\"\n" +
    "replies: three short reply options the reader could send, each under " + REPLY_MAX + " words, " +
    "in a plain human voice. No greetings, no signatures.\n\n" +
    // UP-MIND-19: the state card. Every one of these is OPTIONAL and must be
    // LEFT OUT rather than guessed: a card that hedges is a card that has to
    // be checked, which is the trip it exists to save.
    "You may also add any of these, and you must leave out any you cannot establish from the text:\n" +
    "state: one of waiting_on_you, waiting_on_them, scheduled, settled, no_action. Use scheduled when the thread holds a CONFIRMED date and time, including a one-sided booking or reservation confirmation.\n" +
    "agreed: up to 3 short fragments, each a thing the parties actually agreed.\n" +
    "unresolved: up to 3 short fragments, each a question the thread has not answered.\n" +
    "deadline: the date or phrase somebody stated, copied in their words.\n" +
    "next: the single next action, starting with a verb, under 8 words.\n" +
    "decision: a settled choice the thread contains, COPIED as a sentence from the text. Leave it out unless you can copy it exactly.\n" +
    (v4 ? v4Instructions(links, opts.zone) : legacyMeetingInstructions()) +
    // UP-MIND-06 (2026-09-05): the whole conversation is outside text.
    untrustedBlock(convo + (v4 && links ? linkBlock(links) : ""))
  );
}

// The confirmed meeting. Deliberately narrow: CONFIRMED only, never a
// proposal, because an offer to put a maybe in the calendar is how a
// calendar stops being trustworthy. Kept for the callers that have not moved
// to the v4 call; the v4 call reads meetingCandidates instead.
//
// WHAT COUNTS AS CONFIRMED (Dave 2026-09-29, the live miss: a tee-time
// confirmation, "Your Tee Time Booking ... has been accepted for: Date:
// Thursday - October 01, 2026, Time: 11:20 AM", came back Settled with no
// Add to Schedule). This used to say "BOTH sides have settled on", which a
// booking or reservation confirmation can never meet: nobody negotiated, one
// side simply confirmed. The requirement is a confirmed date and time, not a
// two-party agreement. The guards below are unchanged.
const CONFIRMED_BOOKINGS =
  "A CONFIRMED date and time counts, including a one-sided booking or reservation confirmation " +
  "(a tee time, a flight, a hotel, a car rental, a restaurant reservation, an appointment confirmation): " +
  "the sender confirming it is enough, nobody has to have agreed to it.";
function legacyMeetingInstructions(): string {
  return (
    "meeting: when the thread shows a specific date and time that is CONFIRMED, as " +
    "{\"title\":\"<short name, their words>\",\"date\":\"YYYY-MM-DD\",\"start\":\"HH:MM\",\"durationMin\":<number>}. " +
    CONFIRMED_BOOKINGS + " " +
    "Use 24-hour times, resolved against today's date above. " +
    "Leave it out entirely if the time is only PROPOSED, is one of several options, is conditional, or if you cannot resolve a real date. " +
    "Never invent a date, a time or a duration you were not given; default the duration to 60 when unstated.\n\n"
  );
}

// BRIEF v4 (2026-09-29). Three more readings from the same one call. The model
// is asked to POINT (a message id, a sentence copied exactly) and never to
// resolve: dates and times are read out of the sentence by code (meetingRead.ts)
// against the day the message was written, ids are hashed locally, and a link
// is only ever an id from the list below. Every one is checked in
// briefValidate.ts and dropped if it does not hold.
function v4Instructions(links: readonly PromptLink[] | undefined, zone: string | undefined): string {
  return (
    "Every message below starts with a header line naming its id, who wrote it and when" + (zone ? " (times are in " + zone + ")" : "") + ". " +
    "In the items below, messageId is copied from a header and quote is copied EXACTLY from that message's own text, one sentence or phrase, never from quoted history.\n" +
    "meetingCandidates: every appointment, call or meeting the conversation SETS or CONFIRMS (agreed), ASKS for (requested), PROPOSES (proposed) or CANCELS (cancelled), as " +
    "[{\"messageId\":\"...\",\"quote\":\"...\",\"title\":\"<short name>\",\"status\":\"agreed|requested|proposed|cancelled\"}]. " +
    CONFIRMED_BOOKINGS + " Use agreed for it, and never for a proposal, one of several options or a conditional time. " +
    "The quote must contain the day and the time as the sender wrote them; when they sit on separate lines of a confirmation (Date: ..., Time: ...), quote them together as one run of the text. Do NOT work out dates or times yourself and do not add any. " +
    "Give one item per option when several times are offered. Use [] when there are none.\n" +
    "replyRequirements: what the people writing to the reader are still waiting to hear back, as " +
    "[{\"messageId\":\"...\",\"quote\":\"...\",\"kind\":\"question|request|decision|commitment\",\"label\":\"<2 to 3 words>\"," +
    "\"match\":{\"kind\":\"choice|date_time|quantity|attachment|free_text\",\"topicTerms\":[\"<words a reply would use>\"],\"choices\":[\"<each option>\"],\"evidenceTerms\":[\"<other words that show it was answered>\"]}}]. " +
    "Only questions, requests, decisions and commitments addressed TO the reader. Leave out greetings, rhetorical questions, promises the sender makes about themselves, asks already answered by a later message from the reader, and requests aimed at someone else. " +
    "Use kind attachment when the sender wants a file. Use choices only when the sender offered options. Use [] when nothing is being asked.\n" +
    (links !== undefined
      ? "notification: when the newest message is an automated notice asking the reader to do one thing, {\"kind\":\"grant_access|open_share|accept_invite|sign|track|add_travel|fill_form|fix_payment|copy_code|unsubscribe\",\"linkId\":\"<an id from LINKS, if the action opens one>\",\"quote\":\"<the sentence that says so>\"}. " +
        "linkId must be one of the ids listed under LINKS and nothing else. Use null when nothing is being asked.\n"
      : "") +
    "\n"
  );
}

// The links a notice carries, as an id, the host and the words on the link.
// The model is never shown the address itself and cannot return one.
function linkBlock(links: readonly PromptLink[]): string {
  if (links.length === 0) return "\nLINKS: none";
  return "\nLINKS:\n" + links.slice(0, 12).map((l) => l.id + " | " + l.host + " | " + l.text.replace(/\s+/g, " ").slice(0, 80)).join("\n");
}

/**
 * What the v4 reading needs to check a model answer against the conversation
 * that produced it. Without it `parseBrief` is the v3 parser and reads none of
 * the new fields, so every existing caller and test is untouched.
 */
export interface BriefContext {
  account: string;
  threadId: string;
  subject?: string;
  /** What THIS call showed the model, with the text it was shown. */
  messages: readonly SourceMessage[];
  /** The zone the conversation's timestamps were written in. */
  zone: string;
  /** The latest message id the reading was made from. */
  sourceRevision: string;
  /** False when part of the conversation was not read. Never shown as complete then. */
  completeSource: boolean;
  /** The link list the model was shown. Undefined means notifications were not asked about. */
  links?: readonly PromptLink[];
}

// Tolerant: a missing or malformed half never poisons the other half.
export function parseBrief(raw: string, ctx?: BriefContext): Brief | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let o: unknown;
  try {
    o = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof o !== "object" || o === null) return null;
  const { summary, replies, state, agreed, unresolved, deadline, next, decision, meeting, meetingCandidates, replyRequirements, notification } = o as Record<string, unknown>;
  const s = typeof summary === "string" ? clip(noDashes(summary.trim()), SUMMARY_MAX) : "";
  const r = Array.isArray(replies)
    ? replies.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => noDashes(x.trim())).slice(0, 3)
    : [];
  if (!s && r.length === 0) return null;
  // UP-MIND-19: tolerant, and never inventive. A state outside the closed
  // vocabulary, an empty list, a deadline longer than a phrase: all dropped.
  const frag = (v: unknown): string[] => (Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => noDashes(clip(x.trim(), 80))).slice(0, 3)
    : []);
  const st = typeof state === "string" && (STATES as string[]).includes(state) ? state as ThreadState : undefined;
  const ag = frag(agreed);
  const un = frag(unresolved);
  const dl = typeof deadline === "string" && deadline.trim() ? noDashes(deadline.trim().slice(0, 40)) : "";
  const nx = typeof next === "string" && next.trim() ? noDashes(clip(next.trim(), 60)) : "";
  const dc = typeof decision === "string" && decision.trim() ? noDashes(decision.trim().slice(0, 200)) : "";
  const mt = parseMeeting(meeting);
  // v4. Each reading is present only when the model ANSWERED it: an omitted key
  // is "not analysed", an empty array is "analysed, none". Whatever is present
  // has been through the wall in briefValidate.ts.
  const v4 = ctx ? readV4(ctx, { meetingCandidates, replyRequirements, notification }) : null;
  // A thread that holds a confirmed date and time is scheduled, not settled
  // (Dave 2026-09-29, the tee-time confirmation that came back Settled). The
  // model's own word stands unless it is one that says nothing is happening;
  // a thread still waiting on somebody keeps that.
  const state2 = scheduledState(st, mt, v4?.meetingCandidates);
  return {
    summary: s, replies: r,
    ...(v4 ?? {}),
    ...(state2 ? { state: state2 } : {}),
    ...(ag.length ? { agreed: ag } : {}),
    ...(un.length ? { unresolved: un } : {}),
    ...(dl ? { deadline: dl } : {}),
    ...(nx ? { next: nx } : {}),
    ...(dc ? { decision: dc } : {}),
    ...(mt ? { meeting: mt } : {}),
  };
}

/** A candidate a card can act on: agreed, with a real day and a real time. */
function isConfirmedCandidate(c: MeetingCandidate): boolean {
  return c.status === "agreed" && !!c.date && !!c.start && c.missing.length === 0;
}

/** The thread's state once a confirmed meeting is known: settled and no-action become scheduled. */
export function scheduledState(
  st: ThreadState | undefined,
  legacy: ConfirmedMeeting | null,
  candidates: readonly MeetingCandidate[] | undefined,
): ThreadState | undefined {
  const confirmed = !!legacy || !!candidates?.some(isConfirmedCandidate);
  if (!confirmed) return st;
  return st === undefined || st === "settled" || st === "no_action" ? "scheduled" : st;
}

function readV4(
  ctx: BriefContext,
  got: { meetingCandidates: unknown; replyRequirements: unknown; notification: unknown },
): Pick<Brief, "meetingCandidates" | "replyRequirements" | "notification" | "schema" | "linksSeen"> {
  const vctx = { account: ctx.account, threadId: ctx.threadId, ...(ctx.subject ? { subject: ctx.subject } : {}), messages: ctx.messages, zone: ctx.zone };
  const out: Pick<Brief, "meetingCandidates" | "replyRequirements" | "notification" | "schema" | "linksSeen"> = { schema: BRIEF_SCHEMA_VERSION };
  if (Array.isArray(got.meetingCandidates)) out.meetingCandidates = validateMeetingCandidates(got.meetingCandidates, vctx);
  if (Array.isArray(got.replyRequirements)) {
    out.replyRequirements = {
      items: validateReplyRequirements(got.replyRequirements, vctx),
      completeSource: ctx.completeSource,
      sourceRevision: ctx.sourceRevision,
    };
  }
  if (ctx.links !== undefined) {
    out.linksSeen = true;
    // A key that is absent is "not analysed"; one that is present and does not
    // survive is "analysed, nothing wanted".
    if (got.notification !== undefined) out.notification = validateNotification(got.notification, ctx.links, ctx.messages) ?? null;
  }
  return out;
}

// STRICT, BECAUSE THIS ONE WRITES TO A CALENDAR. Every field has to be
// really there and really well-formed; a half-parsed meeting is dropped
// whole rather than offered with a guessed date. The clamps are the same
// ones meetingTimes.ts already applies to a proposed slot.
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function parseMeeting(v: unknown): ConfirmedMeeting | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const m = v as Record<string, unknown>;
  const title = typeof m.title === "string" ? noDashes(clip(m.title.trim(), 60)) : "";
  const date = typeof m.date === "string" ? m.date.trim() : "";
  const start = typeof m.start === "string" ? m.start.trim() : "";
  if (!title || !ISO_DAY.test(date) || !HHMM.test(start)) return null;
  // A real calendar day, not merely a well-shaped string: 2026-02-31 passes
  // the regex and is not a date.
  //
  // FIXED 2026-09-18. This parsed the day at LOCAL midnight and compared it
  // against toISOString(), which is UTC -- so anywhere east of Greenwich the
  // round trip lands on the previous day and EVERY confirmed meeting was
  // silently dropped, card and all. Measured: America/New_York round-trips
  // "2026-09-22" to itself; Europe/Berlin and Asia/Tokyo both return
  // "2026-09-21". The parts are compared instead, which has no zone in it.
  const [yy, mm, dd] = date.split("-").map(Number) as [number, number, number];
  const d = new Date(yy, mm - 1, dd);
  if (Number.isNaN(d.getTime()) || d.getFullYear() !== yy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
  const mins = typeof m.durationMin === "number" && Number.isFinite(m.durationMin)
    ? Math.min(600, Math.max(15, Math.round(m.durationMin)))
    : 60;
  const from = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5));
  // Clamped inside the day, the same way a window is: an event that runs
  // past midnight is a thing this app has already ruled out.
  const to = Math.min(24 * 60 - 1, from + mins);
  const end = `${String(Math.floor(to / 60)).padStart(2, "0")}:${String(to % 60).padStart(2, "0")}`;
  return { title, date, start, end };
}

// Cut at a word boundary, with the ellipsis that says it happened.
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const back = cut.replace(/\s+\S*$/, "");
  return (back.length > max * 0.6 ? back : cut).replace(/[.,;:\s]+$/, "") + "\u2026";
}

// The home list asks briefFor once per row, and each ask used to parse the
// whole cache again. The parse is kept per key against the exact text it came
// from, so an unchanged cache is parsed once and a changed one is parsed anew.
// Callers get the shared object and must not change it (saveBrief copies).
const parsed = new Map<string, { raw: string; val: Cache }>();
function readMap(key: string): Cache {
  let raw: string;
  try { raw = localStorage.getItem(key) || "{}"; } catch { return {}; }
  const hit = parsed.get(key);
  if (hit && hit.raw === raw) return hit.val;
  let val: Cache = {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) val = v as Cache;
  } catch { val = {}; }
  parsed.set(key, { raw, val });
  return val;
}

/**
 * Every brief this device holds: the v3 entries underneath, the v4 entries on
 * top. A thread summarised before v4 still shows its summary and state card
 * the instant it opens; it just has no `schema` mark, which is what tells
 * ensureThreadBrief to read it again once, when somebody opens it.
 */
export function loadBriefs(): Cache {
  return { ...readMap(KEY_V3), ...readMap(KEY) };
}

const isBrief = (b: unknown): b is Brief => !!b && typeof (b as Brief).summary === "string";

// Keyed by the thread's LATEST message id: a new reply invalidates it, which
// is exactly when the summary stops being true. v4 entries are keyed by account
// as well (mailMessageKey), because two connected mailboxes can hold a message
// with the same id; the bare id still finds an entry, so a caller with no
// account (the home snapshot's reply chips) keeps working.
export function briefFor(lastMsgId: string, cache: Cache = loadBriefs(), scope?: MailScope): Brief | null {
  if (scope) {
    const scoped = cache[mailMessageKey(scope, lastMsgId)];
    if (isBrief(scoped)) return scoped;
  }
  // A caller with no account (the home snapshot's reply chips) takes a v4
  // entry for that message id from whichever mailbox has one, ahead of a v3
  // entry that has no account to prove.
  if (!scope) {
    const suffix = ":m:" + encodeURIComponent(lastMsgId);
    for (const k of Object.keys(cache)) {
      if (k.endsWith(suffix) && isBrief(cache[k])) return cache[k]!;
    }
  }
  const bare = cache[lastMsgId];
  return isBrief(bare) ? bare : null;
}

/** True only for an entry the v4 reading wrote. A v3 entry displays but is not this. */
export function isCurrentBrief(b: Brief | null): b is Brief {
  return !!b && b.schema === BRIEF_SCHEMA_VERSION;
}

export function saveBrief(lastMsgId: string, brief: Brief, scope?: MailScope): void {
  const cache: Cache = { ...readMap(KEY) };
  const key = scope ? mailMessageKey(scope, lastMsgId) : lastMsgId;
  // Re-saving moves the entry to the newest end, so the cap drops the oldest read.
  delete cache[key];
  cache[key] = brief;
  const keys = Object.keys(cache);
  const trimmed: Cache = {};
  for (const k of keys.slice(-CAP)) trimmed[k] = cache[k]!;
  try { localStorage.setItem(KEY, JSON.stringify(trimmed)); } catch { /* private mode */ }
}

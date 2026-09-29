import type { Unsub } from "./unsubscribe";

// THE SHARED SHAPES FOR WHAT AN EMAIL ASKS OF HIM (2026-09-29).
//
// Three features read the same conversation and must not each invent their
// own reading of it: the appointment finish card (what was set, or offered),
// Reply Coverage (what the sender is waiting to hear back), and the Today
// notification actions (what the message wants done: grant access, sign, track
// a parcel). They are one extraction, in the one AI call the brief already
// makes per thread (brief v4), and one deterministic pass over the message's
// own links and headers. These are the types that pass produces and the three
// screens consume. Nothing in here calls anything.
//
// Laws every reader of these shapes inherits:
//   - undefined means NOT ANALYSED; an empty list means analysed and there was
//     nothing. The two are never the same, and neither is a guess.
//   - A quote is COPIED from the message and checked to be inside it. A claim
//     with no quote that survives the check is dropped, not softened.
//   - The model never supplies a URL. It may point at a link id it was shown;
//     the URL is extracted from the message itself and validated in code.
//   - Detecting is not doing. Nothing here writes to the calendar, Brain or
//     anywhere else; that takes a tap on a button that says what it does.

/** Bump with the brief cache key. See brief.ts for why every bump is a lazy upgrade. */
export const BRIEF_SCHEMA_VERSION = 4;

export type MeetingStatus = "agreed" | "requested" | "proposed" | "cancelled";
export type MeetingMissing = "date" | "time" | "meridiem" | "timezone";

export interface MeetingCandidate {
  /** Stable, generated locally from the thread and the candidate, never by the model. */
  id: string;
  sourceMessageId: string;
  /** Copied from the message and verified to be inside it. */
  sourceQuote: string;
  title: string;
  status: MeetingStatus;
  /** YYYY-MM-DD, resolved against the SOURCE message's date and zone, never the day it is opened. */
  date?: string;
  /** HH:MM, 24-hour. Absent while AM or PM is unknown: "Tuesday at 3" is asked about, never guessed. */
  start?: string;
  end?: string;
  /** IANA zone, only when the message states or unambiguously implies one. */
  timeZone?: string;
  /** "Thursday morning" has a day part and no time. It is never turned into 9 AM. */
  dayPart?: "morning" | "afternoon" | "evening";
  /** What still has to be asked before this can go on a calendar. */
  missing: MeetingMissing[];
  /** "stated" when the sender gave a length; "default" is shown as "1 hour · default", never as theirs. */
  durationSource: "stated" | "default";
}

export type ReplyRequirementKind = "question" | "request" | "decision" | "commitment";
export type ReplyMatchKind = "choice" | "date_time" | "quantity" | "attachment" | "free_text";

export interface ReplyRequirement {
  id: string;
  sourceMessageId: string;
  sourceQuote: string;
  kind: ReplyRequirementKind;
  /** Short, for the checklist: "Which day", "Waiver". */
  label: string;
  match: {
    kind: ReplyMatchKind;
    topicTerms: string[];
    choices?: string[];
    evidenceTerms?: string[];
  };
}

export interface ReplyRequirements {
  items: ReplyRequirement[];
  /** False when part of the conversation was not read (too long for one pass). Never shown as complete then. */
  completeSource: boolean;
  /** The content revision this was read from, so a stale list is recognised. */
  sourceRevision: string;
}

export type NotificationActionKind =
  | "grant_access" | "open_share" | "accept_invite" | "sign" | "track" | "add_travel"
  | "fill_form" | "fix_payment" | "copy_code" | "unsubscribe";

/** What the MODEL is allowed to say about a notification: a kind, and a link id it was shown. Never a URL. */
export interface NotificationClassification {
  kind: NotificationActionKind;
  /** An id from the link list the extractor gave the model. */
  linkId?: string;
  /** The sentence that says so, copied from the message. */
  quote?: string;
}

export interface ActionEvidence {
  sourceMessageId: string;
  sourceRevision: string;
  sourceQuote?: string;
  linkId?: string;
}

/** A validated action: every URL in it was extracted from the message and checked in code. */
export interface NotificationAction {
  kind: NotificationActionKind;
  evidence: ActionEvidence;
  /** A validated HTTPS destination, when the action opens one. */
  url?: string;
  /** For add_travel, and for accept_invite when the event is complete. */
  meeting?: MeetingCandidate;
  /** For unsubscribe: the message's own List-Unsubscribe, parsed. */
  unsubscribe?: Unsub;
  /** When the action stops being useful (a code, an invitation). */
  expiresAt?: string;
}

/**
 * One link the model is allowed to point at. The extractor builds the list from
 * the message itself; the model sees only the id, the host and the anchor text,
 * and may answer with an id. It never sees a full URL to copy, and any id not
 * in the list is dropped.
 */
export interface PromptLink {
  id: string;
  host: string;
  text: string;
}

/** What adding a detected appointment to Jarvis's own calendar reports back. */
export interface AddMeetingResult {
  /**
   * added: saved just now. already: this exact candidate was saved before (this
   * device or another), nothing was written. incomplete: it is missing a date,
   * a time or AM/PM, so the caller opens the schedule editor prefilled instead.
   * failed: the write did not land.
   */
  status: "added" | "already" | "incomplete" | "failed";
  eventId?: string;
  /** Plain words for a receipt. Claims "added" only when the save landed. */
  message: string;
  /** Removes only the entry Jarvis just made, and only reports true after the delete is confirmed. */
  undo?: () => Promise<boolean>;
}

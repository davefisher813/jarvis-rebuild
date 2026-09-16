import { COLOR_SLOTS, type ColorSlot } from "../categories/types";

export const ENTITY_PERSON = "person";

export type PersonGroup = "contacts" | "inner_circle" | "adversarial";

/** One way to reach someone, with the label its source gave it ("mobile",
 *  "work", "home"). The label is never invented: absent means the source did
 *  not say, and the UI says nothing rather than guessing. */
export interface ContactMethod {
  value: string;
  label?: string;
}

/** A role this person holds IN ONE AREA. Mom is "Mother" in Family and
 *  "Board secretary" in Bridge, and neither answer is wrong -- which is why
 *  `relationship` below, one string for the whole person, could not hold it. */
export interface PersonRole {
  categoryId: string;
  role: string;
}

/** Something to raise the next time you talk. Undated on purpose: the whole
 *  point is that it is NOT a deadline, and the handoff is explicit that these
 *  never schedule an alert of their own. */
export interface TalkingPoint {
  id: string;
  text: string;
  /** Marked once it has been raised. Kept, not deleted, so it can be undone
   *  and so the card can say what was covered last time. */
  discussed?: boolean;
}

export interface PersonData {
  name: string;
  // ONE PERSON, EVERY NAME YOU CALL THEM (People handoff, 2026-09-16: "Mom
  // and Linda Fisher are one confirmed identity"). Search and the mention
  // matcher read these as well as `name`, so a task that says "call Mom"
  // finds Linda Fisher without a second contact existing for her.
  aliases?: string[];
  // Legacy placement field. Kept readable for old rows; new people are always
  // "contacts". The Inner Circle / Adversarial lists were removed 2026-08-03
  // (a list only earns a tab when a feature acts on membership; none did).
  // The per-person facts below carry the value the lists claimed to.
  group: PersonGroup;
  relationship?: string; // the label: who they are to you ("Sister", "Client")
  // Who they are IN A GIVEN AREA, when one label for the whole person is not
  // the truth. `relationship` above stays the general answer and is what a
  // person with one context still uses; this is for the ones who wear two.
  roles?: PersonRole[];
  // NEXT TIME WE TALK (People handoff, 2026-09-16). Undated points, kept on
  // the person because that is the only place they mean anything. They raise
  // no notification and set no date: a talking point that nags is a task, and
  // the app already has tasks for that.
  talkingPoints?: TalkingPoint[];
  birthday?: string;
  notes?: string;
  color?: ColorSlot;
  order?: number;
  // Person pass (2026-08-03). These two are the PRIMARY method of each kind
  // and stay the field every existing reader uses: Call, Text, Email, search,
  // the meeting-prep matcher, the chat composer. They are always the first
  // entry of the arrays below when those exist, so nothing had to be
  // rewritten to keep working and nothing can drift between the two.
  email?: string;
  phone?: string;
  // EVERY NUMBER A CONTACT ACTUALLY HAS (People handoff, 2026-09-16). One
  // string per kind was the root of the bug Dave photographed: a contact with
  // a mobile and a landline kept the first and the import pushed the second
  // into `notes` (vCard) or dropped it outright (CSV), so the app showed a
  // number in the notes blob with the Phone field looking blank beside it.
  //
  // The arrays are the truth; the singles above are the primary view of them.
  // Both are optional, so a person saved before this existed reads exactly as
  // they did -- contactMethods.ts is the one place that knows how to read
  // either shape, and every writer goes through it so they cannot disagree.
  phones?: ContactMethod[];
  emails?: ContactMethod[];
  // What a contact file carried and this app had nowhere to put, so it went
  // into the notes blob or was dropped (People handoff, 2026-09-16). Facts
  // about the person, not about the relationship: `relationship` above stays
  // who they are TO YOU ("Sister", "Client"), which is a different question.
  org?: string;
  title?: string;
  /** The id the contact file gave this person (vCard UID). What a reimport
   *  matches on FIRST, so recognizing someone never rests on their name. Set
   *  only by an import; a person added by hand has none, and that is fine. */
  sourceUid?: string;
  urls?: string[];
  addresses?: string[];
  // How JARVIS writes to them. Deliberately NOT "closeness": nobody should
  // have to rate a relationship. unset = unknown = clean prose (guardrail).
  // "friend" is the loosest register (how people actually text close friends);
  // it loosens structure only, never invents slang (Dave, 2026-08-03).
  register?: "casual" | "professional" | "friend";
  // Handle-with-care. Set ONLY by explicit user action (or confirmed legacy
  // review), never inferred. Precedence in drafting: flagged > any register.
  flagged?: boolean;
  // A person can belong to several categories (Family AND Bridge): multi, not
  // single, or we rebuild the exclusive-bucket mistake one layer down.
  categoryIds?: string[];
  // Call Prep (addendum item 2): when you last tapped Call from the prep
  // card, ISO datetime. An ATTEMPT, logged automatically with undo. Never
  // duration, never outcome: the app knows you dialed, nothing more, and it
  // does not pretend otherwise.
  lastCallAttempt?: string;
}

export interface Person {
  id: string;
  data: PersonData;
}

export function personInitials(name: string): string {
  return name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
}

// Deterministic, colorful avatar tile (never grey) from the name.
// Avatar palette excludes the brand red: red is reserved for the accent,
// urgency, and category-red, so a person avatar never reads as an alert.
// Avatar color: defaults to JARVIS red (the brand accent); user-editable per person.
export const AVATAR_COLORS: ColorSlot[] = COLOR_SLOTS;
export function avatarClass(color?: ColorSlot): string {
  return !color || color === "red" ? "av-accent" : "cat-bg-" + color;
}
const AVATAR_SLOTS: ColorSlot[] = COLOR_SLOTS.filter((s) => s !== "red");
export function slotForName(name: string): ColorSlot {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_SLOTS[h % AVATAR_SLOTS.length] ?? "blue";
}

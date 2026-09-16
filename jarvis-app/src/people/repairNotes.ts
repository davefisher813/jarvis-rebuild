import type { ContactMethod, PersonData } from "./types";
import { phonesOf, emailsOf, normPhone, normEmail, withPhones, withEmails } from "./contactMethods";

// THE NUMBER THAT ENDED UP IN THE NOTES (People handoff, 2026-09-16; Dave
// photographed a contact whose number sat in Notes with the Phone field
// blank beside it).
//
// The import that put it there is fixed, but a fixed parser does nothing for
// the people already in the app. This finds those numbers and addresses and
// offers to put them where they belong.
//
// THREE RULES, and they are the whole design:
//
//   1. IT PROPOSES, IT NEVER APPLIES. The handoff asks for "reviewable
//      recovery", and it is right to: a string of digits in a note can be an
//      order number, a door code, a room, a year. Nothing here writes; it
//      returns findings, and a caller applies only what a person confirmed.
//   2. THE NOTE IS KEPT. Repairing a number copies it into the field and
//      leaves the note exactly as written. The note is what the user typed,
//      often with the context that makes the number mean something ("Aaron's
//      cell, call after 6"), and editing someone's words to tidy a field is
//      not a repair.
//   3. IT NEVER OVERWRITES. A method the person already has is not a finding,
//      whichever shape it is stored in, so running this twice changes
//      nothing the second time and a confirmed user edit is never undone.

export interface NoteFinding {
  kind: "phone" | "email";
  /** The text exactly as it appears in the note, which is what gets saved:
   *  the user's own formatting, not a normalized rewrite of it. */
  value: string;
  /** The line it was found on, so a review screen can show why. */
  context: string;
}

// A PHONE NUMBER, NOT EVERY RUN OF DIGITS. Deliberately narrow, for the same
// reason the person-mention matcher is: a wrong find here asks the user about
// noise, and enough noise makes them stop reading the offers at all.
//
// Requires punctuation or spacing in the shape a written number has, or a
// clean 10-to-11-digit run. That is what keeps out the things a note is
// actually full of: years, money, zip codes, order numbers, times.
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}\b|\+\d{10,14}\b|\b\d{10,11}\b/g;

// Conservative on purpose: no exotic TLD guessing, no bare "name at domain".
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// Things that look like a number and are not one. A note reading "Invoice
// 4029183827" or "Confirmation 1234567890" is the exact false positive that
// makes a review list useless, so a digit run introduced by one of these
// words is left alone.
const NOT_A_PHONE = /\b(invoice|order|conf(?:irmation)?|acct|account|policy|case|ticket|ref(?:erence)?|tracking|serial|sku|isbn|pin|code|room|unit|apt|suite|zip|ext(?:ension)?)\b[^\n]{0,12}$/i;

/**
 * What this person's notes appear to be hiding, minus anything they already
 * have. Empty when there is nothing to offer, which is the normal case and
 * must stay silent rather than becoming a badge on every contact.
 */
export function findInNotes(d: Pick<PersonData, "notes" | "phone" | "phones" | "email" | "emails">): NoteFinding[] {
  const notes = d.notes ?? "";
  if (!notes.trim()) return [];

  const havePhones = new Set(phonesOf(d).map((m) => normPhone(m.value)).filter(Boolean));
  const haveEmails = new Set(emailsOf(d).map((m) => normEmail(m.value)));

  const out: NoteFinding[] = [];
  const seen = new Set<string>();

  for (const line of notes.split(/\n/)) {
    for (const m of line.matchAll(EMAIL_RE)) {
      const value = m[0];
      const key = "e:" + normEmail(value);
      if (haveEmails.has(normEmail(value)) || seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: "email", value, context: line.trim() });
    }
    for (const m of line.matchAll(PHONE_RE)) {
      const value = m[0];
      const key = normPhone(value);
      if (!key) continue;
      // An address's digits are not a second phone number.
      if (line.slice(Math.max(0, m.index - 40), m.index).includes("@")) continue;
      const before = line.slice(0, m.index);
      if (NOT_A_PHONE.test(before)) continue;
      if (havePhones.has(key) || seen.has("p:" + key)) continue;
      seen.add("p:" + key);
      out.push({ kind: "phone", value, context: line.trim() });
    }
  }
  return out;
}

/**
 * The patch that accepts a set of findings. The note is NOT in it: the
 * original stays exactly as the user wrote it, and the methods are added
 * after the ones already on record, so nothing they confirmed is displaced
 * and the primary they rely on does not move.
 */
export function applyFindings(
  d: Pick<PersonData, "phone" | "phones" | "email" | "emails">,
  accepted: NoteFinding[],
): Partial<PersonData> {
  const phones: ContactMethod[] = [...phonesOf(d)];
  const emails: ContactMethod[] = [...emailsOf(d)];
  let touchedP = false;
  let touchedE = false;
  for (const f of accepted) {
    if (f.kind === "phone") { phones.push({ value: f.value }); touchedP = true; }
    else { emails.push({ value: f.value }); touchedE = true; }
  }
  return {
    ...(touchedP ? withPhones(phones) : {}),
    ...(touchedE ? withEmails(emails) : {}),
  };
}

export interface RepairCandidate {
  id: string;
  name: string;
  findings: NoteFinding[];
}

/** Everyone with something to offer, in list order. The caller reviews. */
export function repairCandidates(
  people: { id: string; data: PersonData }[],
): RepairCandidate[] {
  const out: RepairCandidate[] = [];
  for (const p of people) {
    const findings = findInNotes(p.data);
    if (findings.length) out.push({ id: p.id, name: p.data.name, findings });
  }
  return out;
}

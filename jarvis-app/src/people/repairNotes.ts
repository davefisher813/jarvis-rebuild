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

// THE SAME NUMBER, WRITTEN TWICE (Dave 2026-09-16: "On every contact page it
// still has their number under notes as well. Delete that and fix the bug").
//
// This is my rule biting. Repair COPIES a number into the field and keeps the
// note, which is right when the note is a sentence the user wrote. But the
// old import wrote the number onto its OWN LINE in the notes blob, and once
// the field also holds it, findInNotes goes silent -- a method already on the
// record is not a finding -- so the duplicate line has no way to leave. Every
// contact imported before the parser was fixed shows their number twice, for
// good, and nothing offers to do anything about it.
//
// So: a note line that says NOTHING the record does not already say is not
// a note. It gets removed. A line carrying anything else is left exactly as
// written, because that is still someone's own words.

// The words a contact export puts in front of a number. They carry no
// information once the number sits in a labelled field, so a line that is
// only one of these plus the number is pure duplication.
const LABEL_WORD = /\b(cell|mobile|phone|telephone|tel|home|work|main|fax|pager|email|e-?mail|address|contact|number|no)\b/gi;

/** The note lines that only repeat a contact method the record already has. */
export function duplicateNoteLines(
  d: Pick<PersonData, "notes" | "phone" | "phones" | "email" | "emails">,
): string[] {
  const notes = d.notes ?? "";
  if (!notes.trim()) return [];
  const havePhones = new Set(phonesOf(d).map((m) => normPhone(m.value)).filter(Boolean));
  const haveEmails = new Set(emailsOf(d).map((m) => normEmail(m.value)));

  const out: string[] = [];
  for (const line of notes.split(/\n/)) {
    if (!line.trim()) continue;
    let rest = line;
    let matched = false;
    // Take out every method on this line that the record already holds.
    for (const m of line.matchAll(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g)) {
      if (!haveEmails.has(normEmail(m[0]))) continue;
      rest = rest.replace(m[0], "");
      matched = true;
    }
    for (const m of line.matchAll(/[+(]?\d[\d\s().-]{5,}\d/g)) {
      const k = normPhone(m[0]);
      if (!k || !havePhones.has(k)) continue;
      rest = rest.replace(m[0], "");
      matched = true;
    }
    if (!matched) continue;
    // WHAT IS LEFT DECIDES. Strip the label words and the punctuation that
    // joined them; if the line had nothing else to say, it goes. If it did
    // ("call after 6"), the whole line stays as written -- editing round
    // someone's words to tidy a field is not a cleanup.
    const leftover = rest.replace(LABEL_WORD, "").replace(/[\s:;,./|·-]+/g, "");
    if (leftover === "") out.push(line);
  }
  return out;
}

/** The note with those lines gone, or null when there is nothing to remove.
 *  An empty result clears the field rather than leaving a blank note. */
export function cleanedNotes(
  d: Pick<PersonData, "notes" | "phone" | "phones" | "email" | "emails">,
): string | null {
  const dupes = duplicateNoteLines(d);
  if (!dupes.length) return null;
  const drop = new Set(dupes);
  const kept = (d.notes ?? "").split(/\n/).filter((l) => !drop.has(l));
  return kept.join("\n").trim();
}

export interface CleanupCandidate {
  id: string;
  name: string;
  /** What comes out, so a receipt can say how much and a test can see it. */
  removed: string[];
  notes: string;
}

/** Everyone whose notes repeat something their own fields already say. */
export function cleanupCandidates(
  people: { id: string; data: PersonData }[],
): CleanupCandidate[] {
  const out: CleanupCandidate[] = [];
  for (const p of people) {
    const removed = duplicateNoteLines(p.data);
    if (!removed.length) continue;
    out.push({ id: p.id, name: p.data.name, removed, notes: cleanedNotes(p.data) ?? "" });
  }
  return out;
}

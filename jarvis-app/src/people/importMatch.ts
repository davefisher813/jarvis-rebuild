import type { ImportedContact } from "./importContacts";
import type { ContactMethod, Person, PersonData } from "./types";
import { phonesOf, emailsOf, normPhone, normEmail, withPhones, withEmails, matchKeys } from "./contactMethods";
import { capAfterNumber } from "../shared/casing";

// WHO IS THIS, AND HAVE I GOT THEM ALREADY (People handoff, 2026-09-16).
//
// The old answer was a lowercase name comparison, and rows that matched were
// SKIPPED. Two bad consequences, both silent: a contact whose details had
// changed was never updated, and a genuine second "John Smith" was dropped on
// the floor and never created at all.
//
// THE LADDER, strongest evidence first. Each rung is only taken when the one
// above it found nothing:
//
//   1. THE SOURCE'S OWN ID (vCard UID). The file says these are the same
//      record. Nothing is more certain than that, and it is the only rung
//      that does not depend on the data being right.
//   2. A SHARED EMAIL OR PHONE. Normalized for comparison only. Strong, but
//      not certain: a household landline is shared by everyone who lives
//      there, so this rung is evidence, not proof, and it is why an update
//      never overwrites.
//   3. THE NAME ALONE. Not a match. It goes to REVIEW, because "name alone
//      and shared household numbers are insufficient to merge automatically"
//      and because the alternative -- skipping -- loses a real person.
//
// And what an update may do is deliberately small: ADD what is missing, never
// replace what is there. A reimport of a stale export must not be able to
// walk back a correction the user made by hand.

export interface MatchUpdate {
  person: Person;
  contact: ImportedContact;
  /** The patch to apply. Empty when the file carried nothing new, which is
   *  the normal case for a reimport and is reported as "unchanged". */
  patch: Partial<PersonData>;
  /** Plain words for what would change, for the summary. */
  changes: string[];
}

export interface MatchReview {
  contact: ImportedContact;
  /** Who it might be. Never applied without an answer. */
  candidates: Person[];
  reason: "same-name";
}

export interface MatchPlan {
  create: ImportedContact[];
  update: MatchUpdate[];
  unchanged: number;
  review: MatchReview[];
}

export function planImport(existing: Person[], incoming: ImportedContact[]): MatchPlan {
  const byUid = new Map<string, Person>();
  const byKey = new Map<string, Person[]>();
  const byName = new Map<string, Person[]>();
  for (const p of existing) {
    if (p.data.sourceUid) byUid.set(p.data.sourceUid, p);
    for (const k of matchKeys(p.data)) push(byKey, k, p);
    push(byName, nameKey(p.data.name), p);
    for (const a of p.data.aliases ?? []) push(byName, nameKey(a), p);
  }

  const plan: MatchPlan = { create: [], update: [], unchanged: 0, review: [] };
  for (const c of incoming) {
    const hit = c.uid ? byUid.get(c.uid) : undefined;
    const strong = hit ?? byContact(byKey, c);
    if (strong) {
      const { patch, changes } = mergeInto(strong.data, c);
      if (changes.length) plan.update.push({ person: strong, contact: c, patch, changes });
      else plan.unchanged++;
      continue;
    }
    const sameName = byName.get(nameKey(c.name)) ?? [];
    if (sameName.length) {
      plan.review.push({ contact: c, candidates: sameName, reason: "same-name" });
      continue;
    }
    plan.create.push(c);
  }
  return plan;
}

/** The patch that ACCEPTS a review as "this is the same person". Same merge
 *  an automatic match would have produced, so confirming by hand and matching
 *  by id land on identical data. */
export function mergeReview(person: Person, contact: ImportedContact): Partial<PersonData> {
  return mergeInto(person.data, contact).patch;
}

/** A person record for a contact the file carried, ready to create. */
export function draftFrom(c: ImportedContact): PersonData {
  return {
    name: c.name,
    group: "contacts",
    ...(c.birthday ? { birthday: c.birthday } : {}),
    ...(c.notes ? { notes: c.notes } : {}),
    ...(c.phone ? { phone: c.phone } : {}),
    ...(c.phones ? { phones: c.phones } : {}),
    ...(c.email ? { email: c.email } : {}),
    ...(c.emails ? { emails: c.emails } : {}),
    ...(c.org ? { org: c.org } : {}),
    ...(c.title ? { title: c.title } : {}),
    ...(c.urls ? { urls: c.urls } : {}),
    ...(c.addresses ? { addresses: c.addresses } : {}),
    ...(c.uid ? { sourceUid: c.uid } : {}),
  };
}

// --- internals -----------------------------------------------------------

function push<T>(m: Map<string, T[]>, k: string, v: T): void {
  if (!k) return;
  const cur = m.get(k);
  if (cur) cur.push(v); else m.set(k, [v]);
}

const nameKey = (n: string) => n.trim().toLowerCase();

function byContact(byKey: Map<string, Person[]>, c: ImportedContact): Person | undefined {
  for (const k of matchKeys(c)) {
    const hits = byKey.get(k);
    // Two people sharing one key is a household number, not an identity.
    // Ambiguous evidence is no evidence: fall through to the name rung.
    if (hits && hits.length === 1) return hits[0];
  }
  return undefined;
}

/**
 * ADD WHAT IS MISSING, REPLACE NOTHING.
 *
 * Every field here is written only when the record has nothing in it, and
 * contact methods are appended rather than merged over. That is what makes a
 * reimport of a stale export safe: it can teach the app a new number, and it
 * can never take back a correction someone made by hand.
 *
 * The note is the clearest case. The record's note is the user's own writing;
 * the file's is whatever their phone had. Overwriting the first with the
 * second would destroy work, so the file's note only lands on a person who
 * has none.
 */
function mergeInto(d: PersonData, c: ImportedContact): { patch: Partial<PersonData>; changes: string[] } {
  const patch: Partial<PersonData> = {};
  const changes: string[] = [];

  const newPhones = missing(phonesOf(d), c.phones ?? (c.phone ? [{ value: c.phone }] : []), normPhone);
  if (newPhones.length) {
    Object.assign(patch, withPhones([...phonesOf(d), ...newPhones]));
    changes.push(newPhones.length === 1 ? "a phone number" : capAfterNumber(`${newPhones.length} phone numbers`));
  }
  const newEmails = missing(emailsOf(d), c.emails ?? (c.email ? [{ value: c.email }] : []), normEmail);
  if (newEmails.length) {
    Object.assign(patch, withEmails([...emailsOf(d), ...newEmails]));
    changes.push(newEmails.length === 1 ? "an email address" : capAfterNumber(`${newEmails.length} email addresses`));
  }

  const fill = (key: "birthday" | "org" | "title" | "notes", value: string | undefined, word: string) => {
    if (!value || d[key]) return;
    (patch as Record<string, unknown>)[key] = value;
    changes.push(word);
  };
  fill("birthday", c.birthday, "a birthday");
  fill("org", c.org, "an organization");
  fill("title", c.title, "a title");
  fill("notes", c.notes, "a note");

  // The source id is worth learning even when nothing else changed: it makes
  // every future reimport certain instead of evidential.
  if (c.uid && !d.sourceUid) { patch.sourceUid = c.uid; changes.push("a source id"); }

  return { patch, changes };
}

function missing(have: ContactMethod[], incoming: ContactMethod[], norm: (v: string) => string): ContactMethod[] {
  const known = new Set(have.map((m) => norm(m.value)).filter(Boolean));
  const out: ContactMethod[] = [];
  for (const m of incoming) {
    const k = norm(m.value);
    if (!k || known.has(k)) continue;
    known.add(k);
    out.push(m);
  }
  return out;
}

// --- what the summary says -----------------------------------------------
//
// The handoff asks the preview to "Show added, updated, skipped, conflicts,
// and failures" and to "Distinguish a missing source field from a parse
// failure". These build those sentences, here rather than in the component,
// so the words are testable without mounting anything.

/** Before applying: what the file would do, and what is still waiting on an
 *  answer. Never says "skipped" for a row that is actually unresolved. */
export function planLine(plan: MatchPlan, answered: number): string {
  const waiting = plan.review.length - answered;
  const parts: string[] = [];
  if (plan.create.length) parts.push(`${plan.create.length} new`);
  if (plan.update.length) parts.push(`${plan.update.length} to update`);
  if (plan.unchanged) parts.push(`${plan.unchanged} already current`);
  if (waiting > 0) parts.push(`${waiting} to check`);
  if (!parts.length) return "Nothing to change";
  return capAfterNumber(parts.join(" · "));
}

/** After applying. Plain counts of what actually happened, never a claim
 *  about anything that did not. */
export function summaryLine(added: number, updated: number, unchanged: number): string {
  const parts: string[] = [];
  if (added) parts.push(`${added} added`);
  if (updated) parts.push(`${updated} updated`);
  if (unchanged) parts.push(`${unchanged} already current`);
  return parts.length ? capAfterNumber(parts.join(" · ")) : "Nothing changed";
}

/** One line of evidence for telling two same-name people apart: what this
 *  record already knows that the other might not. */
export function describe(p: Person): string {
  const bits = [
    p.data.relationship,
    p.data.org,
    phonesOf(p.data)[0]?.value,
    emailsOf(p.data)[0]?.value,
  ].filter((b): b is string => !!b);
  return bits.length ? bits.slice(0, 2).join(" · ") : "Nothing else on file";
}

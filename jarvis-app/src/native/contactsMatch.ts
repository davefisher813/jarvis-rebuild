// Contacts enrichment matching (native seven, item 3). Pure logic; the
// Contacts bridge only reads and this module only proposes patches.
//
// The refusals ARE the feature:
//   - match existing people by phone or email identity, nothing fuzzier
//   - fill ONLY fields the person is missing (number, email, photo)
//   - an ambiguous match (one contact resolving to two people, or identity
//     keys pointing at different people) enriches NOBODY
//   - never create a person from a contact, ever
//   - never write back to the device address book (there is no code path)

import type { DeviceContact } from "./bridge";

export interface KnownPerson {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  photoRef?: string;
}

export interface ContactFill {
  phone?: string;
  email?: string;
  photoRef?: string;
}

export interface ContactPatch {
  personId: string;
  contactId: string;
  fill: ContactFill;
}

// MARK: identity normalization

// Digits only; compare on the last 10 so "+1 (555) 123-4567" and
// "5551234567" agree. Fewer than 7 digits is not a phone identity.
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  return e.includes("@") ? e : null;
}

// MARK: matching

// Every person whose stored phone or email matches one of the contact's.
function identityCandidates(contact: DeviceContact, people: KnownPerson[]): KnownPerson[] {
  const phones = new Set(contact.phones.map(normalizePhone).filter((p): p is string => p !== null));
  const emails = new Set(contact.emails.map(normalizeEmail).filter((e): e is string => e !== null));
  const hits: KnownPerson[] = [];
  for (const person of people) {
    const phone = person.phone ? normalizePhone(person.phone) : null;
    const email = person.email ? normalizeEmail(person.email) : null;
    if ((phone && phones.has(phone)) || (email && emails.has(email))) hits.push(person);
  }
  return hits;
}

// Exactly one person, or nobody. Two hits means ambiguity, and ambiguity
// means no enrichment: a wrong photo on the wrong person is worse than a
// missing one.
export function matchContact(contact: DeviceContact, people: KnownPerson[]): KnownPerson | null {
  const hits = identityCandidates(contact, people);
  return hits.length === 1 ? (hits[0] ?? null) : null;
}

// The patch fills only what is missing. A person who already has the field
// keeps their value untouched, even when the device disagrees. Null when
// there is nothing to add.
export function enrichmentPatch(contact: DeviceContact, person: KnownPerson): ContactPatch | null {
  const fill: ContactFill = {};
  if (!person.phone) {
    const phone = contact.phones.find((p) => normalizePhone(p) !== null);
    if (phone) fill.phone = phone;
  }
  if (!person.email) {
    const email = contact.emails.find((e) => normalizeEmail(e) !== null);
    if (email) fill.email = email;
  }
  if (!person.photoRef && contact.photoRef) fill.photoRef = contact.photoRef;
  if (Object.keys(fill).length === 0) return null;
  return { personId: person.id, contactId: contact.id, fill };
}

// The full pass: for each device contact, match or refuse, then patch or
// refuse. A contact matching nobody produces NOTHING (never create), and a
// person is patched at most once (first contact wins; a second contact for
// the same person is itself ambiguity about which is canonical).
export function enrichPeople(contacts: DeviceContact[], people: KnownPerson[]): ContactPatch[] {
  const patches: ContactPatch[] = [];
  const patched = new Set<string>();
  for (const contact of contacts) {
    const person = matchContact(contact, people);
    if (!person || patched.has(person.id)) continue;
    const patch = enrichmentPatch(contact, person);
    if (patch) {
      patches.push(patch);
      patched.add(person.id);
    }
  }
  return patches;
}

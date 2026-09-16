import type { ContactMethod, PersonData } from "./types";

// EVERY WAY TO REACH SOMEONE, READ ONE WAY (People handoff, 2026-09-16).
//
// A person carries contact methods in two shapes at once and will for a long
// time: the single `phone`/`email` every surface in the app already reads,
// and the `phones`/`emails` arrays that hold the rest. Nothing migrates all
// at once, so this file is the only place that knows both shapes exist.
//
// THE CONTRACT, in one line: the arrays are the truth, the singles are the
// primary, and the primary is always the first entry of its array.
//
// That is what keeps the two from drifting. Readers that want "an address to
// write to" keep reading `person.data.email` and are always right. Readers
// that want every number call `phonesOf`. Writers never set either field by
// hand -- they build a patch with `withPhones` / `withEmails`, which writes
// both halves together.
//
// Nothing here guesses. A method with no label came from a source that did
// not give one, and it renders without a label rather than being called
// "mobile" on the app's say-so.

/** Every phone on file, primary first. Reads either shape: a person saved
 *  before the arrays existed yields their single number, and one saved with
 *  only arrays yields those. */
export function phonesOf(d: Pick<PersonData, "phone" | "phones">): ContactMethod[] {
  return merge(d.phone, d.phones);
}

export function emailsOf(d: Pick<PersonData, "email" | "emails">): ContactMethod[] {
  return merge(d.email, d.emails);
}

/** The one to use when a surface can only offer one. Undefined, never "". */
export function primaryPhone(d: Pick<PersonData, "phone" | "phones">): string | undefined {
  return phonesOf(d)[0]?.value;
}

export function primaryEmail(d: Pick<PersonData, "email" | "emails">): string | undefined {
  return emailsOf(d)[0]?.value;
}

/** True when there is more than one way of that kind, which is the only
 *  reason a surface needs to ask which one. */
export function hasChoice(methods: ContactMethod[]): boolean {
  return methods.length > 1;
}

function merge(single: string | undefined, arr: ContactMethod[] | undefined): ContactMethod[] {
  const clean = (m: ContactMethod): ContactMethod | null => {
    const v = m.value.trim();
    if (!v) return null;
    return m.label ? { value: v, label: m.label } : { value: v };
  };
  const list = (arr ?? []).map(clean).filter((m): m is ContactMethod => m !== null);
  // THE SINGLE IS A VIEW OF THE ARRAY, NOT A RIVAL ENTRY. The same number
  // normally sits in both, and the array's copy is the one carrying the label
  // the source gave it, so a naive "primary first, then the rest" would list
  // the bare single and dedupe the labelled twin away -- the number would
  // lose its "mobile" by being primary. The single only ADDS a row when the
  // array does not already hold that value.
  const key = (v: string) => v.trim().toLowerCase();
  const out: ContactMethod[] = [];
  const seen = new Set<string>();
  const push = (m: ContactMethod) => {
    if (seen.has(key(m.value))) return;
    seen.add(key(m.value));
    out.push(m);
  };
  const primary = single?.trim() ? key(single) : null;
  if (primary) {
    const twin = list.find((m) => key(m.value) === primary);
    push(twin ?? { value: single!.trim() });
  }
  for (const m of list) push(m);
  return out;
}

/** A PersonData patch that writes both halves at once: the full list, and the
 *  primary that every existing reader sees. Passing an empty list clears both,
 *  which is how a method is removed. */
export function withPhones(methods: ContactMethod[]): Pick<PersonData, "phone" | "phones"> {
  const clean = merge(undefined, methods);
  return { phone: clean[0]?.value, phones: clean.length ? clean : undefined };
}

export function withEmails(methods: ContactMethod[]): Pick<PersonData, "email" | "emails"> {
  const clean = merge(undefined, methods);
  return { email: clean[0]?.value, emails: clean.length ? clean : undefined };
}

// --- matching keys -------------------------------------------------------
//
// FOR FINDING A CANDIDATE, NEVER FOR STORING. The handoff is explicit:
// "Normalize email and phone for candidate detection without discarding
// original values." So these produce a key to compare on, and the value the
// user typed is what stays on the record and what gets dialled.

/** Lowercased and trimmed. Nothing clever: stripping dots or +suffixes is a
 *  provider-specific rule and guessing it merges two real people. */
export function normEmail(v: string): string {
  return v.trim().toLowerCase();
}

/**
 * Digits only, and the last 10 of them.
 *
 * A contact file gives the same number as "+1 (555) 010-3311", "555-010-3311"
 * and "15550103311", and all three have to land on one key or a reimport
 * creates a second person. Ten digits is the longest suffix that is safe
 * across the formats one person's own address book mixes; a country code
 * present in one export and absent in another is exactly what it drops.
 *
 * A number too short to be a real one (an extension, a partial) returns "",
 * which callers treat as "no key" rather than as a match -- otherwise every
 * short string would match every other.
 */
export function normPhone(v: string): string {
  const digits = v.replace(/\D+/g, "");
  if (digits.length < 7) return "";
  return digits.slice(-10);
}

/** Every comparable key a person offers, for candidate detection on import.
 *  Empty when there is nothing reliable to match on, which is the case that
 *  must fall through to a name check and then to review. */
export function matchKeys(d: Pick<PersonData, "phone" | "phones" | "email" | "emails">): string[] {
  const keys = new Set<string>();
  for (const e of emailsOf(d)) {
    const k = normEmail(e.value);
    if (k) keys.add("e:" + k);
  }
  for (const p of phonesOf(d)) {
    const k = normPhone(p.value);
    if (k) keys.add("p:" + k);
  }
  return [...keys];
}

/**
 * A NUMBER A PERSON CAN READ (Dave 2026-09-16, photographed: a contact card
 * showing "2035361094").
 *
 * The value stored is whatever the source or the user wrote, and that stays
 * true -- this only changes how it is DRAWN. An import from a phone often
 * carries the raw digits, and a wall of ten of them is something you have to
 * decode rather than recognize.
 *
 * Grouping is only applied where it is certainly right: ten digits, or eleven
 * starting with a 1. Anything else (an international number, an extension, a
 * short code) is returned exactly as written, because a wrong grouping is
 * worse than none -- it tells the reader a lie about the number's shape.
 */
export function phoneText(v: string): string {
  const raw = v.trim();
  if (/[a-zA-Z]/.test(raw)) return raw;
  const digits = raw.replace(/\D+/g, "");
  const ten = digits.length === 10 ? digits
    : digits.length === 11 && digits.startsWith("1") ? digits.slice(1)
      : null;
  if (!ten) return raw;
  const grouped = `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  // A leading + belongs to the number and is kept in front of the grouping.
  return raw.startsWith("+") && digits.length === 11 ? "+1 " + grouped : grouped;
}
